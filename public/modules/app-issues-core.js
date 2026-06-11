// app-issues-core.js — plaka sorun kayıtları
// Otomatik bölüm — scripts/split-large-files.js

/* ===============================
   ⚠️ ŞOFÖR / PLAKA SORUN KAYDI
   - Plaka girince otomatik uyarı
   - Tarih + not + opsiyonel foto
================================ */

const ISSUE_STORAGE_KEY = 'driverIssuesByPlate_v1';

// ⚡ Performans: localStorage'dan sürekli okuma yerine bellekte cache tut.
// Her tuşa basışta filterVehicles() + her kart render'ı getIssueCount'u defalarca
// çağırıyor; her çağrı JSON.parse(localStorage) yapıyordu -> donma/kasma kaynağı.
let __issuesMapCache = null;
let __issueCountCache = new Map();
let __normPlateCache = new Map();

function _invalidateIssuesCache(){
  __issuesMapCache = null;
  __issueCountCache.clear();
}

// Başka sekmeden değişirse cache'i tazele + kartları yenile
try {
  window.addEventListener('storage', function(ev){
    if (ev && ev.key === ISSUE_STORAGE_KEY) {
      _invalidateIssuesCache();
      try {
        Promise.resolve(syncProblemsToDriverCards('')).catch(function () {});
      } catch (e) { /* ignore */ }
    }
  });
} catch(e){}

/** sorunlar.html sekmesinden gelen sorun/red güncellemeleri */
async function refreshVehicleRejectionForPlate(plate) {
  const norm = _normPlate(plate || '');
  if (!norm) return;
  try {
    const res = await fetch('/api/vehicles/lookup?plate=' + encodeURIComponent(plate));
    if (!res.ok) return;
    const fresh = await res.json();
    if (!fresh || !fresh.id) return;
    const mergeOne = function (v) {
      if (!v || _normPlate(v.cekiciPlaka) !== norm) return v;
      const merged = Object.assign({}, v, fresh);
      if (fresh.rejection) merged.rejection = fresh.rejection;
      if (fresh.rejection_status != null) merged.rejection_status = fresh.rejection_status;
      if (fresh.rejection_duration != null) merged.rejection_duration = fresh.rejection_duration;
      if (fresh.rejection_start_ts != null) merged.rejection_start_ts = fresh.rejection_start_ts;
      if (fresh.rejection_end_ts != null) merged.rejection_end_ts = fresh.rejection_end_ts;
      if (!fresh.rejection && !fresh.rejection_status) {
        delete merged.rejection;
        delete merged.rejection_status;
        delete merged.rejection_duration;
        delete merged.rejection_start_ts;
        delete merged.rejection_end_ts;
      }
      return merged;
    };
    state.vehicles = (state.vehicles || []).map(mergeOne);
    try {
      const updated = (state.vehicles || []).find(function (v) { return _normPlate(v.cekiciPlaka) === norm; });
      if (updated && window.storage && window.storage.save) storage.save('vehicle_' + updated.id, updated);
    } catch (e) { /* ignore */ }
    try { if (typeof render === 'function') render(); } catch (e) { /* ignore */ }
    try { if (typeof updateVehicleList === 'function') updateVehicleList(); } catch (e) { /* ignore */ }
  } catch (e) { /* ignore */ }
}

try {
  if (window.IssuesSyncBus && typeof window.IssuesSyncBus.onNotify === 'function') {
    window.IssuesSyncBus.onNotify(function (msg) {
      if (!msg || !msg.ts) return;
      const plate = msg.plate || '';
      Promise.resolve().then(async function () {
        try { await syncProblemsToDriverCards(plate); } catch (e) { /* ignore */ }
        if (msg.rejection || msg.rejectionClear) {
          try { await refreshVehicleRejectionForPlate(plate); } catch (e) { /* ignore */ }
        }
      });
    });
  }
} catch (e) { /* ignore */ }

