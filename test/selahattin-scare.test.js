const test = require('node:test');
const assert = require('node:assert/strict');
const { createScareNotices, claimScareOnce } = require('../lib/selahattin-scare');

test('sunucu açılışında bir kez planlanır, 1 dk arayla yalnız xxr görür', () => {
  const timers = [];
  let clock = 1_000_000;
  const scare = createScareNotices({
    setTimeout: (fn, ms) => {
      timers.push({ fn, ms });
      return timers.length;
    },
    now: () => clock,
    firstDelayMs: 15000,
    intervalMs: 60000,
  });
  const emitted = [];
  assert.equal(scare.start((notice) => emitted.push(notice)), true);
  assert.equal(scare.start(() => {}), false);
  assert.equal(timers.length, 18);
  assert.equal(timers[0].ms, 15000);
  assert.equal(timers[1].ms, 75000);
  assert.equal(timers[17].ms, 15000 + 17 * 60000);

  timers[0].fn();
  clock += 60000;
  timers[1].fn();
  assert.equal(emitted.length, 2);
  assert.notEqual(emitted[0].plate, emitted[1].plate);
  assert.match(emitted[0].firma, /NOVATEK/);
  assert.match(emitted[0].firma, /sistem tarafından engellendi/);
  assert.equal(emitted[0].kind, 'scare');

  assert.equal(scare.unread('saban', 'clientaaaaaaa1').length, 0);
  assert.equal(scare.unread('xxr', 'clientaaaaaaa1').length, 2);
  assert.equal(scare.ack(emitted[0].id, 'xxr', 'clientaaaaaaa1'), true);
  assert.equal(scare.unread('xxr', 'clientaaaaaaa1').length, 1);
  assert.equal(scare.unread('xxr', 'clientbbbbbbb2').length, 2);
  assert.equal(scare.ack(emitted[0].id, 'saban', 'clientaaaaaaa1'), false);
});

test('varsayılan ilk bildirim sunucu açılışından 7,5 dakika sonra', () => {
  const timers = [];
  const scare = createScareNotices({
    setTimeout: (fn, ms) => {
      timers.push(ms);
      return timers.length;
    },
  });
  assert.equal(scare.start(() => {}), true);
  assert.equal(timers[0], 7.5 * 60 * 1000);
  assert.equal(timers[1] - timers[0], 60000);
});

test('yeniden başlamada bildirim dizisi tekrar kurulmaz', async () => {
  const store = new Map();
  const q = async (sql, params) => {
    if (String(sql).includes('INSERT')) {
      const key = params[0];
      if (store.has(key)) return { rows: [] };
      store.set(key, params[1]);
      return { rows: [{ key }] };
    }
    return { rows: [] };
  };
  assert.equal(await claimScareOnce(q), true);
  assert.equal(await claimScareOnce(q), false);
  assert.equal(store.size, 1);
});
