// app-ihracat-print.js — ihracat yazdırma HTML
// Otomatik bölüm — scripts/modularize-remaining.js

function _ihracatToggleDetailRow(row, modal) {
  if (!row || !row.hasAttribute('data-ihr-row-key')) return;
  const key = row.getAttribute('data-ihr-row-key');
  const tbody = row.closest('tbody');
  const next = row.nextElementSibling;
  if (next && next.classList.contains('ihr-detail-row') && next.getAttribute('data-ihr-detail-for') === key) {
    next.remove();
    return;
  }
  tbody?.querySelectorAll('tr.ihr-detail-row').forEach((r) => r.remove());

  const snap = _ihracatReadRowSnapshot(row);
  if (!snap) {
    showToast('❌ Önce geçerli bir plaka girin.');
    return;
  }
  const vehicle = _ihracatFindVehicleByPlate(snap.plaka);
  row.insertAdjacentHTML('afterend', _ihracatDetailRowHtml(key, snap, vehicle));
}

function _ihracatBuildShipmentFromDetailRow(row, modal) {
  const snap = _ihracatReadRowSnapshot(row);
  if (!snap) return null;
  const section = row.closest('[data-ihr-block-section]');
  const sevk = String(section?.querySelector('[data-ihr-firma-sevk]')?.value || '').trim();
  const amb = String(section?.querySelector('[data-ihr-firma-amb]')?.value || '').trim();
  let template = {};
  try {
    const tbody = row.closest('tbody[data-ihr-tbody]');
    template = JSON.parse(tbody?.getAttribute('data-ihr-template') || '{}');
  } catch (e) {}
  const irs = normalizeIrsaliyeNo(snap.irsaliyeNo || template.irsaliyeNo || '');
  return {
    ...template,
    plaka: snap.plaka,
    firma: snap.firma || template.firma || '',
    malzeme: snap.malzeme || template.malzeme || '',
    tonajKg: snap.tonajKg,
    bbt: snap.bbt,
    bosBbt: snap.bosBbt,
    cuval: snap.cuval,
    bosCuval: snap.bosCuval,
    palet: snap.palet,
    irsaliyeNo: irs,
    id: irs || template.id || '',
    sevkYeri: sevk || template.sevkYeri || '',
    ambalaj: amb || template.ambalaj || '',
    ambalajBilgisi: amb || template.ambalajBilgisi || '',
    _ihracatEdited: true,
  };
}

function _ihracatParkDetailsModal(modalEl) {
  const modal = modalEl || document.getElementById('ihracatDetailsModal');
  if (!modal) return;
  window.__ihracatParkedDetailsModal = modal;
  modal.style.visibility = 'hidden';
  modal.style.pointerEvents = 'none';
}

function _ihracatRestoreParkedDetailsModal() {
  const modal = window.__ihracatParkedDetailsModal;
  window.__ihracatParkedDetailsModal = null;
  if (!modal || !modal.isConnected) return;
  modal.style.visibility = '';
  modal.style.pointerEvents = '';
}
window._ihracatRestoreParkedDetailsModal = _ihracatRestoreParkedDetailsModal;

async function _ihracatOpenFullTakipFromRow(row, modal) {
  const snap = _ihracatReadRowSnapshot(row);
  if (!snap) {
    showToast('❌ Önce geçerli bir plaka girin.');
    return;
  }
  const prefilled = _ihracatBuildShipmentFromDetailRow(row, modal);
  let vehicle = _ihracatFindVehicleByPlate(snap.plaka);
  if (!vehicle) {
    vehicle = {
      id: 'manual',
      cekiciPlaka: snap.plaka,
      dorsePlaka: '',
      soforAdi: '',
      soforSoyadi: '',
      sofor2Adi: '',
      sofor2Soyadi: '',
      iletisim: '',
      tcKimlik: '',
      defaultFirma: snap.firma || '',
      defaultMalzeme: snap.malzeme || '',
      defaultSevkYeri: '',
      defaultYuklemeNotu: '',
    };
  } else {
    vehicle = {
      ...vehicle,
      cekiciPlaka: snap.plaka || vehicle.cekiciPlaka,
      defaultFirma: snap.firma || vehicle.defaultFirma || '',
      defaultMalzeme: snap.malzeme || vehicle.defaultMalzeme || '',
    };
  }
  vehicle._ihracatTakipApplyOpts = {
    prefilledShipment: prefilled,
    skipExcelReview: true,
  };
  try {
    window.__activeExcelShipment = prefilled;
    window.__lastChosenShipment = prefilled;
    window.__ihracatActivePrintShipment = prefilled;
  } catch (e) {}
  _ihracatParkDetailsModal(modal);
  showTakipFormu(vehicle);
  const takipModal = document.getElementById('takipFormuModal');
  if (takipModal) {
    takipModal.style.zIndex = '10050';
  }
}

function _ihracatBindTakipPanel(modal) {
  modal.addEventListener('click', (e) => {
    const fullBtn = e.target.closest('.ihr-takip-full-btn');
    if (fullBtn) {
      e.preventDefault();
      const detailRow = fullBtn.closest('tr.ihr-detail-row');
      const key = fullBtn.getAttribute('data-ihr-row-key');
      let row = null;
      if (detailRow && detailRow.previousElementSibling?.getAttribute('data-ihr-row-key') === key) {
        row = detailRow.previousElementSibling;
      } else if (key) {
        row = Array.from(modal.querySelectorAll('tr[data-ihr-row-key]')).find(
          (r) => r.getAttribute('data-ihr-row-key') === key
        ) || null;
      }
      if (row) _ihracatOpenFullTakipFromRow(row, modal);
      return;
    }
    const btn = e.target.closest('.ihr-takip-btn');
    if (!btn) return;
    e.preventDefault();
    const row = btn.closest('tr[data-ihr-row-key]');
    if (row) _ihracatToggleDetailRow(row, modal);
  });
}

function _ihracatBindModalPlateAdd(modal, statusApi) {
  const { normalizePlate } = statusApi;

  const updateRowStatus = (row, plateRaw) => {
    _ihracatApplyDurumCell(row.querySelector('[data-field="durum"]'), row, plateRaw, statusApi);
  };

  const bindAddRow = (row, commitFn) => {
    const plakaInp = row.querySelector('[data-field="plaka"]');
    if (!plakaInp) return;
    plakaInp.addEventListener('input', () => {
      updateRowStatus(row, plakaInp.value);
    });
    plakaInp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        commitFn(row);
      }
    });
    plakaInp.addEventListener('blur', (e) => {
      const rt = e.relatedTarget;
      if (rt && row.contains(rt)) return;
      commitFn(row);
    });
  };

  const rowInpStyle = 'width:100%;max-width:72px;padding:4px 6px;border:1px solid #cbd5e1;border-radius:6px;font-size:12px;box-sizing:border-box;';

  const onPlateCommit = (row) => {
    if (!row || row.getAttribute('data-ihr-add-row') !== '1') return;
    const plakaInp = row.querySelector('[data-field="plaka"]');
    const raw = plakaInp?.value || '';
    if (!_ihracatPlateCommitReady(raw, normalizePlate)) return;
    const plate = normalizePlate(raw);

    const tbody = row.closest('tbody[data-ihr-tbody]');
    const prevRow = row.previousElementSibling;
    if (prevRow && prevRow.hasAttribute('data-ihr-row-key')) {
      _ihracatCopyRowFromPrev(prevRow, row);
    }
    _ihracatClearNewPlateQtyOnRow(row, rowInpStyle);

    const gk = tbody?.getAttribute('data-ihr-firma-group') || 'GENEL';
    const newKey = `new__${gk}__${Date.now()}`;
    row.setAttribute('data-ihr-row-key', newKey);
    row.setAttribute('data-ihr-is-new', '1');
    row.removeAttribute('data-ihr-add-row');

    if (row.cells[0]) {
      const sira = row.getAttribute('data-ihr-sira') || '';
      row.cells[0].innerHTML = _ihracatPlakaCellHtml(plate, false, false, { sira });
    }

    updateRowStatus(row, plate);

    let template = {};
    try {
      template = JSON.parse(tbody?.getAttribute('data-ihr-template') || '{}');
    } catch (e) {}
    const snap = _ihracatStripNewPlateQtyFields(_ihracatReadRowSnapshot(row));
    const storedKey = _ihracatPersistPendingShipment({
      plate,
      rowKey: newKey,
      pendingShipment: snap,
      template,
      forceAdd: true,
    });
    if (storedKey) row.setAttribute('data-ihr-row-key', storedKey);

    _ihracatRefreshToplamForTbody(tbody);

    const addRowMarkup = `
      <tr data-ihr-add-row="1" style="background:#fffbeb;color:#92400e;">
        <td style="${IHR_PLAKA_TD_STYLE}">${_ihracatPlakaCellHtml('', true, true)}</td>
        <td data-field="firma" style="border:1px solid #ddd;padding:6px;font-size:11px;color:#94a3b8;">—</td>
        <td data-field="malzeme" style="border:1px solid #ddd;padding:6px;color:#94a3b8;">—</td>
        <td style="border:1px solid #ddd;padding:6px;"><input type="text" data-field="tonaj" value="" style="${rowInpStyle}max-width:90px;" disabled /></td>
        <td style="border:1px solid #ddd;padding:6px;opacity:0.5;"><span style="font-size:11px;">Firma ve malzeme üst satırdan kopyalanır</span></td>
        <td style="border:1px solid #ddd;padding:4px;text-align:center;color:#94a3b8;font-size:11px;">—</td>
        <td style="border:1px solid #ddd;padding:6px;"><input type="text" data-field="irsaliye" value="" style="${rowInpStyle}max-width:130px;" disabled /></td>
        <td data-field="durum" style="border:1px solid #ddd;padding:6px;font-size:11px;">Plaka girin</td>
      </tr>
    `;
    const topRow = tbody?.querySelector('tr[data-ihr-toplam-row]');
    if (topRow) topRow.insertAdjacentHTML('beforebegin', addRowMarkup);
    else tbody?.insertAdjacentHTML('beforeend', addRowMarkup);
    const newAdd = tbody?.querySelector('tr[data-ihr-add-row]:last-of-type');
    if (newAdd) bindAddRow(newAdd, onPlateCommit);
    _ihracatRefreshToplamForTbody(tbody);
  };

  modal.querySelectorAll('tr[data-ihr-add-row]').forEach((row) => bindAddRow(row, onPlateCommit));
}

