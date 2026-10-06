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

test('client refresh: manual button + silent auto refresh + file stamp watch (kantar only)', () => {
  assert.match(clientCode, /AUTO_REFRESH_MS = 10 \* 60 \* 1000/);
  assert.match(clientCode, /FIRST_REFRESH_MS = 15 \* 1000/);
  assert.match(clientCode, /WATCH_MS = 8 \* 1000/);
  assert.match(clientCode, /setInterval\s*\(/);
  // ilk otomatik güncelleme; ajan olayı yok
  assert.equal((clientCode.match(/setTimeout\s*\(/g) || []).length, 1);
  assert.doesNotMatch(clientCode, /fs\.watch/);
  const watchFn = clientCode.slice(
    clientCode.indexOf('async function grantedStamp'),
    clientCode.indexOf('function startAutoRefresh')
  );
  assert.match(watchFn, /queryPermission\(\{ mode: 'read' \}\)\) !== 'granted'/);
  assert.match(watchFn, /isKantarSessionActive\(\)/);
  assert.doesNotMatch(watchFn, /showOpenFilePicker|requestPermission|warn\(|showToast/);
  // Otomatik tur: izin penceresi / dosya seçici / uyarı açmaz, amir oturumunda çalışmaz
  const autoFn = clientCode.slice(
    clientCode.indexOf('async function autoRefreshTick'),
    clientCode.indexOf('function startAutoRefresh')
  );
  assert.match(autoFn, /isKantarSessionActive\(\)/);
  assert.match(autoFn, /refreshFromStored\(null, null, null, \{ silent: true \}\)/);
  assert.doesNotMatch(autoFn, /showOpenFilePicker|requestPermission|warn\(|showToast/);
  assert.match(clientCode, /if \(_silentRun\) \{\s*_silentPermMissing = true;\s*return \{ __missing: true \};/);
  assert.match(clientCode, /isAmirUser\(\)\) return false/);
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
  assert.match(clientCode, /if \(handleOk\) return namedFile/);
  assert.doesNotMatch(clientCode, /agent-files|onAgentUpload|pickNewerExcelFile/);
  assert.match(clientCode, /sameExcelName/);
  assert.match(clientCode, /clearPath/);
  const busyPos = refreshFn.indexOf('setRefreshBusy(true)');
  const awaitPos = refreshFn.indexOf('await');
  assert.ok(busyPos >= 0 && busyPos < awaitPos, 'Güncelle kilidi ilk await öncesi konmalı');
  assert.match(clientCode, /if \(_busy \|\| _picking \|\| btn\.disabled/);
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
  const chipAt = uiJs.indexOf('id="chipIhracat"');
  const stackStart = uiJs.lastIndexOf('class="app-header-ihracat-excel"', chipAt);
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
  assert.match(css, /body\.session-amir \.app-header-excel-pair\s*\{[^}]*flex-direction:\s*column/);
  assert.match(uiJs, /class="app-header-excel-pair"/);
  const amirExcelLabel = css.slice(
    css.indexOf('body.session-amir .app-header-ihracat-excel .status-chip--excel b'),
    css.indexOf('body.session-amir .app-header-status .app-header-ihracat-excel__refresh')
  );
  assert.doesNotMatch(amirExcelLabel, /text-overflow:\s*ellipsis/);
  assert.match(amirExcelLabel, /overflow-wrap:\s*break-word/);
  assert.match(css, /\.app-header-status\s*\{[^}]*flex-wrap:\s*nowrap/);
  assert.match(css, /@keyframes ihracat-refresh-fill/);
  assert.match(css, /\.app-header-ihracat-excel__refresh\.is-busy::after/);
  assert.match(clientCode, /chip\.closest\s*\?\s*chip\.closest\('\.js-ihracat-excel-refresh'\)/);
  assert.match(clientCode, /label\.replace\(\/\^Son Güncelleme:\\s\*\//);
});

test('Selahattin header shows kantar Excel names and has no upload', () => {
  assert.match(uiJs, /function _kantarExcelStatusHtml\(piyText, piyCount\)/);
  assert.match(uiJs, /id="kantarExcelIhracat"/);
  assert.match(uiJs, /İHRACAT:/);
  assert.match(uiJs, /_sessionIsSelahattin\(\) \? _kantarExcelStatusHtml\(_piyChipText, _piyasaCnt\)/);
  const htmlFn = uiJs.slice(uiJs.indexOf('function _kantarExcelStatusHtml(piyText, piyCount)'), uiJs.indexOf('function _kantarExcelFileName'));
  assert.match(htmlFn, /id="chipPiyasa"/);
  assert.match(htmlFn, /PİYASA:/);
  assert.match(htmlFn, /Piyasa Excel'i aç/);
  assert.match(htmlFn, /data-kantar-line="1\.OSB"/);
  assert.match(htmlFn, /data-kantar-line="AVDAN"/);
  assert.match(htmlFn, /kantar-excel-line/);
  assert.match(uiJs, /function _kantarExcelLineLabel/);
  assert.match(css, /flex-direction:\s*column/);
  assert.doesNotMatch(htmlFn, /Yükle|excelBlockSelect|type="file"|Güncelle|kantarExcelOsb|kantarExcelAvdan/);
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

test('çoklu Excel Güncelle hangisini sorar, tek dosyada sormaz', () => {
  assert.match(clientCode, /function pickSourcesToRefresh/);
  assert.match(clientCode, /Hangi Excel güncellensin/);
  assert.match(clientCode, /Hepsini güncelle/);
  assert.match(clientCode, /Seçilenleri güncelle/);
  assert.match(clientCode, /if \(sourcesNow\.length > 1\)/);
  assert.match(clientCode, /onlyNames/);
  const refreshFn = clientCode.slice(
    clientCode.indexOf('async function refreshFromStored'),
    clientCode.indexOf("window.addEventListener('daily-store-ready'")
  );
  assert.match(refreshFn, /onlyNames/);
  assert.doesNotMatch(refreshFn, /pickSourcesToRefresh/);
  assert.match(css, /\.ihracat-excel-pick__row/);
});

test('her Excel dosyasının konumu ayrı saklanır', () => {
  assert.match(clientCode, /function handleForName/);
  assert.match(clientCode, /_handlesByName\[key\] = handle/);
  assert.match(clientCode, /if \(key\) store\.put\(handle, key\)/);
  assert.match(clientCode, /function primeHandlePermissions/);
  assert.match(clientCode, /primeHandlePermissions\(picked\)/);
  assert.match(clientCode, /function openFolderPicker/);
  assert.match(clientCode, /namesLackHandle\(picked\)/);
  assert.doesNotMatch(clientCode, /serverCanSeeLocalExcel/);
  assert.match(clientCode, /function persistDirHandle/);
  assert.match(clientCode, /ihracat_dir/);
  assert.doesNotMatch(clientCode, /Dosyaları seç/);
  assert.match(clientCode, /namedHandle = handleForName\(wanted\)/);
  assert.match(clientCode, /if \(handleOk\) return namedFile/);
  const refreshFn = clientCode.slice(
    clientCode.indexOf('async function refreshFromStored'),
    clientCode.indexOf("window.addEventListener('daily-store-ready'")
  );
  assert.match(refreshFn, /catch \(err\)/);
  assert.doesNotMatch(refreshFn, /showOpenFilePicker/);
});

function clientFn(name) {
  const i = clientCode.indexOf('function ' + name + '(');
  let depth = 0;
  for (let k = clientCode.indexOf('{', i); k < clientCode.length; k++) {
    if (clientCode[k] === '{') depth++;
    else if (clientCode[k] === '}' && --depth === 0) return clientCode.slice(i, k + 1);
  }
  return '';
}

test('same-date Excels keep their own file on refresh (no YD28 swap)', () => {
  const bind = new Function(
    ['handleKey', 'dateToken', 'bindPresetToExpected'].map(clientFn).join('\n') + '\nreturn bindPresetToExpected;'
  )();
  const files = ['03.10.2026-YD28.xlsx', '03.10.2026.xlsx', '05.10.2026.xlsx'].map((name) => ({ name }));
  const map = bind({}, files, ['03.10.2026.xlsx', '03.10.2026-YD28.xlsx', '05.10.2026.xlsx']);
  assert.equal(map['03.10.2026.xlsx'].name, '03.10.2026.xlsx');
  assert.equal(map['03.10.2026-yd28.xlsx'].name, '03.10.2026-YD28.xlsx');
  const missing = bind({}, [{ name: '03.10.2026-YD28.xlsx' }], ['03.10.2026.xlsx', '03.10.2026-YD28.xlsx']);
  assert.equal(missing['03.10.2026.xlsx'], undefined);
});
test('a file whose disk name is another loaded Excel is never read as this one', () => {
  const belongs = new Function(
    ['sameExcelName', 'belongsToOtherSource'].map(clientFn).join('\n') + '\nreturn belongsToOtherSource;'
  )();
  const sources = ['03.10.2026.xlsx', '03.10.2026-YD28.xlsx'];
  assert.equal(belongs({ name: '03.10.2026-YD28.xlsx', __diskName: '03.10.2026.xlsx' }, '03.10.2026-YD28.xlsx', sources), true);
  assert.equal(belongs({ name: '03.10.2026-YD28.xlsx' }, '03.10.2026-YD28.xlsx', sources), false);
  assert.equal(belongs({ name: '03.10.2026.xlsx', __diskName: '3.10.2026 (1).xlsx' }, '03.10.2026.xlsx', sources), false);
});