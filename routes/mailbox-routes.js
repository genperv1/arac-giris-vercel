'use strict';

const { createMailboxStore, MAIL_KEYS } = require('../lib/mailbox-store');
const { inboxKeyFromUsername } = require('../lib/kantar-nudge');
const { speak, istanbulDateKey } = require('../lib/ozet-bot');
const { isoWeekInfoFromMs } = require('../lib/piyasa-cikanlar');

function registerMailboxRoutes(api, ctx) {
  const { sendApiError, requireValidSession, requireAmir, sanitizeString, broadcastToUsers, presence, q } = ctx;
  const store = ctx.mailboxStore || createMailboxStore({ q: ctx.q });

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
    if (result.code === 'FORBIDDEN') {
      return res.status(403).json({ ok: false, code: 'FORBIDDEN', error: 'Bu işlem yalnız Burak K. için' });
    }
    if (result.code === 'MISSING') {
      return res.status(404).json({ ok: false, code: 'MISSING', error: 'Konu bulunamadı' });
    }
    return res.status(400).json({ ok: false, code: result.code || 'BAD_TARGET', error: 'Hedef bulunamadı' });
  }

  function fan(type, data, keys) {
    try {
      if (typeof broadcastToUsers === 'function') broadcastToUsers(type, data, keys);
    } catch (e) { /* ignore */ }
  }

  function fanThread(type, saved) {
    if (!saved) return;
    const keys = typeof store.audience === 'function' ? store.audience(saved) : MAIL_KEYS.slice();
    keys.forEach((key) => {
      const view = typeof store.present === 'function' ? store.present(saved, key) : saved;
      fan(type, view, [key]);
    });
  }

  function targetsOf(body) {
    const raw = body && body.to;
    const list = Array.isArray(raw) ? raw : String(raw || '').split(',');
    return list.map((item) => sanitizeString(item, 20)).filter(Boolean);
  }

  api.post('/mailbox', requireValidSession, async (req, res) => {
    try {
      touchPresence(req);
      const body = req.body || {};
      const result = await store.open(
        mine(req),
        targetsOf(body),
        sanitizeString(body.subject || '', 80),
        sanitizeString(body.text || '', 1500),
        sanitizeString(body.kind || '', 12),
        sanitizeString(body.page || '', 120),
        sanitizeString(body.plate || '', 16),
      );
      if (!result.ok) return fail(res, result);
      const saved = result.saved || result.thread;
      fanThread('mailbox_opened', saved);
      return res.json({ ok: true, thread: result.thread });
    } catch (err) {
      return sendApiError(res, err, 500, 'MAILBOX_OPEN_FAILED');
    }
  });

  api.post('/mailbox/reply', requireValidSession, async (req, res) => {
    try {
      touchPresence(req);
      const body = req.body || {};
      const result = await store.reply(
        mine(req),
        sanitizeString(body.id || '', 80),
        sanitizeString(body.text || '', 1500),
      );
      if (!result.ok) return fail(res, result);
      fanThread('mailbox_reply', result.saved || result.thread);
      return res.json({ ok: true, thread: result.thread });
    } catch (err) {
      return sendApiError(res, err, 500, 'MAILBOX_REPLY_FAILED');
    }
  });

  api.post('/mailbox/read', requireValidSession, async (req, res) => {
    try {
      touchPresence(req);
      const id = sanitizeString((req.body && req.body.id) || '', 80);
      const result = await store.markRead(mine(req), id);
      if (!result.ok) return fail(res, result);
      if (result.read && result.saved) {
        const tell = [result.saved.from, 'BURAK'];
        fan('mailbox_read', { id: result.read.id, by: result.read.by, readAt: result.read.readAt }, tell);
      }
      return res.json({ ok: true, read: result.read });
    } catch (err) {
      return sendApiError(res, err, 500, 'MAILBOX_READ_FAILED');
    }
  });

  api.get('/mailbox', requireValidSession, async (req, res) => {
    try {
      touchPresence(req);
      res.setHeader('Cache-Control', 'no-store');
      const result = await store.list(mine(req), {
        q: sanitizeString((req.query && req.query.q) || '', 80),
      });
      if (!result.ok) return fail(res, result);
      return res.json({ ok: true, threads: result.threads, unread: result.unread });
    } catch (err) {
      return sendApiError(res, err, 500, 'MAILBOX_LIST_FAILED');
    }
  });

  api.post('/mailbox/pin', requireValidSession, async (req, res) => {
    try {
      touchPresence(req);
      const body = req.body || {};
      const result = await store.pin(mine(req), sanitizeString(body.id || '', 80), !!body.pinned);
      if (!result.ok) return fail(res, result);
      fanThread('mailbox_reply', result.saved || result.thread);
      return res.json({ ok: true, thread: result.thread });
    } catch (err) {
      return sendApiError(res, err, 500, 'MAILBOX_PIN_FAILED');
    }
  });

  api.post('/mailbox/share', requireValidSession, async (req, res) => {
    try {
      touchPresence(req);
      const body = req.body || {};
      const result = await store.share(mine(req), sanitizeString(body.id || '', 80), body.shared !== false);
      if (!result.ok) return fail(res, result);
      fanThread('mailbox_reply', result.saved || result.thread);
      return res.json({ ok: true, thread: result.thread });
    } catch (err) {
      return sendApiError(res, err, 500, 'MAILBOX_SHARE_FAILED');
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

  api.post('/ozet', requireValidSession, async (req, res) => {
    try {
      touchPresence(req);
      const body = req.body || {};
      const incoming = Array.isArray(body.messages) ? body.messages : [];
      const messages = incoming.slice(-12).map((row) => ({
        role: row && row.role === 'assistant' ? 'assistant' : 'user',
        text: sanitizeString(row && row.text, 500),
      })).filter((row) => row.text);
      if (!messages.length && body.text) messages.push({ role: 'user', text: sanitizeString(body.text, 500) });
      const now = new Date();
      const day = istanbulDateKey(now);
      const start = Date.parse(day + 'T00:00:00+03:00');
      let liman = {};
      let piyasa = {};
      let reports = [];
      let cikanlar = [];
      if (typeof q === 'function') {
        const [limanRow, piyasaRow, reportRow] = await Promise.all([
          q('SELECT value FROM kv_store WHERE key = $1', ['liman_state_v1']),
          q('SELECT value FROM kv_store WHERE key = $1', ['piyasa_state_v1']),
          q(
            `SELECT plaka, sofor, firma, malzeme, sevk_yeri, tarih
             FROM print_history WHERE tarih >= $1 AND tarih < $2
             ORDER BY tarih DESC LIMIT 30`,
            [start, start + 24 * 60 * 60 * 1000],
          ),
        ]);
        const limanRaw = limanRow && limanRow.rows && limanRow.rows[0] && limanRow.rows[0].value;
        const piyasaRaw = piyasaRow && piyasaRow.rows && piyasaRow.rows[0] && piyasaRow.rows[0].value;
        try { liman = limanRaw ? JSON.parse(limanRaw) : {}; } catch (e) { liman = {}; }
        try { piyasa = piyasaRaw ? JSON.parse(piyasaRaw) : {}; } catch (e) { piyasa = {}; }
        reports = (reportRow && reportRow.rows) || [];
        const weekInfo = isoWeekInfoFromMs(now.getTime());
        const weekNo = weekInfo ? String(weekInfo.week) : '';
        if (weekNo) {
          const cikanRow = await q(
            `SELECT plaka, sofor, firma, malzeme, sehir, sevk_yeri, miktar, tarih, hafta
             FROM piyasa_cikanlar
             WHERE hafta = $1 OR hafta LIKE $2
             ORDER BY tarih DESC
             LIMIT 800`,
            [weekNo, weekNo + '.%'],
          );
          cikanlar = (cikanRow && cikanRow.rows) || [];
        }
      }
      return res.json({
        ok: true,
        reply: speak(messages, { liman, piyasa, reports, cikanlar, now }),
      });
    } catch (err) {
      return sendApiError(res, err, 500, 'OZET_FAILED');
    }
  });

  api.post('/mailbox/remove', requireBurak, async (req, res) => {
    try {
      touchPresence(req);
      const id = sanitizeString((req.body && req.body.id) || '', 80);
      const result = await store.remove(id, mine(req));
      if (!result.ok) return fail(res, result);
      fan('mailbox_removed', { id: result.id }, result.viewers || MAIL_KEYS);
      return res.json({ ok: true, id: result.id });
    } catch (err) {
      return sendApiError(res, err, 500, 'MAILBOX_REMOVE_FAILED');
    }
  });
}

module.exports = { registerMailboxRoutes };
