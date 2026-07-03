# Auditoría Técnica Integral — TECNOCHIP'S (v2)

**Fecha:** 02/07/2026
**Alcance:** Todo el proyecto (33 archivos JS, SW, manifest, CSS). Sin modificar código.
**Método:** Lectura completa del código + **verificación programática** de los bugs críticos (se ejecutaron réplicas exactas de las funciones sospechosas en Node.js; los resultados citados abajo son reales, no teóricos).

---

## 1. Resumen ejecutivo

La arquitectura general es sólida (capas UI → Store → DB, pub/sub, parsers con Strategy+Factory). **PERO esta auditoría encontró 4 bugs críticos que la auditoría anterior no detectó**, incluyendo la causa raíz de por qué "el lector de PDF no interpreta correctamente la información": no es un problema de PDF.js ni de los patrones — son **2 bugs matemáticos/estructurales concretos y demostrables** (C1 y C2).

| Severidad | Cantidad |
|---|---|
| 🔴 Crítico | 4 |
| 🟠 Alto | 11 |
| 🟡 Medio | 14 |
| 🟢 Bajo | 7 |

---

## 2. 🔴 HALLAZGOS CRÍTICOS (corregir antes de publicar)

### C1 — `U.parsePrice` destruye los precios en formato argentino ("$ 18.900" → 18,9)

- **Archivos:** `js/utils.js` (función `U.parsePrice`). Contamina TODO: `smart-import.js`, `parser-system.js` (`util.num`), `motor_geometrico.js`, todos los `providers/`, `importexport.js`.
- **Causa técnica:** el punto solo se trata como separador de miles cuando la cadena tiene coma **y** punto a la vez. Con punto solo (el formato más común en Argentina) hace `parseFloat("18.900")`.
- **Verificado ejecutando el código real:**
  ```
  parsePrice("$ 18.900")  = 18.9       ← debería ser 18900
  parsePrice("1.234.567") = 1.234      ← debería ser 1234567
  parsePrice("18.900,50") = 18900.5    ✓ (solo funciona si hay decimales con coma)
  ```
- **Riesgo:** todo catálogo importado (PDF, CSV, Excel, mapeo asistido) cuyo proveedor escriba precios sin decimales queda con precios **1.000 veces menores**. Un cliente podría pedir un Smart TV a $55 por WhatsApp. Es casi seguro que ésta es una parte central de "el lector no interpreta bien la información".
- **Solución propuesta:** en `parsePrice`, si hay solo puntos y el último grupo tras el punto tiene exactamente 3 dígitos (`/\.\d{3}(?:\.\d{3})*$/`), tratarlos como miles. Ídem simétrico para coma-solo con grupos de 3 ("18,900"). Agregar tests con los 10 formatos típicos.
- **Impacto esperado:** precios correctos en todas las vías de importación de una sola vez (la corrección es en 1 función).
- **Dificultad:** Baja (1 función + pruebas).

### C2 — El lector PDF aplasta cada página en UNA sola línea → 1 "producto" por página con precio erróneo

- **Archivos:** `js/parsers/parser-system.js` (`util.readPdfText`), consumido por `providers/prov_pdf_generico.js` y `providers/prov_electrodomesticos.js` (rama PDF).
- **Causa técnica:** `readPdfText` hace `tc.items.map(i => i.str).join(' ') + '\n'` — une **todos** los fragmentos de texto de la página con espacios y solo pone `\n` entre páginas. Los parsers luego hacen `split(/\r?\n/)` esperando líneas: reciben la página entera como una línea gigante.
- **Verificado:** con una página simulada de 3 productos, `prov_pdf_generico` devuelve **1 solo producto** cuyo nombre es todo el texto de la página y cuyo precio es el **último** número encontrado (`22.5`, además mal parseado por C1).
- **Riesgo:** por esta vía, un catálogo de 50 páginas con 10 productos por página produce ~50 registros basura en lugar de 500 correctos. Explica directamente el síntoma reportado.
- **Solución propuesta:** reconstruir líneas por coordenada Y **ya existe dos veces en el proyecto**: `groupLines()` en `smart-import.js` y `readPdfItems()` en el propio `parser-system.js`. Reescribir `readPdfText` para agrupar items por Y (tolerancia ~0.012 normalizada u ~3px) y ordenar por X, reutilizando esa lógica. No hace falta ninguna librería nueva.
- **Impacto esperado:** el parser genérico de PDF pasa de inservible a funcional para listas de precios "una línea = un producto".
- **Dificultad:** Baja-media (la lógica ya existe, hay que unificarla).

