/* Aba "Indicadores" da página Análise (plano Expert): demandas por processo (barras verticais)
   e concluídas x pendentes (pizza). Os gráficos são SVG desenhado aqui, sem biblioteca, para sair
   nítido na impressão. Tudo fica dentro de uma função para não colidir com os nomes do analise.js. */
(function () {
  'use strict';

  const el = Atenas.el;
  const NS = 'http://www.w3.org/2000/svg';
  const $ = function (id) { return document.getElementById(id); };

  function svg(tag, atributos, texto) {
    const e = document.createElementNS(NS, tag);
    Object.keys(atributos || {}).forEach(function (k) { e.setAttribute(k, atributos[k]); });
    if (texto !== undefined) e.textContent = texto;
    return e;
  }

  function plural(n, singular, pluralTexto) {
    return n + ' ' + (n === 1 ? singular : pluralTexto);
  }

  // escala do eixo vertical: até 5 divisões de números inteiros
  function escala(max) {
    if (max <= 0) return { topo: 4, passo: 1 };
    const passos = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000];
    const passo = passos.find(function (p) { return Math.ceil(max / p) <= 5; }) || 100000;
    return { topo: Math.ceil(max / passo) * passo, passo: passo };
  }

  // ---------- barras verticais ----------
  function graficoBarras(container, itens) {
    const L = 44, R = 12, T = 24, B = 44, W = 480, H = 300;
    const areaW = W - L - R;
    const areaH = H - T - B;
    const esc = escala(Math.max.apply(null, itens.map(function (i) { return i.total; })));

    const raiz = svg('svg', {
      viewBox: '0 0 ' + W + ' ' + H, class: 'ind-grafico', role: 'img',
      'aria-label': 'Demandas por processo: ' + itens.map(function (i) { return i.rotulo + ' ' + i.total; }).join(', ')
    });

    for (let v = 0; v <= esc.topo; v += esc.passo) {
      const y = T + areaH - (v / esc.topo) * areaH;
      raiz.appendChild(svg('line', { x1: L, x2: W - R, y1: y, y2: y, class: 'ind-linha-grade' }));
      raiz.appendChild(svg('text', { x: L - 8, y: y + 4, 'text-anchor': 'end', class: 'ind-eixo' }, String(v)));
    }

    const faixa = areaW / itens.length;
    const largura = Math.min(80, faixa * 0.6);
    itens.forEach(function (item, i) {
      const x = L + faixa * i + (faixa - largura) / 2;
      const altura = (item.total / esc.topo) * areaH;
      const y = T + areaH - altura;

      const barra = svg('rect', { x: x, y: y, width: largura, height: altura, rx: 4, class: 'ind-barra ind-barra--' + item.processo });
      barra.appendChild(svg('title', {}, item.rotulo + ': ' + plural(item.total, 'demanda', 'demandas')));
      raiz.appendChild(barra);
      raiz.appendChild(svg('text', { x: x + largura / 2, y: y - 6, 'text-anchor': 'middle', class: 'ind-valor' }, String(item.total)));
      raiz.appendChild(svg('text', { x: x + largura / 2, y: H - B + 22, 'text-anchor': 'middle', class: 'ind-rotulo' }, item.rotulo));
    });

    container.innerHTML = '';
    container.appendChild(raiz);
  }

  // ---------- pizza ----------
  function caminhoFatia(cx, cy, r, ini, fim) {
    const x1 = cx + r * Math.cos(ini), y1 = cy + r * Math.sin(ini);
    const x2 = cx + r * Math.cos(fim), y2 = cy + r * Math.sin(fim);
    const grande = (fim - ini) > Math.PI ? 1 : 0;
    return 'M' + cx + ' ' + cy + ' L' + x1 + ' ' + y1 + ' A' + r + ' ' + r + ' 0 ' + grande + ' 1 ' + x2 + ' ' + y2 + ' Z';
  }

  function graficoPizza(container, concluidas, pendentes) {
    const total = concluidas + pendentes;
    const cx = 110, cy = 110, r = 100;
    const fatias = [
      { chave: 'concluidas', rotulo: 'Concluídas', valor: concluidas },
      { chave: 'pendentes', rotulo: 'Pendentes', valor: pendentes },
    ];

    const raiz = svg('svg', {
      viewBox: '0 0 220 220', class: 'ind-grafico ind-grafico--pizza', role: 'img',
      'aria-label': 'Concluídas e pendentes: ' + fatias.map(function (f) { return f.rotulo + ' ' + f.valor; }).join(', ')
    });

    let angulo = -Math.PI / 2; // começa no topo
    fatias.filter(function (f) { return f.valor > 0; }).forEach(function (f) {
      const fim = angulo + (f.valor / total) * 2 * Math.PI;
      const forma = f.valor === total
        ? svg('circle', { cx: cx, cy: cy, r: r, class: 'ind-fatia ind-fatia--' + f.chave })
        : svg('path', { d: caminhoFatia(cx, cy, r, angulo, fim), class: 'ind-fatia ind-fatia--' + f.chave });
      forma.appendChild(svg('title', {}, f.rotulo + ': ' + plural(f.valor, 'demanda', 'demandas')));
      raiz.appendChild(forma);

      const percentual = Math.round((f.valor / total) * 100);
      if (percentual >= 8) {
        const meio = (angulo + fim) / 2;
        const posicao = f.valor === total
          ? { x: cx, y: cy }
          : { x: cx + r * 0.6 * Math.cos(meio), y: cy + r * 0.6 * Math.sin(meio) };
        raiz.appendChild(svg('text', {
          x: posicao.x, y: posicao.y + 5, 'text-anchor': 'middle', class: 'ind-pct ind-pct--' + f.chave
        }, percentual + '%'));
      }
      angulo = fim;
    });

    const legenda = el('ul', undefined, 'ind-legenda');
    fatias.forEach(function (f) {
      const item = el('li');
      item.appendChild(el('span', undefined, 'ind-legenda__cor ind-legenda__cor--' + f.chave));
      const percentual = total ? Math.round((f.valor / total) * 100) : 0;
      item.append(f.rotulo + ': ' + plural(f.valor, 'demanda', 'demandas') + ' (' + percentual + '%)');
      legenda.appendChild(item);
    });

    container.innerHTML = '';
    container.append(raiz, legenda);
  }

  // ---------- dados ----------
  function preencherEmissao() {
    const me = Atenas.me;
    const quem = me ? ' por ' + me.nome + ' (' + Atenas.rotuloCategoria(me.categoria) + ')' : '';
    $('ind-emissao').textContent = 'Emitido em ' + new Date().toLocaleString('pt-BR') + quem;
  }

  async function carregar() {
    if (!Atenas.ehExpert()) return;
    $('ind-carregando').hidden = false;
    $('ind-conteudo').hidden = true;
    $('ind-vazio').hidden = true;
    $('ind-imprimir').hidden = true;

    const r = await Atenas.api('/api/indicadores');
    $('ind-carregando').hidden = true;
    if (!r.ok) return;
    const d = r.dados;

    if (d.total === 0) {
      $('ind-vazio').hidden = false;
      return;
    }

    graficoBarras($('ind-barras'), d.por_processo);
    graficoPizza($('ind-pizza'), d.concluidas, d.pendentes);
    $('ind-resumo-barras').textContent = 'Em andamento: ' + plural(d.pendentes, 'demanda', 'demandas') + ' nos processos.';
    $('ind-resumo-pizza').textContent = 'Total: ' + plural(d.total, 'demanda', 'demandas') + '.';
    $('ind-conteudo').hidden = false;
    $('ind-imprimir').hidden = false;
  }

  // ---------- abas da página Análise ----------
  function abrirAba(nome) {
    document.querySelectorAll('[data-aba]').forEach(function (botao) {
      botao.setAttribute('aria-pressed', String(botao.dataset.aba === nome));
    });
    $('aba-previsao').hidden = nome !== 'previsao';
    $('aba-indicadores').hidden = nome !== 'indicadores';
    document.body.classList.toggle('aba-indicadores', nome === 'indicadores'); // usado pelo estilo de impressão
    history.replaceState(null, '', nome === 'indicadores' ? '#indicadores' : window.location.pathname + window.location.search);
    if (nome === 'indicadores') carregar();
  }

  document.querySelectorAll('[data-aba]').forEach(function (botao) {
    botao.addEventListener('click', function () { abrirAba(botao.dataset.aba); });
  });

  $('ind-imprimir').addEventListener('click', function () { window.print(); });
  window.addEventListener('beforeprint', preencherEmissao); // vale também para Ctrl+P

  Atenas.pronto.then(function () {
    // analise.html#indicadores abre direto na aba (link de outras telas)
    if (Atenas.ehExpert() && window.location.hash === '#indicadores') abrirAba('indicadores');
  });
})();
