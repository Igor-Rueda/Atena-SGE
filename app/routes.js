const express = require('express')
const jwt = require('jsonwebtoken')
const rateLimit = require('express-rate-limit')
const multer = require('multer')
const { Readable } = require('stream')
const db = require('./db')
const { registrarEvento } = require('./logClient') // LOG: helper de auditoria

const router = express.Router()

const AUTH_URL = process.env.AUTH_SERVICE_URL
const LOG_URL = process.env.LOG_SERVICE_URL // LOG: usado só na rota de consulta (proxy)
const PROFILE_URL = process.env.PROFILE_SERVICE_URL // PERFIL: profile-service (rede interna)
const PAGAMENTOS_URL = process.env.PAGAMENTOS_SERVICE_URL // PAGAMENTOS: pagamentos (rede interna)
const REGRESSAO_URL = process.env.REGRESSAO_SERVICE_URL // REGRESSÃO: previsão de equipe (rede interna)
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY // segredo das rotas internas
const TAMANHO_MAXIMO_MB = Number(process.env.PROFILE_IMAGE_MAX_SIZE_MB || 5)

// Hierarquia cumulativa: cada papel faz o que o anterior faz.
//   professional: plano gratuito (cadastra e vê as próprias demandas, com limites de uso)
//   expert:       plano pago (indicadores, previsão de equipe, exclusão de demandas, sem limites)
//   admin:        administrador do produto, usado para testar rotas; não é vendável
const HIERARQUIA = ['professional', 'expert', 'admin']

const ATIVIDADES = ['montagem', 'almoxarifado', 'usinagem']
const STATUS_DEMANDA = ['aberta', 'em_andamento', 'concluida']

// Limites do plano gratuito. Só contam o que está ATIVO: projeto concluído e demanda
// concluída saem da contagem (e continuam alimentando a regressão). Expert e admin: sem limite.
const LIMITES = {
  professional: { projetos_ativos: 3, itens_por_projeto: 50, demandas_abertas: 20 }
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

// PERFIL: só o dono edita o próprio perfil. Compara o :usuario_id da URL com o
// usuario_id do JWT (nunca confia no que veio do cliente).
function exigirProprioPerfil(req, res, next) {
  if (String(req.params.usuario_id) !== String(req.usuario.usuario_id)) {
    registrarEvento({
      usuario_id: req.usuario.usuario_id,
      acao: 'acesso_negado',
      ip_origem: req.ip,
      detalhe: `rota=${req.method} ${req.originalUrl} tentou_editar_usuario_id=${req.params.usuario_id}`
    })
    return res.status(403).json({ mensagem: 'Você só pode editar o seu próprio perfil.' })
  }
  next()
}

// Confere o limite do plano. Devolve true se pode seguir; se estourou, já responde 403
// (com codigo "limite_plano", que o front usa para abrir o modal de upgrade) e devolve false.
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
  message: { mensagem: 'Muitas requisições. Aguarde um momento.' },
  standardHeaders: true,
  legacyHeaders: false
})

// mesmas opções do cookie de login, reaproveitadas na renovação do token após o pagamento
const OPCOES_COOKIE = {
  httpOnly: true,
  secure: true,
  sameSite: 'strict',
  maxAge: 1 * 15 * 60 * 1000
}

// a página de sucesso consulta /auth/renovar em loop curto enquanto espera o webhook:
// limite próprio, mais folgado que o de escrita
const limitadorRenovar = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { mensagem: 'Muitas requisições. Aguarde um momento.' },
  standardHeaders: true,
  legacyHeaders: false
})

const uploadFoto = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: TAMANHO_MAXIMO_MB * 1024 * 1024 }
})

// ---------- USUÁRIO LOGADO ----------

