const express = require('express');
const router  = express.Router();
const path    = require('path');
const multer  = require('multer');
const db      = require('../db/database');

const { UPLOADS_DIR } = require('../paths');
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename:    (req, file, cb) => cb(null, `acta_${Date.now()}_${file.fieldname}${path.extname(file.originalname)}`)
});
const upload = multer({ storage, limits: { fileSize: 15*1024*1024 } });

function parseActa(row) {
  if (!row) return null;
  try { row.fotos = JSON.parse(row.fotos_json || '[]'); } catch { row.fotos = []; }
  return row;
}

router.get('/', async (req, res) => {
  try {
    const { q='', estado='', page=1, limit=100, fechaIni='', fechaFin='' } = req.query;
    const off  = (parseInt(page)-1)*parseInt(limit);
    const like = `%${q}%`;
    let where = `WHERE (folio LIKE ? OR infraccion LIKE ? OR domicilio LIKE ? OR area LIKE ?)`;
    let params = [like, like, like, like];
    if (estado)   { where += ' AND estado=?';     params.push(estado); }
    if (fechaIni) { where += ' AND fecha >= ?';   params.push(fechaIni); }
    if (fechaFin) { where += ' AND fecha <= ?';   params.push(fechaFin); }
    const rows = await db.all_p(
      `SELECT * FROM actas ${where} ORDER BY fecha DESC, id DESC LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), off]
    );
    const { n: total } = await db.get_p(`SELECT COUNT(*) as n FROM actas ${where}`, params);
    res.json({ data: rows.map(parseActa), total });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// GET /api/actas/reincidencia — top responsables con más multas
router.get('/reincidencia', async (req, res) => {
  try {
    const data = await db.all_p(
      `SELECT atiende,
              COUNT(*) as total_multas,
              COALESCE(SUM(umas), 0) as total_umas,
              MAX(fecha) as ultima_multa
       FROM actas
       WHERE atiende IS NOT NULL AND atiende != ''
       GROUP BY atiende
       ORDER BY total_multas DESC
       LIMIT 20`
    );
    res.json({ data });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.get('/:id', async (req, res) => {
  try {
    const row = await db.get_p('SELECT * FROM actas WHERE id=?', [req.params.id]);
    if (!row) return res.status(404).json({ error: 'No encontrado' });
    res.json(parseActa(row));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/', upload.array('fotos', 4), async (req, res) => {
  try {
    const b = req.body;
    const fotos = (req.files||[]).map(f => f.filename);
    const result = await db.run_p(
      `INSERT INTO actas (folio,fecha,hora_ini,hora_fin,area,domicilio,atiende,cargo,
         testigo1,testigo2,infraccion,umas,fecha_aud,hora_aud,hallazgos,estado,fotos_json)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [ b.folio, b.fecha||null, b.horaIni||null, b.horaFin||null, b.area||null,
        b.domicilio||null, b.atiende||null, b.cargo||null,
        b.testigo1||null, b.testigo2||null, b.infraccion||null, parseInt(b.umas)||0,
        b.fechaAud||null, b.horaAud||null, b.hallazgos||null,
        'Pendiente respuesta', JSON.stringify(fotos) ]
    );
    const created = await db.get_p('SELECT * FROM actas WHERE id=?', [result.lastID]);
    res.status(201).json(parseActa(created));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Registrar la respuesta de la concesionaria → cambia estado a "Respondida"
router.patch('/:id/respuesta', async (req, res) => {
  try {
    const { respuesta_concesionaria, fecha_respuesta } = req.body;
    if (!respuesta_concesionaria) return res.status(400).json({ error: 'La respuesta no puede estar vacía' });
    const r = await db.run_p(
      `UPDATE actas SET estado='Respondida', respuesta_concesionaria=?, fecha_respuesta=? WHERE id=?`,
      [respuesta_concesionaria, fecha_respuesta||null, req.params.id]
    );
    if (r.changes === 0) return res.status(404).json({ error: 'No encontrado' });
    res.json({ updated: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.patch('/:id/estado', async (req, res) => {
  try {
    const { estado, umas } = req.body;
    let sql = 'UPDATE actas SET estado=?';
    const params = [estado];
    if (umas != null) { sql += ', umas=?'; params.push(parseInt(umas)); }
    sql += ' WHERE id=?';
    params.push(req.params.id);
    const r = await db.run_p(sql, params);
    if (r.changes === 0) return res.status(404).json({ error: 'No encontrado' });
    res.json({ updated: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.delete('/:id', async (req, res) => {
  try {
    const r = await db.run_p('DELETE FROM actas WHERE id=?', [req.params.id]);
    if (r.changes === 0) return res.status(404).json({ error: 'No encontrado' });
    res.json({ deleted: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
