/* Página inicial: saudação, indicadores rápidos e o cartão do plano. */
const el = Atenas.el;

function cartaoDoPlano(role) {
  const raiz = document.getElementById('plano-conteudo');
  raiz.innerHTML = '';
  const expert = role === 'expert' || role === 'admin';

  raiz.appendChild(el('h2', 'Seu plano: ' + Atenas.rotuloPapel(role)));
  const lista = el('ul', undefined, 'lista-check');
  const itens = expert
    ? ['Projetos, itens e demandas sem limite', 'Painel de indicadores e carga por funcionário',
       'Análise: previsão de equipe treinada com o seu histórico (CSV)', 'Exclusão de demandas']
    : ['Até 3 projetos ativos ao mesmo tempo', 'Até 50 itens por projeto', 'Até 20 demandas abertas',
       'Cadastro e acompanhamento das suas demandas'];
  itens.forEach(function (t) { lista.appendChild(el('li', t)); });
  raiz.appendChild(lista);

  if (!expert) {
    const link = el('a', 'Conhecer o plano Expert', 'botao');
    link.href = 'planos.html';
    raiz.appendChild(link);
  }
}

Atenas.pronto.then(async function (me) {
  const primeiro = (me.nome || '').trim().split(/\s+/)[0] || 'por aqui';
  document.getElementById('saudacao').textContent = 'Olá, ' + primeiro;
  document.getElementById('kpi-plano').textContent = Atenas.rotuloPapel(me.role);
  cartaoDoPlano(me.role);

  const resultados = await Promise.all([
    Atenas.api('/api/projetos', { silencioso: true }),
    Atenas.api('/api/demandas', { silencioso: true }),
  ]);
  const projetos = resultados[0];
  const demandas = resultados[1];

  if (projetos.ok) {
    const ativos = projetos.dados.filter(function (p) { return p.status === 'ativo'; }).length;
    document.getElementById('kpi-projetos').textContent = ativos;
    document.getElementById('kpi-projetos-sub').textContent = projetos.dados.length + ' no total';
  }
  if (demandas.ok) {
    const abertas = demandas.dados.filter(function (d) { return d.status !== 'concluida'; }).length;
    document.getElementById('kpi-demandas').textContent = abertas;
  }
});
