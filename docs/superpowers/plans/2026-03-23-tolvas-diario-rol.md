# Tolvas: Dropdown en Diario + Pestaña Rol en Supervisión — Plan de Implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrar el catálogo de Tolvas y Contenedores en el Diario de Actividades (dropdown de punto de servicio) y añadir una sub-pestaña "Rol de Tolvas" en Supervisión que muestre puntos programados para hoy, permita agregar puntos por llamada y genere registros en Diario + PDF a Drive al confirmar cada uno.

**Architecture:** La columna `punto_tolva` en la tabla `diario` es el único origen de verdad. El Rol tab consulta los registros de hoy para determinar qué puntos ya están cubiertos. La función `buildDiarioPDF` existente se reutiliza sin modificar — solo recibe el campo nuevo.

**Tech Stack:** Node.js/Express, SQLite3 (sqlite3 npm), HTML/CSS/JS vanilla, html2pdf.js, Google Drive API (OAuth2 client-side).

---

## Mapa de archivos

| Archivo | Qué cambia |
|---|---|
| `db/database.js` | Migración: `ALTER TABLE diario ADD COLUMN punto_tolva TEXT` |
| `routes/diario.js` | GET SELECT, POST INSERT, PUT UPDATE — agregan `punto_tolva` |
| `public/index.html` | HTML form Diario (nuevo select), HTML hojaPDF (nueva fila), HTML tab-auditoria (sub-tab btn + panel + 2 modales), JS (6 funciones modificadas/nuevas) |

---

## Task 1: Migración BD y backend `routes/diario.js`

**Files:**
- Modify: `db/database.js` (zona de migraciones ~línea 279)
- Modify: `routes/diario.js:23-32` (GET), `routes/diario.js:66-80` (POST), `routes/diario.js:93-108` (PUT)

- [ ] **Step 1: Agregar migración en `db/database.js`**

  Dentro del bloque `db.serialize(() => { … })`, después de la última migración existente (busca `ALTER TABLE auditorias ADD COLUMN num_eco`), agregar:

  ```js
  // Migración: punto_tolva en diario
  db.run(`ALTER TABLE diario ADD COLUMN punto_tolva TEXT`, err => {
    if (err && !err.message.includes('duplicate column')) console.error('Migración diario (punto_tolva):', err.message);
  });
  ```

- [ ] **Step 2: Actualizar el SELECT en `GET /api/diario` (`routes/diario.js:23-28`)**

  Reemplazar la línea del SELECT (actualmente línea 23-28):

  ```js
  // ANTES:
  const rows = await db.all_p(
    `SELECT id,folio,fecha,hora,responsable,servicio,unidad,gps,colonia,calle,numero,
            actividades,observaciones,foto1,foto2,auditado,created_at
     FROM diario ${where} ORDER BY fecha DESC, id DESC LIMIT ? OFFSET ?`,
  ```

  ```js
  // DESPUÉS:
  const rows = await db.all_p(
    `SELECT id,folio,fecha,hora,responsable,servicio,unidad,gps,colonia,calle,numero,
            actividades,observaciones,foto1,foto2,auditado,punto_tolva,created_at
     FROM diario ${where} ORDER BY fecha DESC, id DESC LIMIT ? OFFSET ?`,
  ```

