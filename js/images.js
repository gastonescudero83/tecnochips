/* =============================================================================
 * images.js — Compresión y procesamiento de imágenes en el navegador (canvas)
 * -----------------------------------------------------------------------------
 * Al subir fotos desde el panel, se redimensionan y comprimen ANTES de guardar
 * en IndexedDB. Esto es clave para escalar a miles de productos sin reventar el
 * almacenamiento local. Prefiere WebP (mejor ratio) y cae a JPEG si no hay soporte.
 * ========================================================================== */
(function (App) {
  'use strict';

  const { IMAGE } = App.CONST;

  // Detección única del mejor formato de salida soportado
  const outputMime = (function () {
    try {
      const c = document.createElement('canvas');
      c.width = c.height = 1;
      if (c.toDataURL('image/webp').indexOf('image/webp') === 5) return 'image/webp';
    } catch (_e) { /* noop */ }
    return 'image/jpeg';
  })();

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }

  /**
   * Comprime un File/Blob/dataURL a un data URL redimensionado.
   * @param {File|Blob|string} source
   * @param {object} [opts] - { maxDim, quality, mime }
   * @returns {Promise<string>} data URL
   */
  async function compress(source, opts = {}) {
    const maxDim = opts.maxDim || IMAGE.MAX_DIM;
    const quality = opts.quality || IMAGE.QUALITY;
    const mime = opts.mime || outputMime;

    const src = typeof source === 'string' ? source : await App.U.readFileAsDataURL(source);
    const img = await loadImage(src);

    let { width, height } = img;
    if (width > maxDim || height > maxDim) {
      const ratio = Math.min(maxDim / width, maxDim / height);
      width = Math.round(width * ratio);
      height = Math.round(height * ratio);
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, width, height);

    const out = canvas.toDataURL(mime, quality);
    // Si por algún motivo el resultado es más pesado que el original, conserva original
    return out.length < src.length || typeof source !== 'string' ? out : src;
  }

  /** Genera una miniatura cuadrada-ish para listados (más liviana). */
  async function thumbnail(source, opts = {}) {
    return compress(source, { maxDim: opts.maxDim || IMAGE.THUMB_DIM, quality: opts.quality || 0.72 });
  }

  /** Procesa múltiples archivos en serie (evita picos de memoria). */
  async function compressMany(fileList, opts) {
    const files = Array.from(fileList || []);
    const results = [];
    for (const f of files) {
      if (!f.type || f.type.indexOf('image/') !== 0) continue;
      try { results.push(await compress(f, opts)); }
      catch (e) { console.warn('[images] no se pudo procesar', f.name, e); }
    }
    return results;
  }

  /** Estima el peso (KB) de un data URL base64. */
  function weightKB(dataUrl) {
    if (!dataUrl) return 0;
    const i = dataUrl.indexOf(',');
    const b64 = i >= 0 ? dataUrl.slice(i + 1) : dataUrl;
    return Math.round((b64.length * 3) / 4 / 1024);
  }

  App.Images = { compress, thumbnail, compressMany, weightKB, outputMime };
})(window.App = window.App || {});
