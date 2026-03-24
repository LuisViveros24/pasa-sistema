const express = require('express');
const router  = express.Router();
const db      = require('../db/database');

// ── Siguiente folio ───────────────────────────────────────────
router.get('/siguiente-folio', async (req, res) => {
  try {
    const row  = await db.get_p(`SELECT folio FROM penalidades ORDER BY id DESC LIMIT 1`);
    const next = row ? parseInt(row.folio.split('/')[2]) + 1 : 1;
    res.json({ folio: `DLM/PEN/${String(next).padStart(4, '0')}` });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Listar penalidades ────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const { q='', tipo='', estado='', page=1, limit=200 } = req.query;
    const off  = (parseInt(page)-1) * parseInt(limit);
    const like = `%${q}%`;
    let where  = `WHERE (folio LIKE ? OR descripcion LIKE ? OR folio_ref LIKE ?)`;
    let params = [like, like, like];
    if (tipo)   { where += ' AND tipo=?';   params.push(tipo); }
    if (estado) { where += ' AND estado=?'; params.push(estado); }
    const rows = await db.all_p(
      `SELECT * FROM penalidades ${where} ORDER BY id DESC LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), off]
    );
    const { n: total } = await db.get_p(`SELECT COUNT(*) as n FROM penalidades ${where}`, params);
    res.json({ data: rows, total });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Una penalidad por ID ──────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const row = await db.get_p('SELECT * FROM penalidades WHERE id=?', [req.params.id]);
    if (!row) return res.status(404).json({ error: 'No encontrada' });
    res.json(row);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Crear penalidad ───────────────────────────────────────────
router.post('/', async (req, res) => {
  try {
    const b = req.body;
    // Calcular plazo de respuesta automático: fecha_notificacion + 10 días hábiles (~14 días)
    let plazo = b.plazo_respuesta || null;
    if (!plazo && b.fecha_notificacion) {
      const d = new Date(b.fecha_notificacion);
      d.setDate(d.getDate() + 14);
      plazo = d.toISOString().split('T')[0];
    }
    const result = await db.run_p(
      `INSERT INTO penalidades
         (folio,fecha,tipo,descripcion,umas,estado,fecha_notificacion,plazo_respuesta,folio_ref)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [ b.folio, b.fecha, b.tipo, b.descripcion,
        parseFloat(b.umas)||0,
        b.estado||'notificada',
        b.fecha_notificacion||null,
        plazo,
        b.folio_ref||null ]
    );
    const created = await db.get_p('SELECT * FROM penalidades WHERE id=?', [result.lastID]);
    res.status(201).json(created);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Actualizar penalidad ──────────────────────────────────────
router.put('/:id', async (req, res) => {
  try {
    const b = req.body;
    const r = await db.run_p(
      `UPDATE penalidades SET
         fecha=?, tipo=?, descripcion=?, umas=?, estado=?,
         fecha_notificacion=?, plazo_respuesta=?,
         respuesta=?, fecha_respuesta=?,
         determinacion=?, fecha_determinacion=?,
         fecha_pago=?, folio_ref=?
       WHERE id=?`,
      [ b.fecha, b.tipo, b.descripcion,
        parseFloat(b.umas)||0, b.estado,
        b.fecha_notificacion||null, b.plazo_respuesta||null,
        b.respuesta||null, b.fecha_respuesta||null,
        b.determinacion||null, b.fecha_determinacion||null,
        b.fecha_pago||null, b.folio_ref||null,
        req.params.id ]
    );
    if (r.changes === 0) return res.status(404).json({ error: 'No encontrada' });
    const updated = await db.get_p('SELECT * FROM penalidades WHERE id=?', [req.params.id]);
    res.json(updated);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Eliminar penalidad ────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    const r = await db.run_p('DELETE FROM penalidades WHERE id=?', [req.params.id]);
    if (r.changes === 0) return res.status(404).json({ error: 'No encontrada' });
    res.json({ deleted: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
