'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const api = require('../public/modules/plan-v4');

test('tonajFromBbt = BBT × birim kg / 1000', () => {
  assert.equal(api.tonajFromBbt(40, 1300), 52);
  assert.equal(api.tonajFromBbt(400, 1350), 540);
  assert.equal(api.tonajFromBbt(200, 1150), 230);
  assert.equal(api.formatTon(52), '52');
  assert.equal(api.formatTon(27.5), '27,5');
});

test('formatDateTr reads Excel serial and TR text', () => {
  // 11.09.2026 = Excel serial 46276 (1899-12-30 epoch)
  assert.equal(api.formatDateTr(46276), '11.09.2026');
  assert.equal(api.formatDateTr('07.09.2026'), '07.09.2026');
  assert.equal(api.formatDateTr('7 Eylül 2026 Pazartesi'), '07.09.2026');
  assert.equal(api.formatDateTr(''), '');
});

test('parseGuncelGrid exposes GENPER çıkış tarihi', () => {
  const grid = [
    ['TEDARİKÇİ', 'NETSİS SİPARİŞ NO', 'HAFTA', 'GENPER ÇIKIŞ TARİHİ', 'MÜŞTERİ', 'ÜRÜN', 'MT', 'AMBALAJ', 'Bigbag/Çuval', 'ADET', 'GİDECEĞİ LİMAN', 'LİMAN DOLUM TARİHİ'],
    ['AKYÜZ', 'SIP-1', '37.hafta', 46276, 'YD05(M)', 'HP 0,074-0,30', 52, 'NET 1300 KG BİGBAG', 40, 20, 'SAFİPORT', '14.09.2026']
  ];
  const parsed = api.parseGuncelGrid(grid);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.items.length, 1);
  assert.equal(parsed.items[0].cikisTarih, '11.09.2026');
  assert.equal(parsed.items[0].limanDolum, '14.09.2026');
  assert.equal(parsed.items[0].hafta, '37.hafta');
  assert.deepEqual(parsed.summary.cikisDates, ['11.09.2026']);
});

test('paketleme uses 1375 kg for Akyüz tonaj', () => {
  assert.equal(api.calcKgForKind('paketleme', 1350), 1375);
  assert.equal(api.calcKgForKind('bbt', 1300), 1300);
  const bbt = api.classifyPack(200, 100, 'NET 1150 KG BASKILI');
  assert.equal(bbt.kind, 'bbt');
  assert.equal(bbt.bbt, 200);
  assert.equal(bbt.calcKg, 1150);
  const paket = api.classifyPack(21600, 400, 'NET 1350 KG BİGBAG');
  assert.equal(paket.kind, 'paketleme');
  assert.equal(paket.bbt, 400);
  assert.equal(paket.cuval, 21600);
  assert.equal(paket.calcKg, 1375);
  assert.equal(paket.unitKg, 1350);
  assert.equal(api.tonajFromBbt(400, 1375), 550);
});

test('calcKalan flags az and küsürat', () => {
  const ok = api.calcKalan(200, 114);
  assert.equal(ok.kalan, 86);
  assert.equal(ok.level, 'ok');
  assert.equal(ok.warnKusurat, false);

  const az = api.calcKalan(100, 90);
  assert.equal(az.kalan, 10);
  assert.equal(az.level, 'bad');

  const kus = api.calcKalan(100, 62);
  assert.equal(kus.kalan, 38);
  assert.equal(kus.level, 'ok');
  assert.equal(kus.warnKusurat, true);
});

test('planForItem uses tipik × araç', () => {
  const item = { bbt: 200, unitKg: 1350, kind: 'bbt' };
  const plan = api.planForItem(item, 6, '');
  assert.equal(plan.tipikPerArac, 19);
  assert.equal(plan.bizimBbt, 114);
  assert.equal(plan.kalan.kalan, 86);
});

