'use strict';

const jwt = require('jsonwebtoken');

const AUTH_COOKIE_NAMES = ['auth_token', 'token'];

/**
 * @param {import('express').Request} req
 * @param {string} [primaryCookieName]
 */
function extractAuthTokenFromRequest(req, primaryCookieName = 'auth_token') {
  const authHeader = req.headers.authorization || req.headers.Authorization;
  if (authHeader && typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }
  if (req.headers && req.headers.cookie && typeof req.headers.cookie === 'string') {
    const cookies = req.headers.cookie.split(';').map((s) => s.trim());
    for (const c of cookies) {
      const idx = c.indexOf('=');
      if (idx <= 0) continue;
      const k = c.slice(0, idx).trim();
      const v = c.slice(idx + 1).trim();
      if (k === primaryCookieName || AUTH_COOKIE_NAMES.includes(k)) {
        return decodeURIComponent(v);
      }
    }
  }
  return null;
}

/**
 * @param {{ jwtSecret: string, authSessionHours: number, cookieName?: string }} opts
 */
function createAuthSessionMiddleware(opts) {
  const jwtSecret = opts.jwtSecret;
  const cookieName = opts.cookieName || 'auth_token';
  const sessionWarnSec = Math.min(
    1800,
    Math.max(300, Math.floor(opts.authSessionHours * 3600 * 0.1))
  );

  function requireValidSession(req, res, next) {
    let decoded = req.user;

    if (!decoded) {
      const token = extractAuthTokenFromRequest(req, cookieName);
      if (!token) {
        return res.status(401).json({
          error: 'Session required',
          code: 'SESSION_MISSING',
          message: 'Oturum süreniz dolmuş. Lütfen tekrar giriş yapınız.',
        });
      }
      try {
        decoded = jwt.verify(token, jwtSecret);
        req.user = decoded;
      } catch (jwtError) {
        console.error('Session validation error:', jwtError.message);
        return res.status(401).json({
          error: 'Invalid session',
          code: 'SESSION_INVALID',
          message: 'Oturum geçersiz. Lütfen tekrar giriş yapınız.',
        });
      }
    }

    const now = Math.floor(Date.now() / 1000);
    const exp = decoded.exp || 0;
    const timeUntilExpiry = exp - now;

    if (timeUntilExpiry <= 0) {
      return res.status(401).json({
        error: 'Session expired',
        code: 'SESSION_EXPIRED',
        message: 'Oturum süreniz dolmuş. Lütfen tekrar giriş yapınız.',
      });
    }

    if (timeUntilExpiry <= sessionWarnSec) {
      res.setHeader('X-Session-Warning', 'Session expiring soon');
    }

    req.user = decoded;
    req.sessionExpiresIn = timeUntilExpiry;
    next();
  }

  function requireAdmin(req, res, next) {
    requireValidSession(req, res, () => {
      const role = req.user && req.user.role;
      if (role === 'admin') return next();
      return res.status(403).json({
        ok: false,
        error: 'Admin yetkisi gerekli',
        code: 'ADMIN_REQUIRED',
      });
    });
  }

  const PUBLIC_WRITE_PATHS = new Set(['/login', '/logout']);

  function requireMutatingSession(req, res, next) {
    const method = req.method.toUpperCase();
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) return next();
    if (PUBLIC_WRITE_PATHS.has(req.path)) return next();
    return requireValidSession(req, res, next);
  }

  return {
    extractAuthTokenFromRequest,
    requireValidSession,
    requireAdmin,
    requireMutatingSession,
  };
}

module.exports = { extractAuthTokenFromRequest, createAuthSessionMiddleware };
