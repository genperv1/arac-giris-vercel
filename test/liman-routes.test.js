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

test('alt sekme sırası: Excel\'in limana ilk geliş sırası korunur, yeni Excel sona eklenir', async () => {
  const { call } = harness({ username: 'AVDAN', role: 'admin' });
  const b = (title, fileName) => ({ title, liman: 'EVYAP', fileName, rows: [{ sira: '1', plaka: '43RY761' }] });
  await call('put /liman/snapshot', '95.3.27.82', {
    fileName: '03.10.2026.xlsx + 03.10.2026-YD28.xlsx',
    blocks: [b('YD02 / LOT NO 1 / EVYAP', '03.10.2026.xlsx'), b('YD28 / LOT NO 2 / EVYAP', '03.10.2026-YD28.xlsx')],
  });
  await call('put /liman/snapshot', '95.3.27.82', {
    fileName: '05.10.2026.xlsx + 03.10.2026.xlsx + 03.10.2026-YD28.xlsx',
    blocks: [b('YD05 / LOT NO 3 / EVYAP', '05.10.2026.xlsx'), b('YD02 / LOT NO 1 / EVYAP', '03.10.2026.xlsx'), b('YD28 / LOT NO 2 / EVYAP', '03.10.2026-YD28.xlsx')],
  });
  const view = await call('get /liman', '1.1.1.1');
  const order = Object.keys(view.fileOrder).sort((x, y) => Date.parse(view.fileOrder[x]) - Date.parse(view.fileOrder[y]));
  assert.deepEqual(order, ['03.10.2026', '03.10.2026-YD28', '05.10.2026']);
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
  assert.equal(reopened.canClose, true);
});

