/* =============================================================================
 * e5-optimize.js — ETAPA 5 · Punto 14: Optimización
 * -----------------------------------------------------------------------------
 * Mejoras de rendimiento aplicables en una PWA serverless:
 *   • Lazy Loading: además del loading="lazy" nativo que ya usan las imágenes,
 *     un IntersectionObserver para imágenes con data-src y efecto de aparición.
 *   • Caché: cache en memoria para consultas de búsqueda repetidas (TTL corto),
 *     invalida al cambiar productos. El Service Worker ya cachea los assets.
 *   • Paginación: la tienda ya usa scroll infinito por páginas (PAGE_SIZE).
 *   • "Optimización de imágenes": ya se hace al importar (App.Images.compress).
 *
 * Nota honesta: "Server Components" no aplica a una arquitectura 100% cliente
 * sin servidor; el equivalente acá es el renderizado diferido por página y la
 * compresión de imágenes en el cliente, que ya están implementados.
 *
 * API:
 *   App.E5.Optimize.observe(imgEl)     // lazy-load para una imagen con data-src
 *   App.E5.Optimize.scan(root)         // procesa todas las img[data-src] dentro
 *   App.E5.Optimize.cachedQuery(q)     // App.Search.query con caché en memoria
 *   App.E5.Optimize.clearCache()
 * ========================================================================== */
(function (App) {
  'use strict';

  /* ---- Lazy loading ------------------------------------------------------ */
  let io = null;
  function ensureObserver() {
    if (io || !('IntersectionObserver' in window)) return io;
    io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (!e.isIntersecting) return;
        const img = e.target;
        if (img.dataset.src) { img.src = img.dataset.src; delete img.dataset.src; }
        img.classList.add('is-loaded');
        io.unobserve(img);
      });
    }, { rootMargin: '200px' });
    return io;
  }
  function observe(img) {
    if (!img) return;
    img.classList.add('e5-lazy');
    img.addEventListener('load', () => img.classList.add('is-loaded'), { once: true });
    const obs = ensureObserver();
    if (obs && img.dataset.src) obs.observe(img);
    else if (img.dataset.src) { img.src = img.dataset.src; delete img.dataset.src; } // fallback
  }
  function scan(root) {
    (root || document).querySelectorAll('img[data-src]').forEach(observe);
  }

  // Limpieza (auditoría B2): se eliminaron `cachedQuery` (ningún módulo la
  // usaba; las búsquedas en memoria ya son instantáneas) y el escaneo
  // automático en cada cambio de ruta (no existe ninguna img[data-src] en la
  // app: era trabajo inútil por navegación). `observe`/`scan` quedan
  // disponibles por si un módulo futuro necesita lazy-load manual.
  App.E5 = App.E5 || {};
  App.E5.Optimize = { observe, scan, ensureObserver };
})(window.App = window.App || {});
