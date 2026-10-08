const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ExcelUtils = require('../lib/excel-utils');

function loadPiyasaOrders() {
  const code = fs.readFileSync(path.join(__dirname, '../public/modules/piyasa-orders.js'), 'utf8');
  const context = {
    XLSX: {
      utils: {
        sheet_to_json(ws) { return ws._grid; },
        decode_range(ref) {
          const cell = (a) => {
            const m = String(a).match(/^([A-Z]+)(\d+)$/);
            return { c: m[1].charCodeAt(0) - 65, r: parseInt(m[2], 10) - 1 };
          };
          const [s, e] = String(ref).split(':');
          return { s: cell(s), e: cell(e) };
        },
        encode_cell(addr) {
          return String.fromCharCode(65 + addr.c) + (addr.r + 1);
        },
      },
    },
    eu: () => ExcelUtils,
    console,
  };
  vm.createContext(context);
  vm.runInContext(code, context);
  return context;
}

const api = loadPiyasaOrders();

test('boş açıklama yan sütundaki metni almaz', () => {
  assert.equal(api.pickAciklama({
    AÇIKLAMA: '',
    KONTROL: 'başka satırın notu',
    __COL_21: 'V sütunu',
  }), '');
  assert.equal(api.pickAciklama({
    AÇIKLAMA: 'kendi notu',
    KONTROL: 'başka',
  }), 'kendi notu');
});

test('açıklama sütunu yoksa yalnızca not veya V sütunu', () => {
  assert.equal(api.pickAciklama({ 'YÜKLEME NOTU': 'not satırı', KONTROL: 'yok' }), 'not satırı');
  const row = { KONTROL: 'kontrol metni' };
  row.__COL_21 = 'V notu';
  assert.equal(api.pickAciklama(row), 'V notu');
});

test('güncellemede her satır kendi görünen açıklamasını alır', () => {
  const grid = [
    ['FİRMA', 'MALZEME', 'AÇIKLAMA', 'KONTROL'],
    ['HP1', 'PERLIT', 'NOT A', 'X'],
    ['HP2', 'PERLIT', '', 'YANLIS'],
    ['HP3', 'PERLIT', 'ORTAK NOT', ''],
    ['HP4', 'PERLIT', '', 'BASKA SATIR'],
    ['HP5', 'PERLIT', 'KENDI NOTU', ''],
    ['HP6', 'PERLIT', 'SAHTE', ''],
  ];
  const ws = {
    '!ref': 'A1:D7',
    '!merges': [
      { s: { r: 3, c: 2 }, e: { r: 4, c: 2 } },
      { s: { r: 6, c: 1 }, e: { r: 6, c: 2 } },
    ],
    _grid: grid,
  };
  const raw = api.parseSheetSmart(ws);
  const { orders } = api.normalizeRows(raw, raw.__parseMeta);
  const byFirma = Object.fromEntries(orders.map((o) => [o.firma, o.aciklama]));
  assert.equal(byFirma.HP1, 'NOT A');
  assert.equal(byFirma.HP2, '');
  assert.equal(byFirma.HP3, 'ORTAK NOT');
  assert.equal(byFirma.HP4, 'ORTAK NOT');
  assert.equal(byFirma.HP5, 'KENDI NOTU');
  assert.equal(byFirma.HP6, '');
});

test('excel filtresiyle gizlenen satır da yüklenir', () => {
  const grid = [
    ['FİRMA', 'MALZEME', 'MİKTAR', 'AÇIKLAMA'],
    ['HP1', 'PERLIT', '10', 'görünen'],
    ['HP2', 'PERLIT', '20', 'filtreli'],
    ['HP3', 'PERLIT', '30', 'görünen 2'],
  ];
  const ws = {
    '!ref': 'A1:D4',
    '!autofilter': { ref: 'A1:D4' },
    '!rows': [null, null, { hidden: true }, null],
    _grid: grid,
  };
  const raw = api.parseSheetSmart(ws);
  const firmas = Array.from(raw).map((r) => r.FİRMA);
  assert.equal(firmas.join('|'), 'HP1|HP2|HP3');
  assert.equal(raw.__parseMeta.hiddenSkipped, 0);
  const { orders } = api.normalizeRows(raw, raw.__parseMeta);
  assert.equal(Array.from(orders).map((o) => o.firma).join('|'), 'HP1|HP2|HP3');
  assert.equal(orders[1].aciklama, 'filtreli');
});
