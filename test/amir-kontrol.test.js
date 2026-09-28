'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
require('../public/modules/sayi-kontrol');
const api = require('../public/modules/amir-kontrol');
const sk = require('../public/modules/sayi-kontrol');

const NETSIS = [
  ['SIRKET', 'TARIH', 'SIPNO', 'IRSALIYE_NO', 'FIRMA_KODU', 'BOOKING', 'IRS_MIKTAR_OB1', 'KANTAR', 'ACIKLAMA1', 'ACIKLAMA2', 'ACIKLAMA5', 'ACIKLAMA6', 'PLAKA', 'TASIYICI_UNVAN', 'TASICIYI_AD_SOYAD', 'TASIYICI_GSM', 'FT_CARI_ISIM'],
  ['MADEN26', '10.09.2026', 'M20202600000550', 'R01202600003577', 'YD68', '1', 36450, 37220, 'BBT', 27, 'CUVAL', 1458, '03NF525', 'Genper', 'ALI', '05300000000', 'MEDLOG'],
  ['MADEN26', '02.01.2026', 'M20202600000999', 'R01202600000002', 'YD1', '1', 1000, 1000, 'BBT', 1, '', '', '43AAA01', 'Genper', 'VELI', '05300000001', 'X']
];

const AMIR = [
  ['FİRMA KODU', 'İRS. NO', 'AY', 'İRS. TARİHİ', 'SEVK TİPİ', 'FİRMA', 'MALZEME', 'İRS. TONAJI', 'KANTAR TONAJI', 'AMBALAJ', 'MİKTAR', 'BOŞ BBT', 'BOŞ ÇUVAL', 'PALET', 'PLAKA', 'SİPARİŞ NO'],
  ['R01', '202600000001', 9, '10.09.2026', 'YD-HP', 'YD319', 'HP 1.20-2.80', 36450, 37000, 'BBT', 27, 1, 1458, 0, '03NF525', 'M20202600000550'],
  ['R01', '202600000002', 9, '10.09.2026', 'YD-HP', 'YD319', 'HP 1.20-2.80', 27000, 28000, 'BBT', 20, 0, 1000, 0, '03NF525', 'M20202600000550'],
  ['R01', '202600000050', 1, '02.01.2026', 'Yİ-HP', 'X', 'P05', 1000, 1000, 'BBT', 1, 0, 0, 0, '43AAA01', 'M20202600000999']
];

test('parseAmirGrid reads irsaliye columns', () => {
  const parsed = api.parseAmirGrid(AMIR);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.rows.length, 3);
  assert.equal(parsed.rows[0].sip, 'M20202600000550');
  assert.equal(parsed.rows[0].tarih, '10.09.2026');
  assert.equal(parsed.rows[0].kantar, 37000);
  assert.equal(parsed.rows[0].miktar, 27);
  assert.equal(parsed.rows[0].bosCuval, 1458);
  assert.equal(parsed.rows[0].plaka, '03NF525');
  assert.equal(parsed.rows[0].firmaKodu, 'R01');
});

test('compareRange keeps only the chosen dates and flags kantar', () => {
  const netsis = sk.parseNetsisGrid(NETSIS);
  const amir = api.parseAmirGrid(AMIR);
  const diff = api.compareRange(netsis, amir, { from: '2026-09-10', to: '2026-09-10' });
  assert.equal(diff.ok, true);
  assert.equal(diff.rows.length, 2);
  assert.equal(diff.summary.matchedBad, 1);
  assert.equal(diff.summary.onlyAmir, 1);
  assert.equal(diff.rows.some((row) => row.tarih === '02.01.2026'), false);
  const bad = diff.rows.find((row) => row.status === 'bad');
  assert.ok(bad);
  assert.equal(bad.fields.kantar.ok, false);
  assert.equal(bad.fields.kantar.left, 37220);
  assert.equal(bad.fields.kantar.right, 37000);
});

test('sipariş outside the selected week is named, not dropped silently', () => {
  const netsis = sk.parseNetsisGrid(NETSIS);
  const amir = api.parseAmirGrid(AMIR);
  const diff = api.compareRange(netsis, amir, { from: '2026-09-28', to: '2026-10-04' }, { sip: '999' });
  assert.equal(diff.rows.length, 0);
  assert.equal(diff.sipInfo.netsis.count, 1);
  assert.equal(diff.sipInfo.amir.count, 1);
  assert.equal(diff.sipInfo.netsis.first, '02.01.2026');
  const msg = api.resultMessage(diff);
  assert.match(msg.text, /seçili tarihte değil/);
  assert.match(msg.text, /02\.01\.2026/);
});

test('tutan rows render before one-sided rows', () => {
  const netsis = sk.parseNetsisGrid(NETSIS);
  const amir = api.parseAmirGrid(AMIR);
  const diff = api.compareRange(netsis, amir, { from: '2026-01-01', to: '2026-09-30' });
  const html = api.renderRows(diff, true);
  assert.match(html, /İrsaliye no/);
  assert.match(html, /R01202600003577/);
  assert.match(html, /R01202600000001/);
  assert.ok(html.indexOf('TUTUYOR') >= 0);
  assert.ok(html.indexOf('FARK') < html.indexOf('TUTUYOR'));
  assert.ok(html.indexOf('TUTUYOR') < html.indexOf('SADECE İRSALİYE'));
});

