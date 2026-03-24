/**
 * routes/auth.js — Autenticación PASA
 * POST /api/auth/login   → { token, nombre, rol }
 * POST /api/auth/logout  → { ok: true }
 * GET  /api/auth/me      → { id, usuario, nombre, rol }
 */

const express = require('express');
const router  = express.Router();
const crypto  = require('crypto');
const db      = require('../db/database');

// Sesiones en memoria: token → { id, usuario, nombre, rol }
const sessions = new Map();

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { usuario, password } = req.body;
  if (!usuario || !password)
    return res.status(400).json({ error: 'Datos incompletos' });

  try {
    const user = await db.get_p(
      'SELECT * FROM usuarios WHERE usuario = ? AND activo = 1',
      [usuario]
    );
    if (!user)
      return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });

    const hash = hashPassword(password, user.salt);
    if (hash !== user.password_hash)
      return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });

    const token = crypto.randomBytes(32).toString('hex');
    sessions.set(token, {
      id:      user.id,
      usuario: user.usuario,
      nombre:  user.nombre,
      rol:     user.rol,
      modulos: user.modulos || null,
    });

    await db.run_p(
      `UPDATE usuarios SET ultimo_acceso = datetime('now','localtime') WHERE id = ?`,
      [user.id]
    );

    res.json({ token, nombre: user.nombre, rol: user.rol });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (token) sessions.delete(token);
  res.json({ ok: true });
});

// GET /api/auth/me
router.get('/me', (req, res) => {
  const token   = (req.headers.authorization || '').replace('Bearer ', '');
  const session = sessions.get(token);
  if (!session) return res.status(401).json({ error: 'No autenticado' });
  res.json(session);
});

// POST /api/auth/reauth — verifica contraseña para acceso sensible
router.post('/reauth', async (req, res) => {
  const token   = (req.headers.authorization || '').replace('Bearer ', '');
  const session = sessions.get(token);
  if (!session) return res.status(401).json({ error: 'No autenticado' });

  const { password } = req.body;
  if (!password) return res.status(400).json({ error: 'Contraseña requerida' });

  try {
    const user = await db.get_p('SELECT * FROM usuarios WHERE id = ?', [session.id]);
    if (!user) return res.status(401).json({ error: 'Usuario no encontrado' });

    const hash = hashPassword(password, user.salt);
    if (hash !== user.password_hash)
      return res.status(401).json({ error: 'Contraseña incorrecta' });

    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/auth/usuarios — solo administrador
router.get('/usuarios', async (req, res) => {
  const token   = (req.headers.authorization || '').replace('Bearer ', '');
  const session = sessions.get(token);
  if (!session || session.rol !== 'administrador')
    return res.status(403).json({ error: 'Sin permisos' });

  // IDs de usuarios con sesión activa en este momento
  const activos = new Set([...sessions.values()].map(s => s.id));

  try {
    const rows = await db.all_p(
      `SELECT id, usuario, nombre, rol, modulos, ultimo_acceso, activo FROM usuarios ORDER BY ultimo_acceso DESC`
    );
    res.json(rows.map(r => ({ ...r, en_sesion: activos.has(r.id) })));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = { router, sessions };
