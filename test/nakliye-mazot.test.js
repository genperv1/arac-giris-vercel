'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  classifyFetchError,
  logMazotFailure,
  isVerifiedSnapshot,
  emptyMazot,
  createMazotService,
  MAZOT_KV_KEY,
  DEFAULT_TIMEOUT_MS,
} = require('../lib/nakliye-mazot');

const WHEN = '2026-10-09T06:24:31.327Z';

function snapshot(updatedAt) {
  return {
    ok: true,
    updatedAt: updatedAt || WHEN,
    kaynak: 'OPET',
    urun: 'Motorin UltraForce',
    iller: [{ plaka: 43, ad: 'Kütahya', mazot: 98.39 }],
    ilceler: [],
  };
}

function memoryDb() {
  const store = new Map();
  return {
    store,
    q: async (sql, params) => {
      if (String(sql).startsWith('SELECT')) {
        const value = store.get(params[0]);
        return { rows: value ? [{ value }] : [] };
      }
      store.set(params[0], params[1]);
      return { rows: [] };
    },
  };
}

function clientShowsPrices(status, data) {
  const resOk = status >= 200 && status < 300;
  const payloadOk = !!(data && data.ok !== false && data.iller && data.iller.length);
  return resOk && payloadOk;
}

test('bağlantı hatası aşama ve kod olarak ayrılır', () => {
  const timeout = new Error('The operation was aborted');
  timeout.name = 'TimeoutError';
  assert.equal(classifyFetchError(timeout).phase, 'zaman-asimi');
  const dns = new Error('getaddrinfo');
  dns.code = 'ENOTFOUND';
  assert.deepEqual(classifyFetchError(dns), { phase: 'dns', code: 'ENOTFOUND' });
  const tls = new Error('certificate');
  tls.code = 'CERT_HAS_EXPIRED';
  assert.equal(classifyFetchError(tls).phase, 'tls');
  const http = new Error('HTTP 503');
  http.phase = 'http';
  http.codeName = 'HTTP_503';
  assert.deepEqual(classifyFetchError(http), { phase: 'http', code: 'HTTP_503' });
});

test('hata günlüğü süre ve kod yazar, fiyat veya çerez yazmaz', () => {
  const lines = [];
  logMazotFailure((line) => lines.push(line), { phase: 'zaman-asimi', code: 'TimeoutError', ms: 4002 });
  const text = lines.join('\n');
  assert.match(text, /asama=zaman-asimi/);
  assert.match(text, /kod=TimeoutError/);
  assert.match(text, /sureMs=4002/);
  assert.match(text, /kaynak=OPET/);
  assert.equal(text.includes('98.39'), false);
  assert.equal(/cookie|password|secret|token/i.test(text), false);
});

test('doğrulanmamış kayıt yedek sayılmaz', () => {
  assert.equal(isVerifiedSnapshot({ ok: true, kaynak: 'OPET', iller: [] }), false);
  assert.equal(isVerifiedSnapshot({ ok: true, kaynak: 'DOSYA', updatedAt: WHEN, iller: [{ plaka: 1 }] }), false);
  assert.equal(isVerifiedSnapshot(snapshot()), true);
});

function failingFetch() {
  return async () => {
    const err = new Error('aborted');
    err.name = 'TimeoutError';
    throw err;
  };
}

test('Opet düşünce sıra bellek, postgres, dosyadır ve tarih korunur', async () => {
  const fileOnly = memoryDb();
  let file = JSON.stringify(snapshot('2026-10-08T06:00:00.000Z'));
  const fromFileSvc = createMazotService({
    q: fileOnly.q,
    readText: () => file,
    fetchImpl: failingFetch(),
    buildPayload: () => ({ ok: false, iller: [] }),
    log: () => {},
  });
  const fromFile = await fromFileSvc.getMazot(false);
  assert.equal(fromFile.kayit, 'dosya');
  assert.equal(fromFile.guncel, false);
  assert.equal(fromFile.bayat, true);
  assert.equal(fromFile.updatedAt, '2026-10-08T06:00:00.000Z');
  assert.equal(fromFile.kaynak, 'OPET');

  const db = memoryDb();
  db.store.set(MAZOT_KV_KEY, JSON.stringify(snapshot('2026-10-09T06:24:31.327Z')));
  const fromDb = await createMazotService({
    q: db.q,
    readText: () => file,
    fetchImpl: failingFetch(),
    buildPayload: () => ({ ok: false, iller: [] }),
    log: () => {},
  }).getMazot(false);
  assert.equal(fromDb.kayit, 'postgres');
  assert.equal(fromDb.guncel, false);
  assert.equal(fromDb.bayat, true);
  assert.equal(fromDb.updatedAt, '2026-10-09T06:24:31.327Z');
  assert.equal(clientShowsPrices(200, fromDb), true);

  let clock = 10_000;
  let live = true;
  let calls = 0;
  const memorySvc = createMazotService({
    now: () => clock,
    freshMs: 1000,
    retryMs: 5000,
    q: memoryDb().q,
    readText: () => JSON.stringify(snapshot('2026-10-01T00:00:00.000Z')),
    buildPayload: (rows, updatedAt) => snapshot(updatedAt),
    fetchImpl: async () => {
      calls += 1;
      if (!live) {
        const err = new Error('aborted');
        err.name = 'TimeoutError';
        throw err;
      }
      return { ok: true, json: async () => [{ code: '43' }] };
    },
    log: () => {},
  });
  const fresh = await memorySvc.getMazot(false);
  assert.equal(fresh.guncel, true);
  live = false;
  clock += 2000;
  const fromMemory = await memorySvc.getMazot(false);
  assert.equal(fromMemory.kayit, 'bellek');
  assert.equal(fromMemory.guncel, false);
  assert.equal(fromMemory.bayat, true);
  assert.equal(fromMemory.updatedAt, fresh.updatedAt);
  const callsAfterFail = calls;
  clock += 1000;
  const cooled = await memorySvc.getMazot(false);
  assert.equal(cooled.kayit, 'bellek');
  assert.equal(calls, callsAfterFail);
  clock += 6000;
  await memorySvc.getMazot(true);
  assert.equal(calls, callsAfterFail + 1);
});

