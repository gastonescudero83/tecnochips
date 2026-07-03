# 🛒 Mi Tienda — PWA de catálogo + pedidos por WhatsApp

Tienda online **moderna, rápida y 100% offline** construida con **HTML5 + CSS3 + JavaScript puro (Vanilla JS)**, sin frameworks ni servidor.
El cliente navega el catálogo y envía su pedido por **WhatsApp**; el dueño administra **todo** desde un panel protegido por contraseña, **sin tocar código**.

---

## ✨ Características

- **Catálogo** con categorías, subcategorías, marcas, etiquetas, ofertas, novedades y destacados.
- **Buscador inteligente** instantáneo (nombre, código, marca, categoría, descripción) con sugerencias.
- **Filtros** por precio, etiquetas, stock y ofertas + ordenamientos.
- **Ficha de producto** con galería de imágenes, comentarios con estrellas y productos relacionados.
- **Carrito** completo (cantidades, subtotales, total) y **checkout por WhatsApp** con plantilla configurable.
- **Panel de administración** completo: productos, categorías, comentarios, apariencia, import/export y seguridad.
- **PWA**: instalable en Android y Windows, con Service Worker y funcionamiento **offline**.
- **Imágenes comprimidas** automáticamente en el navegador → escala a miles de productos.
- **Almacenamiento local** con **IndexedDB** (fallback a localStorage), más backup/restauración en JSON.
- **Diseño mobile-first**, responsive, con animaciones suaves y colores personalizables.

---

## 🚀 Cómo usarla

### Opción A — Rápida (doble clic, sin instalar nada)
Abrí **`index.html`** en el navegador (Chrome/Edge recomendados).
Funciona todo (catálogo, carrito, admin, datos offline) **excepto** la instalación como app y el Service Worker, que requieren un servidor (limitación de los navegadores en `file://`).

### Opción B — PWA completa (instalable + offline real)
Servila por HTTP. Algunas formas simples:

```bash
# Con Python (ya viene en muchos sistemas)
cd tienda-online
python -m http.server 8080
# Luego abrí http://localhost:8080
```

```bash
# Con Node.js
npx serve .
```

O subila gratis a **GitHub Pages**, **Netlify** o **Cloudflare Pages** (solo arrastrar la carpeta).
Al abrirla servida, aparecerá el botón **“⬇️ Instalar app”** y se podrá usar sin conexión.

---

## 🔐 Panel de administración

1. Entrá a **`#/admin`** (o tocá **“⚙️ Administrar tienda”** en el pie de página).
2. La **primera vez** te pide **crear una contraseña**.
3. Desde el panel podés administrar:

| Sección | Qué podés hacer |
|---|---|
| **Panel** | Resumen, accesos rápidos y uso de almacenamiento. |
| **Productos** | Crear, editar, eliminar, subir múltiples imágenes, precios/ofertas, stock, etiquetas, destacados y novedades. |
| **Categorías** | Crear/editar/eliminar categorías y subcategorías. |
| **Comentarios** | Agregar/editar/eliminar opiniones con estrellas e imagen; mostrar/ocultar. |
| **Apariencia** | Nombre, logo, banner, carrusel, **colores**, número y plantilla de WhatsApp, etiquetas, moneda. |
| **Importar/Exportar** | CSV/Excel de productos + **backup JSON** completo + restablecer. |
| **Seguridad** | Cambiar la contraseña. |

> **Nota de seguridad (honesta):** al no haber servidor, la contraseña **evita el acceso casual** al panel, pero **no cifra** los datos guardados en el dispositivo. Para una seguridad real hace falta un backend (ver “Crecer a futuro”).

---

## 📥 Importar productos (CSV / Excel)

Descargá la **plantilla** desde *Admin → Importar/Exportar* o usá [`data/sample-productos.csv`](data/sample-productos.csv).

Columnas:

```
codigo, nombre, marca, categoria, subcategoria, descripcion,
precio, precio_anterior, precio_oferta, stock,
etiquetas, destacado, nuevo, activo, imagenes
```

