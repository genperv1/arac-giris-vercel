'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function createLocalStorage() {
  const map = new Map();
  return {
    getItem(key) {
      return map.has(String(key)) ? map.get(String(key)) : null;
    },
    setItem(key, value) {
      map.set(String(key), String(value));
    },
    removeItem(key) {
      map.delete(String(key));
    },
    key(i) {
      return Array.from(map.keys())[i] || null;
    },
    get length() {
      return map.size;
    },
    _map: map,
  };
}

function loadDailyStore(opts) {
  const code = fs.readFileSync(path.join(__dirname, '../public/dailyStore.js'), 'utf8');
  const localStorage = opts.localStorage || createLocalStorage();
  const kv = opts.kv || new Map();
  const kvGet = opts.kvGet || (async (key) => kv.get(String(key)));
  const sandbox = {
    console,
    clearTimeout,
    localStorage,
    window: {},
    CustomEvent: class CustomEvent {
      constructor(type) {
        this.type = type;
      }
    },
  };
  let skippedBoot = false;
  sandbox.setTimeout = (fn, delay, ...args) => {
    if (!skippedBoot && opts.deferBoot !== false && Number(delay) === 0) {
      skippedBoot = true;
      sandbox._bootFn = fn;
      return 0;
    }
    return setTimeout(fn, delay, ...args);
  };
  sandbox.window = sandbox;
  sandbox.window.IDBStore = {
    isAvailable: () => true,
    kvGet,
    kvSet: async (key, value) => {
      kv.set(String(key), value);
      return true;
    },
    kvDel: async (key) => {
      kv.delete(String(key));
      return true;
    },
  };
  sandbox.window.addEventListener = (type, fn) => {
    sandbox.window._listeners = sandbox.window._listeners || {};
    sandbox.window._listeners[type] = sandbox.window._listeners[type] || [];
    sandbox.window._listeners[type].push(fn);
  };
  sandbox.window.dispatchEvent = (ev) => {
    const list = (sandbox.window._listeners && sandbox.window._listeners[ev.type]) || [];
    list.forEach((fn) => fn(ev));
    return true;
  };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  return { DailyStore: sandbox.window.DailyStore, localStorage, kv, window: sandbox.window };
}

test('setAsync keeps localStorage when it fits so the list is instant on next boot', async () => {
  const { DailyStore, localStorage } = loadDailyStore({});
  const rows = [{ plaka: '34ABC123', fileName: 'YD.xlsx', blockKey: 'BLK_1' }];
  const ok = await DailyStore.setAsync(rows, { fileName: 'YD.xlsx' });
  assert.equal(ok, true);
  assert.equal(localStorage.getItem('daily_shipments_backend'), 'ls');
  const stored = JSON.parse(localStorage.getItem('daily_shipments_current') || '[]');
  assert.equal(stored.length, 1);
  assert.equal(stored[0].plaka, '34ABC123');
});

test('setAsync promotes IndexedDB when localStorage save fails', async () => {
  const localStorage = createLocalStorage();
  const origSet = localStorage.setItem.bind(localStorage);
  localStorage.setItem = (key, value) => {
    if (key === 'daily_shipments_current') throw new Error('quota');
    return origSet(key, value);
  };
  const { DailyStore, kv } = loadDailyStore({ localStorage });
  const rows = [{ plaka: '06XYZ99', fileName: 'big.xlsx' }];
  const ok = await DailyStore.setAsync(rows, { fileName: 'big.xlsx' });
  assert.equal(ok, true);
  assert.equal(localStorage.getItem('daily_shipments_backend'), 'idb');
  assert.equal(localStorage.getItem('daily_shipments_current'), null);
  assert.equal((kv.get('daily_shipments_current') || []).length, 1);
});

test('ensureReady hydrates from IndexedDB and notifies UI', async () => {
  const kv = new Map();
  kv.set('daily_shipments_current', [
    { plaka: '35AA111', fileName: 'YD.xlsx', blockKey: 'BLK_2' },
  ]);
  kv.set('daily_shipments_meta', { fileName: 'YD.xlsx' });
  const localStorage = createLocalStorage();
  localStorage.setItem('daily_shipments_backend', 'idb');
  const { DailyStore, window } = loadDailyStore({ localStorage, kv });
  let notified = 0;
  window.addEventListener('daily-store-ready', () => { notified += 1; });
  assert.equal(DailyStore.getRows().length, 0);
  await DailyStore.ensureReady();
  assert.equal(DailyStore.getRows().length, 1);
  assert.equal(DailyStore.getRows()[0].plaka, '35AA111');
  assert.ok(notified >= 1);
});

test('ensureReady reuses in-flight hydrate', async () => {
  const kv = new Map();
  let reads = 0;
  const kvGet = async (key) => {
    reads += 1;
    await new Promise((r) => setTimeout(r, 25));
    if (key === 'daily_shipments_current') return [{ plaka: '07BB222', fileName: 'a.xlsx' }];
    if (key === 'daily_shipments_meta') return { fileName: 'a.xlsx' };
    return undefined;
  };
  const localStorage = createLocalStorage();
  localStorage.setItem('daily_shipments_backend', 'idb');
  const { DailyStore } = loadDailyStore({ localStorage, kv, kvGet });
  const [a, b] = await Promise.all([DailyStore.ensureReady(), DailyStore.ensureReady()]);
  assert.equal(a, b);
  assert.equal(DailyStore.getRows().length, 1);
  assert.equal(reads, 2);
});
