/* =============================================================================
 * ast-data.js — Asistente "TECNO" · Datos editables: FAQ + Sinónimos (ETAPA 6)
 * -----------------------------------------------------------------------------
 * Guarda dos colecciones (Preguntas Frecuentes y Sinónimos) REUTILIZANDO la
 * capa App.E5.coll() de la Etapa 5. Ventaja clave: al usar el prefijo 'e5:',
 * estas colecciones entran AUTOMÁTICAMENTE en el backup/exportación y en el
 * catálogo publicado (así, lo que el admin edita viaja a los visitantes) sin
 * escribir una sola línea extra de persistencia.
 *
 * En el primer arranque se cargan FAQ de ejemplo (editables) y un diccionario
 * de sinónimos/errores comunes. El administrador puede modificar todo desde el
 * panel → "Asistente".
 *
 * API pública:
 *   App.Asst.Data.ready()                 -> Promise
 *   App.Asst.Data.faqs() / synonyms()     -> Array (sincrónico, tras ready)
 *   App.Asst.Data.saveFaq(o)/removeFaq(id)
 *   App.Asst.Data.saveSyn(o)/removeSyn(id)
 *   App.Asst.Data.replaceFaqs(arr)/replaceSyns(arr)
 *   App.Asst.Data.matchFaq(text)          -> { faq, score } | null
 *   App.Asst.Data.conceptFor(token)       -> canonical | null (para el NLU)
 *   App.Asst.Data.expand(normText)        -> texto con jerga normalizada
 *   App.Asst.Data.on(cb)                  -> desuscriptor
 * ========================================================================== */
