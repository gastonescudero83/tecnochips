/* =============================================================================
 * db.js — Capa de persistencia local (IndexedDB con fallback a localStorage)
 * -----------------------------------------------------------------------------
 * Expone `App.DB`, una API asíncrona y agnóstica del motor. El resto de la app
 * nunca habla con IndexedDB directamente: pasa por aquí. Esto permite, el día
 * de mañana, reemplazar esta capa por llamadas a una API/REST sin tocar la UI.
 *
 * API pública (todas devuelven Promesas):
 *   DB.ready()                       -> Promise<void>
 *   DB.getAll(store)                 -> Promise<Array>
 *   DB.get(store, id)                -> Promise<obj|undefined>
 *   DB.put(store, obj)               -> Promise<obj>
 *   DB.bulkPut(store, arr)           -> Promise<number>
 *   DB.delete(store, id)             -> Promise<void>
 *   DB.clear(store)                  -> Promise<void>
 *   DB.count(store)                  -> Promise<number>
 *   DB.kvGet(key) / DB.kvSet(key,v) / DB.kvDel(key)
 * ========================================================================== */
(function (App) {
  'use strict';

  const { DB_NAME, DB_VERSION, STORES } = App.CONST;
  const STORE_LIST = Object.values(STORES);

  let db = null;
  let mode = null; // 'idb' | 'ls'
  let openPromise = null;

  /* ---------- Backend: IndexedDB ------------------------------------------ */
  function openIDB() {
    return new Promise((resolve, reject) => {
      let req;
      try { req = indexedDB.open(DB_NAME, DB_VERSION); }
      catch (e) { return reject(e); }

      req.onupgradeneeded = (e) => {
        const idb = e.target.result;
        if (!idb.objectStoreNames.contains(STORES.PRODUCTS))
          idb.createObjectStore(STORES.PRODUCTS, { keyPath: 'id' });
        if (!idb.objectStoreNames.contains(STORES.CATEGORIES))
          idb.createObjectStore(STORES.CATEGORIES, { keyPath: 'id' });
        if (!idb.objectStoreNames.contains(STORES.COMMENTS)) {
          const cs = idb.createObjectStore(STORES.COMMENTS, { keyPath: 'id' });
          cs.createIndex('productId', 'productId', { unique: false });
        }
        if (!idb.objectStoreNames.contains(STORES.KV))
          idb.createObjectStore(STORES.KV, { keyPath: 'key' });
      };
      req.onsuccess = (e) => resolve(e.target.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('IndexedDB bloqueada por otra pestaña'));
    });
  }

  function tx(store, mode2) {
    const t = db.transaction(store, mode2);
    return t.objectStore(store);
  }
  const wrap = (req) => new Promise((res, rej) => {
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });

  const idbBackend = {
    getAll: (store) => wrap(tx(store, 'readonly').getAll()),
    get: (store, id) => wrap(tx(store, 'readonly').get(id)),
    put: (store, obj) => wrap(tx(store, 'readwrite').put(obj)).then(() => obj),
    delete: (store, id) => wrap(tx(store, 'readwrite').delete(id)),
    clear: (store) => wrap(tx(store, 'readwrite').clear()),
    count: (store) => wrap(tx(store, 'readonly').count()),
    bulkPut: (store, arr) => new Promise((res, rej) => {
      const t = db.transaction(store, 'readwrite');
      const os = t.objectStore(store);
      arr.forEach((o) => os.put(o));
      t.oncomplete = () => res(arr.length);
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error);
    }),
  };

  /* ---------- Backend: localStorage (fallback) ----------------------------
   * Para navegadores sin IndexedDB o en modo privado restringido. Mantiene la
   * misma interfaz. Limitación conocida: ~5MB, por eso IndexedDB es preferido.
   * --------------------------------------------------------------------- */
  const LS_PREFIX = DB_NAME + ':';
  function lsRead(store) {
    try { return JSON.parse(localStorage.getItem(LS_PREFIX + store) || '[]'); }
    catch (_e) { return []; }
  }
  function lsWrite(store, arr) {
    try {
      localStorage.setItem(LS_PREFIX + store, JSON.stringify(arr));
    } catch (e) {
      // Cuota superada (~5MB): antes fallaba en silencio y los guardados
      // quedaban inconsistentes. Ahora el error llega a la UI con un mensaje claro.
      console.error('[DB] localStorage sin espacio', e);
      throw new Error('Almacenamiento local lleno: no se pudo guardar. Exportá un backup, borrá imágenes pesadas o usá un navegador con IndexedDB.');
    }
  }
  const lsBackend = {
    getAll: (store) => Promise.resolve(lsRead(store)),
    get: (store, id) => Promise.resolve(lsRead(store).find((o) => o.key === id || o.id === id)),
    put: (store, obj) => {
      const arr = lsRead(store);
      const key = obj.id != null ? 'id' : 'key';
      const i = arr.findIndex((o) => o[key] === obj[key]);
      if (i >= 0) arr[i] = obj; else arr.push(obj);
      lsWrite(store, arr);
      return Promise.resolve(obj);
    },
    delete: (store, id) => {
      lsWrite(store, lsRead(store).filter((o) => o.id !== id && o.key !== id));
      return Promise.resolve();
    },
    clear: (store) => { lsWrite(store, []); return Promise.resolve(); },
    count: (store) => Promise.resolve(lsRead(store).length),
    bulkPut: (store, arr) => {
      const cur = lsRead(store);
      const key = arr[0] && arr[0].id != null ? 'id' : 'key';
      const map = new Map(cur.map((o) => [o[key], o]));
      arr.forEach((o) => map.set(o[key], o));
      lsWrite(store, Array.from(map.values()));
      return Promise.resolve(arr.length);
    },
  };

  /* ---------- Inicialización ---------------------------------------------- */
  function ready() {
    if (openPromise) return openPromise;
    openPromise = (async () => {
      if ('indexedDB' in window) {
        try {
          db = await openIDB();
          mode = 'idb';
          return;
        } catch (e) {
          console.warn('[DB] IndexedDB no disponible, usando localStorage.', e);
        }
      }
      mode = 'ls';
    })();
    return openPromise;
  }

  function backend() { return mode === 'idb' ? idbBackend : lsBackend; }

  /* ---------- API pública -------------------------------------------------- */
  const DB = {
    ready,
    get mode() { return mode; },
    getAll: (store) => ready().then(() => backend().getAll(store)),
    get: (store, id) => ready().then(() => backend().get(store, id)),
    put: (store, obj) => ready().then(() => backend().put(store, obj)),
    bulkPut: (store, arr) => ready().then(() => backend().bulkPut(store, arr)),
    delete: (store, id) => ready().then(() => backend().delete(store, id)),
    clear: (store) => ready().then(() => backend().clear(store)),
    count: (store) => ready().then(() => backend().count(store)),

    // Helpers de clave/valor sobre el store KV
    kvGet: (key) => DB.get(STORES.KV, key).then((r) => (r ? r.value : undefined)),
    kvSet: (key, value) => DB.put(STORES.KV, { key, value }),
    kvDel: (key) => DB.delete(STORES.KV, key),

    /** Vacía todos los stores (factory reset). */
    wipe: async () => {
      await Promise.all(STORE_LIST.map((s) => DB.clear(s)));
    },

    /** Borra y recrea la base completamente (para "restablecer de fábrica"). */
    destroy: () => new Promise((resolve) => {
      if (mode !== 'idb') {
        STORE_LIST.forEach((s) => localStorage.removeItem(LS_PREFIX + s));
        return resolve();
      }
      if (db) { db.close(); db = null; }
      const req = indexedDB.deleteDatabase(DB_NAME);
      req.onsuccess = req.onerror = req.onblocked = () => { openPromise = null; resolve(); };
    }),
  };

  App.DB = DB;
})(window.App = window.App || {});
