'use strict';

const KV_KEY = 'takipPrintLayout_v1';
const MAX_BYTES = 512 * 1024;

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function emptyLayout() {
  return { fields: {}, fieldStyles: {}, styles: {}, samples: {} };
}

function isPlainObject(v) {
  return v != null && typeof v === 'object' && !Array.isArray(v);
}

function sanitizeLayout(raw) {
  if (!isPlainObject(raw)) {
    const err = new Error('Geçersiz düzen verisi');
    err.status = 400;
    throw err;
  }

  const out = {
    fields: isPlainObject(raw.fields) ? deepClone(raw.fields) : {},
    fieldStyles: isPlainObject(raw.fieldStyles) ? deepClone(raw.fieldStyles) : {},
    styles: isPlainObject(raw.styles) ? deepClone(raw.styles) : {},
    samples: isPlainObject(raw.samples) ? deepClone(raw.samples) : {},
    updatedAt: Number(raw.updatedAt) || Date.now(),
  };

  const json = JSON.stringify(out);
  if (json.length > MAX_BYTES) {
    const err = new Error('Düzen verisi çok büyük');
    err.status = 400;
    throw err;
  }

  return out;
}

async function getPrintLayoutRecord(q) {
  const r = await q('SELECT value FROM kv_store WHERE key = $1', [KV_KEY]);
  if (!r.rows[0]) return null;
  try {
    const parsed = JSON.parse(r.rows[0].value);
    if (!isPlainObject(parsed)) return null;
    return sanitizeLayout(parsed);
  } catch (_) {
    return null;
  }
}

async function setPrintLayout(q, raw) {
  const layout = sanitizeLayout(raw);
  await q(
    `INSERT INTO kv_store(key, value)
     VALUES($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [KV_KEY, JSON.stringify(layout)]
  );
  return layout;
}

async function clearPrintLayout(q) {
  await q('DELETE FROM kv_store WHERE key = $1', [KV_KEY]);
}

module.exports = {
  KV_KEY,
  emptyLayout,
  sanitizeLayout,
  getPrintLayoutRecord,
  setPrintLayout,
  clearPrintLayout,
};
