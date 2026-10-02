'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { registerLimanRoutes } = require('../routes/liman-routes');

function harness(user) {
  const store = {};
  const routes = {};
  const api = {};
  ['get', 'put', 'post', 'delete'].forEach((m) => {
    api[m] = (path, ...handlers) => { routes[m + ' ' + path] = handlers[handlers.length - 1]; };
  });
  const pass = (req, res, next) => next();
  registerLimanRoutes(api, {
    q: async (sql, params) => {
      if (/^SELECT/i.test(sql)) return { rows: store[params[0]] ? [{ value: store[params[0]] }] : [] };
      store[params[0]] = params[1];
      return { rows: [] };
    },
    sendApiError: (res, err) => { throw err; },
    requireValidSession: pass,
    requireAmir: pass,
    sanitizeString: (v, n) => String(v || '').slice(0, n),
    getClientIp: (req) => req.headers['x-forwarded-for'],
    normalizeClientIp: (ip) => ip,
  });
  const call = async (key, ip, body) => {
    let out;
    await routes[key]({ user, body, headers: { 'x-forwarded-for': ip } }, {
      json: (d) => { out = d; return d; },
      status() { return this; },
      setHeader() {},
    });
    return out;
  };
  return { call, store };
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

test('amir gönderimi yok sayılır', async () => {
  const { call, store } = harness({ username: 'xxr', role: 'amir' });
  const put = await call('put /liman/snapshot', '95.3.27.82', { site: 'AVDAN', blocks: [block('YD1 / LOT NO 1 / EVYAP', 'AVDAN')] });
  assert.equal(put.skipped, true);
  assert.deepEqual(store, {});
});
