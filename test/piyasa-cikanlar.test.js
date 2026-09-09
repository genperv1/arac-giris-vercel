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
  const { isoWeekFromYmd, isoWeekFromParts, haftaLabel, resolveHafta, isoWeekInfoFromMs } = require('../lib/piyasa-cikanlar');
  assert.equal(isoWeekFromYmd('2026-08-20'), 34);
  assert.equal(isoWeekFromParts(2026, 1, 1), 1);
  assert.equal(haftaLabel(34), '34. hafta');
  assert.equal(resolveHafta('34', 0), 34);
  assert.equal(resolveHafta('', Date.parse('2026-08-20T12:00:00+03:00')), 34);
  assert.equal(resolveHafta('34', Date.parse('2026-08-24T00:31:31+03:00')), 35);
  const info = isoWeekInfoFromMs(Date.parse('2026-08-22T12:00:00+03:00'));
  assert.equal(info.week, 34);
  assert.equal(info.year, 2026);
});

test('formatIsoWeekRange shows Monday–Sunday', () => {
  const { formatIsoWeekRange, isoWeekMondayUtc } = require('../lib/piyasa-cikanlar');
  const monday = isoWeekMondayUtc(2026, 34);
  assert.equal(monday.toISOString().slice(0, 10), '2026-08-17');
  assert.equal(formatIsoWeekRange(2026, 34), '17–23 Ağu');
});

test('groupCikanlarByHafta keeps current week open and past weeks separate', () => {
  const { groupCikanlarByHafta } = require('../lib/piyasa-cikanlar');
  const now = Date.parse('2026-08-22T12:00:00+03:00');
  const groups = groupCikanlarByHafta([
    { id: 'a', tarih: Date.parse('2026-08-22T10:00:00+03:00'), hafta: '34', haftaYear: 2026 },
    { id: 'b', tarih: Date.parse('2026-08-12T10:00:00+03:00'), hafta: '33', haftaYear: 2026 },
    { id: 'c', tarih: Date.parse('2026-08-10T10:00:00+03:00'), hafta: '33', haftaYear: 2026 },
  ], now);
  assert.equal(groups[0].isCurrent, true);
  assert.equal(groups[0].title, 'Bu hafta');
  assert.equal(groups[0].week, 34);
  assert.equal(groups[0].count, 1);
  assert.equal(groups[1].title, '33. hafta');
  assert.equal(groups[1].count, 2);
  assert.equal(groups[1].isCurrent, false);
});

test('groupCikanlarByHafta uses print date not Excel source week', () => {
  const { groupCikanlarByHafta } = require('../lib/piyasa-cikanlar');
  const now = Date.parse('2026-08-24T00:40:00+03:00');
  const groups = groupCikanlarByHafta([
    {
      id: 'hp8',
      tarih: Date.parse('2026-08-24T00:31:31+03:00'),
      hafta: '34',
      haftaYear: 2026,
      firma: 'HP8',
    },
  ], now);
  assert.equal(groups[0].isCurrent, true);
  assert.equal(groups[0].week, 35);
  assert.equal(groups[0].count, 1);
  assert.equal(groups[0].rows[0].firma, 'HP8');
});

