// Raporlama / olay akışı — app.js'ten ayrıldı (LocalStorage + /api/reports)
(function () {
  'use strict';

  const KEY = 'report_events_v1';
  const MAX = 2000;
  let _cache = [];

  function _readLocal() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return [];
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : [];
    } catch (e) {
      return [];
    }
  }

  function _writeLocal(arr) {
    try {
      localStorage.setItem(KEY, JSON.stringify(Array.isArray(arr) ? arr : []));
      return true;
    } catch (e) {
      return false;
    }
  }

  function refreshReportCache() {
    try {
      fetch('/api/reports?limit=200&_cb=' + Date.now(), {
        method: 'GET',
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate',
          Pragma: 'no-cache',
        },
        credentials: 'include',
      })
        .then((r) => (r.ok ? r.json() : Promise.resolve([])))
        .then((remote) => {
          if (!Array.isArray(remote)) return;
          const map = {};
          const merged = [];
          (remote || []).forEach((it) => {
            if (it && it.id) {
              map[it.id] = it;
              merged.push(it);
            }
          });
          (_cache || []).forEach((it) => {
            if (it && it.id && !map[it.id]) {
              merged.push(it);
              map[it.id] = it;
            }
          });
          _cache = (merged || []).slice(0, MAX);
          try {
            _writeLocal(_cache);
          } catch (e) {}
        })
        .catch(() => {});
    } catch (e) {}
  }

  (function initReports() {
    _cache = _readLocal().slice(0, MAX);
    if (typeof window !== 'undefined' && window.isLoggedIn !== true) {
      window.startReportCache = function () {
        refreshReportCache();
      };
      return;
    }
    refreshReportCache();
  })();

  function add(type, data) {
    try {
      console.log(data);
      let saat = '';
      let kantar = '';
      let malzeme = '';
      let sevkYeri = '';
      let vardiya = '';
      try {
        const now = new Date();
        const TZ = 'Europe/Istanbul';
        saat = new Intl.DateTimeFormat('en-GB', {
          timeZone: TZ,
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false,
          hourCycle: 'h23',
        }).format(now);
        let hours = 12;
        try {
          const parts = new Intl.DateTimeFormat('en-GB', {
            timeZone: TZ,
            hour: 'numeric',
            hour12: false,
            hourCycle: 'h23',
          }).formatToParts(now);
          const hp = parts.find((p) => p.type === 'hour');
          hours = hp ? parseInt(hp.value, 10) : now.getHours();
        } catch (e2) {
          hours = now.getHours();
        }
        if (hours >= 0 && hours < 8) vardiya = 'gece';
        else if (hours >= 8 && hours < 18) vardiya = 'gündüz';
        else vardiya = 'gece';
        kantar = (
          document.getElementById('imzaKantarAd')?.value ||
          localStorage.getItem('pref_kantar_default_v1_GLOBAL') ||
          ''
        )
          .toString()
          .trim();
        malzeme = (
          document.getElementById('malzeme')?.value ||
          document.getElementById('malzemeSelect')?.value ||
          localStorage.getItem('lastMalzeme') ||
          ''
        )
          .toString()
          .trim();
        sevkYeri = (
          document.getElementById('sevkYeri')?.value ||
          document.getElementById('xr_sevkYeri')?.value ||
          localStorage.getItem('lastSevkYeri') ||
          ''
        )
          .toString()
          .trim();
      } catch (e) {}

      let baseData = data && typeof data === 'object' ? Object.assign({}, data) : { value: data };
      if (typeof baseData.cikisYapildi === 'undefined') baseData.cikisYapildi = false;

      try {
        let testRaw = '';
        try {
          testRaw = JSON.stringify(baseData);
        } catch (e) {
          testRaw = String(baseData || '');
        }
        if (typeof testRaw === 'string' && testRaw.length > 240) {
          const slim = {};
          slim.plaka = (
            baseData.plaka ||
            baseData.plate ||
            baseData.vehicleId ||
            baseData.cekiciPlaka ||
            baseData.plakaPrint ||
            baseData.plaka_no ||
            ''
          ).slice(0, 20);
          slim.malzeme = (
            baseData.malzeme ||
            baseData.material ||
            baseData.item ||
            baseData.cargo ||
            baseData.yuk ||
            baseData.yukleme ||
            baseData['yük'] ||
            ''
          ).slice(0, 30);
          slim.firma = (baseData.firma || baseData.firmaKodu || baseData.firmaSelect || '').slice(0, 30);
          slim.sofor = (baseData.sofor || [baseData.soforAdi, baseData.soforSoyadi].filter(Boolean).join(' ') || '').slice(0, 80);
          slim.soforAdi = (baseData.soforAdi || '').slice(0, 40);
          slim.soforSoyadi = (baseData.soforSoyadi || '').slice(0, 40);
          slim.tcKimlik = (baseData.tcKimlik || '').slice(0, 11);
          slim.iletisim = (baseData.iletisim || '').slice(0, 20);
          slim.printCount = baseData.printCount || baseData.print_count || 0;
          slim.cikisYapildi = !!baseData.cikisYapildi;
          slim.saat = (baseData.saat || '').slice(0, 15);
          slim.vardiya = (baseData.vardiya || '').slice(0, 10);
          slim.kantar = (baseData.kantar || '').slice(0, 25);
          slim.sevkYeri = (baseData.sevkYeri || '').slice(0, 30);
          slim.value =
            typeof baseData.value === 'string' && baseData.value.length < 120
              ? baseData.value.slice(0, 80)
              : '';
          try {
            console.warn('Report.addEvent: payload too large, trimming to slim summary', {
              originalLength: testRaw.length,
              slim,
            });
          } catch (e) {}
          baseData = slim;
        }
      } catch (e) {}

      const isPrint = String(type || '').toUpperCase() === 'PRINT';
      const hasLockedPrintFields = isPrint && (
        (baseData.firma || baseData.firmaKodu)
        || baseData.malzeme
        || baseData.sevkYeri
      );
      if (!baseData.saat) baseData.saat = (saat || '').slice(0, 15);
      if (!baseData.vardiya) baseData.vardiya = (vardiya || '').slice(0, 10);
      if (!baseData.kantar) baseData.kantar = (kantar || '').slice(0, 25);
      if (!hasLockedPrintFields) {
        if (!baseData.malzeme) baseData.malzeme = (malzeme || '').slice(0, 30);
        if (!baseData.sevkYeri) baseData.sevkYeri = (sevkYeri || '').slice(0, 30);
      }

      const ev = {
        id: 'EV' + Date.now().toString(36) + Math.random().toString(16).slice(2),
        type: String(type || 'INFO'),
        ts: Date.now(),
        iso: new Date().toISOString(),
        userId: '',
        data: baseData,
      };
      _cache.unshift(ev);
      if (_cache.length > MAX) _cache.length = MAX;
      try {
        _writeLocal(_cache);
      } catch (e) {}
      try {
        fetch('/api/reports', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(ev),
        })
          .then(async (res) => {
            if (!res || !res.ok) {
              try {
                const body = await res.text();
                console.warn('POST /api/reports failed', res.status, body);
              } catch (e) {
                console.warn('POST /api/reports failed, and response body could not be read', e);
              }
            }
          })
          .catch((err) => {
            console.warn('POST /api/reports error', err);
          });
      } catch (e) {}
      return ev;
    } catch (e) {
      return null;
    }
  }

  function list() {
    return _cache.slice();
  }

  function clear() {
    try {
      _cache = [];
      _writeLocal([]);
      try {
        fetch('/api/reports', { method: 'DELETE' }).catch(() => {});
      } catch (e) {}
      return true;
    } catch (e) {
      return false;
    }
  }

  window.Report = window.Report || {};
  window.Report.addEvent = add;
  window.Report.getEvents = list;
  window.Report.clearEvents = clear;
  window.Report.KEY = KEY;
  window.refreshReportCache = refreshReportCache;
})();
