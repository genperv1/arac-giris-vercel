'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildArchiveWorkbook } = require('../public/liman-xlsx');

test('arşiv indirişi örnek ihracat takip listesi biçiminde xlsx üretir', () => {
  const bytes = buildArchiveWorkbook({
    label: '03.10.2026',
    blocks: [{
      title: 'YD92(M) / LOT NO 26 08 10 / HP 0,074-0,30 / 230 TON / NET 1150 KG BIGBAG / BOOKING NO : ISTG17833600 / GEMİ DETAYI : MSC ZOE / EVYAP',
      liman: 'EVYAP',
      gemi: 'MSC ZOE',
      booking: 'ISTG17833600',
      sevk: '03.10.2026',
      dolum: '05.10.2026 PAZARTESİ',
      tasiyici: 'AKYÜZ',
      lot: '26 08 10',
      sip: 'M20202600000613',
      rows: [
        { sira: '1', plaka: '43FV215', bbt: '26', palet: '13', bosBbt: '1', giden: '30160', yukleme: 'AVDAN', sofor: 'HALİL ATASOY', telefon: '5458513894', irsaliye: 'R01 202604066', kantarGiris: '05.10.2026 04:43', kantarCikis: '05.10.2026 05:40' },
        { sira: '2', plaka: '43ACN771', bbt: '26', giden: '30260', yukleme: 'AVDAN', sofor: 'GÜNAY', telefon: '5385010166', irsaliye: 'R01 202604067' },
      ],
    }, {
      title: 'YD47(M) / LOT NO 26 08 32 / HP 0,00-0,074 / NET 1000 KG / SAFİPORT',
      liman: 'SAFİPORT',
      tasiyici: 'AKYÜZ',
      rows: [
        { sira: '1', plaka: '43AEA633', bbt: '20', giden: '20240', yukleme: 'AVDAN', sofor: 'RAMAZAN', irsaliye: 'R01 202604074' },
      ],
    }],
  });
  assert.equal(bytes[0], 0x50);
  assert.equal(bytes[1], 0x4b);
  const xml = new TextDecoder().decode(bytes);
  assert.match(xml, /İHRACAT TAKİP LİSTESİ/);
  assert.match(xml, /SEVKİYATLARDA DİKKAT EDİLECEK HUSUSLAR/);
  assert.match(xml, /TEDARİKÇİYE GÖNDERİLDİ Mİ\?/);
  assert.match(xml, /PERFORMANSA İŞLENDİ Mİ\?/);
  assert.match(xml, /MAX\. ARTI TOLERANS/);
  assert.match(xml, /PLAKA/);
  assert.match(xml, /GİDEN TONAJ/);
  assert.match(xml, /O\.GR\. TONAJ/);
  assert.match(xml, /KANTAR GİRİŞ/);
  assert.match(xml, /KANTAR ÇIKIŞ/);
  assert.match(xml, /SIRANO/);
  assert.match(xml, /İRSALİYE NO/);
  assert.match(xml, /FİİLİ SEVK TARİHİ/);
  assert.match(xml, /ŞOFÖR BİLGİLERİ/);
  assert.match(xml, /BİRİM AMBALAJ AĞIRLIĞI/);
  assert.match(xml, /FATURA BAŞLIĞI/);
  assert.match(xml, /43FV215/);
  assert.match(xml, /HALİL ATASOY/);
  assert.match(xml, /EVYAP/);
  assert.match(xml, /SAFİPORT/);
  assert.match(xml, /TOPLAM/);
  assert.match(xml, /KALAN/);
  assert.match(xml, /ORTALAMA/);
  assert.match(xml, /GELMEDİ/);
  assert.match(xml, /MADENCİLİK KESİLECEK/);
  assert.match(xml, /GENPER MADENCİLİK/);
  assert.match(xml, /\(D13\*\$B\$12\)\+\(\$B\$12\*E13\)/);
  assert.match(xml, /SUM\(D13:D14\)/);
  assert.match(xml, /<v>30160<\/v>/);
  assert.match(xml, /<v>1150<\/v>/);
  assert.match(xml, /FFFFFF00/);
  assert.match(xml, /FBE5D6/);
  assert.match(xml, /FFF2CC/);
  assert.match(xml, /FFFF0000/);
  assert.match(xml, /YD92\(M\) \/ LOT NO 26 08 10/);
  assert.match(xml, /NETSIS SİPARİŞ NO : M20202600000613/);
  assert.match(xml, /LİMAN DOLUM TARİHİ : 05\.10\.2026 PAZARTESİ/);
  assert.match(xml, /<v>5458513894<\/v>/);
  assert.match(xml, /<f>M12<\/f>/);
  assert.doesNotMatch(xml, /<f>Y13<\/f>/);
  assert.doesNotMatch(xml, /###\\-####/);
  assert.doesNotMatch(xml, /LİMAN DOLUM TARİHİ : S\.TARİHİ/);
  assert.doesNotMatch(xml, /<html/i);
  const second = xml.indexOf('YD47');
  assert.ok(second > 0);
  assert.match(xml.slice(second), /\(D\d+\*\$B\$\d+\)/);
});
