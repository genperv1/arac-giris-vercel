'use strict';

const crypto = require('crypto');
const { nudgeTarget } = require('./kantar-nudge');

const CHAT_KEYS = ['AVDAN', '1.OSB', 'AMIR', 'SABAN', 'UGUR'];
const MAX_TEXT = 400;
const MAX_PER_THREAD = 40;
const MIN_GAP_MS = 400;
const BUZZ_GAP_MS = 8 * 1000;

function pairId(a, b) {
  return [a, b].sort().join('::');
}

function cleanText(raw) {
  return String(raw || '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .trim()
    .slice(0, MAX_TEXT);
}

function createChatStore(opts) {
  const clock = typeof (opts && opts.now) === 'function' ? opts.now : () => Date.now();
  const makeId = typeof (opts && opts.id) === 'function' ? opts.id : () => crypto.randomUUID();
  const threads = new Map();
  const lastAt = new Map();
  const lastBuzz = new Map();

  function known(raw) {
    const key = nudgeTarget(raw);
    if (!key || CHAT_KEYS.indexOf(key) === -1) return '';
    return key;
  }

  function post(fromRaw, toRaw, text) {
    const from = known(fromRaw);
    const to = known(toRaw);
    if (!from) return { ok: false, code: 'BAD_FROM' };
    if (!to) return { ok: false, code: 'BAD_TARGET' };
    if (from === to) return { ok: false, code: 'SELF' };
    const body = cleanText(text);
    if (!body) return { ok: false, code: 'BAD_TEXT' };
    const t = clock();
    const prev = lastAt.get(from) || 0;
    if (t - prev < MIN_GAP_MS) {
      return { ok: false, code: 'COOLDOWN', retryAfter: MIN_GAP_MS - (t - prev) };
    }
    const message = { id: String(makeId()), from, to, text: body, ts: t };
    const id = pairId(from, to);
    const list = threads.get(id) || [];
    list.push(message);
    while (list.length > MAX_PER_THREAD) list.shift();
    threads.set(id, list);
    lastAt.set(from, t);
    return { ok: true, message };
  }

  function buzz(fromRaw, toRaw) {
    const from = known(fromRaw);
    const to = known(toRaw);
    if (!from) return { ok: false, code: 'BAD_FROM' };
    if (!to) return { ok: false, code: 'BAD_TARGET' };
    if (from === to) return { ok: false, code: 'SELF' };
    const t = clock();
    const slot = from + '>' + to;
    const prev = lastBuzz.get(slot) || 0;
    if (t - prev < BUZZ_GAP_MS) {
      return { ok: false, code: 'COOLDOWN', retryAfter: BUZZ_GAP_MS - (t - prev) };
    }
    lastBuzz.set(slot, t);
    return { ok: true, buzz: { from, to, ts: t } };
  }

  /** Okuyan kişi, karşıdan gelen okunmamış satırları işaretler. */
  function markRead(readerRaw, authorRaw) {
    const reader = known(readerRaw);
    const author = known(authorRaw);
    if (!reader) return { ok: false, code: 'BAD_FROM' };
    if (!author) return { ok: false, code: 'BAD_TARGET' };
    if (reader === author) return { ok: false, code: 'SELF' };
    const list = threads.get(pairId(reader, author)) || [];
    const t = clock();
    let changed = false;
    list.forEach((m) => {
      if (m.to !== reader || m.from !== author || m.readAt) return;
      m.readAt = t;
      changed = true;
    });
    if (!changed) return { ok: true, read: null };
    return { ok: true, read: { by: reader, from: author, readAt: t } };
  }

  function history(meRaw, peerRaw, sinceTs) {
    const me = known(meRaw);
    const peer = known(peerRaw);
    if (!me || !peer || me === peer) return [];
    const list = threads.get(pairId(me, peer)) || [];
    const since = Number(sinceTs) || 0;
    if (!since) return list.slice();
    return list.filter((m) => m.ts > since);
  }

  function inbox(meRaw, sinceTs) {
    const me = known(meRaw);
    if (!me) return [];
    const since = Number(sinceTs) || 0;
    const out = [];
    threads.forEach((list) => {
      list.forEach((m) => {
        if (m.from !== me && m.to !== me) return;
        if (since && m.ts <= since) return;
        out.push(m);
      });
    });
    out.sort((a, b) => a.ts - b.ts);
    return out.slice(-80);
  }

  return { post, buzz, markRead, history, inbox };
}

module.exports = {
  CHAT_KEYS,
  MAX_TEXT,
  MAX_PER_THREAD,
  MIN_GAP_MS,
  BUZZ_GAP_MS,
  createChatStore,
};
