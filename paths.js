/**
 * paths.js — Rutas de datos configurables
 *
 * En local: usa la raíz del proyecto (comportamiento original).
 * En Railway: usa /data (volumen persistente), configurable con DATA_DIR.
 */

const path = require('path');

const DATA_DIR   = process.env.DATA_DIR || path.join(__dirname);
const DB_PATH    = path.join(DATA_DIR, 'pasa.db');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');

module.exports = { DATA_DIR, DB_PATH, UPLOADS_DIR };
