(function () {
  'use strict';

  var state = { days: [], canEdit: false, day: '', port: '', plate: '', reports: null };
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
    state.admin = data.admin || null;
    if (!state.days.some(function (d) { return d.dateKey === state.day; })) {
      state.day = state.days[0] ? state.days[0].dateKey : '';
    }
    if (state.reports) applyMarks();
    render();
  }

  async function load() {
    applyView(await api('/api/liman'));
  }

  function renderAdmin() {
    var box = $('adminBox');
    if (!box) return;
    var admin = state.canEdit ? state.admin : null;
    if (!admin) {
      box.innerHTML = '';
      return;
    }
    var html = '';
    (admin.pending || []).forEach(function (p) {
      var when = p.at ? new Date(p.at).toLocaleString('tr-TR') : '';
      html += '<div class="pending">' +
        '<b>Tanınmayan bilgisayar liste gönderdi</b> · IP <code>' + esc(p.ip) + '</code> · ' +
        esc(p.fileName || 'dosya adı yok') + ' · ' + p.rowCount + ' satır · ' + esc(when) +
        (p.guess ? ' · tahmin: <b>' + esc(p.guess) + '</b>' : '') +
        '<span class="pending-actions">' +
          '<button type="button" class="btn-ok" data-approve="AVDAN" data-ip="' + esc(p.ip) + '">AVDAN olarak kabul et</button>' +
          '<button type="button" class="btn-ok" data-approve="1.OSB" data-ip="' + esc(p.ip) + '">1.OSB olarak kabul et</button>' +
          '<button type="button" class="btn-no" data-remove-ip="' + esc(p.ip) + '">Reddet</button>' +
        '</span></div>';
    });
    var ips = admin.ips || {};
    var known = Object.keys(ips).map(function (site) {
      var list = (ips[site] || []).map(function (ip) {
        return '<code>' + esc(ip) + '</code> <button type="button" class="x" data-remove-ip="' + esc(ip) + '" title="Kaldır">×</button>';
      }).join(' ');
      return '<span><b>' + esc(site) + ':</b> ' + (list || '<i>tanımlı değil</i>') + '</span>';
    }).join(' &nbsp; ');
    html += '<div class="known">Liste kabul edilen kantarlar → ' + known + '</div>';
    box.innerHTML = html;
  }

  function adminPost(path, body) {
    return api(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then(function (data) {
      applyView(data);
    });
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
      $('list').innerHTML = '<p class="empty">03.10.2026 listesi henüz yok.</p>';
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
        return '<tr class="' + (rowDeparted(row) ? 'is-out' : '') + '">' +
          '<td>' + esc(row.sira || '') + '</td>' +
          '<td class="left">' + plateHtml + note + editor + '</td>' +
          '<td>' + esc(numCell(row.bbt)) + '</td>' +
          '<td>' + esc(numCell(row.cuval)) + '</td>' +
          '<td>' + esc(numCell(row.palet)) + '</td>' +
          '<td>' + esc(numCell(row.bosBbt)) + '</td>' +
          '<td>' + esc(numCell(row.bosCuval)) + '</td>' +
          '<td>' + esc(numCell(row.net)) + '</td>' +
          '<td>' + esc(numCell(row.giden || row.gidenTonaj)) + '</td>' +
          '<td class="durum">' + esc(row.durum || '') + '</td>' +
          '<td>' + esc(row.yukleme || row.yuklemeYeri || '') + '</td>' +
          '<td class="left">' + esc(row.sofor || '') + '</td>' +
          '<td>' + esc(row.telefon || '') + '</td>' +
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
          '<th></th><th>PLAKA</th><th>BBT</th><th>ÇUVAL</th><th>PALET</th><th>BOŞ BBT</th><th>BOŞ ÇUVAL</th><th>NET</th><th>GİDEN</th><th>DURUM</th><th>YÜKLEME YERİ</th><th>ŞOFÖR</th><th>TELEFON</th>' +
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
    var res = await fetch('/api/reports?since=' + since, { credentials: 'same-origin' });
    state.reports = res.ok ? await res.json() : (state.reports || []);
    await load();
    toast('Liste ve sarılmış durum güncellendi');
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

  document.getElementById('refreshBtn').addEventListener('click', function () {
    guncelle().catch(function (err) { toast(err.message || 'Güncellenemedi'); });
  });

  document.getElementById('plate').addEventListener('input', function (ev) {
    state.plate = ev.target.value || '';
    renderList();
  });

  document.body.addEventListener('click', function (ev) {
    var approveBtn = ev.target.closest('[data-approve]');
    if (approveBtn) {
      adminPost('/api/liman/ip/approve', {
        ip: approveBtn.getAttribute('data-ip'),
        site: approveBtn.getAttribute('data-approve'),
      }).then(function () { toast('Kantar kaydedildi, liste işlendi'); })
        .catch(function (err) { toast(err.message || 'Kaydedilemedi'); });
      return;
    }
    var removeBtn = ev.target.closest('[data-remove-ip]');
    if (removeBtn) {
      adminPost('/api/liman/ip/remove', { ip: removeBtn.getAttribute('data-remove-ip') })
        .then(function () { toast('Kaldırıldı'); })
        .catch(function (err) { toast(err.message || 'Kaldırılamadı'); });
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

  async function init() {
    if (window.SessionManager && typeof SessionManager.requireValidSession === 'function') {
      var ok = await SessionManager.requireValidSession();
      if (!ok) {
        $('list').innerHTML = '<p class="empty">Oturum doğrulanamadı.</p>';
        return;
      }
    }
    try {
      await load();
    } catch (err) {
      $('list').innerHTML = '<p class="empty">' + esc(err.message || 'Liste açılamadı') + '</p>';
    }
    setInterval(checkForChange, 180000);
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) checkForChange();
    });
  }

  var lastCheck = 0;
  async function checkForChange() {
    if (document.hidden || Date.now() - lastCheck < 60000) return;
    var active = document.activeElement;
    if (active && active.matches && active.matches('[data-note]')) return;
    lastCheck = Date.now();
    try {
      var info = await api('/api/liman/version');
      if (info && info.v && info.v !== state.version) await load();
    } catch (e) {}
  }

  init();
})();
