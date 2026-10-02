'use strict';

const crypto = require('crypto');
const {
  sanitizeGirisNotices,
  appendGirisNotice,
  unreadGirisNotices,
  ackGirisNotice,
  girisNoticeText,
} = require('../lib/amir-giris-notice');

const NOTICE_KV = 'amir_giris_notices_v1';

function registerAmirNoticeRoutes(api, ctx) {
  const { q, sendApiError, requireValidSession, requireAmir, sanitizeString, broadcastEvent } = ctx;
  let chain = Promise.resolve();

  function withLock(fn) {
    const run = chain.then(fn, fn);
    chain = run.then(() => undefined, () => undefined);
    return run;
  }

  function noticeUser(req) {
    const user = req && req.user;
    return String((user && (user.username || user.id)) || '').trim().toLowerCase();
  }

  function noticeClient(req) {
    const body = req && req.body && req.body.client;
    const query = req && req.query && req.query.client;
    return String(body || query || '').trim();
  }

  async function readItems() {
    const r = await q('SELECT value FROM kv_store WHERE key = $1', [NOTICE_KV]);
    if (!r.rows[0]) return [];
    try {
      const parsed = JSON.parse(r.rows[0].value);
      return sanitizeGirisNotices(parsed && parsed.items);
    } catch (e) {
      return [];
    }
  }

  async function writeItems(items) {
    const payload = JSON.stringify({
      items: sanitizeGirisNotices(items),
      updatedAt: Date.now(),
    });
    await q(
      `INSERT INTO kv_store(key, value)
       VALUES($1,$2)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [NOTICE_KV, payload]
    );
  }

  api.post('/amir-notices', requireValidSession, async (req, res) => {
    try {
      const body = req.body || {};
      const plate = sanitizeString(body.plate || '', 40);
      const firma = sanitizeString(body.firma || '', 160);
      const malzeme = sanitizeString(body.malzeme || '', 160);
      if (!plate) {
        return res.status(400).json({ ok: false, error: 'Plaka gerekli' });
      }
      const saved = await withLock(async () => {
        const current = await readItems();
        const next = appendGirisNotice(current, {
          id: crypto.randomUUID(),
          plate,
          firma,
          malzeme,
        }, Date.now());
        if (!next.notice) return null;
        await writeItems(next.items);
        return next.notice;
      });
      if (!saved) return res.status(400).json({ ok: false, error: 'Bildirim yazılamadı' });
      const payload = {
        id: saved.id,
        plate: saved.plate,
        firma: saved.firma,
        malzeme: saved.malzeme,
        ts: saved.ts,
        text: girisNoticeText(saved),
      };
      try { broadcastEvent('amir_giris', payload); } catch (e) {}
      return res.json({ ok: true, notice: payload });
    } catch (err) {
      return sendApiError(res, err, 500, 'AMIR_NOTICE_SAVE_FAILED');
    }
  });

  api.get('/amir-notices', requireAmir, async (req, res) => {
    try {
      const items = unreadGirisNotices(await readItems(), noticeUser(req), Date.now(), noticeClient(req));
      return res.json({ ok: true, items });
    } catch (err) {
      return sendApiError(res, err, 500, 'AMIR_NOTICE_READ_FAILED');
    }
  });

  api.post('/amir-notices/:id/ack', requireAmir, async (req, res) => {
    try {
      const id = String(req.params.id || '').trim();
      const user = noticeUser(req);
      const result = await withLock(async () => {
        const current = await readItems();
        const next = ackGirisNotice(current, id, user, Date.now(), noticeClient(req));
        if (next.ok) await writeItems(next.items);
        return next.ok;
      });
      if (!result) return res.status(404).json({ ok: false, error: 'Bildirim bulunamadı' });
      return res.json({ ok: true });
    } catch (err) {
      return sendApiError(res, err, 500, 'AMIR_NOTICE_ACK_FAILED');
    }
  });
}

module.exports = { registerAmirNoticeRoutes };
