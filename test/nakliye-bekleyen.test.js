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

test('isRowDeparted uses giden tonaj', () => {
  assert.equal(core.isRowDeparted({ gidenTonaj: '5.000' }), true);
  assert.equal(core.isRowDeparted({ gidenTonaj: '' }), false);
  assert.equal(core.isRowDeparted({ gidenTonaj: '0' }), false);
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

test('analyzeBlock — departed truck is hidden', () => {
  const item = core.analyzeBlock([
    { blockKey: 'Z', blockHeaderRow: 5, headerText: 'YD265 / 40 BBT', plaka: '03EA682', bbt: '20', gidenTonaj: '20' },
    { blockKey: 'Z', blockHeaderRow: 5, headerText: 'YD265 / 40 BBT', plaka: '03EA029', bbt: '20', gidenTonaj: '20' },
  ]);
  assert.equal(item, null);
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
      plaka: '64BE703',
      bbt: '4',
      gidenTonaj: '',
    },
  ];
  const reports = [
    {
      type: 'PRINT',
      ts: new Date('2026-07-15T10:00:00.000Z').getTime(),
      data: { plaka: '64BE703' },
    },
  ];
  const out = core.applyLiveDepartedMarks(rows, meta, reports);
  assert.ok(core.isRowDeparted(out[0]));
  assert.equal(core.analyzeBlock(out), null);
});

test('applyLiveDepartedMarks — çift kantar consumes one row at a time', () => {
  const meta = { importedAt: '2026-07-15T08:00:00.000Z' };
  const rows = [
    { blockKey: 'B1', headerText: 'YD82 / 4 BBT', plaka: '64BE703', bbt: '4', gidenTonaj: '' },
    { blockKey: 'B2', headerText: 'YD82 / 16 BBT', plaka: '64BE703', bbt: '16', gidenTonaj: '' },
  ];
  const reports = [
    {
      type: 'PRINT',
      ts: new Date('2026-07-15T10:00:00.000Z').getTime(),
      data: { plaka: '64BE703' },
    },
  ];
  const out = core.applyLiveDepartedMarks(rows, meta, reports);
  assert.ok(core.isRowDeparted(out[0]));
  assert.equal(core.isRowDeparted(out[1]), false);
  const pending = core.analyzeNakliyePending(out);
  assert.equal(pending.length, 1);
  assert.equal(pending[0].planBbt, 16);
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
    { blockKey: 'B1', blockHeaderRow: 10, headerText: 'YD82 / 4 BBT', plaka: '64BE703', bbt: '4', gidenTonaj: '4' },
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

test('buildExcelSheetParts — özmal plates appear inside their shipment block', () => {
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
  const parts = core.buildExcelSheetParts([item]);
  assert.equal(parts.ozmalRows.length, 0);
  const hdrIdx = parts.nakliyeRows.findIndex((r) => r.kind === 'header');
  assert.ok(hdrIdx >= 0);
  const ozmalRow = parts.nakliyeRows.find((r) => r.a === '43ADT550');
  assert.ok(ozmalRow);
  assert.equal(ozmalRow.b, core.OZMAL_VEHICLE_LABEL);
  assert.equal(ozmalRow.ozmal, true);
  const waitingRow = parts.nakliyeRows.find((r) => r.a === '43VE530');
  assert.ok(waitingRow);
  assert.ok(parts.nakliyeRows.indexOf(ozmalRow) > hdrIdx);
  assert.ok(parts.nakliyeRows.indexOf(waitingRow) > parts.nakliyeRows.indexOf(ozmalRow));
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
      plaka: '43 ADT 550',
      sira: '18',
      bbt: '20',
      gidenTonaj: '',
    },
    {
      blockKey: 'Y',
      headerText: 'YD20 / 360 BBT',
      plaka: '43 ADT 553',
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
});

test('buildExcelBlockRows — başşoför plate shows BAŞŞOFÖR label under block', () => {
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
  const rows = core.buildExcelBlockRows(item);
  const ozmalRow = rows.find((r) => r.a === '43ADS408');
  assert.ok(ozmalRow);
  assert.equal(ozmalRow.b, 'BAŞŞOFÖR');
  assert.equal(ozmalRow.bassofor, true);
});
