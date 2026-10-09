/**
 * İhracat Excel kaynağı: ilk seçimde dosya konumunu saklar,
 * kullanıcı “Güncelle”ye basınca yeniden okur.
 * Kantar oturumunda seçilen dosya 8 sn'de bir yoklanır, kaydedildiyse hemen okunur;
 * ayrıca açılıştan 15 sn sonra ve 10 dakikada bir sessiz otomatik güncelleme dener:
 * dosya izni zaten verilmişse (veya sunucu dosyayı görüyorsa) okur, liman listesine gönderir;
 * izin yoksa hiçbir pencere / uyarı açmadan sessizce geçer.
 */
(function () {
  'use strict';

  var HANDLE_IDB_KEY = 'ihracat_excel_file_handle';
  var HANDLE_DB = 'ihracat_excel_handle_db';
  var LS_KEY = 'ihracat_excel_source_v1';
  var MSG_NOT_SELECTED = 'Önce İhracat Excel dosyasını seçmelisiniz.';
  var MSG_NOT_FOUND = 'İhracat Excel dosyası bulunamadı. Lütfen dosyayı tekrar seçin.';
  var MSG_CLEARED = 'İhracat Excel silindi. Güncellemek için önce dosyayı tekrar yükleyin.';
  var AUTO_REFRESH_MS = 10 * 60 * 1000;
  var FIRST_REFRESH_MS = 15 * 1000;
  var WATCH_MS = 8 * 1000;
  var _busy = false;
  var _silentRun = false;
  var _silentPermMissing = false;
  var _cache = null;
  var _liveHandle = null;
  var _handleReady = null;
  var _handlesByName = Object.create(null);
  var _permInflight = [];
  var _dirHandle = null;
  var DIR_HANDLE_KEY = 'ihracat_dir';

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

  function handleKey(name) {
    return String(name || '').trim().toLowerCase();
  }

  function openHandleDb() {
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open(HANDLE_DB, 1);
      req.onupgradeneeded = function () {
        if (!req.result.objectStoreNames.contains('handles')) req.result.createObjectStore('handles');
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }

  function indexHandle(handle, fileName) {
    if (!handle || typeof handle.getFile !== 'function') return;
    setLiveHandle(handle);
    var key = handleKey(fileName);
    if (key) _handlesByName[key] = handle;
  }

  function handleForName(fileName) {
    return _handlesByName[handleKey(fileName)] || null;
  }

  async function persistHandle(handle, fileName) {
    if (!handle || typeof handle.getFile !== 'function') return false;
    var name = String(fileName || '').trim();
    if (!name) {
      try {
        var peeked = await handle.getFile();
        name = peeked && peeked.name ? String(peeked.name).trim() : '';
      } catch (e) {}
    }
    indexHandle(handle, name);
    var key = handleKey(name);
    var ok = false;
    try {
      if (window.IDBStore && typeof IDBStore.kvSet === 'function') {
        await IDBStore.kvSet(HANDLE_IDB_KEY, handle);
        ok = true;
      }
    } catch (e) {}
      try {
        var db = await openHandleDb();
        await new Promise(function (resolve, reject) {
          var tx = db.transaction('handles', 'readwrite');
          var store = tx.objectStore('handles');
          if (key) store.put(handle, key);
          var req = store.put(handle, 'ihracat');
          req.onsuccess = function () { resolve(true); };
          req.onerror = function () { reject(req.error); };
        });
        ok = true;
      } catch (e) {}
    return ok;
  }

  async function loadHandle() {
    try {
      var db = await openHandleDb();
      var entries = await new Promise(function (resolve, reject) {
        var tx = db.transaction('handles', 'readonly');
        var out = [];
        var cur = tx.objectStore('handles').openCursor();
        cur.onsuccess = function () {
          var cursor = cur.result;
          if (!cursor) { resolve(out); return; }
          out.push({ key: cursor.key, value: cursor.value });
          cursor.continue();
        };
        cur.onerror = function () { reject(cur.error); };
      });
      entries.forEach(function (entry) {
        var handle = entry && entry.value;
        if (!handle) return;
        if (entry.key === DIR_HANDLE_KEY || handle.kind === 'directory') {
          _dirHandle = handle;
          return;
        }
        if (typeof handle.getFile !== 'function') return;
        if (entry.key && entry.key !== 'ihracat') indexHandle(handle, String(entry.key));
        else setLiveHandle(handle);
      });
    } catch (e) {}
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
    return _liveHandle && typeof _liveHandle.getFile === 'function' ? _liveHandle : null;
  }

  async function clearHandle() {
    _liveHandle = null;
    _handlesByName = Object.create(null);
    _permInflight = [];
    try { window.__ihracatExcelLiveHandle = null; } catch (e) {}
    try {
      if (window.IDBStore && typeof IDBStore.kvDel === 'function') {
        await IDBStore.kvDel(HANDLE_IDB_KEY);
      }
    } catch (e) {}
    try {
      var db = await openHandleDb();
      await new Promise(function (resolve, reject) {
        var tx = db.transaction('handles', 'readwrite');
        var store = tx.objectStore('handles');
        var cur = store.openCursor();
        cur.onsuccess = function () {
          var cursor = cur.result;
          if (!cursor) { resolve(true); return; }
          if (cursor.key !== DIR_HANDLE_KEY) cursor.delete();
          cursor.continue();
        };
        cur.onerror = function () { reject(cur.error); };
      });
    } catch (e) {}
  }

  function primeHandlePermissions(names) {
    var seen = [];
    function kick(handle) {
      if (!handle || typeof handle.requestPermission !== 'function') return;
      if (seen.indexOf(handle) >= 0) return;
      seen.push(handle);
      try {
        var p = handle.requestPermission({ mode: 'read' });
        if (p && typeof p.then === 'function') _permInflight.push(p);
      } catch (e) {}
    }
    Object.keys(_handlesByName).forEach(function (key) { kick(_handlesByName[key]); });
    kick(_liveHandle);
    kick(_dirHandle);
    return _permInflight.slice();
  }

  async function waitPrimedPermissions() {
    var list = _permInflight.slice();
    _permInflight = [];
    if (!list.length) return;
    await Promise.all(list.map(function (p) {
      return Promise.resolve(p).catch(function () { return 'denied'; });
    }));
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

  function listLoadedSourceNames() {
    var names = [];
    try {
      if (typeof window.listIhracatExcelSources === 'function') {
        names = window.listIhracatExcelSources() || [];
      }
    } catch (e) {
      names = [];
    }
    if (Array.isArray(names) && names.length) {
      return names.map(function (n) { return String(n || '').trim(); }).filter(Boolean);
    }
    var info = loadedExcelMeta();
    return info.fileName ? [info.fileName] : [];
  }

  function sameExcelName(a, b) {
    return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
  }

  function excelStem(name) {
    return String(name || '').replace(/\.(xlsx|xlsm|xlsb|xls)$/i, '').trim().toLowerCase();
  }

  /** Liman "tamamlandı" deyince bu dosya bir daha okunmaz. */
  function dropStemSet() {
    try {
      var raw = JSON.parse(localStorage.getItem('liman_drop_files_v1') || '[]');
      var set = Object.create(null);
      (Array.isArray(raw) ? raw : []).forEach(function (n) {
        var s = excelStem(n);
        if (s) set[s] = true;
      });
      return set;
    } catch (e) {
      return Object.create(null);
    }
  }

  var _ignoreLocalDrop = false;

  function isDroppedSource() {
    return false;
  }

  function forgetDroppedSources(stems) {
    var set = Object.create(null);
    (stems || []).forEach(function (n) {
      var s = excelStem(n);
      if (s) set[s] = true;
    });
    Object.keys(_handlesByName).forEach(function (key) {
      if (set[excelStem(key)]) delete _handlesByName[key];
    });
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

  function escHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function sourceRowCount(name) {
    try {
      if (typeof loadDailyShipments !== 'function') return 0;
      var rows = loadDailyShipments() || [];
      var target = String(name || '').trim();
      var n = 0;
      for (var i = 0; i < rows.length; i++) {
        if (rows[i] && String(rows[i].fileName || '').trim() === target) n++;
      }
      return n;
    } catch (e) {
      return 0;
    }
  }

  var _picking = false;
  var _needPath = false;

  function setNeedPath(on) {
    _needPath = !!on;
    try {
      if (_needPath) sessionStorage.setItem('ihracatExcelNeedPath', '1');
      else sessionStorage.removeItem('ihracatExcelNeedPath');
    } catch (e) {}
  }

  function pathPickNeeded() {
    if (_needPath) return true;
    try {
      if (sessionStorage.getItem('ihracatExcelNeedPath') === '1') {
        _needPath = true;
        return true;
      }
    } catch (e) {}
    return false;
  }

  /** 2+ Excel yüklüyse hangilerinin güncelleneceğini sor. Hepsi seçili gelir. */
  function pickSourcesToRefresh(names) {
    var list = (names || []).map(function (n) { return String(n || '').trim(); }).filter(Boolean);
    if (list.length < 2) return Promise.resolve(list);
    if (_picking) return Promise.resolve(null);
    _picking = true;
    return new Promise(function (resolve) {
      var done = false;
      var overlay = document.createElement('div');
      function finish(value) {
        if (done) return;
        done = true;
        _picking = false;
        try { overlay.remove(); } catch (e) {}
        document.removeEventListener('keydown', onKey);
        resolve(value);
      }
      function onKey(ev) {
        if (ev.key !== 'Escape') return;
        ev.preventDefault();
        finish(null);
      }
      overlay.id = 'ihracatExcelRefreshPick';
      overlay.className = 'rp-dialog-overlay';
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-modal', 'true');
      overlay.setAttribute('aria-labelledby', 'ihracatExcelRefreshPickTitle');
      var rowsHtml = list.map(function (name) {
        var cnt = sourceRowCount(name);
        var meta = cnt ? (cnt + ' kayıt') : '';
        return (
          '<label class="ihracat-excel-pick__row">' +
            '<input type="checkbox" class="ihracat-excel-pick__check" data-name="' + escHtml(name) + '" checked>' +
            '<span class="ihracat-excel-pick__name">' + escHtml(name) + '</span>' +
            (meta ? '<span class="ihracat-excel-pick__meta">' + escHtml(meta) + '</span>' : '') +
          '</label>'
        );
      }).join('');
      overlay.innerHTML =
        '<div class="rp-dialog ihracat-excel-pick">' +
          '<div class="rp-dialog-head">' +
            '<div class="rp-dialog-icon is-info" aria-hidden="true"><i class="fas fa-sync-alt"></i></div>' +
            '<div id="ihracatExcelRefreshPickTitle" class="rp-dialog-title">Hangi Excel güncellensin?</div>' +
          '</div>' +
          '<div class="rp-dialog-body">' +
            '<p class="rp-dialog-msg">' + list.length + ' Excel yüklü. Hepsini güncelleyebilir veya yalnızca istediklerinizi seçebilirsiniz.</p>' +
            '<div class="ihracat-excel-pick__list">' + rowsHtml + '</div>' +
          '</div>' +
          '<div class="rp-dialog-actions">' +
            '<button type="button" class="rp-dialog-btn rp-dialog-btn-ghost" data-act="cancel">İptal</button>' +
            '<button type="button" class="rp-dialog-btn rp-dialog-btn-primary" data-act="ok">Hepsini güncelle</button>' +
          '</div>' +
        '</div>';
      function selectedNames() {
        var out = [];
        overlay.querySelectorAll('.ihracat-excel-pick__check').forEach(function (ch) {
          if (ch.checked) out.push(ch.getAttribute('data-name') || '');
        });
        return out.filter(Boolean);
      }
      function syncOk() {
        var okBtn = overlay.querySelector('[data-act="ok"]');
        if (!okBtn) return;
        var picked = selectedNames();
        okBtn.textContent = picked.length === list.length ? 'Hepsini güncelle' : 'Seçilenleri güncelle';
        okBtn.disabled = !picked.length;
      }
      document.body.appendChild(overlay);
      document.addEventListener('keydown', onKey);
      overlay.addEventListener('click', function (ev) {
        if (ev.target === overlay) finish(null);
      });
      overlay.querySelector('[data-act="cancel"]').addEventListener('click', function () { finish(null); });
      overlay.querySelector('[data-act="ok"]').addEventListener('click', function () {
        var picked = selectedNames();
        if (!picked.length) return;
        primeHandlePermissions(picked);
        var pickerPromise = null;
        if (namesLackHandle(picked) || pathPickNeeded()) {
          pickerPromise = openExcelPicker(picked.length > 1);
        }
        finish({ names: picked, pickerPromise: pickerPromise });
      });
      overlay.querySelectorAll('.ihracat-excel-pick__check').forEach(function (ch) {
        ch.addEventListener('change', syncOk);
      });
      syncOk();
    });
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
        var multi = false;
        try { multi = listLoadedSourceNames().length > 1; } catch (e2) {}
        var baseTitle = multi
          ? 'Yüklü Excel dosyalarından hangilerinin güncelleneceğini seç'
          : 'Yüklü İhracat Excel dosyasını yeniden oku';
        btn.title = label ? (baseTitle + ' — ' + label) : baseTitle;
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

  var EXCEL_PICKER_TYPES = [
    {
      description: 'Excel',
      accept: {
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
        'application/vnd.ms-excel': ['.xls'],
        'application/vnd.ms-excel.sheet.macroEnabled.12': ['.xlsm'],
        'application/vnd.ms-excel.sheet.binary.macroEnabled.12': ['.xlsb'],
      },
    },
  ];

  function namesLackHandle(names) {
    var list = names || [];
    if (!list.length) return false;
    for (var i = 0; i < list.length; i++) {
      if (!handleForName(list[i])) return true;
    }
    return false;
  }

  function openExcelInput(multiple) {
    return new Promise(function (resolve, reject) {
      var input = document.createElement('input');
      input.type = 'file';
      input.accept = '.xlsx,.xls,.xlsm,.xlsb';
      if (multiple) input.multiple = true;
      input.style.cssText = 'position:fixed;left:-9999px;top:0';
      var settled = false;
      function done(err, files) {
        if (settled) return;
        settled = true;
        try { input.remove(); } catch (e) {}
        if (err) reject(err);
        else resolve(files);
      }
      input.addEventListener('change', function () {
        var files = Array.prototype.slice.call(input.files || []);
        if (!files.length) {
          done(Object.assign(new Error('cancel'), { name: 'AbortError' }));
          return;
        }
        done(null, files.map(function (file) {
          return { getFile: function () { return Promise.resolve(file); } };
        }));
      });
      input.addEventListener('cancel', function () {
        done(Object.assign(new Error('cancel'), { name: 'AbortError' }));
      });
      document.body.appendChild(input);
      input.click();
    });
  }

  function openExcelPicker(multiple) {
    if (typeof window.showOpenFilePicker === 'function') {
      try {
        return window.showOpenFilePicker({
          types: EXCEL_PICKER_TYPES,
          excludeAcceptAllOption: false,
          multiple: !!multiple,
        });
      } catch (e) {}
    }
    return openExcelInput(!!multiple);
  }

  async function presetFromPickerHandles(handles, expectedNames) {
    var preset = Object.create(null);
    var files = [];
    var pairs = [];
    var list = handles || [];
    for (var i = 0; i < list.length; i++) {
      try {
        if (!list[i] || typeof list[i].getFile !== 'function') continue;
        var file = await list[i].getFile();
        if (!file) continue;
        try { await persistHandle(list[i], file.name); } catch (e) {}
        preset[handleKey(file.name)] = file;
        files.push(file);
        pairs.push({ handle: list[i], file: file });
      } catch (e) {}
    }
    var map = bindPresetToExpected(preset, files, expectedNames);
    var expected = (expectedNames || []).map(function (n) { return String(n || '').trim(); }).filter(Boolean);
    for (var n = 0; n < expected.length; n++) {
      var sourceName = expected[n];
      var picked = map[handleKey(sourceName)];
      if (!picked) continue;
      for (var h = 0; h < pairs.length; h++) {
        if (!pairs[h].file || !sameExcelName(pairs[h].file.name, picked.name)) continue;
        try { await persistHandle(pairs[h].handle, sourceName); } catch (e3) {}
        break;
      }
      map[handleKey(sourceName)] = aliasFileToSource(picked, sourceName);
    }
    return map;
  }

  function aliasFileToSource(file, sourceName) {
    var wanted = String(sourceName || '').trim();
    if (!file || !wanted) return file;
    if (sameExcelName(file.name, wanted)) return file;
    try {
      var aliased = new File([file], wanted, {
        type: file.type || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        lastModified: Number(file.lastModified) || Date.now(),
      });
      aliased.__diskName = file.__diskName || file.name;
      return aliased;
    } catch (e) {
      return file;
    }
  }

  /** Diskteki adı başka bir yüklü Excel'in adı olan dosya bu kaynak yerine okunmaz (YD28 karışması). */
  function belongsToOtherSource(file, sourceName, sources) {
    var disk = file && (file.__diskName || file.name);
    if (!disk || sameExcelName(disk, sourceName)) return false;
    return (sources || []).some(function (n) { return sameExcelName(n, disk); });
  }

  function dateToken(name) {
    var m = String(name || '').match(/(\d{1,2})[.\-_](\d{1,2})[.\-_](\d{4})/);
    if (!m) return '';
    function pad(n) { return n.length === 1 ? '0' + n : n; }
    return pad(m[1]) + '.' + pad(m[2]) + '.' + m[3];
  }

  function bindPresetToExpected(preset, files, expectedNames) {
    var map = preset || Object.create(null);
    var list = files || [];
    var expected = (expectedNames || []).map(function (n) { return String(n || '').trim(); }).filter(Boolean);
    var used = Object.create(null);
    var expectedKeys = Object.create(null);
    expected.forEach(function (name) { expectedKeys[handleKey(name)] = true; });
    list.forEach(function (file) {
      if (file && file.name) used[handleKey(file.name)] = false;
    });
    // Önce birebir ad: "03.10.2026.xlsx" ile "03.10.2026-YD28.xlsx" aynı tarihli diye yer değiştirmesin
    expected.forEach(function (name) {
      var key = handleKey(name);
      if (map[key]) {
        used[key] = true;
        return;
      }
      for (var i = 0; i < list.length; i++) {
        if (handleKey(list[i] && list[i].name) === key) {
          map[key] = list[i];
          used[key] = true;
          return;
        }
      }
    });
    expected.forEach(function (name) {
      var key = handleKey(name);
      if (map[key]) return;
      for (var i = 0; i < list.length; i++) {
        var file = list[i];
        var fk = handleKey(file && file.name);
        if (!fk || used[fk] || expectedKeys[fk]) continue;
        var sameDate = dateToken(name) && dateToken(name) === dateToken(file && file.name);
        if (fk === key || fk.indexOf(key) >= 0 || key.indexOf(fk) >= 0 || sameDate) {
          map[key] = file;
          used[fk] = true;
          return;
        }
      }
    });
    var leftNames = expected.filter(function (name) { return !map[handleKey(name)]; });
    var leftFiles = list.filter(function (file) {
      var fk = handleKey(file && file.name);
      return fk && !used[fk] && !expectedKeys[fk];
    });
    if (leftNames.length && leftNames.length === leftFiles.length) {
      leftNames.forEach(function (name, i) { map[handleKey(name)] = leftFiles[i]; });
    }
    return map;
  }

  function openFolderPicker() {
    if (typeof window.showDirectoryPicker !== 'function') return null;
    try {
      return window.showDirectoryPicker({ mode: 'read' });
    } catch (e) {
      return null;
    }
  }

  async function persistDirHandle(dirHandle) {
    if (!dirHandle || typeof dirHandle.values !== 'function') return false;
    _dirHandle = dirHandle;
    try {
      var db = await openHandleDb();
      await new Promise(function (resolve, reject) {
        var tx = db.transaction('handles', 'readwrite');
        var req = tx.objectStore('handles').put(dirHandle, DIR_HANDLE_KEY);
        req.onsuccess = function () { resolve(true); };
        req.onerror = function () { reject(req.error); };
      });
      return true;
    } catch (e) {
      return false;
    }
  }

  async function collectDirExcelFiles(dirHandle, depth) {
    var files = [];
    if (!dirHandle || typeof dirHandle.values !== 'function') return files;
    var iter = dirHandle.values();
    if (!iter || typeof iter.next !== 'function') return files;
    while (true) {
      var step = await iter.next();
      if (!step || step.done) break;
      var entry = step.value;
      if (!entry) continue;
      if (entry.kind === 'file' && /\.(xlsx|xls|xlsm|xlsb)$/i.test(entry.name || '')) {
        if (isDroppedSource(entry.name)) continue;
        try {
          var file = await entry.getFile();
          if (file && !isDroppedSource(file.name)) files.push(file);
        } catch (e) {}
      } else if (entry.kind === 'directory' && depth > 0 && entry.name !== 'node_modules') {
        var nested = await collectDirExcelFiles(entry, depth - 1);
        files = files.concat(nested);
      }
    }
    return files;
  }

  async function collectReadableExcelFiles() {
    var files = [];
    var seen = [];
    // Eski günlerin dosya tutamaçları da taranır; onların izni yoksa "dosya izni yok" denmesin.
    var permBefore = _silentPermMissing;
    async function take(handle) {
      if (!handle || typeof handle.getFile !== 'function' || seen.indexOf(handle) >= 0) return;
      seen.push(handle);
      var file = null;
      try { file = await readFileFromHandle(handle); } catch (e) { file = null; }
      if (file && !file.__missing && !file.__notSelected && file.name && !isDroppedSource(file.name)) files.push(file);
    }
    var keys = Object.keys(_handlesByName);
    for (var i = 0; i < keys.length; i++) await take(_handlesByName[keys[i]]);
    await take(_liveHandle);
    if (_dirHandle) {
      try {
        var fromDir = await collectDirExcelFiles(_dirHandle, 4);
        for (var j = 0; j < fromDir.length; j++) files.push(fromDir[j]);
      } catch (e) { /* klasör izni yok (sessiz çalışma) */ }
    }
    _silentPermMissing = permBefore;
    return files;
  }

  async function pickFileWithHandle() {
    if (typeof window.showOpenFilePicker !== 'function') return { unsupported: true };
    try {
      var handles = await window.showOpenFilePicker({
        types: EXCEL_PICKER_TYPES,
        excludeAcceptAllOption: false,
        multiple: false,
      });
      var handle = handles && handles[0];
      if (!handle) return { cancelled: true };
      var file = null;
      try {
        file = await handle.getFile();
      } catch (err) {
        return { unsupported: true };
      }
      try { await persistHandle(handle, file && file.name); } catch (err2) {}
      try { await rememberSelectedFile(file); } catch (err) {}
      return { file: file };
    } catch (e) {
      if (e && e.name === 'AbortError') return { cancelled: true };
      return { unsupported: true };
    }
  }

  async function readFileFromHandle(handle) {
    if (!handle || typeof handle.getFile !== 'function') return null;
    try {
      if (typeof handle.queryPermission === 'function') {
        var q = await handle.queryPermission({ mode: 'read' });
        if (q === 'granted') return await handle.getFile();
      }
      // Sessiz (otomatik) çalışmada izin penceresi açılmaz; izin yoksa dosya yok sayılır.
      if (_silentRun) {
        _silentPermMissing = true;
        return { __missing: true };
      }
      // İzin tıklama anında primeHandlePermissions ile istenmiş olmalı.
      if (typeof handle.requestPermission === 'function') {
        var perm = await handle.requestPermission({ mode: 'read' });
        if (perm !== 'granted') return { __missing: true };
      }
      return await handle.getFile();
    } catch (e) {
      return { __missing: true };
    }
  }

  async function fileFromHandle() {
    var handle = await loadHandle();
    return readFileFromHandle(handle);
  }

  async function fileFromBackendReread(fileNameHint) {
    var info = loadedExcelMeta();
    var local = readLocalMeta();
    var wanted = String(fileNameHint || '').trim();
    var payload = {
      fileName: wanted || (info && info.fileName) || local.fileName || '',
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
    if (res.status === 410) {
      return { __settled: true };
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
    // İstenen ada uymayan cevap (eski sunucu / klasör fallback) — bu kaynak için yok say.
    if (wanted && !sameExcelName(name, wanted)) {
      return { __missing: true, __wrongName: name };
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

  async function applyPickedExcelFile(file, opts) {
    if (!file || file.__missing || file.__notSelected || file.__cancelled) return file;
    if (typeof window.applyIhracatExcelReread !== 'function') {
      return { ok: false, msg: MSG_NOT_FOUND };
    }
    var silent = !!(opts && opts.silentToast);
    var result = await window.applyIhracatExcelReread(file);
    if (result && result.ok) {
      await rememberAfterImport({
        fileName: file.name,
        filePath: extractFilePath(file),
        sheetName: result.meta && result.meta.sheetName,
      });
      if (!silent && typeof window.showToast === 'function') {
        window.showToast(result.msg || 'Excel güncellendi.', 'success');
      }
    }
    return result;
  }

  async function resolveFileForSource(sourceName, handleFile) {
    var wanted = String(sourceName || '').trim();
    if (!wanted) return { __missing: true };
    if (isDroppedSource(wanted)) return { __settled: true };

    var namedFile = null;
    var namedHandle = handleForName(wanted);
    if (namedHandle) {
      try { namedFile = await readFileFromHandle(namedHandle); } catch (e) { namedFile = null; }
    }
    var handleOk = namedFile && !namedFile.__missing && !namedFile.__cancelled && !namedFile.__notSelected;
    if (!handleOk && handleFile && !handleFile.__missing && !handleFile.__cancelled) {
      // Aynı tarihli başka yüklü Excel'in dosyası bu kaynağın adıyla okunmasın
      var otherSource = listLoadedSourceNames().some(function (n) {
        return !sameExcelName(n, wanted) && sameExcelName(n, handleFile.name);
      });
      var dated = !otherSource && dateToken(handleFile.name) && dateToken(handleFile.name) === dateToken(wanted);
      if (sameExcelName(handleFile.name, wanted) || dated) {
        namedFile = handleFile;
        handleOk = true;
      }
    }
    if (handleOk) namedFile = aliasFileToSource(namedFile, wanted);
    if (handleOk) return namedFile;

    // Tarayıcı dosyayı okuyamazsa sunucudaki kayıtlı yol. Ajan kopyası kullanılmaz.
    var fromBackend = null;
    try { fromBackend = await fileFromBackendReread(wanted); } catch (e) { fromBackend = null; }
    if (fromBackend && fromBackend.__settled) return fromBackend;
    var backendOk = fromBackend && !fromBackend.__missing && !fromBackend.__notSelected
      && sameExcelName(fromBackend.name, wanted);
    if (backendOk) return fromBackend;
    return { __missing: true };
  }

  var DROP_ARM_KEY = 'liman_drop_arm_v1';

  function readDropArm() {
    try {
      var raw = JSON.parse(sessionStorage.getItem(DROP_ARM_KEY) || '[]');
      return Array.isArray(raw) ? raw.filter(Boolean) : [];
    } catch (e) {
      return [];
    }
  }

  function writeDropArm(list) {
    try { sessionStorage.setItem(DROP_ARM_KEY, JSON.stringify(list || [])); } catch (e) {}
  }

  async function refreshFromStored(permPromise, onlyNames, presetFiles, opts) {
    if (_busy) return { ok: false, msg: 'Güncelleme sürüyor.' };
    var silent = !!(opts && opts.silent);
    try { sessionStorage.removeItem(DROP_ARM_KEY); } catch (eArm) {}
    _silentRun = silent;
    setRefreshBusy(true);
    var okNames = [];
    var failNames = [];
    try {
      await waitPrimedPermissions();
      adoptLoadedExcelAsSource();
      if (!hasLoadedExcel()) {
        if (!silent) await warn(MSG_CLEARED);
        return { ok: false, code: 'EXCEL_CLEARED', msg: MSG_CLEARED };
      }

      var sources = listLoadedSourceNames();
      if (Array.isArray(onlyNames) && onlyNames.length) {
        var allow = Object.create(null);
        onlyNames.forEach(function (n) {
          allow[String(n || '').trim().toLowerCase()] = true;
        });
        sources = sources.filter(function (n) {
          return allow[String(n || '').trim().toLowerCase()];
        });
      }
      if (!sources.length) {
        if (!silent) await warn(MSG_CLEARED);
        return { ok: false, code: 'EXCEL_CLEARED', msg: MSG_CLEARED };
      }

      // Güncelle dosya seçici açmaz. Yüklü her Excel'i diskten yeniden okur.
      var handle = _liveHandle || window.__ihracatExcelLiveHandle;
      var handleFile = null;
      try {
        if (permPromise && typeof permPromise.then === 'function' && handle && typeof handle.getFile === 'function') {
          var perm = await permPromise;
          if (perm === 'granted') handleFile = await handle.getFile();
        } else if (handle && typeof handle.getFile === 'function') {
          handleFile = await readFileFromHandle(handle);
        }
      } catch (e) {
        handleFile = null;
      }
      if (handleFile && isDroppedSource(handleFile.name)) handleFile = null;

      var multi = sources.length > 1;
      var lastOk = null;
      var lastFailMsg = '';
      var gathered = await collectReadableExcelFiles();
      var fromDisk = bindPresetToExpected(Object.create(null), gathered, sources);
      var presetAll = Object.assign(fromDisk, presetFiles || {});

      for (var i = 0; i < sources.length; i++) {
        var sourceName = sources[i];
        try {
          var rawPreset = presetAll[handleKey(sourceName)] || null;
          var file = rawPreset ? aliasFileToSource(rawPreset, sourceName) : null;
          if (file && belongsToOtherSource(file, sourceName, sources)) file = null;
          if (!file) file = await resolveFileForSource(sourceName, handleFile);
          if (file && belongsToOtherSource(file, sourceName, listLoadedSourceNames())) file = null;
          if (file && file.__settled) continue;
          if (!file || file.__missing || file.__notSelected) {
            failNames.push(sourceName);
            continue;
          }
          var result = await applyPickedExcelFile(file, { silentToast: multi || silent });
          if (result && result.ok) {
            okNames.push(sourceName);
            lastOk = result;
          } else {
            failNames.push(sourceName);
            if (result && result.msg) lastFailMsg = result.msg;
          }
        } catch (err) {
          failNames.push(sourceName);
        }
      }

      if (!okNames.length) {
        if (!failNames.length) {
          failNames = listLoadedSourceNames().slice();
        }
        if (silent) {
          return { ok: false, code: 'EXCEL_FILE_NOT_FOUND', msg: lastFailMsg || MSG_NOT_FOUND, failNames: failNames, silent: true };
        }
        setNeedPath(true);
        heartbeat(true, { ok: false, reason: 'not-found' });
        if (typeof window.showToast === 'function') window.showToast(lastFailMsg || MSG_NOT_FOUND, 'warn');
        return { ok: false, code: 'EXCEL_FILE_NOT_FOUND', msg: lastFailMsg || MSG_NOT_FOUND, failNames: failNames };
      }
      setNeedPath(false);
      if (!silent) heartbeat(true, { ok: true });
      // Liman listesine gönder; sonucu kantar görsün (eskiden hata sessizce yutuluyordu)
      var limanNote = '';
      try {
        if (typeof window.publishLimanFromStore === 'function') {
          var pub = await Promise.resolve(window.publishLimanFromStore(true, { keepDropped: true }));
          if (pub && pub.sent) {
            if (!pub.ok) {
              limanNote = pub.status === 401
                ? 'Liman listesine GÖNDERİLEMEDİ: oturum düştü ve yenilenemedi, şifreyle tekrar giriş yapın.'
                : 'Liman listesine GÖNDERİLEMEDİ: ' + (pub.error || 'sunucu hatası') + '.';
              try {
                if (pub.status === 401 && window.SessionManager && typeof window.SessionManager.showSessionBanner === 'function') {
                  window.SessionManager.showSessionBanner('Liman listesi gönderilemiyor: oturum yenilenemedi. Şifreyle tekrar giriş yapın.', {
                    actionLabel: 'Giriş ekranı',
                    onAction: function () { try { localStorage.removeItem('isLoggedIn'); } catch (e) {} window.location.href = '/GIRIS.html'; },
                  });
                }
              } catch (eB) { /* ignore */ }
            } else if (pub.skipped) {
              limanNote = '';
            } else if (pub.unchanged) {
              limanNote = 'Liman listesi aynı (Excel içeriği değişmemiş).';
            } else {
              limanNote = 'Liman listesi güncellendi (' + (pub.site || '') + ').';
            }
          } else if (pub && pub.reason === 'empty') {
            limanNote = 'Liman listesine gönderilecek satır yok.';
          }
        }
      } catch (e) {}
      if (limanNote && !silent && typeof window.showToast === 'function') {
        var limanBad = /GÖNDERİLEMEDİ/.test(limanNote);
        window.showToast(limanNote, limanBad ? 'error' : (/aynı|yok/.test(limanNote) ? 'warn' : 'success'), limanBad ? 9000 : 3200);
      }
      if (/GÖNDERİLEMEDİ/.test(limanNote)) {
        try { console.warn('[Liman] ' + limanNote); } catch (e) {}
      }

      var summary;
      if (multi) {
        if (!failNames.length) {
          summary = okNames.length + ' Excel güncellendi.';
        } else {
          summary = okNames.length + '/' + sources.length + ' Excel güncellendi. Bulunamayan: '
            + failNames.join(', ');
        }
        if (!silent && typeof window.showToast === 'function') {
          window.showToast(summary, failNames.length ? 'warn' : 'success');
        }
      }

      return Object.assign({}, lastOk || {}, {
        ok: true,
        msg: summary || (lastOk && lastOk.msg) || 'Excel güncellendi.',
        okNames: okNames,
        failNames: failNames,
        fileCount: sources.length,
      });
    } catch (e) {
      if (okNames && okNames.length) {
        if (!silent) heartbeat(true, { ok: true });
        if (!silent) await warn(okNames.join(', ') + ' güncellendi. Diğer dosya okunamadı.');
        return { ok: true, okNames: okNames, failNames: failNames || [], msg: MSG_NOT_FOUND };
      }
      if (!silent) await warn(MSG_NOT_FOUND);
      return { ok: false, code: 'EXCEL_FILE_NOT_FOUND', msg: MSG_NOT_FOUND };
    } finally {
      _silentRun = false;
      _ignoreLocalDrop = false;
      setRefreshBusy(false);
    }
  }

  /** Kantar oturumu mu (amir değil, giriş yapılmış)? */
  function isKantarSessionActive() {
    try {
      var sm = window.SessionManager;
      if (sm && typeof sm.isAmirUser === 'function' && sm.isAmirUser()) return false;
      if (typeof window.isAppLoggedIn === 'function') return !!window.isAppLoggedIn();
      return localStorage.getItem('isLoggedIn') === 'true';
    } catch (e) {
      return false;
    }
  }

  /**
   * 10 dk'da bir sessiz güncelleme: kullanıcı Güncelle'ye basmasa da
   * Excel diskten okunur ve liman listesine gönderilir. İzin / dosya yoksa sessizce atlanır.
   */
  /** Kantar nabzı (Excel olmasa da): amir "kantar PC bağlı mı?" sorusunu buradan görür. */
  function heartbeat(excelLoaded, read) {
    try {
      if (typeof window.sendLimanHeartbeat !== 'function') return Promise.resolve(null);
      var info = { excelLoaded: !!excelLoaded };
      if (read) {
        info.readOk = !!read.ok;
        info.readReason = read.ok ? '' : (read.reason || '');
      }
      return Promise.resolve(window.sendLimanHeartbeat(info)).catch(function () { return null; });
    } catch (e) { return Promise.resolve(null); }
  }

  async function autoRefreshTick() {
    if (_busy || _picking) return;
    if (typeof window.applyIhracatExcelReread !== 'function') return; // bu sayfa Excel'i işleyemez
    if (!isKantarSessionActive()) return;
    if (!navigator.onLine) return;
    // Önce oturumu garanti et: düşmüşse cihaz anahtarıyla sessizce yenilenir (insana bağımlı olmasın)
    try {
      var sm = window.SessionManager;
      if (sm && typeof sm.ensureSession === 'function') {
        var alive = await sm.ensureSession();
        if (!alive) { try { console.info('[İhracat Excel] oturum yenilenemedi, otomatik gönderim atlandı'); } catch (e0) {} return; }
      }
    } catch (e) { /* kontrol edilemedi, yine de dene */ }
    try { await loadHandle(); } catch (e) {}
    adoptLoadedExcelAsSource();
    if (!hasLoadedExcel()) { heartbeat(false, { ok: false, reason: 'no-excel' }); return; }
    var sources = [];
    try { sources = listLoadedSourceNames(); } catch (e) { sources = []; }
    if (!sources.length) { heartbeat(false, { ok: false, reason: 'no-excel' }); return; }
    var read = { ok: false, reason: 'error' };
    _silentPermMissing = false;
    try {
      var r = await refreshFromStored(null, null, null, { silent: true });
      if (r && r.ok) {
        read = { ok: true };
        try { console.info('[İhracat Excel] otomatik güncellendi:', (r.okNames || []).join(', ')); } catch (e2) {}
      } else if (r && r.code === 'EXCEL_FILE_NOT_FOUND') {
        read = { ok: false, reason: _silentPermMissing ? 'permission' : 'not-found' };
      } else if (r && r.code === 'EXCEL_CLEARED') {
        read = { ok: false, reason: 'no-excel' };
      } else if (r && r.msg === 'Güncelleme sürüyor.') {
        return;
      }
    } catch (e) { /* sessiz */ }
    heartbeat(true, read);
  }

  /** Kaydedilen Excel'i fark etmek için yalnız dosya damgası (tarih + boyut) okunur; izin penceresi açılmaz. */
  var _watchStamps = Object.create(null);
  var _watchBusy = false;

  async function grantedStamp(handle) {
    if (!handle || typeof handle.getFile !== 'function' || typeof handle.queryPermission !== 'function') return '';
    try {
      if ((await handle.queryPermission({ mode: 'read' })) !== 'granted') return '';
      var f = await handle.getFile();
      return f ? String(f.lastModified) + ':' + String(f.size) : '';
    } catch (e) {
      return '';
    }
  }

  async function watchTick() {
    if (_watchBusy || _busy || _picking) return;
    if (typeof window.applyIhracatExcelReread !== 'function') return;
    if (!isKantarSessionActive() || !navigator.onLine) return;
    _watchBusy = true;
    try {
      var sources = [];
      try { sources = listLoadedSourceNames(); } catch (e) { sources = []; }
      var changed = false;
      for (var i = 0; i < sources.length; i++) {
        var key = handleKey(sources[i]);
        var stamp = await grantedStamp(handleForName(sources[i]) || (sources.length === 1 ? _liveHandle : null));
        if (!stamp) continue;
        if (_watchStamps[key] && _watchStamps[key] !== stamp) changed = true;
        _watchStamps[key] = stamp;
      }
      if (changed) {
        try { console.info('[İhracat Excel] dosya kaydedildi, liste yeniden okunuyor'); } catch (e) {}
        await autoRefreshTick();
      }
    } finally {
      _watchBusy = false;
    }
  }

  /**
   * Sekme uykudan / bilgisayar uykudan uyanınca, sekme yeniden görünür olunca
   * veya internet geri gelince 10 dk beklemeden hemen güncelle (Edge uyku sekmeleri).
   */
  var WAKE_MIN_GAP_MS = 60 * 1000;
  var _lastWakeTickAt = 0;
  var _lastTimerAt = Date.now();

  function wakeTick() {
    var now = Date.now();
    if (now - _lastWakeTickAt < WAKE_MIN_GAP_MS) return;
    _lastWakeTickAt = now;
    _lastTimerAt = now;
    autoRefreshTick().catch(function () {});
  }

  function startAutoRefresh() {
    if (window.__ihracatExcelAutoRefreshTimer) return;
    if (/\/liman(\.html)?$/i.test(String(location.pathname || ''))) return;
    window.__ihracatExcelAutoRefreshTimer = setInterval(function () {
      _lastTimerAt = Date.now();
      autoRefreshTick().catch(function () {});
    }, AUTO_REFRESH_MS);
    setTimeout(function () { autoRefreshTick().catch(function () {}); }, FIRST_REFRESH_MS);
    setInterval(function () {
      // Zamanlayıcı uzun süre çalışmadıysa sayfa donmuş/uyumuş demektir: hemen güncelle.
      if (Date.now() - _lastTimerAt > AUTO_REFRESH_MS + WATCH_MS * 2) wakeTick();
      watchTick().catch(function () {});
    }, WATCH_MS);
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) wakeTick();
    });
    document.addEventListener('resume', wakeTick);
    window.addEventListener('online', wakeTick);
    window.addEventListener('pageshow', function (ev) {
      if (ev && ev.persisted) wakeTick();
    });
  }
  try {
    window.addEventListener('daily-store-ready', function () {
      adoptLoadedExcelAsSource();
      syncLastUpdateUiFromLocal();
      loadHandle().catch(function () {});
    });
  } catch (e) {}
  try { _handleReady = loadHandle(); } catch (e) { _handleReady = Promise.resolve(null); }
  try { startAutoRefresh(); } catch (e) {}

  if (!window.__ihracatExcelRefreshBound) {
    window.__ihracatExcelRefreshBound = true;
    document.addEventListener('click', function (e) {
      var btn = e.target && e.target.closest && e.target.closest('.js-ihracat-excel-refresh');
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();
      if (_busy || _picking || btn.disabled || btn.getAttribute('aria-busy') === 'true') return;
      try {
        if (typeof window.closeAppToolsMenu === 'function') window.closeAppToolsMenu();
      } catch (err) {}
      var sourcesNow = [];
      try { sourcesNow = listLoadedSourceNames(); } catch (err3) { sourcesNow = []; }
      function beginRefresh(onlyNames, presetFiles, fromClick) {
        var names = (onlyNames && onlyNames.length) ? onlyNames : sourcesNow;
        if (fromClick && _permInflight.length === 0) primeHandlePermissions(names);
        var handle = _liveHandle || window.__ihracatExcelLiveHandle;
        var permPromise = null;
        if (fromClick && handle && typeof handle.requestPermission === 'function' && _permInflight.length === 0) {
          try { permPromise = handle.requestPermission({ mode: 'read' }); } catch (err2) {}
        }
        refreshFromStored(permPromise, onlyNames, presetFiles);
      }
      if (sourcesNow.length > 1) {
        var chosenNames = null;
        loadHandle().then(function () {
          return pickSourcesToRefresh(sourcesNow);
        }).then(function (picked) {
          if (!picked || !picked.names || !picked.names.length) return null;
          chosenNames = picked.names;
          if (!picked.pickerPromise) return { names: picked.names, preset: null };
          return picked.pickerPromise.then(function (handles) {
            return presetFromPickerHandles(handles, picked.names).then(function (preset) {
              return { names: picked.names, preset: preset };
            });
          });
        }).then(function (ready) {
          if (!ready || !ready.names || !ready.names.length) return;
          beginRefresh(ready.names, ready.preset, false);
        }).catch(function (err) {
          if (err && err.name === 'AbortError') {
            beginRefresh(chosenNames, null, true);
          }
        });
        return;
      }
      if (namesLackHandle(sourcesNow) || pathPickNeeded()) {
        var onePicker = openExcelPicker(false);
        if (onePicker) {
          onePicker.then(function (handles) {
            return presetFromPickerHandles(handles, sourcesNow);
          }).then(function (preset) {
            beginRefresh(null, preset, false);
          }).catch(function (err4) {
            if (err4 && err4.name === 'AbortError') beginRefresh(null, null, true);
          });
          return;
        }
      }
      beginRefresh(null, null, true);
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
    listLoadedSourceNames: listLoadedSourceNames,
    forgetDroppedSources: forgetDroppedSources,
    isDroppedSource: isDroppedSource,
    pickSourcesToRefresh: pickSourcesToRefresh,
    getCachedSheetName: getCachedSheetName,
    hydrateFromBackend: hydrateFromBackend,
    syncLastUpdateUiFromLocal: syncLastUpdateUiFromLocal,
    updateLastUpdateUi: updateLastUpdateUi,
    refreshFromStored: refreshFromStored,
    autoRefreshTick: autoRefreshTick,
    readStoredExcelFile: readStoredExcelFile,
    hasStoredSource: hasStoredSource,
    MSG_NOT_SELECTED: MSG_NOT_SELECTED,
    MSG_NOT_FOUND: MSG_NOT_FOUND,
    MSG_CLEARED: MSG_CLEARED,
  };
})();
