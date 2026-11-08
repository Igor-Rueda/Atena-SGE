const express = require('express')
const jwt = require('jsonwebtoken')
const rateLimit = require('express-rate-limit')
const multer = require('multer')
const { Readable } = require('stream')
const db = require('./db')
const { registrarEvento } = require('./logClient') // LOG: helper de auditoria

const router = express.Router()

const AUTH_URL = process.env.AUTH_SERVICE_URL || 'http://auth-service:4000'
const LOG_URL = process.env.LOG_SERVICE_URL || 'http://log-service:5000' // LOG: usado só na rota de consulta (proxy)
const PROFILE_URL = process.env.PROFILE_SERVICE_URL || 'http://profile-service:4100' // PERFIL: profile-service (rede interna)
const PAGAMENTOS_URL = process.env.PAGAMENTOS_SERVICE_URL || 'http://pagamentos:4200' // PAGAMENTOS: pagamentos (rede interna)
const REGRESSAO_URL = process.env.REGRESSAO_SERVICE_URL || 'http://regressao:6000' // REGRESSÃO: previsão de equipe (rede interna)
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY // segredo das rotas internas
const TAMANHO_MAXIMO_MB = Number(process.env.PROFILE_IMAGE_MAX_SIZE_MB || 5)

// Hierarquia cumulativa: cada papel faz o que o anterior faz.
const HIERARQUIA = ['professional', 'expert', 'admin']

// Categorias de usuário:
//  - Superior: cadastra, edita, exclui e conclui projetos (não mexe em demandas)
//  - Planejador: cadastra, edita e exclui demandas (a exclusão move para a aba Excluídas)
//  - Almoxarife, Operador, Montador: cada um avança a demanda da sua etapa
// Tokens antigos, sem categoria, valem como Superior.
function categoriaDe(usuario) {
  return usuario.categoria || 'superior'
}

// Limites do plano gratuito. Só contam o que está ATIVO
const LIMITES = {
  professional: { projetos_ativos: 3, demandas_abertas: 50 } // Ampliando o limite de demandas já que itens sumiram
}

function nivelDe(role) {
  return HIERARQUIA.indexOf(role)
}

function limiteDe(role, chave) {
  const limites = LIMITES[role]
  return limites ? limites[chave] : null
}

function ehAdmin(req) {
  return req.usuario.role === 'admin'
}

// lê e valida o JWT do cookie, popula req.usuario
function exigirLogin(req, res, next) {
  const token = req.cookies.token
  if (!token) {
    return res.status(401).json({ mensagem: 'Você precisa estar logado.' })
  }
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET)
    req.usuario = payload // { usuario_id, nome, role }
    next()
  } catch (err) {
    return res.status(401).json({ mensagem: 'Sessão inválida ou expirada.' })
  }
}

function exigirNivel(roleMinimo) {
  return (req, res, next) => {
    if (nivelDe(req.usuario.role) < nivelDe(roleMinimo)) {
      registrarEvento({
        usuario_id: req.usuario.usuario_id,
        acao: 'acesso_negado',
        ip_origem: req.ip,
        detalhe: `rota=${req.method} ${req.originalUrl} role_atual=${req.usuario.role} nivel_exigido=${roleMinimo}`
      })
      return res.status(403).json({
        mensagem: roleMinimo === 'expert' ? 'Esse recurso exige o plano Expert.' : 'Seu papel não tem permissão para essa ação.',
        codigo: 'plano_insuficiente',
        plano_necessario: roleMinimo
      })
    }
    next()
  }
}

// Libera a rota só para as categorias informadas (o CRUD não depende do plano Professional/Expert).
function exigirCategoria(categorias, mensagem) {
  return (req, res, next) => {
    const atual = categoriaDe(req.usuario)
    if (categorias.includes(atual)) return next()
    registrarEvento({
      usuario_id: req.usuario.usuario_id,
      acao: 'acesso_negado',
      ip_origem: req.ip,
      detalhe: `rota=${req.method} ${req.originalUrl} categoria_atual=${atual} categorias_exigidas=${categorias.join('|')}`
    })
    return res.status(403).json({ mensagem })
  }
}

function exigirProprioPerfil(req, res, next) {
  if (String(req.params.usuario_id) !== String(req.usuario.usuario_id)) {
    return res.status(403).json({ mensagem: 'Você só pode editar o seu próprio perfil.' })
  }
  next()
}

async function dentroDoLimite(req, res, chave, contar) {
  const limite = limiteDe(req.usuario.role, chave)
  if (limite == null) return true

  const atual = await contar()
  if (atual < limite) return true

  registrarEvento({
    usuario_id: req.usuario.usuario_id,
    acao: 'limite_plano_atingido',
    ip_origem: req.ip,
    detalhe: `limite=${chave} valor=${limite} role=${req.usuario.role}`
  })
  res.status(403).json({
    mensagem: `Você atingiu o limite do plano Professional (${limite}). Assine o plano Expert para continuar.`,
    codigo: 'limite_plano',
    plano_necessario: 'expert'
  })
  return false
}

