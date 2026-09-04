'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const code = fs.readFileSync(path.join(__dirname, '../public/report.js'), 'utf8');
const start = code.indexOf('  function normFirmaCodeKey');
const end = code.indexOf('  async function loadFirmaNameMap');
assert.ok(start >= 0, 'normFirmaCodeKey missing');
assert.ok(end > start, 'loadFirmaNameMap missing');

function loadApi() {
  return eval(`(function(){
    const _firmaNameByCode = new Map();
    ${code.slice(start, end)}
    return {
      ingestFirmaCustomers,
      lookupFirmaName,
      resolveReportFirma,
      _firmaNameByCode,
    };
  })()`);
}

test('MD1 maps to Eti Gümüş via MD1S suffix, not leftover Kaltun Tarım', () => {
  const api = loadApi();
  api.ingestFirmaCustomers([
    { kod: 'MD1S', ad: 'Eti Gümüş' },
    { kod: 'T88D', ad: 'Kaltun Tarım' },
  ]);
  assert.equal(api.lookupFirmaName('MD1'), 'Eti Gümüş');
  assert.equal(api.lookupFirmaName('MD1S'), 'Eti Gümüş');
  assert.equal(api.lookupFirmaName('T88'), 'Kaltun Tarım');

  const resolved = api.resolveReportFirma({
    firma: 'MD1',
    firmaAdi: 'Kaltun Tarım',
  });
  assert.equal(resolved.code, 'MD1');
  assert.equal(resolved.name, 'Eti Gümüş');
});

test('MD1 does not steal MD10 / another company', () => {
  const api = loadApi();
  api.ingestFirmaCustomers([
    { kod: 'MD1S', ad: 'Eti Gümüş' },
    { kod: 'MD10D', ad: 'Başka Firma' },
  ]);
  assert.equal(api.lookupFirmaName('MD1'), 'Eti Gümüş');
  assert.equal(api.lookupFirmaName('MD10'), 'Başka Firma');
});

test('same-name suffix variants share the short code', () => {
  const api = loadApi();
  api.ingestFirmaCustomers([
    { kod: 'MD2BGD', ad: 'Eti Maden İşletmeleri' },
    { kod: 'MD2D', ad: 'Eti Maden İşletmeleri' },
  ]);
  assert.equal(api.lookupFirmaName('MD2'), 'Eti Maden İşletmeleri');
});

test('stored name is used only when müşteri listesinde yok', () => {
  const api = loadApi();
  const resolved = api.resolveReportFirma({
    firma: 'ZZ9',
    firmaAdi: 'Elle Yazılmış Ünvan',
  });
  assert.equal(resolved.code, 'ZZ9');
  assert.equal(resolved.name, 'Elle Yazılmış Ünvan');
});
