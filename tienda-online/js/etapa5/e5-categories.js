/* =============================================================================
 * e5-categories.js — ETAPA 5 · Punto 4: Categorías inteligentes
 * -----------------------------------------------------------------------------
 * NO crea un store nuevo: trabaja sobre las categorías ya existentes de
 * App.Store (store CATEGORIES de IndexedDB). El modelo de categoría ya tiene
 * { id, name, icon, order, subcategories }. Esta capa añade soporte de IMAGEN
 * y utilidades de REORDENAMIENTO y de orden de subcategorías, persistiendo vía
 * Store.saveCategory (que conserva campos extra gracias a Object.assign).
 *
 * API:
 *   App.E5.Categories.ordered()                 -> categorías ordenadas por .order
 *   App.E5.Categories.setImage(catId, dataURL)  -> Promise
 *   App.E5.Categories.setIcon(catId, icon)      -> Promise
 *   App.E5.Categories.reorder(idsInOrder)       -> Promise (asigna .order 0..n)
 *   App.E5.Categories.move(catId, dir)          -> Promise (dir: -1 sube, +1 baja)
 *   App.E5.Categories.reorderSubs(catId, subIds)-> Promise
 * ========================================================================== */
(function (App) {
  'use strict';
  const E5 = App.E5;

  function cats() { return (App.Store && App.Store.state.categories) || []; }
  function ordered() {
    return cats().slice().sort((a, b) => (a.order || 0) - (b.order || 0) || (a.name || '').localeCompare(b.name || ''));
  }

  async function setImage(catId, dataURL) {
    const c = App.Store.getCategory(catId); if (!c) return;
    await App.Store.saveCategory(Object.assign({}, c, { image: dataURL }));
    if (App.E5.History) App.E5.History.log('category', 'imagen actualizada', c.name);
  }
  async function setIcon(catId, icon) {
    const c = App.Store.getCategory(catId); if (!c) return;
    await App.Store.saveCategory(Object.assign({}, c, { icon: icon }));
    if (App.E5.History) App.E5.History.log('category', 'icono actualizado', c.name);
  }

  async function reorder(idsInOrder) {
    let i = 0;
    for (const id of idsInOrder) {
      const c = App.Store.getCategory(id);
      if (c) { await App.Store.saveCategory(Object.assign({}, c, { order: i++ })); }
    }
    if (App.E5.History) App.E5.History.log('category', 'reordenadas', idsInOrder.length + ' categorías');
  }

  async function move(catId, dir) {
    const list = ordered();
    const idx = list.findIndex((c) => c.id === catId);
    if (idx < 0) return;
    const swap = idx + dir;
    if (swap < 0 || swap >= list.length) return;
    const ids = list.map((c) => c.id);
    const tmp = ids[idx]; ids[idx] = ids[swap]; ids[swap] = tmp;
    await reorder(ids);
  }

  async function reorderSubs(catId, subIds) {
    const c = App.Store.getCategory(catId); if (!c) return;
    const map = new Map((c.subcategories || []).map((s) => [s.id, s]));
    const subs = subIds.map((id) => map.get(id)).filter(Boolean);
    await App.Store.saveCategory(Object.assign({}, c, { subcategories: subs }));
  }

  App.E5.Categories = { ordered, setImage, setIcon, reorder, move, reorderSubs };
})(window.App = window.App || {});