router.get('/me', exigirLogin, (req, res) => {
  res.json({
    usuario_id: req.usuario.usuario_id,
    nome: req.usuario.nome,
    role: req.usuario.role
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
    console.error(err)
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
    console.error(err)
    res.status(502).json({ mensagem: 'Serviço de autenticação indisponível.' })
  }
})

router.post('/auth/logout', (req, res) => {
  const token = req.cookies.token
  let usuarioId = null

  if (token) {
    const payload = jwt.decode(token)
    usuarioId = payload && payload.usuario_id != null ? payload.usuario_id : null
  }

  registrarEvento({
    usuario_id: usuarioId,
    acao: 'logout',
    ip_origem: req.ip
  })

  res.clearCookie('token')
  res.json({ mensagem: 'Logout realizado.' })
})

// ASSINATURA: reemite o JWT com o papel ATUAL do banco (útil logo após o pagamento, quando o
// token antigo ainda carrega o papel velho). A identidade vem do JWT validado, nunca do cliente.
router.post('/auth/renovar', exigirLogin, limitadorRenovar, async (req, res) => {
  try {
    const resposta = await fetch(`${AUTH_URL}/internos/usuarios/${req.usuario.usuario_id}/token`, {
      method: 'POST',
      headers: { 'x-internal-key': INTERNAL_API_KEY }
    })
    if (!resposta.ok) {
      throw new Error(`auth-service respondeu ${resposta.status} ao reemitir token`)
    }
    const dados = await resposta.json() // { token, role }
    res.cookie('token', dados.token, OPCOES_COOKIE)
    res.json({ role: dados.role })
  } catch (err) {
    console.error(err)
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
    console.error(err)
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
    console.error(err)
    res.status(502).json({ mensagem: 'Serviço de autenticação indisponível.' })
  }
})

// ---------- PROCESSOS ----------

router.get('/processos', exigirLogin, async (req, res) => {
  try {
    const [linhas] = ehAdmin(req)
      ? await db.query('SELECT * FROM processos ORDER BY id DESC')
      : await db.query('SELECT * FROM processos WHERE criado_por = ? ORDER BY id DESC', [req.usuario.usuario_id])
    res.json(linhas)
  } catch (err) {
    console.error(err)
    res.status(500).json({ mensagem: 'Erro ao buscar processos.' })
  }
})

router.post('/processos', exigirLogin, limitadorEscrita, async (req, res) => {
  const nome = String(req.body.nome || '').trim()
  const atividade = req.body.atividade

  if (!nome || nome.length > 150 || !ATIVIDADES.includes(atividade)) {
    return res.status(400).json({ mensagem: 'Informe o nome e a atividade (montagem, almoxarifado ou usinagem).' })
  }

  try {
    const [resultado] = await db.query(
      'INSERT INTO processos (nome, atividade, criado_por) VALUES (?, ?, ?)',
      [nome, atividade, req.usuario.usuario_id]
    )
    res.status(201).json({ id: resultado.insertId })
  } catch (err) {
    console.error(err)
    res.status(500).json({ mensagem: 'Erro ao cadastrar processo.' })
  }
})

// ---------- PROJETOS ----------

// Carrega o projeto e confere o acesso. Dono (criador) e admin enxergam tudo; quem só é
// responsável por alguma demanda do projeto enxerga o projeto, os itens e as próprias demandas.
// Sem acesso responde 404 (não revela que o projeto existe).
async function carregarProjeto(req, res) {
  const id = Number(req.params.id)
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ mensagem: 'Id inválido.' })
    return null
  }

  const [linhas] = await db.query('SELECT * FROM projetos WHERE id = ?', [id])
  const projeto = linhas[0]
  const souDono = Boolean(projeto) && (projeto.criado_por === req.usuario.usuario_id || ehAdmin(req))

  if (projeto && !souDono) {
    const [resp] = await db.query(
      'SELECT 1 FROM demandas WHERE projeto_id = ? AND responsavel_id = ? LIMIT 1',
      [id, req.usuario.usuario_id]
    )
    if (resp.length === 0) {
      res.status(404).json({ mensagem: 'Projeto não encontrado.' })
      return null
    }
  }
  if (!projeto) {
    res.status(404).json({ mensagem: 'Projeto não encontrado.' })
    return null
  }
  return { projeto, souDono }
}

