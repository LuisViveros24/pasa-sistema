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

// GET /api/stats/cumplimiento-mensual?mes=YYYY-MM
// Calcula % de cumplimiento de barrido y recolección vs rutas programadas (Anexo 7 §1.3)
router.get('/cumplimiento-mensual', async (req, res) => {
  try {
    const mes = req.query.mes || new Date().toISOString().slice(0,7);

    // Rutas totales en catálogo (referencia para programadas)
    const [totalRutas, barridoReal, recoleccionReal] = await Promise.all([
      db.get_p('SELECT COUNT(DISTINCT colonia) as n FROM rutas'),
      db.get_p(
        `SELECT COUNT(*) as n FROM diario
         WHERE servicio LIKE 'Barrido%' AND strftime('%Y-%m', fecha) = ?`, [mes]
      ),
      db.get_p(
        `SELECT COUNT(*) as n FROM boletas
         WHERE strftime('%Y-%m', fecha_entrada) = ?`, [mes]
      ),
    ]);

    // Calcular penalidad sugerida por barrido (Anexo 7 §1.3)
    function penBarrido(pct) {
      if (pct >= 95) return 0;
      if (pct >= 90) return 200;
      if (pct >= 85) return 300;
      return 400;
    }
    function penRecoleccion(pct) {
      if (pct >= 95) return 0;
      if (pct >= 90) return 500;
      if (pct >= 85) return 600;
      return 700;
    }

    // Días laborables en el mes (días hábiles aprox = días del mes * 5/7)
    const [y, m] = mes.split('-').map(Number);
    const diasMes = new Date(y, m, 0).getDate();
    const diasHabiles = Math.round(diasMes * 5 / 7);

    // Programadas: cada colonia se barre ~5 días a la semana
    const programadasBarrido    = totalRutas.n * diasHabiles;
    const programadasRecoleccion = totalRutas.n * diasHabiles;

    const pctBarrido     = programadasBarrido    > 0 ? Math.round(barridoReal.n     / programadasBarrido    * 100) : 0;
    const pctRecoleccion = programadasRecoleccion > 0 ? Math.round(recoleccionReal.n / programadasRecoleccion * 100) : 0;

    const umasBarrido     = penBarrido(pctBarrido);
    const umasRecoleccion = penRecoleccion(pctRecoleccion);

    res.json({
      mes,
      barrido: {
        real: barridoReal.n, programadas: programadasBarrido,
        pct: pctBarrido, umas_sugeridas: umasBarrido,
        penalidad_sugerida: umasBarrido > 0,
      },
      recoleccion: {
        real: recoleccionReal.n, programadas: programadasRecoleccion,
        pct: pctRecoleccion, umas_sugeridas: umasRecoleccion,
        penalidad_sugerida: umasRecoleccion > 0,
      },
      total_umas_sugeridas: umasBarrido + umasRecoleccion,
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// GET /api/stats/bascula-diaria?fecha=YYYY-MM-DD
router.get('/bascula-diaria', async (req, res) => {
  try {
    const fecha = req.query.fecha || new Date().toLocaleDateString('en-CA');
    const [porRuta, porTipo, totales] = await Promise.all([
      db.all_p(
        `SELECT ruta, num_eco, COUNT(*) as viajes, ROUND(SUM(peso_neto),3) as neto
         FROM boletas WHERE fecha_entrada = ?
         GROUP BY ruta, num_eco ORDER BY neto DESC`,
        [fecha]
      ),
      db.all_p(
        `SELECT tipo_servicio, COUNT(*) as viajes, ROUND(SUM(peso_neto),3) as neto
         FROM boletas WHERE fecha_entrada = ?
         GROUP BY tipo_servicio ORDER BY neto DESC`,
        [fecha]
      ),
      db.get_p(
        `SELECT COUNT(*) as viajes, ROUND(SUM(peso_neto),3) as neto FROM boletas WHERE fecha_entrada = ?`,
        [fecha]
      ),
    ]);
    res.json({ fecha, por_ruta: porRuta, por_tipo: porTipo,
               total_viajes: totales.viajes, total_neto: totales.neto });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// GET /api/stats/organismo?mes=YYYY-MM  — reporte bimestral para Organismo Supervisor
router.get('/organismo', async (req, res) => {
  try {
    const mes = req.query.mes || new Date().toISOString().slice(0,7);
    const [y, m] = mes.split('-').map(Number);
    // Bimestre: mes actual y anterior
    const mesPrev = m === 1
      ? `${y-1}-12`
      : `${y}-${String(m-1).padStart(2,'0')}`;

    const [
      boletas, diario, auditorias, actas, penalidades,
      reportesTot, reportesCerrados, quejas24h,
      boletasPrev, diarioPrev
    ] = await Promise.all([
      db.get_p(`SELECT COUNT(*) as viajes, ROUND(SUM(peso_neto),3) as neto FROM boletas WHERE strftime('%Y-%m',fecha_entrada)=?`, [mes]),
      db.get_p(`SELECT COUNT(*) as n FROM diario WHERE strftime('%Y-%m',fecha)=?`, [mes]),
      db.all_p(`SELECT veredicto, COUNT(*) as n, ROUND(AVG(score),1) as prom FROM auditorias WHERE strftime('%Y-%m',fecha)=? GROUP BY veredicto`, [mes]),
      db.get_p(`SELECT COUNT(*) as n, COALESCE(SUM(umas),0) as total_umas FROM actas WHERE strftime('%Y-%m',fecha)=?`, [mes]),
      db.get_p(`SELECT COUNT(*) as n, COALESCE(SUM(umas),0) as total_umas FROM penalidades WHERE strftime('%Y-%m',fecha)=? AND estado != 'COBRADO'`, [mes]),
      db.get_p(`SELECT COUNT(*) as n FROM reportes WHERE strftime('%Y-%m',fecha)=?`, [mes]),
      db.get_p(`SELECT COUNT(*) as n FROM reportes WHERE strftime('%Y-%m',fecha)=? AND estado='cerrado'`, [mes]),
      db.get_p(`SELECT COUNT(*) as n FROM reportes WHERE estado='abierto' AND datetime(fecha||' '||COALESCE(hora,'00:00'))<datetime('now','localtime','-24 hours')`),
      db.get_p(`SELECT COUNT(*) as viajes, ROUND(SUM(peso_neto),3) as neto FROM boletas WHERE strftime('%Y-%m',fecha_entrada)=?`, [mesPrev]),
      db.get_p(`SELECT COUNT(*) as n FROM diario WHERE strftime('%Y-%m',fecha)=?`, [mesPrev]),
    ]);

    const UMA_2026 = 108.57;
    const atasTotal = auditorias.reduce((a,r) => a + r.n, 0);

    res.json({
      periodo: { mes, mes_anterior: mesPrev },
      bascula: { viajes: boletas.viajes, neto_ton: boletas.neto,
                 variacion_pct: boletasPrev.neto > 0 ? Math.round((boletas.neto - boletasPrev.neto) / boletasPrev.neto * 100) : null },
      diario:  { registros: diario.n, variacion_pct: diarioPrev.n > 0 ? Math.round((diario.n - diarioPrev.n) / diarioPrev.n * 100) : null },
      auditorias: { total: atasTotal, por_veredicto: auditorias },
      actas: { total: actas.n, total_umas: actas.total_umas, total_pesos: Math.round(actas.total_umas * UMA_2026) },
      penalidades: { total: penalidades.n, total_umas: penalidades.total_umas, total_pesos: Math.round(penalidades.total_umas * UMA_2026) },
      reportes_ciudadanos: {
        total: reportesTot.n, cerrados: reportesCerrados.n,
        eficiencia_pct: reportesTot.n > 0 ? Math.round(reportesCerrados.n / reportesTot.n * 100) : 100,
        vencidas_24h: quejas24h.n,
      },
      uma_valor: UMA_2026,
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
