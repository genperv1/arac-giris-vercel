'use strict';

const crypto = require('crypto');
const { nudgeTarget } = require('./kantar-nudge');

const MAIL_KEYS = ['AVDAN', '1.OSB', 'AMIR', 'BURAK', 'SABAN', 'UGUR'];
const MAX_TEXT = 1500;
const MAX_SUBJECT = 80;
const MAX_PAGE = 120;
const MAX_PLATE = 16;
const MAX_REPLIES = 80;
const MAX_THREADS = 500;
const MIN_GAP_MS = 400;

function clean(raw, max) {
  return String(raw || '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .trim()
    .slice(0, max);
}

function plateOf(raw) {
  return clean(raw, MAX_PLATE).toLocaleUpperCase('tr-TR').replace(/\s+/g, '');
}

function createMemoryMailbox(opts) {
  const clock = typeof (opts && opts.now) === 'function' ? opts.now : () => Date.now();
  const makeId = typeof (opts && opts.id) === 'function' ? opts.id : () => crypto.randomUUID();
  const threads = [];
  const lastAt = new Map();

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

  function find(id) {
    const key = String(id || '');
    for (let i = 0; i < threads.length; i += 1) {
      if (threads[i].id === key) return threads[i];
    }
    return null;
  }

  function canSee(thread, viewer) {
    if (!viewer || !thread) return false;
    if (viewer === 'BURAK') return true;
    if (thread.from === viewer) return true;
    if (thread.scope === 'HERKES') return MAIL_KEYS.indexOf(viewer) !== -1;
    if ((thread.to || []).indexOf(viewer) !== -1) return true;
    if (thread.kind === 'hata' && thread.shared) return MAIL_KEYS.indexOf(viewer) !== -1;
    return false;
  }

  function isUnread(thread, viewer) {
    if (!canSee(thread, viewer)) return false;
    const seen = Number(thread.readAt && thread.readAt[viewer]) || 0;
    return (thread.messages || []).some((m) => m.from !== viewer && Number(m.ts) > seen);
  }

  function present(thread, viewer) {
    const fullRead = !viewer || viewer === 'BURAK' || viewer === thread.from;
    const readAt = {};
    if (fullRead) Object.assign(readAt, thread.readAt || {});
    else if (thread.readAt && thread.readAt[viewer]) readAt[viewer] = thread.readAt[viewer];
    return {
      id: thread.id,
      from: thread.from,
      to: (thread.to || []).slice(),
      scope: thread.scope,
      subject: thread.subject,
      kind: thread.kind,
      page: thread.page || '',
      plate: thread.plate || '',
      shared: !!thread.shared,
      pinned: !!thread.pinned,
      ts: thread.ts,
      updatedAt: thread.updatedAt,
      messages: (thread.messages || []).map((m) => ({ id: m.id, from: m.from, text: m.text, ts: m.ts })),
      readAt,
    };
  }

  function targets(from, toRaw, kind) {
    if (kind === 'hata') return { scope: 'KISI', to: from === 'BURAK' ? ['BURAK'] : ['BURAK'] };
    const list = Array.isArray(toRaw) ? toRaw : String(toRaw || '').split(',');
    let herkese = false;
    const keys = [];
    let self = false;
    list.forEach((raw) => {
      const text = String(raw || '').trim();
      if (!text) return;
      if (text.toLocaleUpperCase('tr-TR') === 'HERKES') {
        herkese = true;
        return;
      }
      const key = known(text);
      if (!key) return;
      if (key === from) {
        self = true;
        return;
      }
      if (keys.indexOf(key) === -1) keys.push(key);
    });
    if (herkese) return { scope: 'HERKES', to: MAIL_KEYS.filter((key) => key !== from) };
    if (!keys.length) return { error: self ? 'SELF' : 'BAD_TARGET' };
    return { scope: 'KISI', to: keys };
  }

  function sortThreads() {
    threads.sort((a, b) => {
      if (!!b.pinned !== !!a.pinned) return b.pinned ? 1 : -1;
      return b.updatedAt - a.updatedAt;
    });
  }

  function hit(thread, q) {
    if (!q) return true;
    const bag = [
      thread.subject,
      thread.plate,
      thread.page,
      thread.from,
      ...(thread.to || []),
      ...(thread.messages || []).map((m) => m.text + ' ' + m.from),
    ].join(' ').toLocaleLowerCase('tr-TR');
    return bag.indexOf(q) !== -1;
  }

  function open(fromRaw, toRaw, subjectRaw, textRaw, kindRaw, pageRaw, plateRaw) {
    const from = known(fromRaw);
    if (!from) return { ok: false, code: 'BAD_FROM' };
    const kind = String(kindRaw || '') === 'hata' ? 'hata' : 'mail';
    const dest = targets(from, toRaw, kind);
    if (dest.error) return { ok: false, code: dest.error };
    const subject = clean(subjectRaw, MAX_SUBJECT);
    const text = clean(textRaw, MAX_TEXT);
    if (!subject) return { ok: false, code: 'BAD_SUBJECT' };
    if (!text) return { ok: false, code: 'BAD_TEXT' };
    const wait = gap(from);
    if (!wait.ok) return wait;
    const thread = {
      id: String(makeId()),
      from,
      to: dest.to,
      scope: dest.scope,
      subject,
      kind,
      page: kind === 'hata' ? clean(pageRaw, MAX_PAGE) : clean(pageRaw, MAX_PAGE),
      plate: plateOf(plateRaw),
      shared: false,
      pinned: false,
      ts: wait.t,
      updatedAt: wait.t,
      messages: [{ id: String(makeId()), from, text, ts: wait.t }],
      readAt: {},
    };
    thread.readAt[from] = wait.t;
    threads.unshift(thread);
    while (threads.length > MAX_THREADS) threads.pop();
    return { ok: true, thread: present(thread, from), saved: thread };
  }

  function systemOpen(toRaw, subjectRaw, textRaw) {
    const dest = targets('SISTEM', toRaw, 'mail');
    if (dest.error) return { ok: false, code: dest.error };
    const subject = clean(subjectRaw, MAX_SUBJECT);
    const text = clean(textRaw, MAX_TEXT);
    if (!subject) return { ok: false, code: 'BAD_SUBJECT' };
    if (!text) return { ok: false, code: 'BAD_TEXT' };
    const t = clock();
    const thread = {
      id: String(makeId()),
      from: 'SISTEM',
      to: dest.to,
      scope: 'KISI',
      subject,
      kind: 'mail',
      page: '',
      plate: '',
      shared: false,
      pinned: false,
      ts: t,
      updatedAt: t,
      messages: [{ id: String(makeId()), from: 'SISTEM', text, ts: t }],
      readAt: {},
    };
    threads.unshift(thread);
    while (threads.length > MAX_THREADS) threads.pop();
    return { ok: true, thread: present(thread, 'BURAK'), saved: thread };
  }

  function reply(fromRaw, id, textRaw) {
    const from = known(fromRaw);
    if (!from) return { ok: false, code: 'BAD_FROM' };
    const thread = find(id);
    if (!thread || !canSee(thread, from)) return { ok: false, code: 'MISSING' };
    const text = clean(textRaw, MAX_TEXT);
    if (!text) return { ok: false, code: 'BAD_TEXT' };
    const wait = gap(from);
    if (!wait.ok) return wait;
    thread.messages.push({ id: String(makeId()), from, text, ts: wait.t });
    while (thread.messages.length > MAX_REPLIES) thread.messages.shift();
    thread.updatedAt = wait.t;
    thread.readAt[from] = wait.t;
    return { ok: true, thread: present(thread, from), saved: thread };
  }

  function markRead(readerRaw, id) {
    const reader = known(readerRaw);
    if (!reader) return { ok: false, code: 'BAD_FROM' };
    const thread = find(id);
    if (!thread || !canSee(thread, reader)) return { ok: false, code: 'MISSING' };
    const t = clock();
    if ((thread.readAt[reader] || 0) >= thread.updatedAt) return { ok: true, read: null, saved: thread };
    thread.readAt[reader] = t;
    return { ok: true, read: { id: thread.id, by: reader, readAt: t }, saved: thread, thread: present(thread, reader) };
  }

  function list(viewerRaw, opts) {
    const viewer = known(viewerRaw);
    if (!viewer) return { ok: false, code: 'BAD_FROM' };
    const q = String((opts && opts.q) || '').trim().toLocaleLowerCase('tr-TR');
    const visible = threads.filter((thread) => canSee(thread, viewer));
    const unread = visible.filter((thread) => isUnread(thread, viewer)).length;
    sortThreads();
    const rows = visible.filter((thread) => hit(thread, q)).sort((a, b) => {
      if (!!b.pinned !== !!a.pinned) return b.pinned ? 1 : -1;
      return b.updatedAt - a.updatedAt;
    });
    return { ok: true, threads: rows.map((thread) => present(thread, viewer)), unread };
  }

  function remove(id, actorRaw) {
    const actor = known(actorRaw);
    if (actor !== 'BURAK') return { ok: false, code: 'FORBIDDEN' };
    const key = String(id || '');
    const thread = find(key);
    if (!thread) return { ok: false, code: 'MISSING' };
    const viewers = audience(thread);
    const i = threads.findIndex((row) => row.id === key);
    threads.splice(i, 1);
    return { ok: true, id: key, removed: true, viewers };
  }

  function pin(actorRaw, id, on) {
    const actor = known(actorRaw);
    const thread = find(id);
    if (!thread || !canSee(thread, actor)) return { ok: false, code: 'MISSING' };
    if (thread.scope !== 'HERKES') return { ok: false, code: 'BAD_TARGET' };
    if (actor !== 'BURAK' && actor !== thread.from) return { ok: false, code: 'FORBIDDEN' };
    thread.pinned = !!on;
    return { ok: true, thread: present(thread, actor), saved: thread };
  }

  function share(actorRaw, id, on) {
    const actor = known(actorRaw);
    if (actor !== 'BURAK') return { ok: false, code: 'FORBIDDEN' };
    const thread = find(id);
    if (!thread || thread.kind !== 'hata') return { ok: false, code: 'MISSING' };
    thread.shared = !!on;
    thread.updatedAt = clock();
    return { ok: true, thread: present(thread, actor), saved: thread };
  }

  function audience(thread) {
    const keys = new Set(thread.to || []);
    keys.add(thread.from);
    keys.add('BURAK');
    if (thread.scope === 'HERKES' || (thread.kind === 'hata' && thread.shared)) {
      MAIL_KEYS.forEach((key) => keys.add(key));
    }
    return [...keys];
  }

  function load(docs) {
    threads.length = 0;
    (Array.isArray(docs) ? docs : []).forEach((doc) => {
      if (doc && doc.id) threads.push(doc);
    });
    sortThreads();
  }

  return {
    open, systemOpen, reply, markRead, list, remove, pin, share, audience, load, canSee, present,
  };
}

function createMailboxStore(opts) {
  const mem = createMemoryMailbox(opts);
  const query = opts && opts.q;
  if (typeof query !== 'function') return mem;

  let ready = null;
  function boot() {
    if (!ready) {
      ready = (async () => {
        await query(`
          CREATE TABLE IF NOT EXISTS mail_box(
            id TEXT PRIMARY KEY,
            doc JSONB NOT NULL,
            updated_at BIGINT NOT NULL
          )
        `);
        const res = await query('SELECT doc FROM mail_box ORDER BY updated_at DESC');
        mem.load((res.rows || []).map((row) => row.doc));
      })();
    }
    return ready;
  }

  async function save(result) {
    if (!result || !result.ok) return result;
    if (result.removed) {
      await query('DELETE FROM mail_box WHERE id = $1', [result.id]);
      return result;
    }
    if (result.saved) {
      await query(
        `INSERT INTO mail_box(id, doc, updated_at) VALUES($1, $2::jsonb, $3)
         ON CONFLICT (id) DO UPDATE SET doc = EXCLUDED.doc, updated_at = EXCLUDED.updated_at`,
        [result.saved.id, JSON.stringify(result.saved), result.saved.updatedAt],
      );
    }
    return result;
  }

  return {
    open: async (...args) => { await boot(); return save(mem.open(...args)); },
    systemOpen: async (...args) => { await boot(); return save(mem.systemOpen(...args)); },
    reply: async (...args) => { await boot(); return save(mem.reply(...args)); },
    markRead: async (...args) => { await boot(); return save(mem.markRead(...args)); },
    list: async (...args) => { await boot(); return mem.list(...args); },
    remove: async (...args) => { await boot(); return save(mem.remove(...args)); },
    pin: async (...args) => { await boot(); return save(mem.pin(...args)); },
    share: async (...args) => { await boot(); return save(mem.share(...args)); },
    audience: (thread) => mem.audience(thread),
    present: (thread, viewer) => mem.present(thread, viewer),
    ready: boot,
  };
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
