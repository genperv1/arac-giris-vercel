'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const printMain = fs.readFileSync(
  path.join(__dirname, '../public/modules/print-main.js'),
  'utf8'
);
const ihrPrint = fs.readFileSync(
  path.join(__dirname, '../public/modules/app-ihracat-print.js'),
  'utf8'
);

test('yazdırma Chrome/Edge için otomatik print() atlamaz', () => {
  assert.doesNotMatch(printMain, /if \(isChromeOrEdge\(\)\) return/);
  assert.match(printMain, /w\.print\(\)/);
});

test('ihracat açıklaması yazdırmada 35 adımlık büyütme döngüsü yok', () => {
  assert.doesNotMatch(printMain, /grow < 35/);
});

test('ihracat liste yazdırma her satıra page-break-inside:avoid koymaz', () => {
  assert.doesNotMatch(
    ihrPrint,
    /\.ihr-print-plaka-table tr \{[^}]*page-break-inside:\s*avoid/
  );
});
