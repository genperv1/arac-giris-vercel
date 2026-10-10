'use strict';

const { dateKeyFromFileName } = require('./liman-sheet');

const SENT_KEY = 'mail_reminders_v1';
const STALE_MS = 3 * 60 * 60 * 1000;

function istanbulParts(date) {
  const bag = {};
  new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Istanbul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date instanceof Date ? date : new Date(date)).forEach((part) => {
    bag[part.type] = part.value;
  });
  let hour = Number(bag.hour);
  if (hour === 24) hour = 0;
  return {
    year: bag.year,
    month: bag.month,
    day: bag.day,
    hour,
    minute: Number(bag.minute) || 0,
    dateKey: bag.year + '-' + bag.month + '-' + bag.day,
  };
}

function kantarShift(hour) {
  if (hour >= 0 && hour < 8) return 'gece';
  if (hour >= 8 && hour < 18) return 'gunduz';
  return '';
}

function sabanSlot(hour) {
  if (hour >= 8 && hour < 12) return 'sabah';
  if (hour >= 18 && hour < 22) return 'aksam';
  return '';
}

function namesInLiman(state) {
  const names = [];
  const sites = state && state.sites ? state.sites : {};
  Object.keys(sites).forEach((site) => {
    const snap = sites[site];
    if (!snap) return;
    if (snap.fileName) names.push(snap.fileName);
    (snap.blocks || []).forEach((block) => {
      if (block && block.fileName) names.push(block.fileName);
    });
    (snap.rows || []).forEach((row) => {
      if (row && row.fileName) names.push(row.fileName);
    });
  });
  return names;
}

function sevkiyatOnDay(liman, ihracat, dateKey) {
  const names = namesInLiman(liman);
  if (ihracat && ihracat.fileName) names.push(ihracat.fileName);
  return names.some((name) => dateKeyFromFileName(name) === dateKey);
}

function piyasaUpdatedMs(piyasa) {
  const raw = piyasa && piyasa.excelUpdatedAt;
  const t = Date.parse(raw);
  return Number.isFinite(t) ? t : 0;
}

function planReminders(input) {
  const now = input && input.now instanceof Date ? input.now : new Date(input && input.now);
  const sent = (input && input.sent) || {};
  const staleMs = Number(input && input.staleMs) || STALE_MS;
  const parts = istanbulParts(now);
  const out = [];
  const shift = kantarShift(parts.hour);
  if (shift && sevkiyatOnDay(input && input.liman, input && input.ihracat, parts.dateKey)) {
    const key = 'kantar:' + parts.dateKey + ':' + shift;
    if (!sent[key]) {
      out.push({
        key,
        to: ['AVDAN', '1.OSB'],
        subject: 'Listeyi güncelle',
        text: 'Bugün sevkiyat var. Listeyi güncelle.',
      });
    }
  }
  const slot = sabanSlot(parts.hour);
  if (slot) {
    const updated = piyasaUpdatedMs(input && input.piyasa);
    const stale = !updated || now.getTime() - updated >= staleMs;
    const key = 'saban:' + parts.dateKey + ':' + slot;
    if (stale && !sent[key]) {
      out.push({
        key,
        to: ['SABAN'],
        subject: 'Piyasa listesi',
        text: 'Piyasa listesi uzun süredir güncellenmedi. Listeyi 1 saatte bir güncelle.',
      });
    }
  }
  return out;
}

function pruneSent(sent, dateKey) {
  const keepFrom = String(dateKey || '').slice(0, 10);
  const out = {};
  Object.keys(sent || {}).forEach((key) => {
    const day = String(key).split(':')[1] || '';
    if (day && day >= addDays(keepFrom, -14)) out[key] = sent[key];
  });
  return out;
}

function addDays(dateKey, days) {
  const m = String(dateKey || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return dateKey;
  const dt = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days));
  const y = dt.getUTCFullYear();
  const mo = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const d = String(dt.getUTCDate()).padStart(2, '0');
  return y + '-' + mo + '-' + d;
}

async function readJson(q, key) {
  const r = await q('SELECT value FROM kv_store WHERE key = $1', [key]);
  const raw = r && r.rows && r.rows[0] && r.rows[0].value;
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (e) { return null; }
}

function fanOpened(store, broadcast, saved) {
  if (!saved || typeof broadcast !== 'function' || !store) return;
  const keys = (typeof store.audience === 'function' ? store.audience(saved) : []).filter((key) => key && key !== 'SISTEM');
  keys.forEach((key) => {
    const view = typeof store.present === 'function' ? store.present(saved, key) : saved;
    broadcast('mailbox_opened', view, [key]);
  });
}

async function tickMailReminders(opts) {
  const q = opts && opts.q;
  const store = opts && opts.store;
  if (typeof q !== 'function' || !store || typeof store.systemOpen !== 'function') return [];
  const now = opts.now instanceof Date ? opts.now : new Date();
  const [liman, ihracat, piyasa, sentRaw] = await Promise.all([
    readJson(q, 'liman_state_v1'),
    readJson(q, 'ihracat_excel_source_v1'),
    readJson(q, 'piyasa_state_v1'),
    readJson(q, SENT_KEY),
  ]);
  const sent = sentRaw && typeof sentRaw === 'object' ? sentRaw : {};
  const plans = planReminders({ now, liman, ihracat, piyasa, sent });
  const opened = [];
  for (let i = 0; i < plans.length; i += 1) {
    const item = plans[i];
    const result = await store.systemOpen(item.to, item.subject, item.text);
    if (!result || !result.ok) continue;
    sent[item.key] = now.getTime();
    fanOpened(store, opts.broadcastToUsers, result.saved || result.thread);
    opened.push(item.key);
  }
  if (opened.length) {
    const parts = istanbulParts(now);
    await q(
      `INSERT INTO kv_store(key, value) VALUES($1, $2)
       ON CONFLICT(key) DO UPDATE SET value = EXCLUDED.value`,
      [SENT_KEY, JSON.stringify(pruneSent(sent, parts.dateKey))],
    );
  }
  return opened;
}

module.exports = {
  SENT_KEY,
  STALE_MS,
  istanbulParts,
  kantarShift,
  sabanSlot,
  sevkiyatOnDay,
  planReminders,
  tickMailReminders,
};
