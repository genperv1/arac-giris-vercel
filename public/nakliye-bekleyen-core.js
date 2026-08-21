/**
 * İhracat Excel bloklarından nakliye bekleyen (plaka verilecek) özetini hesaplar.
 * Birim: BBT (tonaj değil).
 *
 * Kurallar:
 * - Giden tonajı dolu satır = çıkmış araç → listede gösterilmez
 * - Plaka var, giden tonaj boş = gelmeyen araç → plaka + BBT yan sütunda
 * - Aynı YD yazdırması gelmeyen plakayı kapatır; Excel'de olmayan çıkan BBT kalandan düşer
 * - 0PLAKA0 / EU gibi sahte plaka gelmeyene yazılmaz, BBT'si plaka verilecek kalır
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

  /** 33.000 / 32.400 gibi TR binlik ayracı → kg */
  function parseKg(v) {
    const raw = String(v ?? '').trim();
    if (!raw) return 0;
    if (/^\d{1,3}(\.\d{3})+$/.test(raw)) {
      const n = parseInt(raw.replace(/\./g, ''), 10);
      return Number.isFinite(n) ? n : 0;
    }
    if (/^\d{1,3}(\.\d{3})+,\d+$/.test(raw)) {
      const n = parseFloat(raw.replace(/\./g, '').replace(',', '.'));
      return Number.isFinite(n) ? n : 0;
    }
    return parseNum(v);
  }

  function parsePendingNote(raw) {
    const norm = normTr(raw);
    if (!norm || !/PLAKA\s*VER/.test(norm)) return null;
    const m = norm.match(/(\d+)\s*BBT\s+PLAKA\s*VER/);
    if (m) return { remainingBbt: parseInt(m[1], 10), text: String(raw || '').trim() };
    return { remainingBbt: null, text: String(raw || '').trim() };
  }

  function isPlaceholderPlate(raw) {
    const compact = String(raw || '')
      .replace(/[\s\-./]+/g, '')
      .toUpperCase()
      .replace(/İ/g, 'I');
    if (!compact) return true;
    if (/PLAKA/.test(compact)) return true;
    if (/^(YOK|BOS|BEKLE|BEKLIYOR|EU|NA|YOKTUR|BELIRSIZ)$/.test(compact)) return true;
    return false;
  }

  function isValidPlateCell(raw) {
    const s = String(raw || '').trim();
    if (!s) return false;
    if (parsePendingNote(s)) return false;
    if (isPlaceholderPlate(s)) return false;
    const compact = s.replace(/[\s\-]+/g, '').toUpperCase();
    if (compact.length < 5) return false;
    if (/^\d+$/.test(compact)) return false;
    if (/^(SIRANO|TOPLAM|KALAN|BBT|TON|CUVAL|ÇUVAL|PALET)$/.test(compact)) return false;
    return /^(\d{2}[A-Z]{1,3}\d{2,5}|[A-Z0-9]{5,12})$/.test(compact);
  }

  function weightKg(row) {
    const net = parseKg(row && row.netTonaj);
    if (net > 1000) return net;
    const kg = parseKg(row && row.tonajKg);
    return kg > 1000 ? kg : 0;
  }

  /**
   * Giden tonaj dolu = araç çıkmış.
   * Excel'de NET/BBT yanlış kolona yazılmışsa veya eski yazdırma damgası
   * (giden = BBT) kalmışsa GELMEDİ plaka kapanmaz.
   */
  function isRowDeparted(row) {
    if (!row) return false;
    if (row._nbLiveDeparted && parseKg(row.gidenTonaj) > 0) return true;
    const g = parseKg(row.gidenTonaj);
    if (g <= 0) return false;
    const bbt = parseNum(row.bbt);
    const net = parseKg(row.netTonaj);
    const kg = parseKg(row.tonajKg);
    if (bbt > 0 && Math.abs(g - bbt) < 0.05) return false;
    if (net > 0 && Math.abs(g - net) < 0.05) return false;
    if (kg > 0 && Math.abs(g - kg) < 0.05) return false;
    if (g < 100) return false;
    if (kg > 0 && kg < 100 && g >= 1000) return false;
    if (net > 0 && net < 100 && g >= 1000) return false;
    if (bbt > 0 && bbt < 100 && g >= 1000) {
      const expected = bbt * 1000;
      if (expected > 0 && Math.abs(g - expected) / expected <= 0.2) {
        const realNet = weightKg(row);
        if (realNet <= 0) return false;
      }
    }
    return g >= 1000;
  }

  function collectPlanBbtCandidates(text) {
    const cleaned = String(text || '').replace(/\d+\s*BBT\s+PLAKA\s*VER[^\n]*/gi, '');
    const out = [];
    const re = /(\d+)\s*BBT\b/gi;
    let m;
    while ((m = re.exec(cleaned))) {
      const n = parseInt(m[1], 10);
      if (Number.isFinite(n) && n > 0) out.push(n);
    }
    return out;
  }

  function firstPlanBbtInText(text) {
    const nums = collectPlanBbtCandidates(text);
    if (!nums.length) return null;
    return Math.max.apply(null, nums);
  }

  function extractPlanBbt(sample, items) {
    const rows = Array.isArray(items) && items.length ? items : sample ? [sample] : [];
    let fromTotals = 0;
    for (const r of rows) {
      const t = parseNum(r && r.blockTotals && r.blockTotals.bbt);
      if (t > fromTotals) fromTotals = t;
    }
    const chunks = [];
    const pushMeta = (r) => {
      if (!r) return;
      const meta = r.blockMeta || {};
      chunks.push(
        r.headerText,
        meta.mainHeader,
        meta.footerLine,
        meta.bbtPaletLine,
        meta.bbtPaletSummary,
        meta.blackLine1,
        meta.blackLine2,
        r.blockFooterNote
      );
    };
    rows.forEach(pushMeta);
    if (sample && rows.indexOf(sample) < 0) pushMeta(sample);
    const fromHeader = firstPlanBbtInText(chunks.filter(Boolean).join(' ')) || 0;
    const plan = Math.max(fromHeader, fromTotals);
    return plan > 0 ? plan : null;
  }

  function normalizeLotKey(text) {
    const m = String(text || '').match(/LOT\s*(?:NO\s*)?([\d\s]+)/i);
    if (!m) return '';
    return String(m[1] || '').replace(/\D+/g, '');
  }

  function normalizeMalzemeKey(text) {
    return String(text || '')
      .toUpperCase()
      .replace(/İ/g, 'I')
      .replace(/,/g, '.')
      .replace(/\s+/g, '')
      .replace(/[^A-Z0-9.\-]/g, '');
  }

  function shipmentBalanceKey(item) {
    const yd = normalizeYdKey(item && (item.ydKey || item.headerText));
    if (!yd) return '';
    const mal = normalizeMalzemeKey(item && (item.malzemeLabel || item.malzeme || ''));
    const site = normalizeYuklemeYeri((item && item.yuklemeYeri) || '') || '';
    return yd + '|' + mal + '|' + site;
  }

  function rowYdKey(row) {
    if (!row) return '';
    return normalizeYdKey(
      [row.ydKey, row.firma, row.headerText, row.blockMeta && row.blockMeta.mainHeader]
        .filter(Boolean)
        .join(' ')
    );
  }

  function extractYdLabel(sample) {
    if (!sample) return 'GENEL';
    const texts = [sample.headerText, sample.blockMeta?.mainHeader, sample.ydKey, sample.firma].filter(Boolean);
    for (const t of texts) {
      const m = String(t).match(/\b(YD\d{1,4}(?:\([A-Z]\))?)/i);
      if (m) return m[1].toUpperCase();
    }
    const yd = normalizeYdKey(texts.join(' '));
    if (yd) return yd;
    return String(sample.ydKey || sample.firma || 'GENEL').trim().toUpperCase() || 'GENEL';
  }

  function extractPort(sample) {
    if (!sample) return '';
    return String(sample.sevkYeri || sample.blockMeta?.portLine || '').trim();
  }

  function rowSourceFile(row) {
    return String(row?.fileName || '').trim();
  }

  function splitExcelFileNames(raw) {
    return String(raw || '')
      .split(/\s*\+\s*/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  function isCombinedExcelFileName(fileName) {
    return splitExcelFileNames(fileName).length > 1;
  }

  function filenameMentionsYd(fileName, yd) {
    const key = String(yd || '').trim().toUpperCase();
    if (!key || !/^YD\d{1,4}$/.test(key)) return false;
    const stem = String(fileName || '');
    const fromName = normalizeYdKey(stem);
    if (fromName && fromName === key) return true;
    const re = new RegExp('(?:^|[^A-Z0-9])' + key + '(?:[^A-Z0-9]|$)', 'i');
    return re.test(stem);
  }

  function listKnownExcelFiles(rows, meta) {
    const seen = new Set();
    const out = [];
    const add = (raw) => {
      splitExcelFileNames(raw).forEach((n) => {
        if (!n || seen.has(n)) return;
        seen.add(n);
        out.push(n);
      });
    };
    const m = meta || {};
    if (Array.isArray(m.files)) m.files.forEach(add);
    if (m.fileName) add(m.fileName);
    (rows || []).forEach((r) => add(r && r.fileName));
    return out;
  }

  function dateKeyFromSingleFileName(fileName) {
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

  function dateKeyFromFileName(fileName) {
    const parts = splitExcelFileNames(fileName);
    if (parts.length > 1) return '';
    return dateKeyFromSingleFileName(fileName);
  }

  function repairRowSourceFiles(rows, meta) {
    const list = Array.isArray(rows) ? rows : [];
    const known = listKnownExcelFiles(list, meta);
    if (!list.length) return list;

    if (known.length <= 1) {
      const only = known[0] || '';
      if (!only) return list;
      return list.map((r) => {
        if (!r) return r;
        const parts = splitExcelFileNames(r.fileName);
        if (parts.length === 1 && parts[0] === only) return r;
        if (!String(r.fileName || '').trim() || parts.length !== 1) {
          return Object.assign({}, r, { fileName: only });
        }
        return r;
      });
    }

    const assigned = list.map((r) => {
      if (!r) return { row: r, file: '' };
      const parts = splitExcelFileNames(r.fileName);
      if (parts.length === 1 && known.indexOf(parts[0]) >= 0) {
        return { row: r, file: parts[0] };
      }
      const yd = normalizeYdKey([r.ydKey, r.firma, r.headerText].filter(Boolean).join(' '));
      const ydHits = yd ? known.filter((f) => filenameMentionsYd(f, yd)) : [];
      if (ydHits.length === 1) return { row: r, file: ydHits[0] };
      return { row: r, file: '' };
    });

    const used = new Set(assigned.map((a) => a.file).filter(Boolean));
    const leftover = known.filter((f) => !used.has(f));

    return assigned.map((a) => {
      if (!a.row) return a.row;
      let file = a.file;
      if (!file && leftover.length === 1) file = leftover[0];
      if (!file) file = splitExcelFileNames(a.row.fileName)[0] || '';
      if (!file || String(a.row.fileName || '').trim() === file) return a.row;
      return Object.assign({}, a.row, { fileName: file });
    });
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
    const rawFile = rowSourceFile(row);
    const fileName = isCombinedExcelFileName(rawFile) ? '' : rawFile;
    const yd = rowYdKey(row);
    let blockId = '';
    if (row.blockKey) blockId = String(row.blockKey);
    else if (row.blockHeaderRow != null) blockId = `HDR_${row.blockHeaderRow}`;
    else blockId = String(row.headerText || row.id || '').slice(0, 80);
    const header = String(row.headerText || '').replace(/\s+/g, ' ').trim().slice(0, 80);
    const key = [fileName, yd, blockId || header].filter(Boolean).join('::');
    return key;
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

  /** YD40 / YD 40 / yd40(G) → YD40 */
  function normalizeYdKey(text) {
    const m = String(text || '').match(/\bYD\s*(\d{1,4})\b/i);
    return m ? ('YD' + m[1]).toUpperCase() : '';
  }

  function ydBaseKey(text) {
    return normalizeYdKey(text);
  }

  const DEFAULT_AVG_BBT = 24;

  function estimateAvgBbt(item, fallback) {
    const samples = [];
    (item && item.waitingPlates ? item.waitingPlates : []).forEach((p) => {
      const n = parseNum(p && p.bbt);
      if (n > 0) samples.push(n);
    });
    if (!samples.length) return parseNum(fallback) > 0 ? parseNum(fallback) : DEFAULT_AVG_BBT;
    const avg = samples.reduce((s, n) => s + n, 0) / samples.length;
    return avg > 0 ? avg : DEFAULT_AVG_BBT;
  }

  /** Plaka verilmemiş kalan BBT → tahmini yükleme (çift kantar: her satır ayrı). */
  function unassignedVehicleCount(remainingBbt, avgBbt) {
    const rem = parseNum(remainingBbt);
    const avg = parseNum(avgBbt) > 0 ? parseNum(avgBbt) : DEFAULT_AVG_BBT;
    if (rem <= 0) return 0;
    return Math.max(1, Math.round(rem / avg));
  }

  /**
   * Kalan yükleme = gelmeyen plaka satırları + plaka verilmemiş BBT tahmini.
   * Aynı plaka iki üründe iki satırsa iki kez sayılır.
   */
  function remainingVehiclesForBlock(item, fallbackAvg) {
    if (!item) return 0;
    const waiting = Array.isArray(item.waitingPlates) ? item.waitingPlates.length : 0;
    const extra = unassignedVehicleCount(item.remainingBbt, estimateAvgBbt(item, fallbackAvg));
    return waiting + extra;
  }

  function summarizeIhracatBalance(items) {
    const list = Array.isArray(items) ? items : [];
    return {
      shipmentCount: list.length,
      remainingBbt: sumRemainingBbt(list),
      remainingVehicles: list.reduce((s, it) => s + remainingVehiclesForBlock(it), 0),
      waitingPlates: list.reduce((s, it) => s + ((it && it.waitingPlates) ? it.waitingPlates.length : 0), 0),
    };
  }

  function printReportBlob(report) {
    const d = report && report.data && typeof report.data === 'object' ? report.data : {};
    return [
      report && report.firma,
      report && report.malzeme,
      d.firma,
      d.firmaKodu,
      d.firmaSelect,
      d.ydKey,
      d.headerText,
      d.malzeme,
      d.yuklemeNotu,
      d.baskiNotu,
      d.not,
    ]
      .filter(Boolean)
      .join(' ');
  }

  function printReportYdKey(report) {
    return ydBaseKey(printReportBlob(report));
  }

  function printReportLotKey(report) {
    return normalizeLotKey(printReportBlob(report));
  }

  function itemLotKey(item) {
    if (!item) return '';
    return normalizeLotKey([item.lotLabel, item.headerText, item.malzeme, item.malzemeLabel].filter(Boolean).join(' '));
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

  /** Bakiye sayfası: Excel silinip yüklenince de bugün / Excel tarihi / gece vardiyası raporları taransın. */
  function istanbulDayKey(ts) {
    try {
      return new Date(ts).toLocaleDateString('sv-SE', { timeZone: 'Europe/Istanbul' });
    } catch (e) {
      return '';
    }
  }

  function printReportValidForBalance(reportTs, meta) {
    const ts = Number(reportTs);
    if (!Number.isFinite(ts) || ts <= 0) return false;
    if (Date.now() - ts > 7 * 24 * 60 * 60 * 1000) return false;
    try {
      const printDay = istanbulDayKey(ts);
      const today = istanbulDayKey(Date.now());
      if (printDay && printDay === today) return true;
      const hour = parseInt(
        new Date().toLocaleString('en-GB', { timeZone: 'Europe/Istanbul', hour: '2-digit', hour12: false }),
        10
      );
      const yest = istanbulDayKey(Date.now() - 24 * 60 * 60 * 1000);
      if (hour < 8 && printDay === yest) return true;
      const dateKey = String(meta?.dateKey || '').trim();
      if (dateKey && printDay === dateKey) return true;
      const importTimestamp = Number(new Date(meta?.importedAt || meta?.loadedAt || 0));
      if (importTimestamp) {
        const importDay = istanbulDayKey(importTimestamp);
        if (printDay === importDay) return true;
      }
    } catch (e) {}
    return printReportValidForMeta(reportTs, meta);
  }

  function reportEventBbt(report) {
    const d = report && report.data && typeof report.data === 'object' ? report.data : {};
    const n = parseNum(d.bbt);
    if (n > 0) return n;
    const top = parseNum(report && report.bbt);
    if (top > 0) return top;
    const tonaj = parseNum(d.tonaj != null ? d.tonaj : report && report.tonaj);
    if (tonaj >= 8 && tonaj <= 45) return Math.round(tonaj);
    return DEFAULT_AVG_BBT;
  }

  function collectYdReportStats(reports, meta) {
    const map = new Map();
    normalizePrintReports(reports).forEach((r) => {
      if (!printReportValidForBalance(r.ts, meta)) return;
      const yd = printReportYdKey(r);
      if (!yd) return;
      const blob = printReportBlob(r);
      const d = r.data || {};
      const malRaw = String(d.malzeme || r.malzeme || '').trim();
      const malzemeLabel = malRaw && !normalizeYdKey(malRaw) && !/^LOT\b/i.test(malRaw) ? malRaw.slice(0, 48) : '';
      const malKey = normalizeMalzemeKey(malzemeLabel);
      const site = normalizeYuklemeYeri(d.basimYeri || d.basim_yeri || '') || String(d.basimYeri || d.basim_yeri || '').trim();
      const lotKey = printReportLotKey(r);
      const groupKey = yd + '|' + malKey + '|' + site;
      let rec = map.get(groupKey);
      if (!rec) {
        rec = {
          yd,
          groupKey,
          lotKey,
          printCount: 0,
          bbt: 0,
          lastTs: 0,
          lotLabel: '',
          malzemeLabel: '',
          yuklemeYeri: '',
          ydDisplay: yd,
          lastSite: '',
        };
        map.set(groupKey, rec);
      }
      rec.printCount += 1;
      rec.bbt += reportEventBbt(r);
      if (lotKey && !rec.lotKey) rec.lotKey = lotKey;
      if (r.ts >= rec.lastTs) {
        rec.lastTs = r.ts;
        if (site) rec.lastSite = site;
        if (site) rec.yuklemeYeri = site;
        const lotDisp = extractLotLabel({ headerText: blob, blockMeta: {} });
        if (lotDisp) rec.lotLabel = lotDisp;
        if (malzemeLabel) rec.malzemeLabel = malzemeLabel;
        const disp = extractYdLabel({ headerText: blob, ydKey: yd });
        if (disp) rec.ydDisplay = disp;
      } else {
        if (!rec.malzemeLabel && malzemeLabel) rec.malzemeLabel = malzemeLabel;
        if (!rec.lotLabel) {
          const lotDisp = extractLotLabel({ headerText: blob, blockMeta: {} });
          if (lotDisp) rec.lotLabel = lotDisp;
        }
      }
    });
    const folded = new Map();
    map.forEach((rec, key) => {
      const parts = String(key).split('|');
      const yd = parts[0] || '';
      const mal = parts[1] || '';
      const site = parts[2] || '';
      if (!mal) {
        const alt = [];
        map.forEach((other, ok) => {
          const op = String(ok).split('|');
          if (op[0] === yd && op[1] && (op[2] || '') === site) alt.push(other);
        });
        if (alt.length === 1) {
          alt[0].printCount += rec.printCount;
          alt[0].bbt += rec.bbt;
          if (rec.lastTs > alt[0].lastTs) {
            alt[0].lastTs = rec.lastTs;
            if (rec.ydDisplay) alt[0].ydDisplay = rec.ydDisplay;
            if (rec.yuklemeYeri) alt[0].yuklemeYeri = rec.yuklemeYeri;
          }
          if (rec.lotLabel && !alt[0].lotLabel) alt[0].lotLabel = rec.lotLabel;
          return;
        }
      }
      folded.set(key, rec);
    });
    return folded;
  }

  function balanceRowStatus(item) {
    const plan = parseNum(item && item.planBbt);
    const rem = parseNum(item && item.remainingBbt);
    const wait = item && item.waitingPlates ? item.waitingPlates.length : 0;
    if (plan <= 0) return 'open';
    if (rem <= 0 && wait === 0) return 'done';
    if (wait > 0 && rem <= 0) return 'waiting';
    return 'open';
  }

  function reportPlateKey(report) {
    const d = report && report.data && typeof report.data === 'object' ? report.data : {};
    return plateKey(report && report.plaka ? report.plaka : d.plaka || d.plate || d.cekiciPlaka || '');
  }

  function extraReportBbtForItem(item, reports, meta) {
    const yd = normalizeYdKey(item && (item.ydKey || item.headerText));
    if (!yd) return { extra: 0, printCount: 0, bbt: 0, lastTs: 0, lastSite: '' };
    const known = new Set(Array.isArray(item && item.knownPlateKeys) ? item.knownPlateKeys : []);
    (item && item.waitingPlates ? item.waitingPlates : []).forEach((p) => {
      const pk = plateKey(p && p.plaka);
      if (pk) known.add(pk);
    });
    (item && item.ozmalPlates ? item.ozmalPlates : []).forEach((p) => {
      const pk = plateKey(p && p.plaka);
      if (pk) known.add(pk);
    });
    let extra = 0;
    let printCount = 0;
    let bbt = 0;
    let lastTs = 0;
    let lastSite = '';
    normalizePrintReports(reports).forEach((r) => {
      if (!printReportValidForBalance(r.ts, meta)) return;
      if (printReportYdKey(r) !== yd) return;
      const d = r.data || {};
      const itemMal = normalizeMalzemeKey(item && (item.malzemeLabel || item.malzeme || ''));
      const reportMal = normalizeMalzemeKey(d.malzeme || r.malzeme || '');
      if (itemMal && reportMal && itemMal !== reportMal) return;
      const itemLot = itemLotKey(item);
      const reportLot = printReportLotKey(r);
      if (itemLot && reportLot && itemLot !== reportLot) return;
      printCount += 1;
      const ev = reportEventBbt(r);
      bbt += ev;
      if (r.ts > lastTs) {
        lastTs = r.ts;
        const d = r.data || {};
        lastSite = String(d.basimYeri || d.basim_yeri || '').trim();
      }
      const pk = reportPlateKey(r);
      if (pk && known.has(pk)) return;
      extra += ev;
    });
    return { extra, printCount, bbt, lastTs, lastSite };
  }

  function pendingItemKnownPlates(item) {
    const known = new Set(Array.isArray(item && item.knownPlateKeys) ? item.knownPlateKeys : []);
    (item && item.waitingPlates ? item.waitingPlates : []).forEach((p) => {
      const pk = plateKey(p && p.plaka);
      if (pk) known.add(pk);
    });
    (item && item.ozmalPlates ? item.ozmalPlates : []).forEach((p) => {
      const pk = plateKey(p && p.plaka);
      if (pk) known.add(pk);
    });
    return known;
  }

  function scorePendingPrintTarget(item, reportLot, reportMal) {
    const itemLot = itemLotKey(item);
    const itemMal = normalizeMalzemeKey(item && (item.malzemeLabel || item.malzeme || ''));
    if (reportLot && itemLot && reportLot !== itemLot) return -1;
    if (reportMal && itemMal && reportMal !== itemMal) return -1;
    let score = 1;
    if (reportLot && itemLot && reportLot === itemLot) score += 100;
    if (reportMal && itemMal && reportMal === itemMal) score += 50;
    const rem = parseNum(item && item.remainingBbt);
    const plan = parseNum(item && item.planBbt);
    if (rem > 0) score += 10;
    if (plan > 0 && rem > 0 && rem < plan) score += 20;
    if ((item && item.waitingPlates ? item.waitingPlates : []).length) score += 5;
    return score;
  }

  /** Excel'de olmayan çıkan plaka BBT'sini ilgili YD/LOT kalanından düşer. */
  function applyExtraPrintsToPendingItems(items, reports, meta) {
    const list = (items || []).map((it) =>
      Object.assign({}, it, {
        remainingBbt: parseNum(it && it.remainingBbt),
        processedBbt: parseNum(it && it.processedBbt),
        departedBbt: parseNum(it && it.departedBbt),
        waitingPlates: Array.isArray(it && it.waitingPlates) ? it.waitingPlates.slice() : [],
        ozmalPlates: Array.isArray(it && it.ozmalPlates) ? it.ozmalPlates.slice() : [],
        knownPlateKeys: Array.isArray(it && it.knownPlateKeys) ? it.knownPlateKeys.slice() : [],
      })
    );
    normalizePrintReports(reports).forEach((r) => {
      if (!printReportValidForBalance(r.ts, meta)) return;
      const yd = printReportYdKey(r);
      if (!yd) return;
      const pk = reportPlateKey(r);
      const lot = printReportLotKey(r);
      const d = r.data || {};
      const reportMal = normalizeMalzemeKey(d.malzeme || r.malzeme || '');
      const sameYd = list.filter((it) => normalizeYdKey(it.ydKey || it.headerText) === yd);
      if (!sameYd.length) return;
      if (pk && sameYd.some((it) => pendingItemKnownPlates(it).has(pk))) return;
      let best = null;
      let bestScore = 0;
      sameYd.forEach((it) => {
        const s = scorePendingPrintTarget(it, lot, reportMal);
        if (s > bestScore) {
          bestScore = s;
          best = it;
        }
      });
      if (!best || parseNum(best.remainingBbt) <= 0) return;
      const ev = reportEventBbt(r);
      if (ev <= 0) return;
      best.remainingBbt = Math.max(0, parseNum(best.remainingBbt) - ev);
      best.processedBbt = parseNum(best.processedBbt) + ev;
      best.departedBbt = parseNum(best.departedBbt) + ev;
    });
    return list.map((it) => {
      it.message = buildMessage(it.ydKey, it.planBbt, it.remainingBbt, it.waitingPlates, it.explicitNotes);
      return it;
    });
  }

  function enrichBalanceItemsWithReports(items, reports, meta) {
    const stats = collectYdReportStats(reports, meta);
    const matchedYds = new Set();
    const enriched = (items || []).map((item) => {
      const yd = normalizeYdKey(item.ydKey || item.headerText);
      if (yd) matchedYds.add(yd);
      const st = extraReportBbtForItem(item, reports, meta);
      const plan = parseNum(item.planBbt);
      let remainingBbt = parseNum(item.remainingBbt);
      let processed = parseNum(item.processedBbt);
      if (processed <= 0) {
        processed = Math.max(0, plan - remainingBbt);
      }
      if (st.extra > 0) {
        remainingBbt = Math.max(0, remainingBbt - st.extra);
        processed += st.extra;
      }
      const next = Object.assign({}, item, {
        remainingBbt,
        processedBbt: processed,
        reportPrintCount: st.printCount,
        reportBbt: st.bbt,
        lastPrintAt: st.lastTs || 0,
        lastPrintSite: st.lastSite || '',
      });
      next.progressPct = plan > 0 ? Math.min(100, Math.round((processed / plan) * 100)) : 0;
      next.balanceStatus = balanceRowStatus(next);
      next.remainingVehicles = remainingVehiclesForBlock(next);
      return next;
    });
    const matchedKeys = new Set();
    enriched.forEach((item) => {
      const key = shipmentBalanceKey(item);
      if (key) matchedKeys.add(key);
      const yd = normalizeYdKey(item && (item.ydKey || item.headerText));
      if (yd) matchedYds.add(yd);
    });
    stats.forEach((st) => {
      const yd = st && st.yd;
      if (!yd || st.printCount <= 0) return;
      const fake = {
        ydKey: st.ydDisplay || yd,
        malzemeLabel: st.malzemeLabel || '',
        yuklemeYeri: st.yuklemeYeri || st.lastSite || '',
      };
      const key = shipmentBalanceKey(fake);
      if (key && matchedKeys.has(key)) return;
      if (matchedYds.has(yd) && !/\bHP\b/i.test(String(st.malzemeLabel || ''))) return;
      if (!normalizeMalzemeKey(st.malzemeLabel || '') && matchedYds.has(yd)) return;
      enriched.push({
        blockKey: 'REPORT_' + (st.groupKey || yd),
        ydKey: st.ydDisplay || yd,
        lotLabel: st.lotLabel || '',
        malzemeLabel: st.malzemeLabel || '',
        headerText: [st.ydDisplay || yd, st.lotLabel].filter(Boolean).join(' / '),
        yuklemeYeri: st.yuklemeYeri || st.lastSite || '',
        planBbt: 0,
        departedBbt: st.bbt,
        assignedWaitingBbt: 0,
        processedBbt: st.bbt,
        remainingBbt: 0,
        waitingPlates: [],
        ozmalPlates: [],
        knownPlateKeys: [],
        reportPrintCount: st.printCount,
        reportBbt: st.bbt,
        lastPrintAt: st.lastTs || 0,
        lastPrintSite: st.lastSite || '',
        fromReportsOnly: true,
        progressPct: 0,
        balanceStatus: 'open',
        remainingVehicles: 0,
        fileName: '',
      });
    });
    return collapsePlanItems(overlayPlanFromCatalog(enriched, items));
  }

  function compareBalanceStatus(a, b) {
    const rank = { open: 0, waiting: 1, done: 2 };
    const ra = rank[a && a.balanceStatus] != null ? rank[a.balanceStatus] : 9;
    const rb = rank[b && b.balanceStatus] != null ? rank[b.balanceStatus] : 9;
    if (ra !== rb) return ra - rb;
    return compareBlockExcelOrder(a, b);
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

  function collectPrintSlots(reports, meta, validFn) {
    const valid = typeof validFn === 'function' ? validFn : printReportValidForMeta;
    const slots = [];
    normalizePrintReports(reports).forEach((r) => {
      if (!valid(r.ts, meta)) return;
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
  function applyLiveDepartedMarks(rows, meta, reports, opts) {
    const validFn = opts && opts.forBalance ? printReportValidForBalance : printReportValidForMeta;
    const slots = collectPrintSlots(reports, meta, validFn);
    return (rows || []).map((row) => {
      if (!row || row._ihracatEmptyBlock) return row;
      const working = clearLiveDepartedMark(row);
      if (isRowDeparted(working)) return working;
      const plaka = String(working.plaka || '').trim();
      if (!isValidPlateCell(plaka)) return working;
      const slot = slots.find((s) => printSlotMatchesRow(s, working));
      if (!slot) return working;
      slot.used = true;
      const gt = parseKg(working.tonajKg) || parseKg(working.netTonaj) || parseNum(working.bbt) || 1;
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
    if (parseNum(item.remainingBbt) > 0) return true;
    if ((item.waitingPlates || []).length > 0) return true;
    return !!item._emptyYdPending;
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

  /** Blok başlığı ön eki: dosya adından tarih; YD dosya adı sarı satırda tekrarlanmaz */
  function formatBlockSourceLabel(item) {
    if (!item) return '';
    const date = String(item.sourceDateLabel || '').trim();
    if (date) return date;
    const stem = extractFileStemLabel(item.fileName);
    const yd = normalizeYdKey(item && (item.ydKey || item.headerText || stem));
    if (yd && filenameMentionsYd(stem, yd)) return '';
    if (stem) return stem;
    return String(item.ydKey || '').trim();
  }

  function countDistinctExcelFiles(items) {
    const files = new Set();
    (items || []).forEach((it) => {
      splitExcelFileNames(it?.fileName).forEach((fn) => files.add(fn));
    });
    return files.size;
  }

  function formatHeaderExcelText(ydKey, planBbt, malzeme, sourcePrefix, lotLabel) {
    const yd = String(ydKey || 'GENEL').trim();
    const plan = parseNum(planBbt);
    let s = plan > 0 ? `${yd} ${plan} BBT` : yd;
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
        item.lotLabel
      ),
      lotLabel: item.lotLabel || '',
      blockKey: String(item.blockKey || '').trim(),
      fileName: String(item.fileName || '').trim(),
    });
    buildBlockPlateRows(item).forEach((row) => rows.push(row));
    const rem = parseNum(item.remainingBbt);
    if (rem > 0 || item._emptyYdPending) {
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
  function groupItemsByExcelFile(items, knownFiles) {
    const repaired = repairRowSourceFiles(items, knownFiles ? { files: knownFiles } : {});
    const map = new Map();
    const order = [];
    (repaired || []).forEach((it) => {
      const key = splitExcelFileNames(it?.fileName)[0] || String(it?.fileName || '').trim() || '__unknown__';
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

  function analyzeBlock(items, opts) {
    if (!items || !items.length) return null;

    const sample =
      items.find((x) => !x._ihracatEmptyBlock && String(x.headerText || x.blockMeta?.mainHeader || '').trim()) ||
      items.find((x) => !x._ihracatEmptyBlock) ||
      items[0];

    const planFromHeader = extractPlanBbt(sample, items);
    let planBbt = planFromHeader;

    const explicitNotes = collectExplicitPendingNotes(items);
    const waitingPlates = [];
    const ozmalPlates = [];
    const knownPlateKeys = [];
    let departedBbt = 0;
    let assignedWaitingBbt = 0;

    items.forEach((r) => {
      if (r._ihracatEmptyBlock) return;
      if (parsePendingNote(r.plaka)) return;
      const plaka = String(r.plaka || '').trim();
      if (!isValidPlateCell(plaka)) return;
      const pk = plateKey(plaka);
      if (pk) knownPlateKeys.push(pk);

      const keepExcelPlates = !!(opts && opts.keepExcelPlates);
      const rowBbt = parseNum(r.bbt);

      if (!keepExcelPlates && isRowDeparted(r)) {
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

    const ydKey = extractYdLabel(sample);
    const hasYd = !!(ydKey && ydKey !== 'GENEL');

    if ((planBbt == null || planBbt <= 0) && (departedBbt + assignedWaitingBbt) > 0) {
      const noteQty = (explicitNotes.find((n) => n.remainingBbt != null && n.remainingBbt > 0) || {}).remainingBbt || 0;
      planBbt = departedBbt + assignedWaitingBbt + noteQty;
    }

    const includeComplete = !!(opts && opts.includeComplete);
    const emptyYdUnknownPlan =
      hasYd &&
      items.some((x) => x && x._ihracatEmptyBlock) &&
      (planBbt == null || planBbt <= 0) &&
      !waitingPlates.length &&
      !ozmalPlates.length;
    if ((planBbt == null || planBbt <= 0) && !includeComplete && !waitingPlates.length && !ozmalPlates.length) {
      if (!emptyYdUnknownPlan) return null;
    }
    if ((planBbt == null || planBbt <= 0) && includeComplete && !hasYd && !waitingPlates.length && !ozmalPlates.length) {
      return null;
    }
    if (planBbt == null || planBbt <= 0) planBbt = 0;

    let remainingBbt = null;
    const noteWithQty = explicitNotes.find((n) => n.remainingBbt != null && n.remainingBbt > 0);
    if (noteWithQty) {
      remainingBbt = noteWithQty.remainingBbt;
    } else {
      remainingBbt = Math.max(0, planBbt - departedBbt - assignedWaitingBbt);
    }

    if (remainingBbt <= 0 && waitingPlates.length === 0 && ozmalPlates.length === 0 && !includeComplete) {
      if (!emptyYdUnknownPlan) return null;
    }

    const port = extractPort(sample);
    const malzemeLabel = extractMalzemeLabel(sample);
    const lotLabel = extractLotLabel(sample);
    const yuklemeYeri = extractYuklemeYeri(sample);
    const status =
      remainingBbt <= 0 && waitingPlates.length === 0
        ? 'done'
        : waitingPlates.length === 0 && ozmalPlates.length > 0
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
      assignedWaitingBbt,
      processedBbt: departedBbt + assignedWaitingBbt,
      remainingBbt,
      port,
      headerText: String(sample.headerText || sample.blockMeta?.mainHeader || '').trim(),
      malzeme: String(sample.malzeme || '').trim(),
      malzemeLabel,
      lotLabel,
      yuklemeYeri,
      waitingPlates,
      ozmalPlates,
      knownPlateKeys,
      explicitNotes,
      status,
      _emptyYdPending: !!emptyYdUnknownPlan,
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

  function rowHasValidPlate(r) {
    if (!r || r._ihracatEmptyBlock) return false;
    return isValidPlateCell(String(r.plaka || '').trim());
  }

  function rowHasCarrierPlate(r) {
    if (!rowHasValidPlate(r)) return false;
    return !isOzmalPlate(String(r.plaka || '').trim());
  }

  function rowHasRealKgDeparture(r) {
    if (!rowHasValidPlate(r)) return false;
    const g = parseNum(r.gidenTonaj);
    const kg = weightKg(r);
    return g >= 1000 && kg >= 1000 && Math.abs(g - kg) >= 1;
  }

  function analyzeBlockGroups(groupMap) {
    const pending = [];
    groupMap.forEach((items) => {
      let item = analyzeBlock(items);
      if (!item) {
        const hasOpenPlate = items.some((r) => rowHasValidPlate(r) && !isRowDeparted(r));
        if (hasOpenPlate) item = analyzeBlock(items, { keepExcelPlates: true });
      }
      if (item) pending.push(item);
    });
    return pending;
  }

  function analyzeNakliyePending(rows, meta) {
    const repaired = repairRowSourceFiles(rows, meta);
    const pending = analyzeBlockGroups(groupRowsByBlock(repaired));
    const seen = new Set(pending.map((p) => normalizeYdKey(p.ydKey)).filter(Boolean));

    const orphans = repaired.filter((r) => {
      const yd = rowYdKey(r);
      return yd && !seen.has(yd);
    });
    if (orphans.length) {
      analyzeBlockGroups(groupRowsByBlock(orphans)).forEach((item) => {
        const yd = normalizeYdKey(item.ydKey);
        if (yd && seen.has(yd)) return;
        pending.push(item);
        if (yd) seen.add(yd);
      });
    }

    const still = repaired.filter((r) => {
      const yd = rowYdKey(r);
      return yd && !seen.has(yd);
    });
    if (still.length) {
      const byYd = new Map();
      still.forEach((r) => {
        const yd = rowYdKey(r);
        if (!byYd.has(yd)) byYd.set(yd, []);
        byYd.get(yd).push(r);
      });
      byYd.forEach((items, yd) => {
        const hasCarrier = items.some(rowHasCarrierPlate);
        const hasEmpty = items.some((r) => r && r._ihracatEmptyBlock);
        if (!hasCarrier && !hasEmpty) return;
        const reallyGone = hasCarrier && items.filter(rowHasCarrierPlate).every(rowHasRealKgDeparture);
        if (reallyGone) return;
        const item = analyzeBlock(items, hasCarrier ? { keepExcelPlates: true } : {});
        if (!item) return;
        pending.push(item);
        seen.add(yd);
      });
    }

    pending.sort(compareBlockExcelOrder);
    return pending;
  }

  /** Bakiye deneme: Excel’deki her sevkiyat bloğu (bitenler dahil). */
  function analyzeIhracatBalance(rows, meta) {
    const repaired = repairRowSourceFiles(rows, meta);
    const groups = groupRowsByBlock(repaired);
    const items = [];
    groups.forEach((blockRows) => {
      const item = analyzeBlock(blockRows, { includeComplete: true });
      if (item) items.push(item);
    });
    items.sort(compareBlockExcelOrder);
    return items;
  }

  function slimPoolBlock(item) {
    if (!item) return null;
    return {
      blockKey: String(item.blockKey || ''),
      ydKey: String(item.ydKey || ''),
      lotLabel: String(item.lotLabel || ''),
      malzemeLabel: String(item.malzemeLabel || ''),
      headerText: String(item.headerText || '').slice(0, 160),
      yuklemeYeri: String(item.yuklemeYeri || ''),
      planBbt: parseNum(item.planBbt),
      remainingBbt: parseNum(item.remainingBbt),
      processedBbt: parseNum(item.processedBbt),
      departedBbt: parseNum(item.departedBbt),
      assignedWaitingBbt: parseNum(item.assignedWaitingBbt),
      fileName: String(item.fileName || ''),
      waitingPlateCount: Array.isArray(item.waitingPlates)
        ? item.waitingPlates.length
        : parseNum(item.waitingPlateCount),
      fromPool: true,
    };
  }

  function excelSourceLabel(item) {
    const stem = extractFileStemLabel(item && item.fileName);
    if (stem) return stem;
    if (item && item.fromReportsOnly) return 'Excel yok';
    return '';
  }

  function preferNewerFileName(a, b) {
    const da = dateKeyFromFileName(a) || '';
    const db = dateKeyFromFileName(b) || '';
    if (db && da && db > da) return b;
    if (db && !da) return b;
    if (b && !a) return b;
    return a || b || '';
  }

  function mergeTwoBalanceRows(a, b) {
    const planA = parseNum(a && a.planBbt);
    const planB = parseNum(b && b.planBbt);
    const newerFile = preferNewerFileName((a && a.fileName) || '', (b && b.fileName) || '');
    const newerIsB = newerFile && newerFile === String((b && b.fileName) || '');
    const planBbt = newerIsB && planB > 0 ? planB : (planA > 0 ? planA : planB);
    const processedA = parseNum(a && a.processedBbt);
    const processedB = parseNum(b && b.processedBbt);
    const fromPlanA = !!(a && !a.fromReportsOnly);
    const fromPlanB = !!(b && !b.fromReportsOnly);
    let processed = processedA;
    if (fromPlanA && fromPlanB) processed = Math.max(processedA, processedB);
    else if (fromPlanA && b && b.fromReportsOnly) processed = processedA > 0 ? processedA : processedB;
    else if (fromPlanB && a && a.fromReportsOnly) processed = processedB > 0 ? processedB : processedA;
    else processed = processedA + processedB;
    const remainingBbt = planBbt > 0 ? Math.max(0, planBbt - processed) : 0;
    const next = Object.assign({}, planA > 0 || fromPlanA ? a : b, b && fromPlanB && (newerIsB || planA <= 0) ? b : {}, {
      planBbt,
      processedBbt: processed,
      remainingBbt,
      fileName: newerFile || (a && a.fileName) || (b && b.fileName) || '',
      lotLabel: (b && b.lotLabel) || (a && a.lotLabel) || '',
      malzemeLabel: (a && a.malzemeLabel) || (b && b.malzemeLabel) || '',
      yuklemeYeri: (a && a.yuklemeYeri) || (b && b.yuklemeYeri) || '',
      ydKey: (a && a.ydKey) || (b && b.ydKey) || '',
      reportPrintCount: parseNum(a && a.reportPrintCount) + (fromPlanA && fromPlanB ? 0 : parseNum(b && b.reportPrintCount)),
      fromReportsOnly: !(planBbt > 0 || fromPlanA || fromPlanB),
    });
    if (fromPlanA || fromPlanB || planBbt > 0) next.fromReportsOnly = false;
    next.progressPct = planBbt > 0 ? Math.min(100, Math.round((processed / planBbt) * 100)) : 0;
    next.balanceStatus = balanceRowStatus(next);
    return next;
  }

  function collapsePlanItems(items) {
    const map = new Map();
    const orphans = [];
    (items || []).forEach((it, idx) => {
      const key = shipmentBalanceKey(it);
      if (!key) {
        orphans.push(it);
        return;
      }
      const prev = map.get(key);
      if (!prev) map.set(key, Object.assign({}, it));
      else map.set(key, mergeTwoBalanceRows(prev, it));
    });
    const list = Array.from(map.values());
    const byYdSite = new Map();
    list.forEach((it) => {
      const yd = normalizeYdKey(it.ydKey || it.headerText);
      const site = normalizeYuklemeYeri(it.yuklemeYeri || '') || '';
      const mal = normalizeMalzemeKey(it.malzemeLabel || it.malzeme || '');
      const k = yd + '||' + site;
      if (!byYdSite.has(k)) byYdSite.set(k, { withMal: [], noMal: [] });
      if (mal) byYdSite.get(k).withMal.push(it);
      else byYdSite.get(k).noMal.push(it);
    });
    const drop = new Set();
    byYdSite.forEach((g) => {
      if (g.noMal.length && g.withMal.length === 1) {
        g.noMal.forEach((empty) => {
          const target = g.withMal[0];
          const merged = mergeTwoBalanceRows(target, empty);
          Object.keys(merged).forEach((k) => { target[k] = merged[k]; });
          drop.add(empty);
        });
      }
    });
    return list.filter((it) => !drop.has(it)).concat(orphans);
  }

  function findReportStatsForItem(item, stats) {
    const yd = normalizeYdKey(item && (item.ydKey || item.headerText));
    if (!yd || !stats || typeof stats.forEach !== 'function') return null;
    const mal = normalizeMalzemeKey(item && (item.malzemeLabel || item.malzeme || ''));
    const site = normalizeYuklemeYeri((item && item.yuklemeYeri) || '') || '';
    const hits = [];
    stats.forEach((st) => {
      if (!st || st.yd !== yd) return;
      const stMal = normalizeMalzemeKey(st.malzemeLabel || '');
      const stSite = normalizeYuklemeYeri(st.yuklemeYeri || st.lastSite || '') || '';
      if (mal && stMal && mal !== stMal) return;
      if (site && stSite && site !== stSite) return;
      hits.push(st);
    });
    if (!hits.length) return null;
    if (hits.length === 1) return hits[0];
    const combined = {
      groupKey: hits.map((h) => h.groupKey).join('+'),
      yd,
      printCount: 0,
      bbt: 0,
      lastTs: 0,
      lastSite: '',
      yuklemeYeri: site,
      lotLabel: item.lotLabel || '',
      malzemeLabel: item.malzemeLabel || '',
      ydDisplay: item.ydKey || yd,
    };
    hits.forEach((h) => {
      combined.printCount += h.printCount || 0;
      combined.bbt += h.bbt || 0;
      if ((h.lastTs || 0) > combined.lastTs) {
        combined.lastTs = h.lastTs;
        combined.lastSite = h.lastSite || combined.lastSite;
        combined.yuklemeYeri = h.yuklemeYeri || combined.yuklemeYeri;
      }
      if (h.lotLabel && !combined.lotLabel) combined.lotLabel = h.lotLabel;
      if (h.malzemeLabel && !combined.malzemeLabel) combined.malzemeLabel = h.malzemeLabel;
    });
    return combined;
  }

  function overlayPlanFromCatalog(items, catalog) {
    const cat = Array.isArray(catalog) ? catalog : [];
    const byKey = new Map();
    const byYdMal = new Map();
    const byYd = new Map();
    cat.forEach((p) => {
      const yd = normalizeYdKey(p && (p.ydKey || p.headerText));
      if (!yd || parseNum(p && p.planBbt) <= 0) return;
      const key = shipmentBalanceKey(p);
      if (key) byKey.set(key, p);
      const mal = normalizeMalzemeKey(p.malzemeLabel || p.malzeme || '');
      if (mal) byYdMal.set(yd + '|' + mal, p);
      if (!byYd.has(yd)) byYd.set(yd, []);
      byYd.get(yd).push(p);
    });
    return (items || []).map((it) => {
      const yd = normalizeYdKey(it && (it.ydKey || it.headerText));
      const mal = normalizeMalzemeKey(it && (it.malzemeLabel || it.malzeme || ''));
      const key = shipmentBalanceKey(it);
      const hit = (key && byKey.get(key))
        || (mal && byYdMal.get(yd + '|' + mal))
        || ((byYd.get(yd) || []).length === 1 ? byYd.get(yd)[0] : null);
      if (parseNum(it && it.planBbt) > 0) {
        if (hit && hit.fileName) {
          return Object.assign({}, it, {
            fileName: preferNewerFileName(it.fileName, hit.fileName) || it.fileName || hit.fileName,
            malzemeLabel: it.malzemeLabel || hit.malzemeLabel || '',
            lotLabel: it.lotLabel || hit.lotLabel || '',
          });
        }
        return it;
      }
      if (!hit) return it;
      const planBbt = parseNum(hit.planBbt);
      const processed = parseNum(it.processedBbt) || parseNum(it.departedBbt) || parseNum(it.reportBbt);
      const remainingBbt = Math.max(0, planBbt - processed);
      const next = Object.assign({}, it, {
        planBbt,
        remainingBbt,
        processedBbt: processed,
        fileName: it.fileName || hit.fileName || '',
        malzemeLabel: it.malzemeLabel || hit.malzemeLabel || '',
        lotLabel: it.lotLabel || hit.lotLabel || '',
        yuklemeYeri: it.yuklemeYeri || hit.yuklemeYeri || '',
        fromReportsOnly: false,
        fromPlanOverlay: true,
      });
      next.progressPct = planBbt > 0 ? Math.min(100, Math.round((processed / planBbt) * 100)) : 0;
      next.balanceStatus = balanceRowStatus(next);
      return next;
    });
  }

  function buildBalanceRowsFromPlanAndReports(planItems, reports, meta) {
    const collapsedPlans = collapsePlanItems(planItems || []);
    const stats = collectYdReportStats(reports, meta);
    const used = new Set();
    const rows = collapsedPlans.map((item) => {
      const st = findReportStatsForItem(item, stats);
      if (st) {
        String(st.groupKey || '').split('+').forEach((k) => { if (k) used.add(k); });
        used.add(st.groupKey);
      }
      const plan = parseNum(item && item.planBbt);
      let processedOut;
      let remaining;
      if (st) {
        processedOut = parseNum(st.bbt);
        remaining = plan > 0 ? Math.max(0, plan - processedOut) : 0;
      } else {
        processedOut = parseNum(item && item.processedBbt);
        if (processedOut <= 0 && plan > 0) processedOut = Math.max(0, plan - parseNum(item && item.remainingBbt));
        remaining = plan > 0 ? Math.max(0, plan - processedOut) : parseNum(item && item.remainingBbt);
      }
      const next = Object.assign({}, item, {
        processedBbt: processedOut,
        remainingBbt: remaining,
        reportPrintCount: st ? st.printCount : item.reportPrintCount || 0,
        reportBbt: st ? st.bbt : item.reportBbt || 0,
        lastPrintAt: st ? st.lastTs : item.lastPrintAt || 0,
        lastPrintSite: st ? st.lastSite : item.lastPrintSite || '',
        fromReportsOnly: false,
      });
      if (st && st.yuklemeYeri && !next.yuklemeYeri) next.yuklemeYeri = st.yuklemeYeri;
      next.progressPct = plan > 0 ? Math.min(100, Math.round((processedOut / plan) * 100)) : 0;
      next.balanceStatus = balanceRowStatus(next);
      next.remainingVehicles = remainingVehiclesForBlock(next);
      return next;
    });
    stats.forEach((st) => {
      if (!st || used.has(st.groupKey) || st.printCount <= 0) return;
      rows.push({
        blockKey: 'REPORT_' + (st.groupKey || st.yd),
        ydKey: st.ydDisplay || st.yd,
        lotLabel: st.lotLabel || '',
        malzemeLabel: st.malzemeLabel || '',
        headerText: [st.ydDisplay || st.yd, st.lotLabel].filter(Boolean).join(' / '),
        yuklemeYeri: st.yuklemeYeri || st.lastSite || '',
        planBbt: 0,
        departedBbt: st.bbt,
        assignedWaitingBbt: 0,
        processedBbt: st.bbt,
        remainingBbt: 0,
        waitingPlates: [],
        ozmalPlates: [],
        knownPlateKeys: [],
        reportPrintCount: st.printCount,
        reportBbt: st.bbt,
        lastPrintAt: st.lastTs || 0,
        lastPrintSite: st.lastSite || '',
        fromReportsOnly: true,
        progressPct: 0,
        balanceStatus: 'open',
        remainingVehicles: 0,
        fileName: '',
      });
    });
    return collapsePlanItems(overlayPlanFromCatalog(rows, collapsedPlans));
  }

  function compactPlanRecords(items, meta) {
    const fallback = String((meta && (meta.fileName || meta.sheetName)) || 'excel').trim() || 'excel';
    return (items || [])
      .map((it) => {
        if (!it) return null;
        const planBbt = parseNum(it.planBbt);
        const ydKey = String(it.ydKey || '').trim();
        if (!ydKey && planBbt <= 0) return null;
        return {
          fileName: String(it.fileName || fallback).trim() || fallback,
          blockKey: String(it.blockKey || ''),
          ydKey,
          lotLabel: String(it.lotLabel || ''),
          malzemeLabel: String(it.malzemeLabel || ''),
          headerText: String(it.headerText || '').slice(0, 160),
          yuklemeYeri: String(it.yuklemeYeri || ''),
          planBbt,
          remainingBbt: parseNum(it.remainingBbt),
          processedBbt: parseNum(it.processedBbt),
        };
      })
      .filter(Boolean);
  }

  function buildPoolSourcesFromItems(items, meta) {
    const groups = new Map();
    const fallbackName = String((meta && (meta.fileName || meta.sheetName)) || 'excel').trim() || 'excel';
    (items || []).forEach((it) => {
      if (!it) return;
      const fn = String(it.fileName || fallbackName).trim() || fallbackName;
      if (!groups.has(fn)) groups.set(fn, []);
      groups.get(fn).push(it);
    });
    const importedAt = (meta && (meta.importedAt || meta.loadedAt)) || new Date().toISOString();
    const dateKey = String((meta && meta.dateKey) || '').trim();
    const sources = [];
    groups.forEach((fileItems, fileName) => {
      const blocks = fileItems.map(slimPoolBlock).filter(Boolean);
      if (!blocks.length) return;
      sources.push({
        fileName,
        dateKey: dateKey || dateKeyFromFileName(fileName),
        importedAt,
        blocks,
      });
    });
    return sources;
  }

  function buildPoolSourcesFromRows(rows, meta) {
    const groups = new Map();
    const fallbackName = String((meta && (meta.fileName || meta.sheetName)) || 'excel').trim() || 'excel';
    (rows || []).forEach((r) => {
      if (!r) return;
      const fn = String(r.fileName || fallbackName).trim() || fallbackName;
      if (!groups.has(fn)) groups.set(fn, []);
      groups.get(fn).push(r);
    });
    const importedAt = (meta && (meta.importedAt || meta.loadedAt)) || new Date().toISOString();
    const dateKey = String((meta && meta.dateKey) || '').trim();
    const sources = [];
    groups.forEach((fileRows, fileName) => {
      const items = analyzeIhracatBalance(fileRows) || [];
      const blocks = items.map(slimPoolBlock).filter(Boolean);
      if (!blocks.length) return;
      sources.push({
        fileName,
        dateKey: dateKey || dateKeyFromFileName(fileName),
        importedAt,
        blocks,
      });
    });
    return sources;
  }

  function poolItemsFromSources(sources) {
    const items = [];
    (sources || []).forEach((src) => {
      (src && src.blocks ? src.blocks : []).forEach((b) => {
        if (!b) return;
        items.push(Object.assign({}, b, {
          waitingPlates: Array.isArray(b.waitingPlates) ? b.waitingPlates : [],
          ozmalPlates: [],
          fromPool: true,
          fileName: b.fileName || (src && src.fileName) || '',
        }));
      });
    });
    return items;
  }

  function mergeLocalAndPoolItems(localItems, poolItems) {
    const local = collapsePlanItems(Array.isArray(localItems) ? localItems : []);
    const pool = collapsePlanItems(Array.isArray(poolItems) ? poolItems : []);
    const seen = new Set();
    const out = [];
    local.forEach((it) => {
      const key = shipmentBalanceKey(it);
      if (key) seen.add(key);
      const yd = normalizeYdKey(it && (it.ydKey || it.headerText));
      if (yd && !normalizeMalzemeKey(it && (it.malzemeLabel || it.malzeme || ''))) seen.add('YD:' + yd);
      out.push(it);
    });
    pool.forEach((it) => {
      const key = shipmentBalanceKey(it);
      if (key && seen.has(key)) {
        const idx = out.findIndex((row) => shipmentBalanceKey(row) === key);
        if (idx >= 0) out[idx] = mergeTwoBalanceRows(out[idx], it);
        return;
      }
      const yd = normalizeYdKey(it && (it.ydKey || it.headerText));
      if (yd && !normalizeMalzemeKey(it && (it.malzemeLabel || it.malzeme || '')) && seen.has('YD:' + yd)) return;
      if (key) seen.add(key);
      out.push(it);
    });
    return collapsePlanItems(out);
  }

  return {
    analyzeNakliyePending,
    analyzeIhracatBalance,
    slimPoolBlock,
    buildPoolSourcesFromRows,
    buildPoolSourcesFromItems,
    compactPlanRecords,
    poolItemsFromSources,
    mergeLocalAndPoolItems,
    collapsePlanItems,
    shipmentBalanceKey,
    normalizeMalzemeKey,
    overlayPlanFromCatalog,
    buildBalanceRowsFromPlanAndReports,
    excelSourceLabel,
    findReportStatsForItem,
    rowYdKey,
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
    splitExcelFileNames,
    repairRowSourceFiles,
    listKnownExcelFiles,
    filenameMentionsYd,
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
    printReportValidForBalance,
    printReportYdKey,
    normalizePrintReports,
    collectPrintCountByPlate,
    collectPrintSlots,
    collectYdReportStats,
    enrichBalanceItemsWithReports,
    extraReportBbtForItem,
    applyExtraPrintsToPendingItems,
    isPlaceholderPlate,
    parseKg,
    balanceRowStatus,
    compareBalanceStatus,
    clearLiveDepartedMark,
    ydBaseKey,
    departedRowsChanged,
    plateKey,
    parsePendingNote,
    parseNum,
    compactPlate,
    normalizeYdKey,
    normalizeLotKey,
    estimateAvgBbt,
    unassignedVehicleCount,
    remainingVehiclesForBlock,
    summarizeIhracatBalance,
    DEFAULT_AVG_BBT,
    isOzmalPlate,
    hasNakliyeBlockContent,
    hasBlockSheetContent,
    hasOzmalSheetContent,
    DEFAULT_OZMAL_PLATES,
    WAITING_VEHICLE_LABEL,
    OZMAL_VEHICLE_LABEL,
  };
});
