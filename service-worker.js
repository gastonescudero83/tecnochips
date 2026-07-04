/* =============================================================================
 * service-worker.js — Caché del "app shell" para funcionamiento offline (PWA)
 * -----------------------------------------------------------------------------
 * Estrategia:
 *   • Precache de los archivos estáticos al instalar.
 *   • Navegaciones (HTML) → network-first con fallback a index.html (offline).
 *   • Resto de GET del mismo origen → stale-while-revalidate (rápido + se
 *     actualiza en segundo plano).
 * Los DATOS de la tienda viven en IndexedDB (no se cachean aquí).
 *
 * Importante: el SW solo funciona servido por HTTP/HTTPS, no en file://.
 * Subí la carpeta a un hosting o serví con un servidor local.
 * ========================================================================== */

// v7: bump de versión (motor de importación v2.1) + precache COMPLETO.
// Antes faltaban css/etapa5.css, todos los js/etapa5/*, el mapeo asistido y
// el logo: instalada la PWA, esos archivos no existían offline y además el
// caché viejo seguía sirviendo código desactualizado.
const CACHE = 'tienda-pwa-v21'; // v21 = ETAPA 6: Asistente "TECNO" (css/asistente.css + js/asistente/*) al precache

const SHELL = [
  './',
  'index.html',
  'manifest.json',
  'css/base.css',
  'css/storefront.css',
  'css/admin.css',
  'css/etapa5.css',
  'css/asistente.css',
  'js/config.js',
  'js/utils.js',
  'js/db.js',
  'js/store.js',
  'js/seed.js',
  'js/images.js',
  'js/cart.js',
  'js/search.js',
  'js/whatsapp.js',
  'js/importexport.js',
  'js/smart-import.js',
  'js/parsers/parser-system.js',
  'js/parsers/motor_geometrico.js',
  'js/parsers/providers/prov_distrimax.js',
  'js/parsers/providers/prov_mercado_x.js',
  'js/parsers/providers/prov_electrodomesticos.js',
  'js/parsers/providers/prov_excel_generico.js',
  'js/parsers/providers/prov_pdf_generico.js',
  'js/parsers/providers/prov_mapeo_asistido.js',
  'js/parsers/ui-mapeo-asistido.js',
  'js/router.js',
  'js/ui-storefront.js',
  'js/ui-admin.js',
  'js/ui-admin-import.js',
  'js/etapa5/e5-data.js',
  'js/etapa5/e5-history.js',
  'js/etapa5/e5-security.js',
  'js/etapa5/e5-integrations.js',
  'js/etapa5/e5-promotions.js',
  'js/etapa5/e5-banners.js',
  'js/etapa5/e5-brands.js',
  'js/etapa5/e5-categories.js',
  'js/etapa5/ui-admin-etapa5.js',
  'js/etapa5/e5-favorites.js',
  'js/etapa5/e5-compare.js',
  'js/etapa5/e5-share.js',
  'js/etapa5/e5-related.js',
  'js/etapa5/e5-search-suggest.js',
  'js/etapa5/ui-storefront-etapa5.js',
  'js/etapa5/e5-export.js',
  'js/etapa5/e5-bulk.js',
  'js/etapa5/e5-seo.js',
  'js/etapa5/e5-optimize.js',
  'js/etapa5/e5-config.js',
  'js/etapa5/ui-admin-etapa5-p4.js',
  'js/asistente/ast-config.js',
  'js/asistente/ast-data.js',
  'js/asistente/ast-nlu.js',
  'js/asistente/ast-engine.js',
  'js/asistente/ast-ui.js',
  'js/asistente/ast-admin.js',
  'js/app.js',
  'icons/icon.svg',
  'icons/icon-maskable.svg',
  'icons/logo.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      // addAll falla si algún recurso no existe; usamos tolerancia individual.
      .then((cache) => Promise.allSettled(SHELL.map((url) => cache.add(url))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  // Solo gestionamos peticiones del mismo origen (no CDNs externos como SheetJS).
  if (url.origin !== self.location.origin) return;

  // Catálogo publicado (data/*.json): SIEMPRE red, sin cachear acá.
  // La app lo pide con query única y valida versión; cachearlo duplicaría MB.
  if (url.pathname.indexOf('/data/') !== -1) return;

  // Navegaciones → network-first, fallback al shell cacheado (offline).
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req).then((r) => r || caches.match('index.html')))
    );
    return;
  }

  // Estáticos → stale-while-revalidate.
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.status === 200) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
