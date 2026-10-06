'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { uploadKey } = require('../lib/excel-agent-store');
const { registerExcelAgentRoutes, agentKeysFromEnv } = require('../routes/excel-agent-routes');
const { readNewestExcel, kantarSiteOf } = require('../routes/ihracat-excel-routes');

const AVDAN_KEY = 'avdan-anahtar-0123456789';
const OSB_KEY = 'osb-anahtar-0123456789ab';

function mountRoutes(keys, store) {
  const routes = {};
  const api = {};
  ['get', 'put'].forEach((m) => {
    api[m] = (path, ...handlers) => { routes[m + ' ' + path] = handlers.flat(); };
  });
  registerExcelAgentRoutes(api, {
    excelAgentStore: store,
    sendApiError: (res, err) => res.status(500).json({ ok: false, error: String(err && err.message) }),
    getAgentKeys: () => keys,
  });
  return routes;
}

async function call(handlers, req) {
  const out = { status: 200, body: null };
  const res = {
    setHeader() {},
    status(code) { out.status = code; return this; },
    json(body) { out.body = body; return this; },
    send(body) { out.body = body; return this; },
  };
  // rate limiter (ilk handler) atlanır
  const chain = handlers.slice(1);
  let i = 0;
  const next = async () => { const h = chain[i++]; if (h) await h(req, res, next); };
  await next();
  return out;
}

test('kantar anahtarları ortamdan ayrı okunur; sabit yedek anahtar yok', () => {
  assert.deepEqual(agentKeysFromEnv({}), { AVDAN: '', '1.OSB': '' });
  assert.deepEqual(agentKeysFromEnv({ EXCEL_AGENT_KEY_AVDAN: ' a ', EXCEL_AGENT_KEY_1OSB: 'b' }), { AVDAN: 'a', '1.OSB': 'b' });
});

test('aynı adlı Excel iki kantarda ayrı saklanır', () => {
  assert.equal(uploadKey('AVDAN', '03.10.2026.xlsx'), 'avdan|03.10.2026.xlsx');
  assert.equal(uploadKey('1.OSB', '03.10.2026.xlsx'), '1.osb|03.10.2026.xlsx');
  assert.equal(uploadKey('', '03.10.2026.xlsx'), '');
  assert.equal(uploadKey('xxr', '03.10.2026.xlsx'), '');
});

test('boş anahtar JWT_SECRET ile kantara göre türetilir', () => {
  const env = { JWT_SECRET: 'jwt-secret-en-az-16xx', EXCEL_AGENT_KEY_AVDAN: '', EXCEL_AGENT_KEY_1OSB: 'kisa' };
  const keys = agentKeysFromEnv(env);
  assert.equal(keys.AVDAN.length, 64);
  assert.equal(keys['1.OSB'].length, 64);
  assert.notEqual(keys.AVDAN, keys['1.OSB']);
  const pinned = agentKeysFromEnv({ JWT_SECRET: env.JWT_SECRET, EXCEL_AGENT_KEY_AVDAN: AVDAN_KEY, EXCEL_AGENT_KEY_1OSB: '' });
  assert.equal(pinned.AVDAN, AVDAN_KEY);
});

test('kurulum dosyası canlı siteyi ve anahtarı yazar', () => {
  const { buildAgentInstallerBat, agentPublicOrigin } = require('../routes/excel-agent-routes');
  assert.equal(agentPublicOrigin({ headers: { host: 'localhost:3000' } }), 'https://genper.site');
  assert.equal(agentPublicOrigin({ headers: { host: 'genper.site' } }), 'https://genper.site');
  const bat = buildAgentInstallerBat('AVDAN', AVDAN_KEY, 'https://genper.site');
  assert.match(bat, /SUNUCU=https:\/\/genper\.site/);
  assert.match(bat, new RegExp('ANAHTAR=' + AVDAN_KEY));
  assert.match(bat, /\/api\/excel-agent\/script/);
  assert.match(bat, /ajan\.ps1" -Kur/);
});

test('yükleme anahtarın kantarına yazılır; anahtar yoksa / yanlışsa reddedilir', async () => {
  const saved = [];
  const store = { saveUpload: async (x) => { saved.push(x); return { fileName: x.fileName, site: x.site, unchanged: true }; } };
  const routes = mountRoutes({ AVDAN: AVDAN_KEY, '1.OSB': OSB_KEY }, store);
  const up = routes['put /excel-agent/upload'];
  const req = (key) => ({ headers: { 'x-excel-agent-key': key }, query: { name: '03.10.2026.xlsx' }, body: Buffer.from('x') });
  // express.raw atlanır: gövde zaten Buffer
  const handlers = up.filter((h) => h.name !== 'rawParser');
  assert.equal((await call(handlers, req(OSB_KEY))).status, 200);
  assert.equal(saved[0].site, '1.OSB');
  assert.equal((await call(handlers, req('yanlis-anahtar-0000000000'))).status, 401);
  assert.equal(saved.length, 1);
  const off = mountRoutes({ AVDAN: '', '1.OSB': 'kisa' }, store)['put /excel-agent/upload'].filter((h) => h.name !== 'rawParser');
  assert.equal((await call(off, req('kisa'))).status, 503);
});

test('Güncelle ajan kopyasını okumaz', async () => {
  assert.equal(kantarSiteOf({ user: { username: 'avdan' } }), 'AVDAN');
  assert.equal(kantarSiteOf({ user: { username: 'xxr' } }), '');
  let asked = 0;
  const store = {
    getUpload: async () => {
      asked += 1;
      return { fileName: '03.10.2026.xlsx', buf: Buffer.from('eski'), mtime: new Date() };
    },
  };
  await assert.rejects(
    () => readNewestExcel({ fileName: 'ajan-kullanilmaz-yok.xlsx' }, store, 'AVDAN'),
    (err) => err && err.code === 'EXCEL_FILE_NOT_FOUND'
  );
  assert.equal(asked, 0);
});
