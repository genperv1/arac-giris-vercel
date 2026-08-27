'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const excelCode = fs.readFileSync(
  path.join(__dirname, '../public/modules/app-excel-ihracat.js'),
  'utf8'
);
const start = excelCode.indexOf('function _ihracatPickNonEmpty');
const end = excelCode.indexOf('function _fillTakipGapsFromEslestirme');
assert.ok(start >= 0 && end > start, 'pick helpers not found');
const wrapped = `(function(){\n${excelCode.slice(start, end)}\nreturn { ihracatPickFieldsFromReportData, mergeIhracatPickReportItem, ihracatChosenFromPickItem };})()`;
const {
  ihracatPickFieldsFromReportData,
  mergeIhracatPickReportItem,
  ihracatChosenFromPickItem,
} = eval(wrapped);

test('eski yazdırma raporundan sevk yeri / ambalaj okunur', () => {
  const fields = ihracatPickFieldsFromReportData({
    sevkYeri: 'EVYAP',
    ambalajBilgisi: 'NET 1150 KG BASKILI LINERLI',
    seperatorBilgisi: 'VAR',
    yuklemeNotu: 'LOT NO 26 07 14',
  });
  assert.equal(fields.sevkYeri, 'EVYAP');
  assert.equal(fields.ambalaj, 'NET 1150 KG BASKILI LINERLI');
  assert.equal(fields.seperatorBilgisi, 'VAR');
  assert.equal(fields.yuklemeNotu, 'LOT NO 26 07 14');
});

test('Seç: bugün yazdırıldı kaydı sevk yerini forma taşır', () => {
  const chosen = ihracatChosenFromPickItem({
    ydKey: 'YD20',
    malzeme: 'HP 0,15-0,30',
    lotLabel: '',
    headerText: 'YD20 / HP 0,15-0,30',
    _fromReport: true,
    _reportData: {
      firma: 'YD20',
      malzeme: 'HP 0,15-0,30',
      sevkYeri: 'GEMPORT',
      ambalajBilgisi: 'NET 1250 KG BASKISIZ',
    },
  });
  assert.ok(chosen);
  assert.equal(chosen.firma, 'YD20');
  assert.equal(chosen.sevkYeri, 'GEMPORT');
  assert.equal(chosen.ambalaj, 'NET 1250 KG BASKISIZ');
  assert.equal(chosen.bbt, '');
});

test('Seç: yükleme yeri (Avdan) sevk yeri yerine yazılmaz', () => {
  const chosen = ihracatChosenFromPickItem({
    ydKey: 'YD92',
    headerText: 'YD92 / HP 0,074-0,30 / EVYAP',
    malzemeLabel: 'HP 0,074-0,30',
    yuklemeYeri: 'AVDAN',
    port: 'EVYAP',
  });
  assert.equal(chosen.sevkYeri, 'EVYAP');
  assert.notEqual(chosen.sevkYeri, 'AVDAN');
});

test('eksik sevk yeri sonraki rapordan tamamlanır', () => {
  const first = {
    ydKey: 'YD20',
    sevkYeri: '',
    ambalaj: '',
    malzeme: 'HP 0,15-0,30',
  };
  const merged = mergeIhracatPickReportItem(first, {
    sevkYeri: 'MARPORT',
    ambalaj: 'NET 1150 KG',
    malzeme: 'HP 0,15-0,30',
  });
  assert.equal(merged.sevkYeri, 'MARPORT');
  assert.equal(merged.ambalaj, 'NET 1150 KG');
  assert.equal(merged.malzeme, 'HP 0,15-0,30');
});
