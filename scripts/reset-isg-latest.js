'use strict';

require('dotenv').config();
const { Pool } = require('pg');

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const r = await pool.query(
      `DELETE FROM isg_forms
       WHERE id = (
         SELECT id FROM isg_forms
         ORDER BY updated_at DESC NULLS LAST
         LIMIT 1
       )
       RETURNING id, plate_text, driver_name, signed`
    );
    if (!r.rows.length) {
      console.log('Silinecek ISG kaydı yok (zaten imzasız sayılır).');
      return;
    }
    const row = r.rows[0];
    console.log('ISG kaydı silindi → tekrar imzasız:', row.plate_text || '—', row.driver_name || '—', `(${row.id})`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
