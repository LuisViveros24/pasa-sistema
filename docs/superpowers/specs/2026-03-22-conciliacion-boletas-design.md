# Conciliación de Boletas — Diseño Técnico
**Fecha:** 2026-03-22
**Módulo:** Báscula / Boletas
**Proyecto:** DGSPM — Sistema Integral de Supervisión PASA

---

## Resumen

Funcionalidad para conciliar mes a mes las capturas de boletas de báscula del sistema DGSPM contra los reportes que envía la concesionaria (archivos XLSX o PDF). El resultado identifica coincidencias, diferencias y folios exclusivos de cada parte, se guarda en la base de datos y se puede exportar como reporte formal.

---

## Requerimientos

- Seleccionar periodo (mes/año) a conciliar
- Cargar archivo externo (.xlsx, .xls o .pdf con texto seleccionable)
- Comparar contra boletas propias del periodo seleccionado
- Campos de match: `folio` (clave primaria), luego `num_eco`, `peso_bruto`, `tara`, `peso_neto`
- Tolerancia de pesos: ±1.0% — diferencias dentro del rango NO generan señalamiento
- Cualquier campo fuera de tolerancia genera un señalamiento con descripción automática
- Casos cubiertos: coincidencia exacta, diferencia de valores, folio solo en mis registros, folio solo en el externo
- Resultado persistente en BD (guardado explícito por el usuario)
- Vista en pantalla con filtros por categoría
- Exportación a Excel (4 hojas) y PDF formal
- Acceso restringido por `requireAuth`

---

## Base de Datos

### Tabla `conciliaciones`

| Columna | Tipo | Descripción |
|---------|------|-------------|
| `id` | INTEGER PK AUTOINCREMENT | |
| `periodo` | TEXT NOT NULL | Formato "YYYY-MM", ej. "2026-03" |
| `archivo_nombre` | TEXT | Nombre del archivo cargado |
| `fecha_carga` | TEXT NOT NULL DEFAULT (datetime('now','localtime')) | Fecha/hora de la conciliación |
| `total_propios` | INTEGER DEFAULT 0 | Boletas en el sistema para el periodo |
| `total_externos` | INTEGER DEFAULT 0 | Registros en el archivo externo |
| `total_ok` | INTEGER DEFAULT 0 | Folios coincidentes sin diferencias |
| `total_diff` | INTEGER DEFAULT 0 | Folios con al menos una diferencia |
| `total_solo_mios` | INTEGER DEFAULT 0 | Folios solo en mis registros |
| `total_solo_suyos` | INTEGER DEFAULT 0 | Folios solo en el archivo externo |
| `estado` | TEXT DEFAULT 'abierta' | "abierta" o "cerrada" |
| `datos_incompletos` | INTEGER DEFAULT 0 | 1 si el periodo tenía >9999 boletas y la conciliación es parcial |
| `created_at` | TEXT NOT NULL DEFAULT (datetime('now','localtime')) | |

**Restricciones:**
- `periodo` tiene constraint `UNIQUE` — solo una conciliación activa por mes. Si se intenta crear otra para el mismo periodo, el servidor retorna 409 con mensaje claro; el frontend ofrece eliminar la anterior primero.
- DELETE bloqueado si `estado = 'cerrada'` — el servidor retorna 409 con mensaje "No se puede eliminar una conciliación cerrada".

### Tabla `conciliacion_detalle`

| Columna | Tipo | Descripción |
|---------|------|-------------|
| `id` | INTEGER PK AUTOINCREMENT | |
| `conciliacion_id` | INTEGER NOT NULL | FK → conciliaciones.id |
| `folio` | TEXT | Folio de la boleta |
| `estado_match` | TEXT | "ok" / "diferencia" / "solo_propio" / "solo_externo" |
| `num_eco_propio` | TEXT | Núm. económico en sistema |
| `bruto_propio` | REAL | Peso bruto en sistema (kg) |
| `tara_propia` | REAL | Tara en sistema (kg) |
| `neto_propio` | REAL | Peso neto en sistema (kg) |
| `num_eco_externo` | TEXT | Núm. económico en archivo externo |
| `bruto_externo` | REAL | Peso bruto en archivo externo (kg) |
| `tara_externa` | REAL | Tara en archivo externo (kg) |
| `neto_externo` | REAL | Peso neto en archivo externo (kg) |
| `diff_num_eco` | INTEGER DEFAULT 0 | 1 si num_eco difiere |
| `diff_bruto_pct` | REAL | % diferencia en peso bruto (null si no aplica) |
| `diff_tara_pct` | REAL | % diferencia en tara |
| `diff_neto_pct` | REAL | % diferencia en peso neto |
| `señalamiento` | TEXT | Descripción textual de las diferencias |

**FK y cascade:**
`conciliacion_id` → `FOREIGN KEY (conciliacion_id) REFERENCES conciliaciones(id) ON DELETE CASCADE`

