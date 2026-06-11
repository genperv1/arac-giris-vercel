// report.js
(function(){
  const DELETE_PASSWORD = '2026genper';

  function uiHelpers() { return window.rpUi || {}; }

  function uiPassword(message) {
    const u = uiHelpers();
    if (typeof u.password === 'function') return u.password(message);
    return window.rpUi.password(message);
  }

  function uiAlert(message, type) {
    const u = uiHelpers();
    if (typeof u.alert === 'function') return u.alert(message, type);
    alert(message);
    return Promise.resolve();
  }

  function uiConfirm(message, opts) {
    const u = uiHelpers();
    if (typeof u.confirm === 'function') return u.confirm(message, opts);
    return confirm(message);
  }

  // Cleanup legacy localStorage keys that may feed the reports UI
  try {
    try { localStorage.removeItem('report_events_v1'); } catch(e) {}
    try { localStorage.removeItem('pending_reprint_vehicleId'); } catch(e) {}
    try { localStorage.removeItem('soforHistoryByPlaka'); } catch(e) {}
    // remove any vehicle_* keys
    try {
      const toRemove = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i) || '';
        if (k.startsWith('vehicle_')) toRemove.push(k);
      }
      toRemove.forEach(k => { try { localStorage.removeItem(k); } catch(e){} });
    } catch(e) {}
  } catch(e) {}
  const REPORT_TZ = 'Europe/Istanbul';

  function fmtDate(ts){
    try{
      if (!ts) return '-';
      const d = new Date(ts);
      if (isNaN(d.getTime())) return '-';
      return d.toLocaleString('tr-TR', { timeZone: REPORT_TZ });
    }catch(e){ return '-'; }
  }

  /** Yazdırma anı (ms) → İstanbul 24s saat (Intl; tr-TR time string motor farklarından kaçınır) */
  function trDateTimeFromMs(ms) {
    try {
      const d = new Date(Number(ms));
      if (isNaN(d.getTime())) return null;
      const tz = { timeZone: REPORT_TZ };
      return {
        tarih: d.toLocaleDateString('tr-TR', tz),
        saat: new Intl.DateTimeFormat('en-GB', {
          timeZone: REPORT_TZ,
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false,
          hourCycle: 'h23'
        }).format(d)
      };
    } catch (e) {
      return null;
    }
  }

  // ===== NETSIS FONKSIYONLARI =====
  function normalizeNetsisPlate(value) {
    if (!value) return '';
    return String(value).toUpperCase().replace(/[^A-Z0-9]/g, '');
  }

  function normalizeNetsisPhone(value) {
    if (!value) return '';
    // Sadece rakamları al
    const digits = String(value).replace(/[^0-9]/g, '');
    if (!digits) return '';

    // Türkiye formatı için: başına 0 ekle ve tüm rakamları kullan
    // Eğer zaten 0 ile başlamıyorsa başına 0 ekle
    if (digits.startsWith('0')) {
      return digits;
    } else {
      return '0' + digits;
    }
  }

  function netsisUpperName(value) {
    return String(value || '').trim().toLocaleUpperCase('tr-TR');
  }

  function copyNetsisVehicleText(vehicle) {
    if (!vehicle) return '';
    const tc = String(vehicle.tcKimlik || '').replace(/\D/g, '');
    return [
      normalizeNetsisPlate(vehicle.cekiciPlaka),
      netsisUpperName(vehicle.soforAdi),
      netsisUpperName(vehicle.soforSoyadi),
      normalizeNetsisPhone(vehicle.iletisim),
      tc,
      normalizeNetsisPlate(vehicle.dorsePlaka)
    ].join('\n');
  }

  async function copyNetsisData(vehicle) {
    const text = copyNetsisVehicleText(vehicle);
    if (!text || !normalizeNetsisPlate(vehicle && vehicle.cekiciPlaka)) {
      return false;
    }
    try {
      return await copyTextToClipboard(text);
    } catch (e) {
      return false;
    }
  }
  // ===== NETSIS FONKSIYONLARI BITTI =====

  function buildWhatsAppCopyText(data) {
    const plate = (data.cekiciPlaka || data.plaka || '').toString().trim() || '-';
    const firma = (data.firma || data.firmaKodu || data.firmaSelect || '-').toString().trim();
    const girisYeri = (data.basimYeri || data.girisYeri || '-').toString().trim();
    const malzeme = (data.malzeme || '').toString().trim();
    const sevkYeri = (data.sevkYeri || '').toString().trim();
    const bilgi = [malzeme, sevkYeri].filter(Boolean).join(' • ').trim();
    const parts = [plate, firma, girisYeri];
    if (bilgi) parts.push('(' + bilgi + ')');
    parts.push('GİRİŞ YAPTI.');
    return parts.join(' - ');
  }

  async function copyWhatsAppData(data) {
    const text = buildWhatsAppCopyText(data || {});
    try {
      return await copyTextToClipboard(text);
    } catch (e) {
      return false;
    }
  }

  async function getDailyMeta(){
    try{ const r = await fetch('/api/kv/daily_shipments_meta'); if (r.ok) return await r.json(); }catch(e){}
    return {};
  }
  async function getDailyCount(){
    try{ const r = await fetch('/api/kv/daily_shipments_current'); if (r.ok) { const a = await r.json(); return Array.isArray(a) ? a.length : 0; } }catch(e){}
    return 0;
  }
  async function getPiyasaState(){
    try{ const r = await fetch('/api/piyasa'); if (r.ok) return await r.json(); }catch(e){}
    return {};
  }
  async function getEvents(){
    try{ 
      console.log('Fetching reports from /api/reports...');
      const r = await fetch('/api/reports?_=' + Date.now(), {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store, no-cache, must-revalidate',
          'Pragma': 'no-cache'
        },
        credentials: 'include'
      }); 
      console.log('Reports response status:', r.status);
      if (r.ok) {
        const data = await r.json();
        console.log('Reports data received:', data.length, 'items');
        return data;
      } else {
        console.error('Reports fetch failed with status:', r.status);
        // Try to get error details
        try {
          const errorData = await r.json();
          console.error('Error details:', errorData);
        } catch(e) {
          console.error('No error details available');
        }
      }
    }catch(e){
      console.error('Reports fetch error:', e);
    }
    return [];
  }

  // cache last loaded events so delete handlers can reuse
  let _latestEvents = [];
  const _vehicleLookupCache = new Map();

  function parseRowEventData(tr) {
    if (!tr) return {};
    const eventDataStr = tr.getAttribute('data-event-data') || '{}';
    try { return JSON.parse(eventDataStr) || {}; } catch (e) { return {}; }
  }

  async function lookupVehicleCached(plate) {
    const key = normPlateKey(plate);
    if (!key) return null;
    if (_vehicleLookupCache.has(key)) return _vehicleLookupCache.get(key);
    try {
      const resp = await fetch('/api/vehicles/lookup?plate=' + encodeURIComponent(plate));
      if (resp.ok) {
        const v = await resp.json();
        const result = (v && typeof v === 'object' && !Array.isArray(v)) ? v : null;
        _vehicleLookupCache.set(key, result);
        return result;
      }
    } catch (e) { /* ignore */ }
    _vehicleLookupCache.set(key, null);
    return null;
  }

  function prefetchVehicleLookups(plates) {
    const unique = [...new Set((plates || []).map(p => String(p || '').trim()).filter(Boolean))]
      .filter(p => !_vehicleLookupCache.has(normPlateKey(p)))
      .slice(0, 80);
    if (!unique.length) return;
    fetch('/api/vehicles/lookup-batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plates: unique })
    }).then(r => r.ok ? r.json() : {}).then(data => {
      Object.entries(data || {}).forEach(([pnorm, v]) => {
        _vehicleLookupCache.set(pnorm, v || null);
      });
      unique.forEach(plate => {
        const k = normPlateKey(plate);
        if (!_vehicleLookupCache.has(k)) _vehicleLookupCache.set(k, null);
      });
    }).catch(() => {});
  }

  function flashBtnBusy(btn) {
    if (!btn || btn.__busy) return;
    btn.__busy = true;
    btn.classList.add('is-busy');
    btn.disabled = true;
    const reset = () => {
      btn.__busy = false;
      btn.classList.remove('is-busy');
      btn.disabled = false;
    };
    setTimeout(reset, 400);
  }

  function flashBtnCopied(btn) {
    if (!btn) return;
    btn.__busy = false;
    btn.classList.remove('is-busy');
    btn.disabled = false;
    if (btn.__copyFlashTimer) clearTimeout(btn.__copyFlashTimer);
    const originalHTML = btn.innerHTML;
    const originalBg = btn.style.backgroundColor;
    const originalColor = btn.style.color;
    btn.innerHTML = '<i class="fas fa-check"></i> Kopyalandı';
    btn.style.backgroundColor = '#059669';
    btn.style.color = 'white';
    btn.__copyFlashTimer = setTimeout(() => {
      btn.innerHTML = originalHTML;
      btn.style.backgroundColor = originalBg;
      btn.style.color = originalColor;
      btn.__copyFlashTimer = null;
    }, 1200);
  }

  async function copyTextToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.select();
    try {
      document.execCommand('copy');
      return true;
    } catch (e) {
      return false;
    } finally {
      textarea.remove();
    }
  }

  // pagination defaults (client-side)
  if (!window.__reportsPage) window.__reportsPage = 1;
  if (!window.__reportsPageSize) window.__reportsPageSize = 10; // default page size

  function normPlate(s){
    return String(s||'').toLowerCase().replace(/[\s-]+/g,'');
  }

  /** Sunucu /api/vehicles/lookup-batch ile aynı plaka anahtarı */
  function normPlateKey(s) {
    return String(s || '').toLowerCase().replace(/\s+/g, '').replace(/[^a-z0-9ığüşöç]/gi, '');
  }

  function splitSoforForExcel(full) {
    const s = String(full || '').trim().replace(/\s+/g, ' ');
    if (!s) return { soforAdi: '', soforSoyadi: '' };
    const parts = s.split(' ');
    if (parts.length === 1) return { soforAdi: parts[0], soforSoyadi: '' };
    return { soforAdi: parts.slice(0, -1).join(' '), soforSoyadi: parts[parts.length - 1] };
  }

  function findLastPrintEvent(vehicle) {
    try {
      if (vehicle && vehicle.rawEvent) return vehicle.rawEvent;
      const plateNorm = normPlate(vehicle.cekiciPlaka || '');
      const evs = (_latestEvents || []).filter(ev => ev && ev.type === 'PRINT' && ev.data);
      const matched = evs.filter(ev => {
        try {
          const d = ev.data || {};
          if (d.vehicleId && String(d.vehicleId) === String(vehicle.id)) return true;
          if (d.plaka && normPlate(d.plaka || '') === plateNorm) return true;
          if (ev.id && String(ev.id) === String(vehicle.id)) return true;
        } catch (e) { /* ignore */ }
        return false;
      });
      if (!matched.length) return null;
      matched.sort((a, b) => Number(b.ts || 0) - Number(a.ts || 0));
      return matched[0];
    } catch (e) {
      return null;
    }
  }

  async function resolveReportRowVehicleData(tr) {
    const plate = String(tr.getAttribute('data-plate') || '').trim();
    const vehicleId = tr.getAttribute('data-actual-vehicle-id') || tr.getAttribute('data-vehicle-id') || '';
    const sourceData = parseRowEventData(tr);

    let vehicleData = null;
    const hasPhone = sourceData.iletisim || sourceData.phone || sourceData.driverPhone || sourceData.phoneNumber;
    const hasTC = sourceData.tcKimlik || sourceData.tc;
    const hasDorse = sourceData.dorsePlaka || sourceData.dorse;
    const needLookup = !hasPhone || !hasTC || !hasDorse;

    if (needLookup && plate) {
      try {
        if (window.storage && typeof window.storage.load === 'function' && vehicleId) {
          const cached = window.storage.load('vehicle_' + vehicleId);
          if (cached && typeof cached === 'object') vehicleData = cached;
        }
        if (!vehicleData) {
          vehicleData = await lookupVehicleCached(plate);
        }
      } catch (e) {
        console.warn('Vehicle lookup for NETSIS failed:', e);
      }
    }

    const full = Object.assign({}, vehicleData || {}, sourceData);
    const fullFromEvent = String(sourceData.sofor || '').trim();
    const evSplit = fullFromEvent ? splitSoforForExcel(fullFromEvent) : null;

    return {
      cekiciPlaka: full.cekiciPlaka || full.plaka || plate || '',
      soforAdi: evSplit ? evSplit.soforAdi : (full.soforAdi || full.driverName || full.isim || full.name || ''),
      soforSoyadi: evSplit ? evSplit.soforSoyadi : (full.soforSoyadi || full.driverSurname || full.soyisim || full.surname || ''),
      iletisim: full.iletisim || full.phone || full.driverPhone || full.phoneNumber || '',
      tcKimlik: full.tcKimlik || full.tc || '',
      dorsePlaka: full.dorsePlaka || full.dorse || ''
    };
  }

  function calcKpis(vehicles, events){
    const printedVehicles = vehicles.filter(v => (parseInt(v.printCount||'0',10)||0) > 0);
    const totalPrintedVehicles = printedVehicles.length;
    const totalPrints = printedVehicles.reduce((acc,v)=> acc + (parseInt(v.printCount||'0',10)||0), 0);
    const now = Date.now();
    const day = 24*60*60*1000;
    const print24 = events.filter(ev => ev && ev.type === 'PRINT' && (now - (ev.ts||0)) <= day).length;
    return { totalPrintedVehicles, totalPrints, print24 };
  }

  async function render(){
    // Show loading indicator
    const tbody = document.getElementById('tbody');
    if (tbody) {
      tbody.innerHTML = '<tr><td colspan="6" class="text-center py-8 text-gray-500">Yükleniyor...</td></tr>';
    }
    
    console.log('🕐 Render started - checking hour display...');
    
    try {
      // Load all data in parallel for better performance
      const [events, dailyMeta, dailyCnt, piyasa] = await Promise.all([
        getEvents(),
        getDailyMeta(),
        getDailyCount(),
        getPiyasaState()
      ]);
      
      // Check if we got valid data
      if (!events || events.length === 0) {
        if (tbody) {
          tbody.innerHTML = '<tr><td colspan="6" class="text-center py-8 text-gray-500">Henüz rapor bulunmuyor.</td></tr>';
        }
        return;
      }
    
    _latestEvents = events || [];
    // Show each PRINT event as its own row (do not aggregate by vehicle)
    const printEvents = (events || []).filter(ev => ev && ev.type === 'PRINT');
    const vehicles = (printEvents || []).map(ev => {
      const d = ev.data || {};
      return {
        id: ev.id,
        cekiciPlaka: (d.plaka || d.plate || '').toString(),
        defaultFirma: d.firma || d.firmaKodu || d.firmaSelect || '',
        printCount: 1,
        lastPrintSnapshot: Object.assign({ ts: ev.ts }, d),
        rawEvent: ev
      };
    });

    // KPI
    const k = calcKpis(vehicles, events);


    // filters
    const q = normPlate(document.getElementById('plateSearch').value || '');
    const mode = 'printed';
    try{ const fs=document.getElementById('filterSelect'); if(fs){ fs.value='printed'; fs.disabled=true; } }catch(e){}

    let rows = vehicles.slice();
    if (q){
      rows = rows.filter(v => normPlate(v.cekiciPlaka || '').includes(q));
    }
    if (mode === 'printed'){
      rows = rows.filter(v => (parseInt(v.printCount||'0',10)||0) > 0);
    } else if (mode === 'notprinted'){
      rows = rows.filter(v => (parseInt(v.printCount||'0',10)||0) === 0);
    }

    // sort: last print timestamp desc (use lastPrintSnapshot.ts) then kayitTarihi
    rows.sort((a,b)=>{
      const ap = (a.lastPrintSnapshot && a.lastPrintSnapshot.ts) ? Number(a.lastPrintSnapshot.ts) : 0;
      const bp = (b.lastPrintSnapshot && b.lastPrintSnapshot.ts) ? Number(b.lastPrintSnapshot.ts) : 0;
      if (bp !== ap) return bp - ap;
      return String(b.kayitTarihi||'').localeCompare(String(a.kayitTarihi||''));
    });

    const tbody = document.getElementById('tbody');
    tbody.innerHTML = '';

    function collectPrintEventIdsForVehicle(vehicle){
      try{
        // If the row represents a single event, return its id
        if (vehicle && vehicle.id) {
          const exists = (_latestEvents || []).some(ev => ev && String(ev.id) === String(vehicle.id));
          if (exists) return [String(vehicle.id)];
        }
        // Fallback: collect events by vehicleId or plate
        const plateNorm = normPlate(vehicle.cekiciPlaka || '');
        const evs = (_latestEvents || []).filter(ev => ev && ev.type === 'PRINT' && ev.data);
        const ids = [];
        evs.forEach(ev => {
          try{
            const d = ev.data || {};
            if (d.vehicleId && String(d.vehicleId) === String(vehicle.id)) { if (ev.id) ids.push(String(ev.id)); return; }
            if (d.plaka && normPlate(d.plaka || '') === plateNorm) { if (ev.id) ids.push(String(ev.id)); return; }
          }catch(e){}
        });
        return ids;
      }catch(e){ return []; }
    }

    // pagination: compute page slice
    const totalItems = rows.length;
    const pageSize = Number(window.__reportsPageSize) || 20;
    const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
    if (!window.__reportsPage || window.__reportsPage < 1) window.__reportsPage = 1;
    if (window.__reportsPage > totalPages) window.__reportsPage = totalPages;
    const pageIndex = Number(window.__reportsPage) - 1;
    const pageStart = pageIndex * pageSize;
    const pageEnd = pageStart + pageSize;
    const pageRows = rows.slice(pageStart, pageEnd);

    for (const v of pageRows){
      const pc = (parseInt(v.printCount||'0',10)||0);
      const printed = pc > 0;
      const tr = document.createElement('tr');

      const plate = (v.cekiciPlaka || '').toString();

      tr.setAttribute('data-print-event-id', String(v.id || '')); // report event id
      tr.setAttribute('data-vehicle-id', String(v.id || '')); // fallback for existing handlers
      tr.setAttribute('data-plate', plate || '');

      // use row's own print event (no full-list scan)
      const lastEv = v.rawEvent || null;
      let lastPrintHtml = '-';
      let ts = (lastEv && lastEv.ts) || (v.lastPrintSnapshot && v.lastPrintSnapshot.ts) || null;
      let d = (lastEv && lastEv.data) ? lastEv.data : {};
      let saat = d.saat || '';
      if (!saat && ts) {
        const tr = trDateTimeFromMs(ts);
        if (tr) saat = tr.saat;
      }
      
      // ✅ Tüm event data'sını tr'ye ekle (reprint için)
      if (lastEv && lastEv.data) {
        try {
          tr.setAttribute('data-event-data', JSON.stringify(lastEv.data));
          if (lastEv.data.vehicleId) {
            tr.setAttribute('data-actual-vehicle-id', String(lastEv.data.vehicleId));
          }
        } catch(e) {}
      }
      
      if (printed || lastEv) {
        const malz = d.malzeme || '';
        const sevk = d.sevkYeri || '';
        lastPrintHtml = `
          <div style="font-size:12px;opacity:.85">${malz ? '\u2022 ' + malz : ''} ${sevk ? '\u2022 ' + sevk : ''}</div>
        `;
      }

      const basim = (d && (d.basimYeri || d.basimYeri === '')) ? (d.basimYeri || '') : ((v && v.lastPrintSnapshot && v.lastPrintSnapshot.basimYeri) || '');

      // determine exit date (Çıkış Tarihi) from event data if available
      let cikisHtml = '-';
      try {
        const cikisRaw = d && (d.cikisTarihi || d.cikisTarih || d.cikis || d.cikisTs || d.cikis_ts || d.cikisTimestamp || d.cikisTime);
        if (cikisRaw) {
          if (!isNaN(Number(cikisRaw))) {
            cikisHtml = '<div style="font-weight:700">' + (new Date(Number(cikisRaw)).toLocaleString('tr-TR', { timeZone: REPORT_TZ })) + '</div>';
          } else {
            cikisHtml = '<div style="font-weight:700">' + String(cikisRaw) + '</div>';
          }
        }
      } catch(e) { cikisHtml = '-'; }

      const firmaCode = (lastEv && lastEv.data && (lastEv.data.firma || lastEv.data.firmaKodu || lastEv.data.firmaSelect))
        || v.defaultFirma || '';
      const soforName = (lastEv && lastEv.data && (lastEv.data.sofor
        || [lastEv.data.soforAdi, lastEv.data.soforSoyadi].filter(Boolean).join(' ').trim()))
        || '';
      const plateCellHtml = plate
        ? `${plate}${soforName ? `<div style="font-size:12px;font-weight:600;color:#334155;margin-top:2px">${soforName}</div>` : ''}`
        : (soforName || '-');
      const firmaCellHtml = firmaCode || '-';

      tr.innerHTML = `
        <td class="p-3 col-plate font-semibold" data-label="Plaka">${plateCellHtml}</td>
        <td class="p-3" data-label="Firma / Sürücü">${firmaCellHtml}</td>
        <td class="p-3" data-label="Tarih">${(function(){
            const tr = ts ? trDateTimeFromMs(ts) : null;
            const dateStr = tr ? tr.tarih : ((d && d.tarih) ? (d.tarih || '-') : '-');
            const timeStr = tr ? tr.saat : (((d && d.saat) ? d.saat : (lastEv && lastEv.saat)) || '');
            return '<div style="font-weight:700">' + (dateStr || '-') + '</div>' + (timeStr ? ('<div style="font-size:12px;opacity:.85">' + timeStr + '</div>') : '');
          })()}</td>
        <td class="p-3" data-label="Basım Yeri">${basim || '-'}</td>
        <td class="p-3" data-label="Malzeme">${lastPrintHtml}</td>
        <td class="p-3 rp-table-actions" data-label="İşlem">
          <div class="flex items-center gap-2 flex-wrap rp-table-actions-inner">
            <button class="report-action-btn netsisBtn"
              data-id="${String(v.id||'')}" title="NETSIS verilerini kopyala">
              <i class="fas fa-link"></i> NETSIS
            </button>
            <button class="report-action-btn copyExcelBtn"
              data-id="${String(v.id||'')}" title="Excel için satırı kopyala">
              <i class="fas fa-file-excel"></i> Excel
            </button>
            <button class="report-action-btn copyWhatsappBtn"
              data-id="${String(v.id||'')}" title="WhatsApp metnini kopyala">
              <i class="fab fa-whatsapp"></i> WhatsApp Kopyala
            </button>
            <button class="report-action-btn reprintBtn small"
              data-id="${String(v.id||'')}" title="Yeniden Yazdır">
              <i class="fas fa-print"></i>
            </button>
            <button class="report-action-btn deleteRowBtn small"
              data-id="${String(v.id||'')}" title="Sil">
              <i class="fas fa-trash"></i>
            </button>
            <label class="inline-flex items-center gap-1 text-xs text-slate-500">
              <input type="checkbox" class="selectRowChk" data-id="${String(v.id||'')}">
              Seç
            </label>
          </div>
        </td>
      `;
      tbody.appendChild(tr);
    }

    // render pagination controls
    try{
      const pc = document.getElementById('paginationControls');
      if (pc) {
        const cur = Number(window.__reportsPage) || 1;
        const makePageButton = (n, active) => {
          return `<button type="button" data-page="${n}" class="rp-pager-btn${active ? ' is-active' : ''}" aria-label="Sayfa ${n}"${active ? ' aria-current="page"' : ''}>${n}</button>`;
        };
        const maxButtons = 7;
        let startPage = Math.max(1, cur - Math.floor(maxButtons / 2));
        let endPage = Math.min(totalPages, startPage + maxButtons - 1);
        if (endPage - startPage + 1 < maxButtons) startPage = Math.max(1, endPage - maxButtons + 1);
        let pageBtns = '';
        for (let p = startPage; p <= endPage; p++) pageBtns += makePageButton(p, p === cur);
        const prevDisabled = cur <= 1;
        const nextDisabled = cur >= totalPages;
        pc.innerHTML = [
          '<div class="rp-pager-inner">',
          '<nav class="rp-pager-nav" aria-label="Sayfa numaraları">',
          '<button type="button" id="prevPageBtn" class="rp-pager-btn rp-pager-arrow" aria-label="Önceki sayfa"' + (prevDisabled ? ' disabled' : '') + '>',
          '<i class="fas fa-chevron-left" aria-hidden="true"></i></button>',
          pageBtns,
          '<button type="button" id="nextPageBtn" class="rp-pager-btn rp-pager-arrow" aria-label="Sonraki sayfa"' + (nextDisabled ? ' disabled' : '') + '>',
          '<i class="fas fa-chevron-right" aria-hidden="true"></i></button>',
          '</nav>',
          '<div class="rp-pager-meta">',
          '<span class="rp-pager-stat"><i class="fas fa-list-ul" aria-hidden="true"></i> Toplam <strong>' + totalItems + '</strong> kayıt</span>',
          '<span class="rp-pager-stat">Sayfa <strong>' + cur + '</strong> / <strong>' + totalPages + '</strong></span>',
          '<span class="rp-pager-size"><label for="pageSizeSel">Satır</label>',
          '<select id="pageSizeSel" class="rp-pager-select" aria-label="Sayfa başına kayıt">',
          '<option value="10">10</option><option value="20">20</option><option value="50">50</option>',
          '</select></span></div></div>'
        ].join('');
        const sel = document.getElementById('pageSizeSel');
        if (sel) sel.value = String(pageSize);
        const prevBtn = document.getElementById('prevPageBtn');
        const nextBtn = document.getElementById('nextPageBtn');
        if (prevBtn) {
          prevBtn.addEventListener('click', () => {
            if (window.__reportsPage > 1) { window.__reportsPage = Number(window.__reportsPage) - 1; render(); }
          });
        }
        if (nextBtn) {
          nextBtn.addEventListener('click', () => {
            if (window.__reportsPage < totalPages) { window.__reportsPage = Number(window.__reportsPage) + 1; render(); }
          });
        }
        Array.from(pc.querySelectorAll('button[data-page]')).forEach(b => {
          b.addEventListener('click', () => {
            const pg = Number(b.getAttribute('data-page') || '1');
            if (pg && pg !== window.__reportsPage) { window.__reportsPage = pg; render(); }
          });
        });
        if (sel) {
          sel.addEventListener('change', () => {
            window.__reportsPageSize = Number(sel.value) || 20;
            window.__reportsPage = 1;
            render();
          });
        }
      }
    }catch(e){}

    prefetchVehicleLookups(pageRows.map(v => v.cekiciPlaka));
    } catch (error) {
      console.error('Render error:', error);
      const tbody = document.getElementById('tbody');
      if (tbody) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center py-8 text-red-500">Yüklenirken hata oluştu. Lütfen sayfayı yenileyin.</td></tr>';
      }
    }
  }

  function bind(){
    // Helper function to collect print event IDs for a vehicle
    function collectPrintEventIdsForVehicle(vehicle){
      try{
        // If the row represents a single event, return its id
        if (vehicle && vehicle.id) {
          const exists = (_latestEvents || []).some(ev => ev && String(ev.id) === String(vehicle.id));
          if (exists) return [String(vehicle.id)];
        }
        // Fallback: collect events by vehicleId or plate
        const plateNorm = normPlate(vehicle.cekiciPlaka || '');
        const evs = (_latestEvents || []).filter(ev => ev && ev.type === 'PRINT' && ev.data);
        const ids = [];
        evs.forEach(ev => {
          try{
            const d = ev.data || {};
            if (d.vehicleId && String(d.vehicleId) === String(vehicle.id)) { if (ev.id) ids.push(String(ev.id)); return; }
            if (d.plaka && normPlate(d.plaka || '') === plateNorm) { if (ev.id) ids.push(String(ev.id)); return; }
          }catch(e){}
        });
        return ids;
      }catch(e){ return []; }
    }

    const backBtn = document.getElementById('backBtn');
    if (backBtn) {
      backBtn.addEventListener('click', async () => {
        // ✅ Oturum kontrolü
        if (window.SessionManager && typeof window.SessionManager.requireValidSession === 'function') {
          const isValidSession = await window.SessionManager.requireValidSession();
          if (!isValidSession) {
            return; // Oturum geçersizse işlemi durdur
          }
        }
        try {
          if (window.SessionManager && typeof window.SessionManager.navigateToHome === 'function') {
            window.SessionManager.navigateToHome();
          } else {
            location.href = 'GIRIS.html';
          }
        } catch(e){}
      });
    }

    const clearBtn = document.getElementById('clearReportsBtn');
    if (clearBtn) {
      clearBtn.addEventListener('click', async () => {
        // ✅ Oturum kontrolü
        if (window.SessionManager && typeof window.SessionManager.requireValidSession === 'function') {
          const isValidSession = await window.SessionManager.requireValidSession();
          if (!isValidSession) {
            return; // Oturum geçersizse işlemi durdur
          }
        }
        
        const okPass = await ensureDeletePassword();
        if (!okPass) return;
        const ok = await uiConfirm('🧹 Rapor kayıtları (yazdırma geçmişi) temizlenecek.\nAraç kayıtları silinmez. Devam edilsin mi?');
        if (!ok) return;
        try {
          // 1) Clear server-side reports
          try { await fetch('/api/reports', { method: 'DELETE' }); } catch(e){}

          // 2) Reset print flags on all vehicles on server
          try {
            const r = await fetch('/api/vehicles?limit=20000');
            if (r.ok) {
              const arr = await r.json();
              for (const v of (Array.isArray(arr)?arr:[])){
                try {
                  const nv = { ...v, printCount: 0, lastPrintSnapshot: null };
                  await fetch('/api/vehicles/' + encodeURIComponent(String(v.id||'')), {
                    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(nv)
                  });
                } catch(e){}
              }
            }
          } catch(e){}

          if (window.piyasa && typeof window.piyasa.reconcileOrderPrintCountsFromReports === 'function') {
            await window.piyasa.reconcileOrderPrintCountsFromReports();
          }
          alert('✅ Raporlar temizlendi.');
          render();
        } catch(e) {
          alert('❌ Temizleme işlemi başarısız.');
        }
      });
    }

    // toplu silme (seçili satırlar)
    const deleteSelectedBtn = document.getElementById('deleteSelectedBtn');
    if (deleteSelectedBtn) {
      deleteSelectedBtn.addEventListener('click', async () => {
        // ✅ Oturum kontrolü
        if (window.SessionManager && typeof window.SessionManager.requireValidSession === 'function') {
          const isValidSession = await window.SessionManager.requireValidSession();
          if (!isValidSession) {
            return; // Oturum geçersizse işlemi durdur
          }
        }
        
        try {
          const checkboxes = Array.from(document.querySelectorAll('#tbody .selectRowChk:checked'));
          console.log('Seçili checkboxlar:', checkboxes.length);
          if (!checkboxes.length) {
            alert('Lütfen silmek için en az bir satır seçin.');
            return;
          }

          const vehicles = checkboxes.map(chk => {
            const tr = chk.closest('tr');
            return {
              id: tr ? (tr.getAttribute('data-vehicle-id') || chk.getAttribute('data-id') || '') : (chk.getAttribute('data-id') || ''),
              cekiciPlaka: tr ? (tr.getAttribute('data-plate') || '') : ''
            };
          });

          const idsSet = new Set();
          (vehicles || []).forEach(v => {
            const ids = collectPrintEventIdsForVehicle(v) || [];
            ids.forEach(id => idsSet.add(String(id)));
          });

          const ids = Array.from(idsSet);
          console.log('Silinecek kayıt IDleri:', ids);
          if (!ids.length) {
            alert('Seçili satırlar için silinecek kayıt bulunamadı.');
            return;
          }

          const okPass = await ensureDeletePassword();
          if (!okPass) return;

          const ok = await uiConfirm('Seçili satırlara ait yazdırma geçmişi silinecek. Devam edilsin mi?');
          if (!ok) return;

          try {
            const response = await fetch('/api/reports/bulk-delete', {
              method: 'POST',
              headers: { 
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({ ids })
            });
            console.log('Silme yanıtı:', response.status, response.ok);
            if (!response.ok) {
              alert('❌ Silme işlemi başarısız: ' + response.status);
              return;
            }
            if (window.piyasa && typeof window.piyasa.reconcileOrderPrintCountsFromReports === 'function') {
              await window.piyasa.reconcileOrderPrintCountsFromReports();
            }
            try {
              if (typeof window._ihracatOnReportsChanged === 'function') {
                window._ihracatOnReportsChanged();
              }
            } catch (e) {}
            alert('✅ Seçili kayıtlar silindi.');
            render();
          } catch(e) {
            console.error('Silme hatası:', e);
            alert('❌ Silme işlemi başarısız: ' + e.message);
          }
        } catch(e) {
          console.error('deleteSelectedBtn hata:', e);
          alert('❌ Hata: ' + e.message);
        }
      });
    }

    const plate = document.getElementById('plateSearch');
    const sel = document.getElementById('filterSelect');
    if (plate) {
      plate.addEventListener('input', () => { window.__reportsPage = 1; window.clearTimeout(window.__rdeb); window.__rdeb = window.setTimeout(render, 120); });
    }

    bindRowActions();
  }

  async function handleExcelCopy(btn, tr) {
    function safeText(value) {
      return String(value || '').replace(/\t/g, ' ').replace(/\r?\n/g, ' ').trim();
    }

    function formatPhoneForExcel(value) {
      const raw = safeText(value);
      if (!raw || raw === '-') return '-';
      const digits = raw.replace(/\D/g, '');
      let local = digits;
      if (local.length === 11 && local.startsWith('0')) local = local.slice(1);
      if (local.length !== 10) return raw;
      return `(${local.slice(0, 3)}) ${local.slice(3, 6)}-${local.slice(6)}`;
    }

    function buildDateTime(data, dateKeys, timeKeys) {
      const date = dateKeys.map(k => String(data[k] || '').trim()).find(Boolean) || '';
      const time = timeKeys.map(k => String(data[k] || '').trim()).find(Boolean) || '';
      return [date, time].filter(Boolean).join(' ').trim();
    }

    const plate = safeText(tr.getAttribute('data-plate') || '');
    const vehicleId = tr.getAttribute('data-actual-vehicle-id') || tr.getAttribute('data-vehicle-id') || '';
    const sourceData = parseRowEventData(tr);

    let vehicleData = null;
    const hasName = sourceData.sofor || sourceData.soforAdi || sourceData.driverName || sourceData.isim || sourceData.name;
    const hasPhone = sourceData.iletisim || sourceData.phone || sourceData.driverPhone || sourceData.phoneNumber;

    if (!hasName || !hasPhone) {
      if (window.storage && typeof window.storage.load === 'function' && vehicleId) {
        const cached = window.storage.load('vehicle_' + vehicleId);
        if (cached && typeof cached === 'object') vehicleData = cached;
      }
      if (!vehicleData && plate) {
        vehicleData = await lookupVehicleCached(plate);
      }
    }

    const src = Object.assign({}, vehicleData || {}, sourceData);
    const fullFromEvent = safeText(sourceData.sofor || '');
    const firstName = fullFromEvent
      ? safeText(splitSoforForExcel(fullFromEvent).soforAdi)
      : safeText(src.soforAdi || src.driverName || src.isim || src.name || '');
    const lastName = fullFromEvent
      ? safeText(splitSoforForExcel(fullFromEvent).soforSoyadi)
      : safeText(src.soforSoyadi || src.driverSurname || src.soyisim || src.surname || '');
    const fullName = [firstName, lastName].filter(Boolean).join(' ').trim() || '-';
    const phone = formatPhoneForExcel(src.iletisim || src.phone || src.driverPhone || src.phoneNumber || '-');

    let entry = safeText(buildDateTime(src, ['tarih','girisTarihi','girisTarih','giris','entryDate','date'], ['saat','girisSaati','girisSaat','time','entryTime']));
    if (!entry) entry = '-';

    let exit = safeText(buildDateTime(src, ['cikisTarihi','cikisTarih','cikis','exitDate'], ['cikisSaati','cikisSaat','cikisTime','exitTime']));
    if (!exit) exit = entry;
    if (!exit) exit = '-';

    const copyText = [fullName, phone, entry, exit].join('\t');
    await navigator.clipboard.writeText(copyText);
    flashBtnCopied(btn);
  }

  function handleReprint(btn, tr) {
    const vehicleId = tr.getAttribute('data-vehicle-id') || btn.getAttribute('data-id') || '';
    const plate = tr.getAttribute('data-plate') || '';
    if (!vehicleId && !plate) return;

    const d = parseRowEventData(tr);
    const url = new URL('GIRIS.html', window.location.origin);
    if (vehicleId) url.searchParams.set('reprint', vehicleId);
    if (plate) url.searchParams.set('plate', plate);

    const firma = d.firma || d.firmaKodu || d.firmaSelect;
    if (firma) url.searchParams.set('firma', firma);
    if (d.malzeme) url.searchParams.set('malzeme', d.malzeme);
    if (d.sevkYeri) url.searchParams.set('sevkYeri', d.sevkYeri);
    if (d.kantar) url.searchParams.set('kantar', d.kantar);
    if (d.basimYeri) url.searchParams.set('basimYeri', d.basimYeri);
    if (d.ambalaj) url.searchParams.set('ambalaj', d.ambalaj);
    if (d.baskiNotu) url.searchParams.set('baskiNotu', d.baskiNotu);

    try {
      localStorage.setItem('tempReprintData', JSON.stringify(d));
      localStorage.setItem('pendingReprint', JSON.stringify({
        reprint: vehicleId,
        plate: plate,
        at: Date.now()
      }));
    } catch (e) { /* ignore */ }

    if (window.SessionManager && typeof window.SessionManager.openHomeForReprint === 'function') {
      window.SessionManager.openHomeForReprint({ vehicleId: vehicleId, plate: plate });
    } else if (window.SessionManager && typeof window.SessionManager.openHomePage === 'function') {
      window.SessionManager.openHomePage(url.pathname + url.search);
    } else {
      window.location.href = url.toString();
    }
  }

  function collectPrintEventIdsForVehicle(vehicle){
    try{
      if (vehicle && vehicle.id) {
        const exists = (_latestEvents || []).some(ev => ev && String(ev.id) === String(vehicle.id));
        if (exists) return [String(vehicle.id)];
      }
      const plateNorm = normPlate(vehicle.cekiciPlaka || '');
      const evs = (_latestEvents || []).filter(ev => ev && ev.type === 'PRINT' && ev.data);
      const ids = [];
      evs.forEach(ev => {
        try{
          const d = ev.data || {};
          if (d.vehicleId && String(d.vehicleId) === String(vehicle.id)) { if (ev.id) ids.push(String(ev.id)); return; }
          if (d.plaka && normPlate(d.plaka || '') === plateNorm) { if (ev.id) ids.push(String(ev.id)); return; }
        }catch(e){}
      });
      return ids;
    }catch(e){ return []; }
  }

  function bindRowActions() {
    const tbody = document.getElementById('tbody');
    if (!tbody || tbody.__actionBound) return;
    tbody.__actionBound = true;

    tbody.addEventListener('click', async (ev) => {
      const btn = ev.target.closest('.netsisBtn, .copyExcelBtn, .copyWhatsappBtn, .reprintBtn, .deleteRowBtn');
      if (!btn || btn.disabled) return;
      const tr = btn.closest('tr');
      if (!tr) return;

      if (btn.classList.contains('netsisBtn')) {
        flashBtnBusy(btn);
        try {
          const vehicle = await resolveReportRowVehicleData(tr);
          if (await copyNetsisData(vehicle)) flashBtnCopied(btn);
        } catch (e) { /* ignore */ }
        return;
      }

      if (btn.classList.contains('copyWhatsappBtn')) {
        flashBtnBusy(btn);
        try {
          const plate = tr.getAttribute('data-plate') || '';
          const d = parseRowEventData(tr);
          if (await copyWhatsAppData(Object.assign({}, d, { plaka: plate || d.plaka || '' }))) {
            flashBtnCopied(btn);
          }
        } catch (e) { /* ignore */ }
        return;
      }

      if (btn.classList.contains('copyExcelBtn')) {
        flashBtnBusy(btn);
        try {
          await handleExcelCopy(btn, tr);
        } catch (e) { /* ignore */ }
        return;
      }

      if (btn.classList.contains('reprintBtn')) {
        handleReprint(btn, tr);
        return;
      }

      if (btn.classList.contains('deleteRowBtn')) {
        if (window.SessionManager && typeof window.SessionManager.requireValidSession === 'function') {
          const isValidSession = await window.SessionManager.requireValidSession();
          if (!isValidSession) return;
        }

        const v = {
          id: tr.getAttribute('data-vehicle-id') || btn.getAttribute('data-id') || '',
          cekiciPlaka: tr.getAttribute('data-plate') || ''
        };
        if (!v.id && !v.cekiciPlaka) return;

        const okDel = await uiConfirm('Bu kaydın yazdırma geçmişi silinsin mi?');
        if (!okDel) return;
        const okPass = await ensureDeletePassword();
        if (!okPass) return;

        const eventId = tr.getAttribute('data-print-event-id') || tr.getAttribute('data-vehicle-id') || btn.getAttribute('data-id') || '';
        const ids = eventId ? [String(eventId)] : (collectPrintEventIdsForVehicle(v) || []);
        if (!ids.length) {
          uiAlert('Silinecek kayıt bulunamadı.', 'warning');
          return;
        }
        try {
          await fetch('/api/reports/bulk-delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids })
          });
          if (window.piyasa && typeof window.piyasa.reconcileOrderPrintCountsFromReports === 'function') {
            await window.piyasa.reconcileOrderPrintCountsFromReports();
          }
          try {
            if (typeof window._ihracatOnReportsChanged === 'function') {
              window._ihracatOnReportsChanged();
            }
          } catch (e) {}
          uiAlert('Kayıt silindi.', 'success');
          render();
        } catch (e) {
          uiAlert('Silme işlemi başarısız: ' + e.message, 'danger');
        }
      }
    });
  }

  async function ensureDeletePassword(){
    try{
      const entered = await uiPassword('Silme şifresini giriniz:');
      if (entered == null || entered === false) return false;
      if (String(entered).trim() !== DELETE_PASSWORD){
        uiAlert('Şifre hatalı.', 'danger');
        return false;
      }
      return true;
    }catch(e){ return false; }
  }

    bind();
    render();
    
    // 🔄 UNIFIED CROSS-TAB SYNCHRONIZATION
    function initReportSync() {
      // Wait for SyncManager to be available
      function waitForSyncManager() {
        if (window.SyncManager) {
          console.log('🔄 Reports page: Using unified sync manager');
          
          // Register report-specific handlers
          window.SyncManager.on('new_report', (data) => {
            console.log('🔄 New report received:', data);
            render();
          });
          
          window.SyncManager.on('report_deleted', (data) => {
            console.log('🔄 Report deleted:', data);
            render();
          });
          
          window.SyncManager.on('reports_deleted', (data) => {
            console.log('🔄 Multiple reports deleted:', data);
            render();
          });
          
          // Manual refresh trigger
          window.SyncManager.on('manual_refresh', (data) => {
            if (data.dataType === 'reports' || data.dataType === 'all') {
              console.log('🔄 Manual refresh for reports');
              render();
            }
          });
          
        } else {
          // Fallback to standalone SSE if SyncManager not available
          setTimeout(waitForSyncManager, 100);
        }
      }
      
      waitForSyncManager();
    }
    
    // Initialize synchronization
    initReportSync();
})();
