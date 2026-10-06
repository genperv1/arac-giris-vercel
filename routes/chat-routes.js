'use strict';

const { createChatStore } = require('../lib/chat-store');
const { inboxKeyFromUsername, isKantarTarget } = require('../lib/kantar-nudge');

function registerChatRoutes(api, ctx) {
  const { sendApiError, requireValidSession, sanitizeString, broadcastToUsers, presence } = ctx;
  const store = ctx.chatStore || createChatStore();

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
    if (result.code === 'SELF') {
      return res.status(400).json({ ok: false, code: 'SELF', error: 'Kendinize mesaj gönderilemez' });
    }
    return res.status(400).json({ ok: false, code: result.code || 'BAD_TARGET', error: 'Hedef bulunamadı' });
  }

  api.post('/chat', requireValidSession, (req, res) => {
    try {
      touchPresence(req);
      const text = sanitizeString((req.body && req.body.text) || '', 400);
      const to = sanitizeString((req.body && req.body.to) || '', 20);
      const result = store.post(mine(req), to, text);
      if (!result.ok) return fail(res, result);
      try {
        if (typeof broadcastToUsers === 'function') {
          broadcastToUsers('chat_message', result.message, [result.message.from, result.message.to]);
        }
      } catch (e) { /* ignore */ }
      return res.json({ ok: true, message: result.message });
    } catch (err) {
      return sendApiError(res, err, 500, 'CHAT_SEND_FAILED');
    }
  });

  api.post('/chat/buzz', requireValidSession, (req, res) => {
    try {
      touchPresence(req);
      const to = sanitizeString((req.body && req.body.to) || '', 20);
      const from = mine(req);
      if (isKantarTarget(inboxKeyFromUsername(to) || to)) {
        return res.status(400).json({ ok: false, code: 'USE_NUDGE', error: 'Kantar için Titret evrak notunu kullanır' });
      }
      const result = store.buzz(from, to);
      if (!result.ok) return fail(res, result);
      try {
        if (typeof broadcastToUsers === 'function') {
          broadcastToUsers('chat_buzz', result.buzz, [result.buzz.to]);
        }
      } catch (e) { /* ignore */ }
      return res.json({ ok: true, buzz: result.buzz });
    } catch (err) {
      return sendApiError(res, err, 500, 'CHAT_BUZZ_FAILED');
    }
  });

  api.post('/chat/read', requireValidSession, (req, res) => {
    try {
      touchPresence(req);
      const peer = sanitizeString((req.body && req.body.peer) || '', 20);
      const result = store.markRead(mine(req), peer);
      if (!result.ok) return fail(res, result);
      try {
        if (result.read && typeof broadcastToUsers === 'function') {
          broadcastToUsers('chat_read', result.read, [result.read.from]);
        }
      } catch (e) { /* ignore */ }
      return res.json({ ok: true, read: result.read });
    } catch (err) {
      return sendApiError(res, err, 500, 'CHAT_READ_ACK_FAILED');
    }
  });

  api.get('/chat/inbox', requireValidSession, (req, res) => {
    try {
      touchPresence(req);
      const since = Number((req.query && req.query.since) || 0);
      res.setHeader('Cache-Control', 'no-store');
      return res.json({ ok: true, messages: store.inbox(mine(req), since) });
    } catch (err) {
      return sendApiError(res, err, 500, 'CHAT_INBOX_FAILED');
    }
  });

  api.get('/chat', requireValidSession, (req, res) => {
    try {
      touchPresence(req);
      const peer = sanitizeString((req.query && req.query.peer) || '', 20);
      const since = Number((req.query && req.query.since) || 0);
      res.setHeader('Cache-Control', 'no-store');
      return res.json({ ok: true, messages: store.history(mine(req), peer, since) });
    } catch (err) {
      return sendApiError(res, err, 500, 'CHAT_READ_FAILED');
    }
  });
}

module.exports = { registerChatRoutes };
