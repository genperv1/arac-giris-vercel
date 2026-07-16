'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadStorage(fetchImpl) {
  const code = fs.readFileSync(path.join(__dirname, '..', 'public', 'storage.js'), 'utf8');
  const fetchFn = fetchImpl || (async () => ({
    ok: true,
    status: 200,
    json: async () => [{ id: '1', cekiciPlaka: '34ABC1234', soforAdi: 'ALI', soforSoyadi: 'VELI' }]
  }));
  const sandbox = vm.createContext({
    console,
    setTimeout,
    clearTimeout,
    fetch: (...args) => fetchFn(...args),
    localStorage: {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {}
    }
  });
  sandbox.window = sandbox;
  vm.runInContext(code, sandbox);
  return sandbox.storage;
}

test('storage boot: _loaded false so first login triggers server fetch', () => {
  const storage = loadStorage();
  assert.strictEqual(storage._loaded, false);
  assert.strictEqual(storage._cache.length, 0);
  assert.strictEqual(storage.loadAll().length, 0);
});

test('storage invalidate resets cache for fresh login', () => {
  const storage = loadStorage();
  storage._cache = [{ id: 'x' }];
  storage._loaded = true;
  storage.invalidate();
  assert.strictEqual(storage._loaded, false);
  assert.strictEqual(storage._cache.length, 0);
});

test('storage _readAll sets _loaded on success', async () => {
  const storage = loadStorage();
  const rows = await storage._readAll();
  assert.strictEqual(storage._loaded, true);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].soforAdi, 'ALI');
});

test('storage _readAll keeps _loaded false on 401', async () => {
  const storage = loadStorage(async () => ({ ok: false, status: 401, json: async () => ({}) }));
  const rows = await storage._readAll();
  assert.strictEqual(storage._loaded, false);
  assert.strictEqual(rows.length, 0);
});

test('storage _readAll deduplicates concurrent requests', async () => {
  let calls = 0;
  const storage = loadStorage(async () => {
    calls += 1;
    await new Promise((r) => setTimeout(r, 20));
    return { ok: true, status: 200, json: async () => [] };
  });
  const [a, b] = await Promise.all([storage._readAll(), storage._readAll()]);
  assert.strictEqual(calls, 1);
  assert.strictEqual(a, b);
  assert.strictEqual(storage._loaded, true);
});
