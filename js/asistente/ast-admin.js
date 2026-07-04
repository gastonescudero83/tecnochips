/* =============================================================================
 * ast-admin.js — Asistente "TECNO" · Sección de administración (ETAPA 6)
 * -----------------------------------------------------------------------------
 * Agrega la sección "Asistente" al panel usando App.Admin.registerSection (el
 * mismo mecanismo aditivo de la Etapa 5). NO modifica el panel existente.
 *
 * Tres pestañas internas:
 *   ⚙️ Configuración  -> nombre, colores, posición, textos (bienvenida, sin
 *                        resultados, despedida), límites y comportamiento.
 *   ❓ Preguntas frec. -> alta/edición/baja de FAQ (pregunta, palabras clave,
 *                        respuesta con tokens {whatsapp} {instagram} …).
 *   🔤 Sinónimos       -> jerga y errores comunes que el asistente entiende.
 *
 * Todo se guarda localmente (IndexedDB) igual que el resto de la app.
 * ========================================================================== */
(function (App) {
  'use strict';

  var U = App.U;
  var tab = 'config';
  var lastContent = null;

  function C() { return App.Asst.Config; }
  function D() { return App.Asst.Data; }
  function rerender() { if (lastContent) renderMain(lastContent); }

  /* ---- Helpers de formulario (estilo del panel existente) ---------------- */
  function head(title, btn) { return U.el('div', { class: 'a-section-head' }, [U.el('h2', { text: title }), btn].filter(Boolean)); }
  function field(label, node, hint) {
    return U.el('label', { class: 'a-field' }, [
      U.el('span', { text: label }), node,
      hint ? U.el('span', { class: 'a-muted a-small', text: hint }) : null,
    ].filter(Boolean));
  }
  function input(attrs) { return U.el('input', Object.assign({ class: 'a-input' }, attrs)); }
  function textarea(attrs) { return U.el('textarea', Object.assign({ class: 'a-input', rows: 3 }, attrs)); }

  /* ---- Barra de pestañas ------------------------------------------------- */
  function tabBar(content) {
    var items = [['config', '⚙️ Configuración'], ['faq', '❓ Preguntas frecuentes'], ['syn', '🔤 Sinónimos']];
    var bar = U.el('div', { style: { display: 'flex', gap: '.5rem', flexWrap: 'wrap', margin: '0 0 1rem' } });
    items.forEach(function (it) {
      var active = tab === it[0];
      var b = U.el('button', {
        class: 'btn ' + (active ? 'btn--primary' : 'btn--ghost') + ' btn--sm',
        type: 'button', text: it[1],
        onClick: function () { tab = it[0]; renderMain(content); },
      });
      bar.appendChild(b);
    });
    return bar;
  }

  /* ---- Render principal -------------------------------------------------- */
  function renderMain(content) {
    lastContent = content;
    U.clear(content);
    content.appendChild(head('🤖 Asistente TECNO', U.el('button', { class: 'btn btn--ghost btn--sm', text: '👁️ Probar en la tienda', onClick: function () { location.hash = '#/'; setTimeout(function () { if (App.Asst.UI) App.Asst.UI.open(); }, 60); } })));
    content.appendChild(tabBar(content));
    var holder = U.el('div');
    content.appendChild(holder);
    holder.appendChild(U.el('p', { class: 'a-muted', text: 'Cargando…' }));
    Promise.all([C().ready(), D() ? D().ready() : Promise.resolve()]).then(function () {
      U.clear(holder);
      if (tab === 'config') renderConfig(holder);
      else if (tab === 'faq') renderFaqs(holder);
      else renderSyns(holder);
    });
  }

  /* ===================== PESTAÑA: CONFIGURACIÓN ========================== */
  function renderConfig(c) {
    var cfg = C().get();
    var enabledI = U.el('input', { type: 'checkbox', checked: cfg.enabled !== false ? true : null });
    var nameI = input({ value: cfg.name || '' });
    var avatarI = input({ value: cfg.avatar || '', maxlength: 4, style: { width: '80px' } });
    var launchI = input({ value: cfg.launcherIcon || '', maxlength: 4, style: { width: '80px' } });
    var accentI = input({ type: 'color', value: cfg.accent || '#c0894a' });
    var posSel = U.el('select', { class: 'a-input' }, [
      U.el('option', { value: 'br', text: 'Abajo a la derecha', selected: cfg.position !== 'bl' ? true : null }),
      U.el('option', { value: 'bl', text: 'Abajo a la izquierda', selected: cfg.position === 'bl' ? true : null }),
    ]);
    var themeSel = U.el('select', { class: 'a-input' }, [
      ['auto', 'Automático (según el dispositivo)'], ['light', 'Siempre claro'], ['dark', 'Siempre oscuro'],
    ].map(function (o) { return U.el('option', { value: o[0], text: o[1], selected: (cfg.theme || 'auto') === o[0] ? true : null }); }));
    var statusI = input({ value: cfg.status || '' });
    var welcomeI = textarea({ text: cfg.welcome || '' });
    var noResI = textarea({ text: cfg.noResults || '' });
    var byeI = textarea({ text: cfg.goodbye || '' });
    var phI = input({ value: cfg.placeholder || '' });
    var maxI = input({ type: 'number', min: '1', max: '12', value: cfg.maxResults || 6 });
    var delayI = input({ type: 'number', min: '0', max: '3000', step: '100', value: cfg.typingDelay || 600 });
    var showLabelI = U.el('input', { type: 'checkbox', checked: cfg.showLauncherLabel ? true : null });
    var labelI = input({ value: cfg.launcherLabel || '' });
    var footI = input({ value: cfg.footer || '' });

    var form = U.el('div', { class: 'a-form' }, [
      U.el('label', { class: 'a-field a-field--row' }, [enabledI, U.el('span', { text: 'Mostrar el asistente en la tienda' })]),
      U.el('div', { class: 'a-grid2' }, [field('Nombre del asistente', nameI), field('Color de acento', accentI)]),
      U.el('div', { class: 'a-grid2' }, [field('Emoji del avatar (encabezado)', avatarI), field('Emoji del botón flotante', launchI)]),
      U.el('div', { class: 'a-grid2' }, [field('Posición del botón', posSel), field('Modo de color', themeSel)]),
      field('Estado (bajo el nombre)', statusI),
      U.el('h3', { class: 'a-card__title', text: 'Textos automáticos', style: { marginTop: '.5rem' } }),
      field('Frase de bienvenida', welcomeI),
      field('Frase cuando NO encuentra productos', noResI),
      field('Frase de despedida', byeI),
      field('Texto del campo de escritura', phI),
      U.el('h3', { class: 'a-card__title', text: 'Comportamiento', style: { marginTop: '.5rem' } }),
      U.el('div', { class: 'a-grid2' }, [
        field('Máx. de productos por respuesta', maxI),
        field('Demora de "escribiendo…" (ms)', delayI),
      ]),
      U.el('label', { class: 'a-field a-field--row' }, [showLabelI, U.el('span', { text: 'Mostrar texto al lado del botón' })]),
      field('Texto del botón', labelI, 'Solo se ve si activás la opción de arriba.'),
      field('Pie del chat', footI),
    ]);

    var save = U.el('button', {
      class: 'btn btn--primary', text: '💾 Guardar configuración',
      onClick: async function () {
        await C().save({
          enabled: enabledI.checked,
          name: nameI.value.trim() || 'TECNO',
          avatar: avatarI.value.trim() || '🤖',
          launcherIcon: launchI.value.trim() || '🤖',
          accent: accentI.value,
          position: posSel.value,
          theme: themeSel.value,
          status: statusI.value,
          welcome: welcomeI.value,
          noResults: noResI.value,
          goodbye: byeI.value,
          placeholder: phI.value,
          maxResults: Number(maxI.value) || 6,
          typingDelay: Number(delayI.value) || 0,
          showLauncherLabel: showLabelI.checked,
          launcherLabel: labelI.value,
          footer: footI.value,
        });
        U.toast('Configuración guardada', 'success');
      },
    });
    var reset = U.el('button', {
      class: 'btn btn--ghost', text: '↩️ Restablecer',
      onClick: async function () { if (await U.confirm('¿Volver a los valores por defecto?')) { await C().reset(); rerender(); U.toast('Restablecido', 'info'); } },
    });

    c.appendChild(U.el('div', { class: 'a-card' }, [form, U.el('div', { class: 'a-quick', style: { marginTop: '1rem' } }, [save, reset])]));
    c.appendChild(U.el('p', { class: 'a-muted a-small', text: 'El WhatsApp, Instagram y Facebook que usa el asistente salen de la Configuración general de la tienda (sección Configuración / Apariencia).' }));
  }

  /* ===================== PESTAÑA: PREGUNTAS FRECUENTES ================== */
  function renderFaqs(c) {
    c.appendChild(U.el('p', { class: 'a-muted', text: 'Respuestas rápidas para preguntas comunes. En la respuesta podés usar {whatsapp}, {instagram}, {facebook} y {tienda}: se reemplazan solos por los datos reales de la tienda.' }));
    c.appendChild(U.el('div', { class: 'a-section-head' }, [U.el('span'), U.el('button', { class: 'btn btn--primary', text: '+ Nueva pregunta', onClick: function () { editFaq(); } })]));
    var list = D().faqs();
    if (!list.length) { c.appendChild(U.el('p', { class: 'a-empty', text: 'Sin preguntas cargadas.' })); return; }
    var table = U.el('table', { class: 'e5-admin-table' });
    table.appendChild(U.el('tr', {}, ['Pregunta', 'Palabras clave', 'Estado', ''].map(function (t) { return U.el('th', { text: t }); })));
    list.forEach(function (f) {
      table.appendChild(U.el('tr', {}, [
        U.el('td', {}, [U.el('strong', { text: f.title || '(sin título)' })]),
        U.el('td', { text: (f.keywords || []).join(', ') }),
        U.el('td', {}, [U.el('span', { class: 'e5-tag', text: f.enabled === false ? 'Oculta' : 'Activa' })]),
        U.el('td', {}, [
          U.el('button', { class: 'btn btn--ghost btn--sm', text: '✏️', onClick: function () { editFaq(f); } }),
          U.el('button', { class: 'btn btn--ghost btn--sm', text: '🗑️', onClick: async function () { if (await U.confirm('¿Eliminar esta pregunta?')) { await D().removeFaq(f.id); rerender(); } } }),
        ]),
      ]));
    });
    c.appendChild(table);
  }
  function editFaq(f) {
    f = f || {};
    var titleI = input({ value: f.title || '', placeholder: 'Ej: Medios de pago' });
    var kwI = input({ value: (f.keywords || []).join(', '), placeholder: 'pago, tarjeta, efectivo, cuotas' });
    var ansI = textarea({ rows: 5, text: f.answer || '' });
    var enI = U.el('input', { type: 'checkbox', checked: f.enabled !== false ? true : null });
    var body = U.el('div', { class: 'a-form' }, [
      field('Pregunta / Título', titleI),
      field('Palabras clave (separadas por coma)', kwI, 'Si el cliente escribe alguna de estas palabras, se muestra esta respuesta.'),
      field('Respuesta', ansI, 'Podés usar {whatsapp} {instagram} {facebook} {tienda}.'),
      U.el('label', { class: 'a-field a-field--row' }, [enI, U.el('span', { text: 'Activa' })]),
    ]);
    openModal(f.id ? 'Editar pregunta' : 'Nueva pregunta', body, async function () {
      await D().saveFaq({
        id: f.id, title: titleI.value.trim(),
        keywords: kwI.value.split(',').map(function (s) { return s.trim(); }).filter(Boolean),
        answer: ansI.value, enabled: enI.checked, order: f.order,
      });
      U.toast('Pregunta guardada', 'success'); rerender();
    });
  }

  /* ===================== PESTAÑA: SINÓNIMOS ============================= */
  function renderSyns(c) {
    c.appendChild(U.el('p', { class: 'a-muted', text: 'Jerga y errores comunes. La palabra base debe parecerse a una categoría o marca real. Ej: base "televisor" con variantes "tele, tv, smart tv, led".' }));
    c.appendChild(U.el('div', { class: 'a-section-head' }, [U.el('span'), U.el('button', { class: 'btn btn--primary', text: '+ Nuevo sinónimo', onClick: function () { editSyn(); } })]));
    var list = D().synonyms();
    if (!list.length) { c.appendChild(U.el('p', { class: 'a-empty', text: 'Sin sinónimos cargados.' })); return; }
    var table = U.el('table', { class: 'e5-admin-table' });
    table.appendChild(U.el('tr', {}, ['Palabra base', 'Variantes (como escribe la gente)', 'Estado', ''].map(function (t) { return U.el('th', { text: t }); })));
    list.forEach(function (s) {
      table.appendChild(U.el('tr', {}, [
        U.el('td', {}, [U.el('strong', { text: s.canonical || '' })]),
        U.el('td', { text: (s.variants || []).join(', ') }),
        U.el('td', {}, [U.el('span', { class: 'e5-tag', text: s.enabled === false ? 'Oculto' : 'Activo' })]),
        U.el('td', {}, [
          U.el('button', { class: 'btn btn--ghost btn--sm', text: '✏️', onClick: function () { editSyn(s); } }),
          U.el('button', { class: 'btn btn--ghost btn--sm', text: '🗑️', onClick: async function () { if (await U.confirm('¿Eliminar este sinónimo?')) { await D().removeSyn(s.id); rerender(); } } }),
        ]),
      ]));
    });
    c.appendChild(table);
  }
  function editSyn(s) {
    s = s || {};
    var canI = input({ value: s.canonical || '', placeholder: 'televisor' });
    var varI = input({ value: (s.variants || []).join(', '), placeholder: 'tele, tv, smart tv, led, pantalla' });
    var enI = U.el('input', { type: 'checkbox', checked: s.enabled !== false ? true : null });
    var body = U.el('div', { class: 'a-form' }, [
      field('Palabra base', canI, 'Debe parecerse a una categoría o marca real del catálogo.'),
      field('Variantes (separadas por coma)', varI),
      U.el('label', { class: 'a-field a-field--row' }, [enI, U.el('span', { text: 'Activo' })]),
    ]);
    openModal(s.id ? 'Editar sinónimo' : 'Nuevo sinónimo', body, async function () {
      await D().saveSyn({
        id: s.id, canonical: canI.value.trim(),
        variants: varI.value.split(',').map(function (x) { return x.trim(); }).filter(Boolean),
        enabled: enI.checked,
      });
      U.toast('Sinónimo guardado', 'success'); rerender();
    });
  }

  /* ---- Modal genérico (mismo patrón que la Etapa 5) --------------------- */
  function openModal(title, bodyNode, onSave) {
    var overlay = U.el('div', { class: 'modal-overlay' });
    var box = U.el('div', { class: 'modal' }, [
      U.el('h3', { class: 'modal__title', text: title }),
      U.el('div', { class: 'modal__body', style: { maxHeight: '60vh', overflowY: 'auto' } }, [bodyNode]),
      U.el('div', { class: 'modal__actions' }, [
        U.el('button', { class: 'btn btn--ghost', text: 'Cancelar', onClick: function () { overlay.remove(); } }),
        U.el('button', { class: 'btn btn--primary', text: 'Guardar', onClick: async function () { try { await onSave(); overlay.remove(); } catch (e) { U.toast('Error: ' + (e.message || e), 'error'); } } }),
      ]),
    ]);
    overlay.appendChild(box);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
  }

  /* ---- Registro de la sección ------------------------------------------- */
  function register() {
    if (!App.Admin || !App.Admin.registerSection) return;
    App.Admin.registerSection({ id: 'asistente', label: 'Asistente', icon: '🤖', render: renderMain });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', register);
  else register();
})(window.App = window.App || {});
