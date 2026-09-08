'use strict';

const { createTtlCache } = require('./ttl-cache');

const PRINT_FORM_BG_KEY = 'print_form_bg_v1';
const KV_TTL_MS = Number(process.env.KV_CACHE_TTL_MS || 120000);
const MISSING = Symbol('kv-missing');

const cache = createTtlCache({ defaultTtlMs: KV_TTL_MS, maxEntries: 80 });

function normalizeSql(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function isKvSelect(text) {
  return /^SELECT value FROM kv_store WHERE key = \$1$/i.test(normalizeSql(text));
}

function isKvDelete(text) {
  return /^DELETE FROM kv_store WHERE key = \$1$/i.test(normalizeSql(text));
}

function isKvUpsert(text) {
  return /INSERT INTO kv_store/i.test(String(text || ''));
}

function isBlockedKvKey(key) {
  return String(key || '') === PRINT_FORM_BG_KEY;
}

function getCachedKvValue(key) {
  const hit = cache.get(String(key));
  if (hit === undefined) return undefined;
  return hit === MISSING ? null : hit;
}

function setCachedKvValue(key, value) {
  cache.set(String(key), value == null ? MISSING : value);
}

function invalidateKvKey(key) {
  cache.del(String(key));
}

function clearKvCache() {
  cache.clear();
}

module.exports = {
  PRINT_FORM_BG_KEY,
  isKvSelect,
  isKvDelete,
  isKvUpsert,
  isBlockedKvKey,
  getCachedKvValue,
  setCachedKvValue,
  invalidateKvKey,
  clearKvCache,
};
