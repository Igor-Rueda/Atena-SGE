/* Página de um projeto: dados no topo e fluxo de demandas da produção. */
const el = Atenas.el;
const id = Number(new URLSearchParams(window.location.search).get('id'));

let estado = null; // { projeto, sou_dono, demandas }

const ROTULO_ETAPA = { almoxarifado: 'Almoxarifado', operacao: 'Operação', montagem: 'Montagem', finalizada: 'Finalizada' };

function $(id_str) { return document.getElementById(id_str); }

function naoEncontrado() {
  $('carregando').hidden = true;
  $('nao-encontrado').hidden = false;
  $('migalha-nome').textContent = 'Não encontrado';
}

async function carregar() {
  const r = await Atenas.api('/api/projetos/' + id, { silencioso: true });
  if (r.status === 404) return naoEncontrado();
  if (!r.ok) {
    $('carregando').hidden = true;
    Atenas.aviso(r.dados.mensagem || 'Não foi possível carregar o projeto.');
    return;
  }
  estado = r.dados;
  renderizar();
}

// ---------- topo do projeto ----------
function renderizarTopo() {
  const p = estado.projeto;
  const ativo = p.status === 'ativo';

  document.title = p.nome + ' — Atenas SGE';
  $('migalha-nome').textContent = p.nome;
  $('p-nome').textContent = p.nome;
  $('p-descricao').textContent = p.descricao || 'Sem descrição.';

  const etiquetas = $('p-etiquetas');
  etiquetas.innerHTML = '';
  etiquetas.appendChild(el('span', ativo ? 'Ativo' : 'Concluído', 'etiqueta etiqueta--' + p.status));
  if (!estado.sou_dono) etiquetas.appendChild(el('span', 'Atribuído a você', 'etiqueta'));

  $('d-prazo').textContent = p.prazo_dias ? p.prazo_dias + ' dias' : 'Sem prazo';
  $('d-criado').textContent = Atenas.formatarData(p.criado_em);

  const totalQtd = estado.demandas.reduce((soma, d) => soma + Number(d.quantidade), 0);
  const finalizadas = estado.demandas.reduce((soma, d) => soma + (d.etapa_atual === 'finalizada' ? Number(d.quantidade) : 0), 0);

  $('d-demandas').textContent = estado.demandas.length;
  $('d-unidades').textContent = totalQtd;
  $('d-finalizadas').textContent = finalizadas + ' de ' + totalQtd;
  $('d-equipe').textContent = p.funcionarios_usados ? p.funcionarios_usados : '—';

  $('btn-concluir').hidden = !(estado.sou_dono && ativo);
}

// ---------- fluxo de demandas ----------
async function avancarDemanda(demanda, botao) {
  botao.disabled = true;
  const r = await Atenas.api('/api/demandas/' + demanda.id + '/avancar', { method: 'PATCH' });
  if (r.ok) { Atenas.aviso('Etapa avançada.', 'sucesso'); carregar(); }
  else { botao.disabled = false; }
}

