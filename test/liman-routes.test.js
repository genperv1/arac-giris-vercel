'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { registerLimanRoutes, departedDataFields } = require('../routes/liman-routes');

function kvQ(store) {
  return async (sql, params) => {
    if (/print_history/i.test(sql)) return { rows: [] };
    if (/^SELECT/i.test(sql)) return { rows: store[params[0]] ? [{ value: store[params[0]] }] : [] };
    const current = store[params[0]];
    const expected = params[2];
    if (expected !== undefined && current != null && current !== expected) {
      return { rows: [], rowCount: 0 };
    }
    store[params[0]] = params[1];
    return { rows: [{ key: params[0] }], rowCount: 1 };
  };
}

function harness(user) {
  const store = {};
  const routes = {};
  const api = {};
  const touched = [];
  ['get', 'put', 'post', 'delete'].forEach((m) => {
    api[m] = (path, ...handlers) => { routes[m + ' ' + path] = handlers[handlers.length - 1]; };
  });
  const pass = (req, res, next) => next();
  registerLimanRoutes(api, {
    q: kvQ(store),
    sendApiError: (res, err) => { throw err; },
    requireValidSession: pass,
    requireAmir: pass,
    sanitizeString: (v, n) => String(v || '').slice(0, n),
    getClientIp: (req) => req.headers['x-forwarded-for'],
    normalizeClientIp: (ip) => ip,
    presence: {
      touch: (u) => { touched.push(u && u.username); },
      snapshot: () => [{ key: '1.OSB', label: '1.OSB', online: touched.includes('1.OSB'), lastSeen: Date.now() }],
    },
  });
  const call = async (key, ip, body, params) => {
    let out;
    await routes[key]({ user, body, params: params || {}, headers: { 'x-forwarded-for': ip } }, {
      json: (d) => { out = d; return d; },
      status() { return this; },
      setHeader() {},
    });
    return out;
  };
  return { call, store, touched };
}

const block = (title, yukleme) => ({ title, liman: 'SAFİPORT', fileName: '03.10.2026.xlsx', rows: [{ sira: '1', plaka: '43RY761', yukleme }] });

test('1.OSB IP\'sinden gelen liste onaysız 1.OSB olarak işlenir', async () => {
  const { call } = harness({ username: 'GENPER', role: 'admin' });
  const put = await call('put /liman/snapshot', '195.175.103.150', { site: 'AVDAN', fileName: '03.10.2026.xlsx', blocks: [block('YD15 / LOT NO 26 07 30 / SAFİPORT', 'AVDAN')] });
  assert.equal(put.site, '1.OSB');
  const view = await call('get /liman', '1.1.1.1');
  assert.equal(view.sites['1.OSB'].rowCount, 1);
  assert.equal(view.days[0].blocks.length, 1);
});

test('bilinmeyen IP basım yeri ya da yükleme yeri ile kabul edilir', async () => {
  const { call } = harness({ username: 'GENPER', role: 'admin' });
  const put = await call('put /liman/snapshot', '10.0.0.9', { site: '', fileName: '03.10.2026.xlsx', blocks: [block('YD47 / LOT NO 26 08 32 / SAFİPORT', 'AVDAN')] });
  assert.equal(put.site, 'AVDAN');
});

test('kantar kullanıcı adı IP\'den önce gelir', async () => {
  const { call } = harness({ username: 'AVDAN', role: 'admin' });
  const put = await call('put /liman/snapshot', '195.175.103.150', { site: '1.OSB', blocks: [block('YD47 / LOT NO 26 08 32 / SAFİPORT', '1.OSB')] });
  assert.equal(put.site, 'AVDAN');
});

