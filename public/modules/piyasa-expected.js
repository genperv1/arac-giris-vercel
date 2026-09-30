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

  const api = {
    parsePiyasaExpectedPaste,
    sanitizeExpectedItems,
    normExpectedPlate,
    matchExpectedByPlate,
    orderMatchesQuery,
    platesMissingFromRegistry,
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
        return '<button type="button" data-i="' + i + '" style="display:block;width:100%;text-align:left;border:1px solid #e2e8f0;background:#fff;border-radius:10px;padding:10px 12px;margin-top:8px;cursor:pointer;font-weight:700;">'
          + esc(expectedHitTitle(hit))
          + (hit.sofor ? '<div style="font-weight:500;color:#475569;margin-top:4px;">' + esc(hit.sofor) + '</div>' : '')
          + '</button>';
      }).join('');
      overlay.innerHTML = ''
        + '<div style="width:min(520px,96vw);margin-top:8vh;background:#fff;border-radius:14px;box-shadow:0 12px 32px rgba(0,0,0,.2);overflow:hidden;">'
        + '<div style="padding:14px 16px;font-weight:800;border-bottom:1px solid #eee;">Gelen araç</div>'
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

  function renderExpectedPreview(host, vehicles, orders) {
    if (!vehicles.length) {
      host.innerHTML = '<div style="color:#92400e;font-size:13px;">Plaka bulunamadı. Metni olduğu gibi yapıştır.</div>';
      return;
    }
    host.innerHTML = vehicles.map((row, i) => {
      const choices = orders.filter((order) => row.label && orderMatchesQuery(order, row.label)).slice(0, 40);
      const list = choices.length ? choices : orders.slice(0, 40);
      const options = ['<option value="">Sipariş satırı seç</option>'].concat(list.map((order) => {
        const key = typeof getOrderPickKey === 'function' ? getOrderPickKey(order) : '';
        return '<option value="' + esc(key) + '">' + esc(orderOptionLabel(order)) + '</option>';
      })).join('');
      return '<div data-expected-row="' + i + '" style="border:1px solid #e2e8f0;border-radius:10px;padding:10px;margin-top:8px;">'
        + '<div style="font-weight:800;">' + esc(formatPlateShow(row.cekici))
        + (row.dorse ? ' / ' + esc(formatPlateShow(row.dorse)) : '')
        + (row.label ? ' → ' + esc(row.label) : '')
        + '</div>'
        + '<div style="font-size:13px;color:#334155;margin-top:4px;">'
        + esc([row.sofor, formatPhoneShow(row.telefon), row.tc].filter(Boolean).join(' · '))
        + '</div>'
        + '<select data-order style="margin-top:8px;width:100%;padding:8px;border:1px solid #ddd;border-radius:8px;">' + options + '</select>'
        + '</div>';
    }).join('');
    host.querySelectorAll('[data-expected-row]').forEach((card, i) => {
      const row = vehicles[i];
      const choices = orders.filter((order) => row.label && orderMatchesQuery(order, row.label));
      const sel = card.querySelector('[data-order]');
      if (sel && choices.length === 1 && typeof getOrderPickKey === 'function') {
        sel.value = String(getOrderPickKey(choices[0]) || '');
      }
    });
  }

  function renderSavedExpected(host, items) {
    const week = currentExpectedWeekKey();
    const mine = (items || []).filter((item) => item.weekKey === week);
    if (!mine.length) {
      host.innerHTML = '';
      return;
    }
    host.innerHTML = '<div style="font-weight:800;margin-top:14px;">Bu hafta kayıtlı</div>'
      + mine.map((item) => {
        return '<div style="display:flex;align-items:center;gap:8px;margin-top:6px;font-size:13px;">'
          + '<span style="flex:1;">' + esc(formatPlateShow(item.cekici)) + ' → ' + esc(item.label || item.firma || '') + '</span>'
          + '<button type="button" data-del="' + esc(item.id) + '" style="border:0;background:#fee2e2;color:#991b1b;border-radius:8px;padding:4px 8px;cursor:pointer;font-weight:700;">Sil</button>'
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
      + '<div style="background:#fff;border-radius:14px;max-width:640px;width:100%;max-height:88vh;overflow:auto;box-shadow:0 10px 30px rgba(0,0,0,.25);">'
      + '<div style="padding:14px 16px;border-bottom:1px solid #eee;font-weight:800;">Gelen araç</div>'
      + '<div style="padding:12px 16px;">'
      + '<div style="font-size:13px;color:#475569;margin-bottom:8px;">WhatsApp metnini yapıştır. Plaka yazılınca bu sipariş bu sevkiyata gelecek.</div>'
      + '<textarea id="piyasaExpectedPaste" rows="8" style="width:100%;border:1px solid #ddd;border-radius:10px;padding:10px;font:inherit;"></textarea>'
      + '<div id="piyasaExpectedPreview"></div>'
      + '<div id="piyasaExpectedSaved"></div>'
      + '</div>'
      + '<div style="display:flex;justify-content:flex-end;gap:8px;padding:12px 16px;border-top:1px solid #eee;">'
      + '<button type="button" id="piyasaExpectedClose" style="border:0;background:#e5e7eb;border-radius:8px;padding:8px 12px;cursor:pointer;font-weight:700;">Kapat</button>'
      + '<button type="button" id="piyasaExpectedSave" style="border:0;background:#111827;color:#fff;border-radius:8px;padding:8px 12px;cursor:pointer;font-weight:700;">Kaydet</button>'
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
    overlay.querySelector('#piyasaExpectedClose').onclick = () => overlay.remove();
    overlay.addEventListener('click', (ev) => { if (ev.target === overlay) overlay.remove(); });
    savedHost.addEventListener('click', async (ev) => {
      const btn = ev.target.closest && ev.target.closest('button[data-del]');
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
        await saveExpectedItems(prev.filter((item) => !drop.has(item.id)).concat(fresh));
        area.value = '';
        preview.innerHTML = '';
        parsed = [];
        renderSavedExpected(savedHost, _expectedItems);
        const missing = platesMissingFromRegistry(fresh.map((row) => row.cekici), registryVehicles());
        if (missing.length) {
          const lines = missing.map((plate) => formatPlateShow(plate)).join('\n');
          alert('Gelen araç kaydedildi.\n\nSistemde kayıtlı değil:\n' + lines);
        } else if (typeof toast === 'function') {
          toast('Gelen araç kaydedildi.', 'success');
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
  root.offerExpectedForPlate = offerExpectedForPlate;
  root.applyExpectedOnTakipOpen = applyExpectedOnTakipOpen;
})(typeof window !== 'undefined' ? window : globalThis);