router.post('/projetos', exigirLogin, limitadorEscrita, async (req, res) => {
  const nome = String(req.body.nome || '').trim()
  const descricao = String(req.body.descricao || '').trim() || null
  const prazo = req.body.prazo_dias === undefined || req.body.prazo_dias === '' ? null : Number(req.body.prazo_dias)

  if (!nome || nome.length > 150) {
    return res.status(400).json({ mensagem: 'Informe o nome do projeto (até 150 caracteres).' })
  }
  if (prazo !== null && (!Number.isInteger(prazo) || prazo <= 0)) {
    return res.status(400).json({ mensagem: 'O prazo precisa ser um número inteiro de dias.' })
  }

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
      [nome, descricao, prazo, req.usuario.usuario_id]
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
      (SELECT COUNT(*) FROM itens i WHERE i.projeto_id = p.id) AS total_itens`
    const [linhas] = ehAdmin(req)
      ? await db.query(`SELECT ${campos} FROM projetos p ORDER BY p.id DESC`, [req.usuario.usuario_id])
      : await db.query(
          `SELECT ${campos} FROM projetos p
           WHERE p.criado_por = ?
              OR EXISTS (SELECT 1 FROM demandas d WHERE d.projeto_id = p.id AND d.responsavel_id = ?)
           ORDER BY p.id DESC`,
          [req.usuario.usuario_id, req.usuario.usuario_id, req.usuario.usuario_id]
        )
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

    const [itens] = await db.query('SELECT id, rg, nome, quantidade FROM itens WHERE projeto_id = ? ORDER BY id', [projeto.id])

    // dono e admin veem todas as demandas do projeto; o responsável vê só as dele
    const baseDemandas = `SELECT d.id, d.atividade, d.descricao, d.status, d.responsavel_id, u.nome AS responsavel_nome
       FROM demandas d JOIN usuarios u ON u.id = d.responsavel_id WHERE d.projeto_id = ?`
    const [demandas] = souDono
      ? await db.query(`${baseDemandas} ORDER BY d.id`, [projeto.id])
      : await db.query(`${baseDemandas} AND d.responsavel_id = ? ORDER BY d.id`, [projeto.id, req.usuario.usuario_id])

    res.json({ projeto, sou_dono: souDono, itens, demandas })
  } catch (err) {
    console.error(err)
    res.status(500).json({ mensagem: 'Erro ao buscar projeto.' })
  }
})

router.post('/projetos/:id/itens', exigirLogin, limitadorEscrita, async (req, res) => {
  const rg = String(req.body.rg || '').trim()
  const nome = String(req.body.nome || '').trim()
  const quantidade = Number(req.body.quantidade)

  if (!rg || rg.length > 50 || !nome || nome.length > 150 || !Number.isInteger(quantidade) || quantidade < 1) {
    return res.status(400).json({ mensagem: 'Informe RG, nome e uma quantidade inteira maior que zero.' })
  }

  try {
    const acesso = await carregarProjeto(req, res)
    if (!acesso) return
    if (!acesso.souDono) {
      return res.status(403).json({ mensagem: 'Só quem criou o projeto cadastra itens.' })
    }

    const pode = await dentroDoLimite(req, res, 'itens_por_projeto', async () => {
      const [[{ total }]] = await db.query('SELECT COUNT(*) AS total FROM itens WHERE projeto_id = ?', [acesso.projeto.id])
      return total
    })
    if (!pode) return

    await db.query(
      'INSERT INTO itens (projeto_id, rg, nome, quantidade) VALUES (?, ?, ?, ?)',
      [acesso.projeto.id, rg, nome, quantidade]
    )

    registrarEvento({
      usuario_id: req.usuario.usuario_id,
      acao: 'item_cadastrado',
      ip_origem: req.ip,
      detalhe: `projeto_id=${acesso.projeto.id} rg=${rg}`
    })

    res.status(201).json({ mensagem: 'Item cadastrado.' })
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ mensagem: 'Já existe um item com esse RG neste projeto.' })
    }
    console.error(err)
    res.status(500).json({ mensagem: 'Erro ao cadastrar item.' })
  }
})

// conclui o projeto e guarda quantos funcionários foram realmente usados:
// é esse valor real que alimenta (e reajusta) a regressão
router.patch('/projetos/:id/concluir', exigirLogin, limitadorEscrita, async (req, res) => {
  const funcionarios = Number(req.body.funcionarios_usados)
  if (!Number.isInteger(funcionarios) || funcionarios < 1 || funcionarios > 10000) {
    return res.status(400).json({ mensagem: 'Informe quantos funcionários foram usados (número inteiro).' })
  }

  try {
    const acesso = await carregarProjeto(req, res)
    if (!acesso) return
    if (!acesso.souDono) {
      return res.status(403).json({ mensagem: 'Só quem criou o projeto pode concluí-lo.' })
    }
    if (acesso.projeto.status === 'concluido') {
      return res.status(409).json({ mensagem: 'Esse projeto já está concluído.' })
    }

    await db.query(
      "UPDATE projetos SET status = 'concluido', funcionarios_usados = ?, concluido_em = NOW() WHERE id = ?",
      [funcionarios, acesso.projeto.id]
    )
    // demandas ainda abertas do projeto saem da contagem do limite
    await db.query("UPDATE demandas SET status = 'concluida' WHERE projeto_id = ? AND status <> 'concluida'", [acesso.projeto.id])

    registrarEvento({
      usuario_id: req.usuario.usuario_id,
      acao: 'projeto_concluido',
      ip_origem: req.ip,
      detalhe: `projeto_id=${acesso.projeto.id} funcionarios_usados=${funcionarios}`
    })

    res.json({ mensagem: 'Projeto concluído.' })
  } catch (err) {
    console.error(err)
    res.status(500).json({ mensagem: 'Erro ao concluir projeto.' })
  }
})

// ---------- DEMANDAS ----------

router.post('/projetos/:id/demandas', exigirLogin, limitadorEscrita, async (req, res) => {
  const atividade = req.body.atividade
  const descricao = String(req.body.descricao || '').trim()
  const email = String(req.body.responsavel_email || '').trim().toLowerCase()
  const processoId = req.body.processo_id ? Number(req.body.processo_id) : null

  if (!ATIVIDADES.includes(atividade) || !descricao || descricao.length > 255) {
    return res.status(400).json({ mensagem: 'Informe a atividade (montagem, almoxarifado ou usinagem) e a descrição.' })
  }

  try {
    const acesso = await carregarProjeto(req, res)
    if (!acesso) return
    if (!acesso.souDono) {
      return res.status(403).json({ mensagem: 'Só quem criou o projeto cria demandas nele.' })
    }
    if (acesso.projeto.status !== 'ativo') {
      return res.status(409).json({ mensagem: 'Esse projeto já foi concluído.' })
    }

    // responsável: por e-mail (para atribuir a outra pessoa) ou o próprio criador
    let responsavelId = req.usuario.usuario_id
    if (email) {
      const [usuarios] = await db.query('SELECT id FROM usuarios WHERE email = ?', [email])
      if (usuarios.length === 0) {
        return res.status(404).json({ mensagem: 'Não existe usuário com esse e-mail. Peça para a pessoa se cadastrar.' })
      }
      responsavelId = usuarios[0].id
    }

    if (processoId !== null) {
      const [proc] = await db.query('SELECT id FROM processos WHERE id = ? AND criado_por = ?', [processoId, req.usuario.usuario_id])
      if (proc.length === 0 && !ehAdmin(req)) {
        return res.status(400).json({ mensagem: 'Processo inválido.' })
      }
    }

    const pode = await dentroDoLimite(req, res, 'demandas_abertas', async () => {
      const [[{ total }]] = await db.query(
        "SELECT COUNT(*) AS total FROM demandas WHERE criado_por = ? AND status <> 'concluida'",
        [req.usuario.usuario_id]
      )
      return total
    })
    if (!pode) return

    const [resultado] = await db.query(
      `INSERT INTO demandas (projeto_id, processo_id, atividade, descricao, responsavel_id, criado_por)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [acesso.projeto.id, processoId, atividade, descricao, responsavelId, req.usuario.usuario_id]
    )

    registrarEvento({
      usuario_id: req.usuario.usuario_id,
      acao: 'demanda_criada',
      ip_origem: req.ip,
      detalhe: `demanda_id=${resultado.insertId} projeto_id=${acesso.projeto.id} atividade=${atividade} responsavel_id=${responsavelId}`
    })

    res.status(201).json({ id: resultado.insertId })
  } catch (err) {
    console.error(err)
    res.status(500).json({ mensagem: 'Erro ao cadastrar demanda.' })
  }
})

