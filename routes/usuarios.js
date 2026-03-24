const express = require('express');
const router  = express.Router();
const db      = require('../db/database');
const crypto  = require('crypto');
const { sessions } = require('./auth');

const ROLES = ['administrador','supervisor','pesaje','auditor','enlace'];

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

// GET / — lista todos los usuarios (solo admin)
router.get('/', async (req, res) => {
  if (req.user.rol !== 'administrador') return res.status(403).json({ error: 'Sin permisos' });
  try {
    const rows = await db.all_p(
      `SELECT id, usuario, nombre, rol, modulos, ultimo_acceso, activo FROM usuarios ORDER BY nombre`
    );
    res.json(rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// POST / — crear usuario (solo admin)
router.post('/', async (req, res) => {
  if (req.user.rol !== 'administrador') return res.status(403).json({ error: 'Sin permisos' });
  const { usuario, nombre, password, rol, modulos } = req.body;
  if (!usuario || !nombre || !password || !rol)
    return res.status(400).json({ error: 'Datos incompletos' });
  if (!ROLES.includes(rol))
    return res.status(400).json({ error: 'Rol inválido' });

  // modulos: null = usar defaults del rol; JSON string array = personalizado
  const modulosVal = modulos ? (typeof modulos === 'string' ? modulos : JSON.stringify(modulos)) : null;

  try {
    const existe = await db.get_p('SELECT id FROM usuarios WHERE usuario = ?', [usuario]);
    if (existe) return res.status(409).json({ error: 'El nombre de usuario ya existe' });

    const salt = crypto.randomBytes(16).toString('hex');
    const hash = hashPassword(password, salt);
    const result = await db.run_p(
      `INSERT INTO usuarios (usuario, nombre, password_hash, salt, rol, modulos, activo) VALUES (?,?,?,?,?,?,1)`,
      [usuario, nombre, hash, salt, rol, modulosVal]
    );
    const created = await db.get_p(
      'SELECT id, usuario, nombre, rol, modulos, activo FROM usuarios WHERE id=?',
      [result.lastID]
    );
    res.status(201).json(created);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// PUT /:id — actualizar usuario (solo admin)
router.put('/:id', async (req, res) => {
  if (req.user.rol !== 'administrador') return res.status(403).json({ error: 'Sin permisos' });
  const id = parseInt(req.params.id);
  const { nombre, rol, password, activo, modulos } = req.body;

  try {
    const user = await db.get_p('SELECT * FROM usuarios WHERE id=?', [id]);
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
    if (rol && !ROLES.includes(rol)) return res.status(400).json({ error: 'Rol inválido' });

    let salt = user.salt;
    let hash = user.password_hash;
    if (password) {
      salt = crypto.randomBytes(16).toString('hex');
      hash = hashPassword(password, salt);
    }

    // modulos: undefined = no cambiar; null = borrar personalización; array/string = actualizar
    let modulosVal = user.modulos;
    if (modulos !== undefined) {
      modulosVal = modulos === null ? null
        : (typeof modulos === 'string' ? modulos : JSON.stringify(modulos));
    }

    await db.run_p(
      `UPDATE usuarios SET nombre=?, rol=?, password_hash=?, salt=?, activo=?, modulos=? WHERE id=?`,
      [nombre || user.nombre, rol || user.rol, hash, salt,
       activo != null ? (activo ? 1 : 0) : user.activo, modulosVal, id]
    );
    const updated = await db.get_p(
      'SELECT id, usuario, nombre, rol, modulos, activo, ultimo_acceso FROM usuarios WHERE id=?',
      [id]
    );
    // Actualizar sesión activa del usuario si existe, para que los cambios
    // surtan efecto sin necesidad de cerrar e iniciar sesión
    for (const [token, sess] of sessions) {
      if (sess.id === id) {
        sess.nombre  = updated.nombre;
        sess.rol     = updated.rol;
        sess.modulos = updated.modulos || null;
      }
    }
    res.json(updated);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// DELETE /:id — eliminar usuario (solo admin, no puede eliminarse a sí mismo)
router.delete('/:id', async (req, res) => {
  if (req.user.rol !== 'administrador') return res.status(403).json({ error: 'Sin permisos' });
  const id = parseInt(req.params.id);
  if (id === req.user.id)
    return res.status(400).json({ error: 'No puedes eliminar tu propia cuenta' });

  try {
    const r = await db.run_p('DELETE FROM usuarios WHERE id=?', [id]);
    if (r.changes === 0) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.json({ deleted: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
