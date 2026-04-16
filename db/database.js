/**
 * database.js — Conexión SQLite con el módulo "sqlite3" estándar
 * Compatible con Node.js v18, v20, v22, v24
 */

const sqlite3 = require('sqlite3').verbose();
const crypto  = require('crypto');

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

const { DB_PATH } = require('../paths');
const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) { console.error('Error abriendo base de datos:', err.message); process.exit(1); }
});

// ── Utilidades para usar promesas en lugar de callbacks ──────────
db.run_p  = (sql, params=[]) => new Promise((res,rej) => db.run(sql, params, function(err){ err ? rej(err) : res(this); }));
db.get_p  = (sql, params=[]) => new Promise((res,rej) => db.get(sql, params, (err,row) => err ? rej(err) : res(row)));
db.all_p  = (sql, params=[]) => new Promise((res,rej) => db.all(sql, params, (err,rows) => err ? rej(err) : res(rows)));

// ── Inicialización de tablas ─────────────────────────────────────
const SCHEMA = `
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS boletas (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    folio         TEXT    NOT NULL,
    tipo_servicio TEXT    NOT NULL,
    abastos       INTEGER NOT NULL DEFAULT 0,
    procedencia   TEXT,
    ruta          TEXT,
    num_eco       TEXT,
    fecha_entrada TEXT,
    hora_entrada  TEXT,
    peso_bruto    REAL    DEFAULT 0,
    tara          REAL    DEFAULT 0,
    peso_neto     REAL    DEFAULT 0,
    fecha_salida  TEXT,
    hora_salida   TEXT,
    observaciones TEXT,
    capturista    TEXT,
    created_at    TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS diario (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    folio         TEXT    NOT NULL,
    fecha         TEXT,
    hora          TEXT,
    responsable   TEXT,
    servicio      TEXT,
    unidad        TEXT,
    gps           TEXT,
    colonia       TEXT,
    calle         TEXT,
    numero        TEXT,
    actividades   TEXT,
    observaciones TEXT,
    foto1         TEXT,
    foto2         TEXT,
    auditado      INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS auditorias (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    folio           TEXT    NOT NULL,
    folio_diario    TEXT,
    fecha           TEXT,
    hora            TEXT,
    turno           TEXT,
    auditor         TEXT,
    rep_pasa        TEXT,
    zona            TEXT,
    tipo_servicio   TEXT,
    score           REAL,
    veredicto       TEXT,
    hallazgos       TEXT,
    acciones        TEXT,
    plazo           TEXT,
    riesgo          TEXT,
    rubros_json     TEXT,
    respuestas_json TEXT,
    created_at      TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS actas (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    folio       TEXT    NOT NULL,
    fecha       TEXT,
    hora_ini    TEXT,
    hora_fin    TEXT,
    area        TEXT,
    domicilio   TEXT,
    atiende     TEXT,
    cargo       TEXT,
    testigo1    TEXT,
    testigo2    TEXT,
    infraccion  TEXT,
    umas        INTEGER DEFAULT 0,
    fecha_aud   TEXT,
    hora_aud    TEXT,
    hallazgos   TEXT,
    estado      TEXT    NOT NULL DEFAULT 'Pendiente audiencia',
    fotos_json  TEXT,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS reuniones (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    fecha         TEXT,
    hora          TEXT,
    lugar         TEXT,
    participantes TEXT,
    observaciones TEXT,
    actas_json    TEXT,
    created_at    TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS reportes (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    folio         TEXT    NOT NULL UNIQUE,
    fecha         TEXT    NOT NULL,
    hora          TEXT    NOT NULL,
    nombre        TEXT    NOT NULL,
    calle         TEXT    NOT NULL,
    numero        TEXT,
    colonia       TEXT    NOT NULL,
    gps           TEXT,
    servicio      TEXT    NOT NULL,
    descripcion   TEXT,
    origen           TEXT    NOT NULL DEFAULT 'Whatsapp',
    folio_073        TEXT,
    fecha_programada TEXT,
    foto_antes1   TEXT,
    foto_antes2   TEXT,
    foto_despues1 TEXT,
    foto_despues2 TEXT,
    obs_cierre    TEXT,
    fecha_cierre  TEXT,
    hora_cierre   TEXT,
    estado        TEXT    NOT NULL DEFAULT 'abierto',
    created_at    TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS usuarios (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario       TEXT    NOT NULL UNIQUE,
    nombre        TEXT    NOT NULL,
    password_hash TEXT    NOT NULL,
    salt          TEXT    NOT NULL,
    rol           TEXT    NOT NULL DEFAULT 'supervisor',
    activo        INTEGER NOT NULL DEFAULT 1,
    ultimo_acceso TEXT,
    created_at    TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS rutas (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    ruta       INTEGER,
    num_unidad TEXT,
    colonia    TEXT    NOT NULL,
    dias       TEXT,
    horarios   TEXT,
    zona       TEXT,
    created_at TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS penalidades (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    folio               TEXT    NOT NULL UNIQUE,
    fecha               TEXT    NOT NULL,
    tipo                TEXT    NOT NULL,
    descripcion         TEXT    NOT NULL,
    umas                REAL    NOT NULL DEFAULT 0,
    estado              TEXT    NOT NULL DEFAULT 'notificada',
    fecha_notificacion  TEXT,
    plazo_respuesta     TEXT,
    respuesta           TEXT,
    fecha_respuesta     TEXT,
    determinacion       TEXT,
    fecha_determinacion TEXT,
    fecha_pago          TEXT,
    folio_ref           TEXT,
    created_at          TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS tolvas (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    folio          TEXT    NOT NULL UNIQUE,
    tipo           TEXT    NOT NULL,
    frecuencia     TEXT    NOT NULL,
    equipo         TEXT    NOT NULL,
    cantidad       INTEGER NOT NULL DEFAULT 1,
    punto_servicio TEXT    NOT NULL,
    ubicacion      TEXT,
    observaciones  TEXT,
    estado         TEXT    NOT NULL DEFAULT 'activo',
    created_at     TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS conciliaciones (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    periodo           TEXT    NOT NULL UNIQUE,
    archivo_nombre    TEXT,
    fecha_carga       TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
    total_propios     INTEGER DEFAULT 0,
    total_externos    INTEGER DEFAULT 0,
    total_ok          INTEGER DEFAULT 0,
    total_diff        INTEGER DEFAULT 0,
    total_solo_mios   INTEGER DEFAULT 0,
    total_solo_suyos  INTEGER DEFAULT 0,
    estado            TEXT    DEFAULT 'abierta',
    datos_incompletos INTEGER DEFAULT 0,
    created_at        TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS conciliacion_detalle (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    conciliacion_id  INTEGER NOT NULL,
    folio            TEXT,
    estado_match     TEXT,
    num_eco_propio   TEXT,
    bruto_propio     REAL,
    tara_propia      REAL,
    neto_propio      REAL,
    num_eco_externo  TEXT,
    bruto_externo    REAL,
    tara_externa     REAL,
    neto_externo     REAL,
    diff_num_eco     INTEGER DEFAULT 0,
    diff_bruto_pct   REAL,
    diff_tara_pct    REAL,
    diff_neto_pct    REAL,
    senalamiento     TEXT,
    FOREIGN KEY (conciliacion_id) REFERENCES conciliaciones(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_conciliaciones_periodo ON conciliaciones(periodo);
  CREATE INDEX IF NOT EXISTS idx_concili_detalle_cid    ON conciliacion_detalle(conciliacion_id);

  CREATE INDEX IF NOT EXISTS idx_boletas_folio    ON boletas(folio);
  CREATE INDEX IF NOT EXISTS idx_boletas_fecha    ON boletas(fecha_entrada);
  CREATE INDEX IF NOT EXISTS idx_diario_folio     ON diario(folio);
  CREATE INDEX IF NOT EXISTS idx_diario_fecha     ON diario(fecha);
  CREATE INDEX IF NOT EXISTS idx_auditorias_folio ON auditorias(folio);
  CREATE INDEX IF NOT EXISTS idx_actas_folio      ON actas(folio);
  CREATE INDEX IF NOT EXISTS idx_actas_estado     ON actas(estado);
  CREATE INDEX IF NOT EXISTS idx_rutas_ruta       ON rutas(ruta);
  CREATE INDEX IF NOT EXISTS idx_rutas_zona       ON rutas(zona);
  CREATE INDEX IF NOT EXISTS idx_reportes_folio   ON reportes(folio);
  CREATE INDEX IF NOT EXISTS idx_reportes_estado  ON reportes(estado);
  CREATE INDEX IF NOT EXISTS idx_tolvas_tipo         ON tolvas(tipo);
  CREATE INDEX IF NOT EXISTS idx_tolvas_estado       ON tolvas(estado);
  CREATE INDEX IF NOT EXISTS idx_penalidades_folio   ON penalidades(folio);
  CREATE INDEX IF NOT EXISTS idx_penalidades_estado  ON penalidades(estado);
  CREATE INDEX IF NOT EXISTS idx_penalidades_tipo    ON penalidades(tipo);
  CREATE TABLE IF NOT EXISTS ordenes_trabajo (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    folio                TEXT    NOT NULL,
    fecha                TEXT,
    hora                 TEXT,
    emitida_por          TEXT,
    dirigida_a           TEXT,
    tipo                 TEXT,
    prioridad            TEXT    NOT NULL DEFAULT 'NORMAL',
    descripcion          TEXT,
    zona                 TEXT,
    colonia              TEXT,
    fecha_limite         TEXT,
    estado               TEXT    NOT NULL DEFAULT 'PENDIENTE',
    folio_diario         TEXT,
    folio_auditoria      TEXT,
    observaciones_cierre TEXT,
    fecha_atencion       TEXT,
    created_at           TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
  );
  CREATE INDEX IF NOT EXISTS idx_ot_folio  ON ordenes_trabajo(folio);
  CREATE INDEX IF NOT EXISTS idx_ot_estado ON ordenes_trabajo(estado);

  CREATE TABLE IF NOT EXISTS configuracion (
    clave      TEXT PRIMARY KEY,
    valor      TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
  INSERT OR IGNORE INTO configuracion (clave, valor) VALUES ('uma_valor', '108.57');
  INSERT OR IGNORE INTO configuracion (clave, valor) VALUES ('auditorias_meta_mensual', '8');

  CREATE TABLE IF NOT EXISTS incidencias (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    folio         TEXT NOT NULL UNIQUE,
    fecha         TEXT NOT NULL,
    hora          TEXT NOT NULL,
    reportado_por TEXT NOT NULL,
    descripcion   TEXT NOT NULL,
    lat           REAL,
    lng           REAL,
    fotos_json    TEXT DEFAULT '[]',
    created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
  CREATE INDEX IF NOT EXISTS idx_incidencias_folio   ON incidencias(folio);
  CREATE INDEX IF NOT EXISTS idx_incidencias_fecha   ON incidencias(fecha);
`;

