const express = require('express');
const router  = express.Router();
const db      = require('../db/database');

// GET /api/rutas — lista con filtros opcionales
router.get('/', async (req, res) => {
  try {
    const { q='', zona='', ruta='', dias='' } = req.query;
    const where = [];
    const params = [];

    if (q) {
      where.push('(colonia LIKE ? OR CAST(ruta AS TEXT) LIKE ? OR num_unidad LIKE ?)');
      params.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }
    if (zona) { where.push('zona=?');  params.push(zona); }
    if (ruta) { where.push('ruta=?');  params.push(Number(ruta)); }
    if (dias) { where.push('dias LIKE ?'); params.push(`%${dias}%`); }

    const sql = `SELECT * FROM rutas ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ruta, colonia`;
    const rows = await db.all_p(sql, params);
    res.json({ data: rows, total: rows.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/rutas/stats — estadísticas de cobertura
router.get('/stats', async (req, res) => {
  try {
    const total    = await db.get_p('SELECT COUNT(*) as n FROM rutas');
    const rutasCnt = await db.get_p('SELECT COUNT(DISTINCT ruta) as n FROM rutas');
    const unidades = await db.get_p('SELECT COUNT(DISTINCT num_unidad) as n FROM rutas WHERE num_unidad IS NOT NULL AND num_unidad != ""');
    const zonas    = await db.all_p('SELECT zona, COUNT(*) as n FROM rutas GROUP BY zona ORDER BY n DESC');
    res.json({ total_colonias: total.n, total_rutas: rutasCnt.n, total_unidades: unidades.n, por_zona: zonas });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/rutas/:id
router.get('/:id', async (req, res) => {
  try {
    const row = await db.get_p('SELECT * FROM rutas WHERE id=?', [req.params.id]);
    if (!row) return res.status(404).json({ error: 'No encontrado' });
    res.json(row);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/rutas — crear registro individual
router.post('/', async (req, res) => {
  try {
    const { ruta, num_unidad, colonia, dias, horarios, zona } = req.body;
    if (!colonia) return res.status(400).json({ error: 'La colonia es requerida' });
    const r = await db.run_p(
      `INSERT INTO rutas (ruta, num_unidad, colonia, dias, horarios, zona) VALUES (?,?,?,?,?,?)`,
      [ruta || null, (num_unidad || '').toUpperCase() || null, colonia.trim(), dias || null, horarios || null, (zona || '').toUpperCase() || null]
    );
    const row = await db.get_p('SELECT * FROM rutas WHERE id=?', [r.lastID]);
    res.status(201).json(row);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/rutas/importar — carga masiva desde frontend (JSON parseado del XLSX)
router.post('/importar', async (req, res) => {
  try {
    const { registros, reemplazar = true } = req.body;
    if (!Array.isArray(registros) || registros.length === 0) {
      return res.status(400).json({ error: 'No se recibieron registros' });
    }

    if (reemplazar) {
      await db.run_p('DELETE FROM rutas');
    }

    let insertados = 0;
    for (const r of registros) {
      await db.run_p(
        `INSERT INTO rutas (ruta, num_unidad, colonia, dias, horarios, zona) VALUES (?,?,?,?,?,?)`,
        [
          r.ruta !== '' && r.ruta != null ? Number(r.ruta) : null,
          r.num_unidad ? String(r.num_unidad).trim().toUpperCase() : null,
          String(r.colonia || '').trim(),
          r.dias     ? String(r.dias).trim()     : null,
          r.horarios ? String(r.horarios).trim() : null,
          r.zona     ? String(r.zona).trim().toUpperCase() : null,
        ]
      );
      insertados++;
    }
    res.json({ ok: true, insertados });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/rutas/:id — actualizar
router.put('/:id', async (req, res) => {
  try {
    const { ruta, num_unidad, colonia, dias, horarios, zona } = req.body;
    const r = await db.run_p(
      `UPDATE rutas SET ruta=?, num_unidad=?, colonia=?, dias=?, horarios=?, zona=? WHERE id=?`,
      [ruta || null, (num_unidad || '').toUpperCase() || null, colonia, dias || null, horarios || null, (zona || '').toUpperCase() || null, req.params.id]
    );
    if (r.changes === 0) return res.status(404).json({ error: 'No encontrado' });
    const row = await db.get_p('SELECT * FROM rutas WHERE id=?', [req.params.id]);
    res.json(row);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/rutas/:id
router.delete('/:id', async (req, res) => {
  try {
    const r = await db.run_p('DELETE FROM rutas WHERE id=?', [req.params.id]);
    if (r.changes === 0) return res.status(404).json({ error: 'No encontrado' });
    res.json({ deleted: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