function _ihracatPad2(n) {
  return String(n).padStart(2, '0');
}

/** Yazdırma anı, Excel meta ile uyumlu mu (yeniden yüklemede aynı gün yazdırmalar korunur). */
function _ihracatPrintSnapValidForMeta(snapTs, meta) {
  const ts = Number(snapTs);
  if (!Number.isFinite(ts) || ts <= 0) return false;
  const importTimestamp = Number(new Date(meta?.importedAt || 0));
  if (!importTimestamp || ts >= importTimestamp) return true;
  const dateKey = String(_resolveIhracatDateKey(meta) || meta?.dateKey || '').trim();
  if (!dateKey || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return false;
  try {
    const printDay = new Date(ts).toLocaleDateString('sv-SE', { timeZone: 'Europe/Istanbul' });
    return printDay === dateKey;
  } catch (e) {
    return false;
  }
}

/** Takip formundan yazdırılmış / çıkış yapmış plaka (araç veya rapor kaydı). */
function _ihracatPlateHasCheckout(plateRaw, meta) {
  const key = _ihracatPlateKey(plateRaw);
  if (!key) return false;

  if (window.__ihracatRemotePrintCache?.loaded) {
    for (const r of _ihracatGetPrintReports()) {
      const d = r.data || {};
      const plates = [d.plaka, d.plate, r.plaka, d.cekiciPlaka, d.dorsePlaka];
      for (const raw of plates) {
        const p = normPlate(raw || '');
        if (p && _ihracatPlateKey(p) === key) return true;
      }
    }
    return false;
  }

  const v = _ihracatFindVehicleByPlate(plateRaw);
  if (v && (Number(v.printCount || 0) || 0) > 0) {
    const snap = v.lastPrintSnapshot || {};
    const snapTs = Number(snap.ts || snap.timestamp || 0);
    if (!_ihracatPrintSnapValidForMeta(snapTs, meta)) return false;
    const pk = _ihracatPlateKey;
    const snapKeys = new Set();
    [snap.plaka, snap.cekiciPlaka, snap.dorsePlaka, snap.plate].forEach((raw) => {
      const k = pk(raw);
      if (k) snapKeys.add(k);
    });
    const currentKeys = new Set();
    [v.cekiciPlaka, v.dorsePlaka, v.plaka].forEach((raw) => {
      const k = pk(raw);
      if (k) currentKeys.add(k);
    });
    return [...snapKeys].some((k) => currentKeys.has(k) && k === key);
  }

  try {
    for (const r of _ihracatGetPrintReports()) {
      if (!r || String(r.type || '').toUpperCase() !== 'PRINT') continue;
      const d = r.data || {};
      const plates = [d.plaka, d.plate, r.plaka, d.cekiciPlaka, d.dorsePlaka];
      for (const raw of plates) {
        const p = normPlate(raw || '');
        if (p && _ihracatPlateKey(p) === key) return true;
      }
    }
  } catch (e) { /* ignore */ }
  return false;
}

/** Yazdırma: yalnızca takip formundan çıkış yapan plakalar işaretlenir. */
function _ihracatRowHasCheckout(row, updated, cur, statusApi, meta) {
  const plate = updated.plaka;
  const cellText = String(row.querySelector('[data-field="durum"]')?.getAttribute('data-ihr-durum-text') || '').trim();
  return (
    cur._status === 'printed' ||
    statusApi.statusForPlate(plate) === 'printed' ||
    _ihracatPlateHasCheckout(plate, meta) ||
    /yazdır/i.test(cellText)
  );
}

/** Modaldeki güncel değerleri yazdırma için topla (Kaydet gerekmez). */
function _ihracatCollectModalRowsForPrint(modal, originalShipments, statusApi, meta) {
  if (!modal) return [];
  const blockSevk = {};
  const blockAmb = {};
  modal.querySelectorAll('[data-ihr-firma-sevk]').forEach((inp) => {
    blockSevk[inp.getAttribute('data-ihr-firma-sevk')] = String(inp.value || '').trim();
  });
  modal.querySelectorAll('[data-ihr-firma-amb]').forEach((inp) => {
    blockAmb[inp.getAttribute('data-ihr-firma-amb')] = String(inp.value || '').trim();
  });

  const byKey = new Map();
  (originalShipments || []).forEach((s) => {
    byKey.set(_ihracatShipmentKey(s), { ...s });
  });

  const rows = [];
  let domOrder = 0;
  modal.querySelectorAll('tr[data-ihr-row-key]').forEach((row) => {
    const key = row.getAttribute('data-ihr-row-key');
    if (!key) return;
    let cur = byKey.get(key);
    const isNew = row.getAttribute('data-ihr-is-new') === '1' || String(key).startsWith('new__');
    if (!cur && isNew) {
      const tbody = row.closest('tbody[data-ihr-tbody]');
      let template = {};
      try {
        template = JSON.parse(tbody?.getAttribute('data-ihr-template') || '{}');
      } catch (e) {}
      cur = { ...template, _ihracatManual: true };
    }
    if (!cur) cur = {};
    else cur = { ...cur };

    const updated = _ihracatReadRowFields(row, cur, blockSevk, blockAmb);
    if (!updated) return;

    const gk = _ihracatBlockGroupKey(updated);
    const hasCikis = _ihracatRowHasCheckout(row, updated, cur, statusApi, meta);
    const durumText = hasCikis ? 'Çıkış yaptı' : '';
    const st = hasCikis ? 'printed' : statusApi.statusForPlate(updated.plaka);

    rows.push({
      ...updated,
      _domOrder: domOrder++,
      _status: st,
      _durumText: durumText,
      _blockSevk: blockSevk[gk] || updated.sevkYeri || '',
      _blockAmb: blockAmb[gk] || updated.ambalaj || updated.ambalajBilgisi || '',
    });
  });
  return rows;
}

function _ihracatFirmaMatchesExcel(firmaRaw, excelFirma) {
  const fa = String(firmaRaw || '').trim().toUpperCase();
  const fb = String(excelFirma || '').trim().toUpperCase();
  if (!fa || !fb) return false;
  if (fa === fb) return true;
  const ya = (fa.match(/\b(YD\d{1,4})\b/i) || [])[1];
  const yb = (fb.match(/\b(YD\d{1,4})\b/i) || [])[1];
  if (ya && yb && ya === yb) return true;
  return fa.includes(fb) || fb.includes(fa);
}

/** Sunucudaki yazdırma kayıtları (/api/reports = print_history). F5 sonrası localStorage yetmez. */
window.__ihracatRemotePrintCache = window.__ihracatRemotePrintCache || { ts: 0, reports: [], loading: null, loaded: false };

function _ihracatInvalidatePrintReportsCache() {
  const cache = window.__ihracatRemotePrintCache;
  if (!cache) return;
  cache.ts = 0;
  cache.loaded = false;
  cache.reports = [];
  cache.loading = null;
}
window._ihracatInvalidatePrintReportsCache = _ihracatInvalidatePrintReportsCache;

async function _ihracatFetchRemotePrintReports(force) {
  const cache = window.__ihracatRemotePrintCache;
  const now = Date.now();
  if (!force && cache.loaded && (now - cache.ts) < 45000) {
    return cache.reports;
  }
  if (cache.loading) {
    try { return await cache.loading; } catch (e) { return cache.reports; }
  }
  cache.loading = (async () => {
    try {
      const r = await fetch('/api/reports?limit=2000&_=' + now, {
        method: 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' },
      });
      if (r.ok) {
        const data = await r.json();
        cache.reports = Array.isArray(data) ? data : [];
        cache.ts = Date.now();
        cache.loaded = true;
      }
    } catch (e) {
      console.warn('İhracat yazdırma listesi alınamadı:', e);
    } finally {
      cache.loading = null;
    }
    return cache.reports;
  })();
  try { return await cache.loading; } catch (e) { return cache.reports; }
}
window._ihracatFetchRemotePrintReports = _ihracatFetchRemotePrintReports;

/** Modal açılışı: önbellek taze ise anında; eskiyse arka planda yenile. İlk yükleme devam ediyorsa aynı isteği paylaş. */
function _ihracatPreparePrintReportsForModal() {
  const cache = window.__ihracatRemotePrintCache;
  if (cache.loading) {
    return cache.loading.catch(() => cache.reports);
  }
  const fresh = cache.loaded && (Date.now() - cache.ts) < 45000;
  if (fresh) return Promise.resolve(cache.reports);
  return _ihracatFetchRemotePrintReports(true)
    .then((reports) => {
      if (document.getElementById('ihracatDetailsModal')) {
        try { _ihracatRefreshOpenModalStatuses(); } catch (e) {}
      }
      return reports;
    })
    .catch(() => cache.reports);
}

function _ihracatShowDetailsLoading() {
  if (document.getElementById('ihracatDetailsLoading') || document.getElementById('ihracatDetailsModal')) return;
  document.body.insertAdjacentHTML(
    'beforeend',
    `<div id="ihracatDetailsLoading" style="position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:9998;display:flex;align-items:center;justify-content:center;font-family:Arial,sans-serif;">
      <div style="background:#fff;padding:20px 28px;border-radius:10px;box-shadow:0 4px 20px rgba(0,0,0,0.25);font-size:14px;color:#334155;font-weight:600;">📄 İhracat detayları yükleniyor…</div>
    </div>`
  );
}

function _ihracatHideDetailsLoading() {
  document.getElementById('ihracatDetailsLoading')?.remove();
}

/** Yazdırma olayları — sunucu listesi tek kaynak; offline ise localStorage yedek. */
function _ihracatGetPrintReports() {
  const cache = window.__ihracatRemotePrintCache || {};
  const isPrint = (r) => r && String(r.type || '').toUpperCase() === 'PRINT';

  if (cache.loaded) {
    return (cache.reports || []).filter(isPrint);
  }

  const merged = [];
  const seen = new Set();
  const push = (r) => {
    if (!isPrint(r)) return;
    const data = r.data || {};
    const id = String(r.id || `${r.ts || 0}__${data.plaka || r.plaka || ''}`);
    if (seen.has(id)) return;
    seen.add(id);
    merged.push(r);
  };
  try {
    (cache.reports || []).forEach(push);
    if (state.reports && Array.isArray(state.reports) && state.reports.length) {
      state.reports.forEach(push);
    } else if (window.Report && typeof window.Report.getEvents === 'function') {
      (window.Report.getEvents() || []).forEach(push);
    }
  } catch (e) { /* ignore */ }
  return merged;
}

function _ihracatReportMatchesExcelFirmalar(report, firmalar) {
  if (!(firmalar instanceof Set) || firmalar.size === 0) return true;
  const data = (report && report.data) || {};
  const firma = String(report.firma || data.firma || data.firmaKodu || data.firmaSelect || '').trim();
  if (!firma) return true;
  for (const ef of firmalar) {
    if (_ihracatFirmaMatchesExcel(firma, ef)) return true;
  }
  return false;
}

/** Rapor / sunucu yazdırma kayıtlarından plaka başına yazdırma adedi. */
function _ihracatCollectReportPrintCountsByPlate(meta, excelFirmalar) {
  const map = new Map();
  const pk = (value) => _ihracatPlateKey(value);
  const firmalar = excelFirmalar instanceof Set ? excelFirmalar : new Set();
  const twoDaysAgo = Date.now() - 2 * 24 * 60 * 60 * 1000;

  _ihracatGetPrintReports().forEach((r) => {
    const ts = Number(r.ts || (r.data && r.data.ts) || 0);
    if (Number.isFinite(ts) && ts > 0 && ts < twoDaysAgo) return;
    if (!_ihracatReportMatchesExcelFirmalar(r, firmalar)) return;

    const data = r.data || {};
    const raw = data.plaka || data.plate || r.plaka || data.cekiciPlaka || data.dorsePlaka || '';
    const k = pk(raw);
    if (!k) return;
    map.set(k, (map.get(k) || 0) + 1);
  });

  return map;
}

/** Takip formu yazdırılmış; Excel satırında olmayan plakaları yazdırmaya ekle. */
function _ihracatCollectPrintedExitRows(shipments, meta, existingRows) {
  const excelFirmalar = [];
  const seenFirma = new Set();
  (shipments || []).forEach((s) => {
    const f = String(s.firma || '').trim();
    if (f && !seenFirma.has(f)) {
      seenFirma.add(f);
      excelFirmalar.push(f);
    }
  });
  if (!excelFirmalar.length) return [];

  const plateKeys = new Set((existingRows || []).map((r) => _ihracatPlateKey(r.plaka)).filter(Boolean));
  const addedKeys = new Set();
  const out = [];

  const pushExit = (plateRaw, firmaRaw, data) => {
    const plate = normPlate(plateRaw || '');
    const pKey = _ihracatPlateKey(plate);
    if (!pKey || plateKeys.has(pKey) || addedKeys.has(pKey)) return;

    const matchedFirma = excelFirmalar.find((ef) => _ihracatFirmaMatchesExcel(firmaRaw, ef));
    if (!matchedFirma) return;

    const template = (shipments || []).find((s) => _ihracatFirmaMatchesExcel(s.firma, matchedFirma)) || {};
    addedKeys.add(pKey);
    plateKeys.add(pKey);
    out.push({
      plaka: plate,
      firma: matchedFirma,
      malzeme: String(data.malzeme || data.malzemeSelect || template.malzeme || '').trim(),
      tonajKg: String(data.tonaj || data.tonajKg || '').trim(),
      bbt: String(data.bbt || '').trim(),
      bosBbt: String(data.bosBbt || '').trim(),
      cuval: String(data.cuval || '').trim(),
      bosCuval: String(data.bosCuval || '').trim(),
      palet: String(data.palet || '').trim(),
      fileName: String(template.fileName || meta?.fileName || '').trim(),
      headerText: template.headerText || '',
      ydKey: template.ydKey || '',
      _status: 'printed',
      _cikisYapti: true,
      _fromTakipPrint: true,
    });
  };

  (state.vehicles || []).forEach((v) => {
    const snap = v.lastPrintSnapshot;
    const snapTs = Number(snap?.ts || snap?.timestamp || 0);
    if (!Number.isFinite(snapTs) || snapTs <= 0) return;
    if (!_ihracatPrintSnapValidForMeta(snapTs, meta)) return;
    if ((Number(v.printCount || 0) || 0) <= 0) return;
    const firma = snap.firmaKodu || snap.firmaSelect || v.defaultFirma || '';
    const payload = { ...snap, malzeme: snap.malzeme || v.defaultMalzeme };
    pushExit(v.cekiciPlaka, firma, payload);
    if (v.dorsePlaka && _ihracatPlateKey(v.dorsePlaka) !== _ihracatPlateKey(v.cekiciPlaka)) {
      pushExit(v.dorsePlaka, firma, payload);
    }
  });

  try {
    _ihracatGetPrintReports()
      .filter((r) => r && String(r.type || '').toUpperCase() === 'PRINT')
      .forEach((r) => {
        const d = r.data || {};
        const firma = d.firma || d.firmaKodu || d.firmaSelect || r.firma || '';
        pushExit(d.plaka || d.plate || r.plaka || d.cekiciPlaka, firma, d);
      });
  } catch (e) {
    console.warn('Yazdırılmış plaka listesi okunamadı:', e);
  }

  return out;
}

/** Yazdırma = modalde görünen satırlar (WYSIWYG); ek plaka / sıra değişikliği yok. */
function _ihracatPrepareRowsForPrint(modal, shipments, meta, statusApi) {
  return _ihracatCollectModalRowsForPrint(modal, shipments, statusApi, meta);
}

function _ihracatGroupPrintRows(rows, meta) {
  const files = [];
  const grouped = {};
  (rows || []).forEach((r) => {
    const fileLabel = String(r.fileName || meta?.fileName || '').trim() || 'Excel';
    const firma = String(r.firma || '').trim() || 'Bilinmiyor';
    if (!grouped[fileLabel]) grouped[fileLabel] = {};
    if (!grouped[fileLabel][firma]) grouped[fileLabel][firma] = [];
    grouped[fileLabel][firma].push(r);
    if (!files.includes(fileLabel)) files.push(fileLabel);
  });
  if (!files.length) files.push('Excel');
  return { files, grouped };
}

/** Yazdırma: plaka sayısına göre blok sıkıştırma (sayfada bölünmesin diye) */
function _ihracatPrintFirmaSizeClass(plakaCount) {
  const n = Number(plakaCount) || 0;
  if (n > 14) return 'ihr-print-firma--xs';
  if (n > 9) return 'ihr-print-firma--sm';
  if (n > 6) return 'ihr-print-firma--md';
  return '';
}

function _printIhracatDetailsFromModal(modal, ctx) {
  const { shipments, meta, ihracatStatusApi } = ctx || {};
  const rows = _ihracatPrepareRowsForPrint(modal, shipments, meta, ihracatStatusApi);
  if (!rows.length) {
    alert('Yazdırılacak sevkiyat satırı yok.');
    return;
  }
  const cikisCount = rows.filter((r) => r._status === 'printed').length;

  const tarih = meta?.dateKey
    ? meta.dateKey.replace(/(\d{4})-(\d{2})-(\d{2})/, '$3.$2.$1')
    : '';
  const now = new Date();
  const printedAt = `${_ihracatPad2(now.getDate())}.${_ihracatPad2(now.getMonth() + 1)}.${now.getFullYear()} ${_ihracatPad2(now.getHours())}:${_ihracatPad2(now.getMinutes())}`;
  const { files, grouped } = _ihracatGroupPrintRows(rows, meta);

  const cell = (val, cls) => {
    const t = String(val ?? '').trim();
    return `<td class="${cls || ''}">${t ? escapeHtml(t) : '—'}</td>`;
  };

  const plakaCellHtml = (r) => {
    const plate = String(r.plaka || '').trim();
    const durum = String(r._durumText || '').trim();
    const sira = _ihracatSiraPrefixHtml(r.sira);
    return `<td class="c-plaka">${sira}${plate ? escapeHtml(plate) : '—'}${
      durum ? `<div class="c-durum">${escapeHtml(durum)}</div>` : ''
    }</td>`;
  };

  const printRowHtml = (r) => `<tr${r._status === 'printed' ? ' class="row-printed"' : ''}>
      ${plakaCellHtml(r)}
      ${cell(r.malzeme, 'c-malzeme')}
      ${cell(r.tonajKg, 'c-num')}
      ${cell(r.bbt, 'c-num c-bbt')}
      ${cell(r.bosBbt, 'c-num')}
      ${cell(r.cuval, 'c-num')}
      ${cell(r.bosCuval, 'c-num')}
      ${cell(r.palet, 'c-num')}
    </tr>`;

  const blockSectionHtml = (sectionTitle, items) => {
    const sortedItems = [...items].sort(
      (a, b) => (a._domOrder ?? 0) - (b._domOrder ?? 0)
    );
    const sample = sortedItems[0] || {};
    const sevk = String(sample._blockSevk || sample.sevkYeri || '').trim();
    const amb = String(sample._blockAmb || sample.ambalaj || sample.ambalajBilgisi || '').trim();
    const malzeme = String(sample.malzeme || '').trim();
    const firmaCikis = sortedItems.filter((it) => it._status === 'printed').length;
    const excelDescHtml = _ihracatRenderExcelBlockHeader(sample, sortedItems);
    const printToplamHtml = _ihracatPrintToplamRowHtml(sortedItems);
    const sizeCls = _ihracatPrintFirmaSizeClass(sortedItems.length);
    return `
      <div class="ihr-print-block-unit ihr-print-firma ${sizeCls}">
        <div class="ihr-print-firma-head">
          <strong>${escapeHtml(sectionTitle)}</strong>
          <span class="ihr-print-firma-meta">${sortedItems.length} plaka${firmaCikis ? ` · ${firmaCikis} çıkış yaptı` : ''}</span>
        </div>
        <div class="ihr-print-excel-box">${excelDescHtml}</div>
        <div class="ihr-print-block-fields">
          <div class="ihr-print-field"><span class="ihr-print-label">Ambalaj bilgisi</span><span class="ihr-print-value">${amb ? escapeHtml(amb) : '—'}</span></div>
          <div class="ihr-print-field"><span class="ihr-print-label">Sevk yeri</span><span class="ihr-print-value">${sevk ? escapeHtml(sevk) : '—'}</span></div>
        </div>
        <div class="ihr-print-table-shell">
        <table class="ihr-print-plaka-table">
          <colgroup>
            <col style="width:14%"><col style="width:22%"><col style="width:8%">
            <col style="width:9%"><col style="width:9%"><col style="width:9%"><col style="width:9%"><col style="width:9%">
          </colgroup>
          <thead>
            <tr>
              <th>Plaka</th>
              <th>Malzeme</th>
              <th>Kg</th>
              <th>BBT</th>
              <th>Boş BBT</th>
              <th>Çuval</th>
              <th>Boş çuval</th>
              <th>Palet</th>
            </tr>
          </thead>
          <tbody>${sortedItems.map(printRowHtml).join('')}${printToplamHtml}</tbody>
        </table>
        </div>
      </div>`;
  };

  const fileSectionHtml = (fileLabel) => {
    const firmas = grouped[fileLabel] || {};
    const blockGroups = {};
    Object.keys(firmas).forEach((firmaKey) => {
      (firmas[firmaKey] || []).forEach((item) => {
        const bk = _ihracatBlockGroupKey(item);
        if (!blockGroups[bk]) {
          blockGroups[bk] = {
            title: _ihracatShortBlockTitle(item.headerText, item.malzeme) || firmaKey,
            items: [],
          };
        }
        blockGroups[bk].items.push(item);
      });
    });
    const blockOrder = Object.keys(blockGroups).sort((a, b) => {
      const ra = Number(blockGroups[a].items[0]?.blockHeaderRow) || 0;
      const rb = Number(blockGroups[b].items[0]?.blockHeaderRow) || 0;
      return ra - rb;
    });
    const fileCount = blockOrder.reduce((n, bk) => n + (blockGroups[bk].items?.length || 0), 0);
    const blockCount = blockOrder.length;
    const pairOnPage =
      blockCount === 2 &&
      blockOrder.every((bk) => (blockGroups[bk].items?.length || 0) <= 8);
    const fileCls = [
      'ihr-print-file',
      blockCount >= 2 ? 'ihr-print-file--multi' : '',
      pairOnPage ? 'ihr-print-file--pair' : '',
    ]
      .filter(Boolean)
      .join(' ');
    return `
      <div class="${fileCls}">
        <h2>${escapeHtml(fileLabel)} <span class="ihr-print-file-count">(${fileCount} kayıt)</span></h2>
        ${blockOrder.map((bk) => blockSectionHtml(blockGroups[bk].title, blockGroups[bk].items)).join('')}
      </div>`;
  };

  const bodyContent = `
  <div class="ihr-print-head">
    <h1>İhracat Sevkiyat Listesi</h1>
    ${tarih ? `<div class="ihr-print-date">${escapeHtml(tarih)}</div>` : ''}
  </div>
  <div class="ihr-print-meta"><b>${rows.length}</b> plaka${cikisCount ? ` · <b>${cikisCount}</b> çıkış yaptı` : ''} · Yazdırma: ${escapeHtml(printedAt)}</div>
  ${files.map(fileSectionHtml).join('')}`;

  const printHtml = `<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="utf-8">
  <title>İhracat Sevkiyat Listesi</title>
  <style>
    @page { size: A4 landscape; margin: 6mm; }
    html, body { margin: 0; padding: 0; height: auto; min-height: 0; }
    * { box-sizing: border-box; }
    body { font-family: Arial, 'Segoe UI', sans-serif; font-size: 11px; color: #000; background: #fff; }
    .ihr-print-root { padding: 0; }
    .ihr-print-head { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; margin: 0 0 8px; padding-bottom: 6px; border-bottom: 2px solid #000; }
    h1 { font-size: 16px; margin: 0; font-weight: 800; }
    .ihr-print-date { font-size: 18px; font-weight: 800; white-space: nowrap; }
    .ihr-print-meta { font-size: 10px; margin: 0 0 10px; }
    .ihr-print-file { margin-bottom: 12px; }
    .ihr-print-file h2 { font-size: 13px; margin: 0 0 8px; font-weight: 800; page-break-after: avoid; }
    .ihr-print-file-count { font-weight: 600; font-size: 11px; }
    .ihr-print-block-unit {
      display: block;
      margin: 0 0 12px;
      padding: 8px 10px;
      border: 1px solid #000;
      break-inside: avoid-page;
      page-break-inside: avoid;
      -webkit-column-break-inside: avoid;
    }
    .ihr-print-excel-box { margin-bottom: 6px; }
    .ihr-print-excel-box .ihr-excel-desc { margin: 0 !important; border-radius: 0; }
    .ihr-print-firma-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 8px; margin-bottom: 5px; }
    .ihr-print-firma-head strong { font-size: 13px; font-weight: 800; line-height: 1.3; }
    .ihr-print-firma-meta { font-size: 10px; margin-left: auto; white-space: nowrap; }
    .ihr-print-block-fields { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 6px; }
    .ihr-print-field { flex: 1; min-width: 160px; padding: 5px 7px; border: 1px solid #000; }
    .ihr-print-label { display: block; font-size: 9px; font-weight: 800; text-transform: uppercase; margin-bottom: 2px; }
    .ihr-print-value { display: block; font-size: 11px; font-weight: 700; line-height: 1.3; word-break: break-word; }
    .ihr-print-table-shell {
      break-inside: avoid-page;
      page-break-inside: avoid;
      -webkit-column-break-inside: avoid;
    }
    .ihr-print-plaka-table { width: 100%; border-collapse: collapse; table-layout: fixed; margin: 0; }
    .ihr-print-plaka-table thead { display: table-header-group; }
    .ihr-print-plaka-table th,
    .ihr-print-plaka-table td { border: 1px solid #000; padding: 5px 6px; vertical-align: middle; word-break: break-word; line-height: 1.25; }
    .ihr-print-plaka-table th { font-size: 10px; font-weight: 800; text-align: center; background: #f5f5f5; }
    .ihr-print-toplam td { background: #fffbeb !important; font-weight: 800; }
    td.c-plaka { font-size: 12px; font-weight: 800; text-align: center; }
    .c-durum { font-size: 8px; font-weight: 700; margin-top: 2px; line-height: 1.15; }
    tr.row-printed td { font-style: normal; }
    td.c-malzeme { font-size: 11px; font-weight: 700; }
    td.c-num { font-size: 12px; font-weight: 800; text-align: center; }
    td.c-bbt { font-size: 13px; font-weight: 800; }
    .ihr-print-firma--md .ihr-print-firma-head strong { font-size: 12px; }
    .ihr-print-firma--md .ihr-print-plaka-table th,
    .ihr-print-firma--md .ihr-print-plaka-table td { padding: 4px 5px; font-size: 10px; }
    .ihr-print-firma--md td.c-plaka { font-size: 11px; }
    .ihr-print-firma--md td.c-bbt { font-size: 12px; }
    .ihr-print-firma--md .ihr-excel-desc { font-size: 10px; }
    .ihr-print-firma--sm { font-size: 10px; }
    .ihr-print-firma--sm .ihr-print-firma-head strong { font-size: 11px; }
    .ihr-print-firma--sm .ihr-print-plaka-table th,
    .ihr-print-firma--sm .ihr-print-plaka-table td { padding: 3px 4px; font-size: 9px; }
    .ihr-print-firma--sm td.c-plaka { font-size: 10px; }
    .ihr-print-firma--sm td.c-bbt { font-size: 11px; }
    .ihr-print-firma--sm .ihr-excel-desc { font-size: 9px; }
    .ihr-print-firma--sm .ihr-print-field { padding: 4px 6px; }
    .ihr-print-firma--xs { font-size: 9px; }
    .ihr-print-firma--xs .ihr-print-firma-head strong { font-size: 10px; }
    .ihr-print-firma--xs .ihr-print-plaka-table th,
    .ihr-print-firma--xs .ihr-print-plaka-table td { padding: 2px 3px; font-size: 8px; line-height: 1.15; }
    .ihr-print-firma--xs td.c-plaka { font-size: 9px; }
    .ihr-print-firma--xs td.c-bbt { font-size: 10px; }
    .ihr-print-firma--xs .ihr-excel-desc { font-size: 8px; }
    .ihr-print-firma--xs .ihr-print-block-unit { padding: 6px 8px; }
    .ihr-print-file--multi .ihr-print-block-unit:not(.ihr-print-firma--xs):not(.ihr-print-firma--sm) {
      font-size: 10px;
    }
    .ihr-print-file--multi .ihr-print-block-unit:not(.ihr-print-firma--xs):not(.ihr-print-firma--sm) .ihr-print-plaka-table th,
    .ihr-print-file--multi .ihr-print-block-unit:not(.ihr-print-firma--xs):not(.ihr-print-firma--sm) .ihr-print-plaka-table td {
      padding: 4px 5px;
      font-size: 9px;
    }
    .ihr-print-file--pair .ihr-print-block-unit {
      margin-bottom: 8px;
      padding: 6px 8px;
    }
    .ihr-print-file--pair .ihr-print-firma-head strong { font-size: 11px; }
    .ihr-print-file--pair .ihr-excel-desc { font-size: 9px !important; }
    @media print {
      html, body { margin: 0 !important; padding: 0 !important; }
      body, th, td, .ihr-print-field { background: #fff !important; color: #000 !important; }
      .ihr-print-block-unit,
      .ihr-print-table-shell,
      .ihr-print-excel-box,
      .ihr-print-block-fields {
        break-inside: avoid-page !important;
        page-break-inside: avoid !important;
        -webkit-column-break-inside: avoid !important;
      }
      .ihr-print-plaka-table { page-break-inside: avoid !important; break-inside: avoid-page !important; }
      .ihr-print-plaka-table tr { page-break-inside: avoid !important; break-inside: avoid !important; }
      .ihr-print-block-unit + .ihr-print-block-unit {
        page-break-before: auto;
      }
      .ihr-print-firma--xs,
      .ihr-print-firma--sm {
        page-break-before: always;
      }
      .ihr-print-file > .ihr-print-block-unit:first-of-type.ihr-print-firma--xs,
      .ihr-print-file > .ihr-print-block-unit:first-of-type.ihr-print-firma--sm {
        page-break-before: auto;
      }
    }
  </style>
</head>
<body><div class="ihr-print-root">${bodyContent}</div></body>
</html>`;

  const IHR_PRINT_FRAME_HIDE = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;border:0;overflow:hidden;';
  let frame = document.getElementById('ihracatDetailsPrintFrame');
  if (!frame) {
    frame = document.createElement('iframe');
    frame.id = 'ihracatDetailsPrintFrame';
    frame.setAttribute('aria-hidden', 'true');
    frame.style.cssText = IHR_PRINT_FRAME_HIDE;
    document.body.appendChild(frame);
  }
  const win = frame.contentWindow;
  const doc = frame.contentDocument || win.document;
  doc.open();
  doc.write(printHtml);
  doc.close();

  const doPrint = () => {
    try {
      win.focus();
      win.print();
    } catch (e) {
      alert('Yazdırma başlatılamadı.');
    }
  };
  if (doc.readyState === 'complete') setTimeout(doPrint, 200);
  else frame.onload = () => setTimeout(doPrint, 200);
}

/** Yazdırılmış plaka: rapor listesi (print_history) tek kaynak; silinince durum düşer. */
function _ihracatCollectPrintedCapacityByPlate(meta, excelFirmalar) {
  const map = new Map();
  const firmalar = excelFirmalar instanceof Set ? excelFirmalar : new Set();

  try {
    const reportCounts = _ihracatCollectReportPrintCountsByPlate(meta, firmalar);
    reportCounts.forEach((count, k) => map.set(k, count));
  } catch (e) {
    console.warn('Raporlardan yazdırılma durumu kontrol edilemedi:', e);
  }

  if (window.__ihracatRemotePrintCache?.loaded) {
    return map;
  }

  const pk = (value) => _ihracatPlateKey(value);
  const creditKeys = (keys, count) => {
    const n = Number(count);
    if (!Number.isFinite(n) || n <= 0) return;
    keys.forEach((k) => {
      if (!k) return;
      map.set(k, Math.max(map.get(k) || 0, n));
    });
  };

  (state.vehicles || []).forEach((v) => {
    const printCount = Number(v.printCount || 0);
    if (!Number.isFinite(printCount) || printCount <= 0) return;
    const snap = v.lastPrintSnapshot || {};
    const snapTs = Number(snap?.ts || snap?.timestamp || 0);
    if (!Number.isFinite(snapTs) || snapTs <= 0) return;
    if (!_ihracatPrintSnapValidForMeta(snapTs, meta)) return;

    const snapKeys = new Set();
    [snap.plaka, snap.cekiciPlaka, snap.dorsePlaka, snap.plate].forEach((raw) => {
      const k = pk(raw);
      if (k) snapKeys.add(k);
    });

    const currentKeys = new Set();
    [v.cekiciPlaka, v.dorsePlaka, v.plaka].forEach((raw) => {
      const k = pk(raw);
      if (k) currentKeys.add(k);
    });

    let keysToCredit = [];
    if (snapKeys.size > 0) {
      keysToCredit = [...snapKeys].filter((k) => currentKeys.has(k));
    } else {
      const primary = pk(snap.plaka || v.cekiciPlaka || '');
      if (primary && currentKeys.has(primary)) keysToCredit = [primary];
    }
    creditKeys(keysToCredit, printCount);
  });

  return map;
}

function _ihracatCreateStatusApi(meta, excelFirmalar) {
  const normalizePlate = (value) => normPlate(value || '');
  const plateKeyFn = (value) => _ihracatPlateKey(value);
  const statusStyle = {
    printed: 'background:#fee2e2;color:#991b1b;',
    pending: 'background:#dcfce7;color:#166534;',
    missing: 'background:#f1f5f9;color:#0f172a;',
  };

  let cachedCapacityMap = null;
  const capacityMap = () => {
    if (!cachedCapacityMap) {
      cachedCapacityMap = _ihracatCollectPrintedCapacityByPlate(meta, excelFirmalar);
    }
    return cachedCapacityMap;
  };

  const resolveRowStatus = (plateRaw, assignmentCountByPlate) => {
    const key = plateKeyFn(plateRaw);
    if (!key) return 'missing';
    const allowed = capacityMap().get(key) || 0;
    const alreadyAssigned = assignmentCountByPlate.get(key) || 0;
    if (allowed > alreadyAssigned) {
      assignmentCountByPlate.set(key, alreadyAssigned + 1);
      return 'printed';
    }
    if (_ihracatFindVehicleByPlate(plateRaw)) return 'pending';
    return 'missing';
  };

  const statusForPlate = (plateRaw) => {
    const counter = new Map();
    return resolveRowStatus(plateRaw, counter);
  };

  const getShipmentStatus = (shipment, assignmentCountByPlate) => {
    return resolveRowStatus(shipment.plaka, assignmentCountByPlate);
  };

  return {
    normalizePlate,
    plateKey: plateKeyFn,
    statusForPlate,
    resolveRowStatus,
    getShipmentStatus,
    statusStyle,
    durumLabel: (st) => _ihracatDurumPlainText(st, ''),
    renderDurumHtml: _ihracatRenderDurumHtml,
    meta,
    excelFirmalar,
  };
}

function _ihracatRefreshOpenModalStatuses() {
  const modal = document.getElementById('ihracatDetailsModal');
  if (!modal) return;
  const apply = () => {
    const meta = (typeof loadDailyMeta === 'function') ? (loadDailyMeta() || {}) : (modal.__ihrMeta || {});
    modal.__ihrMeta = meta;

    let firmalar = modal.__ihrExcelFirmalar;
    if (!(firmalar instanceof Set) || firmalar.size === 0) {
      firmalar = new Set();
      const rows = (typeof loadDailyShipments === 'function') ? (loadDailyShipments() || []) : [];
      rows.forEach((s) => {
        const firma = String(s.firma || '').trim();
        if (firma) firmalar.add(firma);
      });
    }
    modal.__ihrExcelFirmalar = firmalar;

    const statusApi = _ihracatCreateStatusApi(meta, firmalar);
    modal.__ihracatStatusApi = statusApi;
    const assignmentCountByPlate = new Map();

    modal.querySelectorAll('tr[data-ihr-row-key]').forEach((row) => {
      const plate =
        row.querySelector('[data-field="plaka-text"]')?.textContent?.trim() ||
        row.querySelector('[data-field="plaka"]')?.value?.trim() ||
        '';
      const st = statusApi.resolveRowStatus(plate, assignmentCountByPlate);
      _ihracatApplyDurumCell(row.querySelector('[data-field="durum"]'), row, plate, statusApi, st);
    });
  };
  _ihracatFetchRemotePrintReports(false).then(apply).catch(apply);
}

function _ihracatSyncVehiclePlatesFromTakipForm() {
  const vid = String(window.__activeTakipVehicleId || '').trim();
  if (!vid) return;
  const read = (id) => String(document.getElementById(id)?.value || '').trim();
  let cekici = read('cekiciPlakaBilgi');
  let dorse = read('dorsePlakaBilgi');
  try { cekici = formatPlakaForInput(cekici); } catch (_) {}
  try { dorse = formatPlakaForInput(dorse); } catch (_) {}
  const patch = (v) => {
    if (!v || String(v.id) !== vid) return v;
    return { ...v, cekiciPlaka: cekici || v.cekiciPlaka, dorsePlaka: dorse };
  };
  try {
    if (window.__activeTakipVehicle) window.__activeTakipVehicle = patch(window.__activeTakipVehicle);
  } catch (_) {}
  state.vehicles = (state.vehicles || []).map(patch);
  _ihracatRefreshOpenModalStatuses();
}

function _ihracatOnReportsChanged() {
  try { _ihracatInvalidatePrintReportsCache(); } catch (e) {}
  _ihracatFetchRemotePrintReports(true)
    .then(() => { try { _ihracatRefreshOpenModalStatuses(); } catch (e) {} })
    .catch(() => {});
}
window._ihracatOnReportsChanged = _ihracatOnReportsChanged;
window._ihracatRefreshOpenModalStatuses = _ihracatRefreshOpenModalStatuses;

// İhracat Excel Detay Modal
async function showIhracatDetailsModal() {
  if (document.getElementById('ihracatDetailsModal')) return;

  _ihracatShowDetailsLoading();

  const cache = window.__ihracatRemotePrintCache;
  const prepPromise = _ihracatPreparePrintReportsForModal();
  // Sayfa ilk açılışında prefetch bitmediyse bekle; önbellek taze ise modalı bloklama
  if (cache.loading && !cache.loaded) {
    try { await prepPromise; } catch (e) { /* ignore */ }
  } else {
    prepPromise.catch(() => {});
  }

  try {
    if (window.Report && typeof window.Report.getEvents === 'function') {
      state.reports = window.Report.getEvents();
    }
  } catch (e) { /* ignore */ }

  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

  const shipments = (typeof loadDailyShipments === 'function') ? (loadDailyShipments() || []) : [];
  const meta = (typeof loadDailyMeta === 'function') ? (loadDailyMeta() || {}) : {};
  const tarih = meta.dateKey ? meta.dateKey.replace(/(\d{4})-(\d{2})-(\d{2})/, '$3.$2.$1') : 'Bilinmiyor';
  if (!shipments.length) {
    _ihracatHideDetailsLoading();
    showToast('❌ İhracat verisi bulunamadı.');
    return;
  }

  window.__ihracatModalVehicleMap = _ihracatBuildVehiclePlateMap();
  let excelFirmalar;
  let ihracatStatusApi;
  try {

  // Excel'deki firmaları topla (rapor filtreleme için)
  excelFirmalar = new Set();
  shipments.forEach(s => {
    const firma = String(s.firma || '').trim();
    if (firma) excelFirmalar.add(firma);
  });

  const assignmentCountByPlate = new Map();
  ihracatStatusApi = _ihracatCreateStatusApi(meta, excelFirmalar);
  const { statusStyle, getShipmentStatus } = ihracatStatusApi;

  const getStatus = (shipment) => shipment._status || 'pending';
  const getFileLabel = (shipment) => {
    const label = String(shipment.fileName || meta.fileName || '').trim();
    return label || 'Excel';
  };
  const getFirmaLabel = (shipment) => {
    const label = String(shipment.firma || '').trim();
    return label || 'Bilinmiyor';
  };

  // Aynı plakaya ait birden fazla sevkiyat varsa, yazdırma durumunu sadece yazdırılan miktar kadar atıyoruz.
  shipments.forEach((shipment) => {
    shipment._status = getShipmentStatus(shipment, assignmentCountByPlate);
  });

  const { collisions: irsCollisions, set: irsCollisionSet } = getIrsaliyeCollisionInfo(shipments);
  const euModal = window.ExcelUtils || {};
  const fmtDupPlate = euModal.formatDupPlateRowDetail || ((d) => (d.entries || d.irsaliyeNos || []).join(' · '));
  const { dupPlateRows, set: dupPlateSet, byKey: dupPlateByKey } = getDuplicatePlateInfo(shipments);
  const collisionByKey = new Map();
  irsCollisions.forEach((c) => {
    collisionByKey.set(irsaliyeCollisionKey(c.irsaliyeNo), c);
  });

  const inpStyle = 'width:100%;max-width:72px;padding:4px 6px;border:1px solid #cbd5e1;border-radius:6px;font-size:12px;box-sizing:border-box;';
  const rowHtml = (s, status) => {
    const rowKey = _ihracatShipmentKey(s);
    const durumHtml = _ihracatRenderDurumHtml(status, s.plaka || '');
    const durumText = _ihracatDurumPlainText(status, s.plaka || '');
    const irs = getShipmentIrsaliyeNo(s);
    const isManual = s._ihracatManual || String(rowKey).startsWith('new__');
    const isIrsCollision = shipmentHasIrsaliyeCollision(s, irsCollisionSet);
    const isDupPlate = shipmentHasDuplicatePlate(s, dupPlateSet);
    const dupDetail = dupPlateByKey.get(plateCollisionKey(s.plaka));
    const rowStyle = statusStyle[status] || '';
    const coll = collisionByKey.get(irsaliyeCollisionKey(irs));
    const irsTitle = coll
      ? `Aynı irsaliye birden fazla plakada: ${(coll.plates || []).join(' · ')}`
      : '';
    const plakaTitle = isDupPlate && dupDetail
      ? `Aynı plaka birden fazla sevkiyatta: ${fmtDupPlate(dupDetail)}`
      : '';
    const irsCellStyle = isIrsCollision
      ? `border:1px solid #eee;padding:6px;${IHR_IRS_COLLISION_CELL_STYLE}`
      : 'border:1px solid #ddd;padding:6px;';
    const irsInpStyle = isIrsCollision
      ? `${inpStyle}max-width:130px;background:#fef3c7;color:#92400e;font-weight:700;border-color:#fbbf24;`
      : `${inpStyle}max-width:130px;`;
    const plakaTdStyle = isDupPlate
      ? `border:1px solid #eee;padding:4px 6px;white-space:nowrap;width:198px;max-width:198px;overflow:hidden;vertical-align:middle;${IHR_IRS_COLLISION_CELL_STYLE}`
      : IHR_PLAKA_TD_STYLE;
    const siraAttr = String(s.sira || '').trim();
    return `
      <tr data-ihr-row-key="${escapeHtml(rowKey)}"${siraAttr ? ` data-ihr-sira="${escapeHtml(siraAttr)}"` : ''}${isManual ? ' data-ihr-is-new="1"' : ''}${isIrsCollision ? ' data-ihr-irs-collision="1"' : ''}${isDupPlate ? ' data-ihr-plate-collision="1"' : ''} style="${rowStyle}">
        <td style="${plakaTdStyle}" title="${escapeHtml(plakaTitle)}">${_ihracatPlakaCellHtml(s.plaka, false, false, { isDupPlate, dupPlateTitle: plakaTitle, sira: s.sira })}</td>
        <td data-field="firma" style="border:1px solid #ddd;padding:6px;font-size:11px;">${escapeHtml(s.firma || '')}</td>
        <td data-field="malzeme" style="border:1px solid #ddd;padding:6px;">${escapeHtml(s.malzeme || '')}</td>
        <td style="border:1px solid #ddd;padding:6px;">
          <input type="text" data-field="tonaj" value="${escapeHtml(String(s.tonajKg || ''))}" style="${inpStyle}max-width:90px;" inputmode="numeric" />
        </td>
        <td style="border:1px solid #ddd;padding:4px 6px;${IHR_AMBALAJ_TD_STYLE}">
          ${_ihracatAmbalajCellHtml(null, s)}
        </td>
        <td style="border:1px solid #ddd;padding:4px;text-align:center;white-space:nowrap;width:96px;">
          ${_ihracatTakipBtnHtml()}
        </td>
        <td style="${irsCellStyle}" title="${escapeHtml(irsTitle)}">
          <input type="text" data-field="irsaliye" value="${escapeHtml(irs)}" style="${irsInpStyle}" title="${escapeHtml(irsTitle)}" />
        </td>
        <td data-field="durum" data-ihr-durum-text="${escapeHtml(durumText)}" style="border:1px solid #ddd;padding:6px;font-size:11px;white-space:nowrap;">${durumHtml}</td>
      </tr>
    `;
  };

  const addRowHtml = () => `
    <tr data-ihr-add-row="1" style="background:#fffbeb;color:#92400e;">
      <td style="${IHR_PLAKA_TD_STYLE}">${_ihracatPlakaCellHtml('', true, true)}</td>
      <td data-field="firma" style="border:1px solid #ddd;padding:6px;font-size:11px;color:#94a3b8;">—</td>
      <td data-field="malzeme" style="border:1px solid #ddd;padding:6px;color:#94a3b8;">—</td>
      <td style="border:1px solid #ddd;padding:6px;"><input type="text" data-field="tonaj" value="" style="${inpStyle}max-width:90px;" disabled /></td>
      <td style="border:1px solid #ddd;padding:6px;opacity:0.5;"><span style="font-size:11px;">Firma ve malzeme üst satırdan kopyalanır</span></td>
      <td style="border:1px solid #ddd;padding:4px;text-align:center;color:#94a3b8;font-size:11px;">—</td>
      <td style="border:1px solid #ddd;padding:6px;"><input type="text" data-field="irsaliye" value="" style="${inpStyle}max-width:130px;" disabled /></td>
      <td data-field="durum" style="border:1px solid #ddd;padding:6px;font-size:11px;">Plaka girin</td>
    </tr>
  `;

  const renderTable = (items, title, badgeColor, tableCtx) => {
    if (!items || !items.length) return '';
    const { gk, templateJson } = tableCtx || {};
    const toplamRowHtml = _ihracatToplamRowHtml(items);
    return `
      <div style="margin-bottom:16px;">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">
          <strong style="font-size:13px;">${escapeHtml(title)}</strong>
          <span style="padding:4px 10px;border-radius:999px; background:${badgeColor}; color:#fff; font-size:12px;">${items.length}</span>
        </div>
        <table class="ihr-sevkiyat-table" style="width:100%;border-collapse:collapse;font-size:12px;margin-bottom:8px;">
          <thead>
            <tr style="background:#f5f5f5;">
              <th style="border:1px solid #ddd;padding:6px;text-align:left;width:198px;">Sıra / Plaka</th>
              <th style="border:1px solid #ddd;padding:6px;text-align:left;">Firma</th>
              <th style="border:1px solid #ddd;padding:6px;text-align:left;">Malzeme</th>
              <th style="border:1px solid #ddd;padding:6px;text-align:left;">Miktar (Kg)</th>
              <th style="border:1px solid #ddd;padding:6px;text-align:left;white-space:nowrap;">Ambalaj</th>
              <th style="border:1px solid #ddd;padding:6px;text-align:center;width:96px;">Takip</th>
              <th style="border:1px solid #ddd;padding:6px;text-align:left;">İrsaliye No</th>
              <th style="border:1px solid #ddd;padding:6px;text-align:left;">Durum</th>
            </tr>
          </thead>
          <tbody data-ihr-tbody="1" data-ihr-firma-group="${escapeHtml(gk || '')}" data-ihr-template="${templateJson || '{}'}">
            ${items.map((item) => rowHtml(item, getStatus(item))).join('')}
            ${addRowHtml()}
            ${toplamRowHtml}
          </tbody>
        </table>
      </div>
    `;
  };

  const renderFirmaSection = (sectionTitle, items) => {
    const counts = { printed: 0, pending: 0, missing: 0 };
    items.forEach((item) => { counts[getStatus(item)] = (counts[getStatus(item)] || 0) + 1; });
    const sample = items[0] || {};
    const gk = _ihracatBlockGroupKey(sample);
    const sevkVal = _defaultSevkForShipment(sample);
    const ambVal = _defaultAmbalajTextForShipment(sample);
    const sevkCands = getLimanCandidates(sample.headerText || '').slice(0, 4);
    const ambCands = getAmbalajCandidates(sample.headerText || '').slice(0, 4);
    const boxStyle = 'flex:1;min-width:200px;padding:10px;border:2px solid #c7d2fe;border-radius:10px;background:#fff;';
    const fieldInp = 'width:100%;padding:8px;border:1px solid #cbd5e1;border-radius:8px;font-size:13px;box-sizing:border-box;';
    const templateJson = String(JSON.stringify(sample))
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;');
    const excelDescHtml = _ihracatRenderExcelBlockHeader(sample, items);
    return `
      <div data-ihr-block-section="1" style="margin-bottom:20px;border:1px solid #e2e8f0;border-radius:12px;padding:14px;background:#f8fafc;">
        <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:10px;margin-bottom:8px;">
          <strong style="font-size:14px;color:#0f172a;">${escapeHtml(sectionTitle)}</strong>
          <span style="font-size:12px;color:#475569;">Toplam: ${items.length} • Yazdırıldı: ${counts.printed} • Bekleniyor: ${counts.pending} • Kayıt yok: ${counts.missing}</span>
        </div>
        ${excelDescHtml}
        <div style="display:flex;flex-wrap:wrap;gap:12px;margin-bottom:14px;">
          <div style="${boxStyle}">
            <div style="font-size:11px;font-weight:700;color:#4338ca;margin-bottom:6px;">SEVK YERİ</div>
            <input type="text" data-ihr-firma-sevk="${escapeHtml(gk)}" value="${escapeHtml(sevkVal)}" list="ihr-sevk-list-${escapeHtml(gk)}" style="${fieldInp}" placeholder="Liman / sevk yeri" />
            <datalist id="ihr-sevk-list-${escapeHtml(gk)}">${sevkCands.map((c) => `<option value="${escapeHtml(c)}"></option>`).join('')}</datalist>
          </div>
          <div style="${boxStyle}">
            <div style="font-size:11px;font-weight:700;color:#4338ca;margin-bottom:6px;">AMBALAJ BİLGİSİ</div>
            <input type="text" data-ihr-firma-amb="${escapeHtml(gk)}" value="${escapeHtml(ambVal)}" list="ihr-amb-list-${escapeHtml(gk)}" style="${fieldInp}" placeholder="Örn: BBT, çuval, palet" />
            <datalist id="ihr-amb-list-${escapeHtml(gk)}">${ambCands.map((c) => `<option value="${escapeHtml(c)}"></option>`).join('')}</datalist>
            <div style="font-size:10px;color:#64748b;margin-top:6px;">Alttaki boş satıra plaka yazın; firma ve malzeme üst satırdan kopyalanır. Miktar, ambalaj ve irsaliye boş gelir.</div>
          </div>
        </div>
        ${renderTable(items, 'Sevkiyatlar', '#0f172a', { gk, templateJson })}
      </div>
    `;
  };

  const renderFileSection = (fileName, items) => {
    const blockGroups = {};
    items.forEach((item) => {
      const bk = _ihracatBlockGroupKey(item);
      if (!blockGroups[bk]) {
        blockGroups[bk] = {
          title:
            _ihracatShortBlockTitle(item.headerText, item.malzeme) || getFirmaLabel(item),
          items: [],
        };
      }
      blockGroups[bk].items.push(item);
    });

    const blockOrder = Object.keys(blockGroups).sort((a, b) => {
      const ia = blockGroups[a].items[0];
      const ib = blockGroups[b].items[0];
      const ra = Number(ia?.blockHeaderRow) || 0;
      const rb = Number(ib?.blockHeaderRow) || 0;
      if (ra !== rb) return ra - rb;
      return String(ia?.headerText || '').localeCompare(String(ib?.headerText || ''), 'tr');
    });
    return `
      <div data-ihr-file-section="1" style="margin-bottom:26px;">
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px; margin-bottom:12px;">
          <h4 style="margin:0; font-size:15px;">📄 ${escapeHtml(fileName)} - ${items.length} kayıt</h4>
          <span style="font-size:12px; color:#475569;">Sevkiyat bloğu bazında (Excel başlığı + toplam)</span>
        </div>
        ${blockOrder.map((bk) => renderFirmaSection(blockGroups[bk].title, blockGroups[bk].items)).join('')}
      </div>
    `;
  };

  const files = [];
  if (Array.isArray(meta.files)) {
    meta.files.forEach((f) => { const name = String(f || '').trim(); if (name && !files.includes(name)) files.push(name); });
  }
  if (meta.fileName && !files.includes(meta.fileName)) files.push(meta.fileName);
  const groupedByFile = {};
  shipments.forEach((s) => {
    const fileLabel = getFileLabel(s);
    if (!groupedByFile[fileLabel]) groupedByFile[fileLabel] = [];
    groupedByFile[fileLabel].push(s);
    if (!files.includes(fileLabel)) files.push(fileLabel);
  });
  if (!files.length) files.push('Excel');

  const modalSections = files.map((fileLabel) => {
    const items = groupedByFile[fileLabel] || [];
    return renderFileSection(fileLabel, items);
  }).join('');

  const collisionBannerHtml = irsCollisions.length
    ? `<div style="margin-bottom:14px;padding:10px 12px;background:#fffbeb;border:1px solid #fcd34d;border-radius:8px;font-size:12px;color:#92400e;line-height:1.45;">
        <div style="font-weight:800;color:#b45309;margin-bottom:6px;">⚠️ AYNI İRSALİYE NUMARASI BİRDEN FAZLA PLAKADA — İrsaliye No sütunundaki vurgulu hücrelere dikkat edin</div>
        <ul style="margin:0;padding-left:18px;font-size:11px;">
          ${irsCollisions.slice(0, 10).map((c) => `<li style="margin-bottom:6px;"><span style="display:inline-block;background:#fef3c7;color:#92400e;font-weight:700;padding:2px 8px;border-radius:6px;border:1px solid #fbbf24;">${escapeHtml(c.irsaliyeNo)}</span> → ${escapeHtml((c.plates || []).join(' · '))}</li>`).join('')}
          ${irsCollisions.length > 10 ? `<li style="color:#b45309;">… ve ${irsCollisions.length - 10} irsaliye daha</li>` : ''}
        </ul>
      </div>`
    : '';

  const dupPlateBannerHtml = dupPlateRows.length
    ? `<div style="margin-bottom:14px;padding:10px 12px;background:#fffbeb;border:1px solid #fcd34d;border-radius:8px;font-size:12px;color:#92400e;line-height:1.45;">
        <div style="font-weight:800;color:#b45309;margin-bottom:6px;">⚠️ AYNI PLAKA BİRDEN FAZLA SEVKİYAT SATIRINDA — Plaka sütunundaki vurgulu hücrelere dikkat edin</div>
        <p style="margin:0 0 8px;">Bu uyarı <b>kayıt eksikliği değil</b>. Excel’de aynı plaka <b>birden fazla farklı sevkiyat satırında</b> geçiyor. Hangi satırın doğru olduğunu Excel’den kontrol edin.</p>
        <ul style="margin:0;padding-left:18px;font-size:11px;">
          ${dupPlateRows.slice(0, 10).map((d) => `<li style="margin-bottom:6px;"><span style="display:inline-block;background:#fef3c7;color:#92400e;font-weight:700;padding:3px 8px;border-radius:6px;border:1px solid #fbbf24;">${escapeHtml(d.plaka)}</span> → ${escapeHtml(fmtDupPlate(d))}</li>`).join('')}
          ${dupPlateRows.length > 10 ? `<li style="color:#b45309;">… ve ${dupPlateRows.length - 10} plaka daha</li>` : ''}
        </ul>
      </div>`
    : '';

  const btnSaveStyle = 'background:#16a34a;color:#fff;border:none;padding:10px 22px;border-radius:8px;cursor:pointer;font-weight:700;';
  const btnCloseStyle = 'background:#64748b;color:#fff;border:none;padding:10px 18px;border-radius:8px;cursor:pointer;';

  const modalHtml = `
    <div id="ihracatDetailsModal" style="
      position: fixed; top: 0; left: 0; width: 100%; height: 100%;
      background: rgba(0,0,0,0.7); z-index: 9999; display: flex;
      align-items: center; justify-content: center; font-family: Arial, sans-serif;">
      <div style="
        background: white; padding: 20px; border-radius: 10px;
        max-width: 95%; max-height: 85%; overflow: auto; box-shadow: 0 4px 20px rgba(0,0,0,0.3);">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px;margin-bottom:12px;flex-wrap:wrap;">
          <div style="flex:1;min-width:220px;">
            <h3 style="margin: 0 0 6px 0; color: #333;">📄 İhracat Excel Detayları (${shipments.length} kayıt) - Tarih: ${tarih}</h3>
            <p style="margin:0;font-size:12px;color:#64748b;">Sevk/ambalaj bloktan; satırda miktar, ambalaj, irsaliye. <b>←</b> ok: boş çuval → çuval (boş çuval silinir, kayıt ve takip formu güncellenir). Şoför yoksa <b>Kayıt Et</b> ile ➕ Yeni Araç Kaydı açılır.</p>
          </div>
          <button type="button" class="ihr-save-btn" style="${btnSaveStyle}flex-shrink:0;">Kaydet</button>
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:14px;padding:10px 12px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;">
          <label for="ihracatPlateSearch" style="font-size:12px;font-weight:600;color:#475569;white-space:nowrap;">🔍 Plaka ara</label>
          <input type="text" id="ihracatPlateSearch" placeholder="03 AJH 861 veya 03AJH861…" style="flex:1;min-width:160px;max-width:280px;padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px;font-size:13px;box-sizing:border-box;" />
          <button type="button" id="ihracatPlateSearchBtn" style="padding:8px 14px;font-size:12px;background:#4f46e5;color:#fff;border:none;border-radius:8px;cursor:pointer;font-weight:600;">Ara</button>
          <button type="button" id="ihracatPlateSearchClearBtn" style="padding:8px 14px;font-size:12px;background:#e2e8f0;color:#475569;border:none;border-radius:8px;cursor:pointer;font-weight:600;">Temizle</button>
          <span id="ihracatSearchResultHint" style="font-size:12px;font-weight:600;color:#64748b;min-width:120px;"></span>
          <button type="button" id="ihracatPrintBtn" title="Ekrandaki liste (güncel miktar/ambalaj) A4 yatay yazdır" style="padding:8px 14px;font-size:12px;background:#4f46e5;color:#fff;border:none;border-radius:8px;cursor:pointer;font-weight:700;white-space:nowrap;">🖨️ Yazdır</button>
          <span style="font-size:11px;color:#64748b;">Boşluklu/boşluksuz yazım fark etmez</span>
        </div>
        ${dupPlateBannerHtml}
        ${collisionBannerHtml}
        ${modalSections}
        <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:16px;flex-wrap:wrap;">
          <button type="button" class="ihr-save-btn" style="${btnSaveStyle}">Kaydet</button>
          <button type="button" id="closeIhracatModal" style="${btnCloseStyle}">Kapat</button>
        </div>
      </div>
    </div>
  `;

  document.body.insertAdjacentHTML('beforeend', modalHtml);
  } finally {
    window.__ihracatModalVehicleMap = null;
    _ihracatHideDetailsLoading();
  }

  const modal = document.getElementById('ihracatDetailsModal');
  if (!modal || !ihracatStatusApi) return;

  modal.__ihrMeta = meta;
  modal.__ihrExcelFirmalar = excelFirmalar;
  modal.__ihracatStatusApi = ihracatStatusApi;
  const closeModal = () => modal.remove();

  const doSave = () => {
    const ok = _saveIhracatDetailsFromModal(shipments, meta);
    if (ok) {
      showToast('✅ İhracat verileri kaydedildi. Takip formunda plaka seçince güncel değerler gelir.');
      closeModal();
    } else {
      showToast('❌ Kaydetme başarısız.');
    }
  };

  modal?.querySelectorAll('.ihr-save-btn').forEach((btn) => btn.addEventListener('click', doSave));

  _ihracatBindModalPlateAdd(modal, ihracatStatusApi);

  _ihracatBindToplamLiveUpdate(modal);

  _ihracatBindCuvalTransfer(modal);

  _ihracatBindRowActions(modal, ihracatStatusApi);

  _ihracatBindTakipPanel(modal);

  _ihracatBindKayitEtAndSearch(modal);

  document.getElementById('ihracatPrintBtn')?.addEventListener('click', () => {
    _printIhracatDetailsFromModal(modal, {
      shipments,
      meta,
      ihracatStatusApi,
    });
  });

  if (window.__ihracatReopenTarget?.plate) {
    setTimeout(() => _ihracatScrollToReopenTarget(), 120);
  }

  document.getElementById('closeIhracatModal')?.addEventListener('click', closeModal);

  document.addEventListener('keydown', function escHandler(e) {
    if (e.key !== 'Escape') return;
    if (document.getElementById('excelReviewOverlay')) return;
    const takipModal = document.getElementById('takipFormuModal');
    if (takipModal && !takipModal.classList.contains('hidden')) return;
    closeModal();
    document.removeEventListener('keydown', escHandler);
  });
}
window.showIhracatDetailsModal = showIhracatDetailsModal;


