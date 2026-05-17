// issues-page.js — Şoför / Plaka Sorun Kayıtları (standalone)
(function () {
  'use strict';

  const ISSUE_STORAGE_KEY = 'driverIssuesByPlate_v1';
  const KANTAR_PREF_PREFIX = 'pref_kantar_default_v1_';

  let __issuesMapCache = null;
  let __issueCountCache = new Map();
  let __normPlateCache = new Map();

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
      const res = await fetch('/api/vehicles/lookup?plate=' + encodeURIComponent(plate));
      if (!res.ok) return;
      const vehicle = await res.json();
      if (!vehicle || !vehicle.id) return;
      const status = vehicle.rejection_status || (vehicle.rejection && vehicle.rejection.status);
      if (status !== 'rejected') return;
      await fetch('/api/vehicles/' + encodeURIComponent(vehicle.id) + '/remove-rejection', {
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
        const res = await fetch('/api/problems?plate=' + encodeURIComponent(p));
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

  
  const renderList = async (plate) => {
    const listEl = document.getElementById('issuesList');
    if (!listEl) return;

    const norm = _normPlate(plate);
    const showClosed = !!document.getElementById('issuesShowClosed')?.checked;

    // fetch helpers and API-backed rendering
    const apiFetchProblems = async (p) => {
      try {
        const q = p ? ('?plate=' + encodeURIComponent(_normPlate(p))) : '';
        const res = await fetch('/api/problems' + q);
        if (!res.ok) throw new Error('network');
        const data = await res.json();
        return Array.isArray(data) ? data : [];
      } catch (e) {
        if (!p) {
          const map = loadIssuesMap();
          const keys = Object.keys(map || {}).filter(k => Array.isArray(map[k]) && map[k].length > 0);
          const all = [];
          keys.forEach(k => { (map[k]||[]).forEach(it => all.push(Object.assign({}, it, { plate: k }))); });
          return all;
        }
        return getIssues(p).map(it => Object.assign({}, it, { plate: _normPlate(p) }));
      }
    };

    const apiAddProblem = async (p, issue) => {
      try {
        const payload = { plate: _normPlate(p), data: issue, ts: Date.now() };
        const res = await fetch('/api/problems', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        if (!res.ok) throw new Error('network');
        return (await res.json()).id;
      } catch (e) {
        addIssue(p, issue);
        return null;
      }
    };

    const apiUpdateProblem = async (id, p, issue) => {
      try {
        const payload = { plate: _normPlate(p), data: issue, ts: Date.now() };
        const res = await fetch('/api/problems/' + encodeURIComponent(id), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        if (!res.ok) throw new Error('network');
        return true;
      } catch (e) {
        return false;
      }
    };

    const apiDeleteProblem = async (id, p, idxFallback) => {
      try {
        if (id) {
          const res = await fetch('/api/problems/' + encodeURIComponent(id), { method: 'DELETE' });
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

    if (!norm) {
      const all = await apiFetchProblems('');
      if (!Array.isArray(all) || all.length === 0) {
        listEl.innerHTML = `<div style="opacity:.8">✅ Kayıtlı sorun bulunamadı.</div>`;
        return;
      }
      const grouped = {};
      all.forEach(it => {
        const p = _normPlate(it.plate || it.addedPlate || '');
        if (!p) return;
        if (!Array.isArray(grouped[p])) grouped[p] = [];
        grouped[p].push(it);
      });
      const keys = Object.keys(grouped).sort((a,b) => (grouped[b].length||0)-(grouped[a].length||0));
      listEl.innerHTML = keys.map(k => {
        const items = (grouped[k] || []).filter(it => showClosed ? true : ((it && it.status) !== 'closed'));
        const headPlate = (k || '').toUpperCase();
        const inner = items.map(it => {
          const dt = it.dateLocal || (it.data && it.data.dateLocal) || it.dateISO || (it.data && it.data.dateISO) || '';
          const dataObj = it.data && typeof it.data === 'object' ? it.data : (typeof it === 'object' ? it : {});
          const type = (dataObj.type || it.type || '').toString().replace(/</g,'&lt;').replace(/>/g,'&gt;');
          const note = (dataObj.note || it.note || '').toString().replace(/</g,'&lt;').replace(/>/g,'&gt;');
          const addedBy = (dataObj.addedBy || it.addedBy || '').toString().replace(/</g,'&lt;').replace(/>/g,'&gt;');
          const isClosed = (dataObj.status === 'closed' || it.status === 'closed');
          const hasPhoto = !!(dataObj.photo || it.photo);
          const id = it.id || '';
          const statusBadge = isClosed
            ? `<span style="background:#16a34a;color:#fff;font-weight:900;font-size:11px;padding:3px 8px;border-radius:999px;">KAPATILDI</span>`
            : `<span style="background:#ef4444;color:#fff;font-weight:900;font-size:11px;padding:3px 8px;border-radius:999px;">AÇIK</span>`;
          return `
            <div style="border:2px solid ${isClosed ? 'rgba(209,213,219,0.5)' : 'rgb(248,113,113)'};border-radius:12px;padding:12px;margin-top:10px;background:${isClosed ? 'rgb(243,244,246)' : 'white'};opacity:${isClosed ? '.75' : '1'};color:${isClosed ? 'rgb(55,65,81)' : 'black'};">
              <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start;">
                <div style="min-width:0;">
                  <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
                    <div style="font-weight:900;color:${isClosed ? 'rgb(55,65,81)' : 'black'};">⚠️ ${dt}</div>
                    ${statusBadge}
                    ${type ? `<span style="background:#334155;color:#fff;font-weight:800;font-size:11px;padding:3px 8px;border-radius:999px;">${type}</span>` : ``}
                  </div>
                  ${addedBy ? `<div style="margin-top:6px;font-size:12px;background:${isClosed ? 'rgb(229,231,235)' : 'rgb(249,250,251)'};padding:4px 8px;border-radius:6px;color:${isClosed ? 'rgb(75,85,99)' : 'rgb(55,65,81)'};">👤 Ekleyen: <b style="color:${isClosed ? 'rgb(55,65,81)' : 'black'};">${addedBy}</b></div>` : ``}
                  <div style="margin-top:6px;white-space:pre-wrap;background:${isClosed ? 'rgb(229,231,235)' : 'white'};padding:8px;border-radius:6px;border-left:4px solid ${isClosed ? 'rgb(34,197,94)' : 'rgb(239,68,68)'};color:${isClosed ? 'rgb(55,65,81)' : 'black'};">${note}</div>
                </div>
                <div style="display:flex;flex-direction:column;gap:8px;align-items:flex-end;">
                  <button class="issueEditBtn" data-plate="${k}" data-id="${id}" style="background:#374151;color:#fff;border:none;padding:8px 10px;border-radius:10px;cursor:pointer;">Düzenle</button>
                  <button class="issueToggleBtn" data-plate="${k}" data-id="${id}" style="background:${isClosed ? '#0ea5e9' : '#16a34a'};color:#fff;border:none;padding:8px 10px;border-radius:10px;cursor:pointer;">${isClosed ? 'Aç' : 'Kapat'}</button>
                  <button class="issueDelBtn" data-plate="${k}" data-id="${id}" style="background:#ef4444;color:#fff;border:none;padding:8px 10px;border-radius:10px;cursor:pointer;">Sil</button>
                </div>
              </div>
              ${hasPhoto ? `<div style="margin-top:10px;"><img src="${dataObj.photo || it.photo}" style="max-width:100%;border-radius:12px;border:1px solid rgba(255,255,255,.12)"></div>` : ``}
            </div>
          `;
        }).join('');
        return `
          <div style="border:1px solid rgba(209,213,219,0.3);border-radius:14px;padding:12px;margin-bottom:12px;background:white;">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;">
              <div style="font-weight:1000;font-size:14px;color:black;">🚗 ${headPlate}</div>
              <div style="opacity:.85;font-size:12px;color:rgb(75,85,99);">Toplam: ${items.length}</div>
            </div>
            ${inner}
          </div>
        `;
      }).join('');
      Array.from(card.querySelectorAll('.issueEditBtn')).forEach(btn=>{
        btn.addEventListener('click', async ()=>{
          const id = btn.dataset.id || '';
          const p = btn.dataset.plate || document.getElementById('issuesPlateInput')?.value || '';
          if (id) {
            try {
              const res = await fetch('/api/problems/' + encodeURIComponent(id));
              if (!res.ok) throw new Error('no');
              const cur = await res.json();
              const curData = (cur && cur.data) ? (typeof cur.data === 'object' ? cur.data : JSON.parse(cur.data)) : cur;
              const newType = prompt('Sorun Tipi:', curData.type || '');
              const newNote = prompt('Olay Notu:', curData.note || '');
              if (newNote == null) return;
              const newDate = prompt('Tarih/Saat (örn: 26.12.2025 14:30):', curData.dateLocal || '');
              const patch = Object.assign({}, curData, {
                type: String(newType || '').trim(),
                note: String(newNote || '').trim(),
                dateLocal: newDate ? String(newDate).trim() : (curData.dateLocal || ''),
                dateISO: ( ()=>{ if (!newDate) return curData.dateISO || ''; const tryD = new Date(newDate); if (!isNaN(tryD.getTime())) return tryD.toISOString(); return curData.dateISO || ''; })()
              });
              if (!patch.note) { alert('❗ Sorun notu boş olamaz.'); return; }
              await apiUpdateProblem(id, p, patch);
              renderList('');
              await syncProblemsToDriverCards(p);
              return;
            } catch(e) {
            }
          }
          const pi = btn.dataset.plate || document.getElementById('issuesPlateInput')?.value || '';
          const i = Number(btn.dataset.idx);
          const itemsNow = getIssues(pi);
          const cur = itemsNow[i] || {};
          const newType = prompt('Sorun Tipi:', cur.type || '');
          const newNote = prompt('Olay Notu:', cur.note || '');
          if (newNote == null) return;
          const newDate = prompt('Tarih/Saat (örn: 26.12.2025 14:30):', cur.dateLocal || '');
          const patch = { type: String(newType || '').trim(), note: String(newNote || '').trim(), dateLocal: newDate ? String(newDate).trim() : (cur.dateLocal || ''), dateISO: ( ()=>{ if (!newDate) return cur.dateISO || ''; const tryD = new Date(newDate); if (!isNaN(tryD.getTime())) return tryD.toISOString(); return cur.dateISO || ''; })() };
          if (!patch.note) { alert('❗ Sorun notu boş olamaz.'); return; }
          updateIssue(pi, i, patch);
          renderList('');
          await syncProblemsToDriverCards(pi);
        });
      });
      Array.from(card.querySelectorAll('.issueDelBtn')).forEach(btn=>{
        btn.addEventListener('click', async ()=>{
          const password = prompt('Silme işlemini onaylamak için şifreyi girin:');
          if (password !== '2026genper') { alert('Hatalı şifre. Silme işlemi iptal edildi.'); return; }
          const id = btn.dataset.id || '';
          const p = btn.dataset.plate || document.getElementById('issuesPlateInput')?.value || '';
          if (id) {
            await apiDeleteProblem(id, p);
            renderList('');
            await clearRejectionAndSyncCards(p);
            
            return;
          }
          const i = Number(btn.dataset.idx);
          deleteIssue(p, i);
          renderList('');
          await clearRejectionAndSyncCards(p);
        });
      });
      Array.from(card.querySelectorAll('.issueToggleBtn')).forEach(btn=>{
        btn.addEventListener('click', async ()=>{
          const id = btn.dataset.id || '';
          const p = btn.dataset.plate || document.getElementById('issuesPlateInput')?.value || '';
          if (id) {
            try {
              const res = await fetch('/api/problems/' + encodeURIComponent(id));
              if (!res.ok) throw new Error('no');
              const curRaw = await res.json();
              const cur = (curRaw && curRaw.data) ? (typeof curRaw.data === 'object' ? curRaw.data : JSON.parse(curRaw.data)) : curRaw;
              const isClosed = (cur.status === 'closed');
              const actor = (getActorName() || '').trim();
              if (isClosed) { cur.status='open'; cur.closedAtISO=''; cur.closedAtLocal=''; cur.closedBy=''; }
              else { const d=new Date(); cur.status='closed'; cur.closedAtISO=d.toISOString(); cur.closedAtLocal=d.toLocaleString('tr-TR'); cur.closedBy=actor; }
              await apiUpdateProblem(id, p, cur);
              renderList(p);
              await syncProblemsToDriverCards(p);
              return;
            } catch(e) {}
          }
          const i = Number(btn.dataset.idx);
          const itemsNow = getIssues(p);
          const cur2 = itemsNow[i] || {};
          const isClosed2 = (cur2.status === 'closed');
          const actor2 = (getActorName() || '').trim();
          if (isClosed2) {
            updateIssue(p, i, { status:'open', closedAtISO:'', closedAtLocal:'', closedBy:'' });
          } else {
            const d = new Date();
            updateIssue(p, i, { status:'closed', closedAtISO:d.toISOString(), closedAtLocal:d.toLocaleString('tr-TR'), closedBy: actor2 });
          }
          renderList(p);
          await syncProblemsToDriverCards(p);
        });
      });
      return;
    }
    const items = (await apiFetchProblems(norm)).filter(it => showClosed ? true : ((it && ((it.data && it.data.status) || it.status)) !== 'closed'));
    if (!items || items.length === 0) { 
      listEl.innerHTML = `
        <div class="text-center py-8">
          <div class="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <span class="text-3xl">✅</span>
          </div>
          <p class="text-gray-600 font-medium">Bu plakaya kayıtlı sorun yok.</p>
        </div>
      `; 
      return; 
    }
    
    listEl.innerHTML = items.map((it) => {
      const dataObj = it.data && typeof it.data === 'object' ? it.data : (typeof it.data === 'string' ? JSON.parse(it.data || '{}') : it);
      const dt = dataObj.dateLocal || dataObj.dateISO || it.dateISO || '';
      const type = (dataObj.type || '').toString().replace(/</g,'&lt;').replace(/>/g,'&gt;');
      const note = (dataObj.note || '').toString().replace(/</g,'&lt;').replace(/>/g,'&gt;');
      const addedBy = (dataObj.addedBy || '').toString().replace(/</g,'&lt;').replace(/>/g,'&gt;');
      const isClosed = (dataObj.status === 'closed' || it.status === 'closed');
      const hasPhoto = !!(dataObj.photo || it.photo);
      const id = it.id || '';
      
      const statusBadge = isClosed
        ? `<span class="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold bg-green-100 text-green-800 border border-green-200">
            <span class="w-2 h-2 bg-green-500 rounded-full mr-2"></span>
            Çözüldü
          </span>`
        : `<span class="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold bg-red-100 text-red-800 border border-red-200">
            <span class="w-2 h-2 bg-red-500 rounded-full mr-2 animate-pulse"></span>
            Açık
          </span>`;
          
      const typeIcon = {
        'Baret Takmama': '🪖',
        'Kantar Tartışması': '⚖️',
        'Sevkiyat Personeliyle Tartışma': '👥',
        'Saha Kuralına Uymama': '🚫',
        'Sıra / Yoğunluk İhlali': '📝',
        'Diğer': '📌'
      }[type] || '📌';
      
      return `
        <div class="issue-card ${isClosed ? 'issue-closed' : 'issue-open'} border-2 rounded-xl p-4 shadow-md hover:shadow-lg transition-all duration-200 mb-3">
          <!-- DEBUG: ${isClosed ? 'CLOSED' : 'OPEN'} -->
          <div class="flex justify-between items-start gap-4">
            <div class="flex-1 min-w-0">
              <!-- Header Section -->
              <div class="flex items-center gap-3 mb-3 flex-wrap">
                <div class="flex items-center gap-2">
                  <span class="text-3xl">${typeIcon}</span>
                  <div>
                    <div class="text-base font-bold ${isClosed ? 'text-gray-700' : 'text-black'}">${dt}</div>
                    <div class="text-xs ${isClosed ? 'text-gray-500' : 'text-gray-600'}">Tarih/Saat</div>
                  </div>
                </div>
                <div class="flex gap-2">
                  ${statusBadge}
                  ${type ? `<span class="inline-flex items-center px-2 py-1 rounded-full text-xs font-semibold bg-blue-100 text-blue-800 border border-blue-200">${type}</span>` : ``}
                </div>
              </div>
              
              <!-- User Info -->
              ${addedBy ? `
                <div class="flex items-center gap-2 text-sm mb-3 px-3 py-2 rounded-lg ${isClosed ? 'bg-gray-200 text-gray-600' : 'bg-gray-50 text-gray-700'}">
                  <svg class="w-4 h-4 ${isClosed ? 'text-gray-400' : 'text-gray-500'}" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"></path>
                  </svg>
                  <span class="font-medium">Ekleyen:</span>
                  <span class="font-semibold ${isClosed ? 'text-gray-800' : 'text-black'}">${addedBy}</span>
                </div>
              ` : ``}
              
              <!-- Main Content -->
              <div class="whitespace-pre-wrap mb-3 leading-relaxed text-sm font-medium p-3 rounded-lg border-l-4 ${isClosed ? 'bg-gray-200 text-gray-700 border-green-500' : 'bg-white text-black border-red-500'}">${note}</div>
              
              <!-- Status Info -->
              ${isClosed ? `
                <div class="flex items-center gap-2 text-sm text-green-700 bg-green-50 px-3 py-2 rounded-lg border border-green-200">
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                  </svg>
                  <div>
                    <div class="font-semibold">Çözüldü</div>
                    <div class="text-xs text-green-600">${dataObj.closedAtLocal || ''}${dataObj.closedBy ? ` • ${dataObj.closedBy}` : ''}</div>
                  </div>
                </div>
              ` : ``}
            </div>
            
            <!-- Action Buttons -->
            <div class="flex flex-col gap-2 min-w-[120px]">
              <button class="issueEditBtn px-3 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded-lg transition-all duration-200 text-sm font-medium flex items-center justify-center gap-1 shadow hover:shadow-md" data-plate="${norm}" data-id="${id}">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path>
                </svg>
                Düzenle
              </button>
              <button class="issueToggleBtn px-3 py-2 ${isClosed ? 'bg-blue-600 hover:bg-blue-700' : 'bg-green-600 hover:bg-green-700'} text-white rounded-lg transition-all duration-200 text-sm font-medium flex items-center justify-center gap-1 shadow hover:shadow-md" data-plate="${norm}" data-id="${id}">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  ${isClosed 
                    ? '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V2"></path>'
                    : '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path>'
                  }
                </svg>
                ${isClosed ? 'Aç' : 'Kapat'}
              </button>
              <button class="issueDelBtn px-3 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-all duration-200 text-sm font-medium flex items-center justify-center gap-1 shadow hover:shadow-md" data-plate="${norm}" data-id="${id}">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
                </svg>
                Sil
              </button>
            </div>
          </div>
          
          <!-- Photo Section -->
          ${hasPhoto ? `
            <div class="mt-4">
              <div class="text-xs font-semibold ${isClosed ? 'text-gray-600' : 'text-gray-700'} mb-1">📸 Fotoğraf</div>
              <img src="${dataObj.photo || it.photo}" alt="Sorun fotoğrafı" class="max-w-full h-auto rounded-lg border border-gray-200 shadow">
            </div>
          ` : ``}
        </div>
      `;
    }).join('');

    // Add custom CSS styles to force issue card styling
    const style = document.createElement('style');
    style.textContent = `
      .issue-card.issue-open {
        background-color: white !important;
        border-color: rgb(248 113 113) !important;
        color: black !important;
      }
      .issue-card.issue-open .text-black {
        color: black !important;
      }
      .issue-card.issue-open .bg-white {
        background-color: white !important;
        color: black !important;
      }
      .issue-card.issue-open .bg-gray-50 {
        background-color: rgb(249 250 251) !important;
        color: rgb(55 65 81) !important;
      }
      .issue-card.issue-open .text-gray-600 {
        color: rgb(55 65 81) !important;
      }
      .issue-card.issue-open .text-gray-700 {
        color: rgb(55 65 81) !important;
      }
      .issue-card.issue-open .border-red-500 {
        border-color: rgb(239 68 68) !important;
      }
      .issue-card.issue-closed {
        background-color: rgb(243 244 246) !important;
        border-color: rgb(209 213 219) !important;
        opacity: 0.75;
      }
    `;
    document.head.appendChild(style);

    // Force white background on open issue cards after a short delay
    setTimeout(() => {
      const openCards = document.querySelectorAll('.issue-card.issue-open');
      openCards.forEach(card => {
        card.style.backgroundColor = 'white !important';
        card.style.color = 'black !important';
        card.style.borderColor = 'rgb(248 113 113) !important';
        
        // Force all child elements to have correct colors
        const blackTextElements = card.querySelectorAll('.text-black, .bg-white, .text-gray-600, .text-gray-700');
        blackTextElements.forEach(el => {
          if (el.classList.contains('bg-white')) {
            el.style.backgroundColor = 'white !important';
            el.style.color = 'black !important';
          } else {
            el.style.color = 'black !important';
          }
        });
        
        // Force gray background elements
        const grayBgElements = card.querySelectorAll('.bg-gray-50');
        grayBgElements.forEach(el => {
          el.style.backgroundColor = 'rgb(249 250 251) !important';
          el.style.color = 'rgb(55 65 81) !important';
        });
      });
    }, 100);

    Array.from(card.querySelectorAll('.issueEditBtn')).forEach(btn=>{
      btn.addEventListener('click', async ()=>{
        const id = btn.dataset.id || '';
        const p = btn.dataset.plate || document.getElementById('issuesPlateInput')?.value || '';
        if (!id) { return; }
        try {
          const res = await fetch('/api/problems/' + encodeURIComponent(id));
          if (!res.ok) throw new Error('no');
          const cur = await res.json();
          const curData = (cur && cur.data) ? (typeof cur.data === 'object' ? cur.data : JSON.parse(cur.data)) : cur;
          const newType = prompt('Sorun Tipi:', curData.type || '');
          const newNote = prompt('Olay Notu:', curData.note || '');
          if (newNote == null) return;
          const newDate = prompt('Tarih/Saat (örn: 26.12.2025 14:30):', curData.dateLocal || '');
          const patch = Object.assign({}, curData, { type: String(newType || '').trim(), note: String(newNote || '').trim(), dateLocal: newDate ? String(newDate).trim() : (curData.dateLocal || ''), dateISO: ( ()=>{ if (!newDate) return curData.dateISO || ''; const tryD = new Date(newDate); if (!isNaN(tryD.getTime())) return tryD.toISOString(); return curData.dateISO || ''; })() });
          if (!patch.note) { alert('❗ Sorun notu boş olamaz.'); return; }
          await apiUpdateProblem(id, p, patch);
          renderList(p);
          await syncProblemsToDriverCards(p);
        } catch(e) {}
      });
    });
    Array.from(card.querySelectorAll('.issueDelBtn')).forEach(btn=>{
      btn.addEventListener('click', async ()=>{
        const password = prompt('Silme işlemini onaylamak için şifreyi girin:');
        if (password !== '2026genper') { alert('Hatalı şifre. Silme işlemi iptal edildi.'); return; }
        const id = btn.dataset.id || '';
        const p = btn.dataset.plate || document.getElementById('issuesPlateInput')?.value || '';
        if (!id) return;
        await apiDeleteProblem(id, p);
        renderList(p);
        await clearRejectionAndSyncCards(p);
        
      });
    });
    Array.from(card.querySelectorAll('.issueToggleBtn')).forEach(btn=>{
      btn.addEventListener('click', async ()=>{
        const id = btn.dataset.id || '';
        const p = btn.dataset.plate || document.getElementById('issuesPlateInput')?.value || '';
        if (!id) return;
        try {
          const res = await fetch('/api/problems/' + encodeURIComponent(id));
          if (!res.ok) throw new Error('no');
          const curRaw = await res.json();
          const cur = (curRaw && curRaw.data) ? (typeof curRaw.data === 'object' ? curRaw.data : JSON.parse(curRaw.data)) : curRaw;
          const isClosed = (cur.status === 'closed');
          const actor = (getActorName() || '').trim();
          if (isClosed) { cur.status='open'; cur.closedAtISO=''; cur.closedAtLocal=''; cur.closedBy=''; }
          else { const d=new Date(); cur.status='closed'; cur.closedAtISO=d.toISOString(); cur.closedAtLocal=d.toLocaleString('tr-TR'); cur.closedBy=actor; }
          await apiUpdateProblem(id, p, cur);
          renderList(p);
          await syncProblemsToDriverCards(p);
          return;
        } catch(e) {}
      });
    });
  };

  const doRefresh = () => renderList(document.getElementById('issuesPlateInput').value || '');
  card.querySelector('#issuesRefreshBtn').addEventListener('click', doRefresh);

  try { card.querySelector('#issuesShowClosed')?.addEventListener('change', doRefresh); } catch(e){}

  const clearBtn = card.querySelector('#issuesClearPlateBtn');
  if (clearBtn){
    clearBtn.addEventListener('click', ()=>{
      const p = document.getElementById('issuesPlateInput')?.value || '';
      if (!_normPlate(p)) { alert('❗ Önce plaka giriniz.'); return; }
      const confirmOk = confirm('Bu plakanın TÜM sorun kayıtları silinsin mi?');
      if (!confirmOk) return;
      const password = prompt('Tüm sorunları silmek için şifreyi girin:');
      if (password !== '2026genper') { alert('Hatalı şifre. İşlem iptal edildi.'); return; }
      // try server delete first
      (async ()=>{
        try {
          const res = await fetch('/api/problems/plate/' + encodeURIComponent(_normPlate(p)), { method: 'DELETE' });
          if (!res.ok) throw new Error('server');
        } catch(e) {
          clearIssues(p);
        }
        doRefresh();
        await clearRejectionAndSyncCards(p);
      })();
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
        const vehiclesRes = await fetch('/api/vehicles/lookup?plate=' + encodeURIComponent(plate));
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
          const rejectRes = await fetch('/api/vehicles/reject-simple', {
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
          try { notifyMainTab(plate, { rejection: true }); } catch (e) { /* ignore */ }

        } catch (error) {
          console.error('Reddetme hatası:', error);
          // Continue anyway - still save the issue
        }

        // Save issue first
        try {
          const payload = { plate: _normPlate(plate), data: issue, ts: Date.now() };
          const res = await fetch('/api/problems', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
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
          const res = await fetch('/api/problems', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
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
        const res = await fetch('/api/problems', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
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

  // Plate input event listener for driver info - SIMPLE APPROACH
  const plateInput = card.querySelector('#issuesPlateInput');
  if (plateInput) {
    plateInput.addEventListener('input', () => {
      const plate = plateInput.value.trim();
      const driverInfoEl = card.querySelector('#issuesDriverInfo');
      const driverNameEl = card.querySelector('#issuesDriverName');
      const driverPhoneEl = card.querySelector('#issuesDriverPhone');
      
      if (!plate) {
        driverInfoEl?.classList.add('hidden');
        driverNameEl.textContent = '';
        driverPhoneEl.textContent = '';
        return;
      }
      
      // Simple: try to find driver info from any available source
      try {
        let driverData = null;
        
        // Method 1: Try getVehicleByPlate function
        if (typeof getVehicleByPlate === 'function') {
          driverData = getVehicleByPlate(plate);
        }
        
        // Method 2: Try state.vehicles
        if (!driverData && window.state && window.state.vehicles) {
          const normalizedPlate = plate.toLowerCase().trim().replace(/\s+/g, '');
          driverData = window.state.vehicles.find(v => {
            if (!v || !v.cekiciPlaka) return false;
            const dbPlate = v.cekiciPlaka.toLowerCase().trim().replace(/\s+/g, '');
            return dbPlate === normalizedPlate;
          });
        }
        
        // Method 3: Try direct search in any global arrays
        if (!driverData) {
          // Check if there's a global vehicles array
          const allVehicles = window.vehicles || window.state?.vehicles || [];
          driverData = allVehicles.find(v => {
            if (!v) return false;
            const plate1 = (v.cekiciPlaka || '').toLowerCase().trim().replace(/\s+/g, '');
            const plate2 = plate.toLowerCase().trim().replace(/\s+/g, '');
            return plate1 === plate2;
          });
        }
        
        if (driverData) {
          const name = driverData.isim || driverData.adi || driverData.soforAdi || driverData.name || '';
          const phone = driverData.iletisim || driverData.telefon || driverData.phone || '';
          
          driverNameEl.textContent = name;
          driverPhoneEl.textContent = phone;
          driverInfoEl?.classList.remove('hidden');
        } else {
          driverInfoEl?.classList.add('hidden');
          driverNameEl.textContent = '';
          driverPhoneEl.textContent = '';
        }
      } catch (error) {
        driverInfoEl?.classList.add('hidden');
      }
    });
    
    // Also load driver info on Enter key press - SIMPLE
    plateInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        
        // Load real vehicle data from database
        if (!window.state) window.state = {};
        if (!window.state.vehicles) {
          // Try to load from API
          (async () => {
            try {
              const response = await fetch('/api/vehicles?limit=1000');
              if (response.ok) {
                const vehicles = await response.json();
                window.state.vehicles = vehicles;
                
                // Now search for the plate
                const plate = plateInput.value.trim();
                const driverData = vehicles.find(v => {
                  if (!v || !v.cekiciPlaka) return false;
                  const plate1 = v.cekiciPlaka.toLowerCase().trim().replace(/\s+/g, '');
                  const plate2 = plate.toLowerCase().trim().replace(/\s+/g, '');
                  return plate1 === plate2;
                });
                
                if (driverData) {
                  // Try to get full name (ad + soyad)
                  const firstName = driverData.isim || driverData.adi || driverData.soforAdi || driverData.name || '';
                  const lastName = driverData.soyisim || driverData.soyad || '';
                  const fullName = lastName ? (firstName + ' ' + lastName) : firstName;
                  
                  const phone = driverData.iletisim || driverData.telefon || driverData.phone || '';
                  
                  document.querySelector('#issuesDriverName').textContent = fullName;
                  document.querySelector('#issuesDriverPhone').textContent = phone;
                  document.querySelector('#issuesDriverInfo').classList.remove('hidden');
                }
              }
            } catch (error) {
              alert('Failed to load from database: ' + error.message);
            }
          })();
        }
        
        const plate = plateInput.value.trim();
        const driverInfoEl = card.querySelector('#issuesDriverInfo');
        const driverNameEl = card.querySelector('#issuesDriverName');
        const driverPhoneEl = card.querySelector('#issuesDriverPhone');
        
        if (!plate) {
          driverInfoEl?.classList.add('hidden');
          driverNameEl.textContent = '';
          driverPhoneEl.textContent = '';
          return;
        }
        
        // Same simple logic as input event
        try {
          let driverData = null;
          
          if (typeof getVehicleByPlate === 'function') {
            driverData = getVehicleByPlate(plate);
          }
          
          if (!driverData && window.state && window.state.vehicles) {
            const normalizedPlate = plate.toLowerCase().trim().replace(/\s+/g, '');
            driverData = window.state.vehicles.find(v => {
              if (!v || !v.cekiciPlaka) return false;
              const dbPlate = v.cekiciPlaka.toLowerCase().trim().replace(/\s+/g, '');
              return dbPlate === normalizedPlate;
            });
          }
          
          if (!driverData) {
            const allVehicles = window.vehicles || window.state?.vehicles || [];
            driverData = allVehicles.find(v => {
              if (!v) return false;
              const plate1 = (v.cekiciPlaka || '').toLowerCase().trim().replace(/\s+/g, '');
              const plate2 = plate.toLowerCase().trim().replace(/\s+/g, '');
              return plate1 === plate2;
            });
          }
          
          if (driverData) {
            const name = driverData.isim || driverData.adi || driverData.soforAdi || driverData.name || '';
            const phone = driverData.iletisim || driverData.telefon || driverData.phone || '';
            
            driverNameEl.textContent = name;
            driverPhoneEl.textContent = phone;
            driverInfoEl?.classList.remove('hidden');
          } else {
            driverInfoEl?.classList.add('hidden');
            driverNameEl.textContent = '';
            driverPhoneEl.textContent = '';
          }
        } catch (error) {
          driverInfoEl?.classList.add('hidden');
        }
      }
    });
  }

  // initial list
  doRefresh();
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
