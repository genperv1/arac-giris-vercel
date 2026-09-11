'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const src = require('../lib/ihracat-excel-source');

const clientCode = fs.readFileSync(
  path.join(__dirname, '../public/modules/ihracat-excel-source.js'),
  'utf8'
);
const excelIhr = fs.readFileSync(
  path.join(__dirname, '../public/modules/app-excel-ihracat.js'),
  'utf8'
);
const authJs = fs.readFileSync(
  path.join(__dirname, '../public/modules/app-auth.js'),
  'utf8'
);
const uiJs = fs.readFileSync(
  path.join(__dirname, '../public/modules/app-ui-forms-takip.js'),
  'utf8'
);
const giris = fs.readFileSync(
  path.join(__dirname, '../public/GIRIS.html'),
  'utf8'
);
const css = fs.readFileSync(
  path.join(__dirname, '../public/styles.css'),
  'utf8'
);

test('formatLastUpdateLabel — GG.AA.YYYY SS:DD', () => {
  const d = new Date(2026, 8, 7, 21, 5, 0);
  assert.equal(src.formatLastUpdateLabel(d), 'Son Güncelleme: 07.09.2026 21:05');
  assert.equal(src.formatLastUpdateLabel(''), '');
  assert.equal(src.formatLastUpdateLabel(null), '');
});

test('isExcelPath only allows excel extensions', () => {
  assert.equal(src.isExcelPath('C:\\data\\ihracat.xlsx'), true);
  assert.equal(src.isExcelPath('\\\\sunucu\\paylasim\\a.xlsm'), true);
  assert.equal(src.isExcelPath('C:\\data\\secret.txt'), false);
  assert.equal(src.isExcelPath('C:\\data\\file.xlsx\0.txt'), false);
  assert.equal(src.isExcelPath(''), false);
});

test('sanitizeSource drops unsafe path and keeps fileName', () => {
  const s = src.sanitizeSource({
    fileName: '..\\foo.xlsx',
    filePath: 'C:\\notes\\plan.txt',
    sheetName: 'Sayfa1',
  });
  assert.equal(s.fileName, 'foo.xlsx');
  assert.equal(s.filePath, '');
  assert.equal(s.sheetName, 'Sayfa1');
});

test('clearStoredSource wipes path so reread cannot revive it', async () => {
  const writes = [];
  const q = async (sql, params) => {
    if (/SELECT value FROM kv_store/.test(sql)) {
      const last = writes[writes.length - 1];
      return { rows: last ? [{ value: last }] : [] };
    }
    writes.push(params[1]);
    return { rows: [] };
  };
  await src.setStoredSource(q, { fileName: 'a.xlsx', filePath: 'C:\\data\\a.xlsx' });
  const cleared = await src.clearStoredSource(q);
  assert.equal(cleared.fileName, '');
  assert.equal(cleared.filePath, '');
  assert.equal(src.hasStoredSource(cleared), false);
});

test('hasStoredSource / mergeSource keep previous path', () => {
  assert.equal(src.hasStoredSource({}), false);
  assert.equal(src.hasStoredSource({ fileName: 'a.xlsx' }), true);
  const merged = src.mergeSource(
    { filePath: 'C:\\a\\b.xlsx', fileName: 'b.xlsx' },
    { sheetName: 'Sheet1', lastUpdatedAt: '2026-09-07T18:00:00.000Z' }
  );
  assert.equal(merged.filePath, 'C:\\a\\b.xlsx');
  assert.equal(merged.sheetName, 'Sheet1');
  assert.equal(merged.lastUpdatedAt, '2026-09-07T18:00:00.000Z');
});

test('mergeSource drops stale path when fileName changes', () => {
  const merged = src.mergeSource(
    { filePath: 'C:\\eski\\a.xlsx', fileName: 'a.xlsx' },
    { fileName: 'b.xlsx' }
  );
  assert.equal(merged.fileName, 'b.xlsx');
  assert.equal(merged.filePath, '');
});

