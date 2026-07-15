'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createClientSiteResolver, ipMatchesPattern } = require('../lib/client-site');

function normalizeClientIp(ip) {
  const s = String(ip || '').trim();
  if (s === '::1' || s === '::ffff:127.0.0.1') return '127.0.0.1';
  if (s.startsWith('::ffff:')) return s.slice(7);
  return s || 'unknown';
}

function isLoopbackIp(ip) {
  const n = normalizeClientIp(ip);
  return n === '127.0.0.1' || n === 'localhost';
}

test('ipMatchesPattern supports exact, prefix and CIDR', () => {
  assert.equal(ipMatchesPattern('192.168.1.25', '192.168.1.25'), true);
  assert.equal(ipMatchesPattern('192.168.1.25', '192.168.1.'), true);
  assert.equal(ipMatchesPattern('10.0.2.15', '192.168.1.'), false);
  assert.equal(ipMatchesPattern('10.0.2.15', '10.0.2.0/24'), true);
});

test('resolveClientSite maps configured IPs and falls back to EDITOR', () => {
  const tmp = path.join(os.tmpdir(), `client-sites-${Date.now()}.json`);
  fs.writeFileSync(tmp, JSON.stringify({
    sites: {
      AVDAN: ['192.168.10.5'],
      '1.OSB': ['10.20.30.40'],
    },
    editorIps: ['203.0.113.9'],
    editorOnUnknown: true,
  }));

  const { resolveClientSite } = createClientSiteResolver(tmp, normalizeClientIp, isLoopbackIp);

  assert.deepEqual(resolveClientSite('192.168.10.5', 'user'), { clientIp: '192.168.10.5', clientSite: 'AVDAN' });
  assert.deepEqual(resolveClientSite('10.20.30.40', 'user'), { clientIp: '10.20.30.40', clientSite: '1.OSB' });
  assert.deepEqual(resolveClientSite('203.0.113.9', 'user'), { clientIp: '203.0.113.9', clientSite: 'EDITOR' });
  assert.deepEqual(resolveClientSite('8.8.8.8', 'user'), { clientIp: '8.8.8.8', clientSite: 'EDITOR' });
  assert.deepEqual(resolveClientSite('127.0.0.1', 'admin'), { clientIp: '127.0.0.1', clientSite: 'EDITOR' });

  fs.unlinkSync(tmp);
});
