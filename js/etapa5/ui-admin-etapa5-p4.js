/* =============================================================================
 * ui-admin-etapa5-p4.js — ETAPA 5 · Administración (PARTE 4)
 * -----------------------------------------------------------------------------
 * Registra secciones admin: Gestión masiva (10), Configuración general (12),
 * SEO (13) y Exportar (15). Aditivo, vía App.Admin.registerSection.
 * ========================================================================== */
(function (App) {
  'use strict';
  const U = App.U;
  const E5 = App.E5;
  const S = App.Store;
  function reRender() { App.Admin.renderRoute(App.Router.current()); }
  const head = (t) => U.el('div', { class: 'a-section-head' }, [U.el('h2', { text: t })]);
  const field = (label, node) => U.el('label', { class: 'a-field' }, [U.el('span', { text: label }), node]);
  const input = (attrs) => U.el('input', Object.assign({ class: 'a-input' }, attrs));
  function imgPicker(label, current, onPick) {
    const prev = U.el('img', { style: { maxHeight: '54px', display: current ? 'block' : 'none', marginTop: '.3rem' }, src: current || '' });
    const inp = U.el('input', { type: 'file', accept: 'image/*', onChange: async (e) => {
      const f = e.target.files[0]; if (!f) return;
      if (E5.Security) { const v = await E5.Security.validateFile(f, { accept: ['image'], maxMB: 8 }); if (!v.ok) return U.toast(v.reason, 'error'); }
      const d = App.Images ? await App.Images.compress(f) : await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(f); });
      prev.src = d; prev.style.display = 'block'; onPick(d);
    } });
    return U.el('label', { class: 'a-field' }, [U.el('span', { text: label }), inp, prev]);
  }

  /* ===================== GESTIÓN MASIVA (pto 10) ========================= */
  function sectionBulk(c) {
    c.appendChild(head('⚙️ Gestión masiva'));
    const selected = new Set();
    // Filtros simples
    const cats = S.state.categories || [];
    const catFilter = U.el('select', { class: 'a-input' }, [U.el('option', { value: '', text: 'Todas las categorías' })].concat(cats.map((ct) => U.el('option', { value: ct.id, text: ct.name }))));
    const txt = input({ placeholder: 'Buscar por nombre/código…' });
    const listWrap = U.el('div', { style: { maxHeight: '320px', overflowY: 'auto', border: '1px solid rgba(0,0,0,.1)', borderRadius: '8px', padding: '.5rem', margin: '.5rem 0' } });

    function paint() {
      U.clear(listWrap);
      const term = U.normalize(txt.value);
      const prods = (S.state.products || []).filter((p) => {
        if (catFilter.value && p.categoryId !== catFilter.value) return false;
        if (term && U.normalize(p.name + ' ' + (p.code || '')).indexOf(term) < 0) return false;
        return true;
      });
      listWrap.appendChild(U.el('div', { class: 'a-muted', text: prods.length + ' productos · ' + selected.size + ' seleccionados' }));
      prods.slice(0, 300).forEach((p) => {
        const cb = U.el('input', { type: 'checkbox', checked: selected.has(p.id) ? true : null, onChange: (e) => { if (e.target.checked) selected.add(p.id); else selected.delete(p.id); paintCount(); } });
        listWrap.appendChild(U.el('label', { style: { display: 'flex', gap: '.5rem', alignItems: 'center', padding: '.2rem 0' } }, [cb, U.el('span', { text: (p.code ? '[' + p.code + '] ' : '') + p.name }), U.el('span', { class: 'a-muted', text: ' ' + U.formatCurrency(S.effectivePrice(p), S.state.settings) })]));
      });
    }
    const countLbl = U.el('strong', { text: '0 seleccionados' });
    function paintCount() { countLbl.textContent = selected.size + ' seleccionados'; }
    txt.addEventListener('input', U.debounce(paint, 150));
    catFilter.addEventListener('change', paint);

    const ids = () => Array.from(selected);
    function need() { if (!selected.size) { U.toast('Seleccioná productos primero', 'info'); return false; } return true; }

    // Acciones
    const pctInput = input({ type: 'number', value: 10, style: { width: '80px' } });
    const catMove = U.el('select', { class: 'a-input' }, cats.map((ct) => U.el('option', { value: ct.id, text: ct.name })));
    const subMove = U.el('select', { class: 'a-input' });
    function fillSubMove() {
      U.clear(subMove);
      subMove.appendChild(U.el('option', { value: '', text: '— Sin subcategoría —' }));
      const c = cats.find((ct) => ct.id === catMove.value);
      (c ? c.subcategories || [] : []).forEach((s) => subMove.appendChild(U.el('option', { value: s.id, text: s.name })));
    }
    catMove.addEventListener('change', fillSubMove); fillSubMove();
    let bulkImgs = [];

    const actions = U.el('div', { class: 'a-form' }, [
      U.el('div', { class: 'a-card' }, [
        U.el('strong', { text: 'Cambiar precios por %' }),
        U.el('div', { style: { display: 'flex', gap: '.5rem', alignItems: 'center', marginTop: '.4rem' } }, [
          pctInput, U.el('span', { text: '%' }),
          U.el('button', { class: 'btn btn--primary btn--sm', text: 'Aplicar', onClick: async () => { if (!need()) return; const n = await E5.Bulk.changePrice(ids(), Number(pctInput.value)); U.toast(n + ' precios actualizados', 'success'); reRender(); } }),
        ]),
      ]),
      U.el('div', { class: 'a-card' }, [
        U.el('strong', { text: 'Mover a categoría / subcategoría' }),
        U.el('div', { style: { display: 'flex', gap: '.5rem', marginTop: '.4rem', flexWrap: 'wrap' } }, [catMove, subMove, U.el('button', { class: 'btn btn--primary btn--sm', text: 'Mover', onClick: async () => { if (!need()) return; const n = await E5.Bulk.moveCategory(ids(), catMove.value, subMove.value); U.toast(n + ' movidos', 'success'); reRender(); } })]),
      ]),
      U.el('div', { class: 'a-card' }, [
        U.el('strong', { text: 'Visibilidad' }),
        U.el('div', { style: { display: 'flex', gap: '.5rem', marginTop: '.4rem' } }, [
          U.el('button', { class: 'btn btn--ghost btn--sm', text: '👁️ Activar', onClick: async () => { if (!need()) return; await E5.Bulk.setActive(ids(), true); U.toast('Activados', 'success'); reRender(); } }),
          U.el('button', { class: 'btn btn--ghost btn--sm', text: '🙈 Ocultar', onClick: async () => { if (!need()) return; await E5.Bulk.setActive(ids(), false); U.toast('Ocultados', 'success'); reRender(); } }),
        ]),
      ]),
      U.el('div', { class: 'a-card' }, [
        U.el('strong', { text: 'Reemplazar imágenes' }),
        U.el('input', { type: 'file', accept: 'image/*', multiple: true, onChange: async (e) => { bulkImgs = []; for (const f of e.target.files) { bulkImgs.push(App.Images ? await App.Images.compress(f) : await fr(f)); } U.toast(bulkImgs.length + ' imágenes listas', 'info'); } }),
        U.el('button', { class: 'btn btn--primary btn--sm', text: 'Aplicar a selección', onClick: async () => { if (!need() || !bulkImgs.length) return U.toast('Elegí imágenes', 'info'); await E5.Bulk.replaceImages(ids(), bulkImgs); U.toast('Imágenes reemplazadas', 'success'); reRender(); } }),
      ]),
      U.el('div', { class: 'a-card' }, [
        U.el('strong', { text: 'Exportar selección' }),
        U.el('div', { style: { display: 'flex', gap: '.4rem', marginTop: '.4rem', flexWrap: 'wrap' } }, ['csv', 'json', 'excel', 'pdf'].map((fmt) => U.el('button', { class: 'btn btn--ghost btn--sm', text: fmt.toUpperCase(), onClick: () => { if (!need()) return; E5.Bulk.exportSelection(ids(), fmt); } }))),
      ]),
    ]);
    function fr(f) { return new Promise((r) => { const x = new FileReader(); x.onload = () => r(x.result); x.readAsDataURL(f); }); }

    c.appendChild(U.el('div', { style: { display: 'flex', gap: '.5rem', alignItems: 'center', flexWrap: 'wrap' } }, [catFilter, txt, countLbl]));
    c.appendChild(listWrap);
    c.appendChild(actions);
    paint();
  }

  /* ===================== CONFIGURACIÓN GENERAL (pto 12) ================= */
  function sectionConfig(c) {
    c.appendChild(head('🏪 Configuración general'));
    const s = S.state.settings;
    let logo = s.logo || '', favicon = s.favicon || '';
    const f = {};
    const mk = (k, label, val) => { const i = input({ value: val != null ? val : (s[k] || '') }); f[k] = i; return field(label, i); };
    const social = s.social || {};
    const sk = {};
    const mkSocial = (k, label) => { const i = input({ value: social[k] || '', placeholder: 'https://' }); sk[k] = i; return field(label, i); };
    const theme = s.theme || {};
    const tk = {};
    const mkColor = (k, label) => { const i = input({ type: 'color', value: theme[k] || '#000000' }); tk[k] = i; return field(label, i); };
    const taxI = input({ type: 'number', value: s.taxPercent || 0 });
    const seoI = U.el('textarea', { class: 'a-input', rows: 2, text: s.seoDescription || '' });
    const footerI = input({ value: s.footer || '' });

    const form = U.el('div', { class: 'a-form' }, [
      mk('storeName', 'Nombre del comercio'),
      mk('slogan', 'Slogan'),
      imgPicker('Logo', logo, (d) => { logo = d; }),
      imgPicker('Favicon', favicon, (d) => { favicon = d; }),
      mk('whatsapp', 'WhatsApp (formato internacional)'),
      U.el('div', { class: 'a-grid2' }, [mk('currency', 'Moneda (ARS, USD...)'), mk('currencySymbol', 'Símbolo')]),
      field('% de impuestos', taxI),
      U.el('h3', { text: 'Redes sociales' }),
      mkSocial('instagram', 'Instagram'), mkSocial('facebook', 'Facebook'), mkSocial('x', 'X / Twitter'), mkSocial('tiktok', 'TikTok'), mkSocial('youtube', 'YouTube'),
      U.el('h3', { text: 'Colores del sitio' }),
      U.el('div', { class: 'a-grid2' }, [mkColor('primary', 'Primario'), mkColor('accent', 'Acento')]),
      U.el('div', { class: 'a-grid2' }, [mkColor('bg', 'Fondo'), mkColor('text', 'Texto')]),
      U.el('h3', { text: 'Textos' }),
      field('Descripción SEO', seoI),
      field('Pie de página', footerI),
      U.el('button', { class: 'btn btn--primary', text: 'Guardar configuración', onClick: async () => {
        const patch = {
          storeName: f.storeName.value, slogan: f.slogan.value, whatsapp: f.whatsapp.value,
          currency: f.currency.value, currencySymbol: f.currencySymbol.value,
          logo, favicon, taxPercent: Number(taxI.value) || 0, seoDescription: seoI.value, footer: footerI.value,
          social: { instagram: sk.instagram.value, facebook: sk.facebook.value, x: sk.x.value, tiktok: sk.tiktok.value, youtube: sk.youtube.value },
          theme: Object.assign({}, theme, { primary: tk.primary.value, accent: tk.accent.value, bg: tk.bg.value, text: tk.text.value }),
        };
        await E5.Config.save(patch);
        if (App.Storefront && App.Storefront.refreshChrome) App.Storefront.refreshChrome();
        U.toast('Configuración guardada ✓', 'success');
      } }),
    ]);
    c.appendChild(form);
  }

  /* ===================== SEO (pto 13) =================================== */
  function sectionSEO(c) {
    c.appendChild(head('🔍 SEO automático'));
    c.appendChild(U.el('p', { class: 'a-muted', text: 'Las meta etiquetas (title, description, Open Graph, Twitter) se generan solas en cada página. Acá podés descargar el sitemap y robots.txt para subirlos si publicás la tienda en un hosting.' }));
    c.appendChild(U.el('div', { class: 'a-form' }, [
      U.el('button', { class: 'btn btn--primary', text: '⬇️ Descargar sitemap.xml', onClick: () => E5.SEO.downloadSitemap() }),
      U.el('button', { class: 'btn btn--ghost', text: '⬇️ Descargar robots.txt', onClick: () => E5.SEO.downloadRobots() }),
      U.el('details', {}, [U.el('summary', { text: 'Vista previa sitemap' }), U.el('pre', { style: { maxHeight: '240px', overflow: 'auto', fontSize: '.75rem', background: 'rgba(0,0,0,.04)', padding: '.5rem' }, text: E5.SEO.sitemap() })]),
    ]));
  }

  /* ===================== EXPORTAR (pto 15) ============================== */
  function sectionExport(c) {
    c.appendChild(head('📤 Exportar catálogo'));
    const cats = S.state.categories || [];
    const brands = (E5.Brands ? E5.Brands.all() : []);
    const catSel = U.el('select', { class: 'a-input' }, [U.el('option', { value: '', text: 'Todas las categorías' })].concat(cats.map((ct) => U.el('option', { value: ct.id, text: ct.name }))));
    const brandSel = U.el('select', { class: 'a-input' }, [U.el('option', { value: '', text: 'Todas las marcas' })].concat(brands.map((b) => U.el('option', { value: b.name, text: b.name }))));
    const statusSel = U.el('select', { class: 'a-input' }, [['', 'Todos'], ['active', 'Solo activos'], ['hidden', 'Solo ocultos']].map(([v, t]) => U.el('option', { value: v, text: t })));
    const provInput = input({ placeholder: 'Proveedor (opcional)' });
    function flt() { return { categoryId: catSel.value, brand: brandSel.value, provider: provInput.value.trim(), status: statusSel.value }; }
    const countLbl = U.el('div', { class: 'a-muted' });
    function refresh() { countLbl.textContent = E5.Export.filter(flt()).length + ' productos coinciden'; }
    [catSel, brandSel, statusSel].forEach((el) => el.addEventListener('change', refresh));
    provInput.addEventListener('input', U.debounce(refresh, 200));

    c.appendChild(U.el('div', { class: 'a-form' }, [
      field('Categoría', catSel), field('Marca', brandSel), field('Estado', statusSel), field('Proveedor', provInput), countLbl,
      U.el('div', { style: { display: 'flex', gap: '.5rem', flexWrap: 'wrap', marginTop: '.5rem' } }, [
        U.el('button', { class: 'btn btn--primary', text: 'Excel (.xls)', onClick: () => E5.Export.excel(flt()) }),
        U.el('button', { class: 'btn btn--ghost', text: 'CSV', onClick: () => E5.Export.csv(flt()) }),
        U.el('button', { class: 'btn btn--ghost', text: 'JSON', onClick: () => E5.Export.json(flt()) }),
        U.el('button', { class: 'btn btn--ghost', text: 'PDF', onClick: () => E5.Export.pdf(flt()) }),
      ]),
    ]));
    refresh();
  }

  function register() {
    if (!App.Admin || !App.Admin.registerSection) return;
    App.Admin.registerSection({ id: 'masivo', label: 'Gestión masiva', icon: '⚙️', render: sectionBulk });
    App.Admin.registerSection({ id: 'config-general', label: 'Configuración', icon: '🏪', render: sectionConfig });
    App.Admin.registerSection({ id: 'seo', label: 'SEO', icon: '🔍', render: sectionSEO });
    App.Admin.registerSection({ id: 'exportar', label: 'Exportar', icon: '📤', render: sectionExport });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', register); else register();
})(window.App = window.App || {});
