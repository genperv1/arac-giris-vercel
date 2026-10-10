'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createMailboxStore, MAIL_KEYS, MIN_GAP_MS } = require('../lib/mailbox-store');
const { registerMailboxRoutes } = require('../routes/mailbox-routes');

test('herkese duyurusu üyelerde görünür, kişisel mesaj başkasında görünmez', () => {
  let now = 1_000_000;
  let n = 0;
  const store = createMailboxStore({ now: () => now, id: () => 'id' + (++n) });
  const opened = store.open('xxr', ['HERKES'], '  sevkiyat  ', ' kapı açık ', 'mail');
  assert.equal(opened.ok, true);
  assert.equal(opened.thread.from, 'AMIR');
  assert.equal(opened.thread.scope, 'HERKES');
  assert.equal(opened.thread.subject, 'sevkiyat');
  assert.equal(opened.thread.messages[0].text, 'kapı açık');

  assert.equal(store.open('xxr', ['xxr'], 'konu', 'metin').code, 'SELF');
  assert.equal(store.open('xxr', ['yok'], 'konu', 'metin').code, 'BAD_TARGET');
  assert.equal(store.open('AVDAN', ['BURAK'], '', 'metin').code, 'BAD_SUBJECT');
  assert.equal(store.open('AVDAN', ['BURAK'], 'konu', '  ').code, 'BAD_TEXT');

  now += MIN_GAP_MS;
  const reply = store.reply('saban', opened.thread.id, 'gördüm');
  assert.equal(reply.ok, true);
  assert.equal(reply.thread.messages.length, 2);
  assert.equal(reply.thread.messages[1].from, 'SABAN');

  const all = store.list('UGUR');
  assert.equal(all.threads.length, 1);
  assert.equal(all.threads[0].messages[1].text, 'gördüm');
  assert.equal(store.reply('ugur', 'yok', 'x').code, 'MISSING');

  now += MIN_GAP_MS;
  const personal = store.open('saban', ['UGUR'], 'özel', 'yalnız sana');
  assert.equal(personal.ok, true);
  assert.equal(store.list('AVDAN').threads.some((row) => row.id === personal.thread.id), false);
  assert.equal(store.list('UGUR').threads.some((row) => row.id === personal.thread.id), true);
  assert.equal(store.list('BURAK').threads.some((row) => row.id === personal.thread.id), true);
  assert.equal(store.reply('AVDAN', personal.thread.id, 'giremem').code, 'MISSING');
});

test('hata bildirimi Burak K. ye gider, başkasına açılmaz', () => {
  let now = 2_000_000;
  let n = 0;
  const store = createMailboxStore({ now: () => now, id: () => 'h' + (++n) });
  const filed = store.open('AVDAN', ['SABAN'], 'tartım durdu', 'kantar cevap vermiyor', 'hata', '/kantar.html', '34ABC123');
  assert.equal(filed.ok, true);
  assert.equal(filed.thread.kind, 'hata');
  assert.deepEqual(filed.thread.to, ['BURAK']);
  assert.equal(filed.thread.page, '/kantar.html');
  assert.equal(filed.thread.plate, '34ABC123');
  assert.equal(store.list('SABAN').threads.some((row) => row.id === filed.thread.id), false);
  assert.equal(store.list('BURAK').threads.some((row) => row.id === filed.thread.id), true);

  now += MIN_GAP_MS;
  const own = store.open('burak', ['BURAK'], 'ekrandaki hata', 'liste boş geldi', 'hata', '/rapor.html');
  assert.equal(own.ok, true);
  assert.equal(own.thread.from, 'BURAK');
});

test('okundu bilgisi gönderene döner, alıcı başkasının saatini görmez', () => {
  let now = 3_000_000;
  let n = 0;
  const store = createMailboxStore({ now: () => now, id: () => 't' + (++n) });
  const first = store.open('xxr', ['UGUR', 'SABAN'], 'bir', 'metin');
  assert.equal(store.list('UGUR').threads[0].readAt.UGUR, undefined);
  assert.equal(store.list('UGUR').unread, 1);

  now += MIN_GAP_MS;
  const read = store.markRead('ugur', first.thread.id);
  assert.equal(read.ok, true);
  assert.equal(read.read.by, 'UGUR');
  assert.equal(store.markRead('ugur', first.thread.id).read, null);

  const senderView = store.list('AMIR').threads[0];
  assert.ok(senderView.readAt.UGUR > 0);
  assert.equal(senderView.readAt.SABAN, undefined);
  const peerView = store.list('SABAN').threads[0];
  assert.equal(peerView.readAt.UGUR, undefined);

  const found = store.list('AMIR', { q: '34 yok' });
  assert.equal(found.threads.length, 0);
  now += MIN_GAP_MS;
  store.open('AVDAN', ['BURAK'], 'plaka', 'araç geldi', 'mail', '', '06 ERD 408');
  assert.equal(store.list('BURAK', { q: '06erd408' }).threads.length, 1);
});

