# Diseño: Integración Tolvas en Diario y Rol de Supervisión

**Fecha:** 2026-03-23
**Proyecto:** DGSPM — Sistema Integral de Supervisión PASA
**Módulos afectados:** Diario de Actividades, Supervisión

---

## Resumen

Dos mejoras conectadas:

1. **Diario de Actividades**: cuando el tipo de servicio es "Tolvas y Contenedores", mostrar un dropdown de punto de servicio que alimenta un nuevo campo `punto_tolva` en el registro guardado.
2. **Supervisión**: nueva sub-pestaña "Rol de Tolvas y Contenedores" que muestra los puntos programados para el día de hoy, permite agregar puntos por llamada, y al registrar cualquier punto crea automáticamente un registro en Diario y sube el PDF a Drive.

---

## Cambio 1: Diario de Actividades — Dropdown de Punto de Servicio

### Base de datos

Migración en `db/database.js` (patrón existente de ALTER TABLE):

```sql
ALTER TABLE diario ADD COLUMN punto_tolva TEXT;
```

### Backend (`routes/diario.js`)

**`GET /api/diario`** — agregar `punto_tolva` a la lista explícita del SELECT:
```sql
SELECT id,folio,fecha,hora,responsable,servicio,unidad,gps,colonia,calle,numero,
       actividades,observaciones,foto1,foto2,auditado,punto_tolva,created_at
FROM diario …
```

**`POST /api/diario`** — agregar `punto_tolva` al INSERT:
```js
// SQL:
INSERT INTO diario (folio,fecha,hora,responsable,servicio,unidad,gps,colonia,calle,numero,
                    actividades,observaciones,foto1,foto2,punto_tolva)
VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
// params array — agregar b.punto_tolva||null al final, antes de foto1/foto2:
[ b.folio, b.fecha||null, ..., foto1, foto2, b.punto_tolva||null ]
```

**`PUT /api/diario/:id`** — agregar `punto_tolva=?` en el SET con cuidado del orden posicional:
```js
// SQL:
UPDATE diario SET fecha=?,hora=?,responsable=?,servicio=?,unidad=?,
  gps=?,colonia=?,calle=?,numero=?,actividades=?,observaciones=?,punto_tolva=?
WHERE id=?
// params array — punto_tolva va ANTES de req.params.id:
[ b.fecha||null, ..., b.observaciones||null, b.punto_tolva||null, req.params.id ]
```

No se requiere nuevo endpoint.

### Frontend (`public/index.html`)

**HTML — nuevo campo:**
Agregar debajo del `<select id="d-servicio">` un bloque oculto:
```html
<div id="d-box-punto-tolva" style="display:none; margin-bottom:12px;">
  <label>Punto de Servicio *</label>
  <select id="d-punto-tolva">
    <option value="" disabled selected>Seleccione punto…</option>
  </select>
</div>
```

**JS — función `cargarActDiario()`:**
Al final de la función existente, agregar:
- Si `serv === 'Tolvas y Contenedores'`:
  - `GET /api/tolvas?estado=activo&limit=200`
  - Popular `#d-punto-tolva` con `${r.folio} — ${r.punto_servicio}`, valor = `r.punto_servicio`
  - Mostrar `#d-box-punto-tolva`
- Caso contrario: ocultar y resetear `#d-box-punto-tolva`

**JS — función `guardarDiario(e)`:**
Agregar al FormData:
```js
fd.append('punto_tolva', document.getElementById('d-punto-tolva').value || '');
```

**JS — función `buildDiarioPDF(d, img1, img2)`:**
Agregar línea para llenar el nuevo campo del template:
```js
document.getElementById('pdf-punto-tolva').textContent = d.punto_tolva || '—';
```

**HTML — template `hojaPDF`:**
Agregar fila entre "Calle" y "ACTIVIDADES Y OBSERVACIONES":
```html
<div class="pmi pspan2" id="pdf-row-punto-tolva">
  <div class="pmi-l">Punto de Servicio</div>
  <div class="pmi-v" id="pdf-punto-tolva"></div>
</div>
```

---

## Cambio 2: Supervisión — Sub-pestaña "Rol de Tolvas y Contenedores"

### Sub-tab button

Agregar en la fila de sub-tabs del módulo `#tab-auditoria`:
```html
<button class="btn btn-outline" id="itab-rol-tolvas"
  onclick="setAudTab('rol-tolvas')"
  style="flex:1;min-width:140px;">
  🗑️ Rol de Tolvas
</button>
```

### Panel HTML