function linhaDemanda(d) {
  const linha = el('div', undefined, 'demanda');
  
  // Etapa atual vira o crachá
  linha.appendChild(el('span', ROTULO_ETAPA[d.etapa_atual] || d.etapa_atual, 'etiqueta etiqueta--' + d.etapa_atual));

  const info = el('div', undefined, 'demanda__info');
  const titulo = el('strong');
  titulo.textContent = d.rg + ' — ' + d.nome_material + ' (Qtd: ' + d.quantidade + ')';
  info.appendChild(titulo);
  linha.appendChild(info);

  const acoes = el('div', undefined, 'demanda__acoes');

  // Lógica de quem pode apertar o botão de avançar
  const cat = Atenas.me ? Atenas.me.categoria : '';
  const superior = cat === 'superior';
  let btnTexto = '';

  if (d.etapa_atual === 'almoxarifado' && (cat === 'almoxarife' || superior)) {
     btnTexto = 'Repassar para Operação';
  } else if (d.etapa_atual === 'operacao' && (cat === 'operador' || superior)) {
     btnTexto = 'Repassar para Montagem';
  } else if (d.etapa_atual === 'montagem' && (cat === 'montador' || superior)) {
     btnTexto = 'Finalizar Demanda';
  }

  if (btnTexto) {
     const btn = el('button', btnTexto, 'botao botao--pequeno');
     btn.addEventListener('click', function() { avancarDemanda(d, btn); });
     acoes.appendChild(btn);
  }

  if (estado.sou_dono && d.etapa_atual !== 'finalizada') {
    const apagar = el('button', undefined, 'botao botao--fantasma botao--pequeno');
    apagar.type = 'button';
    apagar.title = 'Excluir demanda';
    apagar.setAttribute('aria-label', 'Excluir demanda');
    apagar.innerHTML = Atenas.icone('lixeira', 17);
    apagar.addEventListener('click', async function () {
      if (!Atenas.ehExpert()) return Atenas.abrirModalUpgrade('Excluir demandas é um recurso do plano Expert.');
      const confirmou = await Atenas.modal({
        titulo: 'Excluir demanda?', texto: 'Essa ação não pode ser desfeita.', confirmar: 'Excluir', perigo: true,
      });
      if (!confirmou) return;
      const r = await Atenas.api('/api/demandas/' + d.id, { method: 'DELETE' });
      if (r.ok) { Atenas.aviso('Demanda excluída.', 'sucesso'); carregar(); }
    });
    acoes.appendChild(apagar);
  }

  linha.appendChild(acoes);
  return linha;
}

function renderizarDemandas() {
  const lista = $('lista-demandas-projeto');
  lista.innerHTML = '';
  estado.demandas.forEach(function (d) { lista.appendChild(linhaDemanda(d)); });
  $('c-demandas').textContent = estado.demandas.length;
  $('vazio-demandas').hidden = estado.demandas.length > 0;

  // Somente planejador e superior podem criar
  const podeCriar = (Atenas.me && (Atenas.me.categoria === 'planejador' || Atenas.me.categoria === 'superior')) && estado.projeto.status === 'ativo';
  $('btn-add-demanda').hidden = !podeCriar;
}

function renderizar() {
  $('carregando').hidden = true;
  $('conteudo-projeto').hidden = false;
  renderizarTopo();
  renderizarDemandas();
}

// ---------- formulários e ações ----------
function mostrarForm(f, mostrar) {
  f.hidden = !mostrar;
  if (mostrar) f.querySelector('input').focus();
}

const formDemanda = $('form-demanda');
$('btn-add-demanda').addEventListener('click', function () { mostrarForm(formDemanda, formDemanda.hidden); });
$('btn-cancelar-demanda').addEventListener('click', function () { mostrarForm(formDemanda, false); formDemanda.reset(); });
formDemanda.addEventListener('submit', async function (evento) {
  evento.preventDefault();
  const r = await Atenas.api('/api/projetos/' + id + '/demandas', {
    method: 'POST',
    body: JSON.stringify({
      rg: $('demanda-rg').value,
      nome_material: $('demanda-nome').value,
      quantidade: $('demanda-qtd').value,
      etapa_atual: $('demanda-etapa').value,
    }),
  });
  if (r.ok) {
    formDemanda.reset();
    mostrarForm(formDemanda, false);
    Atenas.aviso('Demanda criada e enviada para ' + ROTULO_ETAPA[$('demanda-etapa').value] + '.', 'sucesso');
    carregar();
  }
});

$('btn-concluir').addEventListener('click', async function () {
  const valor = await Atenas.modal({
    titulo: 'Concluir projeto',
    texto: 'Quantos funcionários foram realmente usados? Esse número ensina a previsão de equipe.',
    campo: { rotulo: 'Funcionários usados', tipo: 'number', min: 1 },
    confirmar: 'Concluir projeto',
  });
  if (valor === null) return;
  const r = await Atenas.api('/api/projetos/' + id + '/concluir', {
    method: 'PATCH', body: JSON.stringify({ funcionarios_usados: valor }),
  });
  if (r.ok) { Atenas.aviso('Projeto concluído.', 'sucesso'); carregar(); }
});

Atenas.pronto.then(function () {
  if (!Number.isInteger(id) || id <= 0) return naoEncontrado();
  carregar();
});