### C3 — Restaurar un backup inválido borra toda la base sin posibilidad de recuperación

- **Archivos:** `js/store.js` (`importAll`), `js/ui-admin.js` (`sectionData`).
- **Causa técnica:** `importAll` ejecuta `DB.clear()` de productos, categorías y comentarios **antes** de validar el contenido. La única validación es `typeof data === 'object'`. Un JSON válido pero de otra app (o un backup corrupto/truncado por OneDrive) pasa la validación, borra todo y no restaura nada.
- **Riesgo:** pérdida total del catálogo con un solo clic equivocado. En una app offline no hay servidor del cual recuperar.
- **Solución propuesta:** (1) validar estructura antes de tocar la DB: `data.meta?.app === 'tienda-pwa'` y `Array.isArray(data.products)`; (2) tomar snapshot en memoria (`exportAll()`) antes de `clear` y hacer rollback si algo falla; (3) mostrar en el confirm cuántos productos trae el archivo ("El backup contiene 812 productos, 14 categorías…").
- **Impacto esperado:** elimina el peor escenario de pérdida de datos de la app.
- **Dificultad:** Baja.

### C4 — El backup JSON NO incluye los datos de la Etapa 5 ni los patrones de mapeo aprendidos

- **Archivos:** `js/store.js` (`exportAll`/`importAll`).
- **Causa técnica:** `exportAll` solo exporta `settings, categories, products, comments`. Todo lo que vive en el store `kv` con prefijo `e5:` (promociones, banners, marcas, historial, config de integraciones) y las claves `mapeo_patrones` / `mapeo_geo_config` (los patrones que el usuario "enseñó" con el mapeo asistido) **queda afuera**.
- **Riesgo:** el usuario cree que tiene backup completo ("Incluye… toda la configuración", dice la UI). Al restaurar en otra PC o tras un reset: pierde todas las promos, banners, marcas y tiene que volver a mapear cada proveedor PDF a mano. Pérdida de datos silenciosa.
- **Solución propuesta:** en `exportAll`, volcar también todas las claves del store KV (excepto `admin_password`, opcional) en `data.kv`; en `importAll`, restaurarlas. Versionar el backup (`meta.version: 2`) manteniendo compatibilidad con backups v1.
- **Impacto esperado:** backup realmente completo; el mapeo asistido se vuelve portable entre dispositivos.
- **Dificultad:** Baja.

---

## 3. 🟠 HALLAZGOS ALTOS

### A1 — `IO.parseCSV` trata coma y punto-y-coma como separadores AL MISMO TIEMPO
- **Archivo:** `js/importexport.js`.
- **Causa:** `else if (c === ',' || c === ';')` corta el campo con cualquiera de los dos. Excel en es-AR exporta CSV con `;` como separador y `,` como decimal.
- **Verificado:** la fila `A1;Taladro;18,50` se parsea como `["A1","Taladro","18","50"]` — el precio queda en 18 y todas las columnas siguientes se corren una posición.
- **Solución:** detectar el separador dominante en la línea de cabecera (contar `;` vs `,` fuera de comillas) y usar solo ése. Dificultad: baja.

