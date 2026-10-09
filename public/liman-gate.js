// liman-gate.js — /liman giriş kapısı. Gözetmen hesapları sunucuda.
// Selahattin hesabı (xxr) aynı kapıdan hesap ID ve şifresini tanımlar; ana oturum açılmaz.
(function (root) {
  'use strict';

  var STORAGE_KEY = 'liman_gate_v2';
  var ADMIN_KEY = 'liman_admin_v1';

  function storage() {
    try {
      return root.sessionStorage;
    } catch (e) {
      return null;
    }
  }

  function isUnlocked() {
    try {
      var store = storage();
      if (!store) return false;
      return store.getItem(STORAGE_KEY) === '1';
    } catch (e) {
      return false;
    }
  }

  function markUnlocked() {
    try {
      var store = storage();
      if (store) store.setItem(STORAGE_KEY, '1');
    } catch (e) { /* ignore */ }
  }

  function clearUnlock() {
    try {
      var store = storage();
      if (store) store.removeItem(STORAGE_KEY);
      if (root.sessionStorage) root.sessionStorage.removeItem('liman_gate_v1');
    } catch (e) { /* ignore */ }
  }

  function adminToken() {
    try {
      var store = storage();
      return store ? (store.getItem(ADMIN_KEY) || '') : '';
    } catch (e) {
      return '';
    }
  }

  function setAdminToken(token) {
    try {
      var store = storage();
      if (store && token) store.setItem(ADMIN_KEY, String(token));
    } catch (e) { /* ignore */ }
  }

  function clearAdminToken() {
    try {
      var store = storage();
      if (store) store.removeItem(ADMIN_KEY);
    } catch (e) { /* ignore */ }
  }

  async function authFetch(url, options) {
    var token = adminToken();
    var headers = { 'Content-Type': 'application/json' };
    if (options && options.headers) {
      Object.keys(options.headers).forEach(function (key) { headers[key] = options.headers[key]; });
    }
    if (token) headers.Authorization = 'Bearer ' + token;
    var init = {
      method: (options && options.method) || 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: headers,
    };
    if (options && options.body) init.body = options.body;
    return fetch(url, init);
  }

  async function hasAppSession() {
    var res;
    try {
      res = await fetch('/api/me', {
        method: 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
      });
    } catch (e) {
      return false;
    }
    if (!res.ok) return false;
    var data = {};
    try { data = await res.json(); } catch (e) { return false; }
    return !!(data && data.ok && data.user);
  }

  async function login(username, password) {
    var res;
    try {
      res = await fetch('/api/liman/gate', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username, password: password }),
      });
    } catch (e) {
      return 'down';
    }
    if (res.status === 401 || res.status === 400) return 'bad';
    if (res.status === 429) return 'locked';
    if (!res.ok) return 'down';
    var data = {};
    try { data = await res.json(); } catch (e) { return 'down'; }
    if (!data || !data.ok) return 'bad';
    if (data.manage && data.token) {
      setAdminToken(data.token);
      return 'manage';
    }
    clearAdminToken();
    markUnlocked();
    return 'ok';
  }

  async function logout() {
    clearUnlock();
    clearAdminToken();
    try {
      await fetch('/api/liman/gate/logout', { method: 'POST', credentials: 'same-origin', cache: 'no-store' });
    } catch (e) { /* çerez sunucuda da silinsin */ }
  }

  async function loadAccounts() {
    var res;
    try {
      res = await authFetch('/api/liman/gozetmen/tanim');
    } catch (e) {
      return { ok: false, error: 'down' };
    }
    if (res.status === 401) return { ok: false, error: 'auth' };
    if (!res.ok) return { ok: false, error: 'down' };
    var data = {};
    try { data = await res.json(); } catch (e) { return { ok: false, error: 'down' }; }
    return data && data.ok ? data : { ok: false, error: 'down' };
  }

  async function saveAccounts(slots) {
    var res;
    try {
      res = await authFetch('/api/liman/gozetmen/tanim', {
        method: 'PUT',
        body: JSON.stringify({ slots: slots }),
      });
    } catch (e) {
      return { ok: false, error: 'Kayıt şu an yapılamadı.' };
    }
    var data = {};
    try { data = await res.json(); } catch (e) { data = {}; }
    if (res.status === 401) return { ok: false, error: 'auth' };
    if (!res.ok || !data.ok) return { ok: false, error: (data && data.error) || 'Kaydedilemedi.' };
    return data;
  }

  var api = {
    STORAGE_KEY: STORAGE_KEY,
    isUnlocked: isUnlocked,
    markUnlocked: markUnlocked,
    clearUnlock: clearUnlock,
    logout: logout,
    adminToken: adminToken,
    clearAdminToken: clearAdminToken,
    hasAppSession: hasAppSession,
    login: login,
    loadAccounts: loadAccounts,
    saveAccounts: saveAccounts
  };

  if (typeof root !== 'undefined') root.LimanGate = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : typeof global !== 'undefined' ? global : this);
