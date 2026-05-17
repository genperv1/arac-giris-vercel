'use strict';

const test = require('node:test');
const assert = require('node:assert');

test('production dependencies load', () => {
  assert.ok(typeof require('compression') === 'function');
  assert.ok(typeof require('helmet') === 'function');
});

test('report-events module exists', () => {
  const fs = require('fs');
  const path = require('path');
  const p = path.join(__dirname, '..', 'public', 'modules', 'report-events.js');
  assert.ok(fs.existsSync(p));
});

test('tailwind build output exists', () => {
  const fs = require('fs');
  const path = require('path');
  const p = path.join(__dirname, '..', 'public', 'tailwind-built.css');
  assert.ok(fs.existsSync(p), 'Run npm run build:css to generate public/tailwind-built.css');
  const st = fs.statSync(p);
  assert.ok(st.size > 5000, 'tailwind-built.css looks too small');
});
