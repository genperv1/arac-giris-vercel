(function () {
  'use strict';

  const core = window.NakliyeBekleyenCore;
  let _allItems = [];
  let _searchNeedle = '';

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

  function loadRows() {
    try {
      if (window.DailyStore && typeof DailyStore.getRows === 'function') {
        return DailyStore.getRows() || [];
      }
    } catch (e) {}
    try {
      return JSON.parse(localStorage.getItem('daily_shipments_current') || '[]') || [];
    } catch (e) {
      return [];
    }
  }

  function fetchWithTimeout(url, options, ms) {
    const timeoutMs = Number(ms) > 0 ? Number(ms) : 12000;
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller
      ? setTimeout(() => {
          try {
            controller.abort();
          } catch (e) {}
        }, timeoutMs)
      : null;
    const opts = Object.assign({}, options || {});
    if (controller) opts.signal = controller.signal;
    return fetch(url, opts).finally(() => {
      if (timer) clearTimeout(timer);
    });
  }

  async function fetchPrintReports(force) {
    if (!force && typeof window._ihracatFetchRemotePrintReports === 'function') {
      try {
        const cached = await window._ihracatFetchRemotePrintReports(false);
        if (Array.isArray(cached) && cached.length) return cached;
      } catch (e) {}
    }

    try {
      const r = await fetchWithTimeout('/api/reports?limit=2000&_=' + Date.now(), {
        method: 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' },
      }, 12000);
      if (r.ok) {
        const data = await r.json();
        if (Array.isArray(data) && data.length) return data;
      }
    } catch (e) {
      console.warn('Nakliye: /api/reports alınamadı', e);
    }

    try {
      const local = JSON.parse(localStorage.getItem('report_events_v1') || '[]');
      if (Array.isArray(local) && local.length) {
        return local.filter((x) => String(x?.type || '').toUpperCase() === 'PRINT');
      }
    } catch (e) {}

    return window.__ihracatRemotePrintCache?.reports || [];
  }

  async function loadRowsWithLiveDeparted(forceReports) {
    const meta = loadMeta();
    let rows = loadRows();
    if (!rows.length || !core) return rows;

    const reports = await fetchPrintReports(!!forceReports);
    const enriched = core.applyLiveDepartedMarks(rows, meta, reports);
    if (core.departedRowsChanged(rows, enriched)) {
      if (window.DailyStore && typeof DailyStore.set === 'function') {
        DailyStore.set(enriched, meta);
      } else {
        try {
          localStorage.setItem('daily_shipments_current', JSON.stringify(enriched));
        } catch (e) {}
      }
      rows = enriched;
    }
    return rows;
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

  function refreshExcelStatus() {
    const el = document.getElementById('nbExcelStatus');
    if (!el) return;
    const meta = loadMeta();
    const rows = loadRows();
    const files = []
      .concat(meta.fileName ? [meta.fileName] : [])
      .concat(Array.isArray(meta.files) ? meta.files : [])
      .filter(Boolean);
    const when = fmtLoadedAt(meta.importedAt || meta.loadedAt);
    if (!rows.length) {
      el.innerHTML =
        '<span class="nb-excel-no">İHRACAT Excel yüklü değil</span> — ana sayfadan Excel yükleyin.';
      return;
    }
    el.innerHTML =
      '<span class="nb-excel-ok">İHRACAT Excel yüklü</span>' +
      (files.length ? ' · ' + esc(files[0]) : '') +
      (when ? ' · ' + esc(when) : '');
  }

  function filterItems(items) {
    const q = String(_searchNeedle || '')
      .trim()
      .toUpperCase()
      .replace(/İ/g, 'I');
    if (!q) return items;
    return items.filter((it) => {
      const hay = [
        it.ydKey,
        it.port,
        it.headerText,
        it.malzeme,
        String(it.planBbt),
        String(it.remainingBbt),
        ...(it.waitingPlates || []).map((p) => p.plaka),
        ...(it.ozmalPlates || []).map((p) => p.plaka),
        'ÖZMAL',
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

  async function shareOrDownloadImage(blob) {
    const file = new File([blob], 'nakliye-bekleyenleri.png', { type: 'image/png' });
    if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: 'Nakliye Bekleyenleri' });
      toast('Paylaşım menüsü açıldı');
      return;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'nakliye-bekleyenleri.png';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast('PNG indirildi — WhatsApp\'tan gönderin');
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

  async function copySheetImage() {
    const visible = filterItems(_allItems);
    if (!visible.length || !core) {
      toast('Kopyalanacak liste yok');
      return;
    }

    const hasCarrier =
      visible.some((x) => core.hasNakliyeBlockContent(x)) ||
      (core.buildExcelSheetParts(visible).nakliyeRows || []).length > 0;
    if (!hasCarrier) {
      toast('Kopyalanacak nakliyeci listesi yok');
      return;
    }

    const target = sheetCaptureTarget();
    if (!target) {
      toast('Tablo bulunamadı');
      return;
    }
    try {
      const ready = await ensureHtml2Canvas();
      if (!ready) {
        toast('Görsel aracı yüklenemedi');
        return;
      }
    } catch (e) {
      toast('Görsel aracı yüklenemedi');
      return;
    }

    const btn = document.getElementById('nbCopyAllBtn');
    const prevHtml = btn ? btn.innerHTML : '';
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Hazırlanıyor…';
    }

    try {
      target.classList.add('nb-sheet-capture--carrier-only');
      const canvas = await html2canvas(target, {
        backgroundColor: '#ffffff',
        scale: Math.min(window.devicePixelRatio || 1, 2),
        logging: false,
        useCORS: true,
      });
      const blob = await canvasToPngBlob(canvas);

      try {
        const copied = await writeImageToClipboard(blob);
        if (copied) {
          toast('Görsel kopyalandı — WhatsApp\'a yapıştırın');
          return;
        }
      } catch (e) {}

      await shareOrDownloadImage(blob);
    } catch (e) {
      console.error('copySheetImage', e);
      toast('Görsel kopyalanamadı');
    } finally {
      target.classList.remove('nb-sheet-capture--carrier-only');
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = prevHtml;
      }
    }
  }

  function buildSheetTableHtml(sheetRows) {
    if (!sheetRows.length) return '';
    let html =
      '<div class="nb-sheet-grid"><table role="grid"><colgroup>' +
      '<col class="col-no" /><col class="col-plaka" /><col class="col-status" /><col class="col-bbt" />' +
      '</colgroup><tbody>';
    sheetRows.forEach((row) => {
      if (row.kind === 'header' || row.kind === 'pending' || row.kind === 'ozmal-header') {
        const cls =
          row.kind === 'header' ? 'nb-hdr' : row.kind === 'ozmal-header' ? 'nb-ozmal-hdr' : 'nb-pending';
        html += '<tr class="' + cls + '"><td colspan="4">' + esc(row.a) + '</td></tr>';
        return;
      }
      if (row.kind === 'plate') {
        const statusCls = row.bassofor ? 'nb-side-bassofor' : row.ozmal ? 'nb-side-ozmal' : 'nb-side-red';
        const excludeCopy = row.ozmal || row.bassofor ? ' nb-plate--exclude-copy' : '';
        html +=
          '<tr class="nb-plate' +
          (row.bassofor ? ' nb-plate--bassofor' : '') +
          (row.ozmal ? ' nb-plate--ozmal' : '') +
          excludeCopy +
          '"><td class="nb-num">' +
          esc(String(row.no || '')) +
          '</td><td class="nb-plaka">' +
          esc(row.a) +
          '</td><td class="' +
          statusCls +
          '">' +
          esc(row.b || '') +
          '</td><td class="nb-bbt">' +
          esc(row.c || '') +
          '</td></tr>';
      }
    });
    html += '</tbody></table></div>';
    return html;
  }

  function renderExcelSheet(items) {
    const outer = document.getElementById('nbSheetOuter');
    if (!outer || !core) return;

    if (!items.length) {
      outer.innerHTML = '';
      return;
    }

    const parts = core.buildExcelSheetParts(items);
    const blocks = core.groupSheetRowsByBlock(parts.nakliyeRows);
    const multiFile = !!parts.multiFile;
    const fileGroups = multiFile && typeof core.groupItemsByExcelFile === 'function'
      ? core.groupItemsByExcelFile(items)
      : [];
    const useSideBySide = multiFile && fileGroups.length > 1;
    const usePackedDual =
      !useSideBySide && core.shouldUseDualColumnLayout(parts.nakliyeRows, blocks, { multiFile });
    const sourceDates = new Set(items.map((it) => it.sourceDateLabel).filter(Boolean));
    const dateLabel = multiFile || sourceDates.size > 1
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
      '<div class="nb-sheet-wrap' + wrapExtra + '" id="nbSheetCarrier">';
    if (dateLabel) {
      html += '<div class="nb-sheet-date">' + esc(dateLabel) + '</div>';
    }
    if (useSideBySide) {
      html += '<div class="nb-sheet-columns nb-sheet-columns--side">';
      fileGroups.forEach((fileItems) => {
        const fileParts = core.buildExcelSheetParts(fileItems, { multiFile: true });
        const fileBlocks = core.groupSheetRowsByBlock(fileParts.nakliyeRows);
        html +=
          '<div class="nb-sheet-col">' +
          buildSheetTableHtml(core.flattenSheetBlocks([fileBlocks])) +
          '</div>';
      });
      html += '</div>';
    } else if (usePackedDual) {
      const cols = core.splitBlocksIntoColumns(blocks);
      html += '<div class="nb-sheet-columns">';
      cols.forEach((colBlocks) => {
        html += '<div class="nb-sheet-col">' + buildSheetTableHtml(core.flattenSheetBlocks([colBlocks])) + '</div>';
      });
      html += '</div>';
    } else {
      html += buildSheetTableHtml(parts.nakliyeRows);
    }
    html += '</div>';
    outer.innerHTML = html;
  }

  async function renderList(forceReports) {
    const loading = document.getElementById('nbListLoading');
    const empty = document.getElementById('nbListEmpty');
    const noExcel = document.getElementById('nbNoExcel');
    const outer = document.getElementById('nbSheetOuter');
    const stats = document.getElementById('nbStats');

    try {
      const rows = await loadRowsWithLiveDeparted(!!forceReports);

      if (!rows.length) {
        empty?.classList.add('hidden');
        noExcel?.classList.remove('hidden');
        outer?.classList.add('hidden');
        if (stats) stats.textContent = '';
        return;
      }
      noExcel?.classList.add('hidden');

      _allItems = core ? core.analyzeNakliyePending(rows) : [];
      const visible = filterItems(_allItems);

      const totalRemaining = visible.reduce((s, x) => s + (x.remainingBbt || 0), 0);
      const waitingCount = visible.reduce((s, x) => s + (x.waitingPlates || []).length, 0);
      const ozmalCount = visible.reduce((s, x) => s + (x.ozmalPlates || []).length, 0);
      if (stats) {
        stats.textContent =
          visible.length +
          ' sevkiyat · ' +
          totalRemaining +
          ' BBT plaka bekliyor' +
          (ozmalCount ? ' · ' + ozmalCount + ' özmal' : '') +
          (waitingCount ? ' · ' + waitingCount + ' gelmeyen plaka' : '') +
          (_searchNeedle ? ' (filtreli)' : '');
      }

      const hasSheet = core && visible.some((x) => core.hasBlockSheetContent(x));
      if (!hasSheet) {
        empty?.classList.remove('hidden');
        outer?.classList.add('hidden');
        return;
      }
      empty?.classList.add('hidden');
      outer?.classList.remove('hidden');
      renderExcelSheet(visible);
    } catch (err) {
      console.error('nakliye-bekleyen renderList', err);
      empty?.classList.remove('hidden');
      if (empty) empty.textContent = 'Liste gösterilemedi. Sayfayı yenileyin (Ctrl+F5).';
      outer?.classList.add('hidden');
      toast('Liste hazırlanırken hata oluştu');
    } finally {
      loading?.classList.add('hidden');
    }
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
      refreshExcelStatus();
      renderList(true);
    });

    document.getElementById('nbCopyAllBtn')?.addEventListener('click', copySheetImage);

    document.getElementById('nbSearch')?.addEventListener('input', (ev) => {
      _searchNeedle = ev.target.value || '';
      renderList();
    });

    window.addEventListener('storage', (e) => {
      if (e.key === 'daily_shipments_current' || e.key === 'daily_shipments_meta') {
        refreshExcelStatus();
        renderList();
      }
    });
    window.addEventListener('nakliye-excel-changed', () => {
      refreshExcelStatus();
      renderList(true);
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') renderList();
    });
  }

  async function init() {
    bindUiHandlers();

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

      if (window.DailyStore && typeof DailyStore.init === 'function') {
        await DailyStore.init().catch(() => {});
      }

      refreshExcelStatus();
      await renderList();
    } catch (err) {
      console.error('nakliye-bekleyen init', err);
      refreshExcelStatus();
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
