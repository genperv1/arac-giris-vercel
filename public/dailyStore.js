// dailyStore.js
// Günlük Excel sevkiyat verisini (rows + meta) memory-cache + server API ile yönetir.

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

  async function _serverLoad(){
    try{ const resp = await fetch('/api/daily_rows'); if (resp.ok){ const rows = await resp.json(); return { rows: Array.isArray(rows) ? rows : [], meta: { loaded_from: 'server', ts: Date.now() } }; } }catch(e){}
    return null;
  }

  async function _serverSave(rows, meta){
    try{ for (const r of (rows || [])) { await fetch('/api/daily_rows', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.assign({}, r, { created_at: r.created_at || Date.now() })) }); } return true; }catch(e){ return false; }
  }

  async function init(){
    if (cache.loaded) return true;
    const fromServer = await _serverLoad();
    if (fromServer){ cache.rows = fromServer.rows; cache.meta = fromServer.meta; cache.loaded = true; cache.indexByPlate = null; return true; }
    const fromLs = _lsLoad();
    cache.rows = fromLs.rows;
    cache.meta = fromLs.meta;
    cache.loaded = true;
    cache.indexByPlate = null;
    if (cache.rows.length || Object.keys(cache.meta || {}).length){ _serverSave(cache.rows, cache.meta).catch(()=>{}); }
    return true;
  }

  function set(rows, meta){
    cache.rows = Array.isArray(rows) ? rows : [];
    cache.meta = (meta && typeof meta === 'object') ? meta : {};
    cache.loaded = true;
    cache.indexByPlate = null;
    _lsSave(cache.rows, cache.meta);
    _serverSave(cache.rows, cache.meta).catch(()=>{});
    return true;
  }

  function clear(){ cache.rows = []; cache.meta = {}; cache.loaded = true; cache.indexByPlate = null; return true; }
  function clear(){
    cache.rows = [];
    cache.meta = {};
    cache.loaded = true;
    cache.indexByPlate = null;
    try{ _lsSave([], {}); _serverSave([], {}).catch(()=>{}); }catch(e){}
    return true;
  }

  (function boot(){
    try{
      const fromLs = _lsLoad();
      cache.rows = fromLs.rows;
      cache.meta = fromLs.meta;
      cache.loaded = true;
      cache.indexByPlate = null;
      setTimeout(() => { init().catch(()=>{}); }, 0);
    }catch(e){}
  })();

  window.DailyStore = { init, set, clear, getRows, getMeta, findByPlate, ensureIndex, estimateSheetRowCount, LS_ROWS_KEY, LS_META_KEY };
})();
