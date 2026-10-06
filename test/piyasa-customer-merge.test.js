const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadCustomersApi() {
  const code = fs.readFileSync(path.join(__dirname, '../public/modules/piyasa-customers.js'), 'utf8');
  const context = { console };
  vm.createContext(context);
  vm.runInContext(code, context);
  return context;
}

const api = loadCustomersApi();

test('HP eklenince GP durur, aynı kod güncellenir, yeni kod eklenir', () => {
  const existing = [
    { id: 'gp1', kod: 'GP1', ad: 'Genleşmiş A', il: 'ANKARA', urunTipi: 'GP' },
    { id: 'gp2', kod: 'GP2', ad: 'Genleşmiş B', il: 'İZMİR' },
    { id: 'hp1', kod: 'HP1', ad: 'Eski Ham', il: 'BURSA', adres: 'Eski adres' },
  ];
  const incoming = [
    { id: 'excel-1', kod: 'HP1', ad: 'Yeni Ham', il: 'BURSA', adres: 'Yeni adres', urunTipi: 'HP' },
    { id: 'excel-2', kod: 'hp13', ad: 'Ham 13', il: 'KONYA' },
  ];
  const merged = api.mergePiyasaCustomerLists(existing, incoming);
  const byKod = Object.fromEntries(merged.customers.map((c) => [c.kod.toUpperCase(), c]));
  assert.equal(merged.added, 1);
  assert.equal(merged.updated, 1);
  assert.equal(merged.kept, 2);
  assert.equal(merged.customers.length, 4);
  assert.equal(byKod.GP1.ad, 'Genleşmiş A');
  assert.equal(byKod.GP2.ad, 'Genleşmiş B');
  assert.equal(byKod.HP1.ad, 'Yeni Ham');
  assert.equal(byKod.HP1.id, 'hp1');
  assert.equal(byKod.HP1.adres, 'Yeni adres');
  assert.equal(byKod.HP13.ad, 'Ham 13');
  assert.equal(byKod.HP13.il, 'KONYA');
});