- [ ] **Step 3: Actualizar el INSERT en `POST /api/diario` (`routes/diario.js:71-77`)**

  Reemplazar el INSERT completo:

  ```js
  // ANTES:
  const result = await db.run_p(
    `INSERT INTO diario (folio,fecha,hora,responsable,servicio,unidad,gps,colonia,calle,numero,actividades,observaciones,foto1,foto2)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [ b.folio, b.fecha||null, b.hora||null, b.responsable||null, b.servicio||null,
      b.unidad||null, b.gps||null, b.colonia||null, b.calle||null, b.numero||null,
      b.actividades||null, b.observaciones||null, foto1, foto2 ]
  );
  ```

  ```js
  // DESPUÉS:
  const result = await db.run_p(
    `INSERT INTO diario (folio,fecha,hora,responsable,servicio,unidad,gps,colonia,calle,numero,actividades,observaciones,foto1,foto2,punto_tolva)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [ b.folio, b.fecha||null, b.hora||null, b.responsable||null, b.servicio||null,
      b.unidad||null, b.gps||null, b.colonia||null, b.calle||null, b.numero||null,
      b.actividades||null, b.observaciones||null, foto1, foto2, b.punto_tolva||null ]
  );
  ```

- [ ] **Step 4: Actualizar el UPDATE en `PUT /api/diario/:id` (`routes/diario.js:96-103`)**

  Reemplazar el UPDATE completo (atención al orden posicional — `punto_tolva` va antes de `req.params.id`):

  ```js
  // ANTES:
  const r = await db.run_p(
    `UPDATE diario SET fecha=?,hora=?,responsable=?,servicio=?,unidad=?,
       gps=?,colonia=?,calle=?,numero=?,actividades=?,observaciones=?
     WHERE id=?`,
    [ b.fecha||null, b.hora||null, b.responsable||null, b.servicio||null,
      b.unidad||null, b.gps||null, b.colonia||null, b.calle||null, b.numero||null,
      b.actividades||null, b.observaciones||null, req.params.id ]
  );
  ```

  ```js
  // DESPUÉS:
  const r = await db.run_p(
    `UPDATE diario SET fecha=?,hora=?,responsable=?,servicio=?,unidad=?,
       gps=?,colonia=?,calle=?,numero=?,actividades=?,observaciones=?,punto_tolva=?
     WHERE id=?`,
    [ b.fecha||null, b.hora||null, b.responsable||null, b.servicio||null,
      b.unidad||null, b.gps||null, b.colonia||null, b.calle||null, b.numero||null,
      b.actividades||null, b.observaciones||null, b.punto_tolva||null, req.params.id ]
  );
  ```

- [ ] **Step 5: Reiniciar el servidor y verificar con curl**

  ```bash
  # Desde el directorio del proyecto:
  # (Si el servidor ya corre, detenerlo con Ctrl+C y volver a iniciarlo)
  node server.js &

  # Verificar que POST acepta punto_tolva y GET lo devuelve:
  curl -s -X POST http://localhost:3000/api/diario \
    -F "folio=TEST/TOL/9999" \
    -F "fecha=2026-03-23" \
    -F "hora=10:00" \
    -F "responsable=Test" \
    -F "servicio=Tolvas y Contenedores" \
    -F "punto_tolva=RASTRO MUNICIPAL" \
    -F "colonia=TestColonia" \
    -F "calle=TestCalle" \
    -F "actividades=Prueba" | python3 -m json.tool
  ```

  Resultado esperado: JSON con `"punto_tolva": "RASTRO MUNICIPAL"` en el objeto devuelto.

  ```bash
  # Verificar que GET devuelve punto_tolva:
  curl -s "http://localhost:3000/api/diario?limit=1" | python3 -m json.tool
  ```

  Resultado esperado: El primer registro incluye el campo `punto_tolva`.

  ```bash
  # Limpiar el registro de prueba (usa el id devuelto en el POST):
  curl -s -X DELETE http://localhost:3000/api/diario/<ID_DEL_POST>
  ```

- [ ] **Step 6: Commit**

  ```bash
  git add db/database.js routes/diario.js
  git commit -m "feat: add punto_tolva column to diario (migration + route update)"
  ```

---

## Task 2: Diario form — HTML del dropdown + lógica JS

**Files:**
- Modify: `public/index.html:814` (HTML — después del `</select>` de `#d-servicio`)
- Modify: `public/index.html:4111-4125` (JS — `cargarActDiario`)
- Modify: `public/index.html:4155-4156` (JS — `guardarDiario`)

- [ ] **Step 1: Agregar el HTML del dropdown en el formulario Diario**

  Localizar la línea 814 de `public/index.html`. Después del `</select>` de `#d-servicio` (línea 814) e inmediatamente antes de `<div id="d-box-unidad"` (línea 816), insertar:

  ```html
      <div id="d-box-punto-tolva" style="display:none;margin-bottom:12px;">
        <label style="font-family:var(--font-mono);font-size:10px;color:var(--yellow);">Punto de Servicio *</label>
        <select id="d-punto-tolva" required>
          <option value="" disabled selected>Seleccione punto…</option>
        </select>
      </div>
  ```

- [ ] **Step 2: Agregar la lógica de carga del dropdown en `cargarActDiario` (línea 4111)**

  La función actualmente termina en la línea 4124 con `}`. Insertar justo antes del cierre `}` de la función (antes de la línea 4125):

  ```js
    // Dropdown de punto de servicio para Tolvas y Contenedores
    const boxPunto = document.getElementById('d-box-punto-tolva');
    const selPunto = document.getElementById('d-punto-tolva');
    if (serv === 'Tolvas y Contenedores') {
      try {
        const { data: tolvas } = await api('GET', '/tolvas?estado=activo&limit=200');
        selPunto.innerHTML = '<option value="" disabled selected>Seleccione punto…</option>';
        tolvas.forEach(t => {
          const opt = document.createElement('option');
          opt.value = t.punto_servicio;
          opt.textContent = `${t.folio} — ${t.punto_servicio}`;
          selPunto.appendChild(opt);
        });
        boxPunto.style.display = '';
      } catch(_) {}
    } else {
      boxPunto.style.display = 'none';
      selPunto.value = '';
    }
  ```

- [ ] **Step 3: Agregar `punto_tolva` al FormData en `guardarDiario` (línea 4156)**

  Localizar la línea 4156 en `guardarDiario`:
  ```js
    fd.append('observaciones', document.getElementById('d-obs').value);
  ```
  Agregar inmediatamente después:
  ```js
    fd.append('punto_tolva', document.getElementById('d-punto-tolva')?.value || '');
  ```

- [ ] **Step 4: Verificar en el navegador**

  1. Abrir `http://localhost:3000` y navegar a **Diario de Actividades**.
  2. En "Tipo de Servicio" seleccionar **Tolvas y Contenedores**.
  3. Verificar que aparece el nuevo campo "Punto de Servicio" con la lista desplegable (147 opciones).
  4. Seleccionar otro servicio (ej. Carga Trasera) — verificar que el dropdown desaparece.
  5. Volver a Tolvas, seleccionar un punto y guardar un registro completo — verificar que se crea y aparece en la tabla.

- [ ] **Step 5: Commit**

  ```bash
  git add public/index.html
  git commit -m "feat: add punto_tolva dropdown in Diario form for Tolvas y Contenedores"
  ```

---

## Task 3: Campo "Punto de Servicio" en el PDF

**Files:**
- Modify: `public/index.html:1978` (HTML — template `hojaPDF`)
- Modify: `public/index.html:4244` (JS — `buildDiarioPDF`)

- [ ] **Step 1: Agregar la fila en el template PDF**

  Localizar la línea 1978 en `hojaPDF`:
  ```html
        <div class="pmi pspan2"><div class="pmi-l">Calle</div><div class="pmi-v" id="pdf-calle"></div></div>
  ```
  Agregar inmediatamente después (antes de la línea con `ACTIVIDADES Y OBSERVACIONES`):
  ```html
        <div class="pmi pspan2" id="pdf-row-punto-tolva"><div class="pmi-l">Punto de Servicio</div><div class="pmi-v" id="pdf-punto-tolva"></div></div>
  ```

- [ ] **Step 2: Llenar el campo en `buildDiarioPDF` (línea ~4253)**

  Dentro de `buildDiarioPDF`, localizar la línea que asigna `pdf-calle`:
  ```js
    document.getElementById('pdf-calle').textContent=`${d.calle||'—'} #${d.numero||'S/N'}`;
  ```
  Agregar justo después:
  ```js
    document.getElementById('pdf-punto-tolva').textContent = d.punto_tolva || '—';
  ```

- [ ] **Step 3: Verificar en el navegador**

  1. En Diario de Actividades, crear un registro con servicio Tolvas y Contenedores, seleccionando un punto.
  2. Hacer clic en el botón **PDF** de ese registro en la tabla.
  3. Verificar que el PDF generado incluye la fila "Punto de Servicio" con el valor correcto.
  4. Crear un registro de otro servicio (ej. Barrido Manual) y generar su PDF — verificar que "Punto de Servicio" muestra "—".

- [ ] **Step 4: Commit**

  ```bash
  git add public/index.html
  git commit -m "feat: show punto_tolva in Diario PDF"
  ```

---

## Task 4: HTML — Sub-tab, panel Rol y modales en Supervisión

**Files:**
- Modify: `public/index.html:891` (HTML — fila de sub-tabs de Supervisión)
- Modify: `public/index.html:1040` (HTML — justo antes del cierre de `#tab-auditoria`)
- Modify: `public/index.html:1811` (HTML — después del último modal existente)

- [ ] **Step 1: Agregar el botón de sub-tab "Rol de Tolvas"**

  Localizar la línea 891 en `#tab-auditoria`:
  ```html
      <button class="btn btn-outline" id="itab-verificacion" onclick="setAudTab('verificacion')" style="flex:1;min-width:140px;"><i class="fas fa-clipboard-check"></i> Verificación pendiente</button>
  ```
  Agregar inmediatamente después (como último botón de la fila):
  ```html
      <button class="btn btn-outline" id="itab-rol-tolvas" onclick="setAudTab('rol-tolvas')" style="flex:1;min-width:140px;"><i class="fas fa-trash-alt"></i> Rol de Tolvas</button>
  ```

- [ ] **Step 2: Agregar el panel `#aud-panel-rol-tolvas`**

  Localizar la línea 1040 (cierre de `#aud-panel-verificacion`):
  ```html
    </div>
  </div>
  ```
  El segundo `</div>` de esas dos líneas es el cierre de `#tab-auditoria` (línea 1041). Insertar antes de ese cierre:

  ```html
    <!-- Rol de Tolvas y Contenedores -->
    <div id="aud-panel-rol-tolvas" style="display:none;">
      <div class="sec-h" style="margin-bottom:12px;">
        <h3 id="rol-tolvas-fecha-hdr" style="margin:0 0 4px;font-size:15px;"></h3>
        <p id="rol-tolvas-contador" style="margin:0;font-size:12px;color:var(--muted);"></p>
      </div>
      <div class="section-box" style="margin-bottom:16px;">
        <div class="section-box-title">📅 Programados hoy</div>
        <div id="rol-tolvas-tabla-prog"></div>
      </div>
      <div class="section-box">
        <div class="section-box-title" style="display:flex;justify-content:space-between;align-items:center;">
          <span>📞 Agregados por llamada</span>
          <button class="btn btn-sm btn-outline" onclick="abrirSelectorLlamada()">+ Agregar por llamada</button>
        </div>
        <div id="rol-tolvas-tabla-llamada">
          <div class="empty" style="padding:12px;"><p style="font-size:12px;color:var(--muted);">Ninguno agregado aún</p></div>
        </div>
      </div>
    </div>
  ```

- [ ] **Step 3: Agregar el modal selector de llamada `modal-selector-llamada`**

  Localizar la línea 1811 (último modal existente: `id="modal-reunion-det"`). Después del bloque de ese modal (busca el `</div>` que lo cierra), agregar:

  ```html
  <!-- Modal: selector de tolva por llamada -->
  <div class="modal-overlay" id="modal-selector-llamada">
    <div class="modal" style="max-width:420px;">
      <div class="modal-hdr">
        <h3>Agregar punto por llamada</h3>
        <button class="m-close" onclick="cerrarModal('modal-selector-llamada')">✕</button>
      </div>
      <div style="padding:18px;">
        <div class="form-group" style="margin-bottom:16px;">
          <label>Punto de Servicio</label>
          <select id="sel-llamada-punto" style="width:100%;">
            <option value="" disabled selected>Seleccione…</option>
          </select>
        </div>
        <div style="display:flex;gap:8px;">
          <button class="btn btn-accent" style="flex:1;" onclick="confirmarSelectorLlamada()">Agregar</button>
          <button class="btn btn-outline" onclick="cerrarModal('modal-selector-llamada')">Cancelar</button>
        </div>
      </div>
    </div>
  </div>
  ```

- [ ] **Step 4: Agregar el modal de captura `modal-registro-tolva`**

  Justo después del modal anterior, agregar:

  ```html
  <!-- Modal: registro de actividad de tolva -->
  <div class="modal-overlay" id="modal-registro-tolva">
    <div class="modal" style="max-width:500px;">
      <div class="modal-hdr">
        <h3>Registrar actividad</h3>
        <button class="m-close" onclick="cerrarModal('modal-registro-tolva')">✕</button>
      </div>
      <div style="padding:18px;">
        <div style="background:var(--surface2);border-radius:var(--radius);padding:10px 14px;margin-bottom:16px;font-size:13px;">
          <span style="font-family:var(--font-mono);font-size:10px;color:var(--yellow);display:block;margin-bottom:3px;">PUNTO DE SERVICIO</span>
          <span id="rtv-punto-label" style="font-weight:700;"></span>
        </div>
        <div class="form-grid" style="margin-bottom:12px;">
          <div class="form-group">
            <label>Responsable *</label>
            <select id="rtv-responsable">
              <option>Carlos González</option>
              <option>Manuel García</option>
              <option>Homero Elizalde</option>
            </select>
          </div>
          <div class="form-group">
            <label>Hora *</label>
            <input type="time" id="rtv-hora">
          </div>
        </div>
        <div class="form-group" style="margin-bottom:12px;">
          <label>Observaciones</label>
          <textarea id="rtv-obs" rows="2" placeholder="Notas opcionales…"></textarea>
        </div>
        <div class="foto-grid" style="margin-bottom:16px;">
          <div class="foto-drop" onclick="document.getElementById('rtv-foto1').click()">
            <input type="file" id="rtv-foto1" accept="image/*" style="display:none" onchange="prevFoto(this,'rtv-prev1','rtv-ph1')">
            <div class="foto-ph" id="rtv-ph1"><i class="fas fa-camera" style="color:var(--accent);"></i><span>ANTES</span></div>
            <img id="rtv-prev1" class="f-prev" style="display:none">
            <div class="foto-badge" style="background:rgba(217,119,6,.8);">Antes</div>
          </div>
          <div class="foto-drop" onclick="document.getElementById('rtv-foto2').click()">
            <input type="file" id="rtv-foto2" accept="image/*" style="display:none" onchange="prevFoto(this,'rtv-prev2','rtv-ph2')">
            <div class="foto-ph" id="rtv-ph2"><i class="fas fa-check-circle" style="color:var(--green);"></i><span>DESPUÉS</span></div>
            <img id="rtv-prev2" class="f-prev" style="display:none">
            <div class="foto-badge" style="background:rgba(63,185,80,.8);">Después</div>
          </div>
        </div>
        <button class="btn btn-accent" style="width:100%;" onclick="guardarRegistroTolva()">
          <i class="fas fa-paper-plane"></i> Guardar y subir a Drive
        </button>
      </div>
    </div>
  </div>
  ```

- [ ] **Step 5: Verificar en el navegador (solo estructura)**

  1. Navegar a **Supervisión** — verificar que aparece el botón "🗑️ Rol de Tolvas" en la fila de sub-tabs.
  2. Hacer clic en él — verificar que el panel `#aud-panel-rol-tolvas` aparece (aunque vacío, sin errores en consola del navegador).
  3. Hacer clic en "+ Agregar por llamada" — verificar que se abre `modal-selector-llamada` (con select vacío por ahora).
  4. No se puede probar el modal de registro todavía (falta el JS).

- [ ] **Step 6: Commit**

  ```bash
  git add public/index.html
  git commit -m "feat: add Rol de Tolvas HTML structure in Supervisión (panel + modales)"
  ```

---

## Task 5: JS — `setAudTab`, `esHoyTolva`, `renderRolTolvas`, `renderTablaRol`

**Files:**
- Modify: `public/index.html:5837-5876` (JS — `setAudTab`)
- Add new JS functions near el bloque de funciones de Supervisión (~línea 5876, después de `setAudTab`)

- [ ] **Step 1: Actualizar `setAudTab` (línea 5837)**

  La función actualmente termina en la línea 5876. Realizar los siguientes cambios:

  **a)** En el array del reset de botones (línea 5847), agregar `'itab-rol-tolvas'`:
  ```js
  // ANTES:
  ['itab-diario','itab-reporte','itab-independiente'].forEach(id => {
  // DESPUÉS:
  ['itab-diario','itab-reporte','itab-independiente','itab-rol-tolvas'].forEach(id => {
  ```

  **b)** En el bloque que resetea `btnVerif` (líneas 5854-5858), asegurarse de que también resetea cuando se viene de `rol-tolvas`. Este bloque ya existe y resetea `btnVerif` incondicionalmente — no requiere cambio.

  **c)** Agregar el nuevo caso `rol-tolvas` ANTES del `if (tab === 'verificacion')` existente (línea 5860):
  ```js
  if (tab === 'rol-tolvas') {
    if (panelCaptura) panelCaptura.style.display = 'none';
    if (tblCaptura)   tblCaptura.style.display   = 'none';
    if (folioBar)     folioBar.style.display      = 'none';
    if (panelVerif)   panelVerif.style.display    = 'none';
    document.getElementById('aud-panel-rol-tolvas').style.display = '';
    const btnRol = document.getElementById('itab-rol-tolvas');
    if (btnRol) {
      btnRol.style.cssText = 'flex:1;min-width:140px;background:var(--accent);color:#000;font-weight:700;border:2px solid var(--accent);';
      btnRol.classList.remove('btn-outline');
    }
    renderRolTolvas();
    return;
  }
  ```

  **d)** En el bloque `else` del caso `verificacion` (línea 5870), agregar el ocultamiento del panel rol:
  ```js
  } else {
    if (panelCaptura) panelCaptura.style.display = '';
    if (tblCaptura)   tblCaptura.style.display   = '';
    if (folioBar)     folioBar.style.display      = '';
    if (panelVerif)   panelVerif.style.display    = 'none';
    document.getElementById('aud-panel-rol-tolvas').style.display = 'none'; // ← agregar
  }
  ```

