// issues-page.js — Şoför / Plaka Sorun Kayıtları (standalone)
(function () {
  'use strict';

  const ISSUE_STORAGE_KEY = 'driverIssuesByPlate_v1';
  const KANTAR_PREF_PREFIX = 'pref_kantar_default_v1_';

  const VEHICLE_LOOKUP_BATCH = 80;

  let __issuesMapCache = null;
  let __issueCountCache = new Map();
  let __normPlateCache = new Map();
  let __vehicleMetaCache = new Map();
  let __listRenderGen = 0;

  function authHeaders(withJson) {
    const h = { 'Cache-Control': 'no-cache' };
    if (withJson) h['Content-Type'] = 'application/json';
    try {
      const token = localStorage.getItem('authToken') || '';
      if (token) h.Authorization = 'Bearer ' + token;
    } catch (e) { /* ignore */ }
    return h;
  }

  function authFetch(url, opts) {
    const o = Object.assign({ credentials: 'include' }, opts || {});
    const jsonBody = !!(o.body && typeof o.body === 'string');
    o.headers = Object.assign({}, authHeaders(jsonBody), o.headers || {});
    return fetch(url, o);
  }

  function _invalidateIssuesCache() {
    __issuesMapCache = null;
    __issueCountCache.clear();
  }

  try {
    window.addEventListener('storage', function (ev) {
      if (ev && ev.key === ISSUE_STORAGE_KEY) _invalidateIssuesCache();
    });
  } catch (e) {}

  function _normPlate(p) {
    if (typeof p !== 'string') p = String(p || '');
    if (__normPlateCache.has(p)) return __normPlateCache.get(p);
    const out = p.toLowerCase().replace(/\s+/g, '').replace(/[^a-z0-9ığüşöç]/gi, '');
    if (__normPlateCache.size > 5000) __normPlateCache.clear();
    __normPlateCache.set(p, out);
    return out;
  }

  function loadIssuesMap() {
    if (__issuesMapCache) return __issuesMapCache;
    try { __issuesMapCache = JSON.parse(localStorage.getItem(ISSUE_STORAGE_KEY) || '{}') || {}; }
    catch (e) { __issuesMapCache = {}; }
    return __issuesMapCache;
  }

  function saveIssuesMap(map) {
    try { localStorage.setItem(ISSUE_STORAGE_KEY, JSON.stringify(map || {})); } catch (e) {}
    __issuesMapCache = map || {};
    __issueCountCache.clear();
  }

  function getIssues(plate) {
    const key = _normPlate(plate);
    const map = loadIssuesMap();
    return Array.isArray(map[key]) ? map[key] : [];
  }

  function addIssue(plate, issue) {
    const key = _normPlate(plate);
    if (!key) return;
    const map = loadIssuesMap();
    if (!Array.isArray(map[key])) map[key] = [];
    map[key].unshift(issue);
    saveIssuesMap(map);
  }

  function deleteIssue(plate, idx) {
    const key = _normPlate(plate);
    const map = loadIssuesMap();
    if (!Array.isArray(map[key])) return;
    map[key].splice(idx, 1);
    saveIssuesMap(map);
  }

  function updateIssue(plate, idx, patch) {
    const key = _normPlate(plate);
    const map = loadIssuesMap();
    if (!Array.isArray(map[key])) return false;
    if (idx < 0 || idx >= map[key].length) return false;
    map[key][idx] = { ...map[key][idx], ...(patch || {}) };
    saveIssuesMap(map);
    return true;
  }

  function clearIssues(plate) {
    const key = _normPlate(plate);
    if (!key) return false;
    const map = loadIssuesMap();
    if (map && Object.prototype.hasOwnProperty.call(map, key)) {
      delete map[key];
      saveIssuesMap(map);
      return true;
    }
    return false;
  }

  function getCurrentUserIdSafe() {
    try { return String(localStorage.getItem('currentUserId') || '').trim().toUpperCase(); } catch (e) { return ''; }
  }

  function getKantarPrefKey() {
    return KANTAR_PREF_PREFIX + (getCurrentUserIdSafe() || 'GLOBAL');
  }

  function loadSavedKantarName() {
    try {
      const key = getKantarPrefKey();
      const v1 = localStorage.getItem(key);
      if (v1 && String(v1).trim()) return String(v1).trim();
      const vG = localStorage.getItem(KANTAR_PREF_PREFIX + 'GLOBAL');
      return (vG && String(vG).trim()) ? String(vG).trim() : '';
    } catch (e) { return ''; }
  }

  function getActorName() {
    return (document.getElementById('imzaKantarAd')?.value || loadSavedKantarName() || '').trim();
  }

  async function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = reject;
      r.readAsDataURL(file);
    });
  }

  async function clearRejectionForPlate(plate) {
    const norm = _normPlate(plate || '');
    if (!norm) return;
    try {
      const res = await authFetch('/api/vehicles/lookup?plate=' + encodeURIComponent(plate));
      if (!res.ok) return;
      const vehicle = await res.json();
      if (!vehicle || !vehicle.id) return;
      const status = vehicle.rejection_status || (vehicle.rejection && vehicle.rejection.status);
      if (status !== 'rejected') return;
      await authFetch('/api/vehicles/' + encodeURIComponent(vehicle.id) + '/remove-rejection', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }
      });
    } catch (e) { /* ignore */ }
  }

  function notifyMainTab(plate, extra) {
    try {
      if (window.IssuesSyncBus && typeof window.IssuesSyncBus.notify === 'function') {
        window.IssuesSyncBus.notify(Object.assign({ plate: plate ? _normPlate(String(plate)) : '' }, extra || {}));
      }
    } catch (e) { /* ignore */ }
  }

  async function syncProblemsToDriverCards(plate, extra) {
    try {
      const p = plate ? _normPlate(String(plate)) : '';
      if (p) {
        const res = await authFetch('/api/problems?plate=' + encodeURIComponent(p));
        if (res.ok) {
          const arr = await res.json();
          const open = (Array.isArray(arr) ? arr : []).filter(function (it) {
            const d = it.data && typeof it.data === 'object' ? it.data : it;
            return (d.status || it.status) !== 'closed';
          });
          if (!window.__problemsCountMap) window.__problemsCountMap = {};
          window.__problemsCountMap[p] = open.length;
        }
      }
    } catch (e) { /* ignore */ }
    notifyMainTab(plate, extra);
  }

  async function clearRejectionAndSyncCards(plate) {
    try { await clearRejectionForPlate(plate); } catch (e) { /* ignore */ }
    await syncProblemsToDriverCards(plate, { rejectionClear: true });
  }

  function nowLocal() {
    const d = new Date();
    const pad = n => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  const DELETE_PASSWORD = '2026genper';

  function vehicleToRejectionInfo(vehicle) {
    if (!vehicle) return null;
    const status = vehicle.rejection_status || (vehicle.rejection && vehicle.rejection.status);
    if (status !== 'rejected') return null;
    let endTs = vehicle.rejection_end_ts != null ? Number(vehicle.rejection_end_ts) : NaN;
    if (!Number.isFinite(endTs) && vehicle.rejection && vehicle.rejection.endTs != null) endTs = Number(vehicle.rejection.endTs);
    const hasEnd = Number.isFinite(endTs);
    if (hasEnd && Date.now() > endTs) return null;
    let startTs = vehicle.rejection_start_ts != null ? Number(vehicle.rejection_start_ts) : NaN;
    if (!Number.isFinite(startTs) && vehicle.rejection && vehicle.rejection.startTs != null) startTs = Number(vehicle.rejection.startTs);
    const duration = vehicle.rejection_duration || (vehicle.rejection && vehicle.rejection.duration) || 'Reddedildi';
    return {
      duration,
      endTs: hasEnd ? endTs : null,
      startTs: Number.isFinite(startTs) ? startTs : null,
      rejectedAtLocal: Number.isFinite(startTs) ? new Date(startTs).toLocaleString('tr-TR') : ''
    };
  }

  function vehicleToDriverInfo(vehicle) {
    if (!vehicle) return null;
    const first = String(vehicle.soforAdi || vehicle.isim || vehicle.adi || vehicle.name || '').trim();
    const last = String(vehicle.soforSoyadi || vehicle.soyisim || vehicle.soyad || '').trim();
    const name = [first, last].filter(Boolean).join(' ');
    const phone = String(vehicle.iletisim || vehicle.telefon || vehicle.phone || '').trim();
    if (!name && !phone) return null;
    return { name, phone };
  }

  function formatDriverBlockHTML(driver) {
    if (!driver || (!driver.name && !driver.phone)) return '';
    const namePart = driver.name
      ? `<span class="issue-record-card__driver-name">${escHtml(driver.name)}</span>`
      : '';
    const phonePart = driver.phone
      ? `<span class="issue-record-card__driver-phone">${escHtml(driver.phone)}</span>`
      : '';
    return `<div class="issue-record-card__driver">${namePart}${phonePart}</div>`;
  }

  function formatNoteHTML(note) {
    const raw = String(note || '').trim();
    if (!raw) return '<p class="issue-record-card__note issue-record-card__note--empty">—</p>';
    const escaped = escHtml(raw);
    const linked = escaped.replace(
      /(https?:\/\/[^\s<]+)/gi,
      '<a href="$1" target="_blank" rel="noopener noreferrer" class="issue-record-card__link">Bağlantıyı aç</a>'
    );
    return `<p class="issue-record-card__note">${linked}</p>`;
  }

  function applyVehicleToMetaMaps(plateNorm, vehicle, rejectionMap, driverMap) {
    if (!plateNorm || !vehicle) return;
    const rej = vehicleToRejectionInfo(vehicle);
    if (rej) rejectionMap.set(plateNorm, rej);
    const drv = vehicleToDriverInfo(vehicle);
    if (drv) driverMap.set(plateNorm, drv);
    __vehicleMetaCache.set(plateNorm, { rejection: rej, driver: drv });
  }

  async function loadVehicleMetaForPlates(plates) {
    const rejectionMap = new Map();
    const driverMap = new Map();
    const unique = [...new Set((plates || []).map((p) => _normPlate(p)).filter(Boolean))];
    const missing = [];
    unique.forEach((p) => {
      const cached = __vehicleMetaCache.get(p);
      if (cached) {
        if (cached.rejection) rejectionMap.set(p, cached.rejection);
        if (cached.driver) driverMap.set(p, cached.driver);
      } else {
        missing.push(p);
      }
    });
    for (let i = 0; i < missing.length; i += VEHICLE_LOOKUP_BATCH) {
      const chunk = missing.slice(i, i + VEHICLE_LOOKUP_BATCH);
      try {
        const res = await authFetch('/api/vehicles/lookup-batch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ plates: chunk })
        });
        if (!res.ok) throw new Error('batch');
        const map = await res.json();
        chunk.forEach((p) => {
          applyVehicleToMetaMaps(p, map && map[p], rejectionMap, driverMap);
        });
      } catch (e) {
        await Promise.all(chunk.map(async (p) => {
          try {
            const res = await authFetch('/api/vehicles/lookup?plate=' + encodeURIComponent(p));
            if (!res.ok) return;
            const vehicle = await res.json();
            applyVehicleToMetaMaps(p, vehicle, rejectionMap, driverMap);
          } catch (err) { /* ignore */ }
        }));
      }
    }
    return { rejectionMap, driverMap };
  }

  function issuesLoadingHTML() {
    return `
      <div class="issues-history-loading" role="status" aria-live="polite">
        <span class="issues-history-loading__spinner" aria-hidden="true"></span>
        <span>Kayıtlar yükleniyor…</span>
      </div>
    `;
  }

  function issueSnapshotRejection(parsed) {
    if (!parsed || (!parsed.rejectionApplied && !parsed.rejectionDuration)) return null;
    return {
      duration: parsed.rejectionDuration || 'Reddedildi',
      endTs: parsed.rejectionEndTs != null && Number.isFinite(Number(parsed.rejectionEndTs)) ? Number(parsed.rejectionEndTs) : null,
      startTs: null,
      rejectedAtLocal: parsed.rejectedAtLocal || ''
    };
  }

  function resolveRejectionForCard(parsed, plate, plateRejectionMap) {
    return issueSnapshotRejection(parsed) || (plateRejectionMap && plateRejectionMap.get(_normPlate(plate))) || null;
  }

  function formatRejectionHTML(info) {
    if (!info) return '';
    const duration = escHtml(info.duration || 'Reddedildi');
    const rejectedAt = info.rejectedAtLocal
      ? escHtml(info.rejectedAtLocal)
      : (info.startTs ? escHtml(new Date(info.startTs).toLocaleString('tr-TR')) : '');
    let endLine = '';
    if (info.endTs) {
      const end = new Date(info.endTs);
      endLine = `<div class="issue-record-rejection__line"><span>Red bitiş:</span> ${escHtml(end.toLocaleDateString('tr-TR'))} ${escHtml(end.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }))}</div>`;
    } else if (/süresiz/i.test(String(info.duration || ''))) {
      endLine = '<div class="issue-record-rejection__line"><span>Red bitiş:</span> Süresiz</div>';
    }
    return `
      <div class="issue-record-rejection">
        <div class="issue-record-rejection__title">Araç reddedildi</div>
        <div class="issue-record-rejection__line"><span>Red süresi:</span> ${duration}</div>
        ${rejectedAt ? `<div class="issue-record-rejection__line"><span>Reddedildi:</span> ${rejectedAt}</div>` : ''}
        ${endLine}
      </div>
    `;
  }

  function getRpUi() {
    return (window.rpUi && window.rpDialog && window.rpDialog._ready) ? window.rpUi : null;
  }

  async function editIssueViaPrompt(curData) {
    const ui = getRpUi() || window.rpUi;

    const ok = await ui.confirm('Bu kaydı düzenlemek istiyor musunuz?', { okLabel: 'Düzenle', cancelLabel: 'İptal' });
    if (!ok) return null;

    const newNote = await ui.prompt('Olay notu:', {
      type: 'reason',
      defaultValue: curData.note || '',
      placeholder: 'Olay açıklaması'
    });
    if (newNote === null || newNote === false) return null;
    if (!String(newNote).trim()) {
      await ui.alert('Sorun notu boş olamaz.', 'danger');
      return null;
    }

    const newType = await ui.prompt('Sorun tipi:', {
      type: 'info',
      defaultValue: curData.type || '',
      placeholder: 'Örn: Kantar tartışması'
    });
    if (newType === null || newType === false) return null;

    const newDate = await ui.prompt('Tarih / saat:', {
      type: 'info',
      defaultValue: curData.dateLocal || '',
      placeholder: '14.05.2026 04:12:00'
    });
    if (newDate === null || newDate === false) return null;

    return Object.assign({}, curData, {
      type: String(newType || '').trim(),
      note: String(newNote || '').trim(),
      dateLocal: newDate ? String(newDate).trim() : (curData.dateLocal || ''),
      dateISO: (() => {
        if (!newDate) return curData.dateISO || '';
        const tryD = new Date(newDate);
        if (!isNaN(tryD.getTime())) return tryD.toISOString();
        return curData.dateISO || '';
      })()
    });
  }

  async function confirmDeleteIssue() {
    const ui = getRpUi() || window.rpUi;
    if (ui && typeof ui.confirmSecureDelete === 'function') {
      const r = await ui.confirmSecureDelete({
        message: 'Bu kaydı silmek istediğinize emin misiniz?',
        passwordMessage: 'Silme işlemini onaylamak için şifreyi girin:',
        okLabel: 'Sil'
      });
      return !!r.ok;
    }
    if (!(await confirm('Bu kaydı silmek istediğinize emin misiniz?'))) return false;
    const password = await window.rpUi.password('Silme işlemini onaylamak için şifreyi girin:');
    if (password === null) return false;
    if (password !== DELETE_PASSWORD) {
      alert('Hatalı şifre. Silme işlemi iptal edildi.');
      return false;
    }
    return true;
  }

  function escHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function parseIssueItem(it) {
    let dataObj = {};
    if (it.data && typeof it.data === 'object') dataObj = it.data;
    else if (typeof it.data === 'string') {
      try { dataObj = JSON.parse(it.data || '{}'); } catch (e) { dataObj = {}; }
    } else if (typeof it === 'object') dataObj = it;
    return {
      id: it.id || '',
      plate: _normPlate(it.plate || it.addedPlate || ''),
      dt: dataObj.dateLocal || dataObj.dateISO || it.dateISO || '',
      type: dataObj.type || it.type || '',
      note: dataObj.note || it.note || '',
      addedBy: dataObj.addedBy || it.addedBy || '',
      isClosed: dataObj.status === 'closed' || it.status === 'closed',
      hasPhoto: !!(dataObj.photo || it.photo),
      photo: dataObj.photo || it.photo || '',
      closedAtLocal: dataObj.closedAtLocal || '',
      closedBy: dataObj.closedBy || '',
      rejectionApplied: !!(dataObj.rejectionApplied || dataObj.rejectionDuration),
      rejectionDuration: dataObj.rejectionDuration || '',
      rejectionEndTs: dataObj.rejectionEndTs != null ? Number(dataObj.rejectionEndTs) : null,
      rejectedAtLocal: dataObj.rejectedAtLocal || ''
    };
  }

  function renderIssueCardHTML(parsed, plateKey, opts) {
    const showPlate = !!(opts && opts.showPlate);
    const k = escHtml(plateKey || parsed.plate);
    const plateLabel = escHtml(String(plateKey || parsed.plate || '').toUpperCase());
    const { id, dt, type, note, isClosed, hasPhoto, photo, closedAtLocal, closedBy } = parsed;
    const cardCls = isClosed
      ? 'vehicle-card issue-record-card issue-record-card--closed'
      : 'vehicle-card vehicle-card--issues issue-record-card';
    const statusBadge = isClosed
      ? '<span class="issue-record-badge issue-record-badge--closed">Kapatıldı</span>'
      : '<span class="issue-record-badge issue-record-badge--open">Açık</span>';
    const typeBadge = type
      ? `<span class="issue-record-badge issue-record-badge--type">${escHtml(type)}</span>`
      : '';
    const closedMeta = (isClosed && (closedAtLocal || closedBy))
      ? `<div class="issue-record-card__closed-meta">
          <span class="vehicle-card__label">Kapanış</span>
          <span>${escHtml(closedAtLocal)}${closedBy ? ' · ' + escHtml(closedBy) : ''}</span>
        </div>`
      : '';
    const driverHTML = formatDriverBlockHTML(opts && opts.driver);
    const identityPrimary = showPlate && plateLabel
      ? `<span class="vehicle-card__plate">${plateLabel}</span>`
      : `<span class="issue-record-card__datetime">${escHtml(dt) || '—'}</span>`;
    const dateMeta = showPlate
      ? `<div class="issue-record-card__meta">
          <span class="issue-record-card__meta-label">Tarih</span>
          <time>${escHtml(dt) || '—'}</time>
        </div>`
      : '';
    const rejectionHTML = formatRejectionHTML(opts && opts.rejection);
    const photoHTML = hasPhoto
      ? `<a class="issue-record-card__photo-thumb" href="${escHtml(photo)}" target="_blank" rel="noopener noreferrer" title="Fotoğrafı aç">
          <img src="${escHtml(photo)}" alt="Sorun fotoğrafı" loading="lazy">
        </a>`
      : '';
    const contentCls = hasPhoto
      ? 'issue-record-card__content issue-record-card__content--with-photo'
      : 'issue-record-card__content';

    return `
      <article class="${cardCls}">
        <header class="vehicle-card__header issue-record-card__header">
          <div class="issue-record-card__top">
            <div class="issue-record-card__identity">
              ${identityPrimary}
              ${driverHTML}
            </div>
            <div class="issue-record-card__badges">
              ${statusBadge}
              ${typeBadge}
            </div>
          </div>
        </header>
        <div class="issue-record-card__body">
          ${dateMeta}
          ${rejectionHTML}
          <div class="${contentCls}">
            <div class="issue-record-card__note-block">
              <span class="vehicle-card__label">Olay notu</span>
              ${formatNoteHTML(note)}
            </div>
            ${photoHTML}
          </div>
          ${closedMeta}
        </div>
        <footer class="vehicle-card__footer">
          <div class="vehicle-card__toolbar">
            <button type="button" class="vehicle-card__tool vehicle-card__tool--primary issueEditBtn" data-plate="${k}" data-id="${escHtml(id)}">Düzenle</button>
            <button type="button" class="vehicle-card__tool issueToggleBtn" data-plate="${k}" data-id="${escHtml(id)}">${isClosed ? 'Aç' : 'Kapat'}</button>
            <button type="button" class="vehicle-card__tool vehicle-card__tool--danger issueDelBtn" data-plate="${k}" data-id="${escHtml(id)}">Sil</button>
          </div>
        </footer>
      </article>
    `;
  }

  function issuesEmptyHTML(message) {
    return `
      <div class="issues-empty">
        <div class="issues-empty__icon" aria-hidden="true">✅</div>
        <p>${escHtml(message)}</p>
      </div>
    `;
  }

  function attachIssueCardHandlers(listRoot, handlers) {
    const root = listRoot || document.getElementById('issuesList');
    if (!root || !handlers || root._issuesDelegated) return;
    root._issuesDelegated = true;
    const { apiUpdateProblem, apiDeleteProblem, refreshList } = handlers;

    root.addEventListener('click', async (e) => {
      const btn = e.target.closest('.issueEditBtn, .issueDelBtn, .issueToggleBtn');
      if (!btn || !root.contains(btn)) return;

      if (btn.classList.contains('issueEditBtn')) {
        const id = btn.dataset.id || '';
        const p = btn.dataset.plate || document.getElementById('issuesPlateInput')?.value || '';
        if (id) {
          try {
            const res = await authFetch('/api/problems/' + encodeURIComponent(id));
            if (!res.ok) throw new Error('no');
            const cur = await res.json();
            const curData = (cur && cur.data) ? (typeof cur.data === 'object' ? cur.data : JSON.parse(cur.data)) : cur;
            const patch = await editIssueViaPrompt(curData);
            if (!patch) return;
            await apiUpdateProblem(id, p, patch);
            refreshList(p);
            await syncProblemsToDriverCards(p);
            return;
          } catch (err) { /* fallback */ }
        }
        const pi = btn.dataset.plate || document.getElementById('issuesPlateInput')?.value || '';
        const i = Number(btn.dataset.idx);
        const itemsNow = getIssues(pi);
        const cur = itemsNow[i] || {};
        const patch = await editIssueViaPrompt(cur);
        if (!patch) return;
        updateIssue(pi, i, patch);
        refreshList(pi);
        await syncProblemsToDriverCards(pi);
        return;
      }

      if (btn.classList.contains('issueDelBtn')) {
        if (!(await confirmDeleteIssue())) return;
        const id = btn.dataset.id || '';
        const p = btn.dataset.plate || document.getElementById('issuesPlateInput')?.value || '';
        if (id) {
          await apiDeleteProblem(id, p);
          refreshList(p);
          await clearRejectionAndSyncCards(p);
          return;
        }
        const i = Number(btn.dataset.idx);
        deleteIssue(p, i);
        refreshList(p);
        await clearRejectionAndSyncCards(p);
        return;
      }

      if (btn.classList.contains('issueToggleBtn')) {
        const id = btn.dataset.id || '';
        const p = btn.dataset.plate || document.getElementById('issuesPlateInput')?.value || '';
        if (id) {
          try {
            const res = await authFetch('/api/problems/' + encodeURIComponent(id));
            if (!res.ok) throw new Error('no');
            const curRaw = await res.json();
            const cur = (curRaw && curRaw.data) ? (typeof curRaw.data === 'object' ? curRaw.data : JSON.parse(curRaw.data)) : curRaw;
            const isClosed = (cur.status === 'closed');
            const actor = (getActorName() || '').trim();
            if (isClosed) {
              cur.status = 'open';
              cur.closedAtISO = '';
              cur.closedAtLocal = '';
              cur.closedBy = '';
            } else {
              const d = new Date();
              cur.status = 'closed';
              cur.closedAtISO = d.toISOString();
              cur.closedAtLocal = d.toLocaleString('tr-TR');
              cur.closedBy = actor;
            }
            await apiUpdateProblem(id, p, cur);
            refreshList(p);
            await syncProblemsToDriverCards(p);
            return;
          } catch (e) { /* fallback */ }
        }
        const i = Number(btn.dataset.idx);
        const itemsNow = getIssues(p);
        const cur2 = itemsNow[i] || {};
        const isClosed2 = (cur2.status === 'closed');
        const actor2 = (getActorName() || '').trim();
        if (isClosed2) {
          updateIssue(p, i, { status: 'open', closedAtISO: '', closedAtLocal: '', closedBy: '' });
        } else {
          const d = new Date();
          updateIssue(p, i, { status: 'closed', closedAtISO: d.toISOString(), closedAtLocal: d.toLocaleString('tr-TR'), closedBy: actor2 });
        }
        refreshList(p);
        await syncProblemsToDriverCards(p);
      }
    });
  }

  function filterAndSortProblems(all, showClosed) {
    return (Array.isArray(all) ? all : [])
      .filter((it) => {
        const parsed = parseIssueItem(it);
        if (!_normPlate(parsed.plate || it.plate || it.addedPlate || '')) return false;
        return showClosed ? true : !parsed.isClosed;
      })
      .sort((a, b) => {
        const da = parseIssueItem(a);
        const db = parseIssueItem(b);
        const ta = Date.parse(da.dt) || (da.dt ? new Date(da.dt).getTime() : 0) || 0;
        const tb = Date.parse(db.dt) || (db.dt ? new Date(db.dt).getTime() : 0) || 0;
        return tb - ta;
      });
  }

  function renderProblemsGridHTML(items, meta, opts) {
    const showPlate = !!(opts && opts.showPlate);
    return `<div class="issues-list-grid">${items.map((it) => {
      const parsed = parseIssueItem(it);
      const plateKey = _normPlate(it.plate || it.addedPlate || parsed.plate);
      const rejection = resolveRejectionForCard(parsed, plateKey, meta.rejectionMap);
      const driver = meta.driverMap.get(plateKey) || null;
      return renderIssueCardHTML(parsed, plateKey, {
        showPlate,
        rejection,
        driver: showPlate ? driver : (opts && opts.driver) || driver
      });
    }).join('')}</div>`;
  }

  function initIssuesPage(plateOrEmpty) {
    const initialPlate = (plateOrEmpty || '').trim();
    const card = document.getElementById('issuesPageRoot');
    if (!card) return;

    const plateInputEl = card.querySelector('#issuesPlateInput');
    if (plateInputEl && initialPlate) plateInputEl.value = initialPlate;
    const dateInputEl = card.querySelector('#issuesDateInput');
    if (dateInputEl) dateInputEl.value = nowLocal();

  const goHome = () => {
    try {
      if (window.SessionManager && typeof window.SessionManager.navigateToHome === 'function') {
        window.SessionManager.navigateToHome();
      } else {
        location.href = 'GIRIS.html';
      }
    } catch (e) {}
  };
  document.getElementById('issuesCloseBtn')?.addEventListener('click', goHome);
  document.getElementById('backBtn')?.addEventListener('click', goHome);
  // Remove overlay click listener to prevent accidental closing
  // overlay.addEventListener('click', (e)=>{ if (e.target === overlay) close(); });

  // ✅ Sorun tipi şablonları (daha resmi dil)
  const ISSUE_TEMPLATES = {
    'Baret Takmama': 'Sahada baretsiz gezmekte, yapılan uyarılara rağmen kişisel koruyucu donanım kurallarına uymamaktadır.',
    'Kantar Tartışması': 'Kantar giriş/çıkış süreçlerinde personele yönelik uygunsuz üslup kullanarak tartışmaya girmektedir.',
    'Sevkiyat Personeliyle Tartışma': 'Sevkiyat personelinin yönlendirmelerine uymayarak tartışmaya girmektedir.',
    'Saha Kuralına Uymama': 'Saha düzeni ve işleyiş kurallarına riayet etmemekte, yapılan uyarılara rağmen kurallara uymamaktadır.',
    'Sıra / Yoğunluk İhlali': 'Sahada yoğunluk oluşmaması için belirlenen sıra/düzen uygulamasına uymayarak akışı olumsuz etkilemektedir.',
    'Diğer': ''
  };

  // Tip seçilince notu otomatik doldur (kullanıcı isterse düzenler)
  const typeSel = card.querySelector('#issuesTypeSelect');
  const noteInp = card.querySelector('#issuesNoteInput');
  if (typeSel && noteInp) {
    typeSel.addEventListener('change', ()=>{
      const t = String(typeSel.value || '');
      const tmpl = ISSUE_TEMPLATES[t] || '';
      if (tmpl) noteInp.value = tmpl;
    });
  }

  // Reddetme formu functionality
  const rejectionDurationSelect = card.querySelector('#rejectionDurationSelect');
  const customDaysContainer = card.querySelector('#customDaysContainer');
  const customDaysInput = card.querySelector('#customDaysInput');
  const rejectionSaveBtn = card.querySelector('#rejectionSaveBtn');
  const rejectionMsg = card.querySelector('#rejectionMsg');

  // Süre seçilince özel gün alanını göster/gizle
  if (rejectionDurationSelect && customDaysContainer) {
    rejectionDurationSelect.addEventListener('change', () => {
      const value = rejectionDurationSelect.value;
      if (value === 'custom') {
        customDaysContainer.classList.remove('hidden');
      } else {
        customDaysContainer.classList.add('hidden');
      }
    });
  }

  const apiFetchProblems = async (p) => {
    const q = p ? ('?plate=' + encodeURIComponent(_normPlate(p))) : '';
    const res = await authFetch('/api/problems' + q);
    if (!res.ok) {
      const err = new Error('problems_fetch_failed');
      err.status = res.status;
      throw err;
    }
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  };

  const apiUpdateProblem = async (id, p, issue) => {
    try {
      const payload = { plate: _normPlate(p), data: issue, ts: Date.now() };
      const res = await authFetch('/api/problems/' + encodeURIComponent(id), { method: 'PUT', body: JSON.stringify(payload) });
      if (!res.ok) throw new Error('network');
      return true;
    } catch (e) {
      return false;
    }
  };

  const apiDeleteProblem = async (id, p, idxFallback) => {
    try {
      if (id) {
        const res = await authFetch('/api/problems/' + encodeURIComponent(id), { method: 'DELETE' });
        if (!res.ok) throw new Error('network');
        return true;
      }
    } catch (e) {
      if (p !== undefined && idxFallback !== undefined) {
        deleteIssue(p, idxFallback);
        return true;
      }
    }
    return false;
  };

  const issueHandlers = {
    apiUpdateProblem,
    apiDeleteProblem,
    refreshList: (p) => renderList(p !== undefined && p !== null ? p : (document.getElementById('issuesPlateInput')?.value || ''))
  };

  const renderList = async (plate) => {
    const listEl = document.getElementById('issuesList');
    if (!listEl) return;

    const norm = _normPlate(plate);
    const showClosed = true;
    const gen = ++__listRenderGen;
    listEl.innerHTML = issuesLoadingHTML();

    try {
      if (!norm) {
        const all = await apiFetchProblems('');
        if (gen !== __listRenderGen) return;

        const filteredAll = filterAndSortProblems(all, showClosed);
        if (!filteredAll.length) {
          listEl.innerHTML = issuesEmptyHTML('Kayıtlı sorun bulunamadı.');
          return;
        }

        const platesAll = filteredAll.map((it) => _normPlate(it.plate || it.addedPlate || parseIssueItem(it).plate));
        const metaAll = await loadVehicleMetaForPlates(platesAll);
        if (gen !== __listRenderGen) return;

        listEl.innerHTML = renderProblemsGridHTML(filteredAll, metaAll, { showPlate: true });
        if (!listEl._issuesDelegated) attachIssueCardHandlers(listEl, issueHandlers);
        return;
      }

      const items = filterAndSortProblems(await apiFetchProblems(norm), showClosed);
      if (gen !== __listRenderGen) return;
      if (!items.length) {
        listEl.innerHTML = issuesEmptyHTML('Bu plakaya kayıtlı sorun yok.');
        return;
      }

      const meta = await loadVehicleMetaForPlates([norm]);
      if (gen !== __listRenderGen) return;
      const driverForPlate = meta.driverMap.get(_normPlate(norm)) || null;
      listEl.innerHTML = renderProblemsGridHTML(items, meta, { showPlate: false, driver: driverForPlate });
      if (!listEl._issuesDelegated) attachIssueCardHandlers(listEl, issueHandlers);
    } catch (e) {
      if (gen !== __listRenderGen) return;
      const msg = (e && e.status === 401)
        ? 'Oturum süresi dolmuş olabilir. Ana sayfadan tekrar giriş yapın.'
        : 'Kayıtlar sunucudan alınamadı. Sayfayı yenileyin veya tekrar giriş yapın.';
      listEl.innerHTML = issuesEmptyHTML(msg);
    }
  };


  const doRefresh = () => renderList(document.getElementById('issuesPlateInput')?.value || '');

  async function updateDriverPanel(plate) {
    const driverInfoEl = card.querySelector('#issuesDriverInfo');
    const emptyEl = card.querySelector('#issuesDriverEmpty');
    const contentEl = card.querySelector('#issuesDriverContent');
    const nameEl = card.querySelector('#issuesDriverName');
    const phoneEl = card.querySelector('#issuesDriverPhone');
    if (!driverInfoEl) return;

    if (!_normPlate(plate)) {
      driverInfoEl.classList.remove('is-loaded');
      emptyEl?.classList.remove('hidden');
      contentEl?.classList.add('hidden');
      if (nameEl) nameEl.textContent = '';
      if (phoneEl) phoneEl.textContent = '';
      return;
    }

    try {
      const res = await authFetch('/api/vehicles/lookup?plate=' + encodeURIComponent(plate.trim()));
      if (res.ok) {
        const vehicle = await res.json();
        const drv = vehicleToDriverInfo(vehicle);
        if (drv && (drv.name || drv.phone)) {
          if (nameEl) nameEl.textContent = drv.name || '—';
          if (phoneEl) phoneEl.textContent = drv.phone || '—';
          emptyEl?.classList.add('hidden');
          contentEl?.classList.remove('hidden');
          driverInfoEl.classList.add('is-loaded');
          return;
        }
      }
    } catch (e) { /* ignore */ }

    driverInfoEl.classList.remove('is-loaded');
    emptyEl?.classList.add('hidden');
    contentEl?.classList.remove('hidden');
    if (nameEl) nameEl.textContent = 'Kayıt bulunamadı';
    if (phoneEl) phoneEl.textContent = '';
  }

  let plateDebounceTimer = null;
  function schedulePlateRefresh(plate) {
    clearTimeout(plateDebounceTimer);
    plateDebounceTimer = setTimeout(async () => {
      await updateDriverPanel(plate);
      doRefresh();
    }, 200);
  }

  async function loadHistoryNow(plate) {
    await updateDriverPanel(plate);
    await doRefresh();
  }

  const clearBtn = card.querySelector('#issuesClearPlateBtn');
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      const plateInput = document.getElementById('issuesPlateInput');
      if (plateInput) plateInput.value = '';
      schedulePlateRefresh('');
    });
  }

  card.querySelector('#issuesAddBtn').addEventListener('click', async ()=>{
    const plate = document.getElementById('issuesPlateInput').value || '';
    const note  = (document.getElementById('issuesNoteInput').value || '').trim();
    const dateV = document.getElementById('issuesDateInput').value || '';
    const msgEl = document.getElementById('issuesAddMsg');

    if (!_normPlate(plate)) { msgEl.textContent = '❗ Plaka boş olamaz.'; return; }
    if (!note) { msgEl.textContent = '❗ Sorun notu yaz.'; return; }

    let photo = '';
    const file = document.getElementById('issuesPhotoInput')?.files?.[0];
    if (file) {
      try { photo = await fileToDataUrl(file); } catch(e){ photo=''; }
    }

    const d = dateV ? new Date(dateV) : new Date();
    const type = (document.getElementById('issuesTypeSelect')?.value || '').trim();
    const addedBy = (getActorName() || '').trim();
    const issue = {
      type,
      note,
      photo,
      addedBy,
      status: 'open',
      closedAtISO: '',
      closedAtLocal: '',
      closedBy: '',
      dateISO: d.toISOString(),
      dateLocal: d.toLocaleString('tr-TR')
    };
    
    // Check if rejection is selected
    const rejectionDuration = document.getElementById('rejectionDurationSelect')?.value || '';
    const customDays = document.getElementById('customDaysInput')?.value || '';
    
    if (rejectionDuration) {
      // Handle rejection
      try {
        // Use the same vehicle finding logic as the driver info
        const vehiclesRes = await authFetch('/api/vehicles/lookup?plate=' + encodeURIComponent(plate));
        if (!vehiclesRes.ok) throw new Error('Araçlar alınamadı');
        const vehicle = await vehiclesRes.json();
        if (!vehicle) {
          msgEl.textContent = '❗ Araç bulunamadı.';
          return;
        }

        // Reject vehicle - use direct API call without complex authentication
        const rejectionData = { 
          id: vehicle.id,
          duration: rejectionDuration, 
          customDays: rejectionDuration === 'custom' ? Number(customDays) : undefined 
        };
        
        console.log('Reddetme işlemi başlıyor:', rejectionData);
        
        let rejectionSyncPayload = null;
        try {
          const rejectRes = await authFetch('/api/vehicles/reject-simple', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(rejectionData)
          });

          if (!rejectRes.ok) {
            console.error('Reddetme API hatası:', rejectRes.status);
            throw new Error('Reddetme başarısız');
          }

          rejectionSyncPayload = await rejectRes.json();
          console.log('Reddetme başarılı:', rejectionSyncPayload);
          issue.rejectionApplied = true;
          issue.rejectionDuration = (rejectionSyncPayload && rejectionSyncPayload.duration) || '';
          issue.rejectionEndTs = (rejectionSyncPayload && rejectionSyncPayload.endTs != null) ? rejectionSyncPayload.endTs : null;
          issue.rejectedAtLocal = new Date().toLocaleString('tr-TR');
          try { notifyMainTab(plate, { rejection: true }); } catch (e) { /* ignore */ }

        } catch (error) {
          console.error('Reddetme hatası:', error);
          // Continue anyway - still save the issue
        }

        // Save issue first
        try {
          const payload = { plate: _normPlate(plate), data: issue, ts: Date.now() };
          const res = await authFetch('/api/problems', { method: 'POST', body: JSON.stringify(payload) });
          if (!res.ok) throw new Error('server');
        } catch(e) {
          addIssue(plate, issue);
        }

        msgEl.textContent = '✅ Sorun kaydedildi ve araç reddedildi!';
        
        // Clear rejection form
        document.getElementById('rejectionDurationSelect').value = '';
        document.getElementById('customDaysInput').value = '';
        document.getElementById('customDaysContainer').classList.add('hidden');
        
      } catch (error) {
        console.error('Reddetme hatası:', error);
        // If rejection fails, still save the issue
        try {
          const payload = { plate: _normPlate(plate), data: issue, ts: Date.now() };
          const res = await authFetch('/api/problems', { method: 'POST', body: JSON.stringify(payload) });
          if (!res.ok) throw new Error('server');
        } catch(e) {
          addIssue(plate, issue);
        }
        msgEl.textContent = '✅ Sorun kaydedildi. (Reddetme başarısız)';
      }
    } else {
      // Save issue normally
      try {
        const payload = { plate: _normPlate(plate), data: issue, ts: Date.now() };
        const res = await authFetch('/api/problems', { method: 'POST', body: JSON.stringify(payload) });
        if (!res.ok) throw new Error('server');
      } catch(e) {
        addIssue(plate, issue);
      }
      msgEl.textContent = '✅ Kaydedildi.';
    }
    
    // Clear form
    document.getElementById('issuesNoteInput').value = '';
    try { document.getElementById('issuesTypeSelect').value = ''; } catch(e){}
    document.getElementById('issuesPhotoInput').value = '';
    
    // Refresh
    doRefresh();
    await syncProblemsToDriverCards(plate, rejectionDuration ? { rejection: true } : {});
  });

  const plateInput = card.querySelector('#issuesPlateInput');
  if (plateInput) {
    plateInput.addEventListener('input', () => {
      schedulePlateRefresh(plateInput.value.trim());
    });
    plateInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        clearTimeout(plateDebounceTimer);
        schedulePlateRefresh(plateInput.value.trim());
      }
    });
  }

  void loadHistoryNow(plateInputEl?.value?.trim() || initialPlate);
  }

  function getPlateFromQuery() {
    try {
      const q = new URLSearchParams(location.search);
      return (q.get('plate') || q.get('plaka') || '').trim();
    } catch (e) { return ''; }
  }

  async function boot() {
    if (window.SessionManager && typeof window.SessionManager.requireValidSession === 'function') {
      const ok = await window.SessionManager.requireValidSession();
      if (!ok) return;
    }
    const kantarEl = document.getElementById('imzaKantarAd');
    if (kantarEl) {
      const saved = loadSavedKantarName();
      if (saved && !(kantarEl.value || '').trim()) kantarEl.value = saved;
    }
    initIssuesPage(getPlateFromQuery());
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
