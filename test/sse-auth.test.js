'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { registerSseRoutes, requireSseSession } = require('../lib/sse');

function mockRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
    writeHead() {},
    write() {},
    setHeader() {},
    flushHeaders() {},
    on() {},
  };
}

test('SSE oturumsuz 401, geçerli çerezle geçer', () => {
  const secret = 'sse-test-secret';
  const guard = requireSseSession(secret);
  const denied = mockRes();
  let next = false;
  guard({ headers: {} }, denied, () => { next = true; });
  assert.equal(next, false);
  assert.equal(denied.statusCode, 401);
  assert.equal(denied.body.code, 'SESSION_MISSING');

  const token = jwt.sign({ username: 'AVDAN', role: 'admin' }, secret, { expiresIn: '1h' });
  const ok = mockRes();
  next = false;
  const req = { headers: { cookie: 'auth_token=' + token } };
  guard(req, ok, () => { next = true; });
  assert.equal(next, true);
  assert.equal(req.user.username, 'AVDAN');
});

test('events-stream ve reports-stream guard ile bağlanır; heartbeat açık kalır', () => {
  const routes = {};
  const app = {
    get(path, ...handlers) { routes[path] = handlers; },
  };
  registerSseRoutes(app, { jwtSecret: 'sse-test-secret' });
  assert.equal(routes['/api/events-stream'].length, 2);
  assert.equal(routes['/api/reports-stream'].length, 2);
  assert.equal(routes['/api/heartbeat'].length, 1);
});
