const test = require('node:test');
const assert = require('node:assert/strict');
const {
  girisNoticeText,
  appendGirisNotice,
  unreadGirisNotices,
  ackGirisNotice,
} = require('../lib/amir-giris-notice');

test('bildirim metni plaka ve firma söyler', () => {
  assert.equal(
    girisNoticeText({ plate: '30 ABE 500', firma: 'ŞEMES GIDA' }),
    '30 ABE 500 plakalı araç ŞEMES GIDA firmasına giriş yaptı.'
  );
});

test('okunmamış bildirim girişte durur, Tamam deyince o kullanıcıda biter', () => {
  const now = Date.parse('2026-10-01T12:00:00+03:00');
  const saved = appendGirisNotice([], {
    id: 'notice-m24-01',
    plate: '30 ABE 500',
    firma: 'ŞEMES GIDA',
  }, now);
  assert.equal(saved.notice.plate, '30 ABE 500');
  const pending = unreadGirisNotices(saved.items, 'xxr', now);
  assert.equal(pending.length, 1);
  assert.match(pending[0].text, /30 ABE 500 plakalı araç ŞEMES GIDA firmasına giriş yaptı/);
  const acked = ackGirisNotice(saved.items, pending[0].id, 'XXR', now + 1000);
  assert.equal(acked.ok, true);
  assert.equal(unreadGirisNotices(acked.items, 'xxr', now + 1000).length, 0);
  assert.equal(unreadGirisNotices(acked.items, 'diger', now + 1000).length, 1);
});
