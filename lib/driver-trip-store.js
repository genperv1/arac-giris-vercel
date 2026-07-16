'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROUTE_POINTS_KEY = 'driver_route_points_v1';
const IC_ROUTE_KEY = 'driver_ic_route_v1';
const UPLOAD_ROOT = path.join(__dirname, '..', 'uploads', 'driver-trips');

const DEFAULT_IC_ROUTE = { from: 'AVDAN', to: '1.OSB' };

const DEFAULT_ROUTE_POINTS = [
  'M.SAHASI',
  'AVDAN',
  '1.OSB',
  '2.OSB',
  'KÖRFEZ',
  'GEMLİK',
  'GEBZE',
  'ŞİLE',
  'İŞLE',
  'AYAZAĞA',
  'DERİNCE',
  'İNEGÖL',
  'PAZARLAR',
  'KOCAELİ',
  'ADANA',
  'KONYA',
  'KÜTAHYA',
  'BURSA',
  'BOZÜYÜK',
  'ESKİŞEHİR',
  'GEDİZ',
  'ALTINTAŞ',
  'ALAYUNT',
  'ÇAPHANE',
  'ÇİĞİL',
  'GÜRAL',
];

function ensureUploadDir(tripId) {
  const dir = path.join(UPLOAD_ROOT, String(tripId || 'temp'));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function normRoutePoint(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toUpperCase()
    .replace(/İ/g, 'I');
}

function sanitizeRoutePoints(raw) {
  const out = [];
  const seen = new Set();
  (Array.isArray(raw) ? raw : []).forEach((item) => {
    const label = String(item || '').trim();
    const key = normRoutePoint(label);
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(label);
  });
  return out.sort((a, b) => a.localeCompare(b, 'tr'));
}

async function loadRoutePoints(q) {
  try {
    const r = await q('SELECT value FROM kv_store WHERE key = $1', [ROUTE_POINTS_KEY]);
    const raw = r.rows && r.rows[0] && r.rows[0].value;
    if (raw) {
      return sanitizeRoutePoints(JSON.parse(raw));
    }
  } catch (e) { /* ignore */ }
  const seeded = sanitizeRoutePoints(DEFAULT_ROUTE_POINTS);
  try {
    await q(
      `INSERT INTO kv_store(key, value) VALUES ($1, $2)
       ON CONFLICT(key) DO UPDATE SET value = EXCLUDED.value`,
      [ROUTE_POINTS_KEY, JSON.stringify(seeded)]
    );
  } catch (e) { /* ignore */ }
  return seeded;
}

async function saveRoutePoints(q, rawPoints) {
  const points = sanitizeRoutePoints(rawPoints);
  await q(
    `INSERT INTO kv_store(key, value) VALUES ($1, $2)
     ON CONFLICT(key) DO UPDATE SET value = EXCLUDED.value`,
    [ROUTE_POINTS_KEY, JSON.stringify(points)]
  );
  return points;
}

async function loadIcRoute(q) {
  try {
    const r = await q('SELECT value FROM kv_store WHERE key = $1', [IC_ROUTE_KEY]);
    const raw = r.rows && r.rows[0] && r.rows[0].value;
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        from: String(parsed.from || DEFAULT_IC_ROUTE.from).trim() || DEFAULT_IC_ROUTE.from,
        to: String(parsed.to || DEFAULT_IC_ROUTE.to).trim() || DEFAULT_IC_ROUTE.to,
      };
    }
  } catch (e) { /* ignore */ }
  return { ...DEFAULT_IC_ROUTE };
}

async function saveIcRoute(q, raw) {
  const route = {
    from: String(raw?.from || DEFAULT_IC_ROUTE.from).trim() || DEFAULT_IC_ROUTE.from,
    to: String(raw?.to || DEFAULT_IC_ROUTE.to).trim() || DEFAULT_IC_ROUTE.to,
  };
  await q(
    `INSERT INTO kv_store(key, value) VALUES ($1, $2)
     ON CONFLICT(key) DO UPDATE SET value = EXCLUDED.value`,
    [IC_ROUTE_KEY, JSON.stringify(route)]
  );
  return route;
}

