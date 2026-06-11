// piyasa-core.js — state, sync, geçmiş (paylaşılan global kapsam — IIFE yok)
// Otomatik bölüm — scripts/modularize-remaining.js

// Sayfa yenilense bile piyasa verisini kaybetmemek için localStorage kullanıyoruz.
// Paylaşılan değişkenler: modules/piyasa-globals.js (window.state vb.)

function clearAllOrderPrintStatsInState() {
    const strip = (o) => {
      if (!o) return;
      o.printCount = 0;
      o.lastPrintAt = null;
      o.lastPrintPlate = null;
      o.printPlates = {};
    };
    for (const o of state.orders || []) strip(o);
    for (const block of state.weekArchive || []) {
      for (const o of block.orders || []) strip(o);
    }
    if (state._lastAppliedOrder) strip(state._lastAppliedOrder);
    try { saveState(); } catch (e) {}
  }

  function applyDurumResetFromServer(resetEpoch) {
    const local = parseInt(localStorage.getItem(DURUM_RESET_EPOCH_LS) || '0', 10) || 0;
    if (!resetEpoch || resetEpoch <= local) return false;
    clearAllOrderPrintStatsInState();
    try { localStorage.setItem(DURUM_RESET_EPOCH_LS, String(resetEpoch)); } catch (e) {}
    return true;
  }

  /** DURUM sayacı yalnızca bu tarihten sonraki yazdırmaları sayar; rapor listesi etkilenmez. */
  function getDurumCountStartMs() {
    return Number(_durumStatus.durumCountStartMs || _durumStatus.freezeUntil) || 0;
  }

  function isDurumCountTs(ts) {
    const start = getDurumCountStartMs();
    if (!start) return true;
    return Number(ts) >= start;
  }

  async function refreshDurumStatus() {
    try {
      const r = await fetch('/api/piyasa/durum-status?_=' + Date.now(), {
        credentials: 'include',
        cache: 'no-store',
      });
      if (!r.ok) return _durumStatus;
      const data = await r.json();
      _durumStatus = {
        frozen: !!data.frozen,
        freezeUntil: Number(data.freezeUntil) || 0,
        durumCountStartMs: Number(data.durumCountStartMs || data.freezeUntil) || 0,
        resetEpoch: Number(data.resetEpoch) || 0,
        message: String(data.message || ''),
      };
      applyDurumResetFromServer(_durumStatus.resetEpoch);
      return _durumStatus;
    } catch (e) {
      return _durumStatus;
    }
  }

  function isDurumFrozen() {
    return !!_durumStatus.frozen;
  }

  async function verifyCustomerListPassword(message) {
    const ui = window.rpUi || {};
    let entered = null;
    if (typeof ui.password === 'function') {
      entered = await ui.password(message);
    } else if (window.rpDialog && typeof window.rpDialog.password === 'function') {
      entered = await window.rpDialog.password(message);
    } else {
      entered = prompt(message);
    }
    if (entered == null || entered === false) return false;
    if (String(entered).trim() !== CUSTOMER_LIST_PASSWORD) {
      if (typeof ui.alert === 'function') await ui.alert('Şifre hatalı.', 'danger');
      else alert('Şifre hatalı.');
      return false;
    }
    return true;
  }
