/**
 * İhracat Excel bloklarından nakliye bekleyen (plaka verilecek) özetini hesaplar.
 * Birim: BBT (tonaj değil).
 *
 * Kurallar:
 * - Giden tonajı dolu satır = çıkmış araç → listede gösterilmez
 * - Plaka var, giden tonaj boş = gelmeyen araç → plaka + BBT yan sütunda
 * - Yazdırma kaydı Excel'deki GELMEDİ satırını kapatmaz (kaynak Excel giden tonaj)
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

  function ydBaseKey(text) {
    const m = String(text || '').match(/\b(YD\d{1,4})\b/i);
    return m ? m[1].toUpperCase() : '';
  }

  function printReportYdKey(report) {
    const d = report && report.data && typeof report.data === 'object' ? report.data : {};
    return ydBaseKey(
      [report?.firma, d.firma, d.firmaKodu, d.firmaSelect, d.ydKey, d.headerText]
        .filter(Boolean)
        .join(' ')
    );
  }

  function rowYdBase(row) {
    return ydBaseKey([row?.ydKey, row?.firma, row?.headerText].filter(Boolean).join(' '));
  }

  function clearLiveDepartedMark(row) {
    if (!row || !row._nbLiveDeparted) return row;
    const next = Object.assign({}, row, { gidenTonaj: '' });
    delete next._nbLiveDeparted;
    return next;
  }

  function reportTimestamp(report) {
    if (!report) return 0;
    const d = report.data || {};
    return Number(report.ts || report.timestamp || d.ts || d.timestamp || 0);
  }

  function printReportValidForMeta(reportTs, meta) {
    const ts = Number(reportTs);
    if (!Number.isFinite(ts) || ts <= 0) return false;

    const importTimestamp = Number(new Date(meta?.importedAt || meta?.loadedAt || 0));
    if (importTimestamp && ts >= importTimestamp) return true;

    try {
      const tz = { timeZone: 'Europe/Istanbul' };
      const printDay = new Date(ts).toLocaleDateString('sv-SE', tz);
      const dateKey = String(meta?.dateKey || '').trim();
      if (dateKey && printDay === dateKey) return true;
      if (importTimestamp) {
        const importDay = new Date(importTimestamp).toLocaleDateString('sv-SE', tz);
        if (printDay === importDay) return true;
      }
      const today = new Date().toLocaleDateString('sv-SE', tz);
      if (printDay === today) return true;
    } catch (e) {}

    const twoDaysAgo = Date.now() - 2 * 24 * 60 * 60 * 1000;
    if (ts < twoDaysAgo) return false;

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
          firma: r.firma || d.firma || d.firmaKodu || d.firmaSelect || '',
          data: d,
        };
      })
      .filter(Boolean);
  }

  function collectPrintCountByPlate(reports, meta) {
    const map = new Map();
    collectPrintSlots(reports, meta).forEach((slot) => {
      map.set(slot.pk, (map.get(slot.pk) || 0) + 1);
    });
    return map;
  }

  function collectPrintSlots(reports, meta) {
    const slots = [];
    normalizePrintReports(reports).forEach((r) => {
      if (!printReportValidForMeta(r.ts, meta)) return;
      const d = r.data || {};
      const yd = printReportYdKey(r);
      const seen = new Set();
      [r.plaka, d.plaka, d.plate, d.cekiciPlaka, d.dorsePlaka].forEach((raw) => {
        const pk = plateKey(raw);
        if (!pk || seen.has(pk)) return;
        seen.add(pk);
        slots.push({ pk, yd, used: false });
      });
    });
    return slots;
  }

  function printSlotMatchesRow(slot, row) {
    if (!slot || slot.used || !row) return false;
    const pk = plateKey(row.plaka);
    if (!pk || slot.pk !== pk) return false;
    const rowYd = rowYdBase(row);
    if (slot.yd) return slot.yd === rowYd;
    // Baskıda YD yoksa ihracat satırını kapatma (başka iş / piyasa baskısı)
    return !rowYd;
  }

  /** Yazdırılmış / çıkış yapmış plakaları satırlara giden tonaj olarak işler (sırayla, aynı YD, çift kantar uyumlu). */
  function applyLiveDepartedMarks(rows, meta, reports) {
    const slots = collectPrintSlots(reports, meta);
    return (rows || []).map((row) => {
      if (!row || row._ihracatEmptyBlock) return row;
      const working = clearLiveDepartedMark(row);
      if (parseNum(working.gidenTonaj) > 0) return working;
      const plaka = String(working.plaka || '').trim();
      if (!isValidPlateCell(plaka)) return working;
      const slot = slots.find((s) => printSlotMatchesRow(s, working));
      if (!slot) return working;
      slot.used = true;
      const gt = parseNum(working.tonajKg) || parseNum(working.netTonaj) || parseNum(working.bbt) || 1;
      return Object.assign({}, working, { gidenTonaj: String(gt), _nbLiveDeparted: true });
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

  /** Ürün / sevkiyat lot no — her blok kendi LOT değerini taşır */
  function extractLotLabel(sample) {
    if (!sample) return '';
    const meta = sample.blockMeta || {};
    const chunks = [sample.headerText, meta.mainHeader]
      .concat(Array.isArray(meta.subLines) ? meta.subLines : [])
      .filter(Boolean)
      .join(' ');
    const m = String(chunks).match(/LOT\s*NO\s*([\d\s]+)/i);
    if (!m) return '';
    const digits = String(m[1] || '')
      .trim()
      .replace(/\s+/g, ' ');
    return digits ? `LOT ${digits}` : '';
  }

  /** Excel'deki yükleme yeri: AVDAN / 1.OSB / 2.OSB */
  function normalizeYuklemeYeri(raw) {
    const n = normTr(raw).replace(/\s+/g, ' ').trim();
    if (!n) return '';
    if (/(^|[^A-Z0-9])1\s*\.?\s*OSB([^A-Z0-9]|$)/.test(n)) return '1.OSB';
    if (/(^|[^A-Z0-9])2\s*\.?\s*OSB([^A-Z0-9]|$)/.test(n)) return '2.OSB';
    if (/(^|[^A-Z0-9])AVDAN([^A-Z0-9]|$)/.test(n)) return 'AVDAN';
    return '';
  }

  function extractYuklemeYeri(sample) {
    if (!sample) return '';
    const meta = sample.blockMeta || {};
    const chunks = [
      sample.yuklemeYeri,
      meta.yuklemeYeri,
      sample.headerText,
      meta.mainHeader,
      meta.blackLine1,
      meta.blackLine2,
      meta.footerLine,
      meta.noteLine,
      meta.exportLine,
      sample.sheetName,
      sample.fileName,
    ].concat(Array.isArray(meta.subLines) ? meta.subLines : []);
    for (const t of chunks) {
      const hit = normalizeYuklemeYeri(t);
      if (hit) return hit;
    }
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
    // Özmal plakalar bu listede gösterilmez; yalnızca nakliyeci bekleyen içerik
    return hasNakliyeBlockContent(item);
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

  function buildPlateRowFromEntry(entry, blockItem) {
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
      plaka: String(entry?.plaka || '').trim(),
      bbt: entry?.bbt != null ? entry.bbt : null,
      sira: String(entry?.sira || '').trim(),
      id: String(entry?.id || '').trim(),
      blockKey: String(entry?.blockKey || blockItem?.blockKey || '').trim(),
      fileName: String(entry?.fileName || blockItem?.fileName || '').trim(),
      rowRef: String(entry?.rowRef || '').trim(),
    };
  }

  function buildBlockPlateRows(item) {
    // Özmal / başşoför plakaları nakliyeci listesinde gösterilmez (gelmeyen olsa dahi)
    const plates = (item.waitingPlates || []).map((p) => Object.assign({}, p, { isOzmal: false }));
    plates.sort(comparePlatesBySira);
    return plates.map((p) => buildPlateRowFromEntry(p, item));
  }

  function buildOzmalSheetRows(items) {
    return [];
  }

  function buildExcelSheetParts(items, opts) {
    const sheetItems = (items || []).filter(hasBlockSheetContent);
    const multiFile =
      opts && Object.prototype.hasOwnProperty.call(opts, 'multiFile')
        ? !!opts.multiFile
        : countDistinctExcelFiles(sheetItems) > 1;
    const sourceDates = new Set(sheetItems.map((item) => item.sourceDateLabel).filter(Boolean));
    const multiSourceDates = sourceDates.size > 1;
    const nakliyeRows = [];
    sheetItems.forEach((item) => {
      buildExcelBlockRows(item, { multiFile, multiSourceDates }).forEach((row) => {
        nakliyeRows.push(row);
      });
    });
    return { ozmalRows: [], nakliyeRows, multiFile };
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

  function extractFileStemLabel(fileName) {
    return String(fileName || '')
      .trim()
      .replace(/\.xlsx?$/i, '')
      .trim();
  }

  /** Blok başlığı ön eki: dosya adından tarih, yoksa Excel dosya adı (YD33 gibi) */
  function formatBlockSourceLabel(item) {
    if (!item) return '';
    const date = String(item.sourceDateLabel || '').trim();
    if (date) return date;
    const stem = extractFileStemLabel(item.fileName);
    if (stem) return stem;
    return String(item.ydKey || '').trim();
  }

  function countDistinctExcelFiles(items) {
    const files = new Set();
    (items || []).forEach((it) => {
      const fn = String(it?.fileName || '').trim();
      if (fn) files.add(fn);
    });
    return files.size;
  }

  function formatHeaderExcelText(ydKey, planBbt, malzeme, sourcePrefix, lotLabel, yuklemeYeri) {
    let s = `${String(ydKey || 'GENEL').trim()} ${planBbt} BBT`;
    const yer = String(yuklemeYeri || '').trim();
    if (yer) s += ` · ${yer}`;
    const lot = String(lotLabel || '').trim();
    if (lot) s += ` · ${lot}`;
    const m = String(malzeme || '').trim();
    if (m) s += ` (${m})`;
    const prefix = String(sourcePrefix || '').trim();
    if (prefix) s = `${prefix} · ${s}`;
    return s;
  }

  /** Tek blok — Excel görünümü satırları (sadece gelmeyen + kalan BBT) */
  function buildExcelBlockRows(item, opts) {
    if (!item) return [];
    const multiFile = !!(opts && opts.multiFile);
    const multiSourceDates = !!(opts && opts.multiSourceDates);
    const sourcePrefix = multiFile
      ? formatBlockSourceLabel(item)
      : (multiSourceDates ? item.sourceDateLabel : '');
    const rows = [];
    rows.push({
      kind: 'header',
      a: formatHeaderExcelText(
        item.ydKey,
        item.planBbt,
        item.malzemeLabel,
        sourcePrefix,
        item.lotLabel,
        item.yuklemeYeri
      ),
      lotLabel: item.lotLabel || '',
      blockKey: String(item.blockKey || '').trim(),
      fileName: String(item.fileName || '').trim(),
    });
    buildBlockPlateRows(item).forEach((row) => rows.push(row));
    const rem = parseNum(item.remainingBbt);
    if (rem > 0) {
      rows.push({
        kind: 'pending',
        a: formatFooterRemainingText(rem),
        b: '',
        blockKey: String(item.blockKey || '').trim(),
        fileName: String(item.fileName || '').trim(),
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

  /** Aynı Excel dosyasındaki blokları birlikte tut (sütun içinde alt alta) */
  function groupItemsByExcelFile(items) {
    const map = new Map();
    const order = [];
    (items || []).forEach((it) => {
      const key = String(it?.fileName || '').trim() || '__unknown__';
      if (!map.has(key)) {
        map.set(key, []);
        order.push(key);
      }
      map.get(key).push(it);
    });
    order.sort((a, b) => a.localeCompare(b, 'tr'));
    return order
      .map((key) => {
        const group = map.get(key) || [];
        group.sort(compareBlockExcelOrder);
        return group;
      })
      .filter((group) => group.length);
  }

  function shouldUseSideBySideFiles(items) {
    return countDistinctExcelFiles(items) > 1;
  }

  function shouldUseSideBySideLayout(blocks, opts) {
    if (opts && opts.multiFile) return true;
    return false;
  }

  /** @deprecated Tek blok = tek sütun (eski); çoklu Excel için groupItemsByExcelFile kullanın */
  function layoutBlocksSideBySide(blocks) {
    return (blocks || []).map((block) => [block]);
  }

  function shouldUseDualColumnLayout(bodyRows, blocks, opts) {
    if (opts && opts.multiFile) return false;
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

      const bk = blockGroupKey(r);
      const entry = {
        plaka,
        bbt: rowBbt > 0 ? rowBbt : null,
        isOzmal: isOzmalPlate(plaka),
        sira: String(r.sira || '').trim(),
        id: String(r.id || '').trim(),
        blockKey: bk,
        fileName: rowSourceFile(r),
        rowRef: `${bk}::${plateKey(plaka)}::${String(r.sira || '').trim()}::${String(r.id || '').trim()}`,
      };
      if (entry.isOzmal) ozmalPlates.push(entry);
      else waitingPlates.push(entry);
      // Özmal BBT de plana sayılır (listede görünmese bile atanmış kabul)
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
    const lotLabel = extractLotLabel(sample);
    const yuklemeYeri = extractYuklemeYeri(sample);
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
      lotLabel,
      yuklemeYeri,
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
    groupItemsByExcelFile,
    shouldUseSideBySideFiles,
    shouldUseSideBySideLayout,
    layoutBlocksSideBySide,
    shouldUseDualColumnLayout,
    splitBlocksIntoColumns,
    flattenSheetBlocks,
    blockGroupKey,
    rowSourceFile,
    sourceDateLabelFromRow,
    dateKeyFromFileName,
    compareBlockExcelOrder,
    formatHeaderExcelText,
    formatBlockSourceLabel,
    extractFileStemLabel,
    countDistinctExcelFiles,
    formatPendingExcelText,
    formatFooterRemainingText,
    sumRemainingBbt,
    formatWaitingPlateBbtText,
    sumWaitingBbt,
    extractMalzemeLabel,
    extractLotLabel,
    extractYuklemeYeri,
    normalizeYuklemeYeri,
    extractPlanBbt,
    extractYdLabel,
    isValidPlateCell,
    isRowDeparted,
    applyLiveDepartedMarks,
    printReportValidForMeta,
    printReportYdKey,
    normalizePrintReports,
    collectPrintCountByPlate,
    collectPrintSlots,
    clearLiveDepartedMark,
    ydBaseKey,
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
