/* =============================================================================
 * config.js — Configuración por defecto y constantes globales de la aplicación
 * -----------------------------------------------------------------------------
 * Define el "estado inicial" de la tienda. TODO lo que aquí aparece puede ser
 * modificado luego por el administrador desde el panel y queda persistido en
 * IndexedDB. Este archivo solo provee los valores de arranque la primera vez
 * que se abre la app (o tras un "restablecer").
 *
 * Patrón: scripts clásicos con namespace global `App` (NO ES modules), para que
 * la aplicación funcione tanto servida por HTTP (PWA real) como abierta
 * directamente con doble clic (file://), donde los módulos ES fallan por CORS.
 * ========================================================================== */
(function (App) {
  'use strict';

  /* ---- Constantes técnicas (no editables por el usuario) ------------------ */
  App.CONST = Object.freeze({
    DB_NAME: 'tienda_pwa',
    DB_VERSION: 1,
    STORES: Object.freeze({
      PRODUCTS: 'products',
      CATEGORIES: 'categories',
      COMMENTS: 'comments',
      KV: 'kv', // almacén clave/valor: settings, passwordHash, sesión admin, etc.
    }),
    KV_KEYS: Object.freeze({
      SETTINGS: 'settings',
      PASSWORD: 'admin_password',
      VERSION: 'schema_version',
    }),
    PAGE_SIZE: 24, // productos por "página" en el scroll infinito
    IMAGE: Object.freeze({
      MAX_DIM: 1280, // px máximo del lado mayor al comprimir
      THUMB_DIM: 400, // px para miniaturas de catálogo
      QUALITY: 0.82, // calidad JPEG/WebP de salida
    }),
  });

  /* ---- Configuración por defecto de la tienda (editable en el panel) ------ */
  App.DEFAULT_SETTINGS = Object.freeze({
    storeName: "TECNOCHIP'S",
    slogan: 'Electro & Hogar',
    // Número de WhatsApp en formato internacional SIN signos ni espacios.
    // Ej. Argentina: 549 + característica sin 0 + número sin 15. (vacío = avisar)
    whatsapp: '5491164339281',
    locale: 'es-AR',
    currency: 'ARS',
    currencySymbol: '$',
    // Paleta de colores — se inyecta como variables CSS en :root (marca TECNOCHIP'S)
    theme: {
      primary: '#2b2722',
      primaryDark: '#16120e',
      accent: '#c0894a',
      bg: '#efeae0',
      surface: '#ffffff',
      text: '#2b2722',
      muted: '#8a8073',
      danger: '#c0392b',
      success: '#2e9e5b',
    },
    // Identidad visual — ruta o data URL (se puede reemplazar desde el panel).
    logo: 'icons/logo.svg',
    // Banner principal de la portada
    banner: {
      title: "TECNOCHIP'S — Electro & Hogar",
      subtitle: 'Celulares, Smart TV, consolas y tecnología al mejor precio',
      image: '',
      ctaText: 'Ver productos',
      ctaTarget: 'destacados', // vista a la que enlaza el botón
    },
    // Carrusel de imágenes promocionales (rotación automática)
    carousel: {
      autoplay: true,
      interval: 4500, // ms entre slides
      slides: [
        // { image, title, subtitle, target }
      ],
    },
    // Mensaje plantilla de WhatsApp. Tokens: {items} {total} y campos del form.
    whatsappTemplate:
      'Hola 👋. Quiero realizar el siguiente pedido:\n\n{items}\n\n*Total: {total}*\n\n*Nombre:* {nombre}\n*Dirección:* {direccion}\n*Observaciones:* {observaciones}\n\n¡Gracias!',
    // Etiquetas disponibles para productos (configurable)
    tags: ['Nuevo', 'Sellado', 'Reacondicionado', 'Usado', 'Garantía 30 días',
      'Oferta', 'Destacado', 'Recomendado', 'Última unidad', 'Smart TV', 'Gaming', 'Accesorio'],
    // Texto del footer
    footer: "TECNOCHIP'S — Electro & Hogar · Instagram @tecnochip_s",
    // Cuántos destacados mostrar en portada
    featuredLimit: 12,
  });

  /* ---- Plantilla de un producto (forma canónica) -------------------------- */
  // Documenta el "esquema" de producto. Útil al crear/importar/migrar.
  App.productSchema = function () {
    return {
      id: '', // uid interno (no editable)
      code: '', // código interno del comercio
      name: '',
      brand: '',
      model: '', // modelo (opcional; usado por la importación inteligente para matchear)
      categoryId: '',
      subcategoryId: '',
      description: '',
      price: 0, // precio normal/de lista
      priceOld: null, // precio anterior (para mostrar tachado), opcional
      priceSale: null, // precio en oferta; si existe, es el precio efectivo
      priceLock: false, // usar_precio_manual: si true, la importación NO toca el precio
      stock: 0,
      images: [], // array de data URLs (la primera es la principal)
      tags: [], // subconjunto de settings.tags
      featured: false,
      isNew: false,
      active: true, // permite ocultar sin borrar
      createdAt: 0,
      updatedAt: 0,
    };
  };

  /* ---- Plantilla de comentario -------------------------------------------- */
  App.commentSchema = function () {
    return {
      id: '',
      productId: '',
      author: '',
      text: '',
      rating: 5, // 1..5
      image: '', // data URL opcional
      date: 0, // timestamp
      approved: true,
    };
  };
})(window.App = window.App || {});
