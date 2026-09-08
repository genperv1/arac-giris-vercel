'use strict';

const test = require('node:test');
const assert = require('node:assert');
const {
  isAcceptablePrintFormBg,
  getPrintFormBgBuffer,
  resolveLocalBgFilePath,
} = require('../lib/print-form-bg-store');

test('file kind is acceptable when local template exists', () => {
  const local = resolveLocalBgFilePath();
  if (!local) {
    assert.strictEqual(isAcceptablePrintFormBg({ kind: 'file', data: '' }), false);
    return;
  }
  assert.strictEqual(isAcceptablePrintFormBg({ kind: 'file', data: '' }), true);
});

test('svg and builtin records stay unacceptable', () => {
  assert.strictEqual(isAcceptablePrintFormBg({ kind: 'svg', data: 'data:image/svg+xml;base64,xx' }), false);
  assert.strictEqual(isAcceptablePrintFormBg({ kind: 'base64', data: 'data:image/png;base64,xx', source: 'builtin' }), false);
});

test('getPrintFormBgBuffer prefers local file and does not need DB', async () => {
  const image = await getPrintFormBgBuffer(async () => {
    throw new Error('db should not be read');
  });
  const local = resolveLocalBgFilePath();
  if (local) {
    assert.ok(image);
    assert.ok(image.buffer && image.buffer.length > 64);
    assert.match(image.contentType, /^image\//);
  } else {
    assert.strictEqual(image, null);
  }
});
