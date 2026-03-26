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
const uploadMemory = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10*1024*1024 } });

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

// ── Parsear PDF de Plataforma de Atención Ciudadana ───────────
router.post('/parsear-pdf', uploadMemory.single('pdf'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No se recibió archivo' });
    const pdfParse = require('pdf-parse');
    const { text } = await pdfParse(req.file.buffer);

    // Helper
    const get = (re) => { const m = text.match(re); return m ? m[1].trim() : ''; };

    // Folio AT-XXXXX
    const folio_073 = get(/FOLIO:\s*\n*(AT-\d+)/i) || get(/(AT-\d{3,})/);

    // Fecha de alta
    const fechaStr = get(/Fecha de alta:\s*([^\n]+)/i);
    const meses = {ene:1,feb:2,mar:3,abr:4,may:5,jun:6,jul:7,ago:8,sep:9,oct:10,nov:11,dic:12};
    let fecha = '', hora = '';
    const mf = fechaStr.match(/(\d+)\s+(\w+)\s+(\d{4}),?\s*(\d+):(\d+)\s*(a\.m\.|p\.m\.)/i);
    if (mf) {
      const [,d,mes,y,hh,mm,ap] = mf;
      const mn = meses[mes.toLowerCase().substring(0,3)] || 1;
      fecha = `${y}-${String(mn).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      let h = parseInt(hh);
      if (/p\.m\./i.test(ap) && h !== 12) h += 12;
      if (/a\.m\./i.test(ap) && h === 12) h = 0;
      hora = `${String(h).padStart(2,'0')}:${mm}`;
    }

    // Descripción del Problema (hasta Evidencia o línea vacía larga)
    const descM = text.match(/Descripci[oó]n del Problema\s*\n([\s\S]*?)(?=\n(?:Evidencia|Informaci[oó]n de Tiempo|P[áa]gina \d))/i);
    let descripcion = descM ? descM[1].trim() : '';

    // Referencias (agregar al final de descripcion)
    const ref = get(/Referencias\s*\n([^\n]+)/i);
    if (ref) descripcion += `\n\nReferencias: ${ref}`;

    // Reportante
    const nombre = get(/Reportante\s*\n([^\n]+)/i);

    // Calle
    const calle = get(/Calle\s*\n([^\n]+)/i);

    // Colonia
    const colonia = get(/Colonia\s*\n([^\n]+)/i);

    // Coordenadas
    const gps = get(/Coordenadas\s*\n([^\n]+)/i);

    // Origen
    const origen = get(/Origen\s*\n([^\n]+)/i) || 'Web';

    res.json({ folio_073, fecha, hora, nombre, calle, colonia, gps, descripcion, origen });
  } catch(e) {
    console.error('parsear-pdf:', e.message);
    res.status(500).json({ error: 'No se pudo leer el PDF: ' + e.message });
  }
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
