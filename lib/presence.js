'use strict';

/** Oturum açık sayılma süresi: istemci 2 dk'da bir bildirir, bir kaçırma tolere edilir. */
const ONLINE_WINDOW_MS = 5 * 60 * 1000;

/** Selahattin, Burak ve Şaban bu saatler arasında (İstanbul) sürekli çevrimiçi görünür. */
const SCHEDULED_ONLINE_KEYS = new Set(['AMIR', 'BURAK', 'SABAN']);
/** Cumartesi ve pazar Şaban ile Selahattin’in tatilidir; o günler programa yazılmaz. */
const WEEKEND_OFF_KEYS = new Set(['AMIR', 'SABAN']);
const SCHEDULED_ONLINE_START_HOUR = 8;
const SCHEDULED_ONLINE_END_HOUR = 19;
const SCHEDULED_ONLINE_TZ = 'Europe/Istanbul';

const KANTAR_KEYS = new Set(['AVDAN', '1.OSB']);

const SLOTS = [
  { key: 'AVDAN', label: 'AVDAN', match: (u) => u.username.toUpperCase() === 'AVDAN' },
  { key: '1.OSB', label: '1.OSB', match: (u) => u.username.toUpperCase() === '1.OSB' },
  { key: 'AMIR', label: 'SELAHATTİN', match: (u) => u.username.toLowerCase() === 'xxr' },
  { key: 'SABAN', label: 'ŞABAN', match: (u) => u.username.toLowerCase() === 'saban' },
  { key: 'UGUR', label: 'UĞUR', match: (u) => u.username.toLowerCase() === 'ugur' },
  { key: 'BURAK', label: 'BURAK', match: (u) => u.username.toLowerCase() === 'burak' },
];

function istanbulClock(ms) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: SCHEDULED_ONLINE_TZ,
    weekday: 'short',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(ms));
  const pick = (type) => {
    const row = parts.find((part) => part.type === type);
    return row ? row.value : '';
  };
  const hour = Number(pick('hour'));
  return {
    hour: hour === 24 ? 0 : hour,
    weekend: pick('weekday') === 'Sat' || pick('weekday') === 'Sun',
  };
}

function inScheduledOnlineWindow(ms, key) {
  const clock = istanbulClock(ms);
  if (clock.hour < SCHEDULED_ONLINE_START_HOUR || clock.hour >= SCHEDULED_ONLINE_END_HOUR) return false;
  if (WEEKEND_OFF_KEYS.has(key) && clock.weekend) return false;
  return true;
}

/** Liman nabzı veya listenin geliş anı. Açık oturum ayrıca presence.touch ile yazılır. */
function kantarSeenFromLiman(state) {
  const out = {};
  const hb = state && state.heartbeats;
  const sites = state && state.sites;
  ['AVDAN', '1.OSB'].forEach((key) => {
    const beat = hb && hb[key];
    const snap = sites && sites[key];
    const times = [beat && beat.at, snap && (snap.receivedAt || snap.updatedAt)]
      .map((raw) => Date.parse(raw || ''))
      .filter((n) => n > 0);
    if (times.length) out[key] = Math.max.apply(null, times);
  });
  return out;
}

function createPresence(now) {
  const clock = typeof now === 'function' ? now : () => Date.now();
  const seen = new Map();
  const saved = new Map();

  function noteSaved(key, at) {
    if (!KANTAR_KEYS.has(key)) return;
    const n = Number(at);
    if (!(n > 0)) return;
    const prev = Number(saved.get(key)) || 0;
    if (n > prev) saved.set(key, n);
  }

  function seed(map) {
    if (!map || typeof map !== 'object') return;
    Object.keys(map).forEach((key) => noteSaved(key, map[key]));
  }

  function kantarSeen() {
    const out = {};
    saved.forEach((at, key) => { out[key] = at; });
    return out;
  }

  function touch(user) {
    const username = String((user && user.username) || '').trim();
    if (!username) return;
    const row = { username, role: String((user && user.role) || '').toLowerCase(), at: clock() };
    seen.set(username, row);
    SLOTS.forEach((slot) => {
      if (slot.match(row)) noteSaved(slot.key, row.at);
    });
  }

  function remove(username) {
    const name = String(username || '').trim();
    const row = seen.get(name);
    if (row) {
      SLOTS.forEach((slot) => {
        if (slot.match(row)) noteSaved(slot.key, row.at);
      });
    }
    seen.delete(name);
  }

  function snapshot() {
    const t = clock();
    const users = Array.from(seen.values());
    return SLOTS.map((slot) => {
      const hits = users.filter((u) => slot.match(u));
      const last = hits.reduce((max, u) => Math.max(max, u.at), 0);
      const scheduled = SCHEDULED_ONLINE_KEYS.has(slot.key) && inScheduledOnlineWindow(t, slot.key);
      const recentlySeen = last > 0 && t - last < ONLINE_WINDOW_MS;
      const kept = Number(saved.get(slot.key)) || 0;
      const best = Math.max(last, kept);
      return {
        key: slot.key,
        label: slot.label,
        online: scheduled || recentlySeen,
        lastSeen: scheduled ? t : (best || null),
      };
    });
  }

  return { touch, remove, snapshot, seed, kantarSeen };
}

module.exports = {
  createPresence,
  kantarSeenFromLiman,
  ONLINE_WINDOW_MS,
  SCHEDULED_ONLINE_START_HOUR,
  SCHEDULED_ONLINE_END_HOUR,
};
