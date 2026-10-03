'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveSecret, warnIfDefaultSecret } = require('../lib/env');

test('resolveSecret production olmadan fallback kullanır', () => {
  const prevNode = process.env.NODE_ENV;
  const prev = process.env.JWT_SECRET;
  process.env.NODE_ENV = 'test';
  delete process.env.JWT_SECRET;
  try {
    assert.equal(resolveSecret('JWT_SECRET', { fallback: 'dev_secret_change_me', forbidden: ['dev_secret_change_me'] }), 'dev_secret_change_me');
  } finally {
    if (prev === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = prev;
    process.env.NODE_ENV = prevNode;
  }
});

test('resolveSecret production + yasaklı değerde durur', () => {
  const prevNode = process.env.NODE_ENV;
  const prev = process.env.JWT_SECRET;
  process.env.NODE_ENV = 'production';
  process.env.JWT_SECRET = 'dev_secret_change_me';
  try {
    assert.throws(
      () => resolveSecret('JWT_SECRET', { fallback: 'dev_secret_change_me', forbidden: ['dev_secret_change_me'] }),
      /JWT_SECRET/
    );
  } finally {
    if (prev === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = prev;
    process.env.NODE_ENV = prevNode;
  }
});

test('resolveSecret production + eksik secret deriveFrom ile çökmeden türetir', () => {
  const prevNode = process.env.NODE_ENV;
  const prev = process.env.JWT_SECRET;
  process.env.NODE_ENV = 'production';
  delete process.env.JWT_SECRET;
  try {
    const a = resolveSecret('JWT_SECRET', { fallback: 'dev_secret_change_me', forbidden: ['dev_secret_change_me'], deriveFrom: 'postgres://x' });
    const b = resolveSecret('JWT_SECRET', { fallback: 'dev_secret_change_me', forbidden: ['dev_secret_change_me'], deriveFrom: 'postgres://x' });
    assert.equal(a, b);
    assert.notEqual(a, 'dev_secret_change_me');
    assert.equal(a.length, 64);
  } finally {
    if (prev === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = prev;
    process.env.NODE_ENV = prevNode;
  }
});

test('warnIfDefaultSecret yalnız production varsayılanında true', () => {
  const prevNode = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    assert.equal(warnIfDefaultSecret('SETTINGS_ACCESS_PASSWORD', '543723', '543723'), true);
    assert.equal(warnIfDefaultSecret('SETTINGS_ACCESS_PASSWORD', 'other', '543723'), false);
  } finally {
    process.env.NODE_ENV = prevNode;
  }
});
