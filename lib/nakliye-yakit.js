'use strict';

/** Çekici + dorse planlama değerleri (L/100 km). Gerçek tüketim yüke ve yola göre değişir. */
const TIR_TUKETIM = {
  bos: 28,
  yuklu: 35,
  agir: 40,
};

const YOL_PAYI = 1.3;

const ILCE_ALIAS = {
  eyup: ['eyupsultan'],
  eyupsultan: ['eyup'],
  kazan: ['kahramankazan'],
  kahramankazan: ['kazan'],
};

function foldTr(value) {
  return String(value || '')
    .toLocaleLowerCase('tr-TR')
    .replace(/ı/g, 'i')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ş/g, 's')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c')
    .replace(/â/g, 'a')
    .replace(/î/g, 'i')
    .replace(/û/g, 'u')
    .replace(/[^a-z0-9]/g, '');
}

function samePlaceName(a, b) {
  const left = foldTr(a);
  const right = foldTr(b);
  if (!left || !right) return false;
  if (left === right) return true;
  return (ILCE_ALIAS[left] || []).includes(right);
}

function roundTo(value, digits) {
  const p = 10 ** digits;
  return Math.round((Number(value) + Number.EPSILON) * p) / p;
}

function median(values) {
  const nums = (values || []).map(Number).filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => a - b);
  if (!nums.length) return null;
  const mid = Math.floor(nums.length / 2);
  if (nums.length % 2) return roundTo(nums[mid], 2);
  return roundTo((nums[mid - 1] + nums[mid]) / 2, 2);
}

function pickMotorin(prices) {
  const list = Array.isArray(prices) ? prices : [];
  const ult = list.find((p) => p && p.productShortName === 'MT_ULT' && Number(p.amount) > 0);
  if (ult) return { mazot: roundTo(ult.amount, 2), urun: ult.productName || 'Motorin UltraForce' };
  const eco = list.find((p) => p && p.productShortName === 'MT_ECO' && Number(p.amount) > 0);
  if (eco) return { mazot: roundTo(eco.amount, 2), urun: eco.productName || 'Motorin EcoForce' };
  return null;
}

function matchOpetIl(name, iller) {
  const folded = foldTr(name).replace(/anadolu|avrupa/g, '');
  return (iller || []).find((il) => {
    const g = foldTr(il.ad);
    return g === folded || g.replace(/karahisar$/, '') === folded;
  }) || null;
}

function normalizeOpetRows(rows) {
  const out = [];
  for (const row of rows || []) {
    const motorin = pickMotorin(row && row.prices);
    const districtName = String((row && row.districtName) || '').trim();
    const provinceName = String((row && row.provinceName) || '').trim();
    if (!motorin || !districtName || !provinceName) continue;
    out.push({
      provinceName,
      districtName,
      mazot: motorin.mazot,
      urun: motorin.urun,
    });
  }
  return out;
}

function buildMazotPayload(rows, places, updatedAt) {
  const normalized = normalizeOpetRows(rows);
  const iller = (places && places.iller) || [];
  const ilceler = (places && places.ilceler) || [];
  const byPlaka = new Map();
  for (const row of normalized) {
    const il = matchOpetIl(row.provinceName, iller);
    if (!il) continue;
    if (!byPlaka.has(il.plaka)) byPlaka.set(il.plaka, []);
    byPlaka.get(il.plaka).push(row);
  }

  const ilceOut = [];
  const seen = new Set();
  const ilOut = [];
  for (const il of iller) {
    const group = byPlaka.get(il.plaka) || [];
    if (!group.length) continue;
    ilOut.push({
      plaka: il.plaka,
      ad: il.ad,
      mazot: median(group.map((row) => row.mazot)),
    });
    for (const row of group) {
      const hit = ilceler.find((d) => d.plaka === il.plaka && samePlaceName(d.ad, row.districtName));
      if (!hit) continue;
      const key = il.plaka + '|' + foldTr(hit.ad);
      if (seen.has(key)) continue;
      seen.add(key);
      ilceOut.push({ plaka: il.plaka, ad: hit.ad, mazot: row.mazot });
    }
  }

  return {
    ok: ilOut.length > 0,
    updatedAt: updatedAt || null,
    kaynak: 'OPET',
    urun: 'Motorin UltraForce',
    iller: ilOut,
    ilceler: ilceOut,
  };
}

function haversineKm(a, b) {
  const lat1 = Number(a && a.lat);
  const lon1 = Number(a && a.lon);
  const lat2 = Number(b && b.lat);
  const lon2 = Number(b && b.lon);
  if (![lat1, lon1, lat2, lon2].every(Number.isFinite)) return null;
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const s1 = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s1)));
}

function yolTahminiKm(a, b) {
  const straight = haversineKm(a, b);
  if (straight == null) return null;
  return roundTo(straight * YOL_PAYI, 1);
}

function turkiyeIcinde(lat, lon) {
  const la = Number(lat);
  const lo = Number(lon);
  return Number.isFinite(la) && Number.isFinite(lo) && lo >= 25 && lo <= 46.2 && la >= 35.2 && la <= 42.6;
}

function downsampleLine(coords, max) {
  const list = Array.isArray(coords) ? coords : [];
  const clean = list.filter((pt) => Array.isArray(pt) && Number.isFinite(Number(pt[0])) && Number.isFinite(Number(pt[1])));
  if (clean.length <= max) {
    return clean.map((pt) => [roundTo(pt[0], 4), roundTo(pt[1], 4)]);
  }
  const out = [];
  const step = (clean.length - 1) / (max - 1);
  for (let i = 0; i < max; i++) {
    const pt = clean[Math.round(i * step)];
    out.push([roundTo(pt[0], 4), roundTo(pt[1], 4)]);
  }
  return out;
}

function parseOsrmRoute(body) {
  const route = body && Array.isArray(body.routes) ? body.routes[0] : null;
  if (!route || !Number.isFinite(Number(route.distance))) return null;
  const coords = route.geometry && route.geometry.coordinates;
  return {
    km: roundTo(Number(route.distance) / 1000, 1),
    sureDk: Math.max(0, Math.round(Number(route.duration || 0) / 60)),
    cizgi: downsampleLine(coords, 240),
    kaynak: 'karayolu',
  };
}

function tahminiYakit(input) {
  const src = input || {};
  const tek = Math.max(0, Number(src.km) || 0);
  const donus = !!src.donus;
  const mesafeKm = roundTo(tek * (donus ? 2 : 1), 1);
  const litrePer100 = Math.max(0, Number(src.litrePer100) || 0);
  const fiyatTl = Math.max(0, Number(src.fiyatTl) || 0);
  const litre = roundTo(mesafeKm * litrePer100 / 100, 1);
  const tutarTl = roundTo(litre * fiyatTl, 2);
  return {
    mesafeKm,
    litre,
    tutarTl,
    litrePer100,
    fiyatTl,
    donus,
  };
}

module.exports = {
  TIR_TUKETIM,
  YOL_PAYI,
  foldTr,
  samePlaceName,
  median,
  pickMotorin,
  matchOpetIl,
  normalizeOpetRows,
  buildMazotPayload,
  haversineKm,
  yolTahminiKm,
  turkiyeIcinde,
  parseOsrmRoute,
  tahminiYakit,
};