// as demandas DO USUÁRIO LOGADO (em que ele é o responsável). Todo papel vê só as próprias;
// o admin pode ver todas com ?todas=1 (útil para testar rotas).
router.get('/demandas', exigirLogin, async (req, res) => {
  try {
    const base = `SELECT d.id, d.projeto_id, p.nome AS projeto_nome, d.atividade, d.descricao, d.status
                  FROM demandas d JOIN projetos p ON p.id = d.projeto_id`
    const [linhas] = ehAdmin(req) && req.query.todas
      ? await db.query(`${base} ORDER BY d.id DESC`)
      : await db.query(`${base} WHERE d.responsavel_id = ? ORDER BY d.id DESC`, [req.usuario.usuario_id])
    res.json(linhas)
  } catch (err) {
    console.error(err)
    res.status(500).json({ mensagem: 'Erro ao buscar demandas.' })
  }
})

// atualiza o andamento: pode o responsável, quem criou a demanda ou o admin
router.patch('/demandas/:id/status', exigirLogin, limitadorEscrita, async (req, res) => {
  const id = Number(req.params.id)
  const status = req.body.status

  if (!Number.isInteger(id) || id <= 0 || !STATUS_DEMANDA.includes(status)) {
    return res.status(400).json({ mensagem: 'Dados inválidos.' })
  }

  try {
    const [linhas] = await db.query('SELECT id, responsavel_id, criado_por FROM demandas WHERE id = ?', [id])
    const demanda = linhas[0]
    const permitido = demanda && (
      demanda.responsavel_id === req.usuario.usuario_id ||
      demanda.criado_por === req.usuario.usuario_id ||
      ehAdmin(req)
    )
    if (!permitido) {
      return res.status(404).json({ mensagem: 'Demanda não encontrada.' })
    }

    await db.query('UPDATE demandas SET status = ? WHERE id = ?', [status, id])

    if (status === 'concluida') {
      registrarEvento({
        usuario_id: req.usuario.usuario_id,
        acao: 'demanda_concluida',
        ip_origem: req.ip,
        detalhe: `demanda_id=${id}`
      })
    }

    res.json({ mensagem: 'Status atualizado.' })
  } catch (err) {
    console.error(err)
    res.status(500).json({ mensagem: 'Erro ao atualizar a demanda.' })
  }
})

