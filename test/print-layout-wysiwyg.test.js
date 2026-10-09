'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadSettings() {
  const code = fs.readFileSync(
    path.join(__dirname, '../public/print-layout-settings.js'),
    'utf8'
  );
  const sandbox = {
    console,
    localStorage: {
      getItem() { return null; },
      setItem() {},
      removeItem() {},
    },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  return sandbox.PrintLayoutSettings;
}

test('manual note line breaks survive into the print text', () => {
  const PLS = loadSettings();
  const style = PLS.getDefaultFieldStyle('not');
  const raw = 'İrsaliye No: R01\nSATIR BIR\nSATIR IKI';
  const out = PLS.normalizeNotePlainText(raw, { style });
  assert.deepStrictEqual(out.split('\n'), ['İrsaliye No: R01', 'SATIR BIR', 'SATIR IKI']);
});

test('a single paragraph still breaks on the configured phrase', () => {
  const PLS = loadSettings();
  const style = Object.assign({}, PLS.getDefaultFieldStyle('not'), {
    breakAfter: ['SEVK EDİLECEK'],
    maxLines: 3,
  });
  const raw = 'İrsaliye No: R01\nNET 10 KG SEVK EDİLECEK ÖZEL ETİKET VAR';
  const out = PLS.normalizeNotePlainText(raw, { style });
  assert.deepStrictEqual(out.split('\n'), [
    'İrsaliye No: R01',
    'NET 10 KG SEVK EDİLECEK',
    'ÖZEL ETİKET VAR',
  ]);
});

test('print html keeps an explicit newline as pre-line', () => {
  const PLS = loadSettings();
  const html = PLS.buildTextInnerHtml('NET 1250 KG\nLİNERLİ', {
    wrap: 'wrap',
    fontPt: 8.5,
    lineHeight: 1.12,
    align: 'center',
    fontWeight: 700,
  });
  assert.match(html, /white-space:pre-line/);
  assert.match(html, /NET 1250 KG\nLİNERLİ/);
});
