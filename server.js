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
const { envNumber } = require('./lib/env');
const { applySupabaseSecurity } = require('./lib/supabase-security');
const { createAuthSessionMiddleware } = require('./lib/auth-session');
const {
  sanitizeString,
  validateEmail,
  validatePhoneNumber,
  validateTCNumber,
  parseDateOrEpoch,
} = require('./lib/sanitize');
const {
  VEH_PLATE_NORM_SQL_CEK,
  VEH_PLATE_NORM_SQL_DORSE,
  normPlateForLookup,
  computeVehicleSortTs,
  maybeLogVehicleEdit,
  upsertVehicleRecord,
} = require('./lib/vehicle-helpers');
const { broadcastEvent, broadcastReportUpdate, registerSseRoutes } = require('./lib/sse');
const { registerAuthRoutes } = require('./routes/auth-routes');
const { registerVehicleRoutes } = require('./routes/vehicles-routes');
const { registerProblemRoutes } = require('./routes/problems-routes');
const { registerDailyRoutes } = require('./routes/daily-routes');
const { registerReportsRoutes } = require('./routes/reports-routes');
const { registerPiyasaRoutes } = require('./routes/piyasa-routes');
const { registerPlakaStatsRoutes } = require('./routes/plaka-stats-routes');
const { registerSignaturesRoutes } = require('./routes/signatures-routes');
const { plateNormSql, PLATE_NORM_SQL, PLATE_NORM_SQL_PH } = require('./lib/plate-norm-sql');
const { signatureRowToSrc } = require('./lib/signature-helpers');
const { createPiyasaServerApi } = require('./lib/piyasa-server');
const { formatReportInstant, istanbulMinutesFromTs } = require('./lib/report-format');

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is missing in environment (.env)");
}


const PG_POOL_MAX = envNumber('PG_POOL_MAX', 5, { min: 1, max: 100 });
const PG_POOL_MIN = envNumber('PG_POOL_MIN', 2, { min: 0, max: 100 });
const PG_IDLE_TIMEOUT = envNumber('PG_IDLE_TIMEOUT', 30000, { min: 1000, max: 600000 });
const PG_CONNECT_TIMEOUT = envNumber('PG_CONNECT_TIMEOUT', 10000, { min: 1000, max: 120000 });
const PG_MAX_USES = envNumber('PG_MAX_USES', 7500, { min: 100, max: 1000000 });
const PG_STATEMENT_TIMEOUT = envNumber('PG_STATEMENT_TIMEOUT', 30000, { min: 1000, max: 300000 });
/** Slow-query console.warn eÅŸiÄŸi (ms). BoÅŸ bÄ±rakÄ±lÄ±rsa 3000 â€” paylaÅŸÄ±mlÄ± DBâ€™de ~1sn listeler uyarÄ± spamâ€™i yapmaz. 0 / off / false = uyarÄ± kapalÄ±. */
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

/** Statik .js / .css iÃ§in Cache-Control max-age (saniye). 0 = Ã¶nbellek yok. */
const STATIC_MAX_AGE_SEC = envNumber('STATIC_MAX_AGE_SEC', 60, { min: 0, max: 86400 });
const JSON_BODY_LIMIT = process.env.JSON_BODY_LIMIT || '2mb';
const URLENCODED_BODY_LIMIT = process.env.URLENCODED_BODY_LIMIT || '2mb';

// âœ… POSTGRESQL CONNECTION POOLING: Advanced configuration
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

// âœ… POOL EVENT HANDLERS: Monitor pool health and catch errors
pool.on('error', (err, client) => {
  console.error('âŒ Unexpected pool error on idle client:', err.message || err);
  console.error('Client info:', client ? 'Active' : 'Unknown');
  // Don't exit the process on pool errors - let the pool handle reconnection
});