- [ ] **Step 2: Agregar variable de sesión y función `esHoyTolva`**

  Justo después del cierre de `setAudTab` (línea 5876), agregar:

  ```js
  // ─── Rol de Tolvas ──────────────────────────────────────────────────────────
  let _rolLlamadasHoy = [];  // puntos por llamada agregados en la sesión actual
  let _tolvasCacheRol = [];  // caché de tolvas activos para el selector de llamada
  let _tolvaRowActual = null; // fila pendiente de registrar en modal-registro-tolva

  function esHoyTolva(frecuencia) {
    const diasES = ['DOMINGO','LUNES','MARTES','MIERCOLES','JUEVES','VIERNES','SABADO'];
    const hoy = diasES[new Date().getDay()];
    const f = frecuencia.toUpperCase()
      .replace(/MIÉRCOLES/g, 'MIERCOLES')
      .replace(/SÁBADO/g, 'SABADO')
      .replace(/\bY\b/g, ',');
    if (f.trim() === 'DIARIO') return true;
    if (f.trim() === 'LUNES A VIERNES') return ['LUNES','MARTES','MIERCOLES','JUEVES','VIERNES'].includes(hoy);
    return f.split(',').map(s => s.trim()).includes(hoy);
  }
  ```

- [ ] **Step 3: Agregar `renderRolTolvas`**

  Justo después de `esHoyTolva`, agregar:

  ```js
  async function renderRolTolvas() {
    try {
      // 1. Cargar todos los tolvas activos (y guardar caché para el selector de llamada)
      const { data: tolvas } = await api('GET', '/tolvas?estado=activo&limit=200');
      _tolvasCacheRol = tolvas;

      // 2. Filtrar programados para hoy
      const programados = tolvas.filter(t => esHoyTolva(t.frecuencia));

      // 3. Cargar registros de diario de hoy para saber cuáles ya están registrados
      const hoy = new Date().toISOString().slice(0, 10);
      const { data: diarioHoy } = await api('GET', `/diario?fechaIni=${hoy}&fechaFin=${hoy}&limit=200`);
      const registrados = new Set(
        diarioHoy
          .filter(r => r.servicio === 'Tolvas y Contenedores' && r.punto_tolva)
          .map(r => r.punto_tolva)
      );

      // 4. Encabezado
      document.getElementById('rol-tolvas-fecha-hdr').textContent =
        `Rol del día — ${new Date().toLocaleDateString('es-MX', { weekday:'long', year:'numeric', month:'long', day:'numeric' })}`;
      document.getElementById('rol-tolvas-contador').textContent =
        `${programados.length} puntos programados · ${registrados.size} registrados`;

      // 5. Tablas
      renderTablaRol('rol-tolvas-tabla-prog', programados, registrados);
      renderTablaRol('rol-tolvas-tabla-llamada', _rolLlamadasHoy, registrados);
    } catch(e) {
      console.error('renderRolTolvas:', e);
    }
  }
  ```