### A2 — Reimportar el propio CSV exportado DUPLICA todo el catálogo y pierde campos
- **Archivos:** `js/importexport.js` (`COLUMNS`, `productToRow`, `rowsToProducts`).
- **Causa:** (1) el export no incluye `id`, `modelo` ni `priceLock`, y descarta imágenes dataURL; (2) `rowsToProducts` nunca matchea contra productos existentes: siempre crea nuevos vía `bulkUpsertProducts` con ids nuevos.
- **Riesgo:** el flujo natural "exporto → corrijo precios en Excel → reimporto" duplica N productos y pierde modelo/candado de precio. 
- **Solución:** agregar columnas `id`, `modelo`, `precio_manual`; en `rowsToProducts`, si hay `id` o `codigo` coincidente, actualizar en lugar de crear. Dificultad: media.

### A3 — PDFs escaneados: 0 productos sin diagnóstico
- **Archivos:** `js/smart-import.js`, `js/parsers/*`.
- **Causa:** un PDF escaneado no tiene capa de texto; `getTextContent()` devuelve vacío. Ningún módulo detecta este caso: el usuario solo ve "No se detectaron productos".
- **Solución:** si `textos.length === 0` y hay imágenes grandes en ≥2 páginas muestreadas → mensaje específico: "Este PDF es escaneado (solo imágenes). El lector necesita PDFs con texto digital". Fase 2 opcional: OCR local con Tesseract.js (pesado ~15MB; solo si el negocio lo exige). Dificultad: baja (detección) / alta (OCR).

### A4 — La importación PDF/Excel NUNCA funciona offline (CDN no cacheado)
- **Archivos:** `parser-system.js`, `smart-import.js`, `importexport.js`, `prov_mapeo_asistido.js`, `service-worker.js`.
- **Causa:** pdf.js y SheetJS se cargan de `cdn.jsdelivr.net` en runtime, y el SW ignora explícitamente peticiones cross-origin (`url.origin !== self.location.origin`). Contradice la regla del proyecto de procesamiento 100% local/offline.
- **Solución:** descargar `pdf.min.js`, `pdf.worker.min.js` y `xlsx.full.min.js` a `js/vendor/`, referenciarlos localmente y sumarlos al `SHELL` del SW. Elimina además 3 copias duplicadas de `loadScript/ensurePdf/ensureXLSX`. Dificultad: baja.

### A5 — Precache del Service Worker incompleto: la PWA instalada se rompe offline
- **Archivo:** `service-worker.js` (`SHELL`).
- **Causa:** faltan en el precache: `css/etapa5.css`, los **21 archivos** `js/etapa5/*.js`, `js/parsers/providers/prov_mapeo_asistido.js`, `js/parsers/ui-mapeo-asistido.js`, `icons/logo.svg`. `index.html` los referencia; si el usuario instala la app y abre offline antes de una segunda visita online, esos scripts fallan y el arranque queda a medias.
- **Solución:** completar `SHELL` con todos los archivos referenciados por `index.html` y subir `CACHE` a `v7`. Idealmente generar la lista con un script para que no vuelva a desincronizarse. Dificultad: baja.

### A6 — PDFs multi-columna: las líneas de columnas distintas se mezclan
- **Archivo:** `js/smart-import.js` (`groupLines`).
- **Causa:** agrupa solo por Y (±3px) en toda la página: en un catálogo a 2 columnas, el texto de la columna izquierda y derecha con la misma altura se concatena en una sola "línea" → nombres con el precio de la otra columna.
- **Solución:** clusterizar primero por X (la lógica ya existe en `detectGridCells`) y agrupar líneas dentro de cada columna; o unificar la extracción PDF sobre `readPdfItems` + `MotorGeometrico` como única ruta. Dificultad: media.

### A7 — `prov_mapeo_asistido.match()` devuelve 0.5 si existe CUALQUIER patrón (no verifica que sea de ese archivo)
- **Archivo:** `js/parsers/providers/prov_mapeo_asistido.js`.
- **Causa:** `return Object.keys(pats).length ? 0.5 : 0;` — no compara fingerprints. Tras aprender 1 proveedor, TODOS los PDFs desconocidos puntúan 0.5 y le ganan a `prov_pdf_generico` (0.3) y a `prov_electrodomesticos` en muchos casos.
- **Riesgo:** PDFs de texto simple que antes se importaban por la vía genérica pasan a exigir mapeo visual o a caer al motor geométrico.
- **Solución:** el `ctx` ya trae texto de cabecera: calcular un fingerprint aproximado en `match()` y devolver 0.9 si coincide con un patrón guardado, 0 si no (dejando el fallback explícito del runner intacto). Dificultad: media.

