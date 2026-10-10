'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPresence, kantarSeenFromLiman, ONLINE_WINDOW_MS } = require('../lib/presence');

test('AVDAN, 1.OSB ve amir çevrimiçi / çevrimdışı görünür', () => {
  let now = 1000000;
  const p = createPresence(() => now);
  p.touch({ username: 'AVDAN', role: 'admin' });
  p.touch({ username: 'xxr', role: 'amir' });
  let snap = p.snapshot();
  assert.deepEqual(snap.map((s) => [s.label, s.online]), [['AVDAN', true], ['1.OSB', false], ['SELAHATTİN', true], ['ŞABAN', false], ['UĞUR', false], ['BURAK', false]]);

  p.touch({ username: 'saban', role: 'amir' });
  p.touch({ username: 'ugur', role: 'amir' });
  snap = p.snapshot();
  assert.equal(snap[2].online, true);
  assert.equal(snap[3].label, 'ŞABAN');
  assert.equal(snap[3].online, true);
  assert.equal(snap[4].label, 'UĞUR');
  assert.equal(snap[4].online, true);
  assert.equal(snap[5].label, 'BURAK');
  assert.equal(snap[5].online, false);

  now += ONLINE_WINDOW_MS + 1;
  p.touch({ username: '1.OSB', role: 'admin' });
  snap = p.snapshot();
  assert.deepEqual(snap.map((s) => s.online), [false, true, false, false, false, false]);
  assert.ok(snap[0].lastSeen);

  const avdanSeen = snap[0].lastSeen;
  p.remove('1.OSB');
  snap = p.snapshot();
  assert.equal(snap[1].online, false);
  assert.equal(snap[1].lastSeen, now);
  assert.equal(snap[0].lastSeen, avdanSeen);

  const again = createPresence(() => now);
  again.seed({ AVDAN: avdanSeen, '1.OSB': now });
  const seeded = again.snapshot();
  assert.equal(seeded[0].online, false);
  assert.equal(seeded[0].lastSeen, avdanSeen);
  assert.equal(seeded[1].lastSeen, now);
  assert.deepEqual(again.kantarSeen(), { AVDAN: avdanSeen, '1.OSB': now });
});

test('kantar saati liman nabzı ile liste gelişinden yenisini alır', () => {
  const seen = kantarSeenFromLiman({
    heartbeats: {
      AVDAN: { at: '2026-10-10T02:50:05+03:00' },
      '1.OSB': { at: '2026-10-10T02:42:18+03:00' },
    },
    sites: {
      AVDAN: { receivedAt: '2026-10-10T00:42:03+03:00' },
      '1.OSB': { updatedAt: '2026-10-10T03:10:00+03:00' },
    },
  });
  assert.equal(seen.AVDAN, Date.parse('2026-10-10T02:50:05+03:00'));
  assert.equal(seen['1.OSB'], Date.parse('2026-10-10T03:10:00+03:00'));
  assert.deepEqual(kantarSeenFromLiman(null), {});
});

test('Selahattin, Burak ve Şaban 08:00–19:00 İstanbul saatinde sürekli çevrimiçi görünür', () => {
  const at = (h, m) => Date.parse(`2026-10-07T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00+03:00`);
  let now = at(10, 15);
  const p = createPresence(() => now);
  let snap = p.snapshot();
  assert.equal(snap[2].key, 'AMIR');
  assert.equal(snap[2].online, true);
  assert.equal(snap[3].key, 'SABAN');
  assert.equal(snap[3].online, true);
  assert.equal(snap[5].key, 'BURAK');
  assert.equal(snap[5].online, true);
  assert.equal(snap[0].online, false);
  assert.equal(snap[1].online, false);
  assert.equal(snap[4].online, false);

  now = at(8, 0);
  snap = p.snapshot();
  assert.equal(snap[2].online, true);
  assert.equal(snap[3].online, true);
  assert.equal(snap[5].online, true);

  now = at(7, 59);
  snap = p.snapshot();
  assert.equal(snap[2].online, false);
  assert.equal(snap[3].online, false);
  assert.equal(snap[5].online, false);

  now = at(19, 0);
  snap = p.snapshot();
  assert.equal(snap[2].online, false);
  assert.equal(snap[3].online, false);
  assert.equal(snap[5].online, false);

  now = at(20, 30);
  p.touch({ username: 'xxr', role: 'amir' });
  p.touch({ username: 'burak', role: 'amir' });
  snap = p.snapshot();
  assert.equal(snap[2].online, true);
  assert.equal(snap[5].online, true);
  assert.equal(snap[3].online, false);
});

test('Cumartesi ve pazar Şaban ile Selahattin’in tatilidir, Burak programda kalır', () => {
  const at = (day, h) => Date.parse(`2026-10-${String(day).padStart(2, '0')}T${String(h).padStart(2, '0')}:15:00+03:00`);
  let now = at(10, 10);
  const p = createPresence(() => now);
  let snap = p.snapshot();
  assert.equal(snap[2].online, false);
  assert.equal(snap[3].online, false);
  assert.equal(snap[5].online, true);

  now = at(11, 12);
  snap = p.snapshot();
  assert.equal(snap[2].online, false);
  assert.equal(snap[3].online, false);
  assert.equal(snap[5].online, true);

  now = at(12, 10);
  snap = p.snapshot();
  assert.equal(snap[2].online, true);
  assert.equal(snap[3].online, true);
  assert.equal(snap[5].online, true);

  now = at(10, 11);
  p.touch({ username: 'xxr', role: 'amir' });
  p.touch({ username: 'saban', role: 'amir' });
  snap = p.snapshot();
  assert.equal(snap[2].online, true);
  assert.equal(snap[3].online, true);
});
