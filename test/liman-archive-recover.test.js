'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildArchiveFromPrints } = require('../lib/liman-archive-recover');

test('boş arşiv kantar baskısından kurulur, aynı plaka tek satır kalır', () => {
  const rec = buildArchiveFromPrints([
    { ts: 1, snapshot: { plaka: '43 RY 761', ydKey: 'YD28', excelFileName: '03.10.2026-YD28.xlsx', bbt: '1', sevkYeri: 'EVYAP', yuklemeSirasi: '2', tonaj: '25000', sofor: 'ALI', iletisim: '555', tcKimlik: '111' } },
    { ts: 2, snapshot: { plaka: '43RY761', ydKey: 'YD28', excelFileName: '03.10.2026-YD28.xlsx', bbt: '10', cuval: '2', sevkYeri: 'EVYAP', yuklemeSirasi: '2', tonaj: '26000', sofor: 'ALI', iletisim: '555' } },
    { ts: 3, snapshot: { plaka: '43RY761', excelFileName: '', ydKey: '', bbt: '9' } },
    { ts: 4, snapshot: { plaka: '06 ABC 01', ydKey: 'YD15', excelFileName: '03.10.2026.xlsx', lotNo: '26 07 30', sevkYeri: 'SAFİPORT', yuklemeSirasi: '1', basimYeri: 'AVDAN' } },
  ], '2026-10-03', { label: '03.10.2026', at: '2026-10-07T10:15:19.682Z', by: 'xxr', files: ['03.10.2026', '03.10.2026-YD28'] });

  assert.equal(rec.recovered, true);
  assert.equal(rec.closedBy, 'xxr');
  const rows = rec.blocks.reduce((n, block) => n + block.rows.length, 0);
  assert.equal(rows, 2);
  const yd28 = rec.blocks.find((block) => block.fileName === '03.10.2026-YD28');
  assert.ok(yd28);
  assert.equal(yd28.rows[0].plaka, '43RY761');
  assert.equal(yd28.rows[0].bbt, '10');
  assert.equal(yd28.rows[0].giden, '26000');
  assert.equal(yd28.rows[0].tcKimlik, undefined);
  const yd15 = rec.blocks.find((block) => block.yd === 'YD15');
  assert.equal(yd15.fileName, '03.10.2026');
  assert.match(yd15.title, /YD15/);
  assert.match(yd15.title, /SAFİPORT/);
});
