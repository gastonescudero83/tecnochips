/* =============================================================================
 * utils.js — Utilidades transversales (DOM, formato, archivos, hashing, toasts)
 * -----------------------------------------------------------------------------
 * Funciones puras y helpers sin estado de negocio. Reutilizadas por toda la app.
 * ========================================================================== */
(function (App) {
  'use strict';

  const U = {};

  /* ---- Selección de DOM --------------------------------------------------- */
  U.$ = (sel, ctx = document) => ctx.querySelector(sel);
  U.$$ = (sel, ctx = document) => Array.prototype.slice.call(ctx.querySelectorAll(sel));

  /**
   * Crea un elemento con atributos/propiedades e hijos en una sola llamada.
   * @param {string} tag
   * @param {object} [props] - className, dataset, on{Event}, html, text, attrs...
   * @param {Array|Node|string} [children]
   */
  U.el = function (tag, props, children) {
    const node = document.createElement(tag);
    if (props) {
      Object.keys(props).forEach((key) => {
        const val = props[key];
        if (key === 'class' || key === 'className') node.className = val;
        else if (key === 'text') node.textContent = val;
        else if (key === 'html') node.innerHTML = val;
        else if (key === 'dataset') Object.assign(node.dataset, val);
        else if (key === 'style' && typeof val === 'object') Object.assign(node.style, val);
        else if (key.slice(0, 2) === 'on' && typeof val === 'function') {
          node.addEventListener(key.slice(2).toLowerCase(), val);
        } else if (val !== null && val !== undefined && val !== false) {
          node.setAttribute(key, val === true ? '' : val);
        }
      });
    }
    if (children != null) U.append(node, children);
    return node;
  };

  U.append = function (parent, children) {
    if (Array.isArray(children)) {
      children.forEach((c) => c != null && U.append(parent, c));
    } else if (children instanceof Node) {
      parent.appendChild(children);
    } else {
      parent.appendChild(document.createTextNode(String(children)));
    }
    return parent;
  };

  U.clear = function (node) {
    while (node && node.firstChild) node.removeChild(node.firstChild);
    return node;
  };

  /* ---- Identidad y texto -------------------------------------------------- */
  U.uid = function (prefix = 'id') {
    return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  };

  U.slugify = function (str) {
    return String(str)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  };

  U.escapeHtml = function (str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  };

  /** Normaliza para búsqueda: minúsculas, sin acentos. */
  U.normalize = function (str) {
    return String(str == null ? '' : str)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '');
  };

  /* ---- Emoji por rubro (para categorías creadas automáticamente) ----------
   * "Cocina" → 🍳, "Heladeras" → ❄️, etc. El primer patrón que matchea gana;
   * si ninguno matchea se usa el genérico 🛍️. Los patrones van SIN acentos
   * (el nombre se normaliza antes de comparar). */
  const CATEGORY_EMOJI = [
    [/celular|smartphone|telefon|iphone/, '📱'],
    [/\btv\b|televisor|smart tv|video/, '📺'],
    [/monitor/, '🖥️'],
    [/notebook|computa|laptop|\bpc\b|tecnolog/, '💻'],
    [/consola|gaming|juego|playstation|xbox/, '🎮'],
    [/auricular/, '🎧'],
    [/parlante|audio|sonido/, '🔊'],
    [/heladera|freezer|refriger/, '❄️'],
    [/lavavajilla/, '🍽️'],
    [/lavarrop|lavado|secarrop|lavasec/, '🧺'],
    [/cocina|horno|anafe/, '🍳'],
    [/microonda/, '🍲'],
    [/aire|split|climatiz/, '🌬️'],
    [/ventilador/, '🌀'],
    [/calefac|estufa|caloventor|termotanque|calefon/, '🔥'],
    [/cafetera|\bcafe\b/, '☕'],
    [/\bpava\b/, '🫖'],
    [/tostador/, '🍞'],
    [/licuadora|batidora|procesadora|mixer/, '🥤'],
    [/freidora/, '🍟'],
    [/plancha/, '👕'],
    [/aspirador|limpieza/, '🧹'],
    [/herramienta|taladro|amoladora/, '🛠️'],
    [/ilumin|lampara|\bluz\b/, '💡'],
    [/accesorio|cable|cargador/, '🔌'],
    [/hogar|electrodom|\belectro\b/, '🏠'],
  ];
  U.categoryEmoji = function (name) {
    const n = U.normalize(name);
    for (let i = 0; i < CATEGORY_EMOJI.length; i++) {
      if (CATEGORY_EMOJI[i][0].test(n)) return CATEGORY_EMOJI[i][1];
    }
    return '🛍️';
  };

  /* ---- Números y moneda --------------------------------------------------- */
  U.formatCurrency = function (value, settings) {
    const s = settings || App.state?.settings || App.DEFAULT_SETTINGS;
    const n = Number(value) || 0;
    try {
      return new Intl.NumberFormat(s.locale || 'es-AR', {
        style: 'currency',
        currency: s.currency || 'ARS',
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
      }).format(n);
    } catch (_e) {
      // Fallback si el locale/moneda no es soportado por el navegador
      return (s.currencySymbol || '$') + n.toLocaleString('es-AR');
    }
  };

  /**
   * Convierte texto suelto ("$ 18.900", "18900,50", "1.234.567") a número.
   * Reglas (es-AR primero):
   *  - Con punto Y coma: el separador que aparece ÚLTIMO es el decimal
   *    ("18.900,50" → 18900.5 · "18,900.50" → 18900.5).
   *  - Solo punto: grupos de EXACTAMENTE 3 dígitos = miles ("18.900" → 18900,
   *    "1.234.567" → 1234567); si no, es decimal ("18.5" → 18.5).
   *  - Solo coma: mismo criterio ("18,900" → 18900 · "45,99" → 45.99).
   */
  U.parsePrice = function (input) {
    if (typeof input === 'number') return input;
    if (input == null || input === '') return 0;
    let str = String(input).replace(/[^\d.,-]/g, '').trim();
    if (!str) return 0;
    const hasDot = str.indexOf('.') > -1;
    const hasComma = str.indexOf(',') > -1;
    if (hasDot && hasComma) {
      if (str.lastIndexOf(',') > str.lastIndexOf('.')) {
        str = str.replace(/\./g, '').replace(',', '.'); // punto miles, coma decimal
      } else {
        str = str.replace(/,/g, ''); // coma miles, punto decimal
      }
    } else if (hasDot) {
      if (/^-?\d{1,3}(?:\.\d{3})+$/.test(str)) str = str.replace(/\./g, ''); // miles
    } else if (hasComma) {
      if (/^-?\d{1,3}(?:,\d{3})+$/.test(str)) str = str.replace(/,/g, ''); // miles
      else str = str.replace(',', '.'); // decimal
    }
    const n = parseFloat(str);
    return isNaN(n) ? 0 : n;
  };

  U.clamp = (n, min, max) => Math.min(Math.max(n, min), max);

  /* ---- Fechas ------------------------------------------------------------- */
  U.formatDate = function (ts, withTime) {
    if (!ts) return '';
    const d = new Date(ts);
    const opts = withTime
      ? { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }
      : { day: '2-digit', month: '2-digit', year: 'numeric' };
    return d.toLocaleDateString('es-AR', opts);
  };

  /* ---- Control de flujo --------------------------------------------------- */
  U.debounce = function (fn, wait = 200) {
    let t;
    return function (...args) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), wait);
    };
  };

  U.throttle = function (fn, wait = 200) {
    let last = 0, timer = null;
    return function (...args) {
      const now = Date.now();
      const remaining = wait - (now - last);
      if (remaining <= 0) {
        clearTimeout(timer); timer = null; last = now;
        fn.apply(this, args);
      } else if (!timer) {
        timer = setTimeout(() => { last = Date.now(); timer = null; fn.apply(this, args); }, remaining);
      }
    };
  };

  /* ---- Archivos ----------------------------------------------------------- */
  U.readFileAsDataURL = function (file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = reject;
      r.readAsDataURL(file);
    });
  };

  U.readFileAsText = function (file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = reject;
      r.readAsText(file);
    });
  };

  U.readFileAsArrayBuffer = function (file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = reject;
      r.readAsArrayBuffer(file);
    });
  };

  /** Dispara la descarga de un Blob/string como archivo. */
  U.download = function (filename, content, mime = 'application/octet-stream') {
    const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = U.el('a', { href: url, download: filename });
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 0);
  };

  /* ---- Hashing (gate del admin) ------------------------------------------
   * Nota de seguridad honesta: sin servidor, cualquier protección por clave es
   * solo disuasoria (el usuario avanzado puede leer la DB con DevTools). Usamos
   * SHA-256 cuando hay crypto.subtle (contexto seguro); si no, un hash simple.
   * --------------------------------------------------------------------- */
  U.hash = async function (text) {
    const data = new TextEncoder().encode('tienda::' + text);
    if (window.crypto && crypto.subtle && crypto.subtle.digest) {
      try {
        const buf = await crypto.subtle.digest('SHA-256', data);
        return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
      } catch (_e) { /* cae al fallback */ }
    }
    // Fallback FNV-1a (no criptográfico, suficiente como gate básico offline)
    let h = 0x811c9dc5;
    for (let i = 0; i < data.length; i++) {
      h ^= data[i];
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return 'fnv_' + h.toString(16);
  };

  /* ---- Toast / notificaciones --------------------------------------------- */
  let toastHost = null;
  U.toast = function (message, type = 'info', timeout = 3000) {
    if (!toastHost) {
      toastHost = U.el('div', { class: 'toast-host', 'aria-live': 'polite' });
      document.body.appendChild(toastHost);
    }
    const t = U.el('div', { class: 'toast toast--' + type, role: 'status' }, message);
    toastHost.appendChild(t);
    requestAnimationFrame(() => t.classList.add('toast--show'));
    setTimeout(() => {
      t.classList.remove('toast--show');
      setTimeout(() => t.remove(), 300);
    }, timeout);
  };

  /* ---- Confirm modal (promesa) ------------------------------------------- */
  U.confirm = function (message, { okText = 'Aceptar', cancelText = 'Cancelar', danger = false } = {}) {
    return new Promise((resolve) => {
      const overlay = U.el('div', { class: 'modal-overlay' });
      const onEsc = (e) => { if (e.key === 'Escape') close(false); };
      const close = (val) => { document.removeEventListener('keydown', onEsc); overlay.remove(); resolve(val); };
      document.addEventListener('keydown', onEsc);
      const box = U.el('div', { class: 'modal modal--sm' }, [
        U.el('p', { class: 'modal__msg', text: message }),
        U.el('div', { class: 'modal__actions' }, [
          U.el('button', { class: 'btn btn--ghost', text: cancelText, onClick: () => close(false) }),
          U.el('button', {
            class: 'btn ' + (danger ? 'btn--danger' : 'btn--primary'),
            text: okText, onClick: () => close(true),
          }),
        ]),
      ]);
      overlay.addEventListener('click', (e) => { if (e.target === overlay) close(false); });
      overlay.appendChild(box);
      document.body.appendChild(overlay);
    });
  };

  App.U = U;
})(window.App = window.App || {});
