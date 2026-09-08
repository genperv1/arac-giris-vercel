'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const api = require('../public/modules/excel-list-copy');

function headerRow() {
  return [
    'KUTAHYA_CIKIS_TARIH', '', '', 'LIMAN_DOL_TARIH', '', '',
    'ICNAKLIYE_CARI_ISIM_TR', 'TERMINAL_CARI_ISIM_TR', 'GEMI_ADI', 'BOOKINGNO',
    'SIPNO', 'AKTARIM', 'MUSTERI', 'LOTNO', 'STOK_KODU', 'STOK_ADI', '',
    'SEVKPLANMIK', 'SIP_TOPLAM_MIKTAR', '', 'OLCU_BR1', '', '',
    'AMBALAJ_ADI_TR', 'PAKET', 'BB_ADET', 'CV_ADET', 'PALET_TR', 'PALET_SAYISI',
    '', '', '', '', '', 'SIP_TARIH', '', '', '', '', '', 'ETIKET_NOT', 'URETIM_NOT1_TR'
  ];
}

function sampleGrid() {
  return [
    headerRow(),
    ['TESLIM_YIL: 2026'],
    ['', 'HAFTA: 37'],
    [
      '', '', new Date(Date.UTC(2026, 8, 7)), new Date(Date.UTC(2026, 8, 8)), '', '',
      'Akyüz Uluslararası Nakliyat Tic.ve San.A.ş.',
      'Safi Derince Uluslararası Liman İşletmeciliği A.Ş.',
      'COSCO SHIPPING KILIMANJARO', '6465705420',
      'M20202600000623', 'MADEN', 'YD05', 'YD 05 LOT NO 26 08 14',
      'HP007030-B16-01', 'HAM PERLIT 0.074-0.30MM(AVDAN)', '',
      1000000, 1000, '', 'KG', '', '',
      'BASKISIZ LİNEERLİ-GPM5', '1 BB = 1250 KG', 800, 0, 'YOK', 0,
      '', '', '', '', '', new Date(Date.UTC(2026, 7, 10)),
      '', '', '', '', '',
      'OZEL ETIKET: OZEL ETIKET: PERLITE ORE 0,074-0.30MM IBARESI EKLENMELIDIR',
      'MAVI KULPLU BIGBAG KULLANILMALIDIR.'
    ],
    [
      '', '', new Date(Date.UTC(2026, 8, 8)), new Date(Date.UTC(2026, 8, 9)), '', '',
      'Akyüz Uluslararası Nakliyat Tic.ve San.A.ş.',
      'Dp World Yarımca Liman İşletmeleri A.ş.-USD',
      'CLEMENTINE MAERSK 639E', '23797559',
      'M20202600000673', 'GENPER', 'YD390', '26 09 05',
      'HP120280-B24-02', 'HAM PERLIT 1.20-2.80MM(AVDAN)', '',
      54000, 54, '', 'KG', '', '',
      'BİGBAG - GPM6-2 - ÜSTÜ AÇIK BASKILI', '1 BB = 1350 KG + 1 VT = 25 KG', 40, 2160, 'YOK', 0,
      '', '', '', '', '', new Date(Date.UTC(2026, 8, 1)),
      '', '', '', '', '', '', ''
    ],
    [
      '', '', new Date(Date.UTC(2026, 8, 9)), new Date(Date.UTC(2026, 8, 10)), '', '',
      'Akyüz Uluslararası Nakliyat Tic.ve San.A.ş.',
      'Dp World Yarımca Liman İşletmeleri A.ş.',
      'MAERSK SIRAC / 637S', '10579702',
      'M20202600000550', 'MADEN', 'YD68', 'YD 68 LOT NO 26 07 18',
      'HP015065-B22-01', 'HAM PERLIT 0.15-0.60MM(AVDAN)-615', '',
      230000, 230, '', 'KG', '', '',
      '95X95X115 - GENPER BASKILI LİNEERLİ-GPM1', '1 BB = 1150 KG', 200, 0, 'ÇİFT MÜHÜRLÜ', 100,
      '', '', '', '', '', new Date(Date.UTC(2026, 6, 8)),
      '', '', '', '', '', '', 'GPM615'
    ]
  ];
}

test('shortenTedarikci always maps Akyüz to AKYÜZ', () => {
  assert.equal(api.shortenTedarikci('Akyüz Uluslararası Nakliyat Tic.ve San.A.ş.', 'MADEN'), 'AKYÜZ');
  assert.equal(api.shortenTedarikci('Akyüz Uluslararası Nakliyat Tic.ve San.A.ş.', 'GENPER'), 'AKYÜZ');
  assert.equal(api.shortenTedarikci('Medlog Lojistik Gemicilik Turizm A.Ş.', 'MADEN'), 'MEDLOG');
});

test('formatMusteri adds (M) or (G) from AKTARIM', () => {
  assert.equal(api.formatMusteri('YD05', 'MADEN'), 'YD05(M)');
  assert.equal(api.formatMusteri('YD390', 'GENPER'), 'YD390(G)');
  assert.equal(api.formatMusteri('YD15(M)', 'MADEN'), 'YD15(M)');
});

