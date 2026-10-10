'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createMailboxStore } = require('../lib/mailbox-store');
const { planReminders, tickMailReminders, STALE_MS } = require('../lib/mail-reminders');

const DAY = new Date('2026-10-10T06:00:00.000Z');
const NIGHT = new Date('2026-10-09T22:00:00.000Z');
const EVENING = new Date('2026-10-10T16:00:00.000Z');
const QUIET = new Date('2026-10-10T19:30:00.000Z');

function limanToday() {
  return { sites: { AVDAN: { fileName: '10.10.2026.xlsx', blocks: [] } } };
}

test('gündüz vardiyasında bugünkü sevkiyat kantara gider, piyasa tazeyse Şaban’a gitmez', () => {
  const plans = planReminders({
    now: DAY,
    liman: limanToday(),
    piyasa: { excelUpdatedAt: new Date(DAY.getTime() - 30 * 60 * 1000).toISOString() },
    sent: {},
  });
  assert.deepEqual(plans.map((item) => item.to.join(',')), ['AVDAN,1.OSB']);
  assert.equal(plans[0].subject, 'Listeyi güncelle');
  assert.match(plans[0].text, /Listeyi güncelle/);
});

test('sevkiyat yoksa kantar susar; gece vardiyası ayrı anahtar kullanır', () => {
  const none = planReminders({ now: NIGHT, liman: { sites: {} }, piyasa: {}, sent: {} });
  assert.equal(none.some((item) => item.key.startsWith('kantar:')), false);
  const night = planReminders({
    now: NIGHT,
    ihracat: { fileName: '10.10.2026 sevkiyat.xlsx' },
    piyasa: { excelUpdatedAt: new Date().toISOString() },
    sent: {},
  });
  assert.equal(night[0].key, 'kantar:2026-10-10:gece');
  const again = planReminders({
    now: NIGHT,
    ihracat: { fileName: '10.10.2026 sevkiyat.xlsx' },
    sent: { 'kantar:2026-10-10:gece': 1 },
  });
  assert.equal(again.length, 0);
});

test('Şaban’a sabah ve akşam birer kez, liste tazeyse hiç', () => {
  const stale = { excelUpdatedAt: new Date(DAY.getTime() - STALE_MS - 1000).toISOString() };
  const morning = planReminders({ now: DAY, piyasa: stale, sent: {} });
  assert.equal(morning.some((item) => item.key === 'saban:2026-10-10:sabah'), true);
  assert.match(morning.find((item) => item.to[0] === 'SABAN').text, /1 saatte bir güncelle/);
  const fresh = planReminders({
    now: DAY,
    piyasa: { excelUpdatedAt: new Date(DAY.getTime() - 20 * 60 * 1000).toISOString() },
    sent: {},
  });
  assert.equal(fresh.some((item) => item.key.startsWith('saban:')), false);
  const evening = planReminders({ now: EVENING, piyasa: {}, sent: { 'saban:2026-10-10:sabah': 1 } });
  assert.equal(evening.some((item) => item.key === 'saban:2026-10-10:aksam'), true);
  const gap = planReminders({ now: QUIET, piyasa: {}, liman: limanToday(), sent: {} });
  assert.equal(gap.some((item) => item.key.startsWith('saban:')), false);
  assert.equal(gap.some((item) => item.key.startsWith('kantar:')), false);
});

test('sistem mesajı kantarda görünür, başkasında görünmez, kullanıcı sistem adına yazamaz', async () => {
  const kv = {};
  const q = async (sql, params) => {
    const text = String(sql);
    if (text.startsWith('SELECT')) {
      const key = params[0];
      return { rows: kv[key] ? [{ value: kv[key] }] : [] };
    }
    kv[params[0]] = params[1];
    return { rows: [] };
  };
  kv.liman_state_v1 = JSON.stringify(limanToday());
  kv.piyasa_state_v1 = JSON.stringify({ excelUpdatedAt: '2026-10-01T08:00:00.000Z' });
  const seen = [];
  const store = createMailboxStore({ now: () => DAY.getTime(), id: (() => { let n = 0; return () => 'm' + (++n); })() });
  const opened = await tickMailReminders({
    q,
    store,
    now: DAY,
    broadcastToUsers: (type, data, keys) => seen.push({ type, from: data.from, keys }),
  });
  assert.deepEqual(opened.sort(), ['kantar:2026-10-10:gunduz', 'saban:2026-10-10:sabah']);
  const kantar = store.list('AVDAN');
  assert.equal(kantar.threads.length, 1);
  assert.equal(kantar.threads[0].from, 'SISTEM');
  assert.equal(kantar.unread, 1);
  assert.equal(store.list('UGUR').threads.length, 0);
  assert.equal(store.list('SABAN').threads[0].messages[0].text.includes('1 saatte bir'), true);
  assert.equal(store.open('AVDAN', ['1.OSB'], 'konu', 'ben sistemim').thread.from, 'AVDAN');
  assert.equal(store.open('SISTEM', ['AVDAN'], 'konu', 'sahte').code, 'BAD_FROM');
  assert.equal(seen.some((row) => row.keys[0] === 'AVDAN' && row.from === 'SISTEM'), true);
  assert.equal(seen.some((row) => row.keys[0] === 'SABAN'), true);
  assert.equal(seen.some((row) => row.keys[0] === 'SISTEM'), false);
  const again = await tickMailReminders({ q, store, now: DAY, broadcastToUsers: () => {} });
  assert.deepEqual(again, []);
});
