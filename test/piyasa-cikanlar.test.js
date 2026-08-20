'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isYdFirma,
  istanbulDayStartMs,
  istanbulDayEndMs,
  normalizeCikanlarInsert,
} = require('../lib/piyasa-cikanlar');

test('isYdFirma detects export codes only', () => {
  assert.equal(isYdFirma('YD28'), true);
  assert.equal(isYdFirma('YD28(G) / Firma'), true);
  assert.equal(isYdFirma('HP7'), false);
  assert.equal(isYdFirma('HP7 / ANKARA'), false);
  assert.equal(isYdFirma(''), false);
});

test('istanbul day bounds are +03:00', () => {
  const start = istanbulDayStartMs('2026-08-20');
  const end = istanbulDayEndMs('2026-08-20');
  assert.equal(start, Date.parse('2026-08-20T00:00:00+03:00'));
  assert.equal(end, start + 86400000);
  assert.equal(istanbulDayStartMs('bad'), null);
});

test('normalizeCikanlarInsert rejects YD', () => {
  const row = normalizeCikanlarInsert({ plaka: '43 ABC 123', firma: 'YD33' }, (s, n) => String(s).slice(0, n));
  assert.equal(row.error, 'YD_NOT_ALLOWED');
});

test('normalizeCikanlarInsert keeps HP7 even if fromIhracat flag is set', () => {
  const row = normalizeCikanlarInsert({
    plaka: '43 ABC 123',
    firma: 'HP7',
    fromIhracat: true,
  }, (s, n) => String(s).slice(0, n));
  assert.equal(row.error, undefined);
  assert.equal(row.firma, 'HP7');
});

test('iso week matches Piyasa Excel reading', () => {
  const { isoWeekFromYmd, isoWeekFromParts, haftaLabel, resolveHafta } = require('../lib/piyasa-cikanlar');
  assert.equal(isoWeekFromYmd('2026-08-20'), 34);
  assert.equal(isoWeekFromParts(2026, 1, 1), 1);
  assert.equal(haftaLabel(34), '34. hafta');
  assert.equal(resolveHafta('34', 0), 34);
  assert.equal(resolveHafta('', Date.parse('2026-08-20T12:00:00+03:00')), 34);
});

test('normalizeCikanlarInsert keeps piyasa fields', () => {
  const row = normalizeCikanlarInsert({
    plaka: '43 ABC 123',
    firma: 'HP7',
    firmaAdi: 'Ankara bayi',
    sipNo: 'S-11',
    malzeme: 'Ham perlit',
    sehir: 'ANKARA',
    tonaj: '25',
  }, (s, n) => String(s).slice(0, n));
  assert.equal(row.error, undefined);
  assert.equal(row.firma, 'HP7');
  assert.equal(row.sip_no, 'S-11');
  assert.equal(row.sehir, 'ANKARA');
  assert.ok(row.id);
});
