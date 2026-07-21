'use strict';

const test = require('node:test');
const assert = require('node:assert');
const {
  sanitizeLayout,
  emptyLayout,
} = require('../lib/print-layout-store');

test('sanitizeLayout accepts minimal layout object', () => {
  const out = sanitizeLayout({
    fields: { firma: { left: 1, top: 2, w: 3, h: 4 } },
    fieldStyles: {},
    styles: {},
    samples: { firma: 'TEST' },
  });
  assert.ok(out.fields.firma);
  assert.strictEqual(out.samples.firma, 'TEST');
  assert.ok(Number.isFinite(out.updatedAt));
});

test('sanitizeLayout rejects non-object', () => {
  assert.throws(() => sanitizeLayout(null), /Geçersiz/);
});

test('emptyLayout has expected keys', () => {
  const out = emptyLayout();
  assert.deepStrictEqual(Object.keys(out).sort(), ['fieldStyles', 'fields', 'samples', 'styles']);
});
