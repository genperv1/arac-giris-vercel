// Arşiv indirişi: amir sevkiyatı kapatınca örnek ihracat takip listesinin aynısı.
// Sol tablo sevkiyat, sağ tablo aynı satırlara formülle bağlı kantar dökümü.
(function (root) {
  'use strict';

  var COL_COUNT = 36;
  var WIDTHS = [
    21.57, 7, 16.14, 11.43, 11, 11, 11, 13.57, 13.86, 15, 15.71, 13.86, 13,
    20.57, 24.43, 25.29, 21.86, 24.71, 27.29, 19.57, 3.71, 12.14, 13.86, 17.29,
    16.29, 12.29, 5.29, 8.14, 7.43, 9.71, 12.57, 17.57, 33.71, 26.57, 28.29, 28,
  ];
  var WARN = 'SEVKİYATLARDA DİKKAT EDİLECEK HUSUSLAR :\n\n'
    + ' - SEVKİYATLARDA VERİLECEK OLAN BOŞ BBT\'LER ARAÇ SAYISININ YARISI KADAR, ARAÇ BAŞI 1 ADET OLACAK ŞEKİLDE AYARLANMALIDIR. (ÖRN. : SEVKİYAT 20 ARAÇ - 10 ARACA - 10 BOŞ BBT)\n'
    + ' - SEVKİYAT FOTOLARI ÇEKİLİRKEN MUTLAKA ETİKET, BARKOD, ARACIN TAM DOLU HALİ, (PALET VARSA) PALET SAYISI SAYILABİLEN FOTO OLACAK ŞEKİLDE ÇEKİLMELİDİR.\n'
    + ' - KONTEYNER SEVKİYATLARINDA MUTLAKA "SIFIRA SIFIR SEVKİYAT" GERÇEKLEŞTİRİLMELİ, BOŞ BBT ASLA KOYULMAMALIDIR.';

  function xmlEsc(value) {
    return String(value == null ? '' : value)
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function clip(value) {
    return String(value == null ? '' : value).replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, ' ').trim();
  }

  function colLetter(index) {
    var n = index + 1;
    var s = '';
    while (n > 0) {
      var m = (n - 1) % 26;
      s = String.fromCharCode(65 + m) + s;
      n = Math.floor((n - 1) / 26);
    }
    return s;
  }

  function sheetName(day) {
    var name = String((day && (day.label || day.dateKey)) || 'Liste').replace(/[\\/*?:\[\]]/g, ' ').trim();
    return (name || 'Liste').slice(0, 31);
  }

  function qty(value) {
    var s = String(value == null ? '' : value).trim().replace(/\s/g, '');
    if (!s) return null;
    if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
    else s = s.replace(',', '.');
    if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
    var n = Number(s);
    if (!Number.isFinite(n) || n === 0) return null;
    return n;
  }

  function dateSerial(value) {
    var m = String(value == null ? '' : value).trim().match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})(?:\s+(\d{1,2}):(\d{2}))?/);
    if (!m) return null;
    var utc = Date.UTC(+m[3], +m[2] - 1, +m[1], m[4] != null ? +m[4] : 0, m[5] != null ? +m[5] : 0);
    var epoch = Date.UTC(1899, 11, 30);
    var serial = (utc - epoch) / 86400000;
    return Number.isFinite(serial) ? Math.round(serial * 1440) / 1440 : null;
  }

  function ydTagOf(block) {
    var title = clip(block && block.title);
    var m = title.match(/\b(YD\d{1,4})\s*(\([A-Za-z]\))?/i);
    if (m) return m[1].toUpperCase() + (m[2] ? m[2].toUpperCase() : '');
    return clip(block && block.yd).toUpperCase();
  }

  function ydCodeOf(block) {
    var tag = ydTagOf(block);
    return tag.replace(/\(.*/, '');
  }

  function lotShortOf(block) {
    var tag = ydTagOf(block);
    var lot = clip(block && block.lot);
    if (!lot) {
      var m = clip(block && block.title).match(/LOT\s*NO\s*(\d{2}(?:\s+\d{2}){0,4})/i);
      lot = m ? m[1].trim() : '';
    }
    if (tag && lot) return tag + ' / LOT NO ' + lot;
    return tag || lot;
  }

  function unitKgOf(block) {
    var m = clip(block && block.title).match(/NET\s*(\d{3,4})\s*KG/i);
    return m ? Number(m[1]) : null;
  }

  function materialOf(block) {
    var title = clip(block && block.title);
    var matches = title.match(/HP\s+\d(?:[\d.,=\-]\s*)*\d/gi) || [];
    var spaced = matches.filter(function (s) { return /\s/.test(s.replace(/^HP/i, '')); });
    var picked = spaced[0] || matches[0] || '';
    return picked.replace(/\s+/g, ' ').trim();
  }

  function fieldOf(block, key, pattern) {
    var direct = clip(block && block[key]);
    if (direct) return direct;
    var m = clip(block && block.title).match(pattern);
    return m ? m[1].trim() : '';
  }

function usableDolum(value) {
  var s = clip(value).replace(/^L[İI]MAN\s*DOLUM\s*TAR[İI]H[İI]\s*[:.]?\s*/i, '').trim();
  if (!s || /S\.?\s*TAR/i.test(s)) return '';
  return s;
}

function exportLineOf(block) {
  var saved = String(block && block.exportLine || '').replace(/\s*\n\s*/g, ' ').trim();
  if (saved && !/S\.?\s*TAR/i.test(saved)) return saved;
  var sip = clip(block && block.sip);
  var dolum = usableDolum(block && block.dolum);
  var mid = 'EXPORT REF NO : 0' + (sip ? ' / NETSIS SİPARİŞ NO : ' + sip : '');
  var line = '-------------   ' + mid + '   -------------';
  if (dolum) line += '   LİMAN DOLUM TARİHİ : ' + dolum;
  return line;
}

  function rowText(value, style) {
    return { v: value == null ? '' : String(value), s: style || 0 };
  }

  function rowNum(value, style) {
    return { v: value, s: style || 0, n: true };
  }

  function rowFormula(formula, style) {
    return { f: formula, s: style || 0 };
  }

  function blankRow(height) {
    return { h: height || 0, cells: new Array(COL_COUNT) };
  }

  function put(rec, col, cell) {
    rec.cells[col] = cell;
  }

  function band(rec, from, to, style) {
    for (var c = from; c <= to; c++) {
      if (!rec.cells[c]) rec.cells[c] = rowText('', style);
    }
  }

  function kesilecekFormula(titleRow) {
    var b = 'B' + titleRow;
    return 'IF((MID(' + b + ',((FIND("(",' + b + ')+1)),((FIND(")",' + b + '))-((FIND("(",' + b + ')+1)))))="M","MADENCİLİK KESİLECEK","GENLEŞMİŞ KESİLECEK")';
  }

  function faturaFormula(titleRow) {
    var b = 'B' + titleRow;
    return 'IF((MID(' + b + ',((FIND("(",' + b + ')+1)),((FIND(")",' + b + '))-((FIND("(",' + b + ')+1)))))="M","GENPER MADENCİLİK TİC.A.Ş.","GENPER GENLEŞTİRİLMİŞ PERLİT SAN.TİC.A.Ş.")';
  }

  function dikkatFormula(titleRow, headerRow) {
    var m = 'M' + headerRow;
    return 'IF(OR(' + m + '="HP 0.074-0.30",' + m + '="HP 0,074-0,30",' + m + '="HP 0.074=0,30",' + m + '="HP 0,074-0.30",(LEFT(B' + titleRow + ',4)="YD33")),"DİKKAT!!!","")';
  }

  function netFormula(dataRow, headerRow) {
    return '(D' + dataRow + '*$B$' + headerRow + ')+($B$' + headerRow + '*E' + dataRow + ')';
  }

  function ogrFormula(dataRow, headerRow) {
    var h = headerRow;
    var d = 'D' + dataRow;
    var e = 'E' + dataRow;
    var f = 'F' + dataRow;
    var g = 'G' + dataRow;
    var hh = 'H' + dataRow;
    var flag = 'IF(OR($M$' + h + '="HP0.074-0.30",$M$' + h + '="HP0,074-0,30",$M$' + h + '="HP0.074=0,30",$M$' + h + '="HP0,074-0.30",($A$' + h + '="YD33")),"DİKKAT!!!","")';
    var both = 'AND(' + flag + '="DİKKAT!!!",OR($A$' + h + '="YD92",$A$' + h + '="YD33"))';
    return 'MROUND((IF(' + both + ',(($B$' + h + '+3)*' + d + '),(($B$' + h + '+2)*' + d + '))+(($B$' + h + '+0.11)*' + e + ')+(' + f + '*20)+IF(' + both + ',(' + g + '*3),(' + g + '*2))+(' + hh + '*0.11)),20)';
  }

  function buildRows(day) {
    var rows = [];
    var merges = [];
    function add(rec) {
      rows.push(rec);
      return rows.length;
    }
    function merge(r0, c1, c2, r1) {
      merges.push({ r: r0, r2: r1 == null ? r0 : r1, c1: c1, c2: c2 });
    }

    var top = blankRow(28.5);
    put(top, 1, rowFormula('\"S.TARİHİ: \"&MID(CELL(\"DOSYAADI\",A1),SEARCH(\"]\",CELL(\"DOSYAADI\",A1))+1,255)', 2));
    put(top, 4, rowText('İHRACAT TAKİP LİSTESİ', 1));
    put(top, 10, rowNum(0, 43));
    add(top);
    merge(0, 1, 3);
    merge(0, 4, 9);
    merge(0, 10, 12);

    var printed = blankRow(15);
    put(printed, 10, rowFormula('\"ÇIKTI TARİHİ: \"&TEXT(TODAY(),\"GG.AA.YYYY\")', 3));
    put(printed, 12, rowFormula('NOW()', 4));
    add(printed);
    merge(1, 10, 11);

    var warn = blankRow(35.25);
    put(warn, 1, rowText(WARN, 5));
    add(warn);
    add(blankRow(35.25));
    merge(2, 1, 12, 3);
    add(blankRow(15));
    add(blankRow(15));

    var blocks = (day && day.blocks) || [];
    blocks.forEach(function (block, bi) {
      if (bi) add(blankRow(15));
      var titleRec = blankRow(75);
      var titleRow = add(titleRec);
      var exportRec = blankRow(12);
      var exportRow = add(exportRec);
      var export2 = blankRow(12);
      add(export2);
      var tolRec = blankRow(18.75);
      var tolRow = add(tolRec);
      var tol2 = blankRow(18.75);
      add(tol2);
      var head = blankRow(21);
      var headerRow = add(head);

      var tag = ydTagOf(block);
      var code = ydCodeOf(block);
      var lot = lotShortOf(block);
      var unit = unitKgOf(block);
      var material = materialOf(block);
      var carrier = clip(block.tasiyici);
      var booking = fieldOf(block, 'booking', /BOOKING\s*NO\s*:\s*([^/]+)/i);
      var port = clip(block.liman || block.port) || fieldOf(block, 'liman', /(EVYAP|SAF[İI]PORT|Y[İI]LPORT|MARPORT|KUMPORT|DP\s*WORLD|GEML[İI]K)/i);
      var ship = fieldOf(block, 'gemi', /GEM[İI]\s*DETAYI\s*:\s*([^/]+)/i);

      put(titleRec, 0, rowText(carrier, 6));
      put(titleRec, 1, rowText(clip(block.title) || tag, 7));
      put(titleRec, 13, rowText(lot, 8));
      put(titleRec, 14, rowText(booking, 8));
      put(titleRec, 15, rowText(port, 8));
      put(titleRec, 16, rowText(ship, 8));
      put(titleRec, 17, rowText(carrier, 8));
      put(titleRec, 18, rowText('TEDARİKÇİYE GÖNDERİLDİ Mİ?', 9));
      put(titleRec, 19, rowText('PERFORMANSA İŞLENDİ Mİ?', 9));
      merge(titleRow - 1, 1, 12);

      put(exportRec, 1, rowText(exportLineOf(block), 10));
      merge(exportRow - 1, 1, 12, exportRow);
      merge(exportRow - 1, 18, 18, exportRow);
      merge(exportRow - 1, 19, 19, exportRow);

      put(tolRec, 1, rowNum(0, 44));
      put(tolRec, 13, rowText('MAX. ARTI TOLERANS', 44));
      var tolerans = clip(block.tolerans).replace(/^\+/, '');
      if (tolerans) put(tol2, 13, rowText('+' + tolerans, 30));
      merge(tolRow - 1, 1, 12, tolRow);

      put(head, 0, rowText(code, 13));
      if (unit != null) put(head, 1, rowNum(unit, 12));
      ['PLAKA', 'BBT', 'ÇUVAL', 'PALET', 'BOŞ BBT', 'BOŞ ÇUVAL', 'NET TONAJ', 'O.GR. TONAJ', 'GİDEN TONAJ', 'FARK'].forEach(function (label, i) {
        put(head, 2 + i, rowText(label, 11));
      });
      put(head, 12, rowText(material, 14));
      put(head, 14, rowText('YÜKLEME YERİ', 15));
      put(head, 15, rowText('ŞOFÖR ADI SOYADI', 16));
      put(head, 16, rowText('TELEFON', 16));
      put(head, 17, rowText('KANTAR GİRİŞ', 16));
      put(head, 18, rowText('KANTAR ÇIKIŞ', 16));
      band(head, 0, 19, 11);

      put(titleRec, 21, rowText('FİRMA/LOT', 40));
      put(titleRec, 22, rowFormula('N' + titleRow, 42));
      put(titleRec, 24, rowText('FATURA BAŞLIĞI', 40));
      put(titleRec, 27, rowFormula(faturaFormula(titleRow), 41));
      merge(titleRow - 1, 22, 23);
      merge(titleRow - 1, 24, 26);
      merge(titleRow - 1, 27, 32);
      merge(titleRow - 1, 33, 35);
      put(exportRec, 21, rowText('LİMAN', 40));
      put(exportRec, 22, rowFormula('P' + titleRow, 42));
      merge(exportRow - 1, 22, 23);
      put(export2, 21, rowText('GEMİ DETAYI', 40));
      put(export2, 22, rowFormula('Q' + titleRow, 42));
      merge(exportRow, 22, 23);
      put(tolRec, 21, rowText('BOOKING', 40));
      put(tolRec, 22, rowFormula('O' + titleRow, 42));
      merge(tolRow - 1, 22, 23);
      put(tol2, 21, rowText('SEVK.TARİHİ', 40));
      put(tol2, 22, rowFormula('B1', 42));
      merge(tolRow, 22, 23);

      [
        ['SIRANO', 33], ['PLAKA', 33], ['İRSALİYE NO', 33], ['MALIN CİNSİ', 33], ['TONAJ(KG)', 33], ['BBT', 33],
        ['ÇUVAL', 34], ['PALET', 34], ['BOŞ BBT', 34], ['BOŞ ÇUVAL', 34],
        ['FİİLİ SEVK TARİHİ', 35], ['ŞOFÖR BİLGİLERİ', 35],
        ['BİRİM AMBALAJ AĞIRLIĞI', 34],
        ['KANTAR GİRİŞ', 35], ['KANTAR ÇIKIŞ', 35],
      ].forEach(function (pair, i) {
        put(head, 21 + i, rowText(pair[0], pair[1]));
      });

      var body = block.rows || [];
      var firstData = 0;
      var lastData = 0;
      body.forEach(function (src) {
        var rec = blankRow(30);
        var dataRow = add(rec);
        if (!firstData) firstData = dataRow;
        lastData = dataRow;
        band(rec, 0, 19, 18);
        band(rec, 21, 35, 36);
        var irs = clip(src.irsaliye || src.irsaliyeNo);
        var sira = qty(src.sira);
        var plaka = clip(src.plaka);
        var giden = qty(src.giden != null && src.giden !== '' ? src.giden : src.gidenTonaj);
        var giris = dateSerial(src.kantarGiris);
        var cikis = dateSerial(src.kantarCikis);
        put(rec, 0, rowText(irs, 17));
        if (sira != null) put(rec, 1, rowNum(sira, 19));
        put(rec, 2, rowText(plaka, 18));
        [
          ['bbt', 3], ['cuval', 4], ['palet', 5], ['bosBbt', 6], ['bosCuval', 7],
        ].forEach(function (pair) {
          var n = qty(src[pair[0]]);
          if (n != null) put(rec, pair[1], rowNum(n, 18));
        });
        put(rec, 8, rowFormula(netFormula(dataRow, headerRow), 20));
        put(rec, 9, rowFormula(ogrFormula(dataRow, headerRow), 20));
        if (giden != null) put(rec, 10, rowNum(giden, 21));
        put(rec, 11, rowFormula('IF(K' + dataRow + '="","",K' + dataRow + '-J' + dataRow + ')', 22));
        put(rec, 14, rowText(clip(src.yukleme || src.yuklemeYeri), 23));
        put(rec, 15, rowText(clip(src.sofor), 24));
        var tel = clip(src.telefon).replace(/\s+/g, '');
        if (/^\d{7,15}$/.test(tel)) put(rec, 16, rowNum(Number(tel), 24));
        else put(rec, 16, rowText(clip(src.telefon), 24));
        if (giris != null) put(rec, 17, rowNum(giris, 25));
        else if (clip(src.kantarGiris)) put(rec, 17, rowText(clip(src.kantarGiris), 24));
        if (cikis != null) put(rec, 18, rowNum(cikis, 25));
        else if (clip(src.kantarCikis)) put(rec, 18, rowText(clip(src.kantarCikis), 24));

        put(rec, 21, rowFormula('B' + dataRow, 36));
        put(rec, 22, rowFormula('C' + dataRow, 36));
        put(rec, 23, rowFormula('A' + dataRow, 36));
        put(rec, 24, rowFormula('M' + headerRow, 36));
        put(rec, 25, rowFormula('K' + dataRow, 37));
        put(rec, 26, rowFormula('D' + dataRow, 36));
        put(rec, 27, rowFormula('E' + dataRow, 36));
        put(rec, 28, rowFormula('F' + dataRow, 36));
        put(rec, 29, rowFormula('G' + dataRow, 36));
        put(rec, 30, rowFormula('H' + dataRow, 36));
        put(rec, 31, rowFormula('IF(S' + dataRow + '="","",S' + dataRow + ')', 45));
        put(rec, 32, rowFormula('IF(W' + dataRow + '=0,"",IF(S' + dataRow + '="","GELMEDİ",(P' + dataRow + '&"-"&Q' + dataRow + ')))', 36));
        put(rec, 33, rowFormula('Z' + dataRow + '/AA' + dataRow, 38));
        put(rec, 34, rowFormula('IF(R' + dataRow + '="","",R' + dataRow + ')', 39));
        put(rec, 35, rowFormula('IF(S' + dataRow + '="","",S' + dataRow + ')', 39));
      });

      var toplam = blankRow(26.25);
      var toplamRow = add(toplam);
      band(toplam, 1, 12, 27);
      put(toplam, 0, rowFormula(kesilecekFormula(titleRow), 29));
      put(toplam, 1, rowText('TOPLAM', 27));
      merge(toplamRow - 1, 1, 2);
      if (firstData) {
        for (var c = 3; c <= 12; c++) {
          var letter = colLetter(c);
          put(toplam, c, rowFormula('SUM(' + letter + firstData + ':' + letter + lastData + ')', 28));
        }
      }
      put(toplam, 34, rowText('ORTALAMA', 16));
      merge(toplamRow - 1, 34, 35);

      var kalan = blankRow(21);
      var kalanRow = add(kalan);
      band(kalan, 1, 7, 31);
      put(kalan, 0, rowFormula(dikkatFormula(titleRow, headerRow), 30));
      put(kalan, 1, rowText('KALAN', 31));
      merge(kalanRow - 1, 1, 2);
      if (firstData) {
        for (var k = 3; k <= 7; k++) {
          var col = colLetter(k);
          put(kalan, k, rowFormula(
            col + toplamRow + '-(' + col + toplamRow + '-SUMIFS(' + col + firstData + ':' + col + lastData + ',$K' + firstData + ':$K' + lastData + ',""))',
            32
          ));
        }
      }
    });

    if (!rows.length) add(blankRow(21));
    return { rows: rows, merges: merges };
  }

  function cellXml(ref, cell) {
    if (!cell) return '';
    var style = cell.s || 0;
    if (cell.f) return '<c r="' + ref + '" s="' + style + '"><f>' + xmlEsc(cell.f) + '</f></c>';
    if (cell.n) return '<c r="' + ref + '" s="' + style + '"><v>' + cell.v + '</v></c>';
    var text = xmlEsc(cell.v);
    if (!text && !style) return '';
    if (!text) return '<c r="' + ref + '" s="' + style + '"/>';
    return '<c r="' + ref + '" t="inlineStr" s="' + style + '"><is><t xml:space="preserve">' + text + '</t></is></c>';
  }

  function worksheetXml(grid) {
    var cols = WIDTHS.map(function (w, i) {
      return '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + w + '" customWidth="1"/>';
    }).join('');
    var body = grid.rows.map(function (row, r) {
      var n = r + 1;
      var ht = row.h ? ' ht="' + row.h + '" customHeight="1"' : '';
      var cells = row.cells.map(function (cell, c) {
        return cellXml(colLetter(c) + n, cell);
      }).join('');
      return '<row r="' + n + '"' + ht + '>' + cells + '</row>';
    }).join('');
    var merge = '';
    if (grid.merges.length) {
      merge = '<mergeCells count="' + grid.merges.length + '">' + grid.merges.map(function (m) {
        var r1 = m.r + 1;
        var r2 = (m.r2 == null ? m.r : m.r2) + 1;
        return '<mergeCell ref="' + colLetter(m.c1) + r1 + ':' + colLetter(m.c2) + r2 + '"/>';
      }).join('') + '</mergeCells>';
    }
    var lastRow = Math.max(grid.rows.length, 1);
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<dimension ref="A1:' + colLetter(COL_COUNT - 1) + lastRow + '"/>' +
      '<sheetViews><sheetView zoomScale="80" zoomScaleNormal="80" workbookViewId="0"/></sheetViews>' +
      '<sheetFormatPr defaultRowHeight="15"/>' +
      '<cols>' + cols + '</cols>' +
      '<sheetData>' + body + '</sheetData>' +
      merge +
      '</worksheet>';
  }

  function arialFont(size, bold, color) {
    return '<font>' + (bold ? '<b/>' : '') + '<sz val="' + size + '"/>' +
      (color ? '<color rgb="' + color + '"/>' : '') + '<name val="Arial"/></font>';
  }

  function xf(fontId, fillId, borderId, numFmtId, align, wrap, vertical) {
    var flags = ' applyFont="1" applyAlignment="1"';
    if (fillId) flags += ' applyFill="1"';
    if (borderId) flags += ' applyBorder="1"';
    if (numFmtId) flags += ' applyNumberFormat="1"';
    return '<xf numFmtId="' + (numFmtId || 0) + '" fontId="' + fontId + '" fillId="' + (fillId || 0) + '" borderId="' + (borderId || 0) + '"' + flags + '>' +
      '<alignment horizontal="' + (align || 'center') + '" vertical="' + (vertical || 'center') + '"' + (wrap ? ' wrapText="1"' : '') + '/></xf>';
  }

  var STYLE_FONTS = [
    '<font><sz val="11"/><name val="Calibri"/></font>',
    arialFont(18, true),
    arialFont(14, true),
    arialFont(12, true),
    arialFont(10, false),
    arialFont(12, true, 'FFFF0000'),
    arialFont(16, true),
    arialFont(9, true, 'FFFF0000'),
    arialFont(14, false, 'FFFF0000'),
    arialFont(11, false),
    arialFont(11, true),
    arialFont(16, true, 'FFC00000'),
    arialFont(16, false),
    arialFont(14, true),
    arialFont(14, false),
    arialFont(18, false),
    arialFont(10, true),
    arialFont(11, true, 'FFFF0000'),
    arialFont(12, false),
  ];

  var STYLE_XFS = [
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>',
    xf(1, 0, 0, 0, 'center'),
    xf(2, 0, 0, 0, 'left'),
    xf(3, 0, 0, 0, 'center'),
    xf(3, 0, 0, 168, 'center'),
    xf(4, 0, 0, 0, 'left', true, 'top'),
    xf(5, 0, 1, 0, 'center', true),
    xf(6, 0, 0, 0, 'center', true),
    xf(7, 0, 0, 0, 'center', true),
    xf(8, 0, 0, 0, 'center', true),
    xf(5, 0, 0, 0, 'center', true),
    xf(9, 0, 2, 0, 'center'),
    xf(9, 2, 2, 0, 'center'),
    xf(3, 0, 2, 0, 'center'),
    xf(9, 0, 2, 0, 'left'),
    xf(11, 0, 2, 0, 'center'),
    xf(10, 0, 2, 0, 'center'),
    xf(13, 0, 1, 0, 'center', true),
    xf(14, 0, 1, 0, 'center'),
    xf(9, 0, 1, 0, 'center'),
    xf(6, 3, 1, 164, 'center'),
    xf(12, 0, 1, 164, 'center'),
    xf(12, 4, 1, 164, 'center'),
    xf(11, 0, 1, 0, 'center'),
    xf(9, 0, 1, 0, 'center'),
    xf(9, 0, 1, 165, 'center'),
    xf(9, 0, 1, 0, 'center'),
    xf(1, 2, 2, 0, 'center'),
    xf(15, 2, 2, 164, 'center'),
    xf(16, 0, 2, 0, 'center', true),
    xf(11, 0, 2, 0, 'center', true),
    xf(3, 5, 2, 0, 'center'),
    xf(18, 5, 2, 164, 'center'),
    xf(3, 0, 2, 0, 'center'),
    xf(3, 2, 2, 0, 'center'),
    xf(5, 0, 2, 0, 'center'),
    xf(3, 0, 2, 0, 'center'),
    xf(3, 0, 2, 164, 'center'),
    xf(3, 2, 2, 166, 'center'),
    xf(3, 2, 2, 165, 'center'),
    xf(16, 0, 0, 0, 'right'),
    xf(17, 0, 0, 0, 'left'),
    xf(10, 0, 0, 0, 'left'),
    xf(2, 0, 0, 169, 'center'),
    xf(10, 0, 0, 0, 'center'),
    xf(3, 0, 2, 165, 'center'),
  ];

  var STYLES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<numFmts count="5">' +
    '<numFmt numFmtId="164" formatCode="#,##0"/>' +
    '<numFmt numFmtId="165" formatCode="[$-41F]d\\ mmmm\\ yyyy\\ h:mm;;"/>' +
    '<numFmt numFmtId="166" formatCode="0"/>' +
    '<numFmt numFmtId="168" formatCode="hh:mm"/>' +
    '<numFmt numFmtId="169" formatCode="&quot;REVİZYON NO : &quot;#"/>' +
    '</numFmts>' +
    '<fonts count="' + STYLE_FONTS.length + '">' + STYLE_FONTS.join('') + '</fonts>' +
    '<fills count="6">' +
    '<fill><patternFill patternType="none"/></fill>' +
    '<fill><patternFill patternType="gray125"/></fill>' +
    '<fill><patternFill patternType="solid"><fgColor rgb="FFFFFF00"/></patternFill></fill>' +
    '<fill><patternFill patternType="solid"><fgColor rgb="FFFBE5D6"/></patternFill></fill>' +
    '<fill><patternFill patternType="solid"><fgColor rgb="FFDBDBDB"/></patternFill></fill>' +
    '<fill><patternFill patternType="solid"><fgColor rgb="FFFFF2CC"/></patternFill></fill>' +
    '</fills>' +
    '<borders count="3"><border/>' +
    '<border><left style="thin"/><right style="thin"/><top style="thin"/><bottom style="thin"/></border>' +
    '<border><left style="medium"/><right style="medium"/><top style="medium"/><bottom style="medium"/></border>' +
    '</borders>' +
    '<cellXfs count="' + STYLE_XFS.length + '">' + STYLE_XFS.join('') + '</cellXfs></styleSheet>';

  function workbookXml(name) {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<sheets><sheet name="' + xmlEsc(name) + '" sheetId="1" r:id="rId1"/></sheets>' +
      '<calcPr fullCalcOnLoad="1"/>' +
      '</workbook>';
  }

  function crc32(bytes) {
    var table = crc32.table;
    if (!table) {
      table = new Uint32Array(256);
      for (var n = 0; n < 256; n++) {
        var c = n;
        for (var k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
        table[n] = c >>> 0;
      }
      crc32.table = table;
    }
    var crc = 0xffffffff;
    for (var i = 0; i < bytes.length; i++) crc = table[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }

  function u16(n) { return [n & 255, (n >>> 8) & 255]; }
  function u32(n) { return [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255]; }

  function zipStore(files) {
    var parts = [];
    var central = [];
    var offset = 0;
    files.forEach(function (file) {
      var name = new TextEncoder().encode(file.name);
      var data = file.data;
      var crc = crc32(data);
      var local = u32(0x04034b50).concat(u16(20), u16(0), u16(0), u16(0), u16(0), u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0));
      parts.push(new Uint8Array(local), name, data);
      var cen = u32(0x02014b50).concat(u16(20), u16(20), u16(0), u16(0), u16(0), u16(0), u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset));
      central.push(new Uint8Array(cen), name);
      offset += local.length + name.length + data.length;
    });
    var centralStart = offset;
    var centralSize = central.reduce(function (n, part) { return n + part.length; }, 0);
    var end = new Uint8Array(u32(0x06054b50).concat(u16(0), u16(0), u16(files.length), u16(files.length), u32(centralSize), u32(centralStart), u16(0)));
    var all = parts.concat(central, [end]);
    var total = all.reduce(function (n, part) { return n + part.length; }, 0);
    var out = new Uint8Array(total);
    var at = 0;
    all.forEach(function (part) { out.set(part, at); at += part.length; });
    return out;
  }

  function utf8(text) {
    return new TextEncoder().encode(text);
  }

  function buildArchiveWorkbook(day) {
    var grid = buildRows(day || {});
    var name = sheetName(day);
    var files = [
      { name: '[Content_Types].xml', data: utf8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        '</Types>') },
      { name: '_rels/.rels', data: utf8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
        '</Relationships>') },
      { name: 'xl/workbook.xml', data: utf8(workbookXml(name)) },
      { name: 'xl/_rels/workbook.xml.rels', data: utf8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
        '</Relationships>') },
      { name: 'xl/styles.xml', data: utf8(STYLES) },
      { name: 'xl/worksheets/sheet1.xml', data: utf8(worksheetXml(grid)) },
    ];
    return zipStore(files);
  }

  var api = { buildArchiveWorkbook: buildArchiveWorkbook, buildRows: buildRows };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.LimanXlsx = api;
})(typeof window !== 'undefined' ? window : globalThis);