pool.on('connect', (client) => {
  console.log('âœ… New client connected to PostgreSQL pool');
  // Set default timezone for this connection
  try {
    client.query('SET timezone = "UTC"').catch(e => 
      console.warn('Failed to set timezone:', e.message)
    );
  } catch (e) {}
});

pool.on('acquire', (client) => {
  // Uncomment for verbose logging:
  // console.log('ğŸ”µ Client acquired from pool');
});

pool.on('remove', (client) => {
  console.log('ğŸ”´ Client removed from pool');
});

// âœ… GRACEFUL SHUTDOWN: Clean up pool connections on exit
const gracefulShutdown = async (signal) => {
  console.log(`\n${signal} received. Starting graceful shutdown...`);
  try {
    await pool.end();
    console.log('âœ… PostgreSQL pool closed successfully');
    process.exit(0);
  } catch (err) {
    console.error('âŒ Error during pool shutdown:', err.message || err);
    process.exit(1);
  }
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('unhandledRejection', (reason) => {
  console.error('âŒ Unhandled promise rejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('âŒ Uncaught exception:', err);
});

// âœ… POOL HEALTH CHECK: Verify pool connectivity
let poolHealthy = false;
async function checkPoolHealth() {
  try {
    const client = await pool.connect();
    try {
      const result = await client.query('SELECT NOW() as now, current_database() as db');
      console.log('âœ… Pool health check OK - DB:', result.rows[0].db, 'Time:', result.rows[0].now);
      poolHealthy = true;
      return true;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('âŒ Pool health check FAILED:', err.message || err);
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

// âœ… RETRY WRAPPER: Retry failed queries with exponential backoff + jitter
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
      console.warn(`âš ï¸ Query failed (attempt ${attempt}/${maxRetries}), retrying in ${delay}ms:`, err.message);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}


async function prepareSchema() {
  console.log('ğŸ”§ Preparing database schema...');
  
  // Verify pool health before schema operations
  const healthy = await checkPoolHealth();
  if (!healthy) {
    throw new Error('Database pool is not healthy. Cannot prepare schema.');
  }
  
  // TEXT id + TEXT json payload yaklaÅŸÄ±mÄ±nÄ± bozmuyoruz
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
  // Legacy DB'ler iÃ§in kolon migrasyonu
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
  // Global ORDER BY ts (GET /problems without ?plate=) â€” composite (plate, ts) cannot drive this sort.
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
  // Global ORDER BY tarih (GET /reports, unfiltered lists) â€” composite (plaka, tarih) is for per-plate only.
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

  try {
    await applySupabaseSecurity(pool);
  } catch (e) {
    console.warn('applySupabaseSecurity skipped:', e.message || e);
  }
}


const DEFAULT_KANTAR_SIGNATURES = [
  { display_name: 'BURAK KARATAÅ', path: 'signatures/burak_karatas.png' },
  { display_name: 'BEKÄ°R DOÄRU', path: 'signatures/bekir_dogru.png' },
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

/** AnlatÄ±m / demo â€” gerÃ§ek araÃ§ deÄŸil; Ayarlar â†’ Bilgi sekmesinde Ã¶rnek gÃ¶rÃ¼nsÃ¼n diye */
async function seedDemoVehicleEditLogs() {
  const now = Date.now();
  const demos = [
    {
      id: 'demo_edit_plaka_001',
      vehicle_id: 'demo_vehicle_001',
      plaka: '43 HP 433',
      summary: 'Ã‡ekici plaka: 43 HP 433 â†’ 43 HP 450 Â· ÅofÃ¶r adÄ±: MEHMET YILMAZ â†’ ZÃœLFÃœ USLU',
      changes: [
        { field: 'cekiciPlaka', label: 'Ã‡ekici plaka', old: '43 HP 433', new: '43 HP 450' },
        { field: 'soforAdi', label: 'ÅofÃ¶r adÄ±', old: 'MEHMET', new: 'ZÃœLFÃœ' },
        { field: 'soforSoyadi', label: 'ÅofÃ¶r soyadÄ±', old: 'YILMAZ', new: 'USLU' },
      ],
      user_id: 'GENPER',
      edit_ts: now - 2 * 60 * 60 * 1000,
    },
    {
      id: 'demo_edit_isim_002',
      vehicle_id: 'demo_vehicle_002',
      plaka: '34 ZFP 78',
      summary: 'ÅofÃ¶r adÄ±: ALÄ° KAYA â†’ HASAN Ã–ZTÃœRK Â· ÅofÃ¶r soyadÄ±: â€” â†’ â€”',
      changes: [
        { field: 'soforAdi', label: 'ÅofÃ¶r adÄ±', old: 'ALÄ°', new: 'HASAN' },
        { field: 'soforSoyadi', label: 'ÅofÃ¶r soyadÄ±', old: 'KAYA', new: 'Ã–ZTÃœRK' },
      ],
      user_id: 'GENPER',
      edit_ts: now - 5 * 60 * 60 * 1000,
    },
    {
      id: 'demo_edit_tel_003',
      vehicle_id: 'demo_vehicle_003',
      plaka: '06 ABT 123',
      summary: 'Ä°letiÅŸim: 0532 508 43 02 â†’ 0542 611 55 44',
      changes: [
        { field: 'iletisim', label: 'Ä°letiÅŸim', old: '0532 508 43 02', new: '0542 611 55 44' },
      ],
      user_id: 'GENPER',
      edit_ts: now - 26 * 60 * 60 * 1000,
    },
    {
      id: 'demo_edit_karma_004',
      vehicle_id: 'demo_vehicle_004',
      plaka: '16 BCD 890',
      summary: 'Dorse plaka: 34 ABC 12 â†’ 34 ZFP 78 Â· Ä°letiÅŸim: 0535 100 20 30 â†’ 0505 777 88 99 (+1)',
      changes: [
        { field: 'dorsePlaka', label: 'Dorse plaka', old: '34 ABC 12', new: '34 ZFP 78' },
        { field: 'iletisim', label: 'Ä°letiÅŸim', old: '0535 100 20 30', new: '0505 777 88 99' },
        { field: 'soforAdi', label: 'ÅofÃ¶r adÄ±', old: 'MUSTAFA', new: 'EMRE' },
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

// âœ… ENHANCED QUERY HELPER: error logging, retry logic, timeout, slow-query logs
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
        console.warn(`âš ï¸ Slow query ${elapsed}ms: ${summarizeQuery(text)}`);
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
    console.error("SQL error:", e.message, "\nQuery:", summarizeQuery(text), "\nParams:", params);
    console.error("Stack:", e.stack);
    throw e;
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
      requestId: res.locals.requestId || null,
    },
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

// Load banned IPs from file (must be a JSON object { "ip": { ... }, ... } â€” not an array)
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
  return res.status(403).json({ ok: false, error: 'Ayarlar parolasÄ± gerekli' });
}

function listBannedIpsPayload() {
  const now = Date.now();
  const banned = Object.entries(bannedIpsList).map(([key, data]) => {
    const ip = (data && data.ip) || key;
    const expiresAt = data && data.expiresAt ? Number(data.expiresAt) : 0;
    const bannedAt = data && data.bannedAt ? Number(data.bannedAt) : 0;
    return {
      ip,
      reason: (data && data.reason) || 'â€”',
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
      error: 'IP adresiniz geÃ§ici olarak engellendi. Ayarlar > Ban bÃ¶lÃ¼mÃ¼nden kaldÄ±rÄ±labilir veya sÃ¼re dolana kadar bekleyin.',
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
          error: 'Ã‡ok fazla istek nedeniyle IP adresiniz geÃ§ici olarak engellendi.',
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

// âœ… STATIC FILES: Serve only public directory (short cache for hashed-free assets)
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

/** GiriÅŸ endpoint'i: IP baÅŸÄ±na kÄ±sa pencerede ek sÄ±nÄ±r (baÅŸarÄ±lÄ± giriÅŸler sayÄ±lmaz). */
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
/** Oturum sÃ¼resi (saat). .env: AUTH_SESSION_HOURS=6 */
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

const {
  requireValidSession,
  requireAdmin,
  requireMutatingSession,
} = createAuthSessionMiddleware({
  jwtSecret: JWT_SECRET,
  authSessionHours: AUTH_SESSION_HOURS,
  cookieName: AUTH_COOKIE_NAME,
});

const piyasaServer = createPiyasaServerApi({
  q,
  broadcastReportUpdate,
  sanitizeString,
  rootDir: __dirname,
});

const routeCtx = {
  q,
  pool,
  auth,
  parsePagination,
  sendApiError,
  requireValidSession,
  requireAdmin,
  VEH_LIST_KEYSET_BATCH,
  PG_STATEMENT_TIMEOUT,
  broadcastEvent,
  broadcastReportUpdate,
  piyasaServer,
  normPlateForLookup,
  VEH_PLATE_NORM_SQL_CEK,
  PLATE_NORM_SQL,
  PLATE_NORM_SQL_PH,
  plateNormSql,
  signatureRowToSrc,
  verifySettingsPassword,
  formatReportInstant,
  istanbulMinutesFromTs,
  withTransaction,
  computeVehicleSortTs,
  sanitizeString,
  validatePlateFormat,
  loginEndpointLimiter,
  normalizeClientIp,
  getClientIp,
  ipRequestCount,
  RATE_LIMIT_WINDOW_MS,
  FAILED_LOGIN_THRESHOLD,
  banIp,
  AUTH_COOKIE_NAME,
  AUTH_COOKIE_OPTIONS,
  JWT_SECRET,
  AUTH_SESSION_EXPIRES,
};

registerAuthRoutes(api, routeCtx);

// Public health check (Railway/monitoring â€” auth gerekmez)
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

// JWT + yazma iÅŸlemleri iÃ§in oturum zorunluluÄŸu
api.use(auth.verifyToken);
api.use(requireMutatingSession);

api.post("/reports/bulk-delete", requireValidSession, async (req, res) => {
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

registerVehicleRoutes(api, routeCtx);
registerDailyRoutes(api, routeCtx);
registerPiyasaRoutes(api, routeCtx);
registerProblemRoutes(api, routeCtx);
registerReportsRoutes(api, routeCtx);



// Export DB (Postgres'te .sqlite dosyasÄ± yok; JSON yedek indiriyoruz)
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
    // âœ… SECURITY: Sanitize KV store values
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

// Vardiya / operasyon notlarÄ± (Excel kurallÄ± uyarÄ±lar)
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

api.post('/operation-notes', requireValidSession, async (req, res) => {
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

api.patch('/operation-notes/:id', requireValidSession, async (req, res) => {
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

// Admin: List banned IPs (JWT ile; ayarlar UI aynÄ± zamanda /settings/bans kullanÄ±r)
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
    res.json({ ok: true, removed, message: removed ? `IP ${ip} engeli kaldÄ±rÄ±ldÄ±` : 'Bu IP listede yoktu' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin: Ban an IP manually
api.post("/admin/ban-ip", auth.verifyToken, async (req, res) => {
  try {
    const ip = String(req.body.ip || '').trim();
    const reason = String(req.body.reason || 'Manuel engel (yÃ¶netici)');
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
    const qNorm = qRaw.replace(/[^A-Za-z0-9Ã‡ÄÄ°Ã–ÅÃœÃ§ÄŸÄ±Ã¶ÅŸÃ¼\s]/g, '').toLowerCase();
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

// Print History API - YazdÄ±rÄ±lma geÃ§miÅŸini yÃ¶netir
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
    // Her zaman sunucu saati (NTP); istemci Windows tarihi ileri/geri olsa bile rapor doÄŸru anÄ± tutar
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




registerPlakaStatsRoutes(api, routeCtx);
registerSignaturesRoutes(api, routeCtx);

registerSseRoutes(app);

// Ayarlar / ban API â€” JWT router dÄ±ÅŸÄ±nda (api.use(verifyToken) tÃ¼m isteklere uygulanÄ±yordu)
app.post('/api/settings/verify-access', (req, res) => {
  try {
    const password = String((req.body && req.body.password) || '');
    if (!verifySettingsPassword(password)) {
      return res.status(403).json({ ok: false, error: 'HatalÄ± ayarlar parolasÄ±' });
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
    res.json({ ok: true, removed, message: removed ? `IP ${ip} engeli kaldÄ±rÄ±ldÄ±` : 'Bu IP listede yoktu' });
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
    res.json({ ok: true, cleared: count, message: 'TÃ¼m IP engelleri kaldÄ±rÄ±ldÄ±' });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.use("/api", api);

// âœ… SPA FALLBACK: Catch-all route for client-side routing
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

// App initialization (DB, bans file, cron) â€” once per process
let initialized = false;
let initPromise = null;

async function initializeApp() {
  if (initialized) return;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      console.log('ğŸš€ Initializing application...');
      
      // Load banned IPs from file at startup; reload when file changes (manual edits / clear-bans)
      loadBannedIps();
      startBannedIpsFileWatcher();
      
      // Initial pool health check
      console.log('ğŸ” Checking database connection...');
      const initialHealth = await checkPoolHealth();
      if (!initialHealth) {
        throw new Error('Initial database connection failed. Please check DATABASE_URL and network.');
      }
      
      await prepareSchema();
      await piyasaServer.seedPiyasaCustomersIfEmpty();
      console.log("âœ… Connected to PostgreSQL and ensured schema.");
      
      // Periodic health monitoring (every 15 minutes)
      setInterval(async () => {
        const healthy = await checkPoolHealth();
        if (!healthy) {
          console.warn('âš ï¸ Periodic health check failed - pool may have connectivity issues');
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
/** 0 = port doluysa 3001'e geÃ§me; yalnÄ±zca PORT'ta dinle veya Ã§Ä±k */
const MAX_PORT_RETRIES = Number(process.env.PORT_RETRY_LIMIT ?? 0);
/** true: baÅŸlamadan Ã¶nce PORT'taki eski node sÃ¼recini sonlandÄ±r (localhost geliÅŸtirme) */
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
        console.warn(`âš ï¸ Port ${port} â€” eski sÃ¼reÃ§ sonlandÄ±rÄ±ldÄ± (PID ${pid}).`);
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
        console.log(`âš ï¸ Port ${basePort} dolu olduÄŸu iÃ§in ${port} kullanÄ±lÄ±yor.`);
      }
      console.log(`âœ… Server listening on http://localhost:${port}`);
    });

    server.on('error', (err) => {
      if (err && err.code === 'EADDRINUSE' && PORT_RECLAIM && !reclaimAttempted) {
        reclaimAttempted = true;
        console.warn(`âš ï¸ Port ${port} dolu; ${port} yeniden alÄ±nÄ±yor...`);
        try {
          server.close(() => {});
        } catch (_) {}
        freeListeningPort(port);
        setTimeout(() => tryListen(port, attemptsLeft, true), 400);
        return;
      }
      if (err && err.code === 'EADDRINUSE' && attemptsLeft > 0) {
        const nextPort = port + 1;
        console.warn(`âš ï¸ Port ${port} kullanÄ±mda. ${nextPort} deneniyor...`);
        setTimeout(() => tryListen(nextPort, attemptsLeft - 1, afterReclaim), 100);
        return;
      }
      if (err && err.code === 'EADDRINUSE') {
        console.error(`âŒ Port ${port} kullanÄ±mda. BaÅŸka bir program portu tutuyor veya PORT_RECLAIM kapalÄ±.`);
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
