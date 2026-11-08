/* Lista de projetos: cada cartão abre a página do projeto. */
const el = Atenas.el;
const lista = document.getElementById('lista-projetos');
const vazio = document.getElementById('vazio');
const form = document.getElementById('form-projeto');

let todos = [];
let filtro = 'todos';

function cartao(p) {
  const a = el('a', undefined, 'projeto-card');
  a.href = 'projeto.html?id=' + p.id;

  const etiquetas = el('div', undefined, 'projeto-card__etiquetas');
  etiquetas.appendChild(el('span', p.status === 'ativo' ? 'Ativo' : 'Concluído', 'etiqueta etiqueta--' + p.status));
  if (!p.sou_dono) etiquetas.appendChild(el('span', 'Atribuído a você', 'etiqueta'));

  const meta = el('div', undefined, 'projeto-card__meta');
  const demandas = el('span');
  demandas.innerHTML = Atenas.icone('lista', 15);
  demandas.append(p.total_demandas + (p.total_demandas === 1 ? ' demanda' : ' demandas'));
  const prazo = el('span');
  prazo.innerHTML = Atenas.icone('relogio', 15);
  prazo.append(p.prazo_dias ? p.prazo_dias + ' dias' : 'Sem prazo');
  meta.append(demandas, prazo);

  const abrir = el('div', undefined, 'projeto-card__abrir');
  abrir.append('Abrir projeto');
  abrir.insertAdjacentHTML('beforeend', Atenas.icone('seta', 16));

  a.append(etiquetas, el('h3', p.nome), el('p', p.descricao || 'Sem descrição.'), meta, abrir);
  return a;
}

function renderizar() {
  const visiveis = todos.filter(function (p) { return filtro === 'todos' || p.status === filtro; });
  lista.innerHTML = '';
  visiveis.forEach(function (p) { lista.appendChild(cartao(p)); });
  vazio.hidden = visiveis.length > 0;
  lista.hidden = visiveis.length === 0;
  if (visiveis.length === 0) {
    document.getElementById('vazio-texto').textContent = todos.length === 0
      ? 'Crie o primeiro projeto para começar a gerenciar sua fila de produção.'
      : 'Nenhum projeto neste filtro.';
  }
}

async function carregar() {
  const r = await Atenas.api('/api/projetos');
  if (!r.ok) return;
  todos = r.dados;
  renderizar();
}

document.querySelectorAll('[data-filtro]').forEach(function (botao) {
  botao.addEventListener('click', function () {
    filtro = botao.dataset.filtro;
    document.querySelectorAll('[data-filtro]').forEach(function (b) {
      b.setAttribute('aria-pressed', String(b === botao));
    });
    renderizar();
  });
});

function alternarForm(mostrar) {
  form.hidden = !mostrar;
  if (mostrar) document.getElementById('projeto-nome').focus();
}
document.getElementById('btn-novo').addEventListener('click', function () { alternarForm(form.hidden); });
document.getElementById('btn-vazio-novo').addEventListener('click', function () { alternarForm(true); });
document.getElementById('btn-cancelar').addEventListener('click', function () { alternarForm(false); form.reset(); });

form.addEventListener('submit', async function (evento) {
  evento.preventDefault();
  const botao = form.querySelector('button[type="submit"]');
  botao.disabled = true;
  const r = await Atenas.api('/api/projetos', {
    method: 'POST',
    body: JSON.stringify({
      nome: document.getElementById('projeto-nome').value,
      descricao: document.getElementById('projeto-descricao').value,
      prazo_dias: document.getElementById('projeto-prazo').value,
    }),
  });
  botao.disabled = false;
  if (r.ok) window.location.href = 'projeto.html?id=' + r.dados.id; // já abre o projeto novo
});

Atenas.pronto.then(carregar);