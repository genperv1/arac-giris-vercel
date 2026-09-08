// excel-list-copy.js — F358 Netsis raporunu güncel ihracat listesine çevirir
(function (root) {
  'use strict';

  var TARGET_HEADERS = [
    'TEDARİKÇİ',
    'İŞ TAKİP',
    'SIRA',
    'NETSİS SİPARİŞ NO',
    'HAFTA',
    'GENPER ÇIKIŞ TARİHİ',
    'MÜŞTERİ',
    'MÜŞTERİ KODU',
    'NETSİS STOK KODU',
    'ÜRÜN',
    'MT',
    'AMBALAJ',
    'Bigbag/Çuval',
    'PALET',
    'ADET',
    'GİDECEĞİ LİMAN',
    'AÇIKLAMA',
    'SPEK',
    'SEKTÖR',
    'BOOKING NO',
    'GEMİ DETAYI',
    'LİMAN DOLUM TARİHİ',
    'SİPARİŞ TARİHİ'
  ];

  var HEADER_ALIASES = {
    KUTAHYA_CIKIS_TARIH: 'cikisTarih',
    LIMAN_DOL_TARIH: 'limanDolum',
    ICNAKLIYE_CARI_ISIM_TR: 'tedarikciRaw',
    TERMINAL_CARI_ISIM_TR: 'limanRaw',
    GEMI_ADI: 'gemi',
    BOOKINGNO: 'bookingNo',
    SIPNO: 'sipNo',
    AKTARIM: 'aktarim',
    MUSTERI: 'musteriRaw',
    LOTNO: 'lotNo',
    STOK_KODU: 'stokKodu',
    STOK_ADI: 'stokAdi',
    SEVKPLANMIK: 'sevkPlanMik',
    SIP_TOPLAM_MIKTAR: 'sipToplam',
    OLCU_BR1: 'olcuBr',
    AMBALAJ_ADI_TR: 'ambalajAdi',
    PAKET: 'paket',
    BB_ADET: 'bbAdet',
    CV_ADET: 'cvAdet',
    PALET_TR: 'paletTr',
    PALET_SAYISI: 'paletSayisi',
    SIP_TARIH: 'sipTarih',
    ETIKET_NOT: 'etiketNot',
    URETIM_NOT1_TR: 'uretimNot1'
  };

  function trimStr(value) {
    return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  }

  function foldTr(value) {
    return trimStr(value)
      .toLowerCase()
      .replace(/ı/g, 'i')
      .replace(/İ/g, 'i')
      .replace(/ş/g, 's')
      .replace(/ğ/g, 'g')
      .replace(/ü/g, 'u')
      .replace(/ö/g, 'o')
      .replace(/ç/g, 'c');
  }

  function headerKey(value) {
    return foldTr(value)
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '')
      .toUpperCase();
  }

  function toNumber(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    var s = trimStr(value).replace(/\s/g, '').replace(',', '.');
    if (!s) return 0;
    var n = Number(s);
    return Number.isFinite(n) ? n : 0;
  }

  function isEmptyish(value) {
    var s = foldTr(value);
    return !s || s === '-' || s === 'yok' || s === 'xxx';
  }

  function parseDateParts(value) {
    if (value instanceof Date && !isNaN(value.getTime())) {
      var useUtc = value.getUTCHours() === 0 && value.getUTCMinutes() === 0 && value.getUTCSeconds() === 0;
      if (useUtc) {
        return { y: value.getUTCFullYear(), m: value.getUTCMonth() + 1, d: value.getUTCDate() };
      }
      return { y: value.getFullYear(), m: value.getMonth() + 1, d: value.getDate() };
    }
    if (typeof value === 'number' && value > 20000 && value < 80000) {
      var utc = Date.UTC(1899, 11, 30) + Math.round(value * 86400000);
      var dt = new Date(utc);
      return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
    }
    var s = trimStr(value);
    var iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (iso) return { y: Number(iso[1]), m: Number(iso[2]), d: Number(iso[3]) };
    var tr = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})/);
    if (tr) return { y: Number(tr[3]), m: Number(tr[2]), d: Number(tr[1]) };
    return null;
  }

  var TR_MONTHS = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
  var TR_WEEKDAYS = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];

  function formatDateTr(value) {
    var p = parseDateParts(value);
    if (!p) return '';
    return String(p.d).padStart(2, '0') + '.' + String(p.m).padStart(2, '0') + '.' + p.y;
  }

  function formatDateCopyTr(value) {
    var p = parseDateParts(value);
    if (!p) return '';
    var month = TR_MONTHS[p.m - 1];
    if (!month) return '';
    var dt = new Date(Date.UTC(p.y, p.m - 1, p.d));
    var dayName = TR_WEEKDAYS[dt.getUTCDay()] || '';
    return p.d + ' ' + month + ' ' + p.y + ' ' + dayName;
  }

  function isoWeekFromParts(y, m, d) {
    var date = new Date(Date.UTC(y, m - 1, d));
    var dayNum = date.getUTCDay() || 7;
    date.setUTCDate(date.getUTCDate() + 4 - dayNum);
    var yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
    return Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
  }

  function formatHafta(value) {
    var p = parseDateParts(value);
    if (!p) return '';
    return isoWeekFromParts(p.y, p.m, p.d) + '.hafta';
  }

  function formatMt(sevkPlanMik, olcuBr, sipToplam) {
    var qty = toNumber(sevkPlanMik);
    var unit = foldTr(olcuBr);
    if (qty <= 0) {
      var fallback = toNumber(sipToplam);
      return fallback > 0 ? formatMtNumber(fallback) : '';
    }
    if (unit === 'kg' || qty >= 100) qty = qty / 1000;
    return formatMtNumber(qty);
  }

  function formatMtNumber(n) {
    if (!Number.isFinite(n) || n <= 0) return '';
    var rounded = Math.round(n * 1000) / 1000;
    if (Math.abs(rounded - Math.round(rounded)) < 0.0005) return String(Math.round(rounded));
    return String(rounded).replace('.', ',');
  }

  function shortenTedarikci(name) {
    var raw = trimStr(name);
    if (!raw) return '';
    var folded = foldTr(raw);
    if (folded.indexOf('akyuz') >= 0) return 'AKYÜZ';
    if (folded.indexOf('medlog') >= 0) return 'MEDLOG';
    return raw;
  }

  function displayQty(value) {
    if (value == null || value === '') return '';
    if (typeof value === 'number' && Number.isFinite(value)) {
      if (Math.abs(value - Math.round(value)) < 0.0005) return String(Math.round(value));
      return String(value).replace('.', ',');
    }
    return trimStr(value);
  }

  function formatMusteri(musteri, aktarim) {
    var code = trimStr(musteri).replace(/\s+/g, '');
    if (!code) return '';
    if (/\([MG]\)$/i.test(code)) return code.toUpperCase().replace(/\(m\)$/i, '(M)').replace(/\(g\)$/i, '(G)');
    var kind = foldTr(aktarim);
    var tag = '';
    if (kind === 'maden' || kind.indexOf('madencilik') >= 0) tag = '(M)';
    else if (kind === 'genper') tag = '(G)';
    return code.toUpperCase() + tag;
  }

  function formatLotNo(raw) {
    var s = trimStr(raw);
    if (!s) return '';
    var lot = s.match(/LOT\s*NO\s*(.+)$/i);
    if (lot) return 'LOT NO ' + trimStr(lot[1]);
    if (/^LOT\b/i.test(s)) return s.replace(/^LOT\s*/i, 'LOT ').replace(/^LOT\s+NO\s+/i, 'LOT NO ');
    return 'LOT NO ' + s;
  }

  function formatUrun(stokAdi) {
    var s = trimStr(stokAdi);
    if (!s) return '';
    var hp = s.match(/HAM\s*PERLIT\s*([\d.,]+)\s*-\s*([\d.,]+)/i);
    if (hp) {
      var a = hp[1].replace(/\./g, ',');
      var b = hp[2].replace(/\./g, ',');
      var extra = '';
      var gpm = s.match(/-\s*(615|340)\b/);
      if (gpm) extra = ' (GPM' + gpm[1] + ')';
      return 'HP ' + a + '-' + b + extra;
    }
    return s;
  }

  function formatAmbalaj(adi, paket) {
    var name = trimStr(adi);
    var pack = trimStr(paket);
    var kg = pack.match(/(\d+(?:[.,]\d+)?)\s*KG/i);
    if (kg && name) return trimStr('NET ' + kg[1].replace('.', ',') + ' KG ' + name);
    if (name && pack) return name + ' / ' + pack;
    return name || pack;
  }

  function formatPalet(value) {
    return isEmptyish(value) ? '' : trimStr(value);
  }

  function packageCounts(bbAdet, cvAdet, paletSayisi) {
    var bb = toNumber(bbAdet);
    var cv = toNumber(cvAdet);
    var paletN = toNumber(paletSayisi);
    var bags = '';
    var adet = '';
    if (cv > 0 && bb > 0) {
      bags = String(cv);
      adet = String(bb);
    } else if (cv > 0) {
      bags = String(cv);
      adet = paletN > 0 ? String(paletN) : '';
    } else if (bb > 0) {
      bags = String(bb);
      adet = paletN > 0 ? String(paletN) : '';
    } else if (paletN > 0) {
      adet = String(paletN);
    }
    return { bags: bags, adet: adet };
  }

  function shortenLiman(name) {
    var raw = trimStr(name);
    if (!raw) return '';
    var f = foldTr(raw);
    if (f.indexOf('safi') >= 0 || f.indexOf('derince') >= 0) return 'SAFİPORT';
    if (f.indexOf('gemport') >= 0 || f.indexOf('gemlik') >= 0) return 'GEMPORT';
    if (f.indexOf('dp world') >= 0 || f.indexOf('yarimca') >= 0) return 'DP WORLD';
    if (f.indexOf('yilport') >= 0) return 'YILPORT';
    if (f.indexOf('evyap') >= 0) return 'EVYAP';
    if (f.indexOf('rodaport') >= 0) return 'RODAPORT';
    if (f.indexOf('kumport') >= 0) return 'KUMPORT';
    if (f.indexOf('borusan') >= 0) return 'BORUSAN';
    return raw;
  }

  function cleanNote(value) {
    var s = String(value == null ? '' : value).replace(/\r\n/g, '\n').trim();
    if (!s) return '';
    s = s.replace(/(OZEL\s*ETIKET:\s*)+/gi, '');
    return s.replace(/[ \t]+/g, ' ').replace(/\n{2,}/g, '\n').trim();
  }

  function cellLooksLikeDate(value) {
    return !!parseDateParts(value);
  }

  function findHeaderRow(grid) {
    if (!Array.isArray(grid)) return -1;
    for (var i = 0; i < Math.min(grid.length, 12); i++) {
      var row = grid[i] || [];
      var keys = {};
      for (var c = 0; c < row.length; c++) {
        var k = headerKey(row[c]);
        if (k) keys[k] = true;
      }
      if ((keys.SIPNO || keys.MUSTERI) && (keys.STOK_KODU || keys.STOK_ADI || keys.AKTARIM)) {
        return i;
      }
    }
    return -1;
  }

  function buildColMap(headerRow) {
    var map = {};
    (headerRow || []).forEach(function (cell, idx) {
      var k = headerKey(cell);
      if (!k || map[k] != null) return;
      map[k] = idx;
    });
    return map;
  }

  function readMapped(row, colMap, key, extraLookahead) {
    var idx = colMap[key];
    if (idx == null) return '';
    var val = row[idx];
    if (trimStr(val) !== '' && val != null) return val;
    var look = extraLookahead || 0;
    for (var i = 1; i <= look; i++) {
      var next = row[idx + i];
      if (next != null && trimStr(next) !== '') return next;
    }
    return '';
  }

  function rowBannerText(row) {
    return (row || []).slice(0, 6).map(trimStr).filter(Boolean).join(' ');
  }

  function parseGroupBanner(row) {
    var text = rowBannerText(row);
    var year = text.match(/TESLIM[_\s]*YIL\s*:?\s*(\d{4})/i);
    if (year) return { type: 'year', year: year[1] };
    var week = text.match(/HAFTA\s*:?\s*(\d{1,2})/i);
    if (week) return { type: 'week', week: String(Number(week[1])) };
    return null;
  }

  function isGroupHeaderRow(row) {
    return !!parseGroupBanner(row);
  }

  function weekFromSource(src) {
    if (src && src.groupWeek) return String(src.groupWeek);
    var hafta = formatHafta(src && src.cikisTarih);
    var m = String(hafta || '').match(/(\d+)/);
    return m ? m[1] : '';
  }

  function groupTree(rows) {
    var years = [];
    var yearMap = {};
    (rows || []).forEach(function (row, idx) {
      var y = trimStr(row.groupYear) || '—';
      var w = trimStr(row.groupWeek) || weekFromSource(row) || '—';
      if (!yearMap[y]) {
        yearMap[y] = { year: y, weeks: [], _w: {} };
        years.push(yearMap[y]);
      }
      var yr = yearMap[y];
      if (!yr._w[w]) {
        yr._w[w] = { week: w, label: 'HAFTA: ' + w, indexes: [] };
        yr.weeks.push(yr._w[w]);
      }
      yr._w[w].indexes.push(idx);
    });
    years.forEach(function (yr) { delete yr._w; });
    return years;
  }

  function extractSourceRow(row, colMap) {
    var get = function (key, look) {
      return readMapped(row, colMap, key, look || 0);
    };
    var sipNo = trimStr(get('SIPNO'));
    var musteri = trimStr(get('MUSTERI'));
    if (!sipNo && !musteri) return null;
    if (isGroupHeaderRow(row)) return null;

    var cikis = get('KUTAHYA_CIKIS_TARIH', 3);
    if (!cellLooksLikeDate(cikis)) {
      for (var i = 0; i < Math.min(row.length, 4); i++) {
        if (cellLooksLikeDate(row[i])) { cikis = row[i]; break; }
      }
    }

    return {
      tedarikciRaw: get('ICNAKLIYE_CARI_ISIM_TR'),
      limanRaw: get('TERMINAL_CARI_ISIM_TR'),
      gemi: trimStr(get('GEMI_ADI')),
      bookingNo: trimStr(get('BOOKINGNO')),
      sipNo: sipNo,
      aktarim: trimStr(get('AKTARIM')),
      musteriRaw: musteri,
      lotNo: get('LOTNO'),
      stokKodu: trimStr(get('STOK_KODU')),
      stokAdi: get('STOK_ADI'),
      sevkPlanMik: get('SEVKPLANMIK'),
      sipToplam: get('SIP_TOPLAM_MIKTAR'),
      olcuBr: get('OLCU_BR1'),
      ambalajAdi: get('AMBALAJ_ADI_TR'),
      paket: get('PAKET'),
      bbAdet: get('BB_ADET'),
      cvAdet: get('CV_ADET'),
      paletTr: get('PALET_TR'),
      paletSayisi: get('PALET_SAYISI'),
      paletUrunSayisi: get('PALET_URUN_SAYISI'),
      pres: get('PRES'),
      strec: get('STREC'),
      paletOrtusu: get('PALET_ORTUSU'),
      serit: get('SERIT'),
      sipTarih: get('SIP_TARIH'),
      limanDolum: get('LIMAN_DOL_TARIH'),
      cikisTarih: cikis,
      etiketNot: get('ETIKET_NOT'),
      uretimNot1: get('URETIM_NOT1_TR'),
      groupYear: '',
      groupWeek: ''
    };
  }

  function mapSourceRow(src, sira) {
    var packs = packageCounts(src.bbAdet, src.cvAdet, src.paletSayisi);
    var groupWeek = weekFromSource(src);
    return {
      groupYear: trimStr(src.groupYear),
      groupWeek: groupWeek,
      tedarikci: shortenTedarikci(src.tedarikciRaw),
      sevkPlanMik: displayQty(src.sevkPlanMik),
      paket: trimStr(src.paket),
      bbAdet: displayQty(src.bbAdet),
      cvAdet: displayQty(src.cvAdet),
      paletTr: formatPalet(src.paletTr),
      paletSayisi: displayQty(src.paletSayisi),
      paletUrunSayisi: displayQty(src.paletUrunSayisi),
      pres: trimStr(src.pres),
      strec: trimStr(src.strec),
      paletOrtusu: trimStr(src.paletOrtusu),
      serit: trimStr(src.serit),
      isTakip: '',
      sira: sira == null ? '' : String(sira),
      sipNo: trimStr(src.sipNo),
      hafta: formatHafta(src.cikisTarih),
      cikisTarih: formatDateTr(src.cikisTarih),
      musteri: formatMusteri(src.musteriRaw, src.aktarim),
      musteriKodu: formatLotNo(src.lotNo),
      stokKodu: trimStr(src.stokKodu),
      urun: formatUrun(src.stokAdi),
      mt: formatMt(src.sevkPlanMik, src.olcuBr, src.sipToplam),
      ambalaj: formatAmbalaj(src.ambalajAdi, src.paket),
      bigbagCuval: packs.bags,
      palet: formatPalet(src.paletTr),
      adet: packs.adet,
      liman: shortenLiman(src.limanRaw),
      aciklama: cleanNote(src.etiketNot),
      spek: cleanNote(src.uretimNot1),
      sektor: '',
      bookingNo: isEmptyish(src.bookingNo) ? '' : trimStr(src.bookingNo),
      gemi: trimStr(src.gemi),
      limanDolum: formatDateTr(src.limanDolum),
      sipTarih: formatDateTr(src.sipTarih)
    };
  }

  function parseSourceGrid(grid) {
    var headerIdx = findHeaderRow(grid);
    if (headerIdx < 0) {
      return { ok: false, error: 'Kaynak Excel başlığı bulunamadı (SIPNO / MÜŞTERİ).', rows: [] };
    }
    var colMap = buildColMap(grid[headerIdx]);
    var rows = [];
    var currentYear = '';
    var currentWeek = '';
    for (var r = headerIdx + 1; r < grid.length; r++) {
      var raw = grid[r] || [];
      var banner = parseGroupBanner(raw);
      if (banner && banner.type === 'year') {
        currentYear = banner.year;
        continue;
      }
      if (banner && banner.type === 'week') {
        currentWeek = banner.week;
        continue;
      }
      var extracted = extractSourceRow(raw, colMap);
      if (!extracted) continue;
      extracted.groupYear = currentYear;
      extracted.groupWeek = currentWeek || weekFromSource(extracted);
      rows.push(extracted);
    }
    return { ok: true, rows: rows, headerIndex: headerIdx };
  }

  function assignSira(mappedRows, startSira) {
    var start = Math.max(1, parseInt(startSira, 10) || 1);
    return (mappedRows || []).map(function (row, i) {
      var copy = Object.assign({}, row);
      copy.sira = String(start + i);
      return copy;
    });
  }

  function solveGrid(grid, startSira) {
    var parsed = parseSourceGrid(grid);
    if (!parsed.ok) return parsed;
    var mapped = parsed.rows.map(function (src) { return mapSourceRow(src); });
    return {
      ok: true,
      rows: assignSira(mapped, startSira),
      sourceCount: parsed.rows.length
    };
  }

  function rowToCells(row) {
    return [
      row.tedarikci,
      row.isTakip,
      row.sira,
      row.sipNo,
      row.hafta,
      formatDateCopyTr(row.cikisTarih),
      row.musteri,
      row.musteriKodu,
      row.stokKodu,
      row.urun,
      row.mt,
      row.ambalaj,
      row.bigbagCuval,
      row.palet,
      row.adet,
      row.liman,
      row.aciklama,
      row.spek,
      row.sektor,
      row.bookingNo,
      row.gemi,
      formatDateCopyTr(row.limanDolum),
      formatDateCopyTr(row.sipTarih)
    ].map(function (cell) {
      return String(cell == null ? '' : cell).replace(/\t/g, ' ').replace(/\r?\n/g, ' ').trim();
    });
  }

  function rowsToTsv(rows, includeHeader) {
    var lines = [];
    if (includeHeader) lines.push(TARGET_HEADERS.join('\t'));
    (rows || []).forEach(function (row) {
      lines.push(rowToCells(row).join('\t'));
    });
    return lines.join('\r\n');
  }

  function workbookToGrid(wb) {
    if (!wb || !wb.SheetNames || !wb.SheetNames.length) return [];
    var XLSX = (typeof window !== 'undefined' && window.XLSX) || (typeof root !== 'undefined' && root.XLSX);
    if (!XLSX || !XLSX.utils) return [];
    var ws = wb.Sheets[wb.SheetNames[0]];
    if (!ws) return [];
    return XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', blankrows: false, raw: true });
  }

  async function copyText(text) {
    var value = String(text || '');
    if (!value) throw new Error('Kopyalanacak satır yok.');
    if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
    if (typeof document === 'undefined') return false;
    var ta = document.createElement('textarea');
    ta.value = value;
    ta.setAttribute('readonly', 'readonly');
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    ta.remove();
    if (!ok) throw new Error('Panoya kopyalanamadı.');
    return true;
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function defaultToast(msg, isErr) {
    if (typeof window !== 'undefined' && typeof window.showToast === 'function') {
      window.showToast(isErr ? ('⚠️ ' + msg) : msg);
      return;
    }
  }

  function bindAyarlarUi(opts) {
    return bindAppUi(opts);
  }

  function bindAppUi(opts) {
    if (typeof document === 'undefined') return;
    if (!document.getElementById('elcPage')) return;
    if (window.__elcAppBound) return;
    window.__elcAppBound = true;
    opts = opts || {};
    var toast = typeof opts.toast === 'function' ? opts.toast : defaultToast;

    var fileInput = document.getElementById('elcFile');
    var drop = document.getElementById('elcDrop');
    var solveBtn = document.getElementById('elcSolveBtn');
    var copyBtn = document.getElementById('elcCopyBtn');
    var selectAllBtn = document.getElementById('elcSelectAllBtn');
    var clearSelBtn = document.getElementById('elcClearSelBtn');
    var siraInput = document.getElementById('elcStartSira');
    var statusEl = document.getElementById('elcStatus');
    var fileNameEl = document.getElementById('elcFileName');
    var treeEl = document.getElementById('elcTree');
    var countEl = document.getElementById('elcCount');
    if (!solveBtn || !copyBtn || !treeEl) return;

    var state = {
      file: null,
      rows: [],
      selected: new Set()
    };

    function setStatus(text, isErr) {
      if (!statusEl) return;
      statusEl.textContent = text || '';
      statusEl.classList.toggle('is-error', !!isErr);
    }

    function selectedRows() {
      var start = siraInput ? siraInput.value : 1;
      var picked = state.rows.filter(function (_row, idx) { return state.selected.has(idx); });
      return assignSira(picked, start);
    }

    function weekState(indexes) {
      var on = 0;
      indexes.forEach(function (idx) { if (state.selected.has(idx)) on += 1; });
      return { on: on, all: on === indexes.length && indexes.length > 0, some: on > 0 && on < indexes.length };
    }

    function renderTable() {
      if (!state.rows.length) {
        treeEl.innerHTML = '<div class="elc-empty">Önce F358’i seçin. Hafta grupları burada Excel’deki gibi görünecek.</div>';
        if (countEl) countEl.textContent = '0 satır';
        copyBtn.disabled = true;
        return;
      }
      var start = Math.max(1, parseInt(siraInput && siraInput.value, 10) || 1);
      var selectedSorted = Array.from(state.selected).sort(function (a, b) { return a - b; });
      var selectedCount = selectedSorted.length;
      var tree = groupTree(state.rows);
      treeEl.innerHTML = tree.map(function (yr) {
        var yearHtml = '<div class="elc-year"><div class="elc-banner elc-banner--year">TESLIM_YIL: ' + escapeHtml(yr.year) + '</div>';
        var weeksHtml = yr.weeks.map(function (wk) {
          var ws = weekState(wk.indexes);
          var checkClass = ws.all ? ' is-on' : (ws.some ? ' is-mixed' : '');
          var rowsHtml = wk.indexes.map(function (idx) {
            var row = state.rows[idx];
            var on = state.selected.has(idx);
            var sira = on ? start + selectedSorted.indexOf(idx) : '';
            return '<button type="button" class="elc-row' + (on ? ' is-selected' : '') + '" data-elc-idx="' + idx + '">' +
              '<span class="elc-check' + (on ? ' is-on' : '') + '" aria-hidden="true"></span>' +
              '<span class="elc-row__sira">' + escapeHtml(sira) + '</span>' +
              '<span>' + escapeHtml(row.cikisTarih) + '</span>' +
              '<span>' + escapeHtml(row.limanDolum) + '</span>' +
              '<span>' + escapeHtml(row.musteri) + '</span>' +
              '<span>' + escapeHtml(row.urun) + '</span>' +
              '<span>' + escapeHtml(row.sevkPlanMik) + '</span>' +
              '<span>' + escapeHtml(row.paket) + '</span>' +
              '<span>' + escapeHtml(row.bbAdet) + '</span>' +
              '<span>' + escapeHtml(row.cvAdet) + '</span>' +
              '<span>' + escapeHtml(row.paletTr) + '</span>' +
              '<span>' + escapeHtml(row.paletSayisi) + '</span>' +
              '<span>' + escapeHtml(row.paletUrunSayisi) + '</span>' +
              '<span>' + escapeHtml(row.pres) + '</span>' +
              '<span>' + escapeHtml(row.strec) + '</span>' +
              '<span>' + escapeHtml(row.paletOrtusu) + '</span>' +
              '<span>' + escapeHtml(row.serit) + '</span>' +
              '<span>' + escapeHtml(row.tedarikci) + '</span>' +
              '</button>';
          }).join('');
          return '<div class="elc-week">' +
            '<button type="button" class="elc-banner elc-banner--week" data-elc-week="' + escapeHtml(wk.week) + '" data-elc-year="' + escapeHtml(yr.year) + '">' +
              '<span class="elc-check' + checkClass + '" aria-hidden="true"></span>' +
              '<span>HAFTA: ' + escapeHtml(wk.week) + '</span>' +
              '<small>' + wk.indexes.length + ' sevk</small>' +
            '</button>' +
            '<div class="elc-week__rows">' + rowsHtml + '</div>' +
          '</div>';
        }).join('');
        return yearHtml + weeksHtml + '</div>';
      }).join('');
      if (countEl) {
        countEl.textContent = state.rows.length + ' satır · ' + selectedCount + ' seçili';
      }
      copyBtn.disabled = selectedCount === 0;
    }

    function setFile(file, autoSolve) {
      state.file = file || null;
      state.rows = [];
      state.selected = new Set();
      if (fileNameEl) fileNameEl.textContent = file ? file.name : 'Dosya seçilmedi';
      renderTable();
      setStatus(file ? 'Dosya hazır. Çözülüyor…' : '');
      if (file && autoSolve !== false) solveFile();
    }

    async function ensureXlsx() {
      if (typeof window.ensureXlsxLoaded === 'function') {
        await window.ensureXlsxLoaded();
      }
      if (typeof window.XLSX === 'undefined' || !window.XLSX.read) {
        throw new Error('Excel okuyucu yüklenemedi.');
      }
    }

    async function solveFile() {
      if (!state.file) {
        setStatus('Önce F358 kaynak Excel’ini seçin.', true);
        toast('Önce kaynak Excel’i seçin.', true);
        return;
      }
      try {
        solveBtn.disabled = true;
        setStatus('Çözülüyor…');
        await ensureXlsx();
        var buf = await state.file.arrayBuffer();
        var wb = window.XLSX.read(buf, { type: 'array', cellDates: true });
        var grid = workbookToGrid(wb);
        var solved = solveGrid(grid, siraInput && siraInput.value);
        if (!solved.ok) {
          setStatus(solved.error, true);
          toast(solved.error, true);
          return;
        }
        state.rows = solved.rows;
        state.selected = new Set();
        renderTable();
        setStatus(solved.rows.length + ' sevk göründü. Haftaya tıklayınca o grup seçilir — komple kopyalanmaz.');
        toast('✅ ' + solved.rows.length + ' satır çözüldü. Hafta veya satır seçin.');
      } catch (err) {
        var msg = err && err.message ? err.message : 'Excel çözülemedi.';
        setStatus(msg, true);
        toast(msg, true);
      } finally {
        solveBtn.disabled = false;
      }
    }

    async function copySelected() {
      var rows = selectedRows();
      if (!rows.length) {
        toast('Kopyalanacak satır seçin.', true);
        return;
      }
      try {
        await copyText(rowsToTsv(rows, false));
        setStatus(rows.length + ' satır panoya kopyalandı. Güncel listede boş satıra yapıştırın (Ctrl+V).');
        toast('✅ ' + rows.length + ' satır kopyalandı — Excel’e yapıştırın.');
      } catch (err) {
        var msg = err && err.message ? err.message : 'Kopyalanamadı.';
        setStatus(msg, true);
        toast(msg, true);
      }
    }

    if (fileInput) {
      fileInput.addEventListener('change', function () {
        setFile(fileInput.files && fileInput.files[0] ? fileInput.files[0] : null, true);
      });
    }

    if (drop) {
      ['dragenter', 'dragover'].forEach(function (ev) {
        drop.addEventListener(ev, function (e) {
          e.preventDefault();
          drop.classList.add('is-over');
        });
      });
      ['dragleave', 'drop'].forEach(function (ev) {
        drop.addEventListener(ev, function (e) {
          e.preventDefault();
          drop.classList.remove('is-over');
        });
      });
      drop.addEventListener('drop', function (e) {
        var file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        if (!file) return;
        if (fileInput) {
          try {
            var dt = new DataTransfer();
            dt.items.add(file);
            fileInput.files = dt.files;
          } catch (err) { /* ignore */ }
        }
        setFile(file, true);
      });
      drop.addEventListener('click', function (e) {
        if (e.target && e.target.closest('button, input, label')) return;
        if (fileInput) fileInput.click();
      });
      drop.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        if (fileInput) fileInput.click();
      });
    }

    solveBtn.addEventListener('click', function () { solveFile(); });
    copyBtn.addEventListener('click', function () { copySelected(); });
    if (selectAllBtn) {
      selectAllBtn.addEventListener('click', function () {
        state.selected = new Set(state.rows.map(function (_r, i) { return i; }));
        renderTable();
      });
    }
    if (clearSelBtn) {
      clearSelBtn.addEventListener('click', function () {
        state.selected = new Set();
        renderTable();
      });
    }
    if (siraInput) {
      siraInput.addEventListener('input', renderTable);
    }
    treeEl.addEventListener('click', function (e) {
      var weekBtn = e.target.closest('[data-elc-week]');
      if (weekBtn) {
        var year = weekBtn.getAttribute('data-elc-year');
        var week = weekBtn.getAttribute('data-elc-week');
        var group = groupTree(state.rows).reduce(function (found, yr) {
          if (found) return found;
          if (String(yr.year) !== String(year)) return null;
          return yr.weeks.find(function (wk) { return String(wk.week) === String(week); }) || null;
        }, null);
        if (!group) return;
        var ws = weekState(group.indexes);
        group.indexes.forEach(function (idx) {
          if (ws.all) state.selected.delete(idx);
          else state.selected.add(idx);
        });
        renderTable();
        return;
      }
      var rowBtn = e.target.closest('[data-elc-idx]');
      if (!rowBtn) return;
      var idx = Number(rowBtn.getAttribute('data-elc-idx'));
      if (!Number.isFinite(idx)) return;
      if (state.selected.has(idx)) state.selected.delete(idx);
      else state.selected.add(idx);
      renderTable();
    });

    renderTable();
  }

  var api = {
    TARGET_HEADERS: TARGET_HEADERS,
    HEADER_ALIASES: HEADER_ALIASES,
    trimStr: trimStr,
    formatDateTr: formatDateTr,
    formatDateCopyTr: formatDateCopyTr,
    formatHafta: formatHafta,
    formatMt: formatMt,
    shortenTedarikci: shortenTedarikci,
    formatMusteri: formatMusteri,
    formatLotNo: formatLotNo,
    formatUrun: formatUrun,
    formatAmbalaj: formatAmbalaj,
    packageCounts: packageCounts,
    shortenLiman: shortenLiman,
    cleanNote: cleanNote,
    parseGroupBanner: parseGroupBanner,
    parseSourceGrid: parseSourceGrid,
    mapSourceRow: mapSourceRow,
    assignSira: assignSira,
    solveGrid: solveGrid,
    groupTree: groupTree,
    rowToCells: rowToCells,
    rowsToTsv: rowsToTsv,
    workbookToGrid: workbookToGrid,
    copyText: copyText,
    bindAyarlarUi: bindAyarlarUi,
    bindAppUi: bindAppUi
  };

  if (typeof window !== 'undefined') window.ExcelListCopy = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : typeof global !== 'undefined' ? global : this);