test('screen dates stay short, copy dates use long Turkish weekday', () => {
  assert.equal(api.formatDateTr(new Date(Date.UTC(2026, 8, 5))), '05.09.2026');
  assert.equal(api.formatDateCopyTr(new Date(Date.UTC(2026, 8, 5))), '5 Eylül 2026 Cumartesi');
  assert.equal(api.formatDateCopyTr('03.08.2026'), '3 Ağustos 2026 Pazartesi');
});

test('formatHafta uses the exit date', () => {
  assert.equal(api.formatHafta(new Date(Date.UTC(2026, 8, 7))), '37.hafta');
  assert.equal(api.formatHafta(new Date(Date.UTC(2026, 8, 5))), '36.hafta');
  assert.equal(api.formatHafta('04.08.2026'), '32.hafta');
});

test('formatMt converts KG plan quantity to tons', () => {
  assert.equal(api.formatMt(1000000, 'KG', 1000), '1000');
  assert.equal(api.formatMt(9600, 'KG', 38.4), '9,6');
  assert.equal(api.formatMt(54, 'TON', 54), '54');
});

test('formatUrun and lot / liman / etiket helpers', () => {
  assert.equal(api.formatUrun('HAM PERLIT 0.074-0.30MM(AVDAN)'), 'HP 0,074-0,30');
  assert.equal(api.formatUrun('HAM PERLIT 0.15-0.60MM(AVDAN)-615'), 'HP 0,15-0,60 (GPM615)');
  assert.equal(api.formatLotNo('26 09 05'), 'LOT NO 26 09 05');
  assert.equal(api.formatLotNo('YD 05 LOT NO 26 08 14'), 'LOT NO 26 08 14');
  assert.equal(api.shortenLiman('Safi Derince Uluslararası Liman İşletmeciliği A.Ş.'), 'SAFİPORT');
  assert.equal(api.shortenLiman('Dp World Yarımca Liman İşletmeleri A.ş.-USD'), 'DP WORLD');
  assert.equal(
    api.cleanNote('OZEL ETIKET: OZEL ETIKET: PERLITE ORE 0,074-0.30MM'),
    'PERLITE ORE 0,074-0.30MM'
  );
});

test('packageCounts keeps group shipments aligned', () => {
  assert.deepEqual(api.packageCounts(800, 0, 0), { bags: '800', adet: '' });
  assert.deepEqual(api.packageCounts(40, 2160, 0), { bags: '2160', adet: '40' });
  assert.deepEqual(api.packageCounts(200, 0, 100), { bags: '200', adet: '100' });
  assert.deepEqual(api.packageCounts(0, 1680, 40), { bags: '1680', adet: '40' });
});

test('solveGrid keeps TESLIM_YIL / HAFTA groups and maps a 3-row week', () => {
  const solved = api.solveGrid(sampleGrid(), 7);
  assert.equal(solved.ok, true);
  assert.equal(solved.rows.length, 3);
  assert.deepEqual(solved.rows.map((r) => r.sira), ['7', '8', '9']);
  assert.deepEqual(solved.rows.map((r) => r.groupWeek), ['37', '37', '37']);
  assert.deepEqual(solved.rows.map((r) => r.groupYear), ['2026', '2026', '2026']);
  const tree = api.groupTree(solved.rows);
  assert.equal(tree.length, 1);
  assert.equal(tree[0].year, '2026');
  assert.equal(tree[0].weeks.length, 1);
  assert.equal(tree[0].weeks[0].label, 'HAFTA: 37');
  assert.deepEqual(tree[0].weeks[0].indexes, [0, 1, 2]);

  const maden = solved.rows[0];
  assert.equal(maden.tedarikci, 'AKYÜZ');
  assert.equal(maden.musteri, 'YD05(M)');
  assert.equal(maden.musteriKodu, 'LOT NO 26 08 14');
  assert.equal(maden.hafta, '37.hafta');
  assert.equal(maden.cikisTarih, '07.09.2026');
  assert.equal(api.rowToCells(maden)[5], '7 Eylül 2026 Pazartesi');
  assert.equal(maden.mt, '1000');
  assert.equal(maden.bigbagCuval, '800');
  assert.equal(maden.adet, '');
  assert.equal(maden.palet, '');
  assert.equal(maden.liman, 'SAFİPORT');
  assert.equal(maden.urun, 'HP 0,074-0,30');
  assert.match(maden.ambalaj, /NET 1250 KG/);
  assert.match(maden.aciklama, /PERLITE ORE/);
  assert.equal(maden.isTakip, '');
  assert.equal(maden.sektor, '');

  const genper = solved.rows[1];
  assert.equal(genper.tedarikci, 'AKYÜZ');
  assert.equal(genper.sevkPlanMik, '54000');
  assert.equal(genper.musteri, 'YD390(G)');
  assert.equal(genper.bigbagCuval, '2160');
  assert.equal(genper.adet, '40');
  assert.equal(genper.liman, 'DP WORLD');

  const pallet = solved.rows[2];
  assert.equal(pallet.urun, 'HP 0,15-0,60 (GPM615)');
  assert.equal(pallet.palet, 'ÇİFT MÜHÜRLÜ');
  assert.equal(pallet.adet, '100');
});

