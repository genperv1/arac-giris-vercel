'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const api = require('../public/modules/sayi-kontrol');

test('normalizeYd and matchKey', () => {
  assert.equal(api.normalizeYd('YD359(G) / LOT'), 'YD359');
  assert.equal(api.matchKey({ yd: 'YD92', booking: 'EBKG1' }), 'YD92|B:EBKG1');
  assert.equal(api.matchKey({ yd: 'YD92', lot: '260714' }), 'YD92|L:260714');
});

test('normalizeSip irsaliye date tasiyici', () => {
  assert.equal(api.normalizeSip('M20202600000550'), 'M20202600000550');
  assert.equal(api.normalizeIrsaliye('R01 2026003577'), 'R012026003577');
  assert.equal(api.normalizeIrsaliye('R01202600003577'), 'R012026003577');
  assert.equal(api.normalizeIrsaliye('R01202603488'), 'R012026003488');
  assert.equal(api.normalizeIrsaliye('R01202600003488'), 'R012026003488');
  assert.equal(api.normalizeDate('10.09.2026'), '10.09.2026');
  assert.equal(api.classifyTasiyici('Akyüz Uluslararası Nakliyat'), 'AKYÜZ');
  assert.equal(api.classifyTasiyici('Genper Madencilik San Tic'), 'GPM');
  assert.equal(api.classifyTasiyici('GPM'), 'GPM');
  assert.equal(
    api.extractNetsisSip('EXPORT REF NO : 0 / NETSIS SİPARİŞ NO : M20202600000550 ---'),
    'M20202600000550'
  );
});

test('compareField bbt exact, kg/ton/cuval tolerances', () => {
  assert.equal(api.compareField(200, 200, 'bbt').ok, true);
  assert.equal(api.compareField(200, 201, 'bbt').ok, false);
  assert.equal(api.compareField(100, 100, 'ton').ok, true);
  assert.equal(api.compareField(100, 100.02, 'ton').ok, false);
  assert.equal(api.compareField(27200, 27200, 'kg').ok, true);
  assert.equal(api.compareField(27200, 27205, 'kg').ok, false);
  assert.equal(api.compareField(27200, 27232, 'kg').ok, false);
  assert.equal(api.compareField(1080, 1081, 'cuval').ok, true);
  assert.equal(api.compareField(1080, 1082, 'cuval').ok, false);
});

test('compareText sofor exact, gsm exact', () => {
  assert.equal(api.compareText('YÜKSEL FERİZ', 'YÜKSEL FERİZ', 'sofor').ok, true);
  assert.equal(api.compareText('YÜKSEL FERİZ', 'YÜKSEL FEİZ', 'sofor').ok, false);
  assert.equal(api.compareText('5374031074', '5374031074', 'gsm').ok, true);
  assert.equal(api.compareText('5374031074', '5374031075', 'gsm').ok, false);
});

test('kantar empty on one side is not a mismatch', () => {
  const cmp = api.compareLinePair(
    { irsaliye: 'R1', plaka: '43ADR754', tasiyici: 'AKYÜZ', teslimCari: 'YILPORT', ob1: 27000, kantar: 27540, sofor: 'ÖMER', gsm: '543', bbt: 20, cuval: 1080 },
    { irsaliye: 'R1', plaka: '43ADR754', tasiyici: 'AKYÜZ', teslimCari: 'YILPORT', ob1: 27000, kantar: 0, sofor: '', gsm: '', bbt: 20, cuval: 1080 }
  );
  assert.equal(cmp.fields.kantar.ok, true);
  assert.equal(cmp.fields.sofor.ok, true);
  assert.equal(cmp.ok, true);
  const both = api.compareLinePair(
    { irsaliye: 'R1', plaka: '43A', tasiyici: 'A', teslimCari: 'Y', ob1: 27000, kantar: 27200, sofor: 'A', gsm: '1', bbt: 20, cuval: 1080 },
    { irsaliye: 'R1', plaka: '43A', tasiyici: 'A', teslimCari: 'Y', ob1: 27000, kantar: 27232, sofor: 'A', gsm: '1', bbt: 20, cuval: 1080 }
  );
  assert.equal(both.fields.kantar.ok, false);
  assert.equal(both.ok, false);
});

