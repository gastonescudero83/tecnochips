/* =============================================================================
 * ui-admin-promo.js — ETAPA 5 · Panel: Banner dinámico de promociones
 * -----------------------------------------------------------------------------
 * Sección del panel de administración para configurar el banner de promos:
 * activar/desactivar, usar (o no) los mensajes automáticos del catálogo, cambiar
 * la palabra del rótulo ("Promo") y el enlace ("Ver"), y agregar mensajes
 * propios. Guarda en Store.state.settings.promoBanner (viaja al catálogo
 * publicado) vía App.E5.Config.save. Aditivo.
 * ========================================================================== */
(function (App) {
  'use strict';
  const U = App.U;
  const E5 = App.E5;
  const S = App.Store;
  const head = (t) => U.el('div', { class: 'a-section-head' }, [U.el('h2', { text: t })]);
  const field = (label, node) => U.el('label', { class: 'a-field' }, [U.el('span', { text: label }), node]);
  const input = (attrs) => U.el('input', Object.assign({ class: 'a-input' }, attrs));

  function currentCfg() {
    const c = (S.state && S.state.settings && S.state.settings.promoBanner) || {};
    return {
      enabled: c.enabled !== false,
      useAuto: c.useAuto !== false,
      tag: c.tag != null ? c.tag : 'Promo',
      cta: c.cta != null ? c.cta : 'Ver',
      customTarget: c.customTarget || 'ofertas',
      customText: c.customText || '',
      useBrandBg: c.useBrandBg !== false,
      bg: c.bg || '#2b2722',
      fg: c.fg || '#ffffff',
    };
  }

  function checkRow(labelText, checked) {
    const cb = U.el('input', { type: 'checkbox', checked: checked ? true : null });
    const row = U.el('label', {
      class: 'a-field',
      style: { flexDirection: 'row', alignItems: 'center', gap: '.5rem', cursor: 'pointer' },
    }, [cb, U.el('span', { text: labelText })]);
    return { row, cb };
  }

  function sectionPromo(c) {
    const cfg = currentCfg();
    c.appendChild(head('📢 Banner de promociones'));
    c.appendChild(U.el('p', {
      style: { fontSize: '.85rem', opacity: '.75', margin: '0 0 .7rem' },
      text: 'Barra de texto arriba de la portada. Cambia el mensaje en cada carga y, al tocarla, lleva a esos productos.',
    }));

    const en = checkRow('Mostrar el banner en la tienda', cfg.enabled);
    const au = checkRow('Usar mensajes automáticos del catálogo (marcas, categorías, ofertas)', cfg.useAuto);

    const tagI = input({ value: cfg.tag, placeholder: 'Promo', maxlength: 18 });
    const ctaI = input({ value: cfg.cta, placeholder: 'Ver', maxlength: 18 });

    const tgt = U.el('select', { class: 'a-input' });
    [['ofertas', 'Ofertas'], ['novedades', 'Novedades'], ['destacados', 'Destacados'], ['inicio', 'Inicio']]
      .forEach(function (o) { tgt.appendChild(U.el('option', { value: o[0], text: o[1] })); });
    tgt.value = cfg.customTarget;

    const custom = U.el('textarea', {
      class: 'a-input', rows: 5,
      placeholder: 'Un mensaje por línea. Ej:\nEnvío gratis esta semana\n3 cuotas sin interés\nLlegaron los aires',
      text: cfg.customText,
    });

    // ---- Colores ----
    const brand = checkRow('Usar el degradé de la marca como fondo', cfg.useBrandBg);
    const bgI = input({ type: 'color', value: cfg.bg });
    const fgI = input({ type: 'color', value: cfg.fg });

    // ---- Vista previa en vivo (usa los estilos reales del banner) ----
    const pvTag = U.el('span', { class: 'e5-promo__tag', text: cfg.tag || 'Promo' });
    const pvText = U.el('span', { class: 'e5-promo__text', text: 'Ofertas en Aires' });
    const pvGo = U.el('span', { class: 'e5-promo__go', text: cfg.cta || 'Ver' });
    const preview = U.el('a', { class: 'e5-promo', style: { cursor: 'default' } }, [pvTag, pvText, pvGo]);
    function paint() {
      preview.style.background = brand.cb.checked ? '' : bgI.value;   // '' = degradé del CSS
      preview.style.color = fgI.value;
      var t = tagI.value.trim(); pvTag.style.display = t ? '' : 'none'; pvTag.textContent = t;
      var v = ctaI.value.trim(); pvGo.style.display = v ? '' : 'none'; pvGo.textContent = v;
    }
    [brand.cb, bgI, fgI, tagI, ctaI].forEach(function (el) {
      el.addEventListener('input', paint); el.addEventListener('change', paint);
    });

    const save = U.el('button', {
      class: 'btn btn--primary', text: 'Guardar banner',
      onClick: async function () {
        const patch = { promoBanner: {
          enabled: en.cb.checked,
          useAuto: au.cb.checked,
          tag: tagI.value,
          cta: ctaI.value,
          customTarget: tgt.value,
          customText: custom.value,
          useBrandBg: brand.cb.checked,
          bg: bgI.value,
          fg: fgI.value,
        } };
        try {
          await E5.Config.save(patch);
          U.toast('Banner guardado. Recargá la tienda para verlo.', 'success');
        } catch (e) { U.toast('No se pudo guardar', 'error'); }
      },
    });

    c.appendChild(U.el('div', { style: { margin: '0 0 .8rem' } }, [
      U.el('div', { style: { fontSize: '.8rem', opacity: '.7', margin: '0 0 .3rem' }, text: 'Vista previa:' }),
      preview,
    ]));
    c.appendChild(U.el('div', { class: 'a-card' }, [
      en.row,
      au.row,
      field('Palabra del rótulo (vacío = sin rótulo)', tagI),
      field('Texto del enlace', ctaI),
      field('Tus mensajes propios (uno por línea, se suman a los automáticos)', custom),
      field('¿A dónde llevan tus mensajes?', tgt),
      brand.row,
      field('Color de fondo (si no usás el degradé)', bgI),
      field('Color del texto', fgI),
      U.el('div', { style: { marginTop: '.6rem' } }, [save]),
    ]));

    paint();
  }

  function register() {
    if (!App.Admin || !App.Admin.registerSection) return;
    App.Admin.registerSection({ id: 'promo-banner', label: 'Banner promos', icon: '📢', render: sectionPromo });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', register); else register();
})(window.App = window.App || {});
