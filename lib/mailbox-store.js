'use strict';

const crypto = require('crypto');
const { nudgeTarget } = require('./kantar-nudge');

const MAIL_KEYS = ['AVDAN', '1.OSB', 'AMIR', 'BURAK', 'SABAN', 'UGUR'];
const MAX_TEXT = 400;
const MAX_SUBJECT = 80;
const MAX_PAGE = 120;
const MAX_REPLIES = 40;
const MAX_THREADS = 50;
const MIN_GAP_MS = 400;

function clean(raw, max) {
  return String(raw || '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .trim()
    .slice(0, max);
}

function createMailboxStore(opts) {
  const clock = typeof (opts && opts.now) === 'function' ? opts.now : () => Date.now();
  const makeId = typeof (opts && opts.id) === 'function' ? opts.id : () => crypto.randomUUID();
  const threads = [];
  const lastAt = new Map();
  let clearedAt = 0;

  function known(raw) {
    const key = nudgeTarget(raw);
    if (!key || MAIL_KEYS.indexOf(key) === -1) return '';
    return key;
  }

  function gap(from) {
    const t = clock();
    const prev = lastAt.get(from) || 0;
    if (t - prev < MIN_GAP_MS) {
      return { ok: false, code: 'COOLDOWN', retryAfter: MIN_GAP_MS - (t - prev) };
    }
    lastAt.set(from, t);
    return { ok: true, t };
  }

  function trim() {
    threads.sort((a, b) => b.updatedAt - a.updatedAt);
    while (threads.length > MAX_THREADS) threads.pop();
  }

  function present(thread) {
    return {
      id: thread.id,
      from: thread.from,
      to: thread.to,
      subject: thread.subject,
      kind: thread.kind,
      page: thread.page || '',
      ts: thread.ts,
      updatedAt: thread.updatedAt,
      messages: thread.messages.map((m) => ({ id: m.id, from: m.from, text: m.text, ts: m.ts })),
      readAt: Object.assign({}, thread.readAt),
    };
  }

  function find(id) {
    const key = String(id || '');
    for (let i = 0; i < threads.length; i += 1) {
      if (threads[i].id === key) return threads[i];
    }
    return null;
  }

  function open(fromRaw, toRaw, subjectRaw, textRaw, kindRaw, pageRaw) {
    const from = known(fromRaw);
    if (!from) return { ok: false, code: 'BAD_FROM' };
    const kind = String(kindRaw || '') === 'hata' ? 'hata' : 'mail';
    const asked = String(toRaw || '').trim().toLocaleUpperCase('tr-TR');
    const to = kind === 'hata' ? 'BURAK' : (asked === 'HERKES' ? 'HERKES' : known(toRaw));
    if (!to) return { ok: false, code: 'BAD_TARGET' };
    if (kind !== 'hata' && to === from) return { ok: false, code: 'SELF' };
    const subject = clean(subjectRaw, MAX_SUBJECT);
    const text = clean(textRaw, MAX_TEXT);
    if (!subject) return { ok: false, code: 'BAD_SUBJECT' };
    if (!text) return { ok: false, code: 'BAD_TEXT' };
    const wait = gap(from);
    if (!wait.ok) return wait;
    const message = { id: String(makeId()), from, text, ts: wait.t };
    const thread = {
      id: String(makeId()),
      from,
      to,
      subject,
      kind,
      page: kind === 'hata' ? clean(pageRaw, MAX_PAGE) : '',
      ts: wait.t,
      updatedAt: wait.t,
      messages: [message],
      readAt: {},
    };
    thread.readAt[from] = wait.t;
    threads.unshift(thread);
    trim();
    return { ok: true, thread: present(thread) };
  }

  function reply(fromRaw, id, textRaw) {
    const from = known(fromRaw);
    if (!from) return { ok: false, code: 'BAD_FROM' };
    const thread = find(id);
    if (!thread) return { ok: false, code: 'MISSING' };
    const text = clean(textRaw, MAX_TEXT);
    if (!text) return { ok: false, code: 'BAD_TEXT' };
    const wait = gap(from);
    if (!wait.ok) return wait;
    const message = { id: String(makeId()), from, text, ts: wait.t };
    thread.messages.push(message);
    while (thread.messages.length > MAX_REPLIES) thread.messages.shift();
    thread.updatedAt = wait.t;
    thread.readAt[from] = wait.t;
    trim();
    return { ok: true, thread: present(thread), message };
  }

  function markRead(readerRaw, id) {
    const reader = known(readerRaw);
    if (!reader) return { ok: false, code: 'BAD_FROM' };
    const thread = find(id);
    if (!thread) return { ok: false, code: 'MISSING' };
    const t = clock();
    if ((thread.readAt[reader] || 0) >= thread.updatedAt) {
      return { ok: true, read: null };
    }
    thread.readAt[reader] = t;
    return { ok: true, read: { id: thread.id, by: reader, readAt: t } };
  }

  function list() {
    return threads.slice().sort((a, b) => b.updatedAt - a.updatedAt).map(present);
  }

  function remove(id) {
    const key = String(id || '');
    const i = threads.findIndex((t) => t.id === key);
    if (i < 0) return { ok: false, code: 'MISSING' };
    threads.splice(i, 1);
    return { ok: true, id: key };
  }

  function clear() {
    threads.length = 0;
    lastAt.clear();
    clearedAt = clock();
    return { ok: true, clearedAt };
  }

  return { open, reply, markRead, list, remove, clear, clearedAt: () => clearedAt };
}

module.exports = {
  createMailboxStore,
  MAIL_KEYS,
  MAX_TEXT,
  MAX_SUBJECT,
  MAX_REPLIES,
  MAX_THREADS,
  MIN_GAP_MS,
};
