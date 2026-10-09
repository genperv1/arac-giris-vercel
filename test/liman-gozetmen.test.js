'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  PERIOD_MS,
  prepareState,
  matchLogin,
  applyProfiles,
  ackNotice,
} = require('../lib/liman-gozetmen');
const { registerLimanGozetmenRoutes } = require('../routes/liman-gozetmen-routes');

function seqRandom(seed) {
  let n = seed || 0;
  return (span) => {
    n += 1;
    const size = span || 1;
    return (n * 7919) % size;
  };
}

test('ilk kayıtta 7 hesabın ID ve şifresi üretilir', () => {
  const { state, changed } = prepareState(null, 1_000, seqRandom());
  assert.equal(changed, true);
  assert.equal(state.noticePending, true);
  assert.equal(state.slots.length, 7);
  const ids = state.slots.map((slot) => slot.loginId);
  const passwords = state.slots.map((slot) => slot.password);
  assert.equal(new Set(ids).size, 7);
  assert.equal(new Set(passwords).size, 7);
  ids.forEach((id) => assert.match(id, /^[a-z]{4}$/));
  passwords.forEach((password) => assert.match(password, /^[a-z]{2}\d{4}$/));
});

test('giriş verilen ID ve şifreyle olur, başkasının şifresi açmaz', () => {
  const { state } = prepareState(null, 1_000, seqRandom());
  const first = matchLogin(state, state.slots[0].loginId.toUpperCase(), state.slots[0].password);
  assert.equal(first && first.n, 1);
  assert.equal(matchLogin(state, state.slots[1].loginId, state.slots[1].password).n, 2);
  assert.equal(matchLogin(state, state.slots[0].loginId, state.slots[1].password), null);
  assert.equal(matchLogin(state, 'Gözetmen 1', state.slots[0].password), null);
});

test('40 gün dolmadan şifre aynı kalır, dolunca yedisi birden değişir', () => {
  const first = prepareState(null, 1_000, seqRandom());
  const kept = prepareState(first.state, 1_000 + PERIOD_MS - 1, seqRandom());
  assert.equal(kept.changed, false);
  assert.equal(kept.state.slots[0].password, first.state.slots[0].password);
  const rotated = prepareState(first.state, 1_000 + PERIOD_MS, seqRandom(20));
  assert.equal(rotated.changed, true);
  assert.equal(rotated.state.noticePending, true);
  assert.notEqual(rotated.state.slots[0].password, first.state.slots[0].password);
  assert.notEqual(rotated.state.slots[0].loginId, first.state.slots[0].loginId);
  assert.equal(rotated.state.slots.length, 7);
});

test('ad soyad telefon kaydı şifreyi değiştirmez; bildirim yalnız aynı dönemi kapatır', () => {
  const { state } = prepareState(null, 5_000, seqRandom());
  const password = state.slots[0].password;
  applyProfiles(state, [{ n: 1, ad: 'Ali', soyad: 'Yılmaz', telefon: '0532 111 22 33 abc' }]);
  assert.equal(state.slots[0].ad, 'Ali');
  assert.equal(state.slots[0].soyad, 'Yılmaz');
  assert.equal(state.slots[0].telefon, '0532 111 22 33');
  assert.equal(state.slots[0].password, password);
  const missed = ackNotice(state, 1, 6_000);
  assert.equal(missed.changed, false);
  assert.equal(state.noticePending, true);
  const acked = ackNotice(state, state.issuedAt, 6_000);
  assert.equal(acked.changed, true);
  assert.equal(state.noticePending, false);
});

function kvQ(store) {
  return async (sql, params) => {
    if (/^SELECT/i.test(sql)) return { rows: store[params[0]] ? [{ value: store[params[0]] }] : [] };
    store[params[0]] = params[1];
    return { rows: [{ key: params[0] }], rowCount: 1 };
  };
}

test('giriş ucu doğru gözetmeni açar, amir listesi şifreyi gösterir, başkası bildirimi kapatamaz', async () => {
  const store = {};
  const routes = {};
  const api = {};
  const app = {};
  ['get', 'put', 'post'].forEach((method) => {
    api[method] = (path, ...handlers) => { routes['api ' + method + ' ' + path] = handlers[handlers.length - 1]; };
    app[method] = (path, ...handlers) => { routes['app ' + method + ' ' + path] = handlers[handlers.length - 1]; };
  });
  const pass = (req, res, next) => next();
  registerLimanGozetmenRoutes(api, {
    q: kvQ(store),
    requireAmir: pass,
    requireValidSession: pass,
  }, app);

  async function call(key, req) {
    let status = 200;
    let out;
    const res = {
      status(code) { status = code; return this; },
      setHeader() {},
      json(data) { out = data; return data; },
    };
    await routes[key](req, res);
    return { status, out };
  }

  const bad = await call('app post /api/liman/gate', {
    body: { username: 'Gözetmen 1', password: '000000' },
    headers: {},
  });
  assert.equal(bad.status, 401);

  const view = await call('api get /liman/gozetmen', { user: { username: 'xxr', role: 'amir' }, headers: {} });
  assert.equal(view.out.slots.length, 7);
  assert.equal(view.out.noticePending, true);
  assert.match(view.out.slots[2].loginId, /^[a-z]{4}$/);
  const password = view.out.slots[2].password;

  const good = await call('app post /api/liman/gate', {
    body: { username: view.out.slots[2].loginId, password },
    headers: {},
  });
  assert.equal(good.status, 200);
  assert.equal(good.out.n, 3);

  const saved = await call('api put /liman/gozetmen', {
    user: { username: 'saban', role: 'amir' },
    body: { slots: [{ n: 3, ad: 'Ayşe', soyad: 'Demir', telefon: '0555 000 11 22' }] },
    headers: {},
  });
  assert.equal(saved.out.slots[2].ad, 'Ayşe');
  assert.equal(saved.out.slots[2].password, password);
  assert.equal(saved.out.slots[2].loginId, view.out.slots[2].loginId);

  const denied = await call('api post /liman/gozetmen/ack', {
    user: { username: 'saban', role: 'amir' },
    body: { issuedAt: view.out.issuedAt },
    headers: {},
  });
  assert.equal(denied.status, 403);

  const acked = await call('api post /liman/gozetmen/ack', {
    user: { username: 'xxr', role: 'amir' },
    body: { issuedAt: view.out.issuedAt },
    headers: {},
  });
  assert.equal(acked.out.noticePending, false);
});
