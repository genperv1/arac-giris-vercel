'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { gecen } = require('../public/nakliye-liman');

test('Osmangazi üzerinden geçen çizgi köprüyü yakalar', () => {
  const sonuc = gecen([[29.40, 40.70], [29.62, 40.80]]);
  assert.deepEqual(sonuc.acik.map((row) => row.id), ['osmangazi']);
  assert.equal(sonuc.kapali.length, 0);
});

test('Gemlik kıyısı Osmangazi sayılmaz', () => {
  const sonuc = gecen([[29.00, 40.30], [29.20, 40.45]]);
  assert.equal(sonuc.acik.length, 0);
});

test('Fatih Sultan Mehmet tır köprüsü sayılmaz', () => {
  const sonuc = gecen([[29.04, 41.08], [29.08, 41.10]]);
  assert.equal(sonuc.acik.length, 0);
  assert.equal(sonuc.kapali[0].id, 'fsm');
});
