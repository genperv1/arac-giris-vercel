'use strict';

/** Oturum açık sayılma süresi: istemci 2 dk'da bir bildirir, bir kaçırma tolere edilir. */
const ONLINE_WINDOW_MS = 5 * 60 * 1000;

const SLOTS = [
  { key: 'AVDAN', label: 'AVDAN', match: (u) => u.username.toUpperCase() === 'AVDAN' },
  { key: '1.OSB', label: '1.OSB', match: (u) => u.username.toUpperCase() === '1.OSB' },
  { key: 'AMIR', label: 'AMİR', match: (u) => u.role === 'amir' || u.username.toLowerCase() === 'xxr' },
];

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
      return {
        key: slot.key,
        label: slot.label,
        online: last > 0 && t - last < ONLINE_WINDOW_MS,
        lastSeen: last || null,
      };
    });
  }

  return { touch, remove, snapshot };
}

module.exports = { createPresence, ONLINE_WINDOW_MS };
