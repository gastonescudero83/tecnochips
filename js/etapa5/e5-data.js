/* =============================================================================
 * e5-data.js — ETAPA 5 · Capa de datos (CIMIENTO)
 * -----------------------------------------------------------------------------
 * Namespace nuevo `App.E5`. Guarda TODAS sus colecciones dentro del store `kv`
 * que YA existe en IndexedDB (App.DB), bajo claves prefijadas con "e5:". Así NO
 * se modifica el esquema de la base, NO se bumpea DB_VERSION y NO se rompe nada
 * de lo existente. Es 100% offline.
 *
 * Cada "colección" es un array JSON persistido en una clave KV. Esta capa expone
 * un mini-ORM uniforme (list / get / put / remove / clear / replaceAll) que el
 * resto de los módulos de la ETAPA 5 reutilizan.
 *
 * API pública:
 *   App.E5.ready()                         -> Promise<void>
 *   App.E5.coll(name)                      -> objeto colección
 *   App.E5.uid(prefix)                     -> id único
 *   App.E5.now()                           -> timestamp
 *   App.E5.emit(evt,data) / App.E5.on(evt,cb)
 *
 *   coll.list()            -> Promise<Array>        (cache en memoria)
 *   coll.all()            -> Array (sincrónico, desde cache; usar tras ready)
 *   coll.get(id)           -> obj | undefined
 *   coll.put(obj)          -> Promise<obj>
 *   coll.remove(id)        -> Promise<void>
 *   coll.replaceAll(arr)   -> Promise<void>
 *   coll.clear()           -> Promise<void>
 *
 * Claves KV usadas (todas con prefijo "e5:"):
 *   e5:promotions  e5:banners  e5:brands  e5:history
 *   e5:security_log  e5:favorites_meta  e5:config_ext  ...
 * ========================================================================== */
(function (App) {
  'use strict';

  const DB = App.DB;
  const KV_PREFIX = 'e5:';

  /* ---- Pub/Sub propio de la etapa 5 -------------------------------------- */
  const listeners = {};
  function on(evt, cb) {
    (listeners[evt] = listeners[evt] || []).push(cb);
    return () => { listeners[evt] = (listeners[evt] || []).filter((f) => f !== cb); };
  }
  function emit(evt, data) {
    (listeners[evt] || []).forEach((cb) => { try { cb(data); } catch (e) { console.error('[E5]', evt, e); } });
    if (evt !== 'change') (listeners['change'] || []).forEach((cb) => cb({ evt, data }));
  }

  /* ---- Utilidades --------------------------------------------------------- */
  function uid(prefix) {
    return (prefix || 'e5') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }
  function now() { return Date.now(); }
  function clone(o) { return o == null ? o : JSON.parse(JSON.stringify(o)); }

  /* ---- Fábrica de colecciones KV ----------------------------------------- */
  const _registry = {};
  function coll(name) {
    if (_registry[name]) return _registry[name];

    const key = KV_PREFIX + name;
    let cache = null; // Array en memoria

    async function load() {
      if (cache) return cache;
      const raw = await DB.kvGet(key);
      // FIX anti-carrera: si mientras esperábamos la lectura otro flujo (la
      // importación del catálogo publicado) ya llenó la caché, NO pisarla.
      if (cache) return cache;
      cache = Array.isArray(raw) ? raw : [];
      return cache;
    }
    async function flush() {
      await DB.kvSet(key, cache || []);
    }

    const api = {
      name,
      key,
      async list() { return clone(await load()); },
      all() { return cache ? clone(cache) : []; },
      get(id) { return cache ? clone(cache.find((o) => o.id === id)) : undefined; },
      async getAsync(id) { await load(); return this.get(id); },

      async put(obj) {
        await load();
        const o = Object.assign({}, obj);
        if (!o.id) o.id = uid(name.slice(0, 4));
        if (!o.createdAt) o.createdAt = now();
        o.updatedAt = now();
        const i = cache.findIndex((x) => x.id === o.id);
        if (i >= 0) cache[i] = o; else cache.push(o);
        await flush();
        emit(name, { type: i >= 0 ? 'update' : 'create', item: o });
        return clone(o);
      },

      async remove(id) {
        await load();
        cache = cache.filter((o) => o.id !== id);
        await flush();
        emit(name, { type: 'delete', id });
      },

      async replaceAll(arr) {
        cache = Array.isArray(arr) ? clone(arr) : [];
        await flush();
        emit(name, { type: 'bulk', count: cache.length });
      },

      async clear() {
        cache = [];
        await flush();
        emit(name, { type: 'clear' });
      },
    };

    _registry[name] = api;
    return api;
  }

  /* ---- Inicialización: precarga las colecciones núcleo -------------------- */
  let readyPromise = null;
  function ready() {
    if (readyPromise) return readyPromise;
    readyPromise = (async () => {
      await DB.ready();
      // Precargar colecciones base para que .all()/.get() sean sincrónicos luego
      await Promise.all([
        coll('promotions').list(),
        coll('banners').list(),
        coll('brands').list(),
        coll('history').list(),
        coll('security_log').list(),
      ]);
      emit('ready');
    })();
    return readyPromise;
  }

  App.E5 = { ready, coll, on, emit, uid, now, _registry, KV_PREFIX };
})(window.App = window.App || {});
