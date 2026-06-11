// piyasa-ui.js — sipariş seçici, bind, init
// Otomatik bölüm — scripts/modularize-remaining.js

  async function openOrderPicker(opts = {}){
    if (window.__piyasaPickerOpen) return;
    const searchAllSheets = !!opts.searchAllSheets;
    const initialQuery = String(opts.initialQuery || '').trim();
    if (!state.orders || !state.orders.length) {
      try { loadState(); } catch (e) {}
    }
    if (!state.orders || state.orders.length === 0){
      alert('❌ PİYASA Excel yüklü değil ya da sipariş yok.');
      return;
    }
    await refreshDurumStatus().catch(() => {});
    window.__piyasaPickerOpen = true;

    const sheetOptions = _getPickerSheetOptions();
    let pickerViewKey = searchAllSheets ? null : _pickerSheetKey(state.week, state.sheet);
    let pickerViewSheet = sheetOptions.find((o) => o.key === pickerViewKey) || sheetOptions[0] || null;
    if (!searchAllSheets && pickerViewSheet) pickerViewKey = pickerViewSheet.key;

    const skippedCount = (state.lastSkippedRows || []).length;
    const g1DateLabel = searchAllSheets
      ? ''
      : _g1DateLabelFromBlock(pickerViewSheet) || getPiyasaG1DateLabel();
    const g1DateHtml = g1DateLabel
      ? `<div id="piyasaG1DateBadge" style="flex:1;display:flex;align-items:center;justify-content:center;min-width:0;padding:0 16px;">
           <span style="font-size:clamp(24px,3.5vw,36px);font-weight:800;color:#4338ca;letter-spacing:-0.02em;line-height:1.1;white-space:nowrap;">${escapeHtml(g1DateLabel)}</span>
         </div>`
      : `<div id="piyasaG1DateBadge" style="flex:1;min-width:0;"></div>`;
    const overlay = document.createElement('div');
    overlay.id = 'piyasaOrderPickerOverlay';
    overlay.setAttribute('data-piyasa-order-picker', '1');
    overlay.style.cssText = piyasaOverlayStyle(PIYASA_Z_BASE);
    const durumFreezeBanner = isDurumFrozen() && _durumStatus.message
      ? `<div style="padding:8px 14px;background:#fef3c7;color:#92400e;font-size:12px;font-weight:700;border-bottom:1px solid #fde68a;">⏸ ${escapeHtml(_durumStatus.message)}</div>`
      : '';
    overlay.innerHTML = `
      <div style="position:relative;z-index:1;background:#fff;border-radius:14px;max-width:min(96vw,1400px);width:100%;max-height:88vh;overflow:hidden;box-shadow:0 10px 30px rgba(0,0,0,.25);display:flex;flex-direction:column;">
        ${durumFreezeBanner}
        <div style="display:flex;align-items:center;gap:12px;padding:12px 14px;border-bottom:1px solid #eee;">
          <div style="flex:0 1 auto;min-width:0;">
            <div style="font-weight:900;">Piyasa Sipariş Seç</div>
            <div id="duplicateWarning" style="font-size:12px;color:#000;background:#FFD700;padding:4px 8px;border-radius:4px;display:none;margin-top:4px;">⚠️ AYNI FİRMA BULUNUYOR - SİPARİŞ SEÇERKEN AYNI RENKLİ BANTLARA DİKKAT EDİNİZ</div>
          </div>
          ${g1DateHtml}
          <div style="flex:0 1 auto;display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:flex-end;">
            ${skippedCount ? `<button type="button" id="piyasaSkippedBtn" style="border:0;background:#fef3c7;color:#92400e;border-radius:8px;padding:6px 10px;font-size:11px;cursor:pointer;font-weight:700;">Elenen satırlar (${skippedCount})</button>` : ''}
            ${searchAllSheets
              ? `<div style="font-size:12px;color:#4338ca;font-weight:700;white-space:nowrap;">${state.week != null ? `${state.week}. hafta — tüm sayfalar` : 'Bu haftanın tüm sayfalarında ara'}</div>`
              : `<label style="font-size:12px;color:#666;display:flex;align-items:center;gap:6px;white-space:nowrap;">
                  <span>Sheet:</span>
                  <select id="piyasaPickerSheet" style="padding:6px 8px;border:1px solid #ddd;border-radius:8px;font-size:12px;font-weight:700;max-width:min(42vw,240px);cursor:pointer;"></select>
                </label>`}
            <button id="piyasaModalClose" style="border:0;background:#eee;border-radius:10px;padding:6px 10px;cursor:pointer;">Kapat</button>
          </div>
        </div>
        <div style="padding:10px 14px;display:flex;gap:10px;align-items:center;border-bottom:1px solid #eee;flex-wrap:wrap;">
          <input id="piyasaSearch" placeholder="${searchAllSheets ? (state.week != null ? `Firma / Malzeme / İl ara… (${state.week}. hafta, tüm sayfalar)` : 'Firma / Malzeme / İl ara… (bu hafta, tüm sayfalar)') : 'Firma / Malzeme / İl ara… (seçili sheet)'}" style="flex:1;min-width:200px;padding:10px;border:1px solid #ddd;border-radius:10px;">
          <select id="piyasaSevkiyatFilter" style="padding:10px;border:1px solid #ddd;border-radius:10px;font-size:13px;" title="Excel SEVKİYAT TİPİ">
            <option value="all">Tüm siparişler</option>
            <option value="Yİ-GP">Yİ-GP</option>
            <option value="Yİ-HP">Yİ-HP</option>
          </select>
          <button type="button" id="piyasaCustomerListBtn" title="Sabit müşteri/bayi listesi" style="border:0;background:#0f766e;color:#fff;border-radius:10px;padding:9px 14px;font-size:13px;font-weight:700;cursor:pointer;white-space:nowrap;">📋 Müşteri Listesi</button>
          <button type="button" id="piyasaPrintBtn" title="A4 yatay yazdır — Kenar: Yok, Ölçek: %100" style="position:relative;z-index:5;border:0;background:#4f46e5;color:#fff;border-radius:10px;padding:9px 14px;font-size:13px;font-weight:700;cursor:pointer;white-space:nowrap;pointer-events:auto;">🖨️ Yazdır</button>
          <div style="font-size:12px;color:#666;min-width:140px;text-align:right;" id="piyasaCount"></div>
        </div>
        <div id="piyasaTableScroll" style="padding:0 14px 14px;overflow-x:hidden;overflow-y:auto;flex:1;-webkit-overflow-scrolling:touch;">
          <table style="width:100%;border-collapse:collapse;font-size:12px;table-layout:fixed;">
            <colgroup>
              <col style="width:3%">
              <col style="width:5%">
              <col style="width:5%">
              <col style="width:10%">
              <col style="width:9%">
              <col style="width:7%">
              <col style="width:7%">
              <col style="width:4%">
              <col style="width:8%">
              <col style="width:8%">
              <col style="width:28%">
              <col style="width:6%">
            </colgroup>
            <thead>
              <tr style="background:#f6f6f6;position:sticky;top:0;z-index:2;">
                <th style="text-align:center;padding:6px 4px;border:1px solid #eee;white-space:nowrap;font-size:10px;">#</th>
                <th style="text-align:center;padding:6px 2px;border:1px solid #eee;white-space:nowrap;font-size:9px;">DURUM</th>
                <th style="text-align:left;padding:6px 4px;border:1px solid #eee;white-space:normal;line-height:1.2;font-size:10px;word-break:break-word;">FİRMA</th>
                <th style="text-align:left;padding:6px 4px;border:1px solid #eee;white-space:normal;line-height:1.2;font-size:10px;word-break:break-word;">FİRMA<br>ADI</th>
                <th style="text-align:left;padding:6px 4px;border:1px solid #eee;white-space:normal;line-height:1.2;font-size:10px;word-break:break-word;">MALZEME</th>
                <th style="text-align:left;padding:6px 4px;border:1px solid #eee;white-space:normal;line-height:1.2;font-size:10px;word-break:break-word;">YÜKLEME<br>TÜRÜ</th>
                <th style="text-align:left;padding:6px 4px;border:1px solid #eee;white-space:normal;line-height:1.2;font-size:10px;word-break:break-word;">ÖDEME<br>TÜRÜ</th>
                <th style="text-align:left;padding:6px 4px;border:1px solid #eee;white-space:normal;line-height:1.2;font-size:10px;">ORG</th>
                <th style="text-align:left;padding:6px 4px;border:1px solid #eee;white-space:normal;line-height:1.2;font-size:10px;word-break:break-word;">ŞEHİR</th>
                <th style="text-align:left;padding:6px 4px;border:1px solid #eee;white-space:normal;line-height:1.2;font-size:10px;word-break:break-word;">MİKTAR</th>
                <th style="text-align:left;padding:6px 4px;border:1px solid #eee;white-space:normal;line-height:1.2;font-size:10px;">AÇIKLAMA</th>
                <th style="text-align:center;padding:6px 4px;border:1px solid #eee;white-space:nowrap;font-size:10px;">SEÇ</th>
              </tr>
            </thead>
            <tbody id="piyasaTbody"></tbody>
          </table>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const close = ()=> {
      _pickerRenderHook = null;
      window.__piyasaPickerOpen = false;
      try { delete window.__piyasaCloseOrderPicker; } catch (_) { window.__piyasaCloseOrderPicker = null; }
      overlay.remove();
      document.removeEventListener('keydown', handleEsc, true);
    };
    window.__piyasaCloseOrderPicker = close;
    overlay.querySelector('#piyasaModalClose').onclick = close;
    overlay.onclick = null;
    
    // ESC (capture): app.js global ESC önce preventDefault yapar; bubble dinleyici çalışmaz
    // Üstte başka piyasa katmanı (geçmiş, boş tonaj vb.) varsa sadece o kapanır
    const handleEsc = (e) => {
      if (e.key !== 'Escape') return;
      if (!document.body.contains(overlay)) {
        document.removeEventListener('keydown', handleEsc, true);
        return;
      }
      if (hasOpenPiyasaModalLayer()) return;
      e.preventDefault();
      e.stopPropagation();
      close();
    };
    document.addEventListener('keydown', handleEsc, true);

    const tbody = overlay.querySelector('#piyasaTbody');
    const countEl = overlay.querySelector('#piyasaCount');
    const searchEl = overlay.querySelector('#piyasaSearch');
    const sevkiyatFilterEl = overlay.querySelector('#piyasaSevkiyatFilter');
    const skippedBtn = overlay.querySelector('#piyasaSkippedBtn');
    if (skippedBtn) skippedBtn.onclick = () => showPiyasaSkippedRowsModal();

    const CELL_WRAP_EXTRA = 'white-space:normal;word-break:break-word;overflow-wrap:anywhere;line-height:1.35;vertical-align:top;';
    const SEHIR_CELL_EXTRA = CELL_WRAP_EXTRA;
    const MIKTAR_CELL_EXTRA = CELL_WRAP_EXTRA;
    const ACIKLAMA_CELL_EXTRA = 'white-space:normal;word-break:break-word;overflow-wrap:anywhere;line-height:1.5;vertical-align:top;font-size:11px;color:#1e293b;max-width:0;';
    const SELECT_CELL_EXTRA = 'white-space:nowrap;text-align:center;vertical-align:middle;';
    const STATUS_CELL_EXTRA = 'white-space:nowrap;text-align:center;vertical-align:middle;font-size:10px;padding:4px 2px;';
    const NO_CELL_EXTRA = 'white-space:nowrap;text-align:center;vertical-align:middle;font-weight:700;';

    function formatAciklamaHtml(text) {
      return escapeHtml(String(text || '').trim()).replace(/\r\n/g, '\n').replace(/\n/g, '<br>');
    }

    /** Şehir: ANKARA/BALA → ANKARA/<br>BALA */
    function formatSehirHtml(text) {
      const s = String(text || '').trim();
      if (!s) return '';
      const parts = s.split(/\s*\/\s*/).filter(Boolean);
      if (parts.length <= 1) return escapeHtml(s);
      return parts
        .map((p, i) => escapeHtml(p) + (i < parts.length - 1 ? '/<br>' : ''))
        .join('');
    }

    let pickerCacheCurrent = _buildPickerSearchCache(
      searchAllSheets
        ? _getAllArchivePickerOrders()
        : _decorateOrdersForPicker(
            pickerViewSheet?.orders || state.orders,
            { week: pickerViewSheet?.week ?? state.week, sheet: pickerViewSheet?.sheet ?? state.sheet },
            state.week,
            state.sheet
          )
    );
    let visiblePickerRows = [];
    let pickerGpHp = _countPickerGpHp(
      searchAllSheets ? _getAllArchivePickerOrders() : (pickerViewSheet?.orders || state.orders)
    );

    const sheetSelectEl = overlay.querySelector('#piyasaPickerSheet');
    const g1DateBadgeEl = overlay.querySelector('#piyasaG1DateBadge');

    function updateG1DateBadge() {
      if (!g1DateBadgeEl || searchAllSheets) return;
      const label = _g1DateLabelFromBlock(pickerViewSheet) || getPiyasaG1DateLabel();
      if (label) {
        g1DateBadgeEl.innerHTML = `<span style="font-size:clamp(24px,3.5vw,36px);font-weight:800;color:#4338ca;letter-spacing:-0.02em;line-height:1.1;white-space:nowrap;">${escapeHtml(label)}</span>`;
      } else {
        g1DateBadgeEl.innerHTML = '';
      }
    }

    function rebuildPickerCacheForView() {
      if (searchAllSheets) {
        const allOrders = _getAllArchivePickerOrders();
        pickerCacheCurrent = _buildPickerSearchCache(allOrders);
        pickerGpHp = _countPickerGpHp(allOrders);
        return;
      }
      pickerViewSheet = sheetOptions.find((o) => o.key === pickerViewKey) || sheetOptions[0] || null;
      if (pickerViewSheet) pickerViewKey = pickerViewSheet.key;
      const viewOrders = pickerViewSheet?.orders || state.orders || [];
      pickerCacheCurrent = _buildPickerSearchCache(
        _decorateOrdersForPicker(
          viewOrders,
          { week: pickerViewSheet?.week ?? state.week, sheet: pickerViewSheet?.sheet ?? state.sheet },
          state.week,
          state.sheet
        )
      );
      pickerGpHp = _countPickerGpHp(viewOrders);
      updateG1DateBadge();
    }

    if (sheetSelectEl) {
      sheetOptions.forEach((opt) => {
        const el = document.createElement('option');
        el.value = opt.key;
        const weekHint = opt.week != null ? `${opt.week}. hafta — ` : '';
        el.textContent = `${weekHint}${opt.label}`;
        if (opt.key === pickerViewKey) el.selected = true;
        sheetSelectEl.appendChild(el);
      });
      sheetSelectEl.onchange = () => {
        pickerViewKey = sheetSelectEl.value;
        rebuildPickerCacheForView();
        render(searchEl.value);
      };
    }

    function getPickerRows(filter, tipMode) {
      const f = String(filter || '').trim().toLowerCase();
      const mode = tipMode || 'all';
      const cache = pickerCacheCurrent;
      const rows = [];
      const firmaCount = {};

      for (let i = 0; i < cache.length; i++) {
        const e = cache[i];
        if (mode !== 'all' && e.sevkiyat !== mode) continue;
        if (f && !e.hay.includes(f)) continue;
        rows.push(e.o);
        if (e.firmaAdi) firmaCount[e.firmaAdi] = (firmaCount[e.firmaAdi] || 0) + 1;
      }

      const duplicateFirmas = new Set();
      for (const firma of Object.keys(firmaCount)) {
        if (firmaCount[firma] > 1) duplicateFirmas.add(firma);
      }

      return { rows, duplicateFirmas, filterText: f, tipMode: mode };
    }

    function rowHtml(o, duplicateFirmas, options) {
      const forPrint = !!(options && options.forPrint);
      const showWeek = !!(options && options.showWeek);
      const firmaCode = String(o.firma || '').trim();
      const firmaAdi = _resolvePickerFirmaAdi(o);
      const isDuplicate = duplicateFirmas.has(firmaAdi);
      const isUsed = !!o.usedAt;
      const printCount = getOrderPrintCount(o);
      const statusInner = buildOrderStatusCell(o, forPrint);

      const normalStyle = 'padding:6px 4px;border:1px solid #eee;' + CELL_WRAP_EXTRA;
      const usedStyle = 'padding:6px 4px;border:1px solid #eee;background:#f3f4f6;color:#6b7280;' + CELL_WRAP_EXTRA;
      const redStyle = 'padding:6px 4px;border:1px solid #eee;background:#111210;color:#FFBF00;font-weight:bold;' + CELL_WRAP_EXTRA;
      const highlightStyle = 'padding:6px 4px;border:1px solid #eee;background:#111210;color:#FFBF00;font-weight:bold;font-size:13px;' + CELL_WRAP_EXTRA;
      const printDupClass = forPrint ? '' : (isDuplicate ? ' class="piyasa-print-dup"' : '');
      const printUsedClass = forPrint ? '' : ((!isDuplicate && (isUsed || printCount > 0)) ? ' class="piyasa-print-used"' : '');
      const cellStyle = (highlight) => {
        if (isDuplicate) return highlight ? highlightStyle : redStyle;
        if (isUsed || printCount >= 2) return usedStyle;
        if (printCount === 1) return normalStyle + 'background:#f0fdf4;';
        return normalStyle;
      };
      const aciklamaFull = String(o.aciklama || '').trim();
      const miktarFull = String(o.miktar || '').trim();
      const sehirFull = String(o.il || o.sevkYeri || '').trim();
      const sehirCellStyle = `${isDuplicate ? redStyle : cellStyle(false)}${SEHIR_CELL_EXTRA}`;
      const miktarCellStyle = `${isDuplicate ? redStyle : cellStyle(false)}${MIKTAR_CELL_EXTRA}${isDuplicate ? 'color:#FFBF00;' : ''}`;
      const aciklamaCellStyle = `${cellStyle(false)}${ACIKLAMA_CELL_EXTRA}${isDuplicate ? 'color:#FFBF00;font-weight:bold;' : ''}`;
      const selectBg = isDuplicate ? '#111210' : (isUsed ? '#f3f4f6' : '#fff');
      const selectCellStyle = `${cellStyle(false)}${SELECT_CELL_EXTRA}background:${selectBg};text-align:center;`;
      const aciklamaInner = formatAciklamaHtml(aciklamaFull) || '<span style="color:#9ca3af;">—</span>';
      const aciklamaTd = forPrint
        ? `<td class="col-acik"${printDupClass || printUsedClass}>${aciklamaInner}</td>`
        : `<td class="piyasa-aciklama-cell" style="${aciklamaCellStyle}" title="${escapeHtml(aciklamaFull)}">
            <div class="piyasa-aciklama-text" style="font-size:11px;line-height:1.5;color:inherit;">${aciklamaInner}</div>
          </td>`;
      const selectTd = forPrint ? '' : `<td style="${selectCellStyle}">
            <button type="button" data-pick-key="${escapeHtml(o._pickKey || String(o.__idx))}" style="cursor:pointer;border:0;background:${isUsed ? '#4b5563' : '#111827'};color:#fff;border-radius:8px;padding:5px 8px;font-size:11px;">Seç</button>
          </td>`;
      const statusTd = forPrint
        ? `<td class="col-durum"${printDupClass || printUsedClass}>${statusInner || '—'}</td>`
        : `<td${printDupClass || printUsedClass} style="${cellStyle(false)}${STATUS_CELL_EXTRA}">${statusInner}</td>`;
      const rowClass = forPrint && isDuplicate ? ' class="piyasa-print-strong"' : '';
      const rowStyle = (!forPrint && isUsed && !isDuplicate && printCount < 2) ? ' style="opacity:.92;"' : '';
      const weekBadge = (showWeek && (o._weekLabel || o._sourceSheet))
        ? `<span style="font-size:9px;color:${o._isCurrentWeek ? '#059669' : '#6366f1'};font-weight:700;display:block;margin-top:2px;line-height:1.2;">${escapeHtml([o._weekLabel, o._sourceSheet].filter(Boolean).join(' · '))}</span>`
        : '';
      const noCellStyle = forPrint ? '' : `${cellStyle(false)}${NO_CELL_EXTRA}`;

      return `
        <tr${rowClass}${rowStyle}>
          <td${forPrint ? ' class="col-no"' : ''} style="${noCellStyle}">${o.__idx}${weekBadge}</td>
          ${statusTd}
          <td${forPrint ? (printDupClass || printUsedClass) : ''} style="${forPrint ? '' : cellStyle(false)}">${escapeHtml(firmaCode)}</td>
          <td${forPrint ? (printDupClass || printUsedClass) : ''} style="${forPrint ? '' : cellStyle(false)}">${escapeHtml(firmaAdi)}</td>
          <td${forPrint ? (printDupClass || printUsedClass) : ''} style="${forPrint ? '' : cellStyle(false)}">${escapeHtml(o.malzeme||'')}</td>
          <td${forPrint ? (printDupClass || printUsedClass) : ''} style="${forPrint ? '' : cellStyle(true)}">${escapeHtml(o.yuklemeTuru||'')}</td>
          <td${forPrint ? (printDupClass || printUsedClass) : ''} style="${forPrint ? '' : cellStyle(false)}">${escapeHtml(o.odemeTuru||'')}</td>
          <td${forPrint ? (printDupClass || printUsedClass) : ''} style="${forPrint ? '' : cellStyle(false)}">${escapeHtml(o.org||'')}</td>
          <td${forPrint ? (printDupClass || printUsedClass) : ''} style="${forPrint ? '' : sehirCellStyle}" title="${escapeHtml(sehirFull)}">${formatSehirHtml(sehirFull)}</td>
          <td${forPrint ? (printDupClass || printUsedClass) : ''} style="${forPrint ? '' : miktarCellStyle}" title="${escapeHtml(miktarFull)}">${escapeHtml(miktarFull)}</td>
          ${aciklamaTd}
          ${selectTd}
        </tr>
      `;
    }

    function printPiyasaPickerTable() {
      const tipMode = sevkiyatFilterEl ? sevkiyatFilterEl.value : 'all';
      const { rows, duplicateFirmas } = getPickerRows(searchEl.value, tipMode);
      if (!rows.length) {
        alert('Yazdırılacak sipariş yok. Filtreyi kontrol edin.');
        return;
      }

      const tipLabels = { all: 'Tüm siparişler', 'Yİ-GP': 'Yİ-GP', 'Yİ-HP': 'Yİ-HP' };
      const tipLabel = tipLabels[tipMode] || tipMode;
      const searchQ = String(searchEl.value || '').trim();
      const now = new Date();
      const printedAt = `${pad(now.getDate())}.${pad(now.getMonth() + 1)}.${now.getFullYear()} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
      const viewedSheet = searchAllSheets ? 'Tüm sayfalar' : (pickerViewSheet?.sheet || state.sheet || '');
      const viewedWeek = searchAllSheets ? '' : (pickerViewSheet?.week ?? state.week);
      const sheetLine = viewedSheet ? `Sheet: ${escapeHtml(viewedSheet)}` : '';
      const weekLine = viewedWeek != null && viewedWeek !== '' ? `Hafta: ${escapeHtml(String(viewedWeek))}` : '';
      const dupWarn = duplicateFirmas.size > 0
        ? '<div class="piyasa-print-warn">⚠ Aynı firma birden fazla satırda var — seçerken dikkat ediniz.</div>'
        : '';

      const g1Date = getPiyasaG1DateLabel();
      const tableBody = rows.map((o) => rowHtml(o, duplicateFirmas, { forPrint: true })).join('');
      const printHtml = `<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="utf-8">
  <title>Piyasa Sipariş Listesi</title>
  <style>
    @page { size: 297mm 210mm landscape; margin: 8mm; }
    html, body {
      margin: 0;
      padding: 0;
      width: 281mm;
      max-width: 281mm;
      height: auto;
      overflow: visible;
      background: #fff;
      font-family: Arial, 'Segoe UI', sans-serif;
      font-size: 8px;
      color: #000;
    }
    * { box-sizing: border-box; }
    .piyasa-print-root {
      width: 281mm;
      max-width: 281mm;
      margin: 0;
      padding: 0;
      overflow: visible;
    }
    .piyasa-print-head { margin: 0 0 5px; padding: 0 0 4px; border-bottom: 1px solid #000; page-break-after: avoid; break-after: avoid-page; }
    .piyasa-print-head-row { display: table; width: 100%; table-layout: fixed; }
    .piyasa-print-head-left, .piyasa-print-head-right { display: table-cell; vertical-align: bottom; }
    .piyasa-print-head-right { text-align: right; white-space: nowrap; }
    h1 { font-size: 13px; margin: 0; font-weight: 800; color: #000; }
    .piyasa-print-g1 { font-size: 16px; font-weight: 800; color: #000; white-space: nowrap; }
    .piyasa-print-meta { font-size: 9px; color: #000; margin-bottom: 5px; line-height: 1.35; page-break-after: avoid; break-after: avoid-page; }
    .piyasa-print-meta b { color: #000; font-weight: 700; }
    .piyasa-print-warn { color: #000; padding: 0 0 4px; margin-bottom: 4px; font-size: 9px; font-weight: 700; page-break-after: avoid; break-after: avoid-page; }
    table.piyasa-print-table { width: 100%; border-collapse: collapse; table-layout: fixed; margin: 0; }
    col.c-no { width: 3%; }
    col.c-durum { width: 5%; }
    col.c-firma { width: 6%; }
    col.c-fadi { width: 10%; }
    col.c-malz { width: 10%; }
    col.c-yuk { width: 7%; }
    col.c-ode { width: 7%; }
    col.c-org { width: 4%; }
    col.c-seh { width: 8%; }
    col.c-mik { width: 8%; }
    col.c-acik { width: 32%; }
    thead { display: table-header-group; }
    tr { page-break-inside: avoid; break-inside: avoid-page; }
    th, td { border: 1px solid #000; padding: 1px 2px; vertical-align: top; line-height: 1.25; color: #000; background: #fff; overflow: visible; max-width: none; }
    th.col-no, td.col-no { text-align: center; white-space: nowrap; font-weight: 700; font-size: 7.5px; }
    th.col-durum, td.col-durum {
      font-size: 7px;
      line-height: 1.25;
      white-space: normal;
      word-break: break-word;
      overflow-wrap: anywhere;
    }
    th.col-acik, td.col-acik {
      word-break: break-all;
      overflow-wrap: anywhere;
      white-space: normal;
      font-size: 7.5px;
      line-height: 1.3;
      overflow: visible;
      max-width: none;
    }
    th { font-size: 7px; font-weight: 700; text-align: left; }
    tr.piyasa-print-strong td { font-weight: 700; }
    @media print {
      @page { size: 297mm 210mm landscape; margin: 8mm; }
      html, body { width: 100% !important; max-width: 100% !important; margin: 0 !important; padding: 0 !important; overflow: visible !important; background: #fff !important; height: auto !important; }
      .piyasa-print-root {
        width: 100% !important;
        max-width: 100% !important;
        margin: 0 !important;
        overflow: visible !important;
        transform: scale(0.91);
        transform-origin: top left;
      }
      body, th, td { color: #000 !important; background: #fff !important; }
      th, td { border-color: #000 !important; overflow: visible !important; max-width: none !important; }
      table.piyasa-print-table { width: 100% !important; margin: 0 !important; }
      th.col-acik, td.col-acik { word-break: break-all !important; overflow: visible !important; max-width: none !important; }
    }
  </style>
</head>
<body>
  <div class="piyasa-print-root">
  <div class="piyasa-print-head">
    <div class="piyasa-print-head-row">
      <div class="piyasa-print-head-left"><h1>Piyasa Sipariş Listesi</h1></div>
      ${g1Date ? `<div class="piyasa-print-head-right"><div class="piyasa-print-g1">${escapeHtml(g1Date)}</div></div>` : ''}
    </div>
  </div>
  <div class="piyasa-print-meta">
    <div>Filtre: <b>${escapeHtml(tipLabel)}</b>${searchQ ? ` · Arama: <b>${escapeHtml(searchQ)}</b>` : ''} · <b>${rows.length}</b> sipariş</div>
    <div>${[sheetLine, weekLine].filter(Boolean).join(' · ')} · Yazdırma: ${printedAt}</div>
  </div>
  ${dupWarn}
  <table class="piyasa-print-table">
    <colgroup>
      <col class="c-no"><col class="c-durum"><col class="c-firma"><col class="c-fadi"><col class="c-malz">
      <col class="c-yuk"><col class="c-ode"><col class="c-org"><col class="c-seh">
      <col class="c-mik"><col class="c-acik">
    </colgroup>
    <thead>
      <tr>
        <th class="col-no">#</th><th class="col-durum">DURUM</th><th>FİRMA</th><th>FİRMA ADI</th><th>MALZEME</th>
        <th>YÜK.TÜR</th><th>ÖD.TÜR</th><th>ORG</th><th>ŞEHİR</th>
        <th>MİKTAR</th><th class="col-acik">AÇIKLAMA</th>
      </tr>
    </thead>
    <tbody>${tableBody}</tbody>
  </table>
  </div>
</body>
</html>`;

      launchPiyasaPrintDocument(printHtml);
    }

    function render(filter){
      const tipMode = sevkiyatFilterEl ? sevkiyatFilterEl.value : 'all';
      const { rows, duplicateFirmas } = getPickerRows(filter, tipMode);
      visiblePickerRows = rows;

      const warningEl = overlay.querySelector('#duplicateWarning');
      if (warningEl) {
        warningEl.style.display = duplicateFirmas.size > 0 ? 'block' : 'none';
      }

      const truncated = rows.length > PICKER_MAX_VISIBLE_ROWS;
      const displayRows = truncated ? rows.slice(0, PICKER_MAX_VISIBLE_ROWS) : rows;
      const truncNote = truncated ? ` (ilk ${PICKER_MAX_VISIBLE_ROWS}, aramayı daraltın)` : '';
      const sheetLabel = searchAllSheets
        ? (state.week != null ? ` • ${state.week}. hafta (tüm sayfalar)` : ' • bu hafta (tüm sayfalar)')
        : (pickerViewSheet?.sheet ? ` • ${pickerViewSheet.sheet}` : (state.sheet ? ` • ${state.sheet}` : ''));
      countEl.textContent = `${rows.length} sipariş${sheetLabel}${truncNote} • GP:${pickerGpHp.gp} HP:${pickerGpHp.hp}`;
      tbody.innerHTML = displayRows.map((o) => rowHtml(o, duplicateFirmas, { showWeek: searchAllSheets })).join('');
    }

    if (!tbody._piyasaPickerClickBound) {
      tbody._piyasaPickerClickBound = true;
      tbody.addEventListener('click', (e) => {
        const historyBtn = e.target.closest('button[data-history-key]');
        if (historyBtn) {
          e.preventDefault();
          e.stopPropagation();
          const pickKey = historyBtn.getAttribute('data-history-key');
          const selected = visiblePickerRows.find((x) => (x._pickKey || String(x.__idx)) === pickKey);
          if (selected) showMalzemeVehicleHistoryModal(selected);
          return;
        }
        const pickBtn = e.target.closest('button[data-pick-key]');
        if (!pickBtn) return;
        e.preventDefault();
        e.stopPropagation();
        if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
        if (pickBtn.disabled) return;
        const pickKey = pickBtn.getAttribute('data-pick-key');
        const selected = visiblePickerRows.find((x) => (x._pickKey || String(x.__idx)) === pickKey);
        if (!selected) return;
        const originalText = pickBtn.textContent;
        pickBtn.disabled = true;
        pickBtn.textContent = 'Seçiliyor...';
        try {
          close();
        } catch (_) {
          try { overlay.remove(); } catch (_) {}
          window.__piyasaPickerOpen = false;
        }
        try {
          applyOrderFromPicker(selected);
        } catch (err) {
          console.error('Piyasa siparişi forma aktarılırken hata:', err);
          // Modal kapandığı için sadece hata bilgisi veriyoruz.
          alert('Sipariş forma aktarılırken bir hata oluştu. Lütfen tekrar deneyin.');
          // Beklenmeyen bir hatada state kilitlenmesin:
          window.__piyasaPickerOpen = false;
        }
      });
    }

    const customerListBtn = overlay.querySelector('#piyasaCustomerListBtn');
    if (customerListBtn) customerListBtn.onclick = () => openPiyasaCustomerListModal();

    const printBtn = overlay.querySelector('#piyasaPrintBtn');
    if (printBtn && !printBtn._piyasaPrintBound) {
      printBtn._piyasaPrintBound = true;
      printBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
        printPiyasaPickerTable();
      }, true);
    }

    const renderDebounced = _debounce((v) => render(v), PICKER_SEARCH_DEBOUNCE_MS);
    searchEl.oninput = () => renderDebounced(searchEl.value);
    if (sevkiyatFilterEl) sevkiyatFilterEl.onchange = () => render(searchEl.value);
    _pickerRenderHook = () => render(searchEl.value);
    if (initialQuery) searchEl.value = initialQuery;
    setTimeout(()=> searchEl.focus(), 0);
    render(initialQuery);

    requestPiyasaSyncIfRemoteNewer({}).catch(() => {});
    reconcileOrderPrintCountsFromReports()
      .then(() => { if (_pickerRenderHook) _pickerRenderHook(); })
      .catch(() => {});
  }

  function escapeHtml(s){
    return String(s||'')
      .replaceAll('&','&amp;')
      .replaceAll('<','&lt;')
      .replaceAll('>','&gt;')
      .replaceAll('"','&quot;')
      .replaceAll("'","&#039;");
  }

  function pad(n){ return String(n).padStart(2,'0'); }

  function formatDateUTCAsLocalString(dt){
    if (!dt) return '';
    // dt is UTC-midnight produced by getDateFromWeekYear; format as dd.MM.yyyy
    const d = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate()));
    return `${pad(d.getDate())}.${pad(d.getMonth()+1)}.${d.getFullYear()}`;
  }

  // Modal that allows selecting among the detected week-sheets and previews the sheet date/count
  function showWeekPickerModal(metas, wb, currentSheetName, onConfirm){
    try{
      const overlay = document.createElement('div');
      overlay.style.cssText = piyasaOverlayStyle(PIYASA_Z_LAYER);
      markPiyasaModalLayer(overlay);
      overlay.innerHTML = `
        <div style="background:#fff;border-radius:12px;max-width:640px;width:100%;box-shadow:0 8px 24px rgba(0,0,0,.2);">
          <div style="padding:14px 18px;border-bottom:1px solid #eee;font-weight:700;display:flex;justify-content:space-between;align-items:center;">
            <div>Hafta / Kitap Önizleme</div>
            <div style="font-size:12px;color:#666;">Seçilen: <span id="piyasaPickerSelected" style="font-weight:700;margin-left:6px;"></span></div>
          </div>
          <div style="padding:12px 18px;display:flex;gap:12px;align-items:center;">
            <label style="font-size:13px;color:#444;min-width:80px;">Kitap:</label>
            <select id="piyasaPickerSelect" style="flex:1;padding:8px;border:1px solid #ddd;border-radius:8px;"></select>
          </div>
          <div style="padding:0 18px 12px;display:flex;gap:12px;align-items:center;">
            <div style="flex:1;color:#333;">Tarih: <span id="piyasaPickerDate" style="font-weight:600;margin-left:6px;"></span></div>
            <div style="flex:1;text-align:right;color:#333;">Tahmini Sipariş: <span id="piyasaPickerCount" style="font-weight:600;margin-left:6px;"></span></div>
          </div>
          <div style="display:flex;justify-content:flex-end;padding:12px 18px;border-top:1px solid #eee;gap:10px;">
            <button id="piyasaPickerCancel" style="border:0;background:#eee;border-radius:8px;padding:8px 12px;cursor:pointer;">İptal</button>
            <button id="piyasaPickerOk" style="border:0;background:#111827;color:#fff;border-radius:8px;padding:8px 12px;cursor:pointer;">Tamam</button>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);

      const sel = overlay.querySelector('#piyasaPickerSelect');
      const dateEl = overlay.querySelector('#piyasaPickerDate');
      const countEl = overlay.querySelector('#piyasaPickerCount');
      const selectedLabel = overlay.querySelector('#piyasaPickerSelected');
      const okBtn = overlay.querySelector('#piyasaPickerOk');
      const cancelBtn = overlay.querySelector('#piyasaPickerCancel');

      // populate (en güncel hafta üstte)
      const sortedMetas = [...metas].sort(
        (a, b) => (b.week - a.week) || (b.orderIndex - a.orderIndex)
      );
      sortedMetas.forEach(m=>{
        const opt = document.createElement('option');
        opt.value = m.name;
        opt.textContent = `${m.name} — ${m.week}. hafta`;
        sel.appendChild(opt);
      });
      const defaultMeta = pickDefaultPiyasaSheetMeta(metas);
      const initialSheet = currentSheetName && metas.some((m) => m.name === currentSheetName)
        ? currentSheetName
        : (defaultMeta ? defaultMeta.name : sortedMetas[0]?.name);
      if (initialSheet) sel.value = initialSheet;

      function previewFor(name){
        try{
          const ws = wb.Sheets[name];
          const g1 = readG1FromSheet(ws);
          const rawRows = parseSheetSmart(ws);
          const norm = normalizeRows(rawRows, rawRows.__parseMeta);
          const rows = norm.orders || [];
          dateEl.textContent = formatParsedSheetDate(g1.date, g1.raw) || (g1.date ? formatDateUTCAsLocalString(g1.date) : '');
          countEl.textContent = String(rows.length || 0);
          selectedLabel.textContent = `${name}`;
          return { ws, rows, g1 };
        }catch(e){
          dateEl.textContent = '';
          countEl.textContent = '0';
          selectedLabel.textContent = name;
          return { ws: null, rows: [], g1: { date: null, raw: null } };
        }
      }

      sel.onchange = ()=> previewFor(sel.value);
      cancelBtn.onclick = ()=> overlay.remove();

      okBtn.onclick = ()=>{
        const name = sel.value;
        const p = previewFor(name);
        // set state from chosen sheet
        try{
          const ws2 = wb.Sheets[name];
          const raw2 = parseSheetSmart(ws2);
          const g1 = p.g1 || readG1FromSheet(ws2);
          applyPiyasaParseResult(raw2, {
            week: getWeekFromSheetName(name, wb) || state.week,
            sheet: name,
            loadedAt: g1.date || new Date(),
            sheetDate: g1.date ? g1.date.toISOString() : null,
            sheetDateRaw: g1.raw,
          });
          if (state.orders && state.orders.length) saveState();
          toast(`✅ Piyasa yüklendi: ${name} • ${state.week}. hafta • ${state.orders.length} sipariş`, 'success');
        }catch(e){ console.error('picker apply failed', e); }
        overlay.remove();
        if (typeof onConfirm === 'function') onConfirm();
      };

      // initial preview
      setTimeout(()=> previewFor(sel.value), 0);
    }catch(e){ console.error('showWeekPickerModal error', e); if (typeof onConfirm === 'function') onConfirm(); }
  }

  function showWeekInfoModal(week, a, b, c){
    try{
      if (!week) { if (typeof b === 'function') b(); else if (typeof c === 'function') c(); return; }
      let foundDate = null;
      let year = null;
      let onClose = null;
      if (a && Object.prototype.toString.call(a) === '[object Date]'){
        foundDate = a;
        year = (typeof b === 'number') ? b : (state.loadedAt ? state.loadedAt.getFullYear() : (new Date()).getFullYear());
        onClose = c;
      } else {
        year = (typeof a === 'number') ? a : (state.loadedAt ? state.loadedAt.getFullYear() : (new Date()).getFullYear());
        onClose = b;
      }

      let rangeText = `${week}. hafta`;
      if (foundDate){
        rangeText = `${week}. hafta • ${formatDateUTCAsLocalString(foundDate)}`;
      } else {
        const start = getDateFromWeekYear(week, year);
        if (start){
          const end = new Date(start.getTime());
          end.setUTCDate(start.getUTCDate() + 6);
          rangeText = `${week}. hafta • ${formatDateUTCAsLocalString(start)} - ${formatDateUTCAsLocalString(end)}`;
        }
      }

      const overlay = document.createElement('div');
      overlay.style.cssText = piyasaOverlayStyle(PIYASA_Z_LAYER);
      markPiyasaModalLayer(overlay);
      overlay.innerHTML = `
        <div style="background:#fff;border-radius:12px;max-width:520px;width:100%;box-shadow:0 8px 24px rgba(0,0,0,.2);">
          <div style="padding:16px 18px;border-bottom:1px solid #eee;font-weight:700;">Hafta Bilgisi</div>
          <div style="padding:14px 18px;font-size:14px;color:#222;">Seçilen: <div style='margin-top:8px;font-size:15px;font-weight:600;'>${escapeHtml(String(rangeText))}</div></div>
          <div style="display:flex;justify-content:flex-end;padding:12px 18px;border-top:1px solid #eee;">
            <button id="piyasaWeekInfoOk" style="border:0;background:#111827;color:#fff;border-radius:8px;padding:8px 12px;cursor:pointer;">Tamam</button>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);
      const close = ()=>{ try{ overlay.remove(); }catch(e){} if (typeof onClose === 'function') onClose(); };
      overlay.onclick = (e)=>{ if (e.target === overlay) close(); };
      const ok = overlay.querySelector('#piyasaWeekInfoOk');
      if (ok) ok.onclick = close;
    }catch(e){ if (typeof onClose === 'function') onClose(); }
  }

  async function loadPiyasaExcel(file){
    if (!file){
      alert('❌ Dosya seçilemedi.');
      return;
    }

    let loading = showPiyasaExcelLoading('Excel kütüphanesi yükleniyor…');
    let wb = null;
    try {
      try {
        if (typeof window.ensureXlsxLoaded === 'function') await window.ensureXlsxLoaded();
      } catch (e) {
        alert('❌ XLSX kütüphanesi yüklenemedi.\n\nİnternet bağlantınızı kontrol edip sayfayı yenileyin (F5).');
        return;
      }
      if (!window.XLSX){
        alert('❌ XLSX kütüphanesi yüklenmemiş.');
        return;
      }

      let fp = '';
      try {
        if (eu().fingerprintFile) fp = await eu().fingerprintFile(file);
      } catch (e) {}
      loadState();
      if (fp && state.fileFingerprint === fp && state.orders && state.orders.length) {
        hidePiyasaExcelLoading();
        const again = confirm('Bu dosya daha önce yüklendi.\n\nYine de yüklemek istiyor musunuz?');
        if (!again) return;
        loading = showPiyasaExcelLoading('Dosya okunuyor…');
      }
      state.fileFingerprint = fp;

      loading.setMessage('Dosya okunuyor…');
      const ab = await file.arrayBuffer();
      loading.setMessage('Excel sayfaları taranıyor…');
      wb = XLSX.read(ab, PIYASA_XLSX_READ_OPTS);

      const metas = getSheetMetaForPicker(wb);
      if (!metas.length){
        alert('❌ Bu dosyada HAFTA sheet’i bulamadım (ör: 21.HAFTA).');
        return;
      }

      hidePiyasaExcelLoading();

      const defaultMeta = pickDefaultPiyasaSheetMeta(metas);
      const defaultSheet = defaultMeta ? defaultMeta.name : metas[0].name;

      showWeekPickerModal(metas, wb, defaultSheet, () => {
        scheduleWeekArchiveBuild(wb);
        refreshPiyasaHeaderUi();
        if (!state.orders.length) {
          alert('⚠️ Seçilen kitapta sipariş bulunamadı. (Filtre kuralları nedeniyle bazı satırlar atılmış olabilir.)');
          return;
        }
        openOrderPicker();
      });
    } catch (e) {
      console.error('Piyasa excel load failed', e);
      alert('❌ Excel dosyası okunamadı.');
    } finally {
      hidePiyasaExcelLoading();
    }
  }

  function clearPiyasa(){
    state.orders = [];
    state.weekArchive = [];
    state.week = null;
    state.sheet = null;
    state.loadedAt = null;
    state.sheetDate = null;
    state.sheetDateRaw = null;
    state.fileFingerprint = null;
    state.lastImportReport = null;
    state.lastSkippedRows = [];
    state._lastAppliedOrder = null;
    const updatedAt = Date.now();
    _localSyncTs = updatedAt;
    const emptyPayload = {
      updatedAt,
      orders: [],
      weekArchive: [],
      week: null,
      sheet: null,
      loadedAt: null,
      sheetDate: null,
      sheetDateRaw: null,
      fileFingerprint: null,
      lastImportReport: null,
    };
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(emptyPayload)); } catch (e) {
      clearSavedState();
    }
    pushPiyasaToServer(emptyPayload).catch(() => {});
    refreshPiyasaHeaderUi();
  }

  function restorePiyasa(snapshot) {
    if (!snapshot) return false;
    state.orders = Array.isArray(snapshot.orders) ? snapshot.orders : [];
    state.weekArchive = Array.isArray(snapshot.weekArchive) ? snapshot.weekArchive : [];
    state.week = snapshot.week != null ? snapshot.week : null;
    state.sheet = snapshot.sheet != null ? snapshot.sheet : null;
    state.loadedAt = snapshot.loadedAt ? new Date(snapshot.loadedAt) : null;
    state.sheetDate = snapshot.sheetDate || null;
    state.sheetDateRaw = snapshot.sheetDateRaw || null;
    if (state.orders.length) saveState();
    else clearSavedState();
    try { window.refreshHeaderExcelInfo && window.refreshHeaderExcelInfo(); } catch(e) {}
    return true;
  }

  async function handleClearPiyasaClick() {
    try { window.closeAppToolsMenu && window.closeAppToolsMenu(); } catch (e) {}
    const ui = window.rpUi || {};
    if (!state.orders.length) {
      if (typeof ui.alert === 'function') await ui.alert('PİYASA Excel verisi zaten boş.', 'info');
      else toast('Piyasa verisi zaten boş.', 'info');
      return;
    }
    let okDel = false;
    if (typeof ui.confirm === 'function') {
      okDel = await ui.confirm('PİYASA Excel verisi silinecek.\n\nDevam edilsin mi?', { okLabel: 'Sil' });
    } else {
      okDel = await confirm('Piyasa verisini silmek istiyor musun?');
    }
    if (!okDel) return;

    const snapshot = {
      orders: JSON.parse(JSON.stringify(state.orders)),
      weekArchive: JSON.parse(JSON.stringify(state.weekArchive || [])),
      week: state.week,
      sheet: state.sheet,
      loadedAt: state.loadedAt ? state.loadedAt.toISOString() : null,
      sheetDate: state.sheetDate,
      sheetDateRaw: state.sheetDateRaw,
    };
    clearPiyasa();

    let choice = 'ok';
    if (typeof ui.alertDeleteSuccess === 'function') {
      choice = await ui.alertDeleteSuccess({
        message: 'PİYASA Excel verisi silindi.',
        withUndo: true
      });
    } else {
      toast('Piyasa verisi temizlendi.', 'info');
    }
    if (choice === 'undo') {
      restorePiyasa(snapshot);
      if (typeof ui.alert === 'function') await ui.alert('PİYASA Excel verisi geri yüklendi.', 'success');
    }
  }

  function bind(){
    const uploadBtn = document.getElementById('piyasaExcelUploadButtonTop');
    const clearBtn = document.getElementById('piyasaExcelClearButtonTop');

    // Menü butonları
    if (uploadBtn && !uploadBtn.__piyasaBound){
      uploadBtn.__piyasaBound = true;
      uploadBtn.addEventListener('click', ()=>{
        try { window.closeAppToolsMenu && window.closeAppToolsMenu(); } catch (e) {}
        const inp = ensureHiddenFileInput('piyasaExcelInputHidden');
        inp.onchange = ()=> {
          const f = inp.files && inp.files[0];
          inp.value = '';
          loadPiyasaExcel(f);
        };
        // Safari vb. için güvenli click
        try { inp.showPicker ? inp.showPicker() : inp.click(); } catch(e){ inp.click(); }
      });
      console.log('✅ Piyasa: UPLOAD button bağlandı');
    }

    if (clearBtn && !clearBtn.__piyasaBound){
      clearBtn.__piyasaBound = true;
      clearBtn.addEventListener('click', () => { handleClearPiyasaClick(); });
      console.log('✅ Piyasa: CLEAR button bağlandı');
    }

    if (!document.__piyasaDelegatedBound) {
      document.__piyasaDelegatedBound = true;
      document.addEventListener('click', (e)=>{
        const target = e.target.closest('#piyasaExcelUploadButtonTop, #piyasaExcelClearButtonTop');
        if (!target) return;
        if (target.id === 'piyasaExcelUploadButtonTop'){
          e.preventDefault();
          e.stopPropagation();
          try { window.closeAppToolsMenu && window.closeAppToolsMenu(); } catch (err) {}
          const inp = ensureHiddenFileInput('piyasaExcelInputHidden');
          inp.onchange = ()=> {
            const f = inp.files && inp.files[0];
            inp.value = '';
            loadPiyasaExcel(f);
          };
          try { inp.showPicker ? inp.showPicker() : inp.click(); } catch(err){ inp.click(); }
          return;
        }
        if (target.id === 'piyasaExcelClearButtonTop'){
          e.preventDefault();
          e.stopPropagation();
          handleClearPiyasaClick();
        }
      }, true);
    }
    
    // ✅ Debug: Butonlar tam olarak bağlandı mı kontrol et
    if (!uploadBtn && window.location.href.includes('GIRIS')) {
      console.warn('⚠️ Piyasa: #piyasaExcelUploadButtonTop bulunamadı!');
    }
    if (!clearBtn && window.location.href.includes('GIRIS')) {
      console.warn('⚠️ Piyasa: #piyasaExcelClearButtonTop bulunamadı!');
    }

    // "Bul" butonunu PİYASA modunda sipariş seçtirir yap
    const firmaAraBtn = document.getElementById('firmaAraBtn');
    if (firmaAraBtn && !firmaAraBtn.__piyasaHijacked){
      firmaAraBtn.__piyasaHijacked = true;
      firmaAraBtn.addEventListener('click', (e)=>{
        if (state.orders && state.orders.length){
          e.preventDefault();
          e.stopImmediatePropagation();
          openOrderPicker();
        }
      }, true); // capture: önce biz
    }

    const malzemeAraBtn = document.getElementById('malzemeAraBtn');
    if (malzemeAraBtn && !malzemeAraBtn.__piyasaHijacked){
      malzemeAraBtn.__piyasaHijacked = true;
      malzemeAraBtn.addEventListener('click', (e)=>{
        if (state.orders && state.orders.length){
          e.preventDefault();
          e.stopImmediatePropagation();
          openOrderPicker();
        }
      }, true);
    }
  }

  // init: UI render edildikten sonra butonlar geliyor, o yüzden kısa süre poll.
  async function init(){
    if (window.__piyasaInitStarted) return;
    window.__piyasaInitStarted = true;
    let restored = await loadStateFromServerFirst();
    if (!restored) restored = loadState();
    const onLoginScreen = !document.documentElement.classList.contains('logged-in');
    if (restored && !onLoginScreen && state.orders.length > 0){
      toast(`✅ Piyasa verisi geri yüklendi (${state.orders.length} satır)`, 'success');
      refreshPiyasaHeaderUi();
    } else if (!onLoginScreen) {
      refreshPiyasaHeaderUi();
    }
    if (!onLoginScreen) {
      setupPiyasaSyncListeners();
      refreshDurumStatus().then(() => reconcileOrderPrintCountsFromReports().catch(() => {})).catch(() => {});
      loadPiyasaCustomers(false).catch(() => {});
      if (typeof window.ensureXlsxLoaded === 'function') {
        window.ensureXlsxLoaded().catch(() => {});
      }
    }

    console.log('🔵 Piyasa init başladı - butonları arayacak...');
    
    let tries = 0;
    let boundSuccess = false;
    
    const t = setInterval(()=>{
      tries++;
      bind();
      const uploadBtn = document.getElementById('piyasaExcelUploadButtonTop');
      
      if (uploadBtn && uploadBtn.__piyasaBound && !boundSuccess) {
        console.log('✅ Piyasa init: Başarıyla bağlandı (try #' + tries + ')');
        boundSuccess = true;
        clearInterval(t);
        return;
      }
      
      if (tries > 200) {
        // 200 * 100ms = 20 saniye timeout
        console.error('❌ Piyasa init: HATA - 20 saniye sonra butonlar hala bulunamadı. Sayfayı yenileyin!');
        clearInterval(t);
      }
    }, 100); // ✅ Daha hızlı polling (250ms -> 100ms)
  }