test('listeyi kapatma, açma ve kaldırma yalnız Selahattin Toker hesabında', async () => {
  const kantar = { username: 'AVDAN', role: 'admin' };
  const h = harness(kantar);
  await h.call('put /liman/snapshot', '95.3.27.82', {
    site: 'AVDAN', fileName: '03.10.2026.xlsx',
    blocks: [block('YD1 / LOT NO 1 / SAFİPORT', 'AVDAN')],
  });

  const denied = [
    { username: 'saban', role: 'amir' },
    { username: 'ugur', role: 'amir' },
    { username: 'AVDAN', role: 'admin' },
    { username: '1.OSB', role: 'admin' },
  ];
  for (const user of denied) {
    const other = harness(user);
    Object.assign(other.store, h.store);
    const view = await other.call('get /liman', '1.1.1.1');
    assert.equal(view.canClose, false, user.username);
    const closed = await other.call('put /liman/day/:dateKey/close', '1.1.1.1', {}, { dateKey: '2026-10-03' });
    assert.equal(closed.ok, false, user.username);
    const reopened = await other.call('delete /liman/day/:dateKey/close', '1.1.1.1', {}, { dateKey: '2026-10-03' });
    assert.equal(reopened.ok, false, user.username);
    const removed = await other.call('delete /liman/snapshot/:site', '1.1.1.1', {}, { site: 'AVDAN' });
    assert.equal(removed.ok, false, user.username);
    const after = await other.call('get /liman', '1.1.1.1');
    assert.deepEqual(after.days.map((d) => d.dateKey), ['2026-10-03'], user.username);
    assert.deepEqual(after.closedDays, [], user.username);
  }

  const still = await h.call('get /liman', '1.1.1.1');
  assert.deepEqual(still.days.map((d) => d.dateKey), ['2026-10-03']);
  assert.deepEqual(still.closedDays, []);
  assert.equal(still.canClose, false);

  const selahattin = harness({ username: 'xxr', role: 'amir' });
  Object.assign(selahattin.store, h.store);
  const mine = await selahattin.call('get /liman', '1.1.1.1');
  assert.equal(mine.canEdit, true);
  assert.equal(mine.canClose, true);
  const closed = await selahattin.call('put /liman/day/:dateKey/close', '1.1.1.1', {}, { dateKey: '2026-10-03' });
  assert.deepEqual(closed.days, []);
  assert.equal(closed.closedDays[0].by, 'xxr');
  const opened = await selahattin.call('delete /liman/day/:dateKey/close', '1.1.1.1', {}, { dateKey: '2026-10-03' });
  assert.deepEqual(opened.days.map((d) => d.dateKey), ['2026-10-03']);
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
  // Router'daki tek GET'ler amire özel arşiv uçları
  assert.deepEqual(apiRoutes.filter((r) => r.startsWith('get ')), ['get /liman/archive', 'get /liman/archive/:dateKey']);
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
  assert.equal(anon.sites.AVDAN.heartbeatReadOk, null);
  // Okuma sonucu: başarılı okuma zamanı saklanır, sonraki başarısız okumada korunur
  const hdr = { headers: { 'x-forwarded-for': '9.9.9.9', cookie: 'auth_token=' + good }, cookies: { auth_token: good } };
  await run('put /api/liman/heartbeat', Object.assign({ body: { excelLoaded: true, readOk: true } }, hdr));
  const okView = (await run('get /api/liman', { headers: {} })).out.sites.AVDAN;
  assert.equal(okView.heartbeatReadOk, true);
  assert.ok(okView.heartbeatReadOkAt);
  await run('put /api/liman/heartbeat', Object.assign({ body: { excelLoaded: true, readOk: false, readReason: 'permission' } }, hdr));
  const badView = (await run('get /api/liman', { headers: {} })).out.sites.AVDAN;
  assert.equal(badView.heartbeatReadOk, false);
  assert.equal(badView.heartbeatReadReason, 'permission');
  assert.equal(badView.heartbeatReadOkAt, okView.heartbeatReadOkAt);
  await run('put /api/liman/heartbeat', Object.assign({ body: { excelLoaded: true } }, hdr));
  const keptView = (await run('get /api/liman', { headers: {} })).out.sites.AVDAN;
  assert.equal(keptView.heartbeatReadOk, false);
  assert.equal(keptView.heartbeatReadReason, 'permission');
  // Amir görünümü: günlükte 2 red + nabızlar
  const amirTok = jwt.sign({ username: 'xxr', role: 'amir' }, 'test-secret', { expiresIn: '1h' });
  const amir = (await run('get /api/liman', { headers: { cookie: 'auth_token=' + amirTok }, cookies: { auth_token: amirTok }, user: { username: 'xxr', role: 'amir' } })).out;
  assert.deepEqual(amir.events.map((e) => e.kind), ['heartbeat', 'heartbeat', 'heartbeat', 'heartbeat', 'denied', 'denied']);
  assert.equal(amir.events[4].reason, 'expired');
  assert.equal(amir.events[5].reason, 'no-token');
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
  const first = await avdan.call('put /liman/snapshot', '1.1.1.1', { site: 'AVDAN', fileName: '03.10.2026.xlsx', blocks: [mk('', '500')] });
  assert.equal(first.unchanged, undefined);
  let view = await avdan.call('get /liman', '1.1.1.1');
  const row = view.days[0].blocks[0].rows[0];
  assert.equal(row.durum, '');
  assert.equal(row.gidenTonaj, '500');
  const firstUpdated = view.sites.AVDAN.updatedAt;
  assert.equal(view.sites.AVDAN.receivedAt, firstUpdated);

  // Aynı içerik tekrar gönderilince: updatedAt sabit, receivedAt ilerler
  await new Promise((r) => setTimeout(r, 5));
  const again = await avdan.call('put /liman/snapshot', '1.1.1.1', { site: 'AVDAN', fileName: '03.10.2026.xlsx', blocks: [mk('', '500')] });
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

test('nakliyeci (GPM / AKYÜZ) yalnız amire gider; ortak çekimde iki firma birlikte görünür', async () => {
  const k = harness({ username: 'AVDAN', role: 'admin' });
  await k.call('put /liman/snapshot', '95.3.27.82', {
    site: 'AVDAN', fileName: '05.10.2026.xlsx',
    blocks: [{
      title: 'YD172(G) / LOT NO 26 09 24 / YILPORT', liman: 'YILPORT', fileName: '05.10.2026.xlsx', tasiyici: 'GPM + AKYÜZ',
      rows: [
        { sira: '1', plaka: '43AB111', yukleme: 'AVDAN', tasiyici: 'GPM' },
        { sira: '2', plaka: '43AB222', yukleme: 'AVDAN', tasiyici: 'AKYÜZ' },
      ],
    }],
  });
  const amir = harness({ username: 'xxr', role: 'amir' });
  Object.assign(amir.store, k.store);
  const amirBlock = (await amir.call('get /liman', '1.1.1.1')).days[0].blocks[0];
  assert.equal(amirBlock.tasiyici, 'GPM + AKYÜZ');
  assert.deepEqual(amirBlock.rows.map((r) => r.tasiyici), ['GPM', 'AKYÜZ']);

  const anon = harness(undefined);
  Object.assign(anon.store, k.store);
  const anonBlock = (await anon.call('get /liman', '5.5.5.5')).days[0].blocks[0];
  assert.equal('tasiyici' in anonBlock, false);
  assert.ok(anonBlock.rows.every((r) => !('tasiyici' in r)));
  assert.equal(anonBlock.rows[0].plaka, '43AB111');
});

test('eski sürüm kantar nakliyecisiz gönderince kayıtlı AKYÜZ / GPM silinmez', async () => {
  const title = 'YD172(G) / LOT NO 26 09 24 / HP120280-B23-01 / YILPORT';
  const k = harness({ username: 'AVDAN', role: 'admin' });
  await k.call('put /liman/snapshot', '95.3.27.82', {
    site: 'AVDAN', fileName: '05.10.2026.xlsx',
    blocks: [{ title, liman: 'YILPORT', fileName: '05.10.2026.xlsx', tasiyici: 'GPM-AKYÜZ',
      rows: [{ sira: '1', plaka: '43AB111', tasiyici: 'GPM' }, { sira: '2', plaka: '', tasiyici: 'AKYÜZ' }] }],
  });
  // Eski sürüm: aynı blok, giden tonaj girilmiş, nakliyeci alanı yok
  await k.call('put /liman/snapshot', '95.3.27.82', {
    site: 'AVDAN', fileName: '05.10.2026.xlsx',
    blocks: [{ title, liman: 'YILPORT', fileName: '05.10.2026.xlsx',
      rows: [{ sira: '1', plaka: '43AB111', giden: '26080' }, { sira: '2', plaka: '43AB222' }] }],
  });
  const amir = harness({ username: 'xxr', role: 'amir' });
  Object.assign(amir.store, k.store);
  const b = (await amir.call('get /liman', '1.1.1.1')).days[0].blocks[0];
  assert.equal(b.tasiyici, 'GPM-AKYÜZ');
  assert.deepEqual(b.rows.map((r) => r.tasiyici), ['GPM', 'AKYÜZ']);
  assert.equal(b.rows[0].gidenTonaj, '26080');
  assert.equal(b.rows[1].plaka, '43AB222');
});

test('sürüm ucu son takip formu baskısını da döner (liman İÇERİDE için)', async () => {
  const routes = {};
  const api = {};
  ['get', 'put', 'post', 'delete'].forEach((m) => {
    api[m] = (path, ...handlers) => { routes[m + ' ' + path] = handlers[handlers.length - 1]; };
  });
  let lastPrint = 1000;
  registerLimanRoutes(api, {
    q: async (sql) => {
      if (/MAX\(tarih\)/i.test(sql)) return { rows: [{ t: lastPrint }] };
      return { rows: [] };
    },
    sendApiError: (res, err) => { throw err; },
    requireValidSession: (q, s, n) => n(),
    requireAmir: (q, s, n) => n(),
    sanitizeString: (v, n) => String(v || '').slice(0, n),
  });
  const call = async () => {
    let out;
    await routes['get /liman/version']({ headers: {} }, { json: (d) => { out = d; }, setHeader() {}, status() { return this; } });
    return out;
  };
  const a = await call();
  assert.equal(a.p, '1000');
  lastPrint = 2000;
  const b = await call();
  assert.equal(b.p, '2000');
  assert.equal(a.v, b.v);
});

test('amir gönderimi yok sayılır', async () => {
  const { call, store } = harness({ username: 'xxr', role: 'amir' });
  const put = await call('put /liman/snapshot', '95.3.27.82', { site: 'AVDAN', blocks: [block('YD1 / LOT NO 1 / EVYAP', 'AVDAN')] });
  assert.equal(put.skipped, true);
  assert.deepEqual(store, {});
});

test('departed akışı liman görevlisine şoför adı ve telefonu da verir', () => {
  const d = { plaka: '43RY761', sofor: 'Ali', iletisim: '555', firma: 'X', malzeme: 'P1' };
  const out = departedDataFields(d, { tarih: '03.10.2026', saat: '10:00' });
  assert.equal(out.plaka, '43RY761');
  assert.equal(out.sofor, 'Ali');
  assert.equal(out.iletisim, '555');
  assert.equal(out.saat, '10:00');
  const stamped = departedDataFields({
    plaka: '43AK877',
    excelFileName: '03.10.2026.xlsx',
    excelDateKey: '2026-10-03',
  }, { tarih: '05.10.2026', saat: '05:03:51' });
  assert.equal(stamped.excelDateKey, '2026-10-03');
  assert.equal(stamped.excelFileName, '03.10.2026.xlsx');
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

test('kapatılan gün arşive mühürlenir; kantar yeni dosyaya geçse de arşiv kalır, kontrol sonucu yazılır', async () => {
  const kantar = { username: 'AVDAN', role: 'admin' };
  const amir = { username: 'xxr', role: 'amir' };
  const day3 = (giden) => ({
    title: 'YD15 / LOT NO 26 07 30 / SAFİPORT', liman: 'SAFİPORT', fileName: '03.10.2026.xlsx', sip: 'm2020 2600000550', tasiyici: 'AKYÜZ',
    rows: [{ sira: '1', plaka: '43ADR754', bbt: '20', net: '27000', giden, sofor: 'ÖMER', telefon: '5374031074', irsaliye: 'R012026003577', tasiyici: 'AKYÜZ', yukleme: 'AVDAN' }],
  });
  const k = harness(kantar);
  await k.call('put /liman/snapshot', '95.3.27.82', { site: 'AVDAN', fileName: '03.10.2026.xlsx', blocks: [day3('27540')] });

  const a = harness(amir);
  Object.assign(a.store, k.store);
  await a.call('put /liman/day/:dateKey/close', '1.1.1.1', {}, { dateKey: '2026-10-03' });
  let list = await a.call('get /liman/archive', '1.1.1.1');
  assert.equal(list.days.length, 1);
  assert.equal(list.days[0].label, '03.10.2026');
  assert.equal(list.days[0].rowCount, 1);
  assert.equal(list.days[0].closedBy, 'xxr');
  assert.equal(list.days[0].check, null);
  assert.equal(list.days[0].changedSinceClose, false);

  // Kantar ertesi günün dosyasına geçti: canlı listede 03.10 kalmaz, arşiv durur
  const k2 = harness(kantar);
  Object.assign(k2.store, a.store);
  await k2.call('put /liman/snapshot', '95.3.27.82', {
    site: 'AVDAN', fileName: '04.10.2026.xlsx',
    blocks: [Object.assign(block('YD2 / LOT NO 2 / EVYAP', 'AVDAN'), { fileName: '04.10.2026.xlsx' })],
  });
  const a2 = harness(amir);
  Object.assign(a2.store, k2.store);
  const rec = await a2.call('get /liman/archive/:dateKey', '1.1.1.1', {}, { dateKey: '2026-10-03' });
  const row = rec.day.blocks[0].rows[0];
  assert.equal(rec.day.blocks[0].sip, 'M20202600000550');
  assert.equal(rec.day.blocks[0].tasiyici, 'AKYÜZ');
  assert.equal(row.irsaliye, 'R012026003577');
  assert.equal(row.giden, '27540');
  assert.equal(row.telefon, '5374031074');
  assert.equal('headerText' in row, false);

  // Sayı kontrol sonucu arşive ve listeye yazılır
  const saved = await a2.call('put /liman/archive/:dateKey/check', '1.1.1.1', { status: 'ok', netsisFile: 'RR.xls', summary: { matchedOk: 1, lineOk: 1, matchedBad: -3 } }, { dateKey: '2026-10-03' });
  assert.equal(saved.check.status, 'ok');
  assert.equal(saved.check.by, 'xxr');
  assert.equal(saved.check.summary.matchedBad, 0);
  list = await a2.call('get /liman/archive', '1.1.1.1');
  assert.equal(list.days[0].check.status, 'ok');
  assert.equal(list.days[0].check.netsisFile, 'RR.xls');

  // Geçersiz sonuç / olmayan gün
  const bad = await a2.call('put /liman/archive/:dateKey/check', '1.1.1.1', { status: 'x' }, { dateKey: '2026-10-03' });
  assert.equal(bad.ok, false);
  const missing = await a2.call('get /liman/archive/:dateKey', '1.1.1.1', {}, { dateKey: '2026-10-09' });
  assert.equal(missing.ok, false);
});

test('kapandıktan sonra kantar farklı liste gönderirse arşiv "değişti" görünür; yeniden kapatınca güncellenir', async () => {
  const kantar = { username: 'AVDAN', role: 'admin' };
  const amir = { username: 'xxr', role: 'amir' };
  const mk = (giden) => ({
    title: 'YD15 / LOT NO 26 07 30 / SAFİPORT', liman: 'SAFİPORT', fileName: '03.10.2026.xlsx',
    rows: [{ sira: '1', plaka: '43ADR754', bbt: '20', giden, irsaliye: 'R012026003577' }],
  });
  const k = harness(kantar);
  await k.call('put /liman/snapshot', '95.3.27.82', { site: 'AVDAN', fileName: '03.10.2026.xlsx', blocks: [mk('')] });
  const a = harness(amir);
  Object.assign(a.store, k.store);
  await a.call('put /liman/day/:dateKey/close', '1.1.1.1', {}, { dateKey: '2026-10-03' });
  await a.call('put /liman/archive/:dateKey/check', '1.1.1.1', { status: 'bad' }, { dateKey: '2026-10-03' });

  const k2 = harness(kantar);
  Object.assign(k2.store, a.store);
  await k2.call('put /liman/snapshot', '95.3.27.82', { site: 'AVDAN', fileName: '03.10.2026.xlsx', blocks: [mk('27540')] });
  const a2 = harness(amir);
  Object.assign(a2.store, k2.store);
  let list = await a2.call('get /liman/archive', '1.1.1.1');
  assert.equal(list.days[0].changedSinceClose, true);

  await a2.call('delete /liman/day/:dateKey/close', '1.1.1.1', {}, { dateKey: '2026-10-03' });
  await a2.call('put /liman/day/:dateKey/close', '1.1.1.1', {}, { dateKey: '2026-10-03' });
  list = await a2.call('get /liman/archive', '1.1.1.1');
  assert.equal(list.days[0].changedSinceClose, false);
  // İçerik değişti: eski kontrol sonucu geçersiz
  assert.equal(list.days[0].check, null);
  const rec = await a2.call('get /liman/archive/:dateKey', '1.1.1.1', {}, { dateKey: '2026-10-03' });
  assert.equal(rec.day.blocks[0].rows[0].giden, '27540');
});

test('kantar Excel silince kitap düşmez; güncelleme ve yeni kitap işlenir, boş gönderim silmez', async () => {
  const { call } = harness({ username: 'AVDAN', role: 'admin' });
  const book = (title, fileName, giden) => ({
    title, liman: 'EVYAP', fileName,
    rows: [{ sira: '1', plaka: '43RY761', giden }],
  });
  await call('put /liman/snapshot', '95.3.27.82', {
    site: 'AVDAN',
    fileName: '03.10.2026.xlsx + 03.10.2026-YD28.xlsx',
    blocks: [
      book('YD02 / LOT NO 1 / EVYAP', '03.10.2026.xlsx', '400'),
      book('YD28 / LOT NO 2 / EVYAP', '03.10.2026-YD28.xlsx', '800'),
    ],
  });

  await call('put /liman/snapshot', '95.3.27.82', {
    site: 'AVDAN',
    fileName: '03.10.2026-YD28.xlsx',
    blocks: [book('YD28 / LOT NO 2 / EVYAP', '03.10.2026-YD28.xlsx', '26000')],
  });
  let view = await call('get /liman', '1.1.1.1');
  const day3 = view.days.find((d) => d.dateKey === '2026-10-03');
  assert.equal(day3.blocks.length, 2);
  const kept = day3.blocks.find((b) => (b.files || []).indexOf('03.10.2026') >= 0);
  const updated = day3.blocks.find((b) => (b.files || []).indexOf('03.10.2026-YD28') >= 0);
  assert.equal(kept.rows[0].giden, '400');
  assert.equal(updated.rows[0].giden, '26000');

  await call('put /liman/snapshot', '95.3.27.82', {
    site: 'AVDAN',
    fileName: '05.10.2026.xlsx',
    blocks: [book('YD05 / LOT NO 3 / EVYAP', '05.10.2026.xlsx', '500')],
  });
  view = await call('get /liman', '1.1.1.1');
  assert.deepEqual(view.days.map((d) => d.dateKey).sort(), ['2026-10-03', '2026-10-05']);
  const still = view.days.find((d) => d.dateKey === '2026-10-03');
  assert.equal(still.blocks.length, 2);

  const wiped = await call('put /liman/snapshot', '95.3.27.82', { site: 'AVDAN', fileName: '', blocks: [], rows: [] });
  assert.equal(wiped.unchanged, true);
  view = await call('get /liman', '1.1.1.1');
  assert.equal(view.days.length, 2);
});

test('tamamlanan Excel bir daha işlenmez; kantar silsin diye adı döner', async () => {
  const { call } = harness({ username: 'AVDAN', role: 'admin' });
  const book = (title, fileName, giden) => ({
    title, liman: 'EVYAP', fileName,
    rows: [{ sira: '1', plaka: '43RY761', giden }],
  });
  const first = await call('put /liman/snapshot', '95.3.27.82', {
    site: 'AVDAN',
    fileName: '05.10.2026.xlsx + 06.10.2026.xlsx',
    blocks: [
      book('YD05 / LOT NO 1 / EVYAP', '05.10.2026.xlsx', '26000'),
      book('YD06 / LOT NO 2 / EVYAP', '06.10.2026.xlsx', ''),
    ],
  });
  assert.deepEqual(first.dropFiles, ['05.10.2026']);

  const again = await call('put /liman/snapshot', '95.3.27.82', {
    site: 'AVDAN',
    fileName: '05.10.2026.xlsx + 06.10.2026.xlsx',
    blocks: [
      book('YD05 / LOT NO 1 / EVYAP', '05.10.2026.xlsx', '1'),
      book('YD06 / LOT NO 2 / EVYAP', '06.10.2026.xlsx', '500'),
    ],
  });
  assert.equal(again.settled, undefined);
  assert.ok(again.dropFiles.includes('05.10.2026'));
  assert.equal(again.dropFiles.includes('06.10.2026'), false);
  let view = await call('get /liman', '1.1.1.1');
  assert.equal(view.days.find((d) => d.dateKey === '2026-10-05').blocks[0].rows[0].giden, '26000');
  assert.equal(view.days.find((d) => d.dateKey === '2026-10-06').blocks[0].rows[0].giden, '500');

  const onlyDone = await call('put /liman/snapshot', '95.3.27.82', {
    site: 'AVDAN',
    fileName: '05.10.2026.xlsx',
    blocks: [book('YD05 / LOT NO 1 / EVYAP', '05.10.2026.xlsx', '9')],
  });
  assert.equal(onlyDone.settled, true);
  assert.equal(onlyDone.unchanged, true);
  view = await call('get /liman', '1.1.1.1');
  assert.equal(view.days.find((d) => d.dateKey === '2026-10-05').blocks[0].rows[0].giden, '26000');
  assert.equal(view.days.find((d) => d.dateKey === '2026-10-06').blocks[0].rows[0].giden, '500');

  const beat = await call('put /liman/heartbeat', '95.3.27.82', { site: 'AVDAN', excelLoaded: true });
  assert.ok(beat.dropFiles.includes('05.10.2026'));
  assert.equal(beat.dropFiles.includes('06.10.2026'), false);
});

test('tamamlanan dosya hangi kantarda yüklüyse oradan da düşer', async () => {
  const done = (title, fileName) => ({
    title, liman: 'EVYAP', fileName,
    rows: [{ sira: '1', plaka: '43RY761', giden: '26000' }],
  });
  const open = (title, fileName) => ({
    title, liman: 'EVYAP', fileName,
    rows: [{ sira: '1', plaka: '43RY762', giden: '' }],
  });
  const avdan = harness({ username: 'AVDAN', role: 'admin' });
  await avdan.call('put /liman/snapshot', '95.3.27.82', {
    site: 'AVDAN',
    fileName: '03.10.2026-YD28.xlsx + 05.10.2026.xlsx + 06.10.2026.xlsx',
    blocks: [
      done('YD28 / LOT NO 2 / EVYAP', '03.10.2026-YD28.xlsx'),
      done('YD05 / LOT NO 1 / EVYAP', '05.10.2026.xlsx'),
      open('YD06 / LOT NO 3 / EVYAP', '06.10.2026.xlsx'),
    ],
  });
  const osb = harness({ username: '1.OSB', role: 'admin' });
  Object.assign(osb.store, avdan.store);
  await osb.call('put /liman/snapshot', '195.175.103.150', {
    site: '1.OSB',
    fileName: '05.10.2026.xlsx',
    blocks: [done('YD05 OSB / LOT NO 9 / EVYAP', '05.10.2026.xlsx')],
  });
  await osb.call('put /liman/heartbeat', '195.175.103.150', {
    site: '1.OSB', excelLoaded: true, fileName: '05.10.2026.xlsx',
  });
  const view = await osb.call('get /liman', '1.1.1.1');
  assert.equal(view.sites.AVDAN.fileName, '06.10.2026.xlsx');
  assert.equal(view.sites['1.OSB'].fileName, '');
  assert.equal(view.sites['1.OSB'].heartbeatFile, '');
  assert.equal(view.sites['1.OSB'].heartbeatExcel, false);
  const beat = await osb.call('put /liman/heartbeat', '195.175.103.150', {
    site: '1.OSB', excelLoaded: true, fileName: '05.10.2026.xlsx',
  });
  assert.ok(beat.dropFiles.includes('05.10.2026'));
  assert.ok(beat.dropFiles.includes('03.10.2026-YD28'));
  assert.equal(beat.dropFiles.includes('06.10.2026'), false);
  const day5 = view.days.find((d) => d.dateKey === '2026-10-05');
  assert.ok(day5 && day5.blocks.length >= 1);
});
