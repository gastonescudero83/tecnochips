/* =============================================================================
 * ui-admin.js — Panel de administración (protegido por contraseña)
 * -----------------------------------------------------------------------------
 * Toda la tienda se administra desde acá, sin tocar el código. Secciones:
 *   Dashboard · Productos · Categorías · Comentarios · Apariencia ·
 *   Importar/Exportar · Seguridad
 * Renderiza en #admin-root (app.js alterna su visibilidad según la ruta #/admin).
 * La sesión se mantiene en sessionStorage (se cierra al recargar/cerrar pestaña).
 * ========================================================================== */
(function (App) {
  'use strict';

  const { U, Store, Router, Images, IO } = App;
  const money = (v) => U.formatCurrency(v, Store.state.settings);
  const SESSION_KEY = 'tienda_admin_session';

  let root = null;
  let listPage = 1; // paginación de la tabla de productos
  let listFilter = '';

  function mount(el) { root = el; }

  /* ---- helpers de formulario -------------------------------------------- */
  function f(labelText, input, hint) {
    const group = U.el('label', { class: 'a-field' }, [U.el('span', { class: 'a-field__label', text: labelText })]);
    group.appendChild(input);
    if (hint) group.appendChild(U.el('small', { class: 'a-field__hint', text: hint }));
    return group;
  }
  const inp = (props) => U.el('input', Object.assign({ class: 'input' }, props));
  const ta = (props) => U.el('textarea', Object.assign({ class: 'input' }, props));

  function modal(title, bodyNode, { wide, onClose } = {}) {
    const overlay = U.el('div', { class: 'modal-overlay' });
    const onEsc = (e) => { if (e.key === 'Escape') close(); };
    const close = () => { document.removeEventListener('keydown', onEsc); overlay.remove(); document.body.style.overflow = ''; if (onClose) onClose(); };
    document.addEventListener('keydown', onEsc); // accesibilidad: cerrar con Escape
    const box = U.el('div', { class: 'modal' + (wide ? ' modal--wide' : '') });
    box.appendChild(U.el('div', { class: 'modal__head' }, [
      U.el('h3', { text: title }),
      U.el('button', { class: 'icon-btn', 'aria-label': 'Cerrar', onClick: close, html: '✕' }),
    ]));
    const body = U.el('div', { class: 'modal__body' });
    U.append(body, bodyNode);
    box.appendChild(body);
    overlay.appendChild(box);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';
    return { overlay, box, body, close };
  }

  /* ====================================================================== *
   *  AUTENTICACIÓN
   * ====================================================================== */
  function isAuthed() { return sessionStorage.getItem(SESSION_KEY) === '1'; }
  function setAuthed(v) { v ? sessionStorage.setItem(SESSION_KEY, '1') : sessionStorage.removeItem(SESSION_KEY); }

  async function renderGate() {
    U.clear(root);
    const hasPw = await Store.hasPassword();
    const card = U.el('div', { class: 'a-gate' });
    card.appendChild(U.el('a', { class: 'a-gate__back', href: '#/', text: '← Volver a la tienda' }));
    card.appendChild(U.el('h1', { class: 'a-gate__title', text: hasPw ? '🔒 Panel de administración' : '🔑 Crear contraseña de administrador' }));

    const form = U.el('form', { class: 'a-gate__form' });
    if (!hasPw) {
      card.appendChild(U.el('p', { class: 'a-gate__hint', text: 'Es la primera vez. Definí una contraseña para proteger el panel.' }));
      const p1 = inp({ type: 'password', placeholder: 'Nueva contraseña', required: true, autocomplete: 'new-password' });
      const p2 = inp({ type: 'password', placeholder: 'Repetir contraseña', required: true, autocomplete: 'new-password' });
      form.appendChild(f('Contraseña', p1));
      form.appendChild(f('Repetir', p2));
      form.appendChild(U.el('button', { class: 'btn btn--primary btn--block', type: 'submit', text: 'Crear y entrar' }));
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (p1.value.length < 4) return U.toast('Mínimo 4 caracteres', 'error');
        if (p1.value !== p2.value) return U.toast('Las contraseñas no coinciden', 'error');
        await Store.setPassword(p1.value);
        setAuthed(true);
        U.toast('Contraseña creada', 'success');
        renderRoute(Router.current());
      });
    } else {
      const pw = inp({ type: 'password', placeholder: 'Contraseña', required: true, autocomplete: 'current-password' });
      form.appendChild(f('Contraseña', pw));
      form.appendChild(U.el('button', { class: 'btn btn--primary btn--block', type: 'submit', text: 'Ingresar' }));
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        // Rate limiting: máx. 5 intentos por minuto (frena fuerza bruta casual).
        if (App.E5 && App.E5.Security) {
          const rl = App.E5.Security.rateLimit.check('admin_login', { max: 5, windowMs: 60000 });
          if (!rl.allowed) {
            U.toast('Demasiados intentos. Esperá ' + Math.ceil(rl.retryInMs / 1000) + ' segundos.', 'error', 4000);
            return;
          }
        }
        if (await Store.checkPassword(pw.value)) {
          if (App.E5 && App.E5.Security) App.E5.Security.rateLimit.reset('admin_login');
          setAuthed(true);
          renderRoute(Router.current());
        } else {
          U.toast('Contraseña incorrecta', 'error');
          pw.select();
        }
      });
    }
    card.appendChild(form);
    root.appendChild(card);
  }

  /* ====================================================================== *
   *  LAYOUT DEL PANEL
   * ====================================================================== */
  const SECTIONS = [
    { id: 'dashboard', label: 'Panel', icon: '📊' },
    { id: 'productos', label: 'Productos', icon: '📦' },
    { id: 'categorias', label: 'Categorías', icon: '🗂️' },
    { id: 'comentarios', label: 'Comentarios', icon: '💬' },
    { id: 'apariencia', label: 'Apariencia', icon: '🎨' },
    { id: 'importar', label: 'Importar Catálogo', icon: '🤖' },
    { id: 'datos', label: 'Importar / Exportar', icon: '💾' },
    { id: 'seguridad', label: 'Seguridad', icon: '🔐' },
  ];

  /* Secciones extra registrables por módulos externos (ETAPA 5). Aditivo:
   * cada entrada = { id, label, icon, render(contentEl) }. */
  const EXTRA_SECTIONS = [];
  function registerSection(s) {
    if (s && s.id && typeof s.render === 'function' && !EXTRA_SECTIONS.some((x) => x.id === s.id)) {
      EXTRA_SECTIONS.push(s);
    }
  }
  function allSections() { return SECTIONS.concat(EXTRA_SECTIONS); }

  function renderShell(active) {
    U.clear(root);
    const layout = U.el('div', { class: 'a-layout' });

    // Sidebar
    const aside = U.el('aside', { class: 'a-sidebar' });
    aside.appendChild(U.el('div', { class: 'a-sidebar__brand', text: '⚙️ ' + (Store.state.settings.storeName || 'Admin') }));
    const nav = U.el('nav', { class: 'a-nav' });
    allSections().forEach((s) => {
      const a = U.el('a', { class: 'a-nav__item' + (s.id === active ? ' is-active' : ''), href: '#/admin/' + s.id },
        [U.el('span', { class: 'a-nav__icon', text: s.icon }), U.el('span', { text: s.label })]);
      nav.appendChild(a);
    });
    aside.appendChild(nav);
    aside.appendChild(U.el('div', { class: 'a-sidebar__foot' }, [
      U.el('a', { class: 'btn btn--ghost btn--block', href: '#/', text: '👁️ Ver tienda' }),
      U.el('button', { class: 'btn btn--ghost btn--block', text: '🚪 Salir', onClick: () => { setAuthed(false); Router.go('/'); } }),
    ]));
    layout.appendChild(aside);

    // Topbar (mobile) + content
    const mainCol = U.el('div', { class: 'a-main' });
    const topbar = U.el('div', { class: 'a-topbar' }, [
      U.el('strong', { text: (allSections().find((s) => s.id === active) || {}).label || 'Panel' }),
      U.el('select', { class: 'a-topbar__sel', onChange: (e) => Router.go('/admin/' + e.target.value) },
        allSections().map((s) => U.el('option', { value: s.id, text: s.icon + ' ' + s.label, selected: s.id === active ? true : null }))),
    ]);
    mainCol.appendChild(topbar);
    const content = U.el('div', { class: 'a-content', id: 'a-content' });
    mainCol.appendChild(content);
    layout.appendChild(mainCol);

    root.appendChild(layout);
    return content;
  }

  /* ====================================================================== *
   *  ROUTER DEL PANEL
   * ====================================================================== */
  function renderRoute(route) {
    if (!isAuthed()) return renderGate();
    const section = route.segments[1] || 'dashboard';
    const content = renderShell(section);
    switch (section) {
      case 'productos': return sectionProducts(content);
      case 'categorias': return sectionCategories(content);
      case 'comentarios': return sectionComments(content);
      case 'apariencia': return sectionAppearance(content);
      case 'importar': return App.AdminImport.render(content);
      case 'datos': return sectionData(content);
      case 'seguridad': return sectionSecurity(content);
      default: {
        const ext = EXTRA_SECTIONS.find((s) => s.id === section);
        if (ext) return ext.render(content);
        return sectionDashboard(content);
      }
    }
  }

  /* ====================================================================== *
   *  DASHBOARD
   * ====================================================================== */
  async function sectionDashboard(c) {
    const products = Store.state.products;
    const stats = [
      { label: 'Productos', value: products.length, icon: '📦', href: '#/admin/productos' },
      { label: 'Categorías', value: Store.state.categories.length, icon: '🗂️', href: '#/admin/categorias' },
      { label: 'En oferta', value: products.filter((p) => Store.isOnSale(p)).length, icon: '🔥' },
      { label: 'Sin stock', value: products.filter((p) => p.stock <= 0).length, icon: '⚠️' },
      { label: 'Destacados', value: products.filter((p) => p.featured).length, icon: '⭐' },
      { label: 'Comentarios', value: Store.state.comments.length, icon: '💬', href: '#/admin/comentarios' },
    ];
    const grid = U.el('div', { class: 'a-stats' });
    stats.forEach((s) => {
      const card = U.el(s.href ? 'a' : 'div', Object.assign({ class: 'a-stat' }, s.href ? { href: s.href } : {}), [
        U.el('span', { class: 'a-stat__icon', text: s.icon }),
        U.el('span', { class: 'a-stat__value', text: String(s.value) }),
        U.el('span', { class: 'a-stat__label', text: s.label }),
      ]);
      grid.appendChild(card);
    });
    c.appendChild(U.el('div', { class: 'a-card' }, [U.el('h2', { class: 'a-card__title', text: 'Resumen' }), grid]));

    // Accesos rápidos
    const quick = U.el('div', { class: 'a-quick' }, [
      U.el('button', { class: 'btn btn--primary', text: '➕ Nuevo producto', onClick: () => openProductForm() }),
      U.el('a', { class: 'btn btn--ghost', href: '#/admin/apariencia', text: '🎨 Personalizar tienda' }),
      U.el('a', { class: 'btn btn--ghost', href: '#/admin/datos', text: '💾 Backup / Importar' }),
    ]);
    c.appendChild(U.el('div', { class: 'a-card' }, [U.el('h2', { class: 'a-card__title', text: 'Acciones rápidas' }), quick]));

    // Almacenamiento
    const storageCard = U.el('div', { class: 'a-card' }, [U.el('h2', { class: 'a-card__title', text: 'Almacenamiento local' })]);
    const info = U.el('p', { class: 'a-muted', text: 'Calculando…' });
    storageCard.appendChild(info);
    storageCard.appendChild(U.el('p', { class: 'a-muted', text: 'Motor: ' + (App.DB.mode === 'idb' ? 'IndexedDB' : 'localStorage') }));
    c.appendChild(storageCard);
    if (navigator.storage && navigator.storage.estimate) {
      navigator.storage.estimate().then((est) => {
        const usedMB = (est.usage / 1048576).toFixed(1);
        const quotaMB = (est.quota / 1048576).toFixed(0);
        info.textContent = `Usado: ${usedMB} MB de ~${quotaMB} MB disponibles`;
      }).catch(() => { info.textContent = 'No disponible'; });
    } else { info.textContent = 'No disponible en este navegador'; }
  }

  /* ====================================================================== *
   *  PRODUCTOS
   * ====================================================================== */
  function sectionProducts(c) {
    const head = U.el('div', { class: 'a-section-head' }, [
      U.el('h2', { class: 'a-card__title', text: 'Productos (' + Store.state.products.length + ')' }),
      U.el('button', { class: 'btn btn--primary', text: '➕ Nuevo', onClick: () => openProductForm() }),
    ]);
    c.appendChild(head);

    const search = inp({ type: 'search', placeholder: 'Filtrar por nombre, código o marca…', value: listFilter });
    search.addEventListener('input', U.debounce(() => { listFilter = search.value; listPage = 1; paint(); }, 150));
    c.appendChild(U.el('div', { class: 'a-toolbar' }, [search]));

    const tableWrap = U.el('div', { class: 'a-table-wrap' });
    c.appendChild(tableWrap);
    const pager = U.el('div', { class: 'a-pager' });
    c.appendChild(pager);

    function paint() {
      const term = U.normalize(listFilter.trim());
      let list = Store.state.products.slice().sort((a, b) => b.updatedAt - a.updatedAt);
      if (term) list = list.filter((p) => U.normalize(p.name + ' ' + p.code + ' ' + p.brand).indexOf(term) > -1);
      const per = 50;
      const pages = Math.max(1, Math.ceil(list.length / per));
      listPage = U.clamp(listPage, 1, pages);
      const slice = list.slice((listPage - 1) * per, listPage * per);

      U.clear(tableWrap);
      if (!list.length) { tableWrap.appendChild(U.el('p', { class: 'a-muted', text: 'No hay productos. Creá el primero con "Nuevo".' })); U.clear(pager); return; }

      const table = U.el('table', { class: 'a-table' });
      table.appendChild(U.el('thead', {}, U.el('tr', {}, [
        U.el('th', { text: '' }), U.el('th', { text: 'Producto' }), U.el('th', { text: 'Categoría' }),
        U.el('th', { text: 'Precio' }), U.el('th', { text: 'Stock' }), U.el('th', { text: '' }),
      ])));
      const tbody = U.el('tbody');
      slice.forEach((p) => {
        const cat = Store.getCategory(p.categoryId);
        const tr = U.el('tr', {}, [
          U.el('td', {}, U.el('img', { class: 'a-thumb', src: (p.images && p.images[0]) || '', alt: '', loading: 'lazy', onError: function () { this.style.visibility = 'hidden'; } })),
          U.el('td', {}, [U.el('strong', { text: p.name }), U.el('div', { class: 'a-muted a-small', text: (p.code || '') + (p.brand ? ' · ' + p.brand : '') }),
            p.active === false ? U.el('span', { class: 'a-tag a-tag--off', text: 'Oculto' }) : null].filter(Boolean)),
          U.el('td', { class: 'a-muted', text: cat ? cat.name : '—' }),
          U.el('td', {}, [Store.isOnSale(p) ? U.el('span', { class: 'a-price-sale', text: money(Store.effectivePrice(p)) }) : U.el('span', { text: money(Store.effectivePrice(p)) })]),
          U.el('td', {}, U.el('span', { class: p.stock <= 0 ? 'a-tag a-tag--danger' : (p.stock <= 5 ? 'a-tag a-tag--warn' : ''), text: String(p.stock) })),
          U.el('td', { class: 'a-row-actions' }, [
            U.el('button', { class: 'btn btn--sm btn--ghost', text: 'Editar', onClick: () => openProductForm(p) }),
            U.el('button', { class: 'btn btn--sm btn--danger-ghost', text: '🗑', title: 'Eliminar', onClick: () => removeProduct(p) }),
          ]),
        ]);
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      tableWrap.appendChild(table);

      U.clear(pager);
      if (pages > 1) {
        pager.appendChild(U.el('button', { class: 'btn btn--sm btn--ghost', text: '← Anterior', disabled: listPage <= 1 ? true : null, onClick: () => { listPage--; paint(); } }));
        pager.appendChild(U.el('span', { class: 'a-muted', text: `Página ${listPage} / ${pages}` }));
        pager.appendChild(U.el('button', { class: 'btn btn--sm btn--ghost', text: 'Siguiente →', disabled: listPage >= pages ? true : null, onClick: () => { listPage++; paint(); } }));
      }
    }
    paint();
  }

  async function removeProduct(p) {
    const yes = await U.confirm(`¿Eliminar "${p.name}"? Esta acción no se puede deshacer.`, { danger: true, okText: 'Eliminar' });
    if (!yes) return;
    await Store.deleteProduct(p.id);
    U.toast('Producto eliminado', 'success');
    renderRoute(Router.current());
  }

  function openProductForm(existing) {
    const p = existing ? JSON.parse(JSON.stringify(existing)) : App.productSchema();
    let images = (p.images || []).slice();

    const name = inp({ type: 'text', value: p.name, required: true });
    const code = inp({ type: 'text', value: p.code });
    const brand = inp({ type: 'text', value: p.brand });
    const desc = ta({ rows: '3' }); desc.value = p.description || '';
    const price = inp({ type: 'number', value: p.price || '', min: '0', step: '0.01' });
    const priceOld = inp({ type: 'number', value: p.priceOld != null ? p.priceOld : '', min: '0', step: '0.01' });
    const priceSale = inp({ type: 'number', value: p.priceSale != null ? p.priceSale : '', min: '0', step: '0.01' });
    const stock = inp({ type: 'number', value: p.stock || 0, min: '0', step: '1' });

    // Categoría / subcategoría
    const catSel = U.el('select', { class: 'input' });
    catSel.appendChild(U.el('option', { value: '', text: '— Sin categoría —' }));
    Store.state.categories.forEach((c) => catSel.appendChild(U.el('option', { value: c.id, text: c.name, selected: c.id === p.categoryId ? true : null })));
    const subSel = U.el('select', { class: 'input' });
    function fillSubs() {
      U.clear(subSel);
      subSel.appendChild(U.el('option', { value: '', text: '— Sin subcategoría —' }));
      const cat = Store.getCategory(catSel.value);
      (cat ? cat.subcategories || [] : []).forEach((s) => subSel.appendChild(U.el('option', { value: s.id, text: s.name, selected: s.id === p.subcategoryId ? true : null })));
    }
    catSel.addEventListener('change', fillSubs); fillSubs();

    // Etiquetas
    const tagsWrap = U.el('div', { class: 'a-checks' });
    (Store.state.settings.tags || []).forEach((t) => {
      const cb = U.el('input', { type: 'checkbox', value: t, checked: (p.tags || []).indexOf(t) > -1 ? true : null });
      tagsWrap.appendChild(U.el('label', { class: 'a-check' }, [cb, U.el('span', { text: t })]));
    });

    // Modelo (lo usa la importación inteligente para matchear) y flags
    const model = inp({ type: 'text', value: p.model || '' });
    const fFeatured = U.el('input', { type: 'checkbox', checked: p.featured ? true : null });
    const fNew = U.el('input', { type: 'checkbox', checked: p.isNew ? true : null });
    const fActive = U.el('input', { type: 'checkbox', checked: p.active !== false ? true : null });
    const fLock = U.el('input', { type: 'checkbox', checked: p.priceLock ? true : null });

    // Imágenes
    const imgGrid = U.el('div', { class: 'a-img-grid' });
    function paintImgs() {
      U.clear(imgGrid);
      images.forEach((src, i) => {
        const cell = U.el('div', { class: 'a-img-cell' + (i === 0 ? ' is-main' : '') }, [
          U.el('img', { src, alt: '' }),
          i === 0 ? U.el('span', { class: 'a-img-main', text: 'Principal' }) : null,
          U.el('div', { class: 'a-img-actions' }, [
            i !== 0 ? U.el('button', { class: 'a-img-btn', title: 'Hacer principal', text: '★', type: 'button', onClick: () => { images.splice(i, 1); images.unshift(src); paintImgs(); } }) : null,
            U.el('button', { class: 'a-img-btn a-img-btn--del', title: 'Quitar', text: '✕', type: 'button', onClick: () => { images.splice(i, 1); paintImgs(); } }),
          ].filter(Boolean)),
        ].filter(Boolean));
        imgGrid.appendChild(cell);
      });
    }
    paintImgs();
    const fileInput = U.el('input', { type: 'file', accept: 'image/*', multiple: true, class: 'a-file' });
    const uploadBtn = U.el('button', { class: 'btn btn--ghost', type: 'button', text: '📷 Subir imágenes' });
    uploadBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', async () => {
      if (!fileInput.files.length) return;
      uploadBtn.disabled = true; uploadBtn.textContent = 'Procesando…';
      const out = await Images.compressMany(fileInput.files);
      images = images.concat(out);
      fileInput.value = '';
      uploadBtn.disabled = false; uploadBtn.textContent = '📷 Subir imágenes';
      paintImgs();
    });

    // Cuerpo del formulario
    const body = U.el('form', { class: 'a-form' });
    body.appendChild(U.el('div', { class: 'a-grid2' }, [f('Nombre *', name), f('Código interno', code)]));
    body.appendChild(U.el('div', { class: 'a-grid3' }, [f('Marca', brand), f('Modelo', model), f('Stock', stock)]));
    body.appendChild(U.el('div', { class: 'a-grid2' }, [f('Categoría', catSel), f('Subcategoría', subSel)]));
    body.appendChild(f('Descripción', desc));
    body.appendChild(U.el('div', { class: 'a-grid3' }, [
      f('Precio', price, 'Precio de lista'),
      f('Precio anterior', priceOld, 'Para mostrar tachado'),
      f('Precio oferta', priceSale, 'Si se completa, es el precio final'),
    ]));
    body.appendChild(U.el('label', { class: 'a-check imp-lock' }, [fLock,
      U.el('span', { text: '🔒 Precio manual (la importación de catálogos no modificará este precio)' })]));
    body.appendChild(f('Etiquetas', tagsWrap));
    body.appendChild(U.el('div', { class: 'a-flags' }, [
      U.el('label', { class: 'a-check' }, [fFeatured, U.el('span', { text: '⭐ Destacado' })]),
      U.el('label', { class: 'a-check' }, [fNew, U.el('span', { text: '🆕 Nuevo' })]),
      U.el('label', { class: 'a-check' }, [fActive, U.el('span', { text: '👁️ Visible en la tienda' })]),
    ]));
    body.appendChild(f('Imágenes', U.el('div', {}, [U.el('div', { class: 'a-upload' }, [uploadBtn, fileInput]), imgGrid]),
      'La primera imagen es la principal. Se comprimen automáticamente.'));

    const saveBtn = U.el('button', { class: 'btn btn--primary', type: 'submit', text: existing ? 'Guardar cambios' : 'Crear producto' });
    body.appendChild(U.el('div', { class: 'a-form__foot' }, [saveBtn]));

    const m = modal(existing ? 'Editar producto' : 'Nuevo producto', body, { wide: true });
    body.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!name.value.trim()) return U.toast('El nombre es obligatorio', 'error');
      const payload = Object.assign(p, {
        name: name.value.trim(), code: code.value.trim(), brand: brand.value.trim(),
        categoryId: catSel.value, subcategoryId: subSel.value,
        description: desc.value.trim(),
        price: U.parsePrice(price.value),
        priceOld: priceOld.value === '' ? null : U.parsePrice(priceOld.value),
        priceSale: priceSale.value === '' ? null : U.parsePrice(priceSale.value),
        stock: parseInt(stock.value, 10) || 0,
        tags: U.$$('input[type=checkbox]', tagsWrap).filter((x) => x.checked).map((x) => x.value),
        model: model.value.trim(),
        featured: fFeatured.checked, isNew: fNew.checked, active: fActive.checked,
        priceLock: fLock.checked,
        images,
      });
      await Store.saveProduct(payload);
      m.close();
      U.toast('Producto guardado', 'success');
      renderRoute(Router.current());
    });
  }

  /* ====================================================================== *
   *  CATEGORÍAS
   * ====================================================================== */
  function sectionCategories(c) {
    c.appendChild(U.el('div', { class: 'a-section-head' }, [
      U.el('h2', { class: 'a-card__title', text: 'Categorías' }),
      U.el('button', { class: 'btn btn--primary', text: '➕ Nueva categoría', onClick: () => openCategoryForm() }),
    ]));

    const list = U.el('div', { class: 'a-cats' });
    Store.state.categories.slice().sort((a, b) => (a.order || 0) - (b.order || 0)).forEach((cat) => {
      const card = U.el('div', { class: 'a-cat' });
      card.appendChild(U.el('div', { class: 'a-cat__head' }, [
        U.el('strong', { text: (cat.icon ? cat.icon + ' ' : '') + cat.name }),
        U.el('div', { class: 'a-row-actions' }, [
          U.el('button', { class: 'btn btn--sm btn--ghost', text: 'Editar', onClick: () => openCategoryForm(cat) }),
          U.el('button', { class: 'btn btn--sm btn--danger-ghost', text: '🗑', onClick: () => removeCategory(cat) }),
        ]),
      ]));
      // Subcategorías: nombre (click para renombrar) + cantidad de productos + quitar
      const subs = U.el('div', { class: 'a-subs' });
      (cat.subcategories || []).forEach((s) => {
        const count = Store.productCountInSubcategory(cat.id, s.id);
        const nameSpan = U.el('span', {
          text: s.name + (count ? ' (' + count + ')' : ''),
          title: 'Click para renombrar',
          style: { cursor: 'pointer' },
        });
        nameSpan.addEventListener('click', () => {
          const editInput = inp({ type: 'text', value: s.name, class: 'input input--sm a-sub-input' });
          nameSpan.replaceWith(editInput);
          editInput.focus(); editInput.select();
          let done = false;
          const save = async () => {
            if (done) return; done = true;
            const val = editInput.value.trim();
            if (val && val !== s.name) {
              await Store.renameSubcategory(cat.id, s.id, val);
              U.toast('Subcategoría renombrada', 'success');
            }
            renderRoute(Router.current());
          };
          editInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); save(); }
            else if (e.key === 'Escape') { e.preventDefault(); done = true; renderRoute(Router.current()); }
          });
          editInput.addEventListener('blur', save);
        });
        subs.appendChild(U.el('span', { class: 'a-sub' }, [
          nameSpan,
          U.el('button', { class: 'a-sub__del', text: '✕', title: 'Eliminar', onClick: () => removeSubcategory(cat, s, count) }),
        ]));
      });
      const addSub = inp({ type: 'text', placeholder: 'Nueva subcategoría…', class: 'input input--sm a-sub-input' });
      const doAddSub = async () => {
        const val = addSub.value.trim();
        if (!val) return;
        await Store.addSubcategory(cat.id, val);
        renderRoute(Router.current());
      };
      addSub.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); doAddSub(); } });
      // Botón visible además del Enter: que se pueda agregar sin adivinar el atajo.
      subs.appendChild(addSub);
      subs.appendChild(U.el('button', { class: 'btn btn--sm btn--ghost', type: 'button', text: '➕ Agregar', onClick: doAddSub }));
      card.appendChild(subs);
      list.appendChild(card);
    });
    if (!Store.state.categories.length) list.appendChild(U.el('p', { class: 'a-muted', text: 'Todavía no hay categorías.' }));
    c.appendChild(list);
  }

  function openCategoryForm(existing) {
    const cat = existing || { name: '', icon: '🛍️' };
    const name = inp({ type: 'text', value: cat.name, required: true });
    const iconI = inp({ type: 'text', value: cat.icon || '', placeholder: 'Emoji, ej: 📱', maxlength: '4' });

    // Imagen de la categoría (para la tira de la portada, estilo retail).
    // Si no se elige, la tienda usa la foto del primer producto de la categoría.
    let image = cat.image || '';
    const imgPrev = U.el('div', { class: 'a-img-grid' });
    function paintImg() {
      U.clear(imgPrev);
      if (image) {
        imgPrev.appendChild(U.el('div', { class: 'a-img-cell' }, [
          U.el('img', { src: image, alt: '' }),
          U.el('div', { class: 'a-img-actions' }, U.el('button', { class: 'a-img-btn a-img-btn--del', text: '✕', title: 'Quitar', type: 'button', onClick: () => { image = ''; paintImg(); } })),
        ]));
      } else {
        imgPrev.appendChild(U.el('span', { class: 'a-muted a-small', text: 'Sin imagen propia: se usa la foto del primer producto de la categoría.' }));
      }
    }
    paintImg();
    const imgPick = imgPicker((d) => { image = d; paintImg(); }, { maxDim: 400 });

    const body = U.el('form', { class: 'a-form' }, [
      U.el('div', { class: 'a-grid2' }, [f('Nombre *', name), f('Ícono (emoji, respaldo sin imagen)', iconI)]),
      f('Imagen (portada)', U.el('div', {}, [imgPick, imgPrev])),
      U.el('div', { class: 'a-form__foot' }, [U.el('button', { class: 'btn btn--primary', type: 'submit', text: existing ? 'Guardar' : 'Crear' })]),
    ]);
    const m = modal(existing ? 'Editar categoría' : 'Nueva categoría', body);
    body.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!name.value.trim()) return U.toast('El nombre es obligatorio', 'error');
      await Store.saveCategory(Object.assign({}, existing || {}, {
        name: name.value.trim(),
        icon: iconI.value.trim() || '🛍️',
        image,
      }));
      m.close(); U.toast('Categoría guardada', 'success'); renderRoute(Router.current());
    });
  }

  async function removeCategory(cat) {
    const yes = await U.confirm(`¿Eliminar la categoría "${cat.name}"? Los productos quedarán sin categoría (no se borran).`, { danger: true, okText: 'Eliminar' });
    if (!yes) return;
    await Store.deleteCategory(cat.id);
    U.toast('Categoría eliminada', 'success');
    renderRoute(Router.current());
  }

  /** Elimina una subcategoría. Si no tiene productos, confirma y listo. Si
   *  tiene, pregunta si dejarlos sin subcategoría o moverlos a otra de la
   *  misma categoría antes de borrar — nunca se pierde el dato en silencio. */
  async function removeSubcategory(cat, sub, count) {
    if (!count) {
      const yes = await U.confirm(`¿Eliminar la subcategoría "${sub.name}"?`, { danger: true, okText: 'Eliminar' });
      if (!yes) return;
      await Store.deleteSubcategory(cat.id, sub.id);
      U.toast('Subcategoría eliminada', 'success');
      renderRoute(Router.current());
      return;
    }

    const others = (cat.subcategories || []).filter((s) => s.id !== sub.id);
    const moveSel = others.length
      ? U.el('select', { class: 'input' }, [U.el('option', { value: '', text: '— Dejar sin subcategoría —' })].concat(
        others.map((s) => U.el('option', { value: s.id, text: s.name }))
      ))
      : null;

    const cancelBtn = U.el('button', { class: 'btn btn--ghost', type: 'button', text: 'Cancelar' });
    const okBtn = U.el('button', { class: 'btn btn--danger', type: 'button', text: 'Eliminar' });

    const body = U.el('div', { class: 'a-form' }, [
      U.el('p', { text: `"${sub.name}" tiene ${count} producto(s) asignado(s). ¿Qué hacemos con ellos?` }),
      moveSel
        ? f('Mover a otra subcategoría (opcional)', moveSel, 'Si no elegís ninguna, quedan sin subcategoría.')
        : U.el('p', { class: 'a-muted', text: 'No hay otra subcategoría en esta categoría: quedarán sin subcategoría.' }),
      U.el('div', { class: 'a-form__foot' }, [cancelBtn, okBtn]),
    ]);

    const m = modal('Eliminar subcategoría', body);
    cancelBtn.addEventListener('click', m.close);
    okBtn.addEventListener('click', async () => {
      const reassignTo = moveSel ? moveSel.value : '';
      await Store.deleteSubcategory(cat.id, sub.id, reassignTo || undefined);
      m.close();
      U.toast('Subcategoría eliminada', 'success');
      renderRoute(Router.current());
    });
  }

  /* ====================================================================== *
   *  COMENTARIOS
   * ====================================================================== */
  function sectionComments(c) {
    c.appendChild(U.el('div', { class: 'a-section-head' }, [
      U.el('h2', { class: 'a-card__title', text: 'Comentarios' }),
      U.el('button', { class: 'btn btn--primary', text: '➕ Nuevo comentario', onClick: () => openCommentForm() }),
    ]));

    // Filtro por producto
    const prodSel = U.el('select', { class: 'input' });
    prodSel.appendChild(U.el('option', { value: '', text: 'Todos los productos' }));
    Store.state.products.forEach((p) => prodSel.appendChild(U.el('option', { value: p.id, text: p.name })));
    const listWrap = U.el('div', { class: 'a-comments' });
    prodSel.addEventListener('change', paint);
    c.appendChild(U.el('div', { class: 'a-toolbar' }, [prodSel]));
    c.appendChild(listWrap);

    function paint() {
      U.clear(listWrap);
      let list = Store.state.comments.slice().sort((a, b) => b.date - a.date);
      if (prodSel.value) list = list.filter((x) => x.productId === prodSel.value);
      if (!list.length) { listWrap.appendChild(U.el('p', { class: 'a-muted', text: 'No hay comentarios.' })); return; }
      list.forEach((cm) => {
        const prod = Store.getProduct(cm.productId);
        const row = U.el('div', { class: 'a-comment' }, [
          cm.image ? U.el('img', { class: 'a-thumb', src: cm.image, alt: '' }) : null,
          U.el('div', { class: 'a-comment__body' }, [
            U.el('div', {}, [U.el('strong', { text: cm.author || 'Cliente' }), U.el('span', { class: 'a-muted a-small', text: '  ' + '★'.repeat(cm.rating) + '☆'.repeat(5 - cm.rating) }),
              U.el('span', { class: 'a-muted a-small', text: '  · ' + U.formatDate(cm.date) })]),
            U.el('div', { class: 'a-muted a-small', text: prod ? prod.name : '(producto eliminado)' }),
            U.el('p', { class: 'a-comment__text', text: cm.text }),
          ]),
          U.el('div', { class: 'a-row-actions' }, [
            U.el('label', { class: 'a-check a-small', title: 'Mostrar en la tienda' }, [
              U.el('input', { type: 'checkbox', checked: cm.approved ? true : null, onChange: async (e) => { await Store.saveComment(Object.assign({}, cm, { approved: e.target.checked })); } }),
              U.el('span', { text: 'Visible' }),
            ]),
            U.el('button', { class: 'btn btn--sm btn--ghost', text: 'Editar', onClick: () => openCommentForm(cm) }),
            U.el('button', { class: 'btn btn--sm btn--danger-ghost', text: '🗑', onClick: async () => { if (await U.confirm('¿Eliminar comentario?', { danger: true, okText: 'Eliminar' })) { await Store.deleteComment(cm.id); paint(); } } }),
          ]),
        ].filter(Boolean));
        listWrap.appendChild(row);
      });
    }
    paint();
  }

  function openCommentForm(existing) {
    const cm = existing || App.commentSchema();
    const prodSel = U.el('select', { class: 'input', required: true });
    prodSel.appendChild(U.el('option', { value: '', text: '— Elegí un producto —' }));
    Store.state.products.forEach((p) => prodSel.appendChild(U.el('option', { value: p.id, text: p.name, selected: p.id === cm.productId ? true : null })));
    const author = inp({ type: 'text', value: cm.author || '' });
    const text = ta({ rows: '3' }); text.value = cm.text || '';
    const rating = U.el('select', { class: 'input' });
    [5, 4, 3, 2, 1].forEach((n) => rating.appendChild(U.el('option', { value: n, text: '★'.repeat(n) + '☆'.repeat(5 - n) + '  (' + n + ')', selected: n === (cm.rating || 5) ? true : null })));
    let image = cm.image || '';
    const imgPrev = U.el('div', { class: 'a-img-grid' });
    function paintImg() { U.clear(imgPrev); if (image) imgPrev.appendChild(U.el('div', { class: 'a-img-cell' }, [U.el('img', { src: image }), U.el('div', { class: 'a-img-actions' }, U.el('button', { class: 'a-img-btn a-img-btn--del', text: '✕', type: 'button', onClick: () => { image = ''; paintImg(); } }))])); }
    paintImg();
    const file = U.el('input', { type: 'file', accept: 'image/*', class: 'a-file' });
    const upBtn = U.el('button', { class: 'btn btn--ghost', type: 'button', text: '📷 Imagen (opcional)', onClick: () => file.click() });
    file.addEventListener('change', async () => { if (file.files[0]) { image = await Images.compress(file.files[0]); paintImg(); } });

    const body = U.el('form', { class: 'a-form' }, [
      f('Producto *', prodSel),
      U.el('div', { class: 'a-grid2' }, [f('Nombre del cliente', author), f('Calificación', rating)]),
      f('Comentario', text),
      f('Imagen', U.el('div', {}, [U.el('div', { class: 'a-upload' }, [upBtn, file]), imgPrev])),
      U.el('div', { class: 'a-form__foot' }, [U.el('button', { class: 'btn btn--primary', type: 'submit', text: existing ? 'Guardar' : 'Crear' })]),
    ]);
    const m = modal(existing ? 'Editar comentario' : 'Nuevo comentario', body);
    body.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!prodSel.value) return U.toast('Elegí un producto', 'error');
      await Store.saveComment(Object.assign({}, cm, {
        productId: prodSel.value, author: author.value.trim(), text: text.value.trim(),
        rating: Number(rating.value), image,
      }));
      m.close(); U.toast('Comentario guardado', 'success'); renderRoute(Router.current());
    });
  }

  /* ====================================================================== *
   *  APARIENCIA (branding, banner, carrusel, colores, WhatsApp, etiquetas)
   * ====================================================================== */
  function sectionAppearance(c) {
    const s = JSON.parse(JSON.stringify(Store.state.settings));

    /* --- Identidad --- */
    const storeName = inp({ type: 'text', value: s.storeName });
    const slogan = inp({ type: 'text', value: s.slogan || '' });
    const footer = inp({ type: 'text', value: s.footer || '' });
    let logo = s.logo || '';
    const logoPrev = U.el('div', { class: 'a-logo-prev' });
    function paintLogo() { U.clear(logoPrev); if (logo) { logoPrev.appendChild(U.el('img', { src: logo, alt: 'logo' })); logoPrev.appendChild(U.el('button', { class: 'btn btn--sm btn--danger-ghost', type: 'button', text: 'Quitar', onClick: () => { logo = ''; paintLogo(); } })); } else logoPrev.appendChild(U.el('span', { class: 'a-muted', text: 'Sin logo (se usa el nombre)' })); }
    paintLogo();
    const logoFile = imgPicker((d) => { logo = d; paintLogo(); }, { maxDim: 512 });

    const idCard = card('🏪 Identidad', [
      U.el('div', { class: 'a-grid2' }, [f('Nombre de la tienda', storeName), f('Eslogan', slogan)]),
      f('Texto del pie de página', footer),
      f('Logo', U.el('div', {}, [logoFile, logoPrev])),
    ]);

    /* --- WhatsApp --- */
    const wa = inp({ type: 'text', value: s.whatsapp || '', placeholder: 'Ej: 549XXXXXXXXXX' });
    const waTpl = ta({ rows: '6' }); waTpl.value = s.whatsappTemplate || '';
    const waCard = card('💬 WhatsApp', [
      f('Número (formato internacional, solo dígitos)', wa, 'Argentina: 549 + característica sin 0 + número sin 15. Ej: 5491122334455'),
      f('Plantilla del mensaje', waTpl, 'Tokens disponibles: {items} {total} {nombre} {direccion} {observaciones} {tienda}'),
    ]);

    /* --- Banner --- */
    const bTitle = inp({ type: 'text', value: s.banner.title || '' });
    const bSub = inp({ type: 'text', value: s.banner.subtitle || '' });
    const bCta = inp({ type: 'text', value: s.banner.ctaText || '' });
    const bTarget = U.el('select', { class: 'input' }, ['ofertas', 'novedades', 'destacados'].map((v) => U.el('option', { value: v, text: v, selected: v === s.banner.ctaTarget ? true : null })));
    let bImg = s.banner.image || '';
    const bPrev = U.el('div', { class: 'a-banner-prev' });
    function paintB() { bPrev.style.backgroundImage = bImg ? `url("${bImg}")` : ''; bPrev.classList.toggle('is-empty', !bImg); U.clear(bPrev); if (bImg) bPrev.appendChild(U.el('button', { class: 'btn btn--sm btn--danger-ghost', type: 'button', text: 'Quitar imagen', onClick: () => { bImg = ''; paintB(); } })); else bPrev.appendChild(U.el('span', { class: 'a-muted', text: 'Sin imagen de fondo' })); }
    paintB();
    const bFile = imgPicker((d) => { bImg = d; paintB(); }, { maxDim: 1600 });
    const bannerCard = card('🖼️ Banner principal', [
      U.el('div', { class: 'a-grid2' }, [f('Título', bTitle), f('Subtítulo', bSub)]),
      U.el('div', { class: 'a-grid2' }, [f('Texto del botón', bCta), f('El botón lleva a', bTarget)]),
      f('Imagen de fondo', U.el('div', {}, [bFile, bPrev])),
    ]);

    /* --- Carrusel --- */
    let slides = (s.carousel.slides || []).slice();
    const carAutoplay = U.el('input', { type: 'checkbox', checked: s.carousel.autoplay ? true : null });
    const carInterval = inp({ type: 'number', value: s.carousel.interval || 4500, min: '1500', step: '500' });
    const slidesWrap = U.el('div', { class: 'a-slides' });
    function paintSlides() {
      U.clear(slidesWrap);
      slides.forEach((sl, i) => {
        const prev = U.el('div', { class: 'a-slide-prev' });
        if (sl.image) prev.style.backgroundImage = `url("${sl.image}")`;
        const tIn = inp({ type: 'text', value: sl.title || '', placeholder: 'Título' });
        const sIn = inp({ type: 'text', value: sl.subtitle || '', placeholder: 'Subtítulo' });
        const tg = U.el('select', { class: 'input input--sm' }, ['', 'ofertas', 'novedades', 'destacados'].map((v) => U.el('option', { value: v, text: v || '(sin enlace)', selected: v === sl.target ? true : null })));
        tIn.addEventListener('input', () => sl.title = tIn.value);
        sIn.addEventListener('input', () => sl.subtitle = sIn.value);
        tg.addEventListener('change', () => sl.target = tg.value);
        const pick = imgPicker((d) => { sl.image = d; paintSlides(); }, { maxDim: 1600, small: true });
        slidesWrap.appendChild(U.el('div', { class: 'a-slide' }, [
          prev,
          U.el('div', { class: 'a-slide__fields' }, [tIn, sIn, tg, U.el('div', { class: 'a-slide__actions' }, [pick, U.el('button', { class: 'btn btn--sm btn--danger-ghost', type: 'button', text: 'Quitar slide', onClick: () => { slides.splice(i, 1); paintSlides(); } })])]),
        ]));
      });
    }
    paintSlides();
    const addSlide = U.el('button', { class: 'btn btn--ghost', type: 'button', text: '➕ Agregar slide', onClick: () => { slides.push({ image: '', title: '', subtitle: '', target: '' }); paintSlides(); } });
    const carCard = card('🎠 Carrusel promocional', [
      U.el('div', { class: 'a-grid2' }, [
        U.el('label', { class: 'a-check' }, [carAutoplay, U.el('span', { text: 'Reproducción automática' })]),
        f('Intervalo (ms)', carInterval),
      ]),
      slidesWrap, addSlide,
    ]);

    /* --- Colores --- */
    const themeInputs = {};
    const themeFields = [
      ['primary', 'Primario'], ['primaryDark', 'Primario oscuro'], ['accent', 'Acento'],
      ['bg', 'Fondo'], ['surface', 'Tarjetas'], ['text', 'Texto'],
      ['success', 'Éxito'], ['danger', 'Peligro'],
    ];
    const colorGrid = U.el('div', { class: 'a-colors' });
    themeFields.forEach(([k, label]) => {
      const ci = U.el('input', { type: 'color', value: s.theme[k] || '#000000', class: 'a-color' });
      themeInputs[k] = ci;
      colorGrid.appendChild(U.el('label', { class: 'a-color-field' }, [ci, U.el('span', { text: label })]));
    });
    const presets = U.el('div', { class: 'a-presets' });
    [['Azul', '#2563eb', '#1d4ed8', '#f59e0b'], ['Verde', '#16a34a', '#15803d', '#f59e0b'], ['Rosa', '#db2777', '#be185d', '#7c3aed'], ['Naranja', '#ea580c', '#c2410c', '#0ea5e9'], ['Negro', '#111827', '#000000', '#f59e0b']]
      .forEach(([name, p1, p2, ac]) => presets.appendChild(U.el('button', { class: 'a-preset', type: 'button', title: name, style: { background: p1 }, onClick: () => { themeInputs.primary.value = p1; themeInputs.primaryDark.value = p2; themeInputs.accent.value = ac; } })));
    const colorCard = card('🎨 Colores', [U.el('p', { class: 'a-muted', text: 'Atajos:' }), presets, colorGrid]);

    /* --- Etiquetas + límites --- */
    const tagsI = inp({ type: 'text', value: (s.tags || []).join(', ') });
    const featLimit = inp({ type: 'number', value: s.featuredLimit || 8, min: '1', step: '1' });
    const currency = inp({ type: 'text', value: s.currency || 'ARS' });
    const locale = inp({ type: 'text', value: s.locale || 'es-AR' });
    const miscCard = card('🏷️ Etiquetas y formato', [
      f('Etiquetas disponibles (separadas por coma)', tagsI),
      U.el('div', { class: 'a-grid3' }, [f('Destacados en portada', featLimit), f('Moneda (ISO)', currency), f('Locale', locale)]),
    ]);

    /* --- Guardar --- */
    const saveBar = U.el('div', { class: 'a-savebar' }, [
      U.el('button', { class: 'btn btn--primary btn--lg', text: '💾 Guardar cambios', onClick: save }),
    ]);

    c.appendChild(idCard); c.appendChild(waCard); c.appendChild(bannerCard);
    c.appendChild(carCard); c.appendChild(colorCard); c.appendChild(miscCard);
    c.appendChild(saveBar);

    async function save() {
      const theme = {}; Object.keys(themeInputs).forEach((k) => theme[k] = themeInputs[k].value);
      await Store.saveSettings({
        storeName: storeName.value.trim() || 'Mi Tienda',
        slogan: slogan.value.trim(),
        footer: footer.value.trim(),
        logo,
        whatsapp: App.WhatsApp.sanitizeNumber(wa.value),
        whatsappTemplate: waTpl.value,
        banner: { title: bTitle.value, subtitle: bSub.value, ctaText: bCta.value, ctaTarget: bTarget.value, image: bImg },
        carousel: { autoplay: carAutoplay.checked, interval: parseInt(carInterval.value, 10) || 4500, slides },
        theme,
        tags: tagsI.value.split(',').map((t) => t.trim()).filter(Boolean),
        featuredLimit: parseInt(featLimit.value, 10) || 8,
        currency: currency.value.trim() || 'ARS',
        locale: locale.value.trim() || 'es-AR',
      });
      App.Storefront.refreshChrome();
      U.toast('Cambios guardados ✓', 'success');
    }
  }

  /** Botón que abre el selector de archivos y devuelve un data URL comprimido. */
  function imgPicker(onPick, opts = {}) {
    const file = U.el('input', { type: 'file', accept: 'image/*', class: 'a-file' });
    const btn = U.el('button', { class: 'btn btn--ghost' + (opts.small ? ' btn--sm' : ''), type: 'button', text: '📷 Elegir imagen', onClick: () => file.click() });
    file.addEventListener('change', async () => {
      if (!file.files[0]) return;
      btn.disabled = true; btn.textContent = 'Procesando…';
      try { onPick(await Images.compress(file.files[0], { maxDim: opts.maxDim })); }
      finally { btn.disabled = false; btn.textContent = '📷 Elegir imagen'; file.value = ''; }
    });
    return U.el('span', { class: 'a-upload' }, [btn, file]);
  }

  function card(title, children) {
    return U.el('div', { class: 'a-card' }, [U.el('h2', { class: 'a-card__title', text: title })].concat(children));
  }

  /* ====================================================================== *
   *  DATOS: Importar / Exportar / Backup
   * ====================================================================== */
  function sectionData(c) {
    /* Productos CSV/XLSX */
    const impFile = U.el('input', { type: 'file', accept: '.csv,.xlsx,.xls', class: 'a-file' });
    impFile.addEventListener('change', async () => {
      if (!impFile.files[0]) return;
      try {
        // Validación por FIRMA real del archivo (magic bytes), no solo extensión.
        if (App.E5 && App.E5.Security) {
          const chk = await App.E5.Security.validateFile(impFile.files[0], { accept: ['xlsx', 'xls', 'csv'], maxMB: 25 });
          if (!chk.ok) { U.toast(chk.reason, 'error', 5000); impFile.value = ''; return; }
        }
        U.toast('Importando…', 'info');
        const res = await IO.importFile(impFile.files[0]);
        const det = (res.updated || res.created) ? ` (${res.created || 0} nuevos, ${res.updated || 0} actualizados)` : '';
        U.toast(`✓ ${res.imported} productos importados${det}`, 'success', 4000);
        renderRoute(Router.current());
      } catch (err) { U.toast(err.message || 'Error al importar', 'error', 5000); }
      impFile.value = '';
    });
    const prodCard = card('📦 Productos (CSV / Excel)', [
      U.el('p', { class: 'a-muted', text: 'Importá o exportá tu catálogo. El CSV es el formato recomendado (funciona sin Internet).' }),
      U.el('div', { class: 'a-btn-row' }, [
        U.el('button', { class: 'btn btn--ghost', text: '📄 Descargar plantilla CSV', onClick: () => IO.downloadTemplate() }),
        U.el('button', { class: 'btn btn--ghost', text: '⬇️ Exportar CSV', onClick: () => IO.exportProductsCSV() }),
        U.el('button', { class: 'btn btn--ghost', text: '⬇️ Exportar Excel', onClick: async () => { try { await IO.exportProductsXLSX(); } catch (e) { U.toast(e.message, 'error'); } } }),
      ]),
      f('Importar archivo (.csv / .xlsx)', impFile, 'Las categorías nuevas se crean automáticamente. Excel requiere Internet.'),
    ]);

    /* Backup JSON completo */
    const jsonFile = U.el('input', { type: 'file', accept: '.json,application/json', class: 'a-file' });
    const mergeChk = U.el('input', { type: 'checkbox' });
    jsonFile.addEventListener('change', async () => {
      if (!jsonFile.files[0]) return;
      // 1) Leer y validar ANTES de confirmar (nunca se borra nada con un archivo inválido).
      let data = null;
      try { data = JSON.parse(await U.readFileAsText(jsonFile.files[0])); }
      catch (_e) { U.toast('El archivo no es un JSON válido', 'error', 5000); jsonFile.value = ''; return; }
      const v = Store.validateBackup(data);
      if (!v.ok) { U.toast(v.reason, 'error', 6000); jsonFile.value = ''; return; }
      // 2) Confirmar mostrando qué contiene el backup.
      const resumen = `Contiene: ${v.counts.products} productos, ${v.counts.categories} categorías, ${v.counts.comments} comentarios` +
        (v.counts.kv ? ` y ${v.counts.kv} datos extra (promos/banners/patrones)` : '') + '.';
      const yes = await U.confirm(
        (mergeChk.checked ? '¿Combinar este backup con los datos actuales? ' : '¿Reemplazar TODOS los datos por los del backup? ') + resumen,
        { danger: !mergeChk.checked, okText: 'Importar' });
      if (yes) {
        try {
          await Store.importAll(data, { merge: mergeChk.checked });
          App.Storefront.refreshChrome();
          U.toast('Backup importado ✓', 'success');
          renderRoute(Router.current());
        } catch (e) { U.toast(e.message || 'No se pudo importar el backup', 'error', 6000); }
      }
      jsonFile.value = '';
    });
    const backupCard = card('💾 Backup completo (JSON)', [
      U.el('p', { class: 'a-muted', text: 'Incluye productos, categorías, comentarios y toda la configuración. Guardalo en un lugar seguro.' }),
      U.el('div', { class: 'a-btn-row' }, [
        U.el('button', { class: 'btn btn--primary', text: '⬇️ Exportar backup', onClick: async () => { const data = await Store.exportAll(); U.download(`backup-tienda-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(data, null, 2), 'application/json'); } }),
      ]),
      U.el('label', { class: 'a-check' }, [mergeChk, U.el('span', { text: 'Combinar en vez de reemplazar' })]),
      f('Restaurar backup (.json)', jsonFile),
    ]);

    /* Zona peligrosa */
    const dangerCard = card('⚠️ Zona de peligro', [
      U.el('p', { class: 'a-muted', text: 'Restablecer borra todo y vuelve a los datos de demostración.' }),
      U.el('button', { class: 'btn btn--danger', text: 'Restablecer de fábrica', onClick: async () => {
        if (await U.confirm('¿Seguro? Se borrarán TODOS tus productos, categorías y configuración.', { danger: true, okText: 'Sí, borrar todo' })) {
          await Store.factoryReset(); App.Storefront.refreshChrome(); U.toast('Tienda restablecida', 'success'); renderRoute(Router.current());
        }
      } }),
    ]);
    dangerCard.classList.add('a-card--danger');

    c.appendChild(prodCard); c.appendChild(backupCard); c.appendChild(dangerCard);
  }

  /* ====================================================================== *
   *  SEGURIDAD
   * ====================================================================== */
  function sectionSecurity(c) {
    // Con contraseña fija en config.js no se puede cambiar desde el panel.
    if (App.ADMIN_HASH) {
      c.appendChild(card('🔐 Contraseña', [
        U.el('p', { class: 'a-muted', text: 'La contraseña de administrador está fijada en el código (js/config.js). Nadie puede crear ni cambiar la clave desde el sitio publicado. Para cambiarla, generá un hash nuevo y reemplazalo en config.js.' }),
      ]));
      return;
    }
    const cur = inp({ type: 'password', autocomplete: 'current-password' });
    const n1 = inp({ type: 'password', autocomplete: 'new-password' });
    const n2 = inp({ type: 'password', autocomplete: 'new-password' });
    const form = U.el('form', { class: 'a-form' }, [
      f('Contraseña actual', cur),
      f('Nueva contraseña', n1),
      f('Repetir nueva contraseña', n2),
      U.el('div', { class: 'a-form__foot' }, [U.el('button', { class: 'btn btn--primary', type: 'submit', text: 'Cambiar contraseña' })]),
    ]);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!(await Store.checkPassword(cur.value))) return U.toast('La contraseña actual es incorrecta', 'error');
      if (n1.value.length < 4) return U.toast('Mínimo 4 caracteres', 'error');
      if (n1.value !== n2.value) return U.toast('Las contraseñas no coinciden', 'error');
      await Store.setPassword(n1.value);
      U.toast('Contraseña actualizada ✓', 'success');
      cur.value = n1.value = n2.value = '';
    });
    c.appendChild(card('🔐 Cambiar contraseña', [
      U.el('p', { class: 'a-muted', text: 'Nota: al no haber servidor, esta clave protege el acceso casual al panel, pero no cifra los datos del dispositivo.' }),
      form,
    ]));
  }

  App.Admin = { mount, renderRoute, isAuthed, registerSection };
})(window.App = window.App || {});
