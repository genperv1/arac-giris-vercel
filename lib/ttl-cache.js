'use strict';

function createTtlCache({ defaultTtlMs = 60_000, maxEntries = 200 } = {}) {
  const store = new Map();

  function prune() {
    const now = Date.now();
    for (const [key, hit] of store) {
      if (!hit || hit.expiresAt <= now) store.delete(key);
    }
    if (store.size <= maxEntries) return;
    const extra = store.size - maxEntries;
    let removed = 0;
    for (const key of store.keys()) {
      store.delete(key);
      removed += 1;
      if (removed >= extra) break;
    }
  }

  function get(key) {
    const hit = store.get(key);
    if (!hit) return undefined;
    if (hit.expiresAt <= Date.now()) {
      store.delete(key);
      return undefined;
    }
    return hit.value;
  }

  function set(key, value, ttlMs = defaultTtlMs) {
    const ttl = Number.isFinite(ttlMs) && ttlMs > 0 ? ttlMs : defaultTtlMs;
    store.set(key, { value, expiresAt: Date.now() + ttl });
    if (store.size > maxEntries) prune();
  }

  function del(key) {
    store.delete(key);
  }

  function clear() {
    store.clear();
  }

  function has(key) {
    return get(key) !== undefined;
  }

  return { get, set, del, clear, has, prune };
}

module.exports = { createTtlCache };
