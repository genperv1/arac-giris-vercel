'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const notes = fs.readFileSync(path.join(__dirname, '../public/vardiya-notes.js'), 'utf8');
const page = fs.readFileSync(path.join(__dirname, '../public/vardiya-notlari.html'), 'utf8');
const server = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');

test('silme parolası tarayıcı kaynağında durmaz', () => {
  assert.equal(notes.includes('DELETE_PASSWORD'), false);
  assert.equal(notes.includes('543723'), false);
  assert.match(notes, /payload\.password = String\(pw\)/);
  assert.match(notes, /credentials: 'include'/);
});

test('vardiya sayfası dar ekranda tek sütun ve dokunma yüksekliği kullanır', () => {
  assert.match(page, /viewport/);
  assert.match(page, /max-width: 640px/);
  assert.match(page, /min-height: 44px/);
  assert.match(page, /grid-cols-1/);
});

test('not yazma, düzenleme ve silme oturum ister ve sorgu parametrelidir', () => {
  const start = server.indexOf("api.get('/operation-notes'");
  const end = server.indexOf("api.post(\"/restore-full\"");
  const block = server.slice(start, end);
  assert.match(block, /api\.get\('\/operation-notes', requireValidSession/);
  assert.match(block, /api\.post\('\/operation-notes', requireValidSession/);
  assert.match(block, /api\.patch\('\/operation-notes\/:id', requireValidSession/);
  assert.match(block, /api\.delete\('\/operation-notes\/:id', requireValidSession/);
  assert.match(block, /shiftNoteDeletePasswordOk/);
  assert.match(block, /requestHasAmirSession/);
  assert.equal(block.includes('body.author_username'), false);
  assert.match(block, /WHERE id = \$1/);
  assert.equal(block.includes('${id}'), false);
});
