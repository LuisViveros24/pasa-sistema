# Spec: PDF Viewer Modal + Coordenadas Manuales en Mapa

**Fecha:** 2026-05-07  
**Estado:** Aprobado por el usuario  
**Afecta:** `public/index.html` (única modificación de código)

---

## Contexto

Sistema PASA (Node.js + Express + SQLite3 + SPA monolítica en `public/index.html`).  
Los supervisores municipales generan PDFs desde el navegador y capturan incidencias con GPS.  
Dos fricciones detectadas:

1. Los PDFs se descargan automáticamente, impidiendo vista previa antes de decidir si se descarga.
2. El mapa solo acepta ubicación vía GPS del dispositivo; no hay forma de ingresar coordenadas manualmente (útil cuando se reporta una incidencia fuera del lugar).

---

## Feature 1 — PDF Viewer Modal

### Objetivo

Interceptar toda generación de PDF para mostrarla en un modal con `<iframe>` antes de descargar, permitiendo revisar, volver al formulario para editar y regenerar, o descargar directamente.

### Alcance

Aplica a los **7 puntos de generación de PDF** en `public/index.html`:

| Módulo | Función actual | Librería |
|--------|---------------|----------|
| Boletas | `generarPdfBoleta()` | jsPDF |
| Diario | `generarPdfDiario()` | jsPDF |
| Auditorías | `generarPdfAuditoria()` | jsPDF |
| Actas | `generarPdfActa()` | jsPDF |
| Reuniones | `generarPdfReunion()` | jsPDF |
| Reportes | `generarReporteGeneral()` | jsPDF / XLSX |
| Tolvas | `generarPdfTolva()` | jsPDF |

### Diseño

**Modal HTML** (añadir una sola vez al `<body>`):

```html
<div id="pdf-viewer-modal" class="modal-overlay" style="display:none; z-index:1000;">
  <div class="pdf-viewer-inner">
    <iframe id="pdf-viewer-iframe" src="" style="width:100%; height:80vh; border:none;"></iframe>
    <div class="pdf-viewer-actions">
      <button onclick="descargarPdfActual()">⬇ Descargar</button>
      <button onclick="cerrarPdfViewer()">✕ Cerrar</button>
    </div>
  </div>
</div>
```

**JS — función helper** (añadir una sola vez):

```js
let _pdfBlobUrl = null;

function abrirPdfViewer(blobUrl) {
  if (_pdfBlobUrl) URL.revokeObjectURL(_pdfBlobUrl);
  _pdfBlobUrl = blobUrl;
  document.getElementById('pdf-viewer-iframe').src = blobUrl;
  document.getElementById('pdf-viewer-modal').style.display = 'flex';
}

function descargarPdfActual() {
  if (!_pdfBlobUrl) return;
  const a = document.createElement('a');
  a.href = _pdfBlobUrl;
  a.download = 'reporte.pdf';
  a.click();
}

function cerrarPdfViewer() {
  document.getElementById('pdf-viewer-modal').style.display = 'none';
  document.getElementById('pdf-viewer-iframe').src = '';
  if (_pdfBlobUrl) { URL.revokeObjectURL(_pdfBlobUrl); _pdfBlobUrl = null; }
}
```

**Cambio en cada función de generación de PDF:**

- **jsPDF:** reemplazar `doc.save('nombre.pdf')` → `abrirPdfViewer(doc.output('bloburl'))`
- **html2pdf:** reemplazar `.save()` → `.output('blob').then(blob => abrirPdfViewer(URL.createObjectURL(blob)))`

**CSS modal:**

```css
#pdf-viewer-modal {
  position: fixed; inset: 0;
  background: rgba(0,0,0,0.8);
  display: flex; align-items: center; justify-content: center;
  z-index: 1000;
}
.pdf-viewer-inner {
  background: var(--card);
  border-radius: 8px;
  width: 90vw; max-width: 900px;
  padding: 1rem;
  display: flex; flex-direction: column; gap: 0.75rem;
}
.pdf-viewer-actions {
  display: flex; gap: 0.75rem; justify-content: flex-end;
}
```

### Comportamiento esperado

1. Usuario hace clic en "Generar PDF"  
2. El PDF se genera en memoria → `bloburl` → modal se abre con `<iframe>`  
3. Usuario puede ver el PDF completo  
4. Si quiere editar → hace clic en "Cerrar" → vuelve al formulario → edita datos → genera de nuevo  
5. Si quiere guardar → hace clic en "Descargar" → se descarga con nombre genérico  
6. Al cerrar, la blobURL se revoca para liberar memoria