test('parseSevkiyatGrid reads TOPLAM BBT, SIPNO and lines', () => {
  const grid = [
    ['YD68(M) / LOT NO 26 07 18 / 230 TON / NET 1150 KG / 200 BBT / BOOKING NO : EBKG105 / GEMİ'],
    ['-------------   EXPORT REF NO : 0 / NETSIS SİPARİŞ NO : M20202600000550   -------------'],
    ['#', 'PLAKA', 'BBT', 'ÇUVAL', 'PALET', 'NET TONAJ', 'GİDEN TONAJ', 'FARK', 'HP', 'YÜKLEME', 'ŞOFÖR ADI SOYADI', 'TELEFON'],
    ['R01 2026003577', '43ADT553', 22, 0, 11, 25300, 25800, 240, 'GPM', 'AVDAN', 'EMRE ÜSTÜNDAĞ', '5300540043'],
    ['TOPLAM', '', 200, 0, 100, 230000, 234340, '', '', '', '', ''],
    ['KALAN', '', 0, 0, 0, 0, 0, '', '', '', '', '']
  ];
  const parsed = api.parseSevkiyatGrid(grid, '10.09.2026');
  assert.equal(parsed.ok, true);
  assert.equal(parsed.items.length, 1);
  assert.equal(parsed.items[0].yd, 'YD68');
  assert.equal(parsed.items[0].sip, 'M20202600000550');
  assert.equal(parsed.items[0].tarih, '10.09.2026');
  assert.equal(parsed.items[0].bbt, 200);
  assert.equal(parsed.items[0].lines.length, 1);
  assert.equal(parsed.items[0].lines[0].tasiyici, 'GPM');
  assert.equal(parsed.items[0].lines[0].irsaliye, 'R012026003577');
  assert.equal(parsed.items[0].lines[0].bbt, 22);
  assert.equal(parsed.items[0].lines[0].cuval, 0);
  assert.ok(Math.abs(parsed.items[0].ton - 230) < 0.01);
});

test('Excel BOŞ ÇUVAL maps to cuval (rapor ACIKLAMA6)', () => {
  const grid = [
    ['YD359 / 400 BBT / BOOKING NO : X1'],
    ['NETSIS SİPARİŞ NO : M20202600000654'],
    ['PLAKA', 'BBT', 'ÇUVAL', 'PALET', 'BOŞ BBT', 'BOŞ ÇUVAL', 'NET TONAJ', 'GİDEN TONAJ', 'FARK', 'HP'],
    ['43ADS403', 19, '', '', 1, 1026, 25650, 26100, 300, 'GPM'],
    ['TOPLAM', 19, 0, 0, 1, 1026, 25650, 26100, '', '']
  ];
  const parsed = api.parseSevkiyatGrid(grid, '14.09.2026');
  assert.equal(parsed.ok, true);
  assert.equal(parsed.items[0].lines[0].cuval, 1026);
});

test('parseNetsisGrid groups by TARIH+SIPNO', () => {
  const grid = [
    ['SIRKET', 'TARIH', 'SIPNO', 'IRSALIYE_NO', 'FIRMA_KODU', 'BOOKING', 'IRS_MIKTAR_OB1', 'KANTAR', 'ACIKLAMA1', 'ACIKLAMA2', 'ACIKLAMA5', 'ACIKLAMA6', 'PLAKA', 'TASIYICI_UNVAN', 'TASICIYI_AD_SOYAD', 'TASIYICI_GSM', 'FT_CARI_ISIM'],
    ['MADEN26', '10.09.2026', 'M20202600000550', 'R01202600003577', 'YD68 / LOT', '10579702', 25300, 25800, 'BBT', 22, 'CUVAL', 1080, '43ADT553', 'Genper Madencilik', 'EMRE ÜSTÜNDAĞ', '05300540043', 'Dp World Liman'],
    ['MADEN26', '10.09.2026', 'M20202600000550', 'R01202600003579', 'YD68 / LOT', '10579702', 29900, 0, 'BBT', 26, '', '', '43AAZ480', 'Akyüz Uluslararası', 'HASAN TAYFA', '05435780799', 'Dp World Liman']
  ];
  const parsed = api.parseNetsisGrid(grid);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.blocks.length, 1);
  assert.equal(parsed.blocks[0].sip, 'M20202600000550');
  assert.equal(parsed.blocks[0].lines.length, 2);
  assert.equal(parsed.blocks[0].lines[0].tasiyici, 'GPM');
  assert.equal(parsed.blocks[0].lines[0].bbt, 22);
  assert.equal(parsed.blocks[0].lines[0].cuval, 1080);
  assert.equal(parsed.blocks[0].lines[1].tasiyici, 'AKYÜZ');
});

