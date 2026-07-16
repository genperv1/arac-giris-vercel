'use strict';

function sanitizeString(input, maxLength = 1000) {
  if (!input) return '';
  let str = String(input).trim();
  if (str.length > maxLength) {
    str = str.substring(0, maxLength);
  }
  return str;
}

function validateEmail(email) {
  if (!email) return true;
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(String(email).trim());
}

function validatePhoneNumber(phone) {
  if (!phone) return true;
  return String(phone).trim().length <= 30;
}

function validateTCNumber(tc) {
  if (!tc) return true;
  const s = String(tc).trim();
  // Boş veya eksik TC taslak kayıt olarak kabul edilir
  return /^\d{0,11}$/.test(s);
}

function parseDateOrEpoch(value) {
  const s = String(value || '').trim();
  if (!s) return null;
  if (/^\d+$/.test(s)) {
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }
  const m = s.match(/^(\d{2})\.(\d{2})\.(\d{4}) (\d{2}):(\d{2}):(\d{2})$/);
  if (m) {
    const ms = Date.parse(`${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5]}:${m[6]}`);
    return Number.isFinite(ms) ? ms : null;
  }
  return null;
}

module.exports = {
  sanitizeString,
  validateEmail,
  validatePhoneNumber,
  validateTCNumber,
  parseDateOrEpoch,
};
