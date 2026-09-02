(function () {
  'use strict';

  var VER =
    typeof window !== 'undefined' && window.__ASSET_VER != null && String(window.__ASSET_VER).trim() !== ''
      ? String(window.__ASSET_VER).trim()
      : '1.0.2-20260827-printfast';

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
      schedulePrintWarmup();
    }
  } catch (e) {}

  var printPromise = null;
  var PRINT_REV = 'print-v15-frameprint';
  var printWarmPromise = null;

  function prefetchPrintAssets() {
    try {
      var origin = window.location.origin || '';
      var bg = new Image();
      bg.src = origin + '/api/print-form-bg';
    } catch (e) {}
    try {
      if (window.PrintFormBg && typeof window.PrintFormBg.prefetchPrintBgImage === 'function') {
        window.PrintFormBg.prefetchPrintBgImage();
      }
    } catch (e) {}
    try {
      if (!window.SignatureRegistry) return;
      ['kantar', 'saha'].forEach(function (role) {
        var names = window.SignatureRegistry.getNamesForRole(role) || [];
        names.forEach(function (name) {
          var src = window.SignatureRegistry.resolveSignatureSrc(role, name);
          if (!src) return;
          var abs = window.SignatureRegistry.toAbsoluteSignatureSrc
            ? window.SignatureRegistry.toAbsoluteSignatureSrc(src)
            : src;
          var img = new Image();
          img.src = abs;
        });
      });
    } catch (e) {}
  }

  function loadScriptIfMissing(test, src) {
    if (test()) return Promise.resolve();
    return loadScript(src);
  }

  window.ensurePrintLoaded = function () {
    var needPrint = !window.Print || typeof window.Print.yazdirForm !== 'function';
    var stalePrint = window.Print && window.Print.__aracBosRev !== PRINT_REV;
    if (!needPrint && !stalePrint) return Promise.resolve();
    if (stalePrint) {
      try {
        document.querySelectorAll('script[src*="print.js"],script[src*="print-main.js"]').forEach(function (n) { n.remove(); });
      } catch (e) {}
      window.Print = null;
      printPromise = null;
    }
    if (printPromise) return printPromise;
    printPromise = loadScriptIfMissing(function () { return !!window.SignatureRegistry; }, '/signatures-registry.js')
      .then(function () { return loadScriptIfMissing(function () { return !!window.PrintFormBgUpload; }, '/print-form-bg-upload.js'); })
      .then(function () { return loadScriptIfMissing(function () { return !!window.PrintLayoutSettings; }, '/print-layout-settings.js?rev=' + encodeURIComponent(PRINT_REV)); })
      .then(function () {
        if (window.PrintLayoutSettings && typeof window.PrintLayoutSettings.ensureSyncedOnce === 'function') {
          return window.PrintLayoutSettings.ensureSyncedOnce().catch(function () {});
        }
      })
      .then(function () { return loadScript('/modules/print-main.js?rev=' + encodeURIComponent(PRINT_REV)); })
      .then(function () { return loadScriptIfMissing(function () { return !!window.__printUxFitLoaded; }, '/modules/print-ux-fit.js'); })
      .then(function () {
        if (window.Print) window.Print.__aracBosRev = PRINT_REV;
      })
      .then(function () {
        prefetchPrintAssets();
      })
      .catch(function (e) {
      printPromise = null;
      throw e;
    });
    return printPromise;
  };

  window.warmupPrintPipeline = function () {
    if (printWarmPromise) return printWarmPromise;
    printWarmPromise = Promise.resolve()
      .then(function () {
        if (window.SignatureRegistry && typeof window.SignatureRegistry.loadSignatures === 'function') {
          return window.SignatureRegistry.loadSignatures().catch(function () {});
        }
      })
      .then(function () { return window.ensurePrintLoaded(); })
      .then(function () { prefetchPrintAssets(); })
      .catch(function () {
        printWarmPromise = null;
      });
    return printWarmPromise;
  };

  function schedulePrintWarmup() {
    var run = function () {
      try { window.warmupPrintPipeline(); } catch (e) {}
    };
    try {
      if (typeof requestIdleCallback === 'function') {
        requestIdleCallback(run, { timeout: 1600 });
      } else {
        setTimeout(run, 250);
      }
    } catch (e) {
      setTimeout(run, 250);
    }
  }
  window.schedulePrintWarmup = schedulePrintWarmup;

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
