/* =============================================================================
 * search.js — Motor de búsqueda y filtrado del catálogo
 * -----------------------------------------------------------------------------
 * Búsqueda instantánea por nombre, código, marca, categoría y descripción, con
 * ranking simple por relevancia. Filtros combinables (categoría, subcategoría,
 * etiquetas, oferta, nuevo, destacado, stock, rango de precio) y ordenamientos.
 * Trabaja sobre Store.state.products en memoria → resultados inmediatos.
 * ========================================================================== */
(function (App) {
  'use strict';

  const { U, Store } = App;

  /** Texto indexable de un producto (cacheado por updatedAt). */
  const indexCache = new Map();
  function haystack(p) {
    const cached = indexCache.get(p.id);
    if (cached && cached.v === p.updatedAt) return cached.text;
    const cat = Store.getCategory(p.categoryId);
    const sub = cat && (cat.subcategories || []).find((s) => s.id === p.subcategoryId);
    const text = U.normalize(
      [p.name, p.code, p.brand, p.description, cat && cat.name, sub && sub.name, (p.tags || []).join(' ')]
        .filter(Boolean)
        .join(' ')
    );
    indexCache.set(p.id, { v: p.updatedAt, text });
    return text;
  }

  /** Puntaje de relevancia para un término ya normalizado. */
  function score(p, term) {
    if (!term) return 1;
    const name = U.normalize(p.name);
    const code = U.normalize(p.code);
    let s = 0;
    if (name === term) s += 100;
    if (name.indexOf(term) === 0) s += 50;
    if (name.indexOf(term) > -1) s += 25;
    if (code === term) s += 80;
    if (code.indexOf(term) > -1) s += 20;
    if (U.normalize(p.brand).indexOf(term) > -1) s += 15;
    if (haystack(p).indexOf(term) > -1) s += 5;
    return s;
  }

  const SORTERS = {
    relevance: null, // se maneja aparte cuando hay texto
    newest: (a, b) => b.createdAt - a.createdAt,
    priceAsc: (a, b) => Store.effectivePrice(a) - Store.effectivePrice(b),
    priceDesc: (a, b) => Store.effectivePrice(b) - Store.effectivePrice(a),
    nameAsc: (a, b) => U.normalize(a.name).localeCompare(U.normalize(b.name)),
    discount: (a, b) => Store.discountPercent(b) - Store.discountPercent(a),
  };

  /**
   * @param {object} q
   *   text, categoryId, subcategoryId, tags[], onSale, isNew, featured,
   *   inStock, minPrice, maxPrice, sort, includeInactive
   * @returns {Array} productos filtrados/ordenados
   */
  function query(q = {}) {
    const term = q.text ? U.normalize(q.text.trim()) : '';
    const terms = term ? term.split(/\s+/).filter(Boolean) : [];

    let list = Store.state.products.filter((p) => {
      if (!q.includeInactive && p.active === false) return false;
      if (q.categoryId && p.categoryId !== q.categoryId) return false;
      if (q.subcategoryId && p.subcategoryId !== q.subcategoryId) return false;
      if (q.featured && !p.featured) return false;
      if (q.isNew && !p.isNew) return false;
      if (q.onSale && !Store.isOnSale(p)) return false;
      if (q.inStock && !(p.stock > 0)) return false;
      if (q.minPrice != null && Store.effectivePrice(p) < q.minPrice) return false;
      if (q.maxPrice != null && Store.effectivePrice(p) > q.maxPrice) return false;
      if (q.tags && q.tags.length) {
        const pt = p.tags || [];
        if (!q.tags.every((t) => pt.indexOf(t) > -1)) return false;
      }
      if (terms.length) {
        const hay = haystack(p);
        // Todos los términos deben aparecer (AND)
        if (!terms.every((t) => hay.indexOf(t) > -1)) return false;
      }
      return true;
    });

    // Ordenamiento
    if (terms.length && (!q.sort || q.sort === 'relevance')) {
      list = list
        .map((p) => ({ p, s: terms.reduce((acc, t) => acc + score(p, t), 0) }))
        .sort((a, b) => b.s - a.s || b.p.createdAt - a.p.createdAt)
        .map((o) => o.p);
    } else {
      const sorter = SORTERS[q.sort] || SORTERS.newest;
      list = list.slice().sort(sorter);
    }
    return list;
  }

  /** Sugerencias rápidas para el autocompletado del buscador. */
  function suggest(text, limit = 6) {
    if (!text || !text.trim()) return [];
    return query({ text, sort: 'relevance' }).slice(0, limit);
  }

  App.Search = { query, suggest, SORTERS };
})(window.App = window.App || {});
