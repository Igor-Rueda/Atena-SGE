/* Página de um projeto: dados no topo e demandas da produção. */
const el = Atenas.el;
const id = Number(new URLSearchParams(window.location.search).get('id'));

let estado = null; // { projeto, sou_dono, demandas, excluidas }
let editandoId = null; // demanda em edição (null = criando)
let abaDemandas = 'andamento'; // 'andamento' | 'excluidas' (só o Planejador tem as duas)

const ROTULO_ETAPA = { almoxarifado: 'Almoxarifado', operacao: 'Operação', montagem: 'Montagem', finalizada: 'Finalizada' };
// processos para onde o Planejador pode destinar uma demanda
const PROCESSOS_DESTINO = [
  { valor: 'almoxarifado', rotulo: 'Almoxarifado' },
  { valor: 'operacao', rotulo: 'Operação' },
  { valor: 'montagem', rotulo: 'Montagem' },
];

// Cada etapa só é avançada pela categoria dona dela. O servidor valida de novo.
const FLUXO = {
  almoxarifado: { categoria: 'almoxarife', texto: 'Concluir e enviar para Operação' },
  operacao:     { categoria: 'operador',   texto: 'Concluir e enviar para Montagem' },
  montagem:     { categoria: 'montador',   texto: 'Finalizar demanda' },
};

function $(id_str) { return document.getElementById(id_str); }
function categoria() { return Atenas.me ? Atenas.me.categoria : ''; }
function plural(n, singular, pluralTexto) { return n + ' ' + (n === 1 ? singular : pluralTexto); }

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

// ---------- permissões (espelham as do servidor, que é quem decide) ----------
function podeAvancar(d) {
  const regra = FLUXO[d.etapa_atual];
  return !!regra && categoria() === regra.categoria;
}

function podeGerenciar(d) {
  return categoria() === 'planejador' && d.planejador_id === Atenas.me.usuario_id && d.etapa_atual !== 'finalizada';
}

// demandas que a Montagem ainda não concluiu
function pendentes() {
  return estado.demandas.filter(function (d) { return d.etapa_atual !== 'finalizada'; }).length;
}

// ---------- ações do Superior sobre o projeto ----------
const btnConcluir = $('btn-concluir');
const btnEditarProjeto = el('button', 'Editar projeto', 'botao botao--secundario');
const btnExcluirProjeto = el('button', 'Excluir projeto', 'botao botao--perigo');
btnEditarProjeto.type = 'button';
btnExcluirProjeto.type = 'button';
btnEditarProjeto.hidden = true;
btnExcluirProjeto.hidden = true;
btnConcluir.before(btnEditarProjeto, btnExcluirProjeto);

// Diálogo com os três campos do projeto (o Atenas.modal só tem um campo).
function dialogoProjeto(p) {
  return new Promise(function (resolver) {
    const fundo = el('div', undefined, 'modal');
    const caixa = el('div', undefined, 'modal__caixa');
    caixa.setAttribute('role', 'dialog');
    caixa.setAttribute('aria-modal', 'true');
    caixa.appendChild(el('h2', 'Editar projeto'));

    function campo(rotulo, entrada, idCampo) {
      const grupo = el('div', undefined, 'campo');
      const label = el('label', rotulo);
      entrada.id = idCampo;
      label.htmlFor = idCampo;
      grupo.append(label, entrada);
      caixa.appendChild(grupo);
    }

    const nome = document.createElement('input');
    nome.type = 'text';
    nome.maxLength = 150;
    nome.value = p.nome;
    const descricao = document.createElement('textarea');
    descricao.rows = 3;
    descricao.value = p.descricao || '';
    const prazo = document.createElement('input');
    prazo.type = 'number';
    prazo.min = '1';
    prazo.step = '1';
    prazo.value = p.prazo_dias || '';
    campo('Nome', nome, 'editar-projeto-nome');
    campo('Descrição', descricao, 'editar-projeto-descricao');
    campo('Prazo (dias)', prazo, 'editar-projeto-prazo');

    const acoes = el('div', undefined, 'modal__acoes');
    const cancelar = el('button', 'Cancelar', 'botao botao--secundario');
    const salvar = el('button', 'Salvar', 'botao');
    cancelar.type = 'button';
    salvar.type = 'button';
    acoes.append(cancelar, salvar);
    caixa.appendChild(acoes);
    fundo.appendChild(caixa);
    document.body.appendChild(fundo);

    function fechar(valor) {
      document.removeEventListener('keydown', teclas);
      fundo.remove();
      resolver(valor);
    }
    function teclas(e) { if (e.key === 'Escape') fechar(null); }
    cancelar.addEventListener('click', function () { fechar(null); });
    fundo.addEventListener('click', function (e) { if (e.target === fundo) fechar(null); });
    salvar.addEventListener('click', function () {
      if (!nome.value.trim()) { nome.focus(); return; }
      fechar({ nome: nome.value, descricao: descricao.value, prazo_dias: prazo.value });
    });
    document.addEventListener('keydown', teclas);
    nome.focus();
  });
}

