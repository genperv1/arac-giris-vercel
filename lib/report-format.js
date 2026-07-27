'use strict';

const REPORT_DISPLAY_TZ = process.env.REPORT_DISPLAY_TZ || 'Europe/Istanbul';

// Reuse formatters across thousands of rows (creating Intl per call is expensive).
let _tarihFmt = null;
let _saatFmt = null;
let _minsFmt = null;
let _fmtTz = null;

function ensureFormatters() {
  if (_fmtTz === REPORT_DISPLAY_TZ && _tarihFmt && _saatFmt && _minsFmt) return;
  _fmtTz = REPORT_DISPLAY_TZ;
  _tarihFmt = new Intl.DateTimeFormat('tr-TR', {
    timeZone: REPORT_DISPLAY_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  _saatFmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: REPORT_DISPLAY_TZ,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    hourCycle: 'h23'
  });
  _minsFmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: REPORT_DISPLAY_TZ,
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
    hourCycle: 'h23'
  });
}

function formatReportInstant(ms) {
  const n = Number(ms);
  const d = new Date(n);
  if (!Number.isFinite(n) || isNaN(d.getTime())) return { tarih: '', saat: '' };
  ensureFormatters();
  return { tarih: _tarihFmt.format(d), saat: _saatFmt.format(d) };
}

function istanbulMinutesFromTs(tsMs) {
  try {
    const d = new Date(Number(tsMs));
    if (isNaN(d.getTime())) return null;
    ensureFormatters();
    const parts = _minsFmt.formatToParts(d);
    const h = parseInt((parts.find((p) => p.type === 'hour') || {}).value, 10);
    const m = parseInt((parts.find((p) => p.type === 'minute') || {}).value, 10);
    if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
    return h * 60 + m;
  } catch (e) {
    return null;
  }
}

module.exports = { formatReportInstant, istanbulMinutesFromTs, REPORT_DISPLAY_TZ };
