'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const reportJs = fs.readFileSync(path.join(__dirname, '../public/report.js'), 'utf8');
const raporHtml = fs.readFileSync(path.join(__dirname, '../public/rapor.html'), 'utf8');

function loadGirisBildirApi() {
  const start = reportJs.indexOf('function buildGirisBildirText(items)');
  const end = reportJs.indexOf('function collectSelectedReportRows()');
  assert.ok(start >= 0, 'buildGirisBildirText missing');
  assert.ok(end > start, 'collectSelectedReportRows missing');
  return eval(`(function(){\n${reportJs.slice(start, end)}\nreturn { buildGirisBildirText };\n})()`);
}

test('rapor.html has Giriş Bildir and select-all', () => {
  assert.match(raporHtml, /id="girisBildirBtn"/);
  assert.match(raporHtml, /Giriş Bildir/);
  assert.match(raporHtml, /id="selectAllRowsChk"/);
});

test('buildGirisBildirText lists selected plates then giriş yaptı', () => {
  const api = loadGirisBildirApi();
  const text = api.buildGirisBildirText([
    { plate: '06 FLN 416', firma: 'ABC LTD', basimYeri: 'AVDAN' },
    { plate: '34 ABC 123', firma: 'DEF', basimYeri: '1.OSB' },
    { plate: '43 NL 175', firma: '', basimYeri: '' }
  ]);
  assert.match(text, /06 FLN 416 - ABC LTD - AVDAN/);
  assert.match(text, /34 ABC 123 - DEF - 1\.OSB/);
  assert.match(text, /43 NL 175/);
  assert.match(text, /Bu araçlar giriş yaptı\./);
});

test('buildGirisBildirText uses singular for one vehicle', () => {
  const api = loadGirisBildirApi();
  const text = api.buildGirisBildirText([{ plate: '06 FLN 416', firma: 'ABC' }]);
  assert.equal(text, '06 FLN 416 - ABC\n\nBu araç giriş yaptı.');
});
