/* Página de um projeto: dados no topo, depois os itens (RGs) e as demandas. */
const el = Atenas.el;
const id = Number(new URLSearchParams(window.location.search).get('id'));

let estado = null; // { projeto, sou_dono, itens, demandas }

const ROTULO_STATUS = { aberta: 'Aberta', em_andamento: 'Em andamento', concluida: 'Concluída' };

function naoEncontrado() {
  document.getElementById('carregando').hidden = true;
  document.getElementById('nao-encontrado').hidden = false;
  document.getElementById('migalha-nome').textContent = 'Não encontrado';
}

async function carregar() {
  const r = await Atenas.api('/api/projetos/' + id, { silencioso: true });
  if (r.status === 404) return naoEncontrado();
  if (!r.ok) {
    document.getElementById('carregando').hidden = true;
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
  const unidades = estado.itens.reduce(function (soma, i) { return soma + Number(i.quantidade); }, 0);

  document.title = p.nome + ' — Atenas SGE';
  document.getElementById('migalha-nome').textContent = p.nome;
  document.getElementById('p-nome').textContent = p.nome;
  document.getElementById('p-descricao').textContent = p.descricao || 'Sem descrição.';

  const etiquetas = document.getElementById('p-etiquetas');
  etiquetas.innerHTML = '';
  etiquetas.appendChild(el('span', ativo ? 'Ativo' : 'Concluído', 'etiqueta etiqueta--' + p.status));
  if (!estado.sou_dono) etiquetas.appendChild(el('span', 'Atribuído a você', 'etiqueta'));

  document.getElementById('d-prazo').textContent = p.prazo_dias ? p.prazo_dias + ' dias' : 'Sem prazo';
  document.getElementById('d-criado').textContent = Atenas.formatarData(p.criado_em);
  document.getElementById('d-itens').textContent = estado.itens.length;
  document.getElementById('d-unidades').textContent = unidades;
  const consumidas = estado.itens.reduce(function (soma, i) { return soma + (i.concluido ? Number(i.quantidade) : 0); }, 0);
  document.getElementById('d-consumidas').textContent = consumidas + ' de ' + unidades;
  document.getElementById('d-demandas').textContent = estado.demandas.length;
  document.getElementById('d-equipe').textContent = p.funcionarios_usados ? p.funcionarios_usados : '—';

  document.getElementById('btn-concluir').hidden = !(estado.sou_dono && ativo);
}

// ---------- itens (RGs) ----------
// um item é concluído quando é consumido na montagem: quem registra é o Montador (ou o dono do projeto)
function podeRegistrarConsumo() {
  return estado.sou_dono || (Atenas.me && Atenas.me.categoria === 'montador');
}

async function alternarConsumo(item, botao) {
  botao.disabled = true;
  const r = await Atenas.api('/api/projetos/' + id + '/itens/' + item.id + '/concluir', {
    method: 'PATCH', body: JSON.stringify({ concluido: !item.concluido }),
  });
  if (r.ok) { Atenas.aviso(r.dados.mensagem, 'sucesso'); carregar(); } else { botao.disabled = false; }
}

function renderizarItens() {
  const termo = document.getElementById('busca-itens').value.trim().toLowerCase();
  const itens = estado.itens.filter(function (i) {
    return !termo || i.rg.toLowerCase().includes(termo) || i.nome.toLowerCase().includes(termo);
  });
  const corpo = document.getElementById('tbody-itens');
  corpo.innerHTML = '';

  itens.forEach(function (i) {
    const linha = el('tr');
    const rg = el('td'); rg.appendChild(el('span', i.rg, 'codigo'));
    const situacao = el('td');
    situacao.appendChild(el('span', i.concluido ? 'Consumido' : 'Pendente', 'etiqueta ' + (i.concluido ? 'etiqueta--concluido' : 'etiqueta--ativo')));
    if (i.concluido && i.concluido_em) situacao.appendChild(el('small', ' ' + Atenas.formatarData(i.concluido_em), 'texto-suave'));
    const acao = el('td', undefined, 'num');
    if (podeRegistrarConsumo()) {
      const botao = el('button', i.concluido ? 'Desfazer' : 'Marcar como consumido', 'botao botao--secundario botao--pequeno');
      botao.type = 'button';
      botao.addEventListener('click', function () { alternarConsumo(i, botao); });
      acao.appendChild(botao);
    }
    linha.append(rg, el('td', i.nome), el('td', String(i.quantidade), 'num'), situacao, acao);
    corpo.appendChild(linha);
  });

  document.getElementById('c-itens').textContent = estado.itens.length;
  const semItens = estado.itens.length === 0;
  document.getElementById('tabela-itens').hidden = itens.length === 0;
  document.getElementById('vazio-itens').hidden = !semItens;
  document.getElementById('sem-resultado').hidden = semItens || itens.length > 0;
  document.getElementById('ferramentas-itens').hidden = semItens;
  document.getElementById('btn-add-item').hidden = !estado.sou_dono;
}

// ---------- demandas ----------
function linhaDemanda(d) {
  const linha = el('div', undefined, 'demanda');
  linha.appendChild(el('span', Atenas.rotuloProcesso(d.atividade), 'etiqueta'));

  const info = el('div', undefined, 'demanda__info');
  info.appendChild(el('strong', d.descricao));
  info.appendChild(el('small', 'Responsável: ' + d.responsavel_nome));
  linha.appendChild(info);

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

  if (estado.sou_dono) {
    // o botão aparece para o dono; só o plano Expert executa a exclusão
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
  const lista = document.getElementById('lista-demandas-projeto');
  lista.innerHTML = '';
  estado.demandas.forEach(function (d) { lista.appendChild(linhaDemanda(d)); });
  document.getElementById('c-demandas').textContent = estado.demandas.length;
  document.getElementById('vazio-demandas').hidden = estado.demandas.length > 0;
  document.getElementById('btn-add-demanda').hidden = !(estado.sou_dono && estado.projeto.status === 'ativo');
}

function renderizar() {
  document.getElementById('carregando').hidden = true;
  document.getElementById('conteudo-projeto').hidden = false;
  renderizarTopo();
  renderizarItens();
  renderizarDemandas();
}

// ---------- formulários e ações ----------
function mostrarForm(form, mostrar) {
  form.hidden = !mostrar;
  if (mostrar) form.querySelector('input').focus();
}

const formItem = document.getElementById('form-item');
document.getElementById('btn-add-item').addEventListener('click', function () { mostrarForm(formItem, formItem.hidden); });
document.getElementById('btn-cancelar-item').addEventListener('click', function () { mostrarForm(formItem, false); formItem.reset(); });
formItem.addEventListener('submit', async function (evento) {
  evento.preventDefault();
  const r = await Atenas.api('/api/projetos/' + id + '/itens', {
    method: 'POST',
    body: JSON.stringify({
      rg: document.getElementById('item-rg').value,
      nome: document.getElementById('item-nome').value,
      quantidade: document.getElementById('item-quantidade').value,
    }),
  });
  if (r.ok) {
    formItem.reset();
    document.getElementById('item-quantidade').value = 1;
    document.getElementById('item-rg').focus();
    Atenas.aviso('Item cadastrado.', 'sucesso');
    carregar();
  }
});

const formDemanda = document.getElementById('form-demanda');
document.getElementById('btn-add-demanda').addEventListener('click', function () { mostrarForm(formDemanda, formDemanda.hidden); });
document.getElementById('btn-cancelar-demanda').addEventListener('click', function () { mostrarForm(formDemanda, false); formDemanda.reset(); });
formDemanda.addEventListener('submit', async function (evento) {
  evento.preventDefault();
  const r = await Atenas.api('/api/projetos/' + id + '/demandas', {
    method: 'POST',
    body: JSON.stringify({
      processo: document.getElementById('demanda-processo').value,
      descricao: document.getElementById('demanda-descricao').value,
      responsavel_email: document.getElementById('demanda-email').value,
    }),
  });
  if (r.ok) {
    formDemanda.reset();
    mostrarForm(formDemanda, false);
    Atenas.aviso('Demanda criada.', 'sucesso');
    carregar();
  }
});

document.getElementById('busca-itens').addEventListener('input', function () { if (estado) renderizarItens(); });

document.getElementById('btn-concluir').addEventListener('click', async function () {
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
  // processos em ordem de fluxo: Planejamento, Almoxarifado, Fabricação e Montagem
  const seletor = document.getElementById('demanda-processo');
  Atenas.PROCESSOS.forEach(function (processo) {
    const opcao = el('option', processo.rotulo);
    opcao.value = processo.valor;
    seletor.appendChild(opcao);
  });
  carregar();
});
