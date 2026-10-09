'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isConnectionDrop,
  isRetryableDbError,
  isReadOnlyQuery,
  retryQuery,
} = require('../lib/pg-retry');

test('kopan bağlantı yeniden denenebilir, sözdizimi hatası denenmez', () => {
  const dropped = new Error('Connection terminated unexpectedly');
  dropped.code = '57P01';
  assert.equal(isConnectionDrop(dropped), true);
  assert.equal(isRetryableDbError(dropped), true);
  const syntax = new Error('syntax');
  syntax.code = '42601';
  assert.equal(isConnectionDrop(syntax), false);
  assert.equal(isRetryableDbError(syntax), false);
  const serial = new Error('could not serialize');
  serial.code = '40001';
  assert.equal(isRetryableDbError(serial), true);
  assert.equal(isConnectionDrop(serial), false);
});

test('yazma sorgusu yalnız bağlantı kopunca bir kez daha gider', async () => {
  let calls = 0;
  const logs = [];
  const err = new Error('Connection terminated unexpectedly');
  err.code = '08006';
  const result = await retryQuery(() => {
    calls += 1;
    if (calls === 1) throw err;
    return Promise.resolve({ ok: true });
  }, 2, 1, {
    allow: (e) => isConnectionDrop(e),
    sleep: async () => {},
    warn: (attempt, max, delay, code) => logs.push(code),
  });
  assert.equal(result.ok, true);
  assert.equal(calls, 2);
  assert.deepEqual(logs, ['08006']);
  assert.equal(JSON.stringify(logs).includes('password'), false);

  let writes = 0;
  await assert.rejects(() => retryQuery(() => {
    writes += 1;
    const bad = new Error('duplicate');
    bad.code = '23505';
    throw bad;
  }, 2, 1, {
    allow: (e) => isConnectionDrop(e),
    sleep: async () => {},
  }));
  assert.equal(writes, 1);
});

test('okuma sorgusu geçici hatadan sonra döner', async () => {
  assert.equal(isReadOnlyQuery('  select 1'), true);
  assert.equal(isReadOnlyQuery('INSERT INTO users(password_hash) VALUES ($1)'), false);
  let calls = 0;
  const value = await retryQuery(() => {
    calls += 1;
    if (calls < 3) {
      const err = new Error('timeout');
      err.code = 'ETIMEDOUT';
      throw err;
    }
    return Promise.resolve('up');
  }, 3, 1, { sleep: async () => {} });
  assert.equal(value, 'up');
  assert.equal(calls, 3);
});
