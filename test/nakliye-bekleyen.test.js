'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../public/nakliye-bekleyen-core.js');

test('parsePendingNote detects full and partial plaka messages', () => {
  assert.deepEqual(core.parsePendingNote('PLAKA VERİLECEK'), {
    remainingBbt: null,
    text: 'PLAKA VERİLECEK',
  });
  assert.deepEqual(core.parsePendingNote('92BBT PLAKA VERİLECEK'), {
    remainingBbt: 92,
    text: '92BBT PLAKA VERİLECEK',
  });
});

test('isRowDeparted — net tonaj copied into giden column is not departed', () => {
  assert.equal(core.isRowDeparted({ gidenTonaj: '1250', netTonaj: '1250' }), false);
  assert.equal(core.isRowDeparted({ gidenTonaj: '25000', tonajKg: '25100' }), true);
  assert.equal(core.isRowDeparted({ gidenTonaj: '25000' }), true);
  assert.equal(core.isRowDeparted({ gidenTonaj: '' }), false);
  assert.equal(core.isRowDeparted({ gidenTonaj: '0' }), false);
  assert.equal(core.isRowDeparted({ gidenTonaj: '24', bbt: '24' }), false);
  assert.equal(core.isRowDeparted({ gidenTonaj: '24000', bbt: '24' }), false);
  assert.equal(core.isRowDeparted({ gidenTonaj: '24000', tonajKg: '24', bbt: '24' }), false);
});

test('analyzeBlock — no plate, plan from header', () => {
  const item = core.analyzeBlock([
    { blockKey: 'X', blockHeaderRow: 10, headerText: 'YD235 / 20 BBT', ydKey: 'YD235', _ihracatEmptyBlock: true },
  ]);
  assert.ok(item);
  assert.equal(item.planBbt, 20);
  assert.equal(item.remainingBbt, 20);
  assert.equal(item.waitingPlates.length, 0);
});

test('analyzeNakliyePending includeComplete keeps finished Excel block', () => {
  const rows = [
    { blockKey: 'Z', blockHeaderRow: 5, headerText: 'YD265 / 40 BBT', plaka: '03EA682', bbt: '20', gidenTonaj: '20100', tonajKg: '20500' },
    { blockKey: 'Z', blockHeaderRow: 5, headerText: 'YD265 / 40 BBT', plaka: '03EA029', bbt: '20', gidenTonaj: '19800', tonajKg: '20400' },
  ];
  assert.equal(core.analyzeNakliyePending(rows).length, 0);
  const kept = core.analyzeNakliyePending(rows, {}, { includeComplete: true });
  assert.equal(kept.length, 1);
  assert.equal(kept[0].planBbt, 40);
  assert.equal(kept[0].remainingBbt, 0);
  const out = core.applyExtraPrintsToPendingItems(kept, [], {});
  assert.equal(out[0].shipmentDone, true);
  assert.equal(core.hasNakliyeBlockContent(out[0]), true);
});

test('analyzeBlock — departed truck is hidden', () => {
  const item = core.analyzeBlock([
    { blockKey: 'Z', blockHeaderRow: 5, headerText: 'YD265 / 40 BBT', plaka: '03EA682', bbt: '20', gidenTonaj: '20100', tonajKg: '20500' },
    { blockKey: 'Z', blockHeaderRow: 5, headerText: 'YD265 / 40 BBT', plaka: '03EA029', bbt: '20', gidenTonaj: '19800', tonajKg: '20400' },
  ]);
  assert.equal(item, null);
});

test('analyzeIhracatBalance — completed shipment still listed with çıkan = plan', () => {
  const items = core.analyzeIhracatBalance([
    { blockKey: 'Z', blockHeaderRow: 5, headerText: 'YD265 / 40 BBT', plaka: '03EA682', bbt: '20', gidenTonaj: '20100', tonajKg: '20500' },
    { blockKey: 'Z', blockHeaderRow: 5, headerText: 'YD265 / 40 BBT', plaka: '03EA029', bbt: '20', gidenTonaj: '19800', tonajKg: '20400' },
  ]);
  assert.equal(items.length, 1);
  assert.equal(items[0].planBbt, 40);
  assert.equal(items[0].departedBbt, 40);
  assert.equal(items[0].processedBbt, 40);
  assert.equal(items[0].remainingBbt, 0);
});

test('analyzeBlock — processedBbt is departed plus assigned waiting', () => {
  const item = core.analyzeBlock([
    { blockKey: 'BLK_36', blockHeaderRow: 36, headerText: 'YD40(G) / 200 BBT', plaka: '03AIT034', sira: '1', bbt: '26', gidenTonaj: '' },
    { blockKey: 'BLK_36', blockHeaderRow: 36, headerText: 'YD40(G) / 200 BBT', plaka: '03ADB390', sira: '2', bbt: '26', gidenTonaj: '' },
    { blockKey: 'BLK_36', blockHeaderRow: 36, headerText: 'YD40(G) / 200 BBT', plaka: '41BFL699', sira: '3', bbt: '21', gidenTonaj: '' },
    { blockKey: 'BLK_36', blockHeaderRow: 36, headerText: 'YD40(G) / 200 BBT', plaka: '03DH540', sira: '4', bbt: '24', gidenTonaj: '' },
    { blockKey: 'BLK_36', blockHeaderRow: 36, headerText: 'YD40(G) / 200 BBT', plaka: '03BN929', sira: '5', bbt: '24', gidenTonaj: '' },
    { blockKey: 'BLK_36', blockHeaderRow: 36, headerText: 'YD40(G) / 200 BBT', plaka: '03VR929', sira: '6', bbt: '24', gidenTonaj: '' },
    { blockKey: 'BLK_36', blockHeaderRow: 36, headerText: 'YD40(G) / 200 BBT', plaka: '16RCU18', sira: '7', bbt: '28', gidenTonaj: '' },
  ]);
  assert.equal(item.remainingBbt, 27);
  assert.equal(item.processedBbt, 173);
  assert.equal(item.planBbt, 200);
});

test('analyzeBlock — waiting plate without giden tonaj', () => {
  const item = core.analyzeBlock([
    {
      blockKey: 'W',
      blockHeaderRow: 8,
      headerText: 'YD82 / 4 BBT',
      plaka: '64BE703',
      bbt: '4',
      gidenTonaj: '',
    },
  ]);
  assert.ok(item);
  assert.equal(item.waitingPlates.length, 1);
  assert.equal(item.waitingPlates[0].plaka, '64BE703');
  assert.equal(item.remainingBbt, 0);
});

test('analyzeBlock — partial: waiting plate + remaining BBT', () => {
  const item = core.analyzeBlock([
    { blockKey: 'Y', blockHeaderRow: 20, headerText: 'YD03 / 120 BBT', plaka: '03VY230', bbt: '28', gidenTonaj: '' },
    {
      blockKey: 'Y',
      blockPendingPlakaNotes: [{ text: '92BBT PLAKA VERİLECEK', remainingBbt: 92 }],
    },
  ]);
  assert.ok(item);
  assert.equal(item.remainingBbt, 92);
  assert.equal(item.waitingPlates.length, 1);
});

test('buildExcelBlockRows — plaka yanında gelmeyen araç', () => {
  const item = core.analyzeBlock([
    {
      blockKey: 'Y',
      headerText: 'YD03 / 120 BBT / HP 1,20-2,40',
      plaka: '03VY230',
      bbt: '28',
      gidenTonaj: '',
    },
    { blockKey: 'Y', blockPendingPlakaNotes: [{ text: '92BBT PLAKA VERİLECEK', remainingBbt: 92 }] },
  ]);
  const rows = core.buildExcelBlockRows(item);
  assert.equal(rows[0].a, 'YD03 120 BBT (HP 1,20-2,40)');
  assert.equal(rows[1].a, '03VY230');
  assert.equal(rows[1].b, 'GELMEYEN ARAÇ');
  assert.equal(rows[1].c, '28 BBT');
  assert.equal(rows[1].kind, 'plate');
  assert.equal(rows[2].a, '92 BBT DAHA PLAKA VERİLECEK');
  assert.equal(rows[2].kind, 'pending');
  assert.equal(rows.length, 3);
  const sheetRows = core.buildExcelSheetRows([item]);
  assert.equal(sheetRows[sheetRows.length - 1].a, '92 BBT DAHA PLAKA VERİLECEK');
  assert.equal(sheetRows[sheetRows.length - 1].kind, 'pending');
});

test('buildExcelSheetRows — each block shows its own remaining BBT', () => {
  const rows = core.buildExcelSheetRows([
    core.analyzeBlock([
      {
        blockKey: 'Y',
        headerText: 'YD03 / 120 BBT',
        plaka: '03VY230',
        bbt: '28',
        gidenTonaj: '',
      },
      { blockKey: 'Y', blockPendingPlakaNotes: [{ text: '92BBT PLAKA VERİLECEK', remainingBbt: 92 }] },
    ]),
    core.analyzeBlock([
      {
        blockKey: 'Z',
        headerText: 'YD05 / 88 BBT',
        _ihracatEmptyBlock: true,
      },
    ]),
  ]);
  const pending = rows.filter((r) => r.kind === 'pending');
  assert.deepEqual(pending.map((r) => r.a), ['92 BBT DAHA PLAKA VERİLECEK', '88 BBT DAHA PLAKA VERİLECEK']);
});

test('buildExcelBlockRows — gelmeyen plakalar + hesaplanan kalan BBT', () => {
  const item = core.analyzeBlock([
    {
      blockKey: 'Y',
      headerText: 'YD05 / 800 BBT / HP 0,074-0,30',
      plaka: '43VE530',
      bbt: '22',
      gidenTonaj: '',
    },
    {
      blockKey: 'Y',
      headerText: 'YD05 / 800 BBT / HP 0,074-0,30',
      plaka: '06ABC123',
      bbt: '26',
      gidenTonaj: '',
    },
  ]);
  assert.equal(item.remainingBbt, 752);
  const rows = core.buildExcelBlockRows(item);
  assert.equal(rows[rows.length - 1].a, '752 BBT DAHA PLAKA VERİLECEK');
  assert.equal(rows[rows.length - 1].kind, 'pending');
});

test('buildExcelSheetRows — plate numbers use Excel sira', () => {
  const rows = core.buildExcelSheetRows([
    core.analyzeBlock([
      {
        blockKey: 'Y',
        headerText: 'YD03 / 32 BBT',
        plaka: '03VY230',
        sira: '12',
        bbt: '28',
        gidenTonaj: '',
      },
    ]),
    core.analyzeBlock([
      {
        blockKey: 'Z',
        headerText: 'YD05 / 4 BBT',
        plaka: '06ABC123',
        sira: '18',
        bbt: '4',
        gidenTonaj: '',
      },
    ]),
  ]);
  const plates = rows.filter((r) => r.kind === 'plate');
  assert.equal(plates.length, 2);
  assert.equal(plates[0].no, 12);
  assert.equal(plates[1].no, 18);
  assert.ok(!rows.some((r) => r.kind === 'waiting-total'));
});

test('printReportValidForMeta accepts same-day print after excel re-import', () => {
  const meta = {
    importedAt: '2026-07-15T14:00:00.000Z',
    dateKey: '2026-07-15',
  };
  const morningPrint = new Date('2026-07-15T07:00:00.000Z').getTime();
  assert.equal(core.printReportValidForMeta(morningPrint, meta), true);
});

test('applyLiveDepartedMarks — print report marks row departed', () => {
  const meta = { importedAt: '2026-07-15T08:00:00.000Z' };
  const rows = [
    {
      blockKey: 'B1',
      headerText: 'YD82 / 4 BBT',
      ydKey: 'YD82',
      plaka: '64BE703',
      bbt: '4',
      gidenTonaj: '',
    },
  ];
  const reports = [
    {
      type: 'PRINT',
      ts: new Date('2026-07-15T10:00:00.000Z').getTime(),
      data: { plaka: '64BE703', firma: 'YD82' },
    },
  ];
  const out = core.applyLiveDepartedMarks(rows, meta, reports);
  assert.ok(core.isRowDeparted(out[0]));
  assert.equal(core.analyzeBlock(out), null);
});

test('applyLiveDepartedMarks — çift kantar consumes one row at a time', () => {
  const meta = { importedAt: '2026-07-15T08:00:00.000Z' };
  const rows = [
    { blockKey: 'B1', headerText: 'YD82 / 4 BBT', ydKey: 'YD82', plaka: '64BE703', bbt: '4', gidenTonaj: '' },
    { blockKey: 'B2', headerText: 'YD82 / 16 BBT', ydKey: 'YD82', plaka: '64BE703', bbt: '16', gidenTonaj: '' },
  ];
  const reports = [
    {
      type: 'PRINT',
      ts: new Date('2026-07-15T10:00:00.000Z').getTime(),
      data: { plaka: '64BE703', firma: 'YD82' },
    },
  ];
  const out = core.applyLiveDepartedMarks(rows, meta, reports);
  assert.ok(core.isRowDeparted(out[0]));
  assert.equal(core.isRowDeparted(out[1]), false);
  const pending = core.analyzeNakliyePending(out);
  assert.equal(pending.length, 1);
  assert.equal(pending[0].planBbt, 16);
});

