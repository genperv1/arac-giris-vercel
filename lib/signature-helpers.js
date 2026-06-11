'use strict';

function signatureRowToSrc(row) {
  if (!row || !row.image_data) return '';
  if (row.image_kind === 'path') {
    const p = String(row.image_data || '').trim();
    return p.startsWith('/') ? p : `/${p}`;
  }
  const raw = String(row.image_data || '').trim();
  if (raw.startsWith('data:')) return raw;
  return `data:image/png;base64,${raw}`;
}

module.exports = { signatureRowToSrc };
