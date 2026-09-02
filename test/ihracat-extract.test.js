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
const wrapped = `(function(){\n${code.slice(start, end)}\nreturn { extractPortFromHeaderText, extractPrimaryAmbalajFromHeader, extractNetKgFromAmbalajText, getLimanCandidates, extractPrimaryPortFromShipment };})()`;
const {
  extractPortFromHeaderText,
  extractPrimaryAmbalajFromHeader,
  extractNetKgFromAmbalajText,
  getLimanCandidates,
} = eval(wrapped);

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

test('extractPortFromHeaderText keeps full DEPO/LIMAN phrase, not only YILPORT', () => {
  assert.strictEqual(
    extractPortFromHeaderText(
      'YD385(M) / LOT NO 26 06 45 / BOOKING NO : EBKG17796524 / GEMİ DETAYI : MSC HOUSTON V/NC631R / DEPO;MEDLOG LİMAN YILPORT'
    ),
    'DEPO;MEDLOG LİMAN YILPORT'
  );
  assert.strictEqual(
    extractPortFromHeaderText('DEPO;MEDLOG LİMAN YILPORT'),
    'DEPO;MEDLOG LİMAN YILPORT'
  );
  assert.strictEqual(
    extractPortFromHeaderText(
      'YD92(M) / NET 1150 KG BASKILI LİNERLİ / BOOKING NO : ISTG14409900 / GEMİ DETAYI : MSC TINA GT632E / EVYAP'
    ),
    'EVYAP'
  );
  assert.strictEqual(extractPortFromHeaderText('YILPORT'), 'YILPORT');
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

test('extractNetKgFromAmbalajText reads NET kg for BBT×kg tonaj', () => {
  assert.strictEqual(extractNetKgFromAmbalajText('NET 1250 KG BIGBAG'), 1250);
  assert.strictEqual(extractNetKgFromAmbalajText('YD20 / NET 1250 BASKISIZ LINERLI BİGBAG / EVYAP'), 1250);
  assert.strictEqual(extractNetKgFromAmbalajText('YD28 / NET 1.350 KG BIGBAGLER / GEMPORT'), 1350);
  assert.strictEqual(extractNetKgFromAmbalajText(''), 0);
});

test('getLimanCandidates lists ports independently', () => {
  const cands = getLimanCandidates('YD28 / SAFIPORT / NET 25 KG / GEMPORT');
  assert.strictEqual(cands[0], 'GEMPORT');
  assert.ok(cands.includes('SAFİPORT'));
});

test('extractPortFromHeaderText reads RODAPORT and other *PORT names', () => {
  assert.strictEqual(
    extractPortFromHeaderText('YD28 / NET 1250 KG BIGBAG / RODAPORT'),
    'RODAPORT'
  );
  assert.strictEqual(
    extractPortFromHeaderText('YD82 / NET 1350 KG BASKILI LINERLI BIGBAG / RODA PORT'),
    'RODAPORT'
  );
  assert.strictEqual(extractPortFromHeaderText('RODAPORT'), 'RODAPORT');
  assert.strictEqual(
    extractPortFromHeaderText('YD40 / BOOKING NO : ABC / EGEPORT'),
    'EGEPORT'
  );
  assert.strictEqual(
    extractPortFromHeaderText('YD28 / NET 1250 KG BIGBAG / EXPORT REF : ABC123'),
    ''
  );
  const cands = getLimanCandidates('YD28 / NET 1250 KG BIGBAG / RODAPORT');
  assert.strictEqual(cands[0], 'RODAPORT');
});
