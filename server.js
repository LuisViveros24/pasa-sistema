/**
 * server.js  —  DGSPM Sistema Integral PASA
 * ─────────────────────────────────────────
 * Inicia con:  node server.js
 * Desarrollo:  npm run dev   (requiere nodemon)
 */

const express = require('express');
const cors    = require('cors');
const path    = require('path');
const fs      = require('fs');
const https   = require('https');

// ── Asegurar carpeta de uploads ─────────────────────────────────
const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR);

// ── App ─────────────────────────────────────────────────────────
const app = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: '20mb' }));      // permite JSON con imágenes base64 si fuera necesario
app.use(express.urlencoded({ extended: true }));

// Archivos estáticos: el frontend HTML y los uploads
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOADS_DIR));

// ── Rutas API ───────────────────────────────────────────────────
const requireAuth = require('./middleware/auth');

// Auth (pública)
app.use('/api/auth', require('./routes/auth').router);

// Rutas protegidas
app.use('/api/boletas',    requireAuth, require('./routes/boletas'));
app.use('/api/diario',     requireAuth, require('./routes/diario'));
app.use('/api/auditorias', requireAuth, require('./routes/auditorias'));
app.use('/api/actas',      requireAuth, require('./routes/actas'));
app.use('/api/reuniones',  requireAuth, require('./routes/reuniones'));
app.use('/api/stats',      requireAuth, require('./routes/stats'));
app.use('/api/rutas',      requireAuth, require('./routes/rutas'));
app.use('/api/reportes',    requireAuth, require('./routes/reportes'));
app.use('/api/tolvas',      requireAuth, require('./routes/tolvas'));
app.use('/api/penalidades', requireAuth, require('./routes/penalidades'));
app.use('/api/usuarios',       requireAuth, require('./routes/usuarios'));
app.use('/api/conciliaciones', requireAuth, require('./routes/conciliaciones'));
app.use('/api/config',         requireAuth, require('./routes/config'));
app.use('/api/lista-negra',   requireAuth, require('./routes/lista_negra'));

// Ruta de salud (útil para verificar que el server corre)
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString(), version: '1.0.0' });
});

// Fallback: cualquier ruta no-API sirve el frontend (para SPA futuro)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Arranque ────────────────────────────────────────────────────
const { execSync }  = require('child_process');
const PORT      = process.env.PORT       || 3000;
const PORT_HTTPS = process.env.PORT_HTTPS || 3443;

// Liberar puertos si ya están ocupados antes de iniciar
[PORT, PORT_HTTPS].forEach(p => {
  try {
    const pids = execSync(`lsof -ti :${p}`, { stdio: ['pipe','pipe','ignore'] }).toString().trim();
    if (pids) {
      pids.split('\n').forEach(pid => { try { process.kill(Number(pid), 'SIGKILL'); } catch(_){} });
      console.log(`  ⚡  Puerto ${p} liberado automáticamente.`);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 300);
    }
  } catch(_) {}
});

const { networkInterfaces } = require('os');
const nets = networkInterfaces();
let localIP = 'tu-ip-local';
for (const name of Object.keys(nets)) {
  for (const net of nets[name]) {
    if (net.family === 'IPv4' && !net.internal) { localIP = net.address; break; }
  }
}

function printBanner() {
  console.log('');
  console.log('  ╔══════════════════════════════════════════════════════╗');
  console.log('  ║   DGSPM — Sistema Integral PASA · Torreón           ║');
  console.log('  ╠══════════════════════════════════════════════════════╣');
  console.log(`  ║   Local HTTP   →  http://localhost:${PORT}               ║`);
  console.log(`  ║   Local HTTPS  →  https://localhost:${PORT_HTTPS}             ║`);
  console.log(`  ║   Red    HTTPS →  https://${localIP}:${PORT_HTTPS}         ║`);
  console.log('  ╠══════════════════════════════════════════════════════╣');
  console.log('  ║   📱 Celular: abre la URL "Red HTTPS" arriba        ║');
  console.log('  ║      Acepta el certificado en Avanzado > Continuar  ║');
  console.log('  ╚══════════════════════════════════════════════════════╝');
  console.log('');
  console.log('  Datos guardados en: pasa.db');
  console.log('  Fotos guardadas en: /uploads/');
  console.log('  Para detener el servidor: Ctrl + C');
  console.log('');
}

// Servidor HTTP (localhost dev)
const server = app.listen(PORT, '0.0.0.0', () => {});
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n  ❌  No se pudo liberar el puerto ${PORT}.\n`);
    process.exit(1);
  } else { throw err; }
});

// Servidor HTTPS (acceso desde celular / LAN)
const certPath = path.join(__dirname, 'certs', 'cert.pem');
const keyPath  = path.join(__dirname, 'certs', 'key.pem');

if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
  const httpsServer = https.createServer(
    { cert: fs.readFileSync(certPath), key: fs.readFileSync(keyPath) },
    app
  );
  httpsServer.listen(PORT_HTTPS, '0.0.0.0', () => { printBanner(); });
  httpsServer.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`\n  ❌  No se pudo liberar el puerto HTTPS ${PORT_HTTPS}.\n`);
    } else { throw err; }
  });
} else {
  // Sin certificados — solo HTTP
  server.on('listening', () => { printBanner(); });
  console.warn('  ⚠️  No se encontraron certificados SSL en /certs/. Solo HTTP disponible.');
}