test('amir günü kapatınca liman o günü görmez; sonraki gün kalır, yeniden açılabilir', async () => {
  const kantar = { username: 'AVDAN', role: 'admin' };
  const amir = { username: 'xxr', role: 'amir' };
  const h = harness(kantar);
  const nextBlock = Object.assign({}, block('YD2 / LOT NO 2 / EVYAP', 'AVDAN'), { fileName: '04.10.2026.xlsx' });
  await h.call('put /liman/snapshot', '95.3.27.82', {
    site: 'AVDAN', fileName: '03.10.2026.xlsx',
    blocks: [block('YD1 / LOT NO 1 / SAFİPORT', 'AVDAN'), nextBlock],
  });
  let view = await h.call('get /liman', '1.1.1.1');
  assert.deepEqual(view.days.map((d) => d.dateKey), ['2026-10-04', '2026-10-03']);
  assert.deepEqual(view.closedDays, []);

  // Amir aynı depo üzerinden kapatır (ayrı harness, aynı kv_store)
  const a = harness(amir);
  Object.assign(a.store, h.store);
  const closed = await a.call('put /liman/day/:dateKey/close', '1.1.1.1', {}, { dateKey: '2026-10-03' });
  assert.deepEqual(closed.days.map((d) => d.dateKey), ['2026-10-04']);
  assert.equal(closed.closedDays.length, 1);
  assert.equal(closed.closedDays[0].label, '03.10.2026');
  assert.equal(closed.closedDays[0].by, 'xxr');

  // Kantar aynı dosyayı yeniden gönderse de gün kapalı kalır; kantar kapalı listeyi görmez
  const k2 = harness(kantar);
  Object.assign(k2.store, a.store);
  await k2.call('put /liman/snapshot', '95.3.27.82', {
    site: 'AVDAN', fileName: '03.10.2026.xlsx',
    blocks: [block('YD1 / LOT NO 1 / SAFİPORT', 'AVDAN'), nextBlock, block('YD9 / LOT NO 9 / EVYAP', 'AVDAN')],
  });
  view = await k2.call('get /liman', '1.1.1.1');
  assert.deepEqual(view.days.map((d) => d.dateKey), ['2026-10-04']);
  assert.deepEqual(view.closedDays.map((c) => c.label), ['03.10.2026']);

  // Son gün de kapatılınca liste boş
  const a2 = harness(amir);
  Object.assign(a2.store, k2.store);
  const allClosed = await a2.call('put /liman/day/:dateKey/close', '1.1.1.1', {}, { dateKey: '2026-10-04' });
  assert.deepEqual(allClosed.days, []);
  assert.equal(allClosed.closedDays.length, 2);

  // Yeniden aç
  const reopened = await a2.call('delete /liman/day/:dateKey/close', '1.1.1.1', {}, { dateKey: '2026-10-03' });
  assert.deepEqual(reopened.days.map((d) => d.dateKey), ['2026-10-03']);
  assert.deepEqual(reopened.closedDays.map((c) => c.dateKey), ['2026-10-04']);

  // Olmayan gün / bozuk anahtar reddedilir
  const bad = await a2.call('put /liman/day/:dateKey/close', '1.1.1.1', {}, { dateKey: '2026-12-31' });
  assert.equal(bad.ok, false);
  const badKey = await a2.call('put /liman/day/:dateKey/close', '1.1.1.1', {}, { dateKey: 'x' });
  assert.equal(badKey.ok, false);
});

test('liman okuma uçları oturumsuz çalışır (canEdit false, kapalı günler görünür)', async () => {
  const k = harness({ username: 'AVDAN', role: 'admin' });
  await k.call('put /liman/snapshot', '95.3.27.82', { site: 'AVDAN', fileName: '03.10.2026.xlsx', blocks: [block('YD1 / LOT NO 1 / EVYAP', 'AVDAN')] });
  const anon = harness(undefined);
  Object.assign(anon.store, k.store);
  const view = await anon.call('get /liman', '5.5.5.5');
  assert.equal(view.ok, true);
  assert.equal(view.canEdit, false);
  assert.equal(view.days.length, 1);
  const ver = await anon.call('get /liman/version', '5.5.5.5');
  assert.ok(ver.v);
});

test('publicApp verilince GET + kantar yazma uçları /api öneki ile app\'e, amir uçları router\'a bağlanır', () => {
  const appRoutes = [];
  const apiRoutes = [];
  const mk = (list) => {
    const r = {};
    ['get', 'put', 'post', 'delete'].forEach((m) => { r[m] = (p) => list.push(m + ' ' + p); });
    return r;
  };
  registerLimanRoutes(mk(apiRoutes), {
    q: async () => ({ rows: [] }), sendApiError() {}, requireValidSession: (q, s, n) => n(), requireAmir: (q, s, n) => n(),
    sanitizeString: (v) => String(v || ''),
  }, mk(appRoutes));
  assert.deepEqual(appRoutes.filter((r) => r.startsWith('get ')), ['get /api/liman', 'get /api/liman/version', 'get /api/liman/departed']);
  // Kantar yazma uçları app'te: kendi oturum kontrolü + red günlüğü (401 sessiz kaybolmasın)
  assert.ok(appRoutes.includes('put /api/liman/snapshot'));
  assert.ok(appRoutes.includes('put /api/liman/heartbeat'));
  assert.ok(apiRoutes.includes('put /liman/day/:dateKey/close'));
  assert.ok(!apiRoutes.some((r) => r.startsWith('get ')));
  assert.ok(!apiRoutes.includes('put /liman/snapshot'));
});