- **etiquetas** e **imagenes**: separadas por `|` (ej. `Oferta|Nuevo`).
- **destacado / nuevo / activo**: `si`/`no`.
- Las **categorías y subcategorías** que no existan **se crean solas** al importar.
- **CSV** funciona offline. **Excel (.xlsx)** usa la librería SheetJS cargada bajo demanda (requiere Internet la primera vez).

---

## 🧱 Arquitectura

```
tienda-online/
├── index.html              # Punto de entrada (carga módulos en orden)
├── manifest.json           # Metadatos PWA
├── service-worker.js       # Caché offline del "app shell"
├── css/
│   ├── base.css            # Tokens, reset y componentes base
│   ├── storefront.css      # Estilos de la tienda (cliente)
│   └── admin.css           # Estilos del panel
├── js/
│   ├── config.js           # Configuración por defecto y esquemas
│   ├── utils.js            # Utilidades (DOM, formato, hash, toasts…)
│   ├── db.js               # Persistencia (IndexedDB + fallback)  ← capa intercambiable
│   ├── store.js            # Estado + reglas de negocio (pub/sub)
│   ├── seed.js             # Datos de demostración
│   ├── images.js           # Compresión de imágenes (canvas)
│   ├── cart.js             # Carrito
│   ├── search.js           # Búsqueda y filtros
│   ├── whatsapp.js         # Generación del pedido
│   ├── importexport.js     # CSV/XLSX/plantilla
│   ├── smart-import.js     # Importación inteligente (matcheo de productos)
│   ├── router.js           # Enrutador por hash
│   ├── ui-storefront.js    # Interfaz de la tienda
│   ├── ui-admin.js         # Interfaz del panel
│   ├── ui-admin-import.js  # UI del asistente de importación
│   ├── parsers/            # Motor de parsers por proveedor (PDF/Excel)
│   │   ├── parser-system.js      # Contrato unificado (Strategy + Factory)
│   │   ├── motor_geometrico.js   # Extracción geométrica de PDFs (coords 0..1)
│   │   ├── ui-mapeo-asistido.js  # Lienzo visual para mapear proveedores nuevos
│   │   └── providers/            # Un parser por proveedor (distrimax, mercado_x, etc.)
│   ├── etapa5/             # Plataforma comercial (módulos aditivos, namespace App.E5)
│   │   ├── e5-data.js / e5-history.js / e5-security.js / e5-integrations.js
│   │   ├── e5-promotions.js / e5-banners.js / e5-brands.js / e5-categories.js
│   │   ├── e5-favorites.js / e5-compare.js / e5-share.js / e5-related.js
│   │   ├── e5-export.js / e5-bulk.js / e5-seo.js / e5-optimize.js / e5-config.js
│   │   └── ui-*-etapa5*.js        # UI de tienda y panel de la Etapa 5
│   └── app.js              # Arranque/orquestación
├── icons/                  # Iconos PWA (SVG)
├── tools/                  # parse_listado.py (regenera seed.js desde un listado)
└── data/                   # CSV de ejemplo / plantillas / catálogo
```

**Decisiones de diseño**

- **Scripts clásicos con namespace `window.App`** (no ES modules): así funciona también en `file://`.
- **Separación por capas**: la UI nunca habla con la base de datos directamente; pasa por `Store`, que a su vez usa `DB`. Los precios y reglas viven **solo** en `Store`.
- **Pub/Sub**: los cambios de datos emiten eventos y la UI se refresca sola.
- **Rendimiento**: scroll infinito por páginas, imágenes `lazy`, índice de búsqueda cacheado.

---

## 🔌 Crecer a futuro (conectar a una API/base de datos)

El frontend está preparado para migrar **sin reescribirse**:

- Toda la persistencia está aislada en **`js/db.js`** (interfaz `getAll/get/put/delete/bulkPut/…`).
- Reemplazá esa capa por llamadas `fetch()` a tu API REST (o Firebase/Supabase) y **el resto de la app sigue igual**.
- Los datos ya están **estructurados** (productos, categorías, comentarios, settings) y exportables en JSON.

