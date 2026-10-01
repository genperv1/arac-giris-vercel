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

function girisNoticeText(notice) {
  const plate = clip(notice && notice.plate, 40);
  const firma = clip(notice && notice.firma, 160);
  if (plate && firma) return plate + ' plakalı araç ' + firma + ' firmasına giriş yaptı.';
  if (plate) return plate + ' plakalı araç giriş yaptı.';
  return '';
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
      const user = usernameKey(key);
      const at = Number(src[key]);
      if (!user || !Number.isFinite(at) || at <= 0) return;
      ackedBy[user] = Math.round(at);
    });
    seen.add(id);
    out.push({
      id,
      plate,
      firma: clip(raw.firma, 160),
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
    ts: tsNow,
    ackedBy: {},
  };
  const next = sanitizeGirisNotices(items, tsNow).concat([notice]);
  return { items: sanitizeGirisNotices(next, tsNow), notice };
}

function unreadGirisNotices(items, username, now) {
  const user = usernameKey(username);
  if (!user) return [];
  return sanitizeGirisNotices(items, now)
    .filter((item) => !item.ackedBy[user])
    .sort((a, b) => a.ts - b.ts)
    .map((item) => ({
      id: item.id,
      plate: item.plate,
      firma: item.firma,
      ts: item.ts,
      text: girisNoticeText(item),
    }));
}

function ackGirisNotice(items, id, username, now) {
  const user = usernameKey(username);
  const key = String(id || '').trim();
  const tsNow = Number(now) || Date.now();
  const clean = sanitizeGirisNotices(items, tsNow);
  if (!user || !noticeIdOk(key)) return { items: clean, ok: false };
  let found = false;
  const next = clean.map((item) => {
    if (item.id !== key) return item;
    found = true;
    const ackedBy = Object.assign({}, item.ackedBy);
    ackedBy[user] = tsNow;
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
