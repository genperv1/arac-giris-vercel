(function () {
  'use strict';

  const ASSET = '/assets/takip-form-bg.jpg';
  const HEAVY_KEYS = ['printBgDataUrl_v3', 'printBgDataUrl'];

  function dropHeavyBgCache() {
    try {
      HEAVY_KEYS.forEach(function (k) { localStorage.removeItem(k); });
    } catch (_) {}
  }

  function prefetchPrintFormBg() {
    try {
      const img = new Image();
      img.src = ASSET;
    } catch (_) {}
  }

  async function printFormBgExists() {
    return new Promise(function (resolve) {
      const img = new Image();
      img.onload = function () { resolve(img.naturalWidth >= 200); };
      img.onerror = function () { resolve(false); };
      img.src = ASSET;
    });
  }

  async function boot() {
    if (!document.documentElement.classList.contains('logged-in')) return;
    dropHeavyBgCache();
    prefetchPrintFormBg();
    if (await printFormBgExists()) return;
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