(function (App) {
  'use strict';

  var U = App.U;
  var FAQ_COLL = 'asst_faq';   // -> clave KV 'e5:asst_faq'
  var SYN_COLL = 'asst_syn';   // -> clave KV 'e5:asst_syn'
  // Versión del "seed". Al subirla, se fusionan los NUEVOS sinónimos/FAQ de fábrica
  // en instalaciones que ya tenían datos, SIN pisar lo que el admin editó (merge por id).
  var SEED_VERSION = 2;
  var SEED_KEY = 'asst:seedVersion';

  function coll(name) {
    // Reutiliza el mini-ORM de la Etapa 5 (con caché en memoria y backup free).
    if (App.E5 && App.E5.coll) return App.E5.coll(name);
    return null;
  }
  function norm(s) { return U.normalize(String(s == null ? '' : s)); }
  // Igual que en el NLU: quita signos para que el matcheo por palabra funcione.
  function clean(s) { return norm(s).replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim(); }

  /* ---- Pub/Sub ----------------------------------------------------------- */
  var listeners = [];
  function on(cb) { listeners.push(cb); return function () { listeners = listeners.filter(function (f) { return f !== cb; }); }; }
  function emit() { listeners.forEach(function (cb) { try { cb(); } catch (e) { console.error('[Asst.Data]', e); } }); }

  /* =======================================================================
   *  SEED — Preguntas Frecuentes de ejemplo (100% editables)
   *  Los {tokens} los reemplaza el motor: {whatsapp} {instagram} {facebook}
   *  {tienda} {telefono}. Así el contacto sale SIEMPRE de la config real.
   * ==================================================================== */
  var DEFAULT_FAQS = [
    { id: 'faq_horarios', title: 'Horarios de atención', order: 1, enabled: true,
      keywords: ['horario', 'horarios', 'abren', 'cierran', 'atienden', 'atencion', 'hora', 'abierto'],
      answer: 'Atendemos de lunes a viernes de 9 a 18 h y sábados de 9 a 13 h.\n(Podés editar este horario desde el panel → Asistente).' },
    { id: 'faq_ubicacion', title: 'Ubicación / Dirección', order: 2, enabled: true,
      keywords: ['donde', 'ubicacion', 'ubicados', 'direccion', 'local', 'llegar', 'mapa', 'quedan', 'estan'],
      answer: 'Estamos en (tu dirección acá). Editá la dirección real desde el panel → Asistente.' },
    { id: 'faq_pagos', title: 'Medios de pago', order: 3, enabled: true,
      keywords: ['pago', 'pagar', 'pagos', 'tarjeta', 'efectivo', 'transferencia', 'cuotas', 'mercado pago', 'debito', 'credito'],
      answer: 'Aceptamos efectivo, transferencia, débito y crédito (consultá cuotas sin interés vigentes).\nEditable desde el panel.' },
    { id: 'faq_garantia', title: 'Garantía', order: 4, enabled: true,
      keywords: ['garantia', 'garantiza', 'garantias', 'falla', 'roto', 'anda mal'],
      answer: 'Todos los productos tienen garantía. El plazo depende del producto y la marca.\nEditá el detalle desde el panel.' },
    { id: 'faq_envios', title: 'Envíos', order: 5, enabled: true,
      keywords: ['envio', 'envios', 'envian', 'mandan', 'despacho', 'correo', 'delivery', 'llega', 'domicilio'],
      answer: 'Hacemos envíos a todo el país y entregas en la zona. Consultanos el costo por WhatsApp: {whatsapp}.\nEditable desde el panel.' },
    { id: 'faq_retiro', title: 'Retiro en el local', order: 6, enabled: true,
      keywords: ['retiro', 'retirar', 'buscar', 'pasar', 'retira', 'pickup'],
      answer: 'Podés retirar tu compra en el local sin cargo, coordinando previamente.\nEditable desde el panel.' },
    { id: 'faq_cambios', title: 'Cambios', order: 7, enabled: true,
      keywords: ['cambio', 'cambios', 'cambiar'],
      answer: 'Aceptamos cambios dentro de los días establecidos, con ticket y el producto sin uso.\nEditable desde el panel.' },
    { id: 'faq_devoluciones', title: 'Devoluciones', order: 8, enabled: true,
      keywords: ['devolucion', 'devoluciones', 'devolver', 'reembolso', 'reintegro'],
      answer: 'Consultá nuestra política de devoluciones según el caso. Escribinos y te ayudamos.\nEditable desde el panel.' },
    { id: 'faq_contacto', title: 'Contacto / WhatsApp', order: 9, enabled: true,
      keywords: ['contacto', 'telefono', 'whatsapp', 'wsp', 'wpp', 'hablar', 'comunicar', 'numero', 'llamar'],
      answer: 'Escribinos por WhatsApp: {whatsapp}. ¡Te respondemos a la brevedad!' },
    { id: 'faq_redes', title: 'Redes sociales', order: 10, enabled: true,
      keywords: ['instagram', 'insta', 'redes', 'facebook', 'seguir', 'tiktok', 'red social'],
      answer: 'Seguinos en nuestras redes: {instagram} {facebook}. ¡Ahí publicamos novedades y ofertas!' },
    { id: 'faq_cuotas', title: 'Cuotas / Financiación', order: 11, enabled: true,
      keywords: ['cuotas', 'cuota', 'financiacion', 'financiación', 'financiar', 'planes', 'interes', 'interés', 'sin interes', 'ahora 12', 'ahora 3', 'ahora 6'],
      answer: 'Trabajamos con cuotas y planes de financiación según la tarjeta y la promoción vigente. Consultanos por WhatsApp {whatsapp} y te pasamos las cuotas del día.\nEditable desde el panel.' },
    { id: 'faq_stock', title: 'Stock / Disponibilidad', order: 12, enabled: true,
      keywords: ['stock', 'disponible', 'disponibilidad', 'hay stock', 'tienen stock', 'queda', 'quedan', 'entrega inmediata', 'para llevar'],
      answer: 'El stock se actualiza en el catálogo. Si un producto aparece, hay disponibilidad; ante la duda, escribinos por WhatsApp {whatsapp} y lo confirmamos al instante.\nEditable desde el panel.' },
    { id: 'faq_factura', title: 'Factura / Comprobante', order: 13, enabled: true,
      keywords: ['factura', 'facturacion', 'facturación', 'comprobante', 'boleta', 'iva', 'responsable inscripto', 'factura a', 'factura b'],
      answer: 'Entregamos comprobante en cada compra. Si necesitás factura A, avisanos con tus datos fiscales.\nEditable desde el panel.' },
    { id: 'faq_reserva', title: 'Reservas / Seña', order: 14, enabled: true,
      keywords: ['reserva', 'reservar', 'señar', 'seña', 'apartar', 'guardar', 'guardame'],
      answer: 'Podés reservar un producto con una seña y coordinamos el retiro o envío. Escribinos por WhatsApp {whatsapp} para coordinarlo.\nEditable desde el panel.' },
    { id: 'faq_lista', title: 'Lista de precios / Presupuesto', order: 15, enabled: true,
      keywords: ['lista de precios', 'presupuesto', 'cotizacion', 'cotización', 'cotizar', 'precio de lista', 'me pasas precios'],
      answer: 'Los precios están en el catálogo. Para un presupuesto armado o precios por cantidad, escribinos por WhatsApp {whatsapp}.\nEditable desde el panel.' },
    { id: 'faq_mayorista', title: 'Venta mayorista', order: 16, enabled: true,
      keywords: ['mayorista', 'por mayor', 'revendedor', 'revender', 'cantidad', 'volumen', 'precio mayorista'],
      answer: 'Manejamos precios especiales por cantidad y para revendedores. Contanos qué necesitás por WhatsApp {whatsapp} y te cotizamos.\nEditable desde el panel.' },
    { id: 'faq_instalacion', title: 'Instalación', order: 17, enabled: true,
      keywords: ['instalacion', 'instalación', 'instalar', 'instalan', 'colocacion', 'colocación', 'ponen el aire', 'instalacion aire'],
      answer: 'Coordinamos instalación para productos que lo requieren (como aires acondicionados). Consultá disponibilidad y costo por WhatsApp {whatsapp}.\nEditable desde el panel.' },
    { id: 'faq_service', title: 'Servicio técnico', order: 18, enabled: true,
      keywords: ['service', 'servicio tecnico', 'servicio técnico', 'reparacion', 'reparación', 'reparar', 'arreglan', 'tecnico', 'no anda', 'no funciona'],
      answer: 'Ante una falla, escribinos por WhatsApp {whatsapp} y te guiamos con la garantía o el servicio técnico correspondiente.\nEditable desde el panel.' },
    { id: 'faq_usados', title: 'Usados / Plan canje', order: 19, enabled: true,
      keywords: ['usado', 'usados', 'permuta', 'permutar', 'canje', 'plan canje', 'entrego el mio', 'parte de pago', 'recibimos usados'],
      answer: 'Consultanos si tomamos tu equipo usado como parte de pago. Contanos qué tenés por WhatsApp {whatsapp} y lo evaluamos.\nEditable desde el panel.' },
    { id: 'faq_nosotros', title: 'Quiénes somos / Confianza', order: 20, enabled: true,
      keywords: ['quienes son', 'quiénes son', 'quienes sois', 'sobre ustedes', 'la empresa', 'son confiables', 'son de fiar', 'es seguro', 'es confiable'],
      answer: 'Somos {tienda}, un comercio con atención personalizada y productos con garantía. Cualquier duda te la despejamos por WhatsApp {whatsapp}.\nEditable desde el panel.' },
  ];

  /* =======================================================================
   *  SEED — Sinónimos / jerga / errores comunes
   *  canonical = palabra "base" que el NLU intenta matchear contra las
   *  categorías/marcas reales del catálogo. variants = como lo escribe la gente.
   * ==================================================================== */
  var DEFAULT_SYNS = [
    /* --- Categorías / tipos de producto --------------------------------- */
    { id: 'syn_tv', canonical: 'televisor', enabled: true, variants: ['tele', 'tv', 'smart tv', 'smart', 'led', 'lcd', 'oled', 'qled', 'uhd', '4k', 'ultra hd', 'android tv', 'pantalla', 'tele led', 'television', 'televisiones', 'televisores'] },
    { id: 'syn_cel', canonical: 'celular', enabled: true, variants: ['celu', 'telefono', 'smartphone', 'smart phone', 'movil', 'fono', 'phone', 'liberado', 'celulares', 'telefonos'] },
    { id: 'syn_note', canonical: 'notebook', enabled: true, variants: ['compu', 'computadora', 'laptop', 'portatil', 'ultrabook', 'pc portatil', 'notebooks', 'ordenador'] },
    { id: 'syn_pc', canonical: 'pc', enabled: true, variants: ['computadora de escritorio', 'cpu', 'gabinete', 'pc de escritorio', 'pc armada', 'compu escritorio'] },
    { id: 'syn_tablet', canonical: 'tablet', enabled: true, variants: ['tablets', 'tableta', 'tabletas', 'ipad', 'ipads'] },
    { id: 'syn_monitor', canonical: 'monitor', enabled: true, variants: ['monitores', 'pantalla pc', 'display', 'monitor gamer'] },
    { id: 'syn_teclado', canonical: 'teclado', enabled: true, variants: ['teclados', 'keyboard', 'teclado mecanico'] },
    { id: 'syn_mouse', canonical: 'mouse', enabled: true, variants: ['mouses', 'raton', 'mouse inalambrico', 'mouse gamer'] },
    { id: 'syn_impresora', canonical: 'impresora', enabled: true, variants: ['impresoras', 'printer', 'multifuncion', 'multifunción', 'impresora multifuncion'] },
    { id: 'syn_router', canonical: 'router', enabled: true, variants: ['modem', 'módem', 'wifi', 'router wifi', 'repetidor', 'extensor wifi', 'access point'] },
    { id: 'syn_pendrive', canonical: 'pendrive', enabled: true, variants: ['pen drive', 'usb', 'memoria usb', 'flash drive', 'pendrives'] },
    { id: 'syn_disco', canonical: 'disco', enabled: true, variants: ['disco rigido', 'disco rígido', 'hdd', 'ssd', 'disco solido', 'disco sólido', 'disco externo', 'almacenamiento', 'disco duro'] },
    { id: 'syn_ram', canonical: 'memoria', enabled: true, variants: ['ram', 'memoria ram', 'ddr4', 'ddr5', 'memoria pc'] },
    { id: 'syn_helad', canonical: 'heladera', enabled: true, variants: ['refrigerador', 'nevera', 'heladeras', 'frigorifico', 'no frost', 'frigobar', 'heladera con freezer'] },
    { id: 'syn_freezer', canonical: 'freezer', enabled: true, variants: ['freezers', 'congelador', 'conservadora'] },
    { id: 'syn_lava', canonical: 'lavarropas', enabled: true, variants: ['lavarropa', 'lavadora', 'lava ropa', 'lava-ropas', 'lavasecarropas', 'lavarropas automatico'] },
    { id: 'syn_secar', canonical: 'secarropas', enabled: true, variants: ['secadora', 'secaropas', 'secarropa', 'secado', 'secarropas por calor'] },
    { id: 'syn_lavavaj', canonical: 'lavavajillas', enabled: true, variants: ['lavavajilla', 'lavaplatos', 'lava vajilla', 'lavavajillas 12 cubiertos'] },
    { id: 'syn_aire', canonical: 'aire', enabled: true, variants: ['aire acondicionado', 'aires', 'split', 'splits', 'aire split', 'climatizador', 'ac', 'frio calor', 'frío calor', 'inverter'] },
    { id: 'syn_estufa', canonical: 'estufa', enabled: true, variants: ['estufas', 'calefactor', 'caloventor', 'calefaccion', 'calefacción', 'panel calefactor', 'calefactor electrico'] },
    { id: 'syn_termot', canonical: 'termotanque', enabled: true, variants: ['termotanques', 'calefon', 'calefón', 'termo tanque', 'calentador de agua'] },
    { id: 'syn_freid', canonical: 'freidora', enabled: true, variants: ['airfryer', 'air fryer', 'fritadora', 'freidora de aire', 'freidora sin aceite'] },
    { id: 'syn_micro', canonical: 'microondas', enabled: true, variants: ['microhondas', 'micro ondas', 'microonda', 'horno microondas'] },
    { id: 'syn_cocina', canonical: 'cocina', enabled: true, variants: ['cocinas', 'anafe', 'anafes', 'horno', 'hornos', 'horno electrico', 'horno eléctrico', 'cocina a gas'] },
    { id: 'syn_venti', canonical: 'ventilador', enabled: true, variants: ['ventiladores', 'turbo ventilador', 'ventilador de pie', 'ventilador de techo', 'turbo'] },
    { id: 'syn_cafe', canonical: 'cafetera', enabled: true, variants: ['cafeteras', 'express', 'espresso', 'cafe', 'cafetera express', 'cafetera de capsulas'] },
    { id: 'syn_licua', canonical: 'licuadora', enabled: true, variants: ['licuadoras', 'juguera', 'licuadora de vaso'] },
    { id: 'syn_batid', canonical: 'batidora', enabled: true, variants: ['batidoras', 'mixer', 'minipimer', 'batidora de mano'] },
    { id: 'syn_tosta', canonical: 'tostadora', enabled: true, variants: ['tostadoras', 'tostador', 'sandwichera'] },
    { id: 'syn_pava', canonical: 'pava', enabled: true, variants: ['pavas', 'pava electrica', 'pava eléctrica', 'pava electrica de acero'] },
    { id: 'syn_plancha', canonical: 'plancha', enabled: true, variants: ['planchas', 'planchita', 'plancha de ropa', 'plancha de pelo', 'plancha a vapor', 'alisadora'] },
    { id: 'syn_aspira', canonical: 'aspiradora', enabled: true, variants: ['aspiradoras', 'aspirador', 'robot aspirador', 'aspiradora robot'] },
    { id: 'syn_auri', canonical: 'auriculares', enabled: true, variants: ['auricular', 'audifonos', 'cascos', 'headset', 'in ear', 'inalambricos', 'auriculares bluetooth'] },
    { id: 'syn_parl', canonical: 'parlante', enabled: true, variants: ['parlantes', 'altavoz', 'speaker', 'bafle', 'soundbar', 'barra de sonido', 'subwoofer'] },
    { id: 'syn_smartw', canonical: 'smartwatch', enabled: true, variants: ['reloj inteligente', 'smart watch', 'reloj smart', 'watch', 'smartband', 'smart band', 'reloj deportivo'] },
    { id: 'syn_camara', canonical: 'camara', enabled: true, variants: ['cámara', 'camaras', 'webcam', 'camara de seguridad', 'camara seguridad', 'camara wifi'] },
    { id: 'syn_proyector', canonical: 'proyector', enabled: true, variants: ['proyectores', 'proyector led'] },
    { id: 'syn_soporte', canonical: 'soporte', enabled: true, variants: ['soportes', 'soporte tv', 'rack tv', 'soporte para tv'] },
    { id: 'syn_consola', canonical: 'consola', enabled: true, variants: ['play', 'playstation', 'ps5', 'ps4', 'xbox', 'nintendo', 'switch', 'joystick', 'control gamer'] },
    { id: 'syn_bt', canonical: 'bluetooth', enabled: true, variants: ['inalambrico', 'inalámbrico', 'wireless', 'sin cable', 'bt'] },
    { id: 'syn_combo', canonical: 'combo', enabled: true, variants: ['pack', 'kit', 'combos'] },
    /* --- Marcas (con errores de tipeo frecuentes) ----------------------- */
    { id: 'syn_samsung', canonical: 'samsung', enabled: true, variants: ['samsumg', 'samsun', 'sansung', 'samsng', 'samgung'] },
    { id: 'syn_moto', canonical: 'motorola', enabled: true, variants: ['moto', 'motorolla', 'motorla'] },
    { id: 'syn_xiaomi', canonical: 'xiaomi', enabled: true, variants: ['xiomi', 'xaomi', 'shaomi', 'ziaomi', 'redmi', 'poco'] },
    { id: 'syn_lg', canonical: 'lg', enabled: true, variants: ['elge', 'l g'] },
    { id: 'syn_philco', canonical: 'philco', enabled: true, variants: ['filco', 'philko', 'phico'] },
    { id: 'syn_noblex', canonical: 'noblex', enabled: true, variants: ['novlex', 'noblx'] },
    { id: 'syn_hisense', canonical: 'hisense', enabled: true, variants: ['hisence', 'hi sense', 'hysense'] },
    { id: 'syn_apple', canonical: 'apple', enabled: true, variants: ['aple', 'appel', 'macbook'] },
    { id: 'syn_huawei', canonical: 'huawei', enabled: true, variants: ['huawey', 'uawei', 'juawei'] },
    { id: 'syn_lenovo', canonical: 'lenovo', enabled: true, variants: ['lenobo', 'leonovo'] },
    { id: 'syn_hp', canonical: 'hp', enabled: true, variants: ['hewlett', 'h p'] },
    { id: 'syn_asus', canonical: 'asus', enabled: true, variants: ['azus', 'asis'] },
    { id: 'syn_acer', canonical: 'acer', enabled: true, variants: ['aser', 'acr'] },
    { id: 'syn_sony', canonical: 'sony', enabled: true, variants: ['soni', 'soney'] },
    { id: 'syn_whirlpool', canonical: 'whirlpool', enabled: true, variants: ['wirpool', 'wirlpool', 'whirpool', 'guirpul'] },
    { id: 'syn_drean', canonical: 'drean', enabled: true, variants: ['drian', 'dream'] },
  ];

  /* ---- Cachés en memoria ------------------------------------------------- */
  var faqCache = [];
  var synCache = [];
  var synIndex = {};   // variante/canonical normalizado -> canonical

  function rebuildSynIndex() {
    synIndex = {};
    synCache.forEach(function (s) {
      if (s.enabled === false) return;
      var can = norm(s.canonical);
      if (can) synIndex[can] = s.canonical;
      (s.variants || []).forEach(function (v) {
        var nv = norm(v);
        if (nv) synIndex[nv] = s.canonical;
      });
    });
  }

  /* ---- Carga / seed ------------------------------------------------------ */
  var readyPromise = null;
  function ready() {
    if (readyPromise) return readyPromise;
    readyPromise = (async function () {
      await App.DB.ready();
      // Esperar a que el Store termine (incluye importar catálogo publicado)
      // para no sembrar FAQ que luego el publicado reemplace.
      if (App.Store && App.Store.on && !(App.Store.state && App.Store.state.loaded)) {
        await new Promise(function (res) {
          var done = false;
          var off = App.Store.on('ready', function () { if (!done) { done = true; off(); res(); } });
          setTimeout(function () { if (!done) { done = true; res(); } }, 5000);
        });
      }
      var fc = coll(FAQ_COLL), sc = coll(SYN_COLL);
      faqCache = fc ? await fc.list() : [];
      synCache = sc ? await sc.list() : [];
      if (fc && !faqCache.length) { await fc.replaceAll(DEFAULT_FAQS); faqCache = await fc.list(); }
      if (sc && !synCache.length) { await sc.replaceAll(DEFAULT_SYNS); synCache = await sc.list(); }
      await mergeNewDefaults(fc, sc);   // fusiona novedades sin pisar ediciones
      rebuildSynIndex();
    })();
    return readyPromise;
  }

  // Fusiona los sinónimos/FAQ de fábrica que TODAVÍA no existen (match por id),
  // solo una vez por SEED_VERSION. Respeta lo que el admin editó o eliminó a mano.
  async function mergeNewDefaults(fc, sc) {
    var applied = 0;
    try { applied = Number(await App.DB.kvGet(SEED_KEY)) || 0; } catch (_e) {}
    if (applied >= SEED_VERSION) return;
    try {
      var haveFaq = {}; faqCache.forEach(function (f) { haveFaq[f.id] = 1; });
      var haveSyn = {}; synCache.forEach(function (s) { haveSyn[s.id] = 1; });
      var addF = DEFAULT_FAQS.filter(function (f) { return !haveFaq[f.id]; });
      var addS = DEFAULT_SYNS.filter(function (s) { return !haveSyn[s.id]; });
      var i;
      if (fc) for (i = 0; i < addF.length; i++) await fc.put(addF[i]);
      if (sc) for (i = 0; i < addS.length; i++) await sc.put(addS[i]);
      if (addF.length && fc) faqCache = await fc.list();
      if (addS.length && sc) synCache = await sc.list();
      await App.DB.kvSet(SEED_KEY, SEED_VERSION);
    } catch (e) { console.warn('[Asst.Data] mergeNewDefaults', e); }
  }

  async function refresh() {
    var fc = coll(FAQ_COLL), sc = coll(SYN_COLL);
    faqCache = fc ? await fc.list() : [];
    synCache = sc ? await sc.list() : [];
    rebuildSynIndex();
    emit();
  }

  /* ---- Lecturas sincrónicas (tras ready) --------------------------------- */
  function faqs() { return faqCache.slice().sort(function (a, b) { return (a.order || 0) - (b.order || 0); }); }
  function synonyms() { return synCache.slice(); }

  /* ---- Escrituras -------------------------------------------------------- */
  async function saveFaq(o) { var c = coll(FAQ_COLL); if (!c) return; await c.put(o); await refresh(); }
  async function removeFaq(id) { var c = coll(FAQ_COLL); if (!c) return; await c.remove(id); await refresh(); }
  async function replaceFaqs(arr) { var c = coll(FAQ_COLL); if (!c) return; await c.replaceAll(arr || []); await refresh(); }
  async function saveSyn(o) { var c = coll(SYN_COLL); if (!c) return; await c.put(o); await refresh(); }
  async function removeSyn(id) { var c = coll(SYN_COLL); if (!c) return; await c.remove(id); await refresh(); }
  async function replaceSyns(arr) { var c = coll(SYN_COLL); if (!c) return; await c.replaceAll(arr || []); await refresh(); }

  /* ---- Consultas para el NLU / motor ------------------------------------- */

  // Devuelve la palabra base si el token es una jerga/variante conocida.
  function conceptFor(token) {
    var t = norm(token);
    return synIndex[t] || null;
  }

  // Reemplaza jerga por su forma base en un texto ya normalizado. Primero las
  // variantes multi-palabra ("smart tv" -> "televisor"), luego token por token.
  function expand(normText) {
    var out = ' ' + String(normText || '') + ' ';
    // Multi-palabra
    synCache.forEach(function (s) {
      if (s.enabled === false) return;
      (s.variants || []).forEach(function (v) {
        var nv = norm(v);
        if (nv.indexOf(' ') > -1) {
          out = out.split(' ' + nv + ' ').join(' ' + norm(s.canonical) + ' ');
        }
      });
    });
    // Token por token
    out = out.trim().split(/\s+/).map(function (tok) {
      return synIndex[tok] ? norm(synIndex[tok]) : tok;
    }).join(' ');
    return out;
  }

  // Mejor FAQ para un texto (o null). Puntúa por coincidencia de palabras clave.
  function matchFaq(text) {
    var whole = clean(text);
    var padded = ' ' + whole + ' ';
    var best = null, bestScore = 0;
    faqCache.forEach(function (f) {
      if (f.enabled === false) return;
      var score = 0;
      (f.keywords || []).forEach(function (kw) {
        var k = norm(kw).trim();
        if (!k) return;
        if (padded.indexOf(' ' + k + ' ') > -1) score += 3 + k.length * 0.04;   // palabra exacta
        else if (whole.indexOf(k) > -1) score += 1.5;                            // subcadena
      });
      norm(f.title).split(/\s+/).forEach(function (w) {
        if (w.length > 3 && padded.indexOf(' ' + w + ' ') > -1) score += 0.8;
      });
      if (score > bestScore) { bestScore = score; best = f; }
    });
    return best && bestScore >= 3 ? { faq: best, score: bestScore } : null;
  }

  /* ---- Namespace --------------------------------------------------------- */
  App.Asst = App.Asst || {};
  App.Asst.Data = {
    ready: ready, refresh: refresh, on: on,
    faqs: faqs, synonyms: synonyms,
    saveFaq: saveFaq, removeFaq: removeFaq, replaceFaqs: replaceFaqs,
    saveSyn: saveSyn, removeSyn: removeSyn, replaceSyns: replaceSyns,
    matchFaq: matchFaq, conceptFor: conceptFor, expand: expand,
    DEFAULT_FAQS: DEFAULT_FAQS, DEFAULT_SYNS: DEFAULT_SYNS,
  };

  ready();
})(window.App = window.App || {});
