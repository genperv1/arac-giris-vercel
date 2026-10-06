// Piyasa gelen araç: WhatsApp metnini ayır, plakayı bu haftanın siparişine bağla.
(function (root) {
  'use strict';

  const PLATE_SRC = '(\\d{2})[ \\t]*([A-Za-zÇĞİÖŞÜçğıöşü]{1,3})[ \\t]*(\\d{2,5})';
  const LABEL_TOKEN = '(?:HP|CR|hp|cr)\\s*-?\\s*\\d{1,3}|(?:İ|I)\\s*-?\\s*\\d{2,4}';
  const PHONE_SRC = '(?:\\+90|0)?[ \\t./-]*5(?:[ \\t./-]*\\d){9}';

  function clip(value, max) {
    return String(value == null ? '' : value).replace(/[\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
  }

  function foldTr(value) {
    return String(value || '').toLocaleUpperCase('tr-TR').replace(/İ/g, 'I').replace(/\u0307/g, '');
  }

  function normExpectedPlate(value) {
    return foldTr(value).replace(/[^A-Z0-9]/g, '');
  }

  function isPlateNorm(value) {
    return /^\d{2}[A-Z]{1,3}\d{2,5}$/.test(normExpectedPlate(value));
  }

  function phoneDigits(value) {
    let d = String(value || '').replace(/\D/g, '');
    if (d.startsWith('90') && d.length >= 12) d = d.slice(2);
    if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
    return d.length === 10 && d.startsWith('5') ? d : '';
  }

  function tcDigits(value) {
    const d = String(value || '').replace(/\D/g, '');
    return d.length === 11 && d[0] !== '0' ? d : '';
  }

  function extractLabels(text) {
    const re = new RegExp('(?:^|[^A-Za-zÇĞİÖŞÜçğıöşü])(' + LABEL_TOKEN + ')', 'g');
    const out = [];
    const seen = new Set();
    const src = ' ' + String(text || '');
    let m;
    while ((m = re.exec(src))) {
      const lab = foldTr(m[1]).replace(/[^A-Z0-9]/g, '');
      if (!lab || seen.has(lab)) continue;
      seen.add(lab);
      out.push(lab);
    }
    return out;
  }

  function labelOnly(line) {
    const labels = extractLabels(line);
    if (!labels.length) return '';
    const stripped = String(line || '')
      .replace(new RegExp(LABEL_TOKEN, 'g'), ' ')
      .replace(/araç\s*bilgileri/gi, ' ')
      .replace(/[^A-Za-zÇĞİÖŞÜçğıöşü]/g, '')
      .trim();
    return stripped ? '' : labels[0];
  }

  function splitSections(text) {
    const sections = [{ label: '', lines: [] }];
    String(text || '').split(/\r?\n/).forEach((line) => {
      const only = labelOnly(line);
      if (only) {
        const prev = sections[sections.length - 1];
        const hasBody = prev.lines.some((l) => String(l).trim());
        if (!prev.label) prev.label = only;
        else if (hasBody) sections.push({ label: only, lines: [] });
        return;
      }
      sections[sections.length - 1].lines.push(line);
    });
    return sections.map((s) => ({ label: s.label, body: s.lines.join('\n') }));
  }

  function extractPlates(text) {
    const re = new RegExp(PLATE_SRC, 'gi');
    const plates = [];
    const src = String(text || '');
    let m;
    while ((m = re.exec(src))) {
      const norm = normExpectedPlate(m[1] + m[2] + m[3]);
      if (!isPlateNorm(norm)) continue;
      const before = src.slice(Math.max(0, m.index - 16), m.index).toLocaleLowerCase('tr-TR');
      let role = '';
      if (before.indexOf('dorse') !== -1) role = 'dorse';
      else if (before.indexOf('çekici') !== -1 || before.indexOf('cekici') !== -1) role = 'cekici';
      plates.push({ norm, role });
    }
    return plates;
  }

  function extractPhones(text) {
    const re = new RegExp(PHONE_SRC, 'g');
    const out = [];
    const seen = new Set();
    let m;
    while ((m = re.exec(String(text || '')))) {
      const d = phoneDigits(m[0]);
      if (!d || seen.has(d)) continue;
      seen.add(d);
      out.push(d);
    }
    return out;
  }

  function extractTcs(text) {
    const noPhone = String(text || '')
      .replace(new RegExp(PHONE_SRC, 'g'), ' ')
      .replace(new RegExp(PLATE_SRC, 'gi'), ' ');
    const re = /\d(?:[ .]*\d){10}/g;
    const out = [];
    const seen = new Set();
    let m;
    while ((m = re.exec(noPhone))) {
      const d = tcDigits(m[0]);
      if (!d || seen.has(d)) continue;
      seen.add(d);
      out.push(d);
    }
    return out;
  }

  function isPersonName(value) {
    const t = String(value || '').replace(/\s+/g, ' ').trim();
    if (!/^[\p{L}][\p{L}'.’\-]*(?:\s+[\p{L}][\p{L}'.’\-]*)+$/u.test(t)) return false;
    const fold = t.toLocaleLowerCase('tr-TR');
    if (/gelecek|bugün|bugun|araç|arac|bilgi|adına|adina|plaka|çekici|cekici|dorse|toplam|iptal/.test(fold)) return false;
    return true;
  }

  function nameFromChunk(text) {
    const lines = String(text || '').split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      let s = lines[i];
      s = s.replace(new RegExp(PLATE_SRC, 'gi'), ' ');
      s = s.replace(new RegExp(PHONE_SRC, 'g'), ' ');
      s = s.replace(new RegExp(LABEL_TOKEN, 'g'), ' ');
      s = s.replace(/\d(?:[ .]*\d){10}/g, ' ');
      s = s.replace(/\b(tel|telefon|t\.?\s*c\.?|çekici|cekici|dorse|plaka)\b/gi, ' ');
      s = s.replace(/[^\p{L}\s'.’\-]/gu, ' ').replace(/\s+/g, ' ').trim();
      s = s.replace(/^[.\s]+|[.\s]+$/g, '');
      if (isPersonName(s)) return s;
    }
    return '';
  }

  function parseChunk(chunk, sectionLabel) {
    const body = String(chunk || '').trim();
    if (!body) return null;
    const plates = extractPlates(body);
    if (!plates.length) return null;
    let cekici = '';
    let dorse = '';
    plates.forEach((p) => {
      if (p.role === 'cekici' && !cekici) cekici = p.norm;
      else if (p.role === 'dorse' && !dorse) dorse = p.norm;
    });
    plates.forEach((p) => {
      if (p.role) return;
      if (!cekici) cekici = p.norm;
      else if (!dorse && p.norm !== cekici) dorse = p.norm;
    });
    if (!cekici && dorse) {
      cekici = dorse;
      dorse = '';
    }
    if (!cekici) return null;
    const labels = extractLabels(body);
    const phones = extractPhones(body);
    const tcs = extractTcs(body);
    return {
      cekici,
      dorse,
      sofor: nameFromChunk(body),
      telefon: phones[0] || '',
      tc: tcs[0] || '',
      label: sectionLabel || labels[0] || '',
    };
  }

  function parsePiyasaExpectedPaste(text) {
    const sections = splitSections(text);
    const vehicles = [];
    sections.forEach((sec) => {
      sec.body.split(/\n\s*\n+/).forEach((chunk) => {
        const row = parseChunk(chunk, sec.label);
        if (row) vehicles.push(row);
      });
    });
    const labels = extractLabels(text);
    if (labels.length === 1) {
      vehicles.forEach((row) => {
        if (!row.label) row.label = labels[0];
      });
    }
    return { vehicles, labels };
  }

  function sanitizeExpectedItems(list) {
    const out = [];
    const indexByKey = new Map();
    const arr = Array.isArray(list) ? list : [];
    for (let i = 0; i < arr.length; i++) {
      const raw = arr[i];
      if (!raw || typeof raw !== 'object') continue;
      const cekici = normExpectedPlate(raw.cekici);
      const dorse = normExpectedPlate(raw.dorse);
      const weekKey = String(raw.weekKey || '').trim();
      if (!/^\d{4}:\d{1,2}$/.test(weekKey)) continue;
      if (!isPlateNorm(cekici)) continue;
      const item = {
        id: weekKey + ':' + cekici,
        weekKey,
        orderKey: clip(raw.orderKey, 80),
        firma: clip(raw.firma, 80),
        malzeme: clip(raw.malzeme, 160),
        label: clip(foldTr(raw.label).replace(/[^A-Z0-9]/g, ''), 16),
        cekici,
        dorse: isPlateNorm(dorse) && dorse !== cekici ? dorse : '',
        sofor: clip(raw.sofor, 80),
        telefon: phoneDigits(raw.telefon),
        tc: tcDigits(raw.tc),
        printedAt: printedAtMs(raw.printedAt),
        basimYeri: normalizeBasimYeri(raw.basimYeri),
      };
      if (indexByKey.has(item.id)) out[indexByKey.get(item.id)] = item;
      else if (out.length < 400) {
        indexByKey.set(item.id, out.length);
        out.push(item);
      }
    }
    return out;
  }

  function platesMissingFromRegistry(plates, vehicles) {
    const known = new Set();
    (Array.isArray(vehicles) ? vehicles : []).forEach((vehicle) => {
      const key = normExpectedPlate(vehicle && (vehicle.cekiciPlaka || vehicle.plaka));
      if (key) known.add(key);
    });
    if (!known.size) return [];
    const missing = [];
    const seen = new Set();
    (Array.isArray(plates) ? plates : []).forEach((plate) => {
      const key = normExpectedPlate(plate);
      if (!isPlateNorm(key) || seen.has(key) || known.has(key)) return;
      seen.add(key);
      missing.push(key);
    });
    return missing;
  }

  function normalizeBasimYeri(value) {
    const s = foldTr(value).replace(/[\s._-]/g, '');
    if (s === 'AVDAN') return 'avdan';
    if (s === '1OSB' || s === 'OSB') return '1.OSB';
    return '';
  }

  function printedAtMs(value) {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) return Math.round(value);
    const n = Number(value);
    if (Number.isFinite(n) && n > 1e11) return Math.round(n);
    const parsed = Date.parse(String(value || ''));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }

  function weekKeyFromMs(ms) {
    const n = Number(ms);
    if (!Number.isFinite(n) || n <= 0) return '';
    try {
      const ymd = new Date(n).toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
      const m = String(ymd).match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (!m) return '';
      const date = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
      const dayNum = date.getUTCDay() || 7;
      date.setUTCDate(date.getUTCDate() + 4 - dayNum);
      const isoYear = date.getUTCFullYear();
      const yearStart = new Date(Date.UTC(isoYear, 0, 1));
      const week = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
      return week > 0 ? (isoYear + ':' + week) : '';
    } catch (e) {
      return '';
    }
  }

  function applyPrintHistoryToExpected(items, prints) {
    const clean = sanitizeExpectedItems(items);
    const rows = Array.isArray(prints) ? prints : [];
    return clean.map((item) => {
      const plates = new Set([item.cekici, item.dorse].filter(Boolean));
      let best = null;
      rows.forEach((row) => {
        const plaka = normExpectedPlate(row && (row.plaka || row.plate));
        const dorse = normExpectedPlate(row && (row.dorse_plaka || row.dorsePlaka || row.dorse));
        if (!plates.has(plaka) && !plates.has(dorse)) return;
        const ts = printedAtMs(row && (row.tarih || row.ts || row.printedAt));
        if (!ts || weekKeyFromMs(ts) !== item.weekKey) return;
        const basim = normalizeBasimYeri(row.basim_yeri || row.basimYeri);
        if (!best || ts > best.ts) best = { ts, basim };
      });
      if (!best) return item;
      if (item.printedAt >= best.ts && item.basimYeri) return item;
      return Object.assign({}, item, {
        printedAt: best.ts,
        basimYeri: best.basim || item.basimYeri || '',
      });
    });
  }

  function stampExpectedPrint(items, opts) {
    const src = opts && typeof opts === 'object' ? opts : {};
    const plates = [src.plate, src.dorse].map(normExpectedPlate).filter(isPlateNorm);
    const plate = plates[0] || '';
    const place = normalizeBasimYeri(src.basimYeri);
    const when = printedAtMs(src.ts) || Date.now();
    const clean = sanitizeExpectedItems(items);
    if (!isPlateNorm(plate) || !place) return { items: clean, changed: false };
    const week = String(src.weekKey || '').trim();
    const plateSet = new Set(plates);
    const hits = clean.filter((item) => plateSet.has(item.cekici) || plateSet.has(item.dorse));
    let targets = [];
    if (/^\d{4}:\d{1,2}$/.test(week)) {
      targets = hits.filter((item) => item.weekKey === week);
    } else if (hits.length) {
      const newest = hits.slice().sort((a, b) => String(b.weekKey).localeCompare(String(a.weekKey)))[0];
      targets = newest ? hits.filter((item) => item.weekKey === newest.weekKey) : [];
    }
    if (!targets.length) return { items: clean, changed: false };
    const ids = new Set(targets.map((item) => item.id));
    const next = clean.map((item) => (
      ids.has(item.id) ? Object.assign({}, item, { printedAt: when, basimYeri: place }) : item
    ));
    return { items: sanitizeExpectedItems(next), changed: true };
  }

  function matchExpectedByPlate(items, plate, weekKey) {
    const key = normExpectedPlate(plate);
    const week = String(weekKey || '').trim();
    if (!isPlateNorm(key) || !week) return [];
    return sanitizeExpectedItems(items).filter((item) => {
      return item.weekKey === week && (item.cekici === key || item.dorse === key);
    });
  }

  function orderBlob(order) {
    if (!order) return '';
    return [
      order.firma, order.firmaAdi, order.malzeme, order.sipNo,
      order.aciklama, order.sevkYeri, order.il, order.yuklemeTuru,
    ].map((part) => foldTr(part)).join(' ');
  }

  function orderMatchesQuery(order, query) {
    const q = foldTr(query).replace(/[^A-Z0-9]/g, '');
    if (!q) return false;
    const blob = orderBlob(order);
    return new RegExp('(^|[^A-Z0-9])' + q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([^A-Z0-9]|$)').test(blob);
  }

  function orderSearchText(order) {
    return foldTr([
      order && order.firma,
      order && order.firmaAdi,
      order && order.malzeme,
      order && order.sipNo,
      order && order.il,
      order && order.sevkYeri,
    ].filter(Boolean).join(' '));
  }

  function filterOrdersForSelect(orders, query) {
    const list = Array.isArray(orders) ? orders : [];
    const q = foldTr(query).replace(/\s+/g, ' ').trim();
    if (!q) return list.slice();
    const compact = q.replace(/[^A-Z0-9]/g, '');
    return list.filter((order) => {
      const blob = orderSearchText(order);
      if (blob.indexOf(q) !== -1) return true;
      return !!(compact && blob.replace(/[^A-Z0-9]/g, '').indexOf(compact) !== -1);
    });
  }

  const api = {
    parsePiyasaExpectedPaste,
    sanitizeExpectedItems,
    normExpectedPlate,
    matchExpectedByPlate,
    orderMatchesQuery,
    filterOrdersForSelect,
    platesMissingFromRegistry,
    stampExpectedPrint,
    applyPrintHistoryToExpected,
    normalizeBasimYeri,
    phoneDigits,
    tcDigits,
    extractLabels,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;

  function esc(value) {
    if (typeof escapeHtml === 'function') return escapeHtml(value);
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatPlateShow(value) {
    const n = normExpectedPlate(value);
    if (typeof formatPlakaForInput === 'function' && n) {
      try { return formatPlakaForInput(n); } catch (e) {}
    }
    return n;
  }

  function formatExpectedPrintLine(item) {
    const ts = printedAtMs(item && item.printedAt);
    if (!ts) return '';
    const place = normalizeBasimYeri(item && item.basimYeri);
    let when = '';
    try {
      when = new Date(ts).toLocaleString('tr-TR', {
        timeZone: 'Europe/Istanbul',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch (e) {
      when = new Date(ts).toLocaleString('tr-TR');
    }
    const where = place === '1.OSB' ? '1.OSB' : (place === 'avdan' ? 'avdan' : '');
    return 'Basıldı · ' + when + (where ? ' · ' + where : '');
  }

  function formatPhoneShow(value) {
    const d = phoneDigits(value);
    if (!d) return '';
    return '0' + d.slice(0, 3) + ' ' + d.slice(3, 6) + ' ' + d.slice(6, 8) + ' ' + d.slice(8);
  }

  function piyasaState() {
    try {
      if (typeof state !== 'undefined' && state && (state.week != null || (state.orders && state.orders.length))) return state;
    } catch (e) {}
    const viaApi = root.piyasa && root.piyasa._state;
    if (viaApi && (viaApi.week != null || (viaApi.orders && viaApi.orders.length))) return viaApi;
    return (root && root.state) || {};
  }

  function currentExpectedWeekKey() {
    const st = piyasaState();
    const fromSheet = typeof durumWeekKeyForContext === 'function'
      ? durumWeekKeyForContext(st.week, st.sheetDate)
      : '';
    if (fromSheet) return fromSheet;
    if (typeof _isoWeekPartsFromMs === 'function') {
      const parts = _isoWeekPartsFromMs(Date.now());
      if (parts && parts.year && parts.week) return parts.year + ':' + parts.week;
    }
    return '';
  }

  function ordersForExpectedWeek() {
    const st = piyasaState();
    const week = st.week;
    const out = [];
    const seen = new Set();
    const add = (order) => {
      if (!order || typeof getOrderPickKey !== 'function') return;
      const key = getOrderPickKey(order);
      if (key == null || key === '' || seen.has(String(key))) return;
      seen.add(String(key));
      out.push(order);
    };
    (st.orders || []).forEach(add);
    (st.weekArchive || []).forEach((block) => {
      if (week != null && String(block.week) !== String(week)) return;
      (block.orders || []).forEach(add);
    });
    return out;
  }

  let _expectedItems = [];
  let _expectedLoadedAt = 0;
  let _expectedBusy = false;
  let _expectedPromptPlate = '';

  async function loadExpectedArrivals(force) {
    if (!force && _expectedLoadedAt && Date.now() - _expectedLoadedAt < 15000) return _expectedItems;
    try {
      const res = await fetch('/api/piyasa/expected', { credentials: 'include' });
      if (!res.ok) return _expectedItems;
      const data = await res.json();
      _expectedItems = sanitizeExpectedItems(data && data.items);
      _expectedLoadedAt = Date.now();
    } catch (e) {}
    return _expectedItems;
  }

  async function markExpectedArrivalPrinted(opts) {
    const plate = normExpectedPlate(opts && opts.plate);
    if (!isPlateNorm(plate)) return false;
    try {
      const res = await fetch('/api/piyasa/expected/printed', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          plate,
          dorse: opts && opts.dorse,
          basimYeri: opts && opts.basimYeri,
          ts: opts && opts.ts,
          weekKey: (opts && opts.weekKey) || currentExpectedWeekKey(),
        }),
      });
      if (!res.ok) return false;
      const data = await res.json();
      if (data && Array.isArray(data.items)) {
        _expectedItems = sanitizeExpectedItems(data.items);
        _expectedLoadedAt = Date.now();
      }
      const savedHost = document.getElementById('piyasaExpectedSaved');
      if (savedHost) renderSavedExpected(savedHost, _expectedItems);
      return !!(data && data.changed);
    } catch (e) {
      return false;
    }
  }

  async function saveExpectedItems(items) {
    const clean = sanitizeExpectedItems(items);
    const res = await fetch('/api/piyasa/expected', {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: clean }),
    });
    if (!res.ok) throw new Error('save failed');
    const data = await res.json();
    _expectedItems = sanitizeExpectedItems(data && data.items);
    _expectedLoadedAt = Date.now();
    return _expectedItems;
  }

  function orderOptionLabel(order) {
    const firma = String(order.firma || '').trim();
    const malzeme = String(order.malzeme || '').trim();
    const il = String(order.il || order.sevkYeri || '').trim();
    return [firma, malzeme, il].filter(Boolean).join(' · ');
  }

  const AMIR_ENTRY_NOTE = 'Şaban Lahaçlar adlı amir girdi.';

  function registryVehicles() {
    try {
      if (root.storage && typeof root.storage.loadAll === 'function') {
        const list = root.storage.loadAll();
        if (Array.isArray(list) && list.length) return list;
      }
    } catch (e) {}
    return [];
  }

  function stampAmirEntryNote() {
    const el = document.getElementById('yuklemeNotu');
    if (!el) return;
    const cur = String(el.value || '');
    if (cur.indexOf(AMIR_ENTRY_NOTE) !== -1) return;
    el.value = cur.trim() ? (cur.replace(/\s+$/, '') + '\n' + AMIR_ENTRY_NOTE) : AMIR_ENTRY_NOTE;
    try { el.dispatchEvent(new Event('input', { bubbles: true })); } catch (e) {}
  }

  function fillExpectedContact(hit) {
    const setIfEmpty = (id, value) => {
      const el = document.getElementById(id);
      const next = String(value || '').trim();
      if (!el || !next || String(el.value || '').trim()) return;
      el.value = next;
      try { el.dispatchEvent(new Event('input', { bubbles: true })); } catch (e) {}
      try { el.dispatchEvent(new Event('change', { bubbles: true })); } catch (e) {}
    };
    setIfEmpty('dorsePlakaBilgi', hit.dorse ? formatPlateShow(hit.dorse) : '');
    setIfEmpty('soforBilgi', hit.sofor || '');
    setIfEmpty('iletisimBilgi', formatPhoneShow(hit.telefon));
    setIfEmpty('tcBilgi', hit.tc || '');
  }

  function applyExpectedHit(hit, plate) {
    const order = hit.orderKey && typeof getOrderByIdx === 'function' ? getOrderByIdx(hit.orderKey) : null;
    if (order && typeof applyOrderToForm === 'function') {
      applyOrderToForm(order, { forceReuse: true });
      if (typeof markOrderUsed === 'function') markOrderUsed(order, plate);
    }
    fillExpectedContact(hit);
    setTimeout(stampAmirEntryNote, 280);
    if (typeof toast === 'function') toast(AMIR_ENTRY_NOTE, 'info');
  }

  async function applyExpectedOnTakipOpen(raw) {
    const plate = normExpectedPlate(raw);
    if (!isPlateNorm(plate)) return;
    if (_expectedBusy) return;
    _expectedPromptPlate = plate;
    try {
      const items = await loadExpectedArrivals(true);
      const hits = matchExpectedByPlate(items, plate, currentExpectedWeekKey());
      if (!hits.length) {
        _expectedPromptPlate = '';
        return;
      }
      const chosen = hits.length === 1 ? hits[0] : await promptExpectedHits(hits);
      if (!chosen) return;
      applyExpectedHit(chosen, plate);
    } catch (e) {}
  }

  function expectedHitTitle(hit) {
    const plate = formatPlateShow(hit.cekici);
    const tag = hit.label || [hit.firma, hit.malzeme].filter(Boolean).join(' ');
    return plate + ' bu hafta ' + (tag || 'bu') + ' sevkiyatına kayıtlı.';
  }

  function promptExpectedHits(hits) {
    return new Promise((resolve) => {
      const old = document.getElementById('piyasaExpectedPrompt');
      if (old) old.remove();
      const overlay = document.createElement('div');
      overlay.id = 'piyasaExpectedPrompt';
      overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483000;background:rgba(15,23,42,.28);display:flex;align-items:flex-start;justify-content:center;padding:18px;';
      const rows = hits.map((hit, i) => {
        const printed = formatExpectedPrintLine(hit);
        return '<button type="button" data-i="' + i + '" style="display:block;width:100%;text-align:left;border:1px solid #e2e8f0;background:#fff;border-radius:10px;padding:10px 12px;margin-top:8px;cursor:pointer;font-weight:700;">'
          + esc(expectedHitTitle(hit))
          + (hit.sofor ? '<div style="font-weight:500;color:#475569;margin-top:4px;">' + esc(hit.sofor) + '</div>' : '')
          + (printed ? '<div style="font-weight:700;color:#166534;margin-top:4px;">' + esc(printed) + '</div>' : '')
          + '</button>';
      }).join('');
      overlay.innerHTML = ''
        + '<div style="width:min(520px,96vw);margin-top:8vh;background:#fff;border-radius:14px;box-shadow:0 12px 32px rgba(0,0,0,.2);overflow:hidden;">'
        + '<div style="padding:14px 16px;font-weight:800;border-bottom:1px solid #eee;">Gelecek araçlar</div>'
        + '<div style="padding:8px 16px 14px;">' + rows + '</div>'
        + '<div style="display:flex;justify-content:flex-end;padding:12px 16px;border-top:1px solid #eee;">'
        + '<button type="button" id="piyasaExpectedSkip" style="border:0;background:#e5e7eb;border-radius:8px;padding:8px 12px;cursor:pointer;font-weight:700;">Vazgeç</button>'
        + '</div></div>';
      document.body.appendChild(overlay);
      const close = (value) => {
        try { overlay.remove(); } catch (e) {}
        resolve(value);
      };
      overlay.addEventListener('click', (ev) => {
        if (ev.target === overlay) close(null);
        const btn = ev.target.closest && ev.target.closest('button[data-i]');
        if (!btn) return;
        const idx = Number(btn.getAttribute('data-i'));
        close(hits[idx] || null);
      });
      const skip = overlay.querySelector('#piyasaExpectedSkip');
      if (skip) skip.onclick = () => close(null);
    });
  }

  async function offerExpectedForPlate(raw) {
    const plate = normExpectedPlate(raw);
    if (!isPlateNorm(plate)) return;
    if (_expectedPromptPlate && _expectedPromptPlate !== plate) _expectedPromptPlate = '';
    if (_expectedBusy || _expectedPromptPlate === plate) return;
    if (!document.getElementById('cekiciPlakaBilgi')) return;
    _expectedBusy = true;
    try {
      const items = await loadExpectedArrivals(false);
      const hits = matchExpectedByPlate(items, plate, currentExpectedWeekKey());
      if (!hits.length) return;
      _expectedPromptPlate = plate;
      const chosen = await promptExpectedHits(hits);
      if (chosen) applyExpectedHit(chosen, plate);
    } catch (e) {}
    finally { _expectedBusy = false; }
  }

  function rankOrdersForLabel(orders, label) {
    const all = Array.isArray(orders) ? orders : [];
    if (!label) return all.slice();
    const hits = [];
    const rest = [];
    all.forEach((order) => {
      if (orderMatchesQuery(order, label)) hits.push(order);
      else rest.push(order);
    });
    return hits.length ? hits.concat(rest) : all.slice();
  }

  function renderExpectedPreview(host, vehicles, orders) {
    if (!vehicles.length) {
      host.innerHTML = '<div class="gea-empty">Plaka bulunamadı. Metni olduğu gibi yapıştır.</div>';
      return;
    }
    host.innerHTML = '<div class="gea-section-title">Okunan araçlar</div>' + vehicles.map((row, i) => {
      return '<div class="gea-preview" data-expected-row="' + i + '">'
        + '<div class="gea-plate">' + esc(formatPlateShow(row.cekici))
        + (row.dorse ? ' <span class="gea-muted">/</span> ' + esc(formatPlateShow(row.dorse)) : '')
        + (row.label ? ' <span class="gea-arrow">→</span> ' + esc(row.label) : '')
        + '</div>'
        + '<div class="gea-meta">'
        + esc([row.sofor, formatPhoneShow(row.telefon), row.tc].filter(Boolean).join(' · '))
        + '</div>'
        + '<input class="gea-input" data-order-q type="text" placeholder="Sipariş ara (M24, firma, şehir)">'
        + '<select class="gea-input" data-order></select>'
        + '</div>';
    }).join('');
    host.querySelectorAll('[data-expected-row]').forEach((card, i) => {
      const row = vehicles[i];
      const ranked = rankOrdersForLabel(orders, row.label);
      const hits = (orders || []).filter((order) => row.label && orderMatchesQuery(order, row.label));
      const sel = card.querySelector('[data-order]');
      const input = card.querySelector('[data-order-q]');
      const selected = (hits.length === 1 && typeof getOrderPickKey === 'function')
        ? String(getOrderPickKey(hits[0]) || '')
        : '';
      const paint = () => {
        if (!sel) return;
        const keep = sel.value || selected;
        sel.innerHTML = expectedOrderOptions(filterOrdersForSelect(ranked, input ? input.value : ''), keep, ranked);
      };
      paint();
      if (input) input.addEventListener('input', paint);
    });
  }

  function expectedFieldStyle() {
    return 'gea-input';
  }

  function expectedOrderOptions(orders, selectedKey, allOrders) {
    const selected = String(selectedKey || '');
    const seen = new Set();
    const opts = ['<option value="">Sipariş satırı seç</option>'];
    (Array.isArray(orders) ? orders : []).forEach((order) => {
      const key = typeof getOrderPickKey === 'function' ? String(getOrderPickKey(order) || '') : '';
      if (!key || seen.has(key)) return;
      seen.add(key);
      opts.push('<option value="' + esc(key) + '"' + (key === selected ? ' selected' : '') + '>' + esc(orderOptionLabel(order)) + '</option>');
    });
    if (selected && !seen.has(selected)) {
      const pool = Array.isArray(allOrders) ? allOrders : [];
      const hit = pool.find((order) => {
        const key = typeof getOrderPickKey === 'function' ? String(getOrderPickKey(order) || '') : '';
        return key === selected;
      });
      opts.push('<option value="' + esc(selected) + '" selected>' + esc(hit ? orderOptionLabel(hit) : selected) + '</option>');
    }
    return opts.join('');
  }

  function fillExpectedEditor(row, item, orders) {
    const field = expectedFieldStyle();
    row.innerHTML = ''
      + '<div class="gea-editor">'
      + '<div class="gea-grid">'
      + '<label class="gea-field">Çekici<input class="' + field + '" data-f="cekici" value="' + esc(formatPlateShow(item.cekici)) + '"></label>'
      + '<label class="gea-field">Dorse<input class="' + field + '" data-f="dorse" value="' + esc(formatPlateShow(item.dorse)) + '"></label>'
      + '<label class="gea-field">Şoför<input class="' + field + '" data-f="sofor" value="' + esc(item.sofor || '') + '"></label>'
      + '<label class="gea-field">Telefon<input class="' + field + '" data-f="telefon" value="' + esc(formatPhoneShow(item.telefon)) + '"></label>'
      + '<label class="gea-field">TC<input class="' + field + '" data-f="tc" value="' + esc(item.tc || '') + '"></label>'
      + '<label class="gea-field">Kod<input class="' + field + '" data-f="label" value="' + esc(item.label || '') + '"></label>'
      + '</div>'
      + '<label class="gea-field">Sipariş'
      + '<input class="' + field + '" data-order-q type="text" placeholder="Sipariş ara (M24, firma, şehir)">'
      + '<select class="' + field + '" data-f="order">' + expectedOrderOptions(orders, item.orderKey, orders) + '</select></label>'
      + '<div class="gea-editor-actions">'
      + '<button type="button" class="gea-btn" data-edit-cancel>Vazgeç</button>'
      + '<button type="button" class="gea-btn gea-btn-primary" data-edit-save>Kaydet</button>'
      + '</div></div>';
    const sel = row.querySelector('[data-f="order"]');
    const input = row.querySelector('[data-order-q]');
    if (sel && input) {
      input.addEventListener('input', () => {
        const keep = sel.value || item.orderKey || '';
        sel.innerHTML = expectedOrderOptions(filterOrdersForSelect(orders, input.value), keep, orders);
      });
    }
  }

  function renderSavedExpected(host, items) {
    const week = currentExpectedWeekKey();
    const mine = (items || []).filter((item) => item.weekKey === week);
    if (!mine.length) {
      host.innerHTML = '<div class="gea-section-title">Bu hafta kayıtlı</div><div class="gea-empty">Henüz araç yok. Metni yapıştırıp sipariş satırını seçin.</div>';
      return;
    }
    host.innerHTML = '<div class="gea-section-title">Bu hafta kayıtlı <span class="gea-count">' + mine.length + '</span></div>'
      + mine.map((item) => {
        const printed = formatExpectedPrintLine(item);
        return '<div class="gea-saved" data-saved-row data-id="' + esc(item.id) + '">'
          + '<button type="button" class="gea-saved-main" data-edit="' + esc(item.id) + '" title="Düzenle">'
          + '<div class="gea-plate">' + esc(formatPlateShow(item.cekici)) + ' <span class="gea-arrow">→</span> ' + esc(item.label || item.firma || '—') + '</div>'
          + (printed ? '<div class="gea-status">' + esc(printed) + '</div>' : '<div class="gea-meta">Henüz basılmadı</div>')
          + '</button>'
          + '<button type="button" class="gea-mini" data-edit="' + esc(item.id) + '">Düzenle</button>'
          + '<button type="button" class="gea-del" data-del="' + esc(item.id) + '">Sil</button>'
          + '</div>';
      }).join('');
  }

  async function openExpectedPasteModal() {
    if (typeof clientIsAmir === 'function' && !clientIsAmir()) return;
    if (!(piyasaState().orders && piyasaState().orders.length) && typeof loadState === 'function') {
      try { loadState(); } catch (e) {}
    }
    const old = document.getElementById('piyasaExpectedOverlay');
    if (old) old.remove();
    const orders = ordersForExpectedWeek();
    const overlay = document.createElement('div');
    overlay.id = 'piyasaExpectedOverlay';
    overlay.style.cssText = typeof piyasaOverlayStyle === 'function'
      ? piyasaOverlayStyle(typeof PIYASA_Z_TOP === 'number' ? PIYASA_Z_TOP : 1000080)
      : 'position:fixed;inset:0;z-index:1000080;background:rgba(0,0,0,.35);display:flex;align-items:flex-start;justify-content:center;padding:16px;';
    overlay.innerHTML = ''
      + '<div class="gea-shell">'
      + '<style>'
      + '#piyasaExpectedOverlay .gea-shell{background:#fff;border-radius:16px;width:min(680px,100%);max-height:88vh;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 18px 50px rgba(0,0,0,.28);color:#1c1917;}'
      + '#piyasaExpectedOverlay .gea-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:16px 18px;border-bottom:1px solid #e7e5e4;background:#fafaf9;}'
      + '#piyasaExpectedOverlay .gea-head-main{display:flex;gap:12px;min-width:0;}'
      + '#piyasaExpectedOverlay .gea-mark{width:36px;height:36px;border-radius:10px;background:#fff7ed;color:#c2410c;display:flex;align-items:center;justify-content:center;flex:none;}'
      + '#piyasaExpectedOverlay .gea-title{font-size:16px;font-weight:700;letter-spacing:-.02em;line-height:1.2;}'
      + '#piyasaExpectedOverlay .gea-sub{margin-top:3px;font-size:12px;line-height:1.4;color:#78716c;}'
      + '#piyasaExpectedOverlay .gea-x{border:0;background:#fff;width:32px;height:32px;border-radius:8px;color:#57534e;font-size:20px;line-height:1;cursor:pointer;}'
      + '#piyasaExpectedOverlay .gea-x:hover{background:#f5f5f4;}'
      + '#piyasaExpectedOverlay .gea-body{padding:16px 18px 8px;overflow:auto;min-height:0;}'
      + '#piyasaExpectedOverlay .gea-label{display:block;font-size:12px;font-weight:700;color:#44403c;margin-bottom:6px;}'
      + '#piyasaExpectedOverlay .gea-paste{width:100%;min-height:148px;resize:vertical;border:1px solid #e7e5e4;border-radius:12px;padding:12px;font:inherit;font-size:13px;line-height:1.45;background:#fff;color:#1c1917;outline:none;}'
      + '#piyasaExpectedOverlay .gea-paste:focus{border-color:#c2410c;box-shadow:0 0 0 3px rgba(194,65,12,.12);}'
      + '#piyasaExpectedOverlay .gea-section-title{display:flex;align-items:center;gap:8px;margin:16px 0 8px;font-size:13px;font-weight:700;color:#292524;}'
      + '#piyasaExpectedOverlay .gea-count{min-width:20px;height:20px;padding:0 6px;border-radius:999px;background:#ffedd5;color:#9a3412;font-size:11px;line-height:20px;text-align:center;}'
      + '#piyasaExpectedOverlay .gea-empty{border:1px dashed #e7e5e4;border-radius:12px;padding:14px;font-size:13px;color:#78716c;background:#fafaf9;}'
      + '#piyasaExpectedOverlay .gea-saved,#piyasaExpectedOverlay .gea-preview{display:flex;align-items:center;gap:8px;margin-top:8px;padding:10px 12px;border:1px solid #e7e5e4;border-radius:12px;background:#fff;}'
      + '#piyasaExpectedOverlay .gea-preview{display:block;}'
      + '#piyasaExpectedOverlay .gea-saved-main{flex:1;min-width:0;text-align:left;border:0;background:transparent;cursor:pointer;font:inherit;padding:0;}'
      + '#piyasaExpectedOverlay .gea-plate{font-size:14px;font-weight:700;letter-spacing:-.01em;color:#1c1917;}'
      + '#piyasaExpectedOverlay .gea-arrow{color:#a8a29e;font-weight:600;}'
      + '#piyasaExpectedOverlay .gea-muted{color:#a8a29e;font-weight:600;}'
      + '#piyasaExpectedOverlay .gea-meta{margin-top:3px;font-size:12px;color:#78716c;}'
      + '#piyasaExpectedOverlay .gea-status{display:inline-block;margin-top:6px;padding:3px 8px;border-radius:999px;background:#f0fdf4;color:#166534;font-size:11px;font-weight:700;}'
      + '#piyasaExpectedOverlay .gea-mini,#piyasaExpectedOverlay .gea-del{height:32px;padding:0 10px;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;background:#fff;white-space:nowrap;}'
      + '#piyasaExpectedOverlay .gea-mini{border:1px solid #e7e5e4;color:#44403c;}'
      + '#piyasaExpectedOverlay .gea-mini:hover{background:#fafaf9;}'
      + '#piyasaExpectedOverlay .gea-del{border:1px solid #fecaca;color:#b91c1c;}'
      + '#piyasaExpectedOverlay .gea-del:hover{background:#fef2f2;}'
      + '#piyasaExpectedOverlay .gea-input{width:100%;box-sizing:border-box;margin-top:8px;height:36px;border:1px solid #e7e5e4;border-radius:8px;padding:0 10px;font:inherit;font-size:13px;background:#fff;color:#1c1917;outline:none;}'
      + '#piyasaExpectedOverlay .gea-input:focus{border-color:#c2410c;}'
      + '#piyasaExpectedOverlay .gea-editor{width:100%;flex:1 1 100%;min-width:0;}'
      + '#piyasaExpectedOverlay .gea-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px 10px;}'
      + '#piyasaExpectedOverlay .gea-field{display:block;font-size:11px;font-weight:700;color:#57534e;}'
      + '#piyasaExpectedOverlay .gea-editor-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:12px;}'
      + '#piyasaExpectedOverlay .gea-foot{display:flex;justify-content:flex-end;gap:8px;padding:12px 18px;border-top:1px solid #e7e5e4;background:#fff;}'
      + '#piyasaExpectedOverlay .gea-btn{height:36px;padding:0 14px;border-radius:8px;border:1px solid #e7e5e4;background:#fff;color:#292524;font-size:13px;font-weight:700;cursor:pointer;}'
      + '#piyasaExpectedOverlay .gea-btn:hover{background:#f5f5f4;}'
      + '#piyasaExpectedOverlay .gea-btn-primary{background:#c2410c;border-color:#c2410c;color:#fff;}'
      + '#piyasaExpectedOverlay .gea-btn-primary:hover{background:#9a3412;}'
      + '@media (max-width:640px){#piyasaExpectedOverlay .gea-grid{grid-template-columns:1fr;}#piyasaExpectedOverlay .gea-saved{flex-wrap:wrap;}}'
      + '</style>'
      + '<div class="gea-head">'
      + '<div class="gea-head-main">'
      + '<div class="gea-mark" aria-hidden="true"><svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M3 7h11v8H3V7z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M14 10h3.2L20 13v2h-6" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><circle cx="7" cy="17.5" r="1.4" fill="currentColor"/><circle cx="17" cy="17.5" r="1.4" fill="currentColor"/></svg></div>'
      + '<div><div class="gea-title">Gelecek araçlar</div>'
      + '<div class="gea-sub">WhatsApp metnini yapıştır. Sipariş, yüklü Excel’in tamamında aranır.</div></div>'
      + '</div>'
      + '<button type="button" id="piyasaExpectedX" class="gea-x" aria-label="Kapat">×</button>'
      + '</div>'
      + '<div class="gea-body">'
      + '<label class="gea-label" for="piyasaExpectedPaste">WhatsApp metni</label>'
      + '<textarea id="piyasaExpectedPaste" class="gea-paste" rows="7" placeholder="Metni buraya yapıştır…"></textarea>'
      + '<div id="piyasaExpectedPreview"></div>'
      + '<div id="piyasaExpectedSaved"></div>'
      + '</div>'
      + '<div class="gea-foot">'
      + '<button type="button" id="piyasaExpectedClose" class="gea-btn">Kapat</button>'
      + '<button type="button" id="piyasaExpectedSave" class="gea-btn gea-btn-primary">Kaydet</button>'
      + '</div></div>';
    document.body.appendChild(overlay);
    if (typeof markPiyasaModalLayer === 'function') markPiyasaModalLayer(overlay);
    const preview = overlay.querySelector('#piyasaExpectedPreview');
    const savedHost = overlay.querySelector('#piyasaExpectedSaved');
    const area = overlay.querySelector('#piyasaExpectedPaste');
    let parsed = [];
    const paint = () => {
      parsed = parsePiyasaExpectedPaste(area.value).vehicles;
      renderExpectedPreview(preview, parsed, orders);
    };
    area.addEventListener('input', paint);
    const closeExpected = () => overlay.remove();
    overlay.querySelector('#piyasaExpectedClose').onclick = closeExpected;
    overlay.querySelector('#piyasaExpectedX').onclick = closeExpected;
    savedHost.addEventListener('click', async (ev) => {
      const target = ev.target;
      const cancelBtn = target.closest && target.closest('[data-edit-cancel]');
      if (cancelBtn) {
        renderSavedExpected(savedHost, _expectedItems);
        return;
      }
      const saveEdit = target.closest && target.closest('[data-edit-save]');
      if (saveEdit) {
        const row = saveEdit.closest('[data-saved-row]');
        const id = row ? row.getAttribute('data-id') : '';
        const item = (_expectedItems || []).find((entry) => entry.id === id);
        if (!row || !item) return;
        const fieldValue = (name) => {
          const el = row.querySelector('[data-f="' + name + '"]');
          return el ? String(el.value || '') : '';
        };
        const cekici = normExpectedPlate(fieldValue('cekici'));
        const dorse = normExpectedPlate(fieldValue('dorse'));
        if (!isPlateNorm(cekici)) {
          if (typeof toast === 'function') toast('Çekici plakası geçersiz.', 'warn');
          return;
        }
        if (dorse && !isPlateNorm(dorse)) {
          if (typeof toast === 'function') toast('Dorse plakası geçersiz.', 'warn');
          return;
        }
        const orderKey = fieldValue('order');
        if (!orderKey) {
          if (typeof toast === 'function') toast('Sipariş satırı seç.', 'warn');
          return;
        }
        const newId = item.weekKey + ':' + cekici;
        saveEdit.disabled = true;
        try {
          const prev = await loadExpectedArrivals(true);
          if (prev.some((entry) => entry.id === newId && entry.id !== id)) {
            saveEdit.disabled = false;
            if (typeof toast === 'function') toast('Bu plaka bu hafta zaten kayıtlı.', 'warn');
            return;
          }
          const order = typeof getOrderByIdx === 'function' ? getOrderByIdx(orderKey) : null;
          const samePlate = newId === id;
          await saveExpectedItems(prev.filter((entry) => entry.id !== id && entry.id !== newId).concat([{
            weekKey: item.weekKey,
            orderKey,
            firma: order ? order.firma : item.firma,
            malzeme: order ? order.malzeme : item.malzeme,
            label: fieldValue('label') || item.label,
            cekici,
            dorse,
            sofor: fieldValue('sofor'),
            telefon: fieldValue('telefon'),
            tc: fieldValue('tc'),
            printedAt: samePlate ? item.printedAt : 0,
            basimYeri: samePlate ? item.basimYeri : '',
          }]));
          await loadExpectedArrivals(true);
          renderSavedExpected(savedHost, _expectedItems);
          if (typeof toast === 'function') toast('Araç güncellendi.', 'success');
        } catch (e) {
          saveEdit.disabled = false;
          if (typeof toast === 'function') toast('Kayıt güncellenemedi.', 'warn');
        }
        return;
      }
      const editBtn = target.closest && target.closest('button[data-edit]');
      if (editBtn) {
        const id = editBtn.getAttribute('data-edit');
        const item = (_expectedItems || []).find((entry) => entry.id === id);
        const row = editBtn.closest('[data-saved-row]');
        if (item && row) fillExpectedEditor(row, item, orders);
        return;
      }
      const btn = target.closest && target.closest('button[data-del]');
      if (!btn) return;
      const id = btn.getAttribute('data-del');
      btn.disabled = true;
      try {
        const items = await loadExpectedArrivals(true);
        await saveExpectedItems(items.filter((item) => item.id !== id));
        renderSavedExpected(savedHost, _expectedItems);
      } catch (e) {
        btn.disabled = false;
        if (typeof toast === 'function') toast('Kayıt silinemedi.', 'warn');
      }
    });
    overlay.querySelector('#piyasaExpectedSave').onclick = async () => {
      const weekKey = currentExpectedWeekKey();
      if (!weekKey) {
        if (typeof toast === 'function') toast('Hafta bilgisi yok.', 'warn');
        return;
      }
      const cards = preview.querySelectorAll('[data-expected-row]');
      const fresh = [];
      cards.forEach((card, i) => {
        const row = parsed[i];
        const sel = card.querySelector('[data-order]');
        const orderKey = sel ? String(sel.value || '') : '';
        if (!row || !orderKey) return;
        const order = typeof getOrderByIdx === 'function' ? getOrderByIdx(orderKey) : null;
        fresh.push({
          weekKey,
          orderKey,
          firma: order ? order.firma : '',
          malzeme: order ? order.malzeme : '',
          label: row.label || '',
          cekici: row.cekici,
          dorse: row.dorse,
          sofor: row.sofor,
          telefon: row.telefon,
          tc: row.tc,
        });
      });
      if (!fresh.length) {
        if (typeof toast === 'function') toast('Sipariş satırı seç.', 'warn');
        return;
      }
      try {
        const prev = await loadExpectedArrivals(true);
        const drop = new Set(fresh.map((row) => weekKey + ':' + normExpectedPlate(row.cekici)));
        const keptPrint = new Map();
        prev.forEach((item) => {
          if (item && item.printedAt) keptPrint.set(item.id, item);
        });
        fresh.forEach((row) => {
          const old = keptPrint.get(weekKey + ':' + normExpectedPlate(row.cekici));
          if (!old) return;
          row.printedAt = old.printedAt;
          row.basimYeri = old.basimYeri;
        });
        await saveExpectedItems(prev.filter((item) => !drop.has(item.id)).concat(fresh));
        area.value = '';
        preview.innerHTML = '';
        parsed = [];
        renderSavedExpected(savedHost, _expectedItems);
        const missing = platesMissingFromRegistry(fresh.map((row) => row.cekici), registryVehicles());
        if (missing.length) {
          const lines = missing.map((plate) => formatPlateShow(plate)).join('\n');
          alert('Gelecek araçlar kaydedildi.\n\nSistemde kayıtlı değil:\n' + lines);
        } else if (typeof toast === 'function') {
          toast('Gelecek araçlar kaydedildi.', 'success');
        }
      } catch (e) {
        if (typeof toast === 'function') toast('Kayıt yazılamadı.', 'warn');
      }
    };
    loadExpectedArrivals(true).then((items) => renderSavedExpected(savedHost, items)).catch(() => {});
  }

  root.parsePiyasaExpectedPaste = parsePiyasaExpectedPaste;
  root.normExpectedPlate = normExpectedPlate;
  root.matchExpectedByPlate = matchExpectedByPlate;
  root.loadExpectedArrivals = loadExpectedArrivals;
  root.openExpectedPasteModal = openExpectedPasteModal;
  root.markExpectedArrivalPrinted = markExpectedArrivalPrinted;
  root.offerExpectedForPlate = offerExpectedForPlate;
  root.applyExpectedOnTakipOpen = applyExpectedOnTakipOpen;
})(typeof window !== 'undefined' ? window : globalThis);