const limitadorEscrita = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  message: { mensagem: 'Muitas requisições. Aguarde um momento.' }
})

const OPCOES_COOKIE = {
  httpOnly: true,
  secure: true,
  sameSite: 'strict',
  maxAge: 1 * 15 * 60 * 1000
}

const limitadorRenovar = rateLimit({ windowMs: 60 * 1000, max: 30 })

const uploadFoto = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: TAMANHO_MAXIMO_MB * 1024 * 1024 }
})

// ---------- USUÁRIO LOGADO ----------

router.get('/me', exigirLogin, (req, res) => {
  res.json({
    usuario_id: req.usuario.usuario_id,
    nome: req.usuario.nome,
    role: req.usuario.role,
    categoria: categoriaDe(req.usuario)
  })
})

// ---------- PROXY PRO AUTH-SERVICE ----------

router.post('/auth/cadastro', async (req, res) => {
  try {
    const resposta = await fetch(`${AUTH_URL}/cadastro`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body)
    })
    const dados = await resposta.json()
    res.status(resposta.status).json(dados)
  } catch (err) {
    res.status(502).json({ mensagem: 'Serviço de autenticação indisponível.' })
  }
})

router.post('/auth/login', async (req, res) => {
  try {
    const resposta = await fetch(`${AUTH_URL}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body)
    })
    const dados = await resposta.json()

    if (!resposta.ok) {
      return res.status(resposta.status).json(dados)
    }

    res.cookie('token', dados.token, OPCOES_COOKIE)
    res.json({ mensagem: 'Login realizado com sucesso.' })

  } catch (err) {
    res.status(502).json({ mensagem: 'Serviço de autenticação indisponível.' })
  }
})

router.post('/auth/logout', (req, res) => {
  res.clearCookie('token')
  res.json({ mensagem: 'Logout realizado.' })
})

router.post('/auth/renovar', exigirLogin, limitadorRenovar, async (req, res) => {
  try {
    const resposta = await fetch(`${AUTH_URL}/internos/usuarios/${req.usuario.usuario_id}/token`, {
      method: 'POST',
      headers: { 'x-internal-key': INTERNAL_API_KEY }
    })
    if (!resposta.ok) throw new Error(`auth-service respondeu ${resposta.status}`)
    const dados = await resposta.json() 
    res.cookie('token', dados.token, OPCOES_COOKIE)
    res.json({ role: dados.role })
  } catch (err) {
    res.status(502).json({ mensagem: 'Serviço de autenticação indisponível.' })
  }
})

router.post('/auth/esqueci-senha', async (req, res) => {
  try {
    const resposta = await fetch(`${AUTH_URL}/esqueci-senha`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body)
    })
    const dados = await resposta.json()
    res.status(resposta.status).json(dados)
  } catch (err) {
    res.status(502).json({ mensagem: 'Serviço de autenticação indisponível.' })
  }
})

router.post('/auth/redefinir-senha', async (req, res) => {
  try {
    const resposta = await fetch(`${AUTH_URL}/redefinir-senha`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body)
    })
    const dados = await resposta.json()
    res.status(resposta.status).json(dados)
  } catch (err) {
    res.status(502).json({ mensagem: 'Serviço de autenticação indisponível.' })
  }
})

// ---------- PROJETOS ----------
// O Superior cadastra, edita, exclui e conclui projetos, em qualquer plano (só o limite de projetos ativos
// do Professional continua valendo). Os demais usuários apenas consultam.

function lerCamposProjeto(corpo) {
  const nome = String(corpo.nome || '').trim()
  const descricao = String(corpo.descricao || '').trim() || null
  const vazio = corpo.prazo_dias === undefined || corpo.prazo_dias === null || corpo.prazo_dias === ''
  const prazo = vazio ? null : Number(corpo.prazo_dias)

  if (!nome || nome.length > 150) {
    return { erro: 'Informe o nome do projeto (até 150 caracteres).' }
  }
  if (prazo !== null && (!Number.isInteger(prazo) || prazo < 1 || prazo > 3650)) {
    return { erro: 'O prazo deve ser um número inteiro de dias (de 1 a 3650).' }
  }
  return { nome, descricao, prazo }
}

async function carregarProjeto(req, res) {
  const id = Number(req.params.id)
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ mensagem: 'Id inválido.' })
    return null
  }

  const [linhas] = await db.query('SELECT * FROM projetos WHERE id = ?', [id])
  const projeto = linhas[0]

  if (!projeto) {
    res.status(404).json({ mensagem: 'Projeto não encontrado.' })
    return null
  }

  const souDono = (projeto.criado_por === req.usuario.usuario_id || ehAdmin(req))
  return { projeto, souDono }
}

router.post('/projetos', exigirLogin, exigirCategoria(['superior'], 'Só o Superior pode cadastrar projetos.'), limitadorEscrita, async (req, res) => {
  const campos = lerCamposProjeto(req.body)
  if (campos.erro) return res.status(400).json({ mensagem: campos.erro })

  try {
    const pode = await dentroDoLimite(req, res, 'projetos_ativos', async () => {
      const [[{ total }]] = await db.query(
        "SELECT COUNT(*) AS total FROM projetos WHERE criado_por = ? AND status = 'ativo'",
        [req.usuario.usuario_id]
      )
      return total
    })
    if (!pode) return

    const [resultado] = await db.query(
      'INSERT INTO projetos (nome, descricao, prazo_dias, criado_por) VALUES (?, ?, ?, ?)',
      [campos.nome, campos.descricao, campos.prazo, req.usuario.usuario_id]
    )

    registrarEvento({
      usuario_id: req.usuario.usuario_id,
      acao: 'projeto_criado',
      ip_origem: req.ip,
      detalhe: `projeto_id=${resultado.insertId}`
    })

    res.status(201).json({ id: resultado.insertId })
  } catch (err) {
    console.error(err)
    res.status(500).json({ mensagem: 'Erro ao cadastrar projeto.' })
  }
})

router.get('/projetos', exigirLogin, async (req, res) => {
  try {
    const campos = `p.id, p.nome, p.descricao, p.prazo_dias, p.status, p.criado_em,
      p.criado_por = ? AS sou_dono,
      (SELECT COUNT(*) FROM demandas d WHERE d.projeto_id = p.id AND d.excluida_em IS NULL) AS total_demandas`

    const [linhas] = await db.query(`SELECT ${campos} FROM projetos p ORDER BY p.id DESC`, [req.usuario.usuario_id])
    res.json(linhas.map(l => ({ ...l, sou_dono: Boolean(l.sou_dono) })))
  } catch (err) {
    console.error(err)
    res.status(500).json({ mensagem: 'Erro ao buscar projetos.' })
  }
})

router.get('/projetos/:id', exigirLogin, async (req, res) => {
  try {
    const acesso = await carregarProjeto(req, res)
    if (!acesso) return
    const { projeto, souDono } = acesso

    // Demandas excluídas não aparecem aqui: elas ficam na aba Excluídas do Planejador
    const [demandas] = await db.query(
      `SELECT id, rg, nome_material, quantidade, etapa_atual, planejador_id
         FROM demandas
        WHERE projeto_id = ? AND excluida_em IS NULL
        ORDER BY FIELD(etapa_atual, 'almoxarifado', 'operacao', 'montagem', 'finalizada'), id`,
      [projeto.id]
    )

    // Aba Excluídas: só o Planejador vê, e só as que ele mesmo excluiu neste projeto
    let excluidas = []
    if (categoriaDe(req.usuario) === 'planejador') {
      ;[excluidas] = await db.query(
        `SELECT id, rg, nome_material, quantidade, etapa_atual, planejador_id, excluida_em
           FROM demandas
          WHERE projeto_id = ? AND planejador_id = ? AND excluida_em IS NOT NULL
          ORDER BY excluida_em DESC, id DESC`,
        [projeto.id, req.usuario.usuario_id]
      )
    }

    res.json({ projeto, sou_dono: souDono, demandas, excluidas })
  } catch (err) {
    console.error(err)
    res.status(500).json({ mensagem: 'Erro ao buscar projeto.' })
  }
})

router.put('/projetos/:id', exigirLogin, exigirCategoria(['superior'], 'Só o Superior pode editar projetos.'), limitadorEscrita, async (req, res) => {
  const campos = lerCamposProjeto(req.body)
  if (campos.erro) return res.status(400).json({ mensagem: campos.erro })

  try {
    const acesso = await carregarProjeto(req, res)
    if (!acesso) return
    if (!acesso.souDono) {
      return res.status(403).json({ mensagem: 'Só quem criou o projeto pode editá-lo.' })
    }
    if (acesso.projeto.status === 'concluido') {
      return res.status(409).json({ mensagem: 'Projetos concluídos não podem ser editados.' })
    }

    await db.query(
      'UPDATE projetos SET nome = ?, descricao = ?, prazo_dias = ? WHERE id = ?',
      [campos.nome, campos.descricao, campos.prazo, acesso.projeto.id]
    )

    registrarEvento({
      usuario_id: req.usuario.usuario_id,
      acao: 'projeto_editado',
      ip_origem: req.ip,
      detalhe: `projeto_id=${acesso.projeto.id}`
    })

    res.json({ mensagem: 'Projeto atualizado.' })
  } catch (err) {
    console.error(err)
    res.status(500).json({ mensagem: 'Erro ao editar projeto.' })
  }
})

// Demandas que a Montagem ainda não concluiu (as excluídas não contam)
async function contarPendentes(projetoId) {
  const [[{ total }]] = await db.query(
    "SELECT COUNT(*) AS total FROM demandas WHERE projeto_id = ? AND etapa_atual <> 'finalizada' AND excluida_em IS NULL",
    [projetoId]
  )
  return Number(total)
}

function responderPendentes(res, pendentes) {
  return res.status(409).json({
    mensagem: `Há ${pendentes} demanda${pendentes === 1 ? '' : 's'} que a Montagem ainda não concluiu. Confirme para continuar.`,
    codigo: 'demandas_pendentes',
    pendentes
  })
}

// Exclui o projeto e, em cascata, as demandas dele (inclusive as da aba Excluídas).
// Com demandas não concluídas pela Montagem, só segue com ?confirmar=1 (o front mostra o aviso antes).
router.delete('/projetos/:id', exigirLogin, exigirCategoria(['superior'], 'Só o Superior pode excluir projetos.'), limitadorEscrita, async (req, res) => {
  try {
    const acesso = await carregarProjeto(req, res)
    if (!acesso) return
    if (!acesso.souDono) {
      return res.status(403).json({ mensagem: 'Só quem criou o projeto pode excluí-lo.' })
    }

    const pendentes = await contarPendentes(acesso.projeto.id)
    if (pendentes > 0 && req.query.confirmar !== '1') return responderPendentes(res, pendentes)

    await db.query('DELETE FROM projetos WHERE id = ?', [acesso.projeto.id])

    registrarEvento({
      usuario_id: req.usuario.usuario_id,
      acao: 'projeto_excluido',
      ip_origem: req.ip,
      detalhe: `projeto_id=${acesso.projeto.id} pendentes=${pendentes}`
    })

    res.json({ mensagem: 'Projeto excluído.' })
  } catch (err) {
    console.error(err)
    res.status(500).json({ mensagem: 'Erro ao excluir projeto.' })
  }
})

// Concluir o projeto não pede mais o número de funcionários. Com demandas não concluídas pela Montagem,
// só segue com ?confirmar=1; elas são encerradas (finalizada) sem passar pela Montagem e sem finalizado_em,
// para não entrar na "demanda do mês" da previsão.
router.patch('/projetos/:id/concluir', exigirLogin, exigirCategoria(['superior'], 'Só o Superior pode concluir projetos.'), limitadorEscrita, async (req, res) => {
  try {
    const acesso = await carregarProjeto(req, res)
    if (!acesso) return
    if (!acesso.souDono) {
      return res.status(403).json({ mensagem: 'Só quem criou o projeto pode concluí-lo.' })
    }
    if (acesso.projeto.status === 'concluido') {
      return res.status(409).json({ mensagem: 'Esse projeto já está concluído.' })
    }

    const pendentes = await contarPendentes(acesso.projeto.id)
    if (pendentes > 0 && req.query.confirmar !== '1') return responderPendentes(res, pendentes)

    await db.query("UPDATE projetos SET status = 'concluido', concluido_em = NOW() WHERE id = ?", [acesso.projeto.id])
    await db.query(
      "UPDATE demandas SET etapa_atual = 'finalizada' WHERE projeto_id = ? AND etapa_atual <> 'finalizada' AND excluida_em IS NULL",
      [acesso.projeto.id]
    )

    registrarEvento({
      usuario_id: req.usuario.usuario_id,
      acao: 'projeto_concluido',
      ip_origem: req.ip,
      detalhe: `projeto_id=${acesso.projeto.id} pendentes_encerradas=${pendentes}`
    })

    res.json({ mensagem: 'Projeto concluído.' })
  } catch (err) {
    console.error(err)
    res.status(500).json({ mensagem: 'Erro ao concluir projeto.' })
  }
})

// ---------- DEMANDAS ----------
// Planejador: cadastra, edita e exclui (exclusão lógica: vai para a aba Excluídas).
// Almoxarife, Operador e Montador: cada um avança a demanda da sua etapa.
// Superior: não atua em demandas.

// Toda demanda criada pelo Planejador entra direto na fila do Almoxarifado
const ETAPA_INICIAL = 'almoxarifado'

const TRANSICAO = {
  almoxarifado: { categoria: 'almoxarife', proxima: 'operacao', campo: 'almoxarife_id' },
  operacao: { categoria: 'operador', proxima: 'montagem', campo: 'operador_id' },
  montagem: { categoria: 'montador', proxima: 'finalizada', campo: 'montador_id' }
}

const ETAPA_DA_CATEGORIA = { almoxarife: 'almoxarifado', operador: 'operacao', montador: 'montagem' }

// Processos para onde o Planejador pode destinar uma demanda (ao cadastrar ou editar), na ordem do fluxo
const ETAPAS_DESTINO = ['almoxarifado', 'operacao', 'montagem']

// Coluna que guarda quem concluiu cada etapa -> posição da etapa no fluxo
const RESPONSAVEL_DA_ETAPA = { almoxarife_id: 0, operador_id: 1, montador_id: 2 }

function validarCamposDemanda(corpo, etapaPadrao) {
  const rg = String(corpo.rg || '').trim()
  const nome_material = String(corpo.nome_material || '').trim()
  const quantidade = Number(corpo.quantidade)
  if (!rg || rg.length > 50 || !nome_material || nome_material.length > 255 || !Number.isInteger(quantidade) || quantidade < 1) {
    return { erro: 'Informe o RG (até 50 caracteres), o material (até 255) e uma quantidade válida.' }
  }

  const semEtapa = corpo.etapa_atual === undefined || corpo.etapa_atual === null || corpo.etapa_atual === ''
  const etapa = semEtapa ? etapaPadrao : String(corpo.etapa_atual).trim()
  if (etapa !== null && !ETAPAS_DESTINO.includes(etapa)) {
    return { erro: 'Escolha um processo válido (Almoxarifado, Operação ou Montagem).' }
  }
  return { rg, nome_material, quantidade, etapa }
}

router.post('/projetos/:id/demandas', exigirLogin, exigirCategoria(['planejador'], 'Só o Planejador pode cadastrar demandas.'), limitadorEscrita, async (req, res) => {
  const campos = validarCamposDemanda(req.body, ETAPA_INICIAL)
  if (campos.erro) return res.status(400).json({ mensagem: campos.erro })

  try {
    const acesso = await carregarProjeto(req, res)
    if (!acesso) return

    if (acesso.projeto.status !== 'ativo') {
      return res.status(409).json({ mensagem: 'Esse projeto já foi concluído.' })
    }

    const pode = await dentroDoLimite(req, res, 'demandas_abertas', async () => {
      const [[{ total }]] = await db.query(
        "SELECT COUNT(*) AS total FROM demandas WHERE planejador_id = ? AND etapa_atual <> 'finalizada' AND excluida_em IS NULL",
        [req.usuario.usuario_id]
      )
      return total
    })
    if (!pode) return

    const [resultado] = await db.query(
      `INSERT INTO demandas (projeto_id, rg, nome_material, quantidade, etapa_atual, planejador_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [acesso.projeto.id, campos.rg, campos.nome_material, campos.quantidade, campos.etapa, req.usuario.usuario_id]
    )

    registrarEvento({
      usuario_id: req.usuario.usuario_id,
      acao: 'demanda_criada',
      ip_origem: req.ip,
      detalhe: `demanda_id=${resultado.insertId} etapa=${campos.etapa}`
    })

    res.status(201).json({ id: resultado.insertId })
  } catch (err) {
    console.error(err)
    res.status(500).json({ mensagem: 'Erro ao cadastrar demanda.' })
  }
})

// Fila de produção: só Almoxarife, Operador e Montador têm fila (a da própria etapa).
// Planejador e Superior não usam esta lista: devolve vazio (eles trabalham pela página do projeto).
router.get('/demandas', exigirLogin, async (req, res) => {
  try {
    const etapa = ETAPA_DA_CATEGORIA[categoriaDe(req.usuario)]
    if (!etapa) return res.json([])

    const [linhas] = await db.query(
      `SELECT d.id, d.projeto_id, d.rg, d.nome_material, d.quantidade, d.etapa_atual, d.planejador_id,
              p.nome AS projeto_nome
         FROM demandas d JOIN projetos p ON p.id = d.projeto_id
        WHERE d.etapa_atual = ? AND d.excluida_em IS NULL
        ORDER BY d.id`,
      [etapa]
    )
    res.json(linhas)
  } catch (err) {
    console.error(err)
    res.status(500).json({ mensagem: 'Erro ao buscar a fila de produção.' })
  }
})

// Carrega a demanda e já responde 400/404/403/409 quando não dá para seguir (devolve null nesses casos).
// Só o Planejador que criou a demanda pode alterá-la; demandas excluídas ou finalizadas não mudam.
async function carregarDemandaGerenciavel(req, res) {
  const id = Number(req.params.id)
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ mensagem: 'Id inválido.' })
    return null
  }

  const [linhas] = await db.query(
    'SELECT id, etapa_atual, planejador_id FROM demandas WHERE id = ? AND excluida_em IS NULL',
    [id]
  )
  const demanda = linhas[0]
  if (!demanda) {
    res.status(404).json({ mensagem: 'Demanda não encontrada.' })
    return null
  }

  if (categoriaDe(req.usuario) !== 'planejador' || demanda.planejador_id !== req.usuario.usuario_id) {
    registrarEvento({
      usuario_id: req.usuario.usuario_id,
      acao: 'acesso_negado',
      ip_origem: req.ip,
      detalhe: `rota=${req.method} ${req.originalUrl} categoria_atual=${categoriaDe(req.usuario)}`
    })
    res.status(403).json({ mensagem: 'Só o Planejador que criou a demanda pode alterá-la.' })
    return null
  }

  if (demanda.etapa_atual === 'finalizada') {
    res.status(409).json({ mensagem: 'Demandas finalizadas não podem ser alteradas.' })
    return null
  }
  return demanda
}

