#!/usr/bin/env node
'use strict';

require('dotenv').config();
const { Pool } = require('pg');
const { pgSsl } = require('../lib/pg-ssl');

async function main() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: pgSsl(),
  });
  try {
    const r = await pool.query('DELETE FROM kv_store WHERE key = $1', ['print_form_bg_v1']);
    console.log('print_form_bg_v1 silindi:', r.rowCount);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
