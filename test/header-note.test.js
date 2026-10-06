'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  readHeaderNoteItems,
  assignHeaderNoteAuthors,
  headerNotePayload,
} = require('../lib/header-note');

test('eski düz metin notları son kaydeden amire bağlanır', () => {
  const raw = JSON.stringify({
    notes: ['K18 aracına yüklenecek', 'F serisinden irsaliye'],
    text: 'K18 aracına yüklenecek',
    updatedBy: 'saban',
  });
  assert.deepEqual(readHeaderNoteItems(raw), [
    { text: 'K18 aracına yüklenecek', author: 'saban' },
    { text: 'F serisinden irsaliye', author: 'saban' },
  ]);
});

test('değişmeyen satır eski amirde kalır, yeni satır kaydedene yazılır', () => {
  const previous = [
    { text: 'K18 aracına yüklenecek', author: 'saban' },
    { text: 'Eski not', author: 'xxr' },
  ];
  const next = assignHeaderNoteAuthors(
    ['K18 aracına yüklenecek', 'F serisinden irsaliye'],
    previous,
    'ugur'
  );
  assert.deepEqual(next, [
    { text: 'K18 aracına yüklenecek', author: 'saban' },
    { text: 'F serisinden irsaliye', author: 'ugur' },
  ]);
});

test('metni değiştiren amir o satırın sahibi olur', () => {
  const next = assignHeaderNoteAuthors(
    ['K18 yerine K19'],
    [{ text: 'K18 aracına yüklenecek', author: 'saban' }],
    'xxr'
  );
  assert.deepEqual(next, [{ text: 'K18 yerine K19', author: 'xxr' }]);
});

test('kayıt hem metin listesini hem yazarları döner', () => {
  const payload = headerNotePayload(
    [{ text: 'Not', author: 'ugur' }],
    'ugur',
    10
  );
  assert.deepEqual(payload.notes, [{ text: 'Not', author: 'ugur' }]);
  assert.deepEqual(payload.authors, ['ugur']);
  assert.equal(payload.text, 'Not');
  assert.equal(payload.updatedBy, 'ugur');
});
