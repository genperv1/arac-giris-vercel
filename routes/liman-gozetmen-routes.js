'use strict';

const {
  KV_KEY,
  prepareState,
  matchLogin,
  applyProfiles,
  amirView,
  ackNotice,
  isSelahattin,
} = require('../lib/liman-gozetmen');

const FAIL_WINDOW_MS = 10 * 60 * 1000;
const FAIL_MAX = 12;

function registerLimanGozetmenRoutes(api, ctx, publicApp) {
  const { q, requireAmir, requireValidSession } = ctx;
  const fails = new Map();
  let chain = Promise.resolve();

  function withLock(fn) {
    const run = chain.then(fn, fn);
    chain = run.then(() => undefined, () => undefined);
    return run;
  }

  function clientIp(req) {
    const forwarded = req && req.headers && req.headers['x-forwarded-for'];
    const raw = String(forwarded || (req && req.ip) || '').split(',')[0].trim();
    return raw || 'unknown';
  }

  function tooManyFails(ip) {
    const row = fails.get(ip);
    if (!row) return false;
    if (Date.now() - row.t > FAIL_WINDOW_MS) {
      fails.delete(ip);
      return false;
    }
    return row.n >= FAIL_MAX;
  }

  function noteFail(ip) {
    const now = Date.now();
    const row = fails.get(ip);
    if (!row || now - row.t > FAIL_WINDOW_MS) {
      fails.set(ip, { n: 1, t: now });
      return;
    }
    row.n += 1;
  }

  async function readRaw() {
    const result = await q('SELECT value FROM kv_store WHERE key = $1', [KV_KEY]);
    if (!result.rows[0]) return null;
    try {
      return JSON.parse(result.rows[0].value);
    } catch (e) {
      return null;
    }
  }

  async function writeState(state) {
    await q(
      `INSERT INTO kv_store(key, value)
       VALUES($1,$2)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [KV_KEY, JSON.stringify(state)]
    );
  }

  async function ensure() {
    return withLock(async () => {
      const now = Date.now();
      const prepared = prepareState(await readRaw(), now);
      if (prepared.changed) await writeState(prepared.state);
      return prepared.state;
    });
  }

  const reader = publicApp || api;
  const prefix = publicApp ? '/api' : '';

  reader.post(prefix + '/liman/gate', async (req, res) => {
    try {
      const ip = clientIp(req);
      if (tooManyFails(ip)) {
        return res.status(429).json({ ok: false, error: 'Çok fazla deneme. Biraz sonra tekrar deneyin.' });
      }
      const body = req.body || {};
      const username = body.username;
      const password = body.password;
      const state = await ensure();
      const hit = matchLogin(state, username, password);
      if (!hit) {
        noteFail(ip);
        return res.status(401).json({ ok: false, error: 'Hatalı kullanıcı adı veya şifre.' });
      }
      fails.delete(ip);
      res.setHeader('Cache-Control', 'no-store');
      return res.json({ ok: true, n: hit.n, label: hit.label, issuedAt: hit.issuedAt });
    } catch (err) {
      return res.status(500).json({ ok: false, error: 'Giriş şu an yapılamadı.' });
    }
  });

  api.get('/liman/gozetmen', requireAmir, async (req, res) => {
    try {
      const state = await ensure();
      res.setHeader('Cache-Control', 'no-store');
      return res.json(amirView(state, Date.now()));
    } catch (err) {
      return res.status(500).json({ ok: false, error: 'Liste alınamadı.' });
    }
  });

  api.put('/liman/gozetmen', requireAmir, async (req, res) => {
    try {
      const slots = req.body && req.body.slots;
      const state = await withLock(async () => {
        const now = Date.now();
        const prepared = prepareState(await readRaw(), now);
        applyProfiles(prepared.state, slots);
        await writeState(prepared.state);
        return prepared.state;
      });
      res.setHeader('Cache-Control', 'no-store');
      return res.json(amirView(state, Date.now()));
    } catch (err) {
      return res.status(500).json({ ok: false, error: 'Kaydedilemedi.' });
    }
  });

  api.post('/liman/gozetmen/ack', requireValidSession, async (req, res) => {
    try {
      if (!isSelahattin(req.user)) {
        return res.status(403).json({ ok: false, error: 'Bu bildirim yalnız Selahattin Toker ekranında kapanır.' });
      }
      const issuedAt = req.body && req.body.issuedAt;
      const state = await withLock(async () => {
        const now = Date.now();
        const prepared = prepareState(await readRaw(), now);
        const acked = ackNotice(prepared.state, issuedAt, now);
        if (prepared.changed || acked.changed) await writeState(acked.state);
        return acked.state;
      });
      res.setHeader('Cache-Control', 'no-store');
      return res.json(amirView(state, Date.now()));
    } catch (err) {
      return res.status(500).json({ ok: false, error: 'Bildirim kapatılamadı.' });
    }
  });

  if (publicApp) {
    const timer = setInterval(() => {
      ensure().catch(() => {});
    }, 60 * 60 * 1000);
    if (typeof timer.unref === 'function') timer.unref();
  }
}

module.exports = { registerLimanGozetmenRoutes };
