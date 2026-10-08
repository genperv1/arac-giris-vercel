'use strict';

const { compactPlate } = require('./plate-format');

const YD_FIRMA_RE = /(^|[^A-Za-z0-9])G?YD\d{1,4}(?:\([A-Za-z]+\))?/i;

function isYdFirma(value) {
  return YD_FIRMA_RE.test(String(value || '').trim());
}

/**
 * Ekranda görünen firma kodu.
 * Sayıdan sonra yalnızca harf eki varsa çekirdek kalır: K1BGSP→K1, G9SP→G9, CR2S→CR2, G16BGP→G16.
 * Sayı kısılmaz: HP13, HP7, HP87 olduğu gibi kalır.
 * Boşluklu yer adı kesilmez: HP2 GEBZE, HP3 SİAS.
 */
function displayFirmaKod(raw) {
  const head = String(raw || '').split('/')[0].trim();
  if (!head) return '';
  const upper = head.toLocaleUpperCase('tr-TR');
  if (/\s/.test(upper)) return upper;
  const key = upper.replace(/İ/g, 'I').replace(/ı/g, 'I');
  const m = key.match(/^([A-Z]{1,4}\d{1,4})([A-Z]{1,6})$/);
  if (!m) return upper;
  return upper.slice(0, m[1].length);
}

function firmaMatchesQuery(stored, query) {
  const q = foldTrIl(displayFirmaKod(query)).replace(/\s+/g, '');
  if (!q) return true;
  const shown = foldTrIl(displayFirmaKod(stored)).replace(/\s+/g, '');
  const raw = foldTrIl(String(stored || '').split('/')[0]).replace(/\s+/g, '');
  const first = foldTrIl(String(displayFirmaKod(stored)).split(/\s+/)[0] || '');
  return shown === q || raw === q || first === q;
}

