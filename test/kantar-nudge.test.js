'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  normalizeTarget,
  siteFromUsername,
  nudgeTarget,
  inboxKeyFromUsername,
  isTargetOnline,
  createNudgeStore,
  NUDGE_TTL_MS,
  NUDGE_COOLDOWN_MS,
} = require('../lib/kantar-nudge');
const { registerKantarNudgeRoutes } = require('../routes/kantar-nudge-routes');

test('hedef AVDAN / 1.OSB; amir kullanıcı adı hedef değildir', () => {
  assert.equal(normalizeTarget('avdan'), 'AVDAN');
  assert.equal(normalizeTarget('1 OSB'), '1.OSB');
  assert.equal(normalizeTarget('1.osb'), '1.OSB');
  assert.equal(siteFromUsername('AVDAN'), 'AVDAN');
  assert.equal(siteFromUsername('xxr'), '');
  assert.equal(nudgeTarget('xxr'), 'AMIR');
  assert.equal(nudgeTarget('şaban'), 'SABAN');
  assert.equal(inboxKeyFromUsername('ugur'), 'UGUR');
  assert.equal(isTargetOnline([{ key: 'AVDAN', online: true }], 'AVDAN'), true);
  assert.equal(isTargetOnline([{ key: '1.OSB', online: false }], '1.OSB'), false);
});

test('çevrimdışı hedefe nudge gitmez; online olunca kısa ömürlü durur', () => {
  let now = 1_000_000;
  let n = 0;
  const store = createNudgeStore({ now: () => now, id: () => 'n' + (++n) });
  const offline = store.send('1.OSB', [{ key: '1.OSB', online: false }]);
  assert.equal(offline.ok, false);
  assert.equal(offline.code, 'OFFLINE');

  const sent = store.send('1.OSB', [{ key: '1.OSB', online: true }]);
  assert.equal(sent.ok, true);
  assert.equal(sent.nudge.target, '1.OSB');
  assert.equal(store.pending('1.OSB', 0).id, 'n1');
  assert.equal(store.pending('AVDAN', 0), null);
  assert.equal(store.pending('1.OSB', sent.nudge.ts), null);

  const cool = store.send('1.OSB', [{ key: '1.OSB', online: true }]);
  assert.equal(cool.code, 'COOLDOWN');

  now += NUDGE_COOLDOWN_MS + 1;
  const again = store.send('1.OSB', [{ key: '1.OSB', online: true }]);
  assert.equal(again.ok, true);
  assert.equal(again.nudge.id, 'n2');

  now += NUDGE_TTL_MS + 1;
  assert.equal(store.pending('1.OSB', 0), null);
});

test('kantar yalnız kendi son çağrısını onaylar; onaylanan tekrar gelmez', () => {
  let now = 5_000_000;
  let n = 0;
  const store = createNudgeStore({ now: () => now, id: () => 'a' + (++n) });
  const online = [{ key: 'AVDAN', online: true }, { key: '1.OSB', online: true }];
  const sent = store.send('AVDAN', online);
  assert.equal(store.status().AVDAN.ackAt, null);
  assert.equal(store.status()['1.OSB'], null);

  assert.equal(store.ack('1.OSB', sent.nudge.id).ok, false);
  assert.equal(store.ack('AVDAN', 'yanlis').ok, false);

  now += 1500;
  const acked = store.ack('AVDAN', sent.nudge.id);
  assert.equal(acked.ok, true);
  assert.equal(acked.nudge.ackAt, now);
  assert.equal(store.pending('AVDAN', 0), null);

  now += 1000;
  assert.equal(store.ack('AVDAN', sent.nudge.id).nudge.ackAt, now - 1000);
});

