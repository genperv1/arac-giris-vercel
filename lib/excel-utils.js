'use strict';

/** Ortak Excel yardımcıları (Node test + tarayıcı excel-utils.js ile senkron tutun). */

const TONAJ_WARN_PCT = 10;
const TONAJ_DANGER_PCT = 25;

const PIYASA_EXPECTED_HEADERS = [
  'SIRA', 'SİRA', 'SEVK', 'FİRMA', 'FIRMA', 'FİRMA ADI', 'FIRMA ADI',
  'MALZEME', 'YÜKLEME TÜRÜ', 'YUKLEME TURU', 'AÇIKLAMA', 'ACIKLAMA',
  'İL', 'IL', 'LOT', 'MİKTAR', 'MIKTAR', 'ÖDEME', 'ODEME', 'ORG',
];

const CORRUPT_IL_AS_FIRMA = new Set([
  'ANKARA', 'İSTANBUL', 'IZMIR', 'İZMİR', 'BURSA', 'ADANA', 'BALIKESİR', 'BALIKESIR',
  'MERSİN', 'MERSIN', 'GEBZE', 'BOZÜYÜK', 'BOZUYUK', 'AKSARAY', 'ANKARA/BALA', 'TURGUTLU/MANİSA',
]);

function normKey(k) {
  return String(k || '')
    .toUpperCase()
    .replace(/\u0130/g, 'I')
    .replace(/İ/g, 'I')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseAmount(v) {
  const s = String(v ?? '').trim();
  if (!s) return NaN;
  const cleaned = s.replace(/\s+/g, '').replace(/\./g, '').replace(',', '.');
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : NaN;
}

/** Sadece düz sayı (12.500 / 12,5) — "4 X 2.000 KG" veya "(9.000 - 10.000) KG" değil. */
function isSimpleNumericMiktar(v) {
  const s = String(v ?? '').trim();
  if (!s) return false;
  return /^[\d\s.,]+$/.test(s);
}

/** Piyasa satırından miktar sütununu seç (önce Miktar Dane, sonra Miktar). */
function pickPiyasaMiktar(row) {
  if (!row || typeof row !== 'object') return '';
  const map = {};
  for (const key of Object.keys(row)) {
    if (key.startsWith('_')) continue;
    map[normKey(key)] = row[key];
  }
  const exact = [
    'MIKTAR DANE', 'MİKTAR DANE', 'MIKTARDANE', 'MİKTARDANE',
    'MIKTAR', 'MİKTAR', 'TONAJ',
  ];
  for (const w of exact) {
    const v = map[normKey(w)];
    if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
  }
  for (const nk of Object.keys(map)) {
    if ((nk.includes('MIKTAR') && nk.includes('DANE')) || nk === 'MIKTARDANE') {
      const v = map[nk];
      if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
    }
  }
  for (const nk of Object.keys(map)) {
    if (nk.includes('MIKTAR') || nk.includes('TONAJ')) {
      const v = map[nk];
      if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
    }
  }
  return '';
}

/** Miktar geçerli mi: düz sayı > 0 veya açıklamalı metinde en az bir rakam. */
function hasValidPiyasaMiktar(v) {
  const s = String(v ?? '').trim();
  if (!s) return false;
  if (isSimpleNumericMiktar(s)) {
    const n = parseAmount(s);
    return Number.isFinite(n) && n > 0;
  }
  return /\d/.test(s);
}

function isSummaryText(v) {
  const t = String(v || '').toUpperCase().replace(/\u0130/g, 'I');
  return t.includes('TOPLAM') || t.includes('ARA TOPLAM') || t.includes('GENEL TOPLAM') || t.includes('OZET') || t.includes('ÖZET');
}

/** Basit dosya parmak izi (ad + boyut + ilk 64KB hash benzeri). */
async function fingerprintFile(file) {
  if (!file) return '';
  const name = String(file.name || '');
  const size = Number(file.size || 0);
  try {
    const buf = await file.slice(0, Math.min(size, 65536)).arrayBuffer();
    const u8 = new Uint8Array(buf);
    let h = 2166136261;
    for (let i = 0; i < u8.length; i++) {
      h ^= u8[i];
      h = Math.imul(h, 16777619);
    }
    return `${name}|${size}|${(h >>> 0).toString(16)}`;
  } catch (e) {
    return `${name}|${size}`;
  }
}

function fingerprintFileSync(name, size) {
  return `${String(name || '')}|${Number(size || 0)}`;
}

function validatePiyasaTemplate(headerCells) {
  const set = new Set((headerCells || []).map((c) => normKey(c)).filter(Boolean));
  const found = [];
  const missing = [];
  const groups = [
    ['SIRA', 'SİRA'],
    ['FIRMA', 'FİRMA'],
    ['MALZEME'],
    ['MIKTAR', 'MİKTAR'],
  ];
  for (const g of groups) {
    const hit = g.find((x) => set.has(normKey(x)));
    if (hit) found.push(hit);
    else missing.push(g[0]);
  }
  return { ok: missing.length <= 1, found, missing, score: found.length };
}

function findFirmaAdiColumnIndex(headerRow) {
  if (!Array.isArray(headerRow)) return -1;
  for (let i = 0; i < headerRow.length; i++) {
    const n = normKey(headerRow[i]);
    if (n === 'FIRMA ADI' || n === 'FİRMA ADI' || n === 'FIRMAADI' || n === 'FİRMAADI') return i;
  }
  return -1;
}

function detectMiktarUnit(headerRow) {
  if (!Array.isArray(headerRow)) return 'kg';
  for (let i = 0; i < headerRow.length; i++) {
    const n = normKey(headerRow[i]);
    if (n.includes('MIKTAR') || n.includes('MİKTAR') || n.includes('TONAJ')) {
      if (/\bTON\b/i.test(String(headerRow[i] || ''))) return 'ton';
      if (/KG/i.test(String(headerRow[i] || ''))) return 'kg';
    }
  }
  return 'kg';
}

function miktarToKg(raw, unit) {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  if (!isSimpleNumericMiktar(s)) return s;
  const n = parseAmount(s);
  if (!Number.isFinite(n)) return s;
  if (unit === 'ton') return String(Math.round(n * 1000));
  return String(n);
}

function filterPiyasaRow(o, rowIndex) {
  const firma = String(o.firma || '').trim();
  const malzeme = String(o.malzeme || '').trim();
  const miktarRaw = String(o.miktar || '').trim();
  const il = String(o.il || '').trim().toUpperCase();

  if (!firma && !malzeme && !o.yuklemeTuru && !o.aciklama && !il && !miktarRaw && !o.odemeTuru && !o.org) {
    return { ok: false, reason: 'boş_satır', rowIndex };
  }
  if (isSummaryText(firma) || isSummaryText(malzeme)) {
    return { ok: false, reason: 'özet_satırı', rowIndex };
  }
  if (!firma) return { ok: false, reason: 'firma_boş', rowIndex };
  if (!malzeme) return { ok: false, reason: 'malzeme_boş', rowIndex };
  if (!hasValidPiyasaMiktar(miktarRaw)) return { ok: false, reason: 'miktar_geçersiz', rowIndex };
  if (firma.toUpperCase() === il && firma.length > 0 && CORRUPT_IL_AS_FIRMA.has(firma.toUpperCase())) {
    return { ok: false, reason: 'firma_il_karışık', rowIndex };
  }
  return { ok: true };
}

function summarizeSkipped(skipped) {
  const counts = {};
  for (const s of skipped || []) {
    const r = s.reason || 'bilinmiyor';
    counts[r] = (counts[r] || 0) + 1;
  }
  return counts;
}

const SKIP_REASON_LABELS = {
  boş_satır: 'Boş satır',
  özet_satırı: 'Özet / toplam satırı',
  firma_boş: 'Firma kodu boş',
  malzeme_boş: 'Malzeme boş',
  miktar_geçersiz: 'Miktar yok veya ≤ 0',
  firma_il_karışık: 'Firma alanında il bilgisi (bozuk veri)',
  bilinmiyor: 'Bilinmeyen',
};

function compareExcelWeeks(ihrMeta, piyasaState) {
  const warnings = [];
  if (!ihrMeta || !piyasaState) return warnings;
  const ihrDate = String(ihrMeta.dateKey || '').trim();
  const piyWeek = piyasaState.week != null ? Number(piyasaState.week) : null;
  if (!ihrDate || !Number.isFinite(piyWeek)) return warnings;

  try {
    const d = new Date(ihrDate + 'T12:00:00');
    if (isNaN(d.getTime())) return warnings;
    const jan4 = new Date(Date.UTC(d.getFullYear(), 0, 4));
    const day = jan4.getUTCDay() || 7;
    const mondayOfWeek1 = new Date(Date.UTC(d.getFullYear(), 0, 4 - (day - 1)));
    const diff = Math.floor((d - mondayOfWeek1) / 86400000);
    const ihrWeek = Math.ceil((diff + 1) / 7);
    if (Math.abs(ihrWeek - piyWeek) > 1) {
      warnings.push({
        code: 'week_mismatch',
        message: `İhracat tarihi (~${ihrWeek}. hafta) ile Piyasa (${piyWeek}. hafta) uyumsuz olabilir.`,
      });
    }
  } catch (e) { /* ignore */ }
  return warnings;
}

function parseTonajNumber(v) {
  const n = parseAmount(v);
  return Number.isFinite(n) ? n : NaN;
}

function tonajCompare(formTonaj, excelTonaj) {
  const a = parseTonajNumber(formTonaj);
  const b = parseTonajNumber(excelTonaj);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= 0) return { level: 'ok', pct: 0 };
  const pct = Math.abs((a - b) / b) * 100;
  if (pct >= TONAJ_DANGER_PCT) return { level: 'danger', pct };
  if (pct >= TONAJ_WARN_PCT) return { level: 'warn', pct };
  return { level: 'ok', pct };
}

