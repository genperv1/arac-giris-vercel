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

test('app modular bundles exist', () => {
  const fs = require('fs');
  const path = require('path');
  const dir = path.join(__dirname, '..', 'public', 'modules');
  for (const name of [
    'app-core.js',
    'app-ui-forms-pick.js',
    'app-ui-forms-takip.js',
    'app-ui-utils.js',
    'app-ihracat-modal.js',
    'app-ihracat-print.js',
    'piyasa-globals.js',
    'piyasa-core.js',
    'piyasa-api.js',
    'print-main.js',
  ]) {
    assert.ok(fs.existsSync(path.join(dir, name)), `missing ${name}`);
  }
});

test('tailwind build output exists', () => {
  const fs = require('fs');
  const path = require('path');
  const p = path.join(__dirname, '..', 'public', 'tailwind-built.css');
  assert.ok(fs.existsSync(p), 'Run npm run build:css to generate public/tailwind-built.css');
  const st = fs.statSync(p);
  assert.ok(st.size > 5000, 'tailwind-built.css looks too small');
});
