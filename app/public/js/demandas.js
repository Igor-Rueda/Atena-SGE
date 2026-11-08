/* Fila de produção unificada do usuário */
const el = Atenas.el;
const lista = document.getElementById('lista-demandas');
const vazio = document.getElementById('vazio');

const ROTULO_ETAPA = { almoxarifado: 'Almoxarifado', operacao: 'Operação', montagem: 'Montagem', finalizada: 'Finalizada' };

let todas = [];

async function avancarDemanda(d, botao) {
  botao.disabled = true;
  const r = await Atenas.api('/api/demandas/' + d.id + '/avancar', { method: 'PATCH' });
  if (r.ok) { 
    Atenas.aviso('Etapa avançada.', 'sucesso'); 
    carregar(); 
  } else { 
    botao.disabled = false; 
  }
}

function linha(d) {
  const item = el('div', undefined, 'demanda');
  
  // A query do routes.js mapeou etapa_atual para 'atividade' e 'status'
  const etapa = d.atividade || d.status; 
  item.appendChild(el('span', ROTULO_ETAPA[etapa] || etapa, 'etiqueta etiqueta--' + etapa));

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

  const cat = Atenas.me ? Atenas.me.categoria : '';
  const superior = cat === 'superior';
  let btnTexto = '';

  if (etapa === 'almoxarifado' && (cat === 'almoxarife' || superior)) {
     btnTexto = 'Repassar para Operação';
  } else if (etapa === 'operacao' && (cat === 'operador' || superior)) {
     btnTexto = 'Repassar para Montagem';
  } else if (etapa === 'montagem' && (cat === 'montador' || superior)) {
     btnTexto = 'Finalizar Demanda';
  }

  if (btnTexto) {
     const btn = el('button', btnTexto, 'botao botao--pequeno');
     btn.addEventListener('click', function() { avancarDemanda(d, btn); });
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

Atenas.pronto.then(carregar);