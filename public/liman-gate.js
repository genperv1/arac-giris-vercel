// liman-gate.js — /liman giriş kapısı (kullanıcı adı + şifre)
(function (root) {
  'use strict';

  var USERNAME = 'gnp';
  var PASSWORD = 'gp1451';
  var STORAGE_KEY = 'liman_gate_v1';

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
    } catch (e) { /* ignore */ }
  }

  function checkLogin(username, password) {
    var user = String(username == null ? '' : username).trim().toLowerCase();
    var pass = String(password == null ? '' : password).trim();
    return user === USERNAME && pass === PASSWORD;
  }

  var api = {
    STORAGE_KEY: STORAGE_KEY,
    isUnlocked: isUnlocked,
    markUnlocked: markUnlocked,
    clearUnlock: clearUnlock,
    checkLogin: checkLogin
  };

  if (typeof root !== 'undefined') root.LimanGate = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : typeof global !== 'undefined' ? global : this);
