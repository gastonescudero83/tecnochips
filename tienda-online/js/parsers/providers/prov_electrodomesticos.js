/* =============================================================================
 * prov_electrodomesticos.js — Parser para catálogos de ELECTRODOMÉSTICOS / HOGAR
 * -----------------------------------------------------------------------------
 * Estrategia independiente y aditiva. Sirve para listas de proveedores de
 * electro/hogar (Samsung, Philco, BGH, Newsan, etc.) donde el nombre del
 * artículo trae la MARCA y el MODELO mezclados. Devuelve el formato unificado
 * extendido (con marca, modelo, categoria, imagenes).
 *
 * Soporta planilla (xlsx/csv) y PDF. Confianza media: si en el futuro se crea
 * un parser específico de una marca, lo supera automáticamente.
 * ========================================================================== */
(function (App) {
  'use strict';

  // Marcas frecuentes de electro/hogar en Argentina.
  var MARCAS = [
    'samsung', 'philco', 'bgh', 'newsan', 'lg', 'noblex', 'sony', 'philips',
    'whirlpool', 'drean', 'gafa', 'patrick', 'electrolux', 'liliana', 'atma',
    'peabody', 'oster', 'top house', 'tophouse', 'panavox', 'enova', 'hitachi',
    'panasonic', 'motorola', 'xiaomi', 'tcl', 'hisense', 'jbl', 'sansei',
  ];

  // Palabras → categoría (heurística simple, ampliable por proveedor).
  var CATEGORIAS = [
    [/(smart\s*tv|televisor|\btv\b|led\b|pulgadas|"|''|qled|uhd|4k)/, 'TV y Video'],
    [/(heladera|freezer|refriger)/, 'Heladeras y Freezers'],
    [/(lavarrop|secarrop|lavasecarr)/, 'Lavado'],
    [/(aire\s*acond|split|ventilad|calefact|estufa|caloventor)/, 'Climatización'],
    [/(celular|smartphone|telefono|notebook|tablet|auricular|parlante|consola|playstation|xbox)/, 'Tecnología'],
    [/(microond|horno|anafe|cocina|cafetera|licuadora|batidora|tostad|pava|multiprocesad|freidora)/, 'Cocina'],
    [/(aspirador|plancha|enceradora)/, 'Hogar'],
  ];

  function detectMarca(text, util) {
    var low = util.norm(text);
    for (var i = 0; i < MARCAS.length; i++) {
      if (low.indexOf(MARCAS[i]) > -1) {
        // Devuelve la marca con mayúscula inicial bonita.
        return MARCAS[i].replace(/\b\w/g, function (c) { return c.toUpperCase(); });
      }
    }
    return '';
  }

  function detectCategoria(text) {
    var low = String(text || '').toLowerCase();
    for (var i = 0; i < CATEGORIAS.length; i++) {
      if (CATEGORIAS[i][0].test(low)) return CATEGORIAS[i][1];
    }
    return 'General';
  }

  // Modelo: token alfanumérico tipo "UN50AU7000", "WD90", "55P735" dentro del nombre.
  function detectModelo(text) {
    var m = String(text || '').match(/\b([A-Z]{1,5}[-\/]?\d{2,}[A-Z0-9\-\/]*)\b/);
    if (m) return m[1];
    m = String(text || '').match(/\b(\d{2,}[A-Z]{1,4}\d*[A-Z0-9\-\/]*)\b/);
    return m ? m[1] : '';
  }

  function extractPriceFromLine(text) {
    var m, best = null, re = /\$\s*([\d][\d.,]*)/g;
    while ((m = re.exec(text))) best = m;
    if (!best) {
      var re2 = /\b(\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{2})?|\d{4,}(?:[.,]\d{2})?)\b/g;
      while ((m = re2.exec(text))) best = m;
    }
    return best ? { value: best[1], index: best.index, raw: best[0] } : null;
  }

  App.Parsers.define({
    id: 'prov_electrodomesticos',
    provider: 'Electrodomésticos',
    supports: ['xlsx', 'xls', 'csv', 'spreadsheet', 'pdf'],

    // Detección: marcas de electro + vocabulario del rubro en headers/contenido.
    match: function (ctx, util) {
      var s = 0;
      var hay = ctx.keywords || '';
      var marcasHit = MARCAS.filter(function (mk) { return hay.indexOf(util.norm(mk)) > -1; }).length;
      if (marcasHit >= 2) s += 0.5;
      else if (marcasHit === 1) s += 0.25;
      if (/(smart\s*tv|heladera|lavarrop|split|microond|electrodom|pulgadas)/.test(hay)) s += 0.3;
      if (/(electro|hogar|electrodom)/.test(util.norm(ctx.name))) s += 0.2;
      // Si es planilla, premia tener columnas marca/modelo.
      if (ctx.kind === 'spreadsheet') {
        var h = ctx.headerNorm.join(' ');
        if (/marca/.test(h)) s += 0.15;
        if (/modelo/.test(h)) s += 0.15;
      }
      return s;
    },

    parse: function (file, ctx, util) {
      return (ctx.kind === 'pdf') ? parsePdf(file, ctx, util) : parseSheet(ctx, util);
    },
  });

  // ---- Planilla (xlsx/csv) ----
  function parseSheet(ctx, util) {
    var idx = util.mapHeaders(ctx.headers, {
      producto: ['descripcion', 'producto', 'articulo', 'detalle', 'nombre'],
      precio: ['precio', 'precio lista', 'p lista', 'precio venta', 'pvp'],
      stock: ['stock', 'existencia', 'cantidad', 'unidades'],
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
      var marca = util.str(g('marca')) || detectMarca(nombre, util);
      var modelo = util.str(g('modelo')) || detectModelo(nombre);
      var categoria = util.str(g('categoria')) || detectCategoria(nombre);
      var img = util.str(g('imagen'));
      out.push({
        nombre: nombre,
        precio: util.num(g('precio')),
        stock: util.int(g('stock')),
        proveedor: marca || 'Electrodomésticos',
        codigo: util.str(g('codigo')),
        marca: marca,
        modelo: modelo,
        descripcion: nombre,
        categoria: categoria,
        imagenes: img ? [img] : [],
        estado: 'activo',
        fecha: new Date().toISOString(),
      });
    }
    return out;
  }

  // ---- PDF (lee todo el texto y arma productos por línea con precio) ----
  async function parsePdf(file, ctx, util) {
    var text = await util.readPdfText(file, 200);
    var out = [];
    text.split(/\r?\n/).forEach(function (line) {
      line = line.replace(/\s+/g, ' ').trim();
      if (line.length < 4) return;
      var low = util.norm(line);
      if (/^(total|subtotal|iva|pagina|lista de precios|catalogo|condiciones)\b/.test(low)) return;
      var p = extractPriceFromLine(line);
      if (!p || !(util.num(p.value) > 0)) return;
      var nombre = (line.slice(0, p.index) + ' ' + line.slice(p.index + p.raw.length)).replace(/\s+/g, ' ').trim();
      if (nombre.length < 3) return;
      var marca = detectMarca(nombre, util);
      out.push({
        nombre: nombre,
        precio: util.num(p.value),
        stock: 0,
        proveedor: marca || 'Electrodomésticos',
        codigo: '',
        marca: marca,
        modelo: detectModelo(nombre),
        descripcion: nombre,
        categoria: detectCategoria(nombre),
        imagenes: [],
        estado: 'activo',
        fecha: new Date().toISOString(),
      });
    });
    return out;
  }
})(window.App = window.App || {});
