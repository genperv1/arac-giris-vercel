'use strict';

function parsePrintHistoryTs(raw) {
  let ms = Date.now();
  if (raw !== null && raw !== undefined && raw !== '') {
    const n = Number(raw);
    if (Number.isFinite(n)) ms = n;
    else {
      const parsedMs = Date.parse(String(raw));
      if (!Number.isNaN(parsedMs)) ms = parsedMs;
    }
  }
  return ms;
}

function parseSnapshot(raw) {
  if (!raw) return null;
  try {
    const snap = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!snap || typeof snap !== 'object') return null;
    return snap;
  } catch (_) {
    return null;
  }
}

function pickFilled(obj, keys) {
  if (!obj) return '';
  for (let i = 0; i < keys.length; i++) {
    const v = obj[keys[i]];
    if (v != null && String(v).trim() !== '') return String(v).trim();
  }
  return '';
}

function parseReportsListQuery(query) {
  const q = query || {};
  const slim = q.slim === '1' || String(q.slim || '').toLowerCase() === 'true';
  const since = Number(q.since);
  const until = Number(q.until);
  return {
    slim,
    since: Number.isFinite(since) && since > 0 ? Math.trunc(since) : 0,
    until: Number.isFinite(until) && until > 0 ? Math.trunc(until) : 0,
  };
}

function extractPrintOverlay(row, snap) {
  const pickSnap = (...keys) => pickFilled(snap, keys);
  const amb = pickSnap('ambalajBilgisi', 'ambalaj', 'yuklemeTuru') || (row && row.yukleme_turu) || '';
  const note = pickSnap('yuklemeNotu', 'baskiNotu', 'not');
  return {
    plaka: pickSnap('plaka') || (row && row.plaka) || '',
    firma: pickSnap('firma', 'firmaKodu', 'firmaSelect') || (row && row.firma) || '',
    firmaKodu: pickSnap('firmaKodu', 'firma', 'firmaSelect') || (row && row.firma) || '',
    firmaSelect: pickSnap('firmaSelect') || '',
    firmaAdi: pickSnap('firmaAdi', 'musteriAdi', 'customerName'),
    malzeme: pickSnap('malzeme') || (row && row.malzeme) || '',
    tonaj: pickSnap('tonaj') || (row && row.tonaj) || '',
    basimYeri: pickSnap('basimYeri') || (row && row.basim_yeri) || '',
    sevkiyat_id: (row && row.sevkiyat_id) || '',
    sofor: pickSnap('sofor') || (row && row.sofor) || '',
    sevkYeri: pickSnap('sevkYeri') || (row && row.sevk_yeri) || '',
    yuklemeTuru: amb,
    ambalajBilgisi: amb,
    ambalaj: amb,
    yuklemeNotu: note,
    baskiNotu: note,
    yuklemeSirasi: pickSnap('yuklemeSirasi'),
    seperatorBilgisi: pickSnap('seperatorBilgisi'),
    bbt: pickSnap('bbt'),
    bosBbt: pickSnap('bosBbt'),
    cuval: pickSnap('cuval'),
    bosCuval: pickSnap('bosCuval'),
    palet: pickSnap('palet'),
    torba: pickSnap('torba'),
    kantar: pickSnap('kantar', 'imzaKantarAd'),
    iletisim: pickSnap('iletisim') || (row && row.iletisim) || '',
    tcKimlik: pickSnap('tcKimlik') || (row && row.tc_kimlik) || '',
    dorsePlaka: pickSnap('dorsePlaka') || (row && row.dorse_plaka) || '',
    cekiciPlaka: pickSnap('cekiciPlaka'),
    vehicleId: pickSnap('vehicleId', 'vehicle_id') || (row && row.vehicle_id) || '',
    headerText: pickSnap('headerText'),
    lotNo: pickSnap('lotNo', 'lotLabel'),
    excelFileName: pickSnap('excelFileName', 'fileName'),
    fileName: pickSnap('fileName', 'excelFileName'),
    ydKey: pickSnap('ydKey'),
  };
}

function mapPrintHistoryRowToReport(row, opts) {
  const slim = !!(opts && opts.slim);
  const snap = parseSnapshot(row && row.snapshot);
  const overlay = extractPrintOverlay(row || {}, snap);
  const data = slim ? overlay : Object.assign({}, snap || {}, overlay);
  return {
    id: row && row.id,
    type: 'PRINT',
    data,
    snapshot: slim ? null : snap,
    ts: parsePrintHistoryTs(row && row.tarih),
    kantar: data.kantar || '',
    malzeme: data.malzeme || '',
    sevkYeri: data.sevkYeri || '',
    firma: data.firma || data.firmaKodu || data.firmaSelect || '',
  };
}

module.exports = {
  parsePrintHistoryTs,
  parseSnapshot,
  parseReportsListQuery,
  extractPrintOverlay,
  mapPrintHistoryRowToReport,
};