test('applyLiveDepartedMarks — other YD print does not hide gelmeyen plate', () => {
  const meta = { importedAt: '2026-08-18T08:00:00.000Z' };
  const rows = [
    {
      blockKey: 'YD40',
      headerText: 'YD40(G) / 200 BBT',
      ydKey: 'YD40',
      plaka: '03DH540',
      bbt: '24',
      gidenTonaj: '',
    },
  ];
  const reports = [
    {
      type: 'PRINT',
      ts: new Date('2026-08-18T10:00:00.000Z').getTime(),
      data: { plaka: '03DH540', firma: 'YD173(G) / LOT NO 26 07 41' },
    },
  ];
  const out = core.applyLiveDepartedMarks(rows, meta, reports);
  assert.equal(core.isRowDeparted(out[0]), false);
  const pending = core.analyzeNakliyePending(out);
  assert.equal(pending.length, 1);
  assert.equal(pending[0].waitingPlates[0].plaka, '03DH540');
});

test('applyLiveDepartedMarks — print without YD does not hide ihracat gelmeyen', () => {
  const meta = { importedAt: '2026-08-18T08:00:00.000Z' };
  const rows = [
    {
      blockKey: 'YD385',
      headerText: 'YD385(M) / 120 BBT',
      ydKey: 'YD385',
      plaka: '43SE883',
      bbt: '22',
      gidenTonaj: '',
    },
  ];
  const reports = [
    {
      type: 'PRINT',
      ts: new Date('2026-08-18T10:00:00.000Z').getTime(),
      data: { plaka: '43SE883' },
    },
  ];
  const out = core.applyLiveDepartedMarks(rows, meta, reports);
  assert.equal(core.isRowDeparted(out[0]), false);
});

test('clearLiveDepartedMark restores Excel GELMEDİ plate that was print-marked', () => {
  const cleaned = core.clearLiveDepartedMark({
    blockKey: 'YD385',
    headerText: 'YD385(M) / 120 BBT',
    plaka: '43SE883',
    bbt: '22',
    gidenTonaj: '22',
    _nbLiveDeparted: true,
  });
  assert.equal(core.isRowDeparted(cleaned), false);
  assert.equal(cleaned.gidenTonaj, '');
  const pending = core.analyzeNakliyePending([
    {
      blockKey: 'YD385',
      blockHeaderRow: 10,
      headerText: 'YD385(M) / 120 BBT',
      plaka: '43ADB640',
      bbt: '22',
      gidenTonaj: '27740',
    },
    Object.assign({ blockHeaderRow: 10 }, cleaned),
  ]);
  assert.equal(pending[0].waitingPlates.map((p) => p.plaka).join(','), '43SE883');
});

test('applyLiveDepartedMarks — same YD print still hides plate', () => {
  const meta = { importedAt: '2026-08-18T08:00:00.000Z' };
  const rows = [
    {
      blockKey: 'YD40',
      headerText: 'YD40(G) / 200 BBT',
      ydKey: 'YD40',
      plaka: '03DH540',
      bbt: '24',
      gidenTonaj: '',
    },
  ];
  const reports = [
    {
      type: 'PRINT',
      ts: new Date('2026-08-18T10:00:00.000Z').getTime(),
      data: { plaka: '03DH540', firmaKodu: 'YD40(G) / LOT NO 26 08 08' },
    },
  ];
  const out = core.applyLiveDepartedMarks(rows, meta, reports);
  assert.ok(core.isRowDeparted(out[0]));
});

test('applyLiveDepartedMarks — strips persisted live mark then re-applies by YD', () => {
  const meta = { importedAt: '2026-08-18T08:00:00.000Z' };
  const rows = [
    {
      blockKey: 'YD385',
      headerText: 'YD385(M) / 120 BBT',
      ydKey: 'YD385',
      plaka: '43SE883',
      bbt: '22',
      gidenTonaj: '22',
      _nbLiveDeparted: true,
    },
  ];
  const reports = [
    {
      type: 'PRINT',
      ts: new Date('2026-08-18T10:00:00.000Z').getTime(),
      data: { plaka: '43SE883', firma: 'YD173' },
    },
  ];
  const out = core.applyLiveDepartedMarks(rows, meta, reports);
  assert.equal(core.isRowDeparted(out[0]), false);
  assert.equal(out[0]._nbLiveDeparted, undefined);
});

test('analyzeNakliyePending — YD385 gelmeyen plates stay visible when remaining is 0', () => {
  const pending = core.analyzeNakliyePending([
    {
      blockKey: 'BLK_10',
      blockHeaderRow: 10,
      headerText: 'YD385(M) / LOT NO 26 07 24 / 120 BBT',
      ydKey: 'YD385',
      plaka: '43ADB640',
      bbt: '22',
      gidenTonaj: '27740',
    },
    {
      blockKey: 'BLK_10',
      blockHeaderRow: 10,
      headerText: 'YD385(M) / LOT NO 26 07 24 / 120 BBT',
      ydKey: 'YD385',
      plaka: '43SE883',
      bbt: '22',
      gidenTonaj: '',
    },
    {
      blockKey: 'BLK_10',
      blockHeaderRow: 10,
      headerText: 'YD385(M) / LOT NO 26 07 24 / 120 BBT',
      ydKey: 'YD385',
      plaka: '43AAZ480',
      bbt: '26',
      gidenTonaj: '',
    },
    {
      blockKey: 'BLK_10',
      blockHeaderRow: 10,
      headerText: 'YD385(M) / LOT NO 26 07 24 / 120 BBT',
      ydKey: 'YD385',
      plaka: '43ABR539',
      bbt: '26',
      gidenTonaj: '',
    },
    {
      blockKey: 'BLK_10',
      blockHeaderRow: 10,
      headerText: 'YD385(M) / LOT NO 26 07 24 / 120 BBT',
      ydKey: 'YD385',
      plaka: '43AK877',
      bbt: '24',
      gidenTonaj: '',
    },
  ]);
  assert.equal(pending.length, 1);
  assert.match(String(pending[0].ydKey), /^YD385/);
  assert.equal(pending[0].remainingBbt, 0);
  assert.equal(pending[0].waitingPlates.length, 4);
  assert.equal(core.hasNakliyeBlockContent(pending[0]), true);
});

test('analyzeNakliyePending — YD40 lists all gelmeyen plates and remaining 27 BBT', () => {
  const pending = core.analyzeNakliyePending([
    { blockKey: 'BLK_36', blockHeaderRow: 36, headerText: 'YD40(G) / 200 BBT', plaka: '03AIT034', sira: '1', bbt: '26', gidenTonaj: '' },
    { blockKey: 'BLK_36', blockHeaderRow: 36, headerText: 'YD40(G) / 200 BBT', plaka: '03ADB390', sira: '2', bbt: '26', gidenTonaj: '' },
    { blockKey: 'BLK_36', blockHeaderRow: 36, headerText: 'YD40(G) / 200 BBT', plaka: '41BFL699', sira: '3', bbt: '21', gidenTonaj: '' },
    { blockKey: 'BLK_36', blockHeaderRow: 36, headerText: 'YD40(G) / 200 BBT', plaka: '03DH540', sira: '4', bbt: '24', gidenTonaj: '' },
    { blockKey: 'BLK_36', blockHeaderRow: 36, headerText: 'YD40(G) / 200 BBT', plaka: '03BN929', sira: '5', bbt: '24', gidenTonaj: '' },
    { blockKey: 'BLK_36', blockHeaderRow: 36, headerText: 'YD40(G) / 200 BBT', plaka: '03VR929', sira: '6', bbt: '24', gidenTonaj: '' },
    { blockKey: 'BLK_36', blockHeaderRow: 36, headerText: 'YD40(G) / 200 BBT', plaka: '16RCU18', sira: '7', bbt: '28', gidenTonaj: '' },
  ]);
  assert.equal(pending.length, 1);
  assert.equal(pending[0].waitingPlates.length, 7);
  assert.equal(pending[0].remainingBbt, 27);
  const sheet = core.buildExcelBlockRows(pending[0]).filter((r) => r.kind === 'plate');
  assert.deepEqual(
    sheet.map((r) => r.a),
    ['03AIT034', '03ADB390', '41BFL699', '03DH540', '03BN929', '03VR929', '16RCU18']
  );
});

test('shouldUseDualColumnLayout — long list uses two columns', () => {
  const bodyRows = [{ kind: 'header' }];
  for (let i = 0; i < 10; i++) bodyRows.push({ kind: 'plate', no: i + 1 });
  bodyRows.push({ kind: 'header' });
  for (let i = 0; i < 4; i++) bodyRows.push({ kind: 'plate', no: 11 + i });
  const blocks = core.groupSheetRowsByBlock(bodyRows);
  assert.equal(blocks.length, 2);
  assert.equal(core.shouldUseDualColumnLayout(bodyRows, blocks), true);
  const cols = core.splitBlocksIntoColumns(blocks);
  assert.equal(cols.length, 2);
  assert.ok(cols[0].length >= 1);
  assert.ok(cols[1].length >= 1);
});

test('shouldUseDualColumnLayout — short list stays single', () => {
  const bodyRows = [{ kind: 'header' }, { kind: 'plate', no: 1 }];
  const blocks = core.groupSheetRowsByBlock(bodyRows);
  assert.equal(core.shouldUseDualColumnLayout(bodyRows, blocks), false);
});

test('buildExcelBlockRows — empty block has header only', () => {
  const item = core.analyzeBlock([
    {
      blockKey: 'X',
      headerText: 'YD82(M) / HP 0,60-1,20 / 4 BBT',
      _ihracatEmptyBlock: true,
    },
  ]);
  const rows = core.buildExcelBlockRows(item);
  assert.equal(rows[0].a, 'YD82(M) 4 BBT (HP 0,60-1,20)');
  assert.equal(rows[1].a, '4 BBT DAHA PLAKA VERİLECEK');
  assert.equal(rows.length, 2);
  const sheetRows = core.buildExcelSheetRows([item]);
  assert.equal(sheetRows[sheetRows.length - 1].a, '4 BBT DAHA PLAKA VERİLECEK');
});

test('multiple YD82 blocks get different malzeme in header', () => {
  const rows = [
    { blockKey: 'B1', blockHeaderRow: 10, headerText: 'YD82(M) / HP 0,60-1,20 / 4 BBT', _ihracatEmptyBlock: true },
    { blockKey: 'B2', blockHeaderRow: 50, headerText: 'YD82(M) / HP 1,20-2,40 / 16 BBT', _ihracatEmptyBlock: true },
    { blockKey: 'B3', blockHeaderRow: 90, headerText: 'YD82(M) / HP 1,20-2,80 / 20 BBT', _ihracatEmptyBlock: true },
  ];
  const pending = core.analyzeNakliyePending(rows);
  assert.equal(pending.length, 3);
  assert.equal(pending[0].malzemeLabel, 'HP 0,60-1,20');
  assert.equal(pending[1].malzemeLabel, 'HP 1,20-2,40');
  assert.equal(pending[2].malzemeLabel, 'HP 1,20-2,80');
});

test('analyzeNakliyePending sorts by Excel blockHeaderRow', () => {
  const rows = [
    { blockKey: 'C', blockHeaderRow: 300, headerText: 'YD99 / 10 BBT', _ihracatEmptyBlock: true },
    { blockKey: 'A', blockHeaderRow: 100, headerText: 'YD82 / 4 BBT', _ihracatEmptyBlock: true },
    { blockKey: 'B', blockHeaderRow: 200, headerText: 'YD03 / 120 BBT', plaka: '03VY230', bbt: '28', gidenTonaj: '' },
    {
      blockKey: 'B',
      blockHeaderRow: 200,
      blockPendingPlakaNotes: [{ text: '92BBT PLAKA VERİLECEK', remainingBbt: 92 }],
    },
  ];
  const pending = core.analyzeNakliyePending(rows);
  assert.deepEqual(pending.map((p) => p.ydKey), ['YD82', 'YD03', 'YD99']);
});

test('çift kantar — same plate in two blocks stays pending in both', () => {
  const rows = [
    { blockKey: 'B1', blockHeaderRow: 10, headerText: 'YD82 / 4 BBT HP0', plaka: '64BE703', bbt: '4', gidenTonaj: '' },
    { blockKey: 'B2', blockHeaderRow: 50, headerText: 'YD82 / 16 BBT HP1', plaka: '64BE703', bbt: '16', gidenTonaj: '' },
  ];
  const pending = core.analyzeNakliyePending(rows);
  assert.equal(pending.length, 2);
  assert.ok(pending.every((p) => p.waitingPlates.some((w) => w.plaka === '64BE703')));
});

