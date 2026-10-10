'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { answerOzet } = require('../lib/ozet-bot');

const NOW = new Date('2026-10-10T06:00:00.000Z');

function state() {
  return {
    sites: {
      AVDAN: {
        fileName: '10.10.2026.xlsx',
        blocks: [{
          title: 'YD92(M) / HP96 / 100 BBT / GEMLIK',
          liman: 'GEMLİK',
          yd: 'YD92',
          fileName: '10.10.2026.xlsx',
          rows: [
            { plaka: '43ADK534', bbt: '24', sofor: 'HASAN HÜSEYİN', durum: 'DIŞARIDA', giden: '25000', kantarGiris: '08:14', kantarCikis: '11:02', irsaliye: 'I102' },
            { plaka: '43ABR539', bbt: '24', sofor: 'ALİ', durum: '', giden: '' },
          ],
        }],
      },
    },
  };
}

test('günün özeti plan, çıkan ve gelmeyen plakayı söyler', () => {
  const reply = answerOzet(state(), 'günün özetini geç', NOW);
  assert.match(reply, /10\.10\.2026/);
  assert.match(reply, /100 BBT idi/);
  assert.match(reply, /BBT kaldı/);
  assert.match(reply, /çıktı/);
  assert.match(reply, /Gelmedi:\n43ABR539/);
  assert.equal(/\+\d/.test(reply), false);
});

test('sevkiyat kodu ve plaka saati, tarihi, şoförü söyler', () => {
  const code = answerOzet(state(), 'hp96 çıktı mı', NOW);
  assert.match(code, /Henüz tam çıkmadı/);
  assert.match(code, /43ABR539/);
  const plate = answerOzet(state(), '43ADK534', NOW);
  assert.match(plate, /geldi ve çıktı/);
  assert.match(plate, /10\.10\.2026/);
  assert.match(plate, /Giriş 08:14/);
  assert.match(plate, /Çıkış 11:02/);
  assert.match(plate, /HASAN/);
  const irs = answerOzet(state(), 'i102', NOW);
  assert.match(irs, /43ADK534/);
});

test('G16 bu haftanın çıkan plakalarını ve Excel satırını söyler', () => {
  const { speak } = require('../lib/ozet-bot');
  const reply = speak([{ role: 'user', text: 'G16' }], {
    now: NOW,
    liman: { sites: {} },
    piyasa: {
      week: 41,
      orders: [{ siraNo: '12', firma: 'G16', malzeme: 'UN', il: 'BURSA', miktar: '25 TON' }],
    },
    cikanlar: [
      { plaka: '43AAA111', sofor: 'ALİ', firma: 'G16BGP', hafta: '41', tarih: NOW.getTime() },
      { plaka: '43BBB222', sofor: 'VELİ', firma: 'G16', hafta: '41', tarih: NOW.getTime() },
      { plaka: '43CCC333', sofor: 'X', firma: 'G16', hafta: '40', tarih: NOW.getTime() },
    ],
  });
  assert.match(reply, /2 plaka çıktı/);
  assert.match(reply, /43AAA111/);
  assert.match(reply, /43BBB222/);
  assert.equal(/43CCC333/.test(reply), false);
  assert.match(reply, /41\. hafta Excel satır 12/);
  assert.equal(/sevkiyat açık/.test(reply), false);
  const pay = speak([{ role: 'user', text: 'G16 ödemesi müşteri mi' }], {
    now: NOW,
    piyasa: {
      week: 41,
      orders: [{ siraNo: '6', firma: 'G16', firmaAdi: 'ÖRNEK', odemeTuru: 'MÜŞTERİ', malzeme: 'UN', il: 'BURSA', miktar: '25 TON' }],
    },
    cikanlar: [],
  });
  assert.match(pay, /Evet/);
  assert.match(pay, /ödeme türü müşteri/);
  assert.match(pay, /satır 6/);
  assert.equal(/sevkiyat açık/.test(pay), false);
  assert.equal(/çıkanlarda yok/.test(pay), false);
});

test('lafı kod sanmaz, konuşmayı hatırlar', () => {
  const hello = answerOzet(state(), 'napıyorsun', NOW);
  assert.equal(/listesinde yok/.test(hello), false);
  assert.match(hello, /Firma kodu/);
  const { speak } = require('../lib/ozet-bot');
  const again = speak([
    { role: 'user', text: 'hp96 çıktı mı' },
    { role: 'assistant', text: 'baktım' },
    { role: 'user', text: 'peki şoförü' },
  ], { liman: state(), now: NOW });
  assert.match(again, /YD92|HASAN|43ABR539/);
  assert.match(answerOzet({ sites: {} }, 'günün özeti', NOW), /açık sevkiyat listesi yok/);
});
