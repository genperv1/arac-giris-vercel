'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const api = require('../public/modules/akyuz-liste');

test('extractUnitKg reads NET 1350 KG pack text', () => {
  assert.equal(api.extractUnitKg('NET 1350 KG BİGBAG - GPM6-2 - ÜSTÜ AÇIK BASKILI'), 1350);
  assert.equal(api.extractUnitKg(1350), 1350);
  assert.equal(api.extractUnitKg('1200'), 1200);
});

test('GPM-AKYÜZ becomes AKYÜZ', () => {
  assert.equal(api.shortenTedarikci('GPM-AKYÜZ'), 'AKYÜZ');
  assert.equal(api.shortenTedarikci('AKYÜZ'), 'AKYÜZ');
});

test('üstü açık / GPM6 maps to 1.OSB, others AVDAN', () => {
  assert.equal(api.inferYuklemeYeri('NET 1350 KG BİGBAG - GPM6-2 - ÜSTÜ AÇIK BASKILI'), '1.OSB');
  assert.equal(api.inferYuklemeYeri('NET 1300 KG BASKISIZ LİNEERLİ-GPM5'), 'AVDAN');
});

test('palet count replaces çuval when palet × kg matches tonaj', () => {
  const out = api.transformRow({
    tedarikci: 'AKYÜZ',
    sevkTarihText: '16 Eylül 2026 Çarşamba',
    firma: 'YD359(G)',
    lot: 'LOT NO 26 09 04',
    tonaj: 270,
    birimAmbalaj: 'NET 1350 KG BİGBAG - GPM6-2 - ÜSTÜ AÇIK BASKILI',
    ambalajSayisi: 10800,
    ambalajTipi: 'NET 1350 KG BİGBAG - GPM6-2 - ÜSTÜ AÇIK BASKILI',
    paletSayisi: 200,
    liman: 'DP WORLD',
    yuklemeYeri: ''
  }, { fillYukleme: true, addPaletNote: true });
  assert.equal(out.birimKg, 1350);
  assert.equal(out.ambalajSayisi, 200);
  assert.equal(out.paletSayisi, '');
  assert.equal(out.ambalajTipi, '');
  assert.equal(out.yuklemeYeri, '1.OSB');
});

test('real olan.xlsx becomes the daily Akyüz list', () => {
  const sample = 'C:/Users/Engoo/Downloads/olan.xlsx';
  if (!fs.existsSync(sample)) {
    assert.ok(true, 'sample missing — skip');
    return;
  }
  const XLSX = require('xlsx');
  const wb = XLSX.readFile(sample, { cellDates: false });
  const grid = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], {
    header: 1, defval: '', blankrows: false, raw: true
  });
  const solved = api.solveGrid(grid, { asOf: { y: 2026, m: 9, d: 15 } });
  assert.equal(solved.ok, true);
  assert.equal(solved.rows.length, 8);
  assert.equal(solved.dropped, 6);
  assert.equal(solved.rows[0].sira, '1');
  assert.equal(solved.rows[0].firma, 'YD359(G)');
  assert.equal(solved.rows[0].birimKg, 1350);
  assert.equal(solved.rows[0].ambalajSayisi, 200);
  assert.equal(solved.rows[0].paletSayisi, '');
  assert.equal(solved.rows[0].yuklemeYeri, '1.OSB');
  assert.equal(solved.rows[1].firma, 'YD25(M)');
  assert.equal(solved.rows[1].birimKg, 1200);
  assert.equal(solved.rows[1].ambalajSayisi, 4);
  assert.equal(solved.rows[1].paletSayisi, 2);
  assert.equal(solved.rows[1].ambalajTipi, api.PALET_ARAC_NOTU);
  assert.equal(solved.rows[1].yuklemeYeri, 'AVDAN');
  assert.equal(solved.rows[3].firma, 'YD191(G)');
  assert.equal(solved.rows[3].yuklemeYeri, 'AVDAN');
  assert.equal(solved.rows[4].firma, 'YD81(M)');
  assert.equal(solved.rows[4].yuklemeYeri, '');
  assert.equal(solved.rows[4].ambalajTipi, '');
  assert.equal(solved.rows[7].sira, '8');
  assert.equal(solved.rows[7].firma, 'YD05(M)');
});

