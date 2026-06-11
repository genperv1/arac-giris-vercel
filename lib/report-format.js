'use strict';

const REPORT_DISPLAY_TZ = process.env.REPORT_DISPLAY_TZ || 'Europe/Istanbul';

function formatReportInstant(ms) {
  const n = Number(ms);
  const d = new Date(n);
  if (!Number.isFinite(n) || isNaN(d.getTime())) return { tarih: '', saat: '' };
  const tz = REPORT_DISPLAY_TZ;
  const tarih = d.toLocaleDateString('tr-TR', { timeZone: tz });
  const saat = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    hourCycle: 'h23',
  }).format(d);
  return { tarih, saat };
}

function istanbulMinutesFromTs(tsMs) {
  try {
    const d = new Date(Number(tsMs));
    if (isNaN(d.getTime())) return null;
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: REPORT_DISPLAY_TZ,
      hour: 'numeric',
      minute: 'numeric',
      hour12: false,
      hourCycle: 'h23',
    }).formatToParts(d);
    const h = parseInt((parts.find((p) => p.type === 'hour') || {}).value, 10);
    const m = parseInt((parts.find((p) => p.type === 'minute') || {}).value, 10);
    if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
    return h * 60 + m;
  } catch (e) {
    return null;
  }
}

module.exports = { formatReportInstant, istanbulMinutesFromTs, REPORT_DISPLAY_TZ };
