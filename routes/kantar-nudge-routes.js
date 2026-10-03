'use strict';

const { createNudgeStore, siteFromUsername } = require('../lib/kantar-nudge');

function registerKantarNudgeRoutes(api, ctx) {
  const { sendApiError, requireValidSession, requireAmir, sanitizeString, broadcastEvent, presence } = ctx;
  const store = ctx.nudgeStore || createNudgeStore();

  function touchPresence(req) {
    try {
      if (presence && req && req.user) presence.touch(req.user);
    } catch (e) { /* ignore */ }
  }

  api.post('/nudge', requireAmir, (req, res) => {
    try {
      touchPresence(req);
      const target = sanitizeString((req.body && req.body.target) || '', 20);
      const snapshot = presence && typeof presence.snapshot === 'function' ? presence.snapshot() : [];
      const result = store.send(target, snapshot, 'AMİR');
      if (!result.ok) {
        if (result.code === 'OFFLINE') {
          return res.status(409).json({ ok: false, code: 'OFFLINE', error: 'Hedef çevrimdışı' });
        }
        if (result.code === 'COOLDOWN') {
          return res.status(429).json({ ok: false, code: 'COOLDOWN', error: 'Biraz bekleyin', retryAfter: result.retryAfter });
        }
        return res.status(400).json({ ok: false, code: 'BAD_TARGET', error: 'Hedef AVDAN veya 1.OSB olmalı' });
      }
      try { if (typeof broadcastEvent === 'function') broadcastEvent('kantar_nudge', result.nudge); } catch (e) { /* ignore */ }
      return res.json({ ok: true, nudge: result.nudge });
    } catch (err) {
      return sendApiError(res, err, 500, 'NUDGE_SEND_FAILED');
    }
  });

  api.get('/nudge', requireValidSession, (req, res) => {
    try {
      touchPresence(req);
      const site = siteFromUsername(req.user && req.user.username);
      const since = Number((req.query && req.query.since) || 0);
      res.setHeader('Cache-Control', 'no-store');
      return res.json({ ok: true, nudge: site ? store.pending(site, since) : null });
    } catch (err) {
      return sendApiError(res, err, 500, 'NUDGE_READ_FAILED');
    }
  });
}

module.exports = { registerKantarNudgeRoutes };
