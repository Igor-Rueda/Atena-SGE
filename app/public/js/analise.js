/* Análise: previsão de equipe (treino por CSV) e carga da equipe. */
const el = Atenas.el;
const ANALISE = '/api/analise/previsao-equipe';
const LIMITE_BYTES = 2 * 1024 * 1024;

let arquivo = null;   // File escolhido
let previa = null;    // resposta de /previa: { colunas, previa, total_linhas, delimitador }
let papeis = {};      // nome da coluna -> 'alvo' | 'entrada' | 'ignorar'
let modelo = null;    // modelo treinado do usuário (ou null)
let etapa = 'dados';  // 'dados' | 'colunas'
let cargaCarregada = false;

const esperar = function (ms) { return new Promise(function (resolver) { setTimeout(resolver, ms); }); };
const $ = function (id) { return document.getElementById(id); };

function rotulo(nome) {
  const texto = String(nome).replace(/_/g, ' ').trim();
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}
function numero(valor, casas) {
  if (valor === null || valor === undefined || !isFinite(valor)) return '—';
  return Number(valor).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: casas === undefined ? 2 : casas });
}

// ---------- abas ----------
function mostrarAba(nome) {
  document.querySelectorAll('[data-aba]').forEach(function (botao) {
    botao.setAttribute('aria-pressed', String(botao.dataset.aba === nome));
  });
  $('aba-previsao').hidden = nome !== 'previsao';
  $('aba-carga').hidden = nome !== 'carga';
  if (nome === 'carga' && !cargaCarregada) carregarCarga();
}
document.querySelectorAll('[data-aba]').forEach(function (botao) {
  botao.addEventListener('click', function () { mostrarAba(botao.dataset.aba); });
});

// ---------- estado de carregamento ----------
function setCarregando(mostrar, texto) {
  $('treinando').hidden = !mostrar;
  if (texto) $('treinando-texto').textContent = texto;
  if (mostrar) {
    $('etapa-dados').hidden = true;
    $('etapa-colunas').hidden = true;
  } else {
    mostrarEtapa(etapa);
  }
}

function mostrarEtapa(nome) {
  etapa = nome;
  $('etapa-dados').hidden = nome !== 'dados';
  $('etapa-colunas').hidden = nome !== 'colunas';
  $('marcador-dados').toggleAttribute('aria-current', nome === 'dados');
  $('marcador-colunas').toggleAttribute('aria-current', nome === 'colunas');
  if (nome === 'dados') $('marcador-dados').setAttribute('aria-current', 'step');
  if (nome === 'colunas') $('marcador-colunas').setAttribute('aria-current', 'step');
  $('marcador-treino').removeAttribute('aria-current');
}

// ---------- 1) dados: envio do CSV ----------
async function receberArquivo(file) {
  if (!file) return;
  if (file.size > LIMITE_BYTES) return Atenas.aviso('O arquivo é grande demais (máximo de 2 MB).');
  if (!/\.(csv|txt)$/i.test(file.name)) {
    return Atenas.aviso('Envie um arquivo CSV. No Excel: Arquivo > Salvar como > CSV.');
  }

  setCarregando(true, 'Lendo o arquivo…');
  const formulario = new FormData();
  formulario.append('arquivo', file);
  const r = await Atenas.api(ANALISE + '/previa', { method: 'POST', body: formulario });
  setCarregando(false);
  if (!r.ok) { $('arquivo-csv').value = ''; return; }

  arquivo = file;
  previa = r.dados;
  papeis = {};
  previa.colunas.forEach(function (c) { papeis[c.nome] = c.sugestao; });
  renderizarColunas();
  mostrarEtapa('colunas');
}

const dropzone = $('dropzone');
$('arquivo-csv').addEventListener('change', function (e) { receberArquivo(e.target.files[0]); });
['dragenter', 'dragover'].forEach(function (nome) {
  dropzone.addEventListener(nome, function (e) { e.preventDefault(); dropzone.classList.add('arrastando'); });
});
['dragleave', 'drop'].forEach(function (nome) {
  dropzone.addEventListener(nome, function (e) { e.preventDefault(); dropzone.classList.remove('arrastando'); });
});
dropzone.addEventListener('drop', function (e) { receberArquivo(e.dataTransfer.files[0]); });