### A8 — La configuración geométrica auto-detectada se persiste para siempre, sin forma de corregirla desde la UI
- **Archivos:** `prov_mapeo_asistido.js` (`KV_GEO`), `ui-admin-import.js`.
- **Causa:** la primera importación de un proveedor "por bloques" auto-detecta sectores/orientación y la guarda en IndexedDB. Si la detección falló (portada, página atípica), **todas** las importaciones futuras de ese proveedor usan la config mala. Existen `olvidarGeo()`/`olvidar()` pero ninguna pantalla los expone.
- **Solución:** en Importar Catálogo, sección "Proveedores aprendidos" con lista de patrones/configs y botones "Re-mapear" y "Olvidar". Dificultad: media.

### A9 — El motor geométrico inventa precios a partir de números de modelo
- **Archivos:** `js/parsers/motor_geometrico.js` (`RE_PRECIO`, `buscaPrecio`), `prov_mapeo_asistido.js`.
- **Causa:** `RE_PRECIO` acepta `\d+(?:[.,]\d{2})?` (cualquier entero) y `buscaPrecio` devuelve el **máximo** del sector. Un sector sin precio pero con modelo "UN50AU7000" o "55 pulgadas" produce precio=7000 o 55.
- **Solución:** exigir `$` o formato de miles (`\d{1,3}(?:\.\d{3})+`) para considerar un token como precio; si no hay match confiable, precio 0 + marcar "requiere revisión" (el flujo de revisión ya existe). Dificultad: baja.

### A10 — Fuga de memoria/CPU: el banner E5 de portada crea un `setInterval` por cada visita al home y nunca lo limpia
- **Archivo:** `js/etapa5/ui-storefront-etapa5.js` (`homeTop`, línea ~128).
- **Causa:** a diferencia del carrusel principal (que limpia `carouselTimer` en `renderRoute`), este `setInterval(…, 5000)` no se guarda ni se cancela. Navegar 20 veces al inicio deja 20 timers pintando nodos desmontados.
- **Solución:** módulo guarda el id del timer y lo cancela antes de crear otro (o al cambiar de ruta). Dificultad: baja.

### A11 — Matching de importación O(registros × productos) con Levenshtein en el hilo principal
- **Archivo:** `js/smart-import.js` (`findMatch`, `buildPlan`).
- **Causa:** por cada registro importado recorre TODOS los productos calculando similitud de nombre. 1.000 registros × 3.000 productos ≈ 3M comparaciones Levenshtein sin ceder el hilo → UI congelada varios segundos/minutos.
- **Solución:** (1) índices `Map` por código normalizado y por marca+modelo (matching exacto O(1)); (2) limitar el fuzzy a productos de la misma marca o primera letra; (3) `await new Promise(r=>setTimeout(r))` cada 50 registros para no congelar. Dificultad: media.

---

## 4. 🟡 HALLAZGOS MEDIOS

**M1. El PDF se procesa dos veces.** `buildContext` lee 5 páginas para detectar proveedor y `parse()` vuelve a abrir y leer el archivo completo. En PDFs de 25MB duplica tiempo y memoria. → Cachear el documento pdf.js en el `ctx`. (`parser-system.js`)

**M2. `seed.js` pesa 328 KB y se parsea en cada arranque** (además de estar en el precache; `data/catalogo.json` suma 348 KB muertos). Solo se usa en el primer arranque o tras reset. → Cargarlo bajo demanda con `fetch` dinámico solo cuando la DB está vacía; sacar el JSON del repo o documentarlo.

