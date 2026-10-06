'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createChatStore, MAX_PER_THREAD, MIN_GAP_MS, BUZZ_GAP_MS } = require('../lib/chat-store');
const { registerChatRoutes } = require('../routes/chat-routes');

test('yazışma yalnız iki kişi arasında durur, eski satır düşer', () => {
  let now = 1_000_000;
  let n = 0;
  const store = createChatStore({ now: () => now, id: () => 'm' + (++n) });
  const sent = store.post('xxr', 'saban', '  selam  ');
  assert.equal(sent.ok, true);
  assert.equal(sent.message.from, 'AMIR');
  assert.equal(sent.message.to, 'SABAN');
  assert.equal(sent.message.text, 'selam');

  assert.equal(store.post('xxr', 'xxr', 'kendime').code, 'SELF');
  assert.equal(store.post('xxr', 'saban', '   ').code, 'BAD_TEXT');
  assert.equal(store.post('xxr', 'yok', 'a').code, 'BAD_TARGET');

  const cool = store.post('AVDAN', 'AMIR', 'hemen');
  assert.equal(cool.ok, true);
  const blocked = store.post('AVDAN', '1.OSB', 'üst üste');
  assert.equal(blocked.code, 'COOLDOWN');

  now += MIN_GAP_MS;
  assert.equal(store.post('ugur', '1.OSB', 'kantar').ok, true);

  assert.equal(store.history('saban', 'xxr').length, 1);
  assert.equal(store.history('AVDAN', 'SABAN').length, 0);
  assert.equal(store.inbox('SABAN').length, 1);
  assert.equal(store.inbox('AVDAN')[0].text, 'hemen');
  assert.equal(store.inbox('UGUR')[0].to, '1.OSB');

  now += MIN_GAP_MS;
  for (let i = 0; i < MAX_PER_THREAD + 5; i += 1) {
    now += MIN_GAP_MS;
    store.post('AMIR', 'UGUR', 'satır ' + i);
  }
  const thread = store.history('ugur', 'AMIR');
  assert.equal(thread.length, MAX_PER_THREAD);
  assert.equal(thread[thread.length - 1].text, 'satır ' + (MAX_PER_THREAD + 4));
});

test('okuyan işaretleyince yalnız yazanın satırları okundu olur', () => {
  let now = 3_000_000;
  const store = createChatStore({ now: () => now, id: () => 'r1' });
  store.post('xxr', 'AVDAN', 'gel');
  now += 500;
  const unread = store.history('AVDAN', 'AMIR')[0];
  assert.equal(unread.readAt, undefined);

  const acked = store.markRead('AVDAN', 'AMIR');
  assert.equal(acked.ok, true);
  assert.equal(acked.read.by, 'AVDAN');
  assert.equal(acked.read.from, 'AMIR');
  assert.equal(store.history('xxr', '1.OSB').length, 0);
  assert.equal(store.history('AMIR', 'AVDAN')[0].readAt, now);

  const again = store.markRead('AVDAN', 'SELAHATTİN');
  assert.equal(again.read, null);
  assert.equal(store.markRead('AVDAN', 'AVDAN').code, 'SELF');
});

test('titretme kısa aralıkta tekrarlanmaz; kantar buzz yolundan gitmez', () => {
  let now = 5_000_000;
  const store = createChatStore({ now: () => now, id: () => 'b' });
  const first = store.buzz('saban', 'ugur');
  assert.equal(first.ok, true);
  assert.equal(store.buzz('saban', 'ugur').code, 'COOLDOWN');
  now += BUZZ_GAP_MS;
  assert.equal(store.buzz('ŞABAN', 'UĞUR').ok, true);
  assert.equal(store.buzz('xxr', 'xxr').code, 'SELF');
});

function harness(user) {
  const routes = {};
  const api = {};
  ['get', 'post'].forEach((m) => {
    api[m] = (p, ...h) => { routes[m + ' ' + p] = h; };
  });
  const events = [];
  const presence = { touch() {} };
  registerChatRoutes(api, {
    sendApiError: (res, err) => { throw err; },
    requireValidSession: (req, res, next) => next(),
    sanitizeString: (v, max) => String(v || '').slice(0, max),
    broadcastToUsers: (type, data, keys) => { events.push({ type, data, keys }); },
    presence,
    chatStore: createChatStore({ now: () => 9_000_000 + events.length, id: () => 'c' + (events.length + 1) }),
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

test('kantar amire yazar, başkası o konuşmayı görmez, mesaj yalnız ikisine gider', async () => {
  const h = harness({ username: 'AVDAN', role: 'admin' });
  const sent = await h.call('post /chat', { body: { to: 'SELAHATTİN', text: 'evrak yolda' } });
  assert.equal(sent.status, 200);
  assert.equal(sent.out.message.from, 'AVDAN');
  assert.equal(sent.out.message.to, 'AMIR');
  assert.deepEqual(h.events[0].keys, ['AVDAN', 'AMIR']);
  assert.equal(h.events[0].type, 'chat_message');

  const mine = await h.call('get /chat', { query: { peer: 'AMIR' } });
  assert.equal(mine.out.messages[0].text, 'evrak yolda');

  const other = await h.call('get /chat', { user: { username: '1.OSB', role: 'admin' }, query: { peer: 'AMIR' } });
  assert.equal(other.out.messages.length, 0);

  const inbox = await h.call('get /chat/inbox', { user: { username: 'xxr', role: 'amir' }, query: { since: 0 } });
  assert.equal(inbox.out.messages[0].text, 'evrak yolda');

  const self = await h.call('post /chat', { user: { username: 'saban', role: 'amir' }, body: { to: 'SABAN', text: 'x' } });
  assert.equal(self.status, 400);
  assert.equal(self.out.code, 'SELF');
});

test('okundu bilgisi yalnız yazana gider', async () => {
  const h = harness({ username: 'AVDAN', role: 'admin' });
  await h.call('post /chat', { user: { username: 'saban', role: 'amir' }, body: { to: 'AVDAN', text: 'bak' } });
  const read = await h.call('post /chat/read', { user: { username: 'AVDAN', role: 'admin' }, body: { peer: 'SABAN' } });
  assert.equal(read.status, 200);
  assert.equal(read.out.read.by, 'AVDAN');
  assert.equal(read.out.read.from, 'SABAN');
  const ev = h.events.find((e) => e.type === 'chat_read');
  assert.deepEqual(ev.keys, ['SABAN']);
  const again = await h.call('post /chat/read', { user: { username: 'AVDAN', role: 'admin' }, body: { peer: 'ŞABAN' } });
  assert.equal(again.out.read, null);
});

test('kişi titretmesi yalnız hedefe gider; kantar titretmesi bu yoldan olmaz', async () => {
  const h = harness({ username: 'ugur', role: 'amir' });
  const buzz = await h.call('post /chat/buzz', { body: { to: 'ŞABAN' } });
  assert.equal(buzz.status, 200);
  assert.equal(buzz.out.buzz.to, 'SABAN');
  assert.deepEqual(h.events[0].keys, ['SABAN']);

  const kantar = await h.call('post /chat/buzz', { body: { to: 'AVDAN' } });
  assert.equal(kantar.status, 400);
  assert.equal(kantar.out.code, 'USE_NUDGE');
});