test('shared sip is announced before one-sided leftovers', () => {
  const netsis = sk.parseNetsisGrid(NETSIS);
  const amir = api.parseAmirGrid(AMIR);
  const diff = api.compareRange(netsis, amir, { from: '2026-09-01', to: '2026-09-30' }, { sip: '550' });
  const msg = api.resultMessage(diff);
  assert.match(msg.text, /^1 satır iki listede de var/);
  assert.match(msg.text, /sadece irsaliyede/);
  const html = api.renderRows(diff, true);
  assert.ok(html.indexOf('FARK') < html.indexOf('SADECE İRSALİYE'));
});

test('unknown sip says it is in neither file', () => {
  const netsis = sk.parseNetsisGrid(NETSIS);
  const amir = api.parseAmirGrid(AMIR);
  const diff = api.compareRange(netsis, amir, { from: '2026-01-01', to: '2026-12-31' }, { sip: 'M20202600000000' });
  assert.match(api.resultMessage(diff).text, /iki dosyada da yok/);
});

test('same irsaliye stays matched when the plate has a one-digit typo', () => {
  const netsis = sk.parseNetsisGrid([
    ['SIRKET', 'TARIH', 'SIPNO', 'IRSALIYE_NO', 'FIRMA_KODU', 'BOOKING', 'IRS_MIKTAR_OB1', 'KANTAR', 'ACIKLAMA1', 'ACIKLAMA2', 'PLAKA', 'TASICIYI_AD_SOYAD'],
    ['MADEN26', '16.09.2026', 'M20202600000684', 'R11202600001402', 'YD1', '1', 31200, 31460, 'BBT', 24, '43AEA633', 'ALI']
  ]);
  const amir = api.parseAmirGrid([
    ['FİRMA KODU', 'İRS. NO', 'AY', 'İRS. TARİHİ', 'SEVK TİPİ', 'FİRMA', 'MALZEME', 'İRS. TONAJI', 'KANTAR TONAJI', 'AMBALAJ', 'MİKTAR', 'BOŞ BBT', 'BOŞ ÇUVAL', 'PALET', 'PLAKA', 'SİPARİŞ NO'],
    ['R11', '202600001402', 9, '16.09.2026', 'YD-HP', 'YD1', 'HP 0.074-0.30', 31200, 31460, 'BBT', 24, 0, 0, 0, '43AEA533', 'M20202600000684']
  ]);
  const diff = api.compareRange(netsis, amir, { from: '2026-09-16', to: '2026-09-16' });
  assert.equal(diff.summary.matchedOk, 1);
  assert.equal(diff.summary.onlyNetsis, 0);
  assert.equal(diff.summary.onlyAmir, 0);
  assert.match(diff.rows[0].plaka, /43AEA633/);
  assert.match(diff.rows[0].plaka, /43AEA533/);
  assert.equal(diff.rows[0].netsisIrs, 'R11202600001402');
  assert.equal(diff.rows[0].amirIrs, 'R11202600001402');
});

test('I series rows are left out of the compare', () => {
  const netsis = sk.parseNetsisGrid(NETSIS);
  const amir = api.parseAmirGrid(AMIR.concat([
    ['I01', '2026000002583', 9, '10.09.2026', 'Yİ-HP', 'X', 'HP', 26900, 26900, 'BBT', 22, 0, 0, 0, '06ERD408', 'M01202600001145']
  ]));
  const diff = api.compareRange(netsis, amir, { from: '2026-09-01', to: '2026-09-30' });
  assert.equal(diff.rows.some((row) => String(row.sip).indexOf('M012') === 0), false);
  assert.equal(diff.rows.some((row) => String(row.amirIrs).indexOf('I') === 0), false);
  assert.ok(diff.rows.some((row) => row.sip === 'M20202600000550'));
});

test('one cuval difference is a mismatch', () => {
  const netsis = sk.parseNetsisGrid([
    ['SIRKET', 'TARIH', 'SIPNO', 'IRSALIYE_NO', 'FIRMA_KODU', 'BOOKING', 'IRS_MIKTAR_OB1', 'KANTAR', 'ACIKLAMA1', 'ACIKLAMA2', 'ACIKLAMA5', 'ACIKLAMA6', 'PLAKA', 'TASICIYI_AD_SOYAD'],
    ['MADEN26', '16.09.2026', 'M20202600000655', 'R11202600001422', 'YD1', '1', 33750, 34560, 'BBT', 25, 'CUVAL', 1350, '03ACR440', 'ALI']
  ]);
  const amir = api.parseAmirGrid([
    ['FİRMA KODU', 'İRS. NO', 'AY', 'İRS. TARİHİ', 'SEVK TİPİ', 'FİRMA', 'MALZEME', 'İRS. TONAJI', 'KANTAR TONAJI', 'AMBALAJ', 'MİKTAR', 'BOŞ BBT', 'BOŞ ÇUVAL', 'PALET', 'PLAKA', 'SİPARİŞ NO'],
    ['R11', '202600001422', 9, '16.09.2026', 'YD-HP', 'YD359', 'HP 1.20-2.80', 33750, 34560, 'BBT', 25, 0, 1351, 0, '03ACR440', 'M20202600000655']
  ]);
  const diff = api.compareRange(netsis, amir, { from: '2026-09-16', to: '2026-09-16' });
  assert.equal(diff.summary.matchedBad, 1);
  assert.equal(diff.rows[0].fields.cuval.left, 1350);
  assert.equal(diff.rows[0].fields.cuval.right, 1351);
  assert.equal(diff.rows[0].fields.cuval.ok, false);
});

