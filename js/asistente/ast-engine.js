/* =============================================================================
 * ast-engine.js — Asistente "TECNO" · Motor de respuestas (ETAPA 6)
 * -----------------------------------------------------------------------------
 * Orquesta todo: recibe el texto del cliente, usa el NLU para entenderlo y
 * decide qué responder REUTILIZANDO los módulos existentes:
 *   • App.Search.query()  -> búsqueda de productos (mismo motor que la tienda)
 *   • App.Store           -> precios, categorías, settings
 *   • App.Asst.Data       -> Preguntas Frecuentes + sinónimos
 *   • App.Cart            -> agregar al carrito
 *
 * Mantiene un contexto mínimo de conversación (últimos resultados) para
 * entender pedidos como "mostrame el más barato" o "agregá el primero".
 *
 * Devuelve un objeto de respuesta que la UI renderiza:
 *   { type, text, products, chips, more, total }
 *
 * API pública:
 *   App.Asst.Engine.respond(text)     -> Promise<respuesta>
 *   App.Asst.Engine.welcome()         -> respuesta de bienvenida
 *   App.Asst.Engine.defaultChips()    -> chips derivados del catálogo
 *   App.Asst.Engine.resetContext()
 * ========================================================================== */
(function (App) {
  'use strict';

  var U = App.U;
  function norm(s) { return U.normalize(String(s == null ? '' : s)); }
  function cfg() { return App.Asst.Config.get(); }
  function settings() { return (App.Store && App.Store.state && App.Store.state.settings) || {}; }

  /* ---- Contexto de conversación ----------------------------------------- */
  var ctx = { lastResults: [], lastParse: null };
  function resetContext() { ctx = { lastResults: [], lastParse: null }; }

  /* ---- Charla casual (respuestas amables fuera de catálogo) ------------- */
  var RE_HOWRU = /\b(como estas|como andas|como va|todo bien|que tal|como te va|estas bien|andas bien)\b/;
  var RE_WHORU = /\b(quien sos|sos un bot|sos una persona|sos humano|sos real|sos una maquina|con quien hablo|como te llamas|tu nombre|que sos|sos robot)\b/;
  var RE_NICE = /\b(te amo|te quiero|sos genial|sos lo mejor|me caes bien|sos un genio|sos capo|groso|crack|sos un crack|excelente atencion)\b/;
  var RE_JOKE = /\b(un chiste|contame un chiste|haceme reir|haceme reir|decime algo gracioso)\b/;
  var RE_OK = /\b(ok|oka|okey|dale|listo|perfecto|joya|barbaro|buenisimo|genial|de diez|entendido|copado)\b/;

  /* ---- Detección de "agregar al carrito" -------------------------------- */
  var RE_ADD = /\b(agrega|agregá|agregar|agregame|añadir|añade|suma|sumá|sumar|lo llevo|me lo llevo|lo quiero|dale|carrito)\b/;
  var POS = [
    [/\bprimero|primer|1ro|uno\b/, 0], [/\bsegundo|2do|dos\b/, 1], [/\btercero|3ro|tres\b/, 2],
    [/\bcuarto|4to|cuatro\b/, 3], [/\bquinto|5to|cinco\b/, 4], [/\bultimo|último\b/, -1],
  ];
  function positionIn(n) {
    for (var i = 0; i < POS.length; i++) if (POS[i][0].test(n)) return POS[i][1];
    var m = n.match(/\bnumero\s*(\d+)|\b(\d+)\b/);
    if (m) { var k = parseInt(m[1] || m[2], 10); if (k >= 1 && k <= 50) return k - 1; }
    return null;
  }

  /* ---- Reemplazo de tokens en respuestas FAQ ---------------------------- */
  function waLink() {
    var num = App.WhatsApp ? App.WhatsApp.sanitizeNumber(settings().whatsapp) : (settings().whatsapp || '');
    return num ? 'https://wa.me/' + num : '';
  }
  function replaceTokens(txt) {
    var s = settings();
    var social = s.social || {};
    var wa = waLink();
    var map = {
      whatsapp: wa || 'por WhatsApp',
      telefono: s.whatsapp || '',
      instagram: social.instagram || '',
      facebook: social.facebook || '',
      tienda: s.storeName || 'TECNOCHIP\'S',
    };
    return String(txt || '').replace(/\{(\w+)\}/g, function (m, k) {
      return (k in map) ? map[k] : m;
    }).replace(/\s{2,}/g, ' ').trim();
  }

  /* ---- Chips (sugerencias) ---------------------------------------------- */
  function defaultChips() {
    var chips = [];
    var cats = (App.Store.state.categories || []).slice().sort(function (a, b) { return (a.order || 0) - (b.order || 0); });
    cats.slice(0, 3).forEach(function (c) {
      chips.push({ label: c.name, icon: c.icon || '🛍️', kind: 'send', value: c.name });
    });
    chips.push({ label: 'Ofertas', icon: '🔥', kind: 'send', value: 'ofertas' });
    chips.push({ label: 'Novedades', icon: '🆕', kind: 'send', value: 'novedades' });
    chips.push({ label: 'Envíos', icon: '🚚', kind: 'send', value: 'envíos' });
    return chips;
  }
  function contactChips() {
    var out = [];
    if (waLink()) out.push({ label: 'Escribir por WhatsApp', icon: '💬', kind: 'link', value: waLink() });
    return out;
  }

  /* ---- Ordenar / filtrar resultados (para refinamientos) ---------------- */
  function sortList(list, sort) {
    var S = App.Store;
    var arr = list.slice();
    if (sort === 'priceAsc') arr.sort(function (a, b) { return S.effectivePrice(a) - S.effectivePrice(b); });
    else if (sort === 'priceDesc') arr.sort(function (a, b) { return S.effectivePrice(b) - S.effectivePrice(a); });
    else if (sort === 'discount') arr.sort(function (a, b) { return S.discountPercent(b) - S.discountPercent(a); });
    else if (sort === 'newest') arr.sort(function (a, b) { return b.createdAt - a.createdAt; });
    return arr;
  }

  /* ---- Encabezados según lo detectado ----------------------------------- */
  function productLead(p, count, refined) {
    if (refined) {
      if (p.sort === 'priceAsc') return 'Listo, te los ordené del más barato al más caro:';
      if (p.sort === 'priceDesc') return 'Ordenados del más caro al más barato:';
      if (p.flags.onSale) return 'Estos son los que están en oferta:';
      return 'Ahí va:';
    }
    var brand = p.brand;
    var cat = p.category ? p.category.name : '';
    if (brand && cat) return 'Encontré esto en ' + cat + ' de ' + brand + ':';
    if (brand) return 'Mirá lo que tengo de ' + brand + ':';
    if (cat) return count === 1 ? 'Tengo esto en ' + cat + ':' : 'Esto es lo que tengo en ' + cat + ':';
    if (p.flags.onSale) return 'Estas son las ofertas del momento 🔥:';
    if (p.flags.isNew) return 'Lo último que ingresó 🆕:';
    if (p.flags.featured) return 'Los destacados de la tienda ⭐:';
    return count === 1 ? 'Encontré esto:' : 'Encontré estos modelos:';
  }

  /* =======================================================================
   *  RESPOND — punto de entrada principal
   * ==================================================================== */
  async function respond(text) {
    await App.Asst.Config.ready();
    if (App.Asst.Data) { try { await App.Asst.Data.ready(); } catch (_e) {} }

    var c = cfg();
    var p = App.Asst.NLU.parse(text);
    var n = p.norm;

    /* 1) Agregar al carrito (referido a los últimos resultados) ----------- */
    if ((/\bcarrito\b/.test(n) || (RE_ADD.test(n) && positionIn(n) != null)) && ctx.lastResults.length) {
      var idx = positionIn(n);
      if (idx == null) idx = 0;
      if (idx === -1) idx = ctx.lastResults.length - 1;
      var prod = ctx.lastResults[idx];
      if (prod && App.Cart) {
        App.Cart.add(prod.id, 1);
        return {
          type: 'text',
          text: '✓ Agregué "' + prod.name + '" al carrito. Ya tenés ' + App.Cart.count() + ' producto(s). ¿Seguimos o finalizamos el pedido?',
          chips: [
            { label: 'Ver carrito', icon: '🛒', kind: 'route', value: '/carrito' },
            { label: 'Seguir viendo', icon: '👀', kind: 'send', value: 'novedades' },
          ],
        };
      }
    }

    /* 2) Intenciones sociales -------------------------------------------- */
    if (p.isGreeting && !p.hasProductSignal) {
      return { type: 'greeting', text: pickGreeting(c), chips: defaultChips() };
    }
    if (p.isGoodbye) return { type: 'goodbye', text: c.goodbye, chips: [] };
    if (p.isHelp) {
      return {
        type: 'help',
        text: 'Puedo ayudarte a encontrar productos (por marca, categoría o precio), mostrarte ofertas y novedades, y responder dudas sobre envíos, pagos, cuotas, garantía, stock y más. Probá con algo como "busco un celular Samsung" o tocá una opción:',
        chips: defaultChips(),
      };
    }

    /* 2.5) Charla casual (solo si no hay pedido de producto) -------------- */
    if (!p.hasProductSignal) {
      var sm = smallTalk(n, c);
      if (sm) return sm;
    }

    /* 3) Refinamiento de la última búsqueda ("mostrame el más barato") ---- */
    var onlyRefine = p.hasProductSignal && !p.category && !p.brand && !p.query.text &&
      p.price.min == null && p.price.max == null &&
      (p.sort || p.flags.onSale || p.flags.isNew || p.flags.featured);
    if (onlyRefine && ctx.lastResults.length) {
      var refined = ctx.lastResults.slice();
      if (p.flags.onSale) refined = refined.filter(function (x) { return App.Store.isOnSale(x); });
      if (p.flags.featured) refined = refined.filter(function (x) { return x.featured; });
      if (p.flags.isNew) refined = refined.filter(function (x) { return x.isNew; });
      if (p.sort) refined = sortList(refined, p.sort);
      else if (p.flags.onSale) refined = sortList(refined, 'discount');
      if (refined.length) {
        ctx.lastResults = refined; ctx.lastParse = p;
        return buildProductsResponse(p, refined, c, true);
      }
    }

    /* 4) ¿FAQ o producto? ------------------------------------------------- */
    var faq = App.Asst.Data ? App.Asst.Data.matchFaq(text) : null;
    var strongProduct = !!(p.category || p.brand);

    if (!strongProduct && faq) {
      return {
        type: 'faq',
        text: replaceTokens(faq.faq.answer),
        chips: contactChips().concat(faqFollowChips()),
      };
    }

    /* 5) Búsqueda de productos ------------------------------------------- */
    if (p.hasProductSignal) {
      var results = App.Search ? App.Search.query(p.query) : [];
      // Relajar 1: soltar la subcategoría (productos aún sin subcategoría asignada)
      if (!results.length && p.query.subcategoryId) {
        var q1 = Object.assign({}, p.query); delete q1.subcategoryId;
        results = App.Search.query(q1);
      }
      // Relajar 2: categoría + texto no dio → probar solo el texto
      if (!results.length && p.query.text) {
        results = App.Search.query({ text: p.query.text, sort: p.query.sort });
      }
      // Relajar 3: solo la marca
      if (!results.length && p.brand) {
        results = App.Search.query({ text: norm(p.brand) });
      }
      if (results.length) {
        ctx.lastResults = results; ctx.lastParse = p;
        return buildProductsResponse(p, results, c, false);
      }
      // Sin resultados exactos → sugerir productos relacionados
      var related = suggestRelated(p);
      if (related.length) {
        ctx.lastResults = related; ctx.lastParse = p;
        return buildSuggestResponse(p, related, c);
      }
      // No hay NADA que ofrecer
      return {
        type: 'empty',
        text: c.noResults,
        chips: defaultChips(),
      };
    }

    /* 6) FAQ como segunda chance (texto suelto tipo "garantia") ----------- */
    if (faq) {
      return { type: 'faq', text: replaceTokens(faq.faq.answer), chips: contactChips().concat(faqFollowChips()) };
    }

    /* 7) Agradecimiento suelto ------------------------------------------- */
    if (p.isThanks) return { type: 'thanks', text: '¡De nada! Cualquier cosa, acá estoy 🙌', chips: defaultChips() };

    /* 8) No entendí ------------------------------------------------------- */
    return {
      type: 'empty',
      text: 'No estoy seguro de haber entendido 🤔. Puedo buscarte productos por marca o categoría, o contarte sobre envíos, pagos y garantía. Probá con una opción:',
      chips: defaultChips(),
    };
  }

  /* ---- Charla casual: respuestas rápidas fuera del catálogo ------------- */
  function smallTalk(n, c) {
    if (RE_HOWRU.test(n)) {
      return { type: 'text', text: '¡Todo bien por acá, gracias! 😄 Listo para ayudarte. ¿Qué estás buscando?', chips: defaultChips() };
    }
    if (RE_WHORU.test(n)) {
      var store = settings().storeName || 'la tienda';
      return { type: 'text', text: 'Soy ' + (c.name || 'TECNO') + ' 🤖, el asistente virtual de ' + store + '. Te ayudo a buscar productos, precios, ofertas, envíos y pagos. ¿En qué te doy una mano?', chips: defaultChips() };
    }
    if (RE_NICE.test(n)) {
      return { type: 'text', text: '¡Gracias, qué lindo! 🙌 Estoy para ayudarte cuando quieras. ¿Buscamos algo?', chips: defaultChips() };
    }
    if (RE_JOKE.test(n)) {
      return { type: 'text', text: '¿Qué le dice un cable a otro? — ¡Somos los corrientes! ⚡😅 Ahora sí, ¿qué estás buscando?', chips: defaultChips() };
    }
    if (RE_OK.test(n) && n.split(/\s+/).length <= 3) {
      return { type: 'text', text: '¡Genial! 👍 ¿Seguimos con otra cosa?', chips: defaultChips() };
    }
    return null;
  }

  /* ---- Sugerencia de productos relacionados (cuando no hay match) ------- */
  function suggestRelated(p) {
    if (!App.Search) return [];
    var list = [];
    // 1) Misma categoría, aflojando precio/marca/texto (lo más relevante)
    if (p.category) {
      var q = { categoryId: p.category.id, sort: p.flags.onSale ? 'discount' : 'newest' };
      list = App.Search.query(q);
    }
    // 2) Misma marca, en cualquier categoría
    if (!list.length && p.brand) {
      list = App.Search.query({ text: norm(p.brand) });
    }
    // 3) Por cada palabra suelta del texto (match parcial)
    if (!list.length && p.query.text) {
      var words = String(p.query.text).split(/\s+/).filter(function (w) { return w.length > 2; });
      for (var i = 0; i < words.length && !list.length; i++) {
        list = App.Search.query({ text: words[i] });
      }
    }
    // 4) Último recurso: destacados o novedades del catálogo
    if (!list.length) {
      list = App.Search.query({ featured: true, sort: 'newest' });
      if (!list.length) list = App.Search.query({ sort: 'newest' });
    }
    return list;
  }

  function relatedLead(p) {
    if (p.category) return 'No encontré exactamente eso, pero mirá lo que tengo en ' + p.category.name + ' 👇';
    if (p.brand) return 'No tengo ' + p.brand + ' disponible ahora, pero quizás te sirvan estas opciones 👇';
    return 'No encontré eso puntualmente, pero quizás te interese esto 👇';
  }

  function buildSuggestResponse(p, results, c) {
    var max = Math.max(1, Number(c.maxResults) || 6);
    var shown = results.slice(0, max);
    var chips = [];
    if (results.length > max && p.category) {
      chips.push({ label: 'Ver todo en ' + p.category.name, icon: '📋', kind: 'search', value: { categoryId: p.category.id } });
    }
    contactChips().forEach(function (ch) { chips.push(ch); });
    return {
      type: 'suggest',
      text: relatedLead(p),
      products: shown,
      total: results.length,
      more: results.length > max,
      chips: chips,
    };
  }

  /* ---- Construcción de la respuesta de productos ------------------------ */
  function buildProductsResponse(p, results, c, refined) {
    var max = Math.max(1, Number(c.maxResults) || 6);
    var shown = results.slice(0, max);
    return {
      type: 'products',
      text: productLead(p, results.length, refined),
      products: shown,
      total: results.length,
      more: results.length > max,
      chips: results.length > max
        ? [{ label: 'Ver todos (' + results.length + ')', icon: '📋', kind: 'search', value: p.query }]
        : [],
    };
  }

  function faqFollowChips() {
    return [{ label: 'Buscar productos', icon: '🔎', kind: 'send', value: 'novedades' }];
  }

  function pickGreeting(c) {
    return c.welcome;
  }

  /* ---- Bienvenida (la usa la UI al abrir) ------------------------------- */
  function welcome() {
    var c = cfg();
    return { type: 'greeting', text: c.welcome, chips: defaultChips() };
  }

  App.Asst = App.Asst || {};
  App.Asst.Engine = { respond: respond, welcome: welcome, defaultChips: defaultChips, resetContext: resetContext };
})(window.App = window.App || {});
