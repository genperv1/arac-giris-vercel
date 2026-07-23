'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const code = fs.readFileSync(
  path.join(__dirname, '../public/modules/app-excel-ihracat.js'),
  'utf8'
);

const plateKeyStart = code.indexOf('function _plateKeyForMatch');
const resolveStart = code.indexOf('function resolveTakipVehicleIdForPrint');
const resolveEnd = code.indexOf('/** Takip formu: tek satırlık şoför');
assert.ok(plateKeyStart >= 0 && resolveStart >= 0 && resolveEnd > resolveStart);

const wrapped = `(function(){
  let state = { vehicles: [] };
  ${code.slice(plateKeyStart, resolveEnd)}
  return {
    resolveTakipVehicleIdForPrint,
    setVehicles(list) { state.vehicles = list; },
  };
})()`;

const api = eval(wrapped);

test('resolveTakipVehicleIdForPrint ignores hint when form plate differs (Fatih ACC vs NL)', () => {
  api.setVehicles([
    { id: 'nl175', cekiciPlaka: '43 NL 175', dorsePlaka: '43 ACC 044', soforAdi: 'FATİH', soforSoyadi: 'ÜNAL' },
    { id: 'acc044', cekiciPlaka: '43 ACC 044', soforAdi: 'FATİH', soforSoyadi: 'ÜNAL' },
  ]);

  assert.equal(
    api.resolveTakipVehicleIdForPrint('43 ACC 044', 'nl175'),
    'acc044',
    'formdaki ACC plaka, eski NL hint id yerine ACC araç kaydına bağlanmalı'
  );
});

test('resolveTakipVehicleIdForPrint keeps hint when plate matches', () => {
  api.setVehicles([
    { id: 'nl175', cekiciPlaka: '43 NL 175' },
  ]);
  assert.equal(api.resolveTakipVehicleIdForPrint('43 NL 175', 'nl175'), 'nl175');
});

test('resolveTakipVehicleIdForPrint does not bind via dorse-only match', () => {
  api.setVehicles([
    { id: 'nl175', cekiciPlaka: '43 NL 175', dorsePlaka: '43 ACC 044' },
  ]);
  assert.equal(
    api.resolveTakipVehicleIdForPrint('43 ACC 044', 'manual'),
    'manual',
    'dorse plaka ile eski çekici kartına yazdırma bağlanmamalı'
  );
});
