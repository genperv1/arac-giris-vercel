(function () {
  'use strict';

  const API = '/api/print-form-bg';
  const CACHE_KEY = 'printBgDataUrl_v3';
  const LEGACY_CACHE_KEYS = ['printBgDataUrl', 'printBgUrl'];
  const LEGACY = 'https://i.hizliresim.com/36cc3jp.jpg';

  function clearBadCache() {
    try {
      LEGACY_CACHE_KEYS.forEach(function (k) { localStorage.removeItem(k); });
      const cached = localStorage.getItem(CACHE_KEY);
      if (cached && !/^data:image\/(jpeg|jpg|png)/i.test(cached)) {
        localStorage.removeItem(CACHE_KEY);
      }
    } catch (_) {}
  }

  async function warmPrintFormBgCache() {
    try {
      clearBadCache();
      if (localStorage.getItem(CACHE_KEY)) return true;
      const metaR = await fetch(API + '/meta', { credentials: 'include', cache: 'no-cache' });
      if (metaR.ok) {
        const meta = await metaR.json().catch(function () { return {}; });
        if (meta.exists && meta.needsUpload) return false;
      }
      const r = await fetch(API, { credentials: 'same-origin', cache: 'no-cache' });
      if (!r.ok) return false;
      const ct = String(r.headers.get('content-type') || '').toLowerCase();
      if (!ct.includes('jpeg') && !ct.includes('jpg') && !ct.includes('png')) return false;
      const blob = await r.blob();
      if (!blob || blob.size < 500) return false;
      const reader = new FileReader();
      const dataUrl = await new Promise(function (resolve, reject) {
        reader.onload = function () { resolve(reader.result); };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
      if (!/^data:image\/(jpeg|jpg|png)/i.test(String(dataUrl))) return false;
      localStorage.setItem(CACHE_KEY, dataUrl);
      return true;
    } catch (_) {
      return false;
    }
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

  async function tryAutoImportLegacyPrintFormBg() {
    if (await printFormBgExists()) return false;

    return new Promise(function (resolve) {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = async function () {
        try {
          if (!img.naturalWidth || img.naturalWidth < 200) {
            resolve(false);
            return;
          }
          const canvas = document.createElement('canvas');
          canvas.width = img.naturalWidth;
          canvas.height = img.naturalHeight;
          canvas.getContext('2d').drawImage(img, 0, 0);
          const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
          const r = await fetch(API, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ imageData: dataUrl, source: 'legacy-auto' }),
          });
          if (!r.ok) {
            resolve(false);
            return;
          }
          try { localStorage.setItem(CACHE_KEY, dataUrl); } catch (_) {}
          if (typeof window.showToast === 'function') {
            window.showToast('Orijinal takip formu şablonu sunucuya kaydedildi.');
          }
          resolve(true);
        } catch (_) {
          resolve(false);
        }
      };
      img.onerror = function () { resolve(false); };
      img.src = LEGACY + '?import=' + Date.now();
    });
  }

  async function boot() {
    if (!document.documentElement.classList.contains('logged-in')) return;
    clearBadCache();
    const meta = await printFormBgMeta();
    if (meta && meta.exists && meta.needsUpload) {
      clearBadCache();
    }
    const cached = await warmPrintFormBgCache();
    if (cached) return;
    if (await printFormBgExists()) {
      await warmPrintFormBgCache();
      return;
    }
    const imported = await tryAutoImportLegacyPrintFormBg();
    if (imported) return;
    if (typeof window.showToast === 'function') {
      window.showToast('Takip formu şablonu eksik — Ayarlar → Yazdırma bölümünden JPG yükleyin.');
    }
  }

  window.PrintFormBgBootstrap = {
    warmPrintFormBgCache,
    tryAutoImportLegacyPrintFormBg,
    printFormBgExists,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
