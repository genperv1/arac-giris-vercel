// dailyStore.js
// Günlük Excel sevkiyat verisini (İHRACAT) bu bilgisayarda tutar.
// Küçük veri → localStorage; büyük / kota dolu → IndexedDB (idb.js).

(function(){
  'use strict';

  const LS_ROWS_KEY = 'daily_shipments_current';
  const LS_META_KEY = 'daily_shipments_meta';
  const LS_BACKEND_KEY = 'daily_shipments_backend';

  const cache = {
    loaded: false,
    rows: [],
    meta: {},
    indexByPlate: null,
    lastIndexedAt: 0,
  };

  let _hydratePromise = null;
  let _hydrateSeq = 0;

  function _safeJsonParse(raw, fallback){
    try{ const v = JSON.parse(raw); return v ?? fallback; }catch(e){ return fallback; }
  }

  function _idbAvailable(){
    try { return !!(window.IDBStore && typeof IDBStore.isAvailable === 'function' && IDBStore.isAvailable()); } catch (e) { return false; }
  }

  async function _idbLoad(){
    if (!_idbAvailable()) return null;
    try {
      const rows = await IDBStore.kvGet(LS_ROWS_KEY);
      const meta = await IDBStore.kvGet(LS_META_KEY);
      return {
        rows: Array.isArray(rows) ? rows : [],
        meta: (meta && typeof meta === 'object') ? meta : {},
      };
    } catch (e) {
      return null;
    }
  }

  function _promoteIdbAsPrimary(){
    try {
      localStorage.setItem(LS_BACKEND_KEY, 'idb');
      localStorage.removeItem(LS_ROWS_KEY);
      localStorage.removeItem(LS_META_KEY);
    } catch (e) { /* ignore */ }
  }

  async function _idbSave(rows, meta, opts){
    if (!_idbAvailable()) return false;
    try {
      await IDBStore.kvSet(LS_ROWS_KEY, rows || []);
      await IDBStore.kvSet(LS_META_KEY, meta || {});
      // LS sığdıysa onu silme — ilk açılışta liste boş kalmasın.
      // Kota dolunca IDB asıl depo olur.
      if (opts && opts.promoteToPrimary) _promoteIdbAsPrimary();
      return true;
    } catch (e) {
      return false;
    }
  }

  function _notifyHydrated(){
    try { window.refreshHeaderExcelInfo && window.refreshHeaderExcelInfo(); } catch (_) {}
    try { window.refreshAppPartial && window.refreshAppPartial(); } catch (_) {}
    try { window.dispatchEvent(new CustomEvent('daily-store-ready')); } catch (_) {}
  }

  async function _idbClear(){
    if (!_idbAvailable()) return false;
    try {
      await IDBStore.kvDel(LS_ROWS_KEY);
      await IDBStore.kvDel(LS_META_KEY);
      return true;
    } catch (e) {
      return false;
    }
  }

  function _pruneLocalStorageForDailySave(){
    try {
      const trimJsonArray = (key, max) => {
        try {
          const arr = JSON.parse(localStorage.getItem(key) || '[]');
          if (!Array.isArray(arr) || arr.length <= max) return;
          localStorage.setItem(key, JSON.stringify(arr.slice(0, max)));
        } catch (e) { /* ignore */ }
      };
      trimJsonArray('client_error_log', 30);
      trimJsonArray('report_events_v1', 200);

      const today = new Date();
      const y = today.getFullYear();
      const m = String(today.getMonth() + 1).padStart(2, '0');
      const d = String(today.getDate()).padStart(2, '0');
      const keepBackup = `auto_backup_${y}-${m}-${d}`;
      const dropKeys = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k) continue;
        if (k.startsWith('auto_backup_') && k !== keepBackup) dropKeys.push(k);
      }
      dropKeys.forEach((k) => { try { localStorage.removeItem(k); } catch (e) {} });

      ['printBgDataUrl', 'printBgDataUrl_v3', 'print_bg_data_url'].forEach((k) => {
        try { localStorage.removeItem(k); } catch (e) {}
      });
    } catch (e) { /* ignore */ }
  }

  function _lsLoad(){
    try{
      const rows = _safeJsonParse(localStorage.getItem(LS_ROWS_KEY) || '[]', []);
      const meta = _safeJsonParse(localStorage.getItem(LS_META_KEY) || '{}', {});
      return { rows: Array.isArray(rows) ? rows : [], meta: (meta && typeof meta === 'object') ? meta : {} };
    }catch(e){ return { rows: [], meta: {} }; }
  }

  function _lsSave(rows, meta){
    try{
      _pruneLocalStorageForDailySave();
      localStorage.setItem(LS_ROWS_KEY, JSON.stringify(rows || []));
      localStorage.setItem(LS_META_KEY, JSON.stringify(meta || {}));
      localStorage.setItem(LS_BACKEND_KEY, 'ls');
      return true;
    }catch(e){ return false; }
  }

  function _applyLocal(fromLs){
    cache.rows = fromLs.rows;
    cache.meta = fromLs.meta;
    cache.loaded = true;
    cache.indexByPlate = null;
  }

  function _rowFingerprint(r) {
    if (!r) return '';
    return [
      String(r.fileName || '').trim(),
      String(r.blockKey || ''),
      r.blockHeaderRow != null ? String(r.blockHeaderRow) : '',
      String(r.plaka || '').replace(/\s+/g, '').toUpperCase(),
      String(r.id || ''),
      String(r.sira || ''),
      r._ihracatEmptyBlock ? 'E' : 'P',
      String(r.headerText || '').slice(0, 80),
    ].join('\0');
  }

  function _mergeMeta(a, b) {
    const out = Object.assign({}, a || {}, b || {});
    const files = [];
    const seen = new Set();
    const add = (raw) => {
      String(raw || '')
        .split(/\s*\+\s*/)
        .map((s) => s.trim())
        .filter(Boolean)
        .forEach((n) => {
          if (seen.has(n)) return;
          seen.add(n);
          files.push(n);
        });
    };
    [a, b].forEach((m) => {
      if (!m) return;
      if (Array.isArray(m.files)) m.files.forEach(add);
      add(m.fileName);
    });
    if (files.length) {
      out.files = files;
      out.fileName = files.join(' + ');
    }
    return out;
  }

  function _mergeStores(a, b) {
    const map = new Map();
    const addRows = (rows) => {
      (Array.isArray(rows) ? rows : []).forEach((r) => {
        const k = _rowFingerprint(r);
        if (!k || map.has(k)) return;
        map.set(k, r);
      });
    };
    addRows(a && a.rows);
    addRows(b && b.rows);
    return {
      rows: Array.from(map.values()),
      meta: _mergeMeta(a && a.meta, b && b.meta),
    };
  }

  async function _hydrateFromIdbIfNeeded(seq){
    const ls = _lsLoad();
    const idb = await _idbLoad();
    if (seq != null && seq !== _hydrateSeq) return cache;
    let backend = '';
    try { backend = String(localStorage.getItem(LS_BACKEND_KEY) || '').trim(); } catch (e) {}
    // Son yazılan depo tam anlık görüntü — eski IDB/LS satırlarını birleştirme
    // (silinen plaka merge ile geri gelmesin).
    if (backend === 'ls' && ls.rows.length) {
      _applyLocal(ls);
      return cache;
    }
    if (backend === 'idb' && idb && idb.rows.length) {
      _applyLocal(idb);
      return cache;
    }
    const merged = _mergeStores(ls, idb);
    if (merged.rows.length) {
      _applyLocal(merged);
      return cache;
    }
    _applyLocal(ls);
    return cache;
  }

  function _buildIndex(rows){
    const map = new Map();
    for (const r of (Array.isArray(rows) ? rows : [])){
      const p = String(r?.plaka || '').trim();
      if (!p) continue;
      if (!map.has(p)) map.set(p, []);
      map.get(p).push(r);
    }
    cache.indexByPlate = map;
    cache.lastIndexedAt = Date.now();
  }

  function ensureIndex(){ if (!cache.indexByPlate) _buildIndex(cache.rows); return cache.indexByPlate; }
  function getRows(){ return cache.rows; }
  function getMeta(){ return cache.meta; }
  function findByPlate(plate){ const p = String(plate || '').trim(); if (!p) return []; const idx = ensureIndex(); return idx.get(p) || []; }
  function estimateSheetRowCount(ws){
    try{ const ref = ws && ws['!ref']; if (!ref || !window.XLSX || !XLSX.utils || !XLSX.utils.decode_range) return 0; const range = XLSX.utils.decode_range(ref); return (range.e.r - range.s.r + 1) || 0; }catch(e){ return 0; }
  }

  async function ensureReady(){
    if (cache.loaded) return cache;
    if (_hydratePromise) {
      try { await _hydratePromise; } catch (e) { /* ignore */ }
      return cache;
    }
    const seq = _hydrateSeq;
    _hydratePromise = _hydrateFromIdbIfNeeded(seq)
      .then((c) => {
        if (seq === _hydrateSeq) {
          cache.loaded = true;
          _notifyHydrated();
        }
        return c;
      })
      .catch((err) => {
        if (seq === _hydrateSeq) _hydratePromise = null;
        throw err;
      });
    try { await _hydratePromise; } catch (e) { /* ignore */ }
    return cache;
  }

  async function init(){
    return ensureReady().then(() => true);
  }

  function set(rows, meta){
    cache.rows = Array.isArray(rows) ? rows : [];
    cache.meta = (meta && typeof meta === 'object') ? meta : {};
    cache.loaded = true;
    cache.indexByPlate = null;
    _pruneLocalStorageForDailySave();
    if (_lsSave(cache.rows, cache.meta)) return true;
    return false;
  }

  async function reload() {
    _hydrateSeq += 1;
    cache.rows = [];
    cache.meta = {};
    cache.loaded = false;
    cache.indexByPlate = null;
    _hydratePromise = null;
    return ensureReady();
  }

  async function setAsync(rows, meta){
    cache.rows = Array.isArray(rows) ? rows : [];
    cache.meta = (meta && typeof meta === 'object') ? meta : {};
    cache.loaded = true;
    cache.indexByPlate = null;
    _pruneLocalStorageForDailySave();
    const lsOk = _lsSave(cache.rows, cache.meta);
    const idbOk = await _idbSave(cache.rows, cache.meta, { promoteToPrimary: !lsOk });
    return !!(lsOk || idbOk);
  }

  async function clear(){
    cache.rows = [];
    cache.meta = {};
    cache.loaded = true;
    cache.indexByPlate = null;
    try { _lsSave([], {}); } catch (e) {}
    try { await _idbClear(); } catch (e) {}
    try { localStorage.removeItem(LS_BACKEND_KEY); } catch (e) {}
    return true;
  }

  async function syncFromServer() {
    _hydrateSeq += 1;
    cache.loaded = false;
    _hydratePromise = null;
    return init();
  }

  (function boot(){
    try{
      const ls = _lsLoad();
      if (ls.rows.length) _applyLocal(ls);
      else {
        cache.rows = [];
        cache.meta = {};
        cache.loaded = false;
      }
      setTimeout(() => { ensureReady().catch(()=>{}); }, 0);
    }catch(e){}
  })();

  window.addEventListener('storage', (e) => {
    if (e.key !== LS_ROWS_KEY && e.key !== LS_META_KEY) return;
    try{
      _applyLocal(_lsLoad());
      try { window.refreshHeaderExcelInfo && window.refreshHeaderExcelInfo(); } catch (_) {}
      try {
        if (typeof loadDailyShipments === 'function' && typeof rebuildListsFromExcelRows === 'function') {
          rebuildListsFromExcelRows(loadDailyShipments() || []);
        }
      } catch (_) {}
    }catch(_){}
  });

  window.DailyStore = {
    init,
    ensureReady,
    reload,
    syncFromServer,
    set,
    setAsync,
    clear,
    getRows,
    getMeta,
    findByPlate,
    ensureIndex,
    estimateSheetRowCount,
    LS_ROWS_KEY,
    LS_META_KEY,
    LS_BACKEND_KEY,
  };
})();
