/* =============================================================================
 * prov_mapeo_asistido.js — Motor de Mapeo Geométrico Asistido (100% OFFLINE)
 * -----------------------------------------------------------------------------
 * Módulo de RESPALDO para proveedores NUEVOS / no reconocidos por el router.
 * NO usa ninguna IA de pago (sin Claude API, sin OpenAI, sin servidores). Todo
 * el procesamiento (texto, coordenadas, recorte de imágenes y aprendizaje del
 * patrón) ocurre en el navegador con pdfjs-dist + canvas.
 *
 * Flujo:
 *   1) Llega un PDF desconocido. Se extrae texto con coordenadas (X,Y) e imágenes
 *      con su bounding-box usando pdfjs.
 *   2) Si NO existe un patrón guardado para ese proveedor →
 *      devuelve { requiereConfiguracion: true, muestra: {...} } para que el
 *      frontend deje al usuario mapear visualmente (clics: nombre/precio/imagen).
 *   3) El usuario mapea UNA vez. Llamando a App.MapeoAsistido.aprender(...) se
 *      calculan reglas de proximidad y se guardan en IndexedDB (KV).
 *   4) Para las páginas restantes y futuras importaciones de ese proveedor, el
 *      algoritmo aplica las reglas guardadas (offline) y normaliza al formato:
 *      codigo, nombre, marca, modelo, descripcion, categoria, precio, imagenes, activo.
 *
 * Convenciones:
 *   - Patrón global window.App, Vanilla JS, sin frameworks.
 *   - Coordenadas SIEMPRE normalizadas 0..1 (relativas a la página) → resisten
 *     cambios de tamaño/resolución entre páginas y archivos.
 * ========================================================================== */
