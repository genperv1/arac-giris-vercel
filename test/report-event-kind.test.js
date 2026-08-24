'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const code = fs.readFileSync(path.join(__dirname, '../public/report.js'), 'utf8');
const start = code.indexOf('  const YD_FIRMA_RE');
const end = code.indexOf('  function reportRowKind');
assert.ok(start >= 0, 'YD_FIRMA_RE missing');
assert.ok(end > start, 'reportEventKind block missing');

const api = eval(`(function(){
${code.slice(start, end)}
  return { reportEventKind };
})()`);

test('G16 with piyasa I01 irsaliye stays piyasa', () => {
  const kind = api.reportEventKind({
    data: {
      firma: 'G16',
      yuklemeNotu: 'İrsaliye No: I01202600002346',
    },
  });
  assert.equal(kind, 'piyasa');
});

test('R11 irsaliye note is ihracat', () => {
  const kind = api.reportEventKind({
    data: {
      firma: 'HP2',
      yuklemeNotu: 'İrsaliye No: R11 202601039',
    },
  });
  assert.equal(kind, 'ihracat');
});

test('YD firma is ihracat', () => {
  const kind = api.reportEventKind({
    data: { firma: 'YD113(G) / LOT NO 26 05 06', yuklemeNotu: '' },
  });
  assert.equal(kind, 'ihracat');
});

test('piyasa sevkiyat_id wins', () => {
  const kind = api.reportEventKind({
    data: {
      firma: 'G16',
      sevkiyat_id: 'piyasa:34:34-HAFTA :16',
      yuklemeNotu: 'İrsaliye No: R11 202601039',
    },
  });
  assert.equal(kind, 'piyasa');
});
