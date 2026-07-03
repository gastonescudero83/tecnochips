/* =============================================================================
 * e5-compare.js — ETAPA 5 · Punto 5: Comparador de productos
 * -----------------------------------------------------------------------------
 * Permite comparar hasta 4 productos. Selección guardada localmente
 * (localStorage) para que persista mientras el visitante navega.
 *
 * API:
 *   App.E5.Compare.MAX                      -> 4
 *   App.E5.Compare.list()                   -> [ids]
 *   App.E5.Compare.has(id) / .count()
 *   App.E5.Compare.toggle(id)               -> {on, full}  (full=true si estaba lleno)
 *   App.E5.Compare.add(id) / .remove(id) / .clear()
 *   App.E5.Compare.products()               -> [product]
 *   App.E5.Compare.rows()                    -> filas comparables [{label, values[]}]
 *   App.E5.Compare.onChange(cb)
 * ========================================================================== */
(function (App) {
  'use strict';
  const KEY = 'e5_compare';
  const MAX = 4;
  const subs = [];

  function read() { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch (_) { return []; } }
  function write(arr) { try { localStorage.setItem(KEY, JSON.stringify(arr)); } catch (_) {} subs.forEach((cb) => { try { cb(arr); } catch (e) {} }); }

  function list() { return read(); }
  function has(id) { return read().indexOf(id) > -1; }
  function count() { return read().length; }
  function add(id) { const a = read(); if (a.indexOf(id) < 0 && a.length < MAX) { a.push(id); write(a); return true; } return false; }
  function remove(id) { write(read().filter((x) => x !== id)); }
  function toggle(id) {
    if (has(id)) { remove(id); return { on: false, full: false }; }
    const a = read();
    if (a.length >= MAX) return { on: false, full: true };
    a.push(id); write(a); return { on: true, full: false };
  }
  function clear() { write([]); }
  function products() {
    const map = new Map(((App.Store && App.Store.state.products) || []).map((p) => [p.id, p]));
    return read().map((id) => map.get(id)).filter(Boolean);
  }

  // Filas comparables solicitadas por el pto 5: imagen, precio, marca, modelo,
  // descripción, especificaciones (+ extras útiles).
  function rows() {
    const ps = products();
    const S = App.Store;
    const money = (v) => (App.U ? App.U.formatCurrency(v, S.state.settings) : '$' + v);
    return [
      { label: 'Precio', values: ps.map((p) => money(S.effectivePrice(p))) },
      { label: 'Precio anterior', values: ps.map((p) => { const c = S.comparePrice(p); return c ? money(c) : '—'; }) },
      { label: 'Marca', values: ps.map((p) => p.brand || '—') },
      { label: 'Modelo', values: ps.map((p) => p.model || '—') },
      { label: 'Categoría', values: ps.map((p) => { const c = S.getCategory(p.categoryId); return c ? c.name : '—'; }) },
      { label: 'Stock', values: ps.map((p) => (p.stock > 0 ? p.stock + ' u.' : 'Sin stock')) },
      { label: 'Código', values: ps.map((p) => p.code || '—') },
      { label: 'Descripción', values: ps.map((p) => p.description || '—') },
      { label: 'Etiquetas', values: ps.map((p) => (p.tags || []).join(', ') || '—') },
    ];
  }

  function onChange(cb) { subs.push(cb); return () => { const i = subs.indexOf(cb); if (i >= 0) subs.splice(i, 1); }; }

  App.E5 = App.E5 || {};
  App.E5.Compare = { MAX, list, has, count, add, remove, toggle, clear, products, rows, onChange };
})(window.App = window.App || {});
