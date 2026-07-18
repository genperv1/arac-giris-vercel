// ayarlar.js — Plaka istatistikleri + imza yönetimi
(function () {
  'use strict';

  const TR_TZ = 'Europe/Istanbul';
  const PAGE_SIZE = 20;

  let currentTab = 'products';
  let plakaPage = 1;
  let plakaHasMore = false;
  let searchDebounce = null;
  let activeSection = 'section-plaka';

  const DISABLED_STORAGE_KEYS = [
    'firmaListesi', 'malzemeListesi',
    'firmalar', 'malzemeler',
    'recent_firmalar', 'recent_malzemeler', 'recent_sevk_yerleri'
  ];

  function authHeaders(json, extra) {
    const token = (function () {
      try { return localStorage.getItem('authToken') || ''; } catch (e) { return ''; }
    })();
    const h = { 'Cache-Control': 'no-cache' };
    if (json) h['Content-Type'] = 'application/json';
    if (token) h.Authorization = 'Bearer ' + token;
    const settingsToken = window.AyarlarGate && typeof window.AyarlarGate.getSettingsToken === 'function'
      ? window.AyarlarGate.getSettingsToken()
      : '';
    if (settingsToken) h['X-Settings-Token'] = settingsToken;
    if (extra) Object.assign(h, extra);
    return h;
  }

  function apiFetch(url, opts) {
    return fetch(url, Object.assign({ credentials: 'include', headers: authHeaders(!!(opts && opts.body)) }, opts || {}));
  }

  function settingsBanFetch(path, body) {
    return fetch('/api/settings/bans' + path, {
      method: 'POST',
      credentials: 'include',
      headers: authHeaders(true),
      body: JSON.stringify(body || {}),
    });
  }

  function formatRemaining(ms) {
    const n = Math.max(0, Number(ms) || 0);
    if (n < 60000) return Math.ceil(n / 1000) + ' sn';
    const h = Math.floor(n / 3600000);
    const m = Math.floor((n % 3600000) / 60000);
    if (h > 0) return h + ' sa ' + m + ' dk';
    return m + ' dk';
  }

  function fmtTs(ts) {
    if (!ts) return '—';
    try {
      return new Date(Number(ts)).toLocaleString('tr-TR', { timeZone: TR_TZ });
    } catch (e) {
      return '—';
    }
  }

  function maskTcDisplay(tc) {
    const s = String(tc || '').trim();
    if (s.length !== 11) return s || '—';
    return s.slice(0, 4) + '*****' + s.slice(9);
  }

  function formatEditValue(field, val) {
    const s = String(val || '').trim();
    if (!s) return '—';
    if (field === 'tcKimlik') return maskTcDisplay(s);
    return s;
  }

  function renderEditChangesHtml(changes) {
    const list = Array.isArray(changes) ? changes : [];
    if (!list.length) return '<p class="ay-empty">Değişiklik detayı yok.</p>';
    return list.map((c) => `<div class="ay-detail-row">
      <strong>${escapeHtml(c.label || c.field || 'Alan')}</strong>
      <span class="ay-detail-change"><s>${escapeHtml(formatEditValue(c.field, c.old))}</s> → <b>${escapeHtml(formatEditValue(c.field, c.new))}</b></span>
    </div>`).join('');
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
      const r = await apiFetch('/api/plaka-stats/summary?days=60');
      if (!r.ok) return;
      const d = await r.json();
      const set = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.textContent = String(val ?? '—');
      };
      set('sumUnique', d.uniquePlates);
      set('sumTotalPrints', d.totalPrints);
      set('sumProductPairs', d.productPairCount);
      set('sumEditLog', d.editLogCount);
    } catch (e) {
      console.warn('summary load', e);
    }
  }

  function attrEsc(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;');
  }

  function updatePlakaThead(tab) {
    const row = document.getElementById('plakaTheadRow');
    if (!row) return;
    if (tab === 'products') {
      row.innerHTML = '<th>#</th><th>Plaka</th><th>Firma</th><th>Ürün (malzeme)</th><th class="col-num">Adet</th><th>Son basım</th>';
    } else if (tab === 'edits') {
      row.innerHTML = '<th>#</th><th>Plaka</th><th>Değişiklik</th><th>Kim</th><th>Tarih</th>';
    } else {
      row.innerHTML = '<th>#</th><th>Plaka</th><th>Durum</th><th>Yazdırma</th><th>Son yazdırma</th>';
    }
  }

  async function loadPlakaProductTable() {
    const tbody = document.getElementById('plakaTbody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="6" class="ay-empty">Yükleniyor…</td></tr>';
    const q = (document.getElementById('plakaSearch')?.value || '').trim();
    const offset = (plakaPage - 1) * PAGE_SIZE;
    try {
      const url = '/api/plaka-product-stats?search=' + encodeURIComponent(q) +
        '&limit=' + PAGE_SIZE +
        '&offset=' + offset;
      const r = await apiFetch(url);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const data = await r.json();
      const items = data.items || [];
      plakaHasMore = items.length >= PAGE_SIZE;

      if (!items.length) {
        tbody.innerHTML = '<tr><td colspan="6" class="ay-empty">Kayıt bulunamadı. Takip formu yazdırıldığında plaka + firma + ürün burada görünür.</td></tr>';
        updatePagerUi();
        return;
      }

      const rowNumStart = offset + 1;
      tbody.innerHTML = items.map((row, i) => {
        const product = row.malzeme || '—';
        const firma = row.firma || '—';
        return `<tr data-plaka="${attrEsc(row.plaka)}" data-firma="${attrEsc(row.firma || '')}" data-malzeme="${attrEsc(row.malzeme || '')}" title="Detay için tıklayın">
          <td class="col-num">${rowNumStart + i}</td>
          <td class="col-plate">${escapeHtml(row.plaka)}</td>
          <td>${escapeHtml(firma)}</td>
          <td><strong>${escapeHtml(product)}</strong></td>
          <td class="col-num">${row.printCount ?? 0}</td>
          <td>${fmtTs(row.lastPrintTs)}</td>
        </tr>`;
      }).join('');

      tbody.querySelectorAll('tr[data-plaka]').forEach((tr) => {
        tr.addEventListener('click', () => openPlakaModal(
          tr.getAttribute('data-plaka'),
          {
            firma: tr.getAttribute('data-firma') || '',
            malzeme: tr.getAttribute('data-malzeme') || '',
          }
        ));
      });
      updatePagerUi();
    } catch (e) {
      tbody.innerHTML = '<tr><td colspan="6" class="ay-empty" style="color:#dc2626">Liste yüklenemedi.</td></tr>';
      plakaHasMore = false;
      updatePagerUi();
      console.error(e);
    }
  }

  async function loadEditLogTable() {
    const tbody = document.getElementById('plakaTbody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="5" class="ay-empty">Yükleniyor…</td></tr>';
    const q = (document.getElementById('plakaSearch')?.value || '').trim();
    const offset = (plakaPage - 1) * PAGE_SIZE;
    try {
      const url = '/api/vehicle-edit-log?search=' + encodeURIComponent(q) +
        '&limit=' + PAGE_SIZE +
        '&offset=' + offset;
      const r = await apiFetch(url);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const data = await r.json();
      const items = data.items || [];
      plakaHasMore = items.length >= PAGE_SIZE;

      if (!items.length) {
        tbody.innerHTML = '<tr><td colspan="5" class="ay-empty">Henüz şoför kartı düzenlemesi yok. Ana sayfada bir kart düzenlenince burada görünür.</td></tr>';
        updatePagerUi();
        return;
      }

      const rowNumStart = offset + 1;
      tbody.innerHTML = items.map((row, i) => {
        const summary = row.summary || 'Düzenleme';
        const who = row.userId || '—';
        return `<tr data-edit-id="${attrEsc(row.id)}" data-plaka="${attrEsc(row.plaka)}" title="Detay için tıklayın">
          <td class="col-num">${rowNumStart + i}</td>
          <td class="col-plate">${escapeHtml(row.plaka || '—')}</td>
          <td>${escapeHtml(summary)}</td>
          <td>${escapeHtml(who)}</td>
          <td>${fmtTs(row.editTs)}</td>
        </tr>`;
      }).join('');

      tbody.querySelectorAll('tr[data-edit-id]').forEach((tr) => {
        tr.addEventListener('click', () => openEditModal(tr.getAttribute('data-edit-id'), items));
      });
      updatePagerUi();
    } catch (e) {
      tbody.innerHTML = '<tr><td colspan="5" class="ay-empty" style="color:#dc2626">Liste yüklenemedi.</td></tr>';
      plakaHasMore = false;
      updatePagerUi();
      console.error(e);
    }
  }

  async function fetchEditLogForPlate(plaka, limit) {
    if (!plaka) return [];
    try {
      const r = await apiFetch('/api/vehicle-edit-log?plaka=' + encodeURIComponent(plaka) + '&limit=' + (limit || 8));
      if (!r.ok) return [];
      const data = await r.json();
      return data.items || [];
    } catch (e) {
      return [];
    }
  }

  function openEditModal(editId, cachedItems) {
    const modal = document.getElementById('plakaModal');
    const body = document.getElementById('plakaModalBody');
    const title = document.getElementById('plakaModalTitle');
    if (!modal || !body) return;

    const entry = (cachedItems || []).find((x) => String(x.id) === String(editId));
    if (!entry) {
      body.innerHTML = '<p class="ay-empty">Kayıt bulunamadı.</p>';
      modal.hidden = false;
      return;
    }

    document.querySelectorAll('#plakaTbody tr.is-selected').forEach((tr) => tr.classList.remove('is-selected'));
    const sel = document.querySelector('#plakaTbody tr[data-edit-id="' + editId + '"]');
    if (sel) sel.classList.add('is-selected');

    title.textContent = (entry.plaka || 'Plaka') + ' · düzenleme';
    body.innerHTML =
      `<p style="font-size:.8125rem;color:var(--rp-muted);margin:0 0 .75rem;">${fmtTs(entry.editTs)}${entry.userId ? ' · ' + escapeHtml(entry.userId) : ''}</p>` +
      renderEditChangesHtml(entry.changes);
    modal.hidden = false;
    document.body.style.overflow = 'hidden';
  }

  async function loadPlakaTable() {
    if (currentTab === 'products') {
      return loadPlakaProductTable();
    }
    if (currentTab === 'edits') {
      return loadEditLogTable();
    }
    const tbody = document.getElementById('plakaTbody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="5" class="ay-empty">Yükleniyor…</td></tr>';
    const q = (document.getElementById('plakaSearch')?.value || '').trim();
    const offset = (plakaPage - 1) * PAGE_SIZE;
    try {
      const url = '/api/plaka-stats?tab=' + encodeURIComponent(currentTab) +
        '&days=60' +
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
        return `<tr data-plaka="${escapeHtml(row.plaka)}" title="Detay için tıklayın">
          <td class="col-num">${rowNumStart + i}</td>
          <td class="col-plate">${escapeHtml(row.plaka)}</td>
          <td>${badge}</td>
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

  async function openPlakaModal(plaka, opts) {
    opts = opts || {};
    const firmaFilter = String(opts.firma || '').trim();
    const malzemeFilter = String(opts.malzeme || '').trim();
    const modal = document.getElementById('plakaModal');
    const body = document.getElementById('plakaModalBody');
    const title = document.getElementById('plakaModalTitle');
    if (!modal || !body || !plaka) return;

    document.querySelectorAll('#plakaTbody tr[data-plaka]').forEach((tr) => {
      tr.classList.toggle('is-selected', tr.getAttribute('data-plaka') === plaka);
    });

    const titleParts = [plaka];
    if (malzemeFilter) titleParts.push(malzemeFilter);
    else if (firmaFilter) titleParts.push(firmaFilter);
    title.textContent = titleParts.join(' · ');
    body.innerHTML = '<p class="ay-empty">Yükleniyor…</p>';
    modal.hidden = false;
    document.body.style.overflow = 'hidden';

    try {
      let url = '/api/print_history?plaka=' + encodeURIComponent(plaka) + '&limit=50';
      if (firmaFilter) url += '&firma=' + encodeURIComponent(firmaFilter);
      if (malzemeFilter) url += '&malzeme=' + encodeURIComponent(malzemeFilter);
      const r = await apiFetch(url);
      if (!r.ok) throw new Error('history');
      const rows = await r.json();
      if (!rows.length) {
        const edits = await fetchEditLogForPlate(plaka, 10);
        if (edits.length) {
          body.innerHTML =
            '<p style="font-size:.8125rem;color:var(--rp-muted);margin:0 0 .75rem;">Bu plaka için yazdırma kaydı yok; şoför kartı düzenlemeleri:</p>' +
            edits.map((e) => `<div class="ay-detail-row">
              <strong>${fmtTs(e.editTs)}${e.userId ? ' · ' + escapeHtml(e.userId) : ''}</strong>
              <span>${escapeHtml(e.summary || 'Düzenleme')}</span>
            </div>`).join('');
          return;
        }
        body.innerHTML = '<p class="ay-empty">Bu plaka / ürün için yazdırma kaydı yok.</p>';
        return;
      }
      const edits = await fetchEditLogForPlate(plaka, 5);
      const editsBlock = edits.length
        ? `<div style="margin-bottom:1rem;padding-bottom:.75rem;border-bottom:1px solid var(--rp-border);">
            <p style="font-size:.7rem;font-weight:700;text-transform:uppercase;color:var(--rp-muted);margin:0 0 .5rem;">Şoför kartı düzenlemeleri</p>
            ${edits.map((e) => `<div class="ay-detail-row">
              <strong>${fmtTs(e.editTs)}</strong>
              <span>${escapeHtml(e.summary || 'Düzenleme')}</span>
            </div>`).join('')}
          </div>`
        : '';
      const intro = (firmaFilter || malzemeFilter)
        ? `<p style="font-size:.8125rem;color:var(--rp-muted);margin:0 0 .75rem;">${escapeHtml(plaka)} plakası · ${escapeHtml(firmaFilter || '—')} · <strong>${escapeHtml(malzemeFilter || '—')}</strong> — ${rows.length} kayıt</p>`
        : '';
      body.innerHTML = editsBlock + intro + rows.map((h) => {
        const tonaj = h.tonaj ? ` · ${escapeHtml(h.tonaj)}` : '';
        return `<div class="ay-detail-row">
          <strong>${fmtTs(h.tarih)}</strong>
          <span>${escapeHtml(h.firma || '—')} · ${escapeHtml(h.malzeme || '—')}${tonaj} · ${escapeHtml(h.basim_yeri || h.basimYeri || '—')}</span>
        </div>`;
      }).join('');
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
      products: 'Hangi plaka hangi ürünü bastı — adet yüksekten düşüğe sıralı. Satıra tıklayınca o ürünün yazdırma geçmişi açılır.',
      edits: 'Ana sayfadaki şoför kartlarında yapılan düzenlemeler. Satıra tıklayınca ne değiştiği açılır.',
    };
    const hintEl = document.getElementById('tabHint');
    if (hintEl) hintEl.textContent = hints[tab] || '';
    updatePlakaThead(tab);
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
            <img data-sig-id="${escapeHtml(sig.id)}" alt="" loading="lazy" style="display:none">
            <div class="ay-sig-meta">
              <strong>${escapeHtml(sig.displayName)}</strong>
              <button type="button" class="ay-sig-del" data-del="${escapeHtml(sig.id)}">Sil</button>
            </div>
          </div>`).join('');
        attachSignatureCardImages(container);
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

  /** Büyük PNG'leri küçültür; şeffaf arka plan korunur (beyaz zemin eklenmez). */
  async function normalizeSignaturePng(file) {
    const bitmap = await createImageBitmap(file);
    const maxW = 300;
    const maxH = 120;
    const scale = Math.min(maxW / bitmap.width, maxH / bitmap.height, 1);
    if (scale >= 1) {
      if (bitmap.close) bitmap.close();
      return readFileAsDataUrl(file);
    }
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      if (bitmap.close) bitmap.close();
      return readFileAsDataUrl(file);
    }
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(bitmap, 0, 0, w, h);
    if (bitmap.close) bitmap.close();
    return canvas.toDataURL('image/png');
  }

  async function attachSignatureCardImages(container) {
    const imgs = container.querySelectorAll('img[data-sig-id]');
    await Promise.all([...imgs].map(async (img) => {
      const id = img.getAttribute('data-sig-id');
      if (!id) return;
      try {
        const r = await apiFetch('/api/signatures/' + encodeURIComponent(id) + '/image');
        if (!r.ok) throw new Error('load');
        const blob = await r.blob();
        img.src = URL.createObjectURL(blob);
        img.style.display = '';
      } catch (e) {
        img.style.display = 'none';
      }
    }));
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
      const imageData = await normalizeSignaturePng(file);
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

  async function loadMyIp() {
    try {
      const r = await fetch('/api/settings/bans/my-ip', { credentials: 'include', headers: authHeaders(false) });
      if (!r.ok) return;
      const d = await r.json();
      const el = document.getElementById('banMyIp');
      if (el && d.ip) el.textContent = d.ip;
      const siteEl = document.getElementById('banMySite');
      const siteWrap = document.getElementById('banMySiteWrap');
      if (siteEl && d.clientSite) {
        siteEl.textContent = d.clientSite;
        if (siteWrap) siteWrap.hidden = false;
      }
    } catch (e) { /* ignore */ }
  }

  async function loadBanList() {
    const tbody = document.getElementById('banTbody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="6" class="ay-empty">Yükleniyor…</td></tr>';
    try {
      const r = await settingsBanFetch('/list', {});
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        const msg = data.error || (r.status === 403 ? 'Ayarlar parolası gerekli — sayfayı yenileyip parolayı tekrar girin.' : 'Liste yüklenemedi');
        tbody.innerHTML = '<tr><td colspan="6" class="ay-empty" style="color:#dc2626">' + escapeHtml(msg) + '</td></tr>';
        return;
      }
      const items = data.banned || [];
      if (!items.length) {
        tbody.innerHTML = '<tr><td colspan="6" class="ay-empty">Aktif IP engeli yok.</td></tr>';
        return;
      }
      tbody.innerHTML = items.map((row) => `
        <tr data-ban-ip="${escapeHtml(row.ip)}">
          <td class="ay-ip-mono">${escapeHtml(row.ip)}</td>
          <td>${escapeHtml(row.reason || '—')}</td>
          <td>${row.bannedAt ? escapeHtml(new Date(row.bannedAt).toLocaleString('tr-TR', { timeZone: TR_TZ })) : '—'}</td>
          <td>${row.expiresAt ? escapeHtml(new Date(row.expiresAt).toLocaleString('tr-TR', { timeZone: TR_TZ })) : '—'}</td>
          <td>${escapeHtml(formatRemaining(row.remainingMs))}</td>
          <td><button type="button" class="ay-btn ay-btn--danger ay-ban-unban" data-ip="${escapeHtml(row.ip)}">Kaldır</button></td>
        </tr>`).join('');
      tbody.querySelectorAll('.ay-ban-unban').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const ip = btn.getAttribute('data-ip');
          if (!ip || !(await confirm('IP engelini kaldırmak istiyor musunuz?\n' + ip))) return;
          const ur = await settingsBanFetch('/unban', { ip });
          const ud = await ur.json().catch(() => ({}));
          if (ur.ok) {
            toast(ud.message || 'Engel kaldırıldı.');
            loadBanList();
          } else {
            toast(ud.error || 'Kaldırılamadı.', true);
          }
        });
      });
    } catch (e) {
      tbody.innerHTML = '<tr><td colspan="6" class="ay-empty" style="color:#dc2626">Liste yüklenemedi.</td></tr>';
    }
  }

  async function submitBanAdd(ev) {
    ev.preventDefault();
    const ip = (document.getElementById('banAddIp')?.value || '').trim();
    const reason = (document.getElementById('banAddReason')?.value || '').trim();
    if (!ip) { toast('IP adresi girin.', true); return; }
    const r = await settingsBanFetch('/add', { ip, reason: reason || 'Manuel engel (ayarlar)' });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { toast(d.error || 'Engellenemedi.', true); return; }
    toast(d.message || 'IP engellendi.');
    document.getElementById('banAddForm')?.reset();
    loadBanList();
  }

  async function clearAllBans() {
    if (!(await confirm('Tüm IP engelleri kaldırılacak. Emin misiniz?'))) return;
    const r = await settingsBanFetch('/clear', {});
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { toast(d.error || 'Temizlenemedi.', true); return; }
    toast(d.message || 'Tüm engeller kaldırıldı.');
    loadBanList();
  }

  function isCompleteTcAy(tc) {
    return /^\d{11}$/.test(String(tc || '').trim());
  }

  function getContactWarningsAy(vehicle) {
    const warnings = [];
    const phone = String(vehicle?.iletisim || '').trim();
    const tc = String(vehicle?.tcKimlik || '').trim();
    if (!phone) warnings.push('İletişim');
    if (!tc) warnings.push('TC Kimlik No');
    else if (!isCompleteTcAy(tc)) warnings.push('TC Kimlik No (eksik)');
    return warnings;
  }

  function contactStatusAy(vehicle, field) {
    if (field === 'phone') return String(vehicle?.iletisim || '').trim() ? 'Tamam' : 'Eksik';
    const tc = String(vehicle?.tcKimlik || '').trim();
    if (!tc) return 'Eksik';
    if (isCompleteTcAy(tc)) return 'Tamam';
    return 'Eksik (taslak)';
  }

  function firstMissingFieldAy(vehicle) {
    const phone = String(vehicle?.iletisim || '').trim();
    const tc = String(vehicle?.tcKimlik || '').trim();
    if (!phone) return 'iletisim';
    if (!tc || !isCompleteTcAy(tc)) return 'tcKimlik';
    return '';
  }

  function openVehicleEditOnMain(vehicleId, focusField) {
    try {
      sessionStorage.setItem('pendingEditVehicleId', String(vehicleId));
      if (focusField) sessionStorage.setItem('pendingEditFocusField', focusField);
      else sessionStorage.removeItem('pendingEditFocusField');
    } catch (e) {}
    location.href = 'GIRIS.html';
  }

  let eksikRowsCache = [];
  let ozmalEntriesCache = [];

  async function loadIncompleteVehicles() {
    const tbody = document.getElementById('eksikTbody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="6" class="ay-empty">Yükleniyor…</td></tr>';
    try {
      const r = await apiFetch('/api/vehicles?limit=20000');
      if (!r.ok) throw new Error('list');
      const rows = await r.json();
      eksikRowsCache = (Array.isArray(rows) ? rows : []).filter((v) => getContactWarningsAy(v).length > 0);
      if (!eksikRowsCache.length) {
        tbody.innerHTML = '<tr><td colspan="6" class="ay-empty">Eksik TC veya telefonlu kayıt yok.</td></tr>';
        return;
      }
      tbody.innerHTML = eksikRowsCache.map((v) => {
        const sofor = [v.soforAdi, v.soforSoyadi].filter(Boolean).join(' ') || '—';
        const warnings = getContactWarningsAy(v).join(', ');
        const focus = firstMissingFieldAy(v);
        return `<tr>
          <td><strong>${escapeHtml(v.cekiciPlaka || '—')}</strong></td>
          <td>${escapeHtml(sofor)}</td>
          <td>${escapeHtml(contactStatusAy(v, 'phone'))}</td>
          <td>${escapeHtml(contactStatusAy(v, 'tc'))}</td>
          <td>${escapeHtml(warnings)}</td>
          <td><button type="button" class="ay-btn ay-btn--primary ay-eksik-edit" data-id="${escapeHtml(v.id)}" data-focus="${escapeHtml(focus)}">Düzenle</button></td>
        </tr>`;
      }).join('');
      tbody.querySelectorAll('.ay-eksik-edit').forEach((btn) => {
        btn.addEventListener('click', () => {
          const id = btn.getAttribute('data-id');
          const focus = btn.getAttribute('data-focus') || '';
          if (id) openVehicleEditOnMain(id, focus);
        });
      });
    } catch (e) {
      tbody.innerHTML = '<tr><td colspan="6" class="ay-empty" style="color:#dc2626">Liste yüklenemedi.</td></tr>';
    }
  }

  function exportIncompleteCsv() {
    if (!eksikRowsCache.length) {
      toast('Dışa aktarılacak eksik kayıt yok.', true);
      return;
    }
    const header = ['Plaka', 'Şoför', 'İletişim', 'TC Kimlik', 'Telefon Durumu', 'TC Durumu', 'Eksikler'];
    const lines = eksikRowsCache.map((v) => {
      const sofor = [v.soforAdi, v.soforSoyadi].filter(Boolean).join(' ');
      return [
        v.cekiciPlaka || '',
        sofor,
        v.iletisim || '',
        v.tcKimlik || '',
        contactStatusAy(v, 'phone'),
        contactStatusAy(v, 'tc'),
        getContactWarningsAy(v).join(', '),
      ].map((cell) => '"' + String(cell).replace(/"/g, '""') + '"').join(';');
    });
    const csv = '\ufeff' + header.join(';') + '\n' + lines.join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'eksik_kayitlar_' + new Date().toISOString().slice(0, 10) + '.csv';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    toast('Eksik kayıt listesi indirildi.');
  }

  function bindIncompleteUi() {
    document.getElementById('eksikRefreshBtn')?.addEventListener('click', loadIncompleteVehicles);
    document.getElementById('eksikExportBtn')?.addEventListener('click', exportIncompleteCsv);
  }

  function serializeOzmalPayload(entries) {
    const oz = window.OzmalPlates;
    return (entries || []).map((entry) => ({
      plaka: entry.plaka,
      bassofor: !!entry.bassofor,
      drivers: (entry.drivers || []).map((d) => {
        const name = typeof d === 'string' ? d : d.name;
        return {
          name,
          starred: !!(typeof d === 'object' && d && d.starred),
        };
      }),
    }));
  }

  async function loadOzmalEntriesFull() {
    if (!window.OzmalPlates) return [];
    try {
      const r = await apiFetch('/api/settings/ozmal-entries-full');
      if (r.ok) {
        const data = await r.json().catch(() => ({}));
        ozmalEntriesCache = Array.isArray(data.entries) ? data.entries : [];
        if (ozmalEntriesCache.length && typeof window.OzmalPlates.applyRemoteEntries === 'function') {
          window.OzmalPlates.applyRemoteEntries(ozmalEntriesCache);
        }
        return ozmalEntriesCache;
      }
    } catch (e) {
      console.warn('ozmal load', e);
    }
    try {
      await window.OzmalPlates.ensureSynced();
    } catch (e) { /* ignore */ }
    ozmalEntriesCache = window.OzmalPlates.getOzmalEntries();
    return ozmalEntriesCache;
  }

  async function persistOzmalEntries(entries) {
    const payload = serializeOzmalPayload(entries);
    const r = await apiFetch('/api/settings/ozmal-entries', {
      method: 'POST',
      body: JSON.stringify({ entries: payload }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || 'Kaydedilemedi');
    if (window.OzmalPlates && typeof window.OzmalPlates.applyRemoteEntries === 'function' && data.entries) {
      window.OzmalPlates.applyRemoteEntries(data.entries);
    }
    await loadOzmalEntriesFull();
    return data;
  }

  function renderOzmalTable() {
    const tbody = document.getElementById('ozmalTbody');
    const oz = window.OzmalPlates;
    if (!tbody || !oz) return;

    const entries = ozmalEntriesCache.length ? ozmalEntriesCache : oz.getOzmalEntries();
    if (!entries.length) {
      tbody.innerHTML = '<tr><td colspan="4" class="ay-empty">Henüz özmal plaka yok. Yukarıdan plaka yazıp Kaydet deyin.</td></tr>';
      return;
    }

    tbody.innerHTML = entries.map((entry, i) => {
      const p = entry.plaka;
      const bassofor = oz.isBassoforPlate(p);
      const mark = bassofor
        ? '<span class="ay-badge ay-badge--boss"><i class="fas fa-crown" aria-hidden="true"></i> BAŞŞOFÖR</span>'
        : '<span class="ay-badge ay-badge--ozmal">★ ÖZMAL</span>';
      const drivers = (entry.drivers || []).length
        ? (entry.drivers || []).map((d) => {
          const name = typeof d === 'string' ? d : d.name;
          const starred = !!(typeof d === 'object' && d && d.starred);
          const pwd = typeof d === 'object' && d && d.passwordPlain ? d.passwordPlain : '';
          return `<span class="ay-ozmal-chip${starred ? ' is-starred' : ''}">
            <button type="button" class="ay-ozmal-chip-btn ay-ozmal-star" data-plate="${attrEsc(p)}" data-driver="${attrEsc(name)}" title="Menüde öne al">${starred ? '★' : '☆'}</button>
            <span>${escapeHtml(name)}</span>
            ${pwd ? `<code title="Giriş şifresi">${escapeHtml(pwd)}</code>` : ''}
            ${pwd ? `<button type="button" class="ay-ozmal-chip-btn ay-ozmal-pwd" data-plate="${attrEsc(p)}" data-driver="${attrEsc(name)}" title="Yeni şifre">↻</button>` : ''}
            <button type="button" class="ay-ozmal-chip-btn ay-ozmal-chip-btn--del ay-ozmal-driver-del" data-plate="${attrEsc(p)}" data-driver="${attrEsc(name)}" title="Şoförü kaldır">×</button>
          </span>`;
        }).join('')
        : '<span class="ay-muted">Şoför yok</span>';

      return `<tr>
        <td class="col-num">${i + 1}</td>
        <td class="col-plate">${escapeHtml(p)} ${mark}</td>
        <td><div class="ay-ozmal-drivers">${drivers}</div></td>
        <td><button type="button" class="ay-btn ay-btn--danger ay-ozmal-plate-del" data-plate="${attrEsc(p)}">Plakayı kaldır</button></td>
      </tr>`;
    }).join('');

    tbody.querySelectorAll('.ay-ozmal-plate-del').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const plate = btn.getAttribute('data-plate') || '';
        if (!plate || !(await confirm(plate + ' plakası listeden kaldırılsın mı?'))) return;
        try {
          const ozApi = window.OzmalPlates;
          if (!ozApi) throw new Error('Modül yüklenemedi');
          ozApi.removeOzmalPlate(plate);
          await persistOzmalEntries(ozApi.getOzmalEntries());
          renderOzmalTable();
          toast('Plaka kaldırıldı.');
        } catch (e) {
          toast(e.message || 'Kaldırılamadı.', true);
        }
      });
    });

    tbody.querySelectorAll('.ay-ozmal-driver-del').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const plate = btn.getAttribute('data-plate') || '';
        const driver = btn.getAttribute('data-driver') || '';
        if (!plate || !driver || !(await confirm(driver + ' şoförü kaldırılsın mı?'))) return;
        try {
          const ozApi = window.OzmalPlates;
          if (!ozApi) throw new Error('Modül yüklenemedi');
          const res = ozApi.removeOzmalDriver(plate, driver);
          if (!res.ok) throw new Error(res.error || 'Kaldırılamadı');
          await persistOzmalEntries(ozApi.getOzmalEntries());
          renderOzmalTable();
          toast('Şoför kaldırıldı.');
        } catch (e) {
          toast(e.message || 'Kaldırılamadı.', true);
        }
      });
    });

    tbody.querySelectorAll('.ay-ozmal-star').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const plate = btn.getAttribute('data-plate') || '';
        const driver = btn.getAttribute('data-driver') || '';
        try {
          const ozApi = window.OzmalPlates;
          if (!ozApi) throw new Error('Modül yüklenemedi');
          const res = ozApi.toggleOzmalDriverStar(plate, driver);
          if (!res.ok) throw new Error(res.error || 'Güncellenemedi');
          await persistOzmalEntries(ozApi.getOzmalEntries());
          renderOzmalTable();
        } catch (e) {
          toast(e.message || 'Güncellenemedi.', true);
        }
      });
    });

    tbody.querySelectorAll('.ay-ozmal-pwd').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const plate = btn.getAttribute('data-plate') || '';
        const driver = btn.getAttribute('data-driver') || '';
        if (!plate || !driver || !(await confirm(driver + ' için yeni şifre oluşturulsun mu?'))) return;
        try {
          const r = await apiFetch('/api/settings/ozmal-regenerate-password', {
            method: 'POST',
            body: JSON.stringify({ plaka: plate, driver }),
          });
          const data = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error(data.error || 'Şifre oluşturulamadı');
          await loadOzmalEntriesFull();
          renderOzmalTable();
          toast('Yeni şifre: ' + (data.passwordPlain || '—'));
        } catch (e) {
          toast(e.message || 'Şifre oluşturulamadı.', true);
        }
      });
    });
  }

  async function submitOzmalAdd(ev) {
    ev.preventDefault();
    const oz = window.OzmalPlates;
    if (!oz) {
      toast('Özmal modülü yüklenemedi.', true);
      return;
    }
    const plateInput = document.getElementById('ozmalPlateInput');
    const driverInput = document.getElementById('ozmalDriverInput');
    const plate = (plateInput?.value || '').trim();
    const driver = (driverInput?.value || '').trim();
    if (!plate) {
      toast('Plaka girin.', true);
      plateInput?.focus();
      return;
    }

    try {
      const r = await apiFetch('/api/settings/ozmal-add', {
        method: 'POST',
        body: JSON.stringify({ plaka: plate, driver }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || data.ok === false) {
        toast(data.error || 'Kaydedilemedi.', true);
        return;
      }

      if (typeof oz.applyRemoteEntries === 'function' && Array.isArray(data.entries)) {
        oz.applyRemoteEntries(data.entries);
      }
      await loadOzmalEntriesFull();
      renderOzmalTable();

      if (data.addedDriver) {
        if (driverInput) driverInput.value = '';
      } else {
        if (plateInput) plateInput.value = '';
        if (driverInput) driverInput.value = '';
      }

      const pwdMsg = data.passwordPlain ? ' · Şifre: ' + data.passwordPlain : '';
      if (driver) {
        toast((data.driver || driver) + ' kaydedildi' + pwdMsg + '.');
      } else {
        toast((data.plaka || plate) + ' kaydedildi.');
      }
    } catch (e) {
      toast(e.message || 'Sunucuya kaydedilemedi.', true);
    }
  }

  function bindOzmalUi() {
    document.getElementById('ozmalAddForm')?.addEventListener('submit', submitOzmalAdd);
    document.getElementById('ozmalRefreshBtn')?.addEventListener('click', async () => {
      const tbody = document.getElementById('ozmalTbody');
      if (tbody) tbody.innerHTML = '<tr><td colspan="4" class="ay-empty">Yükleniyor…</td></tr>';
      try {
        await loadOzmalEntriesFull();
        renderOzmalTable();
        toast('Liste yenilendi.');
      } catch (e) {
        toast('Liste yüklenemedi.', true);
      }
    });
  }

  function bindBanUi() {
    document.getElementById('banRefreshBtn')?.addEventListener('click', loadBanList);
    document.getElementById('banClearAllBtn')?.addEventListener('click', clearAllBans);
    document.getElementById('banAddForm')?.addEventListener('submit', submitBanAdd);
  }

  function exportFullBackup() {
    try {
      const storageDump = {};
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k) continue;
        if (/eslestirme/i.test(k) || k === 'eslestirmeListesi') continue;
        if (DISABLED_STORAGE_KEYS.includes(k)) continue;
        storageDump[k] = localStorage.getItem(k);
      }
      const allData = {
        __type: 'V8_FULL_BACKUP',
        exportTarihi: new Date().toLocaleString('tr-TR'),
        storageDump
      };
      const dataStr = JSON.stringify(allData, null, 2);
      const dataBlob = new Blob([dataStr], { type: 'application/json' });
      const url = URL.createObjectURL(dataBlob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'V8_TAM_YEDEK_' + new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-') + '.json';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      return true;
    } catch (e) {
      console.error(e);
      return false;
    }
  }

  async function handleBackupExport() {
    if (!(await confirm('✅ TAM YEDEK AL: Sistem içindeki ne var ne yok (tüm kayıtlar + ayarlar + arşivler) yedeklensin mi?'))) return;
    if (exportFullBackup()) toast('Yedek indirildi.');
    else toast('Yedek alınırken hata oluştu!', true);
  }

  async function restoreFullBackup(allData) {
    const r = await apiFetch('/api/restore-full', {
      method: 'POST',
      body: JSON.stringify(allData)
    });
    const result = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(result.error || 'Geri yükleme başarısız');
    return result;
  }

  function handleBackupImport() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.style.display = 'none';
    document.body.appendChild(input);

    input.addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) {
        document.body.removeChild(input);
        return;
      }
      const reader = new FileReader();
      reader.onload = async (event) => {
        try {
          const allData = JSON.parse(event.target.result);
          if (allData && allData.storageDump && typeof allData.storageDump === 'object') {
            await restoreFullBackup(allData);
            toast('Tam yedek geri yüklendi. Ana sayfaya yönlendiriliyorsunuz…');
            setTimeout(() => {
              try {
                if (window.SessionManager?.navigateToHome) window.SessionManager.navigateToHome();
                else location.href = 'GIRIS.html';
              } catch (err) {
                location.href = 'GIRIS.html';
              }
            }, 800);
          } else {
            toast('Geçersiz yedek dosyası — tam yedek (V8_FULL_BACKUP) bekleniyor.', true);
          }
        } catch (err) {
          toast('Geçersiz yedek dosyası veya bozuk JSON!', true);
        }
        document.body.removeChild(input);
      };
      reader.onerror = () => {
        toast('Dosya okunamadı!', true);
        document.body.removeChild(input);
      };
      reader.readAsText(file);
    }, { once: true });

    input.click();
  }

  function bindBackupUi() {
    document.getElementById('backupExportBtn')?.addEventListener('click', handleBackupExport);
    document.getElementById('backupImportBtn')?.addEventListener('click', handleBackupImport);
  }

  function bindPrintFormBgUi() {
    const form = document.getElementById('printFormBgForm');
    if (!form || form.__pfbBound) return;
    form.__pfbBound = true;
    const statusEl = document.getElementById('printFormBgStatus');
    const previewEl = document.getElementById('printFormBgPreview');

    async function refreshPrintFormBgStatus() {
      if (!statusEl) return;
      try {
        const r = await apiFetch('/api/print-form-bg/meta');
        const data = await r.json().catch(() => ({}));
        if (!r.ok || !data.exists || data.needsUpload) {
          statusEl.textContent = 'Sunucuda şablon yok — proje köküne AA.jpg koyun veya buradan JPG yükleyin.';
          return;
        }
        const when = data.updatedAt ? new Date(data.updatedAt).toLocaleString('tr-TR') : '';
        statusEl.textContent = 'Sunucuda kayıtlı şablon var' + (when ? ' · ' + when : '') + (data.source ? ' · ' + data.source : '') + '.';
      } catch (e) {
        statusEl.textContent = 'Şablon durumu okunamadı.';
      }
    }

    async function showPrintFormBgPreview(src) {
      if (!previewEl) return;
      if (!src) {
        previewEl.innerHTML = 'Önizleme';
        return;
      }
      previewEl.innerHTML = '<img src="' + src + '" alt="Form şablonu" style="max-width:100%;display:block;">';
    }

    async function loadPrintFormBgPreviewFromServer() {
      try {
        const r = await apiFetch('/api/print-form-bg');
        if (!r.ok) return;
        const blob = await r.blob();
        showPrintFormBgPreview(URL.createObjectURL(blob));
      } catch (e) { /* ignore */ }
    }

    document.getElementById('printFormBgFile')?.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      if (!/^image\/(jpeg|png)$/i.test(file.type)) {
        toast('Yalnızca JPG veya PNG seçin.', true);
        return;
      }
      if (file.size > 4_500_000) {
        toast('Dosya çok büyük (max ~4.5 MB).', true);
        return;
      }
      try {
        const url = await readFileAsDataUrl(file);
        showPrintFormBgPreview(url);
      } catch (err) {
        toast('Dosya okunamadı.', true);
      }
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const file = document.getElementById('printFormBgFile')?.files?.[0];
      if (!file) {
        toast('Önce JPG/PNG dosyası seçin.', true);
        return;
      }
      try {
        const imageData = await readFileAsDataUrl(file);
        const r = await apiFetch('/api/print-form-bg', {
          method: 'POST',
          body: JSON.stringify({ imageData, source: 'ayarlar-upload' }),
        });
        const data = await r.json().catch(() => ({}));
        if (!r.ok) {
          toast(data.error || 'Kaydedilemedi.', true);
          return;
        }
        if (window.PrintFormBg && typeof window.PrintFormBg.clearCache === 'function') {
          window.PrintFormBg.clearCache();
        }
        toast('Takip formu şablonu sunucuya kaydedildi.');
        await refreshPrintFormBgStatus();
        await loadPrintFormBgPreviewFromServer();
      } catch (err) {
        toast('Kayıt hatası.', true);
      }
    });

    document.getElementById('printFormBgImportLegacyBtn')?.addEventListener('click', async () => {
      toast('Hızlı Resim deneniyor…');
      try {
        if (window.PrintFormBgBootstrap && typeof window.PrintFormBgBootstrap.tryAutoImportLegacyPrintFormBg === 'function') {
          const ok = await window.PrintFormBgBootstrap.tryAutoImportLegacyPrintFormBg();
          if (ok) {
            if (window.PrintFormBg && typeof window.PrintFormBg.clearCache === 'function') {
              window.PrintFormBg.clearCache();
            }
            toast('Şablon sunucuya kaydedildi.');
            await refreshPrintFormBgStatus();
            await loadPrintFormBgPreviewFromServer();
            return;
          }
        }
        toast('Otomatik aktarılamadı. Şablonu aç → Farklı kaydet → buradan yükleyin.', true);
      } catch (e) {
        toast('Aktarma hatası.', true);
      }
    });

    document.getElementById('printFormBgOpenLegacyBtn')?.addEventListener('click', () => {
      window.open('https://hizliresim.com/36cc3jp', '_blank', 'noopener,noreferrer');
      toast('Görseli indirip bu sayfadan JPG olarak yükleyin.');
    });

    document.getElementById('printFormBgRefreshBtn')?.addEventListener('click', async () => {
      if (window.PrintFormBg && typeof window.PrintFormBg.clearCache === 'function') {
        window.PrintFormBg.clearCache();
      }
      try {
        if (window.PrintFormBg && typeof window.PrintFormBg.resolvePrintBgUrl === 'function') {
          await window.PrintFormBg.resolvePrintBgUrl();
        }
      } catch (e) { /* ignore */ }
      toast('Yazdırma önbelleği yenilendi.');
      await loadPrintFormBgPreviewFromServer();
    });

    refreshPrintFormBgStatus();
    loadPrintFormBgPreviewFromServer();
  }

  const REPORT_DELETE_PASSWORD = '2026genper';

  async function ensureReportDeletePassword() {
    const u = window.rpUi || {};
    let entered;
    if (typeof u.password === 'function') {
      entered = await u.password('Silme şifresini giriniz:');
    } else {
      entered = prompt('Silme şifresini giriniz:');
    }
    if (entered == null || entered === false) return false;
    if (String(entered).trim() !== REPORT_DELETE_PASSWORD) {
      toast('Şifre hatalı.', true);
      return false;
    }
    return true;
  }

  async function handleClearAllReports() {
    if (window.SessionManager && typeof window.SessionManager.requireValidSession === 'function') {
      const isValidSession = await window.SessionManager.requireValidSession();
      if (!isValidSession) return;
    }

    const okPass = await ensureReportDeletePassword();
    if (!okPass) return;

    const u = window.rpUi || {};
    let ok = false;
    if (typeof u.confirm === 'function') {
      ok = await u.confirm('Rapor kayıtları (yazdırma geçmişi) temizlenecek.\nAraç kayıtları silinmez. Devam edilsin mi?');
    } else {
      ok = confirm('Rapor kayıtları (yazdırma geçmişi) temizlenecek.\nAraç kayıtları silinmez. Devam edilsin mi?');
    }
    if (!ok) return;

    try {
      await apiFetch('/api/reports', { method: 'DELETE' });

      const r = await apiFetch('/api/vehicles?limit=20000');
      if (r.ok) {
        const arr = await r.json();
        for (const v of (Array.isArray(arr) ? arr : [])) {
          try {
            const nv = { ...v, printCount: 0, lastPrintSnapshot: null };
            await apiFetch('/api/vehicles/' + encodeURIComponent(String(v.id || '')), {
              method: 'PUT',
              body: JSON.stringify(nv),
            });
          } catch (e) { /* ignore */ }
        }
      }

      if (window.piyasa && typeof window.piyasa.reconcileOrderPrintCountsFromReports === 'function') {
        await window.piyasa.reconcileOrderPrintCountsFromReports();
      }

      toast('Raporlar temizlendi.');
      try { await loadSummary(); } catch (e) { /* ignore */ }
    } catch (e) {
      toast('Temizleme işlemi başarısız.', true);
    }
  }

  function bindClearReportsUi() {
    document.getElementById('clearReportsBtn')?.addEventListener('click', handleClearAllReports);
  }

  function setupEmergencyBanOnly() {
    ['section-plaka', 'section-imza', 'section-yedek', 'section-ozmal'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    });
    document.querySelectorAll('.ay-subnav-btn').forEach((btn) => {
      const goto = btn.getAttribute('data-goto');
      btn.style.display = goto === 'section-ban' ? '' : 'none';
    });
    const desc = document.querySelector('.rp-page-desc');
    if (desc) desc.textContent = 'IP engeli acil kurtarma — giriş yapmadan yalnızca ayarlar parolası ile ban listesini yönetin.';
  }

  function bindUi() {
    document.querySelectorAll('.ay-subnav-btn[data-goto]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-goto');
        if (id) {
          scrollToSection(id);
          if (id === 'section-ban') loadBanList();
          if (id === 'section-ozmal') loadOzmalEntriesFull().then(renderOzmalTable);
        }
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
        const url = await normalizeSignaturePng(file);
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
        if (id === 'section-plaka' || id === 'section-eksik' || id === 'section-ozmal' || id === 'section-imza' || id === 'section-ban' || id === 'section-yedek' || id === 'section-yazdir') {
          activeSection = id;
          document.querySelectorAll('.ay-subnav-btn').forEach((btn) => {
            btn.classList.toggle('is-active', btn.getAttribute('data-goto') === id);
          });
        }
      });
    }, { rootMargin: '-40% 0px -45% 0px', threshold: 0 });
    ['section-plaka', 'section-eksik', 'section-ozmal', 'section-imza', 'section-ban', 'section-yedek', 'section-yazdir'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) obs.observe(el);
    });

    bindBanUi();
    bindBackupUi();
    bindPrintFormBgUi();
    if (typeof window.bindPrintLayoutEditor === 'function') window.bindPrintLayoutEditor();
    bindClearReportsUi();
    bindIncompleteUi();
    bindOzmalUi();
  }

  function applyHashSection() {
    const hash = (location.hash || '').replace('#', '');
    if (hash === 'imza' || hash === 'section-imza') {
      setTimeout(() => scrollToSection('section-imza'), 100);
    } else if (hash === 'plaka' || hash === 'section-plaka') {
      setTimeout(() => scrollToSection('section-plaka'), 100);
    } else if (hash === 'eksik' || hash === 'section-eksik') {
      setTimeout(() => scrollToSection('section-eksik'), 100);
    } else if (hash === 'ozmal' || hash === 'section-ozmal') {
      setTimeout(() => scrollToSection('section-ozmal'), 100);
    } else if (hash === 'ban' || hash === 'section-ban') {
      setTimeout(() => scrollToSection('section-ban'), 100);
    } else if (hash === 'yedek' || hash === 'section-yedek') {
      setTimeout(() => scrollToSection('section-yedek'), 100);
    } else if (hash === 'yazdir' || hash === 'section-yazdir') {
      setTimeout(() => scrollToSection('section-yazdir'), 100);
    }
  }

  function isEmergencyBanMode() {
    const hash = (location.hash || '').replace('#', '');
    return hash === 'ban' || hash === 'section-ban';
  }

  async function init() {
    const emergency = isEmergencyBanMode();
    const sessionOk = await ensureSession();
    if (!sessionOk && !emergency) {
      location.href = 'GIRIS.html';
      return;
    }
    if (emergency && !sessionOk) setupEmergencyBanOnly();

    if (window.AyarlarGate && typeof window.AyarlarGate.ensureAyarlarAccess === 'function') {
      const allowed = await window.AyarlarGate.ensureAyarlarAccess({
        message: emergency
          ? 'IP engeli kurtarma — ayarlar parolasını girin.'
          : 'Ayarlar sayfasına girmek için parola girin.',
        force: emergency,
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
    const plakaSearch = document.getElementById('plakaSearch');
    if (plakaSearch) {
      plakaSearch.value = '';
      plakaSearch.removeAttribute('tabindex');
    }
    await loadMyIp();
    loadBanList();

    if (emergency && !sessionOk) {
      scrollToSection('section-ban', { smooth: false });
      return;
    }

    await loadSummary();
    setActiveTab('products', { scroll: false });
    loadSignaturesList();
    loadIncompleteVehicles();
    loadOzmalEntriesFull().then(renderOzmalTable);
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
