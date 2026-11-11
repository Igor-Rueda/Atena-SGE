const express = require('express')
const crypto = require('crypto')
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
//  - Superior: cadastra, edita, exclui e conclui projetos (não mexe em demandas). Nasce ao criar a empresa.
//  - Planejador: cadastra, edita e exclui demandas (a exclusão move para a aba Excluídas)
//  - Almoxarife, Operador, Montador: cada um avança a demanda da sua etapa
const CATEGORIAS = ['superior', 'planejador', 'almoxarife', 'operador', 'montador']

function categoriaDe(usuario) {
  return usuario.categoria || 'superior'
}

// Limites do plano gratuito. Só contam o que está ATIVO
const LIMITES = {
  professional: { projetos_ativos: 3, demandas_abertas: 50 }
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

// Registra um evento de negócio sempre com quem fez, o IP e a empresa (org=...)
function logar(req, acao, detalhe) {
  const org = `org=${req.organizacaoId ?? '-'}`
  registrarEvento({
    usuario_id: req.usuario ? req.usuario.usuario_id : null,
    acao,
    ip_origem: req.ip,
    detalhe: detalhe ? `${detalhe} ${org}` : org
  })
}

// Erro inesperado: vai para o console e para o log de auditoria, e a resposta é 500
function erroInterno(req, res, err, mensagem) {
  console.error(err)
  logar(req, 'erro_interno', `rota=${req.method} ${req.originalUrl} erro=${String((err && err.message) || err).slice(0, 150)}`)
  return res.status(500).json({ mensagem })
}

// Tentativa de acessar o registro de OUTRA empresa: a resposta continua 404 (não revela que existe),
// mas o evento fica no log. tabela é sempre um literal do código: projetos, demandas ou usuarios.
async function registrarOutraEmpresa(req, tabela, id) {
  const numero = Number(id)
  if (!Number.isInteger(numero) || numero <= 0) return
  try {
    const [[achou]] = await db.query(
      `SELECT 1 AS existe FROM ${tabela} WHERE id = ? AND organizacao_id <> ?`,
      [numero, req.organizacaoId]
    )
    if (achou) {
      logar(req, 'acesso_negado', `rota=${req.method} ${req.originalUrl} motivo=outra_empresa recurso=${tabela}:${numero}`)
    }
  } catch (err) {
    console.error('Falha ao registrar acesso a outra empresa:', err.message)
  }
}

// ---------- AUTENTICAÇÃO E EMPRESA ----------

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

// ISOLAMENTO: a empresa e a categoria são lidas DO BANCO a cada requisição.
// Nunca vêm do cliente nem do token. Conta sem empresa é barrada.
async function carregarEmpresa(req, res, next) {
  try {
    const [[u]] = await db.query(
      'SELECT organizacao_id, categoria FROM usuarios WHERE id = ?',
      [req.usuario.usuario_id]
    )
    if (!u || !u.organizacao_id) {
      return res.status(403).json({ mensagem: 'Sua conta não está vinculada a uma empresa.' })
    }
    req.organizacaoId = u.organizacao_id
    req.usuario.categoria = u.categoria // a categoria do banco vale mais que a do token
    next()
  } catch (err) {
    return erroInterno(req, res, err, 'Erro ao validar a empresa.')
  }
}

// Use em TODA rota que toca dados de negócio
const exigirEmpresa = [exigirLogin, carregarEmpresa]

function exigirNivel(roleMinimo) {
  return (req, res, next) => {
    if (nivelDe(req.usuario.role) < nivelDe(roleMinimo)) {
      logar(req, 'acesso_negado', `rota=${req.method} ${req.originalUrl} role_atual=${req.usuario.role} nivel_exigido=${roleMinimo}`)
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
    logar(req, 'acesso_negado', `rota=${req.method} ${req.originalUrl} categoria_atual=${atual} categorias_exigidas=${categorias.join('|')}`)
    return res.status(403).json({ mensagem })
  }
}

function exigirProprioPerfil(req, res, next) {
  if (String(req.params.usuario_id) !== String(req.usuario.usuario_id)) {
    logar(req, 'acesso_negado', `rota=${req.method} ${req.originalUrl} motivo=perfil_de_outra_pessoa`)
    return res.status(403).json({ mensagem: 'Você só pode editar o seu próprio perfil.' })
  }
  next()
}

async function dentroDoLimite(req, res, chave, contar) {
  const limite = limiteDe(req.usuario.role, chave)
  if (limite == null) return true

  const atual = await contar()
  if (atual < limite) return true

  logar(req, 'limite_plano_atingido', `limite=${chave} valor=${limite} role=${req.usuario.role}`)
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

// Contra adivinhação do código da empresa
const limitadorCadastro = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { mensagem: 'Muitas tentativas de cadastro. Aguarde um minuto.' }
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

router.get('/me', exigirLogin, async (req, res) => {
  try {
    const [[u]] = await db.query(
      `SELECT u.categoria, o.nome AS empresa
         FROM usuarios u LEFT JOIN organizacoes o ON o.id = u.organizacao_id
        WHERE u.id = ?`,
      [req.usuario.usuario_id]
    )
    res.json({
      usuario_id: req.usuario.usuario_id,
      nome: req.usuario.nome,
      role: req.usuario.role,
      categoria: u ? u.categoria : categoriaDe(req.usuario),
      empresa: u ? u.empresa : null
    })
  } catch (err) {
    return erroInterno(req, res, err, 'Erro ao buscar o usuário.')
  }
})

// ---------- EMPRESA (equipe e código) ----------

function gerarCodigoEmpresa() {
  return crypto.randomBytes(6).toString('hex').toUpperCase() // 12 caracteres, imprevisível
}

// O Superior vê o código que passa para a equipe
router.get('/organizacao', ...exigirEmpresa, exigirCategoria(['superior'], 'Só o Superior vê o código da empresa.'), async (req, res) => {
  try {
    const [[org]] = await db.query(
      'SELECT id, nome, codigo_convite FROM organizacoes WHERE id = ?',
      [req.organizacaoId]
    )
    if (!org) return res.status(404).json({ mensagem: 'Empresa não encontrada.' })
    logar(req, 'codigo_empresa_consultado')
    res.json({ id: org.id, nome: org.nome, codigo: org.codigo_convite })
  } catch (err) {
    return erroInterno(req, res, err, 'Erro ao buscar a empresa.')
  }
})

// Renovar invalida o código antigo na hora
router.post('/organizacao/codigo', ...exigirEmpresa, exigirCategoria(['superior'], 'Só o Superior renova o código da empresa.'), limitadorEscrita, async (req, res) => {
  try {
    const codigo = gerarCodigoEmpresa()
    await db.query('UPDATE organizacoes SET codigo_convite = ? WHERE id = ?', [codigo, req.organizacaoId])
    logar(req, 'codigo_empresa_renovado')
    res.json({ codigo })
  } catch (err) {
    return erroInterno(req, res, err, 'Erro ao renovar o código.')
  }
})

// ---------- PROXY PRO AUTH-SERVICE ----------

// Cadastro com empresa:
//  - Superior: cria a empresa (nome único) e vira o dono dela.
//  - Demais categorias: informam nome E código da empresa. Nome ou código errado responde igual (403).
// A empresa vem sempre daqui, nunca do cliente: o organizacao_id enviado pelo front é descartado.
router.post('/auth/cadastro', limitadorCadastro, async (req, res) => {
  const empresa = String(req.body.empresa || '').trim()
  const codigo = String(req.body.codigo_empresa || '').trim().toUpperCase()
  const categoria = String(req.body.categoria || '').trim().toLowerCase()
  const email = String(req.body.email || '').trim().toLowerCase()

  if (!empresa || empresa.length > 150) {
    return res.status(400).json({ mensagem: 'Informe o nome da empresa (até 150 caracteres).' })
  }
  if (!CATEGORIAS.includes(categoria)) {
    return res.status(400).json({ mensagem: 'Escolha uma categoria válida.' })
  }
  if (!email) {
    return res.status(400).json({ mensagem: 'Informe o e-mail.' })
  }

  let organizacaoId = null
  let criouEmpresa = false

  // desfaz a empresa recém-criada se o cadastro não se completar (só se ninguém entrou nela)
  async function desfazerEmpresa() {
    if (!criouEmpresa) return
    try {
      await db.query(
        'DELETE FROM organizacoes WHERE id = ? AND id NOT IN (SELECT organizacao_id FROM usuarios WHERE organizacao_id IS NOT NULL)',
        [organizacaoId]
      )
    } catch (err) {
      console.error('Falha ao desfazer a empresa:', err.message)
    }
  }

  try {
    if (categoria === 'superior') {
      try {
        const [r] = await db.query(
          'INSERT INTO organizacoes (nome, codigo_convite) VALUES (?, ?)',
          [empresa, gerarCodigoEmpresa()]
        )
        organizacaoId = r.insertId
        criouEmpresa = true
      } catch (err) {
        if (err.code === 'ER_DUP_ENTRY') {
          registrarEvento({ usuario_id: null, acao: 'cadastro_recusado', ip_origem: req.ip, detalhe: 'motivo=empresa_ja_existe categoria=superior' })
          return res.status(409).json({ mensagem: 'Já existe uma empresa com esse nome.' })
        }
        throw err
      }
    } else {
      const [[org]] = codigo
        ? await db.query('SELECT id FROM organizacoes WHERE nome = ? AND codigo_convite = ?', [empresa, codigo])
        : [[null]]
      if (!org) {
        registrarEvento({ usuario_id: null, acao: 'cadastro_recusado', ip_origem: req.ip, detalhe: `motivo=empresa_ou_codigo_invalidos categoria=${categoria}` })
        return res.status(403).json({ mensagem: 'Empresa ou código inválidos.' })
      }
      organizacaoId = org.id
    }

    // o código nunca segue para o auth-service, e o organizacao_id é o que acabamos de decidir
    const corpo = { ...req.body, email, categoria, organizacao_id: organizacaoId }
    delete corpo.codigo_empresa

    let resposta
    try {
      resposta = await fetch(`${AUTH_URL}/cadastro`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-internal-key': INTERNAL_API_KEY, 'x-forwarded-for': req.ip },
        body: JSON.stringify(corpo)
      })
    } catch (err) {
      await desfazerEmpresa()
      return res.status(502).json({ mensagem: 'Serviço de autenticação indisponível.' })
    }
    const dados = await resposta.json().catch(() => ({}))

    if (!resposta.ok) {
      await desfazerEmpresa()
      registrarEvento({ usuario_id: null, acao: 'cadastro_recusado', ip_origem: req.ip, detalhe: `motivo=auth_service status=${resposta.status} categoria=${categoria}` })
      return res.status(resposta.status).json(dados)
    }

    // Garante empresa e categoria no usuário, mesmo que o auth-service ainda não grave esses campos.
    // Só mexe em conta recém-criada (sem empresa, ou já com a empresa certa).
    await db.query(
      'UPDATE usuarios SET organizacao_id = ?, categoria = ? WHERE email = ? AND (organizacao_id IS NULL OR organizacao_id = ?)',
      [organizacaoId, categoria, email, organizacaoId]
    )

    const [[novo]] = await db.query('SELECT id FROM usuarios WHERE email = ?', [email])
    registrarEvento({
      usuario_id: novo ? novo.id : null,
      acao: criouEmpresa ? 'empresa_criada' : 'membro_cadastrado',
      ip_origem: req.ip,
      detalhe: `categoria=${categoria} org=${organizacaoId}`
    })

    res.status(resposta.status).json(dados)
  } catch (err) {
    await desfazerEmpresa()
    return erroInterno(req, res, err, 'Erro ao cadastrar.')
  }
})

router.post('/auth/login', async (req, res) => {
  try {
    const resposta = await fetch(`${AUTH_URL}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': req.ip },
      body: JSON.stringify(req.body)
    })
    const dados = await resposta.json()

    if (!resposta.ok) {
      registrarEvento({ usuario_id: null, acao: 'login_falhou', ip_origem: req.ip, detalhe: `status=${resposta.status}` })
      return res.status(resposta.status).json(dados)
    }

    res.cookie('token', dados.token, OPCOES_COOKIE)
    res.json({ mensagem: 'Login realizado com sucesso.' })

  } catch (err) {
    res.status(502).json({ mensagem: 'Serviço de autenticação indisponível.' })
  }
})

router.post('/auth/logout', (req, res) => {
  // registra quem saiu, mesmo que o token já tenha expirado (a assinatura ainda é conferida)
  try {
    const payload = jwt.verify(req.cookies.token, process.env.JWT_SECRET, { ignoreExpiration: true })
    registrarEvento({ usuario_id: payload.usuario_id, acao: 'logout', ip_origem: req.ip, detalhe: '' })
  } catch (err) { /* sem token válido: só limpa o cookie */ }
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
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': req.ip },
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
// do Professional continua valendo). Os demais usuários apenas consultam. Tudo dentro da própria empresa.

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

// ISOLAMENTO: projeto de outra empresa responde 404, igual a um projeto que não existe
async function carregarProjeto(req, res) {
  const id = Number(req.params.id)
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ mensagem: 'Id inválido.' })
    return null
  }

  const [linhas] = await db.query(
    'SELECT * FROM projetos WHERE id = ? AND organizacao_id = ?',
    [id, req.organizacaoId]
  )
  const projeto = linhas[0]

  if (!projeto) {
    await registrarOutraEmpresa(req, 'projetos', id)
    res.status(404).json({ mensagem: 'Projeto não encontrado.' })
    return null
  }

  const souDono = (projeto.criado_por === req.usuario.usuario_id || ehAdmin(req))
  return { projeto, souDono }
}

router.post('/projetos', ...exigirEmpresa, exigirCategoria(['superior'], 'Só o Superior pode cadastrar projetos.'), limitadorEscrita, async (req, res) => {
  const campos = lerCamposProjeto(req.body)
  if (campos.erro) return res.status(400).json({ mensagem: campos.erro })

  try {
    const pode = await dentroDoLimite(req, res, 'projetos_ativos', async () => {
      const [[{ total }]] = await db.query(
        "SELECT COUNT(*) AS total FROM projetos WHERE criado_por = ? AND organizacao_id = ? AND status = 'ativo'",
        [req.usuario.usuario_id, req.organizacaoId]
      )
      return total
    })
    if (!pode) return

    const [resultado] = await db.query(
      'INSERT INTO projetos (nome, descricao, prazo_dias, criado_por, organizacao_id) VALUES (?, ?, ?, ?, ?)',
      [campos.nome, campos.descricao, campos.prazo, req.usuario.usuario_id, req.organizacaoId]
    )

    logar(req, 'projeto_criado', `projeto_id=${resultado.insertId}`)

    res.status(201).json({ id: resultado.insertId })
  } catch (err) {
    return erroInterno(req, res, err, 'Erro ao cadastrar projeto.')
  }
})

router.get('/projetos', ...exigirEmpresa, async (req, res) => {
  try {
    const campos = `p.id, p.nome, p.descricao, p.prazo_dias, p.status, p.criado_em,
      p.criado_por = ? AS sou_dono,
      (SELECT COUNT(*) FROM demandas d
        WHERE d.projeto_id = p.id AND d.organizacao_id = p.organizacao_id AND d.excluida_em IS NULL) AS total_demandas`

    const [linhas] = await db.query(
      `SELECT ${campos} FROM projetos p WHERE p.organizacao_id = ? ORDER BY p.id DESC`,
      [req.usuario.usuario_id, req.organizacaoId]
    )
    res.json(linhas.map(l => ({ ...l, sou_dono: Boolean(l.sou_dono) })))
  } catch (err) {
    return erroInterno(req, res, err, 'Erro ao buscar projetos.')
  }
})

router.get('/projetos/:id', ...exigirEmpresa, async (req, res) => {
  try {
    const acesso = await carregarProjeto(req, res)
    if (!acesso) return
    const { projeto, souDono } = acesso

    // Demandas excluídas não aparecem aqui: elas ficam na aba Excluídas do Planejador
    const [demandas] = await db.query(
      `SELECT id, rg, nome_material, quantidade, etapa_atual, planejador_id
         FROM demandas
        WHERE projeto_id = ? AND organizacao_id = ? AND excluida_em IS NULL
        ORDER BY FIELD(etapa_atual, 'almoxarifado', 'operacao', 'montagem', 'finalizada'), id`,
      [projeto.id, req.organizacaoId]
    )

    // Aba Excluídas: só o Planejador vê, e só as que ele mesmo excluiu neste projeto
    let excluidas = []
    if (categoriaDe(req.usuario) === 'planejador') {
      ;[excluidas] = await db.query(
        `SELECT id, rg, nome_material, quantidade, etapa_atual, planejador_id, excluida_em
           FROM demandas
          WHERE projeto_id = ? AND organizacao_id = ? AND planejador_id = ? AND excluida_em IS NOT NULL
          ORDER BY excluida_em DESC, id DESC`,
        [projeto.id, req.organizacaoId, req.usuario.usuario_id]
      )
    }

    res.json({ projeto, sou_dono: souDono, demandas, excluidas })
  } catch (err) {
    return erroInterno(req, res, err, 'Erro ao buscar projeto.')
  }
})

router.put('/projetos/:id', ...exigirEmpresa, exigirCategoria(['superior'], 'Só o Superior pode editar projetos.'), limitadorEscrita, async (req, res) => {
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
      'UPDATE projetos SET nome = ?, descricao = ?, prazo_dias = ? WHERE id = ? AND organizacao_id = ?',
      [campos.nome, campos.descricao, campos.prazo, acesso.projeto.id, req.organizacaoId]
    )

    logar(req, 'projeto_editado', `projeto_id=${acesso.projeto.id}`)

    res.json({ mensagem: 'Projeto atualizado.' })
  } catch (err) {
    return erroInterno(req, res, err, 'Erro ao editar projeto.')
  }
})

// Demandas que a Montagem ainda não concluiu (as excluídas não contam)
async function contarPendentes(projetoId, organizacaoId) {
  const [[{ total }]] = await db.query(
    "SELECT COUNT(*) AS total FROM demandas WHERE projeto_id = ? AND organizacao_id = ? AND etapa_atual <> 'finalizada' AND excluida_em IS NULL",
    [projetoId, organizacaoId]
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
router.delete('/projetos/:id', ...exigirEmpresa, exigirCategoria(['superior'], 'Só o Superior pode excluir projetos.'), limitadorEscrita, async (req, res) => {
  try {
    const acesso = await carregarProjeto(req, res)
    if (!acesso) return
    if (!acesso.souDono) {
      return res.status(403).json({ mensagem: 'Só quem criou o projeto pode excluí-lo.' })
    }

    const pendentes = await contarPendentes(acesso.projeto.id, req.organizacaoId)
    if (pendentes > 0 && req.query.confirmar !== '1') return responderPendentes(res, pendentes)

    await db.query('DELETE FROM projetos WHERE id = ? AND organizacao_id = ?', [acesso.projeto.id, req.organizacaoId])

    logar(req, 'projeto_excluido', `projeto_id=${acesso.projeto.id} pendentes=${pendentes}`)

    res.json({ mensagem: 'Projeto excluído.' })
  } catch (err) {
    return erroInterno(req, res, err, 'Erro ao excluir projeto.')
  }
})

// Concluir o projeto não pede mais o número de funcionários. Com demandas não concluídas pela Montagem,
// só segue com ?confirmar=1; elas são encerradas (finalizada) sem passar pela Montagem e sem finalizado_em,
// para não entrar na "demanda do mês" da previsão.
router.patch('/projetos/:id/concluir', ...exigirEmpresa, exigirCategoria(['superior'], 'Só o Superior pode concluir projetos.'), limitadorEscrita, async (req, res) => {
  try {
    const acesso = await carregarProjeto(req, res)
    if (!acesso) return
    if (!acesso.souDono) {
      return res.status(403).json({ mensagem: 'Só quem criou o projeto pode concluí-lo.' })
    }
    if (acesso.projeto.status === 'concluido') {
      return res.status(409).json({ mensagem: 'Esse projeto já está concluído.' })
    }

    const pendentes = await contarPendentes(acesso.projeto.id, req.organizacaoId)
    if (pendentes > 0 && req.query.confirmar !== '1') return responderPendentes(res, pendentes)

    await db.query(
      "UPDATE projetos SET status = 'concluido', concluido_em = NOW() WHERE id = ? AND organizacao_id = ?",
      [acesso.projeto.id, req.organizacaoId]
    )
    await db.query(
      "UPDATE demandas SET etapa_atual = 'finalizada' WHERE projeto_id = ? AND organizacao_id = ? AND etapa_atual <> 'finalizada' AND excluida_em IS NULL",
      [acesso.projeto.id, req.organizacaoId]
    )

    logar(req, 'projeto_concluido', `projeto_id=${acesso.projeto.id} pendentes_encerradas=${pendentes}`)

    res.json({ mensagem: 'Projeto concluído.' })
  } catch (err) {
    return erroInterno(req, res, err, 'Erro ao concluir projeto.')
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

router.post('/projetos/:id/demandas', ...exigirEmpresa, exigirCategoria(['planejador'], 'Só o Planejador pode cadastrar demandas.'), limitadorEscrita, async (req, res) => {
  const campos = validarCamposDemanda(req.body, ETAPA_INICIAL)
  if (campos.erro) return res.status(400).json({ mensagem: campos.erro })

  try {
    // o projeto já vem filtrado pela empresa (404 se for de outra)
    const acesso = await carregarProjeto(req, res)
    if (!acesso) return

    if (acesso.projeto.status !== 'ativo') {
      return res.status(409).json({ mensagem: 'Esse projeto já foi concluído.' })
    }

    const pode = await dentroDoLimite(req, res, 'demandas_abertas', async () => {
      const [[{ total }]] = await db.query(
        "SELECT COUNT(*) AS total FROM demandas WHERE planejador_id = ? AND organizacao_id = ? AND etapa_atual <> 'finalizada' AND excluida_em IS NULL",
        [req.usuario.usuario_id, req.organizacaoId]
      )
      return total
    })
    if (!pode) return

    const [resultado] = await db.query(
      `INSERT INTO demandas (projeto_id, organizacao_id, rg, nome_material, quantidade, etapa_atual, planejador_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [acesso.projeto.id, req.organizacaoId, campos.rg, campos.nome_material, campos.quantidade, campos.etapa, req.usuario.usuario_id]
    )

    logar(req, 'demanda_criada', `demanda_id=${resultado.insertId} etapa=${campos.etapa}`)

    res.status(201).json({ id: resultado.insertId })
  } catch (err) {
    return erroInterno(req, res, err, 'Erro ao cadastrar demanda.')
  }
})

// Fila de produção: só Almoxarife, Operador e Montador têm fila (a da própria etapa), da própria empresa.
// Planejador e Superior não usam esta lista: devolve vazio (eles trabalham pela página do projeto).
router.get('/demandas', ...exigirEmpresa, async (req, res) => {
  try {
    const etapa = ETAPA_DA_CATEGORIA[categoriaDe(req.usuario)]
    if (!etapa) return res.json([])

    const [linhas] = await db.query(
      `SELECT d.id, d.projeto_id, d.rg, d.nome_material, d.quantidade, d.etapa_atual, d.planejador_id,
              p.nome AS projeto_nome
         FROM demandas d JOIN projetos p ON p.id = d.projeto_id AND p.organizacao_id = d.organizacao_id
        WHERE d.organizacao_id = ? AND d.etapa_atual = ? AND d.excluida_em IS NULL
        ORDER BY d.id`,
      [req.organizacaoId, etapa]
    )
    res.json(linhas)
  } catch (err) {
    return erroInterno(req, res, err, 'Erro ao buscar a fila de produção.')
  }
})

// Carrega a demanda e já responde 400/404/403/409 quando não dá para seguir (devolve null nesses casos).
// Demanda de outra empresa responde 404. Só o Planejador que criou a demanda pode alterá-la;
// demandas excluídas ou finalizadas não mudam.
async function carregarDemandaGerenciavel(req, res) {
  const id = Number(req.params.id)
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ mensagem: 'Id inválido.' })
    return null
  }

  const [linhas] = await db.query(
    'SELECT id, etapa_atual, planejador_id FROM demandas WHERE id = ? AND organizacao_id = ? AND excluida_em IS NULL',
    [id, req.organizacaoId]
  )
  const demanda = linhas[0]
  if (!demanda) {
    await registrarOutraEmpresa(req, 'demandas', id)
    res.status(404).json({ mensagem: 'Demanda não encontrada.' })
    return null
  }

  if (categoriaDe(req.usuario) !== 'planejador' || demanda.planejador_id !== req.usuario.usuario_id) {
    logar(req, 'acesso_negado', `rota=${req.method} ${req.originalUrl} categoria_atual=${categoriaDe(req.usuario)}`)
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
router.put('/demandas/:id', ...exigirEmpresa, limitadorEscrita, async (req, res) => {
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
        WHERE id = ? AND organizacao_id = ? AND excluida_em IS NULL`,
      [campos.rg, campos.nome_material, campos.quantidade, etapa, demanda.id, req.organizacaoId]
    )

    logar(req, 'demanda_editada', `demanda_id=${demanda.id} etapa=${etapa}`)
    if (etapa !== demanda.etapa_atual) {
      logar(req, 'demanda_redirecionada', `demanda_id=${demanda.id} de=${demanda.etapa_atual} para=${etapa}`)
    }

    res.json({ mensagem: 'Demanda atualizada.' })
  } catch (err) {
    return erroInterno(req, res, err, 'Erro ao editar demanda.')
  }
})

// "Excluir" move a demanda para a aba Excluídas (exclusão lógica): ela sai da fila, do projeto e das contagens.
router.delete('/demandas/:id', ...exigirEmpresa, limitadorEscrita, async (req, res) => {
  try {
    const demanda = await carregarDemandaGerenciavel(req, res)
    if (!demanda) return

    await db.query(
      'UPDATE demandas SET excluida_em = NOW(), excluida_por = ? WHERE id = ? AND organizacao_id = ? AND excluida_em IS NULL',
      [req.usuario.usuario_id, demanda.id, req.organizacaoId]
    )

    logar(req, 'demanda_excluida', `demanda_id=${demanda.id}`)

    res.json({ mensagem: 'Demanda movida para Excluídas.' })
  } catch (err) {
    return erroInterno(req, res, err, 'Erro ao excluir demanda.')
  }
})

router.patch('/demandas/:id/avancar', ...exigirEmpresa, limitadorEscrita, async (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ mensagem: 'Id inválido.' })
  }

  try {
    const [linhas] = await db.query(
      'SELECT id, etapa_atual FROM demandas WHERE id = ? AND organizacao_id = ? AND excluida_em IS NULL',
      [id, req.organizacaoId]
    )
    const demanda = linhas[0]
    if (!demanda) {
      await registrarOutraEmpresa(req, 'demandas', id)
      return res.status(404).json({ mensagem: 'Demanda não encontrada.' })
    }

    const regra = TRANSICAO[demanda.etapa_atual]
    if (!regra) {
      return res.status(409).json({ mensagem: 'Essa demanda já está finalizada.' })
    }
    if (categoriaDe(req.usuario) !== regra.categoria) {
      logar(req, 'acesso_negado', `rota=${req.method} ${req.originalUrl} categoria_atual=${categoriaDe(req.usuario)} categoria_exigida=${regra.categoria}`)
      return res.status(403).json({ mensagem: 'Sua categoria não permite avançar esta demanda no estado atual.' })
    }

    const finalizando = regra.proxima === 'finalizada'
    const [atualizacao] = await db.query(
      `UPDATE demandas SET etapa_atual = ?, ${regra.campo} = ?${finalizando ? ', finalizado_em = NOW()' : ''}
        WHERE id = ? AND organizacao_id = ? AND etapa_atual = ? AND excluida_em IS NULL`,
      [regra.proxima, req.usuario.usuario_id, id, req.organizacaoId, demanda.etapa_atual]
    )
    if (atualizacao.affectedRows === 0) {
      return res.status(409).json({ mensagem: 'Essa demanda já foi movida por outra pessoa. Atualize a página.' })
    }

    logar(req, 'demanda_avancada', `demanda_id=${id} de=${demanda.etapa_atual} para=${regra.proxima}`)
    if (finalizando) {
      logar(req, 'demanda_concluida', `demanda_id=${id}`)
    }

    res.json({ mensagem: 'Demanda avançou para: ' + regra.proxima })
  } catch (err) {
    return erroInterno(req, res, err, 'Erro ao avançar a demanda.')
  }
})

// ---------- INDICADORES ----------
// Indicadores (plano Expert): demandas por processo e concluídas x pendentes, SEMPRE da própria empresa
// (nem o admin escapa do filtro). Demandas excluídas não contam.
// "Pendentes" = as que ainda estão em algum processo (não finalizadas).
const PROCESSOS_INDICADORES = [
  { processo: 'almoxarifado', rotulo: 'Almoxarifado' },
  { processo: 'operacao', rotulo: 'Operação' },
  { processo: 'montagem', rotulo: 'Montagem' }
]

router.get('/indicadores', ...exigirEmpresa, exigirNivel('expert'), async (req, res) => {
  try {
    const [porEtapa] = await db.query(
      `SELECT d.etapa_atual AS etapa, COUNT(*) AS total
         FROM demandas d
        WHERE d.organizacao_id = ? AND d.excluida_em IS NULL
        GROUP BY d.etapa_atual`,
      [req.organizacaoId]
    )
    const contagem = {}
    porEtapa.forEach(l => { contagem[l.etapa] = Number(l.total) })

    logar(req, 'indicadores_consultados')

    const por_processo = PROCESSOS_INDICADORES.map(p => ({ ...p, total: contagem[p.processo] || 0 }))
    const concluidas = contagem.finalizada || 0
    const pendentes = por_processo.reduce((soma, p) => soma + p.total, 0)

    const [[projetos]] = await db.query(
      `SELECT SUM(p.status = 'ativo') AS ativos, SUM(p.status = 'concluido') AS concluidos
         FROM projetos p WHERE p.organizacao_id = ?`,
      [req.organizacaoId]
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
    return erroInterno(req, res, err, 'Erro ao calcular indicadores.')
  }
})

// ---------- REGRESSÃO (previsão de equipe) ----------
// O modelo é guardado por usuário; a conta precisa ter empresa para usar.

const ANALISE = '/analise/previsao-equipe'
const uploadCsv = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 } })
const soExpert = [...exigirEmpresa, exigirNivel('expert')]

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
  if (r.status === 200) logar(req, 'csv_previsualizado', `arquivo=${String(req.file.originalname).slice(0, 80)}`)
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
    logar(req, 'modelo_treinado', `alvo=${req.body.alvo} entradas=${entradas.length} linhas=${r.dados.n_linhas}`)
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
    logar(req, 'previsao_consultada', `funcionarios=${r.dados.funcionarios}`)
  }
  res.status(r.status).json(r.dados)
})

router.delete(`${ANALISE}/modelo`, ...soExpert, limitadorEscrita, async (req, res) => {
  const r = await chamarRegressao('DELETE', `/modelo?usuario_id=${req.usuario.usuario_id}`)
  if (r.status === 200) logar(req, 'modelo_descartado')
  res.status(r.status).json(r.dados)
})

// ---------- PAGAMENTOS ----------

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
    if (resposta.ok) logar(req, 'checkout_iniciado', `plano=${String(req.body.plano).slice(0, 30)}`)
    res.status(resposta.status).json(dados)
  } catch (err) {
    console.error(err)
    res.status(502).json({ mensagem: 'Serviço de pagamentos indisponível.' })
  }
})

// Estado da assinatura do próprio usuário (cópia mantida pelos webhooks): a tela de Planos usa para
// avisar de cobrança recusada ou de cancelamento agendado e para mostrar o botão "Gerenciar assinatura".
router.get('/assinatura', exigirLogin, async (req, res) => {
  try {
    const resposta = await fetch(`${PAGAMENTOS_URL}/status?usuario_id=${req.usuario.usuario_id}`, {
      headers: { 'x-internal-key': INTERNAL_API_KEY }
    })
    const dados = await resposta.json()
    res.status(resposta.status).json(dados)
  } catch (err) {
    console.error(err)
    res.status(502).json({ mensagem: 'Serviço de pagamentos indisponível.' })
  }
})

// Portal do cliente (Billing Portal do Stripe): troca de plano e cancelamento. O app só abre o caminho;
// quem muda o plano no banco é o webhook.
router.post('/assinatura/portal', exigirLogin, limitadorEscrita, async (req, res) => {
  try {
    const resposta = await fetch(`${PAGAMENTOS_URL}/portal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-key': INTERNAL_API_KEY },
      body: JSON.stringify({ usuario_id: req.usuario.usuario_id, ip: req.ip })
    })
    const dados = await resposta.json()
    res.status(resposta.status).json(dados)
  } catch (err) {
    console.error(err)
    res.status(502).json({ mensagem: 'Serviço de pagamentos indisponível.' })
  }
})

