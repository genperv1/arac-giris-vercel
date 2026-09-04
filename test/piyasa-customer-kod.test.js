'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '../public/modules/piyasa-customers.js'), 'utf8');
const start = src.indexOf('  function normFirmaKodKey');
const end = src.indexOf('  /** Müşteri listesi urunTipi');
assert.ok(start >= 0, 'normFirmaKodKey missing');
assert.ok(end > start, 'resolvePiyasaCustomerByKod block missing');

function loadApi(customers) {
  const api = eval(`(function(){
    let _customerStore = { customers: [], byKod: new Map() };
    ${src.slice(start, end)}
    function setCustomers(list) {
      const byKod = new Map();
      for (const c of list) {
        const key = normFirmaKodKey(c.kod);
        if (key && !byKod.has(key)) byKod.set(key, c);
      }
      _customerStore = { customers: list.slice(), byKod };
    }
    return { setCustomers, findClosestPiyasaCustomerByKod, resolvePiyasaCustomerByKod };
  })()`);
  api.setCustomers(customers);
  return api;
}

test('MD1 resolves to MD1S Eti Gümüş, not T88 Kaltun Tarım', () => {
  const api = loadApi([
    { kod: 'MD1S', ad: 'Eti Gümüş' },
    { kod: 'T88D', ad: 'Kaltun Tarım' },
    { kod: 'MD10D', ad: 'Başka Firma' },
  ]);
  const md1 = api.resolvePiyasaCustomerByKod('MD1');
  assert.equal(md1 && md1.ad, 'Eti Gümüş');
  const t88 = api.resolvePiyasaCustomerByKod('T88');
  assert.equal(t88 && t88.ad, 'Kaltun Tarım');
  const md10 = api.resolvePiyasaCustomerByKod('MD10');
  assert.equal(md10 && md10.ad, 'Başka Firma');
});

test('short prefix does not match a longer different code', () => {
  const api = loadApi([
    { kod: 'T88D', ad: 'Kaltun Tarım' },
  ]);
  assert.equal(api.resolvePiyasaCustomerByKod('T8'), null);
  assert.equal(api.resolvePiyasaCustomerByKod('MD1'), null);
});