### Restricciones

- No almacenar el PDF en servidor; todo en memoria del navegador
- El botón "Cerrar" NO guarda el registro; solo cierra el visor
- Compatible con Firefox, Chrome y Safari mobile

---

## Feature 2 — Coordenadas Manuales en Mapa

### Objetivo

Permitir al supervisor ingresar coordenadas lat,lng a mano en un campo de texto junto al mapa, de modo que el pin se posicione sin necesitar GPS activo.

### Alcance

Aplica a **2 mapas** en `public/index.html`:

| Mapa | Función GPS existente | Función set existente |
|------|----------------------|----------------------|
| Diario de Actividades | `obtenerUbicacion()` | `setUbicacion(lat, lng)` |
| Incidencias | `obtenerUbicacionInc()` | `setIncUbicacion(lat, lng)` |

### Diseño

**HTML — añadir debajo del botón GPS** en cada mapa:

```html
<div class="coords-manual" style="display:flex; gap:0.5rem; align-items:center; margin-top:0.4rem;">
  <input id="input-coords-inc" type="text" placeholder="lat, lng  ej: 25.5428, -103.4068"
         class="form-control" style="flex:1; font-size:0.85rem;">
  <button type="button" onclick="irACoordsInc()" class="btn btn-sm btn-secondary">Ir</button>
</div>
```

**JS — función de validación** (una por mapa, comparte lógica):

```js
function irACoordsInc() {
  const raw = document.getElementById('input-coords-inc').value.trim();
  const parts = raw.split(',').map(s => parseFloat(s.trim()));
  if (parts.length !== 2 || isNaN(parts[0]) || isNaN(parts[1])) {
    alert('Formato inválido. Ejemplo: 25.5428, -103.4068'); return;
  }
  const [lat, lng] = parts;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    alert('Coordenadas fuera de rango. Lat: -90 a 90, Lng: -180 a 180'); return;
  }
  setIncUbicacion(lat, lng);  // reutiliza función existente
}

function irACoordsDiario() {
  const raw = document.getElementById('input-coords-diario').value.trim();
  const parts = raw.split(',').map(s => parseFloat(s.trim()));
  if (parts.length !== 2 || isNaN(parts[0]) || isNaN(parts[1])) {
    alert('Formato inválido. Ejemplo: 25.5428, -103.4068'); return;
  }
  const [lat, lng] = parts;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    alert('Coordenadas fuera de rango. Lat: -90 a 90, Lng: -180 a 180'); return;
  }
  setUbicacion(lat, lng);  // reutiliza función existente
}
```

**Integración con `setIncUbicacion` / `setUbicacion` existentes:**

Las funciones actuales ya manejan:
- Centrar y hacer zoom al mapa (`setView`)
- Crear o mover el marcador (`L.marker` / `.setLatLng`)
- Llenar campos ocultos `lat`/`lng`
- Llamar a `invalidateSize()`

No requieren modificación; solo se llaman desde las nuevas funciones.

### Comportamiento esperado

1. Usuario abre el formulario con mapa
2. Ve el botón GPS + el nuevo campo de texto con placeholder
3. Escribe `25.5428, -103.4068` y pulsa "Ir"
4. Validación: formato correcto y rangos válidos
5. El pin se pone en esas coordenadas, el mapa hace zoom
6. Los campos ocultos `lat`/`lng` se llenan (listos para enviar el formulario)
7. Si el formato es incorrecto → `alert()` descriptivo

### Restricciones

- No modificar funciones existentes (`setUbicacion`, `setIncUbicacion`)
- No usar geocodificación de direcciones (fuera de alcance)
- El campo acepta solo el formato `número, número` (coma como separador)

---

## Archivos a Modificar

| Archivo | Cambios |
|---------|---------|
| `public/index.html` | Único archivo modificado: CSS modal PDF, HTML modal, JS viewer, HTML inputs coords, JS validators |

No hay cambios de backend, base de datos, ni rutas.

---

## Criterios de Éxito

- [ ] Todos los botones "Generar PDF" abren el modal en lugar de descargar
- [ ] El botón "Descargar" en el modal descarga el PDF
- [ ] El botón "Cerrar" libera la blobURL y regresa al formulario
- [ ] El campo de coordenadas acepta `lat, lng` y mueve el pin en ambos mapas
- [ ] Validación rechaza formatos incorrectos y rangos inválidos con mensaje claro
- [ ] No hay regresiones en funcionalidad existente
