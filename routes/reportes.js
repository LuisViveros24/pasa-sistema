const express = require('express');
const router  = express.Router();
const path    = require('path');
const multer  = require('multer');
const db      = require('../db/database');

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, '..', 'uploads')),
  filename:    (req, file, cb) => cb(null, `reporte_${Date.now()}_${file.fieldname}${path.extname(file.originalname)}`)
});
const upload = multer({ storage, limits: { fileSize: 15*1024*1024 } });

// ── Siguiente folio ───────────────────────────────────────────
router.get('/siguiente-folio', async (req, res) => {
  try {
    const row = await db.get_p(`SELECT folio FROM reportes ORDER BY id DESC LIMIT 1`);
    const next = row ? parseInt(row.folio.split('/')[2]) + 1 : 1;
    res.json({ folio: `DLM/RCA/${String(next).padStart(4, '0')}` });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Listar reportes ───────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const { q='', estado='', colonia='', page=1, limit=100 } = req.query;
    const off  = (parseInt(page)-1) * parseInt(limit);
    const like = `%${q}%`;
    let where  = `WHERE (folio LIKE ? OR nombre LIKE ? OR colonia LIKE ? OR servicio LIKE ? OR folio_073 LIKE ?)`;
    let params = [like, like, like, like, like];
    if (estado)  { where += ' AND estado=?';   params.push(estado); }
    if (colonia) { where += ' AND colonia=?';  params.push(colonia); }
    const rows = await db.all_p(
      `SELECT * FROM reportes ${where} ORDER BY id DESC LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), off]
    );
    const { n: total } = await db.get_p(`SELECT COUNT(*) as n FROM reportes ${where}`, params);
    res.json({ data: rows, total });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Un reporte por ID ─────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const row = await db.get_p('SELECT * FROM reportes WHERE id=?', [req.params.id]);
    if (!row) return res.status(404).json({ error: 'No encontrado' });
    res.json(row);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Crear reporte (fase apertura) ─────────────────────────────
router.post('/', upload.fields([{name:'foto_antes1'},{name:'foto_antes2'}]), async (req, res) => {
  try {
    const b = req.body;
    const files = req.files || {};
    const foto_antes1 = files.foto_antes1?.[0]?.filename || null;
    const foto_antes2 = files.foto_antes2?.[0]?.filename || null;
    const result = await db.run_p(
      `INSERT INTO reportes (folio,fecha,hora,nombre,calle,numero,colonia,gps,servicio,descripcion,origen,folio_073,fecha_programada,foto_antes1,foto_antes2,estado)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'abierto')`,
      [ b.folio, b.fecha, b.hora||null, b.nombre, b.calle, b.numero||null,
        b.colonia, b.gps||null, b.servicio, b.descripcion||null,
        b.origen||'Whatsapp', b.folio_073||null, b.fecha_programada||null,
        foto_antes1, foto_antes2 ]
    );
    const created = await db.get_p('SELECT * FROM reportes WHERE id=?', [result.lastID]);
    res.status(201).json(created);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Cerrar reporte (fase cierre con fotos después) ────────────
router.patch('/:id/cerrar', upload.fields([{name:'foto_despues1'},{name:'foto_despues2'}]), async (req, res) => {
  try {
    const b = req.body;
    const files = req.files || {};
    const foto_despues1 = files.foto_despues1?.[0]?.filename || null;
    const foto_despues2 = files.foto_despues2?.[0]?.filename || null;
    const now = new Date();
    const fecha_cierre = now.toISOString().split('T')[0];
    const hora_cierre  = now.toLocaleTimeString('es-MX',{hour:'2-digit',minute:'2-digit',hour12:false});
    const r = await db.run_p(
      `UPDATE reportes SET estado='cerrado', obs_cierre=?, foto_despues1=?, foto_despues2=?,
         fecha_cierre=?, hora_cierre=? WHERE id=?`,
      [ b.obs_cierre||null, foto_despues1, foto_despues2,
        b.fecha_cierre||fecha_cierre, b.hora_cierre||hora_cierre, req.params.id ]
    );
    if (r.changes === 0) return res.status(404).json({ error: 'No encontrado' });
    const updated = await db.get_p('SELECT * FROM reportes WHERE id=?', [req.params.id]);
    res.json(updated);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Eliminar reporte ──────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    const r = await db.run_p('DELETE FROM reportes WHERE id=?', [req.params.id]);
    if (r.changes === 0) return res.status(404).json({ error: 'No encontrado' });
    res.json({ deleted: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
