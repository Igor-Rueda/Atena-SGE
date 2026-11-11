const express = require('express')
const crypto = require('crypto')
const db = require('./db')
const billing = require('./billing')
const { registrarEvento } = require('./logClient') // LOG: helper de auditoria (cópia do auth-service)

const router = express.Router()

// mesma hierarquia do app (usada só pra impedir "downgrade por compra")
const HIERARQUIA = ['professional', 'expert', 'admin']

function nivelDe(role) {
  return HIERARQUIA.indexOf(role)
}

// Serviço de uso interno: só o app chama (rede interna, sem porta pública), e mesmo
// assim exige o segredo compartilhado INTERNAL_API_KEY. Fail closed: sem a variável, nada passa.
function exigirChaveInterna(req, res, next) {
  const esperada = process.env.INTERNAL_API_KEY
  const recebida = req.get('x-internal-key')

  if (!esperada || !recebida) {
    return res.status(403).json({ mensagem: 'Acesso interno negado.' })
  }

  const a = Buffer.from(esperada)
  const b = Buffer.from(recebida)

  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(403).json({ mensagem: 'Acesso interno negado.' })
  }

  next()
}

router.use(exigirChaveInterna)

// ---------- WEBHOOK DO STRIPE ----------
// O app (único serviço público) repassa o corpo cru + o header Stripe-Signature.
// A proteção real é a verificação dessa assinatura, feita dentro do webhookHandler.
router.post('/webhook', express.raw({ type: 'application/json' }), billing.webhookHandler)

// ---------- CHECKOUT ----------
// Cria uma Checkout Session e devolve a URL hospedada pelo Stripe. O cartão é digitado lá:
// este serviço nunca vê número, CVV ou validade. usuario_id e role vêm do JWT já validado
// pelo app; o cliente só escolhe o plano, e o price_id é decidido aqui.
router.post('/checkout', express.json(), async (req, res) => {
  const { usuario_id, role, plano, ip } = req.body
  const usuarioId = Number(usuario_id)

  if (!Number.isInteger(usuarioId) || usuarioId <= 0 || nivelDe(role) === -1) {
    return res.status(400).json({ mensagem: 'Dados inválidos.' })
  }

  const priceId = billing.priceDoPlano(plano)
  if (!priceId) {
    return res.status(400).json({ mensagem: 'Plano inválido.' })
  }

  // admin não é plano vendável: não assina, e o webhook também nunca o rebaixa
  if (role === 'admin') {
    registrarEvento({
      usuario_id: usuarioId,
      acao: 'acesso_negado',
      ip_origem: ip,
      detalhe: `rota=POST /checkout role_atual=admin plano=${plano}`
    })
    return res.status(403).json({ mensagem: 'Contas admin não assinam planos.' })
  }

  try {
    // o banco só diz QUEM é o cliente no Stripe; o plano em si é perguntado ao Stripe
    const [linhas] = await db.query('SELECT stripe_customer_id FROM clientes_stripe WHERE usuario_id = ?', [usuarioId])
    const clienteId = linhas[0] ? linhas[0].stripe_customer_id : null

    // só permite upgrade. O JWT pode estar defasado logo após um pagamento, então o nível
    // efetivo considera também as assinaturas ativas no Stripe (evita cobrar em dobro)
    const rolePago = clienteId ? await billing.papelPagoAtual(clienteId) : 'professional'
    const nivelAtual = Math.max(nivelDe(role), nivelDe(rolePago))

    if (nivelDe(plano) <= nivelAtual) {
      return res.status(409).json({ mensagem: 'Você já tem esse plano ou um superior.' })
    }

    const sessao = await billing.getStripe().checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      client_reference_id: String(usuarioId), // o webhook usa isso pra achar o usuário
      ...(clienteId ? { customer: clienteId } : {}), // reaproveita o cliente do Stripe
      success_url: `${process.env.APP_URL}/assinatura-sucesso.html`,
      cancel_url: `${process.env.APP_URL}/planos.html?cancelado=1`,
      locale: 'pt-BR'
    })

    res.json({ url: sessao.url })
  } catch (err) {
    console.error(err)
    res.status(500).json({ mensagem: 'Erro ao iniciar o pagamento.' })
  }
})

