'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const api = require('../public/modules/sayi-kontrol');

test('normalizeYd and matchKey', () => {
  assert.equal(api.normalizeYd('YD359(G) / LOT'), 'YD359');
  assert.equal(api.matchKey({ yd: 'YD92', booking: 'EBKG1' }), 'YD92|B:EBKG1');
  assert.equal(api.matchKey({ yd: 'YD92', lot: '260714' }), 'YD92|L:260714');
});

test('compareField bbt exact, ton tolerant', () => {
  assert.equal(api.compareField(200, 200, 'bbt').ok, true);
  assert.equal(api.compareField(200, 201, 'bbt').ok, false);
  assert.equal(api.compareField(100, 100.02, 'ton').ok, true);
  assert.equal(api.compareField(100, 101, 'ton').ok, false);
});

test('parseSevkiyatGrid reads TOPLAM BBT and header YD', () => {
  const grid = [
    ['YD68(M) / LOT NO 26 07 18 / 230 TON / NET 1150 KG / 200 BBT / BOOKING NO : EBKG105 / GEMİ'],
    ['#', 'PLAKA', 'BBT', 'PALET', 'NET TONAJ', 'GİDEN TONAJ'],
    [1, '43ADT553', 22, 11, 25.3, 25.5],
    [2, '43ADT550', 22, 11, 25.3, 25.5],
    ['TOPLAM', '', 200, 100, 230, 231],
    ['KALAN', '', 0, 0, 0, 0]
  ];
  const parsed = api.parseSevkiyatGrid(grid);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.items.length, 1);
  assert.equal(parsed.items[0].yd, 'YD68');
  assert.equal(parsed.items[0].bbt, 200);
  assert.ok(Math.abs(parsed.items[0].ton - 230) < 0.01);
  assert.match(parsed.items[0].key, /YD68/);
});

test('diffReports flags mismatch and only-one-side', () => {
  const left = [
    { key: 'YD1|B:A', label: 'YD1', bbt: 200, ton: 230 },
    { key: 'YD2|B:B', label: 'YD2', bbt: 100, ton: 125 }
  ];
  const right = [
    { key: 'YD1|B:A', label: 'YD1', bbt: 200, ton: 230 },
    { key: 'YD2|B:B', label: 'YD2', bbt: 110, ton: 125 },
    { key: 'YD3|B:C', label: 'YD3', bbt: 40, ton: 50 }
  ];
  const d = api.diffReports(left, right);
  assert.equal(d.summary.matchedOk, 1);
  assert.equal(d.summary.matchedBad, 1);
  assert.equal(d.summary.onlyRight, 1);
});

test('Sayı kontrol page and menu wiring', () => {
  const page = fs.readFileSync(path.join(__dirname, '../public/sayi-kontrol.html'), 'utf8');
  assert.match(page, /Sayı kontrol/);
  assert.match(page, /modules\/sayi-kontrol\.js/);
  assert.match(page, /AraclarGate/);
  const hub = fs.readFileSync(path.join(__dirname, '../public/ihracat-takip.html'), 'utf8');
  assert.match(hub, /sayi-kontrol\.html/);
  const menu = fs.readFileSync(path.join(__dirname, '../public/modules/app-ui-forms-takip.js'), 'utf8');
  assert.match(menu, /ihracatTakipMenuButton/);
  assert.doesNotMatch(menu, /sayiKontrolMenuButton/);
  const auth = fs.readFileSync(path.join(__dirname, '../public/modules/app-auth.js'), 'utf8');
  assert.match(auth, /ihracat-takip\.html/);
  const session = fs.readFileSync(path.join(__dirname, '../public/session-manager.js'), 'utf8');
  assert.match(session, /sayi-kontrol\.html/);
});