test('departed in one block does not hide plate in another block', () => {
  const rows = [
    { blockKey: 'B1', blockHeaderRow: 10, headerText: 'YD82 / 4 BBT', plaka: '64BE703', bbt: '4', gidenTonaj: '4100', tonajKg: '4200' },
    { blockKey: 'B2', blockHeaderRow: 50, headerText: 'YD82 / 16 BBT', plaka: '64BE703', bbt: '16', gidenTonaj: '' },
  ];
  const pending = core.analyzeNakliyePending(rows);
  assert.equal(pending.length, 1);
  assert.equal(pending[0].planBbt, 16);
  assert.equal(pending[0].waitingPlates[0].plaka, '64BE703');
});

test('isOzmalPlate recognizes company plates with spaces', () => {
  assert.equal(core.isOzmalPlate('43 ADT 557'), true);
  assert.equal(core.isOzmalPlate('43ADT557'), true);
  assert.equal(core.isOzmalPlate('43 ADS 403'), true);
  assert.equal(core.isOzmalPlate('43VE530'), false);
});

test('analyzeBlock — özmal plate separated from gelmeyen list', () => {
  const item = core.analyzeBlock([
    {
      blockKey: 'Y',
      blockHeaderRow: 20,
      headerText: 'YD05 / 800 BBT / HP 0,074-0,30',
      plaka: '43 ADT 557',
      bbt: '24',
      gidenTonaj: '',
    },
    {
      blockKey: 'Y',
      blockHeaderRow: 20,
      headerText: 'YD05 / 800 BBT / HP 0,074-0,30',
      plaka: '43VE530',
      bbt: '22',
      gidenTonaj: '',
    },
  ]);
  assert.equal(item.ozmalPlates.length, 1);
  assert.equal(item.waitingPlates.length, 1);
  assert.equal(item.remainingBbt, 754);
});

test('buildExcelSheetParts — özmal plates are hidden from nakliyeci sheet', () => {
  const item = core.analyzeBlock([
    {
      blockKey: 'Y',
      blockHeaderRow: 20,
      headerText: 'YD05 / 800 BBT',
      plaka: '43 ADT 550',
      bbt: '24',
      gidenTonaj: '',
    },
    {
      blockKey: 'Y',
      blockHeaderRow: 20,
      headerText: 'YD05 / 800 BBT',
      plaka: '43VE530',
      bbt: '22',
      gidenTonaj: '',
    },
  ]);
  assert.equal(item.ozmalPlates.length, 1);
  assert.equal(item.waitingPlates.length, 1);
  const parts = core.buildExcelSheetParts([item]);
  assert.equal(parts.ozmalRows.length, 0);
  const ozmalRow = parts.nakliyeRows.find((r) => r.a === '43ADT550');
  assert.equal(ozmalRow, undefined);
  const waitingRow = parts.nakliyeRows.find((r) => r.a === '43VE530');
  assert.ok(waitingRow);
  assert.equal(waitingRow.b, 'GELMEYEN ARAÇ');
  assert.equal(waitingRow.ozmal, false);
});

test('buildExcelBlockRows — LOT no appears in yellow header per product', () => {
  const item = core.analyzeBlock([
    {
      blockKey: 'L1',
      headerText: 'YD331 / 120 BBT / LOT NO 26 07 20 / HP 0,74-0,40',
      plaka: '43AGK142',
      bbt: '28',
      gidenTonaj: '',
    },
  ]);
  assert.equal(item.lotLabel, 'LOT 26 07 20');
  const rows = core.buildExcelBlockRows(item);
  assert.equal(rows[0].kind, 'header');
  assert.equal(rows[0].a, 'YD331 120 BBT · LOT 26 07 20 (HP 0,74-0,40)');
  assert.equal(rows[0].lotLabel, 'LOT 26 07 20');
});

test('extractYuklemeYeri — AVDAN and 1.OSB from Excel field or header', () => {
  assert.equal(core.normalizeYuklemeYeri('AVDAN'), 'AVDAN');
  assert.equal(core.normalizeYuklemeYeri('avdan tesisi'), 'AVDAN');
  assert.equal(core.normalizeYuklemeYeri('1.OSB'), '1.OSB');
  assert.equal(core.normalizeYuklemeYeri('1 OSB'), '1.OSB');
  assert.equal(core.normalizeYuklemeYeri('1. OSB'), '1.OSB');
  assert.equal(core.extractYuklemeYeri({ yuklemeYeri: 'AVDAN' }), 'AVDAN');
  assert.equal(core.extractYuklemeYeri({ headerText: 'YD40(G) / 200 BBT / 1.OSB' }), '1.OSB');
  assert.equal(core.extractYuklemeYeri({ blockMeta: { yuklemeYeri: 'AVDAN' } }), 'AVDAN');
  assert.equal(core.extractYuklemeYeri({ sheetName: '1.OSB' }), '1.OSB');
  assert.equal(core.extractYuklemeYeri({ headerText: 'YD40 / 200 BBT' }), '');
});

test('buildExcelBlockRows — yükleme yeri is not added to yellow header', () => {
  const avdan = core.analyzeBlock([
    {
      blockKey: 'A1',
      headerText: 'YD331 / 120 BBT / LOT NO 26 07 20 / HP 0,74-0,40',
      yuklemeYeri: 'AVDAN',
      plaka: '43AGK142',
      bbt: '28',
      gidenTonaj: '',
    },
  ]);
  assert.equal(avdan.yuklemeYeri, 'AVDAN');
  assert.equal(
    core.buildExcelBlockRows(avdan)[0].a,
    'YD331 120 BBT · LOT 26 07 20 (HP 0,74-0,40)'
  );

  const osb = core.analyzeBlock([
    {
      blockKey: 'O1',
      headerText: 'YD40(G) / 200 BBT',
      yuklemeYeri: '1.OSB',
      _ihracatEmptyBlock: true,
    },
  ]);
  assert.equal(osb.yuklemeYeri, '1.OSB');
  assert.equal(core.buildExcelBlockRows(osb)[0].a, 'YD40(G) 200 BBT');
});

test('buildBlockPlateRows — sorts by Excel sira within block', () => {
  const item = core.analyzeBlock([
    {
      blockKey: 'Y',
      headerText: 'YD20 / 360 BBT',
      plaka: '03DH540',
      sira: '20',
      bbt: '26',
      gidenTonaj: '',
    },
    {
      blockKey: 'Y',
      headerText: 'YD20 / 360 BBT',
      plaka: '43AGK142',
      sira: '18',
      bbt: '20',
      gidenTonaj: '',
    },
    {
      blockKey: 'Y',
      headerText: 'YD20 / 360 BBT',
      plaka: '20ANA257',
      sira: '19',
      bbt: '20',
      gidenTonaj: '',
    },
  ]);
  const rows = core.buildExcelBlockRows(item).filter((r) => r.kind === 'plate');
  assert.deepEqual(
    rows.map((r) => r.no),
    [18, 19, 20]
  );
  assert.deepEqual(
    rows.map((r) => r.a),
    ['43AGK142', '20ANA257', '03DH540']
  );
});

test('analyzeNakliyePending — same blockKey from different Excel files stay separate', () => {
  const rows = [
    {
      blockKey: 'BLK_20',
      blockHeaderRow: 20,
      headerText: 'YD05 / 800 BBT / HP 0,074-0,30',
      fileName: 'İHRACAT 13.07.2026.xlsx',
      plaka: '43VE530',
      bbt: '22',
      gidenTonaj: '',
    },
    {
      blockKey: 'BLK_20',
      blockHeaderRow: 20,
      headerText: 'YD05 / 400 BBT / HP 0,074-0,30',
      fileName: 'İHRACAT 14.07.2026.xlsx',
      plaka: '03DH540',
      bbt: '24',
      gidenTonaj: '',
    },
  ];
  const pending = core.analyzeNakliyePending(rows);
  assert.equal(pending.length, 2);
  assert.equal(pending[0].planBbt, 800);
  assert.equal(pending[1].planBbt, 400);
  assert.equal(pending[0].sourceDateLabel, '13.07.2026');
  assert.equal(pending[1].sourceDateLabel, '14.07.2026');
});

test('buildExcelSheetParts — multi Excel dates appear in block headers', () => {
  const pending = core.analyzeNakliyePending([
    {
      blockKey: 'BLK_20',
      blockHeaderRow: 20,
      headerText: 'YD05 / 800 BBT',
      fileName: 'İHRACAT 13.07.2026.xlsx',
      plaka: '43VE530',
      bbt: '22',
      gidenTonaj: '',
    },
    {
      blockKey: 'BLK_20',
      blockHeaderRow: 20,
      headerText: 'YD05 / 400 BBT',
      fileName: 'İHRACAT 14.07.2026.xlsx',
      plaka: '03DH540',
      bbt: '24',
      gidenTonaj: '',
    },
  ]);
  const parts = core.buildExcelSheetParts(pending);
  const headers = parts.nakliyeRows.filter((r) => r.kind === 'header').map((r) => r.a);
  assert.equal(headers.length, 2);
  assert.match(headers[0], /13\.07\.2026/);
  assert.match(headers[1], /14\.07\.2026/);
  assert.equal(parts.multiFile, true);
});

test('buildExcelSheetParts — multi Excel without date uses file name in block header', () => {
  const pending = core.analyzeNakliyePending([
    {
      blockKey: 'BLK_5',
      blockHeaderRow: 5,
      headerText: 'YD331 / 120 BBT / HP 0,074-0,40',
      fileName: '20.07.2026.xlsx',
      _ihracatEmptyBlock: true,
      plaka: '',
    },
    {
      blockKey: 'BLK_20',
      blockHeaderRow: 20,
      headerText: 'YD113 / 100 BBT / HP 1,20-2,80',
      fileName: '20.07.2026.xlsx',
      plaka: '03AIT034',
      bbt: '25',
      gidenTonaj: '',
    },
    {
      blockKey: 'BLK_20',
      blockHeaderRow: 20,
      headerText: 'YD33 / 2444 BBT / HP 0,074-0,30',
      fileName: 'YD33 (1).xlsx',
      plaka: '03VT423',
      bbt: '22',
      gidenTonaj: '',
    },
  ]);
  const parts = core.buildExcelSheetParts(pending);
  const headers = parts.nakliyeRows.filter((r) => r.kind === 'header').map((r) => r.a);
  assert.equal(headers.length, 3);
  assert.match(headers[0], /20\.07\.2026 · YD331/);
  assert.match(headers[1], /20\.07\.2026 · YD113/);
  assert.match(headers[2], /YD33 2444 BBT/);
  assert.equal(/YD33 \(1\)/.test(headers[2]), false);
});

test('groupItemsByExcelFile — same file blocks stay in one group', () => {
  const items = [
    { fileName: '20.07.2026.xlsx', blockHeaderRow: 5, ydKey: 'YD331' },
    { fileName: '20.07.2026.xlsx', blockHeaderRow: 20, ydKey: 'YD113' },
    { fileName: 'YD33 (1).xlsx', blockHeaderRow: 10, ydKey: 'YD33' },
  ];
  const groups = core.groupItemsByExcelFile(items);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].length, 2);
  assert.equal(groups[1].length, 1);
  assert.equal(groups[0][0].ydKey, 'YD331');
  assert.equal(groups[0][1].ydKey, 'YD113');
  assert.equal(groups[1][0].ydKey, 'YD33');
});

test('flattenSheetBlocks — stacked blocks in one Excel column', () => {
  const blockA = [
    { kind: 'header', a: 'YD331' },
    { kind: 'pending', a: '120 BBT DAHA PLAKA VERİLECEK' },
  ];
  const blockB = [{ kind: 'header', a: 'YD113' }, { kind: 'plate', a: '03AIT034' }];
  const rows = core.flattenSheetBlocks([[blockA, blockB]]);
  assert.equal(rows.length, 4);
  assert.equal(rows[0].a, 'YD331');
  assert.equal(rows[2].a, 'YD113');
});

test('shouldUseSideBySideFiles — true only for multiple Excel files', () => {
  assert.equal(
    core.shouldUseSideBySideFiles([
      { fileName: 'a.xlsx' },
      { fileName: 'b.xlsx' },
    ]),
    true
  );
  assert.equal(
    core.shouldUseSideBySideFiles([
      { fileName: 'a.xlsx' },
      { fileName: 'a.xlsx' },
    ]),
    false
  );
});

test('buildExcelBlockRows — özmal / başşoför plates are not listed on sheet', () => {
  const item = core.analyzeBlock([
    {
      blockKey: 'Y',
      blockHeaderRow: 20,
      headerText: 'YD05 / 800 BBT',
      plaka: '43 ADS 408',
      bbt: '24',
      gidenTonaj: '',
    },
  ]);
  assert.equal(item.ozmalPlates.length, 1);
  assert.equal(item.waitingPlates.length, 0);
  const rows = core.buildExcelBlockRows(item);
  const ozmalRow = rows.find((r) => r.a === '43ADS408');
  assert.equal(ozmalRow, undefined);
  // Özmal BBT plana sayıldığı için kalan düşer; listede plaka yok
  assert.equal(item.remainingBbt, 776);
});

