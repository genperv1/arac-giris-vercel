'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { isPiyasaCatalogWrite } = require('../lib/piyasa-write-guard');
const { isAmirIdentity } = require('../lib/amir-user');

const base = {
  week: 40,
  sheet: 'HP',
  loadedAt: '2026-09-29T10:00:00.000Z',
  fileFingerprint: 'abc',
  orders: [{ __idx: 1, firma: 'HP7', malzeme: '0.30', miktar: 10, printCount: 0 }],
};

test('print count update is not a catalog write', () => {
  const next = JSON.parse(JSON.stringify(base));
  next.updatedAt = Date.now();
  next.orders[0].printCount = 2;
  next.orders[0].usedPlate = '34ABC123';
  assert.equal(isPiyasaCatalogWrite(base, next), false);
});

test('clearing orders is a catalog write', () => {
  assert.equal(isPiyasaCatalogWrite(base, { orders: [], fileFingerprint: null }), true);
});

test('replacing the excel fingerprint is a catalog write', () => {
  const next = JSON.parse(JSON.stringify(base));
  next.fileFingerprint = 'new-file';
  assert.equal(isPiyasaCatalogWrite(base, next), true);
});

test('amir identity is xxr or role amir, not GENPER admin', () => {
  assert.equal(isAmirIdentity({ username: 'xxr', role: 'amir' }), true);
  assert.equal(isAmirIdentity({ username: 'xxr', role: 'user' }), true);
  assert.equal(isAmirIdentity({ username: 'GENPER', role: 'admin' }), false);
  assert.equal(isAmirIdentity({ username: 'op', role: 'operator' }), false);
});