**M3. El carrito no revalida stock.** La cantidad se limita al stock vigente al momento de agregar; si el admin baja el stock después, el pedido de WhatsApp puede salir con más unidades que las disponibles. → Revalidar en `Cart.lines()`/`WhatsApp.send()` y avisar. (`cart.js`, `whatsapp.js`)

**M4. Doble disparo de `Cart.setQty`** en `cartLine` (evento `change` en captura + `click` con `setTimeout`). Hoy inocuo, frágil ante futuros efectos colaterales. (`ui-storefront.js`, ya observado en la auditoría v1)

**M5. UX/pérdida de datos del visitante:** el botón "✕" de la barra flotante E5 **borra todos los favoritos y comparados** sin confirmación; el usuario espera "cerrar la barra". → Separar "ocultar" de "vaciar" (con confirm). (`ui-storefront-etapa5.js`, `updateBar`)

**M6. El módulo de seguridad E5 está escrito pero NO conectado.** El login del admin no usa `rateLimit` (fuerza bruta ilimitada), los importadores usan validación por extensión (`SmartImport.validateFile`) en lugar de la validación por firma/magic-bytes de `E5.Security.validateFile`, y el token CSRF no tiene ningún consumidor. → Integrar en `renderGate` y `selectFile`; o eliminar lo que no se vaya a usar. (`e5-security.js`, `ui-admin.js`, `ui-admin-import.js`)

**M7. XSS en la exportación PDF/imprimir:** `E5.Export.pdf()` interpola `r.name`, `r.code`, `r.brand`, `r._cat` **sin escapar** en HTML y lo inyecta con `document.write`. Un nombre de producto con HTML (p. ej. importado de un archivo malicioso o con restos de markup) ejecuta script en la ventana de impresión. → Escapar con `U.escapeHtml` (ya existe y no se usa aquí). (`e5-export.js`, ~L96-113)

**M8. Prototype pollution en `deepMerge`:** un backup JSON con clave `"__proto__"` contamina `Object.prototype` al restaurar settings. → Filtrar `__proto__`, `constructor`, `prototype`. (`store.js`)

**M9. `Router.parse` sin try/catch en `decodeURIComponent`:** un hash malformado (`#/%zz`) lanza `URIError` y deja la vista en blanco hasta corregir la URL a mano. → Envolver en try/catch con fallback al segmento crudo. (`router.js`)

**M10. Fallback localStorage sin manejo de cuota:** en modo `ls` (navegadores sin IndexedDB), guardar productos con imágenes base64 supera los ~5MB y `lsWrite` lanza `QuotaExceededError` no capturado → guardados que fallan de forma inconsistente y silenciosa. → try/catch + aviso "almacenamiento lleno". (`db.js`)

**M11. `ctaUrl` de banners E5 acepta cualquier string como `href`** (incluido `javascript:…`). Aunque lo carga el admin, conviene sanitizar a `https?:`. (`ui-admin-etapa5.js`, `ui-storefront-etapa5.js`)

**M12. Pedidos de WhatsApp muy grandes pueden exceder el límite de URL** (~2.000+ caracteres según navegador): carritos de 30+ ítems con plantilla larga se truncan al abrir wa.me. → Si `url.length > 1800`, compactar líneas o avisar. (`whatsapp.js`)

**M13. Manifest solo con íconos SVG.** Varios Android/WebAPK aún requieren PNG 192px y 512px para instalabilidad plena; Lighthouse lo marca. → Generar PNGs y sumarlos a `icons` y al precache. (`manifest.json`)

**M14. Fingerprint del mapeo asistido frágil:** se basa en el texto de cabecera de la página 1 + relación de aspecto. Si el proveedor agrega una portada o cambia el encabezado, el patrón aprendido no se reconoce, sin mensaje que lo explique. → Fingerprint sobre página "típica" (la 2ª o mediana) y/o matching difuso; UI de patrones (ver A8) para diagnóstico. (`prov_mapeo_asistido.js`)

---

