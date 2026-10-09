'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

test('liman giriş kapısı şifreyi tarayıcıda tutmaz, sunucuya sorar', () => {
  const src = fs.readFileSync(path.join(__dirname, '../public/liman-gate.js'), 'utf8');
  assert.match(src, /\/api\/liman\/gate/);
  assert.match(src, /\/api\/me/);
  assert.match(src, /hasAppSession/);
  assert.doesNotMatch(src, /gp1451/);
  assert.doesNotMatch(src, /checkLogin/);
  const page = fs.readFileSync(path.join(__dirname, '../public/liman.html'), 'utf8');
  assert.match(page, /ID ve şifre/);
  assert.match(page, /LimanGate\.login/);
  assert.match(page, /limanAccounts/);
  assert.match(page, /result === 'manage'/);
  assert.doesNotMatch(src, /1421/);
  assert.match(page, /hasAppSession/);
  assert.match(page, /\/api\/liman\/version/);
  assert.match(page, /liman-login-required/);
  assert.match(page, /id="limanGate"[^>]*hidden/);
  const liman = fs.readFileSync(path.join(__dirname, '../public/liman.js'), 'utf8');
  const startFn = liman.slice(liman.indexOf('function start()'), liman.indexOf('window.LimanPage'));
  assert.doesNotMatch(startFn, /isUnlocked/);
  assert.match(liman, /liman-login-required/);
  assert.doesNotMatch(liman, /isUnlocked\(\)\) start\(\)/);
});
