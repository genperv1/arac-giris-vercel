// report.js
(function(){
  const DELETE_PASSWORD = '2026genper';

  function uiHelpers() { return window.rpUi || {}; }

  function uiPassword(message) {
    const u = uiHelpers();
    if (typeof u.password === 'function') return u.password(message);
    return Promise.resolve(window.prompt(message));
  }

  function uiAlert(message, type) {
    const u = uiHelpers();
    if (typeof u.alert === 'function') return u.alert(message, type);
    alert(message);
    return Promise.resolve();
  }

  function uiConfirm(message) {
    const u = uiHelpers();
    if (typeof u.confirm === 'function') return u.confirm(message);
    return Promise.resolve(confirm(message));
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

  function copyNetsisVehicleText(vehicle) {
    if (!vehicle) return '';
    const values = [
      normalizeNetsisPlate(vehicle.cekiciPlaka),
      vehicle.soforAdi || '',
      vehicle.soforSoyadi || '',
      normalizeNetsisPhone(vehicle.iletisim),
      vehicle.tcKimlik || '',
      normalizeNetsisPlate(vehicle.dorsePlaka)
    ].filter(Boolean);
    return values.join('\n');
  }

  function copyNetsisData(vehicle) {
    const text = copyNetsisVehicleText(vehicle);
    if (!text) {
      uiAlert('NETSIS verisi bulunamadı.', 'warning');
      return;
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => {
        uiAlert('NETSIS verileri kopyalandı.', 'success');
      }).catch(() => {
        uiAlert('Kopyalama yapılamadı.', 'danger');
      });
    } else {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.left = '-9999px';
      document.body.appendChild(textarea);
      textarea.select();
      try {
        document.execCommand('copy');
        uiAlert('NETSIS verileri kopyalandı.', 'success');
      } catch (e) {
        uiAlert('Kopyalama yapılamadı.', 'danger');
      }
      textarea.remove();
    }
  }
  // ===== NETSIS FONKSIYONLARI BITTI =====

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

  // pagination defaults (client-side)
  if (!window.__reportsPage) window.__reportsPage = 1;
  if (!window.__reportsPageSize) window.__reportsPageSize = 10; // default page size

  function normPlate(s){
    return String(s||'').toLowerCase().replace(/[\s-]+/g,'');
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

    function findLastPrintEvent(vehicle){
      try{
        // if this row was built from an event, return that event directly
        if (vehicle && vehicle.rawEvent) return vehicle.rawEvent;
        const plateNorm = normPlate(vehicle.cekiciPlaka || '');
        const evs = (events || []).filter(ev => ev && ev.type === 'PRINT' && ev.data);
        const matched = evs.filter(ev => {
          try{
            const d = ev.data || {};
            if (d.vehicleId && String(d.vehicleId) === String(vehicle.id)) return true;
            if (d.plaka && normPlate(d.plaka || '') === plateNorm) return true;
            if (ev.id && String(ev.id) === String(vehicle.id)) return true;
          }catch(e){}
          return false;
        });
        if (!matched.length) return null;
        matched.sort((a,b)=>Number(b.ts||0) - Number(a.ts||0));
        return matched[0];
      }catch(e){return null;}
    }

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

      // find last PRINT event for this vehicle
      const lastEv = findLastPrintEvent(v);
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

      tr.innerHTML = `
        <td class="p-3 col-plate font-semibold">${plate || '-'}</td>
        <td class="p-3">${( (lastEv && (lastEv.data && (lastEv.data.firma || lastEv.data.firmaKodu || lastEv.data.firmaSelect))) || v.defaultFirma ) ? (lastEv && lastEv.data && (lastEv.data.firma || lastEv.data.firmaKodu || lastEv.data.firmaSelect) || v.defaultFirma) : '-'}</td>
        <td class="p-3">${(function(){
            const tr = ts ? trDateTimeFromMs(ts) : null;
            const dateStr = tr ? tr.tarih : ((d && d.tarih) ? (d.tarih || '-') : '-');
            const timeStr = tr ? tr.saat : (((d && d.saat) ? d.saat : (lastEv && lastEv.saat)) || '');
            return '<div style="font-weight:700">' + (dateStr || '-') + '</div>' + (timeStr ? ('<div style="font-size:12px;opacity:.85">' + timeStr + '</div>') : '');
          })()}</td>
        <td class="p-3">${basim || '-'}</td>
        <td class="p-3">${lastPrintHtml}</td>
        <td class="p-3">
          <div class="flex items-center gap-2 whitespace-nowrap">
            <button class="report-action-btn netsisBtn"
              data-id="${String(v.id||'')}" data-event-data='${JSON.stringify(d)}' title="NETSIS verilerini kopyala">
              <i class="fas fa-link"></i> NETSIS
            </button>
            <button class="report-action-btn copyRowBtn"
              data-id="${String(v.id||'')}" title="Araç giriş WhatsApp için kopyala">
              <i class="fab fa-whatsapp"></i> WhatsApp
            </button>
            <button class="report-action-btn copyExcelBtn"
              data-id="${String(v.id||'')}" title="Excel için satırı kopyala">
              <i class="fas fa-file-excel"></i> Excel
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

    // ===== bind NETSIS button =====
    tbody.querySelectorAll('.netsisBtn').forEach(btn => {
      if (btn.__boundNetsis) return;
      btn.__boundNetsis = true;
      btn.addEventListener('click', async () => {
        try {
          const tr = btn.closest('tr');
          if (!tr) return;
          
          // Get vehicle data from button's data-event-data attribute
          const eventDataStr = btn.getAttribute('data-event-data') || tr.getAttribute('data-event-data') || '{}';
          let d = {};
          try {
            d = JSON.parse(eventDataStr);
          } catch(e) { d = {}; }
          
          const plate = tr.getAttribute('data-plate') || d.plaka || '';
          const vehicleId = tr.getAttribute('data-actual-vehicle-id') || tr.getAttribute('data-vehicle-id') || '';
          
          // Try to get complete vehicle data from cache or API (like copyExcelBtn does)
          let vehicleData = null;
          const hasName = d.sofor || d.soforAdi || d.driverName || d.isim || d.name;
          const hasPhone = d.iletisim || d.phone || d.driverPhone || d.phoneNumber;
          const hasTC = d.tcKimlik || d.tc;
          const hasDorse = d.dorsePlaka || d.dorse;
          
          if (!hasName || !hasPhone || !hasTC || !hasDorse) {
            try {
              if (window.storage && typeof window.storage.load === 'function' && vehicleId) {
                const cached = window.storage.load('vehicle_' + vehicleId);
                if (cached && typeof cached === 'object') {
                  vehicleData = cached;
                }
              }
              if (!vehicleData && plate) {
                try {
                  const resp = await fetch('/api/vehicles/lookup?plate=' + encodeURIComponent(plate));
                  if (resp.ok) {
                    vehicleData = await resp.json();
                    if (vehicleData && typeof vehicleData === 'object' && !Array.isArray(vehicleData)) {
                      // ok — single vehicle object
                    } else {
                      vehicleData = null;
                    }
                  }
                } catch(e) {}
              }
            } catch (e) {
              console.warn('Vehicle lookup for NETSIS failed:', e);
            }
          }
          
          // Merge data: event data + retrieved vehicle data
          const fullVehicleData = Object.assign({}, vehicleData || {}, d);
          
          // Construct vehicle object from merged data
          const vehicle = {
            cekiciPlaka: fullVehicleData.cekiciPlaka || fullVehicleData.plaka || plate || '',
            soforAdi: fullVehicleData.sofor || fullVehicleData.soforAdi || fullVehicleData.driverName || fullVehicleData.isim || fullVehicleData.name || '',
            soforSoyadi: fullVehicleData.soforSoyadi || fullVehicleData.driverSurname || fullVehicleData.soyisim || fullVehicleData.surname || '',
            iletisim: fullVehicleData.iletisim || fullVehicleData.phone || fullVehicleData.driverPhone || fullVehicleData.phoneNumber || '',
            tcKimlik: fullVehicleData.tcKimlik || fullVehicleData.tc || '',
            dorsePlaka: fullVehicleData.dorsePlaka || fullVehicleData.dorse || ''
          };
          
          copyNetsisData(vehicle);
        } catch(e) {
          console.error('NETSIS button error:', e);
          uiAlert('NETSIS verisi kopyalanırken hata oluştu.', 'danger');
        }
      });
    });
    // ===== NETSIS button binding bitti =====

    // bind reprint
    tbody.querySelectorAll('.reprintBtn').forEach(btn => {
      if (btn.__bound) return;
      btn.__bound = true;
      btn.addEventListener('click', () => {
        const tr = btn.closest('tr');
        if (!tr) return;
        const vehicleId = tr.getAttribute('data-vehicle-id') || btn.getAttribute('data-id') || '';
        const plate = tr.getAttribute('data-plate') || '';
        const eventDataStr = tr.getAttribute('data-event-data') || '';
        
        if (!vehicleId && !plate) return;
        try{
          // Vehicle ID'sini URL parametresi olarak GIRIS.html'e gönder
          const url = new URL('GIRIS.html', window.location.origin);
          if (vehicleId) url.searchParams.set('reprint', vehicleId);
          if (plate) url.searchParams.set('plate', plate);
          
          // Tablodaki tüm event data'sını kullan
          let d = {};
          try {
            if (eventDataStr) d = JSON.parse(eventDataStr);
          } catch(e) {}
          
          // Eğer data yoksa lastEv'den al (fallback)
          if (!d || !Object.keys(d).length) {
            const v = { id: vehicleId, cekiciPlaka: plate };
            const lastEv = findLastPrintEvent(v);
            if (lastEv && lastEv.data) d = lastEv.data;
          }
          
          // Firma: firma || firmaKodu || firmaSelect (aynı tabloda olduğu gibi)
          const firma = d.firma || d.firmaKodu || d.firmaSelect;
          if (firma) url.searchParams.set('firma', firma);
          if (d.malzeme) url.searchParams.set('malzeme', d.malzeme);
          if (d.sevkYeri) url.searchParams.set('sevkYeri', d.sevkYeri);
          if (d.kantar) url.searchParams.set('kantar', d.kantar);
          if (d.basimYeri) url.searchParams.set('basimYeri', d.basimYeri);
          if (d.ambalaj) url.searchParams.set('ambalaj', d.ambalaj);
          if (d.baskiNotu) url.searchParams.set('baskiNotu', d.baskiNotu);
          
          console.log('🔍 Oluşturulan URL:', url.toString());
          
          // Event data'yı localStorage'a geçici olarak kaydet (app.js'de kullanılacak)
          try {
            localStorage.setItem('tempReprintData', JSON.stringify(d));
            console.log('🔍 Event data localStorage\'a kaydedildi:', d);
          } catch(e) {
            console.error('🔍 Event data kaydetme hatası:', e);
          }
          
          window.location.href = url.toString();
        }catch(e){
          console.error('Reprint error:', e);
          alert('❌ Tekrar yazdırma isteği başarısız.');
        }
      });
    });

    // bind single-row delete
    tbody.querySelectorAll('.deleteRowBtn').forEach(btn => {
      if (btn.__boundDel) return;
      btn.__boundDel = true;
      btn.addEventListener('click', async () => {
        // ✅ Oturum kontrolü
        if (window.SessionManager && typeof window.SessionManager.requireValidSession === 'function') {
          const isValidSession = await window.SessionManager.requireValidSession();
          if (!isValidSession) {
            return; // Oturum geçersizse işlemi durdur
          }
        }

        const tr = btn.closest('tr');
        if (!tr) return;
        const v = {
          id: tr.getAttribute('data-vehicle-id') || btn.getAttribute('data-id') || '',
          cekiciPlaka: tr.getAttribute('data-plate') || ''
        };
        if (!v.id && !v.cekiciPlaka) return;

        const okDel = await uiConfirm('Bu kaydın yazdırma geçmişi silinsin mi?');
        if (!okDel) return;
        const okPass = await ensureDeletePassword();
        if (!okPass) return;

        const ids = collectPrintEventIdsForVehicle(v) || [];
        if (!ids.length) {
          uiAlert('Silinecek kayıt bulunamadı.', 'warning');
          return;
        }
        try {
          await fetch('/api/reports/bulk-delete', {
            method: 'POST',
            headers: { 
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ ids })
          });
          uiAlert('Kayıt silindi.', 'success');
          render();
        } catch(e) {
          uiAlert('Silme işlemi başarısız: ' + e.message, 'danger');
        }
      });
    });

    // bind row copy (kopyalama)
    tbody.querySelectorAll('.copyRowBtn').forEach(btn => {
      if (btn.__boundCopy) return;
      btn.__boundCopy = true;
      btn.addEventListener('click', async () => {
        const tr = btn.closest('tr');
        if (!tr) return;
        
        try {
          // Satırdan verileri oku (td elementlerinden)
          const tds = tr.querySelectorAll('td');
          if (tds.length < 5) {
            alert('❌ Satır verileri okunamadı.');
            return;
          }
          
          // td'lerden text content'i al
          const plaka = tds[0].textContent.trim() || '-';
          const firma = tds[1].textContent.trim() || '-';
          const basimYeri = tds[3].textContent.trim() || '-';
          const yazdirmaInfo = tds[4].textContent
            .replace(/[📍📦]/g, '•')
            .replace(/\s+/g, ' ')
            .replace(/•\s*•+/g, '•')
            .trim() || '-';
          
          // Kopyalanacak metni oluştur
          const copyText = `Plaka: ${plaka}
Firma: ${firma}
Giriş Yeri: ${basimYeri}
Bilgi: ${yazdirmaInfo}
GİRİŞ YAPTI.`;
          
          // Clipboard'a kopyala
          await navigator.clipboard.writeText(copyText);
          
          // Kullanıcıya bildir
          const originalHTML = btn.innerHTML;
          const originalBg = btn.style.backgroundColor;
          btn.innerHTML = '<i class="fab fa-whatsapp"></i> Kopyalandı';
          btn.style.backgroundColor = '#059669';
          btn.style.color = 'white';
          setTimeout(() => {
            btn.innerHTML = originalHTML;
            btn.style.backgroundColor = originalBg;
            btn.style.color = '';
          }, 1500);
        } catch(e) {
          console.error('Kopyalama hatası:', e);
          alert('❌ Kopyalama işlemi başarısız. Tarayıcı klipboarda erişime izin veremedi.');
        }
      });
    });

    // bind Excel row copy
    tbody.querySelectorAll('.copyExcelBtn').forEach(btn => {
      if (btn.__boundExcel) return;
      btn.__boundExcel = true;
      btn.addEventListener('click', async () => {
        const tr = btn.closest('tr');
        if (!tr) return;

        function safeText(value) {
          return String(value || '').replace(/\t/g, ' ').replace(/\r?\n/g, ' ').trim();
        }

        function formatPhoneForExcel(value) {
          const raw = safeText(value);
          if (!raw || raw === '-') return '-';
          const digits = raw.replace(/\D/g, '');
          // Accept 10 digits (5xx...) or 11 digits with leading 0 (05xx...)
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

        try {
          const plate = safeText(tr.getAttribute('data-plate') || '');
          const vehicleId = tr.getAttribute('data-actual-vehicle-id') || tr.getAttribute('data-vehicle-id') || '';
          const eventDataStr = tr.getAttribute('data-event-data') || '';
          let d = {};
          if (eventDataStr) {
            try { d = JSON.parse(eventDataStr); } catch (e) { d = {}; }
          }

          console.log('📋 Excel Copy Debug - Plate:', plate, 'VehicleId:', vehicleId);
          console.log('📋 Event Data:', d);

          const lastEv = findLastPrintEvent({ id: vehicleId, cekiciPlaka: plate });
          const lastEvData = (lastEv && lastEv.data && typeof lastEv.data === 'object') ? lastEv.data : {};
          const sourceData = Object.assign({}, lastEvData, d);

          console.log('📋 Last Event Data:', lastEvData);
          console.log('📋 Merged Source Data:', sourceData);

          let vehicleData = null;
          const hasName = sourceData.sofor || sourceData.soforAdi || sourceData.driverName || sourceData.isim || sourceData.name;
          const hasPhone = sourceData.iletisim || sourceData.phone || sourceData.driverPhone || sourceData.phoneNumber;
          
          console.log('📋 Has Name:', hasName, 'Has Phone:', hasPhone);
          if (!hasName || !hasPhone) {
            try {
              if (window.storage && typeof window.storage.load === 'function' && vehicleId) {
                const cached = window.storage.load('vehicle_' + vehicleId);
                if (cached && typeof cached === 'object') {
                  vehicleData = cached;
                }
              }
              if (!vehicleData) {
                // Always try plate matching first since print_history and vehicles use different ID formats
                if (plate) {
                  console.log('🔍 Looking up vehicle by plate:', plate);
                  const resp = await fetch('/api/vehicles/lookup?plate=' + encodeURIComponent(plate));
                  if (resp.ok) {
                    vehicleData = await resp.json();
                    if (vehicleData && typeof vehicleData === 'object' && !Array.isArray(vehicleData)) {
                      // ok
                    } else {
                      vehicleData = null;
                    }
                    console.log('🔍 Found vehicle by plate:', vehicleData);
                  }
                }
                // Skip vehicle ID lookup to avoid 404 errors
              }
            } catch (e) {
              console.warn('Excel copy vehicle lookup failed:', e);
            }
          }
          const src = Object.assign({}, sourceData, vehicleData || {});

          const firstName = safeText(src.sofor || src.soforAdi || src.driverName || src.isim || src.name || '');
          const lastName = safeText(src.soforSoyadi || src.driverSurname || src.soyisim || src.surname || '');
          const fullName = [firstName, lastName].filter(Boolean).join(' ').trim() || '-';
          const phone = formatPhoneForExcel(src.iletisim || src.phone || src.driverPhone || src.phoneNumber || '-');
          
          console.log('📋 Final Driver Data - First Name:', firstName, 'Last Name:', lastName, 'Full Name:', fullName, 'Phone:', phone);

          let entry = safeText(buildDateTime(src, ['tarih','girisTarihi','girisTarih','giris','entryDate','date'], ['saat','girisSaati','girisSaat','time','entryTime']));
          if (!entry && lastEv) {
            const date = safeText(lastEv.tarih || lastEvData.tarih || '');
            let time = safeText(lastEv.saat || lastEvData.saat || '');
            // If no time available, use timestamp to generate time in consistent format (Turkey timezone)
            if (!time && lastEv.ts) {
              const tr = trDateTimeFromMs(lastEv.ts);
              if (tr) time = tr.saat;
            }
            entry = [date, time].filter(Boolean).join(' ').trim() || '-';
          }
          if (!entry) entry = '-';

          let exit = safeText(buildDateTime(src, ['cikisTarihi','cikisTarih','cikis','exitDate'], ['cikisSaati','cikisSaat','cikisTime','exitTime']));
          if (!exit) {
            exit = entry;
          }
          if (!exit) exit = '-';

          const copyText = [fullName, phone, entry, exit].join('\t');
          
          // Show immediate feedback before clipboard operation
          const originalHTML = btn.innerHTML;
          const originalBg = btn.style.backgroundColor;
          btn.innerHTML = '<i class="fas fa-file-excel"></i> Excel';
          btn.style.backgroundColor = '#059669';
          btn.style.color = 'white';
          
          // Perform clipboard operation
          await navigator.clipboard.writeText(copyText);
          
          // Reset button after delay
          setTimeout(() => {
            btn.innerHTML = originalHTML;
            btn.style.backgroundColor = originalBg;
            btn.style.color = '';
          }, 1500);
        } catch (e) {
          console.error('Excel kopyalama hatası:', e);
          alert('❌ Excel kopyalama başarısız. Tarayıcı klipboarda erişime izin veremedi.');
        }
      });
    });
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
        const ok = confirm('🧹 Rapor kayıtları (yazdırma geçmişi) temizlenecek.\nAraç kayıtları silinmez. Devam edilsin mi?');
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

          const ok = confirm('Seçili satırlara ait yazdırma geçmişi silinecek. Devam edilsin mi?');
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
