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

test('üst sevkiyatın başlığı alttaki 10 tonu yutmaz', () => {
  const parser = loadParser();
  const big = 'YD200(M) / LOT NO 26 09 01 / HP 0,074-0,30 / 200 TON / NET 1000 KG / 400 BBT / BOOKING NO : BIG001 / YILPORT';
  const small = 'YD107(M) / LOT NO 26 09 23 / HP 0,074-0,30 / 10 TON / YILPORT';
  const cols = ['', 'PLAKA', 'BBT', 'ÇUVAL', 'PALET', 'BOŞ BBT', 'BOŞ ÇUVAL', 'NET TONAJ', 'O.GR. TONAJ', 'GİDEN TONAJ', 'FARK', 'YÜKLEME YERİ'];
  const grid = [
    [big],
    cols,
    ['1', '43AAA01', 10, '', '', '', '', 10000, 10100, 10000, '', 'AVDAN'],
    ['', 'TOPLAM', 10, '', '', '', '', 10000, 10100, 10000],
    ['', 'KALAN'],
    [small],
    cols,
    ['1', '43BBB02', 10, '', '', '', '', 10000, 10200, '', '', 'AVDAN'],
    ['', 'TOPLAM', 10, '', '', '', '', 10000, 10200, ''],
  ];
  const parsed = parseGrid(parser, grid);
  assert.equal(parsed.ok, true, parsed.msg);
  const rows = (parsed.rows || []).filter((r) => r.plaka);
  const a = rows.find((r) => String(r.plaka).replace(/\s+/g, '').includes('43AAA01'));
  const b = rows.find((r) => String(r.plaka).replace(/\s+/g, '').includes('43BBB02'));
  assert.ok(a && b);
  assert.match(a.headerText, /200 TON/);
  assert.match(b.headerText, /10 TON/);
  assert.doesNotMatch(b.headerText, /200 TON/);
  assert.equal(String(a.netTonaj), '10000');
  assert.equal(String(b.netTonaj), '10000');
  const ten = rows.filter((r) => /10 TON/.test(r.headerText) && !/200 TON/.test(r.headerText));
  const sum = ten.reduce((s, r) => s + Number(r.netTonaj || 0), 0);
  assert.equal(sum, 10000);
});
