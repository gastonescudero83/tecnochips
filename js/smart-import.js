/* =============================================================================
 * smart-import.js — Importación inteligente de catálogos de proveedores
 * -----------------------------------------------------------------------------
 * MÓDULO INDEPENDIENTE Y ADITIVO. No modifica la lógica existente: se apoya en
 * App.Store (dominio), App.IO (CSV), App.Images (compresión) y App.U (utils).
 *
 * Capacidades:
 *   • Lee PDF / XLSX / XLS / CSV (PDF y XLSX vía librerías cargadas bajo demanda).
 *   • Extrae: código, nombre, marca, modelo, descripción, categoría, precio,
 *     imágenes (URLs en planillas; embebidas en PDF: best-effort).
 *   • Matchea contra la base por: 1) código  2) marca+modelo  3) nombre similar.
 *   • Actualiza existentes (solo campos importados), crea nuevos y —opcional—
 *     marca activo=false los que no aparecen.
 *   • Respeta priceLock (usar_precio_manual) y NO pisa imágenes ya cargadas.
 *   • Reporta progreso por fases y un resumen final.
 *
 * Nota de arquitectura: este proyecto es offline (IndexedDB), no usa Supabase;
 * las imágenes importadas se guardan como data URL igual que el resto.
 * ========================================================================== */