Agregar justo antes del cierre de `#tab-auditoria`:
```html
<div id="aud-panel-rol-tolvas" style="display:none;">
  <!-- Encabezado -->
  <div class="sec-h" style="margin-bottom:12px;">
    <h3 id="rol-tolvas-fecha-hdr"></h3>
    <p id="rol-tolvas-contador"></p>
  </div>

  <!-- Programados hoy -->
  <div class="section-box" style="margin-bottom:16px;">
    <div class="section-box-title">📅 Programados hoy</div>
    <div id="rol-tolvas-tabla-prog"></div>
  </div>

  <!-- Por llamada -->
  <div class="section-box">
    <div class="section-box-title" style="display:flex;justify-content:space-between;align-items:center;">
      <span>📞 Agregados por llamada</span>
      <button class="btn btn-sm btn-outline" onclick="abrirSelectorLlamada()">
        + Agregar por llamada
      </button>
    </div>
    <div id="rol-tolvas-tabla-llamada">
      <div class="empty" style="padding:12px;">
        <p style="font-size:12px;color:var(--muted);">Ninguno agregado aún</p>
      </div>
    </div>
  </div>
</div>
```

### Extensión de `setAudTab(tab)`

Agregar el nuevo caso al comienzo de la función para manejar el botón `itab-rol-tolvas` en el reset de estilos, y el bloque:

```js
if (tab === 'rol-tolvas') {
  // ocultar paneles normales de captura
  panelCaptura.style.display = 'none';
  tblCaptura.style.display   = 'none';
  folioBar.style.display     = 'none';
  panelVerif.style.display   = 'none';
  // mostrar panel rol
  document.getElementById('aud-panel-rol-tolvas').style.display = '';
  // activar botón
  const btnRol = document.getElementById('itab-rol-tolvas');
  btnRol.style.cssText = 'flex:1;min-width:140px;background:var(--accent);color:#000;font-weight:700;border:2px solid var(--accent);';
  btnRol.classList.remove('btn-outline');
  renderRolTolvas();
} else {
  document.getElementById('aud-panel-rol-tolvas').style.display = 'none';
}
```

También incluir `'itab-rol-tolvas'` en el array del reset inicial de botones, y añadir reset explícito del `btnVerif` (`itab-verificacion`) para que no quede visualmente activo cuando el usuario viene desde la pestaña "Verificación". El bloque `else` de la rama `rol-tolvas` también debe llamar al reset de `itab-verificacion` que ya existe para los otros casos.

### Función `esHoyTolva(frecuencia)`

```js
function esHoyTolva(frecuencia) {
  const diasES = ['DOMINGO','LUNES','MARTES','MIERCOLES','JUEVES','VIERNES','SABADO'];
  const hoy = diasES[new Date().getDay()]; // ej. 'LUNES'
  const f = frecuencia.toUpperCase()
    .replace(/\bY\b/g, ',')      // "MARTES Y VIERNES" → "MARTES , VIERNES"
    .replace(/MIÉRCOLES/g,'MIERCOLES')
    .replace(/SÁBADO/g,'SABADO');

  if (f === 'DIARIO') return true;
  if (f === 'LUNES A VIERNES') return ['LUNES','MARTES','MIERCOLES','JUEVES','VIERNES'].includes(hoy);
  // split por coma, limpiar espacios, comparar
  return f.split(',').map(s => s.trim()).includes(hoy);
}
```

Frecuencias `LLAMADA` y `POR LLAMADA` devuelven `false` (se omiten del rol automático).

### Función `renderRolTolvas()`

```js
async function renderRolTolvas() {
  // 1. Cargar todos los tolvas activos
  const { data: tolvas } = await api('GET', '/tolvas?estado=activo&limit=200');

  // 2. Filtrar programados para hoy
  const programados = tolvas.filter(t => esHoyTolva(t.frecuencia));

  // 3. Cargar registros de diario de hoy para marcar completados
  const hoy = new Date().toISOString().slice(0, 10);
  const { data: diarioHoy } = await api('GET',
    `/diario?fechaIni=${hoy}&fechaFin=${hoy}&limit=200`);
  const registrados = new Set(
    diarioHoy
      .filter(r => r.servicio === 'Tolvas y Contenedores' && r.punto_tolva)
      .map(r => r.punto_tolva)
  );

  // 4. Actualizar encabezado
  document.getElementById('rol-tolvas-fecha-hdr').textContent =
    `Rol del día — ${new Date().toLocaleDateString('es-MX', { weekday:'long', year:'numeric', month:'long', day:'numeric' })}`;
  document.getElementById('rol-tolvas-contador').textContent =
    `${programados.length} puntos programados · ${registrados.size} registrados`;

  // 5. Renderizar tabla de programados
  renderTablaRol('rol-tolvas-tabla-prog', programados, registrados);
}
```

### Función `renderTablaRol(containerId, filas, registrados)`

Genera una tabla con columnas: Folio | Tipo | Punto de Servicio | Ubicación | Estado | Acción.

