/**
 * İhracat Excel kaynağı: ilk seçimde dosya konumunu saklar,
 * yalnızca kullanıcı “Güncelle”ye basınca yeniden okur.
 * Otomatik yenileme veya zamanlayıcı yok.
 */
(function () {
  'use strict';

  var HANDLE_IDB_KEY = 'ihracat_excel_file_handle';
  var HANDLE_DB = 'ihracat_excel_handle_db';
  var LS_KEY = 'ihracat_excel_source_v1';
  var MSG_NOT_SELECTED = 'Önce İhracat Excel dosyasını seçmelisiniz.';
  var MSG_NOT_FOUND = 'İhracat Excel dosyası bulunamadı. Lütfen dosyayı tekrar seçin.';
  var MSG_CLEARED = 'İhracat Excel silindi. Güncellemek için önce dosyayı tekrar yükleyin.';
  var _busy = false;
  var _cache = null;
  var _liveHandle = null;
  var _handleReady = null;

  function pad2(n) {
    return String(n).padStart(2, '0');
  }

  function formatLastUpdateLabel(isoOrMs) {
    if (isoOrMs == null || isoOrMs === '') return '';
    var d = isoOrMs instanceof Date ? isoOrMs : new Date(isoOrMs);
    if (!Number.isFinite(d.getTime())) return '';
    return (
      'Son Güncelleme: ' +
      pad2(d.getDate()) +
      '.' +
      pad2(d.getMonth() + 1) +
      '.' +
      d.getFullYear() +
      ' ' +
      pad2(d.getHours()) +
      ':' +
      pad2(d.getMinutes())
    );
  }

  function authHeaders(json) {
    var h = {};
    if (json) h['Content-Type'] = 'application/json';
    try {
      var token = localStorage.getItem('authToken') || '';
      if (token) h.Authorization = 'Bearer ' + token;
    } catch (e) {}
    return h;
  }

  function readLocalMeta() {
    try {
      var raw = localStorage.getItem(LS_KEY);
      if (!raw) return {};
      var o = JSON.parse(raw);
      return o && typeof o === 'object' ? o : {};
    } catch (e) {
      return {};
    }
  }

  function writeLocalMeta(meta) {
    var next = Object.assign({}, readLocalMeta(), meta || {});
    _cache = next;
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(next));
    } catch (e) {}
    return next;
  }

  function extractFilePath(file) {
    if (!file) return '';
    try {
      if (typeof file.path === 'string' && file.path.length > 1) return file.path;
    } catch (e) {}
    return '';
  }

  function setLiveHandle(handle) {
    if (!handle || typeof handle.getFile !== 'function') return;
    _liveHandle = handle;
    try { window.__ihracatExcelLiveHandle = handle; } catch (e) {}
  }

  async function persistHandle(handle) {
    if (!handle) return false;
    setLiveHandle(handle);
    var ok = false;
    try {
      if (window.IDBStore && typeof IDBStore.kvSet === 'function') {
        await IDBStore.kvSet(HANDLE_IDB_KEY, handle);
        ok = true;
      }
    } catch (e) {}
    try {
      var db = await new Promise(function (resolve, reject) {
        var req = indexedDB.open(HANDLE_DB, 1);
        req.onupgradeneeded = function () {
          if (!req.result.objectStoreNames.contains('handles')) req.result.createObjectStore('handles');
        };
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { reject(req.error); };
      });
      await new Promise(function (resolve, reject) {
        var tx = db.transaction('handles', 'readwrite');
        var req = tx.objectStore('handles').put(handle, 'ihracat');
        req.onsuccess = function () { resolve(true); };
        req.onerror = function () { reject(req.error); };
      });
      ok = true;
    } catch (e) {}
    return ok;
  }

  async function loadHandle() {
    if (_liveHandle && typeof _liveHandle.getFile === 'function') return _liveHandle;
    try {
      if (window.IDBStore && typeof IDBStore.kvGet === 'function') {
        var fromKv = await IDBStore.kvGet(HANDLE_IDB_KEY);
        if (fromKv && typeof fromKv.getFile === 'function') {
          setLiveHandle(fromKv);
          return fromKv;
        }
      }
    } catch (e) {}
    try {
      var db = await new Promise(function (resolve, reject) {
        var req = indexedDB.open(HANDLE_DB, 1);
        req.onupgradeneeded = function () {
          if (!req.result.objectStoreNames.contains('handles')) req.result.createObjectStore('handles');
        };
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { reject(req.error); };
      });
      var handle = await new Promise(function (resolve, reject) {
        var tx = db.transaction('handles', 'readonly');
        var req = tx.objectStore('handles').get('ihracat');
        req.onsuccess = function () { resolve(req.result || null); };
        req.onerror = function () { reject(req.error); };
      });
      if (handle && typeof handle.getFile === 'function') {
        setLiveHandle(handle);
        return handle;
      }
    } catch (e) {}
    return null;
  }

  async function clearHandle() {
    _liveHandle = null;
    try { window.__ihracatExcelLiveHandle = null; } catch (e) {}
    try {
      if (window.IDBStore && typeof IDBStore.kvDel === 'function') {
        await IDBStore.kvDel(HANDLE_IDB_KEY);
      }
    } catch (e) {}
    try {
      var db = await new Promise(function (resolve, reject) {
        var req = indexedDB.open(HANDLE_DB, 1);
        req.onupgradeneeded = function () {
          if (!req.result.objectStoreNames.contains('handles')) req.result.createObjectStore('handles');
        };
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { reject(req.error); };
      });
      await new Promise(function (resolve, reject) {
        var tx = db.transaction('handles', 'readwrite');
        var req = tx.objectStore('handles').delete('ihracat');
        req.onsuccess = function () { resolve(true); };
        req.onerror = function () { reject(req.error); };
      });
    } catch (e) {}
  }

  async function clearStoredBinding() {
    _cache = {};
    try { localStorage.removeItem(LS_KEY); } catch (e) {}
    updateLastUpdateUi('');
    await clearHandle();
    try {
      await fetch('/api/ihracat-excel/source', {
        method: 'DELETE',
        credentials: 'include',
        headers: authHeaders(false),
      });
    } catch (e) {}
  }

  function loadedExcelMeta() {
    var meta = {};
    try {
      if (typeof loadDailyMeta === 'function') meta = loadDailyMeta() || {};
      else if (window.DailyStore && typeof DailyStore.getMeta === 'function') meta = DailyStore.getMeta() || {};
    } catch (e) {}
    var rows = [];
    try {
      if (typeof loadDailyShipments === 'function') rows = loadDailyShipments() || [];
      else if (window.DailyStore && typeof DailyStore.getRows === 'function') rows = DailyStore.getRows() || [];
    } catch (e) {}
    var fileName = String((meta && meta.fileName) || '').split('+')[0].trim();
    if (!fileName && rows[0] && rows[0].fileName) {
      fileName = String(rows[0].fileName).split('+')[0].trim();
    }
    return {
      loaded: Array.isArray(rows) && rows.length > 0,
      fileName: fileName,
      sheetName: String((meta && meta.sheetName) || '').trim(),
    };
  }

  function hasLoadedExcel() {
    return loadedExcelMeta().loaded;
  }

  function adoptLoadedExcelAsSource() {
    var info = loadedExcelMeta();
    if (!info.loaded) return info;
    var patch = { pickedHere: true };
    if (info.fileName) patch.fileName = info.fileName;
    if (info.sheetName) patch.sheetName = info.sheetName;
    writeLocalMeta(patch);
    return info;
  }

  function hasLocalSource() {
    var m = _cache || readLocalMeta();
    if (m.filePath) return true;
    if (m.fileName) return true;
    return !!(m.pickedHere && m.fileName);
  }

  async function hasStoredSource() {
    adoptLoadedExcelAsSource();
    if (hasLoadedExcel()) return true;
    if (hasLocalSource()) return true;
    if (_liveHandle) return true;
    var handle = await loadHandle();
    return !!handle;
  }

  function getCachedSheetName() {
    var m = _cache || readLocalMeta();
    return String(m.sheetName || '').trim();
  }

  async function warn(msg) {
    var ui = window.rpUi || {};
    if (typeof ui.alert === 'function') {
      await ui.alert(msg, 'warn');
      return;
    }
    if (typeof window.showToast === 'function') {
      window.showToast(msg, 'warn');
      return;
    }
    try {
      alert(msg);
    } catch (e) {}
  }

  function setRefreshBusy(busy) {
    _busy = !!busy;
    document.querySelectorAll('.js-ihracat-excel-refresh').forEach(function (btn) {
      btn.disabled = _busy;
      btn.classList.toggle('is-busy', _busy);
      btn.setAttribute('aria-busy', _busy ? 'true' : 'false');
    });
    document.querySelectorAll('.ihracat-excel-refresh-icon').forEach(function (icon) {
      if (_busy) icon.classList.add('fa-spin');
      else icon.classList.remove('fa-spin');
    });
  }

  function updateLastUpdateUi(isoOrMs) {
    var label = formatLastUpdateLabel(isoOrMs);
    var el = document.getElementById('excelIhracatLastUpdate');
    if (el) {
      if (label) {
        el.textContent = label;
        el.classList.remove('hidden');
      } else {
        el.textContent = '';
        el.classList.add('hidden');
      }
    }
    var chip = document.getElementById('excelIhracatLastUpdateChip');
    if (chip) {
      var when = label.replace(/^Son Güncelleme:\s*/, '');
      if (when) {
        chip.textContent = when;
        chip.classList.remove('hidden');
      } else {
        chip.textContent = '';
        chip.classList.add('hidden');
      }
      var btn = chip.closest ? chip.closest('.js-ihracat-excel-refresh') : null;
      if (btn) {
        btn.title = label
          ? ('Yüklü İhracat Excel dosyasını yeniden oku — ' + label)
          : 'Yüklü İhracat Excel dosyasını yeniden oku';
      }
    }
  }

  async function saveSourceToBackend(meta) {
    try {
      var res = await fetch('/api/ihracat-excel/source', {
        method: 'PUT',
        credentials: 'include',
        headers: authHeaders(true),
        body: JSON.stringify(meta || {}),
      });
      if (!res.ok) return null;
      return await res.json().catch(function () { return null; });
    } catch (e) {
      return null;
    }
  }

  async function loadSourceFromBackend() {
    try {
      var res = await fetch('/api/ihracat-excel/source', {
        method: 'GET',
        credentials: 'include',
        cache: 'no-store',
        headers: authHeaders(false),
      });
      if (!res.ok) return null;
      return await res.json().catch(function () { return null; });
    } catch (e) {
      return null;
    }
  }

  async function rememberSelectedFile(file, extra) {
    if (!file) return;
    var meta = {
      fileName: String(file.name || '').trim(),
      filePath: extractFilePath(file),
      selectedAt: new Date().toISOString(),
      pickedHere: true,
    };
    if (extra && typeof extra === 'object') {
      if (extra.sheetName) meta.sheetName = extra.sheetName;
      if (extra.filePath) meta.filePath = extra.filePath;
    }
    if (!meta.filePath) meta.clearPath = true;
    writeLocalMeta(meta);
    updateLastUpdateUi(meta.lastUpdatedAt || meta.selectedAt);
    await saveSourceToBackend(meta);
  }

  async function rememberAfterImport(info) {
    var patch = { pickedHere: true };
    if (info && info.fileName) patch.fileName = info.fileName;
    if (info && info.sheetName) patch.sheetName = info.sheetName;
    if (info && info.filePath) patch.filePath = info.filePath;
    patch.lastUpdatedAt = new Date().toISOString();
    if (!patch.filePath) patch.clearPath = true;
    writeLocalMeta(patch);
    updateLastUpdateUi(patch.lastUpdatedAt);
    await saveSourceToBackend(patch);
  }

  function syncLastUpdateUiFromLocal() {
    var m = _cache || readLocalMeta();
    updateLastUpdateUi(m.lastUpdatedAt || m.selectedAt);
  }

  async function hydrateFromBackend() {
    try { await loadHandle(); } catch (e) {}
    var remote = await loadSourceFromBackend();
    if (remote && remote.hasSource) {
      writeLocalMeta({
        fileName: remote.fileName || '',
        sheetName: remote.sheetName || '',
        selectedAt: remote.selectedAt || '',
        lastUpdatedAt: remote.lastUpdatedAt || '',
        pickedHere: true,
      });
    }
    adoptLoadedExcelAsSource();
    syncLastUpdateUiFromLocal();
  }

  async function pickFileWithHandle() {
    if (typeof window.showOpenFilePicker !== 'function') return { unsupported: true };
    try {
      var handles = await window.showOpenFilePicker({
        types: [
          {
            description: 'Excel',
            accept: {
              'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
              'application/vnd.ms-excel': ['.xls'],
              'application/vnd.ms-excel.sheet.macroEnabled.12': ['.xlsm'],
              'application/vnd.ms-excel.sheet.binary.macroEnabled.12': ['.xlsb'],
            },
          },
        ],
        excludeAcceptAllOption: false,
        multiple: false,
      });
      var handle = handles && handles[0];
      if (!handle) return { cancelled: true };
      await persistHandle(handle);
      var file = await handle.getFile();
      await rememberSelectedFile(file);
      return { file: file };
    } catch (e) {
      if (e && e.name === 'AbortError') return { cancelled: true };
      return { unsupported: true };
    }
  }

  async function readFileFromHandle(handle) {
    if (!handle || typeof handle.getFile !== 'function') return null;
    try {
      // Tıklama jesti dururken izin al — dosya seçici açılmaz.
      if (typeof handle.requestPermission === 'function') {
        var perm = await handle.requestPermission({ mode: 'read' });
        if (perm !== 'granted') return { __missing: true };
      }
      return await handle.getFile();
    } catch (e) {
      if (e && (e.name === 'NotFoundError' || e.name === 'NotAllowedError')) {
        return { __missing: true };
      }
      return { __missing: true };
    }
  }

  async function fileFromHandle() {
    var handle = await loadHandle();
    return readFileFromHandle(handle);
  }

  async function fileFromBackendReread() {
    var info = loadedExcelMeta();
    var local = readLocalMeta();
    var payload = {
      fileName: (info && info.fileName) || local.fileName || '',
      sheetName: (info && info.sheetName) || local.sheetName || '',
    };
    var res;
    try {
      res = await fetch('/api/ihracat-excel/reread', {
        method: 'POST',
        credentials: 'include',
        headers: authHeaders(true),
        body: JSON.stringify(payload),
      });
    } catch (e) {
      return { __missing: true };
    }
    if (res.status === 400) {
      return { __notSelected: true };
    }
    if (res.status === 404) {
      return { __missing: true };
    }
    if (!res.ok) return { __missing: true };
    var blob = await res.blob();
    var name = '';
    try {
      name = decodeURIComponent(res.headers.get('X-Ihracat-Excel-File-Name') || '');
    } catch (e) {
      name = '';
    }
    if (!name) {
      name = payload.fileName || local.fileName || 'ihracat.xlsx';
    }
    var last = res.headers.get('X-Ihracat-Excel-Last-Updated') || '';
    if (last) {
      writeLocalMeta({ lastUpdatedAt: last });
      updateLastUpdateUi(last);
    }
    var lastMs = last ? Date.parse(last) : NaN;
    return new File([blob], name, {
      type: blob.type || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      lastModified: Number.isFinite(lastMs) ? lastMs : Date.now(),
    });
  }

  function fileStamp(file) {
    if (!file || file.__missing || file.__notSelected || file.__cancelled) return -1;
    var n = Number(file.lastModified);
    return Number.isFinite(n) ? n : -1;
  }

  function pickNewerExcelFile(a, b) {
    var okA = fileStamp(a) >= 0;
    var okB = fileStamp(b) >= 0;
    if (okA && okB) return fileStamp(b) >= fileStamp(a) ? b : a;
    if (okA) return a;
    if (okB) return b;
    return a || b;
  }

  async function readStoredExcelFile() {
    var handle = _liveHandle;
    if (!handle || typeof handle.getFile !== 'function') {
      handle = await loadHandle();
    }
    var fromHandle = await readFileFromHandle(handle);
    if (fromHandle && !fromHandle.__missing) return fromHandle;
    if (fromHandle && fromHandle.__missing) return fileFromBackendReread();
    return fileFromBackendReread();
  }

  async function applyPickedExcelFile(file) {
    if (!file || file.__missing || file.__notSelected || file.__cancelled) return file;
    if (typeof window.applyIhracatExcelReread !== 'function') {
      return { ok: false, msg: MSG_NOT_FOUND };
    }
    var result = await window.applyIhracatExcelReread(file);
    if (result && result.ok) {
      await rememberAfterImport({
        fileName: file.name,
        filePath: extractFilePath(file),
        sheetName: result.meta && result.meta.sheetName,
      });
      if (typeof window.showToast === 'function') {
        window.showToast(result.msg || 'Excel güncellendi.', 'success');
      }
    }
    return result;
  }

  async function refreshFromStored(permPromise) {
    if (_busy) return { ok: false, msg: 'Güncelleme sürüyor.' };
    setRefreshBusy(true);
    try {
      adoptLoadedExcelAsSource();
      if (!hasLoadedExcel()) {
        await warn(MSG_CLEARED);
        return { ok: false, code: 'EXCEL_CLEARED', msg: MSG_CLEARED };
      }

      // Güncelle dosya seçici açmaz. Kayıtlı Excel'i diskten okur.
      var handle = _liveHandle || window.__ihracatExcelLiveHandle;
      var file = null;
      try {
        if (permPromise && typeof permPromise.then === 'function' && handle && typeof handle.getFile === 'function') {
          var perm = await permPromise;
          if (perm === 'granted') file = await handle.getFile();
        } else if (handle && typeof handle.getFile === 'function') {
          file = await readFileFromHandle(handle);
        }
      } catch (e) {
        file = null;
      }

      var fromBackend = null;
      try { fromBackend = await fileFromBackendReread(); } catch (e) { fromBackend = null; }
      var backendOk = fromBackend && !fromBackend.__missing && !fromBackend.__notSelected;
      var handleOk = file && !file.__missing && !file.__cancelled;
      if (backendOk && handleOk && fromBackend.name && file.name && fromBackend.name !== file.name) {
        file = fromBackend;
      } else {
        file = pickNewerExcelFile(file, fromBackend);
      }
      if (!file || file.__missing || file.__notSelected) {
        await warn(MSG_NOT_FOUND);
        return { ok: false, code: 'EXCEL_FILE_NOT_FOUND', msg: MSG_NOT_FOUND };
      }

      var result = await applyPickedExcelFile(file);
      if (!result || !result.ok) {
        var msg = (result && result.msg) || MSG_NOT_FOUND;
        await warn(msg);
        return result || { ok: false, msg: msg };
      }
      return result;
    } catch (e) {
      await warn(MSG_NOT_FOUND);
      return { ok: false, code: 'EXCEL_FILE_NOT_FOUND', msg: MSG_NOT_FOUND };
    } finally {
      setRefreshBusy(false);
    }
  }

  try {
    window.addEventListener('daily-store-ready', function () {
      adoptLoadedExcelAsSource();
      syncLastUpdateUiFromLocal();
      loadHandle().catch(function () {});
    });
  } catch (e) {}
  try { _handleReady = loadHandle(); } catch (e) { _handleReady = Promise.resolve(null); }

  if (!window.__ihracatExcelRefreshBound) {
    window.__ihracatExcelRefreshBound = true;
    document.addEventListener('click', function (e) {
      var btn = e.target && e.target.closest && e.target.closest('.js-ihracat-excel-refresh');
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();
      if (_busy || btn.disabled || btn.getAttribute('aria-busy') === 'true') return;
      try {
        if (typeof window.closeAppToolsMenu === 'function') window.closeAppToolsMenu();
      } catch (err) {}
      var handle = _liveHandle || window.__ihracatExcelLiveHandle;
      var permPromise = null;
      if (handle && typeof handle.requestPermission === 'function') {
        try { permPromise = handle.requestPermission({ mode: 'read' }); } catch (err2) {}
      }
      refreshFromStored(permPromise);
    }, true);
  }

  window.IhracatExcelSource = {
    formatLastUpdateLabel: formatLastUpdateLabel,
    pickFileWithHandle: pickFileWithHandle,
    rememberSelectedFile: rememberSelectedFile,
    rememberAfterImport: rememberAfterImport,
    persistHandle: persistHandle,
    clearStoredBinding: clearStoredBinding,
    adoptLoadedExcelAsSource: adoptLoadedExcelAsSource,
    hasLoadedExcel: hasLoadedExcel,
    getCachedSheetName: getCachedSheetName,
    hydrateFromBackend: hydrateFromBackend,
    syncLastUpdateUiFromLocal: syncLastUpdateUiFromLocal,
    updateLastUpdateUi: updateLastUpdateUi,
    refreshFromStored: refreshFromStored,
    readStoredExcelFile: readStoredExcelFile,
    hasStoredSource: hasStoredSource,
    MSG_NOT_SELECTED: MSG_NOT_SELECTED,
    MSG_NOT_FOUND: MSG_NOT_FOUND,
    MSG_CLEARED: MSG_CLEARED,
  };
})();
