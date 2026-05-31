// Ayarlar sayfası ek parola kapısı (giriş yapmış kullanıcı + ayar parolası)
// Parola yalnızca ayarlar sekmesinde sorulur; kilitleme sekme bazlıdır (yeni sekme = tekrar parola).
(function (global) {
  'use strict';

  const STORAGE_KEY = 'ayarlar_access_v1';
  const TOKEN_KEY = 'ayarlar_settings_token_v1';
  const TTL_MS = 30 * 60 * 1000; // aynı sekmede en fazla 30 dk

  function authHeaders(json) {
    const token = (function () {
      try { return global.localStorage.getItem('authToken') || ''; } catch (e) { return ''; }
    })();
    const h = { 'Cache-Control': 'no-cache' };
    if (json) h['Content-Type'] = 'application/json';
    if (token) h.Authorization = 'Bearer ' + token;
    return h;
  }

  function storage() {
    try {
      return global.sessionStorage;
    } catch (e) {
      return null;
    }
  }

  function clearLegacyUnlock() {
    try {
      global.localStorage.removeItem(STORAGE_KEY);
    } catch (e) { /* ignore */ }
  }

  function isUnlocked() {
    try {
      const store = storage();
      if (!store) return false;
      const raw = store.getItem(STORAGE_KEY);
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
      const store = storage();
      if (store) store.setItem(STORAGE_KEY, String(Date.now()));
    } catch (e) { /* ignore */ }
  }

  function clearUnlock() {
    try {
      const store = storage();
      if (store) store.removeItem(STORAGE_KEY);
      if (store) store.removeItem(TOKEN_KEY);
    } catch (e) { /* ignore */ }
    clearLegacyUnlock();
  }

  function getSettingsToken() {
    try {
      const store = storage();
      return store ? (store.getItem(TOKEN_KEY) || '') : '';
    } catch (e) {
      return '';
    }
  }

  function setSettingsToken(token) {
    try {
      const store = storage();
      if (store && token) store.setItem(TOKEN_KEY, String(token));
    } catch (e) { /* ignore */ }
  }

  async function askPassword(message) {
    try {
      const doc = global.document;
      if (doc) {
        const active = doc.activeElement;
        if (active && active !== doc.body && typeof active.blur === 'function') active.blur();
        ['searchInput', 'plakaSearch'].forEach((id) => {
          const el = doc.getElementById(id);
          if (el && typeof el.blur === 'function') el.blur();
        });
      }
    } catch (e) { /* ignore */ }
    const msg = message || 'Ayarlar sayfasına girmek için parola girin.';
    if (global.rpUi && typeof global.rpUi.password === 'function') {
      return global.rpUi.password(msg);
    }
    if (global.rpDialog && typeof global.rpDialog.password === 'function') {
      return global.rpDialog.password(msg);
    }
    return null;
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
      if (data && data.ok && data.settingsToken) {
        return { token: data.settingsToken };
      }
      return !!(data && data.ok);
    } catch (e) {
      return false;
    }
  }

  async function ensureAyarlarAccess(opts) {
    opts = opts || {};
    if (!opts.force && isUnlocked() && getSettingsToken()) return true;

    const pw = await askPassword(opts.message);
    if (pw == null || pw === '') return false;

    const ok = await verifyPassword(pw);
    if (ok && ok.token) {
      markUnlocked();
      setSettingsToken(ok.token);
      return true;
    }
    if (ok === true) {
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

  /** Ana sayfadan: doğrudan aç; parola ayarlar sekmesinde sorulur. */
  async function openAyarlarPage() {
    try {
      global.open('ayarlar.html', '_blank', 'noopener,noreferrer');
    } catch (e) {
      global.location.href = 'ayarlar.html';
    }
    return true;
  }

  clearLegacyUnlock();

  global.AyarlarGate = {
    isUnlocked,
    markUnlocked,
    clearUnlock,
    getSettingsToken,
    setSettingsToken,
    ensureAyarlarAccess,
    openAyarlarPage,
    verifyPassword
  };
})(typeof window !== 'undefined' ? window : global);
