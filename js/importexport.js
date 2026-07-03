/* =============================================================================
 * importexport.js — Importación/exportación de productos (CSV, XLSX, plantilla)
 * -----------------------------------------------------------------------------
 * CSV es nativo (sin dependencias) y es el formato recomendado offline. XLSX es
 * una mejora opcional: se carga SheetJS de forma diferida solo si hay Internet;
 * si no está disponible, se sugiere usar CSV. El backup JSON completo vive en
 * Store.exportAll/importAll.
 * ========================================================================== */
(function (App) {
  'use strict';

  const { U, Store } = App;

  // Columnas de la plantilla (orden estable). Encabezados en español, claros.
  // v2: se agregan 'modelo', 'precio_manual' e 'id' para que el ciclo
  // exportar → editar → reimportar ACTUALICE los productos en vez de duplicarlos
  // y no pierda campos. La importación matchea por encabezado (el orden no importa).
  const COLUMNS = [
    'codigo', 'nombre', 'marca', 'modelo', 'categoria', 'subcategoria', 'descripcion',
    'precio', 'precio_anterior', 'precio_oferta', 'stock',
    'etiquetas', 'destacado', 'nuevo', 'activo', 'precio_manual', 'imagenes', 'id',
  ];

  /* ---------- CSV: serialización ------------------------------------------ */
  function csvCell(v) {
    const s = v == null ? '' : String(v);
    return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function productToRow(p) {
    const cat = Store.getCategory(p.categoryId);
    const sub = cat && (cat.subcategories || []).find((s) => s.id === p.subcategoryId);
    return [
      p.code, p.name, p.brand, p.model || '', cat ? cat.name : '', sub ? sub.name : '', p.description,
      p.price, p.priceOld != null ? p.priceOld : '', p.priceSale != null ? p.priceSale : '', p.stock,
      (p.tags || []).join('|'),
      p.featured ? 'si' : 'no', p.isNew ? 'si' : 'no', p.active === false ? 'no' : 'si',
      p.priceLock ? 'si' : 'no',
      // Solo exportamos imágenes que sean URLs (no data URLs, que romperían el CSV)
      (p.images || []).filter((u) => /^https?:/i.test(u)).join('|'),
      p.id,
    ];
  }

  function exportProductsCSV(products) {
    const list = products || Store.state.products;
    const lines = [COLUMNS.join(',')];
    list.forEach((p) => lines.push(productToRow(p).map(csvCell).join(',')));
    const csv = '﻿' + lines.join('\r\n'); // BOM para Excel/acentos
    U.download('productos.csv', csv, 'text/csv;charset=utf-8');
  }

  function downloadTemplate() {
    const example = [
      'A001', 'Auriculares Bluetooth', 'Genérica', '', 'Electrónica', 'Audio',
      'Auriculares inalámbricos con estuche de carga', '18900', '25000', '', '15',
      'Oferta|Nuevo', 'si', 'si', 'si', 'no', '', '',
    ];
    const csv = '﻿' + COLUMNS.join(',') + '\r\n' + example.map(csvCell).join(',') + '\r\n';
    U.download('plantilla_productos.csv', csv, 'text/csv;charset=utf-8');
  }

  /* ---------- CSV: parseo robusto (comillas, comas y saltos embebidos) ----
   * El separador se DETECTA (coma, punto y coma o tabulador) mirando la primera
   * línea: usar ambos a la vez rompía los CSV de Excel es-AR, que separan con
   * ";" y usan "," como decimal ("18,50" quedaba partido en dos columnas).
   * ---------------------------------------------------------------------- */
  function detectSeparator(text) {
    let inQ = false, sc = 0, cc = 0, tc = 0;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (c === '"') inQ = !inQ;
      else if (!inQ) {
        if (c === '\n') break;
        if (c === ';') sc++;
        else if (c === ',') cc++;
        else if (c === '\t') tc++;
      }
    }
    if (sc > 0 && sc >= cc && sc >= tc) return ';';
    if (tc > 0 && tc > cc) return '\t';
    return ',';
  }

  function parseCSV(text) {
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // quita BOM
    const sep = detectSeparator(text);
    const rows = [];
    let row = [], field = '', inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; }
          else inQuotes = false;
        } else field += c;
      } else if (c === '"') inQuotes = true;
      else if (c === sep) { row.push(field); field = ''; }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else if (c === '\r') { /* ignora */ }
      else field += c;
    }
    if (field.length || row.length) { row.push(field); rows.push(row); }
    return rows.filter((r) => r.some((c) => c.trim() !== ''));
  }

  const truthy = (v) => /^(si|sí|s|yes|y|true|1|x)$/i.test(String(v).trim());

  /** Resuelve (o crea) categoría y subcategoría por nombre durante la importación. */
  async function resolveCategory(catName, subName) {
    let categoryId = '', subcategoryId = '';
    catName = (catName || '').trim();
    subName = (subName || '').trim();
    if (!catName) return { categoryId, subcategoryId };
    let cat = Store.state.categories.find((c) => U.normalize(c.name) === U.normalize(catName));
    if (!cat) cat = await Store.saveCategory({ name: catName });
    categoryId = cat.id;
    if (subName) {
      let sub = (cat.subcategories || []).find((s) => U.normalize(s.name) === U.normalize(subName));
      if (!sub) sub = await Store.addSubcategory(cat.id, subName);
      subcategoryId = sub.id;
    }
    return { categoryId, subcategoryId };
  }

  /** Convierte filas (objeto por encabezado) en productos y los guarda.
   *  v2: si la fila trae 'id' o un 'codigo' que ya existe en la base, ACTUALIZA
   *  ese producto (misma id) en lugar de crear un duplicado, y conserva los
   *  campos que el CSV no puede transportar (imágenes locales, candado, etc.). */
  async function rowsToProducts(rows) {
    if (!rows.length) return { imported: 0, created: 0, updated: 0 };
    const header = rows[0].map((h) => U.normalize(h.trim()));
    const idx = {};
    COLUMNS.forEach((col) => { idx[col] = header.indexOf(U.normalize(col)); });

    // Índices de productos existentes para actualizar en vez de duplicar.
    const normCode = (s) => U.normalize(s).replace(/[\s\-_.]/g, '');
    const byId = new Map(Store.state.products.map((p) => [p.id, p]));
    const byCode = new Map();
    Store.state.products.forEach((p) => { if (p.code) byCode.set(normCode(p.code), p); });

    const products = [];
    const seen = new Set(); // un mismo producto no se matchea dos veces por archivo
    let created = 0, updated = 0;
    for (let r = 1; r < rows.length; r++) {
      const cells = rows[r];
      const get = (col) => (idx[col] >= 0 ? (cells[idx[col]] || '').trim() : '');
      const name = get('nombre');
      if (!name) continue;
      const { categoryId, subcategoryId } = await resolveCategory(get('categoria'), get('subcategoria'));
      const imgs = get('imagenes').split('|').map((s) => s.trim()).filter(Boolean);

      // ¿Existe ya? 1) por id exacto  2) por código normalizado.
      const rowId = get('id');
      const code = get('codigo');
      let existing = (rowId && byId.get(rowId)) || (code && byCode.get(normCode(code))) || null;
      if (existing && seen.has(existing.id)) existing = null; // fila repetida → crea aparte
      if (existing) { seen.add(existing.id); updated++; } else { created++; }
      const base = existing ? JSON.parse(JSON.stringify(existing)) : {};

      products.push(Object.assign(base, {
        id: existing ? existing.id : undefined,
        code,
        name,
        brand: get('marca'),
        // Columnas nuevas: si el archivo no las trae, se conserva lo existente.
        model: idx['modelo'] >= 0 ? get('modelo') : (base.model || ''),
        priceLock: idx['precio_manual'] >= 0 ? truthy(get('precio_manual')) : (base.priceLock || false),
        categoryId, subcategoryId,
        description: get('descripcion'),
        price: U.parsePrice(get('precio')),
        priceOld: get('precio_anterior') ? U.parsePrice(get('precio_anterior')) : null,
        priceSale: get('precio_oferta') ? U.parsePrice(get('precio_oferta')) : null,
        stock: parseInt(get('stock'), 10) || 0,
        tags: get('etiquetas').split('|').map((s) => s.trim()).filter(Boolean),
        featured: truthy(get('destacado')),
        isNew: truthy(get('nuevo')),
        active: get('activo') === '' ? true : truthy(get('activo')),
        // El CSV no transporta imágenes locales (data URLs): si la fila no trae
        // URLs, se conservan las imágenes que el producto ya tenía.
        images: imgs.length ? imgs : (base.images || []),
      }));
    }
    const imported = await Store.bulkUpsertProducts(products);
    return { imported, created, updated };
  }

  /* ---------- XLSX opcional (SheetJS bajo demanda) ------------------------ */
  let sheetJsPromise = null;
  function loadSheetJS() {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    if (sheetJsPromise) return sheetJsPromise;
    sheetJsPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
      s.onload = () => resolve(window.XLSX);
      s.onerror = () => reject(new Error('No se pudo cargar el soporte XLSX (requiere Internet). Usá CSV.'));
      document.head.appendChild(s);
    });
    return sheetJsPromise;
  }

  async function importXLSX(file) {
    const XLSX = await loadSheetJS();
    const buf = await U.readFileAsArrayBuffer(file);
    const wb = XLSX.read(buf, { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false });
    return rowsToProducts(rows.map((r) => r.map((c) => (c == null ? '' : String(c)))));
  }

  async function exportProductsXLSX(products) {
    const XLSX = await loadSheetJS();
    const list = products || Store.state.products;
    const aoa = [COLUMNS].concat(list.map(productToRow));
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Productos');
    XLSX.writeFile(wb, 'productos.xlsx');
  }

  /* ---------- Punto de entrada unificado por archivo --------------------- */
  async function importFile(file) {
    const name = (file.name || '').toLowerCase();
    if (name.endsWith('.xlsx') || name.endsWith('.xls')) return importXLSX(file);
    const text = await U.readFileAsText(file);
    return rowsToProducts(parseCSV(text));
  }

  App.IO = {
    COLUMNS,
    exportProductsCSV, exportProductsXLSX, downloadTemplate,
    parseCSV, rowsToProducts, importFile,
    // Única implementación de crear/resolver categorías por nombre: la
    // reutilizan smart-import y ui-admin-import (antes había 3 copias).
    resolveCategory,
  };
})(window.App = window.App || {});
