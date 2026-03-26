const express = require('express');
const router  = express.Router();
const db      = require('../db/database');

// Listar
router.get('/', async (req, res) => {
  try {
    const { q = '', page = 1, limit = 200 } = req.query;
    const off  = (parseInt(page) - 1) * parseInt(limit);
    const like = `%${q}%`;
    const rows = await db.all_p(
      `SELECT * FROM lista_negra WHERE responsable LIKE ? OR colonia LIKE ? OR unidad LIKE ? OR infraccion LIKE ?
       ORDER BY id DESC LIMIT ? OFFSET ?`,
      [like, like, like, like, parseInt(limit), off]
    );
    const { n: total } = await db.get_p(
      `SELECT COUNT(*) as n FROM lista_negra WHERE responsable LIKE ? OR colonia LIKE ? OR unidad LIKE ? OR infraccion LIKE ?`,
      [like, like, like, like]
    );
    res.json({ data: rows, total });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Reporte resumen (responsable + conteo)
router.get('/resumen', async (req, res) => {
  try {
    const rows = await db.all_p(
      `SELECT responsable, COUNT(*) as total FROM lista_negra GROUP BY UPPER(responsable) ORDER BY total DESC`
    );
    res.json(rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Crear
router.post('/', async (req, res) => {
  try {
    const { fecha, colonia, unidad, infraccion, responsable, observacion } = req.body;
    const result = await db.run_p(
      `INSERT INTO lista_negra (fecha,colonia,unidad,infraccion,responsable,observacion) VALUES (?,?,?,?,?,?)`,
      [fecha||null, colonia||null, unidad||null, infraccion||null, responsable||null, observacion||null]
    );
    const created = await db.get_p('SELECT * FROM lista_negra WHERE id=?', [result.lastID]);
    res.status(201).json(created);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Actualizar
router.put('/:id', async (req, res) => {
  try {
    const { fecha, colonia, unidad, infraccion, responsable, observacion } = req.body;
    const r = await db.run_p(
      `UPDATE lista_negra SET fecha=?,colonia=?,unidad=?,infraccion=?,responsable=?,observacion=? WHERE id=?`,
      [fecha||null, colonia||null, unidad||null, infraccion||null, responsable||null, observacion||null, req.params.id]
    );
    if (r.changes === 0) return res.status(404).json({ error: 'No encontrado' });
    const updated = await db.get_p('SELECT * FROM lista_negra WHERE id=?', [req.params.id]);
    res.json(updated);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Eliminar
router.delete('/:id', async (req, res) => {
  try {
    const r = await db.run_p('DELETE FROM lista_negra WHERE id=?', [req.params.id]);
    if (r.changes === 0) return res.status(404).json({ error: 'No encontrado' });
    res.json({ deleted: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
