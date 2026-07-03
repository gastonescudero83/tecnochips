/* =============================================================================
 * ui-mapeo-asistido.js — Lienzo visual de Mapeo Geométrico Asistido (OFFLINE)
 * -----------------------------------------------------------------------------
 * MÓDULO DE INTERFAZ. Se activa cuando un proveedor es NUEVO y el motor pide
 * configuración inicial (requiereConfiguracion: true). Muestra la página real
 * del catálogo en un canvas y deja que el usuario MARQUE con el mouse/dedo
 * dónde están: Nombre, Precio e Imagen (y campos opcionales). Esos clics se
 * traducen a zonas normalizadas 0..1 y se envían a App.MapeoAsistido.aprender(),
 * que guarda el patrón geométrico en IndexedDB para reutilizarlo siempre.
 *
 * No usa frameworks ni IA de pago. Todo corre en el navegador (Vanilla JS).
 *
 * API pública:
 *   App.MapeoUI.abrir({ file, aviso }) -> Promise<patron | null>
 *     · file  : File del PDF del proveedor nuevo.
 *     · aviso : objeto requiereConfiguracion del motor (trae .fingerprint, .muestra…).
 *     · resuelve con el PATRÓN aprendido (para re-procesar) o null si se cancela.
 * ========================================================================== */
