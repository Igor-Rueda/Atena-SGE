const mensagemStatus = document.getElementById('mensagem-status')
const badgeRole = document.getElementById('badge-role')
const listaProjetos = document.getElementById('lista-projetos')
const listaDemandas = document.getElementById('lista-demandas')
const detalhe = document.getElementById('detalhe')
const formProjeto = document.getElementById('form-projeto')
const formItem = document.getElementById('form-item')
const formDemanda = document.getElementById('form-demanda')
const listaItens = document.getElementById('lista-itens')
const listaDemandasProjeto = document.getElementById('lista-demandas-projeto')
const btnConcluir = document.getElementById('btn-concluir')

const modalUpgrade = document.getElementById('modal-upgrade')
const modalTexto = document.getElementById('modal-texto')

const STATUS = { aberta: 'Aberta', em_andamento: 'Em andamento', concluida: 'Concluída' }

let meuRole = 'professional'
let projetoAberto = null

const ehExpert = () => meuRole === 'expert' || meuRole === 'admin'

function mostrarStatus(texto) {
  mensagemStatus.textContent = texto
  mensagemStatus.hidden = !texto
}

function abrirModal(texto) {
  modalTexto.textContent = texto
  modalUpgrade.hidden = false
}
document.getElementById('modal-btn-cancelar').addEventListener('click', () => { modalUpgrade.hidden = true })
modalUpgrade.addEventListener('click', e => { if (e.target === modalUpgrade) modalUpgrade.hidden = true })
document.getElementById('modal-btn-assinar').addEventListener('click', () => { window.location.href = '/planos.html' })

// fetch com JSON; 401 volta ao login; 403 com "codigo" (limite ou plano) abre o modal de upgrade
async function api(url, opcoes = {}) {
  const resposta = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...opcoes })
  if (resposta.status === 401) {
    window.location.href = '/login.html'
    return { ok: false, dados: {} }
  }
  const dados = await resposta.json().catch(() => ({}))
  if (resposta.status === 403 && dados.codigo) {
    abrirModal(dados.mensagem)
  } else if (!resposta.ok) {
    mostrarStatus(dados.mensagem || 'Não foi possível concluir a ação.')
  } else {
    mostrarStatus('')
  }
  return { ok: resposta.ok, dados }
}

function el(tag, texto, classe) {
  const e = document.createElement(tag)
  if (texto !== undefined) e.textContent = texto
  if (classe) e.className = classe
  return e
}

function seletorStatus(demanda, aoMudar) {
  const select = el('select')
  for (const [valor, rotulo] of Object.entries(STATUS)) {
    const opt = el('option', rotulo)
    opt.value = valor
    select.appendChild(opt)
  }
  select.value = demanda.status
  select.addEventListener('change', async () => {
    const r = await api(`/api/demandas/${demanda.id}/status`, { method: 'PATCH', body: JSON.stringify({ status: select.value }) })
    if (r.ok) aoMudar()
  })
  return select
}

// ---------- listas ----------
async function carregarProjetos() {
  const { ok, dados } = await api('/api/projetos')
  if (!ok) return
  listaProjetos.innerHTML = ''
  if (dados.length === 0) listaProjetos.appendChild(el('li', 'Nenhum projeto ainda. Crie o primeiro acima.'))

  for (const p of dados) {
    const li = el('li')
    const texto = el('span', `${p.nome} · ${p.total_itens} itens`)
    texto.appendChild(el('span', p.status === 'ativo' ? 'Ativo' : 'Concluído', 'etiqueta'))
    if (!p.sou_dono) texto.appendChild(el('span', 'atribuído a você', 'etiqueta'))
    const abrir = el('button', 'Abrir', 'botao-secundario')
    abrir.addEventListener('click', () => abrirProjeto(p.id))
    li.append(texto, abrir)
    listaProjetos.appendChild(li)
  }
}

async function carregarMinhasDemandas() {
  const { ok, dados } = await api('/api/demandas')
  if (!ok) return
  listaDemandas.innerHTML = ''
  if (dados.length === 0) listaDemandas.appendChild(el('li', 'Você não tem demandas atribuídas.'))

  for (const d of dados) {
    const li = el('li')
    li.appendChild(el('span', `${d.projeto_nome} · ${d.atividade} · ${d.descricao}`))
    li.appendChild(seletorStatus(d, recarregarTudo))
    listaDemandas.appendChild(li)
  }
}

function recarregarTudo() {
  carregarProjetos()
  carregarMinhasDemandas()
  if (projetoAberto) abrirProjeto(projetoAberto, false)
}

