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

test('menu and pages wire AraclarGate', () => {
  const auth = fs.readFileSync(path.join(__dirname, '../public/modules/app-auth.js'), 'utf8');
  assert.match(auth, /AraclarGate\.ensureAccess/);
  assert.match(auth, /İş Merkezi şifresini/);
  assert.match(auth, /Liste kopyala şifresini/);

  const giris = fs.readFileSync(path.join(__dirname, '../public/GIRIS.html'), 'utf8');
  assert.match(giris, /araclar-gate\.js/);

  const im = fs.readFileSync(path.join(__dirname, '../public/is-merkezi.html'), 'utf8');
  assert.match(im, /araclar-gate\.js/);
  assert.match(im, /AraclarGate\.ensureAccess/);

  const elc = fs.readFileSync(path.join(__dirname, '../public/liste-kopyala.html'), 'utf8');
  assert.match(elc, /araclar-gate\.js/);
  assert.match(elc, /AraclarGate\.ensureAccess/);

  const desk = fs.readFileSync(path.join(__dirname, '../public/liste-kopyala-desktop.html'), 'utf8');
  assert.match(desk, /543723/);
  assert.match(desk, /Liste kopyala şifresini/);
});
