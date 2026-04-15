const express = require('express');
const router  = express.Router();
const path    = require('path');
const multer  = require('multer');
const db      = require('../db/database');

const { UPLOADS_DIR } = require('../paths');
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename:    (req, file, cb) => cb(null, `diario_${Date.now()}_${file.fieldname}${path.extname(file.originalname)}`)
});
const upload = multer({ storage, limits: { fileSize: 15*1024*1024 } });

// GET /api/diario
router.get('/', async (req, res) => {
  try {
    const { q = '', page = 1, limit = 50, fechaIni = '', fechaFin = '' } = req.query;
    const off  = (parseInt(page)-1) * parseInt(limit);
    const like = `%${q}%`;
    let where = `WHERE (folio LIKE ? OR responsable LIKE ? OR servicio LIKE ? OR colonia LIKE ?)`;
    const params = [like, like, like, like];
    if (fechaIni) { where += ` AND fecha >= ?`; params.push(fechaIni); }
    if (fechaFin) { where += ` AND fecha <= ?`; params.push(fechaFin); }
    const rows = await db.all_p(
      `SELECT id,folio,fecha,hora,responsable,servicio,unidad,gps,colonia,calle,numero,
              actividades,observaciones,foto1,foto2,auditado,punto_tolva,created_at
       FROM diario ${where} ORDER BY fecha DESC, id DESC LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), off]
    );
    const { n: total } = await db.get_p(`SELECT COUNT(*) as n FROM diario ${where}`, params);
    res.json({ data: rows, total });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// GET /api/diario/siguiente-folio?servicio=Carga+Trasera
// Devuelve el siguiente folio consecutivo según el tipo de servicio
router.get('/siguiente-folio', async (req, res) => {
  try {
    const { servicio = '' } = req.query;
    const prefixMap = {
      'Tolvas':                'TOL',
      'Contenedores':          'CON',
      'Barrido Manual':        'BM',
      'Barrido Selectivo':     'BS',
      'Barrido Mecánico':      'BMEC',
      'Carga Trasera':         'CAR',
    };
    const pre = prefixMap[servicio] || 'GEN';
    const { n } = await db.get_p(
      'SELECT COUNT(*) as n FROM diario WHERE servicio = ?',
      [servicio]
    );
    const folio = `DLM/${pre}/${String(n + 1).padStart(4, '0')}`;
    res.json({ folio });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/diario/:id
router.get('/:id', async (req, res) => {
  try {
    const row = await db.get_p('SELECT * FROM diario WHERE id = ?', [req.params.id]);
    if (!row) return res.status(404).json({ error: 'No encontrado' });
    res.json(row);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// POST /api/diario
router.post('/', upload.fields([{name:'foto1',maxCount:1},{name:'foto2',maxCount:1}]), async (req, res) => {
  try {
    const b = req.body;
    const foto1 = req.files?.foto1?.[0]?.filename || null;
    const foto2 = req.files?.foto2?.[0]?.filename || null;
    const result = await db.run_p(
      `INSERT INTO diario (folio,fecha,hora,responsable,servicio,unidad,gps,colonia,calle,numero,actividades,observaciones,foto1,foto2,punto_tolva,origen_tipo,origen_folio)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [ b.folio, b.fecha||null, b.hora||null, b.responsable||null, b.servicio||null,
        b.unidad||null, b.gps||null, b.colonia||null, b.calle||null, b.numero||null,
        b.actividades||null, b.observaciones||null, foto1, foto2, b.punto_tolva||null,
        b.origen_tipo||null, b.origen_folio||null ]
    );
    const created = await db.get_p('SELECT * FROM diario WHERE id = ?', [result.lastID]);

    // Auto-cerrar Orden de Trabajo si este registro la cumple
    if (b.origen_tipo === 'orden' && b.origen_folio) {
      try {
        const ot = await db.get_p(
          `SELECT id FROM ordenes_trabajo WHERE folio = ? AND estado != 'ATENDIDA' AND estado != 'CANCELADA'`,
          [b.origen_folio]
        );
        if (ot) {
          const hoy = new Date().toLocaleDateString('en-CA');
          await db.run_p(
            `UPDATE ordenes_trabajo
             SET estado='ATENDIDA', fecha_atencion=?, folio_diario=?,
                 observaciones_cierre=COALESCE(observaciones_cierre, ?)
             WHERE id=?`,
            [hoy, created.folio, `Atendida mediante Diario ${created.folio}`, ot.id]
          );
        }
      } catch(_) { /* No interrumpir la respuesta si falla el auto-cierre */ }
    }

    res.status(201).json(created);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// PATCH /api/diario/:id/auditado  (alias legacy)
router.patch('/:id/auditado', async (req, res) => {
  try {
    const r = await db.run_p('UPDATE diario SET auditado=1 WHERE id=?', [req.params.id]);
    if (r.changes === 0) return res.status(404).json({ error: 'No encontrado' });
    res.json({ updated: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// PATCH /api/diario/:id/auditar  (nombre canónico del spec)
router.patch('/:id/auditar', async (req, res) => {
  try {
    const r = await db.run_p('UPDATE diario SET auditado=1 WHERE id=?', [req.params.id]);
    if (r.changes === 0) return res.status(404).json({ error: 'No encontrado' });
    res.json({ updated: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// GET /api/diario/export/csv
router.get('/export/csv', async (req, res) => {
  try {
    const { fechaIni='', fechaFin='' } = req.query;
    let where = 'WHERE 1=1';
    const params = [];
    if (fechaIni) { where += ' AND fecha >= ?'; params.push(fechaIni); }
    if (fechaFin) { where += ' AND fecha <= ?'; params.push(fechaFin); }
    const rows = await db.all_p(
      `SELECT folio,fecha,hora,responsable,servicio,unidad,colonia,calle,actividades,observaciones,auditado
       FROM diario ${where} ORDER BY fecha DESC, id DESC`,
      params
    );
    const headers = ['folio','fecha','hora','responsable','servicio','unidad','colonia','calle','actividades','observaciones','auditado'];
    const escape  = v => `"${String(v ?? '').replace(/"/g,'""')}"`;
    const csv     = [headers.join(','), ...rows.map(r => headers.map(h => escape(r[h])).join(','))].join('\r\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="diario-${fechaIni||'todo'}.csv"`);
    res.send('\uFEFF' + csv); // BOM para Excel
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/diario/:id
router.put('/:id', async (req, res) => {
  try {
    const b = req.body;
    const r = await db.run_p(
      `UPDATE diario SET fecha=?,hora=?,responsable=?,servicio=?,unidad=?,
         gps=?,colonia=?,calle=?,numero=?,actividades=?,observaciones=?,punto_tolva=?
       WHERE id=?`,
      [ b.fecha||null, b.hora||null, b.responsable||null, b.servicio||null,
        b.unidad||null, b.gps||null, b.colonia||null, b.calle||null, b.numero||null,
        b.actividades||null, b.observaciones||null, b.punto_tolva||null, req.params.id ]
    );
    if (r.changes === 0) return res.status(404).json({ error: 'No encontrado' });
    const updated = await db.get_p('SELECT * FROM diario WHERE id = ?', [req.params.id]);
    res.json(updated);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/diario/:id
router.delete('/:id', async (req, res) => {
  try {
    const r = await db.run_p('DELETE FROM diario WHERE id=?', [req.params.id]);
    if (r.changes === 0) return res.status(404).json({ error: 'No encontrado' });
    res.json({ deleted: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
