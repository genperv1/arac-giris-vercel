'use strict';
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

async function main() {
  const seedPath = path.join(__dirname, '..', 'data', 'piyasa-customers-seed.json');
  if (!fs.existsSync(seedPath)) {
    console.error('Seed dosyası yok:', seedPath);
    process.exit(1);
  }
  const raw = fs.readFileSync(seedPath, 'utf8');
  const parsed = JSON.parse(raw);
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await pool.query(
    'INSERT INTO kv_store(key, value) VALUES($1, $2) ON CONFLICT(key) DO UPDATE SET value = EXCLUDED.value',
    ['piyasa_customer_list_v1', raw]
  );
  console.log('OK:', parsed.customers.length, 'müşteri kv_store\'a yazıldı');
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
