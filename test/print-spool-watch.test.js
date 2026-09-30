const test = require('node:test');
const assert = require('node:assert/strict');
const spool = require('../lib/print-spool-watch');

test('yazıcı kuyruğundaki belge adı jetonu taşır', () => {
  spool.resetForTests();
  spool.rememberDocument('Sevkiyat Formu TFABCD2345');
  assert.equal(spool.hasToken('TFABCD2345'), true);
  assert.equal(spool.hasToken('tfabcd2345'), true);
  assert.equal(spool.hasToken('TFZZZZZZZZ'), false);
  spool.resetForTests();
});

test('jeton formatı bozuksa görülmüş sayılmaz', () => {
  spool.resetForTests();
  spool.rememberDocument('Sevkiyat Formu');
  assert.equal(spool.hasToken(''), false);
  assert.equal(spool.hasToken('TF12'), false);
  spool.resetForTests();
});
