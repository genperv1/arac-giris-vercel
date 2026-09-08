'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const utilsPath = path.join(__dirname, '../public/modules/app-ui-utils.js');
const cardPath = path.join(__dirname, '../public/modules/app-issues-core.js');
const iconPath = path.join(__dirname, '../public/assets/excel-copy.png');
const utilsCode = fs.readFileSync(utilsPath, 'utf8');
const cardCode = fs.readFileSync(cardPath, 'utf8');

function loadExcelCopyApi() {
  const start = utilsCode.indexOf('function safeExcelText(value) {');
  const end = utilsCode.indexOf('function copyExcelData(vehicle)');
  assert.ok(start >= 0, 'safeExcelText missing');
  assert.ok(end > start, 'copyExcelData missing');
  return eval(`(function(){\n${utilsCode.slice(start, end)}\nreturn { formatPhoneForExcel, formatExcelDateTime, copyExcelVehicleText, resolveExcelEntryDate };\n})()`);
}

test('excel copy icon is served from public/assets', () => {
  assert.ok(fs.existsSync(iconPath), 'public/assets/excel-copy.png missing');
  const buf = fs.readFileSync(iconPath);
  assert.ok(buf.length > 100, 'excel-copy.png looks empty');
  assert.equal(buf.slice(0, 8).toString('hex'), '89504e470d0a1a0a', 'excel-copy.png must be a PNG');
});

test('driver card places excel copy button next to netsis', () => {
  assert.match(cardCode, /class="netsis-btn"/);
  assert.match(cardCode, /class="excel-copy-btn"/);
  const netsisAt = cardCode.indexOf('class="netsis-btn"');
  const excelAt = cardCode.indexOf('class="excel-copy-btn"');
  assert.ok(excelAt > netsisAt, 'Excel button should sit right after NETSIS');
  assert.match(cardCode, /EXCEL_COPY_ICON_SRC/);
});

test('copyExcelVehicleText uses form print time then copy time', () => {
  const api = loadExcelCopyApi();
  const printed = new Date('2026-09-07T15:34:44+03:00');
  const copied = new Date('2026-09-08T16:10:05+03:00');
  const text = api.copyExcelVehicleText({
    soforAdi: 'YASİN',
    soforSoyadi: 'TEKİN',
    iletisim: '0505 659 40 85',
    lastPrintSnapshot: { ts: printed.getTime() }
  }, copied, printed);
  const parts = text.split('\t');
  assert.equal(parts.length, 4);
  assert.equal(parts[0], 'YASİN TEKİN');
  assert.equal(parts[1], '(505) 659-4085');
  assert.match(parts[2], /2026/);
  assert.match(parts[2], /15:34:44/);
  assert.match(parts[3], /16:10:05/);
  assert.notEqual(parts[2], parts[3], 'giriş form basımı, ikinci saat kopyalama anı olmalı');
});

test('copyExcelVehicleText falls back when name, phone or print time is missing', () => {
  const api = loadExcelCopyApi();
  const text = api.copyExcelVehicleText({ cekiciPlaka: '06 FLN 416' }, new Date('2026-09-08T00:00:00+03:00'));
  const parts = text.split('\t');
  assert.equal(parts[0], '-');
  assert.equal(parts[1], '-');
  assert.equal(parts[2], '-');
  assert.match(parts[3], /2026/);
});

test('resolveExcelEntryDate reads lastPrintSnapshot', () => {
  const api = loadExcelCopyApi();
  const printed = new Date('2026-09-07T11:22:33+03:00');
  const got = api.resolveExcelEntryDate({ lastPrintSnapshot: { ts: printed.getTime() } });
  assert.ok(got instanceof Date);
  assert.equal(got.getTime(), printed.getTime());
});
