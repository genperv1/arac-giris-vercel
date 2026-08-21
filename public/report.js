// report.js
(function(){
  const DELETE_PASSWORD = '543723';

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

  // Cleanup legacy localStorage keys that may feed the reports UI (defer — don't block first paint)
  setTimeout(function cleanupLegacyReportStorage() {
    try {
      try { localStorage.removeItem('report_events_v1'); } catch(e) {}
      try { localStorage.removeItem('pending_reprint_vehicleId'); } catch(e) {}
      try { localStorage.removeItem('soforHistoryByPlaka'); } catch(e) {}
      try {
        const toRemove = [];
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i) || '';
          if (k.startsWith('vehicle_')) toRemove.push(k);
        }
        toRemove.forEach(k => { try { localStorage.removeItem(k); } catch(e){} });
      } catch(e) {}
    } catch(e) {}
  }, 0);
  const REPORT_TZ = 'Europe/Istanbul';

  // Reuse Intl formatters — creating one per row makes filters crawl on large lists
  const _isoDateFmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: REPORT_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  const _trDateFmt = new Intl.DateTimeFormat('tr-TR', { timeZone: REPORT_TZ });
  const _trTimeFmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: REPORT_TZ,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    hourCycle: 'h23'
  });
  const _minsFmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: REPORT_TZ,
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
    hourCycle: 'h23'
  });

  function istanbulIsoDateFromMs(ms) {
    try {
      const d = new Date(Number(ms));
      if (isNaN(d.getTime())) return '';
      const parts = _isoDateFmt.formatToParts(d);
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
    const key = row && row._isoDate != null ? row._isoDate : istanbulIsoDateFromMs(reportRowPrintTs(row));
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
      return { tarih: _trDateFmt.format(d), saat: _trTimeFmt.format(d) };
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
      const r = await fetch('/api/reports?_=' + Date.now(), {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store, no-cache, must-revalidate',
          'Pragma': 'no-cache'
        },
        credentials: 'include'
      }); 
      if (r.ok) {
        return await r.json();
      }
    }catch(e){
      console.error('Reports fetch error:', e);
    }
    return [];
  }

  // cache last loaded events so delete handlers / filters can reuse
  let _latestEvents = [];
  let _allVehicles = [];
  let _cachedTodayStats = null;
  let _cachedTodayShiftStats = null;
  let _cachedTodayKindStats = null;
  let _lastDupExtraIds = [];
  let _eventsLoadPromise = null;
  let _eventsLoaded = false;
  const _vehicleLookupCache = new Map();
  const _firmaNameByCode = new Map();

  function escapeRpHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function normFirmaCodeKey(s) {
    return String(s || '').trim().toUpperCase().replace(/\s+/g, '');
  }

  function splitFirmaCodeAndName(raw) {
    const s = String(raw || '').trim();
    if (!s) return { code: '', name: '' };
    const cut = s.indexOf('/');
    if (cut < 0) return { code: s, name: '' };
    return { code: s.slice(0, cut).trim(), name: s.slice(cut + 1).trim() };
  }

  function ingestFirmaCustomers(list) {
    if (!Array.isArray(list)) return 0;
    let added = 0;
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      const kod = String((c && (c.kod || c.code)) || '').trim();
      const ad = String((c && (c.ad || c.name || c.unvan)) || '').trim();
      if (!kod || !ad) continue;
      const k = normFirmaCodeKey(kod);
      if (!k || _firmaNameByCode.has(k)) continue;
      _firmaNameByCode.set(k, ad);
      added += 1;
    }
    return added;
  }

  function lookupFirmaName(code) {
    const parsed = splitFirmaCodeAndName(code);
    const k = normFirmaCodeKey(parsed.code || code);
    if (!k) return parsed.name || '';
    return _firmaNameByCode.get(k) || parsed.name || '';
  }

  function resolveReportFirma(d, fallbackCode) {
    const src = d && typeof d === 'object' ? d : {};
    const raw = String(
      src.firma || src.firmaKodu || src.firmaSelect || fallbackCode || ''
    ).trim();
    const parsed = splitFirmaCodeAndName(raw);
    const code = parsed.code;
    let name = String(src.firmaAdi || src.musteriAdi || src.customerName || '').trim() || parsed.name;
    if (!name && code) name = lookupFirmaName(code);
    if (!name && code) name = code;
    return { code, name };
  }

  async function loadFirmaNameMap() {
    let added = 0;
    try {
      const raw = localStorage.getItem('piyasa_customer_list_cache_v2');
      if (raw) {
        const payload = JSON.parse(raw);
        added += ingestFirmaCustomers(payload && payload.customers);
      }
    } catch (e) {}
    try {
      const r = await fetch('/api/piyasa/customers?_=' + Date.now(), {
        credentials: 'include',
        headers: { 'Cache-Control': 'no-store' }
      });
      if (r.ok) {
        const payload = await r.json();
        added += ingestFirmaCustomers(payload && payload.customers);
      }
    } catch (e) {}
    return added;
  }

  function eventsToVehicles(events) {
    const printEvents = (events || []).filter(ev => ev && ev.type === 'PRINT');
    return printEvents.map(ev => {
      const d = ev.data || {};
      const plate = (d.plaka || d.plate || '').toString();
      const row = {
        id: ev.id,
        cekiciPlaka: plate,
        defaultFirma: d.firma || d.firmaKodu || d.firmaSelect || '',
        printCount: 1,
        lastPrintSnapshot: Object.assign({ ts: ev.ts }, d),
        rawEvent: ev
      };
      // Precompute filter keys once so typing/toggling filters stay instant
      row._plateNorm = normPlate(plate);
      row._isoDate = istanbulIsoDateFromMs(Number(ev.ts || 0) || 0);
      row._basimYeri = String(d.basimYeri || '').trim().toUpperCase();
      row._shiftKey = eventShiftKey(ev);
      row._kind = reportEventKind(ev);
      row._isOzmal = reportRowIsOzmal(row);
      row._materialHaystack = normMaterial(reportRowMaterialText(row));
      row._firmaCodes = [
        row.defaultFirma,
        d.firma,
        d.firmaKodu,
        d.firmaSelect,
        d.firmaAdi,
        ev.firma
      ].map((x) => normMaterial(x)).filter(Boolean);
      // Prefer API-provided tarih/saat (already formatted server-side)
      row._displayTarih = d.tarih || ev.tarih || '';
      row._displaySaat = d.saat || ev.saat || '';
      if ((!row._displayTarih || !row._displaySaat) && Number(ev.ts)) {
        const trdt = trDateTimeFromMs(ev.ts);
        if (trdt) {
          if (!row._displayTarih) row._displayTarih = trdt.tarih;
          if (!row._displaySaat) row._displaySaat = trdt.saat;
        }
      }
      return row;
    });
  }

  function ingestEvents(events) {
    _latestEvents = events || [];
    _allVehicles = eventsToVehicles(_latestEvents);
    _cachedTodayStats = computeTodayBasimStats(_latestEvents);
    _cachedTodayShiftStats = computeTodayShiftStats(_latestEvents);
    _cachedTodayKindStats = computeTodayKindStats(_latestEvents);
    _eventsLoaded = true;
  }

  async function ensureEventsLoaded(force) {
    if (!force && _eventsLoaded) return _latestEvents;
    if (!force && _eventsLoadPromise) return _eventsLoadPromise;
    const p = (async () => {
      const events = await getEvents();
      ingestEvents(events);
      return events;
    })();
    _eventsLoadPromise = p;
    try {
      return await p;
    } finally {
      if (_eventsLoadPromise === p) _eventsLoadPromise = null;
    }
  }

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
  if (window.__reportsKindFilter == null) window.__reportsKindFilter = '';
  if (window.__reportsDupFilter == null) window.__reportsDupFilter = false;
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
      const parts = _minsFmt.formatToParts(d);
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

  const YD_FIRMA_RE = /\bYD\d{1,4}(?:\([A-Za-z]+\))?/i;

  function reportEventKind(ev) {
    const d = (ev && ev.data) || {};
    const snap = (ev && ev.snapshot) || {};
    const sid = String(
      d.sevkiyat_id || d.sevkiyatId || snap.sevkiyat_id || snap.sevkiyatId || ''
    ).trim().toLowerCase();
    if (sid.indexOf('ihracat:') === 0) return 'ihracat';
    if (sid.indexOf('piyasa:') === 0) return 'piyasa';
    const firmaHaystack = [
      d.firma, d.firmaKodu, d.firmaSelect, d.firmaAdi,
      ev && ev.firma, snap.firma, snap.firmaKodu, snap.firmaSelect
    ].map((x) => String(x || '')).join(' ');
    if (YD_FIRMA_RE.test(firmaHaystack)) return 'ihracat';
    const excelKey = String(d.excelShipmentKey || snap.excelShipmentKey || '').trim();
    if (excelKey) return 'ihracat';
    const note = String(d.yuklemeNotu || d.baskiNotu || snap.yuklemeNotu || '').trim();
    if (/SEVKİYATLARDA|SEVKIYATLARDA|DİKKAT\s+EDİLECEK|DIKKAT\s+EDILECEK/i.test(note)) return 'ihracat';
    if (/^İrsaliye\s*No\s*:/im.test(note)) return 'ihracat';
    return 'piyasa';
  }

  function reportRowKind(row) {
    if (!row) return 'piyasa';
    if (row._kind) return row._kind;
    if (row.rawEvent) return reportEventKind(row.rawEvent);
    return 'piyasa';
  }

  function emptyKindStats() {
    return { todayKey: getIstanbulTodayKey(), piyasa: 0, ihracat: 0 };
  }

  function computeTodayKindStats(events) {
    const stats = emptyKindStats();
    const todayKey = stats.todayKey;
    (events || []).forEach((ev) => {
      if (!ev || ev.type !== 'PRINT') return;
      const ts = Number(ev.ts || 0);
      if (!ts || istanbulDateKeyFromMs(ts) !== todayKey) return;
      const kind = reportEventKind(ev);
      if (kind === 'ihracat') stats.ihracat += 1;
      else stats.piyasa += 1;
    });
    return stats;
  }

  /** Aynı işin arka arkaya (10 dk) ikinci baskısı — net sayı için fazla kopya */
  const DUP_WINDOW_MS = 10 * 60 * 1000;

  function reportDupIdentity(row) {
    const d = (row && row.rawEvent && row.rawEvent.data) || (row && row.lastPrintSnapshot) || {};
    const plate = (row && row._plateNorm) || normPlate((row && row.cekiciPlaka) || d.plaka || d.plate || '');
    if (!plate) return '';
    const sid = String(d.sevkiyat_id || d.sevkiyatId || '').trim().toLowerCase();
    if (sid) return plate + '|sid:' + sid;
    const firma = normMaterial(d.firma || d.firmaKodu || d.firmaSelect || (row && row.defaultFirma) || '');
    const malzeme = normMaterial(d.malzeme || '');
    const kind = (row && row._kind) || reportRowKind(row) || 'piyasa';
    return plate + '|' + kind + '|' + firma + '|' + malzeme;
  }

  function markConsecutiveDuplicates(rows) {
    const list = (rows || []).slice().sort((a, b) => reportRowPrintTs(a) - reportRowPrintTs(b));
    const extraIds = new Set();
    const groupIds = new Set();
    const lastByKey = new Map();
    for (let i = 0; i < list.length; i++) {
      const row = list[i];
      const key = reportDupIdentity(row);
      const ts = reportRowPrintTs(row) || 0;
      if (!key || !ts) continue;
      const prev = lastByKey.get(key);
      if (prev && ts > prev.ts && (ts - prev.ts) <= DUP_WINDOW_MS) {
        extraIds.add(String(row.id || ''));
        groupIds.add(String(row.id || ''));
        groupIds.add(String(prev.row.id || ''));
      }
      lastByKey.set(key, { row, ts });
    }
    for (let i = 0; i < (rows || []).length; i++) {
      const row = rows[i];
      const id = String((row && row.id) || '');
      row._dupExtra = extraIds.has(id);
      row._dupGroup = groupIds.has(id);
    }
    const extras = Array.from(extraIds).filter(Boolean);
    return { extraCount: extras.length, extraIds: extras, groupCount: groupIds.size };
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
      d.firmaAdi,
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
    const haystack = row._materialHaystack != null
      ? row._materialHaystack
      : normMaterial(reportRowMaterialText(row));
    if (haystack.includes(mq)) return true;

    const firmaCodes = row._firmaCodes || (() => {
      const ev = row.rawEvent || {};
      const d = (ev.data && typeof ev.data === 'object') ? ev.data : (row.lastPrintSnapshot || {});
      return [
        row.defaultFirma,
        d.firma,
        d.firmaKodu,
        d.firmaSelect,
        ev.firma
      ].map((x) => normMaterial(x)).filter(Boolean);
    })();

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

  const TR_MONTHS = [
    'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
    'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'
  ];

  const __calState = {
    viewYear: 0,
    viewMonth: 0, // 0-11
    draftFrom: '',
    draftTo: '',
    picking: 'from', // from | to
    open: false,
    bound: false,
    applyFn: null
  };

  function parseIsoParts(iso) {
    const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return null;
    return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
  }

  function isoFromParts(y, m, d) {
    return String(y) + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
  }

  function isoWeekFromParts(y, m1, d) {
    const date = new Date(Date.UTC(Number(y), Number(m1) - 1, Number(d)));
    const dayNum = date.getUTCDay() || 7;
    date.setUTCDate(date.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
    return Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
  }

  function weekNoFromTarih(dateStr, ts) {
    const tr = String(dateStr || '').match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})/);
    if (tr) return isoWeekFromParts(Number(tr[3]), Number(tr[2]), Number(tr[1]));
    const iso = ts ? istanbulIsoDateFromMs(ts) : '';
    const parts = parseIsoParts(iso);
    if (parts) return isoWeekFromParts(parts.y, parts.m, parts.d);
    return 0;
  }

  function formatMonthWeekRange(y, m0) {
    const daysInMonth = new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate();
    const weeks = [];
    for (let d = 1; d <= daysInMonth; d++) {
      const w = isoWeekFromParts(y, m0 + 1, d);
      if (weeks[weeks.length - 1] !== w) weeks.push(w);
    }
    if (!weeks.length) return '';
    if (weeks.length === 1) return weeks[0] + '. hafta';
    const first = weeks[0];
    const last = weeks[weeks.length - 1];
    if (last >= first) return first + '–' + last + '. hafta';
    return first + ' · ' + weeks.slice(1)[0] + '–' + last + '. hafta';
  }

  function syncDateRangeTrigger() {
    const valueEl = document.getElementById('dateRangeTriggerValue');
    if (!valueEl) return;
    const from = String(window.__reportsDateFrom || '').trim();
    const to = String(window.__reportsDateTo || '').trim();
    const presetLabels = {
      today: 'Bugün',
      yesterday: 'Dün',
      '7d': 'Son 7 gün',
      '30d': 'Son 30 gün',
      month: 'Bu ay'
    };
    const preset = String(window.__reportsDatePreset || '').trim();
    const short = presetLabels[preset] || '';

    if (!from && !to) {
      valueEl.innerHTML = '<span class="is-muted">Tarih seçin</span>';
      return;
    }

    let main = '';
    if (from && to && from === to) main = formatIsoTr(from);
    else if (from && to) main = formatIsoTr(from) + ' → ' + formatIsoTr(to);
    else if (from) main = formatIsoTr(from) + ' → …';
    else main = '… → ' + formatIsoTr(to);

    if (short) {
      valueEl.innerHTML =
        '<span>' + short + '</span>' +
        '<span class="rp-daterange-trigger-sep">·</span>' +
        '<span style="font-weight:500;color:#64748b;font-size:0.8125rem">' + main + '</span>';
      return;
    }

    if (from && to && from === to) {
      valueEl.innerHTML = '<span>' + formatIsoTr(from) + '</span>';
      return;
    }
    if (from && to) {
      valueEl.innerHTML =
        '<span>' + formatIsoTr(from) + '</span>' +
        '<span class="rp-daterange-trigger-sep">→</span>' +
        '<span>' + formatIsoTr(to) + '</span>';
      return;
    }
    if (from) {
      valueEl.innerHTML = '<span>' + formatIsoTr(from) + '</span><span class="rp-daterange-trigger-sep">→</span><span class="is-muted">Bitiş</span>';
      return;
    }
    valueEl.innerHTML = '<span class="is-muted">Başlangıç</span><span class="rp-daterange-trigger-sep">→</span><span>' + formatIsoTr(to) + '</span>';
  }

  function syncCalHint() {
    const hint = document.getElementById('calHint');
    if (!hint) return;
    const from = __calState.draftFrom;
    const to = __calState.draftTo;
    if (!from && !to) {
      hint.textContent = 'Başlangıç tarihini seçin';
      return;
    }
    if (from && !to) {
      hint.textContent = formatIsoTr(from) + ' → bitiş seçin';
      return;
    }
    if (from && to && from === to) {
      hint.textContent = formatIsoTr(from);
      return;
    }
    hint.textContent = formatIsoTr(from) + ' → ' + formatIsoTr(to);
  }

  function ensureCalViewMonth() {
    const today = getIstanbulTodayIso();
    const anchor = __calState.draftTo || __calState.draftFrom || window.__reportsDateTo || window.__reportsDateFrom || today;
    const parts = parseIsoParts(anchor) || parseIsoParts(today);
    if (!parts) return;
    if (!__calState.viewYear) {
      __calState.viewYear = parts.y;
      __calState.viewMonth = parts.m - 1;
    }
  }

  function renderCalendarGrid() {
    const grid = document.getElementById('calDayGrid');
    const monthLabel = document.getElementById('calMonthLabel');
    if (!grid) return;
    ensureCalViewMonth();
    const y = __calState.viewYear;
    const m = __calState.viewMonth;
    const weekRange = formatMonthWeekRange(y, m);
    if (monthLabel) {
      monthLabel.innerHTML =
        '<span>' + (TR_MONTHS[m] || '') + ' ' + y + '</span>' +
        (weekRange ? '<span class="rp-cal-weeks">· ' + weekRange + '</span>' : '');
    }

    const todayIso = getIstanbulTodayIso();
    const todayParts = parseIsoParts(todayIso);
    const todayWeek = todayParts ? isoWeekFromParts(todayParts.y, todayParts.m, todayParts.d) : 0;
    const from = __calState.draftFrom;
    const to = __calState.draftTo;
    const firstDow = new Date(Date.UTC(y, m, 1)).getUTCDay(); // 0 Sun
    const mondayFirst = (firstDow + 6) % 7;
    const daysInMonth = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    const prevDays = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const weekCount = Math.ceil((mondayFirst + daysInMonth) / 7);
    const cellCount = weekCount * 7;

    let html = '';
    for (let i = 0; i < cellCount; i++) {
      let cellY = y;
      let cellM = m;
      let cellD;
      let outside = false;
      if (i < mondayFirst) {
        cellD = prevDays - mondayFirst + i + 1;
        cellM = m - 1;
        if (cellM < 0) { cellM = 11; cellY = y - 1; }
        outside = true;
      } else if (i >= mondayFirst + daysInMonth) {
        cellD = i - (mondayFirst + daysInMonth) + 1;
        cellM = m + 1;
        if (cellM > 11) { cellM = 0; cellY = y + 1; }
        outside = true;
      } else {
        cellD = i - mondayFirst + 1;
      }

      if (i % 7 === 0) {
        const weekNo = isoWeekFromParts(cellY, cellM + 1, cellD);
        const isCurrentWeek = weekNo === todayWeek;
        html += '<span class="rp-cal-weeknum' + (isCurrentWeek ? ' is-current' : '') +
          '" title="' + weekNo + '. hafta">' + weekNo + '</span>';
      }

      const iso = isoFromParts(cellY, cellM + 1, cellD);
      const disabled = iso > todayIso;
      const isToday = iso === todayIso;
      const isStart = !!from && iso === from;
      const isEnd = !!to && iso === to;
      const inRange = !!(from && to && iso > from && iso < to);
      const selected = isStart || isEnd;

      const cls = [
        'rp-cal-day',
        outside ? 'is-outside' : '',
        disabled ? 'is-disabled' : '',
        isToday ? 'is-today' : '',
        inRange ? 'is-in-range' : '',
        isStart ? 'is-range-start is-selected' : '',
        isEnd ? 'is-range-end is-selected' : '',
        selected && isStart && isEnd ? 'is-range-start is-range-end' : ''
      ].filter(Boolean).join(' ');

      html += '<button type="button" class="' + cls + '" data-iso="' + iso + '"' +
        (disabled ? ' disabled' : '') +
        ' aria-label="' + formatIsoTr(iso) + '">' +
        '<span>' + cellD + '</span></button>';
    }
    grid.innerHTML = html;
    syncCalHint();
  }

  function positionDateRangePanel() {}

  function openDateRangePanel() {
    __calState.draftFrom = String(window.__reportsDateFrom || '').trim();
    __calState.draftTo = String(window.__reportsDateTo || '').trim();
    __calState.picking = __calState.draftFrom && !__calState.draftTo ? 'to' : 'from';
    if (!__calState.viewYear) {
      ensureCalViewMonth();
    }
    renderCalendarGrid();
    __calState.open = true;
  }

  function closeDateRangePanel() {
    __calState.open = true;
    __calState.draftFrom = String(window.__reportsDateFrom || '').trim();
    __calState.draftTo = String(window.__reportsDateTo || '').trim();
    renderCalendarGrid();
  }

  function commitDraftRange() {
    const from = __calState.draftFrom;
    const to = __calState.draftTo || __calState.draftFrom;
    if (typeof __calState.applyFn === 'function') {
      __calState.applyFn(from, from && to ? to : '', detectDatePreset(from, from && to ? to : ''));
    }
  }

  function pickCalendarDay(iso) {
    if (!iso || iso > getIstanbulTodayIso()) return;
    const parts = parseIsoParts(iso);
    if (parts) {
      __calState.viewYear = parts.y;
      __calState.viewMonth = parts.m - 1;
    }
    if (!__calState.draftFrom || (__calState.draftFrom && __calState.draftTo) || __calState.picking === 'from') {
      __calState.draftFrom = iso;
      __calState.draftTo = '';
      __calState.picking = 'to';
      renderCalendarGrid();
      return;
    }
    // picking end
    if (iso < __calState.draftFrom) {
      __calState.draftTo = __calState.draftFrom;
      __calState.draftFrom = iso;
    } else {
      __calState.draftTo = iso;
    }
    __calState.picking = 'from';
    renderCalendarGrid();
    commitDraftRange();
  }

  function syncDateInputs() {
    const fromEl = document.getElementById('dateFromInput');
    const toEl = document.getElementById('dateToInput');
    const from = String(window.__reportsDateFrom || '').trim();
    const to = String(window.__reportsDateTo || '').trim();
    if (fromEl) fromEl.value = from;
    if (toEl) toEl.value = to;

    const preset = String(window.__reportsDatePreset || 'all').trim() || 'all';
    document.querySelectorAll('.rp-preset[data-range]').forEach((btn) => {
      const key = String(btn.getAttribute('data-range') || '');
      btn.classList.toggle('is-active', key === preset);
    });

    syncDateRangeTrigger();

    __calState.draftFrom = from;
    __calState.draftTo = to;
    renderCalendarGrid();
  }

  function bindDateRangePicker(applyDateRange) {
    if (__calState.bound) {
      __calState.applyFn = applyDateRange;
      return;
    }
    __calState.bound = true;
    __calState.applyFn = applyDateRange;

    const prevBtn = document.getElementById('calPrevBtn');
    const nextBtn = document.getElementById('calNextBtn');
    const clearBtn = document.getElementById('calClearBtn');
    const grid = document.getElementById('calDayGrid');
    if (prevBtn) {
      prevBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        ensureCalViewMonth();
        __calState.viewMonth -= 1;
        if (__calState.viewMonth < 0) {
          __calState.viewMonth = 11;
          __calState.viewYear -= 1;
        }
        renderCalendarGrid();
      });
    }
    if (nextBtn) {
      nextBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        ensureCalViewMonth();
        const today = parseIsoParts(getIstanbulTodayIso());
        __calState.viewMonth += 1;
        if (__calState.viewMonth > 11) {
          __calState.viewMonth = 0;
          __calState.viewYear += 1;
        }
        if (today && (__calState.viewYear > today.y || (__calState.viewYear === today.y && __calState.viewMonth > today.m - 1))) {
          __calState.viewYear = today.y;
          __calState.viewMonth = today.m - 1;
        }
        renderCalendarGrid();
      });
    }
    if (grid) {
      grid.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const btn = e.target && e.target.closest ? e.target.closest('.rp-cal-day') : null;
        if (!btn || btn.disabled || btn.getAttribute('disabled') != null) return;
        const iso = btn.getAttribute('data-iso');
        if (iso) pickCalendarDay(iso);
      });
    }
    if (clearBtn) {
      clearBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        __calState.draftFrom = '';
        __calState.draftTo = '';
        __calState.picking = 'from';
        if (typeof __calState.applyFn === 'function') __calState.applyFn('', '', 'all');
        renderCalendarGrid();
      });
    }

    openDateRangePanel();
  }

  function syncActiveFiltersBar() {
    const plateQ = String((document.getElementById('plateSearch') || {}).value || '').trim();
    const materialQ = String((document.getElementById('materialSearch') || {}).value || '').trim();
    const dateLabel = describeDateRange();
    const kind = String(window.__reportsKindFilter || '').trim();
    const basim = String(window.__reportsBasimYeriFilter || '').trim();
    const shift = String(window.__reportsShiftFilter || '').trim();
    const ozmal = !!window.__reportsOzmalFilter;
    const dup = !!window.__reportsDupFilter;

    const pillDate = document.getElementById('activePillDate');
    const pillKind = document.getElementById('activePillKind');
    const pillBasim = document.getElementById('activePillBasim');
    const pillShift = document.getElementById('activePillShift');
    const pillOzmal = document.getElementById('activePillOzmal');
    const pillDup = document.getElementById('activePillDup');
    const pillSearch = document.getElementById('activePillSearch');
    const emptyEl = document.getElementById('activeFiltersEmpty');
    const clearBtn = document.getElementById('clearFiltersBtn');

    if (pillDate) {
      pillDate.hidden = !dateLabel;
      if (dateLabel) pillDate.innerHTML = '<i class="fas fa-calendar-alt" aria-hidden="true"></i> ' + dateLabel;
    }
    if (pillKind) {
      pillKind.hidden = !kind;
      if (kind === 'piyasa') pillKind.innerHTML = '<i class="fas fa-store" aria-hidden="true"></i> Piyasa';
      else if (kind === 'ihracat') pillKind.innerHTML = '<i class="fas fa-ship" aria-hidden="true"></i> İhracat';
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
    if (pillDup) pillDup.hidden = !dup;
    if (pillSearch) {
      const parts = [];
      if (plateQ) parts.push('Plaka: ' + plateQ);
      if (materialQ) parts.push(materialQ);
      pillSearch.hidden = !parts.length;
      if (parts.length) pillSearch.innerHTML = '<i class="fas fa-search" aria-hidden="true"></i> ' + parts.join(' · ');
    }

    const hasAny = !!(dateLabel || kind || basim || shift || ozmal || dup || plateQ || materialQ);
    if (emptyEl) emptyEl.hidden = hasAny;
    if (clearBtn) clearBtn.disabled = !hasAny;
  }

  function syncFilterBtns() {
    const ozmalBtn = document.getElementById('ozmalFilterBtn');
    if (ozmalBtn) ozmalBtn.classList.toggle('is-active', !!window.__reportsOzmalFilter);
    const dupBtn = document.getElementById('dupFilterBtn');
    if (dupBtn) dupBtn.classList.toggle('is-active', !!window.__reportsDupFilter);

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

    const kindFilter = String(window.__reportsKindFilter || '').trim();
    const piyasaBtn = document.getElementById('piyasaFilterBtn');
    if (piyasaBtn) piyasaBtn.classList.toggle('is-active', kindFilter === 'piyasa');
    const ihracatBtn = document.getElementById('ihracatFilterBtn');
    if (ihracatBtn) ihracatBtn.classList.toggle('is-active', kindFilter === 'ihracat');

    syncActiveFiltersBar();
  }

  function syncOzmalFilterBtn() {
    syncFilterBtns();
  }

  function reportsEmptyMessage(plateQ, materialQ) {
    const ozmal = !!window.__reportsOzmalFilter;
    const dup = !!window.__reportsDupFilter;
    const dateLabel = describeDateRange();
    const kind = String(window.__reportsKindFilter || '').trim();
    const basim = String(window.__reportsBasimYeriFilter || '').trim();
    const shift = String(window.__reportsShiftFilter || '').trim();
    const hasSearch = !!(plateQ || materialQ);
    const filterParts = [];
    if (dateLabel) filterParts.push(dateLabel);
    if (kind === 'piyasa') filterParts.push('piyasa');
    if (kind === 'ihracat') filterParts.push('ihracat');
    if (shift === 'night') filterParts.push('gece (00–08)');
    if (shift === 'day') filterParts.push('gündüz (08–18)');
    if (ozmal) filterParts.push('özmal');
    if (dup) filterParts.push('çift baskı');
    if (basim) filterParts.push(basim);
    const filterHint = filterParts.length ? (' (' + filterParts.join(', ') + ')') : '';

    if (hasSearch) {
      if (materialQ && plateQ) return 'Plaka ve malzeme/firma aramanıza uygun kayıt bulunamadı' + filterHint + '.';
      if (materialQ) return 'Malzeme/firma aramanıza uygun kayıt bulunamadı' + filterHint + '.';
      if (ozmal && basim) return 'Seçili filtrelere uygun kayıt bulunamadı.';
      if (ozmal) return 'Özmal araçlarda aramanıza uygun kayıt bulunamadı.';
      if (basim) return basim + ' kayıtlarında aramanıza uygun sonuç bulunamadı.';
      if (kind === 'piyasa') return 'Piyasa kayıtlarında aramanıza uygun sonuç bulunamadı.';
      if (kind === 'ihracat') return 'İhracat kayıtlarında aramanıza uygun sonuç bulunamadı.';
      if (shift === 'night') return 'Gece vardiyası (00:00–08:00) kayıtlarında aramanıza uygun sonuç bulunamadı.';
      if (shift === 'day') return 'Gündüz vardiyası (08:00–18:00) kayıtlarında aramanıza uygun sonuç bulunamadı.';
      return 'Aramanıza uygun kayıt bulunamadı' + filterHint + '.';
    }
    if (ozmal && basim) return 'Seçili filtrelere uygun kayıt bulunmuyor.';
    if (dateLabel) return dateLabel + ' için yazdırma kaydı bulunmuyor.';
    if (kind === 'piyasa') return 'Piyasa yazdırma kaydı bulunmuyor.';
    if (kind === 'ihracat') return 'İhracat yazdırma kaydı bulunmuyor.';
    if (shift === 'night') return 'Gece vardiyası (00:00–08:00) yazdırma kaydı bulunmuyor.';
    if (shift === 'day') return 'Gündüz vardiyası (08:00–18:00) yazdırma kaydı bulunmuyor.';
    if (dup) return 'Görünen kayıtlarda 10 dakika içinde arka arkaya basılmış çift kayıt yok.';
    if (ozmal) return 'Özmal araç yazdırma kaydı bulunmuyor.';
    if (basim) return basim + ' yazdırma kaydı bulunmuyor.';
    return 'Henüz rapor bulunmuyor.';
  }

  const BASIM_SITES = ['AVDAN', '1.OSB'];

  function istanbulDateKeyFromMs(ms) {
    try {
      const d = new Date(Number(ms));
      if (isNaN(d.getTime())) return '';
      return _trDateFmt.format(d);
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

  function setFilterButtonCount(btnId, count, ariaLabel) {
    const btn = document.getElementById(btnId);
    if (!btn) return;
    let badge = btn.querySelector('.rp-filter-count');
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'rp-filter-count';
      badge.setAttribute('aria-label', ariaLabel || 'Bugün basılan');
      btn.appendChild(badge);
    } else if (ariaLabel) {
      badge.setAttribute('aria-label', ariaLabel);
    }
    badge.textContent = String(count);
  }

  function syncDupActions(extraCount) {
    const n = Number(extraCount) || 0;
    setFilterButtonCount('dupFilterBtn', n, 'Fazla baskı');
    const btn = document.getElementById('deleteDupExtrasBtn');
    if (btn) {
      btn.disabled = n <= 0;
      btn.title = n > 0
        ? (n + ' fazla baskıyı sil — her çifte ilk (orijinal) kayıt kalır')
        : 'Görünen kayıtlarda arka arkaya çift baskı yok';
    }
  }

  function updateFilterButtonCounts(stats, shiftStats, kindStats) {
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
    const kind = kindStats || emptyKindStats();
    setFilterButtonCount('piyasaFilterBtn', kind.piyasa || 0);
    setFilterButtonCount('ihracatFilterBtn', kind.ihracat || 0);
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

  async function render(opts){
    const forceReload = !!(opts && opts.force);
    const tbody = document.getElementById('tbody');
    const showLoading = forceReload || !_eventsLoaded;
    if (showLoading && tbody) {
      tbody.innerHTML = '<tr><td colspan="7" class="text-center py-8 text-gray-500">Yükleniyor...</td></tr>';
    }
    
    try {
      await ensureEventsLoaded(forceReload);

      if (!_latestEvents || !_latestEvents.length) {
        if (tbody) {
          tbody.innerHTML = '<tr><td colspan="7" class="text-center py-8 text-gray-500">Henüz rapor bulunmuyor.</td></tr>';
        }
        updateFilterButtonCounts(emptyBasimStats(), emptyShiftStats(), emptyKindStats());
        syncDupActions(0);
        _lastDupExtraIds = [];
        syncOzmalFilterBtn();
        return;
      }

    const todayStats = _cachedTodayStats || computeTodayBasimStats(_latestEvents);
    const todayShiftStats = _cachedTodayShiftStats || computeTodayShiftStats(_latestEvents);
    const todayKindStats = _cachedTodayKindStats || computeTodayKindStats(_latestEvents);
    const vehicles = _allVehicles;

    // filters
    const plateEl = document.getElementById('plateSearch');
    const materialEl = document.getElementById('materialSearch');
    const q = normPlate((plateEl && plateEl.value) || '');
    const mq = normMaterial(((materialEl && materialEl.value) || '').trim());
    const mode = 'printed';
    try{ const fs=document.getElementById('filterSelect'); if(fs){ fs.value='printed'; fs.disabled=true; } }catch(e){}

    let rows = vehicles;
    if (q){
      rows = rows.filter(v => (v._plateNorm || normPlate(v.cekiciPlaka || '')).includes(q));
    }
    if (mq) {
      rows = rows.filter(v => rowMatchesMaterialQuery(v, mq));
    }
    if (window.__reportsDateFrom || window.__reportsDateTo) {
      rows = rows.filter(rowMatchesDateRange);
    }
    if (window.__reportsOzmalFilter) {
      rows = rows.filter(v => v._isOzmal != null ? v._isOzmal : reportRowIsOzmal(v));
    }
    const basimFilter = String(window.__reportsBasimYeriFilter || '').trim().toUpperCase();
    if (basimFilter) {
      rows = rows.filter(v => (v._basimYeri != null ? v._basimYeri : reportRowBasimYeri(v)) === basimFilter);
    }
    const shiftFilter = String(window.__reportsShiftFilter || '').trim();
    if (shiftFilter) {
      rows = rows.filter(v => (v._shiftKey != null ? v._shiftKey : reportRowShiftKey(v)) === shiftFilter);
    }
    const kindFilter = String(window.__reportsKindFilter || '').trim();
    if (kindFilter) {
      rows = rows.filter(v => (v._kind != null ? v._kind : reportRowKind(v)) === kindFilter);
    }
    if (mode === 'printed'){
      rows = rows.filter(v => (parseInt(v.printCount||'0',10)||0) > 0);
    } else if (mode === 'notprinted'){
      rows = rows.filter(v => (parseInt(v.printCount||'0',10)||0) === 0);
    }

    const dupInfo = markConsecutiveDuplicates(rows);
    _lastDupExtraIds = dupInfo.extraIds || [];
    const extraCount = dupInfo.extraCount || 0;
    if (window.__reportsDupFilter) {
      rows = rows.filter(v => v._dupGroup);
    }
    const netCount = Math.max(0, rows.length - extraCount);

    // Already sorted by API (tarih DESC); keep stable order, only re-sort if needed
    if (q || mq || window.__reportsDateFrom || window.__reportsDateTo || window.__reportsOzmalFilter || basimFilter || shiftFilter || kindFilter || window.__reportsDupFilter) {
      rows = rows.slice().sort((a,b)=>{
        const ap = (a.lastPrintSnapshot && a.lastPrintSnapshot.ts) ? Number(a.lastPrintSnapshot.ts) : 0;
        const bp = (b.lastPrintSnapshot && b.lastPrintSnapshot.ts) ? Number(b.lastPrintSnapshot.ts) : 0;
        if (bp !== ap) return bp - ap;
        return String(b.kayitTarihi||'').localeCompare(String(a.kayitTarihi||''));
      });
    }

    const tbodyEl = document.getElementById('tbody');
    syncOzmalFilterBtn();
    updateFilterButtonCounts(todayStats, todayShiftStats, todayKindStats);
    syncDupActions(extraCount);

    if (!rows.length) {
      const emptyMsg = reportsEmptyMessage(q, mq);
      tbodyEl.innerHTML = '<tr><td colspan="7" class="text-center py-8 text-gray-500">' + emptyMsg + '</td></tr>';
      try {
        const pc = document.getElementById('paginationControls');
        if (pc) pc.innerHTML = '';
      } catch (e) { /* ignore */ }
      return;
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

    const frag = document.createDocumentFragment();
    for (const v of pageRows){
      const pc = (parseInt(v.printCount||'0',10)||0);
      const printed = pc > 0;
      const tr = document.createElement('tr');

      const plate = (v.cekiciPlaka || '').toString();

      tr.setAttribute('data-print-event-id', String(v.id || '')); // report event id
      tr.setAttribute('data-vehicle-id', String(v.id || '')); // print_history id (reprint); NETSIS için data-actual-vehicle-id kullan
      tr.setAttribute('data-plate', plate || '');
      tr.setAttribute('data-kind', v._kind || reportRowKind(v) || 'piyasa');
      if (v._dupExtra) tr.classList.add('is-dup-extra');
      else if (v._dupGroup) tr.classList.add('is-dup-keep');

      // use row's own print event (no full-list scan)
      const lastEv = v.rawEvent || null;
      let lastPrintHtml = '-';
      let ts = (lastEv && lastEv.ts) || (v.lastPrintSnapshot && v.lastPrintSnapshot.ts) || null;
      if (ts) tr.setAttribute('data-ts', String(ts));
      let d = (lastEv && lastEv.data) ? lastEv.data : {};
      let saat = v._displaySaat || d.saat || '';
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

      const resolvedFirma = resolveReportFirma(
        Object.assign({}, (v.lastPrintSnapshot || {}), d || {}),
        v.defaultFirma || ''
      );
      const firmaCode = resolvedFirma.code;
      const firmaName = resolvedFirma.name;
      const soforName = (lastEv && lastEv.data && (lastEv.data.sofor
        || [lastEv.data.soforAdi, lastEv.data.soforSoyadi].filter(Boolean).join(' ').trim()))
        || '';
      const plateCellHtml = plate
        ? `${escapeRpHtml(plate)}${soforName ? `<div class="rp-sofor-line">${escapeRpHtml(soforName)}</div>` : ''}`
        : (soforName ? escapeRpHtml(soforName) : '-');
      let firmaCellHtml = '-';
      if (firmaCode) {
        const nameLine = firmaName
          ? `<span class="rp-firma-name">${escapeRpHtml(firmaName)}</span>`
          : '';
        firmaCellHtml = `<span class="rp-firma-text">${escapeRpHtml(firmaCode)}</span>${nameLine}`;
      }

      const dateStr = v._displayTarih || (ts ? ((trDateTimeFromMs(ts) || {}).tarih) : '') || ((d && d.tarih) ? (d.tarih || '-') : '-') || '-';
      const timeStr = saat || (((d && d.saat) ? d.saat : (lastEv && lastEv.saat)) || '');
      const weekNo = weekNoFromTarih(dateStr, ts);
      const dateLine = (dateStr && dateStr !== '-')
        ? (escapeRpHtml(dateStr) + (weekNo ? ' <span class="rp-week-label">(' + weekNo + '. hafta)</span>' : ''))
        : '-';
      const kind = v._kind || reportRowKind(v) || 'piyasa';
      const kindLabel = kind === 'ihracat' ? 'İhracat' : 'Piyasa';
      const kindTag = '<div class="rp-kind-tag rp-kind-tag--' + kind + '">' + kindLabel + '</div>';
      const dupTag = v._dupExtra
        ? '<div class="rp-dup-tag rp-dup-tag--extra">Fazla baskı</div>'
        : (v._dupGroup ? '<div class="rp-dup-tag rp-dup-tag--keep">Asıl</div>' : '');
      const basimCellHtml = (basim ? escapeRpHtml(basim) : '-') + kindTag + dupTag;
      const snap = v.lastPrintSnapshot || {};
      const kantarName = String(
        (d && (d.kantar || d.imzaKantarAd))
        || (lastEv && lastEv.kantar)
        || snap.kantar
        || snap.imzaKantarAd
        || ''
      ).trim();
      const kantarCellHtml = kantarName ? escapeRpHtml(kantarName) : '-';

      tr.innerHTML = `
        <td class="col-plate font-semibold" data-label="Plaka / Sürücü">${plateCellHtml}</td>
        <td class="col-firma" data-label="Firma">${firmaCellHtml}</td>
        <td class="col-malzeme" data-label="Malzeme Bilgisi">${lastPrintHtml}</td>
        <td class="col-basim" data-label="Basım Yeri">${basimCellHtml}</td>
        <td class="col-kantar" data-label="Kantar Personeli">${kantarCellHtml}</td>
        <td class="col-tarih" data-label="Tarih">${'<div style="font-weight:700">' + dateLine + '</div>' + (timeStr ? ('<div style="font-size:12px;opacity:.85">' + escapeRpHtml(timeStr) + '</div>') : '')}</td>
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
      frag.appendChild(tr);
    }
    tbodyEl.innerHTML = '';
    tbodyEl.appendChild(frag);

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
          extraCount
            ? '<span class="rp-pager-stat"><i class="fas fa-clone" aria-hidden="true"></i> Net <strong>' + netCount + '</strong> (' + extraCount + ' çift)</span>'
            : '',
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
      const tbodyErr = document.getElementById('tbody');
      if (tbodyErr) {
        tbodyErr.innerHTML = '<tr><td colspan="7" class="text-center py-8 text-red-500">Yüklenirken hata oluştu. Lütfen sayfayı yenileyin.</td></tr>';
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
            render({ force: true });
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
        closeDateRangePanel();
      });
    });

    bindDateRangePicker(applyDateRange);

    const clearFiltersBtn = document.getElementById('clearFiltersBtn');
    if (clearFiltersBtn) {
      clearFiltersBtn.addEventListener('click', () => {
        window.__reportsOzmalFilter = false;
        window.__reportsBasimYeriFilter = '';
        window.__reportsShiftFilter = '';
        window.__reportsKindFilter = '';
        window.__reportsDupFilter = false;
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

    const dupBtn = document.getElementById('dupFilterBtn');
    if (dupBtn) {
      dupBtn.addEventListener('click', () => {
        window.__reportsDupFilter = !window.__reportsDupFilter;
        window.__reportsPage = 1;
        render();
      });
    }

    const deleteDupExtrasBtn = document.getElementById('deleteDupExtrasBtn');
    if (deleteDupExtrasBtn) {
      deleteDupExtrasBtn.addEventListener('click', async () => {
        if (window.SessionManager && typeof window.SessionManager.requireValidSession === 'function') {
          const isValidSession = await window.SessionManager.requireValidSession();
          if (!isValidSession) return;
        }
        const ids = (_lastDupExtraIds || []).map((id) => String(id || '').trim()).filter(Boolean);
        if (!ids.length) {
          await uiAlert('Görünen kayıtlarda silinecek fazla baskı yok.', 'warning');
          return;
        }
        const okPass = await ensureDeletePassword();
        if (!okPass) return;
        const ok = await uiConfirm(
          ids.length + ' fazla baskı silinecek. Her çifte ilk (orijinal) kayıt kalacak. Devam edilsin mi?'
        );
        if (!ok) return;
        try {
          const response = await fetch('/api/reports/bulk-delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids })
          });
          if (!response.ok) {
            await uiAlert('Silme işlemi başarısız: ' + response.status, 'danger');
            return;
          }
          try {
            if (window.piyasa && typeof window.piyasa.reconcileOrderPrintCountsFromReports === 'function') {
              await window.piyasa.reconcileOrderPrintCountsFromReports();
            }
          } catch (e) {}
          try {
            if (typeof window._ihracatOnReportsChanged === 'function') {
              window._ihracatOnReportsChanged();
            }
          } catch (e) {}
          window.__reportsDupFilter = false;
          await uiAlert(ids.length + ' fazla baskı silindi. Kalan kayıtlar net sayıdır.', 'success');
          render({ force: true });
        } catch (e) {
          await uiAlert('Silme işlemi başarısız: ' + (e && e.message ? e.message : e), 'danger');
        }
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

    function toggleKindFilter(kind) {
      const next = String(kind || '').trim();
      if (!next) return;
      window.__reportsKindFilter = (window.__reportsKindFilter === next) ? '' : next;
      window.__reportsPage = 1;
      render();
    }

    const piyasaBtn = document.getElementById('piyasaFilterBtn');
    if (piyasaBtn) {
      piyasaBtn.addEventListener('click', () => toggleKindFilter('piyasa'));
    }

    const ihracatBtn = document.getElementById('ihracatFilterBtn');
    if (ihracatBtn) {
      ihracatBtn.addEventListener('click', () => toggleKindFilter('ihracat'));
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
      if (_allVehicles && _allVehicles.length) {
        for (let i = 0; i < _allVehicles.length; i++) {
          _allVehicles[i]._isOzmal = reportRowIsOzmal(_allVehicles[i]);
        }
      }
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

  function buildReprintPayloadFromRow(tr) {
    const d = parseRowEventData(tr) || {};
    const plate = tr.getAttribute('data-plate') || d.plaka || '';
    const printEventId = tr.getAttribute('data-print-event-id') || tr.getAttribute('data-vehicle-id') || '';
    const actualVehicleId = tr.getAttribute('data-actual-vehicle-id') || d.vehicleId || d.vehicle_id || '';
    const amb = d.ambalajBilgisi || d.ambalaj || d.yuklemeTuru || '';
    const note = d.yuklemeNotu || d.baskiNotu || d.not || '';
    return {
      printHistoryId: String(printEventId || '').trim(),
      vehicleId: String(actualVehicleId || '').trim(),
      plaka: String(plate || '').trim(),
      firma: d.firma || d.firmaKodu || d.firmaSelect || '',
      firmaKodu: d.firmaKodu || d.firma || '',
      firmaSelect: d.firmaSelect || '',
      firmaAdi: d.firmaAdi || '',
      malzeme: d.malzeme || '',
      sevkYeri: d.sevkYeri || '',
      tonaj: d.tonaj || '',
      basimYeri: d.basimYeri || '',
      yuklemeSirasi: d.yuklemeSirasi || '',
      ambalajBilgisi: amb,
      ambalaj: amb,
      yuklemeNotu: note,
      baskiNotu: note,
      seperatorBilgisi: d.seperatorBilgisi || '',
      sofor: d.sofor || '',
      soforAdi: d.soforAdi || '',
      soforSoyadi: d.soforSoyadi || '',
      tcKimlik: d.tcKimlik || '',
      iletisim: d.iletisim || '',
      dorsePlaka: d.dorsePlaka || '',
      bbt: d.bbt || '',
      bosBbt: d.bosBbt || '',
      cuval: d.cuval || '',
      bosCuval: d.bosCuval || '',
      palet: d.palet || '',
      torba: d.torba || '',
      kantar: d.kantar || d.imzaKantarAd || '',
      imzaSahaAd: d.imzaSahaAd || d.saha || '',
      imzaYukleyenAd: d.imzaYukleyenAd || '',
      imzaKaliteAd: d.imzaKaliteAd || '',
      tarih: d.tarih || '',
    };
  }

  async function enrichReprintPayload(payload) {
    const out = Object.assign({}, payload || {});
    const needsNote = !String(out.yuklemeNotu || '').trim();
    const needsAmb = !String(out.ambalajBilgisi || '').trim();
    const phId = String(out.printHistoryId || '').trim();
    if ((!needsNote && !needsAmb) || !phId) return out;
    try {
      // Tek kayıt: listeden id ile bul (snapshot dahil)
      const r = await fetch('/api/reports?limit=300&_=' + Date.now(), {
        credentials: 'include',
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache' },
      });
      if (!r.ok) return out;
      const list = await r.json();
      const hit = (Array.isArray(list) ? list : []).find((ev) => ev && String(ev.id) === phId);
      if (!hit) return out;
      const d = Object.assign({}, hit.snapshot || {}, hit.data || {});
      const amb = d.ambalajBilgisi || d.ambalaj || d.yuklemeTuru || '';
      const note = d.yuklemeNotu || d.baskiNotu || '';
      const mergeIfEmpty = (key, val) => {
        if (!String(out[key] || '').trim() && val != null && String(val).trim() !== '') out[key] = String(val).trim();
      };
      mergeIfEmpty('yuklemeNotu', note);
      mergeIfEmpty('baskiNotu', note);
      mergeIfEmpty('ambalajBilgisi', amb);
      mergeIfEmpty('ambalaj', amb);
      ['firma', 'malzeme', 'sevkYeri', 'tonaj', 'basimYeri', 'yuklemeSirasi', 'seperatorBilgisi',
        'sofor', 'tcKimlik', 'iletisim', 'dorsePlaka', 'bbt', 'bosBbt', 'cuval', 'bosCuval',
        'palet', 'torba', 'kantar', 'imzaSahaAd', 'imzaYukleyenAd', 'imzaKaliteAd', 'plaka'].forEach((k) => {
        mergeIfEmpty(k, d[k]);
      });
      if (!out.vehicleId && d.vehicleId) out.vehicleId = String(d.vehicleId);
    } catch (e) { /* ignore */ }
    return out;
  }

  async function handleReprint(btn, tr) {
    const printHistoryId = tr.getAttribute('data-print-event-id') || tr.getAttribute('data-vehicle-id') || btn.getAttribute('data-id') || '';
    const actualVehicleId = tr.getAttribute('data-actual-vehicle-id') || '';
    const plate = tr.getAttribute('data-plate') || '';
    if (!printHistoryId && !actualVehicleId && !plate) return;

    let payload = buildReprintPayloadFromRow(tr);
    flashBtnBusy(btn);
    try {
      payload = await enrichReprintPayload(payload);
    } catch (e) { /* ignore */ }

    const url = new URL('GIRIS.html', window.location.origin);
    // Ana sayfa araç bulsun diye gerçek vehicleId; yoksa print history id
    const reprintKey = payload.vehicleId || actualVehicleId || printHistoryId;
    if (reprintKey) url.searchParams.set('reprint', reprintKey);
    if (plate) url.searchParams.set('plate', plate);

    const firma = payload.firma || payload.firmaKodu;
    if (firma) url.searchParams.set('firma', firma);
    if (payload.malzeme) url.searchParams.set('malzeme', payload.malzeme);
    if (payload.sevkYeri) url.searchParams.set('sevkYeri', payload.sevkYeri);
    if (payload.kantar) url.searchParams.set('kantar', payload.kantar);
    if (payload.basimYeri) url.searchParams.set('basimYeri', payload.basimYeri);
    if (payload.ambalajBilgisi) url.searchParams.set('ambalaj', payload.ambalajBilgisi);
    if (payload.yuklemeNotu) url.searchParams.set('baskiNotu', payload.yuklemeNotu);

    try {
      localStorage.setItem('tempReprintData', JSON.stringify(payload));
      localStorage.setItem('pendingReprint', JSON.stringify({
        reprint: reprintKey,
        plate: plate,
        printHistoryId: printHistoryId,
        at: Date.now()
      }));
    } catch (e) { /* ignore */ }

    if (window.SessionManager && typeof window.SessionManager.openHomeForReprint === 'function') {
      window.SessionManager.openHomeForReprint({ vehicleId: reprintKey, plate: plate });
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
        try { await handleReprint(btn, tr); } catch (e) { /* ignore */ }
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
          render({ force: true });
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
    loadFirmaNameMap().then((added) => {
      if (added) render();
    });
    
    // 🔄 UNIFIED CROSS-TAB SYNCHRONIZATION
    function initReportSync() {
      // Wait for SyncManager to be available
      function waitForSyncManager() {
        if (window.SyncManager) {
          console.log('🔄 Reports page: Using unified sync manager');
          
          // Register report-specific handlers
          window.SyncManager.on('new_report', (data) => {
            console.log('🔄 New report received:', data);
            render({ force: true });
          });
          
          window.SyncManager.on('report_deleted', (data) => {
            console.log('🔄 Report deleted:', data);
            render({ force: true });
          });
          
          window.SyncManager.on('reports_deleted', (data) => {
            console.log('🔄 Multiple reports deleted:', data);
            render({ force: true });
          });
          
          // Manual refresh trigger
          window.SyncManager.on('manual_refresh', (data) => {
            if (data.dataType === 'reports' || data.dataType === 'all') {
              console.log('🔄 Manual refresh for reports');
              render({ force: true });
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
