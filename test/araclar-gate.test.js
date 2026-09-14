'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const gate = require('../public/araclar-gate');

test('AraclarGate accepts only 543723', () => {
  assert.equal(gate.checkPassword('543723'), true);
  assert.equal(gate.checkPassword(' 543723 '), true);
  assert.equal(gate.checkPassword('wrong'), false);
  assert.equal(gate.checkPassword(''), false);
});

test('only İhracat Takip hub asks password; children check unlock', () => {
  const auth = fs.readFileSync(path.join(__dirname, '../public/modules/app-auth.js'), 'utf8');
  assert.match(auth, /ihracat-takip\.html/);
  assert.doesNotMatch(auth, /İhracat Takip şifresini/);

  const giris = fs.readFileSync(path.join(__dirname, '../public/GIRIS.html'), 'utf8');
  assert.match(giris, /araclar-gate\.js/);
  assert.match(giris, /styles\.css\?v=1\.0\.31/);

  const hub = fs.readFileSync(path.join(__dirname, '../public/ihracat-takip.html'), 'utf8');
  assert.match(hub, /ihtGateForm|ihtGatePwd/);
  assert.match(hub, /markUnlocked|checkPassword/);
  assert.match(hub, /iht-radar/);
  assert.match(hub, /iht-radar__sweep/);
  assert.doesNotMatch(hub, /visibility\s*=\s*'hidden'/);

  const im = fs.readFileSync(path.join(__dirname, '../public/is-merkezi.html'), 'utf8');
  assert.match(im, /araclar-gate\.js/);
  assert.match(im, /AraclarGate\.isUnlocked/);
  assert.doesNotMatch(im, /ensureAccess/);

  const elc = fs.readFileSync(path.join(__dirname, '../public/liste-kopyala.html'), 'utf8');
  assert.match(elc, /araclar-gate\.js/);
  assert.match(elc, /AraclarGate\.isUnlocked/);
  assert.doesNotMatch(elc, /ensureAccess/);

  const plan = fs.readFileSync(path.join(__dirname, '../public/plan-v4.html'), 'utf8');
  assert.match(plan, /AraclarGate\.isUnlocked/);
  assert.doesNotMatch(plan, /ensureAccess/);

  const sayi = fs.readFileSync(path.join(__dirname, '../public/sayi-kontrol.html'), 'utf8');
  assert.match(sayi, /AraclarGate\.isUnlocked/);
  assert.doesNotMatch(sayi, /ensureAccess/);

  const desk = fs.readFileSync(path.join(__dirname, '../public/liste-kopyala-desktop.html'), 'utf8');
  assert.match(desk, /543723/);
  assert.match(desk, /Liste kopyala şifresini/);

  const session = fs.readFileSync(path.join(__dirname, '../public/session-manager.js'), 'utf8');
  assert.match(session, /ihracat-takip\.html/);

  const menu = fs.readFileSync(path.join(__dirname, '../public/modules/app-ui-forms-takip.js'), 'utf8');
  assert.match(menu, /iht-radar__sweep/);
});
