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

test('Güncelle yalnız kendi kantarının ajan kopyasını okur', async () => {
  assert.equal(kantarSiteOf({ user: { username: 'avdan' } }), 'AVDAN');
  assert.equal(kantarSiteOf({ user: { username: 'xxr' } }), '');
  const asked = [];
  const store = {
    getUpload: async (name, site) => {
      asked.push(site);
      return site === 'AVDAN' ? { fileName: name, buf: Buffer.from('a'), mtime: new Date() } : null;
    },
  };
  const read = await readNewestExcel({ fileName: '03.10.2026.xlsx' }, store, 'AVDAN');
  assert.equal(read.fileName, '03.10.2026.xlsx');
  await assert.rejects(() => readNewestExcel({ fileName: '03.10.2026.xlsx' }, store, ''));
  assert.deepEqual(asked, ['AVDAN']);
});
