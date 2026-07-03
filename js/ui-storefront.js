/* =============================================================================
 * ui-storefront.js — Interfaz de la tienda (lo que ve el cliente)
 * -----------------------------------------------------------------------------
 * Construye una sola vez el "shell" (header, menú, navegación inferior, footer)
 * y luego renderiza la vista correspondiente a la ruta en #view. Componentes
 * reutilizables: tarjeta de producto, estrellas, precio, badges, carrusel.
 *
 * Rendimiento: scroll infinito por páginas (CONST.PAGE_SIZE), imágenes con
 * loading="lazy"/decoding="async" e IntersectionObserver para cargar más.
 * ========================================================================== */
(function (App) {
  'use strict';

  const { U, Store, Cart, Search, Router } = App;
  const { PAGE_SIZE } = App.CONST;
  const money = (v) => U.formatCurrency(v, Store.state.settings);

  // Refs del shell
  let dom = {};
  let listObserver = null; // IntersectionObserver del scroll infinito
  let carouselTimer = null;

  /* ======================================================================= *
   *  ICONOS (SVG inline, heredan currentColor)
   * ======================================================================= */
  const ICONS = {
    search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>',
    cart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.7 13.4a2 2 0 0 0 2 1.6h9.7a2 2 0 0 0 2-1.6L23 6H6"/></svg>',
    menu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M3 12h18M3 18h18"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>',
    home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/></svg>',
    tag: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.6 13.4L12 22l-9-9V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><circle cx="7.5" cy="7.5" r="1.5" fill="currentColor"/></svg>',
    grid: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>',
    filter: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6h16M7 12h10M10 18h4"/></svg>',
    chevron: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 6l6 6-6 6"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>',
    minus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14"/></svg>',
    trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>',
    whatsapp: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M.057 24l1.687-6.163a11.867 11.867 0 0 1-1.587-5.946C.16 5.335 5.495 0 12.05 0a11.817 11.817 0 0 1 8.413 3.488 11.824 11.824 0 0 1 3.48 8.414c-.003 6.557-5.338 11.892-11.893 11.892a11.9 11.9 0 0 1-5.688-1.448L.057 24zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884a9.86 9.86 0 0 0 1.51 5.26l-.999 3.648 3.978-1.607zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.71.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z"/></svg>',
    star: '<svg viewBox="0 0 24 24"><path d="M12 2l2.9 6.3 6.9.8-5.1 4.7 1.4 6.8L12 17.8 5.9 21.4l1.4-6.8L2.2 9.9l6.9-.8z"/></svg>',
    box: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 0 0-1-1.7l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.7l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><path d="M3.3 7L12 12l8.7-5M12 22V12"/></svg>',
  };
  function icon(name, cls) {
    const span = U.el('span', { class: 'icon' + (cls ? ' ' + cls : ''), 'aria-hidden': 'true' });
    span.innerHTML = ICONS[name] || '';
    return span;
  }

  /* ======================================================================= *
   *  COMPONENTES REUTILIZABLES
   * ======================================================================= */

  function placeholderImg(text) {
    const initial = (text || '?').trim().charAt(0).toUpperCase();
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400">` +
      `<rect width="400" height="400" fill="#e5e7eb"/>` +
      `<text x="200" y="200" font-size="160" fill="#9ca3af" font-family="Arial" font-weight="700" ` +
      `text-anchor="middle" dominant-baseline="central">${initial}</text></svg>`;
    return 'data:image/svg+xml,' + encodeURIComponent(svg);
  }
  function mainImage(p) {
    return (p.images && p.images[0]) || placeholderImg(p.name);
  }

  /** Imagen representativa de una categoría: la elegida por el admin o la
   *  foto del primer producto activo con imagen REAL de esa categoría
   *  (se saltean los placeholders SVG de importaciones sin fotos). */
  function categoryImage(cat) {
    if (cat.image) return cat.image;
    const p = Store.state.products.find((x) =>
      x.categoryId === cat.id && x.active !== false && x.images && x.images.length &&
      !/^data:image\/svg/i.test(x.images[0]));
    return p ? p.images[0] : '';
  }

  function stars(avg, count, opts = {}) {
    const wrap = U.el('span', { class: 'stars' + (opts.small ? ' stars--sm' : ''), title: avg ? avg.toFixed(1) + ' / 5' : 'Sin calificaciones' });
    const rounded = Math.round(avg);
    for (let i = 1; i <= 5; i++) {
      const s = icon('star', i <= rounded ? 'star--on' : 'star--off');
      wrap.appendChild(s);
    }
    if (opts.showCount) {
      wrap.appendChild(U.el('span', { class: 'stars__count', text: count ? `(${count})` : 'Sin reseñas' }));
    }
    return wrap;
  }

  function priceBlock(p, opts = {}) {
    const eff = Store.effectivePrice(p);
    const cmp = Store.comparePrice(p);
    const onSale = Store.isOnSale(p);
    const wrap = U.el('div', { class: 'price' + (opts.large ? ' price--lg' : '') });
    wrap.appendChild(U.el('span', { class: 'price__now', text: money(eff) }));
    if (onSale) {
      wrap.appendChild(U.el('span', { class: 'price__old', text: money(cmp) }));
    }
    return wrap;
  }

  function badges(p) {
    const wrap = U.el('div', { class: 'badges' });
    const disc = Store.discountPercent(p);
    if (Store.isOnSale(p) && disc > 0) {
      wrap.appendChild(U.el('span', { class: 'badge badge--sale', text: `-${disc}%` }));
    }
    if (p.isNew) wrap.appendChild(U.el('span', { class: 'badge badge--new', text: '🆕 Nuevo' }));
    if ((p.tags || []).indexOf('Oferta') > -1 && !Store.isOnSale(p)) {
      wrap.appendChild(U.el('span', { class: 'badge badge--sale', text: '🔥 Oferta' }));
    }
    if (App.E5 && App.E5.Decorate) App.E5.Decorate.badges(wrap, p); // ETAPA 5: badges de promo
    return wrap;
  }

  function stockTag(p) {
    if (p.stock <= 0) return U.el('span', { class: 'stock stock--out', text: 'Sin stock' });
    if (p.stock <= 5) return U.el('span', { class: 'stock stock--low', text: `¡Últimas ${p.stock}!` });
    return U.el('span', { class: 'stock stock--ok', text: 'En stock' });
  }

  function productCard(p) {
    const r = Store.ratingFor(p.id);
    const card = U.el('article', { class: 'card' });
    const link = U.el('a', { class: 'card__media', href: '#/producto/' + p.id, 'aria-label': p.name });
    const img = U.el('img', { src: mainImage(p), alt: p.name, loading: 'lazy', decoding: 'async' });
    link.appendChild(img);
    link.appendChild(badges(p));
    if (p.stock <= 0) link.appendChild(U.el('span', { class: 'card__soldout', text: 'Sin stock' }));

    const body = U.el('div', { class: 'card__body' });
    if (p.brand) body.appendChild(U.el('span', { class: 'card__brand', text: p.brand }));
    body.appendChild(U.el('a', { class: 'card__name', href: '#/producto/' + p.id, text: p.name }));
    if (r.count) body.appendChild(stars(r.avg, r.count, { small: true, showCount: true }));
    body.appendChild(priceBlock(p));

    const btn = U.el('button', {
      class: 'btn btn--primary card__add', type: 'button',
      disabled: p.stock <= 0 ? true : null,
    }, [icon('cart'), U.el('span', { text: p.stock <= 0 ? 'Sin stock' : 'Agregar' })]);
    btn.addEventListener('click', (e) => { e.preventDefault(); addToCart(p.id); });
    body.appendChild(btn);

    card.appendChild(link);
    card.appendChild(body);
    if (App.E5 && App.E5.Decorate) App.E5.Decorate.card(card, p); // ETAPA 5: favorito
    return card;
  }

  function addToCart(id, qty = 1) {
    Cart.add(id, qty);
    const p = Store.getProduct(id);
    U.toast(`✓ "${p ? p.name : 'Producto'}" agregado`, 'success', 1800);
    pulseCart();
  }
  function pulseCart() {
    if (!dom.cartBtn) return;
    dom.cartBtn.classList.remove('pulse');
    void dom.cartBtn.offsetWidth; // reinicia animación
    dom.cartBtn.classList.add('pulse');
  }

  /* ======================================================================= *
   *  SHELL (header, menú, nav inferior, footer) — se construye una sola vez
   * ======================================================================= */
  function mountShell(root) {
    root.innerHTML = '';

    /* Header */
    const header = U.el('header', { class: 'site-header' });
    const hamburger = U.el('button', { class: 'icon-btn header__menu', 'aria-label': 'Menú', title: 'Categorías' }, icon('menu'));
    hamburger.addEventListener('click', openNav);

    const logo = U.el('a', { class: 'header__logo', href: '#/' });
    const cartBtn = U.el('a', { class: 'icon-btn header__cart', href: '#/carrito', 'aria-label': 'Carrito' }, [
      icon('cart'),
      U.el('span', { class: 'header__cart-count', text: '0' }),
    ]);

    // Buscador con sugerencias
    const searchForm = U.el('form', { class: 'search', role: 'search' });
    const searchInput = U.el('input', {
      class: 'search__input', type: 'search', placeholder: 'Buscar productos, marcas, códigos…',
      'aria-label': 'Buscar', autocomplete: 'off',
    });
    const suggestBox = U.el('div', { class: 'search__suggest', hidden: true });
    searchForm.appendChild(icon('search', 'search__icon'));
    searchForm.appendChild(searchInput);
    searchForm.appendChild(suggestBox);
    searchForm.addEventListener('submit', (e) => {
      e.preventDefault();
      suggestBox.hidden = true;
      Router.go('/buscar', { q: searchInput.value.trim() });
      searchInput.blur();
    });
    searchInput.addEventListener('input', U.debounce(() => renderSuggestions(searchInput.value, suggestBox), 160));
    searchInput.addEventListener('focus', () => { if (searchInput.value.trim()) renderSuggestions(searchInput.value, suggestBox); });
    document.addEventListener('click', (e) => { if (!searchForm.contains(e.target)) suggestBox.hidden = true; });

    const topRow = U.el('div', { class: 'site-header__top' }, [hamburger, logo, cartBtn]);
    header.appendChild(topRow);
    header.appendChild(searchForm);

    // Barra de categorías (desktop)
    const catBar = U.el('nav', { class: 'cat-bar', 'aria-label': 'Categorías' });
    header.appendChild(catBar);

    /* Off-canvas de navegación (mobile) */
    const navDrawer = U.el('aside', { class: 'drawer drawer--left', id: 'nav-drawer', 'aria-hidden': 'true' });
    const navOverlay = U.el('div', { class: 'drawer-overlay', id: 'nav-overlay' });
    navOverlay.addEventListener('click', closeNav);

    /* Main + footer + bottom nav */
    const main = U.el('main', { class: 'view', id: 'view' });
    const bottomNav = U.el('nav', { class: 'bottom-nav', 'aria-label': 'Navegación' });
    const footer = U.el('footer', { class: 'site-footer' });

    root.appendChild(header);
    root.appendChild(navOverlay);
    root.appendChild(navDrawer);
    root.appendChild(main);
    root.appendChild(footer);
    root.appendChild(bottomNav);

    dom = { root, header, logo, cartBtn, cartCount: cartBtn.querySelector('.header__cart-count'),
      searchInput, suggestBox, catBar, navDrawer, navOverlay, main, bottomNav, footer };

    buildBottomNav();
    refreshChrome();

    // Reaccionar a cambios de datos
    Store.on('cart', updateCartCount);
    Store.on('settings', refreshChrome);
    Store.on('categories', () => { buildCatBar(); buildNavDrawer(); });
    updateCartCount();

    // Accesibilidad: Escape cierra el menú de categorías
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeNav(); });
  }

  /** Actualiza branding/colores/menús según settings. */
  function refreshChrome() {
    const s = Store.state.settings;
    applyTheme(s.theme);
    document.title = s.storeName || 'Tienda';
    // Logo
    U.clear(dom.logo);
    if (s.logo) {
      dom.logo.appendChild(U.el('img', { src: s.logo, alt: s.storeName, class: 'header__logo-img' }));
    } else {
      dom.logo.appendChild(U.el('span', { class: 'header__logo-text', text: s.storeName || 'Mi Tienda' }));
    }
    buildCatBar();
    buildNavDrawer();
    buildFooter();
  }

  function applyTheme(theme) {
    if (!theme) return;
    const r = document.documentElement;
    const map = {
      primary: '--c-primary', primaryDark: '--c-primary-dark', accent: '--c-accent',
      bg: '--c-bg', surface: '--c-surface', text: '--c-text', muted: '--c-muted',
      danger: '--c-danger', success: '--c-success',
    };
    Object.keys(map).forEach((k) => { if (theme[k]) r.style.setProperty(map[k], theme[k]); });
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta && theme.primary) meta.setAttribute('content', theme.primary);
  }

  function buildCatBar() {
    if (!dom.catBar) return;
    U.clear(dom.catBar);
    const cats = Store.state.categories.slice().sort((a, b) => (a.order || 0) - (b.order || 0));
    cats.slice(0, 8).forEach((c) => {
      const item = U.el('div', { class: 'cat-bar__item' });
      const link = U.el('a', { class: 'cat-bar__link', href: '#/categoria/' + c.id },
        [U.el('span', { text: (c.icon ? c.icon + ' ' : '') + c.name })]);
      item.appendChild(link);
      if ((c.subcategories || []).length) {
        const menu = U.el('div', { class: 'cat-bar__menu' });
        c.subcategories.forEach((s) => {
          menu.appendChild(U.el('a', { href: `#/categoria/${c.id}/${s.id}`, text: s.name }));
        });
        item.appendChild(menu);
      }
      dom.catBar.appendChild(item);
    });
  }

  function buildNavDrawer() {
    if (!dom.navDrawer) return;
    U.clear(dom.navDrawer);
    const head = U.el('div', { class: 'drawer__head' }, [
      U.el('strong', { text: 'Categorías' }),
      U.el('button', { class: 'icon-btn', 'aria-label': 'Cerrar', onClick: closeNav }, icon('close')),
    ]);
    dom.navDrawer.appendChild(head);

    const list = U.el('div', { class: 'nav-list' });
    list.appendChild(navLink('🏠 Inicio', '#/'));
    list.appendChild(navLink('🔥 Ofertas', '#/ofertas'));
    list.appendChild(navLink('🆕 Novedades', '#/novedades'));
    list.appendChild(navLink('⭐ Destacados', '#/destacados'));
    list.appendChild(U.el('div', { class: 'nav-list__sep' }));

    Store.state.categories.slice().sort((a, b) => (a.order || 0) - (b.order || 0)).forEach((c) => {
      const group = U.el('details', { class: 'nav-group' });
      const sum = U.el('summary', {}, [
        U.el('span', { text: (c.icon ? c.icon + ' ' : '') + c.name }),
      ]);
      sum.addEventListener('click', (e) => {
        // permitir navegar a la categoría tocando el texto, sin togglear si tiene subs
        if (!(c.subcategories || []).length) { e.preventDefault(); closeNav(); Router.go('/categoria/' + c.id); }
      });
      group.appendChild(sum);
      const sub = U.el('div', { class: 'nav-group__items' });
      sub.appendChild(navLink('Ver todo', '#/categoria/' + c.id, 'nav-group__all'));
      (c.subcategories || []).forEach((s) => sub.appendChild(navLink(s.name, `#/categoria/${c.id}/${s.id}`)));
      group.appendChild(sub);
      list.appendChild(group);
    });
    dom.navDrawer.appendChild(list);
  }
  function navLink(label, href, cls) {
    const a = U.el('a', { class: 'nav-link' + (cls ? ' ' + cls : ''), href, text: label });
    a.addEventListener('click', closeNav);
    return a;
  }

  function buildBottomNav() {
    U.clear(dom.bottomNav);
    const items = [
      { label: 'Inicio', icon: 'home', href: '#/' },
      { label: 'Categorías', icon: 'grid', action: openNav },
      { label: 'Ofertas', icon: 'tag', href: '#/ofertas' },
      { label: 'Carrito', icon: 'cart', href: '#/carrito', badge: true },
    ];
    items.forEach((it) => {
      const node = it.action
        ? U.el('button', { class: 'bottom-nav__btn', type: 'button', onClick: it.action })
        : U.el('a', { class: 'bottom-nav__btn', href: it.href });
      node.appendChild(icon(it.icon));
      node.appendChild(U.el('span', { text: it.label }));
      if (it.badge) {
        const b = U.el('span', { class: 'bottom-nav__badge', text: '0' });
        node.appendChild(b);
        dom.bottomBadge = b;
      }
      dom.bottomNav.appendChild(node);
    });
  }

  function buildFooter() {
    U.clear(dom.footer);
    const s = Store.state.settings;
    const inner = U.el('div', { class: 'site-footer__inner' }, [
      U.el('p', { class: 'site-footer__name', text: s.storeName || '' }),
      U.el('p', { class: 'site-footer__text', text: s.footer || '' }),
      U.el('a', { class: 'site-footer__admin', href: '#/admin', text: '⚙️ Administrar tienda' }),
    ]);
    dom.footer.appendChild(inner);
  }

  function updateCartCount() {
    const n = Cart.count();
    if (dom.cartCount) { dom.cartCount.textContent = n; dom.cartCount.classList.toggle('is-empty', n === 0); }
    if (dom.bottomBadge) { dom.bottomBadge.textContent = n; dom.bottomBadge.classList.toggle('is-empty', n === 0); }
  }

  function openNav() { dom.navDrawer.classList.add('drawer--open'); dom.navOverlay.classList.add('drawer-overlay--show'); document.body.style.overflow = 'hidden'; }
  function closeNav() { dom.navDrawer.classList.remove('drawer--open'); dom.navOverlay.classList.remove('drawer-overlay--show'); document.body.style.overflow = ''; }

  function renderSuggestions(text, box) {
    U.clear(box);
    // ETAPA 5: sugerencias enriquecidas (productos + marcas + modelos + categorías)
    if (App.E5 && App.E5.SearchSuggest) {
      const items = App.E5.SearchSuggest.rich(text, { limit: 10, productLimit: 6 });
      if (!items.length) { box.hidden = true; return; }
      items.forEach((it) => {
        const row = U.el('a', { class: 'search__suggest-item', href: it.href }, [
          it.image ? U.el('img', { src: it.image, alt: '', loading: 'lazy' }) : U.el('span', { style: { fontSize: '1.2rem', width: '40px', textAlign: 'center' }, text: it.icon || '🔎' }),
          U.el('div', {}, [
            U.el('span', { class: 'search__suggest-name', text: it.label }),
            U.el('span', { class: 'search__suggest-price', text: it.sub || '' }),
          ]),
        ]);
        row.addEventListener('click', () => { box.hidden = true; });
        box.appendChild(row);
      });
      box.hidden = false;
      return;
    }
    const items = Search.suggest(text, 6);
    if (!items.length) { box.hidden = true; return; }
    items.forEach((p) => {
      const row = U.el('a', { class: 'search__suggest-item', href: '#/producto/' + p.id }, [
        U.el('img', { src: mainImage(p), alt: '', loading: 'lazy' }),
        U.el('div', {}, [
          U.el('span', { class: 'search__suggest-name', text: p.name }),
          U.el('span', { class: 'search__suggest-price', text: money(Store.effectivePrice(p)) }),
        ]),
      ]);
      row.addEventListener('click', () => { box.hidden = true; });
      box.appendChild(row);
    });
    box.hidden = false;
  }

  /* ======================================================================= *
   *  ROUTER → VISTAS
   * ======================================================================= */
  function renderRoute(route) {
    if (carouselTimer) { clearInterval(carouselTimer); carouselTimer = null; }
    if (listObserver) { listObserver.disconnect(); listObserver = null; }
    closeNav();
    const seg = route.segments;
    const view = dom.main;
    U.clear(view);
    Router.scrollTop();

    // ETAPA 5: rutas extra (favoritos, comparar, marcas, marca)
    if (App.E5 && App.E5.StorefrontExt && App.E5.StorefrontExt.renderExtraRoute(view, route)) return;
    if (!seg.length) return renderHome(view);
    switch (seg[0]) {
      case 'producto': return renderProduct(view, seg[1]);
      case 'categoria': return renderCategory(view, seg[1], seg[2]);
      case 'ofertas': return renderCatalog(view, { title: '🔥 Ofertas', query: { onSale: true, sort: 'discount' } });
      case 'novedades': return renderCatalog(view, { title: '🆕 Novedades', query: { isNew: true, sort: 'newest' } });
      case 'destacados': return renderCatalog(view, { title: '⭐ Destacados', query: { featured: true } });
      case 'buscar': return renderCatalog(view, { title: route.query.q ? `Resultados: "${route.query.q}"` : 'Buscar', query: { text: route.query.q || '' }, searchTerm: route.query.q || '' });
      case 'carrito': return renderCart(view);
      default: return renderHome(view);
    }
  }

  /* ----- PORTADA --------------------------------------------------------- */
  function renderHome(view) {
    const s = Store.state.settings;
    // ETAPA 5: banner administrable arriba de todo (si hay banners activos)
    if (App.E5 && App.E5.StorefrontExt) App.E5.StorefrontExt.homeTop(view);

    // Hero / Banner
    const hero = U.el('section', { class: 'hero' });
    const bImg = s.banner && s.banner.image;
    if (bImg) hero.style.backgroundImage = `url("${bImg}")`;
    hero.classList.toggle('hero--image', !!bImg);
    // Modo "arte completo": si hay imagen y NO hay título ni subtítulo, la
    // imagen ya trae el diseño (logo/textos) → se muestra limpia, sin
    // oscurecedor ni texto superpuesto, con su proporción real.
    const soloImagen = !!(bImg && !((s.banner.title || '').trim()) && !((s.banner.subtitle || '').trim()));
    hero.classList.toggle('hero--clean', soloImagen);
    if (soloImagen) {
      const probe = new Image();
      probe.onload = () => {
        if (probe.naturalWidth && probe.naturalHeight) {
          hero.style.aspectRatio = probe.naturalWidth + ' / ' + probe.naturalHeight;
        }
      };
      probe.src = bImg;
      if (s.banner.ctaText) {
        hero.appendChild(U.el('a', { class: 'btn btn--accent hero__cta hero__cta--overlay', href: '#/' + (s.banner.ctaTarget || 'ofertas'), text: s.banner.ctaText }));
      }
    } else {
      const heroInner = U.el('div', { class: 'hero__inner' }, [
        U.el('h1', { class: 'hero__title', text: (s.banner && s.banner.title) || s.storeName }),
        U.el('p', { class: 'hero__subtitle', text: (s.banner && s.banner.subtitle) || s.slogan || '' }),
      ]);
      if (s.banner && s.banner.ctaText) {
        heroInner.appendChild(U.el('a', { class: 'btn btn--accent hero__cta', href: '#/' + (s.banner.ctaTarget || 'ofertas'), text: s.banner.ctaText }));
      }
      hero.appendChild(heroInner);
    }
    view.appendChild(hero);

    // Carrusel promocional
    if (s.carousel && s.carousel.slides && s.carousel.slides.length) {
      view.appendChild(buildCarousel(s.carousel));
    }

    // Tira de categorías estilo retail: foto representativa + nombre debajo.
    // Imagen: 1º la elegida por el admin (cat.image), 2º la foto del primer
    // producto de la categoría, 3º el emoji como respaldo.
    const cats = Store.state.categories.slice().sort((a, b) => (a.order || 0) - (b.order || 0));
    if (cats.length) {
      const strip = U.el('div', { class: 'cat-strip' });
      cats.forEach((c) => {
        const img = categoryImage(c);
        const media = U.el('div', { class: 'cat-strip__media' }, [
          img
            ? U.el('img', { src: img, alt: c.name, loading: 'lazy', decoding: 'async' })
            : U.el('span', { class: 'cat-strip__emoji', text: c.icon || '🛍️' }),
        ]);
        strip.appendChild(U.el('a', { class: 'cat-strip__item', href: '#/categoria/' + c.id }, [
          media,
          U.el('span', { class: 'cat-strip__name', text: c.name }),
        ]));
      });
      view.appendChild(U.el('section', { class: 'section section--chips' }, [strip]));
    }

    // Filas horizontales
    appendRow(view, '🔥 Ofertas', '#/ofertas', Search.query({ onSale: true, sort: 'discount' }).slice(0, 12));
    appendRow(view, '🆕 Novedades', '#/novedades', Search.query({ isNew: true, sort: 'newest' }).slice(0, 12));

    // Destacados (grilla)
    const featured = Search.query({ featured: true }).slice(0, s.featuredLimit || 8);
    if (featured.length) {
      const sec = U.el('section', { class: 'section' }, [sectionHead('⭐ Destacados', '#/destacados')]);
      const grid = U.el('div', { class: 'grid' });
      featured.forEach((p) => grid.appendChild(productCard(p)));
      sec.appendChild(grid);
      view.appendChild(sec);
    }
  }

  function sectionHead(title, href) {
    const head = U.el('div', { class: 'section__head' }, [U.el('h2', { class: 'section__title', text: title })]);
    if (href) head.appendChild(U.el('a', { class: 'section__more', href, text: 'Ver todo →' }));
    return head;
  }

  function appendRow(view, title, href, items) {
    if (!items.length) return;
    const sec = U.el('section', { class: 'section' }, [sectionHead(title, href)]);
    const row = U.el('div', { class: 'row-scroll' });
    items.forEach((p) => { const c = productCard(p); c.classList.add('card--row'); row.appendChild(c); });
    sec.appendChild(row);
    view.appendChild(sec);
  }

  function buildCarousel(cfg) {
    const root = U.el('section', { class: 'carousel' });
    const track = U.el('div', { class: 'carousel__track' });
    cfg.slides.forEach((sl) => {
      const slide = U.el('a', { class: 'carousel__slide', href: sl.target ? '#/' + sl.target : 'javascript:void 0' });
      if (sl.image) slide.style.backgroundImage = `url("${sl.image}")`;
      if (sl.title || sl.subtitle) {
        slide.appendChild(U.el('div', { class: 'carousel__caption' }, [
          sl.title ? U.el('h3', { text: sl.title }) : null,
          sl.subtitle ? U.el('p', { text: sl.subtitle }) : null,
        ].filter(Boolean)));
      }
      track.appendChild(slide);
    });
    root.appendChild(track);

    const dots = U.el('div', { class: 'carousel__dots' });
    let idx = 0;
    const go = (i) => {
      idx = (i + cfg.slides.length) % cfg.slides.length;
      track.style.transform = `translateX(-${idx * 100}%)`;
      U.$$('.carousel__dot', dots).forEach((d, di) => d.classList.toggle('is-active', di === idx));
    };
    cfg.slides.forEach((_, i) => {
      const dot = U.el('button', { class: 'carousel__dot', 'aria-label': 'Ir a slide ' + (i + 1), onClick: () => { go(i); restart(); } });
      dots.appendChild(dot);
    });
    root.appendChild(dots);
    go(0);

    function restart() {
      if (carouselTimer) clearInterval(carouselTimer);
      if (cfg.autoplay && cfg.slides.length > 1) carouselTimer = setInterval(() => go(idx + 1), cfg.interval || 4500);
    }
    restart();
    root.addEventListener('mouseenter', () => carouselTimer && clearInterval(carouselTimer));
    root.addEventListener('mouseleave', restart);
    return root;
  }

  /* ----- CATEGORÍA / CATÁLOGO ------------------------------------------- */
  function renderCategory(view, catId, subId) {
    const cat = Store.getCategory(catId);
    if (!cat) { renderEmpty(view, 'Categoría no encontrada'); return; }
    const sub = subId && Store.getSubcategory(catId, subId);
    const title = (cat.icon ? cat.icon + ' ' : '') + cat.name + (sub ? ' › ' + sub.name : '');
    renderCatalog(view, { title, query: { categoryId: catId, subcategoryId: subId || undefined }, category: cat, activeSub: subId });
  }

  // Estado de filtros de la vista de catálogo actual
  let catalogState = null;

  function renderCatalog(view, config) {
    catalogState = {
      base: Object.assign({}, config.query),
      sort: config.query.sort || (config.query.text ? 'relevance' : 'newest'),
      extra: {}, // filtros del usuario (precio, tags, stock, sale)
      page: 1,
    };

    const wrap = U.el('section', { class: 'catalog' });
    wrap.appendChild(U.el('div', { class: 'catalog__head' }, [
      U.el('h1', { class: 'catalog__title', text: config.title || 'Productos' }),
    ]));

    // Subcategorías como chips si estamos en una categoría
    if (config.category && (config.category.subcategories || []).length) {
      const chips = U.el('div', { class: 'subchips' });
      chips.appendChild(subChip('Todo', '#/categoria/' + config.category.id, !config.activeSub));
      config.category.subcategories.forEach((sc) => {
        chips.appendChild(subChip(sc.name, `#/categoria/${config.category.id}/${sc.id}`, config.activeSub === sc.id));
      });
      wrap.appendChild(chips);
    }

    // Toolbar: contador + orden + botón filtros
    const toolbar = U.el('div', { class: 'toolbar' });
    const count = U.el('span', { class: 'toolbar__count' });
    const sortSel = U.el('select', { class: 'toolbar__sort', 'aria-label': 'Ordenar' });
    [['relevance', 'Relevancia'], ['newest', 'Más nuevos'], ['priceAsc', 'Menor precio'], ['priceDesc', 'Mayor precio'], ['nameAsc', 'Nombre A-Z'], ['discount', 'Mayor descuento']]
      .forEach(([v, l]) => sortSel.appendChild(U.el('option', { value: v, text: l, selected: v === catalogState.sort ? true : null })));
    sortSel.addEventListener('change', () => { catalogState.sort = sortSel.value; catalogState.page = 1; runQuery(); });
    const filterBtn = U.el('button', { class: 'btn btn--ghost toolbar__filter', type: 'button' }, [icon('filter'), U.el('span', { text: 'Filtros' })]);
    filterBtn.addEventListener('click', () => openFilters(config));
    toolbar.appendChild(count);
    toolbar.appendChild(U.el('div', { class: 'toolbar__right' }, [sortSel, filterBtn]));
    wrap.appendChild(toolbar);

    const grid = U.el('div', { class: 'grid grid--catalog' });
    const sentinel = U.el('div', { class: 'sentinel' });
    wrap.appendChild(grid);
    wrap.appendChild(sentinel);
    view.appendChild(wrap);

    catalogState.dom = { grid, count, sentinel, config };
    runQuery();
  }

  function subChip(label, href, active) {
    return U.el('a', { class: 'subchip' + (active ? ' is-active' : ''), href, text: label });
  }

  function runQuery() {
    const st = catalogState;
    const q = Object.assign({}, st.base, st.extra, { sort: st.sort });
    const list = Search.query(q);
    st.list = list;
    st.page = 1;
    st.dom.count.textContent = list.length + (list.length === 1 ? ' producto' : ' productos');
    U.clear(st.dom.grid);
    if (!list.length) {
      st.dom.grid.appendChild(U.el('p', { class: 'empty', text: 'No encontramos productos con esos criterios.' }));
      if (listObserver) listObserver.disconnect();
      return;
    }
    renderPage();
    setupInfinite();
  }

  function renderPage() {
    const st = catalogState;
    const start = (st.page - 1) * PAGE_SIZE;
    const slice = st.list.slice(start, start + PAGE_SIZE);
    slice.forEach((p) => st.dom.grid.appendChild(productCard(p)));
  }

  function setupInfinite() {
    const st = catalogState;
    if (listObserver) listObserver.disconnect();
    if (st.page * PAGE_SIZE >= st.list.length) return;
    listObserver = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (en.isIntersecting) {
          st.page++;
          renderPage();
          if (st.page * PAGE_SIZE >= st.list.length) listObserver.disconnect();
        }
      });
    }, { rootMargin: '600px' });
    listObserver.observe(st.dom.sentinel);
  }

  /* ----- Drawer de filtros ---------------------------------------------- */
  function openFilters(config) {
    const st = catalogState;
    const overlay = U.el('div', { class: 'drawer-overlay drawer-overlay--show' });
    const drawer = U.el('aside', { class: 'drawer drawer--right drawer--open' });
    const onEsc = (e) => { if (e.key === 'Escape') close(); };
    const close = () => { document.removeEventListener('keydown', onEsc); overlay.remove(); drawer.remove(); document.body.style.overflow = ''; };
    document.addEventListener('keydown', onEsc); // accesibilidad: cerrar con Escape
    overlay.addEventListener('click', close);
    document.body.style.overflow = 'hidden';

    drawer.appendChild(U.el('div', { class: 'drawer__head' }, [
      U.el('strong', { text: 'Filtros' }),
      U.el('button', { class: 'icon-btn', onClick: close, 'aria-label': 'Cerrar' }, icon('close')),
    ]));

    const body = U.el('div', { class: 'drawer__body' });

    // Precio
    const priceWrap = U.el('div', { class: 'filter-group' }, [U.el('h4', { text: 'Precio' })]);
    const minI = U.el('input', { type: 'number', class: 'input', placeholder: 'Mín', min: '0', value: st.extra.minPrice != null ? st.extra.minPrice : '' });
    const maxI = U.el('input', { type: 'number', class: 'input', placeholder: 'Máx', min: '0', value: st.extra.maxPrice != null ? st.extra.maxPrice : '' });
    priceWrap.appendChild(U.el('div', { class: 'filter-price' }, [minI, U.el('span', { text: '—' }), maxI]));
    body.appendChild(priceWrap);

    // Etiquetas
    const tags = Store.state.settings.tags || [];
    if (tags.length) {
      const tg = U.el('div', { class: 'filter-group' }, [U.el('h4', { text: 'Etiquetas' })]);
      const wrap = U.el('div', { class: 'filter-tags' });
      tags.forEach((t) => {
        const on = (st.extra.tags || []).indexOf(t) > -1;
        const chip = U.el('button', { class: 'filter-tag' + (on ? ' is-active' : ''), type: 'button', text: t });
        chip.addEventListener('click', () => chip.classList.toggle('is-active'));
        chip.dataset.tag = t;
        wrap.appendChild(chip);
      });
      tg.appendChild(wrap);
      body.appendChild(tg);
    }

    // Toggles
    const togWrap = U.el('div', { class: 'filter-group' });
    const onlySale = checkRow('Solo ofertas', st.extra.onSale);
    const onlyStock = checkRow('Solo con stock', st.extra.inStock);
    togWrap.appendChild(onlySale.row); togWrap.appendChild(onlyStock.row);
    body.appendChild(togWrap);

    drawer.appendChild(body);

    const foot = U.el('div', { class: 'drawer__foot' }, [
      U.el('button', { class: 'btn btn--ghost', type: 'button', text: 'Limpiar', onClick: () => { st.extra = {}; close(); runQuery(); } }),
      U.el('button', {
        class: 'btn btn--primary', type: 'button', text: 'Aplicar',
        onClick: () => {
          st.extra = {};
          if (minI.value) st.extra.minPrice = Number(minI.value);
          if (maxI.value) st.extra.maxPrice = Number(maxI.value);
          const selTags = U.$$('.filter-tag.is-active', drawer).map((c) => c.dataset.tag);
          if (selTags.length) st.extra.tags = selTags;
          if (onlySale.input.checked) st.extra.onSale = true;
          if (onlyStock.input.checked) st.extra.inStock = true;
          close(); runQuery();
        },
      }),
    ]);
    drawer.appendChild(foot);

    document.body.appendChild(overlay);
    document.body.appendChild(drawer);
  }

  function checkRow(label, checked) {
    const input = U.el('input', { type: 'checkbox', checked: checked ? true : null });
    const row = U.el('label', { class: 'check-row' }, [input, U.el('span', { text: label })]);
    return { row, input };
  }

  /* ----- FICHA DE PRODUCTO ---------------------------------------------- */
  function renderProduct(view, id) {
    const p = Store.getProduct(id);
    if (!p) { renderEmpty(view, 'Producto no encontrado', '#/'); return; }
    const cat = Store.getCategory(p.categoryId);
    const sub = cat && Store.getSubcategory(p.categoryId, p.subcategoryId);
    const r = Store.ratingFor(p.id);

    const wrap = U.el('article', { class: 'product' });

    // Breadcrumb
    const bc = U.el('nav', { class: 'breadcrumb' });
    bc.appendChild(U.el('a', { href: '#/', text: 'Inicio' }));
    if (cat) { bc.appendChild(U.el('span', { text: ' / ' })); bc.appendChild(U.el('a', { href: '#/categoria/' + cat.id, text: cat.name })); }
    if (sub) { bc.appendChild(U.el('span', { text: ' / ' })); bc.appendChild(U.el('a', { href: `#/categoria/${cat.id}/${sub.id}`, text: sub.name })); }
    wrap.appendChild(bc);

    const grid = U.el('div', { class: 'product__grid' });

    /* Galería */
    const gallery = U.el('div', { class: 'gallery' });
    const imgs = (p.images && p.images.length) ? p.images : [mainImage(p)];
    const mainImg = U.el('img', { class: 'gallery__main', src: imgs[0], alt: p.name, decoding: 'async' });
    gallery.appendChild(U.el('div', { class: 'gallery__stage' }, [mainImg, badges(p)]));
    if (imgs.length > 1) {
      const thumbs = U.el('div', { class: 'gallery__thumbs' });
      imgs.forEach((src, i) => {
        const th = U.el('button', { class: 'gallery__thumb' + (i === 0 ? ' is-active' : ''), type: 'button' }, U.el('img', { src, alt: '', loading: 'lazy' }));
        th.addEventListener('click', () => {
          mainImg.src = src;
          U.$$('.gallery__thumb', thumbs).forEach((t) => t.classList.remove('is-active'));
          th.classList.add('is-active');
        });
        thumbs.appendChild(th);
      });
      gallery.appendChild(thumbs);
    }
    grid.appendChild(gallery);

    /* Info */
    const info = U.el('div', { class: 'product__info' });
    if (p.brand) info.appendChild(U.el('span', { class: 'product__brand', text: p.brand }));
    info.appendChild(U.el('h1', { class: 'product__name', text: p.name }));
    const metaRow = U.el('div', { class: 'product__meta' }, [stars(r.avg, r.count, { showCount: true })]);
    if (p.code) metaRow.appendChild(U.el('span', { class: 'product__code', text: 'Cód: ' + p.code }));
    info.appendChild(metaRow);

    info.appendChild(priceBlock(p, { large: true }));
    if (Store.isOnSale(p)) {
      info.appendChild(U.el('p', { class: 'product__save', text: `Ahorrás ${money(Store.comparePrice(p) - Store.effectivePrice(p))} (${Store.discountPercent(p)}%)` }));
    }
    info.appendChild(U.el('div', { class: 'product__stockrow' }, [icon('box'), stockTag(p)]));

    // Selector cantidad + agregar
    const buyRow = U.el('div', { class: 'buy-row' });
    const qty = qtyStepper(1, p.stock > 0 ? p.stock : 99);
    const addBtn = U.el('button', { class: 'btn btn--primary btn--lg buy-row__add', type: 'button', disabled: p.stock <= 0 ? true : null },
      [icon('cart'), U.el('span', { text: p.stock <= 0 ? 'Sin stock' : 'Agregar al carrito' })]);
    addBtn.addEventListener('click', () => addToCart(p.id, qty.value()));
    if (p.stock > 0) { buyRow.appendChild(qty.el); }
    buyRow.appendChild(addBtn);
    info.appendChild(buyRow);

    // Botón comprar directo por WhatsApp (este producto)
    const waBtn = U.el('button', { class: 'btn btn--whatsapp buy-row__wa', type: 'button', disabled: p.stock <= 0 ? true : null },
      [icon('whatsapp'), U.el('span', { text: 'Consultar por WhatsApp' })]);
    waBtn.addEventListener('click', () => {
      const s = Store.state.settings;
      const msg = `Hola 👋, me interesa este producto:\n\n*${p.name}*${p.code ? ' (Cód: ' + p.code + ')' : ''}\nPrecio: ${money(Store.effectivePrice(p))}\n\n¿Está disponible?`;
      window.open(App.WhatsApp.buildUrl(msg, s.whatsapp), '_blank');
    });
    info.appendChild(waBtn);

    if (p.tags && p.tags.length) {
      info.appendChild(U.el('div', { class: 'product__tags' }, p.tags.map((t) => U.el('span', { class: 'tag-pill', text: t }))));
    }

    if (App.E5 && App.E5.Decorate) App.E5.Decorate.productInfo(info, p); // ETAPA 5: compartir/favorito/comparar
    grid.appendChild(info);
    wrap.appendChild(grid);

    /* Descripción */
    if (p.description) {
      wrap.appendChild(U.el('section', { class: 'product__section' }, [
        U.el('h2', { class: 'product__section-title', text: 'Descripción' }),
        U.el('p', { class: 'product__desc', text: p.description }),
      ]));
    }

    /* Comentarios */
    wrap.appendChild(renderComments(p));

    /* Relacionados (ETAPA 5: afinidad por categoría+marca+precio+palabras; fallback al básico) */
    const related = (App.E5 && App.E5.Related)
      ? App.E5.Related.for(p, 10)
      : Search.query({ categoryId: p.categoryId }).filter((x) => x.id !== p.id).slice(0, 10);
    if (related.length) {
      const sec = U.el('section', { class: 'section' }, [sectionHead('También te puede interesar', cat ? '#/categoria/' + cat.id : null)]);
      const row = U.el('div', { class: 'row-scroll' });
      related.forEach((rp) => { const c = productCard(rp); c.classList.add('card--row'); row.appendChild(c); });
      sec.appendChild(row);
      wrap.appendChild(sec);
    }

    view.appendChild(wrap);
  }

  function qtyStepper(initial, max, onChange) {
    let val = initial;
    const input = U.el('input', { class: 'qty__input', type: 'number', value: val, min: '1', max: String(max), inputmode: 'numeric' });
    const dec = U.el('button', { class: 'qty__btn', type: 'button', 'aria-label': 'Menos' }, icon('minus'));
    const inc = U.el('button', { class: 'qty__btn', type: 'button', 'aria-label': 'Más' }, icon('plus'));
    const clampSet = (v) => {
      const nv = U.clamp(Number(v) || 1, 1, max);
      const changed = nv !== val;
      val = nv; input.value = val;
      // Un único canal de notificación (botones + tipeo): evita el doble
      // disparo que antes llamaba a Cart.setQty dos veces por clic.
      if (changed && onChange) onChange(val);
    };
    dec.addEventListener('click', () => clampSet(val - 1));
    inc.addEventListener('click', () => clampSet(val + 1));
    input.addEventListener('change', () => clampSet(input.value));
    const el = U.el('div', { class: 'qty' }, [dec, input, inc]);
    return { el, value: () => val, set: clampSet };
  }

  function renderComments(p) {
    const list = Store.commentsFor(p.id, true);
    const sec = U.el('section', { class: 'product__section comments' });
    const r = Store.ratingFor(p.id);
    sec.appendChild(U.el('div', { class: 'comments__head' }, [
      U.el('h2', { class: 'product__section-title', text: `Opiniones (${r.count})` }),
      r.count ? U.el('div', { class: 'comments__avg' }, [U.el('strong', { text: r.avg.toFixed(1) }), stars(r.avg, r.count)]) : null,
    ].filter(Boolean)));
    if (!list.length) {
      sec.appendChild(U.el('p', { class: 'empty', text: 'Todavía no hay opiniones de este producto.' }));
      return sec;
    }
    const ul = U.el('div', { class: 'comments__list' });
    list.forEach((c) => {
      const item = U.el('div', { class: 'comment' });
      const head = U.el('div', { class: 'comment__head' }, [
        U.el('strong', { class: 'comment__author', text: c.author || 'Cliente' }),
        stars(c.rating, 0, { small: true }),
        U.el('span', { class: 'comment__date', text: U.formatDate(c.date) }),
      ]);
      item.appendChild(head);
      if (c.text) item.appendChild(U.el('p', { class: 'comment__text', text: c.text }));
      if (c.image) item.appendChild(U.el('img', { class: 'comment__img', src: c.image, alt: '', loading: 'lazy' }));
      ul.appendChild(item);
    });
    sec.appendChild(ul);
    return sec;
  }

  /* ----- CARRITO + CHECKOUT --------------------------------------------- */
  function renderCart(view) {
    const wrap = U.el('section', { class: 'cart' });
    wrap.appendChild(U.el('h1', { class: 'cart__title', text: '🛒 Tu carrito' }));

    const lines = Cart.lines();
    if (!lines.length) {
      wrap.appendChild(U.el('div', { class: 'cart__empty' }, [
        U.el('p', { class: 'empty', text: 'Tu carrito está vacío.' }),
        U.el('a', { class: 'btn btn--primary', href: '#/', text: 'Ver productos' }),
      ]));
      view.appendChild(wrap);
      return;
    }

    const layout = U.el('div', { class: 'cart__layout' });
    const itemsCol = U.el('div', { class: 'cart__items' });
    const summaryCol = U.el('aside', { class: 'cart__summary' });

    function repaint() {
      U.clear(itemsCol);
      const ls = Cart.lines();
      if (!ls.length) { renderCart(U.clear(view)); return; }
      ls.forEach((l) => itemsCol.appendChild(cartLine(l, repaint)));
      paintSummary();
    }

    function paintSummary() {
      U.clear(summaryCol);
      const subtotal = Cart.subtotal();
      summaryCol.appendChild(U.el('h2', { class: 'cart__summary-title', text: 'Resumen' }));
      summaryCol.appendChild(U.el('div', { class: 'cart__row' }, [U.el('span', { text: `Artículos (${Cart.count()})` }), U.el('span', { text: money(subtotal) })]));
      summaryCol.appendChild(U.el('div', { class: 'cart__row cart__row--total' }, [U.el('span', { text: 'Total' }), U.el('strong', { text: money(subtotal) })]));

      // Formulario de datos del cliente
      const form = U.el('form', { class: 'checkout' });
      const nombre = field('Nombre', 'text', 'nombre', true);
      const direccion = field('Dirección', 'text', 'direccion', false);
      const obs = field('Observaciones', 'textarea', 'observaciones', false);
      form.appendChild(nombre.group); form.appendChild(direccion.group); form.appendChild(obs.group);

      const sendBtn = U.el('button', { class: 'btn btn--whatsapp btn--lg btn--block', type: 'submit' },
        [icon('whatsapp'), U.el('span', { text: 'Enviar pedido por WhatsApp' })]);
      form.appendChild(sendBtn);
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        if (!nombre.input.value.trim()) { U.toast('Ingresá tu nombre', 'error'); nombre.input.focus(); return; }
        const res = App.WhatsApp.send({
          nombre: nombre.input.value.trim(),
          direccion: direccion.input.value.trim(),
          observaciones: obs.input.value.trim(),
        });
        if (res.ok) {
          if (res.warn === 'no-number') U.toast('No hay número configurado: elegí el contacto en WhatsApp', 'info', 4000);
          U.confirm('¿Enviaste tu pedido? Podemos vaciar el carrito.', { okText: 'Vaciar carrito', cancelText: 'Mantener' })
            .then((yes) => { if (yes) { Cart.clear(); renderCart(U.clear(view)); } });
        }
      });
      summaryCol.appendChild(form);

      // Vista previa del mensaje
      const prev = U.el('details', { class: 'checkout__preview' }, [
        U.el('summary', { text: 'Ver mensaje que se enviará' }),
        U.el('pre', { class: 'checkout__msg', text: App.WhatsApp.buildMessage({ nombre: '', direccion: '', observaciones: '' }) }),
      ]);
      summaryCol.appendChild(prev);

      summaryCol.appendChild(U.el('button', {
        class: 'btn btn--ghost btn--block cart__clear', type: 'button', text: 'Vaciar carrito',
        onClick: () => U.confirm('¿Vaciar todo el carrito?', { danger: true, okText: 'Vaciar' }).then((y) => { if (y) { Cart.clear(); renderCart(U.clear(view)); } }),
      }));
    }

    repaint();
    layout.appendChild(itemsCol);
    layout.appendChild(summaryCol);
    wrap.appendChild(layout);
    view.appendChild(wrap);
  }

  function cartLine(l, onChange) {
    const row = U.el('div', { class: 'cart-line' });
    row.appendChild(U.el('a', { class: 'cart-line__media', href: '#/producto/' + l.id }, U.el('img', { src: mainImage(l.product), alt: l.product.name, loading: 'lazy' })));
    const mid = U.el('div', { class: 'cart-line__mid' }, [
      U.el('a', { class: 'cart-line__name', href: '#/producto/' + l.id, text: l.product.name }),
      U.el('span', { class: 'cart-line__unit', text: money(l.unit) + ' c/u' }),
    ]);
    // Sincronización única con el carrito vía callback del stepper (antes
    // había doble disparo: evento 'change' en captura + clicks con setTimeout).
    const stepper = qtyStepper(l.qty, l.product.stock > 0 ? l.product.stock : 99,
      (v) => { Cart.setQty(l.id, v); onChange(); });
    stepper.el.classList.add('cart-line__qty');
    mid.appendChild(stepper.el);
    row.appendChild(mid);

    const right = U.el('div', { class: 'cart-line__right' }, [
      U.el('strong', { class: 'cart-line__total', text: money(l.lineTotal) }),
      U.el('button', { class: 'icon-btn cart-line__del', 'aria-label': 'Quitar', onClick: () => { Cart.remove(l.id); onChange(); } }, icon('trash')),
    ]);
    row.appendChild(right);
    return row;
  }

  function field(label, type, name, required) {
    const group = U.el('label', { class: 'field' });
    group.appendChild(U.el('span', { class: 'field__label', text: label + (required ? ' *' : '') }));
    const input = type === 'textarea'
      ? U.el('textarea', { class: 'input', name, rows: '2' })
      : U.el('input', { class: 'input', type, name });
    group.appendChild(input);
    return { group, input };
  }

  /* ----- Utilidades de vista -------------------------------------------- */
  function renderEmpty(view, message, backHref) {
    view.appendChild(U.el('div', { class: 'state-empty' }, [
      U.el('p', { class: 'empty', text: message }),
      U.el('a', { class: 'btn btn--primary', href: backHref || '#/', text: 'Volver al inicio' }),
    ]));
  }

  App.Storefront = { mountShell, renderRoute, refreshChrome };
})(window.App = window.App || {});
