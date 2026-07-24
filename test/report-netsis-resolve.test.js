'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const code = fs.readFileSync(path.join(__dirname, '../public/report.js'), 'utf8');

const normStart = code.indexOf('/** Sunucu /api/vehicles/lookup-batch ile aynı plaka anahtarı */');
const mergeEnd = code.indexOf('function findLastPrintEvent');
assert.ok(normStart >= 0, 'normPlateKey block missing');
assert.ok(mergeEnd > normStart, 'merge helpers missing');

const wrapped = `(function(){
  ${code.slice(normStart, mergeEnd)}
  return {
    normPlateKey,
    splitSoforForExcel,
    acceptLookupVehicleForRow,
    mergeReportRowVehicleForCopy,
  };
})()`;

const api = eval(wrapped);

test('acceptLookupVehicleForRow rejects dorse-only match (wrong previous truck)', () => {
  const wrong = {
    id: 'nl175',
    cekiciPlaka: '43 NL 175',
    dorsePlaka: '43 ACC 044',
    soforAdi: 'AHMET',
    iletisim: '05321111111',
  };
  assert.equal(
    api.acceptLookupVehicleForRow(wrong, '43 ACC 044'),
    null,
    'dorse eşleşen önceki araç NETSIS için kullanılmamalı'
  );
});

test('acceptLookupVehicleForRow accepts matching cekici plate', () => {
  const ok = { id: 'acc044', cekiciPlaka: '43 ACC 044', iletisim: '05322222222' };
  assert.equal(api.acceptLookupVehicleForRow(ok, '43 ACC 044'), ok);
});

test('mergeReportRowVehicleForCopy keeps row plate even if lookup has different cekici', () => {
  const source = {
    plaka: '43 ACC 044',
    sofor: 'MEHMET YILMAZ',
    tarih: '25.07.2026',
    saat: '14:30:00',
  };
  const wrongLookup = {
    cekiciPlaka: '43 NL 175',
    dorsePlaka: '43 ACC 044',
    soforAdi: 'AHMET',
    soforSoyadi: 'KAYA',
    iletisim: '05321111111',
    tcKimlik: '11111111111',
    saat: '12:00:00',
    tarih: '25.07.2026',
  };
  const merged = api.mergeReportRowVehicleForCopy('43 ACC 044', source, wrongLookup);
  assert.equal(merged.cekiciPlaka, '43 ACC 044');
  assert.equal(merged.soforAdi, 'MEHMET');
  assert.equal(merged.soforSoyadi, 'YILMAZ');
  assert.equal(merged.saat, '14:30:00', 'lookup saati satır saatini ezmemeli');
  assert.equal(merged.iletisim, '', 'yanlış lookup telefonu doldurulmamalı');
  assert.equal(merged.tcKimlik, '');
});

test('mergeReportRowVehicleForCopy fills missing phone/TC/dorse from matching vehicle only', () => {
  const source = {
    plaka: '34 ABC 01',
    sofor: 'AYŞE DEMİR',
    tarih: '25.07.2026',
    saat: '09:15:00',
  };
  const fill = {
    cekiciPlaka: '34 ABC 01',
    iletisim: '05333333333',
    tcKimlik: '22222222222',
    dorsePlaka: '34 DRS 02',
    saat: '08:00:00',
  };
  const merged = api.mergeReportRowVehicleForCopy('34 ABC 01', source, fill);
  assert.equal(merged.cekiciPlaka, '34 ABC 01');
  assert.equal(merged.iletisim, '05333333333');
  assert.equal(merged.tcKimlik, '22222222222');
  assert.equal(merged.dorsePlaka, '34 DRS 02');
  assert.equal(merged.saat, '09:15:00');
  assert.equal(merged.soforAdi, 'AYŞE');
});

test('mergeReportRowVehicleForCopy prefers event contact fields over lookup', () => {
  const source = {
    plaka: '34 ABC 01',
    sofor: 'AYŞE DEMİR',
    iletisim: '05554443322',
    tcKimlik: '33333333333',
    dorsePlaka: '34 XXX 99',
    saat: '11:00:00',
  };
  const fill = {
    cekiciPlaka: '34 ABC 01',
    iletisim: '05000000000',
    tcKimlik: '99999999999',
    dorsePlaka: '34 OLD 01',
  };
  const merged = api.mergeReportRowVehicleForCopy('34 ABC 01', source, fill);
  assert.equal(merged.iletisim, '05554443322');
  assert.equal(merged.tcKimlik, '33333333333');
  assert.equal(merged.dorsePlaka, '34 XXX 99');
});
