/* =============================================================================
 * e5-export.js — ETAPA 5 · Punto 15: Exportaciones
 * -----------------------------------------------------------------------------
 * Exporta el catálogo a Excel, CSV, JSON y PDF, 100% offline (sin librerías
 * externas). Permite filtrar por categoría, marca, proveedor y estado.
 *
 *   • CSV   → texto separado por comas (UTF-8 con BOM para Excel/acentos).
 *   • JSON  → estructura completa.
 *   • Excel → SpreadsheetML simple (.xls) que abre nativo en Excel/LibreOffice.
 *   • PDF   → abre ventana imprimible con estilos; el usuario elige "Guardar
 *             como PDF" del diálogo de impresión (no requiere librería pesada).
 *
 * API:
 *   App.E5.Export.filter({categoryId, brand, provider, status}) -> [product]
 *   App.E5.Export.csv(rows|filter)
 *   App.E5.Export.json(rows|filter)
 *   App.E5.Export.excel(rows|filter)
 *   App.E5.Export.pdf(rows|filter)
 * ========================================================================== */
(function (App) {
  'use strict';
  const S = App.Store;

  const COLS = [
    { k: 'code', h: 'Código' }, { k: 'name', h: 'Nombre' }, { k: 'brand', h: 'Marca' },
    { k: 'model', h: 'Modelo' }, { k: '_cat', h: 'Categoría' }, { k: 'price', h: 'Precio' },
    { k: 'priceSale', h: 'Oferta' }, { k: 'stock', h: 'Stock' },
    { k: '_status', h: 'Estado' }, { k: 'provider', h: 'Proveedor' },
  ];

  function row(p) {
    const cat = S.getCategory(p.categoryId);
    return Object.assign({}, p, {
      _cat: cat ? cat.name : '',
      _status: p.active === false ? 'Oculto' : 'Activo',
      provider: p.provider || p.proveedor || '',
    });
  }

  function filter(f) {
    f = f || {};
    return (S.state.products || []).filter((p) => {
      if (f.categoryId && p.categoryId !== f.categoryId) return false;
      if (f.brand && (p.brand || '').toLowerCase() !== f.brand.toLowerCase()) return false;
      if (f.provider && (p.provider || p.proveedor || '').toLowerCase() !== f.provider.toLowerCase()) return false;
      if (f.status === 'active' && p.active === false) return false;
      if (f.status === 'hidden' && p.active !== false) return false;
      return true;
    }).map(row);
  }

  function resolve(rowsOrFilter) {
    if (Array.isArray(rowsOrFilter)) return rowsOrFilter.map((p) => (p._cat !== undefined ? p : row(p)));
    return filter(rowsOrFilter || {});
  }

  function download(filename, content, mime) {
    const blob = new Blob([content], { type: mime + ';charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    if (App.E5.History) App.E5.History.log('config', 'exportación', filename);
  }
  function stamp() { const d = new Date(); return d.toISOString().slice(0, 10); }
  function esc(v) { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }

  function csv(src) {
    const rows = resolve(src);
    const head = COLS.map((c) => c.h).join(',');
    const body = rows.map((r) => COLS.map((c) => esc(r[c.k])).join(',')).join('\n');
    download('catalogo_' + stamp() + '.csv', '﻿' + head + '\n' + body, 'text/csv');
  }

  function json(src) {
    const rows = resolve(src);
    download('catalogo_' + stamp() + '.json', JSON.stringify(rows, null, 2), 'application/json');
  }

  function excel(src) {
    const rows = resolve(src);
    // SpreadsheetML 2003 (XML) — abre nativo en Excel y conserva tipos básicos.
    const cell = (v, num) => `<Cell><Data ss:Type="${num && v !== '' && v != null ? 'Number' : 'String'}">${String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;')}</Data></Cell>`;
    const header = '<Row>' + COLS.map((c) => cell(c.h)).join('') + '</Row>';
    const numCols = { price: 1, priceSale: 1, stock: 1 };
    const body = rows.map((r) => '<Row>' + COLS.map((c) => cell(r[c.k], numCols[c.k])).join('') + '</Row>').join('');
    const xml = `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
<Worksheet ss:Name="Catalogo"><Table>${header}${body}</Table></Worksheet></Workbook>`;
    download('catalogo_' + stamp() + '.xls', xml, 'application/vnd.ms-excel');
  }

  function pdf(src) {
    const rows = resolve(src);
    const s = S.state.settings;
    const money = (v) => App.U.formatCurrency(v, s);
    // Escape HTML: los nombres/códigos vienen de importaciones y podrían traer
    // markup; sin esto, un dato malicioso ejecutaba script en la ventana de impresión.
    const eh = (v) => App.U.escapeHtml(v == null ? '' : v);
    const trs = rows.map((r) => `<tr>
      <td>${eh(r.code)}</td><td>${eh(r.name)}</td><td>${eh(r.brand)}</td>
      <td>${eh(r._cat)}</td><td style="text-align:right">${money(r.price)}</td>
      <td style="text-align:right">${r.priceSale ? money(r.priceSale) : '—'}</td>
      <td style="text-align:center">${eh(r.stock)}</td><td>${eh(r._status)}</td></tr>`).join('');
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Catálogo ${eh(s.storeName)}</title>
      <style>body{font-family:Arial,sans-serif;padding:20px;color:#222}h1{font-size:18px}
      table{width:100%;border-collapse:collapse;font-size:11px}th,td{border:1px solid #ccc;padding:4px 6px}
      th{background:#eee;text-align:left}@media print{button{display:none}}</style></head>
      <body><h1>${eh(s.storeName || 'Catálogo')} — ${rows.length} productos (${stamp()})</h1>
      <button onclick="window.print()" style="margin-bottom:10px;padding:8px 14px">🖨️ Imprimir / Guardar PDF</button>
      <table><thead><tr><th>Código</th><th>Nombre</th><th>Marca</th><th>Categoría</th><th>Precio</th><th>Oferta</th><th>Stock</th><th>Estado</th></tr></thead>
      <tbody>${trs}</tbody></table></body></html>`;
    const w = window.open('', '_blank');
    if (!w) { App.U.toast('Permití las ventanas emergentes para exportar PDF', 'error'); return; }
    w.document.write(html); w.document.close();
    if (App.E5.History) App.E5.History.log('config', 'exportación PDF', rows.length + ' productos');
  }

  App.E5 = App.E5 || {};
  App.E5.Export = { filter, csv, json, excel, pdf, COLS };
})(window.App = window.App || {});
