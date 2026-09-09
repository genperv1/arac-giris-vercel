// plaka-ayir.js — Plaka Ayırma yapıştırma / şoför-telefon ayrıştırma
(function (root) {
  'use strict';

  var PLATE_RE = /(\d{2})\s*([A-ZÇĞİÖŞÜ]{1,3})\s*(\d{2,5})/i;

  function normalizePlate(s) {
    var m = String(s || '').toUpperCase().match(PLATE_RE);
    return m ? (m[1] + m[2] + m[3]).replace(/\s+/g, '') : null;
  }

  function turkishNormalize(str) {
    return String(str || '').toLowerCase()
      .replace(/ç/g, 'c').replace(/ğ/g, 'g').replace(/ı/g, 'i')
      .replace(/ö/g, 'o').replace(/ş/g, 's').replace(/ü/g, 'u')
      .replace(/[^a-z0-9]/g, '');
  }

  function extractBBT(line) {
    if (/iptal/i.test(line)) return null;
    var bbtMatch = String(line || '').match(/(\d+)\s*BBT/i);
    if (bbtMatch) return parseInt(bbtMatch[1], 10);
    var plateMatch = String(line || '').match(PLATE_RE);
    if (!plateMatch) return null;
    var afterPlate = line.slice(plateMatch.index + plateMatch[0].length);
    var numMatch = afterPlate.match(/(\d+)/);
    if (!numMatch) return null;
    var val = parseInt(numMatch[1], 10);
    return val > 0 && val <= 9999 ? val : null;
  }

  function vehicleDriverLabel(v) {
    if (!v) return '';
    var ad = [v.soforAdi, v.soforSoyadi].filter(Boolean).join(' ').trim();
    if (ad) return ad;
    var ad2 = [v.sofor2Adi, v.sofor2Soyadi].filter(Boolean).join(' ').trim();
    return ad2 || '';
  }

  function vehiclePhone(v) {
    if (!v) return '';
    return String(v.iletisim || v.telefon || v.phone || v.driverPhone || '').trim();
  }

  function phoneDigits(value) {
    var d = String(value || '').replace(/\D/g, '');
    if (d.startsWith('90') && d.length >= 12) d = d.slice(2);
    if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
    return d;
  }

  function extractPhone(text) {
    var chunks = String(text || '').match(/(?:\+90|0)?[\s./-]*5(?:[\s./-]*\d){9}/g) || [];
    for (var i = 0; i < chunks.length; i++) {
      var d = phoneDigits(chunks[i]);
      if (d.length === 10 && d.startsWith('5')) return d;
    }
    return '';
  }

  function formatPhoneDisplay(phone) {
    var d = phoneDigits(phone);
    if (d.length === 10 && d.startsWith('5')) {
      return '0' + d.slice(0, 3) + ' ' + d.slice(3, 6) + ' ' + d.slice(6, 8) + ' ' + d.slice(8, 10);
    }
    return String(phone || '').trim();
  }

  function formatPhoneCopy(phone) {
    var d = phoneDigits(phone);
    return d.length === 10 && d.startsWith('5') ? d : String(phone || '').replace(/\s+/g, ' ').trim();
  }

  function isHeaderLine(line) {
    var n = turkishNormalize(line);
    return n.indexOf('plaka') !== -1 && (n.indexOf('bbt') !== -1 || n.indexOf('sofor') !== -1 || n.indexOf('telefon') !== -1);
  }

  function isPlaceOrJunkName(text) {
    var n = turkishNormalize(text);
    if (!n) return true;
    return /^(avdan|osb|1osb|gelmedi|orhanize|toplam|kalan|iptal|medlog|yilport|net|ton|bbt|cuval|palet|bosbbt|boscuval|akyuz|genper)$/.test(n)
      || /osb$/.test(n)
      || n.indexOf('liman') !== -1
      || n.indexOf('depo') !== -1;
  }

  function looksLikePersonName(text) {
    var s = String(text || '').replace(/\s+/g, ' ').trim();
    if (!s || s.length < 4 || s.length > 60) return false;
    if (extractPhone(s) || normalizePlate(s)) return false;
    if (/^\d+([.,]\d+)?$/.test(s)) return false;
    if (isPlaceOrJunkName(s)) return false;
    if (!/^[A-Za-zÇĞİÖŞÜçğıöşü][A-Za-zÇĞİÖŞÜçğıöşü\s.'’-]*$/.test(s)) return false;
    return s.split(' ').filter(Boolean).length >= 2;
  }

  function nameFromPhoneCell(cell, phone) {
    if (!cell || !phone) return '';
    var namePart = String(cell)
      .replace(/(?:\+90|0)?[\s./-]*5(?:[\s./-]*\d){9}/g, ' ')
      .replace(/[-–—]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return looksLikePersonName(namePart) ? namePart : '';
  }

  function parsePastedLine(line) {
    if (!String(line || '').trim() || /iptal/i.test(line) || isHeaderLine(line)) return null;
    var plate = normalizePlate(line);
    if (!plate) return null;
    var bbt = extractBBT(line);
    if (bbt == null) return null;

    var phone = '';
    var driver = '';
    var cells = String(line).split('\t').map(function (c) {
      return String(c || '').replace(/\s+/g, ' ').trim();
    });
    if (cells.length >= 3) {
      for (var i = 0; i < cells.length; i++) {
        var p = extractPhone(cells[i]);
        var cellDigits = cells[i].replace(/\D/g, '');
        if (!p || cellDigits.length > 12) continue;
        phone = p;
        driver = nameFromPhoneCell(cells[i], p);
        if (!driver) {
          for (var j = i - 1; j >= 0; j--) {
            var prev = cells[j];
            if (!prev) continue;
            if (extractPhone(prev) || normalizePlate(prev) || /^\d+([.,]\d+)?$/.test(prev)) continue;
            if (looksLikePersonName(prev)) driver = prev;
            break;
          }
        }
        break;
      }
    }
    if (!phone) phone = extractPhone(line);
    if (!driver && phone) driver = nameFromPhoneCell(line, phone);

    var excelFromPlaka = null;
    var plateIdx = -1;
    for (var c = 0; c < cells.length; c++) {
      if (normalizePlate(cells[c]) && String(cells[c] || '').length < 20) {
        plateIdx = c;
        break;
      }
    }
    if (plateIdx >= 0 && cells.length - plateIdx >= 10) {
      excelFromPlaka = cells.slice(plateIdx, plateIdx + 15);
      while (excelFromPlaka.length < 15) excelFromPlaka.push('');
    }

    return {
      plate: plate,
      bbt: bbt,
      registered: null,
      vehicle: null,
      driver: driver,
      phone: phone,
      excelFromPlaka: excelFromPlaka
    };
  }

  function cleanCopyCell(value) {
    return String(value == null ? '' : value).replace(/\t/g, ' ').replace(/\r?\n/g, ' ').trim();
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /** Tek sütun (plaka / bbt) veya şoför+telefon (yan yana). */
  function buildColumnCopyText(rows, kind) {
    return (rows || []).map(function (row) {
      if (kind === 'plate') return cleanCopyCell(row && row.plate);
      if (kind === 'bbt') {
        return row && row.bbt != null && row.bbt !== '' ? String(row.bbt) : '';
      }
      if (kind === 'driver') {
        return [
          cleanCopyCell(row && row.driver),
          formatPhoneCopy(row && row.phone) || ''
        ].join('\t');
      }
      return '';
    }).join('\r\n');
  }

  function excelCopyCells(row) {
    return [
      cleanCopyCell(row && row.driver),
      formatPhoneCopy(row && row.phone) || ''
    ];
  }

  function buildExcelCopyRow(row) {
    return excelCopyCells(row).join('\t');
  }

  function buildExcelCopyText(rows) {
    return (rows || []).map(buildExcelCopyRow).join('\r\n');
  }

  function buildExcelCopyHtml(rows) {
    var body = (rows || []).map(function (row) {
      var tds = excelCopyCells(row).map(function (c) {
        return '<td>' + escapeHtml(c) + '</td>';
      }).join('');
      return '<tr>' + tds + '</tr>';
    }).join('');
    return '<html><body><table>' + body + '</table></body></html>';
  }

  var api = {
    PLATE_RE: PLATE_RE,
    normalizePlate: normalizePlate,
    turkishNormalize: turkishNormalize,
    extractBBT: extractBBT,
    vehicleDriverLabel: vehicleDriverLabel,
    vehiclePhone: vehiclePhone,
    phoneDigits: phoneDigits,
    extractPhone: extractPhone,
    formatPhoneDisplay: formatPhoneDisplay,
    formatPhoneCopy: formatPhoneCopy,
    parsePastedLine: parsePastedLine,
    excelCopyCells: excelCopyCells,
    buildColumnCopyText: buildColumnCopyText,
    buildExcelCopyRow: buildExcelCopyRow,
    buildExcelCopyText: buildExcelCopyText,
    buildExcelCopyHtml: buildExcelCopyHtml
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) {
    root.PlakaAyir = api;
    Object.keys(api).forEach(function (key) {
      if (typeof root[key] === 'undefined') root[key] = api[key];
    });
  }
})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this));