(function (App) {
  'use strict';

  const U = App.U;

  /* ---- Campos mapeables (orden, etiqueta, color y si son obligatorios) ---- */
  const CAMPOS = [
    { key: 'nombre',      label: 'Nombre',      color: '#2563eb', req: true  },
    { key: 'precio',      label: 'Precio',      color: '#16a34a', req: true  },
    { key: 'imagen',      label: 'Imagen',      color: '#d97706', req: false },
    { key: 'codigo',      label: 'Código',      color: '#7c3aed', req: false },
    { key: 'marca',       label: 'Marca',       color: '#db2777', req: false },
    { key: 'modelo',      label: 'Modelo',      color: '#0891b2', req: false },
    { key: 'descripcion', label: 'Descripción', color: '#475569', req: false },
    { key: 'categoria',   label: 'Categoría',   color: '#ca8a04', req: false },
  ];
  const CAMPO = {}; CAMPOS.forEach((c) => (CAMPO[c.key] = c));

  /* ---- CSS auto-inyectado (1 sola vez): el módulo es autónomo ------------- */
  function inyectarCSS() {
    if (document.getElementById('mapeo-ui-css')) return;
    const css = `
.mapeo-overlay{position:fixed;inset:0;z-index:1000;background:rgba(15,12,10,.6);
  display:flex;align-items:center;justify-content:center;padding:1rem;}
.mapeo{background:var(--c-surface,#fff);color:var(--c-text,#1c1917);border-radius:14px;
  width:min(980px,100%);max-height:94vh;display:flex;flex-direction:column;overflow:hidden;
  box-shadow:0 24px 60px rgba(0,0,0,.35);}
.mapeo__head{display:flex;align-items:center;gap:.6rem;padding:.9rem 1.1rem;
  border-bottom:1px solid var(--c-border,#e7e5e4);flex:none;}
.mapeo__head h2{font-size:1.05rem;margin:0;font-weight:800;}
.mapeo__head .mapeo__sub{color:var(--c-muted,#78716c);font-size:.82rem;margin-left:.2rem;}
.mapeo__x{margin-left:auto;border:0;background:transparent;font-size:1.4rem;line-height:1;
  cursor:pointer;color:var(--c-muted,#78716c);padding:.1rem .4rem;border-radius:8px;}
.mapeo__x:hover{background:var(--c-bg,#f5f5f4);}
.mapeo__body{display:flex;gap:1rem;padding:1rem;overflow:auto;flex:1;}
.mapeo__stage{position:relative;flex:1;min-width:0;display:flex;justify-content:center;
  background:var(--c-bg,#f5f5f4);border-radius:10px;padding:.5rem;overflow:auto;
  scrollbar-gutter:stable;}
.mapeo__canvasWrap{position:relative;line-height:0;align-self:flex-start;}
.mapeo__canvasWrap canvas{display:block;border-radius:6px;box-shadow:0 2px 10px rgba(0,0,0,.12);}
.mapeo__layer{position:absolute;inset:0;cursor:crosshair;touch-action:none;}
.mapeo__hint{position:absolute;border:1px dashed rgba(37,99,235,.35);border-radius:3px;
  pointer-events:none;}
.mapeo__hint--img{border-color:rgba(217,119,6,.7);background:rgba(217,119,6,.08);}
.mapeo__zone{position:absolute;border:2px solid;border-radius:4px;pointer-events:none;
  box-shadow:0 0 0 1px rgba(255,255,255,.6) inset;font-weight:700;}
.mapeo__zone span{position:absolute;top:-9px;left:-2px;font-size:10px;line-height:1;
  padding:2px 4px;border-radius:4px;color:#fff;white-space:nowrap;}
.mapeo__side{width:280px;flex:none;display:flex;flex-direction:column;gap:.8rem;}
.mapeo__panel{font-size:.85rem;color:var(--c-muted,#78716c);line-height:1.45;}
.mapeo__field{margin-bottom:.6rem;}
.mapeo__field label{display:block;font-size:.78rem;font-weight:700;margin-bottom:.25rem;}
.mapeo__field input{width:100%;padding:.5rem .6rem;border:1px solid var(--c-border,#e7e5e4);
  border-radius:8px;font:inherit;}
.mapeo__chips{display:flex;flex-wrap:wrap;gap:.4rem;}
.mapeo__chip{display:flex;align-items:center;gap:.35rem;border:2px solid var(--c-border,#e7e5e4);
  background:var(--c-surface,#fff);border-radius:999px;padding:.32rem .7rem;font-size:.8rem;
  font-weight:700;cursor:pointer;color:var(--c-text,#1c1917);transition:.12s;}
.mapeo__chip:hover{border-color:currentColor;}
.mapeo__chip[aria-pressed="true"]{color:#fff;}
.mapeo__chip .dot{width:9px;height:9px;border-radius:50%;flex:none;}
.mapeo__chip .ok{font-size:.85rem;}
.mapeo__preview{font-size:.78rem;color:var(--c-text,#1c1917);background:var(--c-bg,#f5f5f4);
  border-radius:8px;padding:.5rem .6rem;min-height:2.2rem;word-break:break-word;}
.mapeo__preview b{display:block;color:var(--c-muted,#78716c);font-size:.7rem;font-weight:700;
  text-transform:uppercase;letter-spacing:.03em;margin-bottom:.15rem;}
.mapeo__foot{display:flex;align-items:center;gap:.6rem;padding:.8rem 1.1rem;
  border-top:1px solid var(--c-border,#e7e5e4);flex:none;}
.mapeo__status{font-size:.82rem;color:var(--c-muted,#78716c);}
.mapeo__foot .grow{margin-left:auto;}
.mapeo__pager{display:flex;align-items:center;gap:.5rem;}
.mapeo__pager button{border:1px solid var(--c-border,#e7e5e4);background:var(--c-surface,#fff);
  color:var(--c-text,#1c1917);border-radius:8px;padding:.35rem .7rem;font:inherit;font-weight:700;
  cursor:pointer;line-height:1;}
.mapeo__pager button:hover:not(:disabled){border-color:currentColor;}
.mapeo__pager button:disabled{opacity:.4;cursor:not-allowed;}
.mapeo__pager .mapeo__pageinfo{font-size:.82rem;font-weight:700;color:var(--c-text,#1c1917);
  min-width:6.5rem;text-align:center;}
.mapeo__err{color:var(--c-danger,#dc2626);font-weight:600;font-size:.85rem;}
@media(max-width:820px){.mapeo__body{flex-direction:column;}.mapeo__side{width:auto;}}
`;
    const tag = document.createElement('style');
    tag.id = 'mapeo-ui-css'; tag.textContent = css;
    document.head.appendChild(tag);
  }

  /* ---- Texto contenido en una zona (preview de confirmación) ------------- */
  function textoEnZona(textos, z) {
    if (!z) return '';
    return (textos || [])
      .filter((t) => t.cx >= z.x && t.cx <= z.x + z.w && t.cy >= z.y && t.cy <= z.y + z.h)
      .sort((a, b) => (a.y - b.y) || (a.x - b.x))
      .map((t) => t.str).join(' ').replace(/\s+/g, ' ').trim();
  }
  function precioEnZona(textos, z) {
    const s = textoEnZona(textos, z);
    const m = /\$?\s*(\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{2})?|\d+(?:[.,]\d{2})?)/.exec(s);
    if (!m) return s ? '(sin nº) ' + s : '';
    const v = U.parsePrice ? U.parsePrice(m[1]) : parseFloat(m[1]);
    return U.formatCurrency ? U.formatCurrency(v) : ('$' + v);
  }

  /* ---- Carga el documento PDF completo (retiene pdf para paginar) --------- */
  async function cargarDocumento(file) {
    await App.MapeoAsistido.ensurePdf();
    const buf = await U.readFileAsArrayBuffer(file);
    const pdf = await window.pdfjsLib.getDocument({ data: buf }).promise;
    const page = await pdf.getPage(1);
    return { pdf, page, numPages: pdf.numPages, baseW: page.getViewport({ scale: 1 }).width };
  }

  /* ---- Render de la página a un canvas, ajustando al ancho disponible ------
   * Calcula la escala dinámicamente con el ancho del contenedor (sin valores
   * fijos) y usa devicePixelRatio para máxima nitidez en pantallas HiDPI.
   * Las dimensiones LÓGICAS (CSS px) se devuelven en {W,H}; el canvas físico
   * se agranda por dpr pero las coordenadas siguen siendo las CSS.
   * ------------------------------------------------------------------------ */
  async function renderEnCanvas(page, canvas, anchoDisponible) {
    const base = page.getViewport({ scale: 1 });
    // Escala = ancho del contenedor / ancho original de la hoja. La hoja
    // completa entra siempre, sin importar la resolución o el tamaño de ventana.
    const scale = Math.max(0.1, anchoDisponible / base.width);
    const viewport = page.getViewport({ scale });

    const dpr = window.devicePixelRatio || 1;
    const W = viewport.width;            // tamaño LÓGICO (CSS px) = lo que se ve
    const H = viewport.height;

    // Buffer físico (nitidez Retina) = lógico * dpr.
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    // Tamaño VISIBLE (CSS) = el lógico. NO reescalamos el canvas por CSS aparte
    // de fijar su tamaño real, así no hay recorte ni ampliación.
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';

    const ctx = canvas.getContext('2d');
    // IMPORTANTE: el contexto queda en identidad. El dpr se aplica UNA sola vez,
    // vía el parámetro `transform` de pdf.js. (Hacer también ctx.setTransform(dpr)
    // duplicaba la escala -> contenido a dpr² -> hoja ampliada y recortada.)
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const transform = dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null;
    await page.render({ canvasContext: ctx, viewport, transform }).promise;
    return { W, H };
  }

  /* ======================================================================== *
   *  abrir({ file, aviso }) -> Promise<patron | null>
   * ======================================================================== */
  function abrir(cfg) {
    cfg = cfg || {};
    const file = cfg.file;
    const aviso = cfg.aviso || {};
    const muestra = aviso.muestra || { W: 1, H: 1, textos: [], imagenes: [] };
    const fingerprint = aviso.fingerprint;

    inyectarCSS();

    return new Promise((resolve) => {
      const zonas = {};            // { campo: {x,y,w,h} normalizado }
      let activo = 'nombre';       // campo que se está marcando
      let cerrado = false;

      const cerrar = (val) => { if (cerrado) return; cerrado = true; quitarListeners(); overlay.remove(); resolve(val); };

      /* ---------- Estructura del modal ---------- */
      const titulo = U.el('h2', { text: '🧩 Mapeo asistido' });
      const sub = U.el('span', { class: 'mapeo__sub',
        text: (aviso.archivo || (file && file.name) || '') + (aviso.numPages ? ' · ' + aviso.numPages + ' pág.' : '') });
      const btnX = U.el('button', { class: 'mapeo__x', text: '✕', title: 'Cerrar', onClick: () => cerrar(null) });

      /* ---------- Barra de paginación (Anterior / X de Y / Siguiente) ------- */
      const btnPrev = U.el('button', { type: 'button', text: '‹ Anterior', title: 'Página anterior', disabled: true, onClick: () => irAPagina(currentPageNum - 1) });
      const pageInfo = U.el('span', { class: 'mapeo__pageinfo', text: 'Página – de –' });
      const btnNext = U.el('button', { type: 'button', text: 'Siguiente ›', title: 'Página siguiente', disabled: true, onClick: () => irAPagina(currentPageNum + 1) });
      const pager = U.el('div', { class: 'mapeo__pager' }, [btnPrev, pageInfo, btnNext]);

      const canvasWrap = U.el('div', { class: 'mapeo__canvasWrap' });
      const layer = U.el('div', { class: 'mapeo__layer' });
      const stage = U.el('div', { class: 'mapeo__stage' }, [canvasWrap]);

      // Lado: instrucciones, proveedor, chips de campos, preview
      const provInput = U.el('input', { type: 'text', placeholder: 'Ej: Importadora Sur', value: aviso.proveedorSugerido || '' });
      const chipsBox = U.el('div', { class: 'mapeo__chips' });
      const chipNodes = {};
      CAMPOS.forEach((c) => {
        const chip = U.el('button', {
          class: 'mapeo__chip', type: 'button', 'aria-pressed': c.key === activo ? 'true' : 'false',
          style: { borderColor: c.color, background: c.key === activo ? c.color : '' },
          onClick: () => setActivo(c.key),
        }, [
          U.el('span', { class: 'dot', style: { background: c.color } }),
          U.el('span', { text: c.label + (c.req ? ' *' : '') }),
          U.el('span', { class: 'ok', text: '' }),
        ]);
        chipNodes[c.key] = chip; chipsBox.appendChild(chip);
      });
      const preview = U.el('div', { class: 'mapeo__preview' }, [U.el('b', { text: 'Vista previa' }), U.el('span', { text: '—' })]);

      const side = U.el('div', { class: 'mapeo__side' }, [
        U.el('p', { class: 'mapeo__panel', html:
          'Elegí un campo y <b>arrastrá un recuadro</b> sobre la página (o tocá una caja resaltada). ' +
          'Marcá al menos <b>Nombre</b> y <b>Precio</b>. Si el catálogo tiene fotos, marcá también <b>Imagen</b>.' }),
        U.el('div', { class: 'mapeo__field' }, [U.el('label', { text: 'Nombre del proveedor' }), provInput]),
        chipsBox,
        preview,
      ]);

      const body = U.el('div', { class: 'mapeo__body' }, [stage, side]);

      const status = U.el('div', { class: 'mapeo__status', text: 'Cargando página…' });
      const btnReset = U.el('button', { class: 'btn btn--ghost', type: 'button', text: '↺ Reiniciar', onClick: reset });
      const btnSave = U.el('button', { class: 'btn btn--primary', type: 'button', text: '💾 Guardar patrón', disabled: true, onClick: guardar });
      const foot = U.el('div', { class: 'mapeo__foot' }, [status, U.el('span', { class: 'grow' }), btnReset, btnSave]);

      const modal = U.el('div', { class: 'mapeo' }, [
        U.el('div', { class: 'mapeo__head' }, [titulo, sub, pager, btnX]),
        body, foot,
      ]);
      const overlay = U.el('div', { class: 'mapeo-overlay' }, [modal]);
      overlay.addEventListener('click', (e) => { if (e.target === overlay) cerrar(null); });
      document.addEventListener('keydown', escHandler);
      function escHandler(e) { if (e.key === 'Escape') { document.removeEventListener('keydown', escHandler); cerrar(null); } }
      document.body.appendChild(overlay);

      /* ---------- Estado del canvas (dimensiones LÓGICAS en CSS px) ----------
       * Las zonas se guardan SIEMPRE normalizadas (0..1), por lo que CW/CH solo
       * sirven para pintar/leer en pantalla. Al reescalar, las marcas quedan
       * alineadas porque se recalculan desde su valor normalizado. ---------- */
      let CW = 1, CH = 1;
      let pdfPage = null;
      let pdfDoc = null;
      let currentPageNum = 1;
      let numPages = 1;
      const canvasEl = U.el('canvas');

      // Ancho disponible real dentro del "stage" (descuenta su padding interno).
      function anchoDisponible() {
        const cs = getComputedStyle(stage);
        const padX = parseFloat(cs.paddingLeft || '0') + parseFloat(cs.paddingRight || '0');
        return Math.max(120, stage.clientWidth - padX);
      }

      // (Re)renderiza la página al ancho actual y repinta todas las capas.
      async function reescalar() {
        if (!pdfPage) return;
        const ancho = anchoDisponible();
        const r = await renderEnCanvas(pdfPage, canvasEl, ancho);
        CW = r.W; CH = r.H;
        canvasWrap.style.width = CW + 'px';
        canvasWrap.style.height = CH + 'px';
        // 2da pasada defensiva: si al colocar el canvas apareció/desapareció la
        // barra de scroll vertical y cambió el ancho disponible (navegadores sin
        // soporte de scrollbar-gutter), re-render al ancho corregido. Evita el
        // scroll horizontal y mantiene la hoja completa visible.
        const ancho2 = anchoDisponible();
        if (Math.abs(ancho2 - ancho) > 0.5) {
          const r2 = await renderEnCanvas(pdfPage, canvasEl, ancho2);
          CW = r2.W; CH = r2.H;
          canvasWrap.style.width = CW + 'px';
          canvasWrap.style.height = CH + 'px';
        }
        // Reconstruye hints y zonas con las dimensiones lógicas finales.
        U.$$('.mapeo__hint', canvasWrap).forEach((n) => n.remove());
        pintarHints();
        repintarZonas();
      }

      cargarDocumento(file).then(async (r) => {
        pdfDoc = r.pdf;
        pdfPage = r.page;
        numPages = r.numPages || 1;
        currentPageNum = 1;
        canvasWrap.appendChild(canvasEl);
        canvasWrap.appendChild(layer);
        await reescalar();
        actualizarPager();
        status.textContent = 'Marcá: Nombre y Precio (mínimo).';
        habilitar();
      }).catch((e) => {
        stage.appendChild(U.el('p', { class: 'mapeo__err',
          text: 'No se pudo renderizar el PDF (¿sin Internet para PDF.js?). ' + (e.message || e) }));
        status.textContent = 'Error al cargar la página.';
      });

      /* ---------- Paginación: refresca botones e indicador ---------- */
      function actualizarPager() {
        pageInfo.textContent = 'Página ' + currentPageNum + ' de ' + numPages;
        btnPrev.disabled = currentPageNum <= 1;
        btnNext.disabled = currentPageNum >= numPages;
      }

      /* ---------- Cambio de página: limpia marcas y re-renderiza ----------
       * Las zonas marcadas se borran al cambiar de hoja para no mezclar clics
       * de distintas páginas. Los hints detectados (muestra) solo existen para
       * la página 1, así que en el resto se navega sin guías pero con clics
       * libres por arrastre totalmente funcionales. ----------------------- */
      let cambiandoPagina = false;
      async function irAPagina(n) {
        if (!pdfDoc || cambiandoPagina) return;
        n = Math.max(1, Math.min(numPages, n));
        if (n === currentPageNum) return;
        cambiandoPagina = true;
        btnPrev.disabled = btnNext.disabled = true;
        status.textContent = 'Cargando página ' + n + '…';
        try {
          // Limpia clics/zonas de la página anterior (no mezclar datos).
          Object.keys(zonas).forEach((k) => delete zonas[k]);
          if (drag) { if (marco) { marco.remove(); marco = null; } drag = null; }
          pdfPage = await pdfDoc.getPage(n);
          currentPageNum = n;
          await reescalar();          // re-render con la escala responsiva ya reparada
          setActivo('nombre');
          renderPreview();
          status.textContent = 'Página ' + n + ' · marcá Nombre y Precio.';
        } catch (e) {
          status.innerHTML = '';
          status.appendChild(U.el('span', { class: 'mapeo__err', text: 'No se pudo cargar la página ' + n + ': ' + (e.message || e) }));
        } finally {
          cambiandoPagina = false;
          actualizarPager();
          habilitar();
        }
      }

      /* ---------- Reescalado ante cambios de ventana o contenedor ---------- */
      let rzTO = null;
      function onResize() {
        clearTimeout(rzTO);
        rzTO = setTimeout(() => { reescalar(); }, 120);
      }
      window.addEventListener('resize', onResize);
      let ro = null;
      if (window.ResizeObserver) {
        ro = new ResizeObserver(onResize);
        ro.observe(stage);
      }
      function quitarListeners() {
        window.removeEventListener('resize', onResize);
        if (ro) { ro.disconnect(); ro = null; }
        clearTimeout(rzTO);
        document.removeEventListener('keydown', escHandler);
      }

      /* ---------- Hints: cajas de texto/imagen detectadas ---------- */
      function pintarHints() {
        // La "muestra" (cajas detectadas) solo corresponde a la página 1.
        if (currentPageNum !== 1) return;
        (muestra.imagenes || []).forEach((im) => {
          canvasWrap.appendChild(U.el('div', { class: 'mapeo__hint mapeo__hint--img', style: estilo(im) }));
        });
        // Solo cajas de texto "grandes" como guía (evita saturar)
        (muestra.textos || []).filter((t) => t.w > 0.04).slice(0, 220).forEach((t) => {
          canvasWrap.appendChild(U.el('div', { class: 'mapeo__hint', style: estilo(t) }));
        });
      }
      function estilo(z) {
        return { left: (z.x * CW) + 'px', top: (z.y * CH) + 'px', width: (z.w * CW) + 'px', height: (z.h * CH) + 'px' };
      }

      /* ---------- Selección de campo activo ---------- */
      function setActivo(key) {
        activo = key;
        CAMPOS.forEach((c) => {
          const on = c.key === key;
          chipNodes[c.key].setAttribute('aria-pressed', on ? 'true' : 'false');
          chipNodes[c.key].style.background = on ? c.color : '';
        });
        renderPreview();
      }

      /* ---------- Dibujo de zonas marcadas ---------- */
      function repintarZonas() {
        U.$$('.mapeo__zone', canvasWrap).forEach((n) => n.remove());
        Object.keys(zonas).forEach((key) => {
          const z = zonas[key], c = CAMPO[key];
          const box = U.el('div', { class: 'mapeo__zone',
            style: Object.assign(estilo(z), { borderColor: c.color }) }, [
            U.el('span', { text: c.label, style: { background: c.color } }),
          ]);
          canvasWrap.appendChild(box);
          chipNodes[key].querySelector('.ok').textContent = '✓';
        });
        CAMPOS.forEach((c) => { if (!zonas[c.key]) chipNodes[c.key].querySelector('.ok').textContent = ''; });
        habilitar();
      }

      /* ---------- Captura: arrastre o click sobre caja ---------- */
      let drag = null, marco = null;
      layer.addEventListener('pointerdown', (e) => {
        if (!CW) return;
        layer.setPointerCapture(e.pointerId);
        const p = punto(e);
        drag = { x0: p.x, y0: p.y, x1: p.x, y1: p.y };
        marco = U.el('div', { class: 'mapeo__zone', style: { borderColor: CAMPO[activo].color } });
        canvasWrap.appendChild(marco);
      });
      layer.addEventListener('pointermove', (e) => {
        if (!drag) return;
        const p = punto(e); drag.x1 = p.x; drag.y1 = p.y;
        Object.assign(marco.style, rectPx(drag));
      });
      layer.addEventListener('pointerup', (e) => {
        if (!drag) return;
        const p = punto(e); drag.x1 = p.x; drag.y1 = p.y;
        if (marco) { marco.remove(); marco = null; }
        const w = Math.abs(drag.x1 - drag.x0), h = Math.abs(drag.y1 - drag.y0);
        let z;
        if (w < 6 || h < 6) z = cajaEnPunto(drag.x0, drag.y0);   // click → caja detectada
        else z = normRect(drag);                                  // arrastre → recuadro libre
        drag = null;
        if (z) { zonas[activo] = z; repintarZonas(); renderPreview(); avanzarCampo(); }
      });

      function punto(e) {
        const r = layer.getBoundingClientRect();
        return { x: U.clamp(e.clientX - r.left, 0, CW), y: U.clamp(e.clientY - r.top, 0, CH) };
      }
      function rectPx(d) {
        const x = Math.min(d.x0, d.x1), y = Math.min(d.y0, d.y1);
        return { left: x + 'px', top: y + 'px', width: Math.abs(d.x1 - d.x0) + 'px', height: Math.abs(d.y1 - d.y0) + 'px' };
      }
      function normRect(d) {
        const x = Math.min(d.x0, d.x1), y = Math.min(d.y0, d.y1);
        return { x: x / CW, y: y / CH, w: Math.abs(d.x1 - d.x0) / CW, h: Math.abs(d.y1 - d.y0) / CH };
      }
      // Busca la caja detectada (imagen si campo=imagen; si no, texto) bajo el punto
      function cajaEnPunto(px, py) {
        const nx = px / CW, ny = py / CH;
        // En páginas sin "muestra" (≠1) no hay cajas detectadas: marca un
        // recuadro pequeño centrado en el click para no perder el dato.
        if (currentPageNum !== 1) {
          const w = 0.12, h = 0.03;
          return { x: U.clamp(nx - w / 2, 0, 1 - w), y: U.clamp(ny - h / 2, 0, 1 - h), w, h };
        }
        const lista = activo === 'imagen' ? (muestra.imagenes || []) : (muestra.textos || []);
        let dentro = null, cerca = null, dmin = Infinity;
        lista.forEach((z) => {
          if (nx >= z.x && nx <= z.x + z.w && ny >= z.y && ny <= z.y + z.h) {
            if (!dentro || (z.w * z.h) < (dentro.w * dentro.h)) dentro = z; // la más ajustada
          }
          const dx = (z.x + z.w / 2) - nx, dy = (z.y + z.h / 2) - ny, d = dx * dx + dy * dy;
          if (d < dmin) { dmin = d; cerca = z; }
        });
        const sel = dentro || cerca;
        return sel ? { x: sel.x, y: sel.y, w: sel.w, h: sel.h } : null;
      }

      function avanzarCampo() {
        const orden = ['nombre', 'precio', 'imagen'];
        for (const k of orden) { if (!zonas[k]) { setActivo(k); return; } }
      }

      function renderPreview() {
        const z = zonas[activo];
        const txt = !z ? 'Marcá una zona para este campo.'
          : activo === 'precio' ? (precioEnZona(muestra.textos, z) || '(sin texto en la zona)')
          : activo === 'imagen' ? '🖼️ Zona de imagen marcada'
          : (textoEnZona(muestra.textos, z) || '(sin texto en la zona)');
        U.clear(preview);
        preview.appendChild(U.el('b', { text: 'Vista previa · ' + CAMPO[activo].label }));
        preview.appendChild(U.el('span', { text: txt }));
      }

      function reset() {
        Object.keys(zonas).forEach((k) => delete zonas[k]);
        repintarZonas(); setActivo('nombre'); renderPreview();
        status.textContent = 'Marcá: Nombre y Precio (mínimo).';
      }

      function habilitar() {
        const ok = !!zonas.nombre && !!zonas.precio;
        btnSave.disabled = !ok;
        if (ok) status.textContent = 'Listo para guardar. Podés afinar o agregar campos.';
      }

      /* ---------- Guardar patrón (alimenta el aprendizaje local) ---------- */
      async function guardar() {
        if (!zonas.nombre || !zonas.precio) { U.toast('Marcá Nombre y Precio.', 'error'); return; }
        btnSave.disabled = true; btnSave.textContent = '⏳ Guardando…';
        try {
          const proveedor = (provInput.value || '').trim() || 'Proveedor Asistido';
          const patron = await App.MapeoAsistido.aprender(proveedor, fingerprint, zonas, muestra);
          U.toast('✓ Patrón aprendido para "' + proveedor + '"', 'success');
          document.removeEventListener('keydown', escHandler);
          cerrar(patron);
        } catch (e) {
          btnSave.disabled = false; btnSave.textContent = '💾 Guardar patrón';
          status.innerHTML = ''; status.appendChild(U.el('span', { class: 'mapeo__err', text: 'No se pudo guardar: ' + (e.message || e) }));
        }
      }

      renderPreview();
    });
  }

  App.MapeoUI = { abrir, CAMPOS };
})(window.App = window.App || {});
