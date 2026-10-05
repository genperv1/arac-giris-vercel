'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const { registerAuthRoutes, DEVICE_COOKIE_NAME, DEVICE_COOKIE_PATH } = require('../routes/auth-routes');
const { createDeviceTokenStore } = require('../lib/device-tokens');
const { createFakeDeviceDb } = require('./helpers/fake-device-db');

const SECRET = 'test-jwt-secret';
const USERS = {
  AVDAN: { id: 1, username: 'AVDAN', role: 'admin', password: 'a' },
  xxr: { id: 9, username: 'xxr', role: 'amir', password: 'x' },
};

function harness() {
  const db = createFakeDeviceDb();
  const deviceTokens = createDeviceTokenStore(db.q, { days: 90 });
  const routes = {};
  const api = {};
  ['get', 'post', 'delete', 'put'].forEach((m) => {
    api[m] = (p, ...h) => { routes[m + ' ' + p] = h; };
  });
  registerAuthRoutes(api, {
    auth: {
      authenticateUser: async (u, p) => {
        const row = USERS[u];
        if (!row || row.password !== p) return { ok: false };
        const user = { id: row.id, username: row.username, role: row.role };
        return { ok: true, user, token: jwt.sign(user, SECRET, { expiresIn: '6h' }) };
      },
      findUser: async (u) => {
        const row = USERS[u];
        return row ? { id: row.id, username: row.username, role: row.role } : null;
      },
    },
    loginEndpointLimiter: (q, s, n) => n(),
    normalizeClientIp: (ip) => ip,
    getClientIp: (req) => req.headers['x-forwarded-for'] || '0.0.0.0',
    resolveClientSite: (ip) => ({ clientIp: ip, clientSite: ip === '95.3.27.82' ? 'AVDAN' : '' }),
    ipRequestCount: new Map(),
    RATE_LIMIT_WINDOW_MS: 60000,
    FAILED_LOGIN_THRESHOLD: 10,
    banIp() {},
    AUTH_COOKIE_NAME: 'auth_token',
    AUTH_COOKIE_OPTIONS: { httpOnly: true, secure: false, sameSite: 'lax', path: '/' },
    JWT_SECRET: SECRET,
    AUTH_SESSION_EXPIRES: '6h',
    presence: null,
    deviceTokens,
    requireAmir: (req, res, next) => {
      if (req.user && req.user.role === 'amir') return next();
      return res.status(403).json({ ok: false, error: 'amir' });
    },
  });

  async function call(key, req) {
    const chain = routes[key];
    if (!chain) throw new Error('route yok: ' + key);
    let out; let status = 200; const cookies = {};
    const res = {
      json: (d) => { out = d; return d; },
      status(c) { status = c; return this; },
      setHeader() {},
      cookie: (name, value, opts) => { cookies[name] = { value, opts }; },
    };
    const r = Object.assign({ body: {}, params: {}, headers: {} }, req);
    for (let i = 0; i < chain.length; i++) {
      let next = false;
      await chain[i](r, res, () => { next = true; });
      if (!next) break;
    }
    return { out, status, cookies };
  }
  return { call, db, deviceTokens };
}

const cookieHeader = (pairs) => Object.keys(pairs).map((k) => k + '=' + encodeURIComponent(pairs[k])).join('; ');

