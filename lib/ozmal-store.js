'use strict';

const {
  generateDriverPassword,
  generateRandomDriverPassword,
  hashDriverPassword,
  verifyDriverPassword,
} = require('./driver-auth');

const KV_KEY = 'ozmal_entries_v1';
const FIXED_PASSWORD_MIGRATION_KEY = 'driver_fixed_password_v189274';

const DEFAULT_PLATES = [
  '43 ADS 408',
  '43 ADS 403',
  '43 ADT 546',
  '43 ADT 550',
  '43 ADT 553',
  '43 ADT 557',
];

const DEFAULT_BASSOFOR_PLATE = '43 ADS 408';
const DEFAULT_BASSOFOR_DRIVER = 'HASAN HÜSEYİN DİNÇ';

/** İlk kurulum / boş kayıt — şoför giriş menüsü hemen dolu gelsin */
const DEFAULT_SEED_ENTRIES = [
  {
    plaka: '43 ADS 408',
    bassofor: true,
    drivers: [{ name: 'HASAN HÜSEYİN DİNÇ', starred: true }],
  },
  {
    plaka: '43 ADS 403',
    drivers: [{ name: 'MEHMET ALİ SARI' }],
  },
  {
    plaka: '43 ADT 546',
    drivers: [{ name: 'AKİF BURÇ' }],
  },
  {
    plaka: '43 ADT 550',
    drivers: [{ name: 'HÜSEYİN MICIR' }],
  },
  {
    plaka: '43 ADT 553',
    drivers: [{ name: 'EMRE ÜSTÜNDAĞ' }],
  },
  {
    plaka: '43 ADT 557',
    drivers: [{ name: 'HÜSEYİN ORHAN' }],
  },
];

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

function normalizeDriver(raw, { keepPassword = false } = {}) {
  if (typeof raw === 'string') {
    const name = normDriverName(raw);
    if (!name) return null;
    return { name, starred: false };
  }
  if (!raw || typeof raw !== 'object') return null;
  const name = normDriverName(raw.name);
  if (!name) return null;
  const out = { name, starred: !!raw.starred };
  if (keepPassword) {
    if (raw.passwordHash) out.passwordHash = String(raw.passwordHash);
    if (raw.passwordPlain) out.passwordPlain = String(raw.passwordPlain);
  }
  return out;
}

async function migrateToFixedDriverPasswords(q, entries) {
  try {
    const r = await q('SELECT value FROM kv_store WHERE key = $1', [FIXED_PASSWORD_MIGRATION_KEY]);
    if (r.rows && r.rows[0] && r.rows[0].value === 'done') {
      return { entries, changed: false };
    }
  } catch (e) { /* ignore */ }

  const plain = generateDriverPassword();
  const hash = await hashDriverPassword(plain);
  const next = (entries || []).map((entry) => ({
    ...entry,
    drivers: (entry.drivers || []).map((d) => ({
      ...d,
      passwordPlain: plain,
      passwordHash: hash,
    })),
  }));

  try {
    await q(
      `INSERT INTO kv_store(key, value) VALUES ($1, $2)
       ON CONFLICT(key) DO UPDATE SET value = EXCLUDED.value`,
      [FIXED_PASSWORD_MIGRATION_KEY, 'done']
    );
  } catch (e) { /* ignore */ }

  return { entries: next, changed: true };
}

