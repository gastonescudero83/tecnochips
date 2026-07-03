/* =============================================================================
 * e5-share.js — ETAPA 5 · Punto 7: Compartir productos
 * -----------------------------------------------------------------------------
 * Genera enlaces para compartir en WhatsApp, Facebook, Instagram, X y copiar
 * enlace. Offline: arma las URLs de share estándar (no requiere API).
 *
 * Nota: Instagram no tiene un "share por URL" web oficial; se ofrece copiar el
 * enlace + abrir Instagram (el usuario pega en su historia/mensaje). Si el
 * dispositivo soporta navigator.share (Web Share API nativa, móvil), se usa esa.
 *
 * API:
 *   App.E5.Share.productUrl(product)     -> string (URL absoluta con hash)
 *   App.E5.Share.links(product)          -> { whatsapp, facebook, x, instagram }
 *   App.E5.Share.native(product)         -> Promise<bool> (Web Share API)
 *   App.E5.Share.copy(product)           -> Promise<bool>
 *   App.E5.Share.buttons(product)        -> HTMLElement (UI lista para insertar)
 * ========================================================================== */
(function (App) {
  'use strict';
  const U = App.U;

  function productUrl(p) {
    const base = location.href.split('#')[0];
    return base + '#/producto/' + encodeURIComponent(p.id);
  }
  function shareText(p) {
    const s = (App.Store && App.Store.state.settings) || {};
    const price = App.Store ? U.formatCurrency(App.Store.effectivePrice(p), s) : '';
    return `${p.name}${price ? ' — ' + price : ''}`;
  }

  function links(p) {
    const url = encodeURIComponent(productUrl(p));
    const text = encodeURIComponent(shareText(p) + ' ');
    return {
      whatsapp: `https://wa.me/?text=${text}${url}`,
      facebook: `https://www.facebook.com/sharer/sharer.php?u=${url}`,
      x: `https://twitter.com/intent/tweet?text=${text}&url=${url}`,
      instagram: 'https://www.instagram.com/', // se acompaña de copiar enlace
    };
  }

  async function copy(p) {
    const url = productUrl(p);
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(url); }
      else {
        const ta = document.createElement('textarea'); ta.value = url; document.body.appendChild(ta);
        ta.select(); document.execCommand('copy'); ta.remove();
      }
      if (U.toast) U.toast('Enlace copiado ✓', 'success');
      return true;
    } catch (_) { if (U.toast) U.toast('No se pudo copiar', 'error'); return false; }
  }

  async function native(p) {
    if (!navigator.share) return false;
    try { await navigator.share({ title: p.name, text: shareText(p), url: productUrl(p) }); return true; }
    catch (_) { return false; }
  }

  function buttons(p) {
    const l = links(p);
    const open = (url) => window.open(url, '_blank', 'noopener');
    const wrap = U.el('div', { class: 'e5-share' });
    // Si hay Web Share nativa (móvil), un botón principal "Compartir"
    if (navigator.share) {
      wrap.appendChild(U.el('button', { type: 'button', text: '📤 Compartir', onClick: () => native(p) }));
    }
    wrap.appendChild(U.el('button', { type: 'button', text: '🟢 WhatsApp', onClick: () => open(l.whatsapp) }));
    wrap.appendChild(U.el('button', { type: 'button', text: '🔵 Facebook', onClick: () => open(l.facebook) }));
    wrap.appendChild(U.el('button', { type: 'button', text: '✖ X', onClick: () => open(l.x) }));
    wrap.appendChild(U.el('button', { type: 'button', text: '📸 Instagram', onClick: () => { copy(p).then(() => open(l.instagram)); } }));
    wrap.appendChild(U.el('button', { type: 'button', text: '🔗 Copiar enlace', onClick: () => copy(p) }));
    return wrap;
  }

  App.E5 = App.E5 || {};
  App.E5.Share = { productUrl, links, copy, native, buttons };
})(window.App = window.App || {});