// ---------- 2) colunas: o que cada coluna representa ----------
function escolhas() {
  const alvo = previa.colunas.filter(function (c) { return papeis[c.nome] === 'alvo'; }).map(function (c) { return c.nome; })[0] || null;
  const entradas = previa.colunas.filter(function (c) { return papeis[c.nome] === 'entrada'; }).map(function (c) { return c.nome; });
  return { alvo: alvo, entradas: entradas };
}

function atualizarResumoColunas() {
  const e = escolhas();
  const resumo = $('mapa-resumo');
  const valido = !!e.alvo && e.entradas.length > 0;
  resumo.className = 'aviso ' + (valido ? 'aviso--info' : 'aviso--erro');
  resumo.textContent = valido
    ? 'Alvo (o que será previsto): ' + e.alvo + ' · Entradas: ' + e.entradas.join(', ')
    : (!e.alvo ? 'Escolha a coluna alvo: o número de funcionários.' : 'Escolha ao menos uma coluna de entrada (por exemplo, demanda e horas).');
  $('btn-treinar').disabled = !valido;
  document.querySelectorAll('[data-coluna]').forEach(function (celula) {
    const papel = papeis[celula.dataset.coluna];
    celula.classList.toggle('coluna-alvo', papel === 'alvo');
    celula.classList.toggle('coluna-ignorada', papel === 'ignorar');
  });
}

function renderizarColunas() {
  $('colunas-resumo-arquivo').textContent =
    arquivo.name + ' · ' + previa.total_linhas + ' linhas · separador: ' + previa.delimitador +
    '. Mostrando as primeiras ' + previa.previa.length + '.';

  const cabecalho = $('mapa-cabecalho');
  cabecalho.innerHTML = '';
  previa.colunas.forEach(function (c) {
    const th = el('th');
    th.scope = 'col';
    th.dataset.coluna = c.nome;
    const nome = el('div', undefined, 'mapa-nome');
    nome.append(el('strong', c.nome), el('span', c.numerica ? 'número' : 'texto', 'etiqueta'));

    const select = el('select');
    select.setAttribute('aria-label', 'Papel da coluna ' + c.nome);
    [['alvo', 'Alvo (funcionários)'], ['entrada', 'Entrada'], ['ignorar', 'Ignorar']].forEach(function (par) {
      if (!c.numerica && par[0] !== 'ignorar') return; // colunas de texto só podem ser ignoradas
      const opcao = el('option', par[1]);
      opcao.value = par[0];
      select.appendChild(opcao);
    });
    select.value = papeis[c.nome];
    select.addEventListener('change', function () {
      if (select.value === 'alvo') {
        // só pode haver uma coluna alvo: a anterior passa a ser ignorada
        previa.colunas.forEach(function (outra) { if (papeis[outra.nome] === 'alvo') papeis[outra.nome] = 'ignorar'; });
      }
      papeis[c.nome] = select.value;
      renderizarColunas();
    });
    th.append(nome, select);
    cabecalho.appendChild(th);
  });

  const corpo = $('mapa-previa');
  corpo.innerHTML = '';
  previa.previa.forEach(function (linha) {
    const tr = el('tr');
    previa.colunas.forEach(function (c, i) {
      const td = el('td', linha[i]);
      td.dataset.coluna = c.nome;
      tr.appendChild(td);
    });
    corpo.appendChild(tr);
  });
  atualizarResumoColunas();
}

$('btn-voltar').addEventListener('click', function () {
  arquivo = null; previa = null; $('arquivo-csv').value = '';
  mostrarEtapa('dados');
});

// ---------- 3) treinar ----------
$('btn-treinar').addEventListener('click', async function () {
  const e = escolhas();
  if (!e.alvo || e.entradas.length === 0) return;

  const formulario = new FormData();
  formulario.append('arquivo', arquivo);
  formulario.append('alvo', e.alvo);
  formulario.append('entradas', JSON.stringify(e.entradas));

  setCarregando(true, 'Treinando o modelo…');
  $('marcador-treino').setAttribute('aria-current', 'step');
  // a espera mínima evita que o aviso de carregamento "pisque" quando o treino é instantâneo
  const resultados = await Promise.all([Atenas.api(ANALISE + '/treinar', { method: 'POST', body: formulario }), esperar(900)]);
  const r = resultados[0];
  setCarregando(false);
  if (!r.ok) { mostrarEtapa('colunas'); return; }

  modelo = r.dados;
  arquivo = null; previa = null; $('arquivo-csv').value = '';
  mostrarEtapa('dados');
  Atenas.aviso('Modelo treinado com sucesso.', 'sucesso');
  renderizarModelo();
  $('cartao-modelo').scrollIntoView({ behavior: 'smooth' });
});

