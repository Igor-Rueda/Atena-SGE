const Stripe = require('stripe')
const db = require('./db')
const { registrarEvento } = require('./logClient') // LOG: helper de auditoria (cópia do auth-service)

// plano vendável: só o Expert. 'professional' é gratuito (sem Stripe) e 'admin' nunca é vendido.
const PLANOS_PAGOS = ['expert']

// Assinaturas que dão acesso ao plano pago. 'past_due' (renovação recusada) NÃO dá acesso: o plano
// pago não continua de graça. Se o pagamento for regularizado, o Stripe manda customer.subscription.updated
// com status 'active' e o acesso volta sozinho.
const STATUS_COM_ACESSO = ['active', 'trialing']
// na troca de plano, qualquer assinatura anterior ainda viva (inclusive inadimplente) é cancelada
const STATUS_A_CANCELAR = [...STATUS_COM_ACESSO, 'past_due', 'unpaid']

// Cliente criado só no primeiro uso: sem STRIPE_SECRET_KEY (ex: no CI) o serviço
// continua subindo normalmente; só falha quando alguém tenta de fato cobrar.
let clienteStripe = null
function getStripe() {
  if (!clienteStripe) {
    if (!process.env.STRIPE_SECRET_KEY) {
      throw new Error('STRIPE_SECRET_KEY não configurada.')
    }
    clienteStripe = new Stripe(process.env.STRIPE_SECRET_KEY)
  }
  return clienteStripe
}

// plano -> price_id do Stripe (vem do servidor, nunca do cliente)
function priceDoPlano(plano) {
  if (!PLANOS_PAGOS.includes(plano)) return null

  const precos = {
    expert: process.env.STRIPE_PRICE_EXPERT
  }
  return precos[plano] || null
}

// price_id -> papel. O papel é deduzido do que foi realmente cobrado.
function planoDoPrice(priceId) {
  return PLANOS_PAGOS.find(plano => priceDoPlano(plano) === priceId) || null
}

// ---------- o Stripe é a fonte da verdade sobre o plano ----------
// O papel do usuário (usuarios.role) é sempre recalculado a partir das assinaturas que o Stripe
// diz que existem. O banco guarda só uma cópia do estado (tabela assinaturas), para o painel admin
// e para avisar o usuário.

async function listarAssinaturas(clienteId) {
  const lista = await getStripe().subscriptions.list({ customer: clienteId, status: 'all', limit: 100 })
  return lista.data
}

// Maior papel pago entre as assinaturas COM ACESSO do cliente; 'professional' se não houver.
// `ignorarId` tira uma assinatura da conta (a que acabou de ser cancelada ou de falhar).
async function papelPagoAtual(clienteId, ignorarId = null) {
  const assinaturas = await listarAssinaturas(clienteId)
  let melhor = 'professional'

  for (const assinatura of assinaturas) {
    if (assinatura.id === ignorarId) continue
    if (!STATUS_COM_ACESSO.includes(assinatura.status)) continue

    const role = planoDoPrice(assinatura.items.data[0].price.id)
    if (role && PLANOS_PAGOS.indexOf(role) > PLANOS_PAGOS.indexOf(melhor)) {
      melhor = role
    }
  }
  return melhor
}

// ---------- chamada interna ao auth-service (dono da tabela usuarios) ----------

// Retorna true se aplicou; false se o caso não tem como dar certo nem com retry
// (usuário inexistente ou admin). Qualquer outra falha lança erro -> webhook responde 500
// e o Stripe tenta de novo.
async function definirRoleNoAuth(usuarioId, role) {
  const resposta = await fetch(`${process.env.AUTH_SERVICE_URL}/internos/usuarios/${usuarioId}/role`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'x-internal-key': process.env.INTERNAL_API_KEY
    },
    body: JSON.stringify({ role })
  })

  if (resposta.status === 404 || resposta.status === 409) {
    console.error(`auth-service recusou definir role=${role} para usuario ${usuarioId} (status ${resposta.status})`)
    return false
  }
  if (!resposta.ok) {
    throw new Error(`auth-service respondeu ${resposta.status} ao definir role`)
  }
  return true
}

// ---------- cópia local do estado da assinatura (tabela assinaturas) ----------

