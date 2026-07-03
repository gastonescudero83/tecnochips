/* =============================================================================
 * prov_mercado_x.js — Parser del proveedor "Mercado X" (Excel / CSV)
 * -----------------------------------------------------------------------------
 * Estrategia independiente. Layout típico (separador ; o ,):
 *   SKU | Producto | Precio Unitario | Cantidad
 * ========================================================================== */
(function (App) {
  'use strict';

  App.Parsers.define({
    id: 'prov_mercado_x',
    provider: 'Mercado X',
    supports: ['xlsx', 'xls', 'csv', 'spreadsheet'],

    match(ctx) {
      if (ctx.kind !== 'spreadsheet') return 0;
      let score = 0;
      if (/mercado[_\s-]?x/i.test(ctx.name)) score += 0.6;
      const h = ctx.headerNorm.join(' ');
      if (/sku/.test(h) && /precio unitario/.test(h)) score += 0.5;
      else if (/sku/.test(h) && /cantidad/.test(h) && /producto/.test(h)) score += 0.35;
      return score;
    },

    parse(file, ctx, util) {
      const idx = util.mapHeaders(ctx.headers, {
        producto: ['producto', 'nombre', 'item', 'descripcion'],
        precio: ['precio unitario', 'precio', 'p unitario', 'pu'],
        stock: ['cantidad', 'stock', 'qty', 'unidades'],
        codigo: ['sku', 'codigo', 'id'],
      });
      const out = [];
      for (let r = 1; r < ctx.rows.length; r++) {
        const row = ctx.rows[r] || [];
        const get = (f) => (idx[f] >= 0 ? row[idx[f]] : '');
        const producto = util.str(get('producto'));
        if (!producto) continue;
        out.push({
          producto: producto,
          precio: util.num(get('precio')),
          stock: util.int(get('stock')),
          proveedor: 'Mercado X',
          codigo: util.str(get('codigo')),
          fecha: new Date().toISOString(),
        });
      }
      return out;
    },
  });
})(window.App = window.App || {});
