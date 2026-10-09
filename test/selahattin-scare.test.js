const test = require('node:test');
const assert = require('node:assert/strict');
const {
  FIRST_DELAY_MS,
  INTERVAL_MS,
  dueCount,
  unreadFromState,
  ensureScareStarted,
  unreadScareNotices,
  ackScareNotice,
} = require('../lib/selahattin-scare');

function memoryDb() {
  const rows = new Map();
  const q = async (sql, params) => {
    const text = String(sql);
    const key = params[0];
    if (text.includes('SELECT')) {
      if (!rows.has(key)) return { rows: [] };
      return { rows: [{ value: rows.get(key) }] };
    }
    if (text.includes('DO NOTHING')) {
      if (!rows.has(key)) rows.set(key, params[1]);
      return { rows: [] };
    }
    rows.set(key, params[1]);
    return { rows: [] };
  };
  return { q, rows };
}

test('ilk bildirim açılıştan 2 dk sonra, sonra 3 sn arayla', () => {
  assert.equal(FIRST_DELAY_MS, 2 * 60 * 1000);
  assert.equal(INTERVAL_MS, 3 * 1000);
  const start = 1_000_000;
  assert.equal(dueCount(start, start + FIRST_DELAY_MS - 1), 0);
  assert.equal(dueCount(start, start + FIRST_DELAY_MS), 1);
  assert.equal(dueCount(start, start + FIRST_DELAY_MS + INTERVAL_MS), 2);
  assert.equal(dueCount(start, start + FIRST_DELAY_MS + 30 * INTERVAL_MS), 18);
  const one = unreadFromState({ startedAt: start, acked: {} }, 'xxr', 'clientaaaaaaa1', start + FIRST_DELAY_MS);
  const two = unreadFromState({ startedAt: start, acked: {} }, 'xxr', 'clientaaaaaaa1', start + FIRST_DELAY_MS + INTERVAL_MS);
  assert.equal(one.length, 1);
  assert.equal(two.length, 2);
  assert.notEqual(two[0].plate, two[1].plate);
  assert.match(two[0].text, /sistem tarafından engellendi/);
  assert.equal(unreadFromState({ startedAt: start, acked: {} }, 'saban', 'clientaaaaaaa1', start + FIRST_DELAY_MS).length, 0);
});

test('süreç yeniden kalkınca aynı saatten devam eder, diziyi baştan kurmaz', async () => {
  const db = memoryDb();
  const startedAt = Date.now() - (FIRST_DELAY_MS + INTERVAL_MS);
  const first = await ensureScareStarted(db.q, startedAt);
  const again = await ensureScareStarted(db.q, Date.now());
  assert.equal(again.startedAt, first.startedAt);
  const pending = await unreadScareNotices(db.q, 'xxr', 'clientaaaaaaa1', startedAt + FIRST_DELAY_MS + INTERVAL_MS);
  assert.equal(pending.length, 2);
  assert.equal(await ackScareNotice(db.q, pending[0].id, 'xxr', 'clientaaaaaaa1', Date.now()), true);
  const left = await unreadScareNotices(db.q, 'xxr', 'clientaaaaaaa1', startedAt + FIRST_DELAY_MS + INTERVAL_MS);
  assert.equal(left.length, 1);
  assert.equal(await unreadScareNotices(db.q, 'xxr', 'clientbbbbbbb2', startedAt + FIRST_DELAY_MS + INTERVAL_MS).then((rows) => rows.length), 2);
});
