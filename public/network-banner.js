(function () {
  'use strict';
  var BANNER_ID = 'offline-network-banner';

  function ensureBanner() {
    var el = document.getElementById(BANNER_ID);
    if (el) return el;
    el = document.createElement('div');
    el.id = BANNER_ID;
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    el.style.cssText = [
      'display:none',
      'position:fixed',
      'left:0',
      'right:0',
      'bottom:0',
      'z-index:2147483000',
      'padding:10px 14px',
      'text-align:center',
      'font-size:14px',
      'font-weight:600',
      'background:#b45309',
      'color:#fff',
      'box-shadow:0 -4px 12px rgba(0,0,0,.15)',
    ].join(';');
    el.textContent = 'Çevrimdışı: işlemler sunucuya gidemeyebilir. Bağlantı gelince yeniden deneyin.';
    document.body.appendChild(el);
    return el;
  }

  function sync() {
    var el = ensureBanner();
    el.style.display = navigator.onLine ? 'none' : 'block';
  }

  window.addEventListener('online', sync);
  window.addEventListener('offline', sync);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', sync);
  } else {
    sync();
  }
})();
