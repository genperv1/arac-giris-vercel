'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { createTtlCache } = require('../lib/ttl-cache');
const {
  isKvSelect,
  isBlockedKvKey,
  getCachedKvValue,
  setCachedKvValue,
  invalidateKvKey,
  clearKvCache,
  PRINT_FORM_BG_KEY,
} = require('../lib/kv-cache');
const { etagFromFingerprint, isVehicleWrite, invalidateVehicleListCache, setVehicleListCache, getVehicleListCache } = require('../lib/vehicle-list-cache');

test('ttl cache expires and evicts', () => {
  const cache = createTtlCache({ defaultTtlMs: 20, maxEntries: 2 });
  cache.set('a', 1);
  assert.strictEqual(cache.get('a'), 1);
  cache.set('b', 2);
  cache.set('c', 3);
  assert.ok(cache.get('a') === undefined || cache.get('c') === 3);
});

test('kv cache helpers', () => {
  clearKvCache();
  assert.strictEqual(isBlockedKvKey(PRINT_FORM_BG_KEY), true);
  assert.strictEqual(isKvSelect('SELECT value FROM kv_store WHERE key = $1'), true);
  setCachedKvValue('piyasa_state_v1', '{"ok":1}');
  assert.strictEqual(getCachedKvValue('piyasa_state_v1'), '{"ok":1}');
  invalidateKvKey('piyasa_state_v1');
  assert.strictEqual(getCachedKvValue('piyasa_state_v1'), undefined);
  clearKvCache();
});

test('vehicle list cache etag and writes', () => {
  invalidateVehicleListCache();
  const etag = etagFromFingerprint('3:100:abc', 20000, 0);
  assert.match(etag, /vh-3:100:abc-20000-0/);
  setVehicleListCache(20000, 0, [{ id: '1' }], etag);
  const hit = getVehicleListCache(20000, 0);
  assert.strictEqual(hit.etag, etag);
  assert.strictEqual(hit.body[0].id, '1');
  assert.strictEqual(isVehicleWrite('UPDATE vehicles SET data = $1'), true);
  assert.strictEqual(isVehicleWrite('INSERT INTO vehicles(id, data) VALUES($1,$2)'), true);
  assert.strictEqual(isVehicleWrite('SELECT * FROM vehicles'), false);
  invalidateVehicleListCache();
  assert.strictEqual(getVehicleListCache(20000, 0), null);
});