function istanbulDayStartMs(ymd) {
  const m = String(ymd || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const ms = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00+03:00`).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function istanbulDayEndMs(ymd) {
  const start = istanbulDayStartMs(ymd);
  if (start == null) return null;
  return start + 24 * 60 * 60 * 1000;
}

const TR_MONTHS_SHORT = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];

/** Piyasa Excel getWeekFromDate ile aynı ISO hafta + ISO hafta yılı. */
function isoWeekInfoFromParts(y, m1, d) {
  const date = new Date(Date.UTC(Number(y), Number(m1) - 1, Number(d)));
  if (!Number.isFinite(date.getTime())) return null;
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const year = date.getUTCFullYear();
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const week = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
  if (!Number.isFinite(week) || week < 1) return null;
  return { week, year };
}

function isoWeekFromParts(y, m1, d) {
  const info = isoWeekInfoFromParts(y, m1, d);
  return info ? info.week : null;
}

function isoWeekFromYmd(ymd) {
  const m = String(ymd || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return isoWeekFromParts(Number(m[1]), Number(m[2]), Number(m[3]));
}

function isoWeekInfoFromMs(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return null;
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Istanbul',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date(n));
    const y = Number((parts.find((p) => p.type === 'year') || {}).value);
    const mo = Number((parts.find((p) => p.type === 'month') || {}).value);
    const d = Number((parts.find((p) => p.type === 'day') || {}).value);
    return isoWeekInfoFromParts(y, mo, d);
  } catch (e) {
    return null;
  }
}

function isoWeekFromMs(ms) {
  const info = isoWeekInfoFromMs(ms);
  return info ? info.week : null;
}

/** ISO haftanın Pazartesi 00:00 UTC (görüntü aralığı için). */
function isoWeekMondayUtc(year, week) {
  const y = Number(year);
  const w = Number(week);
  if (!Number.isFinite(y) || !Number.isFinite(w) || w < 1 || w > 53) return null;
  const jan4 = new Date(Date.UTC(y, 0, 4));
  const dayNum = jan4.getUTCDay() || 7;
  return new Date(Date.UTC(y, 0, 4 - (dayNum - 1) + (w - 1) * 7));
}

function formatIsoWeekRange(year, week) {
  const monday = isoWeekMondayUtc(year, week);
  if (!monday) return '';
  const sunday = new Date(monday.getTime() + 6 * 86400000);
  const sameYear = monday.getUTCFullYear() === sunday.getUTCFullYear();
  const sameMonth = sameYear && monday.getUTCMonth() === sunday.getUTCMonth();
  const monYear = monday.getUTCFullYear();
  const sunYear = sunday.getUTCFullYear();
  if (sameMonth) {
    return monday.getUTCDate() + '–' + sunday.getUTCDate() + ' ' + TR_MONTHS_SHORT[monday.getUTCMonth()];
  }
  if (sameYear) {
    return monday.getUTCDate() + ' ' + TR_MONTHS_SHORT[monday.getUTCMonth()]
      + ' – ' + sunday.getUTCDate() + ' ' + TR_MONTHS_SHORT[sunday.getUTCMonth()];
  }
  return monday.getUTCDate() + ' ' + TR_MONTHS_SHORT[monday.getUTCMonth()] + ' ' + monYear
    + ' – ' + sunday.getUTCDate() + ' ' + TR_MONTHS_SHORT[sunday.getUTCMonth()] + ' ' + sunYear;
}

function parseStoredHafta(value) {
  const n = parseInt(String(value || '').replace(/[^\d]/g, ''), 10);
  return Number.isFinite(n) && n > 0 && n < 60 ? n : null;
}

/** Çıkanlar haftası = baskı anı. Excel kaynak haftası yalnızca tarih yoksa yedek. */
function resolveHafta(stored, tarihMs) {
  return isoWeekFromMs(tarihMs) || parseStoredHafta(stored);
}

function haftaLabel(week) {
  const n = parseStoredHafta(week);
  return n ? (n + '. hafta') : '';
}

/** Baskı haftasından farklı Excel haftası. Aynı haftaysa boş — seçim yasaklanmaz, sadece işaretlenir. */
function kaynakHaftaSecildiLabel(kaynakHafta, tarihMs) {
  const kaynak = parseStoredHafta(kaynakHafta);
  const printed = isoWeekFromMs(tarihMs);
  if (!kaynak || !printed || kaynak === printed) return '';
  return kaynak + '. haftadan seçildi';
}

function _groupKey(year, week) {
  return String(year) + '-' + String(week).padStart(2, '0');
}

function _makeHaftaGroup(year, week, isCurrent, rows, currentYear) {
  const rangeLabel = year && week ? formatIsoWeekRange(year, week) : '';
  const weekText = week ? (week + '. hafta') : 'Diğer';
  const showYear = !isCurrent && year && year !== currentYear;
  const pastBits = [rangeLabel, showYear ? String(year) : ''].filter(Boolean);
  return {
    key: year && week ? _groupKey(year, week) : 'unknown',
    year: year || 0,
    week: week || 0,
    isCurrent: !!isCurrent,
    title: isCurrent ? 'Bu hafta' : weekText,
    subtitle: isCurrent
      ? (weekText + (rangeLabel ? ' · ' + rangeLabel : ''))
      : pastBits.join(' · '),
    rangeLabel,
    count: Array.isArray(rows) ? rows.length : 0,
    rows: Array.isArray(rows) ? rows : [],
  };
}

/**
 * Çıkan kayıtları ISO haftaya göre gruplar. Bu hafta her zaman listenin başındadır
 * (kayıt olmasa da boş grup olarak).
 */
function groupCikanlarByHafta(rows, nowMs) {
  const nowInfo = isoWeekInfoFromMs(nowMs || Date.now()) || null;
  const map = new Map();
  for (const row of (Array.isArray(rows) ? rows : [])) {
    const fromTarih = isoWeekInfoFromMs(row && row.tarih);
    const week = (fromTarih && fromTarih.week) || parseStoredHafta(row && row.hafta) || 0;
    const year = (fromTarih && fromTarih.year) || Number(row && row.haftaYear) || 0;
    const key = week && year ? _groupKey(year, week) : 'unknown';
    let g = map.get(key);
    if (!g) {
      const isCurrent = !!(nowInfo && year === nowInfo.year && week === nowInfo.week);
      g = _makeHaftaGroup(year, week, isCurrent, [], nowInfo && nowInfo.year);
      map.set(key, g);
    }
    g.rows.push(row);
    g.count = g.rows.length;
  }
  const groups = Array.from(map.values());
  if (nowInfo && !groups.some((g) => g.isCurrent)) {
    groups.push(_makeHaftaGroup(nowInfo.year, nowInfo.week, true, [], nowInfo.year));
  }
  groups.sort((a, b) => {
    if (a.isCurrent !== b.isCurrent) return a.isCurrent ? -1 : 1;
    if (b.year !== a.year) return b.year - a.year;
    return b.week - a.week;
  });
  return groups;
}

function _s(sanitizeString, value, max) {
  if (typeof sanitizeString === 'function') return sanitizeString(value || '', max);
  return String(value || '').trim().slice(0, max);
}

function normalizeCikanlarInsert(body, sanitizeString) {
  const src = body && typeof body === 'object' ? body : {};
  const firma = _s(sanitizeString, src.firma || src.firmaKodu || '', 100);
  if (isYdFirma(firma) || isYdFirma(src.firmaKodu)) {
    return { error: 'YD_NOT_ALLOWED', message: 'İhracat (YD / GYD) kayıtları Piyasa çıkanlara yazılmaz.' };
  }
  const plaka = compactPlate(_s(sanitizeString, src.plaka || '', 50));
  if (!plaka) return { error: 'PLAKA_REQUIRED', message: 'Plaka gerekli' };

  const tarihRaw = Number(src.tarih);
  const tarih = Number.isFinite(tarihRaw) && tarihRaw > 0 ? tarihRaw : Date.now();
  const haftaNum = resolveHafta(src.hafta, tarih);

  return {
    id: _s(sanitizeString, src.id || '', 80)
      || (Date.now().toString() + Math.random().toString(16).slice(2)),
    print_history_id: _s(sanitizeString, src.print_history_id || src.printHistoryId || '', 80),
    tarih,
    plaka,
    dorse_plaka: compactPlate(_s(sanitizeString, src.dorse_plaka || src.dorsePlaka || '', 50)),
    sofor: _s(sanitizeString, src.sofor || '', 120),
    firma,
    firma_adi: _s(sanitizeString, src.firma_adi || src.firmaAdi || '', 200),
    sip_no: _s(sanitizeString, src.sip_no || src.sipNo || '', 80),
    malzeme: _s(sanitizeString, src.malzeme || '', 400),
    yukleme_turu: _s(sanitizeString, src.yukleme_turu || src.yuklemeTuru || src.ambalajBilgisi || '', 200),
    sehir: _s(sanitizeString, src.sehir || src.il || '', 80),
    sevk_yeri: _s(sanitizeString, src.sevk_yeri || src.sevkYeri || '', 200),
    miktar: _s(sanitizeString, src.miktar != null ? String(src.miktar) : '', 50),
    tonaj: _s(sanitizeString, src.tonaj || '', 50),
    basim_yeri: _s(sanitizeString, src.basim_yeri || src.basimYeri || '', 20).toUpperCase(),
    kantarci: _s(sanitizeString, src.kantarci || src.kantar || src.imzaKantarAd || '', 120),
    order_key: _s(sanitizeString, src.order_key || src.orderKey || '', 120),
    hafta: haftaNum != null ? String(haftaNum) : '',
    kaynak_hafta: (() => {
      const n = parseStoredHafta(src.kaynak_hafta || src.kaynakHafta || '');
      return n ? String(n) : '';
    })(),
    sheet: _s(sanitizeString, src.sheet || '', 80),
    sevkiyat_tipi: _s(sanitizeString, src.sevkiyat_tipi || src.sevkiyatTipi || '', 40),
    vehicle_id: _s(sanitizeString, src.vehicle_id || src.vehicleId || '', 80),
  };
}

/** Yazdırılan piyasa listesindeki ŞEHİR: Excel İL, yoksa sevk yeri. */
function displaySehir(row) {
  const sehir = String((row && (row.sehir || row.il)) || '').trim();
  if (sehir) return sehir;
  return String((row && (row.sevk_yeri || row.sevkYeri)) || '').trim();
}

/** SİVAS / Sivas / sivas aynı kabul edilir. */
function foldTrIl(s) {
  return String(s || '')
    .replace(/İ/g, 'I')
    .replace(/ı/g, 'i')
    .toUpperCase()
    .replace(/İ/g, 'I');
}

function sehirSearchHay(row) {
  return foldTrIl([
    displaySehir(row),
    String((row && (row.sevk_yeri || row.sevkYeri)) || '').trim(),
  ].filter(Boolean).join(' '));
}

function rowMatchesIl(row, ilQ) {
  const q = foldTrIl(ilQ);
  if (!q) return true;
  return sehirSearchHay(row).includes(q);
}

function firstNonEmpty(values) {
  const list = Array.isArray(values) ? values : Array.prototype.slice.call(arguments);
  for (const v of list) {
    const s = String(v == null ? '' : v).trim();
    if (s) return s;
  }
  return '';
}

function normalizePrintHistoryIds(ids) {
  const out = [];
  const seen = new Set();
  const list = Array.isArray(ids) ? ids : [ids];
  for (const raw of list) {
    const id = String(raw == null ? '' : raw).trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function cikanlarMirrorIds(printHistoryIds) {
  return normalizePrintHistoryIds(printHistoryIds).map((id) => 'ph_' + id);
}

/** Rapor silinince bağlı çıkan satırı da kalksın (doğrudan yazılan ve backfill kopyası). */
const DELETE_CIKANLAR_BY_PRINT_HISTORY_SQL = `
  DELETE FROM piyasa_cikanlar
  WHERE print_history_id = ANY($1::text[])
     OR id = ANY($2::text[])
`;

/** Raporu kalmayan eski çıkan satırları. Baskı kaydı yazılamamış (print_history_id boş) satırlar kalır. */
const DELETE_ORPHAN_CIKANLAR_SQL = `
  DELETE FROM piyasa_cikanlar c
  WHERE COALESCE(btrim(c.print_history_id), '') <> ''
    AND NOT EXISTS (
      SELECT 1 FROM print_history ph WHERE ph.id = c.print_history_id
    )
`;

const CIKANLAR_LINKED_REPORT_SQL = `(
  COALESCE(btrim(print_history_id), '') = ''
  OR EXISTS (SELECT 1 FROM print_history ph WHERE ph.id = piyasa_cikanlar.print_history_id)
)`;

/** Firma, malzeme ve tonajı boş baskı. Çıkan listesine mükerrer kabuk olarak düşmesin. */
const BLANK_CIKANLAR_PREDICATE = `(
  COALESCE(btrim(firma), '') = ''
  AND COALESCE(btrim(malzeme), '') = ''
  AND COALESCE(btrim(tonaj), '') = ''
)`;

const DELETE_BLANK_CIKANLAR_SQL = `DELETE FROM piyasa_cikanlar WHERE ${BLANK_CIKANLAR_PREDICATE}`;

async function deleteCikanlarForPrintHistory(q, ids) {
  const clean = normalizePrintHistoryIds(ids);
  if (!clean.length || typeof q !== 'function') return 0;
  const r = await q(DELETE_CIKANLAR_BY_PRINT_HISTORY_SQL, [clean, cikanlarMirrorIds(clean)]);
  return Number(r && r.rowCount) || 0;
}

async function deleteOrphanCikanlar(q) {
  if (typeof q !== 'function') return 0;
  const r = await q(DELETE_ORPHAN_CIKANLAR_SQL);
  return Number(r && r.rowCount) || 0;
}

async function deleteBlankCikanlar(q) {
  if (typeof q !== 'function') return 0;
  const r = await q(DELETE_BLANK_CIKANLAR_SQL);
  return Number(r && r.rowCount) || 0;
}

/**
 * Çıkanlar kaydı kağıttaki (yazdırılan form) değerleri alır.
 * Excel siparişi yalnızca form boşsa yedek.
 */
function pickCikanlarFormFields(printEv, snap, pp, order) {
  const ev = printEv && typeof printEv === 'object' ? printEv : {};
  const sh = snap && typeof snap === 'object' ? snap : {};
  const payload = pp && typeof pp === 'object' ? pp : {};
  const o = order && typeof order === 'object' ? order : null;
  return {
    firma: firstNonEmpty([
      ev.firma, ev.firmaKodu, sh.firmaKodu, sh.firmaSelect, o && o.firma,
    ]),
    malzeme: firstNonEmpty([
      ev.malzeme, payload.malzeme, sh.malzeme, sh.malzemeSelect, o && o.malzeme,
    ]),
    yukleme_turu: firstNonEmpty([
      ev.yuklemeTuru, ev.ambalajBilgisi, payload.ambalajBilgisi, sh.ambalajBilgisi,
      o && o.yuklemeTuru,
    ]),
  };
}

module.exports = {
  isYdFirma,
  displayFirmaKod,
  firmaMatchesQuery,
  istanbulDayStartMs,
  istanbulDayEndMs,
  isoWeekInfoFromParts,
  isoWeekFromParts,
  isoWeekFromYmd,
  isoWeekInfoFromMs,
  isoWeekFromMs,
  isoWeekMondayUtc,
  formatIsoWeekRange,
  parseStoredHafta,
  resolveHafta,
  haftaLabel,
  kaynakHaftaSecildiLabel,
  groupCikanlarByHafta,
  normalizeCikanlarInsert,
  displaySehir,
  sehirSearchHay,
  foldTrIl,
  rowMatchesIl,
  firstNonEmpty,
  pickCikanlarFormFields,
  normalizePrintHistoryIds,
  cikanlarMirrorIds,
  DELETE_CIKANLAR_BY_PRINT_HISTORY_SQL,
  DELETE_ORPHAN_CIKANLAR_SQL,
  CIKANLAR_LINKED_REPORT_SQL,
  BLANK_CIKANLAR_PREDICATE,
  DELETE_BLANK_CIKANLAR_SQL,
  deleteCikanlarForPrintHistory,
  deleteOrphanCikanlar,
  deleteBlankCikanlar,
};
