const express = require('express');
const router  = express.Router();
const db      = require('../db/database');

// Catálogo de números económicos válidos (fuente: Base de datos Unidades.xlsx)
const UNIDADES_VALIDAS = new Set([
  'CT-2898','CT-2928','CT-2912','CT-2910','CT-2899','CT-2926','CT-2927',
  'CT-2908','CT-2735','CT-1477','CT-2924','CT-2893','CT-2901','CT-2909',
  'RO-1886','CT-1459','CT-2707','CT-3184','CT-2929','CT-2913','CT-2153',
  'CT-1835','CT-2931','CT-2161','CT-2165','CT-2160','CT-2159','CT-2242',
  'CT-2078','CT-2708','CT-2925','CT-2154','CT-2900','CT-2162','CT-2157',
  'CT-2166','CT-2079','CT-1735','CT-2240','CT-2076','CT-2934','CT-2163',
  'CT-1222','CT-2879','FR-2554','CT-2923','CT-2915','CT-2164','CT-2932',
  'CT-2050','CT-2706','CT-2077','FR-2341','CT-2930','CT-2075','CT-2911',
  'CT-3391','CT-2705','CT-2155','CT-2933','RO-2785','CT-1491','CT-2042',
]);

// GET /api/boletas/unidades — catálogo para autocompletado
router.get('/unidades', (req, res) => {
  res.json([...UNIDADES_VALIDAS].sort());
});

// GET /api/boletas
router.get('/', async (req, res) => {
  try {
    const { q = '', page = 1, limit = 50, fechaIni = '', fechaFin = '' } = req.query;
    const off  = (parseInt(page)-1) * parseInt(limit);
    const like = `%${q}%`;
    let where = `WHERE (folio LIKE ? OR tipo_servicio LIKE ? OR procedencia LIKE ? OR capturista LIKE ?)`;
    const params = [like, like, like, like];
    if (fechaIni) { where += ` AND fecha_entrada >= ?`; params.push(fechaIni); }
    if (fechaFin) { where += ` AND fecha_entrada <= ?`; params.push(fechaFin); }
    const rows = await db.all_p(
      `SELECT * FROM boletas ${where} ORDER BY fecha_entrada DESC, id DESC LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), off]
    );
    const { n: total } = await db.get_p(`SELECT COUNT(*) as n FROM boletas ${where}`, params);
    res.json({ data: rows, total });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// GET /api/boletas/stats/resumen — totales del día o rango
router.get('/stats/resumen', async (req, res) => {
  try {
    const { fecha = new Date().toLocaleDateString('en-CA') } = req.query;
    const [porTipo, conteoUnidades, totalDia] = await Promise.all([
      db.all_p(
        `SELECT tipo_servicio, COUNT(*) as viajes,
                ROUND(SUM(peso_neto),3) as neto_ton,
                ROUND(AVG(peso_neto),3) as prom_ton
         FROM boletas WHERE fecha_entrada = ? GROUP BY tipo_servicio ORDER BY neto_ton DESC`,
        [fecha]
      ),
      db.get_p(
        `SELECT COUNT(DISTINCT num_eco) as unidades FROM boletas WHERE fecha_entrada = ?`,
        [fecha]
      ),
      db.get_p(
        `SELECT COUNT(*) as viajes, ROUND(SUM(peso_neto),3) as neto_ton FROM boletas WHERE fecha_entrada = ?`,
        [fecha]
      ),
    ]);
    res.json({ fecha, por_tipo: porTipo, unidades: conteoUnidades.unidades,
               total_viajes: totalDia.viajes, total_neto: totalDia.neto_ton });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// GET /api/boletas/:id
router.get('/:id', async (req, res) => {
  try {
    const row = await db.get_p('SELECT * FROM boletas WHERE id = ?', [req.params.id]);
    if (!row) return res.status(404).json({ error: 'No encontrado' });
    res.json(row);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// POST /api/boletas
router.post('/', async (req, res) => {
  try {
    const b = req.body;
    const numEco = (b.numEco || '').toString().trim().toUpperCase() || null;
    const numEcoValido = numEco !== null ? (UNIDADES_VALIDAS.has(numEco) ? 1 : 0) : null;
    const result = await db.run_p(
      `INSERT INTO boletas (folio,tipo_servicio,abastos,procedencia,ruta,num_eco,
         fecha_entrada,hora_entrada,peso_bruto,tara,peso_neto,
         fecha_salida,hora_salida,observaciones,capturista,num_eco_valido)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [ b.folio, b.tipoServicio, b.abastos?1:0, b.procedencia||null, b.ruta||null,
        numEco, b.fechaEntrada||null, b.horaEntrada||null,
        parseFloat(b.pesoBruto)||0, parseFloat(b.tara)||0, parseFloat(b.pesoNeto)||0,
        b.fechaSalida||null, b.horaSalida||null, b.observaciones||null, b.capturista||null,
        numEcoValido ]
    );
    const created = await db.get_p('SELECT * FROM boletas WHERE id = ?', [result.lastID]);
    res.status(201).json(created);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/boletas/:id
router.put('/:id', async (req, res) => {
  try {
    const b = req.body;
    const numEco = b.numEco ? b.numEco.toString().trim().toUpperCase() : null;
    const numEcoValido = numEco !== null ? (UNIDADES_VALIDAS.has(numEco) ? 1 : 0) : null;
    const r = await db.run_p(
      `UPDATE boletas SET folio=?,tipo_servicio=?,abastos=?,procedencia=?,ruta=?,num_eco=?,
         fecha_entrada=?,hora_entrada=?,peso_bruto=?,tara=?,peso_neto=?,
         fecha_salida=?,hora_salida=?,observaciones=?,capturista=?,num_eco_valido=?
       WHERE id=?`,
      [ b.folio, b.tipoServicio, b.abastos?1:0, b.procedencia||null, b.ruta||null,
        numEco, b.fechaEntrada||null, b.horaEntrada||null,
        parseFloat(b.pesoBruto)||0, parseFloat(b.tara)||0, parseFloat(b.pesoNeto)||0,
        b.fechaSalida||null, b.horaSalida||null, b.observaciones||null, b.capturista||null,
        numEcoValido, req.params.id ]
    );
    if (r.changes === 0) return res.status(404).json({ error: 'No encontrado' });
    const updated = await db.get_p('SELECT * FROM boletas WHERE id = ?', [req.params.id]);
    res.json(updated);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/boletas/:id
router.delete('/:id', async (req, res) => {
  try {
    const r = await db.run_p('DELETE FROM boletas WHERE id = ?', [req.params.id]);
    if (r.changes === 0) return res.status(404).json({ error: 'No encontrado' });
    res.json({ deleted: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