test('güncel ihracat list maps into the Akyüz form columns', () => {
  const grid = [
    ['28.09.2026 GÜNCEL İHRACAT LİSTESİ'],
    ['Revizyon No;1'],
    ['TEDARİKÇİ', 'İŞ TAKİP', 'SIRA', 'NETSIS SİPARİŞ NO', 'HAFTA', 'GENPER ÇIKIŞ TARİHİ', 'MÜŞTERİ', 'MÜŞTERİ KODU', 'NETSİS STOK KODU', 'ÜRÜN', 'MT', 'AMBALAJ', 'Bigbag/Çuval', 'PALET', 'ADET', 'GİDECEĞİ LİMAN', 'AÇIKLAMA', 'SPEK', 'SEKTÖR', 'BOOKİNG NO', 'GEMİ DETAYI', 'LİMAN DOLUM TARİHİ', 'SİPARİŞ TARİHİ', 'YÜKELEM YERİ'],
    ['AKYÜZ', '', 8, 'M1', '40.hafta', '28 Eylül 2026 Pazartesi', 'YD20(M)', 'LOT NO 26 08 26', '', '', 500, 'NET 1250 KG BASKISIZ LİNEERLİ-GPM5', 400, '', '', 'DP WORLD', '', '', '', 21644414, 'MAERSK SIRAC 639S', 46294, 46289, ''],
    ['GPM', '', 1, 'M2', '40.hafta', '28 Eylül 2026 Pazartesi', 'YD99(M)', 'LOT X', '', '', 10, 'NET 1000 KG', 8, '', '', 'EVYAP', '', '', '', 'B1', 'GEMI', 46294, '', ''],
    ['AKYÜZ', '', 9, 'M3', '40.hafta', '28 Eylül 2026 Pazartesi', 'YD92(M)', 'LOT NO 26 08 10', '', '', 230, 'NET 1150 KG BİGBAG', 200, 'ÇİFT MÜHÜRLÜ', 100, 'EVYAP', '', '', '', 'ISTG17830300', 'GT640E', 46294, '', ''],
    ['AKYÜZ', '', 15, 'M4', '40.hafta', '1 Ekim 2026 Perşembe', 'YD256', 'LOT NO 26 09 26', '', '', 125, 'NET 1250 KG', 100, '', '', 'EVYAP', '', '', '', 'ISTG18234900', 'MSC', 46297, '', '']
  ];
  const mapped = api.mapShipmentGrid(grid, { asOf: { y: 2026, m: 9, d: 28 }, dropToday: false });
  assert.equal(mapped.ok, true);
  assert.equal(mapped.kind, 'guncel');
  assert.equal(mapped.rows.length, 3);
  assert.equal(mapped.removedSuppliers, 1);
  assert.equal(mapped.rows[0].firma, 'YD20(M)');
  assert.equal(mapped.rows[0].birimText, 'NET 1250 KG BASKISIZ LİNEERLİ-GPM5');
  assert.equal(mapped.rows[0].ambalajTipi, mapped.rows[0].birimText);
  assert.equal(mapped.rows[0].ambalajSayisi, 400);
  assert.equal(mapped.rows[0].paletSayisi, '');
  assert.equal(mapped.rows[0].fatura, api.FATURA_GENPER);
  assert.equal(mapped.rows[0].bookingNo, 21644414);
  assert.equal(mapped.rows[0].limanDolum, 46294);
  assert.equal(mapped.rows[0].excelSira, '');
  assert.equal(mapped.rows[1].paletSayisi, 100);
  assert.equal(mapped.rows[2].fatura, '');
  assert.equal(mapped.rows[2].firma, 'YD256');
});