test('normalizeYdKey — YD 40, yd40, YD40(G) collapse to YD40', () => {
  assert.equal(core.normalizeYdKey('YD 40'), 'YD40');
  assert.equal(core.normalizeYdKey('yd40'), 'YD40');
  assert.equal(core.normalizeYdKey('YD40(G) / LOT NO 26 07 41'), 'YD40');
  assert.equal(core.normalizeYdKey('YD 40 / 200 BBT'), 'YD40');
  assert.equal(core.ydBaseKey('firma: YD 40'), 'YD40');
  assert.equal(core.normalizeYdKey('HP7'), '');
});

test('remainingVehiclesForBlock — waiting plates + leftover BBT, dual kantar not unique', () => {
  const item = core.analyzeBlock([
    { blockKey: 'BLK_36', blockHeaderRow: 36, headerText: 'YD40(G) / 200 BBT', plaka: '03AIT034', sira: '1', bbt: '26', gidenTonaj: '' },
    { blockKey: 'BLK_36', blockHeaderRow: 36, headerText: 'YD40(G) / 200 BBT', plaka: '03ADB390', sira: '2', bbt: '26', gidenTonaj: '' },
    { blockKey: 'BLK_36', blockHeaderRow: 36, headerText: 'YD40(G) / 200 BBT', plaka: '41BFL699', sira: '3', bbt: '21', gidenTonaj: '' },
    { blockKey: 'BLK_36', blockHeaderRow: 36, headerText: 'YD40(G) / 200 BBT', plaka: '03DH540', sira: '4', bbt: '24', gidenTonaj: '' },
    { blockKey: 'BLK_36', blockHeaderRow: 36, headerText: 'YD40(G) / 200 BBT', plaka: '03BN929', sira: '5', bbt: '24', gidenTonaj: '' },
    { blockKey: 'BLK_36', blockHeaderRow: 36, headerText: 'YD40(G) / 200 BBT', plaka: '03VR929', sira: '6', bbt: '24', gidenTonaj: '' },
    { blockKey: 'BLK_36', blockHeaderRow: 36, headerText: 'YD40(G) / 200 BBT', plaka: '16RCU18', sira: '7', bbt: '28', gidenTonaj: '' },
  ]);
  assert.equal(item.waitingPlates.length, 7);
  assert.equal(item.remainingBbt, 27);
  assert.equal(core.remainingVehiclesForBlock(item), 8);
});

test('unassignedVehicleCount — leftover under one truck counts as 1', () => {
  assert.equal(core.unassignedVehicleCount(0, 24), 0);
  assert.equal(core.unassignedVehicleCount(27, 24), 1);
  assert.equal(core.unassignedVehicleCount(48, 24), 2);
  assert.equal(core.unassignedVehicleCount(12, 24), 1);
});

test('summarizeIhracatBalance totals remaining BBT and vehicles', () => {
  const a = { remainingBbt: 27, waitingPlates: [{ bbt: 24 }, { bbt: 24 }] };
  const b = { remainingBbt: 0, waitingPlates: [{ bbt: 22 }, { bbt: 22 }] };
  const sum = core.summarizeIhracatBalance([a, b]);
  assert.equal(sum.shipmentCount, 2);
  assert.equal(sum.remainingBbt, 27);
  assert.equal(sum.waitingPlates, 4);
  assert.equal(sum.remainingVehicles, 2 + 1 + 2);
});

test('printReportValidForBalance accepts today even if Excel imported later', () => {
  const now = Date.now();
  const meta = { importedAt: new Date(now + 60 * 60 * 1000).toISOString() };
  assert.equal(core.printReportValidForBalance(now, meta), true);
  assert.equal(core.printReportValidForBalance(now - 10 * 24 * 60 * 60 * 1000, meta), false);
});

test('enrichBalanceItemsWithReports drops remaining from report BBT after Excel reload', () => {
  const items = [
    { ydKey: 'YD33', planBbt: 1144, remainingBbt: 1144, processedBbt: 0, waitingPlates: [] },
  ];
  const reports = [
    { type: 'PRINT', ts: Date.now(), data: { firma: 'YD 33', bbt: '24', plaka: '03ABC123' } },
    { type: 'PRINT', ts: Date.now(), data: { firma: 'YD33(G)', bbt: '18', plaka: '41BFL699' } },
  ];
  const out = core.enrichBalanceItemsWithReports(items, reports, {});
  assert.equal(out[0].reportPrintCount, 2);
  assert.equal(out[0].processedBbt, 42);
  assert.equal(out[0].remainingBbt, 1102);
  assert.equal(out[0].balanceStatus, 'open');
  assert.ok(out[0].progressPct > 0);
});

test('analyzeBlock — 1144 BBT plan keeps remaining after 50 BBT assigned', () => {
  const item = core.analyzeBlock([
    {
      blockKey: 'BLK_20',
      blockHeaderRow: 20,
      headerText: 'YD33 / LOT NO 26 07 23 / 1144 BBT',
      ydKey: 'YD33',
      blockTotals: { bbt: '50' },
      blockMeta: { bbtPaletLine: '50 BBT 3 PALET' },
      plaka: '16 PK 167',
      bbt: '24',
      gidenTonaj: '',
    },
    {
      blockKey: 'BLK_20',
      blockHeaderRow: 20,
      headerText: 'YD33 / LOT NO 26 07 23 / 1144 BBT',
      ydKey: 'YD33',
      blockTotals: { bbt: '50' },
      plaka: '16 CBL 713',
      bbt: '26',
      gidenTonaj: '',
    },
  ]);
  assert.ok(item);
  assert.equal(item.planBbt, 1144);
  assert.equal(item.assignedWaitingBbt, 50);
  assert.equal(item.remainingBbt, 1094);
  assert.equal(item.waitingPlates.length, 2);
  const rows = core.buildExcelBlockRows(item);
  const pending = rows.filter((r) => r.kind === 'pending');
  assert.equal(pending.length, 1);
  assert.match(pending[0].a, /1094\s*BBT/i);
});

test('analyzeBlock — YD276(M) LOT header uses TOPLAM BBT when header has no BBT', () => {
  const item = core.analyzeBlock([
    {
      blockKey: 'BLK_276',
      blockHeaderRow: 40,
      headerText: 'YD276(M) / LOT NO 26 07 44',
      ydKey: 'YD276',
      blockTotals: { bbt: '200' },
      _ihracatEmptyBlock: true,
    },
  ], { includeComplete: true });
  assert.ok(item);
  assert.equal(item.ydKey, 'YD276(M)');
  assert.equal(item.lotLabel, 'LOT 26 07 44');
  assert.equal(item.planBbt, 200);
  assert.equal(item.remainingBbt, 200);
});

test('analyzeIhracatBalance — YD276(M) stays listed without BBT in yellow header', () => {
  const items = core.analyzeIhracatBalance([
    {
      blockKey: 'BLK_276',
      blockHeaderRow: 40,
      headerText: 'YD276(M) / LOT NO 26 07 44',
      ydKey: 'YD276',
      _ihracatEmptyBlock: true,
    },
  ]);
  assert.equal(items.length, 1);
  assert.equal(core.normalizeYdKey(items[0].ydKey), 'YD276');
});

test('enrichBalanceItemsWithReports — Avdan print drops remaining even if plate is not in Excel', () => {
  const items = core.analyzeIhracatBalance([
    {
      blockKey: 'BLK_276',
      blockHeaderRow: 40,
      headerText: 'YD276(M) / LOT NO 26 07 44',
      ydKey: 'YD276',
      blockTotals: { bbt: '200' },
      _ihracatEmptyBlock: true,
    },
  ]);
  const reports = [
    {
      type: 'PRINT',
      ts: Date.now(),
      plaka: '03ABC123',
      data: { firma: 'YD276(M)', bbt: '24', basimYeri: 'AVDAN', malzeme: 'LOT NO 26 07 44' },
    },
  ];
  const out = core.enrichBalanceItemsWithReports(items, reports, {});
  assert.equal(out.length, 1);
  assert.equal(out[0].processedBbt, 24);
  assert.equal(out[0].remainingBbt, 176);
  assert.equal(out[0].reportPrintCount, 1);
  assert.equal(out[0].lastPrintSite, 'AVDAN');
});

test('enrichBalanceItemsWithReports — new Avdan plate still counts when Excel already has waiting plates', () => {
  const items = core.analyzeIhracatBalance([
    {
      blockKey: 'BLK_276',
      blockHeaderRow: 40,
      headerText: 'YD276(M) / LOT NO 26 07 44 / 200 BBT',
      ydKey: 'YD276',
      plaka: '16RCU18',
      bbt: '28',
      gidenTonaj: '',
    },
  ]);
  const reports = [
    {
      type: 'PRINT',
      ts: Date.now(),
      plaka: '03NEW001',
      data: { firma: 'YD276(M)', bbt: '24', basimYeri: 'AVDAN' },
    },
  ];
  const out = core.enrichBalanceItemsWithReports(items, reports, {});
  assert.equal(out[0].assignedWaitingBbt, 28);
  assert.equal(out[0].processedBbt, 52);
  assert.equal(out[0].remainingBbt, 148);
});

test('enrichBalanceItemsWithReports — Excel yoksa YD yazdırması yine listelenir', () => {
  const reports = [
    {
      type: 'PRINT',
      ts: Date.now(),
      plaka: '03ABC123',
      data: { firma: 'YD276(M)', bbt: '24', basimYeri: 'AVDAN' },
    },
  ];
  const out = core.enrichBalanceItemsWithReports([], reports, {});
  assert.equal(out.length, 1);
  assert.equal(core.normalizeYdKey(out[0].ydKey), 'YD276');
  assert.equal(out[0].processedBbt, 24);
  assert.equal(out[0].fromReportsOnly, true);
  assert.equal(out[0].yuklemeYeri, 'AVDAN');
});

test('enrichBalanceItemsWithReports — rapordan LOT ve malzeme dolar', () => {
  const reports = [
    {
      type: 'PRINT',
      ts: Date.now(),
      plaka: '03ABC123',
      data: {
        firma: 'YD276(M)',
        bbt: '24',
        basimYeri: 'AVDAN',
        malzeme: 'HP 0,60-1,20',
        yuklemeNotu: 'LOT NO 26 07 44',
      },
    },
  ];
  const out = core.enrichBalanceItemsWithReports([], reports, {});
  assert.equal(out[0].lotLabel, 'LOT 26 07 44');
  assert.equal(out[0].malzemeLabel, 'HP 0,60-1,20');
  assert.equal(out[0].yuklemeYeri, 'AVDAN');
  assert.equal(out[0].ydKey, 'YD276(M)');
});

test('mergeLocalAndPoolItems — Excel yokken havuz satırları kalır', () => {
  const pool = [
    { ydKey: 'YD276(M)', lotLabel: 'LOT 26 07 44', planBbt: 200, remainingBbt: 200, fileName: 'avdan.xlsx', blockKey: 'BLK_1' },
  ];
  const merged = core.mergeLocalAndPoolItems([], pool);
  assert.equal(merged.length, 1);
  assert.equal(core.normalizeYdKey(merged[0].ydKey), 'YD276');
});

test('mergeLocalAndPoolItems — aynı YD+LOT yerel varsa havuz yinelenmez', () => {
  const local = [
    { ydKey: 'YD276(M)', lotLabel: 'LOT 26 07 44', planBbt: 200, remainingBbt: 176, fileName: 'local.xlsx', blockKey: 'BLK_L' },
  ];
  const pool = [
    { ydKey: 'YD276(M)', lotLabel: 'LOT 26 07 44', planBbt: 200, remainingBbt: 200, fileName: 'avdan.xlsx', blockKey: 'BLK_1' },
    { ydKey: 'YD40', lotLabel: 'LOT 1', planBbt: 40, remainingBbt: 40, fileName: 'osb.xlsx', blockKey: 'BLK_2' },
  ];
  const merged = core.mergeLocalAndPoolItems(local, pool);
  assert.equal(merged.length, 2);
  assert.equal(core.normalizeYdKey(merged[1].ydKey), 'YD40');
});

test('buildPoolSourcesFromRows — YD276(M) LOT bloğunu sıkıştırır', () => {
  const sources = core.buildPoolSourcesFromRows([
    {
      fileName: '21.08.2026.xlsx',
      blockKey: 'BLK_276',
      blockHeaderRow: 40,
      headerText: 'YD276(M) / LOT NO 26 07 44',
      ydKey: 'YD276',
      blockTotals: { bbt: '200' },
      _ihracatEmptyBlock: true,
    },
  ], { dateKey: '2026-08-21', importedAt: '2026-08-21T10:00:00.000Z' });
  assert.equal(sources.length, 1);
  assert.equal(sources[0].blocks.length, 1);
  assert.equal(sources[0].blocks[0].planBbt, 200);
  assert.equal(core.normalizeYdKey(sources[0].blocks[0].ydKey), 'YD276');
});

