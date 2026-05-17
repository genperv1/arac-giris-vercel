'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { validatePlateFormat } = require('../lib/plate-format');

test('validatePlateFormat accepts common formats', () => {
  assert.strictEqual(validatePlateFormat(''), true);
  assert.strictEqual(validatePlateFormat('34 ABC 1234'), true);
  assert.strictEqual(validatePlateFormat('34ABC1234'), true);
  assert.strictEqual(validatePlateFormat('06 AA 1234'), true);
});

test('validatePlateFormat rejects invalid', () => {
  assert.strictEqual(validatePlateFormat('XYZ'), false);
  assert.strictEqual(validatePlateFormat('1 A 1'), false);
});
