'use strict';

const { irsaliyeKey } = require('./liman-merge');

const MAX_BLOCKS = 300;
const MAX_BLOCK_ROWS = 300;
const ROW_FIELDS = ['sira', 'plaka', 'bbt', 'cuval', 'palet', 'bosBbt', 'bosCuval', 'net', 'ogr', 'giden', 'fark', 'yukleme', 'sofor', 'telefon', 'irsaliye', 'durum', 'tasiyici', 'kantarGiris', 'kantarCikis'];
const PORTS = [
  ['DP WORLD', /DP\s*WORLD/i],
  ['EVYAP', /EVYAP/i],
  ['YILPORT', /Y[Iİ]L\s*PORT/i],
  ['SAFİPORT', /SAF[Iİ]\s*PORT/i],
  ['MARPORT', /MARPORT/i],
  ['KUMPORT', /KUMPORT/i],
  ['GEMLİK', /GEML[Iİ]K/i],
];

function clip(value, max) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max);
}

const TOTAL_KEYS = ['bbt', 'cuval', 'palet', 'bosBbt', 'bosCuval', 'netTonaj', 'ogrTonaj', 'gidenTonaj', 'fark'];

function sanitizeTotals(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const out = {};
  let any = false;
  TOTAL_KEYS.forEach((key) => {
    out[key] = clip(raw[key], 20);
    if (out[key]) any = true;
  });
  return any ? out : null;
}