// EXCLUIR demanda: só Expert (ou admin). O Expert só exclui demandas de projetos que ele criou.
router.delete('/demandas/:id', exigirLogin, exigirNivel('expert'), limitadorEscrita, async (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ mensagem: 'Id inválido.' })
  }

  try {
    const [linhas] = await db.query(
      'SELECT d.id FROM demandas d JOIN projetos p ON p.id = d.projeto_id WHERE d.id = ? AND (p.criado_por = ? OR ?)',
      [id, req.usuario.usuario_id, ehAdmin(req)]
    )
    if (linhas.length === 0) {
      return res.status(404).json({ mensagem: 'Demanda não encontrada.' })
    }

    await db.query('DELETE FROM demandas WHERE id = ?', [id])

    registrarEvento({
      usuario_id: req.usuario.usuario_id,
      acao: 'demanda_excluida',
      ip_origem: req.ip,
      detalhe: `demanda_id=${id}`
    })

    res.json({ mensagem: 'Demanda excluída.' })
  } catch (err) {
    console.error(err)
    res.status(500).json({ mensagem: 'Erro ao excluir demanda.' })
  }
})

// ---------- INDICADORES (Expert/Admin) ----------
// Escopo: projetos criados pelo próprio usuário (admin enxerga tudo).

router.get('/indicadores', exigirLogin, exigirNivel('expert'), async (req, res) => {
  try {
    const admin = ehAdmin(req)
    const filtro = admin ? '' : 'AND p.criado_por = ?'
    const params = admin ? [] : [req.usuario.usuario_id]

    const [carga] = await db.query(
      `SELECT u.id AS usuario_id, u.nome, COUNT(*) AS demandas_abertas
         FROM demandas d
         JOIN projetos p ON p.id = d.projeto_id
         JOIN usuarios u ON u.id = d.responsavel_id
        WHERE d.status <> 'concluida' ${filtro}
        GROUP BY u.id, u.nome
        ORDER BY demandas_abertas DESC`,
      params
    )

    const [porAtividade] = await db.query(
      `SELECT d.atividade, COUNT(*) AS total, SUM(d.status <> 'concluida') AS abertas
         FROM demandas d JOIN projetos p ON p.id = d.projeto_id
        WHERE 1 = 1 ${filtro}
        GROUP BY d.atividade`,
      params
    )

    const [[projetos]] = await db.query(
      `SELECT SUM(p.status = 'ativo') AS ativos, SUM(p.status = 'concluido') AS concluidos
         FROM projetos p WHERE 1 = 1 ${filtro}`,
      params
    )

    res.json({
      carga,
      por_atividade: porAtividade.map(l => ({ ...l, abertas: Number(l.abertas) })),
      projetos: { ativos: Number(projetos.ativos || 0), concluidos: Number(projetos.concluidos || 0) }
    })
  } catch (err) {
    console.error(err)
    res.status(500).json({ mensagem: 'Erro ao calcular indicadores.' })
  }
})