test('same folder different names — keeps requested fileName (multi-excel safe)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ihracat-siblings-'));
  const oldPath = path.join(dir, '05.09.2026.xlsx');
  const newPath = path.join(dir, '08.09.2026.xlsx');
  fs.writeFileSync(oldPath, Buffer.from('old-28-plates'));
  fs.writeFileSync(newPath, Buffer.from('new-18-plates'));
  const oldAt = new Date('2026-09-05T10:00:00.000Z');
  const newAt = new Date('2026-09-08T00:21:00.000Z');
  fs.utimesSync(oldPath, oldAt, oldAt);
  fs.utimesSync(newPath, newAt, newAt);
  try {
    const newest = await src.findNewestExcelInDir(dir);
    assert.equal(newest, newPath);
    const readOld = await src.readExcelFromStoredPath(
      { fileName: '05.09.2026.xlsx', filePath: oldPath },
      { searchDirs: [dir], depth: 0 }
    );
    assert.equal(readOld.fileName, '05.09.2026.xlsx');
    assert.equal(readOld.filePath, oldPath);
    assert.equal(Buffer.compare(readOld.buf, Buffer.from('old-28-plates')), 0);
    const readNew = await src.readExcelFromStoredPath(
      { fileName: '08.09.2026.xlsx', filePath: newPath },
      { searchDirs: [dir], depth: 0 }
    );
    assert.equal(readNew.fileName, '08.09.2026.xlsx');
    assert.equal(Buffer.compare(readNew.buf, Buffer.from('new-18-plates')), 0);
  } finally {
    fs.unlinkSync(oldPath);
    fs.unlinkSync(newPath);
    fs.rmdirSync(dir);
  }
});

test('missing named file — falls back to newest excel in same folder', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ihracat-fallback-'));
  const goneHint = path.join(dir, '05.09.2026.xlsx');
  const newPath = path.join(dir, '08.09.2026.xlsx');
  fs.writeFileSync(newPath, Buffer.from('new-18-plates'));
  const newAt = new Date('2026-09-08T00:21:00.000Z');
  fs.utimesSync(newPath, newAt, newAt);
  try {
    const read = await src.readExcelFromStoredPath(
      { fileName: '05.09.2026.xlsx', filePath: goneHint },
      { searchDirs: [dir], depth: 0 }
    );
    assert.equal(read.fileName, '08.09.2026.xlsx');
    assert.equal(read.filePath, newPath);
  } finally {
    fs.unlinkSync(newPath);
    fs.rmdirSync(dir);
  }
});

test('findExcelByFileName prefers newest mtime', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ihracat-mtime-'));
  const oldDir = path.join(dir, 'old');
  const newDir = path.join(dir, 'new');
  fs.mkdirSync(oldDir);
  fs.mkdirSync(newDir);
  const fileName = 'ihracat.xlsx';
  const oldPath = path.join(oldDir, fileName);
  const newPath = path.join(newDir, fileName);
  fs.writeFileSync(oldPath, Buffer.from('old-xlsx'));
  fs.writeFileSync(newPath, Buffer.from('new-xlsx'));
  const oldAt = new Date('2024-01-01T00:00:00.000Z');
  const newAt = new Date('2026-09-08T00:00:00.000Z');
  fs.utimesSync(oldPath, oldAt, oldAt);
  fs.utimesSync(newPath, newAt, newAt);
  try {
    const found = await src.findExcelByFileName(fileName, { searchDirs: [dir], depth: 2 });
    assert.equal(found, newPath);
    const read = await src.readExcelFromStoredPath(
      { fileName, filePath: oldPath },
      { searchDirs: [dir], depth: 2 }
    );
    assert.equal(read.filePath, newPath);
    assert.equal(Buffer.compare(read.buf, Buffer.from('new-xlsx')), 0);
  } finally {
    fs.unlinkSync(oldPath);
    fs.unlinkSync(newPath);
    fs.rmdirSync(oldDir);
    fs.rmdirSync(newDir);
    fs.rmdirSync(dir);
  }
});

test('publicSourceView does not leak filePath', () => {
  const view = src.publicSourceView({
    fileName: 'ihracat.xlsx',
    filePath: 'C:\\gizli\\ihracat.xlsx',
  });
  assert.equal(view.hasSource, true);
  assert.equal(view.hasPath, true);
  assert.equal(view.fileName, 'ihracat.xlsx');
  assert.equal('filePath' in view, false);
});

