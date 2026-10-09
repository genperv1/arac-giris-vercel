'use strict';

const fs = require('fs');
const path = require('path');
const XLSX = require('../public/vendor/xlsx.full.min.js');

const src = process.argv[2] || 'C:\\Users\\Engoo\\Downloads\\05.10.2026 (1).xlsx';
const out = path.join(__dirname, '..', 'public', 'liman-excel-deneme.html');

function themeRgb(themes) {
  const raw = String((themes && themes.raw) || '');
  const start = raw.indexOf('clrScheme');
  const end = raw.indexOf('</a:clrScheme>');
  const scheme = start >= 0 && end > start ? raw.slice(start, end) : raw;
  const names = ['dk1', 'lt1', 'dk2', 'lt2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6'];
  return names.map((name) => {
    const tag = '<a:' + name;
    const at = scheme.indexOf(tag);
    if (at < 0) return '000000';
    const body = scheme.slice(at, scheme.indexOf('</a:' + name + '>', at));
    const srgb = body.match(/srgbClr val="([A-Fa-f0-9]+)"/);
    const last = body.match(/lastClr="([A-Fa-f0-9]+)"/);
    return ((srgb && srgb[1]) || (last && last[1]) || '000000').toUpperCase();
  });
}

function applyTint(rgb, tint) {
  if (tint == null || tint === 0) return rgb;
  const n = parseInt(rgb, 16);
  let r = (n >> 16) & 255;
  let g = (n >> 8) & 255;
  let b = n & 255;
  const t = Number(tint);
  const ch = (c) => {
    if (t < 0) return Math.round(c * (1 + t));
    return Math.round(c + (255 - c) * t);
  };
  r = ch(r);
  g = ch(g);
  b = ch(b);
  return [r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('').toUpperCase();
}

function colorOf(color, palette) {
  if (!color) return '';
  if (color.rgb) {
    const raw = String(color.rgb).toUpperCase();
    const rgb = raw.length >= 8 ? raw.slice(-6) : raw;
    if (/^[0-9A-F]{6}$/.test(rgb)) return rgb;
  }
  if (color.theme != null && palette[color.theme]) {
    return applyTint(palette[color.theme], color.tint || 0);
  }
  return '';
}

function cssColor(color, palette) {
  const rgb = colorOf(color, palette);
  return rgb ? '#' + rgb : '';
}

function borderCss(edge) {
  if (!edge || !edge.style) return '';
  const width = edge.style === 'medium' || edge.style === 'thick' ? '2px' : '1px';
  return width + ' solid #000';
}

function parseBorders(xml) {
  const start = xml.indexOf('<borders');
  const end = xml.indexOf('</borders>');
  if (start < 0 || end < 0) return [];
  const chunk = xml.slice(start, end);
  return chunk.split('<border').slice(1).map((part) => {
    const body = part.slice(0, part.indexOf('</border>') >= 0 ? part.indexOf('</border>') : part.length);
    const edge = (name) => {
      const m = body.match(new RegExp('<' + name + ' style="([^"]+)"'));
      return m ? { style: m[1] } : null;
    };
    return { left: edge('left'), right: edge('right'), top: edge('top'), bottom: edge('bottom') };
  });
}

function colName(n) {
  let s = '';
  let x = n + 1;
  while (x > 0) {
    const m = (x - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    x = Math.floor((x - 1) / 26);
  }
  return s;
}

function parseRef(ref) {
  const m = String(ref).match(/^([A-Z]+)(\d+)$/);
  if (!m) return null;
  let c = 0;
  for (let i = 0; i < m[1].length; i++) c = c * 26 + (m[1].charCodeAt(i) - 64);
  return { c: c - 1, r: Number(m[2]) - 1 };
}

function main() {
  const buf = fs.readFileSync(src);
  const wb = XLSX.read(buf, { type: 'buffer', cellStyles: true, cellDates: false });
  const sheetName = wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  const palette = themeRgb(wb.Themes);
  if (process.env.DEBUG_STYLES) {
    console.log('palette', palette);
    const filled = (wb.Styles.CellXf || []).map((xf, i) => ({ i, fill: xf.fillId, font: xf.fontId })).filter((x) => x.fill);
    console.log('filled xfs', JSON.stringify(filled.slice(0, 40)));
    const fonts = wb.Styles.Fonts || [];
    fonts.forEach((f, i) => {
      if (f.color && (f.color.rgb && f.color.rgb !== '000000' && f.color.rgb !== 'FF000000')) console.log('font', i, JSON.stringify(f.color), f.sz, f.bold);
    });
  }
  const range = XLSX.utils.decode_range(ws['!ref']);
  const styles = wb.Styles || {};
  const xfs = styles.CellXf || [];
  const fonts = styles.Fonts || [];
  const fills = styles.Fills || [];
  const sheetXmlPath = process.env.SHEET_XML;
  if (!sheetXmlPath) throw new Error('SHEET_XML gerekli');
  const stylesXmlPath = path.join(path.dirname(sheetXmlPath), '..', 'styles.xml');
  const borders = parseBorders(fs.readFileSync(stylesXmlPath, 'utf8'));
  const xml = fs.readFileSync(sheetXmlPath, 'utf8');
  const styleByAddr = {};
  const re = /<c r="([A-Z]+\d+)"([^>]*)(?:\/>|>([\s\S]*?)<\/c>)/g;
  let m;
  while ((m = re.exec(xml))) {
    const attrs = m[2] || '';
    const sm = attrs.match(/\ss="(\d+)"/);
    if (sm) styleByAddr[m[1]] = Number(sm[1]);
  }

  const merges = (ws['!merges'] || []).map((mg) => ({
    r: mg.s.r,
    c: mg.s.c,
    rs: mg.e.r - mg.s.r + 1,
    cs: mg.e.c - mg.s.c + 1,
  }));
  const covered = {};
  merges.forEach((mg) => {
    for (let r = mg.r; r < mg.r + mg.rs; r++) {
      for (let c = mg.c; c < mg.c + mg.cs; c++) {
        if (r === mg.r && c === mg.c) continue;
        covered[r + ':' + c] = true;
      }
    }
  });
  const mergeAt = {};
  merges.forEach((mg) => { mergeAt[mg.r + ':' + mg.c] = mg; });

  const cols = [];
  for (let c = range.s.c; c <= range.e.c; c++) {
    const info = (ws['!cols'] || [])[c] || {};
    const px = info.wpx || Math.round((info.width || 8) * 8);
    cols.push(Math.max(18, Math.min(px, 420)));
  }

  const rows = [];
  for (let r = range.s.r; r <= range.e.r; r++) {
    const info = (ws['!rows'] || [])[r] || {};
    const cells = [];
    for (let c = range.s.c; c <= range.e.c; c++) {
      if (covered[r + ':' + c]) {
        cells.push(null);
        continue;
      }
      const addr = colName(c) + (r + 1);
      const cell = ws[addr] || {};
      const xf = xfs[styleByAddr[addr]] || {};
      const font = fonts[xf.fontId] || {};
      const fill = (fills[xf.fillId] && fills[xf.fillId].patternType === 'solid') ? fills[xf.fillId] : {};
      const border = borders[xf.borderId] || {};
      const align = xf.alignment || {};
      let text = cell.w != null ? String(cell.w) : (cell.v != null ? String(cell.v) : '');
      if (cell.t === 's') text = cell.w != null ? String(cell.w) : String(cell.v || '');
      const bg = cssColor(fill.fgColor, palette);
      const fg = cssColor(font.color, palette);
      const span = mergeAt[r + ':' + c];
      cells.push({
        t: text,
        bg: bg || '',
        fg: fg && fg !== '#000000' ? fg : '',
        bold: !!(font.bold),
        size: font.sz || 0,
        name: font.name || '',
        h: align.horizontal || '',
        v: align.vertical || '',
        wrap: !!(align.wrapText),
        rs: span ? span.rs : 1,
        cs: span ? span.cs : 1,
        bt: borderCss(border.top),
        br: borderCss(border.right),
        bb: borderCss(border.bottom),
        bl: borderCss(border.left),
      });
    }
    const hpt = info.hpt || 15;
    rows.push({ h: Math.max(16, Math.round(hpt * 96 / 72)), cells });
  }

  const payload = {
    name: sheetName,
    file: path.basename(src),
    cols,
    rows,
  };

  const html = `<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="UTF-8">
  <title>Deneme — ${escapeHtml(sheetName)}</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; background: #d9e2d4; color: #111; font-family: Arial, Calibri, sans-serif; }
    .bar { position: sticky; top: 0; z-index: 2; display: flex; gap: 12px; align-items: center; padding: 8px 12px; background: #1f4e2a; color: #fff; font-size: 13px; }
    .bar b { font-weight: 700; }
    .bar span { opacity: .85; }
    .wrap { padding: 12px; overflow: auto; }
    table.xl { border-collapse: collapse; background: #fff; }
    table.xl td { border: 1px solid #d0d0d0; padding: 1px 3px; vertical-align: middle; white-space: nowrap; line-height: 1.15; overflow: hidden; }
    table.xl td.wrap { white-space: normal; }
  </style>
</head>
<body>
  <div class="bar"><b>Deneme</b><span>Mevcut liman akışına bağlı değil. Kaynak: ${escapeHtml(path.basename(src))}</span></div>
  <div class="wrap" id="sheet"></div>
  <script>
    var SHEET = ${JSON.stringify(payload)};
    var root = document.getElementById('sheet');
    var html = '<table class="xl"><colgroup>';
    SHEET.cols.forEach(function (w) { html += '<col style="width:' + w + 'px">'; });
    html += '</colgroup><tbody>';
    SHEET.rows.forEach(function (row) {
      html += '<tr style="height:' + row.h + 'px">';
      row.cells.forEach(function (cell) {
        if (!cell) return;
        var style = '';
        if (cell.bg) style += 'background:' + cell.bg + ';';
        if (cell.fg) style += 'color:' + cell.fg + ';';
        if (cell.bold) style += 'font-weight:700;';
        if (cell.size) style += 'font-size:' + cell.size + 'pt;';
        if (cell.name) style += 'font-family:' + cell.name + ',Arial,sans-serif;';
        if (cell.h) style += 'text-align:' + cell.h + ';';
        if (cell.v === 'center') style += 'vertical-align:middle;';
        else if (cell.v === 'top') style += 'vertical-align:top;';
        if (cell.bt) style += 'border-top:' + cell.bt + ';';
        if (cell.br) style += 'border-right:' + cell.br + ';';
        if (cell.bb) style += 'border-bottom:' + cell.bb + ';';
        if (cell.bl) style += 'border-left:' + cell.bl + ';';
        html += '<td' + (cell.cs > 1 ? ' colspan="' + cell.cs + '"' : '') + (cell.rs > 1 ? ' rowspan="' + cell.rs + '"' : '') +
          (cell.wrap ? ' class="wrap"' : '') + (style ? ' style="' + style + '"' : '') + '>' + esc(cell.t) + '</td>';
      });
      html += '</tr>';
    });
    html += '</tbody></table>';
    root.innerHTML = html;
    function esc(v) {
      return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
  </script>
</body>
</html>
`;
  fs.writeFileSync(out, html);
  console.log('wrote', out, 'rows', rows.length, 'cols', cols.length);
}

function escapeHtml(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

main();
