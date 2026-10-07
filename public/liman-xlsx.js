// Arşiv indirişi: HTML değil, Excel'in açtığı gerçek .xlsx tablosu.
(function (root) {
  'use strict';

  var COLS = [
    { key: 'irsaliye', alt: 'irsaliyeNo', head: 'İRSALİYE', w: 16, s: 2 },
    { key: 'sira', head: 'SIRANO', w: 10, s: 2, num: true },
    { key: 'plaka', head: 'PLAKA', w: 14, s: 3 },
    { key: 'bbt', head: 'BBT', w: 10, s: 2, num: true },
    { key: 'cuval', head: 'ÇUVAL', w: 10, s: 2, num: true },
    { key: 'palet', head: 'PALET', w: 10, s: 2, num: true },
    { key: 'bosBbt', head: 'BOŞ BBT', w: 12, s: 2, num: true },
    { key: 'bosCuval', head: 'BOŞ ÇUVAL', w: 12, s: 2, num: true },
    { key: 'net', alt: 'netTonaj', head: 'NET TONAJ', w: 14, s: 4, num: true },
    { key: 'giden', alt: 'gidenTonaj', head: 'GİDEN TONAJ', w: 14, s: 4, num: true },
    { key: 'yukleme', alt: 'yuklemeYeri', head: 'YÜKLEME YERİ', w: 16, s: 5 },
    { key: 'sofor', head: 'ŞOFÖR ADI SOYADI', w: 24, s: 6 },
    { key: 'telefon', head: 'TELEFON', w: 16, s: 7 },
    { key: 'kantarCikis', head: 'KANTAR ÇIKIŞ', w: 16, s: 2 },
  ];

  function xmlEsc(value) {
    return String(value == null ? '' : value)
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function numOf(value) {
    var s = String(value == null ? '' : value).trim().replace(/\s/g, '').replace(',', '.');
    if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
    var n = Number(s);
    return Number.isFinite(n) ? n : null;
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

  function pick(row, col) {
    var raw = row && row[col.key];
    if ((raw == null || String(raw).trim() === '') && col.alt) raw = row[col.alt];
    return raw == null ? '' : raw;
  }

  function sheetName(day) {
    var name = String((day && (day.label || day.dateKey)) || 'Liste').replace(/[\\/*?:\[\]]/g, ' ').trim();
    return (name || 'Liste').slice(0, 31);
  }

  function sumCol(rows, col) {
    var total = 0;
    var any = false;
    rows.forEach(function (row) {
      var n = numOf(pick(row, col));
      if (n == null) return;
      total += n;
      any = true;
    });
    return any ? total : '';
  }

  function dataCell(row, col) {
    var raw = pick(row, col);
    if (!col.num) return { v: String(raw == null ? '' : raw).trim(), s: col.s };
    var n = numOf(raw);
    if (n == null || n === 0) return { v: '', s: col.s };
    return { v: n, s: col.s, n: true };
  }

  function buildRows(day) {
    var rows = [];
    var merges = [];
    var blocks = (day && day.blocks) || [];
    blocks.forEach(function (block, bi) {
      if (bi) rows.push({ cells: COLS.map(function () { return { v: '', s: 0 }; }) });
      var title = [block.tasiyici, block.title].filter(function (v) { return String(v || '').trim(); }).join('  ·  ');
      var titleCells = COLS.map(function () { return { v: '', s: 9 }; });
      titleCells[0] = { v: title || (block.yd || ''), s: 9 };
      merges.push({ r: rows.length, c1: 0, c2: COLS.length - 1 });
      rows.push({ cells: titleCells, h: 22 });

      function metaRow(pairs) {
        var cells = COLS.map(function () { return { v: '', s: 2 }; });
        pairs.forEach(function (pair, i) {
          var at = i * 2;
          if (at >= COLS.length) return;
          cells[at] = { v: pair[0], s: 1 };
          if (at + 1 < COLS.length) cells[at + 1] = { v: pair[1], s: 2 };
        });
        rows.push({ cells: cells });
      }
      metaRow([
        ['LİMAN', block.liman || block.port || ''],
        ['GEMİ DETAYI', block.gemi || ''],
        ['BOOKING', block.booking || ''],
        ['SEVK TARİHİ', block.sevk || ''],
      ]);
      metaRow([
        ['TAŞIYICI', block.tasiyici || ''],
        ['LOT', block.lot || ''],
        ['SİPARİŞ', block.sip || ''],
        ['DOSYA', block.fileName || ''],
      ]);
      rows.push({
        h: 30,
        cells: COLS.map(function (col) { return { v: col.head, s: 1 }; }),
      });
      var body = block.rows || [];
      body.forEach(function (row) {
        rows.push({ cells: COLS.map(function (col) { return dataCell(row, col); }) });
      });
      var total = COLS.map(function (col, i) {
        if (i === 0) return { v: 'TOPLAM', s: 8 };
        if (!col.num) return { v: '', s: 8 };
        var fromBlock = block.toplam && (block.toplam[col.key] || block.toplam[col.alt]);
        var n = numOf(fromBlock);
        if (n == null) n = sumCol(body, col);
        if (n === '' || n == null) return { v: '', s: 8 };
        return { v: n, s: 8, n: true };
      });
      rows.push({ cells: total });
      if (block.kalan) {
        rows.push({
          cells: COLS.map(function (col, i) {
            if (i === 0) return { v: 'KALAN', s: 1 };
            if (!col.num) return { v: '', s: 1 };
            var n = numOf(block.kalan[col.key] || block.kalan[col.alt]);
            if (n == null || n === 0) return { v: '', s: 1 };
            return { v: n, s: 1, n: true };
          }),
        });
      }
    });
    if (!rows.length) {
      rows.push({ cells: COLS.map(function (col) { return { v: col.head, s: 1 }; }), h: 30 });
    }
    return { rows: rows, merges: merges };
  }

  function cellXml(ref, cell) {
    var style = cell.s || 0;
    if (cell.n) return '<c r="' + ref + '" s="' + style + '"><v>' + cell.v + '</v></c>';
    var text = xmlEsc(cell.v);
    if (!text) return '<c r="' + ref + '" s="' + style + '"/>';
    return '<c r="' + ref + '" t="inlineStr" s="' + style + '"><is><t xml:space="preserve">' + text + '</t></is></c>';
  }

  function worksheetXml(grid) {
    var cols = COLS.map(function (col, i) {
      return '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + col.w + '" customWidth="1"/>';
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
        var n = m.r + 1;
        return '<mergeCell ref="' + colLetter(m.c1) + n + ':' + colLetter(m.c2) + n + '"/>';
      }).join('') + '</mergeCells>';
    }
    var last = colLetter(COLS.length - 1) + grid.rows.length;
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<dimension ref="A1:' + last + '"/>' +
      '<sheetViews><sheetView workbookViewId="0"/></sheetViews>' +
      '<cols>' + cols + '</cols>' +
      '<sheetData>' + body + '</sheetData>' +
      merge +
      '</worksheet>';
  }

  var STYLES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<fonts count="6">' +
    '<font><sz val="11"/><name val="Calibri"/></font>' +
    '<font><b/><sz val="9"/><name val="Calibri"/></font>' +
    '<font><b/><sz val="11"/><color rgb="FFC00000"/><name val="Calibri"/></font>' +
    '<font><sz val="11"/><color rgb="FF1D4ED8"/><name val="Calibri"/></font>' +
    '<font><b/><sz val="14"/><name val="Calibri"/></font>' +
    '<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>' +
    '</fonts>' +
    '<fills count="6">' +
    '<fill><patternFill patternType="none"/></fill>' +
    '<fill><patternFill patternType="gray125"/></fill>' +
    '<fill><patternFill patternType="solid"><fgColor rgb="FFFFF2CC"/><bgColor rgb="FFFFF2CC"/></patternFill></fill>' +
    '<fill><patternFill patternType="solid"><fgColor rgb="FFF8CBAD"/><bgColor rgb="FFF8CBAD"/></patternFill></fill>' +
    '<fill><patternFill patternType="solid"><fgColor rgb="FFFFFF00"/><bgColor rgb="FFFFFF00"/></patternFill></fill>' +
    '<fill><patternFill patternType="solid"><fgColor rgb="FF92D050"/><bgColor rgb="FF92D050"/></patternFill></fill>' +
    '</fills>' +
    '<borders count="2"><border/><border><left style="thin"/><right style="thin"/><top style="thin"/><bottom style="thin"/></border></borders>' +
    '<cellXfs count="10">' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>' +
    '<xf numFmtId="0" fontId="1" fillId="2" borderId="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>' +
    '<xf numFmtId="0" fontId="1" fillId="0" borderId="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>' +
    '<xf numFmtId="0" fontId="0" fillId="3" borderId="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>' +
    '<xf numFmtId="0" fontId="2" fillId="0" borderId="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>' +
    '<xf numFmtId="0" fontId="2" fillId="0" borderId="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>' +
    '<xf numFmtId="0" fontId="3" fillId="0" borderId="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>' +
    '<xf numFmtId="0" fontId="1" fillId="4" borderId="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>' +
    '<xf numFmtId="0" fontId="4" fillId="5" borderId="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>' +
    '</cellXfs></styleSheet>';

  function workbookXml(name) {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<sheets><sheet name="' + xmlEsc(name) + '" sheetId="1" r:id="rId1"/></sheets></workbook>';
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

  var api = { buildArchiveWorkbook: buildArchiveWorkbook, COLS: COLS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.LimanXlsx = api;
})(typeof window !== 'undefined' ? window : globalThis);
