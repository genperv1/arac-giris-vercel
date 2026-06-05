// server.js
// Express server + PostgreSQL (pg) + static file serving
require("dotenv").config();

const path = require("path");
const fs = require("fs");
const express = require("express");
const bodyParser = express.json;
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const compression = require('compression');
const helmet = require('helmet');

const { Pool } = require("pg");
const cron = require('node-cron');
const crypto = require('crypto');
const { validatePlateFormat } = require('./lib/plate-format');

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is missing in environment (.env)");
}

function envNumber(name, fallback, { min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER } = {}) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    throw new Error(`Invalid env ${name}: ${raw}`);
  }
  return parsed;
}

/** Rapor / yazdırma geçmişi: tarayıcı veya Vercel UTC'de olsa bile TR saati gösterilsin */
const REPORT_DISPLAY_TZ = process.env.REPORT_DISPLAY_TZ || 'Europe/Istanbul';

function formatReportInstant(ms) {
  const n = Number(ms);
  const d = new Date(n);
  if (!Number.isFinite(n) || isNaN(d.getTime())) return { tarih: '', saat: '' };
  const tz = REPORT_DISPLAY_TZ;
  const tarih = d.toLocaleDateString('tr-TR', { timeZone: tz });
  // tr-TR + toLocaleTimeString bazı Node sürümlerinde saat dilimini yanlış uygulayabiliyor; en-GB + h23 sabit 24s İstanbul saati
  const saat = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    hourCycle: 'h23'
  }).format(d);
  return { tarih, saat };
}

/** Rapor istatistikleri: ts → İstanbul saatine göre gün içi dakika (0–1439) */
function istanbulMinutesFromTs(tsMs) {
  try {
    const d = new Date(Number(tsMs));
    if (isNaN(d.getTime())) return null;
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: REPORT_DISPLAY_TZ,
      hour: 'numeric',
      minute: 'numeric',
      hour12: false,
      hourCycle: 'h23'
    }).formatToParts(d);
    const h = parseInt((parts.find((p) => p.type === 'hour') || {}).value, 10);
    const m = parseInt((parts.find((p) => p.type === 'minute') || {}).value, 10);
    if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
    return h * 60 + m;
  } catch (e) {
    return null;
  }
}

const PG_POOL_MAX = envNumber('PG_POOL_MAX', 5, { min: 1, max: 100 });
const PG_POOL_MIN = envNumber('PG_POOL_MIN', 2, { min: 0, max: 100 });
const PG_IDLE_TIMEOUT = envNumber('PG_IDLE_TIMEOUT', 30000, { min: 1000, max: 600000 });
const PG_CONNECT_TIMEOUT = envNumber('PG_CONNECT_TIMEOUT', 10000, { min: 1000, max: 120000 });
const PG_MAX_USES = envNumber('PG_MAX_USES', 7500, { min: 100, max: 1000000 });
const PG_STATEMENT_TIMEOUT = envNumber('PG_STATEMENT_TIMEOUT', 30000, { min: 1000, max: 300000 });
/** Slow-query console.warn eşiği (ms). Boş bırakılırsa 3000 — paylaşımlı DB’de ~1sn listeler uyarı spam’i yapmaz. 0 / off / false = uyarı kapalı. */
const SQL_SLOW_MS = (() => {
  const raw = process.env.SQL_SLOW_MS;
  if (raw === undefined || raw === null || raw === '') return 3000;
  const s = String(raw).trim().toLowerCase();
  if (s === '0' || s === 'off' || s === 'false') return 0;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 50 || n > 60000) {
    throw new Error(`Invalid env SQL_SLOW_MS: ${raw}`);
  }
  return n;
})();
/** When listing many vehicles (offset=0), read in keyset pages to avoid long single statements on modest DB hosts. */
const VEH_LIST_KEYSET_BATCH = envNumber('VEH_LIST_KEYSET_BATCH', 650, { min: 50, max: 5000 });

/** Statik .js / .css için Cache-Control max-age (saniye). 0 = önbellek yok. */
const STATIC_MAX_AGE_SEC = envNumber('STATIC_MAX_AGE_SEC', 60, { min: 0, max: 86400 });
const JSON_BODY_LIMIT = process.env.JSON_BODY_LIMIT || '2mb';
const URLENCODED_BODY_LIMIT = process.env.URLENCODED_BODY_LIMIT || '2mb';

// ✅ POSTGRESQL CONNECTION POOLING: Advanced configuration
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  // Connection pool settings
  max: PG_POOL_MAX, // maximum pool size
  min: PG_POOL_MIN, // minimum pool size
  idleTimeoutMillis: PG_IDLE_TIMEOUT, // close idle clients after 30 seconds
  connectionTimeoutMillis: PG_CONNECT_TIMEOUT, // return error after 10 seconds if connection cannot be established
  maxUses: PG_MAX_USES, // close (and replace) a connection after it has been used 7500 times
  allowExitOnIdle: false, // keep process alive even if all connections are idle
  application_name: process.env.PG_APP_NAME || 'arac-giris-app',
  statement_timeout: PG_STATEMENT_TIMEOUT,
});

// ✅ POOL EVENT HANDLERS: Monitor pool health and catch errors
pool.on('error', (err, client) => {
  console.error('❌ Unexpected pool error on idle client:', err.message || err);
  console.error('Client info:', client ? 'Active' : 'Unknown');
  // Don't exit the process on pool errors - let the pool handle reconnection
});

pool.on('connect', (client) => {
  console.log('✅ New client connected to PostgreSQL pool');
  // Set default timezone for this connection
  try {
    client.query('SET timezone = "UTC"').catch(e => 
      console.warn('Failed to set timezone:', e.message)
    );
  } catch (e) {}
});

pool.on('acquire', (client) => {
  // Uncomment for verbose logging:
  // console.log('🔵 Client acquired from pool');
});

pool.on('remove', (client) => {
  console.log('🔴 Client removed from pool');
});

