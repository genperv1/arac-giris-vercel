'use strict';

const READ_RETRY_CODES = new Set([
  'ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'ECONNRESET', 'EPIPE',
  '08006', '08001', '08003', '57P01', '57P02', '57P03', '40001',
]);

const CONNECTION_DROP_CODES = new Set([
  'ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'ECONNRESET', 'EPIPE',
  '08006', '08001', '08003', '57P01', '57P02', '57P03',
]);

function errorCode(err) {
  return String((err && err.code) || '').toUpperCase();
}

function isConnectionDrop(err) {
  const code = errorCode(err);
  const msg = String((err && err.message) || '');
  return CONNECTION_DROP_CODES.has(code)
    || /Connection terminated|Connection ended|server closed the connection/i.test(msg);
}

function isRetryableDbError(err) {
  const code = errorCode(err);
  const msg = String((err && err.message) || '');
  return READ_RETRY_CODES.has(code) || /Connection terminated|terminat|reset/i.test(msg);
}

function isReadOnlyQuery(text) {
  const sql = String(text || '').trim().toUpperCase();
  return sql.startsWith('SELECT') || sql.startsWith('WITH');
}

/**
 * Okuma: geçici ve serileştirme hatalarında yeniden dener.
 * Yazma: yalnız bağlantı koptuysa bir kez daha dener. Sorgu metnini ve parametreyi yazmaz.
 */
async function retryQuery(queryFn, maxRetries = 3, baseDelay = 250, options = {}) {
  const allow = typeof options.allow === 'function' ? options.allow : isRetryableDbError;
  const sleep = typeof options.sleep === 'function'
    ? options.sleep
    : (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const warn = typeof options.warn === 'function' ? options.warn : null;
  const attempts = Math.max(1, Number(maxRetries) || 1);
  let lastErr = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await queryFn();
    } catch (err) {
      lastErr = err;
      const retryable = allow(err) === true;
      if (attempt >= attempts || !retryable) throw err;
      const delay = Math.round((baseDelay * (2 ** (attempt - 1))) + Math.random() * 150);
      if (warn) warn(attempt, attempts, delay, errorCode(err) || 'db');
      await sleep(delay);
    }
  }
  throw lastErr;
}

module.exports = {
  isConnectionDrop,
  isRetryableDbError,
  isReadOnlyQuery,
  retryQuery,
  errorCode,
};
