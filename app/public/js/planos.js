/* Planos: Professional (gratuito) e Expert. O pagamento acontece na página do Stripe. */
const el = Atenas.el;

// mesma ordem da hierarquia do backend (admin fica de fora: não é plano vendável)
const ORDEM = ['professional', 'expert'];

// o preço exibido aqui precisa bater com o Price criado no painel do Stripe
const PLANOS = [
  {
    role: 'professional',
    nome: 'Professional',
    preco: 'Grátis',
    periodo: '',
    descricao: 'Para organizar o registro e acompanhar as suas demandas.',
    recursos: ['Cadastrar processos, itens e projetos', 'Ver as suas próprias demandas', 'Perfil com foto e bio'],
    limites: ['Até 3 projetos ativos', 'Até 50 itens por projeto', 'Até 20 demandas abertas',
      'Não exclui demandas', 'Sem painel de indicadores', 'Sem análise (previsão de equipe)'],
  },
  {
    role: 'expert',
    nome: 'Expert',
    preco: 'R$ 149',
    periodo: '/mês',
    descricao: 'Para decidir quantas pessoas alocar e evitar a sobrecarga da equipe.',
    recursos: ['Tudo do plano Professional, sem limites de uso', 'Painel de indicadores e carga por funcionário',
      'Análise: previsão de equipe treinada com o seu histórico (CSV)', 'Excluir demandas'],
    limites: [],
    destaque: true,
  },
];

async function assinar(plano, botao) {
  botao.disabled = true;
  const r = await Atenas.api('/api/assinatura/checkout', { method: 'POST', body: JSON.stringify({ plano: plano }) });
  if (r.ok && r.dados.url) {
    window.location.href = r.dados.url; // o cartão é digitado na página do Stripe, nunca aqui
    return;
  }
  botao.disabled = false;
}

function lista(itens, classe) {
  const ul = el('ul', undefined, 'plano__lista' + (classe ? ' ' + classe : ''));
  itens.forEach(function (t) { ul.appendChild(el('li', t)); });
  return ul;
}

Atenas.pronto.then(function (me) {
  if (new URLSearchParams(window.location.search).get('cancelado')) {
    Atenas.aviso('Pagamento cancelado. Nenhuma cobrança foi feita.', 'sucesso');
  }

  const grade = document.getElementById('grade-planos');
  const ehAdmin = me.role === 'admin';
  const nivelAtual = ORDEM.indexOf(me.role); // admin = -1 (não aparece como plano)

  PLANOS.forEach(function (plano) {
    const cartao = el('article', undefined, 'cartao plano' + (plano.destaque ? ' plano--destaque' : ''));
    if (plano.destaque) cartao.appendChild(el('span', 'Recomendado', 'etiqueta etiqueta--expert plano__selo'));

    cartao.appendChild(el('h2', plano.nome));
    cartao.appendChild(el('p', plano.descricao, 'plano__descricao'));

    const preco = el('div', plano.preco, 'plano__preco');
    if (plano.periodo) preco.appendChild(el('small', ' ' + plano.periodo));
    cartao.appendChild(preco);

    cartao.appendChild(lista(plano.recursos));
    if (plano.limites.length) cartao.appendChild(lista(plano.limites, 'plano__lista--limites'));

    const rodape = el('div', undefined, 'plano__rodape');
    if (plano.role === me.role) {
      rodape.appendChild(el('span', 'Seu plano atual', 'etiqueta etiqueta--ativo'));
    } else if (plano.role !== 'professional' && ORDEM.indexOf(plano.role) > nivelAtual && !ehAdmin) {
      // só oferece upgrade; a validação real continua no backend
      const botao = el('button', 'Assinar ' + plano.nome, 'botao botao--bloco');
      botao.type = 'button';
      botao.addEventListener('click', function () { assinar(plano.role, botao); });
      rodape.appendChild(botao);
    }
    cartao.appendChild(rodape);
    grade.appendChild(cartao);
  });
});