// Editar: corrige RG, material e quantidade e/ou destina a demanda para outro processo.
// Ao voltar para um processo anterior, apaga quem já tinha concluído as etapas dali em diante.
router.put('/demandas/:id', exigirLogin, limitadorEscrita, async (req, res) => {
  const campos = validarCamposDemanda(req.body, null)
  if (campos.erro) return res.status(400).json({ mensagem: campos.erro })

  try {
    const demanda = await carregarDemandaGerenciavel(req, res)
    if (!demanda) return

    const etapa = campos.etapa || demanda.etapa_atual
    const posicao = ETAPAS_DESTINO.indexOf(etapa)
    const limpar = Object.keys(RESPONSAVEL_DA_ETAPA)
      .filter(coluna => RESPONSAVEL_DA_ETAPA[coluna] >= posicao)
      .map(coluna => `${coluna} = NULL`)
      .join(', ')

    await db.query(
      `UPDATE demandas SET rg = ?, nome_material = ?, quantidade = ?, etapa_atual = ?, ${limpar}
        WHERE id = ? AND excluida_em IS NULL`,
      [campos.rg, campos.nome_material, campos.quantidade, etapa, demanda.id]
    )

    registrarEvento({
      usuario_id: req.usuario.usuario_id,
      acao: 'demanda_editada',
      ip_origem: req.ip,
      detalhe: `demanda_id=${demanda.id} etapa=${etapa}`
    })

    res.json({ mensagem: 'Demanda atualizada.' })
  } catch (err) {
    console.error(err)
    res.status(500).json({ mensagem: 'Erro ao editar demanda.' })
  }
})

