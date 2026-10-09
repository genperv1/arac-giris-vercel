'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const express = require('express');
const request = require('supertest');
const {
  HEADER,
  createOriginVerifyMiddleware,
  normalizeMode,
  secretIsValid,
  secretsMatch,
  isHealthProbe,
} = require('../lib/origin-verify');

const SECRET = 'a'.repeat(32);
const OTHER = 'b'.repeat(32);

function appWith(mode, secret, logs) {
  const app = express();
  app.use(createOriginVerifyMiddleware({
    mode,
    secret,
    log: (fmt, ...args) => logs.push(require('util').format(fmt, ...args)),
  }));
  app.get('/health', (req, res) => res.json({ ok: true, status: 'healthy' }));
  app.get('/api/health', (req, res) => res.json({ ok: true, status: 'healthy' }));
  app.get('/api/vehicles', (req, res) => res.json({ ok: true, flow: 'plaka' }));
  app.get('/api/events-stream', (req, res) => res.json({ ok: true, flow: 'sse' }));
  app.get('/api/reports-stream', (req, res) => res.json({ ok: true, flow: 'sse' }));
  app.get('/api/excel-agent/ping', (req, res) => res.json({ ok: true, flow: 'excel' }));
  app.get('/api/signatures/:id/image', (req, res) => res.json({ ok: true, flow: 'print' }));
  app.get('/GIRIS.html', (req, res) => res.type('html').send('<!doctype html><title>giris</title>'));
  app.post('/api/login', (req, res) => res.json({ ok: true, flow: 'kantar-amir' }));
  app.post('/health', (req, res) => res.json({ ok: true, flow: 'health-write' }));
  return app;
}

const FAKE_CF = {
  'cf-connecting-ip': '203.0.113.8',
  'cf-ray': 'abc123-IST',
  'cf-ipcountry': 'TR',
  'cf-visitor': '{"scheme":"https"}',
  'x-forwarded-for': '203.0.113.8',
  'true-client-ip': '203.0.113.8',
};

test('mod yalnız off, log ve enforce kabul eder', () => {
  assert.equal(normalizeMode('off'), 'off');
  assert.equal(normalizeMode('LOG'), 'log');
  assert.equal(normalizeMode(' enforce '), 'enforce');
  assert.equal(normalizeMode(''), 'off');
  assert.equal(normalizeMode('bypass'), 'off');
});

test('sır en az 32 bayt olmalı ve timingSafeEqual ile karşılaştırılır', () => {
  assert.equal(secretIsValid('a'.repeat(31)), false);
  assert.equal(secretIsValid(SECRET), true);
  assert.equal(secretsMatch(SECRET, SECRET), true);
  assert.equal(secretsMatch(SECRET, OTHER), false);
  assert.equal(secretsMatch(SECRET, SECRET + 'x'), false);
  assert.equal(secretsMatch('a'.repeat(31), 'a'.repeat(31)), false);
  assert.equal(isHealthProbe({ method: 'GET', originalUrl: '/health?x=1' }), true);
  assert.equal(isHealthProbe({ method: 'GET', originalUrl: '/api/health' }), false);
  assert.equal(isHealthProbe({ method: 'POST', originalUrl: '/health' }), false);
});

test('off modu başlıksız isteği ve sahte Cloudflare başlığını geçirir', async () => {
  const logs = [];
  const app = appWith('off', '', logs);
  await request(app).get('/api/vehicles').expect(200);
  await request(app).get('/GIRIS.html').set(FAKE_CF).expect(200);
  assert.equal(logs.length, 0);
});

test('log modu eksik veya yanlış sırrı engellemez ve sırrı yazmaz', async () => {
  const logs = [];
  const app = appWith('log', SECRET, logs);
  await request(app).get('/api/vehicles').set(FAKE_CF).expect(200);
  await request(app).get('/api/events-stream').set(HEADER, OTHER).expect(200);
  await request(app).get('/api/excel-agent/ping').set(HEADER, SECRET).expect(200);
  const text = logs.join('\n');
  assert.match(text, /result=missing/);
  assert.match(text, /result=mismatch/);
  assert.equal(text.includes(SECRET), false);
  assert.equal(text.includes(OTHER), false);
  assert.equal(text.includes('203.0.113.8'), false);
});

test('enforce modu eksik, yanlış ve sahte Cloudflare başlığını 403 yapar', async () => {
  const logs = [];
  const app = appWith('enforce', SECRET, logs);
  const missing = await request(app).get('/api/vehicles').set('Host', 'app.up.railway.app').set(FAKE_CF);
  assert.equal(missing.status, 403);
  assert.equal(missing.body.code, 'ORIGIN_VERIFY_FAILED');
  const wrong = await request(app).post('/api/login').set(HEADER, OTHER).set(FAKE_CF);
  assert.equal(wrong.status, 403);
  const short = await request(app).get('/api/signatures/sig_1/image').set(HEADER, 'a'.repeat(31));
  assert.equal(short.status, 403);
  await request(app).get('/api/vehicles').set(HEADER, SECRET).expect(200);
  await request(app).get('/api/events-stream').set(HEADER, SECRET).expect(200);
  await request(app).get('/api/reports-stream').set(HEADER, SECRET).expect(200);
  await request(app).get('/api/excel-agent/ping').set(HEADER, SECRET).expect(200);
  await request(app).get('/api/signatures/sig_1/image').set(HEADER, SECRET).expect(200);
  await request(app).get('/GIRIS.html').set(HEADER, SECRET).expect(200);
  await request(app).post('/api/login').set(HEADER, SECRET).expect(200);
  const text = logs.join('\n');
  assert.equal(text.includes(SECRET), false);
  assert.equal(text.includes(OTHER), false);
});

test('enforce sağlık probu Host ne olursa olsun yalnız /health yolunu geçirir', async () => {
  const logs = [];
  const app = appWith('enforce', SECRET, logs);
  await request(app).get('/health').set('Host', 'evil.example').expect(200);
  await request(app).get('/health').set('Host', 'app.up.railway.app').set(FAKE_CF).expect(200);
  const apiHealth = await request(app).get('/api/health').set('Host', 'app.up.railway.app').set(FAKE_CF);
  assert.equal(apiHealth.status, 403);
  const posted = await request(app).post('/health').set('Host', 'app.up.railway.app');
  assert.equal(posted.status, 403);
  const vehicles = await request(app).get('/api/vehicles').set('Host', 'healthcheck.railway.app');
  assert.equal(vehicles.status, 403);
});

test('kısa sır enforce modunda kabul edilmez ve günlüğe yazılmaz', async () => {
  const logs = [];
  const short = 'short-secret';
  const app = appWith('enforce', short, logs);
  const res = await request(app).get('/api/vehicles').set(HEADER, short);
  assert.equal(res.status, 403);
  assert.match(logs.join('\n'), /result=config/);
  assert.equal(logs.join('\n').includes(short), false);
  await request(app).get('/health').expect(200);
});

test('middleware statik dosya, API, SSE ve Excel ajanından önce kayıtlı', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const origin = src.indexOf('app.use(createOriginVerifyMiddleware');
  const stat = src.indexOf('express.static(');
  const sse = src.indexOf('registerSseRoutes(');
  const excel = src.indexOf('registerExcelAgentRoutes(');
  const api = src.indexOf('app.use("/api"');
  assert.ok(origin > 0);
  assert.ok(origin < stat);
  assert.ok(origin < sse);
  assert.ok(origin < excel);
  assert.ok(origin < api);
});
