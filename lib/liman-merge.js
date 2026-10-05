'use strict';

const SITES = ['AVDAN', '1.OSB'];
const PORTS = [
  ['DP WORLD', /DP\s*WORLD/i],
  ['EVYAP', /EVYAP/i],
  ['YILPORT', /Y[Iİ]L\s*PORT|YILPORT/i],
  ['SAFİPORT', /SAF[Iİ]\s*PORT|SAFIPORT/i],
  ['MARPORT', /MARPORT/i],
  ['KUMPORT', /KUMPORT/i],
  ['GEMLİK', /GEML[Iİ]K/i],
];

function clip(value, max) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max);
}

function lotLabelFromText(text) {
  const m = String(text || '').match(/LOT\s*NO\s*([\d\s]+)/i);
  if (!m) return '';
  return clip(m[1], 40);
}

function lotKeyFromText(text) {
  return lotLabelFromText(text).replace(/\D/g, '');
}

function ydFromText(text) {
  const m = String(text || '').match(/\b(YD\d{1,4})\b/i);
  return m ? m[1].toUpperCase() : '';
}

function dateKeyFromFileName(name) {
  const m = String(name || '').match(/(\d{2})\.(\d{2})\.(\d{4})/);
  if (!m) return '';
  return m[3] + '-' + m[2] + '-' + m[1];
}