test('başarılı OPET alımı önbelleği ve postgres kaydını günceller', async () => {
  const db = memoryDb();
  let file = '';
  const writes = [];
  let clock = 5_000;
  const svc = createMazotService({
    now: () => clock,
    q: db.q,
    readText: () => file,
    writeText: (text) => { file = text; writes.push('dosya'); },
    buildPayload: (rows, updatedAt) => snapshot(updatedAt),
    fetchImpl: async (url) => {
      if (String(url).includes('provinces')) {
        return { ok: true, json: async () => [{ code: '43' }] };
      }
      return { ok: true, json: async () => [{ amount: 1 }] };
    },
    log: () => {},
  });
  const fresh = await svc.getMazot(false);
  assert.equal(fresh.guncel, true);
  assert.equal(fresh.bayat, false);
  assert.equal(fresh.updatedAt, new Date(clock).toISOString());
  assert.equal(db.store.has(MAZOT_KV_KEY), true);
  const stored = JSON.parse(db.store.get(MAZOT_KV_KEY));
  assert.equal(stored.updatedAt, fresh.updatedAt);
  assert.equal(stored.kaynak, 'OPET');
  assert.equal(stored.guncel, undefined);
  assert.equal(writes.length, 1);

  clock += 10;
  const cached = await svc.getMazot(false);
  assert.equal(cached.updatedAt, fresh.updatedAt);
  assert.equal(writes.length, 1);
});

test('hiç kayıt yoksa 200 ve ok:false istemci fiyatı güncel sanmaz', async () => {
  const svc = createMazotService({
    fetchImpl: async () => {
      const err = new Error('fail');
      err.code = 'ENOTFOUND';
      throw err;
    },
    buildPayload: () => ({ ok: false, iller: [] }),
    log: () => {},
  });
  const none = await svc.getMazot(false);
  assert.equal(none.ok, false);
  assert.equal(none.guncel, false);
  assert.deepEqual(none.iller, []);
  assert.equal(clientShowsPrices(200, none), false);
  assert.equal(clientShowsPrices(502, snapshot()), false);
  const src = fs.readFileSync(path.join(__dirname, '../public/nakliye.js'), 'utf8');
  assert.match(src, /data\.ok !== false/);
  assert.match(src, /Son doğrulanmış fiyat/);
  assert.equal(src.includes('Güncel mazot fiyatı internetten alınamadı'), false);
});

test('zaman aşımı verilen süreyi aşmadan döner', async () => {
  const lines = [];
  const svc = createMazotService({
    timeoutMs: 40,
    fetchImpl: (url, opts) => new Promise((resolve, reject) => {
      const signal = opts && opts.signal;
      const fail = () => {
        const err = new Error('aborted');
        err.name = 'TimeoutError';
        reject(err);
      };
      if (signal && signal.aborted) return fail();
      if (signal) signal.addEventListener('abort', fail, { once: true });
    }),
    buildPayload: () => snapshot(),
    log: (line) => lines.push(line),
  });
  const started = Date.now();
  const none = await svc.getMazot(false);
  const waited = Date.now() - started;
  assert.equal(none.ok, false);
  assert.ok(waited < 1000, 'bekleme 1 saniyenin altında olmalı, ölçülen ' + waited);
  assert.match(lines.join('\n'), /asama=zaman-asimi/);
  assert.equal(DEFAULT_TIMEOUT_MS <= 4000, true);
});

test('yol kaydı 502 döndürmez', () => {
  const src = fs.readFileSync(path.join(__dirname, '../routes/nakliye-routes.js'), 'utf8');
  assert.match(src, /res\.status\(200\)\.json\(payload\)/);
  assert.equal(src.includes('status(502)'), false);
});
