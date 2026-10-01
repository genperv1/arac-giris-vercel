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

function normalizeIrsaliyeCollisionKey(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  const compact = s.replace(/\s+/g, '');
  if (!/^R\d/i.test(compact)) return '';
  if (/^R\d{7,15}$/i.test(compact)) {
    const digitsOnly = compact.slice(1);
    const candidates = [];
    for (let prefixLen = 1; prefixLen <= 3; prefixLen++) {
      const numLen = digitsOnly.length - prefixLen;
      if (numLen >= 6 && numLen <= 12) {
        candidates.push({
          prefix: 'R' + digitsOnly.slice(0, prefixLen),
          num: digitsOnly.slice(prefixLen),
        });
      }
    }
    if (candidates.length) {
      const score = (c) => {
        let sc = 0;
        if (/^R\d{2}$/i.test(c.prefix)) sc += 100;
        else if (/^R\d{1}$/i.test(c.prefix)) sc += 50;
        if (/^0/.test(c.num)) sc -= 80;
        if (/^20\d{6}$/.test(c.num)) sc += 60;
        if (c.num.length === 8) sc += 30;
        if (c.num.length === 10) sc += 20;
        return sc;
      };
      candidates.sort((a, b) => score(b) - score(a));
      const best = candidates[0];
      return `${best.prefix.toUpperCase()} ${best.num}`;
    }
  }
  return s.replace(/\s+/g, ' ').toUpperCase();
}

function findIrsaliyeCollisions(rows) {
  const map = new Map();
  for (const r of rows || []) {
    const raw = String(r.irsaliyeNo || '').trim();
    const key = normalizeIrsaliyeCollisionKey(raw);
    if (!key) continue;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push({
      plaka: r.plaka || '-',
      fileName: String(r.fileName || '').trim(),
    });
  }
  const out = [];
  for (const [irs, entries] of map.entries()) {
    const plateKeys = new Set();
    const plates = [];
    entries.forEach((entry) => {
      const pk = String(entry.plaka || '-');
      if (plateKeys.has(pk)) return;
      plateKeys.add(pk);
      plates.push(pk);
    });
    if (plates.length > 1) {
      out.push({
        irsaliyeNo: irs,
        plates,
        entries: entries.filter((entry, idx) => {
          const pk = String(entry.plaka || '-');
          return entries.findIndex((e) => String(e.plaka || '-') === pk) === idx;
        }),
      });
    }
  }
  return out;
}

function dateKeyFromFileName(fileName) {
  const s = String(fileName || '').trim();
  if (!s) return '';
  let m = s.match(/(?:^|[^0-9])(\d{2})[.\-_](\d{2})[.\-_](\d{4})(?:[^0-9]|$)/);
  if (m) {
    const dd = m[1];
    const mm = m[2];
    const yyyy = m[3];
    if (+mm >= 1 && +mm <= 12 && +dd >= 1 && +dd <= 31) return `${yyyy}-${mm}-${dd}`;
  }
  m = s.match(/(?:^|[^0-9])(\d{4})[.\-_](\d{2})[.\-_](\d{2})(?:[^0-9]|$)/);
  if (m) {
    const yyyy = m[1];
    const mm = m[2];
    const dd = m[3];
    if (+mm >= 1 && +mm <= 12 && +dd >= 1 && +dd <= 31) return `${yyyy}-${mm}-${dd}`;
  }
  return '';
}

function formatDateKeyTR(dateKey) {
  const s = String(dateKey || '').trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return s || '';
  return `${m[3]}.${m[2]}.${m[1]}`;
}

function resolveRowTarihLabel(row) {
  const direct = String(row?.tarih || '').trim();
  if (direct) return direct;
  const dateKey = String(row?.dateKey || '').trim() || dateKeyFromFileName(row?.fileName);
  return dateKey ? formatDateKeyTR(dateKey) : '';
}

