'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

test('liman giriş kapısı şifreyi tarayıcıda tutmaz, sunucuya sorar', () => {
  const src = fs.readFileSync(path.join(__dirname, '../public/liman-gate.js'), 'utf8');
  assert.match(src, /\/api\/liman\/gate/);
  assert.doesNotMatch(src, /gp1451/);
  assert.doesNotMatch(src, /checkLogin/);
  const page = fs.readFileSync(path.join(__dirname, '../public/liman.html'), 'utf8');
  assert.match(page, /ID ve şifre/);
  assert.match(page, /LimanGate\.login/);
});