test('kantar girişi cihaz çerezi verir; renew şifresiz yeni oturum üretir', async () => {
  const h = harness();
  const login = await h.call('post /login', { body: { username: 'AVDAN', password: 'a' }, headers: { 'x-forwarded-for': '95.3.27.82', 'user-agent': 'Chrome' } });
  assert.equal(login.status, 200);
  assert.equal(login.out.rememberedDevice, true);
  assert.ok(login.cookies.auth_token.value);
  const dev = login.cookies[DEVICE_COOKIE_NAME];
  assert.ok(dev && dev.value, 'kantar_device çerezi');
  assert.equal(dev.opts.httpOnly, true);
  assert.equal(dev.opts.path, DEVICE_COOKIE_PATH, 'cihaz çerezi yalnız /api/session yoluna gider');
  assert.ok(dev.opts.maxAge >= 89 * 24 * 60 * 60 * 1000);

  // Oturum çerezi yok (düşmüş) — yalnız cihaz çereziyle yenile
  const renew = await h.call('post /session/renew', { headers: { cookie: cookieHeader({ [DEVICE_COOKIE_NAME]: dev.value }), 'x-forwarded-for': '95.3.27.82' } });
  assert.equal(renew.status, 200);
  assert.equal(renew.out.renewed, true);
  assert.equal(renew.out.user.username, 'AVDAN');
  assert.equal(renew.out.clientSite, 'AVDAN');
  const payload = jwt.verify(renew.cookies.auth_token.value, SECRET);
  assert.equal(payload.username, 'AVDAN');
  assert.equal(payload.role, 'admin');
});

test('cihaz çerezi yoksa / geçersizse / iptal edildiyse renew 401 ve kod döner', async () => {
  const h = harness();
  const none = await h.call('post /session/renew', { headers: {} });
  assert.equal(none.status, 401);
  assert.equal(none.out.code, 'DEVICE_MISSING');

  const bad = await h.call('post /session/renew', { headers: { cookie: DEVICE_COOKIE_NAME + '=deadbeefdeadbeefdeadbeef.' + 'z'.repeat(43) } });
  assert.equal(bad.status, 401);
  assert.equal(bad.out.code, 'DEVICE_INVALID');
  assert.equal(bad.cookies[DEVICE_COOKIE_NAME].opts.maxAge, 0, 'geçersiz çerez silinir');

  const login = await h.call('post /login', { body: { username: 'AVDAN', password: 'a' }, headers: {} });
  const raw = login.cookies[DEVICE_COOKIE_NAME].value;
  // Amir Ayarlar'dan düşürür
  const amir = { username: 'xxr', role: 'amir' };
  const list = await h.call('get /session/devices', { user: amir, headers: {} });
  assert.equal(list.status, 200);
  assert.equal(list.out.devices.length, 1);
  assert.equal(list.out.devices[0].username, 'AVDAN');
  assert.equal(list.out.days, 90);
  const del = await h.call('delete /session/devices/:id', { user: amir, params: { id: list.out.devices[0].id }, headers: {} });
  assert.equal(del.status, 200);
  const after = await h.call('post /session/renew', { headers: { cookie: cookieHeader({ [DEVICE_COOKIE_NAME]: raw }) } });
  assert.equal(after.status, 401);
  assert.equal(after.out.code, 'DEVICE_INVALID');
  // Kantar hesabı cihaz listesini göremez
  const denied = await h.call('get /session/devices', { user: { username: 'AVDAN', role: 'admin' }, headers: {} });
  assert.equal(denied.status, 403);
});

test('amir girişinde cihaz çerezi verilmez; forget çerezi ve anahtarı düşürür', async () => {
  const h = harness();
  const amirLogin = await h.call('post /login', { body: { username: 'xxr', password: 'x' }, headers: {} });
  assert.equal(amirLogin.out.rememberedDevice, false);
  assert.equal(amirLogin.cookies[DEVICE_COOKIE_NAME], undefined);

  const login = await h.call('post /login', { body: { username: 'AVDAN', password: 'a' }, headers: {} });
  const raw = login.cookies[DEVICE_COOKIE_NAME].value;
  const forget = await h.call('post /session/forget', { headers: { cookie: cookieHeader({ [DEVICE_COOKIE_NAME]: raw }) } });
  assert.equal(forget.out.ok, true);
  assert.equal(forget.cookies[DEVICE_COOKIE_NAME].opts.maxAge, 0);
  const renew = await h.call('post /session/renew', { headers: { cookie: cookieHeader({ [DEVICE_COOKIE_NAME]: raw }) } });
  assert.equal(renew.status, 401);
});

