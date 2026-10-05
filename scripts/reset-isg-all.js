'use strict';

/** Tüm ISG (isg_forms) kayıtlarını siler — canlıya çıkmadan önce test verisini temizlemek için. */
require('dotenv').config();
const { Pool } = require('pg');

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL tanımlı değil (.env).');
    process.exit(1);
  }
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const before = await pool.query('SELECT COUNT(*)::int AS n FROM isg_forms');
    const n = before.rows[0] && before.rows[0].n != null ? before.rows[0].n : 0;
    if (n === 0) {
      console.log('ISG kaydı yok (isg_forms zaten boş).');
      return;
    }
    const del = await pool.query('DELETE FROM isg_forms RETURNING id');
    console.log('Silinen ISG kaydı:', del.rowCount, '(önce:', n + ')');
    const after = await pool.query('SELECT COUNT(*)::int AS n FROM isg_forms');
    console.log('Kalan:', after.rows[0].n);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
