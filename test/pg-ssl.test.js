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

test('üretimde CA yoksa bağlantı açılmaz', () => {
  assert.throws(() => pgSsl({ NODE_ENV: 'production' }), /PG_SSL_CA/);
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
