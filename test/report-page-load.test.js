'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const reportJs = fs.readFileSync(path.join(__dirname, '../public/report.js'), 'utf8');
const raporHtml = fs.readFileSync(path.join(__dirname, '../public/rapor.html'), 'utf8');

test('rapor ilk açılışta bugünü slim + since/until ile çeker', () => {
  assert.match(reportJs, /function buildReportsListQuery/);
  assert.match(reportJs, /params\.set\('slim', '1'\)/);
  assert.match(reportJs, /params\.set\('since'/);
  assert.match(reportJs, /params\.set\('until'/);
  assert.match(reportJs, /__reportsDatePreset = 'today'/);
  assert.match(reportJs, /T00:00:00\+03:00/);
  assert.doesNotMatch(reportJs, /\/api\/reports\?_=' \+ Date\.now\(\)/);
});

test('tekrar yazdır tek kaydı id ile alır', () => {
  assert.match(reportJs, /\/api\/reports\?id=/);
  assert.doesNotMatch(reportJs, /\/api\/reports\?limit=300/);
});

test('rapor html istek cache kırıcıyı güncel tutar', () => {
  assert.match(raporHtml, /report\.js\?v=20260907-fastlist/);
  assert.match(raporHtml, /Yükleniyor/);
});
