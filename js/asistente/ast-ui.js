/* =============================================================================
 * ast-ui.js — Asistente "TECNO" · Interfaz (botón flotante + ventana) (ETAPA 6)
 * -----------------------------------------------------------------------------
 * Inyecta el botón flotante y la ventana de chat. Todo aditivo: cuelga de
 * document.body y NO toca el DOM de la tienda ni del panel. Rendimiento: el
 * botón se crea al inicio (liviano) y la VENTANA se arma recién la primera vez
 * que el cliente la abre (carga diferida).
 *
 * Seguridad: nunca se usa innerHTML con texto del usuario; todo se arma con
 * U.el()/textContent. Los enlaces de las FAQ se convierten en <a> de forma
 * segura (solo http/https).
 *
 * Reutiliza: App.Asst.Engine (respuestas), App.Store (precios), App.Cart
 * (agregar), App.Router (abrir producto), App.WhatsApp / settings (contacto).
 *
 * API: App.Asst.UI.open() / close() / toggle() / isOpen()
 * ========================================================================== */
(function (App) {
  'use strict';

  var U = App.U;
  var Cfg = function () { return App.Asst.Config; };
  function cfg() { return App.Asst.Config.get(); }
  function settings() { return (App.Store && App.Store.state && App.Store.state.settings) || {}; }
  function money(v) { return U.formatCurrency(v, settings()); }

  var root = null, launcher = null, panel = null, bodyEl = null, inputEl = null, sendBtn = null;
  var built = false, opened = false, welcomed = false, busy = false;

  /* ======================= AVATAR / MASCOTA ============================== */
  // Robot vectorial animado (flota + parpadea vía CSS). 100% offline, sin archivos.
  var MASCOT_SVG =
    '<svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg" focusable="false" aria-hidden="true">' +
      '<defs>' +
        '<linearGradient id="astG1" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3bb8ff"/><stop offset="1" stop-color="#27c76f"/></linearGradient>' +
        '<linearGradient id="astG2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0b2f4a"/><stop offset="1" stop-color="#123a52"/></linearGradient>' +
        '<radialGradient id="astEye" cx="0.5" cy="0.4" r="0.7"><stop offset="0" stop-color="#eaffff"/><stop offset="0.55" stop-color="#79ecff"/><stop offset="1" stop-color="#37b6ff"/></radialGradient>' +
      '</defs>' +
      '<g class="ast-mascot__bot">' +
        '<line x1="60" y1="24" x2="60" y2="13" stroke="#7ef0ff" stroke-width="3" stroke-linecap="round"/>' +
        '<circle class="ast-mascot__pulse" cx="60" cy="9" r="4.6" fill="#7ef0ff"/>' +
        '<rect x="21" y="46" width="8" height="20" rx="4" fill="#1f9be0"/>' +
        '<rect x="91" y="46" width="8" height="20" rx="4" fill="#1f9be0"/>' +
        '<rect x="26" y="24" width="68" height="56" rx="24" fill="url(#astG1)"/>' +
        '<ellipse cx="46" cy="40" rx="16" ry="9" fill="#ffffff" opacity="0.18"/>' +
        '<rect x="34" y="34" width="52" height="38" rx="17" fill="url(#astG2)"/>' +
        '<ellipse class="ast-mascot__eye" cx="49" cy="52" rx="7" ry="9" fill="url(#astEye)"/>' +
        '<ellipse class="ast-mascot__eye" cx="71" cy="52" rx="7" ry="9" fill="url(#astEye)"/>' +
        '<circle cx="46.4" cy="48.4" r="2.1" fill="#ffffff"/>' +
        '<circle cx="68.4" cy="48.4" r="2.1" fill="#ffffff"/>' +
        '<path d="M52 64 Q60 69 68 64" fill="none" stroke="#7ef0ff" stroke-width="2.6" stroke-linecap="round"/>' +
        '<rect x="30" y="83" width="8" height="18" rx="4" fill="#27c76f"/>' +
        '<rect x="82" y="83" width="8" height="18" rx="4" fill="#27c76f"/>' +
        '<rect x="40" y="80" width="40" height="26" rx="12" fill="url(#astG1)"/>' +
        '<circle cx="60" cy="93" r="6" fill="#0b2f4a" opacity="0.85"/>' +
        '<circle class="ast-mascot__pulse" cx="60" cy="93" r="2.6" fill="#7ef0ff"/>' +
      '</g>' +
    '</svg>';

  // ¿El valor configurado es una imagen (ruta/URL/base64) segura?
  function isImageVal(v) {
    return /^(https?:\/\/|data:image\/|\.{0,2}\/)/i.test(v) || /\.(png|jpe?g|gif|webp|svg|avif)$/i.test(v);
  }
  // ¿Usar la mascota robot? (marcador 'mascot'/'robot', vacío, o el emoji 🤖 por defecto)
  function isMascotVal(v) { return v === 'mascot' || v === 'robot' || v === '' || v === '🤖'; }

  // Rellena un contenedor (launcher o header) con la mascota, una imagen o un emoji.
  function buildAvatarInto(container, val) {
    if (!container) return;
    var v = (val == null ? '' : String(val)).trim();
    container.innerHTML = '';
    var rich = false;
    if (isMascotVal(v)) {
      var span = U.el('span', { class: 'ast-mascot', 'aria-hidden': 'true' });
      span.innerHTML = MASCOT_SVG;              // constante propia (no texto del usuario)
      container.appendChild(span);
      rich = true;
    } else if (isImageVal(v)) {
      container.appendChild(U.el('img', { class: 'ast-avatar-img', src: v, alt: '', 'aria-hidden': 'true' }));
      rich = true;
    } else {
      container.appendChild(document.createTextNode(v));   // emoji / texto (seguro)
    }
    container.classList.toggle('ast-avatar--rich', rich);
  }

  /* ======================= ARRANQUE / BOTÓN =============================== */
  function init() {
    App.Asst.Config.ready().then(function () {
      var c = cfg();
      if (c.enabled === false) return;
      buildLauncher();
      applyLook(c);
      updateVisibilityByRoute();
      window.addEventListener('hashchange', updateVisibilityByRoute);
      Cfg().on(function () { applyLook(cfg()); updateVisibilityByRoute(); });
      // Refrescar precios/tarjetas si cambia el catálogo mientras el chat está abierto
      if (App.Store && App.Store.on) App.Store.on('products', function () { /* las tarjetas se regeneran en cada respuesta */ });
    });
  }

  function ensureRoot() {
    if (root) return root;
    root = U.el('div', { class: 'ast-root' });
    document.body.appendChild(root);
    return root;
  }

  function buildLauncher() {
    ensureRoot();
    if (launcher) return;
    var c = cfg();
    var pos = c.position === 'bl' ? 'bl' : 'br';
    launcher = U.el('button', {
      class: 'ast-launcher ast-launcher--' + pos + (c.showLauncherLabel ? '' : ' ast-launcher--no-label'),
      type: 'button', 'aria-label': 'Abrir ' + (c.name || 'asistente'), title: (c.name || 'Asistente'),
      onClick: toggle,
    });
    var icon = U.el('span', { class: 'ast-launcher__icon' });
    buildAvatarInto(icon, c.launcherIcon);
    launcher.appendChild(icon);
    if (c.showLauncherLabel) launcher.appendChild(U.el('span', { class: 'ast-launcher__label', text: c.launcherLabel || '' }));
    launcher.appendChild(U.el('span', { class: 'ast-launcher__badge', text: '1' }));
    root.appendChild(launcher);
  }

  /** Aplica color de acento, tema, posición, ícono y nombre (en caliente). */
  function applyLook(c) {
    ensureRoot();
    root.classList.remove('ast-dark', 'ast-light');
    if (c.theme === 'dark') root.classList.add('ast-dark');
    else if (c.theme === 'light') root.classList.add('ast-light');
    if (c.accent) {
      root.style.setProperty('--ast-accent', c.accent);
      root.style.setProperty('--ast-accent-ink', contrastInk(c.accent));
    }
    if (launcher) {
      var pos = c.position === 'bl' ? 'bl' : 'br';
      launcher.classList.toggle('ast-launcher--bl', pos === 'bl');
      launcher.classList.toggle('ast-launcher--br', pos === 'br');
      launcher.classList.toggle('ast-launcher--no-label', !c.showLauncherLabel);
      var ic = launcher.querySelector('.ast-launcher__icon');
      if (ic) buildAvatarInto(ic, c.launcherIcon);
      var lb = launcher.querySelector('.ast-launcher__label');
      if (c.showLauncherLabel && !lb) launcher.insertBefore(U.el('span', { class: 'ast-launcher__label', text: c.launcherLabel || '' }), launcher.querySelector('.ast-launcher__badge'));
      else if (lb) { if (!c.showLauncherLabel) lb.remove(); else lb.textContent = c.launcherLabel || ''; }
    }
    if (panel) {
      var pos2 = c.position === 'bl' ? 'bl' : 'br';
      panel.classList.toggle('ast-panel--bl', pos2 === 'bl');
      panel.classList.toggle('ast-panel--br', pos2 === 'br');
      var t = panel.querySelector('.ast-head__title'); if (t) t.textContent = c.name || 'Asistente';
      var av = panel.querySelector('.ast-head__avatar'); if (av) buildAvatarInto(av, c.avatar);
      var st = panel.querySelector('.ast-head__status-text'); if (st) st.textContent = c.status || '';
    }
  }

  /** Oculta el asistente en el panel admin (#/admin...) y si está desactivado. */
  function updateVisibilityByRoute() {
    if (!root) return;
    var isAdmin = (location.hash || '').indexOf('#/admin') === 0;
    var enabled = cfg().enabled !== false;
    root.style.display = (isAdmin || !enabled) ? 'none' : '';
    if (isAdmin && opened) close();
  }

  /* ======================= VENTANA (diferida) ============================ */
  function buildPanel() {
    if (built) return;
    var c = cfg();
    var pos = c.position === 'bl' ? 'bl' : 'br';

    panel = U.el('div', { class: 'ast-panel ast-panel--' + pos, role: 'dialog', 'aria-label': (c.name || 'Asistente') + ' — chat', hidden: true });

    // Encabezado
    var avatar = U.el('span', { class: 'ast-head__avatar', 'aria-hidden': 'true' });
    buildAvatarInto(avatar, c.avatar);
    var title = U.el('div', { class: 'ast-head__title', text: c.name || 'Asistente' });
    var status = U.el('div', { class: 'ast-head__status' }, [
      U.el('span', { class: 'ast-head__dot', 'aria-hidden': 'true' }),
      U.el('span', { class: 'ast-head__status-text', text: c.status || '' }),
    ]);
    var actions = U.el('div', { class: 'ast-head__actions' }, [
      U.el('button', { class: 'ast-head__btn', type: 'button', title: 'Minimizar', 'aria-label': 'Minimizar', text: '—', onClick: close }),
      U.el('button', { class: 'ast-head__btn', type: 'button', title: 'Cerrar', 'aria-label': 'Cerrar', text: '✕', onClick: close }),
    ]);
    var head = U.el('div', { class: 'ast-head' }, [avatar, U.el('div', { class: 'ast-head__meta' }, [title, status]), actions]);

    // Cuerpo
    bodyEl = U.el('div', { class: 'ast-body' });

    // Entrada
    inputEl = U.el('input', {
      class: 'ast-input__field', type: 'text', 'aria-label': 'Escribí tu consulta',
      placeholder: c.placeholder || 'Escribí tu consulta…', autocomplete: 'off',
      onKeydown: function (e) { if (e.key === 'Enter') { e.preventDefault(); sendCurrent(); } },
    });
    sendBtn = U.el('button', { class: 'ast-input__send', type: 'button', 'aria-label': 'Enviar', text: '➤', onClick: sendCurrent });
    var inputBar = U.el('div', { class: 'ast-input' }, [inputEl, sendBtn]);

    panel.appendChild(head);
    panel.appendChild(bodyEl);
    panel.appendChild(inputBar);
    if (c.footer) panel.appendChild(U.el('div', { class: 'ast-foot', text: c.footer }));

    root.appendChild(panel);
    built = true;
  }

  /* ======================= ABRIR / CERRAR =============================== */
  function open() {
    buildPanel();
    if (opened) return;
    opened = true;
    panel.hidden = false;
    var badge = launcher && launcher.querySelector('.ast-launcher__badge');
    if (badge) badge.remove();
    if (launcher) launcher.hidden = true;
    if (!welcomed) { welcomed = true; renderResponse(App.Asst.Engine.welcome(), true); }
    setTimeout(function () { if (inputEl) inputEl.focus(); }, 60);
  }
  function close() {
    opened = false;
    if (panel) panel.hidden = true;
    if (launcher) launcher.hidden = false;
  }
  function toggle() { opened ? close() : open(); }
  function isOpen() { return opened; }

  /* ======================= MENSAJERÍA ================================== */
  function scrollDown() { if (bodyEl) bodyEl.scrollTop = bodyEl.scrollHeight; }

  function addBubble(who, text) {
    var bubble = U.el('div', { class: 'ast-bubble ast-bubble--' + (who === 'user' ? 'user' : 'bot') });
    if (who === 'user') bubble.textContent = text;
    else linkify(bubble, text);
    var row = U.el('div', { class: 'ast-row ast-row--' + (who === 'user' ? 'user' : 'bot') }, [bubble]);
    bodyEl.appendChild(row);
    scrollDown();
    return row;
  }

  function addTyping() {
    var row = U.el('div', { class: 'ast-row ast-row--bot' }, [
      U.el('div', { class: 'ast-typing' }, [U.el('span'), U.el('span'), U.el('span')]),
    ]);
    bodyEl.appendChild(row); scrollDown();
    return row;
  }

  function addChips(chips) {
    if (!chips || !chips.length) return;
    var wrap = U.el('div', { class: 'ast-chips' });
    chips.forEach(function (ch) {
      var b = U.el('button', { class: 'ast-chip', type: 'button' }, [
        ch.icon ? U.el('span', { class: 'ast-chip__ico', text: ch.icon, 'aria-hidden': 'true' }) : null,
        U.el('span', { text: ch.label }),
      ].filter(Boolean));
      b.addEventListener('click', function () { onChip(ch); });
      wrap.appendChild(b);
    });
    bodyEl.appendChild(U.el('div', { class: 'ast-row ast-row--bot' }, [wrap]));
    scrollDown();
  }

  function addProducts(list) {
    var cont = U.el('div', { class: 'ast-products' });
    list.forEach(function (p) { cont.appendChild(productCard(p)); });
    bodyEl.appendChild(cont);
    scrollDown();
  }

  /* ---- Tarjeta de producto (segura, con datos en vivo del Store) -------- */
  function productCard(p) {
    var S = App.Store;
    var eff = S.effectivePrice(p);
    var cmp = S.comparePrice(p);
    var onSale = S.isOnSale(p);
    var cat = S.getCategory(p.categoryId);

    var media = U.el('div', { class: 'ast-pcard__media' });
    if (p.images && p.images[0]) media.appendChild(U.el('img', { src: p.images[0], alt: p.name, loading: 'lazy' }));
    else media.appendChild(U.el('span', { class: 'ast-pcard__media-ph', text: (cat && cat.icon) || '🛍️' }));
    if (onSale) media.appendChild(U.el('span', { class: 'ast-pcard__badge', text: '-' + S.discountPercent(p) + '%' }));

    var prices = U.el('div', { class: 'ast-pcard__prices' }, [
      U.el('span', { class: 'ast-pcard__price', text: money(eff) }),
      (onSale && cmp) ? U.el('span', { class: 'ast-pcard__old', text: money(cmp) }) : null,
    ].filter(Boolean));

    var info = U.el('div', { class: 'ast-pcard__info' }, [
      p.brand ? U.el('div', { class: 'ast-pcard__brand', text: p.brand }) : null,
      U.el('div', { class: 'ast-pcard__name', text: p.name }),
      prices,
    ].filter(Boolean));

    var acts = U.el('div', { class: 'ast-pcard__acts' }, [
      U.el('button', { class: 'ast-pbtn ast-pbtn--ghost', type: 'button', text: '👁 Ver', onClick: function () { openProduct(p.id); } }),
      U.el('button', { class: 'ast-pbtn ast-pbtn--primary', type: 'button', text: '🛒 Agregar', onClick: function () { addToCart(p); } }),
    ]);
    if (whatsappNumber()) {
      acts.appendChild(U.el('button', { class: 'ast-pbtn ast-pbtn--wsp', type: 'button', text: 'WhatsApp', onClick: function () { waProduct(p); } }));
    }

    return U.el('div', { class: 'ast-pcard' }, [media, info, acts]);
  }

  /* ======================= ACCIONES ==================================== */
  function openProduct(id) {
    App.Router.go('/producto/' + id);
    if (window.innerWidth <= 560) close();
  }
  function addToCart(p) {
    if (!App.Cart) return;
    App.Cart.add(p.id, 1);
    U.toast('✓ "' + p.name + '" agregado al carrito', 'success', 1800);
  }
  function whatsappNumber() { return App.WhatsApp ? App.WhatsApp.sanitizeNumber(settings().whatsapp) : ''; }
  function waProduct(p) {
    var num = whatsappNumber();
    var msg = 'Hola! Me interesa: ' + p.name + ' (' + money(App.Store.effectivePrice(p)) + '). ¿Está disponible?';
    var url = num ? 'https://wa.me/' + num + '?text=' + encodeURIComponent(msg)
      : 'https://api.whatsapp.com/send?text=' + encodeURIComponent(msg);
    window.open(url, '_blank', 'noopener');
  }

  function onChip(ch) {
    if (ch.kind === 'route') { App.Router.go(ch.value); if (window.innerWidth <= 560) close(); return; }
    if (ch.kind === 'link') { window.open(ch.value, '_blank', 'noopener'); return; }
    if (ch.kind === 'search') { App.Router.go(queryToRoute(ch.value)); if (window.innerWidth <= 560) close(); return; }
    // 'send' (por defecto): se comporta como si el cliente lo escribiera
    handleUser(ch.value);
  }

  function queryToRoute(q) {
    q = q || {};
    if (q.categoryId) return '#/categoria/' + q.categoryId + (q.subcategoryId ? '/' + q.subcategoryId : '');
    if (q.onSale) return '#/ofertas';
    if (q.isNew) return '#/novedades';
    if (q.featured) return '#/destacados';
    if (q.text) return '#/buscar?q=' + encodeURIComponent(q.text);
    return '#/';
  }

  /* ======================= FLUJO DE CONVERSACIÓN ======================= */
  function sendCurrent() {
    var text = (inputEl.value || '').trim();
    if (!text) return;
    inputEl.value = '';
    handleUser(text);
  }

  async function handleUser(text) {
    if (busy) return;
    addBubble('user', text);
    busy = true; if (sendBtn) sendBtn.disabled = true;
    var typing = addTyping();
    var delay = Math.max(0, Number(cfg().typingDelay) || 0);
    var resp;
    try {
      var pair = await Promise.all([App.Asst.Engine.respond(text), wait(delay)]);
      resp = pair[0];
    } catch (e) {
      console.error('[Asst.UI]', e);
      resp = { type: 'text', text: 'Ups, tuve un problema para procesar eso. Probá de nuevo 🙏', chips: [] };
    }
    typing.remove();
    renderResponse(resp, false);
    busy = false; if (sendBtn) sendBtn.disabled = false;
  }

  function renderResponse(resp, isWelcome) {
    if (!resp) return;
    if (resp.text) addBubble('bot', resp.text);
    if (resp.products && resp.products.length) addProducts(resp.products);
    if (resp.chips && resp.chips.length) addChips(resp.chips);
  }

  /* ======================= UTILIDADES ================================= */
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  // Convierte URLs http/https del texto en enlaces seguros; el resto va como
  // texto plano (nunca innerHTML). Respeta saltos de línea (CSS pre-wrap).
  function linkify(node, text) {
    var re = /(https?:\/\/[^\s]+)/g;
    var str = String(text == null ? '' : text);
    var last = 0, m;
    while ((m = re.exec(str)) !== null) {
      if (m.index > last) node.appendChild(document.createTextNode(str.slice(last, m.index)));
      node.appendChild(U.el('a', { href: m[0], target: '_blank', rel: 'noopener noreferrer', text: m[0].replace(/^https?:\/\//, '') }));
      last = m.index + m[0].length;
    }
    if (last < str.length) node.appendChild(document.createTextNode(str.slice(last)));
  }

  // Elige texto claro u oscuro según la luminancia del color de acento.
  function contrastInk(hex) {
    var h = String(hex || '').replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var r = parseInt(h.slice(0, 2), 16) || 0, g = parseInt(h.slice(2, 4), 16) || 0, b = parseInt(h.slice(4, 6), 16) || 0;
    var lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    return lum > 0.6 ? '#16120e' : '#f5efe4';
  }

  /* ======================= INIT ======================================== */
  App.Asst = App.Asst || {};
  App.Asst.UI = { open: open, close: close, toggle: toggle, isOpen: isOpen };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else setTimeout(init, 0);
})(window.App = window.App || {});
