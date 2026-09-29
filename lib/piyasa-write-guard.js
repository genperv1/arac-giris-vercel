'use strict';

const USAGE_FIELDS = new Set([
  'usedAt',
  'usedPlate',
  'printCount',
  'lastPrintAt',
  'lastPrintPlate',
  'printPlates',
]);

function stripUsage(order) {
  if (!order || typeof order !== 'object' || Array.isArray(order)) return null;
  const out = {};
  Object.keys(order).sort().forEach((key) => {
    if (USAGE_FIELDS.has(key)) return;
    const value = order[key];
    if (value && typeof value === 'object') out[key] = JSON.stringify(value);
    else out[key] = value == null ? '' : value;
  });
  return out;
}

function archiveBlock(block) {
  const b = block && typeof block === 'object' ? block : {};
  return {
    week: b.week ?? null,
    sheet: b.sheet ?? '',
    sheetDate: b.sheetDate ?? null,
    sheetDateRaw: b.sheetDateRaw ?? null,
    orders: (Array.isArray(b.orders) ? b.orders : []).map(stripUsage),
  };
}

function catalogSnapshot(payload) {
  const p = payload && typeof payload === 'object' ? payload : {};
  return JSON.stringify({
    week: p.week ?? null,
    sheet: p.sheet ?? null,
    loadedAt: p.loadedAt ?? null,
    sheetDate: p.sheetDate ?? null,
    sheetDateRaw: p.sheetDateRaw ?? null,
    fileFingerprint: p.fileFingerprint ?? null,
    orders: (Array.isArray(p.orders) ? p.orders : []).map(stripUsage),
    weekArchive: (Array.isArray(p.weekArchive) ? p.weekArchive : []).map(archiveBlock),
  });
}

/** Excel yükleme, silme veya sipariş listesini değiştirme. Baskı sayacı tek başına katalog değildir. */
function isPiyasaCatalogWrite(prev, next) {
  return catalogSnapshot(prev) !== catalogSnapshot(next);
}

module.exports = { isPiyasaCatalogWrite, catalogSnapshot };
