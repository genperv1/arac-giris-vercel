'use strict';

const test = require('node:test');
const assert = require('node:assert');
const eu = require('../lib/excel-utils');

test('filterPiyasaRow rejects empty miktar', () => {
  const r = eu.filterPiyasaRow({ firma: 'HP1', malzeme: 'X', miktar: '0' }, 1);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'miktar_geçersiz');
});

test('filterPiyasaRow accepts valid row', () => {
  const r = eu.filterPiyasaRow({ firma: 'HP1', malzeme: 'X', miktar: '12000' }, 1);
  assert.strictEqual(r.ok, true);
});

test('tonajCompare warn and danger thresholds', () => {
  assert.strictEqual(eu.tonajCompare('11000', '10000').level, 'warn');
  assert.strictEqual(eu.tonajCompare('7000', '10000').level, 'danger');
  assert.strictEqual(eu.tonajCompare('10000', '10000').level, 'ok');
});

test('findIrsaliyeCollisions detects duplicate irsaliye on plates', () => {
  const rows = [
    { plaka: '34 A 1', irsaliyeNo: 'R11 1234567890' },
    { plaka: '06 B 2', irsaliyeNo: 'R11 1234567890' },
  ];
  const c = eu.findIrsaliyeCollisions(rows);
  assert.strictEqual(c.length, 1);
  assert.strictEqual(c[0].plates.length, 2);
});

test('findDuplicatePlateRows detects same plate on multiple shipment rows', () => {
  const rows = [
    { plaka: '34ABC123', irsaliyeNo: 'R11 1111111111', bbt: '12' },
    { plaka: '34ABC123', irsaliyeNo: 'R11 2222222222', bbt: '8' },
    { plaka: '06XYZ99', irsaliyeNo: 'R11 3333333333', bbt: '5' },
  ];
  const d = eu.findDuplicatePlateRows(rows);
  assert.strictEqual(d.length, 1);
  assert.strictEqual(d[0].plaka, '34ABC123');
  assert.strictEqual(d[0].entries.length, 2);
  assert.match(eu.formatDupPlateRowDetail(d[0]), /1111111111 — 12 BBT/);
  assert.match(eu.formatDupPlateRowDetail(d[0]), /2222222222 — 8 BBT/);
});

test('validatePiyasaTemplate scores headers', () => {
  const v = eu.validatePiyasaTemplate(['SIRA', 'FIRMA', 'MALZEME', 'MIKTAR']);
  assert.strictEqual(v.ok, true);
  assert.ok(v.score >= 3);
});

test('miktarToKg converts ton to kg', () => {
  assert.strictEqual(eu.miktarToKg('12,5', 'ton'), '12500');
});

test('miktarToKg preserves descriptive miktar text', () => {
  assert.strictEqual(eu.miktarToKg('4 X 2.000 KG', 'kg'), '4 X 2.000 KG');
  assert.strictEqual(eu.miktarToKg('(9.000 - 10.000) KG', 'kg'), '(9.000 - 10.000) KG');
});

test('filterPiyasaRow accepts range and multiply miktar strings', () => {
  const r1 = eu.filterPiyasaRow({ firma: 'HP1', malzeme: 'X', miktar: '(9.000 - 10.000) KG' }, 1);
  assert.strictEqual(r1.ok, true);
  const r2 = eu.filterPiyasaRow({ firma: 'HP1', malzeme: 'X', miktar: '4 X 2.000 KG' }, 2);
  assert.strictEqual(r2.ok, true);
});

test('pickPiyasaMiktar prefers Miktar Dane column', () => {
  const row = { 'MİKTAR': '1000', 'MİKTAR DANE': '4 X 2.000 KG' };
  assert.strictEqual(eu.pickPiyasaMiktar(row), '4 X 2.000 KG');
});
