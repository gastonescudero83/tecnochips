/* =============================================================================
 * e5-history.js — ETAPA 5 · Punto 11: Historial completo / Auditoría
 * -----------------------------------------------------------------------------
 * Registra eventos del sistema en la colección "history" (KV, offline). Pensado
 * para alimentar una pantalla de auditoría en el panel admin.
 *
 * Tipos de evento sugeridos (string libre, pero estandarizados aquí):
 *   import        — importación de catálogo (PDF/Excel)
 *   product       — alta/edición/borrado de producto
 *   price         — cambio de precio
 *   image         — cambio/reemplazo de imágenes
 *   visibility    — producto ocultado/activado
 *   promotion     — promoción creada/editada/eliminada
 *   banner        — banner administrado
 *   brand         — marca administrada
 *   category      — categoría administrada
 *   bulk          — operación masiva
 *   config        — cambio de configuración general
 *   security      — evento de seguridad
 *
 * API:
 *   App.E5.History.log(type, action, detail)   -> Promise<entry>
 *   App.E5.History.list({type, limit})          -> Promise<Array> (desc por fecha)
 *   App.E5.History.clear()                       -> Promise<void>
 *   App.E5.History.export()                      -> Array (para exportar)
 * ========================================================================== */
(function (App) {
  'use strict';
  const E5 = App.E5;
  const store = E5.coll('history');
  const MAX = 2000; // tope de entradas conservadas (evita crecer infinito)

  async function log(type, action, detail) {
    const entry = {
      id: E5.uid('h'),
      type: type || 'info',
      action: action || '',
      detail: detail != null ? detail : '',
      at: E5.now(),
      // contexto útil sin datos sensibles
      route: (typeof location !== 'undefined' && location.hash) || '',
    };
    const all = await store.list();
    all.push(entry);
    // Recorta si supera el tope (conserva las más recientes)
    const trimmed = all.length > MAX ? all.slice(all.length - MAX) : all;
    await store.replaceAll(trimmed);
    return entry;
  }

  async function list(opts) {
    opts = opts || {};
    let all = await store.list();
    if (opts.type) all = all.filter((e) => e.type === opts.type);
    all.sort((a, b) => b.at - a.at);
    if (opts.limit) all = all.slice(0, opts.limit);
    return all;
  }

  function exportRows() {
    return store.all().sort((a, b) => b.at - a.at);
  }

  App.E5.History = { log, list, clear: () => store.clear(), export: exportRows };
})(window.App = window.App || {});
