/* =============================================================================
 * ui-admin-etapa5.js — ETAPA 5 · Secciones de administración (PARTE 2 + extras)
 * -----------------------------------------------------------------------------
 * Registra secciones nuevas en el panel admin vía App.Admin.registerSection,
 * sin modificar las secciones existentes. Cubre:
 *   Promociones (pto1) · Banners (pto2) · Marcas (pto3) · Orden categorías (pto4)
 *   Historial/Auditoría (pto11) · Integraciones (pto17)
 * ========================================================================== */
(function (App) {
  'use strict';
  const U = App.U;
  const E5 = App.E5;

  function reRender() { App.Admin.renderRoute(App.Router.current()); }
  const head = (title, btn) => U.el('div', { class: 'a-section-head' },
    [U.el('h2', { text: title }), btn].filter(Boolean));

  // Lee un <input type=file> imagen y devuelve dataURL comprimido
  function imgPicker(label, current, onPick) {
    const prev = U.el('img', { style: { maxHeight: '60px', maxWidth: '120px', objectFit: 'contain', display: current ? 'block' : 'none', marginTop: '.4rem' }, src: current || '' });
    const input = U.el('input', { type: 'file', accept: 'image/*', onChange: async (e) => {
      const f = e.target.files[0]; if (!f) return;
      if (App.E5.Security) { const v = await App.E5.Security.validateFile(f, { accept: ['image'], maxMB: 8 }); if (!v.ok) return U.toast(v.reason, 'error'); }
      const data = App.Images ? await App.Images.compress(f) : await fileToDataURL(f);
      prev.src = data; prev.style.display = 'block'; onPick(data);
    } });
    return U.el('label', { class: 'a-field' }, [U.el('span', { text: label }), input, prev]);
  }
  function fileToDataURL(f) { return new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(f); }); }
  function field(label, node) { return U.el('label', { class: 'a-field' }, [U.el('span', { text: label }), node]); }
  function input(attrs) { return U.el('input', Object.assign({ class: 'a-input' }, attrs)); }
  function dtLocal(ts) { if (!ts) return ''; const d = new Date(ts); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; }
  function parseDt(v) { return v ? new Date(v).getTime() : null; }

  /* ===================== PROMOCIONES (pto 1) ============================== */
  async function sectionPromos(c) {
    const P = E5.Promos;
    c.appendChild(head('🏷️ Promociones', U.el('button', { class: 'btn btn--primary', text: '+ Nueva promoción', onClick: () => editPromo() })));
    const list = await P.list();
    if (!list.length) { c.appendChild(U.el('p', { class: 'a-empty', text: 'Sin promociones. Las promos se activan/desactivan solas según las fechas.' })); return; }
    const table = U.el('table', { class: 'e5-admin-table' });
    table.appendChild(U.el('tr', {}, ['Nombre', 'Tipo', 'Desc.', 'Vigencia', 'Prioridad', 'Estado', ''].map((t) => U.el('th', { text: t }))));
    list.sort((a, b) => (b.priority || 0) - (a.priority || 0)).forEach((p) => {
      const live = P.isLive(p);
      const vig = (p.startAt ? new Date(p.startAt).toLocaleDateString() : '∞') + ' → ' + (p.endAt ? new Date(p.endAt).toLocaleDateString() : '∞');
      table.appendChild(U.el('tr', {}, [
        U.el('td', {}, [U.el('span', { class: 'e5-badge', style: { background: p.color }, text: p.label || P.TYPES[p.type].label }), ' ' + (p.name || '')]),
        U.el('td', { text: (P.TYPES[p.type] || {}).label || p.type }),
        U.el('td', { text: p.discountPercent ? '-' + p.discountPercent + '%' : '—' }),
        U.el('td', { text: vig }),
        U.el('td', { text: String(p.priority || 0) }),
        U.el('td', {}, [U.el('span', { class: 'e5-tag', text: live ? '🟢 Vigente' : '⚪ Inactiva' })]),
        U.el('td', {}, [
          U.el('button', { class: 'btn btn--ghost btn--sm', text: '✏️', onClick: () => editPromo(p) }),
          U.el('button', { class: 'btn btn--ghost btn--sm', text: '🗑️', onClick: async () => { if (await U.confirm('¿Eliminar promoción?')) { await P.remove(p.id); reRender(); } } }),
        ]),
      ]));
    });
    c.appendChild(table);
  }
  function editPromo(promo) {
    const P = E5.Promos; promo = promo || {};
    const cats = (App.Store.state.categories) || [];
    const brands = E5.Brands ? E5.Brands.all() : [];
    const f = {};
    const typeSel = U.el('select', { class: 'a-input' }, Object.keys(P.TYPES).map((k) => U.el('option', { value: k, text: P.TYPES[k].label, selected: promo.type === k ? true : null })));
    const nameI = input({ value: promo.name || '', placeholder: 'Ej: Liquidación invierno' });
    const colorI = input({ type: 'color', value: promo.color || (P.TYPES[promo.type] || P.TYPES.destacado).color });
    const prioI = input({ type: 'number', value: promo.priority || 0 });
    const discI = input({ type: 'number', value: promo.discountPercent || 0, min: '0', max: '90', step: '1' });
    const startI = input({ type: 'datetime-local', value: dtLocal(promo.startAt) });
    const endI = input({ type: 'datetime-local', value: dtLocal(promo.endAt) });
    const labelI = input({ value: promo.label || '', placeholder: 'Texto del badge (opcional)' });
    const catSel = U.el('select', { class: 'a-input', multiple: true, style: { minHeight: '90px' } }, cats.map((ct) => U.el('option', { value: ct.id, text: ct.name, selected: (promo.categoryIds || []).includes(ct.id) ? true : null })));
    const brandSel = U.el('select', { class: 'a-input', multiple: true, style: { minHeight: '90px' } }, brands.map((b) => U.el('option', { value: b.id, text: b.name, selected: (promo.brandIds || []).includes(b.id) ? true : null })));
    const prodArea = U.el('textarea', { class: 'a-input', rows: 2, placeholder: 'IDs de productos separados por coma (opcional)', text: (promo.productIds || []).join(',') });

    const body = U.el('div', { class: 'a-form' }, [
      field('Nombre', nameI), field('Tipo', typeSel),
      U.el('div', { class: 'a-grid2' }, [field('Color', colorI), field('Prioridad', prioI)]),
      field('Descuento (%) — baja el PRECIO real mientras la promo está vigente', discI),
      U.el('p', { class: 'a-muted a-small', text: 'Con 0%, la promo solo muestra la etiqueta (sin tocar precios). Con un %, los productos alcanzados bajan de precio entre "Desde" y "Hasta", aparecen en 🔥 Ofertas con el precio anterior tachado, y al vencer vuelven solos al precio normal.' }),
      U.el('div', { class: 'a-grid2' }, [field('Desde', startI), field('Hasta', endI)]),
      field('Etiqueta', labelI),
      field('Categorías incluidas', catSel),
      field('Marcas incluidas', brandSel),
      field('Productos (IDs)', prodArea),
    ]);
    openModal(promo.id ? 'Editar promoción' : 'Nueva promoción', body, async () => {
      await P.save({
        id: promo.id, name: nameI.value.trim(), type: typeSel.value,
        color: colorI.value, priority: Number(prioI.value) || 0,
        discountPercent: Number(discI.value) || 0,
        startAt: parseDt(startI.value), endAt: parseDt(endI.value),
        label: labelI.value.trim(),
        categoryIds: Array.from(catSel.selectedOptions).map((o) => o.value),
        brandIds: Array.from(brandSel.selectedOptions).map((o) => o.value),
        productIds: prodArea.value.split(',').map((s) => s.trim()).filter(Boolean),
      });
      U.toast('Promoción guardada', 'success'); reRender();
    });
  }

  /* ===================== BANNERS (pto 2) ================================== */
  async function sectionBanners(c) {
    const B = E5.Banners;
    c.appendChild(head('🖼️ Banners', U.el('button', { class: 'btn btn--primary', text: '+ Nuevo banner', onClick: () => editBanner() })));
    const list = (await B.list()).sort((a, b) => (a.order || 0) - (b.order || 0));
    if (!list.length) { c.appendChild(U.el('p', { class: 'a-empty', text: 'Sin banners. El primero activo se muestra en la portada.' })); return; }
    list.forEach((bn, i) => {
      const card = U.el('div', { class: 'a-card', style: { display: 'flex', gap: '1rem', alignItems: 'center', marginBottom: '.6rem' } }, [
        U.el('img', { src: bn.image || '', style: { width: '120px', height: '64px', objectFit: 'cover', borderRadius: '8px', background: '#eee' } }),
        U.el('div', { style: { flex: '1' } }, [U.el('strong', { text: bn.title || '(sin título)' }), U.el('div', { class: 'a-muted', text: bn.subtitle || '' }), U.el('span', { class: 'e5-tag', text: bn.active !== false ? 'Activo' : 'Oculto' })]),
        U.el('div', {}, [
          U.el('button', { class: 'btn btn--ghost btn--sm', text: '⬆️', onClick: async () => { await B.reorder(swap(list.map((x) => x.id), i, i - 1)); reRender(); } }),
          U.el('button', { class: 'btn btn--ghost btn--sm', text: '⬇️', onClick: async () => { await B.reorder(swap(list.map((x) => x.id), i, i + 1)); reRender(); } }),
          U.el('button', { class: 'btn btn--ghost btn--sm', text: '✏️', onClick: () => editBanner(bn) }),
          U.el('button', { class: 'btn btn--ghost btn--sm', text: '🗑️', onClick: async () => { if (await U.confirm('¿Eliminar banner?')) { await B.remove(bn.id); reRender(); } } }),
        ]),
      ]);
      c.appendChild(card);
    });
  }
  function swap(arr, i, j) { if (j < 0 || j >= arr.length) return arr; const a = arr.slice(); const t = a[i]; a[i] = a[j]; a[j] = t; return a; }
  function editBanner(bn) {
    bn = bn || {}; let img = bn.image || '';
    const titleI = input({ value: bn.title || '' });
    const subI = input({ value: bn.subtitle || '' });
    const ctaI = input({ value: bn.ctaText || '', placeholder: 'Ej: Ver ofertas' });
    const targetI = input({ value: bn.ctaTarget || '', placeholder: 'Ruta interna: ofertas, novedades, categoria/ID' });
    const urlI = input({ value: bn.ctaUrl || '', placeholder: 'o URL externa https://...' });
    const activeI = U.el('input', { type: 'checkbox', checked: bn.active !== false ? true : null });
    const body = U.el('div', { class: 'a-form' }, [
      imgPicker('Imagen', img, (d) => { img = d; }),
      field('Título', titleI), field('Subtítulo', subI), field('Texto del botón', ctaI),
      field('Destino interno', targetI), field('URL externa', urlI),
      U.el('label', { class: 'a-field a-field--row' }, [activeI, U.el('span', { text: 'Activo' })]),
    ]);
    openModal(bn.id ? 'Editar banner' : 'Nuevo banner', body, async () => {
      await E5.Banners.save({ id: bn.id, image: img, title: titleI.value, subtitle: subI.value, ctaText: ctaI.value, ctaTarget: targetI.value.trim(), ctaUrl: urlI.value.trim(), active: activeI.checked, order: bn.order });
      U.toast('Banner guardado', 'success'); reRender();
    });
  }

  /* ===================== MARCAS (pto 3) ================================== */
  async function sectionBrands(c) {
    const Br = E5.Brands;
    c.appendChild(head('™️ Marcas', U.el('button', { class: 'btn btn--primary', text: '+ Nueva marca', onClick: () => editBrand() })));
    const list = await Br.list();
    if (!list.length) { c.appendChild(U.el('p', { class: 'a-empty', text: 'Sin marcas.' })); return; }
    const grid = U.el('div', { class: 'e5-brands-grid' });
    list.forEach((b) => {
      grid.appendChild(U.el('div', { class: 'e5-brand-card' }, [
        b.logo ? U.el('img', { src: b.logo, alt: b.name }) : U.el('div', { style: { fontSize: '1.6rem' }, text: '🏷️' }),
        U.el('div', { text: b.name }),
        U.el('div', { class: 'a-muted', text: Br.productsOf(b).length + ' productos' }),
        U.el('div', {}, [
          U.el('button', { class: 'btn btn--ghost btn--sm', text: '✏️', onClick: () => editBrand(b) }),
          U.el('button', { class: 'btn btn--ghost btn--sm', text: '🗑️', onClick: async () => { if (await U.confirm('¿Eliminar marca?')) { await Br.remove(b.id); reRender(); } } }),
        ]),
      ]));
    });
    c.appendChild(grid);
  }
  function editBrand(b) {
    b = b || {}; let logo = b.logo || '', cover = b.cover || '';
    const nameI = input({ value: b.name || '' });
    const descI = U.el('textarea', { class: 'a-input', rows: 3, text: b.description || '' });
    const body = U.el('div', { class: 'a-form' }, [
      field('Nombre', nameI),
      imgPicker('Logotipo', logo, (d) => { logo = d; }),
      imgPicker('Imagen de portada', cover, (d) => { cover = d; }),
      field('Descripción', descI),
    ]);
    openModal(b.id ? 'Editar marca' : 'Nueva marca', body, async () => {
      await E5.Brands.save({ id: b.id, name: nameI.value.trim(), description: descI.value, logo, cover });
      U.toast('Marca guardada', 'success'); reRender();
    });
  }

  /* ===================== ORDEN DE CATEGORÍAS (pto 4) ===================== */
  async function sectionCatOrder(c) {
    const C = E5.Categories;
    c.appendChild(head('🗂️ Orden e imágenes de categorías'));
    c.appendChild(U.el('p', { class: 'a-muted', text: 'Reordená con las flechas y asigná imagen/icono. (El alta/baja de categorías sigue en la sección Categorías.)' }));
    const list = C.ordered();
    if (!list.length) { c.appendChild(U.el('p', { class: 'a-empty', text: 'No hay categorías aún.' })); return; }
    list.forEach((cat, i) => {
      let img = cat.image || '';
      const card = U.el('div', { class: 'a-card', style: { display: 'flex', gap: '1rem', alignItems: 'center', marginBottom: '.5rem' } }, [
        U.el('span', { style: { fontSize: '1.5rem' }, text: cat.icon || '🛍️' }),
        cat.image ? U.el('img', { src: cat.image, style: { width: '54px', height: '54px', objectFit: 'cover', borderRadius: '8px' } }) : U.el('span', { class: 'a-muted', text: '(sin imagen)' }),
        U.el('strong', { text: cat.name, style: { flex: '1' } }),
        U.el('button', { class: 'btn btn--ghost btn--sm', text: '⬆️', onClick: () => C.move(cat.id, -1).then(reRender) }),
        U.el('button', { class: 'btn btn--ghost btn--sm', text: '⬇️', onClick: () => C.move(cat.id, +1).then(reRender) }),
        U.el('button', { class: 'btn btn--ghost btn--sm', text: '🖼️ Imagen', onClick: () => {
          let d = img; const body = U.el('div', { class: 'a-form' }, [imgPicker('Imagen de la categoría', d, (x) => { d = x; }), field('Icono (emoji)', input({ value: cat.icon || '', id: 'cat-ic' }))]);
          openModal('Imagen / icono', body, async () => { if (d) await C.setImage(cat.id, d); const ic = document.getElementById('cat-ic'); if (ic && ic.value) await C.setIcon(cat.id, ic.value); reRender(); });
        } }),
      ]);
      c.appendChild(card);
    });
  }

  /* ===================== HISTORIAL (pto 11) ============================== */
  async function sectionHistory(c) {
    c.appendChild(head('📜 Historial / Auditoría', U.el('button', { class: 'btn btn--ghost', text: 'Vaciar', onClick: async () => { if (await U.confirm('¿Borrar todo el historial?')) { await E5.History.clear(); reRender(); } } })));
    const rows = await E5.History.list({ limit: 500 });
    if (!rows.length) { c.appendChild(U.el('p', { class: 'a-empty', text: 'Sin eventos registrados todavía.' })); return; }
    const table = U.el('table', { class: 'e5-admin-table' });
    table.appendChild(U.el('tr', {}, ['Fecha', 'Tipo', 'Acción', 'Detalle'].map((t) => U.el('th', { text: t }))));
    rows.forEach((e) => table.appendChild(U.el('tr', {}, [
      U.el('td', { text: new Date(e.at).toLocaleString() }),
      U.el('td', {}, [U.el('span', { class: 'e5-tag', text: e.type })]),
      U.el('td', { text: e.action || '' }),
      U.el('td', { text: typeof e.detail === 'string' ? e.detail : JSON.stringify(e.detail) }),
    ])));
    c.appendChild(table);
  }

  /* ===================== INTEGRACIONES (pto 17) ========================== */
  async function sectionIntegrations(c) {
    const I = E5.Integrations;
    c.appendChild(head('🔌 Integraciones (próximamente)'));
    c.appendChild(U.el('p', { class: 'a-muted', text: 'Arquitectura preparada. Estas integraciones se podrán activar a futuro sin reestructurar el proyecto.' }));
    const table = U.el('table', { class: 'e5-admin-table' });
    table.appendChild(U.el('tr', {}, ['Integración', 'Categoría', 'Capacidades', 'Estado'].map((t) => U.el('th', { text: t }))));
    I.list().forEach((a) => table.appendChild(U.el('tr', {}, [
      U.el('td', { text: a.name }),
      U.el('td', {}, [U.el('span', { class: 'e5-tag', text: a.category })]),
      U.el('td', { text: (a.capabilities || []).join(', ') }),
      U.el('td', { text: a.planned ? '🕓 Prevista' : (a.enabled ? '🟢 Activa' : '⚪ Inactiva') }),
    ])));
    c.appendChild(table);
  }

  /* ---- Modal genérico ----------------------------------------------------- */
  function openModal(title, bodyNode, onSave) {
    const overlay = U.el('div', { class: 'modal-overlay' });
    const box = U.el('div', { class: 'modal' }, [
      U.el('h3', { class: 'modal__title', text: title }),
      U.el('div', { class: 'modal__body', style: { maxHeight: '60vh', overflowY: 'auto' } }, [bodyNode]),
      U.el('div', { class: 'modal__actions' }, [
        U.el('button', { class: 'btn btn--ghost', text: 'Cancelar', onClick: () => overlay.remove() }),
        U.el('button', { class: 'btn btn--primary', text: 'Guardar', onClick: async () => { try { await onSave(); overlay.remove(); } catch (e) { U.toast('Error: ' + e.message, 'error'); } } }),
      ]),
    ]);
    overlay.appendChild(box); overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
  }

  /* ---- Registro de secciones --------------------------------------------- */
  function register() {
    if (!App.Admin || !App.Admin.registerSection) return;
    App.Admin.registerSection({ id: 'promociones', label: 'Promociones', icon: '🏷️', render: sectionPromos });
    App.Admin.registerSection({ id: 'banners', label: 'Banners', icon: '🖼️', render: sectionBanners });
    App.Admin.registerSection({ id: 'marcas', label: 'Marcas', icon: '™️', render: sectionBrands });
    App.Admin.registerSection({ id: 'cat-orden', label: 'Orden categorías', icon: '↕️', render: sectionCatOrder });
    App.Admin.registerSection({ id: 'historial', label: 'Historial', icon: '📜', render: sectionHistory });
    App.Admin.registerSection({ id: 'integraciones', label: 'Integraciones', icon: '🔌', render: sectionIntegrations });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', register);
  else register();
})(window.App = window.App || {});
