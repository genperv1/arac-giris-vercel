'use strict';

/** Oturum açık sayılma süresi: istemci 2 dk'da bir bildirir, bir kaçırma tolere edilir. */
const ONLINE_WINDOW_MS = 5 * 60 * 1000;

/** Selahattin Toker ve Şaban Lahaçlar bu saatler arasında (İstanbul) sürekli çevrimiçi görünür. */
const SCHEDULED_ONLINE_KEYS = new Set(['AMIR', 'SABAN']);
const SCHEDULED_ONLINE_START_HOUR = 8;
const SCHEDULED_ONLINE_END_HOUR = 19;
const SCHEDULED_ONLINE_TZ = 'Europe/Istanbul';

const SLOTS = [
  { key: 'AVDAN', label: 'AVDAN', match: (u) => u.username.toUpperCase() === 'AVDAN' },
  { key: '1.OSB', label: '1.OSB', match: (u) => u.username.toUpperCase() === '1.OSB' },
  { key: 'AMIR', label: 'SELAHATTİN', match: (u) => u.username.toLowerCase() === 'xxr' },
  { key: 'SABAN', label: 'ŞABAN', match: (u) => u.username.toLowerCase() === 'saban' },
  { key: 'UGUR', label: 'UĞUR', match: (u) => u.username.toLowerCase() === 'ugur' },
];

function istanbulHour(ms) {
  const hour = new Intl.DateTimeFormat('en-GB', {
    timeZone: SCHEDULED_ONLINE_TZ,
    hour: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(ms));
  const n = Number(hour);
  return n === 24 ? 0 : n;
}

function inScheduledOnlineWindow(ms) {
  const hour = istanbulHour(ms);
  return hour >= SCHEDULED_ONLINE_START_HOUR && hour < SCHEDULED_ONLINE_END_HOUR;
}

function createPresence(now) {
  const clock = typeof now === 'function' ? now : () => Date.now();
  const seen = new Map();

  function touch(user) {
    const username = String((user && user.username) || '').trim();
    if (!username) return;
    seen.set(username, { username, role: String((user && user.role) || '').toLowerCase(), at: clock() });
  }

  function remove(username) {
    seen.delete(String(username || '').trim());
  }

  function snapshot() {
    const t = clock();
    const users = Array.from(seen.values());
    return SLOTS.map((slot) => {
      const hits = users.filter((u) => slot.match(u));
      const last = hits.reduce((max, u) => Math.max(max, u.at), 0);
      const scheduled = SCHEDULED_ONLINE_KEYS.has(slot.key) && inScheduledOnlineWindow(t);
      const recentlySeen = last > 0 && t - last < ONLINE_WINDOW_MS;
      return {
        key: slot.key,
        label: slot.label,
        online: scheduled || recentlySeen,
        lastSeen: scheduled ? t : (last || null),
      };
    });
  }

  return { touch, remove, snapshot };
}

module.exports = {
  createPresence,
  ONLINE_WINDOW_MS,
  SCHEDULED_ONLINE_START_HOUR,
  SCHEDULED_ONLINE_END_HOUR,
};
