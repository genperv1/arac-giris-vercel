(function () {
  'use strict';

  const SESSION_KEY = 'driverPanelSession_v1';
  const API = '/api';

  const state = {
    session: null,
    routePoints: [],
    trips: [],
    icTrips: [],
    icRoute: { from: 'AVDAN', to: '1.OSB' },
    icWeekly: null,
    warnings: [],
    photos: {},
    editingId: null,
    dirty: false,
  };

  function $(id) { return document.getElementById(id); }

  function loadSession() {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function saveSession(session) {
    state.session = session;
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  }

  function clearSession() {
    state.session = null;
    sessionStorage.removeItem(SESSION_KEY);
  }

  function authHeaders() {
    const token = state.session && state.session.token;
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  async function api(path, options) {
    const res = await fetch(`${API}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders(),
        ...(options && options.headers ? options.headers : {}),
      },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || data.message || 'İstek başarısız');
      err.status = res.status;
      throw err;
    }
    return data;
  }

  function photoUrl(pathValue) {
    if (!pathValue) return '';
    if (String(pathValue).startsWith('data:')) return pathValue;
    const token = state.session && state.session.token;
    const parts = String(pathValue).replace(/\\/g, '/').split('/');
    const file = parts.pop();
    const tripId = parts.pop();
    if (!tripId || !file || !token) return '';
    return `${API}/driver-trips/photo/${encodeURIComponent(tripId)}/${encodeURIComponent(file)}?access_token=${encodeURIComponent(token)}`;
  }

  function formatDate(value) {
    if (!value) return '—';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' });
  }

  function formatRoute(trip) {
    if ((trip.tripType || 'normal') === 'ic') {
      return `İÇ · ${trip.yuklemeYeri || 'AVDAN'} → ${trip.bosaltmaLiman || '1.OSB'}`;
    }
    const gidis = `${trip.yuklemeYeri || '?'} → ${trip.bosaltmaLiman || '?'}`;
    if (trip.bosDondu) return `${gidis} · BOŞ DÖNDÜ`;
    return `${gidis} · ${trip.donusYukleme || '?'} → ${trip.donusBosaltma || '?'}`;
  }

  function calcPreview() {
    const gidis = Number($('spAracGidisKm').value);
    const donus = Number($('spAracDonusKm').value);
    const mazot = Number($('spMazotLt').value);
    let km = null;
    if (Number.isFinite(gidis) && Number.isFinite(donus)) km = donus - gidis;
    $('spKmOut').textContent = km !== null && km >= 0 ? `${km} km` : '—';
    $('spYakitOut').textContent = (km > 0 && Number.isFinite(mazot))
      ? `${(mazot / km).toFixed(4)} lt/km`
      : '—';
  }

  function showAlert(text, type) {
    const el = $('spAlert');
    if (!el) return;
    if (!text) {
      el.classList.add('hidden');
      el.textContent = '';
      return;
    }
    el.textContent = text;
    el.className = `sp-alert ${type === 'ok' ? 'is-ok' : 'is-error'}`;
    el.classList.remove('hidden');
  }

  function setDirty(flag) {
    state.dirty = !!flag;
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function bindPhotoInputs() {
    document.querySelectorAll('[data-photo]').forEach((input) => {
      input.addEventListener('change', async () => {
        const key = input.getAttribute('data-photo');
        const file = input.files && input.files[0];
        if (!file) return;
        const dataUrl = await readFileAsDataUrl(file);
        state.photos[key] = dataUrl;
        const preview = document.querySelector(`[data-preview="${key}"]`);
        if (preview) {
          preview.src = dataUrl;
          preview.hidden = false;
        }
        setDirty(true);
      });
    });
  }

  function resetPhotos() {
    state.photos = {};
    document.querySelectorAll('[data-photo]').forEach((input) => { input.value = ''; });
    document.querySelectorAll('[data-preview]').forEach((img) => {
      img.hidden = true;
      img.removeAttribute('src');
    });
  }

  function fillPhotoPreviews(trip) {
    resetPhotos();
    [
      'photoGidisIrsaliye',
      'photoGidisKantar',
      'photoDonusIrsaliye',
      'photoDonusKantar',
    ].forEach((key) => {
      const pathValue = trip[key];
      if (!pathValue) return;
      const url = photoUrl(pathValue);
      state.photos[key] = url.startsWith('data:') ? url : undefined;
      const preview = document.querySelector(`[data-preview="${key}"]`);
      if (preview && url) {
        preview.src = url;
        preview.hidden = false;
      }
    });
  }

  function toLocalInputValue(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function toggleBosDondu() {
    const on = $('spBosDondu').checked;
    ['spDonusYukleme', 'spDonusBosaltma'].forEach((id) => {
      const el = $(id);
      if (el) el.required = !on;
    });
    $('spDonusPhotos').hidden = on;
  }

  function openForm(trip) {
    $('spFormSection').classList.remove('hidden');
    $('spTripId').value = trip ? trip.id : '';
    state.editingId = trip ? trip.id : null;
    resetPhotos();

    $('spGidisTarihi').value = toLocalInputValue(trip && trip.gidisTarihi) || toLocalInputValue(new Date().toISOString());
    $('spDonusTarihi').value = toLocalInputValue(trip && trip.donusTarihi) || toLocalInputValue(new Date().toISOString());
    $('spYuklemeYeri').value = (trip && trip.yuklemeYeri) || '';
    $('spBosaltmaLiman').value = (trip && trip.bosaltmaLiman) || '';
    $('spDonusYukleme').value = (trip && trip.donusYukleme) || '';
    $('spDonusBosaltma').value = (trip && trip.donusBosaltma) || '';
    $('spBosDondu').checked = !!(trip && trip.bosDondu);
    $('spAracGidisKm').value = trip && trip.aracGidisKm != null ? trip.aracGidisKm : '';
    $('spAracDonusKm').value = trip && trip.aracDonusKm != null ? trip.aracDonusKm : '';
    $('spMazotLt').value = trip && trip.mazotLt != null ? trip.mazotLt : '';
    $('spAdblueLt').value = trip && trip.adblueLt != null ? trip.adblueLt : '';
    $('spAciklama').value = (trip && trip.aciklama) || '';

    if (trip) fillPhotoPreviews(trip);
    toggleBosDondu();
    calcPreview();
    setDirty(false);
    $('spFormSection').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function closeForm() {
    if (state.dirty && !confirm('Kaydetmeden çıkarsanız veriler kaybolur. Kapatılsın mı?')) return;
    $('spFormSection').classList.add('hidden');
    state.editingId = null;
    setDirty(false);
    resetPhotos();
  }

  function buildPayload() {
    const payload = {
      gidisTarihi: $('spGidisTarihi').value ? new Date($('spGidisTarihi').value).toISOString() : null,
      donusTarihi: $('spDonusTarihi').value ? new Date($('spDonusTarihi').value).toISOString() : null,
      yuklemeYeri: $('spYuklemeYeri').value.trim(),
      bosaltmaLiman: $('spBosaltmaLiman').value.trim(),
      donusYukleme: $('spDonusYukleme').value.trim(),
      donusBosaltma: $('spDonusBosaltma').value.trim(),
      bosDondu: $('spBosDondu').checked,
      aracGidisKm: $('spAracGidisKm').value,
      aracDonusKm: $('spAracDonusKm').value,
      mazotLt: $('spMazotLt').value,
      adblueLt: $('spAdblueLt').value,
      aciklama: $('spAciklama').value.trim(),
    };

    ['photoGidisIrsaliye', 'photoGidisKantar', 'photoDonusIrsaliye', 'photoDonusKantar'].forEach((key) => {
      if (state.photos[key]) payload[key] = state.photos[key];
    });
    return payload;
  }

  async function saveTrip(e) {
    if (e) e.preventDefault();
    try {
      const payload = buildPayload();
      const id = $('spTripId').value;
      const data = id
        ? await api(`/driver-trips/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(payload) })
        : await api('/driver-trips', { method: 'POST', body: JSON.stringify(payload) });
      showAlert('Sefer kaydı kaydedildi.', 'ok');
      setDirty(false);
      $('spFormSection').classList.add('hidden');
      await loadTrips();
      if (data.trip) openDetail(data.trip);
    } catch (err) {
      showAlert(err.message || 'Kayıt başarısız', 'error');
    }
  }

  function renderWarnings() {
    const box = $('spKmWarnings');
    if (!box) return;
    if (!state.warnings.length || state.session.role !== 'office') {
      box.classList.add('hidden');
      box.innerHTML = '';
      return;
    }
    box.innerHTML = `<strong>KM uyarıları</strong><br>${state.warnings.map((w) =>
      `• ${w.actualKm} km gidiş, önceki dönüş ${w.expectedKm} km (${w.diff > 0 ? '+' : ''}${w.diff})`
    ).join('<br>')}`;
    box.classList.remove('hidden');
  }

  async function saveIcTrip(e) {
    if (e) e.preventDefault();
    try {
      const payload = {
        tarih: $('spIcTarihi').value ? new Date($('spIcTarihi').value).toISOString() : null,
        km: $('spIcKm').value,
        aciklama: ($('spIcAciklama').value || '').trim(),
      };
      await api('/driver-trips/ic', { method: 'POST', body: JSON.stringify(payload) });
      showAlert('İç sefer kaydedildi.', 'ok');
      $('spIcFormSection').classList.add('hidden');
      $('spIcKm').value = '';
      $('spIcAciklama').value = '';
      await loadTrips();
    } catch (err) {
      showAlert(err.message || 'Kayıt başarısız', 'error');
    }
  }

  function openIcForm() {
    $('spFormSection').classList.add('hidden');
    $('spIcFormSection').classList.remove('hidden');
    $('spIcTarihi').value = toLocalInputValue(new Date().toISOString());
    const r = state.icRoute || { from: 'AVDAN', to: '1.OSB' };
    $('spIcRouteLabel').textContent = `${r.from} → ${r.to} · Sadece KM girin`;
    $('spIcFormSection').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function closeIcForm() {
    $('spIcFormSection').classList.add('hidden');
  }

  function renderIcTrips() {
    const list = $('spIcTripList');
    const meta = $('spIcListMeta');
    const badge = $('spIcWeekBadge');
    if (!list) return;

    const trips = state.icTrips;
    const weekly = state.icWeekly;
    if (badge && weekly) {
      badge.textContent = `Bu hafta ${weekly.totals?.weekTrips || 0} sefer · ${weekly.totals?.weekKm || 0} km`;
    }
    if (meta) meta.textContent = trips.length ? `${trips.length} iç sefer kaydı` : 'Kayıt yok';

    if (!trips.length) {
      list.innerHTML = '<p class="sp-empty">Henüz iç sefer kaydı yok.</p>';
      return;
    }

    list.innerHTML = trips.slice(0, 20).map((trip) => `
      <article class="sp-trip sp-trip--ic">
        <div class="sp-trip__route">${escapeHtml(formatRoute(trip))}</div>
        <div class="sp-trip__meta">
          ${formatDate(trip.gidisTarihi)}<br>
          KM: <strong>${trip.km ?? '—'}</strong>
          ${trip.aciklama ? `<br>${escapeHtml(trip.aciklama)}` : ''}
        </div>
      </article>
    `).join('');
  }

  function renderTrips() {
    const list = $('spTripList');
    const meta = $('spListMeta');
    if (!list) return;

    const trips = state.trips;
    meta.textContent = trips.length ? `${trips.length} dış sefer` : 'Kayıt yok';

    if (!trips.length) {
      list.innerHTML = '<p class="sp-empty">Henüz sefer kaydı yok.</p>';
      return;
    }

    list.innerHTML = trips.map((trip) => `
      <article class="sp-trip">
        <div class="sp-trip__route">${escapeHtml(formatRoute(trip))}</div>
        <div class="sp-trip__meta">
          ${escapeHtml(trip.plaka)} · ${escapeHtml(trip.driverName)}<br>
          ${formatDate(trip.gidisTarihi)} → ${formatDate(trip.donusTarihi)}<br>
          KM: <strong>${trip.km ?? '—'}</strong> · Mazot: <strong>${trip.mazotLt ?? '—'} lt</strong>
          ${trip.yakitYuzde != null ? ` · Yakıt: <strong>${Number(trip.yakitYuzde).toFixed(4)}</strong>` : ''}
        </div>
        <div class="sp-trip__actions">
          <button type="button" class="sp-btn sp-btn--ghost" data-view="${escapeHtml(trip.id)}">Detay</button>
          <button type="button" class="sp-btn sp-btn--primary" data-edit="${escapeHtml(trip.id)}">Düzenle</button>
        </div>
      </article>
    `).join('');

    list.querySelectorAll('[data-view]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const trip = state.trips.find((t) => t.id === btn.getAttribute('data-view'));
        if (trip) openDetail(trip);
      });
    });
    list.querySelectorAll('[data-edit]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const trip = state.trips.find((t) => t.id === btn.getAttribute('data-edit'));
        if (trip) openForm(trip);
      });
    });
  }

  function openDetail(trip) {
    const modal = $('spDetailModal');
    const body = $('spDetailBody');
    $('spDetailTitle').textContent = formatRoute(trip);
    if ((trip.tripType || 'normal') === 'ic') {
      body.innerHTML = `
        <div class="sp-detail-grid">
          <div><strong>Tür</strong>İç sefer</div>
          <div><strong>Plaka / Şoför</strong>${escapeHtml(trip.plaka)} · ${escapeHtml(trip.driverName)}</div>
          <div><strong>Rota</strong>${escapeHtml(trip.yuklemeYeri)} → ${escapeHtml(trip.bosaltmaLiman)}</div>
          <div><strong>Tarih / KM</strong>${formatDate(trip.gidisTarihi)} · ${trip.km ?? '—'} km</div>
          ${trip.aciklama ? `<div><strong>Not</strong>${escapeHtml(trip.aciklama)}</div>` : ''}
        </div>
      `;
      $('spDetailEditBtn').hidden = true;
      modal.classList.remove('hidden');
      return;
    }
    $('spDetailEditBtn').hidden = false;
    body.innerHTML = `
      <div class="sp-detail-grid">
        <div><strong>Plaka / Şoför</strong>${escapeHtml(trip.plaka)} · ${escapeHtml(trip.driverName)}</div>
        <div><strong>Gidiş</strong>${escapeHtml(trip.yuklemeYeri)} → ${escapeHtml(trip.bosaltmaLiman)} · ${formatDate(trip.gidisTarihi)} · ${trip.aracGidisKm ?? '—'} km</div>
        <div><strong>Dönüş</strong>${trip.bosDondu ? 'Boş döndü' : `${escapeHtml(trip.donusYukleme)} → ${escapeHtml(trip.donusBosaltma)}`} · ${formatDate(trip.donusTarihi)} · ${trip.aracDonusKm ?? '—'} km</div>
        <div><strong>Toplam KM / Mazot</strong>${trip.km ?? '—'} km · ${trip.mazotLt ?? '—'} lt ${trip.yakitYuzde != null ? `( ${Number(trip.yakitYuzde).toFixed(4)} lt/km )` : ''}</div>
        ${trip.aciklama ? `<div><strong>Açıklama</strong>${escapeHtml(trip.aciklama)}</div>` : ''}
      </div>
      <div class="sp-detail-photos">
        ${renderDetailPhoto('Gidiş irsaliye', trip.photoGidisIrsaliye)}
        ${renderDetailPhoto('Gidiş kantar', trip.photoGidisKantar)}
        ${trip.bosDondu ? '' : renderDetailPhoto('Dönüş irsaliye', trip.photoDonusIrsaliye)}
        ${trip.bosDondu ? '' : renderDetailPhoto('Dönüş kantar', trip.photoDonusKantar)}
      </div>
    `;
    $('spDetailEditBtn').onclick = () => {
      modal.classList.add('hidden');
      openForm(trip);
    };
    modal.classList.remove('hidden');
  }

  function renderDetailPhoto(label, pathValue) {
    const url = photoUrl(pathValue);
    if (!url) return `<div><strong>${escapeHtml(label)}</strong><p class="sp-empty">Yok</p></div>`;
    return `<div><strong>${escapeHtml(label)}</strong><img src="${url}" alt="${escapeHtml(label)}"></div>`;
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  async function loadRoutePoints() {
    const data = await api('/driver-route-points');
    state.routePoints = data.points || [];
    const dl = $('spRouteList');
    if (dl) {
      dl.innerHTML = state.routePoints.map((p) => `<option value="${escapeHtml(p)}"></option>`).join('');
    }
  }

  async function loadTrips() {
    const data = await api('/driver-trips');
    const all = data.trips || [];
    state.trips = all.filter((t) => (t.tripType || 'normal') !== 'ic');
    state.icTrips = all.filter((t) => (t.tripType || 'normal') === 'ic');
    state.warnings = data.warnings || [];
    state.icRoute = data.icRoute || state.icRoute;
    state.icWeekly = data.icWeekly || null;
    renderTrips();
    renderIcTrips();
    renderWarnings();
  }

  function setupHeader() {
    const s = state.session;
    $('spHeaderTitle').textContent = s.plaka || 'Şoför Paneli';
    $('spHeaderSub').textContent = s.driver || '';
  }

  function bindEvents() {
    $('spNewTripBtn').addEventListener('click', () => { closeIcForm(); openForm(null); });
    $('spNewIcTripBtn')?.addEventListener('click', () => { closeForm(); openIcForm(); });
    $('spIcCancelBtn')?.addEventListener('click', closeIcForm);
    $('spIcTripForm')?.addEventListener('submit', saveIcTrip);
    $('spCancelBtn').addEventListener('click', closeForm);
    $('spTripForm').addEventListener('submit', saveTrip);
    $('spLogoutBtn').addEventListener('click', () => {
      if (state.dirty && !confirm('Kaydetmeden çıkarsanız veriler kaybolur.')) return;
      clearSession();
      location.href = 'GIRIS.html';
    });
    $('spBosDondu').addEventListener('change', toggleBosDondu);
    ['spAracGidisKm', 'spAracDonusKm', 'spMazotLt'].forEach((id) => {
      $(id).addEventListener('input', calcPreview);
    });
    document.querySelectorAll('#spTripForm input, #spTripForm textarea').forEach((el) => {
      el.addEventListener('input', () => setDirty(true));
    });
    document.querySelectorAll('[data-close-modal]').forEach((el) => {
      el.addEventListener('click', () => $('spDetailModal').classList.add('hidden'));
    });
    window.addEventListener('beforeunload', (e) => {
      if (state.dirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    });
    bindPhotoInputs();
  }

  async function init() {
    const session = loadSession();
    if (!session || !session.token) {
      location.href = 'GIRIS.html';
      return;
    }
    if (session.role === 'office') {
      location.href = 'sofor-admin.html';
      return;
    }
    state.session = session;
    setupHeader();
    bindEvents();

    window.SoforPanel = {
      showAlert,
      reloadRoutePoints: loadRoutePoints,
    };

    try {
      await loadRoutePoints();
      await loadTrips();
    } catch (err) {
      if (err.status === 401) {
        clearSession();
        location.href = 'GIRIS.html';
        return;
      }
      showAlert(err.message || 'Veriler yüklenemedi', 'error');
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