test('DEVICE_BIND_IP=true iken farklı IP renew 401 verir', async () => {
  const prev = process.env.DEVICE_BIND_IP;
  process.env.DEVICE_BIND_IP = 'true';
  try {
    const h = harness();
    const login = await h.call('post /login', {
      body: { username: 'AVDAN', password: 'a' },
      headers: { 'x-forwarded-for': '95.3.27.82', 'user-agent': 'Chrome' },
    });
    const raw = login.cookies[DEVICE_COOKIE_NAME].value;
    const listed = await h.deviceTokens.list();
    await h.deviceTokens.touch(listed[0].id, { ip: '95.3.27.82' });
    const renew = await h.call('post /session/renew', {
      headers: { cookie: cookieHeader({ [DEVICE_COOKIE_NAME]: raw }), 'x-forwarded-for': '1.2.3.4' },
    });
    assert.equal(renew.status, 401);
    assert.equal(renew.out.code, 'DEVICE_IP_MISMATCH');
  } finally {
    if (prev === undefined) delete process.env.DEVICE_BIND_IP;
    else process.env.DEVICE_BIND_IP = prev;
  }
});

test('istemci: kantar hesabında hareketsizlik çıkışı yok; 401\'de cihazla yenileme; nabız ve oturum garantisi bağlı', () => {
  const read = (p) => fs.readFileSync(path.join(__dirname, '..', 'public', p), 'utf8');
  const auth = read('modules/app-auth.js');
  assert.match(auth, /timeSinceActivity > INACTIVITY_TIMEOUT_MS && inactivityLogoutEnabled\(\)/);
  assert.match(auth, /function inactivityLogoutEnabled\(\)[\s\S]*isAmirUser/);
  assert.match(auth, /renewSession\(\{ force: true \}\)[\s\S]*return validateToken\(true\)/);

  const sm = read('session-manager.js');
  assert.match(sm, /RENEW_ENDPOINT = '\/api\/session\/renew'/);
  assert.match(sm, /if \(await renewSession\(\)\) return true;/, 'checkSessionValidity 401\'de önce yeniler');
  assert.match(sm, /async function fetchWithSession/);
  assert.match(sm, /addEventListener\('visibilitychange'/);
  assert.match(sm, /addEventListener\('online'/);
  ['renewSession', 'ensureSession', 'fetchWithSession', 'showSessionBanner'].forEach((fn) => {
    assert.match(sm, new RegExp('^\\s+' + fn + ',', 'm'), fn + ' dışa açık');
  });

  const excel = read('modules/app-excel-ihracat.js');
  assert.match(excel, /doFetch\('\/api\/liman\/snapshot'/);
  assert.match(excel, /function sendLimanHeartbeat/);
  assert.match(excel, /'\/api\/liman\/heartbeat'/);

  const src = read('modules/ihracat-excel-source.js');
  assert.match(src, /async function autoRefreshTick\(\)[\s\S]*sm\.ensureSession\(\)[\s\S]*heartbeat\(true, read\)/);
  assert.match(src, /reason: _silentPermMissing \? 'permission' : 'not-found'/);
  assert.match(excel, /readOk: info && typeof info\.readOk === 'boolean'/);

  const giris = read('GIRIS.html');
  assert.match(giris, /session-manager\.js\?v=20261004-nudge4/);
  assert.match(giris, /app-auth\.js\?v=1\.0\.28-20261003-renew/);
  assert.match(giris, /app-excel-ihracat\.js\?v=1\.0\.65-20261005-pfk/);
  assert.match(giris, /ihracat-excel-source\.js\?v=1\.0\.32-20261005-ajan/);
  assert.match(read('liman.html'), /liman\.js\?v=20261005-liman50/);
  assert.match(read('ayarlar.html'), /ayarlar\.js\?v=20261003-cihazlar/);
  assert.match(read('ayarlar.html'), /id="section-cihazlar"/);
  assert.match(read('ayarlar.js'), /'\/api\/session\/devices'/);
});