test('enrichBalanceItemsWithReports marks TAMAMLANDI when remaining is 0', () => {
  const items = [
    { ydKey: 'YD82', planBbt: 40, remainingBbt: 0, processedBbt: 40, waitingPlates: [] },
  ];
  const out = core.enrichBalanceItemsWithReports(items, [], {});
  assert.equal(out[0].balanceStatus, 'done');
  assert.equal(core.balanceRowStatus(out[0]), 'done');
});

test('overlayPlanFromCatalog fills PLAN/KALAN and Excel name on report-only row', () => {
  const reportsOnly = [
    {
      ydKey: 'YD276(M)',
      lotLabel: 'LOT 26 07 44',
      planBbt: 0,
      processedBbt: 538,
      remainingBbt: 0,
      fromReportsOnly: true,
      fileName: '',
    },
  ];
  const catalog = [
    {
      ydKey: 'YD276(M)',
      lotLabel: 'LOT 26 07 44',
      planBbt: 600,
      fileName: '21.08.2026 Avdan.xlsx',
    },
  ];
  const out = core.overlayPlanFromCatalog(reportsOnly, catalog);
  assert.equal(out[0].planBbt, 600);
  assert.equal(out[0].processedBbt, 538);
  assert.equal(out[0].remainingBbt, 62);
  assert.equal(out[0].fileName, '21.08.2026 Avdan.xlsx');
  assert.equal(out[0].fromReportsOnly, false);
  assert.equal(core.excelSourceLabel(out[0]), '21.08.2026 Avdan');
});

test('buildBalanceRowsFromPlanAndReports — plan Excel, çıkan yazdırma, kalan fark', () => {
  const planItems = [
    {
      ydKey: 'YD276(M)',
      lotLabel: 'LOT 26 07 44',
      malzemeLabel: 'HP 0,15-0,40',
      planBbt: 600,
      remainingBbt: 600,
      processedBbt: 0,
      fileName: '21.08.2026.xlsx',
      yuklemeYeri: 'AVDAN',
    },
  ];
  const reports = [
    {
      type: 'PRINT',
      ts: Date.now(),
      plaka: '03ABC123',
      data: {
        firma: 'YD276(M)',
        bbt: '538',
        basimYeri: 'AVDAN',
        yuklemeNotu: 'LOT NO 26 07 44',
      },
    },
  ];
  const out = core.buildBalanceRowsFromPlanAndReports(planItems, reports, {});
  assert.equal(out.length, 1);
  assert.equal(out[0].planBbt, 600);
  assert.equal(out[0].processedBbt, 538);
  assert.equal(out[0].remainingBbt, 62);
  assert.equal(out[0].fileName, '21.08.2026.xlsx');
  assert.equal(core.excelSourceLabel(out[0]), '21.08.2026');
});

test('buildPoolSourcesFromItems groups by fileName', () => {
  const sources = core.buildPoolSourcesFromItems([
    { ydKey: 'YD40', lotLabel: 'LOT 1', planBbt: 40, fileName: 'avdan.xlsx' },
    { ydKey: 'YD33', lotLabel: 'LOT 2', planBbt: 80, fileName: '1osb.xlsx' },
  ], { importedAt: '2026-08-21T10:00:00.000Z' });
  assert.equal(sources.length, 2);
  const names = sources.map((s) => s.fileName).sort();
  assert.deepEqual(names, ['1osb.xlsx', 'avdan.xlsx']);
  assert.equal(sources.find((s) => s.fileName === 'avdan.xlsx').blocks[0].planBbt, 40);
});

test('excelSourceLabel — Excel yok when report-only', () => {
  assert.equal(core.excelSourceLabel({ fromReportsOnly: true, fileName: '' }), 'Excel yok');
});

test('compactPlanRecords keeps YD, LOT, PLAN and file name', () => {
  const plans = core.compactPlanRecords([
    {
      ydKey: 'YD276(M)',
      lotLabel: 'LOT 26 07 44',
      planBbt: 600,
      fileName: '21.08.2026 Avdan.xlsx',
      yuklemeYeri: 'AVDAN',
    },
  ], {});
  assert.equal(plans.length, 1);
  assert.equal(plans[0].planBbt, 600);
  assert.equal(plans[0].fileName, '21.08.2026 Avdan.xlsx');
  assert.equal(core.normalizeYdKey(plans[0].ydKey), 'YD276');
});

test('same YD + malzeme with and without LOT is one row, çıkan summed', () => {
  const reports = [
    {
      type: 'PRINT',
      ts: Date.now(),
      plaka: '03AAA001',
      data: { firma: 'YD33(M)', bbt: '297', basimYeri: '1.OSB', malzeme: 'HP 0,074-0,30' },
    },
    {
      type: 'PRINT',
      ts: Date.now(),
      plaka: '03AAA002',
      data: {
        firma: 'YD33(M)',
        bbt: '157',
        basimYeri: '1.OSB',
        malzeme: 'HP 0,074-0,30',
        yuklemeNotu: 'LOT NO 26 07 25',
      },
    },
  ];
  const out = core.buildBalanceRowsFromPlanAndReports([], reports, {});
  assert.equal(out.length, 1);
  assert.equal(core.normalizeYdKey(out[0].ydKey), 'YD33');
  assert.equal(out[0].processedBbt, 454);
  assert.match(String(out[0].lotLabel || ''), /26\s*07\s*25/);
});

test('excel reload same YD+malzeme+yer updates plan and file, does not duplicate', () => {
  const oldFile = {
    ydKey: 'YD33(M)',
    malzemeLabel: 'HP 0,074-0,30',
    yuklemeYeri: '1.OSB',
    planBbt: 400,
    fileName: '20.08.2026.xlsx',
  };
  const newFile = {
    ydKey: 'YD33(M)',
    malzemeLabel: 'HP 0,074-0,30',
    yuklemeYeri: '1.OSB',
    lotLabel: 'LOT 26 07 25',
    planBbt: 500,
    fileName: '21.08.2026.xlsx',
  };
  const merged = core.mergeLocalAndPoolItems([oldFile], [newFile]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].planBbt, 500);
  assert.equal(merged[0].fileName, '21.08.2026.xlsx');
});

test('overlay plan matches YD+malzeme even if LOT missing on print row', () => {
  const out = core.overlayPlanFromCatalog(
    [{
      ydKey: 'YD33(M)',
      malzemeLabel: 'HP 0,074-0,30',
      yuklemeYeri: '1.OSB',
      planBbt: 0,
      processedBbt: 297,
      fromReportsOnly: true,
    }],
    [{
      ydKey: 'YD33(M)',
      malzemeLabel: 'HP 0,074-0,30',
      yuklemeYeri: '1.OSB',
      lotLabel: 'LOT 26 07 25',
      planBbt: 500,
      fileName: '21.08.2026 OSB.xlsx',
    }]
  );
  assert.equal(out[0].planBbt, 500);
  assert.equal(out[0].remainingBbt, 203);
  assert.equal(out[0].fileName, '21.08.2026 OSB.xlsx');
});

test('dateKeyFromFileName — combined names do not inherit the other file date', () => {
  assert.equal(core.dateKeyFromFileName('YD33 LOT NO 26 07 23 1.OSB.xlsx + 20.08.2026.xlsx'), '');
  assert.equal(core.dateKeyFromFileName('20.08.2026.xlsx'), '2026-08-20');
});

test('repairRowSourceFiles — YD in filename vs leftover dated file', () => {
  const combined = 'YD33 LOT NO 26 07 23 1.OSB.xlsx + 20.08.2026.xlsx';
  const rows = [
    {
      blockKey: 'BLK_20',
      headerText: 'YD33 / LOT NO 26 07 23 / 1144 BBT',
      fileName: combined,
      _ihracatEmptyBlock: true,
    },
    {
      blockKey: 'BLK_20',
      headerText: 'YD276(M) / LOT NO 26 07 44 / 400 BBT',
      fileName: combined,
      _ihracatEmptyBlock: true,
    },
  ];
  const out = core.repairRowSourceFiles(rows, {
    fileName: combined,
    files: ['YD33 LOT NO 26 07 23 1.OSB.xlsx', '20.08.2026.xlsx'],
  });
  assert.equal(out[0].fileName, 'YD33 LOT NO 26 07 23 1.OSB.xlsx');
  assert.equal(out[1].fileName, '20.08.2026.xlsx');
});

test('analyzeNakliyePending — combined fileName + same BLK keeps two Excels separate', () => {
  const combined = 'YD33 LOT NO 26 07 23 1.OSB.xlsx + 20.08.2026.xlsx';
  const pending = core.analyzeNakliyePending(
    [
      {
        blockKey: 'BLK_20',
        blockHeaderRow: 20,
        headerText: 'YD33 / LOT NO 26 07 23 / 1144 BBT',
        fileName: combined,
        _ihracatEmptyBlock: true,
      },
      {
        blockKey: 'BLK_20',
        blockHeaderRow: 20,
        headerText: 'YD276(M) / LOT NO 26 07 44 / 400 BBT / HP 0,15-0,40',
        fileName: combined,
        _ihracatEmptyBlock: true,
      },
    ],
    {
      fileName: combined,
      files: ['YD33 LOT NO 26 07 23 1.OSB.xlsx', '20.08.2026.xlsx'],
    }
  );
  assert.equal(pending.length, 2);
  const yds = pending.map((p) => core.normalizeYdKey(p.ydKey)).sort();
  assert.deepEqual(yds, ['YD276', 'YD33']);
  assert.equal(
    pending.find((p) => core.normalizeYdKey(p.ydKey) === 'YD33').fileName,
    'YD33 LOT NO 26 07 23 1.OSB.xlsx'
  );
  assert.equal(
    pending.find((p) => core.normalizeYdKey(p.ydKey) === 'YD276').fileName,
    '20.08.2026.xlsx'
  );
  const parts = core.buildExcelSheetParts(pending);
  assert.equal(parts.multiFile, true);
  const headers = parts.nakliyeRows.filter((r) => r.kind === 'header').map((r) => r.a);
  assert.equal(headers.length, 2);
});

test('analyzeNakliyePending — YD33 waiting plates stay visible next to empty YD276 file', () => {
  const combined = 'YD33 LOT NO 26 07 23 1.OSB.xlsx + 20.08.2026.xlsx';
  const pending = core.analyzeNakliyePending(
    [
      {
        blockKey: 'BLK_20',
        blockHeaderRow: 20,
        headerText: 'YD33 / LOT NO 26 07 25 / HP 0,074-0,30 / 50 BBT',
        ydKey: 'YD33',
        fileName: combined,
        plaka: '16 PK 167',
        bbt: '24',
        gidenTonaj: '',
      },
      {
        blockKey: 'BLK_20',
        blockHeaderRow: 20,
        headerText: 'YD33 / LOT NO 26 07 25 / HP 0,074-0,30 / 50 BBT',
        ydKey: 'YD33',
        fileName: combined,
        plaka: '16 CBL 713',
        bbt: '26',
        gidenTonaj: '',
      },
      {
        blockKey: 'BLK_20',
        blockHeaderRow: 20,
        headerText: 'YD33 / LOT NO 26 07 25 / HP 0,074-0,30 / 50 BBT',
        ydKey: 'YD33',
        fileName: combined,
        plaka: '43 ADT 553',
        bbt: '24',
        gidenTonaj: '24000',
      },
      {
        blockKey: 'BLK_20',
        blockHeaderRow: 20,
        headerText: 'YD276(M) / LOT NO 26 07 44 / HP 0,15-0,40',
        ydKey: 'YD276',
        fileName: combined,
        blockTotals: { bbt: '400' },
        _ihracatEmptyBlock: true,
      },
    ],
    {
      fileName: combined,
      files: ['YD33 LOT NO 26 07 23 1.OSB.xlsx', '20.08.2026.xlsx'],
    }
  );
  assert.equal(pending.length, 2);
  const yd33 = pending.find((p) => core.normalizeYdKey(p.ydKey) === 'YD33');
  const yd276 = pending.find((p) => core.normalizeYdKey(p.ydKey) === 'YD276');
  assert.ok(yd33);
  assert.ok(yd276);
  assert.equal(yd33.waitingPlates.length, 2);
  assert.deepEqual(
    yd33.waitingPlates.map((p) => core.compactPlate(p.plaka)).sort(),
    ['16CBL713', '16PK167']
  );
  assert.equal(yd276.remainingBbt, 400);
});

