/* =============================================================================
 * prov_excel_generico.js — Parser EXCEL/CSV genérico (último recurso)
 * -----------------------------------------------------------------------------
 * Confianza BAJA: matchea cualquier planilla que tenga al menos una columna de
 * "producto/descripción" y una de "precio". Así, un proveedor desconocido se
 * importa igual, pero cualquier parser específico (Distrimax, Mercado X,
 * Electrodomésticos, etc.) lo supera automáticamente.
 *
 * Es el equivalente para planillas de "prov_pdf_generico.js".
 * ========================================================================== */
(function (App) {
  'use strict';

  App.Parsers.define({
    id: 'prov_excel_generico',
    provider: 'Excel Genérico',
    supports: ['xlsx', 'xls', 'csv', 'spreadsheet'],

    // Solo si detecta columnas mínimas (producto + precio). Confianza baja fija.
    match: function (ctx, util) {
      if (ctx.kind !== 'spreadsheet' || !ctx.headers.length) return 0;
      var h = ctx.headerNorm.join(' ');
      var tieneProducto = /(producto|descripcion|articulo|detalle|nombre|item)/.test(h);
      var tienePrecio = /(precio|importe|valor|costo|pvp)/.test(h);
      return (tieneProducto && tienePrecio) ? 0.2 : 0;
    },

    parse: function (file, ctx, util) {
      var idx = util.mapHeaders(ctx.headers, {
        producto: ['producto', 'descripcion', 'articulo', 'detalle', 'nombre', 'item'],
        precio: ['precio', 'importe', 'valor', 'costo', 'pvp', 'p lista'],
        stock: ['stock', 'existencia', 'cantidad', 'unidades', 'qty'],
        codigo: ['codigo', 'cod', 'sku', 'ean', 'id'],
        marca: ['marca'],
        modelo: ['modelo', 'model'],
        categoria: ['categoria', 'rubro', 'familia'],
        imagen: ['imagen', 'imagenes', 'foto', 'url imagen', 'image'],
      });
      var out = [];
      for (var r = 1; r < ctx.rows.length; r++) {
        var row = ctx.rows[r] || [];
        var g = function (f) { return idx[f] >= 0 ? row[idx[f]] : ''; };
        var nombre = util.str(g('producto'));
        if (!nombre) continue;
        var img = util.str(g('imagen'));
        out.push({
          nombre: nombre,
          precio: util.num(g('precio')),
          stock: util.int(g('stock')),
          proveedor: util.str(g('marca')) || 'Excel Genérico',
          codigo: util.str(g('codigo')),
          marca: util.str(g('marca')),
          modelo: util.str(g('modelo')),
          descripcion: nombre,
          categoria: util.str(g('categoria')),
          imagenes: img ? [img] : [],
          estado: 'activo',
          fecha: new Date().toISOString(),
        });
      }
      return out;
    },
  });
})(window.App = window.App || {});
