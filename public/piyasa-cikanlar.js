(function () {
  'use strict';

  let _rows = [];

  function esc(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function todayYmd() {
    try {
      return new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
    } catch (e) {
      const d = new Date();
      return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }
  }

  function authHeaders(json) {
    const h = { 'Cache-Control': 'no-cache' };
    if (json) h['Content-Type'] = 'application/json';
    try {
      const token = localStorage.getItem('authToken') || '';
      if (token) h.Authorization = 'Bearer ' + token;
    } catch (e) { /* ignore */ }
    return h;
  }

  function csvCell(v) {
    const s = String(v == null ? '' : v);
    if (/[;"\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function isoWeekFromYmd(ymd) {
    const m = String(ymd || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return null;
    const date = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
    const dayNum = date.getUTCDay() || 7;
    date.setUTCDate(date.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
    return Number.isFinite(weekNo) && weekNo > 0 ? weekNo : null;
  }

  function setDateWeekHints() {
    const from = (document.getElementById('pcFrom')?.value || '').trim();
    const to = (document.getElementById('pcTo')?.value || '').trim();
    const fromHint = document.getElementById('pcFromWeek');
    const toHint = document.getElementById('pcToWeek');
    const fw = isoWeekFromYmd(from);
    const tw = isoWeekFromYmd(to);
    if (fromHint) fromHint.textContent = fw ? (fw + '. hafta') : '';
    if (toHint) toHint.textContent = tw ? (tw + '. hafta') : '';
  }

  function setToday() {
    const ymd = todayYmd();
    const fromEl = document.getElementById('pcFrom');
    const toEl = document.getElementById('pcTo');
    if (fromEl) fromEl.value = ymd;
    if (toEl) toEl.value = ymd;
    setDateWeekHints();
  }

  function queryParams() {
    const p = new URLSearchParams();
    const from = (document.getElementById('pcFrom')?.value || '').trim();
    const to = (document.getElementById('pcTo')?.value || '').trim();
    const firma = (document.getElementById('pcFirma')?.value || '').trim();
    const plaka = (document.getElementById('pcPlaka')?.value || '').trim();
    if (from) p.set('from', from);
    if (to) p.set('to', to);
    if (firma) p.set('firma', firma);
    if (plaka) p.set('plaka', plaka);
    p.set('limit', '2000');
    return p;
  }

  async function loadRows() {
    const tbody = document.getElementById('pcTbody');
    const countEl = document.getElementById('pcCount');
    if (tbody) tbody.innerHTML = '<tr><td colspan="13" class="pc-empty">Yükleniyor…</td></tr>';
    try {
      const res = await fetch('/api/piyasa/cikanlar?' + queryParams().toString() + '&_=' + Date.now(), {
        credentials: 'include',
        cache: 'no-store',
        headers: authHeaders(false),
      });
      if (res.status === 401) {
        if (tbody) tbody.innerHTML = '<tr><td colspan="13" class="pc-empty">Oturum gerekli. Ana sayfadan giriş yapın.</td></tr>';
        return;
      }
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      _rows = Array.isArray(data.rows) ? data.rows : [];
      const total = Number(data.total || _rows.length);
      if (countEl) countEl.textContent = total ? (total + ' kayıt') : 'Kayıt yok';
      renderTable();
    } catch (e) {
      console.warn('Piyasa çıkanlar yüklenemedi:', e);
      _rows = [];
      if (tbody) tbody.innerHTML = '<tr><td colspan="13" class="pc-empty">Liste alınamadı.</td></tr>';
      if (countEl) countEl.textContent = '';
    }
  }

  function renderTable() {
    const tbody = document.getElementById('pcTbody');
    if (!tbody) return;
    if (!_rows.length) {
      tbody.innerHTML = '<tr><td colspan="13" class="pc-empty">Bu filtrede çıkan piyasa yok.</td></tr>';
      return;
    }
    tbody.innerHTML = _rows.map((r) => (
      '<tr>' +
        '<td class="pc-mono">' + esc(r.tarihLabel) +
          (r.haftaLabel ? '<div class="pc-week">' + esc(r.haftaLabel) + '</div>' : '') +
        '</td>' +
        '<td class="pc-mono">' + esc(r.saatLabel) + '</td>' +
        '<td class="pc-mono"><strong>' + esc(r.plaka) + '</strong>' +
          (r.dorse_plaka ? '<div class="text-slate-400">' + esc(r.dorse_plaka) + '</div>' : '') +
        '</td>' +
        '<td>' + esc(r.firma) + '</td>' +
        '<td>' + esc(r.firma_adi) + '</td>' +
        '<td class="pc-mono">' + esc(r.sip_no) + '</td>' +
        '<td>' + esc(r.malzeme) + '</td>' +
        '<td>' + esc(r.yukleme_turu) + '</td>' +
        '<td>' + esc(r.sehir) + '</td>' +
        '<td>' + esc(r.sevk_yeri) + '</td>' +
        '<td class="pc-mono">' + esc(r.tonaj || r.miktar) + '</td>' +
        '<td>' + esc(r.sofor) + '</td>' +
        '<td>' + esc(r.basim_yeri) + '</td>' +
      '</tr>'
    )).join('');
  }

  function exportExcel() {
    if (!_rows.length) {
      alert('Aktarılacak kayıt yok.');
      return;
    }
    const headers = [
      'Tarih', 'Hafta', 'Saat', 'Plaka', 'Dorse', 'Firma', 'Firma adı', 'Sip no',
      'Malzeme', 'Yükleme türü', 'Şehir', 'Sevk yeri', 'Miktar', 'Tonaj', 'Şoför', 'Basım yeri',
    ];
    const lines = [headers.map(csvCell).join(';')];
    for (const r of _rows) {
      lines.push([
        r.tarihLabel, r.haftaLabel || r.hafta, r.saatLabel, r.plaka, r.dorse_plaka, r.firma, r.firma_adi, r.sip_no,
        r.malzeme, r.yukleme_turu, r.sehir, r.sevk_yeri, r.miktar, r.tonaj, r.sofor, r.basim_yeri,
      ].map(csvCell).join(';'));
    }
    const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    const from = (document.getElementById('pcFrom')?.value || todayYmd());
    a.href = URL.createObjectURL(blob);
    a.download = 'piyasa-cikanlar-' + from + '.csv';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 500);
  }

  function bind() {
    setToday();
    document.getElementById('pcTodayBtn')?.addEventListener('click', () => { setToday(); loadRows(); });
    document.getElementById('pcRefreshBtn')?.addEventListener('click', () => loadRows());
    document.getElementById('pcExportBtn')?.addEventListener('click', () => exportExcel());
    ['pcFrom', 'pcTo'].forEach((id) => {
      document.getElementById(id)?.addEventListener('change', () => {
        setDateWeekHints();
        loadRows();
      });
    });
    ['pcFirma', 'pcPlaka'].forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); loadRows(); }
      });
    });
    loadRows();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind);
  else bind();
})();