test('analyzeNakliyePending — YD33 stays when waiting plates have false giden stamp', () => {
  const pending = core.analyzeNakliyePending(
    [
      {
        blockKey: 'BLK_20',
        blockHeaderRow: 20,
        headerText: 'YD33 / LOT NO 26 07 25 / 50 BBT',
        ydKey: 'YD33',
        fileName: 'YD33 LOT NO 26 07 25 1.OSB.xlsx',
        plaka: '16 PK 167',
        bbt: '24',
        gidenTonaj: '24',
        tonajKg: '24',
      },
      {
        blockKey: 'BLK_20',
        blockHeaderRow: 20,
        headerText: 'YD33 / LOT NO 26 07 25 / 50 BBT',
        ydKey: 'YD33',
        fileName: 'YD33 LOT NO 26 07 25 1.OSB.xlsx',
        plaka: '16 CBL 713',
        bbt: '26',
        gidenTonaj: '26000',
        tonajKg: '26',
      },
      {
        blockKey: 'BLK_20',
        blockHeaderRow: 20,
        headerText: 'YD33 / LOT NO 26 07 25 / 50 BBT',
        ydKey: 'YD33',
        fileName: 'YD33 LOT NO 26 07 25 1.OSB.xlsx',
        plaka: '43 ADT 553',
        bbt: '24',
        gidenTonaj: '24100',
        tonajKg: '24500',
      },
      {
        blockKey: 'BLK_8',
        blockHeaderRow: 8,
        headerText: 'YD276(M) / LOT NO 26 07 44 / HP 0,15-0,40',
        ydKey: 'YD276',
        fileName: '20.08.2026.xlsx',
        blockTotals: { bbt: '400' },
        _ihracatEmptyBlock: true,
      },
    ],
    {
      files: ['YD33 LOT NO 26 07 25 1.OSB.xlsx', '20.08.2026.xlsx'],
    }
  );
  assert.equal(pending.length, 2);
  const yd33 = pending.find((p) => core.normalizeYdKey(p.ydKey) === 'YD33');
  assert.ok(yd33);
  assert.equal(yd33.waitingPlates.length, 2);
  assert.deepEqual(
    yd33.waitingPlates.map((p) => core.compactPlate(p.plaka)).sort(),
    ['16CBL713', '16PK167']
  );
});

test('analyzeNakliyePending — empty YD LOT block without BBT still listed', () => {
  const pending = core.analyzeNakliyePending([
    {
      blockKey: 'BLK_5',
      blockHeaderRow: 5,
      headerText: 'YD33 / LOT NO 26 07 23',
      ydKey: 'YD33',
      fileName: 'YD33 LOT NO 26 07 23 1.OSB.xlsx',
      _ihracatEmptyBlock: true,
    },
  ]);
  assert.equal(pending.length, 1);
  assert.equal(core.normalizeYdKey(pending[0].ydKey), 'YD33');
  assert.equal(core.hasNakliyeBlockContent(pending[0]), true);
  const rows = core.buildExcelBlockRows(pending[0]);
  assert.equal(rows[0].kind, 'header');
  assert.match(rows[0].a, /YD33/);
  assert.equal(rows[rows.length - 1].kind, 'pending');
});

test('isValidPlateCell — dummy EU / 0PLAKA0 are not real plates', () => {
  assert.equal(core.isValidPlateCell('EU'), false);
  assert.equal(core.isValidPlateCell('0PLAKA0'), false);
  assert.equal(core.isValidPlateCell('PLAKA0'), false);
  assert.equal(core.isValidPlateCell('03VR929'), true);
  assert.equal(core.isValidPlateCell('43ACM276'), true);
  assert.equal(core.isValidPlateCell('16RCU18'), true);
});

test('parseKg — Turkish thousand separators', () => {
  assert.equal(core.parseKg('33.000'), 33000);
  assert.equal(core.parseKg('32.400'), 32400);
  assert.equal(core.parseKg('26.160'), 26160);
  assert.equal(core.parseKg('33000'), 33000);
});

test('isRowDeparted — Excel 33.000 giden is departed', () => {
  assert.equal(
    core.isRowDeparted({
      plaka: '03VR929',
      bbt: '24',
      netTonaj: '32.400',
      gidenTonaj: '33.000',
    }),
    true
  );
});

test('analyzeBlock — 0PLAKA0 / EU BBT goes to remaining, not gelmeyen', () => {
  const item = core.analyzeBlock([
    {
      blockKey: 'Y50',
      headerText: 'YD50(G) / LOT NO 26 08 07 / 40 BBT',
      plaka: '0PLAKA0',
      bbt: '20',
      gidenTonaj: '',
    },
    {
      blockKey: 'Y50',
      headerText: 'YD50(G) / LOT NO 26 08 07 / 40 BBT',
      plaka: 'EU',
      bbt: '20',
      gidenTonaj: '',
    },
  ]);
  assert.ok(item);
  assert.equal(item.waitingPlates.length, 0);
  assert.equal(item.remainingBbt, 40);
});

test('applyLiveDepartedMarks — printed VR929 hides even with false giden stamp', () => {
  const meta = { importedAt: '2026-08-21T12:26:00.000Z' };
  const rows = [
    {
      blockKey: 'YD154',
      headerText: 'YD154(G) / LOT NO 26 08 03 / 200 BBT',
      ydKey: 'YD154',
      plaka: '03VR929',
      bbt: '24',
      gidenTonaj: '24',
    },
  ];
  const reports = [
    {
      type: 'PRINT',
      ts: new Date('2026-08-21T18:00:00.000Z').getTime(),
      data: { plaka: '03VR929', firma: 'YD154(G) / LOT NO 26 08 03', bbt: '24' },
    },
  ];
  const out = core.applyLiveDepartedMarks(rows, meta, reports);
  assert.ok(core.isRowDeparted(out[0]));
  const pending = core.analyzeNakliyePending(out);
  assert.equal(pending[0].waitingPlates.length, 0);
});

test('YD154 — çıkan VR929 kapanır, EU 26 BBT kalır, Excel dışı EA029 kalandan düşer', () => {
  const meta = { importedAt: '2026-08-21T12:26:00.000Z', dateKey: '2026-08-21' };
  const header = 'YD154(G) / LOT NO 26 08 03 / HP 1,20-2,80 / 200 BBT';
  const rows = [
    { blockKey: 'B154', blockHeaderRow: 10, headerText: header, ydKey: 'YD154', plaka: '03DH540', bbt: '26', gidenTonaj: '35840', tonajKg: '35300' },
    { blockKey: 'B154', blockHeaderRow: 10, headerText: header, ydKey: 'YD154', plaka: '03BN929', bbt: '26', gidenTonaj: '36100', tonajKg: '35300' },
    { blockKey: 'B154', blockHeaderRow: 10, headerText: header, ydKey: 'YD154', plaka: '03VR929', bbt: '24', gidenTonaj: '' },
    { blockKey: 'B154', blockHeaderRow: 10, headerText: header, ydKey: 'YD154', plaka: '03AIA133', bbt: '24', gidenTonaj: '33000', tonajKg: '32600' },
    { blockKey: 'B154', blockHeaderRow: 10, headerText: header, ydKey: 'YD154', plaka: '03AHP318', bbt: '24', gidenTonaj: '' },
    { blockKey: 'B154', blockHeaderRow: 10, headerText: header, ydKey: 'YD154', plaka: '03AIU484', bbt: '24', gidenTonaj: '' },
    { blockKey: 'B154', blockHeaderRow: 10, headerText: header, ydKey: 'YD154', plaka: 'EU', bbt: '26', gidenTonaj: '' },
  ];
  const reports = [
    {
      type: 'PRINT',
      ts: new Date('2026-08-21T20:00:00.000Z').getTime(),
      data: { plaka: '03VR929', firma: 'YD154(G) / LOT NO 26 08 03', bbt: '24', malzeme: 'HP 1,20-2,80' },
    },
    {
      type: 'PRINT',
      ts: new Date('2026-08-21T21:00:00.000Z').getTime(),
      data: { plaka: '03EA029', firma: 'YD154(G) / LOT NO 26 08 03', bbt: '26', malzeme: 'HP 1,20-2,80' },
    },
  ];
  const marked = core.applyLiveDepartedMarks(rows, meta, reports);
  let pending = core.analyzeNakliyePending(marked);
  assert.equal(pending.length, 1);
  assert.equal(pending[0].remainingBbt, 52);
  assert.deepEqual(
    pending[0].waitingPlates.map((p) => core.compactPlate(p.plaka)).sort(),
    ['03AHP318', '03AIU484']
  );
  pending = core.applyExtraPrintsToPendingItems(pending, reports, meta);
  assert.equal(pending[0].remainingBbt, 26);
  assert.equal(
    pending[0].waitingPlates.some((p) => core.compactPlate(p.plaka) === '03VR929'),
    false
  );
  const sheet = core.buildExcelBlockRows(pending[0]);
  const pendingRow = sheet.find((r) => r.kind === 'pending');
  assert.match(pendingRow.a, /26\s*BBT/i);
});

test('printReportValidForPending accepts prints from last 21 days', () => {
  const fiveDaysAgo = Date.now() - 5 * 24 * 60 * 60 * 1000;
  const monthAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const meta = { importedAt: new Date().toISOString(), dateKey: '2026-08-23' };
  assert.equal(core.printReportValidForPending(fiveDaysAgo, meta), true);
  assert.equal(core.printReportValidForPending(monthAgo, meta), false);
});

test('Excel plan vs rapor çıkan — 1126/1144 henüz bitmedi, YD33 görünür', () => {
  const header = 'YD33 / LOT NO 26 07 23 / 1144 BBT';
  const pending = core.analyzeNakliyePending([
    {
      blockKey: 'BLK_20',
      blockHeaderRow: 20,
      headerText: header,
      ydKey: 'YD33',
      fileName: 'YD33 LOT NO 26 07 23 1.OSB.xlsx',
      _ihracatEmptyBlock: true,
      blockPendingPlakaNotes: [{ text: '1114BBT PLAKA VERİLECEK', remainingBbt: 1114 }],
    },
  ]);
  assert.equal(pending.length, 1);
  assert.equal(pending[0].remainingBbt, 1114);

  const reports = [];
  for (let i = 0; i < 47; i++) {
    reports.push({
      type: 'PRINT',
      ts: Date.now() - (i + 1) * 60 * 60 * 1000,
      data: {
        plaka: '03AA' + String(100 + i),
        firma: 'YD33 / LOT NO 26 07 23',
        bbt: i === 46 ? '22' : '24',
        malzeme: 'HP 0,074-0,30',
      },
    });
  }
  const reportBbt = reports.reduce((s, r) => s + Number(r.data.bbt), 0);
  assert.equal(reportBbt, 1126);

  const out = core.applyExtraPrintsToPendingItems(pending, reports, {
    importedAt: new Date().toISOString(),
  });
  assert.equal(out.length, 1);
  assert.equal(out[0].reportBbt, 1126);
  assert.equal(out[0].planBbt, 1144);
  assert.equal(out[0].shipmentDone, false);
  assert.equal(out[0].remainingBbt, 18);
  const sheet = core.buildExcelBlockRows(out[0]);
  assert.match(sheet[0].a, /çıkan 1126\/1144/);
  assert.match(sheet.find((r) => r.kind === 'pending').a, /18\s*BBT/i);
});

test('Excel plan vs rapor — çıkan >= plan ise TAMAMLANDI, blok kaybolmaz', () => {
  const pending = core.analyzeNakliyePending([
    {
      blockKey: 'BLK_20',
      blockHeaderRow: 20,
      headerText: 'YD33 / LOT NO 26 07 23 / 48 BBT',
      ydKey: 'YD33',
      _ihracatEmptyBlock: true,
    },
  ]);
  const reports = [
    {
      type: 'PRINT',
      ts: Date.now(),
      data: { plaka: '03AAA001', firma: 'YD33 / LOT NO 26 07 23', bbt: '24' },
    },
    {
      type: 'PRINT',
      ts: Date.now(),
      data: { plaka: '03AAA002', firma: 'YD33 / LOT NO 26 07 23', bbt: '24' },
    },
  ];
  const out = core.applyExtraPrintsToPendingItems(pending, reports, {});
  assert.equal(out.length, 1);
  assert.equal(out[0].shipmentDone, true);
  assert.equal(out[0].reportBbt, 48);
  assert.equal(core.hasNakliyeBlockContent(out[0]), true);
  const sheet = core.buildExcelBlockRows(out[0]);
  assert.equal(sheet.find((r) => r.kind === 'done').a, 'TAMAMLANDI');
  assert.match(sheet[0].a, /çıkan 48\/48/);
});

test('başka LOT YD33 yazdırması bu Excel planına sayılmaz', () => {
  const pending = core.analyzeNakliyePending([
    {
      blockKey: 'BLK_20',
      blockHeaderRow: 20,
      headerText: 'YD33 / LOT NO 26 07 23 / 1144 BBT',
      ydKey: 'YD33',
      _ihracatEmptyBlock: true,
    },
  ]);
  const reports = [
    {
      type: 'PRINT',
      ts: Date.now(),
      data: { plaka: '03OLD001', firma: 'YD33 / LOT NO 26 06 01', bbt: '800' },
    },
  ];
  const out = core.applyExtraPrintsToPendingItems(pending, reports, {});
  assert.equal(out[0].reportBbt, 0);
  assert.equal(out[0].shipmentDone, false);
  assert.equal(out[0].remainingBbt, 1144);
});

