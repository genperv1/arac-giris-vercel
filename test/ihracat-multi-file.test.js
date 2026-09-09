'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const code = fs.readFileSync(
  path.join(__dirname, '../public/modules/app-excel-ihracat.js'),
  'utf8'
);
const start = code.indexOf('function splitIhracatFileNames');
const end = code.indexOf('function countIhracatRowsForSource');
const wrapped = `(function(){\nconst loadDailyShipments=()=>[];\nconst loadDailyMeta=()=>({});\n${code.slice(start, end)}\nreturn { splitIhracatFileNames, normalizeIhracatMetaFiles, listIhracatExcelSources, repairIhracatRowFileNames, mergeIhracatImportState };})()`;
const api = eval(wrapped);

test('normalizeIhracatMetaFiles splits combined meta.fileName and meta.files entries', () => {
  const files = api.normalizeIhracatMetaFiles({
    fileName: '20.07.2026.xlsx + YD33 (1).xlsx',
    files: ['20.07.2026.xlsx + YD33 (1).xlsx', 'YD33 (1).xlsx'],
  });
  assert.deepEqual(files, ['20.07.2026.xlsx', 'YD33 (1).xlsx']);
});

test('repairIhracatRowFileNames fixes rows that inherited combined meta.fileName', () => {
  const rows = [
    {
      fileName: '20.07.2026.xlsx',
      blockKey: 'BLK_20',
      blockHeaderRow: 20,
      headerText: 'YD113',
      plaka: '03AIT034',
    },
    {
      fileName: '20.07.2026.xlsx + YD33 (1).xlsx',
      blockKey: 'BLK_5',
      blockHeaderRow: 5,
      headerText: 'YD331',
      _ihracatEmptyBlock: true,
      plaka: '',
    },
  ];
  const meta = {
    fileName: '20.07.2026.xlsx + YD33 (1).xlsx',
    files: ['20.07.2026.xlsx + YD33 (1).xlsx', 'YD33 (1).xlsx'],
  };
  const repaired = api.repairIhracatRowFileNames(rows, meta);
  assert.equal(repaired.changed, true);
  assert.deepEqual(repaired.meta.files, ['20.07.2026.xlsx', 'YD33 (1).xlsx']);
  assert.equal(repaired.rows[1].fileName, '20.07.2026.xlsx');
});

test('mergeIhracatImportState appends a second Excel instead of replacing the first', () => {
  const first = [{ fileName: '20.07.2026.xlsx', blockKey: 'BLK_20', plaka: '03AIT034', sira: '1' }];
  const second = [{ fileName: 'YD33 (1).xlsx', blockKey: 'BLK_5', plaka: '34ABC123', sira: '1' }];
  const merged = api.mergeIhracatImportState(
    first,
    { fileName: '20.07.2026.xlsx', files: ['20.07.2026.xlsx'] },
    second,
    { fileName: 'YD33 (1).xlsx', sheetName: 'Sayfa1' },
    { name: 'YD33 (1).xlsx' }
  );
  assert.equal(merged.rows.length, 2);
  assert.deepEqual(merged.rows.map((r) => r.fileName).sort(), ['20.07.2026.xlsx', 'YD33 (1).xlsx']);
  assert.deepEqual(merged.meta.files, ['20.07.2026.xlsx', 'YD33 (1).xlsx']);
  assert.equal(merged.meta.fileName, '20.07.2026.xlsx + YD33 (1).xlsx');
  assert.equal(merged.fileCount, 2);
});

test('mergeIhracatImportState replaces only the re-uploaded file', () => {
  const existing = [
    { fileName: 'a.xlsx', blockKey: 'BLK_1', plaka: '01AAA01', sira: '1' },
    { fileName: 'b.xlsx', blockKey: 'BLK_2', plaka: '02BBB02', sira: '1' },
  ];
  const incoming = [{ fileName: 'b.xlsx', blockKey: 'BLK_9', plaka: '09CCC09', sira: '3' }];
  const merged = api.mergeIhracatImportState(
    existing,
    { fileName: 'a.xlsx + b.xlsx', files: ['a.xlsx', 'b.xlsx'] },
    incoming,
    { fileName: 'b.xlsx' },
    { name: 'b.xlsx' }
  );
  assert.equal(merged.rows.length, 2);
  assert.equal(merged.rows.find((r) => r.fileName === 'a.xlsx').plaka, '01AAA01');
  assert.equal(merged.rows.find((r) => r.fileName === 'b.xlsx').plaka, '09CCC09');
  assert.deepEqual(merged.meta.files, ['a.xlsx', 'b.xlsx']);
});

test('mergeIhracatImportState stacks a third Excel on top of two', () => {
  const existing = [
    { fileName: 'a.xlsx', blockKey: 'BLK_1', plaka: '01AAA01', sira: '1' },
    { fileName: 'b.xlsx', blockKey: 'BLK_2', plaka: '02BBB02', sira: '1' },
  ];
  const incoming = [{ fileName: 'c.xlsx', blockKey: 'BLK_3', plaka: '03CCC03', sira: '1' }];
  const merged = api.mergeIhracatImportState(
    existing,
    { fileName: 'a.xlsx + b.xlsx', files: ['a.xlsx', 'b.xlsx'] },
    incoming,
    { fileName: 'c.xlsx' },
    { name: 'c.xlsx' }
  );
  assert.equal(merged.rows.length, 3);
  assert.deepEqual(merged.meta.files, ['a.xlsx', 'b.xlsx', 'c.xlsx']);
  assert.equal(merged.fileCount, 3);
});