function harness(user) {
  const routes = {};
  const api = {};
  ['get', 'post'].forEach((m) => {
    api[m] = (p, ...h) => { routes[m + ' ' + p] = h; };
  });
  const events = [];
  let now = 2_000_000;
  let n = 0;
  const presence = {
    users: [],
    touch(u) { this.users.push(u && u.username); },
    snapshot() {
      return [
        { key: 'AVDAN', online: this.users.includes('AVDAN') },
        { key: '1.OSB', online: this.users.includes('1.OSB') },
        { key: 'AMIR', online: this.users.includes('xxr') },
        { key: 'SABAN', online: this.users.includes('saban') },
        { key: 'UGUR', online: this.users.includes('ugur') },
      ];
    },
  };
  registerKantarNudgeRoutes(api, {
    sendApiError: (res, err) => { throw err; },
    requireValidSession: (req, res, next) => next(),
    requireAmir: (req, res, next) => {
      if (req.user && req.user.role === 'amir') return next();
      return res.status(403).json({ ok: false, error: 'amir' });
    },
    sanitizeString: (v, max) => String(v || '').slice(0, max),
    broadcastEvent: (type, data) => { events.push({ type, data }); },
    presence,
    nudgeStore: createNudgeStore({ now: () => now, id: () => 'id' + (++n) }),
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
  return { call, events, presence, tick: (ms) => { now += ms; } };
}

test('amir yalnız online tesise nudge yollar; kantar kendi bekleyenini okur', async () => {
  const amir = harness({ username: 'xxr', role: 'amir' });
  const denied = await amir.call('post /nudge', { body: { target: '1.OSB' } });
  assert.equal(denied.status, 409);
  assert.equal(denied.out.code, 'OFFLINE');

  amir.presence.touch({ username: '1.OSB' });
  const sent = await amir.call('post /nudge', { body: { target: '1.OSB' } });
  assert.equal(sent.status, 200);
  assert.equal(sent.out.nudge.target, '1.OSB');
  assert.equal(amir.events[0].type, 'kantar_nudge');

  const kantar = { call: amir.call };
  const mine = await kantar.call('get /nudge', { user: { username: '1.OSB', role: 'admin' }, query: { since: 0 } });
  assert.equal(mine.out.nudge.target, '1.OSB');
  const other = await kantar.call('get /nudge', { user: { username: 'AVDAN', role: 'admin' }, query: { since: 0 } });
  assert.equal(other.out.nudge, null);

  const kantarPost = harness({ username: 'AVDAN', role: 'admin' });
  const blocked = await kantarPost.call('post /nudge', { body: { target: '1.OSB' } });
  assert.equal(blocked.status, 403);
});

test('kantar Tamam deyince amir okundu bilgisini alır', async () => {
  const amir = harness({ username: 'xxr', role: 'amir' });
  amir.presence.touch({ username: 'AVDAN' });
  const sent = await amir.call('post /nudge', { body: { target: 'AVDAN' } });
  const id = sent.out.nudge.id;

  const wrongSite = await amir.call('post /nudge/ack', { user: { username: '1.OSB', role: 'admin' }, body: { id } });
  assert.equal(wrongSite.status, 404);

  amir.tick(2000);
  const ok = await amir.call('post /nudge/ack', { user: { username: 'AVDAN', role: 'admin' }, body: { id } });
  assert.equal(ok.status, 200);
  assert.ok(ok.out.nudge.ackAt);
  const ev = amir.events.find((e) => e.type === 'kantar_nudge_ack');
  assert.equal(ev.data.id, id);

  const status = await amir.call('get /nudge/status', {});
  assert.equal(status.out.status.AVDAN.id, id);
  assert.ok(status.out.status.AVDAN.ackAt);

  const kantarStatus = await amir.call('get /nudge/status', { user: { username: 'AVDAN', role: 'admin' } });
  assert.equal(kantarStatus.status, 403);
});

test('selahattin ve şaban çevrimiçi herkese özel mesaj atar; uğur atamaz', async () => {
  const saban = harness({ username: 'saban', role: 'amir' });
  saban.presence.touch({ username: 'ugur' });
  const missing = await saban.call('post /nudge', { body: { target: 'UGUR', text: '   ' } });
  assert.equal(missing.status, 400);
  assert.equal(missing.out.code, 'BAD_TEXT');

  const sent = await saban.call('post /nudge', { body: { target: 'UGUR', text: 'Ofise gel' } });
  assert.equal(sent.status, 200);
  assert.equal(sent.out.nudge.target, 'UGUR');
  assert.equal(sent.out.nudge.from, 'ŞABAN LAHAÇLAR');
  assert.equal(sent.out.nudge.text, 'Ofise gel');

  const self = await saban.call('post /nudge', { body: { target: 'SABAN', text: 'kendime' } });
  assert.equal(self.status, 400);
  assert.equal(self.out.code, 'SELF');

  const ugur = harness({ username: 'ugur', role: 'amir' });
  ugur.presence.touch({ username: 'xxr' });
  const blocked = await ugur.call('post /nudge', { body: { target: 'AMIR', text: 'selam' } });
  assert.equal(blocked.status, 403);

  const xxr = harness({ username: 'xxr', role: 'amir' });
  xxr.presence.touch({ username: 'saban' });
  const reply = await xxr.call('post /nudge', { body: { target: 'ŞABAN', text: 'geliyorum' } });
  assert.equal(reply.status, 200);
  assert.equal(reply.out.nudge.target, 'SABAN');
  const inbox = await xxr.call('get /nudge', { user: { username: 'saban', role: 'amir' }, query: { since: 0 } });
  assert.equal(inbox.out.nudge.text, 'geliyorum');
});

test('kantar: titreyen, arkası bulanık, Tamam deyince kapanan evrak notu', () => {
  const sm = fs.readFileSync(path.join(__dirname, '../public/session-manager.js'), 'utf8');
  assert.match(sm, /\/api\/nudge/);
  assert.match(sm, /kantar_nudge/);
  assert.match(sm, /function shakeElement/);
  assert.match(sm, /Evrakları sevkiyat ofisine gönderin\./);
  assert.match(sm, /backdrop-filter:blur/);
  assert.match(sm, /gpm-nn-ok/);
  assert.doesNotMatch(sm, /AMİR çağırıyor/);
  assert.doesNotMatch(sm, /prefers-reduced-motion/);
  assert.match(sm, /function startNudge/);
  assert.match(sm, /data-presence-key/);
  assert.match(sm, /\/api\/nudge\/ack/);
  assert.match(sm, /kantar_nudge_ack/);
  assert.match(sm, /NUDGE_RING_MAX = 10/);
  const giris = fs.readFileSync(path.join(__dirname, '../public/GIRIS.html'), 'utf8');
  assert.match(giris, /session-manager\.js\?v=20261010w-sistem/);
  assert.match(sm, /msn-chat\.js/);
  assert.doesNotMatch(sm, /is-chat/);
  const mail = fs.readFileSync(path.join(__dirname, '../public/mailbox.js'), 'utf8');
  assert.match(mail, /Titret/);
  assert.match(mail, /chat\/buzz/);
  const msn = fs.readFileSync(path.join(__dirname, '../public/msn-chat.js'), 'utf8');
  assert.match(msn, /gpmMsnDock/);
  assert.match(msn, /gpm-msn-bubble/);
  assert.match(msn, /login-baret-amir\.png/);
  assert.match(msn, /gpm-msn-emoji-btn/);
  assert.match(msn, /NO_OPEN|mayReply/);
  assert.match(msn, /Titret/);
  assert.match(msn, /gpmMsnBadge/);
  assert.match(msn, /okundu/);
  assert.match(msn, /Hazır/);
  assert.match(sm, /UĞUR AKTAŞ/);
  assert.match(sm, /gönderdi/);
  assert.match(sm, /kullanıcısına gönderildi/);
});

test('kişiye özel mesaj metin ister; kantar metinsiz evrak notu alır', () => {
  let now = 8_000_000;
  const store = createNudgeStore({ now: () => now, id: () => 'dm1' });
  const online = [
    { key: 'UGUR', online: true },
    { key: 'AVDAN', online: true },
  ];
  const empty = store.send('UGUR', online, 'SELAHATTİN TOKER', '   ', 'AMIR');
  assert.equal(empty.code, 'BAD_TEXT');
  const sent = store.send('UGUR', online, 'SELAHATTİN TOKER', 'Kapıya gel', 'AMIR');
  assert.equal(sent.ok, true);
  assert.equal(sent.nudge.text, 'Kapıya gel');
  assert.equal(sent.nudge.fromKey, 'AMIR');
  assert.equal(store.pending('ugur', 0).text, 'Kapıya gel');
  assert.equal(store.pending('xxr', 0), null);
  const kantar = store.send('AVDAN', online, 'ŞABAN LAHAÇLAR');
  assert.equal(kantar.nudge.text, 'Evrakları sevkiyat ofisine gönderin.');
});
