const express = require('express');
const router  = express.Router();
const db      = require('../db/database');

// GET /api/rutas — lista con filtros opcionales
router.get('/', async (req, res) => {
  try {
    const { q='', zona='', ruta='', dias='', responsable='', turno='' } = req.query;
    const where = [];
    const params = [];

    if (q) {
      where.push('(colonia LIKE ? OR CAST(ruta AS TEXT) LIKE ? OR num_unidad LIKE ? OR responsable LIKE ?)');
      params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
    }
    if (zona)         { where.push('zona=?');              params.push(zona); }
    if (ruta)         { where.push('ruta=?');              params.push(Number(ruta)); }
    if (dias)         { where.push('dias LIKE ?');         params.push(`%${dias}%`); }
    if (responsable)  { where.push('responsable=?');       params.push(responsable); }
    if (turno)        { where.push('turno=?');             params.push(turno); }

    const sql = `SELECT * FROM rutas ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ruta, colonia`;
    const rows = await db.all_p(sql, params);
    res.json({ data: rows, total: rows.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/rutas/colonias — catálogo único de colonias para autocompletado global
router.get('/colonias', async (req, res) => {
  try {
    const rows = await db.all_p(
      `SELECT DISTINCT colonia FROM rutas WHERE colonia IS NOT NULL AND colonia != '' ORDER BY colonia`
    );
    res.json(rows.map(r => r.colonia));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/rutas/hoy — rutas programadas para el día de hoy
router.get('/hoy', async (req, res) => {
  try {
    const dias = ['domingo','lunes','martes','miércoles','jueves','viernes','sábado'];
    const hoy  = dias[new Date().getDay()];
    const rows = await db.all_p(
      `SELECT * FROM rutas WHERE LOWER(dias) LIKE ? ORDER BY ruta, colonia`,
      [`%${hoy}%`]
    );
    res.json({ data: rows, total: rows.length, dia: hoy });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/rutas/stats
router.get('/stats', async (req, res) => {
  try {
    const total       = await db.get_p('SELECT COUNT(*) as n FROM rutas');
    const rutasCnt    = await db.get_p('SELECT COUNT(DISTINCT ruta) as n FROM rutas');
    const unidades    = await db.get_p('SELECT COUNT(DISTINCT num_unidad) as n FROM rutas WHERE num_unidad IS NOT NULL AND num_unidad != ""');
    const zonas       = await db.all_p('SELECT zona, COUNT(*) as n FROM rutas GROUP BY zona ORDER BY n DESC');
    const responsables= await db.all_p('SELECT responsable, COUNT(DISTINCT ruta) as rutas, COUNT(*) as colonias FROM rutas WHERE responsable IS NOT NULL GROUP BY responsable ORDER BY responsable');
    res.json({ total_colonias: total.n, total_rutas: rutasCnt.n, total_unidades: unidades.n, por_zona: zonas, por_responsable: responsables });
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
    const { ruta, num_unidad, colonia, dias, horarios, zona, responsable, turno } = req.body;
    if (!colonia) return res.status(400).json({ error: 'La colonia es requerida' });
    const r = await db.run_p(
      `INSERT INTO rutas (ruta, num_unidad, colonia, dias, horarios, zona, responsable, turno) VALUES (?,?,?,?,?,?,?,?)`,
      [ruta || null, (num_unidad || '').toUpperCase() || null, colonia.trim(),
       dias || null, horarios || null, (zona || '').toUpperCase() || null,
       responsable || null, turno || null]
    );
    const row = await db.get_p('SELECT * FROM rutas WHERE id=?', [r.lastID]);
    res.status(201).json(row);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/rutas/importar — carga masiva
router.post('/importar', async (req, res) => {
  try {
    const { registros, reemplazar = true } = req.body;
    if (!Array.isArray(registros) || registros.length === 0)
      return res.status(400).json({ error: 'No se recibieron registros' });

    if (reemplazar) await db.run_p('DELETE FROM rutas');

    let insertados = 0;
    for (const r of registros) {
      await db.run_p(
        `INSERT INTO rutas (ruta, num_unidad, colonia, dias, horarios, zona, responsable, turno) VALUES (?,?,?,?,?,?,?,?)`,
        [
          r.ruta != null && r.ruta !== '' ? Number(r.ruta) : null,
          r.num_unidad ? String(r.num_unidad).trim().toUpperCase() : null,
          String(r.colonia || '').trim(),
          r.dias        ? String(r.dias).trim()        : null,
          r.horarios    ? String(r.horarios).trim()    : null,
          r.zona        ? String(r.zona).trim().toUpperCase() : null,
          r.responsable ? String(r.responsable).trim() : null,
          r.turno       ? String(r.turno).trim()       : null,
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
    const { ruta, num_unidad, colonia, dias, horarios, zona, responsable, turno } = req.body;
    const r = await db.run_p(
      `UPDATE rutas SET ruta=?, num_unidad=?, colonia=?, dias=?, horarios=?, zona=?, responsable=?, turno=? WHERE id=?`,
      [ruta || null, (num_unidad || '').toUpperCase() || null, colonia,
       dias || null, horarios || null, (zona || '').toUpperCase() || null,
       responsable || null, turno || null, req.params.id]
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