// ---------- PREVISÃO DE EQUIPE (Expert/Admin, proxy pro serviço de regressão) ----------
// Contrato do serviço de regressão (rede interna, chave interna):
//   POST /prever  { usuario_id, n_itens, qtd_total, n_atividades, prazo_dias }
//     -> { funcionarios_previstos, amostras, r2 }
// O serviço treina com dados mockados + os projetos concluídos desse usuário
// (tabela projetos, coluna funcionarios_usados).

async function chamarRegressao(req, res, caracteristicas) {
  try {
    const resposta = await fetch(`${REGRESSAO_URL}/prever`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-key': INTERNAL_API_KEY },
      body: JSON.stringify({ usuario_id: req.usuario.usuario_id, ...caracteristicas })
    })
    const dados = await resposta.json()

    if (resposta.ok) {
      registrarEvento({
        usuario_id: req.usuario.usuario_id,
        acao: 'previsao_consultada',
        ip_origem: req.ip,
        detalhe: `itens=${caracteristicas.n_itens} qtd=${caracteristicas.qtd_total} atividades=${caracteristicas.n_atividades} prazo=${caracteristicas.prazo_dias}`
      })
    }
    res.status(resposta.status).json(dados)
  } catch (err) {
    console.error(err)
    res.status(502).json({ mensagem: 'Serviço de previsão indisponível.' })
  }
}

// simulação: o usuário informa as características de um projeto hipotético
router.post('/previsao', exigirLogin, exigirNivel('expert'), limitadorEscrita, async (req, res) => {
  const caracteristicas = {
    n_itens: Number(req.body.n_itens),
    qtd_total: Number(req.body.qtd_total),
    n_atividades: Number(req.body.n_atividades),
    prazo_dias: Number(req.body.prazo_dias)
  }
  const valido = Object.values(caracteristicas).every(v => Number.isFinite(v) && v > 0)
  if (!valido || caracteristicas.n_atividades > ATIVIDADES.length) {
    return res.status(400).json({ mensagem: 'Preencha todos os campos com números maiores que zero (atividades: de 1 a 3).' })
  }
  await chamarRegressao(req, res, caracteristicas)
})

// previsão para um projeto já cadastrado: as características saem do próprio banco
router.get('/previsao/projeto/:id', exigirLogin, exigirNivel('expert'), limitadorEscrita, async (req, res) => {
  try {
    const acesso = await carregarProjeto(req, res)
    if (!acesso) return
    if (!acesso.souDono) {
      return res.status(403).json({ mensagem: 'Só quem criou o projeto pede a previsão dele.' })
    }

    const [[itens]] = await db.query(
      'SELECT COUNT(*) AS n_itens, COALESCE(SUM(quantidade), 0) AS qtd_total FROM itens WHERE projeto_id = ?',
      [acesso.projeto.id]
    )
    const [[atividades]] = await db.query(
      'SELECT COUNT(DISTINCT atividade) AS n_atividades FROM demandas WHERE projeto_id = ?',
      [acesso.projeto.id]
    )

    const caracteristicas = {
      n_itens: Number(itens.n_itens),
      qtd_total: Number(itens.qtd_total),
      n_atividades: Number(atividades.n_atividades),
      prazo_dias: Number(acesso.projeto.prazo_dias || 0)
    }
    if (Object.values(caracteristicas).some(v => v <= 0)) {
      return res.status(422).json({
        mensagem: 'Para prever, o projeto precisa ter itens, demandas (com atividade) e prazo em dias.',
        caracteristicas
      })
    }
    await chamarRegressao(req, res, caracteristicas)
  } catch (err) {
    console.error(err)
    res.status(500).json({ mensagem: 'Erro ao preparar a previsão.' })
  }
})