btnEditarProjeto.addEventListener('click', async function () {
  const dados = await dialogoProjeto(estado.projeto);
  if (!dados) return;
  const r = await Atenas.api('/api/projetos/' + id, { method: 'PUT', body: JSON.stringify(dados) });
  if (r.ok) { Atenas.aviso('Projeto atualizado.', 'sucesso'); carregar(); }
});

// Excluir: se houver demandas não concluídas pela Montagem, o aviso pede confirmação.
btnExcluirProjeto.addEventListener('click', async function () {
  const n = pendentes();
  const total = estado.demandas.length;
  const confirmou = await Atenas.modal(n > 0 ? {
    titulo: 'Excluir projeto com demandas em andamento?',
    texto: plural(n, 'demanda ainda não foi concluída', 'demandas ainda não foram concluídas') +
      ' pela Montagem. Se continuar, o projeto e todas as ' + plural(total, 'demanda', 'demandas') +
      ' dele serão excluídos. Essa ação não pode ser desfeita.',
    confirmar: 'Excluir mesmo assim',
    perigo: true,
  } : {
    titulo: 'Excluir projeto?',
    texto: 'O projeto "' + estado.projeto.nome + '" será excluído' +
      (total > 0 ? ' junto com ' + plural(total, 'demanda', 'demandas') : '') + '. Essa ação não pode ser desfeita.',
    confirmar: 'Excluir projeto',
    perigo: true,
  });
  if (!confirmou) return;
  const r = await Atenas.api('/api/projetos/' + id + (n > 0 ? '?confirmar=1' : ''), { method: 'DELETE' });
  if (r.ok) { Atenas.aviso('Projeto excluído.', 'sucesso'); window.location.href = 'projetos.html'; }
  else if (r.status === 409) carregar(); // surgiram demandas novas: recarrega para avisar de novo
});

// Concluir: sem pergunta de funcionários; com demandas pendentes, o aviso pede confirmação.
btnConcluir.addEventListener('click', async function () {
  const n = pendentes();
  const confirmou = await Atenas.modal(n > 0 ? {
    titulo: 'Concluir projeto com demandas em andamento?',
    texto: plural(n, 'demanda ainda não foi concluída', 'demandas ainda não foram concluídas') +
      ' pela Montagem. Se continuar, ' + (n === 1 ? 'ela será encerrada' : 'elas serão encerradas') +
      ' sem passar pela Montagem.',
    confirmar: 'Concluir mesmo assim',
    perigo: true,
  } : {
    titulo: 'Concluir projeto?',
    texto: 'Todas as demandas foram concluídas. O projeto será marcado como concluído e não poderá mais ser editado.',
    confirmar: 'Concluir projeto',
  });
  if (!confirmou) return;
  const r = await Atenas.api('/api/projetos/' + id + '/concluir' + (n > 0 ? '?confirmar=1' : ''), { method: 'PATCH' });
  if (r.ok) { Atenas.aviso('Projeto concluído.', 'sucesso'); carregar(); }
  else if (r.status === 409) carregar(); // surgiram demandas novas: recarrega para avisar de novo
});

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

  // Só o Superior dono do projeto edita, exclui e conclui
  const superiorDono = estado.sou_dono && categoria() === 'superior';
  btnConcluir.hidden = !(superiorDono && ativo);
  btnEditarProjeto.hidden = !(superiorDono && ativo);
  btnExcluirProjeto.hidden = !superiorDono;
}

// ---------- demandas ----------
async function avancarDemanda(demanda, botao) {
  botao.disabled = true;
  const r = await Atenas.api('/api/demandas/' + demanda.id + '/avancar', { method: 'PATCH' });
  if (r.ok) Atenas.aviso('Etapa avançada.', 'sucesso');
  if (r.ok || r.status === 409) return carregar(); // 409: outra pessoa já moveu, recarrega
  botao.disabled = false;
}

