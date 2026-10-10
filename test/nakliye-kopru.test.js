'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { gecen, ucretliParcalar, otoyolBedel } = require('../public/nakliye-liman');

test('Osmangazi üzerinden geçen çizgi köprüyü yakalar', () => {
  const sonuc = gecen([[29.40, 40.70], [29.62, 40.80]]);
  assert.deepEqual(sonuc.acik.map((row) => row.id), ['osmangazi']);
  assert.equal(sonuc.kapali.length, 0);
});

test('Gemlik kıyısı Osmangazi sayılmaz', () => {
  const sonuc = gecen([[29.00, 40.30], [29.20, 40.45]]);
  assert.equal(sonuc.acik.length, 0);
});

test('Paralı otoyolun üstündeki uzun çizgi yakalanır', () => {
  const yol = [{ id: 'O-4-1', ad: 'O-4', parali: true, koord: [[30, 40], [30.45, 40]] }];
  const cizgi = [[30.02, 40.005], [30.15, 40.004], [30.28, 40.002], [30.4, 40]];
  const parts = ucretliParcalar(cizgi, yol);
  assert.equal(parts.length, 1);
  assert.equal(parts[0].ad, 'O-4');
});

test('Otoyoldan uzak çizgi paralı sayılmaz', () => {
  const yol = [{ id: 'O-4-1', ad: 'O-4', parali: true, koord: [[30, 40], [30.45, 40]] }];
  const cizgi = [[30.02, 40.2], [30.2, 40.2], [30.4, 40.2]];
  assert.equal(ucretliParcalar(cizgi, yol).length, 0);
});

test('Aynı otoyolun ayrı parçaları tek kesim sayılır', () => {
  const yollar = [
    { id: 'O-4-1', ad: 'O-4', parali: true, koord: [[30, 40], [30.08, 40]] },
    { id: 'O-4-2', ad: 'O-4', parali: true, koord: [[30.08, 40], [30.2, 40]] },
  ];
  const cizgi = [[30.01, 40.002], [30.06, 40.001], [30.12, 40], [30.18, 40]];
  const parts = ucretliParcalar(cizgi, yollar);
  assert.equal(parts.length, 1);
  assert.equal(parts[0].ad, 'O-4');
});

test('Kısa kesişme paralı otoyol sayılmaz', () => {
  const yol = [{ id: 'O-5-1', ad: 'O-5', parali: true, koord: [[29, 40.7], [29.5, 40.8]] }];
  const cizgi = [[29.2, 40.74], [29.22, 40.745]];
  assert.equal(ucretliParcalar(cizgi, yol).length, 0);
});

test('O-4 net ücreti gişe kilometresine göre', () => {
  assert.deepEqual(otoyolBedel('O-4', 25), { sinif4: 115, sinif5: 148 });
  assert.deepEqual(otoyolBedel('O-4', 400), { sinif4: 675, sinif5: 811 });
  assert.equal(otoyolBedel('O-5', 40), null);
});

test('Fatih Sultan Mehmet tır köprüsü sayılmaz', () => {
  const sonuc = gecen([[29.04, 41.08], [29.08, 41.10]]);
  assert.equal(sonuc.acik.length, 0);
  assert.equal(sonuc.kapali[0].id, 'fsm');
});
