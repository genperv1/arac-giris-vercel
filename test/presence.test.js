'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPresence, ONLINE_WINDOW_MS } = require('../lib/presence');

test('AVDAN, 1.OSB ve amir çevrimiçi / çevrimdışı görünür', () => {
  let now = 1000000;
  const p = createPresence(() => now);
  p.touch({ username: 'AVDAN', role: 'admin' });
  p.touch({ username: 'xxr', role: 'amir' });
  let snap = p.snapshot();
  assert.deepEqual(snap.map((s) => [s.label, s.online]), [['AVDAN', true], ['1.OSB', false], ['SELAHATTİN', true], ['ŞABAN', false], ['UĞUR', false]]);

  p.touch({ username: 'saban', role: 'amir' });
  p.touch({ username: 'ugur', role: 'amir' });
  snap = p.snapshot();
  assert.equal(snap[2].online, true);
  assert.equal(snap[3].online, true);
  assert.equal(snap[4].label, 'UĞUR');
  assert.equal(snap[4].online, true);

  now += ONLINE_WINDOW_MS + 1;
  p.touch({ username: '1.OSB', role: 'admin' });
  snap = p.snapshot();
  assert.deepEqual(snap.map((s) => s.online), [false, true, false, false, false]);
  assert.ok(snap[0].lastSeen);

  p.remove('1.OSB');
  assert.equal(p.snapshot()[1].online, false);
});