function _normPlate(p){
  if (typeof p !== 'string') p = String(p || '');
  if (__normPlateCache.has(p)) return __normPlateCache.get(p);
  const out = p.toLowerCase().replace(/\s+/g,'').replace(/[^a-z0-9ığüşöç]/gi,'');
  if (__normPlateCache.size > 5000) __normPlateCache.clear();
  __normPlateCache.set(p, out);
  return out;
}

function loadIssuesMap(){
  if (__issuesMapCache) return __issuesMapCache;
  try {
    __issuesMapCache = JSON.parse(localStorage.getItem(ISSUE_STORAGE_KEY) || '{}') || {};
  } catch(e){
    __issuesMapCache = {};
  }
  return __issuesMapCache;
}

function saveIssuesMap(map){
  try { localStorage.setItem(ISSUE_STORAGE_KEY, JSON.stringify(map || {})); } catch(e){}
  __issuesMapCache = map || {};
  __issueCountCache.clear();
}

function getIssues(plate){
  const key = _normPlate(plate);
  const map = loadIssuesMap();
  const issues = Array.isArray(map[key]) ? map[key] : [];

  const validIssues = issues.filter(issue =>
    issue &&
    typeof issue === 'object' &&
    (issue.text || issue.description || issue.note)
  );

  if (validIssues.length !== issues.length) {
    map[key] = validIssues;
    saveIssuesMap(map);
    console.log(`🧹 Temizlendi: ${plate} - ${issues.length - validIssues.length} geçersiz sorun kaydı silindi`);
  }

  return validIssues;
}

function getIssueCount(plate){
  const key = _normPlate(plate);
  if (!key) return 0;
  if (__issueCountCache.has(key)) return __issueCountCache.get(key);
  const map = loadIssuesMap();
  const arr = Array.isArray(map[key]) ? map[key] : [];
  let cnt = 0;
  for (let i = 0; i < arr.length; i++) {
    const it = arr[i];
    if (it && typeof it === 'object'
        && (it.text || it.description || it.note)
        && it.status !== 'closed') {
      cnt++;
    }
  }
  __issueCountCache.set(key, cnt);
  return cnt;
}

function addIssue(plate, issue){
  const key = _normPlate(plate);
  if (!key) return;
  const map = loadIssuesMap();
  if (!Array.isArray(map[key])) map[key] = [];
  map[key].unshift(issue); // newest first
  saveIssuesMap(map);
}

function deleteIssue(plate, idx){
  const key = _normPlate(plate);
  const map = loadIssuesMap();
  if (!Array.isArray(map[key])) return;
  map[key].splice(idx,1);
  saveIssuesMap(map);
}
function updateIssue(plate, idx, patch){
  const key = _normPlate(plate);
  const map = loadIssuesMap();
  if (!Array.isArray(map[key])) return false;
  if (idx < 0 || idx >= map[key].length) return false;
  const prev = map[key][idx] || {};
  map[key][idx] = { ...prev, ...(patch || {}) };
  saveIssuesMap(map);
  return true;
}

