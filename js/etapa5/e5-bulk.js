/* =============================================================================
 * e5-bulk.js — ETAPA 5 · Punto 10: Gestión masiva
 * -----------------------------------------------------------------------------
 * Operaciones sobre un conjunto de productos (por IDs), usando la capa de
 * dominio existente (App.Store.bulkUpsertProducts). Offline. Registra todo en
 * el historial (pto 11).
 *
 * API (todas async, reciben array de IDs):
 *   App.E5.Bulk.changePrice(ids, percent, {field})  // +10 / -15 (%). field: 'price'|'priceSale'
 *   App.E5.Bulk.moveCategory(ids, categoryId, subId?)
 *   App.E5.Bulk.setActive(ids, true|false)           // activar / ocultar
 *   App.E5.Bulk.replaceImages(ids, [dataURLs])       // reemplaza imágenes
 *   App.E5.Bulk.addImages(ids, [dataURLs])           // agrega sin borrar
 *   App.E5.Bulk.exportSelection(ids, format)         // 'csv'|'json'|'excel'|'pdf'
 * ========================================================================== */
(function (App) {
  'use strict';
  const S = App.Store;

  function pick(ids) {
    const set = new Set(ids);
    return (S.state.products || []).filter((p) => set.has(p.id)).map((p) => Object.assign({}, p));
  }
  function log(action, detail) { if (App.E5.History) App.E5.History.log('bulk', action, detail); }

  async function changePrice(ids, percent, opts) {
    opts = opts || {};
    const field = opts.field === 'priceSale' ? 'priceSale' : 'price';
    const factor = 1 + (Number(percent) || 0) / 100;
    const items = pick(ids).map((p) => {
      if (p.priceLock) return p; // respeta precio manual bloqueado
      const base = Number(p[field]) || 0;
      if (base > 0) p[field] = Math.round(base * factor);
      return p;
    });
    const n = await S.bulkUpsertProducts(items);
    log('cambio de precio', `${percent}% sobre ${field} · ${n} productos`);
    return n;
  }

  async function moveCategory(ids, categoryId, subId) {
    const items = pick(ids).map((p) => { p.categoryId = categoryId || ''; p.subcategoryId = subId || ''; return p; });
    const n = await S.bulkUpsertProducts(items);
    const cat = S.getCategory(categoryId);
    log('mover categoría', `${n} productos → ${cat ? cat.name : '(sin categoría)'}`);
    return n;
  }

  async function setActive(ids, active) {
    const items = pick(ids).map((p) => { p.active = !!active; return p; });
    const n = await S.bulkUpsertProducts(items);
    log(active ? 'activar' : 'ocultar', `${n} productos`);
    return n;
  }

  async function replaceImages(ids, dataURLs) {
    const imgs = Array.isArray(dataURLs) ? dataURLs : [dataURLs];
    const items = pick(ids).map((p) => { p.images = imgs.slice(); return p; });
    const n = await S.bulkUpsertProducts(items);
    log('reemplazar imágenes', `${n} productos`);
    return n;
  }

  async function addImages(ids, dataURLs) {
    const imgs = Array.isArray(dataURLs) ? dataURLs : [dataURLs];
    const items = pick(ids).map((p) => { p.images = (p.images || []).concat(imgs); return p; });
    const n = await S.bulkUpsertProducts(items);
    log('agregar imágenes', `${n} productos`);
    return n;
  }

  function exportSelection(ids, format) {
    const rows = pick(ids);
    const E = App.E5.Export;
    if (!E) return;
    (E[format] || E.csv)(rows);
  }

  App.E5 = App.E5 || {};
  App.E5.Bulk = { changePrice, moveCategory, setActive, replaceImages, addImages, exportSelection };
})(window.App = window.App || {});