- Si `registrados.has(r.punto_servicio)`: estado = `<span class="badge b-green">✓ Registrado</span>`, sin botón.
- Si no: estado = `<span class="badge b-gray">Pendiente</span>`, botón `Registrar` → `abrirModalRegistroTolva(r)`.

### Función `abrirSelectorLlamada()`

- Filtrar client-side desde `_tolvasCache` (ya cargado en `renderRolTolvas`): `.filter(t => ['LLAMADA','POR LLAMADA'].includes(t.frecuencia.toUpperCase()))`. **No** usar el parámetro `?frecuencia=` del backend porque solo soporta igualdad exacta y perdería los registros con `"POR LLAMADA"`.
- Muestra un pequeño modal/prompt con un `<select>` de esos puntos.
- Al confirmar, verificar primero que el punto no esté ya en `_rolLlamadasHoy` (comparar `punto_servicio`) para evitar duplicados en la misma sesión. Si ya existe, mostrar un `flash('Este punto ya fue agregado')` y cancelar. Si no existe, agregar al array y re-renderizar `rol-tolvas-tabla-llamada` usando `renderTablaRol`.

### Modal de captura `modal-registro-tolva`

Nuevo modal (HTML) con:
- `<select id="rtv-responsable">` — mismas opciones que `#d-responsable`
- `<input type="time" id="rtv-hora">` — auto-fill `new Date().toTimeString().slice(0,5)`
- `<textarea id="rtv-obs">` — observaciones opcionales
- Dos `foto-drop` con inputs de archivo: `rtv-foto1`, `rtv-foto2`
- Botón "Guardar y subir a Drive"

### Función `guardarRegistroTolva(tolvaRow)`

```js
async function guardarRegistroTolva(tolvaRow) {
  showLoader('Guardando registro…');
  const hoy = new Date().toISOString().slice(0, 10);
  const { folio } = await api('GET', '/diario/siguiente-folio?servicio=Tolvas%20y%20Contenedores');

  const fd = new FormData();
  fd.append('folio',         folio);
  fd.append('fecha',         hoy);
  fd.append('hora',          document.getElementById('rtv-hora').value);
  fd.append('responsable',   document.getElementById('rtv-responsable').value);
  fd.append('servicio',      'Tolvas y Contenedores');
  fd.append('punto_tolva',   tolvaRow.punto_servicio);
  fd.append('unidad',        'N/A');
  fd.append('colonia',       tolvaRow.ubicacion || tolvaRow.punto_servicio);
  fd.append('calle',         '');
  fd.append('numero',        'S/N');
  fd.append('actividades',   'Recolección');
  fd.append('observaciones', document.getElementById('rtv-obs').value);

  const f1 = document.getElementById('rtv-foto1').files?.[0];
  const f2 = document.getElementById('rtv-foto2').files?.[0];
  if (f1) fd.append('foto1', f1);
  if (f2) fd.append('foto2', f2);

  const created = await api('POST', '/diario', fd, true);
  cerrarModal('modal-registro-tolva');
  flash(`Registro ${created.folio} guardado ✔`);

  // Generar PDF y subir a Drive (mismo flujo que guardarDiario)
  const img1 = created.foto1 ? `/uploads/${created.foto1}` : '';
  const img2 = created.foto2 ? `/uploads/${created.foto2}` : '';
  await buildDiarioPDF({
    folio: created.folio, fecha: created.fecha, hora: created.hora,
    responsable: created.responsable, servicio: created.servicio,
    punto_tolva: created.punto_tolva,
    unidad: created.unidad, gps: '', colonia: created.colonia,
    calle: created.calle, numero: created.numero,
    actividades: created.actividades, obs: created.observaciones
  }, img1, img2);

  // Refrescar el panel — await para que hideLoader no se dispare antes del re-render
  await renderRolTolvas();
  hideLoader();
}
```

---

## Variables de sesión nuevas

```js
let _rolLlamadasHoy = []; // puntos por llamada agregados en la sesión actual
```

---

## Archivos a modificar

| Archivo | Cambios |
|---|---|
| `db/database.js` | Migración `ALTER TABLE diario ADD COLUMN punto_tolva TEXT` |
| `routes/diario.js` | POST y PUT aceptan `punto_tolva` |
| `public/index.html` | HTML: campo en form diario, fila en PDF template, panel Rol, modal captura. JS: `cargarActDiario`, `guardarDiario`, `buildDiarioPDF`, `setAudTab`, nuevas funciones |

---

## Lo que NO cambia

- La lógica de Drive y PDF (`buildDiarioPDF`, `subirPDFaDrive`) se reutiliza sin modificar.
- El schema de la tabla `tolvas` no se modifica.
- Los endpoints de `/api/tolvas` se reutilizan sin cambios.
