'use strict';

const YD_FIRMA_RE = /\bYD\d{1,4}(?:\([A-Za-z]+\))?/i;

function isYdFirma(value) {
  return YD_FIRMA_RE.test(String(value || '').trim());
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

function resolveHafta(stored, tarihMs) {
  return parseStoredHafta(stored) || isoWeekFromMs(tarihMs);
}

function haftaLabel(week) {
  const n = parseStoredHafta(week);
  return n ? (n + '. hafta') : '';
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
    const week = parseStoredHafta(row && row.hafta) || (fromTarih && fromTarih.week) || 0;
    const year = Number(row && row.haftaYear) || (fromTarih && fromTarih.year) || 0;
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
    return { error: 'YD_NOT_ALLOWED', message: 'İhracat (YD) kayıtları Piyasa çıkanlara yazılmaz.' };
  }
  const plaka = _s(sanitizeString, src.plaka || '', 50);
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
    dorse_plaka: _s(sanitizeString, src.dorse_plaka || src.dorsePlaka || '', 50),
    sofor: _s(sanitizeString, src.sofor || '', 120),
    firma,
    firma_adi: _s(sanitizeString, src.firma_adi || src.firmaAdi || '', 200),
    sip_no: _s(sanitizeString, src.sip_no || src.sipNo || '', 80),
    malzeme: _s(sanitizeString, src.malzeme || '', 120),
    yukleme_turu: _s(sanitizeString, src.yukleme_turu || src.yuklemeTuru || src.ambalajBilgisi || '', 200),
    sehir: _s(sanitizeString, src.sehir || src.il || '', 80),
    sevk_yeri: _s(sanitizeString, src.sevk_yeri || src.sevkYeri || '', 200),
    miktar: _s(sanitizeString, src.miktar != null ? String(src.miktar) : '', 50),
    tonaj: _s(sanitizeString, src.tonaj || '', 50),
    basim_yeri: _s(sanitizeString, src.basim_yeri || src.basimYeri || '', 20).toUpperCase(),
    kantarci: _s(sanitizeString, src.kantarci || src.kantar || src.imzaKantarAd || '', 120),
    order_key: _s(sanitizeString, src.order_key || src.orderKey || '', 120),
    hafta: haftaNum != null ? String(haftaNum) : '',
    sheet: _s(sanitizeString, src.sheet || '', 80),
    sevkiyat_tipi: _s(sanitizeString, src.sevkiyat_tipi || src.sevkiyatTipi || '', 40),
    vehicle_id: _s(sanitizeString, src.vehicle_id || src.vehicleId || '', 80),
  };
}

module.exports = {
  isYdFirma,
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
  groupCikanlarByHafta,
  normalizeCikanlarInsert,
};
