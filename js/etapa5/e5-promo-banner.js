/* =============================================================================
 * e5-promo-banner.js — ETAPA 5 · Banner dinámico de promociones
 * -----------------------------------------------------------------------------
 * Barra de texto (sin imágenes) que muestra un mensaje distinto CADA VEZ que se
 * abre/recarga la portada. Los mensajes se generan solos a partir del catálogo
 * REAL (marcas, categorías, ofertas, novedades, destacados) — no hay que
 * escribir nada a mano. Al tocar la barra, lleva a esos productos.
 *
 * 100% offline, aditivo, cuelga de App.E5.PromoBanner. Sin emojis (por pedido).
 *
 * API:
 *   App.E5.PromoBanner.build()   -> nodo <a> del banner, o null si no hay catálogo
 * ========================================================================== */
(function (App) {
  'use strict';
  var U = App.U;
  var S = App.Store;
  var _last = null;   // recuerda el último mensaje para no repetirlo seguido

  function txt(s) { return (s == null ? '' : String(s)).trim(); }

  function activeProducts() {
    return ((S.state && S.state.products) || []).filter(function (p) { return p.active !== false; });
  }

  /* ---- Arma el pool de mensajes candidatos desde el catálogo real --------- */
  function buildPool() {
    var prods = activeProducts();
    if (!prods.length) return [];

    var cats = (S.state && S.state.categories) || [];
    var catById = {};
    cats.forEach(function (c) { catById[c.id] = c; });

    var brandCount = {}, catCount = {}, catOnSale = {};
    var anyOnSale = false, anyNew = false, anyFeat = false;

    prods.forEach(function (p) {
      var b = txt(p.brand);
      if (b) brandCount[b] = (brandCount[b] || 0) + 1;
      if (p.categoryId) catCount[p.categoryId] = (catCount[p.categoryId] || 0) + 1;
      var onSale = S.isOnSale ? S.isOnSale(p) : false;
      if (onSale) { anyOnSale = true; if (p.categoryId) catOnSale[p.categoryId] = (catOnSale[p.categoryId] || 0) + 1; }
      if (p.isNew) anyNew = true;
      if (p.featured) anyFeat = true;
    });

    var pool = [];

    // Ofertas por categoría (lo más "vendedor" → más peso)
    Object.keys(catOnSale).forEach(function (cid) {
      var c = catById[cid]; if (!c) return;
      var href = '#/categoria/' + cid;
      pool.push({ text: 'Ofertas en ' + c.name, href: href, w: 5 });
      pool.push({ text: c.name + ' en promoción', href: href, w: 4 });
    });

    // Marcas presentes en el catálogo
    Object.keys(brandCount).forEach(function (b) {
      var href = '#/buscar?q=' + encodeURIComponent(b);
      pool.push({ text: 'Semana ' + b, href: href, w: 3 });
      pool.push({ text: 'Todo en ' + b, href: href, w: 2 });
    });

    // Categorías
    Object.keys(catCount).forEach(function (cid) {
      var c = catById[cid]; if (!c) return;
      var href = '#/categoria/' + cid;
      pool.push({ text: 'Descubrí ' + c.name, href: href, w: 2 });
      pool.push({ text: 'Todo en ' + c.name, href: href, w: 1 });
    });

    // Globales
    if (anyOnSale) {
      pool.push({ text: 'Ofertas de la semana', href: '#/ofertas', w: 4 });
      pool.push({ text: 'Las mejores ofertas, hoy', href: '#/ofertas', w: 2 });
    }
    if (anyNew) {
      pool.push({ text: 'Recién llegados', href: '#/novedades', w: 2 });
      pool.push({ text: 'Lo nuevo ya está acá', href: '#/novedades', w: 2 });
    }
    if (anyFeat) {
      pool.push({ text: 'Los más elegidos de la tienda', href: '#/destacados', w: 2 });
    }

    return pool;
  }

  /* ---- Elige un mensaje al azar (ponderado, sin repetir el anterior) ------ */
  function pick(pool) {
    if (!pool.length) return null;
    if (pool.length === 1) { _last = pool[0].text; return pool[0]; }
    var total = pool.reduce(function (a, x) { return a + (x.w || 1); }, 0);
    for (var t = 0; t < 8; t++) {
      var r = Math.random() * total, acc = 0, chosen = pool[0];
      for (var i = 0; i < pool.length; i++) { acc += (pool[i].w || 1); if (r <= acc) { chosen = pool[i]; break; } }
      if (chosen.text !== _last) { _last = chosen.text; return chosen; }
    }
    _last = pool[0].text; return pool[0];
  }

  /* ---- Configuración editable (Store.state.settings.promoBanner) ---------- */
  function cfg() {
    var c = (S.state && S.state.settings && S.state.settings.promoBanner) || {};
    return {
      enabled: c.enabled !== false,                          // activar/desactivar
      useAuto: c.useAuto !== false,                          // mensajes automáticos del catálogo
      tag: (c.tag != null ? String(c.tag) : 'Promo'),        // palabra del rótulo (vacío = ocultar)
      cta: (c.cta != null ? String(c.cta) : 'Ver'),          // texto del enlace (vacío = ocultar)
      customTarget: c.customTarget || 'ofertas',             // a dónde llevan los mensajes propios
      customText: c.customText || '',                        // mensajes propios (uno por línea)
      useBrandBg: c.useBrandBg !== false,                    // fondo: degradé de marca (default) o color propio
      bg: c.bg || '',                                        // color de fondo sólido (si useBrandBg = false)
      fg: c.fg || '',                                        // color del texto (vacío = blanco por CSS)
    };
  }

  function targetHref(t) {
    if (t === 'novedades') return '#/novedades';
    if (t === 'destacados') return '#/destacados';
    if (t === 'inicio') return '#/';
    return '#/ofertas';
  }

  // Mensajes escritos por el dueño (uno por línea), enlazados al destino elegido.
  function customMessages(c) {
    return String(c.customText || '').split(/\r?\n/)
      .map(function (l) { return l.trim(); })
      .filter(Boolean)
      .map(function (l) { return { text: l, href: targetHref(c.customTarget), w: 4 }; });
  }

  /* ---- Construye el nodo del banner --------------------------------------- */
  function build() {
    var c = cfg();
    if (!c.enabled) return null;                             // apagado desde el panel
    var pool = [];
    if (c.useAuto) pool = pool.concat(buildPool());          // automáticos del catálogo
    pool = pool.concat(customMessages(c));                   // + los propios
    var msg = pick(pool);
    if (!msg) return null;
    var a = U.el('a', { class: 'e5-promo', href: msg.href, 'aria-label': msg.text });
    if (!c.useBrandBg && c.bg) a.style.background = c.bg;    // fondo propio (sobreescribe el degradé)
    if (c.fg) a.style.color = c.fg;                          // color de texto propio
    if (c.tag.trim()) a.appendChild(U.el('span', { class: 'e5-promo__tag', text: c.tag.trim() }));
    a.appendChild(U.el('span', { class: 'e5-promo__text', text: msg.text }));
    if (c.cta.trim()) a.appendChild(U.el('span', { class: 'e5-promo__go', text: c.cta.trim() }));
    return a;
  }

  App.E5 = App.E5 || {};
  App.E5.PromoBanner = { build: build, buildPool: buildPool, cfg: cfg };
})(window.App = window.App || {});
