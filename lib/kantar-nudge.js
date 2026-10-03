'use strict';

const crypto = require('crypto');

const NUDGE_TARGETS = ['AVDAN', '1.OSB'];
const NUDGE_TTL_MS = 30 * 1000;
const NUDGE_COOLDOWN_MS = 8 * 1000;

function normalizeTarget(raw) {
  const s = String(raw || '')
    .trim()
    .toLocaleUpperCase('tr-TR')
    .replace(/\s+/g, '');
  if (s === 'AVDAN') return 'AVDAN';
  if (s === '1.OSB' || s === '1OSB' || s === 'OSB') return '1.OSB';
  return '';
}

function siteFromUsername(username) {
  return normalizeTarget(username);
}

function isTargetOnline(snapshot, target) {
  const key = normalizeTarget(target);
  if (!key) return false;
  return (Array.isArray(snapshot) ? snapshot : []).some((row) => row && row.key === key && row.online);
}

function createNudgeStore(opts) {
  const clock = typeof (opts && opts.now) === 'function' ? opts.now : () => Date.now();
  const makeId = typeof (opts && opts.id) === 'function' ? opts.id : () => crypto.randomUUID();
  const last = new Map();

  function send(targetRaw, snapshot, from) {
    const target = normalizeTarget(targetRaw);
    if (!target) return { ok: false, code: 'BAD_TARGET' };
    if (!isTargetOnline(snapshot, target)) return { ok: false, code: 'OFFLINE' };
    const t = clock();
    const prev = last.get(target);
    if (prev && t - prev.ts < NUDGE_COOLDOWN_MS) {
      return { ok: false, code: 'COOLDOWN', retryAfter: NUDGE_COOLDOWN_MS - (t - prev.ts) };
    }
    const nudge = {
      id: String(makeId()),
      target,
      from: String(from || 'AMİR').trim() || 'AMİR',
      ts: t,
    };
    last.set(target, nudge);
    return { ok: true, nudge };
  }

  function pending(site, sinceTs) {
    const target = siteFromUsername(site);
    const n = last.get(target);
    if (!n) return null;
    const t = clock();
    if (t - n.ts > NUDGE_TTL_MS) return null;
    const since = Number(sinceTs) || 0;
    if (since && n.ts <= since) return null;
    return n;
  }

  return { send, pending };
}

module.exports = {
  NUDGE_TARGETS,
  NUDGE_TTL_MS,
  NUDGE_COOLDOWN_MS,
  normalizeTarget,
  siteFromUsername,
  isTargetOnline,
  createNudgeStore,
};