**Estado "incompleto":**
Si un valor de peso del archivo externo no es parseable (blank, texto, NaN), el campo externo se guarda como NULL y `estado_match` se marca `"incompleto"` con señalamiento "Valor externo no disponible para [campo]". No se genera señalamiento de diferencia en ese campo.

**Migraciones** (en `db/database.js`, patrón `CREATE TABLE IF NOT EXISTS` en el SCHEMA principal):
```js
db.run(`CREATE TABLE IF NOT EXISTS conciliaciones (...)`, ...)
db.run(`CREATE TABLE IF NOT EXISTS conciliacion_detalle (...)`, ...)
```

---

## API — `routes/conciliaciones.js`

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/conciliaciones` | Lista de conciliaciones (sin detalle). Acepta `?periodo=YYYY-MM` |
| GET | `/api/conciliaciones/:id` | Conciliación completa con array `detalle[]` |
| POST | `/api/conciliaciones` | Crear nueva conciliación. Body: `{ encabezado, detalle[] }` |
| DELETE | `/api/conciliaciones/:id` | Eliminar conciliación y su detalle (CASCADE) |

**Registrado en `server.js`:**
```js
app.use('/api/conciliaciones', requireAuth, require('./routes/conciliaciones'));
```

El parseo del archivo nunca llega al servidor; el frontend envía los datos ya procesados en JSON.

---

## Frontend — `public/index.html`

### Estructura del tab-bascula

```
tab-bascula
├── [existente] Formulario de captura
├── [existente] Tabla de boletas recientes
└── [NUEVO] Sección "Conciliación de Boletas"
    ├── Paso 1: Configurar (mes + drop zone)
    ├── Paso 2: [modal] Mapeo de columnas
    ├── Paso 3: Resultados (tarjetas + tabla filtrable)
    └── Historial de conciliaciones guardadas
```

### Navegación por el módulo

Se agrega un mini-nav de 2 pestañas dentro del tab-bascula:
- **Captura** (formulario existente + tabla)
- **Conciliación** (nueva sección)

### Paso 1 — Configurar

```
[Mes/Año selector]  [Drop zone: arrastra o selecciona .xlsx/.xls/.pdf]
[Botón: Iniciar conciliación]
```

### Paso 2 — Mapeo de columnas (modal `modal-col-map`)

Aparece solo si la detección automática no identifica todos los campos requeridos.

Detección automática busca variantes de:
- **folio**: "folio", "no boleta", "boleta", "ticket"
- **num_eco**: "economico", "eco", "unidad", "num eco", "no eco"
- **peso_bruto**: "bruto", "peso bruto", "pb"
- **tara**: "tara", "peso vacio", "vacio"
- **peso_neto**: "neto", "peso neto", "pn"

Si no detecta alguno → modal con `<select>` para cada campo, mostrando las columnas encontradas.

### Paso 3 — Resultados

**Tarjetas de resumen (4):**
- ✅ Coincidencias (verde)
- ⚠️ Diferencias (amarillo)
- 📋 Solo en mis registros (azul)
- 📋 Solo en el externo (rojo)

**Tabla comparativa con tabs/filtro:**

| Folio | No. Eco | Bruto Propio | Bruto Externo | Δ% | Tara P. | Tara E. | Δ% | Neto P. | Neto E. | Δ% | Señalamiento |
|---|---|---|---|---|---|---|---|---|---|---|---|

Columnas de diferencia se colorean:
- Verde: dentro de ±1%
- Rojo: fuera de tolerancia

**Botones de acción:**
- `Guardar conciliación` → POST `/api/conciliaciones`
- `Exportar Excel` → XLSX con 4 hojas (Coincidencias, Diferencias, Solo míos, Solo suyos)
- `Exportar PDF` → Reporte formal con encabezado DGSPM, fecha, periodo y tabla de señalamientos

### Historial

Tabla al pie de la sección:

| Periodo | Archivo | Fecha | Ok | Diff | Solo míos | Solo suyos | Estado | Acciones |
|---|---|---|---|---|---|---|---|---|

Botones por renglón: **Ver** (abre resultados guardados), **Eliminar**.

---

## Lógica de Conciliación (JS)

### Parseo XLSX
```js
// SheetJS (ya cargado)
const wb = XLSX.read(e.target.result, { type: 'binary' });
const ws = wb.Sheets[wb.SheetNames[0]];
const raw = XLSX.utils.sheet_to_json(ws, { defval: '' });
// → detección de columnas con norm() + findCol() (patrón existente)
```

### Parseo PDF
```js
// pdf.js desde CDN (carga lazy solo cuando se necesita)
// https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.min.js
// Extrae texto página por página, luego aplica regex para detectar
// líneas con patrón: [folio] [num_eco] [número] [número] [número]
// Si la extracción falla o produce < 5 filas → error con instrucción
// de convertir a XLSX
```

### Algoritmo de match
```
1. Cargar boletas propias del periodo via GET /boletas?fechaIni=YYYY-MM-01&fechaFin=YYYY-MM-31&limit=9999
   - NOTA: boletas con fecha_entrada NULL se excluyen de este filtro (limitación conocida,
     se menciona en UI como "boletas sin fecha de entrada no se incluyen en la conciliación")
   - Si total > 9999: mostrar advertencia visible y guardar conciliacion con campo
     datos_incompletos=1 en la tabla (columna adicional INTEGER DEFAULT 0)
