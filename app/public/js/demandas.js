/* Minhas demandas: as que têm o usuário como responsável, com filtro por status. */
const el = Atenas.el;
const lista = document.getElementById('lista-demandas');
const vazio = document.getElementById('vazio');

const ROTULO_STATUS = { aberta: 'Aberta', em_andamento: 'Em andamento', concluida: 'Concluída' };

let todas = [];
let filtro = 'abertas';

function visivel(d) {
  if (filtro === 'todas') return true;
  if (filtro === 'abertas') return d.status !== 'concluida';
  return d.status === 'concluida';
}

function linha(d) {
  const item = el('div', undefined, 'demanda');
  item.appendChild(el('span', Atenas.rotuloProcesso(d.atividade), 'etiqueta'));

  const info = el('div', undefined, 'demanda__info');
  info.appendChild(el('strong', d.descricao));
  const projeto = el('small');
  projeto.append('Projeto: ');
  const link = el('a', d.projeto_nome);
  link.href = 'projeto.html?id=' + d.projeto_id;
  projeto.appendChild(link);
  info.appendChild(projeto);
  item.appendChild(info);

  const acoes = el('div', undefined, 'demanda__acoes');
  const select = el('select', undefined, 'select-pequeno');
  Object.keys(ROTULO_STATUS).forEach(function (valor) {
    const opcao = el('option', ROTULO_STATUS[valor]);
    opcao.value = valor;
    select.appendChild(opcao);
  });
  select.value = d.status;
  select.setAttribute('aria-label', 'Status da demanda');
  select.addEventListener('change', async function () {
    const r = await Atenas.api('/api/demandas/' + d.id + '/status', { method: 'PATCH', body: JSON.stringify({ status: select.value }) });
    if (r.ok) carregar(); else select.value = d.status;
  });
  acoes.appendChild(select);
  item.appendChild(acoes);
  return item;
}

function renderizar() {
  const mostrar = todas.filter(visivel);
  lista.innerHTML = '';
  mostrar.forEach(function (d) { lista.appendChild(linha(d)); });
  lista.hidden = mostrar.length === 0;
  vazio.hidden = mostrar.length > 0;
  document.getElementById('vazio-texto').textContent = todas.length === 0
    ? 'Você ainda não tem demandas atribuídas. Elas aparecem aqui quando alguém cria uma para você, ou quando você cria uma para si.'
    : 'Nenhuma demanda neste filtro.';
}

async function carregar() {
  const r = await Atenas.api('/api/demandas');
  if (!r.ok) return;
  todas = r.dados;
  renderizar();
}

document.querySelectorAll('[data-filtro]').forEach(function (botao) {
  botao.addEventListener('click', function () {
    filtro = botao.dataset.filtro;
    document.querySelectorAll('[data-filtro]').forEach(function (b) { b.setAttribute('aria-pressed', String(b === botao)); });
    renderizar();
  });
});

Atenas.pronto.then(carregar);
