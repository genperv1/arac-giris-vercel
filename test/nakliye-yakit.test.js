'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  TIR_TUKETIM,
  tahminiYakit,
  pickMotorin,
  buildMazotPayload,
  parseOsrmRoute,
  yolTahminiKm,
  turkiyeIcinde,
  samePlaceName,
} = require('../lib/nakliye-yakit');

test('yüklü tır 100 km mazot tutarını hesaplar', () => {
  const sonuc = tahminiYakit({ km: 100, litrePer100: TIR_TUKETIM.yuklu, fiyatTl: 90, donus: false });
  assert.equal(sonuc.litre, 35);
  assert.equal(sonuc.tutarTl, 3150);
  assert.equal(sonuc.mesafeKm, 100);
});

test('gidiş-dönüş mesafeyi ve yakıtı ikiye katlar', () => {
  const sonuc = tahminiYakit({ km: 312.4, litrePer100: TIR_TUKETIM.bos, fiyatTl: 91.5, donus: true });
  assert.equal(sonuc.mesafeKm, 624.8);
  assert.equal(sonuc.litre, 174.9);
  assert.equal(sonuc.tutarTl, 16003.35);
});

test('motorin olarak UltraForce fiyatını seçer', () => {
  const picked = pickMotorin([
    { productShortName: 'KURS', amount: 80 },
    { productShortName: 'MT_ECO', amount: 88 },
    { productShortName: 'MT_ULT', productName: 'Motorin UltraForce', amount: 91.26 },
  ]);
  assert.equal(picked.mazot, 91.26);
});

test('ilçe mazotunu il merkez fiyatından ayırır', () => {
  const payload = buildMazotPayload([
    {
      provinceName: 'ANKARA',
      districtName: 'ÇANKAYA',
      prices: [{ productShortName: 'MT_ULT', amount: 91.26 }],
    },
    {
      provinceName: 'ANKARA',
      districtName: 'POLATLI',
      prices: [{ productShortName: 'MT_ULT', amount: 92 }],
    },
    {
      provinceName: 'İSTANBUL ANADOLU',
      districtName: 'KADIKÖY',
      prices: [{ productShortName: 'MT_ULT', amount: 90.07 }],
    },
    {
      provinceName: 'İSTANBUL AVRUPA',
      districtName: 'EYÜPSULTAN',
      prices: [{ productShortName: 'MT_ULT', amount: 90.2 }],
    },
    {
      provinceName: 'ANKARA',
      districtName: 'MERKEZ',
      prices: [{ productShortName: 'MT_ULT', amount: 80 }],
    },
  ], {
    iller: [
      { plaka: 6, ad: 'Ankara' },
      { plaka: 34, ad: 'İstanbul' },
    ],
    ilceler: [
      { plaka: 6, ad: 'Çankaya' },
      { plaka: 6, ad: 'Polatlı' },
      { plaka: 34, ad: 'Kadıköy' },
      { plaka: 34, ad: 'Eyüp' },
    ],
  });
  const ankara = payload.iller.find((il) => il.plaka === 6);
  const istanbul = payload.iller.find((il) => il.plaka === 34);
  assert.equal(ankara.mazot, 91.26);
  assert.equal(istanbul.mazot, 90.14);
  assert.equal(payload.ilceler.find((d) => d.ad === 'Kadıköy').mazot, 90.07);
  assert.equal(payload.ilceler.find((d) => d.ad === 'Eyüp').mazot, 90.2);
  assert.equal(payload.ilceler.some((d) => d.ad === 'Merkez'), false);
});

test('Eyüp ile Eyüpsultan aynı ilçedir', () => {
  assert.equal(samePlaceName('Eyüp', 'Eyüpsultan'), true);
});

test('karayolu cevabından km ve süre okunur', () => {
  const route = parseOsrmRoute({
    routes: [{
      distance: 480603.8,
      duration: 18217.8,
      geometry: { coordinates: [[29.06, 40.19], [32.85, 39.92]] },
    }],
  });
  assert.equal(route.km, 480.6);
  assert.equal(route.sureDk, 304);
  assert.equal(route.kaynak, 'karayolu');
  assert.equal(route.cizgi.length, 2);
});

test('kuş uçuşu tahmini Türkiye içi iki nokta için yol payı ekler', () => {
  const km = yolTahminiKm({ lat: 41.01, lon: 28.95 }, { lat: 39.93, lon: 32.85 });
  assert.ok(km > 400 && km < 520);
  assert.equal(turkiyeIcinde(39.93, 32.85), true);
  assert.equal(turkiyeIcinde(48, 2), false);
});
