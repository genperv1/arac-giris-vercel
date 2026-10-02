'use strict';

const KEEP_MS = 14 * 24 * 60 * 60 * 1000;
const MAX_ITEMS = 80;

function clip(value, max) {
  return String(value == null ? '' : value).replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function noticeIdOk(value) {
  return /^[a-zA-Z0-9_-]{8,80}$/.test(String(value || ''));
}

function usernameKey(value) {
  return String(value || '').trim().toLowerCase().slice(0, 80);
}

function clientKey(value) {
  const id = String(value || '').trim().toLowerCase();
  if (!/^[a-z0-9_-]{8,32}$/.test(id)) return '';
  return id;
}

function ackStorageKey(username, clientId) {
  const user = usernameKey(username);
  if (!user) return '';
  const client = clientKey(clientId);
  return client ? user + '|' + client : user;
}

function normalizeAckKey(key) {
  const raw = String(key || '').trim().toLowerCase();
  const pipe = raw.indexOf('|');
  if (pipe === -1) return usernameKey(raw);
  const user = usernameKey(raw.slice(0, pipe));
  const client = clientKey(raw.slice(pipe + 1));
  if (!user || !client) return '';
  return user + '|' + client;
}

function istanbulParts(ts) {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Istanbul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const map = {};
  fmt.formatToParts(new Date(ts)).forEach((part) => {
    map[part.type] = part.value;
  });
  return map;
}

function istanbulStamp(ts, now) {
  const when = Number(ts);
  const tsNow = Number(now) || Date.now();
  if (!Number.isFinite(when)) return '';
  const at = istanbulParts(when);
  const today = istanbulParts(tsNow);
  if (!at.hour || !at.minute) return '';
  const hm = at.hour + ':' + at.minute;
  if (at.year === today.year && at.month === today.month && at.day === today.day) return hm;
  return at.day + '.' + at.month + '.' + at.year + ' ' + hm;
}

function girisNoticeText(notice, now) {
  const plate = clip(notice && notice.plate, 40);
  if (!plate) return '';
  const firma = clip(notice && notice.firma, 160);
  const clock = istanbulStamp(notice && notice.ts, now);
  let text = plate + ' plakalı araç giriş yaptı.';
  if (firma) text += ' Firma: ' + firma + '.';
  if (clock) text += ' ' + clock;
  return text;
}

function sanitizeGirisNotices(list, now) {
  const tsNow = Number(now) || Date.now();
  const cutoff = tsNow - KEEP_MS;
  const out = [];
  const seen = new Set();
  const arr = Array.isArray(list) ? list : [];
  for (let i = 0; i < arr.length; i++) {
    const raw = arr[i];
    if (!raw || typeof raw !== 'object') continue;
    const id = String(raw.id || '').trim();
    if (!noticeIdOk(id) || seen.has(id)) continue;
    const plate = clip(raw.plate, 40);
    if (!plate) continue;
    const ts = Number(raw.ts);
    if (!Number.isFinite(ts) || ts < cutoff || ts > tsNow + 60000) continue;
    const ackedBy = {};
    const src = raw.ackedBy && typeof raw.ackedBy === 'object' ? raw.ackedBy : {};
    Object.keys(src).forEach((key) => {
      const stored = normalizeAckKey(key);
      const at = Number(src[key]);
      if (!stored || !Number.isFinite(at) || at <= 0) return;
      ackedBy[stored] = Math.round(at);
    });
    seen.add(id);
    out.push({
      id,
      plate,
      firma: clip(raw.firma, 160),
      malzeme: clip(raw.malzeme, 160),
      ts: Math.round(ts),
      ackedBy,
    });
  }
  return out.slice(-MAX_ITEMS);
}

function appendGirisNotice(items, raw, now) {
  const tsNow = Number(now) || Date.now();
  const id = String(raw && raw.id || '').trim();
  const plate = clip(raw && raw.plate, 40);
  if (!noticeIdOk(id) || !plate) return { items: sanitizeGirisNotices(items, tsNow), notice: null };
  const notice = {
    id,
    plate,
    firma: clip(raw && raw.firma, 160),
    malzeme: clip(raw && raw.malzeme, 160),
    ts: tsNow,
    ackedBy: {},
  };
  const next = sanitizeGirisNotices(items, tsNow).concat([notice]);
  return { items: sanitizeGirisNotices(next, tsNow), notice };
}

function isAcked(item, username, clientId) {
  const user = usernameKey(username);
  if (!user) return true;
  const ackedBy = item && item.ackedBy;
  if (!ackedBy) return false;
  if (ackedBy[user]) return true;
  const client = clientKey(clientId);
  return !!(client && ackedBy[user + '|' + client]);
}

function unreadGirisNotices(items, username, now, clientId) {
  if (!usernameKey(username)) return [];
  const tsNow = Number(now) || Date.now();
  return sanitizeGirisNotices(items, tsNow)
    .filter((item) => !isAcked(item, username, clientId))
    .sort((a, b) => a.ts - b.ts)
    .map((item) => ({
      id: item.id,
      plate: item.plate,
      firma: item.firma,
      malzeme: item.malzeme,
      ts: item.ts,
      text: girisNoticeText(item, tsNow),
    }));
}

function ackGirisNotice(items, id, username, now, clientId) {
  const mark = ackStorageKey(username, clientId);
  const key = String(id || '').trim();
  const tsNow = Number(now) || Date.now();
  const clean = sanitizeGirisNotices(items, tsNow);
  if (!mark || !noticeIdOk(key)) return { items: clean, ok: false };
  let found = false;
  const next = clean.map((item) => {
    if (item.id !== key) return item;
    found = true;
    const ackedBy = Object.assign({}, item.ackedBy);
    ackedBy[mark] = tsNow;
    return Object.assign({}, item, { ackedBy });
  });
  return { items: next, ok: found };
}

module.exports = {
  girisNoticeText,
  sanitizeGirisNotices,
  appendGirisNotice,
  unreadGirisNotices,
  ackGirisNotice,
};
