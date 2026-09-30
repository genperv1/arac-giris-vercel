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

  let xlsxPromise = null;
  function ensureXlsx() {
    if (window.XLSX && window.XLSX.utils && window.XLSX.writeFile) return Promise.resolve(window.XLSX);
    if (xlsxPromise) return xlsxPromise;
    xlsxPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'vendor/xlsx.full.min.js';
      s.onload = () => {
        if (window.XLSX && window.XLSX.utils && window.XLSX.writeFile) resolve(window.XLSX);
        else {
          xlsxPromise = null;
          reject(new Error('XLSX'));
        }
      };
      s.onerror = () => {
        xlsxPromise = null;
        reject(new Error('XLSX yüklenemedi'));
      };
      document.head.appendChild(s);
    });
    return xlsxPromise;
  }

  function exportColWidth(header, values) {
    let max = String(header || '').length;
    for (let i = 0; i < values.length; i++) {
      const parts = String(values[i] == null ? '' : values[i]).split(/\r?\n/);
      for (let j = 0; j < parts.length; j++) {
        if (parts[j].length > max) max = parts[j].length;
      }
    }
    return Math.min(Math.max(max + 3, 12), 72);
  }

  function queryParams() {
    const p = new URLSearchParams();
    const firma = (document.getElementById('pcFirma')?.value || '').trim();
    const plaka = (document.getElementById('pcPlaka')?.value || '').trim();
    const il = (document.getElementById('pcIl')?.value || '').trim();
    if (firma) p.set('firma', firma);
    if (plaka) p.set('plaka', plaka);
    if (il) p.set('il', il);
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

  function foldTrIl(s) {
    return String(s || '')
      .replace(/İ/g, 'I')
      .replace(/ı/g, 'i')
      .toUpperCase()
      .replace(/İ/g, 'I');
  }

  function isIhracatFirma(value) {
    return /(^|[^A-Za-z0-9])G?YD\d{1,4}/i.test(String(value || '').trim());
  }

  function displayFirmaKod(raw) {
    const head = String(raw || '').split('/')[0].trim();
    if (!head) return '';
    const upper = head.toLocaleUpperCase('tr-TR');
    if (/\s/.test(upper)) return upper;
    const key = upper.replace(/İ/g, 'I').replace(/ı/g, 'I');
    const m = key.match(/^([A-Z]{1,4}\d{1,4})([A-Z]{1,6})$/);
    if (!m) return upper;
    return upper.slice(0, m[1].length);
  }

  function shownFirma(r) {
    return displayFirmaKod((r && (r.firmaLabel || r.firma)) || '');
  }

  function firmaMatchesQuery(stored, query) {
    const q = foldTrIl(displayFirmaKod(query)).replace(/\s+/g, '');
    if (!q) return true;
    const shown = foldTrIl(displayFirmaKod(stored)).replace(/\s+/g, '');
    const raw = foldTrIl(String(stored || '').split('/')[0]).replace(/\s+/g, '');
    const first = foldTrIl(String(displayFirmaKod(stored)).split(/\s+/)[0] || '');
    return shown === q || raw === q || first === q;
  }

  function rowSehir(r) {
    return String(r.sehirLabel || r.sehir || r.il || r.sevk_yeri || '').trim();
  }

  function rowMatchesFilters(r) {
    const firmaQ = (document.getElementById('pcFirma')?.value || '').trim();
    const plakaQ = foldTrIl(document.getElementById('pcPlaka')?.value || '');
    const ilQ = foldTrIl(document.getElementById('pcIl')?.value || '');
    if (isIhracatFirma(r.firma) || isIhracatFirma(r.firmaLabel)) return false;
    if (firmaQ && !firmaMatchesQuery(r.firmaLabel || r.firma, firmaQ)) return false;
    if (plakaQ && !foldTrIl(r.plaka || '').includes(plakaQ) && !foldTrIl(r.dorse_plaka || '').includes(plakaQ)) return false;
    if (ilQ) {
      const hay = foldTrIl([rowSehir(r), r.sehir, r.il, r.sevk_yeri].filter(Boolean).join(' '));
      if (!hay.includes(ilQ)) return false;
    }
    return true;
  }

  function filteredRows(rows) {
    const src = Array.isArray(rows) ? rows : [];
    const firmaQ = (document.getElementById('pcFirma')?.value || '').trim();
    const plakaQ = (document.getElementById('pcPlaka')?.value || '').trim();
    const ilQ = (document.getElementById('pcIl')?.value || '').trim();
    if (!firmaQ && !plakaQ && !ilQ) return src;
    return src.filter(rowMatchesFilters);
  }

  function filterWeeks(weeks) {
    const src = Array.isArray(weeks) ? weeks : [];
    const firmaQ = (document.getElementById('pcFirma')?.value || '').trim();
    const plakaQ = (document.getElementById('pcPlaka')?.value || '').trim();
    const ilQ = (document.getElementById('pcIl')?.value || '').trim();
    if (!firmaQ && !plakaQ && !ilQ) return src;
    return src
      .map((w) => {
        const rows = filteredRows(w.rows);
        return Object.assign({}, w, { rows: rows, count: rows.length });
      })
      .filter((w) => w.isCurrent || w.count > 0);
  }

  function formatSehirHtml(text) {
    const s = String(text || '').trim();
    if (!s) return '';
    const parts = s.split(/\s*\/\s*/).filter(Boolean);
    if (parts.length <= 1) return esc(s);
    return parts
      .map((p, i) => esc(p) + (i < parts.length - 1 ? '/<br>' : ''))
      .join('');
  }

  function rowHtml(r) {
    const sehir = rowSehir(r);
    const sevk = String(r.sevk_yeri || '').trim();
    const sevkExtra = sevk && sevk.toUpperCase() !== sehir.toUpperCase()
      ? '<div class="text-slate-400">' + esc(sevk) + '</div>'
      : '';
    return (
      '<tr>' +
        '<td class="pc-mono">' + esc(r.tarihLabel) +
          (r.haftaLabel ? '<div class="pc-week">' + esc(r.haftaLabel) + '</div>' : '') +
        '</td>' +
        '<td class="pc-mono">' + esc(r.saatLabel) + '</td>' +
        '<td class="pc-mono"><strong>' + esc(r.plaka) + '</strong>' +
          (r.dorse_plaka ? '<div class="text-slate-400">' + esc(r.dorse_plaka) + '</div>' : '') +
        '</td>' +
        '<td class="pc-firma">' + esc(shownFirma(r)) + '</td>' +
        '<td>' + esc(r.firma_adi) + '</td>' +
        '<td class="pc-mono">' + esc(r.sip_no) + '</td>' +
        '<td class="pc-malzeme">' + esc(r.malzeme) + '</td>' +
        '<td>' + esc(r.yukleme_turu) + '</td>' +
        '<td class="pc-sehir">' + formatSehirHtml(sehir) + sevkExtra + '</td>' +
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
          '<colgroup>' +
            '<col class="c-tarih"><col class="c-saat"><col class="c-plaka"><col class="c-firma">' +
            '<col class="c-firma-adi"><col class="c-sip"><col class="c-malzeme"><col class="c-yukleme">' +
            '<col class="c-sehir"><col class="c-tonaj"><col class="c-sofor"><col class="c-basim">' +
          '</colgroup>' +
          '<thead><tr>' +
            '<th>Tarih</th><th>Saat</th><th>Plaka</th><th>Firma</th><th>Firma adı</th><th>Sip no</th>' +
            '<th>Malzeme</th><th>Yükleme türü</th><th>Şehir</th><th>Tonaj</th><th>Şoför</th><th>Basım</th>' +
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

  function amirOnly() {
    try {
      return !!(window.SessionManager && typeof window.SessionManager.isAmirUser === 'function' && window.SessionManager.isAmirUser());
    } catch (e) {
      return false;
    }
  }

  function denyAmirPage() {
    const host = document.getElementById('pcWeeks');
    if (host) {
      host.innerHTML = '<div class="pc-empty" style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;">Bu sayfa yalnızca GENPER · AMİR oturumuna açıktır.</div>';
    }
    document.querySelectorAll('main .pc-card').forEach((el) => { el.hidden = true; });
    setTimeout(() => {
      try {
        if (window.SessionManager && typeof window.SessionManager.navigateToHome === 'function') {
          window.SessionManager.navigateToHome();
          return;
        }
      } catch (e) { /* ignore */ }
      window.location.href = '/GIRIS.html';
    }, 700);
  }

  async function loadRows(opts) {
    const silent = !!(opts && opts.silent);
    const host = document.getElementById('pcWeeks');
    const countEl = document.getElementById('pcCount');
    if (!silent && host) host.innerHTML = '<div class="pc-empty" style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;">Yükleniyor…</div>';
    try {
      const res = await fetch('/api/piyasa/cikanlar?' + queryParams().toString() + '&_=' + Date.now(), {
        credentials: 'include',
        cache: 'no-store',
        headers: authHeaders(false),
      });
      if (res.status === 401 || res.status === 403) {
        denyAmirPage();
        return;
      }
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      _rows = Array.isArray(data.rows) ? data.rows : [];
      _weeks = Array.isArray(data.weeks) && data.weeks.length
        ? data.weeks
        : groupRowsLocally(_rows);
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
    const countEl = document.getElementById('pcCount');
    if (!host) return;
    const weeks = filterWeeks(_weeks);
    const rows = filteredRows(_rows);
    const total = rows.length;
    if (countEl) countEl.textContent = total ? (total + ' kayıt — haftaya tıklayınca açılır') : 'Bu filtrede kayıt yok';
    const current = weeks.find((w) => w.isCurrent) || weeks[0] || null;
    const past = weeks.filter((w) => current && w.key !== current.key);
    if (!current) {
      if (rows.length) {
        host.innerHTML = tableHtml(rows);
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

  async function exportExcel() {
    const rows = filteredRows(_rows);
    if (!rows.length) {
      alert('Aktarılacak kayıt yok.');
      return;
    }
    const btn = document.getElementById('pcExportBtn');
    if (btn) btn.disabled = true;
    try {
      const XLSX = await ensureXlsx();
      const headers = [
        'Tarih', 'Hafta', 'Saat', 'Plaka', 'Dorse', 'Firma', 'Firma adı', 'Sip no',
        'Malzeme', 'Yükleme türü', 'Şehir', 'Sevk yeri', 'Miktar', 'Tonaj', 'Şoför', 'Basım yeri',
      ];
      const body = rows.map((r) => [
        r.tarihLabel, r.haftaLabel || r.hafta, r.saatLabel, r.plaka, r.dorse_plaka, shownFirma(r), r.firma_adi, r.sip_no,
        r.malzeme, r.yukleme_turu, rowSehir(r), r.sevk_yeri, r.miktar, r.tonaj, r.sofor, r.basim_yeri,
      ].map((v) => (v == null ? '' : String(v))));
      const ws = XLSX.utils.aoa_to_sheet([headers, ...body]);
      const lastCol = XLSX.utils.encode_col(headers.length - 1);
      ws['!autofilter'] = { ref: 'A1:' + lastCol + (body.length + 1) };
      ws['!cols'] = headers.map((header, i) => ({
        wch: exportColWidth(header, body.map((row) => row[i])),
      }));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Piyasa Cikanlar');
      XLSX.writeFile(wb, 'piyasa-cikanlar-' + todayYmd() + '.xlsx');
    } catch (e) {
      console.warn('Excel aktarımı başarısız:', e);
      alert('Excel dosyası hazırlanamadı.');
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  function bind() {
    if (!amirOnly()) {
      denyAmirPage();
      return;
    }
    let filterTimer = null;
    document.getElementById('pcRefreshBtn')?.addEventListener('click', () => loadRows());
    document.getElementById('pcExportBtn')?.addEventListener('click', () => exportExcel());
    ['pcFirma', 'pcPlaka', 'pcIl'].forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('input', () => {
        renderWeeks();
        clearTimeout(filterTimer);
        filterTimer = setTimeout(() => loadRows({ silent: true }), 250);
      });
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          clearTimeout(filterTimer);
          loadRows();
        }
      });
    });
    loadRows();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind);
  else bind();
})();
