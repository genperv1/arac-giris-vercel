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

  async function syncOzmalToServer(forceToast) {
    if (!window.OzmalPlates || typeof window.OzmalPlates.pushEntriesToServer !== 'function') return;
    const res = await window.OzmalPlates.pushEntriesToServer(window.OzmalPlates.getOzmalEntries());
    if (forceToast && res && res.ok === false && !res.skipped) {
      toast(res.error || 'Sunucuya kaydedilemedi.', true);
    }
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
        window.OzmalPlates.removeOzmalPlate(plate);
        await syncOzmalToServer(true);
        await loadOzmalAdminEntries();
        renderOzmalTable();
        toast('Plaka kaldırıldı.');
      });
    });

    tbody.querySelectorAll('.sp-driver-del').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const plate = btn.getAttribute('data-plate') || '';
        const driver = btn.getAttribute('data-driver') || '';
        window.OzmalPlates.removeOzmalDriver(plate, driver);
        await syncOzmalToServer(true);
        await loadOzmalAdminEntries();
        renderOzmalTable();
        toast('Şoför kaldırıldı.');
      });
    });

    tbody.querySelectorAll('.sp-driver-star').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const plate = btn.getAttribute('data-plate') || '';
        const driver = btn.getAttribute('data-driver') || '';
        const res = window.OzmalPlates.toggleOzmalDriverStar(plate, driver);
        if (!res.ok) {
          toast(res.error || 'Güncellenemedi.', true);
          return;
        }
        await syncOzmalToServer(true);
        await loadOzmalAdminEntries();
        renderOzmalTable();
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
      if (!window.OzmalPlates) return;
      const plate = document.getElementById('spOzmalPlateInput')?.value || '';
      const driver = document.getElementById('spOzmalDriverInput')?.value || '';
      const res = window.OzmalPlates.addOzmalPlate(plate, driver);
      if (!res.ok) {
        toast(res.error || 'Eklenemedi.', true);
        return;
      }
      await syncOzmalToServer(true);
      await loadOzmalAdminEntries();
      if (res.addedDriver) {
        document.getElementById('spOzmalDriverInput').value = '';
        const pwdEntry = ozmalAdminEntries
          .find((e) => window.OzmalPlates.normKey(e.plaka) === window.OzmalPlates.normKey(res.plate || plate))
          ?.drivers?.find((d) => window.OzmalPlates.normDriverName(d.name) === window.OzmalPlates.normDriverName(res.driver || driver));
        toast(`${res.driver || driver} eklendi${pwdEntry && pwdEntry.passwordPlain ? ' · Şifre: ' + pwdEntry.passwordPlain : ''}.`);
      } else {
        document.getElementById('spOzmalPlateInput').value = '';
        document.getElementById('spOzmalDriverInput').value = '';
        toast(`${res.plate || plate} eklendi.`);
      }
      renderOzmalTable();
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
    await window.OzmalPlates.ensureSynced();
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
