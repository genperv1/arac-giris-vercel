(function () {
  'use strict';

  var VER =
    typeof window !== 'undefined' && window.__ASSET_VER != null && String(window.__ASSET_VER).trim() !== ''
      ? String(window.__ASSET_VER).trim()
      : '20260603-ihracat-not-3line-v2';

  function qs() {
    return 'v=' + encodeURIComponent(VER);
  }

  function loadScript(src, timeoutMs) {
    timeoutMs = timeoutMs || 20000;
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      var done = false;
      var timer = setTimeout(function () {
        if (done) return;
        done = true;
        s.onload = s.onerror = null;
        try {
          s.remove();
        } catch (e) {}
        reject(new Error('Script load timeout: ' + src));
      }, timeoutMs);
      s.src = src + (src.indexOf('?') >= 0 ? '&' : '?') + qs();
      s.async = true;
      s.onload = function () {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve();
      };
      s.onerror = function () {
        if (done) return;
        done = true;
        clearTimeout(timer);
        try {
          s.remove();
        } catch (e) {}
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
    xlsxPromise = loadScript('/vendor/xlsx.full.min.js', 15000)
      .catch(function () {
        return loadScript('https://cdn.jsdelivr.net/npm/xlsx/dist/xlsx.full.min.js', 15000);
      })
      .catch(function () {
        return loadScript('https://unpkg.com/xlsx/dist/xlsx.full.min.js', 15000);
      })
      .catch(function (e) {
        xlsxPromise = null;
        throw e;
      });
    return xlsxPromise;
  };

  try {
    if (document.documentElement.classList.contains('logged-in')) {
      window.ensureXlsxLoaded().catch(function () {});
    }
  } catch (e) {}

  var printPromise = null;
  window.ensurePrintLoaded = function () {
    var needPrint = !window.Print || typeof window.Print.yazdirForm !== 'function';
    var stalePrint = window.Print && window.Print.__aracBosRev !== '20260603-ihracat-not-3line-v2';
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
      .then(function () { return loadScript('/print.js?rev=20260603-ihracat-not-3line-v2'); })
      .then(function () {
        if (window.Print) window.Print.__aracBosRev = '20260603-ihracat-not-3line-v2';
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