test('duyuru sabitlenir, hata Burak paylaşırsa herkese açılır', () => {
  let now = 4_000_000;
  let n = 0;
  const store = createMailboxStore({ now: () => now, id: () => 'p' + (++n) });
  const duyuru = store.open('xxr', ['HERKES'], 'sayım', 'öğlen');
  assert.equal(store.pin('saban', duyuru.thread.id, true).code, 'FORBIDDEN');
  const pinned = store.pin('xxr', duyuru.thread.id, true);
  assert.equal(pinned.thread.pinned, true);

  now += MIN_GAP_MS;
  const fault = store.open('AVDAN', ['BURAK'], 'yazıcı', 'fiş yok', 'hata', '/liman.html');
  assert.equal(store.share('xxr', fault.thread.id, true).code, 'FORBIDDEN');
  const shared = store.share('burak', fault.thread.id, true);
  assert.equal(shared.thread.shared, true);
  assert.equal(store.list('UGUR').threads.some((row) => row.id === fault.thread.id), true);
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
    for (let i = 0; i < chain.length; i += 1) {
      let next = false;
      await chain[i](r, res, () => { next = true; });
      if (!next) break;
    }
    return { out, status };
  }
  return { call, events };
}

test('kişisel konu yalnız alıcıya, hata Burak a yayınlanır', async () => {
  const h = harness({ username: 'AVDAN', role: 'admin' });
  const opened = await h.call('post /mailbox', {
    body: { to: ['Şaban'], subject: 'evrak', text: 'ofise gelsin', kind: 'mail' },
  });
  assert.equal(opened.status, 200);
  assert.deepEqual(opened.out.thread.to, ['SABAN']);
  const keys = h.events.filter((e) => e.type === 'mailbox_opened').map((e) => e.keys[0]).sort();
  assert.deepEqual(keys, ['AVDAN', 'BURAK', 'SABAN']);

  const fault = await h.call('post /mailbox', {
    user: { username: '1.OSB', role: 'admin' },
    body: { to: ['AVDAN'], subject: 'yazıcı', text: 'fiş çıkmadı', kind: 'hata', page: '/liman.html' },
  });
  assert.equal(fault.status, 200);
  assert.deepEqual(fault.out.thread.to, ['BURAK']);
  assert.equal(fault.out.thread.page, '/liman.html');

  const hidden = await h.call('get /mailbox', { user: { username: 'ugur', role: 'amir' } });
  assert.equal(hidden.out.threads.some((row) => row.subject === 'evrak'), false);
  const saban = await h.call('get /mailbox', { user: { username: 'saban', role: 'amir' } });
  assert.equal(saban.out.threads.some((row) => row.subject === 'evrak'), true);
  assert.equal(saban.out.threads.find((row) => row.subject === 'evrak').readAt.AVDAN, undefined);
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
  const list = await h.call('get /mailbox', { user: { username: 'burak', role: 'amir' } });
  assert.equal(list.out.threads.length, 0);
});

test('kalıcı kutu veritabanına yazar ve yeniden yükler', async () => {
  const rows = [];
  const q = async (sql, params) => {
    if (String(sql).includes('CREATE TABLE')) return { rows: [] };
    if (String(sql).startsWith('SELECT')) return { rows: rows.map((row) => ({ doc: JSON.parse(row.doc) })) };
    if (String(sql).startsWith('INSERT')) {
      const id = params[0];
      const prev = rows.findIndex((row) => row.id === id);
      const next = { id, doc: params[1], updated_at: params[2] };
      if (prev >= 0) rows[prev] = next;
      else rows.push(next);
      return { rows: [] };
    }
    if (String(sql).startsWith('DELETE')) {
      const id = params[0];
      const i = rows.findIndex((row) => row.id === id);
      if (i >= 0) rows.splice(i, 1);
      return { rows: [] };
    }
    return { rows: [] };
  };
  let now = 5_000_000;
  const first = createMailboxStore({ q, now: () => now, id: () => 'db1' });
  const opened = await first.open('AVDAN', ['SABAN'], 'kalıcı', 'duruyor');
  assert.equal(opened.ok, true);
  assert.equal(rows.length, 1);

  now += MIN_GAP_MS;
  const second = createMailboxStore({ q, now: () => now, id: () => 'db2' });
  const list = await second.list('SABAN');
  assert.equal(list.threads.length, 1);
  assert.equal(list.threads[0].subject, 'kalıcı');
  const hidden = await second.list('UGUR');
  assert.equal(hidden.threads.length, 0);
});

void MAIL_KEYS;
