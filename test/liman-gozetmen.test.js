'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  PERIOD_MS,
  prepareState,
  matchLogin,
  applyProfiles,
  applyCredentials,
  recordLogin,
  gateAllows,
  setSlotIpBlock,
  amirView,
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

test('ilk kayıtta gözetmen hesapları üretilir, şirket yetkilileri boş kalır', () => {
  const { state, changed } = prepareState(null, 1_000, seqRandom());
  assert.equal(changed, true);
  assert.equal(state.noticePending, true);
  const gozetmen = state.slots.filter((slot) => slot.grup === 'gozetmen');
  const sirket = state.slots.filter((slot) => slot.grup === 'sirket');
  assert.equal(gozetmen.length, 7);
  assert.equal(sirket.length, 5);
  sirket.forEach((slot) => assert.equal(slot.loginId, ''));
  const ids = gozetmen.map((slot) => slot.loginId);
  const passwords = gozetmen.map((slot) => slot.password);
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

test('giriş sayısı artar, ID veya şifre değişince sıfırlanır', () => {
  const { state } = prepareState(null, 1_000, seqRandom());
  const slot = state.slots[0];
  const hit = matchLogin(state, slot.loginId, slot.password);
  assert.equal(recordLogin(state, hit, 2_000), true);
  assert.equal(recordLogin(state, hit, 3_000), true);
  assert.equal(slot.loginCount, 2);
  assert.equal(slot.lastLoginAt, 3_000);
  const same = applyCredentials(state, [{ grup: slot.grup, n: slot.n, loginId: slot.loginId, password: slot.password }], 4_000);
  assert.equal(same.error, undefined);
  assert.equal(state.slots.find((row) => row.n === slot.n && row.grup === slot.grup).loginCount, 2);
  const changed = applyCredentials(state, [{ grup: slot.grup, n: slot.n, loginId: slot.loginId, password: 'yeni1' }], 5_000);
  assert.equal(changed.error, undefined);
  const fresh = state.slots.find((row) => row.grup === slot.grup && row.n === slot.n);
  assert.equal(fresh.loginCount, 0);
  assert.equal(fresh.lastLoginAt, 0);
});

test('Selahattin’in yazdığı ID ve şifre durur, 40 gün sonra da silinmez', () => {
  const first = prepareState(null, 1_000, seqRandom());
  const kept = prepareState(first.state, 1_000 + PERIOD_MS - 1, seqRandom());
  assert.equal(kept.changed, false);
  assert.equal(kept.state.slots[0].password, first.state.slots[0].password);
  const later = prepareState(first.state, 1_000 + PERIOD_MS, seqRandom(20));
  assert.equal(later.changed, false);
  assert.equal(later.state.slots[0].password, first.state.slots[0].password);
  assert.equal(later.state.slots[0].loginId, first.state.slots[0].loginId);
});

test('yazılan ID ve şifre 40 gün dolmadan durur, xxr ve tekrar kabul edilmez', () => {
  const { state } = prepareState(null, 5_000, seqRandom());
  const gozetmen = state.slots.filter((slot) => slot.grup === 'gozetmen');
  const slots = gozetmen.map((slot, index) => ({
    grup: 'gozetmen',
    n: slot.n,
    loginId: 'k' + index + 'liman',
    password: 'sifre' + (index + 1) + 'a',
  }));
  const bad = applyCredentials(state, [{ n: 1, loginId: 'xxr', password: 'sifre1' }], 6_000);
  assert.match(bad.error, /xxr/);
  assert.notEqual(state.slots[0].loginId, 'xxr');
  const saved = applyCredentials(state, slots, 6_000);
  assert.equal(saved.error, undefined);
  assert.equal(state.slots[0].loginId, 'k0liman');
  assert.equal(state.slots[0].password, 'sifre1a');
  assert.equal(state.noticePending, false);
  const kept = prepareState(state, 6_000 + PERIOD_MS - 1, seqRandom(9));
  assert.equal(kept.changed, false);
  assert.equal(kept.state.slots[0].password, 'sifre1a');
  const short = applyCredentials(state, slots.map((slot, index) => (
    index === 0 ? { n: 1, loginId: 'ab', password: 'sifre1a' } : slot
  )), 7_000);
  assert.match(short.error, /3 ile 12/);
  const long = applyCredentials(state, slots.map((slot, index) => (
    index === 0 ? { n: 1, loginId: 'k0liman', password: 'sifre1a0000000' } : slot
  )), 8_000);
  assert.match(long.error, /4 ile 12/);
});

test('şifre özel karakteri saklar, büyük küçük harf aynı sayılır', () => {
  const { state } = prepareState(null, 9_000, seqRandom());
  const slots = state.slots.filter((slot) => slot.grup === 'gozetmen').map((slot, index) => ({
    grup: 'gozetmen',
    n: slot.n,
    loginId: 'k' + index + 'liman',
    password: index === 0 ? 'Ab!1' : ('sifre' + (index + 1) + 'a'),
  }));
  const saved = applyCredentials(state, slots, 9_000);
  assert.equal(saved.error, undefined);
  assert.equal(state.slots[0].password, 'ab!1');
  assert.equal(matchLogin(state, 'K0LIMAN', 'AB!1').n, 1);
  assert.equal(matchLogin(state, 'k0liman', 'ab1'), null);
});

test('ikinci giriş eski oturumu düşürür, engelli adres bir daha giremez', () => {
  const { state } = prepareState(null, 1_000, seqRandom());
  const slot = state.slots[0];
  const hit = matchLogin(state, slot.loginId, slot.password);
  assert.equal(recordLogin(state, hit, 2_000, '1.1.1.1', 'Telefon'), true);
  const firstSid = slot.sessionId;
  assert.equal(gateAllows(state, { grup: slot.grup, n: slot.n, sid: firstSid }, '1.1.1.1'), true);
  assert.equal(recordLogin(state, hit, 3_000, '2.2.2.2', 'Bilgisayar'), true);
  assert.equal(gateAllows(state, { grup: slot.grup, n: slot.n, sid: firstSid }, '1.1.1.1'), false);
  assert.equal(gateAllows(state, { grup: slot.grup, n: slot.n, sid: slot.sessionId }, '2.2.2.2'), true);
  assert.equal(setSlotIpBlock(state, slot.grup, slot.n, '2.2.2.2', true, 4_000).ok, true);
  assert.equal(recordLogin(state, hit, 5_000, '2.2.2.2', 'Bilgisayar'), false);
  const view = amirView(state, 5_000);
  const ips = view.slots[0].ips;
  assert.equal(ips.find((row) => row.ip === '1.1.1.1').device, 'Telefon');
  assert.equal(ips.find((row) => row.ip === '1.1.1.1').active, false);
  assert.equal(ips.find((row) => row.ip === '2.2.2.2').blocked, true);
  assert.equal(view.slots[0].ips.filter((row) => row.active).length, 0);
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
    JWT_SECRET: 'test-liman-admin',
    verifyLimanAdmin: async (username, password) => username === 'xxr' && password === 'dogru-sifre',
  }, app);

  async function call(key, req) {
    let status = 200;
    let out;
    const headers = {};
    const res = {
      status(code) { status = code; return this; },
      setHeader(name, value) { headers[name] = value; },
      json(data) { out = data; return data; },
    };
    await routes[key](req, res);
    return { status, out, headers };
  }

  const bad = await call('app post /api/liman/gate', {
    body: { username: 'Gözetmen 1', password: '000000' },
    headers: {},
  });
  assert.equal(bad.status, 401);

  const view = await call('api get /liman/gozetmen', { user: { username: 'xxr', role: 'amir' }, headers: {} });
  assert.equal(view.out.slots.length, 12);
  assert.equal(view.out.canEditCredentials, true);
  assert.equal(view.out.noticePending, true);
  const third = view.out.slots.find((slot) => slot.grup === 'gozetmen' && slot.n === 3);
  assert.match(third.loginId, /^[a-z]{4}$/);
  const password = third.password;

  const good = await call('app post /api/liman/gate', {
    body: { username: third.loginId, password },
    headers: {},
  });
  assert.equal(good.status, 200);
  assert.equal(good.out.n, 3);
  assert.match(good.headers['Set-Cookie'], /liman_gate=/);
  assert.match(good.headers['Set-Cookie'], /HttpOnly/);
  const counted = await call('api get /liman/gozetmen', { user: { username: 'xxr', role: 'amir' }, headers: {} });
  const countedSlot = counted.out.slots.find((slot) => slot.grup === 'gozetmen' && slot.n === 3);
  assert.equal(countedSlot.loginCount, 1);
  assert.ok(countedSlot.lastLoginAt > 0);

  const saved = await call('api put /liman/gozetmen', {
    user: { username: 'saban', role: 'amir' },
    body: { slots: [{ n: 3, ad: 'Ayşe', soyad: 'Demir', telefon: '0555 000 11 22' }] },
    headers: {},
  });
  assert.equal(saved.out.slots.find((slot) => slot.grup === 'gozetmen' && slot.n === 3).ad, 'Ayşe');
  assert.equal(saved.out.slots.find((slot) => slot.grup === 'gozetmen' && slot.n === 3).password, password);
  assert.equal(saved.out.canEditCredentials, false);

  const ignored = await call('api put /liman/gozetmen', {
    user: { username: 'saban', role: 'amir' },
    body: { slots: [{ grup: 'gozetmen', n: 3, loginId: 'baskasi', password: 'baska1' }] },
    headers: {},
  });
  assert.equal(ignored.out.slots.find((slot) => slot.grup === 'gozetmen' && slot.n === 3).loginId, third.loginId);

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

  const wrongAdmin = await call('app post /api/liman/gate', {
    body: { username: 'XXR', password: 'yanlis' },
    headers: {},
  });
  assert.equal(wrongAdmin.status, 401);

  const admin = await call('app post /api/liman/gate', {
    body: { username: 'xxr', password: 'dogru-sifre' },
    headers: {},
  });
  assert.equal(admin.status, 200);
  assert.equal(admin.out.manage, true);
  assert.equal(typeof admin.out.token, 'string');

  const deniedList = await call('app get /api/liman/gozetmen/tanim', { headers: {} });
  assert.equal(deniedList.status, 401);

  const listed = await call('app get /api/liman/gozetmen/tanim', {
    headers: { authorization: 'Bearer ' + admin.out.token },
  });
  assert.equal(listed.status, 200);
  assert.equal(listed.out.slots.length, 12);

  const defined = listed.out.slots.filter((slot) => slot.grup === 'gozetmen').map((slot, index) => ({
    grup: 'gozetmen',
    n: slot.n,
    loginId: 'lim' + (index + 1),
    password: 'kap' + (index + 1) + 'x',
  }));
  defined.push({ grup: 'sirket', n: 1, loginId: 'ofis1', password: 'ofis12' });
  const wrote = await call('app put /api/liman/gozetmen/tanim', {
    headers: { authorization: 'Bearer ' + admin.out.token },
    body: { slots: defined },
  });
  assert.equal(wrote.status, 200);
  assert.equal(wrote.out.slots.find((slot) => slot.grup === 'gozetmen' && slot.n === 1).loginId, 'lim1');
  assert.equal(wrote.out.slots.find((slot) => slot.grup === 'sirket' && slot.n === 1).loginId, 'ofis1');
  assert.equal(wrote.out.noticePending, false);

  const officeIp = { 'x-forwarded-for': '10.8.0.4' };
  for (let i = 0; i < 20; i++) {
    const miss = await call('app post /api/liman/gate', {
      body: { username: 'ofis1', password: 'yanlis' },
      headers: officeIp,
    });
    assert.equal(miss.status, 401);
    assert.notEqual(miss.out.error, 'Çok fazla deneme. Biraz sonra tekrar deneyin.');
  }
  const entered = await call('app post /api/liman/gate', {
    body: { username: 'LIM1', password: 'KAP1X' },
    headers: officeIp,
  });
  assert.equal(entered.status, 200);
  assert.equal(entered.out.n, 1);
  const office = await call('app post /api/liman/gate', {
    body: { username: 'ofis1', password: 'ofis12' },
    headers: officeIp,
  });
  assert.equal(office.status, 200);
  assert.equal(office.out.grup, 'sirket');
  assert.equal(office.out.label, 'Yetkili 1');
});
