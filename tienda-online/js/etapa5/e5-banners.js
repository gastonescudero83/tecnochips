/* =============================================================================
 * e5-banners.js — ETAPA 5 · Punto 2: Banner administrable
 * -----------------------------------------------------------------------------
 * Administra banners de portada (colección KV "banners"). 100% offline.
 *
 * Esquema:
 *   { id, image:dataURL, title, subtitle, ctaText, ctaTarget|ctaUrl,
 *     order:Number, active:bool }
 *
 *   ctaTarget: ruta interna (ej. 'destacados', 'categoria/celulares') — se navega
 *              con el router por hash. Si en cambio se define ctaUrl (http...),
 *              se abre como enlace externo.
 *
 * API:
 *   App.E5.Banners.list() / .save(b) / .remove(id) / .reorder(idsArr)
 *   App.E5.Banners.activeOrdered()   -> Array activos ordenados por .order
 *   App.E5.Banners.primary()         -> primer banner activo (portada)
 * ========================================================================== */
(function (App) {
  'use strict';
  const E5 = App.E5;
  const store = E5.coll('banners');

  function activeOrdered() {
    return store.all()
      .filter((b) => b.active !== false)
      .sort((a, b) => (a.order || 0) - (b.order || 0));
  }
  function primary() { return activeOrdered()[0] || null; }

  async function save(input) {
    const b = Object.assign({
      image: '', title: '', subtitle: '', ctaText: '', ctaTarget: '', ctaUrl: '',
      order: store.all().length, active: true,
    }, input);
    const saved = await store.put(b);
    if (App.E5.History) App.E5.History.log('banner', input.id ? 'editado' : 'creado', saved.title || saved.id);
    return saved;
  }
  async function remove(id) {
    await store.remove(id);
    if (App.E5.History) App.E5.History.log('banner', 'eliminado', id);
  }
  async function reorder(idsInOrder) {
    const map = new Map(store.all().map((b) => [b.id, b]));
    let i = 0;
    for (const id of idsInOrder) { const b = map.get(id); if (b) { b.order = i++; await store.put(b); } }
  }

  App.E5.Banners = {
    list: () => store.list(), all: () => store.all(), get: (id) => store.get(id),
    save, remove, reorder, activeOrdered, primary,
  };
})(window.App = window.App || {});
