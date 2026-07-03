/* =============================================================================
 * store.js — Estado de la aplicación y reglas de negocio (capa de dominio)
 * -----------------------------------------------------------------------------
 * Única fuente de verdad en memoria. Carga desde `App.DB`, mantiene el estado,
 * expone operaciones CRUD de alto nivel y emite eventos para que la UI se
 * actualice (patrón pub/sub). La UI nunca toca la DB ni recalcula precios:
 * siempre pasa por aquí. Así, migrar a una API remota = reescribir solo esta capa.
 * ========================================================================== */
(function (App) {
  'use strict';

  const { U, DB } = App;
  const { STORES, KV_KEYS } = App.CONST;

  /* ---- Estado en memoria -------------------------------------------------- */
  const state = {
    settings: Object.assign({}, App.DEFAULT_SETTINGS),
    products: [],
    categories: [],
    comments: [],
    loaded: false,
  };

  /* ---- Pub/Sub mínimo ----------------------------------------------------- */
  const listeners = {};
  function on(event, cb) {
    (listeners[event] = listeners[event] || []).push(cb);
    return () => {
      listeners[event] = (listeners[event] || []).filter((f) => f !== cb);
    };
  }
  function emit(event, payload) {
    (listeners[event] || []).forEach((cb) => {
      try { cb(payload); } catch (e) { console.error('[Store] listener', event, e); }
    });
    // 'change' es un evento agregado para refrescos genéricos
    if (event !== 'change') (listeners['change'] || []).forEach((cb) => cb({ event, payload }));
  }

  /* ---- Inicialización ----------------------------------------------------- */
  async function init() {
    await DB.ready();
    // Settings (fusiona con defaults para tolerar nuevas claves entre versiones)
    const savedSettings = await DB.kvGet(KV_KEYS.SETTINGS);
    state.settings = deepMerge(clone(App.DEFAULT_SETTINGS), savedSettings || {});

    state.categories = await DB.getAll(STORES.CATEGORIES);
    state.products = await DB.getAll(STORES.PRODUCTS);
    state.comments = await DB.getAll(STORES.COMMENTS);

    // Migración suave: categorías que quedaron con el ícono genérico 🛍️ (por
    // importaciones anteriores) reciben su emoji acorde al rubro, una sola vez.
    if (U.categoryEmoji) {
      for (const c of state.categories) {
        if (!c.icon || c.icon === '🛍️') {
          const e = U.categoryEmoji(c.name);
          if (e !== c.icon && e !== '🛍️') { c.icon = e; await DB.put(STORES.CATEGORIES, c); }
        }
      }
    }

    // Catálogo publicado: si el sitio trae un JSON más nuevo que lo importado
    // en este dispositivo, se carga automáticamente (visitantes ven datos reales).
    await syncPublishedData();

    // Primer arranque: sembrar datos de demostración
    if (!state.categories.length && !state.products.length) {
      await seed();
    }

    state.loaded = true;
    emit('ready');
    return state;
  }

  /** Carga js/seed.js bajo demanda: pesa ~330KB y solo se necesita en el
   *  PRIMER arranque o tras un reset — antes se parseaba en cada carga. */
  function loadSeedScript() {
    return new Promise((resolve) => {
      if (App.SEED) return resolve();
      const s = document.createElement('script');
      s.src = 'js/seed.js';
      s.onload = () => resolve();
      s.onerror = () => resolve(); // sin seed disponible: arranca vacío
      document.head.appendChild(s);
    });
  }

  async function seed() {
    await loadSeedScript();
    const data = App.SEED || { categories: [], products: [] };
    if (data.categories.length) {
      await DB.bulkPut(STORES.CATEGORIES, data.categories);
      state.categories = data.categories.slice();
    }
    if (data.products.length) {
      await DB.bulkPut(STORES.PRODUCTS, data.products);
      state.products = data.products.slice();
    }
    if (data.comments && data.comments.length) {
      await DB.bulkPut(STORES.COMMENTS, data.comments);
      state.comments = data.comments.slice();
    }
    emit('seeded');
  }

  /* ---- Utilidades internas ------------------------------------------------ */
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function deepMerge(base, extra) {
    Object.keys(extra || {}).forEach((k) => {
      // Anti prototype-pollution: un backup JSON manipulado con "__proto__"
      // podría contaminar Object.prototype al restaurar settings.
      if (k === '__proto__' || k === 'constructor' || k === 'prototype') return;
      if (extra[k] && typeof extra[k] === 'object' && !Array.isArray(extra[k])) {
        base[k] = deepMerge(base[k] || {}, extra[k]);
      } else if (extra[k] !== undefined) {
        base[k] = extra[k];
      }
    });
    return base;
  }

  /* ---- SETTINGS ----------------------------------------------------------- */
  async function saveSettings(patch) {
    state.settings = deepMerge(clone(state.settings), patch || {});
    await DB.kvSet(KV_KEYS.SETTINGS, state.settings);
    emit('settings', state.settings);
    return state.settings;
  }

  /* ---- PRECIOS (reglas de negocio centralizadas) -------------------------- */
  // % de descuento de las OFERTAS PROGRAMADAS vigentes (módulo E5.Promos).
  // Se consulta en el momento: al llegar la fecha de inicio el precio baja
  // solo, y al vencer vuelve solo. 0 si no hay promo con descuento aplicable.
  function promoDiscount(p) {
    return (App.E5 && App.E5.Promos && App.E5.Promos.discountFor)
      ? App.E5.Promos.discountFor(p) : 0;
  }
  // Precio efectivo que paga el cliente
  function effectivePrice(p) {
    const base = p.priceSale != null && p.priceSale > 0 ? p.priceSale : (p.price || 0);
    const d = promoDiscount(p);
    return d > 0 ? Math.round(base * (1 - d / 100) * 100) / 100 : base;
  }
  // Precio a mostrar tachado (comparativo), o null si no hay descuento visible
  function comparePrice(p) {
    if (p.priceOld != null && p.priceOld > 0) return p.priceOld;
    if (p.priceSale != null && p.priceSale > 0 && p.price > 0) return p.price;
    if (promoDiscount(p) > 0 && p.price > 0) return p.price; // oferta programada
    return null;
  }
  function isOnSale(p) {
    const cmp = comparePrice(p);
    return cmp != null && cmp > effectivePrice(p);
  }
  function discountPercent(p) {
    const cmp = comparePrice(p);
    if (!cmp || cmp <= 0) return 0;
    return Math.round((1 - effectivePrice(p) / cmp) * 100);
  }

  /* ---- PRODUCTOS ---------------------------------------------------------- */
  function getProduct(id) { return state.products.find((p) => p.id === id); }

  async function saveProduct(input) {
    const now = Date.now();
    const existing = input.id ? getProduct(input.id) : null;
    const base = existing ? clone(existing) : App.productSchema();
    const p = Object.assign(base, input);
    if (!p.id) p.id = U.uid('prod');
    if (!p.createdAt) p.createdAt = now;
    p.updatedAt = now;
    // Normalizaciones defensivas
    p.price = Number(p.price) || 0;
    p.priceOld = p.priceOld === '' || p.priceOld == null ? null : Number(p.priceOld);
    p.priceSale = p.priceSale === '' || p.priceSale == null ? null : Number(p.priceSale);
    p.stock = Number(p.stock) || 0;
    p.tags = Array.isArray(p.tags) ? p.tags : [];
    p.images = Array.isArray(p.images) ? p.images : [];

    await DB.put(STORES.PRODUCTS, p);
    const i = state.products.findIndex((x) => x.id === p.id);
    if (i >= 0) state.products[i] = p; else state.products.push(p);
    emit('products', { type: existing ? 'update' : 'create', product: p });
    return p;
  }

  async function deleteProduct(id) {
    await DB.delete(STORES.PRODUCTS, id);
    state.products = state.products.filter((p) => p.id !== id);
    // Borra comentarios huérfanos
    const orphans = state.comments.filter((c) => c.productId === id);
    await Promise.all(orphans.map((c) => DB.delete(STORES.COMMENTS, c.id)));
    state.comments = state.comments.filter((c) => c.productId !== id);
    emit('products', { type: 'delete', id });
  }

  async function bulkUpsertProducts(arr) {
    const now = Date.now();
    const prepared = arr.map((raw) => {
      const p = Object.assign(App.productSchema(), raw);
      if (!p.id) p.id = U.uid('prod');
      if (!p.createdAt) p.createdAt = now;
      p.updatedAt = now;
      return p;
    });
    await DB.bulkPut(STORES.PRODUCTS, prepared);
    // Refrescar memoria
    const map = new Map(state.products.map((p) => [p.id, p]));
    prepared.forEach((p) => map.set(p.id, p));
    state.products = Array.from(map.values());
    emit('products', { type: 'bulk', count: prepared.length });
    return prepared.length;
  }

  /* ---- CATEGORÍAS / SUBCATEGORÍAS ----------------------------------------
   * Modelo: cada categoría tiene { id, name, icon, order, subcategories:[{id,name}] }
   * --------------------------------------------------------------------- */
  function getCategory(id) { return state.categories.find((c) => c.id === id); }
  function getSubcategory(catId, subId) {
    const c = getCategory(catId);
    return c && (c.subcategories || []).find((s) => s.id === subId);
  }

  async function saveCategory(input) {
    const existing = input.id ? getCategory(input.id) : null;
    const c = Object.assign(
      existing ? clone(existing) : { id: '', name: '', icon: '', order: state.categories.length, subcategories: [] },
      input
    );
    if (!c.id) c.id = U.uid('cat');
    // Emoji automático acorde al rubro para categorías NUEVAS sin ícono
    // propio (o con el genérico): "Cocina" → 🍳, "Heladeras" → ❄️, etc.
    if (!existing && (!c.icon || c.icon === '🛍️') && U.categoryEmoji) {
      c.icon = U.categoryEmoji(c.name);
    }
    c.subcategories = Array.isArray(c.subcategories) ? c.subcategories : [];
    await DB.put(STORES.CATEGORIES, c);
    const i = state.categories.findIndex((x) => x.id === c.id);
    if (i >= 0) state.categories[i] = c; else state.categories.push(c);
    emit('categories', { type: existing ? 'update' : 'create', category: c });
    return c;
  }

  async function deleteCategory(id) {
    await DB.delete(STORES.CATEGORIES, id);
    state.categories = state.categories.filter((c) => c.id !== id);
    // Desasignar productos de esa categoría (no se borran)
    const affected = state.products.filter((p) => p.categoryId === id);
    for (const p of affected) { p.categoryId = ''; p.subcategoryId = ''; await DB.put(STORES.PRODUCTS, p); }
    emit('categories', { type: 'delete', id });
  }

  async function addSubcategory(catId, name) {
    const c = getCategory(catId);
    if (!c) return null;
    const sub = { id: U.uid('sub'), name: name };
    c.subcategories = c.subcategories || [];
    c.subcategories.push(sub);
    await saveCategory(c);
    return sub;
  }

  async function deleteSubcategory(catId, subId) {
    const c = getCategory(catId);
    if (!c) return;
    c.subcategories = (c.subcategories || []).filter((s) => s.id !== subId);
    await saveCategory(c);
    const affected = state.products.filter((p) => p.subcategoryId === subId);
    for (const p of affected) { p.subcategoryId = ''; await DB.put(STORES.PRODUCTS, p); }
    emit('categories', { type: 'subdelete', catId, subId });
  }

  /* ---- COMENTARIOS -------------------------------------------------------- */
  function commentsFor(productId, onlyApproved) {
    return state.comments
      .filter((c) => c.productId === productId && (!onlyApproved || c.approved))
      .sort((a, b) => b.date - a.date);
  }
  function ratingFor(productId) {
    const list = commentsFor(productId, true);
    if (!list.length) return { avg: 0, count: 0 };
    const sum = list.reduce((acc, c) => acc + (Number(c.rating) || 0), 0);
    return { avg: sum / list.length, count: list.length };
  }
  async function saveComment(input) {
    const existing = input.id ? state.comments.find((c) => c.id === input.id) : null;
    const c = Object.assign(existing ? clone(existing) : App.commentSchema(), input);
    if (!c.id) c.id = U.uid('cmt');
    if (!c.date) c.date = Date.now();
    c.rating = U.clamp(Number(c.rating) || 5, 1, 5);
    await DB.put(STORES.COMMENTS, c);
    const i = state.comments.findIndex((x) => x.id === c.id);
    if (i >= 0) state.comments[i] = c; else state.comments.push(c);
    emit('comments', { type: existing ? 'update' : 'create', comment: c });
    return c;
  }
  async function deleteComment(id) {
    await DB.delete(STORES.COMMENTS, id);
    state.comments = state.comments.filter((c) => c.id !== id);
    emit('comments', { type: 'delete', id });
  }

  /* ---- SEGURIDAD: clave del admin -----------------------------------------
   * Si App.ADMIN_HASH está definido en config.js, la clave es FIJA: nunca se
   * ofrece "crear contraseña" (ni en el sitio publicado ni local) y no se
   * puede cambiar desde el panel. Sin ADMIN_HASH, funciona como antes (KV). */
  async function hasPassword() {
    if (App.ADMIN_HASH) return true;
    return !!(await DB.kvGet(KV_KEYS.PASSWORD));
  }
  async function setPassword(plain) {
    if (App.ADMIN_HASH) throw new Error('La contraseña es fija (definida en config.js).');
    const hash = await U.hash(plain);
    await DB.kvSet(KV_KEYS.PASSWORD, hash);
  }
  async function checkPassword(plain) {
    if (App.ADMIN_HASH) return (await U.hash(plain)) === App.ADMIN_HASH;
    const stored = await DB.kvGet(KV_KEYS.PASSWORD);
    if (!stored) return false;
    return (await U.hash(plain)) === stored;
  }

  /* ---- PUBLICACIÓN: importar catálogo publicado ---------------------------
   * Descarga App.PUBLISHED_DATA_URL (backup JSON exportado desde el panel).
   * Si su meta.exportedAt es más nuevo que lo último importado en este
   * dispositivo, lo importa completo (reemplaza). Offline o sin archivo: no
   * hace nada (la tienda sigue con sus datos locales o el seed). */
  const KV_PUBLISHED = 'published_version';

  async function syncPublishedData() {
    if (!App.PUBLISHED_DATA_URL) return;
    if (location.protocol === 'file:') return; // sin hosting no hay archivo publicado
    try {
      // Query única: evita el caché del Service Worker y del navegador.
      const res = await fetch(App.PUBLISHED_DATA_URL + '?v=' + Date.now(), { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      const remote = data && data.meta && Number(data.meta.exportedAt);
      if (!remote) return;
      const local = Number(await DB.kvGet(KV_PUBLISHED)) || 0;
      if (remote <= local) return; // ya está al día
      await importAll(data, { merge: false });
      await DB.kvSet(KV_PUBLISHED, remote);
      console.info('[Store] Catálogo publicado importado:', new Date(remote).toLocaleString());
    } catch (e) {
      console.warn('[Store] No se pudo leer el catálogo publicado (¿offline?)', e);
    }
  }

  /* ---- BACKUP / RESTORE (JSON completo) ----------------------------------
   * v2: además de productos/categorías/comentarios/settings, el backup incluye
   * TODO el almacén KV (colecciones E5: promociones, banners, marcas, historial;
   * y patrones del mapeo asistido). La contraseña NUNCA viaja en el archivo.
   * ---------------------------------------------------------------------- */
  const KV_EXCLUDE = [KV_KEYS.PASSWORD, KV_KEYS.SETTINGS]; // settings ya va aparte

  async function exportAll() {
    const kvRows = await DB.getAll(STORES.KV);
    const kv = (kvRows || [])
      .filter((r) => r && r.key && KV_EXCLUDE.indexOf(r.key) < 0)
      .map((r) => ({ key: r.key, value: r.value }));
    return {
      meta: { app: 'tienda-pwa', version: 2, exportedAt: Date.now() },
      settings: state.settings,
      categories: state.categories,
      products: state.products,
      comments: state.comments,
      kv,
    };
  }

  /** Valida la estructura de un backup SIN tocar la base.
   *  Devuelve { ok, reason, counts } — la UI puede mostrar counts en el confirm. */
  function validateBackup(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return { ok: false, reason: 'El archivo no es un backup válido (no es un objeto JSON).' };
    }
    if (!data.meta || data.meta.app !== 'tienda-pwa') {
      return { ok: false, reason: 'El archivo no es un backup de esta tienda.' };
    }
    const bad = ['categories', 'products', 'comments', 'kv']
      .find((k) => data[k] !== undefined && !Array.isArray(data[k]));
    if (bad) return { ok: false, reason: 'El campo "' + bad + '" del backup está dañado.' };
    if (!Array.isArray(data.products) && !Array.isArray(data.categories) && !data.settings) {
      return { ok: false, reason: 'El backup no contiene datos (ni productos, ni categorías, ni configuración).' };
    }
    return {
      ok: true, reason: '',
      counts: {
        products: (data.products || []).length,
        categories: (data.categories || []).length,
        comments: (data.comments || []).length,
        kv: (data.kv || []).length,
        version: (data.meta && data.meta.version) || 1,
      },
    };
  }

  async function importAll(data, { merge = false } = {}) {
    const v = validateBackup(data);
    if (!v.ok) throw new Error(v.reason);

    // Snapshot para rollback: si algo falla a mitad de camino, se restaura
    // el estado previo (stores principales + settings) y se informa el error.
    const snapshot = {
      settings: clone(state.settings),
      categories: clone(state.categories),
      products: clone(state.products),
      comments: clone(state.comments),
    };

    try {
      if (!merge) {
        await DB.clear(STORES.PRODUCTS);
        await DB.clear(STORES.CATEGORIES);
        await DB.clear(STORES.COMMENTS);
        state.products = []; state.categories = []; state.comments = [];
      }
      if (data.settings) await saveSettings(data.settings);
      if (Array.isArray(data.categories)) {
        await DB.bulkPut(STORES.CATEGORIES, data.categories);
        mergeInto(state.categories, data.categories);
      }
      if (Array.isArray(data.products)) {
        await DB.bulkPut(STORES.PRODUCTS, data.products);
        mergeInto(state.products, data.products);
      }
      if (Array.isArray(data.comments)) {
        await DB.bulkPut(STORES.COMMENTS, data.comments);
        mergeInto(state.comments, data.comments);
      }
      // v2: restaurar el resto del KV (E5, patrones de mapeo, etc.).
      // En modo "combinar", los arrays se fusionan por id en vez de reemplazarse.
      if (Array.isArray(data.kv)) {
        for (const row of data.kv) {
          if (!row || !row.key || KV_EXCLUDE.indexOf(row.key) > -1) continue;
          let value = row.value;
          if (merge && Array.isArray(value)) {
            const cur = await DB.kvGet(row.key);
            if (Array.isArray(cur)) {
              const map = new Map();
              cur.concat(value).forEach((o, i) => map.set(o && o.id != null ? o.id : 'i' + i, o));
              value = Array.from(map.values());
            }
          }
          // Colecciones E5: replaceAll actualiza también su caché en memoria.
          if (App.E5 && App.E5.coll && row.key.indexOf('e5:') === 0 && Array.isArray(value)) {
            await App.E5.coll(row.key.slice(3)).replaceAll(value);
          } else {
            await DB.kvSet(row.key, value);
          }
        }
      }
      emit('imported');
    } catch (e) {
      // ROLLBACK: vuelve al estado previo en DB y en memoria.
      try {
        await DB.clear(STORES.PRODUCTS);
        await DB.clear(STORES.CATEGORIES);
        await DB.clear(STORES.COMMENTS);
        if (snapshot.products.length) await DB.bulkPut(STORES.PRODUCTS, snapshot.products);
        if (snapshot.categories.length) await DB.bulkPut(STORES.CATEGORIES, snapshot.categories);
        if (snapshot.comments.length) await DB.bulkPut(STORES.COMMENTS, snapshot.comments);
        await DB.kvSet(KV_KEYS.SETTINGS, snapshot.settings);
        state.settings = snapshot.settings;
        state.products = snapshot.products;
        state.categories = snapshot.categories;
        state.comments = snapshot.comments;
        emit('imported'); // notifica a la UI que el estado cambió (volvió al previo)
      } catch (_e) { /* si el rollback también falla, se conserva el error original */ }
      throw new Error('La restauración falló y se revirtieron los cambios: ' + (e.message || e));
    }
  }
  function mergeInto(target, incoming) {
    const map = new Map(target.map((o) => [o.id, o]));
    incoming.forEach((o) => map.set(o.id, o));
    target.length = 0;
    Array.from(map.values()).forEach((o) => target.push(o));
  }

  async function factoryReset() {
    await DB.wipe();
    await DB.kvDel(KV_KEYS.PASSWORD);
    state.products = []; state.categories = []; state.comments = [];
    state.settings = clone(App.DEFAULT_SETTINGS);
    await seed();
    emit('reset');
  }

  /* ---- API pública -------------------------------------------------------- */
  App.Store = {
    state, on, emit, init, seed,
    // settings
    saveSettings,
    // precios
    effectivePrice, comparePrice, isOnSale, discountPercent,
    // productos
    getProduct, saveProduct, deleteProduct, bulkUpsertProducts,
    // categorías
    getCategory, getSubcategory, saveCategory, deleteCategory, addSubcategory, deleteSubcategory,
    // comentarios
    commentsFor, ratingFor, saveComment, deleteComment,
    // seguridad
    hasPassword, setPassword, checkPassword,
    // backup
    exportAll, importAll, validateBackup, factoryReset,
  };
})(window.App = window.App || {});
