/* Previsão de equipe (Expert): simulador, previsão por projeto e indicadores de carga. */
const el = Atenas.el;
const resultado = document.getElementById('resultado');
const numero = document.getElementById('resultado-numero');
const unidade = document.getElementById('resultado-unidade');
const detalhe = document.getElementById('resultado-detalhe');
const selProjeto = document.getElementById('sel-projeto');

function mostrarPrevisao(r) {
  if (!r.ok) return; // o aviso de erro já foi mostrado por Atenas.api
  const previsto = Number(r.dados.funcionarios_previstos);
  const inteiro = Math.max(1, Math.ceil(previsto));

  resultado.classList.remove('resultado--vazio');
  numero.textContent = String(inteiro);
  unidade.textContent = inteiro === 1 ? 'funcionário' : 'funcionários';

  const partes = ['previsão bruta: ' + previsto.toFixed(1)];
  if (r.dados.amostras_reais !== undefined) {
    partes.push(r.dados.amostras_reais + ' projetos seus concluídos + ' + r.dados.amostras_exemplo + ' de exemplo');
  }
  if (r.dados.r2 !== undefined && r.dados.r2 !== null) partes.push('R² = ' + Number(r.dados.r2).toFixed(2));
  if (r.dados.fora_da_faixa && r.dados.fora_da_faixa.length > 0) {
    partes.push('atenção: ' + r.dados.fora_da_faixa.join(', ') + ' fora do que o modelo já viu (previsão menos confiável)');
  }
  if (r.dados.historico_indisponivel) partes.push('histórico indisponível agora: usando só os projetos de exemplo');
  detalhe.textContent = partes.join(' · ');
}

document.getElementById('form-simulador').addEventListener('submit', async function (evento) {
  evento.preventDefault();
  mostrarPrevisao(await Atenas.api('/api/previsao', {
    method: 'POST',
    body: JSON.stringify({
      n_itens: document.getElementById('sim-itens').value,
      qtd_total: document.getElementById('sim-qtd').value,
      n_atividades: document.getElementById('sim-atividades').value,
      prazo_dias: document.getElementById('sim-prazo').value,
    }),
  }));
});

async function preverProjeto() {
  if (!selProjeto.value) return;
  mostrarPrevisao(await Atenas.api('/api/previsao/projeto/' + selProjeto.value));
}
document.getElementById('form-projeto-previsao').addEventListener('submit', function (evento) {
  evento.preventDefault();
  preverProjeto();
});

function barras(raiz, linhas, rotulo, valor, alerta) {
  raiz.innerHTML = '';
  if (linhas.length === 0) { raiz.appendChild(el('p', 'Sem dados ainda.', 'texto-suave sem-margem')); return; }
  const maximo = Math.max.apply(null, [1].concat(linhas.map(valor)));
  linhas.forEach(function (linha) {
    const bloco = el('div', undefined, 'barra-linha');
    const topo = el('div', undefined, 'barra-linha__rotulo');
    topo.append(el('span', rotulo(linha)), el('strong', String(valor(linha))));
    const trilho = el('div', undefined, 'barra-trilho');
    const barra = el('div', undefined, 'barra' + (alerta(linha) ? ' barra--alerta' : ''));
    barra.style.width = Math.max(4, (valor(linha) / maximo) * 100) + '%';
    trilho.appendChild(barra);
    bloco.append(topo, trilho);
    raiz.appendChild(bloco);
  });
}

async function carregarIndicadores() {
  const r = await Atenas.api('/api/indicadores');
  if (!r.ok) return;
  const carga = r.dados.carga;
  const media = carga.length ? carga.reduce(function (s, c) { return s + c.demandas_abertas; }, 0) / carga.length : 0;
  const nomes = { montagem: 'Montagem', almoxarifado: 'Almoxarifado', usinagem: 'Usinagem' };

  // sobrecarga: bem acima da média da equipe (e com mais de 2 demandas abertas)
  barras(document.getElementById('lista-carga'), carga,
    function (c) { return c.nome; }, function (c) { return c.demandas_abertas; },
    function (c) { return carga.length > 1 && c.demandas_abertas > media * 1.5 && c.demandas_abertas > 2; });
  barras(document.getElementById('lista-atividades'), r.dados.por_atividade,
    function (a) { return nomes[a.atividade] || a.atividade; }, function (a) { return a.abertas; }, function () { return false; });
  document.getElementById('resumo-projetos').textContent =
    'Projetos ativos: ' + r.dados.projetos.ativos + ' · concluídos: ' + r.dados.projetos.concluidos;
}

async function carregarProjetos() {
  const r = await Atenas.api('/api/projetos', { silencioso: true });
  selProjeto.innerHTML = '';
  const meus = (r.ok ? r.dados : []).filter(function (p) { return p.sou_dono && p.status === 'ativo'; });
  if (meus.length === 0) {
    const opcao = el('option', 'Nenhum projeto ativo seu');
    opcao.value = '';
    selProjeto.appendChild(opcao);
    return;
  }
  meus.forEach(function (p) {
    const opcao = el('option', p.nome);
    opcao.value = p.id;
    selProjeto.appendChild(opcao);
  });
  // vindo da página de um projeto (?projeto=ID), já seleciona e calcula
  const pedido = new URLSearchParams(window.location.search).get('projeto');
  if (pedido && meus.some(function (p) { return String(p.id) === pedido; })) {
    selProjeto.value = pedido;
    preverProjeto();
  }
}

Atenas.pronto.then(function () {
  // a trava de verdade está no backend (403); aqui só escolhemos o que mostrar
  if (!Atenas.ehExpert()) {
    document.getElementById('bloqueio').hidden = false;
    return;
  }
  document.getElementById('conteudo-previsao').hidden = false;
  carregarIndicadores();
  carregarProjetos();
});
