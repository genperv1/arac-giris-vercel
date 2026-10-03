'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createDeviceTokenStore, parseRaw, sha256 } = require('../lib/device-tokens');
const { createFakeDeviceDb } = require('./helpers/fake-device-db');

function mkStore(opts) {
  const db = createFakeDeviceDb();
  let t = 1_700_000_000_000;
  const clock = { now: () => t, advance: (ms) => { t += ms; } };
  const store = createDeviceTokenStore(db.q, Object.assign({ days: 90, maxPerUser: 3, now: clock.now }, opts || {}));
  return { db, store, clock };
}

test('issue → verify: ham anahtar doğrulanır, DB\'de yalnız hash durur', async () => {
  const { db, store } = mkStore();
  const issued = await store.issue('AVDAN', { ip: '95.3.27.82', userAgent: 'Chrome', label: 'AVDAN kantar PC' });
  assert.ok(parseRaw(issued.raw));
  assert.equal(db.rows.length, 1);
  assert.notEqual(db.rows[0].token_hash, issued.raw);
  assert.equal(db.rows[0].token_hash, sha256(parseRaw(issued.raw).secret));
  const v = await store.verify(issued.raw);
  assert.equal(v.username, 'AVDAN');
  assert.equal(v.id, issued.id);
  assert.equal(v.expiresAt, issued.expiresAt);
});

test('yanlış secret / bozuk biçim / bilinmeyen id reddedilir', async () => {
  const { store } = mkStore();
  const issued = await store.issue('AVDAN');
  const { id } = parseRaw(issued.raw);
  assert.equal(await store.verify(id + '.' + 'x'.repeat(43)), null);
  assert.equal(await store.verify('garbage'), null);
  assert.equal(await store.verify(''), null);
  assert.equal(await store.verify('deadbeefdeadbeefdeadbeef.' + 'y'.repeat(43)), null);
});

test('iptal edilen ve süresi dolan anahtar geçersiz', async () => {
  const { store, clock } = mkStore({ days: 1 });
  const a = await store.issue('AVDAN');
  const b = await store.issue('1.OSB');
  assert.equal(await store.revoke(a.id), true);
  assert.equal(await store.revoke(a.id), false, 'ikinci iptal rowCount 0');
  assert.equal(await store.verify(a.raw), null);
  assert.ok(await store.verify(b.raw));
  clock.advance(24 * 60 * 60 * 1000 + 1);
  assert.equal(await store.verify(b.raw), null, 'süre doldu');
});

test('kullanıcı başına en fazla 3 aktif cihaz; en eskisi düşer', async () => {
  const { store, clock } = mkStore();
  const issued = [];
  for (let i = 0; i < 4; i++) {
    issued.push(await store.issue('AVDAN'));
    clock.advance(1000);
  }
  assert.equal(await store.verify(issued[0].raw), null, 'en eski iptal edildi');
  assert.ok(await store.verify(issued[1].raw));
  assert.ok(await store.verify(issued[3].raw));
  const list = await store.list();
  const active = list.filter((d) => d.active);
  assert.equal(active.length, 3);
  assert.equal(list.length, 4, 'iptal edilen son 30 günde listede kalır');
});

test('revokeAllForUser yalnız o kullanıcıyı düşürür; touch son kullanım/IP günceller', async () => {
  const { store, clock, db } = mkStore();
  const a = await store.issue('AVDAN', { ip: '1.1.1.1' });
  const o = await store.issue('1.OSB');
  clock.advance(5000);
  await store.touch(a.id, { ip: '2.2.2.2', userAgent: '' });
  const row = db.rows.find((r) => r.id === a.id);
  assert.equal(row.last_ip, '2.2.2.2');
  assert.equal(row.last_used_at, clock.now());
  assert.equal(await store.revokeAllForUser('AVDAN'), 1);
  assert.equal(await store.verify(a.raw), null);
  assert.ok(await store.verify(o.raw));
});
