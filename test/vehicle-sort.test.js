const test = require('node:test');
const assert = require('node:assert/strict');
const { computeVehicleSortTs } = require('../lib/vehicle-helpers');

test('işlem gören araç kayıt tarihinden üste çıkar', () => {
  const bumped = computeVehicleSortTs({
    kayitTarihi: '01.01.2020 08:00:00',
    listBumpTs: 2000000000000,
  });
  const plain = computeVehicleSortTs({ kayitTarihi: '02.10.2026 09:15:00' });
  assert.equal(bumped, 2000000000000);
  assert.ok(bumped > plain);
});

test('işlem yoksa kayıt tarihi sırası durur', () => {
  const ts = computeVehicleSortTs({ kayitTarihi: '02.10.2026 09:15:00' });
  assert.equal(ts, Date.parse('2026-10-02T09:15:00'));
});