// valor mensal (em centavos) do que está sendo cobrado: planos anuais entram divididos por 12
function valorMensalCentavos(assinatura) {
  let total = 0
  for (const item of assinatura.items.data) {
    const preco = item.price
    if (!preco || !preco.recurring || preco.unit_amount == null) continue
    const quantidade = item.quantity || 1
    const { interval, interval_count: cada } = preco.recurring
    const base = preco.unit_amount * quantidade
    if (interval === 'month') total += base / (cada || 1)
    else if (interval === 'year') total += base / (12 * (cada || 1))
  }
  return Math.round(total)
}

// o fim do período mudou de lugar em versões novas da API do Stripe (foi para o item da assinatura)
function fimDoPeriodo(assinatura) {
  const ts = assinatura.current_period_end || (assinatura.items.data[0] && assinatura.items.data[0].current_period_end)
  return ts ? new Date(ts * 1000) : null
}

function idDoCliente(assinatura) {
  return typeof assinatura.customer === 'string' ? assinatura.customer : assinatura.customer.id
}

async function guardarAssinatura(usuarioId, assinatura) {
  await db.query(
    `INSERT INTO assinaturas
       (usuario_id, stripe_customer_id, stripe_subscription_id, plano, status, valor_mensal_centavos, cancelamento_agendado, periodo_fim)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       stripe_customer_id = VALUES(stripe_customer_id),
       stripe_subscription_id = VALUES(stripe_subscription_id),
       plano = VALUES(plano),
       status = VALUES(status),
       valor_mensal_centavos = VALUES(valor_mensal_centavos),
       cancelamento_agendado = VALUES(cancelamento_agendado),
       periodo_fim = VALUES(periodo_fim)`,
    [
      usuarioId,
      idDoCliente(assinatura),
      assinatura.id,
      planoDoPrice(assinatura.items.data[0].price.id) || 'desconhecido',
      assinatura.status,
      valorMensalCentavos(assinatura),
      Boolean(assinatura.cancel_at_period_end || assinatura.cancel_at),
      fimDoPeriodo(assinatura)
    ]
  )
}

async function usuarioDoCliente(clienteId) {
  const [linhas] = await db.query('SELECT usuario_id FROM clientes_stripe WHERE stripe_customer_id = ?', [clienteId])
  return linhas[0] ? linhas[0].usuario_id : null
}

// recalcula o papel a partir do Stripe e grava no auth-service
async function sincronizarPapel(usuarioId, clienteId, ignorarId = null) {
  const role = await papelPagoAtual(clienteId, ignorarId)
  await definirRoleNoAuth(usuarioId, role)
  return role
}

// ---------- tratamento dos eventos ----------

// Cancela toda assinatura do cliente que NÃO seja a nova. Stateless de propósito: se uma
// tentativa anterior falhou no meio, o retry do Stripe simplesmente encontra o que ainda
// sobrou. Qualquer falha diferente de "não existe" lança erro (cobrança em dobro não pode
// ser engolida em silêncio).
async function cancelarAssinaturasAnteriores(clienteId, assinaturaAtualId) {
  const stripe = getStripe()

  for (const assinatura of await listarAssinaturas(clienteId)) {
    if (assinatura.id === assinaturaAtualId) continue
    if (!STATUS_A_CANCELAR.includes(assinatura.status)) continue

    try {
      await stripe.subscriptions.cancel(assinatura.id)
    } catch (err) {
      if (err.code !== 'resource_missing') throw err
    }
  }
}

