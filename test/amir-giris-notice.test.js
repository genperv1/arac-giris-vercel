const test = require('node:test');
const assert = require('node:assert/strict');
const {
  girisNoticeText,
  appendGirisNotice,
  unreadGirisNotices,
  ackGirisNotice,
} = require('../lib/amir-giris-notice');

test('bildirim metni plaka, firma ve saati söyler', () => {
  const now = Date.parse('2026-10-01T12:00:00+03:00');
  assert.equal(
    girisNoticeText({ plate: '30 ABE 500', firma: 'ŞEMES GIDA', ts: now }, now),
    '30 ABE 500 plakalı araç giriş yaptı. Firma: ŞEMES GIDA. 12:00'
  );
  const yesterday = now - 24 * 60 * 60 * 1000;
  assert.equal(
    girisNoticeText({ plate: '30 ABE 500', firma: 'ŞEMES GIDA', ts: yesterday }, now),
    '30 ABE 500 plakalı araç giriş yaptı. Firma: ŞEMES GIDA. 30.09.2026 12:00'
  );
});

test('okunmamış bildirim girişte durur, Tamam deyince o kullanıcıda biter', () => {
  const now = Date.parse('2026-10-01T12:00:00+03:00');
  const saved = appendGirisNotice([], {
    id: 'notice-m24-01',
    plate: '30 ABE 500',
    firma: 'ŞEMES GIDA',
    malzeme: 'HP120',
  }, now);
  assert.equal(saved.notice.plate, '30 ABE 500');
  assert.equal(saved.notice.malzeme, 'HP120');
  const pending = unreadGirisNotices(saved.items, 'xxr', now);
  assert.equal(pending.length, 1);
  assert.equal(pending[0].malzeme, 'HP120');
  assert.equal(pending[0].text, '30 ABE 500 plakalı araç giriş yaptı. Firma: ŞEMES GIDA. 12:00');
  const acked = ackGirisNotice(saved.items, pending[0].id, 'XXR', now + 1000);
  assert.equal(acked.ok, true);
  assert.equal(unreadGirisNotices(acked.items, 'xxr', now + 1000).length, 0);
  assert.equal(unreadGirisNotices(acked.items, 'diger', now + 1000).length, 1);
});

test('aynı amir hesabı her bilgisayarda ayrı görür', () => {
  const now = Date.parse('2026-10-01T12:00:00+03:00');
  const saved = appendGirisNotice([], {
    id: 'notice-m24-02',
    plate: '30 ABE 500',
    firma: 'ŞEMES GIDA',
  }, now);
  const acked = ackGirisNotice(saved.items, saved.notice.id, 'xxr', now + 1000, 'bilgisayar1');
  assert.equal(unreadGirisNotices(acked.items, 'xxr', now + 1000, 'bilgisayar1').length, 0);
  assert.equal(unreadGirisNotices(acked.items, 'xxr', now + 1000, 'bilgisayar2').length, 1);
});
