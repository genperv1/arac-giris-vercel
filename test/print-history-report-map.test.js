'use strict';

const test = require('node:test');
const assert = require('node:assert');
const {
  parseReportsListQuery,
  mapPrintHistoryRowToReport,
} = require('../lib/print-history-report-map');

test('slim=1 ve since/until sorgu parametreleri okunur', () => {
  const q = parseReportsListQuery({ slim: '1', since: '1700000000000', until: '1700086400000', id: 'ph-9' });
  assert.equal(q.slim, true);
  assert.equal(q.since, 1700000000000);
  assert.equal(q.until, 1700086400000);
  assert.equal(q.id, 'ph-9');
});

test('slim rapor tam snapshot taşımaz, açıklama ve YD alanlarını bırakır', () => {
  const row = {
    id: 'ph-1',
    plaka: '34 ABC 123',
    firma: 'YD20',
    malzeme: 'HP 0,15-0,30',
    tarih: 1700000000000,
    snapshot: JSON.stringify({
      yuklemeNotu: 'SEVKİYATLARDA DİKKAT EDİLECEK HUSUSLAR',
      headerText: 'YD20 / HP 0,15-0,30 / EVYAP',
      sevkYeri: 'EVYAP',
      bbt: '21',
      hugeExcelGrid: new Array(500).fill('x').join(''),
      firmaAdi: 'EVYAP',
    }),
  };
  const slim = mapPrintHistoryRowToReport(row, { slim: true });
  assert.equal(slim.snapshot, null);
  assert.equal(slim.data.firmaAdi, 'EVYAP');
  assert.equal(slim.data.yuklemeNotu, 'SEVKİYATLARDA DİKKAT EDİLECEK HUSUSLAR');
  assert.equal(slim.data.headerText, 'YD20 / HP 0,15-0,30 / EVYAP');
  assert.equal(slim.data.sevkYeri, 'EVYAP');
  assert.equal(slim.data.bbt, '21');
  assert.equal(slim.data.hugeExcelGrid, undefined);
  assert.equal(slim.firma, 'YD20');

  const full = mapPrintHistoryRowToReport(row, { slim: false });
  assert.ok(full.snapshot);
  assert.equal(full.snapshot.yuklemeNotu, 'SEVKİYATLARDA DİKKAT EDİLECEK HUSUSLAR');
});

test('slim liste snapshot olmadan kolonlardan dolar', () => {
  const { printHistoryListColumns } = require('../lib/print-history-report-map');
  assert.equal(printHistoryListColumns(true).includes('snapshot'), false);
  assert.equal(printHistoryListColumns(false).includes('snapshot'), true);

  const slim = mapPrintHistoryRowToReport({
    id: 'ph-col',
    plaka: '43 ABC 01',
    firma: 'YD20',
    malzeme: 'HP',
    sofor: 'Ali Veli',
    sevk_yeri: 'EVYAP',
    basim_yeri: 'AVDAN',
    sevkiyat_id: 'ihracat:1',
    tarih: 1700000000000,
  }, { slim: true });
  assert.equal(slim.snapshot, null);
  assert.equal(slim.data.plaka, '43 ABC 01');
  assert.equal(slim.data.firma, 'YD20');
  assert.equal(slim.data.sevkYeri, 'EVYAP');
  assert.equal(slim.data.sevkiyat_id, 'ihracat:1');
  assert.equal(slim.data.hugeExcelGrid, undefined);
});
