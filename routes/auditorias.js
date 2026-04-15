const express = require('express');
const router  = express.Router();
const db      = require('../db/database');
const multer  = require('multer');
const path    = require('path');

const { UPLOADS_DIR } = require('../paths');
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename:    (req, file, cb) => cb(null, `sup_${Date.now()}_${file.originalname.replace(/\s/g,'_')}`)
});
const upload = multer({ storage, limits: { fileSize: 15*1024*1024 } });

router.get('/siguiente-folio', async (req, res) => {
  try {
    const row = await db.get_p(`SELECT folio FROM auditorias ORDER BY id DESC LIMIT 1`);
    let next = 1;
    if (row) {
      const m = row.folio.match(/(\d+)$/);
      if (m) next = parseInt(m[1]) + 1;
    }
    res.json({ folio: `SUP/${String(next).padStart(4, '0')}` });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.get('/', async (req, res) => {
  try {
    const { q='', page=1, limit=50, fechaIni='', fechaFin='', verificado='', conCompromiso='' } = req.query;
    const off  = (parseInt(page)-1)*parseInt(limit);
    const like = `%${q}%`;
    let where = `WHERE (folio LIKE ? OR auditor LIKE ? OR zona LIKE ? OR veredicto LIKE ?)`;
    const params = [like,like,like,like];
    if (fechaIni) { where += ` AND fecha >= ?`; params.push(fechaIni); }
    if (fechaFin) { where += ` AND fecha <= ?`; params.push(fechaFin); }
    if (verificado !== '') { where += ` AND verificado=?`; params.push(parseInt(verificado)); }
    if (conCompromiso === '1') { where += ` AND compromiso IS NOT NULL AND compromiso != ''`; }
    const rows = await db.all_p(
      `SELECT id,folio,origen,folio_diario,folio_reporte,fecha,hora,turno,auditor,rep_pasa,zona,tipo_servicio,
              score,veredicto,hallazgos,acciones,plazo,riesgo,compromiso,plazo_verif,verificado,fecha_verif,num_eco,created_at
       FROM auditorias ${where} ORDER BY fecha DESC, id DESC LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), off]
    );
    const { n: total } = await db.get_p(`SELECT COUNT(*) as n FROM auditorias ${where}`, params);
    res.json({ data: rows, total });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.get('/:id', async (req, res) => {
  try {
    const row = await db.get_p('SELECT * FROM auditorias WHERE id=?', [req.params.id]);
    if (!row) return res.status(404).json({ error: 'No encontrado' });
    try { row.rubros     = JSON.parse(row.rubros_json     || '[]'); } catch { row.rubros = []; }
    try { row.respuestas = JSON.parse(row.respuestas_json || '{}'); } catch { row.respuestas = {}; }
    res.json(row);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/', upload.fields([{name:'foto1',maxCount:1},{name:'foto2',maxCount:1}]), async (req, res) => {
  try {
    const b = req.body;
    const foto1 = req.files?.foto1?.[0]?.filename || null;
    const foto2 = req.files?.foto2?.[0]?.filename || null;
    const result = await db.run_p(
      `INSERT INTO auditorias (folio,origen,folio_diario,folio_reporte,fecha,hora,turno,auditor,rep_pasa,zona,tipo_servicio,
         score,veredicto,hallazgos,acciones,plazo,riesgo,rubros_json,respuestas_json,foto1,foto2,
         compromiso,plazo_verif,num_eco)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [ b.folio, b.origen||'independiente', b.folioDiario||null, b.folioReporte||null,
        b.fecha||null, b.hora||null, b.turno||null,
        b.auditor||null, b.repPasa||null, b.zona||null, b.tipoServicio||null,
        b.score!=null ? parseFloat(b.score) : null, b.veredicto||null,
        b.hallazgos||null, b.acciones||null, b.plazo||null, b.riesgo||null,
        typeof b.rubrosResult==='string' ? b.rubrosResult : JSON.stringify(b.rubrosResult||[]),
        typeof b.respuestas==='string'   ? b.respuestas   : JSON.stringify(b.respuestas||{}),
        foto1, foto2,
        b.compromiso||null, b.plazoVerif||null, b.numEco||null ]
    );
    // Marcar diario como supervisado si viene folioDiario
    if (b.folioDiario) {
      await db.run_p('UPDATE diario SET auditado=1 WHERE folio=?', [b.folioDiario]);
    }
    // Auto-crear penalidad si veredicto es Incumplimiento (score < 70%)
    const veredictoFinal = b.veredicto || '';
    if (veredictoFinal.toLowerCase() === 'incumplimiento') {
      try {
        const folioRow = await db.get_p(`SELECT folio FROM penalidades ORDER BY id DESC LIMIT 1`);
        const nextNum  = folioRow ? parseInt(folioRow.folio.split('/')[2]) + 1 : 1;
        const penFolio = `DLM/PEN/${String(nextNum).padStart(4,'0')}`;
        const hoy      = (b.fecha || new Date().toLocaleDateString('en-CA'));
        await db.run_p(
          `INSERT INTO penalidades (folio,fecha,tipo,descripcion,umas,estado,folio_ref)
           VALUES (?,?,?,?,?,?,?)`,
          [ penFolio, hoy, 'AUDITORIA',
            `Incumplimiento detectado en supervisión ${b.folio||''} — Score: ${b.score ?? '?'}%`,
            20, 'DETECTADO', b.folio||null ]
        );
      } catch(_) { /* No interrumpir la respuesta si falla la penalidad */ }
    }
    const created = await db.get_p('SELECT * FROM auditorias WHERE id=?', [result.lastID]);
    res.status(201).json(created);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// PATCH /api/auditorias/:id/verificar — marcar compromiso como verificado
router.patch('/:id/verificar', async (req, res) => {
  try {
    const { obs_verif, fecha_verif } = req.body;
    const hoy = new Date().toLocaleDateString('en-CA');
    const r = await db.run_p(
      `UPDATE auditorias SET verificado=1, fecha_verif=?, obs_verif=? WHERE id=?`,
      [fecha_verif || hoy, obs_verif || '', req.params.id]
    );
    if (r.changes === 0) return res.status(404).json({ error: 'No encontrado' });
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.delete('/:id', async (req, res) => {
  try {
    const r = await db.run_p('DELETE FROM auditorias WHERE id=?', [req.params.id]);
    if (r.changes === 0) return res.status(404).json({ error: 'No encontrado' });
    res.json({ deleted: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
