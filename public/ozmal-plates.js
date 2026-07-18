/**
 * Şirket özmal araç plakaları — ayarlar, filtreler ve şöför giriş listesi.
 * Sunucu (kv_store) ana kaynak; localStorage önbellek.
 */
(function (root) {
  'use strict';

  const STORAGE_KEY = 'ozmal_plates_v1';
  const ENTRIES_STORAGE_KEY = 'ozmal_entries_v1';
  const DEFAULT_PLATES = [
    '43 ADS 408',
    '43 ADS 403',
    '43 ADT 546',
    '43 ADT 550',
    '43 ADT 553',
    '43 ADT 557',
  ];

  const DEFAULT_BASSOFOR_PLATE = '43 ADS 408';
  const BASSOFOR_LABEL = 'BAŞŞOFÖR';
  const BASSOFOR_DRIVER_HINT = 'HASAN HÜSEYİN DİNÇ';

  const DEFAULT_SEED_ENTRIES = [
    {
      plaka: '43 ADS 408',
      bassofor: true,
      drivers: [{ name: 'HASAN HÜSEYİN DİNÇ', starred: true }],
    },
    { plaka: '43 ADS 403', drivers: [{ name: 'MEHMET ALİ SARI' }] },
    { plaka: '43 ADT 546', drivers: [{ name: 'AKİF BURÇ' }] },
    { plaka: '43 ADT 550', drivers: [{ name: 'HÜSEYİN MICIR' }] },
    { plaka: '43 ADT 553', drivers: [{ name: 'EMRE ÜSTÜNDAĞ' }] },
    { plaka: '43 ADT 557', drivers: [{ name: 'HÜSEYİN ORHAN' }] },
  ];

  let _entries = null;
  let _plates = null;
  let _keySet = null;
  let _syncPromise = null;

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

  function normalizeDriver(raw) {
    if (typeof raw === 'string') {
      const name = normDriverName(raw);
      if (!name) return null;
      return { name, starred: false };
    }
    if (!raw || typeof raw !== 'object') return null;
    const name = normDriverName(raw.name);
    if (!name) return null;
    return { name, starred: !!raw.starred };
  }

  function driverDisplayName(raw) {
    const driver = normalizeDriver(raw);
    return driver ? driver.name : '';
  }

  function normalizeEntry(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const plaka = formatPlateDisplay(raw.plaka);
    const key = normKey(plaka);
    if (!key) return null;

    const drivers = [];
    const seen = new Set();
    (Array.isArray(raw.drivers) ? raw.drivers : []).forEach((item) => {
      const driver = normalizeDriver(item);
      if (!driver || seen.has(driver.name)) return;
      seen.add(driver.name);
      drivers.push(driver);
    });

    const bassofor = !!raw.bassofor || key === normKey(DEFAULT_BASSOFOR_PLATE);
    return { plaka, drivers, bassofor };
  }

  function migrateOzmalEntries(rawEntries) {
    const bassoforKey = normKey(DEFAULT_BASSOFOR_PLATE);
    const out = [];
    const seen = new Set();

    (Array.isArray(rawEntries) ? rawEntries : []).forEach((item) => {
      const entry = normalizeEntry(item);
      if (!entry) return;
      const key = normKey(entry.plaka);
      if (seen.has(key)) return;
      seen.add(key);
      out.push(entry);
    });

    let bassoforEntry = out.find((entry) => normKey(entry.plaka) === bassoforKey);
    if (!bassoforEntry) {
      bassoforEntry = normalizeEntry({
        plaka: DEFAULT_BASSOFOR_PLATE,
        bassofor: true,
        drivers: [{ name: BASSOFOR_DRIVER_HINT, starred: true }],
      });
      if (bassoforEntry) out.unshift(bassoforEntry);
    } else {
      bassoforEntry.bassofor = true;
      if (!bassoforEntry.drivers.length) {
        bassoforEntry.drivers = [{ name: normDriverName(BASSOFOR_DRIVER_HINT), starred: true }];
      }
    }

    return out.sort((a, b) => {
      const ba = a.bassofor ? 1 : 0;
      const bb = b.bassofor ? 1 : 0;
      if (ba !== bb) return bb - ba;
      return String(a.plaka || '').localeCompare(String(b.plaka || ''), 'tr');
    });
  }

  function sortOzmalEntries(entries) {
    return (entries || []).slice().sort((a, b) => {
      const ba = a.bassofor ? 1 : 0;
      const bb = b.bassofor ? 1 : 0;
      if (ba !== bb) return bb - ba;
      return String(a.plaka || '').localeCompare(String(b.plaka || ''), 'tr');
    });
  }

  function mergeWithSeedDefaults(entries) {
    const migrated = migrateOzmalEntries(entries);
    const byKey = new Map(migrated.map((entry) => [normKey(entry.plaka), entry]));

    DEFAULT_SEED_ENTRIES.forEach((seedRaw) => {
      const seed = normalizeEntry(seedRaw);
      if (!seed) return;
      const key = normKey(seed.plaka);
      const existing = byKey.get(key);
      if (!existing) {
        byKey.set(key, seed);
        return;
      }
      existing.bassofor = existing.bassofor || seed.bassofor;
      if (!existing.drivers.length && seed.drivers.length) {
        existing.drivers = seed.drivers.map((d) => ({ name: d.name, starred: !!d.starred }));
      }
    });

    return sortOzmalEntries(Array.from(byKey.values()));
  }

  function defaultEntries() {
    return mergeWithSeedDefaults(DEFAULT_SEED_ENTRIES);
  }

  function serializeEntries(entries) {
    return (entries || [])
      .map((entry) => normalizeEntry(entry))
      .filter(Boolean)
      .map((entry) => ({
        plaka: entry.plaka,
        bassofor: !!entry.bassofor,
        drivers: (entry.drivers || []).map((d) => ({
          name: d.name,
          starred: !!d.starred,
        })),
      }));
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
          if (out.length) return mergeWithSeedDefaults(out);
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

    return defaultEntries();
  }

  function getSettingsToken() {
    try {
      if (root.AyarlarGate && typeof root.AyarlarGate.getSettingsToken === 'function') {
        return root.AyarlarGate.getSettingsToken() || '';
      }
    } catch (e) { /* ignore */ }
    return '';
  }

  function getDriverPanelOfficeToken() {
    try {
      const raw = sessionStorage.getItem('driverPanelSession_v1');
      if (!raw) return '';
      const parsed = JSON.parse(raw);
      if (parsed && parsed.role === 'office' && parsed.token) return String(parsed.token);
    } catch (e) { /* ignore */ }
    return '';
  }

  async function pushEntriesToServer(entries) {
    const driverToken = getDriverPanelOfficeToken();
    if (driverToken) {
      try {
        const res = await fetch('/api/driver-panel/ozmal-entries', {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${driverToken}`,
            'Cache-Control': 'no-cache',
          },
          body: JSON.stringify({ entries: serializeEntries(entries) }),
        });
        if (res.ok) {
          const data = await res.json().catch(() => null);
          return { ok: true, entries: data && data.entries ? data.entries : entries };
        }
      } catch (e) { /* fall through to settings token */ }
    }

    const token = getSettingsToken();
    if (!token) return { ok: false, skipped: true };
    try {
      const res = await fetch('/api/settings/ozmal-entries', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'X-Settings-Token': token,
          'Cache-Control': 'no-cache',
        },
        body: JSON.stringify({ entries: serializeEntries(entries) }),
      });
      if (!res.ok) return { ok: false, error: 'Sunucuya kaydedilemedi' };
      const data = await res.json().catch(() => null);
      return { ok: true, entries: data && data.entries ? data.entries : entries };
    } catch (e) {
      return { ok: false, error: 'Sunucuya bağlanılamadı' };
    }
  }

  async function pullEntriesFromServer() {
    try {
      const res = await fetch('/api/ozmal-entries', {
        method: 'GET',
        credentials: 'include',
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache' },
      });
      if (!res.ok) return null;
      const data = await res.json().catch(() => null);
      if (!data || !Array.isArray(data.entries)) return null;
      const entries = [];
      const seen = new Set();
      data.entries.forEach((item) => {
        const entry = normalizeEntry(item);
        if (!entry) return;
        const key = normKey(entry.plaka);
        if (seen.has(key)) return;
        seen.add(key);
        entries.push(entry);
      });
      if (entries.length) return mergeWithSeedDefaults(entries);
      return null;
    } catch (e) {
      return null;
    }
  }

  function saveEntries(entries, opts) {
    const cleaned = migrateOzmalEntries(entries);
    try {
      localStorage.setItem(ENTRIES_STORAGE_KEY, JSON.stringify(serializeEntries(cleaned)));
      localStorage.setItem(STORAGE_KEY, JSON.stringify(cleaned.map((e) => e.plaka)));
    } catch (e) { /* ignore */ }
    _entries = cleaned;
    _plates = cleaned.map((e) => e.plaka);
    _keySet = new Set(_plates.map(normKey));
    notifyChanged();
    if (!opts || !opts.skipServer) {
      pushEntriesToServer(cleaned).catch(() => {});
    }
    return cleaned;
  }

  function refreshCache() {
    _entries = mergeWithSeedDefaults(loadEntriesFromStorage());
    _plates = _entries.map((e) => e.plaka);
    _keySet = new Set(_plates.map(normKey));
    return _entries;
  }

  async function syncFromServer() {
    const remote = await pullEntriesFromServer();
    if (remote) {
      saveEntries(remote, { skipServer: true });
    } else {
      refreshCache();
    }
    return getOzmalEntries();
  }

  function applyRemoteEntries(entries) {
    if (!Array.isArray(entries) || !entries.length) return getOzmalEntries();
    saveEntries(entries, { skipServer: true });
    return getOzmalEntries();
  }

  function ensureSynced() {
    if (!_syncPromise) {
      _syncPromise = syncFromServer().finally(() => {
        _syncPromise = null;
      });
    }
    return _syncPromise;
  }

  function getOzmalEntries() {
    if (!_entries) refreshCache();
    return mergeWithSeedDefaults(_entries)
      .map((e) => ({
        plaka: e.plaka,
        bassofor: !!e.bassofor,
        drivers: (e.drivers || []).map((d) => normalizeDriver(d)).filter(Boolean),
      }))
      .sort((a, b) => {
        const ba = a.bassofor ? 1 : 0;
        const bb = b.bassofor ? 1 : 0;
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
    return entry ? entry.drivers.map((d) => d.name) : [];
  }

  function getDriverLoginAccounts() {
    const accounts = [];
    getOzmalEntries().forEach((entry) => {
      (entry.drivers || []).forEach((driver) => {
        if (!driver || !driver.name) return;
        accounts.push({
          plaka: entry.plaka,
          driver: driver.name,
          starred: !!driver.starred,
          bassofor: !!entry.bassofor,
        });
      });
    });
    return accounts.sort((a, b) => {
      if (a.starred && !b.starred) return -1;
      if (!a.starred && b.starred) return 1;
      if (a.bassofor && !b.bassofor) return -1;
      if (!a.bassofor && b.bassofor) return 1;
      const plateCmp = String(a.plaka || '').localeCompare(String(b.plaka || ''), 'tr');
      if (plateCmp !== 0) return plateCmp;
      return String(a.driver || '').localeCompare(String(b.driver || ''), 'tr');
    });
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
    const entry = getOzmalEntries().find((e) => normKey(e.plaka) === key);
    if (entry) return !!entry.bassofor;
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
        new CustomEvent('ozmal-plates-changed', {
          detail: { plates: getOzmalPlates(), entries: getOzmalEntries() },
        })
      );
    } catch (e) { /* ignore */ }
  }

  function saveOzmalPlates(plates) {
    const current = getOzmalEntries();
    const metaMap = new Map(current.map((e) => [normKey(e.plaka), e]));
    const entries = (plates || []).map((p) => {
      const plaka = formatPlateDisplay(p);
      const prev = metaMap.get(normKey(plaka));
      return {
        plaka,
        bassofor: prev ? !!prev.bassofor : false,
        drivers: prev ? prev.drivers.slice() : [],
      };
    });
    return saveEntries(entries);
  }

  function addOzmalPlate(plaka, driverName) {
    const display = formatPlateDisplay(plaka);
    const key = normKey(display);
    if (!key || key.length < 5) return { ok: false, error: 'Geçersiz plaka' };
    const rawDriver = String(driverName || '').trim();
    const driver = normalizeDriver(rawDriver ? { name: rawDriver } : null);
    const entries = getOzmalEntries().map((e) => ({
      plaka: e.plaka,
      bassofor: !!e.bassofor,
      drivers: (e.drivers || []).map((d) => ({ name: d.name, starred: !!d.starred })),
    }));
    const idx = entries.findIndex((e) => normKey(e.plaka) === key);

    if (idx >= 0) {
      if (!driver) {
        if (rawDriver) return { ok: false, error: 'Geçersiz şoför adı.' };
        return {
          ok: false,
          error: 'Bu plaka zaten listede. İkinci şoför için şoför adı yazıp tekrar ekleyin.',
        };
      }
      const drivers = entries[idx].drivers || [];
      if (drivers.some((d) => normDriverName(d.name) === driver.name)) {
        return { ok: false, error: 'Bu şoför zaten bu plakada kayıtlı' };
      }
      drivers.push(driver);
      entries[idx].drivers = drivers;
      saveEntries(entries);
      return { ok: true, plate: display, driver: driver.name, addedDriver: true };
    }

    if (rawDriver && !driver) {
      return { ok: false, error: 'Geçersiz şoför adı.' };
    }

    entries.push({
      plaka: display,
      bassofor: key === normKey(DEFAULT_BASSOFOR_PLATE),
      drivers: driver ? [driver] : [],
    });
    saveEntries(entries);
    return { ok: true, plate: display, driver: driver ? driver.name : '', addedDriver: false };
  }

  function removeOzmalDriver(plaka, driverName) {
    const key = normKey(plaka);
    const driver = normDriverName(driverName);
    if (!key || !driver) return { ok: false, error: 'Geçersiz kayıt' };
    const entries = getOzmalEntries().map((e) => ({
      plaka: e.plaka,
      bassofor: !!e.bassofor,
      drivers: (e.drivers || []).filter((d) => normDriverName(d.name) !== driver),
    }));
    const idx = entries.findIndex((e) => normKey(e.plaka) === key);
    if (idx < 0) return { ok: false, error: 'Plaka bulunamadı' };
    saveEntries(entries);
    return { ok: true };
  }

  function toggleOzmalDriverStar(plaka, driverName) {
    const key = normKey(plaka);
    const driver = normDriverName(driverName);
    if (!key || !driver) return { ok: false, error: 'Geçersiz kayıt' };
    const entries = getOzmalEntries().map((e) => ({
      plaka: e.plaka,
      bassofor: !!e.bassofor,
      drivers: (e.drivers || []).map((d) => ({ name: d.name, starred: !!d.starred })),
    }));
    const idx = entries.findIndex((e) => normKey(e.plaka) === key);
    if (idx < 0) return { ok: false, error: 'Plaka bulunamadı' };
    const drivers = entries[idx].drivers || [];
    const dIdx = drivers.findIndex((d) => normDriverName(d.name) === driver);
    if (dIdx < 0) return { ok: false, error: 'Şoför bulunamadı' };
    drivers[dIdx].starred = !drivers[dIdx].starred;
    entries[idx].drivers = drivers;
    saveEntries(entries);
    return { ok: true, starred: drivers[dIdx].starred };
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
    getDriverLoginAccounts,
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
    toggleOzmalDriverStar,
    removeOzmalPlate,
    refreshCache,
    syncFromServer,
    applyRemoteEntries,
    ensureSynced,
    pushEntriesToServer,
  };

  root.OzmalPlates = OzmalPlates;
  root.isOzmalPlate = isOzmalPlate;
  root.vehicleIsOzmal = vehicleIsOzmal;
  root.isBassoforPlate = isBassoforPlate;
  root.vehicleIsBassofor = vehicleIsBassofor;
  root.ozmalStatusLabel = ozmalStatusLabel;

  refreshCache();
  ensureSynced();
})(typeof window !== 'undefined' ? window : globalThis);