function findIrsaliyeCollisions(rows) {
  const map = new Map();
  for (const r of rows || []) {
    const ir = String(r.irsaliyeNo || r.id || '').trim();
    if (!ir || !/^R\d/i.test(ir.replace(/\s+/g, ''))) continue;
    const key = ir.replace(/\s+/g, ' ').toUpperCase();
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(r.plaka || '-');
  }
  const out = [];
  for (const [irs, plates] of map.entries()) {
    const uniq = [...new Set(plates)];
    if (uniq.length > 1) out.push({ irsaliyeNo: irs, plates: uniq });
  }
  return out;
}

function scorePiyasaOrder(order, ctx) {
  const firma = normKey(ctx.firma || '');
  const malzeme = normKey(ctx.malzeme || '');
  const sevk = normKey(ctx.sevkYeri || '');
  let score = 0;
  if (firma && normKey(order.firma).includes(firma)) score += 3;
  if (malzeme && normKey(order.malzeme).includes(malzeme)) score += 2;
  const oil = normKey(order.il || order.sevkYeri || '');
  if (sevk && oil && (oil.includes(sevk) || sevk.includes(oil))) score += 2;
  if (order.usedAt) score -= 5;
  return score;
}

function suggestPiyasaOrders(orders, ctx, limit) {
  const lim = limit || 3;
  return (orders || [])
    .map((o) => ({ order: o, score: scorePiyasaOrder(o, ctx) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, lim);
}

module.exports = {
  TONAJ_WARN_PCT,
  TONAJ_DANGER_PCT,
  PIYASA_EXPECTED_HEADERS,
  normKey,
  parseAmount,
  isSimpleNumericMiktar,
  pickPiyasaMiktar,
  hasValidPiyasaMiktar,
  isSummaryText,
  fingerprintFile,
  fingerprintFileSync,
  validatePiyasaTemplate,
  findFirmaAdiColumnIndex,
  detectMiktarUnit,
  miktarToKg,
  filterPiyasaRow,
  summarizeSkipped,
  SKIP_REASON_LABELS,
  compareExcelWeeks,
  tonajCompare,
  findIrsaliyeCollisions,
  scorePiyasaOrder,
  suggestPiyasaOrders,
};