// "Excluir" move a demanda para a aba Excluídas (exclusão lógica): ela sai da fila, do projeto e das contagens.
router.delete('/demandas/:id', exigirLogin, limitadorEscrita, async (req, res) => {
  try {
    const demanda = await carregarDemandaGerenciavel(req, res)
    if (!demanda) return

    await db.query(
      'UPDATE demandas SET excluida_em = NOW(), excluida_por = ? WHERE id = ? AND excluida_em IS NULL',
      [req.usuario.usuario_id, demanda.id]
    )

    registrarEvento({
      usuario_id: req.usuario.usuario_id,
      acao: 'demanda_excluida',
      ip_origem: req.ip,
      detalhe: `demanda_id=${demanda.id}`
    })

    res.json({ mensagem: 'Demanda movida para Excluídas.' })
  } catch (err) {
    console.error(err)
    res.status(500).json({ mensagem: 'Erro ao excluir demanda.' })
  }
})

router.patch('/demandas/:id/avancar', exigirLogin, limitadorEscrita, async (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ mensagem: 'Id inválido.' })
  }

  try {
    const [linhas] = await db.query('SELECT id, etapa_atual FROM demandas WHERE id = ? AND excluida_em IS NULL', [id])
    const demanda = linhas[0]
    if (!demanda) {
      return res.status(404).json({ mensagem: 'Demanda não encontrada.' })
    }

    const regra = TRANSICAO[demanda.etapa_atual]
    if (!regra) {
      return res.status(409).json({ mensagem: 'Essa demanda já está finalizada.' })
    }
    if (categoriaDe(req.usuario) !== regra.categoria) {
      return res.status(403).json({ mensagem: 'Sua categoria não permite avançar esta demanda no estado atual.' })
    }

    const finalizando = regra.proxima === 'finalizada'
    const [atualizacao] = await db.query(
      `UPDATE demandas SET etapa_atual = ?, ${regra.campo} = ?${finalizando ? ', finalizado_em = NOW()' : ''}
        WHERE id = ? AND etapa_atual = ? AND excluida_em IS NULL`,
      [regra.proxima, req.usuario.usuario_id, id, demanda.etapa_atual]
    )
    if (atualizacao.affectedRows === 0) {
      return res.status(409).json({ mensagem: 'Essa demanda já foi movida por outra pessoa. Atualize a página.' })
    }

    if (finalizando) {
      registrarEvento({
        usuario_id: req.usuario.usuario_id,
        acao: 'demanda_concluida',
        ip_origem: req.ip,
        detalhe: `demanda_id=${id}`
      })
    }

    res.json({ mensagem: 'Demanda avançou para: ' + regra.proxima })
  } catch (err) {
    console.error(err)
    res.status(500).json({ mensagem: 'Erro ao avançar a demanda.' })
  }
})

