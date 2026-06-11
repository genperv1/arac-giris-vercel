// piyasa-excel.js — Excel import, form doldurma
// Otomatik bölüm — scripts/modularize-remaining.js

  function applyPiyasaParseResult(rawRows, extra) {
    const parseMeta = (rawRows && rawRows.__parseMeta) || null;
    const norm = normalizeRows(rawRows, parseMeta);
    state.orders = norm.orders;
    state.lastSkippedRows = norm.skipped || [];
    state.lastImportReport = norm.report;
    if (extra && typeof extra === 'object') {
      if (extra.week != null) state.week = extra.week;
      if (extra.sheet != null) state.sheet = extra.sheet;
      if (extra.loadedAt != null) state.loadedAt = extra.loadedAt;
      if ('sheetDate' in extra) state.sheetDate = extra.sheetDate;
      if ('sheetDateRaw' in extra) state.sheetDateRaw = extra.sheetDateRaw;
    }
    refreshArchiveForCurrentSheet();
    const r = norm.report;
    if (r && (
      r.totalSkipped > 0
      || (r.hiddenRowsSkipped > 0)
      || r.visibilityApplied === false
      || (r.template && !r.template.ok)
    )) {
      showPiyasaImportReportModal(r);
    }
    return norm;
  }

  /** Sheet'te Excel'de görünen sipariş sayısı (gizli satırlar hariç). */
  function countOrdersInVisibleSheet(ws) {
    try {
      const rawRows = parseSheetSmart(ws);
      const norm = normalizeRows(rawRows, rawRows.__parseMeta);
      return (norm.orders || []).length;
    } catch (e) {
      return 0;
    }
  }

  function showPiyasaImportReportModal(report) {
    if (!report) return;
    const labels = (eu().SKIP_REASON_LABELS) || {};
    let lines = `<p><b>${report.accepted}</b> sipariş yüklendi. <b>${report.totalSkipped}</b> satır elendi.</p>`;
    if (report.hiddenRowsSkipped > 0) {
      lines += `<p style="color:#4338ca;font-size:12px;">👁 Excel'de gizli <b>${report.hiddenRowsSkipped}</b> satır atlandı (sheet'te görünenler yüklendi).</p>`;
    }
    if (report.visibilityApplied === false) {
      lines += `<p style="color:#b45309;">⚠️ Excel gizli satır bilgisi okunamadı — sheet'te gördüğünüzle birebir eşleşmeyebilir. Dosyayı yeniden kaydedip tekrar yükleyin.</p>`;
    }
    if (report.template && !report.template.ok) {
      lines += `<p style="color:#b45309;">⚠️ Şablon: eksik başlıklar — ${(report.template.missing || []).join(', ')}</p>`;
    }
    const reasons = report.byReason || {};
    lines += '<ul style="margin:8px 0;padding-left:18px;font-size:12px;">';
    for (const [k, n] of Object.entries(reasons)) {
      lines += `<li>${labels[k] || k}: <b>${n}</b></li>`;
    }
    lines += '</ul>';

    const skipped = report.skippedRows || state.lastSkippedRows || [];
    if (skipped.length) {
      const maxShow = 80;
      const slice = skipped.slice(0, maxShow);
      lines += `<div style="margin-top:10px;font-weight:700;font-size:12px;">Elenen satır detayı (Excel satır no)</div>`;
      lines += '<div style="max-height:220px;overflow:auto;margin-top:6px;border:1px solid #eee;border-radius:8px;">';
      lines += '<table style="width:100%;border-collapse:collapse;font-size:11px;">';
      lines += '<thead><tr style="background:#f6f6f6;"><th style="padding:6px;border:1px solid #eee;text-align:left;">Satır</th><th style="padding:6px;border:1px solid #eee;text-align:left;">Firma</th><th style="padding:6px;border:1px solid #eee;text-align:left;">Malzeme</th><th style="padding:6px;border:1px solid #eee;text-align:left;">Miktar</th><th style="padding:6px;border:1px solid #eee;text-align:left;">Açıklama</th><th style="padding:6px;border:1px solid #eee;text-align:left;">Neden</th></tr></thead><tbody>';
      for (const s of slice) {
        lines += `<tr>
          <td style="padding:5px;border:1px solid #eee;white-space:nowrap;">${escapeHtml(String(s.excelRow || s.rowIndex || ''))}</td>
          <td style="padding:5px;border:1px solid #eee;">${escapeHtml(String(s.firma || ''))}</td>
          <td style="padding:5px;border:1px solid #eee;">${escapeHtml(String(s.malzeme || ''))}</td>
          <td style="padding:5px;border:1px solid #eee;">${escapeHtml(String(s.miktar || ''))}</td>
          <td style="padding:5px;border:1px solid #eee;max-width:140px;overflow:hidden;text-overflow:ellipsis;" title="${escapeHtml(String(s.aciklama || ''))}">${escapeHtml(String(s.aciklama || ''))}</td>
          <td style="padding:5px;border:1px solid #eee;">${escapeHtml(labels[s.reason] || s.reason || '')}</td>
        </tr>`;
      }
      lines += '</tbody></table></div>';
      if (skipped.length > maxShow) {
        lines += `<p style="font-size:11px;color:#666;margin-top:6px;">… ve ${skipped.length - maxShow} satır daha</p>`;
      }
    }

    const overlay = document.createElement('div');
    overlay.style.cssText = piyasaOverlayStyle(PIYASA_Z_TOP);
    overlay.innerHTML = `
      <div style="background:#fff;border-radius:12px;max-width:720px;width:100%;max-height:90vh;overflow:auto;padding:16px;box-shadow:0 10px 30px rgba(0,0,0,.2);">
        <div style="font-weight:800;margin-bottom:8px;">Piyasa yükleme özeti</div>
        <div id="piyImportReportBody">${lines}</div>
        <button type="button" id="piyImportReportOk" style="margin-top:12px;width:100%;padding:10px;border:0;border-radius:8px;background:#111827;color:#fff;font-weight:700;cursor:pointer;">Tamam</button>
      </div>`;
    markPiyasaModalLayer(overlay);
    document.body.appendChild(overlay);
    const closeReport = () => overlay.remove();
    overlay.querySelector('#piyImportReportOk').onclick = closeReport;
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeReport(); });
    bindPiyasaOverlayEsc(overlay, closeReport);
  }

  function showPiyasaSkippedRowsModal() {
    const skipped = state.lastSkippedRows || (state.lastImportReport && state.lastImportReport.skippedRows) || [];
    if (!skipped.length) {
      toast('Elenen satır kaydı yok.', 'info');
      return;
    }
    showPiyasaImportReportModal({
      accepted: (state.orders || []).length,
      totalSkipped: skipped.length,
      byReason: eu().summarizeSkipped ? eu().summarizeSkipped(skipped) : {},
      skippedRows: skipped,
      template: null,
    });
  }

  function getSheetMetaForPicker(wb){
    const metas = [];
    const names = wb.SheetNames || [];
    for (let i = 0; i < names.length; i++){
      const name = names[i];
      if (isPiyasaAutoDataSheet(name)) continue;
      const week = getWeekFromSheetName(name, wb);
      if (!week) continue;

      let orderCount = 0;
      let approx = false;
      try {
        const ws = wb.Sheets[name];
        if (ws) {
          orderCount = countOrdersInVisibleSheet(ws);
        }
      } catch (e) {
        orderCount = 0;
        approx = true;
      }

      metas.push({ name, week, count: orderCount, approx, orderIndex: i });
    }
    return metas;
  }

  function getWeekFromDate(dt){
    try{
      const d = new Date(Date.UTC(dt.getFullYear(), dt.getMonth(), dt.getDate()));
      const dayNum = d.getUTCDay() || 7;
      d.setUTCDate(d.getUTCDate() + 4 - dayNum);
      const yearStart = new Date(Date.UTC(d.getUTCFullYear(),0,1));
      const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1)/7);
      return weekNo;
    }catch(e){ return null; }
  }

  // Given an ISO week number and a year, return a Date representing
  // the Monday of that ISO week (UTC midnight). Returns null on error.
  function getDateFromWeekYear(week, year){
    try{
      week = parseInt(week, 10);
      year = parseInt(year, 10);
      if (!Number.isFinite(week) || !Number.isFinite(year)) return null;
      // ISO week: week 1 is the week with Jan 4th. Find the Monday of week 1, then add (week-1)*7 days.
      const jan4 = new Date(Date.UTC(year, 0, 4));
      const day = jan4.getUTCDay() || 7; // 1..7 (Mon..Sun)
      const mondayOfWeek1 = new Date(Date.UTC(year, 0, 4 - (day - 1)));
      const result = new Date(mondayOfWeek1.getTime() + (week - 1) * 7 * 86400000);
      return result;
    }catch(e){ return null; }
  }

  function parseDateFromCell(cell){
    cell = coerceXlsxCell(cell);
    if (!cell) return null;
    try{
      // Excel date type
      if (cell.t === 'd' && cell.v) return new Date(cell.v);
      // Excel serial number
      if (cell.t === 'n' && typeof cell.v === 'number'){
        return excelSerialToDate(cell.v);
      }
      const s = String(cell.v ?? cell.w ?? '').trim();
      if (!s) return null;
      const serial = parseExcelSerialString(s);
      if (serial) return serial;
      // Try native parse first (ISO etc.)
      const parsed = Date.parse(s);
      if (!Number.isNaN(parsed)) return new Date(parsed);
      // Try dd.mm.yyyy or dd-mm-yyyy or dd/mm/yyyy
      const m = s.match(/^(\d{1,2})[\.\-\/](\d{1,2})[\.\-\/](\d{2,4})$/);
      if (m){
        let day = parseInt(m[1],10);
        let month = parseInt(m[2],10) - 1;
        let year = parseInt(m[3],10);
        if (year < 100) year += 2000;
        return new Date(year, month, day);
      }
      // Fallback: replace dots/dashes with slashes and try parse again
      const alt = s.replace(/\./g,'/').replace(/\-/g,'/');
      const parsed2 = Date.parse(alt);
      if (!Number.isNaN(parsed2)) return new Date(parsed2);
    }catch(e){}
    return null;
  }

  function looksLikeExcelSerial(value){
    const s = String(value ?? '').trim();
    if (!/^\d{4,5}(\.0+)?$/.test(s)) return false;
    const n = parseFloat(s);
    return Number.isFinite(n) && n >= 20000 && n <= 120000;
  }

  function parseExcelSerialString(s){
    if (!looksLikeExcelSerial(s)) return null;
    return excelSerialToDate(parseFloat(s));
  }

  function excelSerialToDate(serial){
    if (!Number.isFinite(serial)) return null;
    return new Date(Math.round((serial - 25569) * 86400 * 1000));
  }

  function coerceXlsxCell(cell){
    if (cell == null || cell === '') return null;
    if (typeof cell === 'object' && ('t' in cell || 'v' in cell || 'w' in cell)) return cell;
    if (typeof cell === 'number') return { t: 'n', v: cell };
    if (typeof cell === 'string') {
      const trimmed = cell.trim();
      if (looksLikeExcelSerial(trimmed)) return { t: 'n', v: parseFloat(trimmed) };
      return { t: 's', v: trimmed, w: trimmed };
    }
    return { t: 's', v: String(cell), w: String(cell) };
  }

  function formatParsedSheetDate(date, raw){
    if (date) {
      const rawStr = String(raw ?? '').trim();
      if (!rawStr || looksLikeExcelSerial(rawStr)) return formatDateUTCAsLocalString(date);
      return rawStr;
    }
    const serial = parseExcelSerialString(raw);
    if (serial) return formatDateUTCAsLocalString(serial);
    return String(raw ?? '').trim();
  }

  function getCell(ws, ref){
    if (!ws || !ref) return null;
    let cell = null;
    // Object-style sheet (common)
    if (!Array.isArray(ws)){
      cell = ws[ref] || ws[ref.toLowerCase()] || null;
    } else {
      // Dense-style sheet: array of rows — ref like 'G1'
      const m = String(ref).toUpperCase().match(/^([A-Z]+)(\d+)$/);
      if (!m) return null;
      const colLetters = m[1];
      const rowNum = parseInt(m[2], 10);
      let col = 0;
      for (let i = 0; i < colLetters.length; i++){
        col = col * 26 + (colLetters.charCodeAt(i) - 65 + 1);
      }
      const colIdx = col - 1;
      const rowIdx = rowNum - 1;
      if (!Array.isArray(ws[rowIdx])) return null;
      cell = ws[rowIdx][colIdx] || null;
    }
    return coerceXlsxCell(cell);
  }

  /** Excel G1 hücresindeki tarih (Piyasa sipariş listesi başlığı) */
  function readG1FromSheet(ws) {
    try {
      const c = getCell(ws, 'G1');
      if (!c) return { date: null, raw: null };
      const date = parseDateFromCell(c);
      let raw = String(c.w ?? '').trim();
      if (!raw && c.v != null && c.v !== '') raw = String(c.v).trim();
      raw = formatParsedSheetDate(date, raw) || null;
      return { date, raw };
    } catch (e) {
      return { date: null, raw: null };
    }
  }

  function findDateInSheet(ws){
    try{
      const checkRefs = ['G1','F1','E1','D1','C1','B1','A1'];
      for (const r of checkRefs){
        const c = getCell(ws, r);
        const d = parseDateFromCell(c);
        if (d) {
          const rawVal = (c && (c.w ?? c.v)) || null;
          return { date: d, raw: formatParsedSheetDate(d, rawVal), ref: r };
        }
      }
      // genişletilmiş tarama: ilk 3 satır, A..H sütunları
      const cols = ['A','B','C','D','E','F','G','H'];
      for (let row = 1; row <= 3; row++){
        for (const col of cols){
          const ref = `${col}${row}`;
          const c = getCell(ws, ref);
          const d = parseDateFromCell(c);
          if (d) {
            const rawVal = (c && (c.w ?? c.v)) || null;
            return { date: d, raw: formatParsedSheetDate(d, rawVal), ref };
          }
        }
      }
    }catch(e){}
    return null;
  }

  function buildWeekArchive(wb){
    const archive = [];
    const metas = getSheetMetaForPicker(wb);
    for (const m of metas) {
      try {
        const ws = wb.Sheets[m.name];
        if (!ws) continue;
        const rawRows = parseSheetSmart(ws);
        const norm = normalizeRows(rawRows, rawRows.__parseMeta);
        const g1 = readG1FromSheet(ws);
        const orders = (norm.orders || []).map((o) => ({
          ...o,
          _sourceWeek: m.week,
          _sourceSheet: m.name,
          __archiveKey: `${m.week}:${m.name}:${o.__idx}`,
        }));
        archive.push({
          week: m.week,
          sheet: m.name,
          orders,
          sheetDate: g1.date ? g1.date.toISOString() : null,
          sheetDateRaw: g1.raw,
        });
      } catch (e) {
        console.warn('Piyasa week archive failed for', m.name, e);
      }
    }
    return archive.sort((a, b) => (b.week - a.week) || String(b.sheet).localeCompare(String(a.sheet)));
  }

  function scheduleWeekArchiveBuild(wb) {
    const run = () => {
      try {
        const persisted = buildPersistedOrderLookup();
        const archive = buildWeekArchive(wb);
        restorePersistedFieldsOnArchive(archive, persisted);
        state.weekArchive = archive;
        refreshArchiveForCurrentSheet();
        if (state.orders && state.orders.length) saveState();
      } catch (e) {
        console.warn('Piyasa week archive build failed', e);
        state.weekArchive = [];
      }
    };
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(run, { timeout: 4000 });
    } else {
      setTimeout(run, 100);
    }
  }

  function applyChosenPiyasaSheet(wb, sheetName, weekHint, foundDate) {
    const ws = wb.Sheets[sheetName];
    if (!ws) throw new Error('Sheet not found: ' + sheetName);
    const rawRows = parseSheetSmart(ws);
    const g1 = readG1FromSheet(ws);
    const week =
      weekHint ||
      getWeekFromSheetName(sheetName, wb) ||
      (g1.date ? getWeekFromDate(g1.date) : null) ||
      (foundDate ? getWeekFromDate(foundDate) : null);
    applyPiyasaParseResult(rawRows, {
      week,
      sheet: sheetName,
      loadedAt: g1.date || foundDate || new Date(),
      sheetDate: g1.date ? g1.date.toISOString() : foundDate ? foundDate.toISOString() : null,
      sheetDateRaw: g1.raw,
    });
    if (state.orders && state.orders.length) saveState();
  }

  function openSheetPickerModal(metas, wb, onConfirm){
    const weeks = Array.from(new Set(metas.map(m=>m.week))).sort((a,b)=>a-b);
    const defaultWeek = weeks[0] ?? null;

    const overlay = document.createElement('div');
    overlay.style.cssText = piyasaOverlayStyle(PIYASA_Z_LAYER);
    markPiyasaModalLayer(overlay);
    overlay.innerHTML = `
      <div style="position:relative;z-index:1;background:#fff;border-radius:14px;max-width:780px;width:100%;max-height:82vh;overflow:hidden;box-shadow:0 10px 30px rgba(0,0,0,.25);display:flex;flex-direction:column;">
        <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 14px;border-bottom:1px solid #eee;gap:12px;">
          <div style="font-weight:900;">PİYASA Excel • Kitap Seç</div>
          <button id="piyasaSheetModalClose" style="border:0;background:#eee;border-radius:10px;padding:6px 10px;cursor:pointer;">Kapat</button>
        </div>
        <div style="padding:10px 14px;display:flex;gap:10px;align-items:center;border-bottom:1px solid #eee;flex-wrap:wrap;">
          <label style="font-size:12px;color:#666;">Hafta:</label>
          <select id="piyasaSheetWeek" style="padding:8px;border:1px solid #ddd;border-radius:10px;min-width:140px;"></select>
          <input id="piyasaSheetSearch" placeholder="Kitap adı ara..." style="flex:1;min-width:220px;padding:10px;border:1px solid #ddd;border-radius:10px;">
          <div style="font-size:12px;color:#666;min-width:120px;text-align:right;" id="piyasaSheetCount"></div>
        </div>
        <div style="padding:0 14px 14px;overflow:auto;flex:1;">
          <table style="width:100%;border-collapse:collapse;font-size:13px;">
            <thead>
              <tr style="background:#f6f6f6;position:sticky;top:0;z-index:1;">
                <th style="text-align:left;padding:8px;border:1px solid #eee;">Seç</th>
                <th style="text-align:left;padding:8px;border:1px solid #eee;">KİTAP (SHEET)</th>
                <th style="text-align:left;padding:8px;border:1px solid #eee;">HAFTA</th>
                <th style="text-align:left;padding:8px;border:1px solid #eee;">SİPARİŞ</th>
                <th style="text-align:left;padding:8px;border:1px solid #eee;">SIRA</th>
              </tr>
            </thead>
            <tbody id="piyasaSheetTbody"></tbody>
          </table>
        </div>
        <div style="display:flex;justify-content:flex-end;gap:10px;padding:12px 14px;border-top:1px solid #eee;">
          <button id="piyasaSheetCancel" style="border:0;background:#eee;border-radius:10px;padding:10px 12px;cursor:pointer;">İptal</button>
          <button id="piyasaSheetOk" disabled style="border:0;background:#111827;color:#fff;border-radius:10px;padding:10px 12px;cursor:pointer;opacity:.6;">Tamam</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const close = ()=> overlay.remove();
    overlay.querySelector('#piyasaSheetModalClose').onclick = close;
    overlay.querySelector('#piyasaSheetCancel').onclick = close;
    overlay.onclick = (e)=>{ if(e.target===overlay) close(); };

    const weekSel = overlay.querySelector('#piyasaSheetWeek');
    const searchEl = overlay.querySelector('#piyasaSheetSearch');
    const tbody = overlay.querySelector('#piyasaSheetTbody');
    const countEl = overlay.querySelector('#piyasaSheetCount');
    const okBtn = overlay.querySelector('#piyasaSheetOk');

    weeks.forEach(w=>{
      const opt = document.createElement('option');
      opt.value = String(w);
      opt.textContent = `${w}. HAFTA`;
      weekSel.appendChild(opt);
    });
    if (defaultWeek !== null) weekSel.value = String(defaultWeek);

    // Varsayılan sheet: o haftada parantezsiz "X.HAFTA" varsa o, yoksa en sağdaki (orderIndex en büyük)
    function defaultPickForWeek(w){
      const list = metas.filter(m=>m.week===w);
      const exactName = `${w}.HAFTA`;
      const exact = list.find(m => String(m.name||'').trim().toUpperCase() === exactName);
      if (exact) return exact.name;
      let best = list[0]?.name || '';
      let bestIdx = -1;
      for (const m of list){
        if (m.orderIndex > bestIdx){ bestIdx = m.orderIndex; best = m.name; }
      }
      return best;
    }

    let selectedName = '';
    function setSelected(name){
      selectedName = name || '';
      okBtn.disabled = !selectedName;
      okBtn.style.opacity = selectedName ? '1' : '.6';
      // radio işaretlerini güncelle
      tbody.querySelectorAll('input[type="radio"]').forEach(r=>{
        r.checked = (r.value === selectedName);
      });
    }

    function render(){
      const w = parseInt(weekSel.value, 10);
      const q = String(searchEl.value||'').trim().toLowerCase();
      let list = metas.filter(m=>m.week===w);
      if (q) list = list.filter(m => String(m.name||'').toLowerCase().includes(q));
      // Önce sipariş sayısına göre, eşitse en sağdaki önce
      list.sort((a,b)=> (b.count - a.count) || (b.orderIndex - a.orderIndex));
      countEl.textContent = `${list.length} kitap`;
      tbody.innerHTML = list.map(m=>`
        <tr>
          <td style="padding:8px;border:1px solid #eee;">
            <input type="radio" name="piyasaSheetRadio" value="${escapeHtml(m.name)}" style="transform:scale(1.1);">
          </td>
          <td style="padding:8px;border:1px solid #eee;">${escapeHtml(m.name)}</td>
          <td style="padding:8px;border:1px solid #eee;">${m.week}. hafta</td>
          <td style="padding:8px;border:1px solid #eee;">${m.approx ? ('~' + m.count) : m.count}</td>
          <td style="padding:8px;border:1px solid #eee;">${m.orderIndex+1}</td>
        </tr>
      `).join('');

      // olaylar
      tbody.querySelectorAll('tr').forEach(tr=>{
        tr.style.cursor = 'pointer';
        tr.onclick = ()=>{
          const radio = tr.querySelector('input[type="radio"]');
          if (radio){
            radio.checked = true;
            setSelected(radio.value);
          }
        };
      });

      // eğer bu hafta için seçili sheet yoksa default seç
      if (!selectedName || !list.find(x=>x.name===selectedName)){
        const def = defaultPickForWeek(w);
        setSelected(def);
      }
    }

    weekSel.onchange = ()=>{ selectedName=''; render(); };
    searchEl.oninput = ()=> render();

    okBtn.onclick = ()=>{
      if (!selectedName) return;
      const w = parseInt(weekSel.value, 10);
      const chosen = metas.find(m=>m.name===selectedName);
      if (!chosen){
        alert('❌ Seçilen kitap bulunamadı.');
        return;
      }
      // try to read a date from the chosen sheet (e.g. G1)
      let foundDate = null;
      try{
        if (wb && wb.SheetNames && wb.SheetNames.includes(chosen.name)){
          const ws = wb.Sheets[chosen.name];
          const f = findDateInSheet(ws);
          if (f && f.date) foundDate = f.date;
        }
      }catch(e){}
      close();
      onConfirm({ sheetName: chosen.name, week: w, foundDate });
    };

    render();
    setTimeout(()=> searchEl.focus(), 0);
  }

  /** Boş ağırlık sistemi devre dışı */
  function promptAracBosuTonaj() { return Promise.resolve(null); }
  function applyAracBosuToForm() {}
  async function maybePromptAracBosuBeforePrint() {}
  function isHpFirma() { return false; }

  function applyOrderFromPicker(o) {
    const canon = resolveCanonicalOrder(o) || o;
    const plate = (document.getElementById('cekiciPlaka') || {}).value || '';
    applyOrderToForm(canon, { forceReuse: true });
    markOrderUsed(canon, plate);
  }

  function showPiyasaSuggestionBar(suggestions, ctx) {
    const old = document.getElementById('piyasaSuggestionBar');
    if (old) old.remove();
    if (!suggestions || !suggestions.length) return;

    const bar = document.createElement('div');
    bar.id = 'piyasaSuggestionBar';
    bar.style.cssText = 'margin:8px 0;padding:10px 12px;background:#f5f3ff;border:1px solid #c7d2fe;border-radius:10px;font-size:12px;';
    let html = '<div style="font-weight:700;color:#4338ca;margin-bottom:6px;">🧾 Piyasa sipariş önerisi</div><div style="display:flex;flex-wrap:wrap;gap:6px;">';
    suggestions.forEach(({ order, score }, i) => {
      const label = [order.firma, order.malzeme, order.il || order.sevkYeri].filter(Boolean).join(' · ');
      html += `<button type="button" data-piy-sug="${i}" style="padding:6px 10px;border:1px solid #a5b4fc;border-radius:8px;background:#fff;cursor:pointer;font-size:11px;">${escapeHtml(label)} <span style="color:#6366f1;">(${score})</span></button>`;
    });
    html += '</div>';
    bar.innerHTML = html;
    const anchor = document.getElementById('firmaKodu')?.closest('.bg-white') || document.getElementById('mainApp');
    if (anchor && anchor.firstChild) anchor.insertBefore(bar, anchor.firstChild);
    else document.body.appendChild(bar);

    bar.querySelectorAll('[data-piy-sug]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const idx = parseInt(btn.getAttribute('data-piy-sug'), 10);
        const item = suggestions[idx];
        if (!item || !item.order) return;
        if (item.order.usedAt || getOrderPrintCount(item.order) > 0) {
          const ok = await confirmReuseOrder(item.order);
          if (!ok) return;
        }
        applyOrderToForm(item.order, { forceReuse: true });
        markOrderUsed(item.order, ctx.plate || '');
        bar.remove();
      });
    });
  }

  function suggestPiyasaForContext(ctx) {
    if (!state.orders || !state.orders.length || !eu().suggestPiyasaOrders) return [];
    return eu().suggestPiyasaOrders(state.orders, ctx || {}, 3);
  }

  async function confirmReuseOrder(o) {
    if (!o || (!o.usedAt && getOrderPrintCount(o) <= 0)) return true;
    const ui = window.rpUi || {};
    const when = o.usedAt ? new Date(o.usedAt).toLocaleString('tr-TR') : '';
    const plate = o.usedPlate ? ` (${o.usedPlate})` : '';
    const pc = getOrderPrintCount(o);
    let printInfo = '';
    if (pc > 0) {
      const whenPrint = formatOrderPrintWhen(o.lastPrintAt);
      const plates = formatPrintPlatesSummary(o.printPlates, 5);
      printInfo = `\n\n🖨️ ${pc} kez yazdırıldı`;
      if (o.lastPrintPlate) printInfo += ` (son plaka: ${o.lastPrintPlate})`;
      if (whenPrint) printInfo += `\nSon yazdırma: ${whenPrint}`;
      if (plates) printInfo += `\nPlakalar: ${plates}`;
    } else if (o.usedAt) {
      printInfo = '\n\n(Henüz yazdırılmadı)';
    }
    const usedLine = when
      ? `Bu sipariş daha önce kullanıldı${plate} — ${when}${printInfo}\n\nYine de seçilsin mi?`
      : `Bu sipariş daha önce yazdırıldı.${printInfo}\n\nYine de seçilsin mi?`;
    if (typeof ui.confirm === 'function') {
      return ui.confirm(usedLine, { okLabel: 'Seç' });
    }
    return confirm(usedLine);
  }

  function markOrderUsed(o, plate) {
    const canon = resolveCanonicalOrder(o);
    if (!canon) return;
    const pickKey = getOrderPickKey(canon);
    const patch = {
      usedAt: Date.now(),
      usedPlate: String(plate || '').trim(),
    };
    forEachMatchingOrder(pickKey, (hit) => {
      hit.usedAt = patch.usedAt;
      hit.usedPlate = patch.usedPlate;
    });
    state._lastAppliedOrder = resolveCanonicalOrder(canon) || canon;
    refreshArchiveForCurrentSheet();
    try { saveState(); } catch (e) {}
  }

  function applyOrderToForm(o, opts){
    window.__piyasaApplyingOrder = true;
    applyAracBosuToForm(null);

    const firmaKodu = document.getElementById('firmaKodu');
    const firmaSelect = document.getElementById('firmaSelect');
    const malzeme = document.getElementById('malzeme');
    const malzemeSelect = document.getElementById('malzemeSelect');
    const ambalaj = document.getElementById('ambalajBilgisi');
    const notu = document.getElementById('yuklemeNotu');
    const sevk = document.getElementById('sevkYeri');
    const tonaj = document.getElementById('tonaj');
    const seperator = document.getElementById('seperatorBilgisi');

    const writeOrderValues = () => {
      if (firmaKodu) firmaKodu.value = firmaVal;
      if (malzeme) {
        const rawMal = o.malzeme || '';
        malzeme.value = typeof window.formatMalzemeForPrint === 'function'
          ? window.formatMalzemeForPrint(rawMal) || rawMal
          : rawMal;
        if (typeof window.fitMalzemeInput === 'function') {
          try { window.fitMalzemeInput(malzeme); } catch (e) {}
        }
      }
      if (malzemeSelect) {
        const target = (o.malzeme || '').trim();
        const opt = Array.from(malzemeSelect.options || []).find(x => (x.value||'').trim() === target);
        malzemeSelect.value = opt ? opt.value : '';
      }
      if (ambalaj) ambalaj.value = o.yuklemeTuru || '';
      if (notu) notu.value = o.aciklama || '';
      if (sevk) sevk.value = o.sevkYeri || o.il || '';
      if (tonaj) tonaj.value = o.miktar != null && o.miktar !== '' ? String(o.miktar) : '';
    };

    // Değerleri bas
    // Firma/Müşteri Kodu: hem input'u doldur hem de select içinde eşleşen varsa seç.
    const firmaVal = (o.firma || '').trim();
    if (firmaKodu) firmaKodu.value = firmaVal;
    let firmaOptMatched = false;
    if (firmaSelect) {
      const opt = Array.from(firmaSelect.options || []).find(x => (x.value||'').trim() === firmaVal);
      if (opt) {
        firmaSelect.value = opt.value;
        firmaOptMatched = true;
      }
    }
    writeOrderValues();
    
    // SEPERATÖR BİLGİSİ: ÖDEME TÜRÜ ve ORG bilgilerini ayrı ayrı belirterek yaz
    if (seperator) {
      const odemeTuru = (o.odemeTuru || '').trim();
      const org = (o.org || '').trim();
      if (odemeTuru && org) {
        seperator.value = `ÖDEME TÜRÜ: ${odemeTuru} ORG: ${org}`;
      } else if (odemeTuru) {
        seperator.value = `ÖDEME TÜRÜ: ${odemeTuru}`;
      } else if (org) {
        seperator.value = `ORG: ${org}`;
      }
      
      // Focus olduğunda genişle, blur olduğunda küçül
      seperator.onfocus = function() { 
        this.style.width = '300px'; 
        this.style.transition = 'all 0.3s ease';
      };
      seperator.onblur = function() { 
        this.style.width = '100px'; 
        this.style.transition = 'all 0.3s ease';
      };
    }

    // Listener'ları tetikle
    const els = [firmaKodu, malzeme, malzemeSelect, ambalaj, notu, sevk, tonaj, seperator];
    if (firmaOptMatched) els.unshift(firmaSelect);
    els.forEach(el=>{
      if (!el) return;
      try {
        el.dispatchEvent(new Event('input', { bubbles:true }));
        el.dispatchEvent(new Event('change', { bubbles:true }));
      } catch(_) {}
    });

    // Bazı akışlarda select change input'u temizleyebiliyor; en son tekrar basıyoruz.
    writeOrderValues();
    
    // SEPERATÖR BİLGİSİ: ÖDEME TÜRÜ ve ORG bilgilerini ayrı ayrı belirterek yaz (ikinci kez)
    if (seperator) {
      const odemeTuru = (o.odemeTuru || '').trim();
      const org = (o.org || '').trim();
      if (odemeTuru && org) {
        seperator.value = `ÖDEME TÜRÜ: ${odemeTuru} ORG: ${org}`;
      } else if (odemeTuru) {
        seperator.value = `ÖDEME TÜRÜ: ${odemeTuru}`;
      } else if (org) {
        seperator.value = `ORG: ${org}`;
      }
      
      // Focus olduğunda genişle, blur olduğunda küçül (ikinci kez)
      seperator.onfocus = function() { 
        this.style.width = '300px'; 
        this.style.transform = 'translateY(-5px) translateX(10px)'; // Yukarı ve sağa kaydır
        this.style.transition = 'all 0.3s ease';
      };
      seperator.onblur = function() { 
        this.style.width = '100px'; 
        this.style.transform = 'translateY(0) translateX(0)'; // Orijinal pozisyon
        this.style.transition = 'all 0.3s ease';
      };
    }

    // Takip formundaki eşleştirme listener'ları alanı geri boşaltırsa tekrar bas.
    setTimeout(writeOrderValues, 0);
    setTimeout(writeOrderValues, 40);
    setTimeout(() => { window.__piyasaApplyingOrder = false; }, 80);
  }

