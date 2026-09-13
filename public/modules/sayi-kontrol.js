// sayi-kontrol.js — Rapor ↔ Sevkiyat ve Güncel ↔ Sevkiyat sayı tutuyor mu?
(function (root) {
  'use strict';

  var KG_TOLERANCE = 50; // kg — küçük yuvarlama farkı

  function trimStr(value) {
    return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  }

  function foldTr(value) {
    return trimStr(value)
      .replace(/İ/g, 'i')
      .replace(/I/g, 'i')
      .toLowerCase()
      .replace(/\u0307/g, '')
      .replace(/ı/g, 'i')
      .replace(/ş/g, 's')
      .replace(/ğ/g, 'g')
      .replace(/ü/g, 'u')
      .replace(/ö/g, 'o')
      .replace(/ç/g, 'c');
  }

  function parseNum(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    var s = trimStr(value);
    if (!s) return NaN;
    // TR: 33.000 veya 33,000 veya 27.500
    if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) {
      s = s.replace(/\./g, '').replace(',', '.');
    } else if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) {
      s = s.replace(/,/g, '');
    } else {
      s = s.replace(/\s/g, '').replace(',', '.');
    }
    var n = Number(s);
    return Number.isFinite(n) ? n : NaN;
  }

  function headerKey(value) {
    return foldTr(value).replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  }

  function normalizeYd(text) {
    var m = String(text || '').match(/\bYD\s*(\d{1,4})\b/i);
    return m ? ('YD' + m[1]).toUpperCase() : '';
  }

  function normalizeLot(text) {
    var m = String(text || '').match(/LOT\s*(?:NO\s*)?([\d\s\-]+)/i);
    if (!m) {
      var digits = String(text || '').replace(/\D+/g, '');
      return digits.length >= 4 && digits.length <= 10 ? digits : '';
    }
    return String(m[1] || '').replace(/\D+/g, '');
  }

  function normalizeBooking(text) {
    var m = String(text || '').match(/BOOK[Iİ]NG\s*NO\s*[:\.]?\s*([A-Z0-9\-]+)/i);
    if (m) return m[1].toUpperCase();
    var bare = trimStr(text).toUpperCase();
    if (/^[A-Z]{2,6}\d{5,}$/.test(bare)) return bare;
    return '';
  }

  function normalizeSip(text) {
    return trimStr(text).toUpperCase().replace(/\s+/g, '');
  }

  function extractPlanBbtFromText(text) {
    var re = /(\d+)\s*BBT\b/gi;
    var max = 0;
    var m;
    while ((m = re.exec(String(text || '')))) {
      var n = parseInt(m[1], 10);
      if (Number.isFinite(n) && n > max) max = n;
    }
    return max > 0 ? max : 0;
  }

  function extractHeaderTon(text) {
    var m = String(text || '').match(/(\d+(?:[.,]\d+)?)\s*TON\b/i);
    if (!m) return 0;
    return parseNum(m[1]) || 0;
  }

  function matchKey(parts) {
    var yd = parts.yd || '';
    var lot = parts.lot || '';
    var booking = parts.booking || '';
    var sip = parts.sip || '';
    if (yd && booking) return yd + '|B:' + booking;
    if (yd && lot) return yd + '|L:' + lot;
    if (sip) return 'S:' + sip;
    if (yd) return yd;
    return '';
  }

  function rowText(row) {
    return (row || []).map(function (c) { return trimStr(c); }).join(' ');
  }

  function isPlakaHeaderRow(row) {
    var t = foldTr(rowText(row));
    if (t.indexOf('plaka') < 0) return false;
    return t.indexOf('bbt') >= 0 || t.indexOf('sirano') >= 0 || t.indexOf('sira') >= 0;
  }

  function isToplamRow(row) {
    var t = foldTr(rowText(row));
    if (t.indexOf('ara toplam') >= 0) return false;
    return /(^|\s)toplam(\s|$)/.test(t);
  }

  function isKalanRow(row) {
    return foldTr(rowText(row)).indexOf('kalan') >= 0;
  }

  function mapBlockCols(headerRow) {
    var map = {};
    (headerRow || []).forEach(function (cell, i) {
      var k = headerKey(cell);
      if (!k) return;
      if (k === 'plaka') map.plaka = i;
      else if (k === 'bbt') map.bbt = i;
      else if (k.indexOf('net_tonaj') === 0 || k === 'net_tonaj') map.netTonaj = i;
      else if (k.indexOf('giden') === 0) map.giden = i;
      else if (k === 'cuval' || k.indexOf('cuval') === 0) map.cuval = i;
      else if (k === 'palet') map.palet = i;
    });
    return map;
  }

  function pickAboveHeader(grid, headerIdx) {
    var best = '';
    var start = Math.max(0, headerIdx - 12);
    for (var r = start; r < headerIdx; r++) {
      var row = grid[r] || [];
      for (var c = 0; c < row.length; c++) {
        var s = trimStr(row[c]);
        if (!s || !/\bYD\d{1,4}/i.test(s)) continue;
        if (s.length > best.length) best = s;
      }
    }
    return best;
  }

  function cell(row, idx) {
    if (idx == null || idx < 0) return '';
    return row[idx];
  }

  /**
   * Sevkiyat takip Excel (YD blokları + PLAKA tablosu + TOPLAM).
   */
  function parseSevkiyatGrid(grid) {
    var rows = Array.isArray(grid) ? grid : [];
    var blocks = [];
    var i = 0;
    while (i < rows.length) {
      if (!isPlakaHeaderRow(rows[i])) {
        i += 1;
        continue;
      }
      var headerIdx = i;
      var cols = mapBlockCols(rows[headerIdx]);
      var headerText = pickAboveHeader(rows, headerIdx);
      var end = rows.length;
      var totals = null;
      for (var r = headerIdx + 1; r < rows.length; r++) {
        if (r > headerIdx + 1 && isPlakaHeaderRow(rows[r])) {
          end = r;
          break;
        }
        if (isToplamRow(rows[r])) {
          totals = {
            bbt: parseNum(cell(rows[r], cols.bbt)),
            netTonaj: parseNum(cell(rows[r], cols.netTonaj)),
            giden: parseNum(cell(rows[r], cols.giden)),
            cuval: parseNum(cell(rows[r], cols.cuval)),
            palet: parseNum(cell(rows[r], cols.palet))
          };
          end = r + 1;
          // KALAN satırını atla
          if (end < rows.length && isKalanRow(rows[end])) end += 1;
          break;
        }
        if (isKalanRow(rows[r])) {
          end = r;
          break;
        }
      }

      var yd = normalizeYd(headerText);
      var lot = normalizeLot(headerText);
      var booking = normalizeBooking(headerText);
      var planBbt = (totals && totals.bbt > 0) ? Math.round(totals.bbt) : extractPlanBbtFromText(headerText);
      var netKg = 0;
      if (totals && totals.netTonaj > 0) {
        // NET TONAJ bazen ton (270) bazen kg (270000) — 1000'den küçükse ton say
        netKg = totals.netTonaj < 1000 ? totals.netTonaj * 1000 : totals.netTonaj;
      }
      var headerTon = extractHeaderTon(headerText);
      var ton = netKg > 0 ? netKg / 1000 : headerTon;

      if (yd || planBbt > 0) {
        blocks.push({
          source: 'sevkiyat',
          headerRow: headerIdx,
          headerText: headerText,
          yd: yd,
          lot: lot,
          booking: booking,
          sip: '',
          bbt: planBbt,
          ton: ton,
          kg: netKg || (headerTon > 0 ? headerTon * 1000 : 0),
          key: matchKey({ yd: yd, lot: lot, booking: booking }),
          label: (yd || 'Blok') + (booking ? (' · ' + booking) : (lot ? (' · LOT ' + lot) : ''))
        });
      }
      i = Math.max(end, headerIdx + 1);
    }
    return { ok: blocks.length > 0, items: blocks, error: blocks.length ? '' : 'Sevkiyat bloğu bulunamadı (PLAKA / TOPLAM).' };
  }

  /**
   * Güncel liste satırları (PlanV4) → karşılaştırma item’ları.
   */
  function itemsFromGuncel(parsed) {
    var items = (parsed && parsed.items) || [];
    return items.filter(function (it) {
      return it && (it.bbt > 0 || it.tonaj > 0);
    }).map(function (it) {
      var yd = normalizeYd(it.musteri || '');
      var booking = normalizeBooking(it.booking || '') || normalizeBooking(it.ambalaj || '');
      var sip = normalizeSip(it.sipNo || '');
      return {
        source: 'guncel',
        yd: yd,
        lot: '',
        booking: booking,
        sip: sip,
        bbt: it.bbt || 0,
        ton: it.tonaj || it.mt || 0,
        kg: (it.tonaj || it.mt || 0) * 1000,
        kind: it.kind,
        calcKg: it.calcKg,
        unitKg: it.unitKg,
        key: matchKey({ yd: yd, booking: booking, sip: sip }),
        label: (it.musteri || yd || sip || 'Satır') + (sip ? (' · ' + sip) : '')
      };
    });
  }

  /**
   * F358 / düz rapor satırları (ExcelListCopy solveGrid satırları veya ham grid).
   */
  function itemsFromF358Rows(rows) {
    return (rows || []).filter(function (row) {
      return row && (row.musteri || row.sipNo);
    }).map(function (row) {
      var yd = normalizeYd(row.musteri || '');
      var booking = normalizeBooking(row.bookingNo || '');
      var sip = normalizeSip(row.sipNo || '');
      var lot = normalizeLot(row.musteriKodu || row.lotNo || '');
      var bbt = parseNum(row.bigbagCuval);
      var adet = parseNum(row.adet);
      // paketleme: bigbag büyük, adet BBT
      if (bbt > 0 && adet > 0 && bbt / adet >= 20) bbt = Math.round(adet);
      else if (!(bbt > 0) && adet > 0) bbt = Math.round(adet);
      else if (bbt > 0) bbt = Math.round(bbt);
      else bbt = 0;
      var mt = parseNum(row.mt);
      return {
        source: 'rapor',
        yd: yd,
        lot: lot,
        booking: booking,
        sip: sip,
        bbt: bbt,
        ton: mt > 0 ? mt : 0,
        kg: mt > 0 ? mt * 1000 : 0,
        key: matchKey({ yd: yd, lot: lot, booking: booking, sip: sip }),
        label: (row.musteri || yd || sip || 'Satır') + (sip ? (' · ' + sip) : '')
      };
    }).filter(function (it) { return it.bbt > 0 || it.ton > 0 || it.yd; });
  }

  /**
   * Esnek rapor: önce sevkiyat bloğu dene, yoksa Güncel, yoksa F358.
   */
  function parseRaporGrid(grid, helpers) {
    helpers = helpers || {};
    var asSevk = parseSevkiyatGrid(grid);
    if (asSevk.ok && asSevk.items.length) {
      return { ok: true, mode: 'sevkiyat-blocks', items: asSevk.items, error: '' };
    }
    if (helpers.PlanV4 && typeof helpers.PlanV4.parseGuncelGrid === 'function') {
      var g = helpers.PlanV4.parseGuncelGrid(grid);
      if (g && g.ok && g.items && g.items.length) {
        return { ok: true, mode: 'guncel', items: itemsFromGuncel(g), error: '' };
      }
    }
    if (helpers.ExcelListCopy && typeof helpers.ExcelListCopy.solveGrid === 'function') {
      var solved = helpers.ExcelListCopy.solveGrid(grid, { startSira: 1 });
      if (solved && solved.ok && solved.rows && solved.rows.length) {
        return { ok: true, mode: 'f358', items: itemsFromF358Rows(solved.rows), error: '' };
      }
    }
    return { ok: false, mode: '', items: [], error: 'Rapor formatı tanınmadı. Netsis Excel veya Güncel / F358 yükleyin.' };
  }

  function compareField(a, b, kind) {
    var left = Number(a);
    var right = Number(b);
    if (!Number.isFinite(left)) left = 0;
    if (!Number.isFinite(right)) right = 0;
    var delta = right - left;
    if (kind === 'bbt') {
      return {
        left: left,
        right: right,
        delta: delta,
        ok: Math.round(left) === Math.round(right)
      };
    }
    // ton / kg
    var tol = kind === 'ton' ? KG_TOLERANCE / 1000 : KG_TOLERANCE;
    return {
      left: left,
      right: right,
      delta: delta,
      ok: Math.abs(delta) <= tol
    };
  }

  function indexByKey(items) {
    var map = Object.create(null);
    (items || []).forEach(function (it) {
      var k = it.key || '';
      if (!k) {
        k = 'NOKEY:' + (it.label || Math.random());
      }
      if (!map[k]) map[k] = [];
      map[k].push(it);
    });
    return map;
  }

  function pickBestPair(leftList, rightList) {
    // Aynı key altında birden fazla varsa BBT yakın olanı eşle
    var used = {};
    var pairs = [];
    leftList.forEach(function (L) {
      var best = null;
      var bestScore = Infinity;
      rightList.forEach(function (R, idx) {
        if (used[idx]) return;
        var score = Math.abs((L.bbt || 0) - (R.bbt || 0));
        if (score < bestScore) {
          bestScore = score;
          best = { R: R, idx: idx };
        }
      });
      if (best) {
        used[best.idx] = true;
        pairs.push({ left: L, right: best.R });
      } else {
        pairs.push({ left: L, right: null });
      }
    });
    rightList.forEach(function (R, idx) {
      if (!used[idx]) pairs.push({ left: null, right: R });
    });
    return pairs;
  }

  function diffReports(leftItems, rightItems) {
    var L = indexByKey(leftItems);
    var R = indexByKey(rightItems);
    var keys = {};
    Object.keys(L).forEach(function (k) { keys[k] = true; });
    Object.keys(R).forEach(function (k) { keys[k] = true; });

    var rows = [];
    var okCount = 0;
    var badCount = 0;
    var onlyLeft = 0;
    var onlyRight = 0;

    Object.keys(keys).sort().forEach(function (k) {
      if (k.indexOf('NOKEY:') === 0) {
        // anahtarsızları ayrı bas
        (L[k] || []).forEach(function (it) {
          onlyLeft += 1;
          rows.push({
            key: k,
            label: it.label,
            status: 'only-left',
            bbt: compareField(it.bbt, NaN, 'bbt'),
            ton: compareField(it.ton, NaN, 'ton'),
            left: it,
            right: null
          });
        });
        (R[k] || []).forEach(function (it) {
          onlyRight += 1;
          rows.push({
            key: k,
            label: it.label,
            status: 'only-right',
            bbt: compareField(NaN, it.bbt, 'bbt'),
            ton: compareField(NaN, it.ton, 'ton'),
            left: null,
            right: it
          });
        });
        return;
      }

      var pairs = pickBestPair(L[k] || [], R[k] || []);
      pairs.forEach(function (p) {
        if (p.left && !p.right) {
          onlyLeft += 1;
          rows.push({
            key: k,
            label: p.left.label,
            status: 'only-left',
            bbt: compareField(p.left.bbt, NaN, 'bbt'),
            ton: compareField(p.left.ton, NaN, 'ton'),
            left: p.left,
            right: null
          });
          return;
        }
        if (!p.left && p.right) {
          onlyRight += 1;
          rows.push({
            key: k,
            label: p.right.label,
            status: 'only-right',
            bbt: compareField(NaN, p.right.bbt, 'bbt'),
            ton: compareField(NaN, p.right.ton, 'ton'),
            left: null,
            right: p.right
          });
          return;
        }
        var bbt = compareField(p.left.bbt, p.right.bbt, 'bbt');
        var ton = compareField(p.left.ton, p.right.ton, 'ton');
        var status = (bbt.ok && ton.ok) ? 'ok' : 'bad';
        if (status === 'ok') okCount += 1;
        else badCount += 1;
        rows.push({
          key: k,
          label: p.left.label || p.right.label,
          status: status,
          bbt: bbt,
          ton: ton,
          left: p.left,
          right: p.right
        });
      });
    });

    return {
      rows: rows,
      summary: {
        matchedOk: okCount,
        matchedBad: badCount,
        onlyLeft: onlyLeft,
        onlyRight: onlyRight,
        total: rows.length
      }
    };
  }

  function formatTon(n) {
    if (!(Number.isFinite(n))) return '—';
    var fixed = Number(n).toFixed(3).replace(/\.?0+$/, '');
    return fixed.replace('.', ',');
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  async function loadXlsx() {
    if (typeof root.ensureXlsxLoaded === 'function') {
      await root.ensureXlsxLoaded();
    } else if (typeof XLSX === 'undefined') {
      await new Promise(function (resolve, reject) {
        var s = document.createElement('script');
        s.src = '/vendor/xlsx.full.min.js';
        s.onload = function () { resolve(true); };
        s.onerror = function () {
          var s2 = document.createElement('script');
          s2.src = 'https://cdn.jsdelivr.net/npm/xlsx/dist/xlsx.full.min.js';
          s2.onload = function () { resolve(true); };
          s2.onerror = reject;
          document.head.appendChild(s2);
        };
        document.head.appendChild(s);
      });
    }
    if (typeof XLSX === 'undefined') throw new Error('Excel okuyucu yüklenemedi');
  }

  async function workbookFromFile(file) {
    await loadXlsx();
    var buf = await file.arrayBuffer();
    return XLSX.read(buf, { type: 'array', cellDates: false });
  }

  function firstSheetGrid(wb, preferNames) {
    var names = wb.SheetNames || [];
    var pick = names[0];
    (preferNames || []).forEach(function (want) {
      var hit = names.find(function (n) { return foldTr(n).indexOf(foldTr(want)) >= 0; });
      if (hit) pick = hit;
    });
    return {
      name: pick,
      grid: XLSX.utils.sheet_to_json(wb.Sheets[pick], { header: 1, defval: '', blankrows: false })
    };
  }

  function bindAppUi(opts) {
    opts = opts || {};
    var toast = typeof opts.toast === 'function' ? opts.toast : function () {};
    var mode = 'rapor'; // rapor | guncel
    var state = { left: null, right: null, diff: null };

    var tabs = document.getElementById('skTabs');
    var leftFile = document.getElementById('skLeftFile');
    var rightFile = document.getElementById('skRightFile');
    var leftName = document.getElementById('skLeftName');
    var rightName = document.getElementById('skRightName');
    var leftLabel = document.getElementById('skLeftLabel');
    var rightLabel = document.getElementById('skRightLabel');
    var statusEl = document.getElementById('skStatus');
    var summaryEl = document.getElementById('skSummary');
    var tableEl = document.getElementById('skTable');
    var runBtn = document.getElementById('skRunBtn');
    var homeBtn = document.getElementById('skHomeBtn');

    function setStatus(msg, isErr) {
      if (!statusEl) return;
      statusEl.textContent = msg || '';
      statusEl.className = 'sk-status' + (isErr ? ' is-err' : '');
    }

    function updateModeLabels() {
      if (mode === 'guncel') {
        if (leftLabel) leftLabel.textContent = '1) Güncel İhracat Listesi.xlsx';
        if (rightLabel) rightLabel.textContent = '2) Sevkiyat / ihracat Excel’in.xlsx';
      } else {
        if (leftLabel) leftLabel.textContent = '1) Netsis raporu.xlsx (veya F358 / Güncel)';
        if (rightLabel) rightLabel.textContent = '2) Sevkiyat Excel’in.xlsx (YD blokları)';
      }
    }

    function renderDiff() {
      if (!tableEl || !summaryEl) return;
      var d = state.diff;
      if (!d) {
        summaryEl.innerHTML = '';
        tableEl.innerHTML = '<p class="sk-empty">İki dosyayı yükle → Kontrol et.</p>';
        return;
      }
      var s = d.summary;
      summaryEl.innerHTML =
        '<span class="sk-pill sk-pill--ok">Tutuyor: ' + s.matchedOk + '</span>' +
        '<span class="sk-pill sk-pill--bad">Tutmuyor: ' + s.matchedBad + '</span>' +
        '<span class="sk-pill">Sadece solda: ' + s.onlyLeft + '</span>' +
        '<span class="sk-pill">Sadece sağda: ' + s.onlyRight + '</span>';

      var html = '<div class="sk-table-wrap"><table class="sk-table"><thead><tr>' +
        '<th>Durum</th><th>Satır</th><th>BBT (sol)</th><th>BBT (sağ)</th><th>Ton (sol)</th><th>Ton (sağ)</th>' +
        '</tr></thead><tbody>';
      d.rows.forEach(function (row) {
        var st = row.status === 'ok' ? 'ok' : (row.status === 'bad' ? 'bad' : 'miss');
        var stLabel = row.status === 'ok' ? 'TUTUYOR' : (row.status === 'bad' ? 'TUTMUYOR' : (row.status === 'only-left' ? 'SADECE SOL' : 'SADECE SAĞ'));
        html += '<tr class="sk-row sk-row--' + st + '">' +
          '<td><span class="sk-badge sk-badge--' + st + '">' + stLabel + '</span></td>' +
          '<td>' + escapeHtml(row.label) + '</td>' +
          '<td>' + (row.left ? Math.round(row.bbt.left) : '—') + '</td>' +
          '<td>' + (row.right ? Math.round(row.bbt.right) : '—') + '</td>' +
          '<td>' + (row.left ? formatTon(row.ton.left) : '—') + '</td>' +
          '<td>' + (row.right ? formatTon(row.ton.right) : '—') + '</td>' +
          '</tr>';
      });
      html += '</tbody></table></div>';
      tableEl.innerHTML = html;
    }

    async function loadLeft(file) {
      if (!file) return;
      if (leftName) leftName.textContent = file.name;
      var wb = await workbookFromFile(file);
      var sheet = firstSheetGrid(wb, mode === 'guncel' ? ['guncel'] : ['rapor', 'guncel']);
      var helpers = {
        PlanV4: root.PlanV4,
        ExcelListCopy: root.ExcelListCopy
      };
      var parsed;
      if (mode === 'guncel') {
        if (!root.PlanV4) throw new Error('PlanV4 yok');
        var g = root.PlanV4.parseGuncelGrid(sheet.grid);
        if (!g.ok) throw new Error(g.error || 'Güncel okunamadı');
        parsed = { ok: true, items: itemsFromGuncel(g), mode: 'guncel' };
      } else {
        parsed = parseRaporGrid(sheet.grid, helpers);
      }
      if (!parsed.ok) throw new Error(parsed.error || 'Sol dosya okunamadı');
      state.left = parsed;
      setStatus('Sol: ' + sheet.name + ' · ' + parsed.items.length + ' kalem (' + (parsed.mode || mode) + ')');
    }

    async function loadRight(file) {
      if (!file) return;
      if (rightName) rightName.textContent = file.name;
      var wb = await workbookFromFile(file);
      var sheet = firstSheetGrid(wb, ['sevkiyat', 'ihracat', 'takip']);
      var parsed = parseSevkiyatGrid(sheet.grid);
      if (!parsed.ok) {
        // belki güncel formatında operatör listesi
        if (root.PlanV4) {
          var g = root.PlanV4.parseGuncelGrid(sheet.grid);
          if (g.ok && g.items.length) {
            parsed = { ok: true, items: itemsFromGuncel(g), error: '' };
          }
        }
      }
      if (!parsed.ok) throw new Error(parsed.error || 'Sağ dosya okunamadı');
      state.right = parsed;
      setStatus((statusEl && statusEl.textContent ? statusEl.textContent + ' · ' : '') +
        'Sağ: ' + sheet.name + ' · ' + parsed.items.length + ' kalem');
    }

    function runCompare() {
      if (!state.left || !state.right) {
        setStatus('Önce iki dosyayı da yükle.', true);
        return;
      }
      state.diff = diffReports(state.left.items, state.right.items);
      renderDiff();
      var s = state.diff.summary;
      if (s.matchedBad === 0 && s.onlyLeft === 0 && s.onlyRight === 0) {
        setStatus('Tamam — sayılar tutuyor.');
        toast('Sayı kontrol: tutuyor.');
      } else {
        setStatus('Fark var — kırmızı satırlara bak (' + s.matchedBad + ' tutmuyor).', true);
        toast('Sayı kontrol: fark bulundu.', true);
      }
    }

    if (tabs) {
      tabs.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-sk-mode]');
        if (!btn) return;
        mode = btn.getAttribute('data-sk-mode') || 'rapor';
        tabs.querySelectorAll('[data-sk-mode]').forEach(function (b) {
          b.classList.toggle('is-active', b === btn);
        });
        state.left = null;
        state.right = null;
        state.diff = null;
        if (leftName) leftName.textContent = 'Dosya seçilmedi';
        if (rightName) rightName.textContent = 'Dosya seçilmedi';
        if (leftFile) leftFile.value = '';
        if (rightFile) rightFile.value = '';
        updateModeLabels();
        renderDiff();
        setStatus('Mod: ' + (mode === 'guncel' ? 'Güncel ↔ Sevkiyat' : 'Rapor ↔ Sevkiyat'));
      });
    }
    if (leftFile) {
      leftFile.addEventListener('change', function () {
        loadLeft(leftFile.files && leftFile.files[0]).catch(function (err) {
          setStatus(err.message || 'Sol okunamadı', true);
        });
      });
    }
    if (rightFile) {
      rightFile.addEventListener('change', function () {
        loadRight(rightFile.files && rightFile.files[0]).catch(function (err) {
          setStatus(err.message || 'Sağ okunamadı', true);
        });
      });
    }
    if (runBtn) runBtn.addEventListener('click', runCompare);
    if (homeBtn) {
      homeBtn.addEventListener('click', function () {
        if (root.SessionManager && root.SessionManager.navigateToHome) root.SessionManager.navigateToHome();
        else location.href = 'GIRIS.html';
      });
    }

    updateModeLabels();
    renderDiff();
  }

  var api = {
    KG_TOLERANCE: KG_TOLERANCE,
    parseNum: parseNum,
    normalizeYd: normalizeYd,
    normalizeLot: normalizeLot,
    normalizeBooking: normalizeBooking,
    matchKey: matchKey,
    parseSevkiyatGrid: parseSevkiyatGrid,
    parseRaporGrid: parseRaporGrid,
    itemsFromGuncel: itemsFromGuncel,
    itemsFromF358Rows: itemsFromF358Rows,
    compareField: compareField,
    diffReports: diffReports,
    formatTon: formatTon,
    bindAppUi: bindAppUi
  };

  if (typeof root !== 'undefined') root.SayiKontrol = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : typeof global !== 'undefined' ? global : this);