function labelFromDateKey(key) {
  const m = String(key || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return 'Tarihsiz';
  return m[3] + '.' + m[2] + '.' + m[1];
}

function portFromText(text) {
  const s = String(text || '');
  for (let i = 0; i < PORTS.length; i++) {
    if (PORTS[i][1].test(s)) return PORTS[i][0];
  }
  return '';
}

function normalizeSite(raw) {
  const s = clip(raw, 20).toUpperCase().replace(/\s+/g, '');
  if (s === 'AVDAN') return 'AVDAN';
  if (s === '1.OSB' || s === '1OSB' || s === 'OSB') return '1.OSB';
  return '';
}

function normPlate(raw) {
  return clip(raw, 20).toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function hasPlate(row) {
  const p = normPlate(row && row.plaka);
  return p.length >= 5 && !/^(PLAKA|TOPLAM|KALAN|BBT)$/.test(p);
}

function gidenKg(row) {
  const raw = clip(row && row.gidenTonaj, 20);
  if (!raw) return 0;
  if (/^\d{1,3}(\.\d{3})+$/.test(raw)) return parseInt(raw.replace(/\./g, ''), 10) || 0;
  const n = parseFloat(raw.replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

function rowScore(row) {
  let score = 0;
  if (gidenKg(row) >= 1000) score += 4;
  if (hasPlate(row)) score += 2;
  if (clip(row && row.bbt, 12)) score += 1;
  return score;
}

function irsaliyeKey(row) {
  return clip(row && row.irsaliyeNo, 40).toUpperCase().replace(/\s+/g, '');
}

function slimRow(row, site, fallbackFile) {
  const headerText = clip(row && (row.headerText || (row.blockMeta && row.blockMeta.mainHeader)), 500);
  const fileName = clip(row && row.fileName, 180) || clip(fallbackFile, 180);
  return {
    site: normalizeSite(site),
    irsaliyeNo: clip(row && row.irsaliyeNo, 40),
    sira: clip(row && row.sira, 12),
    plaka: clip(row && row.plaka, 20),
    bbt: clip(row && row.bbt, 12),
    gidenTonaj: clip(row && row.gidenTonaj, 20),
    netTonaj: clip(row && row.netTonaj, 20),
    tonajKg: clip(row && row.tonajKg, 20),
    yuklemeYeri: clip(row && row.yuklemeYeri, 20),
    ydKey: ydFromText([row && row.ydKey, headerText, row && row.firma].join(' ')),
    headerText,
    malzeme: clip(row && row.malzeme, 80),
    fileName,
    iceride: !!(row && row.iceride),
    disarida: !!(row && row.disarida),
  };
}

function fillBlanks(primary, secondary) {
  const out = Object.assign({}, secondary, primary);
  ['plaka', 'gidenTonaj', 'bbt', 'yuklemeYeri', 'netTonaj', 'tonajKg', 'sira', 'malzeme', 'headerText', 'ydKey', 'irsaliyeNo'].forEach((key) => {
    if (!clip(out[key], 500) && clip(secondary[key], 500)) out[key] = secondary[key];
  });
  if (secondary.disarida || primary.disarida) {
    out.disarida = true;
    out.iceride = false;
  } else if (!out.iceride && secondary.iceride) {
    out.iceride = true;
  }
  const sources = [];
  [primary, secondary].forEach((row) => {
    const list = Array.isArray(row.sources) ? row.sources : [row.site];
    list.forEach((site) => {
      const n = normalizeSite(site);
      if (n && sources.indexOf(n) < 0) sources.push(n);
    });
  });
  out.sources = sources;
  delete out.site;
  return out;
}

function mergeSameIrsaliye(rows) {
  let acc = null;
  const split = [];
  rows.forEach((row) => {
    if (!acc) {
      acc = Object.assign({}, row, { sources: [row.site].filter(Boolean) });
      delete acc.site;
      return;
    }
    const accPlate = hasPlate(acc) ? normPlate(acc.plaka) : '';
    const rowPlate = hasPlate(row) ? normPlate(row.plaka) : '';
    if (accPlate && rowPlate && accPlate !== rowPlate) {
      split.push(Object.assign({}, row, { sources: [row.site].filter(Boolean) }));
      return;
    }
    const primary = rowScore(row) > rowScore(acc) ? row : acc;
    const secondary = primary === row ? acc : row;
    acc = fillBlanks(primary, secondary);
  });
  return [acc].concat(split).filter(Boolean);
}

function collectInputRows(state) {
  const sites = (state && state.sites) || {};
  const out = [];
  SITES.forEach((site) => {
    const snap = sites[site];
    if (!snap || !Array.isArray(snap.rows)) return;
    const fileName = clip(snap.fileName, 180);
    snap.rows.forEach((row) => {
      const slim = slimRow(row, site, fileName);
      if (!slim.ydKey && !slim.headerText && !slim.irsaliyeNo && !hasPlate(slim)) return;
      out.push(slim);
    });
  });
  return out;
}

function mergeLimanState(state) {
  const notes = (state && state.notes && typeof state.notes === 'object') ? state.notes : {};
  const rows = collectInputRows(state);
  const byIrs = new Map();
  const loose = [];
  rows.forEach((row, index) => {
    const dateKey = dateKeyFromFileName(row.fileName) || 'tarihsiz';
    const lotKey = lotKeyFromText(row.headerText);
    const ship = dateKey + '|' + (row.ydKey || 'GENEL') + '|' + lotKey;
    const irs = irsaliyeKey(row);
    if (!irs) {
      loose.push(Object.assign({}, row, { sources: [row.site].filter(Boolean), _ship: ship, _date: dateKey }));
      return;
    }
    const key = ship + '|' + irs;
    if (!byIrs.has(key)) byIrs.set(key, []);
    byIrs.get(key).push(row);
    void index;
  });

  const merged = [];
  byIrs.forEach((group) => {
    mergeSameIrsaliye(group).forEach((row) => {
      const dateKey = dateKeyFromFileName(row.fileName) || 'tarihsiz';
      const lotKey = lotKeyFromText(row.headerText);
      merged.push(Object.assign({}, row, {
        _ship: dateKey + '|' + (row.ydKey || 'GENEL') + '|' + lotKey,
        _date: dateKey,
      }));
    });
  });
  loose.forEach((row) => merged.push(row));

  const dayMap = new Map();
  merged.forEach((row) => {
    const dateKey = row._date || 'tarihsiz';
    if (!dayMap.has(dateKey)) dayMap.set(dateKey, new Map());
    const blocks = dayMap.get(dateKey);
    if (!blocks.has(row._ship)) {
      const lot = lotLabelFromText(row.headerText);
      blocks.set(row._ship, {
        key: row._ship,
        yd: row.ydKey || 'GENEL',
        lot: lot ? ('LOT ' + lot) : '',
        headerText: row.headerText || '',
        port: portFromText(row.headerText),
        rows: [],
      });
    }
    const block = blocks.get(row._ship);
    if (!block.headerText && row.headerText) block.headerText = row.headerText;
    if (!block.port) block.port = portFromText(row.headerText);
    const irs = irsaliyeKey(row);
    const note = irs ? clip(notes[irs], 240) : '';
    block.rows.push({
      irsaliyeNo: row.irsaliyeNo || '',
      sira: row.sira || '',
      plaka: row.plaka || '',
      bbt: row.bbt || '',
      gidenTonaj: row.gidenTonaj || '',
      netTonaj: row.netTonaj || '',
      tonajKg: row.tonajKg || '',
      yuklemeYeri: row.yuklemeYeri || '',
      ydKey: row.ydKey || '',
      headerText: row.headerText || '',
      malzeme: row.malzeme || '',
      fileName: row.fileName || '',
      iceride: !!row.iceride,
      disarida: !!row.disarida,
      sources: row.sources || [],
      note,
    });
  });

  const days = Array.from(dayMap.entries()).map(([dateKey, blocks]) => ({
    dateKey,
    label: labelFromDateKey(dateKey),
    blocks: Array.from(blocks.values()).map((block) => {
      block.rows.sort((a, b) => {
        const na = parseInt(a.sira, 10);
        const nb = parseInt(b.sira, 10);
        if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
        return String(a.irsaliyeNo).localeCompare(String(b.irsaliyeNo), 'tr');
      });
      return block;
    }),
  }));
  days.sort((a, b) => String(b.dateKey).localeCompare(String(a.dateKey)));
  return { days };
}

function emptyState() {
  return {
    sites: {
      AVDAN: null,
      '1.OSB': null,
    },
    notes: {},
  };
}

module.exports = {
  SITES,
  normalizeSite,
  slimRow,
  mergeLimanState,
  emptyState,
  irsaliyeKey,
  dateKeyFromFileName,
};
