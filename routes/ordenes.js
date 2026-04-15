const express = require('express');
const router  = express.Router();
const db      = require('../db/database');

// ── Helper: siguiente folio OT-YYYYMMDD-NNN ──────────────────
async function siguienteFolio() {
  const hoy    = new Date().toLocaleDateString('en-CA').replace(/-/g, '');
  const prefix = `OT-${hoy}-`;
  const row    = await db.get_p(
    `SELECT folio FROM ordenes_trabajo WHERE folio LIKE ? ORDER BY id DESC LIMIT 1`,
    [`${prefix}%`]
  );
  const next = row ? parseInt(row.folio.split('-')[2]) + 1 : 1;
  return `${prefix}${String(next).padStart(3, '0')}`;
}

// GET /api/ordenes/siguiente-folio
router.get('/siguiente-folio', async (req, res) => {
  try { res.json({ folio: await siguienteFolio() }); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

// GET /api/ordenes — lista con filtros
router.get('/', async (req, res) => {
  try {
    const { q='', estado='', prioridad='', tipo='', dirigida_a='',
            fechaIni='', fechaFin='', page=1, limit=100 } = req.query;
    const off  = (parseInt(page)-1) * parseInt(limit);
    const like = `%${q}%`;
    let where  = `WHERE (folio LIKE ? OR descripcion LIKE ? OR dirigida_a LIKE ? OR colonia LIKE ?)`;
    let params = [like, like, like, like];
    if (estado)     { where += ' AND estado=?';     params.push(estado); }
    if (prioridad)  { where += ' AND prioridad=?';  params.push(prioridad); }
    if (tipo)       { where += ' AND tipo=?';        params.push(tipo); }
    if (dirigida_a) { where += ' AND dirigida_a=?'; params.push(dirigida_a); }
    if (fechaIni)   { where += ' AND fecha >= ?';   params.push(fechaIni); }
    if (fechaFin)   { where += ' AND fecha <= ?';   params.push(fechaFin); }
    const rows = await db.all_p(
      `SELECT * FROM ordenes_trabajo ${where} ORDER BY
         CASE prioridad WHEN 'URGENTE' THEN 1 WHEN 'ALTA' THEN 2 WHEN 'NORMAL' THEN 3 ELSE 4 END,
         fecha DESC, id DESC LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), off]
    );
    const { n: total } = await db.get_p(`SELECT COUNT(*) as n FROM ordenes_trabajo ${where}`, params);
    res.json({ data: rows, total });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// GET /api/ordenes/:id
router.get('/:id', async (req, res) => {
  try {
    const row = await db.get_p('SELECT * FROM ordenes_trabajo WHERE id=?', [req.params.id]);
    if (!row) return res.status(404).json({ error: 'No encontrada' });
    res.json(row);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// POST /api/ordenes — crear
router.post('/', async (req, res) => {
  try {
    const b = req.body;
    const folio = b.folio || await siguienteFolio();
    const hora  = b.hora || new Date().toLocaleTimeString('es-MX',{hour:'2-digit',minute:'2-digit',hour12:false});
    const result = await db.run_p(
      `INSERT INTO ordenes_trabajo
         (folio,fecha,hora,emitida_por,dirigida_a,tipo,prioridad,descripcion,
          zona,colonia,fecha_limite,estado)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [ folio,
        b.fecha || new Date().toLocaleDateString('en-CA'),
        hora,
        b.emitida_por || null,
        b.dirigida_a  || null,
        b.tipo        || null,
        b.prioridad   || 'NORMAL',
        b.descripcion || null,
        b.zona        || null,
        b.colonia     || null,
        b.fecha_limite || null,
        'PENDIENTE' ]
    );
    const created = await db.get_p('SELECT * FROM ordenes_trabajo WHERE id=?', [result.lastID]);
    res.status(201).json(created);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/ordenes/:id — editar (solo PENDIENTE)
router.put('/:id', async (req, res) => {
  try {
    const b = req.body;
    const r = await db.run_p(
      `UPDATE ordenes_trabajo SET
         fecha=?, hora=?, emitida_por=?, dirigida_a=?, tipo=?, prioridad=?,
         descripcion=?, zona=?, colonia=?, fecha_limite=?
       WHERE id=? AND estado='PENDIENTE'`,
      [ b.fecha||null, b.hora||null, b.emitida_por||null, b.dirigida_a||null,
        b.tipo||null, b.prioridad||'NORMAL', b.descripcion||null,
        b.zona||null, b.colonia||null, b.fecha_limite||null,
        req.params.id ]
    );
    if (r.changes === 0) return res.status(404).json({ error: 'No encontrada o ya no es editable' });
    const updated = await db.get_p('SELECT * FROM ordenes_trabajo WHERE id=?', [req.params.id]);
    res.json(updated);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// PATCH /api/ordenes/:id/atender — marcar como atendida, ligar a diario/supervisión
router.patch('/:id/atender', async (req, res) => {
  try {
    const { folio_diario='', folio_auditoria='', observaciones_cierre='' } = req.body;
    const hoy = new Date().toLocaleDateString('en-CA');
    const r = await db.run_p(
      `UPDATE ordenes_trabajo SET
         estado='ATENDIDA', fecha_atencion=?,
         folio_diario=?, folio_auditoria=?, observaciones_cierre=?
       WHERE id=?`,
      [hoy, folio_diario||null, folio_auditoria||null, observaciones_cierre||null, req.params.id]
    );
    if (r.changes === 0) return res.status(404).json({ error: 'No encontrada' });
    const updated = await db.get_p('SELECT * FROM ordenes_trabajo WHERE id=?', [req.params.id]);
    res.json(updated);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// PATCH /api/ordenes/:id/iniciar — pasar a EN_PROCESO
router.patch('/:id/iniciar', async (req, res) => {
  try {
    const r = await db.run_p(
      `UPDATE ordenes_trabajo SET estado='EN_PROCESO' WHERE id=? AND estado='PENDIENTE'`,
      [req.params.id]
    );
    if (r.changes === 0) return res.status(404).json({ error: 'No encontrada o ya en proceso' });
    const updated = await db.get_p('SELECT * FROM ordenes_trabajo WHERE id=?', [req.params.id]);
    res.json(updated);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// PATCH /api/ordenes/:id/cancelar
router.patch('/:id/cancelar', async (req, res) => {
  try {
    const { observaciones_cierre='' } = req.body;
    const r = await db.run_p(
      `UPDATE ordenes_trabajo SET estado='CANCELADA', observaciones_cierre=? WHERE id=?`,
      [observaciones_cierre||null, req.params.id]
    );
    if (r.changes === 0) return res.status(404).json({ error: 'No encontrada' });
    const updated = await db.get_p('SELECT * FROM ordenes_trabajo WHERE id=?', [req.params.id]);
    res.json(updated);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/ordenes/:id
router.delete('/:id', async (req, res) => {
  try {
    const r = await db.run_p('DELETE FROM ordenes_trabajo WHERE id=?', [req.params.id]);
    if (r.changes === 0) return res.status(404).json({ error: 'No encontrada' });
    res.json({ deleted: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
