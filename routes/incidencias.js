const express = require('express');
const router  = express.Router();
const path    = require('path');
const multer  = require('multer');
const db      = require('../db/database');
const { UPLOADS_DIR } = require('../paths');

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename:    (req, file, cb) => cb(null, `inc_${Date.now()}_${file.fieldname}${path.extname(file.originalname)}`)
});
const upload = multer({ storage, limits: { fileSize: 15 * 1024 * 1024 } });

// ── Helpers ────────────────────────────────────────────────────
async function generarFolio() {
  const año = new Date().getFullYear();
  const row = await db.get_p(
    `SELECT MAX(CAST(SUBSTR(folio, 10) AS INTEGER)) as max_n
     FROM incidencias WHERE folio LIKE ?`,
    [`INC/${año}/%`]
  );
  const n = String((row.max_n || 0) + 1).padStart(4, '0');
  return `INC/${año}/${n}`;
}

// ── GET /api/incidencias ───────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const { q, fecha_ini, fecha_fin } = req.query;
    let sql = `SELECT * FROM incidencias WHERE 1=1`;
    const params = [];
    if (q)         { sql += ` AND (descripcion LIKE ? OR reportado_por LIKE ? OR folio LIKE ?)`; params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
    if (fecha_ini) { sql += ` AND fecha >= ?`; params.push(fecha_ini); }
    if (fecha_fin) { sql += ` AND fecha <= ?`; params.push(fecha_fin); }
    sql += ` ORDER BY id DESC`;
    const rows = await db.all_p(sql, params);
    rows.forEach(r => { try { r.fotos = JSON.parse(r.fotos_json || '[]'); } catch { r.fotos = []; } });
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── GET /api/incidencias/sugerencias  (DEBE IR ANTES DE /:id) ──
router.get('/sugerencias', async (req, res) => {
  try {
    const { q = '' } = req.query;
    const rows = await db.all_p(
      `SELECT DISTINCT descripcion FROM incidencias
       WHERE descripcion LIKE ?
       ORDER BY id DESC LIMIT 10`,
      [`%${q}%`]
    );
    res.json(rows.map(r => r.descripcion));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── POST /api/incidencias ──────────────────────────────────────
router.post('/', upload.array('fotos', 2), async (req, res) => {
  try {
    const { fecha, hora, reportado_por, descripcion, lat, lng } = req.body;
    if (!fecha || !hora || !reportado_por || !descripcion) {
      return res.status(400).json({ error: 'Campos obligatorios: fecha, hora, reportado_por, descripcion' });
    }
    const folio = await generarFolio();
    const fotos = (req.files || []).map(f => `/uploads/${f.filename}`);
    await db.run_p(
      `INSERT INTO incidencias (folio, fecha, hora, reportado_por, descripcion, lat, lng, fotos_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [folio, fecha, hora, reportado_por, descripcion, lat || null, lng || null, JSON.stringify(fotos)]
    );
    res.status(201).json({ folio });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── DELETE /api/incidencias/:id ────────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    await db.run_p(`DELETE FROM incidencias WHERE id = ?`, [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