// ---------- modelo treinado ----------
function metrica(valor, rotuloTexto, dica) {
  const caixa = el('div', undefined, 'metrica');
  caixa.title = dica;
  caixa.append(el('div', valor, 'metrica__valor'), el('div', rotuloTexto, 'metrica__rotulo'));
  return caixa;
}

function svg(tag, atributos) {
  const e = document.createElementNS('http://www.w3.org/2000/svg', tag);
  Object.keys(atributos || {}).forEach(function (k) { e.setAttribute(k, atributos[k]); });
  return e;
}

// dispersão: previsto (eixo x) contra real (eixo y); a diagonal tracejada é o acerto perfeito
function graficoAjuste(pontos) {
  const L = 360, A = 260, margem = { e: 40, d: 14, t: 14, b: 34 };
  let minimo = Infinity, maximo = -Infinity;
  pontos.forEach(function (p) { minimo = Math.min(minimo, p.real, p.previsto); maximo = Math.max(maximo, p.real, p.previsto); });
  if (minimo === maximo) { minimo -= 1; maximo += 1; }
  const folga = (maximo - minimo) * 0.08;
  minimo -= folga; maximo += folga;
  const x = function (v) { return margem.e + (v - minimo) / (maximo - minimo) * (L - margem.e - margem.d); };
  const y = function (v) { return A - margem.b - (v - minimo) / (maximo - minimo) * (A - margem.t - margem.b); };

  const grafico = svg('svg', { viewBox: '0 0 ' + L + ' ' + A, class: 'grafico', role: 'img', 'aria-label': 'Gráfico de valores reais contra valores previstos' });
  grafico.appendChild(svg('line', { x1: x(minimo), y1: y(minimo), x2: x(maximo), y2: y(maximo), stroke: '#dcc7b1', 'stroke-width': 1.5, 'stroke-dasharray': '5 4' }));
  grafico.appendChild(svg('line', { x1: margem.e, y1: A - margem.b, x2: L - margem.d, y2: A - margem.b, stroke: '#dcc7b1' }));
  grafico.appendChild(svg('line', { x1: margem.e, y1: margem.t, x2: margem.e, y2: A - margem.b, stroke: '#dcc7b1' }));
  pontos.forEach(function (p) {
    grafico.appendChild(svg('circle', { cx: x(p.previsto), cy: y(p.real), r: 4, fill: '#8f6748', 'fill-opacity': 0.8 }));
  });
  [[minimo, 'minimo'], [maximo, 'maximo']].forEach(function (par) {
    const texto = svg('text', { x: margem.e - 6, y: y(par[0]) + 3, 'text-anchor': 'end' });
    texto.textContent = numero(par[0], 1);
    grafico.appendChild(texto);
    const base = svg('text', { x: x(par[0]), y: A - margem.b + 14, 'text-anchor': 'middle' });
    base.textContent = numero(par[0], 1);
    grafico.appendChild(base);
  });
  const eixoX = svg('text', { x: (L + margem.e) / 2, y: A - 6, 'text-anchor': 'middle' });
  eixoX.textContent = 'Previsto';
  const eixoY = svg('text', { x: 12, y: A / 2, 'text-anchor': 'middle', transform: 'rotate(-90 12 ' + (A / 2) + ')' });
  eixoY.textContent = 'Real';
  grafico.append(eixoX, eixoY);
  return grafico;
}