test('readExcelFromStoredPath — missing file yields EXCEL_FILE_NOT_FOUND', async () => {
  await assert.rejects(
    () => src.readExcelFromStoredPath({ filePath: path.join(os.tmpdir(), 'yok-' + Date.now() + '.xlsx') }),
    (err) => err && err.code === 'EXCEL_FILE_NOT_FOUND'
  );
});

test('readExcelFromStoredPath — reads same path after write', async () => {
  const filePath = path.join(os.tmpdir(), 'ihracat-source-' + Date.now() + '.xlsx');
  const payload = Buffer.from('xlsx-bytes-test');
  fs.writeFileSync(filePath, payload);
  try {
    const read = await src.readExcelFromStoredPath({ filePath, fileName: 'ihracat.xlsx' });
    assert.equal(Buffer.compare(read.buf, payload), 0);
    assert.equal(read.fileName, path.basename(filePath));
  } finally {
    fs.unlinkSync(filePath);
  }
});

test('readExcelFromStoredPath — finds file by name in search dir', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ihracat-find-'));
  const fileName = 'YUKU 07.09.2024.xlsx';
  const filePath = path.join(dir, fileName);
  const payload = Buffer.from('xlsx-find-by-name');
  fs.writeFileSync(filePath, payload);
  try {
    const found = await src.findExcelByFileName(fileName, { searchDirs: [dir] });
    assert.equal(found, filePath);
    const read = await src.readExcelFromStoredPath(
      { fileName },
      { searchDirs: [dir] }
    );
    assert.equal(Buffer.compare(read.buf, payload), 0);
    assert.equal(read.filePath, filePath);
  } finally {
    fs.unlinkSync(filePath);
    fs.rmdirSync(dir);
  }
});

test('findExcelByFileName rejects path traversal names', async () => {
  const found = await src.findExcelByFileName('..\\secret.xlsx', { searchDirs: [os.tmpdir()] });
  assert.equal(found, '');
});

