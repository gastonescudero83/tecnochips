/* =============================================================================
 * e5-favorites.js — ETAPA 5 · Punto 6: Favoritos
 * -----------------------------------------------------------------------------
 * El visitante marca productos favoritos SIN registro. Se guardan localmente en
 * el navegador (localStorage), independientes del admin/IndexedDB.
 *
 * API:
 *   App.E5.Favorites.list()        -> [ids]
 *   App.E5.Favorites.has(id)       -> bool
 *   App.E5.Favorites.toggle(id)    -> bool (nuevo estado)
 *   App.E5.Favorites.add(id) / .remove(id) / .clear()
 *   App.E5.Favorites.count()       -> Number
 *   App.E5.Favorites.products()    -> [product] (resuelve contra Store)
 *   App.E5.Favorites.onChange(cb)  -> unsubscribe
 * ========================================================================== */
(function (App) {
  'use strict';
  const KEY = 'e5_favorites';
  const subs = [];

  function read() { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch (_) { return []; } }
  function write(arr) { try { localStorage.setItem(KEY, JSON.stringify(arr)); } catch (_) {} subs.forEach((cb) => { try { cb(arr); } catch (e) {} }); }

  function list() { return read(); }
  function has(id) { return read().indexOf(id) > -1; }
  function add(id) { const a = read(); if (a.indexOf(id) < 0) { a.push(id); write(a); } }
  function remove(id) { write(read().filter((x) => x !== id)); }
  function toggle(id) { const on = !has(id); if (on) add(id); else remove(id); return on; }
  function clear() { write([]); }
  function count() { return read().length; }
  function products() {
    const all = (App.Store && App.Store.state.products) || [];
    const set = new Set(read());
    return all.filter((p) => set.has(p.id));
  }
  function onChange(cb) { subs.push(cb); return () => { const i = subs.indexOf(cb); if (i >= 0) subs.splice(i, 1); }; }

  App.E5 = App.E5 || {};
  App.E5.Favorites = { list, has, add, remove, toggle, clear, count, products, onChange };
})(window.App = window.App || {});