---

## 🛠️ Solución de problemas

| Síntoma | Causa / Solución |
|---|---|
| No aparece “Instalar app” | Estás en `file://`. Servila por HTTP (ver Opción B). |
| El Service Worker no se registra | Igual que arriba: requiere `http(s)://` o `localhost`. |
| “Excel requiere Internet” | El `.xlsx` usa SheetJS por CDN. Usá **CSV** para 100% offline. |
| Olvidé la contraseña | *Admin → no podés entrar*: borrá los datos del sitio en el navegador, o restaurá un backup. (Sin servidor no hay recuperación.) |
| Las imágenes ocupan mucho | Ya se comprimen al subir; bajá la resolución original si seguís con problemas. |

---

## 💾 Backup y restauración (procedimiento)

Todos los datos viven en el navegador (IndexedDB). Para no depender de un solo dispositivo, exportá un respaldo periódicamente.

**Hacer un backup**
1. Entrá a **Admin → 💾 Backup / Importar** (`#/admin/datos`).
2. Tocá **“⬇️ Exportar backup”**. Se descarga `backup-tienda-AAAA-MM-DD.json` con **settings, categorías, productos y comentarios** (incluye las imágenes en data URL).
3. Guardá ese archivo en un lugar seguro (nube, pendrive, otra PC). Recomendado: **una vez por semana** y siempre **antes de una importación grande**.

**Restaurar un backup**
1. En la misma sección, elegí el archivo `.json` en **“Restaurar backup”**.
2. Marcá **Combinar** para sumar a lo existente, o dejalo sin marcar para **reemplazar todo**.
3. Confirmá. La tienda se recarga con los datos restaurados.

**Migrar a otro dispositivo:** exportá en el viejo, abrí la app en el nuevo y restaurá reemplazando.

> Para CSV/Excel de solo productos usá *Exportar productos*; el **JSON** es el respaldo **completo**.

---

## 🚢 Despliegue a producción (paso a paso)

La app es estática: se publica subiendo la carpeta tal cual. No requiere build ni servidor de aplicaciones.

1. **Verificá** que la app abre bien en local (Opción B, `http://localhost:8080`) y que el panel funciona.
2. **Subí la contraseña del admin** antes de publicar (no dejes el panel sin clave).
3. **Elegí hosting estático con HTTPS** (necesario para PWA): GitHub Pages, Netlify o Cloudflare Pages.
   - *Netlify / Cloudflare Pages:* arrastrá la carpeta `tienda-online` en el panel del servicio.
   - *GitHub Pages:* subí la carpeta a un repo y activá Pages sobre la rama `main`.
4. **Al publicar una actualización**, subí el cambio y luego **incrementá `CACHE`** en `service-worker.js` (ej. `tienda-pwa-v6` → `v7`). Eso fuerza a los dispositivos a tomar la versión nueva (el SW viejo se borra solo al activarse).
5. Abrí la URL pública, verificá que aparece **“⬇️ Instalar app”** y probá **modo avión** para confirmar el offline.

---

## 🧰 Mantenimiento

- **Datos:** se administran 100% desde el panel; no hace falta tocar código para el día a día.
- **Backups:** seguí el procedimiento de arriba con regularidad. Es la única copia fuera del dispositivo.
- **Catálogo inicial (`seed.js`):** solo se usa la **primera vez** (DB vacía). Para regenerarlo desde un listado, ejecutá `python tools/parse_listado.py`. No editar `seed.js` a mano.
- **Actualizar la app:** cambiá los archivos y **subí la versión de `CACHE`** en `service-worker.js` (ver Despliegue, paso 4).
- **Proveedores de importación nuevos:** se agregan con el **mapeo asistido** (lienzo visual) sin programar; los parsers viven en `js/parsers/providers/`.

---

Hecho como base **lista para producción**: código modular, documentado y mantenible.
```
