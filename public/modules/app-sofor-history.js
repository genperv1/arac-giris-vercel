// Plaka -> şoför geçmişi (in-memory; Excel/login akışına dokunmaz)
(function () {
  'use strict';

  const soforHistoryStorage = (function () {
    const _mem = {};
    return {
      load() { try { return _mem; } catch (e) { return {}; } },
      save(map) {
        try {
          Object.keys(_mem).forEach((k) => delete _mem[k]);
          Object.assign(_mem, map || {});
        } catch (e) { /* ignore */ }
      },
      _key(plate) {
        return String(plate || '').toUpperCase().replace(/\s+/g, '').trim();
      },
      list(plate) {
        const k = this._key(plate);
        const map = this.load();
        const arr = map[k];
        return Array.isArray(arr) ? arr.filter(Boolean) : [];
      },
      add(plate, driver) {
        const k = this._key(plate);
        if (!k) return;
        const d = driver || {};
        const name = String(d.name || '').trim();
        const tc = String(d.tc || '').trim();
        const tel = String(d.phone || '').trim();
        if (!name && !tc && !tel) return;

        const map = this.load();
        const arr = Array.isArray(map[k]) ? map[k].filter(Boolean) : [];

        const same = (x) => {
          if (!x) return false;
          const xName = String(x.name || '').trim();
          const xTc = String(x.tc || '').trim();
          const xTel = String(x.phone || '').trim();
          if (tc && xTc && tc === xTc) return true;
          if (name && xName && tel && xTel) return (name === xName && tel === xTel);
          return name && xName && (name === xName);
        };

        const cleaned = arr.filter((x) => !same(x));
        const next = [{
          name,
          tc,
          phone: tel,
          updatedAt: Date.now(),
        }, ...cleaned].slice(0, 12);

        map[k] = next;
        this.save(map);
      },
    };
  })();

  function populateSoforHistoryFromVehicles(vehicles) {
    const arr = Array.isArray(vehicles) ? vehicles : [];
    const ts = Date.now();
    for (const v of arr) {
      try {
        const plate = v.cekiciPlaka || '';
        if (v.soforAdi || v.soforSoyadi || v.iletisim || v.tcKimlik) {
          soforHistoryStorage.add(plate, {
            name: ((v.soforAdi || '') + ' ' + (v.soforSoyadi || '')).trim(),
            tc: v.tcKimlik || '',
            phone: v.iletisim || '',
            updatedAt: ts,
          });
        }
        if (v.sofor2Adi || v.sofor2Soyadi) {
          soforHistoryStorage.add(plate, {
            name: ((v.sofor2Adi || '') + ' ' + (v.sofor2Soyadi || '')).trim(),
            tc: '',
            phone: '',
            updatedAt: ts,
          });
        }
      } catch (e) { /* ignore */ }
    }
  }

  window.soforHistoryStorage = soforHistoryStorage;
  window.populateSoforHistoryFromVehicles = populateSoforHistoryFromVehicles;
})();
