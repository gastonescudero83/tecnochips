/* =============================================================================
 * prov_distrimax.js — Parser del proveedor "Distrimax" (Excel / CSV)
 * -----------------------------------------------------------------------------
 * Estrategia independiente: se auto-registra en el sistema. NO conoce ni
 * depende de otros proveedores. Devuelve el formato unificado.
 *
 * Layout típico de Distrimax (planilla):
 *   CODIGO | ARTICULO | PRECIO | EXISTENCIA
 * ========================================================================== */
(function (App) {
  'use strict';

  App.Parsers.define({
    id: 'prov_distrimax',
    provider: 'Distrimax',
    supports: ['xlsx', 'xls', 'csv', 'spreadsheet'],

    // Detección: nombre de archivo y/o firma de columnas
    match(ctx) {
      if (ctx.kind !== 'spreadsheet') return 0;
      let score = 0;
      if (/distrimax/i.test(ctx.name)) score += 0.6;
      if (/distrimax/.test(ctx.keywords)) score += 0.2;
      const h = ctx.headerNorm.join(' ');
      if (/articulo/.test(h) && /existencia/.test(h) && /precio/.test(h)) score += 0.4;
      return score;
    },

    // Extracción específica de Distrimax
    parse(file, ctx, util) {
      const idx = util.mapHeaders(ctx.headers, {
        producto: ['articulo', 'descripcion', 'detalle'],
        precio: ['precio', 'precio lista', 'p lista'],
        stock: ['existencia', 'stock'],
        codigo: ['codigo', 'cod', 'sku'],
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
          proveedor: 'Distrimax',
          codigo: util.str(get('codigo')),
          fecha: new Date().toISOString(),
        });
      }
      return out;
    },
  });
})(window.App = window.App || {});