function startOfWeek(date) {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function weekKey(date) {
  const s = startOfWeek(date);
  return s ? s.toISOString().slice(0, 10) : '';
}

function buildIcWeeklySummary(trips, { plakaFilter } = {}) {
  const now = new Date();
  const currentWeek = weekKey(now);
  const icTrips = (trips || []).filter((t) => (t.tripType || 'normal') === 'ic');
  const filtered = plakaFilter
    ? icTrips.filter((t) => t.plaka === plakaFilter)
    : icTrips;

  const byPlate = new Map();
  filtered.forEach((trip) => {
    const key = trip.plaka || '—';
    if (!byPlate.has(key)) {
      byPlate.set(key, { plaka: key, totalTrips: 0, totalKm: 0, weekTrips: 0, weekKm: 0, drivers: new Set() });
    }
    const row = byPlate.get(key);
    const km = Number(trip.km) || 0;
    row.totalTrips += 1;
    row.totalKm += km;
    if (trip.driverName) row.drivers.add(trip.driverName);
    const tk = weekKey(trip.gidisTarihi || trip.createdAt);
    if (tk === currentWeek) {
      row.weekTrips += 1;
      row.weekKm += km;
    }
  });

  return {
    weekStart: currentWeek,
    weekLabel: currentWeek ? new Date(currentWeek).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long' }) : '',
    plates: Array.from(byPlate.values()).map((row) => ({
      plaka: row.plaka,
      weekTrips: row.weekTrips,
      weekKm: row.weekKm,
      totalTrips: row.totalTrips,
      totalKm: row.totalKm,
      drivers: Array.from(row.drivers),
    })).sort((a, b) => String(a.plaka).localeCompare(String(b.plaka), 'tr')),
    totals: {
      weekTrips: filtered.filter((t) => weekKey(t.gidisTarihi || t.createdAt) === currentWeek).length,
      weekKm: filtered.filter((t) => weekKey(t.gidisTarihi || t.createdAt) === currentWeek)
        .reduce((a, t) => a + (Number(t.km) || 0), 0),
    },
  };
}

function parseNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(String(value).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function parseDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function calcKm(gidisKm, donusKm) {
  const g = parseNumber(gidisKm);
  const d = parseNumber(donusKm);
  if (g === null || d === null) return null;
  const km = d - g;
  return km >= 0 ? km : null;
}

function calcYakitPct(mazotLt, km) {
  const m = parseNumber(mazotLt);
  const k = parseNumber(km);
  if (m === null || k === null || k <= 0) return null;
  return Math.round((m / k) * 10000) / 10000;
}

function rowToTrip(row) {
  if (!row) return null;
  return {
    id: row.id,
    plaka: row.plaka,
    driverName: row.driver_name,
    tripType: row.trip_type || 'normal',
    gidisTarihi: row.gidis_tarihi,
    donusTarihi: row.donus_tarihi,
    yuklemeYeri: row.yukleme_yeri,
    bosaltmaLiman: row.bosaltma_liman,
    donusYukleme: row.donus_yukleme,
    donusBosaltma: row.donus_bosaltma,
    bosDondu: !!row.bos_dondu,
    aracGidisKm: row.arac_gidis_km,
    aracDonusKm: row.arac_donus_km,
    km: row.km,
    mazotLt: row.mazot_lt,
    adblueLt: row.adblue_lt,
    yakitYuzde: row.yakit_yuzde,
    aciklama: row.aciklama || '',
    photoGidisIrsaliye: row.photo_gidis_irsaliye,
    photoGidisKantar: row.photo_gidis_kantar,
    photoDonusIrsaliye: row.photo_donus_irsaliye,
    photoDonusKantar: row.photo_donus_kantar,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizeTripPayload(body, existing) {
  const bosDondu = !!(body.bosDondu ?? body.bos_dondu ?? existing?.bosDondu);
  const aracGidisKm = parseNumber(body.aracGidisKm ?? body.arac_gidis_km ?? existing?.aracGidisKm);
  const aracDonusKm = parseNumber(body.aracDonusKm ?? body.arac_donus_km ?? existing?.aracDonusKm);
  const mazotLt = parseNumber(body.mazotLt ?? body.mazot_lt ?? existing?.mazotLt);
  const km = calcKm(aracGidisKm, aracDonusKm);
  const yakitYuzde = calcYakitPct(mazotLt, km);

  return {
    gidisTarihi: parseDate(body.gidisTarihi ?? body.gidis_tarihi ?? existing?.gidisTarihi),
    donusTarihi: parseDate(body.donusTarihi ?? body.donus_tarihi ?? existing?.donusTarihi),
    yuklemeYeri: String(body.yuklemeYeri ?? body.yukleme_yeri ?? existing?.yuklemeYeri ?? '').trim(),
    bosaltmaLiman: String(body.bosaltmaLiman ?? body.bosaltma_liman ?? existing?.bosaltmaLiman ?? '').trim(),
    donusYukleme: bosDondu ? '' : String(body.donusYukleme ?? body.donus_yukleme ?? existing?.donusYukleme ?? '').trim(),
    donusBosaltma: bosDondu ? '' : String(body.donusBosaltma ?? body.donus_bosaltma ?? existing?.donusBosaltma ?? '').trim(),
    bosDondu,
    aracGidisKm,
    aracDonusKm,
    km,
    mazotLt,
    adblueLt: parseNumber(body.adblueLt ?? body.adblue_lt ?? existing?.adblueLt),
    yakitYuzde,
    aciklama: String(body.aciklama ?? existing?.aciklama ?? '').trim(),
  };
}

function validateTripPayload(payload, photos, isUpdate) {
  const errors = [];
  if (!payload.yuklemeYeri) errors.push('Gidiş yükleme yeri gerekli');
  if (!payload.bosaltmaLiman) errors.push('Gidiş boşaltma limanı gerekli');
  if (payload.aracGidisKm === null) errors.push('Araç gidiş KM gerekli');
  if (payload.aracDonusKm === null) errors.push('Araç dönüş KM gerekli');
  if (payload.km === null) errors.push('Dönüş KM, gidiş KM\'den küçük olamaz');
  if (payload.mazotLt === null) errors.push('Mazot (lt) gerekli');
  if (!payload.gidisTarihi) errors.push('Gidiş tarihi gerekli');
  if (!payload.donusTarihi) errors.push('Dönüş tarihi gerekli');

  const hasPhoto = (key) => !!(photos && photos[key]);
  if (!hasPhoto('photoGidisIrsaliye')) errors.push('Gidiş irsaliye fotoğrafı gerekli');
  if (!hasPhoto('photoGidisKantar')) errors.push('Gidiş kantar fişi fotoğrafı gerekli');

  if (!payload.bosDondu) {
    if (!payload.donusYukleme) errors.push('Dönüş yükleme yeri gerekli');
    if (!payload.donusBosaltma) errors.push('Dönüş boşaltma yeri gerekli');
    if (!hasPhoto('photoDonusIrsaliye')) errors.push('Dönüş irsaliye fotoğrafı gerekli');
    if (!hasPhoto('photoDonusKantar')) errors.push('Dönüş kantar fişi fotoğrafı gerekli');
  }

  return errors;
}

async function savePhotoFromDataUrl(tripId, field, dataUrl, existingPath) {
  if (!dataUrl) return existingPath || null;
  if (typeof dataUrl === 'string' && !dataUrl.startsWith('data:')) {
    return dataUrl;
  }
  const m = String(dataUrl).match(/^data:([^;]+);base64,(.+)$/);
  if (!m) return existingPath || null;
  const ext = m[1].includes('png') ? 'png' : 'jpg';
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 4_000_000) throw new Error(`${field} fotoğrafı çok büyük`);
  const dir = ensureUploadDir(tripId);
  const filename = `${field}.${ext}`;
  const fullPath = path.join(dir, filename);
  fs.writeFileSync(fullPath, buf);
  return path.relative(path.join(__dirname, '..'), fullPath).replace(/\\/g, '/');
}

async function listTrips(q, { plaka, tripType, limit = 100 } = {}) {
  let sql = `SELECT * FROM driver_trips`;
  const params = [];
  const where = [];
  if (plaka) {
    params.push(plaka);
    where.push(`plaka = $${params.length}`);
  }
  if (tripType) {
    params.push(tripType);
    where.push(`COALESCE(trip_type, 'normal') = $${params.length}`);
  }
  if (where.length) sql += ` WHERE ${where.join(' AND ')}`;
  params.push(Math.min(Math.max(Number(limit) || 100, 1), 500));
  sql += ` ORDER BY created_at DESC LIMIT $${params.length}`;
  const r = await q(sql, params);
  return r.rows.map(rowToTrip);
}

async function getTripById(q, id) {
  const r = await q(`SELECT * FROM driver_trips WHERE id = $1`, [id]);
  return rowToTrip(r.rows[0]);
}

async function createTrip(q, { plaka, driverName, body, photos }) {
  const id = crypto.randomUUID();
  const payload = normalizeTripPayload(body, null);
  const photoPaths = {};
  for (const field of [
    'photoGidisIrsaliye',
    'photoGidisKantar',
    'photoDonusIrsaliye',
    'photoDonusKantar',
  ]) {
    photoPaths[field] = await savePhotoFromDataUrl(id, field, photos[field], null);
  }
  const mergedPhotos = { ...photoPaths };
  const errors = validateTripPayload(payload, mergedPhotos, false);
  if (errors.length) {
    const err = new Error(errors.join('; '));
    err.status = 400;
    throw err;
  }

  const now = new Date().toISOString();
  await q(
    `INSERT INTO driver_trips(
      id, plaka, driver_name, trip_type,
      gidis_tarihi, donus_tarihi,
      yukleme_yeri, bosaltma_liman,
      donus_yukleme, donus_bosaltma, bos_dondu,
      arac_gidis_km, arac_donus_km, km,
      mazot_lt, adblue_lt, yakit_yuzde, aciklama,
      photo_gidis_irsaliye, photo_gidis_kantar,
      photo_donus_irsaliye, photo_donus_kantar,
      created_at, updated_at
    ) VALUES (
      $1,$2,$3,'normal',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$22
    )`,
    [
      id, plaka, driverName,
      payload.gidisTarihi, payload.donusTarihi,
      payload.yuklemeYeri, payload.bosaltmaLiman,
      payload.donusYukleme, payload.donusBosaltma, payload.bosDondu,
      payload.aracGidisKm, payload.aracDonusKm, payload.km,
      payload.mazotLt, payload.adblueLt, payload.yakitYuzde, payload.aciklama,
      photoPaths.photoGidisIrsaliye, photoPaths.photoGidisKantar,
      photoPaths.photoDonusIrsaliye, photoPaths.photoDonusKantar,
      now,
    ]
  );
  return getTripById(q, id);
}

async function createIcTrip(q, { plaka, driverName, body, icRoute }) {
  const km = parseNumber(body.km);
  const tarih = parseDate(body.tarih || body.gidisTarihi || new Date().toISOString());
  const aciklama = String(body.aciklama || '').trim();
  const route = icRoute || DEFAULT_IC_ROUTE;

  if (km === null || km <= 0) {
    const err = new Error('KM gerekli (0\'dan büyük)');
    err.status = 400;
    throw err;
  }
  if (!tarih) {
    const err = new Error('Tarih gerekli');
    err.status = 400;
    throw err;
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await q(
    `INSERT INTO driver_trips(
      id, plaka, driver_name, trip_type,
      gidis_tarihi, donus_tarihi,
      yukleme_yeri, bosaltma_liman,
      donus_yukleme, donus_bosaltma, bos_dondu,
      arac_gidis_km, arac_donus_km, km,
      mazot_lt, adblue_lt, yakit_yuzde, aciklama,
      photo_gidis_irsaliye, photo_gidis_kantar,
      photo_donus_irsaliye, photo_donus_kantar,
      created_at, updated_at
    ) VALUES (
      $1,$2,$3,'ic',$4,$4,$5,$6,'','',TRUE,
      NULL,NULL,$7,
      NULL,NULL,NULL,$8,
      NULL,NULL,NULL,NULL,
      $9,$9
    )`,
    [
      id, plaka, driverName,
      tarih,
      route.from, route.to,
      km, aciklama,
      now,
    ]
  );
  return getTripById(q, id);
}

async function updateTrip(q, id, { body, photos, plakaFilter }) {
  const existing = await getTripById(q, id);
  if (!existing) {
    const err = new Error('Kayıt bulunamadı');
    err.status = 404;
    throw err;
  }
  if (plakaFilter && existing.plaka !== plakaFilter) {
    const err = new Error('Bu kayda erişim yok');
    err.status = 403;
    throw err;
  }

  const payload = normalizeTripPayload(body, existing);
  const photoPaths = {
    photoGidisIrsaliye: await savePhotoFromDataUrl(id, 'photoGidisIrsaliye', photos.photoGidisIrsaliye, existing.photoGidisIrsaliye),
    photoGidisKantar: await savePhotoFromDataUrl(id, 'photoGidisKantar', photos.photoGidisKantar, existing.photoGidisKantar),
    photoDonusIrsaliye: await savePhotoFromDataUrl(id, 'photoDonusIrsaliye', photos.photoDonusIrsaliye, existing.photoDonusIrsaliye),
    photoDonusKantar: await savePhotoFromDataUrl(id, 'photoDonusKantar', photos.photoDonusKantar, existing.photoDonusKantar),
  };

  const errors = validateTripPayload(payload, photoPaths, true);
  if (errors.length) {
    const err = new Error(errors.join('; '));
    err.status = 400;
    throw err;
  }

  const now = new Date().toISOString();
  await q(
    `UPDATE driver_trips SET
      gidis_tarihi=$2, donus_tarihi=$3,
      yukleme_yeri=$4, bosaltma_liman=$5,
      donus_yukleme=$6, donus_bosaltma=$7, bos_dondu=$8,
      arac_gidis_km=$9, arac_donus_km=$10, km=$11,
      mazot_lt=$12, adblue_lt=$13, yakit_yuzde=$14, aciklama=$15,
      photo_gidis_irsaliye=$16, photo_gidis_kantar=$17,
      photo_donus_irsaliye=$18, photo_donus_kantar=$19,
      updated_at=$20
     WHERE id=$1`,
    [
      id,
      payload.gidisTarihi, payload.donusTarihi,
      payload.yuklemeYeri, payload.bosaltmaLiman,
      payload.donusYukleme, payload.donusBosaltma, payload.bosDondu,
      payload.aracGidisKm, payload.aracDonusKm, payload.km,
      payload.mazotLt, payload.adblueLt, payload.yakitYuzde, payload.aciklama,
      photoPaths.photoGidisIrsaliye, photoPaths.photoGidisKantar,
      photoPaths.photoDonusIrsaliye, photoPaths.photoDonusKantar,
      now,
    ]
  );
  return getTripById(q, id);
}

function getKmMismatchWarning(trips) {
  if (!Array.isArray(trips) || trips.length < 2) return [];
  const sorted = trips
    .filter((t) => (t.tripType || 'normal') === 'normal')
    .slice()
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const warnings = [];
  for (let i = 0; i < sorted.length - 1; i += 1) {
    const newer = sorted[i];
    const older = sorted[i + 1];
    const newerGidis = parseNumber(newer.aracGidisKm);
    const olderDonus = parseNumber(older.aracDonusKm);
    if (newerGidis !== null && olderDonus !== null && newerGidis !== olderDonus) {
      warnings.push({
        tripId: newer.id,
        previousTripId: older.id,
        expectedKm: olderDonus,
        actualKm: newerGidis,
        diff: newerGidis - olderDonus,
      });
    }
  }
  return warnings;
}

module.exports = {
  ROUTE_POINTS_KEY,
  IC_ROUTE_KEY,
  DEFAULT_IC_ROUTE,
  DEFAULT_ROUTE_POINTS,
  UPLOAD_ROOT,
  loadRoutePoints,
  saveRoutePoints,
  loadIcRoute,
  saveIcRoute,
  listTrips,
  getTripById,
  createTrip,
  createIcTrip,
  updateTrip,
  getKmMismatchWarning,
  buildIcWeeklySummary,
  calcKm,
  calcYakitPct,
};