test('diffSipBlocks matches by irsaliye only and scopes to excel sips', () => {
  const left = [{
    key: '10.09.2026|S:M1',
    sip: 'M1',
    tarih: '10.09.2026',
    teslimCari: 'Dp World Liman',
    yd: 'YD68',
    label: 'M1',
    lines: [{
      irsaliye: 'R01202600003577',
      plaka: '43ADT553',
      tasiyici: 'GPM',
      sofor: 'EMRE',
      gsm: '5300540043',
      teslimCari: 'Dp World Liman',
      ob1: 25300,
      kantar: 25800,
      bbt: 22
    }]
  }, {
    key: '01.01.2026|S:MOTHER',
    sip: 'MOTHER',
    tarih: '01.01.2026',
    label: 'other',
    lines: [{
      irsaliye: 'R01202600009999',
      plaka: '99XXX99',
      tasiyici: 'GPM',
      sofor: 'X',
      gsm: '5000000000',
      teslimCari: 'X',
      ob1: 1000,
      kantar: 1000,
      bbt: 1
    }]
  }];
  const right = [{
    key: '10.09.2026|S:M1',
    sip: 'M1',
    tarih: '10.09.2026',
    teslimCari: 'DP WORLD',
    yd: 'YD68',
    label: 'M1',
    lines: [{
      irsaliye: 'R01 2026003577',
      plaka: '43ADT553',
      tasiyici: 'GPM',
      sofor: 'EMRE',
      gsm: '5300540043',
      teslimCari: 'DP WORLD',
      ob1: 25300,
      kantar: 25800,
      bbt: 22
    }]
  }];
  const d = api.diffSipBlocks(left, right);
  assert.equal(d.matchBy, 'irsaliye');
  assert.equal(d.summary.matchedOk, 1);
  assert.equal(d.summary.total, 1, 'kapsam dışı SIPNO gösterilmez');
  assert.equal(d.summary.lineOk, 1);
});

test('Excel ŞOFÖR BİLGİLERİ fallback and GELMEDİ', () => {
  const grid = [
    ['YD1 / NETSIS SİPARİŞ NO : M20202600000654'],
    ['PLAKA', 'BBT', 'NET TONAJ', 'GİDEN TONAJ', 'ŞOFÖR', 'ŞOFÖR BİLGİLERİ', 'TELEFON'],
    ['43BH088', 20, 27000, 27000, '', 'GELMEDİ', ''],
    ['43AAE599', 20, 27000, 27000, '', 'YÜKSEL FERİZ-5374031074', ''],
    ['TOPLAM', 40, 54000, 54000, '', '', '']
  ];
  const parsed = api.parseSevkiyatGrid(grid, '14.09.2026');
  assert.equal(parsed.items[0].lines[0].sofor, '');
  assert.equal(parsed.items[0].lines[1].sofor, 'YÜKSEL FERİZ');
  assert.equal(parsed.items[0].lines[1].gsm, '5374031074');
});