// ✅ GRACEFUL SHUTDOWN: Clean up pool connections on exit
const gracefulShutdown = async (signal) => {
  console.log(`\n${signal} received. Starting graceful shutdown...`);
  try {
    await pool.end();
    console.log('✅ PostgreSQL pool closed successfully');
    process.exit(0);
  } catch (err) {
    console.error('❌ Error during pool shutdown:', err.message || err);
    process.exit(1);
  }
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('unhandledRejection', (reason) => {
  console.error('❌ Unhandled promise rejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('❌ Uncaught exception:', err);
});

// ✅ POOL HEALTH CHECK: Verify pool connectivity
let poolHealthy = false;
async function checkPoolHealth() {
  try {
    const client = await pool.connect();
    try {
      const result = await client.query('SELECT NOW() as now, current_database() as db');
      console.log('✅ Pool health check OK - DB:', result.rows[0].db, 'Time:', result.rows[0].now);
      poolHealthy = true;
      return true;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('❌ Pool health check FAILED:', err.message || err);
    poolHealthy = false;
    return false;
  }
}

function isRetryableDbError(err) {
  const code = String(err?.code || '').toUpperCase();
  const msg = String(err?.message || '');
  const retryableCodes = new Set([
    'ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'ECONNRESET',
    '08006', '57P01', '57P03', '40001'
  ]);
  return retryableCodes.has(code) || /Connection terminated|terminat|reset/i.test(msg);
}

function isReadOnlyQuery(text) {
  const q = String(text || '').trim().toUpperCase();
  return q.startsWith('SELECT') || q.startsWith('WITH');
}

// ✅ RETRY WRAPPER: Retry failed queries with exponential backoff + jitter
async function retryQuery(queryFn, maxRetries = 3, baseDelay = 250) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await queryFn();
    } catch (err) {
      const isLastAttempt = attempt === maxRetries;
      const isRetryable = isRetryableDbError(err);
      
      if (isLastAttempt || !isRetryable) {
        throw err;
      }
      
      const delay = Math.round((baseDelay * Math.pow(2, attempt - 1)) + Math.random() * 150);
      console.warn(`⚠️ Query failed (attempt ${attempt}/${maxRetries}), retrying in ${delay}ms:`, err.message);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

// Aligned with public/app.js::_normPlate — enables btree lookups on normalized plates
const VEH_PLATE_NORM_SQL_CEK = "regexp_replace(regexp_replace(lower(coalesce(cekiciplaka, '')), E'\\\\s+', '', 'g'), '[^a-z0-9ığüşöç]+', '', 'gi')";
const VEH_PLATE_NORM_SQL_DORSE = "regexp_replace(regexp_replace(lower(coalesce(dorseplaka, '')), E'\\\\s+', '', 'g'), '[^a-z0-9ığüşöç]+', '', 'gi')";

async function prepareSchema() {
  console.log('🔧 Preparing database schema...');
  
  // Verify pool health before schema operations
  const healthy = await checkPoolHealth();
  if (!healthy) {
    throw new Error('Database pool is not healthy. Cannot prepare schema.');
  }
  
  // TEXT id + TEXT json payload yaklaşımını bozmuyoruz
  await pool.query(`
    CREATE TABLE IF NOT EXISTS vehicles(
      id TEXT PRIMARY KEY,
      cekiciPlaka TEXT,
      dorsePlaka TEXT,
      data TEXT,
      sort_ts BIGINT DEFAULT 0
    );
  `);
  await pool.query(`ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS sort_ts BIGINT DEFAULT 0;`);
  
  // Add rejection columns to vehicles table
  await pool.query(`ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS rejection_status TEXT;`);
  await pool.query(`ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS rejection_duration TEXT;`);
  await pool.query(`ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS rejection_start_ts BIGINT;`);
  await pool.query(`ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS rejection_end_ts BIGINT;`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS daily_rows(
      id TEXT PRIMARY KEY,
      plaka TEXT,
      data TEXT,
      created_at BIGINT
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS events(
      id TEXT PRIMARY KEY,
      type TEXT,
      data TEXT,
      ts BIGINT
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS problems(
      id TEXT PRIMARY KEY,
      plate TEXT,
      data TEXT,
      ts BIGINT
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS kv_store(
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS report(
      id TEXT PRIMARY KEY,
      type TEXT,
      data TEXT,
      ts BIGINT
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS print_history(
      id TEXT PRIMARY KEY,
      plaka TEXT,
      firma TEXT,
      malzeme TEXT,
      tonaj TEXT,
      basim_yeri TEXT,
      sevkiyat_id TEXT,
      tarih BIGINT
    );
  `);
  // Legacy DB'ler için kolon migrasyonu
  await pool.query(`ALTER TABLE print_history ADD COLUMN IF NOT EXISTS basim_yeri TEXT;`);
  await pool.query(`ALTER TABLE print_history ADD COLUMN IF NOT EXISTS sofor TEXT;`);
  await pool.query(`ALTER TABLE print_history ADD COLUMN IF NOT EXISTS sevk_yeri TEXT;`);
  await pool.query(`ALTER TABLE print_history ADD COLUMN IF NOT EXISTS yukleme_turu TEXT;`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS operation_notes(
      id TEXT PRIMARY KEY,
      body TEXT NOT NULL,
      author_username TEXT,
      excel_type TEXT,
      rules TEXT,
      active BOOLEAN DEFAULT TRUE,
      created_at BIGINT
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_operation_notes_active_created ON operation_notes(active, created_at DESC);`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS signatures(
      id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      role TEXT NOT NULL,
      image_kind TEXT NOT NULL DEFAULT 'base64',
      image_data TEXT NOT NULL,
      active BOOLEAN DEFAULT TRUE,
      created_at BIGINT
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_signatures_role_active ON signatures(role, active);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_signatures_display_name ON signatures(upper(display_name));`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS vehicle_edit_log(
      id TEXT PRIMARY KEY,
      vehicle_id TEXT,
      plaka TEXT,
      summary TEXT,
      changes TEXT,
      user_id TEXT,
      edit_ts BIGINT
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_vehicle_edit_log_ts ON vehicle_edit_log(edit_ts DESC);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_vehicle_edit_log_plaka_ts ON vehicle_edit_log(plaka, edit_ts DESC);`);

  // (opsiyonel) indexler
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_daily_rows_created_at ON daily_rows(created_at DESC);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_problems_plate_ts ON problems(plate, ts DESC);`);
  // Global ORDER BY ts (GET /problems without ?plate=) — composite (plate, ts) cannot drive this sort.
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_problems_ts_desc ON problems(ts DESC);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_report_ts ON report(ts DESC);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_report_type_ts ON report(type, ts DESC);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_report_tarih_expr ON report ((data::json->>'tarih'));`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_report_cikis_expr ON report ((data::json->>'cikisYapildi'));`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_vehicles_sort_ts ON vehicles(sort_ts DESC);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_vehicles_sort_ts_id ON vehicles(sort_ts DESC, id DESC);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_vehicles_cekici_norm_lookup ON vehicles ((${VEH_PLATE_NORM_SQL_CEK}));`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_vehicles_dorse_norm_lookup ON vehicles ((${VEH_PLATE_NORM_SQL_DORSE}));`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_print_history_plaka_tarih ON print_history(plaka, tarih DESC);`);
  // Global ORDER BY tarih (GET /reports, unfiltered lists) — composite (plaka, tarih) is for per-plate only.
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_print_history_tarih_desc ON print_history(tarih DESC);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_print_history_basim_yeri ON print_history(basim_yeri);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_print_history_malzeme_tarih ON print_history(malzeme, tarih DESC);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_print_history_firma_malzeme ON print_history(firma, malzeme);`);

  try {
    await pool.query('ANALYZE vehicles');
  } catch (e) {
    console.warn('ANALYZE vehicles skipped:', e.message || e);
  }
  try {
    await pool.query('ANALYZE print_history');
  } catch (e) {
    console.warn('ANALYZE print_history skipped:', e.message || e);
  }
  try {
    await pool.query('ANALYZE problems');
  } catch (e) {
    console.warn('ANALYZE problems skipped:', e.message || e);
  }

  try {
    await seedDefaultSignatures();
  } catch (e) {
    console.warn('seedDefaultSignatures skipped:', e.message || e);
  }

  try {
    await seedDemoVehicleEditLogs();
  } catch (e) {
    console.warn('seedDemoVehicleEditLogs skipped:', e.message || e);
  }
}

function plateNormSql(col) {
  return `regexp_replace(regexp_replace(lower(coalesce(${col}, '')), E'\\\\s+', '', 'g'), '[^a-z0-9ığüşöç]+', '', 'gi')`;
}
const PLATE_NORM_SQL = plateNormSql('plaka');
const PLATE_NORM_SQL_PH = plateNormSql('ph.plaka');

const DEFAULT_KANTAR_SIGNATURES = [
  { display_name: 'BURAK KARATAŞ', path: 'signatures/burak_karatas.png' },
  { display_name: 'BEKİR DOĞRU', path: 'signatures/bekir_dogru.png' },
  { display_name: 'BATUHAN KOCABAY', path: 'signatures/batuhan_kocabay.png' },
  { display_name: 'BATUHAN CINAR', path: 'signatures/batuhan_cinar.png' },
  { display_name: 'BURAK TALAY', path: 'signatures/burak_talay.png' }
];

async function seedDefaultSignatures() {
  const cnt = await pool.query('SELECT COUNT(*)::int AS c FROM signatures');
  if ((cnt.rows[0] && cnt.rows[0].c) > 0) return;
  const publicDir = path.join(__dirname, 'public');
  for (const item of DEFAULT_KANTAR_SIGNATURES) {
    const filePath = path.join(publicDir, item.path.replace(/\//g, path.sep));
    let imageData = item.path;
    let imageKind = 'path';
    if (fs.existsSync(filePath)) {
      try {
        const buf = fs.readFileSync(filePath);
        imageData = `data:image/png;base64,${buf.toString('base64')}`;
        imageKind = 'base64';
      } catch (e) {
        console.warn('seed signature read failed:', item.path, e.message || e);
      }
    }
    const id = `sig_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
    await pool.query(
      `INSERT INTO signatures(id, display_name, role, image_kind, image_data, active, created_at)
       VALUES($1,$2,'kantar',$3,$4,TRUE,$5)`,
      [id, item.display_name, imageKind, imageData, Date.now()]
    );
  }
}

/** Anlatım / demo — gerçek araç değil; Ayarlar → Bilgi sekmesinde örnek görünsün diye */
async function seedDemoVehicleEditLogs() {
  const now = Date.now();
  const demos = [
    {
      id: 'demo_edit_plaka_001',
      vehicle_id: 'demo_vehicle_001',
      plaka: '43 HP 433',
      summary: 'Çekici plaka: 43 HP 433 → 43 HP 450 · Şoför adı: MEHMET YILMAZ → ZÜLFÜ USLU',
      changes: [
        { field: 'cekiciPlaka', label: 'Çekici plaka', old: '43 HP 433', new: '43 HP 450' },
        { field: 'soforAdi', label: 'Şoför adı', old: 'MEHMET', new: 'ZÜLFÜ' },
        { field: 'soforSoyadi', label: 'Şoför soyadı', old: 'YILMAZ', new: 'USLU' },
      ],
      user_id: 'GENPER',
      edit_ts: now - 2 * 60 * 60 * 1000,
    },
    {
      id: 'demo_edit_isim_002',
      vehicle_id: 'demo_vehicle_002',
      plaka: '34 ZFP 78',
      summary: 'Şoför adı: ALİ KAYA → HASAN ÖZTÜRK · Şoför soyadı: — → —',
      changes: [
        { field: 'soforAdi', label: 'Şoför adı', old: 'ALİ', new: 'HASAN' },
        { field: 'soforSoyadi', label: 'Şoför soyadı', old: 'KAYA', new: 'ÖZTÜRK' },
      ],
      user_id: 'GENPER',
      edit_ts: now - 5 * 60 * 60 * 1000,
    },
    {
      id: 'demo_edit_tel_003',
      vehicle_id: 'demo_vehicle_003',
      plaka: '06 ABT 123',
      summary: 'İletişim: 0532 508 43 02 → 0542 611 55 44',
      changes: [
        { field: 'iletisim', label: 'İletişim', old: '0532 508 43 02', new: '0542 611 55 44' },
      ],
      user_id: 'GENPER',
      edit_ts: now - 26 * 60 * 60 * 1000,
    },
    {
      id: 'demo_edit_karma_004',
      vehicle_id: 'demo_vehicle_004',
      plaka: '16 BCD 890',
      summary: 'Dorse plaka: 34 ABC 12 → 34 ZFP 78 · İletişim: 0535 100 20 30 → 0505 777 88 99 (+1)',
      changes: [
        { field: 'dorsePlaka', label: 'Dorse plaka', old: '34 ABC 12', new: '34 ZFP 78' },
        { field: 'iletisim', label: 'İletişim', old: '0535 100 20 30', new: '0505 777 88 99' },
        { field: 'soforAdi', label: 'Şoför adı', old: 'MUSTAFA', new: 'EMRE' },
      ],
      user_id: 'GENPER',
      edit_ts: now - 3 * 24 * 60 * 60 * 1000,
    },
  ];

  for (const row of demos) {
    await pool.query(
      `INSERT INTO vehicle_edit_log(id, vehicle_id, plaka, summary, changes, user_id, edit_ts)
       VALUES($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (id) DO NOTHING`,
      [
        row.id,
        row.vehicle_id,
        row.plaka,
        row.summary,
        JSON.stringify(row.changes),
        row.user_id,
        row.edit_ts,
      ]
    );
  }
}

function signatureRowToSrc(row) {
  if (!row || !row.image_data) return '';
  if (row.image_kind === 'path') {
    const p = String(row.image_data || '').trim();
    return p.startsWith('/') ? p : `/${p}`;
  }
  const raw = String(row.image_data || '').trim();
  if (raw.startsWith('data:')) return raw;
  return `data:image/png;base64,${raw}`;
}

// Report cleanup: disabled by default to keep full history stable on /rapor.html
const REPORT_CLEANUP_ENABLED = String(process.env.REPORT_CLEANUP_ENABLED || 'false').toLowerCase() === 'true';
const REPORT_RETENTION_MONTHS = Number(process.env.REPORT_RETENTION_MONTHS || '120');
const REPORT_CLEAN_CRON = process.env.REPORT_CLEAN_CRON || '0 0 1 * *'; // at 00:00 on day 1 of each month

async function deleteOldReports(months = REPORT_RETENTION_MONTHS) {
  try {
    const cutoff = Date.now() - Number(months) * 30 * 24 * 60 * 60 * 1000;
    const res = await q('DELETE FROM report WHERE ts < $1', [cutoff]);
    try { console.log(`Monthly cleanup: deleted ${res.rowCount || 0} reports older than ${months} month(s)`); } catch(e) {}
  } catch (e) {
    console.error('Failed to delete old reports:', e.message || e);
  }
}

function summarizeQuery(text) {
  return String(text || '').replace(/\s+/g, ' ').trim().slice(0, 240);
}

function parsePagination(req, defaults = {}) {
  const defaultLimit = defaults.defaultLimit || 100;
  const maxLimit = defaults.maxLimit || 1000;
  const defaultOffset = defaults.defaultOffset || 0;
  const limitRaw = Number(req.query.limit);
  const offsetRaw = Number(req.query.offset);
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(maxLimit, Math.trunc(limitRaw))) : defaultLimit;
  const offset = Number.isFinite(offsetRaw) ? Math.max(0, Math.trunc(offsetRaw)) : defaultOffset;
  return { limit, offset };
}

// ✅ ENHANCED QUERY HELPER: error logging, retry logic, timeout, slow-query logs
async function q(text, params = [], options = {}) {
  const defaultRetry = isReadOnlyQuery(text);
  const { retry = defaultRetry, timeout = PG_STATEMENT_TIMEOUT } = options;
  
  const queryFn = async () => {
    const client = await pool.connect();
    const startedAt = Date.now();
    try {
      const result = await client.query({
        text,
        values: params,
        statement_timeout: timeout
      });
      const elapsed = Date.now() - startedAt;
      if (SQL_SLOW_MS > 0 && elapsed >= SQL_SLOW_MS) {
        console.warn(`⚠️ Slow query ${elapsed}ms: ${summarizeQuery(text)}`);
      }
      return result;
    } finally {
      client.release();
    }
  };

  try {
    if (retry) {
      return await retryQuery(queryFn);
    } else {
      return await queryFn();
    }
  } catch (e) {
    console.error("❌ SQL error:", e.message, "\n📝 Query:", summarizeQuery(text), "\n🔢 Params:", params);
    console.error("Stack:", e.stack);
    throw e;
  }
}

function normPlateForLookup(p) {
  return String(p || '')
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[^a-z0-9ığüşöç]/gi, '');
}

/** Merge DB rejection columns onto API vehicle (nested + flat; bigint → number). */
function applyRejectionColumnsToVehicle(vehicle, row) {
  const st = row.rejection_status || null;
  if (st) {
    const numOrNull = (v) => {
      if (v == null || v === '') return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };
    const startTs = numOrNull(row.rejection_start_ts);
    const endTs = numOrNull(row.rejection_end_ts);
    vehicle.rejection = {
      status: st,
      duration: row.rejection_duration,
      startTs,
      endTs
    };
    vehicle.rejection_status = st;
    vehicle.rejection_duration = row.rejection_duration || null;
    vehicle.rejection_start_ts = startTs;
    vehicle.rejection_end_ts = endTs;
  } else {
    delete vehicle.rejection;
    delete vehicle.rejection_status;
    delete vehicle.rejection_duration;
    delete vehicle.rejection_start_ts;
    delete vehicle.rejection_end_ts;
  }
}

function mapVehicleRowToApiVehicle(row) {
  try {
    const vehicle = JSON.parse(row.data);
    if (!vehicle.kayitTarihi) {
      if (vehicle.created_at) {
        vehicle.kayitTarihi = new Date(vehicle.created_at).toLocaleString('tr-TR');
      } else if (row.id && /^\d+/.test(row.id)) {
        const timestamp = parseInt(row.id, 10);
        if (timestamp > 1000000000000) {
          vehicle.kayitTarihi = new Date(timestamp).toLocaleString('tr-TR');
        }
      }
    }
    applyRejectionColumnsToVehicle(vehicle, row);
    return vehicle;
  } catch {
    const vehicle = { id: row.id, cekiciPlaka: row.cekiciPlaka, dorsePlaka: row.dorsePlaka };
    applyRejectionColumnsToVehicle(vehicle, row);
    return vehicle;
  }
}

/**
 * Keyset pages of at most `batchSize` rows (no OFFSET) — avoids one very large SELECT
 * that often exceeds SQL_SLOW_MS on modest Railway Postgres instances.
 */
async function fetchVehiclesRowsKeyset(totalLimit, batchSize) {
  const client = await pool.connect();
  const cols = 'id, cekiciPlaka, dorsePlaka, data, rejection_status, rejection_duration, rejection_start_ts, rejection_end_ts, sort_ts';
  const acc = [];
  try {
    let lastSortTs = null;
    let lastId = null;
    while (acc.length < totalLimit) {
      const need = totalLimit - acc.length;
      const take = Math.min(batchSize, need);
      let text;
      let params;
      if (lastSortTs === null) {
        text = `SELECT ${cols} FROM vehicles ORDER BY sort_ts DESC, id DESC LIMIT $1`;
        params = [take];
      } else {
        text = `SELECT ${cols} FROM vehicles WHERE sort_ts < $2 OR (sort_ts = $2 AND id < $3) ORDER BY sort_ts DESC, id DESC LIMIT $1`;
        params = [take, lastSortTs, lastId];
      }
      const r = await client.query({
        text,
        values: params,
        statement_timeout: PG_STATEMENT_TIMEOUT
      });
      if (!r.rows.length) break;
      acc.push(...r.rows);
      const tail = r.rows[r.rows.length - 1];
      lastSortTs = tail.sort_ts;
      lastId = tail.id;
      if (r.rows.length < take) break;
    }
    return acc.slice(0, totalLimit);
  } finally {
    client.release();
  }
}

const app = express();

app.use(
  compression({
    threshold: 1024,
    filter: (req, res) => {
      try {
        const u = String(req.originalUrl || req.url || '');
        if (u.includes('/api/events-stream') || u.includes('/api/reports-stream') || u.includes('/api/events')) return false;
      } catch (e) {}
      return compression.filter(req, res);
    },
  })
);
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  })
);

function toApiError(err, fallbackStatus = 500, fallbackCode = 'INTERNAL_ERROR') {
  const status = Number(err?.status || fallbackStatus);
  const code = String(err?.code || fallbackCode);
  const message = String(err?.message || 'Unexpected error');
  return { status, code, message };
}

function sendApiError(res, err, fallbackStatus = 500, fallbackCode = 'INTERNAL_ERROR') {
  if (res.headersSent) return;
  const e = toApiError(err, fallbackStatus, fallbackCode);
  res.status(e.status).json({
    ok: false,
    error: {
      code: e.code,
      message: e.message,
      requestId: res.locals.requestId || null
    }
  });
}

async function safeRollback(client, context = '') {
  try {
    await client.query('ROLLBACK');
  } catch (rbErr) {
    console.error(`Rollback failed${context ? ` (${context})` : ''}:`, rbErr.message || rbErr);
  }
}

async function withTransaction(handler, context = 'tx') {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await handler(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await safeRollback(client, context);
    throw err;
  } finally {
    client.release();
  }
}

// Middleware order: body parsing before routes (restore-full için daha yüksek limit)
app.use((req, res, next) => {
  let limit = JSON_BODY_LIMIT;
  try {
    if (req.method === 'POST' && String(req.path || '') === '/api/restore-full') limit = '50mb';
  } catch (e) {}
  return bodyParser({ limit })(req, res, next);
});
app.use(express.urlencoded({ extended: true, limit: URLENCODED_BODY_LIMIT }));
app.use((req, res, next) => {
  res.locals.requestId = req.headers['x-request-id'] || crypto.randomUUID();
  res.setHeader('x-request-id', res.locals.requestId);
  next();
});

/** İstek süresi logu (ms). 0 veya boş = kapalı. Örn: REQUEST_LOG_SLOW_MS=800 */
const REQUEST_LOG_SLOW_MS = (() => {
  const raw = process.env.REQUEST_LOG_SLOW_MS;
  if (raw === undefined || raw === null || raw === '') return 0;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 50 && n <= 120000 ? n : 0;
})();
if (REQUEST_LOG_SLOW_MS > 0) {
  app.use((req, res, next) => {
    const t0 = Date.now();
    res.on('finish', () => {
      const ms = Date.now() - t0;
      if (ms >= REQUEST_LOG_SLOW_MS) {
        console.warn('[slow-request]', ms + 'ms', req.method, req.originalUrl || req.url);
      }
    });
    next();
  });
}

// Reverse proxy (Railway, Render, etc.) sends X-Forwarded-For; required for express-rate-limit + correct client IP.
// TRUST_PROXY=false disables; TRUST_PROXY=true forces on; production defaults to first hop.
(function configureTrustProxy() {
  const raw = String(process.env.TRUST_PROXY || '').trim().toLowerCase();
  if (raw === 'false' || raw === '0' || raw === 'no') return;
  if (raw === 'true' || raw === '1' || raw === 'yes' || process.env.NODE_ENV === 'production') {
    app.set('trust proxy', 1);
  }
})();

// ✅ SECURITY: Input validation & sanitization helpers
// Prevent XSS and data validation issues on the server side
function sanitizeString(input, maxLength = 1000) {
  if (!input) return '';
  let str = String(input).trim();
  if (str.length > maxLength) {
    str = str.substring(0, maxLength);
  }
  return str;
}

function validateEmail(email) {
  if (!email) return true;
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(String(email).trim());
}

function validatePhoneNumber(phone) {
  if (!phone) return true;
  const cleaned = String(phone).replace(/\D/g, '');
  return cleaned.length >= 10 && cleaned.length <= 11;
}

function parseDateOrEpoch(value) {
  const s = String(value || '').trim();
  if (!s) return null;
  if (/^\d+$/.test(s)) {
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }
  const m = s.match(/^(\d{2})\.(\d{2})\.(\d{4}) (\d{2}):(\d{2}):(\d{2})$/);
  if (m) {
    const ms = Date.parse(`${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5]}:${m[6]}`);
    return Number.isFinite(ms) ? ms : null;
  }
  return null;
}

function computeVehicleSortTs(vehicle) {
  return (
    parseDateOrEpoch(vehicle?.kayitTarihi) ||
    parseDateOrEpoch(vehicle?.created_at) ||
    parseDateOrEpoch(vehicle?.ts) ||
    parseDateOrEpoch(vehicle?.lastPrintedAt) ||
    Date.now()
  );
}

const VEHICLE_EDIT_LABELS = {
  cekiciPlaka: 'Çekici plaka',
  dorsePlaka: 'Dorse plaka',
  soforAdi: 'Şoför adı',
  soforSoyadi: 'Şoför soyadı',
  sofor2Adi: '2. şoför adı',
  sofor2Soyadi: '2. şoför soyadı',
  iletisim: 'İletişim',
  tcKimlik: 'TC kimlik',
  defaultFirma: 'Varsayılan firma',
  defaultMalzeme: 'Varsayılan malzeme',
  defaultSevkYeri: 'Varsayılan sevk yeri',
  defaultYuklemeNotu: 'Yükleme notu',
};

function normVehicleEditVal(field, val) {
  const s = String(val ?? '').trim();
  if (field === 'tcKimlik' || field === 'iletisim') return s.replace(/\D/g, '');
  if (field === 'cekiciPlaka' || field === 'dorsePlaka') return normPlateForLookup(s);
  return s.toUpperCase();
}

function buildVehicleEditDiff(oldObj, newObj) {
  const changes = [];
  Object.keys(VEHICLE_EDIT_LABELS).forEach((field) => {
    const label = VEHICLE_EDIT_LABELS[field];
    const ov = normVehicleEditVal(field, oldObj?.[field]);
    const nv = normVehicleEditVal(field, newObj?.[field]);
    if (ov !== nv) {
      changes.push({
        field,
        label,
        old: String(oldObj?.[field] ?? '').trim(),
        new: String(newObj?.[field] ?? '').trim(),
      });
    }
  });
  const summaryParts = changes.slice(0, 2).map((c) => `${c.label}: ${c.old || '—'} → ${c.new || '—'}`);
  let summary = summaryParts.join(' · ');
  if (changes.length > 2) summary += ` (+${changes.length - 2})`;
  return { changes, summary: summary || 'Düzenleme' };
}

async function maybeLogVehicleEdit(vehicleId, sanitized, userId) {
  try {
    const existing = await q('SELECT data FROM vehicles WHERE id = $1', [vehicleId]);
    if (!existing.rows[0]) return;
    let oldObj = {};
    try { oldObj = JSON.parse(existing.rows[0].data); } catch (e) { oldObj = {}; }
    const diff = buildVehicleEditDiff(oldObj, sanitized);
    if (!diff.changes.length) return;
    const logId = Date.now().toString() + Math.random().toString(16).slice(2);
    const plaka = sanitizeString(sanitized.cekiciPlaka || oldObj.cekiciPlaka || '', 50);
    await q(
      `INSERT INTO vehicle_edit_log(id, vehicle_id, plaka, summary, changes, user_id, edit_ts)
       VALUES($1, $2, $3, $4, $5, $6, $7)`,
      [
        logId,
        String(vehicleId),
        plaka,
        sanitizeString(diff.summary, 500),
        JSON.stringify(diff.changes),
        sanitizeString(userId || '', 80),
        Date.now(),
      ]
    );
  } catch (e) {
    console.warn('vehicle edit log skipped:', e.message || e);
  }
}

const UPSERT_VEHICLE_SQL = `
  INSERT INTO vehicles(id, cekiciPlaka, dorsePlaka, data, sort_ts)
  VALUES($1,$2,$3,$4,$5)
  ON CONFLICT (id) DO UPDATE SET
    cekiciPlaka = EXCLUDED.cekiciPlaka,
    dorsePlaka = EXCLUDED.dorsePlaka,
    data = EXCLUDED.data,
    sort_ts = EXCLUDED.sort_ts
`;

async function upsertVehicleRecord(executor, vehicleLike) {
  const id = String(vehicleLike.id || (Date.now().toString() + Math.random().toString(16).slice(2)));
  const merged = Object.assign({}, vehicleLike, { id });
  const cekiciPlaka = sanitizeString(merged.cekiciPlaka || '', 50);
  const dorsePlaka = sanitizeString(merged.dorsePlaka || '', 50);
  const raw = JSON.stringify(merged);
  const sortTs = computeVehicleSortTs(merged);
  await executor.query(UPSERT_VEHICLE_SQL, [id, cekiciPlaka, dorsePlaka, raw, sortTs]);
  return id;
}

function validateTCNumber(tc) {
  if (!tc) return true;
  return /^\d{11}$/.test(String(tc).trim());
}

// Optional: disable upstream HTTPS enforcement / redirecting (useful for local dev)
// Set DISABLE_SSL_ENFORCE=true in your .env to enable. This middleware will
// redirect requests arriving as HTTPS (via the X-Forwarded-Proto header)
// back to HTTP so the browser doesn't insist on TLS for localhost testing.
if (process.env.DISABLE_SSL_ENFORCE === 'true') {
  app.use((req, res, next) => {
    try {
      const proto = (req.headers['x-forwarded-proto'] || '').toString();
      if (proto && proto.toLowerCase().startsWith('https')) {
        const host = req.headers.host || 'localhost';
        return res.redirect('http://' + host + req.url);
      }
    } catch (e) {}
    next();
  });
}

// CORS
const corsOptions = {
  origin: process.env.CORS_ORIGIN || '*',
  optionsSuccessStatus: 200
};
app.use(cors(corsOptions));

// Rate limiting with IP-based banning
const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS || 1 * 60 * 1000);
const RATE_LIMIT_MAX = Number(process.env.RATE_LIMIT_MAX || 620);
const FAILED_LOGIN_THRESHOLD = Number(process.env.FAILED_LOGIN_THRESHOLD || 5); // Ban IP after N failed login attempts
const BAN_DURATION_MS = Number(process.env.BAN_DURATION_MS || 48 * 60 * 60 * 1000); // 48 hours
/** If true, repeated global rate-limit violations can ban an IP (legacy). Default: only 429, no ban. */
const BAN_ON_RATE_LIMIT = String(process.env.BAN_ON_RATE_LIMIT || '').toLowerCase() === 'true';

// IP-based rate limiter with request tracking per IP
const ipRequestCount = new Map(); // { ip: { count: number, resetTime: timestamp, failedLogins: number } }

// Ban list file path
const BAN_LIST_FILE = path.join(__dirname, 'banned_ips.json');

// Load banned IPs from file (must be a JSON object { "ip": { ... }, ... } — not an array)
let bannedIpsList = {};
function loadBannedIps() {
  try {
    if (fs.existsSync(BAN_LIST_FILE)) {
      const data = fs.readFileSync(BAN_LIST_FILE, 'utf8');
      const trimmed = data.trim();
      if (!trimmed) {
        bannedIpsList = {};
      } else {
        const parsed = JSON.parse(trimmed);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          bannedIpsList = parsed;
        } else {
          console.warn('banned_ips.json must be a JSON object {}, not an array. Resetting to {}.');
          bannedIpsList = {};
          saveBannedIps();
        }
      }
      console.log(`Loaded ${Object.keys(bannedIpsList).length} banned IPs from file`);
    } else {
      bannedIpsList = {};
    }
  } catch (e) {
    console.error('Error loading banned IPs:', e.message);
    bannedIpsList = {};
  }
}

let bannedIpsWatchTimer = null;
function startBannedIpsFileWatcher() {
  if (String(process.env.DISABLE_BAN_FILE_WATCH || '').toLowerCase() === 'true') return;
  let lastSnap = JSON.stringify(bannedIpsList);
  fs.watchFile(BAN_LIST_FILE, { interval: 2000 }, () => {
    clearTimeout(bannedIpsWatchTimer);
    bannedIpsWatchTimer = setTimeout(() => {
      try {
        loadBannedIps();
        const snap = JSON.stringify(bannedIpsList);
        if (snap !== lastSnap) {
          lastSnap = snap;
          console.log('banned_ips.json diskten yeniden yuklendi');
        }
      } catch (_) {}
    }, 400);
  });
}

// Save banned IPs to file
function saveBannedIps() {
  try {
    fs.writeFileSync(BAN_LIST_FILE, JSON.stringify(bannedIpsList, null, 2), 'utf8');
  } catch (e) {
    console.error('Error saving banned IPs:', e.message);
  }
}

