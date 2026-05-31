
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

  function _getPickerSourceOrders(includeAllWeeks) {
    const currentWeek = state.week;
    const currentSheet = state.sheet;
    if (!includeAllWeeks) {
      return (state.orders || []).map((o) => _decoratePickerOrder(o, { week: currentWeek, sheet: currentSheet }, currentWeek, currentSheet));
    }
    const archive = state.weekArchive || [];
    if (archive.length) {
      const out = [];
      for (const block of archive) {
        for (const o of block.orders || []) {
          out.push(_decoratePickerOrder(o, block, currentWeek, currentSheet));
        }
      }
      return out;
    }
    return (state.orders || []).map((o) => _decoratePickerOrder(o, { week: currentWeek, sheet: currentSheet }, currentWeek, currentSheet));
  }

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

  function renderMalzemeHistoryRows(history) {
    if (!history.length) {
      return `<tr><td colspan="6" style="padding:20px;text-align:center;color:#64748b;">Bu malzeme için kayıtlı araç bulunamadı.</td></tr>`;
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

  function collectMalzemeVehicleHistory(malzeme) {
    const target = normMalzemeKey(malzeme);
    if (!target) return [];
    const map = new Map();

    function upsert(plate, info) {
      const pk = normPlateKey(plate);
      if (!pk) return;
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
      cur.count = Math.max(cur.count, Math.max(1, parseInt(info.count, 10) || 1));
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

    _getPickerSourceOrders(true).forEach((o) => {
      if (normMalzemeKey(o.malzeme) !== target) return;
      Object.entries(_normalizePrintPlates(o.printPlates)).forEach(([plate, count]) => {
        upsert(plate, {
          count,
          ts: o.lastPrintAt || 0,
          firma: o.firma || '',
        });
      });
    });

    try {
      const reportLists = [];
      if (window.Report && typeof window.Report.getEvents === 'function') {
        reportLists.push(window.Report.getEvents() || []);
      }
      if (window.state && Array.isArray(window.state.reports)) {
        reportLists.push(window.state.reports);
      }
      reportLists.forEach((events) => {
        (events || []).filter((ev) => ev && ev.type === 'PRINT' && ev.data).forEach((ev) => {
          const d = ev.data || {};
          if (normMalzemeKey(d.malzeme) !== target) return;
          upsert(d.plaka || d.plate || d.cekiciPlaka, {
            ts: ev.ts || 0,
            firma: d.firma || d.firmaKodu || d.firmaSelect || '',
            tonaj: d.tonaj || '',
            sevkYeri: d.sevkYeri || '',
            tarih: d.tarih || '',
          });
        });
      });
    } catch (e) {}

    try {
      (window.state?.vehicles || []).forEach((v) => {
        const snap = v.lastPrintSnapshot;
        if (!snap) return;
        if ((Number(v.printCount || 0) || 0) <= 0) return;
        const m = normMalzemeKey(snap.malzeme || v.defaultMalzeme);
        if (m !== target) return;
        const contact = vehicleContactFromRecord(v);
        upsert(v.cekiciPlaka, {
          ts: Number(snap.ts || snap.timestamp || 0),
          firma: snap.firmaKodu || snap.firmaSelect || v.defaultFirma || '',
          tonaj: snap.tonaj || '',
          sevkYeri: snap.sevkYeri || v.defaultSevkYeri || '',
          tarih: snap.tarih || '',
          dorse: contact.dorse,
          sofor: contact.sofor,
          sofor2: contact.sofor2,
          iletisim: contact.iletisim,
        });
      });
    } catch (e) {}

    return Array.from(map.values())
      .map((entry) => ({
        ...entry,
        when: entry.lastTs ? formatOrderPrintWhen(entry.lastTs) : (entry.tarih || ''),
      }))
      .sort((a, b) => (b.lastTs || 0) - (a.lastTs || 0));
  }

  async function showMalzemeVehicleHistoryModal(order) {
    const malzeme = String(order?.malzeme || '').trim();
    const firmaCode = String(order?.firma || '').trim();
    const firmaAdi = (order?.firmaAdi && String(order.firmaAdi).trim())
      ? String(order.firmaAdi).trim()
      : (getFirmaFullName(firmaCode) || '');

    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:100001;display:flex;align-items:center;justify-content:center;padding:16px;';
    overlay.innerHTML = `
      <div style="background:#fff;border-radius:14px;max-width:min(96vw,760px);width:100%;max-height:80vh;overflow:hidden;box-shadow:0 10px 30px rgba(0,0,0,.25);display:flex;flex-direction:column;">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:14px 16px;border-bottom:1px solid #eee;">
          <div style="min-width:0;">
            <div style="font-weight:900;font-size:15px;">Malzeme Araç Geçmişi</div>
            <div style="font-size:12px;color:#475569;margin-top:4px;line-height:1.4;">
              <b>${escapeHtml(malzeme || '—')}</b>${firmaAdi ? ` · ${escapeHtml(firmaAdi)}` : ''}
            </div>
            <div style="font-size:11px;color:#64748b;margin-top:2px;">Daha önce bu malzemeyi saran / yazdırılan araçlar</div>
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
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    overlay.querySelector('#piyasaHistoryClose').onclick = close;
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    document.addEventListener('keydown', function onEsc(e) {
      if (e.key === 'Escape') {
        close();
        document.removeEventListener('keydown', onEsc);
      }
    });

    const tbody = overlay.querySelector('#piyasaHistoryTbody');
    try {
      const baseHistory = collectMalzemeVehicleHistory(malzeme);
      const history = await enrichMalzemeHistoryEntries(baseHistory);
      if (tbody) tbody.innerHTML = renderMalzemeHistoryRows(history);
    } catch (e) {
      console.warn('Malzeme araç geçmişi yüklenemedi:', e);
      if (tbody) {
        tbody.innerHTML = renderMalzemeHistoryRows(collectMalzemeVehicleHistory(malzeme));
      }
    }
  }

  function findOrderForPrint(opts) {
    const orderIdx = opts?.orderIdx;
    if (orderIdx != null) {
      const byIdx = (state.orders || []).find((x) => x.__idx === orderIdx);
      if (byIdx) return byIdx;
    }
    const last = state._lastAppliedOrder;
    if (last) {
      const byLast = (state.orders || []).find((x) => x.__idx === last.__idx);
      if (byLast) return byLast;
    }
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

    if (state._lastAppliedOrder && state._lastAppliedOrder.__idx === order.__idx) {
      state._lastAppliedOrder.printCount = order.printCount;
      state._lastAppliedOrder.lastPrintAt = order.lastPrintAt;
      state._lastAppliedOrder.lastPrintPlate = order.lastPrintPlate;
      state._lastAppliedOrder.printPlates = { ...order.printPlates };
    }

    try { saveState(); } catch (e) {}
    return true;
  }

  function getActiveOrderIdx() {
    return state._lastAppliedOrder?.__idx ?? null;
  }

  function buildOrderStatusCell(o, forPrint) {
    const isUsed = !!o.usedAt;
    const pc = getOrderPrintCount(o);

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

    const badges = [];
    if (isUsed) {
      badges.push(`<span style="color:#4b5563;font-weight:700;" title="Seçildi${o.usedPlate ? ': ' + escapeHtml(o.usedPlate) : ''}">✓</span>`);
    }
    if (pc > 0) {
      const color = pc >= 2 ? '#ea580c' : '#059669';
      const when = formatOrderPrintWhen(o.lastPrintAt);
      const title = [
        `${pc} kez yazdırıldı`,
        o.lastPrintPlate ? `son plaka: ${o.lastPrintPlate}` : '',
        when ? `son: ${when}` : '',
        formatPrintPlatesSummary(o.printPlates, 6) ? `plakalar: ${formatPrintPlatesSummary(o.printPlates, 6)}` : '',
      ].filter(Boolean).join(' · ');
      badges.push(`<span style="color:${color};font-weight:700;" title="${escapeHtml(title)}">🖨️${pc}</span>`);
    }
    const badgeHtml = badges.length
      ? `<div style="line-height:1;">${badges.join(' ')}</div>`
      : '';
    const pickKey = escapeHtml(o._pickKey || String(o.__idx));
    return `<div style="display:flex;flex-direction:column;align-items:center;gap:3px;">
      ${badgeHtml}
      <button type="button" data-history-key="${pickKey}" title="Bu malzemeyi daha önce saran araçlar" style="border:0;background:#eef2ff;color:#4338ca;border-radius:6px;padding:2px 6px;font-size:10px;font-weight:700;cursor:pointer;line-height:1.2;white-space:nowrap;">🚛</button>
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
        irsaliyeNo: pick(r, ['İRSALİYE NO','IRSALIYE NO','İRSALİYE','IRSALIYE']),
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
    overlay.style.cssText = 'position:fixed;inset:0;z-index:1000007;background:rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;padding:16px;';
    overlay.innerHTML = `
      <div style="background:#fff;border-radius:12px;max-width:720px;width:100%;max-height:90vh;overflow:auto;padding:16px;box-shadow:0 10px 30px rgba(0,0,0,.2);">
        <div style="font-weight:800;margin-bottom:8px;">Piyasa yükleme özeti</div>
        <div id="piyImportReportBody">${lines}</div>
        <button type="button" id="piyImportReportOk" style="margin-top:12px;width:100%;padding:10px;border:0;border-radius:8px;background:#111827;color:#fff;font-weight:700;cursor:pointer;">Tamam</button>
      </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('#piyImportReportOk').onclick = () => overlay.remove();
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
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

  function openSheetPickerModal(metas, wb, onConfirm){
    const weeks = Array.from(new Set(metas.map(m=>m.week))).sort((a,b)=>a-b);
    const defaultWeek = weeks[0] ?? null;

    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.35);z-index:99999;display:flex;align-items:center;justify-content:center;padding:16px;';
    overlay.innerHTML = `
      <div style="background:#fff;border-radius:14px;max-width:780px;width:100%;max-height:82vh;overflow:hidden;box-shadow:0 10px 30px rgba(0,0,0,.25);display:flex;flex-direction:column;">
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

  /** Piyasa sipariş seçiminden sonra başlık altına "boş : …" yazar. Kapat = yazmaz. */
  function promptAracBosuTonaj() {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:100000;display:flex;align-items:center;justify-content:center;padding:16px;';
      overlay.innerHTML = `
        <div style="background:#fff;border-radius:14px;max-width:420px;width:100%;box-shadow:0 10px 30px rgba(0,0,0,.25);overflow:hidden;">
          <div style="padding:14px 16px;border-bottom:1px solid #eee;">
            <div style="font-weight:900;font-size:16px;">Arabanın boşu kaç?</div>
            <div style="font-size:12px;color:#666;margin-top:4px;">HP / hp / Hp ile başlayan tüm firmalarda yazdırırken sorulur (elle veya Piyasa Excel). İsteğe bağlı — Kapat ile atlanır.</div>
          </div>
          <div style="padding:14px 16px;">
            <label style="display:block;font-size:12px;color:#555;margin-bottom:6px;">Boş ağırlık (kg)</label>
            <input id="piyasaBosTonajInput" type="text" inputmode="numeric" placeholder="ör. 14400" autocomplete="off"
              style="width:100%;padding:12px;border:1px solid #ddd;border-radius:10px;font-size:15px;box-sizing:border-box;">
          </div>
          <div style="display:flex;gap:10px;justify-content:flex-end;padding:12px 16px;border-top:1px solid #eee;">
            <button type="button" id="piyasaBosTonajClose" style="border:0;background:#eee;border-radius:10px;padding:10px 14px;cursor:pointer;">Kapat</button>
            <button type="button" id="piyasaBosTonajOk" style="border:0;background:#111827;color:#fff;border-radius:10px;padding:10px 14px;cursor:pointer;">Tamam</button>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);

      const input = overlay.querySelector('#piyasaBosTonajInput');
      const okBtn = overlay.querySelector('#piyasaBosTonajOk');
      const closeBtn = overlay.querySelector('#piyasaBosTonajClose');

      const finish = (val) => {
        overlay.remove();
        document.removeEventListener('keydown', onKey);
        resolve(val);
      };

      const onKey = (e) => {
        if (e.key === 'Escape') finish(null);
        if (e.key === 'Enter') {
          e.preventDefault();
          submit();
        }
      };

      const submit = () => {
        const raw = String(input?.value || '').trim().replace(/\s+/g, '');
        if (!raw) {
          input?.focus();
          return;
        }
        finish(raw);
      };

      closeBtn.onclick = () => finish(null);
      okBtn.onclick = submit;
      document.addEventListener('keydown', onKey);
      setTimeout(() => input?.focus(), 0);
    });
  }

  function formatAracBosuText(bosKg) {
    if (bosKg == null || bosKg === '') return '';
    return `NET BOŞ AĞIRLIK : ${bosKg}`;
  }

  function applyAracBosuToForm(bosKg) {
    const text = formatAracBosuText(bosKg);
    const hidden = document.getElementById('aracBosuBilgi');
    const line = document.getElementById('aracBosuSatir');
    if (hidden) hidden.value = text;
    if (line) {
      line.textContent = text;
      line.hidden = !text;
    }
  }

  function firmaKodFromInput(str) {
    try {
      if (typeof getFirmaKodOnly === 'function') return getFirmaKodOnly(str);
    } catch (_) {}
    return String(str || '').split('/')[0].trim();
  }

  function isHpFirma(firmaStr) {
    const kod = firmaKodFromInput(firmaStr);
    return /^hp/i.test(kod);
  }

  function getCurrentFirmaKodu() {
    const inp = document.getElementById('firmaKodu');
    const sel = document.getElementById('firmaSelect');
    return (inp?.value || '').trim() || (sel?.value || '').trim();
  }

  /** Yazdır: HP / hp / Hp ile başlayan firmada her zaman sor (elle veya Piyasa Excel) */
  async function maybePromptAracBosuBeforePrint() {
    const firma = getCurrentFirmaKodu();
    if (!isHpFirma(firma)) return;
    const bosKg = await promptAracBosuTonaj();
    applyAracBosuToForm(bosKg);
  }

  async function applyOrderFromPicker(o) {
    const plate = (document.getElementById('cekiciPlaka') || {}).value || '';
    if (o && (o.usedAt || getOrderPrintCount(o) > 0)) {
      const ok = await confirmReuseOrder(o);
      if (!ok) return;
    }
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
    if (malzeme) malzeme.value = o.malzeme || '';
    if (malzemeSelect) {
      // seçenek eşleşirse select'i de işaretle
      const target = (o.malzeme || '').trim();
      const opt = Array.from(malzemeSelect.options || []).find(x => (x.value||'').trim() === target);
      malzemeSelect.value = opt ? opt.value : '';
    }
    if (ambalaj) ambalaj.value = o.yuklemeTuru || '';
    if (notu) notu.value = o.aciklama || '';
    if (sevk) sevk.value = o.sevkYeri || o.il || '';
    if (tonaj) tonaj.value = o.miktar != null && o.miktar !== '' ? String(o.miktar) : '';
    
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
    if (firmaKodu) firmaKodu.value = firmaVal;
    if (malzeme) malzeme.value = o.malzeme || '';
    if (malzemeSelect) {
      const target = (o.malzeme || '').trim();
      const opt = Array.from(malzemeSelect.options || []).find(x => (x.value||'').trim() === target);
      malzemeSelect.value = opt ? opt.value : '';
    }
    if (ambalaj) ambalaj.value = o.yuklemeTuru || '';
    if (notu) notu.value = o.aciklama || '';
    if (sevk) sevk.value = o.sevkYeri || o.il || '';
    if (tonaj) tonaj.value = o.miktar != null && o.miktar !== '' ? String(o.miktar) : '';
    
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
  }

  // Map a firma code to a human-friendly firma name using global `firmaListesi` if available
  function getFirmaFullName(code){
    try{
      const k = String(code||'').trim();
      if (!k) return '';
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

  async function openOrderPicker(){
    await requestPiyasaSyncIfRemoteNewer({}).catch(() => {});
    if (!state.orders || state.orders.length === 0){
      alert('❌ PİYASA Excel yüklü değil ya da sipariş yok.');
      return;
    }

    const skippedCount = (state.lastSkippedRows || []).length;
    const g1DateLabel = getPiyasaG1DateLabel();
    const g1DateHtml = g1DateLabel
      ? `<div id="piyasaG1DateBadge" style="flex:1;display:flex;align-items:center;justify-content:center;min-width:0;padding:0 16px;">
           <span style="font-size:clamp(24px,3.5vw,36px);font-weight:800;color:#4338ca;letter-spacing:-0.02em;line-height:1.1;white-space:nowrap;">${escapeHtml(g1DateLabel)}</span>
         </div>`
      : `<div id="piyasaG1DateBadge" style="flex:1;min-width:0;"></div>`;
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.35);z-index:99999;display:flex;align-items:center;justify-content:center;padding:16px;';
    overlay.innerHTML = `
      <div style="background:#fff;border-radius:14px;max-width:min(96vw,1400px);width:100%;max-height:88vh;overflow:hidden;box-shadow:0 10px 30px rgba(0,0,0,.25);display:flex;flex-direction:column;">
        <div style="display:flex;align-items:center;gap:12px;padding:12px 14px;border-bottom:1px solid #eee;">
          <div style="flex:0 1 auto;min-width:0;">
            <div style="font-weight:900;">Piyasa Sipariş Seç</div>
            <div id="duplicateWarning" style="font-size:12px;color:#000;background:#FFD700;padding:4px 8px;border-radius:4px;display:none;margin-top:4px;">⚠️ AYNI FİRMA BULUNUYOR - SİPARİŞ SEÇERKEN AYNI RENKLİ BANTLARA DİKKAT EDİNİZ</div>
          </div>
          ${g1DateHtml}
          <div style="flex:0 1 auto;display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:flex-end;">
            ${skippedCount ? `<button type="button" id="piyasaSkippedBtn" style="border:0;background:#fef3c7;color:#92400e;border-radius:8px;padding:6px 10px;font-size:11px;cursor:pointer;font-weight:700;">Elenen satırlar (${skippedCount})</button>` : ''}
            <div style="font-size:12px;color:#666;">${state.sheet ? `Sheet: <b>${escapeHtml(state.sheet)}</b>` : ''}</div>
            <button id="piyasaModalClose" style="border:0;background:#eee;border-radius:10px;padding:6px 10px;cursor:pointer;">Kapat</button>
          </div>
        </div>
        <div style="padding:10px 14px;display:flex;gap:10px;align-items:center;border-bottom:1px solid #eee;flex-wrap:wrap;">
          <input id="piyasaSearch" placeholder="Firma / Malzeme / İl ara… (yazınca geçmiş haftalar da gelir)" style="flex:1;min-width:200px;padding:10px;border:1px solid #ddd;border-radius:10px;">
          <select id="piyasaSevkiyatFilter" style="padding:10px;border:1px solid #ddd;border-radius:10px;font-size:13px;" title="Excel SEVKİYAT TİPİ">
            <option value="all">Tüm siparişler</option>
            <option value="Yİ-GP">Yİ-GP</option>
            <option value="Yİ-HP">Yİ-HP</option>
          </select>
          <button type="button" id="piyasaPrintBtn" title="A4 yatay yazdır — Kenar: Yok, Ölçek: %100" style="border:0;background:#4f46e5;color:#fff;border-radius:10px;padding:9px 14px;font-size:13px;font-weight:700;cursor:pointer;white-space:nowrap;">🖨️ Yazdır</button>
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
      overlay.remove();
      document.removeEventListener('keydown', handleEsc);
    };
    overlay.querySelector('#piyasaModalClose').onclick = close;
    overlay.onclick = null;
    
    // ESC tuşu ile kapat
    const handleEsc = (e)=> {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('keydown', handleEsc);

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

    function getPickerRows(filter, tipMode) {
      const f = String(filter || '').trim().toLowerCase();
      const mode = tipMode || 'all';
      const includeAllWeeks = !!f;
      const source = _getPickerSourceOrders(includeAllWeeks);
      const rows = source.filter((o) => {
        if (mode !== 'all' && getOrderSevkiyatTipi(o) !== mode) return false;
        const firmaAdi = (o.firmaAdi && String(o.firmaAdi).trim())
          ? String(o.firmaAdi).trim()
          : (getFirmaFullName(String(o.firma || '')) || '');
        const hay = `${o.firma} ${firmaAdi} ${o.malzeme} ${o.sevkYeri || ''} ${o.il} ${o.yuklemeTuru} ${o.aciklama} ${o.miktar} ${o.odemeTuru || ''} ${o.org || ''} ${getOrderSevkiyatTipi(o)} ${o._weekLabel || ''}`.toLowerCase();
        return !f || hay.includes(f);
      });

      const firmaCount = {};
      rows.forEach((o) => {
        const firmaCode = String(o.firma || '').trim();
        const firmaAdi = (o.firmaAdi && String(o.firmaAdi).trim())
          ? String(o.firmaAdi).trim()
          : (getFirmaFullName(firmaCode) || '');
        if (firmaAdi) firmaCount[firmaAdi] = (firmaCount[firmaAdi] || 0) + 1;
      });

      const duplicateFirmas = new Set();
      Object.keys(firmaCount).forEach((firma) => {
        if (firmaCount[firma] > 1) duplicateFirmas.add(firma);
      });

      return { rows, duplicateFirmas, filterText: f, tipMode: mode, includeAllWeeks };
    }

    function rowHtml(o, duplicateFirmas, options) {
      const forPrint = !!(options && options.forPrint);
      const showWeek = !!(options && options.showWeek);
      const firmaCode = String(o.firma || '').trim();
      const firmaAdi = (o.firmaAdi && String(o.firmaAdi).trim()) ? String(o.firmaAdi).trim() : (getFirmaFullName(firmaCode) || '');
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
            <button data-pick-key="${escapeHtml(o._pickKey || String(o.__idx))}" style="cursor:pointer;border:0;background:${isUsed ? '#4b5563' : '#111827'};color:#fff;border-radius:8px;padding:5px 8px;font-size:11px;">Seç</button>
          </td>`;
      const statusTd = forPrint
        ? `<td class="col-durum"${printDupClass || printUsedClass}>${statusInner || '—'}</td>`
        : `<td${printDupClass || printUsedClass} style="${cellStyle(false)}${STATUS_CELL_EXTRA}">${statusInner}</td>`;
      const rowClass = forPrint && isDuplicate ? ' class="piyasa-print-strong"' : '';
      const rowStyle = (!forPrint && isUsed && !isDuplicate && printCount < 2) ? ' style="opacity:.92;"' : '';
      const weekBadge = (showWeek && o._weekLabel)
        ? `<span style="font-size:9px;color:${o._isCurrentWeek ? '#059669' : '#6366f1'};font-weight:700;display:block;margin-top:2px;line-height:1.2;">${escapeHtml(o._weekLabel)}</span>`
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
      const sheetLine = state.sheet ? `Sheet: ${escapeHtml(state.sheet)}` : '';
      const weekLine = state.week ? `Hafta: ${escapeHtml(String(state.week))}` : '';
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
      const { rows, duplicateFirmas, includeAllWeeks } = getPickerRows(filter, tipMode);

      const warningEl = overlay.querySelector('#duplicateWarning');
      if (warningEl) {
        warningEl.style.display = duplicateFirmas.size > 0 ? 'block' : 'none';
      }

      const gpN = state.orders.filter((x) => getOrderSevkiyatTipi(x) === 'Yİ-GP').length;
      const hpN = state.orders.filter((x) => getOrderSevkiyatTipi(x) === 'Yİ-HP').length;
      const scopeLabel = includeAllWeeks ? ' • tüm haftalar' : '';
      countEl.textContent = `${rows.length} sipariş${scopeLabel} • GP:${gpN} HP:${hpN}`;
      tbody.innerHTML = rows.map(o => rowHtml(o, duplicateFirmas, { showWeek: includeAllWeeks })).join('');
      tbody.querySelectorAll('button[data-pick-key]').forEach(btn=>{
        btn.onclick = ()=>{
          const pickKey = btn.getAttribute('data-pick-key');
          const selected = rows.find(x => (x._pickKey || String(x.__idx)) === pickKey);
          if (!selected) return;
          close();
          applyOrderFromPicker(selected);
        };
      });
      tbody.querySelectorAll('button[data-history-key]').forEach(btn=>{
        btn.onclick = (e)=>{
          e.stopPropagation();
          const pickKey = btn.getAttribute('data-history-key');
          const selected = rows.find(x => (x._pickKey || String(x.__idx)) === pickKey);
          if (selected) showMalzemeVehicleHistoryModal(selected);
        };
      });
    }

    const printBtn = overlay.querySelector('#piyasaPrintBtn');
    if (printBtn) printBtn.onclick = () => printPiyasaPickerTable();

    searchEl.oninput = ()=> render(searchEl.value);
    if (sevkiyatFilterEl) sevkiyatFilterEl.onchange = () => render(searchEl.value);
    setTimeout(()=> searchEl.focus(), 0);
    render('');
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
      overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.35);z-index:100000;display:flex;align-items:center;justify-content:center;padding:16px;';
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

      // populate
      metas.forEach(m=>{
        const opt = document.createElement('option');
        opt.value = m.name;
        opt.textContent = `${m.name} — ${m.week}. hafta`;
        sel.appendChild(opt);
      });
      if (currentSheetName) sel.value = currentSheetName;

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
      overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.35);z-index:100000;display:flex;align-items:center;justify-content:center;padding:16px;';
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
    try {
      if (typeof window.ensureXlsxLoaded === 'function') await window.ensureXlsxLoaded();
    } catch (e) {
      alert('❌ XLSX kütüphanesi yüklenemedi.');
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
      const again = confirm('Bu dosya daha önce yüklendi.\n\nYine de yüklemek istiyor musunuz?');
      if (!again) return;
    }
    state.fileFingerprint = fp;

    const ab = await file.arrayBuffer();
    const wb = XLSX.read(ab, {
      type: 'array',
      cellStyles: false,
      cellNF: false,
      cellText: false,
      dense: true
    });

    try {
      state.weekArchive = buildWeekArchive(wb);
    } catch (e) {
      console.warn('Piyasa week archive build failed', e);
      state.weekArchive = [];
    }

    // Otomatik seçim: iki geçişli strateji
    // 1) Önce gerçek hücre tarihlerini topla (G1 vb.) ve bu tarihlerde en yaygın yılı bul
    // 2) Sonra sheet adından hafta numarası ile tarih türetirken bu yıl(ları) kullan — böylece
    //    tahminler rastgele bestDate'in yılına kaymaz.
    let bestSheet = null;
    let bestDate = null;

    const foundMap = {};
    const yearCounts = {};
    for (const name of (wb.SheetNames||[])){
      try{
        const ws = wb.Sheets[name];
        const found = findDateInSheet(ws);
        foundMap[name] = found || null;
        if (found && found.date){
          const y = found.date.getFullYear();
          yearCounts[y] = (yearCounts[y] || 0) + 1;
        }
      }catch(e){ foundMap[name] = null; }
    }

    // Determine base year for inference: prefer the most common year among real dates, otherwise current year
    let baseYear = (new Date()).getFullYear();
    const years = Object.keys(yearCounts);
    if (years.length){
      baseYear = parseInt(years.reduce((a,b)=> yearCounts[a] > yearCounts[b] ? a : b), 10);
    }

    for (const name of (wb.SheetNames||[])){
      try{
        const ws = wb.Sheets[name];
        const found = foundMap[name];
        let d = found ? found.date : null;
        let raw = found ? found.raw : null;
        let ref = found ? found.ref : 'G1';

        if (!d){
          const wk = getWeekFromSheetName(name, wb);
          if (wk){
            const inferred = getDateFromWeekYear(wk, baseYear);
            if (inferred){
              d = inferred;
              raw = null;
              ref = `WEEK(${wk})`;
            }
          }
        }

        try{  }catch(_){ }

        if (d && (!bestDate || d > bestDate)){
          bestDate = d;
          bestSheet = name;
        }
      }catch(e){ }
    }

    if (!bestSheet){
      // fallback: önceki haftaya dayalı seçim (uyumluluk)
      const metas = getSheetMetaForPicker(wb);
      if (!metas.length){
        alert('❌ Bu dosyada HAFTA sheet’i bulamadım (ör: 21.HAFTA) ve G1 tarihleri yok.');
        return;
      }
      // en büyük satır sayısına sahip sheet'i al
      const chosen = metas.sort((a,b)=> (b.count - a.count) || (b.orderIndex - a.orderIndex))[0];
      try{
        const ws = wb.Sheets[chosen.name];
        const rawRows = parseSheetSmart(ws);
        const g1 = readG1FromSheet(ws);
        applyPiyasaParseResult(rawRows, {
          week: chosen.week,
          sheet: chosen.name,
          loadedAt: g1.date || new Date(),
          sheetDate: g1.date ? g1.date.toISOString() : null,
          sheetDateRaw: g1.raw,
        });

        if (state.orders && state.orders.length) saveState();

        toast(`✅ Piyasa yüklendi: ${chosen.name} • ${chosen.week}. hafta • ${state.orders.length} sipariş`, 'success');
        // report event removed: EXCEL_PIYASA_LOADED

        if (!state.orders.length){
          alert('⚠️ Seçilen kitapta sipariş bulunamadı. (Filtre kuralları nedeniyle bazı satırlar atılmış olabilir.)');
          return;
        }
        // open picker modal that allows switching sheets (pass metas + wb)
        const metas = getSheetMetaForPicker(wb);
        showWeekPickerModal(metas, wb, state.sheet, openOrderPicker);
      }catch(e){
        console.error('Piyasa load failed', e);
        alert('❌ Seçilen kitabı okurken hata oluştu.');
      }
      return;
    }



    // Eğer G1 ile bir sheet seçildiyse, o sheet'i kullan
    try{
      const ws = wb.Sheets[bestSheet];
      const rawRows = parseSheetSmart(ws);
      const g1 = readG1FromSheet(ws);
      const weekFromName = getWeekFromSheetName(bestSheet, wb);
      const week = weekFromName || (g1.date ? getWeekFromDate(g1.date) : null);
      applyPiyasaParseResult(rawRows, {
        week,
        sheet: bestSheet,
        loadedAt: g1.date || bestDate || new Date(),
        sheetDate: g1.date ? g1.date.toISOString() : (bestDate ? bestDate.toISOString() : null),
        sheetDateRaw: g1.raw,
      });

      if (state.orders && state.orders.length) saveState();

      toast(`✅ Piyasa yüklendi: ${bestSheet} • ${week ? week + '. hafta' : 'hafta bilinmiyor'} • ${state.orders.length} sipariş`, 'success');
      // report event removed: EXCEL_PIYASA_LOADED

      if (!state.orders.length){
        alert('⚠️ Seçilen kitapta sipariş bulunamadı. (Filtre kuralları nedeniyle bazı satırlar atılmış olabilir.)');
        return;
      }
      const metas = getSheetMetaForPicker(wb);
      showWeekPickerModal(metas, wb, state.sheet || bestSheet, openOrderPicker);
    }catch(e){
      console.error('Piyasa load failed', e);
      alert('❌ Seçilen kitabı okurken hata oluştu.');
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
  window.piyasa.getActiveOrderIdx = getActiveOrderIdx;
  window.piyasa.showSkippedRows = showPiyasaSkippedRowsModal;
  window.piyasa.syncFromServer = syncPiyasaFromServer;

  // Chip'ten çağrılmak için modal açma fonksiyonu
  window.piyasaShowOrdersModal = function() {
    if (state.orders && state.orders.length > 0) {
      openOrderPicker();
    }
  };

window.initPiyasaModule = init;
})();