// ---------- INDICADORES, REGRESSÃO, PERFIL, etc ----------
// Mantidos sem alterações

// Indicadores (plano Expert): demandas por processo e concluídas x pendentes.
// O admin vê tudo; os demais veem as demandas dos projetos que criaram ou que eles mesmos cadastraram.
// Demandas excluídas não contam. "Pendentes" = as que ainda estão em algum processo (não finalizadas).
const PROCESSOS_INDICADORES = [
  { processo: 'almoxarifado', rotulo: 'Almoxarifado' },
  { processo: 'operacao', rotulo: 'Operação' },
  { processo: 'montagem', rotulo: 'Montagem' }
]

router.get('/indicadores', exigirLogin, exigirNivel('expert'), async (req, res) => {
  try {
    const admin = ehAdmin(req)
    const uid = req.usuario.usuario_id

    const [porEtapa] = await db.query(
      `SELECT d.etapa_atual AS etapa, COUNT(*) AS total
         FROM demandas d JOIN projetos p ON p.id = d.projeto_id
        WHERE d.excluida_em IS NULL ${admin ? '' : 'AND (p.criado_por = ? OR d.planejador_id = ?)'}
        GROUP BY d.etapa_atual`,
      admin ? [] : [uid, uid]
    )
    const contagem = {}
    porEtapa.forEach(l => { contagem[l.etapa] = Number(l.total) })

    const por_processo = PROCESSOS_INDICADORES.map(p => ({ ...p, total: contagem[p.processo] || 0 }))
    const concluidas = contagem.finalizada || 0
    const pendentes = por_processo.reduce((soma, p) => soma + p.total, 0)

    const [[projetos]] = await db.query(
      `SELECT SUM(p.status = 'ativo') AS ativos, SUM(p.status = 'concluido') AS concluidos
         FROM projetos p WHERE 1 = 1 ${admin ? '' : 'AND p.criado_por = ?'}`,
      admin ? [] : [uid]
    )

    res.json({
      por_processo,
      concluidas,
      pendentes,
      total: concluidas + pendentes,
      projetos: { ativos: Number(projetos.ativos || 0), concluidos: Number(projetos.concluidos || 0) },
      // campos antigos, mantidos para não quebrar telas que ainda os leiam
      carga: [],
      por_atividade: porEtapa.map(l => ({ atividade: l.etapa, total: Number(l.total), abertas: Number(l.total) }))
    })
  } catch (err) {
    console.error(err)
    res.status(500).json({ mensagem: 'Erro ao calcular indicadores.' })
  }
})

