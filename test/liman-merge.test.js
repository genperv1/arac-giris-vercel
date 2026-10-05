'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { mergeLimanState } = require('../lib/liman-merge');
const { daysFromSheetState, rowsToBlocks, retainDroppedBooks } = require('../lib/liman-sheet');

function row(patch) {
  return Object.assign({
    irsaliyeNo: 'R01 1',
    sira: '1',
    plaka: '',
    bbt: '26',
    gidenTonaj: '',
    yuklemeYeri: 'AVDAN',
    ydKey: 'YD20',
    headerText: 'YD20(M) / LOT NO 26 08 26 / 500 TON / DP WORLD',
    fileName: '29.09.2026.xlsx',
  }, patch);
}

test('aynı irsaliyede dolu plaka boş olanın yerine geçer', () => {
  const merged = mergeLimanState({
    sites: {
      AVDAN: { fileName: '29.09.2026.xlsx', rows: [row({ plaka: '03 DH 540', gidenTonaj: '32800' })] },
      '1.OSB': { fileName: '29.09.2026.xlsx', rows: [row({ plaka: '', gidenTonaj: '', yuklemeYeri: '1.OSB' })] },
    },
    notes: {},
  });
  assert.equal(merged.days.length, 1);
  assert.equal(merged.days[0].blocks.length, 1);
  assert.equal(merged.days[0].blocks[0].rows.length, 1);
  assert.equal(merged.days[0].blocks[0].rows[0].plaka, '03 DH 540');
  assert.equal(merged.days[0].blocks[0].rows[0].gidenTonaj, '32800');
  assert.equal(merged.days[0].blocks[0].port, 'DP WORLD');
});

test('aynı irsaliyeye iki farklı plaka yazıldıysa ikisi de kalır', () => {
  const merged = mergeLimanState({
    sites: {
      AVDAN: { rows: [row({ plaka: '03 DH 540' })] },
      '1.OSB': { rows: [row({ plaka: '43 ADS 315', yuklemeYeri: '1.OSB' })] },
    },
    notes: {},
  });
  const plates = merged.days[0].blocks[0].rows.map((r) => r.plaka).sort();
  assert.deepEqual(plates, ['03 DH 540', '43 ADS 315']);
});

test('farklı lot ve farklı gün ayrı blok olur', () => {
  const merged = mergeLimanState({
    sites: {
      AVDAN: {
        rows: [
          row({ irsaliyeNo: 'R1', headerText: 'YD20 / LOT NO 26 08 26 / DP WORLD', fileName: '29.09.2026.xlsx', plaka: '03 DH 540' }),
          row({ irsaliyeNo: 'R2', headerText: 'YD20 / LOT NO 26 09 21 / EVYAP', fileName: '29.09.2026.xlsx', plaka: '03 BN 929' }),
        ],
      },
      '1.OSB': {
        rows: [
          row({ irsaliyeNo: 'R9', headerText: 'YD20 / LOT NO 26 08 26 / DP WORLD', fileName: '28.09.2026.xlsx', plaka: '43 ADT 553', yuklemeYeri: '1.OSB' }),
        ],
      },
    },
    notes: { R1: 'iptal' },
  });
  assert.equal(merged.days.length, 2);
  const day29 = merged.days.find((d) => d.label === '29.09.2026');
  assert.equal(day29.blocks.length, 2);
  const withNote = day29.blocks.flatMap((b) => b.rows).find((r) => r.irsaliyeNo === 'R1');
  assert.equal(withNote.note, 'iptal');
  const day28 = merged.days.find((d) => d.label === '28.09.2026');
  assert.equal(day28.blocks.length, 1);
  assert.equal(day28.blocks[0].port, 'DP WORLD');
});

test('aynı günün Avdan ve 1.OSB sayfaları tek Excel olur', () => {
  const days = daysFromSheetState({
    sites: {
      AVDAN: {
        fileName: '03.10.2026.xlsx',
        blocks: [{
          title: 'YD47(M) / LOT NO 26 08 32 / SAFİPORT',
          liman: 'SAFİPORT',
          rows: [{ sira: '1', plaka: '', bbt: '20', yukleme: 'AVDAN' }],
        }],
      },
      '1.OSB': {
        fileName: '03.10.2026.xlsx',
        blocks: [{
          title: 'YD15(M) / LOT NO 26 07 30 / SAFİPORT',
          liman: 'SAFİPORT',
          rows: [
            { sira: '1', plaka: '43RY761', yukleme: '1.OSB' },
            { sira: '9', plaka: '', yukleme: '1.OSB' },
          ],
        }],
      },
    },
    notes: {},
  });
  assert.equal(days.length, 1);
  assert.equal(days[0].label, '03.10.2026');
  assert.equal(days[0].blocks.length, 2);
  assert.equal(days[0].blocks[0].port, 'SAFİPORT');
  assert.equal(days[0].blocks[1].rows[0].plaka, '43RY761');
  assert.equal(days[0].blocks[1].rows[1].plaka, '');
});

