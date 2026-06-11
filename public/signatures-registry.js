// signatures-registry.js — Kantar / Sevkiyat saha imza eşleştirme (API)
(function (global) {
  'use strict';

  const LEGACY_KANTAR = {
    'BURAK KARATAŞ': 'signatures/burak_karatas.png',
    'BEKİR DOĞRU': 'signatures/bekir_dogru.png',
    'BATUHAN KOCABAY': 'signatures/batuhan_kocabay.png',
    'BATUHAN CINAR': 'signatures/batuhan_cinar.png',
    'BURAK TALAY': 'signatures/burak_talay.png'
  };

  let cache = { kantar: {}, saha: {}, loadedAt: 0 };
  const TTL_MS = 5 * 60 * 1000;

  function authHeaders() {
    const token = (function () {
      try { return localStorage.getItem('authToken') || ''; } catch (e) { return ''; }
    })();
    const h = { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' };
    if (token) h.Authorization = 'Bearer ' + token;
    return h;
  }

  function normName(name) {
    return String(name || '').trim().toUpperCase();
  }

  function mergeLegacy(role, map) {
    const out = Object.assign({}, map || {});
    if (role === 'kantar') {
      Object.keys(LEGACY_KANTAR).forEach((k) => {
        if (!out[k]) out[k] = LEGACY_KANTAR[k];
      });
    }
    return out;
  }

  async function loadSignatures(force) {
    const now = Date.now();
    if (!force && cache.loadedAt && now - cache.loadedAt < TTL_MS) return cache;
    try {
      const res = await fetch('/api/signatures/map', {
        method: 'GET',
        headers: authHeaders(),
        credentials: 'include',
        cache: 'no-store'
      });
      if (res.ok) {
        const data = await res.json();
        cache = {
          kantar: mergeLegacy('kantar', data.kantar || {}),
          saha: mergeLegacy('saha', data.saha || {}),
          loadedAt: now
        };
        return cache;
      }
    } catch (e) {
      console.warn('SignatureRegistry load failed:', e);
    }
    cache = {
      kantar: mergeLegacy('kantar', {}),
      saha: mergeLegacy('saha', {}),
      loadedAt: now
    };
    return cache;
  }

  function resolveSignatureSrc(role, name) {
    const key = normName(name);
    if (!key) return '';
    const bucket = cache[String(role || '').toLowerCase()] || {};
    return bucket[key] || '';
  }

  function getNamesForRole(role) {
    const bucket = cache[String(role || '').toLowerCase()] || {};
    return Object.keys(bucket).sort((a, b) => a.localeCompare(b, 'tr'));
  }

  function invalidate() {
    cache.loadedAt = 0;
  }

  global.SignatureRegistry = {
    loadSignatures,
    resolveSignatureSrc,
    getNamesForRole,
    invalidate,
    normName
  };
})(typeof window !== 'undefined' ? window : global);