// checkout.session.completed: guarda customer e subscription e promove o usuário
async function tratarCheckoutConcluido(sessao, ip) {
  // só promove com pagamento confirmado
  if (sessao.mode !== 'subscription' || sessao.payment_status !== 'paid') return

  const usuarioId = Number(sessao.client_reference_id)
  if (!Number.isInteger(usuarioId) || usuarioId <= 0) {
    console.error('checkout.session.completed sem client_reference_id válido:', sessao.id)
    return
  }

  const stripe = getStripe()
  const assinatura = await stripe.subscriptions.retrieve(sessao.subscription)
  const priceId = assinatura.items.data[0].price.id
  const role = planoDoPrice(priceId)

  if (!role) {
    console.error('price desconhecido no checkout:', priceId)
    return
  }

  // 1) guarda o vínculo usuário <-> cliente do Stripe
  await db.query(
    `INSERT INTO clientes_stripe (usuario_id, stripe_customer_id)
     VALUES (?, ?)
     ON DUPLICATE KEY UPDATE stripe_customer_id = VALUES(stripe_customer_id)`,
    [usuarioId, sessao.customer]
  )

  // 2) promove e 3) cancela as assinaturas anteriores. Cada passo é idempotente: se o
  // Stripe reenviar o evento, refaz sem efeito colateral.
  // Se o auth-service recusar (usuário inexistente ou admin), para aqui: não cancela nada
  // nem registra "assinatura_ativada" para uma promoção que não aconteceu.
  const promovido = await definirRoleNoAuth(usuarioId, role)
  if (!promovido) {
    console.error(`Promoção recusada para usuario ${usuarioId} (role=${role}); evento ${sessao.id} ignorado.`)
    return
  }
  await cancelarAssinaturasAnteriores(sessao.customer, assinatura.id)

  // 4) guarda a cópia do estado da assinatura (plano, status, valor, ids do Stripe)
  await guardarAssinatura(usuarioId, assinatura)

  registrarEvento({
    usuario_id: usuarioId,
    acao: 'assinatura_ativada',
    ip_origem: ip,
    detalhe: `plano=${role} subscription=${assinatura.id}`
  })
}

// customer.subscription.updated: troca de plano, renovação, cancelamento agendado, mudança de status
async function tratarAssinaturaAtualizada(assinatura, ip) {
  const clienteId = idDoCliente(assinatura)
  const usuarioId = await usuarioDoCliente(clienteId)
  if (!usuarioId) return // cliente que não conhecemos (ex: promovido manualmente)

  // A linha guarda a assinatura VIGENTE. Um evento de uma assinatura antiga (a que foi trocada num
  // upgrade) não pode sobrescrevê-la, a menos que a vigente já não dê acesso.
  const [linhas] = await db.query('SELECT stripe_subscription_id, status FROM assinaturas WHERE usuario_id = ?', [usuarioId])
  const atual = linhas[0]
  const ehAVigente = !atual || atual.stripe_subscription_id === assinatura.id
  const substitui = !ehAVigente && STATUS_COM_ACESSO.includes(assinatura.status) && !STATUS_COM_ACESSO.includes(atual.status)
  if (ehAVigente || substitui) {
    await guardarAssinatura(usuarioId, assinatura)
  }

  // o papel é sempre recalculado a partir do Stripe: past_due tira o acesso, active devolve
  const role = await sincronizarPapel(usuarioId, clienteId)

  registrarEvento({
    usuario_id: usuarioId,
    acao: 'assinatura_atualizada',
    ip_origem: ip,
    detalhe: `status=${assinatura.status} papel=${role} cancelamento_agendado=${Boolean(assinatura.cancel_at_period_end || assinatura.cancel_at)} subscription=${assinatura.id}`
  })
}

// customer.subscription.deleted: a assinatura terminou
async function tratarAssinaturaCancelada(assinatura, ip) {
  const clienteId = idDoCliente(assinatura)
  const usuarioId = await usuarioDoCliente(clienteId)
  if (!usuarioId) return // cliente que não conhecemos (ex: promovido manualmente)

  // só marca como cancelada se for a assinatura vigente (num upgrade, a antiga é cancelada de propósito)
  await db.query(
    "UPDATE assinaturas SET status = 'canceled', cancelamento_agendado = FALSE WHERE usuario_id = ? AND stripe_subscription_id = ?",
    [usuarioId, assinatura.id]
  )

  // Pergunta ao Stripe o que SOBROU. Num upgrade, a assinatura antiga é cancelada mas a nova continua
  // ativa: o papel resultante é o do plano novo, e ninguém é rebaixado por engano.
  const role = await sincronizarPapel(usuarioId, clienteId, assinatura.id)

  if (role === 'professional') {
    registrarEvento({
      usuario_id: usuarioId,
      acao: 'assinatura_cancelada',
      ip_origem: ip,
      detalhe: `subscription=${assinatura.id}`
    })
  }
}

