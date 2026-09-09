#!/usr/bin/env node
'use strict';

/**
 * Supabase -> Aiven kopyası. Kaynak SİLİNMEZ, sadece okunur.
 *
 * .env:
 *   DATABASE_URL=...mevcut supabase...
 *   TARGET_DATABASE_URL=...aiven service uri...
 *
 *   npm run db:copy
 */

require('dotenv').config();
const { Pool } = require('pg');

const TABLES = [
  'users',
  'vehicles',
  'daily_rows',
  'events',
  'problems',
  'kv_store',
  'report',
  'print_history',
  'piyasa_cikanlar',
  'operation_notes',
  'signatures',
  'vehicle_edit_log',
  'driver_trips',
];

const SKIP_KV = new Set(['print_form_bg_v1']);
const BATCH = 150;

function poolFrom(url) {
  return new Pool({
    connectionString: url,
    ssl: { rejectUnauthorized: false },
    max: 2,
    connectionTimeoutMillis: 25000,
    statement_timeout: 180000,
  });
}

async function tableExists(pool, name) {
  const r = await pool.query(
    `SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = $1`,
    [name]
  );
  return r.rowCount > 0;
}

async function copyTable(src, dst, name) {
  if (!(await tableExists(src, name))) {
    console.log('  atlandi (kaynakta yok):', name);
    return 0;
  }
  if (!(await tableExists(dst, name))) {
    console.log('  atlandi (hedefte tablo yok, once uygulamayi Neon/Aiven URL ile bir kez acin):', name);
    return 0;
  }

  const countR = await src.query(`SELECT COUNT(*)::int AS c FROM ${name}`);
  const total = countR.rows[0].c;
  if (!total) {
    console.log('  bos:', name);
    return 0;
  }

  const colsR = await src.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1
     ORDER BY ordinal_position`,
    [name]
  );
  const cols = colsR.rows.map((row) => row.column_name);
  const colSql = cols.map((c) => `"${c}"`).join(', ');
  const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
  const conflict = name === 'kv_store' ? 'key' : 'id';
  const updates = cols
    .filter((c) => c !== conflict)
    .map((c) => `"${c}" = EXCLUDED."${c}"`)
    .join(', ');
  const insertSql = updates
    ? `INSERT INTO ${name} (${colSql}) VALUES (${placeholders})
       ON CONFLICT ("${conflict}") DO UPDATE SET ${updates}`
    : `INSERT INTO ${name} (${colSql}) VALUES (${placeholders})
       ON CONFLICT ("${conflict}") DO NOTHING`;

  let copied = 0;
  for (let offset = 0; offset < total; offset += BATCH) {
    const r = await src.query(`SELECT ${colSql} FROM ${name} OFFSET $1 LIMIT $2`, [offset, BATCH]);
    for (const row of r.rows) {
      if (name === 'kv_store' && SKIP_KV.has(row.key)) continue;
      await dst.query(insertSql, cols.map((c) => row[c]));
      copied += 1;
    }
    process.stdout.write(`  ${name}: ${Math.min(offset + BATCH, total)}/${total}\r`);
  }
  console.log(`  ${name}: ${copied} satir`);
  return copied;
}

async function main() {
  const sourceUrl = process.env.SOURCE_DATABASE_URL || process.env.DATABASE_URL;
  const targetUrl = process.env.TARGET_DATABASE_URL;
  if (!targetUrl) {
    console.error('TARGET_DATABASE_URL yok. Aiven Service URI degerini .env e ekleyin.');
    process.exit(1);
  }
  if (sourceUrl === targetUrl) {
    console.error('Kaynak ve hedef ayni olamaz.');
    process.exit(1);
  }

  const src = poolFrom(sourceUrl);
  const dst = poolFrom(targetUrl);
  try {
    await src.query('SELECT 1');
    console.log('Kaynak (Supabase) OK');
  } catch (e) {
    console.error('Kaynak acilmadi. Supabase hâlâ kilitli olabilir:', e.message);
    await src.end().catch(() => {});
    await dst.end().catch(() => {});
    process.exit(2);
  }
  try {
    await dst.query('SELECT 1');
    console.log('Hedef (Aiven) OK');
  } catch (e) {
    console.error('Aiven baglanamadi. Service URI ve SSL kontrol edin:', e.message);
    await src.end().catch(() => {});
    await dst.end().catch(() => {});
    process.exit(3);
  }

  console.log('Kopya basliyor (kaynak silinmez)...');
  let total = 0;
  for (const name of TABLES) {
    try {
      total += await copyTable(src, dst, name);
    } catch (e) {
      console.error('  HATA', name, e.message);
    }
  }
  console.log('Bitti. Kopyalanan satir:', total);
  await src.end();
  await dst.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
