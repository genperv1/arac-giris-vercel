'use strict';

const jwt = require('jsonwebtoken');
const { extractAuthTokenFromRequest } = require('../lib/auth-session');
const { isAmirIdentity } = require('../lib/amir-user');

/** Cihaz anahtarı çerezi yalnız bu yola gider; başka API isteğiyle sızmaz. */
const DEVICE_COOKIE_NAME = 'kantar_device';
const DEVICE_COOKIE_PATH = '/api/session';

function readCookie(req, name) {
  const header = req && req.headers && req.headers.cookie;
  if (!header || typeof header !== 'string') return '';
  const parts = header.split(';');
  for (let i = 0; i < parts.length; i++) {
    const c = parts[i].trim();
    const idx = c.indexOf('=');
    if (idx <= 0) continue;
    if (c.slice(0, idx).trim() === name) {
      try { return decodeURIComponent(c.slice(idx + 1).trim()); } catch (_) { return c.slice(idx + 1).trim(); }
    }
  }
  return '';
}

/**
 * @param {import('express').Router} api
 * @param {object} ctx
 */
function registerAuthRoutes(api, ctx) {
  const {
    auth,
    loginEndpointLimiter,
    normalizeClientIp,
    getClientIp,
    resolveClientSite,
    ipRequestCount,
    RATE_LIMIT_WINDOW_MS,
    FAILED_LOGIN_THRESHOLD,
    banIp,
    AUTH_COOKIE_NAME,
    AUTH_COOKIE_OPTIONS,
    JWT_SECRET,
    AUTH_SESSION_EXPIRES,
    presence,
    deviceTokens,
    requireAmir,
  } = ctx;
  const REMOVED_USERS = new Set(['GENPER']);

  function deviceCookieOptions(maxAgeMs) {
    return {
      httpOnly: true,
      secure: !!(AUTH_COOKIE_OPTIONS && AUTH_COOKIE_OPTIONS.secure),
      sameSite: 'lax',
      path: DEVICE_COOKIE_PATH,
      maxAge: maxAgeMs,
    };
  }

  function clearDeviceCookie(res) {
    try { res.cookie(DEVICE_COOKIE_NAME, '', deviceCookieOptions(0)); } catch (e) { /* ignore */ }
  }

  function signSession(user) {
    const payload = { id: user.id, username: user.username, role: user.role || null };
    return jwt.sign(payload, JWT_SECRET, { expiresIn: AUTH_SESSION_EXPIRES });
  }

  /** Kantar hesabına (amir değil) hatırlanan cihaz anahtarı ver. */
  async function issueDeviceCookie(req, res, user) {
    if (!deviceTokens || !user || isAmirIdentity(user)) return null;
    try {
      const ip = normalizeClientIp(getClientIp(req));
      const issued = await deviceTokens.issue(user.username, {
        ip,
        userAgent: String(req.headers['user-agent'] || ''),
        label: String(user.username || '') + ' kantar PC',
      });
      res.cookie(DEVICE_COOKIE_NAME, issued.raw, deviceCookieOptions(deviceTokens.ttlMs));
      return issued;
    } catch (e) {
      console.warn('[device-token] üretilemedi:', e && e.message ? e.message : e);
      return null;
    }
  }

  api.post('/login', loginEndpointLimiter, async (req, res) => {
    try {
      const ip = normalizeClientIp(getClientIp(req));
      const body = req.body || {};
      const username = String(body.username || '').trim();
      const password = String(body.password || '');

      if (!username || !password) {
        const ipData = ipRequestCount.get(ip) || { count: 0, resetTime: Date.now() + RATE_LIMIT_WINDOW_MS, failedLogins: 0 };
        ipData.failedLogins++;
        ipRequestCount.set(ip, ipData);
        return res.status(400).json({ ok: false, error: 'username and password required' });
      }

      const r = await auth.authenticateUser(username, password);
      if (!r.ok) {
        const ipData = ipRequestCount.get(ip) || { count: 0, resetTime: Date.now() + RATE_LIMIT_WINDOW_MS, failedLogins: 0 };
        ipData.failedLogins++;
        ipRequestCount.set(ip, ipData);

        if (ipData.failedLogins >= FAILED_LOGIN_THRESHOLD) {
          banIp(ip, `Failed login attempts exceeded (${ipData.failedLogins})`);
          return res.status(403).json({
            ok: false,
            error: 'Çok sayıda hatalı giriş nedeniyle IP adresiniz geçici olarak engellendi. Ayarlar > Ban bölümünden kaldırılabilir.',
            code: 'IP_BANNED',
          });
        }

        return res.status(401).json({ ok: false, error: 'invalid credentials' });
      }

      const ipData = ipRequestCount.get(ip);
      if (ipData) {
        ipData.failedLogins = 0;
        ipRequestCount.set(ip, ipData);
      }

      try {
        res.cookie(AUTH_COOKIE_NAME, r.token, AUTH_COOKIE_OPTIONS);
      } catch (e) { /* ignore */ }
      const device = await issueDeviceCookie(req, res, r.user);
      const { clientIp, clientSite } = resolveClientSite(ip, r.user && r.user.role);
      if (presence) presence.touch(r.user);
      return res.json({ ok: true, user: r.user, clientIp, clientSite, rememberedDevice: !!device });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e && e.message ? e.message : String(e) });
    }
  });

  /**
   * Oturum çerezi düştüğünde şifresiz yenileme (kantar PC).
   * Cihaz çerezi yok/iptal/süresi dolmuş → 401 ve istemci şifre ekranına döner.
   */
  api.post('/session/renew', async (req, res) => {
    try {
      res.setHeader('Cache-Control', 'no-store');
      if (!deviceTokens) return res.status(401).json({ ok: false, code: 'DEVICE_DISABLED', error: 'Cihaz hatırlama kapalı.' });
      const raw = readCookie(req, DEVICE_COOKIE_NAME);
      if (!raw) return res.status(401).json({ ok: false, code: 'DEVICE_MISSING', error: 'Bu cihaz hatırlanmıyor; şifreyle giriş yapın.' });
      const dev = await deviceTokens.verify(raw);
      if (!dev) {
        clearDeviceCookie(res);
        return res.status(401).json({ ok: false, code: 'DEVICE_INVALID', error: 'Cihaz anahtarı geçersiz veya iptal edilmiş; şifreyle giriş yapın.' });
      }
      if (REMOVED_USERS.has(String(dev.username || ''))) {
        clearDeviceCookie(res);
        return res.status(401).json({ ok: false, code: 'USER_REMOVED', error: 'Bu kullanıcı kaldırıldı.' });
      }
      const userRow = await auth.findUser(dev.username);
      if (!userRow) {
        clearDeviceCookie(res);
        return res.status(401).json({ ok: false, code: 'USER_MISSING', error: 'Kullanıcı bulunamadı.' });
      }
      const user = { id: userRow.id, username: userRow.username, role: userRow.role || null };
      const ip = normalizeClientIp(getClientIp(req));
      try { await deviceTokens.touch(dev.id, { ip, userAgent: String(req.headers['user-agent'] || '') }); } catch (e) { /* ignore */ }
      try { res.cookie(AUTH_COOKIE_NAME, signSession(user), AUTH_COOKIE_OPTIONS); } catch (e) { /* ignore */ }
      const { clientIp, clientSite } = resolveClientSite(ip, user.role);
      if (presence) presence.touch(user);
      return res.json({ ok: true, user, clientIp, clientSite, renewed: true, device: { id: dev.id, label: dev.label, expiresAt: dev.expiresAt } });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e && e.message ? e.message : String(e) });
    }
  });

  /** Bu cihazı unut (kantar PC'den): cihaz anahtarı iptal + çerez silinir. Oturum açık kalır. */
  api.post('/session/forget', async (req, res) => {
    try {
      const raw = readCookie(req, DEVICE_COOKIE_NAME);
      if (raw && deviceTokens) {
        const dev = await deviceTokens.verify(raw);
        if (dev) await deviceTokens.revoke(dev.id);
      }
      clearDeviceCookie(res);
      return res.json({ ok: true });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e && e.message ? e.message : String(e) });
    }
  });

  /** Amir: hatırlanan cihazlar listesi / iptal. */
  if (typeof requireAmir === 'function') {
    api.get('/session/devices', requireAmir, async (req, res) => {
      try {
        res.setHeader('Cache-Control', 'no-store');
        const devices = deviceTokens ? await deviceTokens.list() : [];
        return res.json({ ok: true, devices, days: deviceTokens ? deviceTokens.days : 0 });
      } catch (e) {
        return res.status(500).json({ ok: false, error: e && e.message ? e.message : String(e) });
      }
    });

    api.delete('/session/devices/:id', requireAmir, async (req, res) => {
      try {
        if (!deviceTokens) return res.status(404).json({ ok: false, error: 'Cihaz hatırlama kapalı.' });
        const id = String(req.params.id || '').trim();
        const okRevoke = await deviceTokens.revoke(id);
        return res.json({ ok: true, revoked: okRevoke });
      } catch (e) {
        return res.status(500).json({ ok: false, error: e && e.message ? e.message : String(e) });
      }
    });

    api.post('/session/devices/revoke-user', requireAmir, async (req, res) => {
      try {
        if (!deviceTokens) return res.status(404).json({ ok: false, error: 'Cihaz hatırlama kapalı.' });
        const username = String((req.body && req.body.username) || '').trim();
        if (!username) return res.status(400).json({ ok: false, error: 'username gerekli' });
        const n = await deviceTokens.revokeAllForUser(username);
        return res.json({ ok: true, revoked: n });
      } catch (e) {
        return res.status(500).json({ ok: false, error: e && e.message ? e.message : String(e) });
      }
    });
  }

  api.get('/me', auth.verifyToken, async (req, res) => {
    try {
      const u = req.user;
      if (u && REMOVED_USERS.has(String(u.username || ''))) {
        try {
          res.cookie(AUTH_COOKIE_NAME, '', Object.assign({}, AUTH_COOKIE_OPTIONS, { maxAge: 0 }));
        } catch (e) { /* ignore */ }
        return res.status(401).json({ ok: false, error: 'Bu kullanıcı kaldırıldı. AVDAN veya 1.OSB ile giriş yapın.' });
      }
      if (presence) presence.touch(u);
      const ip = normalizeClientIp(getClientIp(req));
      const { clientIp, clientSite } = resolveClientSite(ip, u && u.role);
      if (u && u.username) {
        const payload = { id: u.id, username: u.username, role: u.role || null };
        const token = jwt.sign(payload, JWT_SECRET, { expiresIn: AUTH_SESSION_EXPIRES });
        try {
          res.cookie(AUTH_COOKIE_NAME, token, AUTH_COOKIE_OPTIONS);
        } catch (e) { /* ignore */ }
      }
      return res.json({ ok: true, user: req.user, clientIp, clientSite });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e && e.message ? e.message : String(e) });
    }
  });

  api.post('/logout', (req, res) => {
    try {
      const token = extractAuthTokenFromRequest(req, AUTH_COOKIE_NAME);
      const decoded = token ? jwt.verify(token, JWT_SECRET) : null;
      if (presence && decoded && decoded.username) presence.remove(decoded.username);
    } catch (e) { /* ignore */ }
    try {
      res.cookie(AUTH_COOKIE_NAME, '', Object.assign({}, AUTH_COOKIE_OPTIONS, { maxAge: 0 }));
    } catch (e) { /* ignore */ }
    return res.json({ ok: true });
  });
}

module.exports = { registerAuthRoutes, DEVICE_COOKIE_NAME, DEVICE_COOKIE_PATH };
