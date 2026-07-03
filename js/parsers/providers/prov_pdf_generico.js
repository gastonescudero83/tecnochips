/* =============================================================================
 * prov_pdf_generico.js — Parser PDF genérico (último recurso para PDFs)
 * -----------------------------------------------------------------------------
 * Estrategia de baja prioridad: matchea cualquier PDF con confianza baja, de
 * modo que un parser PDF específico de un proveedor (si se agrega en el futuro)
 * lo supere automáticamente. Extrae líneas con precio del texto del PDF.
 * ========================================================================== */
(function (App) {
  'use strict';

  function extractPrice(text) {
    let m, best = null;
    const re = /\$\s*([\d][\d.,]*)/g;
    while ((m = re.exec(text))) best = m;
    if (!best) {
      const re2 = /\b(\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{2})?|\d{3,}(?:[.,]\d{2})?)\b/g;
      while ((m = re2.exec(text))) best = m;
    }
    return best ? { value: best[1], index: best.index, raw: best[0] } : null;
  }

  App.Parsers.define({
    id: 'prov_pdf_generico',
    provider: 'PDF Genérico',
    supports: ['pdf'],

    // Confianza baja: cualquier PDF, pero un parser PDF específico lo gana.
    match(ctx) { return ctx.kind === 'pdf' ? 0.3 : 0; },

    async parse(file, ctx, util) {
      // Lee TODO el texto del PDF (el ctx sólo trae las primeras páginas).
      const text = await util.readPdfText(file, 200);
      const out = [];
      text.split(/\r?\n/).forEach((line) => {
        line = line.replace(/\s+/g, ' ').trim();
        if (line.length < 3) return;
        const low = util.norm(line);
        if (/^(total|subtotal|iva|pagina|lista de precios|catalogo)\b/.test(low)) return;
        const p = extractPrice(line);
        if (!p || !(util.num(p.value) > 0)) return;
        let producto = (line.slice(0, p.index) + ' ' + line.slice(p.index + p.raw.length)).replace(/\s+/g, ' ').trim();
        if (producto.length < 2) return;
        let codigo = '';
        const first = producto.split(' ')[0];
        if (/[0-9]/.test(first) && /^[A-Za-z0-9._\-\/]{3,}$/.test(first) && !/^\d{1,2}$/.test(first)) codigo = first;
        out.push({
          producto: producto,
          precio: util.num(p.value),
          stock: 0, // el PDF rara vez trae stock
          proveedor: 'PDF Genérico',
          codigo: codigo,
          fecha: new Date().toISOString(),
        });
      });
      return out;
    },
  });
})(window.App = window.App || {});