test('filled workbook keeps the sevk form layout', async () => {
  const templatePath = path.join(__dirname, '../public/assets/akyuz-sevk-formu.xlsx');
  const template = fs.readFileSync(templatePath);
  const grid = [
    ['TEDARİKÇİ', 'GENPER ÇIKIŞ TARİHİ', 'MÜŞTERİ', 'MÜŞTERİ KODU', 'MT', 'AMBALAJ', 'Bigbag/Çuval', 'PALET', 'ADET', 'GİDECEĞİ LİMAN', 'BOOKİNG NO', 'GEMİ DETAYI', 'LİMAN DOLUM TARİHİ'],
    ['AKYÜZ', '28 Eylül 2026 Pazartesi', 'YD20(M)', 'LOT NO 26 08 26', 500, 'NET 1250 KG BASKISIZ', 400, '', '', 'DP WORLD', 21644414, 'MAERSK SIRAC 639S', 46294],
    ['AKYÜZ', '29 Eylül 2026 Salı', 'YD92(M)', 'LOT NO 26 08 10', 230, 'NET 1150 KG BİGBAG', 200, 'ÇİFT MÜHÜRLÜ', 100, 'EVYAP', 'ISTG17830300', 'GT640E', 46294]
  ];
  const mapped = api.mapShipmentGrid(grid, { asOf: { y: 2026, m: 9, d: 28 }, dropToday: false });
  assert.equal(mapped.rows.length, 2);
  const out = await api.fillAkyuzWorkbook(template, mapped.rows);
  const XLSX = require('../public/vendor/xlsx.full.min.js');
  const wb = XLSX.read(Buffer.from(out), { type: 'buffer', cellFormula: true });
  assert.equal(wb.SheetNames[0], 'AKYÜZ');
  const ws = wb.Sheets.AKYÜZ;
  const g = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: true });
  assert.equal(g[0][0], 'SIRA');
  assert.equal(g[0][1], 'TEDARİKÇİ');
  assert.equal(g[0][16], 'GEMİ ADI');
  assert.equal(g[1][0], '');
  assert.equal(g[1][1], 'AKYÜZ');
  assert.equal(g[1][3], 'YD20(M)');
  assert.equal(g[1][5], 500);
  assert.equal(g[1][7], 400);
  assert.equal(g[1][8], 'NET 1250 KG BASKISIZ');
  assert.equal(g[1][9], '');
  assert.equal(g[1][14], api.FATURA_GENPER);
  assert.equal(g[2][9], 100);
  assert.equal(g[3][0], 'Toplam');
  assert.match(String(ws.F4.f), /SUBTOTAL\(109,AKYÜZ\[TONAJ\]\)/);
  const flat = g.flat().map((cell) => String(cell));
  assert.ok(flat.some((cell) => cell.indexOf('GENEL HATIRLATMA') >= 0));
  const zlib = require('zlib');
  const packed = Buffer.from(out);
  let eocd = packed.length - 22;
  while (eocd > 0 && packed.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  const count = packed.readUInt16LE(eocd + 10);
  let cursor = packed.readUInt32LE(eocd + 16);
  let sheetXml = '';
  for (let i = 0; i < count; i++) {
    const method = packed.readUInt16LE(cursor + 10);
    const compSize = packed.readUInt32LE(cursor + 20);
    const nameLen = packed.readUInt16LE(cursor + 28);
    const extraLen = packed.readUInt16LE(cursor + 30);
    const commentLen = packed.readUInt16LE(cursor + 32);
    const localOff = packed.readUInt32LE(cursor + 42);
    const name = packed.slice(cursor + 46, cursor + 46 + nameLen).toString('utf8');
    cursor += 46 + nameLen + extraLen + commentLen;
    if (name !== 'xl/worksheets/sheet1.xml') continue;
    const nameLenLocal = packed.readUInt16LE(localOff + 26);
    const extraLenLocal = packed.readUInt16LE(localOff + 28);
    const start = localOff + 30 + nameLenLocal + extraLenLocal;
    const comp = packed.slice(start, start + compSize);
    sheetXml = (method === 8 ? zlib.inflateRawSync(comp) : comp).toString('utf8');
  }
  assert.match(sheetXml, /width="17\.7109375"/);
  assert.match(sheetXml, /mergeCell ref="C6:O6"/);
  assert.match(sheetXml, /sqref="A1"/);
  assert.doesNotMatch(sheetXml, /XFD/);
  assert.doesNotMatch(sheetXml, /max="16384"/);
  assert.doesNotMatch(sheetXml, /printerSettings/);
});

