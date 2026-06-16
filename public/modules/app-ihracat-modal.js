// app-ihracat-modal.js — ihracat modal, satır işlemleri
// Otomatik bölüm — scripts/modularize-remaining.js

function _ihracatShipmentKey(s) {
  return `${String(s.plaka || '').trim()}__${String(s.id || '').trim()}__${String(s.sira || '').trim()}`;
}

function _ihracatFirmaGroupKey(s) {
  const m = String(s.ydKey || s.firma || 'GENEL').match(/\b(YD\d{1,4})\b/i);
  const raw = (m ? m[1] : String(s.firma || 'GENEL')).toUpperCase();
  return raw.replace(/[^A-Z0-9]/g, '_') || 'GENEL';
}

/** Excel’deki her sevkiyat bloğu ayrı (aynı booking + farklı malzeme/HP = ayrı blok) */
function _ihracatBlockGroupKey(s) {
  const stored = String(s.blockKey || '').trim();
  if (stored) return stored;

  const ht = String(s.headerText || '').trim();
  const malzeme = String(s.malzeme || '').trim();
  const book = (ht.match(/BOOKING\s*NO\s*:\s*(\d+)/i) || [])[1];
  const lot = (ht.match(/LOT\s*NO\s*([\d\s]+)/i) || [])[1];
  const hp = (ht.match(/HP\s*([\d.,]+\s*-\s*[\d.,]+)/i) || [])[1];
  const parts = [];
  if (book) parts.push(`BOOKING_${book}`);
  else if (lot) parts.push(`LOT_${lot.replace(/\s+/g, '')}`);
  if (malzeme) parts.push(`M_${malzeme.replace(/\W+/g, '_').slice(0, 36)}`);
  else if (hp) parts.push(`HP_${hp.replace(/\W+/g, '_')}`);
  if (parts.length) return parts.join('__');
  if (ht) return `HDR_${ht.length}_${ht.slice(0, 48).replace(/\W+/g, '_')}`;
  return `FIRMA_${_ihracatFirmaGroupKey(s)}`;
}

function _ihracatShortBlockTitle(headerText, malzemeHint) {
  const ht = String(headerText || '').trim();
  if (!ht) return '';
  const yd = _extractFirmaKod(ht);
  const lot = (ht.match(/LOT\s*NO\s*([\d\s]+)/i) || [])[1];
  const book = (ht.match(/BOOKING\s*NO\s*:\s*(\d+)/i) || [])[1];
  const hp = (ht.match(/HP\s*([\d.,]+\s*-\s*[\d.,]+)/i) || [])[1];
  const malzeme = String(malzemeHint || '').trim();
  const parts = [];
  if (yd) parts.push(yd);
  if (lot) parts.push(`LOT ${lot.trim()}`);
  if (book) parts.push(`Booking ${book}`);
  if (malzeme) parts.push(malzeme);
  else if (hp) parts.push(`HP ${hp.trim()}`);
  return parts.join(' · ') || ht.slice(0, 80);
}

