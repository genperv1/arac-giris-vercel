'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createMailboxStore, MAIL_KEYS, MAX_THREADS, MIN_GAP_MS } = require('../lib/mailbox-store');
const { registerMailboxRoutes } = require('../routes/mailbox-routes');

test('ortak konu her üyeye açık kalır, cevap aynı zincire eklenir', () => {
  let now = 1_000_000;
  let n = 0;
  const store = createMailboxStore({ now: () => now, id: () => 'id' + (++n) });
  const opened = store.open('xxr', 'HERKES', '  sevkiyat  ', ' kapı açık ', 'mail');
  assert.equal(opened.ok, true);
  assert.equal(opened.thread.from, 'AMIR');
  assert.equal(opened.thread.to, 'HERKES');
  assert.equal(opened.thread.subject, 'sevkiyat');
  assert.equal(opened.thread.messages[0].text, 'kapı açık');

  assert.equal(store.open('xxr', 'xxr', 'konu', 'metin').code, 'SELF');
  assert.equal(store.open('xxr', 'yok', 'konu', 'metin').code, 'BAD_TARGET');
  assert.equal(store.open('AVDAN', 'BURAK', '', 'metin').code, 'BAD_SUBJECT');
  assert.equal(store.open('AVDAN', 'BURAK', 'konu', '  ').code, 'BAD_TEXT');

  now += MIN_GAP_MS;
  const reply = store.reply('saban', opened.thread.id, 'gördüm');
  assert.equal(reply.ok, true);
  assert.equal(reply.thread.messages.length, 2);
  assert.equal(reply.thread.messages[1].from, 'SABAN');

  const list = store.list();
  assert.equal(list.length, 1);
  assert.equal(list[0].messages[1].text, 'gördüm');
  assert.equal(store.reply('ugur', 'yok', 'x').code, 'MISSING');
});

test('hata bildirimi her zaman Burak K. ye gider ve sayfayı tutar', () => {
  let now = 2_000_000;
  let n = 0;
  const store = createMailboxStore({ now: () => now, id: () => 'h' + (++n) });
  const filed = store.open('AVDAN', 'SABAN', 'tartım durdu', 'kantar cevap vermiyor', 'hata', '/kantar.html');
  assert.equal(filed.ok, true);
  assert.equal(filed.thread.kind, 'hata');
  assert.equal(filed.thread.to, 'BURAK');
  assert.equal(filed.thread.page, '/kantar.html');
  assert.equal(filed.thread.from, 'AVDAN');

  now += MIN_GAP_MS;
  const own = store.open('burak', 'BURAK', 'ekrandaki hata', 'liste boş geldi', 'hata', '/rapor.html');
  assert.equal(own.ok, true);
  assert.equal(own.thread.from, 'BURAK');
  assert.equal(own.thread.to, 'BURAK');
});

test('okunmamış konu açılınca düşer, eski konu sınırı korunur', () => {
  let now = 3_000_000;
  let n = 0;
  const store = createMailboxStore({ now: () => now, id: () => 't' + (++n) });
  const first = store.open('xxr', 'HERKES', 'bir', 'metin');
  const unread = store.list()[0];
  assert.equal(unread.readAt.UGUR, undefined);

  now += MIN_GAP_MS;
  const read = store.markRead('ugur', first.thread.id);
  assert.equal(read.ok, true);
  assert.equal(read.read.by, 'UGUR');
  assert.equal(store.markRead('ugur', first.thread.id).read, null);

  for (let i = 0; i < MAX_THREADS + 3; i += 1) {
    now += MIN_GAP_MS;
    store.open('AVDAN', 'HERKES', 'konu ' + i, 'satır');
  }
  const list = store.list();
  assert.equal(list.length, MAX_THREADS);
  assert.equal(list[0].subject, 'konu ' + (MAX_THREADS + 2));
});

