/* =============================================================================
 * e5-security.js — ETAPA 5 · Punto 16: Seguridad (cliente, offline)
 * -----------------------------------------------------------------------------
 * Nota honesta: al ser una PWA serverless 100% en el navegador, no existe un
 * backend donde aplicar seguridad "real" de servidor. Estos mecanismos son las
 * defensas que SÍ tienen sentido del lado del cliente y dejan la arquitectura
 * lista para reforzarlas si en el futuro se agrega un servidor (ver pto.17):
 *
 *   • Rate Limiting   — limita reintentos (ej. login admin) por ventana de tiempo.
 *   • Token anti-CSRF — token de sesión local para validar acciones sensibles.
 *   • Validación de archivos — chequea tipo/extensión/tamaño/firma antes de
 *     procesar PDFs, Excels o imágenes en los importadores.
 *   • Registro de actividad / Auditoría — delega en App.E5.History.
 *
 * API:
 *   App.E5.Security.rateLimit.check(key,{max,windowMs}) -> {allowed, retryInMs, left}
 *   App.E5.Security.rateLimit.reset(key)
 *   App.E5.Security.csrf.token()                         -> string
 *   App.E5.Security.csrf.validate(t)                     -> bool
 *   App.E5.Security.validateFile(file, rules)            -> Promise<{ok, reason}>
 *   App.E5.Security.activity(action, detail)             -> Promise (registra en historial)
 * ========================================================================== */
(function (App) {
  'use strict';
  const E5 = App.E5;

  /* ---- Rate limiting en memoria (ventana deslizante simple) -------------- */
  const buckets = {};
  const rateLimit = {
    check(key, opts) {
      opts = opts || {};
      const max = opts.max || 5;
      const windowMs = opts.windowMs || 60000;
      const t = Date.now();
      const b = (buckets[key] = buckets[key] || []);
      // descartar timestamps fuera de ventana
      while (b.length && t - b[0] > windowMs) b.shift();
      if (b.length >= max) {
        return { allowed: false, retryInMs: windowMs - (t - b[0]), left: 0 };
      }
      b.push(t);
      return { allowed: true, retryInMs: 0, left: max - b.length };
    },
    reset(key) { delete buckets[key]; },
  };

  // Limpieza (auditoría B2): se eliminó el token anti-CSRF. En una app 100%
  // cliente sin servidor no hay peticiones que proteger con él y ningún módulo
  // lo consumía: era una falsa sensación de seguridad. Si algún día se agrega
  // un backend, el token debe generarse y validarse EN EL SERVIDOR.

  /* ---- Validación de archivos -------------------------------------------- */
  // Firmas (magic numbers) básicas para detectar tipo real, no solo extensión.
  const SIGNATURES = {
    pdf: [[0x25, 0x50, 0x44, 0x46]],                       // %PDF
    zip: [[0x50, 0x4b, 0x03, 0x04]],                       // PK.. (xlsx/docx son zip)
    jpg: [[0xff, 0xd8, 0xff]],
    png: [[0x89, 0x50, 0x4e, 0x47]],
    gif: [[0x47, 0x49, 0x46, 0x38]],
    webp: [[0x52, 0x49, 0x46, 0x46]],                      // RIFF (luego WEBP)
  };

  function readHead(file, n) {
    return new Promise((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(new Uint8Array(r.result));
      r.onerror = () => resolve(new Uint8Array());
      r.readAsArrayBuffer(file.slice(0, n));
    });
  }
  function matchSig(bytes, sigs) {
    return (sigs || []).some((sig) => sig.every((b, i) => bytes[i] === b));
  }

  /**
   * rules: { accept:['pdf','xlsx','xls','csv','image'], maxMB:Number }
   * Devuelve { ok:bool, reason:string, kind:string }
   */
  async function validateFile(file, rules) {
    rules = rules || {};
    const accept = rules.accept || [];
    const maxMB = rules.maxMB || 25;
    if (!file) return { ok: false, reason: 'No se recibió archivo' };

    if (file.size > maxMB * 1024 * 1024) {
      return { ok: false, reason: 'Archivo demasiado grande (máx ' + maxMB + 'MB)' };
    }

    const name = (file.name || '').toLowerCase();
    const ext = name.split('.').pop();
    const head = await readHead(file, 16);

    let kind = null;
    if (matchSig(head, SIGNATURES.pdf)) kind = 'pdf';
    else if (matchSig(head, SIGNATURES.zip)) kind = (ext === 'xlsx' || ext === 'xlsm') ? 'xlsx' : 'zip';
    else if (matchSig(head, SIGNATURES.jpg) || matchSig(head, SIGNATURES.png) ||
             matchSig(head, SIGNATURES.gif) || matchSig(head, SIGNATURES.webp)) kind = 'image';
    else if (ext === 'csv' || ext === 'txt' || ext === 'xls') kind = ext; // texto/legacy: confiar en extensión

    // Mapear "image" y extensiones a la lista de aceptados
    const okType = accept.length === 0 || accept.some((a) => {
      if (a === 'image') return kind === 'image';
      if (a === 'xlsx') return kind === 'xlsx' || ext === 'xlsx' || ext === 'xlsm';
      return a === kind || a === ext;
    });

    if (!okType) {
      return { ok: false, reason: 'Tipo de archivo no permitido (.' + ext + ')', kind };
    }
    return { ok: true, reason: '', kind: kind || ext };
  }

  /* ---- Registro de actividad (delegado al historial) --------------------- */
  function activity(action, detail) {
    if (App.E5.History) return App.E5.History.log('security', action, detail);
    return Promise.resolve();
  }

  App.E5.Security = { rateLimit, validateFile, activity };
})(window.App = window.App || {});
