// app-ihracat-modal.js — ihracat modal, satır işlemleri
// Otomatik bölüm — scripts/modularize-remaining.js

/** Satır kimliği — çoklu Excel'de aynı plaka/irsaliye farklı dosyalarda çakışmasın diye blok kapsamı eklenir */
function _ihracatShipmentKey(s) {
  if (!s) return '';
  const scope = _ihracatBlockGroupKey(s);
  if (s._ihracatEmptyBlock) {
    return `${scope}::__empty__${String(s.id || s.blockKey || '').trim()}`;
  }
  return `${scope}::${String(s.plaka || '').trim()}__${String(s.id || '').trim()}__${String(s.sira || '').trim()}`;
}

function _ihracatFirmaGroupKey(s) {
  const m = String(s.ydKey || s.firma || 'GENEL').match(/\b(YD\d{1,4})\b/i);
  const raw = (m ? m[1] : String(s.firma || 'GENEL')).toUpperCase();
  return raw.replace(/[^A-Z0-9]/g, '_') || 'GENEL';
}

function _ihracatBlockContentKey(s) {
  const stored = String(s?.blockKey || '').trim();
  if (stored) return stored;
  if (s?.blockHeaderRow != null) return `BLK_${s.blockHeaderRow}`;

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

/** Excel’deki her sevkiyat bloğu ayrı — çoklu dosyada aynı BLK_N satır numarası çakışmasın diye fileName eklenir */
function _ihracatBlockGroupKey(s) {
  if (typeof window !== 'undefined' && typeof window.buildIhracatLoadedRowBlockId === 'function') {
    return window.buildIhracatLoadedRowBlockId(s);
  }
  let fileName = '';
  try {
    const meta = (typeof loadDailyMeta === 'function') ? (loadDailyMeta() || {}) : {};
    if (typeof resolveIhracatRowFileLabel === 'function') {
      fileName = String(resolveIhracatRowFileLabel(s, meta) || '').trim();
    }
  } catch (e) { /* ignore */ }
  if (!fileName) fileName = String(s?.fileName || '').trim();
  const contentKey = _ihracatBlockContentKey(s);
  return fileName ? `${fileName}::${contentKey}` : contentKey;
}

function isIhracatEmptyBlockRow(s) {
  return !!(s && s._ihracatEmptyBlock);
}

function ihracatFilterPlateRows(rows) {
  return (rows || []).filter((r) => !isIhracatEmptyBlockRow(r));
}

function ihracatCountPlateRows(rows) {
  return ihracatFilterPlateRows(rows).length;
}

function ihracatCountBlocks(rows) {
  const keys = new Set();
  (rows || []).forEach((r) => {
    if (!r) return;
    if (r.blockKey || r.blockHeaderRow != null || r._ihracatEmptyBlock) {
      keys.add(_ihracatBlockGroupKey(r));
    }
  });
  return keys.size;
}

function _ihracatPurgeEmptyBlockPlaceholders(rows) {
  const blocksWithPlates = new Set();
  (rows || []).forEach((r) => {
    if (isIhracatEmptyBlockRow(r)) return;
    if (String(r.plaka || '').trim()) blocksWithPlates.add(_ihracatBlockGroupKey(r));
  });
  return (rows || []).filter((r) => {
    if (!isIhracatEmptyBlockRow(r)) return true;
    return !blocksWithPlates.has(_ihracatBlockGroupKey(r));
  });
}

function _ihracatEmptyBlockHintRowHtml(sample) {
  return `
    <tr data-ihr-empty-block-hint="1">
      <td colspan="${IHR_EXCEL_SHEET_COLS}" style="border:1px dashed #cbd5e1;padding:14px 12px;background:#f8fafc;color:#475569;font-size:12px;line-height:1.5;text-align:center;">
        <strong style="display:block;color:#64748b;margin-bottom:4px;">Henüz plaka girilmemiş</strong>
        Excel'de bu sevkiyat bloğu için araç satırı boş. Plakalar girildiğinde burada listelenecek.
        Manuel eklemek için alttaki boş satıra plaka yazın.
      </td>
    </tr>`;
}

function _ihracatExtractBlockPlannedSummary(sample) {
  const ht = String(sample?.headerText || sample?.blockMeta?.mainHeader || '').replace(/\s+/g, ' ');
  const parts = [];
  const book = (ht.match(/BOOKING\s*NO\s*:\s*([A-Z0-9]+)/i) || [])[1];
  if (book) parts.push(`Booking ${book}`);
  const ton = (ht.match(/(\d+)\s*TON\b/i) || [])[1];
  if (ton) parts.push(`${ton} ton`);
  const bbt = (ht.match(/(\d+)\s*BBT\b/i) || [])[1];
  if (bbt) parts.push(`${bbt} BBT`);
  const cuval = (ht.match(/(\d+)\s*(?:ÇUVAL|CUVAL)\b/i) || [])[1];
  if (cuval) parts.push(`${cuval} çuval`);
  const palet = (ht.match(/(\d+)\s*PALET\b/i) || [])[1];
  if (palet) parts.push(`${palet} palet`);

  const totals = sample?.blockTotals || null;
  if (totals && !bbt && String(totals.bbt || '').trim()) parts.push(`${totals.bbt} BBT`);
  if (totals && !cuval && String(totals.cuval || '').trim()) parts.push(`${totals.cuval} çuval`);
  return parts.join(' · ');
}

function _ihracatBlockAutoSevk(sample) {
  if (typeof extractPrimaryPortFromShipment === 'function') {
    return String(extractPrimaryPortFromShipment(sample || {}) || '').trim();
  }
  return '';
}

function _ihracatBlockAutoAmb(sample) {
  const ht = String(sample?.blockMeta?.mainHeader || sample?.headerText || '').trim();
  if (typeof extractPrimaryAmbalajFromHeader === 'function') {
    return String(extractPrimaryAmbalajFromHeader(ht) || '').trim();
  }
  return '';
}

function _ihracatNormBlockField(v) {
  return String(v || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toUpperCase()
    .replace(/İ/g, 'I')
    .replace(/Ş/g, 'S')
    .replace(/Ğ/g, 'G')
    .replace(/Ü/g, 'U')
    .replace(/Ö/g, 'O')
    .replace(/Ç/g, 'C');
}

function _ihracatNormAmbField(v) {
  const s = _ihracatNormBlockField(v);
  const numMatch = s.match(/(\d[\d.,]*)/);
  if (numMatch) {
    const raw = numMatch[1].replace(/\./g, '').replace(',', '.');
    const n = parseFloat(raw);
    if (Number.isFinite(n)) return `N${n}`;
  }
  return s.replace(/\b(KG|KGLIK|KGLİK|LIK|LİK|NET|BASKISIZ)\b/g, '').replace(/\s+/g, ' ').trim();
}

function _ihracatBlockSevkAmbDiffersFromExcel(sample, curSevk, curAmb) {
  if (!sample) return false;
  const autoSevk = _ihracatBlockAutoSevk(sample);
  const autoAmb = _ihracatBlockAutoAmb(sample);
  const sevk = curSevk !== undefined
    ? String(curSevk || '').trim()
    : String(sample.sevkYeri || '').trim();
  const amb = curAmb !== undefined
    ? String(curAmb || '').trim()
    : String(sample.ambalaj || sample.ambalajBilgisi || '').trim();

  if (autoSevk && sevk && _ihracatNormBlockField(sevk) !== _ihracatNormBlockField(autoSevk)) return true;
  if (autoAmb && amb && _ihracatNormAmbField(amb) !== _ihracatNormAmbField(autoAmb)) return true;
  if (!autoSevk && sevk && sample._ihracatBlockEdited) return true;
  if (!autoAmb && amb && sample._ihracatBlockEdited) return true;
  return false;
}

function _ihracatSampleForBlockKey(shipments, gk) {
  return (shipments || []).find((s) => _ihracatBlockGroupKey(s) === gk) || null;
}

function _ihracatIsBlockManuallyEdited(sample, meta, curSevk, curAmb) {
  if (!sample) return false;
  const gk = _ihracatBlockGroupKey(sample);
  const ov = meta?.blockOverrides?.[gk];
  let sevk = curSevk;
  let amb = curAmb;
  if (sevk === undefined && ov && Object.prototype.hasOwnProperty.call(ov, 'sevkYeri')) {
    sevk = ov.sevkYeri;
  }
  if (amb === undefined && ov && Object.prototype.hasOwnProperty.call(ov, 'ambalaj')) {
    amb = ov.ambalaj;
  }
  return _ihracatBlockSevkAmbDiffersFromExcel(sample, sevk, amb);
}

function _ihracatManualEditBadgeHtml() {
  return '<span data-ihr-manual-edit-badge="1" style="font-size:10px;font-weight:700;color:#92400e;background:#ffedd5;border:1px solid #fdba74;padding:3px 8px;border-radius:999px;flex-shrink:0;">✎ Elle düzenlendi</span>';
}

function _ihracatCollectDistinctPorts(shipments, meta) {
  const ports = new Set();
  (shipments || []).forEach((s) => {
    const sevk = String(_defaultSevkForShipment(s) || '').trim();
    if (sevk) ports.add(sevk);
  });
  Object.values(meta?.blockOverrides || {}).forEach((ov) => {
    const sevk = String(ov?.sevkYeri || '').trim();
    if (sevk) ports.add(sevk);
  });
  return Array.from(ports).sort((a, b) => a.localeCompare(b, 'tr'));
}

function _ihracatCaptureModalEditSnapshot(modal) {
  const snap = { blockSevk: {}, blockAmb: {}, rows: {} };
  if (!modal) return snap;
  modal.querySelectorAll('[data-ihr-firma-sevk]').forEach((inp) => {
    const k = inp.getAttribute('data-ihr-firma-sevk');
    if (k) snap.blockSevk[k] = String(inp.value || '').trim();
  });
  modal.querySelectorAll('[data-ihr-firma-amb]').forEach((inp) => {
    const k = inp.getAttribute('data-ihr-firma-amb');
    if (k) snap.blockAmb[k] = String(inp.value || '').trim();
  });
  modal.querySelectorAll('tr[data-ihr-row-key]').forEach((row) => {
    const key = row.getAttribute('data-ihr-row-key');
    if (!key) return;
    const read = (sel) => String(row.querySelector(sel)?.value || '').trim();
    snap.rows[key] = {
      tonaj: read('[data-field="tonaj"]'),
      irsaliye: read('[data-field="irsaliye"]'),
      bbt: read('[data-field="bbt"]'),
      bosBbt: read('[data-field="bosBbt"]'),
      cuval: read('[data-field="cuval"]'),
      bosCuval: read('[data-field="bosCuval"]'),
      palet: read('[data-field="palet"]'),
    };
  });
  return snap;
}

function _ihracatModalHasUnsavedChanges(modal, initialSnap) {
  if (!modal || !initialSnap) return false;
  const cur = _ihracatCaptureModalEditSnapshot(modal);
  const eqObj = (a, b) => JSON.stringify(a || {}) === JSON.stringify(b || {});
  if (!eqObj(cur.blockSevk, initialSnap.blockSevk)) return true;
  if (!eqObj(cur.blockAmb, initialSnap.blockAmb)) return true;
  if (!eqObj(cur.rows, initialSnap.rows)) return true;
  return false;
}

function _ihracatBlockSectionIsManuallyEdited(section) {
  if (!section) return false;
  const autoSevk = String(section.getAttribute('data-ihr-sevk-auto') || '').trim();
  const autoAmb = String(section.getAttribute('data-ihr-amb-auto') || '').trim();
  const curSevk = String(section.querySelector('[data-ihr-firma-sevk]')?.value || '').trim();
  const curAmb = String(section.querySelector('[data-ihr-firma-amb]')?.value || '').trim();
  if (autoSevk && curSevk && _ihracatNormBlockField(curSevk) !== _ihracatNormBlockField(autoSevk)) return true;
  if (autoAmb && curAmb && _ihracatNormAmbField(curAmb) !== _ihracatNormAmbField(autoAmb)) return true;
  return false;
}

function _ihracatRefreshBlockManualBadges(modal) {
  if (!modal) return;
  modal.querySelectorAll('[data-ihr-block-section]').forEach((section) => {
    const headerBtn = section.querySelector('[data-ihr-collapse-trigger]');
    if (!headerBtn) return;
    const show = _ihracatBlockSectionIsManuallyEdited(section);
    let badge = headerBtn.querySelector('[data-ihr-manual-edit-badge]');
    if (show && !badge) {
      headerBtn.insertAdjacentHTML('beforeend', _ihracatManualEditBadgeHtml());
    } else if (!show && badge) {
      badge.remove();
    }
  });
}

function _ihracatBuildYdPortConflictLines(modal) {
  if (!modal) return [];
  const byYd = new Map();
  modal.querySelectorAll('[data-ihr-block-section]').forEach((section) => {
    const yd = String(section.getAttribute('data-ihr-yd') || '').trim().toUpperCase();
    const sevk = String(section.querySelector('[data-ihr-firma-sevk]')?.value || '').trim();
    const title = String(section.querySelector('strong')?.textContent || '').trim();
    if (!yd || !sevk) return;
    if (!byYd.has(yd)) byYd.set(yd, []);
    byYd.get(yd).push({ sevk, title });
  });
  const lines = [];
  byYd.forEach((entries, yd) => {
    const ports = [...new Set(entries.map((e) => e.sevk.toUpperCase()))];
    if (ports.length <= 1) return;
    const detail = entries.map((e) => `${e.title || 'Blok'} → ${e.sevk}`).join(' · ');
    lines.push(`<li style="margin-bottom:6px;"><strong>${escapeHtml(yd)}</strong> farklı limanlarda: ${escapeHtml(ports.join(', '))} <span style="color:#78716c;">(${escapeHtml(detail)})</span></li>`);
  });
  return lines;
}

function _ihracatRefreshYdPortWarnings(modal) {
  if (!modal) return;
  const box = modal.querySelector('#ihracatYdPortWarnings');
  if (!box) return;
  const lines = _ihracatBuildYdPortConflictLines(modal);
  if (!lines.length) {
    box.style.display = 'none';
    box.innerHTML = '';
    return;
  }
  box.style.display = 'block';
  box.innerHTML = `
    <div style="margin-bottom:14px;background:#fff7ed;border:1px solid #fdba74;border-radius:8px;font-size:12px;color:#9a3412;line-height:1.45;padding:10px 12px;">
      <div style="font-weight:800;margin-bottom:6px;">⚠️ Aynı YD kodu farklı limanlarda</div>
      <ul style="margin:0;padding-left:18px;font-size:11px;">${lines.join('')}</ul>
    </div>`;
}

function _ihracatApplyPortFilter(modal) {
  const sel = modal?.querySelector('#ihracatPortFilter');
  if (!sel || !modal) return;
  const needle = String(sel.value || '').trim().toUpperCase();
  let visible = 0;
  modal.querySelectorAll('[data-ihr-block-section]').forEach((section) => {
    const sevk = String(section.querySelector('[data-ihr-firma-sevk]')?.value || '').trim().toUpperCase();
    const show = !needle || sevk === needle || sevk.includes(needle);
    section.style.display = show ? '' : 'none';
    if (show) visible += 1;
  });
  const hint = modal.querySelector('#ihracatPortFilterHint');
  if (hint) {
    hint.textContent = needle ? `${visible} blok gösteriliyor` : '';
  }
}

async function _ihracatPromptSaveOrCancelUnsaved() {
  const msg = 'Kaydedilmemiş değişiklikler var.';
  const rpUi = window.rpUi;
  if (rpUi && typeof rpUi.alertActions === 'function') {
    return rpUi.alertActions(msg, 'warning', [
      { label: 'İptal', value: 'cancel', className: 'rp-dialog-btn-ghost' },
      { label: 'Kaydet', value: 'save', className: 'rp-dialog-btn-primary' },
    ]);
  }
  return 'cancel';
}

function _ihracatBindModalEnhancements(modal, meta, shipments, handlers) {
  if (!modal) return;
  handlers = handlers || {};
  modal.__ihrInitialSnapshot = _ihracatCaptureModalEditSnapshot(modal);

  const refreshUx = () => {
    _ihracatRefreshBlockManualBadges(modal);
    _ihracatRefreshYdPortWarnings(modal);
  };
  refreshUx();

  modal.querySelectorAll('[data-ihr-firma-sevk], [data-ihr-firma-amb]').forEach((inp) => {
    inp.addEventListener('input', refreshUx);
    inp.addEventListener('change', () => {
      refreshUx();
      _ihracatApplyPortFilter(modal);
    });
  });

  const portSel = modal.querySelector('#ihracatPortFilter');
  if (portSel) {
    portSel.addEventListener('change', () => _ihracatApplyPortFilter(modal));
  }
  modal.querySelector('#ihracatPortFilterClear')?.addEventListener('click', () => {
    if (portSel) portSel.value = '';
    _ihracatApplyPortFilter(modal);
  });

  const tryClose = async () => {
    if (_ihracatModalHasUnsavedChanges(modal, modal.__ihrInitialSnapshot)) {
      const choice = await _ihracatPromptSaveOrCancelUnsaved();
      if (choice !== 'save') return;
      if (typeof handlers.onSave === 'function') {
        const saved = await Promise.resolve(handlers.onSave());
        if (!saved) return;
        return;
      }
    }
    if (typeof handlers.onClose === 'function') handlers.onClose();
    else modal.remove();
  };

  modal.__ihracatTryClose = tryClose;

  modal.querySelector('#closeIhracatModal')?.addEventListener('click', tryClose);

  modal.addEventListener('input', (e) => {
    const t = e.target;
    if (!t || !t.closest('tr[data-ihr-row-key]')) return;
    modal.__ihrInitialSnapshot = modal.__ihrInitialSnapshot || {};
  });
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
  const cols = Number(opts?.colSpan) > 0 ? Number(opts.colSpan) : IHR_EXCEL_SHEET_COLS;
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
  const metaOv = _ihracatBlockOverrideForShipment(s);
  if (metaOv && String(metaOv.sevkYeri || '').trim()) return String(metaOv.sevkYeri).trim();
  const fromBlock = typeof extractPrimaryPortFromShipment === 'function'
    ? extractPrimaryPortFromShipment(s)
    : '';
  if (fromBlock) return fromBlock;
  const cands = getLimanCandidates(s.headerText || '');
  return cands[0] || '';
}

function _defaultAmbalajTextForShipment(s) {
  const direct = String(s.ambalaj || s.ambalajBilgisi || '').trim();
  if (direct) return direct;
  const metaOv = _ihracatBlockOverrideForShipment(s);
  if (metaOv && String(metaOv.ambalaj || '').trim()) return String(metaOv.ambalaj).trim();
  const ht = String(s.blockMeta?.mainHeader || s.headerText || '').trim();
  const fromHeader = typeof extractPrimaryAmbalajFromHeader === 'function'
    ? extractPrimaryAmbalajFromHeader(ht)
    : '';
  if (fromHeader) return fromHeader;
  const cands = getAmbalajCandidates(ht);
  return cands[cands.length - 1] || cands[0] || '';
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

  const sevk = Object.prototype.hasOwnProperty.call(blockSevk, gk)
    ? String(blockSevk[gk] || '').trim()
    : String(cur.sevkYeri || '').trim();
  cur.sevkYeri = sevk;
  if (Object.prototype.hasOwnProperty.call(blockAmb, gk)) {
    const amb = String(blockAmb[gk] || '').trim();
    cur.ambalaj = amb;
    cur.ambalajBilgisi = amb;
  }

  cur._ihracatEdited = true;
  cur._ihracatEditedAt = Date.now();
  const blockSevkVal = Object.prototype.hasOwnProperty.call(blockSevk, gk) ? blockSevk[gk] : undefined;
  const blockAmbVal = Object.prototype.hasOwnProperty.call(blockAmb, gk) ? blockAmb[gk] : undefined;
  if (blockSevkVal !== undefined || blockAmbVal !== undefined) {
    if (_ihracatBlockSevkAmbDiffersFromExcel(cur, blockSevkVal, blockAmbVal)) {
      cur._ihracatBlockEdited = true;
    } else {
      delete cur._ihracatBlockEdited;
    }
  }
  return cur;
}

function _ihracatBlockOverrideForShipment(s) {
  try {
    const meta = typeof loadDailyMeta === 'function' ? (loadDailyMeta() || {}) : {};
    const gk = _ihracatBlockGroupKey(s);
    return (meta.blockOverrides && meta.blockOverrides[gk]) || null;
  } catch (e) {
    return null;
  }
}

function _ihracatMergeBlockOverridesIntoMeta(meta, blockSevk, blockAmb, shipments) {
  const out = { ...(meta || {}) };
  const overrides = { ...(out.blockOverrides || {}) };
  const gks = new Set([
    ...Object.keys(blockSevk || {}),
    ...Object.keys(blockAmb || {}),
    ...Object.keys(overrides || {}),
  ]);
  const now = new Date().toISOString();
  gks.forEach((gk) => {
    const sample = _ihracatSampleForBlockKey(shipments, gk);
    const hasSevk = Object.prototype.hasOwnProperty.call(blockSevk || {}, gk);
    const hasAmb = Object.prototype.hasOwnProperty.call(blockAmb || {}, gk);
    const sevk = hasSevk ? blockSevk[gk] : (overrides[gk]?.sevkYeri);
    const amb = hasAmb ? blockAmb[gk] : (overrides[gk]?.ambalaj);
    const differs = _ihracatBlockSevkAmbDiffersFromExcel(sample, sevk, amb);
    if (!differs) {
      delete overrides[gk];
      return;
    }
    const prev = { ...(overrides[gk] || {}) };
    if (hasSevk) prev.sevkYeri = blockSevk[gk];
    if (hasAmb) prev.ambalaj = blockAmb[gk];
    prev.updatedAt = now;
    prev.manual = true;
    overrides[gk] = prev;
  });
  out.blockOverrides = Object.keys(overrides).length ? overrides : undefined;
  return out;
}

function _ihracatApplyBlockFieldsToMap(byKey, blockSevk, blockAmb) {
  if (!byKey || typeof byKey.forEach !== 'function') return;
  byKey.forEach((cur, key) => {
    if (!cur) return;
    const gk = _ihracatBlockGroupKey(cur);
    const hasSevk = Object.prototype.hasOwnProperty.call(blockSevk, gk);
    const hasAmb = Object.prototype.hasOwnProperty.call(blockAmb, gk);
    if (!hasSevk && !hasAmb) return;
    const patch = { ...cur };
    if (hasSevk) patch.sevkYeri = String(blockSevk[gk] || '').trim();
    if (hasAmb) {
      patch.ambalaj = String(blockAmb[gk] || '').trim();
      patch.ambalajBilgisi = patch.ambalaj;
    }
    if (_ihracatBlockSevkAmbDiffersFromExcel(cur, hasSevk ? patch.sevkYeri : undefined, hasAmb ? patch.ambalaj : undefined)) {
      patch._ihracatBlockEdited = true;
      patch._ihracatEdited = true;
      patch._ihracatEditedAt = Date.now();
    } else {
      delete patch._ihracatBlockEdited;
    }
    byKey.set(key, patch);
  });
}

function _ihracatSyncActiveShipmentCache(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const syncOne = (ref) => {
    if (!ref) return;
    const key = _ihracatShipmentKey(ref);
    const updated = list.find((s) => _ihracatShipmentKey(s) === key);
    if (updated) {
      try { window.__activeExcelShipment = { ...updated }; } catch (e) {}
      try { window.__lastChosenShipment = { ...updated }; } catch (e) {}
    }
  };
  try { syncOne(window.__activeExcelShipment); } catch (e) {}
  try { syncOne(window.__lastChosenShipment); } catch (e) {}
}

function _ihracatApplyBlockOverridesToRows(rows, meta) {
  const overrides = meta?.blockOverrides;
  if (!overrides || typeof overrides !== 'object') return rows;
  return (rows || []).map((row) => {
    if (!row) return row;
    const gk = _ihracatBlockGroupKey(row);
    const ov = overrides[gk];
    if (!ov) return row;
    const out = { ...row };
    if (String(ov.sevkYeri || '').trim()) {
      out.sevkYeri = String(ov.sevkYeri).trim();
    }
    if (String(ov.ambalaj || '').trim()) {
      out.ambalaj = String(ov.ambalaj).trim();
      out.ambalajBilgisi = out.ambalaj;
    }
    if (String(ov.sevkYeri || ov.ambalaj || '').trim()) {
      out._ihracatBlockEdited = true;
    }
    return out;
  });
}

async function _saveIhracatDetailsFromModal(originalShipments, meta) {
  const modal = document.getElementById('ihracatDetailsModal');
  if (!modal) return false;

  let metaWork = { ...(meta || {}) };
  let sourceRows = Array.isArray(originalShipments) ? originalShipments.map((s) => ({ ...s })) : [];
  if (typeof repairIhracatRowFileNames === 'function') {
    const repaired = repairIhracatRowFileNames(sourceRows, metaWork);
    sourceRows = repaired.rows;
    metaWork = repaired.meta;
    if (repaired.changed) {
      sourceRows.forEach((r) => {
        if (!r || !r.fileName) return;
        const parts = typeof splitIhracatFileNames === 'function'
          ? splitIhracatFileNames(r.fileName)
          : [String(r.fileName).trim()];
        if (parts.length === 1) r.fileName = parts[0];
      });
    }
  }

  const plateBefore = typeof ihracatCountPlateRows === 'function'
    ? ihracatCountPlateRows(sourceRows)
    : sourceRows.filter((r) => r && !r._ihracatEmptyBlock).length;

  const byKey = new Map();
  sourceRows.forEach((s) => {
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

  const legacyKey = (s) => `${String(s.plaka || '').trim()}__${String(s.id || '').trim()}__${String(s.sira || '').trim()}`;

  modal.querySelectorAll('tr[data-ihr-row-key]').forEach((row) => {
    let key = row.getAttribute('data-ihr-row-key');
    if (!key) return;

    let cur = byKey.get(key);
    const isNew = row.getAttribute('data-ihr-is-new') === '1' || String(key).startsWith('new__');
    if (!cur && !isNew) {
      for (const s of byKey.values()) {
        if (legacyKey(s) === key || _ihracatShipmentKey(s) === key) {
          cur = s;
          key = _ihracatShipmentKey(s);
          break;
        }
      }
    }
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
    byKey.set(_ihracatShipmentKey(updated), updated);
  });

  let deletedKeys = [];
  try { deletedKeys = JSON.parse(modal.dataset.ihrDeletedKeys || '[]'); } catch (e) {}
  deletedKeys.forEach((k) => {
    byKey.delete(k);
    for (const [sk, sv] of byKey.entries()) {
      if (legacyKey(sv) === k || sk === k) byKey.delete(sk);
    }
  });

  _ihracatApplyBlockFieldsToMap(byKey, blockSevk, blockAmb);

  let rows = _ihracatPurgeEmptyBlockPlaceholders(Array.from(byKey.values()));
  let metaToSave = _ihracatMergeBlockOverridesIntoMeta(metaWork, blockSevk, blockAmb, Array.from(byKey.values()));
  if (typeof repairIhracatRowFileNames === 'function') {
    const repaired = repairIhracatRowFileNames(rows, metaToSave);
    rows = repaired.rows;
    metaToSave = repaired.meta;
  }

  const plateAfter = typeof ihracatCountPlateRows === 'function'
    ? ihracatCountPlateRows(rows)
    : rows.filter((r) => r && !r._ihracatEmptyBlock).length;
  if (plateBefore > 0 && plateAfter < plateBefore) {
    console.error('[ihracat] Kaydetme iptal: plaka satırı düşürüldü', plateBefore, '→', plateAfter);
    return false;
  }

  const ok = await saveDailyShipments(rows, metaToSave);
  if (!ok) return false;

  try {
    const persisted = (typeof loadDailyShipments === 'function') ? (loadDailyShipments() || []) : [];
    const persistedPlate = typeof ihracatCountPlateRows === 'function'
      ? ihracatCountPlateRows(persisted)
      : persisted.filter((r) => r && !r._ihracatEmptyBlock).length;
    if (plateAfter > 0 && persistedPlate < plateAfter) {
      console.error('[ihracat] localStorage doğrulama başarısız', plateAfter, persistedPlate);
      return false;
    }
    purgeStrictExcelCaches();
    rebuildListsFromExcelRows(rows);
    _ihracatSyncActiveShipmentCache(rows);
    window.refreshHeaderExcelInfo && window.refreshHeaderExcelInfo();
  } catch (e) {}
  return true;
}

function _ihracatPlateKey(value) {
  const formatted = normPlate(value || '');
  return _plateKeyForMatch(formatted || value);
}

function _ihracatBuildVehiclePlateMap() {
  const map = new Map();
  // Önce yalnızca çekici plakalar — dorse eşlemesi yanlış çekici kartına bağlanmasın
  (state.vehicles || []).forEach((v) => {
    const k = _ihracatPlateKey(v?.cekiciPlaka);
    if (k && !map.has(k)) map.set(k, v);
  });
  (state.vehicles || []).forEach((v) => {
    [v.dorsePlaka, v.plaka].forEach((raw) => {
      const k = _ihracatPlateKey(raw);
      if (k && !map.has(k)) map.set(k, v);
    });
  });
  return map;
}

function _ihracatFindVehicleByPlate(plateRaw, opts) {
  const key = _ihracatPlateKey(plateRaw);
  if (!key) return null;
  const cekiciOnly = !!(opts && opts.cekiciOnly);
  const vehicles = state.vehicles || [];

  const byCekici = vehicles.find((v) => _ihracatPlateKey(v?.cekiciPlaka) === key);
  if (byCekici) return byCekici;
  if (cekiciOnly) return null;

  const modalMap = window.__ihracatModalVehicleMap;
  if (modalMap instanceof Map) return modalMap.get(key) || null;

  return vehicles.find((v) => {
    const plates = [v.dorsePlaka, v.plaka].filter(Boolean);
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

const IHR_EXCEL_SHEET_COLS = 11;
const IHR_EXCEL_TH =
  'border:1px solid #ddd;padding:3px 4px;font-size:9px;font-weight:700;text-align:center;background:#f5f5f5;vertical-align:middle;white-space:nowrap;';
const IHR_EXCEL_TD =
  'border:1px solid #ddd;padding:3px 4px;text-align:center;vertical-align:middle;background:#fff;font-size:11px;';
const IHR_EXCEL_TD_SIL = `${IHR_EXCEL_TD}width:34px;min-width:34px;padding:2px;`;
const IHR_EXCEL_TD_IRS = `${IHR_EXCEL_TD}font-weight:700;`;
const IHR_EXCEL_TD_BOLD = `${IHR_EXCEL_TD}font-weight:700;`;
const IHR_EXCEL_INP =
  'width:100%;max-width:54px;padding:2px 3px;border:1px solid #cbd5e1;border-radius:4px;font-size:10px;box-sizing:border-box;text-align:center;background:#fff;';
const IHR_EXCEL_INP_WIDE =
  'width:100%;max-width:40px;padding:2px 3px;border:1px solid #cbd5e1;border-radius:4px;font-size:10px;box-sizing:border-box;text-align:center;background:#fff;';
const IHR_EXCEL_INP_IRS =
  'width:100%;max-width:108px;padding:2px 4px;border:1px solid #cbd5e1;border-radius:4px;font-size:10px;box-sizing:border-box;text-align:center;background:#fff;font-weight:700;';
const IHR_EXCEL_PLAKA_INP =
  'width:100%;min-width:72px;max-width:none;padding:2px 4px;border:1px solid #cbd5e1;border-radius:4px;font-size:11px;font-weight:700;box-sizing:border-box;text-align:center;background:#fff;';
const IHR_EXCEL_PLAKA_INP_ADD =
  'width:100%;min-width:72px;max-width:none;padding:2px 4px;border:1px dashed #f59e0b;border-radius:4px;font-size:11px;box-sizing:border-box;text-align:center;background:#fff;';
const IHR_EXCEL_PLAKA_TD = `${IHR_EXCEL_TD_BOLD}min-width:102px;white-space:nowrap;`;

function _ihracatExcelFieldInpHtml(field, value, extraStyle) {
  const style = _ihracatAmbalajFieldInpStyle(field, IHR_EXCEL_INP);
  const wideStyle = _ihracatAmbalajFieldInpStyle(field, IHR_EXCEL_INP_WIDE);
  const inpStyle = field === 'bbt' || field === 'bosBbt' || field === 'cuval' || field === 'bosCuval'
    ? wideStyle
    : style;
  return `<input type="text" data-field="${field}" value="${escapeHtml(String(value ?? ''))}" maxlength="${_ihracatAmbalajFieldMaxLen(field)}" inputmode="numeric" style="${inpStyle}${extraStyle || ''}" />`;
}

function _ihracatRowDelBtnHtml() {
  return `<button type="button" class="ihr-row-del" title="Satırı sil" aria-label="Satırı sil" style="padding:2px 6px;font-size:10px;background:#fee2e2;color:#dc2626;border:1px solid #fecaca;border-radius:4px;cursor:pointer;font-weight:600;line-height:1.2;">Sil</button>`;
}

function _ihracatRenderExcelSheetTableHead() {
  return `
    <tr class="ihr-excel-sheet-head">
      <th style="${IHR_EXCEL_TH}width:34px;min-width:34px;padding:2px;"></th>
      <th style="${IHR_EXCEL_TH}">İrsaliye</th>
      <th style="${IHR_EXCEL_TH}">PLAKA</th>
      <th style="${IHR_EXCEL_TH}">BBT</th>
      <th style="${IHR_EXCEL_TH}">ÇUVAL</th>
      <th style="${IHR_EXCEL_TH}">PALET</th>
      <th style="${IHR_EXCEL_TH}">BOŞ BBT</th>
      <th style="${IHR_EXCEL_TH}">BOŞ ÇUVAL</th>
      <th style="${IHR_EXCEL_TH}">NET TONAJ</th>
      <th style="${IHR_EXCEL_TH}">Takip</th>
      <th style="${IHR_EXCEL_TH}">Durum</th>
    </tr>`;
}

function _ihracatRenderExcelSheetDataRow(s, ctx) {
  const {
    status,
    irsCollisionSet,
    dupPlateSet,
    dupPlateByKey,
    collisionByKey,
    fmtDupEntry,
  } = ctx || {};
  const rowKey = _ihracatShipmentKey(s);
  const durumHtml = _ihracatRenderDurumHtml(status, s.plaka || '');
  const durumText = _ihracatDurumPlainText(status, s.plaka || '');
  const irs = getShipmentIrsaliyeNo(s);
  const isManual = s._ihracatManual || String(rowKey).startsWith('new__');
  const isIrsCollision = shipmentHasIrsaliyeCollision(s, irsCollisionSet);
  const isDupPlate = shipmentHasDuplicatePlate(s, dupPlateSet);
  const dupDetail = dupPlateByKey.get(plateCollisionKey(s.plaka));
  const coll = collisionByKey.get(irsaliyeCollisionKey(irs));
  const irsTitle = coll
    ? `Aynı irsaliye birden fazla plakada: ${(coll.plates || []).join(' · ')}`
    : '';
  const plakaTitle = isDupPlate && dupDetail
    ? `Aynı plaka birden fazla sevkiyatta:\n${(dupDetail.entries || []).map((e, i) => `${i + 1}. ${fmtDupEntry(e)}`).join('\n')}`
    : '';
  const irsCellStyle = isIrsCollision
    ? `${IHR_EXCEL_TD_IRS}${IHR_IRS_COLLISION_CELL_STYLE}`
    : IHR_EXCEL_TD_IRS;
  const irsInpStyle = isIrsCollision
    ? `${IHR_EXCEL_INP_IRS}background:#fef3c7;color:#92400e;border-color:#fbbf24;`
    : IHR_EXCEL_INP_IRS;
  const plakaTdStyle = isDupPlate
    ? `${IHR_EXCEL_PLAKA_TD}${IHR_IRS_COLLISION_CELL_STYLE}`
    : IHR_EXCEL_PLAKA_TD;
  const siraAttr = String(s.sira || '').trim();
  const tonajShown = escapeHtml(String(s.tonajKg || ''));
  const plakaFull = normPlate(s.plaka || '');
  return `
    <tr data-ihr-row-key="${escapeHtml(rowKey)}"${siraAttr ? ` data-ihr-sira="${escapeHtml(siraAttr)}"` : ''}${isManual ? ' data-ihr-is-new="1"' : ''}${isIrsCollision ? ' data-ihr-irs-collision="1"' : ''}${isDupPlate ? ' data-ihr-plate-collision="1"' : ''}>
      <td data-ihr-col="sil" style="${IHR_EXCEL_TD_SIL}">${_ihracatRowDelBtnHtml()}</td>
      <td data-ihr-col="irsaliye" style="${irsCellStyle}" title="${escapeHtml(irsTitle)}">
        <span data-field="firma" style="display:none;">${escapeHtml(s.firma || '')}</span>
        <span data-field="malzeme" style="display:none;">${escapeHtml(s.malzeme || '')}</span>
        <input type="text" data-field="irsaliye" value="${escapeHtml(irs)}" style="${irsInpStyle}" title="${escapeHtml(irsTitle)}" />
      </td>
      <td data-ihr-col="plaka" style="${plakaTdStyle}" title="${escapeHtml(plakaTitle || plakaFull)}">${_ihracatPlakaCellHtml(s.plaka, true, false, { isDupPlate, dupPlateTitle: plakaTitle, excelSheet: true })}</td>
      <td data-ihr-col="bbt" style="${IHR_EXCEL_TD}">${_ihracatExcelFieldInpHtml('bbt', s.bbt)}</td>
      <td data-ihr-col="cuval" style="${IHR_EXCEL_TD}">${_ihracatExcelFieldInpHtml('cuval', s.cuval)}</td>
      <td data-ihr-col="palet" style="${IHR_EXCEL_TD}">${_ihracatExcelFieldInpHtml('palet', s.palet)}</td>
      <td data-ihr-col="bosBbt" style="${IHR_EXCEL_TD}">${_ihracatExcelFieldInpHtml('bosBbt', s.bosBbt)}</td>
      <td data-ihr-col="bosCuval" style="${IHR_EXCEL_TD}">
        <span style="display:inline-flex;align-items:center;justify-content:center;gap:1px;">
          ${_ihracatExcelFieldInpHtml('bosCuval', s.bosCuval)}
          ${_ihracatAmbalajCuvalTransferBtnHtml(true)}
        </span>
      </td>
      <td data-ihr-col="tonaj" style="${IHR_EXCEL_TD_BOLD}">
        <input type="text" data-field="tonaj" value="${tonajShown}" style="${IHR_EXCEL_INP}max-width:58px;font-weight:700;" inputmode="numeric" />
      </td>
      <td data-ihr-col="takip" style="${IHR_EXCEL_TD}">${_ihracatTakipBtnHtml(true)}</td>
      <td data-ihr-col="durum" data-field="durum" data-ihr-durum-text="${escapeHtml(durumText)}" style="${IHR_EXCEL_TD}font-size:10px;white-space:nowrap;">${durumHtml}</td>
    </tr>`;
}

function _ihracatRenderExcelSheetAddRow() {
  return `
    <tr data-ihr-add-row="1" style="background:#fffbeb;color:#92400e;">
      <td data-ihr-col="sil" style="${IHR_EXCEL_TD_SIL};color:#94a3b8;font-size:10px;">—</td>
      <td data-ihr-col="irsaliye" style="${IHR_EXCEL_TD_IRS}"><input type="text" data-field="irsaliye" value="" style="${IHR_EXCEL_INP_IRS}" disabled /></td>
      <td data-ihr-col="plaka" style="${IHR_EXCEL_PLAKA_TD}">${_ihracatPlakaCellHtml('', true, true, { excelSheet: true })}</td>
      <td data-ihr-col="bbt" style="${IHR_EXCEL_TD}"><input type="text" data-field="bbt" value="" style="${IHR_EXCEL_INP_WIDE}" disabled /></td>
      <td data-ihr-col="cuval" style="${IHR_EXCEL_TD}"><input type="text" data-field="cuval" value="" style="${IHR_EXCEL_INP_WIDE}" disabled /></td>
      <td data-ihr-col="palet" style="${IHR_EXCEL_TD}"><input type="text" data-field="palet" value="" style="${IHR_EXCEL_INP}" disabled /></td>
      <td data-ihr-col="bosBbt" style="${IHR_EXCEL_TD}"><input type="text" data-field="bosBbt" value="" style="${IHR_EXCEL_INP_WIDE}" disabled /></td>
      <td data-ihr-col="bosCuval" style="${IHR_EXCEL_TD}"><input type="text" data-field="bosCuval" value="" style="${IHR_EXCEL_INP_WIDE}" disabled /></td>
      <td data-ihr-col="tonaj" style="${IHR_EXCEL_TD_BOLD}"><input type="text" data-field="tonaj" value="" style="${IHR_EXCEL_INP}max-width:58px;" disabled /></td>
      <td data-ihr-col="takip" style="${IHR_EXCEL_TD};color:#94a3b8;font-size:10px;">—</td>
      <td data-ihr-col="durum" data-field="durum" style="${IHR_EXCEL_TD};font-size:10px;">Plaka girin</td>
    </tr>`;
}

function _ihracatAmbalajCuvalTransferBtnHtml(compact) {
  const size = compact
    ? 'width:16px;height:18px;min-width:16px;font-size:11px;'
    : 'width:20px;height:22px;min-width:20px;font-size:13px;';
  return `<button type="button" class="ihr-cuval-transfer" title="Boş çuvalı çuvale taşı ve boş çuvalı sil (takip formuna da yansır)" aria-label="Boş çuvalı çuvale aktar" style="${IHR_CUVAL_TRANSFER_BTN_STYLE}${size}">←</button>`;
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

/** Blok ambalajındaki NET kg (ör. 1250). Yoksa 0. */
function _ihracatResolveBlockNetKg(row) {
  if (!row) return 0;
  const parseKg =
    typeof extractNetKgFromAmbalajText === 'function'
      ? extractNetKgFromAmbalajText
      : null;
  if (!parseKg) return 0;

  const section = row.closest('[data-ihr-block-section]');
  const ambInp = section?.querySelector('[data-ihr-firma-amb]');
  const fromAmb = parseKg(ambInp?.value || '');
  if (fromAmb > 0) return fromAmb;

  const tbody = row.closest('tbody[data-ihr-tbody]');
  try {
    const template = JSON.parse(tbody?.getAttribute('data-ihr-template') || '{}');
    const fromTpl = parseKg(
      template.ambalaj ||
        template.ambalajBilgisi ||
        template.blockMeta?.mainHeader ||
        template.headerText ||
        ''
    );
    if (fromTpl > 0) return fromTpl;
  } catch (e) {}

  const autoAmb = section?.getAttribute('data-ihr-amb-auto') || '';
  return parseKg(autoAmb) || 0;
}

/** BBT × birim NET kg → tonaj (örn. 22 × 1250 = 27500). */
function _ihracatAutoFillTonajFromBbt(row) {
  if (!row || row.getAttribute('data-ihr-add-row') === '1') return false;
  const bbtInp = row.querySelector('[data-field="bbt"]');
  const tonajInp = row.querySelector('[data-field="tonaj"]');
  if (!bbtInp || !tonajInp || tonajInp.disabled) return false;
  const bbt = _ihracatParseNum(bbtInp.value);
  if (!(bbt > 0)) return false;
  const kg = _ihracatResolveBlockNetKg(row);
  if (!(kg > 0)) return false;
  const next = String(Math.round(bbt * kg));
  if (tonajInp.value === next) return false;
  tonajInp.value = next;
  return true;
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

async function _ihracatPersistSingleRowFromModal(row, modal) {
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

  const byKey = new Map(list.map((s) => [_ihracatShipmentKey(s), { ...s }]));
  byKey.set(_ihracatShipmentKey(updated), updated);
  _ihracatApplyBlockFieldsToMap(byKey, blockSevk, blockAmb);
  let next = _ihracatPurgeEmptyBlockPlaceholders(Array.from(byKey.values()));
  const metaToSave = _ihracatMergeBlockOverridesIntoMeta(meta, blockSevk, blockAmb, Array.from(byKey.values()));

  const ok = typeof saveDailyShipments === 'function' ? await saveDailyShipments(next, metaToSave) : false;
  if (ok) {
    try {
      const shipKey = _ihracatShipmentKey(updated);
      const savedRow = next.find((s) => _ihracatShipmentKey(s) === shipKey) || updated;
      if (window.__activeExcelShipment && _ihracatShipmentKey(window.__activeExcelShipment) === shipKey) {
        window.__activeExcelShipment = { ...savedRow };
      }
      purgeStrictExcelCaches();
      rebuildListsFromExcelRows(next);
      _ihracatSyncActiveShipmentCache(next);
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

/** Tablo altı özet satırı — Excel TOPLAM satırı ile aynı kolon hizası */
function _ihracatToplamRowHtml(items) {
  const t = _ihracatSumItemsTotals(items || []);
  const sumCell = (key, extra) => {
    const n = _ihracatParseNum(t[key]);
    const shown = n > 0 ? String(Math.round(n)) : '0';
    return `<td style="${IHR_EXCEL_TD}${extra || ''}">
      <input type="text" readonly tabindex="-1" aria-readonly="true" data-ihr-sum="${key}" value="${escapeHtml(shown)}" style="${IHR_EXCEL_INP_WIDE}font-weight:800;background:#fffbeb;" />
    </td>`;
  };
  const tonajShown = escapeHtml(String(t.tonajKg || '0'));
  return `
    <tr data-ihr-toplam-row="1" style="background:#fffbeb;">
      <td style="${IHR_EXCEL_TD_SIL}background:#fffbeb;"></td>
      <td colspan="2" style="${IHR_EXCEL_TD}background:#fffbeb;font-weight:700;font-size:10px;">TOPLAM</td>
      ${sumCell('bbt', 'background:#fffbeb;')}
      ${sumCell('cuval', 'background:#fffbeb;')}
      ${sumCell('palet', 'background:#fffbeb;')}
      ${sumCell('bosBbt', 'background:#fffbeb;')}
      ${sumCell('bosCuval', 'background:#fffbeb;')}
      <td style="${IHR_EXCEL_TD_BOLD}background:#fffbeb;">
        <input type="text" readonly tabindex="-1" aria-readonly="true" data-ihr-sum="tonajKg" value="${tonajShown}" style="${IHR_EXCEL_INP}max-width:58px;font-weight:700;background:#fffbeb;" />
      </td>
      <td style="${IHR_EXCEL_TD}background:#fffbeb;color:#94a3b8;font-size:10px;">—</td>
      <td style="${IHR_EXCEL_TD}background:#fffbeb;"></td>
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
    const row = t.closest('tr[data-ihr-row-key], tr[data-ihr-add-row]');
    if (t.matches('[data-field="bbt"]') && row) {
      _ihracatAutoFillTonajFromBbt(row);
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
  ['bbt', 'cuval', 'palet', 'bosBbt', 'bosCuval'].forEach((field) => {
    const el = row.querySelector(`[data-field="${field}"]`);
    if (!el) return;
    el.value = '';
    el.removeAttribute('disabled');
  });
}

function _ihracatCopyRowFromPrev(prevRow, targetRow) {
  if (!prevRow || !targetRow) return;
  ['firma', 'malzeme'].forEach((f) => {
    const from = prevRow.querySelector(`[data-field="${f}"]`);
    if (!from) return;
    let to = targetRow.querySelector(`[data-field="${f}"]`);
    if (!to) {
      const irsCell = targetRow.querySelector('td[data-ihr-col="irsaliye"]') || targetRow.cells[1];
      if (irsCell) {
        irsCell.insertAdjacentHTML(
          'afterbegin',
          `<span data-field="${f}" style="display:none;"></span>`
        );
        to = targetRow.querySelector(`[data-field="${f}"]`);
      }
    }
    if (to) to.textContent = from.textContent || '';
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

function _ihracatActionBtnsHtml(compact) {
  const btn = compact
    ? 'border:none;background:transparent;cursor:pointer;padding:1px 3px;border-radius:4px;line-height:1;flex-shrink:0;'
    : 'border:none;background:transparent;cursor:pointer;padding:3px 7px;border-radius:6px;line-height:1;flex-shrink:0;';
  const iconSize = compact ? '11px' : '13px';
  return `<span class="ihr-row-actions" style="display:inline-flex;flex-shrink:0;gap:1px;margin-left:2px;vertical-align:middle;">
    <button type="button" class="ihr-row-edit" title="Plakayı düzenle" style="${btn}color:#2563eb;" onmouseover="this.style.background='#eff6ff'" onmouseout="this.style.background='transparent'"><i class="fas fa-pen" style="font-size:${iconSize};"></i></button>
    <button type="button" class="ihr-row-del" title="Satırı sil" style="${btn}color:#dc2626;" onmouseover="this.style.background='#fef2f2'" onmouseout="this.style.background='transparent'"><i class="fas fa-trash" style="font-size:${iconSize};"></i></button>
  </span>`;
}

function _ihracatPlakaCellHtml(plate, editable, isAddRow, opts) {
  const o = opts && typeof opts === 'object' ? opts : {};
  const excelSheet = !!o.excelSheet;
  const isDupPlate = !!o.isDupPlate;
  const dupTitle = String(o.dupPlateTitle || '');
  const p = normPlate(plate || '');
  const title = escapeHtml(dupTitle || p || '');

  if (excelSheet) {
    const inpStyle = isAddRow ? IHR_EXCEL_PLAKA_INP_ADD : IHR_EXCEL_PLAKA_INP;
    const style = isDupPlate
      ? `${inpStyle}background:#fef3c7;color:#92400e;font-weight:700;border-color:#fbbf24;`
      : inpStyle;
    return `<input type="text" data-field="plaka" value="${escapeHtml(p)}" placeholder="${isAddRow ? 'Plaka…' : ''}" style="${style}" title="${title}" />`;
  }

  const siraPrefix = _ihracatSiraPrefixHtml(o.sira);
  const actions = isAddRow ? '' : _ihracatActionBtnsHtml(false);
  const inpStyle = isAddRow ? IHR_PLAKA_INP_ADD_STYLE : IHR_PLAKA_INP_STYLE;
  const textStyle = isDupPlate
    ? `${IHR_PLAKA_TEXT_STYLE}background:#fef3c7;color:#92400e;font-weight:700;padding:2px 6px;border-radius:4px;border:1px solid #fbbf24;`
    : IHR_PLAKA_TEXT_STYLE;
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
  /* excel sheet: sil sütunu + doğrudan plaka input — eski ikonlar kullanılmıyor */
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
  return `<button type="button" class="ihr-kayit-et-btn" data-plate="${p}" title="Yeni araç kaydı aç" aria-label="Kayıt et" style="padding:2px 5px;font-size:9px;background:#4f46e5;color:#fff;border:none;border-radius:4px;cursor:pointer;font-weight:600;line-height:1.2;white-space:nowrap;flex-shrink:0;">Kayıt</button>`;
}

function _ihracatSetCollapsibleSection(section, open) {
  if (!section) return;
  const body = section.querySelector('.ihr-collapse-body');
  const chevron = section.querySelector('.ihr-collapse-chevron');
  if (open) {
    section.classList.add('ihr-collapse-open');
    section.classList.remove('ihr-collapse-closed');
    if (body) body.style.display = '';
    if (chevron) chevron.textContent = '▾';
  } else {
    section.classList.remove('ihr-collapse-open');
    section.classList.add('ihr-collapse-closed');
    if (body) body.style.display = 'none';
    if (chevron) chevron.textContent = '▸';
  }
}

function _ihracatToggleCollapsibleSection(section) {
  if (!section) return;
  _ihracatSetCollapsibleSection(section, !section.classList.contains('ihr-collapse-open'));
}

function _ihracatExpandCollapsibleAncestors(el) {
  let node = el;
  while (node) {
    if (node.matches && node.matches('[data-ihr-collapse-section]')) {
      _ihracatSetCollapsibleSection(node, true);
    }
    node = node.parentElement;
  }
}

function _ihracatBindCollapsibleSections(modal) {
  if (!modal) return;
  modal.querySelectorAll('[data-ihr-collapse-trigger]').forEach((trigger) => {
    trigger.addEventListener('click', () => {
      _ihracatToggleCollapsibleSection(trigger.closest('[data-ihr-collapse-section]'));
    });
  });
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
    else _ihracatExpandCollapsibleAncestors(section);
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
  _ihracatExpandCollapsibleAncestors(row);
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

async function _ihracatPersistPendingShipment(ctx) {
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
    fileName: template.fileName || (typeof resolveIhracatRowFileLabel === 'function'
      ? resolveIhracatRowFileLabel(template, meta)
      : (typeof normalizeIhracatMetaFiles === 'function' && normalizeIhracatMetaFiles(meta).length === 1
        ? normalizeIhracatMetaFiles(meta)[0]
        : '')),
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

  const cleaned = _ihracatPurgeEmptyBlockPlaceholders(rows);
  const ok = (typeof saveDailyShipments === 'function') ? await saveDailyShipments(cleaned, meta) : false;
  if (ok) {
    try {
      purgeStrictExcelCaches();
      rebuildListsFromExcelRows(cleaned);
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
  void _ihracatOpenVehicleRegistrationAsync(plateRaw, opts);
}

async function _ihracatOpenVehicleRegistrationAsync(plateRaw, opts) {
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

  const persistedKey = await _ihracatPersistPendingShipment(window.__ihracatReturnContext);
  if (persistedKey) window.__ihracatReturnContext.rowKey = persistedKey;

  document.getElementById('ihracatDetailsModal')?.remove();

  const vehicle = _ihracatFindVehicleByPlate(plate, { cekiciOnly: true });

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
  void _ihracatMaybeReopenAfterVehicleSaveAsync();
}

async function _ihracatMaybeReopenAfterVehicleSaveAsync() {
  const ctx = window.__ihracatReturnContext;
  if (!ctx || !ctx.reopen) return;
  const plate = ctx.plate || '';
  let rowKey = ctx.rowKey || '';

  const addedKey = await _ihracatPersistPendingShipment(ctx);
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
  const inlineRow = (icon, text, color, title, extra) =>
    `<span style="display:inline-flex;align-items:center;justify-content:center;gap:4px;flex-wrap:nowrap;white-space:nowrap;" title="${escapeHtml(title)}">${icon}<span style="font-size:10px;color:${color};font-weight:600;">${escapeHtml(text)}</span>${extra || ''}</span>`;
  if (st === 'printed') {
    return inlineRow('🖨️', 'Yazdırıldı', '#991b1b', 'Yazdırıldı');
  }
  const v = _ihracatFindVehicleByPlate(plateRaw);
  if (!v) {
    return inlineRow('❌', 'Kayıt yok', '#991b1b', 'Sistemde kayıt yok', regBtn);
  }
  if (_ihracatVehicleHasDriver(v)) {
    return inlineRow('<span style="font-size:14px;line-height:1;color:#16a34a;">✅</span>', 'Şoför var', '#166534', 'Şoför bilgisi mevcut');
  }
  return inlineRow('❌', 'Şoför yok', '#991b1b', 'Araç kayıtlı, şoför bilgisi eksik', regBtn);
}

function _ihracatApplyDurumCell(statusCell, row, plateRaw, statusApi, stOverride) {
  if (!statusCell) return;
  const { normalizePlate, statusForPlate, statusStyle, renderDurumHtml } = statusApi;
  const raw = String(plateRaw || '').trim();
  if (!raw) {
    statusCell.innerHTML = '<span style="font-size:11px;color:#92400e;">Plaka girin</span>';
    statusCell.removeAttribute('data-ihr-durum-text');
    if (row) row.style.cssText = row.getAttribute('data-ihr-add-row') === '1' ? 'background:#fffbeb;color:#92400e;' : '';
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
  if (row && row.getAttribute('data-ihr-add-row') === '1') {
    row.style.cssText = 'background:#fffbeb;color:#92400e;';
  } else if (row) {
    row.style.cssText = '';
  }
}

async function _ihracatDeleteShipmentRow(rowKey, plateRaw) {
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
  const ok = (typeof saveDailyShipments === 'function') ? await saveDailyShipments(next, meta) : false;
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

  modal.addEventListener('input', (e) => {
    const t = e.target;
    if (!t || !t.matches('[data-field="plaka"]')) return;
    const row = t.closest('tr[data-ihr-row-key], tr[data-ihr-add-row]');
    if (row) updateRowStatus(row, t.value);
  });

  modal.addEventListener(
    'blur',
    (e) => {
      const t = e.target;
      if (!t || !t.matches('[data-field="plaka"]')) return;
      const p = normalizePlate(t.value);
      if (p) t.value = p;
      const row = t.closest('tr[data-ihr-row-key], tr[data-ihr-add-row]');
      if (row) updateRowStatus(row, t.value);
    },
    true
  );

  modal.addEventListener('click', (e) => {
    const delBtn = e.target.closest('.ihr-row-del');
    if (!delBtn) return;
    e.preventDefault();
    const row = delBtn.closest('tr[data-ihr-row-key]');
    if (!row) return;
    const plate = row.querySelector('[data-field="plaka"]')?.value?.trim() || '';
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
    void (async () => {
      const saved = await _ihracatDeleteShipmentRow(key, plate);
      if (saved) showToast(plate ? `🗑️ ${plate} silindi.` : '🗑️ Satır silindi.', 'success');
      else if (key) showToast('Satır kaldırıldı. Değişiklikleri Kaydet ile de onaylayabilirsiniz.', 'info');
    })();
  });
}

function _ihracatTakipBtnHtml(compact) {
  if (compact) {
    return `<button type="button" class="ihr-takip-btn" style="padding:2px 5px;font-size:9px;background:#2563eb;color:#fff;border:none;border-radius:4px;cursor:pointer;white-space:nowrap;font-weight:600;">Takip</button>`;
  }
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
      <td colspan="${IHR_EXCEL_SHEET_COLS}" style="border:1px solid #ddd;padding:0;">
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