- [ ] **Step 4: Agregar `renderTablaRol`**

  Justo después de `renderRolTolvas`, agregar:

  ```js
  function renderTablaRol(containerId, filas, registrados) {
    const cont = document.getElementById(containerId);
    if (!cont) return;
    if (!filas.length) {
      cont.innerHTML = '<div class="empty" style="padding:12px;"><p style="font-size:12px;color:var(--muted);">Sin puntos para mostrar</p></div>';
      return;
    }
    cont.innerHTML = `<table><thead><tr>
      <th>Folio</th><th>Tipo</th><th>Punto de Servicio</th><th>Ubicación</th><th>Estado</th><th></th>
    </tr></thead><tbody>` +
    filas.map(r => {
      const hecho = registrados.has(r.punto_servicio);
      return `<tr>
        <td class="mono">${r.folio}</td>
        <td><span class="badge b-gray">${r.tipo}</span></td>
        <td style="font-weight:600;">${r.punto_servicio}</td>
        <td style="font-size:11px;color:var(--muted);">${r.ubicacion||'—'}</td>
        <td>${hecho
          ? '<span class="badge b-green">✓ Registrado</span>'
          : '<span class="badge b-gray">Pendiente</span>'}</td>
        <td>${hecho ? '' : `<button class="btn btn-accent btn-xs" onclick="abrirModalRegistroTolva(${JSON.stringify(r).replace(/"/g,'&quot;')})">Registrar</button>`}</td>
      </tr>`;
    }).join('') + '</tbody></table>';
  }
  ```