test('publicApp modunda oturumsuz kantar gönderimi 401 + günlükte "denied"; nabız amire görünür', async () => {
  const store = {};
  const routes = {};
  const mk = () => {
    const r = {};
    ['get', 'put', 'post', 'delete'].forEach((m) => {
      r[m] = (path, ...handlers) => { routes[m + ' ' + path] = handlers; };
    });
    return r;
  };
  registerLimanRoutes(mk(), {
    q: kvQ(store),
    sendApiError: (res, err) => { throw err; },
    requireValidSession: (q, s, n) => n(),
    requireAmir: (q, s, n) => n(),
    sanitizeString: (v, n) => String(v || '').slice(0, n),
    getClientIp: (req) => req.headers['x-forwarded-for'],
    normalizeClientIp: (ip) => ip,
    JWT_SECRET: 'test-secret',
  }, mk());
  const run = async (key, req) => {
    const chain = routes[key];
    let out; let statusCode = 200;
    const res = { json: (d) => { out = d; return d; }, status(c) { statusCode = c; return this; }, setHeader() {} };
    const r = Object.assign({ body: {}, params: {}, headers: {}, cookies: {} }, req);
    for (let i = 0; i < chain.length; i++) {
      let nextCalled = false;
      await chain[i](r, res, () => { nextCalled = true; });
      if (!nextCalled) break;
    }
    return { out, statusCode };
  };
  // Oturumsuz gönderim: 401 SESSION_MISSING
  const denied = await run('put /api/liman/snapshot', { headers: { 'x-forwarded-for': '9.9.9.9' }, body: { site: 'AVDAN', blocks: [block('YD1 / LOT NO 1 / EVYAP', 'AVDAN')] } });
  assert.equal(denied.statusCode, 401);
  assert.equal(denied.out.code, 'SESSION_MISSING');
  // Süresi dolmuş JWT: 401 SESSION_EXPIRED
  const jwt = require('jsonwebtoken');
  const expired = jwt.sign({ username: 'AVDAN', role: 'admin' }, 'test-secret', { expiresIn: -10 });
  const exp = await run('put /api/liman/snapshot', { headers: { 'x-forwarded-for': '9.9.9.9', cookie: 'auth_token=' + expired }, cookies: { auth_token: expired }, body: { site: 'AVDAN', blocks: [] } });
  assert.equal(exp.statusCode, 401);
  assert.equal(exp.out.code, 'SESSION_EXPIRED');
  // Geçerli JWT: nabız kabul edilir, sürüm değişmez (liman sayfası yeniden yüklenmez)
  const good = jwt.sign({ username: 'AVDAN', role: 'admin' }, 'test-secret', { expiresIn: '1h' });
  const before = (await run('get /api/liman/version', { headers: {} })).out.v;
  const hb = await run('put /api/liman/heartbeat', { headers: { 'x-forwarded-for': '9.9.9.9', cookie: 'auth_token=' + good }, cookies: { auth_token: good }, body: { excelLoaded: false } });
  assert.equal(hb.statusCode, 200);
  assert.equal(hb.out.site, 'AVDAN');
  const after = (await run('get /api/liman/version', { headers: {} })).out.v;
  assert.equal(before, after);
  // Anonim görünüm: nabız görünür, günlük görünmez
  const anon = (await run('get /api/liman', { headers: {} })).out;
  assert.equal(anon.sites.AVDAN.hasList, false);
  assert.ok(anon.sites.AVDAN.heartbeatAt);
  assert.equal(anon.sites.AVDAN.heartbeatExcel, false);
  assert.equal(anon.events, undefined);
  // Amir görünümü: günlükte 2 red + 1 nabız
  const amirTok = jwt.sign({ username: 'xxr', role: 'amir' }, 'test-secret', { expiresIn: '1h' });
  const amir = (await run('get /api/liman', { headers: { cookie: 'auth_token=' + amirTok }, cookies: { auth_token: amirTok }, user: { username: 'xxr', role: 'amir' } })).out;
  assert.deepEqual(amir.events.map((e) => e.kind), ['heartbeat', 'denied', 'denied']);
  assert.equal(amir.events[1].reason, 'expired');
  assert.equal(amir.events[2].reason, 'no-token');
});

