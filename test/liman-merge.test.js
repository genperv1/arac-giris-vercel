'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { mergeLimanState } = require('../lib/liman-merge');
const { daysFromSheetState, rowsToBlocks, retainDroppedBooks, mergeRows, mergeTransientDurum, sanitizeBlocks } = require('../lib/liman-sheet');

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

test('son Güncelle eski yüksek tonajı ezer', () => {
  const title = 'YD47(M) / LOT NO 26 08 32 / 100 TON / SAFİPORT';
  const rowOld = { sira: '1', plaka: '43AEA633', bbt: '10', net: '20000', giden: '20240', sofor: 'RAMAZAN HORATA' };
  const rowNew = { sira: '1', plaka: '43AEA633', bbt: '10', net: '10000', giden: '10100', sofor: 'RAMAZAN HORATA' };
  const days = daysFromSheetState({
    sites: {
      AVDAN: {
        fileName: '06.10.2026.xlsx',
        updatedAt: '2026-10-06T08:00:00.000Z',
        blocks: [{ title, toplam: { netTonaj: '20000', gidenTonaj: '20240' }, rows: [rowOld] }],
      },
      '1.OSB': {
        fileName: '06.10.2026.xlsx',
        updatedAt: '2026-10-06T09:05:00.000Z',
        blocks: [{ title, toplam: { netTonaj: '10000', gidenTonaj: '10100' }, rows: [rowNew] }],
      },
    },
    notes: {},
  });
  const row = days[0].blocks[0].rows[0];
  assert.equal(row.net, '10000');
  assert.equal(row.giden, '10100');
  assert.equal(row.netTonaj, '10000');
  assert.equal(row.gidenTonaj, '10100');
  assert.equal(days[0].blocks[0].toplam.netTonaj, '10000');
  assert.equal(days[0].blocks[0].toplam.gidenTonaj, '10100');
  assert.equal(row.updatedAt, undefined);
});

test('sıra nosuz kopya aynı plakanın tonunu ikiye katlamaz', () => {
  const title = 'YD20(M) / LOT NO 26 08 26 / 10 TON / DP WORLD';
  const days = daysFromSheetState({
    sites: {
      AVDAN: { fileName: '06.10.2026.xlsx', blocks: [{ title, rows: [{ sira: '1', plaka: '43AAA01', net: '10000', bbt: '10' }] }] },
      '1.OSB': { fileName: '06.10.2026.xlsx', blocks: [{ title, rows: [{ sira: '', plaka: '43AAA01', net: '10000', bbt: '10' }] }] },
    },
    notes: {},
  });
  assert.equal(days[0].blocks[0].rows.length, 1);
  assert.equal(days[0].blocks[0].rows[0].net, '10000');
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

test('mergeTransientDurum — DIŞARIDA eski İÇERİDE yener; boş birincil stale içeri getirmez', () => {
  assert.equal(mergeTransientDurum('İÇERİDE', 'DIŞARIDA'), 'DIŞARIDA');
  assert.equal(mergeTransientDurum('', 'İÇERİDE'), '');
  assert.equal(mergeTransientDurum('DIŞARIDA', ''), 'DIŞARIDA');
});

test('mergeRows — bir kantar DIŞARIDA diğeri stale İÇERİDE ise DIŞARIDA kalır', () => {
  const title = 'YD20(M) / LOT NO 26 08 26 / DP WORLD';
  const merged = mergeRows([
    { sira: '2', plaka: '03DH540', durum: 'İÇERİDE', sofor: 'A' },
    { sira: '2', plaka: '03DH540', durum: 'DIŞARIDA' },
  ]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].durum, 'DIŞARIDA');
});

test('kantar çıkış tarihi iki kantarda kalır; daha yeni saat eskisinin yerini alır', () => {
  const title = 'YD10(G) / LOT NO 26 04 13 / SAFİPORT';
  const blocks = sanitizeBlocks([{
    title,
    dolum: '05.10.2026 PAZARTESİ',
    rows: [{ sira: '1', plaka: '43AD5408', bbt: '20', ogr: '25.3', fark: '-120', kantarGiris: '05.10.2026 04:43', kantarCikis: '05.10.2026 05:10' }],
  }]);
  assert.equal(blocks[0].rows[0].kantarCikis, '05.10.2026 05:10');
  assert.equal(blocks[0].rows[0].kantarGiris, '05.10.2026 04:43');
  assert.equal(blocks[0].rows[0].ogr, '25.3');
  assert.equal(blocks[0].rows[0].fark, '-120');
  assert.equal(blocks[0].dolum, '05.10.2026 PAZARTESİ');
  assert.equal(blocks[0].rows[0].bbt, '20');
  const days = daysFromSheetState({
    sites: {
      AVDAN: {
        fileName: '05.10.2026.xlsx',
        updatedAt: '2026-10-05T10:00:00.000Z',
        blocks: [{ title, rows: [{ sira: '1', plaka: '43AD5408', kantarCikis: '05.10.2026 05:10', bbt: '20' }] }],
      },
      '1.OSB': {
        fileName: '05.10.2026.xlsx',
        updatedAt: '2026-10-05T11:00:00.000Z',
        blocks: [{ title, rows: [{ sira: '1', plaka: '43AD5408', kantarCikis: '05.10.2026 06:40', bbt: '20' }] }],
      },
    },
    notes: {},
  });
  assert.equal(days[0].blocks[0].rows[0].kantarCikis, '05.10.2026 06:40');
  const kept = daysFromSheetState({
    sites: {
      AVDAN: {
        fileName: '05.10.2026.xlsx',
        updatedAt: '2026-10-05T10:00:00.000Z',
        blocks: [{ title, rows: [{ sira: '1', plaka: '43AD5408', kantarCikis: '05.10.2026 05:10' }] }],
      },
      '1.OSB': {
        fileName: '05.10.2026.xlsx',
        updatedAt: '2026-10-05T12:00:00.000Z',
        blocks: [{ title, rows: [{ sira: '1', plaka: '43AD5408', kantarCikis: '' }] }],
      },
    },
    notes: {},
  });
  assert.equal(kept[0].blocks[0].rows[0].kantarCikis, '05.10.2026 05:10');
});

test('eski satır kaydı Excel bloğuna çevrilir', () => {
  const blocks = rowsToBlocks([
    { headerText: 'YD15 / LOT NO 26 07 30 / SAFİPORT', sira: '1', plaka: '43RY761', fileName: '03.10.2026.xlsx' },
  ]);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].liman, 'SAFİPORT');
  assert.equal(blocks[0].rows[0].plaka, '43RY761');
});
