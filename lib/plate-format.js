/**
 * Turkish + foreign (EU / international) plate validation (server + tests).
 * TR: 34 ABC 1234, 34ABC1234, 06 AA 1234, ...
 * Foreign: B 807 SEL, BG1234AB, etc. (letters + digits, 4–20 chars)
 */

const TR_PLATE_RE = /^[0-9]{2}\s*[A-ZÇĞİÖŞÜ]{1,3}\s*[0-9]{1,5}$/i;

function isTurkishPlate(plate) {
  if (!plate) return false;
  return TR_PLATE_RE.test(String(plate).trim());
}

function isForeignPlate(plate) {
  if (!plate) return false;
  const s = String(plate).trim();
  if (s.length < 4 || s.length > 20) return false;
  if (!/^[A-Z0-9\s\-]+$/i.test(s)) return false;
  const compact = s.replace(/[\s\-]+/g, '');
  if (compact.length < 4 || compact.length > 15) return false;
  if (!/[A-Z]/i.test(compact) || !/[0-9]/.test(compact)) return false;
  return true;
}

function validatePlateFormat(plate) {
  if (!plate) return true;
  const s = String(plate).trim();
  return isTurkishPlate(s) || isForeignPlate(s);
}

const PLATE_FIELD_KEYS = ['plaka', 'cekiciPlaka', 'dorsePlaka', 'dorse', 'dorse_plaka', 'plate', 'lastPrintPlate'];

/** Kayıt ve paylaşımda kullanılacak plaka: boşluksuz, büyük harf. */
function compactPlate(plate) {
  if (plate == null) return '';
  return String(plate)
    .replace(/İ/g, 'I')
    .replace(/ı/g, 'I')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

function compactRecordPlates(record, nested) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return record;
  const out = Object.assign({}, record);
  PLATE_FIELD_KEYS.forEach((key) => {
    if (out[key] != null && String(out[key]).trim() !== '') {
      out[key] = compactPlate(out[key]);
    }
  });
  if (!nested) {
    if (out.snapshot && typeof out.snapshot === 'object' && !Array.isArray(out.snapshot)) {
      out.snapshot = compactRecordPlates(out.snapshot, true);
    }
    if (out.lastPrintSnapshot && typeof out.lastPrintSnapshot === 'object' && !Array.isArray(out.lastPrintSnapshot)) {
      out.lastPrintSnapshot = compactRecordPlates(out.lastPrintSnapshot, true);
    }
  }
  return out;
}

function formatForeignPlateDisplay(plate) {
  return compactPlate(plate);
}

module.exports = {
  validatePlateFormat,
  isTurkishPlate,
  isForeignPlate,
  formatForeignPlateDisplay,
  compactPlate,
  compactRecordPlates,
};