function renderizarModelo() {
  $('modelo-carregando').hidden = true;
  const temModelo = !!modelo;
  $('cartao-modelo').hidden = !temModelo;
  $('cartao-prever').hidden = !temModelo;
  $('cartao-treino').hidden = temModelo;
  $('titulo-treino').textContent = temModelo ? 'Treinar de novo' : 'Treinar o modelo';
  if (!temModelo) return;

  const m = modelo.metricas;
  $('modelo-resumo').textContent =
    'Treinado em ' + Atenas.formatarData(modelo.treinado_em) + ' com ' + modelo.n_linhas + ' linhas' +
    (modelo.nome_arquivo ? ' de "' + modelo.nome_arquivo + '"' : '') +
    (modelo.linhas_descartadas ? ' (' + modelo.linhas_descartadas + ' descartadas por valores vazios ou não numéricos)' : '') +
    '. Prevê: ' + modelo.alvo + '.';

  const bloco = $('metricas');
  bloco.innerHTML = '';
  bloco.append(
    metrica(numero(m.r2, 3), 'R²', 'Parcela da variação do alvo explicada pelas entradas. Perto de 1 é melhor.'),
    metrica(numero(m.r2_ajustado, 3), 'R² ajustado', 'Como o R², descontando o efeito de usar muitas entradas.'),
    metrica(numero(m.mae, 2), 'Erro médio (MAE)', 'Em média, o modelo erra este tanto, na unidade do alvo.'),
    metrica(numero(m.rmse, 2), 'RMSE', 'Erro quadrático médio: pesa mais os erros grandes.'),
    metrica(numero(m.rmse_loo, 2), 'Erro em validação cruzada', 'Erro estimado em dados que o modelo não viu (deixa um período de fora por vez).')
  );

  const avisos = $('avisos-modelo');
  avisos.innerHTML = '';
  (modelo.avisos || []).forEach(function (texto) { avisos.appendChild(el('p', texto, 'aviso aviso--info')); });

  const corpo = $('tbody-coeficientes');
  corpo.innerHTML = '';
  const intercepto = el('tr');
  intercepto.append(el('td', 'Constante'), el('td', numero(modelo.intercepto, 4), 'num'), el('td', '—'));
  corpo.appendChild(intercepto);
  modelo.coeficientes.forEach(function (c) {
    const linha = el('tr');
    const celula = el('td', undefined, 'celula-barra');
    const trilho = el('div', undefined, 'barra-trilho');
    const barra = el('div', undefined, 'barra');
    barra.style.width = Math.max(3, c.importancia * 100) + '%';
    trilho.appendChild(barra);
    celula.append(el('small', Math.round(c.importancia * 100) + '%'), trilho);
    linha.append(el('td', rotulo(c.nome)), el('td', numero(c.valor, 4), 'num'), celula);
    corpo.appendChild(linha);
  });

  const area = $('grafico-ajuste');
  area.innerHTML = '';
  if (modelo.ajuste && modelo.ajuste.length) area.appendChild(graficoAjuste(modelo.ajuste));

  montarCamposPrevisao();
}

// ---------- previsão ----------
function montarCamposPrevisao() {
  const campos = $('campos-prever');
  campos.innerHTML = '';
  modelo.entradas.forEach(function (nome) {
    const grupo = el('div', undefined, 'campo');
    const etiqueta = el('label', rotulo(nome));
    const entrada = document.createElement('input');
    entrada.type = 'number';
    entrada.min = '0';
    entrada.step = 'any';
    entrada.required = true;
    entrada.id = 'prever-' + nome;
    entrada.dataset.nome = nome;
    etiqueta.htmlFor = entrada.id;
    grupo.append(etiqueta, entrada);
    const faixa = modelo.faixa && modelo.faixa[nome];
    if (faixa) grupo.appendChild(el('span', 'No histórico: de ' + numero(faixa[0]) + ' a ' + numero(faixa[1]), 'campo__ajuda'));
    campos.appendChild(grupo);
  });
  $('resultado').classList.add('resultado--vazio');
  $('resultado-numero').textContent = '—';
  $('resultado-unidade').textContent = 'preencha os valores planejados';
  $('resultado-detalhe').textContent = '';
}

