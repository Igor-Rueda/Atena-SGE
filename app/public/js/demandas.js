/* Fila de produção: só Almoxarife, Operador e Montador usam esta página. */
const el = Atenas.el;
const lista = document.getElementById('lista-demandas');
const vazio = document.getElementById('vazio');

const ROTULO_ETAPA = { almoxarifado: 'Almoxarifado', operacao: 'Operação', montagem: 'Montagem', finalizada: 'Finalizada' };

// Cada etapa só é avançada pela categoria dona dela. O servidor valida de novo.
const FLUXO = {
  almoxarifado: { categoria: 'almoxarife', texto: 'Concluir e enviar para Operação' },
  operacao:     { categoria: 'operador',   texto: 'Concluir e enviar para Montagem' },
  montagem:     { categoria: 'montador',   texto: 'Finalizar demanda' }
};

let todas = [];

function podeAvancar(etapa) {
  const regra = FLUXO[etapa];
  return !!regra && !!Atenas.me && Atenas.me.categoria === regra.categoria;
}

async function avancarDemanda(botao, d) {
  botao.disabled = true;
  const r = await Atenas.api('/api/demandas/' + d.id + '/avancar', { method: 'PATCH' });
  if (r.ok) Atenas.aviso('Etapa avançada.', 'sucesso');
  if (r.ok || r.status === 409) return carregar(); // 409: outra pessoa já moveu, recarrega a fila
  botao.disabled = false;
}

function linha(d) {
  const item = el('div', undefined, 'demanda');
  item.appendChild(el('span', ROTULO_ETAPA[d.etapa_atual] || d.etapa_atual, 'etiqueta etiqueta--' + d.etapa_atual));

  const info = el('div', undefined, 'demanda__info');
  info.appendChild(el('strong', d.rg + ' — ' + d.nome_material + ' (Qtd: ' + d.quantidade + ')'));
  const projeto = el('small');
  projeto.append('Projeto: ');
  const link = el('a', d.projeto_nome);
  link.href = 'projeto.html?id=' + d.projeto_id;
  projeto.appendChild(link);
  info.appendChild(projeto);
  item.appendChild(info);

  const acoes = el('div', undefined, 'demanda__acoes');
  if (podeAvancar(d.etapa_atual)) {
    const btn = el('button', FLUXO[d.etapa_atual].texto, 'botao botao--pequeno');
    btn.type = 'button';
    btn.addEventListener('click', function () { avancarDemanda(btn, d); });
    acoes.appendChild(btn);
  }
  item.appendChild(acoes);
  return item;
}

function renderizar() {
  lista.innerHTML = '';
  todas.forEach(function (d) { lista.appendChild(linha(d)); });
  lista.hidden = todas.length === 0;
  vazio.hidden = todas.length > 0;
}

async function carregar() {
  const r = await Atenas.api('/api/demandas');
  if (!r.ok) return;
  todas = r.dados;
  renderizar();
}

Atenas.pronto.then(function (me) {
  // Superior e Planejador não têm fila: trabalham pela página do projeto
  if (me.categoria === 'superior' || me.categoria === 'planejador') {
    window.location.href = 'projetos.html';
    return;
  }
  carregar();
});