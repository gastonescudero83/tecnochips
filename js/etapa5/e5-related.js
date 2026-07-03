/* =============================================================================
 * e5-related.js — ETAPA 5 · Punto 9: Productos relacionados
 * -----------------------------------------------------------------------------
 * Calcula productos similares con un puntaje que combina: misma categoría,
 * misma marca, cercanía de precio y palabras en común en el nombre. Offline,
 * sobre Store.state.products en memoria.
 *
 * API:
 *   App.E5.Related.for(product, limit=10) -> [product] ordenados por afinidad
 * ========================================================================== */
(function (App) {
  'use strict';
  const U = App.U;

  function words(s) {
    return U.normalize(s || '').split(/\s+/).filter((w) => w.length >= 3);
  }

  function relatedFor(p, limit) {
    limit = limit || 10;
    const S = App.Store;
    const all = (S && S.state.products) || [];
    if (!p) return [];
    const baseWords = new Set(words(p.name));
    const basePrice = S.effectivePrice(p) || 0;
    const brandLc = (p.brand || '').toLowerCase();

    const scored = [];
    all.forEach((q) => {
      if (q.id === p.id || q.active === false) return;
      let s = 0;
      if (q.categoryId && q.categoryId === p.categoryId) s += 40;
      if (q.subcategoryId && q.subcategoryId === p.subcategoryId) s += 15;
      if (brandLc && (q.brand || '').toLowerCase() === brandLc) s += 30;
      // Cercanía de precio (hasta 25 pts si está dentro de ±30%)
      const qp = S.effectivePrice(q) || 0;
      if (basePrice > 0 && qp > 0) {
        const diff = Math.abs(qp - basePrice) / basePrice;
        if (diff <= 0.3) s += Math.round(25 * (1 - diff / 0.3));
      }
      // Palabras en común
      let common = 0;
      words(q.name).forEach((w) => { if (baseWords.has(w)) common++; });
      s += common * 8;
      if (s > 0) scored.push({ q, s });
    });

    return scored.sort((a, b) => b.s - a.s || (b.q.createdAt || 0) - (a.q.createdAt || 0))
      .slice(0, limit).map((o) => o.q);
  }

  App.E5 = App.E5 || {};
  App.E5.Related = { for: relatedFor };
})(window.App = window.App || {});
