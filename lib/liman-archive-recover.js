'use strict';

const { fileLabelOf } = require('./liman-sheet');

function clip(value, max) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max);
}

function plateOf(snap) {
  return clip(snap && (snap.plaka || snap.cekiciPlaka), 20).replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

function richness(snap) {
  return ['bbt', 'cuval', 'palet', 'bosBbt', 'bosCuval', 'ydKey', 'lotNo', 'excelFileName', 'tonaj', 'sevkYeri']
    .reduce((n, key) => n + (clip(snap && snap[key], 20) ? 1 : 0), 0);
}

function fileFor(snap, files, label) {
  const stem = fileLabelOf(snap && snap.excelFileName);
  const list = Array.isArray(files) ? files : [];
  if (stem && list.some((file) => file.toLowerCase() === stem.toLowerCase())) return stem;
  const yd = clip(snap && snap.ydKey, 12).toUpperCase();
  if (yd) {
    const hit = list.find((file) => String(file).toUpperCase().indexOf(yd) >= 0);
    if (hit) return hit;
  }
  if (stem) return stem;
  return list[0] || label || '';
}

/**
 * Mühürlü Excel kopyası boş kalmış kapalı günü, o güne ait kantar baskılarından kurar.
 * Aynı plaka + YD için en dolu baskı kalır.
 */
function buildArchiveFromPrints(prints, key, meta) {
  const info = meta && typeof meta === 'object' ? meta : {};
  const label = clip(info.label, 40) || key;
  const files = Array.isArray(info.files) ? info.files.map((file) => clip(file, 80)).filter(Boolean) : [];
  const best = new Map();
  (Array.isArray(prints) ? prints : []).forEach((item) => {
    const snap = item && item.snapshot && typeof item.snapshot === 'object' ? item.snapshot : null;
    if (!snap) return;
    const plate = plateOf(snap);
    if (!plate) return;
    const yd = clip(snap.ydKey, 12).toUpperCase();
    const id = plate + '|' + yd;
    const score = richness(snap);
    const ts = Number(item.ts) || 0;
    const prev = best.get(id);
    if (!prev || score > prev.score || (score === prev.score && ts >= prev.ts)) {
      best.set(id, { snap, plate, yd, score, ts });
    }
  });
  const withYd = new Set();
  best.forEach((item) => { if (item.yd) withYd.add(item.plate); });
  const groups = new Map();
  best.forEach((item) => {
    if (!item.yd && withYd.has(item.plate)) return;
    const snap = item.snap;
    const file = fileFor(snap, files, label);
    const lot = clip(snap.lotNo, 40);
    const sevk = clip(snap.sevkYeri, 40);
    const gkey = file + '|' + (item.yd || '') + '|' + lot + '|' + sevk;
    if (!groups.has(gkey)) {
      const title = [item.yd, lot ? ('LOT NO ' + lot) : '', sevk].filter(Boolean).join(' / ') || file || label;
      groups.set(gkey, {
        title,
        liman: sevk,
        gemi: '',
        booking: '',
        sevk: '',
        sip: '',
        tasiyici: '',
        yd: item.yd,
        lot,
        fileName: file,
        toplam: null,
        kalan: null,
        rows: [],
      });
    }
    const row = {
      sira: clip(snap.yuklemeSirasi, 12),
      plaka: item.plate,
      bbt: clip(snap.bbt, 12),
      cuval: clip(snap.cuval, 12),
      palet: clip(snap.palet, 12),
      bosBbt: clip(snap.bosBbt, 12),
      bosCuval: clip(snap.bosCuval, 12),
      net: '',
      giden: clip(snap.tonaj, 20),
      yukleme: clip(snap.basimYeri, 40),
      sofor: clip(snap.sofor, 80),
      telefon: clip(snap.iletisim, 40),
      irsaliye: '',
      tasiyici: '',
      note: clip(snap.yuklemeNotu, 240),
    };
    groups.get(gkey).rows.push(row);
  });
  const blocks = Array.from(groups.values()).filter((block) => block.rows.length);
  if (!blocks.length) return null;
  blocks.forEach((block) => {
    block.rows.sort((a, b) => (parseInt(a.sira, 10) || 0) - (parseInt(b.sira, 10) || 0) || a.plaka.localeCompare(b.plaka, 'tr'));
  });
  blocks.sort((a, b) => String(a.fileName).localeCompare(String(b.fileName), 'tr') || String(a.yd).localeCompare(String(b.yd), 'tr'));
  return {
    dateKey: key,
    label,
    closedAt: info.at || info.closedAt || '',
    closedBy: clip(info.by || info.closedBy, 40),
    fp: '',
    recovered: true,
    blocks,
    check: null,
  };
}

module.exports = { buildArchiveFromPrints };
