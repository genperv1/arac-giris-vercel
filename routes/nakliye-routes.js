'use strict';

const fs = require('fs');
const path = require('path');
const cron = require('node-cron');
const {
  buildMazotPayload,
  turkiyeIcinde,
  yolTahminiKm,
  parseOsrmRoutes,
  yanNokta,
} = require('../lib/nakliye-yakit');
const { createMazotService, emptyMazot, classifyFetchError, logMazotFailure, ipv4Dispatcher } = require('../lib/nakliye-mazot');

const PLACES_PATH = path.join(__dirname, '..', 'public', 'data', 'tr-ilceler.json');
const MAZOT_FILE = path.join(__dirname, '..', 'public', 'data', 'mazot-guncel.json');
const MAZOT_DUN_FILE = path.join(__dirname, '..', 'public', 'data', 'mazot-dun.json');
let placesCache = null;
const mesafeCache = new Map();
const ROUTE_TTL_MS = 6 * 60 * 60 * 1000;

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

function coord(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 1000) / 1000 : null;
}

function routeUrl(points) {
  return 'https://router.project-osrm.org/route/v1/driving/'
    + points.map((p) => p.lon + ',' + p.lat).join(';')
    + '?overview=full&geometries=geojson&alternatives=true';
}

function benzerYol(a, b) {
  if (!a || !b || !a.km || !b.km) return false;
  return Math.abs(a.km - b.km) / a.km < 0.04;
}

async function fetchRoutes(points) {
  const body = await fetchJson(routeUrl(points));
  return parseOsrmRoutes(body);
}

async function drivingRoute(from, to) {
  const key = [from.lon, from.lat, to.lon, to.lat].join(',');
  const hit = mesafeCache.get(key);
  if (hit && (Date.now() - hit.at) < ROUTE_TTL_MS) return hit.route;
  let yollar = await fetchRoutes([from, to]);
  if (!yollar.length) throw new Error('Rota yok');
  if (yollar.length < 2 && yollar[0].km > 80) {
    const sides = [55, -55];
    for (let s = 0; s < sides.length; s++) {
      const via = yanNokta(yollar[0].cizgi, sides[s]);
      if (!via || !turkiyeIcinde(via.lat, via.lon)) continue;
      try {
        const extra = await fetchRoutes([from, via, to]);
        const alt = extra[0];
        if (!alt || alt.km > yollar[0].km * 1.55) continue;
        if (yollar.some((row) => benzerYol(row, alt))) continue;
        yollar.push(alt);
      } catch (err) { /* bu yan koridor yoksa diğerine bak */ }
      if (yollar.length >= 3) break;
    }
  }
  const route = Object.assign({ ok: true, yollar: yollar }, yollar[0]);
  mesafeCache.set(key, { at: Date.now(), route });
  if (mesafeCache.size > 300) {
    const oldest = mesafeCache.keys().next().value;
    mesafeCache.delete(oldest);
  }
  return route;
}

function registerNakliyeRoutes(api, ctx, app) {
  const sabanOnly = requireSaban(ctx || {});
  const mazot = createMazotService({
    fetchImpl: (url, opts) => fetch(url, opts),
    dispatcher: ipv4Dispatcher(),
    slowRetry: true,
    q: ctx && ctx.q,
    buildPayload: (rows, updatedAt) => buildMazotPayload(rows, loadPlaces(), updatedAt),
    readText: () => {
      try { return fs.readFileSync(MAZOT_FILE, 'utf8'); } catch (err) { return ''; }
    },
    writeText: (text) => fs.writeFileSync(MAZOT_FILE, text),
    readOnceki: () => {
      try { return fs.readFileSync(MAZOT_DUN_FILE, 'utf8'); } catch (err) { return ''; }
    },
    writeOnceki: (text) => fs.writeFileSync(MAZOT_DUN_FILE, text),
  });

  if (process.env.MAZOT_CRON !== '0') {
    try {
      cron.schedule('20 8,13,18 * * *', () => {
        mazot.getMazot(true).catch(() => {});
      }, { timezone: 'Europe/Istanbul' });
    } catch (err) { /* istek yolu zamanlayıcı olmadan da çalışır */ }
  }

  async function sendMazot(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const force = String((req.query && req.query.yenile) || '') === '1';
      const payload = await mazot.getMazot(force);
      res.status(200).json(payload);
    } catch (err) {
      const kind = classifyFetchError(err);
      logMazotFailure(console.error, kind);
      res.status(200).json(emptyMazot());
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
