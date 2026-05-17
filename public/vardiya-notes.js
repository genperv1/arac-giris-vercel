(function () {
  'use strict';

  const DELETE_PASSWORD = '2026genper';
  let _editingId = null;
  const _notesCache = {};

  function ui() {
    return window.rpUi || {};
  }

  function esc(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function fmtDate(ts) {
    try {
      return new Date(Number(ts)).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' });
    } catch (e) {
      return '';
    }
  }

  function firmaKoduFromRules(note) {
    const r = (note && note.rules) || {};
    return r.yd_key || r.firma_kodu || '';
  }

  function setFormCreateMode() {
    _editingId = null;
    const title = document.getElementById('vnFormTitle');
    const submit = document.getElementById('vnSubmitBtn');
    const cancel = document.getElementById('vnCancelEdit');
    if (title) title.textContent = 'Yeni not';
    if (submit) submit.textContent = 'Kaydet';
    if (cancel) cancel.classList.add('hidden');
    document.querySelectorAll('.vn-note-item.is-editing').forEach((el) => {
      el.classList.remove('is-editing');
    });
  }

  function startEdit(note) {
    if (!note || !note.id) return;
    _editingId = note.id;
    const title = document.getElementById('vnFormTitle');
    const submit = document.getElementById('vnSubmitBtn');
    const cancel = document.getElementById('vnCancelEdit');
    if (title) title.textContent = 'Notu düzenle';
    if (submit) submit.textContent = 'Güncelle';
    if (cancel) cancel.classList.remove('hidden');
    const bodyEl = document.getElementById('vnBody');
    const firmaEl = document.getElementById('vnFirmaKodu');
    const p1El = document.getElementById('vnMalzemeP1P2');
    if (bodyEl) bodyEl.value = note.body || '';
    if (firmaEl) firmaEl.value = firmaKoduFromRules(note);
    const sehirEl = document.getElementById('vnSehir');
    if (sehirEl) sehirEl.value = (note.rules && note.rules.sehir) || '';
    if (p1El) p1El.checked = !!(note.rules && note.rules.malzeme_p1p2);
    document.querySelectorAll('.vn-note-item.is-editing').forEach((el) => {
      el.classList.remove('is-editing');
    });
    const row = document.querySelector('.vn-note-item[data-id="' + CSS.escape(note.id) + '"]');
    if (row) {
      row.classList.add('is-editing');
      row.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
    document.getElementById('vnForm')?.closest('section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    bodyEl?.focus();
  }

  function rulesFromFirmaKoduInput(raw, sehirRaw) {
    const v = String(raw || '').trim().toUpperCase();
    const rules = { yd_key: '', firma_kodu: '', sehir: '', malzeme_p1p2: false };
    rules.sehir = String(sehirRaw || '').trim();
    if (!v) return rules;
    const ydM = v.match(/\bYD\s*(\d{1,4})\b/i);
    if (ydM) {
      rules.yd_key = 'YD' + ydM[1];
    } else {
      rules.firma_kodu = v;
    }
    return rules;
  }

  function ruleBadges(note) {
    const r = note.rules || {};
    const parts = [];
    const firmaLabel = r.yd_key || r.firma_kodu;
    if (firmaLabel) {
      parts.push('<span class="vn-badge">Firma ' + esc(firmaLabel) + '</span>');
    }
    if (r.sehir) parts.push('<span class="vn-badge">Şehir ' + esc(r.sehir) + '</span>');
    if (r.malzeme_p1p2) parts.push('<span class="vn-badge">P1/P2</span>');
    return parts.join('');
  }

  function collectIhracatInfo() {
    const out = { count: 0, files: [], ydKeys: new Set(), loadedAt: '' };
    let rows = [];
    let meta = {};
    try {
      if (window.DailyStore && typeof DailyStore.getRows === 'function') {
        rows = DailyStore.getRows() || [];
        meta = (DailyStore.getMeta && DailyStore.getMeta()) || {};
      }
    } catch (e) {}
    if (!rows.length) {
      try {
        rows = JSON.parse(localStorage.getItem('daily_shipments_current') || '[]') || [];
        meta = JSON.parse(localStorage.getItem('daily_shipments_meta') || '{}') || {};
      } catch (e) {}
    }
    out.count = Array.isArray(rows) ? rows.length : 0;
    if (meta.fileName) out.files.push(String(meta.fileName));
    if (Array.isArray(meta.files)) meta.files.forEach((f) => { if (f) out.files.push(String(f)); });
    if (meta.loadedAt) out.loadedAt = meta.loadedAt;
    else if (meta.importedAt) out.loadedAt = meta.importedAt;
    (rows || []).forEach((r) => {
      const texts = [r.ydKey, r.firma, r.headerText, r.yuklemeNotu, r.blockYuklemeNotu];
      texts.forEach((txt) => {
        const t = String(txt || '').toUpperCase();
        const re = /\bYD\s*(\d{1,4})\b/gi;
        let m;
        while ((m = re.exec(t)) !== null) {
          out.ydKeys.add('YD' + m[1]);
        }
      });
    });
    out.files = [...new Set(out.files.filter(Boolean))];
    return out;
  }

  function collectPiyasaInfo() {
    const out = { count: 0, week: '', sheet: '', loadedAt: '' };
    try {
      const st = JSON.parse(localStorage.getItem('piyasa_state_v1') || 'null');
      if (!st || !Array.isArray(st.orders)) return out;
      out.count = st.orders.length;
      out.week = st.week != null ? String(st.week) : '';
      out.sheet = st.sheet ? String(st.sheet) : '';
      out.loadedAt = st.loadedAt || '';
    } catch (e) {}
    return out;
  }

  function fmtLoadedAt(iso) {
    if (!iso) return '';
    try {
      const d = new Date(iso);
      if (isNaN(d.getTime())) return '';
      return d.toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' });
    } catch (e) {
      return '';
    }
  }

  function refreshExcelStatus() {
    const el = document.getElementById('vnExcelStatus');
    if (!el) return;

    const ihr = collectIhracatInfo();
    const piy = collectPiyasaInfo();
    const ihrYd = [...ihr.ydKeys].sort().slice(0, 12);
    const ihrFiles = ihr.files.length ? ihr.files.join(' · ') : '—';
    const ihrWhen = fmtLoadedAt(ihr.loadedAt);

    const piyWeek = piy.week ? piy.week + '. hafta' : (piy.sheet || '—');
    const piyWhen = fmtLoadedAt(piy.loadedAt);

    const ihrBlock =
      ihr.count > 0
        ? '<span class="vn-excel-ok">Yüklü</span>'
        : '<span class="vn-excel-no">Yüklü değil</span>';

    const piyBlock =
      piy.count > 0
        ? '<span class="vn-excel-ok">Yüklü</span>'
        : '<span class="vn-excel-no">Yüklü değil</span>';

    el.innerHTML =
      '<div class="vn-excel-grid">' +
      '<div class="vn-excel-card vn-excel-card--ihr">' +
      '<div class="vn-excel-card-title">İHRACAT Excel ' +
      ihrBlock +
      '</div>' +
      '<ul class="vn-excel-list">' +
      '<li><b>Dosya:</b> ' +
      esc(ihrFiles) +
      '</li>' +
      '<li><b>Kayıt:</b> ' +
      ihr.count +
      ' satır</li>' +
      (ihrYd.length ? '<li><b>YD blokları:</b> ' + esc(ihrYd.join(', ')) + '</li>' : '') +
      (ihrWhen ? '<li><b>Son yükleme:</b> ' + esc(ihrWhen) + '</li>' : '') +
      '</ul></div>' +
      '<div class="vn-excel-card vn-excel-card--piy">' +
      '<div class="vn-excel-card-title">PİYASA Excel ' +
      piyBlock +
      '</div>' +
      '<ul class="vn-excel-list">' +
      '<li><b>Hafta / sayfa:</b> ' +
      esc(piyWeek) +
      (piy.sheet && piy.week ? ' · ' + esc(piy.sheet) : '') +
      '</li>' +
      '<li><b>Sipariş:</b> ' +
      piy.count +
      ' satır</li>' +
      (piyWhen ? '<li><b>Son yükleme:</b> ' + esc(piyWhen) + '</li>' : '') +
      '</ul></div></div>' +
      '<p class="vn-excel-hint">' +
      '<b>Kurallar dosyaya bağlı değil.</b> Excel yenilense veya silinse bile notlar sunucuda kalır. ' +
      '<b>Firma</b> ve <b>P1/P2</b> kuralları yazdırırken formdaki değerlere bakar (Excel şart değil). ' +
      '<b>YD</b> kuralı: plaka ihracat listesinde o YD bloğundaysa veya formda firma/not alanında YD geçiyorsa uyarı verir.' +
      '</p>';
  }

  async function apiList(mode) {
    const q = mode === 'all' ? '?active=all' : mode === 'inactive' ? '?active=0' : '?active=1';
    const res = await fetch('/api/operation-notes' + q, { credentials: 'include' });
    if (res.status === 401) {
      location.href = 'GIRIS.html';
      return [];
    }
    if (!res.ok) throw new Error('Liste alinamadi');
    const data = await res.json();
    return Array.isArray(data.notes) ? data.notes : [];
  }

  async function loadList() {
    const listEl = document.getElementById('vnList');
    const loading = document.getElementById('vnListLoading');
    const empty = document.getElementById('vnListEmpty');
    const showInactive = document.getElementById('vnShowInactive')?.checked;
    if (!listEl) return;
    loading.classList.remove('hidden');
    empty.classList.add('hidden');
    listEl.innerHTML = '';
    Object.keys(_notesCache).forEach((k) => delete _notesCache[k]);
    try {
      const notes = await apiList(showInactive ? 'all' : 'active');
      loading.classList.add('hidden');
      if (!notes.length) {
        empty.classList.remove('hidden');
        return;
      }
      notes.forEach((n) => {
        _notesCache[n.id] = n;
        const div = document.createElement('div');
        div.className = 'vn-note-item' + (n.active ? '' : ' inactive');
        div.setAttribute('data-id', n.id);
        div.innerHTML =
          '<div class="flex justify-between gap-2 flex-wrap mb-2">' +
          '<div>' +
          ruleBadges(n) +
          (n.active ? '' : ' <span class="vn-badge" style="background:#e2e8f0;color:#64748b">Pasif</span>') +
          '</div>' +
          '<div class="text-xs text-gray-400">' +
          esc(fmtDate(n.created_at)) +
          '</div></div>' +
          '<p class="text-sm text-gray-800 mb-2 whitespace-pre-wrap">' +
          esc(n.body) +
          '</p>' +
          '<div class="text-xs text-gray-500 mb-2">' +
          esc(n.author_username || '') +
          '</div>' +
          '<div class="flex gap-2 flex-wrap">' +
          (n.active
            ? '<button type="button" class="vn-btn-ghost vn-deact" data-id="' +
              esc(n.id) +
              '">Pasif yap</button>'
            : '<button type="button" class="vn-btn-ghost vn-act" data-id="' +
              esc(n.id) +
              '">Aktif yap</button>') +
          '<button type="button" class="vn-btn-ghost vn-edit" data-id="' +
          esc(n.id) +
          '">Düzenle</button>' +
          '<button type="button" class="vn-btn-ghost vn-del text-red-700" data-id="' +
          esc(n.id) +
          '">Sil</button>' +
          '</div>';
        listEl.appendChild(div);
      });
      listEl.querySelectorAll('.vn-deact').forEach((btn) => {
        btn.addEventListener('click', () => toggleNote(btn.getAttribute('data-id'), false));
      });
      listEl.querySelectorAll('.vn-act').forEach((btn) => {
        btn.addEventListener('click', () => toggleNote(btn.getAttribute('data-id'), true));
      });
      listEl.querySelectorAll('.vn-edit').forEach((btn) => {
        btn.addEventListener('click', () => {
          const id = btn.getAttribute('data-id');
          const note = _notesCache[id];
          if (note) startEdit(note);
        });
      });
      listEl.querySelectorAll('.vn-del').forEach((btn) => {
        btn.addEventListener('click', () => deleteNote(btn.getAttribute('data-id')));
      });
      if (_editingId) {
        const still = _notesCache[_editingId];
        if (still) {
          const row = document.querySelector('.vn-note-item[data-id="' + CSS.escape(_editingId) + '"]');
          if (row) row.classList.add('is-editing');
        } else {
          setFormCreateMode();
          document.getElementById('vnForm')?.reset();
        }
      }
    } catch (e) {
      loading.classList.add('hidden');
      listEl.innerHTML = '<p class="text-red-600 text-sm">' + esc(e.message) + '</p>';
    }
  }

  async function toggleNote(id, active) {
    try {
      const res = await fetch('/api/operation-notes/' + encodeURIComponent(id), {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: !!active })
      });
      if (!res.ok) throw new Error('Guncellenemedi');
      if (window.OperationNotesAlert) window.OperationNotesAlert.invalidateCache();
      await loadList();
    } catch (e) {
      const u = ui();
      if (typeof u.alert === 'function') await u.alert(e.message || 'Hata', 'danger');
      else alert(e.message || 'Hata');
    }
  }

  async function updateNote(id, body, rules) {
    const res = await fetch('/api/operation-notes/' + encodeURIComponent(id), {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body, rules })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Güncellenemedi');
    return data;
  }

  async function deleteNote(id) {
    const u = ui();
    let ok = false;
    if (typeof u.confirm === 'function') {
      ok = await u.confirm('Bu vardiya notu silinsin mi?', { okLabel: 'Sil' });
    } else {
      ok = confirm('Bu vardiya notu silinsin mi?');
    }
    if (!ok) return;

    let pw = null;
    if (typeof u.password === 'function') {
      pw = await u.password('Silme şifresini giriniz:');
    } else {
      pw = prompt('Silme şifresini giriniz:');
    }
    if (pw == null || pw === false) return;
    if (String(pw).trim() !== DELETE_PASSWORD) {
      if (typeof u.alert === 'function') await u.alert('Şifre hatalı.', 'danger');
      else alert('Şifre hatalı.');
      return;
    }

    try {
      const res = await fetch('/api/operation-notes/' + encodeURIComponent(id), {
        method: 'DELETE',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pw })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Silinemedi');
      if (_editingId === id) {
        setFormCreateMode();
        document.getElementById('vnForm')?.reset();
      }
      if (window.OperationNotesAlert) window.OperationNotesAlert.invalidateCache();
      await loadList();
      if (typeof u.alert === 'function') await u.alert('Not silindi.', 'success');
    } catch (e) {
      if (typeof u.alert === 'function') await u.alert(e.message || 'Hata', 'danger');
      else alert(e.message || 'Hata');
    }
  }

  async function submitForm(ev) {
    ev.preventDefault();
    const errEl = document.getElementById('vnFormError');
    errEl.classList.add('hidden');
    const body = (document.getElementById('vnBody')?.value || '').trim();
    const firmaRaw = (document.getElementById('vnFirmaKodu')?.value || '').trim();
    const sehirRaw = (document.getElementById('vnSehir')?.value || '').trim();
    const ruleParts = rulesFromFirmaKoduInput(firmaRaw, sehirRaw);
    ruleParts.malzeme_p1p2 = !!document.getElementById('vnMalzemeP1P2')?.checked;
    const excel_type = 'genel';
    if (!body) {
      errEl.textContent = 'Not metni zorunlu.';
      errEl.classList.remove('hidden');
      return;
    }
    if (!ruleParts.yd_key && !ruleParts.firma_kodu && !ruleParts.malzeme_p1p2) {
      errEl.textContent = 'En az bir kural secin (firma kodu veya P1/P2).';
      errEl.classList.remove('hidden');
      return;
    }
    try {
      if (_editingId) {
        await updateNote(_editingId, body, ruleParts);
        setFormCreateMode();
        document.getElementById('vnForm')?.reset();
        if (window.OperationNotesAlert) window.OperationNotesAlert.invalidateCache();
        await loadList();
        const u = ui();
        if (typeof u.alert === 'function') await u.alert('Not güncellendi.', 'success');
        return;
      }
      const res = await fetch('/api/operation-notes', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          body,
          excel_type,
          rules: ruleParts
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Kaydedilemedi');
      document.getElementById('vnForm')?.reset();
      if (window.OperationNotesAlert) window.OperationNotesAlert.invalidateCache();
      await loadList();
    } catch (e) {
      errEl.textContent = e.message || 'Hata';
      errEl.classList.remove('hidden');
    }
  }

  async function init() {
    if (window.SessionManager && typeof SessionManager.requireValidSession === 'function') {
      const ok = await SessionManager.requireValidSession();
      if (!ok) return;
    }
    document.getElementById('vnBackBtn')?.addEventListener('click', () => {
      if (window.SessionManager && typeof window.SessionManager.navigateToHome === 'function') {
        window.SessionManager.navigateToHome();
      } else {
        location.href = 'GIRIS.html';
      }
    });
    document.getElementById('vnForm')?.addEventListener('submit', submitForm);
    document.getElementById('vnCancelEdit')?.addEventListener('click', () => {
      setFormCreateMode();
      document.getElementById('vnForm')?.reset();
      document.getElementById('vnFormError')?.classList.add('hidden');
    });
    document.getElementById('vnShowInactive')?.addEventListener('change', loadList);
    refreshExcelStatus();
    if (window.DailyStore && typeof DailyStore.init === 'function') {
      DailyStore.init().then(refreshExcelStatus).catch(() => {});
    }
    await loadList();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
