'use strict';

const { createTtlCache } = require('./ttl-cache');

const TTL_MS = Number(process.env.VEHICLE_LIST_CACHE_MS || 30000);
const cache = createTtlCache({ defaultTtlMs: TTL_MS, maxEntries: 12 });

function cacheKey(limit, offset) {
  return `${Number(offset) || 0}:${Number(limit) || 0}`;
}

function invalidateVehicleListCache() {
  cache.clear();
}

function getVehicleListCache(limit, offset) {
  const hit = cache.get(cacheKey(limit, offset));
  return hit || null;
}

function setVehicleListCache(limit, offset, body, etag) {
  cache.set(cacheKey(limit, offset), { body, etag });
}

function etagFromFingerprint(fp, limit, offset) {
  return `W/"vh-${fp}-${limit}-${offset}"`;
}

async function fetchVehicleFingerprint(q) {
  const r = await q(
    `SELECT COUNT(*)::int AS c,
            COALESCE(MAX(sort_ts), 0)::text AS m,
            COALESCE(MAX(id), '') AS i
     FROM vehicles`
  );
  const row = r.rows[0] || {};
  return `${row.c || 0}:${row.m || '0'}:${row.i || ''}`;
}

function isVehicleWrite(text) {
  const u = String(text || '').trim().toUpperCase();
  if (!u || u.startsWith('SELECT') || u.startsWith('WITH') || u.startsWith('ANALYZE')) return false;
  return /(?:^|[\s(])VEHICLES(?:[\s();,]|$)/.test(u);
}

module.exports = {
  invalidateVehicleListCache,
  getVehicleListCache,
  setVehicleListCache,
  etagFromFingerprint,
  fetchVehicleFingerprint,
  isVehicleWrite,
};
