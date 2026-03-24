const express = require('express');
const router  = express.Router();
const db      = require('../db/database');

// ── Listar ────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const { q='', tipo='', frecuencia='', estado='', page=1, limit=200 } = req.query;
    const off  = (parseInt(page)-1) * parseInt(limit);
    const like = `%${q}%`;
    let where  = `WHERE (folio LIKE ? OR punto_servicio LIKE ? OR ubicacion LIKE ?)`;
    let params = [like, like, like];
    if (tipo)       { where += ' AND tipo=?';             params.push(tipo); }
    if (frecuencia) { where += ' AND UPPER(frecuencia)=?'; params.push(frecuencia.toUpperCase()); }
    if (estado)     { where += ' AND estado=?';           params.push(estado); }
    const rows = await db.all_p(
      `SELECT * FROM tolvas ${where} ORDER BY CAST(folio AS INTEGER) LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), off]
    );
    const { n: total } = await db.get_p(`SELECT COUNT(*) as n FROM tolvas ${where}`, params);
    res.json({ data: rows, total });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Siguiente folio ───────────────────────────────────────────
router.get('/siguiente-folio', async (req, res) => {
  try {
    const row  = await db.get_p(`SELECT folio FROM tolvas ORDER BY CAST(folio AS INTEGER) DESC LIMIT 1`);
    const next = row ? parseInt(row.folio) + 1 : 1;
    res.json({ folio: String(next).padStart(3, '0') });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Un registro ───────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const row = await db.get_p('SELECT * FROM tolvas WHERE id=?', [req.params.id]);
    if (!row) return res.status(404).json({ error: 'No encontrado' });
    res.json(row);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Crear ─────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  try {
    const b = req.body;
    let folio = b.folio;
    if (!folio) {
      const row  = await db.get_p(`SELECT folio FROM tolvas ORDER BY CAST(folio AS INTEGER) DESC LIMIT 1`);
      const next = row ? parseInt(row.folio) + 1 : 1;
      folio = String(next).padStart(3, '0');
    }
    const result = await db.run_p(
      `INSERT INTO tolvas (folio,tipo,frecuencia,equipo,cantidad,punto_servicio,ubicacion,observaciones,estado)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [folio, b.tipo, b.frecuencia, b.equipo, parseInt(b.cantidad)||1,
       b.punto_servicio, b.ubicacion||null, b.observaciones||null, b.estado||'activo']
    );
    const created = await db.get_p('SELECT * FROM tolvas WHERE id=?', [result.lastID]);
    res.status(201).json(created);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Actualizar ────────────────────────────────────────────────
router.put('/:id', async (req, res) => {
  try {
    const b = req.body;
    const r = await db.run_p(
      `UPDATE tolvas SET tipo=?,frecuencia=?,equipo=?,cantidad=?,punto_servicio=?,ubicacion=?,observaciones=?,estado=? WHERE id=?`,
      [b.tipo, b.frecuencia, b.equipo, parseInt(b.cantidad)||1,
       b.punto_servicio, b.ubicacion||null, b.observaciones||null, b.estado||'activo', req.params.id]
    );
    if (r.changes === 0) return res.status(404).json({ error: 'No encontrado' });
    const updated = await db.get_p('SELECT * FROM tolvas WHERE id=?', [req.params.id]);
    res.json(updated);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Eliminar ──────────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    const r = await db.run_p('DELETE FROM tolvas WHERE id=?', [req.params.id]);
    if (r.changes === 0) return res.status(404).json({ error: 'No encontrado' });
    res.json({ deleted: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
