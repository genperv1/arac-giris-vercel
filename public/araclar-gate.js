// araclar-gate.js — İş Merkezi + Liste kopyala giriş şifresi (543723)
(function (root) {
  'use strict';

  var PASSWORD = '543723';
  var STORAGE_KEY = 'gpm_araclar_gate_v1';
  var TTL_MS = 30 * 60 * 1000; // aynı sekmede 30 dk

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
      var raw = store.getItem(STORAGE_KEY);
      if (!raw) return false;
      var ts = parseInt(raw, 10);
      if (!Number.isFinite(ts)) return false;
      return Date.now() - ts < TTL_MS;
    } catch (e) {
      return false;
    }
  }

  function markUnlocked() {
    try {
      var store = storage();
      if (store) store.setItem(STORAGE_KEY, String(Date.now()));
    } catch (e) { /* ignore */ }
  }

  function clearUnlock() {
    try {
      var store = storage();
      if (store) store.removeItem(STORAGE_KEY);
    } catch (e) { /* ignore */ }
  }

  function askPassword(message) {
    try {
      var doc = root.document;
      if (doc && doc.activeElement && typeof doc.activeElement.blur === 'function') {
        doc.activeElement.blur();
      }
    } catch (e) { /* ignore */ }
    var msg = message || 'İş Merkezi / Liste kopyala şifresini girin:';
    if (root.rpUi && typeof root.rpUi.password === 'function') {
      return root.rpUi.password(msg);
    }
    if (root.rpDialog && typeof root.rpDialog.password === 'function') {
      return root.rpDialog.password(msg);
    }
    if (typeof root.prompt === 'function') {
      return Promise.resolve(root.prompt(msg));
    }
    return Promise.resolve(null);
  }

  function alertBad() {
    if (root.rpUi && typeof root.rpUi.alert === 'function') {
      return root.rpUi.alert('Hatalı şifre.');
    }
    if (typeof root.alert === 'function') root.alert('Hatalı şifre.');
    return Promise.resolve();
  }

  function checkPassword(password) {
    return String(password == null ? '' : password).trim() === PASSWORD;
  }

  async function ensureAccess(opts) {
    opts = opts || {};
    if (!opts.force && isUnlocked()) return true;

    var pw = await askPassword(opts.message);
    if (pw == null || pw === '') return false;
    if (!checkPassword(pw)) {
      await alertBad();
      return false;
    }
    markUnlocked();
    return true;
  }

  var api = {
    STORAGE_KEY: STORAGE_KEY,
    TTL_MS: TTL_MS,
    isUnlocked: isUnlocked,
    markUnlocked: markUnlocked,
    clearUnlock: clearUnlock,
    checkPassword: checkPassword,
    ensureAccess: ensureAccess
  };

  if (typeof root !== 'undefined') root.AraclarGate = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : typeof global !== 'undefined' ? global : this);
