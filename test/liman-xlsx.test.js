'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildArchiveWorkbook } = require('../public/liman-xlsx');

test('arşiv indirişi gerçek xlsx tablosu üretir', () => {
  const bytes = buildArchiveWorkbook({
    label: '03.10.2026',
    blocks: [{
      title: 'YD15 / LOT NO 26 07 30 / SAFİPORT',
      liman: 'SAFİPORT',
      gemi: 'COSCO',
      booking: 'BK1',
      sevk: '03.10.2026',
      tasiyici: 'AKYÜZ',
      lot: '26 07 30',
      sip: 'S1',
      fileName: '03.10.2026',
      rows: [
        { sira: '1', plaka: '43RY761', bbt: '20', cuval: '0', net: '26.5', giden: '26500', yukleme: 'AVDAN', sofor: 'ALI', telefon: '555', irsaliye: 'R11' },
        { sira: '2', plaka: '06ABC01', bbt: '10', giden: '10000', yukleme: 'AVDAN', sofor: 'VELI' },
      ],
    }],
  });
  assert.equal(bytes[0], 0x50);
  assert.equal(bytes[1], 0x4b);
  const xml = new TextDecoder().decode(bytes);
  assert.match(xml, /İRSALİYE/);
  assert.match(xml, /SIRANO/);
  assert.match(xml, /PLAKA/);
  assert.match(xml, /GİDEN TONAJ/);
  assert.match(xml, /43RY761/);
  assert.match(xml, /TOPLAM/);
  assert.match(xml, /SAFİPORT/);
  assert.match(xml, /<v>30<\/v>/);
  assert.doesNotMatch(xml, /<html/i);
});
