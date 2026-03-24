const express = require('express');
const router  = express.Router();
const db      = require('../db/database');

function parseReunion(r) {
  try { r.actas = JSON.parse(r.actas_json || '[]'); } catch { r.actas = []; }
  return r;
}

router.get('/', async (req, res) => {
  try {
    const rows = await db.all_p('SELECT * FROM reuniones ORDER BY id DESC');
    res.json(rows.map(parseReunion));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.get('/:id', async (req, res) => {
  try {
    const row = await db.get_p('SELECT * FROM reuniones WHERE id=?', [req.params.id]);
    if (!row) return res.status(404).json({ error: 'No encontrado' });
    res.json(parseReunion(row));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/', async (req, res) => {
  try {
    const b = req.body;
    // Actualizar actas: Dictaminada (con UMAs) o Improcedente (0 UMAs)
    if (Array.isArray(b.actas)) {
      for (const a of b.actas) {
        const umas = a.umasDictaminadas || 0;
        const nuevoEstado = umas > 0 ? 'Dictaminada' : 'Improcedente';
        await db.run_p('UPDATE actas SET estado=?, umas=? WHERE id=?',
          [nuevoEstado, umas, a.id]);
      }
    }
    const result = await db.run_p(
      `INSERT INTO reuniones (fecha,hora,lugar,participantes,observaciones,actas_json)
       VALUES (?,?,?,?,?,?)`,
      [ b.fecha||null, b.hora||null, b.lugar||null, b.participantes||null,
        b.observaciones||null, JSON.stringify(b.actas||[]) ]
    );
    const created = await db.get_p('SELECT * FROM reuniones WHERE id=?', [result.lastID]);
    res.status(201).json(parseReunion(created));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
