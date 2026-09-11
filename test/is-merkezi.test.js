'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const api = require('../public/modules/is-merkezi');

test('calcTonRows divides by 27', () => {
  const r = api.calcTonRows('54');
  assert.equal(r.ok, true);
  assert.ok(Math.abs(r.rows - 2) < 1e-9);
  assert.match(r.text, /27/);
});

test('calcTonajFromBbt multiplies BBT by unit kg', () => {
  const r = api.calcTonajFromBbt('40', '1250');
  assert.equal(r.ok, true);
  assert.ok(Math.abs(r.ton - 50) < 1e-9);
  assert.match(r.text, /50/);
  assert.equal(api.calcTonajFromBbt('', '1250').ok, false);
});

test('perTruckFromUnitKg matches real GPM loads', () => {
  assert.equal(api.perTruckFromUnitKg('1350').perTruck, 19);
  assert.equal(api.perTruckFromUnitKg('1250').perTruck, 20);
  assert.equal(api.perTruckFromUnitKg('1300').perTruck, 20);
  assert.equal(api.perTruckFromUnitKg('1150').perTruck, 22);
});

test('suggestBizimBbt multiplies trucks by tipik', () => {
  const s = api.suggestBizimBbt('6', '1350');
  assert.equal(s.ok, true);
  assert.equal(s.bbt, 114);
  assert.match(s.text, /114/);
});

test('calcNakliyeciKalan = total − bizim; red only if az or negative', () => {
  // Örnek: 200 − 6×19 = 86 → yeşil
  const ok86 = api.calcNakliyeciKalan('200', '114', '1350');
  assert.equal(ok86.kalan, 86);
  assert.equal(ok86.level, 'ok');
  assert.match(ok86.steps, /200.*114.*86/);
  assert.match(ok86.durum, /Tamam/);

  // 20 kalan (≥20) → yeşil (tek araç da olsa Akyüz yükleyebilir)
  const ok20 = api.calcNakliyeciKalan('80', '60', '1250');
  assert.equal(ok20.kalan, 20);
  assert.equal(ok20.level, 'ok');

  // 12 az → kırmızı
  const az = api.calcNakliyeciKalan('100', '88', '1250');
  assert.equal(az.kalan, 12);
  assert.equal(az.level, 'bad');
  assert.match(az.durum, /AZ KALDI/);

  // 38 ≥20 → yeşil (uyarı metni listede; hesap kırmızı değil)
  const otuzsekiz = api.calcNakliyeciKalan('58', '20', '1250');
  assert.equal(otuzsekiz.kalan, 38);
  assert.equal(otuzsekiz.level, 'ok');

  // Bizim fazla
  const fazla = api.calcNakliyeciKalan('50', '60', '1250');
  assert.equal(fazla.kalan, -10);
  assert.equal(fazla.level, 'bad');

  // Kalan 0
  const sifir = api.calcNakliyeciKalan('100', '100', '1250');
  assert.equal(sifir.kalan, 0);
  assert.equal(sifir.level, 'ok');
});

test('calcPaket1375 converts kg and ton', () => {
  const kg = api.calcPaket1375('27500', 'kg');
  assert.equal(kg.ok, true);
  assert.ok(Math.abs(kg.bbt - 20) < 1e-9);
  const ton = api.calcPaket1375('27.5', 'ton');
  assert.equal(ton.ok, true);
  assert.ok(Math.abs(ton.bbt - 20) < 1e-9);
});

test('calcBbt uses ton/27 for trucks and manual BBT count', () => {
  const onlyTon = api.calcBbt('54', '');
  assert.equal(onlyTon.ok, true);
  assert.ok(Math.abs(onlyTon.arabalar - 2) < 1e-9);
  assert.match(onlyTon.text, /araba/);
  const full = api.calcBbt('54', '40');
  assert.equal(full.ok, true);
  assert.ok(Math.abs(full.perArac - 20) < 1e-9);
  assert.match(full.text, /araç başı/);
  assert.match(api.calcBbt('', '').text, /Ton ve BBT/);
});

test('FLOWS cover sabah haftalik sonra with critical items', () => {
  assert.ok(api.FLOWS.sabah);
  assert.ok(api.FLOWS.haftalik);
  assert.ok(api.FLOWS.sonra);
  const all = [];
  Object.values(api.FLOWS).forEach((flow) => {
    flow.sections.forEach((sec) => sec.items.forEach((it) => all.push(it)));
  });
  assert.ok(all.some((it) => it.critical && /1–19 BBT|38/i.test(it.text)));
  assert.ok(all.some((it) => it.critical && /Akyüz’den düş|Akyüz'den düş/i.test(it.text)));
  assert.ok(all.some((it) => it.link === 'liste-kopyala'));
  const prog = api.flowProgress(api.FLOWS.sabah, { 's-irs-1': true });
  assert.equal(prog.done, 1);
  assert.ok(prog.total > 5);
});

test('İş Merkezi page menu and session wiring exist', () => {
  const page = fs.readFileSync(path.join(__dirname, '../public/is-merkezi.html'), 'utf8');
  assert.match(page, /id="imPage"/);
  assert.match(page, /id="imTonInput"/);
  assert.match(page, /id="imBbtCountInput"/);
  assert.match(page, /id="imUnitKgInput"/);
  assert.match(page, /id="imNakBizimBbt"/);
  assert.match(page, /id="imNakArac"/);
  assert.match(page, /id="imNakSteps"/);
  assert.match(page, /Nakliyeciye kalan/);
  assert.doesNotMatch(page, /id="imPkgInput"/);
  assert.doesNotMatch(page, /id="imBbtInput"/);
  assert.match(page, /modules\/is-merkezi\.js/);
  assert.match(page, /sarı GPM/);
  const menu = fs.readFileSync(path.join(__dirname, '../public/modules/app-ui-forms-takip.js'), 'utf8');
  const ayarlarAt = menu.indexOf('id="ayarlarMenuButton"');
  const hubAt = menu.indexOf('id="isMerkeziMenuButton"');
  const listeAt = menu.indexOf('id="excelListCopyMenuButton"');
  assert.ok(ayarlarAt >= 0);
  assert.ok(hubAt > ayarlarAt, 'İş Merkezi under Ayarlar');
  assert.ok(listeAt > hubAt, 'Liste kopyala under İş Merkezi');
  const auth = fs.readFileSync(path.join(__dirname, '../public/modules/app-auth.js'), 'utf8');
  assert.match(auth, /is-merkezi\.html/);
  const session = fs.readFileSync(path.join(__dirname, '../public/session-manager.js'), 'utf8');
  assert.match(session, /is-merkezi\.html/);
  const docs = fs.readFileSync(path.join(__dirname, '../docs/is-merkezi-notlar.md'), 'utf8');
  assert.match(docs, /BBT/);
  assert.match(docs, /Akyüz/);
  assert.doesNotMatch(page, /id="imFaz2"/);
  assert.doesNotMatch(page, /is-merkezi-faz2/);
});
