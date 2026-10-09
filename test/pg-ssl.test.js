'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pgSsl } = require('../lib/pg-ssl');

test('CA verilince sertifika doğrulanır', () => {
  const ssl = pgSsl({ NODE_ENV: 'production', PG_SSL_CA: '-----BEGIN CERTIFICATE-----\\nABC\\n-----END CERTIFICATE-----' });
  assert.equal(ssl.rejectUnauthorized, true);
  assert.match(ssl.ca, /BEGIN CERTIFICATE/);
  assert.doesNotMatch(ssl.ca, /\\n/);
});

test('CA yoksa bağlantı açık kalır, doğrulama kapalıdır', () => {
  const ssl = pgSsl({ NODE_ENV: 'production' });
  assert.equal(ssl.rejectUnauthorized, false);
  assert.equal(ssl.ca, undefined);
});

test('CA dosyası okunur', () => {
  const file = path.join(os.tmpdir(), 'pg-ssl-test-' + process.pid + '.crt');
  fs.writeFileSync(file, 'CERTDATA');
  try {
    const ssl = pgSsl({ NODE_ENV: 'production', PG_SSL_CA_FILE: file });
    assert.equal(ssl.rejectUnauthorized, true);
    assert.equal(ssl.ca, 'CERTDATA');
  } finally {
    fs.unlinkSync(file);
  }
});