- [ ] **Step 5: Verificar en el navegador**

  1. Navegar a **Supervisión → Rol de Tolvas**.
  2. Verificar que aparece la fecha de hoy en el encabezado.
  3. Verificar que la tabla "Programados hoy" muestra los puntos que corresponden al día actual (ej. si es lunes, deben aparecer los de frecuencia LUNES, LUNES A VIERNES, DIARIO).
  4. Si ya existen registros de Tolvas del día en Diario, deben mostrarse como "✓ Registrado".
  5. Revisar consola del navegador — no debe haber errores JS.

- [ ] **Step 6: Commit**

  ```bash
  git add public/index.html
  git commit -m "feat: add Rol de Tolvas JS logic (setAudTab, esHoyTolva, renderRolTolvas, renderTablaRol)"
  ```

---

## Task 6: JS — `abrirSelectorLlamada`, `abrirModalRegistroTolva`, `guardarRegistroTolva`

**Files:**
- Modify: `public/index.html` — agregar 3 funciones después de `renderTablaRol`

- [ ] **Step 1: Agregar `abrirSelectorLlamada` y `confirmarSelectorLlamada`**

  Después de `renderTablaRol`, agregar:

  ```js
  function abrirSelectorLlamada() {
    const llamadas = _tolvasCacheRol.filter(
      t => ['LLAMADA','POR LLAMADA'].includes(t.frecuencia.toUpperCase())
    );
    const sel = document.getElementById('sel-llamada-punto');
    sel.innerHTML = '<option value="" disabled selected>Seleccione…</option>';
    llamadas.forEach(t => {
      const opt = document.createElement('option');
      opt.value = t.punto_servicio;
      opt.textContent = `${t.folio} — ${t.punto_servicio}`;
      opt.dataset.json = JSON.stringify(t);
      sel.appendChild(opt);
    });
    document.getElementById('modal-selector-llamada').classList.add('open');
  }

  function confirmarSelectorLlamada() {
    const sel = document.getElementById('sel-llamada-punto');
    if (!sel.value) return;
    const yaExiste = _rolLlamadasHoy.some(t => t.punto_servicio === sel.value);
    if (yaExiste) {
      flash('Este punto ya fue agregado');
      cerrarModal('modal-selector-llamada');
      return;
    }
    const opt = sel.options[sel.selectedIndex];
    const tolvaRow = JSON.parse(opt.dataset.json);
    _rolLlamadasHoy.push(tolvaRow);
    cerrarModal('modal-selector-llamada');
    // Re-renderizar la sección de llamadas
    const hoy = new Date().toISOString().slice(0, 10);
    api('GET', `/diario?fechaIni=${hoy}&fechaFin=${hoy}&limit=200`)
      .then(({ data }) => {
        const registrados = new Set(
          data.filter(r => r.servicio === 'Tolvas y Contenedores' && r.punto_tolva)
              .map(r => r.punto_tolva)
        );
        renderTablaRol('rol-tolvas-tabla-llamada', _rolLlamadasHoy, registrados);
      })
      .catch(() => renderTablaRol('rol-tolvas-tabla-llamada', _rolLlamadasHoy, new Set()));
  }
  ```

