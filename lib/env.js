'use strict';

function envNumber(name, fallback, { min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER } = {}) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    throw new Error(`Invalid env ${name}: ${raw}`);
  }
  return parsed;
}

/**
 * Production'da boş veya yasaklı sır kabul edilmez. Veritabanı adresinden türetilmez.
 * Diğer ortamlarda fallback döner.
 */
function resolveSecret(name, { fallback = '', forbidden = [] } = {}) {
  const raw = process.env[name];
  const value = raw == null || String(raw).trim() === '' ? '' : String(raw);
  const bad = !value || forbidden.indexOf(value) !== -1;
  if (process.env.NODE_ENV === 'production' && bad) {
    throw new Error(name + ' must be set to a non-default value in production. Do not derive it from DATABASE_URL.');
  }
  if (process.env.NODE_ENV === 'production' && value.length < 32) {
    console.error('[security] ' + name + ' 32 karakterden kısa. Railway Variables içinde uzun ve rastgele bir değer kullanın.');
  }
  return value || fallback;
}

function warnIfDefaultSecret(name, value, defaults) {
  if (process.env.NODE_ENV !== 'production') return false;
  const list = Array.isArray(defaults) ? defaults : [defaults];
  if (list.indexOf(String(value || '')) === -1) return false;
  console.error('[security] ' + name + ' hâlâ varsayılan paylaşılan şifre. Ortam değişkeninden değiştirin.');
  return true;
}

module.exports = { envNumber, resolveSecret, warnIfDefaultSecret };
