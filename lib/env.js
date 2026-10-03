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
 * Production'da boş / yasaklı değer yerine `deriveFrom` (ör. DATABASE_URL) üzerinden
 * türetilmiş gizli değer kullanır; deriveFrom da yoksa durur.
 * Diğer ortamlarda fallback döner.
 */
function resolveSecret(name, { fallback = '', forbidden = [], deriveFrom = '' } = {}) {
  const raw = process.env[name];
  const value = raw == null || String(raw).trim() === '' ? '' : String(raw);
  const bad = !value || forbidden.indexOf(value) !== -1;
  if (process.env.NODE_ENV === 'production' && bad) {
    const seed = String(deriveFrom || '');
    if (!seed) throw new Error(name + ' must be set to a non-default value in production');
    console.error('[security] ' + name + ' tanımlı değil; DATABASE_URL üzerinden türetilen değer kullanılıyor. Railway Variables içine ' + name + ' ekleyin.');
    return require('crypto').createHash('sha256').update(name + ':' + seed).digest('hex');
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
