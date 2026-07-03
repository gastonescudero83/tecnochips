/* =============================================================================
 * motor_geometrico.js — Motor de segmentación geométrica por sectores (OFFLINE)
 * -----------------------------------------------------------------------------
 * Motor REUTILIZABLE. No conoce ningún proveedor en particular: recibe una
 * "muestra" de página ya extraída (texto + imágenes con coords normalizadas
 * 0..1, tal como las entrega App.MapeoAsistido.extraerPagina) y una
 * "configuración de distribución", y devuelve productos normalizados.
 *
 * Idea central (independiente de píxeles):
 *   - La página se divide en N sectores iguales según la ORIENTACIÓN indicada,
 *     usando SIEMPRE la altura/ancho REAL de la página (coords 0..1). No hay
 *     constantes en píxeles: todo es proporcional, así sirve para cualquier
 *     resolución o tamaño de hoja.
 *   - Cada sector = un único producto. Se agrupan los textos e imágenes que
 *     caen dentro de ese sector y se arma el bloque (nombre, descripción,
 *     modelo, precio, imagen principal).
 *   - Elementos repetidos en TODAS las páginas (logos, encabezados, pies,
 *     separadores) se detectan por posición+tamaño+repetición y se ignoran.
 *     No hay lista fija de marcas: es 100% estadístico.
 *   - Si hay varias imágenes en un sector, se elige la principal por criterios
 *     geométricos (mayor superficie, centralidad y cercanía al texto).
 *
 * Para usarlo desde OTRO parser basta con cambiar la "config de distribución":
 *   { sectores: 3, orientacion: 'horizontal' }   // 3 productos en vertical
 *   { sectores: 2, orientacion: 'vertical' }      // 2 productos lado a lado
 *   { sectores: 1 }                               // 1 producto por página
 *
 * Convenciones: window.App, Vanilla JS, sin frameworks. Coords 0..1.
 * ========================================================================== */
