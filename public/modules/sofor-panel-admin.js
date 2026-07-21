(function () {
  'use strict';

  const API = '/api';
  let ozmalAdminEntries = [];
  let seferRoutePoints = [];

  function getToken() {
    try {
      const raw = sessionStorage.getItem('driverPanelSession_v1');
      const parsed = raw ? JSON.parse(raw) : null;
      return parsed && parsed.token ? parsed.token : '';
    } catch (e) {
      return '';
    }
  }

  async function officeApi(path, options) {
    const token = getToken();
    const res = await fetch(`${API}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...(options && options.headers ? options.headers : {}),
      },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'İstek başarısız');
    return data;
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function toast(msg, isError) {
    if (window.SoforPanel && typeof window.SoforPanel.showAlert === 'function') {
      window.SoforPanel.showAlert(msg, isError ? 'error' : 'ok');
      return;
    }
    alert(msg);
  }

  async function loadOzmalAdminEntries() {
    const data = await officeApi('/driver-panel/ozmal-entries');
    ozmalAdminEntries = data.entries || [];
  }

  async function persistAdminEntries(payload) {
    const data = await officeApi('/driver-panel/ozmal-entries', {
      method: 'POST',
      body: JSON.stringify({ entries: payload }),
    });
    await loadOzmalAdminEntries();
    if (window.OzmalPlates && typeof window.OzmalPlates.syncFromServer === 'function') {
      await window.OzmalPlates.syncFromServer();
    } else if (window.OzmalPlates && typeof window.OzmalPlates.applyRemoteEntries === 'function' && data.entries) {
      window.OzmalPlates.applyRemoteEntries(data.entries);
    }
    return data;
  }

  async function syncOzmalToServer(forceToast) {
    if (!window.OzmalPlates || typeof window.OzmalPlates.pushEntriesToServer !== 'function') {
      if (forceToast) toast('Sunucuya kaydedilemedi.', true);
      return { ok: false, skipped: true };
    }
    const res = await window.OzmalPlates.pushEntriesToServer(window.OzmalPlates.getOzmalEntries());
    if (forceToast && (!res || (res.ok === false && !res.skipped))) {
      toast(res?.error || 'Sunucuya kaydedilemedi.', true);
    }
    return res || { ok: false };
  }

  function entriesPayloadFromAdmin() {
    return ozmalAdminEntries.map((entry) => ({
      plaka: entry.plaka,
      bassofor: !!entry.bassofor,
      drivers: (entry.drivers || []).map((d) => ({
        name: typeof d === 'string' ? d : d.name,
        starred: !!(typeof d === 'object' && d && d.starred),
      })),
    }));
  }

  function renderOzmalTable() {
    const tbody = document.getElementById('spOzmalTbody');
    if (!tbody || !window.OzmalPlates) return;
    const entries = ozmalAdminEntries.length ? ozmalAdminEntries : window.OzmalPlates.getOzmalEntries();
    if (!entries.length) {
      tbody.innerHTML = '<tr><td colspan="4" class="sp-empty">Henüz özmal plaka yok.</td></tr>';
      return;
    }

    tbody.innerHTML = entries.map((entry, i) => {
      const p = entry.plaka;
      const bassofor = window.OzmalPlates.isBassoforPlate(p);
      const mark = bassofor
        ? '<span class="sp-badge sp-badge--boss"><i class="fas fa-crown" aria-hidden="true"></i> BAŞŞOFÖR</span>'
        : '<span class="sp-badge sp-badge--ozmal">★</span>';
      const drivers = (entry.drivers || []).length
        ? (entry.drivers || []).map((d) => {
          const name = typeof d === 'string' ? d : d.name;
          const starred = !!(typeof d === 'object' && d && d.starred);
          const pwd = typeof d === 'object' && d && d.passwordPlain ? d.passwordPlain : '—';
          return `<span class="sp-driver-chip${starred ? ' is-starred' : ''}">
            <button type="button" class="sp-driver-star" data-plate="${escapeHtml(p)}" data-driver="${escapeHtml(name)}" title="Menüde öne al">${starred ? '★' : '☆'}</button>
            <span class="sp-driver-name">${escapeHtml(name)}</span>
            <code class="sp-driver-pwd" title="Giriş şifresi">${escapeHtml(pwd)}</code>
            <button type="button" class="sp-driver-pwd-regen" data-plate="${escapeHtml(p)}" data-driver="${escapeHtml(name)}" title="Yeni şifre">↻</button>
            <button type="button" class="sp-driver-del" data-plate="${escapeHtml(p)}" data-driver="${escapeHtml(name)}" title="Kaldır">×</button>
          </span>`;
        }).join('')
        : '<span class="sp-muted">Şoför yok — girişte görünmez</span>';

      return `<tr>
        <td>${i + 1}</td>
        <td><strong>${escapeHtml(p)}</strong> ${mark}</td>
        <td class="sp-drivers-cell">${drivers}</td>
        <td><button type="button" class="sp-btn sp-btn--ghost sp-ozmal-del" data-plate="${escapeHtml(p)}">Kaldır</button></td>
      </tr>`;
    }).join('');

    tbody.querySelectorAll('.sp-ozmal-del').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const plate = btn.getAttribute('data-plate') || '';
        if (!plate || !confirm(`${plate} listeden kaldırılsın mı?`)) return;
        try {
          await loadOzmalAdminEntries();
          const payload = entriesPayloadFromAdmin().filter(
            (entry) => window.OzmalPlates.normKey(entry.plaka) !== window.OzmalPlates.normKey(plate)
          );
          await persistAdminEntries(payload);
          renderOzmalTable();
          toast('Plaka kaldırıldı.');
        } catch (e) {
          toast(e.message || 'Kaldırılamadı.', true);
        }
      });
    });

    tbody.querySelectorAll('.sp-driver-del').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const plate = btn.getAttribute('data-plate') || '';
        const driver = btn.getAttribute('data-driver') || '';
        try {
          await loadOzmalAdminEntries();
          const payload = entriesPayloadFromAdmin().map((entry) => {
            if (window.OzmalPlates.normKey(entry.plaka) !== window.OzmalPlates.normKey(plate)) return entry;
            return {
              ...entry,
              drivers: (entry.drivers || []).filter(
                (d) => window.OzmalPlates.normDriverName(d.name) !== window.OzmalPlates.normDriverName(driver)
              ),
            };
          });
          await persistAdminEntries(payload);
          renderOzmalTable();
          toast('Şoför kaldırıldı.');
        } catch (e) {
          toast(e.message || 'Kaldırılamadı.', true);
        }
      });
    });

    tbody.querySelectorAll('.sp-driver-star').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const plate = btn.getAttribute('data-plate') || '';
        const driver = btn.getAttribute('data-driver') || '';
        try {
          await loadOzmalAdminEntries();
          const payload = entriesPayloadFromAdmin().map((entry) => {
            if (window.OzmalPlates.normKey(entry.plaka) !== window.OzmalPlates.normKey(plate)) return entry;
            return {
              ...entry,
              drivers: (entry.drivers || []).map((d) => ({
                ...d,
                starred: window.OzmalPlates.normDriverName(d.name) === window.OzmalPlates.normDriverName(driver)
                  ? !d.starred
                  : !!d.starred,
              })),
            };
          });
          await persistAdminEntries(payload);
          renderOzmalTable();
        } catch (e) {
          toast(e.message || 'Güncellenemedi.', true);
        }
      });
    });

    tbody.querySelectorAll('.sp-driver-pwd-regen').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const plate = btn.getAttribute('data-plate') || '';
        const driver = btn.getAttribute('data-driver') || '';
        if (!confirm(`${driver} için yeni şifre oluşturulsun mu?`)) return;
        try {
          const data = await officeApi('/driver-panel/ozmal-regenerate-password', {
            method: 'POST',
            body: JSON.stringify({ plaka: plate, driver }),
          });
          await loadOzmalAdminEntries();
          if (window.OzmalPlates && typeof window.OzmalPlates.ensureSynced === 'function') {
            await window.OzmalPlates.ensureSynced();
          }
          renderOzmalTable();
          toast('Yeni şifre: ' + data.passwordPlain);
        } catch (e) {
          toast(e.message || 'Şifre oluşturulamadı.', true);
        }
      });
    });
  }

  function renderRoutePoints() {
    const wrap = document.getElementById('spRoutePointList');
    if (!wrap) return;
    if (!seferRoutePoints.length) {
      wrap.innerHTML = '<p class="sp-empty">Henüz rota noktası yok.</p>';
      return;
    }
    wrap.innerHTML = seferRoutePoints.map((point, idx) =>
      `<span class="sp-chip">${escapeHtml(point)}<button type="button" data-route-idx="${idx}" aria-label="Kaldır">×</button></span>`
    ).join('');
    wrap.querySelectorAll('[data-route-idx]').forEach((btn) => {
      btn.addEventListener('click', () => {
        seferRoutePoints.splice(Number(btn.getAttribute('data-route-idx')), 1);
        renderRoutePoints();
      });
    });
  }

  async function loadRoutePointsAdmin() {
    const data = await officeApi('/driver-route-points');
    seferRoutePoints = (data.points || []).slice();
    renderRoutePoints();
  }

  async function saveRoutePointsAdmin() {
    const data = await officeApi('/driver-panel/route-points', {
      method: 'POST',
      body: JSON.stringify({ points: seferRoutePoints }),
    });
    seferRoutePoints = data.points || seferRoutePoints;
    renderRoutePoints();
    if (window.SoforPanel && typeof window.SoforPanel.reloadRoutePoints === 'function') {
      await window.SoforPanel.reloadRoutePoints();
    }
    toast('Rota noktaları kaydedildi.');
  }

  function bindAdminUi() {
    document.getElementById('spOzmalAddBtn')?.addEventListener('click', async () => {
      const plate = document.getElementById('spOzmalPlateInput')?.value || '';
      const driver = document.getElementById('spOzmalDriverInput')?.value || '';
      if (!plate.trim()) {
        toast('Plaka giriniz.', true);
        return;
      }
      try {
        const data = await officeApi('/driver-panel/ozmal-add', {
          method: 'POST',
          body: JSON.stringify({ plaka: plate.trim(), driver: driver.trim() }),
        });
        if (!data.ok) {
          toast(data.error || 'Eklenemedi.', true);
          return;
        }
        await loadOzmalAdminEntries();
        if (window.OzmalPlates && typeof window.OzmalPlates.applyRemoteEntries === 'function' && data.entries) {
          window.OzmalPlates.applyRemoteEntries(data.entries);
        } else if (window.OzmalPlates && typeof window.OzmalPlates.syncFromServer === 'function') {
          await window.OzmalPlates.syncFromServer();
        }
        if (data.addedDriver) {
          document.getElementById('spOzmalDriverInput').value = '';
          toast(`${data.driver || driver} eklendi${data.passwordPlain ? ' · Şifre: ' + data.passwordPlain : ''}.`);
        } else {
          document.getElementById('spOzmalPlateInput').value = '';
          document.getElementById('spOzmalDriverInput').value = '';
          toast(`${data.plaka || plate} eklendi${data.passwordPlain ? ' · Şifre: ' + data.passwordPlain : ''}.`);
        }
        renderOzmalTable();
      } catch (e) {
        toast(e.message || 'Sunucuya kaydedilemedi.', true);
      }
    });

    document.getElementById('spRoutePointAddBtn')?.addEventListener('click', () => {
      const input = document.getElementById('spRoutePointInput');
      const val = String(input?.value || '').trim();
      if (!val) return;
      if (!seferRoutePoints.some((p) => String(p).toUpperCase() === val.toUpperCase())) {
        seferRoutePoints.push(val);
        seferRoutePoints.sort((a, b) => a.localeCompare(b, 'tr'));
      }
      if (input) input.value = '';
      renderRoutePoints();
    });

    document.getElementById('spRoutePointSaveBtn')?.addEventListener('click', () => {
      saveRoutePointsAdmin().catch((e) => toast(e.message, true));
    });
  }

  async function initOfficeAdmin() {
    if (!window.OzmalPlates) return;
    bindAdminUi();
    await loadOzmalAdminEntries();
    renderOzmalTable();
    await loadRoutePointsAdmin();
  }

  window.SoforPanelAdmin = {
    initOfficeAdmin,
    loadOzmalAdminEntries,
    renderOzmalTable,
    loadRoutePointsAdmin,
  };
})();