test('Netsis stub lines (1kg empty) are skipped', () => {
  const grid = [
    ['SIRKET', 'TARIH', 'SIPNO', 'IRSALIYE_NO', 'FIRMA_KODU', 'BOOKING', 'IRS_MIKTAR_OB1', 'KANTAR', 'ACIKLAMA1', 'ACIKLAMA2', 'ACIKLAMA5', 'ACIKLAMA6', 'PLAKA', 'TASIYICI_UNVAN', 'TASICIYI_AD_SOYAD', 'TASIYICI_GSM', 'FT_CARI_ISIM'],
    ['MADEN26', '14.09.2026', 'M20202600000654', 'R11202600001358', 'YD', '1', 25650, 25650, 'BBT', 19, '', '', '43ADS403', 'GPM', 'MEHMET ALİ SARI', '5306109035', 'Dp'],
    ['MADEN26', '14.09.2026', 'M20202600000654', 'R11202600001363', 'YD', '1', 1, 0, '', '', '', '', '', '', '', '', 'Dp'],
    ['MADEN26', '14.09.2026', 'M20202600000654', 'R11202600001374', 'YD', '1', 27000, 27000, 'BBT', 20, '', '', '43AAE599', 'GPM', 'YÜKSEL FERİZ', '5374031074', 'Dp']
  ];
  const parsed = api.parseNetsisGrid(grid);
  assert.equal(parsed.blocks[0].lines.length, 2);
  assert.equal(parsed.blocks[0].lines[1].sofor, 'YÜKSEL FERİZ');
});

test('pairLines rematches by plaka when irsaliye conflicts', () => {
  const pairs = api.pairLines(
    [
      { irsaliye: 'R11202600001374', plaka: '43AAE599', sofor: 'YUKSEL', bbt: 20 },
      { irsaliye: 'R11202600001375', plaka: '43ACN771', sofor: 'GUNAY', bbt: 20 }
    ],
    [
      { irsaliye: 'R11202600001373', plaka: '43AAE599', sofor: 'YUKSEL', bbt: 20 },
      { irsaliye: 'R11202600001374', plaka: '43ACN771', sofor: 'GUNAY', bbt: 20 }
    ]
  );
  const both = pairs.filter((p) => p.left && p.right);
  assert.equal(both.length, 2);
  both.forEach((p) => {
    assert.equal(String(p.left.plaka), String(p.right.plaka));
    assert.equal(p.left.sofor, p.right.sofor);
  });
});

test('pairLines does not invent matches without shared irsaliye or plaka', () => {
  const pairs = api.pairLines(
    [{ irsaliye: 'R01202600001111', plaka: '43ADT553', bbt: 22 }],
    [{ irsaliye: 'R01202600002222', plaka: '99ZZZ99', bbt: 22 }]
  );
  assert.equal(pairs.filter((p) => p.left && p.right).length, 0);
});

test('diffReports flags mismatch and only-one-side', () => {
  const left = [
    { key: 'YD1|B:A', label: 'YD1', bbt: 200, ton: 230 },
    { key: 'YD2|B:B', label: 'YD2', bbt: 100, ton: 125 }
  ];
  const right = [
    { key: 'YD1|B:A', label: 'YD1', bbt: 200, ton: 230 },
    { key: 'YD2|B:B', label: 'YD2', bbt: 110, ton: 125 },
    { key: 'YD3|B:C', label: 'YD3', bbt: 40, ton: 50 }
  ];
  const d = api.diffReports(left, right);
  assert.equal(d.summary.matchedOk, 1);
  assert.equal(d.summary.matchedBad, 1);
  assert.equal(d.summary.onlyRight, 1);
});

test('Sayı kontrol page and menu wiring', () => {
  const page = fs.readFileSync(path.join(__dirname, '../public/sayi-kontrol.html'), 'utf8');
  assert.match(page, /Sayı kontrol/);
  assert.match(page, /modules\/sayi-kontrol\.js/);
  assert.match(page, /AraclarGate/);
  assert.match(page, /Netsis ↔ Güncel/);
  const hub = fs.readFileSync(path.join(__dirname, '../public/ihracat-takip.html'), 'utf8');
  assert.match(hub, /sayi-kontrol\.html/);
  const menu = fs.readFileSync(path.join(__dirname, '../public/modules/app-ui-forms-takip.js'), 'utf8');
  assert.match(menu, /ihracatTakipMenuButton/);
  assert.doesNotMatch(menu, /sayiKontrolMenuButton/);
  const auth = fs.readFileSync(path.join(__dirname, '../public/modules/app-auth.js'), 'utf8');
  assert.match(auth, /ihracat-takip\.html/);
  const session = fs.readFileSync(path.join(__dirname, '../public/session-manager.js'), 'utf8');
  assert.match(session, /sayi-kontrol\.html/);
});
