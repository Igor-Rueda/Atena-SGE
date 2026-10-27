const express = require('express')
const { client } = require('./redisClient')
const { enfileirar, tamanhoFila } = require('./queue')

const router = express.Router()

// Stream único -- facilita reconstruir a ordem cronológica de eventos vindos
// de serviços diferentes (auth-service e app) numa única consulta.
const STREAM_KEY = 'logs:eventos'

// Em vez de uma lista fixa (que rejeitava em silêncio ações novas, como as de pagamento e
// de foto de perfil), valida só o FORMATO: minúsculas, números e sublinhado.
// Exemplos: login, projeto_criado, demanda_excluida, assinatura_ativada, erro_servico.
const FORMATO_ACAO = /^[a-z][a-z0-9_]{2,59}$/
const NIVEIS_VALIDOS = ['info', 'erro']

// ---------- REGISTRAR EVENTO ----------
// Chamado internamente pelo auth-service e pelo app. Nunca deve ser
// exposto à internet -- esse container não tem porta publicada.
//
// Não grava no Redis aqui -- só valida e enfileira. Quem grava (XADD) é o
// worker em background (queue.js), de um em um. Isso garante que o log-service
// responde rápido pra quem chamou, mesmo que o Redis esteja temporariamente
// lento -- reforçando, numa segunda camada, que log nunca deve atrasar ou
// derrubar a ação principal do usuário (a primeira camada já é o
// fire-and-forget no app/auth-service).
router.post('/eventos', (req, res) => {
  const { usuario_id, acao, ip_origem, detalhe, nivel } = req.body

  if (!acao || !FORMATO_ACAO.test(acao)) {
    return res.status(400).json({ mensagem: 'Ação inválida ou não informada.' })
  }
  if (nivel !== undefined && !NIVEIS_VALIDOS.includes(nivel)) {
    return res.status(400).json({ mensagem: 'Nível inválido (use info ou erro).' })
  }

  // timestamp gerado aqui, no momento em que o evento chega -- não quando
  // o worker eventualmente grava -- pra refletir a ordem real de chegada
  enfileirar({
    usuario_id,
    acao,
    nivel: nivel || 'info',
    timestamp: new Date().toISOString(),
    ip_origem,
    detalhe
  })

  res.status(202).json({ mensagem: 'Evento aceito para gravação.' })
})

// ---------- CONSULTAR ÚLTIMOS N EVENTOS ----------
// Filtros opcionais por query string: ?acao=...&nivel=erro&usuario_id=...&limit=...
// Sem controle de acesso aqui -- quem protege essa informação é o proxy do
// app (exigirLogin + exigirNivel('admin')), já que o log-service nunca
// é chamado diretamente pelo navegador.
router.get('/eventos', async (req, res) => {
  const limite = Math.min(parseInt(req.query.limit, 10) || 50, 500)

  try {
    // XREVRANGE devolve do mais recente pro mais antigo; invertemos no fim
    // pra apresentar em ordem cronológica (o que aconteceu primeiro, primeiro).
    // Importante: eventos ainda na fila em memória (não gravados ainda) não
    // aparecem aqui até o worker processá-los -- normalmente questão de
    // milissegundos, mas em teoria pode causar uma pequena defasagem.
    const { acao, nivel, usuario_id } = req.query
    const temFiltro = Boolean(acao || nivel || usuario_id)

    // com filtro, olha os 500 mais recentes e filtra depois; sem filtro, lê só o necessário
    const entradas = await client.xRevRange(STREAM_KEY, '+', '-', { COUNT: temFiltro ? 500 : limite })

    const eventos = entradas
      .map(entrada => ({
        id: entrada.id,
        ...entrada.message
      }))
      .filter(e => !acao || e.acao === acao)
      .filter(e => !nivel || e.nivel === nivel)
      .filter(e => !usuario_id || e.usuario_id === String(usuario_id))
      .slice(0, limite)
      .reverse()

    res.json(eventos)
  } catch (err) {
    console.error(err)
    res.status(500).json({ mensagem: 'Erro ao consultar eventos.' })
  }
})

// ---------- DIAGNÓSTICO: tamanho atual da fila ----------
// Rota simples de observabilidade -- útil pra confirmar, durante a demo ou
// depuração, que a fila não está acumulando (sinal de Redis fora do ar).
router.get('/fila/status', (req, res) => {
  res.json({ eventos_pendentes: tamanhoFila() })
})

module.exports = router