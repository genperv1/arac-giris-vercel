'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');
const request = require('supertest');
const { createAuthSessionMiddleware } = require('../lib/auth-session');
const { registerOzmalRoutes, canReadOzmalEntries } = require('../routes/ozmal-routes');

const SECRET = 'ozmal-test-secret';

function token(payload) {
  return jwt.sign(payload, SECRET, { expiresIn: '1h' });
}

function appWithStore() {
  const store = new Map();
  const q = async (sql, params) => {
    const key = params && params[0];
    if (String(sql).includes('SELECT')) {
      const value = store.get(key);
      return { rows: value ? [{ value }] : [] };
    }
    store.set(key, params[1]);
    return { rows: [], rowCount: 1 };
  };
  const { requireValidSession } = createAuthSessionMiddleware({
    jwtSecret: SECRET,
    authSessionHours: 6,
  });
  const app = express();
  app.use(express.json());
  const api = express.Router();
  registerOzmalRoutes(api, {
    q,
    sendApiError: (res, err, status) => res.status(status || 500).json({ ok: false, error: err.message }),
    requireSettingsAccess: (req, res) => res.status(403).json({ ok: false, error: 'Ayarlar parolası gerekli' }),
    requireValidSession,
  });
  app.use('/api', api);
  return app;
}

test('özmal okuma yalnız admin ve amir', () => {
  assert.equal(canReadOzmalEntries({ username: 'AVDAN', role: 'admin' }), true);
  assert.equal(canReadOzmalEntries({ username: 'xxr', role: 'amir' }), true);
  assert.equal(canReadOzmalEntries({ username: 'saban', role: 'user' }), true);
  assert.equal(canReadOzmalEntries({ username: 'sofor', role: 'driver' }), false);
  assert.equal(canReadOzmalEntries(null), false);
});

test('ozmal-entries oturumsuz 401, şoför rolü 403, ofis 200 ve şifre yok', async () => {
  const app = appWithStore();

  const missing = await request(app).get('/api/ozmal-entries');
  assert.equal(missing.status, 401);
  assert.equal(missing.body.code, 'SESSION_MISSING');

  const driver = await request(app)
    .get('/api/ozmal-entries')
    .set('Authorization', `Bearer ${token({ id: 'd', username: 'sofor', role: 'driver' })}`);
  assert.equal(driver.status, 403);
  assert.equal(driver.body.code, 'OZMAL_FORBIDDEN');

  const admin = await request(app)
    .get('/api/ozmal-entries')
    .set('Authorization', `Bearer ${token({ id: 'a', username: 'AVDAN', role: 'admin' })}`);
  assert.equal(admin.status, 200);
  assert.ok(Array.isArray(admin.body.entries));
  assert.ok(admin.body.entries.length > 0);
  const dumped = JSON.stringify(admin.body);
  assert.equal(dumped.includes('passwordHash'), false);
  assert.equal(dumped.includes('passwordPlain'), false);

  const amir = await request(app)
    .get('/api/ozmal-entries')
    .set('Authorization', `Bearer ${token({ id: 'x', username: 'xxr', role: 'amir' })}`);
  assert.equal(amir.status, 200);
  assert.ok(Array.isArray(amir.body.entries));
});
