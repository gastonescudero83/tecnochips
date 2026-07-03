/* =============================================================================
 * whatsapp.js — Generación del pedido y apertura de WhatsApp
 * -----------------------------------------------------------------------------
 * Construye el mensaje a partir del carrito y los datos del formulario usando la
 * plantilla configurable (settings.whatsappTemplate) y arma la URL oficial
 * (wa.me / api.whatsapp.com). No requiere conexión hasta el momento de enviar.
 * ========================================================================== */
(function (App) {
  'use strict';

  const { U, Store, Cart } = App;

  /** Limpia un número a formato internacional solo-dígitos. */
  function sanitizeNumber(raw) {
    return String(raw || '').replace(/[^\d]/g, '');
  }

  /** Renderiza las líneas de producto del pedido. */
  function renderItems() {
    const s = Store.state.settings;
    return Cart.lines()
      .map((l) => {
        const price = U.formatCurrency(l.lineTotal, s);
        return `• ${l.product.name} x${l.qty}\n  ${price}`;
      })
      .join('\n');
  }

  /**
   * Construye el texto del mensaje reemplazando tokens en la plantilla.
   * Tokens: {items} {total} {nombre} {direccion} {observaciones} {tienda}
   */
  function buildMessage(form = {}) {
    const s = Store.state.settings;
    const tpl = s.whatsappTemplate || App.DEFAULT_SETTINGS.whatsappTemplate;
    const data = {
      items: renderItems(),
      total: U.formatCurrency(Cart.subtotal(), s),
      tienda: s.storeName || '',
      nombre: form.nombre || '',
      direccion: form.direccion || '',
      observaciones: form.observaciones || '',
    };
    return tpl.replace(/\{(\w+)\}/g, (m, key) => (key in data ? data[key] : m));
  }

  /** Arma la URL de WhatsApp lista para abrir. */
  function buildUrl(message, numberOverride) {
    const number = sanitizeNumber(numberOverride != null ? numberOverride : Store.state.settings.whatsapp);
    const text = encodeURIComponent(message);
    // Si hay número → chat directo; si no, deja que el usuario elija contacto.
    return number
      ? `https://wa.me/${number}?text=${text}`
      : `https://api.whatsapp.com/send?text=${text}`;
  }

  /**
   * Envía el pedido: valida, arma y abre WhatsApp en una pestaña nueva.
   * @returns {{ok:boolean, reason?:string, url?:string}}
   */
  /** Avisa si el pedido excede el largo seguro de URL (algunos navegadores/
   *  versiones de WhatsApp truncan mensajes muy largos). */
  function warnIfLong(url) {
    if (url.length > 4000 && App.U && App.U.toast) {
      App.U.toast('El pedido es muy largo: si el mensaje llega cortado a WhatsApp, reenvialo en dos partes.', 'info', 6000);
    }
  }

  function send(form = {}) {
    if (!Cart.count()) return { ok: false, reason: 'empty' };
    const number = sanitizeNumber(Store.state.settings.whatsapp);
    if (!number) {
      // Sin número configurado igual se puede enviar (elige contacto), pero avisamos.
      const url = buildUrl(buildMessage(form));
      warnIfLong(url);
      window.open(url, '_blank');
      return { ok: true, url, warn: 'no-number' };
    }
    const url = buildUrl(buildMessage(form), number);
    warnIfLong(url);
    window.open(url, '_blank');
    return { ok: true, url };
  }

  App.WhatsApp = { buildMessage, buildUrl, send, sanitizeNumber };
})(window.App = window.App || {});
