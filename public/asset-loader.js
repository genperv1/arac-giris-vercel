(function () {
  'use strict';

  var VER =
    typeof window !== 'undefined' && window.__ASSET_VER != null && String(window.__ASSET_VER).trim() !== ''
      ? String(window.__ASSET_VER).trim()
      : '20260520-aracbos3';

  function qs() {
    return 'v=' + encodeURIComponent(VER);
  }

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src + (src.indexOf('?') >= 0 ? '&' : '?') + qs();
      s.async = true;
      s.onload = function () {
        resolve();
      };
      s.onerror = function () {
        reject(new Error('Script load failed: ' + src));
      };
      document.head.appendChild(s);
    });
  }

  window.__ASSET_VER = VER;

  var xlsxPromise = null;
  window.ensureXlsxLoaded = function () {
    if (typeof window.XLSX !== 'undefined' && window.XLSX.read) return Promise.resolve();
    if (xlsxPromise) return xlsxPromise;
    xlsxPromise = loadScript('https://cdn.jsdelivr.net/npm/xlsx/dist/xlsx.full.min.js').catch(function (e) {
      xlsxPromise = null;
      throw e;
    });
    return xlsxPromise;
  };

  var printPromise = null;
  window.ensurePrintLoaded = function () {
    var needPrint = !window.Print || typeof window.Print.yazdirForm !== 'function';
    var stalePrint = window.Print && window.Print.__aracBosRev !== '20260520-aracbos3';
    if (!needPrint && !stalePrint) return Promise.resolve();
    if (stalePrint) {
      try {
        document.querySelectorAll('script[src*="print.js"]').forEach(function (n) { n.remove(); });
      } catch (e) {}
      window.Print = null;
      printPromise = null;
    }
    if (printPromise) return printPromise;
    printPromise = loadScript('/signatures-registry.js')
      .then(function () { return loadScript('/print.js'); })
      .then(function () {
        if (window.Print) window.Print.__aracBosRev = '20260520-aracbos3';
      })
      .catch(function (e) {
      printPromise = null;
      throw e;
    });
    return printPromise;
  };

  try {
    document.documentElement.classList.remove('allow-ui-motion');
    if (typeof localStorage !== 'undefined') localStorage.setItem('uiMotion', '0');
  } catch (e) {}
  try {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      document.documentElement.classList.add('reduce-motion-os');
    }
  } catch (e) {}

  try {
    if ('serviceWorker' in navigator && (location.protocol === 'http:' || location.protocol === 'https:')) {
      window.addEventListener('load', function () {
        navigator.serviceWorker.register('/sw.js').catch(function () {});
      });
    }
  } catch (e) {}
})();
