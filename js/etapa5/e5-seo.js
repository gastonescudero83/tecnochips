/* =============================================================================
 * e5-seo.js — ETAPA 5 · Punto 13: SEO automático
 * -----------------------------------------------------------------------------
 * Genera dinámicamente meta tags según la ruta (title, description, Open Graph,
 * Twitter Cards) y permite generar/descargar sitemap.xml y robots.txt. Las URLs
 * "amigables" se basan en slugs dentro del hash (la app es PWA sin servidor, por
 * lo que no puede reescribir paths reales; sí usa slugs legibles).
 *
 * Se engancha solo al router (hashchange). 100% offline.
 *
 * API:
 *   App.E5.SEO.start()                 // observa la ruta y actualiza metas
 *   App.E5.SEO.apply(route)            // aplica metas para una ruta
 *   App.E5.SEO.sitemap()               // string XML
 *   App.E5.SEO.robots()                // string robots.txt
 *   App.E5.SEO.downloadSitemap() / .downloadRobots()
 *   App.E5.SEO.slug(text)
 * ========================================================================== */
(function (App) {
  'use strict';
  const S = App.Store;
  const U = App.U;

  function slug(t) { return U.slugify ? U.slugify(t) : String(t || '').toLowerCase().replace(/\s+/g, '-'); }

  function setMeta(attr, key, content) {
    let el = document.head.querySelector(`meta[${attr}="${key}"]`);
    if (!el) { el = document.createElement('meta'); el.setAttribute(attr, key); document.head.appendChild(el); }
    el.setAttribute('content', content || '');
  }

  function baseUrl() { return location.href.split('#')[0]; }

  function apply(route) {
    const s = S.state.settings;
    const store = s.storeName || 'Tienda';
    let title = store + (s.slogan ? ' — ' + s.slogan : '');
    let desc = s.seoDescription || s.banner && s.banner.subtitle || ('Catálogo de ' + store);
    let image = (s.banner && s.banner.image) || s.logo || '';
    const seg = (route && route.segments) || [];

    if (seg[0] === 'producto') {
      const p = S.getProduct(seg[1]);
      if (p) {
        title = p.name + ' — ' + store;
        desc = (p.description || p.name).slice(0, 160);
        image = (p.images && p.images[0]) || image;
      }
    } else if (seg[0] === 'categoria') {
      const c = S.getCategory(seg[1]);
      if (c) {
        // Subcategoría (seg[2]): meta propias, sin perder compatibilidad con
        // la URL de solo categoría (seg[2] ausente).
        const sub = seg[2] && S.getSubcategory(seg[1], seg[2]);
        if (sub) { title = sub.name + ' — ' + c.name + ' — ' + store; desc = 'Productos de ' + sub.name + ' en ' + c.name + ' — ' + store; }
        else { title = c.name + ' — ' + store; desc = 'Productos de ' + c.name + ' en ' + store; }
      }
    } else if (seg[0] === 'marca' && App.E5.Brands) {
      const b = App.E5.Brands.bySlug(seg[1]) || App.E5.Brands.get(seg[1]);
      if (b) { title = b.name + ' — ' + store; desc = b.description || ('Productos ' + b.name); image = b.cover || b.logo || image; }
    } else if (seg[0] === 'ofertas') { title = 'Ofertas — ' + store; desc = 'Las mejores ofertas de ' + store; }
    else if (seg[0] === 'novedades') { title = 'Novedades — ' + store; desc = 'Lo último que ingresó a ' + store; }

    document.title = title;
    setMeta('name', 'description', desc);
    // Open Graph
    setMeta('property', 'og:title', title);
    setMeta('property', 'og:description', desc);
    setMeta('property', 'og:type', seg[0] === 'producto' ? 'product' : 'website');
    setMeta('property', 'og:url', location.href);
    if (image) setMeta('property', 'og:image', image);
    setMeta('property', 'og:site_name', store);
    // Twitter
    setMeta('name', 'twitter:card', image ? 'summary_large_image' : 'summary');
    setMeta('name', 'twitter:title', title);
    setMeta('name', 'twitter:description', desc);
    if (image) setMeta('name', 'twitter:image', image);
  }

  function start() {
    if (App.Router) {
      apply(App.Router.current());
      window.addEventListener('hashchange', () => apply(App.Router.current()));
    }
  }

  function sitemap() {
    const base = baseUrl();
    const urls = ['', '#/ofertas', '#/novedades', '#/destacados', '#/marcas'];
    (S.state.categories || []).forEach((c) => {
      urls.push('#/categoria/' + c.id);
      (c.subcategories || []).forEach((s) => urls.push('#/categoria/' + c.id + '/' + s.id));
    });
    (S.state.products || []).filter((p) => p.active !== false).forEach((p) => urls.push('#/producto/' + p.id));
    const body = urls.map((u) => `  <url><loc>${base}${u}</loc></url>`).join('\n');
    return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>`;
  }

  function robots() {
    return `User-agent: *\nAllow: /\nSitemap: ${baseUrl()}sitemap.xml\n`;
  }

  function dl(name, content, mime) {
    const blob = new Blob([content], { type: mime });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
  }

  App.E5 = App.E5 || {};
  App.E5.SEO = {
    start, apply, sitemap, robots, slug,
    downloadSitemap: () => dl('sitemap.xml', sitemap(), 'application/xml'),
    downloadRobots: () => dl('robots.txt', robots(), 'text/plain'),
  };

  // Auto-arranque tras carga
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(start, 300));
  else setTimeout(start, 300);
})(window.App = window.App || {});
