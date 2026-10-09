'use strict';

/** İlk açılıştan 2 dk sonra başlar, sonra 3 sn arayla. Saat veritabanındadır; süreç yeniden kalksa da aynı dizi sürer. */

const ONCE_KEY = 'selahattin_scare_once_v3';
const TARGET = 'xxr';
const FIRST_DELAY_MS = 2 * 60 * 1000;
const INTERVAL_MS = 3 * 1000;

const PLAN = [
  ['88.241.46.17', 248],
  ['78.189.112.64', 253],
  ['95.70.201.33', 261],
  ['176.40.18.209', 239],
  ['85.105.77.14', 274],
  ['212.174.58.91', 256],
  ['88.255.14.203', 244],
  ['78.180.96.41', 267],
  ['95.9.144.72', 251],
  ['176.88.23.155', 286],
  ['81.213.44.19', 233],
  ['212.156.70.228', 262],
  ['88.230.61.104', 247],
  ['78.191.8.53', 279],
  ['95.14.220.36', 255],
  ['185.86.41.127', 241],
  ['176.219.54.80', 271],
  ['85.98.33.146', 258],
];

function usernameKey(value) {
  return String(value || '').trim().toLowerCase().slice(0, 80);
}

function clientKey(value) {
  const id = String(value || '').trim().toLowerCase();
  if (!/^[a-z0-9_-]{8,32}$/.test(id)) return '';
  return id;
}

function ackStorageKey(username, clientId) {
  const user = usernameKey(username);
  if (user !== TARGET) return '';
  const client = clientKey(clientId);
  return client ? user + '|' + client : user;
}

function noticeId(index) {
  return 'scare-nv-' + String(index + 1).padStart(2, '0');
}

function dueCount(startedAt, now) {
  const start = Number(startedAt);
  const ts = Number(now);
  if (!Number.isFinite(start) || !Number.isFinite(ts)) return 0;
  if (ts < start + FIRST_DELAY_MS) return 0;
  const n = Math.floor((ts - start - FIRST_DELAY_MS) / INTERVAL_MS) + 1;
  return Math.max(0, Math.min(PLAN.length, n));
}

function publicNotice(index, startedAt) {
  const row = PLAN[index];
  const ip = row[0];
  const attempts = row[1];
  const firma = 'NOVATEK — IP ' + ip + ' — giriş denemesi ' + attempts + ' — sistem tarafından engellendi';
  return {
    id: noticeId(index),
    kind: 'scare',
    plate: ip,
    firma,
    malzeme: '',
    ts: Number(startedAt) + FIRST_DELAY_MS + index * INTERVAL_MS,
    text: firma,
  };
}

function normalizeState(raw) {
  const startedAt = Number(raw && raw.startedAt);
  if (!Number.isFinite(startedAt) || startedAt <= 0) return null;
  const acked = raw.acked && typeof raw.acked === 'object' ? raw.acked : {};
  return { startedAt, acked };
}

function unreadFromState(state, username, clientId, now) {
  const key = ackStorageKey(username, clientId);
  const clean = normalizeState(state);
  if (!key || !clean) return [];
  const n = dueCount(clean.startedAt, now);
  const out = [];
  for (let i = 0; i < n; i++) {
    const id = noticeId(i);
    const marks = clean.acked[id];
    if (marks && marks[key]) continue;
    out.push(publicNotice(i, clean.startedAt));
  }
  return out;
}

function createScareStore(q) {
  let chain = Promise.resolve();

  function withLock(fn) {
    const run = chain.then(fn, fn);
    chain = run.then(() => undefined, () => undefined);
    return run;
  }

  async function read() {
    const r = await q('SELECT value FROM kv_store WHERE key = $1', [ONCE_KEY]);
    if (!r || !r.rows || !r.rows[0]) return null;
    try {
      return normalizeState(JSON.parse(r.rows[0].value));
    } catch (e) {
      return null;
    }
  }

  async function write(state) {
    await q(
      `INSERT INTO kv_store(key, value)
       VALUES($1,$2)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [ONCE_KEY, JSON.stringify(state)]
    );
  }

  async function ensureStarted(now) {
    return withLock(async () => {
      const existing = await read();
      if (existing) return existing;
      const state = { startedAt: Number(now) || Date.now(), acked: {} };
      await q(
        `INSERT INTO kv_store(key, value)
         VALUES($1,$2)
         ON CONFLICT (key) DO NOTHING`,
        [ONCE_KEY, JSON.stringify(state)]
      );
      return (await read()) || state;
    });
  }

  async function unread(username, clientId, now) {
    const state = await read();
    return unreadFromState(state, username, clientId, now);
  }

  async function ack(id, username, clientId, now) {
    const key = ackStorageKey(username, clientId);
    const wanted = String(id || '').trim();
    if (!key || !/^scare-nv-\d{2}$/.test(wanted)) return false;
    return withLock(async () => {
      const state = await read();
      if (!state) return false;
      const index = PLAN.findIndex((_, i) => noticeId(i) === wanted);
      if (index < 0 || index >= dueCount(state.startedAt, now)) return false;
      if (!state.acked[wanted] || typeof state.acked[wanted] !== 'object') state.acked[wanted] = {};
      state.acked[wanted][key] = Number(now) || Date.now();
      await write(state);
      return true;
    });
  }

  return { read, ensureStarted, unread, ack };
}

const stores = new WeakMap();

function storeFor(q) {
  if (!q || typeof q !== 'function') throw new Error('scare store query missing');
  let store = stores.get(q);
  if (!store) {
    store = createScareStore(q);
    stores.set(q, store);
  }
  return store;
}

async function ensureScareStarted(q, now) {
  return storeFor(q).ensureStarted(now);
}

async function unreadScareNotices(q, username, clientId, now) {
  return storeFor(q).unread(username, clientId, now);
}

async function ackScareNotice(q, id, username, clientId, now) {
  return storeFor(q).ack(id, username, clientId, now);
}

function watchScareNotices(q, onEmit) {
  let last = -1;
  let ticking = false;
  const tick = async () => {
    if (ticking) return;
    ticking = true;
    try {
      const state = await storeFor(q).read();
      if (!state) return;
      const n = dueCount(state.startedAt, Date.now());
      for (let i = last + 1; i < n; i++) {
        if (typeof onEmit === 'function') onEmit(publicNotice(i, state.startedAt));
      }
      if (n > 0) last = n - 1;
    } catch (e) { /* sonraki tur */ }
    finally { ticking = false; }
  };
  tick();
  const timer = setInterval(tick, 1000);
  if (typeof timer.unref === 'function') timer.unref();
  return function stop() { clearInterval(timer); };
}

module.exports = {
  FIRST_DELAY_MS,
  INTERVAL_MS,
  dueCount,
  unreadFromState,
  ensureScareStarted,
  unreadScareNotices,
  ackScareNotice,
  watchScareNotices,
};
