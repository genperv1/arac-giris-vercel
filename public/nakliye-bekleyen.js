(function () {
  'use strict';

  const core = window.NakliyeBekleyenCore;
  let _allItems = [];
  let _searchNeedle = '';
  /** @type {{ snapshot: object, blockKey: string, bbt: number, noteBump: number }[]} */
  let _undoStack = [];
  const UNDO_MAX = 25;
  const SITE_STORAGE_KEY = 'nb_yukleme_yeri';
  const SITE_OPTIONS = ['AVDAN', '1.OSB'];
  let _autoTimer = 0;
  let _renderBusy = false;
  let _renderQueued = false;

  function esc(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function toast(msg) {
    const el = document.getElementById('nbToast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('is-visible');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.remove('is-visible'), 2200);
  }

  async function reloadStore() {
    try {
      if (window.DailyStore && typeof DailyStore.reload === 'function') {
        await DailyStore.reload();
        return;
      }
      if (window.DailyStore && typeof DailyStore.init === 'function') {
        await DailyStore.init();
      }
    } catch (e) {}
  }

  function loadRows() {
    let rows = [];
    try {
      if (window.DailyStore && typeof DailyStore.getRows === 'function') {
        rows = DailyStore.getRows() || [];
      }
    } catch (e) {}
    if (!rows.length) {
      try {
        rows = JSON.parse(localStorage.getItem('daily_shipments_current') || '[]') || [];
      } catch (e) {
        rows = [];
      }
    }
    try {
      if (core && typeof core.repairRowSourceFiles === 'function') {
        rows = core.repairRowSourceFiles(rows, loadMeta());
      }
    } catch (e) {}
    return rows;
  }

  async function loadRowsWithLiveDeparted() {
    const rows = loadRows();
    if (!rows.length || !core) return { rows, reports: [] };
    const cleaned = rows.map((r) => (core.clearLiveDepartedMark ? core.clearLiveDepartedMark(r) : r));
    return { rows: cleaned, reports: [] };
  }

  function loadMeta() {
    try {
      if (window.DailyStore && typeof DailyStore.getMeta === 'function') {
        return DailyStore.getMeta() || {};
      }
    } catch (e) {}
    try {
      return JSON.parse(localStorage.getItem('daily_shipments_meta') || '{}') || {};
    } catch (e) {
      return {};
    }
  }

  function fmtLoadedAt(iso) {
    if (!iso) return '';
    try {
      const d = new Date(iso);
      if (isNaN(d.getTime())) return '';
      return d.toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' });
    } catch (e) {
      return '';
    }
  }

  function formatDateKeyTR(dateKey) {
    const s = String(dateKey || '').trim();
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return s || '';
    return `${m[3]}.${m[2]}.${m[1]}`;
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

  function loadSelectedSite() {
    try {
      const v = String(localStorage.getItem(SITE_STORAGE_KEY) || '').trim();
      return SITE_OPTIONS.indexOf(v) >= 0 ? v : '';
    } catch (e) {
      return '';
    }
  }

  function saveSelectedSite(site) {
    try {
      if (SITE_OPTIONS.indexOf(site) >= 0) {
        localStorage.setItem(SITE_STORAGE_KEY, site);
      } else {
        localStorage.removeItem(SITE_STORAGE_KEY);
      }
    } catch (e) {}
  }

  function syncSiteButtons() {
    const current = loadSelectedSite();
    document.querySelectorAll('[data-nb-site]').forEach((btn) => {
      const on = btn.getAttribute('data-nb-site') === current;
      btn.classList.toggle('is-on', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  function buildSheetHeadHtml(dateLabel, siteLabel) {
    const site = String(siteLabel || '').trim();
    const date = String(dateLabel || '').trim();
    if (!site && !date) return '';
    let html = '<div class="nb-sheet-head">';
    if (site) html += '<div class="nb-sheet-site">' + esc(site) + '</div>';
    if (date) html += '<div class="nb-sheet-date">' + esc(date) + '</div>';
    html += '</div>';
    return html;
  }

  function blockTitleRows(dateLabel) {
    const rows = [];
    const site = loadSelectedSite();
    if (site) rows.push({ kind: 'site', a: site });
    const date = String(dateLabel || '').trim();
    if (date) rows.push({ kind: 'date', a: date });
    return rows;
  }

  function applySheetSiteLabel() {
    const wrap = document.getElementById('nbSheetCarrier');
    if (!wrap) return;
    wrap.querySelector('.nb-sheet-head')?.remove();
    const site = loadSelectedSite();
    wrap.querySelectorAll('.nb-sheet-block-body table tbody').forEach((tbody) => {
      let tr = tbody.querySelector('tr.nb-site-hdr');
      if (!site) {
        if (tr) tr.remove();
        return;
      }
      if (!tr) {
        tr = document.createElement('tr');
        tr.className = 'nb-site-hdr';
        tr.setAttribute('data-nb-row-kind', 'site');
        const td = document.createElement('td');
        td.colSpan = 4;
        tr.appendChild(td);
        tbody.insertBefore(tr, tbody.firstChild);
      }
      const td = tr.querySelector('td');
      if (td) td.textContent = site;
    });
  }

  function resolveSheetDateLabel(meta) {
    const m = meta || {};
    const fromFile = dateKeyFromFileName(m.fileName);
    const dk = fromFile || String(m.dateKey || '').trim();
    if (dk) return formatDateKeyTR(dk);
    const iso = m.importedAt || m.loadedAt;
    if (iso) {
      try {
        const d = new Date(iso);
        if (!isNaN(d.getTime())) {
          return d.toLocaleDateString('tr-TR', { timeZone: 'Europe/Istanbul' });
        }
      } catch (e) {}
    }
    return new Date().toLocaleDateString('tr-TR', { timeZone: 'Europe/Istanbul' });
  }

  function persistRows(rows, meta) {
    const m = meta || loadMeta();
    if (window.DailyStore && typeof DailyStore.set === 'function') {
      DailyStore.set(rows, m);
      return;
    }
    try {
      localStorage.setItem('daily_shipments_current', JSON.stringify(rows));
      localStorage.setItem('daily_shipments_meta', JSON.stringify(m || {}));
    } catch (e) {}
  }

  function bumpBlockPendingNotes(rows, blockKey, deltaBbt) {
    const delta = Number(deltaBbt) || 0;
    if (!delta || !blockKey || !core) return { rows, bumped: 0 };
    let bumped = 0;
    const next = (rows || []).map((r) => {
      if (!r || core.blockGroupKey(r) !== blockKey) return r;
      const notes = Array.isArray(r.blockPendingPlakaNotes) ? r.blockPendingPlakaNotes : null;
      if (!notes || !notes.length) return r;
      let changed = false;
      const updated = notes.map((n) => {
        if (n == null || n.remainingBbt == null) return n;
        const cur = Number(n.remainingBbt) || 0;
        const nextRem = Math.max(0, cur + delta);
        if (nextRem === cur) return n;
        changed = true;
        bumped = delta;
        return {
          text: nextRem > 0 ? `${nextRem}BBT PLAKA VERİLECEK` : '',
          remainingBbt: nextRem,
        };
      });
      if (!changed) return r;
      return Object.assign({}, r, { blockPendingPlakaNotes: updated });
    });
    return { rows: next, bumped };
  }

  function parseBbtCellText(text) {
    const s = String(text || '')
      .trim()
      .replace(/,/g, '.');
    if (!s) return 0;
    const m = s.match(/(\d+(?:\.\d+)?)/);
    if (!m) return 0;
    const n = Math.round(parseFloat(m[1]));
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  function plateMetaFromTr(tr) {
    if (!tr) return null;
    return {
      plaka: tr.getAttribute('data-nb-plaka') || '',
      a: tr.getAttribute('data-nb-plaka-compact') || '',
      blockKey: tr.getAttribute('data-nb-block') || '',
      sira: tr.getAttribute('data-nb-sira') || '',
      id: tr.getAttribute('data-nb-id') || '',
      rowRef: tr.getAttribute('data-nb-ref') || '',
      bbt: Number(tr.getAttribute('data-nb-bbt') || 0) || 0,
    };
  }

  function findSampleRowForBlock(rows, blockKey) {
    if (!core || !blockKey) return null;
    return (
      (rows || []).find(
        (r) => r && !r._ihracatEmptyBlock && core.blockGroupKey(r) === blockKey && String(r.plaka || '').trim()
      ) ||
      (rows || []).find((r) => r && core.blockGroupKey(r) === blockKey) ||
      null
    );
  }

  /** Plaka satırındaki BBT değişince alttaki "BBT’ye plaka verilecektir" düşer/artar */
  async function syncPlateBbtFromDom(tr) {
    if (!core || !tr || !tr.classList.contains('nb-plate')) return;
    if (tr.classList.contains('nb-plate--ozmal')) return;

    const meta = plateMetaFromTr(tr);
    if (!meta || (!meta.plaka && !meta.a)) return;

    const bbtCell = tr.querySelector('td.nb-bbt .nb-cell');
    const plakaCell = tr.querySelector('td.nb-plaka .nb-cell');
    const newBbt = parseBbtCellText(bbtCell ? bbtCell.textContent : '');
    const newPlakaRaw = plakaCell ? String(plakaCell.textContent || '').trim() : '';

    const rows = loadRows().slice();
    const idx = findMatchingShipmentIndex(rows, meta);
    if (idx < 0) {
      toast('Satır bulunamadı — listeyi yenileyin');
      return;
    }

    const cur = rows[idx];
    const oldBbt = core.parseNum(cur.bbt) || 0;
    const blockKey = core.blockGroupKey(cur) || meta.blockKey;
    let nextRow = Object.assign({}, cur);

    if (newPlakaRaw && core.plateKey(newPlakaRaw) !== core.plateKey(cur.plaka)) {
      if (!core.isValidPlateCell(newPlakaRaw)) {
        toast('Geçersiz plaka');
        await renderList();
        return;
      }
      nextRow.plaka = newPlakaRaw;
    }

    if (newBbt === oldBbt && nextRow.plaka === cur.plaka) {
      if (bbtCell) bbtCell.textContent = newBbt > 0 ? newBbt + ' BBT' : '';
      return;
    }

    nextRow.bbt = newBbt > 0 ? String(newBbt) : '';
    rows[idx] = nextRow;

    // Atanan BBT arttıysa kalan düşer, azaldıysa artar
    const noteDelta = oldBbt - newBbt;
    const bumped = bumpBlockPendingNotes(rows, blockKey, noteDelta);
    persistRows(bumped.rows, loadMeta());

    tr.setAttribute('data-nb-bbt', String(newBbt || ''));
    if (bbtCell) bbtCell.textContent = newBbt > 0 ? newBbt + ' BBT' : '';

    if (noteDelta !== 0) {
      toast(
        noteDelta < 0
          ? newBbt + ' BBT işlendi · kalan plaka düşürüldü'
          : 'BBT güncellendi · kalan plaka artırıldı'
      );
    }
    await renderList();
  }

  /** Bloğa yeni gelmeyen plaka ekle — BBT kadar alttan düş */
  async function addPlateToBlock(blockEl) {
    if (!core || !blockEl) return;
    const blockKey =
      blockEl.getAttribute('data-nb-block') ||
      blockEl.querySelector('tr.nb-plate')?.getAttribute('data-nb-block') ||
      '';
    if (!blockKey) {
      toast('Blok anahtarı yok');
      return;
    }

    const plaka = window.prompt('Plaka girin (örn. 43 ABC 123)');
    if (plaka == null) return;
    const plakaTrim = String(plaka).trim();
    if (!core.isValidPlateCell(plakaTrim)) {
      toast('Geçersiz plaka');
      return;
    }

    const bbtRaw = window.prompt('BBT miktarı (örn. 25)', '25');
    if (bbtRaw == null) return;
    const bbt = parseBbtCellText(bbtRaw);
    if (bbt <= 0) {
      toast('BBT girin');
      return;
    }

    const rows = loadRows().slice();
    const sample = findSampleRowForBlock(rows, blockKey);
    if (!sample) {
      toast('Blok satırı bulunamadı — Excel\'i yenileyin');
      return;
    }

    const newId =
      'nb-add-' +
      Date.now().toString(36) +
      '-' +
      Math.random().toString(36).slice(2, 7);

    const newRow = Object.assign({}, sample, {
      id: newId,
      plaka: plakaTrim,
      bbt: String(bbt),
      gidenTonaj: '',
      sira: '',
      _ihracatEmptyBlock: false,
    });
    delete newRow.blockPendingPlakaNotes;

    rows.push(newRow);
    const bumped = bumpBlockPendingNotes(rows, blockKey, -bbt);
    persistRows(bumped.rows, loadMeta());
    toast(core.compactPlate(plakaTrim) + ' eklendi · ' + bbt + ' BBT düşüldü');
    await renderList();
  }

  function findMatchingShipmentIndex(rows, plateMeta) {
    if (!core || !plateMeta) return -1;
    const pk = core.plateKey(plateMeta.plaka || plateMeta.a);
    if (!pk) return -1;
    const blockKey = String(plateMeta.blockKey || '').trim();
    const sira = String(plateMeta.sira || '').trim();
    const id = String(plateMeta.id || '').trim();
    const rowRef = String(plateMeta.rowRef || '').trim();

    let best = -1;
    let bestScore = -1;
    (rows || []).forEach((r, idx) => {
      if (!r || r._ihracatEmptyBlock) return;
      if (core.isRowDeparted(r)) return;
      if (core.plateKey(r.plaka) !== pk) return;
      if (blockKey && core.blockGroupKey(r) !== blockKey) return;
      let score = 1;
      if (rowRef) {
        const ref =
          `${core.blockGroupKey(r)}::${core.plateKey(r.plaka)}::${String(r.sira || '').trim()}::${String(r.id || '').trim()}`;
        if (ref === rowRef) score += 8;
      }
      if (id && String(r.id || '').trim() === id) score += 4;
      if (sira && String(r.sira || '').trim() === sira) score += 2;
      if (score > bestScore) {
        bestScore = score;
        best = idx;
      }
    });
    return best;
  }

  function updateUndoButton() {
    const btn = document.getElementById('nbUndoBtn');
    if (!btn) return;
    const n = _undoStack.length;
    btn.disabled = n === 0;
    btn.setAttribute('aria-disabled', n === 0 ? 'true' : 'false');
    const badge = btn.querySelector('.nb-undo-badge');
    if (badge) {
      badge.textContent = n > 0 ? String(n) : '';
      badge.hidden = n === 0;
    }
  }

  function pushUndo(entry) {
    _undoStack.push(entry);
    if (_undoStack.length > UNDO_MAX) _undoStack.shift();
    updateUndoButton();
  }

  async function deletePlateByClick(tr) {
    if (!core || !tr || tr.classList.contains('nb-plate--ozmal')) return;
    const meta = {
      plaka: tr.getAttribute('data-nb-plaka') || '',
      a: tr.getAttribute('data-nb-plaka-compact') || '',
      blockKey: tr.getAttribute('data-nb-block') || '',
      sira: tr.getAttribute('data-nb-sira') || '',
      id: tr.getAttribute('data-nb-id') || '',
      rowRef: tr.getAttribute('data-nb-ref') || '',
      bbt: Number(tr.getAttribute('data-nb-bbt') || 0) || 0,
    };
    if (!meta.plaka && !meta.a) return;

    const rows = loadRows().slice();
    const idx = findMatchingShipmentIndex(rows, meta);
    if (idx < 0) {
      toast('Satır bulunamadı — listeyi yenileyin');
      return;
    }

    const snapshot = JSON.parse(JSON.stringify(rows[idx]));
    const blockKey = core.blockGroupKey(snapshot) || meta.blockKey;
    const bbt = core.parseNum(snapshot.bbt) || meta.bbt || 0;
    const notesFromDeleted = Array.isArray(snapshot.blockPendingPlakaNotes)
      ? snapshot.blockPendingPlakaNotes
      : [];

    rows.splice(idx, 1);

    // Not yalnızca silinen satırdaysa aynı bloğun kardeş satırına taşı
    if (notesFromDeleted.length && blockKey) {
      const sibIdx = rows.findIndex((r) => r && core.blockGroupKey(r) === blockKey);
      if (sibIdx >= 0) {
        const sib = rows[sibIdx];
        const existing = Array.isArray(sib.blockPendingPlakaNotes) ? sib.blockPendingPlakaNotes : [];
        if (!existing.length) {
          rows[sibIdx] = Object.assign({}, sib, { blockPendingPlakaNotes: notesFromDeleted });
        }
      }
    }

    const bumped = bumpBlockPendingNotes(rows, blockKey, bbt);
    persistRows(bumped.rows, loadMeta());

    pushUndo({
      snapshot,
      blockKey,
      bbt,
      noteBump: bumped.bumped || 0,
    });

    tr.classList.add('nb-plate--removing');
    toast(`${core.compactPlate(meta.plaka || meta.a)} silindi · Geri Al ile döndürebilirsiniz`);
    await renderList();
  }

  async function undoLastDelete() {
    if (!_undoStack.length || !core) {
      toast('Geri alınacak silme yok');
      return;
    }
    const entry = _undoStack.pop();
    updateUndoButton();
    const rows = loadRows().slice();
    let next = rows;
    if (entry.noteBump) {
      next = bumpBlockPendingNotes(next, entry.blockKey, -Math.abs(entry.noteBump)).rows;
    }
    next = next.concat([entry.snapshot]);
    persistRows(next, loadMeta());
    toast(`${core.compactPlate(entry.snapshot.plaka)} geri alındı`);
    await renderList();
  }

  function refreshExcelStatus() {}

  function filterItems(items) {
    const raw = String(_searchNeedle || '').trim();
    if (!raw) return items;
    const q = raw.toUpperCase().replace(/İ/g, 'I');
    const ydQ = core && typeof core.normalizeYdKey === 'function' ? core.normalizeYdKey(raw) : '';
    return items.filter((it) => {
      if (ydQ) {
        const ydItem =
          typeof core.normalizeYdKey === 'function'
            ? core.normalizeYdKey(it.ydKey || it.headerText || '')
            : '';
        if (ydItem && ydItem === ydQ) return true;
      }
      const hay = [
        it.ydKey,
        it.port,
        it.headerText,
        it.malzeme,
        it.lotLabel,
        it.yuklemeYeri,
        String(it.planBbt),
        String(it.remainingBbt),
        ...(it.waitingPlates || []).map((p) => p.plaka),
      ]
        .join(' ')
        .toUpperCase()
        .replace(/İ/g, 'I');
      return hay.includes(q);
    });
  }

  function sheetCaptureTarget() {
    return document.getElementById('nbSheetCarrier');
  }

  function rowDeleteBtnHtml() {
    return (
      '<button type="button" class="nb-row-del nb-no-capture" title="Satırı sil" aria-label="Satırı sil">' +
      '&times;</button>'
    );
  }

  function editableCellHtml(text, extraClass, opts) {
    const forceEdit = !!(opts && opts.alwaysEdit);
    const editOn = forceEdit || document.body.classList.contains('nb-edit-on');
    return (
      '<span class="nb-cell' +
      (extraClass ? ' ' + extraClass : '') +
      '"' +
      (editOn ? ' contenteditable="true"' : '') +
      ' spellcheck="false">' +
      esc(text) +
      '</span>'
    );
  }

  async function canvasToPngBlob(canvas) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error('PNG oluşturulamadı'));
      }, 'image/png');
    });
  }

  async function writeImageToClipboard(blob) {
    if (!navigator.clipboard || !window.ClipboardItem) return false;
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    return true;
  }

  async function shareOrDownloadImage(blob, fileName, opts) {
    const name = fileName || 'nakliye-bekleyenleri.png';
    const forceDownload = !!(opts && opts.forceDownload);
    const silent = !!(opts && opts.silent);
    if (!forceDownload) {
      const file = new File([blob], name, { type: 'image/png' });
      if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: 'Nakliye Bekleyenleri' });
        if (!silent) toast('Paylaşım menüsü açıldı');
        return 'shared';
      }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    if (!silent) toast('PNG indirildi — WhatsApp\'tan gönderin');
    return 'downloaded';
  }

  let _html2canvasPromise = null;

  function ensureHtml2Canvas() {
    if (typeof html2canvas === 'function') return Promise.resolve(true);
    if (_html2canvasPromise) return _html2canvasPromise;
    _html2canvasPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
      s.async = true;
      s.onload = () => resolve(typeof html2canvas === 'function');
      s.onerror = () => reject(new Error('html2canvas yüklenemedi'));
      document.head.appendChild(s);
    }).finally(() => {
      if (typeof html2canvas !== 'function') _html2canvasPromise = null;
    });
    return _html2canvasPromise;
  }

  function sanitizeFilePart(s) {
    return String(s || '')
      .replace(/[^\w\-ÇĞİÖŞÜçğıöşü.]+/gi, '_')
      .replace(/_+/g, '_')
      .slice(0, 48) || 'blok';
  }

  function hideForCapture(root) {
    const saved = [];
    const hide = (el) => {
      if (!el || el.nodeType !== 1) return;
      saved.push({ el, cssText: el.style.cssText });
      el.style.setProperty('display', 'none', 'important');
      el.style.setProperty('visibility', 'hidden', 'important');
    };
    if (!root) return () => {};
    root.querySelectorAll('.nb-no-capture, .nb-row-del, .nb-block-side, .nb-block-bar, button.nb-row-del').forEach(hide);
    // Bloğun yanındaki Kopyala / Plaka paneli (kardeş)
    const main = root.classList?.contains('nb-sheet-block-main')
      ? root
      : root.closest?.('.nb-sheet-block-main');
    if (main) main.querySelectorAll('.nb-block-side').forEach(hide);
    const block = root.closest?.('.nb-sheet-block') || root;
    if (block && block !== root) {
      block.querySelectorAll('.nb-block-side, .nb-no-capture').forEach(hide);
    }
    return function restore() {
      saved.forEach(({ el, cssText }) => {
        el.style.cssText = cssText;
      });
    };
  }

  /**
   * Görünen tabloyu yerinde yakala (offscreen klon boyut bozuyordu).
   * Temiz yedek: sabit genişlikte geçici kopya.
   */
  async function captureElementToBlob(target) {
    if (!target) throw new Error('Hedef yok');
    const ready = await ensureHtml2Canvas();
    if (!ready) throw new Error('html2canvas yok');

    try {
      if (document.activeElement && typeof document.activeElement.blur === 'function') {
        document.activeElement.blur();
      }
    } catch (e) {}

    const gridCount =
      target.querySelectorAll && target.querySelectorAll('.nb-sheet-grid').length
        ? target.querySelectorAll('.nb-sheet-grid').length
        : 0;
    const isFullSheet =
      target.id === 'nbSheetCarrier' ||
      (target.classList && target.classList.contains('nb-sheet-wrap')) ||
      gridCount > 1;

    const captureRoot = isFullSheet
      ? target
      : (target.classList && target.classList.contains('nb-sheet-grid') && target) ||
        target.querySelector?.('.nb-sheet-grid') ||
        target;

    const liveRect = captureRoot.getBoundingClientRect();
    const liveW = Math.round(liveRect.width);
    const liveH = Math.round(liveRect.height);

    // 1) Önce ekrandaki gerçek tabloyu yakala
    if (liveW >= 200 && liveH >= 30) {
      const restore = hideForCapture(isFullSheet ? target : captureRoot);
      document.body.classList.add('nb-is-capturing');
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      try {
        const canvas = await html2canvas(captureRoot, {
          backgroundColor: '#ffffff',
          scale: 2,
          logging: false,
          useCORS: true,
          allowTaint: true,
        });
        if (canvas.width >= 200 && canvas.height >= 30 && canvas.width / canvas.height < 40) {
          return canvasToPngBlob(canvas);
        }
      } finally {
        document.body.classList.remove('nb-is-capturing');
        restore();
      }
    }

    // 2) Yedek: sabit genişlikte temiz klon (görünür layout ile)
    const width = Math.max(liveW > 100 ? Math.min(liveW, 900) : 450, 360);
    const host = document.createElement('div');
    host.className = 'nb-capture-host';
    host.setAttribute('aria-hidden', 'true');
    host.style.cssText = [
      'position:fixed',
      'left:0',
      'top:0',
      'width:' + width + 'px',
      'max-width:' + width + 'px',
      'background:#ffffff',
      'z-index:2147483646',
      'padding:0',
      'margin:0',
      'overflow:visible',
      'pointer-events:none',
      'transform:translateY(-120%)',
    ].join(';');

    const clone = captureRoot.cloneNode(true);
    clone.querySelectorAll('.nb-no-capture, .nb-row-del, .nb-block-side, .nb-block-bar').forEach((n) => {
      n.remove();
    });
    clone.querySelectorAll('.nb-cell').forEach((cell) => {
      cell.removeAttribute('contenteditable');
      cell.style.outline = 'none';
      cell.style.background = 'transparent';
    });
    // Flex yan boşluk kalmasın
    clone.querySelectorAll('.nb-sheet-block-main').forEach((main) => {
      main.style.display = 'block';
      main.style.width = '100%';
    });
    clone.style.width = width + 'px';
    clone.style.maxWidth = width + 'px';
    clone.style.background = '#ffffff';

    host.appendChild(clone);
    document.body.appendChild(host);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

    try {
      const canvas = await html2canvas(clone, {
        backgroundColor: '#ffffff',
        scale: 2,
        logging: false,
        useCORS: true,
        width: width,
        windowWidth: width + 24,
      });
      if (canvas.height < 30) {
        throw new Error('Yakalanan görsel bozuk (çok kısa)');
      }
      return canvasToPngBlob(canvas);
    } finally {
      try {
        host.remove();
      } catch (e) {}
    }
  }

  async function deliverImageBlob(blob, fileName, preferClipboard) {
    if (preferClipboard !== false) {
      try {
        const copied = await writeImageToClipboard(blob);
        if (copied) {
          toast('Görsel kopyalandı — WhatsApp\'a yapıştırın');
          return 'copied';
        }
      } catch (e) {}
    }
    return shareOrDownloadImage(blob, fileName);
  }

  function sheetDownloadFileName() {
    const dateEl = document.querySelector('#nbSheetCarrier .nb-sheet-date');
    const date = sanitizeFilePart(dateEl ? dateEl.textContent : '');
    return date && date !== 'blok' ? 'nakliye-bekleyenleri-' + date + '.png' : 'nakliye-bekleyenleri.png';
  }

  async function captureFullSheetBlob() {
    const visible = filterItems(_allItems);
    if (!visible.length || !core) {
      toast('Kopyalanacak liste yok');
      return null;
    }

    const hasCarrier =
      visible.some((x) => core.hasNakliyeBlockContent(x)) ||
      (core.buildExcelSheetParts(visible).nakliyeRows || []).length > 0;
    if (!hasCarrier) {
      toast('Kopyalanacak nakliyeci listesi yok');
      return null;
    }

    const target = sheetCaptureTarget();
    if (!target) {
      toast('Tablo bulunamadı');
      return null;
    }

    target.classList.add('nb-sheet-capture--carrier-only');
    try {
      return await captureElementToBlob(target);
    } finally {
      target.classList.remove('nb-sheet-capture--carrier-only');
    }
  }

  async function copySheetImage() {
    const btn = document.getElementById('nbCopyAllBtn');
    const prevHtml = btn ? btn.innerHTML : '';
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Hazırlanıyor…';
    }

    try {
      const blob = await captureFullSheetBlob();
      if (!blob) return;
      await deliverImageBlob(blob, sheetDownloadFileName(), true);
    } catch (e) {
      console.error('copySheetImage', e);
      toast('Görsel kopyalanamadı');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = prevHtml;
      }
    }
  }

  async function copyBlockImage(blockEl, opts) {
    if (!blockEl) {
      toast('Blok bulunamadı');
      return;
    }
    // Sadece tablo (.nb-sheet-grid) — yan butonlar hariç
    const body = blockEl.querySelector('.nb-sheet-block-body') || blockEl;
    const grid = body.querySelector('.nb-sheet-grid') || body;
    const label = blockEl.getAttribute('data-nb-block-label') || 'blok';
    const fileName = 'nakliye-' + sanitizeFilePart(label) + '.png';
    const preferClipboard = !(opts && opts.downloadOnly);

    try {
      const blob = await captureElementToBlob(grid);
      await deliverImageBlob(blob, fileName, preferClipboard);
    } catch (e) {
      console.error('copyBlockImage', e);
      toast('Blok görseli kopyalanamadı');
    }
  }

  async function downloadSheetImage() {
    const btn = document.getElementById('nbCopyBlocksBtn');
    const prevHtml = btn ? btn.innerHTML : '';
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> İndiriliyor…';
    }

    try {
      const blob = await captureFullSheetBlob();
      if (!blob) return;
      await shareOrDownloadImage(blob, sheetDownloadFileName(), { forceDownload: true });
    } catch (e) {
      console.error('downloadSheetImage', e);
      toast('Ekran görüntüsü indirilemedi');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = prevHtml;
      }
    }
  }

  function buildSheetTableHtml(sheetRows) {
    if (!sheetRows.length) return '';
    let html =
      '<div class="nb-excel-col-letters nb-no-capture" aria-hidden="true"><table>' +
      '<colgroup><col class="col-no" /><col class="col-plaka" /><col class="col-status" /><col class="col-bbt" /></colgroup>' +
      '<tr><th>A</th><th>B</th><th>C</th><th>D</th></tr></table></div>' +
      '<div class="nb-sheet-grid"><table role="grid"><colgroup>' +
      '<col class="col-no" /><col class="col-plaka" /><col class="col-status" /><col class="col-bbt" />' +
      '</colgroup><tbody>';
    sheetRows.forEach((row) => {
      if (row.kind === 'header' || row.kind === 'pending' || row.kind === 'done' || row.kind === 'ozmal-header' || row.kind === 'site' || row.kind === 'date') {
        const cls =
          row.kind === 'header'
            ? 'nb-hdr'
            : row.kind === 'ozmal-header'
              ? 'nb-ozmal-hdr'
              : row.kind === 'site'
                ? 'nb-site-hdr'
                : row.kind === 'date'
                  ? 'nb-date-hdr'
                  : row.kind === 'done'
                    ? 'nb-done'
                    : 'nb-pending';
        html +=
          '<tr class="' +
          cls +
          '" data-nb-row-kind="' +
          esc(row.kind) +
          '"><td colspan="4" class="nb-editable-td">' +
          rowDeleteBtnHtml() +
          editableCellHtml(row.a) +
          '</td></tr>';
        return;
      }
      if (row.kind === 'plate') {
        const statusCls = row.bassofor
          ? 'nb-side-bassofor'
          : row.ozmal
            ? 'nb-side-ozmal'
            : row.inside
              ? 'nb-side-inside'
              : 'nb-side-red';
        const excludeCopy = row.ozmal || row.bassofor ? ' nb-plate--exclude-copy' : '';
        const canPersistDelete = !row.ozmal && !row.bassofor;
        html +=
          '<tr class="nb-plate' +
          (row.bassofor ? ' nb-plate--bassofor' : '') +
          (row.ozmal ? ' nb-plate--ozmal' : '') +
          (canPersistDelete ? ' nb-plate--persist-del' : '') +
          excludeCopy +
          '" data-nb-row-kind="plate" data-nb-plaka="' +
          esc(row.plaka || row.a) +
          '" data-nb-plaka-compact="' +
          esc(row.a) +
          '" data-nb-block="' +
          esc(row.blockKey || '') +
          '" data-nb-sira="' +
          esc(row.sira || '') +
          '" data-nb-id="' +
          esc(row.id || '') +
          '" data-nb-ref="' +
          esc(row.rowRef || '') +
          '" data-nb-bbt="' +
          esc(String(row.bbt != null ? row.bbt : '')) +
          '"><td class="nb-num nb-editable-td">' +
          editableCellHtml(String(row.no || '')) +
          '</td><td class="nb-plaka nb-editable-td">' +
          editableCellHtml(row.a) +
          '</td><td class="' +
          statusCls +
          ' nb-editable-td">' +
          editableCellHtml(row.b || '') +
          '</td><td class="nb-bbt nb-editable-td">' +
          rowDeleteBtnHtml() +
          editableCellHtml(row.c || '', '', { alwaysEdit: true }) +
          '</td></tr>';
      }
    });
    html += '</tbody></table></div>';
    return html;
  }

  function blockLabelFromRows(blockRows) {
    const hdr = (blockRows || []).find((r) => r && r.kind === 'header');
    return hdr && hdr.a ? String(hdr.a) : 'blok';
  }

  function siteButtonHtml(site, iconClass) {
    const on = loadSelectedSite() === site;
    return (
      '<button type="button" class="nb-btn nb-btn--site' +
      (on ? ' is-on' : '') +
      '" data-nb-site="' +
      esc(site) +
      '" aria-pressed="' +
      (on ? 'true' : 'false') +
      '" title="Bu bloğun üstüne ' +
      esc(site) +
      ' yaz">' +
      '<i class="fas ' +
      iconClass +
      '" aria-hidden="true"></i> ' +
      esc(site) +
      '</button>'
    );
  }

  function buildBlockUnitHtml(blockRows, blockIdx, title) {
    const label = blockLabelFromRows(blockRows);
    const blockKey =
      (blockRows || []).map((r) => r && r.blockKey).find((k) => k) || '';
    const titled = (title && title.length ? title : []).concat(blockRows || []);
    return (
      '<div class="nb-sheet-block" data-nb-block-idx="' +
      esc(String(blockIdx)) +
      '" data-nb-block-label="' +
      esc(label) +
      '" data-nb-block="' +
      esc(blockKey) +
      '">' +
      '<div class="nb-sheet-block-main">' +
      '<div class="nb-sheet-block-body">' +
      buildSheetTableHtml(titled) +
      '</div></div>' +
      '<div class="nb-block-bar nb-no-capture">' +
      '<div class="nb-site-group" role="group" aria-label="Yükleme yeri">' +
      siteButtonHtml('AVDAN', 'fa-map-marker-alt') +
      siteButtonHtml('1.OSB', 'fa-industry') +
      '</div>' +
      '<span class="nb-block-bar-sep" aria-hidden="true"></span>' +
      '<button type="button" class="nb-btn nb-btn--block-copy" data-nb-copy-block title="Bu bloğu görsel kopyala">' +
      '<i class="fas fa-image" aria-hidden="true"></i> Kopyala' +
      '</button>' +
      '<button type="button" class="nb-btn nb-btn--block-add" data-nb-add-plate title="Plaka + BBT ekle, alttan düş">' +
      '<i class="fas fa-plus" aria-hidden="true"></i> Plaka' +
      '</button>' +
      '</div></div>'
    );
  }

  function buildBlocksColumnHtml(blockGroups, startIdx, titleRows) {
    let idx = startIdx || 0;
    let html = '';
    (blockGroups || []).forEach((block) => {
      html += buildBlockUnitHtml(block, idx, titleRows);
      idx += 1;
    });
    return { html, nextIdx: idx };
  }

  function renderExcelSheet(items) {
    const outer = document.getElementById('nbSheetOuter');
    if (!outer || !core) return;

    if (!items.length) {
      outer.innerHTML = '';
      return;
    }

    const meta = loadMeta();
    const knownFiles =
      typeof core.listKnownExcelFiles === 'function'
        ? core.listKnownExcelFiles(items, meta)
        : [];
    const parts = core.buildExcelSheetParts(items);
    const blocks = core.groupSheetRowsByBlock(parts.nakliyeRows);
    const fileGroups =
      typeof core.groupItemsByExcelFile === 'function'
        ? core.groupItemsByExcelFile(items, knownFiles)
        : [];
    const multiFile = !!parts.multiFile || fileGroups.length > 1 || knownFiles.length > 1;
    const useSideBySide = false;
    const usePackedDual = false;
    const sourceDates = new Set(items.map((it) => it.sourceDateLabel).filter(Boolean));
    const dateLabel =
      multiFile || sourceDates.size > 1
        ? ''
        : sourceDates.size === 1
          ? [...sourceDates][0]
          : resolveSheetDateLabel(loadMeta());

    if (!parts.nakliyeRows.length) {
      outer.innerHTML = '';
      return;
    }

    const wrapExtra = useSideBySide
      ? ' nb-sheet-wrap--side nb-sheet-wrap--cols-' + Math.min(fileGroups.length, 4)
      : usePackedDual
        ? ' nb-sheet-wrap--dual'
        : '';

    let html =
      '<div class="nb-excel-window">' +
      '<div class="nb-excel-chrome nb-excel-titlebar nb-no-capture">' +
      '<i class="fas fa-file-excel" aria-hidden="true"></i>' +
      '<span>Nakliye Bekleyenleri.xlsx</span>' +
      '<span class="nb-excel-winbtns" aria-hidden="true">— □ ×</span>' +
      '</div>' +
      '<div class="nb-excel-chrome nb-excel-menu nb-no-capture">' +
      '<b>Dosya</b><span>Giriş</span><span>Ekle</span><span>Sayfa Düzeni</span><span>Formüller</span><span>Veri</span><span>Görünüm</span>' +
      '</div>' +
      '<div class="nb-excel-chrome nb-excel-formula nb-no-capture">' +
      '<span class="nb-excel-namebox">A1</span>' +
      '<span class="nb-excel-fx">fx</span>' +
      '<span class="nb-excel-fxbar">' + esc(dateLabel || 'Nakliye bekleyenleri') + '</span>' +
      '</div>' +
      '<div class="nb-excel-workspace">' +
      '<div class="nb-sheet-wrap' + wrapExtra + '" id="nbSheetCarrier">';
    const titleRows = blockTitleRows(dateLabel);
    if (useSideBySide) {
      html += '<div class="nb-sheet-columns nb-sheet-columns--side">';
      let idx = 0;
      fileGroups.forEach((fileItems) => {
        const fileParts = core.buildExcelSheetParts(fileItems, { multiFile: true });
        const fileBlocks = core.groupSheetRowsByBlock(fileParts.nakliyeRows);
        const built = buildBlocksColumnHtml(fileBlocks, idx, titleRows);
        idx = built.nextIdx;
        html += '<div class="nb-sheet-col">' + built.html + '</div>';
      });
      html += '</div>';
    } else if (usePackedDual) {
      const cols = core.splitBlocksIntoColumns(blocks);
      html += '<div class="nb-sheet-columns">';
      let idx = 0;
      cols.forEach((colBlocks) => {
        const built = buildBlocksColumnHtml(colBlocks, idx, titleRows);
        idx = built.nextIdx;
        html += '<div class="nb-sheet-col">' + built.html + '</div>';
      });
      html += '</div>';
    } else {
      html += buildBlocksColumnHtml(blocks, 0, titleRows).html;
    }
    html += '</div></div>';
    html +=
      '<div class="nb-excel-chrome nb-excel-tabs nb-no-capture">' +
      '<span class="nb-excel-tab is-on">' + esc(dateLabel || 'Nakliye') + '</span>' +
      '</div></div>';
    outer.innerHTML = html;
  }

  async function removeVisualRow(tr) {
    if (!tr) return;
    const kind = tr.getAttribute('data-nb-row-kind') || '';
    if (kind === 'plate' && tr.classList.contains('nb-plate--persist-del')) {
      await deletePlateByClick(tr);
      return;
    }
    tr.classList.add('nb-row--removing');
    toast(kind === 'header' ? 'Başlık satırı kaldırıldı' : 'Satır kaldırıldı');
    setTimeout(() => {
      const block = tr.closest('.nb-sheet-block');
      tr.remove();
      if (block && !block.querySelector('tbody tr')) {
        block.remove();
      }
    }, 120);
  }

  async function renderList() {
    if (_renderBusy) {
      _renderQueued = true;
      return;
    }
    _renderBusy = true;
    const loading = document.getElementById('nbListLoading');
    const empty = document.getElementById('nbListEmpty');
    const noExcel = document.getElementById('nbNoExcel');
    const outer = document.getElementById('nbSheetOuter');

    try {
      do {
        _renderQueued = false;
        const loaded = await loadRowsWithLiveDeparted();
        const rows = loaded && loaded.rows ? loaded.rows : loaded || [];

        if (!rows.length) {
          empty?.classList.add('hidden');
          noExcel?.classList.remove('hidden');
          outer?.classList.add('hidden');
          continue;
        }
        noExcel?.classList.add('hidden');

      if (core && typeof core.analyzeNakliyePendingFromSource === 'function') {
        _allItems = core.analyzeNakliyePendingFromSource(rows, [], loadMeta(), 'excel');
      } else {
        _allItems = core ? core.analyzeNakliyePending(rows, loadMeta()) : [];
        _allItems = (_allItems || []).filter((it) => !core || core.hasNakliyeBlockContent(it));
      }
      const visible = filterItems(_allItems);

      const hasSheet = core && visible.some((x) => core.hasBlockSheetContent(x));
      if (!hasSheet) {
        empty?.classList.remove('hidden');
        if (empty) {
          empty.textContent = _searchNeedle
            ? 'Aramaya uyan bekleyen sevkiyat yok.'
            : 'Bekleyen sevkiyat yok — Excel’de açık plaka veya kalan BBT yok.';
        }
        outer?.classList.add('hidden');
          continue;
        }
        empty?.classList.add('hidden');
        outer?.classList.remove('hidden');
        renderExcelSheet(visible);
      } while (_renderQueued);
    } catch (err) {
      console.error('nakliye-bekleyen renderList', err);
      empty?.classList.remove('hidden');
      if (empty) empty.textContent = 'Liste gösterilemedi. Sayfayı yenileyin (Ctrl+F5).';
      outer?.classList.add('hidden');
      toast('Liste hazırlanırken hata oluştu');
    } finally {
      loading?.classList.add('hidden');
      _renderBusy = false;
      if (_renderQueued) void renderList();
    }
  }

  async function refreshFromStore() {
    await reloadStore();
    refreshExcelStatus();
    await renderList();
  }

  function bindExcelLiveReload() {
    window.addEventListener('nakliye-excel-changed', () => {
      void refreshFromStore();
    });
    window.addEventListener('storage', (e) => {
      if (
        e.key === 'daily_shipments_current' ||
        e.key === 'daily_shipments_meta' ||
        e.key === 'ihracat_excel_ping'
      ) {
        void refreshFromStore();
      }
    });
    try {
      const bc = new BroadcastChannel('ihracat-excel');
      bc.onmessage = () => {
        void refreshFromStore();
      };
    } catch (e) {}
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void refreshFromStore();
    });
    if (_autoTimer) clearInterval(_autoTimer);
    _autoTimer = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      if (document.body.classList.contains('nb-edit-on')) return;
      void refreshFromStore();
    }, 60000);
  }

  function bindUiHandlers() {
    document.getElementById('nbBackBtn')?.addEventListener('click', () => {
      if (window.SessionManager && typeof SessionManager.navigateToHome === 'function') {
        SessionManager.navigateToHome();
      } else {
        location.href = 'GIRIS.html';
      }
    });

    document.getElementById('nbRefreshBtn')?.addEventListener('click', () => {
      void refreshFromStore();
    });

    document.getElementById('nbCopyAllBtn')?.addEventListener('click', copySheetImage);
    document.getElementById('nbCopyBlocksBtn')?.addEventListener('click', () => {
      void downloadSheetImage();
    });
    document.getElementById('nbEditBtn')?.addEventListener('click', () => {
      const on = document.body.classList.toggle('nb-edit-on');
      const btn = document.getElementById('nbEditBtn');
      if (btn) {
        btn.classList.toggle('is-on', on);
        btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      }
      toast(on ? 'Düzenleme açık — × ile satır silin, hücreye yazın' : 'Düzenleme kapalı');
      void renderList();
    });
    document.getElementById('nbUndoBtn')?.addEventListener('click', () => {
      void undoLastDelete();
    });

    document.getElementById('nbSearch')?.addEventListener('input', (ev) => {
      _searchNeedle = ev.target.value || '';
      renderList();
    });

    const outer = document.getElementById('nbSheetOuter');
    outer?.addEventListener('click', (e) => {
      const siteBtn = e.target.closest('[data-nb-site]');
      if (siteBtn && outer.contains(siteBtn)) {
        e.preventDefault();
        const site = siteBtn.getAttribute('data-nb-site') || '';
        const current = loadSelectedSite();
        saveSelectedSite(current === site ? '' : site);
        syncSiteButtons();
        applySheetSiteLabel();
        const selected = loadSelectedSite();
        toast(selected ? selected + ' — her bloğun üstüne yazıldı' : 'Yükleme yeri kaldırıldı');
        return;
      }
      const copyBtn = e.target.closest('[data-nb-copy-block]');
      if (copyBtn && outer.contains(copyBtn)) {
        e.preventDefault();
        const block = copyBtn.closest('.nb-sheet-block');
        void copyBlockImage(block);
        return;
      }
      const addBtn = e.target.closest('[data-nb-add-plate]');
      if (addBtn && outer.contains(addBtn)) {
        e.preventDefault();
        const block = addBtn.closest('.nb-sheet-block');
        void addPlateToBlock(block);
        return;
      }
      const delBtn = e.target.closest('.nb-row-del');
      if (delBtn && outer.contains(delBtn)) {
        e.preventDefault();
        e.stopPropagation();
        const tr = delBtn.closest('tr');
        void removeVisualRow(tr);
      }
    });

    outer?.addEventListener('focusout', (e) => {
      const cell = e.target.closest('.nb-cell');
      if (!cell || !outer.contains(cell)) return;
      const tr = cell.closest('tr.nb-plate');
      if (!tr) return;
      // BBT veya plaka hücresinden çıkınca kaydet + kalanı güncelle
      const td = cell.closest('td');
      if (!td || (!td.classList.contains('nb-bbt') && !td.classList.contains('nb-plaka'))) return;
      void syncPlateBbtFromDom(tr);
    });

    outer?.addEventListener('keydown', (e) => {
      const cell = e.target.closest('.nb-cell');
      if (!cell || !outer.contains(cell)) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        cell.blur();
      }
    });

    bindExcelLiveReload();
  }

  async function init() {
    bindUiHandlers();
    syncSiteButtons();

    try {
      if (window.SessionManager && typeof SessionManager.requireValidSession === 'function') {
        const ok = await SessionManager.requireValidSession();
        if (!ok) {
          refreshExcelStatus();
          document.getElementById('nbListLoading')?.classList.add('hidden');
          document.getElementById('nbNoExcel')?.classList.remove('hidden');
          if (document.getElementById('nbNoExcel')) {
            document.getElementById('nbNoExcel').textContent =
              'Oturum doğrulanamadı. Ana sayfadan tekrar giriş yapın.';
          }
          return;
        }
      }

      await reloadStore();

      refreshExcelStatus();
      updateUndoButton();
      await renderList();
    } catch (err) {
      console.error('nakliye-bekleyen init', err);
      refreshExcelStatus();
      updateUndoButton();
      document.getElementById('nbListLoading')?.classList.add('hidden');
      document.getElementById('nbListEmpty')?.classList.remove('hidden');
      if (document.getElementById('nbListEmpty')) {
        document.getElementById('nbListEmpty').textContent =
          'Sayfa yüklenemedi. Ctrl+F5 ile yenileyin.';
      }
      toast('Sayfa yüklenirken hata oluştu');
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