test('aynı blok iki kantarda doluysa sıra bazında birleşir', () => {
  const title = 'YD20(M) / LOT NO 26 08 26 / 500 TON / DP WORLD';
  const days = daysFromSheetState({
    sites: {
      AVDAN: { fileName: '03.10.2026.xlsx', blocks: [{ title, rows: [{ sira: '1', plaka: '' }, { sira: '2', plaka: '03DH540', sofor: 'ALİ' }] }] },
      '1.OSB': { fileName: '03.10.2026.xlsx', blocks: [{ title, rows: [{ sira: '1', plaka: '43ADT553' }, { sira: '2', plaka: '' }] }] },
    },
    notes: {},
  });
  assert.equal(days[0].blocks.length, 1);
  assert.equal(days[0].blocks[0].port, 'DP WORLD');
  assert.deepEqual(days[0].blocks[0].rows.map((r) => r.plaka), ['43ADT553', '03DH540']);
  assert.equal(days[0].blocks[0].rows[1].sofor, 'ALİ');
});

test('aynı tarihli ikinci Excel blokları dosya adıyla işaretlenir (alt sekme)', () => {
  const days = daysFromSheetState({
    sites: {
      AVDAN: {
        fileName: '03.10.2026.xlsx + 03.10.2026-YD28.xlsx',
        blocks: [
          { title: 'YD02(M) / LOT NO 26 08 10 / EVYAP', fileName: '03.10.2026.xlsx', rows: [{ sira: '1', plaka: '43AFV215' }] },
          { title: 'YD28(M) / LOT NO 26 08 40 / YILPORT', fileName: '03.10.2026-YD28.xlsx', rows: [{ sira: '1', plaka: '03ADK440' }] },
        ],
      },
      '1.OSB': {
        fileName: '03.10.2026.xlsx',
        blocks: [{ title: 'YD02(M) / LOT NO 26 08 10 / EVYAP', rows: [{ sira: '2', plaka: '43ACN771' }] }],
      },
    },
    notes: {},
  });
  assert.equal(days.length, 1);
  assert.deepEqual(days[0].blocks.map((b) => b.files), [['03.10.2026'], ['03.10.2026-YD28']]);
});

test('silinen Excel kitabı durur; gelen dosya güncellenir, yeni kitap eklenir', () => {
  const prev = [
    { title: 'YD02 / LOT NO 1 / EVYAP', fileName: '03.10.2026.xlsx', rows: [{ sira: '1', plaka: '43RY761', giden: '1000' }] },
    { title: 'YD28 / LOT NO 2 / EVYAP', fileName: '03.10.2026-YD28.xlsx', rows: [{ sira: '1', plaka: '03ADK440', giden: '2000' }] },
  ];
  const updated = retainDroppedBooks(
    prev,
    [{ title: 'YD28 / LOT NO 2 / EVYAP', fileName: '03.10.2026-YD28.xlsx', rows: [{ sira: '1', plaka: '03ADK440', giden: '26000' }] }],
    '03.10.2026.xlsx + 03.10.2026-YD28.xlsx',
    '03.10.2026-YD28.xlsx'
  );
  assert.equal(updated.length, 2);
  assert.equal(updated[0].fileName, '03.10.2026.xlsx');
  assert.equal(updated[0].rows[0].giden, '1000');
  assert.equal(updated[1].rows[0].giden, '26000');

  const withNew = retainDroppedBooks(
    updated,
    [{ title: 'YD05 / LOT NO 3 / SAFİPORT', fileName: '05.10.2026.xlsx', rows: [{ sira: '1', plaka: '43AAA01', giden: '500' }] }],
    '03.10.2026-YD28.xlsx',
    '05.10.2026.xlsx'
  );
  assert.deepEqual(withNew.map((b) => b.fileName), ['03.10.2026.xlsx', '03.10.2026-YD28.xlsx', '05.10.2026.xlsx']);

  const wiped = retainDroppedBooks(withNew, [], '05.10.2026.xlsx', '');
  assert.equal(wiped.length, 3);
});

test('eski satır kaydı Excel bloğuna çevrilir', () => {
  const blocks = rowsToBlocks([
    { headerText: 'YD15 / LOT NO 26 07 30 / SAFİPORT', sira: '1', plaka: '43RY761', fileName: '03.10.2026.xlsx' },
  ]);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].liman, 'SAFİPORT');
  assert.equal(blocks[0].rows[0].plaka, '43RY761');
});
