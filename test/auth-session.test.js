'use strict';

const test = require('node:test');
const assert = require('node:assert');
const jwt = require('jsonwebtoken');
const { createAuthSessionMiddleware } = require('../lib/auth-session');

const SECRET = 'test-secret-key';
const { requireValidSession, requireAdmin } = createAuthSessionMiddleware({
  jwtSecret: SECRET,
  authSessionHours: 6,
});

function mockRes() {
  const res = {
    statusCode: 200,
    headers: {},
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
    setHeader(k, v) { this.headers[k] = v; },
  };
  return res;
}

test('requireValidSession rejects missing token', () => {
  const req = { headers: {} };
  const res = mockRes();
  let nextCalled = false;
  requireValidSession(req, res, () => { nextCalled = true; });
  assert.strictEqual(nextCalled, false);
  assert.strictEqual(res.statusCode, 401);
  assert.strictEqual(res.body.code, 'SESSION_MISSING');
});

test('requireValidSession accepts valid JWT', () => {
  const token = jwt.sign({ id: '1', username: 'GENPER', role: 'admin' }, SECRET, { expiresIn: '1h' });
  const req = { headers: { authorization: `Bearer ${token}` } };
  const res = mockRes();
  let nextCalled = false;
  requireValidSession(req, res, () => { nextCalled = true; });
  assert.strictEqual(nextCalled, true);
  assert.strictEqual(req.user.username, 'GENPER');
});

test('requireAdmin rejects non-admin', () => {
  const token = jwt.sign({ id: '2', username: 'op', role: 'operator' }, SECRET, { expiresIn: '1h' });
  const req = { headers: { authorization: `Bearer ${token}` } };
  const res = mockRes();
  let nextCalled = false;
  requireAdmin(req, res, () => { nextCalled = true; });
  assert.strictEqual(nextCalled, false);
  assert.strictEqual(res.statusCode, 403);
});
