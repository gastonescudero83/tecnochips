/* =============================================================================
 * ui-admin-import.js — Pantalla "Importar Catálogo" del panel de administración
 * -----------------------------------------------------------------------------
 * MÓDULO ADITIVO. Expone App.AdminImport.render(container).
 *
 * Dos motores conviven:
 *   • App.SmartImport  → importación heurística (CSV/XLSX/PDF) que YA aplicaba a
 *     la base (no se toca su lógica).
 *   • App.Parsers + App.MapeoAsistido → "motor de mapeo" geométrico para
 *     proveedores NUEVOS. Cuando un PDF no se reconoce, se abre el lienzo visual
 *     (App.MapeoUI) para mapear Nombre/Precio/Imagen UNA vez; el patrón se guarda
 *     en IndexedDB y se reutiliza siempre.
 *
 * Esta etapa agrega: (1) conectar la barra de progreso con el motor de mapeo y
 * (2) pintar el "Resumen Final" interactivo con todos sus campos.
 * ========================================================================== */
(function (App) {
  'use strict';

  const { U, SmartImport } = App;

  const PHASES = [
    ['leyendo', 'Leyendo archivo'],
    ['analizando', 'Analizando contenido'],
    ['extrayendo', 'Extrayendo productos'],
    ['imagenes', 'Extrayendo imágenes'],
    ['comparando', 'Comparando con la base'],
    ['actualizando', 'Actualizando base de datos'],
    ['finalizado', 'Finalizado'],
  ];

  /* ======================================================================== *
   *  Puente al dominio: aplica registros del motor de mapeo a la base.
   *  Reutiliza el buildPlan público de SmartImport + App.Store (no duplica
   *  la detección de coincidencias por código/marca/nombre).
   * ======================================================================== */
  // Normaliza un registro del motor (App.Parsers) al shape que espera buildPlan.
  function aSmartRec(r) {
    return {
      code: r.codigo || '', name: r.nombre || r.producto || '',
      brand: r.marca || '', model: r.modelo || '',
      description: r.descripcion || '', categoryName: r.categoria || '',
      subcategoryName: '', price: +r.precio || 0,
      images: Array.isArray(r.imagenes) ? r.imagenes : (r.imagen ? [r.imagen] : []),
    };
  }
  // Delegado en App.IO.resolveCategory (implementación única; antes 3 copias).
  async function resolveCat(name) {
    const r = await App.IO.resolveCategory(name, '');
    return r.categoryId || '';
  }
  async function aplicarRegistros(records, opts, onTick) {
    const Store = App.Store;
    const plan = await App.SmartImport._internal.buildPlan(records.map(aSmartRec));
    const res = { created: 0, updated: 0, hidden: 0, noImage: 0, errors: [] };
    const total = plan.updates.length + plan.creates.length + (opts.deactivateMissing ? plan.missing.length : 0);
    let done = 0; const tick = () => { done++; if (onTick && total) onTick(done / total); };

    for (const u of plan.updates) {
      try {
        const ex = u.existing, rec = u.rec, patch = { id: ex.id, active: true };
        if (rec.code) patch.code = rec.code;
        if (rec.name) patch.name = rec.name;
        if (rec.brand) patch.brand = rec.brand;
        if (rec.model) patch.model = rec.model;
        if (rec.description) patch.description = rec.description;
        if (rec.categoryName) { const c = await resolveCat(rec.categoryName); if (c) patch.categoryId = c; }
        if (rec.price > 0 && !ex.priceLock) patch.price = rec.price;          // respeta precio manual
        // Con opts.replaceImages, las fotos del archivo PISAN las guardadas.
        if (rec.images && rec.images.length && (opts.replaceImages || !ex.images || !ex.images.length)) patch.images = rec.images.filter(Boolean);
        else if (!ex.images || !ex.images.length) res.noImage++;
        await Store.saveProduct(patch); res.updated++;
      } catch (e) { res.errors.push('Actualizar “' + (u.existing && u.existing.name) + '”: ' + (e.message || e)); }
      tick();
    }
    if (opts.createNew !== false) {
      for (const c of plan.creates) {
        try {
          const rec = c.rec, catId = rec.categoryName ? await resolveCat(rec.categoryName) : '';
          await Store.saveProduct({
            code: rec.code, name: rec.name, brand: rec.brand, model: rec.model,
            description: rec.description || rec.name, categoryId: catId || '',
            price: rec.price || 0, images: (rec.images || []).filter(Boolean),
            active: true, isNew: true, tags: ['Nuevo'],
          });
          if (!(rec.images && rec.images.length)) res.noImage++;
          res.created++;
        } catch (e) { res.errors.push('Crear “' + c.rec.name + '”: ' + (e.message || e)); }
        tick();
      }
    }
    if (opts.deactivateMissing) {
      for (const p of plan.missing) {
        try { await Store.saveProduct({ id: p.id, active: false }); res.hidden++; }
        catch (e) { res.errors.push('Ocultar “' + p.name + '”: ' + (e.message || e)); }
        tick();
      }
    }
    return res;
  }

  /* ---- Conversión de resultados a un objeto "Resumen Final" unificado ----- */
  function resumenDesdeSmart(summary) {
    const detect = summary.total || 0;
    return {
      proveedor: 'Importación inteligente', parser: 'smart-import (heurístico)',
      detectados: detect, creados: summary.created || 0, actualizados: summary.updated || 0,
      omitidos: Math.max(0, detect - (summary.created || 0) - (summary.updated || 0)),
      revision: summary.noImage || 0, ocultados: summary.hidden || 0,
      tiempoMs: summary.durationMs || 0, aplicado: !!summary.applied, cancelado: !!summary.aborted,
      errores: summary.errors || [], notas: summary.notes || [],
    };
  }
  function resumenDesdeMapeo(rep, res, records, ms, extraNotas) {
    const detect = records.length;
    const revision = records.filter((r) => (+r.precio || 0) <= 0 || !(r.imagenes && r.imagenes.length)).length;
    return {
      proveedor: rep.provider || 'Mapeo Asistido', parser: rep.parserId || 'prov_mapeo_asistido',
      detectados: detect, creados: res.created, actualizados: res.updated,
      omitidos: Math.max(0, detect - res.created - res.updated),
      revision, ocultados: res.hidden, tiempoMs: ms, aplicado: true,
      errores: res.errors || [], notas: extraNotas || [],
    };
  }

  /* ======================================================================== *
   *  Render principal
   * ======================================================================== */
  function render(container) {
    let file = null;
    let running = false;

    const card = (title, children) =>
      U.el('div', { class: 'a-card' }, [U.el('h2', { class: 'a-card__title', text: title })].concat(children));

    /* ---- Selector de archivo ---- */
    const fileInput = U.el('input', { type: 'file', accept: SmartImport.CONFIG.ACCEPT, class: 'a-file' });
    const dropZone = U.el('div', { class: 'imp-drop', tabindex: '0', role: 'button' }, [
      U.el('div', { class: 'imp-drop__icon', text: '📥' }),
      U.el('p', { class: 'imp-drop__title', text: 'Seleccioná o arrastrá un archivo' }),
      U.el('p', { class: 'imp-drop__hint', text: 'PDF · XLSX · XLS · CSV (máx. 25 MB)' }),
    ]);
    const fileInfo = U.el('div', { class: 'imp-fileinfo', hidden: true });

    const pick = () => fileInput.click();
    dropZone.addEventListener('click', pick);
    dropZone.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
    dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('imp-drop--over'); });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('imp-drop--over'));
    dropZone.addEventListener('drop', (e) => {
      e.preventDefault(); dropZone.classList.remove('imp-drop--over');
      if (e.dataTransfer.files && e.dataTransfer.files[0]) selectFile(e.dataTransfer.files[0]);
    });
    fileInput.addEventListener('change', () => { if (fileInput.files[0]) selectFile(fileInput.files[0]); });

    async function selectFile(f) {
      const v = SmartImport.validateFile(f);
      U.clear(fileInfo);
      if (!v.ok) {
        file = null;
        fileInfo.appendChild(U.el('span', { class: 'imp-fileinfo__err', text: '⚠️ ' + v.reason }));
        fileInfo.hidden = false; processBtn.disabled = true; mapeoBtn.disabled = true;
        return;
      }
      // Validación por FIRMA (magic bytes): el contenido real debe coincidir
      // con la extensión (un .pdf renombrado que no es PDF se rechaza acá).
      if (App.E5 && App.E5.Security) {
        const chk = await App.E5.Security.validateFile(f, { accept: ['pdf', 'xlsx', 'xls', 'csv'], maxMB: 25 });
        if (!chk.ok) {
          file = null;
          fileInfo.appendChild(U.el('span', { class: 'imp-fileinfo__err', text: '⚠️ ' + chk.reason }));
          fileInfo.hidden = false; processBtn.disabled = true; mapeoBtn.disabled = true;
          return;
        }
      }
      file = f;
      fileInfo.appendChild(U.el('span', { class: 'imp-fileinfo__name', text: '📄 ' + f.name }));
      fileInfo.appendChild(U.el('span', { class: 'imp-fileinfo__size', text: (f.size / 1024).toFixed(0) + ' KB · ' + v.ext.toUpperCase() }));
      fileInfo.hidden = false; processBtn.disabled = false;
      mapeoBtn.disabled = (v.ext !== 'pdf');     // el mapeo asistido es para PDFs
      resetProgress(); summaryBox.hidden = true;
    }

    /* ---- Opciones ---- */
    const createChk = U.el('input', { type: 'checkbox', checked: true });
    const deactivateChk = U.el('input', { type: 'checkbox' });
    const imagesChk = U.el('input', { type: 'checkbox' });
    const replaceImgChk = U.el('input', { type: 'checkbox' });
    const options = U.el('div', { class: 'imp-options' }, [
      U.el('label', { class: 'a-check' }, [createChk, U.el('span', { text: 'Crear productos nuevos que no estén en la base' })]),
      U.el('label', { class: 'a-check' }, [imagesChk, U.el('span', { text: 'Extraer imágenes del PDF (embebidas → render+recorte)' })]),
      U.el('label', { class: 'a-check' }, [replaceImgChk, U.el('span', { text: 'Reemplazar las fotos ya guardadas por las del archivo (usar para corregir fotos mal importadas)' })]),
      U.el('label', { class: 'a-check' }, [deactivateChk, U.el('span', { text: 'Marcar inactivos los productos que NO aparezcan en el archivo' })]),
      U.el('p', { class: 'imp-warn', text: '⚠️ Activá la última opción solo si el archivo contiene TODO tu catálogo; si es de un proveedor parcial, ocultará el resto (se puede revertir reactivándolos).' }),
    ]);

    /* ---- Botones ---- */
    const processBtn = U.el('button', { class: 'btn btn--primary btn--lg', type: 'button', disabled: true, text: '⚙️ Procesar importación' });
    const mapeoBtn = U.el('button', { class: 'btn btn--ghost btn--lg', type: 'button', disabled: true, text: '🧩 Mapeo asistido (proveedor nuevo)' });
    processBtn.addEventListener('click', start);
    mapeoBtn.addEventListener('click', () => correrMapeo(false));

    function setBusy(b, label) {
      running = b;
      processBtn.disabled = b || !file;
      mapeoBtn.disabled = b || !file || (file && SmartImport.validateFile(file).ext !== 'pdf');
      processBtn.textContent = (b && label === 'smart') ? '⏳ Procesando…' : '⚙️ Procesar importación';
      mapeoBtn.textContent = (b && label === 'mapeo') ? '⏳ Mapeando…' : '🧩 Mapeo asistido (proveedor nuevo)';
    }

    /* ---- Progreso ---- */
    const bar = U.el('div', { class: 'imp-bar__fill' });
    const barWrap = U.el('div', { class: 'imp-bar' }, [bar]);
    const phaseList = U.el('ul', { class: 'imp-phases' });
    const phaseNodes = {};
    PHASES.forEach(([key, label]) => {
      const li = U.el('li', { class: 'imp-phase' }, [
        U.el('span', { class: 'imp-phase__dot' }),
        U.el('span', { class: 'imp-phase__label', text: label }),
        U.el('span', { class: 'imp-phase__detail' }),
      ]);
      phaseNodes[key] = li; phaseList.appendChild(li);
    });
    const progressBox = U.el('div', { class: 'imp-progress', hidden: true }, [barWrap, phaseList]);

    function resetProgress() {
      bar.style.width = '0%';
      PHASES.forEach(([k]) => { phaseNodes[k].className = 'imp-phase'; phaseNodes[k].querySelector('.imp-phase__detail').textContent = ''; });
    }
    function onProgress(phase, pct, detail) {
      progressBox.hidden = false;
      bar.style.width = Math.round((pct || 0) * 100) + '%';
      let passed = true;
      PHASES.forEach(([k]) => {
        const li = phaseNodes[k];
        if (k === phase) { li.className = 'imp-phase is-active'; if (detail) li.querySelector('.imp-phase__detail').textContent = detail; passed = false; }
        else if (passed) li.className = 'imp-phase is-done';
        else li.className = 'imp-phase';
      });
      if (phase === 'finalizado') PHASES.forEach(([k]) => phaseNodes[k].className = 'imp-phase is-done');
    }
    // Adapta los eventos del motor de mapeo (App.Parsers.processAll) a la barra.
    function parserProgress(ev) {
      if (!ev || ev.fase === 'fin') return;                       // el guardado en base sigue la barra
      if (ev.estado === 'procesando') { onProgress('leyendo', 0.1, ev.archivo || file.name); return; }
      if (ev.estado === 'pagina') {
        const tp = ev.totalPaginas || 1;
        onProgress('extrayendo', 0.12 + 0.58 * (ev.pagina / tp), `Página ${ev.pagina}/${tp}`);
        return;
      }
      if (ev.estado === 'listo') onProgress('comparando', 0.72, 'Productos extraídos');
    }

    /* ---- Resumen Final (interactivo) ---- */
    const summaryBox = U.el('div', { class: 'a-card imp-summary', hidden: true });

    function showResumen(r) {
      U.clear(summaryBox); summaryBox.hidden = false;
      if (r.cancelado) {
        summaryBox.appendChild(U.el('h2', { class: 'a-card__title', text: '⏹️ Importación cancelada' }));
        summaryBox.appendChild(U.el('p', { class: 'a-muted', text: 'No se modificó nada en la base.' }));
        return;
      }
      summaryBox.appendChild(U.el('h2', { class: 'a-card__title',
        text: r.aplicado ? '✅ Resumen Final' : '⚠️ Resumen Final (sin cambios aplicados)' }));

      const cards = [
        stat('🏷️', r.proveedor, 'Proveedor detectado'),
        stat('⚙️', r.parser, 'Parser utilizado'),
        stat('🔎', r.detectados, 'Productos detectados'),
        stat('🆕', r.creados, 'Creados'),
        stat('♻️', r.actualizados, 'Actualizados'),
        stat('⏭️', r.omitidos, 'Omitidos'),
        stat('🔍', r.revision, 'Requieren revisión'),
        stat('⏱️', (r.tiempoMs / 1000).toFixed(1) + ' s', 'Tiempo total'),
      ];
      if (r.ocultados) cards.push(stat('🙈', r.ocultados, 'Ocultados'));
      if (r.errores && r.errores.length) cards.push(stat('⛔', r.errores.length, 'Errores'));
      summaryBox.appendChild(U.el('div', { class: 'imp-stats' }, cards));

      (r.notas || []).forEach((nt) => summaryBox.appendChild(U.el('p', { class: 'imp-warn', text: 'ℹ️ ' + nt })));

      if (r.errores && r.errores.length) {
        const det = U.el('details', { class: 'imp-errors' }, [U.el('summary', { text: `Ver ${r.errores.length} error(es)` })]);
        r.errores.slice(0, 50).forEach((e) => det.appendChild(U.el('p', { class: 'imp-errors__item', text: '• ' + e })));
        summaryBox.appendChild(det);
      }
      if (r.revision > 0) {
        summaryBox.appendChild(U.el('p', { class: 'a-muted',
          text: '🔍 ' + r.revision + ' producto(s) requieren revisión (sin precio o sin foto): completalos desde Productos.' }));
      }
      if (r.aplicado && (r.creados || r.actualizados || r.ocultados)) {
        summaryBox.appendChild(U.el('div', { class: 'a-btn-row' }, [
          U.el('a', { class: 'btn btn--ghost', href: '#/admin/productos', text: 'Ver productos' }),
          U.el('a', { class: 'btn btn--ghost', href: '#/', text: 'Ver tienda' }),
        ]));
      }
    }
    function stat(icon, value, label) {
      return U.el('div', { class: 'imp-stat' }, [
        U.el('span', { class: 'imp-stat__icon', text: icon }),
        U.el('span', { class: 'imp-stat__value', text: String(value) }),
        U.el('span', { class: 'imp-stat__label', text: label }),
      ]);
    }

    /* ---- Ejecución: Importación inteligente (SmartImport) ---- */
    async function start() {
      if (!file || running) return;
      setBusy(true, 'smart'); summaryBox.hidden = true; resetProgress();
      try {
        const summary = await SmartImport.run(file, {
          onProgress,
          createNew: createChk.checked,
          deactivateMissing: deactivateChk.checked,
          extractImages: imagesChk.checked,
          replaceImages: replaceImgChk.checked,
          confirm: (plan) => U.confirm(
            `Se aplicarán estos cambios:  Crear ${plan.creates} · Actualizar ${plan.updates}` +
            (deactivateChk.checked ? ` · Ocultar ${plan.missing}` : '') + '. ¿Continuar?',
            { okText: 'Aplicar cambios', cancelText: 'Cancelar' }
          ),
        });
        showResumen(resumenDesdeSmart(summary));
        if (summary.applied) U.toast(`✓ ${summary.created} creados, ${summary.updated} actualizados`, 'success', 3500);

        // Si es un PDF y no se detectó nada, ofrecer el motor de mapeo asistido.
        const v = SmartImport.validateFile(file);
        if (v.ext === 'pdf' && (summary.total || 0) === 0 && !summary.aborted) {
          setBusy(false);
          const go = await U.confirm(
            'No se detectaron productos automáticamente. ¿Querés abrir el Mapeo Asistido para enseñarle a leer este proveedor (marcando Nombre/Precio/Imagen)?',
            { okText: 'Abrir mapeo', cancelText: 'Ahora no' });
          if (go) return correrMapeo(true);
        }
      } catch (e) {
        U.toast('Error: ' + (e.message || e), 'error', 5000);
      } finally {
        setBusy(false);
      }
    }

    /* ---- Ejecución: Motor de Mapeo Asistido (App.Parsers + App.MapeoUI) ---- */
    async function correrMapeo(silencioso) {
      if (!file || running) return;
      if (!App.MapeoAsistido || !App.MapeoUI || !App.Parsers) {
        U.toast('El motor de mapeo no está disponible.', 'error'); return;
      }
      const v = SmartImport.validateFile(file);
      if (v.ext !== 'pdf') { U.toast('El mapeo asistido es para catálogos PDF.', 'error'); return; }

      setBusy(true, 'mapeo'); summaryBox.hidden = true; resetProgress();
      const t0 = Date.now();
      try {
        onProgress('leyendo', 0.05, file.name);

        // 1) ¿Existe ya un patrón para este proveedor? Si no, abrir el lienzo visual.
        let fp = await App.MapeoAsistido.tienePatron(file);
        if (!fp) {
          onProgress('analizando', 0.1, 'Esperando mapeo visual…');
          const m = await App.MapeoAsistido.muestra(file, 1);
          const aviso = {
            requiereConfiguracion: true, fingerprint: m.fingerprint,
            archivo: file.name, numPages: m.numPages,
            muestra: { W: m.W, H: m.H, textos: m.textos, imagenes: m.imagenes },
          };
          const patron = await App.MapeoUI.abrir({ file, aviso });
          if (!patron) { showResumen({ cancelado: true }); return; }   // usuario canceló
          fp = patron.fingerprint;
        }

        // 2) Extraer TODAS las páginas con el patrón (provider forzado) + progreso real.
        onProgress('extrayendo', 0.12, 'Aplicando patrón…');
        const { results } = await App.Parsers.processAll([file], {
          provider: 'Mapeo Asistido',
          mapeoOpts: { recortarImagenes: imagesChk.checked, scale: 2 },
          onProgress: parserProgress,
        });
        const rep = results[0] || {};
        if (rep.requiereConfiguracion) { U.toast('El patrón no se aplicó. Volvé a intentar.', 'error'); return; }

        const records = rep.records || [];
        onProgress('comparando', 0.74, records.length + ' productos extraídos');
        if (!records.length) {
          showResumen(resumenDesdeMapeo(rep, { created: 0, updated: 0, hidden: 0, errors: [] }, records, Date.now() - t0,
            ['No se extrajeron productos. Reabrí el mapeo y ajustá las zonas de Nombre/Precio.']));
          return;
        }

        // 3) Confirmar y aplicar a la base.
        const plan = await App.SmartImport._internal.buildPlan(records.map(aSmartRec));
        const ok = await U.confirm(
          `Se aplicarán estos cambios:  Crear ${plan.creates.length} · Actualizar ${plan.updates.length}` +
          (deactivateChk.checked ? ` · Ocultar ${plan.missing.length}` : '') + '. ¿Continuar?',
          { okText: 'Aplicar cambios', cancelText: 'Cancelar' });
        if (!ok) { showResumen({ cancelado: true }); return; }

        onProgress('actualizando', 0.82, 'Guardando cambios…');
        const res = await aplicarRegistros(records,
          { createNew: createChk.checked, deactivateMissing: deactivateChk.checked, replaceImages: replaceImgChk.checked },
          (p) => onProgress('actualizando', 0.82 + 0.16 * p));
        onProgress('finalizado', 1, 'Listo');

        showResumen(resumenDesdeMapeo(rep, res, records, Date.now() - t0, []));
        U.toast(`✓ ${res.created} creados, ${res.updated} actualizados`, 'success', 3500);
      } catch (e) {
        U.toast('Error: ' + (e.message || e), 'error', 5000);
      } finally {
        setBusy(false);
      }
    }

    /* ---- Proveedores aprendidos (A8): ver / olvidar patrones y
     *      distribuciones geométricas guardadas en IndexedDB ------------- */
    const learnedBox = U.el('div', { class: 'a-card' });
    async function paintLearned() {
      U.clear(learnedBox);
      learnedBox.appendChild(U.el('h2', { class: 'a-card__title', text: '🧠 Proveedores aprendidos' }));
      if (!App.MapeoAsistido) {
        learnedBox.appendChild(U.el('p', { class: 'a-muted', text: 'El motor de mapeo no está disponible.' }));
        return;
      }
      await App.MapeoAsistido.cargarPatrones();
      await App.MapeoAsistido.cargarGeo();
      const pats = App.MapeoAsistido.listarPatrones();
      const geos = App.MapeoAsistido.listarGeo();
      const pKeys = Object.keys(pats), gKeys = Object.keys(geos);
      if (!pKeys.length && !gKeys.length) {
        learnedBox.appendChild(U.el('p', { class: 'a-muted', text: 'Todavía no hay patrones aprendidos. Se crean al usar el “Mapeo asistido” o al importar catálogos PDF con fotos.' }));
        return;
      }
      const row = (title, sub, onDel) => U.el('div', { class: 'a-comment' }, [
        U.el('div', { class: 'a-comment__body' }, [
          U.el('strong', { text: title }),
          U.el('div', { class: 'a-muted a-small', text: sub }),
        ]),
        U.el('div', { class: 'a-row-actions' }, [
          U.el('button', { class: 'btn btn--sm btn--danger-ghost', text: '🗑 Olvidar', onClick: onDel }),
        ]),
      ]);
      pKeys.forEach((fp) => {
        const p = pats[fp];
        learnedBox.appendChild(row(
          (p.proveedor || 'Proveedor') + ' · patrón visual',
          'Modo: ' + (p.modo || '—') + ' · creado: ' + (p.creado ? p.creado.slice(0, 10) : '—') + ' · ' + fp,
          async () => {
            const ok = await U.confirm('¿Olvidar el patrón de "' + (p.proveedor || fp) + '"? La próxima importación pedirá mapearlo de nuevo.', { danger: true, okText: 'Olvidar' });
            if (ok) { await App.MapeoAsistido.olvidar(fp); U.toast('Patrón olvidado', 'success'); paintLearned(); }
          }
        ));
      });
      gKeys.forEach((fp) => {
        const g = geos[fp];
        learnedBox.appendChild(row(
          (g.proveedor || 'Proveedor') + ' · distribución automática',
          (g.tipoDistribucion || '—') + ' · ' + (g.productosPorPagina || '?') + ' producto(s) por página · ' + fp,
          async () => {
            const ok = await U.confirm('¿Olvidar la distribución detectada? Se volverá a auto-detectar en la próxima importación de ese catálogo.', { danger: true, okText: 'Olvidar' });
            if (ok) { await App.MapeoAsistido.olvidarGeo(fp); U.toast('Distribución olvidada', 'success'); paintLearned(); }
          }
        ));
      });
      learnedBox.appendChild(U.el('p', { class: 'a-muted a-small', text: '💡 Si un catálogo se importa mal (columnas corridas, precios cruzados), olvidá su patrón/distribución acá y volvé a importarlo para re-aprenderlo.' }));
    }
    paintLearned();

    /* ---- Ensamblado ---- */
    U.clear(container);
    container.appendChild(U.el('div', { class: 'a-section-head' }, [
      U.el('h2', { class: 'a-card__title', text: '🤖 Importar Catálogo' }),
    ]));
    // Versión visible del motor: permite verificar de un vistazo que el
    // navegador NO esté sirviendo código viejo desde el caché.
    container.appendChild(U.el('p', { class: 'a-muted a-small', text:
      'Motor de importación v2.4 · Si no ves este número, tu navegador tiene una versión vieja en caché: recargá con Ctrl+F5.' }));
    container.appendChild(card('1 · Elegí el archivo del proveedor', [
      U.el('p', { class: 'a-muted', text: 'Subí el catálogo en PDF, Excel (XLSX/XLS) o CSV. Se detectan código, nombre, marca, modelo, descripción, categoría, precio e imágenes.' }),
      U.el('div', { class: 'imp-picker' }, [dropZone, fileInput]),
      fileInfo,
    ]));
    container.appendChild(card('2 · Opciones', [options]));
    container.appendChild(card('3 · Procesar', [
      U.el('p', { class: 'a-muted', text: 'Importación inteligente para formatos conocidos. Si es un proveedor nuevo (PDF) que no se reconoce, usá “Mapeo asistido” para enseñarle a leerlo una sola vez.' }),
      progressBox,
      U.el('div', { class: 'imp-actions' }, [
        U.el('div', { class: 'a-btn-row' }, [processBtn, mapeoBtn]),
      ]),
    ]));
    container.appendChild(summaryBox);
    container.appendChild(learnedBox);
    container.appendChild(U.el('p', { class: 'imp-note', html:
      'Notas: las imágenes se guardan en el almacenamiento local (IndexedDB). ' +
      'El “Mapeo asistido” aprende el patrón geométrico del proveedor (offline, sin IA de pago) y lo reutiliza en futuras importaciones del mismo catálogo. ' +
      'PDF y Excel usan librerías que se descargan la primera vez (requiere Internet); CSV funciona offline.' }));
  }

  App.AdminImport = { render };
})(window.App = window.App || {});