test('rowsToTsv writes 23 target columns for a 5-sevk batch', () => {
  const five = [];
  for (let i = 0; i < 5; i++) {
    five.push(api.mapSourceRow({
      tedarikciRaw: 'Akyüz Uluslararası Nakliyat Tic.ve San.A.ş.',
      aktarim: i % 2 ? 'GENPER' : 'MADEN',
      musteriRaw: 'YD' + (10 + i),
      lotNo: '26 09 0' + (i + 1),
      sipNo: 'M2020260000062' + i,
      cikisTarih: new Date(Date.UTC(2026, 8, 8)),
      limanDolum: new Date(Date.UTC(2026, 8, 9)),
      sipTarih: new Date(Date.UTC(2026, 8, 1)),
      stokKodu: 'HP007030-B16-01',
      stokAdi: 'HAM PERLIT 0.074-0.30MM(AVDAN)',
      sevkPlanMik: 26000,
      olcuBr: 'KG',
      ambalajAdi: 'BİGBAG',
      paket: '1 BB = 1300 KG',
      bbAdet: 20,
      cvAdet: 0,
      paletTr: 'YOK',
      limanRaw: 'Yılport Konteyner Terminali ve Liman İşletmeciliği',
      bookingNo: 'EBKG' + i,
      gemi: 'MED CORLU AU637A',
      etiketNot: '',
      uretimNot1: ''
    }));
  }
  const numbered = api.assignSira(five, 12);
  const tsv = api.rowsToTsv(numbered, false);
  const lines = tsv.split(/\r?\n/).filter(Boolean);
  assert.equal(lines.length, 5);
  lines.forEach((line, idx) => {
    const cols = line.split('\t');
    assert.equal(cols.length, 23, 'target list has 23 columns');
    assert.equal(cols[2], String(12 + idx));
    assert.equal(cols[4], '37.hafta');
    assert.equal(cols[15], 'YILPORT');
    assert.ok(cols[3].startsWith('M202026'));
  });
  assert.equal(lines[0].split('\t')[0], 'AKYÜZ');
  assert.equal(lines[1].split('\t')[0], 'AKYÜZ');
  assert.equal(lines[0].split('\t')[6], 'YD10(M)');
  assert.equal(lines[1].split('\t')[6], 'YD11(G)');
});

test('solveGrid reports a clear error when headers are missing', () => {
  const bad = api.solveGrid([['A', 'B'], ['1', '2']], 1);
  assert.equal(bad.ok, false);
  assert.match(bad.error, /başlığı/);
});

test('Araçlar menu places animated lightning under Ayarlar', () => {
  const menu = fs.readFileSync(path.join(__dirname, '../public/modules/app-ui-forms-takip.js'), 'utf8');
  const ayarlarAt = menu.indexOf('id="ayarlarMenuButton"');
  const boltAt = menu.indexOf('id="excelListCopyMenuButton"');
  assert.ok(ayarlarAt >= 0, 'Ayarlar button missing');
  assert.ok(boltAt > ayarlarAt, 'Liste kopyala must sit under Ayarlar');
  assert.match(menu, /elc-bolt-icon/);
  const page = fs.readFileSync(path.join(__dirname, '../public/liste-kopyala.html'), 'utf8');
  assert.match(page, /id="elcPage"/);
  assert.match(page, /id="elcSolveBtn"/);
  assert.match(page, /id="elcCopyBtn"/);
  assert.match(page, /SEVKPLANMIK/);
  assert.match(page, /PALET_URUN_SAYISI/);
  assert.doesNotMatch(page, />MT</);
  assert.match(page, /modules\/excel-list-copy\.js/);
  const auth = fs.readFileSync(path.join(__dirname, '../public/modules/app-auth.js'), 'utf8');
  assert.match(auth, /liste-kopyala\.html/);
  const session = fs.readFileSync(path.join(__dirname, '../public/session-manager.js'), 'utf8');
  assert.match(session, /liste-kopyala\.html/);
  assert.doesNotMatch(
    fs.readFileSync(path.join(__dirname, '../public/ayarlar.html'), 'utf8'),
    /id="section-excel"/
  );
});

test('groupTree splits weeks so a 5-sevk block can be selected alone', () => {
  const rows = [];
  for (let i = 0; i < 3; i++) rows.push({ groupYear: '2026', groupWeek: '37', musteri: 'YD' + i });
  for (let i = 0; i < 5; i++) rows.push({ groupYear: '2026', groupWeek: '38', musteri: 'YD3' + i });
  const tree = api.groupTree(rows);
  assert.equal(tree[0].weeks[0].indexes.length, 3);
  assert.equal(tree[0].weeks[1].label, 'HAFTA: 38');
  assert.deepEqual(tree[0].weeks[1].indexes, [3, 4, 5, 6, 7]);
});
