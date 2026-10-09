'use strict';

const crypto = require('crypto');

const KV_KEY = 'liman_gozetmen_v1';
const GATE_COOKIE = 'liman_gate';
const GATE_PURPOSE = 'liman-gate';
const GATE_MAX_AGE_MS = 12 * 60 * 60 * 1000;
const GOZETMEN_COUNT = 7;
const SIRKET_COUNT = 5;
const SLOT_COUNT = GOZETMEN_COUNT;
const PERIOD_MS = 40 * 24 * 60 * 60 * 1000;
const SELAHATTIN = 'xxr';
const LETTERS = 'abcdefghjkmnpqrstuvwxyz';
const DEFINED_ID_RE = /^[a-z0-9]{3,12}$/;
const DEFINED_PW_RE = /^[a-z0-9]{4,12}$/;

function clip(value, max) {
  return String(value == null ? '' : value).replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function clipPhone(value) {
  return String(value == null ? '' : value).replace(/[^\d+\s()-]/g, '').replace(/\s+/g, ' ').trim().slice(0, 20);
}

function grupOf(value) {
  return value === 'sirket' ? 'sirket' : 'gozetmen';
}

function countOf(grup) {
  return grupOf(grup) === 'sirket' ? SIRKET_COUNT : GOZETMEN_COUNT;
}

function labelOf(slotOrN, grup) {
  if (slotOrN && typeof slotOrN === 'object') {
    const g = grupOf(slotOrN.grup);
    const n = slotOrN.n;
    return g === 'sirket' ? ('Yetkili ' + n) : ('Gözetmen ' + n);
  }
  return grupOf(grup) === 'sirket' ? ('Yetkili ' + slotOrN) : ('Gözetmen ' + slotOrN);
}

function blankSlot(grup, n) {
  return { grup, n, ad: '', soyad: '', telefon: '', loginId: '', password: '', issuedAt: 0, loginCount: 0, lastLoginAt: 0 };
}

function blankState() {
  const slots = [];
  for (let n = 1; n <= GOZETMEN_COUNT; n++) slots.push(blankSlot('gozetmen', n));
  for (let n = 1; n <= SIRKET_COUNT; n++) slots.push(blankSlot('sirket', n));
  return { slots, issuedAt: 0, noticePending: false, noticeAckedAt: 0 };
}

function sanitizeState(raw) {
  const base = blankState();
  const src = raw && typeof raw === 'object' ? raw : {};
  const byKey = {};
  const list = Array.isArray(src.slots) ? src.slots : [];
  list.forEach((row) => {
    const grup = grupOf(row && row.grup);
    const n = Number(row && row.n);
    if (n >= 1 && n <= countOf(grup)) byKey[grup + ':' + n] = row;
  });
  base.slots = base.slots.map((slot) => {
    const row = byKey[slot.grup + ':' + slot.n] || {};
    return {
      grup: slot.grup,
      n: slot.n,
      ad: clip(row.ad, 40),
      soyad: clip(row.soyad, 40),
      telefon: clipPhone(row.telefon),
      loginId: clip(row.loginId, 12).toLowerCase(),
      password: clip(row.password, 12).toLowerCase(),
      issuedAt: Number(row.issuedAt) || 0,
      loginCount: Math.max(0, Math.trunc(Number(row.loginCount) || 0)),
      lastLoginAt: Number(row.lastLoginAt) || 0,
    };
  });
  base.issuedAt = Number(src.issuedAt) || 0;
  base.noticePending = src.noticePending === true;
  base.noticeAckedAt = Number(src.noticeAckedAt) || 0;
  return base;
}

function roll(randomInt, span) {
  const fn = typeof randomInt === 'function' ? randomInt : (n) => crypto.randomInt(n);
  const n = Number(fn(span));
  if (!Number.isFinite(n)) return 0;
  const size = Math.max(1, span);
  return ((Math.trunc(n) % size) + size) % size;
}

function makeLoginId(randomInt) {
  let id = '';
  for (let i = 0; i < 4; i++) id += LETTERS[roll(randomInt, LETTERS.length)];
  return id;
}

function makePassword(randomInt) {
  const a = LETTERS[roll(randomInt, LETTERS.length)];
  const b = LETTERS[roll(randomInt, LETTERS.length)];
  const n = String(roll(randomInt, 10000)).padStart(4, '0');
  return a + b + n;
}

function uniqueCode(used, factory) {
  let code = '';
  for (let i = 0; i < 40; i++) {
    code = factory();
    if (code && !used.has(code)) break;
  }
  used.add(code);
  return code;
}

function gozetmenSlots(state) {
  return state.slots.filter((slot) => slot.grup === 'gozetmen');
}

function needsRotate(state) {
  const rows = gozetmenSlots(state);
  if (rows.length !== GOZETMEN_COUNT) return true;
  return rows.every((slot) => !slot.loginId && !slot.password);
}

function rotate(state, now, randomInt) {
  const ts = Number(now) || Date.now();
  const usedIds = new Set();
  const usedPasswords = new Set();
  state.slots.forEach((slot) => {
    if (slot.grup !== 'gozetmen') return;
    slot.loginId = uniqueCode(usedIds, () => makeLoginId(randomInt));
    slot.password = uniqueCode(usedPasswords, () => makePassword(randomInt));
    slot.issuedAt = ts;
    slot.loginCount = 0;
    slot.lastLoginAt = 0;
  });
  state.issuedAt = ts;
  state.noticePending = true;
  state.noticeAckedAt = 0;
  return state;
}

/** Gözetmen hesapları boşsa bir kez ID ve şifre üretir. Selahattin’in yazdığı hesaplar durur. */
function prepareState(raw, now, randomInt) {
  const state = sanitizeState(raw);
  const ts = Number(now) || Date.now();
  if (!needsRotate(state)) return { state, changed: false };
  return { state: rotate(state, ts, randomInt), changed: true };
}

function foldUser(value) {
  return String(value == null ? '' : value)
    .trim()
    .toLocaleLowerCase('tr-TR')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ş/g, 's')
    .replace(/ı/g, 'i')
    .replace(/i̇/g, 'i')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c')
    .replace(/[^a-z0-9]/g, '');
}

