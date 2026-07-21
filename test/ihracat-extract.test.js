'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const code = fs.readFileSync(
  path.join(__dirname, '../public/modules/app-excel-ihracat.js'),
  'utf8'
);
const start = code.indexOf('const IHR_PORT_DEFS');
const end = code.indexOf('function normalizeYdKey');
const wrapped = `(function(){\n${code.slice(start, end)}\nreturn { extractPortFromHeaderText, extractPrimaryAmbalajFromHeader, getLimanCandidates, extractPrimaryPortFromShipment };})()`;
const { extractPortFromHeaderText, extractPrimaryAmbalajFromHeader, getLimanCandidates } = eval(wrapped);

test('extractPortFromHeaderText distinguishes GEMPORT and SAFIPORT', () => {
  assert.strictEqual(
    extractPortFromHeaderText('YD28 / NET 1350 KG BIGBAG / GEMPORT'),
    'GEMPORT'
  );
  assert.strictEqual(
    extractPortFromHeaderText('YD28 / NET 1250 KG BIGBAG / SAFIPORT'),
    'SAFİPORT'
  );
  assert.strictEqual(
    extractPortFromHeaderText('YD210 / GEMİ DETAYI : MSC DANIT/IS627R / SAFİPORT'),
    'SAFİPORT'
  );
  assert.strictEqual(
    extractPortFromHeaderText('YD28 / SAFIPORT / NET 25 KG TORBA / GEMPORT'),
    'GEMPORT'
  );
});

test('extractPrimaryAmbalajFromHeader preserves Turkish thousand separators', () => {
  assert.strictEqual(
    extractPrimaryAmbalajFromHeader('YD28 / NET 1.350 KG BIGBAGLER / GEMPORT'),
    'NET 1350 KG BIGBAGLER'
  );
  assert.strictEqual(
    extractPrimaryAmbalajFromHeader("YD28 / 1.350 KG'LIK BIGBAGLER / SAFIPORT"),
    'NET 1350 KG BIGBAGLER'
  );
  assert.strictEqual(
    extractPrimaryAmbalajFromHeader('YD20 / NET 1250 BASKISIZ LINERLI BİGBAG / EVYAP'),
    'NET 1250 KG BASKISIZ LINERLI BİGBAG'
  );
  assert.strictEqual(
    extractPrimaryAmbalajFromHeader('YD28 / NET 1250 KG BIGBAG / SAFIPORT'),
    'NET 1250 KG BIGBAG'
  );
});

test('getLimanCandidates lists ports independently', () => {
  const cands = getLimanCandidates('YD28 / SAFIPORT / NET 25 KG / GEMPORT');
  assert.strictEqual(cands[0], 'GEMPORT');
  assert.ok(cands.includes('SAFİPORT'));
});