const ANALISE = '/analise/previsao-equipe'
const uploadCsv = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 } })
const soExpert = [exigirLogin, exigirNivel('expert')]

async function chamarRegressao(metodo, caminho, corpo) {
  try {
    const resposta = await fetch(`${REGRESSAO_URL}${caminho}`, {
      method: metodo,
      headers: { 'Content-Type': 'application/json', 'x-internal-key': INTERNAL_API_KEY },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
      signal: AbortSignal.timeout(60000)
    })
    const dados = await resposta.json().catch(() => ({}))
    return { status: resposta.status, dados }
  } catch (err) {
    console.error('Falha ao comunicar com o serviço de regressão:', err.message)
    return { status: 503, dados: { mensagem: `Serviço de análise temporariamente indisponível (${err.message}).` } }
  }
}

function exigirArquivo(req, res, next) {
  if (!req.file) {
    return res.status(400).json({ mensagem: 'Nenhum arquivo enviado. Escolha um arquivo CSV.' })
  }
  next()
}

router.post(`${ANALISE}/previa`, ...soExpert, limitadorEscrita, uploadCsv.single('arquivo'), exigirArquivo, async (req, res) => {
  const r = await chamarRegressao('POST', '/csv/previa', { arquivo_base64: req.file.buffer.toString('base64') })
  res.status(r.status).json(r.dados)
})