## 5. 🟢 HALLAZGOS BAJOS (mejoras opcionales)

**B1. Código duplicado a consolidar:** `loadScript/ensurePdf/ensureXLSX` ×3 (`parser-system`, `smart-import`, `prov_mapeo_asistido`/`importexport`), `extractPrice` ×3, `resolveCat` ×3 (`importexport`, `smart-import`, `ui-admin-import`), y `applyPlan` (smart-import) vs `aplicarRegistros` (ui-admin-import) que son casi idénticos. Un módulo `js/lib-common.js` reduce ~300 líneas y el riesgo de corregir un bug en un lugar y no en los otros (exactamente lo que pasó con C1/C2).

**B2. Código muerto / residuos:** `E5.Optimize.cachedQuery` y `scan()` (nadie usa `data-src`), token CSRF sin consumidores, `App.Parsers.demo()` en producción, archivo basura `js/etapa5/.fuse_hidden0000000800000001`, `tools/parse_listado.py` y `data/catalogo.json` sin referencias en runtime.

**B3. Accesibilidad:** los drawers (menú, filtros) no atrapan el foco ni cierran con Escape; los modales tampoco. Mejora simple de teclado.

**B4. `indexCache` de búsqueda nunca purga productos eliminados** (fuga menor de memoria en sesiones largas con muchas importaciones).

**B5. Sesión admin = `sessionStorage['1']`.** Trivialmente falsificable desde DevTools; aceptable en el modelo offline (ya documentado con honestidad en la UI), pero conviene al menos atar la sesión al hash de la contraseña para que un cambio de clave invalide sesiones.

**B6. `console.info/warn` verboso en producción** (parsers loguean cada registro). Un flag `App.DEBUG` lo silencia.

**B7. Iconos/labels:** botón "✖ X" de compartir puede confundirse con "cerrar"; revisar en móvil.

---

## 6. Respuesta directa: ¿por qué falla el lector de catálogos PDF y cómo rediseñarlo?

**Qué está fallando (en orden de impacto):**
1. **C1** — todos los precios "18.900" se guardan como 18,9.
2. **C2** — la vía `Parsers` (PDF genérico / electrodomésticos) lee 1 línea por página → basura.
3. **A6** — la vía `SmartImport` mezcla columnas en catálogos multi-columna.
4. **A7/A8** — el mapeo asistido "secuestra" PDFs ajenos y persiste configs erróneas sin poder corregirlas.
5. **A9** — el motor geométrico toma modelos como precios.
6. **A3** — escaneados: silencio total.
7. **A4** — sin Internet no funciona nada de PDF.

**Limitación estructural:** hay **tres motores de extracción PDF paralelos** (SmartImport heurístico, Parsers+providers, MapeoAsistido+MotorGeometrico) con tres extractores de texto distintos y utilidades duplicadas. Los bugs se corrigen en uno y sobreviven en los otros.

**Rediseño recomendado (manteniendo la arquitectura actual):**
- **Una sola capa de extracción**: `readPdfItems()` (texto con coordenadas + imágenes con bbox) como fuente única; `readPdfText` se reimplementa encima agrupando líneas por Y/X. Los tres motores pasan a consumir la misma capa.
- **PDF.js vendorizado localmente** (A4) — misma librería, sin CDN. No se justifica cambiar de librería: pdf.js es la opción correcta para extracción client-side offline; el problema nunca fue la librería sino el post-procesamiento.
- **Pipeline de decisión claro por PDF:** ¿tiene texto? no → aviso "escaneado" (A3). ¿patrón aprendido con fingerprint coincidente? → aplicarlo. ¿imágenes por bloques? → motor geométrico (con precios estrictos, A9). Si no → parser de líneas (con C2 corregido). Como último recurso → mapeo visual.
- **Panel "Proveedores aprendidos"** (A8) para ver/re-mapear/olvidar patrones.

---

## 7. Verificación funcional (resto de módulos)