function piyasaOverlayStyle(zIndex) {
    return `position:fixed;inset:0;background:rgba(0,0,0,.35);z-index:${zIndex || PIYASA_Z_BASE};display:flex;align-items:center;justify-content:center;padding:16px;isolation:isolate;`;
  }

  function markPiyasaModalLayer(overlay) {
    if (overlay) overlay.setAttribute(PIYASA_MODAL_LAYER_ATTR, '1');
  }

  function hasOpenPiyasaModalLayer() {
    return !!document.querySelector(`[${PIYASA_MODAL_LAYER_ATTR}="1"]`);
  }

  /** ESC: yalnızca bu overlay kapanır; alttaki Piyasa sipariş seçicisine sızmaz */
  function bindPiyasaOverlayEsc(overlay, closeFn) {
    const onEsc = (e) => {
      if (e.key !== 'Escape') return;
      if (!document.body.contains(overlay)) {
        document.removeEventListener('keydown', onEsc, true);
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      closeFn();
      document.removeEventListener('keydown', onEsc, true);
    };
    document.addEventListener('keydown', onEsc, true);
    return onEsc;
  }

  function eu() {
    return window.ExcelUtils || {};
  }

  function getPayloadSyncTs(payload) {
    if (!payload || typeof payload !== 'object') return 0;
    const direct = Number(payload.updatedAt || 0);
    if (Number.isFinite(direct) && direct > 0) return direct;
    if (payload.loadedAt) {
      const d = new Date(payload.loadedAt).getTime();
      if (Number.isFinite(d) && d > 0) return d;
    }
    return 0;
  }

  function refreshPiyasaHeaderUi() {
    try { window.refreshHeaderExcelInfo && window.refreshHeaderExcelInfo(); } catch (e) {}
  }

  async function fetchPiyasaFromServer() {
    try {
      const r = await fetch('/api/piyasa', { cache: 'no-store', credentials: 'include' });
      if (!r.ok) return null;
      const j = await r.json();
      return (j && typeof j === 'object') ? j : {};
    } catch (e) {
      return null;
    }
  }

  async function pushPiyasaToServer(payload) {
    try {
      const token = localStorage.getItem('authToken');
      const headers = { 'Content-Type': 'application/json' };
      if (token) headers.Authorization = 'Bearer ' + token;
      const body = { ...payload, updatedAt: payload.updatedAt || Date.now() };
      const res = await fetch('/api/piyasa', {
        method: 'POST',
        headers,
        credentials: 'include',
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        console.warn('Piyasa server sync failed', res.status);
        return false;
      }
      try {
        const j = await res.json();
        if (j && j.updatedAt) _localSyncTs = Math.max(_localSyncTs, Number(j.updatedAt) || 0);
      } catch (e) {}
      if (window.SyncManager && typeof window.SyncManager.triggerRefresh === 'function') {
        window.SyncManager.triggerRefresh('piyasa', { updatedAt: body.updatedAt });
      }
      return true;
    } catch (e) {
      console.warn('Piyasa server sync failed', e);
      return false;
    }
  }

  function saveState(){
    try{
      // ✅ Veri tutarlılığı kontrolü: firma alanında İL bilgisi varsa, localStorage'ı temizle
      const hasCorruptData = (state.orders || []).some(o => {
        const firma = String(o.firma || '').toUpperCase();
        const il = String(o.il || '').toUpperCase();
        // Eğer firma alanında il değeri yazılmışsa (hem yazılı hem de il alanında aynı ise)
        return firma === il && firma.length > 0 && 
               ['ANKARA', 'İSTANBUL', 'İZMİR', 'BURSA', 'ADANA', 'BALIKESİR', 'MERSİN', 'GEBZE', 'BOZÜYÜK', 'AKSARAY', 'ANKARA/BALA', 'TURGUTLU/MANİSA'].includes(firma);
      });
      
      if (hasCorruptData) {
        console.warn('Piyasa: Veri bozulması algılandı, localStorage temizleniyor');
        localStorage.removeItem(STORAGE_KEY);
        return false;
      }

      const updatedAt = Date.now();
      _localSyncTs = updatedAt;
      const payload = {
        updatedAt,
        week: state.week,
        sheet: state.sheet,
        loadedAt: state.loadedAt ? state.loadedAt.toISOString() : null,
        sheetDate: state.sheetDate || null,
        sheetDateRaw: state.sheetDateRaw || null,
        // LocalStorage sınırı için sadece gerekli alanları saklıyoruz
        orders: (state.orders || []).map(o => ({
          __idx: o.__idx,
          firma: o.firma,
          firmaAdi: o.firmaAdi,
          malzeme: o.malzeme,
          yuklemeTuru: o.yuklemeTuru,
          odemeTuru: o.odemeTuru,
          org: o.org,
          aciklama: o.aciklama,
          sevkYeri: o.sevkYeri,
          il: o.il,
          miktar: o.miktar,
          sevkiyatTipi: o.sevkiyatTipi || '',
          usedAt: o.usedAt || null,
          usedPlate: o.usedPlate || null,
          printCount: Math.max(0, parseInt(o.printCount, 10) || 0),
          lastPrintAt: o.lastPrintAt || null,
          lastPrintPlate: o.lastPrintPlate || null,
          printPlates: _normalizePrintPlates(o.printPlates),
          _hSutunValue: o.firmaAdi,
        })),
        weekArchive: _serializeWeekArchive(state.weekArchive),
        fileFingerprint: state.fileFingerprint || null,
        lastImportReport: state.lastImportReport
          ? {
              ...state.lastImportReport,
              skippedRows: (state.lastImportReport.skippedRows || state.lastSkippedRows || []).slice(0, 120),
            }
          : null,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      pushPiyasaToServer(payload).catch(() => {});
      refreshPiyasaHeaderUi();
      // Fallback: eğer global refresh fonksiyonu yoksa doğrudan DOM'u güncelle
      try {
        if (!window.refreshHeaderExcelInfo) {
          const cnt = (payload.orders || []).length || 0;
          const weekInfo = payload.week ? payload.week : (payload.sheet ? payload.sheet : '-');
          let dateStr = '-';
          if (payload.loadedAt) {
            const dt = new Date(payload.loadedAt);
            if (!isNaN(dt)){
              const d = ('0' + dt.getDate()).slice(-2);
              const m = ('0' + (dt.getMonth() + 1)).slice(-2);
              const y = dt.getFullYear();
              dateStr = `${d}.${m}.${y}`;
            }
          }
          const piyLine = `${weekInfo}.Hafta/${dateStr}`;
          try{
            const chipPiy = document.getElementById('chipPiyasa');
            const chipPiyText = document.getElementById('chipPiyasaText');
            if (chipPiy) {
              chipPiy.classList.remove('chip-ok', 'chip-warn');
              chipPiy.classList.add(cnt > 0 ? 'chip-ok' : 'chip-warn');
              chipPiy.title = cnt > 0 ? `PİYASA Excel: ${piyLine}` : 'PİYASA Excel yüklü değil';
            }
            if (chipPiyText) chipPiyText.textContent = cnt > 0 ? `Yüklü ${piyLine}` : 'Boş';
          }catch(_){ }
        }
      }catch(e){}
    }catch(e){
      // localStorage dolu olabilir; bu durumda sessiz geçiyoruz.
      console.warn('Piyasa saveState failed', e);
    }
  }

  async function loadStateFromServerFirst(){
    const remote = await fetchPiyasaFromServer();
    if (remote === null) return false;
    const remoteTs = getPayloadSyncTs(remote);
    const hasOrders = Array.isArray(remote.orders) && remote.orders.length > 0;
    if (!remoteTs && !hasOrders && Object.keys(remote).length === 0) return false;
    if (!applyPayloadToState(remote, { force: true })) return false;
    try {
      if (hasOrders || remoteTs > 0) localStorage.setItem(STORAGE_KEY, JSON.stringify(remote));
      else clearSavedState();
    } catch (e) {}
    return hasOrders;
  }

  async function syncPiyasaFromServer(options) {
    const quiet = !!(options && options.quiet);
    if (_syncInFlight) return false;
    if (!document.documentElement.classList.contains('logged-in')) return false;
    _syncInFlight = true;
    try {
      const remote = await fetchPiyasaFromServer();
      if (remote === null) return false;
      const remoteTs = getPayloadSyncTs(remote);
      if (remoteTs > 0 && remoteTs <= _localSyncTs) return false;
      const hadOrders = (state.orders || []).length > 0;
      if (!applyPayloadToState(remote, { force: true })) return false;
      try {
        const hasOrders = Array.isArray(remote.orders) && remote.orders.length > 0;
        if (hasOrders || remoteTs > 0) localStorage.setItem(STORAGE_KEY, JSON.stringify(remote));
        else clearSavedState();
      } catch (e) {}
      refreshPiyasaHeaderUi();
      const count = (state.orders || []).length;
      if (!quiet) {
        if (count > 0) toast(`✅ Piyasa Excel güncellendi (${count} satır)`, 'success');
        else if (hadOrders) toast('Piyasa Excel diğer bilgisayarda silindi.', 'info');
      } else if (count === 0 && hadOrders) {
        toast('Piyasa Excel diğer bilgisayarda silindi.', 'info');
      } else if (count > 0 && !hadOrders) {
        toast(`✅ Piyasa Excel yüklendi (${count} satır)`, 'success');
      }
      return true;
    } finally {
      _syncInFlight = false;
    }
  }

  async function requestPiyasaSyncIfRemoteNewer(hint) {
    const remoteTs = Number(hint && hint.updatedAt) || 0;
    if (remoteTs > 0 && remoteTs <= _localSyncTs) return false;
    return syncPiyasaFromServer({ quiet: true });
  }

  function setupPiyasaSyncListeners() {
    if (window.__piyasaSyncListenersBound) return;
    window.__piyasaSyncListenersBound = true;
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) requestPiyasaSyncIfRemoteNewer({}).catch(() => {});
    });
    if (!window.SyncManager || typeof window.SyncManager.on !== 'function') return;
    window.SyncManager.on('piyasa_updated', (data) => {
      requestPiyasaSyncIfRemoteNewer(data || {}).catch(() => {});
    });
    window.SyncManager.on('manual_refresh', (payload) => {
      if (payload && payload.dataType === 'piyasa') {
        requestPiyasaSyncIfRemoteNewer(payload.data || payload).catch(() => {});
      }
    });
    window.SyncManager.on('report_deleted', () => {
      reconcileOrderPrintCountsFromReports().catch(() => {});
    });
    window.SyncManager.on('reports_deleted', () => {
      reconcileOrderPrintCountsFromReports().catch(() => {});
    });
    window.SyncManager.on('piyasa_durum_reset', (data) => {
      const epoch = Number(data && data.resetEpoch) || Date.now();
      applyDurumResetFromServer(epoch);
      reconcileOrderPrintCountsFromReports().catch(() => {});
      try { if (_pickerRenderHook) _pickerRenderHook(); } catch (e) {}
    });
  }

  function applyPayloadToState(payload, options) {
    const force = !!(options && options.force);
    try {
      if (!payload || typeof payload !== 'object') return false;

      const remoteTs = getPayloadSyncTs(payload);
      if (!force && remoteTs > 0 && remoteTs <= _localSyncTs) return false;

      const orders = Array.isArray(payload.orders) ? payload.orders : [];
      if (!orders.length) {
        const alreadyEmpty = !(state.orders || []).length && !state.week && !state.sheet;
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
        if (remoteTs > 0) _localSyncTs = remoteTs;
        return force ? !alreadyEmpty || remoteTs > 0 : !alreadyEmpty;
      }

      const hasCorruptData = orders.some((o) => {
        const firma = String(o.firma || '').toUpperCase();
        const il = String(o.il || '').toUpperCase();
        return (
          firma === il &&
          firma.length > 0 &&
          ['ANKARA', 'İSTANBUL', 'İZMİR', 'BURSA', 'ADANA', 'BALIKESİR', 'MERSİN', 'GEBZE', 'BOZÜYÜK', 'AKSARAY', 'ANKARA/BALA', 'TURGUTLU/MANİSA'].includes(firma)
        );
      });

      if (hasCorruptData) {
        console.warn('Piyasa: Eski hatalı veri algılandı, temizleniyor');
        localStorage.removeItem(STORAGE_KEY);
        return false;
      }

      state.week = payload.week ?? null;
      state.sheet = payload.sheet ?? null;
      state.loadedAt = payload.loadedAt ? new Date(payload.loadedAt) : null;
      state.sheetDate = payload.sheetDate || null;
      state.sheetDateRaw = payload.sheetDateRaw || null;
      state.weekArchive = _deserializeWeekArchive(payload.weekArchive, payload.week, payload.sheet);
      state.fileFingerprint = payload.fileFingerprint || null;
      state.lastImportReport = payload.lastImportReport || null;
      state.lastSkippedRows = (payload.lastImportReport && payload.lastImportReport.skippedRows) || [];
      state.orders = orders.map((o, i) => _mapOrderFromStorage(o, i));
      if (remoteTs > 0) _localSyncTs = remoteTs;
      return true;
    } catch (e) {
      console.warn('Piyasa applyPayloadToState failed', e);
      return false;
    }
  }

  function _normalizePrintPlates(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const out = {};
    for (const [k, v] of Object.entries(raw)) {
      const plate = String(k || '').trim().toUpperCase();
      const n = parseInt(v, 10) || 0;
      if (plate && n > 0) out[plate] = n;
    }
    return out;
  }

  function _mapOrderFromStorage(o, i) {
    const hSutunValue = o._hSutunValue || o.firmaAdi || '';
    return {
      __idx: o.__idx ?? i + 1,
      __archiveKey: o.__archiveKey || null,
      _sourceWeek: o._sourceWeek ?? null,
      _sourceSheet: o._sourceSheet || null,
      firma: o.firma || '',
      firmaAdi: hSutunValue,
      malzeme: o.malzeme || '',
      yuklemeTuru: o.yuklemeTuru || '',
      odemeTuru: o.odemeTuru || '',
      org: o.org || '',
      aciklama: o.aciklama || '',
      sevkYeri: o.sevkYeri || '',
      il: o.il || '',
      miktar: o.miktar || '',
      sevkiyatTipi: o.sevkiyatTipi || inferSevkiyatTipiFromFirma(o.firma) || '',
      usedAt: o.usedAt || null,
      usedPlate: o.usedPlate || null,
      printCount: Math.max(0, parseInt(o.printCount, 10) || 0),
      lastPrintAt: o.lastPrintAt || null,
      lastPrintPlate: o.lastPrintPlate || null,
      printPlates: _normalizePrintPlates(o.printPlates),
    };
  }

  function _serializeArchiveOrder(o) {
    return {
      __idx: o.__idx,
      __archiveKey: o.__archiveKey || null,
      _sourceWeek: o._sourceWeek ?? null,
      _sourceSheet: o._sourceSheet || null,
      firma: o.firma,
      firmaAdi: o.firmaAdi,
      malzeme: o.malzeme,
      yuklemeTuru: o.yuklemeTuru,
      odemeTuru: o.odemeTuru,
      org: o.org,
      aciklama: o.aciklama,
      sevkYeri: o.sevkYeri,
      il: o.il,
      miktar: o.miktar,
      sevkiyatTipi: o.sevkiyatTipi || '',
      usedAt: o.usedAt || null,
      usedPlate: o.usedPlate || null,
      printCount: Math.max(0, parseInt(o.printCount, 10) || 0),
      lastPrintAt: o.lastPrintAt || null,
      lastPrintPlate: o.lastPrintPlate || null,
      printPlates: _normalizePrintPlates(o.printPlates),
      _hSutunValue: o.firmaAdi,
    };
  }

  function _serializeWeekArchive(archive) {
    return (archive || []).map((block) => ({
      week: block.week,
      sheet: block.sheet,
      sheetDate: block.sheetDate || null,
      sheetDateRaw: block.sheetDateRaw || null,
      orders: (block.orders || []).map(_serializeArchiveOrder),
    }));
  }

  function _deserializeWeekArchive(raw, currentWeek, currentSheet) {
    if (!Array.isArray(raw) || !raw.length) return [];
    return raw.map((block) => {
      const week = block.week ?? null;
      const sheet = block.sheet || '';
      const isCurrent = week === currentWeek && sheet === currentSheet;
      const orders = (block.orders || []).map((o, i) => {
        const mapped = _mapOrderFromStorage(o, i);
        mapped._sourceWeek = mapped._sourceWeek ?? week;
        mapped._sourceSheet = mapped._sourceSheet || sheet;
        mapped.__archiveKey = mapped.__archiveKey || `${mapped._sourceWeek}:${mapped._sourceSheet}:${mapped.__idx}`;
        mapped._weekLabel = isCurrent ? 'Bu hafta' : `${week}. hafta`;
        mapped._isCurrentWeek = isCurrent;
        mapped._pickKey = mapped.__archiveKey;
        return mapped;
      });
      return {
        week,
        sheet,
        sheetDate: block.sheetDate || null,
        sheetDateRaw: block.sheetDateRaw || null,
        orders,
      };
    });
  }

  function _decoratePickerOrder(o, block, currentWeek, currentSheet) {
    const week = block?.week ?? o._sourceWeek ?? currentWeek;
    const sheet = block?.sheet ?? o._sourceSheet ?? currentSheet;
    const isCurrent = week === currentWeek && sheet === currentSheet;
    return {
      ...o,
      _sourceWeek: week,
      _sourceSheet: sheet,
      _weekLabel: isCurrent ? 'Bu hafta' : `${week}. hafta`,
      _isCurrentWeek: isCurrent,
      _pickKey: o.__archiveKey || `${week}:${sheet}:${o.__idx}`,
    };
  }

  function _getPickerSourceOrders() {
    const currentWeek = state.week;
    const currentSheet = state.sheet;
    return (state.orders || []).map((o) => _decoratePickerOrder(o, { week: currentWeek, sheet: currentSheet }, currentWeek, currentSheet));
  }

  function _pickerSheetKey(week, sheet) {
    return `${week ?? ''}:${sheet ?? ''}`;
  }

  function _getPickerSheetOptions() {
    const opts = [];
    const upsert = (week, sheet, orders, sheetDate, sheetDateRaw) => {
      if (!sheet) return;
      const key = _pickerSheetKey(week, sheet);
      const idx = opts.findIndex((o) => o.key === key);
      if (idx >= 0) opts.splice(idx, 1);
      opts.push({
        key,
        week,
        sheet: String(sheet),
        label: String(sheet),
        orders: orders || [],
        sheetDate: sheetDate || null,
        sheetDateRaw: sheetDateRaw || null,
      });
    };
    for (const b of state.weekArchive || []) {
      upsert(b.week, b.sheet, b.orders, b.sheetDate, b.sheetDateRaw);
    }
    // Aktif sheet: state.orders seçim/yazdırma durumunu taşır — arşiv kopyasının üzerine yaz
    if (state.sheet) {
      upsert(state.week, state.sheet, state.orders, state.sheetDate, state.sheetDateRaw);
    }
    return opts.sort((a, b) => (Number(b.week) - Number(a.week)) || String(b.sheet).localeCompare(String(a.sheet), 'tr'));
  }

  function _decorateOrdersForPicker(orders, block, currentWeek, currentSheet) {
    return (orders || []).map((o) => _decoratePickerOrder(o, block, currentWeek, currentSheet));
  }

  /** Firma/malzeme araması: yalnızca aktif haftanın sheet'leri (eski hafta siparişleri hariç). */
  function _getAllArchivePickerOrders() {
    const currentWeek = state.week;
    const currentSheet = state.sheet;
    const out = [];
    const seenKeys = new Set();
    for (const block of state.weekArchive || []) {
      if (currentWeek != null && block.week !== currentWeek) continue;
      const isActiveSheet = block.week === currentWeek && block.sheet === currentSheet;
      const orders = isActiveSheet && (state.orders || []).length
        ? state.orders
        : (block.orders || []);
      for (const o of orders) {
        const pk = o.__archiveKey || `${block.week}:${block.sheet}:${o.__idx}`;
        if (seenKeys.has(pk)) continue;
        seenKeys.add(pk);
        out.push(_decoratePickerOrder(o, block, currentWeek, currentSheet));
      }
    }
    if (currentSheet && (state.orders || []).length) {
      for (const o of state.orders) {
        const pk = o.__archiveKey || `${currentWeek}:${currentSheet}:${o.__idx}`;
        if (seenKeys.has(pk)) continue;
        seenKeys.add(pk);
        out.push(_decoratePickerOrder(o, { week: currentWeek, sheet: currentSheet }, currentWeek, currentSheet));
      }
    }
    if (!out.length) return _getPickerSourceOrders();
    return out;
  }

  function _g1DateLabelFromBlock(block) {
    if (!block) return getPiyasaG1DateLabel();
    if (block.sheetDateRaw && !looksLikeExcelSerial(block.sheetDateRaw)) {
      return String(block.sheetDateRaw).trim();
    }
    if (block.sheetDate) {
      const d = new Date(block.sheetDate);
      if (!isNaN(d.getTime())) return formatDateUTCAsLocalString(d);
    }
    if (block.sheetDateRaw && looksLikeExcelSerial(block.sheetDateRaw)) {
      const d = parseExcelSerialString(block.sheetDateRaw);
      if (d) return formatDateUTCAsLocalString(d);
    }
    return '';
  }

  function _countPickerGpHp(orders) {
    let gp = 0;
    let hp = 0;
    for (const x of orders || []) {
      const t = getOrderSevkiyatTipi(x);
      if (t === 'Yİ-GP') gp++;
      else if (t === 'Yİ-HP') hp++;
    }
    return { gp, hp };
  }

  function _debounce(fn, waitMs) {
    let timer = null;
    return function debounced(...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), waitMs);
    };
  }

  function _resolvePickerFirmaAdi(o) {
    if (o.firmaAdi && String(o.firmaAdi).trim()) return String(o.firmaAdi).trim();
    return getFirmaFullName(String(o.firma || '').trim()) || '';
  }

  function _pickerEntrySearchHay(o, firmaAdi, sevkiyat) {
    return `${o.firma || ''} ${firmaAdi} ${o.malzeme || ''} ${o.sevkYeri || ''} ${o.il || ''} ${o.yuklemeTuru || ''} ${o.aciklama || ''} ${o.miktar || ''} ${o.odemeTuru || ''} ${o.org || ''} ${sevkiyat} ${o._weekLabel || ''}`.toLowerCase();
  }

  /** Sipariş seçici araması için önceden hesaplanmış metin (her tuşta getFirmaFullName çağrılmasın). */
  function _buildPickerSearchCache(sourceOrders) {
    const entries = new Array(sourceOrders.length);
    for (let i = 0; i < sourceOrders.length; i++) {
      const o = sourceOrders[i];
      const firmaAdi = _resolvePickerFirmaAdi(o);
      const sevkiyat = getOrderSevkiyatTipi(o);
      entries[i] = { o, firmaAdi, sevkiyat, hay: _pickerEntrySearchHay(o, firmaAdi, sevkiyat) };
    }
    return entries;
  }

  const PICKER_MAX_VISIBLE_ROWS = 250;
  const PICKER_SEARCH_DEBOUNCE_MS = 200;

  function getOrderPrintCount(o) {
    return Math.max(0, parseInt(o?.printCount, 10) || 0);
  }

  function formatPrintPlatesSummary(printPlates, maxItems) {
    const max = maxItems || 3;
    const entries = Object.entries(_normalizePrintPlates(printPlates)).sort((a, b) => b[1] - a[1]);
    if (!entries.length) return '';
    return entries.slice(0, max).map(([plate, count]) => (count > 1 ? `${plate}×${count}` : plate)).join(', ');
  }

  function formatOrderPrintWhen(ts) {
    if (!ts) return '';
    try {
      return new Date(ts).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' });
    } catch (e) {
      return new Date(ts).toLocaleString('tr-TR');
    }
  }

  function normMalzemeKey(s) {
    return String(s || '').trim().toUpperCase().replace(/\s+/g, ' ');
  }

  /** "MD1 / Eti Gümüş" → "MD1" (app.js getFirmaKodOnly ile uyumlu) */
  function firmaKodFromInput(s) {
    if (typeof window.getFirmaKodOnly === 'function') return window.getFirmaKodOnly(s);
    try { return String(s || '').split('/')[0].trim(); }
    catch (e) { return String(s || '').trim(); }
  }

  function normFirmaKey(s) {
    return String(firmaKodFromInput(s) || '').trim().toUpperCase();
  }

  /** HP2, HP3… — malzeme aynı; yükleme türü / şehir ile ayır */
  function isHpStyleFirma(firma) {
    return /^HP\d/i.test(normFirmaKey(firma));
  }

  function normYuklemeTuruKey(s) {
    return String(s || '').trim().toUpperCase().replace(/\s+/g, ' ');
  }

  function normSehirKey(s) {
    return String(s || '').trim().toUpperCase().replace(/\s+/g, ' ').replace(/\s*\/\s*/g, '/');
  }

  function orderSehirKey(order) {
    return normSehirKey(order && (order.il || order.sevkYeri || order.sehir || ''));
  }

  function normalizeHistoryRowInfo(raw) {
    const r = raw || {};
    return {
      firma: r.firma || r.firmaKodu || '',
      malzeme: r.malzeme || '',
      yuklemeTuru: r.yuklemeTuru || r.yukleme_turu || r.ambalajBilgisi || '',
      sevkYeri: r.sevkYeri || r.sevk_yeri || r.sehir || r.il || '',
      sevkiyatId: r.sevkiyatId || r.sevkiyat_id || '',
    };
  }

  function resolveOrderFromSevkiyatId(sevkiyatId) {
    const sid = String(sevkiyatId || '').trim();
    if (!sid.startsWith('piyasa:')) return null;
    const key = sid.slice(7);
    if (!key) return null;
    // Tam arşiv anahtarı: "22:22-HAFTA :40" — güvenilir
    if (key.includes(':')) return getOrderByIdx(key);
    // Eski "piyasa:40" — hafta/sheet yok, __idx çakışması yapmasın
    return null;
  }

  function hpOrderContextParts(order) {
    return {
      yuk: normYuklemeTuruKey(order && order.yuklemeTuru),
      sehir: orderSehirKey(order),
    };
  }

  /** HP: siparişteki yükleme türü VE şehir birlikte eşleşmeli (ikisi de varsa ikisi de). */
  function hpContextsMatch(wantOrder, got) {
    const want = hpOrderContextParts(wantOrder);
    if (!want.yuk && !want.sehir) return true;
    if (!got) return false;
    if (want.yuk) {
      if (!got.yuk || got.yuk !== want.yuk) return false;
    }
    if (want.sehir) {
      if (!got.sehir || got.sehir !== want.sehir) return false;
    }
    return true;
  }

  function contextPartsFromHistoryInfo(info) {
    const ctx = normalizeHistoryRowInfo(info);
    let yuk = normYuklemeTuruKey(ctx.yuklemeTuru);
    let sehir = normSehirKey(ctx.sevkYeri);
    if ((!yuk || !sehir) && ctx.sevkiyatId) {
      const linked = resolveOrderFromSevkiyatId(ctx.sevkiyatId);
      if (linked) {
        if (!yuk) yuk = normYuklemeTuruKey(linked.yuklemeTuru);
        if (!sehir) sehir = orderSehirKey(linked);
      }
    }
    return { yuk, sehir, sevkiyatId: ctx.sevkiyatId };
  }

  function hpStatsKeySuffix(parts) {
    const bits = [];
    if (parts.yuk) bits.push(`Y:${parts.yuk}`);
    if (parts.sehir) bits.push(`S:${parts.sehir}`);
    return bits.join('\x1e');
  }

  /** HP firmalarında yükleme türü + şehir; diğerlerinde malzeme */
  function matchesOrderContextForHistory(info, opts) {
    const order = opts && opts.order;
    const ctx = normalizeHistoryRowInfo(info);
    const firmaCode = normFirmaKey((opts && opts.firma) || (order && order.firma) || ctx.firma);

    if (order && isHpStyleFirma(firmaCode)) {
      const want = hpOrderContextParts(order);
      if (!want.yuk && !want.sehir) return true;
      const got = contextPartsFromHistoryInfo(info);
      if (!got.yuk && !got.sehir) return false;
      return hpContextsMatch(order, got);
    }

    const targetMal = normMalzemeKey((opts && opts.malzeme) || (order && order.malzeme) || '');
    if (!targetMal) return true;
    return normMalzemeKey(ctx.malzeme) === targetMal;
  }

  function orderPrintStatsKeyFromOrder(order) {
    const firma = normFirmaKey(order && order.firma);
    if (isHpStyleFirma(firma)) {
      const suffix = hpStatsKeySuffix(hpOrderContextParts(order));
      if (suffix) return `${firma}\x1e${suffix}`;
      const pickKey = getOrderPickKey(order);
      if (pickKey) return `${firma}\x1eI:${pickKey}`;
      return `${firma}\x1e*`;
    }
    return `${firma}\x1e${String((order && order.malzeme) || '').trim()}`;
  }

  function orderPrintStatsKeyFromEvent(d, ev) {
    const firma = normFirmaKey(d.firma || d.firmaKodu || d.firmaSelect || (ev && ev.firma) || '');
    if (isHpStyleFirma(firma)) {
      const got = contextPartsFromHistoryInfo({
        yuklemeTuru: d.yuklemeTuru || d.ambalajBilgisi || '',
        sevkYeri: d.sevkYeri || d.sehir || d.il || '',
        sevkiyatId: d.sevkiyat_id || (ev && ev.sevkiyat_id) || '',
      });
      const suffix = hpStatsKeySuffix(got);
      if (suffix) return `${firma}\x1e${suffix}`;
      return `${firma}\x1e*`;
    }
    return `${firma}\x1e${String(d.malzeme || (ev && ev.malzeme) || '').trim()}`;
  }

  function historyFilterHint(order) {
    if (!order) return '';
    if (isHpStyleFirma(order.firma)) {
      const bits = [];
      if (order.yuklemeTuru) bits.push('Yükleme: ' + order.yuklemeTuru);
      const sehir = orderSehirKey(order);
      if (sehir) bits.push('Şehir: ' + sehir);
      return bits.join(' · ') || 'Yükleme türü / şehre göre filtrelenir';
    }
    return order.malzeme ? `Malzeme: ${order.malzeme}` : '';
  }

  function matchesFirmaForOrder(firmaVal, opts) {
    const firmaFilter = normFirmaKey(opts && opts.firma);
    if (!firmaFilter) return true;
    const code = normFirmaKey(firmaVal);
    if (code && code === firmaFilter) return true;
    const adiFilter = String(opts.firmaAdi || '').trim().toUpperCase();
    if (!adiFilter) return false;
    const raw = String(firmaVal || '').trim().toUpperCase();
    if (raw === adiFilter) return true;
    const parts = String(firmaVal || '').split('/').map((x) => x.trim()).filter(Boolean);
    if (parts.length > 1) {
      const tail = parts.slice(1).join(' / ').toUpperCase();
      if (tail === adiFilter) return true;
    }
    try {
      const fromCode = getFirmaFullName(firmaFilter);
      if (fromCode && raw === String(fromCode).trim().toUpperCase()) return true;
    } catch (e) {}
    return false;
  }

  function collectReportPrintEventsDeduped() {
    const seen = new Set();
    const out = [];
    const lists = [];
    if (window.Report && typeof window.Report.getEvents === 'function') {
      lists.push(window.Report.getEvents() || []);
    }
    if (window.state && Array.isArray(window.state.reports)) {
      lists.push(window.state.reports);
    }
    lists.forEach((events) => {
      (events || []).forEach((ev) => {
        if (!ev || ev.type !== 'PRINT' || !ev.data) return;
        const d = ev.data || {};
        const dedupeKey = [
          ev.id || '',
          ev.ts || '',
          d.plaka || d.plate || '',
          d.malzeme || '',
          d.firma || d.firmaKodu || '',
        ].join('|');
        if (seen.has(dedupeKey)) return;
        seen.add(dedupeKey);
        out.push(ev);
      });
    });
    return out;
  }

  async function fetchPrintHistoryRows(malzeme, opts) {
    const order = opts && opts.order;
    const firmaQ = normFirmaKey(opts && opts.firma);
    const hpStyle = isHpStyleFirma(firmaQ);
    const malzemeQ = String(malzeme || '').trim();
    if (!hpStyle && !malzemeQ) return [];
    try {
      const params = new URLSearchParams({ limit: '500' });
      if (firmaQ) params.set('firma', firmaQ);
      if (!hpStyle && malzemeQ) params.set('malzeme', malzemeQ);
      // HP firmalarında eski kayıtlar yükleme/şehir içermeyebilir — filtre istemci tarafında
      const r = await fetch('/api/print_history?' + params.toString(), {
        credentials: 'include',
        cache: 'no-store',
      });
      if (!r.ok) return [];
      const rows = await r.json();
      if (!Array.isArray(rows)) return [];
      return rows.filter((row) =>
        matchesFirmaForOrder(row.firma, opts)
        && matchesOrderContextForHistory(row, opts)
      );
    } catch (e) {
      return [];
    }
  }

  function normPlateKey(s) {
    return String(s || '').trim().toUpperCase().replace(/[^A-Z0-9]/gi, '');
  }

  function normPlateForApi(s) {
    return String(s || '')
      .toLowerCase()
      .replace(/\s+/g, '')
      .replace(/[^a-z0-9ığüşöç]/gi, '');
  }

  function vehicleContactFromRecord(v) {
    if (!v || typeof v !== 'object') {
      return { dorse: '', sofor: '', sofor2: '', iletisim: '' };
    }
    const soforAdi = String(v.soforAdi || v.sofor || v.driverName || v.isim || v.name || '').trim();
    const soforSoyadi = String(v.soforSoyadi || v.driverSurname || v.soyisim || v.surname || '').trim();
    return {
      dorse: String(v.dorsePlaka || v.dorse || v.dorse_plaka || '').trim(),
      sofor: `${soforAdi} ${soforSoyadi}`.trim(),
      sofor2: `${v.sofor2Adi || ''} ${v.sofor2Soyadi || ''}`.trim(),
      iletisim: String(v.iletisim || v.phone || v.driverPhone || v.phoneNumber || '').trim(),
    };
  }

  function getLocalVehicleCaches() {
    const lists = [];
    if (window.state && Array.isArray(window.state.vehicles)) lists.push(window.state.vehicles);
    try {
      if (window.storage && typeof window.storage.loadAll === 'function') {
        const cached = window.storage.loadAll();
        if (Array.isArray(cached) && cached.length) lists.push(cached);
      }
    } catch (e) {}
    return lists;
  }

  function findVehicleByPlate(plate) {
    const key = normPlateKey(plate);
    if (!key) return null;
    for (const vehicles of getLocalVehicleCaches()) {
      const hit = vehicles.find((v) => {
        const plates = [v.cekiciPlaka, v.dorsePlaka, v.plaka].filter(Boolean);
        return plates.some((p) => normPlateKey(p) === key);
      });
      if (hit) return hit;
    }
    return null;
  }

  async function fetchVehiclesByPlates(plates) {
    const unique = [...new Set((plates || []).map((p) => String(p || '').trim()).filter(Boolean))];
    const out = {};
    unique.forEach((plate) => {
      const apiKey = normPlateForApi(plate);
      const local = findVehicleByPlate(plate);
      if (local) out[apiKey] = local;
    });

    const missing = unique.filter((plate) => !out[normPlateForApi(plate)]);
    if (!missing.length) return out;

    const BATCH = 40;
    for (let i = 0; i < missing.length; i += BATCH) {
      const chunk = missing.slice(i, i + BATCH);
      try {
        const res = await fetch('/api/vehicles/lookup-batch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ plates: chunk }),
        });
        if (!res.ok) throw new Error('batch lookup failed');
        const map = await res.json();
        Object.keys(map || {}).forEach((k) => {
          if (map[k]) out[k] = map[k];
        });
      } catch (e) {
        await Promise.all(chunk.map(async (plate) => {
          try {
            const res = await fetch('/api/vehicles/lookup?plate=' + encodeURIComponent(plate), {
              credentials: 'include',
            });
            if (!res.ok) return;
            const vehicle = await res.json();
            if (vehicle && typeof vehicle === 'object') {
              out[normPlateForApi(plate)] = vehicle;
            }
          } catch (err) { /* ignore */ }
        }));
      }
    }
    return out;
  }

  function applyVehicleContactToEntry(entry, contact) {
    if (!contact) return entry;
    return {
      ...entry,
      dorse: entry.dorse || contact.dorse || '',
      sofor: entry.sofor || contact.sofor || '',
      sofor2: entry.sofor2 || contact.sofor2 || '',
      iletisim: entry.iletisim || contact.iletisim || '',
    };
  }

  async function enrichMalzemeHistoryEntries(entries) {
    if (!entries.length) return entries;
    const vehicleMap = await fetchVehiclesByPlates(entries.map((e) => e.plate));
    return entries.map((entry) => {
      const vehicle = vehicleMap[normPlateForApi(entry.plate)] || findVehicleByPlate(entry.plate);
      return applyVehicleContactToEntry(entry, vehicleContactFromRecord(vehicle));
    });
  }

  function renderMalzemeHistoryRows(history, order) {
    if (!history.length) {
      const hint = historyFilterHint(order);
      const msg = isHpStyleFirma(order && order.firma)
        ? 'Bu yükleme türü / şehir için kayıtlı araç bulunamadı.'
        : 'Bu malzeme için kayıtlı araç bulunamadı.';
      return `<tr><td colspan="6" style="padding:20px;text-align:center;color:#64748b;">${escapeHtml(msg)}${hint ? `<div style="font-size:11px;margin-top:6px;">${escapeHtml(hint)}</div>` : ''}</td></tr>`;
    }
    return history.map((h) => `
      <tr>
        <td style="padding:8px 10px;border-bottom:1px solid #eee;font-weight:700;white-space:nowrap;">${escapeHtml(h.plate)}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #eee;">${escapeHtml(h.dorse || '—')}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #eee;">${escapeHtml(h.sofor || '—')}${h.sofor2 ? `<div style="font-size:11px;color:#64748b;">${escapeHtml(h.sofor2)}</div>` : ''}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #eee;white-space:nowrap;">${escapeHtml(h.iletisim || '—')}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #eee;text-align:center;">${h.count > 1 ? `<b>${h.count}×</b>` : '1'}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #eee;font-size:11px;color:#475569;">${escapeHtml(h.when || '—')}</td>
      </tr>
    `).join('');
  }

  function _ingestMalzemeHistoryIntoMap(map, malzeme, opts, ingestOpts) {
    const order = opts && opts.order;
    const hpStyle = isHpStyleFirma((opts && opts.firma) || (order && order.firma));
    const target = normMalzemeKey(malzeme);
    if (!target && !hpStyle) return;

    function upsert(plate, info) {
      const pk = normPlateKey(plate);
      if (!pk) return;
      const rowTs = Number(info.ts) || 0;
      if (rowTs && !isDurumCountTs(rowTs)) return;
      if (!matchesFirmaForOrder(info.firma, opts)) return;
      if (!matchesOrderContextForHistory(info, opts)) return;
      const displayPlate = String(plate || '').trim().toUpperCase();
      const cur = map.get(pk) || {
        plate: displayPlate,
        count: 0,
        lastTs: 0,
        firma: '',
        tonaj: '',
        sevkYeri: '',
        tarih: '',
        dorse: '',
        sofor: '',
        sofor2: '',
        iletisim: '',
      };
      const add = Math.max(1, parseInt(info.count, 10) || 1);
      if (info.add) cur.count += add;
      else cur.count = Math.max(cur.count, add);
      const ts = Number(info.ts) || 0;
      if (ts >= cur.lastTs) {
        cur.lastTs = ts;
        if (info.firma) cur.firma = info.firma;
        if (info.tonaj) cur.tonaj = info.tonaj;
        if (info.sevkYeri) cur.sevkYeri = info.sevkYeri;
        if (info.tarih) cur.tarih = info.tarih;
        if (info.dorse) cur.dorse = info.dorse;
        if (info.sofor) cur.sofor = info.sofor;
        if (info.sofor2) cur.sofor2 = info.sofor2;
        if (info.iletisim) cur.iletisim = info.iletisim;
      }
      map.set(pk, cur);
    }

    if (order && !isDurumFrozen()) {
      Object.entries(_normalizePrintPlates(order.printPlates)).forEach(([plate, count]) => {
        upsert(plate, {
          count,
          ts: order.lastPrintAt || 0,
          firma: order.firma || '',
          malzeme: order.malzeme || '',
          yuklemeTuru: order.yuklemeTuru || '',
          sevkYeri: order.il || order.sevkYeri || '',
        });
      });
    }

    (ingestOpts.printHistoryRows || []).forEach((row) => {
      if (!hpStyle && normMalzemeKey(row.malzeme) !== target) return;
      upsert(row.plaka, {
        add: true,
        count: 1,
        ts: Number(row.tarih) || 0,
        firma: row.firma || '',
        malzeme: row.malzeme || '',
        yuklemeTuru: row.yukleme_turu || row.yuklemeTuru || '',
        sevkYeri: row.sevk_yeri || row.sevkYeri || '',
        sevkiyatId: row.sevkiyat_id || '',
        sofor: row.sofor || '',
      });
    });

    collectReportPrintEventsDeduped().forEach((ev) => {
      const d = ev.data || {};
      if (!hpStyle && normMalzemeKey(d.malzeme) !== target) return;
      const evFirma = d.firma || d.firmaKodu || d.firmaSelect || '';
      if (!matchesFirmaForOrder(evFirma, opts)) return;
      upsert(d.plaka || d.plate || d.cekiciPlaka, {
        count: 1,
        add: true,
        ts: ev.ts || 0,
        firma: evFirma,
        malzeme: d.malzeme || '',
        yuklemeTuru: d.yuklemeTuru || d.ambalajBilgisi || '',
        sevkYeri: d.sevkYeri || '',
        sevkiyatId: d.sevkiyat_id || ev.sevkiyat_id || '',
        tonaj: d.tonaj || '',
        tarih: d.tarih || '',
        sofor: d.sofor || '',
      });
    });
  }

  function finalizeMalzemeHistoryMap(map) {
    return Array.from(map.values())
      .map((entry) => ({
        ...entry,
        when: entry.lastTs ? formatOrderPrintWhen(entry.lastTs) : (entry.tarih || ''),
      }))
      .sort((a, b) => (b.lastTs || 0) - (a.lastTs || 0));
  }

  function collectMalzemeVehicleHistorySync(malzeme, opts) {
    const map = new Map();
    _ingestMalzemeHistoryIntoMap(map, malzeme, opts, { printHistoryRows: [] });
    return finalizeMalzemeHistoryMap(map);
  }

  async function collectMalzemeVehicleHistory(malzeme, opts) {
    const printHistoryRows = await fetchPrintHistoryRows(malzeme, opts);
    const map = new Map();
    _ingestMalzemeHistoryIntoMap(map, malzeme, opts, { printHistoryRows });
    return finalizeMalzemeHistoryMap(map);
  }

  async function showMalzemeVehicleHistoryModal(order) {
    const malzeme = String(order?.malzeme || '').trim();
    const firmaCode = String(order?.firma || '').trim();
    const firmaAdi = (order?.firmaAdi && String(order.firmaAdi).trim())
      ? String(order.firmaAdi).trim()
      : (getFirmaFullName(firmaCode) || '');

    const overlay = document.createElement('div');
    overlay.style.cssText = piyasaOverlayStyle(PIYASA_Z_LAYER);
    overlay.innerHTML = `
      <div style="background:#fff;border-radius:14px;max-width:min(96vw,760px);width:100%;max-height:80vh;overflow:hidden;box-shadow:0 10px 30px rgba(0,0,0,.25);display:flex;flex-direction:column;">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:14px 16px;border-bottom:1px solid #eee;">
          <div style="min-width:0;">
            <div style="font-weight:900;font-size:15px;">Malzeme Araç Geçmişi</div>
            <div style="font-size:12px;color:#475569;margin-top:4px;line-height:1.4;">
              <b>${escapeHtml(malzeme || '—')}</b>${firmaAdi ? ` · ${escapeHtml(firmaAdi)}` : ''}
            </div>
            <div style="font-size:11px;color:#64748b;margin-top:2px;">${escapeHtml(
              isHpStyleFirma(firmaCode)
                ? `Bu firma (${firmaCode}) — ${historyFilterHint(order) || 'yükleme türü / şehre göre'} yazdırılan araçlar`
                : (firmaCode ? `Bu firma (${firmaCode}) ve malzeme için yazdırılan araçlar` : 'Daha önce bu malzemeyi saran / yazdırılan araçlar')
            )}</div>
          </div>
          <button type="button" id="piyasaHistoryClose" style="border:0;background:#eee;border-radius:10px;padding:6px 12px;cursor:pointer;flex-shrink:0;">Kapat</button>
        </div>
        <div style="padding:0 16px 16px;overflow:auto;flex:1;">
          <table style="width:100%;border-collapse:collapse;font-size:12px;">
            <thead>
              <tr style="background:#f8fafc;">
                <th style="text-align:left;padding:8px 10px;border-bottom:1px solid #e2e8f0;">Plaka</th>
                <th style="text-align:left;padding:8px 10px;border-bottom:1px solid #e2e8f0;">Dorse</th>
                <th style="text-align:left;padding:8px 10px;border-bottom:1px solid #e2e8f0;">Şoför</th>
                <th style="text-align:left;padding:8px 10px;border-bottom:1px solid #e2e8f0;">İletişim</th>
                <th style="text-align:center;padding:8px 10px;border-bottom:1px solid #e2e8f0;">Kez</th>
                <th style="text-align:left;padding:8px 10px;border-bottom:1px solid #e2e8f0;">Son</th>
              </tr>
            </thead>
            <tbody id="piyasaHistoryTbody">
              <tr><td colspan="6" style="padding:20px;text-align:center;color:#64748b;">Araç bilgileri yükleniyor…</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    `;
    markPiyasaModalLayer(overlay);
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    overlay.querySelector('#piyasaHistoryClose').onclick = close;
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    bindPiyasaOverlayEsc(overlay, close);

    const tbody = overlay.querySelector('#piyasaHistoryTbody');
    const historyOpts = { firma: firmaCode, firmaAdi, order };

    function renderHistorySafe(entries) {
      if (!tbody || !document.body.contains(overlay)) return;
      try {
        tbody.innerHTML = renderMalzemeHistoryRows(entries, order);
      } catch (err) {
        console.warn('Malzeme araç geçmişi çizilemedi:', err);
        tbody.innerHTML = '<tr><td colspan="6" style="padding:20px;text-align:center;color:#64748b;">Araç bilgileri gösterilemedi.</td></tr>';
      }
    }

    // Önce yerel/rapor önbelleğini göster (DB beklenirken takılmasın)
    try {
      renderHistorySafe(collectMalzemeVehicleHistorySync(malzeme, historyOpts));
    } catch (e) {
      console.warn('Malzeme araç geçmişi (yerel) yüklenemedi:', e);
    }

    try {
      const baseHistory = await collectMalzemeVehicleHistory(malzeme, historyOpts);
      const history = await enrichMalzemeHistoryEntries(baseHistory);
      renderHistorySafe(history);
    } catch (e) {
      console.warn('Malzeme araç geçmişi (sunucu) yüklenemedi:', e);
      try {
        renderHistorySafe(collectMalzemeVehicleHistorySync(malzeme, historyOpts));
      } catch (err) {
        renderHistorySafe([]);
      }
    }
  }