function clearIssues(plate){
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
function clearAllIssues(){
  saveIssuesMap({});
}



function issueCardClass(plate){
  // Prefer server-provided cached counts when available, fallback to localStorage
  try {
    if (window.__problemsCountMap && typeof plate === 'string') {
      const key = _normPlate(plate);
      if (typeof window.__problemsCountMap[key] === 'number') {
        return window.__problemsCountMap[key] > 0 ? 'vehicle-card--issues' : '';
      }
      if (window.__problemsCountMap.__fromServerFull === true) {
        return '';
      }
    }
  } catch(e){}
  const cnt = getIssueCount(plate);
  return cnt > 0 ? 'vehicle-card--issues' : '';
}
function issuesBadgeHTML(plate){
  const p = _normPlate(plate);
  if (!p) return '';
  // Önce sunucu cache, sonra local cache — fazladan parse olmasın
  let cnt;
  try {
    if (window.__problemsCountMap) {
      if (typeof window.__problemsCountMap[p] === 'number') {
        cnt = Number(window.__problemsCountMap[p]) || 0;
      } else if (window.__problemsCountMap.__fromServerFull === true) {
        cnt = 0;
      }
    }
  } catch(e){}
  if (cnt === undefined) cnt = getIssueCount(plate);
  if (cnt > 0) {
    return `<button class="issues-open ml-2 text-xs px-2 py-1 rounded-full bg-red-600 text-white font-bold" data-plate="${p}" title="Sorun kayıtlarını gör">SORUN ${cnt}</button>`;
  }
  return `<button class="issues-open ml-2 text-xs px-2 py-1 rounded-full bg-gray-200 text-gray-700 font-semibold" data-plate="${p}" title="Sorun ekle / gör">SORUN 0</button>`;
}

/** Aktif red varsa { duration, endTs }; API sadece `rejection` nesnesi verebilir, DB kolonları düz alan olarak da gelir. */
function vehicleActiveRejection(vehicle) {
  if (!vehicle) return null;
  const r = vehicle.rejection;
  const status = vehicle.rejection_status || (r && r.status);
  if (status !== 'rejected') return null;
  let endTs = vehicle.rejection_end_ts != null ? Number(vehicle.rejection_end_ts) : NaN;
  if (!Number.isFinite(endTs) && r && r.endTs != null) endTs = Number(r.endTs);
  const hasEnd = Number.isFinite(endTs);
  if (hasEnd && Date.now() > endTs) return null;
  const duration = vehicle.rejection_duration || (r && r.duration) || 'Reddedildi';
  return { duration, endTs: hasEnd ? endTs : null };
}

function getRejectionDuration(vehicle){
  const act = vehicleActiveRejection(vehicle);
  if (act && act.duration) return act.duration;
  return '';
}

function rejectionBadgeHTML(vehicle, options){
  if (!vehicle) return '';
  if (options && options.hideWhenOverlay) return '';
  const act = vehicleActiveRejection(vehicle);
  if (!act) return '';

  const durationText = act.duration || 'Reddedildi';
  let banText = durationText;
  
  // Calculate end date for display
  const rejectionEndTs = act.endTs;
  if (rejectionEndTs) {
    const endDate = new Date(rejectionEndTs);
    const formattedDate = endDate.toLocaleDateString('tr-TR');
    const formattedTime = endDate.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
    banText = `${formattedDate} ${formattedTime} kadar girişi yasak`;
  }
  const esc = (s) => String(s || '').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  return `<div class="vehicle-rejection-badge mt-1 flex flex-col gap-1 items-start max-w-full min-w-0 w-full sm:w-auto">
    <span class="inline-flex items-center px-2 py-1 rounded-full text-xs font-bold bg-black text-white whitespace-nowrap" title="Araç reddedildi: ${esc(durationText)}">
      🔒 ${esc(durationText)}
    </span>
    <span class="text-[11px] sm:text-xs text-red-600 font-semibold leading-snug max-w-full break-words">${esc(banText)}</span>
  </div>`;
}

function escapeDataVehicleAttr(vehicle) {
  try {
    return JSON.stringify(vehicle).replace(/"/g, '&quot;');
  } catch (e) {
    return '';
  }
}

/** Sunucu sayacı veya yerel sorun listesi — JSON.stringify hack'i yok. */
function vehicleCardHasOpenProblems(vehicle) {
  if (!vehicle || !vehicle.cekiciPlaka) return false;
  const key = _normPlate(vehicle.cekiciPlaka);
  try {
    const map = window.__problemsCountMap;
    if (map && typeof map[key] === 'number') {
      return map[key] > 0;
    }
    /** Tüm /api/problems ile doldurulduysa, map'te olmayan plaka = 0 açık sorun (localStorage'a düşme). */
    if (map && map.__fromServerFull === true) {
      return false;
    }
  } catch (e) { /* ignore */ }
  try {
    return getIssueCount(vehicle.cekiciPlaka) > 0;
  } catch (e) {
    return false;
  }
}

function rejectionOverlayDetailText(vehicle) {
  const act = vehicleActiveRejection(vehicle);
  if (!act) return '';
  if (act.endTs) {
    const endDate = new Date(act.endTs);
    const formattedDate = endDate.toLocaleDateString('tr-TR');
    const formattedTime = endDate.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
    return `${formattedDate} ${formattedTime} kadar girişi yasak`;
  }
  return act.duration || '';
}

function vehicleCardBlockOverlayHTML(vehicle, isRejected, hasProblems) {
  const lines = [];
  if (isRejected) {
    const t = rejectionOverlayDetailText(vehicle);
    if (t) lines.push(t);
  }
  if (hasProblems) {
    try {
      const n = getIssueCount(vehicle.cekiciPlaka);
      if (n > 0) lines.push(`Açık sorun kaydı: ${n}`);
    } catch (e) { /* ignore */ }
  }
  const esc = (s) => String(s || '').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const blockDetail = lines.length
    ? lines.map((l) => `<p class="vehicle-card__overlay-detail">${esc(l)}</p>`).join('')
    : '';
  return `
    <div class="vehicle-card__overlay" role="alert" aria-live="polite">
      <svg class="vehicle-card__overlay-icon" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 2C9.243 2 7 4.243 7 7v3H6c-1.103 0-2 .897-2 2v7c0 1.103.897 2 2 2h12c1.103 0 2-.897 2-2v-7c0-1.103-.897-2-2-2h-1V7c0-2.757-2.243-5-5-5zm0 2c1.654 0 3 1.346 3 3v3H9V7c0-1.654 1.346-3 3-3zm-5 7h10v7H7v-7z"/>
      </svg>
      <p class="vehicle-card__overlay-title">SORUNLU ARAÇ</p>
      <p class="vehicle-card__overlay-sub">İşlem yapılamaz</p>
      ${blockDetail}
    </div>`;
}

/** Verilen plakaya sahip TÜM araçların rejection_* alanlarını DB'de NULL yapar
 *  ve bellekteki state'i de günceller. Sorun silindiğinde otomatik çağrılır. */
async function clearRejectionForPlate(plate) {
  const norm = _normPlate(plate || '');
  if (!norm) return;
  const matches = (state.vehicles || []).filter((v) => v && _normPlate(v.cekiciPlaka) === norm);
  for (const v of matches) {
    if (!v || !v.id) continue;
    // Sadece reddi olanlara API gönder; gereksiz istek yapma.
    const status = v.rejection_status || (v.rejection && v.rejection.status);
    if (status !== 'rejected') continue;
    try {
      const res = await fetch(`/api/vehicles/${encodeURIComponent(v.id)}/remove-rejection`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      if (!res.ok) {
        console.warn('remove-rejection başarısız:', v.id, res.status);
        continue;
      }
    } catch (err) {
      console.warn('remove-rejection exception:', err);
      continue;
    }
    try {
      const cleared = { ...v };
      delete cleared.rejection;
      delete cleared.rejection_status;
      delete cleared.rejection_duration;
      delete cleared.rejection_start_ts;
      delete cleared.rejection_end_ts;
      state.vehicles = (state.vehicles || []).map((x) => (String(x.id) === String(v.id) ? cleared : x));
      try { if (window.storage && window.storage.save) window.storage.save('vehicle_' + v.id, cleared); } catch (e) { /* ignore */ }
    } catch (e) { /* ignore */ }
  }
}

/** Tek şoför kartı — liste (render) ve arama (updateVehicleList) ortak. */
function vehicleCardHTML(vehicle) {
  const isRejected = !!vehicleActiveRejection(vehicle);
  const hasProblems = vehicleCardHasOpenProblems(vehicle);
  // Kilit overlay'i SADECE araç reddedilmişse (girişi yasaksa) gösterilir.
  // Sadece "sorun kaydı" varsa kart siyah/kilitli görünmez; kırmızı çerçeve + SORUN rozeti yeterli.
  const showBlockOverlay = isRejected;
  const plate = formatPlaka(vehicle.cekiciPlaka);
  const dv = escapeDataVehicleAttr(vehicle);
  const cardClass = showBlockOverlay
    ? 'vehicle-card vehicle-card--blocked'
    : `vehicle-card ${issueCardClass(vehicle.cekiciPlaka)}`;
  const overlay = showBlockOverlay ? vehicleCardBlockOverlayHTML(vehicle, isRejected, hasProblems) : '';
  const rejectionInline = rejectionBadgeHTML(vehicle, { hideWhenOverlay: showBlockOverlay });
  const waTextPlain = 'Merhaba ' + formatPlaka(vehicle.cekiciPlaka)
    + (vehicle.soforAdi ? ' - ' + (vehicle.soforAdi + (vehicle.soforSoyadi ? ' ' + vehicle.soforSoyadi : '')) : '');
  const waPhone = toWhatsAppPhone(vehicle.iletisim);
  const formBtn = showBlockOverlay ? '' : `
    <button type="button" class="vehicle-card__form-btn form-btn" data-vehicle="${dv}" title="Takip Formu">
      <svg class="vehicle-card__form-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
      <span>Takip Formu</span>
    </button>`;
  const footerActions = showBlockOverlay ? '' : `
    <div class="vehicle-card__toolbar">
      <button type="button" class="vehicle-card__tool copy-card-btn" data-vehicle="${dv}" title="Kartı Kopyala">Kopyala</button>
      <button type="button" class="vehicle-card__tool vehicle-card__tool--danger delete-btn" data-id="${vehicle.id}" title="Sil">Sil</button>
      <button type="button" class="vehicle-card__tool vehicle-card__tool--primary edit-btn" data-vehicle="${dv}" title="Düzenle">Düzenle</button>
    </div>`;

  const footerStatusHtml = showBlockOverlay
    ? '<span class="vehicle-card__status-blocked">SORUNLU ARAÇ</span>'
    : '';

  return `<div class="${cardClass}" data-vehicle="${dv}">
${overlay}
    <div class="vehicle-card__header">
      <div class="vehicle-card__header-main">
        <div class="vehicle-card__plate-row">
          <span class="vehicle-card__plate">${plate}</span>
          ${issuesBadgeHTML(vehicle.cekiciPlaka)}
        </div>
        ${rejectionInline}
      </div>
      <div class="vehicle-card__brand" title="NETSIS verilerini kopyala">
        <button type="button" class="netsis-btn" data-vehicle="${dv}" aria-label="NETSIS verilerini kopyala">
          <img class="netsis-btn-icon" src="${NETSIS_ICON_SRC}" alt="NETSIS" onerror="if(!this.dataset.fb){this.dataset.fb='1';this.src='/assets/netsis.png';}" />
        </button>
      </div>
    </div>
    <div class="vehicle-card__body">
      ${vehicle.dorsePlaka ? `<div class="vehicle-card__field"><span class="vehicle-card__label">Dorse</span><span class="vehicle-card__value">${formatPlaka(vehicle.dorsePlaka)}</span></div>` : ''}
      ${vehicle.soforAdi ? `<div class="vehicle-card__field"><span class="vehicle-card__label">Şoför</span><span class="vehicle-card__value">${vehicle.soforAdi} ${vehicle.soforSoyadi || ''}</span></div>` : ''}
      ${(vehicle.iletisim || vehicle.tcKimlik) ? `<div class="vehicle-card__field vehicle-card__field--wide vehicle-card__contact-tc">
        ${vehicle.iletisim ? `<div class="vehicle-card__contact-tc-item">
          <span class="vehicle-card__label">İletişim</span>
          <span class="vehicle-card__value vehicle-card__value--contact">
            <span>${vehicle.iletisim}</span>
            ${waPhone ? `<button type="button" class="vehicle-card__wa whatsapp-link" data-wa-phone="${waPhone}" data-wa-text="${escapeAttr(waTextPlain)}" title="WhatsApp — link kopyala (açık sekmede Ctrl+V → Enter)">
              <img src="${WHATSAPP_ICON_SRC}" alt="" width="18" height="18"/>
            </button>` : ''}
          </span>
        </div>` : ''}
        ${vehicle.tcKimlik ? `<div class="vehicle-card__contact-tc-item">
          <span class="vehicle-card__label">TC</span>
          <span class="vehicle-card__value">${maskTc(vehicle.tcKimlik)}</span>
        </div>` : ''}
      </div>` : ''}
    </div>
    <div class="vehicle-card__footer">
      ${footerActions}
      ${footerStatusHtml ? `<div class="vehicle-card__status">${footerStatusHtml}</div>` : ''}
      <time class="vehicle-card__date">${vehicle.kayitTarihi || ''}</time>
      ${formBtn}
    </div>
  </div>`;
}

async function updateIssuesIndicators(plate){
  // Update issue counts on UI. Prefer server counts, fall back to localStorage.
  try {
    const norm = _normPlate(plate || document.getElementById('cekiciPlaka')?.value || '');
    const setBtnForPlate = (p, cnt) => {
      // update quick btn if matching
      try {
        const qb = document.getElementById('issuesQuickBtn');
        if (qb && String(p || '') === _normPlate(document.getElementById('cekiciPlaka')?.value || '')) {
          qb.textContent = `⚠️ Şoför Sorunları (${cnt})`;
          qb.style.background = cnt>0 ? '#ef4444' : '#374151';
        }
      } catch(e){}
      // update any .issues-open buttons with matching data-plate
      try {
        Array.from(document.querySelectorAll('.issues-open')).forEach(el => {
          const dp = el.getAttribute('data-plate') || '';
          if (_normPlate(dp) === _normPlate(p || '')) {
            const text = cnt>0 ? `SORUN ${cnt}` : `SORUN 0`;
            el.innerHTML = text;
            el.style.background = cnt>0 ? '#ef4444' : '';
          }
        });
      } catch(e){}
    };

    if (norm) {
      try {
        const res = await fetch('/api/problems?plate=' + encodeURIComponent(norm));
        if (res.ok) {
          const arr = await res.json();
          const cnt = Array.isArray(arr) ? arr.filter(it => { const s = (it && it.data && it.data.status) || it.status; return s !== 'closed'; }).length : 0;
            window.__problemsCountMap = window.__problemsCountMap || {};
            delete window.__problemsCountMap.__fromServerFull;
            window.__problemsCountMap[norm] = cnt;
            setBtnForPlate(norm, cnt);
          return;
        }
      } catch(e){}
      // fallback to local
      const cntLocal = getIssueCount(norm);
      setBtnForPlate(norm, cntLocal);
      return;
    }

    // no specific plate: update quick button and all issue-open buttons
    try {
      const qbPlate = _normPlate(document.getElementById('cekiciPlaka')?.value || '');
      if (qbPlate) {
        const res0 = await fetch('/api/problems?plate=' + encodeURIComponent(qbPlate));
        if (res0.ok) {
          const arr0 = await res0.json();
          const cnt0 = Array.isArray(arr0) ? arr0.filter(it => { const s = (it && it.data && it.data.status) || it.status; return s !== 'closed'; }).length : 0;
          window.__problemsCountMap = window.__problemsCountMap || {};
          delete window.__problemsCountMap.__fromServerFull;
          window.__problemsCountMap[qbPlate] = cnt0;
          setBtnForPlate(qbPlate, cnt0);
        }
      }
    } catch(e){}

    // update all buttons by querying server once for all problems and grouping (if server reachable)
    try {
      const res = await fetch('/api/problems');
      if (res.ok) {
        const all = await res.json();
        const grouped = {};
        (all || []).forEach(it => { const p = _normPlate(it.plate || it.addedPlate || ''); if (!p) return; if (!grouped[p]) grouped[p]=0; const s = (it && it.data && it.data.status) || it.status; if (s !== 'closed') grouped[p]++; });
        grouped.__fromServerFull = true;
        // Önce tüm eski rozetleri sıfırla, sonra sunucudaki sayımları yaz.
        try {
          const oldMap = window.__problemsCountMap || {};
          Object.keys(oldMap).forEach((p) => { if (p !== '__fromServerFull') setBtnForPlate(p, 0); });
        } catch (e) { /* ignore */ }
        window.__problemsCountMap = grouped;
        Object.keys(grouped).forEach((p) => { if (p !== '__fromServerFull') setBtnForPlate(p, grouped[p]); });
        // Sunucu otoritedir — tarayıcıdaki eski "addIssue fallback" kayıtlarını kaldır,
        // böylece kartlar bir sonraki render'da hayalet sorun göstermez.
        try {
          const localMap = loadIssuesMap();
          let changed = false;
          Object.keys(localMap || {}).forEach((k) => {
            const norm = _normPlate(k);
            const serverCnt = norm ? grouped[norm] : 0;
            if (!serverCnt) {
              delete localMap[k];
              changed = true;
            }
          });
          if (changed) saveIssuesMap(localMap);
        } catch (e) { /* ignore */ }
        return;
      }
    } catch(e){}

    // final fallback: update using localStorage map
    try {
      const map = loadIssuesMap();
      const localMap = {};
      Object.keys(map || {}).forEach(k => { const cnt = Array.isArray(map[k]) ? map[k].filter(it => (it && it.status) !== 'closed').length : 0; localMap[k] = cnt; setBtnForPlate(k, cnt); });
      window.__problemsCountMap = window.__problemsCountMap || {};
      delete window.__problemsCountMap.__fromServerFull;
      Object.assign(window.__problemsCountMap, localMap);
    } catch(e){}
  } catch(e){}
}

/** Sorun silindikten sonra çağrılır: o plakaya bağlı aktif redleri de DB'den siler,
 *  ardından sayaçları/kartları sunucudan tazeler. */
async function clearRejectionAndSyncCards(plate) {
  try { await clearRejectionForPlate(plate); } catch (e) { /* ignore */ }
  await syncProblemsToDriverCards(plate);
}

/** Sorun sayacını sunucudan güncelle, sonra kartları yeniden çiz (render önce sayaç olmalı). */
async function syncProblemsToDriverCards(plate) {
  const p = (plate != null && String(plate).trim() !== '') ? _normPlate(String(plate)) : '';
  try {
    // Tek plaka senkronu hep yapılır; ek olarak tüm plakaların tutarlı kalması için
    // tam sunucu senkronunu da çalıştır (sunucu otorite, localStorage temizlenir).
    if (p) await updateIssuesIndicators(p);
    await updateIssuesIndicators();
  } catch (e) { /* ignore */ }
  // Bireysel plaka için localStorage cache'i de temizle (API'den sıfır geldiyse).
  try {
    if (p && window.__problemsCountMap && window.__problemsCountMap[p] === 0) {
      const localMap = loadIssuesMap();
      if (localMap && Object.prototype.hasOwnProperty.call(localMap, p)) {
        delete localMap[p];
        saveIssuesMap(localMap);
      }
    }
  } catch (e) { /* ignore */ }
  try { if (typeof render === 'function') render(); } catch (e) { /* ignore */ }
  try { if (typeof updateVehicleList === 'function') updateVehicleList(); } catch (e) { /* ignore */ }
}

function closeIssuesModal(){
  const el = document.getElementById('issuesOverlay');
  if (el) el.remove();
}

async function fileToDataUrl(file){
  return new Promise((resolve,reject)=>{
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

function openIssuesModal(plateOrEmpty) {
  const plate = (plateOrEmpty || '').trim();
  let url = 'sorunlar.html';
  if (plate) url += '?plate=' + encodeURIComponent(plate);
  if (window.SessionManager && typeof window.SessionManager.openAppPage === 'function') {
    window.SessionManager.openAppPage(url);
  } else {
    location.href = url;
  }
}

function autoOpenIssuesIfExists(plate){
  const cnt = getIssueCount(plate);
  if (cnt > 0) openIssuesModal(plate);
}

// Global delegation: kartlardaki butonlar
document.addEventListener('click', (e)=>{
  const t = e.target && e.target.closest
    ? e.target.closest('.issues-open, .copy-card-btn')
    : null;
  if (!t) return;

  // Issues-open butonları
  if (t.classList.contains('issues-open')) {
    e.preventDefault();
    const plateKey = t.getAttribute('data-plate') || '';
    // plateKey normalized; modal plate input ham da olabilir
    openIssuesModal(plateKey);
    return;
  }

  // Copy card butonu
  if (t.classList.contains('copy-card-btn')) {
    e.preventDefault();
    try {
      const vehicleData = JSON.parse(t.getAttribute('data-vehicle') || '{}');
      copyCardInfo(vehicleData);
    } catch(err) {
      console.error('Copy card error:', err);
    }
  }
});

// Kart Bilgilerini Kopyala Fonksiyonu
function copyCardInfo(vehicle) {
  try {
    // Tüm kart bilgilerini clipboard'a kopyala
    const cardText = `Plaka: ${vehicle.cekiciPlaka || ''}
Dorse: ${vehicle.dorsePlaka || ''}
Şoför: ${vehicle.soforAdi || ''} ${vehicle.soforSoyadi || ''}
İletişim: ${vehicle.iletisim || ''}
TC: ${vehicle.tcKimlik || ''}
Kayıt: ${vehicle.kayitTarihi || ''}`;
    
    navigator.clipboard.writeText(cardText).then(() => {
      // Başarı mesajı göster
      showCopyMessage('Kart bilgileri kopyalandı!');
      
      // Otomatik olarak yeni form oluştur
      setTimeout(() => {
        createNewVehicleWithCopiedInfo(vehicle);
      }, 500);
    }).catch(err => {
      console.error('Clipboard error:', err);
      alert('Kopyalama başarısız!');
    });
  } catch(e) {
    console.error('Copy card error:', e);
    alert('Kopyalama hatası!');
  }
}

function createNewVehicleWithCopiedInfo(originalVehicle) {
  clearActiveTakipVehicleRefs();
  state.editingId = null;

  // Formu göster
  state.showForm = true;
  
  // Form alanlarını doldur - plakayı temizle, diğer bilgileri koru
  state.formData = {
    cekiciPlaka: '', // Plakayı temizle
    dorsePlaka: originalVehicle.dorsePlaka || '',
    soforAdi: originalVehicle.soforAdi || '',
    soforSoyadi: originalVehicle.soforSoyadi || '',
    sofor2Adi: '',
    sofor2Soyadi: '',
    iletisim: originalVehicle.iletisim || '',
    tcKimlik: originalVehicle.tcKimlik || '',
    defaultFirma: originalVehicle.defaultFirma || '',
    defaultMalzeme: originalVehicle.defaultMalzeme || '',
    defaultSevkYeri: originalVehicle.defaultSevkYeri || '',
    defaultYuklemeNotu: originalVehicle.defaultYuklemeNotu || ''
  };
  
  // UI'ı güncelle
  render();
  
  // Plaka alanına odaklan
  setTimeout(() => {
    document.getElementById('cekiciPlaka')?.focus();
  }, 100);
}

function showCopyMessage(message) {
  showToast(message, 'success', 3000);
}