2. Parsear archivo externo → array extRows[] con valores de peso ya validados:
   - parseFloat(v) → si NaN/null/blank → marcar como null (no 0)
3. Construir Map<folio_normalizado, row> de cada lado
   - normalización: String(folio).trim().toLowerCase()
   - si hay folios duplicados en mis propios registros: usar el más reciente (ORDER BY id DESC)
4. Iterar unión de todos los folios:
   - folio solo en mías → estado_match = "solo_propio"
   - folio solo en externas → estado_match = "solo_externo"
   - folio en ambas:
     - si algún peso externo es null → estado_match = "incompleto"
     - si no:
       - diffNumEco = (norm(mio.num_eco) !== norm(ext.num_eco))  // case-insensitive trim
       - diffBruto  = pctDiff(mio.peso_bruto, ext.peso_bruto) > 0.01
       - diffTara   = pctDiff(mio.tara, ext.tara) > 0.01
       - diffNeto   = pctDiff(mio.peso_neto, ext.peso_neto) > 0.01
       - si alguno → estado_match = "diferencia"
       - si ninguno → estado_match = "ok"
5. pctDiff(a, b):
   - si a === 0 && b === 0 → return 0  (ambos cero = sin diferencia)
   - si a === 0 || b === 0 → return 1  (uno cero, otro no = 100% diferencia, siempre señalamiento)
   - return Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b))
```

### Generación de señalamientos
```
"No. Económico difiere (propio: CT-2898 / externo: CT-2900)"
"Peso Bruto difiere en 1.5% (propio: 12340 kg / externo: 12525 kg)"
"Tara difiere en 2.1% (propio: 5200 kg / externo: 5090 kg)"
```

---

## Nuevas Funciones JS

| Función | Descripción |
|---------|-------------|
| `initConciliacion()` | Inicializa la sección, carga historial |
| `onArchivoConciliacion(input)` | FileReader → detecta tipo (xlsx/pdf) → llama al parser |
| `parsearXLSX(buffer)` | SheetJS → array de filas normalizadas |
| `parsearPDF(buffer)` | pdf.js → extrae texto → regex → array de filas |
| `detectarColumnas(firstRow)` | Auto-detección de encabezados; retorna mapa o null si falla |
| `mostrarModalMapeoColumnas(cols)` | Modal para mapeo manual de columnas |
| `ejecutarConciliacion()` | Lógica de match; genera array `_conciliResultado` |
| `renderResultadosConciliacion()` | Renderiza tarjetas + tabla filtrable |
| `guardarConciliacion()` | POST `/api/conciliaciones` con resultado |
| `exportarConciliacionExcel()` | XLSX con 4 hojas |
| `exportarConciliacionPDF()` | jsPDF con reporte formal |
| `cargarHistorialConciliaciones()` | GET `/api/conciliaciones` → tabla historial |
| `verConciliacion(id)` | GET `/api/conciliaciones/:id` → renderiza resultados |
| `eliminarConciliacion(id)` | DELETE con confirmación |

---

## Archivos a Modificar / Crear

| Archivo | Cambio |
|---------|--------|
| `db/database.js` | Agregar CREATE TABLE conciliaciones + conciliacion_detalle en SCHEMA; migraciones |
| `routes/conciliaciones.js` | **Nuevo archivo** — 4 endpoints CRUD |
| `server.js` | Registrar `/api/conciliaciones` con requireAuth |
| `public/index.html` | Mini-nav en tab-bascula, HTML de conciliación, modal mapeo, funciones JS, carga lazy de pdf.js |

---

## Notas Técnicas

- **pdf.js** se carga dinámicamente (lazy) solo cuando el usuario sube un PDF. URL: `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.min.js`. El implementador debe obtener el hash SRI en `https://www.srihash.org/` para esa URL exacta e incluirlo como atributo `integrity="sha384-..."` en el `<script>` dinámico antes de poner en producción. Si el CDN no está disponible (LAN sin internet), se muestra un aviso al usuario recomendando convertir el PDF a XLSX.
- **Tolerancia**: `pctDiff > 0.01` (1.0%) para los 3 campos de peso; num_eco comparación exacta (case-insensitive, trim)
- **Folios** en la comparación: normalización `String(folio).trim().toLowerCase()` en ambos lados
- **Límite de boletas propias**: se consultan todas las del periodo con `limit=9999`; si hay más se muestra advertencia
- **Estado "cerrada"**: campo para uso futuro (posibilidad de marcar conciliación como finalizada desde el historial)
- **Acceso**: mismo `requireAuth` middleware que el resto del sistema; visible para roles con acceso al módulo `bascula`
