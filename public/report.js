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

  function istanbulIsoDateFromMs(ms) {
    try {
      const d = new Date(Number(ms));
      if (isNaN(d.getTime())) return '';
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: REPORT_TZ,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }).formatToParts(d);
      const y = (parts.find((p) => p.type === 'year') || {}).value;
      const m = (parts.find((p) => p.type === 'month') || {}).value;
      const day = (parts.find((p) => p.type === 'day') || {}).value;
      if (!y || !m || !day) return '';
      return y + '-' + m + '-' + day;
    } catch (e) {
      return '';
    }
  }

  function getIstanbulTodayIso() {
    return istanbulIsoDateFromMs(Date.now());
  }

  function addDaysIso(iso, deltaDays) {
    const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return '';
    const dt = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
    dt.setUTCDate(dt.getUTCDate() + Number(deltaDays || 0));
    const y = dt.getUTCFullYear();
    const mo = String(dt.getUTCMonth() + 1).padStart(2, '0');
    const day = String(dt.getUTCDate()).padStart(2, '0');
    return y + '-' + mo + '-' + day;
  }

  function startOfMonthIso(iso) {
    const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return '';
    return m[1] + '-' + m[2] + '-01';
  }

  function resolveDatePreset(preset) {
    const today = getIstanbulTodayIso();
    const key = String(preset || '').trim();
    if (key === 'today') return { from: today, to: today, preset: 'today' };
    if (key === 'yesterday') {
      const y = addDaysIso(today, -1);
      return { from: y, to: y, preset: 'yesterday' };
    }
    if (key === '7d') return { from: addDaysIso(today, -6), to: today, preset: '7d' };
    if (key === '30d') return { from: addDaysIso(today, -29), to: today, preset: '30d' };
    if (key === 'month') return { from: startOfMonthIso(today), to: today, preset: 'month' };
    return { from: '', to: '', preset: 'all' };
  }

  function detectDatePreset(from, to) {
    const f = String(from || '').trim();
    const t = String(to || '').trim();
    if (!f && !t) return 'all';
    const presets = ['today', 'yesterday', '7d', '30d', 'month'];
    for (let i = 0; i < presets.length; i++) {
      const r = resolveDatePreset(presets[i]);
      if (r.from === f && r.to === t) return r.preset;
    }
    return 'custom';
  }

  function rowMatchesDateRange(row) {
    const from = String(window.__reportsDateFrom || '').trim();
    const to = String(window.__reportsDateTo || '').trim();
    if (!from && !to) return true;
    const key = istanbulIsoDateFromMs(reportRowPrintTs(row));
    if (!key) return false;
    if (from && key < from) return false;
    if (to && key > to) return false;
    return true;
  }

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
    try{
      const raw = localStorage.getItem('daily_shipments_meta');
      if (raw) return JSON.parse(raw) || {};
    }catch(e){}
    return {};
  }
  async function getDailyCount(){
    try{
      const raw = localStorage.getItem('daily_shipments_current');
      if (raw) {
        const a = JSON.parse(raw);
        return Array.isArray(a) ? a.length : 0;
      }
    }catch(e){}
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
  if (window.__reportsOzmalFilter == null) window.__reportsOzmalFilter = false;
  if (window.__reportsBasimYeriFilter == null) window.__reportsBasimYeriFilter = '';
  if (window.__reportsDateFrom == null) window.__reportsDateFrom = '';
  if (window.__reportsDateTo == null) window.__reportsDateTo = '';
  if (window.__reportsDatePreset == null) window.__reportsDatePreset = 'all';
  if (window.__reportsShiftFilter == null) window.__reportsShiftFilter = '';
  // Eski "bugün" bayrağını tarih aralığına taşı
  if (window.__reportsTodayFilter) {
    const todayIso = getIstanbulTodayIso();
    window.__reportsDateFrom = todayIso;
    window.__reportsDateTo = todayIso;
    window.__reportsDatePreset = 'today';
    window.__reportsTodayFilter = false;
  }

  function timeStrToMinutes(s) {
    try {
      if (!s) return null;
      const m = String(s || '').trim().match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
      if (!m) return null;
      const hh = parseInt(m[1], 10);
      const mm = parseInt(m[2], 10);
      if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
      return hh * 60 + mm;
    } catch (e) {
      return null;
    }
  }

  function istanbulMinutesFromMs(ms) {
    try {
      const d = new Date(Number(ms));
      if (isNaN(d.getTime())) return null;
      const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: REPORT_TZ,
        hour: 'numeric',
        minute: 'numeric',
        hour12: false,
        hourCycle: 'h23'
      }).formatToParts(d);
      const h = parseInt((parts.find((p) => p.type === 'hour') || {}).value, 10);
      const m = parseInt((parts.find((p) => p.type === 'minute') || {}).value, 10);
      if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
      return h * 60 + m;
    } catch (e) {
      return null;
    }
  }

  function eventIstanbulMinutes(ev) {
    if (!ev) return null;
    const d = ev.data || {};
    let mins = timeStrToMinutes(d.saat || d.time || ev.saat || '');
    if (mins != null) return mins;
    const ts = Number(ev.ts || 0);
    if (ts) return istanbulMinutesFromMs(ts);
    return null;
  }

  /** night: 00:00-08:00, day: 08:00-18:00 */
  function classifyShiftFromMinutes(mins) {
    if (mins == null || !Number.isFinite(mins)) return null;
    if (mins >= 0 && mins < 8 * 60) return 'night';
    if (mins >= 8 * 60 && mins < 18 * 60) return 'day';
    return null;
  }

  function eventShiftKey(ev) {
    const d = (ev && ev.data) || {};
    const vardiya = String(d.vardiya || '').toLowerCase().trim();
    if (vardiya === 'gece' || vardiya === 'night') return 'night';
    if (vardiya === 'gündüz' || vardiya === 'gunduz' || vardiya === 'day') return 'day';
    return classifyShiftFromMinutes(eventIstanbulMinutes(ev));
  }

  function emptyShiftBucket() {
    return { total: 0, AVDAN: 0, '1.OSB': 0 };
  }

  function emptyShiftStats() {
    return {
      todayKey: getIstanbulTodayKey(),
      night: emptyShiftBucket(),
      day: emptyShiftBucket()
    };
  }

  function computeTodayShiftStats(events) {
    const stats = emptyShiftStats();
    const todayKey = stats.todayKey;
    (events || []).forEach((ev) => {
      if (!ev || ev.type !== 'PRINT') return;
      const ts = Number(ev.ts || 0);
      if (!ts || istanbulDateKeyFromMs(ts) !== todayKey) return;
      const shift = eventShiftKey(ev);
      if (!shift) return;
      const site = eventBasimYeri(ev);
      stats[shift].total += 1;
      if (stats[shift][site] != null) stats[shift][site] += 1;
    });
    return stats;
  }

  function reportRowShiftKey(row) {
    if (!row) return null;
    if (row.rawEvent) return eventShiftKey(row.rawEvent);
    const ts = reportRowPrintTs(row);
    if (!ts) return null;
    return classifyShiftFromMinutes(istanbulMinutesFromMs(ts));
  }

  function reportRowBasimYeri(row) {
    if (!row) return '';
    const d = (row.rawEvent && row.rawEvent.data) || row.lastPrintSnapshot || {};
    return String(d.basimYeri || '').trim().toUpperCase();
  }

  function reportRowIsOzmal(row) {
    if (!row) return false;
    const d = (row.rawEvent && row.rawEvent.data) || row.lastPrintSnapshot || {};
    const vehicleLike = {
      cekiciPlaka: row.cekiciPlaka || d.plaka || d.plate || '',
      dorsePlaka: d.dorsePlaka || d.dorse || ''
    };
    try {
      if (typeof vehicleIsOzmal === 'function') return vehicleIsOzmal(vehicleLike);
      if (typeof isOzmalPlate === 'function') return isOzmalPlate(vehicleLike.cekiciPlaka) || isOzmalPlate(vehicleLike.dorsePlaka);
    } catch (e) { /* ignore */ }
    return false;
  }

  function reportRowMaterialText(row) {
    if (!row) return '';
    const ev = row.rawEvent || {};
    const d = (ev.data && typeof ev.data === 'object') ? ev.data : (row.lastPrintSnapshot || {});
    const parts = [
      row.defaultFirma,
      d.firma,
      d.firmaKodu,
      d.firmaSelect,
      ev.firma,
      d.malzeme,
      d.malzemeSelect,
      ev.malzeme,
      d.sevkYeri,
      ev.sevkYeri,
      d.yuklemeTuru,
      d.ambalajBilgisi,
      d.yuklemeNotu,
      d.tonaj
    ];
    return parts.map((x) => String(x || '').trim()).filter(Boolean).join(' ');
  }

  function rowMatchesMaterialQuery(row, mq) {
    if (!mq) return true;
    const haystack = normMaterial(reportRowMaterialText(row));
    if (haystack.includes(mq)) return true;

    const ev = row.rawEvent || {};
    const d = (ev.data && typeof ev.data === 'object') ? ev.data : (row.lastPrintSnapshot || {});
    const firmaCodes = [
      row.defaultFirma,
      d.firma,
      d.firmaKodu,
      d.firmaSelect,
      ev.firma
    ].map((x) => normMaterial(x)).filter(Boolean);

    if (/^hp\d+$/i.test(mq.replace(/\s+/g, ''))) {
      const code = mq.replace(/\s+/g, '');
      if (firmaCodes.some((f) => f === code)) return true;
    }

    return firmaCodes.some((f) => f.includes(mq));
  }

  function reportRowPrintTs(row) {
    if (!row) return 0;
    const ev = row.rawEvent;
    const snap = row.lastPrintSnapshot;
    return Number((ev && ev.ts) || (snap && snap.ts) || 0) || 0;
  }

  function formatIsoTr(iso) {
    const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return String(iso || '');
    return m[3] + '.' + m[2] + '.' + m[1];
  }

  function describeDateRange() {
    const from = String(window.__reportsDateFrom || '').trim();
    const to = String(window.__reportsDateTo || '').trim();
    const preset = String(window.__reportsDatePreset || '').trim();
    if (!from && !to) return '';
    if (preset === 'today' || (from && from === to && from === getIstanbulTodayIso())) return 'Bugün';
    if (preset === 'yesterday') return 'Dün';
    if (preset === '7d') return 'Son 7 gün';
    if (preset === '30d') return 'Son 30 gün';
    if (preset === 'month') return 'Bu ay';
    if (from && to && from === to) return formatIsoTr(from);
    if (from && to) return formatIsoTr(from) + ' – ' + formatIsoTr(to);
    if (from) return formatIsoTr(from) + ' sonrası';
    return formatIsoTr(to) + ' öncesi';
  }

  function syncDateInputs() {
    const fromEl = document.getElementById('dateFromInput');
    const toEl = document.getElementById('dateToInput');
    const todayIso = getIstanbulTodayIso();
    const from = String(window.__reportsDateFrom || '').trim();
    const to = String(window.__reportsDateTo || '').trim();
    if (fromEl) {
      fromEl.value = from;
      fromEl.max = todayIso;
      if (to) fromEl.max = to < todayIso ? to : todayIso;
    }
    if (toEl) {
      toEl.value = to;
      toEl.max = todayIso;
      if (from) toEl.min = from;
      else toEl.removeAttribute('min');
    }
    const preset = String(window.__reportsDatePreset || 'all').trim() || 'all';
    document.querySelectorAll('.rp-preset[data-range]').forEach((btn) => {
      const key = String(btn.getAttribute('data-range') || '');
      btn.classList.toggle('is-active', key === preset);
    });
  }

  function syncActiveFiltersBar() {
    const plateQ = String((document.getElementById('plateSearch') || {}).value || '').trim();
    const materialQ = String((document.getElementById('materialSearch') || {}).value || '').trim();
    const dateLabel = describeDateRange();
    const basim = String(window.__reportsBasimYeriFilter || '').trim();
    const shift = String(window.__reportsShiftFilter || '').trim();
    const ozmal = !!window.__reportsOzmalFilter;

    const pillDate = document.getElementById('activePillDate');
    const pillBasim = document.getElementById('activePillBasim');
    const pillShift = document.getElementById('activePillShift');
    const pillOzmal = document.getElementById('activePillOzmal');
    const pillSearch = document.getElementById('activePillSearch');
    const emptyEl = document.getElementById('activeFiltersEmpty');
    const clearBtn = document.getElementById('clearFiltersBtn');

    if (pillDate) {
      pillDate.hidden = !dateLabel;
      if (dateLabel) pillDate.innerHTML = '<i class="fas fa-calendar-alt" aria-hidden="true"></i> ' + dateLabel;
    }
    if (pillBasim) {
      pillBasim.hidden = !basim;
      if (basim) pillBasim.textContent = basim;
    }
    if (pillShift) {
      pillShift.hidden = !shift;
      if (shift === 'night') pillShift.innerHTML = '<i class="fas fa-moon" aria-hidden="true"></i> Gece';
      else if (shift === 'day') pillShift.innerHTML = '<i class="fas fa-sun" aria-hidden="true"></i> Gündüz';
    }
    if (pillOzmal) pillOzmal.hidden = !ozmal;
    if (pillSearch) {
      const parts = [];
      if (plateQ) parts.push('Plaka: ' + plateQ);
      if (materialQ) parts.push(materialQ);
      pillSearch.hidden = !parts.length;
      if (parts.length) pillSearch.innerHTML = '<i class="fas fa-search" aria-hidden="true"></i> ' + parts.join(' · ');
    }

    const hasAny = !!(dateLabel || basim || shift || ozmal || plateQ || materialQ);
    if (emptyEl) emptyEl.hidden = hasAny;
    if (clearBtn) clearBtn.disabled = !hasAny;
  }

  function syncFilterBtns() {
    const ozmalBtn = document.getElementById('ozmalFilterBtn');
    if (ozmalBtn) ozmalBtn.classList.toggle('is-active', !!window.__reportsOzmalFilter);

    syncDateInputs();

    const shiftFilter = String(window.__reportsShiftFilter || '').trim();
    const nightBtn = document.getElementById('shiftNightFilterBtn');
    if (nightBtn) nightBtn.classList.toggle('is-active', shiftFilter === 'night');
    const dayBtn = document.getElementById('shiftDayFilterBtn');
    if (dayBtn) dayBtn.classList.toggle('is-active', shiftFilter === 'day');

    const basimFilter = String(window.__reportsBasimYeriFilter || '').trim();
    ['avdanFilterBtn', 'osb1FilterBtn'].forEach((id) => {
      const btn = document.getElementById(id);
      if (!btn) return;
      const site = String(btn.getAttribute('data-site') || '').trim();
      btn.classList.toggle('is-active', !!site && basimFilter === site);
    });

    syncActiveFiltersBar();
  }

  function syncOzmalFilterBtn() {
    syncFilterBtns();
  }

  function reportsEmptyMessage(plateQ, materialQ) {
    const ozmal = !!window.__reportsOzmalFilter;
    const dateLabel = describeDateRange();
    const basim = String(window.__reportsBasimYeriFilter || '').trim();
    const shift = String(window.__reportsShiftFilter || '').trim();
    const hasSearch = !!(plateQ || materialQ);
    const filterParts = [];
    if (dateLabel) filterParts.push(dateLabel);
    if (shift === 'night') filterParts.push('gece (00–08)');
    if (shift === 'day') filterParts.push('gündüz (08–18)');
    if (ozmal) filterParts.push('özmal');
    if (basim) filterParts.push(basim);
    const filterHint = filterParts.length ? (' (' + filterParts.join(', ') + ')') : '';

    if (hasSearch) {
      if (materialQ && plateQ) return 'Plaka ve malzeme/firma aramanıza uygun kayıt bulunamadı' + filterHint + '.';
      if (materialQ) return 'Malzeme/firma aramanıza uygun kayıt bulunamadı' + filterHint + '.';
      if (ozmal && basim) return 'Seçili filtrelere uygun kayıt bulunamadı.';
      if (ozmal) return 'Özmal araçlarda aramanıza uygun kayıt bulunamadı.';
      if (basim) return basim + ' kayıtlarında aramanıza uygun sonuç bulunamadı.';
      if (shift === 'night') return 'Gece vardiyası (00:00–08:00) kayıtlarında aramanıza uygun sonuç bulunamadı.';
      if (shift === 'day') return 'Gündüz vardiyası (08:00–18:00) kayıtlarında aramanıza uygun sonuç bulunamadı.';
      return 'Aramanıza uygun kayıt bulunamadı' + filterHint + '.';
    }
    if (ozmal && basim) return 'Seçili filtrelere uygun kayıt bulunmuyor.';
    if (dateLabel) return dateLabel + ' için yazdırma kaydı bulunmuyor.';
    if (shift === 'night') return 'Gece vardiyası (00:00–08:00) yazdırma kaydı bulunmuyor.';
    if (shift === 'day') return 'Gündüz vardiyası (08:00–18:00) yazdırma kaydı bulunmuyor.';
    if (ozmal) return 'Özmal araç yazdırma kaydı bulunmuyor.';
    if (basim) return basim + ' yazdırma kaydı bulunmuyor.';
    return 'Henüz rapor bulunmuyor.';
  }

  const BASIM_SITES = ['AVDAN', '1.OSB'];

  function istanbulDateKeyFromMs(ms) {
    try {
      const d = new Date(Number(ms));
      if (isNaN(d.getTime())) return '';
      return d.toLocaleDateString('tr-TR', { timeZone: REPORT_TZ });
    } catch (e) {
      return '';
    }
  }

  function getIstanbulTodayKey() {
    return istanbulDateKeyFromMs(Date.now());
  }

  function eventBasimYeri(ev) {
    const d = (ev && ev.data) || {};
    return String(d.basimYeri || '').trim().toUpperCase();
  }

  function emptyBasimStats() {
    const sites = {};
    BASIM_SITES.forEach((site) => {
      sites[site] = { total: 0 };
    });
    return { todayKey: getIstanbulTodayKey(), sites };
  }

  function computeTodayBasimStats(events) {
    const stats = emptyBasimStats();
    const todayKey = stats.todayKey;
    (events || []).forEach((ev) => {
      if (!ev || ev.type !== 'PRINT') return;
      const site = eventBasimYeri(ev);
      if (!stats.sites[site]) return;
      const ts = Number(ev.ts || 0);
      if (!ts || istanbulDateKeyFromMs(ts) !== todayKey) return;
      stats.sites[site].total += 1;
    });
    return stats;
  }

  function setFilterButtonCount(btnId, count) {
    const btn = document.getElementById(btnId);
    if (!btn) return;
    let badge = btn.querySelector('.rp-filter-count');
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'rp-filter-count';
      badge.setAttribute('aria-label', 'Bugün basılan');
      btn.appendChild(badge);
    }
    badge.textContent = String(count);
  }

  function updateFilterButtonCounts(stats, shiftStats) {
    const avdan = stats.sites.AVDAN || { total: 0 };
    const osb = stats.sites['1.OSB'] || { total: 0 };
    const todayTotal = BASIM_SITES.reduce((sum, site) => sum + ((stats.sites[site] && stats.sites[site].total) || 0), 0);
    setFilterButtonCount('avdanFilterBtn', avdan.total);
    setFilterButtonCount('osb1FilterBtn', osb.total);
    setFilterButtonCount('todayFilterBtn', todayTotal);
    const night = (shiftStats && shiftStats.night) || emptyShiftBucket();
    const day = (shiftStats && shiftStats.day) || emptyShiftBucket();
    setFilterButtonCount('shiftNightFilterBtn', night.total);
    setFilterButtonCount('shiftDayFilterBtn', day.total);
  }

  function normPlate(s){
    return String(s||'').toLowerCase().replace(/[\s-]+/g,'');
  }

  function normMaterial(s) {
    return String(s || '')
      .toLocaleLowerCase('tr-TR')
      .replace(/[\s\-./\\|,'']+/g, '');
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

  /** Lookup sonucu yalnızca çekici plakası satırla aynıysa kullanılabilir (dorse eşleşmesi yanlış araç getirir). */
  function acceptLookupVehicleForRow(vehicleData, rowPlate) {
    if (!vehicleData || typeof vehicleData !== 'object') return null;
    const rowKey = normPlateKey(rowPlate);
    if (!rowKey) return null;
    const cekiciKey = normPlateKey(vehicleData.cekiciPlaka || vehicleData.plaka || '');
    if (cekiciKey && cekiciKey === rowKey) return vehicleData;
    return null;
  }

  /**
   * NETSIS/Excel kopyası: satır plakası + olay verisi esas; lookup sadece eksik telefon/TC/dorse doldurur.
   * Yanlış araç kaydı asla plaka/saat/şoförü ezmemeli.
   */
  function mergeReportRowVehicleForCopy(rowPlate, sourceData, vehicleData) {
    const src = sourceData && typeof sourceData === 'object' ? sourceData : {};
    const fill = acceptLookupVehicleForRow(vehicleData, rowPlate) || {};
    const plate = String(rowPlate || src.plaka || src.cekiciPlaka || src.plate || '').trim();
    const fullFromEvent = String(src.sofor || '').trim();
    const evSplit = fullFromEvent ? splitSoforForExcel(fullFromEvent) : null;

    return {
      cekiciPlaka: plate,
      soforAdi: evSplit
        ? evSplit.soforAdi
        : (src.soforAdi || src.driverName || src.isim || src.name
          || fill.soforAdi || fill.driverName || fill.isim || fill.name || ''),
      soforSoyadi: evSplit
        ? evSplit.soforSoyadi
        : (src.soforSoyadi || src.driverSurname || src.soyisim || src.surname
          || fill.soforSoyadi || fill.driverSurname || fill.soyisim || fill.surname || ''),
      iletisim: src.iletisim || src.phone || src.driverPhone || src.phoneNumber
        || fill.iletisim || fill.phone || fill.driverPhone || fill.phoneNumber || '',
      tcKimlik: src.tcKimlik || src.tc || fill.tcKimlik || fill.tc || '',
      dorsePlaka: src.dorsePlaka || src.dorse || fill.dorsePlaka || fill.dorse || '',
      // Saat/tarih yalnızca olay satırından (lookup araç saati irsaliyeyi bozmasın)
      tarih: src.tarih || src.girisTarihi || src.girisTarih || src.giris || src.entryDate || src.date || '',
      saat: src.saat || src.girisSaati || src.girisSaat || src.time || src.entryTime || '',
      cikisTarihi: src.cikisTarihi || src.cikisTarih || src.cikis || src.exitDate || '',
      cikisSaati: src.cikisSaati || src.cikisSaat || src.cikisTime || src.exitTime || ''
    };
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
    // print_history / event id ASLA araç id'si değildir — sadece gerçek vehicleId
    const vehicleId = String(tr.getAttribute('data-actual-vehicle-id') || '').trim();
    const sourceData = parseRowEventData(tr);

    let vehicleData = null;
    const hasPhone = sourceData.iletisim || sourceData.phone || sourceData.driverPhone || sourceData.phoneNumber;
    const hasTC = sourceData.tcKimlik || sourceData.tc;
    const hasDorse = sourceData.dorsePlaka || sourceData.dorse;
    const needLookup = !hasPhone || !hasTC || !hasDorse;

    if (needLookup && plate) {
      try {
        if (
          window.storage &&
          typeof window.storage.load === 'function' &&
          vehicleId &&
          vehicleId !== 'manual'
        ) {
          const cached = window.storage.load('vehicle_' + vehicleId);
          vehicleData = acceptLookupVehicleForRow(cached, plate);
        }
        if (!vehicleData) {
          vehicleData = acceptLookupVehicleForRow(await lookupVehicleCached(plate), plate);
        }
      } catch (e) {
        console.warn('Vehicle lookup for NETSIS failed:', e);
      }
    }

    return mergeReportRowVehicleForCopy(plate, sourceData, vehicleData);
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
        updateFilterButtonCounts(emptyBasimStats(), emptyShiftStats());
        syncOzmalFilterBtn();
        return;
      }
    
    _latestEvents = events || [];
    const todayStats = computeTodayBasimStats(_latestEvents);
    const todayShiftStats = computeTodayShiftStats(_latestEvents);
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
    const materialEl = document.getElementById('materialSearch');
    const mq = normMaterial((materialEl ? materialEl.value : '').trim());
    const mode = 'printed';
    try{ const fs=document.getElementById('filterSelect'); if(fs){ fs.value='printed'; fs.disabled=true; } }catch(e){}

    let rows = vehicles.slice();
    if (q){
      rows = rows.filter(v => normPlate(v.cekiciPlaka || '').includes(q));
    }
    if (mq) {
      rows = rows.filter(v => rowMatchesMaterialQuery(v, mq));
    }
    if (window.__reportsDateFrom || window.__reportsDateTo) {
      rows = rows.filter(rowMatchesDateRange);
    }
    if (window.__reportsOzmalFilter) {
      rows = rows.filter(reportRowIsOzmal);
    }
    const basimFilter = String(window.__reportsBasimYeriFilter || '').trim().toUpperCase();
    if (basimFilter) {
      rows = rows.filter(v => reportRowBasimYeri(v) === basimFilter);
    }
    const shiftFilter = String(window.__reportsShiftFilter || '').trim();
    if (shiftFilter) {
      rows = rows.filter(v => reportRowShiftKey(v) === shiftFilter);
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

    const tbodyEl = document.getElementById('tbody');
    tbodyEl.innerHTML = '';
    syncOzmalFilterBtn();
    updateFilterButtonCounts(todayStats, todayShiftStats);

    if (!rows.length) {
      const emptyMsg = reportsEmptyMessage(q, mq);
      tbodyEl.innerHTML = '<tr><td colspan="6" class="text-center py-8 text-gray-500">' + emptyMsg + '</td></tr>';
      try {
        const pc = document.getElementById('paginationControls');
        if (pc) pc.innerHTML = '';
      } catch (e) { /* ignore */ }
      return;
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
      tr.setAttribute('data-vehicle-id', String(v.id || '')); // print_history id (reprint); NETSIS için data-actual-vehicle-id kullan
      tr.setAttribute('data-plate', plate || '');

      // use row's own print event (no full-list scan)
      const lastEv = v.rawEvent || null;
      let lastPrintHtml = '-';
      let ts = (lastEv && lastEv.ts) || (v.lastPrintSnapshot && v.lastPrintSnapshot.ts) || null;
      if (ts) tr.setAttribute('data-ts', String(ts));
      let d = (lastEv && lastEv.data) ? lastEv.data : {};
      let saat = d.saat || '';
      if (!saat && ts) {
        const trdt = trDateTimeFromMs(ts);
        if (trdt) saat = trdt.saat;
      }
      
      // ✅ Tüm event data'sını tr'ye ekle (reprint / NETSIS için)
      if (lastEv && lastEv.data) {
        try {
          tr.setAttribute('data-event-data', JSON.stringify(lastEv.data));
          const realVid = lastEv.data.vehicleId || lastEv.data.vehicle_id || '';
          if (realVid && String(realVid) !== 'manual') {
            tr.setAttribute('data-actual-vehicle-id', String(realVid));
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
        ? `${plate}${soforName ? `<div class="rp-sofor-line">${soforName}</div>` : ''}`
        : (soforName || '-');
      // Uzun firma/sürücü adları alt satıra kırılsın (yatay kaydırma olmasın)
      const firmaCellHtml = firmaCode
        ? `<span class="rp-firma-text">${firmaCode}</span>`
        : '-';

      tr.innerHTML = `
        <td class="col-plate font-semibold" data-label="Plaka">${plateCellHtml}</td>
        <td class="col-firma" data-label="Firma / Sürücü">${firmaCellHtml}</td>
        <td class="col-tarih" data-label="Tarih">${(function(){
            const tr = ts ? trDateTimeFromMs(ts) : null;
            const dateStr = tr ? tr.tarih : ((d && d.tarih) ? (d.tarih || '-') : '-');
            const timeStr = tr ? tr.saat : (((d && d.saat) ? d.saat : (lastEv && lastEv.saat)) || '');
            return '<div style="font-weight:700">' + (dateStr || '-') + '</div>' + (timeStr ? ('<div style="font-size:12px;opacity:.85">' + timeStr + '</div>') : '');
          })()}</td>
        <td class="col-basim" data-label="Basım Yeri">${basim || '-'}</td>
        <td class="col-malzeme" data-label="Malzeme">${lastPrintHtml}</td>
        <td class="col-islem rp-table-actions" data-label="İşlem">
          <div class="rp-table-actions-inner">
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
              <i class="fab fa-whatsapp"></i> WhatsApp
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
      tbodyEl.appendChild(tr);
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
    const materialSearch = document.getElementById('materialSearch');
    const sel = document.getElementById('filterSelect');
    if (plate) {
      plate.addEventListener('input', () => { window.__reportsPage = 1; window.clearTimeout(window.__rdeb); window.__rdeb = window.setTimeout(render, 120); });
    }
    if (materialSearch) {
      materialSearch.addEventListener('input', () => { window.__reportsPage = 1; window.clearTimeout(window.__mdeb); window.__mdeb = window.setTimeout(render, 120); });
    }

    function applyDateRange(from, to, preset) {
      let f = String(from || '').trim();
      let t = String(to || '').trim();
      if (f && t && f > t) {
        const tmp = f;
        f = t;
        t = tmp;
      }
      window.__reportsDateFrom = f;
      window.__reportsDateTo = t;
      window.__reportsDatePreset = preset || detectDatePreset(f, t);
      window.__reportsPage = 1;
      render();
    }

    function applyDatePreset(preset) {
      const key = String(preset || '').trim();
      if (key === 'today' && window.__reportsDatePreset === 'today') {
        applyDateRange('', '', 'all');
        return;
      }
      const resolved = resolveDatePreset(key);
      applyDateRange(resolved.from, resolved.to, resolved.preset);
    }

    document.querySelectorAll('.rp-preset[data-range]').forEach((btn) => {
      btn.addEventListener('click', () => {
        applyDatePreset(btn.getAttribute('data-range'));
      });
    });

    const dateFromInput = document.getElementById('dateFromInput');
    const dateToInput = document.getElementById('dateToInput');
    if (dateFromInput) {
      dateFromInput.addEventListener('change', () => {
        applyDateRange(dateFromInput.value, (dateToInput && dateToInput.value) || window.__reportsDateTo);
      });
    }
    if (dateToInput) {
      dateToInput.addEventListener('change', () => {
        applyDateRange((dateFromInput && dateFromInput.value) || window.__reportsDateFrom, dateToInput.value);
      });
    }

    const clearFiltersBtn = document.getElementById('clearFiltersBtn');
    if (clearFiltersBtn) {
      clearFiltersBtn.addEventListener('click', () => {
        window.__reportsOzmalFilter = false;
        window.__reportsBasimYeriFilter = '';
        window.__reportsShiftFilter = '';
        window.__reportsDateFrom = '';
        window.__reportsDateTo = '';
        window.__reportsDatePreset = 'all';
        const plateEl = document.getElementById('plateSearch');
        const materialEl = document.getElementById('materialSearch');
        if (plateEl) plateEl.value = '';
        if (materialEl) materialEl.value = '';
        window.__reportsPage = 1;
        render();
      });
    }

    const ozmalBtn = document.getElementById('ozmalFilterBtn');
    if (ozmalBtn) {
      ozmalBtn.addEventListener('click', () => {
        window.__reportsOzmalFilter = !window.__reportsOzmalFilter;
        window.__reportsPage = 1;
        render();
      });
    }

    function toggleBasimYeriFilter(site) {
      const next = String(site || '').trim();
      if (!next) return;
      window.__reportsBasimYeriFilter = (window.__reportsBasimYeriFilter === next) ? '' : next;
      window.__reportsPage = 1;
      render();
    }

    const avdanBtn = document.getElementById('avdanFilterBtn');
    if (avdanBtn) {
      avdanBtn.addEventListener('click', () => toggleBasimYeriFilter('AVDAN'));
    }

    const osb1Btn = document.getElementById('osb1FilterBtn');
    if (osb1Btn) {
      osb1Btn.addEventListener('click', () => toggleBasimYeriFilter('1.OSB'));
    }

    function toggleShiftFilter(shift) {
      const next = String(shift || '').trim();
      if (!next) return;
      window.__reportsShiftFilter = (window.__reportsShiftFilter === next) ? '' : next;
      window.__reportsPage = 1;
      render();
    }

    const shiftNightBtn = document.getElementById('shiftNightFilterBtn');
    if (shiftNightBtn) {
      shiftNightBtn.addEventListener('click', () => toggleShiftFilter('night'));
    }

    const shiftDayBtn = document.getElementById('shiftDayFilterBtn');
    if (shiftDayBtn) {
      shiftDayBtn.addEventListener('click', () => toggleShiftFilter('day'));
    }

    window.addEventListener('ozmal-plates-changed', () => {
      if (window.__reportsOzmalFilter) render();
    });

    syncFilterBtns();
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

    const plate = safeText(tr.getAttribute('data-plate') || '');
    const vehicleId = String(tr.getAttribute('data-actual-vehicle-id') || '').trim();
    const sourceData = parseRowEventData(tr);

    let vehicleData = null;
    const hasName = sourceData.sofor || sourceData.soforAdi || sourceData.driverName || sourceData.isim || sourceData.name;
    const hasPhone = sourceData.iletisim || sourceData.phone || sourceData.driverPhone || sourceData.phoneNumber;

    if ((!hasName || !hasPhone) && plate) {
      try {
        if (
          window.storage &&
          typeof window.storage.load === 'function' &&
          vehicleId &&
          vehicleId !== 'manual'
        ) {
          const cached = window.storage.load('vehicle_' + vehicleId);
          vehicleData = acceptLookupVehicleForRow(cached, plate);
        }
        if (!vehicleData) {
          vehicleData = acceptLookupVehicleForRow(await lookupVehicleCached(plate), plate);
        }
      } catch (e) { /* ignore */ }
    }

    const merged = mergeReportRowVehicleForCopy(plate, sourceData, vehicleData);
    const firstName = safeText(merged.soforAdi);
    const lastName = safeText(merged.soforSoyadi);
    const fullName = [firstName, lastName].filter(Boolean).join(' ').trim() || '-';
    const phone = formatPhoneForExcel(merged.iletisim || '-');

    // Giriş/çıkış saati yalnızca bu satırın olay verisi / ts — asla lookup araç kaydından değil
    let entry = safeText([merged.tarih, merged.saat].filter(Boolean).join(' '));
    if (!entry) {
      const ts = Number(tr.getAttribute('data-ts') || 0);
      if (ts) {
        const trdt = trDateTimeFromMs(ts);
        if (trdt) entry = safeText([trdt.tarih, trdt.saat].filter(Boolean).join(' '));
      }
    }
    if (!entry) entry = '-';

    let exit = safeText([merged.cikisTarihi, merged.cikisSaati].filter(Boolean).join(' '));
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
