'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { countFromFingerprint } = require('../lib/vehicle-list-cache');

test('countFromFingerprint reads the leading count', () => {
  assert.strictEqual(countFromFingerprint('4821:170000:abc:3'), 4821);
  assert.strictEqual(countFromFingerprint('0:0::1'), 0);
});

test('countFromFingerprint ignores a broken fingerprint', () => {
  assert.strictEqual(countFromFingerprint(''), 0);
  assert.strictEqual(countFromFingerprint(null), 0);
  assert.strictEqual(countFromFingerprint('nope'), 0);
});
