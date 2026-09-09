'use strict';

const test = require('node:test');
const assert = require('node:assert');
const api = require('../public/modules/plaka-ayir');

test('simple plate+bbt line still parses', () => {
  const row = api.parsePastedLine('43RV120\t28  ORHANİZE');
  assert.equal(row.plate, '43RV120');
  assert.equal(row.bbt, 28);
  assert.equal(row.driver, '');
  assert.equal(row.phone, '');
});

test('excel row reads plate, driver and phone', () => {
  const line = [
    'R11 202601346', '8', '43BH088', '20', '', '', '', '1081',
    '27000', '27160', '27240', '80', '', '', '1.OSB', 'GÜRKAN BİLDİK', '5427274031'
  ].join('\t');
  const row = api.parsePastedLine(line);
  assert.equal(row.plate, '43BH088');
  assert.equal(row.bbt, 20);
  assert.equal(row.driver, 'GÜRKAN BİLDİK');
  assert.equal(row.phone, '5427274031');
});

test('combined name-phone cell is split', () => {
  const row = api.parsePastedLine('43ABT013\t20\tUĞUR FERİZ-5456757284');
  assert.equal(row.plate, '43ABT013');
  assert.equal(row.bbt, 20);
  assert.equal(row.driver, 'UĞUR FERİZ');
  assert.equal(row.phone, '5456757284');
});

test('header and iptal lines are skipped', () => {
  assert.equal(api.parsePastedLine('PLAKA\tBBT\tŞOFÖR ADI SOYADI\tTELEFON'), null);
  assert.equal(api.parsePastedLine('43BH088 20 iptal'), null);
});

test('phone display and excel copy formats', () => {
  assert.equal(api.formatPhoneDisplay('5427274031'), '0542 727 40 31');
  assert.equal(api.formatPhoneCopy('0542 727 40 31'), '5427274031');
});

test('lookup helpers prefer first driver and iletisim', () => {
  assert.equal(api.vehicleDriverLabel({ soforAdi: 'ALİ', soforSoyadi: 'YILMAZ' }), 'ALİ YILMAZ');
  assert.equal(api.vehiclePhone({ iletisim: '0542 611 55 44' }), '0542 611 55 44');
});

test('column copy keeps plate, bbt and driver info separate', () => {
  const rows = [
    { plate: '42COR65', bbt: 20, driver: 'ALİ YILMAZ', phone: '0542 727 40 31' },
    { plate: '43BH088', bbt: 25, driver: 'GÜRKAN BİLDİK', phone: '5427274031' }
  ];
  assert.equal(api.buildColumnCopyText(rows, 'plate'), '42COR65\r\n43BH088');
  assert.equal(api.buildColumnCopyText(rows, 'bbt'), '20\r\n25');
  assert.equal(api.buildColumnCopyText(rows, 'driver'), 'ALİ YILMAZ\t5427274031\r\nGÜRKAN BİLDİK\t5427274031');
});
