// piyasa-orders.js — sipariş eşleştirme, Excel satır parse
// Otomatik bölüm — scripts/modularize-remaining.js

  function findOrderForPrint(opts) {
    const orderIdx = opts?.orderIdx;
    if (orderIdx != null) {
      const byKey = getOrderByIdx(orderIdx);
      if (byKey) return byKey;
    }
    const last = state._lastAppliedOrder;
    if (last) return last;
    const firma = String(opts?.firma || '').trim();
    const malzeme = String(opts?.malzeme || '').trim();
    if (firma && malzeme) {
      return (state.orders || []).find((o) =>
        String(o.firma || '').trim() === firma && String(o.malzeme || '').trim() === malzeme
      ) || null;
    }
    return null;
  }

  function recordOrderPrint(opts) {
    if (isDurumFrozen()) return false;
    const order = findOrderForPrint(opts || {});
    if (!order) return false;

    const plate = String(opts?.plate || '').trim().toUpperCase();
    const ts = Number(opts?.ts) || Date.now();
    const pickKey = getOrderPickKey(order);
    const nextCount = getOrderPrintCount(order) + 1;
    const nextPlates = { ..._normalizePrintPlates(order.printPlates) };
    if (plate) nextPlates[plate] = (parseInt(nextPlates[plate], 10) || 0) + 1;
    const plateKeys = Object.keys(nextPlates);
    if (plateKeys.length > 8) {
      plateKeys.sort((a, b) => nextPlates[b] - nextPlates[a]);
      const trimmed = {};
      plateKeys.slice(0, 8).forEach((k) => { trimmed[k] = nextPlates[k]; });
      Object.keys(nextPlates).forEach((k) => { delete nextPlates[k]; });
      Object.assign(nextPlates, trimmed);
    }

    const patch = {
      printCount: nextCount,
      lastPrintAt: ts,
      lastPrintPlate: plate || order.lastPrintPlate || null,
      printPlates: nextPlates,
    };
    forEachMatchingOrder(pickKey, (o) => {
      o.printCount = patch.printCount;
      o.lastPrintAt = patch.lastPrintAt;
      o.lastPrintPlate = patch.lastPrintPlate;
      o.printPlates = { ...patch.printPlates };
    });
    state._lastAppliedOrder = resolveCanonicalOrder(order) || order;

    try { saveState(); } catch (e) {}
    return true;
  }

  /** Siparişi benzersiz tanımla: hafta arşivinde aynı __idx çakışmasın */
  function getOrderPickKey(o) {
    if (!o) return null;
    return o._pickKey || o.__archiveKey || (o.__idx != null ? String(o.__idx) : null);
  }

  function orderKeyMatches(o, key) {
    if (o == null || key == null || key === '') return false;
    const k = String(key);
    const pick = getOrderPickKey(o);
    if (pick != null && String(pick) === k) return true;
    if (o.__archiveKey != null && String(o.__archiveKey) === k) return true;
    if (o._pickKey != null && String(o._pickKey) === k) return true;
    return String(o.__idx) === k;
  }

  function findOrderByPickKey(key, orders) {
    return (orders || []).find((x) => orderKeyMatches(x, key)) || null;
  }

  function resolveCanonicalOrder(o) {
    if (!o) return null;
    const key = getOrderPickKey(o);
    if (key != null) {
      const hit = getOrderByIdx(key);
      if (hit) return hit;
    }
    return o;
  }

  function forEachMatchingOrder(key, fn) {
    if (key == null || key === '' || typeof fn !== 'function') return;
    const k = String(key);
    const visit = (o) => { if (orderKeyMatches(o, k)) fn(o); };
    for (const o of state.orders || []) visit(o);
    for (const block of state.weekArchive || []) {
      for (const o of block.orders || []) visit(o);
    }
    if (state._lastAppliedOrder) visit(state._lastAppliedOrder);
  }

  function mergeOrderPersistedFields(target, source) {
    if (!target || !source) return;
    if (source.usedAt) target.usedAt = source.usedAt;
    if (source.usedPlate) target.usedPlate = source.usedPlate;
    const srcPc = parseInt(source.printCount, 10) || 0;
    const tgtPc = parseInt(target.printCount, 10) || 0;
    if (srcPc > tgtPc) target.printCount = srcPc;
    if (source.lastPrintAt && (!target.lastPrintAt || source.lastPrintAt >= target.lastPrintAt)) {
      target.lastPrintAt = source.lastPrintAt;
      if (source.lastPrintPlate) target.lastPrintPlate = source.lastPrintPlate;
    }
    if (source.printPlates && typeof source.printPlates === 'object') {
      target.printPlates = {
        ..._normalizePrintPlates(target.printPlates),
        ..._normalizePrintPlates(source.printPlates),
      };
    }
  }

  function buildPersistedOrderLookup() {
    const map = new Map();
    const add = (o, week, sheet) => {
      if (!o || o.__idx == null) return;
      const key = o.__archiveKey || `${week ?? ''}:${sheet ?? ''}:${o.__idx}`;
      const prev = map.get(key);
      if (!prev) map.set(key, o);
      else mergeOrderPersistedFields(prev, o);
    };
    for (const o of state.orders || []) add(o, state.week, state.sheet);
    for (const block of state.weekArchive || []) {
      for (const o of block.orders || []) add(o, block.week, block.sheet);
    }
    if (state._lastAppliedOrder) add(state._lastAppliedOrder, state.week, state.sheet);
    return map;
  }

  function restorePersistedFieldsOnArchive(archive, lookup) {
    if (!lookup || !lookup.size) return;
    for (const block of archive || []) {
      for (const o of block.orders || []) {
        const key = o.__archiveKey || `${block.week}:${block.sheet}:${o.__idx}`;
        const prev = lookup.get(key);
        if (prev) mergeOrderPersistedFields(o, prev);
      }
    }
    if (state.sheet && state.week != null) {
      for (const o of state.orders || []) {
        const key = o.__archiveKey || `${state.week}:${state.sheet}:${o.__idx}`;
        const arch = lookup.get(key);
        if (arch) mergeOrderPersistedFields(o, arch);
      }
    }
  }

  function getOrderByIdx(idx) {
    if (idx == null || idx === '') return null;
    const key = String(idx);

    const last = state._lastAppliedOrder;
    if (last && orderKeyMatches(last, key)) return last;

    let hit = findOrderByPickKey(key, state.orders);
    if (hit) return hit;
    for (const block of state.weekArchive || []) {
      hit = findOrderByPickKey(key, block.orders);
      if (hit) return hit;
    }

    const n = Number(idx);
    if (!Number.isFinite(n)) return null;

    if (last && last.__idx === n) return last;

    for (const block of state.weekArchive || []) {
      hit = (block.orders || []).find((x) => x.__idx === n);
      if (hit) return hit;
    }
    return (state.orders || []).find((x) => x.__idx === n) || null;
  }

  /** Rapor (print_history) silindikten sonra sipariş yazdırma rozetlerini yeniden hesapla */
  async function reconcileOrderPrintCountsFromReports() {
    const hasOrders = (state.orders || []).length > 0
      || (state.weekArchive || []).some((b) => (b.orders || []).length > 0);
    if (!hasOrders) return false;

    if (isDurumFrozen()) {
      const zeroAll = (order) => {
        order.printCount = 0;
        order.lastPrintAt = null;
        order.lastPrintPlate = null;
        order.printPlates = {};
      };
      for (const order of state.orders || []) zeroAll(order);
      for (const block of state.weekArchive || []) {
        for (const order of block.orders || []) zeroAll(order);
      }
      if (state._lastAppliedOrder) zeroAll(state._lastAppliedOrder);
      try { if (_pickerRenderHook) _pickerRenderHook(); } catch (e) {}
      return true;
    }

    let events = [];
    try {
      const r = await fetch('/api/reports?limit=10000&_=' + Date.now(), {
        method: 'GET',
        credentials: 'include',
        headers: { 'Cache-Control': 'no-store' },
      });
      if (!r.ok) return false;
      events = await r.json();
    } catch (e) {
      return false;
    }

    const statsByKey = new Map();
    for (const ev of events || []) {
      if (!ev || ev.type !== 'PRINT') continue;
      const d = ev.data || {};
      const firma = normFirmaKey(d.firma || d.firmaKodu || d.firmaSelect || ev.firma || '');
      const malzeme = String(d.malzeme || ev.malzeme || '').trim();
      if (!firma && !malzeme) continue;
      const key = orderPrintStatsKeyFromEvent(d, ev);
      let rec = statsByKey.get(key);
      if (!rec) {
        rec = { count: 0, plates: {}, lastTs: 0, lastPlate: '' };
        statsByKey.set(key, rec);
      }
      const ts = Number(ev.ts || d.ts || 0);
      if (!isDurumCountTs(ts)) continue;
      rec.count += 1;
      const plate = String(d.plaka || d.plate || '').trim().toUpperCase();
      if (plate) rec.plates[plate] = (parseInt(rec.plates[plate], 10) || 0) + 1;
      if (ts >= rec.lastTs) {
        rec.lastTs = ts;
        if (plate) rec.lastPlate = plate;
      }
    }

    function applyStats(order) {
      const rec = statsByKey.get(orderPrintStatsKeyFromOrder(order));
      if (!rec || rec.count <= 0) {
        order.printCount = 0;
        order.lastPrintAt = null;
        order.lastPrintPlate = null;
        order.printPlates = {};
        return;
      }
      order.printCount = rec.count;
      order.lastPrintAt = rec.lastTs || null;
      order.lastPrintPlate = rec.lastPlate || null;
      order.printPlates = { ...(rec.plates || {}) };
    }

    for (const order of state.orders || []) applyStats(order);
    for (const block of state.weekArchive || []) {
      for (const order of block.orders || []) applyStats(order);
    }

    if (state._lastAppliedOrder) {
      const pickKey = getOrderPickKey(state._lastAppliedOrder);
      const updated = pickKey != null ? getOrderByIdx(pickKey) : null;
      if (updated) {
        state._lastAppliedOrder.printCount = updated.printCount;
        state._lastAppliedOrder.lastPrintAt = updated.lastPrintAt;
        state._lastAppliedOrder.lastPrintPlate = updated.lastPrintPlate;
        state._lastAppliedOrder.printPlates = { ...(updated.printPlates || {}) };
      }
    }

    try { saveState(); } catch (e) {}
    try { if (_pickerRenderHook) _pickerRenderHook(); } catch (e) {}
    return true;
  }

  function getActiveOrderIdx() {
    return getOrderPickKey(state._lastAppliedOrder) ?? state._lastAppliedOrder?.__idx ?? null;
  }

  /** Liste hücresi için hafif sayaç — geçmiş taraması modalda yapılır */
  function getOrderTruckBadgeCount(o) {
    const plateCount = Object.keys(_normalizePrintPlates(o.printPlates)).length;
    if (plateCount > 0) return plateCount;
    const pc = getOrderPrintCount(o);
    return pc > 0 ? pc : 0;
  }

  function buildOrderStatusCell(o, forPrint) {
    const isUsed = !!o.usedAt;
    const pc = getOrderPrintCount(o);
    const truckCount = getOrderTruckBadgeCount(o);

    if (forPrint) {
      if (!isUsed && pc <= 0) return '';
      const bits = [];
      if (isUsed) bits.push('✓');
      if (pc > 0) {
        const plates = formatPrintPlatesSummary(o.printPlates, 3);
        bits.push(plates ? `Y:${pc} ${plates}` : `Y:${pc}`);
      }
      return escapeHtml(bits.join(' '));
    }

    const pickKey = escapeHtml(o._pickKey || String(o.__idx));
    const when = formatOrderPrintWhen(o.lastPrintAt);
    const ctxHint = historyFilterHint(o);
    const truckTitle = [
      truckCount > 0 ? `${truckCount} plaka kayıtlı` : '',
      pc > 0 ? `bu sipariş: ${pc} kez yazdırıldı` : '',
      o.lastPrintPlate ? `son plaka: ${o.lastPrintPlate}` : '',
      when ? `son: ${when}` : '',
      formatPrintPlatesSummary(o.printPlates, 6) ? `plakalar: ${formatPrintPlatesSummary(o.printPlates, 6)}` : '',
      ctxHint || '',
      isUsed ? `seçildi${o.usedPlate ? ': ' + o.usedPlate : ''}` : '',
      'detay için tıklayın',
    ].filter(Boolean).join(' · ') || (isHpStyleFirma(o.firma) ? 'Bu yükleme türü / şehir için geçmiş araç yok' : 'Bu firma ve malzeme için geçmiş araç yok');
    const truckLabel = truckCount > 0 ? `🚛${truckCount}` : '🚛';
    const usedMark = isUsed
      ? `<span style="color:#4b5563;font-weight:700;line-height:1;" title="Seçildi${o.usedPlate ? ': ' + escapeHtml(o.usedPlate) : ''}">✓</span>`
      : '';
    return `<div style="display:flex;flex-direction:column;align-items:center;gap:3px;">
      ${usedMark}
      <button type="button" data-history-key="${pickKey}" title="${escapeHtml(truckTitle)}" style="border:0;background:#eef2ff;color:#4338ca;border-radius:6px;padding:2px 6px;font-size:10px;font-weight:700;cursor:pointer;line-height:1.2;white-space:nowrap;">${truckLabel}</button>
    </div>`;
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return false;
      const payload = JSON.parse(raw);
      const ok = applyPayloadToState(payload, { force: true });
      const ts = getPayloadSyncTs(payload);
      if (ts > 0) _localSyncTs = ts;
      return ok;
    } catch (e) {
      console.warn('Piyasa loadState failed', e);
      return false;
    }
  }

  function clearSavedState(){
    try{ localStorage.removeItem(STORAGE_KEY); }catch(e){}
  }

  function toast(msg, type){
    try{
      if (typeof window.showToast === 'function') return window.showToast(msg, type || 'info');
    }catch(e){}
  }

  let _piyasaExcelLoadingEl = null;
  function showPiyasaExcelLoading(message) {
    hidePiyasaExcelLoading();
    const overlay = document.createElement('div');
    overlay.id = 'piyasaExcelLoadingOverlay';
    overlay.setAttribute('role', 'status');
    overlay.setAttribute('aria-live', 'polite');
    overlay.style.cssText = piyasaOverlayStyle(PIYASA_Z_LAYER);
    markPiyasaModalLayer(overlay);
    overlay.innerHTML = `
      <div style="background:#fff;border-radius:14px;padding:20px 24px;max-width:360px;width:100%;box-shadow:0 10px 30px rgba(0,0,0,.25);text-align:center;">
        <div style="width:36px;height:36px;border:3px solid #e5e7eb;border-top-color:#111827;border-radius:50%;margin:0 auto 14px;animation:piyasaExcelSpin .8s linear infinite;"></div>
        <div id="piyasaExcelLoadingMsg" style="font-weight:700;font-size:15px;color:#111;">${escapeHtml(message || 'Excel hazırlanıyor…')}</div>
        <div style="font-size:12px;color:#666;margin-top:8px;">Bu işlem birkaç saniye sürebilir</div>
      </div>
    `;
    if (!document.getElementById('piyasaExcelLoadingStyle')) {
      const st = document.createElement('style');
      st.id = 'piyasaExcelLoadingStyle';
      st.textContent = '@keyframes piyasaExcelSpin{to{transform:rotate(360deg)}}';
      document.head.appendChild(st);
    }
    document.body.appendChild(overlay);
    _piyasaExcelLoadingEl = overlay;
    return {
      setMessage(msg) {
        const el = overlay.querySelector('#piyasaExcelLoadingMsg');
        if (el) el.textContent = String(msg || '');
      },
    };
  }

  function hidePiyasaExcelLoading() {
    if (_piyasaExcelLoadingEl) {
      try {
        _piyasaExcelLoadingEl.remove();
      } catch (e) {}
      _piyasaExcelLoadingEl = null;
    }
  }

  function normKey(k){
    return String(k||'')
      .toUpperCase()
      .replaceAll('İ','I')
      .replace(/\s+/g,' ')
      .trim();
  }

  function pick(obj, wanted){
    const map = {};
    for (const key of Object.keys(obj||{})) map[normKey(key)] = obj[key];
    for (const w of wanted){
      const v = map[normKey(w)];
      if (v !== undefined && v !== null && String(v).trim() !== '') return v;
    }
    return '';
  }

  function getWeekFromSheetName(name, wb){
    try{
      const s = String(name||'').toUpperCase();
      // Match a number that appears before 'HAFTA' allowing variants like '28.HAFTA', '28HAFTA', '28 HAFTA', '28,HAFTA (2)'
      const m = s.match(/(\d{1,2})(?=[^\d]*HAFTA)/i);
      if (m) return parseInt(m[1], 10);

      // Fallback: if workbook provided, try to read sheet's G1 (or nearby) to infer week from date
      if (wb && wb.SheetNames && wb.SheetNames.includes(name)){
        try{
          const ws = wb.Sheets[name];
          const found = findDateInSheet(ws);
          if (found && found.date){
            const wk = getWeekFromDate(found.date);
            if (wk) return wk;
          }
        }catch(e){}
      }
    }catch(e){}
    return null;
  }

  function isPiyasaAutoDataSheet(name) {
    const s = String(name || '')
      .trim()
      .toUpperCase()
      .replace(/\s+/g, '_');
    if (!s) return false;
    if (/^OTOMATIK/i.test(s)) return true;
    if (/^AUTO[_\s]?DATA/i.test(s)) return true;
    return false;
  }

  function normalizePiyasaSheetName(name) {
    return String(name || '')
      .trim()
      .toUpperCase()
      .replace(/\s+/g, '');
  }

  function isExactHaftaSheetName(name, week) {
    const n = normalizePiyasaSheetName(name);
    const w = parseInt(week, 10);
    if (!Number.isFinite(w)) return false;
    return n === `${w}.HAFTA` || n === `${w}-HAFTA` || n === `${w}HAFTA`;
  }

  /** OTOMATIK_VERI hariç, en güncel (en büyük) hafta kitabını seçer. */
  function pickDefaultPiyasaSheetMeta(metas) {
    const eligible = (metas || []).filter(
      (m) => m && !isPiyasaAutoDataSheet(m.name) && Number.isFinite(m.week) && m.week > 0
    );
    if (!eligible.length) return (metas && metas[0]) || null;

    const maxWeek = Math.max(...eligible.map((m) => m.week));
    const sameWeek = eligible.filter((m) => m.week === maxWeek);

    const exact = sameWeek.find((m) => isExactHaftaSheetName(m.name, maxWeek));
    if (exact) return exact;

    sameWeek.sort(
      (a, b) => (b.orderIndex - a.orderIndex) || String(b.name).localeCompare(String(a.name), 'tr')
    );
    return sameWeek[0];
  }

  function ensureHiddenFileInput(id){
    let inp = document.getElementById(id);
    if (inp) return inp;
    inp = document.createElement('input');
    inp.type = 'file';
    inp.id = id;
    inp.accept = '.xlsx,.xls,.xlsm,.xlsb';
    inp.style.display = 'none';
    document.body.appendChild(inp);
    return inp;
  }

  async function askWeek(weeks){
    const def = (weeks && weeks.length) ? String(weeks[0]) : '';
    const answer = await prompt(`Hangi haftayı yükleyelim?\nMevcut haftalar: ${weeks.join(', ')}`, def);
    if (answer === null) return null;
    const w = parseInt(String(answer).trim(), 10);
    if (!Number.isFinite(w)) return null;
    return w;
  }

  function chooseBestSheetByRowCount(workbook, sheetNames){
    // ✅ Hız: sheet_to_json ile saymak çok pahalı.
    // !ref üzerinden yaklaşık satır sayısı (çok hızlı) ile en büyük sheet'i seç.
    let best = sheetNames[0];
    let bestCount = -1;
    for (const s of sheetNames){
      try{
        const ws = workbook.Sheets[s];
        const ref = ws && ws['!ref'];
        let rowCount = 0;
        if (ref && XLSX && XLSX.utils && XLSX.utils.decode_range){
          const range = XLSX.utils.decode_range(ref);
          rowCount = (range.e.r - range.s.r + 1) || 0;
        }
        if (rowCount > bestCount){
          bestCount = rowCount;
          best = s;
        }
      }catch(e){}
    }
    return best;
  }

  /** SheetJS: gizli satır bilgisi yalnızca cellStyles:true ile okunur. */
  const PIYASA_XLSX_READ_OPTS = {
    type: 'array',
    cellStyles: true,
    cellNF: false,
    cellText: false,
    dense: true,
  };

  function isExcelRowHidden(ws, zeroBasedRowIndex) {
    try {
      const rowsMeta = ws && ws['!rows'];
      if (!rowsMeta || !Array.isArray(rowsMeta)) return false;
      const meta = rowsMeta[zeroBasedRowIndex];
      return !!(meta && meta.hidden);
    } catch (e) {
      return false;
    }
  }

  /** Excel'de kullanıcının görmediği (gizli) satırları at — sheet ne gösteriyorsa o yüklenir. */
  function filterHiddenRowsAoA(ws, table) {
    const src = table || [];
    try {
      const rowsMeta = ws && ws['!rows'];
      if (!rowsMeta || !Array.isArray(rowsMeta)) {
        return { table: src, hiddenSkipped: 0, visibilityApplied: false };
      }
      const out = [];
      let hiddenSkipped = 0;
      for (let i = 0; i < src.length; i++) {
        if (isExcelRowHidden(ws, i)) {
          hiddenSkipped++;
          continue;
        }
        const row = src[i];
        if (row && typeof row === 'object') row._excelRowNum = i + 1;
        out.push(row);
      }
      return { table: out, hiddenSkipped, visibilityApplied: true };
    } catch (e) {
      return { table: src, hiddenSkipped: 0, visibilityApplied: false };
    }
  }

  function parseAmount(v){
    const s = String(v ?? '').trim();
    if (!s) return NaN;
    // 1.234,56 / 1234,56 / 1234.56 gibi
    const cleaned = s
      .replace(/\s+/g,'')
      .replace(/\./g,'')
      .replace(',', '.');
    const n = parseFloat(cleaned);
    return Number.isFinite(n) ? n : NaN;
  }

  function isSummaryText(v){
    const t = String(v||'').toUpperCase().replaceAll('İ','I');
    return t.includes('TOPLAM') || t.includes('ARA TOPLAM') || t.includes('GENEL TOPLAM') || t.includes('OZET') || t.includes('ÖZET');
  }

  function parseSheetSmart(ws){
    // Bazı dosyalarda başlık satırı 1. satır değildir (üstte boş/sabit satırlar olabilir).
    // Yalnızca Excel'de görünen satırlar okunur (gizli satırlar atılır).
    const fullTable = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    const visibility = filterHiddenRowsAoA(ws, fullTable);
    const table = visibility.table;
    const expected = ['SİRA','SIRA','SEVK','FİRMA','FIRMA','FİRMA ADI','FIRMA ADI','MALZEME','YÜKLEME TÜRÜ','YUKLEME TURU','AÇIKLAMA','ACIKLAMA','İL','IL','LOT NO','LOT','MİKTAR','MIKTAR','MİKTAR DANE','MIKTAR DANE','MIKTARDANE','MİKTARDANE','SEVKİYAT TİPİ','SEVKIYAT TIPI'];

    function cellNorm(v){
      return String(v||'')
        .toUpperCase()
        .replaceAll('İ','I')
        .replace(/\s+/g,' ')
        .trim();
    }

    // İlk 40 satır içinde, beklenen başlıklardan en az 2-3 tanesini içeren satırı başlık kabul et.
    let headerRowIndex = -1;
    let bestScore = -1;
    const scanMax = Math.min(table.length, 40);
    for (let i = 0; i < scanMax; i++){
      const row = table[i] || [];
      const set = new Set(row.map(cellNorm).filter(Boolean));
      let score = 0;
      for (const k of expected) if (set.has(cellNorm(k))) score++;
      if (score > bestScore){
        bestScore = score;
        headerRowIndex = i;
      }
    }

    // Başlık bulunamazsa gizli satır filtresi dışı ham json kullanma — boş dön.
    if (bestScore < 2 || headerRowIndex < 0){
      const empty = [];
      empty.__parseMeta = {
        firmaAdiColIndex: -1,
        miktarUnit: 'kg',
        templateValidation: { ok: false, missing: ['başlık satırı'] },
        headerRow: [],
        headerRowIndex: -1,
        hiddenSkipped: visibility.hiddenSkipped,
        visibilityApplied: visibility.visibilityApplied,
      };
      return empty;
    }

    const header = (table[headerRowIndex] || []).map(v=> String(v||'').trim());
    // Boş başlıkları doldur
    const safeHeader = header.map((h, idx)=> h && h.trim() ? h : `__COL_${idx}`);

    const firmaAdiColIndex = eu().findFirmaAdiColumnIndex
      ? eu().findFirmaAdiColumnIndex(header)
      : -1;
    const miktarUnit = eu().detectMiktarUnit ? eu().detectMiktarUnit(header) : 'kg';
    const templateValidation = eu().validatePiyasaTemplate ? eu().validatePiyasaTemplate(header) : { ok: true };

    const out = [];
    for (let r = headerRowIndex + 1; r < table.length; r++){
      const row = table[r];
      if (!row) continue;
      const obj = {};
      for (let c = 0; c < safeHeader.length; c++){
        obj[safeHeader[c]] = row[c] ?? '';
      }
      if (firmaAdiColIndex >= 0 && row.length > firmaAdiColIndex) {
        obj._hSutunValue = String(row[firmaAdiColIndex] || '').trim();
      } else if (row.length > 7) {
        obj._hSutunValue = String(row[7] || '').trim();
      }
      if (Number.isFinite(row._excelRowNum) && row._excelRowNum > 0) {
        obj._excelRowNum = row._excelRowNum;
      }
      out.push(obj);
    }
    out.__parseMeta = {
      firmaAdiColIndex,
      miktarUnit,
      templateValidation,
      headerRow: header,
      headerRowIndex,
      hiddenSkipped: visibility.hiddenSkipped,
      visibilityApplied: visibility.visibilityApplied,
    };
    return out;
  }

  function normalizeSevkiyatTipi(v) {
    const raw = String(v ?? '').trim();
    if (!raw) return '';
    const s = normKey(raw).replace(/\s+/g, '');
    if (s === 'YI-GP' || s === 'YIGP' || s.endsWith('-GP') || s === 'GP') return 'Yİ-GP';
    if (s === 'YI-HP' || s === 'YIHP' || s.endsWith('-HP') || s === 'HP') return 'Yİ-HP';
    return raw;
  }

  function pickSevkiyatTipi(r) {
    let v = pick(r, ['SEVKİYAT TİPİ', 'SEVKIYAT TIPI', 'SEVKİYAT TIPI', 'SEVKIYAT TİPİ', 'SEVKIYAT TIP', 'SEVKİYAT TIP']);
    if (!v) {
      try {
        for (const hk of Object.keys(r || {})) {
          const nk = normKey(hk);
          if (nk.includes('SEVKIYAT') && nk.includes('TIP')) {
            v = r[hk];
            break;
          }
        }
      } catch (e) { /* ignore */ }
    }
    return normalizeSevkiyatTipi(v);
  }

  function inferSevkiyatTipiFromFirma(firma) {
    const f = normKey(String(firma || '').trim());
    if (!f) return '';
    if (f.startsWith('GP')) return 'Yİ-GP';
    if (f.startsWith('HP')) return 'Yİ-HP';
    return '';
  }

  function getOrderSevkiyatTipi(o) {
    const t = normalizeSevkiyatTipi(o && o.sevkiyatTipi);
    if (t === 'Yİ-GP' || t === 'Yİ-HP') return t;
    return inferSevkiyatTipiFromFirma(o && o.firma);
  }

  function pickAciklama(r) {
    let v = pick(r, ['AÇIKLAMA', 'ACIKLAMA', 'NOT', 'YÜKLEME NOTU', 'YUKLEME NOTU', 'AÇIKLAMA 1', 'ACIKLAMA 1']);
    if (v) return v;
    try {
      for (const hk of Object.keys(r || {})) {
        const nk = normKey(hk);
        if (!nk) continue;
        if (nk.includes('ACIKLAMA') || (nk.includes('NOT') && !nk.includes('SN'))) {
          const val = String(r[hk] ?? '').trim();
          if (val) return val;
        }
      }
      // Başlıksız V sütunu (__COL_21) — bazı piyasa şablonlarında açıklama burada
      const colV = r['__COL_21'];
      if (colV != null && String(colV).trim()) return String(colV).trim();
    } catch (e) { /* ignore */ }
    return '';
  }

  function excelRowNumber(parseMeta, dataRowIndex, rawRow) {
    const fromRow = (rawRow && rawRow._raw && rawRow._raw._excelRowNum)
      || (rawRow && rawRow._excelRowNum);
    if (Number.isFinite(fromRow) && fromRow > 0) return fromRow;
    const headerIdx = parseMeta && Number.isFinite(parseMeta.headerRowIndex) ? parseMeta.headerRowIndex : 0;
    return headerIdx + 1 + dataRowIndex + 1;
  }

  function normalizeRows(rawRows, parseMeta){
    const unit = (parseMeta && parseMeta.miktarUnit) || 'kg';
    const skipped = [];
    const orders = [];
    const rows = rawRows || [];
    const meta = parseMeta || (rows.__parseMeta || {});

    rows.forEach((r, idx)=>{
      if (r && r.__parseMeta) return;
      const firmaCode = pick(r, ['FİRMA','FIRMA']);
      let firmaAdi = r._hSutunValue ? String(r._hSutunValue).trim() : '';
      const odemeVal = pick(r, ['ÖDEME TÜRÜ','ODEME TURU','ÖDEME','ODEME']);
      const malzemeVal = pick(r, ['MALZEME']);
      const yuklemeVal = pick(r, ['YÜKLEME TÜRÜ','YUKLEME TURU','YÜKLEME TURU']);
      let orgVal = pick(r, ['ORG','ORGANIZASYON','ORGANIZASYON','ORGANIZATION']);
      // Fallback: detect headers like 'ORG(organizasyon)' or any header containing ORG/ORGANIZ
      if (!orgVal) {
        try{
          for (const hk of Object.keys(r || {})){
            const nk = normKey(hk || '');
            if (!nk) continue;
            if (nk.includes('ORG') || nk.includes('ORGANIZ')){
              orgVal = r[hk] ?? '';
              break;
            }
          }
        }catch(e){ /* ignore */ }
      }
      let miktarVal = eu().pickPiyasaMiktar
        ? eu().pickPiyasaMiktar(r)
        : pick(r, ['MİKTAR DANE','MIKTAR DANE','MİKTARDANE','MIKTARDANE','MİKTAR','MIKTAR']);
      if (eu().miktarToKg) miktarVal = eu().miktarToKg(miktarVal, unit);

      let sevkiyatTipi = pickSevkiyatTipi(r);
      if (!sevkiyatTipi) sevkiyatTipi = inferSevkiyatTipiFromFirma(firmaCode);

      const o = {
        __idx: idx + 1,
        firma: firmaCode,
        firmaAdi: firmaAdi,
        odemeTuru: odemeVal,
        malzeme: malzemeVal,
        yuklemeTuru: yuklemeVal,
        org: orgVal,
        sevkiyatTipi: sevkiyatTipi,
        aciklama: pickAciklama(r),
        sevkYeri: pick(r, ['SEVK','SEVK YERİ','SEVKYERI']),
        il: pick(r, ['İL','IL']),
        miktar: miktarVal,
        _raw: r
      };

      const check = eu().filterPiyasaRow ? eu().filterPiyasaRow(o, idx + 1) : { ok: true };
      if (!check.ok) {
        skipped.push({
          rowIndex: idx + 1,
          excelRow: excelRowNumber(meta, idx, o),
          reason: check.reason,
          firma: o.firma,
          malzeme: o.malzeme,
          miktar: miktarVal,
          aciklama: o.aciklama,
          il: o.il,
        });
        return;
      }
      orders.push(o);
    });

    const hiddenSkipped = parseInt(meta.hiddenSkipped, 10) || 0;
    const report = {
      totalRaw: rows.filter((r) => !(r && r.__parseMeta)).length,
      accepted: orders.length,
      totalSkipped: skipped.length,
      byReason: eu().summarizeSkipped ? eu().summarizeSkipped(skipped) : {},
      skippedRows: skipped,
      template: meta.templateValidation || null,
      miktarUnit: unit,
      hiddenRowsSkipped: hiddenSkipped,
      visibilityApplied: meta.visibilityApplied !== false,
    };
    return { orders, skipped, report };
  }

  function refreshArchiveForCurrentSheet() {
    if (!state.sheet || state.week == null || !Array.isArray(state.weekArchive)) return;
    const orders = (state.orders || []).map((o) => ({
      ...o,
      _sourceWeek: state.week,
      _sourceSheet: state.sheet,
      __archiveKey: o.__archiveKey || `${state.week}:${state.sheet}:${o.__idx}`,
    }));
    const idx = state.weekArchive.findIndex((b) => b.sheet === state.sheet && b.week === state.week);
    if (idx >= 0) {
      state.weekArchive[idx].orders = orders;
      state.weekArchive[idx].sheetDate = state.sheetDate || state.weekArchive[idx].sheetDate;
      state.weekArchive[idx].sheetDateRaw = state.sheetDateRaw || state.weekArchive[idx].sheetDateRaw;
    }
  }

