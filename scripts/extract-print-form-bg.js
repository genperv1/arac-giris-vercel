#!/usr/bin/env node
'use strict';

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const OUT_DIR = path.join(__dirname, '..', 'public', 'assets');

async function main() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  try {
    const meta = await pool.query(
      `SELECT octet_length(value)::int AS bytes FROM kv_store WHERE key = 'print_form_bg_v1'`
    );
    if (!meta.rows[0]) {
      console.log('DB de print_form_bg_v1 yok.');
      return;
    }
    console.log('DB blob boyutu:', meta.rows[0].bytes, 'byte');
    const r = await pool.query(`SELECT value FROM kv_store WHERE key = 'print_form_bg_v1'`);
    const raw = r.rows[0].value;
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (_) {
      parsed = { data: raw };
    }
    const data = String(parsed.data || raw || '');
    const m = data.match(/^data:([^;]+);base64,(.+)$/);
    if (!m) {
      console.log('Blob gorsel degil, silinebilir.');
      return;
    }
    const buf = Buffer.from(m[2], 'base64');
    const ext = m[1].includes('png') ? 'png' : 'jpg';
    fs.mkdirSync(OUT_DIR, { recursive: true });
    const out = path.join(OUT_DIR, `takip-form-bg.${ext}`);
    fs.writeFileSync(out, buf);
    console.log('Kaydedildi:', out, buf.length, 'byte');
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
