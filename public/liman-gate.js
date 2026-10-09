// liman-gate.js — /liman giriş kapısı. Şifre sunucuda, dört gözetmen için ayrıdır.
(function (root) {
  'use strict';

  var STORAGE_KEY = 'liman_gate_v2';

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
    markUnlocked();
    return 'ok';
  }

  var api = {
    STORAGE_KEY: STORAGE_KEY,
    isUnlocked: isUnlocked,
    markUnlocked: markUnlocked,
    clearUnlock: clearUnlock,
    hasAppSession: hasAppSession,
    login: login
  };

  if (typeof root !== 'undefined') root.LimanGate = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : typeof global !== 'undefined' ? global : this);
