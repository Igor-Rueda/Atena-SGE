/* Painel admin: usuários por plano, assinaturas ativas, MRR de teste, webhooks e eventos do log. */
const el = Atenas.el;

const dinheiro = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

function dataHora(valor) {
  const d = new Date(valor);
  return isNaN(d) ? '—' : d.toLocaleString('pt-BR');
}

// o log-service pode devolver uma lista ou um objeto com a lista dentro; os nomes dos campos também podem variar
function listaDoLog(dados) {
  if (Array.isArray(dados)) return dados;
  return dados.eventos || dados.items || dados.dados || [];
}
function horaDoEvento(e) {
  const direto = e.criado_em || e.data || e.timestamp || e.ts || e.horario;
  if (direto) return dataHora(direto);
  const idStream = typeof e.id === 'string' ? Number(e.id.split('-')[0]) : NaN; // id do Redis Stream = milissegundos
  return idStream > 1e12 ? dataHora(idStream) : '—';
}

function cartaoMetrica(rotulo, valor, nota) {
  const c = el('div', undefined, 'cartao admin-metrica');
  c.appendChild(el('p', rotulo, 'admin-metrica__rotulo'));
  c.appendChild(el('p', valor, 'admin-metrica__valor'));
  if (nota) c.appendChild(el('p', nota, 'admin-metrica__nota'));
  return c;
}

function preencherTabela(tabela, colunas, linhas, vazio) {
  tabela.replaceChildren();
  if (!linhas.length) {
    const tr = el('tr'); const td = el('td', vazio, 'admin-vazio'); td.colSpan = colunas.length;
    tr.appendChild(td); tabela.appendChild(tr);
    return;
  }
  const cab = el('tr');
  colunas.forEach(function (c) { cab.appendChild(el('th', c)); });
  const thead = el('thead'); thead.appendChild(cab);
  const tbody = el('tbody');
  linhas.forEach(function (celulas) {
    const tr = el('tr');
    celulas.forEach(function (t) { tr.appendChild(el('td', t)); });
    tbody.appendChild(tr);
  });
  tabela.append(thead, tbody);
}

async function carregar() {
  const [resumo, log] = await Promise.all([
    Atenas.api('/api/admin/resumo', { silencioso: true }),
    Atenas.api('/api/logs?limit=15', { silencioso: true }),
  ]);

  if (!resumo.ok) {
    Atenas.aviso(resumo.dados.mensagem || 'Não foi possível carregar o resumo.');
  } else {
    const d = resumo.dados;
    const cartoes = document.getElementById('resumo');
    cartoes.replaceChildren(
      cartaoMetrica('Assinaturas ativas', String(d.assinaturas_ativas), d.assinaturas_inadimplentes ? d.assinaturas_inadimplentes + ' inadimplente(s)' : 'Nenhuma inadimplente'),
      cartaoMetrica('MRR (teste)', dinheiro.format(d.mrr), 'Soma do valor mensal das assinaturas ativas'),
      cartaoMetrica('Usuários', String(d.total_usuarios), 'Em todos os planos')
    );

    const planos = document.getElementById('por-plano');
    planos.replaceChildren();
    [['professional', 'Professional'], ['expert', 'Expert'], ['admin', 'Admin']].forEach(function (par) {
      const caixa = el('div', undefined, 'admin-plano');
      caixa.append(el('strong', String(d.usuarios[par[0]] || 0)), el('span', par[1]));
      planos.appendChild(caixa);
    });

    preencherTabela(
      document.getElementById('tabela-webhooks'),
      ['Quando', 'Evento', 'Id'],
      (d.ultimos_webhooks || []).map(function (w) { return [dataHora(w.recebido_em), w.tipo, w.id]; }),
      'Nenhum webhook recebido ainda.'
    );
  }

  if (!log.ok) {
    preencherTabela(document.getElementById('tabela-log'), [], [], log.dados.mensagem || 'Não foi possível carregar o log.');
  } else {
    preencherTabela(
      document.getElementById('tabela-log'),
      ['Quando', 'Ação', 'Usuário', 'Detalhe'],
      listaDoLog(log.dados).map(function (e) {
        return [horaDoEvento(e), e.acao || '—', e.usuario_id != null ? String(e.usuario_id) : '—', e.detalhe || ''];
      }),
      'Nenhum evento no log.'
    );
  }
}

Atenas.pronto.then(function (me) {
  if (me.role !== 'admin') {
    Atenas.aviso('Esta página é só para o administrador do produto.');
    setTimeout(function () { window.location.href = '/inicio.html'; }, 1500);
    return;
  }
  document.getElementById('atualizar').addEventListener('click', carregar);
  carregar();
});
