'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const core = require('../public/nakliye-bekleyen-core.js');

function loadParser() {
  const code = fs.readFileSync(
    path.join(__dirname, '../public/modules/app-excel-ihracat.js'),
    'utf8'
  );
  const sandbox = {
    console,
    document: { getElementById() { return null; }, addEventListener() {} },
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.addEventListener = () => {};
  vm.createContext(sandbox);
  vm.runInContext(
    `function _safeStr(x){ return (x==null)?'':String(x); }
function _rowToText(row){
  if (!row || !Array.isArray(row)) return '';
  return row.map(v => _safeStr(v).replace(/\\s+/g,' ').trim()).filter(Boolean).join(' ');
}
` + code,
    sandbox
  );
  return sandbox;
}

function parseGrid(parser, grid) {
  parser.XLSX = { utils: { sheet_to_json() { return grid; } } };
  return parser.parseIhracatRowsFromWorkbook({ Sheets: { S: {} }, SheetNames: ['S'] }, 'S', {
    fileName: '22.09.2026.xlsx',
  });
}

test('sıra başlığı 100 olan blokta dolu giden kg gelmeyen sayılmaz', () => {
  const parser = loadParser();
  const yd = 'YD05(M) / LOT NO 26 08 16 / HP007030-B16-03 / 600 BBT / BOOKING NO : 6466356430 / SAFIPORT';
  const grid = [
    ['İHRACAT TAKİP LİSTESİ'],
    ['AKYÜZ', yd],
    ['', 'LİMAN DOLUM TARİHİ : 21.09.2026 PAZARTESİ'],
    ['', '100', 'PLAKA', 'BBT', 'ÇUVAL', 'PALET', 'BOŞ BBT', 'BOŞ ÇUVAL', 'NET TONAJ', 'O.GR. TONAJ', 'GİDEN TONAJ', 'FARK', '', 'YÜKLEME YERİ'],
    ['R01202609025', '1', '43AEA633', 24, '', '', 1, '', 31.2, 31.26, 31.4, 140, '', 'AVDAN'],
    ['R01202609026', '2', '03F1924', 25, '', '', 1, '', 32.5, 32.56, 32.72, 160, '', 'AVDAN'],
    ['R01202609034', '10', '43AE599', 23, '', '', 1, '', 29.5, 29.54, '', -40, '', '1.OSB'],
    ['', '', 'TOPLAM', 600],
  ];
  const parsed = parseGrid(parser, grid);
  assert.equal(parsed.ok, true, parsed.msg);
  const byPlate = Object.fromEntries((parsed.rows || []).map((r) => [String(r.plaka || '').replace(/\s+/g, ''), r]));
  assert.equal(core.isRowDeparted(byPlate['43AEA633']), true);
  assert.equal(core.isRowDeparted(byPlate['03F1924']), true);
  assert.equal(core.isRowDeparted(byPlate['43AE599']), false);
  const pending = core.analyzeNakliyePending(parsed.rows);
  const plates = (pending[0] && pending[0].waitingPlates ? pending[0].waitingPlates : []).map((p) =>
    String(p.plaka || '').replace(/\s+/g, '')
  );
  assert.deepEqual(plates, ['43AE599']);
});