test('parseGuncelGrid reads real Güncel İhracat sample when present', () => {
  const sample = 'C:/Users/Engoo/Downloads/11.09.2026 Güncel İhracat Listesi.xlsx';
  if (!fs.existsSync(sample)) {
    assert.ok(true, 'sample missing — skip');
    return;
  }
  const wb = XLSX.readFile(sample, { cellDates: false });
  const sh = wb.Sheets[wb.SheetNames.find((n) => /guncel/i.test(n)) || wb.SheetNames[0]];
  const grid = XLSX.utils.sheet_to_json(sh, { header: 1, defval: '', blankrows: false });
  const parsed = api.parseGuncelGrid(grid);
  assert.equal(parsed.ok, true);
  assert.ok(parsed.items.length >= 5);
  assert.ok(parsed.summary.bbtCount + parsed.summary.paketCount >= 1);
  const hasPaket = parsed.items.some((it) => it.kind === 'paketleme');
  const hasBbt = parsed.items.some((it) => it.kind === 'bbt' && it.bbt > 0);
  assert.equal(hasPaket, true);
  assert.equal(hasBbt, true);
  const withTon = parsed.items.filter((it) => it.tonaj > 0);
  assert.ok(withTon.length >= 1);
  const tonRow = withTon[0];
  assert.ok(Math.abs(tonRow.tonaj - (tonRow.bbt * tonRow.calcKg) / 1000) < 1e-9);
  const paketRows = parsed.items.filter((it) => it.kind === 'paketleme' && it.bbt > 0);
  if (paketRows.length) {
    assert.equal(paketRows[0].calcKg, 1375);
  }
});

test('detectPaletStrec flags palet and streç for truck warning', () => {
  const none = api.detectPaletStrec({
    paletCol: '',
    strecCol: '',
    ambalaj: 'NET 1350 KG BİGBAG',
    aciklama: '',
    paletCount: 0,
    kind: 'bbt'
  });
  assert.equal(none.alert, false);

  const palet = api.detectPaletStrec({
    paletCol: 'ÇİFT MÜHÜRLÜ',
    strecCol: '',
    ambalaj: 'NET 1300 KG',
    aciklama: '',
    paletCount: 20,
    kind: 'bbt'
  });
  assert.equal(palet.alert, true);
  assert.equal(palet.hasPalet, true);
  assert.equal(palet.hasStrec, false);
  assert.match(palet.badge, /PALET/);

  const strec = api.detectPaletStrec({
    paletCol: 'YOK',
    strecCol: 'VAR',
    ambalaj: 'NET 1150 KG',
    kind: 'bbt'
  });
  assert.equal(strec.hasStrec, true);
  assert.equal(strec.alert, true);

  const fromText = api.detectPaletStrec({
    ambalaj: 'NET 1150 KG STREÇ PALET',
    kind: 'bbt'
  });
  assert.equal(fromText.hasPalet, true);
  assert.equal(fromText.hasStrec, true);

  const paketAdet = api.detectPaletStrec({
    paletCol: '',
    paletCount: 400,
    kind: 'paketleme',
    ambalaj: 'NET 1350 KG BİGBAG'
  });
  assert.equal(paketAdet.alert, false, 'paketleme ADET is BBT, not palet');
});

test('parseGuncelGrid marks ÇİFT MÜHÜRLÜ rows as special alert', () => {
  const sample = 'C:/Users/Engoo/Downloads/11.09.2026 Güncel İhracat Listesi.xlsx';
  if (!fs.existsSync(sample)) {
    assert.ok(true, 'sample missing — skip');
    return;
  }
  const wb = XLSX.readFile(sample, { cellDates: false });
  const sh = wb.Sheets[wb.SheetNames.find((n) => /guncel/i.test(n)) || wb.SheetNames[0]];
  const grid = XLSX.utils.sheet_to_json(sh, { header: 1, defval: '', blankrows: false });
  const parsed = api.parseGuncelGrid(grid);
  assert.equal(parsed.ok, true);
  const specials = parsed.items.filter((it) => it.special && it.special.alert);
  assert.ok(specials.length >= 1);
  assert.ok(parsed.summary.specialCount >= 1);
  assert.ok(specials.some((it) => /cift|muhur|PALET/i.test(it.paletCol + it.special.badge)));
});

test('Plan v4 page and menu wiring', () => {
  const page = fs.readFileSync(path.join(__dirname, '../public/plan-v4.html'), 'utf8');
  assert.match(page, /Plan v4/);
  assert.match(page, /modules\/plan-v4\.js/);
  assert.match(page, /AraclarGate/);
  const hub = fs.readFileSync(path.join(__dirname, '../public/ihracat-takip.html'), 'utf8');
  assert.match(hub, /plan-v4\.html/);
  const menu = fs.readFileSync(path.join(__dirname, '../public/modules/app-ui-forms-takip.js'), 'utf8');
  assert.match(menu, /ihracatTakipMenuButton/);
  assert.doesNotMatch(menu, /planV4MenuButton/);
  const auth = fs.readFileSync(path.join(__dirname, '../public/modules/app-auth.js'), 'utf8');
  assert.match(auth, /ihracat-takip\.html/);
  const session = fs.readFileSync(path.join(__dirname, '../public/session-manager.js'), 'utf8');
  assert.match(session, /plan-v4\.html/);
});