// Get client IP (considering proxy headers)
function getClientIp(req) {
  return req.headers['x-forwarded-for']?.split(',')[0].trim() ||
         req.headers['x-real-ip'] ||
         req.connection.remoteAddress ||
         'unknown';
}

function normalizeClientIp(ip) {
  const s = String(ip || '').trim();
  if (!s) return 'unknown';
  if (s === '::1' || s === '::ffff:127.0.0.1') return '127.0.0.1';
  if (s.startsWith('::ffff:')) return s.slice(7);
  return s;
}

function isLoopbackIp(ip) {
  const n = normalizeClientIp(ip);
  return n === '127.0.0.1' || n === 'localhost';
}

function isBanExemptApiPath(req) {
  const p = String(req.originalUrl || req.url || '').split('?')[0];
  return p === '/api/settings/verify-access' || p.startsWith('/api/settings/bans');
}

const SETTINGS_ACCESS_PASSWORD = String(
  process.env.SETTINGS_ACCESS_PASSWORD || process.env.SHIFT_NOTES_DELETE_PASSWORD || '2026genper'
);

const PIYASA_DURUM_META_KV = 'piyasa_durum_meta_v1';

function getPiyasaDurumFreezeUntilMs() {
  const raw = String(process.env.PIYASA_DURUM_FREEZE_UNTIL || '2026-06-07T22:00:00+03:00').trim();
  const dateOnly = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnly) return new Date(`${dateOnly[1]}-${dateOnly[2]}-${dateOnly[3]}T00:00:00+03:00`).getTime();
  const dateTime = raw.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (dateTime) {
    const sec = dateTime[6] || '00';
    return new Date(`${dateTime[1]}-${dateTime[2]}-${dateTime[3]}T${dateTime[4]}:${dateTime[5]}:${sec}+03:00`).getTime();
  }
  const n = Date.parse(raw);
  return Number.isFinite(n) ? n : 0;
}

function isPiyasaDurumFrozen() {
  const until = getPiyasaDurumFreezeUntilMs();
  return until > 0 && Date.now() < until;
}

function piyasaDurumFreezeMessage() {
  const until = getPiyasaDurumFreezeUntilMs();
  if (!until || !isPiyasaDurumFrozen()) return '';
  const label = new Date(until).toLocaleString('tr-TR', {
    timeZone: 'Europe/Istanbul',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  return `Piyasa DURUM sayaçları ${label} tarihinden itibaren başlayacak.`;
}

function stripPiyasaOrderPrintFields(order) {
  if (!order || typeof order !== 'object') return order;
  return {
    ...order,
    printCount: 0,
    lastPrintAt: null,
    lastPrintPlate: null,
    printPlates: {},
  };
}

function stripPiyasaStatePrintStats(payload) {
  if (!payload || typeof payload !== 'object') return payload;
  const out = { ...payload, updatedAt: Date.now() };
  if (Array.isArray(out.orders)) {
    out.orders = out.orders.map(stripPiyasaOrderPrintFields);
  }
  if (Array.isArray(out.weekArchive)) {
    out.weekArchive = out.weekArchive.map((block) => ({
      ...block,
      orders: Array.isArray(block.orders) ? block.orders.map(stripPiyasaOrderPrintFields) : [],
    }));
  }
  return out;
}

async function readPiyasaDurumMeta() {
  try {
    const r = await q('SELECT value FROM kv_store WHERE key = $1', [PIYASA_DURUM_META_KV]);
    if (!r.rows[0]?.value) return { resetEpoch: 0, freezeUntil: getPiyasaDurumFreezeUntilMs() };
    const parsed = JSON.parse(r.rows[0].value);
    return {
      resetEpoch: Number(parsed.resetEpoch) || 0,
      freezeUntil: Number(parsed.freezeUntil) || getPiyasaDurumFreezeUntilMs(),
    };
  } catch (e) {
    return { resetEpoch: 0, freezeUntil: getPiyasaDurumFreezeUntilMs() };
  }
}

async function writePiyasaDurumMeta(meta) {
  const raw = JSON.stringify({
    resetEpoch: Number(meta.resetEpoch) || Date.now(),
    freezeUntil: Number(meta.freezeUntil) || getPiyasaDurumFreezeUntilMs(),
    resetAt: new Date().toISOString(),
  });
  await q(
    `INSERT INTO kv_store(key, value) VALUES($1,$2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [PIYASA_DURUM_META_KV, raw]
  );
}

async function resetPiyasaDurumData() {
  const del = await q('DELETE FROM print_history');
  const deleted = del.rowCount || 0;
  const resetEpoch = Date.now();
  await writePiyasaDurumMeta({ resetEpoch, freezeUntil: getPiyasaDurumFreezeUntilMs() });

  try {
    const pr = await q('SELECT value FROM kv_store WHERE key = $1', ['piyasa_state_v1']);
    if (pr.rows[0]?.value) {
      let payload = {};
      try { payload = JSON.parse(pr.rows[0].value); } catch (e) { payload = {}; }
      const cleaned = stripPiyasaStatePrintStats(payload);
      await q(
        `INSERT INTO kv_store(key, value) VALUES($1,$2)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        ['piyasa_state_v1', JSON.stringify(cleaned)]
      );
      broadcastEvent('piyasa_updated', { updatedAt: cleaned.updatedAt, orderCount: (cleaned.orders || []).length });
    }
  } catch (e) {
    console.warn('Piyasa state print reset skipped:', e.message || e);
  }

  broadcastReportUpdate({ type: 'piyasa_durum_reset', data: { resetEpoch, deleted } });
  return { deleted, resetEpoch };
}
const SETTINGS_TOKEN_TTL_MS = 30 * 60 * 1000;
const settingsAccessTokens = new Map();

function issueSettingsToken() {
  const token = crypto.randomBytes(24).toString('hex');
  settingsAccessTokens.set(token, Date.now() + SETTINGS_TOKEN_TTL_MS);
  return token;
}

function verifySettingsPassword(password) {
  return String(password || '') === SETTINGS_ACCESS_PASSWORD;
}

function isSettingsAuthorized(req) {
  const token = String(req.headers['x-settings-token'] || req.body?.settingsToken || '').trim();
  const exp = settingsAccessTokens.get(token);
  if (token && exp && Date.now() <= exp) return true;
  if (token && exp) settingsAccessTokens.delete(token);
  const password = String(req.body?.password || req.body?.settingsPassword || '').trim();
  return verifySettingsPassword(password);
}

function requireSettingsAccess(req, res, next) {
  if (isSettingsAuthorized(req)) return next();
  return res.status(403).json({ ok: false, error: 'Ayarlar parolası gerekli' });
}

function listBannedIpsPayload() {
  const now = Date.now();
  const banned = Object.entries(bannedIpsList).map(([key, data]) => {
    const ip = (data && data.ip) || key;
    const expiresAt = data && data.expiresAt ? Number(data.expiresAt) : 0;
    const bannedAt = data && data.bannedAt ? Number(data.bannedAt) : 0;
    return {
      ip,
      reason: (data && data.reason) || '—',
      bannedAt: bannedAt ? new Date(bannedAt).toISOString() : null,
      expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
      remainingMs: Math.max(0, expiresAt - now),
      active: expiresAt > now,
    };
  }).filter((row) => row.active);
  banned.sort((a, b) => (b.bannedAt || '').localeCompare(a.bannedAt || ''));
  return { banned, count: banned.length };
}

// Check if IP is banned
function isIpBanned(ip) {
  try {
    const key = normalizeClientIp(ip);
    const banData = bannedIpsList[key] || (key !== ip ? bannedIpsList[ip] : null);
    if (!banData) return false;
    if (banData.expiresAt && Date.now() < banData.expiresAt) {
      return true;
    }
    delete bannedIpsList[key];
    if (key !== ip) delete bannedIpsList[ip];
    saveBannedIps();
    return false;
  } catch (e) {
    console.error("Ban check error:", e.message);
    return false;
  }
}

// Ban an IP address
function banIp(ip, reason = 'Rate limit exceeded') {
  try {
    const normalized = normalizeClientIp(ip);
    if (isLoopbackIp(normalized)) {
      console.log(`IP ban atlandi (yerel): ${ip}`);
      return;
    }
    const banData = {
      ip: normalized,
      reason,
      bannedAt: Date.now(),
      expiresAt: Date.now() + BAN_DURATION_MS
    };
    bannedIpsList[normalized] = banData;
    saveBannedIps();
    console.log(`IP Banned: ${normalized} - Reason: ${reason}`);
  } catch (e) {
    console.error("Ban IP error:", e.message);
  }
}

function unbanIp(ip) {
  const normalized = normalizeClientIp(ip);
  let removed = false;
  if (bannedIpsList[normalized]) {
    delete bannedIpsList[normalized];
    removed = true;
  }
  if (normalized !== ip && bannedIpsList[ip]) {
    delete bannedIpsList[ip];
    removed = true;
  }
  if (removed) saveBannedIps();
  const ipData = ipRequestCount.get(normalized) || ipRequestCount.get(ip);
  if (ipData) {
    ipData.failedLogins = 0;
    ipRequestCount.set(normalized, ipData);
  }
  return removed;
}

// Rate limit middleware
async function rateLimitMiddleware(req, res, next) {
  const ip = normalizeClientIp(getClientIp(req));
  
  // Check if IP is banned
  const banned = isIpBanned(ip);
  if (banned && !isBanExemptApiPath(req)) {
    return res.status(403).json({
      ok: false,
      error: 'IP adresiniz geçici olarak engellendi. Ayarlar > Ban bölümünden kaldırılabilir veya süre dolana kadar bekleyin.',
      code: 'IP_BANNED',
    });
  }

  const now = Date.now();
  const ipData = ipRequestCount.get(ip) || { count: 0, resetTime: now + RATE_LIMIT_WINDOW_MS, failedLogins: 0 };

  // Reset counter if window expired
  if (now > ipData.resetTime) {
    ipData.count = 0;
    ipData.resetTime = now + RATE_LIMIT_WINDOW_MS;
    ipData.failedLogins = 0;
  }

  ipData.count++;
  ipRequestCount.set(ip, ipData);

  // Set rate limit headers
  res.setHeader('RateLimit-Limit', RATE_LIMIT_MAX);
  res.setHeader('RateLimit-Remaining', Math.max(0, RATE_LIMIT_MAX - ipData.count));
  res.setHeader('RateLimit-Reset', new Date(ipData.resetTime).toISOString());

  // Check if exceeded rate limit (429 only by default; ban only if BAN_ON_RATE_LIMIT=true)
  if (ipData.count > RATE_LIMIT_MAX) {
    if (BAN_ON_RATE_LIMIT) {
      ipData.failedLogins++;
      if (ipData.failedLogins >= FAILED_LOGIN_THRESHOLD) {
        banIp(ip, `Exceeded rate limit ${FAILED_LOGIN_THRESHOLD} times`);
        return res.status(403).json({
          ok: false,
          error: 'Çok fazla istek nedeniyle IP adresiniz geçici olarak engellendi.',
          code: 'IP_BANNED',
        });
      }
    }
    return res.status(429).json({ error: `Too many requests (${ipData.count}/${RATE_LIMIT_MAX}). Try again in ${Math.ceil((ipData.resetTime - now) / 1000)} seconds.` });
  }

  next();
}

app.use(rateLimitMiddleware);

// Root route -> GIRIS.html (MUST be before static middleware)
app.get("/", (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.sendFile(path.join(__dirname, "public", "GIRIS.html"));
});

// ✅ STATIC FILES: Serve only public directory (short cache for hashed-free assets)
app.use(
  express.static(path.join(__dirname, 'public'), {
    etag: true,
    lastModified: true,
    setHeaders: (res, filePath) => {
      const lower = String(filePath || '').toLowerCase();
      if (/\.html?$/.test(lower)) {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
        return;
      }
      if (STATIC_MAX_AGE_SEC > 0 && /\.(js|css|png|jpg|jpeg|gif|webp|svg|ico|woff2?|ttf|eot|webmanifest)$/.test(lower)) {
        res.setHeader('Cache-Control', `public, max-age=${STATIC_MAX_AGE_SEC}`);
      }
    },
  })
);

const api = express.Router();

/** Giriş endpoint'i: IP başına kısa pencerede ek sınır (başarılı girişler sayılmaz). */
const loginEndpointLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: (() => {
    const n = Number(process.env.LOGIN_BURST_MAX);
    return Number.isFinite(n) && n >= 5 && n <= 200 ? Math.trunc(n) : 35;
  })(),
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
});

// Auth initialization (JWT). Uses user.js helper which expects `q`.
const createAuth = require('./user');
const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_change_me';
/** Oturum süresi (saat). .env: AUTH_SESSION_HOURS=6 */
const AUTH_SESSION_HOURS = envNumber('AUTH_SESSION_HOURS', 6, { min: 1, max: 168 });
const AUTH_SESSION_EXPIRES = `${AUTH_SESSION_HOURS}h`;
const AUTH_SESSION_MS = AUTH_SESSION_HOURS * 60 * 60 * 1000;
const auth = createAuth(q, { jwtSecret: JWT_SECRET, expiresIn: AUTH_SESSION_EXPIRES });

// cookie options for auth token
const AUTH_COOKIE_NAME = 'auth_token';
const AUTH_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: (process.env.NODE_ENV === 'production'),
  sameSite: 'lax',
  maxAge: AUTH_SESSION_MS
};

// Login endpoint (no public register endpoint as requested)
api.post('/login', loginEndpointLimiter, async (req, res) => {
  try {
    const ip = normalizeClientIp(getClientIp(req));
    const body = req.body || {};
    const username = String(body.username || '').trim();
    const password = String(body.password || '');
    
    if (!username || !password) {
      // Increment failed login counter for this IP
      const ipData = ipRequestCount.get(ip) || { count: 0, resetTime: Date.now() + RATE_LIMIT_WINDOW_MS, failedLogins: 0 };
      ipData.failedLogins++;
      ipRequestCount.set(ip, ipData);
      
      return res.status(400).json({ ok: false, error: 'username and password required' });
    }

    const r = await auth.authenticateUser(username, password);
    if (!r.ok) {
      // Increment failed login counter for this IP
      const ipData = ipRequestCount.get(ip) || { count: 0, resetTime: Date.now() + RATE_LIMIT_WINDOW_MS, failedLogins: 0 };
      ipData.failedLogins++;
      ipRequestCount.set(ip, ipData);
      
      // Check if should ban after failed attempt
      if (ipData.failedLogins >= FAILED_LOGIN_THRESHOLD) {
        banIp(ip, `Failed login attempts exceeded (${ipData.failedLogins})`);
        return res.status(403).json({
          ok: false,
          error: 'Çok sayıda hatalı giriş nedeniyle IP adresiniz geçici olarak engellendi. Ayarlar > Ban bölümünden kaldırılabilir.',
          code: 'IP_BANNED',
        });
      }
      
      return res.status(401).json({ ok: false, error: 'invalid credentials' });
    }
    
    // Successful login - reset failed counter for this IP
    const ipData = ipRequestCount.get(ip);
    if (ipData) {
      ipData.failedLogins = 0;
      ipRequestCount.set(ip, ipData);
    }
    
    try {
      res.cookie(AUTH_COOKIE_NAME, r.token, AUTH_COOKIE_OPTIONS);
    } catch (e) {}
    return res.json({ ok: true, user: r.user });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e && e.message ? e.message : String(e) });
  }
});

// Return current user if token valid (aktif sekmede kayan oturum: cookie süresini uzatır)
api.get('/me', auth.verifyToken, async (req, res) => {
  try {
    const u = req.user;
    if (u && u.username) {
      const jwt = require('jsonwebtoken');
      const payload = { id: u.id, username: u.username, role: u.role || null };
      const token = jwt.sign(payload, JWT_SECRET, { expiresIn: AUTH_SESSION_EXPIRES });
      try {
        res.cookie(AUTH_COOKIE_NAME, token, AUTH_COOKIE_OPTIONS);
      } catch (e) {}
    }
    return res.json({ ok: true, user: req.user });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e && e.message ? e.message : String(e) });
  }
});

// Logout: clear auth cookie
api.post('/logout', (req, res) => {
  try {
    res.cookie(AUTH_COOKIE_NAME, '', Object.assign({}, AUTH_COOKIE_OPTIONS, { maxAge: 0 }));
  } catch (e) {}
  return res.json({ ok: true });
});

function extractAuthTokenFromRequest(req) {
  const authHeader = req.headers.authorization || req.headers.Authorization;
  if (authHeader && typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }
  if (req.headers && req.headers.cookie && typeof req.headers.cookie === 'string') {
    const cookies = req.headers.cookie.split(';').map((s) => s.trim());
    for (const c of cookies) {
      const idx = c.indexOf('=');
      if (idx <= 0) continue;
      const k = c.slice(0, idx).trim();
      const v = c.slice(idx + 1).trim();
      if (k === AUTH_COOKIE_NAME || k === 'auth_token' || k === 'token') {
        return decodeURIComponent(v);
      }
    }
  }
  return null;
}

// Kritik yazma işlemleri: verifyToken sonrası req.user veya httpOnly çerez ile oturum
function requireValidSession(req, res, next) {
  const jwt = require('jsonwebtoken');
  let decoded = req.user;

  if (!decoded) {
    const token = extractAuthTokenFromRequest(req);
    if (!token) {
      return res.status(401).json({
        error: 'Session required',
        code: 'SESSION_MISSING',
        message: 'Oturum süreniz dolmuş. Lütfen tekrar giriş yapınız.',
      });
    }
    try {
      decoded = jwt.verify(token, JWT_SECRET);
      req.user = decoded;
    } catch (jwtError) {
      console.error('Session validation error:', jwtError.message);
      return res.status(401).json({
        error: 'Invalid session',
        code: 'SESSION_INVALID',
        message: 'Oturum geçersiz. Lütfen tekrar giriş yapınız.',
      });
    }
  }

  const now = Math.floor(Date.now() / 1000);
  const exp = decoded.exp || 0;
  const timeUntilExpiry = exp - now;

  if (timeUntilExpiry <= 0) {
    return res.status(401).json({
      error: 'Session expired',
      code: 'SESSION_EXPIRED',
      message: 'Oturum süreniz dolmuş. Lütfen tekrar giriş yapınız.',
    });
  }

  const sessionWarnSec = Math.min(1800, Math.max(300, Math.floor(AUTH_SESSION_HOURS * 3600 * 0.1)));
  if (timeUntilExpiry <= sessionWarnSec) {
    res.setHeader('X-Session-Warning', 'Session expiring soon');
  }

  req.user = decoded;
  req.sessionExpiresIn = timeUntilExpiry;
  next();
}

