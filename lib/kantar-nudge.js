'use strict';

const crypto = require('crypto');

const NUDGE_TARGETS = ['AVDAN', '1.OSB', 'AMIR', 'SABAN', 'UGUR'];
const KANTAR_TARGETS = ['AVDAN', '1.OSB'];
const NUDGE_TTL_MS = 30 * 1000;
const NUDGE_COOLDOWN_MS = 8 * 1000;
const DEFAULT_NUDGE_TEXT = 'Evrakları sevkiyat ofisine gönderin.';

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

/** Kantar veya kişi: dürtme / özel mesaj kutusu. */
function nudgeTarget(raw) {
  const site = normalizeTarget(raw);
  if (site) return site;
  const s = String(raw || '')
    .trim()
    .toLocaleUpperCase('tr-TR')
    .replace(/\s+/g, '');
  if (s === 'AMIR' || s === 'AMİR' || s === 'SELAHATTİN' || s === 'SELAHATTIN' || s === 'XXR') return 'AMIR';
  if (s === 'SABAN' || s === 'ŞABAN') return 'SABAN';
  if (s === 'UGUR' || s === 'UĞUR') return 'UGUR';
  return '';
}

function inboxKeyFromUsername(username) {
  return nudgeTarget(username);
}

function isKantarTarget(target) {
  return KANTAR_TARGETS.indexOf(target) !== -1;
}

function isTargetOnline(snapshot, target) {
  const key = nudgeTarget(target);
  if (!key) return false;
  return (Array.isArray(snapshot) ? snapshot : []).some((row) => row && row.key === key && row.online);
}

function createNudgeStore(opts) {
  const clock = typeof (opts && opts.now) === 'function' ? opts.now : () => Date.now();
  const makeId = typeof (opts && opts.id) === 'function' ? opts.id : () => crypto.randomUUID();
  const last = new Map();

  function send(targetRaw, snapshot, from, text, fromKey) {
    const target = nudgeTarget(targetRaw);
    if (!target) return { ok: false, code: 'BAD_TARGET' };
    let body = String(text || '').trim().replace(/\s+/g, ' ').slice(0, 240);
    if (!body) {
      if (!isKantarTarget(target)) return { ok: false, code: 'BAD_TEXT' };
      body = DEFAULT_NUDGE_TEXT;
    }
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
      fromKey: nudgeTarget(fromKey) || '',
      text: body,
      ts: t,
      ackAt: null,
    };
    last.set(target, nudge);
    return { ok: true, nudge };
  }

  function pending(site, sinceTs) {
    const target = inboxKeyFromUsername(site);
    const n = last.get(target);
    if (!n || n.ackAt) return null;
    const t = clock();
    if (t - n.ts > NUDGE_TTL_MS) return null;
    const since = Number(sinceTs) || 0;
    if (since && n.ts <= since) return null;
    return n;
  }

  /** Kantar "Tamam" dedi: yalnız kendi tesisinin son çağrısı onaylanır. */
  function ack(site, id) {
    const target = inboxKeyFromUsername(site);
    const n = last.get(target);
    if (!n || !id || n.id !== String(id)) return { ok: false, code: 'NOT_FOUND' };
    if (!n.ackAt) n.ackAt = clock();
    return { ok: true, nudge: n };
  }

  function status() {
    const out = {};
    NUDGE_TARGETS.forEach((target) => {
      out[target] = last.get(target) || null;
    });
    return out;
  }

  return { send, pending, ack, status };
}

module.exports = {
  NUDGE_TARGETS,
  KANTAR_TARGETS,
  NUDGE_TTL_MS,
  NUDGE_COOLDOWN_MS,
  DEFAULT_NUDGE_TEXT,
  normalizeTarget,
  siteFromUsername,
  nudgeTarget,
  inboxKeyFromUsername,
  isKantarTarget,
  isTargetOnline,
  createNudgeStore,
};