function totalNum(value) {
  const n = Number(String(value == null ? '' : value).replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

function atMs(value) {
  const t = Date.parse(value || '');
  return Number.isFinite(t) ? t : 0;
}

/** İki kantarın aynı bloğu: son Güncelle'nin toplamı kalır. Eski yüksek tonaj yeniyi ezmez. */
function pickTotals(prev, next) {
  if (!next || !next.toplam) return prev;
  if (!prev || !prev.toplam) return next;
  const nextAt = atMs(next.updatedAt);
  const prevAt = atMs(prev.updatedAt);
  if (nextAt !== prevAt) return nextAt > prevAt ? next : prev;
  return totalNum(next.toplam.gidenTonaj) > totalNum(prev.toplam.gidenTonaj) ? next : prev;
}

function normTitle(text) {
  return clip(text, 240).toUpperCase().replace(/İ/g, 'I').replace(/\s+/g, ' ');
}

function lotOf(title) {
  const m = String(title || '').match(/LOT\s*NO\s*([\d\s]+)/i);
  return m ? clip(m[1], 40) : '';
}

function ydOf(title) {
  const m = String(title || '').match(/\b(YD\d{1,4})/i);
  return m ? m[1].toUpperCase() : '';
}

function portOf(text) {
  const s = String(text || '');
  for (let i = 0; i < PORTS.length; i++) {
    if (PORTS[i][1].test(s)) return PORTS[i][0];
  }
  return '';
}

function hasPlate(row) {
  const p = clip(row && row.plaka, 20).replace(/[^A-Za-z0-9]/g, '');
  return p.length >= 5;
}

function rowScore(row) {
  let score = 0;
  if (hasPlate(row)) score += 4;
  if (clip(row && row.sofor, 80)) score += 2;
  if (clip(row && row.giden, 20) && clip(row.giden, 20) !== '0') score += 1;
  return score;
}

// Anlık durum notları (İÇERİDE / DIŞARIDA) diğer kantarın eski listesinden doldurulmaz:
// kantar notu sildiyse boş kalmalı, yoksa çıkmış araç "İÇERİDE" görünür.
const TRANSIENT_FIELDS = ['durum'];
const MEASURED_FIELDS = ['bbt', 'cuval', 'palet', 'bosBbt', 'bosCuval', 'net', 'giden'];

function isInsideDurum(value) {
  return /^(İÇERİDE|ICERIDE)$/i.test(clip(value, 20));
}

function isOutsideDurum(value) {
  return /^(DIŞARIDA|DISARIDA)$/i.test(clip(value, 20));
}

/** İki kantar satırı birleşirken: çıkış (DIŞARIDA) içeri (İÇERİDE) yener; boş birincil eski İÇERİDE getirmez. */
function mergeTransientDurum(primary, secondary) {
  const p = clip(primary, 20);
  const s = clip(secondary, 20);
  if (isOutsideDurum(p)) return p;
  if (isOutsideDurum(s)) return s;
  if (isInsideDurum(p)) return p;
  if (!p && isInsideDurum(s)) return '';
  return p || '';
}

function choosePrimary(incoming, current) {
  const ti = atMs(incoming && incoming.updatedAt);
  const tc = atMs(current && current.updatedAt);
  if (ti !== tc) return ti > tc ? incoming : current;
  return rowScore(incoming) > rowScore(current) ? incoming : current;
}

function fillRow(primary, secondary, opts) {
  const lockMeasured = !!(opts && opts.lockMeasured);
  const out = Object.assign({}, secondary, primary);
  ROW_FIELDS.forEach((key) => {
    if (TRANSIENT_FIELDS.indexOf(key) >= 0) {
      out[key] = mergeTransientDurum(primary[key], secondary[key]);
      return;
    }
    if (lockMeasured && MEASURED_FIELDS.indexOf(key) >= 0) {
      out[key] = primary[key] == null ? '' : primary[key];
      return;
    }
    const cur = clip(out[key], 80);
    const alt = clip(secondary[key], 80);
    if ((!cur || cur === '0') && alt && alt !== '0') out[key] = secondary[key];
  });
  delete out.updatedAt;
  return out;
}

function mergePair(incoming, current) {
  const primary = choosePrimary(incoming, current);
  const secondary = primary === incoming ? current : incoming;
  const lockMeasured = atMs(primary.updatedAt) > atMs(secondary.updatedAt);
  return fillRow(primary, secondary, { lockMeasured });
}

/** Çıkmış araçta (giden tonaj girilmiş) eski "İÇERİDE / DIŞARIDA" notu anlamsız → boş. */
function cleanDurum(row) {
  const giden = clip(row && row.giden, 20);
  const durum = clip(row && row.durum, 20);
  if (giden && giden !== '0' && /^(İÇERİDE|ICERIDE|DIŞARIDA|DISARIDA)$/i.test(durum)) return '';
  return durum;
}

function mergeRows(rows) {
  const bySira = new Map();
  const loose = [];
  rows.forEach((row) => {
    const sira = clip(row.sira, 8);
    if (!sira) {
      loose.push(row);
      return;
    }
    if (!bySira.has(sira)) bySira.set(sira, []);
    bySira.get(sira).push(row);
  });
  const out = [];
  bySira.forEach((group) => {
    let acc = null;
    const extras = [];
    group.forEach((row) => {
      if (!acc) {
        acc = Object.assign({}, row);
        return;
      }
      const a = hasPlate(acc) ? clip(acc.plaka, 20).replace(/\s+/g, '').toUpperCase() : '';
      const b = hasPlate(row) ? clip(row.plaka, 20).replace(/\s+/g, '').toUpperCase() : '';
      if (a && b && a !== b) {
        extras.push(row);
        return;
      }
      acc = mergePair(row, acc);
    });
    out.push(acc);
    extras.forEach((row) => out.push(row));
  });
  loose.forEach((row) => {
    const plate = hasPlate(row) ? clip(row.plaka, 20).replace(/\s+/g, '').toUpperCase() : '';
    if (plate) {
      const idx = out.findIndex((r) => {
        if (!hasPlate(r) || clip(r.plaka, 20).replace(/\s+/g, '').toUpperCase() !== plate) return false;
        const a = clip(r.net, 20);
        const b = clip(row.net, 20);
        // Aynı plakanın aynı tonu ikinci kez eklenmesin (10 ton + 10 ton = 20 olmasın).
        return !a || !b || a === b;
      });
      if (idx >= 0) {
        out[idx] = mergePair(row, out[idx]);
        return;
      }
    }
    out.push(row);
  });
  out.sort((a, b) => (parseInt(a.sira, 10) || 0) - (parseInt(b.sira, 10) || 0));
  return out;
}

/** Alt sekme etiketi: "03.10.2026-YD28.xlsx" → "03.10.2026-YD28". Birleşik ad ("a + b") tek dosya sayılmaz. */
function fileLabelOf(name) {
  const s = clip(name, 180);
  if (!s || /\s\+\s/.test(s)) return '';
  return s.replace(/\.(xlsx|xlsm|xlsb|xls)$/i, '').trim();
}

/** Liman sayfasındaki "tamamlandı" ile aynı: giden tonaj doluysa araç çıkmıştır. */
function gidenKg(raw) {
  const s = String(raw || '').trim();
  if (!s || /^(İÇERİDE|ICERIDE|DIŞARIDA|DISARIDA)$/i.test(s)) return 0;
  if (/^\d{1,3}(\.\d{3})+$/.test(s)) return parseInt(s.replace(/\./g, ''), 10) || 0;
  if (/^\d{1,3}(\.\d{3})+,\d+$/.test(s)) {
    const grouped = parseFloat(s.replace(/\./g, '').replace(',', '.'));
    return Number.isFinite(grouped) ? grouped : 0;
  }
  const n = parseFloat(s.replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0) return 0;
  if (n >= 8 && n < 80 && n !== Math.floor(n)) return Math.round(n * 1000);
  return n;
}

function rowShipmentDone(row) {
  return gidenKg(row && (row.giden || row.gidenTonaj)) >= 1000;
}

function blockShipmentDone(block) {
  const rows = (block && block.rows) || [];
  return rows.length > 0 && rows.every(rowShipmentDone);
}

/**
 * Kantarın bir daha okumaması / silmesi gereken Excel etiketleri.
 * Dosyadaki her sevkiyat bloğunun bütün araçları çıktıysa (limanda "tamamlandı").
 */
function settledFileLabels(state, site) {
  const scoped = (site && state && state.sites)
    ? Object.assign({}, state, { sites: { [site]: state.sites[site] } })
    : state;
  const byLabel = new Map();
  daysFromSheetState(scoped).forEach((day) => {
    (day.blocks || []).forEach((block) => {
      (block.files || []).forEach((label) => {
        const key = String(label || '').toLowerCase();
        if (!key) return;
        if (!byLabel.has(key)) byLabel.set(key, { label, blocks: [] });
        byLabel.get(key).blocks.push(block);
      });
    });
  });
  const out = [];
  byLabel.forEach((entry) => {
    if (entry.blocks.length > 0 && entry.blocks.every(blockShipmentDone)) out.push(entry.label);
  });
  // Amir kapatınca dosya bir daha limana yazılmasın (sevkiyat bitmiş gibi kantardan düşsün).
  const closed = scoped && scoped.closedDays;
  if (closed && typeof closed === 'object') {
    Object.keys(closed).forEach((key) => {
      const files = closed[key] && closed[key].files;
      (Array.isArray(files) ? files : []).forEach((label) => {
        if (label && out.indexOf(label) < 0) out.push(label);
      });
    });
  }
  return out;
}

function closedFileLabelSet(state) {
  const set = new Set();
  const closed = state && state.closedDays;
  if (!closed || typeof closed !== 'object') return set;
  Object.keys(closed).forEach((key) => {
    const files = closed[key] && closed[key].files;
    (Array.isArray(files) ? files : []).forEach((label) => {
      const name = String(label || '').trim().toLowerCase();
      if (name) set.add(name);
    });
  });
  return set;
}

function dropConfirmedSet(state) {
  const set = new Set();
  const raw = state && state.dropConfirmed;
  if (!raw || typeof raw !== 'object') return set;
  Object.keys(raw).forEach((key) => {
    if (!raw[key]) return;
    const name = String(key || '').trim().toLowerCase();
    if (name) set.add(name);
  });
  return set;
}

/**
 * Kantarın Excel'i silmesi: amir günü kapattıysa hemen.
 * Sevkiyat bitmişse hemen silinmez; kantar bir kez daha Güncelle deyince confirmSettledLabels işaretler.
 */
function labelsReadyToDelete(state) {
  const closed = closedFileLabelSet(state);
  const confirmed = dropConfirmedSet(state);
  return settledFileLabels(state).filter((label) => {
    const key = String(label || '').toLowerCase();
    return closed.has(key) || confirmed.has(key);
  });
}

/** Verisi alındı, silme bir sonraki Güncelle'ye kaldı. */
function pendingDropLabels(state) {
  const ready = new Set(labelsReadyToDelete(state).map((label) => String(label).toLowerCase()));
  return settledFileLabels(state).filter((label) => !ready.has(String(label).toLowerCase()));
}

/** İkinci Güncelle: bu dosyaların verisi yazıldı, artık kantardan silinebilir. */
function confirmSettledLabels(state, labels) {
  const settled = new Set(settledFileLabels(state).map((label) => String(label).toLowerCase()));
  if (!state.dropConfirmed || typeof state.dropConfirmed !== 'object') state.dropConfirmed = {};
  (labels || []).forEach((label) => {
    const key = String(label || '').trim().toLowerCase();
    if (key && settled.has(key)) state.dropConfirmed[key] = true;
  });
}

/** "a.xlsx + b.xlsx" içinden tamamlanan dosya adlarını çıkarır. Liste limanda kalır. */
function withoutSettledFiles(raw, labels) {
  const drop = new Set((labels || []).map((label) => String(label || '').toLowerCase()));
  return String(raw || '').split(/\s+\+\s+/).map((part) => part.trim()).filter((part) => {
    if (!part) return false;
    const label = fileLabelOf(part).toLowerCase();
    return !label || !drop.has(label);
  }).join(' + ');
}

const LIMAN_STATE_KEY = 'liman_state_v1';

async function readSettledFileLabels(q, site) {
  if (typeof q !== 'function') return [];
  try {
    const r = await q('SELECT value FROM kv_store WHERE key = $1', [LIMAN_STATE_KEY]);
    const raw = (r && r.rows && r.rows[0] && r.rows[0].value) || '';
    if (!raw) return [];
    return labelsReadyToDelete(JSON.parse(raw));
  } catch (_) {
    return [];
  }
}

function mergeSheetBlocks(siteBlocks) {
  const map = new Map();
  (siteBlocks || []).forEach((entry) => {
    const updatedAt = entry.updatedAt || '';
    (entry.blocks || []).forEach((block) => {
      const key = normTitle(block.title) || (clip(block.liman, 40) + '|' + clip(block.yd, 12));
      const file = fileLabelOf(block.fileName);
      const copy = {
        files: file ? [file] : [],
        title: block.title || '',
        liman: block.liman || portOf(block.title),
        gemi: block.gemi || '',
        booking: block.booking || '',
        sevk: block.sevk || '',
        dolum: block.dolum || '',
        sip: block.sip || '',
        note: block.note || '',
        tolerans: block.tolerans || '',
        exportLine: block.exportLine || '',
        tasiyici: block.tasiyici || '',
        yd: block.yd || ydOf(block.title),
        lot: block.lot || lotOf(block.title),
        updatedAt,
        toplam: block.toplam || null,
        kalan: block.kalan || null,
        rows: (block.rows || []).map((row) => Object.assign({}, row, { updatedAt })),
      };
      if (!map.has(key)) {
        map.set(key, copy);
        return;
      }
      const prev = map.get(key);
      copy.files.forEach((f) => { if (prev.files.indexOf(f) < 0) prev.files.push(f); });
      ['liman', 'gemi', 'booking', 'sevk', 'dolum', 'sip', 'note', 'tasiyici', 'tolerans', 'exportLine'].forEach((field) => {
        if (!prev[field] && copy[field]) prev[field] = copy[field];
      });
      const totals = pickTotals(
        { toplam: prev.toplam, kalan: prev.kalan, updatedAt: prev.updatedAt },
        { toplam: copy.toplam, kalan: copy.kalan, updatedAt: copy.updatedAt }
      );
      prev.toplam = totals.toplam || null;
      prev.kalan = totals.kalan || null;
      if (atMs(copy.updatedAt) > atMs(prev.updatedAt)) prev.updatedAt = copy.updatedAt;
      prev.rows = mergeRows(prev.rows.concat(copy.rows));
    });
  });
  return Array.from(map.values());
}

function portsOf(blocks) {
  const seen = [];
  (blocks || []).forEach((block) => {
    const port = clip(block.liman, 40);
    if (port && seen.indexOf(port) < 0) seen.push(port);
  });
  return seen;
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

function siteHasBlocks(snap) {
  return !!(snap && Array.isArray(snap.blocks) && snap.blocks.length);
}

function sanitizeBlocks(list) {
  return (Array.isArray(list) ? list : []).slice(0, MAX_BLOCKS).map((block) => ({
    title: clip(block && block.title, 500),
    liman: clip(block && block.liman, 40),
    gemi: clip(block && block.gemi, 120),
    booking: clip(block && block.booking, 80),
    sevk: clip(block && block.sevk, 60),
    dolum: clip(block && block.dolum, 80),
    sip: clip(block && block.sip, 30).toUpperCase().replace(/[^A-Z0-9]/g, ''),
    note: clip(block && block.note, 240),
    tolerans: clip(block && block.tolerans, 20),
    exportLine: clip(block && block.exportLine, 500),
    tasiyici: clip(block && block.tasiyici, 60),
    fileName: clip(block && block.fileName, 180),
    toplam: sanitizeTotals(block && block.toplam),
    kalan: sanitizeTotals(block && block.kalan),
    rows: (Array.isArray(block && block.rows) ? block.rows : []).slice(0, MAX_BLOCK_ROWS).map((row) => {
      const out = {};
      ROW_FIELDS.forEach((key) => { out[key] = clip(row && row[key], key === 'sofor' ? 80 : 40); });
      return out;
    }),
  })).filter((block) => block.title);
}

/**
 * Eski sürüm kantar nakliyeci (AKYÜZ / GPM) göndermez; o gönderim kayıtlı bilgiyi silmesin.
 * Gelen listede hiç nakliyeci yoksa aynı başlıklı önceki bloktan (satırlar sıra no ile) taşınır.
 */
function carryTasiyici(prevBlocks, blocks) {
  const hasAny = (blocks || []).some((block) => block.tasiyici || (block.rows || []).some((row) => row.tasiyici));
  if (hasAny) return blocks;
  const byTitle = new Map();
  (prevBlocks || []).forEach((block) => {
    const key = normTitle(block.title);
    if (key && !byTitle.has(key) && (block.tasiyici || (block.rows || []).some((row) => row.tasiyici))) byTitle.set(key, block);
  });
  if (!byTitle.size) return blocks;
  return blocks.map((block) => {
    const prev = byTitle.get(normTitle(block.title));
    if (!prev) return block;
    return Object.assign({}, block, {
      tasiyici: prev.tasiyici || '',
      rows: (block.rows || []).map((row) => {
        const old = (prev.rows || []).find((r) => clip(r.sira, 8) && clip(r.sira, 8) === clip(row.sira, 8));
        return old && old.tasiyici ? Object.assign({}, row, { tasiyici: old.tasiyici }) : row;
      }),
    });
  });
}

/**
 * Kantar bir Excel'i silince o kitabın liman listesi düşmesin.
 * Gönderilen dosyanın blokları güncellenir, yeni kitap eklenir, payload'da olmayan kitap durur.
 * Listeyi kapatmak amirin işi.
 */
function retainDroppedBooks(prevBlocks, nextBlocks, prevFileName, nextFileName) {
  const incoming = Array.isArray(nextBlocks) ? nextBlocks : [];
  const previous = Array.isArray(prevBlocks) ? prevBlocks : [];
  if (!incoming.length) return previous.slice();
  const singleNext = fileLabelOf(nextFileName);
  const incomingFiles = [];
  const addFile = (label) => {
    if (label && incomingFiles.indexOf(label) < 0) incomingFiles.push(label);
  };
  const incomingTitles = {};
  incoming.forEach((block) => {
    addFile(fileLabelOf(block && block.fileName) || singleNext);
    const title = normTitle(block && block.title);
    if (title) incomingTitles[title] = true;
  });
  const kept = [];
  previous.forEach((block) => {
    const label = fileLabelOf(block && block.fileName) || fileLabelOf(prevFileName);
    if (label) {
      if (incomingFiles.indexOf(label) < 0) kept.push(block);
      return;
    }
    const title = normTitle(block && block.title);
    if (title && incomingTitles[title]) return;
    kept.push(block);
  });
  return kept.concat(incoming);
}

/** Eski istemci yalnız satır gönderdiyse başlığa göre Excel bloklarına çevirir. */
function rowsToBlocks(rows, fallbackFile) {
  const map = new Map();
  (rows || []).forEach((row) => {
    const title = clip(row && row.headerText, 500);
    if (!title) return;
    const fileName = clip(row.fileName || fallbackFile, 180);
    const key = fileName + '::' + normTitle(title);
    if (!map.has(key)) {
      map.set(key, { title, liman: portOf(title), gemi: '', booking: '', sevk: '', note: '', fileName, rows: [] });
    }
    if (!row.irsaliyeNo && !row.plaka && !row.sira) return;
    map.get(key).rows.push({
      durum: row.iceride ? 'İÇERİDE' : (row.disarida ? 'DIŞARIDA' : ''),
      sira: clip(row.sira, 12),
      plaka: clip(row.plaka, 20),
      bbt: clip(row.bbt, 12),
      net: clip(row.netTonaj, 20),
      giden: clip(row.gidenTonaj, 20),
      yukleme: clip(row.yuklemeYeri, 40),
      irsaliye: clip(row.irsaliyeNo, 40),
    });
  });
  return Array.from(map.values());
}

/** Excel A sütunundaki blok etiketi ("AKYÜZ", "GPM-AKYÜZ"); yoksa satırlardakiler. */
function tasiyiciOf(block) {
  const label = clip(block.tasiyici, 60);
  if (label) return label;
  const seen = [];
  (block.rows || []).forEach((row) => {
    const name = clip(row && row.tasiyici, 40);
    if (name && seen.indexOf(name) < 0) seen.push(name);
  });
  return seen.join('-');
}

function daysFromSheetState(state) {
  const sites = state && state.sites ? state.sites : {};
  const notes = (state && state.notes) || {};
  const byDay = new Map();
  Object.keys(sites).forEach((site) => {
    const snap = sites[site];
    if (!snap) return;
    const blocks = siteHasBlocks(snap) ? snap.blocks : rowsToBlocks(snap.rows, snap.fileName);
    blocks.forEach((block) => {
      const dateKey = dateKeyFromFileName(block.fileName || snap.fileName) || 'tarihsiz';
      if (!byDay.has(dateKey)) byDay.set(dateKey, new Map());
      const perSite = byDay.get(dateKey);
      if (!perSite.has(site)) perSite.set(site, []);
      perSite.get(site).push(block.fileName ? block : Object.assign({}, block, { fileName: snap.fileName || '' }));
    });
  });
  if (!byDay.size) return [];
  const keys = Array.from(byDay.keys()).sort().reverse();
  return keys.map((dateKey) => {
    const entries = [];
      byDay.get(dateKey).forEach((blocks, site) => {
        const snap = sites[site];
        entries.push({ site, blocks, updatedAt: (snap && snap.updatedAt) || '' });
      });
    const blocks = mergeSheetBlocks(entries).map((block) => ({
      title: block.title,
      liman: block.liman,
      port: block.liman,
      gemi: block.gemi,
      booking: block.booking,
      sevk: block.sevk,
      dolum: block.dolum || '',
      sip: block.sip || '',
      note: block.note,
      tolerans: block.tolerans || '',
      exportLine: block.exportLine || '',
      tasiyici: tasiyiciOf(block),
      yd: block.yd,
      lot: block.lot,
      toplam: block.toplam || null,
      kalan: block.kalan || null,
      files: block.files || [],
      rows: (block.rows || []).map((row) => {
        const { updatedAt, ...rest } = row;
        void updatedAt;
        return Object.assign({}, rest, {
          durum: cleanDurum(row),
          gidenTonaj: row.giden || '',
          netTonaj: row.net || '',
          yuklemeYeri: row.yukleme || '',
          ydKey: block.yd || '',
          headerText: block.title || '',
          irsaliyeNo: row.irsaliye || '',
          note: clip(notes[irsaliyeKey({ irsaliyeNo: row.irsaliye })] || '', 240),
        });
      }),
    }));
    return { dateKey, label: labelFromDateKey(dateKey), blocks };
  });
}

module.exports = {
  mergeSheetBlocks,
  mergeRows,
  portsOf,
  hasPlate,
  lotOf,
  ydOf,
  daysFromSheetState,
  siteHasBlocks,
  sanitizeBlocks,
  sanitizeTotals,
  rowsToBlocks,
  carryTasiyici,
  retainDroppedBooks,
  cleanDurum,
  fillRow,
  mergeTransientDurum,
  isInsideDurum,
  isOutsideDurum,
  fileLabelOf,
  dateKeyFromFileName,
  labelFromDateKey,
  gidenKg,
  rowShipmentDone,
  blockShipmentDone,
  settledFileLabels,
  labelsReadyToDelete,
  pendingDropLabels,
  confirmSettledLabels,
  withoutSettledFiles,
  readSettledFileLabels,
};
