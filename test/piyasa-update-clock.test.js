'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const excelJs = fs.readFileSync(path.join(root, 'public/modules/app-excel-ihracat.js'), 'utf8');
const uiJs = fs.readFileSync(path.join(root, 'public/modules/app-ui-forms-takip.js'), 'utf8');
const coreJs = fs.readFileSync(path.join(root, 'public/modules/piyasa-core.js'), 'utf8');
const parseJs = fs.readFileSync(path.join(root, 'public/modules/piyasa-excel.js'), 'utf8');

function loadClockFns() {
  const start = excelJs.indexOf('function _piyasaExcelUpdatedIso()');
  const end = excelJs.indexOf('try { window.piyasaUpdateClockMarkup');
  assert.ok(start >= 0 && end > start, 'saat fonksiyonları bulunamadı');
  const context = {
    window: { __PIYASA_STATE__: {} },
    localStorage: { getItem() { return null; } },
    document: { querySelectorAll() { return []; } },
    Intl,
    Date,
  };
  vm.createContext(context);
  vm.runInContext(excelJs.slice(start, end), context);
  return context;
}

test('piyasa güncelleme saati İstanbul saatini yazar ve yenilemede durur', () => {
  const ctx = loadClockFns();
  ctx.window.__PIYASA_STATE__.excelUpdatedAt = '2026-10-07T16:21:00.000Z';
  const parts = ctx._piyasaUpdateClockParts(ctx._piyasaExcelUpdatedIso());
  const today = ctx._istanbulClockFields(new Date().toISOString());
  const sameDay = today && today.day === '07' && today.month === '10' && today.year === '2026';
  if (sameDay) assert.equal(parts.label, 'GÜNCELLEME 19:21');
  else assert.equal(parts.label, 'GÜNCELLEME 07.10 19:21');
  assert.equal(parts.full, '07.10.2026 19:21');

  ctx.window.__PIYASA_STATE__.excelUpdatedAt = '';
  ctx.localStorage.getItem = () => JSON.stringify({ excelUpdatedAt: '2026-10-06T13:05:00.000Z' });
  const stored = ctx._piyasaUpdateClockParts(ctx._piyasaExcelUpdatedIso());
  assert.equal(stored.full, '06.10.2026 16:05');
  assert.match(stored.label, /GÜNCELLEME/);
  assert.match(stored.label, /16:05/);
});

test('Şaban güncellemesi saati kaydeder ve bütün piyasa şeritlerinde gösterir', () => {
  assert.match(parseJs, /state\.excelUpdatedAt = new Date\(\)\.toISOString\(\)/);
  assert.match(coreJs, /excelUpdatedAt: state\.excelUpdatedAt \|\| null/);
  assert.match(coreJs, /state\.excelUpdatedAt = payload\.excelUpdatedAt \|\| null/);
  assert.equal((uiJs.match(/window\.piyasaUpdateClockMarkup\(\)/g) || []).length, 3);
  assert.match(excelJs, /window\.paintPiyasaUpdateClock = _paintPiyasaUpdateClock/);
  assert.match(uiJs, /paintPiyasaUpdateClock/);
});
