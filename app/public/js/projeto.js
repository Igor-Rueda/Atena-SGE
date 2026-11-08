/* Página de um projeto: dados no topo e fluxo de demandas da produção. */
const el = Atenas.el;
const id = Number(new URLSearchParams(window.location.search).get('id'));

let estado = null; // { projeto, sou_dono, demandas }
let editandoId = null; // demanda em edição (null = criando)
let editarPendente = Number(new URLSearchParams(window.location.search).get('editar')) || null; // vindo da fila

const ROTULO_ETAPA = { almoxarifado: 'Almoxarifado', operacao: 'Operação', montagem: 'Montagem', finalizada: 'Finalizada' };

// Cada etapa só é avançada pela categoria dona dela (ou pelo Superior). O servidor valida de novo.
const FLUXO = {
  almoxarifado: { categoria: 'almoxarife', texto: 'Concluir e enviar para Operação' },
  operacao:     { categoria: 'operador',   texto: 'Concluir e enviar para Montagem' },
  montagem:     { categoria: 'montador',   texto: 'Finalizar demanda' },
};

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

// ---------- permissões (espelham as do servidor, que é quem decide) ----------
function podeAvancar(d) {
  const regra = FLUXO[d.etapa_atual];
  if (!regra || !Atenas.me) return false;
  return Atenas.me.categoria === regra.categoria || Atenas.me.categoria === 'superior';
}

function podeGerenciar(d) {
  const me = Atenas.me;
  if (!me || d.etapa_atual === 'finalizada') return false;
  if (me.role === 'admin' || me.categoria === 'superior') return true;
  return me.categoria === 'planejador' && (d.planejador_id === me.usuario_id || estado.sou_dono);
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
  if (r.ok) Atenas.aviso('Etapa avançada.', 'sucesso');
  if (r.ok || r.status === 409) return carregar(); // 409: outra pessoa já moveu, recarrega
  botao.disabled = false;
}

function linhaDemanda(d) {
  const linha = el('div', undefined, 'demanda');
  linha.appendChild(el('span', ROTULO_ETAPA[d.etapa_atual] || d.etapa_atual, 'etiqueta etiqueta--' + d.etapa_atual));

  const info = el('div', undefined, 'demanda__info');
  info.appendChild(el('strong', d.rg + ' — ' + d.nome_material + ' (Qtd: ' + d.quantidade + ')'));
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

  // veio da fila com ?editar=ID: abre o formulário já preenchido
  if (editarPendente) {
    const alvo = estado.demandas.find(function (d) { return d.id === editarPendente; });
    editarPendente = null;
    if (alvo && podeGerenciar(alvo)) iniciarEdicao(alvo);
  }
}

// ---------- formulário de demanda (criar e editar) ----------
function mostrarForm(f, mostrar) {
  f.hidden = !mostrar;
  if (mostrar) f.querySelector('input').focus();
}

const formDemanda = $('form-demanda');
const botaoSalvarDemanda = formDemanda.querySelector('button[type="submit"]');
const textoSalvarOriginal = botaoSalvarDemanda.textContent;

// A demanda sempre nasce no Almoxarifado (o servidor define a etapa): esconde o seletor de etapa.
const seletorEtapa = $('demanda-etapa');
if (seletorEtapa) {
  seletorEtapa.disabled = true;
  const grupo = seletorEtapa.closest('.campo') || seletorEtapa.parentElement;
  if (grupo && grupo !== formDemanda) grupo.style.display = 'none';
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
  const corpo = JSON.stringify({
    rg: $('demanda-rg').value,
    nome_material: $('demanda-nome').value,
    quantidade: $('demanda-qtd').value,
  });

  botaoSalvarDemanda.disabled = true;
  const r = editando
    ? await Atenas.api('/api/demandas/' + editandoId, { method: 'PUT', body: corpo })
    : await Atenas.api('/api/projetos/' + id + '/demandas', { method: 'POST', body: corpo });
  botaoSalvarDemanda.disabled = false;

  if (r.ok) {
    fecharFormDemanda();
    Atenas.aviso(editando ? 'Demanda atualizada.' : 'Demanda criada e enviada para o Almoxarifado.', 'sucesso');
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