// ---------- detalhe do projeto ----------
async function abrirProjeto(id, rolar = true) {
  const { ok, dados } = await api(`/api/projetos/${id}`)
  if (!ok) return
  projetoAberto = id
  const { projeto, sou_dono: souDono, itens, demandas } = dados
  const ativo = projeto.status === 'ativo'

  detalhe.hidden = false
  document.getElementById('detalhe-titulo').textContent = projeto.nome
  document.getElementById('detalhe-status').textContent = ativo ? 'Ativo' : 'Concluído'
  document.getElementById('detalhe-descricao').textContent = projeto.descricao || ''
  formItem.hidden = !souDono
  formDemanda.hidden = !(souDono && ativo)
  btnConcluir.hidden = !(souDono && ativo)

  listaItens.innerHTML = ''
  if (itens.length === 0) listaItens.appendChild(el('li', 'Nenhum item cadastrado.'))
  for (const i of itens) listaItens.appendChild(el('li', `${i.rg} · ${i.nome} · quantidade ${i.quantidade}`))

  listaDemandasProjeto.innerHTML = ''
  if (demandas.length === 0) listaDemandasProjeto.appendChild(el('li', 'Nenhuma demanda para você neste projeto.'))
  for (const d of demandas) {
    const li = el('li')
    li.appendChild(el('span', `${d.atividade} · ${d.descricao} · ${d.responsavel_nome}`))
    const acoes = el('span', undefined, 'form-linha')
    acoes.appendChild(seletorStatus(d, recarregarTudo))
    if (souDono) {
      // o botão aparece para quem é dono; só o plano Expert executa a exclusão
      const apagar = el('button', '🗑', 'botao-apagar')
      apagar.title = 'Excluir demanda'
      apagar.addEventListener('click', async () => {
        if (!ehExpert()) return abrirModal('Excluir demandas é um recurso do plano Expert.')
        const r = await api(`/api/demandas/${d.id}`, { method: 'DELETE' })
        if (r.ok) recarregarTudo()
      })
      acoes.appendChild(apagar)
    }
    li.appendChild(acoes)
    listaDemandasProjeto.appendChild(li)
  }
  if (rolar) detalhe.scrollIntoView({ behavior: 'smooth' })
}

document.getElementById('btn-fechar-detalhe').addEventListener('click', () => {
  detalhe.hidden = true
  projetoAberto = null
})

// ---------- formulários ----------
formProjeto.addEventListener('submit', async (evento) => {
  evento.preventDefault()
  const corpo = {
    nome: document.getElementById('projeto-nome').value,
    descricao: document.getElementById('projeto-descricao').value,
    prazo_dias: document.getElementById('projeto-prazo').value
  }
  const r = await api('/api/projetos', { method: 'POST', body: JSON.stringify(corpo) })
  if (r.ok) {
    formProjeto.reset()
    recarregarTudo()
  }
})

formItem.addEventListener('submit', async (evento) => {
  evento.preventDefault()
  const corpo = {
    rg: document.getElementById('item-rg').value,
    nome: document.getElementById('item-nome').value,
    quantidade: document.getElementById('item-quantidade').value
  }
  const r = await api(`/api/projetos/${projetoAberto}/itens`, { method: 'POST', body: JSON.stringify(corpo) })
  if (r.ok) {
    formItem.reset()
    recarregarTudo()
  }
})

formDemanda.addEventListener('submit', async (evento) => {
  evento.preventDefault()
  const corpo = {
    atividade: document.getElementById('demanda-atividade').value,
    descricao: document.getElementById('demanda-descricao').value,
    responsavel_email: document.getElementById('demanda-email').value
  }
  const r = await api(`/api/projetos/${projetoAberto}/demandas`, { method: 'POST', body: JSON.stringify(corpo) })
  if (r.ok) {
    formDemanda.reset()
    recarregarTudo()
  }
})

btnConcluir.addEventListener('click', async () => {
  const resposta = prompt('Quantos funcionários foram realmente usados neste projeto? (esse número ensina a previsão)')
  if (resposta === null) return
  const r = await api(`/api/projetos/${projetoAberto}/concluir`, {
    method: 'PATCH',
    body: JSON.stringify({ funcionarios_usados: resposta })
  })
  if (r.ok) recarregarTudo()
})

document.getElementById('btn-logout').addEventListener('click', async () => {
  await fetch('/api/auth/logout', { method: 'POST' })
  window.location.href = '/login.html'
})

async function iniciar() {
  const respostaMe = await fetch('/api/me')
  if (respostaMe.status === 401) {
    window.location.href = '/login.html'
    return
  }
  const me = await respostaMe.json()
  meuRole = me.role
  badgeRole.textContent = meuRole
  badgeRole.hidden = false
  recarregarTudo()
}

iniciar()
