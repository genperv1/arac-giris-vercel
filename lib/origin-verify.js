'use strict';

const crypto = require('crypto');

/** Cloudflare Transform Rule bu başlığı origin'e ekler. Sorgu dizesinden okunmaz. */
const HEADER = 'x-origin-verify';
const MIN_SECRET_BYTES = 32;
const MODES = new Set(['off', 'log', 'enforce']);

function normalizeMode(mode) {
  const value = String(mode || '').trim().toLowerCase();
  return MODES.has(value) ? value : 'off';
}

function secretIsValid(secret) {
  return Buffer.byteLength(String(secret || ''), 'utf8') >= MIN_SECRET_BYTES;
}

function requestPath(req) {
  const raw = String((req && (req.originalUrl || req.url)) || '/');
  const pathOnly = raw.split('?')[0] || '/';
  if (pathOnly.length > 1 && pathOnly.endsWith('/')) return pathOnly.replace(/\/+$/, '') || '/';
  return pathOnly;
}

/**
 * Railway healthcheck yalnız GET/HEAD /health.
 * Host, X-Forwarded-* ve Cloudflare başlıkları muafiyet değildir.
 */
function isHealthProbe(req) {
  const method = String((req && req.method) || '').toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') return false;
  return requestPath(req) === '/health';
}

function headerValue(req) {
  const raw = req && req.headers ? req.headers[HEADER] : undefined;
  if (typeof raw !== 'string') return '';
  return raw;
}

function secretsMatch(expected, provided) {
  const want = Buffer.from(String(expected || ''), 'utf8');
  const got = Buffer.from(String(provided || ''), 'utf8');
  if (want.length < MIN_SECRET_BYTES) return false;
  if (got.length !== want.length) {
    crypto.timingSafeEqual(Buffer.alloc(want.length), want);
    return false;
  }
  return crypto.timingSafeEqual(got, want);
}

function createOriginVerifyMiddleware(opts) {
  const mode = normalizeMode(opts && opts.mode);
  const secret = opts && opts.secret != null ? String(opts.secret) : '';
  const log = typeof (opts && opts.log) === 'function'
    ? opts.log
    : (fmt, ...args) => console.warn(fmt, ...args);
  const valid = secretIsValid(secret);
  let configLogged = false;

  return function originVerify(req, res, next) {
    if (mode === 'off') return next();
    if (isHealthProbe(req)) return next();

    if (!valid) {
      if (!configLogged) {
        configLogged = true;
        log('[origin-verify] result=config mode=%s', mode);
      }
      if (mode === 'enforce') {
        return res.status(403).json({ ok: false, code: 'ORIGIN_VERIFY_FAILED' });
      }
      return next();
    }

    const given = headerValue(req);
    let result = 'ok';
    if (!given) result = 'missing';
    else if (!secretsMatch(secret, given)) result = 'mismatch';

    if (result !== 'ok') {
      log(
        '[origin-verify] result=%s method=%s path=%s',
        result,
        String(req.method || '').toUpperCase(),
        requestPath(req).slice(0, 200)
      );
      if (mode === 'enforce') {
        return res.status(403).json({ ok: false, code: 'ORIGIN_VERIFY_FAILED' });
      }
    }
    return next();
  };
}

module.exports = {
  HEADER,
  MIN_SECRET_BYTES,
  createOriginVerifyMiddleware,
  normalizeMode,
  secretIsValid,
  secretsMatch,
  isHealthProbe,
};
