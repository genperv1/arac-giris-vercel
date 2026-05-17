// Ayarlar sayfası ek parola kapısı (giriş yapmış kullanıcı + ayar parolası)
(function (global) {
  'use strict';

  const STORAGE_KEY = 'ayarlar_access_v1';
  const TTL_MS = 4 * 60 * 60 * 1000;

  function authHeaders(json) {
    const token = (function () {
      try { return global.localStorage.getItem('authToken') || ''; } catch (e) { return ''; }
    })();
    const h = { 'Cache-Control': 'no-cache' };
    if (json) h['Content-Type'] = 'application/json';
    if (token) h.Authorization = 'Bearer ' + token;
    return h;
  }

  function isUnlocked() {
    try {
      const raw = global.sessionStorage.getItem(STORAGE_KEY);
      if (!raw) return false;
      const ts = parseInt(raw, 10);
      if (!Number.isFinite(ts)) return false;
      return Date.now() - ts < TTL_MS;
    } catch (e) {
      return false;
    }
  }

  function markUnlocked() {
    try {
      global.sessionStorage.setItem(STORAGE_KEY, String(Date.now()));
    } catch (e) { /* ignore */ }
  }

  function clearUnlock() {
    try {
      global.sessionStorage.removeItem(STORAGE_KEY);
    } catch (e) { /* ignore */ }
  }

  async function askPassword(message) {
    const msg = message || 'Ayarlar sayfasına girmek için parola girin.';
    if (global.rpUi && typeof global.rpUi.password === 'function') {
      return global.rpUi.password(msg);
    }
    if (global.rpDialog && typeof global.rpDialog.password === 'function') {
      return global.rpDialog.password(msg);
    }
    return global.prompt(msg);
  }

  async function verifyPassword(password) {
    const r = await fetch('/api/settings/verify-access', {
      method: 'POST',
      credentials: 'include',
      headers: authHeaders(true),
      body: JSON.stringify({ password: String(password || '') })
    });
    if (!r.ok) return false;
    try {
      const data = await r.json();
      return !!(data && data.ok);
    } catch (e) {
      return false;
    }
  }

  async function ensureAyarlarAccess(opts) {
    opts = opts || {};
    if (!opts.force && isUnlocked()) return true;

    const pw = await askPassword(opts.message);
    if (pw == null || pw === '') return false;

    const ok = await verifyPassword(pw);
    if (ok) {
      markUnlocked();
      return true;
    }

    if (global.rpUi && typeof global.rpUi.alert === 'function') {
      await global.rpUi.alert('Hatalı parola.', 'danger');
    } else {
      global.alert('Hatalı parola.');
    }
    return false;
  }

  async function openAyarlarPage() {
    const ok = await ensureAyarlarAccess();
    if (!ok) return false;
    try {
      global.open('ayarlar.html', '_blank', 'noopener,noreferrer');
    } catch (e) {
      global.location.href = 'ayarlar.html';
    }
    return true;
  }

  global.AyarlarGate = {
    isUnlocked,
    markUnlocked,
    clearUnlock,
    ensureAyarlarAccess,
    openAyarlarPage,
    verifyPassword
  };
})(typeof window !== 'undefined' ? window : global);