function textoDemanda(d) {
  return d.rg + ' — ' + d.nome_material + ' (Qtd: ' + d.quantidade + ')';
}

function linhaDemanda(d) {
  const linha = el('div', undefined, 'demanda');
  linha.appendChild(el('span', ROTULO_ETAPA[d.etapa_atual] || d.etapa_atual, 'etiqueta etiqueta--' + d.etapa_atual));

  const info = el('div', undefined, 'demanda__info');
  info.appendChild(el('strong', textoDemanda(d)));
  linha.appendChild(info);

  const acoes = el('div', undefined, 'demanda__acoes');

  if (podeAvancar(d)) {
    const btn = el('button', FLUXO[d.etapa_atual].texto, 'botao botao--pequeno');
    btn.type = 'button';
    btn.addEventListener('click', function () { avancarDemanda(d, btn); });
    acoes.appendChild(btn);
  }

  if (podeGerenciar(d)) {
    const editar = el('button', undefined, 'botao botao--fantasma botao--pequeno');
    editar.type = 'button';
    editar.title = 'Editar demanda';
    editar.setAttribute('aria-label', 'Editar demanda');
    editar.innerHTML = Atenas.icone('lapis', 17);
    editar.addEventListener('click', function () { iniciarEdicao(d); });
    acoes.appendChild(editar);

    const apagar = el('button', undefined, 'botao botao--fantasma botao--pequeno');
    apagar.type = 'button';
    apagar.title = 'Excluir demanda';
    apagar.setAttribute('aria-label', 'Excluir demanda');
    apagar.innerHTML = Atenas.icone('lixeira', 17);
    apagar.addEventListener('click', async function () {
      const confirmou = await Atenas.modal({
        titulo: 'Excluir demanda?', texto: 'Ela será movida para a aba Excluídas.', confirmar: 'Excluir', perigo: true,
      });
      if (!confirmou) return;
      const r = await Atenas.api('/api/demandas/' + d.id, { method: 'DELETE' });
      if (r.ok) { Atenas.aviso('Demanda movida para Excluídas.', 'sucesso'); carregar(); }
    });
    acoes.appendChild(apagar);
  }

  linha.appendChild(acoes);
  return linha;
}

function linhaExcluida(d) {
  const linha = el('div', undefined, 'demanda');
  linha.appendChild(el('span', ROTULO_ETAPA[d.etapa_atual] || d.etapa_atual, 'etiqueta etiqueta--' + d.etapa_atual));
  const info = el('div', undefined, 'demanda__info');
  info.appendChild(el('strong', textoDemanda(d)));
  info.appendChild(el('small', 'Excluída em ' + Atenas.formatarData(d.excluida_em)));
  linha.appendChild(info);
  return linha;
}

// abas "Demandas | Excluídas": só o Planejador (que também vê o que excluiu)
let barraAbas = null;
let painelExcluidas = null;

function montarAbas() {
  if (barraAbas) return;
  const lista = $('lista-demandas-projeto');
  barraAbas = el('div');
  barraAbas.style.cssText = 'display:flex;gap:8px;margin-bottom:16px;';
  [['andamento', 'Demandas'], ['excluidas', 'Excluídas']].forEach(function (par) {
    const b = el('button', par[1]);
    b.type = 'button';
    b.dataset.aba = par[0];
    b.addEventListener('click', function () { abaDemandas = par[0]; renderizarDemandas(); });
    barraAbas.appendChild(b);
  });
  painelExcluidas = el('div', undefined, lista.className);
  lista.parentNode.insertBefore(barraAbas, lista);
  lista.after(painelExcluidas);
}

function atualizarAbas() {
  barraAbas.querySelectorAll('button').forEach(function (b) {
    const ativa = b.dataset.aba === abaDemandas;
    b.className = 'botao botao--pequeno' + (ativa ? '' : ' botao--secundario');
    b.setAttribute('aria-pressed', String(ativa));
    b.textContent = b.dataset.aba === 'excluidas'
      ? 'Excluídas (' + estado.excluidas.length + ')'
      : 'Demandas (' + estado.demandas.length + ')';
  });
}

