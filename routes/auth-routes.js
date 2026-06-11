'use strict';

const jwt = require('jsonwebtoken');

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
    ipRequestCount,
    RATE_LIMIT_WINDOW_MS,
    FAILED_LOGIN_THRESHOLD,
    banIp,
    AUTH_COOKIE_NAME,
    AUTH_COOKIE_OPTIONS,
    JWT_SECRET,
    AUTH_SESSION_EXPIRES,
  } = ctx;

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
      return res.json({ ok: true, user: r.user });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e && e.message ? e.message : String(e) });
    }
  });

  api.get('/me', auth.verifyToken, async (req, res) => {
    try {
      const u = req.user;
      if (u && u.username) {
        const payload = { id: u.id, username: u.username, role: u.role || null };
        const token = jwt.sign(payload, JWT_SECRET, { expiresIn: AUTH_SESSION_EXPIRES });
        try {
          res.cookie(AUTH_COOKIE_NAME, token, AUTH_COOKIE_OPTIONS);
        } catch (e) { /* ignore */ }
      }
      return res.json({ ok: true, user: req.user });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e && e.message ? e.message : String(e) });
    }
  });

  api.post('/logout', (req, res) => {
    try {
      res.cookie(AUTH_COOKIE_NAME, '', Object.assign({}, AUTH_COOKIE_OPTIONS, { maxAge: 0 }));
    } catch (e) { /* ignore */ }
    return res.json({ ok: true });
  });
}

module.exports = { registerAuthRoutes };
