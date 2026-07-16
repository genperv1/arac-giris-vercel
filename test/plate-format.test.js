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

test('formatForeignPlateDisplay normalizes safely', () => {
  assert.strictEqual(formatForeignPlateDisplay('b 807 sel'), 'B 807 SEL');
});
