'use strict';

const fs = require('fs');
const path = require('path');
const {
  buildMazotPayload,
  parseOsrmRoute,
  turkiyeIcinde,
  yolTahminiKm,
} = require('../lib/nakliye-yakit');

const PLACES_PATH = path.join(__dirname, '..', 'public', 'data', 'tr-ilceler.json');
const MAZOT_FILE = path.join(__dirname, '..', 'public', 'data', 'mazot-guncel.json');
const MAZOT_TTL_MS = 6 * 60 * 60 * 1000;
const MAZOT_STALE_MS = 7 * 24 * 60 * 60 * 1000;
const OPET_PROVINCES = 'https://api.opet.com.tr/api/fuelprices/provinces';

let placesCache = null;
let mazotCache = { at: 0, payload: null };
let mazotJob = null;
const mesafeCache = new Map();

function loadPlaces() {
  if (placesCache) return placesCache;
  placesCache = require(PLACES_PATH);
  return placesCache;
}

function requireSaban(ctx) {
  return function sabanOnly(req, res, next) {
    if (typeof ctx.requireAmir !== 'function') {
      return res.status(403).json({ ok: false, error: 'Amir oturumu gerekli.' });
    }
    ctx.requireAmir(req, res, () => {
      const username = String((req.user && req.user.username) || '').trim().toLowerCase();
      if (username === 'saban') return next();
      return res.status(403).json({ ok: false, error: 'Bu sayfa Şaban Lahaçlar hesabına açıktır.' });
    });
  };
}

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'gpm-nakliye/1.0' },
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

async function mapPool(items, limit, fn) {
  const out = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const idx = cursor++;
      out[idx] = await fn(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return out;
}

async function fetchOpetRows() {
  const provinces = await fetchJson(OPET_PROVINCES);
  const groups = await mapPool(provinces, 8, async (province) => {
    const code = province && province.code;
    if (!code) return [];
    const url = 'https://api.opet.com.tr/api/fuelprices/prices?ProvinceCode=' + encodeURIComponent(code) + '&IncludeAllProducts=true';
    try {
      return await fetchJson(url);
    } catch (err) {
      return [];
    }
  });
  return groups.flat();
}

async function refreshMazot() {
  const rows = await fetchOpetRows();
  const payload = buildMazotPayload(rows, loadPlaces(), new Date().toISOString());
  if (!payload.ok) throw new Error('Mazot listesi boş');
  mazotCache = { at: Date.now(), payload };
  try { fs.writeFileSync(MAZOT_FILE, JSON.stringify(payload)); } catch (err) { /* dosya yazılamazsa bellek önbelleği yeter */ }
  return payload;
}

function getMazot(force) {
  const fresh = mazotCache.payload && (Date.now() - mazotCache.at) < MAZOT_TTL_MS;
  if (!force && fresh) return Promise.resolve(mazotCache.payload);
  if (!mazotJob) {
    mazotJob = refreshMazot()
      .catch((err) => {
        console.error('Nakliye mazot:', err && err.message ? err.message : err);
        if (mazotCache.payload && (Date.now() - mazotCache.at) < MAZOT_STALE_MS) {
          return Object.assign({}, mazotCache.payload, { bayat: true });
        }
        throw err;
      })
      .finally(() => {
        mazotJob = null;
      });
  }
  return mazotJob;
}

function coord(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 1000) / 1000 : null;
}

async function drivingRoute(from, to) {
  const key = [from.lon, from.lat, to.lon, to.lat].join(',');
  const hit = mesafeCache.get(key);
  if (hit && (Date.now() - hit.at) < MAZOT_TTL_MS) return hit.route;
  const url = 'https://router.project-osrm.org/route/v1/driving/'
    + from.lon + ',' + from.lat + ';' + to.lon + ',' + to.lat
    + '?overview=full&geometries=geojson';
  const body = await fetchJson(url);
  const route = parseOsrmRoute(body);
  if (!route) throw new Error('Rota yok');
  mesafeCache.set(key, { at: Date.now(), route });
  if (mesafeCache.size > 300) {
    const oldest = mesafeCache.keys().next().value;
    mesafeCache.delete(oldest);
  }
  return route;
}

function registerNakliyeRoutes(api, ctx, app) {
  const sabanOnly = requireSaban(ctx || {});

  async function sendMazot(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const force = req.query.yenile === '1';
      const payload = await getMazot(force);
      res.json(payload);
    } catch (err) {
      console.error('Nakliye mazot yanıtı:', err && err.message ? err.message : err);
      res.status(502).json({ ok: false, error: 'Güncel mazot fiyatı internetten alınamadı.' });
    }
  }

  if (app && typeof app.get === 'function') app.get('/api/nakliye/mazot', sendMazot);
  api.get('/nakliye/mazot', sabanOnly, sendMazot);

  api.get('/nakliye/mesafe', sabanOnly, async (req, res) => {
    res.setHeader('Cache-Control', 'private, max-age=3600');
    const from = { lat: coord(req.query.olat), lon: coord(req.query.olon) };
    const to = { lat: coord(req.query.dlat), lon: coord(req.query.dlon) };
    if (!turkiyeIcinde(from.lat, from.lon) || !turkiyeIcinde(to.lat, to.lon)) {
      return res.status(400).json({ ok: false, error: 'Koordinat Türkiye içinde olmalı.' });
    }
    try {
      const route = await drivingRoute(from, to);
      res.json({ ok: true, ...route });
    } catch (err) {
      const km = yolTahminiKm(from, to);
      res.json({
        ok: true,
        km,
        sureDk: null,
        cizgi: [[from.lon, from.lat], [to.lon, to.lat]],
        kaynak: 'kus-ucusu',
      });
    }
  });
}

module.exports = { registerNakliyeRoutes };
