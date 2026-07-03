# Sistema modular de parsers por proveedor

Arquitectura limpia y escalable para procesar archivos (PDF/Excel/CSV) de
**distintos proveedores**, donde cada proveedor tiene su **propio parser
independiente** y todos devuelven el **mismo formato unificado**.

- **Strategy Pattern** → cada proveedor es una estrategia (`match` + `parse`).
- **Factory Pattern** → `getParser(file)` elige automáticamente la estrategia.
- **Formato de salida único** (no se permite otro):

```json
{
  "producto": "string",
  "precio": 0,
  "stock": 0,
  "proveedor": "string",
  "codigo": "string (opcional)",
  "fecha": "string (ISO)"
}
```

## Estructura

```
js/parsers/
├── parser-system.js          # Núcleo: interfaz base, registro, router, normalizador, runner, logger
└── providers/
    ├── prov_distrimax.js      # Proveedor Distrimax (Excel/CSV)
    ├── prov_mercado_x.js      # Proveedor Mercado X (Excel/CSV)
    └── prov_pdf_generico.js   # PDF genérico (último recurso)
```

## Cómo selecciona el parser (router)

`getParser(file)` construye un *contexto* leyendo el archivo **una sola vez**
(nombre, extensión, tipo, encabezados/columnas, palabras clave) y le pide a cada
parser un puntaje de confianza con `match(ctx)` (0..1). Gana el más alto. Si
ninguno supera 0, se registra el aviso y se continúa con los demás archivos.

Criterios de `match` recomendados: nombre del archivo, tipo (PDF/Excel),
estructura interna (headers/columnas) y palabras clave del contenido.

## Agregar un proveedor nuevo (sin tocar nada existente)

1. Crear `js/parsers/providers/prov_mi_proveedor.js`:

```js
(function (App) {
  'use strict';
  App.Parsers.define({
    id: 'prov_mi_proveedor',
    provider: 'Mi Proveedor',
    supports: ['xlsx', 'csv'],            // o ['pdf']
    match(ctx) {                          // confianza 0..1
      let s = 0;
      if (/mi_proveedor/i.test(ctx.name)) s += 0.6;
      const h = ctx.headerNorm.join(' ');
      if (/columna_clave/.test(h)) s += 0.4;
      return s;
    },
    parse(file, ctx, util) {              // SIEMPRE el formato unificado
      const idx = util.mapHeaders(ctx.headers, {
        producto: ['descripcion', 'producto'],
        precio: ['precio'],
        stock: ['stock', 'existencia'],
        codigo: ['codigo', 'sku'],
      });
      const out = [];
      for (let r = 1; r < ctx.rows.length; r++) {
        const row = ctx.rows[r] || [];
        const g = (f) => (idx[f] >= 0 ? row[idx[f]] : '');
        if (!util.str(g('producto'))) continue;
        out.push({
          producto: util.str(g('producto')),
          precio: util.num(g('precio')),
          stock: util.int(g('stock')),
          proveedor: 'Mi Proveedor',
          codigo: util.str(g('codigo')),
          fecha: new Date().toISOString(),
        });
      }
      return out;
    },
  });
})(window.App = window.App || {});
```

2. Agregar el `<script>` en `index.html` (y, opcionalmente, en el Service Worker).

**Listo.** No se modifica el núcleo ni los otros parsers. El router lo detecta
solo.

## Uso

```js
// Un archivo
const parser = await App.Parsers.getParser(file);   // -> Parser | null
const result = await App.Parsers.process(file);     // -> { ok, provider, records, ... }

// Varios archivos (continúa aunque alguno falle)
const { results, summary, log } = await App.Parsers.processAll(fileList);

// Demo en memoria (Distrimax + Mercado X + uno desconocido)
const demo = await App.Parsers.demo();
```

## Manejo de errores

- Si un parser lanza una excepción, **no rompe el sistema**: se loguea
  (`App.Parsers.logger`) y el procesamiento de los demás archivos continúa.
- `App.Parsers.logger.get()` devuelve el registro completo (info/warn/error).

## Nota de arquitectura

Es un **módulo independiente y aditivo**: no modifica el catálogo, la base de
datos, el diseño ni el importador de productos existente. Las librerías PDF
(pdf.js) y Excel (SheetJS) se cargan **bajo demanda**; CSV funciona offline.
El proyecto es offline (IndexedDB), por lo que la salida unificada queda
disponible para que la consuma quien corresponda (no usa Supabase).
