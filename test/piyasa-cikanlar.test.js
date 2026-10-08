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
  assert.equal(isYdFirma('GYD48'), true);
  assert.equal(isYdFirma('GYD57'), true);
  assert.equal(isYdFirma('GYD40(M)'), true);
  assert.equal(isYdFirma('HP7'), false);
  assert.equal(isYdFirma('HP7 / ANKARA'), false);
  assert.equal(isYdFirma('G9SP'), false);
  assert.equal(isYdFirma('G1BGSP'), false);
  assert.equal(isYdFirma('G16BGP'), false);
  assert.equal(isYdFirma(''), false);
});

test('displayFirmaKod keeps the letter-number stem and does not shorten HP or place names', () => {
  const { displayFirmaKod, firmaMatchesQuery } = require('../lib/piyasa-cikanlar');
  const pairs = [
    ['K1BGSP', 'K1'],
    ['G9SP', 'G9'],
    ['CR2S', 'CR2'],
    ['CR2', 'CR2'],
    ['Y44SP', 'Y44'],
    ['Y44', 'Y44'],
    ['CR6S', 'CR6'],
    ['Y2SP', 'Y2'],
    ['G14SP', 'G14'],
    ['MD1S', 'MD1'],
    ['G12SP', 'G12'],
    ['DT1D', 'DT1'],
    ['Y4SP', 'Y4'],
    ['G1BGSP', 'G1'],
    ['G16BGP', 'G16'],
    ['T88D', 'T88'],
    ['HP7', 'HP7'],
    ['HP13', 'HP13'],
    ['HP87', 'HP87'],
    ['HP11', 'HP11'],
    ['HP2 GEBZE', 'HP2 GEBZE'],
    ['HP3 BOZÜYÜK', 'HP3 BOZÜYÜK'],
    ['HP3 SİAS', 'HP3 SİAS'],
    ['İ12', 'İ12'],
    ['İ2D', 'İ2'],
    ['İ110D', 'İ110'],
    ['GYD48', 'GYD48'],
  ];
  for (const [raw, shown] of pairs) {
    assert.equal(displayFirmaKod(raw), shown, raw);
  }
  assert.equal(firmaMatchesQuery('K1BGSP', 'K1'), true);
  assert.equal(firmaMatchesQuery('K1BGSP', 'k1bgsp'), true);
  assert.equal(firmaMatchesQuery('G12SP', 'G1'), false);
  assert.equal(firmaMatchesQuery('HP13', 'HP1'), false);
  assert.equal(firmaMatchesQuery('HP87', 'HP7'), false);
  assert.equal(firmaMatchesQuery('HP2 GEBZE', 'HP2'), true);
  assert.equal(firmaMatchesQuery('HP3 SİAS', 'HP3'), true);
});

test('istanbul day bounds are +03:00', () => {
  const start = istanbulDayStartMs('2026-08-20');
  const end = istanbulDayEndMs('2026-08-20');
  assert.equal(start, Date.parse('2026-08-20T00:00:00+03:00'));
  assert.equal(end, start + 86400000);
  assert.equal(istanbulDayStartMs('bad'), null);
});

test('normalizeCikanlarInsert rejects YD and GYD', () => {
  const row = normalizeCikanlarInsert({ plaka: '43 ABC 123', firma: 'YD33' }, (s, n) => String(s).slice(0, n));
  assert.equal(row.error, 'YD_NOT_ALLOWED');
  const gyd = normalizeCikanlarInsert({ plaka: '43 ABC 123', firma: 'GYD48' }, (s, n) => String(s).slice(0, n));
  assert.equal(gyd.error, 'YD_NOT_ALLOWED');
  const g9 = normalizeCikanlarInsert({ plaka: '43 ABC 123', firma: 'G9SP' }, (s, n) => String(s).slice(0, n));
  assert.equal(g9.error, undefined);
  assert.equal(g9.firma, 'G9SP');
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

test('previous-week pick is labeled without moving the print week', () => {
  const { kaynakHaftaSecildiLabel, resolveHafta } = require('../lib/piyasa-cikanlar');
  const printedAt = Date.parse('2026-08-24T00:31:31+03:00');
  assert.equal(resolveHafta('34', printedAt), 35);
  assert.equal(kaynakHaftaSecildiLabel('34', printedAt), '34. haftadan seçildi');
  assert.equal(kaynakHaftaSecildiLabel('35', printedAt), '');
  assert.equal(kaynakHaftaSecildiLabel('', printedAt), '');
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
  assert.equal(row.plaka, '43ABC123');
  assert.equal(row.firma, 'HP7');
  assert.equal(row.sip_no, 'S-11');
  assert.equal(row.sehir, 'ANKARA');
  assert.equal(row.kaynak_hafta, '');
  assert.ok(row.id);
});

test('normalizeCikanlarInsert keeps Excel source week separate from print week', () => {
  const row = normalizeCikanlarInsert({
    plaka: '43 ABC 123',
    firma: 'HP7',
    tarih: Date.parse('2026-08-24T00:31:31+03:00'),
    kaynakHafta: '34',
    hafta: '34',
  }, (s, n) => String(s).slice(0, n));
  assert.equal(row.hafta, '35');
  assert.equal(row.kaynak_hafta, '34');
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

test('deleteCikanlarForPrintHistory removes linked and backfill mirror rows', async () => {
  const { deleteCikanlarForPrintHistory, cikanlarMirrorIds } = require('../lib/piyasa-cikanlar');
  const calls = [];
  const q = async (sql, params) => {
    calls.push({ sql, params });
    return { rowCount: 2 };
  };
  const n = await deleteCikanlarForPrintHistory(q, ['ph-1', ' ph-1 ', '', 'ph-2']);
  assert.equal(n, 2);
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /DELETE FROM piyasa_cikanlar/);
  assert.deepEqual(calls[0].params[0], ['ph-1', 'ph-2']);
  assert.deepEqual(calls[0].params[1], cikanlarMirrorIds(['ph-1', 'ph-2']));
  assert.deepEqual(calls[0].params[1], ['ph_ph-1', 'ph_ph-2']);
});

test('deleteCikanlarForPrintHistory skips empty ids', async () => {
  const { deleteCikanlarForPrintHistory } = require('../lib/piyasa-cikanlar');
  let called = false;
  const n = await deleteCikanlarForPrintHistory(async () => { called = true; return { rowCount: 1 }; }, ['', '  ']);
  assert.equal(n, 0);
  assert.equal(called, false);
});

test('orphan cikanlar delete keeps rows that never had a report', () => {
  const { DELETE_ORPHAN_CIKANLAR_SQL, CIKANLAR_LINKED_REPORT_SQL, DELETE_BLANK_CIKANLAR_SQL } = require('../lib/piyasa-cikanlar');
  assert.match(DELETE_ORPHAN_CIKANLAR_SQL, /btrim\(c\.print_history_id\)/);
  assert.match(DELETE_ORPHAN_CIKANLAR_SQL, /NOT EXISTS/);
  assert.match(CIKANLAR_LINKED_REPORT_SQL, /print_history ph/);
  assert.match(DELETE_BLANK_CIKANLAR_SQL, /btrim\(firma\)/);
  assert.match(DELETE_BLANK_CIKANLAR_SQL, /btrim\(malzeme\)/);
  assert.match(DELETE_BLANK_CIKANLAR_SQL, /btrim\(tonaj\)/);
});
