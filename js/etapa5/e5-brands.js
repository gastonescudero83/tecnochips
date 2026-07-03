/* =============================================================================
 * e5-brands.js — ETAPA 5 · Punto 3: Marcas
 * -----------------------------------------------------------------------------
 * Sección de marcas (colección KV "brands"). 100% offline.
 *
 * Esquema:
 *   { id, name, slug, logo:dataURL, cover:dataURL, description, order, active }
 *
 * Asociación con productos: un producto puede tener `brandId` (nuevo) o el campo
 * legacy `brand` (texto). `productsOf` matchea por ambos para no romper datos
 * previos importados que sólo tienen el nombre de marca.
 *
 * API:
 *   App.E5.Brands.list() / .save(b) / .remove(id)
 *   App.E5.Brands.activeOrdered()
 *   App.E5.Brands.get(id) / .bySlug(slug) / .byName(name)
 *   App.E5.Brands.productsOf(brand|id)   -> Array<product>
 *   App.E5.Brands.slugify(text)
 * ========================================================================== */
(function (App) {
  'use strict';
  const E5 = App.E5;
  const store = E5.coll('brands');

  function slugify(t) {
    return String(t || '').toLowerCase().trim()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  }

  function activeOrdered() {
    return store.all().filter((b) => b.active !== false)
      .sort((a, b) => (a.order || 0) - (b.order || 0) || (a.name || '').localeCompare(b.name || ''));
  }
  function bySlug(slug) { return store.all().find((b) => b.slug === slug); }
  function byName(name) {
    const n = String(name || '').toLowerCase();
    return store.all().find((b) => (b.name || '').toLowerCase() === n);
  }

  function productsOf(brandOrId) {
    const brand = typeof brandOrId === 'string' ? (store.get(brandOrId) || byName(brandOrId)) : brandOrId;
    if (!brand) return [];
    const all = (App.Store && App.Store.state.products) || [];
    const nameLc = (brand.name || '').toLowerCase();
    return all.filter((p) => p.active !== false && (
      p.brandId === brand.id || (p.brand && p.brand.toLowerCase() === nameLc)
    ));
  }

  async function save(input) {
    const b = Object.assign({
      name: '', slug: '', logo: '', cover: '', description: '', order: store.all().length, active: true,
    }, input);
    if (!b.slug) b.slug = slugify(b.name);
    const saved = await store.put(b);
    if (App.E5.History) App.E5.History.log('brand', input.id ? 'editada' : 'creada', saved.name);
    return saved;
  }
  async function remove(id) {
    await store.remove(id);
    if (App.E5.History) App.E5.History.log('brand', 'eliminada', id);
  }

  App.E5.Brands = {
    list: () => store.list(), all: () => store.all(), get: (id) => store.get(id),
    save, remove, activeOrdered, bySlug, byName, productsOf, slugify,
  };
})(window.App = window.App || {});