test('stale Excel remaining drops to leftover when reports are partial', () => {
  const pending = core.analyzeNakliyePending([
    {
      blockKey: 'BLK_20',
      blockHeaderRow: 20,
      headerText: 'YD33 / 1144 BBT',
      ydKey: 'YD33',
      _ihracatEmptyBlock: true,
      blockPendingPlakaNotes: [{ text: '1114BBT PLAKA VERİLECEK', remainingBbt: 1114 }],
    },
  ]);
  const reports = [
    {
      type: 'PRINT',
      ts: Date.now() - 3 * 24 * 60 * 60 * 1000,
      data: { plaka: '03ABC123', firma: 'YD33', bbt: '24' },
    },
    {
      type: 'PRINT',
      ts: Date.now() - 2 * 24 * 60 * 60 * 1000,
      data: { plaka: '41BFL699', firma: 'YD33', bbt: '26' },
    },
  ];
  const out = core.applyExtraPrintsToPendingItems(pending, reports, {
    importedAt: new Date().toISOString(),
  });
  assert.equal(out.length, 1);
  assert.equal(out[0].remainingBbt, 1094);
  assert.match(core.buildExcelBlockRows(out[0]).find((r) => r.kind === 'pending').a, /1094\s*BBT/i);
});

test('Excel tarihi dosya adında yoksa meta.dateKey ile eski yazdırma elenir', () => {
  const pending = core.analyzeNakliyePending([
    {
      blockKey: 'BLK_276',
      headerText: 'YD276(M) / LOT NO 26 07 44 / 400 BBT',
      ydKey: 'YD276',
      fileName: 'YD276 LOT 26 07 44 AVDAN.xlsx',
      _ihracatEmptyBlock: true,
    },
  ]);
  assert.equal(core.itemExcelDateKey(pending[0], { dateKey: '2026-08-20', fileName: '20.08.2026.xlsx' }), '2026-08-20');
  const reports = [
    {
      type: 'PRINT',
      ts: new Date('2026-08-10T10:00:00+03:00').getTime(),
      data: { plaka: '03OLD100', firma: 'YD276(M) / LOT NO 26 07 44', bbt: '358' },
    },
    {
      type: 'PRINT',
      ts: new Date('2026-08-20T12:00:00+03:00').getTime(),
      data: { plaka: '03NEW200', firma: 'YD276(M) / LOT NO 26 07 44', bbt: '24' },
    },
  ];
  const out = core.applyExtraPrintsToPendingItems(pending, reports, {
    dateKey: '2026-08-20',
    fileName: '20.08.2026.xlsx + YD276 LOT 26 07 44 AVDAN.xlsx',
    files: ['20.08.2026.xlsx', 'YD276 LOT 26 07 44 AVDAN.xlsx'],
  });
  assert.equal(out[0].reportBbt, 24);
  assert.equal(out[0].excelDateKey, '2026-08-20');
  assert.equal(out[0].remainingBbt, 376);
});

test('rapordaki excelFileName başka dosyaysa bu bloğa yazılmaz', () => {
  const pending = core.analyzeNakliyePending([
    {
      blockKey: 'BLK_276',
      headerText: 'YD276(M) / LOT NO 26 07 44 / 400 BBT',
      ydKey: 'YD276',
      fileName: '20.08.2026.xlsx',
      _ihracatEmptyBlock: true,
    },
  ]);
  const reports = [
    {
      type: 'PRINT',
      ts: new Date('2026-08-20T12:00:00+03:00').getTime(),
      data: {
        plaka: '03OTH001',
        firma: 'YD276(M) / LOT NO 26 07 44',
        bbt: '200',
        excelFileName: 'eski-yd276.xlsx',
        excelDateKey: '2026-08-10',
      },
    },
  ];
  const out = core.applyExtraPrintsToPendingItems(pending, reports, { dateKey: '2026-08-20' });
  assert.equal(out[0].reportBbt, 0);
});

test('YD276 — iki Excel varsa sonraki gün yazdırma yeni karta gider', () => {
  const pending = core.analyzeNakliyePending([
    {
      blockKey: 'BLK_276A',
      headerText: 'YD276(M) / LOT NO 26 07 44 / HP 0,15-0,40 / 400 BBT',
      ydKey: 'YD276',
      fileName: '19.08.2026.xlsx',
      _ihracatEmptyBlock: true,
    },
    {
      blockKey: 'BLK_276B',
      headerText: 'YD276(M) / LOT NO 26 07 44 / HP 0,15-0,40 / 400 BBT',
      ydKey: 'YD276',
      fileName: '20.08.2026.xlsx',
      _ihracatEmptyBlock: true,
    },
  ]);
  const reports = [
    {
      type: 'PRINT',
      ts: new Date('2026-08-19T14:00:00+03:00').getTime(),
      data: { plaka: '03DAY190', firma: 'YD276(M) / LOT NO 26 07 44', bbt: '24', malzeme: 'HP 0,15-0,40' },
    },
    {
      type: 'PRINT',
      ts: new Date('2026-08-20T12:00:00+03:00').getTime(),
      data: { plaka: '03DAY200', firma: 'YD276(M) / LOT NO 26 07 44', bbt: '25', malzeme: 'HP 0,15-0,40' },
    },
    {
      type: 'PRINT',
      ts: new Date('2026-08-21T10:00:00+03:00').getTime(),
      data: { plaka: '03DAY210', firma: 'YD276(M) / LOT NO 26 07 44', bbt: '25', malzeme: 'HP 0,15-0,40' },
    },
  ];
  const out = core.applyExtraPrintsToPendingItems(pending, reports, {
    dateKey: '2026-08-20',
    fileName: '19.08.2026.xlsx + 20.08.2026.xlsx',
  });
  const oldCard = out.find((it) => /19\.08/.test(String(it.fileName || '')));
  const newCard = out.find((it) => /20\.08/.test(String(it.fileName || '')));
  assert.ok(oldCard && newCard);
  assert.equal(oldCard.reportBbt, 24);
  assert.equal(newCard.reportBbt, 50);
});

test('YD276 — çıkan 288/400 iken TAMAMLANDI yazılmaz', () => {
  const pending = core.analyzeNakliyePending(
    [
      {
        blockKey: 'BLK_276',
        headerText: 'YD276(M) / LOT NO 26 07 44 / HP 0,15-0,40 / 400 BBT',
        ydKey: 'YD276',
        fileName: '19.08.2026.xlsx',
        _ihracatEmptyBlock: true,
      },
    ],
    {},
    { includeComplete: true }
  );
  pending[0].departedBbt = 400;
  pending[0].remainingBbt = 0;
  pending[0].waitingPlates = [];
  pending[0].status = 'done';

  const reports = [];
  for (let i = 0; i < 12; i++) {
    reports.push({
      type: 'PRINT',
      ts: new Date('2026-08-19T12:00:00+03:00').getTime() + i * 60000,
      data: { plaka: '03SAM' + String(100 + i), firma: 'YD276(M) / LOT NO 26 07 44', bbt: '24', malzeme: 'HP 0,15-0,40' },
    });
  }
  const out = core.applyExtraPrintsToPendingItems(pending, reports, {
    dateKey: '2026-08-19',
    fileName: '19.08.2026.xlsx',
  });
  assert.equal(out[0].reportBbt, 288);
  assert.equal(out[0].shipmentDone, false);
  assert.equal(out[0].remainingBbt, 112);
  assert.equal(core.formatFooterStatusText(out[0]), '112 BBT DAHA PLAKA VERİLECEK');
  assert.match(core.formatCikanSuffix(out[0]), /çıkan 288\/400/);
});

test('çıkan 44/120 kartta ÇIKTI satırı yok, yazdırma sayısı durur', () => {
  const pending = core.analyzeNakliyePending([
    {
      blockKey: 'BLK_385',
      headerText: 'YD385(M) / LOT NO 26 07 24 / HP 0,074-0,30 / 120 BBT',
      ydKey: 'YD385',
      fileName: '18.08.2026.xlsx',
      _ihracatEmptyBlock: true,
    },
  ]);
  const reports = [
    {
      type: 'PRINT',
      ts: new Date('2026-08-18T10:00:00+03:00').getTime(),
      data: { plaka: '03AAA111', firma: 'YD385(M) / LOT NO 26 07 24', bbt: '24', malzeme: 'HP 0,074-0,30' },
    },
    {
      type: 'PRINT',
      ts: new Date('2026-08-18T11:00:00+03:00').getTime(),
      data: { plaka: '03BBB222', firma: 'YD385(M) / LOT NO 26 07 24', bbt: '20', malzeme: 'HP 0,074-0,30' },
    },
  ];
  const out = core.applyExtraPrintsToPendingItems(pending, reports, {
    dateKey: '2026-08-18',
    fileName: '18.08.2026.xlsx',
  });
  assert.equal(out[0].reportBbt, 44);
  assert.equal(out[0].shipmentDone, false);
  assert.equal(out[0].remainingBbt, 76);
  assert.equal(out[0].reportPlates.length, 2);
  const sheet = core.buildExcelBlockRows(out[0]);
  assert.equal(sheet.filter((r) => r.cikan || r.b === 'ÇIKTI').length, 0);
  assert.match(core.formatCikanSuffix(out[0]), /çıkan 44\/120/);
  assert.match(core.formatCikanSuffix(out[0]), /2 yazdırma/);
  assert.equal(core.formatFooterStatusText(out[0]), '76 BBT DAHA PLAKA VERİLECEK');
});

test('applyLiveDepartedMarks — forExcelDay ignores next-day print', () => {
  const meta = { dateKey: '2026-08-19', fileName: '19.08.2026.xlsx' };
  const rows = [
    { plaka: '03LAT100', bbt: '24', headerText: 'YD276(M) / LOT NO 26 07 44', ydKey: 'YD276' },
  ];
  const reports = [
    {
      type: 'PRINT',
      ts: new Date('2026-08-20T12:00:00+03:00').getTime(),
      data: { plaka: '03LAT100', firma: 'YD276(M) / LOT NO 26 07 44', bbt: '24' },
    },
  ];
  const wide = core.applyLiveDepartedMarks(rows, meta, reports, { forPending: true });
  assert.ok(core.isRowDeparted(wide[0]));
  const tight = core.applyLiveDepartedMarks(rows, meta, reports, { forExcelDay: true });
  assert.equal(core.isRowDeparted(tight[0]), false);
});

test('çıkan planı geçse bile sarı satırda plan üstü yazılmaz', () => {
  const pending = core.analyzeNakliyePending([
    {
      blockKey: 'BLK_276',
      headerText: 'YD276(M) / LOT NO 26 07 44 / 400 BBT',
      ydKey: 'YD276',
      fileName: '19.08.2026.xlsx',
      _ihracatEmptyBlock: true,
    },
  ]);
  const reports = [];
  for (let i = 0; i < 20; i++) {
    reports.push({
      type: 'PRINT',
      ts: new Date('2026-08-19T10:00:00+03:00').getTime() + i * 60000,
      data: { plaka: '03ZZ' + String(100 + i), firma: 'YD276(M) / LOT NO 26 07 44', bbt: '24' },
    });
  }
  const out = core.applyExtraPrintsToPendingItems(pending, reports, { dateKey: '2026-08-19' });
  assert.equal(out[0].shipmentDone, true);
  assert.equal(out[0].reportBbt, 400);
  assert.match(core.buildExcelBlockRows(out[0])[0].a, /çıkan 400\/400/);
});

test('YD276 — eski tarihli / başka dalga yazdırma 400 plana eklenmez', () => {
  const pending = core.analyzeNakliyePending([
    {
      blockKey: 'BLK_276',
      blockHeaderRow: 40,
      headerText: 'YD276(M) / LOT NO 26 07 44 / HP 0,15-0,40 / 400 BBT',
      ydKey: 'YD276',
      fileName: '20.08.2026.xlsx',
      _ihracatEmptyBlock: true,
    },
  ]);
  assert.equal(pending[0].planBbt, 400);
  const reports = [
    {
      type: 'PRINT',
      ts: new Date('2026-08-10T10:00:00+03:00').getTime(),
      data: { plaka: '03OLD100', firma: 'YD276(M) / LOT NO 26 07 44', bbt: '358', malzeme: 'HP 0,15-0,40' },
    },
    {
      type: 'PRINT',
      ts: new Date('2026-08-20T12:00:00+03:00').getTime(),
      data: { plaka: '03NEW200', firma: 'YD276(M) / LOT NO 26 07 44', bbt: '24', malzeme: 'HP 0,15-0,40' },
    },
    {
      type: 'PRINT',
      ts: new Date('2026-08-20T13:00:00+03:00').getTime(),
      data: { plaka: '03NEW200', firma: 'YD276(M) / LOT NO 26 07 44', bbt: '24', malzeme: 'HP 0,15-0,40' },
    },
  ];
  const out = core.applyExtraPrintsToPendingItems(pending, reports, {
    dateKey: '2026-08-20',
    importedAt: '2026-08-23T00:00:00.000Z',
  });
  assert.equal(out[0].reportBbt, 24);
  assert.equal(out[0].shipmentDone, false);
  assert.equal(out[0].remainingBbt, 376);
});