// ---------- PORTAL DO CLIENTE ----------
// Abre o Billing Portal do Stripe, onde a pessoa troca de plano e cancela sozinha. O portal só
// existe para quem já tem um cliente no Stripe (ou seja, já passou pelo checkout). Este serviço
// só ABRE o caminho: quem muda o plano no banco continua sendo o webhook.
router.post('/portal', express.json(), async (req, res) => {
  const { usuario_id, ip } = req.body
  const usuarioId = Number(usuario_id)

  if (!Number.isInteger(usuarioId) || usuarioId <= 0) {
    return res.status(400).json({ mensagem: 'Dados inválidos.' })
  }

  try {
    const [linhas] = await db.query('SELECT stripe_customer_id FROM clientes_stripe WHERE usuario_id = ?', [usuarioId])
    if (!linhas[0]) {
      return res.status(404).json({ mensagem: 'Você ainda não tem uma assinatura para gerenciar.' })
    }

    const sessao = await billing.getStripe().billingPortal.sessions.create({
      customer: linhas[0].stripe_customer_id,
      return_url: `${process.env.APP_URL}/planos.html`,
      locale: 'pt-BR'
    })

    registrarEvento({
      usuario_id: usuarioId,
      acao: 'portal_aberto',
      ip_origem: ip,
      detalhe: 'portal=billing'
    })

    res.json({ url: sessao.url })
  } catch (err) {
    console.error(err)
    res.status(500).json({ mensagem: 'Erro ao abrir o portal de assinatura.' })
  }
})

// ---------- ESTADO DA ASSINATURA (para a tela de Planos) ----------
// Devolve a cópia local do estado da assinatura do usuário (mantida pelos webhooks), para a tela
// avisar de cobrança recusada ou de cancelamento agendado e mostrar o botão "Gerenciar assinatura".
router.get('/status', async (req, res) => {
  const usuarioId = Number(req.query.usuario_id)
  if (!Number.isInteger(usuarioId) || usuarioId <= 0) {
    return res.status(400).json({ mensagem: 'Dados inválidos.' })
  }

  try {
    const [linhas] = await db.query(
      'SELECT plano, status, cancelamento_agendado, periodo_fim FROM assinaturas WHERE usuario_id = ?',
      [usuarioId]
    )
    const a = linhas[0]
    if (!a) return res.json({ status: 'sem_assinatura' })

    res.json({
      plano: a.plano,
      status: a.status,
      inadimplente: ['past_due', 'unpaid'].includes(a.status),
      cancelamento_agendado: Boolean(a.cancelamento_agendado),
      periodo_fim: a.periodo_fim
    })
  } catch (err) {
    console.error(err)
    res.status(500).json({ mensagem: 'Erro ao buscar a assinatura.' })
  }
})

// ---------- PAINEL ADMIN: RESUMO DO NEGÓCIO ----------
// Só o app chama (e só para o papel admin). Usuários por plano vêm de usuarios.role; assinaturas e MRR vêm
// da cópia local mantida pelos webhooks (tabela assinaturas). MRR de teste = soma do valor mensal das
// assinaturas ATIVAS (planos anuais entram divididos por 12).
router.get('/admin/resumo', async (req, res) => {
  try {
    const [porPlano] = await db.query('SELECT role, COUNT(*) AS total FROM usuarios GROUP BY role')
    const usuarios = { professional: 0, expert: 0, admin: 0 }
    porPlano.forEach(l => { usuarios[l.role] = Number(l.total) })

    const [[resumo]] = await db.query(
      `SELECT COALESCE(SUM(status = 'active'), 0) AS ativas,
              COALESCE(SUM(status IN ('past_due', 'unpaid')), 0) AS inadimplentes,
              COALESCE(SUM(CASE WHEN status = 'active' THEN valor_mensal_centavos ELSE 0 END), 0) AS mrr_centavos
         FROM assinaturas`
    )

    // últimos webhooks recebidos (o log de auditoria completo fica em /api/logs)
    const [webhooks] = await db.query(
      'SELECT id, tipo, recebido_em FROM eventos_stripe ORDER BY recebido_em DESC, id DESC LIMIT 10'
    )

    res.json({
      usuarios,
      total_usuarios: Object.values(usuarios).reduce((soma, n) => soma + n, 0),
      assinaturas_ativas: Number(resumo.ativas),
      assinaturas_inadimplentes: Number(resumo.inadimplentes),
      mrr: Number(resumo.mrr_centavos) / 100,
      moeda: 'BRL',
      modo_teste: true,
      ultimos_webhooks: webhooks
    })
  } catch (err) {
    console.error(err)
    res.status(500).json({ mensagem: 'Erro ao calcular o resumo das assinaturas.' })
  }
})

module.exports = router