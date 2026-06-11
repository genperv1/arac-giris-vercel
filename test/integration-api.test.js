'use strict';

try {
  require('dotenv').config();
} catch (e) {}

const test = require('node:test');
const assert = require('node:assert');

const hasDb = !!process.env.DATABASE_URL;

test(
  'GET /api/heartbeat',
  { skip: !hasDb },
  async () => {
    const request = require('supertest');
    const app = require('../server.js');
    const res = await request(app).get('/api/heartbeat').expect(200);
    assert.strictEqual(res.body.status, 'ok');
    assert.ok(typeof res.body.timestamp === 'number');
  }
);

test(
  'GET /api/health',
  { skip: !hasDb },
  async () => {
    const request = require('supertest');
    const app = require('../server.js');
    const res = await request(app).get('/api/health');
    assert.ok(res.status === 200 || res.status === 503);
    assert.ok(typeof res.body === 'object');
  }
);