(function (App) {
  'use strict';

  const KV_PATRONES = 'mapeo_patrones'; // clave en el store KV (IndexedDB)

  /* ---------------------------------------------------------------------- *
   *  Cache sincrónica de patrones (match() del router es síncrono)
   * ---------------------------------------------------------------------- */
  // { [fingerprint]: patron }
  let _patrones = null;          // null = aún no cargado de IndexedDB
  let _cargando = null;

  function cargarPatrones() {
    if (_patrones) return Promise.resolve(_patrones);
    if (_cargando) return _cargando;
    _cargando = (App.DB ? App.DB.kvGet(KV_PATRONES) : Promise.resolve(null))
      .then((p) => { _patrones = (p && typeof p === 'object') ? p : {}; return _patrones; })
      .catch(() => { _patrones = {}; return _patrones; });
    return _cargando;
  }
  function guardarPatrones() {
    if (!App.DB) return Promise.resolve();
    return App.DB.kvSet(KV_PATRONES, _patrones || {});
  }
  // Acceso síncrono (puede devolver null si todavía no precargó)
  function patronesSync() { return _patrones; }

  /* ---------------------------------------------------------------------- *
   *  Carga de pdfjs (reutiliza el que ya dejó cargado parser-system)
   * ---------------------------------------------------------------------- */
  function loadScript(src) {
    return new Promise((res, rej) => {
      const s = document.createElement('script'); s.src = src;
      s.onload = res; s.onerror = () => rej(new Error('No se pudo cargar ' + src));
      document.head.appendChild(s);
    });
  }
  let _pdfP;
  function ensurePdf() {
    if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
    if (!_pdfP) _pdfP = loadScript('https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js').then(() => {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
      return window.pdfjsLib;
    });
    return _pdfP;
  }

  /* ---------------------------------------------------------------------- *
   *  Extracción de página: items de texto (con bbox) + imágenes (con bbox)
   *  Devuelve coordenadas con origen ARRIBA-IZQUIERDA, normalizadas 0..1.
   * ---------------------------------------------------------------------- */
  async function extraerPagina(pdfPage, opts) {
    opts = opts || {};
    const viewport = pdfPage.getViewport({ scale: 1 });
    const W = viewport.width, H = viewport.height;

    // ---- Texto con coordenadas ----
    const tc = await pdfPage.getTextContent();
    const textos = [];
    tc.items.forEach((it) => {
      const s = (it.str || '').trim();
      if (!s) return;
      const t = it.transform; // [a,b,c,d,e,f]  e=x, f=y (origen abajo-izq)
      const x = t[4], yBottom = t[5];
      const h = it.height || Math.abs(t[3]) || 8;
      const w = it.width || (s.length * (h * 0.5));
      const yTop = H - yBottom - h; // a origen arriba-izq
      textos.push({
        str: s,
        x: x / W, y: yTop / H, w: w / W, h: h / H,
        cx: (x + w / 2) / W, cy: (yTop + h / 2) / H,
      });
    });

    // ---- Imágenes con bounding-box (operator list) ----
    const imagenes = [];
    try {
      const opList = await pdfPage.getOperatorList();
      const OPS = window.pdfjsLib.OPS;
      const stack = [[1, 0, 0, 1, 0, 0]]; // matrices de transformación
      const mul = (m1, m2) => [
        m1[0] * m2[0] + m1[2] * m2[1],
        m1[1] * m2[0] + m1[3] * m2[1],
        m1[0] * m2[2] + m1[2] * m2[3],
        m1[1] * m2[2] + m1[3] * m2[3],
        m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
        m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
      ];
      let ctm = stack[0];
      for (let i = 0; i < opList.fnArray.length; i++) {
        const fn = opList.fnArray[i], args = opList.argsArray[i];
        if (fn === OPS.save) { stack.push(ctm.slice()); }
        else if (fn === OPS.restore) { ctm = stack.pop() || [1, 0, 0, 1, 0, 0]; }
        else if (fn === OPS.transform) { ctm = mul(ctm, args); }
        else if (fn === OPS.paintFormXObjectBegin) {
          // Los Form XObjects aplican su propia matriz: sin esto, las fotos
          // dibujadas dentro de un "form" quedaban con coordenadas erróneas
          // (o directamente fuera de la página) y no se recortaban.
          stack.push(ctm.slice());
          if (args && args[0] && args[0].length === 6) ctm = mul(ctm, args[0]);
        }
        else if (fn === OPS.paintFormXObjectEnd) { ctm = stack.pop() || [1, 0, 0, 1, 0, 0]; }
        else if (fn === OPS.paintImageXObject || fn === OPS.paintJpegXObject || fn === OPS.paintImageXObjectRepeat) {
          // El XObject de imagen ocupa el cuadrado unitario transformado por ctm.
          const pts = [[0, 0], [1, 0], [0, 1], [1, 1]].map((p) => [
            ctm[0] * p[0] + ctm[2] * p[1] + ctm[4],
            ctm[1] * p[0] + ctm[3] * p[1] + ctm[5],
          ]);
          const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
          const x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs);
          const yb0 = Math.min.apply(null, ys), yb1 = Math.max.apply(null, ys);
          const wpx = x1 - x0, hpx = yb1 - yb0;
          if (wpx < 8 || hpx < 8) continue; // descarta micro-imágenes (íconos/líneas)
          const yTop = H - yb1;
          imagenes.push({
            x: x0 / W, y: yTop / H, w: wpx / W, h: hpx / H,
            cx: (x0 + wpx / 2) / W, cy: (yTop + hpx / 2) / H,
            px: { x: x0, y: yTop, w: wpx, h: hpx },
            // Nombre del XObject: el mismo nombre pintado 2+ veces en una
            // página delata sellos/adornos repetidos ("ÚLTIMA UNIDAD").
            name: typeof args[0] === 'string' ? args[0] : '',
          });
        }
      }
    } catch (e) { /* algunos PDFs no exponen operatorList; seguimos sin imágenes */ }

    return { W, H, textos, imagenes };
  }

  /** Renderiza la página a un canvas (para recortar imágenes) — bajo demanda. */
  async function renderCanvas(pdfPage, scale) {
    const viewport = pdfPage.getViewport({ scale: scale || 2 });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext('2d');
    await pdfPage.render({ canvasContext: ctx, viewport }).promise;
    return { canvas, scale: scale || 2, W: viewport.width / (scale || 2), H: viewport.height / (scale || 2) };
  }

  /** Recorta una zona (normalizada 0..1) del canvas → data URL comprimido. */
  async function recortar(render, zonaNorm) {
    const { canvas, scale, W, H } = render;
    const sx = Math.max(0, zonaNorm.x * W * scale);
    const sy = Math.max(0, zonaNorm.y * H * scale);
    const sw = Math.min(canvas.width - sx, zonaNorm.w * W * scale);
    const sh = Math.min(canvas.height - sy, zonaNorm.h * H * scale);
    if (sw < 4 || sh < 4) return '';
    const c = document.createElement('canvas');
    c.width = Math.round(sw); c.height = Math.round(sh);
    c.getContext('2d').drawImage(canvas, sx, sy, sw, sh, 0, 0, c.width, c.height);
    const dataUrl = c.toDataURL('image/jpeg', 0.85);
    if (App.Images && App.Images.compress) {
      try { return await App.Images.compress(dataUrl); } catch (_e) { /* usa el crudo */ }
    }
    return dataUrl;
  }

  /* ---------------------------------------------------------------------- *
   *  Huella (fingerprint) del proveedor: identifica el layout para reusar patrón
   * ---------------------------------------------------------------------- */
  function fingerprint(muestra) {
    // Tokens estables de la cabecera (primeras líneas) + relación de aspecto.
    const top = (muestra.textos || [])
      .filter((t) => t.y < 0.18)
      .sort((a, b) => a.x - b.x)
      .map((t) => t.str).join(' ')
      .toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[0-9$.,]/g, '').replace(/\s+/g, ' ').trim().slice(0, 80);
    const aspecto = Math.round((muestra.W / muestra.H) * 100) / 100;
    let h = 0; const base = top + '|' + aspecto;
    for (let i = 0; i < base.length; i++) { h = ((h << 5) - h + base.charCodeAt(i)) | 0; }
    return 'fp_' + (h >>> 0).toString(36);
  }

  /** Normaliza un texto de cabecera para comparar proveedores (sin números,
   *  acentos ni signos). Se guarda junto al patrón para que match() pueda
   *  verificar si un PDF nuevo es realmente de ese proveedor. */
  function normCabecera(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[0-9$.,;:()\/\-]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
  }
  function cabeceraDeMuestra(muestra) {
    if (!muestra || !muestra.textos) return '';
    return normCabecera(muestra.textos.filter((t) => t.y < 0.18)
      .sort((a, b) => a.x - b.x).map((t) => t.str).join(' '));
  }

  /* ---------------------------------------------------------------------- *
   *  Utilidades de geometría / texto
   * ---------------------------------------------------------------------- */
  function dist(a, b) { const dx = a.cx - b.cx, dy = a.cy - b.cy; return Math.sqrt(dx * dx + dy * dy); }
  function dentro(t, zona, margen) {
    margen = margen || 0;
    return t.cx >= zona.x - margen && t.cx <= zona.x + zona.w + margen &&
           t.cy >= zona.y - margen && t.cy <= zona.y + zona.h + margen;
  }
  function parsePrecio(s) {
    if (App.U && App.U.parsePrice) return App.U.parsePrice(s);
    const n = parseFloat(String(s).replace(/[^\d.,-]/g, '').replace(/\.(?=\d{3})/g, '').replace(',', '.'));
    return isNaN(n) ? 0 : n;
  }
  function buscaPrecio(str) {
    let m, best = null;
    const re = /\$?\s*(\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{2})?|\d+(?:[.,]\d{2})?)/g;
    while ((m = re.exec(str))) { const v = parsePrecio(m[1]); if (v > best?.v || best == null) best = { v, raw: m[0] }; }
    return best && best.v > 0 ? best.v : 0;
  }

  /* ---------------------------------------------------------------------- *
   *  APRENDIZAJE: a partir del mapeo visual del usuario calcula el patrón
   *  mapeoUsuario = { nombre:{x,y,w,h}, precio:{...}, imagen:{...},
   *                   codigo?, marca?, modelo?, descripcion?, categoria? }
   *  (todas las zonas en coords normalizadas 0..1 de la página de muestra)
   * ---------------------------------------------------------------------- */
  async function aprender(proveedor, fp, mapeoUsuario, muestra) {
    await cargarPatrones();
    const zonas = {};
    ['codigo', 'nombre', 'marca', 'modelo', 'descripcion', 'categoria', 'precio', 'imagen']
      .forEach((campo) => { if (mapeoUsuario[campo]) zonas[campo] = normZona(mapeoUsuario[campo]); });

    // Reglas de proximidad: vector imagen→nombre y imagen→precio (offset relativo).
    const reglas = {};
    if (zonas.imagen && zonas.nombre) reglas.imgANombre = vector(zonas.imagen, zonas.nombre);
    if (zonas.imagen && zonas.precio) reglas.imgAPrecio = vector(zonas.imagen, zonas.precio);
    // Tamaño típico de bloque-producto (para segmentar la grilla).
    const bloqueW = Math.max.apply(null, Object.values(zonas).map((z) => z.x + z.w)) -
                    Math.min.apply(null, Object.values(zonas).map((z) => z.x));
    const bloqueH = Math.max.apply(null, Object.values(zonas).map((z) => z.y + z.h)) -
                    Math.min.apply(null, Object.values(zonas).map((z) => z.y));

    const patron = {
      proveedor: proveedor || 'Proveedor Asistido',
      fingerprint: fp,
      cabecera: cabeceraDeMuestra(muestra), // para que match() reconozca al proveedor
      version: 1,
      creado: new Date().toISOString(),
      pagina: { w: muestra ? muestra.W : 0, h: muestra ? muestra.H : 0 },
      zonas: zonas,
      reglas: reglas,
      bloque: { w: bloqueW || 0.33, h: bloqueH || 0.33 },
      // Si el usuario marcó una imagen, asumimos catálogo "por bloques" (con fotos).
      modo: zonas.imagen ? 'bloques' : 'columnas',
    };
    _patrones[fp] = patron;
    await guardarPatrones();
    return patron;
  }
  function normZona(z) {
    return { x: +z.x || 0, y: +z.y || 0, w: +z.w || 0.1, h: +z.h || 0.05 };
  }
  function vector(a, b) { return { dx: b.x - a.x, dy: b.y - a.y, w: b.w, h: b.h }; }

  /* ---------------------------------------------------------------------- *
   *  APLICACIÓN: usa el patrón guardado para extraer productos de una página
   * ---------------------------------------------------------------------- */
  async function aplicarPatron(pdfPage, patron, opts) {
    opts = opts || {};
    const pag = await extraerPagina(pdfPage);
    const productos = [];

    if (patron.modo === 'bloques' && pag.imagenes.length) {
      // Cada imagen "ancla" un producto. El texto cercano se asigna por proximidad.
      // Se filtran el FONDO de página, las tiras decorativas y los sellos
      // repetidos/superpuestos (ej. "ÚLTIMA UNIDAD"): no son fotos de producto
      // y creaban productos fantasma con la imagen equivocada.
      const anclas = (App.MotorGeometrico && App.MotorGeometrico.filtrarFotos)
        ? App.MotorGeometrico.filtrarFotos(pag.imagenes)
        : pag.imagenes;
      let render = null;
      for (let k = 0; k < anclas.length; k++) {
        const img = anclas[k];
        const prod = { proveedor: patron.proveedor, imagenes: [] };

        // Zonas esperadas alrededor de esta imagen (según reglas aprendidas).
        const zonaNombre = proyectar(img, patron.reglas.imgANombre, patron.zonas.nombre);
        const zonaPrecio = proyectar(img, patron.reglas.imgAPrecio, patron.zonas.precio);

        prod.nombre = textoEnZona(pag.textos, zonaNombre, 0.04);
        const precioTxt = textoEnZona(pag.textos, zonaPrecio, 0.04) ||
                          textoCercano(pag.textos, img, /[\d.,]{3,}/);
        prod.precio = buscaPrecio(precioTxt);

        // Campos extra opcionales por proximidad relativa
        ['codigo', 'marca', 'modelo', 'descripcion', 'categoria'].forEach((c) => {
          if (patron.zonas[c]) {
            const z = proyectar(img, vector(patron.zonas.imagen, patron.zonas[c]), patron.zonas[c]);
            prod[c] = textoEnZona(pag.textos, z, 0.03);
          }
        });

        // Recorte de la imagen (offline) si se pidió incluir fotos.
        if (opts.recortarImagenes !== false) {
          if (!render) render = await renderCanvas(pdfPage, opts.scale || 2);
          const dataUrl = await recortar(render, img);
          if (dataUrl) prod.imagenes.push(dataUrl);
        }

        if (prod.nombre || prod.precio > 0) productos.push(prod);
      }
    } else {
      // Modo "columnas": agrupamos por filas (misma Y) y leemos columnas por zona X.
      const filas = agruparFilas(pag.textos);
      filas.forEach((fila) => {
        const prod = { proveedor: patron.proveedor, imagenes: [] };
        prod.nombre = textoColumna(fila, patron.zonas.nombre);
        prod.precio = buscaPrecio(textoColumna(fila, patron.zonas.precio) || fila.map((t) => t.str).join(' '));
        ['codigo', 'marca', 'modelo', 'descripcion', 'categoria'].forEach((c) => {
          if (patron.zonas[c]) prod[c] = textoColumna(fila, patron.zonas[c]);
        });
        if (prod.nombre && prod.precio > 0) productos.push(prod);
      });
    }
    return productos;
  }

  /* ---------------------------------------------------------------------- *
   *  MOTOR GEOMÉTRICO (sectores) — usa App.MotorGeometrico (reutilizable)
   *  Activado cuando el patrón tiene `geo` (config de distribución detectada).
   * ---------------------------------------------------------------------- */
  const KV_GEO = 'mapeo_geo_config'; // { [fingerprint]: { tipoDistribucion, productosPorPagina, estrategia, parametros } }
  let _geoCfg = null;

  function cargarGeo() {
    if (_geoCfg) return Promise.resolve(_geoCfg);
    return (App.DB ? App.DB.kvGet(KV_GEO) : Promise.resolve(null))
      .then((g) => { _geoCfg = (g && typeof g === 'object') ? g : {}; return _geoCfg; })
      .catch(() => { _geoCfg = {}; return _geoCfg; });
  }
  function guardarGeo() {
    if (!App.DB) return Promise.resolve();
    return App.DB.kvSet(KV_GEO, _geoCfg || {});
  }

  /** Muestrea hasta `max` páginas para detectar repetidos y distribución. */
  async function muestrearPaginas(pdf, max) {
    const total = pdf.numPages;
    const n = Math.min(max || 6, total);
    const idxs = [];
    for (let i = 0; i < n; i++) idxs.push(1 + Math.floor(i * (total - 1) / Math.max(1, n - 1)));
    const muestras = [];
    for (const i of Array.from(new Set(idxs))) {
      const pg = await pdf.getPage(i);
      muestras.push(await extraerPagina(pg));
    }
    return muestras;
  }

  /** Aplica el motor geométrico a una página y recorta la imagen principal. */
  async function aplicarGeometrico(pdfPage, geo, proveedor, opts) {
    opts = opts || {};
    const MG = App.MotorGeometrico;
    const pag = await extraerPagina(pdfPage);
    const repetidos = (geo.parametros && geo.parametros.repetidos) || [];
    const config = geo.parametros || {};
    const crudos = MG.procesarPagina(pag, config, repetidos);

    const productos = [];
    let render = null;
    for (const c of crudos) {
      const prod = {
        proveedor: proveedor,
        nombre: c.nombre || '',
        modelo: c.modelo || '',
        descripcion: c.descripcion || '',
        precio: c.precio || 0,
        imagenes: [],
      };
      if (c._img && opts.recortarImagenes !== false) {
        if (!render) render = await renderCanvas(pdfPage, opts.scale || 2);
        const dataUrl = await recortar(render, c._img);
        if (dataUrl) prod.imagenes.push(dataUrl);
      }
      if (prod.nombre || prod.imagenes.length) productos.push(prod);
    }
    return productos;
  }

  function proyectar(img, vec, fallback) {
    if (!vec) return fallback || { x: img.x, y: img.y, w: 0.25, h: 0.06 };
    return { x: img.x + vec.dx, y: img.y + vec.dy, w: vec.w, h: vec.h };
  }
  function textoEnZona(textos, zona, margen) {
    return textos.filter((t) => dentro(t, zona, margen))
      .sort((a, b) => (a.y - b.y) || (a.x - b.x))
      .map((t) => t.str).join(' ').replace(/\s+/g, ' ').trim();
  }
  function textoCercano(textos, ancla, regex) {
    const cand = textos.filter((t) => regex.test(t.str))
      .map((t) => ({ t, d: dist(t, ancla) })).sort((a, b) => a.d - b.d);
    return cand.length ? cand[0].t.str : '';
  }
  function agruparFilas(textos) {
    const orden = textos.slice().sort((a, b) => a.cy - b.cy);
    const filas = []; let actual = null;
    orden.forEach((t) => {
      if (!actual || Math.abs(t.cy - actual.cy) > 0.012) { actual = { cy: t.cy, items: [] }; filas.push(actual); }
      actual.items.push(t);
    });
    return filas.map((f) => f.items.sort((a, b) => a.cx - b.cx));
  }
  function textoColumna(fila, zona) {
    if (!zona) return '';
    return fila.filter((t) => t.cx >= zona.x - 0.02 && t.cx <= zona.x + zona.w + 0.02)
      .map((t) => t.str).join(' ').replace(/\s+/g, ' ').trim();
  }

  /* ---------------------------------------------------------------------- *
   *  API pública del motor (la usa el frontend para el mapeo visual)
   * ---------------------------------------------------------------------- */
  const Motor = {
    KV_PATRONES,
    cargarPatrones, guardarPatrones, patronesSync,
    extraerPagina, renderCanvas, recortar, ensurePdf,
    fingerprint, aprender, aplicarPatron,
    // Devuelve la muestra (texto+coords+imgs) de la página `n` para el mapeo visual.
    async muestra(file, n) {
      await ensurePdf();
      // Reutiliza el documento cacheado si el sistema de parsers está presente.
      const pdf = (App.Parsers && App.Parsers.util && App.Parsers.util.getPdfDoc)
        ? await App.Parsers.util.getPdfDoc(file)
        : await window.pdfjsLib.getDocument({ data: await App.U.readFileAsArrayBuffer(file) }).promise;
      const page = await pdf.getPage(Math.min(n || 1, pdf.numPages));
      const data = await extraerPagina(page);
      data.numPages = pdf.numPages;
      data.fingerprint = fingerprint(data);
      return data;
    },
    // ¿Hay patrón guardado para este archivo? (precarga IndexedDB)
    async tienePatron(file) {
      await cargarPatrones();
      const m = await Motor.muestra(file, 1);
      return _patrones[m.fingerprint] ? m.fingerprint : null;
    },
    // Borra un patrón aprendido (re-mapear desde cero).
    async olvidar(fp) { await cargarPatrones(); delete _patrones[fp]; return guardarPatrones(); },
    listarPatrones() { return Object.assign({}, _patrones || {}); },
    // --- Config geométrica (motor por sectores) ---
    KV_GEO, cargarGeo, guardarGeo,
    listarGeo() { return Object.assign({}, _geoCfg || {}); },
    async olvidarGeo(fp) { await cargarGeo(); delete _geoCfg[fp]; return guardarGeo(); },
  };
  App.MapeoAsistido = Motor;

  // Precarga de patrones y config geométrica al iniciar (no bloquea).
  if (App.DB) { cargarPatrones(); cargarGeo(); }

  /* ---------------------------------------------------------------------- *
   *  Registro en el sistema de parsers (estrategia de respaldo)
   * ---------------------------------------------------------------------- */
  App.Parsers.define({
    id: 'prov_mapeo_asistido',
    provider: 'Mapeo Asistido',
    supports: ['pdf'],

    // Solo "gana" automáticamente si la CABECERA del PDF coincide con la de un
    // patrón aprendido. (Antes devolvía 0.5 con que existiera CUALQUIER patrón
    // y "secuestraba" todos los PDFs desconocidos, pisando a los parsers
    // genéricos.) Si no coincide, devuelve 0: el router igual deriva aquí los
    // PDFs que ningún parser reconoce (respaldo explícito del runner).
    match(ctx) {
      if (ctx.kind !== 'pdf') return 0;
      const pats = patronesSync();
      if (!pats) return 0; // aún no precargó; el router caerá aquí por respaldo
      const head = normCabecera((ctx.text || '').slice(0, 400));
      if (!head) return 0;
      const hTokens = head.split(' ').filter((t) => t.length > 2);
      if (!hTokens.length) return 0;
      let best = 0;
      Object.keys(pats).forEach((fp) => {
        const cab = pats[fp] && pats[fp].cabecera;
        if (!cab) return; // patrón antiguo sin cabecera → lo resuelve el respaldo
        const cTokens = cab.split(' ').filter((t) => t.length > 2);
        if (!cTokens.length) return;
        const hits = cTokens.filter((t) => hTokens.indexOf(t) > -1).length;
        const score = hits / cTokens.length;
        if (score > best) best = score;
      });
      return best >= 0.6 ? 0.9 : 0; // la confirmación fina sigue en parse()
    },

    async parse(file, ctx, util) {
      await ensurePdf();
      await cargarPatrones();
      await cargarGeo();
      // Reutiliza el documento ya abierto por la detección (no re-lee el archivo).
      const pdf = (util && util.getPdfDoc)
        ? await util.getPdfDoc(file)
        : await window.pdfjsLib.getDocument({ data: await App.U.readFileAsArrayBuffer(file) }).promise;
      const page1 = await pdf.getPage(1);
      const muestra = await extraerPagina(page1);
      const fp = fingerprint(muestra);
      const patron = _patrones[fp];
      const opts = ctx._mapeoOpts || {};

      /* === MOTOR GEOMÉTRICO ===============================================
       * Si el catálogo trae imágenes (catálogo "por bloques") usamos el motor
       * geométrico por sectores. Reutiliza la config guardada para esta huella;
       * si no existe, la auto-detecta muestreando páginas y la persiste en
       * IndexedDB (solo metadatos de distribución, nunca datos de productos).
       * El parser de TEXTO existente y el flujo de patrón quedan intactos como
       * respaldo para catálogos sin imágenes.
       * ================================================================== */
      if (App.MotorGeometrico && !patron && muestra.imagenes && muestra.imagenes.length) {
        let geo = _geoCfg[fp];
        if (!geo) {
          const muestras = await muestrearPaginas(pdf, 6);
          const det = App.MotorGeometrico.detectarConfig(muestras, {});
          geo = {
            fingerprint: fp,
            proveedor: 'Mapeo Asistido',
            tipoDistribucion: det.tipoDistribucion,
            productosPorPagina: det.productosPorPagina,
            estrategia: det.estrategia,
            parametros: det.parametros, // sectores, orientación, repetidos a ignorar, etc.
            creado: new Date().toISOString(),
          };
          _geoCfg[fp] = geo;
          await guardarGeo(); // se reutiliza en próximas importaciones con misma estructura
        }
        const out = [];
        const total = pdf.numPages;
        for (let n = 1; n <= total; n++) {
          const pg = (n === 1) ? page1 : await pdf.getPage(n);
          const prods = await aplicarGeometrico(pg, geo, geo.proveedor || 'Mapeo Asistido', opts);
          prods.forEach((p) => out.push(p));
          if (ctx._onPage) try { ctx._onPage(n, total); } catch (_e) {}
          await new Promise((r) => setTimeout(r));
        }
        return out;
      }

      // --- Proveedor NUEVO (sin imágenes): pedir configuración visual al frontend ---
      if (!patron) {
        const aviso = {
          requiereConfiguracion: true,
          motivo: 'proveedor-nuevo',
          fingerprint: fp,
          archivo: file.name || '',
          numPages: pdf.numPages,
          muestra: {
            W: muestra.W, H: muestra.H,
            textos: muestra.textos,
            imagenes: muestra.imagenes.map((i) => ({ x: i.x, y: i.y, w: i.w, h: i.h })),
          },
          instruccion: 'Marque en la muestra dónde están: nombre, precio e imagen. ' +
                       'Luego llame App.MapeoAsistido.aprender(proveedor, fingerprint, mapeo, muestra).',
        };
        // Se "lanza" como dato estructurado (no como error) para que el runner lo propague.
        const err = new Error('REQUIERE_CONFIGURACION');
        err.requiereConfiguracion = aviso;
        throw err;
      }

      // --- Proveedor conocido: aplicar patrón a TODAS las páginas (offline) ---
      const out = [];
      const total = pdf.numPages;
      for (let n = 1; n <= total; n++) {
        const pg = (n === 1) ? page1 : await pdf.getPage(n);
        const prods = await aplicarPatron(pg, patron, ctx._mapeoOpts || {});
        prods.forEach((p) => out.push(p));
        if (ctx._onPage) try { ctx._onPage(n, total); } catch (_e) {}
        await new Promise((r) => setTimeout(r)); // cede el hilo (no congela la UI)
      }
      return out;
    },
  });
})(window.App = window.App || {});