function harness(user) {
  const routes = {};
  const api = {};
  ['get', 'post'].forEach((m) => {
    api[m] = (p, ...h) => { routes[m + ' ' + p] = h; };
  });
  const events = [];
  registerMailboxRoutes(api, {
    sendApiError: (res, err) => { throw err; },
    requireValidSession: (req, res, next) => next(),
    sanitizeString: (v, max) => String(v || '').slice(0, max),
    broadcastToUsers: (type, data, keys) => { events.push({ type, data, keys }); },
    presence: { touch() {} },
    requireAmir: (req, res, next) => {
      if (req.user && (req.user.role === 'amir' || req.user.username === 'xxr')) return next();
      res.status(403).json({ ok: false, code: 'AMIR_REQUIRED' });
    },
    mailboxStore: createMailboxStore({ now: () => 9_000_000 + events.length * 500, id: () => 'm' + (events.length + 1) }),
  });
  async function call(key, req) {
    const chain = routes[key];
    let out;
    let status = 200;
    const res = {
      json(d) { out = d; return d; },
      status(c) { status = c; return this; },
      setHeader() {},
    };
    const r = Object.assign({ body: {}, query: {}, user }, req);
    for (let i = 0; i < chain.length; i++) {
      let next = false;
      await chain[i](r, res, () => { next = true; });
      if (!next) break;
    }
    return { out, status };
  }
  return { call, events };
}

test('konu ve hata bütün üyelere yayınlanır', async () => {
  const h = harness({ username: 'AVDAN', role: 'admin' });
  const opened = await h.call('post /mailbox', {
    body: { to: 'Şaban', subject: 'evrak', text: 'ofise gelsin', kind: 'mail' },
  });
  assert.equal(opened.status, 200);
  assert.equal(opened.out.thread.to, 'SABAN');
  assert.deepEqual(h.events[0].keys, MAIL_KEYS);
  assert.equal(h.events[0].type, 'mailbox_opened');

  const fault = await h.call('post /mailbox', {
    user: { username: '1.OSB', role: 'admin' },
    body: { to: 'AVDAN', subject: 'yazıcı', text: 'fiş çıkmadı', kind: 'hata', page: '/liman.html' },
  });
  assert.equal(fault.status, 200);
  assert.equal(fault.out.thread.to, 'BURAK');
  assert.equal(fault.out.thread.kind, 'hata');
  assert.equal(fault.out.thread.page, '/liman.html');

  const reply = await h.call('post /mailbox/reply', {
    user: { username: 'burak', role: 'amir' },
    body: { id: fault.out.thread.id, text: 'bakıyorum' },
  });
  assert.equal(reply.status, 200);
  assert.equal(reply.out.thread.messages.length, 2);
  assert.equal(h.events[h.events.length - 1].type, 'mailbox_reply');

  const list = await h.call('get /mailbox', { user: { username: 'ugur', role: 'amir' } });
  assert.equal(list.out.threads.length, 2);
  assert.equal(list.out.threads.some((t) => t.kind === 'hata' && t.to === 'BURAK'), true);
});

test('mesajı yalnız Burak K. siler, kişisel konu da buna dahil', async () => {
  const h = harness({ username: 'saban', role: 'amir' });
  const opened = await h.call('post /mailbox', {
    body: { to: 'UGUR', subject: 'kisisel', text: 'sadece uğura' },
  });
  const id = opened.out.thread.id;

  const deniedKantar = await h.call('post /mailbox/remove', {
    user: { username: 'AVDAN', role: 'admin' },
    body: { id },
  });
  assert.equal(deniedKantar.status, 403);

  const deniedAmir = await h.call('post /mailbox/remove', {
    user: { username: 'xxr', role: 'amir' },
    body: { id },
  });
  assert.equal(deniedAmir.status, 403);

  const removed = await h.call('post /mailbox/remove', {
    user: { username: 'burak', role: 'amir' },
    body: { id },
  });
  assert.equal(removed.status, 200);
  assert.equal(h.events.find((e) => e.type === 'mailbox_removed').data.id, id);
  const list = await h.call('get /mailbox', {});
  assert.equal(list.out.threads.length, 0);
});
