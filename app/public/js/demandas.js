/* Fila de produção unificada do usuário */
const el = Atenas.el;
const lista = document.getElementById('lista-demandas');
const vazio = document.getElementById('vazio');

const ROTULO_ETAPA = { almoxarifado: 'Almoxarifado', operacao: 'Operação', montagem: 'Montagem', finalizada: 'Finalizada' };

// Cada etapa só é avançada pela categoria dona dela (ou pelo Superior). O servidor valida de novo.
const FLUXO = {
  almoxarifado: { categoria: 'almoxarife', texto: 'Concluir e enviar para Operação' },
  operacao:     { categoria: 'operador',   texto: 'Concluir e enviar para Montagem' },
  montagem:     { categoria: 'montador',   texto: 'Finalizar demanda' }
};

let todas = [];

function podeAvancar(etapa) {
  const regra = FLUXO[etapa];
  if (!regra || !Atenas.me) return false;
  return Atenas.me.categoria === regra.categoria || Atenas.me.categoria === 'superior';
}

function podeGerenciar(d) {
  const me = Atenas.me;
  if (!me || d.etapa_atual === 'finalizada') return false;
  if (me.role === 'admin' || me.categoria === 'superior') return true;
  return me.categoria === 'planejador' && d.planejador_id === me.usuario_id;
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
    texto: d.rg + ' — ' + d.nome_material + '. Essa ação não pode ser desfeita.',
    confirmar: 'Excluir',
    perigo: true
  });
  if (!confirmou) return;
  const r = await Atenas.api('/api/demandas/' + d.id, { method: 'DELETE' });
  if (r.ok) { Atenas.aviso('Demanda excluída.', 'sucesso'); carregar(); }
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