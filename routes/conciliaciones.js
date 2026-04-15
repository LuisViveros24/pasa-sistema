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
         diff_num_eco,diff_bruto_pct,diff_tara_pct,diff_neto_pct,senalamiento)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`;
      for (const d of detalle) {
        await db.run_p(stmt, [
          cid, d.folio || null, d.estado_match || null,
          d.num_eco_propio || null, d.bruto_propio ?? null, d.tara_propia ?? null, d.neto_propio ?? null,
          d.num_eco_externo || null, d.bruto_externo ?? null, d.tara_externa ?? null, d.neto_externo ?? null,
          d.diff_num_eco ? 1 : 0, d.diff_bruto_pct ?? null, d.diff_tara_pct ?? null, d.diff_neto_pct ?? null,
          d.senalamiento || null
        ]);
      }
    }

    const created = await db.get_p('SELECT * FROM conciliaciones WHERE id = ?', [cid]);
    res.status(201).json(created);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// PATCH /api/conciliaciones/:id/cerrar
router.patch('/:id/cerrar', async (req, res) => {
  try {
    const r = await db.run_p(
      `UPDATE conciliaciones SET estado='cerrada' WHERE id=?`,
      [req.params.id]
    );
    if (r.changes === 0) return res.status(404).json({ error: 'No encontrada' });
    const updated = await db.get_p('SELECT * FROM conciliaciones WHERE id=?', [req.params.id]);
    res.json(updated);
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
