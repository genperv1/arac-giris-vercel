/**
 * Şöför giriş — ayarlardaki özmal plaka/şoför listesini kullanır.
 */
(function (root) {
  'use strict';

  const SESSION_KEY = 'driverPanelSession_v1';

  function $(id) {
    return document.getElementById(id);
  }

  function hideMessage(el) {
    if (el) el.classList.add('hidden');
  }

  function showMessage(el, text) {
    if (!el) return;
    el.textContent = text;
    el.classList.remove('hidden');
  }

  function encodeAccountValue(plaka, driver) {
    return JSON.stringify({ plaka, driver });
  }

  function decodeAccountValue(raw) {
    if (!raw) return { plaka: '', driver: '' };
    try {
      const parsed = JSON.parse(raw);
      return {
        plaka: root.OzmalPlates ? root.OzmalPlates.formatPlateDisplay(parsed.plaka) : String(parsed.plaka || '').trim(),
        driver: root.OzmalPlates ? root.OzmalPlates.normDriverName(parsed.driver) : String(parsed.driver || '').trim(),
      };
    } catch (e) {
      return { plaka: '', driver: '' };
    }
  }

  function formatAccountLabel(plaka, driver, starred) {
    const plateLabel = root.OzmalPlates ? root.OzmalPlates.formatPlateDisplay(plaka) : plaka;
    const name = root.OzmalPlates ? root.OzmalPlates.normDriverName(driver) : driver;
    const driverLabel = starred ? `★ ${name}` : name;
    return `${plateLabel} · ${driverLabel}`;
  }

  function buildAccountOptions() {
    if (!root.OzmalPlates || typeof root.OzmalPlates.getDriverLoginAccounts !== 'function') {
      return [];
    }

    return root.OzmalPlates.getDriverLoginAccounts().map((item) => ({
      plaka: item.plaka,
      driver: item.driver,
      starred: !!item.starred,
      label: formatAccountLabel(item.plaka, item.driver, item.starred),
      value: encodeAccountValue(item.plaka, item.driver),
    }));
  }

  function populateAccountSelect() {
    const accountSelect = $('driverLoginAccount');
    if (!accountSelect) return;

    const current = accountSelect.value;
    const options = buildAccountOptions();

    accountSelect.innerHTML = '<option value="">Plaka ve şoför seçiniz</option>';
    options.forEach((item) => {
      const opt = document.createElement('option');
      opt.value = item.value;
      opt.textContent = item.label;
      accountSelect.appendChild(opt);
    });

    if (current && options.some((item) => item.value === current)) {
      accountSelect.value = current;
    }
  }

  function clearDriverLoginMessages() {
    hideMessage($('driverLoginError'));
    hideMessage($('driverLoginInfo'));
  }

  async function refreshDriverLoginOptions() {
    populateAccountSelect();
    if (!root.OzmalPlates || typeof root.OzmalPlates.ensureSynced !== 'function') return;
    try {
      await root.OzmalPlates.ensureSynced();
      populateAccountSelect();
    } catch (e) { /* önbellekteki liste kalsın */ }
  }

  function bindCollapsible() {
    const section = $('driverLoginSection');
    const toggle = $('driverLoginToggle');
    if (!section || !toggle) return;

    let optionsLoaded = false;

    toggle.addEventListener('click', () => {
      const willOpen = section.classList.contains('is-collapsed');
      section.classList.toggle('is-collapsed', !willOpen);
      toggle.setAttribute('aria-expanded', willOpen ? 'true' : 'false');

      if (willOpen && !optionsLoaded) {
        optionsLoaded = true;
        populateAccountSelect();
        refreshDriverLoginOptions();
      }
    });
  }

  function bootDriverLogin() {
    if (!$('driverLoginAccount')) return;
    bindDriverLoginEvents();
    bindCollapsible();
  }

  function saveDriverSession(data) {
    try {
      sessionStorage.setItem(
        SESSION_KEY,
        JSON.stringify({
          token: data.token,
          plaka: data.plaka,
          driver: data.driver,
          role: 'driver',
          ts: Date.now(),
        })
      );
    } catch (e) { /* ignore */ }
  }

  async function driverLogin() {
    const accountSelect = $('driverLoginAccount');
    const passwordInput = $('driverLoginPassword');
    const errorEl = $('driverLoginError');
    const infoEl = $('driverLoginInfo');
    const submitBtn = $('driverLoginButton');

    clearDriverLoginMessages();

    const { plaka, driver } = decodeAccountValue(accountSelect && accountSelect.value);
    const password = (passwordInput && passwordInput.value) || '';

    if (!plaka || !driver) {
      showMessage(errorEl, 'Lütfen plaka ve şoför seçiniz.');
      return;
    }
    if (!password.trim()) {
      showMessage(errorEl, 'Lütfen şifrenizi giriniz.');
      return;
    }

    if (submitBtn) submitBtn.disabled = true;
    try {
      const res = await fetch('/api/driver-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plaka, driver, password }),
      });
      let data = {};
      const contentType = String(res.headers.get('content-type') || '');
      if (contentType.includes('application/json')) {
        data = await res.json().catch(() => ({}));
      } else if (!res.ok) {
        showMessage(errorEl, `Sunucu hatası (${res.status}). Sunucunun çalıştığından emin olun.`);
        return;
      }
      if (!res.ok || !data.ok) {
        showMessage(errorEl, data.error || `Giriş başarısız (${res.status}).`);
        return;
      }
      saveDriverSession(data);
      showMessage(infoEl, 'Giriş başarılı, panel açılıyor…');
      location.href = 'sofor-panel.html';
    } catch (e) {
      const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
      showMessage(
        errorEl,
        offline
          ? 'İnternet bağlantısı yok.'
          : 'Sunucuya bağlanılamadı. Adres çubuğunda http://localhost:3000 olduğundan ve sunucunun (npm start) çalıştığından emin olun.'
      );
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  }

  function bindDriverLoginEvents() {
    const accountSelect = $('driverLoginAccount');
    const passwordInput = $('driverLoginPassword');
    const submitBtn = $('driverLoginButton');

    if (!accountSelect) return;

    accountSelect.addEventListener('change', () => {
      clearDriverLoginMessages();
      if (passwordInput) passwordInput.value = '';
    });

    if (passwordInput) {
      passwordInput.addEventListener('input', clearDriverLoginMessages);
      passwordInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') driverLogin();
      });
    }

    if (submitBtn) submitBtn.addEventListener('click', driverLogin);

    root.addEventListener('ozmal-plates-changed', () => {
      refreshDriverLoginOptions();
    });
  }

  async function initDriverLogin() {
    bootDriverLogin();
  }

  root.DriverAuth = {
    SESSION_KEY,
    initDriverLogin,
    refreshDriverLoginOptions,
    buildAccountOptions,
    driverLogin,
  };

  bootDriverLogin();
})(typeof window !== 'undefined' ? window : globalThis);
