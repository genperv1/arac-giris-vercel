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
      var okAt = info && info.heartbeatReadOkAt;
      // Kantar Excel'i elle yükleyince değişen liste gelir ama nabız eski okuma hatasında kalabilir:
      // hatadan daha yeni değişmiş liste = Excel okunmuş.
      var listAt = info && info.updatedAt;
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

  /**
   * Yalnız amir: plakası verilip gelmeyen araçlar + daha plaka verilecek BBT (nakliye bekleyenler hesabı).
   * Takip formu basılan / İÇERİDE / DIŞARIDA / sarılmış araç gelmiş sayılır.
   */
  function gelmeyenBlocks() {
    var core = window.NakliyeBekleyenCore;
    var day = activeDay();
    if (!core || typeof core.analyzeBlock !== 'function' || !day) return [];
    var out = [];
    (day.blocks || []).forEach(function (block) {
      var items = (block.rows || []).map(function (row) {
        var durum = String(row.durum || '').trim();
        return Object.assign({}, row, {
          headerText: block.title || row.headerText || '',
          _nbInside: !!row._printedInside || /^İÇERİDE$/i.test(durum),
          disarida: /^DIŞARIDA$/i.test(durum),
        });
      });
      if (!items.length) return;
      var item = null;
      try { item = core.analyzeBlock(items); } catch (e) { item = null; }
      if (!item) return;
      var waiting = (item.waitingPlates || []).concat(item.ozmalPlates || []);
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
    var plates = 0;
    var bbt = 0;
    list.forEach(function (g) { plates += g.waiting.length; bbt += g.remaining; });
    var btn = '<button type="button" class="gelmeyen-btn' + (state.gelmeyenOpen ? ' is-open' : '') + '" data-gelmeyen-toggle>' +
      'Gelmeyen araçlar <span class="g-count' + (plates ? '' : ' is-zero') + '">' + plates + '</span></button>';
    wrap.innerHTML = btn + (state.gelmeyenOpen ? gelmeyenPanel(list, plates, bbt) : '');
  }

  function gelmeyenPanel(list, plates, bbt) {
    var top = '<div class="g-top"><span><b>' + plates + ' araç</b> bekleniyor' +
      (bbt > 0 ? ' · <b>' + esc(fmtTotal(bbt)) + ' BBT</b> plaka verilecek' : '') + '</span>' +
      '<button type="button" class="g-close" data-gelmeyen-toggle aria-label="Kapat">×</button></div>';
    if (!list.length) {
      return '<div class="gelmeyen">' + top + '<div class="g-empty">Gelmeyen araç yok · plaka verilecek BBT yok</div></div>';
    }
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
    return '<div class="gelmeyen">' + top + '<div class="g-list">' + body + '</div></div>';
  }

  function todayLabel() {
    var d = new Date();
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return p(d.getDate()) + '.' + p(d.getMonth() + 1) + '.' + d.getFullYear();
  }

  /** Kapatmadan önce amirin görmesi gerekenler: içeride kalan, irsaliyesi boş, gelmeyen araç. */
  function closeWarnings(day) {
    var inside = 0;
    var noIrs = 0;
    ((day && day.blocks) || []).forEach(function (block) {
      (block.rows || []).forEach(function (row) {
        var plaka = String(row.plaka || '').replace(/\s+/g, '');
        if (!plaka) return;
        if (row._printedInside || /^İÇERİDE$/i.test(String(row.durum || '').trim())) inside += 1;
        if (!String(row.irsaliye || row.irsaliyeNo || '').trim()) noIrs += 1;
      });
    });
    var waiting = 0;
    var remaining = 0;
    if (day && day.dateKey === state.day) {
      gelmeyenBlocks().forEach(function (g) { waiting += g.waiting.length; remaining += g.remaining; });
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
      'Listenin son hali arşive alınır; sayı kontrolde Excel yerine bu kullanılır.\n' +
      'Liman görevlisi bu listeyi artık görmeyecek. Sonraki günün listesi yüklüyse o gösterilir, yoksa liste boş kalır.';
    if (!window.confirm(msg)) return;
    if (btn) btn.disabled = true;
    try {
      applyView(await api('/api/liman/day/' + encodeURIComponent(dateKey) + '/close', { method: 'PUT' }));
      toast(label + ' listesi kapatıldı, arşive alındı');
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
      '<td colspan="4" class="left tot-extra">' + (extra || '') + '</td></tr>';
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
    $('list').innerHTML = '<div class="sheet">' + blocks.map(function (block) {
      var tasiyici = String(block.tasiyici || '').trim();
      var rowTasiyici = (block.rows || []).some(function (row) { return row.tasiyici; });
      var rows = (block.rows || []).map(function (row) {
        var plate = String(row.plaka || '').trim();
        var plateHtml = plate ? '<b>' + esc(plate) + '</b>' : '<span class="noplate">plaka yok</span>';
        if (rowDeparted(row)) plateHtml += '<div class="mark">sarılmış</div>';
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
          '<td class="durum c-durum' + (out ? ' is-out' : (/^İÇERİDE$/i.test(durum) ? ' is-inside' : '')) + '"' +
            (row._printedInside && row.cikisSaat ? ' title="Takip formu ' + esc(row.cikisSaat) + '"' : '') + ' data-fallback="' + (out ? 'SARILMIŞ' : 'BEKLİYOR') + '">' + esc(durum) + '</td>' +
          '<td class="c-min c-yer">' + esc(row.yukleme || row.yuklemeYeri || '') + '</td>' +
          '<td class="left c-sofor">' + esc(row.sofor || '') + '</td>' +
          '<td class="c-tel">' + telCell(row.telefon) + '</td>' +
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
          (rowTasiyici ? '<th class="c-tas"></th>' : '') +
        '</tr></thead><tbody>' + rows + '</tbody>' + totalsFoot(block, block.rows || [], state.canEdit && !state.plate) + '</table></section>';
    }).join('') + '</div>';
  }

  function render() {
    renderAdmin();
    renderGelmeyen();
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
        // Takip formu basıldı = araç kantarda (İÇERİDE). SARILMIŞ yalnız Excel'e giden tonaj girilince.
        var faced = attachFaces(marked, state.reports).map(function (row, i) {
          if (!row || !row._nbLiveDeparted) return row;
          var inside = Object.assign({}, row, {
            gidenTonaj: flat[i].gidenTonaj,
            giden: flat[i].giden,
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
    if (ev.target.closest('[data-gelmeyen-toggle]')) {
      state.gelmeyenOpen = !state.gelmeyenOpen;
      renderGelmeyen();
      return;
    }
    if (state.gelmeyenOpen && !ev.target.closest('#gelmeyenWrap')) {
      state.gelmeyenOpen = false;
      renderGelmeyen();
    }
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
      var printed = info && info.p != null && state.printMark != null && info.p !== state.printMark;
      if (info && info.p != null) state.printMark = info.p;
      if (printed) {
        await guncelle();
        return;
      }
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
