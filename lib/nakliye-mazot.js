'use strict';

/** Son doğrulanmış OPET listesi. kv_store.value TEXT; yeni tablo açılmaz. */
const MAZOT_KV_KEY = 'nakliye_mazot_son';
const DEFAULT_TIMEOUT_MS = 4000;
const FRESH_MS = 6 * 60 * 60 * 1000;
const RETRY_MS = 60 * 1000;
const OPET_PROVINCES = 'https://api.opet.com.tr/api/fuelprices/provinces';

function classifyFetchError(err) {
  const cause = err && err.cause;
  const code = String((cause && cause.code) || (err && err.code) || '');
  const name = String((err && err.name) || '');
  const text = String((cause && cause.message) || (err && err.message) || '');
  if (err && err.phase && err.codeName) {
    return { phase: err.phase, code: err.codeName };
  }
  if (name === 'TimeoutError' || name === 'AbortError' || code === 'ABORT_ERR' || code === 'UND_ERR_CONNECT_TIMEOUT') {
    return { phase: 'zaman-asimi', code: code || name || 'TIMEOUT' };
  }
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return { phase: 'dns', code };
  if (/CERT|TLS|UNABLE_TO_VERIFY|ERR_TLS/i.test(code) || /certificate|tls/i.test(text)) {
    return { phase: 'tls', code: code || 'TLS' };
  }
  if (/^HTTP \d+$/.test(text) || (err && err.phase === 'http')) {
    return { phase: 'http', code: code || text.replace(/\s+/g, '_') };
  }
  if (code === 'JSON' || err && err.phase === 'govde') return { phase: 'govde', code: 'JSON' };
  return { phase: 'baglanti', code: code || name || 'BAGLANTI' };
}

function logMazotFailure(log, info) {
  const write = typeof log === 'function' ? log : console.error;
  const phase = String((info && info.phase) || 'baglanti').replace(/[^\w-]/g, '').slice(0, 24);
  const code = String((info && info.code) || 'BILINMIYOR').replace(/[^\w-]/g, '').slice(0, 40);
  const ms = Number(info && info.ms);
  const sure = Number.isFinite(ms) && ms >= 0 ? Math.round(ms) : -1;
  write('[nakliye-mazot] sonuc=hata asama=' + phase + ' kod=' + code + ' sureMs=' + sure + ' kaynak=OPET');
}

function isVerifiedSnapshot(payload) {
  if (!payload || typeof payload !== 'object') return false;
  if (payload.ok === false) return false;
  if (String(payload.kaynak || '') !== 'OPET') return false;
  if (!payload.updatedAt || Number.isNaN(Date.parse(payload.updatedAt))) return false;
  return Array.isArray(payload.iller) && payload.iller.length > 0;
}

function snapshotCore(payload) {
  return {
    ok: true,
    updatedAt: payload.updatedAt,
    kaynak: 'OPET',
    urun: payload.urun || 'Motorin UltraForce',
    iller: payload.iller,
    ilceler: Array.isArray(payload.ilceler) ? payload.ilceler : [],
    onceki: payload.onceki || null,
  };
}

function markFresh(payload) {
  return Object.assign(snapshotCore(payload), { guncel: true, bayat: false });
}

function markStale(payload, nereden) {
  return Object.assign(snapshotCore(payload), {
    guncel: false,
    bayat: true,
    dosya: nereden === 'dosya',
    kayit: nereden,
  });
}

function emptyMazot() {
  return {
    ok: false,
    guncel: false,
    bayat: false,
    kaynak: 'OPET',
    updatedAt: null,
    iller: [],
    ilceler: [],
    error: 'Doğrulanmış mazot fiyatı bulunamadı.',
  };
}

function ipv4Dispatcher() {
  try {
    const { Agent } = require('undici');
    return new Agent({
      connect: { family: 4, timeout: 4000 },
      headersTimeout: 8000,
      bodyTimeout: 8000,
    });
  } catch (err) {
    return null;
  }
}