// Bulk delete reports (before auth middleware to use cookie-based auth)
api.post("/reports/bulk-delete", async (req, res) => {
  try {
    const body = req.body || {};
    const ids = Array.isArray(body.ids) ? body.ids.filter((x) => typeof x === "string" && x.trim() !== "") : [];
    if (!ids.length) return res.json({ ok: true, deleted: 0 });

    // Delete from print_history table
    let deletedCount = 0;
    for (const id of ids) {
      const result = await q("DELETE FROM print_history WHERE id = $1", [id]);
      deletedCount += result.rowCount || 0;
    }
    
    // Broadcast real-time update to all connected clients
    broadcastReportUpdate({
      type: 'reports_deleted',
      data: { ids }
    });
    
    res.json({ ok: true, deleted: deletedCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Public health check (Railway/monitoring — auth gerekmez)
api.get("/health", async (req, res) => {
  try {
    const poolInfo = {
      totalCount: pool.totalCount,
      idleCount: pool.idleCount,
      waitingCount: pool.waitingCount,
    };
    const healthy = await checkPoolHealth();
    if (healthy) {
      return res.json({
        ok: true,
        status: 'healthy',
        pool: poolInfo,
        timestamp: new Date().toISOString()
      });
    }
    return res.status(503).json({
      ok: false,
      status: 'unhealthy',
      pool: poolInfo,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    return res.status(503).json({
      ok: false,
      status: 'error',
      error: err.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Protect all following API routes with JWT verification
api.use(auth.verifyToken);

// Vehicles (ordered by most-recent timestamp inside the JSON `data` field)
api.get("/vehicles", async (req, res) => {
  try {
    const { limit, offset } = parsePagination(req, { defaultLimit: 5000, maxLimit: 20000 });
    let rows;
    // Keyset for every offset=0 request — avoids a single large LIMIT/OFFSET SELECT that trips SQL_SLOW_MS.
    if (offset === 0) {
      rows = await fetchVehiclesRowsKeyset(limit, VEH_LIST_KEYSET_BATCH);
    } else {
      const r = await q(`
      SELECT id, cekiciPlaka, dorsePlaka, data, rejection_status, rejection_duration, rejection_start_ts, rejection_end_ts
      FROM vehicles
      ORDER BY sort_ts DESC, id DESC
      LIMIT $1 OFFSET $2
    `, [limit, offset]);
      rows = r.rows || [];
    }
    const parsed = rows.map((row) => mapVehicleRowToApiVehicle(row));
    res.json(parsed);
  } catch (err) {
    sendApiError(res, err, 500, 'VEHICLES_LIST_FAILED');
  }
});

// Single-vehicle fetch by normalized plate (indexed) — avoids downloading the full fleet
api.get("/vehicles/lookup", async (req, res) => {
  try {
    const plate = String(req.query.plate || '').trim();
    if (!plate) {
      return res.status(400).json({ error: 'plate query parameter required' });
    }
    const norm = normPlateForLookup(plate);
    if (!norm) {
      return res.json(null);
    }
    const r = await q(
      `SELECT id, cekiciPlaka, dorsePlaka, data, rejection_status, rejection_duration, rejection_start_ts, rejection_end_ts
       FROM vehicles
       WHERE ${VEH_PLATE_NORM_SQL_CEK} = $1 OR ${VEH_PLATE_NORM_SQL_DORSE} = $1
       ORDER BY sort_ts DESC, id DESC
       LIMIT 3`,
      [norm]
    );
    const rows = r.rows || [];
    const parsed = rows.map((row) => mapVehicleRowToApiVehicle(row));
    return res.json(parsed[0] || null);
  } catch (err) {
    sendApiError(res, err, 500, 'VEHICLES_LOOKUP_FAILED');
  }
});

/** Toplu plaka araması — sorunlar geçmiş listesinde N+1 lookup'u önler */
api.post("/vehicles/lookup-batch", async (req, res) => {
  try {
    const raw = Array.isArray(req.body?.plates) ? req.body.plates : [];
    const norms = [...new Set(raw.map((p) => normPlateForLookup(p)).filter(Boolean))].slice(0, 80);
    if (!norms.length) return res.json({});

    const r = await q(
      `WITH wanted AS (SELECT unnest($1::text[]) AS pnorm)
       SELECT DISTINCT ON (w.pnorm)
         w.pnorm,
         v.id, v.cekiciPlaka, v.dorseplaka, v.data,
         v.rejection_status, v.rejection_duration, v.rejection_start_ts, v.rejection_end_ts, v.sort_ts
       FROM wanted w
       INNER JOIN vehicles v ON (
         ${VEH_PLATE_NORM_SQL_CEK} = w.pnorm OR ${VEH_PLATE_NORM_SQL_DORSE} = w.pnorm
       )
       ORDER BY w.pnorm, v.sort_ts DESC NULLS LAST, v.id DESC`,
      [norms]
    );

    const out = Object.fromEntries(norms.map((n) => [n, null]));
    for (const row of r.rows || []) {
      const key = row.pnorm;
      if (!key || out[key]) continue;
      out[key] = mapVehicleRowToApiVehicle(row);
    }
    return res.json(out);
  } catch (err) {
    sendApiError(res, err, 500, 'VEHICLES_LOOKUP_BATCH_FAILED');
  }
});

api.get("/vehicles/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const r = await q("SELECT data FROM vehicles WHERE id = $1", [id]);
    if (!r.rows[0]) return res.status(404).json({ error: "Not found" });
    try {
      return res.json(JSON.parse(r.rows[0].data));
    } catch {
      return res.json({ raw: r.rows[0].data });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

api.post("/vehicles", async (req, res) => { // requireValidSession geçici olarak kaldırıldı
  try {
    const v = req.body || {};
    const id = String(v.id || (Date.now().toString() + Math.random().toString(16).slice(2)));

    // ✅ SECURITY: Validate and sanitize input data
    const cekiciPlaka = sanitizeString(v.cekiciPlaka || "", 50);
    const dorsePlaka = sanitizeString(v.dorsePlaka || "", 50);
    
    // Validate Turkish plate format if provided (relaxed validation)
    if (cekiciPlaka && !validatePlateFormat(cekiciPlaka)) {
      console.warn('Rejected çekici plaka:', cekiciPlaka, 'Original:', v.cekiciPlaka);
      return res.status(400).json({ error: 'Invalid çekici plaka format', received: cekiciPlaka });
    }
    if (dorsePlaka && !validatePlateFormat(dorsePlaka)) {
      console.warn('Rejected dorse plaka:', dorsePlaka, 'Original:', v.dorsePlaka);
      return res.status(400).json({ error: 'Invalid dorse plaka format', received: dorsePlaka });
    }

    // Validate driver info fields
    if (v.tcKimlik && !validateTCNumber(v.tcKimlik)) {
      return res.status(400).json({ error: 'Invalid TC number format' });
    }
    if (v.iletisim && !validatePhoneNumber(v.iletisim)) {
      return res.status(400).json({ error: 'Invalid phone number format' });
    }

    // Sanitize text fields
    const sanitized = {
      ...v,
      cekiciPlaka,
      dorsePlaka,
      soforAdi: sanitizeString(v.soforAdi || "", 100),
      soforSoyadi: sanitizeString(v.soforSoyadi || "", 100),
      sofor2Adi: sanitizeString(v.sofor2Adi || "", 100),
      sofor2Soyadi: sanitizeString(v.sofor2Soyadi || "", 100),
      tcKimlik: sanitizeString(v.tcKimlik || "", 11),
      iletisim: sanitizeString(v.iletisim || "", 20),
      defaultFirma: sanitizeString(v.defaultFirma || "", 100),
      defaultMalzeme: sanitizeString(v.defaultMalzeme || "", 100),
      defaultSevkYeri: sanitizeString(v.defaultSevkYeri || "", 200),
      defaultYuklemeNotu: sanitizeString(v.defaultYuklemeNotu || "", 500),
      id
    };

    const raw = JSON.stringify(sanitized);

    // Enforce 420-character limit on the serialized `data` field
    if (typeof raw === 'string' && raw.length > 2000) {
  return res.status(400).json({ error: 'data field exceeds 2000 characters' });
}
    
    const userId = sanitizeString(v.editedBy || v.userId || '', 80);
    await maybeLogVehicleEdit(id, sanitized, userId);

    // INSERT OR REPLACE -> UPSERT
    await upsertVehicleRecord({ query: (text, params) => q(text, params, { retry: true }) }, sanitized);

    // Broadcast real-time update to all connected clients
    broadcastEvent('vehicle_created', { vehicle: sanitized, id });

    res.json({ ok: true, id });
  } catch (err) {
    sendApiError(res, err, 500, 'VEHICLE_SAVE_FAILED');
  }
});

api.put("/vehicles/:id", requireValidSession, async (req, res) => {
  try {
    const id = sanitizeString(req.params.id, 100);
    const v = req.body || {};
    
    // ✅ SECURITY: Validate and sanitize input data
    const cekiciPlaka = sanitizeString(v.cekiciPlaka || "", 50);
    const dorsePlaka = sanitizeString(v.dorsePlaka || "", 50);
    
    // Validate Turkish plate format if provided (relaxed validation)
    if (cekiciPlaka && !validatePlateFormat(cekiciPlaka)) {
      console.warn('Rejected çekici plaka:', cekiciPlaka, 'Original:', v.cekiciPlaka);
      return res.status(400).json({ error: 'Invalid çekici plaka format', received: cekiciPlaka });
    }
    if (dorsePlaka && !validatePlateFormat(dorsePlaka)) {
      console.warn('Rejected dorse plaka:', dorsePlaka, 'Original:', v.dorsePlaka);
      return res.status(400).json({ error: 'Invalid dorse plaka format', received: dorsePlaka });
    }

    // Validate driver info fields
    if (v.tcKimlik && !validateTCNumber(v.tcKimlik)) {
      return res.status(400).json({ error: 'Invalid TC number format' });
    }
    if (v.iletisim && !validatePhoneNumber(v.iletisim)) {
      return res.status(400).json({ error: 'Invalid phone number format' });
    }

    // Sanitize all text fields
    const sanitized = {
      ...v,
      id,
      cekiciPlaka,
      dorsePlaka,
      soforAdi: sanitizeString(v.soforAdi || "", 100),
      soforSoyadi: sanitizeString(v.soforSoyadi || "", 100),
      sofor2Adi: sanitizeString(v.sofor2Adi || "", 100),
      sofor2Soyadi: sanitizeString(v.sofor2Soyadi || "", 100),
      tcKimlik: sanitizeString(v.tcKimlik || "", 11),
      iletisim: sanitizeString(v.iletisim || "", 20),
      defaultFirma: sanitizeString(v.defaultFirma || "", 100),
      defaultMalzeme: sanitizeString(v.defaultMalzeme || "", 100),
      defaultSevkYeri: sanitizeString(v.defaultSevkYeri || "", 200),
      defaultYuklemeNotu: sanitizeString(v.defaultYuklemeNotu || "", 500),
    };

    const raw = JSON.stringify(sanitized);

    const userId = sanitizeString((req.user && req.user.username) || v.editedBy || '', 80);
    await maybeLogVehicleEdit(id, sanitized, userId);

    await upsertVehicleRecord({ query: (text, params) => q(text, params, { retry: true }) }, sanitized);

    // Broadcast real-time update to all connected clients
    broadcastEvent('vehicle_updated', { vehicle: sanitized, id });

    res.json({ ok: true, id });
  } catch (err) {
    sendApiError(res, err, 500, 'VEHICLE_UPDATE_FAILED');
  }
});

api.delete("/vehicles/:id", async (req, res) => { // requireValidSession geçici olarak kaldırıldı
  try {
    const id = req.params.id;
    await q("DELETE FROM vehicles WHERE id = $1", [id]);
    
    // Broadcast real-time update to all connected clients
    broadcastEvent('vehicle_deleted', { id });
    
    res.json({ ok: true, id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Simple vehicle rejection endpoint
api.post("/vehicles/reject-simple", async (req, res) => {
  try {
    const { id, duration, customDays } = req.body || {};
    
    if (!id) {
      return res.status(400).json({ error: 'Vehicle ID required' });
    }
    
    // Validate duration
    const validDurations = ['1_month', '3_months', '6_months', '1_year', 'unlimited', 'custom'];
    if (!validDurations.includes(duration)) {
      return res.status(400).json({ error: 'Invalid rejection duration' });
    }
    
    // Calculate end timestamp based on duration
    let endTimestamp = null;
    let durationText = '';
    
    if (duration === 'unlimited') {
      durationText = 'Süresiz red';
      endTimestamp = null;
    } else if (duration === 'custom') {
      const days = customDays || 30;
      if (days < 1 || days > 365) {
        return res.status(400).json({ error: 'Custom days must be between 1 and 365' });
      }
      durationText = `${days} gün süreli red`;
      endTimestamp = Date.now() + (days * 24 * 60 * 60 * 1000);
    } else {
      const months = {
        '1_month': 1,
        '3_months': 3,
        '6_months': 6,
        '1_year': 12
      }[duration];
      
      durationText = {
        '1_month': '1 ay süreli red',
        '3_months': '3 ay süreli red',
        '6_months': '6 ay süreli red',
        '1_year': '1 yıl süreli red'
      }[duration];
      
      endTimestamp = Date.now() + (months * 30 * 24 * 60 * 60 * 1000);
    }
    
    // Update vehicle with rejection data
    await q(
      `UPDATE vehicles SET 
        rejection_status = $1, 
        rejection_duration = $2, 
        rejection_start_ts = $3, 
        rejection_end_ts = $4 
       WHERE id = $5`,
      ['rejected', durationText, Date.now(), endTimestamp, id]
    );
    
    // Broadcast real-time update to all connected clients
    broadcastEvent('vehicle_rejected', { id, duration: durationText, endTs: endTimestamp });
    
    res.json({ 
      ok: true, 
      id, 
      duration: durationText, 
      endTs: endTimestamp 
    });
  } catch (err) {
    console.error('Rejection error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Vehicle rejection endpoint
api.post("/vehicles/:id/reject", async (req, res) => { // requireValidSession geçici olarak kaldırıldı
  try {
    const id = sanitizeString(req.params.id, 100);
    const { duration, customDays } = req.body || {};
    
    // Validate duration
    const validDurations = ['1_month', '3_months', '6_months', '1_year', 'unlimited', 'custom'];
    if (!validDurations.includes(duration)) {
      return res.status(400).json({ error: 'Invalid rejection duration' });
    }
    
    // Calculate end timestamp based on duration
    let endTimestamp = null;
    let durationText = '';
    
    if (duration === 'unlimited') {
      durationText = 'Süresiz red';
      endTimestamp = null;
    } else if (duration === 'custom') {
      const days = Number(customDays);
      if (!Number.isInteger(days) || days < 1 || days > 365) {
        return res.status(400).json({ error: 'Custom days must be between 1 and 365' });
      }
      durationText = `${days} gün süreli red`;
      endTimestamp = Date.now() + (days * 24 * 60 * 60 * 1000);
    } else {
      const durationMap = {
        '1_month': { days: 30, text: '1 ay süreli red' },
        '3_months': { days: 90, text: '3 ay süreli red' },
        '6_months': { days: 180, text: '6 ay süreli red' },
        '1_year': { days: 365, text: '1 yıl süreli red' }
      };
      
      const config = durationMap[duration];
      durationText = config.text;
      endTimestamp = Date.now() + (config.days * 24 * 60 * 60 * 1000);
    }
    
    const now = Date.now();
    
    // Update vehicle with rejection info
    await q(`
      UPDATE vehicles 
      SET rejection_status = 'rejected',
          rejection_duration = $1,
          rejection_start_ts = $2,
          rejection_end_ts = $3
      WHERE id = $4
    `, [durationText, now, endTimestamp, id]);
    
    // Get updated vehicle data
    const vehicleResult = await q("SELECT data FROM vehicles WHERE id = $1", [id]);
    let vehicleData = {};
    if (vehicleResult.rows[0]) {
      try {
        vehicleData = JSON.parse(vehicleResult.rows[0].data);
      } catch (e) {
        vehicleData = { raw: vehicleResult.rows[0].data };
      }
    }
    
    // Broadcast real-time update to all connected clients
    broadcastEvent('vehicle_rejected', { 
      vehicle: vehicleData, 
      id, 
      rejection: {
        status: 'rejected',
        duration: durationText,
        startTs: now,
        endTs: endTimestamp
      }
    });
    
    res.json({ 
      ok: true, 
      id, 
      rejection: {
        status: 'rejected',
        duration: durationText,
        startTs: now,
        endTs: endTimestamp
      }
    });
  } catch (err) {
    sendApiError(res, err, 500, 'VEHICLE_REJECTION_FAILED');
  }
});

// Remove vehicle rejection endpoint
api.post("/vehicles/:id/remove-rejection", async (req, res) => { // requireValidSession geçici olarak kaldırıldı (diğer reject endpointleri gibi)
  try {
    const id = sanitizeString(req.params.id, 100);
    
    await q(`
      UPDATE vehicles 
      SET rejection_status = NULL,
          rejection_duration = NULL,
          rejection_start_ts = NULL,
          rejection_end_ts = NULL
      WHERE id = $1
    `, [id]);
    
    // Get updated vehicle data
    const vehicleResult = await q("SELECT data FROM vehicles WHERE id = $1", [id]);
    let vehicleData = {};
    if (vehicleResult.rows[0]) {
      try {
        vehicleData = JSON.parse(vehicleResult.rows[0].data);
      } catch (e) {
        vehicleData = { raw: vehicleResult.rows[0].data };
      }
    }
    
    // Broadcast real-time update to all connected clients
    broadcastEvent('vehicle_rejection_removed', { 
      vehicle: vehicleData, 
      id 
    });
    
    res.json({ ok: true, id });
  } catch (err) {
    sendApiError(res, err, 500, 'VEHICLE_REJECTION_REMOVAL_FAILED');
  }
});

// Daily rows
api.get("/daily_rows", async (req, res) => {
  try {
    const { limit, offset } = parsePagination(req, { defaultLimit: 5000, maxLimit: 20000 });
    const r = await q("SELECT data FROM daily_rows ORDER BY created_at DESC LIMIT $1 OFFSET $2", [limit, offset]);
    res.json((r.rows || []).map((x) => {
      try {
        return JSON.parse(x.data);
      } catch {
        return x.data;
      }
    }));
  } catch (err) {
    sendApiError(res, err, 500, 'DAILY_ROWS_LIST_FAILED');
  }
});

api.post("/daily_rows", requireValidSession, async (req, res) => {
  try {
    const row = req.body || {};
    const id = String(row.id || (Date.now().toString() + Math.random().toString(16).slice(2)));
    const created = Number(row.created_at || Date.now());
    
    // ✅ SECURITY: Validate and sanitize plaka
    const plaka = sanitizeString(row.plaka || "", 50);
    if (plaka && !validatePlateFormat(plaka)) {
      console.warn('Rejected plaka in daily_rows:', plaka, 'Original:', row.plaka);
      return res.status(400).json({ error: 'Invalid plaka format', received: plaka });
    }

    // Sanitize all text fields in daily rows
    const sanitized = {
      ...row,
      plaka,
      malzeme: sanitizeString(row.malzeme || "", 100),
      sevkYeri: sanitizeString(row.sevkYeri || "", 200),
      ambalaj: sanitizeString(row.ambalaj || "", 100),
      yuklemeNotu: sanitizeString(row.yuklemeNotu || "", 500),
      firma: sanitizeString(row.firma || "", 100),
      id
    };

    const raw = JSON.stringify(sanitized);
    // Enforce 3000-character limit on the serialized `data` field for daily_rows
    if (typeof raw === 'string' && raw.length > 3000) {
      return res.status(400).json({ error: 'data field exceeds 3000 characters' });
    }

    await q(
      `
      INSERT INTO daily_rows(id, plaka, data, created_at)
      VALUES($1,$2,$3,$4)
      ON CONFLICT (id) DO UPDATE SET
        plaka = EXCLUDED.plaka,
        data = EXCLUDED.data,
        created_at = EXCLUDED.created_at
      `,
      [id, plaka, raw, created]
    );

    // Broadcast real-time update to all connected clients
    broadcastEvent('daily_row_created', { row: sanitized, id });

    res.json({ ok: true, id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Tüm günlük Excel satırlarını sil (İHRACAT Excel Sil)
api.delete("/daily_rows", requireValidSession, async (req, res) => {
  try {
    await q("DELETE FROM daily_rows");
    broadcastEvent('daily_rows_cleared', {});
    res.json({ ok: true });
  } catch (err) {
    sendApiError(res, err, 500, 'DAILY_ROWS_CLEAR_FAILED');
  }
});

api.delete("/daily_rows/:id", auth.verifyToken, async (req, res) => {
  try {
    const id = req.params.id;
    await q("DELETE FROM daily_rows WHERE id = $1", [id]);
    
    // Broadcast real-time update to all connected clients
    broadcastEvent('daily_row_deleted', { id });
    
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Export DB (Postgres'te .sqlite dosyası yok; JSON yedek indiriyoruz)
api.get("/export/db", async (req, res) => {
  try {
    const [vehicles, daily_rows, problems, kv_store, report, events] = await Promise.all([
      q("SELECT * FROM vehicles"),
      q("SELECT * FROM daily_rows"),
      q("SELECT * FROM problems"),
      q("SELECT * FROM kv_store"),
      q("SELECT * FROM report"),
      q("SELECT * FROM events"),
    ]);

    const backup = {
      ts: Date.now(),
      vehicles: vehicles.rows,
      daily_rows: daily_rows.rows,
      problems: problems.rows,
      kv_store: kv_store.rows,
      report: report.rows,
      events: events.rows,
    };

    const filename = "arac_giris_backup.json";
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(JSON.stringify(backup));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Piyasa state
api.get("/piyasa", async (req, res) => {
  try {
    const r = await q("SELECT value FROM kv_store WHERE key = $1", ["piyasa_state_v1"]);
    if (!r.rows[0]) return res.json({});
    try { return res.json(JSON.parse(r.rows[0].value)); } catch { return res.json({}); }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

api.post("/piyasa", auth.verifyToken, async (req, res) => {
  try {
    // ✅ SECURITY: Sanitize piyasa data
    let sanitized = req.body || {};
    if (sanitized.plate) sanitized.plate = sanitizeString(sanitized.plate, 50);
    if (sanitized.firma) sanitized.firma = sanitizeString(sanitized.firma, 100);
    if (sanitized.malzeme) sanitized.malzeme = sanitizeString(sanitized.malzeme, 100);
    if (!sanitized.updatedAt) sanitized.updatedAt = Date.now();

    const raw = JSON.stringify(sanitized);
    await q(
      `
      INSERT INTO kv_store(key, value)
      VALUES($1,$2)
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
      `,
      ["piyasa_state_v1", raw]
    );
    broadcastEvent('piyasa_updated', {
      updatedAt: sanitized.updatedAt,
      orderCount: Array.isArray(sanitized.orders) ? sanitized.orders.length : 0,
    });
    res.json({ ok: true, updatedAt: sanitized.updatedAt });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

api.get('/piyasa/durum-status', auth.verifyToken, async (req, res) => {
  try {
    const meta = await readPiyasaDurumMeta();
    res.json({
      frozen: isPiyasaDurumFrozen(),
      freezeUntil: getPiyasaDurumFreezeUntilMs(),
      resetEpoch: meta.resetEpoch || 0,
      message: piyasaDurumFreezeMessage(),
    });
  } catch (err) {
    sendApiError(res, err, 500, 'PIYASA_DURUM_STATUS_FAILED');
  }
});

api.post('/piyasa/reset-durum', auth.verifyToken, async (req, res) => {
  try {
    if (!verifySettingsPassword(req.body?.password || req.body?.settingsPassword)) {
      return res.status(403).json({ ok: false, error: 'Parola gerekli' });
    }
    const result = await resetPiyasaDurumData();
    res.json({ ok: true, ...result, frozen: isPiyasaDurumFrozen(), message: piyasaDurumFreezeMessage() });
  } catch (err) {
    sendApiError(res, err, 500, 'PIYASA_DURUM_RESET_FAILED');
  }
});

const PIYASA_CUSTOMERS_KV = 'piyasa_customer_list_v1';

function sanitizePiyasaCustomerEntry(raw, index) {
  if (!raw || typeof raw !== 'object') return null;
  const kod = sanitizeString(String(raw.kod || '').trim(), 50);
  if (!kod) return null;
  const ad = sanitizeString(String(raw.ad || '').trim(), 200);
  if (/^(AD|CARİ UNVAN|CARI UNVAN)$/i.test(ad) && /^(KOD|MÜŞTERİ KODU|MUSTERI KODU)$/i.test(kod)) return null;
  let id = raw.id;
  if (id == null || id === '') id = `row-${index + 1}`;
  else id = sanitizeString(String(id), 40);
  return {
    id,
    kod,
    ad,
    urunTipi: sanitizeString(String(raw.urunTipi || '').trim(), 80),
    sektor: sanitizeString(String(raw.sektor || '').trim(), 80),
    il: sanitizeString(String(raw.il || '').trim(), 80),
    adres: sanitizeString(String(raw.adres || '').trim(), 300),
    ambalaj: sanitizeString(String(raw.ambalaj || '').trim(), 120),
  };
}

function normalizePiyasaCustomersPayload(body) {
  const list = Array.isArray(body?.customers) ? body.customers : [];
  if (!list.length) return null;
  if (list.length > 20000) throw new Error('Müşteri listesi çok büyük (max 20000)');
  const customers = [];
  for (let i = 0; i < list.length; i++) {
    const c = sanitizePiyasaCustomerEntry(list[i], i);
    if (c) customers.push(c);
  }
  if (!customers.length) return null;
  return {
    version: 2,
    source: sanitizeString(String(body.source || 'manual'), 120) || 'manual',
    updatedAt: Date.now(),
    customers,
  };
}

async function seedPiyasaCustomersIfEmpty() {
  try {
    const r = await q('SELECT value FROM kv_store WHERE key = $1', [PIYASA_CUSTOMERS_KV]);
    if (r.rows[0]) {
      try {
        const parsed = JSON.parse(r.rows[0].value);
        if (parsed && Array.isArray(parsed.customers) && parsed.customers.length > 0) {
          console.log(`ℹ️ Piyasa müşteri listesi mevcut (${parsed.customers.length} kayıt)`);
          return;
        }
      } catch (_) { /* re-seed below */ }
    }
    const seedPath = path.join(__dirname, 'data', 'piyasa-customers-seed.json');
    if (!fs.existsSync(seedPath)) {
      console.warn('⚠️ Piyasa müşteri seed dosyası yok:', seedPath);
      return;
    }
    const raw = fs.readFileSync(seedPath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.customers) || !parsed.customers.length) {
      console.warn('⚠️ Piyasa müşteri seed dosyası boş');
      return;
    }
    await q(
      `INSERT INTO kv_store(key, value) VALUES($1,$2)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [PIYASA_CUSTOMERS_KV, raw]
    );
    console.log(`✅ Piyasa müşteri listesi seed edildi (${parsed.customers.length} kayıt)`);
  } catch (err) {
    console.error('Piyasa müşteri seed hatası:', err.message || err);
  }
}

api.get('/piyasa/customers', async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'private, max-age=120');
    const r = await q('SELECT value FROM kv_store WHERE key = $1', [PIYASA_CUSTOMERS_KV]);
    if (!r.rows[0]) return res.json({ version: 1, customers: [], updatedAt: 0 });
    try { return res.json(JSON.parse(r.rows[0].value)); } catch { return res.json({ version: 1, customers: [], updatedAt: 0 }); }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

api.post('/piyasa/customers', auth.verifyToken, async (req, res) => {
  try {
    const normalized = normalizePiyasaCustomersPayload(req.body || {});
    if (!normalized) return res.status(400).json({ ok: false, error: 'Geçersiz müşteri listesi' });
    const raw = JSON.stringify(normalized);
    await q(
      `INSERT INTO kv_store(key, value) VALUES($1,$2)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [PIYASA_CUSTOMERS_KV, raw]
    );
    res.json({ ok: true, count: normalized.customers.length, updatedAt: normalized.updatedAt });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Generic KV
api.get("/kv/:key", async (req, res) => {
  try {
    const key = sanitizeString(req.params.key, 100);
    const r = await q("SELECT value FROM kv_store WHERE key = $1", [key]);
    if (!r.rows[0]) return res.json(null);
    try { return res.json(JSON.parse(r.rows[0].value)); } catch { return res.json(r.rows[0].value); }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

api.post("/kv/:key", auth.verifyToken, async (req, res) => {
  try {
    const key = sanitizeString(req.params.key, 100);
    const v = req.body && req.body.value !== undefined ? req.body.value : req.body;
    // ✅ SECURITY: Sanitize KV store values
    let raw = '';
    if (typeof v === "string") {
      raw = sanitizeString(v, 1000);
    } else {
      raw = JSON.stringify(v);
    }

    await q(
      `
      INSERT INTO kv_store(key, value)
      VALUES($1,$2)
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
      `,
      [key, raw]
    );

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Protect all following API routes with JWT verification
api.use(auth.verifyToken);

const SHIFT_NOTES_DELETE_PASSWORD = String(process.env.SHIFT_NOTES_DELETE_PASSWORD || '2026genper');

function parseOperationNoteRules(raw) {
  try {
    const o = typeof raw === 'string' ? JSON.parse(raw || '{}') : (raw || {});
    return {
      yd_key: o.yd_key ? String(o.yd_key).trim().toUpperCase() : '',
      firma_kodu: o.firma_kodu ? String(o.firma_kodu).trim().toUpperCase() : '',
      sehir: o.sehir ? sanitizeString(String(o.sehir), 80) : '',
      malzeme_p1p2: !!o.malzeme_p1p2
    };
  } catch (e) {
    return { yd_key: '', firma_kodu: '', sehir: '', malzeme_p1p2: false };
  }
}

function mapOperationNoteRow(row) {
  const rules = parseOperationNoteRules(row.rules);
  return {
    id: row.id,
    body: row.body,
    author_username: row.author_username || '',
    excel_type: row.excel_type || 'genel',
    rules,
    active: row.active !== false,
    created_at: Number(row.created_at) || 0
  };
}

function operationNoteHasRule(rules) {
  return !!(rules.yd_key || rules.firma_kodu || rules.malzeme_p1p2);
}

// Vardiya / operasyon notları (Excel kurallı uyarılar)
api.get('/operation-notes', async (req, res) => {
  try {
    const activeParam = String(req.query.active ?? '1').toLowerCase();
    let text = 'SELECT id, body, author_username, excel_type, rules, active, created_at FROM operation_notes';
    if (activeParam === 'all') {
      text += ' ORDER BY created_at DESC LIMIT 500';
    } else if (activeParam === '0' || activeParam === 'false') {
      text += ' WHERE active = FALSE ORDER BY created_at DESC LIMIT 500';
    } else {
      text += ' WHERE active = TRUE ORDER BY created_at DESC LIMIT 500';
    }
    const r = await q(text);
    res.json({ ok: true, notes: (r.rows || []).map(mapOperationNoteRow) });
  } catch (err) {
    sendApiError(res, err, 500, 'OPERATION_NOTES_LIST_FAILED');
  }
});

api.post('/operation-notes', async (req, res) => {
  try {
    const body = req.body || {};
    const noteBody = sanitizeString(body.body || '', 2000);
    if (!noteBody.trim()) {
      return res.status(400).json({ ok: false, error: 'body required' });
    }
    const excelType = sanitizeString(body.excel_type || 'genel', 20).toLowerCase();
    const allowedTypes = new Set(['ihracat', 'piyasa', 'genel', 'her_ikisi']);
    const excel_type = allowedTypes.has(excelType) ? excelType : 'genel';
    const rulesIn = body.rules && typeof body.rules === 'object' ? body.rules : {};
    const rules = {
      yd_key: rulesIn.yd_key ? sanitizeString(String(rulesIn.yd_key), 32).toUpperCase() : '',
      firma_kodu: rulesIn.firma_kodu ? sanitizeString(String(rulesIn.firma_kodu), 50).toUpperCase() : '',
      sehir: rulesIn.sehir ? sanitizeString(String(rulesIn.sehir), 80) : '',
      malzeme_p1p2: !!rulesIn.malzeme_p1p2
    };
    if (!operationNoteHasRule(rules)) {
      return res.status(400).json({ ok: false, error: 'At least one rule required (yd_key, firma_kodu, or malzeme_p1p2)' });
    }
    const author = sanitizeString(
      (req.user && req.user.username) || body.author_username || '',
      80
    );
    const id = String(body.id || (Date.now().toString() + Math.random().toString(16).slice(2)));
    const created_at = Date.now();
    await q(
      `INSERT INTO operation_notes(id, body, author_username, excel_type, rules, active, created_at)
       VALUES($1,$2,$3,$4,$5,TRUE,$6)`,
      [id, noteBody, author, excel_type, JSON.stringify(rules), created_at]
    );
    res.json({ ok: true, id, note: mapOperationNoteRow({
      id, body: noteBody, author_username: author, excel_type, rules: JSON.stringify(rules), active: true, created_at
    }) });
  } catch (err) {
    sendApiError(res, err, 500, 'OPERATION_NOTES_CREATE_FAILED');
  }
});

api.patch('/operation-notes/:id', async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    if (!id) return res.status(400).json({ ok: false, error: 'id required' });
    const bodyIn = req.body && typeof req.body === 'object' ? req.body : {};
    const sets = [];
    const params = [id];
    let idx = 2;

    if (typeof bodyIn.active === 'boolean') {
      sets.push(`active = $${idx++}`);
      params.push(!!bodyIn.active);
    }
    if (bodyIn.body !== undefined) {
      const noteBody = sanitizeString(bodyIn.body || '', 2000);
      if (!noteBody.trim()) {
        return res.status(400).json({ ok: false, error: 'body required' });
      }
      sets.push(`body = $${idx++}`);
      params.push(noteBody);
    }
    if (bodyIn.rules !== undefined) {
      const rulesIn = bodyIn.rules && typeof bodyIn.rules === 'object' ? bodyIn.rules : {};
      const rules = {
        yd_key: rulesIn.yd_key ? sanitizeString(String(rulesIn.yd_key), 32).toUpperCase() : '',
        firma_kodu: rulesIn.firma_kodu ? sanitizeString(String(rulesIn.firma_kodu), 50).toUpperCase() : '',
        sehir: rulesIn.sehir ? sanitizeString(String(rulesIn.sehir), 80) : '',
        malzeme_p1p2: !!rulesIn.malzeme_p1p2
      };
      if (!operationNoteHasRule(rules)) {
        return res.status(400).json({ ok: false, error: 'At least one rule required (yd_key, firma_kodu, or malzeme_p1p2)' });
      }
      sets.push(`rules = $${idx++}`);
      params.push(JSON.stringify(rules));
    }

    if (!sets.length) {
      return res.status(400).json({ ok: false, error: 'No fields to update' });
    }

    const r = await q(
      `UPDATE operation_notes SET ${sets.join(', ')} WHERE id = $1 RETURNING id, body, author_username, excel_type, rules, active, created_at`,
      params
    );
    if (!r.rows[0]) return res.status(404).json({ ok: false, error: 'not found' });
    res.json({ ok: true, note: mapOperationNoteRow(r.rows[0]) });
  } catch (err) {
    sendApiError(res, err, 500, 'OPERATION_NOTES_UPDATE_FAILED');
  }
});

api.delete('/operation-notes/:id', async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    const password = String((req.body && req.body.password) || '');
    if (password !== SHIFT_NOTES_DELETE_PASSWORD) {
      return res.status(403).json({ ok: false, error: 'invalid password' });
    }
    if (!id) return res.status(400).json({ ok: false, error: 'id required' });
    const r = await q('DELETE FROM operation_notes WHERE id = $1 RETURNING id', [id]);
    if (!r.rows[0]) return res.status(404).json({ ok: false, error: 'not found' });
    res.json({ ok: true, id });
  } catch (err) {
    sendApiError(res, err, 500, 'OPERATION_NOTES_DELETE_FAILED');
  }
});

// Reports
api.get("/reports", async (req, res) => {
  try {
    const { limit, offset } = parsePagination(req, { defaultLimit: 5000, maxLimit: 20000 });
    const r = await q("SELECT id, plaka, firma, malzeme, tonaj, basim_yeri, sevkiyat_id, sofor, sevk_yeri, yukleme_turu, tarih FROM print_history ORDER BY tarih DESC LIMIT $1 OFFSET $2", [limit, offset]);
    
    const parsed = (r.rows || []).map((row) => {
      try {
        const raw = row.tarih;
        let ms = Date.now();
        if (raw !== null && raw !== undefined && raw !== '') {
          const n = Number(raw);
          if (Number.isFinite(n)) ms = n;
          else {
            const parsedMs = Date.parse(String(raw));
            if (!isNaN(parsedMs)) ms = parsedMs;
          }
        }
        const { tarih: tarihStr, saat: saatStr } = formatReportInstant(ms);

        const d = {
          plaka: row.plaka,
          firma: row.firma,
          malzeme: row.malzeme,
          tonaj: row.tonaj,
          basimYeri: row.basim_yeri,
          sevkiyat_id: row.sevkiyat_id,
          sofor: row.sofor || '',
          sevkYeri: row.sevk_yeri || '',
          yuklemeTuru: row.yukleme_turu || '',
          ambalajBilgisi: row.yukleme_turu || '',
          tarih: tarihStr,
          saat: saatStr
        };

        return {
          id: row.id,
          type: 'PRINT',
          data: d,
          ts: ms,
          tarih: tarihStr,
          saat: saatStr,
          kantar: d && d.kantar ? d.kantar : '',
          malzeme: d && d.malzeme ? d.malzeme : '',
          sevkYeri: d && d.sevkYeri ? d.sevkYeri : '',
          firma: (d && (d.firma || d.firmaKodu || d.firmaSelect)) ? (d.firma || d.firmaKodu || d.firmaSelect) : ''
        };
      } catch {
        return { id: row.id, type: row.type, data: row.data, ts: row.ts, saat: '', kantar: '', malzeme: '', sevkYeri: '' };
      }
    });
    res.json(parsed);
  } catch (err) {
    sendApiError(res, err, 500, 'REPORTS_LIST_FAILED');
  }
});

// Reports grouped by date (convenience endpoint)
api.get('/reportsgroupbydate', async (req, res) => {
  try {
    // Use data.tarih if present, otherwise derive from ts (stored as milliseconds)
    const r = await q(`
      SELECT
        COALESCE(NULLIF(data::json->>'tarih',''), to_char(to_timestamp(ts/1000), 'DD.MM.YYYY')) AS tarih,
        COUNT(*)::int AS count,
        MAX(ts) AS last_ts
      FROM report
      GROUP BY tarih
      ORDER BY MAX(ts) DESC
    `);

    const rows = (r.rows || []).map(row => ({ tarih: row.tarih || '', count: Number(row.count || 0) }));
    res.json(rows);
  } catch (err) {
    console.error('GET /reportsgroupbydate error', err && err.message);
    res.status(500).json({ error: err.message });
  }
});

// Reports for a specific date
api.get('/reportbydate', async (req, res) => {
  try {
    const date = String(req.query.date || '').trim();
    if (!date) return res.status(400).json({ error: 'date query parameter required (format DD.MM.YYYY)' });

    const r = await q(`
      SELECT id, type, data, ts
      FROM report
      WHERE (data::json->>'tarih') = $1
         OR to_char(to_timestamp(ts/1000), 'DD.MM.YYYY') = $1
      ORDER BY ts DESC
    `, [date]);

    const rows = (r.rows || []).map(row => {
      try {
        return { id: row.id, type: row.type, data: JSON.parse(row.data || '{}'), ts: row.ts };
      } catch (e) {
        return { id: row.id, type: row.type, data: row.data, ts: row.ts };
      }
    });

    res.json(rows);
  } catch (err) {
    console.error('GET /reportbydate error', err && err.message);
    res.status(500).json({ error: err.message });
  }
});

// Statistics: counts of day/night shift PRINT events for today
api.get('/stats/daily-shifts', async (req, res) => {
  try {
    // compute start/end of current day in server local timezone
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0).getTime();
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate()+1, 0, 0, 0, 0).getTime();
    // Count PRINT events (do not dedupe by plate) so stats match event counts
    const r = await q('SELECT id, type, data, ts FROM report WHERE ts >= $1 AND ts < $2 AND type = $3', [start, end, 'PRINT']);
    const rows = r.rows || [];

    function timeStrToMinutes(s){
      try{
        if (!s) return null;
        const m = String(s||'').trim().match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
        if (!m) return null;
        const hh = parseInt(m[1],10);
        const mm = parseInt(m[2],10);
        return hh*60 + mm;
      }catch(e){return null;}
    }
    let dayCount = 0;
    let nightCount = 0;

    for (const row of rows) {
      try {
        let d = {};
        try { d = JSON.parse(row.data || '{}'); } catch(e) { d = {}; }
        
        // Önce direkt vardiya alanını kontrol et
        if (d && d.vardiya) {
          const vardiyaStr = String(d.vardiya).toLowerCase().trim();
          if (vardiyaStr === 'gündüz' || vardiyaStr === 'gunduz' || vardiyaStr === 'day') {
            dayCount++;
            continue;
          } else if (vardiyaStr === 'gece' || vardiyaStr === 'night') {
            nightCount++;
            continue;
          }
        }
        
        // Vardiya alanı yoksa saat bilgisinden hesapla
        let mins = null;
        if (d && (d.saat || d.time)) {
          mins = timeStrToMinutes(d.saat || d.time);
        }
        if (mins === null && row.ts) {
          mins = istanbulMinutesFromTs(row.ts);
        }

        // shift rules: night: 00:00-08:00 (mins 0-480), day: 08:00-18:00 (mins 480-1080)
        if (mins !== null) {
          if (mins >= 0 && mins < 8*60) {
            nightCount++;
          } else if (mins >= 8*60 && mins < 18*60) {
            dayCount++;
          }
        }
      } catch (e) {}
    }

    res.json({ ok: true, date: new Date(start).toISOString().slice(0,10), day: dayCount, night: nightCount, total: dayCount + nightCount });
  } catch (err) {
    console.error('GET /stats/daily-shifts error', err && err.message);
    res.status(500).json({ error: err.message });
  }
});

// İçerideki araç sayısı: report tablosunda data.cikisYapildi = true olan kayıtların sayısını döndürür
api.get('/icerideki-count', async (req, res) => {
  try {
    const r = await q("SELECT COUNT(*)::int AS cnt FROM report WHERE (data::json->>'cikisYapildi') = 'false'");
    const count = (r.rows && r.rows[0]) ? Number(r.rows[0].cnt || 0) : 0;
    res.json({ ok: true, count });
  } catch (err) {
    console.error('GET /icerideki-count error', err && err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// İçerideki araçların plakalarını döndürür (data.cikisYapildi = true olan kayıtlar)
api.get('/icerideki-plates', async (req, res) => {
  try {
    const r = await q("SELECT id, type, data, ts FROM report WHERE (data::json->>'cikisYapildi') = 'false' ORDER BY ts DESC");
    const parsed = (r.rows || []).map(row => {
      try {
        return { id: row.id, type: row.type, data: JSON.parse(row.data || '{}'), ts: row.ts };
      } catch (e) {
        return { id: row.id, type: row.type, data: row.data, ts: row.ts };
      }
    });

    res.json({ ok: true, reports: parsed });
  } catch (err) {
    console.error('GET /icerideki-plates error', err && err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Set cikisYapildi flag for a specific report id
api.post('/reports/:id/set-cikis', async (req, res) => {
  try {
    const id = String(req.params.id || '');
    if (!id) return res.status(400).json({ ok: false, error: 'id required' });

    const val = (req.body && typeof req.body.cikisYapildi !== 'undefined') ? !!req.body.cikisYapildi : true;

    // load existing report
    const r = await q('SELECT data, ts FROM report WHERE id = $1', [id]);
    if (!r.rows[0]) return res.status(404).json({ ok: false, error: 'not found' });

    let obj = {};
    try { obj = JSON.parse(r.rows[0].data || '{}'); } catch (e) { obj = { raw: r.rows[0].data }; }
    obj.cikisYapildi = !!val;

    // determine timestamp to use for the update
    const ts = Number(req.body.ts || Date.now());

    // when marking as exited, record the exit timestamp in the JSON payload
    if (obj.cikisYapildi) {
      // Accept client-provided cikisTarihi (ms or parsable string) or use the computed ts.
      const provided = (req.body && typeof req.body.cikisTarihi !== 'undefined') ? req.body.cikisTarihi : undefined;
      let dateObj = null;
      if (typeof provided !== 'undefined' && provided !== null && String(provided).trim() !== '') {
        const asNum = Number(provided);
        if (!Number.isNaN(asNum)) dateObj = new Date(asNum);
        else {
          const parsed = Date.parse(String(provided));
          if (!Number.isNaN(parsed)) dateObj = new Date(parsed);
        }
      }
      if (!dateObj) dateObj = new Date(ts);
      // store a human-readable date-time string (Turkish locale)
      try { obj.cikisTarihi = dateObj.toLocaleString('tr-TR'); } catch (e) { obj.cikisTarihi = dateObj.toISOString(); }
    } else {
      // if exit is being unset, remove any previous cikisTarihi to keep data consistent
      try { if (obj.cikisTarihi !== undefined) delete obj.cikisTarihi; } catch (e) {}
    }

      const raw = JSON.stringify(obj);
      // Enforce 250-character limit on the serialized `data` field
      if (typeof raw === 'string' && raw.length > 500) {
        return res.status(400).json({ ok: false, error: 'data field exceeds 300 characters' });
      }

    await q('UPDATE report SET data = $1, ts = $2 WHERE id = $3', [raw, ts, id]);

    res.json({ ok: true, id });
  } catch (err) {
    console.error('POST /reports/:id/set-cikis error', err && err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

api.post("/reports", requireValidSession, async (req, res) => {
  try {
    const body = req.body || {};
    const id = String(body.id || (Date.now().toString() + Math.random().toString(16).slice(2)));
    // ✅ SECURITY: Sanitize type field
    const type = sanitizeString(body.type || "", 50);
    let data = body.data !== undefined ? body.data : body;

    // normalize payload to an object and ensure `cikisYapildi` exists (default false)
    let dataObj = {};
    try {
      if (typeof data === 'string') {
        try { dataObj = JSON.parse(data); } catch (e) { dataObj = { value: sanitizeString(data, 200) }; }
      } else if (data && typeof data === 'object') {
        dataObj = Object.assign({}, data);
      } else {
        dataObj = { value: sanitizeString(String(data || ''), 200) };
      }
    } catch (e) {
      dataObj = { value: sanitizeString(String(data || ''), 200) };
    }
    if (typeof dataObj.cikisYapildi === 'undefined') dataObj.cikisYapildi = false;
    
    // Sanitize string fields in dataObj
    if (dataObj.plaka) dataObj.plaka = sanitizeString(dataObj.plaka, 50);
    if (dataObj.firma) dataObj.firma = sanitizeString(dataObj.firma, 150);
    if (dataObj.malzeme) dataObj.malzeme = sanitizeString(dataObj.malzeme, 100);
    if (dataObj.sofor) dataObj.sofor = sanitizeString(dataObj.sofor, 200);
    
    // safe stringify: try JSON.stringify, fallback to string conversion
    let raw = '';
    try {
      raw = JSON.stringify(dataObj);
    } catch (e) {
      console.error('Report serialization failed, incoming body:', body);
      try { raw = JSON.stringify({ _note: 'serialization_failed', value: sanitizeString(String(dataObj), 200) }); } catch (e2) { raw = sanitizeString(String(dataObj || ''), 200); }
    }
    // Enforce 500-character limit on the serialized `data` field
    if (typeof raw === 'string' && raw.length > 500) {
      return res.status(400).json({ error: 'data field exceeds 500 characters' });
    }
    const ts = Number(body.ts || Date.now());

    await q(
      `
      INSERT INTO report(id, type, data, ts)
      VALUES($1,$2,$3,$4)
      ON CONFLICT (id) DO UPDATE SET
        type = EXCLUDED.type,
        data = EXCLUDED.data,
        ts = EXCLUDED.ts
      `,
      [id, type, raw, ts]
    );

    res.json({ ok: true, id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

api.delete("/reports", requireValidSession, async (req, res) => {
  try {
    await q("DELETE FROM report");
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// Migration: remove legacy lastPrintedAt from vehicles and reports, replace with date-only "tarih"
api.post('/migrate/remove-lastPrintedAt', async (req, res) => {
  try {
    const result = await withTransaction(async (client) => {
      let vUpdated = 0;
      let rUpdated = 0;
      let failed = 0;

      const vr = await client.query('SELECT id, data FROM vehicles');
      for (const row of (vr.rows || [])) {
        try {
          const obj = JSON.parse(row.data || '{}');
          if (obj && obj.lastPrintedAt !== undefined && obj.lastPrintedAt !== null) {
            try { obj.tarih = new Date(Number(obj.lastPrintedAt)).toLocaleDateString('tr-TR'); } catch(e) { obj.tarih = ''; }
            try { delete obj.lastPrintedAt; } catch(e) {}
            const raw = JSON.stringify(obj);
            await client.query('UPDATE vehicles SET data = $1, sort_ts = $2 WHERE id = $3', [raw, computeVehicleSortTs(obj), row.id]);
            vUpdated++;
          }
        } catch(e){ failed++; }
      }

      const rr = await client.query('SELECT id, data FROM report');
      for (const row of (rr.rows || [])) {
        try {
          const d = JSON.parse(row.data || '{}');
          if (d && d.lastPrintedAt !== undefined && d.lastPrintedAt !== null) {
            try { d.tarih = new Date(Number(d.lastPrintedAt)).toLocaleDateString('tr-TR'); } catch(e) { d.tarih = ''; }
            try { delete d.lastPrintedAt; } catch(e) {}
            const raw = JSON.stringify(d);
            await client.query('UPDATE report SET data = $1 WHERE id = $2', [raw, row.id]);
            rUpdated++;
          }
        } catch(e){ failed++; }
      }
      return { vUpdated, rUpdated, failed };
    }, 'migrate-remove-lastPrintedAt');
    res.json({ ok: true, vehiclesUpdated: result.vUpdated, reportsUpdated: result.rUpdated, failed: result.failed });
  } catch (err) {
    sendApiError(res, err, 500, 'MIGRATION_FAILED');
  }
});

// Problems
api.get("/problems", async (req, res) => {
  try {
    const { limit, offset } = parsePagination(req, { defaultLimit: 5000, maxLimit: 20000 });
    const plateQuery = req.query.plate || "";
    if (plateQuery) {
      const plate = String(plateQuery || "");
      const r = await q("SELECT id, data FROM problems WHERE plate = $1 ORDER BY ts DESC LIMIT $2 OFFSET $3", [plate, limit, offset]);
      const parsed = (r.rows || []).map((row) => {
        try { return Object.assign({ id: row.id }, JSON.parse(row.data)); }
        catch { return { id: row.id, raw: row.data }; }
      });
      return res.json(parsed);
    }

    const r = await q("SELECT id, data, plate FROM problems ORDER BY ts DESC LIMIT $1 OFFSET $2", [limit, offset]);
    const parsed = (r.rows || []).map((row) => {
      try { return Object.assign({ id: row.id, plate: row.plate }, JSON.parse(row.data)); }
      catch { return { id: row.id, plate: row.plate, raw: row.data }; }
    });
    res.json(parsed);
  } catch (err) {
    console.error("GET /problems SQL error", err);
    sendApiError(res, err, 500, 'PROBLEMS_LIST_FAILED');
  }
});

api.get("/problems/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const r = await q("SELECT data FROM problems WHERE id = $1", [id]);
    if (!r.rows[0]) return res.status(404).json({ error: "Not found" });
    try { return res.json(JSON.parse(r.rows[0].data)); } catch { return res.json({ raw: r.rows[0].data }); }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
api.get("/reports/count", async (req, res) => {
  try {
    const basimYeriRaw = String(req.query.basimYeri || "").trim();
    const basimYeri = basimYeriRaw ? basimYeriRaw.toUpperCase() : "";
    let query = "SELECT COUNT(*) AS kayit_sayisi FROM print_history";
    const params = [];

    if (basimYeri) {
      query += " WHERE basim_yeri = $1";
      params.push(basimYeri);
    }

    const r = await q(query + ";", params);
    if (!r.rows[0]) return res.status(404).json({ error: "Not found" });
    return res.json({ count: Number(r.rows[0].kayit_sayisi || 0) });
  } catch (err) {
    sendApiError(res, err, 500, 'REPORT_COUNT_FAILED');
  }
});
api.post("/problems", async (req, res) => {
  try {
    const body = req.body || {};
    const id = String(body.id || (Date.now().toString() + Math.random().toString(16).slice(2)));
    // ✅ SECURITY: Validate and sanitize plate
    const plate = sanitizeString(body.plate || "", 50);
    if (plate && !validatePlateFormat(plate)) {
      console.warn('Rejected plate in problems:', plate, 'Original:', body.plate);
      return res.status(400).json({ error: 'Invalid plate format', received: plate });
    }
    
    let data = body.data !== undefined ? body.data : body;
    // Sanitize data if it's a string
    if (typeof data === "string") {
      data = sanitizeString(data, 500);
    }
    const raw = (typeof data === "string") ? data : JSON.stringify(data);
    // Enforce 500-character limit on the serialized `data` field for problems
    if (typeof raw === 'string' && raw.length > 500) {
      return res.status(400).json({ error: 'data field exceeds 500 characters' });
    }
    const ts = Number(body.ts || Date.now());

    await q(
      `
      INSERT INTO problems(id, plate, data, ts)
      VALUES($1,$2,$3,$4)
      ON CONFLICT (id) DO UPDATE SET
        plate = EXCLUDED.plate,
        data = EXCLUDED.data,
        ts = EXCLUDED.ts
      `,
      [id, plate, raw, ts]
    );

    res.json({ ok: true, id });
  } catch (err) {
    console.error("POST /problems SQL error", err);
    res.status(500).json({ error: err.message });
  }
});

api.put("/problems/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const body = req.body || {};
    const plate = String(body.plate || "");
    const data = body.data !== undefined ? body.data : body;
    const raw = (typeof data === "string") ? data : JSON.stringify(data);
    // Enforce 500-character limit on the serialized `data` field for problems
    if (typeof raw === 'string' && raw.length > 500) {
      return res.status(400).json({ error: 'data field exceeds 500 characters' });
    }
    const ts = Number(body.ts || Date.now());

    await q(
      `
      INSERT INTO problems(id, plate, data, ts)
      VALUES($1,$2,$3,$4)
      ON CONFLICT (id) DO UPDATE SET
        plate = EXCLUDED.plate,
        data = EXCLUDED.data,
        ts = EXCLUDED.ts
      `,
      [id, plate, raw, ts]
    );

    res.json({ ok: true, id });
  } catch (err) {
    console.error("PUT /problems/:id SQL error", err);
    res.status(500).json({ error: err.message });
  }
});

api.delete("/problems/:id", async (req, res) => {
  try {
    const id = req.params.id;
    await q("DELETE FROM problems WHERE id = $1", [id]);
    res.json({ ok: true });
  } catch (err) {
    console.error("DELETE /problems/:id SQL error", err);
    res.status(500).json({ error: err.message });
  }
});

api.delete("/problems/plate/:plate", async (req, res) => {
  try {
    const plate = String(req.params.plate || "");
    await q("DELETE FROM problems WHERE plate = $1", [plate]);
    res.json({ ok: true });
  } catch (err) {
    console.error("DELETE /problems/plate/:plate SQL error", err);
    res.status(500).json({ error: err.message });
  }
});

api.delete("/problems", async (req, res) => {
  try {
    await q("DELETE FROM problems");
    res.json({ ok: true });
  } catch (err) {
    console.error("DELETE /problems SQL error", err);
    res.status(500).json({ error: err.message });
  }
});


// Restore full JSON backup into Postgres
api.post("/restore-full", auth.verifyToken, async (req, res) => {
  const allData = req.body || {};
  const hasStorageDump = allData && allData.storageDump && typeof allData.storageDump === "object";
  const hasVehiclesArray = Array.isArray(allData.vehicles);

  if (!hasStorageDump && !hasVehiclesArray) {
    return res.status(400).json({ error: "invalid backup payload" });
  }

  let processed = 0;
  let failed = 0;
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // legacy vehicles array
    if (hasVehiclesArray) {
      for (const vehicle of allData.vehicles) {
        try {
          const id = String(vehicle.id || (Date.now().toString() + Math.random().toString(16).slice(2)));
          const cekiciPlaka = vehicle.cekiciPlaka || "";
          const dorsePlaka = vehicle.dorsePlaka || "";
          const merged = Object.assign({}, vehicle, { id });
          const raw = JSON.stringify(merged);
          const sortTs = computeVehicleSortTs(merged);

          await client.query(
            `
            INSERT INTO vehicles(id, cekiciPlaka, dorsePlaka, data, sort_ts)
            VALUES($1,$2,$3,$4,$5)
            ON CONFLICT (id) DO UPDATE SET
              cekiciPlaka = EXCLUDED.cekiciPlaka,
              dorsePlaka = EXCLUDED.dorsePlaka,
              data = EXCLUDED.data,
              sort_ts = EXCLUDED.sort_ts
            `,
            [id, cekiciPlaka, dorsePlaka, raw, sortTs]
          );
          processed++;
        } catch { failed++; }
      }
    }

    if (hasStorageDump) {
      const dump = allData.storageDump;

      // dump.vehicles (stringified array)
      if (dump.vehicles) {
        try {
          const parsedVehicles = typeof dump.vehicles === "string" ? JSON.parse(dump.vehicles) : dump.vehicles;
          if (Array.isArray(parsedVehicles)) {
            for (const vehicle of parsedVehicles) {
              try {
                const id = String(vehicle.id || (Date.now().toString() + Math.random().toString(16).slice(2)));
                const cekiciPlaka = vehicle.cekiciPlaka || "";
                const dorsePlaka = vehicle.dorsePlaka || "";
                const merged = Object.assign({}, vehicle, { id });
                const raw = JSON.stringify(merged);
                const sortTs = computeVehicleSortTs(merged);

                await client.query(
                  `
                  INSERT INTO vehicles(id, cekiciPlaka, dorsePlaka, data, sort_ts)
                  VALUES($1,$2,$3,$4,$5)
                  ON CONFLICT (id) DO UPDATE SET
                    cekiciPlaka = EXCLUDED.cekiciPlaka,
                    dorsePlaka = EXCLUDED.dorsePlaka,
                    data = EXCLUDED.data,
                    sort_ts = EXCLUDED.sort_ts
                  `,
                  [id, cekiciPlaka, dorsePlaka, raw, sortTs]
                );
                processed++;
              } catch { failed++; }
            }
          }
        } catch { failed++; }
      }

      for (const k of Object.keys(dump)) {
        const raw = dump[k];
        let parsed = null;
        try { parsed = JSON.parse(raw); } catch { parsed = null; }

        try {
          if (String(k).startsWith("vehicle_")) {
            const id = String(k).slice(8);
            const dataObj = parsed && typeof parsed === "object" ? parsed : { id, raw: raw };
            const cekiciPlaka = dataObj.cekiciPlaka || "";
            const dorsePlaka = dataObj.dorsePlaka || "";
            const merged = Object.assign({}, dataObj, { id });
            const dataRaw = JSON.stringify(merged);
            const sortTs = computeVehicleSortTs(merged);

            await client.query(
              `
              INSERT INTO vehicles(id, cekiciPlaka, dorsePlaka, data, sort_ts)
              VALUES($1,$2,$3,$4,$5)
              ON CONFLICT (id) DO UPDATE SET
                cekiciPlaka = EXCLUDED.cekiciPlaka,
                dorsePlaka = EXCLUDED.dorsePlaka,
                data = EXCLUDED.data,
                sort_ts = EXCLUDED.sort_ts
              `,
              [id, cekiciPlaka, dorsePlaka, dataRaw, sortTs]
            );
            processed++;
            continue;
          }

          if (String(k).startsWith("auto_backup_")) {
            const id = k;
            const created = parsed && parsed.ts ? (Date.parse(parsed.ts) || Date.now()) : Date.now();
            let dataRaw = JSON.stringify(parsed || raw);
            // If data is too long for daily_rows, truncate and log a warning
            try {
              if (typeof dataRaw === 'string' && dataRaw.length > 3000) {
                console.warn('restore-full: truncating daily_rows data for', k, 'length', dataRaw.length);
                dataRaw = dataRaw.slice(0, 3000);
              }
            } catch (e) {}

            await client.query(
              `
              INSERT INTO daily_rows(id, plaka, data, created_at)
              VALUES($1,$2,$3,$4)
              ON CONFLICT (id) DO UPDATE SET
                plaka = EXCLUDED.plaka,
                data = EXCLUDED.data,
                created_at = EXCLUDED.created_at
              `,
              [id, "", dataRaw, Number(created)]
            );
            processed++;
            continue;
          }

          // piyasa_state_v1 -> kv_store
          if (k === "piyasa_state_v1") {
            const v = typeof raw === "string" ? raw : JSON.stringify(raw);
            await client.query(
              `
              INSERT INTO kv_store(key, value)
              VALUES($1,$2)
              ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
              `,
              [k, v]
            );
            processed++;
            continue;
          }

          // default: kv_store
          const v = typeof raw === "string" ? raw : JSON.stringify(raw);
          await client.query(
            `
            INSERT INTO kv_store(key, value)
            VALUES($1,$2)
            ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
            `,
            [k, v]
          );
          processed++;
        } catch { failed++; }
      }
    }

    await client.query("COMMIT");
    res.json({ ok: true, processed, failed });
  } catch (err) {
    await safeRollback(client, 'restore-full');
    sendApiError(res, err, 500, 'RESTORE_FULL_FAILED');
  } finally {
    client.release();
  }
});

// Admin: List banned IPs (JWT ile; ayarlar UI aynı zamanda /settings/bans kullanır)
api.get("/admin/banned-ips", auth.verifyToken, async (req, res) => {
  try {
    const payload = listBannedIpsPayload();
    res.json({ ok: true, ...payload });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin: Unban an IP
api.post("/admin/unban-ip", auth.verifyToken, async (req, res) => {
  try {
    const ip = String(req.body.ip || '').trim();
    if (!ip) return res.status(400).json({ ok: false, error: 'IP gerekli' });
    const removed = unbanIp(ip);
    res.json({ ok: true, removed, message: removed ? `IP ${ip} engeli kaldırıldı` : 'Bu IP listede yoktu' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin: Ban an IP manually
api.post("/admin/ban-ip", auth.verifyToken, async (req, res) => {
  try {
    const ip = String(req.body.ip || '').trim();
    const reason = String(req.body.reason || 'Manuel engel (yönetici)');
    if (!ip) return res.status(400).json({ ok: false, error: 'IP gerekli' });
    banIp(ip, reason);
    res.json({ ok: true, message: `IP ${normalizeClientIp(ip)} engellendi` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin: Get rate limit status for an IP
api.get("/admin/ip-status/:ip", auth.verifyToken, async (req, res) => {
  try {
    const ip = String(req.params.ip || '').trim();
    const ipData = ipRequestCount.get(ip);
    const banned = isIpBanned(ip);
    
    res.json({
      ok: true,
      ip,
      banned,
      requests: ipData ? ipData.count : 0,
      failedLogins: ipData ? ipData.failedLogins : 0,
      resetTime: ipData ? new Date(ipData.resetTime).toISOString() : null
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Simple search endpoint for plates / daily_rows
// Query: q (string), limit (number)
api.get('/search', async (req, res) => {
  try {
    const qRaw = String(req.query.q || '').trim();
    if (!qRaw) return res.json([]);
    // basic normalize: remove special chars, lower
    const qNorm = qRaw.replace(/[^A-Za-z0-9ÇĞİÖŞÜçğıöşü\s]/g, '').toLowerCase();
    const like = '%' + qNorm + '%';
    const limit = Math.min(Math.max(Number(req.query.limit || 50) || 50, 1), 200);

    // search plaka column or JSON payload (data) for the term
    const r = await q(
      `SELECT id, plaka, data, created_at FROM daily_rows WHERE lower(plaka) LIKE $1 OR lower(data) LIKE $1 ORDER BY created_at DESC LIMIT $2`,
      [like, limit]
    );

    const parsed = (r.rows || []).map(row => {
      try {
        const data = JSON.parse(row.data || '{}');
        return { id: row.id, plaka: row.plaka || (data && data.plaka) || '', data, created_at: row.created_at };
      } catch (e) {
        return { id: row.id, plaka: row.plaka || '', data: row.data || '', created_at: row.created_at };
      }
    });

    res.json(parsed);
  } catch (err) {
    console.error('GET /search error', err && err.message);
    sendApiError(res, err, 500, 'SEARCH_FAILED');
  }
});

// Print History API - Yazdırılma geçmişini yönetir
api.get("/print_history", async (req, res) => {
  try {
    const plaka = req.query.plaka;
    const basimYeriRaw = String(req.query.basimYeri || "").trim();
    const basimYeri = basimYeriRaw ? basimYeriRaw.toUpperCase() : "";
    const limit = Math.min(Number(req.query.limit || 100), 1000);
    
    let query = "SELECT id, plaka, firma, malzeme, tonaj, basim_yeri, sevkiyat_id, sofor, sevk_yeri, yukleme_turu, tarih FROM print_history";
    let params = [];
    
    if (plaka) {
      query += " WHERE plaka = $1";
      params.push(plaka);
    }
    const firmaFilter = sanitizeString(req.query.firma || '', 100).trim();
    const malzemeFilter = sanitizeString(req.query.malzeme || '', 100).trim();
    const yuklemeFilter = sanitizeString(req.query.yuklemeTuru || req.query.yukleme_turu || '', 100).trim();
    const sevkFilter = sanitizeString(req.query.sevkYeri || req.query.sevk_yeri || '', 200).trim();
    if (firmaFilter) {
      query += params.length ? ' AND' : ' WHERE';
      query += ' firma = $' + (params.length + 1);
      params.push(firmaFilter);
    }
    if (malzemeFilter) {
      query += params.length ? ' AND' : ' WHERE';
      query += ' malzeme = $' + (params.length + 1);
      params.push(malzemeFilter);
    }
    if (basimYeri) {
      query += params.length ? " AND" : " WHERE";
      query += " basim_yeri = $" + (params.length + 1);
      params.push(basimYeri);
    }
    if (yuklemeFilter) {
      query += params.length ? ' AND' : ' WHERE';
      query += ' yukleme_turu = $' + (params.length + 1);
      params.push(yuklemeFilter);
    }
    if (sevkFilter) {
      query += params.length ? ' AND' : ' WHERE';
      query += ' sevk_yeri = $' + (params.length + 1);
      params.push(sevkFilter);
    }
    
    query += " ORDER BY tarih DESC LIMIT $" + (params.length + 1);
    params.push(limit);
    
    const r = await q(query, params);
    res.json(r.rows || []);
  } catch (err) {
    console.error("GET /print_history error", err);
    sendApiError(res, err, 500, 'PRINT_HISTORY_LIST_FAILED');
  }
});

api.post("/print_history", auth.verifyToken, async (req, res) => {
  try {
    if (isPiyasaDurumFrozen()) {
      return res.status(403).json({
        error: 'PIYASA_DURUM_FROZEN',
        message: piyasaDurumFreezeMessage(),
      });
    }
    const body = req.body || {};
    const id = String(body.id || (Date.now().toString() + Math.random().toString(16).slice(2)));
    
    // Sanitize inputs
    const plaka = sanitizeString(body.plaka || "", 50);
    const firma = sanitizeString(body.firma || "", 100);
    const malzeme = sanitizeString(body.malzeme || "", 100);
    const tonaj = sanitizeString(body.tonaj || "", 50);
    const basim_yeri = sanitizeString(body.basim_yeri || body.basimYeri || "", 20).toUpperCase();
    const sevkiyat_id = sanitizeString(body.sevkiyat_id || "", 100);
    const sofor = sanitizeString(body.sofor || "", 120);
    const sevk_yeri = sanitizeString(body.sevk_yeri || body.sevkYeri || "", 200);
    const yukleme_turu = sanitizeString(body.yukleme_turu || body.yuklemeTuru || body.ambalajBilgisi || "", 100);
    // Her zaman sunucu saati (NTP); istemci Windows tarihi ileri/geri olsa bile rapor doğru anı tutar
    const tarih = Date.now();
    
    if (!plaka) return res.status(400).json({ error: "plaka required" });
    
    await q(`
      INSERT INTO print_history(id, plaka, firma, malzeme, tonaj, basim_yeri, sevkiyat_id, sofor, sevk_yeri, yukleme_turu, tarih)
      VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      ON CONFLICT (id) DO UPDATE SET
        firma = EXCLUDED.firma,
        malzeme = EXCLUDED.malzeme,
        tonaj = EXCLUDED.tonaj,
        basim_yeri = EXCLUDED.basim_yeri,
        sevkiyat_id = EXCLUDED.sevkiyat_id,
        sofor = EXCLUDED.sofor,
        sevk_yeri = EXCLUDED.sevk_yeri,
        yukleme_turu = EXCLUDED.yukleme_turu,
        tarih = EXCLUDED.tarih
    `, [id, plaka, firma, malzeme, tonaj, basim_yeri, sevkiyat_id, sofor, sevk_yeri, yukleme_turu, tarih]);
    
    // Broadcast real-time update to all connected clients
    broadcastReportUpdate({
      type: 'new_report',
      data: { id, plaka, firma, malzeme, tonaj, basim_yeri, sevkiyat_id, sofor, sevk_yeri, yukleme_turu, tarih }
    });
    
    res.json({ ok: true, id });
  } catch (err) {
    console.error("POST /print_history error", err);
    res.status(500).json({ error: err.message });
  }
});

api.delete("/print_history/:id", auth.verifyToken, async (req, res) => {
  try {
    const id = req.params.id;
    await q("DELETE FROM print_history WHERE id = $1", [id]);
    
    // Broadcast real-time update to all connected clients
    broadcastReportUpdate({
      type: 'report_deleted',
      data: { id }
    });
    
    res.json({ ok: true });
  } catch (err) {
    console.error("DELETE /print_history/:id error", err);
    res.status(500).json({ error: err.message });
  }
});

// ——— Plaka istatistikleri (yazdırma = geliş) ———
api.get("/plaka-stats", async (req, res) => {
  try {
    const tab = String(req.query.tab || 'top').toLowerCase();
    const days = Math.min(Math.max(Number(req.query.days) || 60, 7), 365);
    const search = sanitizeString(req.query.search || '', 50).trim();
    const { limit, offset } = parsePagination(req, { defaultLimit: 100, maxLimit: 500 });
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    const searchNorm = normPlateForLookup(search);

    const registeredSet = new Set();
    try {
      const vr = await q(`SELECT cekiciplaka FROM vehicles WHERE cekiciplaka IS NOT NULL AND cekiciplaka <> ''`);
      (vr.rows || []).forEach((row) => {
        const n = normPlateForLookup(row.cekiciplaka);
        if (n) registeredSet.add(n);
      });
    } catch (e) { /* ignore */ }

    let rows = [];

    if (tab === 'top' || tab === 'once') {
      const having = tab === 'once' ? ' HAVING COUNT(*) = 1' : '';
      let sql = `
        SELECT plaka,
               COUNT(*)::int AS print_count,
               MAX(tarih)::bigint AS last_print_ts,
               MIN(tarih)::bigint AS first_print_ts
        FROM print_history
        WHERE plaka IS NOT NULL AND plaka <> ''
      `;
      const params = [];
      if (searchNorm) {
        params.push(`%${searchNorm}%`);
        sql += ` AND ${PLATE_NORM_SQL} LIKE $${params.length}`;
      }
      sql += ` GROUP BY plaka${having} ORDER BY print_count DESC, last_print_ts DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
      params.push(limit, offset);
      const r = await q(sql, params);
      rows = (r.rows || []).map((row) => ({
        plaka: row.plaka,
        printCount: row.print_count,
        lastPrintTs: row.last_print_ts,
        firstPrintTs: row.first_print_ts,
        kayitli: registeredSet.has(normPlateForLookup(row.plaka))
      }));
    } else if (tab === 'never') {
      let sql = `
        SELECT v.cekiciplaka AS plaka, v.sort_ts AS kayit_ts
        FROM vehicles v
        WHERE v.cekiciplaka IS NOT NULL AND v.cekiciplaka <> ''
        AND NOT EXISTS (
          SELECT 1 FROM print_history ph
          WHERE ${PLATE_NORM_SQL_PH} = ${VEH_PLATE_NORM_SQL_CEK}
        )
      `;
      const params = [];
      if (searchNorm) {
        params.push(`%${searchNorm}%`);
        sql += ` AND ${VEH_PLATE_NORM_SQL_CEK} LIKE $${params.length}`;
      }
      sql += ` ORDER BY v.sort_ts DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
      params.push(limit, offset);
      const r = await q(sql, params);
      rows = (r.rows || []).map((row) => ({
        plaka: row.plaka,
        printCount: 0,
        lastPrintTs: null,
        firstPrintTs: null,
        kayitTs: row.kayit_ts,
        kayitli: true
      }));
    } else if (tab === 'idle') {
      const sql = `
        WITH ph_agg AS (
          SELECT plaka,
                 COUNT(*)::int AS print_count,
                 MAX(tarih)::bigint AS last_print_ts
          FROM print_history
          WHERE plaka IS NOT NULL AND plaka <> ''
          GROUP BY plaka
        ),
        idle_printed AS (
          SELECT plaka, print_count, last_print_ts, 'printed_idle'::text AS idle_kind
          FROM ph_agg
          WHERE last_print_ts < $1
        ),
        idle_never AS (
          SELECT v.cekiciplaka AS plaka, 0 AS print_count, NULL::bigint AS last_print_ts, 'never_printed'::text AS idle_kind
          FROM vehicles v
          WHERE v.cekiciplaka IS NOT NULL AND v.cekiciplaka <> ''
          AND v.sort_ts < $1
          AND NOT EXISTS (
            SELECT 1 FROM print_history ph
            WHERE ${PLATE_NORM_SQL_PH} = ${VEH_PLATE_NORM_SQL_CEK}
          )
        )
        SELECT * FROM idle_printed
        UNION ALL
        SELECT * FROM idle_never
        ORDER BY last_print_ts ASC NULLS FIRST, plaka ASC
        LIMIT $2 OFFSET $3
      `;
      const r = await q(sql, [cutoff, limit, offset]);
      rows = (r.rows || [])
        .filter((row) => !searchNorm || normPlateForLookup(row.plaka).includes(searchNorm))
        .map((row) => ({
          plaka: row.plaka,
          printCount: row.print_count,
          lastPrintTs: row.last_print_ts,
          idleKind: row.idle_kind,
          kayitli: registeredSet.has(normPlateForLookup(row.plaka))
        }));
    } else {
      return res.status(400).json({ error: 'Invalid tab', allowed: ['top', 'once', 'never', 'idle'] });
    }

    res.json({ tab, days, items: rows, limit, offset });
  } catch (err) {
    console.error('GET /plaka-stats error', err);
    sendApiError(res, err, 500, 'PLAKA_STATS_FAILED');
  }
});

// Plaka × firma × malzeme (Excel / takip formundan basılan ürünler)
api.get("/plaka-product-stats", async (req, res) => {
  try {
    const search = sanitizeString(req.query.search || '', 80).trim();
    const { limit, offset } = parsePagination(req, { defaultLimit: 100, maxLimit: 500 });
    const searchNorm = normPlateForLookup(search);
    const searchUpper = search.toUpperCase();

    let sql = `
      SELECT plaka,
             firma,
             malzeme,
             COUNT(*)::int AS print_count,
             MAX(tarih)::bigint AS last_print_ts
      FROM print_history
      WHERE plaka IS NOT NULL AND plaka <> ''
        AND (COALESCE(firma, '') <> '' OR COALESCE(malzeme, '') <> '')
    `;
    const params = [];
    if (search) {
      params.push(`%${searchNorm}%`, `%${searchUpper}%`, `%${searchUpper}%`);
      const i = params.length;
      sql += ` AND (
        ${PLATE_NORM_SQL} LIKE $${i - 2}
        OR UPPER(COALESCE(firma, '')) LIKE $${i - 1}
        OR UPPER(COALESCE(malzeme, '')) LIKE $${i}
      )`;
    }
    sql += ` GROUP BY plaka, firma, malzeme
      ORDER BY print_count DESC, last_print_ts DESC, plaka ASC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const r = await q(sql, params);
    res.json({
      items: (r.rows || []).map((row) => ({
        plaka: row.plaka,
        firma: row.firma || '',
        malzeme: row.malzeme || '',
        printCount: row.print_count,
        lastPrintTs: row.last_print_ts,
      })),
      limit,
      offset,
    });
  } catch (err) {
    console.error('GET /plaka-product-stats error', err);
    sendApiError(res, err, 500, 'PLAKA_PRODUCT_STATS_FAILED');
  }
});

api.get("/plaka-stats/summary", async (req, res) => {
  try {
    const days = Math.min(Math.max(Number(req.query.days) || 60, 7), 365);
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    const [topR, onceR, neverR, idleR, totalPrintsR, productPairsR, editLogR] = await Promise.all([
      q(`SELECT COUNT(*)::int AS c FROM (SELECT plaka FROM print_history WHERE plaka <> '' GROUP BY plaka) t`),
      q(`SELECT COUNT(*)::int AS c FROM (SELECT plaka FROM print_history WHERE plaka <> '' GROUP BY plaka HAVING COUNT(*) = 1) t`),
      q(`
        SELECT COUNT(*)::int AS c FROM vehicles v
        WHERE v.cekiciplaka IS NOT NULL AND v.cekiciplaka <> ''
        AND NOT EXISTS (
          SELECT 1 FROM print_history ph
          WHERE ${PLATE_NORM_SQL_PH} = ${VEH_PLATE_NORM_SQL_CEK}
        )
      `),
      q(`
        SELECT COUNT(*)::int AS c FROM (
          SELECT plaka FROM print_history WHERE plaka <> '' GROUP BY plaka HAVING MAX(tarih) < $1
          UNION
          SELECT v.cekiciplaka FROM vehicles v
          WHERE v.cekiciplaka <> '' AND v.sort_ts < $1
          AND NOT EXISTS (
            SELECT 1 FROM print_history ph
            WHERE ${PLATE_NORM_SQL_PH} = ${VEH_PLATE_NORM_SQL_CEK}
          )
        ) u
      `, [cutoff]),
      q(`SELECT COUNT(*)::int AS c FROM print_history`),
      q(`SELECT COUNT(*)::int AS c FROM (
        SELECT plaka, firma, malzeme FROM print_history
        WHERE plaka <> '' AND (COALESCE(firma,'') <> '' OR COALESCE(malzeme,'') <> '')
        GROUP BY plaka, firma, malzeme
      ) t`),
      q(`SELECT COUNT(*)::int AS c FROM vehicle_edit_log WHERE edit_ts >= $1`, [cutoff]),
    ]);
    res.json({
      days,
      uniquePlates: topR.rows[0]?.c || 0,
      onceCount: onceR.rows[0]?.c || 0,
      neverPrintedRegistered: neverR.rows[0]?.c || 0,
      idleCount: idleR.rows[0]?.c || 0,
      totalPrints: totalPrintsR.rows[0]?.c || 0,
      productPairCount: productPairsR.rows[0]?.c || 0,
      editLogCount: editLogR.rows[0]?.c || 0,
    });
  } catch (err) {
    console.error('GET /plaka-stats/summary error', err);
    sendApiError(res, err, 500, 'PLAKA_STATS_SUMMARY_FAILED');
  }
});

// Şoför kartı düzenleme geçmişi (ayarlar → Plaka istatistikleri → Bilgi)
api.get('/vehicle-edit-log', async (req, res) => {
  try {
    const search = sanitizeString(req.query.search || '', 80).trim();
    const plakaFilter = sanitizeString(req.query.plaka || '', 50).trim();
    const { limit, offset } = parsePagination(req, { defaultLimit: 20, maxLimit: 500 });
    const searchNorm = normPlateForLookup(search);
    const plakaNorm = normPlateForLookup(plakaFilter);

    let sql = `SELECT id, vehicle_id, plaka, summary, changes, user_id, edit_ts FROM vehicle_edit_log WHERE 1=1`;
    const params = [];

    if (plakaNorm) {
      params.push(plakaNorm);
      sql += ` AND ${plateNormSql('plaka')} = $${params.length}`;
    } else if (search) {
      params.push(`%${searchNorm}%`, `%${search.toUpperCase()}%`);
      sql += ` AND (${plateNormSql('plaka')} LIKE $${params.length - 1} OR UPPER(COALESCE(summary, '')) LIKE $${params.length})`;
    }

    sql += ` ORDER BY edit_ts DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const r = await q(sql, params);
    res.json({
      items: (r.rows || []).map((row) => {
        let changes = [];
        try { changes = JSON.parse(row.changes || '[]'); } catch (e) { changes = []; }
        return {
          id: row.id,
          vehicleId: row.vehicle_id,
          plaka: row.plaka,
          summary: row.summary || '',
          changes,
          userId: row.user_id || '',
          editTs: row.edit_ts,
        };
      }),
      limit,
      offset,
    });
  } catch (err) {
    console.error('GET /vehicle-edit-log error', err);
    sendApiError(res, err, 500, 'VEHICLE_EDIT_LOG_FAILED');
  }
});

// ——— İmza yönetimi (Kantar + Sevkiyat saha) ———
api.get("/signatures", async (req, res) => {
  try {
    const role = sanitizeString(req.query.role || '', 20).toLowerCase();
    let sql = `SELECT id, display_name, role, image_kind, active, created_at FROM signatures WHERE active = TRUE`;
    const params = [];
    if (role === 'kantar' || role === 'saha') {
      params.push(role);
      sql += ` AND role = $${params.length}`;
    }
    sql += ` ORDER BY display_name ASC`;
    const r = await q(sql, params);
    res.json((r.rows || []).map((row) => ({
      id: row.id,
      displayName: row.display_name,
      role: row.role,
      imageKind: row.image_kind,
      active: row.active,
      createdAt: row.created_at
    })));
  } catch (err) {
    console.error('GET /signatures error', err);
    sendApiError(res, err, 500, 'SIGNATURES_LIST_FAILED');
  }
});

api.get("/signatures/map", async (req, res) => {
  try {
    const r = await q(`SELECT id, display_name, role, image_kind, image_data FROM signatures WHERE active = TRUE`);
    const map = { kantar: {}, saha: {} };
    (r.rows || []).forEach((row) => {
      const role = String(row.role || '').toLowerCase();
      if (role !== 'kantar' && role !== 'saha') return;
      const key = String(row.display_name || '').trim().toUpperCase();
      if (!key) return;
      map[role][key] = signatureRowToSrc(row);
    });
    res.json(map);
  } catch (err) {
    console.error('GET /signatures/map error', err);
    sendApiError(res, err, 500, 'SIGNATURES_MAP_FAILED');
  }
});

api.get("/signatures/:id/image", async (req, res) => {
  try {
    const id = sanitizeString(req.params.id, 80);
    const r = await q(`SELECT image_kind, image_data FROM signatures WHERE id = $1 AND active = TRUE`, [id]);
    const row = r.rows[0];
    if (!row) return res.status(404).json({ error: 'not found' });
    const src = signatureRowToSrc(row);
    if (src.startsWith('data:')) {
      const m = src.match(/^data:([^;]+);base64,(.+)$/);
      if (!m) return res.status(400).json({ error: 'invalid image' });
      const buf = Buffer.from(m[2], 'base64');
      res.setHeader('Content-Type', m[1]);
      res.setHeader('Cache-Control', 'private, max-age=3600');
      return res.send(buf);
    }
    return res.redirect(src);
  } catch (err) {
    console.error('GET /signatures/:id/image error', err);
    sendApiError(res, err, 500, 'SIGNATURE_IMAGE_FAILED');
  }
});

api.post("/signatures", async (req, res) => {
  try {
    const body = req.body || {};
    const displayName = sanitizeString(body.displayName || body.display_name || '', 120).trim();
    const role = sanitizeString(body.role || 'kantar', 20).toLowerCase();
    let imageData = String(body.imageData || body.image_data || body.image || '').trim();
    if (!displayName) return res.status(400).json({ error: 'displayName required' });
    if (role !== 'kantar' && role !== 'saha') return res.status(400).json({ error: 'role must be kantar or saha' });
    if (!imageData) return res.status(400).json({ error: 'image required' });
    if (imageData.length > 2_500_000) return res.status(400).json({ error: 'image too large' });
    let imageKind = 'base64';
    if (imageData.startsWith('data:')) {
      /* keep */
    } else if (/^signatures\//i.test(imageData) || imageData.startsWith('/signatures/')) {
      imageKind = 'path';
      imageData = imageData.replace(/^\//, '');
    } else {
      imageData = `data:image/png;base64,${imageData}`;
    }
    const dup = await q(
      `SELECT id FROM signatures WHERE active = TRUE AND role = $1 AND upper(display_name) = upper($2) LIMIT 1`,
      [role, displayName]
    );
    if (dup.rows[0]) {
      return res.status(409).json({ error: 'Bu isim bu rol için zaten kayıtlı', id: dup.rows[0].id });
    }
    const id = String(body.id || `sig_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`);
    const created = Date.now();
    await q(
      `INSERT INTO signatures(id, display_name, role, image_kind, image_data, active, created_at)
       VALUES($1,$2,$3,$4,$5,TRUE,$6)`,
      [id, displayName, role, imageKind, imageData, created]
    );
    res.json({ ok: true, id, displayName, role });
  } catch (err) {
    console.error('POST /signatures error', err);
    sendApiError(res, err, 500, 'SIGNATURE_CREATE_FAILED');
  }
});

api.delete("/signatures/:id", async (req, res) => {
  try {
    const id = sanitizeString(req.params.id, 80);
    await q(`UPDATE signatures SET active = FALSE WHERE id = $1`, [id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /signatures/:id error', err);
    sendApiError(res, err, 500, 'SIGNATURE_DELETE_FAILED');
  }
});


// ✅ ENHANCED SERVER-SENT EVENTS for real-time updates
const sseClients = new Set();

// Unified SSE endpoint for all real-time updates
const SSE_PING_INTERVAL_MS = 25000;

function attachSseClient(req, res, initialPayload) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Cache-Control'
  });

  if (typeof res.flushHeaders === 'function') {
    try { res.flushHeaders(); } catch (e) { /* ignore */ }
  }

  sseClients.add(res);
  res.write(`data: ${JSON.stringify(initialPayload)}\n\n`);

  const pingInterval = setInterval(() => {
    try {
      res.write(': ping\n\n');
    } catch (e) {
      clearInterval(pingInterval);
      sseClients.delete(res);
    }
  }, SSE_PING_INTERVAL_MS);

  req.on('close', () => {
    clearInterval(pingInterval);
    sseClients.delete(res);
  });
}

app.get('/api/events-stream', (req, res) => {
  attachSseClient(req, res, { type: 'connected', clientId: crypto.randomUUID(), timestamp: Date.now() });
});

// Legacy reports-stream endpoint for backward compatibility
app.get('/api/reports-stream', (req, res) => {
  attachSseClient(req, res, { type: 'connected', timestamp: Date.now() });
});

// Enhanced broadcast function for all data updates
function broadcastEvent(type, data, source = null) {
  const message = `data: ${JSON.stringify({
    type,
    data,
    timestamp: Date.now(),
    source
  })}\n\n`;
  
  sseClients.forEach(client => {
    try {
      client.write(message);
    } catch (error) {
      // Remove dead clients
      sseClients.delete(client);
    }
  });
}

// Legacy function for backward compatibility
function broadcastReportUpdate(data) {
  broadcastEvent(data.type, data.data || data, 'legacy_reports');
}

// Heartbeat endpoint for SSE connection monitoring
app.get('/api/heartbeat', (req, res) => {
  res.status(200).json({ 
    status: 'ok', 
    timestamp: Date.now(),
    clients: sseClients.size
  });
});

// Ayarlar / ban API — JWT router dışında (api.use(verifyToken) tüm isteklere uygulanıyordu)
app.post('/api/settings/verify-access', (req, res) => {
  try {
    const password = String((req.body && req.body.password) || '');
    if (!verifySettingsPassword(password)) {
      return res.status(403).json({ ok: false, error: 'Hatalı ayarlar parolası' });
    }
    const settingsToken = issueSettingsToken();
    return res.json({ ok: true, settingsToken });
  } catch (err) {
    sendApiError(res, err, 500, 'SETTINGS_ACCESS_VERIFY_FAILED');
  }
});

app.get('/api/settings/bans/my-ip', (req, res) => {
  res.json({ ok: true, ip: normalizeClientIp(getClientIp(req)) });
});

app.post('/api/settings/bans/list', requireSettingsAccess, (req, res) => {
  try {
    const payload = listBannedIpsPayload();
    res.json({ ok: true, ...payload });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/settings/bans/unban', requireSettingsAccess, (req, res) => {
  try {
    const ip = String(req.body.ip || '').trim();
    if (!ip) return res.status(400).json({ ok: false, error: 'IP gerekli' });
    const removed = unbanIp(ip);
    res.json({ ok: true, removed, message: removed ? `IP ${ip} engeli kaldırıldı` : 'Bu IP listede yoktu' });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/settings/bans/add', requireSettingsAccess, (req, res) => {
  try {
    const ip = String(req.body.ip || '').trim();
    const reason = String(req.body.reason || 'Manuel engel (ayarlar)');
    if (!ip) return res.status(400).json({ ok: false, error: 'IP gerekli' });
    banIp(ip, reason);
    res.json({ ok: true, message: `IP ${normalizeClientIp(ip)} engellendi` });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/settings/bans/clear', requireSettingsAccess, (req, res) => {
  try {
    const count = Object.keys(bannedIpsList).length;
    bannedIpsList = {};
    saveBannedIps();
    res.json({ ok: true, cleared: count, message: 'Tüm IP engelleri kaldırıldı' });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.use("/api", api);

// ✅ SPA FALLBACK: Catch-all route for client-side routing
app.use((req, res) => {
  if (!req.url.startsWith("/api")) {
    return res.sendFile(
      path.join(__dirname, "public", "GIRIS.html"),
      (err) => {
        if (err) {
          res.status(404).json({ error: "Not found" });
        }
      }
    );
  }

  res.status(404).json({ error: "Endpoint not found" });
});

// App initialization (DB, bans file, cron) — once per process
let initialized = false;
let initPromise = null;

async function initializeApp() {
  if (initialized) return;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      console.log('🚀 Initializing application...');
      
      // Load banned IPs from file at startup; reload when file changes (manual edits / clear-bans)
      loadBannedIps();
      startBannedIpsFileWatcher();
      
      // Initial pool health check
      console.log('🔍 Checking database connection...');
      const initialHealth = await checkPoolHealth();
      if (!initialHealth) {
        throw new Error('Initial database connection failed. Please check DATABASE_URL and network.');
      }
      
      await prepareSchema();
      await seedPiyasaCustomersIfEmpty();
      console.log("✅ Connected to PostgreSQL and ensured schema.");
      
      // Periodic health monitoring (every 15 minutes)
      setInterval(async () => {
        const healthy = await checkPoolHealth();
        if (!healthy) {
          console.warn('⚠️ Periodic health check failed - pool may have connectivity issues');
        }
      }, 15 * 60 * 1000);

      if (REPORT_CLEANUP_ENABLED) {
        // Run cleanup once at startup
        deleteOldReports().catch(() => {});

        // Schedule monthly cleanup using node-cron. Cron expression can be overridden
        // with REPORT_CLEAN_CRON env var (default: midnight on the 1st of each month).
        try {
          cron.schedule(REPORT_CLEAN_CRON, () => {
            console.log('Running scheduled monthly report cleanup');
            deleteOldReports().catch((e) => console.error('Scheduled cleanup error:', e));
          }, { timezone: process.env.CRON_TIMEZONE || 'Europe/Istanbul' });
          console.log('Scheduled monthly report cleanup:', REPORT_CLEAN_CRON);
        } catch (e) {
          console.error('Failed to schedule monthly cleanup:', e.message || e);
        }
      } else {
        console.log('Report cleanup disabled (REPORT_CLEANUP_ENABLED=false).');
      }

      // Ensure users table exists and create default user GENPER if missing
      try {
        await auth.ensureUsersTable();
        try {
          await auth.registerUser('GENPER', 'GEN20PER26', { role: 'admin' });
          console.log('Default user ensured: GENPER');
        } catch (e) {
          // registerUser may throw on bad input; ignore if user exists
          console.log('Default user setup skipped or already exists');
        }
      } catch (e) {
        console.error('Failed to ensure users table or create default user:', e && e.message ? e.message : e);
      }

      initialized = true;
    } catch (e) {
      console.error("Initialization failed:", e);
      throw e;
    }
  })();

  return initPromise;
}

// Middleware to ensure app is initialized before handling requests
app.use(async (req, res, next) => {
  try {
    await initializeApp();
    next();
  } catch (e) {
    res.status(503).json({ error: 'Service initialization failed', message: e.message });
  }
});

// Export for tests / tooling; normal start uses `if (require.main === module)` below
module.exports = app;

const PORT = Number(process.env.PORT || 3000);
/** 0 = port doluysa 3001'e geçme; yalnızca PORT'ta dinle veya çık */
const MAX_PORT_RETRIES = Number(process.env.PORT_RETRY_LIMIT ?? 0);
/** true: başlamadan önce PORT'taki eski node sürecini sonlandır (localhost geliştirme) */
const PORT_RECLAIM = String(process.env.PORT_RECLAIM ?? 'true').toLowerCase() !== 'false';
const { execSync } = require('child_process');

function freeListeningPort(port) {
  const myPid = String(process.pid);
  if (process.platform === 'win32') {
    let out = '';
    try {
      out = execSync(`netstat -ano | findstr ":${port}" | findstr LISTENING`, {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'ignore'],
      });
    } catch (_) {
      return;
    }
    const pids = new Set();
    for (const line of out.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const parts = trimmed.split(/\s+/);
      const pid = parts[parts.length - 1];
      if (pid && /^\d+$/.test(pid)) pids.add(pid);
    }
    for (const pid of pids) {
      if (pid === myPid) continue;
      try {
        execSync(`taskkill /PID ${pid} /F`, { stdio: 'ignore' });
        console.warn(`⚠️ Port ${port} — eski süreç sonlandırıldı (PID ${pid}).`);
      } catch (_) {}
    }
    return;
  }
  try {
    execSync(`lsof -ti tcp:${port} | xargs -r kill -9`, { stdio: 'ignore' });
  } catch (_) {}
}

function startServerWithPortFallback(basePort) {
  let reclaimAttempted = false;

  const tryListen = (port, attemptsLeft, afterReclaim) => {
    const server = app.listen(port, () => {
      if (port !== basePort) {
        console.log(`⚠️ Port ${basePort} dolu olduğu için ${port} kullanılıyor.`);
      }
      console.log(`✅ Server listening on http://localhost:${port}`);
    });

    server.on('error', (err) => {
      if (err && err.code === 'EADDRINUSE' && PORT_RECLAIM && !reclaimAttempted) {
        reclaimAttempted = true;
        console.warn(`⚠️ Port ${port} dolu; ${port} yeniden alınıyor...`);
        try {
          server.close(() => {});
        } catch (_) {}
        freeListeningPort(port);
        setTimeout(() => tryListen(port, attemptsLeft, true), 400);
        return;
      }
      if (err && err.code === 'EADDRINUSE' && attemptsLeft > 0) {
        const nextPort = port + 1;
        console.warn(`⚠️ Port ${port} kullanımda. ${nextPort} deneniyor...`);
        setTimeout(() => tryListen(nextPort, attemptsLeft - 1, afterReclaim), 100);
        return;
      }
      if (err && err.code === 'EADDRINUSE') {
        console.error(`❌ Port ${port} kullanımda. Başka bir program portu tutuyor veya PORT_RECLAIM kapalı.`);
      } else {
        console.error('Server listen error:', err);
      }
      process.exit(1);
    });
  };

  if (PORT_RECLAIM) {
    freeListeningPort(basePort);
  }
  tryListen(basePort, MAX_PORT_RETRIES, false);
}

if (require.main === module) {
  (async () => {
    try {
      await initializeApp();
      startServerWithPortFallback(PORT);
    } catch (e) {
      console.error("Startup failed:", e);
      process.exit(1);
    }
  })();
}
