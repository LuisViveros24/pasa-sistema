# Conciliación de Boletas — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a month-by-month reconciliation feature to the Báscula/Boletas module that compares internal boleta captures against an external file (XLSX or PDF) sent by the contractor, flags discrepancies with ±1% weight tolerance, and persists results to the database.

**Architecture:** Pure frontend parsing (SheetJS already loaded + lazy pdf.js CDN) produces a normalized row array; the reconciliation algorithm runs in JS; results are posted as JSON to a new `/api/conciliaciones` route that saves to two new SQLite tables. The tab-bascula gets a mini-nav with "Captura" and "Conciliación" sub-panels.

**Tech Stack:** Node.js/Express, SQLite3 (db.run_p / db.get_p / db.all_p promise wrappers), SheetJS 0.18.5 (already loaded), jsPDF (already loaded), pdf.js 3.4.120 (lazy CDN load), vanilla JS, requireAuth middleware.

**Spec:** `docs/superpowers/specs/2026-03-22-conciliacion-boletas-design.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `db/database.js` | Modify | Add `conciliaciones` + `conciliacion_detalle` tables to SCHEMA string |
| `routes/conciliaciones.js` | **Create** | 4 CRUD endpoints (GET list, GET by id, POST, DELETE) |
| `server.js` | Modify | Register `/api/conciliaciones` with requireAuth |
| `public/index.html` | Modify | Mini-nav HTML, conciliacion panel HTML, modal-col-map HTML, all JS functions |

---

## Task 1: Database Schema — Add Two New Tables

**Files:**
- Modify: `db/database.js` — add tables to the `SCHEMA` const (before the INDEX block)

- [ ] **Step 1: Locate the insertion point in database.js**

  Open `db/database.js`. Find the line:
  ```
  CREATE TABLE IF NOT EXISTS tolvas (
  ```
  The two new tables will be inserted **after** the `tolvas` table block and **before** the first `CREATE INDEX` line.

- [ ] **Step 2: Add conciliaciones table to SCHEMA**

  In `db/database.js`, inside the `const SCHEMA = \`...\`` string, after the closing `);` of the `tolvas` table and before the first `CREATE INDEX`, add:

  ```sql
  CREATE TABLE IF NOT EXISTS conciliaciones (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    periodo           TEXT    NOT NULL UNIQUE,
    archivo_nombre    TEXT,
    fecha_carga       TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
    total_propios     INTEGER DEFAULT 0,
    total_externos    INTEGER DEFAULT 0,
    total_ok          INTEGER DEFAULT 0,
    total_diff        INTEGER DEFAULT 0,
    total_solo_mios   INTEGER DEFAULT 0,
    total_solo_suyos  INTEGER DEFAULT 0,
    estado            TEXT    DEFAULT 'abierta',
    datos_incompletos INTEGER DEFAULT 0,
    created_at        TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS conciliacion_detalle (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    conciliacion_id  INTEGER NOT NULL,
    folio            TEXT,
    estado_match     TEXT,
    num_eco_propio   TEXT,
    bruto_propio     REAL,
    tara_propia      REAL,
    neto_propio      REAL,
    num_eco_externo  TEXT,
    bruto_externo    REAL,
    tara_externa     REAL,
    neto_externo     REAL,
    diff_num_eco     INTEGER DEFAULT 0,
    diff_bruto_pct   REAL,
    diff_tara_pct    REAL,
    diff_neto_pct    REAL,
    señalamiento     TEXT,
    FOREIGN KEY (conciliacion_id) REFERENCES conciliaciones(id) ON DELETE CASCADE
  );
  ```

- [ ] **Step 3: Add indexes after the new tables**

  In the same SCHEMA string, after the existing indexes, add:
  ```sql
  CREATE INDEX IF NOT EXISTS idx_conciliaciones_periodo ON conciliaciones(periodo);
  CREATE INDEX IF NOT EXISTS idx_concili_detalle_cid    ON conciliacion_detalle(conciliacion_id);
  ```

- [ ] **Step 4: Restart the server and verify tables exist**

  ```bash
  cd /Users/viverosmunoz/Desktop/pasa-sistema
  node server.js &
  sleep 2
  sqlite3 pasa.db ".tables"
  ```
  Expected output includes: `conciliaciones` and `conciliacion_detalle`

  ```bash
  sqlite3 pasa.db ".schema conciliaciones"
  ```
  Expected: shows all 13 columns including `datos_incompletos` and `UNIQUE` on `periodo`.

  ```bash
  sqlite3 pasa.db ".schema conciliacion_detalle"
  ```
  Expected: shows `FOREIGN KEY (conciliacion_id) REFERENCES conciliaciones(id) ON DELETE CASCADE`

- [ ] **Step 5: Kill dev server**
  ```bash
  pkill -f "node server.js" 2>/dev/null; true
  ```

- [ ] **Step 6: Commit**
  ```bash
  cd /Users/viverosmunoz/Desktop/pasa-sistema
  git add db/database.js
  git commit -m "feat(db): add conciliaciones and conciliacion_detalle tables"
  ```

---

## Task 2: API Route — routes/conciliaciones.js

**Files:**
- Create: `routes/conciliaciones.js`

- [ ] **Step 1: Create the file with GET / (list)**

  Create `routes/conciliaciones.js`:
  ```js
  const express = require('express');
  const router  = express.Router();
  const db      = require('../db/database');

  // GET /api/conciliaciones[?periodo=YYYY-MM]
  router.get('/', async (req, res) => {
    try {
      const { periodo = '' } = req.query;
      let where  = '';
      const params = [];
      if (periodo) { where = 'WHERE periodo = ?'; params.push(periodo); }
      const rows = await db.all_p(
        `SELECT * FROM conciliaciones ${where} ORDER BY id DESC`,
        params
      );
      res.json({ data: rows, total: rows.length });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  // GET /api/conciliaciones/:id  (with detalle)
  router.get('/:id', async (req, res) => {
    try {
      const row = await db.get_p('SELECT * FROM conciliaciones WHERE id = ?', [req.params.id]);
      if (!row) return res.status(404).json({ error: 'No encontrada' });
      const detalle = await db.all_p(
        'SELECT * FROM conciliacion_detalle WHERE conciliacion_id = ? ORDER BY id',
        [req.params.id]
      );
      res.json({ ...row, detalle });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  // POST /api/conciliaciones  — body: { encabezado: {...}, detalle: [...] }
  router.post('/', async (req, res) => {
    try {
      const { encabezado: e, detalle = [] } = req.body;
      if (!e || !e.periodo) return res.status(400).json({ error: 'periodo requerido' });

      // Check duplicate periodo
      const existing = await db.get_p('SELECT id FROM conciliaciones WHERE periodo = ?', [e.periodo]);
      if (existing) return res.status(409).json({
        error: `Ya existe una conciliación para ${e.periodo}. Elimínala primero para reemplazarla.`,
        existingId: existing.id
      });

      const result = await db.run_p(
        `INSERT INTO conciliaciones
           (periodo, archivo_nombre, total_propios, total_externos, total_ok,
            total_diff, total_solo_mios, total_solo_suyos, datos_incompletos)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        [ e.periodo, e.archivo_nombre || null,
          e.total_propios || 0, e.total_externos || 0, e.total_ok || 0,
          e.total_diff || 0, e.total_solo_mios || 0, e.total_solo_suyos || 0,
          e.datos_incompletos ? 1 : 0 ]
      );
      const cid = result.lastID;

      // Batch insert detalle
      if (detalle.length > 0) {
        const stmt = `INSERT INTO conciliacion_detalle
          (conciliacion_id,folio,estado_match,num_eco_propio,bruto_propio,tara_propia,neto_propio,
           num_eco_externo,bruto_externo,tara_externa,neto_externo,
           diff_num_eco,diff_bruto_pct,diff_tara_pct,diff_neto_pct,señalamiento)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`;
        for (const d of detalle) {
          await db.run_p(stmt, [
            cid, d.folio || null, d.estado_match || null,
            d.num_eco_propio || null, d.bruto_propio ?? null, d.tara_propia ?? null, d.neto_propio ?? null,
            d.num_eco_externo || null, d.bruto_externo ?? null, d.tara_externa ?? null, d.neto_externo ?? null,
            d.diff_num_eco ? 1 : 0, d.diff_bruto_pct ?? null, d.diff_tara_pct ?? null, d.diff_neto_pct ?? null,
            d.señalamiento || null
          ]);
        }
      }

      const created = await db.get_p('SELECT * FROM conciliaciones WHERE id = ?', [cid]);
      res.status(201).json(created);
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  // DELETE /api/conciliaciones/:id
  router.delete('/:id', async (req, res) => {
    try {
      const row = await db.get_p('SELECT estado FROM conciliaciones WHERE id = ?', [req.params.id]);
      if (!row) return res.status(404).json({ error: 'No encontrada' });
      if (row.estado === 'cerrada')
        return res.status(409).json({ error: 'No se puede eliminar una conciliación cerrada' });
      const r = await db.run_p('DELETE FROM conciliaciones WHERE id = ?', [req.params.id]);
      if (r.changes === 0) return res.status(404).json({ error: 'No encontrada' });
      res.json({ deleted: true });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  module.exports = router;
  ```

- [ ] **Step 2: Register route in server.js**

  In `server.js`, after the last `app.use('/api/usuarios', ...)` line, add:
  ```js
  app.use('/api/conciliaciones', requireAuth, require('./routes/conciliaciones'));
  ```

- [ ] **Step 3: Start server and test all 4 endpoints manually**

  ```bash
  cd /Users/viverosmunoz/Desktop/pasa-sistema
  node server.js &
  sleep 2

  # Get auth token first
  TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
    -H "Content-Type: application/json" \
    -d '{"usuario":"admin","password":"Admin2026!"}' | node -e "process.stdin.resume();let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).token))")
  echo "Token: $TOKEN"

  # Test GET / (empty list)
  curl -s -H "Authorization: Bearer $TOKEN" http://localhost:3000/api/conciliaciones | node -e "process.stdin.resume();let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d)))"
  ```
  Expected: `{ data: [], total: 0 }`

  ```bash
  # Test POST
  curl -s -X POST http://localhost:3000/api/conciliaciones \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"encabezado":{"periodo":"2026-01","archivo_nombre":"test.xlsx","total_propios":10,"total_externos":10,"total_ok":8,"total_diff":1,"total_solo_mios":1,"total_solo_suyos":0},"detalle":[{"folio":"001","estado_match":"ok","num_eco_propio":"CT-2898","bruto_propio":12000,"tara_propia":5000,"neto_propio":7000}]}'
  ```
  Expected: `{ id: 1, periodo: "2026-01", estado: "abierta", ... }`

  ```bash
  # Test GET /:id
  curl -s -H "Authorization: Bearer $TOKEN" http://localhost:3000/api/conciliaciones/1
  ```
  Expected: conciliacion object with `detalle` array containing 1 row.

  ```bash
  # Test duplicate periodo → 409
  curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:3000/api/conciliaciones \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"encabezado":{"periodo":"2026-01"},"detalle":[]}'
  ```
  Expected: `409`

  ```bash
  # Test DELETE
  curl -s -X DELETE -H "Authorization: Bearer $TOKEN" http://localhost:3000/api/conciliaciones/1
  ```
  Expected: `{ deleted: true }`

  ```bash
  pkill -f "node server.js" 2>/dev/null; true
  ```

- [ ] **Step 4: Commit**
  ```bash
  cd /Users/viverosmunoz/Desktop/pasa-sistema
  git add routes/conciliaciones.js server.js
  git commit -m "feat(api): add /api/conciliaciones CRUD route with periodo uniqueness and closed-state guard"
  ```

---

## Task 3: Frontend HTML — Mini-nav + Conciliación Panel Structure

**Files:**
- Modify: `public/index.html` — tab-bascula section

> **Context:** `tab-bascula` currently starts at line ~539 and contains a `<form>` and a `<div class="table-wrap">`. We wrap these in a `#bas-cap` sub-panel and add a new `#bas-concili` sub-panel, plus a 2-button mini-nav at the top of the tab.

- [ ] **Step 1: Add mini-nav and wrap existing content in #bas-cap**

  In `public/index.html`, find the exact lines:
  ```html
  <div class="tab-panel" id="tab-bascula">
    <div class="sec-h"><h2>Báscula / Boleta</h2><p>Registro de pesadas por tipo de servicio — Carga Trasera y Tolvas</p></div>

    <form id="form-bascula" onsubmit="guardarBoleta(event)">
  ```

  Replace with:
  ```html
  <div class="tab-panel" id="tab-bascula">
    <div class="sec-h"><h2>Báscula / Boleta</h2><p>Registro de pesadas por tipo de servicio — Carga Trasera y Tolvas</p></div>

    <!-- Mini-nav -->
    <div style="display:flex;gap:6px;margin-bottom:18px;">
      <button class="btn" id="bas-itab-cap" onclick="setBasculaTab('cap')" style="flex:1;background:var(--accent);color:#000;font-weight:700;border:2px solid var(--accent);"><i class="fas fa-weight"></i> Captura</button>
      <button class="btn btn-outline" id="bas-itab-concili" onclick="setBasculaTab('concili')" style="flex:1;"><i class="fas fa-balance-scale"></i> Conciliación</button>
    </div>

    <!-- Sub-panel: Captura -->
    <div id="bas-cap">
    <form id="form-bascula" onsubmit="guardarBoleta(event)">
  ```

- [ ] **Step 2: Close the #bas-cap div after the table-wrap**

  Find the closing `</div>` of `<div id="tabla-boletas-recientes">` and the enclosing `</div>` of `<div class="table-wrap">`. After the closing `</div>` of the `table-wrap` div and before the `</div>` that closes `tab-bascula`, add:
  ```html
    </div><!-- /bas-cap -->
  ```

  The structure should read:
  ```html
      </div><!-- /table-wrap -->
    </div><!-- /bas-cap -->

    </div><!-- /tab-bascula -->
  ```

- [ ] **Step 3: Add the #bas-concili panel (before closing tab-bascula)**

  After `</div><!-- /bas-cap -->` and before `</div><!-- /tab-bascula -->`, insert:

  ```html
  <!-- Sub-panel: Conciliación -->
  <div id="bas-concili" style="display:none;">
    <div class="section-box">
      <div class="section-box-title"><i class="fas fa-calendar-alt"></i> Periodo y Archivo</div>
      <div class="form-grid">
        <div class="form-group">
          <label>Mes a conciliar</label>
          <input type="month" id="concili-periodo" style="background:var(--surface3);border:1px solid var(--border);border-radius:var(--radius);padding:8px 10px;font-size:13px;color:var(--text);width:100%;">
        </div>
        <div class="form-group">
          <label>Archivo de la concesionaria (.xlsx, .xls, .pdf)</label>
          <div id="concili-dropzone" onclick="document.getElementById('concili-file-input').click()"
            style="border:2px dashed var(--border);border-radius:var(--radius);padding:22px;text-align:center;cursor:pointer;color:var(--muted);font-size:13px;transition:border-color 0.2s;"
            ondragover="event.preventDefault();this.style.borderColor='var(--accent)'"
            ondragleave="this.style.borderColor='var(--border)'"
            ondrop="conciliDrop(event)">
            <i class="fas fa-cloud-upload-alt" style="font-size:28px;margin-bottom:8px;display:block;"></i>
            <span id="concili-dropzone-label">Arrastra aquí o haz clic para seleccionar</span>
          </div>
          <input type="file" id="concili-file-input" accept=".xlsx,.xls,.pdf" style="display:none" onchange="onArchivoConciliacion(this)">
        </div>
      </div>
      <div id="concili-aviso-fecha" style="display:none;background:var(--yellow-dim,#332200);border:1px solid var(--yellow,#f5a623);border-radius:var(--radius);padding:10px 14px;font-size:12px;color:var(--yellow,#f5a623);margin-top:10px;">
        <i class="fas fa-exclamation-triangle"></i> Nota: boletas sin fecha de entrada no se incluirán en esta conciliación.
      </div>
      <div id="concili-aviso-incompleto" style="display:none;background:#330000;border:1px solid #cc0000;border-radius:var(--radius);padding:10px 14px;font-size:12px;color:#ff6666;margin-top:8px;">
        <i class="fas fa-exclamation-circle"></i> <strong>Datos incompletos:</strong> el periodo tiene más de 9,999 boletas. Solo se procesaron las primeras 9,999.
      </div>
      <div style="margin-top:14px;">
        <button type="button" class="btn btn-accent" onclick="ejecutarConciliacion()" id="btn-ejecutar-concili" disabled style="opacity:0.5;">
          <i class="fas fa-play"></i> Iniciar conciliación
        </button>
      </div>
    </div>

    <!-- Results area (hidden until reconciliation runs) -->
    <div id="concili-resultados" style="display:none;">
      <!-- Summary cards -->
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin-bottom:18px;" id="concili-cards"></div>

      <!-- Filter tabs -->
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px;">
        <button class="btn btn-sm" id="cfilt-todos"   onclick="setConciliFiltro('todos')"     style="background:var(--surface3);border:1px solid var(--border);">Todos</button>
        <button class="btn btn-sm" id="cfilt-ok"      onclick="setConciliFiltro('ok')"        style="background:var(--green-dim,#002200);border:1px solid var(--green,#4caf50);color:var(--green,#4caf50);">✅ Coincidencias</button>
        <button class="btn btn-sm" id="cfilt-diff"    onclick="setConciliFiltro('diferencia')" style="background:var(--yellow-dim,#332200);border:1px solid var(--yellow,#f5a623);color:var(--yellow,#f5a623);">⚠️ Diferencias</button>
        <button class="btn btn-sm" id="cfilt-propio"  onclick="setConciliFiltro('solo_propio')" style="background:var(--accent-dim);border:1px solid var(--accent);color:var(--accent);">📋 Solo míos</button>
        <button class="btn btn-sm" id="cfilt-externo" onclick="setConciliFiltro('solo_externo')" style="background:#220033;border:1px solid #cc44ff;color:#cc44ff;">📋 Solo suyos</button>
        <button class="btn btn-sm" id="cfilt-incompleto" onclick="setConciliFiltro('incompleto')" style="background:#330000;border:1px solid #cc0000;color:#ff6666;">❓ Incompletos</button>
      </div>

      <div class="table-wrap" style="margin-bottom:14px;">
        <div id="tabla-concili"></div>
      </div>

      <!-- Action buttons -->
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:28px;">
        <button type="button" class="btn btn-accent" onclick="guardarConciliacion()" id="btn-guardar-concili">
          <i class="fas fa-save"></i> Guardar conciliación
        </button>
        <button type="button" class="btn btn-outline" onclick="exportarConciliacionExcel()">
          <i class="fas fa-file-excel"></i> Exportar Excel
        </button>
        <button type="button" class="btn btn-outline" onclick="exportarConciliacionPDF()">
          <i class="fas fa-file-pdf"></i> Exportar PDF
        </button>
      </div>
    </div>

    <!-- Historial -->
    <div class="table-wrap">
      <div class="table-header">
        <span class="table-title">Historial de Conciliaciones</span>
      </div>
      <div id="tabla-historial-concili"></div>
    </div>
  </div><!-- /bas-concili -->
  ```

- [ ] **Step 4: Add modal-col-map before the closing </body>**

  Find the last modal in the file (search for `<!-- /modal-` near the end). After the last modal closing div, add:

  ```html
  <!-- Modal: Mapeo de columnas para conciliación -->
  <div class="modal-overlay" id="modal-col-map">
    <div class="modal" style="max-width:500px;">
      <div class="modal-head">
        <span class="modal-title"><i class="fas fa-columns"></i> Mapeo de Columnas</span>
        <button class="modal-close" onclick="document.getElementById('modal-col-map').classList.remove('open')">✕</button>
      </div>
      <div class="modal-body">
        <p style="font-size:13px;color:var(--muted);margin-bottom:16px;">
          No se detectaron automáticamente todas las columnas requeridas. Selecciona cuál columna del archivo corresponde a cada campo:
        </p>
        <div id="col-map-fields"></div>
        <div style="display:flex;gap:10px;margin-top:18px;">
          <button class="btn btn-outline" style="flex:1" onclick="document.getElementById('modal-col-map').classList.remove('open')">Cancelar</button>
          <button class="btn btn-accent" style="flex:1" onclick="confirmarMapeoColumnas()"><i class="fas fa-check"></i> Confirmar</button>
        </div>
      </div>
    </div>
  </div>
  ```

- [ ] **Step 5: Start server and visually verify**

  ```bash
  cd /Users/viverosmunoz/Desktop/pasa-sistema && node server.js &
  sleep 2
  ```
  Open `http://localhost:3000` in browser, log in as admin, navigate to Báscula/Boleta.
  Verify:
  - Two buttons appear at top: "Captura" (highlighted) and "Conciliación"
  - Clicking "Conciliación" shows the file drop zone and period picker
  - Clicking "Captura" restores original form
  - "Iniciar conciliación" button is disabled (greyed out)

  ```bash
  pkill -f "node server.js" 2>/dev/null; true
  ```

- [ ] **Step 6: Commit**
  ```bash
  cd /Users/viverosmunoz/Desktop/pasa-sistema
  git add public/index.html
  git commit -m "feat(ui): add conciliation mini-nav, panel, drop zone, and column-map modal to tab-bascula"
  ```

---

## Task 4: Frontend JS — Tab Switching + Core Match Algorithm

**Files:**
- Modify: `public/index.html` — add JS functions in the `<script>` block

> **Where to insert:** Find the comment `// ─── Supervisión: origen (sub-tab activo)` (around line 3353). Insert the new conciliation JS block **above** that comment, or alternatively after the `renderBoletasRecientes` function block. All new functions go inside the existing `<script>` tag.

- [ ] **Step 1: Add setBasculaTab() and closure vars**

  Inside the `<script>` tag, add:

  ```js
  // ─── Báscula: sub-tab switching ──────────────────────────────────────────────
  function setBasculaTab(tab) {
    document.getElementById('bas-cap').style.display     = tab === 'cap'     ? '' : 'none';
    document.getElementById('bas-concili').style.display = tab === 'concili' ? '' : 'none';
    document.getElementById('bas-itab-cap').style.cssText     =
      tab === 'cap'     ? 'flex:1;background:var(--accent);color:#000;font-weight:700;border:2px solid var(--accent);'
                        : 'flex:1;';
    document.getElementById('bas-itab-cap').className     = tab === 'cap'     ? 'btn' : 'btn btn-outline';
    document.getElementById('bas-itab-concili').style.cssText =
      tab === 'concili' ? 'flex:1;background:var(--accent);color:#000;font-weight:700;border:2px solid var(--accent);'
                        : 'flex:1;';
    document.getElementById('bas-itab-concili').className = tab === 'concili' ? 'btn' : 'btn btn-outline';
    if (tab === 'concili') initConciliacion();
  }

  // ─── Conciliación: closure state ─────────────────────────────────────────────
  let _conciliRows     = [];   // parsed rows from external file
  let _conciliResultado = [];  // result array after match
  let _conciliPeriodo  = '';
  let _conciliArchivo  = '';
  let _conciliFiltro   = 'todos';
  let _colMapCols      = [];   // column names from external file
  let _colMapResolve   = null; // Promise resolver for column map modal
  ```

- [ ] **Step 2: Add pctDiff and conciliarRows (pure match logic)**

  ```js
  // ─── Conciliación: algoritmo de match ────────────────────────────────────────
  function pctDiff(a, b) {
    if (a === 0 && b === 0) return 0;
    if (a === 0 || b === 0) return 1;
    return Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b));
  }

  function conciliarRows(propios, externos) {
    // propios: array of boleta objects from API
    // externos: array of { folio, num_eco, peso_bruto, tara, peso_neto } normalized
    const normF = v => String(v || '').trim().toLowerCase();
    const normN = v => String(v || '').trim().toLowerCase();

    // Build maps (last row wins for duplicate folios in own records)
    const mapProp = new Map();
    for (const r of propios) mapProp.set(normF(r.folio), r);

    const mapExt  = new Map();
    for (const r of externos) {
      const k = normF(r.folio);
      if (!mapExt.has(k)) mapExt.set(k, r); // first occurrence wins for external
    }

    const allFolios = new Set([...mapProp.keys(), ...mapExt.keys()]);
    const resultado = [];

    for (const folio of allFolios) {
      const p = mapProp.get(folio);
      const e = mapExt.get(folio);

      if (p && !e) {
        resultado.push({
          folio: p.folio,
          estado_match: 'solo_propio',
          num_eco_propio: p.num_eco, bruto_propio: p.peso_bruto,
          tara_propia: p.tara, neto_propio: p.peso_neto,
          num_eco_externo: null, bruto_externo: null, tara_externa: null, neto_externo: null,
          diff_num_eco: 0, diff_bruto_pct: null, diff_tara_pct: null, diff_neto_pct: null,
          señalamiento: 'Folio presente solo en mis registros'
        });
        continue;
      }
      if (!p && e) {
        resultado.push({
          folio: e.folio,
          estado_match: 'solo_externo',
          num_eco_propio: null, bruto_propio: null, tara_propia: null, neto_propio: null,
          num_eco_externo: e.num_eco, bruto_externo: e.peso_bruto,
          tara_externa: e.tara, neto_externo: e.peso_neto,
          diff_num_eco: 0, diff_bruto_pct: null, diff_tara_pct: null, diff_neto_pct: null,
          señalamiento: 'Folio presente solo en el archivo externo'
        });
        continue;
      }

      // Both present — check for null/unparseable external values
      const extNulos = [e.peso_bruto, e.tara, e.peso_neto].some(v => v === null);
      if (extNulos) {
        resultado.push({
          folio: p.folio,
          estado_match: 'incompleto',
          num_eco_propio: p.num_eco, bruto_propio: p.peso_bruto,
          tara_propia: p.tara, neto_propio: p.peso_neto,
          num_eco_externo: e.num_eco, bruto_externo: e.peso_bruto,
          tara_externa: e.tara, neto_externo: e.peso_neto,
          diff_num_eco: 0, diff_bruto_pct: null, diff_tara_pct: null, diff_neto_pct: null,
          señalamiento: 'Valor externo no disponible para uno o más campos de peso'
        });
        continue;
      }

      const diffEco   = normN(p.num_eco) !== normN(e.num_eco);
      const dBrutoPct = pctDiff(p.peso_bruto || 0, e.peso_bruto || 0);
      const dTaraPct  = pctDiff(p.tara || 0, e.tara || 0);
      const dNetoPct  = pctDiff(p.peso_neto || 0, e.peso_neto || 0);
      const TOLE      = 0.01;
      const hayDiff   = diffEco || dBrutoPct > TOLE || dTaraPct > TOLE || dNetoPct > TOLE;

      const senas = [];
      if (diffEco)           senas.push(`No. Económico difiere (propio: ${p.num_eco} / externo: ${e.num_eco})`);
      if (dBrutoPct > TOLE)  senas.push(`Peso Bruto difiere en ${(dBrutoPct*100).toFixed(2)}% (propio: ${p.peso_bruto} kg / externo: ${e.peso_bruto} kg)`);
      if (dTaraPct  > TOLE)  senas.push(`Tara difiere en ${(dTaraPct*100).toFixed(2)}% (propio: ${p.tara} kg / externo: ${e.tara} kg)`);
      if (dNetoPct  > TOLE)  senas.push(`Peso Neto difiere en ${(dNetoPct*100).toFixed(2)}% (propio: ${p.peso_neto} kg / externo: ${e.peso_neto} kg)`);

      resultado.push({
        folio: p.folio,
        estado_match: hayDiff ? 'diferencia' : 'ok',
        num_eco_propio: p.num_eco, bruto_propio: p.peso_bruto,
        tara_propia: p.tara, neto_propio: p.peso_neto,
        num_eco_externo: e.num_eco, bruto_externo: e.peso_bruto,
        tara_externa: e.tara, neto_externo: e.peso_neto,
        diff_num_eco: diffEco ? 1 : 0,
        diff_bruto_pct: dBrutoPct, diff_tara_pct: dTaraPct, diff_neto_pct: dNetoPct,
        señalamiento: senas.join('; ') || null
      });
    }
    return resultado;
  }
  ```

- [ ] **Step 3: Verify pctDiff edge cases in browser console (after server start)**

  ```bash
  node server.js &
  sleep 2
  ```
  Open browser console at `http://localhost:3000` (after login), paste:
  ```js
  console.log(pctDiff(0, 0));       // Expected: 0
  console.log(pctDiff(0, 5000));    // Expected: 1
  console.log(pctDiff(5000, 0));    // Expected: 1
  console.log(pctDiff(10000, 10050)); // Expected: ~0.005 (0.5%, under 1% tolerance)
  console.log(pctDiff(10000, 10200)); // Expected: ~0.02 (2%, above 1% tolerance)
  ```
  All values must match expectations.

  ```bash
  pkill -f "node server.js" 2>/dev/null; true
  ```

- [ ] **Step 4: Commit**
  ```bash
  cd /Users/viverosmunoz/Desktop/pasa-sistema
  git add public/index.html
  git commit -m "feat(concili): add tab switching, closure state, pctDiff, and conciliarRows match logic"
  ```

---

## Task 5: Frontend JS — File Parsing (XLSX + PDF)

**Files:**
- Modify: `public/index.html` — add parsing functions to `<script>` block

- [ ] **Step 1: Add column detection and XLSX parser**

  ```js
  // ─── Conciliación: detección de columnas ─────────────────────────────────────
  function detectarColumnasConcili(firstRow) {
    const norm = s => String(s).toLowerCase().trim().replace(/[\s._\-]+/g, '');
    const keys = Object.keys(firstRow);
    const findCol = (opts) => {
      for (const opt of opts) {
        const k = keys.find(k => norm(k).includes(opt));
        if (k !== undefined) return k;
      }
      return null;
    };
    return {
      folio:      findCol(['folio','noboleta','boleta','ticket','ndoc']),
      num_eco:    findCol(['economico','eco','unidad','numeco','noeco','nounidad','noeco']),
      peso_bruto: findCol(['bruto','pesobruto','pb','gross']),
      tara:       findCol(['tara','pesovacio','vacio','empty']),
      peso_neto:  findCol(['neto','pesoneto','pn','net']),
    };
  }

  // ─── Conciliación: parseo XLSX ────────────────────────────────────────────────
  function parsearXLSX(buffer) {
    const wb  = XLSX.read(buffer, { type: 'binary' });
    const ws  = wb.Sheets[wb.SheetNames[0]];
    const raw = XLSX.utils.sheet_to_json(ws, { defval: '' });
    if (!raw.length) throw new Error('El archivo XLSX está vacío o no tiene filas.');
    return raw;
  }

  // Normalize a raw row using a column map
  function normalizarFila(row, colMap) {
    const parseW = v => {
      const n = parseFloat(String(v).replace(/,/g, '.'));
      return isNaN(n) ? null : n;
    };
    return {
      folio:      String(row[colMap.folio] || '').trim(),
      num_eco:    String(row[colMap.num_eco] || '').trim().toUpperCase(),
      peso_bruto: parseW(row[colMap.peso_bruto]),
      tara:       parseW(row[colMap.tara]),
      peso_neto:  parseW(row[colMap.peso_neto]),
    };
  }
  ```

- [ ] **Step 2: Add PDF parser (lazy pdf.js)**

  ```js
  // ─── Conciliación: parseo PDF (lazy pdf.js) ───────────────────────────────────
  async function cargarPdfJs() {
    if (window.pdfjsLib) return;
    await new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.min.js';
      // NOTE: Add integrity="sha384-..." attribute here before production
      // Get hash from https://www.srihash.org/ for the above URL
      s.crossOrigin = 'anonymous';
      s.onload  = resolve;
      s.onerror = () => reject(new Error('No se pudo cargar pdf.js. Si estás en una red sin internet, convierte el PDF a XLSX primero.'));
      document.head.appendChild(s);
    });
    window.pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js';
  }

  async function parsearPDF(buffer) {
    await cargarPdfJs();
    const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buffer) }).promise;
    let allText = '';
    for (let i = 1; i <= pdf.numPages; i++) {
      const page    = await pdf.getPage(i);
      const content = await page.getTextContent();
      allText += content.items.map(t => t.str).join(' ') + '\n';
    }
    // Each row in a boleta table typically looks like:
    // 004521  CT-2898  14520.5  6200.0  8320.5
    // Regex: folio (alphanumeric), unit (letters-digits), 3 numbers
    const lineRe = /(\S+)\s+((?:CT|FR|RO)-\d+|\S+)\s+([\d.,]+)\s+([\d.,]+)\s+([\d.,]+)/gi;
    const rows = [];
    let match;
    while ((match = lineRe.exec(allText)) !== null) {
      const pb = parseFloat(match[3].replace(',', '.'));
      const ta = parseFloat(match[4].replace(',', '.'));
      const pn = parseFloat(match[5].replace(',', '.'));
      if (isNaN(pb) || isNaN(ta) || isNaN(pn)) continue;
      rows.push({
        folio:      match[1].trim(),
        num_eco:    match[2].trim().toUpperCase(),
        peso_bruto: pb,
        tara:       ta,
        peso_neto:  pn,
      });
    }
    if (rows.length < 5) throw new Error(
      `Solo se detectaron ${rows.length} fila(s) en el PDF. El PDF puede estar escaneado o tener un formato no estándar. Conviértelo a XLSX para mejor compatibilidad.`
    );
    return rows;
  }
  ```

- [ ] **Step 3: Add onArchivoConciliacion and conciliDrop handlers**

  ```js
  // ─── Conciliación: file drop and input handler ────────────────────────────────
  function conciliDrop(event) {
    event.preventDefault();
    event.currentTarget.style.borderColor = 'var(--border)';
    const file = event.dataTransfer.files[0];
    if (file) procesarArchivoConciliacion(file);
  }

  function onArchivoConciliacion(input) {
    const file = input.files[0];
    input.value = '';
    if (file) procesarArchivoConciliacion(file);
  }

  async function procesarArchivoConciliacion(file) {
    _conciliArchivo = file.name;
    document.getElementById('concili-dropzone-label').textContent = `📎 ${file.name}`;
    const ext = file.name.split('.').pop().toLowerCase();
    showLoader('Leyendo archivo…');
    try {
      const buffer = await file.arrayBuffer();
      let rawRows;
      if (ext === 'pdf') {
        rawRows = await parsearPDF(buffer);
        _conciliRows = rawRows; // PDF parser returns already-normalized rows
      } else {
        const binaryStr = String.fromCharCode(...new Uint8Array(buffer));
        const raw = parsearXLSX(binaryStr);
        const colMap = detectarColumnasConcili(raw[0]);
        const missing = Object.entries(colMap).filter(([,v]) => v === null).map(([k]) => k);
        if (missing.length > 0) {
          hideLoader();
          colMap._rawCols = Object.keys(raw[0]);
          colMap._raw     = raw;
          _colMapCols     = colMap;
          await mostrarModalMapeoColumnas(colMap);
          return; // continúa desde confirmarMapeoColumnas
        }
        _conciliRows = raw.map(r => normalizarFila(r, colMap)).filter(r => r.folio);
      }
      hideLoader();
      // Enable the button now that we have a file
      const btn = document.getElementById('btn-ejecutar-concili');
      btn.disabled = false;
      btn.style.opacity = '1';
    } catch(err) {
      hideLoader();
      alert('Error al leer el archivo: ' + err.message);
    }
  }
  ```

- [ ] **Step 4: Add column map modal logic**

  ```js
  // ─── Conciliación: mapeo manual de columnas ────────────────────────────────────
  async function mostrarModalMapeoColumnas(partialMap) {
    const cols    = partialMap._rawCols;
    const campos  = ['folio','num_eco','peso_bruto','tara','peso_neto'];
    const labels  = { folio:'Folio', num_eco:'No. Económico', peso_bruto:'Peso Bruto', tara:'Tara', peso_neto:'Peso Neto' };
    const body    = document.getElementById('col-map-fields');
    body.innerHTML = campos.map(c => `
      <div class="form-group" style="margin-bottom:12px;">
        <label style="font-size:12px;font-weight:700;">${labels[c]}</label>
        <select id="cmap-${c}" style="background:var(--surface3);border:1px solid var(--border);border-radius:var(--radius);padding:8px 10px;font-size:13px;color:var(--text);width:100%;">
          <option value="">— Selecciona columna —</option>
          ${cols.map(col => `<option value="${col}" ${partialMap[c]===col?'selected':''}>${col}</option>`).join('')}
        </select>
      </div>`).join('');
    document.getElementById('modal-col-map').classList.add('open');
    return new Promise(resolve => { _colMapResolve = resolve; });
  }

  function confirmarMapeoColumnas() {
    const campos = ['folio','num_eco','peso_bruto','tara','peso_neto'];
    const colMap = {};
    for (const c of campos) {
      const val = document.getElementById(`cmap-${c}`)?.value;
      if (!val) { alert(`Selecciona la columna para "${c}"`); return; }
      colMap[c] = val;
    }
    document.getElementById('modal-col-map').classList.remove('open');
    const raw = _colMapCols._raw;
    _conciliRows = raw.map(r => normalizarFila(r, colMap)).filter(r => r.folio);
    const btn = document.getElementById('btn-ejecutar-concili');
    btn.disabled = false;
    btn.style.opacity = '1';
    if (_colMapResolve) { _colMapResolve(); _colMapResolve = null; }
  }
  ```

- [ ] **Step 5: Start server and test XLSX parsing in console**

  ```bash
  node server.js &
  sleep 2
  ```
  Open browser console at `http://localhost:3000` (after login), navigate to Báscula → Conciliación.
  Create a minimal test by pasting this in console:
  ```js
  // Test normalizarFila
  const testRow = { 'FOLIO': '004521', 'ECO': 'CT-2898', 'BRUTO': '14520.5', 'TARA': '6200', 'NETO': '8320.5' };
  const map = detectarColumnasConcili(testRow);
  console.log('colMap:', map);
  // Expected: { folio: 'FOLIO', num_eco: 'ECO', peso_bruto: 'BRUTO', tara: 'TARA', peso_neto: 'NETO' }
  const normed = normalizarFila(testRow, map);
  console.log('normed:', normed);
  // Expected: { folio: '004521', num_eco: 'CT-2898', peso_bruto: 14520.5, tara: 6200, peso_neto: 8320.5 }
  ```

  ```bash
  pkill -f "node server.js" 2>/dev/null; true
  ```

- [ ] **Step 6: Commit**
  ```bash
  cd /Users/viverosmunoz/Desktop/pasa-sistema
  git add public/index.html
  git commit -m "feat(concili): add XLSX/PDF parsers, column auto-detection, and column-map modal logic"
  ```

---

## Task 6: Frontend JS — ejecutarConciliacion + renderResultados

**Files:**
- Modify: `public/index.html` — add JS functions to `<script>` block

- [ ] **Step 1: Add ejecutarConciliacion**

  ```js
  // ─── Conciliación: ejecutar ───────────────────────────────────────────────────
  async function ejecutarConciliacion() {
    const periodo = document.getElementById('concili-periodo').value;
    if (!periodo) { alert('Selecciona el mes a conciliar'); return; }
    if (!_conciliRows.length) { alert('Carga primero el archivo de la concesionaria'); return; }
    _conciliPeriodo = periodo;

    showLoader('Consultando boletas del periodo…');
    try {
      const [year, month] = periodo.split('-');
      const lastDay = new Date(parseInt(year), parseInt(month), 0).getDate();
      const ini = `${year}-${month}-01`;
      const fin = `${year}-${month}-${String(lastDay).padStart(2,'0')}`;
      const { data: propios, total } = await api('GET', `/boletas?fechaIni=${ini}&fechaFin=${fin}&limit=9999`);

      const incompleto = total > 9999;
      document.getElementById('concili-aviso-incompleto').style.display = incompleto ? '' : 'none';
      document.getElementById('concili-aviso-fecha').style.display = '';

      _conciliResultado = conciliarRows(propios, _conciliRows);
      _conciliResultado._incompleto   = incompleto;
      _conciliResultado._totalPropios = total;
      _conciliResultado._totalExternos = _conciliRows.length;

      hideLoader();
      document.getElementById('concili-resultados').style.display = '';
      _conciliFiltro = 'todos';
      renderResultadosConciliacion();
    } catch(e) {
      hideLoader();
      alert('Error al ejecutar conciliación: ' + e.message);
    }
  }
  ```

- [ ] **Step 2: Add setConciliFiltro and renderResultadosConciliacion**

  ```js
  function setConciliFiltro(filtro) {
    _conciliFiltro = filtro;
    renderResultadosConciliacion();
  }

  function renderResultadosConciliacion() {
    const r = _conciliResultado;
    const total    = r.length;
    const ok       = r.filter(x => x.estado_match === 'ok').length;
    const diff     = r.filter(x => x.estado_match === 'diferencia').length;
    const soloMio  = r.filter(x => x.estado_match === 'solo_propio').length;
    const soloSuyo = r.filter(x => x.estado_match === 'solo_externo').length;
    const incomp   = r.filter(x => x.estado_match === 'incompleto').length;

    // Summary cards
    document.getElementById('concili-cards').innerHTML = `
      <div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:14px;text-align:center;">
        <div style="font-size:22px;font-weight:800;color:var(--text);">${total}</div>
        <div style="font-size:11px;color:var(--muted);margin-top:4px;">Total procesados</div>
      </div>
      <div style="background:var(--green-dim,#002200);border:1px solid var(--green,#4caf50);border-radius:var(--radius);padding:14px;text-align:center;">
        <div style="font-size:22px;font-weight:800;color:var(--green,#4caf50);">${ok}</div>
        <div style="font-size:11px;color:var(--muted);margin-top:4px;">✅ Coincidencias</div>
      </div>
      <div style="background:var(--yellow-dim,#332200);border:1px solid var(--yellow,#f5a623);border-radius:var(--radius);padding:14px;text-align:center;">
        <div style="font-size:22px;font-weight:800;color:var(--yellow,#f5a623);">${diff}</div>
        <div style="font-size:11px;color:var(--muted);margin-top:4px;">⚠️ Diferencias</div>
      </div>
      <div style="background:var(--accent-dim);border:1px solid var(--accent);border-radius:var(--radius);padding:14px;text-align:center;">
        <div style="font-size:22px;font-weight:800;color:var(--accent);">${soloMio}</div>
        <div style="font-size:11px;color:var(--muted);margin-top:4px;">📋 Solo míos</div>
      </div>
      <div style="background:#220033;border:1px solid #cc44ff;border-radius:var(--radius);padding:14px;text-align:center;">
        <div style="font-size:22px;font-weight:800;color:#cc44ff;">${soloSuyo}</div>
        <div style="font-size:11px;color:var(--muted);margin-top:4px;">📋 Solo suyos</div>
      </div>`;

    // Filter rows
    const filas = _conciliFiltro === 'todos' ? r : r.filter(x => x.estado_match === _conciliFiltro);

    if (!filas.length) {
      document.getElementById('tabla-concili').innerHTML =
        '<div class="empty"><p>Sin registros para este filtro</p></div>';
      return;
    }

    const diffColor = (pct) => {
      if (pct === null || pct === undefined) return 'color:var(--muted)';
      return pct > 0.01 ? 'color:#ff4444;font-weight:700' : 'color:var(--green,#4caf50)';
    };
    const fmt = v => (v === null || v === undefined) ? '—' : Number(v).toLocaleString('es-MX');
    const fmtPct = v => (v === null || v === undefined) ? '—' : `${(v*100).toFixed(2)}%`;

    const statusBadge = {
      ok:           '<span class="badge b-green">✅ Ok</span>',
      diferencia:   '<span class="badge b-yellow">⚠️ Diferencia</span>',
      solo_propio:  '<span class="badge b-accent">Solo mío</span>',
      solo_externo: '<span style="background:#220033;border:1px solid #cc44ff;color:#cc44ff;padding:2px 8px;border-radius:20px;font-size:10px;font-weight:700;">Solo suyo</span>',
      incompleto:   '<span style="background:#330000;border:1px solid #cc0000;color:#ff6666;padding:2px 8px;border-radius:20px;font-size:10px;font-weight:700;">Incompleto</span>',
    };

    document.getElementById('tabla-concili').innerHTML = `
      <table style="width:100%;border-collapse:collapse;font-size:11px;">
        <thead>
          <tr style="background:var(--surface3);color:var(--muted);text-transform:uppercase;font-size:10px;letter-spacing:0.5px;">
            <th style="padding:8px 10px;text-align:left;">Estado</th>
            <th style="padding:8px 10px;text-align:left;">Folio</th>
            <th style="padding:8px 10px;">No.Eco Propio</th>
            <th style="padding:8px 10px;">No.Eco Externo</th>
            <th style="padding:8px 10px;">Bruto P.</th>
            <th style="padding:8px 10px;">Bruto E.</th>
            <th style="padding:8px 10px;">Δ%</th>
            <th style="padding:8px 10px;">Tara P.</th>
            <th style="padding:8px 10px;">Tara E.</th>
            <th style="padding:8px 10px;">Δ%</th>
            <th style="padding:8px 10px;">Neto P.</th>
            <th style="padding:8px 10px;">Neto E.</th>
            <th style="padding:8px 10px;">Δ%</th>
            <th style="padding:8px 10px;text-align:left;">Señalamiento</th>
          </tr>
        </thead>
        <tbody>
          ${filas.map(d => `
          <tr style="border-bottom:1px solid var(--border);">
            <td style="padding:8px 10px;">${statusBadge[d.estado_match] || d.estado_match}</td>
            <td style="padding:8px 10px;font-family:var(--font-mono);color:var(--accent);font-weight:700;">${d.folio}</td>
            <td style="padding:8px 10px;text-align:center;font-family:var(--font-mono);font-size:10px;">${d.num_eco_propio || '—'}</td>
            <td style="padding:8px 10px;text-align:center;font-family:var(--font-mono);font-size:10px;${d.diff_num_eco?'color:#ff4444;font-weight:700':''}">${d.num_eco_externo || '—'}</td>
            <td style="padding:8px 10px;text-align:right;">${fmt(d.bruto_propio)}</td>
            <td style="padding:8px 10px;text-align:right;">${fmt(d.bruto_externo)}</td>
            <td style="padding:8px 10px;text-align:right;${diffColor(d.diff_bruto_pct)}">${fmtPct(d.diff_bruto_pct)}</td>
            <td style="padding:8px 10px;text-align:right;">${fmt(d.tara_propia)}</td>
            <td style="padding:8px 10px;text-align:right;">${fmt(d.tara_externa)}</td>
            <td style="padding:8px 10px;text-align:right;${diffColor(d.diff_tara_pct)}">${fmtPct(d.diff_tara_pct)}</td>
            <td style="padding:8px 10px;text-align:right;">${fmt(d.neto_propio)}</td>
            <td style="padding:8px 10px;text-align:right;">${fmt(d.neto_externo)}</td>
            <td style="padding:8px 10px;text-align:right;${diffColor(d.diff_neto_pct)}">${fmtPct(d.diff_neto_pct)}</td>
            <td style="padding:8px 10px;max-width:200px;font-size:10px;color:var(--muted);">${d.señalamiento || ''}</td>
          </tr>`).join('')}
        </tbody>
      </table>`;
  }
  ```

- [ ] **Step 3: Start server and do a full end-to-end UI test**

  ```bash
  node server.js &
  sleep 2
  ```
  1. Log in as admin
  2. Go to Báscula → Conciliación
  3. Select a month
  4. In browser console, manually set `_conciliRows` to a test array:
     ```js
     _conciliRows = [
       { folio: '001', num_eco: 'CT-2898', peso_bruto: 12000, tara: 5000, peso_neto: 7000 },
       { folio: '999', num_eco: 'CT-2900', peso_bruto: 8000, tara: 3000, peso_neto: 5000 },
     ];
     document.getElementById('btn-ejecutar-concili').disabled = false;
     document.getElementById('btn-ejecutar-concili').style.opacity = '1';
     ```
  5. Click "Iniciar conciliación"
  6. Verify: summary cards appear, table renders with correct estado_match per row
  7. Verify filter buttons hide/show rows correctly

  ```bash
  pkill -f "node server.js" 2>/dev/null; true
  ```

- [ ] **Step 4: Commit**
  ```bash
  cd /Users/viverosmunoz/Desktop/pasa-sistema
  git add public/index.html
  git commit -m "feat(concili): add ejecutarConciliacion and renderResultadosConciliacion with filterable table"
  ```

---

## Task 7: Frontend JS — Save, Export, and Historial

**Files:**
- Modify: `public/index.html` — add final JS functions to `<script>` block

- [ ] **Step 1: Add guardarConciliacion**

  ```js
  // ─── Conciliación: guardar ─────────────────────────────────────────────────────
  async function guardarConciliacion() {
    if (!_conciliResultado.length) return;
    showLoader('Guardando conciliación…');
    try {
      const r = _conciliResultado;
      const ok       = r.filter(x => x.estado_match === 'ok').length;
      const diff     = r.filter(x => x.estado_match === 'diferencia').length;
      const soloMio  = r.filter(x => x.estado_match === 'solo_propio').length;
      const soloSuyo = r.filter(x => x.estado_match === 'solo_externo').length;

      const payload = {
        encabezado: {
          periodo:          _conciliPeriodo,
          archivo_nombre:   _conciliArchivo,
          total_propios:    r._totalPropios || 0,
          total_externos:   r._totalExternos || 0,
          total_ok:         ok,
          total_diff:       diff,
          total_solo_mios:  soloMio,
          total_solo_suyos: soloSuyo,
          datos_incompletos: r._incompleto ? 1 : 0,
        },
        detalle: r
      };
      await api('POST', '/conciliaciones', payload);
      hideLoader();
      alert('Conciliación guardada correctamente.');
      document.getElementById('btn-guardar-concili').disabled = true;
      document.getElementById('btn-guardar-concili').textContent = '✅ Guardada';
      cargarHistorialConciliaciones();
    } catch(e) {
      hideLoader();
      if (e.message && e.message.includes('409')) {
        if (confirm(`Ya existe una conciliación para ${_conciliPeriodo}. ¿Deseas eliminarla y reemplazarla?`)) {
          // Get existing id and delete it first
          const { data } = await api('GET', `/conciliaciones?periodo=${_conciliPeriodo}`);
          if (data && data.length) {
            await api('DELETE', `/conciliaciones/${data[0].id}`);
            guardarConciliacion(); // retry
          }
        }
      } else {
        alert('Error al guardar: ' + e.message);
      }
    }
  }
  ```

- [ ] **Step 2: Add exportarConciliacionExcel**

  ```js
  // ─── Conciliación: exportar Excel ─────────────────────────────────────────────
  function exportarConciliacionExcel() {
    if (!_conciliResultado.length) return;
    const r = _conciliResultado;
    const toSheet = (rows) => {
      if (!rows.length) return XLSX.utils.aoa_to_sheet([['Sin registros']]);
      const headers = ['Folio','No.Eco Propio','Bruto Propio','Tara Propia','Neto Propio',
                       'No.Eco Externo','Bruto Externo','Tara Externa','Neto Externo',
                       'Δ% Bruto','Δ% Tara','Δ% Neto','Señalamiento'];
      const data = rows.map(d => [
        d.folio, d.num_eco_propio, d.bruto_propio, d.tara_propia, d.neto_propio,
        d.num_eco_externo, d.bruto_externo, d.tara_externa, d.neto_externo,
        d.diff_bruto_pct != null ? +(d.diff_bruto_pct*100).toFixed(2) : null,
        d.diff_tara_pct  != null ? +(d.diff_tara_pct*100).toFixed(2)  : null,
        d.diff_neto_pct  != null ? +(d.diff_neto_pct*100).toFixed(2)  : null,
        d.señalamiento
      ]);
      return XLSX.utils.aoa_to_sheet([headers, ...data]);
    };
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, toSheet(r.filter(x=>x.estado_match==='ok')),           'Coincidencias');
    XLSX.utils.book_append_sheet(wb, toSheet(r.filter(x=>x.estado_match==='diferencia')),   'Diferencias');
    XLSX.utils.book_append_sheet(wb, toSheet(r.filter(x=>x.estado_match==='solo_propio')),  'Solo Mios');
    XLSX.utils.book_append_sheet(wb, toSheet(r.filter(x=>x.estado_match==='solo_externo')), 'Solo Suyos');
    XLSX.writeFile(wb, `Conciliacion_${_conciliPeriodo}.xlsx`);
  }
  ```

- [ ] **Step 3: Add exportarConciliacionPDF**

  ```js
  // ─── Conciliación: exportar PDF ───────────────────────────────────────────────
  function exportarConciliacionPDF() {
    if (!_conciliResultado.length) return;
    const r = _conciliResultado;
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'landscape', format: 'letter' });
    doc.setFont('helvetica','bold');
    doc.setFontSize(14);
    doc.text('DGSPM TORREÓN — Conciliación de Boletas', 14, 16);
    doc.setFont('helvetica','normal');
    doc.setFontSize(10);
    doc.text(`Periodo: ${_conciliPeriodo}    Archivo: ${_conciliArchivo}    Generado: ${new Date().toLocaleDateString('es-MX')}`, 14, 24);

    // Summary line
    const ok    = r.filter(x=>x.estado_match==='ok').length;
    const diff  = r.filter(x=>x.estado_match==='diferencia').length;
    const mios  = r.filter(x=>x.estado_match==='solo_propio').length;
    const suyo  = r.filter(x=>x.estado_match==='solo_externo').length;
    doc.text(`Total: ${r.length}  |  Coincidencias: ${ok}  |  Diferencias: ${diff}  |  Solo míos: ${mios}  |  Solo suyos: ${suyo}`, 14, 31);

    // Señalamientos table (only rows with issues)
    const senas = r.filter(x => x.estado_match !== 'ok');
    let y = 40;
    doc.setFont('helvetica','bold');
    doc.setFontSize(11);
    doc.text('Señalamientos', 14, y);
    y += 6;
    doc.setFont('helvetica','normal');
    doc.setFontSize(8);
    const colW = [30, 28, 28, 22, 22, 22, 22, 22, 22, 70];
    const heads = ['Estado','Folio','No.Eco P.','Bruto P.','Bruto E.','Δ%','Tara Δ%','Neto Δ%','No.Eco E.','Señalamiento'];
    // Header row
    doc.setFillColor(40,40,40);
    doc.rect(14, y, 262, 6, 'F');
    doc.setTextColor(200,200,200);
    let x = 14;
    heads.forEach((h,i) => { doc.text(h, x+1, y+4, {maxWidth: colW[i]-2}); x += colW[i]; });
    doc.setTextColor(0,0,0);
    y += 8;
    senas.forEach(d => {
      if (y > 185) { doc.addPage(); y = 14; }
      x = 14;
      const fmtP = v => v==null?'—':String(+(v*100).toFixed(1))+'%';
      const cells = [
        d.estado_match, d.folio, d.num_eco_propio||'—',
        d.bruto_propio??'—', d.bruto_externo??'—', fmtP(d.diff_bruto_pct),
        fmtP(d.diff_tara_pct), fmtP(d.diff_neto_pct), d.num_eco_externo||'—',
        d.señalamiento||''
      ];
      cells.forEach((c,i) => {
        doc.text(String(c), x+1, y+4, {maxWidth: colW[i]-2});
        x += colW[i];
      });
      doc.setDrawColor(80,80,80);
      doc.rect(14, y, 262, 6);
      y += 7;
    });
    doc.save(`Conciliacion_${_conciliPeriodo}_Señalamientos.pdf`);
  }
  ```

- [ ] **Step 4: Add historial functions (initConciliacion, cargarHistorialConciliaciones, verConciliacion, eliminarConciliacion)**

  ```js
  // ─── Conciliación: historial ──────────────────────────────────────────────────
  function initConciliacion() {
    cargarHistorialConciliaciones();
  }

  async function cargarHistorialConciliaciones() {
    const cont = document.getElementById('tabla-historial-concili');
    if (!cont) return;
    try {
      const { data } = await api('GET', '/conciliaciones');
      if (!data.length) {
        cont.innerHTML = '<div class="empty"><div class="empty-icon">📊</div><p>Sin conciliaciones guardadas</p></div>';
        return;
      }
      cont.innerHTML = `
        <table style="width:100%;border-collapse:collapse;font-size:12px;">
          <thead>
            <tr style="background:var(--surface3);color:var(--muted);text-transform:uppercase;font-size:10px;letter-spacing:0.5px;">
              <th style="padding:8px 10px;text-align:left;">Periodo</th>
              <th style="padding:8px 10px;text-align:left;">Archivo</th>
              <th style="padding:8px 10px;text-align:left;">Fecha</th>
              <th style="padding:8px 10px;text-align:center;">Ok</th>
              <th style="padding:8px 10px;text-align:center;">Diff</th>
              <th style="padding:8px 10px;text-align:center;">Solo míos</th>
              <th style="padding:8px 10px;text-align:center;">Solo suyos</th>
              <th style="padding:8px 10px;text-align:center;">Estado</th>
              <th style="padding:8px 10px;text-align:center;">Acciones</th>
            </tr>
          </thead>
          <tbody>
            ${data.map(c => `
            <tr style="border-bottom:1px solid var(--border);">
              <td style="padding:8px 10px;font-family:var(--font-mono);font-weight:700;color:var(--accent);">${c.periodo}</td>
              <td style="padding:8px 10px;font-size:11px;color:var(--muted);">${c.archivo_nombre || '—'}</td>
              <td style="padding:8px 10px;font-size:11px;">${c.fecha_carga ? c.fecha_carga.substring(0,16) : '—'}</td>
              <td style="padding:8px 10px;text-align:center;color:var(--green,#4caf50);font-weight:700;">${c.total_ok}</td>
              <td style="padding:8px 10px;text-align:center;color:var(--yellow,#f5a623);font-weight:700;">${c.total_diff}</td>
              <td style="padding:8px 10px;text-align:center;color:var(--accent);">${c.total_solo_mios}</td>
              <td style="padding:8px 10px;text-align:center;color:#cc44ff;">${c.total_solo_suyos}</td>
              <td style="padding:8px 10px;text-align:center;">
                ${c.estado === 'cerrada'
                  ? '<span class="badge b-green">Cerrada</span>'
                  : '<span class="badge" style="background:var(--surface3);color:var(--muted);">Abierta</span>'}
                ${c.datos_incompletos ? '<span style="color:#ff6666;font-size:10px;"> ⚠️parcial</span>' : ''}
              </td>
              <td style="padding:8px 10px;text-align:center;">
                <button class="btn btn-sm btn-outline" onclick="verConciliacion(${c.id})" style="margin-right:4px;">Ver</button>
                <button class="btn btn-sm" style="background:#330000;border:1px solid #cc0000;color:#ff6666;" onclick="eliminarConciliacion(${c.id},'${c.periodo}')">Eliminar</button>
              </td>
            </tr>`).join('')}
          </tbody>
        </table>`;
    } catch(e) {
      cont.innerHTML = '<div class="empty"><p>Error cargando historial</p></div>';
    }
  }

  async function verConciliacion(id) {
    showLoader('Cargando conciliación…');
    try {
      const data = await api('GET', `/conciliaciones/${id}`);
      _conciliResultado = data.detalle || [];
      _conciliResultado._totalPropios  = data.total_propios;
      _conciliResultado._totalExternos = data.total_externos;
      _conciliResultado._incompleto    = data.datos_incompletos;
      _conciliPeriodo  = data.periodo;
      _conciliArchivo  = data.archivo_nombre || '';
      hideLoader();
      document.getElementById('concili-resultados').style.display = '';
      document.getElementById('concili-aviso-incompleto').style.display = data.datos_incompletos ? '' : 'none';
      document.getElementById('concili-aviso-fecha').style.display = '';
      document.getElementById('concili-periodo').value = data.periodo;
      _conciliFiltro = 'todos';
      renderResultadosConciliacion();
      // Disable save (already saved)
      const btn = document.getElementById('btn-guardar-concili');
      btn.disabled = true;
      btn.textContent = '✅ Ya guardada';
    } catch(e) {
      hideLoader();
      alert('Error al cargar conciliación: ' + e.message);
    }
  }

  async function eliminarConciliacion(id, periodo) {
    if (!confirm(`¿Eliminar la conciliación de ${periodo}? Esta acción no se puede deshacer.`)) return;
    try {
      await api('DELETE', `/conciliaciones/${id}`);
      cargarHistorialConciliaciones();
    } catch(e) {
      alert('No se pudo eliminar: ' + e.message);
    }
  }
  ```

- [ ] **Step 5: Full end-to-end test**

  ```bash
  node server.js &
  sleep 2
  ```
  1. Log in as admin, go to Báscula → Conciliación
  2. Select current month, upload a small test XLSX file with columns: Folio, Eco, Bruto, Tara, Neto
  3. Click "Iniciar conciliación" — verify summary cards and table render
  4. Click "Guardar conciliación" — verify success message
  5. Verify conciliación appears in Historial table
  6. Click "Ver" in historial — verify results reload correctly
  7. Click "Exportar Excel" — verify file downloads with 4 sheets
  8. Click "Exportar PDF" — verify PDF downloads with señalamientos table
  9. Click "Eliminar" — verify historial updates

  ```bash
  sqlite3 /Users/viverosmunoz/Desktop/pasa-sistema/pasa.db \
    "SELECT id, periodo, total_ok, total_diff FROM conciliaciones;"
  ```
  Expected: 1 row with the saved conciliation.

  ```bash
  pkill -f "node server.js" 2>/dev/null; true
  ```

- [ ] **Step 6: Commit**
  ```bash
  cd /Users/viverosmunoz/Desktop/pasa-sistema
  git add public/index.html
  git commit -m "feat(concili): add save, Excel/PDF export, and historial (cargar/ver/eliminar)"
  ```

---

## Task 8: Final Polish + nav integration

**Files:**
- Modify: `public/index.html` — ensure nav handler calls initConciliacion on tab open

- [ ] **Step 1: Update nav handler for bascula tab**

  In the JS `nav()` handler (search for `if(name==='bascula')`), it currently calls `renderBoletasRecientes()`. Update it to also reset the sub-tab:

  Find:
  ```js
  if(name==='bascula')    renderBoletasRecientes();
  ```
  Replace with:
  ```js
  if(name==='bascula') { setBasculaTab('cap'); renderBoletasRecientes(); }
  ```

  This ensures the "Captura" sub-tab is always active when the user first enters the module.

- [ ] **Step 2: Start server and do final smoke test**

  ```bash
  node server.js &
  sleep 2
  ```
  1. Navigate to multiple modules and back to Báscula — verify it always opens on "Captura"
  2. Go to Conciliación — verify historial loads
  3. Verify no console errors on initial load
  4. Test on mobile viewport (if possible) — verify buttons wrap correctly

  ```bash
  pkill -f "node server.js" 2>/dev/null; true
  ```

- [ ] **Step 3: Final commit**
  ```bash
  cd /Users/viverosmunoz/Desktop/pasa-sistema
  git add public/index.html
  git commit -m "feat(concili): reset bascula to capture sub-tab on module nav; feature complete"
  ```

---

## Verification Checklist

Before declaring this feature complete, verify all of the following manually:

- [ ] Tables `conciliaciones` and `conciliacion_detalle` exist in `pasa.db` with correct schema
- [ ] `UNIQUE(periodo)` prevents duplicate conciliations for the same month (returns 409)
- [ ] DELETE returns 409 for `estado = 'cerrada'`
- [ ] ON DELETE CASCADE: deleting a conciliation also removes its detail rows
- [ ] XLSX upload with standard headers auto-detects columns (no modal)
- [ ] XLSX upload with non-standard headers shows the column-map modal
- [ ] PDF upload triggers lazy loading of pdf.js from CDN
- [ ] `pctDiff(0,0) = 0`, `pctDiff(0,5000) = 1`, `pctDiff(10000,10050) ≈ 0.005`
- [ ] ±1% tolerance: a 0.9% diff shows as "ok", a 1.1% diff shows as "diferencia"
- [ ] Summary cards show correct counts across all 5 categories
- [ ] Filter buttons correctly hide/show rows
- [ ] "Guardar conciliación" saves to DB and disables the button
- [ ] "Exportar Excel" produces a file with 4 sheets
- [ ] "Exportar PDF" produces a file with señalamientos table
- [ ] Historial table loads on tab open and after save
- [ ] "Ver" in historial restores full result view
- [ ] "Eliminar" in historial removes and refreshes
- [ ] Navigating away and back to Báscula resets to "Captura" sub-tab
