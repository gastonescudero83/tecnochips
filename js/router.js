/* =============================================================================
 * router.js — Enrutador por hash (#/...), compatible con file:// y servido
 * -----------------------------------------------------------------------------
 * Convierte location.hash en { segments[], query{} } y notifica a un handler en
 * cada cambio. Hash-based para funcionar sin servidor y sin configuración extra.
 * Rutas de la tienda:
 *   #/                         portada
 *   #/categoria/:catId[/:subId]
 *   #/ofertas  #/novedades  #/destacados
 *   #/buscar?q=texto
 *   #/producto/:id
 *   #/carrito
 *   #/admin[/seccion]          panel (lo resuelve el módulo Admin)
 * ========================================================================== */
(function (App) {
  'use strict';

  let handler = null;

  /** decodeURIComponent lanza URIError con hashes malformados (#/%zz) y
   *  dejaba la vista en blanco: si falla, se usa el texto crudo. */
  function safeDecode(s) {
    try { return decodeURIComponent(s); } catch (_e) { return s; }
  }

  function parse() {
    let raw = location.hash || '#/';
    if (raw[0] === '#') raw = raw.slice(1);
    if (raw[0] === '/') raw = raw.slice(1);
    const [pathPart, queryPart] = raw.split('?');
    const segments = pathPart.split('/').map(safeDecode).filter((s) => s !== '');
    const query = {};
    (queryPart || '').split('&').forEach((pair) => {
      if (!pair) return;
      const [k, v] = pair.split('=');
      query[safeDecode(k)] = safeDecode(v || '');
    });
    return { segments, query, raw };
  }

  function onChange() {
    const route = parse();
    if (handler) handler(route);
  }

  const Router = {
    parse,
    current: parse,
    start(fn) {
      handler = fn;
      window.addEventListener('hashchange', onChange);
      onChange();
    },
    /** Navega a una ruta. Acepta string ('/ofertas') u objeto {segments, query}. */
    go(to, query) {
      let hash;
      if (typeof to === 'string') {
        hash = to;
      } else {
        hash = '/' + (to.segments || []).map(encodeURIComponent).join('/');
      }
      if (query && typeof query === 'object') {
        const qs = Object.keys(query)
          .filter((k) => query[k] != null && query[k] !== '')
          .map((k) => encodeURIComponent(k) + '=' + encodeURIComponent(query[k]))
          .join('&');
        if (qs) hash += '?' + qs;
      }
      if (hash[0] !== '/') hash = '/' + hash;
      const target = '#' + hash;
      if (location.hash === target) onChange(); // forzar re-render si es la misma
      else location.hash = target;
    },
    /** Sube al inicio de la página (útil al cambiar de vista). */
    scrollTop() { window.scrollTo({ top: 0, behavior: 'instant' in document.documentElement.style ? 'instant' : 'auto' }); },
  };

  App.Router = Router;
})(window.App = window.App || {});
