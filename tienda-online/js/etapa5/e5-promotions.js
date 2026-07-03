/* =============================================================================
 * e5-promotions.js — ETAPA 5 · Punto 1: Sistema de Promociones
 * -----------------------------------------------------------------------------
 * Promociones con activación/desactivación AUTOMÁTICA por fecha. Cada promo
 * apunta a productos (por id) y/o a categorías/marcas, y define presentación
 * (color, banner). 100% offline (colección KV "promotions").
 *
 * Tipos (type):
 *   destacado | oferta | novedad | ultimo_ingreso | temporal | recomendado
 *
 * Esquema de promoción:
 *   {
 *     id, name, type,
 *     productIds:[], categoryIds:[], brandIds:[],
 *     startAt: ts|null, endAt: ts|null,   // null = sin límite
 *     priority: Number,                    // mayor = más arriba
 *     color: '#hex',                       // color identificador del badge
 *     banner: '' | dataURL,                // banner opcional
 *     label: '',                           // texto del badge (default según type)
 *     active: true                         // switch manual; la fecha manda igual
 *   }
 *
 * API:
 *   App.E5.Promos.list() / .save(promo) / .remove(id)
 *   App.E5.Promos.isLive(promo, [now])           -> bool (activa por fecha+switch)
 *   App.E5.Promos.activeNow()                     -> Array de promos vigentes
 *   App.E5.Promos.forProduct(product)            -> Array de promos que aplican
 *   App.E5.Promos.badgesFor(product)             -> [{label,color,type,priority}]
 *   App.E5.Promos.productsByType(type)           -> Array<product> (vigentes)
 *   App.E5.Promos.TYPES                          -> metadatos de tipos
 * ========================================================================== */
(function (App) {
  'use strict';
  const E5 = App.E5;
  const store = E5.coll('promotions');

  const TYPES = {
    destacado:      { label: 'Destacado',       color: '#c0894a' },
    oferta:         { label: 'Oferta',          color: '#c0392b' },
    novedad:        { label: 'Novedad',         color: '#2e9e5b' },
    ultimo_ingreso: { label: 'Último ingreso',  color: '#2980b9' },
    temporal:       { label: 'Promo',           color: '#8e44ad' },
    recomendado:    { label: 'Recomendado',     color: '#d4a017' },
  };

  function isLive(promo, ts) {
    if (!promo || promo.active === false) return false;
    const t = ts || Date.now();
    if (promo.startAt && t < promo.startAt) return false;
    if (promo.endAt && t > promo.endAt) return false;
    return true;
  }

  function appliesTo(promo, product) {
    if (!product) return false;
    if ((promo.productIds || []).includes(product.id)) return true;
    if (product.categoryId && (promo.categoryIds || []).includes(product.categoryId)) return true;
    if (product.brandId && (promo.brandIds || []).includes(product.brandId)) return true;
    // compat: marca por nombre si no hay brandId
    if (product.brand && (promo.brandIds || []).includes(product.brand)) return true;
    return false;
  }

  function activeNow() {
    return store.all().filter((p) => isLive(p)).sort((a, b) => (b.priority || 0) - (a.priority || 0));
  }

  function forProduct(product) {
    return activeNow().filter((p) => appliesTo(p, product));
  }

  function badgesFor(product) {
    return forProduct(product).map((p) => ({
      type: p.type,
      label: p.label || (TYPES[p.type] && TYPES[p.type].label) || 'Promo',
      color: p.color || (TYPES[p.type] && TYPES[p.type].color) || '#c0894a',
      priority: p.priority || 0,
    }));
  }

  function productsByType(type) {
    const promos = activeNow().filter((p) => p.type === type);
    if (!promos.length) return [];
    const all = (App.Store && App.Store.state.products) || [];
    const seen = new Set();
    const out = [];
    promos.forEach((promo) => {
      all.forEach((prod) => {
        if (!prod.active) return;
        if (appliesTo(promo, prod) && !seen.has(prod.id)) { seen.add(prod.id); out.push(prod); }
      });
    });
    return out;
  }

  /**
   * DESCUENTO PROGRAMADO: % de rebaja real que las promos VIGENTES aplican a
   * un producto (se toma el mayor si hay varias). El precio se calcula en
   * Store.effectivePrice: al llegar la fecha de inicio el precio baja solo, y
   * al vencer vuelve solo — sin tocar producto por producto.
   */
  function discountFor(product) {
    let best = 0;
    forProduct(product).forEach((p) => {
      const d = Number(p.discountPercent) || 0;
      if (d > best) best = d;
    });
    return Math.min(best, 90); // tope de seguridad
  }

  async function save(input) {
    const promo = Object.assign({
      type: 'destacado', productIds: [], categoryIds: [], brandIds: [],
      startAt: null, endAt: null, priority: 0, color: '', banner: '', label: '', active: true,
      discountPercent: 0, // 0 = solo etiqueta visual (comportamiento anterior)
    }, input);
    promo.discountPercent = Math.max(0, Math.min(90, Number(promo.discountPercent) || 0));
    if (!promo.color && TYPES[promo.type]) promo.color = TYPES[promo.type].color;
    const saved = await store.put(promo);
    if (App.E5.History) App.E5.History.log('promotion', input.id ? 'editada' : 'creada', saved.name || saved.type);
    return saved;
  }
  async function remove(id) {
    await store.remove(id);
    if (App.E5.History) App.E5.History.log('promotion', 'eliminada', id);
  }

  App.E5.Promos = {
    TYPES, list: () => store.list(), all: () => store.all(), get: (id) => store.get(id),
    save, remove, isLive, appliesTo, activeNow, forProduct, badgesFor, productsByType, discountFor,
  };
})(window.App = window.App || {});