- [ ] **Step 2: Agregar `abrirModalRegistroTolva`**

  ```js
  function abrirModalRegistroTolva(tolvaRow) {
    _tolvaRowActual = tolvaRow;
    document.getElementById('rtv-punto-label').textContent =
      `${tolvaRow.folio} — ${tolvaRow.punto_servicio}`;
    document.getElementById('rtv-hora').value = new Date().toTimeString().slice(0, 5);
    document.getElementById('rtv-obs').value = '';
    // Limpiar fotos previas
    ['rtv-prev1','rtv-prev2'].forEach(id => {
      const img = document.getElementById(id);
      if (img) { img.style.display = 'none'; img.src = ''; }
    });
    ['rtv-ph1','rtv-ph2'].forEach(id => {
      const ph = document.getElementById(id);
      if (ph) ph.style.display = '';
    });
    document.getElementById('modal-registro-tolva').classList.add('open');
  }
  ```

- [ ] **Step 3: Agregar `guardarRegistroTolva`**

  ```js
  async function guardarRegistroTolva() {
    if (!_tolvaRowActual) return;
    const tolvaRow = _tolvaRowActual;
    showLoader('Guardando registro…');
    try {
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
        folio:        created.folio,
        fecha:        created.fecha,
        hora:         created.hora,
        responsable:  created.responsable,
        servicio:     created.servicio,
        punto_tolva:  created.punto_tolva,
        unidad:       created.unidad,
        gps:          '',
        colonia:      created.colonia,
        calle:        created.calle,
        numero:       created.numero,
        actividades:  created.actividades,
        obs:          created.observaciones
      }, img1, img2);

      // Refrescar panel — await para que hideLoader no salte antes
      await renderRolTolvas();
    } catch(err) {
      alert('Error: ' + err.message);
    }
    hideLoader();
  }
  ```