(function (App) {
  'use strict';

  /* ---------------------------------------------------------------------- *
   *  Presets de distribución (la "configuración" que distingue proveedores)
   * ---------------------------------------------------------------------- */
  const DISTRIBUCIONES = {
    'vertical-3':   { sectores: 3, orientacion: 'horizontal' }, // 3 apilados
    'vertical-2':   { sectores: 2, orientacion: 'horizontal' },
    'vertical-1':   { sectores: 1, orientacion: 'horizontal' },
    'horizontal-2': { sectores: 2, orientacion: 'vertical' },   // 2 lado a lado
    'grilla-2x2':   { sectores: 4, orientacion: 'horizontal', columnas: 2 },
    'grilla-2x3':   { sectores: 6, orientacion: 'horizontal', columnas: 2 },
  };

  function configDefault() {
    return {
      sectores: 3,
      orientacion: 'horizontal', // 'horizontal' = bandas apiladas; 'vertical' = columnas
      columnas: 1,
      margenSector: 0.0,         // colchón proporcional para no recortar bordes
      minImgArea: 0.0008,        // descarta micro-imágenes (relativo al área de página)
      ignorar: [],               // bandas/zonas repetidas detectadas (se rellena solo)
    };
  }

  /* ---------------------------------------------------------------------- *
   *  Geometría básica (todo en coords normalizadas 0..1)
   * ---------------------------------------------------------------------- */
  function centro(z) { return { cx: z.cx != null ? z.cx : z.x + (z.w || 0) / 2,
                                cy: z.cy != null ? z.cy : z.y + (z.h || 0) / 2 }; }
  function area(z) { return (z.w || 0) * (z.h || 0); }
  function dentroBanda(cy, b) { return cy >= b.y0 && cy < b.y1; }
  function dist(a, b) {
    const ca = centro(a), cb = centro(b);
    const dx = ca.cx - cb.cx, dy = ca.cy - cb.cy;
    return Math.sqrt(dx * dx + dy * dy);
  }

  /* ---------------------------------------------------------------------- *
   *  PASO 1 — Dividir la página en N sectores iguales (sin píxeles fijos)
   *  Devuelve la lista de sectores como rectángulos normalizados 0..1.
   * ---------------------------------------------------------------------- */
  function calcularSectores(config) {
    const cfg = Object.assign(configDefault(), config || {});
    const n = Math.max(1, cfg.sectores | 0);
    const cols = Math.max(1, cfg.columnas | 0);
    const sectores = [];

    if (cols > 1) {
      // Grilla: filas x columnas. (filas = n / cols)
      const filas = Math.max(1, Math.round(n / cols));
      const fh = 1 / filas, fw = 1 / cols;
      for (let r = 0; r < filas; r++) {
        for (let c = 0; c < cols; c++) {
          sectores.push({ idx: sectores.length, x: c * fw, y: r * fh, w: fw, h: fh });
        }
      }
      return sectores.slice(0, n);
    }

    // Bandas iguales según la orientación. La división usa la altura/ancho REAL
    // de la página de forma proporcional (1/n), no constantes en píxeles.
    if (cfg.orientacion === 'vertical') {
      const fw = 1 / n;
      for (let i = 0; i < n; i++) sectores.push({ idx: i, x: i * fw, y: 0, w: fw, h: 1 });
    } else {
      const fh = 1 / n; // tercio superior / central / inferior cuando n = 3
      for (let i = 0; i < n; i++) sectores.push({ idx: i, x: 0, y: i * fh, w: 1, h: fh });
    }
    return sectores;
  }

  /* ---------------------------------------------------------------------- *
   *  PASO 3 — Detección de elementos repetitivos (logos, cabeceras, pies…)
   *  100% estadístico: agrupa elementos por posición+tamaño a lo largo de
   *  TODAS las páginas muestreadas y marca como "ignorables" los que se
   *  repiten en casi todas (umbral configurable). Sin lista fija de marcas.
   *  `paginas` = array de muestras { textos:[], imagenes:[] }.
   * ---------------------------------------------------------------------- */
  function detectarRepetidos(paginas, opts) {
    opts = opts || {};
    const umbral = opts.umbral != null ? opts.umbral : 0.7; // ≥70% de páginas
    const tolPos = opts.tolPos != null ? opts.tolPos : 0.02; // celda de rejilla
    const N = paginas.length || 1;
    const cuenta = {}; // clave de celda → { veces, muestra }

    function clave(el, tipo) {
      const c = centro(el);
      const gx = Math.round(c.cx / tolPos);
      const gy = Math.round(c.cy / tolPos);
      const gw = Math.round((el.w || 0) / tolPos);
      const gh = Math.round((el.h || 0) / tolPos);
      // El texto se agrupa también por su contenido (encabezados idénticos).
      const txt = tipo === 't' ? (el.str || '').toLowerCase().slice(0, 24) : '';
      return tipo + ':' + gx + ',' + gy + ',' + gw + ',' + gh + (txt ? '|' + txt : '');
    }

    paginas.forEach((pag) => {
      const vistos = new Set();
      (pag.textos || []).forEach((t) => {
        const k = clave(t, 't');
        if (vistos.has(k)) return; vistos.add(k);
        (cuenta[k] = cuenta[k] || { veces: 0, el: t, tipo: 't' }).veces++;
      });
      (pag.imagenes || []).forEach((im) => {
        // Solo pueden ser "repetidos" (logos/adornos) las imágenes CHICAS o
        // pegadas a los bordes. Una foto grande y central NUNCA se marca:
        // en catálogos con grilla las fotos caen siempre en la misma posición
        // de cada página y el filtro las eliminaba por error ("fotos que no salen").
        if (!esAdornoPosible(im)) return;
        const k = clave(im, 'i');
        if (vistos.has(k)) return; vistos.add(k);
        (cuenta[k] = cuenta[k] || { veces: 0, el: im, tipo: 'i' }).veces++;
      });
    });

    const repetidos = [];
    Object.keys(cuenta).forEach((k) => {
      const c = cuenta[k];
      if (c.veces / N >= umbral) {
        const ce = centro(c.el);
        repetidos.push({
          tipo: c.tipo, cx: ce.cx, cy: ce.cy,
          w: c.el.w || 0, h: c.el.h || 0,
          veces: c.veces, str: c.tipo === 't' ? (c.el.str || '') : '',
        });
      }
    });
    return repetidos;
  }

  /** ¿La imagen PODRÍA ser un adorno (logo, encabezado, sello)? Solo si es
   *  chica (<2% de la página) o está pegada a los bordes. */
  function esAdornoPosible(im) {
    const c = centro(im);
    const chica = area(im) < 0.02;
    const enBorde = c.cy < 0.12 || c.cy > 0.88 || c.cx < 0.08 || c.cx > 0.92;
    return chica || enBorde;
  }

  function esRepetido(el, repetidos, tipo, tol) {
    tol = tol || 0.02;
    if (tipo === 'i' && !esAdornoPosible(el)) return false; // foto grande y central: nunca
    const c = centro(el);
    for (let i = 0; i < repetidos.length; i++) {
      const r = repetidos[i];
      if (r.tipo !== tipo) continue;
      if (Math.abs(r.cx - c.cx) <= tol && Math.abs(r.cy - c.cy) <= tol) {
        if (tipo === 't') {
          const a = (el.str || '').toLowerCase().slice(0, 24);
          const b = (r.str || '').toLowerCase().slice(0, 24);
          if (a && b && a !== b) continue; // misma posición pero distinto texto → no es repetido
        }
        if (tipo === 'i') {
          // Debe coincidir también el TAMAÑO (antes bastaba el centro y una
          // foto podía "pisar" la celda de un ícono repetido).
          if (Math.abs((r.w || 0) - (el.w || 0)) > tol * 2 ||
              Math.abs((r.h || 0) - (el.h || 0)) > tol * 2) continue;
        }
        return true;
      }
    }
    return false;
  }

  /* ---------------------------------------------------------------------- *
   *  Filtro de "stickers"/sellos superpuestos
   *  Una imagen que está mayormente DENTRO de otra más grande (ej. el círculo
   *  "ÚLTIMA UNIDAD" delante de la foto del producto) NO es la foto: es un
   *  adorno. Se descarta para que no genere productos fantasma ni reemplace
   *  a la foto real.
   * ---------------------------------------------------------------------- */
  function interseccion(a, b) {
    const x0 = Math.max(a.x, b.x), y0 = Math.max(a.y, b.y);
    const x1 = Math.min(a.x + (a.w || 0), b.x + (b.w || 0));
    const y1 = Math.min(a.y + (a.h || 0), b.y + (b.h || 0));
    return Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
  }
  function filtrarSuperpuestas(imagenes) {
    const list = imagenes || [];
    if (list.length < 2) return list.slice();
    return list.filter((im) => {
      const aIm = area(im);
      if (!aIm) return false;
      return !list.some((otra) => {
        if (otra === im) return false;
        const aOt = area(otra);
        if (aOt <= aIm * 1.4) return false;         // la otra debe ser bastante más grande
        return interseccion(im, otra) / aIm >= 0.6; // y contener a ésta en su mayor parte
      });
    });
  }

  /** ¿Es el FONDO/plantilla de la página? (una imagen que cubre casi toda la
   *  hoja no es la foto de un producto: es el arte del catálogo). */
  function esFondo(im) { return (im.w || 0) >= 0.9 && (im.h || 0) >= 0.9; }

  /** ¿Es una TIRA decorativa? (separadores muy alargados y de poca superficie). */
  function esTira(im) {
    const w = im.w || 0, h = im.h || 0;
    if (!w || !h) return true;
    const aspecto = Math.max(w / h, h / w);
    return aspecto >= 6 && area(im) < 0.05;
  }

  /**
   * Se queda SOLO con las fotos de producto plausibles de una página:
   *   1. quita el fondo de página (cubre casi toda la hoja),
   *   2. quita tiras decorativas (separadores alargados),
   *   3. quita imágenes con el MISMO XObject pintado 2+ veces en la página
   *      (sellos/adornos como "ÚLTIMA UNIDAD" — requiere que las imágenes
   *      traigan `name`; si no lo traen, este paso no filtra nada),
   *   4. quita sellos superpuestos dentro de una foto más grande.
   * Respaldo: si no queda ninguna candidata pero había imágenes (ej. una foto
   * que ocupa la página entera), devuelve la más grande.
   */
  function filtrarFotos(imagenes) {
    const src = imagenes || [];
    let list = src.filter((im) => !esFondo(im) && !esTira(im));
    // Nombre repetido = adorno SOLO si la imagen es chica (<4% de la página).
    // Los catálogos reusan la MISMA foto grande para productos repetidos
    // (ej. 3 aires idénticos): esas son fotos reales y se conservan.
    const porNombre = {};
    list.forEach((im) => { if (im.name) porNombre[im.name] = (porNombre[im.name] || 0) + 1; });
    list = list.filter((im) => !im.name || porNombre[im.name] < 2 || area(im) >= 0.04);
    let out = filtrarSuperpuestas(list);
    // 5. Mini-logos/sellos sueltos: si en la página hay una clase clara de
    //    "foto de producto", las imágenes con menos del 22% del área de la
    //    mayor son adornos (logos de marca, sellitos al costado del producto).
    if (out.length > 1) {
      const maxA = Math.max.apply(null, out.map(area));
      const grandes = out.filter((im) => area(im) >= maxA * 0.22);
      if (grandes.length) out = grandes;
    }
    if (out.length) return out;
    const orden = src.slice().sort((a, b) => area(b) - area(a));
    return orden.length ? [orden[0]] : [];
  }

  /* ---------------------------------------------------------------------- *
   *  PASO 2 — Agrupar elementos por sector
   * ---------------------------------------------------------------------- */
  function agruparPorSector(pag, sectores, repetidos, cfg) {
    const grupos = sectores.map((s) => ({ sector: s, textos: [], imagenes: [] }));
    const margen = cfg.margenSector || 0;
    const minA = cfg.minImgArea || 0;

    function indiceSector(el) {
      const c = centro(el);
      // Asigna al sector cuyo rango contiene el centro del elemento.
      for (let i = 0; i < sectores.length; i++) {
        const s = sectores[i];
        if (c.cx >= s.x - margen && c.cx <= s.x + s.w + margen &&
            c.cy >= s.y - margen && c.cy <= s.y + s.h + margen) return i;
      }
      return -1;
    }

    (pag.textos || []).forEach((t) => {
      if (repetidos && esRepetido(t, repetidos, 't')) return; // ignora encabezados repetidos
      const i = indiceSector(t);
      if (i >= 0) grupos[i].textos.push(t);
    });
    (pag.imagenes || []).forEach((im) => {
      if (area(im) < minA) return;                              // micro-imágenes / separadores
      if (repetidos && esRepetido(im, repetidos, 'i')) return;  // logos repetidos
      const i = indiceSector(im);
      if (i >= 0) grupos[i].imagenes.push(im);
    });
    return grupos;
  }

  /* ---------------------------------------------------------------------- *
   *  PASO 4 — Elegir la imagen principal de un sector por criterios geométricos
   *  Score = superficie (↑) + centralidad respecto al sector (↑) +
   *          cercanía al texto del producto (↑).
   * ---------------------------------------------------------------------- */
  function elegirImagenPrincipal(imagenes, sector, textos) {
    if (!imagenes || !imagenes.length) return null;
    if (imagenes.length === 1) return imagenes[0];

    const cs = centro(sector);
    // Centroide del texto del producto (para la cercanía).
    let tx = cs.cx, ty = cs.cy;
    if (textos && textos.length) {
      let sx = 0, sy = 0;
      textos.forEach((t) => { const c = centro(t); sx += c.cx; sy += c.cy; });
      tx = sx / textos.length; ty = sy / textos.length;
    }

    const maxA = Math.max.apply(null, imagenes.map(area)) || 1;
    let best = null, bestScore = -Infinity;
    imagenes.forEach((im) => {
      const ci = centro(im);
      const supNorm = area(im) / maxA;                                   // 0..1
      const distCentro = Math.hypot(ci.cx - cs.cx, ci.cy - cs.cy);        // ↓ mejor
      const distTexto = Math.hypot(ci.cx - tx, ci.cy - ty);              // ↓ mejor
      const score = (supNorm * 0.55) +
                    ((1 - Math.min(1, distCentro / 0.5)) * 0.25) +
                    ((1 - Math.min(1, distTexto / 0.5)) * 0.20);
      if (score > bestScore) { bestScore = score; best = im; }
    });
    return best;
  }

  /* ---------------------------------------------------------------------- *
   *  Heurística de campos dentro del sector (sin lista fija de marcas)
   *  - nombre: línea de texto superior, más grande/prominente, no precio.
   *  - precio: token con formato monetario (mayor valor del sector).
   *  - modelo: token alfanumérico tipo código (letras+números).
   *  - descripcion: resto del texto del bloque.
   * ---------------------------------------------------------------------- */
  // Precio "confiable": con símbolo $ (cualquier número), o formato de miles
  // ("45.990" / "45,990" / "18.900,50"), o decimal con coma ("149,99").
  // Un entero pelado ("7000", "55") NO se toma como precio: casi siempre es
  // parte del modelo ("UN50AU7000") o las pulgadas — antes se tomaba el número
  // MÁS GRANDE del sector y aparecían precios fantasma.
  const RE_PRECIO = /\$\s*\d[\d.,]*|\b\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?\b|\b\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?\b|\b\d+,\d{2}\b/;
  const RE_MODELO = /\b([A-Z]{1,}[-\/]?\d{2,}[A-Z0-9\-\/]*|\d{2,}[A-Z]{1,}[A-Z0-9\-\/]*)\b/;

  function parsePrecio(s) {
    if (App.U && App.U.parsePrice) return App.U.parsePrice(s);
    const n = parseFloat(String(s).replace(/[^\d.,-]/g, '')
      .replace(/\.(?=\d{3})/g, '').replace(',', '.'));
    return isNaN(n) ? 0 : n;
  }
  function buscaPrecio(str) {
    let m, best = 0;
    const re = new RegExp(RE_PRECIO.source, 'g');
    while ((m = re.exec(str))) { const v = parsePrecio(m[0]); if (v > best) best = v; }
    return best;
  }

  function construirProducto(grupo, cfg) {
    const lineas = ordenarLineas(grupo.textos);
    const textoPlano = lineas.map((l) => l.str).join(' ').replace(/\s+/g, ' ').trim();

    // Precio: línea con formato monetario y mayor valor.
    let precio = 0, lineaPrecioIdx = -1;
    lineas.forEach((l, i) => {
      const v = buscaPrecio(l.str);
      if (v > precio) { precio = v; lineaPrecioIdx = i; }
    });

    // Modelo: primer token con patrón alfanumérico de código.
    let modelo = '';
    for (let i = 0; i < lineas.length; i++) {
      const mm = lineas[i].str.match(RE_MODELO);
      if (mm) { modelo = mm[1]; break; }
    }

    // Nombre: primera línea "fuerte" (mayor altura de fuente) que no sea precio.
    let nombre = '';
    const candNombre = lineas
      .map((l, i) => ({ l, i }))
      .filter((o) => o.i !== lineaPrecioIdx && o.l.str.replace(/[^A-Za-zÁÉÍÓÚÑáéíóúñ]/g, '').length >= 3);
    if (candNombre.length) {
      candNombre.sort((a, b) => (b.l.h || 0) - (a.l.h || 0) || a.i - b.i);
      nombre = candNombre[0].l.str.trim();
    }
    if (!nombre && lineas.length) nombre = lineas[0].str.trim();

    // Descripción: el resto del texto (sin la línea del nombre ni la del precio puro).
    const desc = lineas
      .filter((l) => l.str.trim() !== nombre && !(buscaPrecio(l.str) === precio && precio > 0 && l.str.replace(RE_PRECIO, '').replace(/[\s$.,]/g, '').length === 0))
      .map((l) => l.str.trim())
      .filter(Boolean)
      .join(' ').replace(/\s+/g, ' ').trim();

    return { nombre, modelo, precio, descripcion: desc, _texto: textoPlano };
  }

  function ordenarLineas(textos) {
    // Agrupa por línea (misma Y aprox) y ordena izq→der, arriba→abajo.
    const orden = (textos || []).slice().sort((a, b) => {
      const ca = centro(a), cb = centro(b);
      return (ca.cy - cb.cy) || (ca.cx - cb.cx);
    });
    const lineas = []; let cur = null;
    orden.forEach((t) => {
      const cy = centro(t).cy;
      if (!cur || Math.abs(cy - cur.cy) > 0.012) {
        cur = { cy, items: [t], h: t.h || 0 };
        lineas.push(cur);
      } else {
        cur.items.push(t); cur.h = Math.max(cur.h, t.h || 0);
      }
    });
    return lineas.map((l) => ({
      cy: l.cy, h: l.h,
      str: l.items.sort((a, b) => centro(a).cx - centro(b).cx).map((t) => t.str).join(' ').replace(/\s+/g, ' ').trim(),
    })).filter((l) => l.str);
  }

  /* ---------------------------------------------------------------------- *
   *  PIPELINE — procesar una página: sectores → grupos → productos
   *  Devuelve [{ nombre, modelo, precio, descripcion, imagen, _img }]
   *  (la imagen se entrega como bbox 0..1; el parser la recorta a dataURL.)
   * ---------------------------------------------------------------------- */
  function procesarPagina(pag, config, repetidos) {
    const cfg = Object.assign(configDefault(), config || {});
    const sectores = calcularSectores(cfg);
    // Quita fondo de página, tiras decorativas y sellos ANTES de sectorizar.
    const pagina = Object.assign({}, pag, { imagenes: filtrarFotos(pag.imagenes) });
    const grupos = agruparPorSector(pagina, sectores, repetidos, cfg);
    const productos = [];
    grupos.forEach((g) => {
      if (!g.textos.length && !g.imagenes.length) return; // sector vacío
      const base = construirProducto(g, cfg);
      const img = elegirImagenPrincipal(g.imagenes, g.sector, g.textos);
      base._img = img || null; // bbox normalizado de la imagen principal (o null)
      // Un producto válido tiene al menos nombre o imagen.
      if (base.nombre || base._img) productos.push(base);
    });
    return productos;
  }

  /* ---------------------------------------------------------------------- *
   *  AUTO-DETECCIÓN de la configuración de distribución a partir de muestras.
   *  Devuelve la config geométrica (para guardar en IndexedDB y reutilizar).
   *  Estrategia: estima nº de productos/página por el conteo de imágenes
   *  "grandes" no repetidas y su disposición (apiladas vs lado a lado).
   * ---------------------------------------------------------------------- */
  function detectarConfig(paginas, opts) {
    opts = opts || {};
    const repetidos = detectarRepetidos(paginas, opts);
    // Imágenes candidatas (no repetidas, tamaño relevante) por página.
    const conteos = [];
    const centrosY = [];
    const centrosX = [];
    paginas.forEach((pag) => {
      // Solo fotos plausibles: el fondo de página, las tiras y los sellos
      // inflaban el conteo y la distribución detectada salía mal.
      const imgs = filtrarFotos(pag.imagenes).filter((im) =>
        area(im) >= (opts.minImgArea || 0.0008) && !esRepetido(im, repetidos, 'i'));
      conteos.push(imgs.length);
      imgs.forEach((im) => { const c = centro(im); centrosY.push(c.cy); centrosX.push(c.cx); });
    });
    // Moda del conteo = productos por página.
    const moda = modaEntera(conteos) || (opts.sectoresSugeridos || 3);
    // Orientación: si la dispersión vertical de las imágenes domina → apiladas.
    const dispY = dispersion(centrosY), dispX = dispersion(centrosX);
    const orientacion = dispY >= dispX ? 'horizontal' : 'vertical';

    const cfg = Object.assign(configDefault(), {
      sectores: Math.max(1, moda),
      orientacion: orientacion,
      ignorar: repetidos,
    });
    return {
      config: cfg,
      // Metadatos descriptivos (lo que se persiste en IndexedDB).
      tipoDistribucion: (orientacion === 'horizontal' ? 'vertical-' : 'horizontal-') + cfg.sectores,
      productosPorPagina: cfg.sectores,
      estrategia: 'geometrico-sectores',
      parametros: {
        sectores: cfg.sectores,
        orientacion: cfg.orientacion,
        columnas: cfg.columnas,
        minImgArea: cfg.minImgArea,
        margenSector: cfg.margenSector,
        repetidos: repetidos, // bandas/logos/encabezados a ignorar (no son datos de productos)
      },
    };
  }

  function modaEntera(arr) {
    const c = {}; let best = null, bv = 0;
    arr.forEach((n) => { if (!n) return; c[n] = (c[n] || 0) + 1; if (c[n] > bv) { bv = c[n]; best = n; } });
    return best;
  }
  function dispersion(arr) {
    if (!arr.length) return 0;
    const m = arr.reduce((a, b) => a + b, 0) / arr.length;
    return Math.sqrt(arr.reduce((a, b) => a + (b - m) * (b - m), 0) / arr.length);
  }

  /* ---------------------------------------------------------------------- *
   *  API pública del motor reutilizable
   * ---------------------------------------------------------------------- */
  App.MotorGeometrico = {
    DISTRIBUCIONES,
    configDefault,
    calcularSectores,
    detectarRepetidos,
    esRepetido,
    filtrarSuperpuestas,
    filtrarFotos,
    agruparPorSector,
    elegirImagenPrincipal,
    construirProducto,
    procesarPagina,
    detectarConfig,
    // helpers expuestos por si otros parsers los necesitan
    _geom: { centro, area, dist, buscaPrecio },
  };
})(window.App = window.App || {});
