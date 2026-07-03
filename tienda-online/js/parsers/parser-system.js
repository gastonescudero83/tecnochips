/* =============================================================================
 * parser-system.js — Núcleo del sistema modular de parsers por proveedor
 * -----------------------------------------------------------------------------
 * Arquitectura (limpia, escalable, mantenible):
 *   • Strategy Pattern  → cada proveedor es una "estrategia" con match()+parse().
 *   • Factory Pattern   → getParser(file) elige automáticamente la estrategia.
 *   • Formato unificado  → TODOS los parsers devuelven exactamente:
 *        { producto, precio, stock, proveedor, codigo, fecha }
 *
 * Reglas de oro:
 *   - Agregar un proveedor = crear UN archivo nuevo en /providers que se
 *     auto-registra. No se toca el núcleo ni los otros proveedores.
 *   - Si un parser falla, se loguea y el sistema sigue con los demás archivos.
 *
 * Es un MÓDULO INDEPENDIENTE: no modifica el catálogo, la base ni el importador
 * de productos existente. Reutiliza utilidades del proyecto (App.U / App.IO).
 * ========================================================================== */
(function (App) {
  'use strict';

  /* ---------------------------------------------------------------------- *
   *  Utilidades compartidas (números, headers, lectura de archivos)
   * ---------------------------------------------------------------------- */
  const util = {
    extOf(name) { const m = /\.([a-z0-9]+)$/i.exec(name || ''); return m ? m[1].toLowerCase() : ''; },
    str(v) { return v == null ? '' : String(v).trim(); },
    norm(v) {
      return String(v == null ? '' : v).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
    },
    num(v) {
      if (typeof v === 'number') return v;
      if (App.U && App.U.parsePrice) return App.U.parsePrice(v);
      const n = parseFloat(String(v).replace(/[^\d.,-]/g, '').replace(/\.(?=\d{3})/g, '').replace(',', '.'));
      return isNaN(n) ? 0 : n;
    },
    int(v) {
      const n = parseInt(String(v).replace(/[^\d-]/g, ''), 10);
      return isNaN(n) ? 0 : n;
    },
    /** Mapea encabezados a campos por sinónimos → { campo: índice|-1 } */
    mapHeaders(headers, spec) {
      const norms = (headers || []).map(util.norm);
      const out = {};
      Object.keys(spec).forEach((field) => {
        out[field] = -1;
        for (let i = 0; i < norms.length; i++) {
          if (spec[field].some((s) => norms[i].indexOf(util.norm(s)) > -1)) { out[field] = i; break; }
        }
      });
      return out;
    },
    // ---- Lectores (reutilizan App.U; cargan librerías bajo demanda) ----
    readText(file) { return App.U.readFileAsText(file); },
    parseCSV(text) {
      return (App.IO && App.IO.parseCSV) ? App.IO.parseCSV(text) : simpleCSV(text);
    },
    async readSheet(file) {
      const XLSX = await ensureXLSX();
      const buf = await App.U.readFileAsArrayBuffer(file);
      const wb = XLSX.read(buf, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      return XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false }).map((r) => r.map((c) => (c == null ? '' : c)));
    },
    /**
     * Abre el documento PDF UNA sola vez por archivo (cache en el propio File):
     * antes se leía y parseaba el archivo dos veces (detección + parse), lo que
     * duplicaba tiempo y memoria en catálogos grandes.
     */
    async getPdfDoc(file) {
      if (file && file._pdfDocPromise) return file._pdfDocPromise;
      const p = (async () => {
        const pdfjsLib = await ensurePdf();
        const buf = await App.U.readFileAsArrayBuffer(file);
        return pdfjsLib.getDocument({ data: buf }).promise;
      })();
      try { if (file) file._pdfDocPromise = p; } catch (_e) { /* File no extensible: sin cache */ }
      return p;
    },
    /**
     * Reconstruye LÍNEAS de texto reales a partir de los fragmentos de pdf.js:
     *  - agrupa por coordenada Y (misma línea visual) con tolerancia según el
     *    tamaño de fuente, y ordena cada línea por X (izquierda→derecha);
     *  - si una línea tiene un hueco horizontal enorme (>25% del ancho) y AMBOS
     *    lados contienen un precio, se corta en dos (catálogos a 2 columnas).
     * ANTES: se aplastaba toda la página en una sola "línea" (join(' ')), y los
     * parsers por línea devolvían 1 producto basura por página.
     */
    linesFromItems(items, pageWidth) {
      const frags = [];
      (items || []).forEach((it) => {
        const s = (it.str || '').trim(); if (!s) return;
        const t = it.transform;
        const h = it.height || Math.abs(t[3]) || 8;
        frags.push({ str: s, x: t[4], y: t[5], h: h, w: it.width || s.length * h * 0.5 });
      });
      if (!frags.length) return [];
      frags.sort((a, b) => (b.y - a.y) || (a.x - b.x)); // arriba→abajo, izq→der
      const lines = [];
      let cur = null;
      frags.forEach((f) => {
        const tol = Math.max(3, f.h * 0.6);
        if (!cur || Math.abs(f.y - cur.y) > tol) { cur = { y: f.y, frags: [f] }; lines.push(cur); }
        else cur.frags.push(f);
      });
      const RE_P = /\$\s*[\d][\d.,]*|\b\d{1,3}(?:[.,]\d{3})+\b/;
      const out = [];
      // Umbral de corte de columna: hueco > 12% del ancho (mín. 40pt). Si el
      // corte fue un falso positivo (lista tabular "nombre .... precio"), la
      // regla de abajo re-une los pedazos porque el precio está en UN solo lado.
      const gapThreshold = pageWidth ? Math.max(pageWidth * 0.12, 40) : Infinity;
      lines.forEach((l) => {
        l.frags.sort((a, b) => a.x - b.x);
        const parts = [[l.frags[0]]];
        for (let i = 1; i < l.frags.length; i++) {
          const prev = l.frags[i - 1], f = l.frags[i];
          const gap = f.x - (prev.x + (prev.w || 0));
          if (gap > gapThreshold) parts.push([f]);
          else parts[parts.length - 1].push(f);
        }
        let chunks = parts.map((p) => p.map((f) => f.str).join(' ').replace(/\s+/g, ' ').trim()).filter(Boolean);
        // Solo se corta si TODOS los pedazos parecen productos con precio
        // (lista tabular "nombre .... precio" debe quedar como UNA línea).
        if (chunks.length > 1 && !chunks.every((c) => RE_P.test(c))) chunks = [chunks.join(' ')];
        chunks.forEach((c) => out.push(c));
      });
      return out;
    },
    async readPdfText(file, maxPages) {
      const pdf = await util.getPdfDoc(file);
      const pages = Math.min(pdf.numPages, maxPages || 200);
      const out = [];
      for (let n = 1; n <= pages; n++) {
        const page = await pdf.getPage(n);
        const vp = page.getViewport({ scale: 1 });
        const tc = await page.getTextContent();
        util.linesFromItems(tc.items, vp.width).forEach((l) => out.push(l));
        await new Promise((r) => setTimeout(r)); // cede el hilo
      }
      return out.join('\n');
    },
    /**
     * Lee el texto del PDF CONSERVANDO coordenadas (X,Y) normalizadas 0..1 con
     * origen arriba-izquierda. Lo usa el Motor de Mapeo Asistido. Devuelve
     * { numPages, paginas:[{ W,H, items:[{str,x,y,w,h,cx,cy}] }] }.
     */
    async readPdfItems(file, maxPages) {
      const pdf = await util.getPdfDoc(file); // reutiliza el documento cacheado
      const pages = Math.min(pdf.numPages, maxPages || 200);
      const paginas = [];
      for (let n = 1; n <= pages; n++) {
        const page = await pdf.getPage(n);
        const vp = page.getViewport({ scale: 1 });
        const W = vp.width, H = vp.height;
        const tc = await page.getTextContent();
        const items = [];
        tc.items.forEach((it) => {
          const s = (it.str || '').trim(); if (!s) return;
          const t = it.transform, x = t[4], yB = t[5];
          const h = it.height || Math.abs(t[3]) || 8;
          const w = it.width || (s.length * h * 0.5);
          const yTop = H - yB - h;
          items.push({ str: s, x: x / W, y: yTop / H, w: w / W, h: h / H, cx: (x + w / 2) / W, cy: (yTop + h / 2) / H });
        });
        paginas.push({ W, H, items });
        await new Promise((r) => setTimeout(r));
      }
      return { numPages: pdf.numPages, paginas };
    },
  };

  function simpleCSV(text) {
    return text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim() !== '')
      .map((l) => l.split(/[,;]/).map((c) => c.trim()));
  }
  function loadScript(src) {
    return new Promise((res, rej) => {
      const s = document.createElement('script'); s.src = src;
      s.onload = res; s.onerror = () => rej(new Error('No se pudo cargar ' + src + ' (requiere Internet).'));
      document.head.appendChild(s);
    });
  }
  let _xlsx, _pdf;
  function ensureXLSX() {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    if (!_xlsx) _xlsx = loadScript('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js').then(() => window.XLSX);
    return _xlsx;
  }
  function ensurePdf() {
    if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
    if (!_pdf) _pdf = loadScript('https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js').then(() => {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
      return window.pdfjsLib;
    });
    return _pdf;
  }

  /* ---------------------------------------------------------------------- *
   *  Logger (no rompe el flujo; sólo registra)
   * ---------------------------------------------------------------------- */
  const _log = [];
  const logger = {
    entry(level, message, meta) { const e = { level, message, meta: meta || null, at: new Date().toISOString() }; _log.push(e); return e; },
    info(m, x) { this.entry('info', m, x); console.info('[Parsers] ' + m, x || ''); },
    warn(m, x) { this.entry('warn', m, x); console.warn('[Parsers] ' + m, x || ''); },
    error(m, x) { this.entry('error', m, x); console.error('[Parsers] ' + m, x || ''); },
    get() { return _log.slice(); },
    clear() { _log.length = 0; },
  };

  /* ---------------------------------------------------------------------- *
   *  Interfaz base (contrato obligatorio para TODOS los parsers)
   *    - provider: string (nombre del proveedor)
   *    - supports: array de extensiones que entiende (['xlsx','csv'] | ['pdf'])
   *    - match(ctx): number 0..1  → confianza de que este parser corresponde
   *    - parse(file, ctx): Array  → registros (formato unificado)
   * ---------------------------------------------------------------------- */
  function BaseParser(spec) {
    if (!spec || !spec.id || !spec.provider) throw new Error('Parser inválido: requiere id y provider.');
    if (typeof spec.parse !== 'function') throw new Error('El parser "' + spec.id + '" debe implementar parse(file).');
    this.id = spec.id;
    this.provider = spec.provider;
    this.supports = (spec.supports || []).map((s) => s.toLowerCase());
    this._match = spec.match || function () { return 0; };
    this._parse = spec.parse;
  }
  BaseParser.prototype.match = function (ctx) {
    // Resguardo: si declara extensiones y no coinciden, descarta de entrada.
    if (this.supports.length && this.supports.indexOf(ctx.ext) < 0 &&
        !(this.supports.indexOf('spreadsheet') > -1 && ctx.kind === 'spreadsheet')) return 0;
    try { return Math.max(0, Math.min(1, Number(this._match(ctx, util)) || 0)); }
    catch (e) { logger.warn('match() falló en ' + this.id, e.message); return 0; }
  };
  BaseParser.prototype.parse = function (file, ctx) { return this._parse(file, ctx, util); };

  /* ---------------------------------------------------------------------- *
   *  Registro de parsers (Factory)
   * ---------------------------------------------------------------------- */
  const registry = [];
  function define(spec) {
    const p = new BaseParser(spec);
    if (registry.some((x) => x.id === p.id)) { logger.warn('Parser duplicado ignorado: ' + p.id); return p; }
    registry.push(p);
    logger.info('Proveedor registrado: ' + p.provider + ' (' + p.id + ')');
    return p;
  }
  function list() { return registry.slice(); }

  /* ---------------------------------------------------------------------- *
   *  Contexto: se lee el archivo UNA vez y se reparte a match()/parse()
   * ---------------------------------------------------------------------- */
  async function buildContext(file) {
    const name = file.name || '', ext = util.extOf(name), mime = file.type || '';
    const ctx = { file, name, ext, mime, kind: 'unknown', rows: [], headers: [], headerNorm: [], text: '', keywords: '' };
    try {
      if (ext === 'csv') { ctx.kind = 'spreadsheet'; ctx.rows = util.parseCSV(await util.readText(file)); }
      else if (ext === 'xlsx' || ext === 'xls') { ctx.kind = 'spreadsheet'; ctx.rows = await util.readSheet(file); }
      else if (ext === 'pdf') { ctx.kind = 'pdf'; ctx.text = await util.readPdfText(file, 5); } // 5 págs para detectar
      else { ctx.text = await util.readText(file).catch(() => ''); ctx.kind = ctx.text ? 'text' : 'unknown'; }
    } catch (e) { logger.warn('No se pudo leer "' + name + '" para detección: ' + e.message); }
    if (ctx.rows.length) { ctx.headers = (ctx.rows[0] || []).map((c) => util.str(c)); ctx.headerNorm = ctx.headers.map(util.norm); }
    ctx.keywords = util.norm((ctx.headerNorm.join(' ') + ' ' + (ctx.text || '')).slice(0, 6000));
    return ctx;
  }

  /* ---------------------------------------------------------------------- *
   *  Router / Factory: elige el parser de mayor confianza
   * ---------------------------------------------------------------------- */
  function pickParser(ctx) {
    let best = null, bestScore = 0;
    registry.forEach((p) => {
      const score = p.match(ctx);
      if (score > bestScore) { bestScore = score; best = p; }
    });
    return bestScore > 0 ? { parser: best, score: bestScore } : null;
  }

  /** getParser(file) -> Parser (o null si ningún proveedor coincide). */
  async function getParser(file) {
    const ctx = (file && file.kind) ? file : await buildContext(file); // acepta File o ctx
    const picked = pickParser(ctx);
    return picked ? picked.parser : null;
  }

  /** Busca un parser por id o por nombre de proveedor (para selección manual). */
  function getByProvider(idOrName) {
    const key = util.norm(idOrName);
    return registry.find((p) => util.norm(p.id) === key || util.norm(p.provider) === key) || null;
  }

  /* ---------------------------------------------------------------------- *
   *  Normalización: garantiza el formato unificado EXACTO
   * ---------------------------------------------------------------------- */
  function normalizeRecord(raw, provider) {
    // "nombre" y "producto" son sinónimos: aceptamos cualquiera y rellenamos ambos.
    const nombre = util.str(raw.nombre || raw.producto);
    // imagenes SIEMPRE como array de strings (URLs/refs), aunque venga vacío o suelto.
    let imagenes = raw.imagenes != null ? raw.imagenes : raw.imagen;
    if (!Array.isArray(imagenes)) imagenes = imagenes ? [imagenes] : [];
    imagenes = imagenes.map(util.str).filter(Boolean);
    return {
      // ---- Formato base original (compatibilidad hacia atrás: NO se quita nada) ----
      producto: nombre,
      precio: util.num(raw.precio),
      stock: util.int(raw.stock),
      proveedor: util.str(raw.proveedor || provider),
      codigo: raw.codigo != null ? util.str(raw.codigo) : '',
      fecha: raw.fecha ? util.str(raw.fecha) : new Date().toISOString(),
      // ---- Campos extendidos (aditivos) para catálogos ricos ----
      nombre: nombre,
      marca: util.str(raw.marca),
      modelo: util.str(raw.modelo),
      descripcion: util.str(raw.descripcion),
      categoria: util.str(raw.categoria),
      imagenes: imagenes,
      estado: util.str(raw.estado) || 'activo',
    };
  }

  /* ---------------------------------------------------------------------- *
   *  Runner: procesa 1 archivo (con manejo de errores aislado)
   * ---------------------------------------------------------------------- */
  async function process(file, opts) {
    opts = opts || {};
    const name = (file && file.name) || 'archivo';
    const t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    const ms = () => Math.round(((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now()) - t0);

    let ctx;
    try { ctx = await buildContext(file); }
    catch (e) { logger.error('Error leyendo "' + name + '": ' + e.message); return { ok: false, file: name, reason: 'read-error', error: e.message, records: [], tiempoMs: ms() }; }

    // Propaga al parser: callback de progreso por página y opciones de mapeo.
    if (opts.onPage) ctx._onPage = opts.onPage;
    if (opts.mapeoOpts) ctx._mapeoOpts = opts.mapeoOpts;

    // Selección MANUAL de proveedor (cuando la detección automática no alcanza).
    let parser = null, score = 0, modo = 'auto';
    if (opts.provider) {
      parser = getByProvider(opts.provider);
      if (!parser) {
        logger.warn('Proveedor manual no encontrado: "' + opts.provider + '".');
        return { ok: false, file: name, reason: 'unknown-provider', error: 'Proveedor "' + opts.provider + '" no registrado.', records: [], tiempoMs: ms() };
      }
      score = 1; modo = 'manual';
    } else {
      const picked = pickParser(ctx);
      if (!picked) {
        // ---- RESPALDO: si el router no reconoce el archivo, deriva al
        //      Motor de Mapeo Geométrico Asistido (offline, sin IA de pago).
        const asistido = getByProvider('prov_mapeo_asistido') || getByProvider('Mapeo Asistido');
        if (asistido && (ctx.kind === 'pdf')) {
          logger.info('Archivo no reconocido → derivado al Mapeo Asistido: "' + name + '".');
          parser = asistido; score = 0.1; modo = 'asistido';
        } else {
          logger.warn('Proveedor no compatible: "' + name + '" (ningún parser lo reconoce).');
          return { ok: false, file: name, reason: 'no-parser', error: 'Proveedor no compatible. Seleccione uno manualmente.', records: [], tiempoMs: ms(), proveedoresDisponibles: registry.map((p) => p.provider) };
        }
      } else {
        parser = picked.parser; score = picked.score;
      }
    }

    try {
      const raw = await parser.parse(file, ctx);
      const records = (Array.isArray(raw) ? raw : [])
        .map((r) => normalizeRecord(r, parser.provider))
        .filter((r) => r.producto);
      const imagenes = records.reduce((acc, r) => acc + (r.imagenes ? r.imagenes.length : 0), 0);
      const tiempoMs = ms();
      // ---- Registro de la importación (lo que pide la etapa) ----
      const report = {
        ok: true, file: name,
        provider: parser.provider,     // Proveedor detectado
        parserId: parser.id,           // Parser utilizado
        modo: modo,                    // 'auto' | 'manual'
        score: score,                  // Confianza de la detección
        tiempoMs: tiempoMs,            // Tiempo de procesamiento (ms)
        productos: records.length,     // Cantidad de productos
        imagenes: imagenes,            // Cantidad de imágenes extraídas
        errores: 0,                    // Errores encontrados
        records: records,
      };
      logger.info('"' + name + '" → ' + parser.provider + ' [' + modo + ']: ' + records.length +
        ' productos, ' + imagenes + ' imgs, ' + tiempoMs + 'ms (confianza ' + score.toFixed(2) + ').');
      return report;
    } catch (e) {
      // Caso especial: el Mapeo Asistido pide configuración visual (proveedor nuevo).
      if (e && e.requiereConfiguracion) {
        logger.warn('"' + name + '" requiere mapeo visual inicial (proveedor nuevo).');
        return {
          ok: false, file: name, provider: parser.provider, parserId: parser.id,
          modo: 'asistido', reason: 'requiere-configuracion',
          requiereConfiguracion: e.requiereConfiguracion,
          records: [], productos: 0, imagenes: 0, errores: 0, tiempoMs: ms(),
        };
      }
      // Un parser que falla NO rompe el sistema.
      logger.error('Parser "' + parser.id + '" falló con "' + name + '": ' + (e.message || e), e.stack);
      return { ok: false, file: name, provider: parser.provider, parserId: parser.id, reason: 'parse-error', error: e.message || String(e), records: [], tiempoMs: ms(), errores: 1 };
    }
  }

  /* ---------------------------------------------------------------------- *
   *  Runner masivo: procesa N archivos; continúa aunque alguno falle
   * ---------------------------------------------------------------------- */
  async function processAll(files, opts) {
    opts = opts || {};
    const arr = Array.prototype.slice.call(files || []);
    const results = [];
    const t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    const total = arr.length;

    // Soporte de barra de progreso en segundo plano:
    //   opts.onProgress({ fase, indice, total, porcentaje, archivo, ultimoReporte })
    const notify = (fase, i, extra) => {
      if (typeof opts.onProgress !== 'function') return;
      try {
        opts.onProgress(Object.assign({
          fase: fase,                                   // 'archivo' | 'fin'
          indice: i, total: total,
          porcentaje: total ? Math.round((i / total) * 100) : 100,
          archivo: arr[i] && arr[i].name,
        }, extra || {}));
      } catch (_e) { /* la UI no debe romper el proceso */ }
    };

    // opts.provider fuerza el mismo proveedor para todos; opts.providers[i] por archivo.
    for (let i = 0; i < total; i++) {
      notify('archivo', i, { estado: 'procesando' });
      const base = (opts.providers && opts.providers[i]) ? { provider: opts.providers[i] }
                 : (opts.provider ? { provider: opts.provider } : {});
      // Progreso por página (PDFs grandes) propagado al motor asistido.
      base.onPage = (n, totPag) => notify('archivo', i, { estado: 'pagina', pagina: n, totalPaginas: totPag });
      if (opts.mapeoOpts) base.mapeoOpts = opts.mapeoOpts;

      const rep = await process(arr[i], base); // secuencial y aislado
      results.push(rep);
      notify('archivo', i + 1, { estado: 'listo', ultimoReporte: rep });
    }

    const tiempoTotalMs = Math.round(((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now()) - t0);

    // ---- RESUMEN FINAL (estadísticas solicitadas en la etapa) ----------------
    const okRes = results.filter((r) => r.ok);
    const detectados = results.reduce((a, r) => a + (r.productos || r.records.length || 0), 0);
    const creados = results.reduce((a, r) => a + r.records.length, 0); // normalizados/válidos
    const requierenConfig = results.filter((r) => r.requiereConfiguracion);
    const summary = {
      archivos: total,
      archivosOk: okRes.length,
      archivosFallidos: results.filter((r) => !r.ok && !r.requiereConfiguracion).length,
      productosDetectados: detectados,           // total que el parser encontró
      productosCreados: creados,                  // pasaron la normalización (válidos)
      productosOmitidos: Math.max(0, detectados - creados), // descartados (sin nombre/precio)
      imagenes: results.reduce((a, r) => a + (r.imagenes || 0), 0),
      errores: results.reduce((a, r) => a + (r.errores || 0), 0),
      requierenConfiguracion: requierenConfig.length,
      pendientesMapeo: requierenConfig.map((r) => ({ archivo: r.file, aviso: r.requiereConfiguracion })),
      proveedoresUsados: Array.from(new Set(okRes.map((r) => r.provider).filter(Boolean))),
      tiempoTotalMs: tiempoTotalMs,
      tiempoTotal: (tiempoTotalMs / 1000).toFixed(2) + ' s',
      // compatibilidad hacia atrás (nombres previos)
      processed: results.length,
      ok: okRes.length,
      failed: results.filter((r) => !r.ok).length,
      records: creados,
      productos: detectados,
      tiempoMs: tiempoTotalMs,
    };
    notify('fin', total, { resumen: summary });
    return { results, summary, log: logger.get() };
  }

  /* ---------------------------------------------------------------------- */
  App.Parsers = {
    util, logger, BaseParser, define, list,
    buildContext, getParser, getByProvider, pickParser, normalizeRecord,
    process, processAll,
  };
})(window.App = window.App || {});