| Módulo | Estado | Observaciones |
|---|---|---|
| Catálogo / scroll infinito | ✅ OK | Observer bien desconectado entre rutas |
| Buscador + sugerencias | ✅ OK | Ranking razonable; cache con versión por `updatedAt` |
| Categorías / subcategorías | ✅ OK | Borrado desasigna productos correctamente |
| Filtros (precio/tags/stock) | ✅ OK | — |
| Promociones E5 | ✅ OK | Activación por fecha correcta (`isLive`) |
| Novedades / destacados | ✅ OK | — |
| Carrito | ⚠️ | M3 (stock no revalidado), M4 (doble setQty) |
| Pedido WhatsApp | ⚠️ | M12 (límite URL); resto correcto |
| Panel admin | ⚠️ | M6 (login sin rate limit) |
| Importar Excel/CSV | 🔴 | C1, A1, A2 |
| Importar PDF | 🔴 | C1, C2, A3, A4, A6–A9 |
| Exportaciones | ⚠️ | M7 (XSS print), A2 (columnas faltantes) |
| Backup / restauración | 🔴 | C3, C4 |
| PWA (SW/manifest/offline) | 🟠 | A4, A5, M13 |
| Seguridad cliente | ⚠️ | M6, M7, M8, M11 |

---

## 8. Plan de trabajo priorizado

Cada fase es independiente y entregable por separado (archivo por archivo, según la metodología del proyecto). Ninguna cambia la arquitectura ni el esquema de IndexedDB.

**FASE 1 — Datos correctos y sin pérdidas (bloqueante para publicar)**
1. `js/utils.js` → corregir `parsePrice` (C1) + casos de prueba.
2. `js/store.js` → validación previa + snapshot/rollback en `importAll` (C3); backup completo con claves KV/E5 (C4).
3. `js/importexport.js` → detección de separador CSV (A1); columnas `id/modelo/precio_manual` + upsert por id/código (A2).
- *Riesgo de regresión: muy bajo. Son funciones puras o con rollback.*

**FASE 2 — Lector de PDF confiable**
4. `js/parsers/parser-system.js` → `readPdfText` con líneas reales por coordenadas (C2) + cache del documento (M1).
5. `js/parsers/motor_geometrico.js` → regex de precio estricta (A9).
6. `js/parsers/providers/prov_mapeo_asistido.js` → `match()` por fingerprint real (A7).
7. `js/smart-import.js` → agrupación por columnas (A6) + detección de PDF escaneado (A3) + índices de matching y cesión de hilo (A11).
8. `js/ui-admin-import.js` → panel "Proveedores aprendidos" (A8).
- *Probar con: PDF 1 columna, 2 columnas, catálogo con fotos, escaneado, >100 páginas.*

**FASE 3 — PWA offline real**
9. Vendorizar pdf.js + SheetJS en `js/vendor/` (A4).
10. `service-worker.js` → SHELL completo + `CACHE v7` (A5); PNGs del manifest (M13).

**FASE 4 — Estabilidad y seguridad**
11. `ui-storefront-etapa5.js` → limpiar interval del banner (A10) + separar ocultar/vaciar barra (M5).
12. `e5-export.js` → escapar HTML (M7). `store.js` → deepMerge seguro (M8). `router.js` → try/catch (M9). `db.js` → cuota LS (M10). `ui-admin.js` → rate limit en login + validación por firma en importadores (M6). `whatsapp.js` → límite URL (M12). `cart.js` → revalidar stock (M3, M4).

**FASE 5 — Limpieza (opcional, post-publicación)**
13. Consolidar duplicados en `js/lib-common.js` (B1); eliminar código muerto y archivos residuales (B2); seed bajo demanda (M2); accesibilidad de drawers/modales (B3).

---

*Ningún cambio propuesto duplica funcionalidad existente: en todos los casos se reutiliza lógica que ya está en el proyecto (`readPdfItems`, `groupLines`, `detectGridCells`, `U.escapeHtml`, `olvidarGeo`, `E5.Security`) y que hoy está desconectada o duplicada.*
