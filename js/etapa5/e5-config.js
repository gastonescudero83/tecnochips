/* =============================================================================
 * e5-config.js — ETAPA 5 · Punto 12: Configuración general
 * -----------------------------------------------------------------------------
 * Helpers para la configuración del comercio editable sin tocar código. Reutiliza
 * App.Store.saveSettings (deepMerge ya tolera claves nuevas). Agrega campos que
 * no existían: favicon, redes sociales, % de impuestos, descripción SEO y textos.
 *
 * Campos de settings que cubre el pto 12:
 *   storeName, slogan, logo, favicon, whatsapp, currency, currencySymbol,
 *   locale, theme{...}, taxPercent, seoDescription, footer,
 *   social{ instagram, facebook, tiktok, x, youtube }, texts{...}
 *
 * API:
 *   App.E5.Config.applyFavicon(src)
 *   App.E5.Config.taxAmount(price)            -> impuesto calculado
 *   App.E5.Config.priceWithTax(price)         -> precio + impuesto
 *   App.E5.Config.save(patch)                 -> guarda settings + historial + favicon
 *   App.E5.Config.DEFAULTS                     -> claves nuevas por defecto
 * ========================================================================== */
(function (App) {
  'use strict';
  const S = App.Store;

  const DEFAULTS = {
    favicon: '',
    taxPercent: 0,
    seoDescription: '',
    social: { instagram: '', facebook: '', tiktok: '', x: '', youtube: '' },
    texts: { aboutTitle: '', aboutBody: '', shippingInfo: '' },
  };

  function applyFavicon(src) {
    if (!src) return;
    let link = document.querySelector('link[rel="icon"]');
    if (!link) { link = document.createElement('link'); link.rel = 'icon'; document.head.appendChild(link); }
    link.href = src;
  }

  function taxAmount(price) {
    const t = Number(S.state.settings.taxPercent) || 0;
    return (Number(price) || 0) * t / 100;
  }
  function priceWithTax(price) { return (Number(price) || 0) + taxAmount(price); }

  async function save(patch) {
    await S.saveSettings(patch || {});
    if (patch && patch.favicon) applyFavicon(patch.favicon);
    if (App.E5.History) App.E5.History.log('config', 'configuración general', Object.keys(patch || {}).join(', '));
    return S.state.settings;
  }

  // Aplica favicon guardado al arrancar
  function init() {
    const f = S.state && S.state.settings && S.state.settings.favicon;
    if (f) applyFavicon(f);
  }
  if (App.Store && App.Store.on) App.Store.on('ready', init);
  if (document.readyState !== 'loading') setTimeout(init, 400);
  else document.addEventListener('DOMContentLoaded', () => setTimeout(init, 400));

  App.E5 = App.E5 || {};
  App.E5.Config = { DEFAULTS, applyFavicon, taxAmount, priceWithTax, save };
})(window.App = window.App || {});
