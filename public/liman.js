(function () {
  'use strict';

  var state = { days: [], closedDays: [], canEdit: false, canClose: false, day: '', file: '', port: '', plate: '', reports: null };
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

  function freshUrl(path) {
    var join = path.indexOf('?') >= 0 ? '&' : '?';
    return path + join + '_=' + Date.now();
  }

  async function api(path, options) {
    var res = await fetch(freshUrl(path), Object.assign({ credentials: 'same-origin', cache: 'no-store' }, options || {}));
    var data = await res.json().catch(function () { return {}; });
    if (!res.ok) throw new Error(data.error || 'İstek olmadı');
    return data;
  }

  var viewGeneration = 0;

  function applyView(data, gen) {
    if (gen != null && gen !== viewGeneration) return;
    state.days = data.days || [];
    state.version = data.version || '';
    if (data.sheet) state.sheetStamp = data.sheet;
    if (data.h) state.heartStamp = data.h;
    state.canEdit = !!data.canEdit;
    state.canClose = !!data.canClose;
    state.sites = data.sites || {};
    state.closedDays = Array.isArray(data.closedDays) ? data.closedDays : [];
    if (Array.isArray(data.archive)) state.archive = data.archive;
    state.events = Array.isArray(data.events) ? data.events : [];
    state.fileOrder = data.fileOrder && typeof data.fileOrder === 'object' ? data.fileOrder : {};
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
    var gen = ++viewGeneration;
    applyView(await api('/api/liman'), gen);
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
      var okAt = info && info.heartbeatReadOkAt;
      // Kantar Excel'i okuyunca liste gönderir (içerik aynı olsa da) ama nabız eski okuma hatasında kalabilir:
      // hatadan daha yeni gelen liste = Excel okunmuş.
      var listAt = info && (info.receivedAt || info.updatedAt);
      var ts = function (iso) { return iso ? new Date(iso).getTime() || 0 : 0; };
      if (listAt && ts(listAt) > ts(at) && ts(listAt) > ts(okAt)) {
        readOk = true;
        okAt = listAt;
      }
      var seenAt = ts(listAt) > ts(at) ? listAt : at;
      var cls = 'xs-none';
      var text;
      if (!seenAt || readOk === null || readOk === undefined) {
        text = 'Excel okuma bilgisi yok';
      } else if (Date.now() - ts(seenAt) > 25 * 60 * 1000) {
        text = 'kantar sayfası kapalı · son okuma ' + hm(okAt || seenAt);
      } else if (readOk) {
        cls = 'xs-ok';
        text = 'Excel okundu ' + hm(okAt || seenAt);
      } else {
        cls = 'xs-bad';
        text = (READ_REASON[info.heartbeatReadReason] || 'Excel okunamıyor') +
          (okAt ? ' · son başarılı ' + hm(okAt) : '');
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

    // Sevkiyat bitince listeyi yalnız Selahattin Toker kapatır: arşive gider, limanda bir daha açılmaz.
    var day = activeDay();
    var closeRow = '';
    if (state.canClose && day) {
      closeRow = '<span class="close-day-text">Sevkiyat bitti mi?</span>' +
        '<button type="button" class="btn btn-close-day" data-close-day="' + esc(day.dateKey) + '">' + esc(day.label) + ' listesini kapat</button>' +
        '<button type="button" class="btn btn-delete-day" data-delete-day="' + esc(day.dateKey) + '">Sil</button>';
    }
    var archiveRow = '';
    if (state.canClose) {
      var files = state.archive || [];
      var open = state.archiveOpen === true;
      var items = files.map(function (c) {
        var when = c.closedAt ? new Date(c.closedAt).toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
        return '<div class="archive-file">' +
          '<span class="archive-file-ico" aria-hidden="true"></span>' +
          '<span class="archive-file-name"><b>' + esc(c.label || c.dateKey) + '</b>' +
            '<small>' + (c.rowCount || 0) + ' satır' + (when ? ' · ' + esc(when) : '') + (c.closedBy ? ' · ' + esc(c.closedBy) : '') + (c.recovered ? ' · kantar baskısından' : '') + '</small></span>' +
          '<button type="button" class="chip chip-restore" data-restore-archive="' + esc(c.dateKey) + '">Geri al</button>' +
          '<button type="button" class="chip chip-excel" data-excel-archive="' + esc(c.dateKey) + '">Excel</button>' +
          '<button type="button" class="chip chip-delete" data-delete-archive="' + esc(c.dateKey) + '">Sil</button>' +
          '</div>';
      }).join('');
      archiveRow = '<button type="button" class="archive-folder-btn' + (open ? ' is-open' : '') + '" data-archive-toggle>' +
        '<span class="archive-folder-ico" aria-hidden="true"></span> Arşiv <span class="archive-count">' + files.length + '</span></button>' +
        (open ? '<div class="archive-files">' + (items || '<div class="archive-empty">Kapatılan listeler bu klasöre gelir.</div>') + '</div>' : '');
    }
    if (closeRow || archiveRow) {
      html += '<div class="known admin-days">' +
        (closeRow ? '<div class="close-day-row">' + closeRow + '</div>' : '') +
        (archiveRow ? '<div class="archive-row">' + archiveRow + '</div>' : '') +
        '</div>';
    }
    box.innerHTML = html;
  }

  /**
   * Yalnız amir: plakası verilip gelmeyen araçlar + daha plaka verilecek BBT (nakliye bekleyenler hesabı).
   * Takip formu basılan / İÇERİDE / DIŞARIDA / sarıldı araç gelmiş sayılır; özmal olsa da gelmeyen listesine girmez.
   */
  function gelmeyenBlocks(blocks) {
    var core = window.NakliyeBekleyenCore;
    if (!blocks) {
      var day = activeDay();
      blocks = day ? fileBlocks(day) : [];
    }
    if (!core || typeof core.analyzeBlock !== 'function') return [];
    var out = [];
    (blocks || []).forEach(function (block) {
      var items = (block.rows || []).map(function (row) {
        if (typeof core.limanRowForGelmeyen === 'function') {
          return core.limanRowForGelmeyen(row, block.title || (row && row.headerText) || '');
        }
        var durum = String(row.durum || '').trim();
        return Object.assign({}, row, {
          headerText: block.title || row.headerText || '',
          gidenTonaj: row.gidenTonaj || row.giden || '',
          _nbInside: !!row._printedInside || /^İÇERİDE$/i.test(durum),
          disarida: /^DIŞARIDA$/i.test(durum),
        });
      });
      if (!items.length) return;
      var item = null;
      try { item = core.analyzeBlock(items); } catch (e) { item = null; }
      if (!item) return;
      var waiting = typeof core.limanGelmeyenPlates === 'function'
        ? core.limanGelmeyenPlates(item)
        : (item.waitingPlates || []).concat(item.ozmalPlates || []).filter(function (p) {
            return p && !p.isInside && !p.isOutside;
          });
      var remaining = Number(item.remainingBbt) || 0;
      if (!waiting.length && remaining <= 0) return;
      out.push({ block: block, item: item, waiting: waiting, remaining: remaining });
    });
    return out;
  }

  /** Başlıktaki düğme; basınca gelmeyenler paneli açılır (yalnız amir). */
  function renderGelmeyen() {
    var wrap = $('gelmeyenWrap');
    if (!wrap) return;
    if (!state.canEdit) {
      wrap.innerHTML = '';
      return;
    }
    var list = gelmeyenBlocks();
    var sum = gelmeyenSum(list);
    var btn = '<button type="button" class="gelmeyen-btn' + (state.gelmeyenOpen ? ' is-open' : '') + '" data-gelmeyen-toggle>' +
      'Gelmeyen araçlar <span class="g-count' + (sum.plates ? '' : ' is-zero') + '">' + sum.plates + '</span></button>';
    var panel = '';
    if (state.gelmeyenOpen) {
      var groups = state.gelmeyenAll
        ? printTabs().map(function (t) { return { label: t.label, list: gelmeyenBlocks(t.blocks) }; })
        : [{ label: currentTabLabel(), list: list }];
      panel = gelmeyenPanel(groups);
    }
    wrap.innerHTML = btn + panel;
  }

  function currentTabLabel() {
    var day = activeDay();
    return state.file || (day ? day.label : '');
  }

  function gelmeyenSum(list) {
    var out = { plates: 0, bbt: 0 };
    list.forEach(function (g) { out.plates += g.waiting.length; out.bbt += g.remaining; });
    return out;
  }

  function gelmeyenPanel(groups) {
    var total = { plates: 0, bbt: 0 };
    groups.forEach(function (gr) {
      var s = gelmeyenSum(gr.list);
      total.plates += s.plates;
      total.bbt += s.bbt;
    });
    var scope = state.gelmeyenAll ? 'Tüm listeler' : esc(groups[0] ? groups[0].label : '');
    var top = '<div class="g-top"><span>' + (scope ? '<span class="g-scope">' + scope + '</span> · ' : '') +
      '<b>' + total.plates + ' araç</b> bekleniyor' +
      (total.bbt > 0 ? ' · <b>' + esc(fmtTotal(total.bbt)) + ' BBT</b> plaka verilecek' : '') + '</span>' +
      '<button type="button" class="g-close" data-gelmeyen-toggle aria-label="Kapat">×</button></div>';
    var body;
    if (!total.plates && total.bbt <= 0) {
      body = '<div class="g-empty">Gelmeyen araç yok · plaka verilecek BBT yok</div>';
    } else if (state.gelmeyenAll) {
      body = groups.filter(function (gr) { return gr.list.length; }).map(function (gr) {
        var s = gelmeyenSum(gr.list);
        return '<div class="g-tab">' + esc(gr.label) + ' · ' + s.plates + ' araç' +
          (s.bbt > 0 ? ' · ' + esc(fmtTotal(s.bbt)) + ' BBT' : '') + '</div>' + gelmeyenList(gr.list);
      }).join('');
    } else {
      body = gelmeyenList(groups[0] ? groups[0].list : []);
    }
    var foot = '<button type="button" class="g-all" data-gelmeyen-all>' +
      (state.gelmeyenAll ? 'Yalnız bu sayfayı göster' : 'Tüm listeleri toplu göster') + '</button>';
    return '<div class="gelmeyen">' + top + body + foot + '</div>';
  }

  function gelmeyenList(list) {
    var body = list.map(function (g) {
      var head = [
        g.item.ydKey,
        g.item.lotLabel,
        g.item.malzemeLabel,
        g.block.liman || g.block.port || '',
      ].filter(Boolean).join(' · ');
      var rows = g.waiting.map(function (p) {
        return '<li><b>' + esc(p.plaka) + '</b>' +
          (p.bbt ? ' <span class="g-bbt">' + esc(p.bbt) + ' BBT</span>' : '') +
          (p.tasiyici ? ' <span class="tas-box' + (/^GPM$/i.test(p.tasiyici) ? ' is-gpm' : '') + '">' + esc(p.tasiyici) + '</span>' : '') +
          '</li>';
      }).join('');
      return '<div class="g-blok">' +
        '<div class="g-head">' + esc(head) + '</div>' +
        (rows ? '<ul class="g-plates">' + rows + '</ul>' : '') +
        (g.remaining > 0 ? '<div class="g-rem">Plaka verilecek: <b>' + esc(fmtTotal(g.remaining)) + ' BBT</b></div>' : '') +
        '</div>';
    }).join('');
    return '<div class="g-list">' + body + '</div>';
  }

  function todayLabel() {
    var d = new Date();
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return p(d.getDate()) + '.' + p(d.getMonth() + 1) + '.' + d.getFullYear();
  }

  function todayKey() {
    var d = new Date();
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  /** Liman dolum tarihi bugünse bu, günün listesidir. */
  function tabIsToday(tab) {
    var key = todayKey();
    var re = /(\d{2})\.(\d{2})\.(\d{4})/g;
    var text = tabDolumText(tab);
    var m;
    while ((m = re.exec(text))) {
      if (m[3] + '-' + m[2] + '-' + m[1] === key) return true;
    }
    return false;
  }

  /** Kapatmadan önce amirin görmesi gerekenler: içeride kalan, irsaliyesi boş, gelmeyen araç. */
  function closeWarnings(day) {
    var inside = 0;
    var noIrs = 0;
    ((day && day.blocks) || []).forEach(function (block) {
      (block.rows || []).forEach(function (row) {
        var plaka = String(row.plaka || '').replace(/\s+/g, '');
        if (!plaka) return;
        if (!rowDeparted(row) && (row._printedInside || /^İÇERİDE$/i.test(String(row.durum || '').trim()))) inside += 1;
        if (!String(row.irsaliye || row.irsaliyeNo || '').trim()) noIrs += 1;
      });
    });
    var waiting = 0;
    var remaining = 0;
    if (day && day.dateKey === state.day) {
      gelmeyenBlocks(day.blocks || []).forEach(function (g) { waiting += g.waiting.length; remaining += g.remaining; });
    }
    var out = [];
    if (inside) out.push('• ' + inside + ' araç hâlâ İÇERİDE');
    if (noIrs) out.push('• ' + noIrs + ' araçta irsaliye no boş');
    if (waiting) out.push('• ' + waiting + ' araç gelmedi');
    if (remaining > 0) out.push('• ' + fmtTotal(remaining) + ' BBT için daha plaka verilmedi');
    return out;
  }

  async function closeDay(dateKey, btn) {
    var day = state.days.filter(function (d) { return d.dateKey === dateKey; })[0];
    var label = day ? day.label : dateKey;
    var warnings = closeWarnings(day);
    var msg = label + ' listesi kapatılsın mı?\n\n' +
      (warnings.length ? 'DİKKAT:\n' + warnings.join('\n') + '\n\n' : 'Kontrol: içeride / irsaliyesiz / gelmeyen araç yok.\n\n') +
      'Liste kapanır ve Arşiv\'e gider. Liman tarafında bir daha açılmaz.\n' +
      'Sayı kontrol bu arşiv kopyasını kullanır.';
    if (!window.confirm(msg)) return;
    if (btn) btn.disabled = true;
    var gen = ++viewGeneration;
    try {
      applyView(await api('/api/liman/day/' + encodeURIComponent(dateKey) + '/close', { method: 'PUT' }), gen);
      toast(label + ' listesi kapatıldı, Arşiv\'e alındı');
    } catch (err) {
      if (btn) btn.disabled = false;
      toast(err.message || 'Liste kapatılamadı');
    }
  }

  async function deleteDay(dateKey, btn) {
    var day = state.days.filter(function (d) { return d.dateKey === dateKey; })[0];
    var label = day ? day.label : dateKey;
    if (!window.confirm(label + ' listesi silinsin mi?\n\nArşive gitmez. Liman tarafında da görünmez, kantar tekrar gönderse de açılmaz.')) return;
    if (btn) btn.disabled = true;
    var gen = ++viewGeneration;
    try {
      applyView(await api('/api/liman/day/' + encodeURIComponent(dateKey), { method: 'DELETE' }), gen);
      toast(label + ' listesi silindi');
    } catch (err) {
      if (btn) btn.disabled = false;
      toast(err.message || 'Liste silinemedi');
    }
  }

  async function restoreArchive(dateKey, btn) {
    var item = (state.archive || []).filter(function (d) { return d.dateKey === dateKey; })[0];
    var label = item ? (item.label || dateKey) : dateKey;
    if (!window.confirm(label + ' listesi arşivden limana geri alınsın mı?\n\nKlasördeki kopya durur. Liman tarafı bu listeyi tekrar görür.')) return;
    if (btn) btn.disabled = true;
    var gen = ++viewGeneration;
    try {
      applyView(await api('/api/liman/archive/' + encodeURIComponent(dateKey) + '/restore', { method: 'POST' }), gen);
      state.day = dateKey;
      render();
      toast(label + ' listesi limana geri alındı');
    } catch (err) {
      if (btn) btn.disabled = false;
      toast(err.message || 'Liste geri alınamadı');
    }
  }

  async function downloadArchiveExcel(dateKey, btn) {
    var item = (state.archive || []).filter(function (d) { return d.dateKey === dateKey; })[0];
    var label = item ? (item.label || dateKey) : dateKey;
    if (btn) btn.disabled = true;
    try {
      if (!window.LimanXlsx || !window.LimanXlsx.buildArchiveWorkbook) throw new Error('Excel oluşturucu yüklenmedi');
      var data = await api('/api/liman/archive/' + encodeURIComponent(dateKey));
      var bytes = window.LimanXlsx.buildArchiveWorkbook(data.day || {});
      var blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      var link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = label + '.xlsx';
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(function () { URL.revokeObjectURL(link.href); }, 1000);
      toast(label + ' Excel indirildi');
    } catch (err) {
      toast(err.message || 'Excel indirilemedi');
    }
    if (btn) btn.disabled = false;
  }

  async function deleteArchive(dateKey, btn) {
    var item = (state.archive || []).filter(function (d) { return d.dateKey === dateKey; })[0];
    var label = item ? (item.label || dateKey) : dateKey;
    if (!window.confirm(label + ' arşivden silinsin mi?\n\nGeri gelmez. Liman listesine de dönmez.')) return;
    if (btn) btn.disabled = true;
    var gen = ++viewGeneration;
    try {
      applyView(await api('/api/liman/archive/' + encodeURIComponent(dateKey), { method: 'DELETE' }), gen);
      toast(label + ' arşivden silindi');
    } catch (err) {
      if (btn) btn.disabled = false;
      toast(err.message || 'Arşiv silinemedi');
    }
  }

  function activeDay() {
    return state.days.filter(function (d) { return d.dateKey === state.day; })[0] || null;
  }

  /** Günün Excel dosyaları (aynı tarihli 2. dosya, ör. "03.10.2026-YD28"); tarihi yalnız olan önce. */
  function filesOf(day) {
    var seen = [];
    ((day && day.blocks) || []).forEach(function (block) {
      (block.files || []).forEach(function (f) {
        if (f && seen.indexOf(f) < 0) seen.push(f);
      });
    });
    return seen.sort(function (a, b) { return a.length - b.length || a.localeCompare(b, 'tr'); });
  }

  /** Seçili dosya sekmesindeki bloklar; dosya bilgisi olmayan (eski kantar) blok her sekmede görünür. */
  function fileBlocks(day) {
    var blocks = (day && day.blocks) || [];
    if (!state.file) return blocks;
    return blocks.filter(function (block) {
      var files = block.files || [];
      return !files.length || files.indexOf(state.file) >= 0;
    });
  }

  function portsOf(day) {
    var seen = [];
    fileBlocks(day).forEach(function (block) {
      var port = block.liman || block.port || '';
      if (port && seen.indexOf(port) < 0) seen.push(port);
    });
    return seen;
  }

  function limanGidenKg(raw) {
    var s = String(raw || '').trim();
    if (!s || /^(İÇERİDE|ICERIDE|DIŞARIDA|DISARIDA)$/i.test(s)) return 0;
    if (/^\d{1,3}(\.\d{3})+$/.test(s)) return parseInt(s.replace(/\./g, ''), 10) || 0;
    if (/^\d{1,3}(\.\d{3})+,\d+$/.test(s)) {
      var grouped = parseFloat(s.replace(/\./g, '').replace(',', '.'));
      return isFinite(grouped) ? grouped : 0;
    }
    var n = parseFloat(s.replace(',', '.'));
    if (!isFinite(n) || n <= 0) return 0;
    if (n >= 8 && n < 80 && n !== Math.floor(n)) return Math.round(n * 1000);
    return n;
  }

  function rowDeparted(row) {
    if (!row) return false;
    // Baskı işareti çıkış sayılmaz. Excel giden tonajı doluysa araç çıkmıştır.
    return limanGidenKg(row.gidenTonaj || row.giden) >= 1000;
  }

  function blockProgress(block) {
    var rows = block.rows || [];
    var done = rows.filter(rowDeparted).length;
    return { done: done, total: rows.length, complete: rows.length > 0 && done === rows.length };
  }

  function tabBlocks(tab) {
    var day = state.days.filter(function (d) { return d.dateKey === tab.dateKey; })[0];
    if (!day) return [];
    return (day.blocks || []).filter(function (block) {
      var files = block.files || [];
      return !tab.file || !files.length || files.indexOf(tab.file) >= 0;
    });
  }

  /** Sekmedeki her sevkiyat bloğunda bütün araçlar çıktıysa liste bitmiştir. */
  function tabShipmentsDone(tab) {
    var blocks = tabBlocks(tab);
    return blocks.length > 0 && blocks.every(function (block) { return blockProgress(block).complete; });
  }

  var TR_DAYS = ['PAZAR', 'PAZARTESİ', 'SALI', 'ÇARŞAMBA', 'PERŞEMBE', 'CUMA', 'CUMARTESİ'];

  /** Liste gününün ertesi: 06.10.2026 → 07.10.2026 ÇARŞAMBA. */
  function nextDayLabel(dateKey) {
    var m = String(dateKey || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return '';
    var dt = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    if (isNaN(dt.getTime())) return '';
    dt.setDate(dt.getDate() + 1);
    var dd = ('0' + dt.getDate()).slice(-2);
    var mo = ('0' + (dt.getMonth() + 1)).slice(-2);
    return dd + '.' + mo + '.' + dt.getFullYear() + ' ' + TR_DAYS[dt.getDay()];
  }

  /** Excel'de liman dolum varsa o, yoksa listenin bir gün sonrası. */
  function blockDolumLabel(block, dateKey) {
    if (String(block && block.dolum || '').trim()) return printDolum(block);
    return nextDayLabel(dateKey);
  }

  /** Her listenin sekmesinde liman dolum. Aynı günde birden fazla tarih varsa hepsi. */
  function tabDolumText(tab) {
    var seen = [];
    tabBlocks(tab).forEach(function (block) {
      var d = blockDolumLabel(block, tab.dateKey);
      if (d && seen.indexOf(d) < 0) seen.push(d);
    });
    if (!seen.length) {
      var fallback = nextDayLabel(tab.dateKey);
      if (fallback) seen.push(fallback);
    }
    if (!seen.length) return '';
    return 'LİMAN DOLUM TARİHİ : ' + seen.join(' · ');
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

  function parseNum(value) {
    var s = String(value == null ? '' : value).replace(/\s/g, '');
    if (!s) return 0;
    if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(',', '.');
    var n = Number(s);
    return isFinite(n) ? n : 0;
  }

  function fmtTotal(n) {
    return n.toLocaleString('tr-TR', { maximumFractionDigits: 3 });
  }

  var TOTAL_FIELDS = ['bbt', 'cuval', 'palet', 'bosBbt', 'bosCuval', 'net', 'giden'];
  var KALAN_FIELDS = ['bbt', 'cuval', 'palet', 'bosBbt', 'bosCuval'];

  function blockTotals(rows) {
    var toplam = {};
    var kalan = {};
    TOTAL_FIELDS.forEach(function (key) { toplam[key] = 0; kalan[key] = 0; });
    rows.forEach(function (row) {
      var departed = rowDeparted(row);
      TOTAL_FIELDS.forEach(function (key) {
        var n = parseNum(key === 'giden' ? (row.giden || row.gidenTonaj) : row[key]);
        toplam[key] += n;
        if (!departed) kalan[key] += n;
      });
    });
    return { toplam: toplam, kalan: kalan };
  }

  var TOTAL_CLS = { bbt: 'c-bbt', cuval: 'c-nar', palet: 'c-nar', bosBbt: 'c-nar', bosCuval: 'c-nar', net: 'c-ton', giden: 'c-ton' };
  var EXCEL_KEY = { net: 'netTonaj', giden: 'gidenTonaj' };

  function excelTotal(excel, key) {
    if (!excel) return '';
    var raw = excel[EXCEL_KEY[key] || key];
    return raw == null ? '' : String(raw).trim();
  }

  /**
   * Excel'deki TOPLAM / KALAN satırı varsa birebir gösterilir, yoksa sayfa hesaplar.
   * compare: yalnız amir görür — sayfanın hesabı Excel'den farklıysa hücre işaretlenir
   * (plaka araması açıkken satırların bir kısmı göründüğü için kapalı).
   */
  function totalsRow(label, cls, excel, calc, fields, compare, extra) {
    var cells = TOTAL_FIELDS.map(function (key) {
      var active = fields.indexOf(key) >= 0;
      var calcText = active ? fmtTotal(calc[key]) : '';
      if (!excel) return '<td class="' + TOTAL_CLS[key] + '">' + esc(calcText) + '</td>';
      var raw = excelTotal(excel, key);
      var text = raw ? fmtTotal(parseNum(raw)) : '';
      var diff = compare && active && Math.abs(parseNum(raw) - calc[key]) > 0.5;
      if (!diff) return '<td class="' + TOTAL_CLS[key] + '">' + esc(text) + '</td>';
      return '<td class="' + TOTAL_CLS[key] + ' tot-diff" title="Sayfa hesabı: ' + esc(calcText) + '">' +
        esc(text || '—') + '<small>hesap: ' + esc(calcText) + '</small></td>';
    }).join('');
    return '<tr class="tot ' + cls + '"><td colspan="2">' + label + '</td>' + cells +
      '<td colspan="5" class="left tot-extra">' + (extra || '') + '</td></tr>';
  }

  function totalsFoot(block, rows, compare) {
    var t = blockTotals(rows);
    var ex = block.toplam || null;
    var extra = '';
    if (ex) {
      var parts = [];
      if (ex.ogrTonaj) parts.push('BR. TONAJ: ' + fmtTotal(parseNum(ex.ogrTonaj)));
      if (ex.fark) parts.push('FARK: ' + fmtTotal(parseNum(ex.fark)));
      extra = esc(parts.join(' · '));
    }
    return '<tfoot>' +
      totalsRow('TOPLAM', 'tot-toplam', ex, t.toplam, TOTAL_FIELDS, compare, extra) +
      totalsRow('KALAN', 'tot-kalan', ex ? (block.kalan || {}) : null, t.kalan, KALAN_FIELDS, compare && !!block.kalan, '') +
      '</tfoot>';
  }

  /** Başlıktaki sipariş miktarı: "... / 162 TON / ... / 120 BBT / ..." */
  function orderOf(title) {
    var s = String(title || '');
    var bbt = s.match(/(\d+)\s*BBT\b/i);
    var ton = s.match(/(\d+(?:[.,]\d+)?)\s*TON\b/i);
    var parts = [];
    if (bbt) parts.push(bbt[1] + ' BBT');
    if (ton) parts.push(ton[1] + ' TON');
    return parts.join(' · ');
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
    return fileBlocks(day).filter(function (block) {
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
    var dayFiles = filesOf(day);
    if (state.file && (dayFiles.length < 2 || dayFiles.indexOf(state.file) < 0)) state.file = '';
    if (!state.file && dayFiles.length > 1) {
      state.file = dayFiles.slice().sort(function (a, b) { return (fileSeenAt(a) - fileSeenAt(b)) || 0; })[0];
    }
    var ports = portsOf(day);
    if (state.port && ports.indexOf(state.port) < 0) state.port = '';
    var html = '<button type="button" class="chip' + (!state.port ? ' is-on' : '') + '" data-port="">Hepsi</button>';
    ports.forEach(function (port) {
      html += '<button type="button" class="chip' + (state.port === port ? ' is-on' : '') + '" data-port="' + esc(port) + '">' + esc(port) + '</button>';
    });
    $('ports').innerHTML = html;
    $('sheetTabs').innerHTML = sheetTabs().map(function (t) {
      var on = t.dateKey === state.day && (!t.file || state.file === t.file);
      var done = tabShipmentsDone(t);
      var dolum = tabDolumText(t);
      var today = tabIsToday(t);
      return '<button type="button" class="tab' + (on ? ' is-on' : '') + (done ? ' is-done' : '') + (today ? ' is-today' : '') + '" data-day="' + esc(t.dateKey) + '"' +
        (t.file ? ' data-file="' + esc(t.file) + '"' : '') + '>' +
        (today ? '<span class="tab-star" aria-hidden="true">★</span>' : '') +
        (done ? '<span class="tab-done">tamamlandı</span>' : '') +
        (dolum ? '<span class="tab-dolum">' + esc(dolum) + '</span>' : '') +
        '<span class="tab-date">' + esc(t.label) + '</span></button>';
    }).join('');
  }

  function fileSeenAt(label) {
    var at = label && state.fileOrder ? Date.parse(state.fileOrder[label] || '') : NaN;
    return isFinite(at) ? at : Infinity;
  }

  /** Sekme etiketindeki gün: "03.10.2026-YD28" → 2026-10-03. Tarihi olmayan en sonda. */
  function tabDateKey(label) {
    var m = String(label || '').match(/(\d{2})\.(\d{2})\.(\d{4})/);
    return m ? (m[3] + '-' + m[2] + '-' + m[1]) : '9999-99-99';
  }

  /**
   * Alt sekmeler soldan sağa: yeni yükleme ilk liste, eski yükleme sağda.
   * Aynı günde son yüklenen solda, ilk yüklenen sağda kalır.
   */
  function sheetTabs() {
    var tabs = [];
    state.days.forEach(function (d, di) {
      var files = filesOf(d);
      if (files.length < 2) {
        tabs.push({ dateKey: d.dateKey, file: '', label: d.label, at: fileSeenAt(files[0]), day: tabDateKey(d.label), idx: tabs.length, di: di });
        return;
      }
      files.forEach(function (f) {
        tabs.push({ dateKey: d.dateKey, file: f, label: f, at: fileSeenAt(f), day: tabDateKey(f), idx: tabs.length, di: di });
      });
    });
    return tabs.sort(function (a, b) {
      if (a.day !== b.day) return a.day > b.day ? -1 : 1;
      if (a.at !== b.at) return a.at > b.at ? -1 : 1;
      return b.idx - a.idx;
    });
  }

  function plateKeyOf(raw) {
    return String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  }

  /**
   * Aynı gün aynı plaka birden fazla blokta (farklı malzeme) → çift malzemeli araç.
   * Liman filtresi / plaka araması açıkken de tüm günün bloklarına bakılır.
   */
  function multiMaterialIndex() {
    var day = activeDay();
    var map = {};
    ((day && day.blocks) || []).forEach(function (block, bi) {
      (block.rows || []).forEach(function (row) {
        var key = plateKeyOf(row.plaka);
        if (!key) return;
        var blocksOf = map[key] = map[key] || [];
        if (blocksOf.indexOf(bi) < 0) blocksOf.push(bi);
      });
    });
    var out = {};
    Object.keys(map).forEach(function (key) {
      if (map[key].length > 1) out[key] = true;
    });
    return out;
  }

  function renderList() {
    var blocks = visibleBlocks();
    var multi = multiMaterialIndex();
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
    var day = activeDay();
    var dayKey = (day || {}).dateKey || '';
    var showingToday = sheetTabs().some(function (t) {
      return tabIsToday(t) && t.dateKey === dayKey && (!t.file || !state.file || state.file === t.file);
    });
    $('list').innerHTML = '<div class="sheet' + (showingToday ? ' is-today' : '') + '">' + blocks.map(function (block) {
      // Taşıyıcı (AKYÜZ, GPM…) yalnız amire görünür
      var tasiyici = state.canEdit ? String(block.tasiyici || '').trim() : '';
      var rowTasiyici = state.canEdit && (block.rows || []).some(function (row) { return row.tasiyici; });
      var rows = (block.rows || []).map(function (row) {
        var plate = String(row.plaka || '').trim();
        var plateHtml = plate ? '<b>' + esc(plate) + '</b>' : '<span class="noplate">plaka yok</span>';
        if (rowDeparted(row)) plateHtml += '<div class="mark">sarıldı</div>';
        var tasCell = '';
        if (rowTasiyici) {
          var tas = String(row.tasiyici || '').trim();
          tasCell = '<td class="c-tas">' + (tas
            ? '<span class="tas-box' + (/^GPM$/i.test(tas) ? ' is-gpm' : '') + '">' + esc(tas) + '</span>'
            : '') + '</td>';
        }
        var note = row.note ? '<span class="rownote">' + esc(row.note) + '</span>' : '';
        var editor = '';
        if (state.canEdit && row.irsaliyeNo) {
          editor = '<span class="rownote"><input data-note="' + esc(row.irsaliyeNo) + '" value="' + esc(row.note || '') + '" placeholder="Not" /></span>';
        }
        var out = rowDeparted(row);
        // Çıkmış araçta Excel'in eski "İÇERİDE / DIŞARIDA" notu gösterilmez; durum tek: SARILDI
        var durum = out ? 'SARILDI' : String(row.durum || '').trim();
        // Telefon görünümü için kısa özet (masaüstünde gizli)
        var cikis = String(row.kantarCikis || '').trim();
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
          '<td class="durum c-durum' + (out ? ' is-out' : (/^İÇERİDE$/i.test(durum) ? ' is-inside' : '')) + '"' +
            (row._printedInside && row.cikisSaat ? ' title="Takip formu ' + esc(row.cikisSaat) + '"' : '') + ' data-fallback="' + (out ? 'SARILDI' : 'BEKLİYOR') + '">' + esc(durum) + '</td>' +
          '<td class="c-min c-yer">' + esc(row.yukleme || row.yuklemeYeri || '') + '</td>' +
          '<td class="left c-sofor">' + esc(row.sofor || '') + '</td>' +
          '<td class="c-tel">' + telCell(row.telefon) + '</td>' +
          '<td class="c-cikis">' + esc(cikis) + '</td>' +
          tasCell +
          '<td class="c-sum">' + sum + '</td>' +
          '</tr>';
      }).join('');
      var noteLine = block.note ? '<p class="note-line">' + esc(block.note) + '</p>' : '';
      var multiPlates = [];
      (block.rows || []).forEach(function (row) {
        var p = String(row.plaka || '').trim();
        if (p && multi[plateKeyOf(p)] && multiPlates.indexOf(p) < 0) multiPlates.push(p);
      });
      if (multiPlates.length) {
        noteLine += '<p class="multi-line">⚠ ÇİFT MALZEMELİ ARAÇ: ' + esc(multiPlates.join(', ')) +
          ' — aynı araç başka malzeme bloğunda da var, yüklemeyi iki malzeme için kontrol edin.</p>';
      }
      var progress = blockProgress(block);
      var order = orderOf(block.title);
      var orderText = order ? ' · Sipariş: ' + esc(order) : '';
      var statusLine = progress.complete
        ? '<p class="done-line"><i>✔</i> SEVKİYAT TAMAMLANDI · ' + progress.total + ' / ' + progress.total + ' araç çıktı' + orderText + '</p>'
        : '<p class="progress-line">' + progress.done + ' / ' + progress.total + ' araç çıktı' + orderText + '</p>';
      return '<section class="blok' + (progress.complete ? ' is-done' : '') + '">' +
        '<div class="blok-head">' +
          '<h2 class="blok-title' + (tasiyici ? ' has-tasiyici' : '') + '">' +
            (tasiyici ? '<span class="blok-tasiyici">' + esc(tasiyici) + '</span><span>' + esc(block.title || '') + '</span>' : esc(block.title || '')) +
            '</h2>' +
          '<table class="meta"><tbody>' +
            '<tr><th>LİMAN</th><td>' + esc(block.liman || block.port || '') + '</td></tr>' +
            '<tr><th>GEMİ DETAYI</th><td>' + esc(block.gemi || '') + '</td></tr>' +
            '<tr><th>BOOKING</th><td>' + esc(block.booking || '') + '</td></tr>' +
            '<tr><th>LİMAN DOLUM</th><td>' + esc(blockDolumLabel(block, dayKey)) + '</td></tr>' +
          '</tbody></table>' +
        '</div>' +
        statusLine +
        noteLine +
        '<table class="grid"><thead><tr>' +
          '<th class="c-sira"></th><th class="c-plaka">PLAKA</th><th class="c-bbt">BBT</th>' +
          '<th class="c-nar">ÇUVAL</th><th class="c-nar">PALET</th><th class="c-nar">BOŞ<br>BBT</th><th class="c-nar">BOŞ<br>ÇUVAL</th>' +
          '<th class="c-ton">NET</th><th class="c-ton">GİDEN</th><th class="c-durum">DURUM</th><th class="c-yer">YÜKLEME<br>YERİ</th>' +
          '<th class="c-sofor">ŞOFÖR</th><th class="c-tel">TELEFON</th><th class="c-cikis">ÇIKIŞ</th>' +
          (rowTasiyici ? '<th class="c-tas"></th>' : '') +
        '</tr></thead><tbody>' + rows + '</tbody>' + totalsFoot(block, block.rows || [], state.canEdit && !state.plate) + '</table></section>';
    }).join('') + '</div>';
  }

  /** Alttaki sekmelerle aynı sıra: gün tek dosyaysa gün, birden fazlaysa her dosya ayrı sekme. */
  function printTabs() {
    var byKey = {};
    state.days.forEach(function (d) { byKey[d.dateKey] = d; });
    return sheetTabs().map(function (t) {
      var d = byKey[t.dateKey] || {};
      return {
        label: t.label,
        blocks: (d.blocks || []).filter(function (block) {
          var bf = block.files || [];
          return !t.file || !bf.length || bf.indexOf(t.file) >= 0;
        }),
      };
    }).filter(function (t) { return t.blocks.length; });
  }

  var PRINT_CSS =
    '@page { size: A4 landscape; margin: 5mm; }' +
    '* { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }' +
    'html, body { margin: 0; padding: 0; background: #fff; }' +
    'body { font-family: Arial, Calibri, "Segoe UI", sans-serif; color: #000; }' +
    '.page { width: 1088px; height: 752px; overflow: hidden; page-break-after: always; break-after: page; }' +
    '.page:last-child { page-break-after: auto; break-after: auto; }' +
    '.fit { width: 1088px; }' +
    '.xb { border: 1.5px solid #000; margin: 0 0 8px; background: #fff; break-inside: avoid; page-break-inside: avoid; }' +
    '.xb:last-child { margin-bottom: 0; }' +
    '.xh { display: flex; align-items: stretch; border-bottom: 1.5px solid #000; }' +
    '.xcarrier { background: #92d050; color: #000; font-weight: 800; font-size: 8pt; display: flex; align-items: center; justify-content: center; text-align: center; padding: 2px 4px; min-width: 42px; max-width: 62px; border-right: 1.5px solid #000; line-height: 1.1; }' +
    '.xmid { flex: 1; min-width: 0; padding: 3px 6px 4px; }' +
    '.xtitle { font-weight: 800; font-size: 8.5pt; line-height: 1.25; }' +
    '.xsip { font-weight: 700; font-size: 8pt; color: #9b1c1c; -webkit-text-fill-color: #9b1c1c; margin-top: 2px; }' +
    '.xdolum { margin-top: 3px; background: #00b050; color: #fff; -webkit-text-fill-color: #fff; font-weight: 800; font-size: 8.5pt; display: inline-block; padding: 1px 8px; }' +
    '.xside { border-collapse: collapse; height: 100%; }' +
    '.xside th { background: #92d050; border: 1px solid #000; border-top: 0; border-right: 0; font-size: 6.5pt; font-weight: 800; padding: 3px 4px; max-width: 86px; line-height: 1.15; vertical-align: middle; }' +
    'table.xgrid { width: 100%; border-collapse: collapse; table-layout: fixed; }' +
    'table.xgrid th, table.xgrid td { border: 1px solid #000; text-align: center; font-weight: 700; font-size: 7.5pt; padding: 2px 1px; line-height: 1.15; white-space: nowrap; }' +
    'table.xgrid th { background: #fff2cc; font-size: 6.4pt; }' +
    'td.ton { background: #f8cbad; }' +
    'td.yer, td.sof { color: #c00000; -webkit-text-fill-color: #c00000; font-weight: 800; }' +
    'td.sof { white-space: nowrap; font-size: 8pt; text-align: left; padding-left: 4px; }' +
    'td.tel { color: #1d4ed8; -webkit-text-fill-color: #1d4ed8; font-size: 6.5pt; }' +
    'td.plk { font-weight: 800; letter-spacing: .01em; }' +
    'td.irs, td.saat { font-size: 6.4pt; }' +
    'td.chk { padding: 1px; }' +
    '.box { display: inline-block; width: 12px; height: 12px; border: 1.5px solid #000; vertical-align: middle; }' +
    'tr.tot td { background: #ffff00; font-weight: 800; }' +
    'tr.kal td { background: #fff2cc; }' +
    'td.lab { text-align: left; padding-left: 4px; }' +
    '.xnote { font-size: 8pt; font-weight: 800; color: #9b1c1c; -webkit-text-fill-color: #9b1c1c; padding: 2px 4px; }' +
    'col.c-chk { width: 2.4%; } col.c-irs { width: 8.6%; } col.c-sira { width: 2.6%; } col.c-plk { width: 8%; }' +
    'col.c-q { width: 3.8%; } col.c-ton { width: 6.4%; }' +
    'col.c-yer { width: 6.2%; } col.c-sof { width: 16%; } col.c-tel { width: 9.2%; } col.c-saat { width: 10%; }';

  function printTon(value) {
    var s = String(value == null ? '' : value).trim();
    if (!s || s === '0' || s === '0.0' || s === '0,0' || s === '0.00') return '';
    var n = parseNum(s);
    if (!isFinite(n) || n === 0) return s;
    if (Math.abs(n) >= 1000) return n.toLocaleString('tr-TR', { maximumFractionDigits: 3 });
    return n.toFixed(3);
  }

  function printQty(value, keepZero) {
    var s = String(value == null ? '' : value).trim();
    if (!s) return keepZero ? '0' : '';
    var n = parseNum(s);
    if (n === 0) return keepZero ? '0' : '';
    if (Number.isInteger(n)) return String(n);
    return fmtTotal(n);
  }

  function printLot(block) {
    var lot = String(block.lot || '').trim();
    if (lot) return lot;
    var m = String(block.title || '').match(/LOT\s*NO\s*([^/]+)/i);
    return m ? m[1].trim() : '';
  }

  function printDolum(block) {
    var d = String(block.dolum || '').trim();
    if (!d) {
      var sevk = String(block.sevk || '').trim();
      if (/\d{1,2}[./]\d{1,2}[./]\d{2,4}/.test(sevk)) d = sevk;
    }
    if (!d) {
      var m = String(block.title || '').match(/L[İI]MAN\s*DOLUM\s*TAR[İI]H[İI]\s*[:.]?\s*([^/]+)/i);
      if (m) d = m[1].trim();
    }
    return d
      .replace(/^L[İI]MAN\s*DOLUM\s*TAR[İI]H[İI]\s*[:.]?\s*/i, '')
      .replace(/^(?:SEVK\.?\s*)?S?\.?\s*TAR[İI]H[İI]\s*[:.]?\s*/i, '')
      .trim();
  }

  function printSideHtml(block) {
    var lot = printLot(block);
    var cells = ['<th>YÜKLENEN LOT NO' + (lot ? ':<br>' + esc(lot) : '') + '</th>'];
    [block.booking, block.liman || block.port, block.gemi, block.tasiyici].forEach(function (v) {
      var s = String(v || '').trim();
      if (s) cells.push('<th>' + esc(s) + '</th>');
    });
    cells.push('<th>TEDARİKÇİYE<br>GÖNDERİLDİ Mİ?</th>');
    cells.push('<th>PERFORMANSA<br>İŞLENDİ Mİ?</th>');
    return '<table class="xside"><tr>' + cells.join('') + '</tr></table>';
  }

  function printDataRow(row) {
    return '<tr>' +
      '<td class="chk"><span class="box"></span></td>' +
      '<td class="irs">' + esc(row.irsaliye || row.irsaliyeNo || '') + '</td>' +
      '<td>' + esc(row.sira || '') + '</td>' +
      '<td class="plk">' + esc(String(row.plaka || '').trim()) + '</td>' +
      '<td>' + esc(printQty(row.bbt, false)) + '</td>' +
      '<td>' + esc(printQty(row.cuval, false)) + '</td>' +
      '<td>' + esc(printQty(row.palet, false)) + '</td>' +
      '<td>' + esc(printQty(row.bosBbt, false)) + '</td>' +
      '<td>' + esc(printQty(row.bosCuval, false)) + '</td>' +
      '<td class="ton">' + esc(printTon(row.net || row.netTonaj)) + '</td>' +
      '<td class="ton">' + esc(printTon(row.giden || row.gidenTonaj)) + '</td>' +
      '<td class="yer">' + esc(row.yukleme || row.yuklemeYeri || '') + '</td>' +
      '<td class="sof">' + esc(row.sofor || '') + '</td>' +
      '<td class="tel">' + esc(row.telefon || '') + '</td>' +
      '<td class="saat">' + esc(row.kantarCikis || '') + '</td>' +
      '</tr>';
  }

  function printMetric(kind, excelRaw, calc) {
    var has = excelRaw != null && String(excelRaw).trim() !== '';
    if (kind === 'ton') return printTon(has ? excelRaw : calc);
    if (has) return printQty(excelRaw, true);
    if (calc == null) return '';
    return printQty(calc, true);
  }

  function printFootRow(label, cls, excel, rows, kalan) {
    var calc = kalan ? blockTotals(rows).kalan : blockTotals(rows).toplam;
    var spec = [
      ['qty', 'bbt', excel && excel.bbt, calc.bbt],
      ['qty', 'cuval', excel && excel.cuval, calc.cuval],
      ['qty', 'palet', excel && excel.palet, calc.palet],
      ['qty', 'bosBbt', excel && excel.bosBbt, calc.bosBbt],
      ['qty', 'bosCuval', excel && excel.bosCuval, calc.bosCuval],
      ['ton', 'net', excel && excel.netTonaj, kalan ? null : calc.net],
      ['ton', 'giden', excel && excel.gidenTonaj, kalan ? null : calc.giden],
    ];
    var cells = spec.map(function (item) {
      var shown = printMetric(item[0], item[2], item[3]);
      var clsName = item[0] === 'ton' ? ' class="ton"' : '';
      return '<td' + clsName + '>' + esc(shown) + '</td>';
    }).join('');
    return '<tr class="' + cls + '"><td class="lab" colspan="4">' + label + '</td>' + cells + '<td colspan="4"></td></tr>';
  }

  function printBlockHtml(block, allBlocks) {
    var tasiyici = String(block.tasiyici || '').trim();
    var sip = String(block.sip || '').trim();
    var dolum = printDolum(block);
    var rows = block.rows || [];
    var counts = {};
    (allBlocks || [block]).forEach(function (b) {
      var seen = {};
      (b.rows || []).forEach(function (row) {
        var k = plateKeyOf(row.plaka);
        if (!k || seen[k]) return;
        seen[k] = true;
        counts[k] = (counts[k] || 0) + 1;
      });
    });
    var multi = [];
    rows.forEach(function (row) {
      var p = String(row.plaka || '').trim();
      var k = plateKeyOf(p);
      if (k && counts[k] > 1 && multi.indexOf(p) < 0) multi.push(p);
    });
    var note = String(block.note || '').trim();
    var extra = '';
    if (multi.length) extra += '<div class="xnote">ÇİFT MALZEMELİ ARAÇ: ' + esc(multi.join(', ')) + '</div>';
    if (note) extra += '<div class="xnote">MALZEME İLE İLGİLİ NOT: ' + esc(note) + '</div>';
    return '<section class="xb">' +
      '<div class="xh">' +
        (tasiyici ? '<div class="xcarrier">' + esc(tasiyici) + '</div>' : '') +
        '<div class="xmid">' +
          '<div class="xtitle">' + esc(block.title || '') + '</div>' +
          (sip ? '<div class="xsip">NETSİS SİPARİŞ NO : ' + esc(sip) + '</div>' : '') +
          (dolum ? '<div class="xdolum">LİMAN DOLUM TARİHİ : ' + esc(dolum) + '</div>' : '') +
        '</div>' +
        printSideHtml(block) +
      '</div>' +
      '<table class="xgrid"><colgroup>' +
        '<col class="c-chk"><col class="c-irs"><col class="c-sira"><col class="c-plk">' +
        '<col class="c-q"><col class="c-q"><col class="c-q"><col class="c-q"><col class="c-q">' +
        '<col class="c-ton"><col class="c-ton">' +
        '<col class="c-yer"><col class="c-sof"><col class="c-tel"><col class="c-saat">' +
      '</colgroup><thead><tr>' +
        '<th>✓</th><th>İRSALİYE</th><th>#</th><th>PLAKA</th><th>BBT</th><th>ÇUVAL</th><th>PALET</th><th>BOŞ<br>BBT</th><th>BOŞ<br>ÇUVAL</th>' +
        '<th>NET<br>TONAJ</th><th>GİDEN<br>TONAJ</th>' +
        '<th>YÜKLEME<br>YERİ</th><th>ŞOFÖR ADI<br>SOYADI</th><th>TELEFON</th><th>KANTAR<br>ÇIKIŞ</th>' +
      '</tr></thead><tbody>' +
      rows.map(printDataRow).join('') +
      '</tbody><tfoot>' +
      printFootRow('TOPLAM', 'tot', block.toplam, rows, false) +
      printFootRow('KALAN', 'kal', block.kalan, rows, true) +
      '</tfoot></table>' + extra + '</section>';
  }

  function printShell(title, body) {
    return '<!DOCTYPE html><html lang="tr"><head><meta charset="UTF-8"><title>' + esc(title) + '</title>' +
      '<style>' + PRINT_CSS + '</style></head><body>' + body + '</body></html>';
  }

  // A4 yatay, 5 mm kenar: yazdırılabilir alan yaklaşık 287 × 200 mm (96 dpi)
  var PAGE_W_PX = 1088;
  var PAGE_H_PX = 752;

  /** Alttaki sekmede seçili liste: A4 yatay, Excel düzeni. Sığan bloklar aynı sayfada, tek bloksa sayfayı doldurur. */
  async function printCurrent() {
    var day = activeDay();
    var blocks = (day ? fileBlocks(day) : []).filter(function (block) {
      return !state.port || (block.liman || block.port || '') === state.port;
    });
    if (!blocks.length) {
      toast('Yazdırılacak liste yok');
      return;
    }
    await printTab({ label: currentTabLabel() + (state.port ? ' · ' + state.port : ''), blocks: blocks });
  }

  function packPrintGroups(heights) {
    var pages = [];
    var i = 0;
    while (i < heights.length) {
      var group = [i];
      var used = heights[i];
      var j = i + 1;
      if (heights[i] <= PAGE_H_PX) {
        while (j < heights.length && used + heights[j] <= PAGE_H_PX) {
          group.push(j);
          used += heights[j];
          j++;
        }
      }
      pages.push(group);
      i = group[group.length - 1] + 1;
    }
    return pages;
  }

  function fitPrintPage(page) {
    var fit = page.querySelector('.fit');
    if (!fit) return;
    fit.style.zoom = '1';
    fit.style.width = PAGE_W_PX + 'px';
    var layoutH = fit.scrollHeight || 1;
    if (layoutH <= PAGE_H_PX) return;
    var zoom = PAGE_H_PX / layoutH;
    if (zoom < 0.22) zoom = 0.22;
    fit.style.zoom = String(Math.round(zoom * 1000) / 1000);
  }

  async function printTab(tab) {
    var blocks = tab.blocks || [];
    var oldTitle = document.title;
    var frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    frame.style.cssText = 'position:fixed;left:-12000px;top:0;width:' + (PAGE_W_PX + 24) + 'px;height:3200px;border:0;opacity:1;visibility:visible;';
    document.body.appendChild(frame);
    try {
      var doc = frame.contentWindow.document;
      var measureBody = '<div id="measure" style="width:' + PAGE_W_PX + 'px">' +
        blocks.map(function (block) { return printBlockHtml(block, blocks); }).join('') + '</div>';
      doc.open();
      doc.write(printShell(tab.label, measureBody));
      doc.close();
      await new Promise(function (r) { setTimeout(r, 80); });
      var nodes = doc.querySelectorAll('#measure .xb');
      var heights = [];
      nodes.forEach(function (el) {
        var style = frame.contentWindow.getComputedStyle(el);
        heights.push(el.offsetHeight + (parseFloat(style.marginBottom) || 0));
      });
      var groups = packPrintGroups(heights);
      var pages = groups.map(function (group) {
        return '<div class="page"><div class="fit">' + group.map(function (idx) {
          return printBlockHtml(blocks[idx], blocks);
        }).join('') + '</div></div>';
      }).join('');
      doc.open();
      doc.write(printShell('Liman ' + tab.label, pages));
      doc.close();
      await new Promise(function (r) { setTimeout(r, 80); });
      doc.querySelectorAll('.page').forEach(fitPrintPage);
      frame.style.height = (PAGE_H_PX * Math.max(groups.length, 1) + 40) + 'px';
      document.title = 'Liman ' + tab.label;
      await new Promise(function (r) { setTimeout(r, 60); });
      frame.contentWindow.focus();
      frame.contentWindow.print();
      await new Promise(function (r) { setTimeout(r, 400); });
    } finally {
      document.title = oldTitle;
      frame.remove();
    }
  }

  function render() {
    renderAdmin();
    renderPorts();
    renderGelmeyen();
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

  function mergeSitePulse(hb) {
    if (!hb || typeof hb !== 'object') return;
    Object.keys(hb).forEach(function (site) {
      state.sites[site] = Object.assign({}, state.sites[site] || {}, hb[site] || {});
    });
  }

  async function guncelle(opts) {
    var gen = ++viewGeneration;
    var pullDeparted = !opts || opts.departed !== false || !state.reports;
    if (pullDeparted) {
      var since = Date.now() - 3 * 24 * 60 * 60 * 1000;
      // Oturumsuz çıkış akışı (liman görevlisi giriş yapmaz). Baskı değişmediyse tekrar inmez.
      var res = await fetch(freshUrl('/api/liman/departed?since=' + since), { credentials: 'same-origin', cache: 'no-store' });
      if (gen !== viewGeneration) return;
      state.reports = res.ok ? await res.json() : (state.reports || []);
    }
    var data = await api('/api/liman');
    if (gen !== viewGeneration) return;
    applyView(data, gen);
    lastCheck = Date.now();
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
        // Takip formu basıldı = İÇERİDE (liman bunu görür). Excel'de giden doluysa SARILDI; baskı onu ezmez.
        var faced = attachFaces(marked, state.reports).map(function (row, i) {
          if (!row || !row._nbLiveDeparted) return row;
          var base = flat[i] || row;
          var baseDurum = String(base.durum || '').trim();
          if (/^DIŞARIDA$/i.test(baseDurum)) {
            var outside = Object.assign({}, row, {
              gidenTonaj: base.gidenTonaj,
              giden: base.giden,
              durum: 'DIŞARIDA',
            });
            delete outside._nbLiveDeparted;
            return outside;
          }
          if (rowDeparted(base)) {
            var departedDurum = (/^(İÇERİDE|DIŞARIDA)$/i.test(baseDurum)) ? '' : baseDurum;
            var departed = Object.assign({}, row, {
              gidenTonaj: base.gidenTonaj,
              giden: base.giden,
              durum: departedDurum,
            });
            delete departed._nbLiveDeparted;
            delete departed._printedInside;
            return departed;
          }
          var inside = Object.assign({}, row, {
            gidenTonaj: base.gidenTonaj,
            giden: base.giden,
            durum: 'İÇERİDE',
            _printedInside: true,
          });
          delete inside._nbLiveDeparted;
          return inside;
        });
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
    if (ev.target.closest('[data-gelmeyen-all]')) {
      state.gelmeyenAll = !state.gelmeyenAll;
      renderGelmeyen();
      return;
    }
    if (ev.target.closest('[data-gelmeyen-toggle]')) {
      state.gelmeyenOpen = !state.gelmeyenOpen;
      renderGelmeyen();
      return;
    }
    if (state.gelmeyenOpen && !ev.target.closest('#gelmeyenWrap')) {
      state.gelmeyenOpen = false;
      renderGelmeyen();
    }
    if (ev.target.closest('[data-print-current]')) {
      printCurrent();
      return;
    }
    var closeBtn = ev.target.closest('[data-close-day]');
    if (closeBtn) {
      closeDay(closeBtn.getAttribute('data-close-day') || '', closeBtn);
      return;
    }
    var deleteBtn = ev.target.closest('[data-delete-day]');
    if (deleteBtn) {
      deleteDay(deleteBtn.getAttribute('data-delete-day') || '', deleteBtn);
      return;
    }
    if (ev.target.closest('[data-archive-toggle]')) {
      state.archiveOpen = state.archiveOpen !== true;
      render();
      return;
    }
    var restoreBtn = ev.target.closest('[data-restore-archive]');
    if (restoreBtn) {
      restoreArchive(restoreBtn.getAttribute('data-restore-archive') || '', restoreBtn);
      return;
    }
    var excelBtn = ev.target.closest('[data-excel-archive]');
    if (excelBtn) {
      downloadArchiveExcel(excelBtn.getAttribute('data-excel-archive') || '', excelBtn);
      return;
    }
    var archiveDel = ev.target.closest('[data-delete-archive]');
    if (archiveDel) {
      deleteArchive(archiveDel.getAttribute('data-delete-archive') || '', archiveDel);
      return;
    }
    var dayBtn = ev.target.closest('[data-day]');
    if (dayBtn) {
      state.day = dayBtn.getAttribute('data-day') || '';
      state.file = dayBtn.getAttribute('data-file') || '';
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

  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape' && state.gelmeyenOpen) {
      state.gelmeyenOpen = false;
      renderGelmeyen();
    }
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
    // Giriş kapısı (gnp) açılmadan liste çekilmez. Oturum varsa yalnız yetki/presence için kullanılır.
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
    // Telefon kotası: hareket varken 30 sn, sakinse 2 dk, uzun süre durgunsa 5 dk.
    setInterval(checkForChange, CHECK_MS);
    setInterval(function () { renderExcelStatus(); }, 60 * 1000);
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) checkForChange(true);
    });
    window.addEventListener('pageshow', function (ev) {
      if (ev && ev.persisted) checkForChange(true);
    });
    window.addEventListener('offline', function () { setLive(false); });
    window.addEventListener('online', function () { checkForChange(true); });
  }

  var CHECK_MS = 30 * 1000;
  var POLL_QUIET_MS = 2 * 60 * 1000;
  var POLL_IDLE_MS = 5 * 60 * 1000;
  var lastCheck = 0;
  var lastListChangeAt = Date.now();
  var checking = false;
  function pollGap() {
    var quiet = Date.now() - lastListChangeAt;
    if (quiet > 60 * 60 * 1000) return POLL_IDLE_MS;
    if (quiet > 15 * 60 * 1000) return POLL_QUIET_MS;
    return CHECK_MS;
  }
  async function checkForChange(force) {
    if (checking) return;
    if (document.hidden) return;
    // Sekme aç-kapa da aynı süreyi delmesin. Son bakıştan erkense ağ yok.
    var wait = force ? CHECK_MS : pollGap();
    if (Date.now() - lastCheck < wait) return;
    var active = document.activeElement;
    if (active && active.matches && active.matches('[data-note]')) return;
    checking = true;
    lastCheck = Date.now();
    try {
      var info = await api('/api/liman/version');
      var printed = info && info.p != null && state.printMark != null && info.p !== state.printMark;
      var sheetChanged = info && info.s && state.sheetStamp && info.s !== state.sheetStamp;
      var versionChanged = info && info.v && state.version && info.v !== state.version;
      var heartChanged = info && info.h && state.heartStamp && info.h !== state.heartStamp;
      if (info && info.p != null) state.printMark = info.p;
      if (info && info.s && !state.sheetStamp) state.sheetStamp = info.s;
      if (info && info.h) state.heartStamp = info.h;
      if (printed || sheetChanged || versionChanged) {
        lastListChangeAt = Date.now();
        // Çıkış listesi (3 gün baskı) yalnız yeni takip formu basılınca iner. Tonaj güncellemesi onu tekrar çekmez.
        await guncelle({ departed: !!printed || !state.reports });
        return;
      }
      if (heartChanged && info.hb) {
        mergeSitePulse(info.hb);
        renderExcelStatus();
      }
      setLive(true);
      renderExcelStatus();
    } catch (e) {
      setLive(false);
    } finally {
      checking = false;
    }
  }

  var started = false;
  function start() {
    if (started) return;
    if (window.LimanGate && typeof window.LimanGate.isUnlocked === 'function' && !window.LimanGate.isUnlocked()) return;
    started = true;
    init();
  }

  window.LimanPage = { start: start };
  start();
})();
