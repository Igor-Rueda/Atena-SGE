/* ============================================================================
   Casca do aplicativo (menu lateral) e utilitários compartilhados.

   Cada página traz só o <main>; este script monta o menu em volta dele, confere o login
   e expõe window.Atenas para os scripts das páginas:

     Atenas.pronto                 promessa que resolve com { usuario_id, nome, role }
     Atenas.api(url, opcoes)       fetch com JSON, tratamento de 401/403 e avisos
     Atenas.aviso(texto, tipo)     notificação no canto da tela (erro | sucesso)
     Atenas.modal({...})           diálogo (confirmação ou campo de texto)
     Atenas.abrirModalUpgrade(t)   convite para assinar o plano Expert
     Atenas.icone(nome, tamanho)   SVG inline
   ============================================================================ */
(function () {
  'use strict';

  // ---------- ícones (traçado de 24x24, estilo "linha") ----------
  const CAMINHOS = {
    casa: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>',
    pasta: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    lista: '<rect x="6" y="4" width="12" height="17" rx="2"/><path d="M9 4V3h6v1M9.5 10h5M9.5 14h5"/>',
    grafico: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    estrela: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>',
    usuario: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7"/>',
    sair: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5M21 12H9"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    cadeado: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
    mais: '<path d="M12 5v14M5 12h14"/>',
    seta: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    caixa: '<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="m3 8 9 5 9-5M12 13v8"/>',
    relogio: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    engrenagem: '<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1"/>',
    lixeira: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
    camera: '<path d="M4 8h3l1.5-2h7L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13" r="3.5"/>',
    lapis: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
    busca: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  };

  function icone(nome, tamanho) {
    const t = tamanho || 20;
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + t + '" height="' + t + '" viewBox="0 0 24 24" ' +
      'fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" ' +
      'aria-hidden="true" focusable="false">' + (CAMINHOS[nome] || '') + '</svg>';
  }

  // troca <span data-icone="casa"></span> pelo SVG
  function hidratarIcones(raiz) {
    (raiz || document).querySelectorAll('[data-icone]').forEach(function (el) {
      el.innerHTML = icone(el.dataset.icone, Number(el.dataset.tamanho) || 20);
      el.removeAttribute('data-icone');
    });
  }

  function el(tag, texto, classe) {
    const e = document.createElement(tag);
    if (texto !== undefined && texto !== null) e.textContent = texto;
    if (classe) e.className = classe;
    return e;
  }

  const ROTULO_PAPEL = { professional: 'Professional', expert: 'Expert', admin: 'Admin' };
  function rotuloPapel(role) { return ROTULO_PAPEL[role] || role; }

  // categoria do usuário (hierarquia: o Superior está acima; as outras quatro atuam nos processos, no mesmo nível)
  const ROTULO_CATEGORIA = { superior: 'Superior', planejador: 'Planejador', almoxarife: 'Almoxarife', operador: 'Operador', montador: 'Montador' };
  function rotuloCategoria(categoria) { return ROTULO_CATEGORIA[categoria] || ROTULO_CATEGORIA.superior; }

  // processos, na ordem do fluxo: Planejamento > Almoxarifado > Fabricação > Montagem
  const PROCESSOS = [
    { valor: 'planejamento', rotulo: 'Planejamento' },
    { valor: 'almoxarifado', rotulo: 'Almoxarifado' },
    { valor: 'fabricacao', rotulo: 'Fabricação' },
    { valor: 'montagem', rotulo: 'Montagem' },
  ];
  function rotuloProcesso(valor) {
    const achado = PROCESSOS.find(function (p) { return p.valor === valor; });
    return achado ? achado.rotulo : valor;
  }

  function formatarData(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    return isNaN(d) ? '—' : d.toLocaleDateString('pt-BR');
  }

  // ---------- notificações ----------
  let areaAvisos = null;
  function aviso(texto, tipo) {
    if (!areaAvisos) {
      areaAvisos = el('div', undefined, 'avisos');
      areaAvisos.setAttribute('role', 'status');
      areaAvisos.setAttribute('aria-live', 'polite');
      document.body.appendChild(areaAvisos);
    }
    const item = el('div', texto, 'toast toast--' + (tipo || 'erro'));
    areaAvisos.appendChild(item);
    setTimeout(function () {
      item.classList.add('toast--saindo');
      setTimeout(function () { item.remove(); }, 260);
    }, 5000);
  }

  // ---------- modal ----------
  // Devolve uma promessa: true (confirmou), o texto do campo (se houver campo) ou null (cancelou).
  function modal(opcoes) {
    return new Promise(function (resolver) {
      const fundo = el('div', undefined, 'modal');
      const caixa = el('div', undefined, 'modal__caixa');
      caixa.setAttribute('role', 'dialog');
      caixa.setAttribute('aria-modal', 'true');
      caixa.appendChild(el('h2', opcoes.titulo));
      if (opcoes.texto) caixa.appendChild(el('p', opcoes.texto, 'texto-suave'));

      let campo = null;
      if (opcoes.campo) {
        const grupo = el('div', undefined, 'campo');
        const rotulo = el('label', opcoes.campo.rotulo);
        campo = document.createElement('input');
        campo.type = opcoes.campo.tipo || 'text';
        campo.id = 'modal-campo';
        if (opcoes.campo.min !== undefined) campo.min = opcoes.campo.min;
        if (campo.type === 'number') campo.step = '1';
        rotulo.htmlFor = campo.id;
        grupo.append(rotulo, campo);
        caixa.appendChild(grupo);
      }

      const acoes = el('div', undefined, 'modal__acoes');
      const cancelar = el('button', opcoes.cancelar || 'Cancelar', 'botao botao--secundario');
      const confirmar = el('button', opcoes.confirmar || 'Confirmar', 'botao' + (opcoes.perigo ? ' botao--perigo' : ''));
      cancelar.type = 'button';
      confirmar.type = 'button';
      acoes.append(cancelar, confirmar);
      caixa.appendChild(acoes);
      fundo.appendChild(caixa);
      document.body.appendChild(fundo);

      function fechar(valor) {
        document.removeEventListener('keydown', teclas);
        fundo.remove();
        resolver(valor);
      }
      function teclas(e) {
        if (e.key === 'Escape') fechar(null);
        if (e.key === 'Enter' && campo) { e.preventDefault(); confirmar.click(); }
      }
      cancelar.addEventListener('click', function () { fechar(null); });
      confirmar.addEventListener('click', function () { fechar(campo ? campo.value : true); });
      fundo.addEventListener('click', function (e) { if (e.target === fundo) fechar(null); });
      document.addEventListener('keydown', teclas);
      (campo || confirmar).focus();
    });
  }

  async function abrirModalUpgrade(texto) {
    const ok = await modal({
      titulo: 'Recurso do plano Expert',
      texto: texto || 'Essa ação exige o plano Expert.',
      confirmar: 'Ver planos',
      cancelar: 'Agora não',
    });
    if (ok) window.location.href = '/planos.html';
  }

  // ---------- chamadas à API ----------
  // 401 volta ao login; 403 com "codigo" (limite do plano ou plano insuficiente) abre o convite
  // para assinar; outros erros viram notificação, a menos que { silencioso: true }.
  async function api(url, opcoes) {
    const config = Object.assign({}, opcoes);
    const silencioso = config.silencioso;
    delete config.silencioso;
    const ehFormData = typeof FormData !== 'undefined' && config.body instanceof FormData;
    config.headers = Object.assign(ehFormData ? {} : { 'Content-Type': 'application/json' }, config.headers);

    let resposta;
    try {
      resposta = await fetch(url, config);
    } catch (erro) {
      if (!silencioso) aviso('Não foi possível conectar ao servidor.');
      return { ok: false, status: 0, dados: {} };
    }
    if (resposta.status === 401) {
      window.location.href = '/login.html';
      return new Promise(function () {}); // não segue: a página está sendo trocada
    }
    const dados = await resposta.json().catch(function () { return {}; });
    if (!resposta.ok && !silencioso) {
      if (resposta.status === 403 && dados.codigo) abrirModalUpgrade(dados.mensagem);
      else aviso(dados.mensagem || 'Não foi possível concluir a ação.');
    }
    return { ok: resposta.ok, status: resposta.status, dados: dados };
  }

  // ---------- menu lateral ----------
  const NAVEGACAO = [
    { id: 'inicio', rotulo: 'Início', href: 'inicio.html', icone: 'casa' },
    { titulo: 'Operação' },
    { id: 'projetos', rotulo: 'Projetos', href: 'projetos.html', icone: 'pasta' },
    { id: 'demandas', rotulo: 'Minhas demandas', href: 'demandas.html', icone: 'lista' },
    { id: 'analise', rotulo: 'Análise', href: 'analise.html', icone: 'grafico', expert: true },
    { titulo: 'Conta' },
    { id: 'planos', rotulo: 'Planos', href: 'planos.html', icone: 'estrela' },
    { id: 'perfil', rotulo: 'Perfil', href: 'perfil.html', icone: 'usuario' },
  ];

  const Atenas = { icone: icone, hidratarIcones: hidratarIcones, el: el, aviso: aviso, modal: modal,
    abrirModalUpgrade: abrirModalUpgrade, api: api, rotuloPapel: rotuloPapel, formatarData: formatarData,
    rotuloCategoria: rotuloCategoria, rotuloProcesso: rotuloProcesso, PROCESSOS: PROCESSOS,
    me: null, ehExpert: function () { return !!Atenas.me && (Atenas.me.role === 'expert' || Atenas.me.role === 'admin'); } };
  window.Atenas = Atenas;

  function montarCasca() {
    const principalOriginal = document.querySelector('main');
    if (!principalOriginal) return;
    const ativo = document.body.dataset.menu || document.body.dataset.pagina;

    const app = el('div', undefined, 'app');
    const menu = el('aside', undefined, 'menu');
    menu.id = 'menu';

    const marca = el('a', undefined, 'menu__marca');
    marca.href = 'inicio.html';
    marca.innerHTML = '<img src="assets/logo.png" alt="" onerror="this.style.display=\'none\'">' +
      '<span><strong>Atenas</strong><small>SGE</small></span>';
    menu.appendChild(marca);

    const nav = el('nav', undefined, 'menu__nav');
    nav.setAttribute('aria-label', 'Principal');
    NAVEGACAO.forEach(function (item) {
      if (item.titulo) { nav.appendChild(el('div', item.titulo, 'menu__titulo')); return; }
      const link = el('a', undefined, 'menu__link');
      link.href = item.href;
      link.dataset.item = item.id;
      link.innerHTML = icone(item.icone, 19) + '<span></span>';
      link.querySelector('span').textContent = item.rotulo;
      if (item.expert) {
        const cadeado = el('span', undefined, 'menu__cadeado');
        cadeado.id = 'menu-cadeado';
        cadeado.hidden = true;
        cadeado.title = 'Recurso do plano Expert';
        cadeado.innerHTML = icone('cadeado', 15);
        link.appendChild(cadeado);
      }
      if (item.id === ativo) link.setAttribute('aria-current', 'page');
      nav.appendChild(link);
    });
    menu.appendChild(nav);

    const rodape = el('div', undefined, 'menu__rodape');
    const usuario = el('div', undefined, 'usuario');
    const avatar = el('span', '', 'avatar');
    avatar.id = 'usuario-avatar';
    const dados = el('div', undefined, 'usuario__dados');
    const nome = el('strong', '');
    nome.id = 'usuario-nome';
    const categoria = el('span', '', 'usuario__categoria');
    categoria.id = 'usuario-categoria';
    const papel = el('span', '', 'etiqueta');
    papel.id = 'usuario-papel';
    dados.append(nome, categoria, papel);
    usuario.append(avatar, dados);
    const sair = el('button', undefined, 'botao botao--fantasma botao--bloco');
    sair.type = 'button';
    sair.innerHTML = icone('sair', 18) + '<span>Sair</span>';
    sair.addEventListener('click', async function () {
      try { await fetch('/api/auth/logout', { method: 'POST' }); } catch (e) { /* segue para o login */ }
      window.location.href = '/login.html';
    });
    rodape.append(usuario, sair);
    menu.appendChild(rodape);

    const fundo = el('div', undefined, 'menu-fundo');
    const principal = el('div', undefined, 'principal');

    const topo = el('header', undefined, 'topo-mobile');
    const botaoMenu = el('button', undefined, 'botao botao--fantasma botao--pequeno');
    botaoMenu.type = 'button';
    botaoMenu.setAttribute('aria-label', 'Abrir menu');
    botaoMenu.setAttribute('aria-controls', 'menu');
    botaoMenu.innerHTML = icone('menu', 22);
    topo.append(botaoMenu, el('strong', 'Atenas SGE'));

    const conteudo = el('main', undefined, 'conteudo');
    conteudo.id = 'conteudo';
    while (principalOriginal.firstChild) conteudo.appendChild(principalOriginal.firstChild);
    principalOriginal.remove();

    principal.append(topo, conteudo);
    app.append(menu, fundo, principal);
    document.body.prepend(app);

    function alternarMenu(abrir) { app.classList.toggle('menu-aberto', abrir); }
    botaoMenu.addEventListener('click', function () { alternarMenu(!app.classList.contains('menu-aberto')); });
    fundo.addEventListener('click', function () { alternarMenu(false); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') alternarMenu(false); });
    hidratarIcones(document);
  }

  function preencherUsuario(me) {
    const nome = (me.nome || '').trim();
    const partes = nome.split(/\s+/).filter(Boolean);
    const iniciais = ((partes[0] || '?')[0] + (partes.length > 1 ? partes[partes.length - 1][0] : '')).toUpperCase();
    const avatar = document.getElementById('usuario-avatar');
    const nomeEl = document.getElementById('usuario-nome');
    const papelEl = document.getElementById('usuario-papel');
    if (avatar) avatar.textContent = iniciais;
    if (nomeEl) nomeEl.textContent = nome || 'Usuário';
    const categoriaEl = document.getElementById('usuario-categoria');
    if (categoriaEl) categoriaEl.textContent = rotuloCategoria(me.categoria);
    if (papelEl) {
      papelEl.textContent = rotuloPapel(me.role);
      if (me.role === 'expert' || me.role === 'admin') papelEl.classList.add('etiqueta--expert');
    }
    const cadeado = document.getElementById('menu-cadeado');
    if (cadeado) cadeado.hidden = me.role !== 'professional';
    // O Superior supervisiona projetos e não tem fila de demandas: o item some do menu
    const linkDemandas = document.querySelector('.menu__link[data-item="demandas"]');
    if (linkDemandas) linkDemandas.style.display = me.categoria === 'superior' ? 'none' : '';
  }

  montarCasca();

  Atenas.pronto = (async function () {
    const resposta = await fetch('/api/me');
    if (resposta.status === 401) {
      window.location.href = '/login.html';
      return new Promise(function () {});
    }
    const me = await resposta.json();
    Atenas.me = me;
    preencherUsuario(me);
    return me;
  })();
})();