- [ ] **Step 4: Verificar flujo completo en el navegador**

  1. Navegar a **Supervisión → Rol de Tolvas**.
  2. Hacer clic en "Registrar" en cualquier punto programado.
  3. Verificar que el modal se abre con el nombre del punto y la hora actual.
  4. Llenar responsable y observaciones. Hacer clic en "Guardar y subir a Drive".
  5. Verificar que:
     - Se muestra el loader "Guardando registro…"
     - Aparece el flash "Registro DLM/TOL/XXXX guardado ✔"
     - Se genera el PDF y se intenta subir a Drive (puede solicitar login de Google la primera vez)
     - La fila cambia a "✓ Registrado" al terminar
  6. Probar "+ Agregar por llamada":
     - Hacer clic → debe abrirse el selector con los puntos de frecuencia LLAMADA/POR LLAMADA.
     - Seleccionar uno y hacer clic en "Agregar" → debe aparecer en la sección "Agregados por llamada".
     - Intentar agregar el mismo punto de nuevo → debe mostrar flash "Este punto ya fue agregado".
  7. Verificar en **Diario de Actividades** que los registros aparecen con la columna correcta.

- [ ] **Step 5: Commit final**

  ```bash
  git add public/index.html
  git commit -m "feat: complete Rol de Tolvas — selector llamada, modal captura y guardarRegistroTolva con Drive upload"
  ```

---

## Verificación final de regresión

- [ ] Crear un registro de **Carga Trasera** en Diario — verificar que NO aparece el dropdown de punto de servicio.
- [ ] Crear un registro de **Tolvas y Contenedores** desde el formulario normal — verificar que el PDF incluye el campo "Punto de Servicio".
- [ ] Navegar a **Tolvas y Contenedores** (módulo catálogo) — verificar que sigue funcionando sin cambios.
- [ ] Navegar a **Supervisión → Diario de Actividades** (sub-tab normal) — verificar que el formulario de auditoría sigue funcionando.
- [ ] Navegar a **Supervisión → Verificación pendiente** — verificar que sigue funcionando y el botón "Rol de Tolvas" no interfiere.
