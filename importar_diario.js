/**
 * importar_diario.js
 * ─────────────────
 * Importa los registros del archivo importar_diario.json
 * directamente a la base de datos pasa.db
 *
 * Uso:
 *   node importar_diario.js
 *
 * Ejecutar UNA sola vez desde la carpeta pasa-sistema/
 */

const sqlite3 = require('sqlite3').verbose();
const path    = require('path');
const fs      = require('fs');

const DB_PATH   = path.join(__dirname, 'pasa.db');
const JSON_PATH = path.join(__dirname, 'importar_diario.json');

if (!fs.existsSync(JSON_PATH)) {
  console.error('❌  No se encontró importar_diario.json en esta carpeta.');
  process.exit(1);
}

const registros = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'));
const db = new sqlite3.Database(DB_PATH, err => {
  if (err) { console.error('Error abriendo DB:', err.message); process.exit(1); }
});

const INSERT = `
  INSERT INTO diario
    (folio, fecha, hora, responsable, servicio, unidad, gps,
     colonia, calle, numero, actividades, observaciones, foto1, foto2, auditado)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,0)
`;

let ok = 0, dup = 0, err_count = 0;

db.serialize(() => {
  db.run('BEGIN TRANSACTION');

  for (const r of registros) {
    db.run(INSERT, [
      r.folio, r.fecha, r.hora, r.responsable, r.servicio,
      r.unidad, r.gps, r.colonia, r.calle, r.numero,
      r.actividades, r.observaciones, r.foto1, r.foto2
    ], function(err) {
      if (err) {
        if (err.message.includes('UNIQUE')) dup++;
        else { err_count++; console.error('Error en', r.folio, ':', err.message); }
      } else {
        ok++;
      }
    });
  }

  db.run('COMMIT', err => {
    if (err) { console.error('Error en COMMIT:', err.message); }
    else {
      console.log('');
      console.log('  ✅  Importación completada');
      console.log(`  ─────────────────────────────`);
      console.log(`  Insertados:  ${ok}`);
      if (dup)       console.log(`  Duplicados:  ${dup} (ya existían, se omitieron)`);
      if (err_count) console.log(`  Errores:     ${err_count}`);
      console.log('');
      console.log('  Abre http://localhost:3000 → Diario de Actividades');
      console.log('');
    }
    db.close();
  });
});
