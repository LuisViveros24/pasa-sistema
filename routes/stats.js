const express = require('express');
const router  = express.Router();
const db      = require('../db/database');

router.get('/', async (req, res) => {
  try {
    const [
      boletas, diario, auditadas, audits, actas, pendientes, reuniones,
      reportes, reportesAbiertos, tolvas,
      penalidades, penalidadesPendientes, umasPen,
      barridoMes, recoleccionMes, quejas24h,
      auditoriasMes
    ] = await Promise.all([
      db.get_p('SELECT COUNT(*) as n, COALESCE(SUM(peso_neto),0) as neto FROM boletas'),
      db.get_p('SELECT COUNT(*) as n FROM diario'),
      db.get_p('SELECT COUNT(*) as n FROM diario WHERE auditado=1'),
      db.get_p('SELECT COUNT(*) as n, AVG(score) as prom FROM auditorias WHERE score IS NOT NULL'),
      db.get_p('SELECT COUNT(*) as n, COALESCE(SUM(umas),0) as total_umas FROM actas'),
      db.get_p("SELECT COUNT(*) as n FROM actas WHERE estado != 'Dictaminada'"),
      db.get_p('SELECT COUNT(*) as n FROM reuniones'),
      db.get_p('SELECT COUNT(*) as n FROM reportes'),
      db.get_p("SELECT COUNT(*) as n FROM reportes WHERE estado='abierto'"),
      db.get_p("SELECT COUNT(*) as n, COALESCE(SUM(cantidad),0) as total_contenedores FROM tolvas WHERE estado='activo'"),
      // Penalidades
      db.get_p('SELECT COUNT(*) as n, COALESCE(SUM(umas),0) as total_umas FROM penalidades'),
      db.get_p("SELECT COUNT(*) as n FROM penalidades WHERE estado IN ('notificada','en_revision')"),
      db.get_p('SELECT COALESCE(SUM(umas),0) as total FROM penalidades'),
      // Cumplimiento mensual: barrido este mes
      db.get_p(`SELECT COUNT(*) as n FROM diario
                WHERE servicio LIKE 'Barrido%'
                AND strftime('%Y-%m', fecha) = strftime('%Y-%m', 'now', 'localtime')`),
      // Cumplimiento mensual: recolección este mes (boletas)
      db.get_p(`SELECT COUNT(*) as n FROM boletas
                WHERE strftime('%Y-%m', fecha_entrada) = strftime('%Y-%m', 'now', 'localtime')`),
      // Quejas ciudadanas vencidas (>24h sin cerrar)
      db.get_p(`SELECT COUNT(*) as n FROM reportes
                WHERE estado='abierto'
                AND datetime(fecha||' '||COALESCE(hora,'00:00')) < datetime('now','localtime','-24 hours')`),
      // Auditorías realizadas este mes
      db.get_p(`SELECT COUNT(*) as n FROM auditorias
                WHERE strftime('%Y-%m', fecha) = strftime('%Y-%m', 'now', 'localtime')`),
    ]);

    res.json({
      boletas:               boletas.n,
      pesoNetoTotal:         boletas.neto,
      diario:                diario.n,
      diarioAuditado:        auditadas.n,
      auditorias:            audits.n,
      promAuditoria:         audits.prom != null ? Math.round(audits.prom) : null,
      actas:                 actas.n,
      totalUmas:             actas.total_umas,
      actasPendientes:       pendientes.n,
      reuniones:             reuniones.n,
      reportes:              reportes.n,
      reportesAbiertos:      reportesAbiertos.n,
      tolvas:                tolvas.n,
      totalContenedores:     tolvas.total_contenedores,
      // Penalidades
      penalidades:           penalidades.n,
      penalidadesPendientes: penalidadesPendientes.n,
      umasPenalidades:       umasPen.total,
      // Cumplimiento mensual
      barridoMes:            barridoMes.n,
      recoleccionMes:        recoleccionMes.n,
      quejas24hVencidas:     quejas24h.n,
      auditoriasMes:         auditoriasMes.n,
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// GET /api/stats/tendencias — últimos 6 meses de datos para gráficas
router.get('/tendencias', async (req, res) => {
  try {
    const [boletasMes, auditoriasMes, actasMes] = await Promise.all([
      db.all_p(`SELECT strftime('%Y-%m', fecha_entrada) as mes,
                  ROUND(SUM(peso_neto)/1000, 2) as neto_ton, COUNT(*) as total
                FROM boletas WHERE fecha_entrada IS NOT NULL
                GROUP BY mes ORDER BY mes DESC LIMIT 6`),
      db.all_p(`SELECT strftime('%Y-%m', fecha) as mes,
                  ROUND(AVG(score), 1) as prom_score, COUNT(*) as total
                FROM auditorias WHERE score IS NOT NULL AND fecha IS NOT NULL
                GROUP BY mes ORDER BY mes DESC LIMIT 6`),
      db.all_p(`SELECT strftime('%Y-%m', fecha) as mes, COUNT(*) as total
                FROM actas WHERE fecha IS NOT NULL
                GROUP BY mes ORDER BY mes DESC LIMIT 6`),
    ]);
    // Retornar en orden ASC para graficar izquierda→derecha
    res.json({
      boletas:    boletasMes.reverse(),
      auditorias: auditoriasMes.reverse(),
      actas:      actasMes.reverse(),
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// GET /api/stats/cruce — unidades del diario de hoy sin boleta registrada hoy
router.get('/cruce', async (req, res) => {
  try {
    const hoy = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD local
    const rows = await db.all_p(
      `SELECT DISTINCT unidad FROM diario
       WHERE fecha = ? AND unidad != 'N/A' AND unidad IS NOT NULL AND unidad != ''
         AND unidad NOT IN (
           SELECT DISTINCT num_eco FROM boletas WHERE fecha_entrada = ?
         )`,
      [hoy, hoy]
    );
    res.json({ sinBoleta: rows.map(r => r.unidad), fecha: hoy });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
