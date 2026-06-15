// dailyStore.js
// Günlük Excel sevkiyat verisini (İHRACAT) yalnızca bu bilgisayarın localStorage'ında tutar.
// Piyasa gibi sunucu/DB paylaşımı yok — her PC kendi Excel'ini yükler.

(function(){
  'use strict';

  const LS_ROWS_KEY = 'daily_shipments_current';
  const LS_META_KEY = 'daily_shipments_meta';

  const cache = {
    loaded: false,
    rows: [],
    meta: {},
    indexByPlate: null,
    lastIndexedAt: 0,
  };

  function _safeJsonParse(raw, fallback){
    try{ const v = JSON.parse(raw); return v ?? fallback; }catch(e){ return fallback; }
  }

  function _lsLoad(){
    try{
      const rows = _safeJsonParse(localStorage.getItem(LS_ROWS_KEY) || '[]', []);
      const meta = _safeJsonParse(localStorage.getItem(LS_META_KEY) || '{}', {});
      return { rows: Array.isArray(rows) ? rows : [], meta: (meta && typeof meta === 'object') ? meta : {} };
    }catch(e){ return { rows: [], meta: {} }; }
  }

  function _lsSave(rows, meta){
    try{ localStorage.setItem(LS_ROWS_KEY, JSON.stringify(rows || [])); localStorage.setItem(LS_META_KEY, JSON.stringify(meta || {})); return true; }catch(e){ return false; }
  }

  function _applyLocal(fromLs){
    cache.rows = fromLs.rows;
    cache.meta = fromLs.meta;
    cache.loaded = true;
    cache.indexByPlate = null;
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

  async function init(){
    if (cache.loaded) return true;
    _applyLocal(_lsLoad());
    return true;
  }

  function set(rows, meta){
    cache.rows = Array.isArray(rows) ? rows : [];
    cache.meta = (meta && typeof meta === 'object') ? meta : {};
    cache.loaded = true;
    cache.indexByPlate = null;
    _lsSave(cache.rows, cache.meta);
    return true;
  }

  async function clear(){
    cache.rows = [];
    cache.meta = {};
    cache.loaded = true;
    cache.indexByPlate = null;
    try{ _lsSave([], {}); }catch(e){}
    return true;
  }

  async function syncFromServer() {
    cache.loaded = false;
    return init();
  }

  (function boot(){
    try{
      _applyLocal(_lsLoad());
      setTimeout(() => { init().catch(()=>{}); }, 0);
    }catch(e){}
  })();

  // Aynı tarayıcıda başka sekme localStorage güncellerse cache'i yenile
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

  window.DailyStore = { init, syncFromServer, set, clear, getRows, getMeta, findByPlate, ensureIndex, estimateSheetRowCount, LS_ROWS_KEY, LS_META_KEY };
})();
