'use strict';

const crypto = require('crypto');

const KV_KEY = 'liman_gozetmen_v1';
const SLOT_COUNT = 7;
const PERIOD_MS = 40 * 24 * 60 * 60 * 1000;
const SELAHATTIN = 'xxr';
const LETTERS = 'abcdefghjkmnpqrstuvwxyz';
const ID_RE = /^[a-z]{4}$/;
const PASSWORD_RE = /^[a-z]{2}\d{4}$/;

function clip(value, max) {
  return String(value == null ? '' : value).replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function clipPhone(value) {
  return String(value == null ? '' : value).replace(/[^\d+\s()-]/g, '').replace(/\s+/g, ' ').trim().slice(0, 20);
}

function labelOf(n) {
  return 'Gözetmen ' + n;
}

function blankState() {
  const slots = [];
  for (let n = 1; n <= SLOT_COUNT; n++) {
    slots.push({ n, ad: '', soyad: '', telefon: '', loginId: '', password: '', issuedAt: 0 });
  }
  return { slots, issuedAt: 0, noticePending: false, noticeAckedAt: 0 };
}

function sanitizeState(raw) {
  const base = blankState();
  const src = raw && typeof raw === 'object' ? raw : {};
  const byN = {};
  const list = Array.isArray(src.slots) ? src.slots : [];
  list.forEach((row) => {
    const n = Number(row && row.n);
    if (n >= 1 && n <= SLOT_COUNT) byN[n] = row;
  });
  base.slots = base.slots.map((slot) => {
    const row = byN[slot.n] || {};
    return {
      n: slot.n,
      ad: clip(row.ad, 40),
      soyad: clip(row.soyad, 40),
      telefon: clipPhone(row.telefon),
      loginId: clip(row.loginId, 12).toLowerCase(),
      password: clip(row.password, 12).toLowerCase(),
      issuedAt: Number(row.issuedAt) || 0,
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

function needsRotate(state, now) {
  const ts = Number(now) || Date.now();
  if (!state.issuedAt || state.slots.length !== SLOT_COUNT) return true;
  if (state.slots.some((slot) => !ID_RE.test(slot.loginId) || !PASSWORD_RE.test(slot.password))) return true;
  return ts - state.issuedAt >= PERIOD_MS;
}

function rotate(state, now, randomInt) {
  const ts = Number(now) || Date.now();
  const usedIds = new Set();
  const usedPasswords = new Set();
  state.slots.forEach((slot) => {
    slot.loginId = uniqueCode(usedIds, () => makeLoginId(randomInt));
    slot.password = uniqueCode(usedPasswords, () => makePassword(randomInt));
    slot.issuedAt = ts;
  });
  state.issuedAt = ts;
  state.noticePending = true;
  state.noticeAckedAt = 0;
  return state;
}

/** Süresi dolmuşsa yedi hesabın ID ve şifresini birlikte yeniler. */
function prepareState(raw, now, randomInt) {
  const state = sanitizeState(raw);
  const ts = Number(now) || Date.now();
  if (!needsRotate(state, ts)) return { state, changed: false };
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
  return { n: slot.n, label: labelOf(slot.n), loginId: slot.loginId, issuedAt: state.issuedAt };
}

function applyProfiles(state, incoming) {
  const list = Array.isArray(incoming) ? incoming : [];
  list.forEach((row) => {
    const n = Number(row && row.n);
    const slot = state.slots.find((item) => item.n === n);
    if (!slot) return;
    if (row.ad != null) slot.ad = clip(row.ad, 40);
    if (row.soyad != null) slot.soyad = clip(row.soyad, 40);
    if (row.telefon != null) slot.telefon = clipPhone(row.telefon);
  });
  return state;
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
      n: slot.n,
      label: labelOf(slot.n),
      ad: slot.ad,
      soyad: slot.soyad,
      telefon: slot.telefon,
      loginId: slot.loginId,
      password: slot.password,
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

module.exports = {
  KV_KEY,
  SLOT_COUNT,
  PERIOD_MS,
  SELAHATTIN,
  labelOf,
  sanitizeState,
  prepareState,
  matchLogin,
  applyProfiles,
  amirView,
  ackNotice,
  isSelahattin,
  makeLoginId,
  makePassword,
};
