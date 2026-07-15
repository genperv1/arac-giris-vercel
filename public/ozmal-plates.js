/**
 * Şirket özmal araç plakaları — ana sayfa filtresi, kart yıldızı, nakliye listesi, ayarlar.
 */
(function (root) {
  'use strict';

  const STORAGE_KEY = 'ozmal_plates_v1';
  const ENTRIES_STORAGE_KEY = 'ozmal_entries_v1';
  const DEFAULT_PLATES = [
    '43 ADT 557',
    '43 ADT 550',
    '43 ADT 553',
    '43 ADS 403',
    '43 ADS 408',
    '43 ADT 546',
  ];

  const DEFAULT_BASSOFOR_PLATE = '43 ADS 408';
  const BASSOFOR_LABEL = 'BAŞŞOFÖR';
  const BASSOFOR_DRIVER_HINT = 'HASAN HÜSEYİN DİNÇ';

  let _entries = null;
  let _plates = null;
  let _keySet = null;

  function normKey(plaka) {
    return String(plaka || '')
      .toUpperCase()
      .replace(/[\s\-]+/g, '')
      .replace(/İ/g, 'I');
  }

  function normDriverName(name) {
    return String(name || '')
      .trim()
      .replace(/\s+/g, ' ')
      .toUpperCase()
      .replace(/İ/g, 'I');
  }

  function formatPlateDisplay(raw) {
    const compact = normKey(raw);
    const m = compact.match(/^(\d{2})([A-Z]{1,3})(\d{2,5})$/);
    if (m) return `${m[1]} ${m[2]} ${m[3]}`;
    return String(raw || '').trim().toUpperCase().replace(/İ/g, 'I');
  }

  function normalizeEntry(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const plaka = formatPlateDisplay(raw.plaka);
    const key = normKey(plaka);
    if (!key) return null;
    const drivers = [];
    const seen = new Set();
    (Array.isArray(raw.drivers) ? raw.drivers : []).forEach((d) => {
      const name = normDriverName(d);
      if (!name || seen.has(name)) return;
      seen.add(name);
      drivers.push(name);
    });
    return { plaka, drivers };
  }

  function loadEntriesFromStorage() {
    try {
      const raw = localStorage.getItem(ENTRIES_STORAGE_KEY);
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) {
          const out = [];
          const seen = new Set();
          arr.forEach((item) => {
            const entry = normalizeEntry(item);
            if (!entry) return;
            const key = normKey(entry.plaka);
            if (seen.has(key)) return;
            seen.add(key);
            out.push(entry);
          });
          if (out.length) return out;
        }
      }
    } catch (e) { /* ignore */ }

    try {
      const legacy = localStorage.getItem(STORAGE_KEY);
      if (legacy) {
        const arr = JSON.parse(legacy);
        if (Array.isArray(arr) && arr.length) {
          return arr.map((p) => normalizeEntry({ plaka: p, drivers: [] })).filter(Boolean);
        }
      }
    } catch (e) { /* ignore */ }

    return DEFAULT_PLATES.map((p) => ({ plaka: formatPlateDisplay(p), drivers: [] }));
  }

  function saveEntries(entries) {
    const cleaned = [];
    const seen = new Set();
    (entries || []).forEach((item) => {
      const entry = normalizeEntry(item);
      if (!entry) return;
      const key = normKey(entry.plaka);
      if (seen.has(key)) return;
      seen.add(key);
      cleaned.push(entry);
    });
    try {
      localStorage.setItem(ENTRIES_STORAGE_KEY, JSON.stringify(cleaned));
      localStorage.setItem(STORAGE_KEY, JSON.stringify(cleaned.map((e) => e.plaka)));
    } catch (e) { /* ignore */ }
    _entries = cleaned;
    _plates = cleaned.map((e) => e.plaka);
    _keySet = new Set(_plates.map(normKey));
    notifyChanged();
    return cleaned;
  }

  function refreshCache() {
    _entries = loadEntriesFromStorage();
    _plates = _entries.map((e) => e.plaka);
    _keySet = new Set(_plates.map(normKey));
    return _entries;
  }

  function getOzmalEntries() {
    if (!_entries) refreshCache();
    return _entries
      .map((e) => ({ plaka: e.plaka, drivers: (e.drivers || []).slice() }))
      .sort((a, b) => {
        const ba = isBassoforPlate(a.plaka) ? 1 : 0;
        const bb = isBassoforPlate(b.plaka) ? 1 : 0;
        if (ba !== bb) return bb - ba;
        return String(a.plaka || '').localeCompare(String(b.plaka || ''), 'tr');
      });
  }

  function getOzmalPlates() {
    if (!_plates) refreshCache();
    return _plates.slice();
  }

  function getOzmalPlateKeys() {
    if (!_keySet) refreshCache();
    return _keySet;
  }

  function getOzmalDrivers(plaka) {
    const key = normKey(plaka);
    const entry = getOzmalEntries().find((e) => normKey(e.plaka) === key);
    return entry ? entry.drivers.slice() : [];
  }

  function isOzmalPlate(plaka) {
    const key = normKey(plaka);
    return key ? getOzmalPlateKeys().has(key) : false;
  }

  function vehicleIsOzmal(vehicle) {
    if (!vehicle) return false;
    return isOzmalPlate(vehicle.cekiciPlaka) || isOzmalPlate(vehicle.dorsePlaka);
  }

  function isBassoforPlate(plaka) {
    const key = normKey(plaka);
    return key === normKey(DEFAULT_BASSOFOR_PLATE);
  }

  function vehicleIsBassofor(vehicle) {
    if (!vehicle) return false;
    return isBassoforPlate(vehicle.cekiciPlaka) || isBassoforPlate(vehicle.dorsePlaka);
  }

  function ozmalStatusLabel(plaka) {
    return isBassoforPlate(plaka) ? BASSOFOR_LABEL : 'ÖZMAL';
  }

  function notifyChanged() {
    try {
      root.dispatchEvent(
        new CustomEvent('ozmal-plates-changed', { detail: { plates: getOzmalPlates(), entries: getOzmalEntries() } })
      );
    } catch (e) { /* ignore */ }
  }

  function saveOzmalPlates(plates) {
    const current = getOzmalEntries();
    const driverMap = new Map(current.map((e) => [normKey(e.plaka), e.drivers || []]));
    const entries = (plates || []).map((p) => {
      const plaka = formatPlateDisplay(p);
      return { plaka, drivers: driverMap.get(normKey(plaka)) || [] };
    });
    return saveEntries(entries);
  }

  function addOzmalPlate(plaka, driverName) {
    const display = formatPlateDisplay(plaka);
    const key = normKey(display);
    if (!key || key.length < 5) return { ok: false, error: 'Geçersiz plaka' };
    const driver = normDriverName(driverName);
    const entries = getOzmalEntries();
    const idx = entries.findIndex((e) => normKey(e.plaka) === key);

    if (idx >= 0) {
      if (!driver) {
        return {
          ok: false,
          error: 'Bu plaka zaten listede. İkinci şoför için şoför adı yazıp tekrar ekleyin.',
        };
      }
      const drivers = entries[idx].drivers || [];
      if (drivers.some((d) => normDriverName(d) === driver)) {
        return { ok: false, error: 'Bu şoför zaten bu plakada kayıtlı' };
      }
      drivers.push(driver);
      entries[idx].drivers = drivers;
      saveEntries(entries);
      return { ok: true, plate: display, driver, addedDriver: true };
    }

    entries.push({ plaka: display, drivers: driver ? [driver] : [] });
    saveEntries(entries);
    return { ok: true, plate: display, driver: driver || '', addedDriver: false };
  }

  function removeOzmalDriver(plaka, driverName) {
    const key = normKey(plaka);
    const driver = normDriverName(driverName);
    if (!key || !driver) return { ok: false, error: 'Geçersiz kayıt' };
    const entries = getOzmalEntries();
    const idx = entries.findIndex((e) => normKey(e.plaka) === key);
    if (idx < 0) return { ok: false, error: 'Plaka bulunamadı' };
    entries[idx].drivers = (entries[idx].drivers || []).filter((d) => normDriverName(d) !== driver);
    saveEntries(entries);
    return { ok: true };
  }

  function removeOzmalPlate(plaka) {
    const key = normKey(plaka);
    if (!key) return { ok: false, error: 'Geçersiz plaka' };
    saveEntries(getOzmalEntries().filter((e) => normKey(e.plaka) !== key));
    return { ok: true };
  }

  const OzmalPlates = {
    STORAGE_KEY,
    ENTRIES_STORAGE_KEY,
    DEFAULT_PLATES,
    normKey,
    normDriverName,
    formatPlateDisplay,
    getOzmalEntries,
    getOzmalPlates,
    getOzmalPlateKeys,
    getOzmalDrivers,
    isOzmalPlate,
    vehicleIsOzmal,
    isBassoforPlate,
    vehicleIsBassofor,
    ozmalStatusLabel,
    DEFAULT_BASSOFOR_PLATE,
    BASSOFOR_LABEL,
    BASSOFOR_DRIVER_HINT,
    saveOzmalPlates,
    addOzmalPlate,
    removeOzmalDriver,
    removeOzmalPlate,
    refreshCache,
  };

  root.OzmalPlates = OzmalPlates;
  root.isOzmalPlate = isOzmalPlate;
  root.vehicleIsOzmal = vehicleIsOzmal;
  root.isBassoforPlate = isBassoforPlate;
  root.vehicleIsBassofor = vehicleIsBassofor;
  root.ozmalStatusLabel = ozmalStatusLabel;

  refreshCache();
})(typeof window !== 'undefined' ? window : globalThis);