function buildDupPlateSevkiyatLabel(row) {
  const parts = [];
  const yd = String(row?.ydKey || '').trim().toUpperCase();
  const firma = String(row?.firma || '').trim();
  const malzeme = String(row?.malzeme || '').trim();
  const sira = String(row?.sira || '').trim();
  const sevk = String(row?.sevkYeri || '').trim();
  if (yd) parts.push(yd);
  else if (firma) {
    parts.push(firma.length > 32 ? `${firma.slice(0, 32)}…` : firma);
  }
  if (malzeme) parts.push(malzeme);
  if (sira) parts.push(`Sıra ${sira}`);
  if (sevk) parts.push(sevk);
  return parts.join(' · ');
}

function findDuplicatePlateRows(rows) {
  const map = new Map();
  for (const r of rows || []) {
    const pl = String(r.plaka || '').trim();
    if (!pl) continue;
    const key = pl.replace(/\s+/g, '').toUpperCase();
    if (!map.has(key)) map.set(key, { plaka: pl, entries: [] });
    const ir = String(r.irsaliyeNo || r.id || '').trim() || '-';
    const bbt = String(r.bbt ?? '').trim();
    map.get(key).entries.push({
      irsaliyeNo: ir,
      bbt,
      sira: String(r.sira || '').trim(),
      firma: String(r.firma || r.ydKey || '').trim(),
      malzeme: String(r.malzeme || '').trim(),
      sevkYeri: String(r.sevkYeri || '').trim(),
      fileName: String(r.fileName || '').trim(),
      tarih: resolveRowTarihLabel(r),
      sevkiyat: buildDupPlateSevkiyatLabel(r),
    });
  }
  const out = [];
  for (const v of map.values()) {
    if (v.entries.length > 1) out.push({ plaka: v.plaka, entries: v.entries });
  }
  return out;
}

function formatDupPlateEntryLabel(entry) {
  const tarih = String(entry?.tarih ?? '').trim();
  const sev = String(entry?.sevkiyat ?? '').trim();
  const ir = String(entry?.irsaliyeNo ?? entry ?? '').trim() || '-';
  const bbt = String(entry?.bbt ?? '').trim();
  const chunks = [];
  if (tarih) chunks.push(`${tarih} tarihli listede`);
  chunks.push(sev ? `Sevkiyat: ${sev}` : 'Sevkiyat: (bilinmiyor)');
  chunks.push(`İrsaliye ${ir}`);
  if (bbt) chunks.push(`${bbt} BBT`);
  return chunks.join(' · ');
}

function formatDupPlateRowDetail(d) {
  if (d && Array.isArray(d.entries) && d.entries.length) {
    return d.entries.map(formatDupPlateEntryLabel).join(' · ');
  }
  return (d?.irsaliyeNos || []).filter(Boolean).join(' · ') || '(irsaliye yok)';
}

/** "40.HAFTA" veya "36-37-38-39-40.HAFTA" içindeki hafta numaraları. Tarih metni (HAFTA yok) boş döner. */
function parseSevkHaftasiWeeks(value) {
  const s = normKey(value);
  if (!s || !s.includes('HAFTA')) return [];
  const weeks = [];
  const re = /(^|[^0-9])(\d{1,2})(?![0-9])/g;
  let m;
  while ((m = re.exec(s))) {
    const n = parseInt(m[2], 10);
    if (n >= 1 && n <= 53 && !weeks.includes(n)) weeks.push(n);
  }
  return weeks;
}

/** Aynı siparişin başka sayfadan ikinci kez eklenmemesi için. */
function piyasaOrderCarryKey(o) {
  const sip = String((o && o.sipNo) || '').trim().toUpperCase().replace(/\s+/g, '');
  if (sip) return 'sip:' + sip;
  return [
    'row',
    normKey(o && o.firma),
    normKey(o && o.malzeme),
    normKey(o && (o.il || o.sevkYeri)),
    normKey(o && o.miktar),
  ].join('|');
}

/**
 * Sevk haftası hedef haftayı gösteren, ama o haftanın sayfasında olmayan siparişler.
 * Örnek: K1 satırı 35-HAFTA sayfasında, sevk haftası 40.HAFTA — 40. hafta listesine eklenir.
 */
