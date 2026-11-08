/* Fila de produção do usuário. O Planejador tem ainda a aba "Excluídas". O Superior não usa esta página. */
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
let aba = 'andamento'; // 'andamento' | 'excluidas' (só o Planejador tem as duas)
let barraAbas = null;

function ehPlanejador() {
  return !!Atenas.me && Atenas.me.categoria === 'planejador';
}

function podeAvancar(etapa) {
  const regra = FLUXO[etapa];
  return !!regra && !!Atenas.me && Atenas.me.categoria === regra.categoria;
}

function podeGerenciar(d) {
  return ehPlanejador() && d.planejador_id === Atenas.me.usuario_id && d.etapa_atual !== 'finalizada';
}

async function avancarDemanda(botao, d) {
  botao.disabled = true;
  const r = await Atenas.api('/api/demandas/' + d.id + '/avancar', { method: 'PATCH' });
  if (r.ok) Atenas.aviso('Etapa avançada.', 'sucesso');
  if (r.ok || r.status === 409) return carregar(); // 409: outra pessoa já moveu, recarrega a fila
  botao.disabled = false;
}

async function excluirDemanda(d) {
  const confirmou = await Atenas.modal({
    titulo: 'Excluir demanda?',
    texto: d.rg + ' — ' + d.nome_material + '. Ela será movida para a aba Excluídas.',
    confirmar: 'Excluir',
    perigo: true
  });
  if (!confirmou) return;
  const r = await Atenas.api('/api/demandas/' + d.id, { method: 'DELETE' });
  if (r.ok) { Atenas.aviso('Demanda movida para Excluídas.', 'sucesso'); carregar(); }
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
  if (d.excluida_em) projeto.append(' · Excluída em ' + Atenas.formatarData(d.excluida_em));
  info.appendChild(projeto);
  item.appendChild(info);

  const acoes = el('div', undefined, 'demanda__acoes');

  if (aba === 'andamento') {
    if (podeAvancar(d.etapa_atual)) {
      const btn = el('button', FLUXO[d.etapa_atual].texto, 'botao botao--pequeno');
      btn.type = 'button';
      btn.addEventListener('click', function () { avancarDemanda(btn, d); });
      acoes.appendChild(btn);
    }

    if (podeGerenciar(d)) {
      // a edição usa o formulário da página do projeto
      const editar = el('a', 'Editar', 'botao botao--pequeno botao--secundario');
      editar.href = 'projeto.html?id=' + d.projeto_id + '&editar=' + d.id;
      acoes.appendChild(editar);

      const excluir = el('button', 'Excluir', 'botao botao--pequeno botao--perigo');
      excluir.type = 'button';
      excluir.addEventListener('click', function () { excluirDemanda(d); });
      acoes.appendChild(excluir);
    }
  }

  item.appendChild(acoes);
  return item;
}

function textosVazio() {
  const titulo = vazio.querySelector('h3');
  const texto = document.getElementById('vazio-texto');
  if (aba === 'excluidas') {
    titulo.textContent = 'Nenhuma demanda excluída';
    texto.textContent = 'As demandas que você excluir aparecem aqui.';
  } else {
    titulo.textContent = 'Sua fila está vazia';
    texto.textContent = ehPlanejador()
      ? 'Cadastre demandas dentro de um projeto e elas aparecerão aqui.'
      : 'Novas demandas aparecerão aqui automaticamente.';
  }
}

function renderizar() {
  lista.innerHTML = '';
  todas.forEach(function (d) { lista.appendChild(linha(d)); });
  lista.hidden = todas.length === 0;
  vazio.hidden = todas.length > 0;
  textosVazio();
}

function atualizarAbas() {
  barraAbas.querySelectorAll('button').forEach(function (b) {
    const ativa = b.dataset.aba === aba;
    b.className = 'botao botao--pequeno' + (ativa ? '' : ' botao--secundario');
    b.setAttribute('aria-pressed', String(ativa));
  });
}

function montarAbas() {
  barraAbas = el('div');
  barraAbas.style.cssText = 'display:flex;gap:8px;margin-bottom:16px;';
  [['andamento', 'Em andamento'], ['excluidas', 'Excluídas']].forEach(function (par) {
    const b = el('button', par[1]);
    b.type = 'button';
    b.dataset.aba = par[0];
    b.addEventListener('click', function () {
      aba = par[0];
      atualizarAbas();
      carregar();
    });
    barraAbas.appendChild(b);
  });
  lista.parentNode.insertBefore(barraAbas, lista);
  atualizarAbas();
}

async function carregar() {
  const r = await Atenas.api('/api/demandas' + (aba === 'excluidas' ? '?excluidas=1' : ''));
  if (!r.ok) return;
  todas = r.dados;
  renderizar();
}

Atenas.pronto.then(function (me) {
  // O Superior supervisiona projetos e não tem fila de demandas
  if (me.categoria === 'superior') { window.location.href = 'projetos.html'; return; }
  if (ehPlanejador()) montarAbas();
  carregar();
});