function createMazotService(deps) {
  const fetchImpl = deps && deps.fetchImpl;
  const buildPayload = deps && deps.buildPayload;
  const q = deps && deps.q;
  const readText = deps && deps.readText;
  const writeText = deps && deps.writeText;
  const log = (deps && deps.log) || console.error;
  const timeoutMs = Number(deps && deps.timeoutMs) > 0 ? Number(deps.timeoutMs) : DEFAULT_TIMEOUT_MS;
  const budgetMs = Number(deps && deps.budgetMs) > 0 ? Number(deps.budgetMs) : 6500;
  const dispatcher = deps && Object.prototype.hasOwnProperty.call(deps, 'dispatcher')
    ? deps.dispatcher
    : null;
  const now = (deps && deps.now) || (() => Date.now());
  const freshMs = Number(deps && deps.freshMs) > 0 ? Number(deps.freshMs) : FRESH_MS;
  const retryMs = Number(deps && deps.retryMs) >= 0 ? Number(deps.retryMs) : RETRY_MS;
  const provincesUrl = (deps && deps.provincesUrl) || OPET_PROVINCES;
  let cache = { at: 0, payload: null };
  let failedAt = 0;
  let job = null;
  let slowJob = null;

  function istanbulGunu(iso) {
    try {
      return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit',
      }).format(new Date(iso));
    } catch (err) {
      return '';
    }
  }

  function readOnceki() {
    if (!deps || typeof deps.readOnceki !== 'function') return null;
    try {
      const parsed = JSON.parse(deps.readOnceki() || '');
      if (!parsed || !Array.isArray(parsed.iller) || !parsed.iller.length) return null;
      return { updatedAt: parsed.updatedAt || null, iller: parsed.iller };
    } catch (err) {
      return null;
    }
  }

  function rememberYesterday(nextPayload) {
    if (!deps || typeof deps.writeOnceki !== 'function' || typeof readText !== 'function') return;
    const current = readFileSnapshot();
    const nextDay = istanbulGunu(nextPayload && nextPayload.updatedAt);
    const curDay = current && istanbulGunu(current.updatedAt);
    if (!current || !curDay || !nextDay || curDay === nextDay) return;
    try {
      deps.writeOnceki(JSON.stringify({ updatedAt: current.updatedAt, iller: current.iller }));
    } catch (err) {
      log('[nakliye-mazot] sonuc=onceki-yazilamadi kod=dosya');
    }
  }

  async function fetchJson(url, timeoutOverride) {
    const started = now();
    const limit = Number(timeoutOverride) > 0 ? Number(timeoutOverride) : timeoutMs;
    if (typeof fetchImpl !== 'function') {
      const err = new Error('fetch yok');
      err.phase = 'baglanti';
      err.codeName = 'FETCH_YOK';
      err.ms = 0;
      throw err;
    }
    try {
      const res = await fetchImpl(url, {
        headers: { Accept: 'application/json', 'User-Agent': 'gpm-nakliye/1.0' },
        redirect: 'follow',
        signal: AbortSignal.timeout(limit),
        dispatcher: dispatcher || undefined,
      });
      if (!res || !res.ok) {
        const status = res && res.status ? res.status : 0;
        const err = new Error('HTTP ' + status);
        err.phase = 'http';
        err.codeName = 'HTTP_' + status;
        err.ms = now() - started;
        throw err;
      }
      try {
        return await res.json();
      } catch (parseErr) {
        const err = new Error('JSON');
        err.phase = 'govde';
        err.codeName = 'JSON';
        err.ms = now() - started;
        throw err;
      }
    } catch (err) {
      if (err && err.phase) throw err;
      const kind = classifyFetchError(err);
      const wrapped = new Error('fetch failed');
      wrapped.phase = kind.phase;
      wrapped.codeName = kind.code;
      wrapped.ms = now() - started;
      throw wrapped;
    }
  }

  async function mapPool(items, limit, fn) {
    const out = new Array(items.length);
    let cursor = 0;
    async function worker() {
      while (cursor < items.length) {
        const idx = cursor;
        cursor += 1;
        out[idx] = await fn(items[idx], idx);
      }
    }
    const width = Math.min(limit, items.length);
    await Promise.all(Array.from({ length: width }, () => worker()));
    return out;
  }

  async function fetchOpetRows(limit) {
    const startedAll = now();
    const useLimit = Number(limit) > 0 ? Number(limit) : timeoutMs;
    const useBudget = Number(limit) > 0 ? Math.max(budgetMs, useLimit + 2000) : budgetMs;
    const provinces = await fetchJson(provincesUrl, useLimit);
    if (!Array.isArray(provinces)) {
      const err = new Error('JSON');
      err.phase = 'govde';
      err.codeName = 'JSON';
      err.ms = 0;
      throw err;
    }
    let provinceLogged = false;
    const groups = await mapPool(provinces, 8, async (province) => {
      if (now() - startedAll >= useBudget) return [];
      const code = province && province.code;
      if (!code) return [];
      const url = 'https://api.opet.com.tr/api/fuelprices/prices?ProvinceCode='
        + encodeURIComponent(code) + '&IncludeAllProducts=true';
      try {
        return await fetchJson(url, useLimit);
      } catch (err) {
        if (!provinceLogged) {
          provinceLogged = true;
          logMazotFailure(log, { phase: err.phase, code: err.codeName, ms: err.ms });
        }
        return [];
      }
    });
    return groups.flat();
  }

  function readSnapshotText(text) {
    if (!text) return null;
    try {
      const parsed = JSON.parse(text);
      return isVerifiedSnapshot(parsed) ? parsed : null;
    } catch (err) {
      return null;
    }
  }

  async function readPostgres() {
    if (typeof q !== 'function') return null;
    try {
      const r = await q('SELECT value FROM kv_store WHERE key = $1', [MAZOT_KV_KEY]);
      const raw = r && r.rows && r.rows[0] && r.rows[0].value;
      return readSnapshotText(raw);
    } catch (err) {
      log('[nakliye-mazot] sonuc=kayit-okunamadi kod=' + String((err && err.code) || 'db').replace(/[^\w]/g, '').slice(0, 12));
      return null;
    }
  }

  async function writePostgres(payload) {
    if (typeof q !== 'function' || !isVerifiedSnapshot(payload)) return;
    try {
      await q(
        `INSERT INTO kv_store(key, value) VALUES ($1, $2)
         ON CONFLICT(key) DO UPDATE SET value = EXCLUDED.value`,
        [MAZOT_KV_KEY, JSON.stringify(snapshotCore(payload))]
      );
    } catch (err) {
      log('[nakliye-mazot] sonuc=kayit-yazilamadi kod=' + String((err && err.code) || 'db').replace(/[^\w]/g, '').slice(0, 12));
    }
  }

  function readFileSnapshot() {
    if (typeof readText !== 'function') return null;
    try {
      return readSnapshotText(readText());
    } catch (err) {
      return null;
    }
  }

  function writeFileSnapshot(payload) {
    if (typeof writeText !== 'function' || !isVerifiedSnapshot(payload)) return;
    try {
      writeText(JSON.stringify(snapshotCore(payload)));
    } catch (err) {
      log('[nakliye-mazot] sonuc=dosya-yazilamadi kod=dosya');
    }
  }

  async function refreshFromOpet(limit) {
    const rows = await fetchOpetRows(limit);
    const payload = buildPayload(rows, new Date(now()).toISOString());
    if (!isVerifiedSnapshot(payload)) {
      const err = new Error('Mazot listesi boş');
      err.phase = 'govde';
      err.codeName = 'BOS';
      err.ms = 0;
      throw err;
    }
    payload.onceki = readOnceki();
    rememberYesterday(payload);
    const fresh = markFresh(payload);
    cache = { at: now(), payload: fresh };
    await writePostgres(fresh);
    writeFileSnapshot(fresh);
    return fresh;
  }

  async function fallback() {
    if (isVerifiedSnapshot(cache.payload)) return markStale(cache.payload, 'bellek');
    const fromDb = await readPostgres();
    if (fromDb) return markStale(fromDb, 'postgres');
    const fromFile = readFileSnapshot();
    if (fromFile) return markStale(fromFile, 'dosya');
    return null;
  }

  function getMazot(force) {
    const fresh = !force && isVerifiedSnapshot(cache.payload) && cache.payload.guncel === true && (now() - cache.at) < freshMs;
    if (fresh) return Promise.resolve(cache.payload);
    if (!force && failedAt && (now() - failedAt) < retryMs) {
      return fallback().then((stale) => stale || emptyMazot());
    }
    if (!job) {
      job = refreshFromOpet()
        .then((payload) => {
          failedAt = 0;
          return payload;
        })
        .catch(async (err) => {
          failedAt = now();
          const kind = err && err.phase ? { phase: err.phase, code: err.codeName, ms: err.ms } : classifyFetchError(err);
          if (!kind.ms && err && err.ms) kind.ms = err.ms;
          logMazotFailure(log, kind);
          const stale = await fallback();
          if (stale && deps && deps.slowRetry && (kind.phase === 'zaman-asimi' || kind.phase === 'baglanti' || kind.phase === 'dns')) {
            if (!slowJob) {
              slowJob = refreshFromOpet(15000)
                .then((payload) => {
                  failedAt = 0;
                  return payload;
                })
                .catch((slowErr) => {
                  const slowKind = slowErr && slowErr.phase
                    ? { phase: slowErr.phase, code: slowErr.codeName, ms: slowErr.ms }
                    : classifyFetchError(slowErr);
                  logMazotFailure(log, slowKind);
                })
                .finally(() => { slowJob = null; });
            }
          }
          if (stale) return stale;
          return emptyMazot();
        })
        .finally(() => {
          job = null;
        });
    }
    return job;
  }

  return { getMazot, classifyFetchError, isVerifiedSnapshot, emptyMazot, MAZOT_KV_KEY };
}

module.exports = {
  MAZOT_KV_KEY,
  DEFAULT_TIMEOUT_MS,
  classifyFetchError,
  logMazotFailure,
  isVerifiedSnapshot,
  markFresh,
  markStale,
  emptyMazot,
  ipv4Dispatcher,
  createMazotService,
};
