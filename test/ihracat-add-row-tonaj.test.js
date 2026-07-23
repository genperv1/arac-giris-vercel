'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const modalCode = fs.readFileSync(
  path.join(__dirname, '../public/modules/app-ihracat-modal.js'),
  'utf8'
);
const excelCode = fs.readFileSync(
  path.join(__dirname, '../public/modules/app-excel-ihracat.js'),
  'utf8'
);

test('add-row Sil cell already has data-ihr-col=sil (no duplicate TD on commit)', () => {
  const fnStart = modalCode.indexOf('function _ihracatRenderExcelSheetAddRow');
  const fnEnd = modalCode.indexOf('function _ihracatAmbalajCuvalTransferBtnHtml');
  assert.ok(fnStart >= 0 && fnEnd > fnStart);
  const body = modalCode.slice(fnStart, fnEnd);
  assert.match(body, /data-ihr-col="sil"/);
  assert.match(body, /data-ihr-col="plaka"/);
  assert.match(body, /data-ihr-col="bbt"/);
  assert.match(body, /data-ihr-col="tonaj"/);
});

test('plate commit refreshes Sil cell instead of insertBefore duplicate', () => {
  const printCode = fs.readFileSync(
    path.join(__dirname, '../public/modules/app-ihracat-print.js'),
    'utf8'
  );
  const start = printCode.indexOf('const onPlateCommit');
  const end = printCode.indexOf('modal.querySelectorAll(\'tr[data-ihr-add-row]\')');
  assert.ok(start >= 0 && end > start);
  const body = printCode.slice(start, end);
  assert.match(body, /querySelector\('td\[data-ihr-col="sil"\]'\)/);
  assert.doesNotMatch(body, /insertBefore\(silTd/);
  assert.match(body, /innerHTML = _ihracatRowDelBtnHtml/);
});

test('BBT × NET kg auto tonaj helpers exist', () => {
  assert.match(modalCode, /function _ihracatAutoFillTonajFromBbt/);
  assert.match(modalCode, /function _ihracatResolveBlockNetKg/);
  assert.match(modalCode, /_ihracatAutoFillTonajFromBbt\(row\)/);
  assert.match(excelCode, /function extractNetKgFromAmbalajText/);
});

test('_ihracatAutoFillTonajFromBbt computes BBT × 1250', () => {
  const excelStart = excelCode.indexOf('function _normalizeAmbalajHeaderRaw');
  const excelEnd = excelCode.indexOf('function normalizeYdKey');
  const modalStart = modalCode.indexOf('function _ihracatParseNum');
  const modalEnd = modalCode.indexOf('const IHR_TOPLAM_ROW_BG');
  assert.ok(excelStart >= 0 && excelEnd > excelStart);
  assert.ok(modalStart >= 0 && modalEnd > modalStart);

  const { extractNetKgFromAmbalajText, _ihracatAutoFillTonajFromBbt } = eval(`(function(){
    ${excelCode.slice(excelStart, excelEnd)}
    function escapeHtml(s){ return String(s ?? ''); }
    ${modalCode.slice(modalStart, modalEnd)}
    return { extractNetKgFromAmbalajText, _ihracatAutoFillTonajFromBbt };
  })()`);

  assert.strictEqual(extractNetKgFromAmbalajText('NET 1250 KG BIGBAG'), 1250);

  const row = {
    getAttribute: () => null,
    closest: (sel) => {
      if (sel === '[data-ihr-block-section]') {
        return {
          querySelector: () => ({ value: 'NET 1250 KG BIGBAG' }),
          getAttribute: () => '',
        };
      }
      if (sel === 'tbody[data-ihr-tbody]') return { getAttribute: () => '{}' };
      return null;
    },
    querySelector: (sel) => {
      if (sel === '[data-field="bbt"]') return { value: '22', disabled: false };
      if (sel === '[data-field="tonaj"]') return tonajInp;
      return null;
    },
  };
  const tonajInp = { value: '', disabled: false };
  assert.strictEqual(_ihracatAutoFillTonajFromBbt(row), true);
  assert.strictEqual(tonajInp.value, '27500');
});