router.post(`${ANALISE}/treinar`, ...soExpert, limitadorEscrita, uploadCsv.single('arquivo'), exigirArquivo, async (req, res) => {
  let entradas = null
  try { entradas = JSON.parse(req.body.entradas || '[]') } catch (err) { entradas = null }
  if (typeof req.body.alvo !== 'string' || !Array.isArray(entradas)) {
    return res.status(400).json({ mensagem: 'Informe a coluna alvo e as colunas de entrada.' })
  }

  const r = await chamarRegressao('POST', '/treinar', {
    usuario_id: req.usuario.usuario_id,
    nome_arquivo: req.file.originalname,
    arquivo_base64: req.file.buffer.toString('base64'),
    alvo: req.body.alvo,
    entradas
  })
  if (r.status === 200) {
    registrarEvento({
      usuario_id: req.usuario.usuario_id,
      acao: 'modelo_treinado',
      ip_origem: req.ip,
      detalhe: `alvo=${req.body.alvo} entradas=${entradas.length} linhas=${r.dados.n_linhas}`
    })
  }
  res.status(r.status).json(r.dados)
})

router.get(`${ANALISE}/modelo`, ...soExpert, async (req, res) => {
  const r = await chamarRegressao('GET', `/modelo?usuario_id=${req.usuario.usuario_id}`)
  res.status(r.status).json(r.dados)
})

router.post(`${ANALISE}/prever`, ...soExpert, limitadorEscrita, async (req, res) => {
  const r = await chamarRegressao('POST', '/prever', { usuario_id: req.usuario.usuario_id, valores: req.body.valores })
  if (r.status === 200) {
    registrarEvento({
      usuario_id: req.usuario.usuario_id,
      acao: 'previsao_consultada',
      ip_origem: req.ip,
      detalhe: `funcionarios=${r.dados.funcionarios}`
    })
  }
  res.status(r.status).json(r.dados)
})

router.delete(`${ANALISE}/modelo`, ...soExpert, limitadorEscrita, async (req, res) => {
  const r = await chamarRegressao('DELETE', `/modelo?usuario_id=${req.usuario.usuario_id}`)
  res.status(r.status).json(r.dados)
})

