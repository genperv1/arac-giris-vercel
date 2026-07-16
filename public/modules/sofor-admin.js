(function () {
  'use strict';

  const SESSION_KEY = 'driverPanelSession_v1';
  const API = '/api';

  const state = {
    session: null,
    trips: [],
    warnings: [],
    ozmalEntries: [],
    activeView: 'dashboard',
    activePlate: '',
    tripSearch: '',
    tripPlateFilter: '',
    plateAnalyticsPeriod: 'all',
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

  function clearSession() {
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

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function showAlert(text, type) {
    const el = $('saAlert');
    if (!el) return;
    if (!text) {
      el.classList.add('hidden');
      el.textContent = '';
      return;
    }
    el.textContent = text;
    el.className = `sa-alert ${type === 'ok' ? 'is-ok' : 'is-error'}`;
    el.classList.remove('hidden');
  }

  function formatDate(value) {
    if (!value) return '—';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' });
  }

  function formatRoute(trip) {
    const gidis = `${trip.yuklemeYeri || '?'} → ${trip.bosaltmaLiman || '?'}`;
    if (trip.bosDondu) return `${gidis} · BOŞ DÖNDÜ`;
    return `${gidis} · ${trip.donusYukleme || '?'} → ${trip.donusBosaltma || '?'}`;
  }

  function photoUrl(pathValue, tripId) {
    if (!pathValue) return '';
    const token = state.session && state.session.token;
    const parts = String(pathValue).replace(/\\/g, '/').split('/');
    const file = parts.pop();
    const id = tripId || parts.pop();
    if (!id || !file || !token) return '';
    return `${API}/driver-trips/photo/${encodeURIComponent(id)}/${encodeURIComponent(file)}?access_token=${encodeURIComponent(token)}`;
  }

  function sumKm(trips) {
    return trips.reduce((acc, t) => acc + (Number(t.km) || 0), 0);
  }

  function sumMazot(trips) {
    return trips.reduce((acc, t) => acc + (Number(t.mazotLt) || 0), 0);
  }

  function tripEfficiency(trip) {
    if (trip.yakitYuzde != null && Number.isFinite(Number(trip.yakitYuzde))) {
      return Number(trip.yakitYuzde);
    }
    const km = Number(trip.km);
    const mazot = Number(t.mazotLt);
    if (km > 0 && Number.isFinite(mazot)) return mazot / km;
    return null;
  }

  function formatLt100km(eff) {
    if (eff == null || !Number.isFinite(eff)) return '—';
    return (eff * 100).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function filterTripsByPeriod(trips, period) {
    if (period === 'all') return trips;
    const now = new Date();
    if (period === 'month') {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      return trips.filter((t) => new Date(t.gidisTarihi) >= start);
    }
    if (period === '3months') {
      const start = new Date(now);
      start.setMonth(start.getMonth() - 3);
      return trips.filter((t) => new Date(t.gidisTarihi) >= start);
    }
    return trips;
  }

  function computeAvgEfficiency(trips) {
    const valid = trips.filter((t) => tripEfficiency(t) != null);
    if (!valid.length) return null;
    const totalKm = valid.reduce((a, t) => a + (Number(t.km) || 0), 0);
    const totalMazot = valid.reduce((a, t) => a + (Number(t.mazotLt) || 0), 0);
    return totalKm > 0 ? totalMazot / totalKm : null;
  }

  function computeDriverStats(trips) {
    const map = new Map();
    trips.forEach((trip) => {
      const name = trip.driverName || '—';
      if (!map.has(name)) {
        map.set(name, { name, trips: [], km: 0, mazot: 0 });
      }
      const d = map.get(name);
      d.trips.push(trip);
      d.km += Number(trip.km) || 0;
      d.mazot += Number(t.mazotLt) || 0;
    });
    return [...map.values()].map((d) => ({
      name: d.name,
      tripCount: d.trips.length,
      km: d.km,
      mazot: d.mazot,
      avgEff: d.km > 0 ? d.mazot / d.km : null,
      avgKmPerTrip: d.trips.length > 0 ? d.km / d.trips.length : 0,
      sharePct: trips.length > 0 ? (d.trips.length / trips.length) * 100 : 0,
    })).sort((a, b) => (a.avgEff || 999) - (b.avgEff || 999));
  }

  function computeMonthlyTrend(trips, months) {
    const count = months || 6;
    const buckets = [];
    const now = new Date();
    for (let i = count - 1; i >= 0; i -= 1) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      buckets.push({
        key,
        label: d.toLocaleDateString('tr-TR', { month: 'short', year: '2-digit' }),
        km: 0,
        mazot: 0,
        trips: 0,
      });
    }
    trips.forEach((t) => {
      const dt = new Date(t.gidisTarihi);
      if (Number.isNaN(dt.getTime())) return;
      const key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
      const bucket = buckets.find((b) => b.key === key);
      if (!bucket) return;
      bucket.km += Number(t.km) || 0;
      bucket.mazot += Number(t.mazotLt) || 0;
      bucket.trips += 1;
    });
    return buckets;
  }

  function computeTopRoutes(trips, limit) {
    const map = new Map();
    trips.forEach((t) => {
      const route = formatRoute(t);
      if (!map.has(route)) map.set(route, { route, count: 0, km: 0, mazot: 0 });
      const r = map.get(route);
      r.count += 1;
      r.km += Number(t.km) || 0;
      r.mazot += Number(t.mazotLt) || 0;
    });
    return [...map.values()]
      .map((r) => ({ ...r, avgEff: r.km > 0 ? r.mazot / r.km : null }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit || 5);
  }

  function efficiencyClass(rank, total) {
    if (total <= 1) return 'is-best';
    if (rank === 0) return 'is-best';
    if (rank === total - 1) return 'is-worst';
    return 'is-mid';
  }

  function fleetCompareTag(plateEff, fleetEff) {
    if (plateEff == null || fleetEff == null) return { text: 'Filo karşılaştırması için yeterli veri yok', cls: '' };
    const diff = ((plateEff - fleetEff) / fleetEff) * 100;
    if (Math.abs(diff) < 3) {
      return { text: 'Filo ortalamasına yakın', cls: 'is-warn' };
    }
    if (diff < 0) {
      return { text: `Filo ort. %${Math.abs(diff).toFixed(1)} daha tasarruflu`, cls: 'is-good' };
    }
    return { text: `Filo ort. %${diff.toFixed(1)} daha yüksek tüketim`, cls: 'is-bad' };
  }

  function renderPlateAnalytics(plaka, allPlateTrips) {
    const wrap = $('saPlateAnalytics');
    if (!wrap) return;

    const trips = filterTripsByPeriod(allPlateTrips, state.plateAnalyticsPeriod);
    if (!trips.length) {
      wrap.innerHTML = '<div class="sa-analytics-card"><p class="sa-empty">Seçilen dönemde analiz için sefer kaydı yok.</p></div>';
      return;
    }

    const totalKm = sumKm(trips);
    const totalMazot = sumMazot(trips);
    const plateEff = computeAvgEfficiency(trips);
    const fleetEff = computeAvgEfficiency(state.trips);
    const drivers = computeDriverStats(trips);
    const monthly = computeMonthlyTrend(trips, 6);
    const routes = computeTopRoutes(trips, 5);
    const compare = fleetCompareTag(plateEff, fleetEff);
    const bestDriver = drivers[0];
    const worstDriver = drivers.length > 1 ? drivers[drivers.length - 1] : null;
    const maxDriverEff = Math.max(...drivers.map((d) => d.avgEff || 0), 0.0001);
    const maxMonthKm = Math.max(...monthly.map((m) => m.km), 1);
    const maxMonthFuel = Math.max(...monthly.map((m) => m.mazot), 1);

    const periodLabel = state.plateAnalyticsPeriod === 'month'
      ? 'Bu ay'
      : state.plateAnalyticsPeriod === '3months'
        ? 'Son 3 ay'
        : 'Tüm zamanlar';

    wrap.innerHTML = `
      <div class="sa-efficiency-hero">
        <div class="sa-efficiency-hero__ring">
          <strong>${formatLt100km(plateEff)}</strong>
          <small>lt / 100 km</small>
        </div>
        <div class="sa-efficiency-hero__body">
          <h3>${escapeHtml(plaka)} · Yakıt analizi</h3>
          <p>${periodLabel} · ${trips.length} sefer · ${totalKm.toLocaleString('tr-TR')} km · ${totalMazot.toLocaleString('tr-TR')} lt mazot</p>
          <div class="sa-efficiency-hero__tags">
            <span class="sa-tag ${compare.cls}"><i class="fas fa-balance-scale" aria-hidden="true"></i> ${compare.text}</span>
            ${bestDriver ? `<span class="sa-tag is-good"><i class="fas fa-leaf" aria-hidden="true"></i> En verimli: ${escapeHtml(bestDriver.name)}</span>` : ''}
            ${worstDriver && worstDriver.name !== bestDriver?.name ? `<span class="sa-tag is-bad"><i class="fas fa-fire" aria-hidden="true"></i> En yüksek: ${escapeHtml(worstDriver.name)}</span>` : ''}
          </div>
        </div>
      </div>

      <div class="sa-insight-row">
        <div class="sa-insight ${compare.cls || ''}">
          <div class="sa-insight__icon">⛽</div>
          <div class="sa-insight__label">Ort. tüketim</div>
          <div class="sa-insight__value">${formatLt100km(plateEff)}</div>
          <div class="sa-insight__hint">lt / 100 km</div>
        </div>
        <div class="sa-insight">
          <div class="sa-insight__icon">🛣️</div>
          <div class="sa-insight__label">Toplam KM</div>
          <div class="sa-insight__value">${totalKm.toLocaleString('tr-TR')}</div>
          <div class="sa-insight__hint">${trips.length} sefer</div>
        </div>
        <div class="sa-insight">
          <div class="sa-insight__icon">🛢️</div>
          <div class="sa-insight__label">Toplam mazot</div>
          <div class="sa-insight__value">${totalMazot.toLocaleString('tr-TR')} lt</div>
          <div class="sa-insight__hint">${drivers.length} şoför</div>
        </div>
        <div class="sa-insight">
          <div class="sa-insight__icon">📊</div>
          <div class="sa-insight__label">Filo ortalaması</div>
          <div class="sa-insight__value">${formatLt100km(fleetEff)}</div>
          <div class="sa-insight__hint">lt / 100 km (tüm plakalar)</div>
        </div>
      </div>

      <div class="sa-analytics-grid">
        <div class="sa-analytics-card">
          <h3>Şoför yakıt karşılaştırması</h3>
          <p>Düşük tüketim yeşil — kim ne kadar yakmış, bir bakışta görün.</p>
          <div class="sa-driver-bars">
            ${drivers.map((d, i) => {
              const pct = d.avgEff != null ? Math.round((d.avgEff / maxDriverEff) * 100) : 0;
              const cls = efficiencyClass(i, drivers.length);
              return `
                <div class="sa-driver-bar">
                  <div class="sa-driver-bar__name">
                    ${escapeHtml(d.name)}
                    <small>${d.tripCount} sefer · ${d.km.toLocaleString('tr-TR')} km</small>
                  </div>
                  <div class="sa-driver-bar__track">
                    <div class="sa-driver-bar__fill ${cls}" style="width:${Math.max(pct, 8)}%">${d.mazot.toLocaleString('tr-TR')} lt</div>
                  </div>
                  <div class="sa-driver-bar__val">${formatLt100km(d.avgEff)}</div>
                </div>
              `;
            }).join('')}
          </div>
        </div>

        <div class="sa-analytics-card">
          <h3>Aylık trend</h3>
          <p>Son 6 ay KM (mavi) ve mazot (yeşil) dağılımı.</p>
          <div class="sa-chart-legend">
            <span><i class="km"></i> KM</span>
            <span><i class="fuel"></i> Mazot (lt)</span>
          </div>
          <div class="sa-month-chart">
            ${monthly.map((m) => `
              <div class="sa-month-col">
                <div class="sa-month-col__bars">
                  <div class="sa-month-col__bar sa-month-col__bar--km" style="height:${Math.round((m.km / maxMonthKm) * 100)}%" title="${m.km.toLocaleString('tr-TR')} km"></div>
                  <div class="sa-month-col__bar sa-month-col__bar--fuel" style="height:${Math.round((m.mazot / maxMonthFuel) * 100)}%" title="${m.mazot.toLocaleString('tr-TR')} lt"></div>
                </div>
                <div class="sa-month-col__label">${escapeHtml(m.label)}</div>
                <div class="sa-month-col__count">${m.trips} sefer</div>
              </div>
            `).join('')}
          </div>
        </div>
      </div>

      <div class="sa-analytics-grid">
        <div class="sa-analytics-card">
          <h3>Şoför detay tablosu</h3>
          <p>Sefer payı, km ve ortalama tüketim karşılaştırması.</p>
          <div class="sa-table-wrap">
            <table class="sa-compare-table">
              <thead>
                <tr>
                  <th>Şoför</th>
                  <th>Sefer</th>
                  <th>KM</th>
                  <th>Mazot</th>
                  <th>lt/100km</th>
                  <th>Pay</th>
                </tr>
              </thead>
              <tbody>
                ${drivers.map((d, i) => {
                  const rowCls = i === 0 ? 'is-best' : (i === drivers.length - 1 && drivers.length > 1 ? 'is-worst' : '');
                  return `
                    <tr class="${rowCls}">
                      <td><strong>${escapeHtml(d.name)}</strong></td>
                      <td>${d.tripCount}</td>
                      <td>${d.km.toLocaleString('tr-TR')}</td>
                      <td>${d.mazot.toLocaleString('tr-TR')} lt</td>
                      <td><strong>${formatLt100km(d.avgEff)}</strong></td>
                      <td>%${d.sharePct.toFixed(0)}</td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          </div>
        </div>

        <div class="sa-analytics-card">
          <h3>En çok kullanılan rotalar</h3>
          <p>Hangi güzergâhta daha çok sefer ve ortalama tüketim.</p>
          <div class="sa-route-rank">
            ${routes.length ? routes.map((r, i) => `
              <div class="sa-route-item">
                <div class="sa-route-item__rank${i === 0 ? ' is-1' : ''}">${i + 1}</div>
                <div class="sa-route-item__route">${escapeHtml(r.route)}</div>
                <div class="sa-route-item__meta">${r.count}× · ${formatLt100km(r.avgEff)} lt/100km</div>
              </div>
            `).join('') : '<p class="sa-empty">Rota verisi yok.</p>'}
          </div>
        </div>
      </div>
    `;
  }

  function bindPlatePeriodTabs() {
    document.querySelectorAll('[data-sa-period]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.plateAnalyticsPeriod = btn.getAttribute('data-sa-period') || 'all';
        document.querySelectorAll('[data-sa-period]').forEach((b) => {
          b.classList.toggle('is-active', b === btn);
        });
        if (state.activeView === 'plate' && state.activePlate) {
          const trips = state.trips.filter((t) => t.plaka === state.activePlate);
          renderPlateAnalytics(state.activePlate, trips);
          const filtered = filterTripsByPeriod(trips, state.plateAnalyticsPeriod);
          $('saPlateTripsMeta').textContent = filtered.length ? `${filtered.length} kayıt (dönem)` : 'Kayıt yok';
        }
      });
    });
  }

  function groupByPlate(trips) {
    const map = new Map();
    trips.forEach((trip) => {
      const key = trip.plaka || '—';
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(trip);
    });
    return map;
  }

  function getPlateEntries() {
    if (state.ozmalEntries.length) return state.ozmalEntries;
    if (window.OzmalPlates && typeof window.OzmalPlates.getOzmalEntries === 'function') {
      return window.OzmalPlates.getOzmalEntries();
    }
    return [];
  }

  function renderWarnings() {
    const box = $('saKmWarnings');
    if (!box) return;
    if (!state.warnings.length) {
      box.classList.add('hidden');
      box.innerHTML = '';
      return;
    }
    box.innerHTML = `<strong>KM uyarıları</strong><br>${state.warnings.map((w) => {
      const trip = state.trips.find((t) => t.id === w.tripId);
      const plateLabel = trip ? `${trip.plaka} · ` : '';
      return `• ${plateLabel}${w.actualKm} km gidiş, önceki dönüş ${w.expectedKm} km (${w.diff > 0 ? '+' : ''}${w.diff})`;
    }).join('<br>')}`;
    box.classList.remove('hidden');
  }

  function renderStats() {
    const row = $('saStatsRow');
    if (!row) return;
    const trips = state.trips;
    const plates = new Set(trips.map((t) => t.plaka));
    const thisMonth = new Date();
    thisMonth.setDate(1);
    thisMonth.setHours(0, 0, 0, 0);
    const monthTrips = trips.filter((t) => new Date(t.gidisTarihi) >= thisMonth);

    row.innerHTML = `
      <div class="sa-stat">
        <div class="sa-stat__label">Toplam sefer</div>
        <div class="sa-stat__value">${trips.length}</div>
        <div class="sa-stat__hint">Tüm kayıtlar</div>
      </div>
      <div class="sa-stat">
        <div class="sa-stat__label">Aktif plaka</div>
        <div class="sa-stat__value">${plates.size}</div>
        <div class="sa-stat__hint">Sefer giren araç</div>
      </div>
      <div class="sa-stat">
        <div class="sa-stat__label">Bu ay KM</div>
        <div class="sa-stat__value">${sumKm(monthTrips).toLocaleString('tr-TR')}</div>
        <div class="sa-stat__hint">${monthTrips.length} sefer</div>
      </div>
      <div class="sa-stat">
        <div class="sa-stat__label">Bu ay mazot</div>
        <div class="sa-stat__value">${sumMazot(monthTrips).toLocaleString('tr-TR')} lt</div>
        <div class="sa-stat__hint">Toplam yakıt</div>
      </div>
    `;
  }

  function renderPlateCards() {
    const wrap = $('saPlateCards');
    if (!wrap) return;
    const byPlate = groupByPlate(state.trips);
    const entries = getPlateEntries();
    const plates = entries.length
      ? entries.map((e) => e.plaka)
      : [...byPlate.keys()].sort((a, b) => a.localeCompare(b, 'tr'));

    if (!plates.length) {
      wrap.innerHTML = '<p class="sa-empty">Henüz sefer kaydı yok. Şoförler mobil girişten kayıt girdikçe burada görünür.</p>';
      return;
    }

    wrap.innerHTML = plates.map((plaka) => {
      const trips = byPlate.get(plaka) || [];
      const last = trips[0];
      const drivers = entries.find((e) => e.plaka === plaka)?.drivers || [];
      const driverNames = drivers.map((d) => (typeof d === 'string' ? d : d.name)).filter(Boolean).join(', ') || '—';
      const avgEff = computeAvgEfficiency(trips);
      return `
        <article class="sa-plate-card" data-sa-plate="${escapeHtml(plaka)}">
          <div class="sa-plate-card__head">
            <span class="sa-plate-card__plate">${escapeHtml(plaka)}</span>
            <span class="sp-badge sp-badge--ozmal">${trips.length} sefer</span>
          </div>
          <div class="sa-plate-card__meta">
            <div>Şoförler: <strong>${escapeHtml(driverNames)}</strong></div>
            <div>Toplam KM: <strong>${sumKm(trips).toLocaleString('tr-TR')}</strong></div>
            <div>Ort. tüketim: <strong>${formatLt100km(avgEff)}</strong> lt/100km</div>
            <div>Son sefer: <strong>${last ? formatDate(last.gidisTarihi) : '—'}</strong></div>
          </div>
        </article>
      `;
    }).join('');

    wrap.querySelectorAll('[data-sa-plate]').forEach((card) => {
      card.addEventListener('click', () => {
        openPlateView(card.getAttribute('data-sa-plate') || '');
      });
    });
  }

  function renderPlateNav() {
    const nav = $('saPlateNav');
    if (!nav) return;
    const byPlate = groupByPlate(state.trips);
    const entries = getPlateEntries();
    const plates = entries.length
      ? entries.map((e) => e.plaka)
      : [...byPlate.keys()].sort((a, b) => a.localeCompare(b, 'tr'));

    if (!plates.length) {
      nav.innerHTML = '<p class="sa-nav__empty">Plaka yok</p>';
      return;
    }

    nav.innerHTML = plates.map((plaka) => {
      const count = (byPlate.get(plaka) || []).length;
      const active = state.activeView === 'plate' && state.activePlate === plaka ? ' is-active' : '';
      return `<button type="button" class="sa-nav__item${active}" data-sa-plate-nav="${escapeHtml(plaka)}">
        <i class="fas fa-truck" aria-hidden="true"></i> ${escapeHtml(plaka)}
        <small>${count}</small>
      </button>`;
    }).join('');

    nav.querySelectorAll('[data-sa-plate-nav]').forEach((btn) => {
      btn.addEventListener('click', () => {
        openPlateView(btn.getAttribute('data-sa-plate-nav') || '');
      });
    });
  }

  function filteredTrips() {
    let trips = state.trips.slice();
    if (state.tripPlateFilter) {
      trips = trips.filter((t) => t.plaka === state.tripPlateFilter);
    }
    if (state.tripSearch.trim()) {
      const q = state.tripSearch.trim().toUpperCase();
      trips = trips.filter((t) =>
        String(t.plaka || '').toUpperCase().includes(q)
        || String(t.driverName || '').toUpperCase().includes(q)
        || formatRoute(t).toUpperCase().includes(q)
      );
    }
    return trips;
  }

  function renderTripsTable() {
    const tbody = $('saTripsTbody');
    const meta = $('saTripsMeta');
    if (!tbody) return;

    const trips = filteredTrips();
    if (meta) meta.textContent = trips.length ? `${trips.length} kayıt` : 'Kayıt yok';

    if (!trips.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="sa-empty">Kayıt bulunamadı.</td></tr>';
      return;
    }

    tbody.innerHTML = trips.map((trip) => `
      <tr>
        <td>${formatDate(trip.gidisTarihi)}</td>
        <td><strong>${escapeHtml(trip.plaka)}</strong></td>
        <td>${escapeHtml(trip.driverName)}</td>
        <td>${escapeHtml(formatRoute(trip))}</td>
        <td>${trip.km ?? '—'}</td>
        <td>${trip.mazotLt ?? '—'} lt</td>
        <td>
          <button type="button" class="sa-btn sa-btn--ghost" data-sa-view-trip="${escapeHtml(trip.id)}">Detay</button>
        </td>
      </tr>
    `).join('');

    tbody.querySelectorAll('[data-sa-view-trip]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const trip = state.trips.find((t) => t.id === btn.getAttribute('data-sa-view-trip'));
        if (trip) openDetail(trip);
      });
    });
  }

  function populateTripFilters() {
    const select = $('saTripPlateFilter');
    if (!select) return;
    const plates = [...new Set(state.trips.map((t) => t.plaka))].sort((a, b) => a.localeCompare(b, 'tr'));
    const current = state.tripPlateFilter;
    select.innerHTML = '<option value="">Tüm plakalar</option>'
      + plates.map((p) => `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`).join('');
    select.value = current;
  }

  function renderPlateView() {
    const plaka = state.activePlate;
    const trips = state.trips.filter((t) => t.plaka === plaka);
    const periodTrips = filterTripsByPeriod(trips, state.plateAnalyticsPeriod);
    const entries = getPlateEntries();
    const entry = entries.find((e) => e.plaka === plaka);
    const drivers = (entry?.drivers || []).map((d) => (typeof d === 'string' ? d : d.name)).join(', ') || '—';

    $('saPlateHero').innerHTML = `
      <div>
        <h2>${escapeHtml(plaka)}</h2>
        <p>Şoförler: ${escapeHtml(drivers)}</p>
      </div>
      <span class="sp-badge sp-badge--ozmal">${trips.length} sefer kaydı</span>
    `;

    const plateEff = computeAvgEfficiency(periodTrips);
    $('saPlateStats').innerHTML = `
      <div class="sa-stat">
        <div class="sa-stat__label">Toplam KM</div>
        <div class="sa-stat__value">${sumKm(periodTrips).toLocaleString('tr-TR')}</div>
      </div>
      <div class="sa-stat">
        <div class="sa-stat__label">Toplam mazot</div>
        <div class="sa-stat__value">${sumMazot(periodTrips).toLocaleString('tr-TR')} lt</div>
      </div>
      <div class="sa-stat">
        <div class="sa-stat__label">Ort. tüketim</div>
        <div class="sa-stat__value">${formatLt100km(plateEff)}</div>
        <div class="sa-stat__hint">lt / 100 km</div>
      </div>
    `;

    renderPlateAnalytics(plaka, trips);

    $('saPlateTripsTitle').textContent = `${plaka} seferleri`;
    $('saPlateTripsMeta').textContent = periodTrips.length ? `${periodTrips.length} kayıt` : 'Kayıt yok';

    const list = $('saPlateTripsList');
    if (!periodTrips.length) {
      list.innerHTML = '<p class="sa-empty">Bu plakaya ait sefer yok.</p>';
      return;
    }

    list.innerHTML = periodTrips.map((trip) => `
      <article class="sa-trip-card">
        <div class="sa-trip-card__route">${escapeHtml(formatRoute(trip))}</div>
        <div class="sa-trip-card__meta">
          ${escapeHtml(trip.driverName)} · ${formatDate(trip.gidisTarihi)} → ${formatDate(trip.donusTarihi)}<br>
          KM: <strong>${trip.km ?? '—'}</strong> · Mazot: <strong>${trip.mazotLt ?? '—'} lt</strong>
          · Tüketim: <strong>${formatLt100km(tripEfficiency(trip))}</strong> lt/100km
        </div>
        <div class="sa-trip-card__actions">
          <button type="button" class="sa-btn sa-btn--ghost" data-sa-view-trip="${escapeHtml(trip.id)}">Detay</button>
        </div>
      </article>
    `).join('');

    list.querySelectorAll('[data-sa-view-trip]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const trip = state.trips.find((t) => t.id === btn.getAttribute('data-sa-view-trip'));
        if (trip) openDetail(trip);
      });
    });
  }

  function renderDetailPhoto(label, pathValue, tripId) {
    const url = photoUrl(pathValue, tripId);
    if (!url) return `<div><strong>${escapeHtml(label)}</strong><p class="sa-empty">Yok</p></div>`;
    return `<div><strong>${escapeHtml(label)}</strong><img src="${url}" alt="${escapeHtml(label)}"></div>`;
  }

  function openDetail(trip) {
    const modal = $('saDetailModal');
    const body = $('saDetailBody');
    $('saDetailTitle').textContent = formatRoute(trip);
    body.innerHTML = `
      <div class="sa-detail-grid">
        <div><strong>Plaka / Şoför</strong>${escapeHtml(trip.plaka)} · ${escapeHtml(trip.driverName)}</div>
        <div><strong>Gidiş</strong>${escapeHtml(trip.yuklemeYeri)} → ${escapeHtml(trip.bosaltmaLiman)} · ${formatDate(trip.gidisTarihi)} · ${trip.aracGidisKm ?? '—'} km</div>
        <div><strong>Dönüş</strong>${trip.bosDondu ? 'Boş döndü' : `${escapeHtml(trip.donusYukleme)} → ${escapeHtml(trip.donusBosaltma)}`} · ${formatDate(trip.donusTarihi)} · ${trip.aracDonusKm ?? '—'} km</div>
        <div><strong>Toplam KM / Mazot</strong>${trip.km ?? '—'} km · ${trip.mazotLt ?? '—'} lt ${trip.yakitYuzde != null ? `( ${Number(trip.yakitYuzde).toFixed(4)} lt/km )` : ''}</div>
        ${trip.aciklama ? `<div><strong>Açıklama</strong>${escapeHtml(trip.aciklama)}</div>` : ''}
      </div>
      <div class="sa-detail-photos">
        ${renderDetailPhoto('Gidiş irsaliye', trip.photoGidisIrsaliye, trip.id)}
        ${renderDetailPhoto('Gidiş kantar', trip.photoGidisKantar, trip.id)}
        ${trip.bosDondu ? '' : renderDetailPhoto('Dönüş irsaliye', trip.photoDonusIrsaliye, trip.id)}
        ${trip.bosDondu ? '' : renderDetailPhoto('Dönüş kantar', trip.photoDonusKantar, trip.id)}
      </div>
    `;
    $('saDetailEditBtn').onclick = () => {
      showAlert('Düzenleme şoför panelinden veya yakında ofis düzenleme ile yapılacak.', 'ok');
    };
    modal.classList.remove('hidden');
  }

  function setPageTitle(title, sub) {
    $('saPageTitle').textContent = title;
    $('saPageSub').textContent = sub || '';
  }

  function switchView(viewId, plate) {
    state.activeView = viewId;
    if (plate !== undefined) state.activePlate = plate;

    document.querySelectorAll('[data-sa-view]').forEach((section) => {
      if (section.classList.contains('sa-nav__item')) return;
      section.classList.toggle('hidden', section.getAttribute('data-sa-view') !== viewId);
    });

    document.querySelectorAll('.sa-nav__item[data-sa-view]').forEach((btn) => {
      btn.classList.toggle('is-active', btn.getAttribute('data-sa-view') === viewId);
    });

    renderPlateNav();

    if (viewId === 'dashboard') {
      setPageTitle('Genel Bakış', 'Tüm özmal araçların sefer verileri burada toplanır.');
      renderStats();
      renderPlateCards();
    } else if (viewId === 'trips') {
      setPageTitle('Tüm Seferler', 'Filtreleyin, arayın ve detay görüntüleyin.');
      populateTripFilters();
      renderTripsTable();
    } else if (viewId === 'plate') {
      setPageTitle(state.activePlate, 'Yakıt analizi, şoför karşılaştırması ve sefer geçmişi.');
      renderPlateView();
    } else if (viewId === 'drivers') {
      setPageTitle('Şoförler & Şifreler', 'Giriş ekranı plaka/şoför listesi ve şifre yönetimi.');
      if (window.SoforPanelAdmin) {
        window.SoforPanelAdmin.loadOzmalAdminEntries()
          .then(() => window.SoforPanelAdmin.renderOzmalTable())
          .catch((e) => showAlert(e.message, 'error'));
      }
    } else if (viewId === 'routes') {
      setPageTitle('Rota Noktaları', 'Şoför formlarında önerilen yükleme/boşaltma noktaları.');
      if (window.SoforPanelAdmin) {
        window.SoforPanelAdmin.loadRoutePointsAdmin().catch((e) => showAlert(e.message, 'error'));
      }
    }
  }

  function openPlateView(plaka) {
    if (!plaka) return;
    switchView('plate', plaka);
  }

  async function loadTrips() {
    const data = await api('/driver-trips');
    state.trips = (data.trips || []).slice().sort((a, b) => {
      const ta = new Date(a.gidisTarihi || 0).getTime();
      const tb = new Date(b.gidisTarihi || 0).getTime();
      return tb - ta;
    });
    state.warnings = data.warnings || [];
    renderWarnings();
    renderPlateNav();
    if (state.activeView === 'dashboard') {
      renderStats();
      renderPlateCards();
    } else if (state.activeView === 'trips') {
      renderTripsTable();
    } else if (state.activeView === 'plate') {
      renderPlateView();
    }
  }

  async function loadOzmalEntries() {
    try {
      const data = await api('/driver-panel/ozmal-entries');
      state.ozmalEntries = data.entries || [];
    } catch (e) {
      state.ozmalEntries = getPlateEntries();
    }
  }

  function bindEvents() {
    document.querySelectorAll('.sa-nav__item[data-sa-view]').forEach((btn) => {
      btn.addEventListener('click', () => {
        switchView(btn.getAttribute('data-sa-view') || 'dashboard');
      });
    });

    $('saRefreshBtn')?.addEventListener('click', () => {
      refreshAll().catch((e) => showAlert(e.message, 'error'));
    });

    $('saTripSearch')?.addEventListener('input', (e) => {
      state.tripSearch = e.target.value;
      renderTripsTable();
    });

    $('saTripPlateFilter')?.addEventListener('change', (e) => {
      state.tripPlateFilter = e.target.value;
      renderTripsTable();
    });

    $('saLogoutBtn')?.addEventListener('click', () => {
      clearSession();
      location.href = 'GIRIS.html';
    });

    $('saBackToApp')?.addEventListener('click', () => {
      location.href = 'GIRIS.html';
    });

    document.querySelectorAll('[data-sa-close]').forEach((el) => {
      el.addEventListener('click', () => $('saDetailModal').classList.add('hidden'));
    });

    bindPlatePeriodTabs();
  }

  async function refreshAll() {
    await loadTrips();
    await loadOzmalEntries();
    showAlert('Veriler güncellendi.', 'ok');
    setTimeout(() => showAlert('', 'ok'), 2000);
  }

  async function init() {
    const session = loadSession();
    if (!session || !session.token) {
      location.href = 'GIRIS.html';
      return;
    }
    if (session.role !== 'office') {
      location.href = 'sofor-panel.html';
      return;
    }
    state.session = session;
    bindEvents();

    window.SoforPanel = {
      showAlert: (msg, type) => showAlert(msg, type === 'error' ? 'error' : 'ok'),
      reloadRoutePoints: async () => {},
    };

    state.ozmalEntries = getPlateEntries();
    switchView('dashboard');

    try {
      await Promise.all([
        window.OzmalPlates && typeof window.OzmalPlates.ensureSynced === 'function'
          ? window.OzmalPlates.ensureSynced()
          : Promise.resolve(),
        loadTrips(),
        loadOzmalEntries(),
        window.SoforPanelAdmin ? window.SoforPanelAdmin.initOfficeAdmin() : Promise.resolve(),
      ]);
      renderStats();
      renderPlateCards();
      renderPlateNav();
      if (state.activeView === 'trips') renderTripsTable();
      if (state.activeView === 'plate') renderPlateView();
    } catch (err) {
      if (err.status === 401 || err.status === 403) {
        clearSession();
        location.href = 'GIRIS.html';
        return;
      }
      showAlert(err.message || 'Panel yüklenemedi', 'error');
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
