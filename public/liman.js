(function () {
  'use strict';

  var state = { days: [], closedDays: [], canEdit: false, day: '', port: '', plate: '', reports: null };
  var toastTimer = 0;

  function $(id) { return document.getElementById(id); }

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function toast(text) {
    var el = $('toast');
    if (!el) return;
    el.textContent = text;
    el.style.display = 'block';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.style.display = 'none'; }, 2400);
  }

  async function api(path, options) {
    var res = await fetch(path, Object.assign({ credentials: 'same-origin' }, options || {}));
    var data = await res.json().catch(function () { return {}; });
    if (!res.ok) throw new Error(data.error || 'İstek olmadı');
    return data;
  }

  function applyView(data) {
    state.days = data.days || [];
    state.version = data.version || '';
    state.canEdit = !!data.canEdit;
    state.sites = data.sites || {};
    state.closedDays = Array.isArray(data.closedDays) ? data.closedDays : [];
    state.events = Array.isArray(data.events) ? data.events : [];
    if (!state.days.some(function (d) { return d.dateKey === state.day; })) {
      state.day = state.days[0] ? state.days[0].dateKey : '';
    }
    if (state.reports) applyMarks();
    if (Array.isArray(data.presence) && window.SessionManager && typeof SessionManager.presenceChipHtml === 'function') {
      var chip = $('chipPresence');
      if (chip) chip.innerHTML = SessionManager.presenceChipHtml(data.presence);
    }
    renderExcelStatus();
    setLive(true);
    render();
  }

  async function load() {
    applyView(await api('/api/liman'));
  }

  var READ_REASON = {
    permission: 'dosya izni yok, kantarda bir kez Güncelle',
    'not-found': 'Excel dosyası bulunamadı',
    'no-excel': 'Excel seçilmemiş',
    error: 'okuma hatası',
  };

  /** Liste kendiliğinden yenileniyor mu: sunucuya ulaşılamazsa "Bağlantı yok". */
  function setLive(ok) {
    var el = $('liveDot');
    if (!el) return;
    el.classList.toggle('is-off', !ok);
    el.lastChild.textContent = ok ? 'Canlı' : 'Bağlantı yok';
  }

  /** Yalnız amir: online çubuğunun altında her kantarın son Excel okuma sonucu. */
  function renderExcelStatus() {
    var box = $('excelStatus');
    if (!box) return;
    if (!state.canEdit) {
      box.innerHTML = '';
      return;
    }
    var hm = function (iso) { return iso ? new Date(iso).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }) : ''; };
    box.innerHTML = ['AVDAN', '1.OSB'].map(function (site) {
      var info = (state.sites || {})[site] || null;
      var at = info && info.heartbeatAt;
      var readOk = info ? info.heartbeatReadOk : null;
      var cls = 'xs-none';
      var text;
      if (!at || readOk === null || readOk === undefined) {
        text = 'Excel okuma bilgisi yok';
      } else if (Date.now() - new Date(at).getTime() > 25 * 60 * 1000) {
        text = 'kantar sayfası kapalı · son okuma ' + hm(info.heartbeatReadOkAt || at);
      } else if (readOk) {
        cls = 'xs-ok';
        text = 'Excel okundu ' + hm(info.heartbeatReadOkAt || at);
      } else {
        cls = 'xs-bad';
        text = (READ_REASON[info.heartbeatReadReason] || 'Excel okunamıyor') +
          (info.heartbeatReadOkAt ? ' · son başarılı ' + hm(info.heartbeatReadOkAt) : '');
      }
      return '<span class="xs-item ' + cls + '"><b>' + esc(site) + ':</b> ' + esc(text) + '</span>';
    }).join('');
  }

  function renderAdmin() {
    var box = $('adminBox');
    if (!box) return;
    if (!state.canEdit) {
      box.innerHTML = '';
      return;
    }
    var fmt = function (iso) { return iso ? new Date(iso).toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'; };
    var html = '';

    // Gönderim günlüğü: kantar gönderdi mi, aynı mıydı, reddedildi mi (oturum) — amir buradan anlar
    var ev = state.events || [];
    if (ev.length) {
      var denied = ev.filter(function (e) { return e.kind === 'denied' || e.kind === 'error'; }).length;
      var kindLabel = { changed: 'liste güncellendi', unchanged: 'aynı içerik', heartbeat: 'nabız', denied: 'REDDEDİLDİ (oturum)', error: 'HATA' };
      html += '<details class="known liman-log"' + (denied ? ' open' : '') + '><summary>Gönderim günlüğü (son ' + ev.length + ')' +
        (denied ? ' · <b class="log-denied">' + denied + ' red/hata</b>' : '') + '</summary><ul>' +
        ev.slice(0, 20).map(function (e) {
          var extra = [];
          if (e.site) extra.push(e.site);
          if (e.user) extra.push(e.user);
          if (e.fileName) extra.push(e.fileName);
          if (typeof e.rows === 'number') extra.push(e.rows + ' satır');
          if (e.kind === 'heartbeat' && e.excel === false) extra.push('Excel yok');
          if (e.reason) extra.push({ expired: 'süre dolmuş', 'no-token': 'oturum yok', invalid: 'geçersiz oturum' }[e.reason] || e.reason);
          if (e.error) extra.push(e.error);
          if (e.ip) extra.push(e.ip);
          return '<li class="log-' + esc(e.kind) + '">' + esc(fmt(e.at)) + ' — <b>' + esc(kindLabel[e.kind] || e.kind) + '</b>' +
            (extra.length ? ' · ' + esc(extra.join(' · ')) : '') + '</li>';
        }).join('') + '</ul></details>';
    }

    // Sevkiyat bitince amir günün listesini kapatır; liman tarafı o günü görmez.
    var day = activeDay();
    var closeRow = '';
    if (day) {
      closeRow = '<span class="close-day-text">Sevkiyat bitti mi? Liman görevlisi bu listeyi artık görmesin:</span>' +
        '<button type="button" class="btn btn-close-day" data-close-day="' + esc(day.dateKey) + '">' + esc(day.label) + ' listesini kapat</button>';
    }
    var closedRow = '';
    if (state.closedDays.length) {
      closedRow = '<span class="closed-label">Kapalı listeler:</span> ' + state.closedDays.map(function (c) {
        var when = c.at ? new Date(c.at).toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
        return '<span class="closed-item"><b>' + esc(c.label) + '</b> · ' + (c.rowCount || 0) + ' satır' +
          (when ? ' · ' + esc(when) : '') + (c.by ? ' · ' + esc(c.by) : '') +
          ' <button type="button" class="chip chip-reopen" data-reopen-day="' + esc(c.dateKey) + '">Yeniden aç</button></span>';
      }).join(' ');
    }
    if (closeRow || closedRow) {
      html += '<div class="known admin-days">' +
        (closeRow ? '<div class="close-day-row">' + closeRow + '</div>' : '') +
        (closedRow ? '<div class="closed-days-row">' + closedRow + '</div>' : '') +
        '</div>';
    }
    box.innerHTML = html;
  }

  function todayLabel() {
    var d = new Date();
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return p(d.getDate()) + '.' + p(d.getMonth() + 1) + '.' + d.getFullYear();
  }

  async function closeDay(dateKey, btn) {
    var day = state.days.filter(function (d) { return d.dateKey === dateKey; })[0];
    var label = day ? day.label : dateKey;
    if (!window.confirm(label + ' listesi kapatılsın mı?\n\nLiman görevlisi bu listeyi artık görmeyecek. Sonraki günün listesi yüklüyse o gösterilir, yoksa liste boş kalır.')) return;
    if (btn) btn.disabled = true;
    try {
      applyView(await api('/api/liman/day/' + encodeURIComponent(dateKey) + '/close', { method: 'PUT' }));
      toast(label + ' listesi kapatıldı');
    } catch (err) {
      if (btn) btn.disabled = false;
      toast(err.message || 'Liste kapatılamadı');
    }
  }

  async function reopenDay(dateKey, btn) {
    if (btn) btn.disabled = true;
    try {
      applyView(await api('/api/liman/day/' + encodeURIComponent(dateKey) + '/close', { method: 'DELETE' }));
      state.day = dateKey;
      render();
      toast('Liste yeniden açıldı');
    } catch (err) {
      if (btn) btn.disabled = false;
      toast(err.message || 'Liste açılamadı');
    }
  }

  function activeDay() {
    return state.days.filter(function (d) { return d.dateKey === state.day; })[0] || null;
  }

  function portsOf(day) {
    var seen = [];
    ((day && day.blocks) || []).forEach(function (block) {
      var port = block.liman || block.port || '';
      if (port && seen.indexOf(port) < 0) seen.push(port);
    });
    return seen;
  }

  function rowDeparted(row) {
    if (row._nbLiveDeparted) return true;
    var core = window.NakliyeBekleyenCore;
    if (core && typeof core.isRowDeparted === 'function') return !!core.isRowDeparted(row);
    return Number(String(row.gidenTonaj || '').replace(/\./g, '').replace(',', '.')) >= 1000;
  }

  function blockProgress(block) {
    var rows = block.rows || [];
    var done = rows.filter(rowDeparted).length;
    return { done: done, total: rows.length, complete: rows.length > 0 && done === rows.length };
  }

  function numCell(value) {
    var s = String(value == null ? '' : value).trim();
    if (!s || s === '0' || s === '0.0') return '';
    if (/^\d+(\.\d+)?$/.test(s)) {
      var n = Number(s);
      if (n >= 1000) return n.toLocaleString('tr-TR');
    }
    return s;
  }

  function telHref(raw) {
    var digits = String(raw || '').replace(/[^\d+]/g, '');
    if (digits.length < 7) return '';
    // Excel'de başındaki 0 düşmüş cep numarası (5XX XXX XX XX) → aramada 0 ekle
    if (/^5\d{9}$/.test(digits)) digits = '0' + digits;
    return 'tel:' + digits;
  }

  function telCell(raw) {
    var text = String(raw || '').trim();
    if (!text) return '';
    var href = telHref(text);
    if (!href) return esc(text);
    return '<a class="tel" href="' + esc(href) + '">' + esc(text) + '</a>';
  }

  function visibleBlocks() {
    var day = activeDay();
    if (!day) return [];
    var q = String(state.plate || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    return (day.blocks || []).filter(function (block) {
      var port = block.liman || block.port || '';
      if (state.port && port !== state.port) return false;
      if (!q) return true;
      return (block.rows || []).some(function (row) {
        return String(row.plaka || '').toUpperCase().replace(/[^A-Z0-9]/g, '').indexOf(q) >= 0;
      });
    }).map(function (block) {
      if (!q) return block;
      return Object.assign({}, block, {
        rows: (block.rows || []).filter(function (row) {
          return String(row.plaka || '').toUpperCase().replace(/[^A-Z0-9]/g, '').indexOf(q) >= 0;
        })
      });
    });
  }

  function renderPorts() {
    var day = activeDay();
    var ports = portsOf(day);
    if (state.port && ports.indexOf(state.port) < 0) state.port = '';
    var html = '<button type="button" class="chip' + (!state.port ? ' is-on' : '') + '" data-port="">Hepsi</button>';
    ports.forEach(function (port) {
      html += '<button type="button" class="chip' + (state.port === port ? ' is-on' : '') + '" data-port="' + esc(port) + '">' + esc(port) + '</button>';
    });
    $('ports').innerHTML = html;
    $('sheetTabs').innerHTML = state.days.map(function (d) {
      return '<button type="button" class="tab' + (d.dateKey === state.day ? ' is-on' : '') + '" data-day="' + esc(d.dateKey) + '">' + esc(d.label) + '</button>';
    }).join('');
  }

  function renderList() {
    var blocks = visibleBlocks();
    if (!state.days.length) {
      var today = todayLabel();
      var closedToday = state.closedDays.some(function (c) { return c.label === today; });
      var msg = closedToday
        ? today + ' sevkiyatı tamamlandı, liste kapatıldı. Yeni günün listesi kantardan gelince burada görünecek.'
        : 'Açık sevkiyat listesi yok. ' + today + ' listesi kantardan henüz gelmedi.';
      $('list').innerHTML = '<p class="empty">' + esc(msg) + '</p>';
      return;
    }
    if (!blocks.length) {
      $('list').innerHTML = '<p class="empty">Bu limanda satır yok.</p>';
      return;
    }
    $('list').innerHTML = '<div class="sheet">' + blocks.map(function (block) {
      var rows = (block.rows || []).map(function (row) {
        var plate = String(row.plaka || '').trim();
        var plateHtml = plate ? '<b>' + esc(plate) + '</b>' : '<span class="noplate">plaka yok</span>';
        if (rowDeparted(row)) plateHtml += '<div class="mark">sarılmış</div>';
        var note = row.note ? '<span class="rownote">' + esc(row.note) + '</span>' : '';
        var editor = '';
        if (state.canEdit && row.irsaliyeNo) {
          editor = '<span class="rownote"><input data-note="' + esc(row.irsaliyeNo) + '" value="' + esc(row.note || '') + '" placeholder="Not" /></span>';
        }
        var out = rowDeparted(row);
        // Çıkmış araçta Excel'in eski "İÇERİDE / DIŞARIDA" notu gösterilmez; durum tek: SARILMIŞ
        var durum = out ? 'SARILMIŞ' : String(row.durum || '').trim();
        // Telefon görünümü için kısa özet (masaüstünde gizli)
        var sum = [
          ['BBT', numCell(row.bbt)],
          ['NET', numCell(row.net)],
          ['GİDEN', numCell(row.giden || row.gidenTonaj)],
          ['YÜKLEME', String(row.yukleme || row.yuklemeYeri || '').trim()],
        ].filter(function (p) { return p[1]; }).map(function (p) {
          return '<b>' + p[0] + ':</b> ' + esc(p[1]);
        }).join(' · ');
        return '<tr class="' + (out ? 'is-out' : '') + '">' +
          '<td class="c-sira">' + esc(row.sira || '') + '</td>' +
          '<td class="left c-plaka">' + plateHtml + note + editor + '</td>' +
          '<td class="c-min c-bbt">' + esc(numCell(row.bbt)) + '</td>' +
          '<td class="c-min c-nar">' + esc(numCell(row.cuval)) + '</td>' +
          '<td class="c-min c-nar">' + esc(numCell(row.palet)) + '</td>' +
          '<td class="c-min c-nar">' + esc(numCell(row.bosBbt)) + '</td>' +
          '<td class="c-min c-nar">' + esc(numCell(row.bosCuval)) + '</td>' +
          '<td class="c-min c-ton">' + esc(numCell(row.net)) + '</td>' +
          '<td class="c-min c-ton">' + esc(numCell(row.giden || row.gidenTonaj)) + '</td>' +
          '<td class="durum c-durum' + (out ? ' is-out' : '') + '" data-fallback="' + (out ? 'SARILMIŞ' : 'BEKLİYOR') + '">' + esc(durum) + '</td>' +
          '<td class="c-min c-yer">' + esc(row.yukleme || row.yuklemeYeri || '') + '</td>' +
          '<td class="left c-sofor">' + esc(row.sofor || '') + '</td>' +
          '<td class="c-tel">' + telCell(row.telefon) + '</td>' +
          '<td class="c-sum">' + sum + '</td>' +
          '</tr>';
      }).join('');
      var noteLine = block.note ? '<p class="note-line">' + esc(block.note) + '</p>' : '';
      var progress = blockProgress(block);
      var statusLine = progress.complete
        ? '<p class="done-line"><i>✔</i> SEVKİYAT TAMAMLANDI · ' + progress.total + ' / ' + progress.total + ' araç çıktı</p>'
        : '<p class="progress-line">' + progress.done + ' / ' + progress.total + ' araç çıktı</p>';
      return '<section class="blok' + (progress.complete ? ' is-done' : '') + '">' +
        '<div class="blok-head">' +
          '<h2 class="blok-title">' + esc(block.title || '') + '</h2>' +
          '<table class="meta"><tbody>' +
            '<tr><th>LİMAN</th><td>' + esc(block.liman || block.port || '') + '</td></tr>' +
            '<tr><th>GEMİ DETAYI</th><td>' + esc(block.gemi || '') + '</td></tr>' +
            '<tr><th>BOOKING</th><td>' + esc(block.booking || '') + '</td></tr>' +
            '<tr><th>SEVK.TARİHİ</th><td>' + esc(block.sevk || '') + '</td></tr>' +
          '</tbody></table>' +
        '</div>' +
        statusLine +
        noteLine +
        '<table class="grid"><thead><tr>' +
          '<th class="c-sira"></th><th class="c-plaka">PLAKA</th><th class="c-bbt">BBT</th>' +
          '<th class="c-nar">ÇUVAL</th><th class="c-nar">PALET</th><th class="c-nar">BOŞ<br>BBT</th><th class="c-nar">BOŞ<br>ÇUVAL</th>' +
          '<th class="c-ton">NET</th><th class="c-ton">GİDEN</th><th class="c-durum">DURUM</th><th class="c-yer">YÜKLEME<br>YERİ</th>' +
          '<th class="c-sofor">ŞOFÖR</th><th class="c-tel">TELEFON</th>' +
        '</tr></thead><tbody>' + rows + '</tbody></table></section>';
    }).join('') + '</div>';
  }

  function render() {
    renderAdmin();
    renderPorts();
    renderList();
  }

  function reportYd(report) {
    var d = (report && report.data) || {};
    var blob = [report && report.firma, d.firma, d.ydKey, d.headerText, d.yuklemeNotu, d.lotNo].join(' ');
    var m = blob.match(/\b(YD\d{1,4})\b/i);
    return m ? m[1].toUpperCase() : '';
  }

  function attachFaces(rows, reports) {
    var core = window.NakliyeBekleyenCore;
    if (!core || typeof core.plateKey !== 'function') return rows;
    var slots = (reports || []).map(function (report) {
      var d = report.data || {};
      return {
        used: false,
        pk: core.plateKey(report.plaka || d.plaka || ''),
        yd: reportYd(report),
        sofor: d.sofor || '',
        telefon: d.iletisim || '',
        tarih: report.tarih || d.tarih || '',
        saat: report.saat || d.saat || '',
      };
    });
    return rows.map(function (row) {
      if (!rowDeparted(row)) return row;
      var pk = core.plateKey(row.plaka);
      var yd = String(row.ydKey || '').toUpperCase();
      var slot = slots.filter(function (item) {
        if (item.used || !item.pk || item.pk !== pk) return false;
        if (item.yd && yd) return item.yd === yd;
        return !item.yd && !yd;
      })[0];
      if (!slot) return row;
      slot.used = true;
      var next = Object.assign({}, row, {
        cikisTarih: slot.tarih,
        cikisSaat: slot.saat,
      });
      if (!next.sofor && slot.sofor) next.sofor = slot.sofor;
      if (!next.telefon && slot.telefon) next.telefon = slot.telefon;
      return next;
    });
  }

  async function guncelle() {
    var since = Date.now() - 3 * 24 * 60 * 60 * 1000;
    // Oturumsuz çıkış akışı (liman görevlisi giriş yapmaz)
    var res = await fetch('/api/liman/departed?since=' + since, { credentials: 'same-origin', cache: 'no-store' });
    state.reports = res.ok ? await res.json() : (state.reports || []);
    await load();
    lastCheck = Date.now();
    lastFull = Date.now();
  }

  function applyMarks() {
    var core = window.NakliyeBekleyenCore;
    if (core && typeof core.applyLiveDepartedMarks === 'function') {
      state.days = state.days.map(function (day) {
        var flat = [];
        (day.blocks || []).forEach(function (block) {
          (block.rows || []).forEach(function (row) { flat.push(row); });
        });
        var marked = core.applyLiveDepartedMarks(flat, { dateKey: day.dateKey }, state.reports, { forPending: true });
        var faced = attachFaces(marked, state.reports);
        var cursor = 0;
        return Object.assign({}, day, {
          blocks: (day.blocks || []).map(function (block) {
            var count = (block.rows || []).length;
            var rows = faced.slice(cursor, cursor + count);
            cursor += count;
            return Object.assign({}, block, { rows: rows });
          })
        });
      });
    }
  }

  document.getElementById('plate').addEventListener('input', function (ev) {
    state.plate = ev.target.value || '';
    renderList();
  });

  document.body.addEventListener('click', function (ev) {
    var closeBtn = ev.target.closest('[data-close-day]');
    if (closeBtn) {
      closeDay(closeBtn.getAttribute('data-close-day') || '', closeBtn);
      return;
    }
    var reopenBtn = ev.target.closest('[data-reopen-day]');
    if (reopenBtn) {
      reopenDay(reopenBtn.getAttribute('data-reopen-day') || '', reopenBtn);
      return;
    }
    var dayBtn = ev.target.closest('[data-day]');
    if (dayBtn) {
      state.day = dayBtn.getAttribute('data-day') || '';
      state.port = '';
      render();
      window.scrollTo(0, 0);
      return;
    }
    var portBtn = ev.target.closest('[data-port]');
    if (!portBtn) return;
    state.port = portBtn.getAttribute('data-port') || '';
    render();
  });

  document.body.addEventListener('change', function (ev) {
    var input = ev.target.closest('[data-note]');
    if (!input) return;
    api('/api/liman/note', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ irsaliye: input.getAttribute('data-note'), note: input.value }),
    }).then(function () {
      toast('Not kaydedildi');
    }).catch(function (err) { toast(err.message || 'Not kaydedilemedi'); });
  });

  window.addEventListener('gpm-presence', function (ev) {
    var el = $('chipPresence');
    if (el && window.SessionManager && typeof SessionManager.presenceChipHtml === 'function') {
      el.innerHTML = SessionManager.presenceChipHtml((ev.detail && ev.detail.list) || []);
    }
  });

  async function init() {
    // Bu sayfa oturum istemez: gözetmen ve liman görevlisi adresi açıp bakar.
    // Oturum varsa (amir) yalnız yetki/presence için kullanılır; yoksa salt okunur devam eder.
    if (window.SessionManager && typeof SessionManager.requireValidSession === 'function') {
      try { await SessionManager.requireValidSession(); } catch (e) { /* oturumsuz görünüm */ }
    }
    try {
      await guncelle();
    } catch (err) {
      try { await load(); } catch (err2) {
        setLive(false);
        $('list').innerHTML = '<p class="empty">' + esc(err2.message || 'Liste açılamadı') + '</p>';
      }
    }
    // Liman görevlisi telefondan bakıyor: Güncelle'ye basmadan liste kendi tazelenir.
    setInterval(checkForChange, CHECK_MS);
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) checkForChange(true);
    });
    window.addEventListener('offline', function () { setLive(false); });
    window.addEventListener('online', function () { checkForChange(true); });
  }

  var CHECK_MS = 60 * 1000;          // kantar yeni liste gönderdi mi (hafif istek)
  var FULL_MS = 5 * 60 * 1000;       // çıkış (sarılmış) durumu için raporları yeniden çek
  var lastCheck = 0;
  var lastFull = 0;
  var checking = false;
  async function checkForChange(force) {
    if (checking || document.hidden) return;
    if (!force && Date.now() - lastCheck < 30000) return;
    var active = document.activeElement;
    if (active && active.matches && active.matches('[data-note]')) return;
    checking = true;
    lastCheck = Date.now();
    try {
      if (force || Date.now() - lastFull >= FULL_MS) {
        await guncelle();
        return;
      }
      var info = await api('/api/liman/version');
      if (info && info.v && info.v !== state.version) await load();
      setLive(true);
    } catch (e) {
      setLive(false);
    } finally {
      checking = false;
    }
  }

  init();
})();
