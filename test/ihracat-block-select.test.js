'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const HDR_33 =
  'YD92(M) / LOT NO 26 07 14 PFK-26-33 / HP007030-B19-02 / HP 0,074-0,30 / 230 TON / NET 1150 KG BASKILI LINERLI / 200 BBT / 100 PALET / BOOKING NO : EBKG18217852 / GEMI DETAYI : MSC DANIELA GT635E / EVYAP';
const HDR_34 =
  'YD92(M) / LOT NO 26 07 14 PFK-26-34(K) / HP007030-B19-02 / HP 0,074-0,30 / 230 TON / NET 1150 KG BASKILI LINERLI / 200 BBT / 100 PALET / BOOKING NO : EBKG18218073 / GEMI DETAYI : MSC DANIELA GT635E / EVYAP';

const excelCode = fs.readFileSync(
  path.join(__dirname, '../public/modules/app-excel-ihracat.js'),
  'utf8'
);
const selStart = excelCode.indexOf('function _ihracatHeaderBookingNo');
const selEnd = excelCode.indexOf('function _expandMergedCellsInGrid');
assert.ok(selStart >= 0 && selEnd > selStart, 'selection helpers not found');
const selWrapped = `(function(){\n${excelCode.slice(selStart, selEnd)}\nreturn { _ihracatBlockSelectionKey, _rowInSelectedBlocks, _ihracatHeaderBookingNo, _ihracatHeaderPfkOrPo };})()`;
const {
  _ihracatBlockSelectionKey,
  _rowInSelectedBlocks,
  _ihracatHeaderBookingNo,
  _ihracatHeaderPfkOrPo,
} = eval(selWrapped);

const modalCode = fs.readFileSync(
  path.join(__dirname, '../public/modules/app-ihracat-modal.js'),
  'utf8'
);
const titleStart = modalCode.indexOf('function _ihracatShortBlockTitle');
const titleEnd = modalCode.indexOf('function _ihracatDisplayTonajCell');
assert.ok(titleStart >= 0 && titleEnd > titleStart, 'short title not found');
const titleWrapped = `(function(){\nfunction _extractFirmaKod(headerText){\n  const m = String(headerText || '').match(/\\b(YD\\d{1,4})\\b/i);\n  return m ? m[1] : '';\n}\n${modalCode.slice(titleStart, titleEnd)}\nreturn { _ihracatShortBlockTitle };})()`;
const { _ihracatShortBlockTitle } = eval(titleWrapped);

test('_ihracatHeaderBookingNo reads EBKG alphanumeric booking', () => {
  assert.equal(_ihracatHeaderBookingNo(HDR_33), 'EBKG18217852');
  assert.equal(_ihracatHeaderBookingNo(HDR_34), 'EBKG18218073');
});

test('_ihracatHeaderPfkOrPo distinguishes PFK-26-33 vs PFK-26-34(K)', () => {
  assert.equal(_ihracatHeaderPfkOrPo(HDR_33), 'PFK-26-33');
  assert.equal(_ihracatHeaderPfkOrPo(HDR_34), 'PFK-26-34(K)');
});

test('_ihracatBlockSelectionKey does not collapse same YD+HP different PFK/booking', () => {
  const a = _ihracatBlockSelectionKey(HDR_33);
  const b = _ihracatBlockSelectionKey(HDR_34);
  assert.ok(a);
  assert.ok(b);
  assert.notEqual(a, b);
});

test('_rowInSelectedBlocks keeps only the chosen YD92 row range', () => {
  const onlyBlocks = [{ id: 'B40_2', startRow: 40, endRow: 79, headerText: HDR_34 }];
  assert.equal(_rowInSelectedBlocks(45, onlyBlocks, HDR_34), true);
  assert.equal(_rowInSelectedBlocks(5, onlyBlocks, HDR_33), false);
});

test('_rowInSelectedBlocks does not pull sibling block by YD+HP header key', () => {
  const onlyBlocks = [{ id: 'B40_2', startRow: 40, endRow: 79, headerText: HDR_34 }];
  assert.equal(_rowInSelectedBlocks(12, onlyBlocks, HDR_33), false);
});

test('_ihracatShortBlockTitle shows PFK so the two YD92 blocks look different', () => {
  const a = _ihracatShortBlockTitle(HDR_33, 'HP 0,074-0,30');
  const b = _ihracatShortBlockTitle(HDR_34, 'HP 0,074-0,30');
  assert.match(a, /PFK-26-33/i);
  assert.match(b, /PFK-26-34/i);
  assert.notEqual(a, b);
});
