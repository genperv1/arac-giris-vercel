'use strict';

const test = require('node:test');
const assert = require('node:assert');
const gate = require('../public/liman-gate');

test('LimanGate accepts only gnp / gp1451', () => {
  assert.equal(gate.checkLogin('gnp', 'gp1451'), true);
  assert.equal(gate.checkLogin(' GNP ', ' gp1451 '), true);
  assert.equal(gate.checkLogin('GNP', 'gp1451'), true);
  assert.equal(gate.checkLogin('gnp', 'wrong'), false);
  assert.equal(gate.checkLogin('admin', 'gp1451'), false);
  assert.equal(gate.checkLogin('', ''), false);
});