// Ejecutar schema y luego seed si actas está vacía
db.serialize(() => {
  SCHEMA.split(';').map(s => s.trim()).filter(Boolean).forEach(stmt => {
    db.run(stmt, err => { if (err && !err.message.includes('already exists')) console.error('Schema error:', err.message); });
  });

  // Migración: columna num_eco_valido (1=registrada, 0=no registrada, NULL=sin validar)
  db.run(`ALTER TABLE boletas ADD COLUMN num_eco_valido INTEGER DEFAULT NULL`, err => {
    if (err && !err.message.includes('duplicate column')) console.error('Migración boletas:', err.message);
  });

  // Migración: columnas de respuesta de la concesionaria en actas
  db.run(`ALTER TABLE actas ADD COLUMN respuesta_concesionaria TEXT`, err => {
    if (err && !err.message.includes('duplicate column')) console.error('Migración actas (respuesta):', err.message);
  });
  db.run(`ALTER TABLE actas ADD COLUMN fecha_respuesta TEXT`, err => {
    if (err && !err.message.includes('duplicate column')) console.error('Migración actas (fecha_respuesta):', err.message);
  });

  // Migración: columnas origen y folio_073 en reportes
  db.run(`ALTER TABLE reportes ADD COLUMN origen TEXT NOT NULL DEFAULT 'Whatsapp'`, err => {
    if (err && !err.message.includes('duplicate column')) console.error('Migración reportes (origen):', err.message);
  });
  db.run(`ALTER TABLE reportes ADD COLUMN folio_073 TEXT`, err => {
    if (err && !err.message.includes('duplicate column')) console.error('Migración reportes (folio_073):', err.message);
  });
  db.run(`ALTER TABLE reportes ADD COLUMN fecha_programada TEXT`, err => {
    if (err && !err.message.includes('duplicate column')) console.error('Migración reportes (fecha_programada):', err.message);
  });

  // Migración: columna modulos en usuarios (JSON array de módulos personalizados)
  db.run(`ALTER TABLE usuarios ADD COLUMN modulos TEXT`, err => {
    if (err && !err.message.includes('duplicate column')) console.error('Migración usuarios (modulos):', err.message);
  });

  // Migración: origen del registro en diario (orden de trabajo / reporte ciudadano)
  db.run(`ALTER TABLE diario ADD COLUMN origen_tipo TEXT`, err => {
    if (err && !err.message.includes('duplicate column')) console.error('Migración diario (origen_tipo):', err.message);
  });
  db.run(`ALTER TABLE diario ADD COLUMN origen_folio TEXT`, err => {
    if (err && !err.message.includes('duplicate column')) console.error('Migración diario (origen_folio):', err.message);
  });

  // Migración: renombrar estado "Pendiente audiencia" → "Pendiente respuesta"
  db.run(`UPDATE actas SET estado='Pendiente respuesta' WHERE estado='Pendiente audiencia'`, err => {
    if (err) console.error('Migración estado actas:', err.message);
  });

  // Seed usuarios — INSERT OR IGNORE para que nuevos usuarios se agreguen sin borrar existentes
  const usersToSeed = [
    { usuario: 'admin',      nombre: 'Administrador',    password: 'Admin2026!',    rol: 'administrador' },
    { usuario: 'supervisor', nombre: 'Supervisor PASA',  password: 'Super2026!',    rol: 'supervisor'    },
    { usuario: 'bascula',    nombre: 'Operador Báscula', password: 'Bascula2026!',  rol: 'pesaje'        },
    { usuario: 'auditoria',  nombre: 'Auditor DGSPM',    password: 'Audit2026!',    rol: 'auditor'       },
    { usuario: 'enlace',     nombre: 'Enlace Ciudadano', password: 'Enlace2026!',   rol: 'enlace'        },
  ];
  const ins = db.prepare(`INSERT OR IGNORE INTO usuarios (usuario, nombre, password_hash, salt, rol) VALUES (?,?,?,?,?)`);
  usersToSeed.forEach(u => {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = hashPassword(u.password, salt);
    ins.run([u.usuario, u.nombre, hash, salt, u.rol], function(err) {
      if (!err && this.changes > 0) console.log(`✔  Usuario creado: ${u.usuario} (${u.rol})`);
    });
  });
  ins.finalize();

  // Seed actas históricas
  db.get('SELECT COUNT(*) as n FROM actas', (err, row) => {
    if (err || row.n > 0) return;
    const ins = db.prepare(`INSERT INTO actas (folio,fecha,area,domicilio,infraccion,umas,hallazgos,estado,respuesta_concesionaria,fecha_respuesta)
      VALUES (?,?,?,?,?,?,?,?,?,?)`);
    const seed = [
      ['0001','2026-01-15','SERVICIO','Colonias: Villa Romana, Villa Florida, Las Quintas','Incumplir con la frecuencia de recolección',0,'Primera vez','Respondida','Unidad 218 presentó descompostura mecánica por bajas temperaturas. Se adjunta orden de taller.','2026-01-17'],
      ['0002','2026-01-15','SERVICIO','La Esparza','Incumplir con la frecuencia de recolección',0,'Primera vez','Respondida','Condiciones climatológicas (lluvia intensa) impidieron el acceso a la zona. Se reasignó la recolección al día siguiente.','2026-01-17'],
      ['0003','2026-01-19','SERVICIO','Residencial Los Fresnos','Incumplir con la frecuencia de recolección',0,'Primera vez','Pendiente respuesta',null,null],
      ['0004','2026-01-21','OPERATIVA','Martires del Río Blanco esq Lerdo de Tejada, Col. Centro','Incumplir con la limpieza de los contenedores con la frecuencia convenida',0,'Reincidencia','Pendiente respuesta',null,null],
      ['0005','2026-01-26','SERVICIO','Cda Laurel, Col. El Roble 1','Incumplir con la cobertura o salirse de la ruta asignada (GPS)',0,'Primera vez','Pendiente respuesta',null,null],
      ['0006','2026-01-27','SERVICIO','Calles Valle Viejo, Del Arenal, Valle Escondido; Col. Monterreal','Incumplir con la cobertura o salirse de la ruta asignada (GPS)',0,'Reincidencia','Pendiente respuesta',null,null],
      ['0007','2026-01-28','SERVICIO','Circuito Canteras, Blvd. Torreón 2000','Incumplir con la cobertura o salirse de la ruta asignada (GPS)',0,'Reincidencia','Pendiente respuesta',null,null],
      ['0008','2026-02-23','SERVICIO','Calle de la Salle esq Cda San Pedro, Col. La Amistad','No recoger producto sin justificación',0,'Reincidencia','Pendiente respuesta',null,null],
      ['0009','2026-02-24','SERVICIO','Colonia Los Laureles, Ej San Luis','Incumplir con la cobertura o salirse de la ruta asignada (GPS)',0,'Reincidencia','Pendiente respuesta',null,null],
    ];
    seed.forEach(r => ins.run(r));
    ins.finalize();
    console.log('✔  9 actas históricas de muestra insertadas.');
  });

  // Migración: tabla penalidades (nueva — silencioso si ya existe)
  db.run(`ALTER TABLE penalidades ADD COLUMN folio_ref TEXT`, err => {
    if (err && !err.message.includes('duplicate column') && !err.message.includes('no such table')) {
      // silencioso — la tabla puede crearse fresca
    }
  });

  // Migración: nuevas columnas en auditorias para multi-origen y fotos
  db.run(`ALTER TABLE auditorias ADD COLUMN origen TEXT DEFAULT 'independiente'`, () => {});
  db.run(`ALTER TABLE auditorias ADD COLUMN folio_reporte TEXT`, () => {});
  db.run(`ALTER TABLE auditorias ADD COLUMN foto1 TEXT`, () => {});
  db.run(`ALTER TABLE auditorias ADD COLUMN foto2 TEXT`, () => {});

  // Migración: campos de seguimiento en auditorias
  db.run(`ALTER TABLE auditorias ADD COLUMN compromiso TEXT`, err => {
    if (err && !err.message.includes('duplicate column')) console.error('Migración auditorias (compromiso):', err.message);
  });
  db.run(`ALTER TABLE auditorias ADD COLUMN plazo_verif TEXT`, err => {
    if (err && !err.message.includes('duplicate column')) console.error('Migración auditorias (plazo_verif):', err.message);
  });
  db.run(`ALTER TABLE auditorias ADD COLUMN verificado INTEGER DEFAULT 0`, err => {
    if (err && !err.message.includes('duplicate column')) console.error('Migración auditorias (verificado):', err.message);
  });
  db.run(`ALTER TABLE auditorias ADD COLUMN fecha_verif TEXT`, err => {
    if (err && !err.message.includes('duplicate column')) console.error('Migración auditorias (fecha_verif):', err.message);
  });
  db.run(`ALTER TABLE auditorias ADD COLUMN obs_verif TEXT`, err => {
    if (err && !err.message.includes('duplicate column')) console.error('Migración auditorias (obs_verif):', err.message);
  });
  db.run('ALTER TABLE auditorias ADD COLUMN num_eco TEXT', () => {});

  // Migración: punto_tolva en diario
  db.run(`ALTER TABLE diario ADD COLUMN punto_tolva TEXT`, err => {
    if (err && !err.message.includes('duplicate column')) console.error('Migración diario (punto_tolva):', err.message);
  });

  // Migración: responsable y turno en rutas (Anexo 2 — título de concesión)
  db.run(`ALTER TABLE rutas ADD COLUMN responsable TEXT`, err => {
    if (err && !err.message.includes('duplicate column')) console.error('Migración rutas (responsable):', err.message);
  });
  db.run(`ALTER TABLE rutas ADD COLUMN turno TEXT`, err => {
    if (err && !err.message.includes('duplicate column')) console.error('Migración rutas (turno):', err.message);
  });

  // Tabla Lista Negra
  db.run(`CREATE TABLE IF NOT EXISTS lista_negra (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    fecha       TEXT,
    colonia     TEXT,
    unidad      TEXT,
    infraccion  TEXT,
    responsable TEXT,
    observacion TEXT,
    created_at  TEXT DEFAULT (datetime('now','localtime'))
  )`, err => { if(err) console.error('lista_negra table:', err.message); });

  // Seed tolvas — 147 puntos de servicio (Excel "GENERAL")
  db.get('SELECT COUNT(*) as n FROM tolvas', (err, row) => {
    if (err || row.n > 0) return;
    const ins = db.prepare(
      `INSERT INTO tolvas (folio,tipo,frecuencia,equipo,cantidad,punto_servicio,ubicacion,observaciones) VALUES (?,?,?,?,?,?,?,?)`
    );
    const seed = [
      ['001','ROLL-OFF','DIARIO','14 m3',1,'RASTRO MUNICIPAL','CARRETERA MIELERAS',null],
      ['002','ROLL-OFF','DIARIO','14 m3',1,'DEPORTIVA NAZARIO','AV. IGNACIO ALLENDE COL. CENTRO',null],
      ['003','ROLL-OFF','JUEVES','21 m3',1,'CAMPO MILITAR','CARRETERA TORREÓN - MATAMOROS','esta en la colonia'],
      ['004','ROLL-OFF','LLAMADA','21 m3',1,'CIUDAD INDUSTRIAL','CALLE JOAQUIN SERRANO CD. IND. TORREÓN',null],
      ['005','ROLL-OFF','VIERNES','30 m3',2,'CERESO','CERESO',null],
      ['006','ROLL-OFF','DIARIO','30 m3',2,'EVENTO HOMERO Y JORGE','EVENTO ESPECIAL',null],
      ['007','ROLL-OFF','DIARIO','30 m3',2,'BOULEVARD REVOLUCIÓN (FRENTE A LA ALIANZA)','BOULEVARD REVOLUCIÓN (FRENTE A LA ALIANZA)',null],
      ['008','ROLL-OFF','MARTES','30 m3',2,'BOSQUE VENUSTIANO CARRANZA','BOSQUE VENUSTIANO CARRANZA',null],
      ['009','ROLL-OFF','JUEVES','30 m3',1,'CAMPO MILITAR','CARRETERA TORREÓN - MATAMOROS',null],
      ['010','ROLL-OFF','LUNES','30 m3',1,'PARQUE FUNDADORES','CALLE MUZQUIZ Y CONSTITUCIÓN',null],
      ['011','ROLL-OFF','DIARIO','30 m3',2,'CORRALON MUNICIPAL','PERIFERICO RAUL LOPEZ SANCHEZ (PUERTA AMARILLA)','llantas'],
      ['012','ROLL-OFF','LUNES, MIERCOLES Y VIERNES','30 m3',2,'FRACCIONAMIENTO LAS VILLAS','LAS VILLAS',null],
      ['013','ROLL-OFF','POR LLAMADA','30 m3',1,'DEPORTIVA TORREÓN','BOULEVARD REVOLUCIÓN',null],
      ['014','ROLL-OFF','DIARIO','30 m3',1,'LEY SAULO','ATRÁS DE LEY SAULO',null],
      ['015','ROLL-OFF','LUNES, MIERCOLES Y VIERNES','30 m3',1,'BOSQUE URBANO','COL. RESIDENCIAL LAS ETNIAS','no estaba, mandó evidencia Miguel'],
      ['016','ROLL-OFF','DIARIO','30 m3',2,'ROVIROSA WADE','COL. ROVIROSA WADE',null],
      ['017','ROLL-OFF','DIARIO','30 m3',1,'LAGUNA SUR','EJIDO ZARAGOZA',null],
      ['018','ROLL-OFF','DIARIO','30 m3',3,'ESTERITO','COL. VILLAS DEL BOSQUE',null],
      ['019','ROLL-OFF','DIARIO','30 m3',1,'LAGUNA SUR','EJIDO ZARAGOZA',null],
      ['020','ROLL-OFF','MARTES','30 m3',1,'MANHATAN','DEPARTAMENTOS MANHATAN',null],
      ['021','ROLL-OFF','LLAMADA','30 m3',1,'PERLA','EXHACIENDA LA PERLA',null],
      ['022','ROLL-OFF','LLAMADA','30 m3',1,'JALISCO','EJIDO JALISCO',null],
      ['023','ROLL-OFF','LLAMADA','30 m3',1,'FLOR','EJIDO LA FLOR',null],
      ['024','ROLL-OFF','LLAMADA','30 m3',1,'JUAN EUGENIO','JUAN EUGENIO',null],
      ['025','ROLL-OFF','LLAMADA','30 m3',1,'FLOR DE JIMULCO','FLOR DE JIMULCO',null],
      ['026','ROLL-OFF','LLAMADA','30 m3',2,'COMPRESORA','COLONIA COMPRESORA',null],
      ['027','ROLL-OFF','LLAMADA','30 m3',1,'ESTADIO REVOLUCIÓN','COL. VISTA HERMOSA',null],
      ['028','ROLL-OFF','LUNES','30 m3',1,'CENTRO DE CONVENCIONES','CENTRO DE CONVENCIONES',null],
      ['029','FRONTAL','MIERCOLES Y SABADO','3 m3',1,'HOGAR CANINO','BLVD CONSTITUCIÓN S/N',null],
      ['030','FRONTAL','DIARIO','6 m3',2,'COL. AMISTAD','CERRADA SEGURA FONG',null],
      ['031','FRONTAL','DIARIO','6 m3',2,'PLAZA SAN JUANITO','CALLE MONTES DE OCA COL. SAN JOAQUIN',null],
      ['032','FRONTAL','LUNES A VIERNES','6 m3',1,'COMPLEJO LA JABONERA','COL. LA COMPRESORA',null],
      ['033','FRONTAL','VIERNES','6 m3',1,'MULTIDEPORTIVO','ANTIGUA TORREÓN - SAN PEDRO (PAPA) ATRÁS DEL BOSQUE URBANO',null],
      ['034','FRONTAL','JUEVES','6 m3',1,'DEPORTIVA DEL AEROPUERTO','AVILA CAMACHO',null],
      ['035','FRONTAL','VIERNES','6 m3',1,'DIF TORREÓN (ATRÁS DEL BOSQUE URBANO)','ANTIGUA TORREÓN - SAN PEDRO (PAPA) ATRÁS DEL BOSQUE URBANO',null],
      ['036','FRONTAL','MARTES','6 m3',1,'FORTALEZA GATES','AV. ALLENDE ORIENTE',null],
      ['037','FRONTAL','MARTES','6 m3',1,'ESC. SEC. TEC. #17','AV. BROMO',null],
      ['038','FRONTAL','LLAMADA','6 m3',2,'ESC. EMANCIPACIÓN PROLETARIA','EJIDO EL AGUILA',null],
      ['039','FRONTAL','MARTES','6 m3',1,'CENTRO ACADEMICO MULTIPLE (CAM)','AV. SAN CARLOS COL. VILLA CALIFORNIA',null],
      ['040','FRONTAL','LLAMADA','6 m3',1,'ESC. SECUNDARIA ELSA HERNANDEZ','CALZADA FCO. SARABIA Y ROVIROSA WADE',null],
      ['041','FRONTAL','MIERCOLES','6 m3',2,'CEBETA #1','CARRETERA LA PARTIDA TORREÓN',null],
      ['042','FRONTAL','VIERNES','6 m3',11,'UAC. CIUDAD UNIVERSITARIA','TORREÓN','1 en mantenimiento'],
      ['043','FRONTAL','LLAMADA','6 m3',2,'ESCUELA OCTAVIO PAZ','SIERRA DE MINA CD NAZAS',null],
      ['044','FRONTAL','VIERNES','6 m3',2,'ESC. SEC. NUEVA LAGUNA','EPIFANIO ZUÑIGA Y LAZARO CARDENAS',null],
      ['045','FRONTAL','MARTES','6 m3',2,'ESC. PRIMARIA GENERAL FELIPE ANGELES','RESIDENCIAL LAS TORRES',null],
      ['046','FRONTAL','LLAMADA','6 m3',2,'ESC. JUSTO SIERRA','CALLE L Y AVENIDA 4 PRIMERA DE MAYO','dirección pendiente de corregir'],
      ['047','FRONTAL','MARTES','6 m3',2,'ESC. VICTORIANO CEPEDA','GALEANA Y METALURGICA',null],
      ['048','FRONTAL','JUEVES','6 m3',2,'ESC. FEDERAL #3','TORREÓN COAH',null],
      ['049','FRONTAL','MIERCOLES','6 m3',3,'SECCION #35','PERIFERICO RAUL LOPEZ SANCHEZ S/N',null],
      ['050','FRONTAL','SABADO','6 m3',1,'SEMINARIO MAYOR','PRIVADA IRMA Y CALZ. SALVADOR CREEL',null],
      ['051','FRONTAL','LUNES','6 m3',1,'ESC. FEDERICO HERNANDEZ MIRELES','RESIDENCIAL DEL NORTE',null],
      ['052','FRONTAL','MARTES','6 m3',2,'ESC. TEC. NO. 77','BAHIA DE GUADALUPE Y ROVIROSA WADE',null],
      ['053','FRONTAL','MARTES Y VIERNES','6 m3',3,'ESC. SEC. TEC. NO. 1','BLVD REVOLUCIÓN',null],
      ['054','FRONTAL','JUEVES','6 m3',2,'RICARDO FLORES MAGON SEC. TEC. #42','CARMEN ROMAN',null],
      ['055','FRONTAL','LLAMADA','6 m3',1,'ESC. PRIMARIA GENERAL 20 30','BLVD. INDEPENDENCIA #2115 PTE. NUEVA ROSITA',null],
      ['056','FRONTAL','LLAMADA','6 m3',2,'PANTEON #1','SAN JOAQUIN',null],
      ['057','FRONTAL','MARTES Y VIERNES','6 m3',7,'CAMPO MILITAR #33','LA JOYA',null],
      ['058','FRONTAL','MARTES','6 m3',1,'ESC. PRIMARIA RUFINO TAMAYO','CARR. A SANTA FE',null],
      ['059','FRONTAL','VIERNES','6 m3',1,'ESCUELA LUCIO BLANCO','COL. LUCIO BLANCO',null],
      ['060','FRONTAL','MIERCOLES','6 m3',1,'SECRETARIA DE COMUNICACIONES Y TRANSPORTES','PERIFERICO RAUL LOPEZ SANCHEZ',null],
      ['061','FRONTAL','MARTES','6 m3',1,'SIMAS (BLVD CONSTITUCION)','BLVD CONSTITUCION #308 PTE',null],
      ['062','FRONTAL','MIERCOLES','6 m3',2,'INT SEC. TECNICA #13','EJIDO LA CONCHA',null],
      ['063','FRONTAL','LLAMADA','6 m3',1,'CONAGUA ALIANZA','MUZQUIZ #355 NTE. PUENTE PLATEADO',null],
      ['064','FRONTAL','MIERCOLES','6 m3',2,'FEDERAL 1','COL. AMPLIACION LOS ANGELES',null],
      ['065','FRONTAL','JUEVES','6 m3',1,'CERESO','CERESO INTERIOR',null],
      ['066','FRONTAL','JUEVES','6 m3',1,'CERESO','CERESO EXTERIOR',null],
      ['067','FRONTAL','MARTES Y VIERNES','6 m3',1,'CASA DEL ANCIANO','CASA DEL ANCIANO','estaba adentro'],
      ['068','FRONTAL','DIARIO','6 m3',1,'FRACC FOVISSTE','FRACC FOVISSTE (PALOMA)',null],
      ['069','FRONTAL','DIARIO','6 m3',1,'FRACC FOVISSTE','FRACC FOVISSTE (ZENZONTLE)',null],
      ['070','FRONTAL','DIARIO','6 m3',2,'FRACC FOVISSTE','FRACC FOVISSTE (PELICANO)',null],
      ['071','FRONTAL','JUEVES','6 m3',1,'CONAGUA','CONAGUA (AVILA CAMACHO)',null],
      ['072','FRONTAL','LUNES, MIERCOLES Y VIERNES','6 m3',1,'COL ZACATECAS','COL. ZACATECAS',null],
      ['073','FRONTAL','DIARIO','6 m3',1,'FRACC. FERROCARRILERA','FRACC. FERROCARRILERA (CIPRESES)',null],
      ['074','FRONTAL','DIARIO','6 m3',1,'FRACC. FERROCARRILERA','FRACC. FERROCARRILERA (TULIPANES)',null],
      ['075','FRONTAL','DIARIO','6 m3',2,'FRACC. FERROCARRILERA','FRACC. FERROCARRILERA (PROL. L. CARDENAS)',null],
      ['076','FRONTAL','DIARIO','6 m3',1,'FRACC. FERROCARRILERA','FRACC. FERROCARRILERA (PROL. L. CARDENAS FAYUCA)',null],
      ['077','FRONTAL','JUEVES','6 m3',2,'CETIS #156','EJIDO LA JOYA',null],
      ['078','FRONTAL','JUEVES','6 m3',1,'RASTRO MUNICIPAL','RASTRO MUNICIPAL',null],
      ['079','FRONTAL','MARTES Y VIERNES','6 m3',1,'CENTRO SAULO','CENTRO SAULO',null],
      ['080','FRONTAL','MARTES Y VIERNES','6 m3',1,'FCA','FCA',null],
      ['081','FRONTAL','LLAMADA','6 m3',1,'ESCUELA PRIMARIA EJIDO SAN LUIS','EJIDO SAN LUIS',null],
      ['082','FRONTAL','LUNES Y VIERNES','6 m3',1,'SEGURIDAD PUBLICA','SEGURIDAD PUBLICA (BRAVO Y PERIFERICO)',null],
      ['083','FRONTAL','JUEVES','6 m3',1,'PRIMARIA EJIDO LA PERLA','EJIDO LA PERLA',null],
      ['084','FRONTAL','MARTES','6 m3',1,'CASA HOGAR DIF','BLVD REVOLUCION',null],
      ['085','FRONTAL','VIERNES','6 m3',2,'DEPORTIVA LA COMPRESORA','DEPORTIVA LA COMPRESORA',null],
      ['086','FRONTAL','LLAMADA','6 m3',1,'ESC. PRIMARIA PLAN SEXENAL','EJIDO LA PAZ',null],
      ['087','FRONTAL','MIERCOLES','6 m3',1,'ESC. PRIMARIA EMILIANO ZAPATA','EJIDO RANCHO DE ANA',null],
      ['088','FRONTAL','MIERCOLES','6 m3',2,'UNIVERSIDAD ITT','EJIDO PASO DEL AGUILA',null],
      ['089','FRONTAL','MIERCOLES','6 m3',2,'ESCUELA PRIMARIA EJIDO SAN LUIS AGUSTIN MELGAR','EJIDO LA UNION',null],
      ['090','FRONTAL','MIERCOLES','6 m3',1,'LIBERATE LAGUNA','ENTRADA EJ. SAN AGUSTIN',null],
      ['091','FRONTAL','MIERCOLES','6 m3',2,'MANDO ESPECIAL DE LA LAGUNA','PERIFERICO RAUL LOPEZ SANCHEZ',null],
      ['092','FRONTAL','MIERCOLES','6 m3',1,'GUARDIA NACIONAL (POLICIA FEDERAL)','PERIFERICO RAUL LOPEZ SANCHEZ',null],
      ['093','FRONTAL','MIERCOLES','6 m3',1,'SAT','PERIFERICO RAUL LOPEZ SANCHEZ',null],
      ['094','FRONTAL','MIERCOLES','6 m3',1,'EDIFICIO COAHUILA DE LA MUJER','PERIFERICO RAUL LOPEZ SANCHEZ',null],
      ['095','FRONTAL','MIERCOLES','6 m3',1,'VIVERO MUNICIPAL','PERIFERICO RAUL LOPEZ SANCHEZ',null],
      ['096','FRONTAL','MIERCOLES','6 m3',1,'CORRALON MUNICIPAL','PERIFERICO RAUL LOPEZ SANCHEZ',null],
      ['097','FRONTAL','MIERCOLES','6 m3',2,'ESC. SEC. #36','PERIFERICO RAUL LOPEZ SANCHEZ',null],
      ['098','FRONTAL','DIARIO','6 m3',1,'CERRO DE LA CRUZ','MORELOS',null],
      ['099','FRONTAL','DIARIO','6 m3',1,'TORREON VIEJO','TORREON VIEJO',null],
      ['100','FRONTAL','JUEVES','6 m3',1,'SOLDADOS','AEROPUERTO AVILA CAMACHO',null],
      ['101','FRONTAL','JUEVES','6 m3',1,'MEZE','AVILA CAMACHO',null],
      ['102','FRONTAL','JUEVES','6 m3',1,'ESC. PRIM GENARO ROCHA','CALZ ABASTOS',null],
      ['103','FRONTAL','JUEVES','6 m3',1,'SKATE PARK','AVILA CAMACHO',null],
      ['104','FRONTAL','JUEVES','6 m3',1,'SIMAS LATINO','COL LATINO',null],
      ['105','FRONTAL','JUEVES','6 m3',2,'ESC SEC ELIZEO','COL LATINO',null],
      ['106','FRONTAL','JUEVES','6 m3',1,'SAT FERROPUERTOS (ADUANA)','FERROPUERTOS','aduana'],
      ['107','FRONTAL','JUEVES','6 m3',1,'PARQUE PIK','FERROPUERTOS',null],
      ['108','FRONTAL','MARTES','6 m3',1,'ESC. DONALDO RAMOS CLAMONT','JOYAS DE TORREON',null],
      ['109','FRONTAL','MARTES','6 m3',1,'CASA HOGAR ABRAZAME','SOL DE OTE ETAPA 3',null],
      ['110','FRONTAL','MARTES','6 m3',1,'ESC. SEC. TEC. JOAQUIN SANCHEZ','LOMA REAL',null],
      ['111','FRONTAL','MARTES','6 m3',2,'ESC SEC #54','COL VALLE VERDE',null],
      ['112','FRONTAL','MARTES','6 m3',2,'SECUNDARIA #7','COL FIDEL VELAZQUEZ',null],
      ['113','FRONTAL','MARTES','6 m3',2,'ESCUELA PRIMARIA','PLAN DE SAN LUIS BRAVO Y PERIFERICO',null],
      ['114','FRONTAL','MARTES','6 m3',2,'ESCUELA SEC. #92','COL SAN FELIPE',null],
      ['115','FRONTAL','MARTES','6 m3',2,'ESC. PRIM. SANTOS VALDEZ','COL NUEVA CALIFORNIA',null],
      ['116','FRONTAL','MARTES','6 m3',1,'SIMAS SALTILLO 400','SALTILLO 400',null],
      ['117','FRONTAL','MARTES','6 m3',2,'ESC PRIMARIA SERTOMA','SALTILLO 400',null],
      ['118','FRONTAL','JUEVES','6 m3',1,'ESC. SEC. #94','ZARAGOZA SUR',null],
      ['119','FRONTAL','MARTES Y VIERNES','6 m3',1,'UAC PSICOLOGIA','BLVD REVOLUCIÓN',null],
      ['120','FRONTAL','MARTES Y VIERNES','6 m3',1,'CENTRO DE IDIOMAS','BLVD REVOLUCIÓN',null],
      ['121','FRONTAL','VIERNES','6 m3',1,'CECITEC JABONERA','COL LA JABONERA',null],
      ['122','FRONTAL','VIERNES','6 m3',1,'ESC. SEC. BRAULIO HERNANDEZ','VENCEDORA',null],
      ['123','FRONTAL','LUNES','6 m3',2,'ESC. JESUS ALEJANDRO TORRES DE LA ROSA','COL RINCON LA MERCED',null],
      ['124','FRONTAL','LUNES','6 m3',2,'PREPARATORIA PVC','PVC',null],
      ['125','FRONTAL','MARTES','6 m3',2,'SECUNDARIA #8','ATRÁS DE CENTRO SAULO',null],
      ['126','FRONTAL','JUEVES','6 m3',2,'PANTEON #2','PANTEON',null],
      ['127','FRONTAL','VIERNES','6 m3',2,'JUSTO SIERRA','EDUARDO GUERRA',null],
      ['128','FRONTAL','MARTES Y VIERNES','6 m3',2,'SEC. #2','EDUARDO GUERRA',null],
      ['129','FRONTAL','MARTES','6 m3',2,'SECUNDARIA #12','CD NAZAS',null],
      ['130','FRONTAL','MARTES','6 m3',1,'SECCION #38','COLONIA DIVISIÓN',null],
      ['131','FRONTAL','LLAMADA','6 m3',2,'ESCUELA JARDINES UNIVERSIDAD','JARDINES UNIVERSIDAD',null],
      ['132','FRONTAL','LLAMADA','6 m3',2,'ESC. PRIM. MARGARITA MAZA DE JUAREZ','COL CAROLINAS',null],
      ['133','FRONTAL','JUEVES','6 m3',2,'ESC. 14 DE MARZO','PANCHO VILLA',null],
      ['134','FRONTAL','DIARIO','6 m3',1,'UTT','CARR. TORREÓN MATAMOROS',null],
      ['135','FRONTAL','JUEVES','6 m3',1,'SECUNDARIA NO. 10','COL. MOCTEZUMA',null],
      ['136','FRONTAL','MARTES Y VIERNES','6 m3',1,'FACULTAD DE DERECHO',null,null],
      ['137','FRONTAL','LLAMADA','6 m3',1,'SEP',null,null],
      ['138','FRONTAL','VIERNES','6 m3',1,'FISCALIA',null,null],
      ['139','FRONTAL','SABADO','6 m3',1,'VINICOLA',null,null],
      ['140','FRONTAL','MARTES','6 m3',1,'CECYTEC LA JOYA','A UN LADO DE FORTALEZA GATES',null],
      ['141','FRONTAL','MIERCOLES','6 m3',1,'CECYTEC LA CONCHA',null,null],
      ['142','FRONTAL','LLAMADA','6 m3',1,'PANTEON DE SAN ANTONIO',null,null],
      ['143','FRONTAL','JUEVES','6 m3',1,'ASFALTOS (BACHEO)',null,null],
      ['144','FRONTAL','LLAMADA','6 m3',2,'NAVARRA ESPAÑA','AV BROMO',null],
      ['145','FRONTAL','JUEVES','6 m3',1,'ALBERGUE VILLAS ZARAGOZA','VILLAS ZARAGOZA',null],
      ['146','FRONTAL','MIERCOLES Y SABADO','6 m3',1,'SUZAT',null,null],
      ['147','FRONTAL','MARTES','6 m3',3,'TORRES SENDEROS Y PARK','SENDEROS',null],
    ];
    seed.forEach(r => ins.run(r));
    ins.finalize();
    console.log('✔  147 puntos de servicio (tolvas/contenedores) insertados.');
  });
});

module.exports = db;