test('printDayMatchesExcelDate — aynı günün tamamı + ertesi gece, önceki akşam değil', () => {
  const d20 = '2026-08-20';
  assert.equal(core.printDayMatchesExcelDate(new Date('2026-08-20T02:00:00+03:00').getTime(), d20), true);
  assert.equal(core.printDayMatchesExcelDate(new Date('2026-08-20T10:00:00+03:00').getTime(), d20), true);
  assert.equal(core.printDayMatchesExcelDate(new Date('2026-08-20T19:00:00+03:00').getTime(), d20), true);
  assert.equal(core.printDayMatchesExcelDate(new Date('2026-08-21T02:00:00+03:00').getTime(), d20), true);
  assert.equal(core.printDayMatchesExcelDate(new Date('2026-08-19T19:00:00+03:00').getTime(), d20), false);
  assert.equal(core.printDayMatchesExcelDate(new Date('2026-08-21T10:00:00+03:00').getTime(), d20), false);
});

test('YD276 — Excel 14 yazdırıldı 2 bekliyor, önceki akşam 25 yazdırma olmaz', () => {
  const header = 'YD276(M) / LOT NO 26 07 44 / HP 0,15-0,40 / 400 BBT';
  const rows = [];
  for (let i = 0; i < 16; i++) {
    rows.push({
      blockKey: 'BLK_276',
      blockHeaderRow: 40,
      headerText: header,
      ydKey: 'YD276',
      fileName: '20.08.2026.xlsx',
      plaka: '03EXL' + String(100 + i),
      bbt: '25',
      gidenTonaj: '',
    });
  }
  const pending = core.analyzeNakliyePending(rows, { dateKey: '2026-08-20', fileName: '20.08.2026.xlsx' });
  assert.equal(pending[0].waitingPlates.length, 16);
  const reports = [];
  for (let i = 0; i < 14; i++) {
    reports.push({
      type: 'PRINT',
      ts: new Date('2026-08-20T10:00:00+03:00').getTime() + i * 60000,
      data: { plaka: '03EXL' + String(100 + i), firma: 'YD276(M) / LOT NO 26 07 44', bbt: '25', malzeme: 'HP 0,15-0,40' },
    });
  }
  for (let i = 0; i < 11; i++) {
    reports.push({
      type: 'PRINT',
      ts: new Date('2026-08-19T19:00:00+03:00').getTime() + i * 60000,
      data: { plaka: '03OLD' + String(200 + i), firma: 'YD276(M) / LOT NO 26 07 44', bbt: '25', malzeme: 'HP 0,15-0,40' },
    });
  }
  const out = core.applyExtraPrintsToPendingItems(pending, reports, {
    dateKey: '2026-08-20',
    fileName: '20.08.2026.xlsx',
  });
  assert.equal(out[0].excelPrintedCount, 14);
  assert.equal(out[0].excelWaitingCount, 2);
  assert.equal(out[0].reportPrintCount, 14);
  assert.equal(out[0].reportBbt, 350);
  assert.equal(out[0].shipmentDone, false);
  assert.equal(out[0].waitingPlates.length, 2);
  const suffix = core.formatCikanSuffix(out[0]);
  assert.match(suffix, /14 yazdırıldı/);
  assert.match(suffix, /2 bekliyor/);
  assert.equal(/25 yazdırma/.test(suffix), false);
  assert.notEqual(core.formatFooterStatusText(out[0]), 'TAMAMLANDI');
});

test('YD276 — Excel plakası sonraki gün yazdırıldıysa modal gibi yazdırıldı sayılır', () => {
  const header = 'YD276(M) / LOT NO 26 07 44 / HP 0,15-0,40 / 400 BBT';
  const rows = [];
  for (let i = 0; i < 16; i++) {
    rows.push({
      blockKey: 'BLK_276',
      blockHeaderRow: 40,
      headerText: header,
      ydKey: 'YD276',
      fileName: '20.08.2026.xlsx',
      plaka: '03EXL' + String(100 + i),
      bbt: '25',
      gidenTonaj: '',
    });
  }
  const pending = core.analyzeNakliyePending(rows, { dateKey: '2026-08-20', fileName: '20.08.2026.xlsx' });
  const reports = [];
  for (let i = 0; i < 8; i++) {
    reports.push({
      type: 'PRINT',
      ts: new Date('2026-08-20T10:00:00+03:00').getTime() + i * 60000,
      data: { plaka: '03EXL' + String(100 + i), firma: 'YD276(M) / LOT NO 26 07 44', bbt: '25', malzeme: 'HP 0,15-0,40' },
    });
  }
  for (let i = 8; i < 14; i++) {
    reports.push({
      type: 'PRINT',
      ts: new Date('2026-08-22T11:00:00+03:00').getTime() + i * 60000,
      data: { plaka: '03EXL' + String(100 + i), firma: 'YD276(M) / LOT NO 26 07 44', bbt: '25', malzeme: 'HP 0,15-0,40' },
    });
  }
  reports.push({
    type: 'PRINT',
    ts: new Date('2026-08-19T19:00:00+03:00').getTime(),
    data: { plaka: '03OLD999', firma: 'YD276(M) / LOT NO 26 07 44', bbt: '76', malzeme: 'HP 0,15-0,40' },
  });
  const out = core.applyExtraPrintsToPendingItems(pending, reports, {
    dateKey: '2026-08-20',
    fileName: '20.08.2026.xlsx',
  });
  assert.equal(out[0].excelPrintedCount, 14);
  assert.equal(out[0].excelWaitingCount, 2);
  assert.equal(out[0].reportBbt, 350);
  assert.equal(out[0].shipmentDone, false);
  const suffix = core.formatCikanSuffix(out[0]);
  assert.match(suffix, /14 yazdırıldı/);
  assert.match(suffix, /2 bekliyor/);
  assert.equal(/8 yazdırıldı/.test(suffix), false);
});

test('Excel günü 00:00-08:00 ek plaka önceki dalgadır, 20.08 kartına yazılmaz', () => {
  const pending = core.analyzeNakliyePending([
    {
      blockKey: 'BLK_276',
      headerText: 'YD276(M) / LOT NO 26 07 44 / HP 0,15-0,40 / 400 BBT',
      ydKey: 'YD276',
      fileName: '20.08.2026.xlsx',
      _ihracatEmptyBlock: true,
    },
  ]);
  const reports = [
    {
      type: 'PRINT',
      ts: new Date('2026-08-19T21:24:00.000Z').getTime(),
      data: { plaka: '03NIGHT1', firma: 'YD276(M) / LOT NO 26 07 44', bbt: '26', malzeme: 'HP 0,15-0,40' },
    },
    {
      type: 'PRINT',
      ts: new Date('2026-08-20T11:23:00+03:00').getTime(),
      data: { plaka: '43AFH436', firma: 'YD276(M) / LOT NO 26 07 44', bbt: '22', malzeme: 'HP 0,15-0,40' },
    },
  ];
  const out = core.applyExtraPrintsToPendingItems(pending, reports, {
    dateKey: '2026-08-20',
    fileName: '20.08.2026.xlsx',
  });
  assert.equal(out[0].reportBbt, 22);
  assert.equal(out[0].extraPlateCount, 1);
  assert.match(core.formatCikanSuffix(out[0]), /1 yazdırma/);
});

test('eski Excel + çıkışta yeni plaka kalandan düşer', () => {
  const header = 'YD276(M) / LOT NO 26 07 44 / HP 0,15-0,40 / 400 BBT';
  const rows = [];
  for (let i = 0; i < 16; i++) {
    rows.push({
      blockKey: 'BLK_276',
      blockHeaderRow: 40,
      headerText: header,
      ydKey: 'YD276',
      fileName: '20.08.2026.xlsx',
      plaka: '03EXL' + String(100 + i),
      bbt: '25',
      gidenTonaj: '',
    });
  }
  const pending = core.analyzeNakliyePending(rows, { dateKey: '2026-08-20', fileName: '20.08.2026.xlsx' });
  const reports = [];
  for (let i = 0; i < 14; i++) {
    reports.push({
      type: 'PRINT',
      ts: new Date('2026-08-20T10:00:00+03:00').getTime() + i * 60000,
      data: { plaka: '03EXL' + String(100 + i), firma: 'YD276(M) / LOT NO 26 07 44', bbt: '25', malzeme: 'HP 0,15-0,40' },
    });
  }
  reports.push({
    type: 'PRINT',
    ts: new Date('2026-08-22T15:00:00+03:00').getTime(),
    data: { plaka: '03YENI01', firma: 'YD276(M) / LOT NO 26 07 44', bbt: '25', malzeme: 'HP 0,15-0,40' },
  });
  const out = core.applyExtraPrintsToPendingItems(pending, reports, {
    dateKey: '2026-08-20',
    fileName: '20.08.2026.xlsx',
  });
  assert.equal(out[0].excelPrintedCount, 14);
  assert.equal(out[0].excelWaitingCount, 2);
  assert.equal(out[0].extraPlateCount, 1);
  assert.equal(out[0].reportBbt, 375);
  assert.equal(out[0].remainingBbt, 0);
  const suffix = core.formatCikanSuffix(out[0]);
  assert.match(suffix, /14 yazdırıldı/);
  assert.match(suffix, /2 bekliyor/);
  assert.match(suffix, /\+1 ek plaka/);
});

test('aynı plaka ikinci yazdırma BBT yi iki kez saymaz', () => {
  const pending = core.analyzeNakliyePending([
    {
      blockKey: 'BLK_20',
      headerText: 'YD33 / LOT NO 26 07 23 / 48 BBT',
      ydKey: 'YD33',
      _ihracatEmptyBlock: true,
    },
  ]);
  const reports = [
    { type: 'PRINT', ts: Date.now() - 1000, data: { plaka: '03AAA001', firma: 'YD33 / LOT NO 26 07 23', bbt: '24' } },
    { type: 'PRINT', ts: Date.now(), data: { plaka: '03AAA001', firma: 'YD33 / LOT NO 26 07 23', bbt: '24' } },
  ];
  const out = core.applyExtraPrintsToPendingItems(pending, reports, {});
  assert.equal(out[0].reportBbt, 24);
  assert.equal(out[0].remainingBbt, 24);
});

test('LOT lu blokta LOT suz YD yazdırması sayılmaz', () => {
  const pending = core.analyzeNakliyePending([
    {
      blockKey: 'BLK_276',
      headerText: 'YD276(M) / LOT NO 26 07 44 / 400 BBT',
      ydKey: 'YD276',
      _ihracatEmptyBlock: true,
    },
  ]);
  const reports = [
    { type: 'PRINT', ts: Date.now(), data: { plaka: '03XYZ001', firma: 'YD276(M)', bbt: '358', malzeme: 'HP 0,15-0,40' } },
  ];
  const out = core.applyExtraPrintsToPendingItems(pending, reports, {});
  assert.equal(out[0].reportBbt, 0);
  assert.equal(out[0].remainingBbt, 400);
});

test('YD50 — ACM çıktıysa 0PLAKA0 gelmeyene yazılmaz, kalan 20 BBT', () => {
  const meta = { importedAt: '2026-08-21T12:26:00.000Z', dateKey: '2026-08-21' };
  const header = 'YD50(G) / LOT NO 26 08 07 / HP 0,15-0,60 / 40 BBT';
  const rows = [
    { blockKey: 'B50', blockHeaderRow: 40, headerText: header, ydKey: 'YD50', plaka: '0PLAKA0', bbt: '20', gidenTonaj: '' },
  ];
  const reports = [
    {
      type: 'PRINT',
      ts: new Date('2026-08-21T19:00:00.000Z').getTime(),
      data: { plaka: '43ACM276', firma: 'YD50(G) / LOT NO 26 08 07', bbt: '20', malzeme: 'HP 0,15-0,60' },
    },
  ];
  const marked = core.applyLiveDepartedMarks(rows, meta, reports);
  let pending = core.analyzeNakliyePending(marked);
  pending = core.applyExtraPrintsToPendingItems(pending, reports, meta);
  assert.equal(pending.length, 1);
  assert.equal(pending[0].waitingPlates.length, 0);
  assert.equal(pending[0].remainingBbt, 20);
  const sheet = core.buildExcelBlockRows(pending[0]);
  assert.equal(sheet.some((r) => /0PLAKA0/i.test(String(r.a))), false);
  assert.match(sheet.find((r) => r.kind === 'pending').a, /20\s*BBT/i);
});


