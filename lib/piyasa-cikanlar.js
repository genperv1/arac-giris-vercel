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

/** Piyasa Excel getWeekFromDate ile aynı ISO hafta (1–53). */
function isoWeekFromParts(y, m1, d) {
  const date = new Date(Date.UTC(Number(y), Number(m1) - 1, Number(d)));
  if (!Number.isFinite(date.getTime())) return null;
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
  return Number.isFinite(weekNo) && weekNo > 0 ? weekNo : null;
}

function isoWeekFromYmd(ymd) {
  const m = String(ymd || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return isoWeekFromParts(Number(m[1]), Number(m[2]), Number(m[3]));
}

function isoWeekFromMs(ms) {
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
    return isoWeekFromParts(y, mo, d);
  } catch (e) {
    return null;
  }
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
  isoWeekFromParts,
  isoWeekFromYmd,
  isoWeekFromMs,
  parseStoredHafta,
  resolveHafta,
  haftaLabel,
  normalizeCikanlarInsert,
};
