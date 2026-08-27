(function () {
  'use strict';

  const API = '/api/print-form-bg';
  const HEAVY_KEYS = ['printBgDataUrl_v3', 'printBgDataUrl'];

  function dropHeavyBgCache() {
    try {
      HEAVY_KEYS.forEach(function (k) { localStorage.removeItem(k); });
    } catch (_) {}
  }

  function prefetchPrintFormBg() {
    try {
      const img = new Image();
      img.src = API;
    } catch (_) {}
  }

  async function printFormBgMeta() {
    try {
      const r = await fetch(API + '/meta', { credentials: 'include', cache: 'no-cache' });
      if (!r.ok) return null;
      return await r.json().catch(function () { return null; });
    } catch (_) {
      return null;
    }
  }

  async function printFormBgExists() {
    const meta = await printFormBgMeta();
    return !!(meta && meta.exists && meta.acceptable && !meta.needsUpload);
  }

  async function boot() {
    if (!document.documentElement.classList.contains('logged-in')) return;
    const drop = function () { dropHeavyBgCache(); };
    try {
      if (typeof requestIdleCallback === 'function') requestIdleCallback(drop, { timeout: 4000 });
      else setTimeout(drop, 1200);
    } catch (_) {
      setTimeout(drop, 1200);
    }
    prefetchPrintFormBg();
    const meta = await printFormBgMeta();
    if (meta && meta.exists && meta.needsUpload) {
      dropHeavyBgCache();
    }
    if (meta && meta.exists && meta.acceptable) return;
    if (await printFormBgExists()) {
      prefetchPrintFormBg();
      return;
    }
    if (typeof window.showToast === 'function') {
      window.showToast('Takip formu şablonu eksik — Ayarlar → Yazdırma bölümünden JPG yükleyin.');
    }
  }

  window.PrintFormBgBootstrap = {
    prefetchPrintFormBg,
    printFormBgExists,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
