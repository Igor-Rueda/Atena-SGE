const mensagemStatus = document.getElementById('mensagem-status')
const badgeRole = document.getElementById('badge-role')
const bloqueio = document.getElementById('bloqueio')
const conteudo = document.getElementById('conteudo')
const resultado = document.getElementById('resultado')
const resultadoDetalhe = document.getElementById('resultado-detalhe')
const selProjeto = document.getElementById('sel-projeto')

function mostrarStatus(texto) {
  mensagemStatus.textContent = texto
  mensagemStatus.hidden = !texto
}

function el(tag, texto, classe) {
  const e = document.createElement(tag)
  if (texto !== undefined) e.textContent = texto
  if (classe) e.className = classe
  return e
}

async function pegar(url, opcoes = {}) {
  const resposta = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...opcoes })
  if (resposta.status === 401) {
    window.location.href = '/login.html'
    return { ok: false, status: 401, dados: {} }
  }
  const dados = await resposta.json().catch(() => ({}))
  return { ok: resposta.ok, status: resposta.status, dados }
}

function mostrarPrevisao(r) {
  if (!r.ok) {
    resultado.hidden = true
    resultadoDetalhe.hidden = true
    mostrarStatus(r.dados.mensagem || 'Não foi possível calcular a previsão.')
    return
  }
  mostrarStatus('')
  const previsto = Number(r.dados.funcionarios_previstos)
  resultado.textContent = `≈ ${Math.max(1, Math.ceil(previsto))} funcionários (previsão bruta: ${previsto.toFixed(1)})`
  resultado.hidden = false

  const partes = []
  if (r.dados.amostras_reais !== undefined) {
    partes.push(`${r.dados.amostras_reais} projetos seus concluídos + ${r.dados.amostras_exemplo} de exemplo`)
  }
  if (r.dados.r2 !== undefined && r.dados.r2 !== null) partes.push(`R² = ${Number(r.dados.r2).toFixed(2)}`)
  if (r.dados.fora_da_faixa && r.dados.fora_da_faixa.length > 0) {
    partes.push(`atenção: ${r.dados.fora_da_faixa.join(', ')} fora do que o modelo já viu (previsão menos confiável)`)
  }
  if (r.dados.historico_indisponivel) {
    partes.push('histórico indisponível agora: usando só os projetos de exemplo')
  }
  resultadoDetalhe.textContent = partes.join(' · ')
  resultadoDetalhe.hidden = partes.length === 0
}

document.getElementById('form-simulador').addEventListener('submit', async (evento) => {
  evento.preventDefault()
  const corpo = {
    n_itens: document.getElementById('sim-itens').value,
    qtd_total: document.getElementById('sim-qtd').value,
    n_atividades: document.getElementById('sim-atividades').value,
    prazo_dias: document.getElementById('sim-prazo').value
  }
  mostrarPrevisao(await pegar('/api/previsao', { method: 'POST', body: JSON.stringify(corpo) }))
})

document.getElementById('form-projeto-previsao').addEventListener('submit', async (evento) => {
  evento.preventDefault()
  if (!selProjeto.value) return
  mostrarPrevisao(await pegar(`/api/previsao/projeto/${selProjeto.value}`))
})

function desenharBarras(lista, linhas, rotulo, valor, alerta) {
  lista.innerHTML = ''
  if (linhas.length === 0) lista.appendChild(el('li', 'Sem dados ainda.'))
  const maximo = Math.max(1, ...linhas.map(valor))
  for (const linha of linhas) {
    const li = el('li')
    li.appendChild(el('span', `${rotulo(linha)}: ${valor(linha)}`))
    const barra = el('div', undefined, 'barra' + (alerta(linha) ? ' alerta' : ''))
    barra.style.width = `${Math.max(4, (valor(linha) / maximo) * 100)}%`
    li.appendChild(barra)
    lista.appendChild(li)
  }
}

async function carregarIndicadores() {
  const r = await pegar('/api/indicadores')
  if (!r.ok) {
    mostrarStatus(r.dados.mensagem || 'Não foi possível carregar os indicadores.')
    return
  }
  const { carga, por_atividade: porAtividade, projetos } = r.dados
  const media = carga.length ? carga.reduce((s, c) => s + c.demandas_abertas, 0) / carga.length : 0

  // sobrecarga: bem acima da média da equipe (e com mais de 2 demandas abertas)
  desenharBarras(
    document.getElementById('lista-carga'), carga,
    c => c.nome, c => c.demandas_abertas,
    c => carga.length > 1 && c.demandas_abertas > media * 1.5 && c.demandas_abertas > 2
  )
  desenharBarras(
    document.getElementById('lista-atividades'), porAtividade,
    a => a.atividade, a => a.abertas, () => false
  )
  document.getElementById('resumo-projetos').textContent =
    `Projetos ativos: ${projetos.ativos} · concluídos: ${projetos.concluidos}`
}

async function carregarProjetos() {
  const r = await pegar('/api/projetos')
  selProjeto.innerHTML = ''
  const meus = (r.dados || []).filter(p => p.sou_dono && p.status === 'ativo')
  if (meus.length === 0) {
    const opt = el('option', 'Nenhum projeto ativo seu')
    opt.value = ''
    selProjeto.appendChild(opt)
    return
  }
  for (const p of meus) {
    const opt = el('option', p.nome)
    opt.value = p.id
    selProjeto.appendChild(opt)
  }
}

document.getElementById('btn-logout').addEventListener('click', async () => {
  await fetch('/api/auth/logout', { method: 'POST' })
  window.location.href = '/login.html'
})

async function iniciar() {
  const me = await pegar('/api/me')
  if (!me.ok) return
  badgeRole.textContent = me.dados.role
  badgeRole.hidden = false

  // a trava de verdade está no backend (403); aqui só escolhemos o que mostrar
  if (me.dados.role === 'professional') {
    bloqueio.hidden = false
    return
  }
  conteudo.hidden = false
  carregarIndicadores()
  carregarProjetos()
}

iniciar()
