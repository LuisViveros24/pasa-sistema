/**
 * middleware/auth.js — Protege rutas API con token de sesión
 */

const { sessions } = require('../routes/auth');

module.exports = function requireAuth(req, res, next) {
  const token   = (req.headers.authorization || '').replace('Bearer ', '');
  const session = sessions.get(token);
  if (!session) return res.status(401).json({ error: 'No autenticado' });
  req.user = session;
  next();
};
