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
           <span style="font-size:clamp(16px,2.4vw,32px);font-weight:800;color:#4338ca;letter-spacing:-0.02em;line-height:1.1;white-space:normal;overflow-wrap:anywhere;text-align:center;">${escapeHtml(g1DateLabel)}</span>
         </div>`
      : `<div id="piyasaG1DateBadge" style="flex:1;min-width:0;"></div>`;
    const overlay = document.createElement('div');
    overlay.id = 'piyasaOrderPickerOverlay';
    overlay.setAttribute('data-piyasa-order-picker', '1');
    overlay.style.cssText = piyasaOverlayStyle(PIYASA_Z_BASE) + 'padding:14px;overflow:hidden;align-items:stretch;justify-content:stretch;box-sizing:border-box;';
    const durumFreezeBanner = isDurumFrozen() && _durumStatus.message
      ? `<div style="padding:8px 14px;background:#fef3c7;color:#92400e;font-size:12px;font-weight:700;border-bottom:1px solid #fde68a;">⏸ ${escapeHtml(_durumStatus.message)}</div>`
      : '';
    overlay.innerHTML = `
      <div style="position:relative;z-index:1;background:#fff;border-radius:14px;width:100%;height:100%;max-width:100%;max-height:100%;min-width:0;min-height:0;overflow:hidden;display:flex;flex-direction:column;box-sizing:border-box;box-shadow:0 18px 50px rgba(0,0,0,.35);">
        ${durumFreezeBanner}
        <div style="display:flex;align-items:center;gap:12px;padding:12px 14px;border-bottom:1px solid #eee;flex-wrap:wrap;min-width:0;max-width:100%;box-sizing:border-box;">
          <div style="flex:0 1 auto;min-width:0;max-width:100%;">
            <div style="font-weight:900;">Piyasa Sipariş Seç</div>
            <div id="duplicateWarning" style="font-size:12px;color:#6b5344;background:#faf6f1;border:1px solid #eadfce;padding:4px 8px;border-radius:8px;display:none;margin-top:4px;">Benzer sipariş var — HP için yükleme türü ve şehir, diğerleri için firma ve malzeme sütunlarına bakın</div>
          </div>
          ${g1DateHtml}
          <div style="flex:1 1 220px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:flex-end;min-width:0;max-width:100%;">
            ${skippedCount ? `<button type="button" id="piyasaSkippedBtn" style="border:0;background:#fef3c7;color:#92400e;border-radius:8px;padding:6px 10px;font-size:11px;cursor:pointer;font-weight:700;">Elenen satırlar (${skippedCount})</button>` : ''}
            ${searchAllSheets
              ? `<div style="font-size:12px;color:#4338ca;font-weight:700;white-space:normal;min-width:0;">${state.week != null ? `${state.week}. hafta — tüm sayfalar` : 'Bu haftanın tüm sayfalarında ara'}</div>`
              : `<label style="font-size:12px;color:#666;display:flex;align-items:center;gap:6px;flex-wrap:wrap;min-width:0;max-width:100%;">
                  <span>Sheet:</span>
                  <select id="piyasaPickerSheet" style="padding:6px 8px;border:1px solid #ddd;border-radius:8px;font-size:12px;font-weight:700;max-width:min(42vw,240px);cursor:pointer;"></select>
                </label>`}
            <button id="piyasaModalClose" style="border:0;background:#eee;border-radius:10px;padding:6px 10px;cursor:pointer;">Kapat</button>
          </div>
        </div>
        <div class="piyasa-toolbar">
          <input id="piyasaSearch" class="piyasa-tool-search" placeholder="${searchAllSheets ? (state.week != null ? `Firma / Malzeme / İl ara… (${state.week}. hafta, tüm sayfalar)` : 'Firma / Malzeme / İl ara… (bu hafta, tüm sayfalar)') : 'Firma / Malzeme / İl ara… (seçili sheet)'}" >
          <select id="piyasaSevkiyatFilter" class="piyasa-tool-select" title="Excel SEVKİYAT TİPİ">
            <option value="all">Tüm siparişler</option>
            <option value="Yİ-GP">Yİ-GP</option>
            <option value="Yİ-HP">Yİ-HP</option>
          </select>
          <div class="piyasa-tool-actions">
            ${clientIsAmir() ? '<button type="button" id="piyasaExpectedBtn" class="piyasa-tool-btn is-expected" title="WhatsApp’tan gelecek araç"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M3 7h11v8H3V7z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M14 10h3.2L20 13v2h-6" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><circle cx="7" cy="17.5" r="1.4" fill="currentColor"/><circle cx="17" cy="17.5" r="1.4" fill="currentColor"/></svg><span>Gelen araç</span></button>' : ''}
            <button type="button" id="piyasaCustomerListBtn" class="piyasa-tool-btn is-customers" title="Sabit müşteri/bayi listesi"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="9" cy="8" r="2.4" stroke="currentColor" stroke-width="1.7"/><path d="M4.5 17.5c.6-2.2 2.4-3.5 4.5-3.5s3.9 1.3 4.5 3.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><circle cx="16.2" cy="8.5" r="1.8" stroke="currentColor" stroke-width="1.7"/><path d="M16 14c1.6.2 2.9 1.2 3.5 3" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg><span>Müşteri listesi</span></button>
            <div id="piyasaCount" class="piyasa-tool-count"></div>
          </div>
        </div>
        <div id="piyasaTableScroll" style="padding:0 8px 8px;overflow-x:hidden;overflow-y:auto;flex:1;min-width:0;min-height:0;max-width:100%;width:100%;box-sizing:border-box;-webkit-overflow-scrolling:touch;">
          <table style="width:100%;max-width:100%;border-collapse:collapse;font-size:12px;table-layout:fixed;">
            <colgroup>
              <col style="width:4%">
              <col style="width:8%">
              <col style="width:8%">
              <col style="width:5%">
              <col style="width:7%">
              <col style="width:8%">
              <col style="width:8%">
              <col style="width:6%">
              <col style="width:5%">
              <col style="width:4%">
              <col style="width:6%">
              <col style="width:6%">
              <col style="width:13%">
              <col style="width:9%">
              <col style="width:3%">
            </colgroup>
            <thead>
              <tr style="background:#f6f6f6;position:sticky;top:0;z-index:2;">
                <th style="text-align:center;padding:6px 4px;border:1px solid #eee;white-space:normal;line-height:1.2;font-size:10px;">SIRA<br>NO</th>
                <th style="text-align:center;padding:6px 4px;border:1px solid #eee;white-space:normal;line-height:1.2;font-size:10px;" title="Excel: PLANLANAN SEV TARİHİ">PLANLANAN<br>SEV</th>
                <th style="text-align:center;padding:6px 4px;border:1px solid #eee;white-space:normal;line-height:1.2;font-size:10px;" title="Excel: FİİLİ SEVK ÇIKIŞ TARİHİ. Tarihi geçen satır soluk, Seç ve Düzenle kapalı.">FİİLİ<br>ÇIKIŞ</th>
                <th style="text-align:left;padding:6px 4px;border:1px solid #eee;white-space:normal;line-height:1.2;font-size:10px;word-break:break-word;">FİRMA</th>
                <th style="text-align:left;padding:6px 4px;border:1px solid #eee;white-space:normal;line-height:1.2;font-size:10px;word-break:break-word;">SİP NO</th>
                <th style="text-align:left;padding:6px 4px;border:1px solid #eee;white-space:normal;line-height:1.2;font-size:10px;word-break:break-word;">FİRMA<br>ADI</th>
                <th style="text-align:left;padding:6px 4px;border:1px solid #eee;white-space:normal;line-height:1.2;font-size:10px;word-break:break-word;">MALZEME</th>
                <th style="text-align:left;padding:6px 4px;border:1px solid #eee;white-space:normal;line-height:1.2;font-size:10px;word-break:break-word;">YÜKLEME<br>TÜRÜ</th>
                <th style="text-align:left;padding:6px 4px;border:1px solid #eee;white-space:normal;line-height:1.2;font-size:10px;word-break:break-word;">ÖDEME<br>TÜRÜ</th>
                <th style="text-align:left;padding:6px 4px;border:1px solid #eee;white-space:normal;line-height:1.2;font-size:10px;">ORG</th>
                <th style="text-align:left;padding:6px 4px;border:1px solid #eee;white-space:normal;line-height:1.2;font-size:10px;word-break:break-word;">ŞEHİR</th>
                <th style="text-align:left;padding:6px 4px;border:1px solid #eee;white-space:normal;line-height:1.2;font-size:10px;word-break:break-word;">MİKTAR</th>
                <th style="text-align:left;padding:6px 4px;border:1px solid #eee;white-space:normal;line-height:1.2;font-size:10px;" title="Excel açıklamasındaki renk ve satır düzeni">AÇIKLAMA</th>
                <th style="text-align:center;padding:6px 2px;border:1px solid #eee;white-space:normal;font-size:10px;">SEÇ</th>
                <th style="text-align:center;padding:4px 1px;border:1px solid #eee;white-space:normal;font-size:8px;">DURUM</th>
              </tr>
            </thead>
            <tbody id="piyasaTbody"></tbody>
          </table>
        </div>
        <style>
          #piyasaOrderPickerOverlay, #piyasaOrderPickerOverlay * { box-sizing: border-box; }
          #piyasaOrderPickerOverlay { overflow: hidden !important; }
          #piyasaOrderPickerOverlay table { width: 100%; max-width: 100%; table-layout: fixed; }
          #piyasaOrderPickerOverlay th,
          #piyasaOrderPickerOverlay td {
            overflow: hidden;
            min-width: 0;
            max-width: 100%;
            word-break: break-word;
            overflow-wrap: anywhere;
            white-space: normal;
            border-left: 1px solid #6f6862 !important;
            border-right: 1px solid #6f6862 !important;
            border-top: 1px solid #cfc9c2 !important;
            border-bottom: 1px solid #cfc9c2 !important;
          }
          #piyasaOrderPickerOverlay thead th {
            border-bottom: 2px solid #44403c !important;
          }
          #piyasaOrderPickerOverlay tbody tr td {
            transition: box-shadow .12s ease;
          }
          #piyasaOrderPickerOverlay tbody tr:hover td {
            box-shadow: inset 0 0 0 999px rgba(67, 56, 202, 0.13);
          }
          #piyasaOrderPickerOverlay tbody tr:hover td:first-child {
            box-shadow: inset 4px 0 0 #4338ca, inset 0 0 0 999px rgba(67, 56, 202, 0.13);
          }
          #piyasaOrderPickerOverlay td button { max-width: 100%; white-space: normal; }
          #piyasaOrderPickerOverlay .piyasa-toolbar {
            display: flex;
            align-items: center;
            gap: 8px;
            flex-wrap: wrap;
            padding: 10px 14px;
            border-bottom: 1px solid #e7e5e4;
            background: #fafaf9;
            min-width: 0;
            max-width: 100%;
          }
          #piyasaOrderPickerOverlay .piyasa-tool-search,
          #piyasaOrderPickerOverlay .piyasa-tool-select {
            height: 36px;
            border: 1px solid #e7e5e4;
            border-radius: 8px;
            background: #fff;
            color: #1c1917;
            font-size: 13px;
            padding: 0 12px;
            outline: none;
          }
          #piyasaOrderPickerOverlay .piyasa-tool-search {
            flex: 1 1 220px;
            min-width: 0;
            max-width: 100%;
          }
          #piyasaOrderPickerOverlay .piyasa-tool-search:focus,
          #piyasaOrderPickerOverlay .piyasa-tool-select:focus {
            border-color: #a8a29e;
            box-shadow: 0 0 0 3px rgba(28, 25, 23, 0.06);
          }
          #piyasaOrderPickerOverlay .piyasa-tool-select { cursor: pointer; max-width: 100%; }
          #piyasaOrderPickerOverlay .piyasa-tool-actions {
            display: flex;
            align-items: center;
            gap: 6px;
            flex-wrap: wrap;
            min-width: 0;
            max-width: 100%;
          }
          #piyasaOrderPickerOverlay .piyasa-tool-btn {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            height: 36px;
            padding: 0 12px;
            border: 1px solid #e7e5e4;
            border-radius: 8px;
            background: #fff;
            color: #292524;
            font-size: 12px;
            font-weight: 600;
            line-height: 1;
            cursor: pointer;
            white-space: nowrap;
            max-width: 100%;
          }
          #piyasaOrderPickerOverlay .piyasa-tool-btn:hover {
            background: #f5f5f4;
            border-color: #d6d3d1;
          }
          #piyasaOrderPickerOverlay .piyasa-tool-btn.is-expected {
            background: #c2410c;
            border-color: #c2410c;
            color: #fff;
          }
          #piyasaOrderPickerOverlay .piyasa-tool-btn.is-expected:hover { background: #9a3412; }
          #piyasaOrderPickerOverlay .piyasa-tool-btn.is-customers {
            background: #0f766e;
            border-color: #0f766e;
            color: #fff;
          }
          #piyasaOrderPickerOverlay .piyasa-tool-btn.is-customers:hover { background: #115e59; }
          #piyasaOrderPickerOverlay .piyasa-tool-count {
            margin-left: 4px;
            font-size: 12px;
            font-weight: 600;
            color: #78716c;
            line-height: 1.3;
            min-width: 0;
          }
          #piyasaOrderPickerOverlay [data-history-key] { width: 100% !important; max-width: 26px; min-width: 0; height: auto; padding: 2px; }
          #piyasaOrderPickerOverlay .piyasa-sipno-cell {
            white-space: normal;
            overflow: hidden;
            word-break: break-all;
            overflow-wrap: anywhere;
            font-size: 11px;
            letter-spacing: -0.02em;
          }
          #piyasaOrderPickerOverlay .piyasa-aciklama-text {
            display: -webkit-box;
            -webkit-box-orient: vertical;
            -webkit-line-clamp: 4;
            overflow: hidden;
            white-space: normal;
            word-break: break-word;
            overflow-wrap: anywhere;
            line-height: 1.35;
            max-height: 5.4em;
            min-height: 1.35em;
          }
          #piyasaOrderPickerOverlay .piyasa-aciklama-cell.is-open .piyasa-aciklama-text {
            display: block;
            -webkit-line-clamp: unset;
            max-height: none;
            overflow: visible;
            white-space: pre-wrap;
          }
          #piyasaOrderPickerOverlay .piyasa-aciklama-cell[data-aciklama-toggle="1"] { cursor: pointer; }
          #piyasaOrderPickerOverlay .piyasa-aciklama-cell[data-aciklama-toggle="1"]:hover { filter: brightness(0.97); }
        </style>
      </div>
    `;
    const prevBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.body.appendChild(overlay);

    const close = ()=> {
      _pickerRenderHook = null;
      window.__piyasaPickerOpen = false;
      document.body.style.overflow = prevBodyOverflow;
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

    const CELL_WRAP_EXTRA = 'white-space:normal;word-break:break-word;overflow-wrap:anywhere;line-height:1.35;vertical-align:middle;';
    const SEHIR_CELL_EXTRA = CELL_WRAP_EXTRA;
    const MIKTAR_CELL_EXTRA = CELL_WRAP_EXTRA;
    const SIPNO_CELL_EXTRA = 'white-space:normal;overflow:hidden;word-break:break-all;overflow-wrap:anywhere;vertical-align:middle;font-size:11px;';
    const ACIKLAMA_CELL_EXTRA = 'vertical-align:middle;font-size:11px;color:#1e293b;max-width:0;';
    const SELECT_CELL_EXTRA = 'white-space:nowrap;text-align:center;vertical-align:middle;';
    const STATUS_CELL_EXTRA = 'white-space:nowrap;text-align:center;vertical-align:middle;font-size:10px;padding:4px 1px;';
    const NO_CELL_EXTRA = 'white-space:nowrap;text-align:center;vertical-align:middle;font-weight:700;';

    const ACIKLAMA_PREVIEW_LIMIT = 100;

    function formatAciklamaHtml(text) {
      return escapeHtml(String(text || '').trim()).replace(/\r\n/g, '\n').replace(/\n/g, '<br>');
    }

    function clipAciklamaPreview(text) {
      const s = String(text || '').replace(/\s+/g, ' ').trim();
      if (s.length <= ACIKLAMA_PREVIEW_LIMIT) return s;
      return s.slice(0, ACIKLAMA_PREVIEW_LIMIT).trimEnd() + '…';
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
    let editingPickKey = '';
    let editDraft = null;
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

    function pickerDuplicateKey(o, firmaAdi) {
      const code = String(o.firma || '').trim();
      if (isHpStyleFirma(code)) {
        return [
          code.toUpperCase(),
          normYuklemeTuruKey(o.yuklemeTuru),
          orderSehirKey(o),
          String(o.malzeme || '').trim().toUpperCase(),
        ].join('\x1e');
      }
      return firmaAdi || code;
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
        const dupKey = pickerDuplicateKey(e.o, e.firmaAdi);
        if (dupKey) firmaCount[dupKey] = (firmaCount[dupKey] || 0) + 1;
      }

      const duplicateFirmas = new Set();
      for (const key of Object.keys(firmaCount)) {
        if (firmaCount[key] > 1) duplicateFirmas.add(key);
      }

      return { rows, duplicateFirmas, filterText: f, tipMode: mode };
    }

    function rowHtml(o, duplicateFirmas, options) {
      const forPrint = !!(options && options.forPrint);
      const showWeek = !!(options && options.showWeek);
      const firmaCode = String(o.firma || '').trim();
      const firmaAdi = _resolvePickerFirmaAdi(o);
      const dupKey = pickerDuplicateKey(o, firmaAdi);
      const isDuplicate = duplicateFirmas.has(dupKey);
      const isUsed = !!o.usedAt;
      const printCount = getOrderPrintCount(o);
      const statusInner = buildOrderStatusCell(o, forPrint);
      const fiiliSevkLabel = String(o.fiiliSevkCikis || '').trim();
      const fiiliSevkPast = typeof isOrderFiiliSevkPast === 'function' && isOrderFiiliSevkPast(o);

      const normalStyle = 'padding:6px 4px;border:1px solid #eee;' + CELL_WRAP_EXTRA;
      const usedStyle = 'padding:6px 4px;border:1px solid #eee;background:#f3f4f6;color:#6b7280;' + CELL_WRAP_EXTRA;
      const dupStyle = 'padding:6px 4px;border:1px solid #f0e6da;background:#faf6f1;color:#3f342c;font-weight:600;' + CELL_WRAP_EXTRA;
      const dupMarkStyle = 'padding:6px 4px;border:1px solid #eadfce;background:#f3ebe1;color:#6b4423;font-weight:700;' + CELL_WRAP_EXTRA;
      const pastStyle = 'padding:6px 4px;border:1px solid #e7e5e4;background:#f7f6f5;color:#a8a29e;' + CELL_WRAP_EXTRA;
      const printDupClass = forPrint ? '' : (fiiliSevkPast ? '' : (isDuplicate ? ' class="piyasa-print-dup"' : ''));
      const printUsedClass = forPrint ? '' : ((!fiiliSevkPast && !isDuplicate && (isUsed || printCount > 0)) ? ' class="piyasa-print-used"' : '');
      const cellStyle = (highlight) => {
        if (fiiliSevkPast) return pastStyle;
        if (isDuplicate) return highlight ? dupMarkStyle : dupStyle;
        if (isUsed || printCount >= 2) return usedStyle;
        if (printCount === 1) return normalStyle + 'background:#f0fdf4;';
        return normalStyle;
      };
      let aciklamaFull = String(o.aciklama || '').trim();
      if (/^#?[0-9A-Fa-f]{6}$/.test(aciklamaFull)) aciklamaFull = '';
      const miktarFull = String(o.miktar || '').trim();
      const sehirFull = String(o.il || o.sevkYeri || '').trim();
      const sehirCellStyle = `${fiiliSevkPast ? pastStyle : (isDuplicate ? dupStyle : cellStyle(false))}${SEHIR_CELL_EXTRA}`;
      const miktarCellStyle = `${fiiliSevkPast ? pastStyle : (isDuplicate ? dupMarkStyle : cellStyle(false))}${MIKTAR_CELL_EXTRA}`;
      const sipNoCellStyle = `${fiiliSevkPast ? pastStyle : (isDuplicate ? dupStyle : cellStyle(false))}${SIPNO_CELL_EXTRA}`;
      const aciklamaCellStyle = `${cellStyle(false)}${ACIKLAMA_CELL_EXTRA}`;
      const selectBg = fiiliSevkPast ? '#f7f6f5' : (isDuplicate ? '#faf6f1' : (isUsed ? '#f3f4f6' : '#fff'));
      const selectCellStyle = `${cellStyle(false)}${SELECT_CELL_EXTRA}background:${selectBg};text-align:center;`;
      const aciklamaInner = formatAciklamaHtml(aciklamaFull) || '<span style="color:#9ca3af;">—</span>';
      const aciklamaPreview = clipAciklamaPreview(aciklamaFull);
      const aciklamaCanOpen = aciklamaFull.replace(/\s+/g, ' ').trim().length > ACIKLAMA_PREVIEW_LIMIT;
      const aciklamaRenk = (aciklamaFull && !forPrint && /^#[0-9A-Fa-f]{6}$/.test(String(o.aciklamaRenk || ''))) ? String(o.aciklamaRenk) : '';
      const aciklamaExcelStyle = aciklamaRenk ? `background:${aciklamaRenk};color:#111827;` : '';
      const aciklamaTd = forPrint
        ? `<td class="col-acik"${printDupClass || printUsedClass}>${aciklamaInner}</td>`
        : `<td class="piyasa-aciklama-cell" data-aciklama-toggle="${aciklamaCanOpen ? '1' : '0'}" data-full="${escapeHtml(aciklamaFull)}" data-preview="${escapeHtml(aciklamaPreview)}" style="${aciklamaCellStyle}${aciklamaExcelStyle}" title="${escapeHtml(aciklamaCanOpen ? 'Tıklayınca tam açıklama açılır' : (aciklamaFull || ''))}">
            <div class="piyasa-aciklama-text" style="font-size:11px;line-height:1.35;color:inherit;">${aciklamaPreview ? escapeHtml(aciklamaPreview) : '<span style="color:#9ca3af;">—</span>'}</div>
          </td>`;
      const statusTd = forPrint
        ? `<td class="col-durum"${printDupClass || printUsedClass}>${statusInner || '—'}</td>`
        : `<td${printDupClass || printUsedClass} style="${cellStyle(false)}${STATUS_CELL_EXTRA}">${statusInner}</td>`;
      const rowClass = forPrint && isDuplicate && !fiiliSevkPast ? ' class="piyasa-print-strong"' : '';
      const rowStyle = fiiliSevkPast
        ? ' title="Fiili sevk çıkış tarihi geçti"'
        : ((!forPrint && isDuplicate)
          ? ' style="box-shadow:inset 3px 0 0 #c4a484;"'
          : ((!forPrint && isUsed && printCount < 2) ? ' style="opacity:.92;"' : ''));
      const weekBadge = (showWeek && (o._weekLabel || o._sourceSheet))
        ? `<span style="display:block;margin-top:2px;max-width:100%;overflow:hidden;font-size:8px;line-height:1.15;font-weight:700;word-break:break-word;color:${o._isCurrentWeek ? '#059669' : '#6366f1'};">${escapeHtml([o._weekLabel, o._sourceSheet].filter(Boolean).join(' · '))}</span>`
        : '';
      const noCellStyle = forPrint ? '' : `${cellStyle(false)}${NO_CELL_EXTRA}overflow:hidden;`;

      const sipNo = String(o.sipNo || '').trim();
      const pickKey = String(o._pickKey || o.__idx);
      const showEdit = !forPrint && clientIsAmir();
      const canEdit = showEdit;
      const isEditing = canEdit && editingPickKey === pickKey;
      const draftSip = isEditing && editDraft ? String(editDraft.sipNo || '') : sipNo;
      const draftAcik = isEditing && editDraft ? String(editDraft.aciklama || '') : aciklamaFull;
      const draftFiili = isEditing && editDraft ? String(editDraft.fiiliSevkCikis || '') : fiiliSevkLabel;
      const sipCell = isEditing
        ? `<td class="piyasa-sipno-cell" style="${sipNoCellStyle}">
            <input class="piyasa-edit-sip" data-edit-key="${escapeHtml(pickKey)}" maxlength="40" value="${escapeHtml(draftSip)}" placeholder="Sipariş no" style="width:100%;box-sizing:border-box;padding:4px;border:1px solid #d97706;border-radius:6px;font-size:11px;font-weight:700;">
          </td>`
        : `<td class="piyasa-sipno-cell"${forPrint ? (printDupClass || printUsedClass) : ''} style="${forPrint ? '' : sipNoCellStyle}" title="${escapeHtml(sipNo)}">${sipNo ? escapeHtml(sipNo) : ''}</td>`;
      const aciklamaEditTd = isEditing
        ? `<td class="piyasa-aciklama-cell" data-aciklama-toggle="0" style="${aciklamaCellStyle}">
            <textarea class="piyasa-edit-acik" data-edit-key="${escapeHtml(pickKey)}" maxlength="500" rows="3" placeholder="Açıklama" style="width:100%;box-sizing:border-box;padding:4px;border:1px solid #d97706;border-radius:6px;font-size:11px;resize:vertical;">${escapeHtml(draftAcik)}</textarea>
          </td>`
        : aciklamaTd;
      const pickerBtn = 'display:block;width:100%;max-width:100%;box-sizing:border-box;min-height:28px;min-width:0;border:0;border-radius:8px;font-size:11px;font-weight:800;line-height:1.15;white-space:normal;overflow-wrap:anywhere;padding:4px 2px;';
      const editLive = pickerBtn + 'cursor:pointer;background:#fff7ed;color:#9a3412;';
      const pickLive = pickerBtn + `cursor:pointer;background:${isUsed ? '#57534e' : '#292524'};color:#fff;`;
      const editActions = !showEdit ? '' : (isEditing
        ? `<div style="display:flex;flex-direction:column;gap:4px;width:100%;">
            <button type="button" data-save-key="${escapeHtml(pickKey)}" style="${pickerBtn}cursor:pointer;background:#9a3412;color:#fff;">Kaydet</button>
            <button type="button" data-cancel-edit="1" style="${pickerBtn}cursor:pointer;background:#f5f5f4;color:#44403c;font-weight:700;">Vazgeç</button>
          </div>`
          : `<button type="button" data-edit-key="${escapeHtml(pickKey)}" style="${editLive}">Düzenle</button>`);
      const fiiliSevkTd = forPrint
        ? `<td style="white-space:nowrap;">${fiiliSevkLabel ? escapeHtml(fiiliSevkLabel) : '—'}${fiiliSevkPast ? '<br>geçti' : ''}</td>`
        : (isEditing
          ? `<td style="${cellStyle(false)}overflow:hidden;text-align:center;">
              <input class="piyasa-edit-fiili" data-edit-key="${escapeHtml(pickKey)}" maxlength="10" value="${escapeHtml(draftFiili)}" placeholder="gg.aa.yyyy" title="Fiili çıkış tarihi" style="width:100%;box-sizing:border-box;padding:4px 2px;border:1px solid #d97706;border-radius:6px;font-size:11px;font-weight:700;text-align:center;">
            </td>`
          : `<td style="${cellStyle(false)}overflow:hidden;text-align:center;line-height:1.15;" title="${escapeHtml(fiiliSevkPast ? 'Fiili sevk çıkış tarihi geçti' : 'Fiili sevk çıkış tarihi')}">
            <div style="white-space:normal;overflow-wrap:anywhere;font-size:11px;font-weight:700;">${fiiliSevkLabel ? escapeHtml(fiiliSevkLabel) : '<span style="color:#a8a29e;font-weight:500;">—</span>'}</div>
            ${fiiliSevkPast ? '<div style="white-space:normal;font-size:9px;font-weight:700;letter-spacing:.04em;color:#a8a29e;margin-top:2px;">geçti</div>' : ''}
          </td>`);
      const selectTdLive = forPrint ? '' : `<td style="${selectCellStyle}">
            <div style="display:flex;flex-direction:column;gap:4px;width:100%;align-items:stretch;">
              ${editActions}
              <button type="button" data-pick-key="${escapeHtml(pickKey)}" style="${pickLive}">Seç</button>
            </div>
          </td>`;
      const siraLabel = String(o.siraNo || o.__idx || '').trim();
      const planlananLabel = String(o.planlananSev || '').trim();
      const planlananTd = forPrint
        ? `<td style="white-space:nowrap;">${planlananLabel ? escapeHtml(planlananLabel) : '—'}</td>`
        : `<td style="${cellStyle(false)}overflow:hidden;text-align:center;white-space:normal;overflow-wrap:anywhere;font-size:11px;font-weight:700;" title="Planlanan sev tarihi">${planlananLabel ? escapeHtml(planlananLabel) : '<span style="color:#a8a29e;font-weight:500;">—</span>'}</td>`;
      return `
        <tr${rowClass}${rowStyle}>
          <td${forPrint ? ' class="col-no"' : ''} style="${noCellStyle}">${escapeHtml(siraLabel)}${weekBadge}</td>
          ${planlananTd}
          ${fiiliSevkTd}
          <td${forPrint ? (printDupClass || printUsedClass) : ''} style="${forPrint ? '' : cellStyle(false)}">${escapeHtml(firmaCode)}</td>
          ${sipCell}
          <td${forPrint ? (printDupClass || printUsedClass) : ''} style="${forPrint ? '' : cellStyle(false)}">${escapeHtml(firmaAdi)}</td>
          <td${forPrint ? (printDupClass || printUsedClass) : ''} style="${forPrint ? '' : cellStyle(false)}">${escapeHtml(o.malzeme||'')}</td>
          <td${forPrint ? (printDupClass || printUsedClass) : ''} style="${forPrint ? '' : cellStyle(true)}">${escapeHtml(o.yuklemeTuru||'')}</td>
          <td${forPrint ? (printDupClass || printUsedClass) : ''} style="${forPrint ? '' : cellStyle(false)}">${escapeHtml(o.odemeTuru||'')}</td>
          <td${forPrint ? (printDupClass || printUsedClass) : ''} style="${forPrint ? '' : cellStyle(false)}">${escapeHtml(o.org||'')}</td>
          <td${forPrint ? (printDupClass || printUsedClass) : ''} style="${forPrint ? '' : sehirCellStyle}" title="${escapeHtml(sehirFull)}">${formatSehirHtml(sehirFull)}</td>
          <td${forPrint ? (printDupClass || printUsedClass) : ''} style="${forPrint ? '' : miktarCellStyle}" title="${escapeHtml(miktarFull)}">${escapeHtml(miktarFull)}</td>
          ${aciklamaEditTd}
          ${selectTdLive}
          ${statusTd}
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
    col.c-no { width: 4%; }
    col.c-plan { width: 8%; }
    col.c-fiili { width: 8%; }
    col.c-durum { width: 5%; }
    col.c-firma { width: 6%; }
    col.c-sip { width: 6%; }
    col.c-fadi { width: 9%; }
    col.c-malz { width: 10%; }
    col.c-yuk { width: 7%; }
    col.c-ode { width: 7%; }
    col.c-org { width: 4%; }
    col.c-seh { width: 8%; }
    col.c-mik { width: 8%; }
    col.c-acik { width: 18%; }
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
      <col class="c-no"><col class="c-plan"><col class="c-fiili"><col class="c-firma"><col class="c-sip"><col class="c-fadi"><col class="c-malz">
      <col class="c-yuk"><col class="c-ode"><col class="c-org"><col class="c-seh">
      <col class="c-mik"><col class="c-acik"><col class="c-durum">
    </colgroup>
    <thead>
      <tr>
        <th class="col-no">SIRA NO</th><th>PLANLANAN SEV</th><th>FİİLİ ÇIKIŞ</th><th>FİRMA</th><th>SİP NO</th><th>FİRMA ADI</th><th>MALZEME</th>
        <th>YÜK.TÜR</th><th>ÖD.TÜR</th><th>ORG</th><th>ŞEHİR</th>
        <th>MİKTAR</th><th class="col-acik">AÇIKLAMA</th><th class="col-durum">DURUM</th>
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

    function readEditDraftFromDom() {
      if (!editDraft) return;
      const sipEl = tbody.querySelector('input.piyasa-edit-sip');
      const acikEl = tbody.querySelector('textarea.piyasa-edit-acik');
      const fiiliEl = tbody.querySelector('input.piyasa-edit-fiili');
      if (sipEl) editDraft.sipNo = sipEl.value;
      if (acikEl) editDraft.aciklama = acikEl.value;
      if (fiiliEl) editDraft.fiiliSevkCikis = fiiliEl.value;
    }

    function savePickerRow(pickKey) {
      if (!clientIsAmir() || !pickKey) return false;
      readEditDraftFromDom();
      const draft = editDraft && editDraft.key === pickKey ? editDraft : null;
      const sipNo = draft ? draft.sipNo : (tbody.querySelector('input.piyasa-edit-sip') || {}).value;
      const aciklama = draft ? draft.aciklama : (tbody.querySelector('textarea.piyasa-edit-acik') || {}).value;
      const fiiliRaw = draft ? draft.fiiliSevkCikis : (tbody.querySelector('input.piyasa-edit-fiili') || {}).value;
      const fiiliText = String(fiiliRaw || '').trim();
      if (fiiliText && !(window.ExcelUtils && window.ExcelUtils.parseFiiliSevkCikis && window.ExcelUtils.parseFiiliSevkCikis(fiiliText))) {
        alert('Fiili çıkış tarihi gg.aa.yyyy biçiminde olmalı. Örnek: 01.10.2026. Boş bırakılırsa tarih silinir.');
        return false;
      }
      if (typeof patchPiyasaOrderText !== 'function' || !patchPiyasaOrderText(pickKey, { sipNo, aciklama, fiiliSevkCikis: fiiliText })) {
        alert('Bu satır kaydedilemedi.');
        return false;
      }
      editingPickKey = '';
      editDraft = null;
      rebuildPickerCacheForView();
      render(searchEl.value);
      return true;
    }

    if (!tbody._piyasaPickerClickBound) {
      tbody._piyasaPickerClickBound = true;
      tbody.addEventListener('input', (e) => {
        if (!editDraft) return;
        if (e.target.classList && e.target.classList.contains('piyasa-edit-sip')) editDraft.sipNo = e.target.value;
        if (e.target.classList && e.target.classList.contains('piyasa-edit-acik')) editDraft.aciklama = e.target.value;
        if (e.target.classList && e.target.classList.contains('piyasa-edit-fiili')) editDraft.fiiliSevkCikis = e.target.value;
      });
      tbody.addEventListener('click', async (e) => {
        if (e.target.closest('input, textarea')) return;
        const acikCell = e.target.closest('.piyasa-aciklama-cell');
        if (acikCell && acikCell.getAttribute('data-aciklama-toggle') === '1') {
          e.preventDefault();
          e.stopPropagation();
          const textEl = acikCell.querySelector('.piyasa-aciklama-text');
          const full = acikCell.getAttribute('data-full') || '';
          const preview = acikCell.getAttribute('data-preview') || clipAciklamaPreview(full);
          const open = acikCell.classList.toggle('is-open');
          if (textEl) {
            if (open) textEl.innerHTML = formatAciklamaHtml(full) || '—';
            else textEl.textContent = preview;
          }
          return;
        }
        const historyBtn = e.target.closest('button[data-history-key]');
        if (historyBtn) {
          e.preventDefault();
          e.stopPropagation();
          const pickKey = historyBtn.getAttribute('data-history-key');
          const selected = visiblePickerRows.find((x) => (x._pickKey || String(x.__idx)) === pickKey);
          if (selected) showMalzemeVehicleHistoryModal(selected);
          return;
        }
        const editBtn = e.target.closest('button[data-edit-key]');
        if (editBtn) {
          e.preventDefault();
          e.stopPropagation();
          if (!clientIsAmir()) return;
          const key = editBtn.getAttribute('data-edit-key');
          const row = visiblePickerRows.find((x) => (x._pickKey || String(x.__idx)) === key);
          if (!row) return;
          editingPickKey = key;
          editDraft = { key, sipNo: String(row.sipNo || ''), aciklama: String(row.aciklama || ''), fiiliSevkCikis: String(row.fiiliSevkCikis || '') };
          render(searchEl.value);
          const input = tbody.querySelector('input.piyasa-edit-sip');
          if (input) input.focus();
          return;
        }
        const saveBtn = e.target.closest('button[data-save-key]');
        if (saveBtn) {
          e.preventDefault();
          e.stopPropagation();
          savePickerRow(saveBtn.getAttribute('data-save-key'));
          return;
        }
        const cancelBtn = e.target.closest('button[data-cancel-edit]');
        if (cancelBtn) {
          e.preventDefault();
          e.stopPropagation();
          editingPickKey = '';
          editDraft = null;
          render(searchEl.value);
          return;
        }
        const pickBtn = e.target.closest('button[data-pick-key]');
        if (!pickBtn) return;
        e.preventDefault();
        e.stopPropagation();
        if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
        if (pickBtn.disabled) return;
        const pickKey = pickBtn.getAttribute('data-pick-key');
        if (editingPickKey === pickKey && !savePickerRow(pickKey)) return;
        const selected = (typeof getOrderByIdx === 'function' && getOrderByIdx(pickKey))
          || visiblePickerRows.find((x) => (x._pickKey || String(x.__idx)) === pickKey);
        if (!selected) return;

        const tipMode = sevkiyatFilterEl ? sevkiyatFilterEl.value : 'all';
        const { duplicateFirmas } = getPickerRows(searchEl.value, tipMode);
        const firmaAdi = _resolvePickerFirmaAdi(selected);
        const isDuplicate = duplicateFirmas.has(pickerDuplicateKey(selected, firmaAdi));

        const okPick = await confirmHpOrderPickIfNeeded(selected, isDuplicate);
        if (!okPick) return;

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
        } finally {
          pickBtn.disabled = false;
          pickBtn.textContent = originalText;
        }
      });
    }

    const expectedBtn = overlay.querySelector('#piyasaExpectedBtn');
    if (expectedBtn) expectedBtn.onclick = () => { if (typeof openExpectedPasteModal === 'function') openExpectedPasteModal(); };

    const customerListBtn = overlay.querySelector('#piyasaCustomerListBtn');
    if (customerListBtn) customerListBtn.onclick = () => openPiyasaCustomerListModal();

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
      metas = typeof recentPiyasaSheetMetas === 'function' ? recentPiyasaSheetMetas(metas) : (metas || []);
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
          <div style="padding:0 18px 8px;font-size:12px;color:#64748b;">Son hafta ve bir önceki hafta. Daha eski haftalar listelenmez.</div>
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

  function clientIsAmir() {
    try {
      if (window.SessionManager && typeof window.SessionManager.isAmirUser === 'function') {
        return !!window.SessionManager.isAmirUser();
      }
      const role = String(localStorage.getItem('currentUserRole') || '').trim().toLowerCase();
      const id = String(localStorage.getItem('currentUserId') || '').trim().toLowerCase();
      return role === 'amir' || id === 'xxr';
    } catch (e) {
      return false;
    }
  }

  const PIYASA_HANDLE_DB = 'piyasa_excel_handle_db';
  let _piyasaLiveHandle = null;
  let _piyasaRefreshBusy = false;

  function setPiyasaLiveHandle(handle) {
    if (!handle || typeof handle.getFile !== 'function') return;
    _piyasaLiveHandle = handle;
  }

  async function persistPiyasaHandle(handle) {
    if (!handle) return false;
    setPiyasaLiveHandle(handle);
    try {
      const db = await new Promise((resolve, reject) => {
        const req = indexedDB.open(PIYASA_HANDLE_DB, 1);
        req.onupgradeneeded = () => {
          if (!req.result.objectStoreNames.contains('handles')) req.result.createObjectStore('handles');
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      await new Promise((resolve, reject) => {
        const tx = db.transaction('handles', 'readwrite');
        const req = tx.objectStore('handles').put(handle, 'piyasa');
        req.onsuccess = () => resolve(true);
        req.onerror = () => reject(req.error);
      });
      return true;
    } catch (e) {
      return false;
    }
  }

  async function loadPiyasaHandle() {
    if (_piyasaLiveHandle && typeof _piyasaLiveHandle.getFile === 'function') return _piyasaLiveHandle;
    try {
      const db = await new Promise((resolve, reject) => {
        const req = indexedDB.open(PIYASA_HANDLE_DB, 1);
        req.onupgradeneeded = () => {
          if (!req.result.objectStoreNames.contains('handles')) req.result.createObjectStore('handles');
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      const handle = await new Promise((resolve, reject) => {
        const tx = db.transaction('handles', 'readonly');
        const req = tx.objectStore('handles').get('piyasa');
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
      });
      if (handle && typeof handle.getFile === 'function') {
        setPiyasaLiveHandle(handle);
        return handle;
      }
    } catch (e) {}
    return null;
  }

  async function clearPiyasaHandle() {
    _piyasaLiveHandle = null;
    try {
      const db = await new Promise((resolve, reject) => {
        const req = indexedDB.open(PIYASA_HANDLE_DB, 1);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      if (!db.objectStoreNames.contains('handles')) return;
      await new Promise((resolve, reject) => {
        const tx = db.transaction('handles', 'readwrite');
        const req = tx.objectStore('handles').delete('piyasa');
        req.onsuccess = () => resolve(true);
        req.onerror = () => reject(req.error);
      });
    } catch (e) {}
  }

  function snapshotPiyasaKeep() {
    const map = new Map();
    const add = (o, week, sheet) => {
      if (!o || o.__idx == null) return;
      const key = o.__archiveKey || `${week ?? ''}:${sheet ?? ''}:${o.__idx}`;
      map.set(key, {
        sipNo: String(o.sipNo || '').trim(),
        aciklama: String(o.aciklama || '').trim(),
        usedAt: o.usedAt || null,
        usedPlate: o.usedPlate || null,
        printCount: o.printCount || 0,
        lastPrintAt: o.lastPrintAt || null,
        lastPrintPlate: o.lastPrintPlate || null,
        printPlates: o.printPlates || {},
      });
    };
    for (const o of state.orders || []) add(o, state.week, state.sheet);
    for (const block of state.weekArchive || []) {
      for (const o of block.orders || []) add(o, block.week, block.sheet);
    }
    return map;
  }

  function restorePiyasaKeep(map) {
    if (!map || !map.size) return;
    const apply = (o, week, sheet) => {
      if (!o) return;
      const key = o.__archiveKey || `${week ?? ''}:${sheet ?? ''}:${o.__idx}`;
      const prev = map.get(key);
      if (!prev) return;
      if (!String(o.sipNo || '').trim() && prev.sipNo) o.sipNo = prev.sipNo;
      if (!String(o.aciklama || '').trim() && prev.aciklama) o.aciklama = prev.aciklama;
      if (typeof mergeOrderPersistedFields === 'function') mergeOrderPersistedFields(o, prev);
    };
    for (const o of state.orders || []) apply(o, state.week, state.sheet);
    for (const block of state.weekArchive || []) {
      for (const o of block.orders || []) apply(o, block.week, block.sheet);
    }
  }

  async function pickPiyasaExcelViaPicker() {
    if (typeof window.showOpenFilePicker !== 'function') return { unsupported: true };
    try {
      const handles = await window.showOpenFilePicker({
        types: [{
          description: 'Excel',
          accept: {
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
            'application/vnd.ms-excel': ['.xls'],
            'application/vnd.ms-excel.sheet.macroEnabled.12': ['.xlsm'],
          },
        }],
        multiple: false,
      });
      const handle = handles && handles[0];
      if (!handle) return { cancelled: true };
      await persistPiyasaHandle(handle);
      const file = await handle.getFile();
      return { file };
    } catch (e) {
      if (e && e.name === 'AbortError') return { cancelled: true };
      return { unsupported: true };
    }
  }

  function pickPiyasaExcelViaInput(asRefresh) {
    const inp = ensureHiddenFileInput('piyasaExcelInputHidden');
    inp.onchange = () => {
      const f = inp.files && inp.files[0];
      inp.value = '';
      if (!f) return;
      loadPiyasaExcel(f, asRefresh ? { refresh: true } : undefined);
    };
    try { inp.showPicker ? inp.showPicker() : inp.click(); } catch (e) { inp.click(); }
  }

  function startPiyasaUpload() {
    if (!clientIsAmir()) return;
    pickPiyasaExcelViaPicker().then((picked) => {
      if (picked && picked.file) {
        loadPiyasaExcel(picked.file);
        return;
      }
      if (picked && picked.cancelled) return;
      pickPiyasaExcelViaInput();
    }).catch(() => pickPiyasaExcelViaInput());
  }

  function piyasaExcelFilePath(file) {
    try {
      if (file && typeof file.path === 'string' && file.path.length > 1) return file.path;
    } catch (e) {}
    return '';
  }

  async function rememberPiyasaExcelSource(file) {
    const fileName = String(file && file.name || '').trim();
    if (!fileName) return;
    try {
      await fetch('/api/piyasa-excel/source', {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName,
          filePath: piyasaExcelFilePath(file),
          sheetName: state.sheet || '',
        }),
      });
    } catch (e) {}
  }

  async function fileFromPiyasaBackend() {
    const sessionName = window.__piyasaWorkbookSession && window.__piyasaWorkbookSession.fileName;
    let res;
    try {
      res = await fetch('/api/piyasa-excel/reread', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName: sessionName || '',
          sheetName: state.sheet || '',
        }),
      });
    } catch (e) {
      return null;
    }
    if (!res.ok) return null;
    const blob = await res.blob();
    let name = sessionName || 'piyasa.xlsx';
    try {
      const headerName = res.headers.get('X-Piyasa-Excel-File-Name');
      if (headerName) name = decodeURIComponent(headerName);
    } catch (e) {}
    return new File([blob], name, {
      type: blob.type || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
  }

  async function refreshPiyasaExcel(permPromise) {
    if (!clientIsAmir() || _piyasaRefreshBusy) return;
    if (!state.orders || !state.orders.length) {
      alert('Önce Piyasa Excel yükleyin.');
      return;
    }
    _piyasaRefreshBusy = true;
    const btn = document.getElementById('excelPiyasaRefreshButtonChip');
    if (btn) {
      btn.disabled = true;
      btn.classList.add('is-busy');
    }
    try {
      let file = null;
      const handle = _piyasaLiveHandle || await loadPiyasaHandle();
      if (handle && typeof handle.getFile === 'function') {
        try {
          if (permPromise && typeof permPromise.then === 'function') {
            const perm = await permPromise;
            if (perm === 'granted') file = await handle.getFile();
          } else if (typeof handle.requestPermission === 'function') {
            const perm = await handle.requestPermission({ mode: 'read' });
            if (perm === 'granted') file = await handle.getFile();
          } else {
            file = await handle.getFile();
          }
        } catch (e) {
          file = null;
        }
      }
      if (!file) file = await fileFromPiyasaBackend();
      if (!file) {
        const picked = await pickPiyasaExcelViaPicker();
        if (picked && picked.cancelled) return;
        if (picked && picked.file) file = picked.file;
      }
      if (!file) {
        pickPiyasaExcelViaInput(true);
        return;
      }
      await loadPiyasaExcel(file, { refresh: true });
    } catch (e) {
      console.error('Piyasa güncelle failed', e);
      alert('Piyasa Excel güncellenemedi. Dosyayı tekrar seçin.');
    } finally {
      _piyasaRefreshBusy = false;
      if (btn) {
        btn.disabled = false;
        btn.classList.remove('is-busy');
      }
    }
  }

  async function loadPiyasaExcel(file, opts){
    const refreshing = !!(opts && opts.refresh);
    if (!clientIsAmir()) return;
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
      if (!refreshing && fp && state.fileFingerprint === fp && state.orders && state.orders.length) {
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
      window.__piyasaWorkbookSession = {
        arrayBuffer: ab,
        fileName: String(file.name || 'piyasa.xlsx'),
        workbook: wb,
      };
      rememberPiyasaExcelSource(file);

      if (refreshing && state.sheet && wb.Sheets[state.sheet]) {
        const kept = snapshotPiyasaKeep();
        applyChosenPiyasaSheet(wb, state.sheet);
        restorePiyasaKeep(kept);
        if (state.orders && state.orders.length) saveState();
        scheduleWeekArchiveBuild(wb);
        refreshPiyasaHeaderUi();
        hidePiyasaExcelLoading();
        toast('Piyasa Excel güncellendi.', 'success');
        return;
      }

      const metas = recentPiyasaSheetMetas(getSheetMetaForPicker(wb));
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
    clearPiyasaHandle().catch(() => {});
    fetch('/api/piyasa-excel/source', { method: 'DELETE', credentials: 'include' }).catch(() => {});
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
    if (!clientIsAmir()) return;
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
        startPiyasaUpload();
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
        const target = e.target.closest('#piyasaExcelUploadButtonTop, #piyasaExcelClearButtonTop, #excelPiyasaRefreshButtonChip');
        if (!target) return;
        if (target.id === 'piyasaExcelUploadButtonTop'){
          e.preventDefault();
          e.stopPropagation();
          try { window.closeAppToolsMenu && window.closeAppToolsMenu(); } catch (err) {}
          startPiyasaUpload();
          return;
        }
        if (target.id === 'excelPiyasaRefreshButtonChip') {
          e.preventDefault();
          e.stopPropagation();
          if (!clientIsAmir() || _piyasaRefreshBusy) return;
          const handle = _piyasaLiveHandle;
          let permPromise = null;
          if (handle && typeof handle.requestPermission === 'function') {
            try { permPromise = handle.requestPermission({ mode: 'read' }); } catch (err) {}
          }
          refreshPiyasaExcel(permPromise);
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
    if (!(await loadStateFromServerFirst())) loadState();
    const onLoginScreen = !document.documentElement.classList.contains('logged-in');
    if (!onLoginScreen) {
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

    if (typeof loadExpectedArrivals === 'function') loadExpectedArrivals(false).catch(() => {});
    if (!clientIsAmir()) return;
    loadPiyasaHandle().catch(() => {});

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