function carrySevkHaftasiOrders(blocks, targetWeek) {
  const week = Number(targetWeek);
  if (!Number.isFinite(week)) return [];
  const home = [];
  const foreign = [];
  for (const b of blocks || []) {
    const isHome = Number(b && b.week) === week;
    for (const o of (b && b.orders) || []) {
      if (!o) continue;
      if (isHome) home.push(o);
      else foreign.push({ order: o, fromSheet: b.sheet, fromWeek: b.week });
    }
  }
  foreign.sort((a, b) => (Number(b.fromWeek) || 0) - (Number(a.fromWeek) || 0));
  const seen = new Set(home.map(piyasaOrderCarryKey));
  const out = [];
  for (const item of foreign) {
    const weeks = parseSevkHaftasiWeeks(item.order.sevkHaftasi);
    if (!weeks.includes(week)) continue;
    const key = piyasaOrderCarryKey(item.order);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({
      ...item.order,
      carriedFromSheet: String(item.fromSheet || ''),
      carriedFromWeek: item.fromWeek,
      __archiveKey: `${week}:sevk:${item.fromWeek}:${item.fromSheet}:${item.order.__idx}`,
    });
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

function _pad2(n) {
  return String(n).padStart(2, '0');
}

function _isoFromYmd(year, month, day) {
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return '';
  if (y < 1990 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return '';
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return '';
  return `${y}-${_pad2(m)}-${_pad2(d)}`;
}

function _labelFromIso(iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return '';
  return `${m[3]}.${m[2]}.${m[1]}`;
}

/** Excel seri tarihi (gün kesri yok sayılır) → YYYY-MM-DD. 1990–2100 dışı boş. */
function excelSerialToIsoDate(serial) {
  const n = Number(serial);
  if (!Number.isFinite(n)) return '';
  const day = Math.floor(n + 1e-8);
  if (day < 32874 || day > 73415) return '';
  const dt = new Date((day - 25569) * 86400 * 1000);
  if (isNaN(dt.getTime())) return '';
  return _isoFromYmd(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

/**
 * Fiili sevk çıkış tarihi. Boş, hafta etiketi (40.HAFTA) ve aralık metinleri tarih sayılmaz.
 * @returns {{ iso: string, label: string } | null}
 */
function parseFiiliSevkCikis(value) {
  if (value instanceof Date && !isNaN(value.getTime())) {
    const iso = _isoFromYmd(value.getFullYear(), value.getMonth() + 1, value.getDate());
    return iso ? { iso, label: _labelFromIso(iso) } : null;
  }
  if (typeof value === 'number') {
    const iso = excelSerialToIsoDate(value);
    return iso ? { iso, label: _labelFromIso(iso) } : null;
  }
  const s = String(value ?? '').trim();
  if (!s) return null;
  if (/^\d{4,6}(\.\d+)?$/.test(s)) {
    const iso = excelSerialToIsoDate(s);
    return iso ? { iso, label: _labelFromIso(iso) } : null;
  }
  const m = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{2,4})$/);
  if (!m) return null;
  let year = parseInt(m[3], 10);
  if (year < 100) year += 2000;
  const iso = _isoFromYmd(year, parseInt(m[2], 10), parseInt(m[1], 10));
  return iso ? { iso, label: _labelFromIso(iso) } : null;
}

function todayIsoLocal(now) {
  const d = now instanceof Date && !isNaN(now.getTime()) ? now : new Date();
  return `${d.getFullYear()}-${_pad2(d.getMonth() + 1)}-${_pad2(d.getDate())}`;
}

/** Takvim günü bugünden önceyse geçmiş sayılır. Bugün ve sonrası işleme açık. */
function isFiiliSevkCikisPast(iso, now) {
  const s = String(iso || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  return s < todayIsoLocal(now);
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
  findDuplicatePlateRows,
  dateKeyFromFileName,
  formatDateKeyTR,
  resolveRowTarihLabel,
  buildDupPlateSevkiyatLabel,
  formatDupPlateEntryLabel,
  formatDupPlateRowDetail,
  parseSevkHaftasiWeeks,
  piyasaOrderCarryKey,
  carrySevkHaftasiOrders,
  scorePiyasaOrder,
  suggestPiyasaOrders,
  excelSerialToIsoDate,
  parseFiiliSevkCikis,
  todayIsoLocal,
  isFiiliSevkCikisPast,
};
