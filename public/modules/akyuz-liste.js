// akyuz-liste.js — Ham Akyüz sevkiyat listesini günlük gönderim formatına çevirir
(function (root) {
  'use strict';

  var TARGET_HEADERS = [
    'SIRA',
    'TEDARİKÇİ',
    'SEVK TARİHİ',
    'FİRMA',
    'LOT',
    'TONAJ',
    'BİRİM AMBALAJ AĞIRLIĞI',
    'AMBALAJ SAYISI',
    'AMBALAJ TİPİ',
    'PALET SAYISI',
    'LİMAN',
    'DEPO',
    'YÜKLEME YERİ',
    'LİMAN DOLUM TARİHİ',
    'FATURA BİLGİSİ',
    'BOOKING NO',
    'GEMİ ADI'
  ];

  var PALET_ARAC_NOTU = 'kısa ve baba direkleri sökülen araç olması gerekmektedir';

  var TR_MONTHS = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
  var TR_WEEKDAYS = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];

  function trimStr(value) {
    return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  }

  function foldTr(value) {
    return trimStr(value)
      .replace(/İ/g, 'i')
      .replace(/I/g, 'i')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/ı/g, 'i')
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

  function displayQty(value) {
    if (value == null || value === '') return '';
    if (typeof value === 'number' && Number.isFinite(value)) {
      if (Math.abs(value - Math.round(value)) < 0.0005) return String(Math.round(value));
      return String(value).replace('.', ',');
    }
    var n = toNumber(value);
    if (n && trimStr(value).replace(/\s/g, '').match(/^\d+([.,]\d+)?$/)) {
      if (Math.abs(n - Math.round(n)) < 0.0005) return String(Math.round(n));
      return String(n).replace('.', ',');
    }
    return trimStr(value);
  }

  function parseDateParts(value) {
    if (value instanceof Date && !isNaN(value.getTime())) {
      var y = value.getUTCFullYear();
      var m = value.getUTCMonth();
      var d = value.getUTCDate();
      var h = value.getUTCHours();
      var mi = value.getUTCMinutes();
      var s = value.getUTCSeconds();
      if (h === 0 && mi === 0 && s === 0) return { y: y, m: m + 1, d: d };
      if (h >= 12) {
        var next = new Date(Date.UTC(y, m, d + 1));
        return { y: next.getUTCFullYear(), m: next.getUTCMonth() + 1, d: next.getUTCDate() };
      }
      return { y: y, m: m + 1, d: d };
    }
    if (typeof value === 'number' && Number.isFinite(value) && value > 20000 && value < 80000) {
      var serial = Math.floor(value + 1e-8);
      var utc = Date.UTC(1899, 11, 30) + serial * 86400000;
      var dt = new Date(utc);
      return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
    }
    var text = trimStr(value);
    var iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (iso) return { y: Number(iso[1]), m: Number(iso[2]), d: Number(iso[3]) };
    var tr = text.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})/);
    if (tr) return { y: Number(tr[3]), m: Number(tr[2]), d: Number(tr[1]) };
    var longTr = text.match(/^(\d{1,2})\s+([A-Za-zÇĞİÖŞÜçğıöşü]+)\s+(\d{4})/);
    if (longTr) {
      var monthIdx = TR_MONTHS.findIndex(function (name) {
        return foldTr(name) === foldTr(longTr[2]);
      });
      if (monthIdx >= 0) return { y: Number(longTr[3]), m: monthIdx + 1, d: Number(longTr[1]) };
    }
    return null;
  }

  function dateKey(parts) {
    if (!parts) return '';
    return parts.y + '-' + String(parts.m).padStart(2, '0') + '-' + String(parts.d).padStart(2, '0');
  }

  function formatDateCopyTr(value) {
    var p = parseDateParts(value);
    if (!p) return trimStr(value);
    var month = TR_MONTHS[p.m - 1];
    if (!month) return trimStr(value);
    var dt = new Date(Date.UTC(p.y, p.m - 1, p.d));
    var dayName = TR_WEEKDAYS[dt.getUTCDay()] || '';
    return p.d + ' ' + month + ' ' + p.y + (dayName ? ' ' + dayName : '');
  }

  function todayParts(asOf) {
    if (asOf && asOf.y && asOf.m && asOf.d) {
      return { y: Number(asOf.y), m: Number(asOf.m), d: Number(asOf.d) };
    }
    if (asOf instanceof Date && !isNaN(asOf.getTime())) {
      return { y: asOf.getFullYear(), m: asOf.getMonth() + 1, d: asOf.getDate() };
    }
    var now = new Date();
    return { y: now.getFullYear(), m: now.getMonth() + 1, d: now.getDate() };
  }

  function findHeaderRow(grid) {
    if (!Array.isArray(grid)) return -1;
    for (var i = 0; i < Math.min(grid.length, 8); i++) {
      var keys = {};
      (grid[i] || []).forEach(function (cell) {
        var k = headerKey(cell);
        if (k) keys[k] = true;
      });
      if (keys.TEDARIKCI && keys.FIRMA && (keys.SEVK_TARIHI || keys.TONAJ) && keys.BIRIM_AMBALAJ_AGIRLIGI) {
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

  function readCol(row, colMap, key) {
    var idx = colMap[key];
    if (idx == null) return '';
    return row[idx] == null ? '' : row[idx];
  }

  function isFooterRow(row) {
    var text = (row || []).slice(0, 4).map(trimStr).filter(Boolean).join(' ');
    var f = foldTr(text);
    if (!f) return false;
    if (f === 'toplam' || f.indexOf('genel hatirlatma') >= 0) return true;
    if (/^\d+\s*-/.test(trimStr(text))) return true;
    return false;
  }

  function extractUnitKg(raw) {
    var text = trimStr(raw);
    if (!text) return 0;
    var net = text.match(/NET\s*(\d+(?:[.,]\d+)?)\s*KG/i);
    if (net) return toNumber(net[1]);
    var kg = text.match(/(\d+(?:[.,]\d+)?)\s*KG/i);
    if (kg) return toNumber(kg[1]);
    if (/^\d+([.,]\d+)?$/.test(text.replace(/\s/g, ''))) return toNumber(text);
    return 0;
  }

  function qtyMatchesTonaj(count, unitKg, tonaj) {
    var n = toNumber(count);
    var u = toNumber(unitKg);
    var t = toNumber(tonaj);
    if (!(n > 0) || !(u > 0) || !(t > 0)) return false;
    var got = n * u / 1000;
    return Math.abs(got - t) <= Math.max(0.6, t * 0.02);
  }

  function shortenTedarikci(name) {
    var raw = trimStr(name);
    if (!raw) return 'AKYÜZ';
    var folded = foldTr(raw);
    if (folded.indexOf('akyuz') >= 0) return 'AKYÜZ';
    return raw;
  }

  function looksLikePackText(value) {
    var f = foldTr(value);
    if (!f) return false;
    return f.indexOf('net ') >= 0 || f.indexOf('kg') >= 0 || f.indexOf('bigbag') >= 0 || f.indexOf('gpm') >= 0;
  }

  function inferYuklemeYeri(packText) {
    var f = foldTr(packText);
    if (f.indexOf('ustu acik') >= 0 || f.indexOf('gpm6') >= 0) return '1.OSB';
    return 'AVDAN';
  }

  function transformRow(src, opts) {
    opts = opts || {};
    var packText = trimStr(src.ambalajTipi) && looksLikePackText(src.ambalajTipi)
      ? trimStr(src.ambalajTipi)
      : trimStr(src.birimAmbalaj);
    if (!packText) packText = trimStr(src.birimAmbalaj) || trimStr(src.ambalajTipi);
    var unitKg = extractUnitKg(src.birimAmbalaj) || extractUnitKg(packText);
    var bags = toNumber(src.ambalajSayisi);
    var palet = toNumber(src.paletSayisi);
    var tonaj = src.tonaj;
    var outBags = bags;
    var outPalet = palet;
    if (unitKg > 0 && !qtyMatchesTonaj(bags, unitKg, tonaj) && qtyMatchesTonaj(palet, unitKg, tonaj)) {
      outBags = palet;
      outPalet = 0;
    }
    var tip = trimStr(src.ambalajTipi);
    if (!tip || foldTr(tip) === foldTr(src.birimAmbalaj) || looksLikePackText(tip)) {
      tip = '';
    }
    if (opts.addPaletNote && outPalet > 0 && !tip) {
      tip = PALET_ARAC_NOTU;
    }
    var yukleme = trimStr(src.yuklemeYeri);
    if (opts.fillYukleme && !yukleme) {
      yukleme = inferYuklemeYeri(packText);
    }
    return {
      sira: src.sira || '',
      tedarikci: shortenTedarikci(src.tedarikci),
      sevkTarih: trimStr(src.sevkTarihText) || formatDateCopyTr(src.sevkTarih),
      sevkParts: src.sevkParts,
      firma: trimStr(src.firma),
      lot: trimStr(src.lot),
      tonaj: tonaj,
      birimKg: unitKg || src.birimAmbalaj,
      ambalajSayisi: outBags || '',
      ambalajTipi: tip,
      paletSayisi: outPalet || '',
      liman: trimStr(src.liman),
      depo: trimStr(src.depo),
      yuklemeYeri: yukleme,
      limanDolum: src.limanDolum,
      fatura: trimStr(src.fatura),
      bookingNo: trimStr(src.bookingNo),
      gemi: trimStr(src.gemi),
      dropped: false
    };
  }

  function parseSourceGrid(grid) {
    var headerIdx = findHeaderRow(grid);
    if (headerIdx < 0) {
      return { ok: false, error: 'Akyüz listesi başlığı bulunamadı (TEDARİKÇİ / FİRMA / BİRİM AMBALAJ).', rows: [], footer: [] };
    }
    var colMap = buildColMap(grid[headerIdx]);
    var rows = [];
    var footer = [];
    var inFooter = false;
    for (var r = headerIdx + 1; r < grid.length; r++) {
      var raw = grid[r] || [];
      if (inFooter || isFooterRow(raw)) {
        inFooter = true;
        footer.push(raw.slice());
        continue;
      }
      var firma = trimStr(readCol(raw, colMap, 'FIRMA'));
      var sevk = readCol(raw, colMap, 'SEVK_TARIHI');
      if (!firma && !trimStr(sevk) && !trimStr(readCol(raw, colMap, 'LOT'))) continue;
      var sevkParts = parseDateParts(sevk);
      rows.push({
        sira: trimStr(readCol(raw, colMap, 'SIRA')),
        tedarikci: readCol(raw, colMap, 'TEDARIKCI'),
        sevkTarih: sevk,
        sevkTarihText: typeof sevk === 'string' ? trimStr(sevk) : '',
        sevkParts: sevkParts,
        firma: firma,
        lot: readCol(raw, colMap, 'LOT'),
        tonaj: readCol(raw, colMap, 'TONAJ'),
        birimAmbalaj: readCol(raw, colMap, 'BIRIM_AMBALAJ_AGIRLIGI'),
        ambalajSayisi: readCol(raw, colMap, 'AMBALAJ_SAYISI'),
        ambalajTipi: readCol(raw, colMap, 'AMBALAJ_TIPI'),
        paletSayisi: readCol(raw, colMap, 'PALET_SAYISI'),
        liman: readCol(raw, colMap, 'LIMAN'),
        depo: readCol(raw, colMap, 'DEPO'),
        yuklemeYeri: readCol(raw, colMap, 'YUKLEME_YERI'),
        limanDolum: readCol(raw, colMap, 'LIMAN_DOLUM_TARIHI'),
        fatura: readCol(raw, colMap, 'FATURA_BILGISI'),
        bookingNo: readCol(raw, colMap, 'BOOKING_NO'),
        gemi: readCol(raw, colMap, 'GEMI_ADI')
      });
    }
    return { ok: true, rows: rows, footer: footer, headerIndex: headerIdx, colMap: colMap };
  }

  function solveGrid(grid, options) {
    options = options || {};
    var parsed = parseSourceGrid(grid);
    if (!parsed.ok) return parsed;
    var today = todayParts(options.asOf);
    var todayKeyStr = dateKey(today);
    var dropToday = options.dropToday !== false;
    var fillYukleme = options.fillYukleme !== false;
    var addPaletNote = options.addPaletNote !== false;

    var keptSrc = parsed.rows.filter(function (src) {
      if (!src.sevkParts) return true;
      var key = dateKey(src.sevkParts);
      if (dropToday) return key > todayKeyStr;
      return key >= todayKeyStr;
    });

    var firstKey = '';
    keptSrc.forEach(function (src) {
      var key = src.sevkParts ? dateKey(src.sevkParts) : '';
      if (key && (!firstKey || key < firstKey)) firstKey = key;
    });

    var mapped = keptSrc.map(function (src, i) {
      var isFirstDay = src.sevkParts && dateKey(src.sevkParts) === firstKey;
      var row = transformRow(src, {
        fillYukleme: fillYukleme && isFirstDay,
        addPaletNote: addPaletNote && isFirstDay
      });
      row.sira = String(i + 1);
      return row;
    });

    var dropped = parsed.rows.length - keptSrc.length;
    var tonajToplam = mapped.reduce(function (sum, row) {
      return sum + toNumber(row.tonaj);
    }, 0);

    return {
      ok: true,
      rows: mapped,
      footer: parsed.footer,
      dropped: dropped,
      sourceCount: parsed.rows.length,
      tonajToplam: tonajToplam,
      firstDay: firstKey
    };
  }

  function rowToCells(row) {
    return [
      row.sira,
      row.tedarikci,
      row.sevkTarih,
      row.firma,
      row.lot,
      row.tonaj,
      row.birimKg,
      row.ambalajSayisi,
      row.ambalajTipi,
      row.paletSayisi,
      row.liman,
      row.depo,
      row.yuklemeYeri,
      row.limanDolum,
      row.fatura,
      row.bookingNo,
      row.gemi
    ];
  }

  function workbookToGrid(wb) {
    if (!wb || !wb.SheetNames || !wb.SheetNames.length) return [];
    var XLSX = (typeof window !== 'undefined' && window.XLSX) || (typeof root !== 'undefined' && root.XLSX);
    if (!XLSX || !XLSX.utils) return [];
    var ws = wb.Sheets[wb.SheetNames[0]];
    if (!ws) return [];
    return XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', blankrows: false, raw: true });
  }

  function sheetNameOf(wb) {
    return (wb && wb.SheetNames && wb.SheetNames[0]) || 'AKYÜZ';
  }

  function rowsToAoa(solved) {
    var aoa = [TARGET_HEADERS.slice()];
    (solved.rows || []).forEach(function (row) {
      aoa.push(rowToCells(row));
    });
    var totalRow = new Array(TARGET_HEADERS.length).fill('');
    totalRow[0] = 'Toplam';
    totalRow[5] = Math.round(toNumber(solved.tonajToplam) * 1000) / 1000;
    aoa.push(totalRow);
    (solved.footer || []).forEach(function (raw) {
      if (foldTr((raw || [])[0]) === 'toplam') return;
      var line = TARGET_HEADERS.map(function (_h, i) { return raw[i] == null ? '' : raw[i]; });
      aoa.push(line);
    });
    return aoa;
  }

  function buildWorkbook(solved, sheetName) {
    var XLSX = (typeof window !== 'undefined' && window.XLSX) || (typeof root !== 'undefined' && root.XLSX);
    if (!XLSX || !XLSX.utils) throw new Error('Excel yazıcı yüklenemedi.');
    var aoa = rowsToAoa(solved);
    var ws = XLSX.utils.aoa_to_sheet(aoa);
    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, (sheetName || 'AKYÜZ').slice(0, 31));
    return wb;
  }

  function downloadWorkbook(wb, fileName) {
    var XLSX = (typeof window !== 'undefined' && window.XLSX) || (typeof root !== 'undefined' && root.XLSX);
    if (!XLSX || typeof XLSX.writeFile !== 'function') throw new Error('Excel indirilemedi.');
    XLSX.writeFile(wb, fileName || 'Akyuz_liste.xlsx');
  }

  var FATURA_GENPER = 'GENPER MADENCİLİK TİC.LTD.ŞTİ.';
  var FORM_OUT_NAME = 'AKYÜZ - HAFTALIK İHRACAT SEVK BİLDİRİ FORMU.xlsx';
  var FORM_COLS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q'];

  function keepText(value) {
    if (value == null) return '';
    return String(value).replace(/\r?\n/g, ' ').replace(/[ \t]{2,}/g, ' ').replace(/[ \t]+$/g, '');
  }

  function numOrBlank(value) {
    if (value == null || trimStr(value) === '') return '';
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    var s = trimStr(value).replace(/\s/g, '');
    if (!/^-?\d+([.,]\d+)?$/.test(s)) return '';
    return toNumber(value);
  }

  function countOrBlank(value) {
    var n = numOrBlank(value);
    if (n === '' || n === 0) return '';
    return n;
  }

  function bookingValue(value) {
    if (value == null || trimStr(value) === '') return '';
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    var s = trimStr(value);
    if (/^\d+$/.test(s)) return Number(s);
    return keepText(value);
  }

  function excelSerial(parts) {
    var utc = Date.UTC(parts.y, parts.m - 1, parts.d);
    var epoch = Date.UTC(1899, 11, 30);
    return Math.round((utc - epoch) / 86400000);
  }

  function dolumValue(value) {
    if (value == null || trimStr(value) === '') return '';
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    var parts = parseDateParts(value);
    var text = keepText(value);
    if (parts && /^\d{1,2}[./]\d{1,2}[./]\d{2,4}$/.test(trimStr(text))) return excelSerial(parts);
    return text;
  }

  function sevkLabel(value) {
    if (typeof value === 'string' && trimStr(value)) return keepText(value);
    if (value == null || value === '') return '';
    return formatDateCopyTr(value);
  }

  function faturaForFirma(firma) {
    if (/\(M\)/i.test(String(firma || ''))) return FATURA_GENPER;
    return '';
  }

  function textOrNumber(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    return value == null ? '' : keepText(value);
  }

  function hasCol(colMap, key) {
    return colMap[key] != null;
  }

  function detectShipmentGrid(grid) {
    if (!Array.isArray(grid)) return { kind: 'unknown' };
    var limit = Math.min(grid.length, 25);
    for (var i = 0; i < limit; i++) {
      var colMap = buildColMap(grid[i]);
      if (hasCol(colMap, 'TEDARIKCI') && hasCol(colMap, 'FIRMA') && hasCol(colMap, 'BIRIM_AMBALAJ_AGIRLIGI')) {
        return { kind: 'form', headerIndex: i, colMap: colMap };
      }
      if (hasCol(colMap, 'TEDARIKCI') && (hasCol(colMap, 'MUSTERI') || hasCol(colMap, 'FIRMA')) && (hasCol(colMap, 'AMBALAJ') || hasCol(colMap, 'BIRIM_AMBALAJ_AGIRLIGI')) && (hasCol(colMap, 'MT') || hasCol(colMap, 'TONAJ') || hasCol(colMap, 'GENPER_CIKIS_TARIHI'))) {
        return { kind: 'guncel', headerIndex: i, colMap: colMap };
      }
    }
    return { kind: 'unknown' };
  }

  function firstFilled(raw, colMap, keys) {
    for (var i = 0; i < keys.length; i++) {
      if (colMap[keys[i]] == null) continue;
      var value = readCol(raw, colMap, keys[i]);
      if (trimStr(value) !== '') return value;
    }
    for (var j = 0; j < keys.length; j++) {
      if (colMap[keys[j]] != null) return readCol(raw, colMap, keys[j]);
    }
    return '';
  }

  function mapGuncelGrid(grid, found, options) {
    var colMap = found.colMap;
    var rows = [];
    var emptyRun = 0;
    for (var r = found.headerIndex + 1; r < grid.length; r++) {
      var raw = grid[r] || [];
      if (isFooterRow(raw)) break;
      var ted = readCol(raw, colMap, 'TEDARIKCI');
      var firma = firstFilled(raw, colMap, ['MUSTERI', 'FIRMA']);
      var sevk = firstFilled(raw, colMap, ['GENPER_CIKIS_TARIHI', 'SEVK_TARIHI']);
      if (!trimStr(ted) && !trimStr(firma) && !trimStr(sevk)) {
        emptyRun++;
        if (emptyRun > 5) break;
        continue;
      }
      emptyRun = 0;
      var ambalaj = firstFilled(raw, colMap, ['AMBALAJ', 'BIRIM_AMBALAJ_AGIRLIGI']);
      var adet = firstFilled(raw, colMap, ['ADET', 'PALET_SAYISI']);
      var sayi = firstFilled(raw, colMap, ['BIGBAG_CUVAL', 'AMBALAJ_SAYISI']);
      var tonaj = firstFilled(raw, colMap, ['MT', 'TONAJ']);
      var lot = firstFilled(raw, colMap, ['MUSTERI_KODU', 'LOT']);
      var liman = firstFilled(raw, colMap, ['GIDECEGI_LIMAN', 'LIMAN']);
      var gemi = firstFilled(raw, colMap, ['GEMI_DETAYI', 'GEMI_ADI']);
      var booking = readCol(raw, colMap, 'BOOKING_NO');
      var yuk = firstFilled(raw, colMap, ['YUKLELEM_YERI', 'YUKLEME_YERI']);
      var depo = readCol(raw, colMap, 'DEPO');
      var dolum = readCol(raw, colMap, 'LIMAN_DOLUM_TARIHI');
      var firmaText = keepText(firma);
      var ambalajText = keepText(ambalaj);
      rows.push({
        tedarikciRaw: ted,
        excelSira: '',
        sira: '',
        tedarikci: shortenTedarikci(ted),
        sevkTarih: sevkLabel(sevk),
        sevkParts: parseDateParts(sevk),
        firma: firmaText,
        lot: keepText(lot),
        tonaj: numOrBlank(tonaj),
        birimKg: ambalajText,
        birimText: ambalajText,
        ambalajSayisi: countOrBlank(sayi),
        ambalajTipi: ambalajText,
        paletSayisi: countOrBlank(adet),
        liman: keepText(liman),
        depo: keepText(depo),
        yuklemeYeri: keepText(yuk),
        limanDolum: dolumValue(dolum),
        fatura: faturaForFirma(firmaText),
        bookingNo: bookingValue(booking),
        gemi: keepText(gemi)
      });
    }
    var akyuzRows = rows.filter(function (row) {
      return foldTr(row.tedarikciRaw).indexOf('akyuz') >= 0;
    });
    var selected = akyuzRows.length ? akyuzRows : rows;
    var todayKeyStr = dateKey(todayParts(options.asOf));
    var dropToday = options.dropToday !== false;
    var kept = selected.filter(function (row) {
      if (!row.sevkParts) return true;
      var key = dateKey(row.sevkParts);
      if (dropToday) return key > todayKeyStr;
      return key >= todayKeyStr;
    });
    var tonajToplam = kept.reduce(function (sum, row) {
      return sum + toNumber(row.tonaj);
    }, 0);
    return {
      ok: true,
      kind: 'guncel',
      rows: kept,
      dropped: selected.length - kept.length,
      removedSuppliers: rows.length - selected.length,
      sourceCount: rows.length,
      tonajToplam: tonajToplam
    };
  }

  function mapSolvedToForm(solved) {
    var rows = (solved.rows || []).map(function (row) {
      return {
        excelSira: row.sira,
        sira: row.sira,
        tedarikci: row.tedarikci,
        sevkTarih: row.sevkTarih,
        sevkParts: row.sevkParts,
        firma: row.firma,
        lot: row.lot,
        tonaj: numOrBlank(row.tonaj),
        birimKg: row.birimKg,
        birimText: row.birimKg,
        ambalajSayisi: countOrBlank(row.ambalajSayisi),
        ambalajTipi: row.ambalajTipi || '',
        paletSayisi: countOrBlank(row.paletSayisi),
        liman: row.liman || '',
        depo: row.depo || '',
        yuklemeYeri: row.yuklemeYeri || '',
        limanDolum: dolumValue(row.limanDolum),
        fatura: row.fatura || '',
        bookingNo: bookingValue(row.bookingNo),
        gemi: row.gemi || ''
      };
    });
    return {
      ok: true,
      kind: 'form',
      rows: rows,
      dropped: solved.dropped,
      removedSuppliers: 0,
      sourceCount: solved.sourceCount,
      tonajToplam: solved.tonajToplam
    };
  }

  function mapShipmentGrid(grid, options) {
    options = options || {};
    var found = detectShipmentGrid(grid);
    if (found.kind === 'guncel') return mapGuncelGrid(grid, found, options);
    if (found.kind === 'form') {
      var solved = solveGrid(grid, options);
      if (!solved.ok) return solved;
      return mapSolvedToForm(solved);
    }
    return { ok: false, error: 'Ham liste başlığı bulunamadı. Güncel ihracat listesi ya da sevk bildiri formu gerekli.' };
  }

  function readU16(u8, o) { return u8[o] | (u8[o + 1] << 8); }
  function readU32(u8, o) {
    return (u8[o] | (u8[o + 1] << 8) | (u8[o + 2] << 16) | (u8[o + 3] << 24)) >>> 0;
  }
  function u16bytes(n) { return Uint8Array.from([n & 255, (n >>> 8) & 255]); }
  function u32bytes(n) {
    return Uint8Array.from([n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255]);
  }
  function concatBytes(parts) {
    var len = 0;
    for (var i = 0; i < parts.length; i++) len += parts[i].length;
    var out = new Uint8Array(len);
    var o = 0;
    for (var j = 0; j < parts.length; j++) {
      out.set(parts[j], o);
      o += parts[j].length;
    }
    return out;
  }
  function crc32(u8) {
    if (!crc32.table) {
      var table = new Uint32Array(256);
      for (var n = 0; n < 256; n++) {
        var c = n;
        for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        table[n] = c >>> 0;
      }
      crc32.table = table;
    }
    var crc = 0xFFFFFFFF;
    for (var i = 0; i < u8.length; i++) crc = crc32.table[(crc ^ u8[i]) & 255] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }
  function findEocd(u8) {
    var min = Math.max(0, u8.length - 22 - 65536);
    for (var i = u8.length - 22; i >= min; i--) {
      if (u8[i] === 0x50 && u8[i + 1] === 0x4b && u8[i + 2] === 0x05 && u8[i + 3] === 0x06) return i;
    }
    throw new Error('Excel paketi okunamadı.');
  }
  function rawView(u8) {
    return Buffer.from(u8.buffer, u8.byteOffset, u8.byteLength);
  }
  async function inflateRaw(u8) {
    if (typeof DecompressionStream !== 'undefined') {
      var ds = new DecompressionStream('deflate-raw');
      var stream = new Blob([u8]).stream().pipeThrough(ds);
      return new Uint8Array(await new Response(stream).arrayBuffer());
    }
    var zlib = require('zlib');
    return new Uint8Array(zlib.inflateRawSync(rawView(u8)));
  }
  async function deflateRaw(u8) {
    if (typeof CompressionStream !== 'undefined') {
      var cs = new CompressionStream('deflate-raw');
      var stream = new Blob([u8]).stream().pipeThrough(cs);
      return new Uint8Array(await new Response(stream).arrayBuffer());
    }
    var zlib = require('zlib');
    return new Uint8Array(zlib.deflateRawSync(rawView(u8)));
  }
  async function unzipStore(buffer) {
    var u8 = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    var eocd = findEocd(u8);
    var count = readU16(u8, eocd + 10);
    var cdOff = readU32(u8, eocd + 16);
    var files = [];
    var p = cdOff;
    for (var i = 0; i < count; i++) {
      if (readU32(u8, p) !== 0x02014b50) throw new Error('Excel paketi bozuk.');
      var method = readU16(u8, p + 10);
      var compSize = readU32(u8, p + 20);
      var nameLen = readU16(u8, p + 28);
      var extraLen = readU16(u8, p + 30);
      var commentLen = readU16(u8, p + 32);
      var localOff = readU32(u8, p + 42);
      var name = new TextDecoder('utf-8').decode(u8.slice(p + 46, p + 46 + nameLen));
      p += 46 + nameLen + extraLen + commentLen;
      var localNameLen = readU16(u8, localOff + 26);
      var localExtraLen = readU16(u8, localOff + 28);
      var dataStart = localOff + 30 + localNameLen + localExtraLen;
      var comp = u8.slice(dataStart, dataStart + compSize);
      var data = method === 0 ? comp : method === 8 ? await inflateRaw(comp) : null;
      if (!data) throw new Error('Excel sıkıştırması okunamadı.');
      if (name.charAt(name.length - 1) !== '/') files.push({ name: name, data: data });
    }
    return files;
  }
  function slimSheetXml(xml) {
    var out = xml.replace(/<col\b[^>]*\/>/g, function (tag) {
      var min = Number((tag.match(/\bmin="(\d+)"/) || [])[1] || 0);
      var max = Number((tag.match(/\bmax="(\d+)"/) || [])[1] || min);
      if (min > 17) return '';
      if (max > 17) return tag.replace(/\bmax="\d+"/, 'max="17"');
      return tag;
    });
    out = out.replace(/<selection\b[^>]*\/>/g, '<selection activeCell="A1" sqref="A1"/>');
    out = out.replace(/(<pageSetup\b[^>]*?)\s+r:id="[^"]+"/, '$1');
    out = out.replace(/\bzoomScale="\d+"/g, 'zoomScale="100"');
    out = out.replace(/\bzoomScaleNormal="\d+"/g, 'zoomScaleNormal="100"');
    return out;
  }
  async function zipStore(files) {
    var locals = [];
    var centrals = [];
    var offset = 0;
    for (var i = 0; i < files.length; i++) {
      var file = files[i];
      var nameBytes = new TextEncoder().encode(file.name);
      var data = file.data;
      var compressed = await deflateRaw(data);
      var crc = crc32(data);
      var local = concatBytes([
        Uint8Array.from([0x50, 0x4b, 0x03, 0x04]),
        u16bytes(20), u16bytes(0), u16bytes(8), u16bytes(0), u16bytes(0),
        u32bytes(crc), u32bytes(compressed.length), u32bytes(data.length),
        u16bytes(nameBytes.length), u16bytes(0),
        nameBytes, compressed
      ]);
      var central = concatBytes([
        Uint8Array.from([0x50, 0x4b, 0x01, 0x02]),
        u16bytes(20), u16bytes(20), u16bytes(0), u16bytes(8), u16bytes(0), u16bytes(0),
        u32bytes(crc), u32bytes(compressed.length), u32bytes(data.length),
        u16bytes(nameBytes.length), u16bytes(0), u16bytes(0), u16bytes(0), u16bytes(0), u32bytes(0),
        u32bytes(offset),
        nameBytes
      ]);
      locals.push(local);
      centrals.push(central);
      offset += local.length;
    }
    var centralBlob = concatBytes(centrals);
    var eocd = concatBytes([
      Uint8Array.from([0x50, 0x4b, 0x05, 0x06]),
      u16bytes(0), u16bytes(0), u16bytes(files.length), u16bytes(files.length),
      u32bytes(centralBlob.length), u32bytes(offset), u16bytes(0)
    ]);
    return concatBytes(locals.concat([centralBlob, eocd]));
  }
  function utf8Text(text) { return new TextEncoder().encode(text); }
  function xmlEscape(text) {
    return String(text)
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
  function xmlUnescape(text) {
    return String(text)
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'");
  }
  function xmlNum(n) {
    if (!Number.isFinite(n)) return '0';
    var rounded = Math.round(n * 1000) / 1000;
    if (Math.abs(rounded - Math.round(rounded)) < 1e-9) return String(Math.round(rounded));
    var s = String(rounded);
    if (s.indexOf('e') >= 0) return rounded.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
    return s;
  }
  function parseSiBlocks(sstXml) {
    var blocks = [];
    var re = /<si\b[^>]*>[\s\S]*?<\/si>/g;
    var m;
    while ((m = re.exec(sstXml))) blocks.push(m[0]);
    return blocks;
  }
  function siText(block) {
    var parts = [];
    var re = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
    var m;
    while ((m = re.exec(block))) parts.push(xmlUnescape(m[1]));
    return parts.join('');
  }
  function plainSi(text) {
    var clean = String(text).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
    var preserve = /^\s|\s$/.test(clean) ? ' xml:space="preserve"' : '';
    return '<si><t' + preserve + '>' + xmlEscape(clean) + '</t></si>';
  }
  function parseSheetRows(xml) {
    var rows = [];
    var re = /<row r="(\d+)"([^>]*)>([\s\S]*?)<\/row>/g;
    var m;
    while ((m = re.exec(xml))) rows.push({ r: Number(m[1]), attrs: m[2], inner: m[3] });
    return rows;
  }
  function rowTexts(inner, siTexts) {
    var out = [];
    var re = /<c r="[A-Z]+\d+"([^>]*)(?:\/>|>([\s\S]*?)<\/c>)/g;
    var m;
    while ((m = re.exec(inner))) {
      var attrs = m[1] || '';
      var body = m[2] || '';
      if (/\bt="s"/.test(attrs)) {
        var v = body.match(/<v>(\d+)<\/v>/);
        if (v) out.push(siTexts[Number(v[1])] || '');
      } else {
        var n = body.match(/<v>([\s\S]*?)<\/v>/);
        if (n) out.push(xmlUnescape(n[1]));
      }
    }
    return out;
  }
  function isFormHeaderTexts(texts) {
    var keys = {};
    (texts || []).forEach(function (text) {
      var k = headerKey(text);
      if (k) keys[k] = true;
    });
    return !!(keys.SIRA && keys.TEDARIKCI);
  }
  function extractStyleMap(inner) {
    var map = {};
    var re = /<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>)/g;
    var m;
    while ((m = re.exec(inner))) {
      var sm = m[2].match(/\ss="(\d+)"/);
      map[m[1]] = sm ? sm[1] : '';
    }
    return map;
  }
  function collectStringIdx(inner, into, seen) {
    var re = /<c\b[^>]*\bt="s"[^>]*>([\s\S]*?)<\/c>/g;
    var m;
    while ((m = re.exec(inner))) {
      var v = m[1].match(/<v>(\d+)<\/v>/);
      if (!v) continue;
      var idx = Number(v[1]);
      if (seen[idx]) continue;
      seen[idx] = true;
      into.push(idx);
    }
  }
  function renumberInner(inner, oldR, newR) {
    if (oldR === newR) return inner;
    return inner.replace(new RegExp('r="([A-Z]+)' + oldR + '"', 'g'), 'r="$1' + newR + '"');
  }
  function remapStringCells(inner, oldToNew) {
    return inner.replace(/<c r="([A-Z]+\d+)"([^>]*?)\/>|<c r="([A-Z]+\d+)"([^>]*)>([\s\S]*?)<\/c>/g, function (all, _ref1, _attrs1, ref, attrs, body) {
      if (!ref || !/\bt="s"/.test(attrs || '')) return all;
      var v = body.match(/<v>(\d+)<\/v>/);
      if (!v) return all;
      var ni = oldToNew[Number(v[1])];
      if (ni == null) return all;
      return '<c r="' + ref + '"' + attrs + '><v>' + ni + '</v></c>';
    });
  }
  function siraValue(row) {
    if (row.excelSira == null || trimStr(row.excelSira) === '') return '';
    var n = numOrBlank(row.excelSira);
    return n === '' ? keepText(row.excelSira) : n;
  }
  function formValues(row) {
    return {
      A: siraValue(row),
      B: row.tedarikci || '',
      C: row.sevkTarih || '',
      D: row.firma || '',
      E: row.lot || '',
      F: numOrBlank(row.tonaj),
      G: textOrNumber(row.birimText != null ? row.birimText : row.birimKg),
      H: countOrBlank(row.ambalajSayisi),
      I: row.ambalajTipi || '',
      J: countOrBlank(row.paletSayisi),
      K: row.liman || '',
      L: row.depo || '',
      M: row.yuklemeYeri || '',
      N: row.limanDolum == null ? '' : row.limanDolum,
      O: row.fatura || '',
      P: bookingValue(row.bookingNo),
      Q: row.gemi || ''
    };
  }
  function dataCellXml(col, rowNum, style, value, addString) {
    var ref = col + rowNum;
    var s = style ? ' s="' + style + '"' : '';
    if (value == null || value === '') return '<c r="' + ref + '"' + s + '/>';
    if (typeof value === 'number' && Number.isFinite(value)) {
      return '<c r="' + ref + '"' + s + '><v>' + xmlNum(value) + '</v></c>';
    }
    return '<c r="' + ref + '"' + s + ' t="s"><v>' + addString(String(value)) + '</v></c>';
  }
  function patchTableXml(xml, lastData, totals) {
    var out = xml.replace(/(<table\b[^>]*?\s)ref="[^"]+"/, '$1ref="A1:Q' + totals + '"');
    out = out.replace(/<autoFilter ref="[^"]+"\/>/, '<autoFilter ref="A1:Q' + lastData + '"/>');
    out = out.replace(/(<sortState\b[^>]*?\s)ref="[^"]+"/, '$1ref="A2:Q' + lastData + '"');
    out = out.replace(/(<sortCondition\b[^>]*?\s)ref="[^"]+"/, '$1ref="C2:C' + lastData + '"');
    return out;
  }
  function shiftMerges(sheetXml, oldTotals, delta) {
    var block = sheetXml.match(/<mergeCells[\s\S]*?<\/mergeCells>/);
    if (!block) return '';
    var refs = [];
    var re = /ref="([A-Z]+)(\d+):([A-Z]+)(\d+)"/g;
    var m;
    while ((m = re.exec(block[0]))) {
      var r1 = Number(m[2]);
      var r2 = Number(m[4]);
      if (r1 > oldTotals) {
        r1 += delta;
        r2 += delta;
      }
      refs.push(m[1] + r1 + ':' + m[3] + r2);
    }
    if (!refs.length) return '';
    return '<mergeCells count="' + refs.length + '">' + refs.map(function (ref) {
      return '<mergeCell ref="' + ref + '"/>';
    }).join('') + '</mergeCells>';
  }

  async function fillAkyuzWorkbook(templateBuffer, formRows) {
    if (!templateBuffer) throw new Error('Form şablonu yok.');
    if (!formRows || !formRows.length) throw new Error('Forma yazılacak satır yok.');
    var files = await unzipStore(templateBuffer);
    var sstFile = null;
    var sheetFiles = [];
    files.forEach(function (file) {
      if (file.name === 'xl/sharedStrings.xml') sstFile = file;
      else if (/^xl\/worksheets\/sheet\d+\.xml$/.test(file.name)) sheetFiles.push(file);
    });
    if (!sstFile) throw new Error('Form dosyasında metin tablosu yok.');
    var sstXml = new TextDecoder('utf-8').decode(sstFile.data);
    var originalBlocks = parseSiBlocks(sstXml);
    var siTexts = originalBlocks.map(siText);
    var sheetFile = null;
    var sheetXml = '';
    var parsed = [];
    for (var s = 0; s < sheetFiles.length; s++) {
      var xmlTry = new TextDecoder('utf-8').decode(sheetFiles[s].data);
      var rowsTry = parseSheetRows(xmlTry);
      var headerTry = null;
      for (var h = 0; h < rowsTry.length && h < 12; h++) {
        if (isFormHeaderTexts(rowTexts(rowsTry[h].inner, siTexts))) {
          headerTry = rowsTry[h];
          break;
        }
      }
      if (headerTry) {
        sheetFile = sheetFiles[s];
        sheetXml = xmlTry;
        parsed = rowsTry;
        break;
      }
    }
    if (!sheetFile) throw new Error('Sevk bildiri sayfası bulunamadı.');
    var header = null;
    for (var i = 0; i < parsed.length && i < 12; i++) {
      if (isFormHeaderTexts(rowTexts(parsed[i].inner, siTexts))) {
        header = parsed[i];
        break;
      }
    }
    var totals = parsed.find(function (row) {
      return header && row.r > header.r && row.inner.indexOf('SUBTOTAL') >= 0;
    });
    if (!header || !totals) throw new Error('Form başlığı veya toplam satırı bulunamadı.');
    var styleA = parsed.find(function (row) { return row.r === header.r + 1; });
    var styleB = parsed.find(function (row) { return row.r === header.r + 2; });
    if (!styleA || styleA.r >= totals.r) throw new Error('Form satır biçimi bulunamadı.');
    if (!styleB || styleB.r >= totals.r) styleB = styleA;
    var oldMergeEnd = totals.r;
    var mergeBlock = sheetXml.match(/<mergeCells[\s\S]*?<\/mergeCells>/);
    if (mergeBlock) {
      var mend = /:([A-Z]+)(\d+)/g;
      var mm;
      while ((mm = mend.exec(mergeBlock[0]))) oldMergeEnd = Math.max(oldMergeEnd, Number(mm[2]));
    }
    var footer = parsed.filter(function (row) { return row.r > totals.r && row.r <= oldMergeEnd; });
    var used = [];
    var seenIdx = {};
    [header, totals].concat(footer).forEach(function (row) {
      collectStringIdx(row.inner, used, seenIdx);
    });
    var siBlocks = [];
    var oldToNew = {};
    var plainIndex = new Map();
    used.forEach(function (oldIdx) {
      if (!originalBlocks[oldIdx]) return;
      var ni = siBlocks.length;
      oldToNew[oldIdx] = ni;
      siBlocks.push(originalBlocks[oldIdx]);
      var text = siTexts[oldIdx];
      if (!plainIndex.has(text)) plainIndex.set(text, ni);
    });
    function addString(text) {
      var clean = String(text).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
      if (plainIndex.has(clean)) return plainIndex.get(clean);
      var idx = siBlocks.length;
      siBlocks.push(plainSi(clean));
      plainIndex.set(clean, idx);
      return idx;
    }
    var lastData = 1 + formRows.length;
    var newTotals = lastData + 1;
    var delta = newTotals - totals.r;
    var stylesA = extractStyleMap(styleA.inner);
    var stylesB = extractStyleMap(styleB.inner);
    var sum = formRows.reduce(function (acc, row) { return acc + toNumber(row.tonaj); }, 0);
    var body = [];
    body.push('<row r="1"' + header.attrs + '>' + remapStringCells(renumberInner(header.inner, header.r, 1), oldToNew) + '</row>');
    formRows.forEach(function (row, index) {
      var rowNum = index + 2;
      var proto = index % 2 === 0 ? styleA : styleB;
      var styles = index % 2 === 0 ? stylesA : stylesB;
      var values = formValues(row);
      var cells = FORM_COLS.map(function (col) {
        return dataCellXml(col, rowNum, styles[col] || '', values[col], addString);
      }).join('');
      body.push('<row r="' + rowNum + '"' + proto.attrs + '>' + cells + '</row>');
    });
    var totalsInner = remapStringCells(renumberInner(totals.inner, totals.r, newTotals), oldToNew);
    totalsInner = totalsInner.replace(/(<f>[^<]*<\/f>)<v>[^<]*<\/v>/, '$1<v>' + xmlNum(sum) + '</v>');
    body.push('<row r="' + newTotals + '"' + totals.attrs + '>' + totalsInner + '</row>');
    var lastRow = newTotals;
    footer.forEach(function (row) {
      var newR = row.r + delta;
      lastRow = newR;
      var inner = remapStringCells(renumberInner(row.inner, row.r, newR), oldToNew);
      body.push('<row r="' + newR + '"' + row.attrs + '>' + inner + '</row>');
    });
    var dim = 'A1:Q' + lastRow;
    var nextSheet = sheetXml.replace(/<dimension ref="[^"]*"/, '<dimension ref="' + dim + '"');
    nextSheet = nextSheet.replace(/<sheetData>[\s\S]*?<\/sheetData>/, '<sheetData>' + body.join('') + '</sheetData>');
    var mergeXml = shiftMerges(sheetXml, totals.r, delta);
    if (mergeXml) {
      if (nextSheet.indexOf('<mergeCells') >= 0) {
        nextSheet = nextSheet.replace(/<mergeCells[\s\S]*?<\/mergeCells>/, mergeXml);
      } else {
        nextSheet = nextSheet.replace('</sheetData>', '</sheetData>' + mergeXml);
      }
    }
    sheetFile.data = utf8Text(slimSheetXml(nextSheet));
    var sstOpen = (sstXml.match(/<sst\b[^>]*>/) || ['<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'])[0];
    sstOpen = sstOpen.replace(/\scount="\d+"/, '').replace(/\suniqueCount="\d+"/, '');
    sstOpen = sstOpen.replace('<sst', '<sst count="' + siBlocks.length + '" uniqueCount="' + siBlocks.length + '"');
    sstFile.data = utf8Text('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' + sstOpen + siBlocks.join('') + '</sst>');
    var packed = [];
    for (var f = 0; f < files.length; f++) {
      var file = files[f];
      if (file.name.indexOf('printerSettings/') >= 0) continue;
      if (/^xl\/worksheets\/_rels\/sheet\d+\.xml\.rels$/.test(file.name)) {
        var rels = new TextDecoder('utf-8').decode(file.data).replace(/<Relationship\b[^>]*printerSettings[^>]*\/>/g, '');
        file.data = utf8Text(rels);
      } else if (file.name === 'xl/workbook.xml') {
        var bookXml = new TextDecoder('utf-8').decode(file.data).replace(/<definedNames>[\s\S]*?<\/definedNames>/, '');
        file.data = utf8Text(bookXml);
      } else if (/^xl\/tables\/table\d+\.xml$/.test(file.name)) {
        file.data = utf8Text(patchTableXml(new TextDecoder('utf-8').decode(file.data), lastData, newTotals));
      } else if (file.name === 'xl/calcChain.xml') {
        file.data = utf8Text(new TextDecoder('utf-8').decode(file.data).replace(/r="[A-Z]+\d+"/, 'r="F' + newTotals + '"'));
      }
      packed.push(file);
    }
    return zipStore(packed);
  }

  var templatePromise = null;
  function loadAkyuzTemplate() {
    if (typeof fetch !== 'function') return Promise.reject(new Error('Form şablonu yüklenemedi.'));
    if (!templatePromise) {
      templatePromise = fetch('assets/akyuz-sevk-formu.xlsx').then(function (res) {
        if (!res.ok) throw new Error('Akyüz form şablonu bulunamadı.');
        return res.arrayBuffer();
      });
    }
    return templatePromise;
  }

  function downloadBytes(bytes, fileName) {
    var blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = fileName || FORM_OUT_NAME;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 2500);
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
    }
  }

  function bindAppUi(opts) {
    if (typeof document === 'undefined') return;
    if (!document.getElementById('aldPage')) return;
    if (window.__aldAppBound) return;
    window.__aldAppBound = true;
    opts = opts || {};
    var toast = typeof opts.toast === 'function' ? opts.toast : defaultToast;

    var fileInput = document.getElementById('aldFile');
    var drop = document.getElementById('aldDrop');
    var runBtn = document.getElementById('aldRunBtn');
    var downloadBtn = document.getElementById('aldDownloadBtn');
    var keepToday = document.getElementById('aldKeepToday');
    var statusEl = document.getElementById('aldStatus');
    var fileNameEl = document.getElementById('aldFileName');
    var treeEl = document.getElementById('aldTree');
    var countEl = document.getElementById('aldCount');
    if (!runBtn || !downloadBtn || !treeEl) return;

    var state = { file: null, solved: null, mapped: null, templateBuf: null, outName: FORM_OUT_NAME, sheetName: 'AKYÜZ' };

    function setStatus(text, isErr) {
      if (!statusEl) return;
      statusEl.textContent = text || '';
      statusEl.classList.toggle('is-error', !!isErr);
    }

    function renderTable() {
      if (!state.solved || !state.solved.rows.length) {
        treeEl.innerHTML = '<div class="elc-empty">Güncel ihracat listesini bırakın. Düzenle, satırları Akyüz sevk bildiri formuna yazar; Excel indir aynı dosyayı geri verir.</div>';
        if (countEl) countEl.textContent = '0 satır';
        downloadBtn.disabled = true;
        return;
      }
      var rowsHtml = state.solved.rows.map(function (row) {
        return '<div class="elc-row ald-row">' +
          '<span class="elc-row__sira">' + escapeHtml(row.sira) + '</span>' +
          '<span>' + escapeHtml(row.tedarikci) + '</span>' +
          '<span>' + escapeHtml(row.sevkTarih) + '</span>' +
          '<span>' + escapeHtml(row.firma) + '</span>' +
          '<span>' + escapeHtml(row.lot) + '</span>' +
          '<span>' + escapeHtml(displayQty(row.tonaj)) + '</span>' +
          '<span>' + escapeHtml(displayQty(row.birimKg)) + '</span>' +
          '<span>' + escapeHtml(displayQty(row.ambalajSayisi)) + '</span>' +
          '<span>' + escapeHtml(row.ambalajTipi) + '</span>' +
          '<span>' + escapeHtml(displayQty(row.paletSayisi)) + '</span>' +
          '<span>' + escapeHtml(row.liman) + '</span>' +
          '<span>' + escapeHtml(row.yuklemeYeri) + '</span>' +
          '<span>' + escapeHtml(row.bookingNo) + '</span>' +
          '<span>' + escapeHtml(row.gemi) + '</span>' +
          '</div>';
      }).join('');
      treeEl.innerHTML = rowsHtml;
      if (countEl) {
        countEl.textContent = state.solved.rows.length + ' satır' +
          (state.solved.dropped ? ' · ' + state.solved.dropped + ' geçmiş sevk çıkarıldı' : '');
      }
      downloadBtn.disabled = false;
    }

    async function ensureXlsx() {
      if (typeof window.ensureXlsxLoaded === 'function') {
        await window.ensureXlsxLoaded();
      }
      if (typeof window.XLSX === 'undefined' || !window.XLSX.read) {
        throw new Error('Excel okuyucu yüklenemedi.');
      }
    }

    async function runFile() {
      if (!state.file) {
        setStatus('Önce ham Akyüz Excel’ini seçin.', true);
        toast('Önce Excel’i seçin.', true);
        return;
      }
      try {
        runBtn.disabled = true;
        setStatus('Düzenleniyor…');
        await ensureXlsx();
        var buf = await state.file.arrayBuffer();
        var wb = window.XLSX.read(buf, { type: 'array', cellDates: false });
        var grid = workbookToGrid(wb);
        var mapped = mapShipmentGrid(grid, {
          dropToday: !(keepToday && keepToday.checked),
          fillYukleme: true,
          addPaletNote: true
        });
        if (!mapped.ok) {
          setStatus(mapped.error, true);
          toast(mapped.error, true);
          return;
        }
        if (!mapped.rows.length) {
          setStatus('Yazılacak Akyüz satırı kalmadı.', true);
          toast('Yazılacak satır kalmadı.', true);
          return;
        }
        if (mapped.kind === 'guncel') {
          state.templateBuf = await loadAkyuzTemplate();
          state.outName = FORM_OUT_NAME;
        } else {
          state.templateBuf = buf.slice(0);
          state.outName = state.file.name ? state.file.name.replace(/\.xlsm$/i, '.xlsx') : FORM_OUT_NAME;
        }
        state.mapped = mapped;
        state.solved = mapped;
        state.sheetName = sheetNameOf(wb);
        renderTable();
        var note = mapped.removedSuppliers ? ' Diğer firmalar çıkarıldı.' : '';
        setStatus(mapped.rows.length + ' satır forma yazıldı. Excel indir, aynı sevk bildiri dosyasını kaydeder.' + note);
        toast('✅ ' + mapped.rows.length + ' satır düzenlendi.');
      } catch (err) {
        var msg = err && err.message ? err.message : 'Excel düzenlenemedi.';
        setStatus(msg, true);
        toast(msg, true);
      } finally {
        runBtn.disabled = false;
      }
    }

    function setFile(file, autoRun) {
      state.file = file || null;
      state.solved = null;
      state.mapped = null;
      state.templateBuf = null;
      if (fileNameEl) fileNameEl.textContent = file ? file.name : 'Dosya seçilmedi';
      renderTable();
      setStatus(file ? 'Dosya hazır. Düzenleniyor…' : '');
      if (file && autoRun !== false) runFile();
    }

    async function downloadSolved() {
      if (!state.mapped || !state.mapped.rows.length || !state.templateBuf) {
        toast('İndirilecek satır yok.', true);
        return;
      }
      try {
        var bytes = await fillAkyuzWorkbook(state.templateBuf, state.mapped.rows);
        downloadBytes(bytes, state.outName || FORM_OUT_NAME);
        toast('✅ Excel indirildi.');
      } catch (err) {
        var msg = err && err.message ? err.message : 'İndirilemedi.';
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
    }
    runBtn.addEventListener('click', function () { runFile(); });
    downloadBtn.addEventListener('click', function () { downloadSolved(); });
    if (keepToday) {
      keepToday.addEventListener('change', function () {
        if (state.file) runFile();
      });
    }
    renderTable();
  }

  var api = {
    TARGET_HEADERS: TARGET_HEADERS,
    PALET_ARAC_NOTU: PALET_ARAC_NOTU,
    trimStr: trimStr,
    extractUnitKg: extractUnitKg,
    qtyMatchesTonaj: qtyMatchesTonaj,
    shortenTedarikci: shortenTedarikci,
    inferYuklemeYeri: inferYuklemeYeri,
    transformRow: transformRow,
    parseSourceGrid: parseSourceGrid,
    solveGrid: solveGrid,
    mapShipmentGrid: mapShipmentGrid,
    fillAkyuzWorkbook: fillAkyuzWorkbook,
    FATURA_GENPER: FATURA_GENPER,
    FORM_OUT_NAME: FORM_OUT_NAME,
    workbookToGrid: workbookToGrid,
    rowsToAoa: rowsToAoa,
    buildWorkbook: buildWorkbook,
    bindAppUi: bindAppUi
  };

  if (typeof window !== 'undefined') window.AkyuzListe = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : typeof global !== 'undefined' ? global : this);
