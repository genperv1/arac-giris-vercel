'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const code = fs.readFileSync(
  path.join(__dirname, '../public/modules/app-excel-ihracat.js'),
  'utf8'
);
const start = code.indexOf('function _normalizeYuklemeYeri');
const end = code.indexOf('function _formatYuklemeYeriLabel');
const wrapped = `(function(){\n${code.slice(start, end)}\nreturn { _normalizeTasiyiciDisplay, _isOzmalTasiyici, _isKnownNakliyeci, detectTasiyiciColumnIndex, _looksLikeTasiyiciHeader, readRowTasiyici };})()`;
const {
  _normalizeTasiyiciDisplay,
  _isOzmalTasiyici,
  _isKnownNakliyeci,
  detectTasiyiciColumnIndex,
  _looksLikeTasiyiciHeader,
  readRowTasiyici,
} = eval(wrapped);

test('tasiyici display — GPM özmal, AKYÜZ nakliyeci', () => {
  assert.equal(_isOzmalTasiyici('GPM'), true);
  assert.equal(_isOzmalTasiyici('gpm'), true);
  assert.equal(_normalizeTasiyiciDisplay('GPM'), 'GPM');
  assert.equal(_normalizeTasiyiciDisplay('akyüz'), 'AKYÜZ');
  assert.equal(_normalizeTasiyiciDisplay('AKYÜZ'), 'AKYÜZ');
  assert.equal(_normalizeTasiyiciDisplay('AVDAN'), '');
  assert.equal(_normalizeTasiyiciDisplay('43ADK694'), '');
  assert.equal(_normalizeTasiyiciDisplay('İLHAN GÜMÜŞ'), '');
  assert.equal(_normalizeTasiyiciDisplay('SAFİPORT'), '');
  assert.equal(_normalizeTasiyiciDisplay('LİMAN'), '');
  assert.equal(_normalizeTasiyiciDisplay('BOOKING'), '');
  assert.equal(_normalizeTasiyiciDisplay('SEVK.TARİHİ'), '');
});

test('detectTasiyiciColumnIndex — NAKLİYECİ başlığı', () => {
  assert.equal(_looksLikeTasiyiciHeader('NAKLİYECİ'), true);
  assert.equal(_looksLikeTasiyiciHeader('TAŞIYICI'), true);
  assert.equal(_looksLikeTasiyiciHeader('YÜKLEME YERİ'), false);
  const grid = [
    ['SIRANO', 'PLAKA', 'BBT', 'NAKLİYECİ', 'YÜKLEME YERİ'],
    ['1', '43ADK694', '24', 'AKYÜZ', 'AVDAN'],
    ['2', '43ADG403', '20', 'GPM', 'AVDAN'],
  ];
  assert.equal(detectTasiyiciColumnIndex(grid, 0, [0, 1, 2, 4], 4), 3);
});

test('detectTasiyiciColumnIndex — başlıksız M/N sütununda GPM + AKYÜZ', () => {
  const row = new Array(16).fill('');
  row[3] = 'PLAKA';
  row[4] = 'BBT';
  row[15] = 'YÜKLEME YERİ';
  const a = new Array(16).fill('');
  a[3] = '43ADK694';
  a[4] = '24';
  a[13] = 'AKYÜZ';
  a[15] = 'AVDAN';
  const b = new Array(16).fill('');
  b[3] = '43ADG403';
  b[4] = '20';
  b[13] = 'GPM';
  b[15] = 'AVDAN';
  const grid = [row, a, b];
  assert.equal(detectTasiyiciColumnIndex(grid, 0, [3, 4, 15], 15), 13);
});

test('detectTasiyiciColumnIndex — M sütunu başlığı HP malzeme olsa da AKYÜZ/GPM okunur', () => {
  const header = new Array(16).fill('');
  header[2] = 'PLAKA';
  header[3] = 'BBT';
  header[11] = 'FARK';
  header[12] = 'HP0,074-0,30';
  header[14] = 'YÜKLEME YERİ';
  const akyuz = new Array(16).fill('');
  akyuz[2] = '43ADK694';
  akyuz[3] = '24';
  akyuz[12] = 'AKYÜZ';
  akyuz[14] = 'AVDAN';
  const gpm = new Array(16).fill('');
  gpm[2] = '43ADS403';
  gpm[3] = '20';
  gpm[12] = 'GPM';
  gpm[14] = 'AVDAN';
  const grid = [header, akyuz, gpm, Object.assign(new Array(16).fill(''), { 12: 'GPM', 14: 'AVDAN' })];
  assert.equal(detectTasiyiciColumnIndex(grid, 0, [2, 3, 11, 14], 14), 12);
});

test('readRowTasiyici — A sütunu AKYÜZ, şoför adı ORTALA ezilmez', () => {
  assert.equal(_isKnownNakliyeci('AKYÜZ'), true);
  assert.equal(_isKnownNakliyeci('ORTALA'), false);
  const row = new Array(16).fill('');
  row[0] = 'AKYÜZ';
  row[2] = '03ACB648';
  row[3] = '20';
  row[8] = 'ORTALA';
  row[12] = 'ORTALA';
  assert.equal(readRowTasiyici(row, 12, 14), 'AKYÜZ');
});

test('readRowTasiyici — A sütunu AKYÜZ olsa da satırdaki GPM özmal kalır', () => {
  const row = new Array(16).fill('');
  row[0] = 'AKYÜZ';
  row[12] = 'GPM';
  row[14] = 'AVDAN';
  assert.equal(readRowTasiyici(row, 12, 14), 'GPM');
});

test('readRowTasiyici — yalnız şoför adı taşıyıcı sayılmaz', () => {
  const row = new Array(16).fill('');
  row[8] = 'ORTALA';
  row[12] = 'ORTALA';
  assert.equal(readRowTasiyici(row, 12, 14), '');
});