function renderizarDemandas() {
  const lista = $('lista-demandas-projeto');
  const planejador = categoria() === 'planejador';
  if (planejador) montarAbas();
  const naExcluidas = planejador && abaDemandas === 'excluidas';

  lista.innerHTML = '';
  estado.demandas.forEach(function (d) { lista.appendChild(linhaDemanda(d)); });
  lista.hidden = naExcluidas;
  $('c-demandas').textContent = estado.demandas.length;
  $('vazio-demandas').hidden = naExcluidas || estado.demandas.length > 0;

  if (planejador) {
    painelExcluidas.innerHTML = '';
    if (estado.excluidas.length === 0) {
      painelExcluidas.appendChild(el('p', 'Nenhuma demanda excluída neste projeto.', 'texto-suave'));
    } else {
      estado.excluidas.forEach(function (d) { painelExcluidas.appendChild(linhaExcluida(d)); });
    }
    painelExcluidas.hidden = !naExcluidas;
    atualizarAbas();
  }

  // Só o Planejador cadastra demandas
  $('btn-add-demanda').hidden = !(planejador && estado.projeto.status === 'ativo') || naExcluidas;
}

function renderizar() {
  $('carregando').hidden = true;
  $('conteudo-projeto').hidden = false;
  renderizarTopo();
  renderizarDemandas();
}

// ---------- formulário de demanda (criar e editar) ----------
function mostrarForm(f, mostrar) {
  f.hidden = !mostrar;
  if (mostrar) f.querySelector('input').focus();
}

const formDemanda = $('form-demanda');
const botaoSalvarDemanda = formDemanda.querySelector('button[type="submit"]');
const textoSalvarOriginal = botaoSalvarDemanda.textContent;

// Seletor de processo: o Planejador destina a demanda ao cadastrar ou editar (padrão: Almoxarifado)
const seletorEtapa = $('demanda-etapa');
if (seletorEtapa) {
  seletorEtapa.innerHTML = '';
  PROCESSOS_DESTINO.forEach(function (p) {
    const opcao = document.createElement('option');
    opcao.value = p.valor;
    opcao.textContent = p.rotulo;
    seletorEtapa.appendChild(opcao);
  });
  seletorEtapa.disabled = false;
  const rotuloEtapa = document.querySelector('label[for="demanda-etapa"]');
  if (rotuloEtapa) rotuloEtapa.textContent = 'Processo';
}

function fecharFormDemanda() {
  editandoId = null;
  formDemanda.reset();
  botaoSalvarDemanda.textContent = textoSalvarOriginal;
  mostrarForm(formDemanda, false);
}

function iniciarEdicao(d) {
  editandoId = d.id;
  $('demanda-rg').value = d.rg;
  $('demanda-nome').value = d.nome_material;
  $('demanda-qtd').value = d.quantidade;
  if (seletorEtapa) seletorEtapa.value = d.etapa_atual;
  botaoSalvarDemanda.textContent = 'Salvar alterações';
  mostrarForm(formDemanda, true);
  formDemanda.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

$('btn-add-demanda').addEventListener('click', function () {
  if (!formDemanda.hidden) return fecharFormDemanda();
  editandoId = null;
  formDemanda.reset();
  botaoSalvarDemanda.textContent = textoSalvarOriginal;
  mostrarForm(formDemanda, true);
});
$('btn-cancelar-demanda').addEventListener('click', fecharFormDemanda);

formDemanda.addEventListener('submit', async function (evento) {
  evento.preventDefault();
  const editando = editandoId !== null;
  const etapa = seletorEtapa ? seletorEtapa.value : 'almoxarifado';
  const corpo = JSON.stringify({
    rg: $('demanda-rg').value,
    nome_material: $('demanda-nome').value,
    quantidade: $('demanda-qtd').value,
    etapa_atual: etapa,
  });

  botaoSalvarDemanda.disabled = true;
  const r = editando
    ? await Atenas.api('/api/demandas/' + editandoId, { method: 'PUT', body: corpo })
    : await Atenas.api('/api/projetos/' + id + '/demandas', { method: 'POST', body: corpo });
  botaoSalvarDemanda.disabled = false;

  if (r.ok) {
    fecharFormDemanda();
    Atenas.aviso(
      editando ? 'Demanda atualizada.' : 'Demanda criada e enviada para ' + ROTULO_ETAPA[etapa] + '.',
      'sucesso'
    );
    carregar();
  }
});

Atenas.pronto.then(function () {
  if (!Number.isInteger(id) || id <= 0) return naoEncontrado();
  carregar();
});