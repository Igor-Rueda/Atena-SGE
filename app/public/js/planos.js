/* Planos: Professional (gratuito) e Expert. O pagamento e o gerenciamento (trocar de plano, cancelar)
   acontecem nas páginas do Stripe: o cartão nunca passa por aqui. */
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
    recursos: ['Cadastrar, editar e excluir projetos e demandas (conforme a sua categoria)',
      'Ver a fila da sua etapa e avançar demandas', 'Perfil com foto e bio'],
    limites: ['Até 3 projetos ativos', 'Até 50 demandas abertas',
      'Sem painel de indicadores', 'Sem análise (previsão de equipe)'],
  },
  {
    role: 'expert',
    nome: 'Expert',
    preco: 'R$ 149',
    periodo: '/mês',
    descricao: 'Para decidir quantas pessoas alocar e evitar a sobrecarga da equipe.',
    recursos: ['Tudo do plano Professional, sem limites de uso',
      'Indicadores: demandas por processo e concluídas × pendentes (com impressão)',
      'Análise: previsão de equipe treinada com o seu histórico (CSV)'],
    limites: [],
    destaque: true,
  },
];

// estados em que ainda faz sentido abrir o portal (trocar de plano, atualizar o cartão, cancelar)
const STATUS_GERENCIAVEIS = ['active', 'trialing', 'past_due', 'unpaid'];

async function assinar(plano, botao) {
  botao.disabled = true;
  const r = await Atenas.api('/api/assinatura/checkout', { method: 'POST', body: JSON.stringify({ plano: plano }) });
  if (r.ok && r.dados.url) {
    window.location.href = r.dados.url; // o cartão é digitado na página do Stripe, nunca aqui
    return;
  }
  botao.disabled = false;
}

// abre o portal do cliente do Stripe, onde a pessoa troca de plano e cancela sozinha
async function gerenciarAssinatura(botao) {
  botao.disabled = true;
  const r = await Atenas.api('/api/assinatura/portal', { method: 'POST' });
  if (r.ok && r.dados.url) {
    window.location.href = r.dados.url;
    return;
  }
  botao.disabled = false;
}

function lista(itens, classe) {
  const ul = el('ul', undefined, 'plano__lista' + (classe ? ' ' + classe : ''));
  itens.forEach(function (t) { ul.appendChild(el('li', t)); });
  return ul;
}

// Bloco no topo: mostra o estado da assinatura (a cópia que os webhooks mantêm) e o botão do portal
function mostrarAssinatura(estado) {
  const secao = document.getElementById('assinatura');
  if (!estado || !STATUS_GERENCIAVEIS.includes(estado.status)) return;

  secao.replaceChildren();
  secao.appendChild(el('h2', 'Sua assinatura'));

  if (estado.inadimplente) {
    secao.appendChild(el('p', 'A última cobrança da sua assinatura foi recusada, e o acesso aos recursos do Expert está suspenso. ' +
      'Atualize o cartão em "Gerenciar assinatura": quando o pagamento for confirmado, o acesso volta sozinho.', 'plano__descricao'));
  } else if (estado.cancelamento_agendado) {
    secao.appendChild(el('p', 'Sua assinatura está cancelada e vale até ' + Atenas.formatarData(estado.periodo_fim) + '. Depois disso a conta volta ao plano gratuito.', 'plano__descricao'));
  } else {
    secao.appendChild(el('p', 'Assinatura Expert ativa' + (estado.periodo_fim ? ', com renovação em ' + Atenas.formatarData(estado.periodo_fim) : '') + '.', 'plano__descricao'));
  }

  const botao = el('button', 'Gerenciar assinatura', 'botao botao--secundario');
  botao.type = 'button';
  botao.addEventListener('click', function () { gerenciarAssinatura(botao); });
  secao.appendChild(botao);
  secao.hidden = false;
}

Atenas.pronto.then(async function (me) {
  const params = new URLSearchParams(window.location.search);
  if (params.get('cancelado')) {
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

  // admin não assina; os demais veem o estado da assinatura (se existir) e o botão do portal
  if (!ehAdmin) {
    const r = await Atenas.api('/api/assinatura', { silencioso: true });
    if (r.ok) mostrarAssinatura(r.dados);
  }
});