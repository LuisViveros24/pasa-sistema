const express = require('express');
const router  = express.Router();
const db      = require('../db/database');

// GET /api/config — todos los pares clave/valor como objeto plano
router.get('/', async (req, res) => {
  try {
    const rows = await db.all_p('SELECT clave, valor FROM configuracion');
    const cfg = {};
    rows.forEach(r => { cfg[r.clave] = r.valor; });
    res.json(cfg);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// GET /api/config/:clave
router.get('/:clave', async (req, res) => {
  try {
    const row = await db.get_p('SELECT * FROM configuracion WHERE clave=?', [req.params.clave]);
    if (!row) return res.status(404).json({ error: 'Clave no encontrada' });
    res.json(row);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/config/:clave — crea o actualiza
router.put('/:clave', async (req, res) => {
  try {
    const { valor } = req.body;
    if (valor == null) return res.status(400).json({ error: 'valor requerido' });
    await db.run_p(
      `INSERT INTO configuracion (clave, valor, updated_at)
       VALUES (?, ?, datetime('now','localtime'))
       ON CONFLICT(clave) DO UPDATE SET valor=excluded.valor, updated_at=excluded.updated_at`,
      [req.params.clave, String(valor)]
    );
    res.json({ ok: true, clave: req.params.clave, valor: String(valor) });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
