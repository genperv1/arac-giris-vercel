/**
 * İhracat Excel bloklarından nakliye bekleyen (plaka verilecek) özetini hesaplar.
 * Birim: BBT (tonaj değil).
 *
 * Kurallar:
 * - Giden tonajı dolu satır = çıkmış araç → listede gösterilmez
 * - Plaka var, giden tonaj boş = gelmeyen araç → plaka + BBT yan sütunda
 * - Takip/yazdırma kaydı varsa satıra giden tonaj işlenir (çift kantar: plaka başına sırayla)
 * - Kalan BBT = plan − çıkan BBT − atanmış ama gelmeyen BBT
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.NakliyeBekleyenCore = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  function normTr(s) {
    return String(s || '')
      .toUpperCase()
      .replace(/İ/g, 'I')
      .replace(/Ş/g, 'S')
      .replace(/Ğ/g, 'G')
      .replace(/Ü/g, 'U')
      .replace(/Ö/g, 'O')
      .replace(/Ç/g, 'C');
  }

  function parseNum(v) {
    const s = String(v ?? '').trim().replace(',', '.');
    if (!s) return 0;
    const n = parseFloat(s);
    return Number.isFinite(n) ? n : 0;
  }

  function parsePendingNote(raw) {
    const norm = normTr(raw);
    if (!norm || !/PLAKA\s*VER/.test(norm)) return null;
    const m = norm.match(/(\d+)\s*BBT\s+PLAKA\s*VER/);
    if (m) return { remainingBbt: parseInt(m[1], 10), text: String(raw || '').trim() };
    return { remainingBbt: null, text: String(raw || '').trim() };
  }

  function isValidPlateCell(raw) {
    const s = String(raw || '').trim();
    if (!s) return false;
    if (parsePendingNote(s)) return false;
    const compact = s.replace(/[\s\-]+/g, '').toUpperCase();
    if (compact.length < 5) return false;
    if (/^\d+$/.test(compact)) return false;
    if (/^(SIRANO|PLAKA|TOPLAM|KALAN|BBT|TON|CUVAL|ÇUVAL|PALET)$/.test(compact)) return false;
    return /^(\d{2}[A-Z]{1,3}\d{2,5}|[A-Z0-9]{5,12})$/.test(compact);
  }

  /** Giden tonaj dolu = araç çıkmış / yüklenmiş */
  function isRowDeparted(row) {
    if (!row) return false;
    return parseNum(row.gidenTonaj) > 0;
  }

  function extractPlanBbt(sample) {
    if (!sample) return null;
    const meta = sample.blockMeta || {};
    const chunks = [
      sample.headerText,
      meta.mainHeader,
      meta.footerLine,
      meta.bbtPaletLine,
      meta.bbtPaletSummary,
      meta.blackLine1,
      meta.blackLine2,
    ]
      .filter(Boolean)
      .join(' ');
    const m = chunks.match(/(\d+)\s*BBT\b/i);
    if (m) return parseInt(m[1], 10);
    return null;
  }

  function extractYdLabel(sample) {
    if (!sample) return 'GENEL';
    const texts = [sample.ydKey, sample.firma, sample.headerText, sample.blockMeta?.mainHeader].filter(Boolean);
    for (const t of texts) {
      const m = String(t).match(/\b(YD\d{1,4}(?:\([A-Z]\))?)/i);
      if (m) return m[1].toUpperCase();
    }
    return String(sample.ydKey || sample.firma || 'GENEL').trim().toUpperCase() || 'GENEL';
  }

  function extractPort(sample) {
    if (!sample) return '';
    return String(sample.sevkYeri || sample.blockMeta?.portLine || '').trim();
  }

  function rowSourceFile(row) {
    return String(row?.fileName || '').trim();
  }

  function dateKeyFromFileName(fileName) {
    const s = String(fileName || '').trim();
    if (!s) return '';
    let m = s.match(/(?:^|[^0-9])(\d{2})[.\-_](\d{2})[.\-_](\d{4})(?:[^0-9]|$)/);
    if (m) {
      const dd = m[1];
      const mm = m[2];
      const yyyy = m[3];
      if (+mm >= 1 && +mm <= 12 && +dd >= 1 && +dd <= 31) return `${yyyy}-${mm}-${dd}`;
    }
    m = s.match(/(?:^|[^0-9])(\d{4})[.\-_](\d{2})[.\-_](\d{2})(?:[^0-9]|$)/);
    if (m) {
      const yyyy = m[1];
      const mm = m[2];
      const dd = m[3];
      if (+mm >= 1 && +mm <= 12 && +dd >= 1 && +dd <= 31) return `${yyyy}-${mm}-${dd}`;
    }
    return '';
  }

  function formatDateKeyTR(dateKey) {
    const s = String(dateKey || '').trim();
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return s || '';
    return `${m[3]}.${m[2]}.${m[1]}`;
  }

  function sourceDateLabelFromRow(row) {
    const dk = dateKeyFromFileName(rowSourceFile(row));
    return dk ? formatDateKeyTR(dk) : '';
  }

  function blockGroupKey(row) {
    if (!row) return '';
    const fileName = rowSourceFile(row);
    let blockId = '';
    if (row.blockKey) blockId = String(row.blockKey);
    else if (row.blockHeaderRow != null) blockId = `HDR_${row.blockHeaderRow}`;
    else blockId = String(row.headerText || row.id || '').slice(0, 80);
    if (!blockId) return '';
    return fileName ? `${fileName}::${blockId}` : blockId;
  }

  function groupRowsByBlock(rows) {
    const map = new Map();
    (rows || []).forEach((r) => {
      if (!r) return;
      const k = blockGroupKey(r);
      if (!k) return;
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(r);
    });
    return map;
  }

  function collectExplicitPendingNotes(items) {
    const out = [];
    const seen = new Set();
    (items || []).forEach((r) => {
      const notes = Array.isArray(r.blockPendingPlakaNotes) ? r.blockPendingPlakaNotes : [];
      notes.forEach((n) => {
        const key = JSON.stringify(n);
        if (seen.has(key)) return;
        seen.add(key);
        out.push(n);
      });
      const fromPlaka = parsePendingNote(r.plaka);
      if (fromPlaka) {
        const key = fromPlaka.text;
        if (!seen.has(key)) {
          seen.add(key);
          out.push({ text: fromPlaka.text, remainingBbt: fromPlaka.remainingBbt });
        }
      }
    });
    return out;
  }

  function compactPlate(plaka) {
    return String(plaka || '')
      .replace(/\s+/g, '')
      .toUpperCase();
  }

  function plateKey(plaka) {
    return normTr(compactPlate(plaka));
  }

  function reportTimestamp(report) {
    if (!report) return 0;
    const d = report.data || {};
    return Number(report.ts || report.timestamp || d.ts || d.timestamp || 0);
  }

  function printReportValidForMeta(reportTs, meta) {
    const ts = Number(reportTs);
    if (!Number.isFinite(ts) || ts <= 0) return false;

    const twoDaysAgo = Date.now() - 2 * 24 * 60 * 60 * 1000;
    if (ts < twoDaysAgo) return false;

    const importTimestamp = Number(new Date(meta?.importedAt || meta?.loadedAt || 0));
    if (!importTimestamp || ts >= importTimestamp) return true;

    try {
      const tz = { timeZone: 'Europe/Istanbul' };
      const printDay = new Date(ts).toLocaleDateString('sv-SE', tz);
      const dateKey = String(meta?.dateKey || '').trim();
      if (dateKey && printDay === dateKey) return true;
      const importDay = new Date(importTimestamp).toLocaleDateString('sv-SE', tz);
      if (printDay === importDay) return true;
      const today = new Date().toLocaleDateString('sv-SE', tz);
      if (printDay === today) return true;
    } catch (e) {}

    return false;
  }

  function normalizePrintReports(reports) {
    return (reports || [])
      .map((r) => {
        if (!r) return null;
        const type = String(r.type || '').toUpperCase();
        if (type && type !== 'PRINT') return null;
        const d = r.data && typeof r.data === 'object' ? r.data : {};
        const ts = reportTimestamp(r);
        return {
          type: 'PRINT',
          ts,
          plaka: r.plaka || d.plaka || d.plate || '',
          data: d,
        };
      })
      .filter(Boolean);
  }

  function collectPrintCountByPlate(reports, meta) {
    const map = new Map();
    normalizePrintReports(reports).forEach((r) => {
      if (!printReportValidForMeta(r.ts, meta)) return;
      const d = r.data || {};
      const keys = new Set();
      [r.plaka, d.plaka, d.plate, d.cekiciPlaka, d.dorsePlaka].forEach((raw) => {
        const pk = plateKey(raw);
        if (pk) keys.add(pk);
      });
      keys.forEach((pk) => {
        map.set(pk, (map.get(pk) || 0) + 1);
      });
    });
    return map;
  }

  /** Yazdırılmış / çıkış yapmış plakaları satırlara giden tonaj olarak işler (sırayla, çift kantar uyumlu). */
  function applyLiveDepartedMarks(rows, meta, reports) {
    const printCounts = collectPrintCountByPlate(reports, meta);
    const assigned = new Map();
    return (rows || []).map((row) => {
      if (!row || row._ihracatEmptyBlock) return row;
      if (parseNum(row.gidenTonaj) > 0) return row;
      const plaka = String(row.plaka || '').trim();
      if (!isValidPlateCell(plaka)) return row;
      const pk = plateKey(plaka);
      const allowed = printCounts.get(pk) || 0;
      const used = assigned.get(pk) || 0;
      if (allowed > used) {
        assigned.set(pk, used + 1);
        const gt = parseNum(row.tonajKg) || parseNum(row.netTonaj) || parseNum(row.bbt) || 1;
        return Object.assign({}, row, { gidenTonaj: String(gt), _nbLiveDeparted: true });
      }
      return row;
    });
  }

  function departedRowsChanged(before, after) {
    const a = before || [];
    const b = after || [];
    if (a.length !== b.length) return true;
    for (let i = 0; i < a.length; i++) {
      if (String(a[i]?.gidenTonaj || '') !== String(b[i]?.gidenTonaj || '')) return true;
    }
    return false;
  }

  function formatPendingExcelText(remainingBbt, planBbt, waitingPlates) {
    const rem = remainingBbt != null ? remainingBbt : 0;
    const plan = planBbt != null ? planBbt : 0;
    const hasWaiting = Array.isArray(waitingPlates) && waitingPlates.length > 0;
    if (rem > 0 && (hasWaiting || rem < plan)) {
      return `${rem}BBT PLAKA VERİLECEK`;
    }
    if (rem > 0 && !hasWaiting) {
      return 'PLAKA VERİLECEK';
    }
    return 'PLAKA VERİLECEK';
  }

  function extractMalzemeLabel(sample) {
    if (!sample) return '';
    const fromRow = String(sample.malzeme || '').trim().replace(/\s+/g, ' ');
    if (fromRow) {
      const hpRow = fromRow.match(/\bHP\s*([0-9][0-9.,]*\s*-\s*[0-9][0-9.,]*)\b/i);
      if (hpRow) {
        const rng = String(hpRow[1]).replace(/\s+/g, '').replace(/\./g, ',');
        return `HP ${rng}`;
      }
      if (/^HP\s/i.test(fromRow)) return fromRow.slice(0, 28);
    }

    const ht = String(sample.headerText || sample.blockMeta?.mainHeader || '').replace(/\s+/g, ' ');
    const hp = ht.match(/\bHP\s*([0-9][0-9.,]*\s*-\s*[0-9][0-9.,]*)\b/i);
    if (hp) {
      const rng = String(hp[1]).replace(/\s+/g, '').replace(/\./g, ',');
      return `HP ${rng}`;
    }

    const ton = ht.match(/\b(\d+)\s*TON\b/i);
    if (ton) return `${ton[1]} TON`;

    if (fromRow) return fromRow.slice(0, 28);
    return '';
  }

  const WAITING_VEHICLE_LABEL = 'GELMEYEN ARAÇ';
  const OZMAL_VEHICLE_LABEL = 'ÖZMAL';

  const DEFAULT_OZMAL_PLATES = [
    '43 ADT 557',
    '43 ADT 550',
    '43 ADT 553',
    '43 ADS 403',
    '43 ADS 408',
    '43 ADT 546',
  ];

  const FALLBACK_OZMAL_PLATE_KEYS = new Set(DEFAULT_OZMAL_PLATES.map((p) => plateKey(p)));

  function getOzmalPlateKeySet() {
    try {
      const oz = typeof globalThis !== 'undefined' ? globalThis.OzmalPlates : null;
      if (oz && typeof oz.getOzmalPlateKeys === 'function') return oz.getOzmalPlateKeys();
    } catch (e) { /* ignore */ }
    return FALLBACK_OZMAL_PLATE_KEYS;
  }

  function isOzmalPlate(plaka) {
    const key = plateKey(plaka);
    return key ? getOzmalPlateKeySet().has(key) : false;
  }

  const DEFAULT_BASSOFOR_PLATE = '43 ADS 408';
  const FALLBACK_BASSOFOR_KEY = plateKey(DEFAULT_BASSOFOR_PLATE);

  function isBassoforPlate(plaka) {
    try {
      const oz = typeof globalThis !== 'undefined' ? globalThis.OzmalPlates : null;
      if (oz && typeof oz.isBassoforPlate === 'function') return oz.isBassoforPlate(plaka);
    } catch (e) { /* ignore */ }
    const key = plateKey(plaka);
    return key === FALLBACK_BASSOFOR_KEY;
  }

  function ozmalRowStatusLabel(plaka) {
    if (isBassoforPlate(plaka)) return 'BAŞŞOFÖR';
    return OZMAL_VEHICLE_LABEL;
  }

  function formatOzmalPlateBbtText(bbt, ydKey) {
    const b = formatWaitingPlateBbtText(bbt);
    const yd = String(ydKey || '').trim();
    if (b && yd) return `${b} · ${yd}`;
    return b || yd || '';
  }

  function hasNakliyeBlockContent(item) {
    if (!item) return false;
    return parseNum(item.remainingBbt) > 0 || (item.waitingPlates || []).length > 0;
  }

  function hasBlockSheetContent(item) {
    if (!item) return false;
    return hasNakliyeBlockContent(item) || (item.ozmalPlates || []).length > 0;
  }

  function hasOzmalSheetContent(items) {
    return (items || []).some((item) => (item.ozmalPlates || []).length > 0);
  }

  function parseSiraNo(value) {
    const s = String(value ?? '').trim();
    if (!s) return null;
    const n = parseInt(s, 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  function comparePlatesBySira(a, b) {
    const sa = parseSiraNo(a?.sira);
    const sb = parseSiraNo(b?.sira);
    if (sa != null && sb != null && sa !== sb) return sa - sb;
    if (sa != null && sb == null) return -1;
    if (sa == null && sb != null) return 1;
    const ba = a?.isOzmal && isBassoforPlate(a.plaka) ? 1 : 0;
    const bb = b?.isOzmal && isBassoforPlate(b.plaka) ? 1 : 0;
    if (ba !== bb) return bb - ba;
    return String(a?.plaka || '').localeCompare(String(b?.plaka || ''), 'tr');
  }

  function buildPlateRowFromEntry(entry) {
    const ozmal = !!entry?.isOzmal;
    const bassofor = ozmal && isBassoforPlate(entry.plaka);
    const no = parseSiraNo(entry?.sira);
    return {
      kind: 'plate',
      no: no != null ? no : '',
      ozmal,
      bassofor,
      a: compactPlate(entry.plaka),
      b: ozmal ? ozmalRowStatusLabel(entry.plaka) : WAITING_VEHICLE_LABEL,
      c: formatWaitingPlateBbtText(entry.bbt),
    };
  }

  function buildBlockPlateRows(item) {
    const plates = (item.waitingPlates || [])
      .map((p) => Object.assign({}, p, { isOzmal: false }))
      .concat((item.ozmalPlates || []).map((p) => Object.assign({}, p, { isOzmal: true })));
    plates.sort(comparePlatesBySira);
    return plates.map(buildPlateRowFromEntry);
  }

  function buildOzmalSheetRows(items) {
    return [];
  }

  function buildExcelSheetParts(items) {
    const sheetItems = (items || []).filter(hasBlockSheetContent);
    const sourceDates = new Set(sheetItems.map((item) => item.sourceDateLabel).filter(Boolean));
    const multiSourceDates = sourceDates.size > 1;
    const nakliyeRows = [];
    sheetItems.forEach((item) => {
      buildExcelBlockRows(item, { multiSourceDates }).forEach((row) => {
        nakliyeRows.push(row);
      });
    });
    return { ozmalRows: [], nakliyeRows };
  }

  function formatWaitingPlateBbtText(bbt) {
    const n = parseNum(bbt);
    if (n > 0) return `${n} BBT`;
    return '';
  }

  function sumWaitingBbt(waitingPlates) {
    return (waitingPlates || []).reduce((s, p) => {
      const n = parseNum(p?.bbt);
      return s + (n > 0 ? n : 0);
    }, 0);
  }

  function formatFooterRemainingText(totalRemaining) {
    const n = parseNum(totalRemaining);
    if (n > 0) return `${n} BBT DAHA PLAKA VERİLECEK`;
    return 'PLAKA VERİLECEK';
  }

  function sumRemainingBbt(items) {
    return (items || []).reduce((s, item) => s + (parseNum(item?.remainingBbt) > 0 ? parseNum(item.remainingBbt) : 0), 0);
  }

  function formatHeaderExcelText(ydKey, planBbt, malzeme, sourceDateLabel) {
    let s = `${String(ydKey || 'GENEL').trim()} ${planBbt} BBT`;
    const m = String(malzeme || '').trim();
    if (m) s += ` (${m})`;
    const d = String(sourceDateLabel || '').trim();
    if (d) s = `${d} · ${s}`;
    return s;
  }

  /** Tek blok — Excel görünümü satırları (sadece gelmeyen + kalan BBT) */
  function buildExcelBlockRows(item, opts) {
    if (!item) return [];
    const multiSourceDates = !!(opts && opts.multiSourceDates);
    const rows = [];
    rows.push({
      kind: 'header',
      a: formatHeaderExcelText(
        item.ydKey,
        item.planBbt,
        item.malzemeLabel,
        multiSourceDates ? item.sourceDateLabel : ''
      ),
    });
    buildBlockPlateRows(item).forEach((row) => rows.push(row));
    const rem = parseNum(item.remainingBbt);
    if (rem > 0) {
      rows.push({
        kind: 'pending',
        a: formatFooterRemainingText(rem),
        b: '',
      });
    }
    return rows;
  }

  function buildExcelSheetRows(items) {
    return buildExcelSheetParts(items).nakliyeRows;
  }

  function groupSheetRowsByBlock(sheetRows) {
    const blocks = [];
    let cur = null;
    (sheetRows || []).forEach((row) => {
      if (!row) return;
      if (row.kind === 'ozmal-header') return;
      if (row.kind === 'header') {
        if (cur && cur.length) blocks.push(cur);
        cur = [row];
        return;
      }
      if (cur) cur.push(row);
    });
    if (cur && cur.length) blocks.push(cur);
    return blocks;
  }

  function blockVisualRows(block) {
    return Array.isArray(block) ? block.length : 0;
  }

  function countSheetPlates(sheetRows) {
    return (sheetRows || []).filter((r) => r && r.kind === 'plate').length;
  }

  function shouldUseDualColumnLayout(bodyRows, blocks) {
    const plateCount = countSheetPlates(bodyRows);
    const blockCount = (blocks || []).length;
    if (blockCount < 2) return false;
    return plateCount >= 6 || (bodyRows || []).length >= 10;
  }

  function splitBlocksIntoColumns(blocks) {
    const cols = [[], []];
    const heights = [0, 0];
    (blocks || []).forEach((block) => {
      const h = blockVisualRows(block);
      const idx = heights[0] <= heights[1] ? 0 : 1;
      cols[idx].push(block);
      heights[idx] += h;
    });
    if (!cols[1].length) return [blocks || []];
    return cols;
  }

  function flattenSheetBlocks(blockGroups) {
    const out = [];
    (blockGroups || []).forEach((group) => {
      (group || []).forEach((block) => {
        out.push.apply(out, block || []);
      });
    });
    return out;
  }

  function buildMessage(yd, planBbt, remainingBbt, waitingPlates, explicitNotes) {
    const ydPart = yd || 'GENEL';
    const planPart = planBbt != null ? `${planBbt} BBT` : 'BBT';
    const waiting = waitingPlates || [];
    if (!waiting.length && remainingBbt > 0) {
      return `${ydPart} ${planPart} için plaka verilecek`;
    }
    const noteWithQty = (explicitNotes || []).find((n) => n.remainingBbt != null);
    if (noteWithQty && noteWithQty.remainingBbt > 0) {
      return `${ydPart} ${planPart} — ${noteWithQty.remainingBbt} BBT için plaka verilecek`;
    }
    if (remainingBbt > 0) {
      return `${ydPart} ${planPart} — ${remainingBbt} BBT için plaka verilecek`;
    }
    if (waiting.length) {
      return `${ydPart} ${planPart} — ${waiting.map((p) => compactPlate(p.plaka)).join(', ')} henüz gelmedi`;
    }
    return `${ydPart} ${planPart} için plaka verilecek`;
  }

  function analyzeBlock(items) {
    if (!items || !items.length) return null;

    const sample =
      items.find((x) => !x._ihracatEmptyBlock && String(x.headerText || x.blockMeta?.mainHeader || '').trim()) ||
      items.find((x) => !x._ihracatEmptyBlock) ||
      items[0];

    const planBbt = extractPlanBbt(sample);
    if (planBbt == null || planBbt <= 0) return null;

    const explicitNotes = collectExplicitPendingNotes(items);
    const waitingPlates = [];
    const ozmalPlates = [];
    let departedBbt = 0;
    let assignedWaitingBbt = 0;

    items.forEach((r) => {
      if (r._ihracatEmptyBlock) return;
      if (parsePendingNote(r.plaka)) return;
      const plaka = String(r.plaka || '').trim();
      if (!isValidPlateCell(plaka)) return;

      const rowBbt = parseNum(r.bbt);

      if (isRowDeparted(r)) {
        departedBbt += rowBbt > 0 ? rowBbt : 0;
        return;
      }

      const entry = {
        plaka,
        bbt: rowBbt > 0 ? rowBbt : null,
        isOzmal: isOzmalPlate(plaka),
        sira: String(r.sira || '').trim(),
      };
      if (entry.isOzmal) ozmalPlates.push(entry);
      else waitingPlates.push(entry);
      if (rowBbt > 0) assignedWaitingBbt += rowBbt;
    });

    let remainingBbt = null;
    const noteWithQty = explicitNotes.find((n) => n.remainingBbt != null && n.remainingBbt > 0);
    if (noteWithQty) {
      remainingBbt = noteWithQty.remainingBbt;
    } else {
      remainingBbt = Math.max(0, planBbt - departedBbt - assignedWaitingBbt);
    }

    if (remainingBbt <= 0 && waitingPlates.length === 0 && ozmalPlates.length === 0) return null;

    const ydKey = extractYdLabel(sample);
    const port = extractPort(sample);
    const malzemeLabel = extractMalzemeLabel(sample);
    const status =
      waitingPlates.length === 0 && ozmalPlates.length > 0
        ? 'ozmal'
        : waitingPlates.length === 0
          ? 'empty'
          : 'partial';

    return {
      blockKey: blockGroupKey(sample),
      blockHeaderRow: Number(sample?.blockHeaderRow) || 0,
      fileName: rowSourceFile(sample),
      sourceDateLabel: sourceDateLabelFromRow(sample),
      ydKey,
      planBbt,
      departedBbt,
      remainingBbt,
      port,
      headerText: String(sample.headerText || sample.blockMeta?.mainHeader || '').trim(),
      malzeme: String(sample.malzeme || '').trim(),
      malzemeLabel,
      waitingPlates,
      ozmalPlates,
      explicitNotes,
      status,
      message: buildMessage(ydKey, planBbt, remainingBbt, waitingPlates, explicitNotes),
    };
  }

  function compareBlockExcelOrder(a, b) {
    const fa = String(a?.fileName || '').localeCompare(String(b?.fileName || ''), 'tr');
    if (fa !== 0) return fa;
    const ra = Number(a?.blockHeaderRow) || 0;
    const rb = Number(b?.blockHeaderRow) || 0;
    if (ra !== rb) return ra - rb;
    return String(a?.headerText || '').localeCompare(String(b?.headerText || ''), 'tr');
  }

  function analyzeNakliyePending(rows) {
    const groups = groupRowsByBlock(rows);
    const pending = [];
    groups.forEach((items) => {
      const item = analyzeBlock(items);
      if (item) pending.push(item);
    });
    pending.sort(compareBlockExcelOrder);
    return pending;
  }

  return {
    analyzeNakliyePending,
    analyzeBlock,
    buildExcelBlockRows,
    buildExcelSheetRows,
    buildExcelSheetParts,
    buildOzmalSheetRows,
    groupSheetRowsByBlock,
    shouldUseDualColumnLayout,
    splitBlocksIntoColumns,
    flattenSheetBlocks,
    blockGroupKey,
    rowSourceFile,
    sourceDateLabelFromRow,
    dateKeyFromFileName,
    compareBlockExcelOrder,
    formatHeaderExcelText,
    formatPendingExcelText,
    formatFooterRemainingText,
    sumRemainingBbt,
    formatWaitingPlateBbtText,
    sumWaitingBbt,
    extractMalzemeLabel,
    extractPlanBbt,
    extractYdLabel,
    isValidPlateCell,
    isRowDeparted,
    applyLiveDepartedMarks,
    printReportValidForMeta,
    normalizePrintReports,
    collectPrintCountByPlate,
    departedRowsChanged,
    plateKey,
    parsePendingNote,
    parseNum,
    compactPlate,
    isOzmalPlate,
    hasNakliyeBlockContent,
    hasBlockSheetContent,
    hasOzmalSheetContent,
    DEFAULT_OZMAL_PLATES,
    WAITING_VEHICLE_LABEL,
    OZMAL_VEHICLE_LABEL,
  };
});
