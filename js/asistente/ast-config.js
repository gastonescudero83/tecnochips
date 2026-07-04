/* =============================================================================
 * ast-config.js — Asistente "TECNO" · Configuración editable (ETAPA 6)
 * -----------------------------------------------------------------------------
 * Namespace nuevo `App.Asst`. Guarda UNA clave de configuración en el store `kv`
 * que ya existe en IndexedDB (App.DB), bajo la clave 'asst:config'. No modifica
 * el esquema de la base ni toca nada existente. 100% offline.
 *
 * Todo lo de acá es editable desde el panel (sección "Asistente"). Este archivo
 * solo define los valores de arranque la primera vez (o tras un reset).
 *
 * API pública:
 *   App.Asst.Config.ready()            -> Promise<config>
 *   App.Asst.Config.get()              -> config (sincrónico, tras ready)
 *   App.Asst.Config.getAsync()         -> Promise<config>
 *   App.Asst.Config.save(patch)        -> Promise<config>  (persiste + emite)
 *   App.Asst.Config.reset()            -> Promise<config>
 *   App.Asst.Config.on(cb)             -> desuscriptor (cambios de config)
 *   App.Asst.Config.DEFAULTS           -> valores de fábrica
 * ========================================================================== */
(function (App) {
  'use strict';

  var DB = App.DB;
  var KV_KEY = 'asst:config';

  /* ---- Valores de fábrica (elegidos por el dueño) ----------------------- */
  var DEFAULTS = {
    enabled: true,                 // mostrar el asistente en la tienda
    name: 'TECNO',                 // nombre que aparece en el encabezado
    avatar: '🤖',                  // emoji del avatar (encabezado)
    launcherIcon: '🤖',            // emoji del botón flotante
    accent: '#c0894a',             // color de acento (cobre de la marca)
    position: 'br',                // 'br' = abajo derecha · 'bl' = abajo izquierda
    theme: 'auto',                 // 'auto' | 'light' | 'dark'
    lang: 'es',
    status: 'En línea · responde al instante',
    // Textos editables (los usa el motor de respuestas)
    welcome: '¡Hola! Soy TECNO 👋 el asistente de TECNOCHIP\'S. Contame qué estás buscando y te ayudo a encontrarlo.',
    noResults: 'Uy, no encontré eso en el catálogo 😅. Probá con otra marca o categoría, o escribinos por WhatsApp y te ayudamos.',
    goodbye: '¡Gracias por tu visita! Estoy acá abajo por cualquier cosa 👇. ¡Que andes bien! 🙌',
    placeholder: 'Escribí tu consulta…',
    // Comportamiento
    maxResults: 6,                 // máximo de productos mostrados por respuesta
    typingDelay: 600,              // ms de "escribiendo…" antes de responder
    // Botón flotante
    showLauncherLabel: false,      // mostrar texto al lado del botón
    launcherLabel: '¿Buscás algo?',
    footer: 'Asistente de TECNOCHIP\'S',
  };

  /* ---- Estado en memoria ------------------------------------------------- */
  var state = clone(DEFAULTS);

  /* ---- Pub/Sub mínimo ---------------------------------------------------- */
  var listeners = [];
  function on(cb) {
    listeners.push(cb);
    return function () { listeners = listeners.filter(function (f) { return f !== cb; }); };
  }
  function emit() {
    listeners.forEach(function (cb) { try { cb(clone(state)); } catch (e) { console.error('[Asst.Config]', e); } });
  }

  /* ---- Utilidades -------------------------------------------------------- */
  function clone(o) { return o == null ? o : JSON.parse(JSON.stringify(o)); }

  // Merge superficial-profundo tolerante y ANTI prototype-pollution (un backup
  // manipulado no puede contaminar Object.prototype).
  function merge(base, extra) {
    Object.keys(extra || {}).forEach(function (k) {
      if (k === '__proto__' || k === 'constructor' || k === 'prototype') return;
      var v = extra[k];
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        base[k] = merge(base[k] && typeof base[k] === 'object' ? base[k] : {}, v);
      } else if (v !== undefined) {
        base[k] = v;
      }
    });
    return base;
  }

  /* ---- Carga / persistencia --------------------------------------------- */
  var readyPromise = null;
  function ready() {
    if (readyPromise) return readyPromise;
    readyPromise = (async function () {
      try {
        await DB.ready();
        var saved = await DB.kvGet(KV_KEY);
        state = merge(clone(DEFAULTS), saved || {});
      } catch (e) {
        console.warn('[Asst.Config] usando valores por defecto', e);
        state = clone(DEFAULTS);
      }
      return clone(state);
    })();
    return readyPromise;
  }

  function get() { return clone(state); }
  async function getAsync() { await ready(); return clone(state); }

  async function save(patch) {
    await ready();
    state = merge(clone(state), patch || {});
    try { await DB.kvSet(KV_KEY, state); } catch (e) { console.error('[Asst.Config] no se pudo guardar', e); }
    // Auditoría (si está la Etapa 5)
    if (App.E5 && App.E5.History) {
      try { App.E5.History.log('asistente', 'configuración', Object.keys(patch || {}).join(', ')); } catch (_e) {}
    }
    emit();
    return clone(state);
  }

  async function reset() {
    state = clone(DEFAULTS);
    try { await DB.kvSet(KV_KEY, state); } catch (_e) {}
    emit();
    return clone(state);
  }

  /* ---- Namespace y arranque --------------------------------------------- */
  App.Asst = App.Asst || {};
  App.Asst.Config = { ready: ready, get: get, getAsync: getAsync, save: save, reset: reset, on: on, DEFAULTS: clone(DEFAULTS) };

  // Precargar cuando la base esté lista (no bloquea el arranque de la tienda)
  ready();
})(window.App = window.App || {});
