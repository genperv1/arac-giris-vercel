'use strict';

const jwt = require('jsonwebtoken');
const {
  KV_KEY,
  GATE_COOKIE,
  GATE_PURPOSE,
  GATE_MAX_AGE_MS,
  prepareState,
  matchLogin,
  recordLogin,
  applyProfiles,
  applyCredentials,
  amirView,
  ackNotice,
  isSelahattin,
  isLimanAdminUsername,
} = require('../lib/liman-gozetmen');

const MANAGE_PURPOSE = 'liman-gozetmen-admin';

const FAIL_WINDOW_MS = 10 * 60 * 1000;
const FAIL_MAX = 12;

function signManageToken(ctx) {
  return jwt.sign({ purpose: MANAGE_PURPOSE, username: 'xxr' }, ctx.JWT_SECRET, { expiresIn: '2h' });
}

function gateCookieOptions(ctx) {
  const base = ctx.AUTH_COOKIE_OPTIONS || {};
  return {
    httpOnly: true,
    secure: base.secure != null ? !!base.secure : process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: GATE_MAX_AGE_MS,
  };
}

function writeGateCookie(res, token, options, clear) {
  const parts = [
    GATE_COOKIE + '=' + (clear ? '' : encodeURIComponent(token)),
    'HttpOnly',
    'Path=/',
    'Max-Age=' + (clear ? '0' : String(Math.floor(options.maxAge / 1000))),
    'SameSite=Lax',
  ];
  if (options.secure) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

function signGateToken(ctx, payload) {
  return jwt.sign(Object.assign({ purpose: GATE_PURPOSE }, payload), ctx.JWT_SECRET, { expiresIn: '12h' });
}

function readManageToken(ctx, req) {
  const header = String((req && req.headers && (req.headers.authorization || req.headers.Authorization)) || '');
  const token = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
  if (!token || !ctx.JWT_SECRET) return null;
  try {
    const decoded = jwt.verify(token, ctx.JWT_SECRET);
    if (!decoded || decoded.purpose !== MANAGE_PURPOSE || String(decoded.username || '').toLowerCase() !== 'xxr') return null;
    return decoded;
  } catch (e) {
    return null;
  }
}

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
      if (isLimanAdminUsername(username)) {
        const okAdmin = typeof ctx.verifyLimanAdmin === 'function'
          ? await ctx.verifyLimanAdmin(username, password)
          : false;
        if (!okAdmin) {
          noteFail(ip);
          return res.status(401).json({ ok: false, error: 'Hatalı kullanıcı adı veya şifre.' });
        }
        fails.delete(ip);
        if (!ctx.JWT_SECRET) {
          return res.status(500).json({ ok: false, error: 'Giriş şu an yapılamadı.' });
        }
        res.setHeader('Cache-Control', 'no-store');
        writeGateCookie(res, signGateToken(ctx, { grup: 'admin', n: 0, loginId: 'xxr' }), gateCookieOptions(ctx), false);
        return res.json({ ok: true, manage: true, token: signManageToken(ctx) });
      }
      const hit = await withLock(async () => {
        const now = Date.now();
        const prepared = prepareState(await readRaw(), now);
        const found = matchLogin(prepared.state, username, password);
        if (!found) {
          if (prepared.changed) await writeState(prepared.state);
          return null;
        }
        recordLogin(prepared.state, found, now);
        await writeState(prepared.state);
        return found;
      });
      if (!hit) {
        noteFail(ip);
        return res.status(401).json({ ok: false, error: 'Hatalı kullanıcı adı veya şifre.' });
      }
      fails.delete(ip);
      if (!ctx.JWT_SECRET) {
        return res.status(500).json({ ok: false, error: 'Giriş şu an yapılamadı.' });
      }
      res.setHeader('Cache-Control', 'no-store');
      writeGateCookie(res, signGateToken(ctx, { grup: hit.grup, n: hit.n, loginId: hit.loginId }), gateCookieOptions(ctx), false);
      return res.json({ ok: true, n: hit.n, grup: hit.grup, label: hit.label, issuedAt: hit.issuedAt });
    } catch (err) {
      return res.status(500).json({ ok: false, error: 'Giriş şu an yapılamadı.' });
    }
  });

  reader.post(prefix + '/liman/gate/logout', (req, res) => {
    writeGateCookie(res, '', gateCookieOptions(ctx), true);
    res.setHeader('Cache-Control', 'no-store');
    return res.json({ ok: true });
  });

  api.get('/liman/gozetmen', requireAmir, async (req, res) => {
    try {
      const state = await ensure();
      res.setHeader('Cache-Control', 'no-store');
      const view = amirView(state, Date.now());
      view.canEditCredentials = isSelahattin(req.user);
      return res.json(view);
    } catch (err) {
      return res.status(500).json({ ok: false, error: 'Liste alınamadı.' });
    }
  });

  api.put('/liman/gozetmen', requireAmir, async (req, res) => {
    try {
      const slots = req.body && req.body.slots;
      const editor = isSelahattin(req.user);
      const state = await withLock(async () => {
        const now = Date.now();
        const prepared = prepareState(await readRaw(), now);
        applyProfiles(prepared.state, slots);
        if (editor) {
          const applied = applyCredentials(prepared.state, slots, now);
          if (applied.error) {
            if (prepared.changed) await writeState(prepared.state);
            const err = new Error(applied.error);
            err.status = 400;
            throw err;
          }
        }
        await writeState(prepared.state);
        return prepared.state;
      });
      res.setHeader('Cache-Control', 'no-store');
      const view = amirView(state, Date.now());
      view.canEditCredentials = editor;
      return res.json(view);
    } catch (err) {
      const status = err && err.status === 400 ? 400 : 500;
      return res.status(status).json({
        ok: false,
        error: status === 400 ? err.message : 'Kaydedilemedi.',
      });
    }
  });

  reader.get(prefix + '/liman/gozetmen/tanim', async (req, res) => {
    if (!readManageToken(ctx, req)) {
      return res.status(401).json({ ok: false, error: 'Oturum kapandı. Tekrar girin.' });
    }
    try {
      const state = await ensure();
      res.setHeader('Cache-Control', 'no-store');
      return res.json(amirView(state, Date.now()));
    } catch (err) {
      return res.status(500).json({ ok: false, error: 'Liste alınamadı.' });
    }
  });

  reader.put(prefix + '/liman/gozetmen/tanim', async (req, res) => {
    if (!readManageToken(ctx, req)) {
      return res.status(401).json({ ok: false, error: 'Oturum kapandı. Tekrar girin.' });
    }
    try {
      const slots = req.body && req.body.slots;
      const state = await withLock(async () => {
        const now = Date.now();
        const prepared = prepareState(await readRaw(), now);
        const applied = applyCredentials(prepared.state, slots, now);
        if (applied.error) {
          if (prepared.changed) await writeState(prepared.state);
          const err = new Error(applied.error);
          err.status = 400;
          throw err;
        }
        await writeState(applied.state);
        return applied.state;
      });
      res.setHeader('Cache-Control', 'no-store');
      return res.json(amirView(state, Date.now()));
    } catch (err) {
      const status = err && err.status === 400 ? 400 : 500;
      return res.status(status).json({
        ok: false,
        error: status === 400 ? err.message : 'Kaydedilemedi.',
      });
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
