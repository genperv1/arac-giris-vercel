(function () {
  'use strict';

  let _rows = [];
  let _weeks = [];

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

  function queryParams() {
    const p = new URLSearchParams();
    const firma = (document.getElementById('pcFirma')?.value || '').trim();
    const plaka = (document.getElementById('pcPlaka')?.value || '').trim();
    if (firma) p.set('firma', firma);
    if (plaka) p.set('plaka', plaka);
    p.set('limit', '2000');
    return p;
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

  function istanbulYmdFromMs(ms) {
    const n = Number(ms);
    if (!Number.isFinite(n) || n <= 0) return '';
    try {
      return new Date(n).toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
    } catch (e) {
      return '';
    }
  }

  function groupRowsLocally(rows) {
    const currentWeek = isoWeekFromYmd(todayYmd());
    const map = new Map();
    (rows || []).forEach((row) => {
      const week = isoWeekFromYmd(istanbulYmdFromMs(row.tarih))
        || parseInt(String(row.hafta || '').replace(/[^\d]/g, ''), 10)
        || 0;
      const key = String(week || 'x');
      if (!map.has(key)) {
        const isCurrent = week === currentWeek;
        map.set(key, {
          key: key,
          week: week,
          isCurrent: isCurrent,
          title: isCurrent ? 'Bu hafta' : (week ? (week + '. hafta') : 'Diğer'),
          subtitle: isCurrent && week ? (week + '. hafta') : '',
          count: 0,
          rows: [],
        });
      }
      const g = map.get(key);
      g.rows.push(row);
      g.count = g.rows.length;
    });
    const groups = Array.from(map.values());
    if (currentWeek && !groups.some((g) => g.isCurrent)) {
      groups.push({
        key: String(currentWeek),
        week: currentWeek,
        isCurrent: true,
        title: 'Bu hafta',
        subtitle: currentWeek + '. hafta',
        count: 0,
        rows: [],
      });
    }
    groups.sort((a, b) => {
      if (a.isCurrent !== b.isCurrent) return a.isCurrent ? -1 : 1;
      return (b.week || 0) - (a.week || 0);
    });
    return groups;
  }

  function rowHtml(r) {
    return (
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
        '<td>' + esc(r.sevk_yeri) + '</td>' +
        '<td class="pc-mono">' + esc(r.tonaj || r.miktar) + '</td>' +
        '<td>' + esc(r.sofor) + '</td>' +
        '<td>' + esc(r.basim_yeri) + '</td>' +
      '</tr>'
    );
  }

  function tableHtml(rows) {
    if (!rows || !rows.length) {
      return '<div class="pc-empty">Bu haftada kayıt yok.</div>';
    }
    return (
      '<div class="pc-table-wrap">' +
        '<table class="pc-table">' +
          '<thead><tr>' +
            '<th>Tarih</th><th>Saat</th><th>Plaka</th><th>Firma</th><th>Firma adı</th><th>Sip no</th>' +
            '<th>Malzeme</th><th>Yükleme türü</th><th>Sevk yeri</th><th>Tonaj</th><th>Şoför</th><th>Basım</th>' +
          '</tr></thead>' +
          '<tbody>' + rows.map(rowHtml).join('') + '</tbody>' +
        '</table>' +
      '</div>'
    );
  }

  function summaryHtml(title, subtitle, count) {
    return (
      '<summary>' +
        '<span>' +
          '<span class="pc-acc-title">' + esc(title) + '</span>' +
          (subtitle ? '<div class="pc-acc-sub">' + esc(subtitle) + '</div>' : '') +
        '</span>' +
        '<span class="pc-acc-count">' + esc(String(count)) + ' kayıt</span>' +
      '</summary>'
    );
  }

  function weekDetailsHtml(week, extraClass, open) {
    const cls = 'pc-acc' + (extraClass ? ' ' + extraClass : '');
    return (
      '<details class="' + cls + '"' + (open ? ' open' : '') + '>' +
        summaryHtml(week.title, week.subtitle, week.count) +
        '<div class="pc-acc-body">' + tableHtml(week.rows) + '</div>' +
      '</details>'
    );
  }

  async function loadRows() {
    const host = document.getElementById('pcWeeks');
    const countEl = document.getElementById('pcCount');
    if (host) host.innerHTML = '<div class="pc-empty" style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;">Yükleniyor…</div>';
    try {
      const res = await fetch('/api/piyasa/cikanlar?' + queryParams().toString() + '&_=' + Date.now(), {
        credentials: 'include',
        cache: 'no-store',
        headers: authHeaders(false),
      });
      if (res.status === 401) {
        if (host) host.innerHTML = '<div class="pc-empty" style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;">Oturum gerekli. Ana sayfadan giriş yapın.</div>';
        return;
      }
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      _rows = Array.isArray(data.rows) ? data.rows : [];
      _weeks = Array.isArray(data.weeks) && data.weeks.length
        ? data.weeks
        : groupRowsLocally(_rows);
      const total = Number(data.total || _rows.length);
      if (countEl) countEl.textContent = total ? (total + ' kayıt — haftaya tıklayınca açılır') : 'Kayıt yok';
      renderWeeks();
    } catch (e) {
      console.warn('Piyasa çıkanlar yüklenemedi:', e);
      _rows = [];
      _weeks = [];
      if (host) host.innerHTML = '<div class="pc-empty" style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;">Liste alınamadı.</div>';
      if (countEl) countEl.textContent = '';
    }
  }

  function renderWeeks() {
    const host = document.getElementById('pcWeeks');
    if (!host) return;
    const current = _weeks.find((w) => w.isCurrent) || _weeks[0] || null;
    const past = _weeks.filter((w) => current && w.key !== current.key);
    if (!current) {
      if (_rows.length) {
        host.innerHTML = tableHtml(_rows);
        return;
      }
      host.innerHTML = '<div class="pc-empty" style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;">Bu filtrede çıkan piyasa yok.</div>';
      return;
    }
    let html = weekDetailsHtml(current, 'pc-acc--current', true);
    if (past.length) {
      const pastCount = past.reduce((n, w) => n + Number(w.count || 0), 0);
      html += (
        '<details class="pc-acc pc-acc--past">' +
          summaryHtml('Geçmiş kayıtlar', past.length + ' hafta', pastCount) +
          '<div class="pc-acc-body" style="padding:2px 0 8px;">' +
            past.map((w) => weekDetailsHtml(w, 'pc-acc--nested', false)).join('') +
          '</div>' +
        '</details>'
      );
    }
    host.innerHTML = html;
  }

  function exportExcel() {
    if (!_rows.length) {
      alert('Aktarılacak kayıt yok.');
      return;
    }
    const headers = [
      'Tarih', 'Hafta', 'Saat', 'Plaka', 'Dorse', 'Firma', 'Firma adı', 'Sip no',
      'Malzeme', 'Yükleme türü', 'Sevk yeri', 'Miktar', 'Tonaj', 'Şoför', 'Basım yeri',
    ];
    const lines = [headers.map(csvCell).join(';')];
    for (const r of _rows) {
      lines.push([
        r.tarihLabel, r.haftaLabel || r.hafta, r.saatLabel, r.plaka, r.dorse_plaka, r.firma, r.firma_adi, r.sip_no,
        r.malzeme, r.yukleme_turu, r.sevk_yeri, r.miktar, r.tonaj, r.sofor, r.basim_yeri,
      ].map(csvCell).join(';'));
    }
    const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'piyasa-cikanlar-' + todayYmd() + '.csv';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 500);
  }

  function bind() {
    document.getElementById('pcRefreshBtn')?.addEventListener('click', () => loadRows());
    document.getElementById('pcExportBtn')?.addEventListener('click', () => exportExcel());
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