function sameSecret(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  if (!left.length || left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function matchLogin(state, username, password) {
  const id = foldUser(username);
  if (!id) return null;
  const slot = state.slots.find((row) => foldUser(row.loginId) === id);
  if (!slot || !slot.password) return null;
  const pass = foldUser(password);
  if (!sameSecret(slot.password, pass)) return null;
  return { n: slot.n, grup: slot.grup, label: labelOf(slot), loginId: slot.loginId, issuedAt: state.issuedAt };
}

function findSlot(slots, row) {
  const grup = grupOf(row && row.grup);
  const n = Number(row && row.n);
  return slots.find((item) => item.grup === grup && item.n === n);
}

function applyProfiles(state, incoming) {
  const list = Array.isArray(incoming) ? incoming : [];
  list.forEach((row) => {
    const slot = findSlot(state.slots, row);
    if (!slot) return;
    if (row.ad != null) slot.ad = clip(row.ad, 40);
    if (row.soyad != null) slot.soyad = clip(row.soyad, 40);
    if (row.telefon != null) slot.telefon = clipPhone(row.telefon);
  });
  return state;
}

function recordLogin(state, hit, now) {
  const slot = state.slots.find((row) => row.grup === hit.grup && row.n === hit.n);
  if (!slot) return false;
  slot.loginCount = (Number(slot.loginCount) || 0) + 1;
  slot.lastLoginAt = Number(now) || Date.now();
  return true;
}

function amirView(state, now) {
  const ts = Number(now) || Date.now();
  const issuedAt = Number(state.issuedAt) || 0;
  return {
    ok: true,
    periodDays: 40,
    issuedAt,
    nextAt: issuedAt ? issuedAt + PERIOD_MS : 0,
    noticePending: state.noticePending === true,
    slots: state.slots.map((slot) => ({
      grup: slot.grup,
      n: slot.n,
      label: labelOf(slot),
      ad: slot.ad,
      soyad: slot.soyad,
      telefon: slot.telefon,
      loginId: slot.loginId,
      password: slot.password,
      loginCount: Number(slot.loginCount) || 0,
      lastLoginAt: Number(slot.lastLoginAt) || 0,
    })),
    serverNow: ts,
  };
}

function ackNotice(state, issuedAt, now) {
  if (Number(issuedAt) !== Number(state.issuedAt)) return { state, changed: false };
  if (!state.noticePending) return { state, changed: false };
  state.noticePending = false;
  state.noticeAckedAt = Number(now) || Date.now();
  return { state, changed: true };
}

function isSelahattin(user) {
  return String((user && user.username) || '').trim().toLowerCase() === SELAHATTIN;
}

function isLimanAdminUsername(username) {
  return foldUser(username) === SELAHATTIN;
}

/** Selahattin’in yazdığı ID ve şifre. İkisi de boşsa hesap giriş yapamaz. Ad ve telefona dokunmaz. */
function applyCredentials(state, incoming, now) {
  const list = Array.isArray(incoming) ? incoming : [];
  if (!list.length) return { state, changed: false, error: 'Hesap listesi boş.' };
  const ts = Number(now) || Date.now();
  const next = state.slots.map((slot) => Object.assign({}, slot));
  const touched = new Set();
  for (const row of list) {
    if (row && row.loginId == null && row.password == null) continue;
    const slot = findSlot(next, row);
    const key = slot ? (slot.grup + ':' + slot.n) : '';
    if (!slot || touched.has(key)) return { state, changed: false, error: 'Geçersiz hesap.' };
    touched.add(key);
    const loginId = foldUser(row.loginId);
    const password = foldUser(row.password);
    if (!loginId && !password) {
      slot.loginId = '';
      slot.password = '';
      slot.issuedAt = 0;
      slot.loginCount = 0;
      slot.lastLoginAt = 0;
      continue;
    }
    const label = labelOf(slot);
    if (!DEFINED_ID_RE.test(loginId)) {
      return { state, changed: false, error: label + ' için ID 3 ile 12 harf veya rakam olmalı.' };
    }
    if (loginId === SELAHATTIN) {
      return { state, changed: false, error: 'xxr ID’si hesap tanımlamasına ayrıldı.' };
    }
    if (!DEFINED_PW_RE.test(password)) {
      return { state, changed: false, error: label + ' için şifre 4 ile 12 harf veya rakam olmalı.' };
    }
    if (slot.loginId !== loginId || slot.password !== password) {
      slot.loginCount = 0;
      slot.lastLoginAt = 0;
    }
    slot.loginId = loginId;
    slot.password = password;
    slot.issuedAt = ts;
  }
  const filled = next.filter((slot) => slot.loginId || slot.password);
  const ids = filled.map((slot) => slot.loginId);
  const passwords = filled.map((slot) => slot.password);
  if (ids.some((id) => !id) || passwords.some((password) => !password)) {
    return { state, changed: false, error: 'ID ve şifre birlikte yazılır.' };
  }
  if (new Set(ids).size !== ids.length) return { state, changed: false, error: 'Her hesabın ID’si ayrı olmalı.' };
  if (new Set(passwords).size !== passwords.length) return { state, changed: false, error: 'Her hesabın şifresi ayrı olmalı.' };
  state.slots = next;
  state.issuedAt = ts;
  state.noticePending = false;
  return { state, changed: true };
}

module.exports = {
  KV_KEY,
  GATE_COOKIE,
  GATE_PURPOSE,
  GATE_MAX_AGE_MS,
  SLOT_COUNT,
  GOZETMEN_COUNT,
  SIRKET_COUNT,
  PERIOD_MS,
  SELAHATTIN,
  labelOf,
  sanitizeState,
  prepareState,
  matchLogin,
  recordLogin,
  applyProfiles,
  amirView,
  ackNotice,
  isSelahattin,
  isLimanAdminUsername,
  applyCredentials,
  makeLoginId,
  makePassword,
};
