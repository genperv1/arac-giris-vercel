'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const isg = require('../public/modules/isg-form');

test('unsigned when no matching record exists', () => {
  const st = isg.resolveIsgStatus({
    id: '1',
    cekiciPlaka: '34 ABC 123',
    soforAdi: 'Ali',
    soforSoyadi: 'Yılmaz',
    tcKimlik: '10000000146'
  }, []);
  assert.equal(st.signed, false);
});

test('same driver stays signed across plates, including after TC is added', () => {
  const records = [{
    id: 'isg1',
    signed: true,
    signedAt: 10,
    driverKey: 'name:ALİ YILMAZ',
    nameKey: 'name:ALİ YILMAZ',
    plateKey: '34abc123',
    docNo: '14',
    formCode: 'ISG-T004',
    recordedBy: 'AYSE'
  }];
  const otherPlate = isg.resolveIsgStatus({
    cekiciPlaka: '06 FLN 416',
    soforAdi: 'Ali',
    soforSoyadi: 'Yılmaz'
  }, records);
  assert.equal(otherPlate.signed, true);
  assert.equal(otherPlate.record.docNo, '14');

  const withTc = isg.resolveIsgStatus({
    cekiciPlaka: '06 FLN 416',
    soforAdi: 'ALİ',
    soforSoyadi: 'YILMAZ',
    tcKimlik: '10000000146'
  }, records);
  assert.equal(withTc.signed, true);
});

test('a different driver on the same plate stays unsigned', () => {
  const records = [{
    signed: true,
    signedAt: 20,
    driverKey: 'tc:10000000146',
    nameKey: 'name:ALİ YILMAZ',
    plateKey: '34abc123'
  }];
  const st = isg.resolveIsgStatus({
    cekiciPlaka: '34 ABC 123',
    soforAdi: 'Veli',
    soforSoyadi: 'Demir',
    tcKimlik: '10000000146'.replace('146', '147')
  }, records);
  assert.equal(st.signed, false);
});

test('plate-only record applies only when the card has no driver', () => {
  const records = [{
    signed: true,
    signedAt: 5,
    driverKey: '',
    nameKey: '',
    plateKey: '34abc123',
    recordedBy: 'KANTAR'
  }];
  const bare = isg.resolveIsgStatus({ cekiciPlaka: '34-ABC-123' }, records);
  assert.equal(bare.signed, true);
  const named = isg.resolveIsgStatus({
    cekiciPlaka: '34 ABC 123',
    soforAdi: 'Veli',
    soforSoyadi: 'Demir'
  }, records);
  assert.equal(named.signed, false);
});

test('print badge and commitment use the signed and unsigned wording', () => {
  const ok = isg.printBadgeHtml(true);
  const miss = isg.printBadgeHtml(false);
  assert.match(ok, /İSG Formu İmzalı/);
  assert.match(ok, /isg-stamp--ok/);
  assert.match(miss, /İSG Formu İmzasız/);
  assert.match(miss, /isg-stamp--miss/);

  const html = isg.buildCommitmentHtml({
    driverName: 'Ali <script>',
    plateText: '34 ABC 123'
  });
  assert.match(html, /GENEL İŞ GÜVENLİĞİ TALİMAT VE TAAHHÜTNAMESİ/);
  assert.match(html, /ISG-T004/);
  assert.match(html, /Ali &lt;script&gt;/);
  assert.match(html, /34 ABC 123/);
  assert.doesNotMatch(html, /<script>/);
});

test('save payload keeps form code and rejects a bad file or url', () => {
  const payload = isg.buildSavePayload({
    cekiciPlaka: '34 ABC 123',
    soforAdi: 'Ali',
    soforSoyadi: 'Yılmaz',
    tcKimlik: '10000000146',
    signed: true,
    docNo: 'EV-9'
  }, 'ayse');
  assert.equal(payload.formCode, 'ISG-T004');
  assert.equal(payload.docNo, 'EV-9');
  assert.equal(payload.recordedBy, 'ayse');
  assert.equal(payload.signed, true);
  assert.match(payload.driverKey, /^tc:/);
  assert.match(payload.nameKey, /^name:/);
  assert.equal(isg.safeHttpUrl('javascript:alert(1)'), '');
  assert.equal(isg.safeHttpUrl('https://arsiv.example/isg.pdf'), 'https://arsiv.example/isg.pdf');
  assert.equal(isg.safeFileData('data:text/html;base64,YQ=='), null);
  assert.match(isg.safeFileData('data:image/png;base64,YQ=='), /^data:image\/png/);
});

test('card shows only İSG Formu İmzasız or İmzalı', () => {
  isg._state.loaded = true;
  isg._state.records = [];
  const unsigned = isg.cardHtml({ cekiciPlaka: '34 ABC 123', soforAdi: 'Ali', soforSoyadi: 'Yılmaz' });
  assert.match(unsigned, /İSG Formu İmzasız/);
  assert.doesNotMatch(unsigned, /İmzalandı/);
  assert.doesNotMatch(unsigned, /isg-open-btn/);
  isg._state.records = [{
    signed: true,
    signedAt: 10,
    driverKey: 'name:ALİ YILMAZ',
    nameKey: 'name:ALİ YILMAZ',
    plateKey: '34abc123'
  }];
  const signed = isg.cardHtml({ cekiciPlaka: '34 ABC 123', soforAdi: 'Ali', soforSoyadi: 'Yılmaz' });
  assert.match(signed, /İSG Formu İmzalı/);
  assert.doesNotMatch(signed, /Düzenle/);
});

test('shipment print path shows the badge and prints the ISG sheet only when unsigned', () => {
  const printMain = fs.readFileSync(path.join(__dirname, '../public/modules/print-main.js'), 'utf8');
  const takip = fs.readFileSync(path.join(__dirname, '../public/modules/app-ui-forms-takip.js'), 'utf8');
  const vehicles = fs.readFileSync(path.join(__dirname, '../public/modules/app-vehicles.js'), 'utf8');
  const card = fs.readFileSync(path.join(__dirname, '../public/modules/app-issues-core.js'), 'utf8');
  const giris = fs.readFileSync(path.join(__dirname, '../public/GIRIS.html'), 'utf8');
  assert.match(printMain, /printBadgeHtml/);
  assert.match(takip, /isgPrintCtx/);
  assert.match(takip, /printIsgFormWithDialog/);
  assert.match(vehicles, /isgPrint/);
  assert.match(card, /isgCardBlockHTML/);
  assert.match(giris, /modules\/isg-form\.js/);
});
