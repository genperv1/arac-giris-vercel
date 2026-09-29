'use strict';

const test = require('node:test');
const assert = require('node:assert');
const {
  validatePlateFormat,
  isTurkishPlate,
  isForeignPlate,
  formatForeignPlateDisplay,
} = require('../lib/plate-format');

test('validatePlateFormat accepts common TR formats', () => {
  assert.strictEqual(validatePlateFormat(''), true);
  assert.strictEqual(validatePlateFormat('34 ABC 1234'), true);
  assert.strictEqual(validatePlateFormat('34ABC1234'), true);
  assert.strictEqual(validatePlateFormat('06 AA 1234'), true);
});

test('validatePlateFormat accepts foreign plates', () => {
  assert.strictEqual(validatePlateFormat('B 807 SEL'), true);
  assert.strictEqual(validatePlateFormat('B807SEL'), true);
  assert.strictEqual(validatePlateFormat('BG 1234 AB'), true);
  assert.strictEqual(isForeignPlate('B 807 SEL'), true);
  assert.strictEqual(isTurkishPlate('B 807 SEL'), false);
});

test('validatePlateFormat rejects invalid', () => {
  assert.strictEqual(validatePlateFormat('XYZ'), false);
  assert.strictEqual(validatePlateFormat('1 A 1'), false);
  assert.strictEqual(validatePlateFormat('!!!'), false);
});

test('formatForeignPlateDisplay writes plates without spaces', () => {
  assert.strictEqual(formatForeignPlateDisplay('b 807 sel'), 'B807SEL');
});

test('compactPlate strips spaces from Turkish plates', () => {
  const { compactPlate, compactRecordPlates } = require('../lib/plate-format');
  assert.strictEqual(compactPlate('34 ABC 1234'), '34ABC1234');
  assert.strictEqual(compactPlate('06 FAY 148'), '06FAY148');
  const row = compactRecordPlates({ plaka: '43 ADS 408', dorsePlaka: '16 AB 123', firma: 'HP7' });
  assert.strictEqual(row.plaka, '43ADS408');
  assert.strictEqual(row.dorsePlaka, '16AB123');
  assert.strictEqual(row.firma, 'HP7');
});
