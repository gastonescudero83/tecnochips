/* =============================================================================
 * ast-nlu.js — Asistente "TECNO" · Comprensión de lenguaje natural (ETAPA 6)
 * -----------------------------------------------------------------------------
 * Traduce una frase escrita por el cliente ("busco un samsung barato",
 * "¿qué smart tv tienen?", "mostrame las ofertas") a un objeto de consulta
 * listo para App.Search.query(). NO inventa nada: detecta categorías y marcas
 * contra el catálogo REAL y en vivo (Store.state), por lo que cada producto o
 * marca que entra por una importación de PDF/Excel queda reconocido solo.
 *
 * Tolera errores de tipeo (distancia de edición), plurales y jerga (usa el
 * diccionario de sinónimos editable de App.Asst.Data).
 *
 * API pública:
 *   App.Asst.NLU.parse(text) -> {
 *     raw, norm, isGreeting, isGoodbye, isThanks, isHelp,
 *     flags:{onSale,isNew,featured}, sort, price:{min,max},
 *     category, subcategory, brand, query, hasProductSignal
 *   }
 * ========================================================================== */
(function (App) {
  'use strict';

  var U = App.U;
  var Data = function () { return App.Asst && App.Asst.Data; };
  function norm(s) { return U.normalize(String(s == null ? '' : s)); }
  // Quita signos (¿ ? ! . , etc.) dejando solo letras/números/espacios: así
  // "¿que" o "whatsapp?" no ensucian la búsqueda ni el matcheo de palabras.
  function clean(s) { return String(s == null ? '' : s).replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim(); }

  /* ---- Palabras de relleno (se quitan del texto de búsqueda) ------------- */
  var FILLER = strSet(
    'busco buscar buscando quiero queria necesito necesitaria tenes tenés tienen ' +
    'tenen hay teni me mostra mostrame muestrame muéstrame ver mirar algun alguna ' +
    'algunos algunas un una unos unas el la los las lo de del para con por que ' +
    'como cual cuales cuanto cuanta sale cuesta vale estoy ando porfa porfavor por favor ' +
    'y o a e en al es son tipo marca modelo producto productos catalogo tienda ' +
    'gustaria quisiera me gustaria dame pasame pasas pasa decime info informacion ' +
    'hola holas holis buenas buenos dias tardes noches hey ola saludos gracias graciass ' +
    'chau chauu adios mas menos ahi aca aqui esta estan tenes'
  );

  /* ---- Detectores de intención rápida ------------------------------------ */
  var RE_GREET = /\b(hola|holis|holaa+|buenas|buen dia|buenos dias|buenas tardes|buenas noches|hey|ola|que tal|como va|como andas|holaa)\b/;
  var RE_BYE = /\b(chau|chauu|adios|adiós|nos vemos|hasta luego|hasta pronto|me voy|listo gracias|nada mas|nada más)\b/;
  var RE_THANKS = /\b(gracias|graciass|muchas gracias|mil gracias|genial gracias|buenisimo|barbaro|de diez)\b/;
  var RE_HELP = /\b(ayuda|ayudame|que podes hacer|qué podés hacer|como funciona|cómo funciona|opciones|menu|menú|que haces|para que servis)\b/;

  var RE_OFFERS = /\b(oferta|ofertas|promo|promos|promocion|promoción|promociones|descuento|descuentos|rebaja|rebajas|liquidacion|liquidación|remate)\b/;
  var RE_NEW = /\b(nuevo|nueva|nuevos|nuevas|novedad|novedades|recien|recién|ultimo ingreso|últimos ingresos|ingreso|ingresaron|ultimos)\b/;
  var RE_FEATURED = /\b(destacado|destacados|recomendado|recomendados|recomendame|los mejores|mas vendido|más vendido|top)\b/;
  var RE_CHEAP = /\b(barato|barata|baratos|baratas|economico|económico|economica|económica|accesible|mas barato|más barato|el mas barato|mas economico|menor precio|menos plata)\b/;
  var RE_EXPENSIVE = /\b(mas caro|más caro|el mas caro|caro|mayor precio|premium|gama alta|el mejor|la mejor)\b/;

  /* =======================================================================
   *  Distancia de edición (Levenshtein acotada) — para errores de tipeo
   * ==================================================================== */
  function lev(a, b) {
    var m = a.length, n = b.length;
    if (Math.abs(m - n) > 2) return 3;
    var prev = new Array(n + 1), cur = new Array(n + 1), i, j;
    for (j = 0; j <= n; j++) prev[j] = j;
    for (i = 1; i <= m; i++) {
      cur[0] = i;
      for (j = 1; j <= n; j++) {
        var cost = a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1;
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      }
      var t = prev; prev = cur; cur = t;
    }
    return prev[n];
  }

  // ¿Dos palabras "son la misma" tolerando plural y un error de tipeo?
  function wordMatches(a, b) {
    if (!a || !b) return false;
    if (a === b) return true;
    if (a.length >= 4 && b.length >= 4 && (a.indexOf(b) === 0 || b.indexOf(a) === 0)) return true;
    if (Math.min(a.length, b.length) >= 5 && lev(a, b) <= 1) return true;
    return false;
  }

  /* ---- Marcas del catálogo (en vivo, con caché invalidable) -------------- */
  var _brandCache = null;
  function brandList() {
    if (_brandCache) return _brandCache;
    var set = {};
    (App.Store.state.products || []).forEach(function (p) {
      var b = (p.brand || '').trim();
      if (b) set[norm(b)] = b;
    });
    if (App.E5 && App.E5.Brands) {
      try { App.E5.Brands.all().forEach(function (b) { if (b && b.name) set[norm(b.name)] = b.name; }); } catch (_e) {}
    }
    _brandCache = Object.keys(set).map(function (k) { return { norm: k, raw: set[k] }; });
    return _brandCache;
  }
  if (App.Store && App.Store.on) App.Store.on('products', function () { _brandCache = null; });

  /* ---- Sinónimos: canonical -> conjunto de términos ---------------------- */
  function conceptTermsFor(canonicalNorm) {
    var out = [canonicalNorm];
    var D = Data(); if (!D) return out;
    D.synonyms().forEach(function (s) {
      if (s.enabled === false) return;
      if (norm(s.canonical) === canonicalNorm) {
        (s.variants || []).forEach(function (v) { out.push(norm(v)); });
      }
    });
    return out;
  }

  // Para un token, devuelve todos los términos "equivalentes" (él mismo + su
  // concepto + las variantes del concepto). Ej: "tele" -> [tele, televisor, tv, led, ...]
  function candidatesFor(token) {
    var out = [token];
    var D = Data(); if (!D) return out;
    var can = D.conceptFor(token);
    if (can) { conceptTermsFor(norm(can)).forEach(function (t) { if (out.indexOf(t) < 0) out.push(t); }); }
    return out;
  }

  /* ---- Bolsa de palabras de una categoría (nombre + subcategorías) ------- */
  function catBag(cat) {
    var words = {};
    norm(cat.name).split(/\s+/).forEach(function (w) { if (w.length > 2) words[w] = 1; });
    var subs = (cat.subcategories || []).map(function (s) {
      var sw = norm(s.name).split(/\s+/).filter(function (w) { return w.length > 2; });
      sw.forEach(function (w) { words[w] = 1; });
      return { id: s.id, words: sw, name: norm(s.name) };
    });
    return { words: Object.keys(words), name: norm(cat.name), subs: subs };
  }

  /* ---- Detección de categoría / subcategoría ----------------------------- */
  function detectCategory(tokens) {
    var cats = App.Store.state.categories || [];
    var best = null, bestHits = 0, bestSub = null, usedWords = {};
    cats.forEach(function (cat) {
      var bag = catBag(cat);
      var hits = 0, localUsed = {}, sub = null;
      tokens.forEach(function (tok) {
        var cands = candidatesFor(tok);
        // ¿algún candidato matchea el nombre de la categoría?
        var hit = cands.some(function (c) {
          if (c.indexOf(' ') > -1) return bag.name.indexOf(c) > -1;         // multi-palabra
          return bag.words.some(function (w) { return wordMatches(c, w); });
        });
        if (hit) { hits++; localUsed[tok] = 1; }
        // ¿matchea una subcategoría?
        bag.subs.forEach(function (sb) {
          var subHit = cands.some(function (c) {
            if (c.indexOf(' ') > -1) return sb.name.indexOf(c) > -1;
            return sb.words.some(function (w) { return wordMatches(c, w); });
          });
          if (subHit) { hits++; localUsed[tok] = 1; if (!sub) sub = sb; }
        });
      });
      if (hits > bestHits) { bestHits = hits; best = cat; bestSub = sub; usedWords = localUsed; }
    });
    return best ? { category: best, subcategory: bestSub, usedWords: usedWords } : null;
  }

  /* ---- Detección de marca ------------------------------------------------ */
  function detectBrand(tokens) {
    var brands = brandList();
    var found = null, usedWords = {};
    tokens.forEach(function (tok) {
      if (found) return;
      var cands = candidatesFor(tok);
      brands.forEach(function (b) {
        if (found) return;
        var hit = cands.some(function (c) { return wordMatches(c, b.norm) || b.norm.indexOf(c) > -1 && c.length >= 4; });
        if (hit) { found = b.raw; usedWords[tok] = 1; }
      });
    });
    return found ? { brand: found, usedWords: usedWords } : null;
  }

  /* ---- Detección de precio (rango) --------------------------------------- */
  function detectPrice(text) {
    var res = { min: null, max: null };
    var t = text.replace(/\$/g, ' ');
    // entre N y M
    var mBetween = t.match(/entre\s+([\d.,]+)\s+y\s+([\d.,]+)/);
    if (mBetween) { res.min = num(mBetween[1]); res.max = num(mBetween[2]); return res; }
    var mMax = t.match(/(?:menos de|hasta|maximo|máximo|por debajo de|no mas de|no más de|<=?)\s*([\d.,]+)/);
    if (mMax) res.max = num(mMax[1]);
    var mMin = t.match(/(?:mas de|más de|desde|arriba de|minimo|mínimo|a partir de|>=?)\s*([\d.,]+)/);
    if (mMin) res.min = num(mMin[1]);
    return res;
  }
  function num(s) {
    var v = U.parsePrice ? U.parsePrice(s) : parseFloat(String(s).replace(/[^\d]/g, ''));
    // soporte "100k" / "100 mil"
    if (/k$/i.test(String(s))) v = v * 1000;
    return v || null;
  }

  /* =======================================================================
   *  PARSE — punto de entrada principal
   * ==================================================================== */
  function parse(text) {
    var raw = String(text || '');
    var n0 = norm(raw);        // normalizado CON signos (para detectar precios)
    var n = clean(n0);         // sin signos (para tokens e intención)
    var D = Data();
    var expanded = D ? D.expand(n) : n;

    var out = {
      raw: raw, norm: n,
      isGreeting: RE_GREET.test(n) && n.split(/\s+/).length <= 4,
      isGoodbye: RE_BYE.test(n),
      isThanks: RE_THANKS.test(n),
      isHelp: RE_HELP.test(n),
      flags: { onSale: RE_OFFERS.test(n), isNew: RE_NEW.test(n), featured: RE_FEATURED.test(n) },
      sort: null,
      price: detectPrice(n0),
      category: null, subcategory: null, brand: null,
      query: {}, hasProductSignal: false,
    };

    if (RE_CHEAP.test(n)) out.sort = 'priceAsc';
    else if (RE_EXPENSIVE.test(n)) out.sort = 'priceDesc';

    var tokens = expanded.split(/\s+/).filter(Boolean);

    // Categoría y marca (contra el catálogo real)
    var cat = detectCategory(tokens);
    if (cat) { out.category = cat.category; out.subcategory = cat.subcategory; }
    var br = detectBrand(tokens);
    if (br) { out.brand = br.brand; }

    // Texto residual = lo que queda para búsqueda libre (modelo, "no frost",
    // "55 pulgadas", "128gb", etc.), sacando relleno, categoría y marca.
    var used = Object.assign({}, cat ? cat.usedWords : {}, br ? br.usedWords : {});
    var residual = tokens.filter(function (t) {
      if (FILLER[t]) return false;
      if (used[t]) return false;
      if (out.flags.onSale && RE_OFFERS.test(t)) return false;
      if (out.flags.isNew && RE_NEW.test(t)) return false;
      if (RE_CHEAP.test(t) || RE_EXPENSIVE.test(t)) return false;
      return t.length > 1;
    });

    // Construir la query para App.Search
    var q = {};
    if (out.category) q.categoryId = out.category.id;
    if (out.subcategory) q.subcategoryId = out.subcategory.id;
    if (out.flags.onSale) q.onSale = true;
    if (out.flags.isNew) q.isNew = true;
    if (out.flags.featured) q.featured = true;
    if (out.price.min != null) q.minPrice = out.price.min;
    if (out.price.max != null) q.maxPrice = out.price.max;

    // Texto de búsqueda: residual + marca (la marca vive en el índice de Search,
    // así el filtrado por marca es un término más, con tolerancia del motor).
    var textParts = residual.slice();
    if (out.brand) textParts.push(norm(out.brand));
    if (textParts.length) q.text = textParts.join(' ');

    // Orden
    if (out.sort) q.sort = out.sort;
    else if (out.flags.onSale) q.sort = 'discount';
    else if (out.flags.isNew) q.sort = 'newest';

    out.query = q;
    out.hasProductSignal = !!(out.category || out.brand || residual.length ||
      out.flags.onSale || out.flags.isNew || out.flags.featured ||
      out.sort || out.price.min != null || out.price.max != null);

    return out;
  }

  /* ---- Utilidades -------------------------------------------------------- */
  function strSet(str) { var o = {}; str.split(/\s+/).forEach(function (w) { if (w) o[norm(w)] = 1; }); return o; }

  App.Asst = App.Asst || {};
  App.Asst.NLU = { parse: parse, wordMatches: wordMatches, _lev: lev };
})(window.App = window.App || {});