test('real güncel list becomes the Akyüz sevk form', async () => {
  const dir = 'C:/Users/Engoo/Desktop';
  if (!fs.existsSync(dir)) return;
  const root = fs.readdirSync(dir).find((name) => name.toLowerCase().includes('sevk'));
  if (!root) return;
  function walk(folder, acc) {
    for (const name of fs.readdirSync(folder)) {
      if (name.startsWith('~$')) continue;
      const full = path.join(folder, name);
      if (fs.statSync(full).isDirectory()) walk(full, acc);
      else acc.push(full);
    }
    return acc;
  }
  const files = walk(path.join(dir, root), []);
  const src = files.find((file) => /Güncel/.test(path.basename(file)) && file.endsWith('.xlsx'));
  const ref = files.find((file) => /^AKY/i.test(path.basename(file)) && file.endsWith('.xlsx'));
  if (!src || !ref) return;
  const XLSX = require('../public/vendor/xlsx.full.min.js');
  const srcWb = XLSX.read(fs.readFileSync(src), { type: 'buffer', cellDates: false });
  const grid = XLSX.utils.sheet_to_json(srcWb.Sheets['GÜNCEL'], { header: 1, defval: '', raw: true });
  const mapped = api.mapShipmentGrid(grid, { asOf: { y: 2026, m: 9, d: 28 }, dropToday: false });
  assert.equal(mapped.ok, true);
  assert.equal(mapped.rows.length, 18);
  const template = fs.readFileSync(path.join(__dirname, '../public/assets/akyuz-sevk-formu.xlsx'));
  const out = await api.fillAkyuzWorkbook(template, mapped.rows);
  const outWb = XLSX.read(Buffer.from(out), { type: 'buffer', cellDates: false });
  const got = XLSX.utils.sheet_to_json(outWb.Sheets[outWb.SheetNames[0]], { header: 1, defval: '', raw: true });
  const refWb = XLSX.read(fs.readFileSync(ref), { type: 'buffer', cellDates: false });
  const exp = XLSX.utils.sheet_to_json(refWb.Sheets.AKYÜZ, { header: 1, defval: '', raw: true });
  for (let i = 0; i < 18; i++) {
    assert.equal(String(got[i + 1][1]).trim(), String(exp[i + 1][1]).trim(), 'tedarikci ' + i);
    assert.equal(String(got[i + 1][2]).trim(), String(exp[i + 1][2]).trim(), 'sevk ' + i);
    assert.equal(String(got[i + 1][3]).trim(), String(exp[i + 1][3]).trim(), 'firma ' + i);
    assert.equal(String(got[i + 1][4]).trim(), String(exp[i + 1][4]).trim(), 'lot ' + i);
    assert.equal(Number(got[i + 1][5]), Number(exp[i + 1][5]), 'tonaj ' + i);
    assert.equal(String(got[i + 1][6]).trim(), String(exp[i + 1][6]).trim(), 'ambalaj ' + i);
    assert.equal(String(got[i + 1][7]), String(exp[i + 1][7]), 'sayi ' + i);
    assert.equal(String(got[i + 1][8]).trim(), String(exp[i + 1][8]).trim(), 'tip ' + i);
    assert.equal(String(got[i + 1][9]), String(exp[i + 1][9]), 'palet ' + i);
    assert.equal(String(got[i + 1][10]).trim(), String(exp[i + 1][10]).trim(), 'liman ' + i);
    assert.equal(String(got[i + 1][15]), String(exp[i + 1][15]), 'booking ' + i);
    assert.equal(String(got[i + 1][16]).trim(), String(exp[i + 1][16]).trim(), 'gemi ' + i);
  }
  assert.equal(String(got[19][0]), 'Toplam');
});

test('İhracat Takip hub opens Akyüz liste', () => {
  const hub = fs.readFileSync(path.join(__dirname, '../public/ihracat-takip.html'), 'utf8');
  assert.match(hub, /akyuz-liste\.html/);
  assert.match(hub, /Akyüz liste/);
  const page = fs.readFileSync(path.join(__dirname, '../public/akyuz-liste.html'), 'utf8');
  assert.match(page, /id="aldPage"/);
  assert.match(page, /id="aldDownloadBtn"/);
  assert.match(page, /modules\/akyuz-liste\.js/);
  assert.match(page, /AraclarGate\.isUnlocked/);
  const session = fs.readFileSync(path.join(__dirname, '../public/session-manager.js'), 'utf8');
  assert.match(session, /akyuz-liste\.html/);
  const im = fs.readFileSync(path.join(__dirname, '../public/modules/is-merkezi.js'), 'utf8');
  assert.match(im, /akyuz-liste\.html/);
});