async function ensureDriverPasswords(entries) {
  let changed = false;
  const out = [];
  for (const entry of entries || []) {
    const drivers = [];
    for (const raw of entry.drivers || []) {
      const driver = normalizeDriver(raw, { keepPassword: true }) || normalizeDriver(raw);
      if (!driver) continue;
      if (!driver.passwordHash) {
        const plain = generateDriverPassword();
        driver.passwordPlain = plain;
        driver.passwordHash = await hashDriverPassword(plain);
        changed = true;
      } else if (raw.passwordPlain && !driver.passwordPlain) {
        driver.passwordPlain = String(raw.passwordPlain);
      }
      drivers.push(driver);
    }
    out.push({ ...entry, drivers });
  }
  return { entries: out, changed };
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

function normalizeEntries(rawEntries) {
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
  return out;
}

function migrateOzmalEntries(rawEntries) {
  const bassoforKey = normKey(DEFAULT_BASSOFOR_PLATE);
  let out = normalizeEntries(rawEntries);

  let bassoforEntry = out.find((entry) => normKey(entry.plaka) === bassoforKey);
  if (!bassoforEntry) {
    bassoforEntry = {
      plaka: formatPlateDisplay(DEFAULT_BASSOFOR_PLATE),
      bassofor: true,
      drivers: [{ name: normDriverName(DEFAULT_BASSOFOR_DRIVER), starred: true }],
    };
    out.unshift(bassoforEntry);
  } else {
    bassoforEntry.bassofor = true;
    if (!bassoforEntry.drivers.length) {
      bassoforEntry.drivers = [{ name: normDriverName(DEFAULT_BASSOFOR_DRIVER), starred: true }];
    }
  }

  return out.sort((a, b) => {
    const ba = a.bassofor ? 1 : 0;
    const bb = b.bassofor ? 1 : 0;
    if (ba !== bb) return bb - ba;
    return String(a.plaka || '').localeCompare(String(b.plaka || ''), 'tr');
  });
}

function defaultEntries() {
  return migrateOzmalEntries(DEFAULT_SEED_ENTRIES);
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

async function loadOzmalEntriesForLogin(q) {
  try {
    const r = await q('SELECT value FROM kv_store WHERE key = $1', [KV_KEY]);
    const raw = r.rows && r.rows[0] && r.rows[0].value;
    if (raw) {
      const parsed = JSON.parse(raw);
      const merged = mergeWithSeedDefaults(parsed);
      const beforeKeys = new Set(normalizeEntries(parsed).map((e) => normKey(e.plaka)));
      const hasNewSeed = merged.some((e) => !beforeKeys.has(normKey(e.plaka)));
      if (hasNewSeed) {
        await saveOzmalEntries(q, merged.map((entry) => ({
          plaka: entry.plaka,
          bassofor: !!entry.bassofor,
          drivers: (entry.drivers || []).map((d) => ({ name: d.name, starred: !!d.starred })),
        })));
        return stripPasswordFields(await loadOzmalEntries(q, { withPasswords: false }));
      }
      return stripPasswordFields(merged);
    }
  } catch (e) { /* ignore */ }
  const seeded = defaultEntries();
  await saveOzmalEntries(q, seeded.map((entry) => ({
    plaka: entry.plaka,
    bassofor: !!entry.bassofor,
    drivers: (entry.drivers || []).map((d) => ({ name: d.name, starred: !!d.starred })),
  })));
  return stripPasswordFields(seeded);
}

async function loadOzmalEntries(q, { withPasswords = false } = {}) {
  if (!withPasswords) {
    return loadOzmalEntriesForLogin(q);
  }
  try {
    const r = await q('SELECT value FROM kv_store WHERE key = $1', [KV_KEY]);
    const raw = r.rows && r.rows[0] && r.rows[0].value;
    if (raw) {
      const parsed = JSON.parse(raw);
      let entries = mergeWithSeedDefaults(parsed);
      const migrated = await migrateToFixedDriverPasswords(q, entries);
      entries = migrated.entries;
      const ensured = await ensureDriverPasswords(entries);
      entries = ensured.entries;
      const payload = JSON.stringify(entries);
      if (payload !== raw || ensured.changed || migrated.changed) {
        await q(
          `INSERT INTO kv_store(key, value) VALUES ($1, $2)
           ON CONFLICT(key) DO UPDATE SET value = EXCLUDED.value`,
          [KV_KEY, payload]
        );
      }
      return withPasswords ? entries : stripPasswordFields(entries);
    }
  } catch (e) { /* ignore */ }
  const seeded = defaultEntries();
  const migrated = await migrateToFixedDriverPasswords(q, seeded);
  const ensured = await ensureDriverPasswords(migrated.entries);
  const entries = ensured.entries;
  try {
    await q(
      `INSERT INTO kv_store(key, value) VALUES ($1, $2)
       ON CONFLICT(key) DO UPDATE SET value = EXCLUDED.value`,
      [KV_KEY, JSON.stringify(entries)]
    );
  } catch (e) { /* ignore */ }
  return withPasswords ? entries : stripPasswordFields(entries);
}

function stripPasswordFields(entries) {
  return (entries || []).map((entry) => ({
    ...entry,
    drivers: (entry.drivers || []).map((d) => ({
      name: d.name,
      starred: !!d.starred,
    })),
  }));
}

async function saveOzmalEntries(q, rawEntries) {
  const existing = await loadOzmalEntries(q, { withPasswords: true });
  const existingMap = new Map();
  existing.forEach((entry) => {
    const key = normKey(entry.plaka);
    const driverMap = new Map();
    (entry.drivers || []).forEach((d) => driverMap.set(normDriverName(d.name), d));
    existingMap.set(key, driverMap);
  });

  const migrated = mergeWithSeedDefaults(migrateOzmalEntries(rawEntries));
  const merged = [];
  for (const entry of migrated) {
    const key = normKey(entry.plaka);
    const oldDrivers = existingMap.get(key) || new Map();
    const drivers = [];
    for (const raw of entry.drivers || []) {
      const driver = normalizeDriver(raw, { keepPassword: true }) || normalizeDriver(raw);
      if (!driver) continue;
      const old = oldDrivers.get(normDriverName(driver.name));
      if (old && old.passwordHash) {
        driver.passwordHash = old.passwordHash;
        driver.passwordPlain = old.passwordPlain || driver.passwordPlain;
      }
      if (!driver.passwordHash) {
        driver.passwordPlain = generateDriverPassword();
        driver.passwordHash = await hashDriverPassword(driver.passwordPlain);
      }
      drivers.push(driver);
    }
    merged.push({ ...entry, drivers });
  }

  const payload = JSON.stringify(merged);
  await q(
    `INSERT INTO kv_store(key, value) VALUES ($1, $2)
     ON CONFLICT(key) DO UPDATE SET value = EXCLUDED.value`,
    [KV_KEY, payload]
  );
  return stripPasswordFields(merged);
}

async function findDriverAccount(q, plaka, driverName) {
  const entries = await loadOzmalEntries(q, { withPasswords: true });
  const key = normKey(plaka);
  const entry = entries.find((item) => normKey(item.plaka) === key);
  if (!entry) return null;
  const nameKey = normDriverName(driverName);
  const driver = (entry.drivers || []).find((d) => normDriverName(d.name) === nameKey);
  if (!driver) return null;
  return {
    plaka: entry.plaka,
    driver: driver.name,
    starred: !!driver.starred,
    passwordHash: driver.passwordHash,
  };
}

async function regenerateDriverPassword(q, plaka, driverName) {
  const entries = await loadOzmalEntries(q, { withPasswords: true });
  const key = normKey(plaka);
  const nameKey = normDriverName(driverName);
  let found = false;
  const next = entries.map((entry) => {
    if (normKey(entry.plaka) !== key) return entry;
    const drivers = (entry.drivers || []).map((d) => {
      if (normDriverName(d.name) !== nameKey) return d;
      found = true;
      const plain = generateRandomDriverPassword();
      return { ...d, passwordPlain: plain, passwordHash: null, _newPlain: plain };
    });
    return { ...entry, drivers };
  });
  if (!found) return null;
  for (const entry of next) {
    for (const d of entry.drivers || []) {
      if (d._newPlain) {
        d.passwordHash = await hashDriverPassword(d._newPlain);
        delete d._newPlain;
      }
    }
  }
  await q(
    `INSERT INTO kv_store(key, value) VALUES ($1, $2)
     ON CONFLICT(key) DO UPDATE SET value = EXCLUDED.value`,
    [KV_KEY, JSON.stringify(next)]
  );
  const driver = next
    .find((e) => normKey(e.plaka) === key)
    ?.drivers?.find((d) => normDriverName(d.name) === nameKey);
  return driver ? { passwordPlain: driver.passwordPlain } : null;
}

async function addOzmalPlateDriver(q, plakaRaw, driverRaw) {
  const plaka = formatPlateDisplay(plakaRaw);
  const driverName = normDriverName(driverRaw);
  const key = normKey(plaka);
  if (!key || key.length < 5) return { ok: false, error: 'Geçersiz plaka' };

  const entries = await loadOzmalEntries(q, { withPasswords: true });
  const payload = entries.map((entry) => ({
    plaka: entry.plaka,
    bassofor: !!entry.bassofor,
    drivers: (entry.drivers || []).map((d) => ({ name: d.name, starred: !!d.starred })),
  }));

  const idx = payload.findIndex((entry) => normKey(entry.plaka) === key);
  if (idx >= 0) {
    if (!driverName) {
      return { ok: false, error: 'Bu plaka zaten listede. İkinci şoför için şoför adı yazın.' };
    }
    const drivers = payload[idx].drivers || [];
    if (drivers.some((d) => normDriverName(d.name) === driverName)) {
      return { ok: false, error: 'Bu şoför zaten bu plakada kayıtlı' };
    }
    drivers.push({ name: driverName, starred: false });
    payload[idx].drivers = drivers;
  } else {
    payload.push({
      plaka,
      bassofor: key === normKey(DEFAULT_BASSOFOR_PLATE),
      drivers: driverName ? [{ name: driverName, starred: false }] : [],
    });
  }

  const saved = await saveOzmalEntries(q, payload);
  let passwordPlain = null;
  if (driverName) {
    const fresh = await loadOzmalEntries(q, { withPasswords: true });
    const driver = fresh
      .find((entry) => normKey(entry.plaka) === key)
      ?.drivers?.find((d) => normDriverName(d.name) === driverName);
    passwordPlain = driver?.passwordPlain || null;
  }

  return {
    ok: true,
    plaka,
    driver: driverName,
    addedDriver: idx >= 0,
    passwordPlain,
    entries: saved,
  };
}

function buildDriverLoginAccounts(entries) {
  const accounts = [];
  mergeWithSeedDefaults(entries).forEach((entry) => {
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

module.exports = {
  KV_KEY,
  DEFAULT_PLATES,
  DEFAULT_BASSOFOR_PLATE,
  DEFAULT_BASSOFOR_DRIVER,
  migrateOzmalEntries,
  DEFAULT_SEED_ENTRIES,
  mergeWithSeedDefaults,
  normKey,
  normDriverName,
  formatPlateDisplay,
  normalizeDriver,
  normalizeEntry,
  normalizeEntries,
  defaultEntries,
  loadOzmalEntries,
  saveOzmalEntries,
  buildDriverLoginAccounts,
  findDriverAccount,
  regenerateDriverPassword,
  addOzmalPlateDriver,
  stripPasswordFields,
  verifyDriverPassword,
};