test('diğer kantarın eski İÇERİDE notu çıkmış aracı kirletmez; aynı içerik receivedAt günceller', async () => {
  const mk = (durum, giden) => ({
    title: 'YD172(G) / LOT NO 26 09 24 / YILPORT', liman: 'YILPORT', fileName: '03.10.2026.xlsx',
    rows: [{ sira: '2', plaka: '43ADT546', yukleme: 'AVDAN', durum, giden, bbt: '20' }],
  });
  // 1.OSB eski liste: araç içeride
  const osb = harness({ username: '1.OSB', role: 'admin' });
  await osb.call('put /liman/snapshot', '1.1.1.1', { site: '1.OSB', fileName: '03.10.2026.xlsx', blocks: [mk('İÇERİDE', '')] });
  // AVDAN yeni liste: araç çıkmış, not silinmiş
  const avdan = harness({ username: 'AVDAN', role: 'admin' });
  Object.assign(avdan.store, osb.store);
  const first = await avdan.call('put /liman/snapshot', '1.1.1.1', { site: 'AVDAN', fileName: '03.10.2026.xlsx', blocks: [mk('', '26000')] });
  assert.equal(first.unchanged, undefined);
  let view = await avdan.call('get /liman', '1.1.1.1');
  const row = view.days[0].blocks[0].rows[0];
  assert.equal(row.durum, '');
  assert.equal(row.gidenTonaj, '26000');
  const firstUpdated = view.sites.AVDAN.updatedAt;
  assert.equal(view.sites.AVDAN.receivedAt, firstUpdated);

  // Aynı içerik tekrar gönderilince: updatedAt sabit, receivedAt ilerler
  await new Promise((r) => setTimeout(r, 5));
  const again = await avdan.call('put /liman/snapshot', '1.1.1.1', { site: 'AVDAN', fileName: '03.10.2026.xlsx', blocks: [mk('', '26000')] });
  assert.equal(again.unchanged, true);
  view = await avdan.call('get /liman', '1.1.1.1');
  assert.equal(view.sites.AVDAN.updatedAt, firstUpdated);
  assert.ok(view.sites.AVDAN.receivedAt > firstUpdated);

  // Tek kantar, giden girilmiş ama not unutulmuş → durum temizlenir
  const solo = harness({ username: 'AVDAN', role: 'admin' });
  await solo.call('put /liman/snapshot', '1.1.1.1', { site: 'AVDAN', fileName: '04.10.2026.xlsx', blocks: [Object.assign(mk('İÇERİDE', '26000'), { fileName: '04.10.2026.xlsx' })] });
  const v2 = await solo.call('get /liman', '1.1.1.1');
  assert.equal(v2.days[0].blocks[0].rows[0].durum, '');
});

test('kantar liste gönderince presence online olur', async () => {
  const { call, touched } = harness({ username: '1.OSB', role: 'admin' });
  await call('put /liman/snapshot', '1.1.1.1', { site: '1.OSB', fileName: '04.10.2026.xlsx', blocks: [block('YD1 / LOT NO 1 / EVYAP', '1.OSB')] });
  assert.deepEqual(touched, ['1.OSB']);
});

test('amir gönderimi yok sayılır', async () => {
  const { call, store } = harness({ username: 'xxr', role: 'amir' });
  const put = await call('put /liman/snapshot', '95.3.27.82', { site: 'AVDAN', blocks: [block('YD1 / LOT NO 1 / EVYAP', 'AVDAN')] });
  assert.equal(put.skipped, true);
  assert.deepEqual(store, {});
});

test('anonim departed PII kırpar; oturumlu bırakır', () => {
  const d = { plaka: '43RY761', sofor: 'Ali', iletisim: '555', firma: 'X', malzeme: 'P1' };
  const inst = { tarih: '03.10.2026', saat: '10:00' };
  const anon = departedDataFields(d, inst, false);
  assert.equal(anon.plaka, '43RY761');
  assert.equal(anon.sofor, '');
  assert.equal(anon.iletisim, '');
  const authed = departedDataFields(d, inst, true);
  assert.equal(authed.sofor, 'Ali');
  assert.equal(authed.iletisim, '555');
});

test('çakışan liman yazımı 409 döner', async () => {
  const store = { liman_state_v1: JSON.stringify({ sites: { AVDAN: { fileName: 'stale.xlsx', updatedAt: '1', rows: [], blocks: [] } } }) };
  const routes = {};
  const api = {};
  ['get', 'put', 'post', 'delete'].forEach((m) => {
    api[m] = (path, ...handlers) => { routes[m + ' ' + path] = handlers[handlers.length - 1]; };
  });
  let writes = 0;
  registerLimanRoutes(api, {
    q: async (sql, params) => {
      if (/^SELECT/i.test(sql)) return { rows: [{ value: store[params[0]] }] };
      writes += 1;
      return { rows: [], rowCount: 0 };
    },
    sendApiError: (res, err) => { throw err; },
    requireValidSession: (q, s, n) => n(),
    requireAmir: (q, s, n) => n(),
    sanitizeString: (v, n) => String(v || '').slice(0, n),
    getClientIp: () => '95.3.27.82',
    normalizeClientIp: (ip) => ip,
  });
  let out; let status = 200;
  const res = { json: (d) => { out = d; return d; }, status(c) { status = c; return this; }, setHeader() {} };
  await routes['put /liman/heartbeat']({
    user: { username: 'AVDAN', role: 'admin' },
    body: { excelLoaded: true },
    headers: { 'x-forwarded-for': '95.3.27.82' },
  }, res);
  assert.equal(status, 409);
  assert.equal(out.ok, false);
  assert.ok(writes >= 3);
});