router.post('/assinatura/checkout', exigirLogin, limitadorEscrita, async (req, res) => {
  try {
    const resposta = await fetch(`${PAGAMENTOS_URL}/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-key': INTERNAL_API_KEY },
      body: JSON.stringify({
        usuario_id: req.usuario.usuario_id,
        role: req.usuario.role,
        plano: req.body.plano,
        ip: req.ip
      })
    })
    const dados = await resposta.json()
    res.status(resposta.status).json(dados)
  } catch (err) {
    console.error(err)
    res.status(502).json({ mensagem: 'Serviço de pagamentos indisponível.' })
  }
})

router.get('/logs', exigirLogin, exigirNivel('admin'), async (req, res) => {
  try {
    const params = new URLSearchParams({ limit: String(req.query.limit || 50) })
    for (const chave of ['acao', 'nivel', 'usuario_id']) {
      if (req.query[chave]) params.set(chave, String(req.query[chave]))
    }
    const resposta = await fetch(`${LOG_URL}/eventos?${params}`)
    const dados = await resposta.json()
    res.status(resposta.status).json(dados)
  } catch (err) {
    console.error(err)
    res.status(502).json({ mensagem: 'Serviço de log indisponível.' })
  }
})

function sincronizarNome(usuarioId, nome) {
  fetch(`${PROFILE_URL}/perfis/${usuarioId}/nome`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nome })
  }).catch(err => console.error('Falha ao sincronizar nome no profile-service:', err.message))
}

router.get('/perfil/me', exigirLogin, async (req, res) => {
  try {
    sincronizarNome(req.usuario.usuario_id, req.usuario.nome)

    const respostaPerfil = await fetch(`${PROFILE_URL}/perfis/${req.usuario.usuario_id}`).then(r => r.json())

    res.json({
      usuario_id: req.usuario.usuario_id,
      nome: req.usuario.nome,
      bio: respostaPerfil.bio,
      foto_url: respostaPerfil.temFoto ? `/api/perfil/${req.usuario.usuario_id}/foto` : null,
      eh_proprio_perfil: true
    })
  } catch (err) {
    console.error(err)
    res.status(502).json({ mensagem: 'Serviço de perfil indisponível.' })
  }
})

router.get('/perfil/:usuario_id', exigirLogin, async (req, res) => {
  try {
    const usuarioId = req.params.usuario_id

    const respostaPerfil = await fetch(`${PROFILE_URL}/perfis/${usuarioId}`).then(r => r.json())

    res.json({
      usuario_id: Number(usuarioId),
      nome: respostaPerfil.nome,
      bio: respostaPerfil.bio,
      foto_url: respostaPerfil.temFoto ? `/api/perfil/${usuarioId}/foto` : null,
      eh_proprio_perfil: Number(usuarioId) === req.usuario.usuario_id
    })
  } catch (err) {
    console.error(err)
    res.status(502).json({ mensagem: 'Serviço de perfil indisponível.' })
  }
})

router.put('/perfil/:usuario_id', exigirLogin, exigirProprioPerfil, limitadorEscrita, async (req, res) => {
  try {
    const resposta = await fetch(`${PROFILE_URL}/perfis/${req.usuario.usuario_id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bio: req.body.bio })
    })
    const dados = await resposta.json()
    res.status(resposta.status).json(dados)
  } catch (err) {
    console.error(err)
    res.status(502).json({ mensagem: 'Serviço de perfil indisponível.' })
  }
})

router.post('/perfil/:usuario_id/foto', exigirLogin, exigirProprioPerfil, limitadorEscrita, uploadFoto.single('foto'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ mensagem: 'Nenhum arquivo enviado. Use o campo "foto".' })
  }

  try {
    const formData = new FormData()
    formData.append('foto', new Blob([req.file.buffer]), req.file.originalname)

    const resposta = await fetch(`${PROFILE_URL}/perfis/${req.usuario.usuario_id}/foto`, {
      method: 'POST',
      body: formData
    })
    const dados = await resposta.json()

    if (!resposta.ok) {
      return res.status(resposta.status).json(dados)
    }

    res.json({ ok: true, foto_url: `/api/perfil/${req.usuario.usuario_id}/foto` })
  } catch (err) {
    console.error(err)
    res.status(502).json({ mensagem: 'Serviço de perfil indisponível.' })
  }
})

router.get('/perfil/:usuario_id/foto', exigirLogin, async (req, res) => {
  try {
    const resposta = await fetch(`${PROFILE_URL}/perfis/${req.params.usuario_id}/foto-arquivo`)

    if (!resposta.ok) {
      return res.status(resposta.status).end()
    }

    res.set('Content-Type', resposta.headers.get('content-type') || 'image/jpeg')
    res.set('Cache-Control', 'private, max-age=60') 
    Readable.fromWeb(resposta.body).pipe(res)
  } catch (err) {
    console.error(err)
    res.status(502).end()
  }
})

router.use((err, req, res, next) => {
  if (err && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ mensagem: `Arquivo muito grande. Fotos: até ${TAMANHO_MAXIMO_MB} MB; planilhas CSV: até 2 MB.` })
  }
  next(err)
})

module.exports = router