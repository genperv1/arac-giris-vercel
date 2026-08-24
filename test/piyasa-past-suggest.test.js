'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const code = fs.readFileSync(path.join(__dirname, '../public/modules/piyasa-orders.js'), 'utf8');
const start = code.indexOf('  function parsePiyasaWeekNum');
const end = code.indexOf('  function countOrdersForFirma');
assert.ok(start >= 0, 'parsePiyasaWeekNum missing');
assert.ok(end > start, 'findPastPiyasaSuggestions block missing');

const api = eval(`(function(){
${code.slice(start, end)}
  return { parsePiyasaWeekNum, findPastPiyasaSuggestions };
})()`);

function lists(extra) {
  return Object.assign({
    currentWeek: 34,
    currentSheet: '34-HAFTA',
    currentOrders: [
      { __idx: 1, firma: 'HP2', malzeme: 'HP 0.15-0.60' },
    ],
    weekArchive: [
      {
        week: 34,
        sheet: '34-HAFTA',
        orders: [{ __idx: 1, firma: 'HP2', malzeme: 'HP 0.15-0.60' }],
      },
      {
        week: 33,
        sheet: '33-HAFTA',
        orders: [{
          __idx: 16,
          firma: 'G16',
          firmaAdi: 'Adm Besin ve Tarım',
          malzeme: 'P2 (PB180-13)',
          lastPrintPlate: '43 ADP 256',
          lastPrintAt: 100,
        }],
      },
      {
        week: 32,
        sheet: '32-HAFTA',
        orders: [{
          __idx: 46,
          firma: 'G16',
          firmaAdi: 'Adm Besin ve Tarım',
          malzeme: 'P2 (PB180-13)',
          lastPrintPlate: '43 ADP 256',
          lastPrintAt: 50,
        }],
      },
    ],
    getOrderPickKey: (o) => (o && o.__idx != null ? String(o.__idx) : null),
    limit: 5,
  }, extra || {});
}

test('G16 missing this week is suggested from older weeks', () => {
  const r = api.findPastPiyasaSuggestions('G16', lists());
  assert.equal(r.currentWeek, 34);
  assert.equal(r.currentCount, 0);
  assert.equal(r.past.length, 2);
  assert.equal(r.past[0].week, 33);
  assert.equal(r.past[0].malzeme, 'P2 (PB180-13)');
  assert.equal(r.past[1].week, 32);
});

test('same malzeme in older weeks is kept per week not collapsed to one', () => {
  const r = api.findPastPiyasaSuggestions('G16', lists());
  assert.equal(r.past[0].week, 33);
  assert.equal(r.past[1].week, 32);
});

test('current-week firma is not treated as past', () => {
  const r = api.findPastPiyasaSuggestions('HP2', lists());
  assert.equal(r.currentCount, 1);
  assert.equal(r.past.length, 0);
});

test('unknown firma has no past suggestions', () => {
  const r = api.findPastPiyasaSuggestions('ZZ9', lists());
  assert.equal(r.currentCount, 0);
  assert.equal(r.past.length, 0);
});
