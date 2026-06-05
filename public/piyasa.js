
/* PİYASA MODÜLÜ
   - Login ve mevcut İHRACAT Excel sistemine dokunmaz.
   - Araçlar menüsüne eklenen:
     #piyasaExcelUploadButtonTop / #piyasaExcelClearButtonTop
   - Excel yükleyince hafta sorar, siparişleri liste modalında gösterir,
     seçince form alanlarını doldurur.
*/
(function(){
  // Sayfa yenilense bile piyasa verisini kaybetmemek için localStorage kullanıyoruz.
  // (Login ve mevcut ihracat excel sistemine dokunmadan.)
  const STORAGE_KEY = 'piyasa_state_v1';
  const state = {
    orders: [],
    weekArchive: [],
    week: null,
    sheet: null,
    loadedAt: null,
    sheetDate: null,
    sheetDateRaw: null,
    fileFingerprint: null,
    lastImportReport: null,
    lastSkippedRows: [],
    _lastAppliedOrder: null,
  };

  let _localSyncTs = 0;
  let _syncInFlight = false;
  let _pickerRenderHook = null;

  const CUSTOMER_LIST_LS_KEY = 'piyasa_customer_list_cache_v2';
  const CUSTOMER_LIST_PASSWORD = '2026genper';
  const DURUM_RESET_EPOCH_LS = 'piyasa_durum_reset_epoch_v1';
  let _durumStatus = { frozen: false, freezeUntil: 0, resetEpoch: 0, message: '' };

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
    try { localStorage.removeItem('report_events_v1'); } catch (e) {}
    try {
      if (window.Report && typeof window.Report.clearEvents === 'function') window.Report.clearEvents();
    } catch (e) {}
    return true;
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
  let _customerStore = {
    customers: [],
    byKod: new Map(),
    searchIndex: [],
    updatedAt: 0,
    loaded: false,
    loading: false,
  };

  const PIYASA_MODAL_LAYER_ATTR = 'data-piyasa-modal-layer';
  const PIYASA_Z_BASE = 1000060;
  const PIYASA_Z_LAYER = 1000070;
  const PIYASA_Z_TOP = 1000080;

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
    const seen = new Set();
    const opts = [];
    const push = (week, sheet, orders, sheetDate, sheetDateRaw) => {
      if (!sheet) return;
      const key = _pickerSheetKey(week, sheet);
      if (seen.has(key)) return;
      seen.add(key);
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
      push(b.week, b.sheet, b.orders, b.sheetDate, b.sheetDateRaw);
    }
    if (state.sheet) {
      push(state.week, state.sheet, state.orders, state.sheetDate, state.sheetDateRaw);
    }
    return opts.sort((a, b) => (Number(b.week) - Number(a.week)) || String(b.sheet).localeCompare(String(a.sheet), 'tr'));
  }

  function _decorateOrdersForPicker(orders, block, currentWeek, currentSheet) {
    return (orders || []).map((o) => _decoratePickerOrder(o, block, currentWeek, currentSheet));
  }

  function _getAllArchivePickerOrders() {
    const currentWeek = state.week;
    const currentSheet = state.sheet;
    const out = [];
    const seenKeys = new Set();
    for (const block of state.weekArchive || []) {
      for (const o of block.orders || []) {
        const pk = o.__archiveKey || `${block.week}:${block.sheet}:${o.__idx}`;
        if (seenKeys.has(pk)) continue;
        seenKeys.add(pk);
        out.push(_decoratePickerOrder(o, block, currentWeek, currentSheet));
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

    if (order) {
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

    order.printCount = getOrderPrintCount(order) + 1;
    order.lastPrintAt = ts;
    if (plate) order.lastPrintPlate = plate;
    if (plate) {
      if (!order.printPlates || typeof order.printPlates !== 'object') order.printPlates = {};
      order.printPlates[plate] = (parseInt(order.printPlates[plate], 10) || 0) + 1;
      const keys = Object.keys(order.printPlates);
      if (keys.length > 8) {
        keys.sort((a, b) => order.printPlates[b] - order.printPlates[a]);
        const trimmed = {};
        keys.slice(0, 8).forEach((k) => { trimmed[k] = order.printPlates[k]; });
        order.printPlates = trimmed;
      }
    }

    if (state._lastAppliedOrder && getOrderPickKey(state._lastAppliedOrder) === getOrderPickKey(order)) {
      state._lastAppliedOrder.printCount = order.printCount;
      state._lastAppliedOrder.lastPrintAt = order.lastPrintAt;
      state._lastAppliedOrder.lastPrintPlate = order.lastPrintPlate;
      state._lastAppliedOrder.printPlates = { ...order.printPlates };
    }

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
      rec.count += 1;
      const ts = Number(ev.ts || d.ts || 0);
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

  // Excel'deki bazı satırlar filtre/gizli olabilir. Varsa !rows.hidden bilgisine göre ele.
  function filterHiddenRowsAoA(ws, table){
    try{
      const rowsMeta = ws && ws['!rows'];
      if (!rowsMeta || !Array.isArray(rowsMeta)) return table;
      const out = [];
      for (let i = 0; i < table.length; i++){
        const meta = rowsMeta[i];
        if (meta && meta.hidden) continue;
        out.push(table[i]);
      }
      return out;
    }catch(e){
      return table;
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
    // Bu yüzden sheet'i önce tablo (array-of-arrays) olarak okuyup başlık satırını buluyoruz.
    let table = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    table = filterHiddenRowsAoA(ws, table);
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

    // Eğer hiç başlık bulamadıysa, klasik json'a dön.
    if (bestScore < 2 || headerRowIndex < 0){
      return XLSX.utils.sheet_to_json(ws, { defval: '' });
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
      out.push(obj);
    }
    out.__parseMeta = { firmaAdiColIndex, miktarUnit, templateValidation, headerRow: header, headerRowIndex };
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

  function excelRowNumber(parseMeta, dataRowIndex) {
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
          excelRow: excelRowNumber(meta, idx),
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

    const report = {
      totalRaw: rows.filter((r) => !(r && r.__parseMeta)).length,
      accepted: orders.length,
      totalSkipped: skipped.length,
      byReason: eu().summarizeSkipped ? eu().summarizeSkipped(skipped) : {},
      skippedRows: skipped,
      template: meta.templateValidation || null,
      miktarUnit: unit,
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
    if (norm.report && norm.report.totalSkipped > 0) showPiyasaImportReportModal(norm.report);
    else if (norm.report && norm.report.template && !norm.report.template.ok) showPiyasaImportReportModal(norm.report);
    return norm;
  }

  function showPiyasaImportReportModal(report) {
    if (!report) return;
    const labels = (eu().SKIP_REASON_LABELS) || {};
    let lines = `<p><b>${report.accepted}</b> sipariş yüklendi. <b>${report.totalSkipped}</b> satır elendi.</p>`;
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

      // HIZLI: tüm sheet'i JSON'a çevirmeden yaklaşık satır sayısı al
      let approxRows = 0;
      try{
        const ws = wb.Sheets[name];
        const ref = ws && ws['!ref'];
        if (ref && XLSX?.utils?.decode_range){
          const range = XLSX.utils.decode_range(ref);
          approxRows = (range.e.r - range.s.r + 1) || 0;
        }
      }catch(e){
        approxRows = 0;
      }

      metas.push({ name, week, count: approxRows, approx: true, orderIndex: i });
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
        state.weekArchive = buildWeekArchive(wb);
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
    const plate = (document.getElementById('cekiciPlaka') || {}).value || '';
    applyOrderToForm(o, { forceReuse: true });
    markOrderUsed(o, plate);
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
    if (!o) return;
    o.usedAt = Date.now();
    o.usedPlate = String(plate || '').trim();
    state._lastAppliedOrder = o;
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

  function _isHeaderLikeCustomer(c) {
    if (!c) return true;
    const k = String(c.kod || '').toUpperCase();
    const a = String(c.ad || '').toUpperCase();
    return /^(KOD|MÜŞTERİ KODU|MUSTERI KODU)$/.test(k)
      || (/^(AD|CARİ UNVAN|CARI UNVAN)$/.test(a) && /^(KOD|MÜŞTERİ KODU|MUSTERI KODU)$/.test(k));
  }

  function _normalizeCustomerEntry(raw, index) {
    if (!raw || typeof raw !== 'object') return null;
    const kod = String(raw.kod || '').trim();
    if (!kod) return null;
    const c = {
      id: raw.id != null && String(raw.id).trim() !== '' ? String(raw.id).trim() : `row-${(index || 0) + 1}`,
      kod,
      ad: String(raw.ad || '').trim(),
      urunTipi: String(raw.urunTipi || '').trim(),
      sektor: String(raw.sektor || '').trim(),
      il: String(raw.il || '').trim(),
      adres: String(raw.adres || '').trim(),
      ambalaj: String(raw.ambalaj || '').trim(),
    };
    if (_isHeaderLikeCustomer(c)) return null;
    return c;
  }

  function _rebuildCustomerStore(customers, updatedAt, source) {
    const list = [];
    const byKod = new Map();
    const searchIndex = [];
    for (let i = 0; i < (customers || []).length; i++) {
      const c = _normalizeCustomerEntry(customers[i], i);
      if (!c) continue;
      list.push(c);
      const key = c.kod.toUpperCase();
      if (!byKod.has(key)) byKod.set(key, c);
      searchIndex.push({
        c,
        hay: `${c.kod} ${c.ad} ${c.il} ${c.sektor} ${c.urunTipi} ${c.adres} ${c.ambalaj}`.toLowerCase(),
      });
    }
    _customerStore = {
      customers: list,
      byKod,
      searchIndex,
      updatedAt: updatedAt || Date.now(),
      source: source || _customerStore.source || '',
      loaded: true,
      loading: false,
    };
    try {
      localStorage.setItem(CUSTOMER_LIST_LS_KEY, JSON.stringify({
        updatedAt: _customerStore.updatedAt,
        source: _customerStore.source,
        customers: list,
      }));
    } catch (_) {}
    return list;
  }

  function _loadCustomersFromLocalCache() {
    try {
      const raw = localStorage.getItem(CUSTOMER_LIST_LS_KEY);
      if (!raw) return false;
      const payload = JSON.parse(raw);
      if (!payload || !Array.isArray(payload.customers) || !payload.customers.length) return false;
      _rebuildCustomerStore(payload.customers, payload.updatedAt, payload.source);
      return true;
    } catch (_) {
      return false;
    }
  }

  async function loadPiyasaCustomers(force) {
    if (_customerStore.loading) return _customerStore.customers;
    if (_customerStore.loaded && !force) return _customerStore.customers;
    if (!_customerStore.loaded && !force) _loadCustomersFromLocalCache();
    _customerStore.loading = true;
    try {
      const resp = await fetch('/api/piyasa/customers?_=' + Date.now(), {
        method: 'GET',
        credentials: 'include',
        headers: { 'Cache-Control': 'no-cache' },
      });
      if (resp.ok) {
        const payload = await resp.json().catch(() => null);
        if (payload && Array.isArray(payload.customers) && payload.customers.length) {
          const rebuilt = _rebuildCustomerStore(payload.customers, payload.updatedAt, payload.source);
          if (!force && payload.customers.length > rebuilt.length) {
            console.warn('Piyasa müşteri listesi sunucuda daha fazla satır içeriyor, tam liste yüklendi.');
          }
          return rebuilt;
        }
      }
    } catch (e) {
      console.warn('Piyasa müşteri listesi yüklenemedi:', e);
    } finally {
      _customerStore.loading = false;
      _customerStore.loaded = true;
    }
    return _customerStore.customers;
  }

  async function savePiyasaCustomers(customers, source) {
    const list = _rebuildCustomerStore(customers, Date.now(), source || _customerStore.source || 'manual');
    const resp = await fetch('/api/piyasa/customers', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: source || _customerStore.source || 'manual',
        customers: list,
      }),
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.error || 'Müşteri listesi kaydedilemedi');
    }
    return list;
  }

  function getPiyasaCustomerByKod(kod) {
    const key = String(kod || '').trim().toUpperCase();
    if (!key) return null;
    return _customerStore.byKod.get(key) || null;
  }

  function openPiyasaCustomerListModal() {
    const overlay = document.createElement('div');
    overlay.style.cssText = piyasaOverlayStyle(PIYASA_Z_LAYER);
    markPiyasaModalLayer(overlay);
    overlay.innerHTML = `
      <div style="position:relative;z-index:1;background:#fff;border-radius:14px;max-width:min(96vw,920px);width:100%;max-height:88vh;overflow:hidden;box-shadow:0 10px 30px rgba(0,0,0,.25);display:flex;flex-direction:column;">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 14px;border-bottom:1px solid #eee;flex-wrap:wrap;">
          <div>
            <div style="font-weight:900;font-size:16px;">Piyasa Müşteri / Bayi Listesi</div>
            <div id="piyasaCustMeta" style="font-size:12px;color:#666;margin-top:2px;">Yükleniyor…</div>
          </div>
          <button type="button" id="piyasaCustClose" style="border:0;background:#eee;border-radius:10px;padding:6px 10px;cursor:pointer;">Kapat</button>
        </div>
        <div style="padding:10px 14px;display:flex;gap:10px;align-items:center;border-bottom:1px solid #eee;flex-wrap:wrap;">
          <input id="piyasaCustSearch" placeholder="Kod, ad, il, sektör ara…" style="flex:1;min-width:220px;padding:10px;border:1px solid #ddd;border-radius:10px;outline:none;box-shadow:none;">
          <button type="button" id="piyasaCustAddBtn" style="border:0;background:#111827;color:#fff;border-radius:10px;padding:9px 14px;font-size:13px;font-weight:700;cursor:pointer;">+ Ekle</button>
        </div>
        <div id="piyasaCustAddForm" style="display:none;padding:10px 14px;border-bottom:1px solid #eee;background:#f8fafc;">
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px;">
            <input id="piyasaCustNewKod" placeholder="Kod *" style="padding:8px;border:1px solid #ddd;border-radius:8px;">
            <input id="piyasaCustNewAd" placeholder="Ad / Firma *" style="padding:8px;border:1px solid #ddd;border-radius:8px;">
            <input id="piyasaCustNewIl" placeholder="İl" style="padding:8px;border:1px solid #ddd;border-radius:8px;">
            <input id="piyasaCustNewSektor" placeholder="Sektör" style="padding:8px;border:1px solid #ddd;border-radius:8px;">
          </div>
          <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px;">
            <button type="button" id="piyasaCustAddCancel" style="border:0;background:#eee;border-radius:8px;padding:8px 12px;cursor:pointer;">İptal</button>
            <button type="button" id="piyasaCustAddSave" style="border:0;background:#4f46e5;color:#fff;border-radius:8px;padding:8px 12px;cursor:pointer;font-weight:700;">Kaydet</button>
          </div>
        </div>
        <div style="padding:0 14px 0;border-bottom:1px solid #eee;background:#f6f6f6;">
          <table style="width:100%;border-collapse:collapse;font-size:12px;table-layout:fixed;">
            <colgroup><col style="width:14%"><col style="width:38%"><col style="width:14%"><col style="width:24%"><col style="width:10%"></colgroup>
            <thead>
              <tr>
                <th style="text-align:left;padding:8px;border:1px solid #eee;">KOD</th>
                <th style="text-align:left;padding:8px;border:1px solid #eee;">AD</th>
                <th style="text-align:left;padding:8px;border:1px solid #eee;">İL</th>
                <th style="text-align:left;padding:8px;border:1px solid #eee;">SEKTÖR</th>
                <th style="text-align:center;padding:8px;border:1px solid #eee;">SİL</th>
              </tr>
            </thead>
          </table>
        </div>
        <div id="piyasaCustTableWrap" style="padding:0 14px 14px;overflow:auto;flex:1;min-height:0;-webkit-overflow-scrolling:touch;">
          <div id="piyasaCustVirtualInner" style="position:relative;width:100%;">
            <table id="piyasaCustVirtualTable" style="position:absolute;left:0;right:0;width:100%;border-collapse:collapse;font-size:12px;table-layout:fixed;">
              <colgroup><col style="width:14%"><col style="width:38%"><col style="width:14%"><col style="width:24%"><col style="width:10%"></colgroup>
              <tbody id="piyasaCustTbody"></tbody>
            </table>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const close = () => overlay.remove();
    overlay.querySelector('#piyasaCustClose').onclick = close;
    bindPiyasaOverlayEsc(overlay, close);

    const metaEl = overlay.querySelector('#piyasaCustMeta');
    const searchEl = overlay.querySelector('#piyasaCustSearch');
    const scrollWrap = overlay.querySelector('#piyasaCustTableWrap');
    const virtualInner = overlay.querySelector('#piyasaCustVirtualInner');
    const virtualTable = overlay.querySelector('#piyasaCustVirtualTable');
    const tbody = overlay.querySelector('#piyasaCustTbody');
    const addForm = overlay.querySelector('#piyasaCustAddForm');
    const addBtn = overlay.querySelector('#piyasaCustAddBtn');
    const addCancel = overlay.querySelector('#piyasaCustAddCancel');
    const addSave = overlay.querySelector('#piyasaCustAddSave');

    const CUST_ROW_H = 38;
    const CUST_ROW_BUFFER = 10;
    let custFilteredRows = _customerStore.searchIndex;
    let custScrollRaf = 0;

    function getCustFilteredRows(filter) {
      const f = String(filter || '').trim().toLowerCase();
      if (!f) return _customerStore.searchIndex;
      return _customerStore.searchIndex.filter((e) => e.hay.includes(f));
    }

    function custRowHtml(entry) {
      const c = entry.c;
      return `<tr style="height:${CUST_ROW_H}px;">
        <td style="padding:7px 8px;border:1px solid #eee;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${escapeHtml(c.kod)}">${escapeHtml(c.kod)}</td>
        <td style="padding:7px 8px;border:1px solid #eee;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHtml(c.ad || '')}">${escapeHtml(c.ad || '—')}</td>
        <td style="padding:7px 8px;border:1px solid #eee;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHtml(c.il || '')}">${escapeHtml(c.il || '—')}</td>
        <td style="padding:7px 8px;border:1px solid #eee;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHtml(c.sektor || c.urunTipi || '')}">${escapeHtml(c.sektor || c.urunTipi || '—')}</td>
        <td style="padding:7px 8px;border:1px solid #eee;text-align:center;">
          <button type="button" data-del-id="${escapeHtml(String(c.id))}" style="border:0;background:#fee2e2;color:#b91c1c;border-radius:6px;padding:4px 8px;font-size:11px;cursor:pointer;">Sil</button>
        </td>
      </tr>`;
    }

    function updateCustMeta(filter, matchCount) {
      const total = _customerStore.customers.length;
      const f = String(filter || '').trim();
      metaEl.textContent = f
        ? `${matchCount} eşleşme · toplam ${total} kayıt`
        : `${total} kayıt · kaydırarak gezin`;
    }

    function renderCustomersVirtual(filter, scrollTop) {
      custFilteredRows = getCustFilteredRows(filter);
      const totalMatches = custFilteredRows.length;
      updateCustMeta(filter, totalMatches);

      if (!totalMatches) {
        virtualInner.style.height = '120px';
        virtualTable.style.top = '0px';
        tbody.innerHTML = `<tr><td colspan="5" style="padding:16px;text-align:center;color:#666;">Kayıt bulunamadı</td></tr>`;
        return;
      }

      const viewH = Math.max(scrollWrap.clientHeight || 0, 320);
      const st = Math.max(0, Number(scrollTop) || 0);
      const start = Math.max(0, Math.floor(st / CUST_ROW_H) - CUST_ROW_BUFFER);
      const visibleCount = Math.ceil(viewH / CUST_ROW_H) + (CUST_ROW_BUFFER * 2);
      const end = Math.min(totalMatches, start + visibleCount);

      virtualInner.style.height = `${totalMatches * CUST_ROW_H}px`;
      virtualTable.style.top = `${start * CUST_ROW_H}px`;

      const parts = [];
      for (let i = start; i < end; i++) parts.push(custRowHtml(custFilteredRows[i]));
      tbody.innerHTML = parts.join('');
    }

    function scheduleCustRender(resetScroll) {
      if (resetScroll) scrollWrap.scrollTop = 0;
      if (custScrollRaf) cancelAnimationFrame(custScrollRaf);
      const run = () => {
        custScrollRaf = 0;
        renderCustomersVirtual(searchEl.value, scrollWrap.scrollTop);
      };
      custScrollRaf = requestAnimationFrame(() => {
        run();
        requestAnimationFrame(run);
      });
    }

    scrollWrap.addEventListener('scroll', () => {
      if (custScrollRaf) return;
      custScrollRaf = requestAnimationFrame(() => {
        custScrollRaf = 0;
        renderCustomersVirtual(searchEl.value, scrollWrap.scrollTop);
      });
    }, { passive: true });

    tbody.addEventListener('click', async (e) => {
      const btn = e.target.closest('button[data-del-id]');
      if (!btn) return;
      const id = btn.getAttribute('data-del-id');
      if (!id) return;
      const row = _customerStore.customers.find((c) => String(c.id) === String(id));
      const label = row ? `${row.kod} — ${row.ad || ''}` : id;
      const ui = window.rpUi || {};
      let ok = false;
      if (typeof ui.confirm === 'function') {
        ok = await ui.confirm(`Bu satırı silmek istiyor musunuz?\n${label}`, { okLabel: 'Sil' });
      } else {
        ok = window.confirm(`Bu satırı silmek istiyor musunuz?\n${label}`);
      }
      if (!ok) return;
      const pwdOk = await verifyCustomerListPassword('Silme şifresini giriniz:');
      if (!pwdOk) return;
      btn.disabled = true;
      try {
        const next = _customerStore.customers.filter((c) => String(c.id) !== String(id));
        await savePiyasaCustomers(next);
        scheduleCustRender(false);
        toast('Kayıt silindi', 'success');
      } catch (err) {
        alert('❌ ' + (err.message || 'Silinemedi'));
        btn.disabled = false;
      }
    });

    addBtn.onclick = () => { addForm.style.display = 'block'; overlay.querySelector('#piyasaCustNewKod')?.focus(); };
    addCancel.onclick = () => { addForm.style.display = 'none'; };
    addSave.onclick = async () => {
      const entry = _normalizeCustomerEntry({
        kod: overlay.querySelector('#piyasaCustNewKod')?.value,
        ad: overlay.querySelector('#piyasaCustNewAd')?.value,
        il: overlay.querySelector('#piyasaCustNewIl')?.value,
        sektor: overlay.querySelector('#piyasaCustNewSektor')?.value,
      });
      if (!entry || !entry.ad) {
        alert('Kod ve ad zorunludur.');
        return;
      }
      const pwdOk = await verifyCustomerListPassword('Ekleme şifresini giriniz:');
      if (!pwdOk) return;
      addSave.disabled = true;
      try {
        entry.id = `manual-${Date.now()}`;
        const next = _customerStore.customers.slice();
        next.unshift(entry);
        await savePiyasaCustomers(next);
        addForm.style.display = 'none';
        ['#piyasaCustNewKod', '#piyasaCustNewAd', '#piyasaCustNewIl', '#piyasaCustNewSektor'].forEach((sel) => {
          const el = overlay.querySelector(sel);
          if (el) el.value = '';
        });
        scheduleCustRender(true);
        toast('Müşteri eklendi', 'success');
      } catch (err) {
        alert('❌ ' + (err.message || 'Eklenemedi'));
      } finally {
        addSave.disabled = false;
      }
    };

    const renderDebounced = _debounce(() => scheduleCustRender(true), 120);
    searchEl.oninput = () => renderDebounced();

    setTimeout(() => searchEl.focus(), 0);

    if (_customerStore.customers.length) {
      scheduleCustRender(true);
      loadPiyasaCustomers(false).then(() => scheduleCustRender(false)).catch(() => {});
    } else {
      metaEl.textContent = 'Liste yükleniyor…';
      loadPiyasaCustomers(false).then(() => {
        scheduleCustRender(true);
      }).catch(() => {
        metaEl.textContent = 'Liste yüklenemedi';
      });
    }
  }

  // Map a firma code to a human-friendly firma name using müşteri listesi + `firmaListesi`
  function getFirmaFullName(code){
    try{
      const k = String(code||'').trim();
      if (!k) return '';
      const cust = getPiyasaCustomerByKod(k);
      if (cust && cust.ad) return cust.ad;
      const list = (window.firmaListesi && Array.isArray(window.firmaListesi)) ? window.firmaListesi : (typeof firmaListesi !== 'undefined' && Array.isArray(firmaListesi) ? firmaListesi : []);
      // Try exact or prefix match (e.g. 'HP3' matches 'HP3 / BOZÜYÜK')
      for (const entry of list){
        if (!entry) continue;
        const e = String(entry||'').trim();
        if (!e) continue;
        // normalize
        const up = e.toUpperCase();
        const kc = k.toUpperCase();
        const parts = e.split('/').map(x=>x.trim()).filter(Boolean);
        const left = parts[0] || e;
        const right = parts.length > 1 ? parts.slice(1).join(' / ').trim() : '';
        if (String(left).toUpperCase() === kc) return right || e;
        // allow left starting with code (e.g. 'HP3  / ...')
        if (String(left).toUpperCase().startsWith(kc)) return right || e;
        // also allow entry to contain code somewhere
        if (up.includes(kc)) return right || e;
      }
    }catch(e){}
    return '';
  }


  function getPiyasaG1DateLabel() {
    if (state.sheetDateRaw && !looksLikeExcelSerial(state.sheetDateRaw)) {
      return String(state.sheetDateRaw).trim();
    }
    if (state.sheetDate) {
      const d = new Date(state.sheetDate);
      if (!isNaN(d.getTime())) return formatDateUTCAsLocalString(d);
    }
    if (state.sheetDateRaw && looksLikeExcelSerial(state.sheetDateRaw)) {
      const d = parseExcelSerialString(state.sheetDateRaw);
      if (d) return formatDateUTCAsLocalString(d);
    }
    if (state.loadedAt instanceof Date && !isNaN(state.loadedAt.getTime())) {
      return formatDateUTCAsLocalString(state.loadedAt);
    }
    return '';
  }

  function _piyasaPrintFitScript() {
    return `<script id="piyasa-print-fit">
(function () {
  function doPrint() {
    try { window.focus(); window.print(); } catch (e) {}
  }
  if (document.readyState === 'complete') setTimeout(doPrint, 300);
  else window.addEventListener('load', function () { setTimeout(doPrint, 300); }, { once: true });
})();
</script>`;
  }

  function launchPiyasaPrintDocument(printHtml) {
    const html = printHtml.includes('piyasa-print-fit')
      ? printHtml
      : printHtml.replace('</body>', `${_piyasaPrintFitScript()}</body>`);

    // 281mm yazdırılabilir genişlik ≈ 1061px (A4 yatay, 8mm kenar)
    const PRINT_W = Math.round((281 * 96) / 25.4);
    const PRINT_H = Math.round((194 * 96) / 25.4);
    const frameStyle = `position:fixed;left:0;top:0;width:${PRINT_W}px;height:${PRINT_H}px;border:0;margin:0;padding:0;opacity:0;pointer-events:none;z-index:-9999;overflow:visible;`;
    let frame = document.getElementById('piyasaOrderPrintFrame');
    if (!frame) {
      frame = document.createElement('iframe');
      frame.id = 'piyasaOrderPrintFrame';
      frame.setAttribute('aria-hidden', 'true');
      frame.setAttribute('title', 'Piyasa yazdırma');
      document.body.appendChild(frame);
    }
    frame.style.cssText = frameStyle;
    const doc = frame.contentWindow.document;
    doc.open();
    doc.write(html);
    doc.close();
  }

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
      ? `<div style="padding:8px 14px;background:#fef3c7;color:#92400e;font-size:12px;font-weight:700;border-bottom:1px solid #fde68a;">⏸ DURUM sıfır — ${escapeHtml(_durumStatus.message)}</div>`
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
              ? `<div style="font-size:12px;color:#4338ca;font-weight:700;white-space:nowrap;">Tüm sayfalarda ara</div>`
              : `<label style="font-size:12px;color:#666;display:flex;align-items:center;gap:6px;white-space:nowrap;">
                  <span>Sheet:</span>
                  <select id="piyasaPickerSheet" style="padding:6px 8px;border:1px solid #ddd;border-radius:8px;font-size:12px;font-weight:700;max-width:min(42vw,240px);cursor:pointer;"></select>
                </label>`}
            <button id="piyasaModalClose" style="border:0;background:#eee;border-radius:10px;padding:6px 10px;cursor:pointer;">Kapat</button>
          </div>
        </div>
        <div style="padding:10px 14px;display:flex;gap:10px;align-items:center;border-bottom:1px solid #eee;flex-wrap:wrap;">
          <input id="piyasaSearch" placeholder="${searchAllSheets ? 'Firma / Malzeme / İl ara… (tüm sayfalar)' : 'Firma / Malzeme / İl ara… (seçili sheet)'}" style="flex:1;min-width:200px;padding:10px;border:1px solid #ddd;border-radius:10px;">
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
        ? ' • tüm sayfalar'
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
      wb = XLSX.read(ab, {
        type: 'array',
        cellStyles: false,
        cellNF: false,
        cellText: false,
        dense: true
      });

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

  
  // Dışarıya minimal API aç (app.js Bul butonu buradan çağıracak)
  window.piyasa = window.piyasa || {};
  window.piyasa.hasOrders = ()=> (state.orders && state.orders.length > 0);
  window.piyasa.openOrderPicker = openOrderPicker;
  window.piyasa.closeOrderPicker = function closeOrderPicker() {
    if (typeof window.__piyasaCloseOrderPicker === 'function') window.__piyasaCloseOrderPicker();
    else document.getElementById('piyasaModalClose')?.click();
  };
  window.piyasa.applyOrderToForm = applyOrderToForm;
  window.piyasa.applyOrderFromPicker = applyOrderFromPicker;
  window.piyasa.maybePromptAracBosuBeforePrint = maybePromptAracBosuBeforePrint;
  window.piyasa.isHpFirma = isHpFirma;
  window.piyasa.promptAracBosuTonaj = promptAracBosuTonaj;
  window.piyasa.applyAracBosuToForm = applyAracBosuToForm;
  window.piyasa._state = state;
  window.piyasa.suggestForContext = suggestPiyasaForContext;
  window.piyasa.showSuggestionBar = showPiyasaSuggestionBar;
  window.piyasa.markOrderUsed = markOrderUsed;
  window.piyasa.recordOrderPrint = recordOrderPrint;
  window.piyasa.isDurumFrozen = isDurumFrozen;
  window.piyasa.refreshDurumStatus = refreshDurumStatus;
  window.piyasa.clearAllOrderPrintStats = clearAllOrderPrintStatsInState;
  window.piyasa.reconcileOrderPrintCountsFromReports = reconcileOrderPrintCountsFromReports;
  window.piyasa.getActiveOrderIdx = getActiveOrderIdx;
  window.piyasa.getOrderByIdx = getOrderByIdx;
  window.piyasa.showSkippedRows = showPiyasaSkippedRowsModal;
  window.piyasa.syncFromServer = syncPiyasaFromServer;
  window.piyasa.loadCustomers = loadPiyasaCustomers;
  window.piyasa.openCustomerList = openPiyasaCustomerListModal;
  window.piyasa.getCustomerByKod = getPiyasaCustomerByKod;

  // Chip'ten çağrılmak için modal açma fonksiyonu
  window.piyasaShowOrdersModal = function() {
    if (!state.orders || !state.orders.length) {
      try { loadState(); } catch (e) {}
    }
    if (state.orders && state.orders.length > 0) {
      openOrderPicker();
      return;
    }
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const payload = JSON.parse(raw);
        if (applyPayloadToState(payload, { force: true }) && state.orders.length > 0) {
          openOrderPicker();
          return;
        }
      }
    } catch (e) {}
    alert('❌ PİYASA Excel yüklü değil ya da sipariş yok.');
  };

window.initPiyasaModule = init;
})();