test('groupCikanlarByHafta still shows empty current week', () => {
  const { groupCikanlarByHafta } = require('../lib/piyasa-cikanlar');
  const now = Date.parse('2026-08-22T12:00:00+03:00');
  const groups = groupCikanlarByHafta([
    { id: 'b', tarih: Date.parse('2026-08-12T10:00:00+03:00'), hafta: '33', haftaYear: 2026 },
  ], now);
  assert.equal(groups[0].isCurrent, true);
  assert.equal(groups[0].count, 0);
  assert.equal(groups[1].week, 33);
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

test('normalizeCikanlarInsert maps il alias to sehir', () => {
  const row = normalizeCikanlarInsert({
    plaka: '43 ABC 123',
    firma: 'HP7',
    il: 'KONYA/SELÇUKLU',
  }, (s, n) => String(s).slice(0, n));
  assert.equal(row.sehir, 'KONYA/SELÇUKLU');
});

test('foldTrIl treats SİVAS / Sivas / sivas as the same', () => {
  const { foldTrIl, rowMatchesIl } = require('../lib/piyasa-cikanlar');
  assert.equal(foldTrIl('SİVAS'), 'SIVAS');
  assert.equal(foldTrIl('Sivas'), 'SIVAS');
  assert.equal(foldTrIl('sivas'), 'SIVAS');
  assert.equal(rowMatchesIl({ sehir: 'SİVAS' }, 'sivas'), true);
  assert.equal(rowMatchesIl({ sehir: 'Sivas' }, 'SİVAS'), true);
  assert.equal(rowMatchesIl({ sevk_yeri: 'SİVAS/MERKEZ' }, 'sivas'), true);
  assert.equal(rowMatchesIl({ sehir: 'İNÖNÜ/ESKİŞEHİR' }, 'SİVAS'), false);
  assert.equal(rowMatchesIl({ sehir: 'İSTANBUL' }, 'SİVAS'), false);
});

test('displaySehir prefers Excel il like printed picker', () => {
  const { displaySehir, sehirSearchHay } = require('../lib/piyasa-cikanlar');
  assert.equal(displaySehir({ sehir: 'ANKARA/BALA', sevk_yeri: 'Depo-3' }), 'ANKARA/BALA');
  assert.equal(displaySehir({ il: 'İZMİR', sevk_yeri: 'ALSANCAK' }), 'İZMİR');
  assert.equal(displaySehir({ sevk_yeri: 'BURSA' }), 'BURSA');
  assert.equal(displaySehir({}), '');
  const hay = sehirSearchHay({ sehir: 'ANKARA/BALA', sevk_yeri: 'Depo-3' });
  assert.ok(hay.includes('ANKARA/BALA'));
  assert.ok(hay.includes('DEPO-3'));
});

test('pickCikanlarFormFields keeps typed print malzeme over Excel order', () => {
  const { pickCikanlarFormFields } = require('../lib/piyasa-cikanlar');
  const picked = pickCikanlarFormFields(
    { firma: 'HP13', malzeme: 'Elle yazılan expanded perlite\n2. satır' },
    { malzeme: 'Excel eski' },
    { malzeme: 'Elle yazılan expanded perlite\n2. satır' },
    { firma: 'HP13', malzeme: 'HAM PERLİT EXCEL SATIRI' }
  );
  assert.equal(picked.firma, 'HP13');
  assert.equal(picked.malzeme, 'Elle yazılan expanded perlite\n2. satır');
});

test('pickCikanlarFormFields uses Excel malzeme only if form empty', () => {
  const { pickCikanlarFormFields } = require('../lib/piyasa-cikanlar');
  const picked = pickCikanlarFormFields({}, {}, {}, { malzeme: 'HAM PERLİT' });
  assert.equal(picked.malzeme, 'HAM PERLİT');
});

test('normalizeCikanlarInsert keeps long printed malzeme', () => {
  const printed = 'HP13 ELLE ' + 'PERLIT '.repeat(30);
  const row = normalizeCikanlarInsert({
    plaka: '43 ABC 123',
    firma: 'HP13',
    malzeme: printed,
  }, (s, n) => String(s).slice(0, n));
  assert.equal(row.malzeme, printed);
  assert.ok(row.malzeme.length > 120);
});

test('normalizeCikanlarInsert stores print-date week not Excel week', () => {
  const row = normalizeCikanlarInsert({
    plaka: '06 FAY 148',
    firma: 'HP8',
    hafta: '34',
    tarih: Date.parse('2026-08-24T00:31:31+03:00'),
  }, (s, n) => String(s).slice(0, n));
  assert.equal(row.error, undefined);
  assert.equal(row.hafta, '35');
});

test('normalizeCikanlarInsert keeps selected kantar signature name', () => {
  const row = normalizeCikanlarInsert({
    plaka: '43 ABC 123',
    firma: 'HP7',
    kantar: 'Burak Karataş',
  }, (s, n) => String(s).slice(0, n));
  assert.equal(row.kantarci, 'Burak Karataş');
  const row2 = normalizeCikanlarInsert({
    plaka: '43 ABC 123',
    firma: 'HP7',
    imzaKantarAd: 'Ergin Gördü',
  }, (s, n) => String(s).slice(0, n));
  assert.equal(row2.kantarci, 'Ergin Gördü');
});