// ---------- ASSINATURA (proxy pro serviço de pagamentos) ----------

// O app só autentica e repassa: Stripe, preços e a tabela clientes_stripe ficam no serviço
// pagamentos. Identidade e papel vêm do JWT validado (nunca do cliente); o cliente só
// escolhe QUAL plano quer. O webhook do Stripe também passa por aqui (ver server.js).
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

// ---------- LOGS (só admin) ----------

router.get('/logs', exigirLogin, exigirNivel('admin'), async (req, res) => {
  try {
    // repassa só os filtros que o log-service conhece (limit, acao, nivel, usuario_id)
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

// ---------- PERFIL (proxy pro profile-service) ----------

// fire-and-forget, mesmo princípio do registrarEvento: nunca trava a resposta principal.
function sincronizarNome(usuarioId, nome) {
  fetch(`${PROFILE_URL}/perfis/${usuarioId}/nome`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nome })
  }).catch(err => console.error('Falha ao sincronizar nome no profile-service:', err.message))
}

// perfil do PRÓPRIO usuário logado (precisa vir antes de /perfil/:usuario_id)
router.get('/perfil/me', exigirLogin, async (req, res) => {
  try {
    sincronizarNome(req.usuario.usuario_id, req.usuario.nome)

    const respostaPerfil = await fetch(`${PROFILE_URL}/perfis/${req.usuario.usuario_id}`).then(r => r.json())

    res.json({
      usuario_id: req.usuario.usuario_id,
      nome: req.usuario.nome,
      bio: respostaPerfil.bio,
      // caminho de proxy -- o navegador nunca fala com o Garage direto (porta extra não é
      // roteada de forma confiável pela hospedagem). Quem busca o arquivo é o
      // profile-service, pela rede interna; o app repassa os bytes (ver rota abaixo).
      foto_url: respostaPerfil.temFoto ? `/api/perfil/${req.usuario.usuario_id}/foto` : null,
      eh_proprio_perfil: true
    })
  } catch (err) {
    console.error(err)
    res.status(502).json({ mensagem: 'Serviço de perfil indisponível.' })
  }
})

// perfil PÚBLICO de qualquer usuário logado (só leitura: nome, bio e foto)
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

// edita a bio -- 403 se o :usuario_id não for o de quem está logado.
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

// upload da foto -- SEMPRE multipart/form-data de verdade pro profile-service, nunca
// buffer cru: o profile-service usa multer do lado dele pra extrair req.file.
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

// GET /perfil/:usuario_id/foto -- PROXY: busca os bytes da imagem no profile-service (que
// busca no Garage pela rede interna) e repassa pro navegador, pela MESMA porta que o resto
// do site já usa (a única roteada de forma confiável por esta hospedagem). Só leitura, sem
// exigirProprioPerfil -- ver qualquer perfil é permitido, só editar que não.
router.get('/perfil/:usuario_id/foto', exigirLogin, async (req, res) => {
  try {
    const resposta = await fetch(`${PROFILE_URL}/perfis/${req.params.usuario_id}/foto-arquivo`)

    if (!resposta.ok) {
      return res.status(resposta.status).end()
    }

    res.set('Content-Type', resposta.headers.get('content-type') || 'image/jpeg')
    res.set('Cache-Control', 'private, max-age=60') // cache curto -- a foto pode trocar
    Readable.fromWeb(resposta.body).pipe(res)
  } catch (err) {
    console.error(err)
    res.status(502).end()
  }
})

// erro do multer (arquivo maior que o permitido) -- precisa vir depois das rotas de upload
router.use((err, req, res, next) => {
  if (err && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ mensagem: `Arquivo muito grande. Máximo: ${TAMANHO_MAXIMO_MB}MB.` })
  }
  next(err)
})

module.exports = router
