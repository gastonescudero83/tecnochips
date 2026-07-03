/* =============================================================================
 * e5-search-suggest.js — ETAPA 5 · Punto 8: Búsqueda mejorada
 * -----------------------------------------------------------------------------
 * Sugerencias enriquecidas mientras el usuario escribe: además de PRODUCTOS
 * (que ya da App.Search.suggest), agrega MARCAS, MODELOS y CATEGORÍAS.
 * Offline. Devuelve items tipados para que la UI los pinte y enrute.
 *
 * API:
 *   App.E5.SearchSuggest.rich(text, opts) -> [{kind, label, sub, href, image}]
 *      kind: 'product' | 'brand' | 'model' | 'category'
 * ========================================================================== */
(function (App) {
  'use strict';
  const U = App.U;

  function rich(text, opts) {
    opts = opts || {};
    const term = U.normalize((text || '').trim());
    if (!term) return [];
    const out = [];
    const S = App.Store;
    const money = (v) => U.formatCurrency(v, S.state.settings);

    // Categorías
    (S.state.categories || []).forEach((c) => {
      if (U.normalize(c.name).indexOf(term) > -1) {
        out.push({ kind: 'category', label: c.name, sub: 'Categoría', href: '#/categoria/' + c.id, image: c.image || null, icon: c.icon || '🗂️' });
      }
    });

    // Marcas (desde E5.Brands si existe; si no, marcas distintas de productos)
    const brandNames = new Set();
    if (App.E5.Brands) {
      App.E5.Brands.all().forEach((b) => {
        if (U.normalize(b.name).indexOf(term) > -1) {
          brandNames.add(b.name.toLowerCase());
          out.push({ kind: 'brand', label: b.name, sub: 'Marca', href: '#/marca/' + (b.slug || b.id), image: b.logo || null, icon: '™️' });
        }
      });
    }
    (S.state.products || []).forEach((p) => {
      const bl = (p.brand || '').toLowerCase();
      if (bl && !brandNames.has(bl) && U.normalize(p.brand).indexOf(term) > -1) {
        brandNames.add(bl);
        out.push({ kind: 'brand', label: p.brand, sub: 'Marca', href: '#/buscar?q=' + encodeURIComponent(p.brand), icon: '™️' });
      }
    });

    // Modelos
    const models = new Set();
    (S.state.products || []).forEach((p) => {
      if (p.model && U.normalize(p.model).indexOf(term) > -1) {
        const key = p.model.toLowerCase();
        if (!models.has(key)) { models.add(key); out.push({ kind: 'model', label: p.model, sub: 'Modelo', href: '#/buscar?q=' + encodeURIComponent(p.model), icon: '🔖' }); }
      }
    });

    // Productos (reusa el motor existente)
    const prods = App.Search.suggest(text, opts.productLimit || 6);
    prods.forEach((p) => out.push({
      kind: 'product', label: p.name, sub: money(S.effectivePrice(p)),
      href: '#/producto/' + p.id, image: (p.images && p.images[0]) || null, icon: '📦',
    }));

    // Orden: categorías/marcas/modelos arriba (más "navegables"), luego productos
    const rank = { category: 0, brand: 1, model: 2, product: 3 };
    return out.sort((a, b) => rank[a.kind] - rank[b.kind]).slice(0, opts.limit || 10);
  }

  App.E5 = App.E5 || {};
  App.E5.SearchSuggest = { rich };
})(window.App = window.App || {});
