'use strict';

const { createMailboxStore, MAIL_KEYS } = require('../lib/mailbox-store');
const { inboxKeyFromUsername } = require('../lib/kantar-nudge');

function registerMailboxRoutes(api, ctx) {
  const { sendApiError, requireValidSession, sanitizeString, broadcastToUsers, presence } = ctx;
  const store = ctx.mailboxStore || createMailboxStore();

  function touchPresence(req) {
    try {
      if (presence && req && req.user) presence.touch(req.user);
    } catch (e) { /* ignore */ }
  }

  function mine(req) {
    return inboxKeyFromUsername(req.user && req.user.username);
  }

  function fail(res, result) {
    if (result.code === 'COOLDOWN') {
      return res.status(429).json({ ok: false, code: 'COOLDOWN', error: 'Biraz bekleyin', retryAfter: result.retryAfter });
    }
    if (result.code === 'BAD_TEXT') {
      return res.status(400).json({ ok: false, code: 'BAD_TEXT', error: 'Mesaj yazın' });
    }
    if (result.code === 'BAD_SUBJECT') {
      return res.status(400).json({ ok: false, code: 'BAD_SUBJECT', error: 'Konu yazın' });
    }
    if (result.code === 'SELF') {
      return res.status(400).json({ ok: false, code: 'SELF', error: 'Kendinize mesaj gönderilemez' });
    }
    if (result.code === 'MISSING') {
      return res.status(404).json({ ok: false, code: 'MISSING', error: 'Konu bulunamadı' });
    }
    return res.status(400).json({ ok: false, code: result.code || 'BAD_TARGET', error: 'Hedef bulunamadı' });
  }

  function fan(type, data) {
    try {
      if (typeof broadcastToUsers === 'function') broadcastToUsers(type, data, MAIL_KEYS);
    } catch (e) { /* ignore */ }
  }

  api.post('/mailbox', requireValidSession, (req, res) => {
    try {
      touchPresence(req);
      const body = req.body || {};
      const result = store.open(
        mine(req),
        sanitizeString(body.to || '', 20),
        sanitizeString(body.subject || '', 80),
        sanitizeString(body.text || '', 400),
        sanitizeString(body.kind || '', 12),
        sanitizeString(body.page || '', 120),
      );
      if (!result.ok) return fail(res, result);
      fan('mailbox_opened', result.thread);
      return res.json({ ok: true, thread: result.thread });
    } catch (err) {
      return sendApiError(res, err, 500, 'MAILBOX_OPEN_FAILED');
    }
  });

  api.post('/mailbox/reply', requireValidSession, (req, res) => {
    try {
      touchPresence(req);
      const body = req.body || {};
      const result = store.reply(
        mine(req),
        sanitizeString(body.id || '', 80),
        sanitizeString(body.text || '', 400),
      );
      if (!result.ok) return fail(res, result);
      fan('mailbox_reply', result.thread);
      return res.json({ ok: true, thread: result.thread });
    } catch (err) {
      return sendApiError(res, err, 500, 'MAILBOX_REPLY_FAILED');
    }
  });

  api.post('/mailbox/read', requireValidSession, (req, res) => {
    try {
      touchPresence(req);
      const id = sanitizeString((req.body && req.body.id) || '', 80);
      const result = store.markRead(mine(req), id);
      if (!result.ok) return fail(res, result);
      return res.json({ ok: true, read: result.read });
    } catch (err) {
      return sendApiError(res, err, 500, 'MAILBOX_READ_FAILED');
    }
  });

  api.get('/mailbox', requireValidSession, (req, res) => {
    try {
      touchPresence(req);
      res.setHeader('Cache-Control', 'no-store');
      return res.json({
        ok: true,
        threads: store.list(),
        clearedAt: store.clearedAt(),
      });
    } catch (err) {
      return sendApiError(res, err, 500, 'MAILBOX_LIST_FAILED');
    }
  });

  function requireBurak(req, res, next) {
    requireValidSession(req, res, () => {
      if (mine(req) === 'BURAK') return next();
      return res.status(403).json({
        ok: false,
        code: 'BURAK_REQUIRED',
        error: 'Mesajı yalnız Burak K. silebilir',
      });
    });
  }

  api.post('/mailbox/remove', requireBurak, (req, res) => {
    try {
      touchPresence(req);
      const id = sanitizeString((req.body && req.body.id) || '', 80);
      const result = store.remove(id);
      if (!result.ok) return fail(res, result);
      fan('mailbox_removed', { id: result.id });
      return res.json({ ok: true, id: result.id });
    } catch (err) {
      return sendApiError(res, err, 500, 'MAILBOX_REMOVE_FAILED');
    }
  });
}

module.exports = { registerMailboxRoutes };
