'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const code = fs.readFileSync(
  path.join(__dirname, '../public/modules/app-ihracat-modal.js'),
  'utf8'
);
const start = code.indexOf('function _ihracatFirmaGroupKey');
const end = code.indexOf('function _ihracatEmptyBlockHintRowHtml');
const wrapped = `(function(){\n${code.slice(start, end)}\nreturn { _ihracatBlockGroupKey, _ihracatPurgeEmptyBlockPlaceholders, ihracatCountBlocks };})()`;
const { _ihracatBlockGroupKey, _ihracatPurgeEmptyBlockPlaceholders, ihracatCountBlocks } = eval(wrapped);

test('_ihracatBlockGroupKey scopes blockKey by fileName', () => {
  const a = { fileName: '20.07.2026.xlsx', blockKey: 'BLK_20' };
  const b = { fileName: 'YD33 (1).xlsx', blockKey: 'BLK_20' };
  assert.notEqual(_ihracatBlockGroupKey(a), _ihracatBlockGroupKey(b));
  assert.equal(_ihracatBlockGroupKey(a), '20.07.2026.xlsx::BLK_20');
  assert.equal(_ihracatBlockGroupKey(b), 'YD33 (1).xlsx::BLK_20');
});

test('_ihracatPurgeEmptyBlockPlaceholders keeps empty block when only other file has plates on same BLK_N', () => {
  const rows = [
    {
      fileName: '20.07.2026.xlsx',
      blockKey: 'BLK_20',
      blockHeaderRow: 20,
      headerText: 'YD331 / 120 BBT',
      _ihracatEmptyBlock: true,
      plaka: '',
    },
    {
      fileName: 'YD33 (1).xlsx',
      blockKey: 'BLK_20',
      blockHeaderRow: 20,
      headerText: 'YD33 / 2444 BBT',
      plaka: '03VT423',
      bbt: '22',
    },
  ];
  const kept = _ihracatPurgeEmptyBlockPlaceholders(rows);
  assert.equal(kept.length, 2);
  assert.ok(kept.some((r) => r._ihracatEmptyBlock && r.fileName === '20.07.2026.xlsx'));
});

test('ihracatCountBlocks counts blocks separately per Excel file', () => {
  const rows = [
    { fileName: 'a.xlsx', blockKey: 'BLK_1', _ihracatEmptyBlock: true, plaka: '' },
    { fileName: 'b.xlsx', blockKey: 'BLK_1', plaka: '03ABC123' },
  ];
  assert.equal(ihracatCountBlocks(rows), 2);
});