(function (App) {
  'use strict';

  const { U, Store, Images } = App;

  const CONFIG = Object.freeze({
    ACCEPT: '.pdf,.xlsx,.xls,.csv',
    MAX_BYTES: 25 * 1024 * 1024, // 25 MB
    NAME_SIM_THRESHOLD: 0.84,
    MIN_IMG_SIDE: 48, // ignora imágenes diminutas (íconos) extraídas del PDF
  });

  // Marcas conocidas para detección heurística en PDFs
  const BRANDS = ['Apple', 'iPhone', 'Samsung', 'Xiaomi', 'Redmi', 'Poco', 'Motorola',
    'Realme', 'Infinix', 'Tecno', 'ZTE', 'Nokia', 'LG', 'Sony', 'Nintendo', 'Xbox',
    'Microsoft', 'TCL', 'Noblex', 'Kanji', 'RCA', 'Logitech', 'Huawei', 'Honor',
    'JBL', 'Lenovo', 'HP', 'Dell', 'Asus', 'Acer', 'Philips', 'BGH', 'Hisense',
    // Electrodomésticos / línea blanca (frecuentes en catálogos de proveedores)
    'Escorial', 'Drean', 'Whirlpool', 'Patrick', 'Gafa', 'Philco', 'Liliana',
    'Atma', 'Peabody', 'Longvie', 'Orbis', 'Surrey', 'Electrolux', 'Kohinoor',
    'Eslabon de Lujo', 'Coventry', 'Briket', 'Sigma', 'Domec', 'Florencia'];

  // Tipos de electrodoméstico (para catálogos con bloques "MODELO:")
  const APPLIANCE = ['COCINA', 'ANAFE', 'HORNO', 'HELADERA', 'FREEZER', 'LAVARROPAS',
    'LAVASECARROPAS', 'SECARROPAS', 'LAVAVAJILLAS', 'MICROONDAS', 'TERMOTANQUE',
    'CALEFON', 'CALEFACTOR', 'ESTUFA', 'VENTILADOR', 'SPLIT', 'AIRE ACONDICIONADO',
    'TELEVISOR', 'LICUADORA', 'BATIDORA', 'PROCESADORA', 'CAFETERA', 'PAVA ELECTRICA',
    'TOSTADORA', 'PLANCHA', 'ASPIRADORA', 'PARLANTE', 'NOTEBOOK', 'MONITOR'];
  const applianceRe = () => new RegExp('\\b(' + APPLIANCE.join('|').replace(/ /g, '\\s+') + ')\\b', 'gi');

  // Sinónimos de encabezados de planilla → campo canónico
  const HEADER_MAP = {
    code: ['codigo', 'cod', 'sku', 'code', 'art', 'articulo', 'id', 'referencia', 'ref'],
    name: ['nombre', 'name', 'producto', 'titulo', 'articulo', 'detalle'],
    brand: ['marca', 'brand', 'fabricante'],
    model: ['modelo', 'model'],
    description: ['descripcion', 'description', 'detalle', 'observaciones', 'caracteristicas'],
    category: ['categoria', 'rubro', 'category', 'familia', 'linea'],
    subcategory: ['subcategoria', 'subrubro', 'subcategory'],
    price: ['precio', 'price', 'pvp', 'importe', 'valor', 'costo', 'lista', 'precio venta', 'precio final', 'precio publico'],
    images: ['imagen', 'imagenes', 'image', 'images', 'foto', 'fotos', 'url', 'link', 'url imagen'],
  };

  /* ---------- Validación -------------------------------------------------- */
  function extOf(name) {
    const m = /\.([a-z0-9]+)$/i.exec(name || '');
    return m ? m[1].toLowerCase() : '';
  }
  function validateFile(file) {
    if (!file) return { ok: false, reason: 'No se seleccionó ningún archivo.' };
    const ext = extOf(file.name);
    if (['pdf', 'xlsx', 'xls', 'csv'].indexOf(ext) < 0)
      return { ok: false, reason: 'Formato no permitido. Usá PDF, XLSX, XLS o CSV.' };
    if (file.size > CONFIG.MAX_BYTES)
      return { ok: false, reason: `El archivo supera el máximo de ${(CONFIG.MAX_BYTES / 1048576) | 0} MB.` };
    if (file.size === 0) return { ok: false, reason: 'El archivo está vacío.' };
    return { ok: true, ext };
  }

  /* ---------- Carga diferida de librerías (PDF.js / SheetJS) -------------- */
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src; s.onload = resolve;
      s.onerror = () => reject(new Error('No se pudo cargar ' + src + ' (requiere Internet).'));
      document.head.appendChild(s);
    });
  }
  let _xlsx, _pdfjs;
  async function loadSheetJS() {
    if (window.XLSX) return window.XLSX;
    if (!_xlsx) _xlsx = loadScript('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js').then(() => window.XLSX);
    return _xlsx;
  }
  async function loadPdfJs() {
    if (window.pdfjsLib) return window.pdfjsLib;
    if (!_pdfjs) _pdfjs = loadScript('https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js').then(() => {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
      return window.pdfjsLib;
    });
    return _pdfjs;
  }

  /* ---------- Helpers de extracción -------------------------------------- */
  function detectBrand(text) {
    const n = U.normalize(text);
    for (const b of BRANDS) {
      if (n.indexOf(U.normalize(b)) > -1) {
        if (b === 'iPhone') return 'Apple';
        if (b === 'Redmi' || b === 'Poco') return 'Xiaomi';
        return b;
      }
    }
    return '';
  }

  function extractPrice(text) {
    let m, best = null;
    const re = /\$\s*([\d][\d.,]*)/g;            // prioriza valores con $
    while ((m = re.exec(text))) best = m;
    if (!best) {                                  // si no hay $, busca números "grandes"
      const re2 = /\b(\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{2})?|\d{3,}(?:[.,]\d{2})?)\b/g;
      while ((m = re2.exec(text))) best = m;
    }
    if (!best) return null;
    return { value: U.parsePrice(best[1]), index: best.index, raw: best[0] };
  }

  // Convierte una línea de texto de PDF en un registro de producto (best-effort)
  function parseTextLine(line) {
    line = (line || '').replace(/\s+/g, ' ').trim();
    if (line.length < 3) return null;
    const low = U.normalize(line);
    if (/^(total|subtotal|iva|pagina|lista de precios|catalogo|precio unitario|cantidad)\b/.test(low)) return null;
    const p = extractPrice(line);
    if (!p || !(p.value > 0)) return null;
    let name = (line.slice(0, p.index) + ' ' + line.slice(p.index + p.raw.length)).replace(/\s+/g, ' ').trim();
    name = name.replace(/[|;]+/g, ' ').trim();
    if (name.length < 2) return null;
    let code = '';
    const first = name.split(' ')[0];
    if (/[0-9]/.test(first) && /^[A-Za-z0-9._\-\/]{3,}$/.test(first) && !/^\d{1,2}$/.test(first)) {
      code = first;
    }
    return { code, name, brand: detectBrand(name), model: '', description: name, categoryName: '', price: p.value, images: [] };
  }

  function titleCase(s) {
    return String(s || '').toLowerCase()
      .replace(/\b[\wáéíóúñ]/g, (c) => c.toUpperCase()).trim();
  }

  // Divide una línea de catálogo en bloques por tipo de electrodoméstico
  function splitCatalog(line) {
    if (!/MODELO/i.test(line) && !applianceRe().test(line)) return [];
    const re = applianceRe(); const starts = []; let m;
    while ((m = re.exec(line))) starts.push(m.index);
    if (!starts.length) return [line];
    const chunks = [];
    for (let i = 0; i < starts.length; i++) chunks.push(line.slice(starts[i], starts[i + 1] || line.length).trim());
    return chunks.filter((c) => c.length > 3);
  }

  // Convierte un bloque "COCINA <Marca> ... MODELO: <X>" en un registro
  function parseCatalogChunk(ch) {
    ch = (ch || '').replace(/\s+/g, ' ').trim();
    if (ch.length < 4) return null;
    const brand = detectBrand(ch);
    let model = '';
    const mm = /MODELO\s*:?\s*([A-Za-z0-9ÁÉÍÓÚÑáéíóúñ .\-\/]+)/i.exec(ch);
    if (mm) model = mm[1].split(/\s(?=DESCRIP|COCINA|HELADERA|ANAFE|HORNO|LAVA|FREEZER|MICRO)/i)[0].replace(/\s{2,}/g, ' ').trim();
    let desc = '';
    const dm = /DESCRIPCI[ÓO]N\s*:?\s*([\s\S]*?)(?:MODELO|$)/i.exec(ch);
    if (dm) desc = dm[1].replace(/\s{2,}/g, ' ').trim();
    // Tipo de producto: prefiere la palabra en MAYÚSCULAS (el título de la
    // ficha, ej. "COCINA SAHO") sobre menciones en minúscula de la descripción
    // ("4 hornallas Con plancha", "Cocina eléctrica"), que clasificaban mal.
    let typ = '';
    {
      const re = applianceRe(); let m, first = '';
      while ((m = re.exec(ch))) {
        if (!first) first = m[1];
        if (!typ && m[1] === m[1].toUpperCase()) typ = m[1];
      }
      if (!typ) typ = first;
    }
    const p = extractPrice(ch);
    const name = [titleCase(typ), titleCase(brand), titleCase(model)].filter(Boolean).join(' ').trim()
      || titleCase(ch.slice(0, 60));
    if (!name || name.length < 3) return null;
    return {
      code: '', name, brand, model,
      description: desc || ch, categoryName: typ ? titleCase(typ) : '',
      price: p ? p.value : 0, images: [],
    };
  }

  // Devuelve 0..n registros de una línea de texto (catálogo o línea simple)
  function parseAnyLine(line) {
    line = (line || '').replace(/\s+/g, ' ').trim();
    if (line.length < 3) return [];
    const chunks = splitCatalog(line);
    if (chunks.length) return chunks.map(parseCatalogChunk).filter(Boolean);
    const single = parseTextLine(line);
    return single ? [single] : [];
  }

  /**
   * Catálogos por FICHAS: agrupa las líneas de la página en bloques de
   * producto. Una ficha TERMINA en su línea "MODELO: X" (si el valor viene en
   * la línea siguiente, la absorbe). El texto que queda después de la última
   * ficha solo se incluye si menciona un electrodoméstico (evita pies de página).
   * Sin esto, el parser por línea generaba 2+ registros por producto
   * ("Cocina Escorial" + "Candor") y las fotos se asignaban desalineadas.
   */
  function blocksFromLines(lineas) {
    const bloques = []; let cur = [];
    for (let i = 0; i < lineas.length; i++) {
      const l = lineas[i];
      cur.push(l);
      if (/\bMODELO\b/i.test(l)) {
        if (/MODELO\s*:?\s*$/i.test(l) && lineas[i + 1]) { cur.push(lineas[i + 1]); i++; }
        bloques.push(cur.join(' ').replace(/\s+/g, ' ').trim());
        cur = [];
      }
    }
    if (cur.length && applianceRe().test(cur.join(' '))) {
      bloques.push(cur.join(' ').replace(/\s+/g, ' ').trim());
    }
    return bloques.filter((b) => b.length > 6);
  }

  /**
   * Agrupa el texto por BANDAS verticales definidas por las FOTOS de la página
   * (cada foto = un producto; su texto es el que cae en su banda). Es la verdad
   * visual: funciona sin importar si la descripción viene antes o después del
   * título/MODELO en el orden interno del PDF (que varía entre páginas y
   * generaba fichas fantasma, ej. "Ventilador industrial" sin foto).
   */
  function sectorRecords(items, viewport, fotos) {
    const H = viewport.height;
    // Límite entre bandas: punto medio entre el fin de una foto y el inicio de la siguiente.
    const cortes = [];
    for (let i = 0; i < fotos.length - 1; i++) {
      cortes.push(((fotos[i].y + fotos[i].h) + fotos[i + 1].y) / 2);
    }
    const bandas = fotos.map(() => []);
    (items || []).forEach((it) => {
      const s = (it.str || '').trim(); if (!s) return;
      const h = it.height || Math.abs(it.transform[3]) || 8;
      const yTop = (H - it.transform[5] - h) / H; // 0 = borde superior
      let b = 0; while (b < cortes.length && yTop >= cortes[b]) b++;
      bandas[b].push({ s: s, x: it.transform[4], y: yTop });
    });
    return bandas.map((frs) => {
      frs.sort((a, b) => (a.y - b.y) || (a.x - b.x));
      const texto = frs.map((f) => f.s).join(' ').replace(/\s+/g, ' ').trim();
      return texto.length > 6 ? parseCatalogChunk(texto) : null;
    });
  }

  /* ---------- Lectura: CSV / planilla ------------------------------------ */
  function headerIndex(headerCells, field) {
    const syns = HEADER_MAP[field];
    for (let i = 0; i < headerCells.length; i++) {
      const h = U.normalize(headerCells[i]);
      if (syns.some((s) => h.indexOf(U.normalize(s)) > -1)) return i;
    }
    return -1;
  }
  function rowsToRecords(rows) {
    if (!rows || rows.length < 2) return [];
    const header = rows[0].map((c) => String(c == null ? '' : c));
    const idx = {};
    Object.keys(HEADER_MAP).forEach((f) => { idx[f] = headerIndex(header, f); });
    const out = [];
    for (let r = 1; r < rows.length; r++) {
      const cells = rows[r].map((c) => (c == null ? '' : String(c).trim()));
      const get = (f) => (idx[f] >= 0 ? cells[idx[f]] || '' : '');
      const name = get('name') || get('description');
      const price = U.parsePrice(get('price'));
      const code = get('code');
      if (!name && !code) continue;
      const imgs = get('images').split(/[|,;\n]/).map((s) => s.trim()).filter((s) => /^https?:|^data:/i.test(s));
      out.push({
        code, name: name || code, brand: get('brand'), model: get('model'),
        description: get('description') || name, categoryName: get('category'),
        subcategoryName: get('subcategory'), price, images: imgs,
      });
    }
    return out;
  }

  async function parseSpreadsheet(file, onProgress) {
    onProgress('analizando', 0.25, 'Abriendo planilla…');
    const XLSX = await loadSheetJS();
    const buf = await U.readFileAsArrayBuffer(file);
    const wb = XLSX.read(buf, { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false });
    return rowsToRecords(rows.map((r) => r.map((c) => (c == null ? '' : c))));
  }

  /* ---------- Lectura: PDF (texto + imágenes best-effort) ---------------- */
  function groupLines(items, pageWidth) {
    // Reutiliza el reconstructor de líneas del sistema de parsers: agrupa por Y,
    // ordena por X y CORTA por columnas cuando hay un hueco enorme con precio a
    // ambos lados (catálogos a 2 columnas ya no mezclan texto cruzado).
    if (App.Parsers && App.Parsers.util && App.Parsers.util.linesFromItems) {
      return App.Parsers.util.linesFromItems(items, pageWidth);
    }
    // Respaldo (comportamiento previo) por si el sistema de parsers no cargó.
    const rows = [];
    items.forEach((it) => {
      const y = Math.round(it.transform[5]);
      let row = rows.find((r) => Math.abs(r.y - y) <= 3);
      if (!row) { row = { y, items: [] }; rows.push(row); }
      row.items.push(it);
    });
    rows.sort((a, b) => b.y - a.y);
    return rows.map((r) => r.items.sort((a, b) => a.transform[4] - b.transform[4]).map((i) => i.str).join(' '));
  }

  /* ======================================================================= *
   *  MOTOR DE IMÁGENES — estrategia en cascada (Método 1 → 2 → 3)
   *  Solo mejora la EXTRACCIÓN de imágenes; el parser de productos no se toca.
   *  Adaptado a la arquitectura offline del proyecto: las imágenes se guardan
   *  como WebP optimizado en IndexedDB (este proyecto NO usa Supabase).
   * ======================================================================= */

  // pdf.js v3 entrega las imágenes decodificadas como ImageBitmap (img.bitmap)
  // o como buffer crudo (img.data). Soportar AMBOS era la pieza que faltaba:
  // antes solo se manejaba img.data, por eso no se importaba ninguna imagen.
  function pdfImageToCanvas(img) {
    try {
      const w = img.width, h = img.height;
      if (!w || !h) return null;
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d');
      const src = img.bitmap || img.image; // ImageBitmap / HTMLImageElement / Canvas
      if (src) { ctx.drawImage(src, 0, 0, w, h); return canvas; }
      const data = img.data;
      if (!data) return null;
      const out = ctx.createImageData(w, h);
      const px = out.data;
      if (data.length === w * h * 4) px.set(data);
      else if (data.length === w * h * 3) { for (let i = 0, j = 0; i < data.length; i += 3, j += 4) { px[j] = data[i]; px[j + 1] = data[i + 1]; px[j + 2] = data[i + 2]; px[j + 3] = 255; } }
      else if (data.length === w * h) { for (let i = 0, j = 0; i < data.length; i++, j += 4) { px[j] = px[j + 1] = px[j + 2] = data[i]; px[j + 3] = 255; } }
      else return null;
      ctx.putImageData(out, 0, 0);
      return canvas;
    } catch (_e) { return null; }
  }

  // Firma perceptual chica (8×8) para deduplicar y detectar adornos repetidos
  function imageSignature(canvas) {
    try {
      const s = document.createElement('canvas'); s.width = 8; s.height = 8;
      const c = s.getContext('2d'); c.drawImage(canvas, 0, 0, 8, 8);
      const d = c.getImageData(0, 0, 8, 8).data;
      let sig = '';
      for (let i = 0; i < d.length; i += 4) sig += (((d[i] + d[i + 1] + d[i + 2]) / 48) | 0).toString(16);
      return sig;
    } catch (_e) { return 'r' + Math.random().toString(36).slice(2); }
  }

  // Optimiza a WebP reescalando en el mismo canvas (rápido: sin recargar imagen)
  const OUT_MIME = (Images && Images.outputMime) || 'image/webp';
  function optimizeCanvas(canvas, maxDim) {
    try {
      maxDim = maxDim || 1280;
      let w = canvas.width, h = canvas.height;
      let target = canvas;
      if (w > maxDim || h > maxDim) {
        const r = Math.min(maxDim / w, maxDim / h);
        w = Math.round(w * r); h = Math.round(h * r);
        target = document.createElement('canvas');
        target.width = w; target.height = h;
        target.getContext('2d').drawImage(canvas, 0, 0, w, h);
      }
      return target.toDataURL(OUT_MIME, 0.82);
    } catch (_e) {
      try { return canvas.toDataURL('image/jpeg', 0.82); } catch (_e2) { return null; }
    }
  }

  // MÉTODO 1 — imágenes embebidas (XObject Image / JPEG / inline)
  async function extractEmbeddedCanvases(page, pdfjsLib, cap) {
    const out = [];
    try {
      const ops = await page.getOperatorList();
      const OPS = pdfjsLib.OPS;
      const wanted = [OPS.paintImageXObject, OPS.paintJpegXObject, OPS.paintImageXObjectRepeat, OPS.paintInlineImageXObject].filter((x) => x != null);
      for (let i = 0; i < ops.fnArray.length && out.length < cap; i++) {
        if (wanted.indexOf(ops.fnArray[i]) < 0) continue;
        const arg = ops.argsArray[i][0];
        let img = null;
        if (typeof arg === 'string') {
          img = await getPageImage(page, arg); // busca en objs Y commonObjs
        } else if (arg && (arg.data || arg.bitmap)) img = arg; // imagen inline
        if (!img || (img.width || 0) < CONFIG.MIN_IMG_SIDE || (img.height || 0) < CONFIG.MIN_IMG_SIDE) continue;
        const canvas = pdfImageToCanvas(img);
        if (canvas) out.push({ canvas: canvas, sig: imageSignature(canvas) });
      }
    } catch (_e) { /* best-effort */ }
    return out;
  }

  // MÉTODO 1b — bboxes COLOCADOS de las imágenes (operator list + matriz CTM).
  // Permite filtrar por posición/tamaño REAL en la página: fondo de página,
  // tiras decorativas y sellos repetidos ("ÚLTIMA UNIDAD") no son fotos, y el
  // orden de lectura (arriba→abajo) alinea cada foto con su producto.
  async function placedImages(page, pdfjsLib) {
    const out = [];
    try {
      const viewport = page.getViewport({ scale: 1 });
      const W = viewport.width, H = viewport.height;
      const ops = await page.getOperatorList();
      const OPS = pdfjsLib.OPS;
      const stack = [[1, 0, 0, 1, 0, 0]];
      const mul = (m1, m2) => [
        m1[0] * m2[0] + m1[2] * m2[1], m1[1] * m2[0] + m1[3] * m2[1],
        m1[0] * m2[2] + m1[2] * m2[3], m1[1] * m2[2] + m1[3] * m2[3],
        m1[0] * m2[4] + m1[2] * m2[5] + m1[4], m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
      ];
      let ctm = stack[0];
      for (let i = 0; i < ops.fnArray.length; i++) {
        const fn = ops.fnArray[i], args = ops.argsArray[i];
        if (fn === OPS.save) stack.push(ctm.slice());
        else if (fn === OPS.restore) ctm = stack.pop() || [1, 0, 0, 1, 0, 0];
        else if (fn === OPS.transform) ctm = mul(ctm, args);
        else if (fn === OPS.paintFormXObjectBegin) { stack.push(ctm.slice()); if (args && args[0] && args[0].length === 6) ctm = mul(ctm, args[0]); }
        else if (fn === OPS.paintFormXObjectEnd) ctm = stack.pop() || [1, 0, 0, 1, 0, 0];
        else if (fn === OPS.paintImageXObject || fn === OPS.paintJpegXObject || fn === OPS.paintImageXObjectRepeat) {
          const name = typeof args[0] === 'string' ? args[0] : '';
          if (!name) continue;
          const pts = [[0, 0], [1, 0], [0, 1], [1, 1]].map((p) => [
            ctm[0] * p[0] + ctm[2] * p[1] + ctm[4],
            ctm[1] * p[0] + ctm[3] * p[1] + ctm[5],
          ]);
          const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
          const x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs);
          const y0 = Math.min.apply(null, ys), y1 = Math.max.apply(null, ys);
          const w = x1 - x0, h = y1 - y0;
          if (w < 8 || h < 8) continue;
          out.push({ name, x: x0 / W, y: (H - y1) / H, w: w / W, h: h / H });
        }
      }
    } catch (_e) { /* sin operator list: el llamador cae al método por orden */ }
    return out;
  }

  // Resuelve un XObject de imagen (con timeout de resguardo).
  // Las imágenes "GLOBALES" del PDF (nombres g_...) viven en page.commonObjs;
  // las de página en page.objs. Se consultan AMBOS almacenes: antes solo se
  // miraba objs y los productos con foto global quedaban sin imagen.
  function getPageImage(page, name) {
    return new Promise((res) => {
      let done = false;
      const finish = (o) => { if (!done && o) { done = true; res(o); } };
      try { page.objs.get(name, finish); } catch (_e) { /* puede no estar acá */ }
      try { if (page.commonObjs) page.commonObjs.get(name, finish); } catch (_e) { /* ni acá */ }
      setTimeout(() => { if (!done) { done = true; res(null); } }, 1500);
    });
  }

  // MÉTODO 2 — render de la página + recorte por celdas de producto
  async function renderPageToCanvas(page, scale) {
    const viewport = page.getViewport({ scale: scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
    await page.render({ canvasContext: canvas.getContext('2d'), viewport: viewport }).promise;
    return { canvas: canvas, viewport: viewport };
  }

  // Agrupa los textos en una grilla (columnas × filas): 1 celda ≈ 1 producto.
  // Usa SOLO posiciones de texto para inferir el layout (no toca el parser).
  function detectGridCells(items, viewport) {
    const pts = items.filter((it) => it.str && it.str.trim()).map((it) => {
      const p = viewport.convertToViewportPoint(it.transform[4], it.transform[5]);
      return { x: p[0], y: p[1] };
    });
    if (pts.length < 2) return [];
    const cluster = (vals, gap) => {
      vals = vals.slice().sort((a, b) => a - b);
      const groups = [[vals[0]]];
      for (let i = 1; i < vals.length; i++) {
        if (vals[i] - vals[i - 1] > gap) groups.push([]);
        groups[groups.length - 1].push(vals[i]);
      }
      return groups.map((g) => g.reduce((a, b) => a + b, 0) / g.length);
    };
    const W = viewport.width, H = viewport.height;
    const cols = cluster(pts.map((p) => p.x), W * 0.12);
    const rows = cluster(pts.map((p) => p.y), H * 0.10);
    if (!cols.length || !rows.length || cols.length * rows.length > 60) return [];
    const cw = W / cols.length, ch = H / rows.length;
    const cells = [];
    rows.forEach((cy) => cols.forEach((cx) => cells.push({ x: cx - cw / 2, y: cy - ch / 2, w: cw, h: ch })));
    cells.sort((a, b) => (a.y - b.y) || (a.x - b.x)); // orden de lectura: ↓ luego →
    return cells;
  }

  async function cropCellPhotos(pageCanvas, cells, cap) {
    const out = [];
    for (let i = 0; i < cells.length && out.length < cap; i++) {
      const c = cells[i];
      const x = Math.max(0, c.x + c.w * 0.05);
      const y = Math.max(0, c.y);
      const w = Math.min(pageCanvas.width - x, c.w * 0.9);
      const h = Math.min(pageCanvas.height - y, c.h * 0.72); // foto: parte superior de la celda
      if (w < CONFIG.MIN_IMG_SIDE || h < CONFIG.MIN_IMG_SIDE) { out.push(null); continue; }
      const crop = document.createElement('canvas');
      crop.width = Math.round(w); crop.height = Math.round(h);
      crop.getContext('2d').drawImage(pageCanvas, x, y, w, h, 0, 0, crop.width, crop.height);
      out.push(crop);
    }
    return out;
  }

  async function parsePdf(file, onProgress, opts) {
    opts = opts || {};
    const extractImages = !!opts.extractImages;            // OFF por defecto (es lo lento)
    const maxPages = opts.maxPages || 120;
    const pdfjsLib = await loadPdfJs();
    // Reutiliza el documento cacheado por el sistema de parsers (no re-lee el archivo)
    const pdf = (App.Parsers && App.Parsers.util && App.Parsers.util.getPdfDoc)
      ? await App.Parsers.util.getPdfDoc(file)
      : await pdfjsLib.getDocument({ data: await U.readFileAsArrayBuffer(file) }).promise;
    const pages = Math.min(pdf.numPages, maxPages);
    const records = [];
    const notes = [];
    if (pdf.numPages > pages) notes.push('El PDF tiene ' + pdf.numPages + ' páginas; se procesaron las primeras ' + pages + '.');
    // Estado del motor de imágenes (cascada)
    let imgBudget = extractImages ? (opts.maxImages || 1000) : 0;
    const maxRenderPages = opts.maxRenderPages || 24;
    const renderScale = opts.renderScale || 2;
    const sigCount = new Map();   // firma → veces que aparece (para descartar adornos)
    const sigCache = new Map();   // firma → WebP optimizado (reutiliza, no re-comprime)
    const assignments = [];       // { rec, sig } para el filtro de adornos posterior
    let method1 = 0, method2 = 0, m2pages = 0, m2used = false;

    let textFrags = 0; // detección de PDF ESCANEADO (sin capa de texto digital)
    for (let n = 1; n <= pages; n++) {
      onProgress('analizando', 0.12 + 0.5 * (n / pages), `Página ${n}/${pages}`);
      const page = await pdf.getPage(n);
      const vp1 = page.getViewport({ scale: 1 });
      const tc = await page.getTextContent();
      textFrags += tc.items.reduce((a, i) => a + ((i.str || '').trim() ? 1 : 0), 0);
      // Si tras 3 páginas (o todo el archivo) no apareció NI UN fragmento de
      // texto, el PDF es escaneado: avisar con claridad y no gastar más CPU.
      if (textFrags === 0 && (n >= 3 || n === pages)) {
        notes.push('Este PDF parece ESCANEADO (solo imágenes, sin texto digital): el lector no puede extraer productos de él. Pedile al proveedor la versión digital del catálogo o una lista en Excel/CSV.');
        break;
      }
      let recs = [];
      const lineas = groupLines(tc.items, vp1.width);
      lineas.forEach((l) => { recs = recs.concat(parseAnyLine(l)); });
      // Página estilo "fichas de catálogo" (2+ líneas MODELO): re-parsear por
      // bloques para que 1 ficha = 1 producto y las fotos queden alineadas.
      const nModelo = lineas.filter((l) => /\bMODELO\b/i.test(l)).length;
      if (nModelo >= 2) {
        let recsB = [];
        // 1º intento: bandas por FOTO (la estructura visual real). Solo se usa
        // si cada banda produjo una ficha válida (alineación garantizada).
        try {
          let bands = await placedImages(page, pdfjsLib);
          bands = (App.MotorGeometrico && App.MotorGeometrico.filtrarFotos)
            ? App.MotorGeometrico.filtrarFotos(bands) : [];
          if (bands.length >= 2) {
            bands.sort((a, b) => (a.y - b.y) || (a.x - b.x));
            const rs = sectorRecords(tc.items, vp1, bands);
            if (rs.length === bands.length && rs.every(Boolean)) recsB = rs;
          }
        } catch (_e) { recsB = []; }
        // 2º intento: bloques por línea MODELO (para PDFs sin fotos).
        if (!recsB.length) {
          recsB = blocksFromLines(lineas).map((b) => parseCatalogChunk(b)).filter(Boolean);
        }
        if (recsB.length) recs = recsB;
      }

      if (extractImages && imgBudget > 0 && recs.length) {
        onProgress('analizando', 0.12 + 0.5 * (n / pages), `Página ${n}/${pages} · extrayendo imágenes…`);
        // --- MÉTODO 1: imágenes embebidas por POSICIÓN real en la página ---
        // Se descartan fondo de página, tiras decorativas y sellos repetidos
        // (mismo XObject 2+ veces), y las fotos restantes se ordenan
        // arriba→abajo para alinear cada una con su producto. (Antes se
        // asignaban en orden de aparición: el fondo/sello se colaba como foto
        // del primer producto y corría todas las demás.)
        let cands = [];
        let placed = await placedImages(page, pdfjsLib);
        if (placed.length && App.MotorGeometrico && App.MotorGeometrico.filtrarFotos) {
          placed = App.MotorGeometrico.filtrarFotos(placed);
          placed.sort((a, b) => (a.y - b.y) || (a.x - b.x)); // orden de lectura
          for (const pl of placed) {
            if (cands.length >= Math.min(imgBudget, recs.length + 2)) break;
            const img = await getPageImage(page, pl.name);
            if (!img || (img.width || 0) < CONFIG.MIN_IMG_SIDE || (img.height || 0) < CONFIG.MIN_IMG_SIDE) continue;
            const canvas = pdfImageToCanvas(img);
            if (canvas) cands.push({ canvas: canvas, sig: imageSignature(canvas) });
          }
        }
        // Respaldo: sin operator list o sin candidatas → método por orden de aparición.
        if (!cands.length) {
          try { cands = await extractEmbeddedCanvases(page, pdfjsLib, Math.min(imgBudget, recs.length + 6)); } catch (_e) { cands = []; }
          // Solo en este camino (sin posición conocida): firma repetida 2+
          // veces en la misma página = adorno. En el camino por posición NO se
          // aplica: la misma foto puede repetirse legítimamente (productos iguales).
          if (cands.length > 1) {
            const enPagina = new Map();
            cands.forEach((c) => enPagina.set(c.sig, (enPagina.get(c.sig) || 0) + 1));
            cands = cands.filter((c) => enPagina.get(c.sig) < 2);
          }
        }
        let usedHere = 0;
        for (let i = 0; i < recs.length && cands.length && imgBudget > 0; i++) {
          if (recs[i].images && recs[i].images.length) continue;
          const cand = cands.shift();
          if (!cand) break;
          sigCount.set(cand.sig, (sigCount.get(cand.sig) || 0) + 1);
          let url = sigCache.get(cand.sig);
          if (url === undefined) { url = await optimizeCanvas(cand.canvas); sigCache.set(cand.sig, url); }
          if (url) { recs[i].images = [url]; assignments.push({ rec: recs[i], sig: cand.sig }); imgBudget--; usedHere++; method1++; }
          await new Promise((r) => setTimeout(r)); // cede el hilo entre imágenes
        }
        // --- MÉTODO 2: si no hubo embebidas, render de página + recorte ---
        const lacking = recs.filter((r) => !(r.images && r.images.length));
        if (lacking.length && usedHere === 0 && m2pages < maxRenderPages && imgBudget > 0) {
          m2used = true;
          onProgress('analizando', 0.12 + 0.5 * (n / pages), 'Utilizando método alternativo de extracción…');
          try {
            const rendered = await renderPageToCanvas(page, renderScale);
            const cells = detectGridCells(tc.items, rendered.viewport);
            if (cells.length) {
              const crops = await cropCellPhotos(rendered.canvas, cells, Math.min(imgBudget, lacking.length));
              for (let i = 0; i < lacking.length && i < crops.length; i++) {
                if (!crops[i]) continue;
                const url = await optimizeCanvas(crops[i]);
                if (url) { lacking[i].images = [url]; imgBudget--; method2++; }
              }
            }
            m2pages++;
          } catch (_e) { /* el render falló: el producto queda sin imagen (Método 3) */ }
        }
      }
      records.push.apply(records, recs);
      if (page.cleanup) { try { page.cleanup(); } catch (_e) { /* noop */ } }
      // Cede el hilo entre páginas: la UI sigue viva y la barra avanza (evita el "colgado").
      await new Promise((r) => setTimeout(r));
    }

    // Filtro de adornos: imágenes repetidas en muchas páginas (logos, marcos, fondos)
    if (assignments.length) {
      const decoThreshold = Math.max(5, Math.ceil(pages * 0.5));
      let removed = 0;
      assignments.forEach((a) => { if ((sigCount.get(a.sig) || 0) >= decoThreshold) { a.rec.images = []; removed++; } });
      if (removed) notes.push(removed + ' imágenes repetidas (logos/adornos) se descartaron automáticamente.');
    }
    if (extractImages) {
      const withImg = records.filter((r) => r.images && r.images.length).length;
      notes.push('Imágenes asociadas: ' + withImg + ' (Método 1: ' + method1 + (method2 ? ' · Método 2: ' + method2 : '') + ').');
      if (m2used) notes.push('En algunas páginas se usó el método alternativo (render + recorte): revisá esos recortes.');
    } else if (records.length) {
      notes.push('La extracción de imágenes está desactivada. Activá “Extraer imágenes del PDF” para importarlas.');
    }

    if (records.length && !records.some((r) => r.price > 0)) {
      notes.push('No se detectaron precios en el PDF: los productos se importan con precio 0. Cargá los precios manualmente o usá un Excel/CSV.');
    }
    records._notes = notes;
    return records;
  }

  /* ---------- Matching contra la base ------------------------------------ */
  const normCode = (s) => U.normalize(s).replace(/[\s\-_.]/g, '');

  function levenshtein(a, b) {
    if (a === b) return 0;
    const m = a.length, n = b.length;
    if (!m) return n; if (!n) return m;
    if (Math.abs(m - n) > 8) return Math.max(m, n); // corta comparaciones muy dispares
    let prev = new Array(n + 1);
    for (let j = 0; j <= n; j++) prev[j] = j;
    for (let i = 1; i <= m; i++) {
      let cur = [i];
      for (let j = 1; j <= n; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
      prev = cur;
    }
    return prev[n];
  }
  function sim(a, b) {
    const max = Math.max(a.length, b.length);
    return max ? 1 - levenshtein(a, b) / max : 0;
  }

  /** Índices O(1) por código y marca+modelo. Antes se recorrían TODOS los
   *  productos por cada registro importado (con Levenshtein incluido): con
   *  catálogos grandes eso congelaba la interfaz varios segundos. */
  function buildIndexes() {
    const ps = Store.state.products;
    const byCode = new Map(), byBrandModel = new Map(), byBrand = new Map(), noBrand = [];
    ps.forEach((p) => {
      if (p.code) byCode.set(normCode(p.code), p);
      const b = U.normalize(p.brand || '');
      if (b) {
        if (p.model) byBrandModel.set(b + '|' + U.normalize(p.model), p);
        if (!byBrand.has(b)) byBrand.set(b, []);
        byBrand.get(b).push(p);
      } else noBrand.push(p);
    });
    return { ps, byCode, byBrandModel, byBrand, noBrand };
  }

  function findMatch(rec, ix) {
    ix = ix || buildIndexes(); // compat: sigue funcionando sin índices precalculados
    // 1) Código
    if (rec.code) {
      const hit = ix.byCode.get(normCode(rec.code));
      if (hit) return { product: hit, by: 'código' };
    }
    // 2) Marca + Modelo
    if (rec.brand && rec.model) {
      const b = U.normalize(rec.brand), m = U.normalize(rec.model);
      let hit = ix.byBrandModel.get(b + '|' + m);
      if (!hit) hit = (ix.byBrand.get(b) || []).find((p) => U.normalize(p.name).indexOf(m) > -1);
      if (hit) return { product: hit, by: 'marca+modelo' };
    }
    // 3) Nombre similar (con resguardo de marca: compara solo contra la misma
    //    marca y contra productos sin marca — mismo criterio que antes, pero
    //    sin recorrer todo el catálogo)
    if (rec.name) {
      const target = U.normalize(rec.name);
      const cands = rec.brand
        ? (ix.byBrand.get(U.normalize(rec.brand)) || []).concat(ix.noBrand)
        : ix.ps;
      let best = null, bs = 0;
      for (const p of cands) {
        const s = sim(target, U.normalize(p.name));
        if (s > bs) { bs = s; best = p; }
      }
      if (best && bs >= CONFIG.NAME_SIM_THRESHOLD) return { product: best, by: 'nombre' };
    }
    return null;
  }

  /* ---------- Planificación y aplicación --------------------------------- */
  // Ahora es async: cede el hilo cada 50 registros para no congelar la UI.
  async function buildPlan(records) {
    const ix = buildIndexes();
    const updates = [], creates = [], matchedIds = new Set();
    let done = 0;
    for (const rec of records) {
      if (!rec.name && !rec.code) continue;
      const match = findMatch(rec, ix);
      if (match && !matchedIds.has(match.product.id)) {
        matchedIds.add(match.product.id);
        updates.push({ existing: match.product, rec, by: match.by });
      } else if (match) {
        updates.push({ existing: match.product, rec, by: match.by }); // misma fila duplicada
      } else {
        creates.push({ rec });
      }
      if (++done % 50 === 0) await new Promise((r) => setTimeout(r)); // cede el hilo
    }
    const missing = Store.state.products.filter((p) => p.active !== false && !matchedIds.has(p.id));
    return { updates, creates, missing, records };
  }

  // Crea/resuelve categoría y subcategoría por nombre.
  // Delegado en App.IO.resolveCategory (implementación única para todo el
  // sistema; antes había 3 copias de esta lógica).
  async function resolveCat(rec) {
    return App.IO.resolveCategory(rec.categoryName, rec.subcategoryName);
  }

  async function applyPlan(plan, opts, onProgress) {
    const res = { created: 0, updated: 0, hidden: 0, noImage: 0, errors: [] };
    const total = plan.updates.length + plan.creates.length + (opts.deactivateMissing ? plan.missing.length : 0);
    let done = 0;
    const tick = () => { done++; if (total) onProgress('actualizando', 0.8 + 0.18 * (done / total)); };

    // --- Actualizar existentes (solo campos importados) ---
    for (const u of plan.updates) {
      try {
        const ex = u.existing, rec = u.rec;
        const patch = { id: ex.id, active: true };
        if (rec.code) patch.code = rec.code;
        if (rec.name) patch.name = rec.name;
        if (rec.brand) patch.brand = rec.brand;
        if (rec.model) patch.model = rec.model;
        if (rec.description) patch.description = rec.description;
        if (rec.categoryName) {
          const c = await resolveCat(rec);
          if (c.categoryId) patch.categoryId = c.categoryId;
          if (c.subcategoryId) patch.subcategoryId = c.subcategoryId;
        }
        // Regla de precios: respeta priceLock (usar_precio_manual)
        if (rec.price > 0 && !ex.priceLock) patch.price = rec.price;
        // Imágenes: por defecto NO pisa las existentes; con opts.replaceImages
        // las del archivo REEMPLAZAN a las guardadas (sirve para corregir
        // fotos mal importadas o actualizar el catálogo del proveedor).
        if (rec.images && rec.images.length && (opts.replaceImages || !ex.images || !ex.images.length)) {
          patch.images = await maybeCompress(rec.images);
        }
        // Método 3: el producto queda "sin imagen" si no tenía ni se importó ninguna
        if ((!ex.images || !ex.images.length) && !(rec.images && rec.images.length)) res.noImage++;
        await Store.saveProduct(patch);
        res.updated++;
      } catch (e) { res.errors.push('Actualizar “' + (u.existing.name) + '”: ' + (e.message || e)); }
      tick();
    }

    // --- Crear nuevos ---
    if (opts.createNew !== false) {
      for (const c of plan.creates) {
        try {
          const rec = c.rec;
          const cat = rec.categoryName ? await resolveCat(rec) : {};
          await Store.saveProduct({
            code: rec.code, name: rec.name, brand: rec.brand, model: rec.model,
            description: rec.description || rec.name,
            categoryId: cat.categoryId || '', subcategoryId: cat.subcategoryId || '',
            price: rec.price || 0, images: await maybeCompress(rec.images || []),
            active: true, isNew: true, tags: ['Nuevo'],
          });
          if (!(rec.images && rec.images.length)) res.noImage++; // Método 3
          res.created++;
        } catch (e) { res.errors.push('Crear “' + c.rec.name + '”: ' + (e.message || e)); }
        tick();
      }
    }

    // --- Marcar inactivos los ausentes (opcional) ---
    if (opts.deactivateMissing) {
      for (const p of plan.missing) {
        try { await Store.saveProduct({ id: p.id, active: false }); res.hidden++; }
        catch (e) { res.errors.push('Ocultar “' + p.name + '”: ' + (e.message || e)); }
        tick();
      }
    }
    return res;
  }

  // Las imágenes del PDF ya salen optimizadas (WebP) del motor de imágenes y las
  // de planillas son URLs http: no hace falta re-comprimir acá (evita doble trabajo).
  async function maybeCompress(images) {
    return (images || []).filter(Boolean);
  }

  /* ---------- Orquestador principal -------------------------------------- */
  async function run(file, opts = {}) {
    const onP = opts.onProgress || function () {};
    const start = Date.now();
    const summary = { created: 0, updated: 0, hidden: 0, noImage: 0, errors: [], notes: [], total: 0, durationMs: 0, applied: false, aborted: false };

    const v = validateFile(file);
    if (!v.ok) { summary.errors.push(v.reason); return summary; }

    try {
      onP('leyendo', 0.08, file.name);
      let records = [];
      if (v.ext === 'csv') {
        const text = await U.readFileAsText(file);
        onP('analizando', 0.3, 'Leyendo filas…');
        records = rowsToRecords(App.IO.parseCSV(text));
      } else if (v.ext === 'xlsx' || v.ext === 'xls') {
        records = await parseSpreadsheet(file, onP);
      } else if (v.ext === 'pdf') {
        records = await parsePdf(file, onP, opts);
      }
      if (records && records._notes) summary.notes = records._notes;

      onP('extrayendo', 0.62, records.length + ' productos detectados');
      const withImg = records.filter((r) => r.images && r.images.length).length;
      onP('imagenes', 0.68, withImg + ' con imagen');

      onP('comparando', 0.74, 'Buscando coincidencias…');
      const plan = await buildPlan(records);
      summary.total = records.length;
      summary.plan = { updates: plan.updates.length, creates: plan.creates.length, missing: plan.missing.length };

      if (!records.length) {
        summary.errors.push('No se detectaron productos en el archivo. Revisá el formato o probá con CSV/Excel.');
        summary.durationMs = Date.now() - start;
        return summary;
      }

      if (opts.confirm) {
        const ok = await opts.confirm(summary.plan);
        if (!ok) { summary.aborted = true; summary.durationMs = Date.now() - start; return summary; }
      }

      onP('actualizando', 0.8, 'Guardando cambios…');
      const res = await applyPlan(plan, opts, onP);
      summary.created = res.created; summary.updated = res.updated;
      summary.hidden = res.hidden; summary.noImage = res.noImage;
      summary.errors = summary.errors.concat(res.errors);
      if (res.noImage) summary.notes.push(res.noImage + ' producto(s) quedaron sin foto: cargá la imagen manualmente desde Productos.');
      summary.applied = true;
      onP('finalizado', 1, 'Listo');
    } catch (e) {
      summary.errors.push(e.message || String(e));
    }
    summary.durationMs = Date.now() - start;
    return summary;
  }

  App.SmartImport = { CONFIG, validateFile, run, _internal: { rowsToRecords, parseTextLine, parseAnyLine, findMatch, buildPlan } };
})(window.App = window.App || {});