function _ihracatDisplayTonajCell(val) {
  const s = String(val ?? '').trim();
  if (!s) return '—';
  const n = Number(s.replace(/\./g, '').replace(',', '.'));
  if (!Number.isFinite(n)) return s;
  if (n >= 1000) {
    return (n / 1000).toLocaleString('tr-TR', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
  }
  return s;
}

function _ihracatSumItemsTotals(items) {
  const sumField = (field) => {
    let total = 0;
    let any = false;
    (items || []).forEach((it) => {
      const n = _ihracatParseNum(it[field]);
      if (n) {
        total += n;
        any = true;
      }
    });
    return any ? String(Math.round(total)) : '0';
  };
  const tonaj = sumField('tonajKg');
  return {
    bbt: sumField('bbt'),
    cuval: sumField('cuval'),
    palet: sumField('palet'),
    bosBbt: sumField('bosBbt'),
    bosCuval: sumField('bosCuval'),
    tonajKg: tonaj,
    netTonaj: tonaj,
  };
}

function _stripPackedQtyFromHeaderLine(s) {
  return String(s || '')
    .replace(/\s*\/\s*\d+[\d.,]*\s*BBT\b/gi, '')
    .replace(/\s*\/\s*\d+[\d.,]*\s*ÇUVAL\b/gi, '')
    .replace(/\s*\/\s*\d+[\d.,]*\s*CUVAL\b/gi, '')
    .replace(/\s*\/\s*\d+[\d.,]*\s*PALET\b/gi, '')
    .replace(/\s*\/\s*$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function _ihracatLiveBbtPaletFooterText(items, defaultText) {
  const sums = _ihracatSumItemsTotals(items || []);
  const bbt = Math.round(sums.bbt);
  const palet = Math.round(sums.palet);
  if (bbt > 0 || palet > 0) return `${bbt} BBT ${palet} PALET`;
  return String(defaultText || '').trim();
}

function _ihracatRenderExcelBlockFooterHtml(d, items, rule, black) {
  const footer = String(d.footerLine || d.bbtPaletSummary || d.noteLine || '').trim();
  if (!footer) return '';
  if (d.isFooterNote) {
    return `<div style="${rule}"><div style="${black}" data-ihr-footer-is-note="1">${escapeHtml(footer)}</div></div>`;
  }
  if (d.isBbtFooter || /^\d+\s*BBT/i.test(footer)) {
    const shown = _ihracatLiveBbtPaletFooterText(items, footer);
    return `<div style="${rule}"><div style="${black}" data-ihr-header-bbt-palet="1" data-ihr-header-bbt-palet-default="${escapeHtml(footer)}">${escapeHtml(shown)}</div></div>`;
  }
  return `<div style="${rule}"><div style="${black}">${escapeHtml(footer)}</div></div>`;
}

/** Excel üst bilgi kutusu — export altında BBT özeti veya müşteri notu */
function _ihracatRenderExcelBlockHeader(sample, items) {
  const d = _buildIhracatHeaderDisplay(sample);
  if (!d.blackLine1 && !d.exportLine && !d.portLine && !d.borusanLine && !d.footerLine) return '';
  const rule = 'border-top:1px solid #000;padding:6px 8px 5px;';
  const black = 'color:#000;font-weight:700;font-size:11px;line-height:1.4;text-align:center;margin:0;';
  const red = 'color:#991b1b;font-weight:700;font-size:10px;line-height:1.35;text-align:center;margin:0;';
  const redRef =
    'color:#991b1b;font-weight:600;font-size:10px;line-height:1.35;text-align:center;margin:0;word-break:break-word;';
  const wrap =
    'margin:0 0 12px;border:1px solid #000;border-radius:4px;background:#fff;overflow:hidden;';
  const port = d.portLine || d.borusanLine;
  const line2 = _stripPackedQtyFromHeaderLine(d.blackLine2);
  let html = `<div class="ihr-excel-desc" style="${wrap}">`;
  html += '<div class="ihr-excel-desc-top" style="padding:8px 10px 6px;">';
  if (d.blackLine1) html += `<div style="${black}">${escapeHtml(d.blackLine1)}</div>`;
  if (line2) {
    html += `<div style="${black}${d.blackLine1 ? 'margin-top:3px;' : ''}">${escapeHtml(line2)}</div>`;
  }
  if (port) {
    html += `<div style="${red}${d.blackLine1 || line2 ? 'margin-top:4px;' : ''}">${escapeHtml(port)}</div>`;
  }
  html += '</div>';
  if (d.exportLine) html += `<div style="${rule}"><div style="${redRef}">${escapeHtml(d.exportLine)}</div></div>`;
  html += _ihracatRenderExcelBlockFooterHtml(d, items, rule, black);
  html += '</div>';
  return html;
}

function _ihracatRenderExcelBlockHeaderRows(sample, opts) {
  const d = _buildIhracatHeaderDisplay(sample);
  if (!d.blackLine1 && !d.exportLine && !d.portLine) return '';
  const cols = Number(opts?.colSpan) > 0 ? Number(opts.colSpan) : 8;
  const td =
    'border:1px solid #ddd;padding:7px 8px;font-size:11px;text-align:center;vertical-align:middle;line-height:1.4;';
  const tdBlack = `${td}background:#fff;color:#000;font-weight:700;`;
  const tdRed = `${td}background:#fff;color:#991b1b;font-weight:700;font-size:10px;`;
  const tdRedRef = `${td}background:#fff;color:#991b1b;font-weight:600;font-size:10px;word-break:break-word;`;
  const tdPlan = `${td}background:#f8fafc;color:#000;font-weight:700;`;
  const row = (inner, style) =>
    `<tr class="ihr-sheet-meta-row"><td colspan="${cols}" style="${style}">${inner}</td></tr>`;
  const out = [];
  const port = d.portLine || d.borusanLine;
  const line2 = _stripPackedQtyFromHeaderLine(d.blackLine2);
  if (d.blackLine1) out.push(row(escapeHtml(d.blackLine1), tdBlack));
  if (line2) out.push(row(escapeHtml(line2), tdBlack));
  if (port) out.push(row(escapeHtml(port), tdRed));
  if (d.exportLine) out.push(row(escapeHtml(d.exportLine), tdRedRef));
  const footer = String(d.footerLine || d.bbtPaletSummary || d.noteLine || '').trim();
  if (footer) {
    if (d.isFooterNote) {
      out.push(row(escapeHtml(footer), tdPlan));
    } else if (d.isBbtFooter || /^\d+\s*BBT/i.test(footer)) {
      const shown = _ihracatLiveBbtPaletFooterText(null, footer);
      out.push(
        row(
          `<span data-ihr-header-bbt-palet="1">${escapeHtml(shown)}</span>`,
          tdPlan
        )
      );
    } else {
      out.push(row(escapeHtml(footer), tdPlan));
    }
  }
  return out.join('');
}

function _ihracatRenderExcelToplamRow(excelTotals, items) {
  const live = _ihracatSumItemsTotals(items);
  const t = excelTotals && Object.values(excelTotals).some((v) => String(v).trim() !== '')
    ? excelTotals
    : live;
  const cell = (val, extra) => {
    const raw = String(val ?? '').trim();
    const shown = raw ? escapeHtml(_ihracatDisplayTonajCell(raw)) : '0';
    return `<td style="border:1px solid #000;padding:6px 8px;text-align:center;font-weight:800;font-size:12px;${extra || ''}">${shown}</td>`;
  };
  const th = 'border:1px solid #000;padding:5px 6px;font-size:10px;font-weight:800;text-align:center;background:#fef9c3;';
  const thPeach = 'border:1px solid #000;padding:5px 6px;font-size:10px;font-weight:800;text-align:center;background:#fed7aa;';
  const thGrey = 'border:1px solid #000;padding:5px 6px;font-size:10px;font-weight:800;text-align:center;background:#e5e7eb;';
  const farkStyle = String(t.fark || '').trim().startsWith('-') ? 'background:#e5e7eb;' : 'background:#bbf7d0;';
  return `
    <table style="width:100%;border-collapse:collapse;margin-top:8px;font-size:12px;">
      <thead>
        <tr>
          <th colspan="2" style="${th}">TOPLAM</th>
          <th style="${th}">BBT</th>
          <th style="${th}">ÇUVAL</th>
          <th style="${th}">PALET</th>
          <th style="${th}">BOŞ BBT</th>
          <th style="${th}">BOŞ ÇUVAL</th>
          <th style="${thPeach}">NET TONAJ</th>
          <th style="${thPeach}">O.GR. TONAJ</th>
          <th style="${thPeach}">GİDEN TONAJ</th>
          <th style="${thGrey}">FARK</th>
        </tr>
      </thead>
      <tbody>
        <tr style="background:#fef08a;">
          <td colspan="2" style="border:1px solid #000;padding:6px 8px;font-weight:900;text-align:center;background:#fef08a;">TOPLAM</td>
          ${cell(t.bbt)}
          ${cell(t.cuval)}
          ${cell(t.palet)}
          ${cell(t.bosBbt)}
          ${cell(t.bosCuval)}
          ${cell(t.netTonaj, 'background:#ffedd5;')}
          ${cell(t.ogrTonaj, 'background:#ffedd5;')}
          ${cell(t.gidenTonaj, 'background:#ffedd5;')}
          ${cell(t.fark, farkStyle)}
        </tr>
      </tbody>
    </table>`;
}

function _defaultSevkForShipment(s) {
  const direct = String(s.sevkYeri || '').trim();
  if (direct) return direct;
  const cands = getLimanCandidates(s.headerText || '');
  return cands[0] || '';
}

function _defaultAmbalajTextForShipment(s) {
  const direct = String(s.ambalaj || s.ambalajBilgisi || '').trim();
  if (direct) return direct;
  const cands = getAmbalajCandidates(s.headerText || '');
  return cands[0] || '';
}

function _applyExcelShipmentFieldsToTakipForm(chosen) {
  if (!chosen) return;
  const firmaKodu = document.getElementById('firmaKodu');
  const firmaSelect = document.getElementById('firmaSelect');
  const malzeme = document.getElementById('malzeme');
  const malzemeSelect = document.getElementById('malzemeSelect');
  const sevkYeri = document.getElementById('sevkYeri');
  const ambalajBilgisi = document.getElementById('ambalajBilgisi');
  const tonajEl = document.getElementById('tonaj');
  const bbt = document.getElementById('bbt');
  const cuval = document.getElementById('cuval');
  const palet = document.getElementById('palet');
  const bosBbt = document.getElementById('bosBbt');
  const bosCuval = document.getElementById('bosCuval');
  const yuklemeNotu = document.getElementById('yuklemeNotu');

  const firmaFromRow = String(chosen.firma || '').trim();
  const ydOnly = String(chosen.ydKey || '').trim();
  const firmaVal = firmaFromRow
    || (/\bYD\d{1,4}\b/i.test(ydOnly) ? ydOnly : '')
    || _extractFirmaKod(chosen.headerText || '');
  const malzemeVal = String(chosen.malzeme || '').trim();
  if (firmaKodu && firmaVal) firmaKodu.value = firmaVal;
  if (firmaSelect && firmaVal) {
    try {
      const opt = Array.from(firmaSelect.options || []).find((o) => String(o.value || '').trim() === firmaVal);
      if (opt) firmaSelect.value = opt.value;
    } catch (e) {}
  }
  if (malzeme && malzemeVal) malzeme.value = malzemeVal;
  if (malzemeSelect && malzemeVal) malzemeSelect.value = malzemeVal;

  const sevk = String(chosen.sevkYeri || _defaultSevkForShipment(chosen)).trim();
  if (sevkYeri && sevk) sevkYeri.value = sevk;

  const ambText = String(chosen.ambalaj || chosen.ambalajBilgisi || _defaultAmbalajTextForShipment(chosen)).trim();
  if (ambalajBilgisi && ambText) ambalajBilgisi.value = ambText;

  if (tonajEl && chosen.tonajKg != null && String(chosen.tonajKg).trim() !== '') {
    tonajEl.value = String(chosen.tonajKg).trim();
  }

  if (bbt) bbt.value = String(chosen.bbt || '').trim();
  if (palet) palet.value = String(chosen.palet || '').trim();
  if (bosBbt) bosBbt.value = String(chosen.bosBbt || '').trim();
  if (cuval) {
    const cv = Number(chosen.cuval || 0);
    const bcv = Number(chosen.bosCuval || 0);
    if (cv > 0) {
      cuval.value = String(chosen.cuval);
      if (bosCuval) bosCuval.value = bcv > 0 ? String(chosen.bosCuval) : '';
    } else if (bcv > 0) {
      cuval.value = String(chosen.bosCuval);
      if (bosCuval) bosCuval.value = '';
    }
  }

  applyShipmentTonajAndIrsaliye(chosen);
}

function _ihracatReadRowFields(row, cur, blockSevk, blockAmb) {
  const gk = _ihracatBlockGroupKey(cur);
  const plakaInp = row.querySelector('[data-field="plaka"]');
  const plakaText = row.querySelector('[data-field="plaka-text"]');
  const plaka = plakaInp
    ? normPlate(plakaInp.value)
    : plakaText
      ? normPlate(plakaText.textContent)
      : normPlate(cur.plaka || '');
  if (!plaka || !_ihracatPlateKey(plaka)) return null;
  cur.plaka = plaka;

  const firmaEl = row.querySelector('[data-field="firma"]');
  const malzemeEl = row.querySelector('[data-field="malzeme"]');
  if (firmaEl) cur.firma = String(firmaEl.textContent || '').trim();
  if (malzemeEl) cur.malzeme = String(malzemeEl.textContent || '').trim();

  const tonaj = row.querySelector('[data-field="tonaj"]');
  const irs = row.querySelector('[data-field="irsaliye"]');
  const bbt = row.querySelector('[data-field="bbt"]');
  const bosBbt = row.querySelector('[data-field="bosBbt"]');
  const cuval = row.querySelector('[data-field="cuval"]');
  const bosCuval = row.querySelector('[data-field="bosCuval"]');
  const palet = row.querySelector('[data-field="palet"]');

  if (tonaj) cur.tonajKg = String(tonaj.value || '').trim();
  if (irs) {
    const n = normalizeIrsaliyeNo(irs.value);
    cur.irsaliyeNo = n;
    if (n) cur.id = n;
  }
  if (bbt) cur.bbt = String(bbt.value || '').trim();
  if (bosBbt) cur.bosBbt = String(bosBbt.value || '').trim();
  if (cuval) cur.cuval = String(cuval.value || '').trim();
  if (bosCuval) cur.bosCuval = String(bosCuval.value || '').trim();
  if (palet) cur.palet = String(palet.value || '').trim();

  const sevk = blockSevk[gk] || cur.sevkYeri || '';
  if (sevk) cur.sevkYeri = sevk;
  const amb = blockAmb[gk] || '';
  if (amb) {
    cur.ambalaj = amb;
    cur.ambalajBilgisi = amb;
  }

  cur._ihracatEdited = true;
  cur._ihracatEditedAt = Date.now();
  return cur;
}

function _saveIhracatDetailsFromModal(originalShipments, meta) {
  const modal = document.getElementById('ihracatDetailsModal');
  if (!modal) return false;

  const byKey = new Map();
  (originalShipments || []).forEach((s) => {
    byKey.set(_ihracatShipmentKey(s), { ...s });
  });

  const blockSevk = {};
  const blockAmb = {};
  modal.querySelectorAll('[data-ihr-firma-sevk]').forEach((inp) => {
    blockSevk[inp.getAttribute('data-ihr-firma-sevk')] = String(inp.value || '').trim();
  });
  modal.querySelectorAll('[data-ihr-firma-amb]').forEach((inp) => {
    blockAmb[inp.getAttribute('data-ihr-firma-amb')] = String(inp.value || '').trim();
  });

  modal.querySelectorAll('tr[data-ihr-row-key]').forEach((row) => {
    const key = row.getAttribute('data-ihr-row-key');
    if (!key) return;

    let cur = byKey.get(key);
    const isNew = row.getAttribute('data-ihr-is-new') === '1' || String(key).startsWith('new__');
    if (!cur && isNew) {
      const tbody = row.closest('tbody[data-ihr-tbody]');
      let template = {};
      try {
        template = JSON.parse(tbody?.getAttribute('data-ihr-template') || '{}');
      } catch (e) {}
      cur = {
        ...template,
        id: '',
        sira: '',
        plaka: '',
        _ihracatManual: true,
      };
    }
    if (!cur) return;

    const updated = _ihracatReadRowFields(row, cur, blockSevk, blockAmb);
    if (!updated) return;
    byKey.set(key, updated);
  });

  let deletedKeys = [];
  try { deletedKeys = JSON.parse(modal.dataset.ihrDeletedKeys || '[]'); } catch (e) {}
  deletedKeys.forEach((k) => byKey.delete(k));

  const rows = Array.from(byKey.values());
  const ok = saveDailyShipments(rows, meta);
  if (ok) {
    try {
      purgeStrictExcelCaches();
      rebuildListsFromExcelRows(rows);
      window.refreshHeaderExcelInfo && window.refreshHeaderExcelInfo();
    } catch (e) {}
  }
  return ok;
}

function _ihracatPlateKey(value) {
  const formatted = normPlate(value || '');
  return _plateKeyForMatch(formatted || value);
}

function _ihracatBuildVehiclePlateMap() {
  const map = new Map();
  (state.vehicles || []).forEach((v) => {
    [v.cekiciPlaka, v.dorsePlaka, v.plaka].forEach((raw) => {
      const k = _ihracatPlateKey(raw);
      if (k && !map.has(k)) map.set(k, v);
    });
  });
  return map;
}

function _ihracatFindVehicleByPlate(plateRaw) {
  const key = _ihracatPlateKey(plateRaw);
  if (!key) return null;
  const modalMap = window.__ihracatModalVehicleMap;
  if (modalMap instanceof Map) return modalMap.get(key) || null;
  return (state.vehicles || []).find((v) => {
    const plates = [v.cekiciPlaka, v.dorsePlaka, v.plaka].filter(Boolean);
    return plates.some((p) => _ihracatPlateKey(p) === key);
  }) || null;
}

const IHR_AMBALAJ_GRID_STYLE =
  'display:grid;grid-template-columns:repeat(6,minmax(0,auto));gap:2px 4px;justify-items:center;align-items:center;';
const IHR_AMBALAJ_LABEL_STYLE = 'font-size:9px;color:#64748b;white-space:nowrap;line-height:1.1;text-align:center;';
const IHR_AMBALAJ_INP_STYLE = 'width:28px;min-width:28px;max-width:32px;padding:2px 3px;border:1px solid #cbd5e1;border-radius:4px;font-size:11px;box-sizing:border-box;text-align:center;';
const IHR_AMBALAJ_INP_WIDE_STYLE =
  'width:50px;min-width:50px;max-width:54px;padding:2px 3px;border:1px solid #cbd5e1;border-radius:4px;font-size:11px;box-sizing:border-box;text-align:center;';
const IHR_AMBALAJ_INP_BOS_CUVAL_STYLE = IHR_AMBALAJ_INP_WIDE_STYLE;
const IHR_CUVAL_TRANSFER_BTN_STYLE =
  'width:20px;height:22px;min-width:20px;padding:0;border:1px solid #94a3b8;border-radius:4px;background:#e2e8f0;color:#1e40af;font-size:13px;line-height:1;cursor:pointer;font-weight:700;box-sizing:border-box;';
const IHR_AMBALAJ_TRANSFER_GAP =
  '<span style="font-size:9px;line-height:1.1;" aria-hidden="true">&nbsp;</span>';
const IHR_AMBALAJ_TD_STYLE = 'white-space:nowrap;';
const IHR_AMBALAJ_FIELDS = [
  { key: 'bbt', label: 'BBT' },
  { key: 'bosBbt', label: 'Boş BBT' },
  { key: 'cuval', label: 'Çuval' },
  { key: 'bosCuval', label: 'Boş çuval' },
  { key: 'palet', label: 'Palet' },
];

function _ihracatAmbalajCuvalTransferBtnHtml() {
  return `<button type="button" class="ihr-cuval-transfer" title="Boş çuvalı çuvale taşı ve boş çuvalı sil (takip formuna da yansır)" aria-label="Boş çuvalı çuvale aktar" style="${IHR_CUVAL_TRANSFER_BTN_STYLE}">←</button>`;
}

function _ihracatAmbalajGridHtml(inpStyle, s, opts) {
  const ambInp = inpStyle || IHR_AMBALAJ_INP_STYLE;
  const withTransfer = opts?.withTransfer !== false;
  const v = (f) => escapeHtml(String((s && s[f]) || ''));
  const ambField = (field) =>
    `<input type="text" data-field="${field}" value="${v(field)}" maxlength="${_ihracatAmbalajFieldMaxLen(field)}" inputmode="numeric" style="${_ihracatAmbalajFieldInpStyle(field, ambInp)}" />`;
  const labels = [];
  const inputs = [];
  IHR_AMBALAJ_FIELDS.forEach((f) => {
    labels.push(`<span style="${IHR_AMBALAJ_LABEL_STYLE}">${f.label}</span>`);
    inputs.push(ambField(f.key));
    if (f.key === 'cuval') {
      labels.push(IHR_AMBALAJ_TRANSFER_GAP);
      inputs.push(
        withTransfer
          ? _ihracatAmbalajCuvalTransferBtnHtml()
          : '<span style="width:20px;" aria-hidden="true"></span>'
      );
    }
  });
  return `<div class="ihr-ambalaj-grid" style="${IHR_AMBALAJ_GRID_STYLE}">${labels.join('')}${inputs.join('')}</div>`;
}

function _ihracatAmbalajCellHtml(inpStyle, s) {
  return _ihracatAmbalajGridHtml(inpStyle, s, { withTransfer: true });
}

function _ihracatParseNum(val) {
  const n = Number(String(val ?? '').replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

const IHR_TOPLAM_ROW_BG = '#fffbeb';
const IHR_TOPLAM_INP_STYLE =
  'width:100%;max-width:90px;padding:4px 6px;border:1px solid #cbd5e1;border-radius:6px;font-size:12px;box-sizing:border-box;text-align:left;font-weight:700;background:#fffbeb;color:#0f172a;';
const IHR_TOPLAM_AMB_INP_STYLE =
  'width:28px;min-width:28px;max-width:32px;padding:2px 3px;border:1px solid #cbd5e1;border-radius:4px;font-size:11px;box-sizing:border-box;text-align:center;font-weight:700;background:#fffbeb;color:#0f172a;';
const IHR_TOPLAM_AMB_INP_WIDE_STYLE =
  'width:50px;min-width:50px;max-width:54px;padding:2px 3px;border:1px solid #cbd5e1;border-radius:4px;font-size:11px;box-sizing:border-box;text-align:center;font-weight:700;background:#fffbeb;color:#0f172a;';
const IHR_TOPLAM_AMB_INP_BOS_CUVAL_STYLE = IHR_TOPLAM_AMB_INP_WIDE_STYLE;

function _ihracatAmbalajFieldInpStyle(field, baseStyle) {
  const isToplam = baseStyle === IHR_TOPLAM_AMB_INP_STYLE;
  if (field === 'bbt' || field === 'bosBbt' || field === 'cuval' || field === 'bosCuval') {
    return isToplam ? IHR_TOPLAM_AMB_INP_WIDE_STYLE : IHR_AMBALAJ_INP_WIDE_STYLE;
  }
  return baseStyle || IHR_AMBALAJ_INP_STYLE;
}

function _ihracatAmbalajFieldMaxLen(field) {
  if (field === 'bbt' || field === 'bosBbt' || field === 'cuval' || field === 'bosCuval') return 4;
  return 2;
}

function _ihracatSyncTakipAmbalajFromRow(row) {
  const snap = _ihracatReadRowSnapshot(row);
  if (!snap) return;
  const takipModal = document.getElementById('takipFormuModal');
  if (!takipModal || takipModal.classList.contains('hidden')) return;
  const plateOnForm = normPlate(document.getElementById('cekiciPlakaBilgi')?.value || '');
  if (plateOnForm !== snap.plaka) return;
  const cuvalEl = document.getElementById('cuval');
  const bosCuvalEl = document.getElementById('bosCuval');
  if (cuvalEl) cuvalEl.value = snap.cuval || '';
  if (bosCuvalEl) bosCuvalEl.value = snap.bosCuval || '';
  try {
    const patch = { cuval: snap.cuval || '', bosCuval: snap.bosCuval || '' };
    if (window.__activeExcelShipment && normPlate(window.__activeExcelShipment.plaka) === snap.plaka) {
      window.__activeExcelShipment = { ...window.__activeExcelShipment, ...patch };
    }
    if (window.__lastChosenShipment && normPlate(window.__lastChosenShipment.plaka) === snap.plaka) {
      window.__lastChosenShipment = { ...window.__lastChosenShipment, ...patch };
    }
  } catch (e) {}
}

function _ihracatPersistSingleRowFromModal(row, modal) {
  if (!row || !modal) return false;
  const key = row.getAttribute('data-ihr-row-key');
  if (!key) return false;
  const meta = modal.__ihrMeta || (typeof loadDailyMeta === 'function' ? loadDailyMeta() || {} : {});
  const list = typeof loadDailyShipments === 'function' ? loadDailyShipments() || [] : [];
  const idx = list.findIndex((s) => _ihracatShipmentKey(s) === key);

  const blockSevk = {};
  const blockAmb = {};
  modal.querySelectorAll('[data-ihr-firma-sevk]').forEach((inp) => {
    blockSevk[inp.getAttribute('data-ihr-firma-sevk')] = String(inp.value || '').trim();
  });
  modal.querySelectorAll('[data-ihr-firma-amb]').forEach((inp) => {
    blockAmb[inp.getAttribute('data-ihr-firma-amb')] = String(inp.value || '').trim();
  });

  let cur = idx >= 0 ? { ...list[idx] } : null;
  if (!cur) {
    const tbody = row.closest('tbody[data-ihr-tbody]');
    try {
      cur = { ...JSON.parse(tbody?.getAttribute('data-ihr-template') || '{}'), _ihracatManual: true };
    } catch (e) {
      return false;
    }
  }

  const updated = _ihracatReadRowFields(row, cur, blockSevk, blockAmb);
  if (!updated) return false;

  const next = [...list];
  if (idx >= 0) next[idx] = updated;
  else next.push(updated);

  const ok = typeof saveDailyShipments === 'function' ? saveDailyShipments(next, meta) : false;
  if (ok) {
    try {
      const shipKey = _ihracatShipmentKey(updated);
      if (window.__activeExcelShipment && _ihracatShipmentKey(window.__activeExcelShipment) === shipKey) {
        window.__activeExcelShipment = { ...window.__activeExcelShipment, ...updated };
      }
      purgeStrictExcelCaches();
      rebuildListsFromExcelRows(next);
      window.refreshHeaderExcelInfo && window.refreshHeaderExcelInfo();
    } catch (e) {}
  }
  return ok;
}

function _ihracatTransferBosCuvalToCuval(row, modal) {
  if (!row) return false;
  const bos = row.querySelector('[data-field="bosCuval"]');
  const cuval = row.querySelector('[data-field="cuval"]');
  if (!bos || !cuval) return false;
  const val = String(bos.value || '').trim();
  if (!val) return false;
  cuval.value = val;
  bos.value = '';
  cuval.dispatchEvent(new Event('input', { bubbles: true }));
  cuval.dispatchEvent(new Event('change', { bubbles: true }));
  bos.dispatchEvent(new Event('input', { bubbles: true }));
  bos.dispatchEvent(new Event('change', { bubbles: true }));

  const tbody = row.closest('tbody[data-ihr-tbody]');
  _ihracatRefreshToplamForTbody(tbody);

  const rowKey = row.getAttribute('data-ihr-row-key');
  const detail = row.nextElementSibling;
  if (
    rowKey &&
    detail &&
    detail.classList.contains('ihr-detail-row') &&
    detail.getAttribute('data-ihr-detail-for') === rowKey
  ) {
    detail.remove();
    _ihracatToggleDetailRow(row, modal);
  }

  const modalEl = modal || document.getElementById('ihracatDetailsModal');
  if (modalEl) _ihracatPersistSingleRowFromModal(row, modalEl);
  _ihracatSyncTakipAmbalajFromRow(row);
  return true;
}

function _ihracatBindCuvalTransfer(modal) {
  if (!modal || modal.dataset.ihrCuvalXferBound === '1') return;
  modal.dataset.ihrCuvalXferBound = '1';
  modal.addEventListener('click', (e) => {
    const btn = e.target.closest('.ihr-cuval-transfer');
    if (!btn) return;
    e.preventDefault();
    const row = btn.closest('tr[data-ihr-row-key]');
    if (!row) return;
    if (!_ihracatTransferBosCuvalToCuval(row, modal)) {
      if (typeof showToast === 'function') showToast('Boş çuval alanı boş.', 'info');
    }
  });
}

function _ihracatToplamAmbalajHtml(totals) {
  const sumVal = (key) => {
    const n = _ihracatParseNum(totals && totals[key]);
    return n > 0 ? String(Math.round(n)) : '0';
  };
  const labels = [];
  const inputs = [];
  IHR_AMBALAJ_FIELDS.forEach((f) => {
    labels.push(`<span style="${IHR_AMBALAJ_LABEL_STYLE}">${f.label}</span>`);
    inputs.push(
      `<input type="text" readonly tabindex="-1" aria-readonly="true" data-ihr-sum="${f.key}" value="${escapeHtml(sumVal(f.key))}" style="${_ihracatAmbalajFieldInpStyle(f.key, IHR_TOPLAM_AMB_INP_STYLE)}" />`
    );
    if (f.key === 'cuval') {
      labels.push(IHR_AMBALAJ_TRANSFER_GAP);
      inputs.push('<span style="width:20px;" aria-hidden="true"></span>');
    }
  });
  return `<div class="ihr-ambalaj-grid" style="${IHR_AMBALAJ_GRID_STYLE}">${labels.join('')}${inputs.join('')}</div>`;
}

/** Tablo altı özet satırı — plaka satırı gibi hizalı, "TOPLAM" yazısı yok */
function _ihracatToplamRowHtml(items) {
  const t = _ihracatSumItemsTotals(items || []);
  const tonajShown = escapeHtml(String(t.tonajKg || '0'));
  const td = `border:1px solid #ddd;padding:6px;vertical-align:middle;background:${IHR_TOPLAM_ROW_BG};`;
  return `
    <tr data-ihr-toplam-row="1" style="background:${IHR_TOPLAM_ROW_BG};">
      <td style="${IHR_PLAKA_TD_STYLE}${td}"></td>
      <td style="${td}"></td>
      <td style="${td}"></td>
      <td style="${td}">
        <input type="text" readonly tabindex="-1" aria-readonly="true" data-ihr-sum="tonajKg" value="${tonajShown}" style="${IHR_TOPLAM_INP_STYLE}" />
      </td>
      <td style="${td}${IHR_AMBALAJ_TD_STYLE}">${_ihracatToplamAmbalajHtml(t)}</td>
      <td style="${td}text-align:center;color:#94a3b8;font-size:11px;">—</td>
      <td style="${td}"></td>
      <td style="${td}"></td>
    </tr>`;
}

function _ihracatPrintToplamRowHtml(items) {
  const t = _ihracatSumItemsTotals(items || []);
  const cell = (val) => {
    const raw = String(val ?? '').trim() || '0';
    return `<td style="border:1px solid #000;padding:6px 8px;text-align:center;font-weight:700;background:#fffbeb;">${escapeHtml(raw)}</td>`;
  };
  return `
    <tr class="ihr-print-toplam" style="background:#fffbeb;">
      <td style="border:1px solid #000;padding:6px 8px;background:#fffbeb;"></td>
      <td style="border:1px solid #000;padding:6px 8px;background:#fffbeb;"></td>
      ${cell(t.tonajKg)}
      ${cell(t.bbt)}
      ${cell(t.bosBbt)}
      ${cell(t.cuval)}
      ${cell(t.bosCuval)}
      ${cell(t.palet)}
    </tr>`;
}

function _ihracatSetToplamCell(topRow, key, val) {
  const el = topRow.querySelector(`[data-ihr-sum="${key}"]`);
  if (!el) return;
  const shown = val > 0 ? String(Math.round(val)) : '0';
  if (el.tagName === 'INPUT') el.value = shown;
  else el.textContent = shown;
}

function _ihracatSumRowsInTbody(tbody) {
  const sums = { tonajKg: 0, bbt: 0, bosBbt: 0, cuval: 0, bosCuval: 0, palet: 0 };
  if (!tbody) return sums;
  tbody.querySelectorAll('tr[data-ihr-row-key]').forEach((row) => {
    if (row.getAttribute('data-ihr-is-new') === '1') {
      const plateInp = row.querySelector('[data-field="plaka"]');
      if (!String(plateInp?.value || '').trim() && !row.querySelector('[data-field="plaka-text"]')?.textContent?.trim()) {
        return;
      }
    }
    sums.tonajKg += _ihracatParseNum(row.querySelector('[data-field="tonaj"]')?.value);
    IHR_AMBALAJ_FIELDS.forEach(({ key }) => {
      sums[key] += _ihracatParseNum(row.querySelector(`[data-field="${key}"]`)?.value);
    });
  });
  return sums;
}

function _ihracatRefreshToplamForTbody(tbody) {
  if (!tbody) return;
  const sums = _ihracatSumRowsInTbody(tbody);
  const topRow = tbody.querySelector('tr[data-ihr-toplam-row]');
  if (topRow) {
    _ihracatSetToplamCell(topRow, 'tonajKg', sums.tonajKg);
    IHR_AMBALAJ_FIELDS.forEach(({ key }) => _ihracatSetToplamCell(topRow, key, sums[key]));
  }
  const section = tbody.closest('[data-ihr-block-section]');
  const bbtPaletEl = section?.querySelector('[data-ihr-header-bbt-palet]');
  if (bbtPaletEl && !bbtPaletEl.closest('[data-ihr-footer-is-note]')) {
    const bbt = Math.round(sums.bbt);
    const palet = Math.round(sums.palet);
    if (bbt > 0 || palet > 0) {
      bbtPaletEl.textContent = `${bbt} BBT ${palet} PALET`;
    } else {
      const def = bbtPaletEl.getAttribute('data-ihr-header-bbt-palet-default') || '';
      if (def) bbtPaletEl.textContent = def;
    }
  }
}

function _ihracatBindToplamLiveUpdate(modal) {
  if (!modal || modal.dataset.ihrToplamBound === '1') return;
  modal.dataset.ihrToplamBound = '1';
  const onChange = (e) => {
    const t = e.target;
    if (
      !t ||
      !t.matches(
        '[data-field="tonaj"], [data-field="bbt"], [data-field="bosBbt"], [data-field="cuval"], [data-field="bosCuval"], [data-field="palet"]'
      )
    ) {
      return;
    }
    _ihracatRefreshToplamForTbody(t.closest('tbody[data-ihr-tbody]'));
  };
  modal.addEventListener('input', onChange);
  modal.addEventListener('change', onChange);
  modal.querySelectorAll('tbody[data-ihr-tbody]').forEach(_ihracatRefreshToplamForTbody);
}

function _ihracatStripNewPlateQtyFields(snap) {
  if (!snap || typeof snap !== 'object') return snap;
  return {
    ...snap,
    tonajKg: '',
    bbt: '',
    bosBbt: '',
    cuval: '',
    bosCuval: '',
    palet: '',
    irsaliyeNo: '',
  };
}

function _ihracatClearNewPlateQtyOnRow(row, inpStyle) {
  if (!row) return;
  const style = inpStyle || IHR_AMBALAJ_INP_STYLE;
  const tonajInp = row.querySelector('[data-field="tonaj"]');
  if (tonajInp) {
    tonajInp.value = '';
    tonajInp.removeAttribute('disabled');
  }
  const irsInp = row.querySelector('[data-field="irsaliye"]');
  if (irsInp) {
    irsInp.value = '';
    irsInp.removeAttribute('disabled');
  }
  if (row.cells && row.cells.length >= 5) {
    row.cells[4].innerHTML = _ihracatAmbalajCellHtml(style, null);
    row.cells[4].style.opacity = '1';
  }
}

function _ihracatCopyRowFromPrev(prevRow, targetRow) {
  if (!prevRow || !targetRow) return;
  ['firma', 'malzeme'].forEach((f) => {
    const from = prevRow.querySelector(`[data-field="${f}"]`);
    const to = targetRow.querySelector(`[data-field="${f}"]`);
    if (from && to) {
      to.textContent = from.textContent || '';
      to.style.color = '';
    }
  });
}

const IHR_PLAKA_WRAP_STYLE = 'display:inline-flex;align-items:center;flex-wrap:nowrap;gap:2px;min-width:0;max-width:100%;';
const IHR_PLAKA_INP_STYLE = 'width:92px;max-width:92px;flex:0 1 92px;min-width:0;padding:4px 5px;border:1px solid #cbd5e1;border-radius:6px;font-size:12px;box-sizing:border-box;';
const IHR_PLAKA_INP_ADD_STYLE = 'width:92px;max-width:92px;flex:0 1 92px;min-width:0;padding:4px 5px;border:1px dashed #f59e0b;border-radius:6px;font-size:12px;box-sizing:border-box;';
const IHR_PLAKA_TEXT_STYLE = 'display:inline-block;flex:1 1 auto;min-width:0;max-width:100px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;vertical-align:middle;';
const IHR_PLAKA_TD_STYLE = 'border:1px solid #ddd;padding:4px 6px;white-space:nowrap;width:198px;max-width:198px;overflow:hidden;vertical-align:middle;';
const IHR_SIRA_STYLE =
  'display:inline-block;flex:0 0 auto;min-width:22px;text-align:center;font-size:11px;font-weight:800;color:#475569;margin-right:6px;padding:1px 4px;border-radius:4px;background:#f1f5f9;';

function _ihracatShouldShowSira(sira) {
  const n = String(sira ?? '').trim();
  if (!n) return false;
  if (/^M\d{10,}$/.test(n)) return false;
  return true;
}

function _ihracatSiraPrefixHtml(sira) {
  if (!_ihracatShouldShowSira(sira)) return '';
  return `<span data-ihr-sira style="${IHR_SIRA_STYLE}" title="Excel sıra no">${escapeHtml(String(sira).trim())}</span>`;
}

function _ihracatActionBtnsHtml() {
  const btn = 'border:none;background:transparent;cursor:pointer;padding:3px 7px;border-radius:6px;line-height:1;flex-shrink:0;';
  return `<span class="ihr-row-actions" style="display:inline-flex;flex-shrink:0;gap:2px;margin-left:2px;vertical-align:middle;">
    <button type="button" class="ihr-row-edit" title="Plakayı düzenle" style="${btn}color:#2563eb;" onmouseover="this.style.background='#eff6ff'" onmouseout="this.style.background='transparent'"><i class="fas fa-pen" style="font-size:13px;"></i></button>
    <button type="button" class="ihr-row-del" title="Satırı sil" style="${btn}color:#dc2626;" onmouseover="this.style.background='#fef2f2'" onmouseout="this.style.background='transparent'"><i class="fas fa-trash" style="font-size:13px;"></i></button>
  </span>`;
}

function _ihracatPlakaCellHtml(plate, editable, isAddRow, opts) {
  const o = opts && typeof opts === 'object' ? opts : {};
  const isDupPlate = !!o.isDupPlate;
  const dupTitle = String(o.dupPlateTitle || '');
  const siraPrefix = _ihracatSiraPrefixHtml(o.sira);
  const actions = isAddRow ? '' : _ihracatActionBtnsHtml();
  const p = normPlate(plate || '');
  const inpStyle = isAddRow ? IHR_PLAKA_INP_ADD_STYLE : IHR_PLAKA_INP_STYLE;
  const textStyle = isDupPlate
    ? `${IHR_PLAKA_TEXT_STYLE}background:#fef3c7;color:#92400e;font-weight:700;padding:2px 6px;border-radius:4px;border:1px solid #fbbf24;`
    : IHR_PLAKA_TEXT_STYLE;
  const title = escapeHtml(dupTitle || p || '');
  if (editable) {
    const editableInpStyle = isDupPlate
      ? `${inpStyle}background:#fef3c7;color:#92400e;font-weight:700;border-color:#fbbf24;`
      : inpStyle;
    return `<span data-ihr-plaka-wrap style="${IHR_PLAKA_WRAP_STYLE}">
      ${siraPrefix}<input type="text" data-field="plaka" value="${escapeHtml(p)}" placeholder="${isAddRow ? 'Yeni plaka…' : ''}" style="${editableInpStyle}" title="${title}" />
      ${actions}
    </span>`;
  }
  return `<span data-ihr-plaka-wrap style="${IHR_PLAKA_WRAP_STYLE}">
    ${siraPrefix}<span data-field="plaka-text" style="${textStyle}" title="${title}">${escapeHtml(p || '—')}</span>
    ${actions}
  </span>`;
}

function _ihracatEnsureRowActions(row) {
  if (!row || !row.hasAttribute('data-ihr-row-key')) return;
  const cell = row.cells[0];
  if (!cell || cell.querySelector('.ihr-row-actions')) return;
  const wrap = cell.querySelector('[data-ihr-plaka-wrap]');
  if (wrap) {
    wrap.insertAdjacentHTML('beforeend', _ihracatActionBtnsHtml());
  }
}

function _ihracatPlateCommitReady(raw, normalizePlate) {
  const plate = normalizePlate(raw || '');
  return plate && plate.replace(/\s/g, '').length >= 7;
}

function _ihracatVehicleHasDriver(vehicle) {
  if (!vehicle) return false;
  const n1 = `${vehicle.soforAdi || ''} ${vehicle.soforSoyadi || ''}`.trim();
  const n2 = `${vehicle.sofor2Adi || ''} ${vehicle.sofor2Soyadi || ''}`.trim();
  return !!(n1 || n2 || String(vehicle.iletisim || '').trim() || String(vehicle.tcKimlik || '').trim());
}

function _ihracatDurumPlainText(st, plateRaw) {
  if (st === 'printed') return 'Yazdırıldı';
  const v = _ihracatFindVehicleByPlate(plateRaw);
  if (!v) return 'Kayıt yok';
  if (_ihracatVehicleHasDriver(v)) return 'Şoför var';
  return 'Şoför yok';
}

function _ihracatKayitEtBtnHtml(plate) {
  const p = escapeHtml(normPlate(plate || ''));
  return `<button type="button" class="ihr-kayit-et-btn" data-plate="${p}" style="margin-top:5px;display:block;width:100%;max-width:110px;padding:4px 8px;font-size:10px;background:#4f46e5;color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:600;">Kayıt Et</button>`;
}

function _ihracatClearPlateFilter(modal) {
  if (!modal) return;
  modal.querySelectorAll('[data-ihr-filter-hidden]').forEach((el) => {
    el.style.display = '';
    el.removeAttribute('data-ihr-filter-hidden');
  });
  modal.querySelectorAll('tr[data-ihr-row-key][data-ihr-search-match]').forEach((row) => {
    row.style.outline = '';
    row.style.outlineOffset = '';
    row.removeAttribute('data-ihr-search-match');
  });
  const hint = modal.querySelector('#ihracatSearchResultHint');
  if (hint) hint.textContent = '';
}

function _ihracatFilterByPlate(modal, plateRaw) {
  if (!modal) return { found: 0 };
  const key = _ihracatPlateKey(plateRaw);
  if (!key) return { found: 0 };

  _ihracatClearPlateFilter(modal);

  const allRows = Array.from(modal.querySelectorAll('tr[data-ihr-row-key]'));
  const matches = allRows.filter((row) => {
    const p =
      row.querySelector('[data-field="plaka-text"]')?.textContent ||
      row.querySelector('[data-field="plaka"]')?.value ||
      '';
    return _ihracatPlateKey(p) === key;
  });

  if (!matches.length) return { found: 0 };

  allRows.forEach((row) => {
    if (!matches.includes(row)) {
      row.style.display = 'none';
      row.setAttribute('data-ihr-filter-hidden', '1');
    } else {
      row.style.display = '';
      row.setAttribute('data-ihr-search-match', '1');
      row.style.outline = '2px solid #6366f1';
      row.style.outlineOffset = '1px';
    }
  });

  modal.querySelectorAll('tr[data-ihr-add-row], tr[data-ihr-toplam-row]').forEach((row) => {
    row.style.display = 'none';
    row.setAttribute('data-ihr-filter-hidden', '1');
  });

  modal.querySelectorAll('[data-ihr-block-section]').forEach((section) => {
    const hasMatch = !!section.querySelector('tr[data-ihr-search-match]');
    section.style.display = hasMatch ? '' : 'none';
    if (!hasMatch) section.setAttribute('data-ihr-filter-hidden', '1');
  });

  modal.querySelectorAll('[data-ihr-file-section]').forEach((section) => {
    const hasMatch = !!section.querySelector('tr[data-ihr-search-match]');
    section.style.display = hasMatch ? '' : 'none';
    if (!hasMatch) section.setAttribute('data-ihr-filter-hidden', '1');
  });

  const first = matches[0];
  if (first) {
    try {
      first.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (e) {
      first.scrollIntoView(true);
    }
  }

  return { found: matches.length };
}

function _ihracatScrollToPlate(plateRaw, rowKey) {
  const modal = document.getElementById('ihracatDetailsModal');
  if (!modal) return false;
  let row = null;
  if (rowKey) {
    row = Array.from(modal.querySelectorAll('tr[data-ihr-row-key]')).find(
      (r) => r.getAttribute('data-ihr-row-key') === rowKey
    ) || null;
  }
  if (!row && plateRaw) {
    const key = _ihracatPlateKey(plateRaw);
    row = Array.from(modal.querySelectorAll('tr[data-ihr-row-key]')).find((r) => {
      const p =
        r.querySelector('[data-field="plaka-text"]')?.textContent ||
        r.querySelector('[data-field="plaka"]')?.value ||
        '';
      return key && _ihracatPlateKey(p) === key;
    }) || null;
  }
  if (!row) return false;
  try {
    row.scrollIntoView({ behavior: 'smooth', block: 'center' });
  } catch (e) {
    row.scrollIntoView(true);
  }
  row.style.outline = '3px solid #4f46e5';
  row.style.outlineOffset = '2px';
  setTimeout(() => {
    row.style.outline = '';
    row.style.outlineOffset = '';
  }, 2800);
  return true;
}

function _ihracatShipmentsHasPlate(plateRaw) {
  const key = _ihracatPlateKey(plateRaw);
  if (!key) return false;
  const rows = (typeof loadDailyShipments === 'function') ? (loadDailyShipments() || []) : [];
  return rows.some((s) => _ihracatPlateKey(s.plaka) === key);
}

function _ihracatPersistPendingShipment(ctx) {
  if (!ctx || !ctx.plate) return null;
  const plate = normPlate(ctx.plate);
  if (!plate) return null;
  if (_ihracatShipmentsHasPlate(plate) && !ctx.forceAdd) {
    return null;
  }

  const meta = (typeof loadDailyMeta === 'function') ? (loadDailyMeta() || {}) : {};
  const rows = (typeof loadDailyShipments === 'function') ? (loadDailyShipments() || []).slice() : [];
  const snap = ctx.pendingShipment || {};
  const template = ctx.template || {};
  const gk = _ihracatBlockGroupKey({ ...template, firma: snap.firma || template.firma, ydKey: template.ydKey });

  const isNewPlateRow = !!ctx.forceAdd;
  const newShipment = {
    ...template,
    id: isNewPlateRow ? '' : (normalizeIrsaliyeNo(snap.irsaliyeNo || '') || String(template.id || '').trim()),
    sira: String(template.sira || `M${Date.now()}`),
    plaka: plate,
    firma: (snap.firma && snap.firma !== '—') ? snap.firma : (template.firma || ''),
    malzeme: (snap.malzeme && snap.malzeme !== '—') ? snap.malzeme : (template.malzeme || ''),
    tonajKg: isNewPlateRow ? '' : (snap.tonajKg || template.tonajKg || ''),
    bbt: isNewPlateRow ? '' : (snap.bbt || template.bbt || ''),
    bosBbt: isNewPlateRow ? '' : (snap.bosBbt || template.bosBbt || ''),
    cuval: isNewPlateRow ? '' : (snap.cuval || template.cuval || ''),
    bosCuval: isNewPlateRow ? '' : (snap.bosCuval || template.bosCuval || ''),
    palet: isNewPlateRow ? '' : (snap.palet || template.palet || ''),
    irsaliyeNo: isNewPlateRow ? '' : normalizeIrsaliyeNo(snap.irsaliyeNo || ''),
    sevkYeri: snap.sevkYeri || template.sevkYeri || '',
    ambalaj: isNewPlateRow ? '' : (snap.ambalaj || template.ambalaj || template.ambalajBilgisi || ''),
    ambalajBilgisi: isNewPlateRow ? '' : (snap.ambalaj || template.ambalajBilgisi || ''),
    ydKey: template.ydKey || '',
    headerText: template.headerText || '',
    fileName: template.fileName || meta.fileName || '',
    _ihracatManual: true,
    _ihracatEdited: true,
    _ihracatEditedAt: Date.now(),
  };

  const vehicle = _ihracatFindVehicleByPlate(plate);
  if (vehicle) {
    if (!newShipment.sevkYeri && vehicle.defaultSevkYeri) newShipment.sevkYeri = vehicle.defaultSevkYeri;
  }

  const existingIdx = rows.findIndex((s) => _ihracatPlateKey(s.plaka) === _ihracatPlateKey(plate));
  let savedRow;
  if (existingIdx >= 0) {
    rows[existingIdx] = { ...rows[existingIdx], ...newShipment, plaka: plate };
    savedRow = rows[existingIdx];
  } else {
    rows.push(newShipment);
    savedRow = newShipment;
  }

  const ok = (typeof saveDailyShipments === 'function') ? saveDailyShipments(rows, meta) : false;
  if (ok) {
    try {
      purgeStrictExcelCaches();
      rebuildListsFromExcelRows(rows);
      window.refreshHeaderExcelInfo && window.refreshHeaderExcelInfo();
    } catch (e) {}
  }
  return ok ? _ihracatShipmentKey(savedRow) : null;
}

function _ihracatSnapForKayitRow(row, plateFromBtn) {
  const plate = normPlate(plateFromBtn || '');
  if (!row) return plate ? { plaka: plate } : null;
  let snap = _ihracatReadRowSnapshot(row);
  if (!snap && plate) snap = { plaka: plate };
  else if (snap && plate) snap.plaka = plate;
  if (row.getAttribute('data-ihr-add-row') === '1') {
    const prevRow = row.previousElementSibling;
    if (prevRow && prevRow.hasAttribute('data-ihr-row-key')) {
      const prevSnap = _ihracatReadRowSnapshot(prevRow);
      if (prevSnap) {
        snap = { ...prevSnap, ...(snap || {}), plaka: plate || (snap && snap.plaka) || prevSnap.plaka };
      }
    }
    snap = _ihracatStripNewPlateQtyFields(snap);
  }
  return snap;
}

function _ihracatOpenVehicleRegistration(plateRaw, opts) {
  const plate = normPlate(plateRaw || '');
  if (!plate) {
    showToast('❌ Önce geçerli bir plaka girin.', 'error');
    return;
  }
  const row = opts?.row || null;
  const rowKey = opts?.rowKey || row?.getAttribute('data-ihr-row-key') || '';
  let snap = opts?.snap || (row ? _ihracatReadRowSnapshot(row) : null) || {};

  const isAddRow = row && row.getAttribute('data-ihr-add-row') === '1';
  if (isAddRow) {
    const prevRow = row.previousElementSibling;
    if (prevRow && prevRow.hasAttribute('data-ihr-row-key')) {
      const prevSnap = _ihracatReadRowSnapshot(prevRow);
      if (prevSnap) {
        snap = { ...prevSnap, ...snap, plaka: plate };
      }
    }
    snap = _ihracatStripNewPlateQtyFields(snap);
  }

  const tbody = row?.closest('tbody[data-ihr-tbody]');
  let template = {};
  try {
    template = JSON.parse(tbody?.getAttribute('data-ihr-template') || '{}');
  } catch (e) {}

  const blockSevk = {};
  const blockAmb = {};
  const modal = document.getElementById('ihracatDetailsModal');
  if (modal) {
    modal.querySelectorAll('[data-ihr-firma-sevk]').forEach((inp) => {
      const k = inp.getAttribute('data-ihr-firma-sevk');
      if (k) blockSevk[k] = String(inp.value || '').trim();
    });
    modal.querySelectorAll('[data-ihr-firma-amb]').forEach((inp) => {
      const k = inp.getAttribute('data-ihr-firma-amb');
      if (k) blockAmb[k] = String(inp.value || '').trim();
    });
  }
  const gk = _ihracatBlockGroupKey({ ...template, firma: snap.firma || template.firma, ydKey: template.ydKey });
  if (blockSevk[gk]) snap.sevkYeri = blockSevk[gk];
  if (blockAmb[gk]) {
    snap.ambalaj = blockAmb[gk];
    snap.ambalajBilgisi = blockAmb[gk];
  }

  const forceAdd = isAddRow || !_ihracatShipmentsHasPlate(plate);

  window.__ihracatReturnContext = {
    reopen: true,
    plate,
    rowKey,
    pendingShipment: snap,
    template,
    forceAdd,
  };

  const persistedKey = _ihracatPersistPendingShipment(window.__ihracatReturnContext);
  if (persistedKey) window.__ihracatReturnContext.rowKey = persistedKey;

  document.getElementById('ihracatDetailsModal')?.remove();

  const vehicle = _ihracatFindVehicleByPlate(plate);

  if (vehicle && !_ihracatVehicleHasDriver(vehicle)) {
    if (typeof window.editVehicleRecord === 'function') {
      window.editVehicleRecord(vehicle);
      try {
        if (snap.firma) state.formData.defaultFirma = snap.firma;
        if (snap.malzeme) state.formData.defaultMalzeme = snap.malzeme;
        if (typeof window.renderApp === 'function') window.renderApp();
      } catch (e) {}
      setTimeout(() => {
        try { document.getElementById('soforAdi')?.focus(); } catch (e) {}
      }, 150);
      showToast('Şoför bilgilerini tamamlayıp kaydedin; ardından İhracat listesine dönersiniz.', 'info');
      return;
    }
  }

  if (typeof window.openNewRecordWithPlate === 'function') {
    window.openNewRecordWithPlate(plate);
    try {
      if (snap.firma) state.formData.defaultFirma = snap.firma;
      if (snap.malzeme) state.formData.defaultMalzeme = snap.malzeme;
      if (typeof window.renderApp === 'function') window.renderApp();
    } catch (e) {}
    showToast('➕ Yeni araç kaydı açıldı. Şoför bilgilerini girip kaydedin.', 'info');
    return;
  }

  try {
    state.editingId = null;
    state.showForm = true;
    state.showAll = false;
    state.searchTerm = '';
    state.formData = {
      cekiciPlaka: plate,
      dorsePlaka: '',
      soforAdi: '',
      soforSoyadi: '',
      sofor2Adi: '',
      sofor2Soyadi: '',
      iletisim: '',
      tcKimlik: '',
      defaultFirma: snap.firma || '',
      defaultMalzeme: snap.malzeme || '',
      defaultSevkYeri: '',
      defaultYuklemeNotu: '',
    };
    window.dispatchEvent(new CustomEvent('app:render-request'));
    setTimeout(() => {
      try { document.getElementById('soforAdi')?.focus(); } catch (e) {}
    }, 150);
  } catch (e) {
    showToast('❌ Kayıt formu açılamadı.', 'error');
  }
}

function _ihracatBindKayitEtAndSearch(modal) {
  modal.addEventListener('click', (e) => {
    const regBtn = e.target.closest('.ihr-kayit-et-btn');
    if (regBtn) {
      e.preventDefault();
      const plate = regBtn.getAttribute('data-plate') || '';
      const row = regBtn.closest('tr[data-ihr-row-key], tr[data-ihr-add-row]');
      const rowKey = row?.getAttribute('data-ihr-row-key') || '';
      const snap = _ihracatSnapForKayitRow(row, plate);
      _ihracatOpenVehicleRegistration(plate, { rowKey, snap, row });
    }
  });

  const runSearch = () => {
    const inp = modal.querySelector('#ihracatPlateSearch');
    const q = String(inp?.value || '').trim();
    const hint = modal.querySelector('#ihracatSearchResultHint');
    if (!q) {
      _ihracatClearPlateFilter(modal);
      if (hint) hint.textContent = '';
      showToast('Plaka yazın veya yapıştırın.', 'warn');
      return;
    }
    const { found } = _ihracatFilterByPlate(modal, q);
    const plate = normPlate(q);
    if (found > 0) {
      if (hint) {
        hint.textContent = `${plate}: ${found} kayıt listelendi`;
        hint.style.color = '#166534';
      }
      showToast(`✅ ${plate} — ${found} kayıt bulundu ve listelendi`, 'success');
    } else {
      _ihracatClearPlateFilter(modal);
      if (hint) {
        hint.textContent = `${plate}: kayıt yok`;
        hint.style.color = '#b45309';
      }
      showToast('❌ Bu plaka listede yok (boşluklu/boşluksuz deneyin).', 'warn');
    }
  };

  const runClear = () => {
    const inp = modal.querySelector('#ihracatPlateSearch');
    if (inp) inp.value = '';
    _ihracatClearPlateFilter(modal);
    const hint = modal.querySelector('#ihracatSearchResultHint');
    if (hint) hint.textContent = '';
  };

  modal.querySelector('#ihracatPlateSearchBtn')?.addEventListener('click', runSearch);
  modal.querySelector('#ihracatPlateSearchClearBtn')?.addEventListener('click', runClear);
  modal.querySelector('#ihracatPlateSearch')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      runSearch();
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      runClear();
    }
  });
  modal.querySelector('#ihracatPlateSearch')?.addEventListener('input', () => {
    const inp = modal.querySelector('#ihracatPlateSearch');
    if (!String(inp?.value || '').trim()) runClear();
  });
}

function _ihracatMaybeReopenAfterVehicleSave() {
  const ctx = window.__ihracatReturnContext;
  if (!ctx || !ctx.reopen) return;
  const plate = ctx.plate || '';
  let rowKey = ctx.rowKey || '';

  const addedKey = _ihracatPersistPendingShipment(ctx);
  if (addedKey) rowKey = addedKey;

  window.__ihracatReturnContext = null;
  window.__ihracatReopenTarget = { plate, rowKey };
  setTimeout(() => {
    showIhracatDetailsModal();
  }, 300);
}

function _ihracatScrollToReopenTarget() {
  const target = window.__ihracatReopenTarget;
  if (!target || !target.plate) return;
  const tryScroll = (attempt) => {
    const modal = document.getElementById('ihracatDetailsModal');
    if (!modal) {
      if (attempt < 8) setTimeout(() => tryScroll(attempt + 1), 150);
      return;
    }
    if (_ihracatScrollToPlate(target.plate, target.rowKey)) {
      showToast(`✅ ${target.plate} listeye eklendi.`, 'success');
      window.__ihracatReopenTarget = null;
      return;
    }
    if (attempt < 8) setTimeout(() => tryScroll(attempt + 1), 180);
    else {
      showToast('Kayıt tamam. Plakayı üstteki arama kutusundan bulabilirsiniz.', 'info');
      window.__ihracatReopenTarget = null;
    }
  };
  tryScroll(0);
}

function _ihracatRenderDurumHtml(st, plateRaw) {
  const plate = normPlate(plateRaw || '');
  const regBtn = plate ? _ihracatKayitEtBtnHtml(plate) : '';
  if (st === 'printed') {
    return '<span style="display:inline-flex;align-items:center;gap:4px;font-weight:600;color:#991b1b;" title="Yazdırıldı">🖨️ <span style="font-size:11px;">Yazdırıldı</span></span>';
  }
  const v = _ihracatFindVehicleByPlate(plateRaw);
  if (!v) {
    return `<span style="display:flex;flex-direction:column;align-items:flex-start;gap:2px;">
      <span style="display:inline-flex;align-items:center;gap:4px;" title="Sistemde kayıt yok"><span style="font-size:18px;line-height:1;">❌</span><span style="font-size:11px;color:#991b1b;font-weight:600;">Kayıt yok</span></span>
      ${regBtn}
    </span>`;
  }
  if (_ihracatVehicleHasDriver(v)) {
    return '<span style="display:inline-flex;align-items:center;gap:4px;" title="Şoför bilgisi mevcut"><span style="font-size:18px;line-height:1;color:#16a34a;">✅</span><span style="font-size:11px;color:#166534;font-weight:600;">Şoför var</span></span>';
  }
  return `<span style="display:flex;flex-direction:column;align-items:flex-start;gap:2px;">
    <span style="display:inline-flex;align-items:center;gap:4px;" title="Araç kayıtlı, şoför bilgisi eksik"><span style="font-size:18px;line-height:1;">❌</span><span style="font-size:11px;color:#991b1b;font-weight:600;">Şoför yok</span></span>
    ${regBtn}
  </span>`;
}

function _ihracatApplyDurumCell(statusCell, row, plateRaw, statusApi, stOverride) {
  if (!statusCell) return;
  const { normalizePlate, statusForPlate, statusStyle, renderDurumHtml } = statusApi;
  const raw = String(plateRaw || '').trim();
  if (!raw) {
    statusCell.innerHTML = '<span style="font-size:11px;color:#92400e;">Plaka girin</span>';
    statusCell.removeAttribute('data-ihr-durum-text');
    if (row) row.style.cssText = row.getAttribute('data-ihr-add-row') === '1' ? 'background:#fffbeb;color:#92400e;' : (row.style.cssText || '');
    return;
  }
  const plate = normalizePlate(raw);
  if (!plate || plate.replace(/\s/g, '').length < 5) {
    statusCell.innerHTML = '<span style="font-size:11px;color:#92400e;">Kontrol…</span>';
    statusCell.removeAttribute('data-ihr-durum-text');
    return;
  }
  const st = stOverride != null ? stOverride : statusForPlate(raw);
  statusCell.innerHTML = renderDurumHtml(st, raw);
  statusCell.setAttribute('data-ihr-durum-text', _ihracatDurumPlainText(st, raw));
  if (row) {
    row.style.cssText = row.getAttribute('data-ihr-add-row') === '1'
      ? 'background:#fffbeb;color:#92400e;'
      : (statusStyle[st] || '');
  }
}

function _ihracatDeleteShipmentRow(rowKey, plateRaw) {
  const rk = String(rowKey || '').trim();
  const pk = _ihracatPlateKey(plateRaw);
  const rows = (typeof loadDailyShipments === 'function') ? (loadDailyShipments() || []).slice() : [];
  const meta = (typeof loadDailyMeta === 'function') ? (loadDailyMeta() || {}) : {};
  const ephemeralKey = rk.startsWith('new__');
  const next = rows.filter((s) => {
    const sk = _ihracatShipmentKey(s);
    if (rk && sk === rk) return false;
    if (ephemeralKey && pk && _ihracatPlateKey(s.plaka) === pk && (s._ihracatManual || s._ihracatEdited)) return false;
    return true;
  });
  if (next.length === rows.length) return false;
  const ok = (typeof saveDailyShipments === 'function') ? saveDailyShipments(next, meta) : false;
  if (ok) {
    try {
      purgeStrictExcelCaches();
      rebuildListsFromExcelRows(next);
      window.refreshHeaderExcelInfo && window.refreshHeaderExcelInfo();
    } catch (e) {}
  }
  return ok;
}

function _ihracatBindRowActions(modal, statusApi) {
  const { normalizePlate } = statusApi;

  const updateRowStatus = (row, plateRaw) => {
    _ihracatApplyDurumCell(row.querySelector('[data-field="durum"]'), row, plateRaw, statusApi);
  };

  modal.addEventListener('click', (e) => {
    const editBtn = e.target.closest('.ihr-row-edit');
    if (editBtn) {
      e.preventDefault();
      const row = editBtn.closest('tr[data-ihr-row-key]');
      if (!row) return;
      const existingInp = row.querySelector('[data-field="plaka"]');
      if (existingInp) {
        existingInp.focus();
        existingInp.select();
        return;
      }
      const textEl = row.querySelector('[data-field="plaka-text"]');
      if (!textEl) return;
      const wrap = row.querySelector('[data-ihr-plaka-wrap]');
      const plate = textEl.textContent || '';
      const siraPrefix = _ihracatSiraPrefixHtml(row.getAttribute('data-ihr-sira') || '');
      wrap.innerHTML = `${siraPrefix}<input type="text" data-field="plaka" value="${escapeHtml(plate)}" style="${IHR_PLAKA_INP_STYLE}" />${_ihracatActionBtnsHtml()}`;
      const inp = wrap.querySelector('[data-field="plaka"]');
      inp.addEventListener('input', () => updateRowStatus(row, inp.value));
      inp.addEventListener('blur', () => {
        const p = normalizePlate(inp.value);
        if (p) inp.value = p;
        updateRowStatus(row, inp.value);
      });
      inp.focus();
      inp.select();
      return;
    }

    const delBtn = e.target.closest('.ihr-row-del');
    if (delBtn) {
      e.preventDefault();
      const row = delBtn.closest('tr[data-ihr-row-key]');
      if (!row) return;
      const plate =
        row.querySelector('[data-field="plaka-text"]')?.textContent?.trim() ||
        row.querySelector('[data-field="plaka"]')?.value?.trim() ||
        '';
      const msg = plate
        ? `"${plate}" plakalı sevkiyat satırı silinsin mi?`
        : 'Bu sevkiyat satırı silinsin mi?';
      if (!confirm(msg)) return;
      const key = row.getAttribute('data-ihr-row-key');
      if (key) {
        let del = [];
        try { del = JSON.parse(modal.dataset.ihrDeletedKeys || '[]'); } catch (err) {}
        if (!del.includes(key)) del.push(key);
        modal.dataset.ihrDeletedKeys = JSON.stringify(del);
      }
      const detail = row.nextElementSibling;
      if (detail && detail.classList.contains('ihr-detail-row')) detail.remove();
      const tbody = row.closest('tbody[data-ihr-tbody]');
      row.remove();
      _ihracatRefreshToplamForTbody(tbody);
      const saved = _ihracatDeleteShipmentRow(key, plate);
      if (saved) showToast(plate ? `🗑️ ${plate} silindi.` : '🗑️ Satır silindi.', 'success');
      else if (key) showToast('Satır kaldırıldı. Değişiklikleri Kaydet ile de onaylayabilirsiniz.', 'info');
    }
  });
}

function _ihracatTakipBtnHtml() {
  return `<button type="button" class="ihr-takip-btn" style="padding:5px 8px;font-size:11px;background:#2563eb;color:#fff;border:none;border-radius:6px;cursor:pointer;white-space:nowrap;font-weight:600;">Takip Formu</button>`;
}

function _ihracatReadRowSnapshot(row) {
  if (!row) return null;
  const plakaInp = row.querySelector('[data-field="plaka"]');
  const plakaText = row.querySelector('[data-field="plaka-text"]');
  const plaka = plakaInp
    ? normPlate(plakaInp.value)
    : plakaText
      ? normPlate(plakaText.textContent)
      : '';
  if (!plaka) return null;
  const readVal = (sel) => {
    const el = row.querySelector(sel);
    if (!el) return '';
    return 'value' in el ? String(el.value || '').trim() : String(el.textContent || '').trim();
  };
  return {
    plaka,
    firma: readVal('[data-field="firma"]'),
    malzeme: readVal('[data-field="malzeme"]'),
    tonajKg: readVal('[data-field="tonaj"]'),
    bbt: readVal('[data-field="bbt"]'),
    bosBbt: readVal('[data-field="bosBbt"]'),
    cuval: readVal('[data-field="cuval"]'),
    bosCuval: readVal('[data-field="bosCuval"]'),
    palet: readVal('[data-field="palet"]'),
    irsaliyeNo: readVal('[data-field="irsaliye"]'),
    durum: row.querySelector('[data-field="durum"]')?.getAttribute('data-ihr-durum-text') || readVal('[data-field="durum"]'),
  };
}

function _ihracatDetailRowHtml(rowKey, snap, vehicle) {
  const ambParts = [];
  if (snap.bbt) ambParts.push(`BBT: ${snap.bbt}`);
  if (snap.bosBbt) ambParts.push(`Boş BBT: ${snap.bosBbt}`);
  if (snap.cuval) ambParts.push(`Çuval: ${snap.cuval}`);
  if (snap.bosCuval) ambParts.push(`Boş Çuval: ${snap.bosCuval}`);
  if (snap.palet) ambParts.push(`Palet: ${snap.palet}`);
  const amb = ambParts.join(' • ') || '—';

  const sofor1 = vehicle
    ? `${String(vehicle.soforAdi || '').trim()} ${String(vehicle.soforSoyadi || '').trim()}`.trim()
    : '';
  const sofor2 = vehicle
    ? `${String(vehicle.sofor2Adi || '').trim()} ${String(vehicle.sofor2Soyadi || '').trim()}`.trim()
    : '';

  const infoLine = (label, val) => `
    <div style="margin-bottom:6px;font-size:12px;">
      <span style="color:#64748b;">${escapeHtml(label)}:</span>
      <strong style="color:#0f172a;margin-left:4px;">${escapeHtml(val || '—')}</strong>
    </div>`;

  return `
    <tr class="ihr-detail-row" data-ihr-detail-for="${escapeHtml(rowKey)}" style="background:#f1f5f9;">
      <td colspan="8" style="border:1px solid #ddd;padding:0;">
        <div style="padding:12px 14px;border-left:4px solid #2563eb;">
          <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:10px;">
            <strong style="font-size:13px;color:#1e3a8a;">📋 Takip Özeti — ${escapeHtml(snap.plaka)}</strong>
            <button type="button" class="ihr-takip-full-btn" data-ihr-row-key="${escapeHtml(rowKey)}" style="padding:6px 12px;font-size:11px;background:#16a34a;color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:600;">Tam Takip Formunu Aç</button>
          </div>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px;">
            <div style="background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:10px;">
              <div style="font-size:11px;font-weight:700;color:#4338ca;margin-bottom:8px;">SEVKİYAT BİLGİLERİ</div>
              ${infoLine('Firma', snap.firma)}
              ${infoLine('Malzeme', snap.malzeme)}
              ${infoLine('Miktar (Kg)', snap.tonajKg)}
              ${infoLine('Ambalaj', amb)}
              ${infoLine('İrsaliye', snap.irsaliyeNo)}
              ${infoLine('Durum', snap.durum)}
            </div>
            <div style="background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:10px;">
              <div style="font-size:11px;font-weight:700;color:#4338ca;margin-bottom:8px;">ŞOFÖR BİLGİLERİ</div>
              ${vehicle ? infoLine('Çekici', vehicle.cekiciPlaka || snap.plaka) : infoLine('Çekici', snap.plaka)}
              ${vehicle && vehicle.dorsePlaka ? infoLine('Dorse', vehicle.dorsePlaka) : ''}
              ${infoLine('Şoför 1', sofor1 || 'Kayıt yok')}
              ${sofor2 ? infoLine('Şoför 2', sofor2) : ''}
              ${infoLine('Telefon', vehicle?.iletisim || '—')}
              ${infoLine('TC Kimlik', vehicle?.tcKimlik || '—')}
              ${!vehicle ? '<div style="font-size:11px;color:#b45309;margin-top:6px;">Bu plaka henüz sisteme kayıtlı değil. Tam formdan kayıt açabilirsiniz.</div>' : ''}
            </div>
          </div>
        </div>
      </td>
    </tr>
  `;
}