// invoice.payment_failed: a cobrança (da renovação) falhou
async function tratarPagamentoFalhou(fatura, ip) {
  const clienteId = typeof fatura.customer === 'string' ? fatura.customer : (fatura.customer && fatura.customer.id)
  if (!clienteId) return

  // o id da assinatura mudou de lugar em versões novas da API do Stripe
  const assinaturaId = fatura.subscription
    || (fatura.parent && fatura.parent.subscription_details && fatura.parent.subscription_details.subscription)
    || null

  const usuarioId = await usuarioDoCliente(clienteId)
  if (!usuarioId) return // cliente sem assinatura nossa (ex: a primeira cobrança do checkout, que nem chegou a concluir)

  // marca a assinatura como inadimplente, sem esperar o customer.subscription.updated
  if (assinaturaId) {
    await db.query(
      "UPDATE assinaturas SET status = 'past_due' WHERE usuario_id = ? AND stripe_subscription_id = ?",
      [usuarioId, assinaturaId]
    )
  }

  // o plano pago não continua de graça: sem outra assinatura em dia, volta para professional
  const role = await sincronizarPapel(usuarioId, clienteId, assinaturaId)

  registrarEvento({
    usuario_id: usuarioId,
    acao: 'pagamento_falhou',
    ip_origem: ip,
    detalhe: `subscription=${assinaturaId} novo_papel=${role} tentativa=${fatura.attempt_count || '-'}`
  })
}

// ---------- webhook ----------

// Idempotência: cada evento (evt_...) é registrado antes de ser processado. Se o Stripe reenviar o
// mesmo evento, o INSERT não entra e o processamento não se repete. Se o processamento falhar, o
// registro é desfeito para o reenvio do Stripe poder tentar de novo.
async function reservarEvento(evento) {
  const [resultado] = await db.query('INSERT IGNORE INTO eventos_stripe (id, tipo) VALUES (?, ?)', [evento.id, evento.type])
  return resultado.affectedRows === 1
}

async function liberarEvento(eventoId) {
  try {
    await db.query('DELETE FROM eventos_stripe WHERE id = ?', [eventoId])
  } catch (err) {
    console.error(`Falha ao liberar o evento ${eventoId} para nova tentativa:`, err.message)
  }
}

// Recebe o corpo CRU (Buffer), repassado byte a byte pelo app: a assinatura do Stripe
// é calculada sobre os bytes exatos. A rota usa express.raw() em vez de express.json().
async function webhookHandler(req, res) {
  let evento

  try {
    evento = getStripe().webhooks.constructEvent(
      req.body,
      req.get('stripe-signature'),
      process.env.STRIPE_WEBHOOK_SECRET
    )
  } catch (err) {
    console.error('Webhook com assinatura inválida:', err.message)
    return res.status(400).send('Assinatura inválida.')
  }

  // o app repassa o IP de quem chamou (o Stripe), pra auditoria
  const ip = req.get('x-origem-ip') || req.ip

  let novo
  try {
    novo = await reservarEvento(evento)
  } catch (err) {
    console.error(`Erro ao registrar o evento ${evento.id}:`, err)
    return res.status(500).send('Erro ao processar evento.')
  }
  if (!novo) {
    console.log(`Evento ${evento.id} (${evento.type}) já processado: ignorado.`)
    return res.json({ received: true, duplicate: true })
  }

  try {
    if (evento.type === 'checkout.session.completed') {
      await tratarCheckoutConcluido(evento.data.object, ip)
    } else if (evento.type === 'customer.subscription.updated') {
      await tratarAssinaturaAtualizada(evento.data.object, ip)
    } else if (evento.type === 'customer.subscription.deleted') {
      await tratarAssinaturaCancelada(evento.data.object, ip)
    } else if (evento.type === 'invoice.payment_failed') {
      await tratarPagamentoFalhou(evento.data.object, ip)
    }
    // demais eventos: reconhece e ignora

    res.json({ received: true })
  } catch (err) {
    // 500 faz o Stripe reenviar o evento mais tarde; libera o registro para a nova tentativa valer
    console.error(`Erro ao processar evento ${evento.type}:`, err)
    await liberarEvento(evento.id)
    res.status(500).send('Erro ao processar evento.')
  }
}

module.exports = {
  getStripe,
  priceDoPlano,
  papelPagoAtual,
  webhookHandler
}