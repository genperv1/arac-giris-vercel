'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const eu = require('../lib/excel-utils');

const code = fs.readFileSync(
  path.join(__dirname, '../public/modules/app-excel-ihracat.js'),
  'utf8'
);
const start = code.indexOf('function looksLikeIrsaliyeNo');
const end = code.indexOf('const DAILY_SHIPMENT_KEY');
const wrapped = `(function(){\n${code.slice(start, end)}\nreturn { looksLikeIrsaliyeNo, normalizeIrsaliyeNo, detectIrsaliyeColumnIndex, resolveIrsaliyeFromRow };})()`;
const ihr = eval(wrapped);

test('detectIrsaliyeColumnIndex finds irsaliye column outside column A', () => {
  const grid = [
    ['SIRANO', 'PLAKA', 'BBT', 'NOT', 'İRSALİYE'],
    ['1', '34 A 1', '12', '', 'R01 202602611'],
    ['2', '06 B 2', '12', '', 'R01 202602612'],
    ['3', '35 C 3', '12', '', 'R01 202602613'],
  ];
  const cols = { sirano: 0, plaka: 1 };
  assert.strictEqual(ihr.detectIrsaliyeColumnIndex(grid, 0, cols), 4);
});

test('resolveIrsaliyeFromRow ignores sira column and reads dedicated irsaliye column', () => {
  const row = ['61', '43 EN 125', '21', '', 'R01 202602613'];
  const cols = { sirano: 0, plaka: 1, irsaliyeNo: 0 };
  assert.strictEqual(
    ihr.resolveIrsaliyeFromRow(row, cols),
    'R01 202602613'
  );
});

test('resolveIrsaliyeFromRow keeps unique irsaliye numbers on adjacent rows', () => {
  const cols = { sirano: 0, plaka: 1, irsaliyeNo: 4 };
  const row61 = ['61', '43 EN 125', '21', '', 'R01 202602613'];
  const row62 = ['62', '43 VE 530', '21', '', 'R01 202602618'];
  const row63 = ['63', '43 U 1183', '21', '', 'R01 202602619'];
  assert.strictEqual(ihr.resolveIrsaliyeFromRow(row61, cols), 'R01 202602613');
  assert.strictEqual(ihr.resolveIrsaliyeFromRow(row62, cols), 'R01 202602618');
  assert.strictEqual(ihr.resolveIrsaliyeFromRow(row63, cols), 'R01 202602619');
});

test('findIrsaliyeCollisions normalizes compact R01 numbers', () => {
  const rows = [
    { plaka: '43 EN 125', irsaliyeNo: 'R01202602613' },
    { plaka: '43 U 1183', irsaliyeNo: 'R01 202602613' },
  ];
  const c = eu.findIrsaliyeCollisions(rows);
  assert.strictEqual(c.length, 1);
  assert.strictEqual(c[0].plates.length, 2);
});

test('findIrsaliyeCollisions does not treat unique irsaliye as duplicate', () => {
  const rows = [
    { plaka: '43 EN 125', irsaliyeNo: 'R01 202602613' },
    { plaka: '43 VE 530', irsaliyeNo: 'R01 202602618' },
    { plaka: '43 U 1183', irsaliyeNo: 'R01 202602619' },
  ];
  assert.strictEqual(eu.findIrsaliyeCollisions(rows).length, 0);
});
