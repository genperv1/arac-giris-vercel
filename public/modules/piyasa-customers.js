// piyasa-customers.js — müşteri listesi
// Otomatik bölüm — scripts/modularize-remaining.js

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