test('firma and lot show from both reports', () => {
  const netsis = sk.parseNetsisGrid([
    ['SIRKET', 'TARIH', 'SIPNO', 'IRSALIYE_NO', 'FIRMA_KODU', 'BOOKING', 'IRS_MIKTAR_OB1', 'KANTAR', 'ACIKLAMA1', 'ACIKLAMA2', 'PLAKA', 'TASICIYI_AD_SOYAD'],
    ['MADEN26', '16.09.2026', 'M20202600000655', 'R11202600001422', 'YD359 / LOT NO 26 09 04', '1', 33750, 34560, 'BBT', 25, '03ACR440', 'ALI']
  ]);
  const amir = api.parseAmirGrid([
    ['FİRMA KODU', 'İRS. NO', 'AY', 'İRS. TARİHİ', 'SEVK TİPİ', 'FİRMA', 'LOT NO', 'MALZEME', 'İRS. TONAJI', 'KANTAR TONAJI', 'AMBALAJ', 'MİKTAR', 'BOŞ BBT', 'BOŞ ÇUVAL', 'PALET', 'PLAKA', 'SİPARİŞ NO'],
    ['R11', '202600001422', 9, '16.09.2026', 'YD-HP', 'YD359', '26 09 04', 'HP 1.20-2.80', 33750, 34560, 'BBT', 25, 0, 0, 0, '03ACR440', 'M20202600000655']
  ]);
  const diff = api.compareRange(netsis, amir, { from: '2026-09-16', to: '2026-09-16' });
  assert.equal(diff.rows[0].netsisFirma, 'YD359');
  assert.equal(diff.rows[0].netsisLot, '26 09 04');
  assert.equal(diff.rows[0].amirFirma, 'YD359');
  assert.equal(diff.rows[0].amirLot, '26 09 04');
  const html = api.renderRows(diff, true);
  assert.match(html, />Firma</);
  assert.match(html, />Lot no</);
  assert.match(html, /26 09 04/);
});

test('sipariş no narrows both sides inside the date range', () => {
  const netsis = sk.parseNetsisGrid(NETSIS);
  const amir = api.parseAmirGrid(AMIR);
  const diff = api.compareRange(netsis, amir, { from: '2026-01-01', to: '2026-09-30' }, { sip: '999' });
  assert.equal(diff.ok, true);
  assert.equal(diff.rows.length, 1);
  assert.equal(diff.rows[0].sip, 'M20202600000999');
  assert.equal(diff.rows[0].status, 'ok');
});

test('sevk tipi narrows the amir side', () => {
  const netsis = sk.parseNetsisGrid(NETSIS);
  const amir = api.parseAmirGrid(AMIR);
  const diff = api.compareRange(netsis, amir, { from: '2026-01-01', to: '2026-09-30' }, { sevkTipi: 'Yİ-HP' });
  assert.equal(diff.rows.length, 1);
  assert.equal(diff.rows[0].sevkTipi, 'Yİ-HP');
  assert.equal(diff.rows[0].status, 'ok');
});

test('rangePresets week starts Monday', () => {
  const span = api.rangePresets(new Date(2026, 8, 28));
  assert.equal(span.today.from, '2026-09-28');
  assert.equal(span.week.from, '2026-09-28');
  assert.equal(span.week.to, '2026-10-04');
  assert.equal(span.month.from, '2026-09-01');
  assert.equal(span.month.to, '2026-09-30');
});

test('Amir page is wired from the hub', () => {
  const page = fs.readFileSync(path.join(__dirname, '../public/amir-kontrol.html'), 'utf8');
  assert.match(page, /id="amPage"/);
  assert.match(page, /id="amFrom"/);
  assert.match(page, /id="amTo"/);
  assert.match(page, /id="amSip"/);
  assert.match(page, /Netsis raporu/);
  assert.match(page, /İrsaliye Excel/);
  assert.match(page, /Bystoker/);
  assert.match(page, /fa-hard-hat/);
  assert.doesNotMatch(page, /Beyaz baret/);
  assert.match(page, /modules\/amir-kontrol\.js/);
  assert.match(page, /modules\/sayi-kontrol\.js/);
  const hub = fs.readFileSync(path.join(__dirname, '../public/ihracat-takip.html'), 'utf8');
  assert.match(hub, /amir-kontrol\.html/);
  const session = fs.readFileSync(path.join(__dirname, '../public/session-manager.js'), 'utf8');
  assert.match(session, /amir-kontrol\.html/);
});
