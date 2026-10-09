'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const rateLimit = require('express-rate-limit');
const request = require('supertest');
const {
  applyTrustProxy,
  isCloudflareIp,
  rateLimitKey,
  resolveClientIp,
  trustProxyHops,
} = require('../lib/client-ip');

const CF_EDGE = '104.16.1.20';
const VISITOR = '203.0.113.44';
const SPOOF = '198.51.100.9';

test('trust proxy sayısıdır, true değildir', () => {
  assert.equal(trustProxyHops(undefined), 1);
  assert.equal(trustProxyHops(''), 1);
  assert.equal(trustProxyHops('true'), 1);
  assert.equal(trustProxyHops('false'), 1);
  assert.equal(trustProxyHops('0'), 1);
  assert.equal(trustProxyHops('2'), 2);
  assert.equal(trustProxyHops('9'), 1);
  const app = express();
  assert.equal(applyTrustProxy(app, 'true'), 1);
  assert.notEqual(app.get('trust proxy'), true);
});

test('Cloudflare aralığı tanınır, rastgele adres tanınmaz', () => {
  assert.equal(isCloudflareIp(CF_EDGE), true);
  assert.equal(isCloudflareIp('172.64.0.1'), true);
  assert.equal(isCloudflareIp(VISITOR), false);
  assert.equal(isCloudflareIp('127.0.0.1'), false);
  assert.equal(isCloudflareIp('2606:4700:4700::1111'), true);
});

test('doğrudan istemci X-Forwarded-For ve CF-Connecting-IP ile adres çalamaz', () => {
  const ip = resolveClientIp({
    ip: '127.0.0.1',
    socket: { remoteAddress: '127.0.0.1' },
    headers: {
      'x-forwarded-for': SPOOF,
      'cf-connecting-ip': VISITOR,
    },
  });
  assert.equal(ip, '127.0.0.1');
});

test('Railway hopu Cloudflare ise CF-Connecting-IP, değilse hop adresi kullanılır', () => {
  const viaCf = resolveClientIp({
    ip: CF_EDGE,
    socket: { remoteAddress: '10.0.0.4' },
    headers: {
      'x-forwarded-for': `${SPOOF}, ${VISITOR}, ${CF_EDGE}`,
      'cf-connecting-ip': VISITOR,
    },
  });
  assert.equal(viaCf, VISITOR);

  const direct = resolveClientIp({
    ip: '203.0.113.8',
    socket: { remoteAddress: '10.0.0.4' },
    headers: {
      'x-forwarded-for': `${SPOOF}, 203.0.113.8`,
      'cf-connecting-ip': SPOOF,
    },
  });
  assert.equal(direct, '203.0.113.8');

  const junkCf = resolveClientIp({
    ip: CF_EDGE,
    headers: { 'cf-connecting-ip': 'not-an-ip, ' + SPOOF },
  });
  assert.equal(junkCf, CF_EDGE);
});

test('trust proxy 1 iken hız sınırı ValidationError vermez ve sahte sola bakmaz', async () => {
  const app = express();
  applyTrustProxy(app, '1');
  const errors = [];
  const orig = console.error;
  console.error = (...args) => {
    errors.push(args.map((item) => (item && item.stack) || String(item)).join(' '));
  };
  const hits = [];
  app.use(rateLimit({
    windowMs: 60 * 1000,
    max: 1,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
      const key = rateLimitKey(req);
      hits.push(key);
      return key;
    },
  }));
  app.get('/ping', (req, res) => res.json({ ip: req.ip, key: rateLimitKey(req) }));

  const first = await request(app)
    .get('/ping')
    .set('X-Forwarded-For', `${SPOOF}, ${VISITOR}`)
    .set('CF-Connecting-IP', SPOOF);
  const second = await request(app)
    .get('/ping')
    .set('X-Forwarded-For', `8.8.8.8, ${VISITOR}`)
    .set('CF-Connecting-IP', '8.8.8.8');
  const other = await request(app)
    .get('/ping')
    .set('X-Forwarded-For', '198.51.100.77');

  console.error = orig;

  assert.equal(first.status, 200);
  assert.equal(first.body.ip, VISITOR);
  assert.equal(first.body.key, VISITOR);
  assert.equal(second.status, 429);
  assert.equal(other.status, 200);
  assert.equal(other.body.ip, '198.51.100.77');
  assert.equal(hits.filter((key) => key === SPOOF || key === '8.8.8.8').length, 0);
  assert.equal(errors.some((line) => /ValidationError|ERR_ERL_/.test(line)), false);
});

test('varsayılan anahtar üretici X-Forwarded-For varken trust proxy 1 ile hata yazmaz', async () => {
  const app = express();
  applyTrustProxy(app, '1');
  const errors = [];
  const orig = console.error;
  console.error = (...args) => {
    errors.push(args.map((item) => (item && item.message) || String(item)).join(' '));
  };
  app.use(rateLimit({
    windowMs: 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
  }));
  app.get('/ping', (req, res) => res.json({ ip: req.ip }));
  const res = await request(app).get('/ping').set('X-Forwarded-For', VISITOR);
  console.error = orig;
  assert.equal(res.status, 200);
  assert.equal(res.body.ip, VISITOR);
  assert.equal(errors.some((line) => /ValidationError|ERR_ERL_/.test(line)), false);
});