test('client refresh is manual only — no timer / watch', () => {
  assert.doesNotMatch(clientCode, /setInterval\s*\(/);
  assert.doesNotMatch(clientCode, /setTimeout\s*\(/);
  assert.doesNotMatch(clientCode, /fs\.watch/);
  assert.doesNotMatch(clientCode, /watchFile/);
  assert.match(clientCode, /Önce İhracat Excel dosyasını seçmelisiniz/);
  assert.match(clientCode, /İhracat Excel dosyası bulunamadı\. Lütfen dosyayı tekrar seçin/);
  assert.match(clientCode, /İhracat Excel silindi\. Güncellemek için önce dosyayı tekrar yükleyin/);
  assert.match(clientCode, /clearStoredBinding/);
  assert.match(clientCode, /loaded: Array\.isArray\(rows\) && rows\.length > 0/);
  assert.match(excelIhr, /clearStoredBinding/);
  assert.match(clientCode, /fa-spin/);
  assert.match(clientCode, /adoptLoadedExcelAsSource/);
  assert.match(clientCode, /hasLoadedExcel/);
  assert.match(clientCode, /Güncelle dosya seçici açmaz/);
  assert.doesNotMatch(clientCode, /pickFileNow/);
  assert.doesNotMatch(clientCode, /clickRefreshFileInput/);
  assert.match(clientCode, /readStoredExcelFile/);
  assert.match(clientCode, /js-ihracat-excel-refresh/);
  assert.match(clientCode, /readFileFromHandle/);
  const refreshFn = clientCode.slice(
    clientCode.indexOf('async function refreshFromStored'),
    clientCode.indexOf("window.addEventListener('daily-store-ready'")
  );
  assert.doesNotMatch(refreshFn, /showOpenFilePicker/);
  assert.doesNotMatch(refreshFn, /excelBlockFileInput/);
  assert.match(refreshFn, /resolveFileForSource/);
  assert.match(refreshFn, /listLoadedSourceNames/);
  assert.match(clientCode, /fileFromBackendReread/);
  assert.match(clientCode, /pickNewerExcelFile/);
  assert.match(clientCode, /sameExcelName/);
  assert.match(clientCode, /clearPath/);
  const busyPos = refreshFn.indexOf('setRefreshBusy(true)');
  const awaitPos = refreshFn.indexOf('await');
  assert.ok(busyPos >= 0 && busyPos < awaitPos, 'Güncelle kilidi ilk await öncesi konmalı');
  assert.match(clientCode, /if \(_busy \|\| btn\.disabled/);
});

test('Araçlar menüsünde Güncelle yok — yalnızca ana sayfa chip', () => {
  assert.match(uiJs, /id="excelBlockSelectButtonTop"/);
  assert.match(uiJs, /İhracat Excel Yükle/);
  assert.match(uiJs, /class="app-excel-suite"/);
  assert.match(uiJs, /id="piyasaExcelUploadButtonTop"/);
  assert.match(uiJs, /id="piyasaExcelClearButtonTop"/);
  assert.doesNotMatch(uiJs, /id="excelIhracatRefreshButtonTop"/);
  assert.match(uiJs, /id="excelIhracatRefreshButtonChip"/);
  assert.match(giris, /ihracat-excel-source\.js/);
  assert.match(authJs, /Güncelle tıklaması ihracat-excel-source/);
  assert.match(clientCode, /closest\('\.js-ihracat-excel-refresh'\)/);
});

test('header Güncelle sits under İHRACAT excel chip', () => {
  const stackStart = uiJs.indexOf('class="app-header-ihracat-excel"');
  const stackSlice = uiJs.slice(stackStart, stackStart + 1100);
  assert.ok(stackStart >= 0, 'İHRACAT + Güncelle stack yok');
  assert.match(stackSlice, /id="chipIhracat"/);
  assert.match(stackSlice, /id="excelIhracatRefreshButtonChip"/);
  const chipPos = stackSlice.indexOf('id="chipIhracat"');
  const refreshPos = stackSlice.indexOf('id="excelIhracatRefreshButtonChip"');
  const whenPos = stackSlice.indexOf('id="excelIhracatLastUpdateChip"');
  assert.ok(chipPos >= 0 && refreshPos > chipPos, 'Güncelle İHRACAT chip\'inin altında olmalı');
  assert.ok(whenPos > refreshPos, 'güncelleme tarihi Güncelle butonunun içinde olmalı');
  assert.doesNotMatch(
    uiJs.replace(stackSlice, ''),
    /id="excelIhracatLastUpdateChip"/
  );
  assert.match(css, /\.app-header-ihracat-excel\s*\{[^}]*flex-direction:\s*column/);
  assert.match(css, /\.app-header-status\s*\{[^}]*flex-wrap:\s*nowrap/);
  assert.match(css, /@keyframes ihracat-refresh-fill/);
  assert.match(css, /\.app-header-ihracat-excel__refresh\.is-busy::after/);
  assert.match(clientCode, /chip\.closest\s*\?\s*chip\.closest\('\.js-ihracat-excel-refresh'\)/);
  assert.match(clientCode, /label\.replace\(\/\^Son Güncelleme:\\s\*\//);
});

test('reread reuses parser and replaces data without file picker', () => {
  assert.match(excelIhr, /async function applyIhracatExcelReread/);
  assert.match(excelIhr, /replaceAll: true/);
  assert.match(excelIhr, /function commitIhracatImport\(uniq2, meta, file, opts\)/);
  assert.match(excelIhr, /function mergeIhracatImportState/);
  assert.match(excelIhr, /replacedAt/);
  assert.doesNotMatch(excelIhr, /Yeni dosya EKLENSİN/);
  assert.doesNotMatch(
    excelIhr.slice(excelIhr.indexOf('async function applyIhracatExcelReread')),
    /showOpenFilePicker|excelBlockFileInput|inp\.click\(\)/
  );
});

test('Güncelle refreshes every loaded Excel source by name', () => {
  assert.match(clientCode, /function listLoadedSourceNames/);
  assert.match(clientCode, /listIhracatExcelSources/);
  assert.match(clientCode, /resolveFileForSource/);
  assert.match(clientCode, /for \(var i = 0; i < sources\.length; i\+\+\)/);
  assert.match(clientCode, /silentToast:\s*multi/);
  assert.match(clientCode, /Excel güncellendi/);
  assert.match(clientCode, /Bulunamayan:/);
  assert.match(clientCode, /__wrongName/);
  assert.match(clientCode, /sameExcelName\(name, wanted\)/);
});