$('form-prever').addEventListener('submit', async function (evento) {
  evento.preventDefault();
  const valores = {};
  document.querySelectorAll('#campos-prever input').forEach(function (campo) { valores[campo.dataset.nome] = Number(campo.value); });
  const r = await Atenas.api(ANALISE + '/prever', { method: 'POST', body: JSON.stringify({ valores: valores }) });
  if (!r.ok) return;

  $('resultado').classList.remove('resultado--vazio');
  $('resultado-numero').textContent = String(r.dados.funcionarios);
  $('resultado-unidade').textContent = r.dados.funcionarios === 1 ? 'funcionário' : 'funcionários';
  const partes = ['valor exato do modelo: ' + numero(r.dados.previsto, 2) + ' (arredondado para cima)'];
  if (r.dados.fora_da_faixa && r.dados.fora_da_faixa.length) {
    partes.push('atenção: ' + r.dados.fora_da_faixa.map(rotulo).join(', ') + ' fora do intervalo do histórico (previsão menos confiável)');
  }
  $('resultado-detalhe').textContent = partes.join(' · ');
});

$('btn-retreinar').addEventListener('click', function () {
  $('cartao-treino').hidden = false;
  $('cartao-treino').scrollIntoView({ behavior: 'smooth' });
});

$('btn-descartar').addEventListener('click', async function () {
  const confirmou = await Atenas.modal({
    titulo: 'Descartar o modelo?', texto: 'Você precisará enviar o histórico e treinar de novo para voltar a prever.',
    confirmar: 'Descartar', perigo: true,
  });
  if (!confirmou) return;
  const r = await Atenas.api(ANALISE + '/modelo', { method: 'DELETE' });
  if (r.ok) { modelo = null; renderizarModelo(); Atenas.aviso('Modelo descartado.', 'sucesso'); }
});

async function carregarModelo() {
  const r = await Atenas.api(ANALISE + '/modelo', { silencioso: true });
  if (r.ok) {
    modelo = r.dados;
  } else {
    modelo = null;
    if (r.status !== 404) Atenas.aviso(r.dados.mensagem || 'Não foi possível consultar o modelo agora.');
  }
  renderizarModelo();
}

// ---------- carga da equipe ----------
function barras(raiz, linhas, rotuloDe, valorDe, alertaDe) {
  raiz.innerHTML = '';
  if (linhas.length === 0) { raiz.appendChild(el('p', 'Sem dados ainda.', 'texto-suave sem-margem')); return; }
  const maximo = Math.max.apply(null, [1].concat(linhas.map(valorDe)));
  linhas.forEach(function (linha) {
    const bloco = el('div', undefined, 'barra-linha');
    const topo = el('div', undefined, 'barra-linha__rotulo');
    topo.append(el('span', rotuloDe(linha)), el('strong', String(valorDe(linha))));
    const trilho = el('div', undefined, 'barra-trilho');
    const barra = el('div', undefined, 'barra' + (alertaDe(linha) ? ' barra--alerta' : ''));
    barra.style.width = Math.max(4, (valorDe(linha) / maximo) * 100) + '%';
    trilho.appendChild(barra);
    bloco.append(topo, trilho);
    raiz.appendChild(bloco);
  });
}

async function carregarCarga() {
  const r = await Atenas.api('/api/indicadores');
  if (!r.ok) return;
  cargaCarregada = true;
  const carga = r.dados.carga;
  const media = carga.length ? carga.reduce(function (s, c) { return s + c.demandas_abertas; }, 0) / carga.length : 0;
  // sobrecarga: bem acima da média da equipe (e com mais de 2 demandas abertas)
  barras($('lista-carga'), carga,
    function (c) { return c.nome; }, function (c) { return c.demandas_abertas; },
    function (c) { return carga.length > 1 && c.demandas_abertas > media * 1.5 && c.demandas_abertas > 2; });
  barras($('lista-processos'), r.dados.por_atividade,
    function (a) { return Atenas.rotuloProcesso(a.atividade); }, function (a) { return a.abertas; }, function () { return false; });
  $('resumo-projetos').textContent = 'Projetos ativos: ' + r.dados.projetos.ativos + ' · concluídos: ' + r.dados.projetos.concluidos;
}

// ---------- início ----------
Atenas.pronto.then(function () {
  // a trava de verdade está no backend (403); aqui só escolhemos o que mostrar
  if (!Atenas.ehExpert()) { $('bloqueio').hidden = false; return; }
  $('conteudo-analise').hidden = false;
  carregarModelo();
});
