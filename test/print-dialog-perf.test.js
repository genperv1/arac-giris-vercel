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
const excelIhr = fs.readFileSync(
  path.join(__dirname, '../public/modules/app-excel-ihracat.js'),
  'utf8'
);
const ihrModal = fs.readFileSync(
  path.join(__dirname, '../public/modules/app-ihracat-modal.js'),
  'utf8'
);
const vehiclesJs = fs.readFileSync(
  path.join(__dirname, '../public/modules/app-vehicles.js'),
  'utf8'
);
const notesJs = fs.readFileSync(
  path.join(__dirname, '../public/operation-notes-alert.js'),
  'utf8'
);
const reportsRoute = fs.readFileSync(
  path.join(__dirname, '../routes/reports-routes.js'),
  'utf8'
);

test('Yazdır her basımda yeni çerçeve açar; önizleme overlay kullanmaz', () => {
  assert.match(printMain, /function createDirectPrintFrame/);
  assert.match(printMain, /function removeDirectPrintFrame/);
  assert.match(printMain, /takipDirectPrintFrame/);
  assert.match(printMain, /w\.print\(\)/);
  assert.doesNotMatch(printMain, /window\.open\('', 'takipPrint'\)/);
  assert.doesNotMatch(printMain, /if \(isChromeOrEdge\(\)\) return/);
  assert.match(printMain, /if \(!isPreview\) \{\s*doPrint\(\);/);
  const giris = fs.readFileSync(path.join(__dirname, '../public/GIRIS.html'), 'utf8');
  assert.doesNotMatch(giris, /id="onizlemeButton"/);
});

test('Yazdır çerçeve görseli HTTP URL kullanır (blob Chrome yazdırmada düşer)', () => {
  assert.match(printMain, /function waitForPrintDocumentImages/);
  assert.match(printMain, /\.plf-bg, \.bg/);
  assert.doesNotMatch(printMain, /if \(window\.__printBgBlobUrl\) return window\.__printBgBlobUrl/);
  assert.match(printMain, /blob: Chrome yazdırmada çerçeveyi düşürür/);
});

test('ihracat açıklaması yazdırmada 35 adımlık büyütme döngüsü yok', () => {
  assert.doesNotMatch(printMain, /grow < 35/);
});

test('ihracat yazdırmada sığdırma döngüsü atlanır', () => {
  assert.match(printMain, /skipShrink = kind === 'ihracat'/);
  assert.match(printMain, /if \(kind !== 'ihracat'\) \{/);
});

test('ihracat liste yazdırma her satıra page-break-inside:avoid koymaz', () => {
  assert.doesNotMatch(
    ihrPrint,
    /\.ihr-print-plaka-table tr \{[^}]*page-break-inside:\s*avoid/
  );
});

test('ihracat yazdırma geçmişi 8000 kayıt + tam snapshot çekmez', () => {
  assert.doesNotMatch(ihrPrint, /limit=8000/);
  assert.match(ihrPrint, /slim=1/);
  assert.match(ihrPrint, /_ihracatPrintReportsWindow/);
});

test('Yazdır tıklanınca ihracat paneli ağı beklemez', () => {
  const start = excelIhr.indexOf('function ensureIhracatExcelPickBeforePrint');
  const end = excelIhr.indexOf('async function maybeOfferIhracatExcelPickOnOpen');
  assert.ok(start >= 0 && end > start, 'ensureIhracatExcelPickBeforePrint bulunamadı');
  const fn = excelIhr.slice(start, end);
  assert.doesNotMatch(fn, /async function ensureIhracatExcelPickBeforePrint/);
  assert.doesNotMatch(fn, /await /);
});

test('Excel satırındaki açıklama takip formuna yazılır', () => {
  assert.match(excelIhr, /function _resolveShipmentYuklemeNotu/);
  assert.match(excelIhr, /_resolveShipmentYuklemeNotu\(chosen\)/);
  assert.match(ihrModal, /_resolveShipmentYuklemeNotu/);

  const start = excelIhr.indexOf('function _resolveShipmentYuklemeNotu');
  const end = excelIhr.indexOf('window._resolveShipmentYuklemeNotu');
  assert.ok(start >= 0 && end > start);
  const resolve = eval(`(function(){ function getIhracatBlockFooterNote(s){ return String(s && s.blockFooterNote || ''); }\n${excelIhr.slice(start, end)}\nreturn _resolveShipmentYuklemeNotu; })()`);
  assert.equal(resolve({ yuklemeNotu: 'LOT NO 1' }), 'LOT NO 1');
  assert.equal(
    resolve({ blockFooterNote: 'SEVKİYATLARDA DİKKAT EDİLECEK HUSUSLAR' }),
    'SEVKİYATLARDA DİKKAT EDİLECEK HUSUSLAR'
  );
});

test('Yazdır tıklanınca ağ veya vardiya notu beklemez', () => {
  const start = vehiclesJs.indexOf("yazdirBtn.addEventListener('click'");
  const end = vehiclesJs.indexOf("onizlemeBtn.addEventListener('click'");
  assert.ok(start >= 0 && end > start);
  const fn = vehiclesJs.slice(start, end);
  assert.doesNotMatch(fn, /async function/);
  assert.doesNotMatch(fn, /await /);
  const noteStart = notesJs.indexOf('function confirmBeforePrint');
  const noteEnd = notesJs.indexOf('async function getMatchingNotes');
  assert.ok(noteStart >= 0 && noteEnd > noteStart);
  const noteFn = notesJs.slice(noteStart, noteEnd);
  assert.doesNotMatch(noteFn, /await fetchActiveNotes/);
});

test('slim rapor listesi since/until destekler', () => {
  assert.match(reportsRoute, /parseReportsListQuery/);
  assert.match(reportsRoute, /listQ\.slim/);
  assert.match(reportsRoute, /tarih >= \$/);
});
