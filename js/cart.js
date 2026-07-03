/* =============================================================================
 * cart.js — Carrito de compras (estado + persistencia + cálculo de totales)
 * -----------------------------------------------------------------------------
 * El carrito guarda solo { id, qty } por ítem; el precio y demás datos se leen
 * en vivo desde el Store al renderizar (así, si el admin cambia un precio, el
 * carrito refleja el valor actual). Persiste en localStorage para sobrevivir
 * recargas. Emite eventos por el bus del Store ('cart').
 * ========================================================================== */
(function (App) {
  'use strict';

  const { U, Store } = App;
  const LS_KEY = App.CONST.DB_NAME + ':cart';

  let items = load(); // [{ id, qty }]

  function load() {
    try { return JSON.parse(localStorage.getItem(LS_KEY) || '[]'); }
    catch (_e) { return []; }
  }
  function persist() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(items)); } catch (_e) { /* quota */ }
    Store.emit('cart', summary());
  }

  /** Devuelve las líneas del carrito "hidratadas" con datos del producto. */
  function lines() {
    const out = items
      .map((it) => {
        const p = Store.getProduct(it.id);
        if (!p) return null; // producto borrado: se ignora
        // Revalida el stock ACTUAL: si el admin bajó el stock después de que
        // el cliente agregó el producto, la cantidad se ajusta para no pedir
        // más de lo disponible.
        if (p.stock > 0 && it.qty > p.stock) { it.qty = p.stock; _stockDirty = true; }
        const unit = Store.effectivePrice(p);
        return {
          id: p.id,
          product: p,
          qty: it.qty,
          unit,
          lineTotal: unit * it.qty,
        };
      })
      .filter(Boolean);
    if (_stockDirty && !_persisting) {
      // Persistir el ajuste (persist emite 'cart' y relee lines(): la guarda
      // evita reentradas; en la segunda pasada ya no hay nada que ajustar).
      _stockDirty = false; _persisting = true;
      try { persist(); } finally { _persisting = false; }
    }
    return out;
  }
  let _stockDirty = false, _persisting = false;

  function count() {
    return items.reduce((acc, it) => acc + it.qty, 0);
  }

  function subtotal() {
    return lines().reduce((acc, l) => acc + l.lineTotal, 0);
  }

  function summary() {
    return { count: count(), subtotal: subtotal(), lines: lines() };
  }

  function find(id) { return items.find((it) => it.id === id); }

  function add(id, qty = 1) {
    const p = Store.getProduct(id);
    if (!p) return;
    const existing = find(id);
    const max = p.stock > 0 ? p.stock : Infinity;
    if (existing) existing.qty = U.clamp(existing.qty + qty, 1, max);
    else items.push({ id, qty: U.clamp(qty, 1, max) });
    persist();
  }

  function setQty(id, qty) {
    const p = Store.getProduct(id);
    const max = p && p.stock > 0 ? p.stock : Infinity;
    const it = find(id);
    if (!it) return;
    qty = U.clamp(Number(qty) || 1, 1, max);
    it.qty = qty;
    persist();
  }

  function remove(id) {
    items = items.filter((it) => it.id !== id);
    persist();
  }

  function clear() {
    items = [];
    persist();
  }

  // Mantener el carrito coherente si cambia el catálogo (p. ej. borrado de producto)
  Store.on('products', () => {
    const before = items.length;
    items = items.filter((it) => Store.getProduct(it.id));
    if (items.length !== before) persist();
  });

  App.Cart = { lines, count, subtotal, summary, add, setQty, remove, clear, get items() { return items.slice(); } };
})(window.App = window.App || {});
