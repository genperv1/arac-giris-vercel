// Sekmeler arası sorun/red senkronu (sorunlar.html ↔ ana sayfa)
(function (global) {
  'use strict';

  const CHANNEL = 'arac-giris-issues-sync-v1';
  const LS_KEY = 'arac_giris_issues_sync_ping';

  let bc = null;
  try {
    bc = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(CHANNEL) : null;
  } catch (e) {
    bc = null;
  }

  function notify(payload) {
    const msg = Object.assign({ ts: Date.now() }, payload || {});
    try {
      if (bc) bc.postMessage(msg);
    } catch (e) { /* ignore */ }
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(msg));
    } catch (e) { /* ignore */ }
  }

  function onNotify(handler) {
    if (typeof handler !== 'function') return;
    if (bc) {
      bc.onmessage = function (ev) {
        try {
          if (ev && ev.data) handler(ev.data);
        } catch (e) { /* ignore */ }
      };
    }
    window.addEventListener('storage', function (ev) {
      if (ev && ev.key === LS_KEY && ev.newValue) {
        try {
          handler(JSON.parse(ev.newValue));
        } catch (e) { /* ignore */ }
      }
    });
  }

  global.IssuesSyncBus = { notify, onNotify, LS_KEY };
})(typeof window !== 'undefined' ? window : global);
