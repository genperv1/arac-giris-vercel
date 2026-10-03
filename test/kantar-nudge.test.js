'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  normalizeTarget,
  siteFromUsername,
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
        { key: 'AMIR', online: true },
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

test('istemci her sayfada SSE + poll ve sarsıntı / bip bağlar', () => {
  const sm = fs.readFileSync(path.join(__dirname, '../public/session-manager.js'), 'utf8');
  assert.match(sm, /\/api\/nudge/);
  assert.match(sm, /kantar_nudge/);
  assert.match(sm, /gpm-nudge-shake/);
  assert.match(sm, /AMİR çağırıyor/);
  assert.match(sm, /function startNudge/);
  assert.match(sm, /data-presence-key/);
  const giris = fs.readFileSync(path.join(__dirname, '../public/GIRIS.html'), 'utf8');
  assert.match(giris, /session-manager\.js\?v=20261004-nudge1/);
});
