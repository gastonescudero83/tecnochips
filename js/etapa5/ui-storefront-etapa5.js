/* =============================================================================
 * ui-storefront-etapa5.js — ETAPA 5 · Tienda pública (PARTE 3)
 * -----------------------------------------------------------------------------
 * Aporta a la tienda pública, de forma aditiva:
 *   • App.E5.Decorate: enchufa badges de promo, botón favorito y casilla de
 *     comparar en las tarjetas, y botones compartir/favorito/comparar en la
 *     ficha de producto. (Lo invocan hooks mínimos de ui-storefront.js.)
 *   • App.E5.StorefrontExt: barra flotante de favoritos/comparar, banner de
 *     portada, y páginas #/favoritos, #/comparar, #/marcas, #/marca/:slug.
 *
 * No redibuja nada del shell existente; sólo añade nodos.
 * ========================================================================== */
(function (App) {
  'use strict';
  const U = App.U;
  const E5 = App.E5;
  const S = App.Store;
  const money = (v) => U.formatCurrency(v, S.state.settings);
  const Router = App.Router;

  function mainImg(p) { return (p.images && p.images[0]) || 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><rect width="100%" height="100%" fill="#eee"/></svg>'); }

  /* ---- Tarjeta liviana (para páginas E5) --------------------------------- */
  function cardLite(p) {
    const card = U.el('article', { class: 'card' }, [
      U.el('a', { class: 'card__media', href: '#/producto/' + p.id }, [U.el('img', { src: mainImg(p), alt: p.name, loading: 'lazy' })]),
      U.el('div', { class: 'card__body' }, [
        p.brand ? U.el('span', { class: 'card__brand', text: p.brand }) : null,
        U.el('a', { class: 'card__name', href: '#/producto/' + p.id, text: p.name }),
        U.el('div', { class: 'price', text: money(S.effectivePrice(p)) }),
      ].filter(Boolean)),
    ]);
    decorateCard(card, p);
    return card;
  }

  /* ===================== DECORATE (hooks) ================================= */
  function decorateBadges(wrap, p) {
    if (!E5.Promos) return;
    E5.Promos.badgesFor(p).forEach((b) => {
      wrap.appendChild(U.el('span', { class: 'e5-badge', style: { background: b.color }, text: b.label }));
    });
  }

  function favBtn(p, cls) {
    const on = E5.Favorites.has(p.id);
    const b = U.el('button', { class: 'e5-fav-btn' + (on ? ' is-active' : '') + (cls ? ' ' + cls : ''), type: 'button', title: 'Favorito', 'aria-label': 'Favorito', text: on ? '♥' : '♡' });
    b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); const now = E5.Favorites.toggle(p.id); b.classList.toggle('is-active', now); b.textContent = now ? '♥' : '♡'; updateBar(); });
    return b;
  }
  function compareBtn(p) {
    const on = E5.Compare.has(p.id);
    const b = U.el('button', { class: 'btn btn--ghost btn--sm' + (on ? ' is-active' : ''), type: 'button', text: on ? '✓ Comparando' : '⇄ Comparar' });
    b.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      const r = E5.Compare.toggle(p.id);
      if (r.full) { U.toast('Máximo ' + E5.Compare.MAX + ' productos para comparar', 'info'); return; }
      b.classList.toggle('is-active', r.on); b.textContent = r.on ? '✓ Comparando' : '⇄ Comparar'; updateBar();
    });
    return b;
  }

  function decorateCard(card, p) {
    if (!E5.Favorites) return;
    const media = card.querySelector('.card__media') || card;
    const fav = favBtn(p);
    fav.style.position = 'absolute'; fav.style.top = '6px'; fav.style.right = '6px'; fav.style.zIndex = '3';
    fav.style.background = 'rgba(255,255,255,.85)'; fav.style.borderRadius = '50%';
    if (getComputedStyle(media).position === 'static') media.style.position = 'relative';
    media.appendChild(fav);
  }

  function decorateProductInfo(info, p) {
    const box = U.el('div', { style: { marginTop: '.8rem', display: 'flex', flexDirection: 'column', gap: '.6rem' } });
    const actions = U.el('div', { style: { display: 'flex', gap: '.5rem', alignItems: 'center', flexWrap: 'wrap' } }, [favBtn(p), compareBtn(p)]);
    box.appendChild(actions);
    if (E5.Share) {
      box.appendChild(U.el('div', {}, [U.el('span', { class: 'a-muted', text: 'Compartir: ' }), E5.Share.buttons(p)]));
    }
    info.appendChild(box);
  }

  /* ===================== BARRA FLOTANTE =================================== */
  let bar = null;
  function ensureBar() {
    if (bar) return bar;
    bar = U.el('div', { class: 'e5-floating-bar', id: 'e5-bar' });
    document.body.appendChild(bar);
    return bar;
  }
  function updateBar() {
    ensureBar();
    const fc = E5.Favorites.count();
    const cc = E5.Compare.count();
    U.clear(bar);
    if ((!fc && !cc) || barDismissed) { bar.classList.remove('is-open'); return; }
    bar.classList.add('is-open');
    bar.appendChild(U.el('div', { style: { display: 'flex', gap: '1rem', alignItems: 'center' } }, [
      fc ? U.el('a', { href: '#/favoritos', text: '♥ Favoritos (' + fc + ')' }) : null,
      cc ? U.el('a', { href: '#/comparar', text: '⇄ Comparar (' + cc + '/' + E5.Compare.MAX + ')' }) : null,
    ].filter(Boolean)));
    // El ✕ OCULTA la barra (antes borraba TODOS los favoritos y comparados
    // sin confirmación: el visitante perdía sus datos con un mal clic).
    bar.appendChild(U.el('button', {
      class: 'btn btn--ghost btn--sm', text: '✕', title: 'Ocultar barra', 'aria-label': 'Ocultar barra',
      onClick: () => { barDismissed = true; updateBar(); },
    }));
  }
  let barDismissed = false; // se resetea cuando cambian favoritos/comparar

  /* ===================== BANNER DE PORTADA =============================== */
  let bannerTimer = null; // un único timer vivo (antes se creaba uno por visita al home)
  function homeTop(view) {
    // Banner dinámico de promociones: texto generado del catálogo real, cambia
    // en cada carga y lleva a esos productos. Va antes del early-return para
    // mostrarse aunque no haya banners de imagen cargados.
    if (E5.PromoBanner) { const pb = E5.PromoBanner.build(); if (pb) view.appendChild(pb); }
    if (!E5.Banners) return;
    const banners = E5.Banners.activeOrdered();
    if (!banners.length) return;
    if (bannerTimer) { clearInterval(bannerTimer); bannerTimer = null; }
    const cont = U.el('div', { class: 'e5-banner', style: { marginBottom: '1rem' } });
    let idx = 0;
    const slide = U.el('div', { class: 'e5-banner__slide' });
    const cap = U.el('div', { class: 'e5-banner__caption' });
    cont.appendChild(slide); slide.appendChild(cap);
    function paint() {
      const b = banners[idx];
      slide.style.backgroundImage = b.image ? `url("${b.image}")` : 'linear-gradient(135deg,var(--color-primary,#2b2722),var(--color-accent,#c0894a))';
      U.clear(cap);
      if (b.title) cap.appendChild(U.el('h2', { text: b.title, style: { margin: '0' } }));
      if (b.subtitle) cap.appendChild(U.el('p', { text: b.subtitle, style: { margin: '.2rem 0' } }));
      if (b.ctaText) {
        // Solo se aceptan URLs http(s) como enlace externo (evita javascript:).
        const externa = b.ctaUrl && /^https?:\/\//i.test(b.ctaUrl);
        const href = externa ? b.ctaUrl : ('#/' + (b.ctaTarget || ''));
        cap.appendChild(U.el('a', {
          class: 'btn btn--primary btn--sm', href,
          target: externa ? '_blank' : null, rel: externa ? 'noopener' : null,
          text: b.ctaText,
        }));
      }
    }
    paint();
    if (banners.length > 1) {
      bannerTimer = setInterval(() => {
        // Si el banner ya no está en pantalla (cambio de ruta), se autodetiene.
        if (!document.body.contains(cont)) { clearInterval(bannerTimer); bannerTimer = null; return; }
        idx = (idx + 1) % banners.length; paint();
      }, 5000);
    }
    // insertar al principio del view
    view.insertBefore(cont, view.firstChild);
  }

  /* ===================== PÁGINAS ========================================= */
  function grid(items) {
    const g = U.el('div', { class: 'grid' });
    items.forEach((p) => g.appendChild(cardLite(p)));
    return g;
  }
  function pageHead(title) { return U.el('div', { class: 'section__head' }, [U.el('h1', { text: title })]); }

  function renderFavorites(view) {
    U.clear(view);
    view.appendChild(pageHead('♥ Mis favoritos'));
    const items = E5.Favorites.products();
    if (!items.length) { view.appendChild(U.el('p', { class: 'a-empty', text: 'Todavía no marcaste favoritos. Tocá el ♥ en cualquier producto.' })); return; }
    view.appendChild(grid(items));
  }

  function renderCompare(view) {
    U.clear(view);
    view.appendChild(pageHead('⇄ Comparar productos'));
    const ps = E5.Compare.products();
    if (!ps.length) { view.appendChild(U.el('p', { class: 'a-empty', text: 'Agregá productos con el botón "Comparar" (hasta ' + E5.Compare.MAX + ').' })); return; }
    const table = U.el('table', { class: 'e5-compare-table' });
    // fila imágenes + nombre + quitar
    const trImg = U.el('tr', {}, [U.el('th', { text: '' })]);
    ps.forEach((p) => trImg.appendChild(U.el('td', {}, [
      U.el('a', { href: '#/producto/' + p.id }, [U.el('img', { src: mainImg(p), alt: p.name, style: { maxHeight: '90px', objectFit: 'contain' } })]),
      U.el('div', {}, [U.el('a', { href: '#/producto/' + p.id, text: p.name })]),
      U.el('button', { class: 'btn btn--ghost btn--sm', text: 'Quitar', onClick: () => { E5.Compare.remove(p.id); updateBar(); renderCompare(view); } }),
    ])));
    table.appendChild(trImg);
    E5.Compare.rows().forEach((row) => {
      const tr = U.el('tr', {}, [U.el('th', { text: row.label })]);
      row.values.forEach((v) => tr.appendChild(U.el('td', { text: v })));
      table.appendChild(tr);
    });
    view.appendChild(table);
  }

  function renderBrands(view) {
    U.clear(view);
    view.appendChild(pageHead('™️ Marcas'));
    if (!E5.Brands) return;
    const brands = E5.Brands.activeOrdered();
    if (!brands.length) { view.appendChild(U.el('p', { class: 'a-empty', text: 'No hay marcas cargadas.' })); return; }
    const g = U.el('div', { class: 'e5-brands-grid' });
    brands.forEach((b) => {
      const card = U.el('a', { class: 'e5-brand-card', href: '#/marca/' + (b.slug || b.id) }, [
        b.logo ? U.el('img', { src: b.logo, alt: b.name }) : U.el('div', { style: { fontSize: '2rem' }, text: '🏷️' }),
        U.el('div', { text: b.name }),
        U.el('div', { class: 'a-muted', text: E5.Brands.productsOf(b).length + ' productos' }),
      ]);
      g.appendChild(card);
    });
    view.appendChild(g);
  }

  function renderBrand(view, slugOrId) {
    U.clear(view);
    if (!E5.Brands) return;
    const b = E5.Brands.bySlug(slugOrId) || E5.Brands.get(slugOrId);
    if (!b) { view.appendChild(U.el('p', { class: 'a-empty', text: 'Marca no encontrada.' })); return; }
    if (b.cover) view.appendChild(U.el('div', { class: 'e5-banner', style: { marginBottom: '1rem', minHeight: '140px', backgroundImage: `url("${b.cover}")`, backgroundSize: 'cover', backgroundPosition: 'center' } }));
    view.appendChild(pageHead(b.name));
    if (b.description) view.appendChild(U.el('p', { class: 'a-muted', text: b.description }));
    const items = E5.Brands.productsOf(b);
    if (!items.length) view.appendChild(U.el('p', { class: 'a-empty', text: 'Sin productos en esta marca.' }));
    else view.appendChild(grid(items));
  }

  /** Punto de entrada para rutas E5 (lo llama un hook de renderRoute). */
  function renderExtraRoute(view, route) {
    const seg = route.segments;
    switch (seg[0]) {
      case 'favoritos': renderFavorites(view); return true;
      case 'comparar': renderCompare(view); return true;
      case 'marcas': renderBrands(view); return true;
      case 'marca': renderBrand(view, seg[1]); return true;
      default: return false;
    }
  }

  // Mantener barra sincronizada (un cambio la vuelve a mostrar si estaba oculta)
  if (E5.Favorites) E5.Favorites.onChange(() => { barDismissed = false; updateBar(); });
  if (E5.Compare) E5.Compare.onChange(() => { barDismissed = false; updateBar(); });
  function init() { ensureBar(); updateBar(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else setTimeout(init, 0);

  App.E5.Decorate = { badges: decorateBadges, card: decorateCard, productInfo: decorateProductInfo };
  App.E5.StorefrontExt = { renderExtraRoute, homeTop, updateBar, cardLite };
})(window.App = window.App || {});
