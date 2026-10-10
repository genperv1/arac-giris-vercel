'use strict';

const { canDirectMessage } = require('../lib/amir-user');
const {
  createNudgeStore,
  inboxKeyFromUsername,
  isKantarTarget,
  nudgeTarget,
} = require('../lib/kantar-nudge');

function senderLabel(username) {
  const id = String(username || '').trim().toLowerCase();
  if (id === 'saban') return 'ŞABAN LAHAÇLAR';
  if (id === 'ugur') return 'UĞUR AKTAŞ';
  if (id === 'xxr') return 'SELAHATTİN TOKER';
  if (id === 'burak') return 'BURAK KARATAŞ';
  return 'AMİR';
}

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
      const target = nudgeTarget(sanitizeString((req.body && req.body.target) || '', 20));
      const mine = inboxKeyFromUsername(req.user && req.user.username);
      if (target && mine && target === mine) {
        return res.status(400).json({ ok: false, code: 'SELF', error: 'Kendinize mesaj gönderilemez' });
      }
      if (target && !isKantarTarget(target) && !canDirectMessage(req.user)) {
        return res.status(403).json({ ok: false, code: 'FORBIDDEN', error: 'Bu hesaptan özel mesaj gönderilemez' });
      }
      const snapshot = presence && typeof presence.snapshot === 'function' ? presence.snapshot() : [];
      const text = sanitizeString((req.body && req.body.text) || '', 240);
      const result = store.send(
        target,
        snapshot,
        senderLabel(req.user && req.user.username),
        text,
        mine
      );
      if (!result.ok) {
        if (result.code === 'OFFLINE') {
          return res.status(409).json({ ok: false, code: 'OFFLINE', error: 'Hedef çevrimdışı' });
        }
        if (result.code === 'COOLDOWN') {
          return res.status(429).json({ ok: false, code: 'COOLDOWN', error: 'Biraz bekleyin', retryAfter: result.retryAfter });
        }
        if (result.code === 'BAD_TEXT') {
          return res.status(400).json({ ok: false, code: 'BAD_TEXT', error: 'Mesaj yazın' });
        }
        return res.status(400).json({ ok: false, code: 'BAD_TARGET', error: 'Hedef bulunamadı' });
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
      const site = inboxKeyFromUsername(req.user && req.user.username);
      const since = Number((req.query && req.query.since) || 0);
      res.setHeader('Cache-Control', 'no-store');
      return res.json({ ok: true, nudge: site ? store.pending(site, since) : null });
    } catch (err) {
      return sendApiError(res, err, 500, 'NUDGE_READ_FAILED');
    }
  });

  api.post('/nudge/ack', requireValidSession, (req, res) => {
    try {
      touchPresence(req);
      const site = inboxKeyFromUsername(req.user && req.user.username);
      const id = sanitizeString((req.body && req.body.id) || '', 64);
      const result = site ? store.ack(site, id) : { ok: false };
      if (!result.ok) return res.status(404).json({ ok: false, code: 'NOT_FOUND', error: 'Çağrı bulunamadı' });
      try { if (typeof broadcastEvent === 'function') broadcastEvent('kantar_nudge_ack', result.nudge); } catch (e) { /* ignore */ }
      return res.json({ ok: true, nudge: result.nudge });
    } catch (err) {
      return sendApiError(res, err, 500, 'NUDGE_ACK_FAILED');
    }
  });

  api.get('/nudge/status', requireAmir, (req, res) => {
    try {
      res.setHeader('Cache-Control', 'no-store');
      return res.json({ ok: true, status: store.status() });
    } catch (err) {
      return sendApiError(res, err, 500, 'NUDGE_STATUS_FAILED');
    }
  });
}

module.exports = { registerKantarNudgeRoutes };