// Painel admin: usuários por plano, assinaturas ativas e MRR de teste (só o papel admin).
// É um resumo do PRODUTO inteiro, de propósito: o admin é o administrador do produto, não de uma empresa.
router.get('/admin/resumo', exigirLogin, exigirNivel('admin'), async (req, res) => {
  try {
    const resposta = await fetch(`${PAGAMENTOS_URL}/admin/resumo`, {
      headers: { 'x-internal-key': INTERNAL_API_KEY }
    })
    const dados = await resposta.json()
    if (resposta.ok) logar(req, 'painel_admin_consultado')
    res.status(resposta.status).json(dados)
  } catch (err) {
    console.error(err)
    res.status(502).json({ mensagem: 'Serviço de pagamentos indisponível.' })
  }
})

// ---------- LOGS (só admin do produto) ----------

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

// ---------- PERFIL ----------
// Só se vê o perfil (e a foto) de quem é da MESMA empresa. Outra empresa responde 404.

function sincronizarNome(usuarioId, nome) {
  fetch(`${PROFILE_URL}/perfis/${usuarioId}/nome`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nome })
  }).catch(err => console.error('Falha ao sincronizar nome no profile-service:', err.message))
}

async function mesmaEmpresa(req, usuarioId) {
  const id = Number(usuarioId)
  if (!Number.isInteger(id) || id <= 0) return false
  const [[u]] = await db.query(
    'SELECT id FROM usuarios WHERE id = ? AND organizacao_id = ?',
    [id, req.organizacaoId]
  )
  return Boolean(u)
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

router.get('/perfil/:usuario_id', ...exigirEmpresa, async (req, res) => {
  try {
    if (!(await mesmaEmpresa(req, req.params.usuario_id))) {
      await registrarOutraEmpresa(req, 'usuarios', req.params.usuario_id)
      return res.status(404).json({ mensagem: 'Perfil não encontrado.' })
    }
    const usuarioId = Number(req.params.usuario_id)

    const respostaPerfil = await fetch(`${PROFILE_URL}/perfis/${usuarioId}`).then(r => r.json())

    res.json({
      usuario_id: usuarioId,
      nome: respostaPerfil.nome,
      bio: respostaPerfil.bio,
      foto_url: respostaPerfil.temFoto ? `/api/perfil/${usuarioId}/foto` : null,
      eh_proprio_perfil: usuarioId === req.usuario.usuario_id
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
    if (resposta.ok) logar(req, 'perfil_atualizado')
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

    logar(req, 'foto_atualizada', `tamanho_bytes=${req.file.size}`)
    res.json({ ok: true, foto_url: `/api/perfil/${req.usuario.usuario_id}/foto` })
  } catch (err) {
    console.error(err)
    res.status(502).json({ mensagem: 'Serviço de perfil indisponível.' })
  }
})

router.get('/perfil/:usuario_id/foto', ...exigirEmpresa, async (req, res) => {
  try {
    if (!(await mesmaEmpresa(req, req.params.usuario_id))) {
      await registrarOutraEmpresa(req, 'usuarios', req.params.usuario_id)
      return res.status(404).end()
    }
    const usuarioId = Number(req.params.usuario_id)

    const resposta = await fetch(`${PROFILE_URL}/perfis/${usuarioId}/foto-arquivo`)

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