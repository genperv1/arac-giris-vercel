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
const wrapped = `(function(){\nconst loadDailyShipments=()=>[];\nconst loadDailyMeta=()=>({});\n${code.slice(start, end)}\nreturn { splitIhracatFileNames, normalizeIhracatMetaFiles, listIhracatExcelSources, repairIhracatRowFileNames };})()`;
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
