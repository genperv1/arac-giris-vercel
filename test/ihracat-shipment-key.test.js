'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const code = fs.readFileSync(
  path.join(__dirname, '../public/modules/app-ihracat-modal.js'),
  'utf8'
);
const start = code.indexOf('function _ihracatShipmentKey');
const end = code.indexOf('function _ihracatEmptyBlockHintRowHtml');
const wrapped = `(function(){\n${code.slice(start, end)}\nreturn { _ihracatShipmentKey, _ihracatBlockGroupKey, _ihracatRowDedupeKey, _ihracatDedupeShipmentRows, _ihracatPutUpdatedRow };})()`;
const {
  _ihracatShipmentKey,
  _ihracatBlockGroupKey,
  _ihracatRowDedupeKey,
  _ihracatDedupeShipmentRows,
  _ihracatPutUpdatedRow,
} = eval(wrapped);

test('_ihracatShipmentKey scopes row identity by fileName and block', () => {
  const a = {
    fileName: '20.07.2026.xlsx',
    blockKey: 'BLK_20',
    plaka: '03AIT034',
    id: 'IRS001',
    sira: '1',
  };
  const b = {
    fileName: 'YD33 (1).xlsx',
    blockKey: 'BLK_20',
    plaka: '03AIT034',
    id: 'IRS001',
    sira: '1',
  };
  assert.notEqual(_ihracatShipmentKey(a), _ihracatShipmentKey(b));
  assert.ok(_ihracatShipmentKey(a).startsWith('20.07.2026.xlsx::BLK_20::'));
  assert.ok(_ihracatShipmentKey(b).startsWith('YD33 (1).xlsx::BLK_20::'));
});

test('modal save Map keeps rows from both Excel files when plaka/id/sira overlap', () => {
  const rows = [
    {
      fileName: 'a.xlsx',
      blockKey: 'BLK_5',
      plaka: '34ABC123',
      id: 'X1',
      sira: '1',
      firma: 'YD113',
    },
    {
      fileName: 'b.xlsx',
      blockKey: 'BLK_5',
      plaka: '34ABC123',
      id: 'X1',
      sira: '1',
      firma: 'YD331',
    },
  ];

  const byKey = new Map();
  rows.forEach((s) => byKey.set(_ihracatShipmentKey(s), { ...s }));
  assert.equal(byKey.size, 2);
  assert.equal(Array.from(byKey.values()).filter((r) => r.fileName === 'a.xlsx').length, 1);
  assert.equal(Array.from(byKey.values()).filter((r) => r.fileName === 'b.xlsx').length, 1);
});

test('_ihracatShipmentKey empty blocks stay distinct per file', () => {
  const a = {
    fileName: 'a.xlsx',
    blockKey: 'BLK_20',
    _ihracatEmptyBlock: true,
    id: 'BLK_EMPTY_20',
    plaka: '',
  };
  const b = {
    fileName: 'b.xlsx',
    blockKey: 'BLK_20',
    _ihracatEmptyBlock: true,
    id: 'BLK_EMPTY_20',
    plaka: '',
  };
  assert.notEqual(_ihracatShipmentKey(a), _ihracatShipmentKey(b));
  assert.notEqual(_ihracatBlockGroupKey(a), _ihracatBlockGroupKey(b));
});

test('Kaydet updates existing row when irsaliye id changes instead of appending', () => {
  const byKey = new Map();
  const row = {
    fileName: '07.09.2026.xlsx',
    blockKey: 'BLK_1',
    plaka: '43DH988',
    id: '1',
    sira: '1',
    irsaliyeNo: '',
  };
  const oldKey = _ihracatShipmentKey(row);
  byKey.set(oldKey, row);
  const updated = { ...row, id: 'R01 202603547', irsaliyeNo: 'R01 202603547', _ihracatEditedAt: 2 };
  _ihracatPutUpdatedRow(byKey, oldKey, updated);
  assert.equal(byKey.size, 1);
  assert.equal(Array.from(byKey.values())[0].irsaliyeNo, 'R01 202603547');
});

test('_ihracatDedupeShipmentRows collapses same block+sira+plaka copies', () => {
  const rows = [
    { fileName: 'a.xlsx', blockKey: 'BLK_1', plaka: '43DH988', id: '1', sira: '5', _ihracatEditedAt: 1 },
    { fileName: 'a.xlsx', blockKey: 'BLK_1', plaka: '43DH988', id: 'R01 202603547', sira: '5', _ihracatEditedAt: 9 },
  ];
  assert.notEqual(_ihracatShipmentKey(rows[0]), _ihracatShipmentKey(rows[1]));
  assert.equal(_ihracatRowDedupeKey(rows[0]), _ihracatRowDedupeKey(rows[1]));
  const out = _ihracatDedupeShipmentRows(rows);
  assert.equal(out.length, 1);
  assert.equal(out[0].id, 'R01 202603547');
});
