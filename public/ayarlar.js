// ayarlar.js — Plaka istatistikleri + imza yönetimi
(function () {
  'use strict';

  const TR_TZ = 'Europe/Istanbul';
  const PAGE_SIZE = 20;

  let currentTab = 'top';
  let idleDays = 60;
  let plakaPage = 1;
  let plakaHasMore = false;
  let searchDebounce = null;
  let activeSection = 'section-plaka';

  function authHeaders(json) {
    const token = (function () {
      try { return localStorage.getItem('authToken') || ''; } catch (e) { return ''; }
    })();
    const h = { 'Cache-Control': 'no-cache' };
    if (json) h['Content-Type'] = 'application/json';
    if (token) h.Authorization = 'Bearer ' + token;
    return h;
  }

  function apiFetch(url, opts) {
    return fetch(url, Object.assign({ credentials: 'include', headers: authHeaders(!!(opts && opts.body)) }, opts || {}));
  }

  function fmtTs(ts) {
    if (!ts) return '—';
    try {
      return new Date(Number(ts)).toLocaleString('tr-TR', { timeZone: TR_TZ });
    } catch (e) {
      return '—';
    }
  }

  function escapeHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function toast(msg, isErr) {
    const el = document.getElementById('ayToast');
    if (!el) return;
    el.textContent = msg;
    el.className = 'toast show' + (isErr ? ' warn' : '');
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove('show'), 3200);
  }

  function scrollToSection(id, opts) {
    opts = opts || {};
    const el = document.getElementById(id);
    if (!el) return;
    activeSection = id;
    document.querySelectorAll('.ay-subnav-btn').forEach((btn) => {
      btn.classList.toggle('is-active', btn.getAttribute('data-goto') === id);
    });
    el.scrollIntoView({ behavior: opts.smooth === false ? 'auto' : 'smooth', block: 'start' });
    if (opts.focus !== false) {
      try { el.focus({ preventScroll: true }); } catch (e) { el.setAttribute('tabindex', '-1'); el.focus(); }
    }
  }

  function updatePagerUi() {
    const info = document.getElementById('plakaPagerInfo');
    const prev = document.getElementById('plakaPrev');
    const next = document.getElementById('plakaNext');
    if (info) {
      info.textContent = 'Sayfa ' + plakaPage + ' · sayfa başına ' + PAGE_SIZE + ' kayıt';
    }
    if (prev) prev.disabled = plakaPage <= 1;
    if (next) next.disabled = !plakaHasMore;
  }

  async function ensureSession() {
    if (window.SessionManager && typeof window.SessionManager.requireValidSession === 'function') {
      return window.SessionManager.requireValidSession();
    }
    try {
      const r = await fetch('/api/me', { credentials: 'include', headers: authHeaders(false) });
      return r.ok;
    } catch (e) {
      return false;
    }
  }

  async function loadSummary() {
    try {
      const r = await apiFetch('/api/plaka-stats/summary?days=' + encodeURIComponent(idleDays));
      if (!r.ok) return;
      const d = await r.json();
      const set = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.textContent = String(val ?? '—');
      };
      set('sumUnique', d.uniquePlates);
      set('sumTotalPrints', d.totalPrints);
      set('sumOnce', d.onceCount);
      set('sumNever', d.neverPrintedRegistered);
      set('sumIdle', d.idleCount);
    } catch (e) {
      console.warn('summary load', e);
    }
  }

  async function loadPlakaTable() {
    const tbody = document.getElementById('plakaTbody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="5" class="ay-empty">Yükleniyor…</td></tr>';
    const q = (document.getElementById('plakaSearch')?.value || '').trim();
    const offset = (plakaPage - 1) * PAGE_SIZE;
    try {
      const url = '/api/plaka-stats?tab=' + encodeURIComponent(currentTab) +
        '&days=' + encodeURIComponent(idleDays) +
        '&search=' + encodeURIComponent(q) +
        '&limit=' + PAGE_SIZE +
        '&offset=' + offset;
      const r = await apiFetch(url);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const data = await r.json();
      const items = data.items || [];
      plakaHasMore = items.length >= PAGE_SIZE;

      if (!items.length) {
        tbody.innerHTML = '<tr><td colspan="5" class="ay-empty">Kayıt bulunamadı.</td></tr>';
        updatePagerUi();
        return;
      }

      const rowNumStart = offset + 1;
      tbody.innerHTML = items.map((row, i) => {
        const badge = row.kayitli
          ? '<span class="ay-badge ay-badge--ok">Kayıtlı</span>'
          : '<span class="ay-badge">Kayıtsız</span>';
        const extra = currentTab === 'idle' && row.idleKind === 'never_printed'
          ? ' <span class="ay-badge ay-badge--warn">Hiç yazdırılmamış</span>'
          : '';
        return `<tr data-plaka="${escapeHtml(row.plaka)}" title="Detay için tıklayın">
          <td class="col-num">${rowNumStart + i}</td>
          <td class="col-plate">${escapeHtml(row.plaka)}</td>
          <td>${badge}${extra}</td>
          <td class="col-num">${row.printCount ?? 0}</td>
          <td>${fmtTs(row.lastPrintTs)}</td>
        </tr>`;
      }).join('');

      tbody.querySelectorAll('tr[data-plaka]').forEach((tr) => {
        tr.addEventListener('click', () => openPlakaModal(tr.getAttribute('data-plaka')));
      });
      updatePagerUi();
    } catch (e) {
      tbody.innerHTML = '<tr><td colspan="5" class="ay-empty" style="color:#dc2626">Liste yüklenemedi.</td></tr>';
      plakaHasMore = false;
      updatePagerUi();
      console.error(e);
    }
  }

  function closePlakaModal() {
    const modal = document.getElementById('plakaModal');
    if (modal) modal.hidden = true;
    document.body.style.overflow = '';
    document.querySelectorAll('#plakaTbody tr.is-selected').forEach((tr) => tr.classList.remove('is-selected'));
  }

  async function openPlakaModal(plaka) {
    const modal = document.getElementById('plakaModal');
    const body = document.getElementById('plakaModalBody');
    const title = document.getElementById('plakaModalTitle');
    if (!modal || !body || !plaka) return;

    document.querySelectorAll('#plakaTbody tr[data-plaka]').forEach((tr) => {
      tr.classList.toggle('is-selected', tr.getAttribute('data-plaka') === plaka);
    });

    title.textContent = plaka;
    body.innerHTML = '<p class="ay-empty">Yükleniyor…</p>';
    modal.hidden = false;
    document.body.style.overflow = 'hidden';

    try {
      const r = await apiFetch('/api/print_history?plaka=' + encodeURIComponent(plaka) + '&limit=30');
      if (!r.ok) throw new Error('history');
      const rows = await r.json();
      if (!rows.length) {
        body.innerHTML = '<p class="ay-empty">Bu plaka için yazdırma kaydı yok.</p>';
        return;
      }
      body.innerHTML = rows.map((h) => `
        <div class="ay-detail-row">
          <strong>${fmtTs(h.tarih)}</strong>
          <span>${escapeHtml(h.firma || '—')} · ${escapeHtml(h.malzeme || '—')} · ${escapeHtml(h.basim_yeri || h.basimYeri || '—')}</span>
        </div>`).join('');
    } catch (e) {
      body.innerHTML = '<p class="ay-empty" style="color:#dc2626">Geçmiş yüklenemedi.</p>';
    }
  }

  function setActiveTab(tab, opts) {
    opts = opts || {};
    currentTab = tab;
    plakaPage = 1;
    document.querySelectorAll('[data-plaka-tab]').forEach((btn) => {
      btn.classList.toggle('is-active', btn.getAttribute('data-plaka-tab') === tab);
    });
    const hints = {
      top: 'En çok yazdırılan plakalar (yüksekten düşüğe). Satıra tıklayınca detay açılır.',
      once: 'Yalnızca bir kez yazdırılmış plakalar.',
      never: 'Sistemde kayıtlı, hiç yazdırılmamış araçlar.',
      idle: 'Son ' + idleDays + ' gündür yazdırılmayan veya hiç gelmeyen kayıtlı araçlar.'
    };
    const hintEl = document.getElementById('tabHint');
    if (hintEl) hintEl.textContent = hints[tab] || '';
    if (opts.scroll !== false) scrollToSection('section-plaka', { smooth: true });
    loadPlakaTable();
  }

  async function loadSignaturesList() {
    const kantarEl = document.getElementById('sigListKantar');
    const sahaEl = document.getElementById('sigListSaha');
    if (!kantarEl || !sahaEl) return;
    kantarEl.innerHTML = '<p style="font-size:.75rem;color:var(--rp-muted)">Yükleniyor…</p>';
    sahaEl.innerHTML = '<p style="font-size:.75rem;color:var(--rp-muted)">Yükleniyor…</p>';
    try {
      const r = await apiFetch('/api/signatures');
      if (!r.ok) throw new Error('list');
      const rows = await r.json();
      const renderGroup = (role, container) => {
        const list = rows.filter((x) => x.role === role);
        if (!list.length) {
          container.innerHTML = '<p style="font-size:.75rem;color:var(--rp-muted)">Henüz kayıt yok.</p>';
          return;
        }
        container.innerHTML = list.map((sig) => `
          <div class="ay-sig-card" data-id="${escapeHtml(sig.id)}">
            <img src="/api/signatures/${encodeURIComponent(sig.id)}/image" alt="" loading="lazy" onerror="this.style.display='none'">
            <div class="ay-sig-meta">
              <strong>${escapeHtml(sig.displayName)}</strong>
              <button type="button" class="ay-sig-del" data-del="${escapeHtml(sig.id)}">Sil</button>
            </div>
          </div>`).join('');
        container.querySelectorAll('[data-del]').forEach((btn) => {
          btn.addEventListener('click', async (ev) => {
            ev.stopPropagation();
            const id = btn.getAttribute('data-del');
            if (!id || !(await confirm('Bu imzayı silmek istiyor musunuz?'))) return;
            const dr = await apiFetch('/api/signatures/' + encodeURIComponent(id), { method: 'DELETE' });
            if (dr.ok) {
              toast('İmza silindi.');
              if (window.SignatureRegistry) window.SignatureRegistry.invalidate();
              loadSignaturesList();
            } else toast('Silinemedi.', true);
          });
        });
      };
      renderGroup('kantar', kantarEl);
      renderGroup('saha', sahaEl);
    } catch (e) {
      kantarEl.innerHTML = sahaEl.innerHTML = '<p style="font-size:.75rem;color:#dc2626">Liste yüklenemedi.</p>';
    }
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  async function submitSignature(ev) {
    ev.preventDefault();
    const name = (document.getElementById('sigName')?.value || '').trim();
    const role = document.getElementById('sigRole')?.value || 'kantar';
    const file = document.getElementById('sigFile')?.files?.[0];
    if (!name) { toast('Ad soyad girin.', true); return; }
    if (!file) { toast('PNG dosyası seçin.', true); return; }
    if (!/^image\/png$/i.test(file.type)) { toast('Yalnızca PNG kabul edilir.', true); return; }
    if (file.size > 1_500_000) { toast('Dosya çok büyük (max ~1.5 MB).', true); return; }
    try {
      const imageData = await readFileAsDataUrl(file);
      const r = await apiFetch('/api/signatures', {
        method: 'POST',
        body: JSON.stringify({ displayName: name.toUpperCase(), role, imageData })
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) { toast(data.error || 'Kayıt başarısız.', true); return; }
      toast('İmza kaydedildi.');
      document.getElementById('sigForm')?.reset();
      const prev = document.getElementById('sigPreview');
      if (prev) prev.innerHTML = '';
      if (window.SignatureRegistry) window.SignatureRegistry.invalidate();
      loadSignaturesList();
    } catch (e) {
      toast('Kayıt hatası.', true);
    }
  }

  function bindUi() {
    document.querySelectorAll('.ay-subnav-btn[data-goto]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-goto');
        if (id) scrollToSection(id);
      });
    });

    document.querySelectorAll('.ay-stat[data-goto-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const tab = btn.getAttribute('data-goto-tab');
        if (tab) setActiveTab(tab);
      });
    });

    document.querySelectorAll('[data-plaka-tab]').forEach((btn) => {
      btn.addEventListener('click', () => setActiveTab(btn.getAttribute('data-plaka-tab'), { scroll: false }));
    });

    document.getElementById('plakaSearch')?.addEventListener('input', () => {
      clearTimeout(searchDebounce);
      searchDebounce = setTimeout(() => {
        plakaPage = 1;
        loadPlakaTable();
      }, 280);
    });

    document.getElementById('idleDays')?.addEventListener('change', (e) => {
      idleDays = Math.min(365, Math.max(7, Number(e.target.value) || 60));
      plakaPage = 1;
      loadSummary();
      if (currentTab === 'idle') loadPlakaTable();
    });

    document.getElementById('plakaPrev')?.addEventListener('click', () => {
      if (plakaPage > 1) {
        plakaPage -= 1;
        loadPlakaTable();
      }
    });

    document.getElementById('plakaNext')?.addEventListener('click', () => {
      if (plakaHasMore) {
        plakaPage += 1;
        loadPlakaTable();
      }
    });

    document.getElementById('plakaModalClose')?.addEventListener('click', closePlakaModal);
    document.getElementById('plakaModal')?.addEventListener('click', (e) => {
      if (e.target.id === 'plakaModal') closePlakaModal();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closePlakaModal();
    });

    document.getElementById('sigForm')?.addEventListener('submit', submitSignature);
    document.getElementById('sigFile')?.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      const prev = document.getElementById('sigPreview');
      if (!prev) return;
      if (!file) { prev.innerHTML = ''; return; }
      try {
        const url = await readFileAsDataUrl(file);
        prev.innerHTML = '<img src="' + url + '" alt="Önizleme">';
      } catch (err) {
        prev.innerHTML = '';
      }
    });

    document.getElementById('backBtn')?.addEventListener('click', () => {
      try {
        if (window.SessionManager?.navigateToHome) window.SessionManager.navigateToHome();
        else location.href = 'GIRIS.html';
      } catch (e) {
        location.href = 'GIRIS.html';
      }
    });

    const obs = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const id = entry.target.id;
        if (id === 'section-plaka' || id === 'section-imza') {
          activeSection = id;
          document.querySelectorAll('.ay-subnav-btn').forEach((btn) => {
            btn.classList.toggle('is-active', btn.getAttribute('data-goto') === id);
          });
        }
      });
    }, { rootMargin: '-40% 0px -45% 0px', threshold: 0 });
    ['section-plaka', 'section-imza'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) obs.observe(el);
    });
  }

  function applyHashSection() {
    const hash = (location.hash || '').replace('#', '');
    if (hash === 'imza' || hash === 'section-imza') {
      setTimeout(() => scrollToSection('section-imza'), 100);
    } else if (hash === 'plaka' || hash === 'section-plaka') {
      setTimeout(() => scrollToSection('section-plaka'), 100);
    }
  }

  async function init() {
    const ok = await ensureSession();
    if (!ok) {
      location.href = 'GIRIS.html';
      return;
    }
    if (window.AyarlarGate && typeof window.AyarlarGate.ensureAyarlarAccess === 'function') {
      const allowed = await window.AyarlarGate.ensureAyarlarAccess({
        message: 'Ayarlar sayfasına girmek için parola girin.'
      });
      if (!allowed) {
        try {
          if (window.SessionManager?.navigateToHome) window.SessionManager.navigateToHome();
          else location.href = 'GIRIS.html';
        } catch (e) {
          location.href = 'GIRIS.html';
        }
        return;
      }
    }
    bindUi();
    const idleSel = document.getElementById('idleDays');
    if (idleSel) idleDays = Number(idleSel.value) || 60;
    await loadSummary();
    setActiveTab('top', { scroll: false });
    loadSignaturesList();
    applyHashSection();
    try {
      if (window.SignatureRegistry) await window.SignatureRegistry.loadSignatures(true);
    } catch (e) { /* ignore */ }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
