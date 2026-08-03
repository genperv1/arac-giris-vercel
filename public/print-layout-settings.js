(function () {
  'use strict';

  const STORAGE_KEY = 'takipPrintLayout_v1';
  const COORD_REF_W = 1024;
  const COORD_REF_H = 723;
  const FORM_CONTENT_H = 148;
  const ROW_NUDGE_PX = 38;
  const FORM_W_MM = 210;

  const WRAP_MODES = ['nowrap', 'wrap', 'pre-line', 'break-word'];

  const FIELD_DEFS = [
    { key: 'yuklemeSirasi', label: 'Yükleme sırası', sample: '127', align: 'center', kind: 'text' },
    { key: 'tarih', label: 'Tarih', sample: '18.07.2026', align: 'center', kind: 'text' },
    { key: 'sofor', label: 'Şoför', sample: 'MEHMET YILMAZ', kind: 'text' },
    { key: 'iletisim', label: 'İletişim', sample: '0532 111 22 33', align: 'center', kind: 'text' },
    { key: 'tc', label: 'T.C.', sample: '12345678901', kind: 'text' },
    { key: 'sevkYeri', label: 'Sevk yeri', sample: 'İSTANBUL; TUZLA;', align: 'center', multiline: true, kind: 'text' },
    { key: 'cekici', label: 'Çekici', sample: '34 ABC 123', kind: 'text' },
    { key: 'dorse', label: 'Dorse', sample: '34 XYZ 456', align: 'center', kind: 'text' },
    { key: 'firma', label: 'Firma', sample: 'YD001 — ÖRNEK İHRACAT A.Ş.', kind: 'text', wrap: 'nowrap' },
    { key: 'malzeme', label: 'Malzeme', sample: 'HP 400 · 24 TON', kind: 'text' },
    { key: 'ambBilgi', label: 'Ambalaj bilgisi', sample: 'NET 1250 KG\nLİNERLİ BİGBAG', multiline: true, align: 'center', kind: 'text' },
    { key: 'tonaj', label: 'Tonaj', sample: '24.500 KG', kind: 'text' },
    { key: 'seperator', label: 'Seperatör', sample: 'ÖDEME TÜRÜ: HAVALE\nGNP ORG: GNP', multiline: true, align: 'center', kind: 'text' },
    { key: 'bbt', label: 'BBT', sample: '12', align: 'center', kind: 'text' },
    { key: 'bosBbt', label: 'Boş BBT', sample: '0', align: 'center', kind: 'text' },
    { key: 'cuval', label: 'Çuval', sample: '0', align: 'center', kind: 'text' },
    { key: 'bosCuval', label: 'Boş çuval', sample: '0', align: 'center', kind: 'text' },
    { key: 'palet', label: 'Palet', sample: '0', align: 'center', kind: 'text' },
    { key: 'torba', label: 'Torba', sample: '0', align: 'center', kind: 'text' },
    { key: 'not', label: 'Yükleme notu', type: 'note', kind: 'note', sample: "İrsaliye No: R01 202602556\nNET AĞIRLIĞI 1250 KG, Pİ - LİNERLİ BASKILI BİG BAG'LERİNDE SEVK EDİLECEK\nÖZEL ETİKET EKLENECEKTİR(mavi) YAN TARAFLARINDA \"A\"SİMGESİ YAZILMALI" },
    { key: 'imzaKantar', label: 'Kantar', type: 'sig', kind: 'sig', sampleName: 'BURAK KARATAŞ', sigRole: 'kantar' },
    { key: 'imzaSaha', label: 'Sevkiyat saha', type: 'sig', kind: 'sig', sampleName: 'ÖRNEK SAHA', sigRole: 'saha' },
    { key: 'imzaYukleyen', label: 'Yükleyen', sample: 'YÜKLEYEN GÖREVLİ', align: 'center', kind: 'text' },
    { key: 'imzaKalite', label: 'Kalite', sample: 'KALİTE KONTROL', align: 'center', kind: 'text' },
  ];

  const DEFAULT_NOTE_BREAKS = ['SEVK EDİLECEK', 'SEVK EDILECEK'];
  /** İrsaliye üst satırı — ekstra kalın */
  const HEAD_BOLD_WEIGHT = 800;
  /** Normal alanlar — eski iyi kalınlık; sadece B tuşu ile */
  const TEXT_BOLD_WEIGHT = 700;
  const NORMAL_WEIGHT = 400;
  const DESC_BOLD_WEIGHT = TEXT_BOLD_WEIGHT;

  const STYLE_DEFAULTS = {
    imzaKantar: { imgMaxMm: 12, namePt: 10, nameGapMm: 0.3, align: 'center', padTopMm: 5 },
    imzaSaha: { imgMaxMm: 11, namePt: 9.5, nameGapMm: 0.25, align: 'center', padTopMm: 4.5 },
    yuklemeNotu: {
      headGapMm: 1.1, headPt: 10.75, descPt: 9, maxLines: 3, lineHeight: 1.1,
      headFontWeight: HEAD_BOLD_WEIGHT, headFontStyle: 'normal', headTextDecoration: 'none',
      descFontWeight: 700, descFontStyle: 'normal', descTextDecoration: 'none',
    },
  };

  function clampNum(v, min, max, fallback) {
    const n = Number(v);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  }

  function xMm(px) { return (px / COORD_REF_W) * FORM_W_MM; }
  function yMm(py) { return (py / COORD_REF_H) * FORM_CONTENT_H; }
  function mmPx(mm) { return (mm / FORM_W_MM) * COORD_REF_W; }
  function ry(py) { return Math.max(0, py - ROW_NUDGE_PX); }
  function mid(y0, y1, shift) { return yMm((ry(y0) + ry(y1)) / 2) - shift; }
  function rh(y0, y1) { return Math.max(4, yMm(ry(y1)) - yMm(ry(y0)) - 1.2); }

  function getDef(key) {
    return FIELD_DEFS.find((d) => d.key === key);
  }

  function defaultTextStyle(def) {
    const multiline = !!(def && def.multiline);
    return {
      fontPt: multiline ? 8.5 : 10.5,
      lineHeight: multiline ? 1.12 : 1.05,
      align: (def && def.align) || 'left',
      wrap: (def && def.wrap) || (multiline ? 'pre-line' : 'wrap'),
      wordBreak: 'normal',
      overflowWrap: 'break-word',
      valign: 'center',
      fontWeight: TEXT_BOLD_WEIGHT,
      fontStyle: 'normal',
      textDecoration: 'none',
      padMm: 0.35,
    };
  }

  function defaultNoteStyle() {
    return Object.assign({}, STYLE_DEFAULTS.yuklemeNotu, {
      wrap: 'wrap',
      breakAfter: DEFAULT_NOTE_BREAKS.slice(),
      breakPhrasesText: DEFAULT_NOTE_BREAKS.join('\n'),
    });
  }

  function normalizeTypography(out, base, prefix) {
    const wKey = prefix ? prefix + 'FontWeight' : 'fontWeight';
    const sKey = prefix ? prefix + 'FontStyle' : 'fontStyle';
    const dKey = prefix ? prefix + 'TextDecoration' : 'textDecoration';
    const defW = base[wKey] != null ? base[wKey] : (prefix === 'head' ? HEAD_BOLD_WEIGHT : TEXT_BOLD_WEIGHT);
    out[wKey] = clampNum(out[wKey], 100, 900, defW);
    if (!['normal', 'italic'].includes(out[sKey])) out[sKey] = base[sKey] || 'normal';
    if (!['none', 'underline'].includes(out[dKey])) out[dKey] = base[dKey] || 'none';
  }

  function typographyInlineCss(style, prefix) {
    const wKey = prefix ? prefix + 'FontWeight' : 'fontWeight';
    const sKey = prefix ? prefix + 'FontStyle' : 'fontStyle';
    const dKey = prefix ? prefix + 'TextDecoration' : 'textDecoration';
    let css = `font-weight:${style[wKey] || (prefix === 'head' ? HEAD_BOLD_WEIGHT : TEXT_BOLD_WEIGHT)};font-style:${style[sKey] || 'normal'};`;
    if (style[dKey] === 'underline') css += 'text-decoration:underline;';
    return css;
  }

  function defaultSigStyle(key) {
    return Object.assign({}, STYLE_DEFAULTS[key] || STYLE_DEFAULTS.imzaKantar);
  }

  function getDefaultFieldStyle(key) {
    const def = getDef(key);
    if (!def) return {};
    if (def.kind === 'note') return defaultNoteStyle();
    if (def.kind === 'sig') return defaultSigStyle(key);
    return defaultTextStyle(def);
  }

  function buildBasePrintCoords() {
    const packMm = [75.3, 104.4, 131.5, 158.9, 183.8, 205.7];
    const packPx = [212].concat(packMm.map(mmPx));
    const imzaMm = [54.8, 105.4, 154.8, 205.7];
    const imzaPx = [20].concat(imzaMm.map(mmPx));
    const P = {
      yuklemeSirasi: { left: xMm(455), top: mid(172, 210, 1.3), w: xMm(535 - 455), h: 5, align: 'center' },
      tarih:         { left: xMm(700), top: mid(172, 210, 1.3), w: xMm(990 - 700), h: 5, align: 'center' },
      sofor:         { left: xMm(215), top: mid(210, 248, 1.3), w: xMm(539 - 215), h: 5 },
      iletisim:      { left: xMm(755), top: mid(210, 248, 1.3), w: xMm(985 - 755), h: 5, align: 'center' },
      tc:            { left: xMm(215), top: mid(248, 286, 1.3), w: xMm(539 - 215), h: 5 },
      sevkYeri:      { left: xMm(702), top: mid(248, 286, 1.3), w: xMm(888 - 702), h: rh(248, 286), align: 'center' },
      cekici:        { left: xMm(215), top: mid(286, 325, 1.3), w: xMm(478 - 215), h: 5 },
      dorse:         { left: xMm(739), top: mid(286, 325, 1.3), w: xMm(985 - 739), h: 5, align: 'center' },
      firma:         { left: xMm(215), top: mid(325, 362, 1.3), w: xMm(1000 - 215), h: 5 },
      malzeme:       { left: xMm(215), top: mid(362, 399, 1.3), w: xMm(653 - 215), h: 6.2 },
      ambBilgi:      { left: xMm(798), top: mid(362, 399, 2.4), w: xMm(1000 - 798), h: rh(362, 399) },
      tonaj:         { left: xMm(215), top: mid(399, 445, 1.3), w: xMm(509 - 215), h: 5 },
      seperator:     { left: xMm(798), top: mid(399, 445, 3.6), w: xMm(996 - 798), h: Math.max(3.8, rh(399, 445) - 0.8) },
      not:           { left: xMm(215), top: yMm(ry(530)), w: xMm(1000 - 215), h: rh(514, 578) },
    };
    ['bbt', 'bosBbt', 'cuval', 'bosCuval', 'palet', 'torba'].forEach(function (key, i) {
      P[key] = { left: xMm(packPx[i] + 3), top: mid(484, 548, 3.5), w: xMm(packPx[i + 1] - packPx[i] - 6), h: 5 };
    });
    ['imzaKantar', 'imzaSaha', 'imzaYukleyen', 'imzaKalite'].forEach(function (key, i) {
      P[key] = { left: xMm(imzaPx[i] + 6), top: mid(588, 668, 0.5), w: xMm(imzaPx[i + 1] - imzaPx[i] - 12), h: rh(584, 662) };
    });
    return P;
  }

  function deepClone(obj) { return JSON.parse(JSON.stringify(obj)); }

  function emptyStore() {
    return { fields: {}, fieldStyles: {}, styles: deepClone(STYLE_DEFAULTS), samples: {} };
  }

  function migrateRaw(raw) {
    if (!raw || typeof raw !== 'object') return emptyStore();
    const out = emptyStore();
    if (raw.fields) out.fields = deepClone(raw.fields);
    if (raw.fieldStyles) out.fieldStyles = deepClone(raw.fieldStyles);
    if (raw.samples && typeof raw.samples === 'object') out.samples = deepClone(raw.samples);
    if (raw.styles) {
      Object.keys(raw.styles).forEach((k) => {
        out.styles[k] = Object.assign({}, STYLE_DEFAULTS[k] || {}, raw.styles[k]);
      });
    }
    if (raw.imzaKantar) {
      out.fields.imzaKantar = deepClone(raw.imzaKantar);
      out.fieldStyles.imzaKantar = Object.assign({}, defaultSigStyle('imzaKantar'), raw.imzaKantar);
    }
    if (raw.yuklemeNotu) {
      out.fieldStyles.not = Object.assign({}, defaultNoteStyle(), raw.yuklemeNotu);
      out.styles.yuklemeNotu = Object.assign({}, STYLE_DEFAULTS.yuklemeNotu, raw.yuklemeNotu);
    }
    return out;
  }

  function clearLegacyLocalStorage() {
    try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* ignore */ }
  }

  clearLegacyLocalStorage();

  let _memCache = null;
  let _syncPromise = null;

  function setCache(cur) {
    _memCache = cur;
  }

  function getSettingsToken() {
    try {
      if (window.AyarlarGate && typeof window.AyarlarGate.getSettingsToken === 'function') {
        return window.AyarlarGate.getSettingsToken() || '';
      }
    } catch (e) { /* ignore */ }
    return '';
  }

  async function pullFromServer() {
    try {
      const res = await fetch('/api/print-layout', {
        method: 'GET',
        credentials: 'include',
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache' },
      });
      if (!res.ok) return { status: 'error' };
      const data = await res.json().catch(() => null);
      if (!data) return { status: 'error' };
      if (!data.exists || !data.layout) return { status: 'empty' };
      return { status: 'ok', layout: migrateRaw(data.layout) };
    } catch (e) {
      return { status: 'error' };
    }
  }

  async function pushToServer(cur) {
    const token = getSettingsToken();
    if (!token) {
      return { ok: false, error: 'Ayarlar oturumu gerekli — sayfayı yenileyip ayar parolasını girin.' };
    }
    const payload = Object.assign({}, cur, { updatedAt: Date.now() });
    try {
      const res = await fetch('/api/settings/print-layout', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'X-Settings-Token': token,
          'Cache-Control': 'no-cache',
        },
        body: JSON.stringify({ layout: payload }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        return {
          ok: false,
          error: (data && data.error) || 'Sunucuya kaydedilemedi',
        };
      }
      if (data && data.layout) {
        setCache(migrateRaw(data.layout));
      }
      return { ok: true, updatedAt: data && data.updatedAt };
    } catch (e) {
      return { ok: false, error: 'Sunucuya bağlanılamadı' };
    }
  }

  async function resetOnServer() {
    const token = getSettingsToken();
    if (!token) return { ok: false, skipped: true };
    try {
      const res = await fetch('/api/settings/print-layout', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'X-Settings-Token': token,
          'Cache-Control': 'no-cache',
        },
        body: JSON.stringify({ reset: true }),
      });
      if (!res.ok) return { ok: false };
      return { ok: true };
    } catch (e) {
      return { ok: false };
    }
  }

  async function ensureSynced() {
    const result = await pullFromServer();
    clearLegacyLocalStorage();
    if (result.status === 'ok') {
      setCache(result.layout);
      return result.layout;
    }
    if (result.status === 'empty') {
      const defaults = emptyStore();
      setCache(defaults);
      return defaults;
    }
    if (_memCache) return _memCache;
    const defaults = emptyStore();
    setCache(defaults);
    return defaults;
  }

  function ensureSyncedOnce() {
    if (!_syncPromise) {
      _syncPromise = ensureSynced().finally(function () {
        _syncPromise = null;
      });
    }
    return _syncPromise;
  }

  function applyRemoteLayout(layout) {
    if (!layout || typeof layout !== 'object') return load();
    const migrated = migrateRaw(layout);
    setCache(migrated);
    clearLegacyLocalStorage();
    return migrated;
  }

  let previewSnapshot = null;

  function setPreviewSnapshot(snap) {
    previewSnapshot = snap ? migrateRaw(snap) : null;
  }

  function clearPreviewSnapshot() {
    previewSnapshot = null;
  }

  function load() {
    if (previewSnapshot) return previewSnapshot;
    return _memCache || emptyStore();
  }

  function save(next, opts) {
    const cur = previewSnapshot ? (_memCache || emptyStore()) : load();
    if (next && next.fields) cur.fields = Object.assign({}, cur.fields, next.fields);
    if (next && next.fieldStyles) cur.fieldStyles = Object.assign({}, cur.fieldStyles, next.fieldStyles);
    if (next && next.samples) cur.samples = Object.assign({}, cur.samples || {}, next.samples);
    if (next && next.styles) {
      Object.keys(next.styles).forEach((k) => {
        cur.styles[k] = Object.assign({}, cur.styles[k] || STYLE_DEFAULTS[k] || {}, next.styles[k]);
      });
    }
    setCache(cur);
    if (!opts || !opts.skipServer) {
      pushToServer(cur).catch(function () { /* ignore */ });
    }
    return cur;
  }

  function reset(opts) {
    clearLegacyLocalStorage();
    setCache(emptyStore());
    if (!opts || !opts.skipServer) {
      resetOnServer().catch(function () { /* ignore */ });
    }
    return emptyStore();
  }

  function getFieldRect(key) {
    const base = buildBasePrintCoords();
    const b = base[key];
    if (!b) return null;
    const saved = load().fields[key] || {};
    return {
      left: saved.left != null ? clampNum(saved.left, 0, FORM_W_MM, b.left) : b.left,
      top: saved.top != null ? clampNum(saved.top, 0, FORM_CONTENT_H, b.top) : b.top,
      w: saved.w != null ? clampNum(saved.w, 4, FORM_W_MM, b.w) : b.w,
      h: saved.h != null ? clampNum(saved.h, 3, FORM_CONTENT_H, b.h || 5) : (b.h || 5),
      align: b.align,
    };
  }

  function getAllFieldRects() {
    const out = {};
    FIELD_DEFS.forEach((def) => { out[def.key] = getFieldRect(def.key); });
    return out;
  }

  function normalizeFieldStyle(key, src) {
    const base = getDefaultFieldStyle(key);
    const out = Object.assign({}, base, src || {});
    const def = getDef(key);
    if (def && def.kind === 'text') {
      out.fontPt = clampNum(out.fontPt, 5, 16, base.fontPt);
      out.lineHeight = clampNum(out.lineHeight, 0.9, 1.6, base.lineHeight);
      out.padMm = clampNum(out.padMm, 0, 3, base.padMm);
      if (!WRAP_MODES.includes(out.wrap)) out.wrap = base.wrap;
      if (!['normal', 'break-word', 'break-all'].includes(out.wordBreak)) out.wordBreak = 'normal';
      if (!['flex-start', 'center', 'flex-end'].includes(out.valign)) out.valign = 'center';
      if (!['left', 'center', 'right'].includes(out.align)) out.align = base.align || 'left';
      normalizeTypography(out, base);
      if (Number(out.fontWeight) >= HEAD_BOLD_WEIGHT) out.fontWeight = TEXT_BOLD_WEIGHT;
    }
    if (def && def.kind === 'note') {
      out.headPt = clampNum(out.headPt, 6, 14, base.headPt);
      out.descPt = clampNum(out.descPt, 5, 14, base.descPt);
      out.headGapMm = clampNum(out.headGapMm, 0, 6, base.headGapMm);
      out.maxLines = clampNum(out.maxLines, 1, 6, base.maxLines);
      out.lineHeight = clampNum(out.lineHeight, 0.9, 1.6, base.lineHeight);
      normalizeTypography(out, base, 'head');
      normalizeTypography(out, base, 'desc');
      if (typeof out.breakPhrasesText === 'string') {
        out.breakAfter = out.breakPhrasesText.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
      } else if (!Array.isArray(out.breakAfter)) {
        out.breakAfter = DEFAULT_NOTE_BREAKS.slice();
      }
    }
    if (def && def.kind === 'sig') {
      out.imgMaxMm = clampNum(out.imgMaxMm, 6, 22, base.imgMaxMm);
      out.namePt = clampNum(out.namePt, 7, 14, base.namePt);
      out.nameGapMm = clampNum(out.nameGapMm, 0, 3, base.nameGapMm);
      out.padTopMm = clampNum(out.padTopMm, 0, 12, base.padTopMm);
      if (!['left', 'center'].includes(out.align)) out.align = 'center';
    }
    return out;
  }

  function getFieldStyle(key) {
    const saved = load();
    const merged = Object.assign({}, getDefaultFieldStyle(key));
    if (saved.styles) {
      if (key === 'not' && saved.styles.yuklemeNotu) {
        Object.assign(merged, saved.styles.yuklemeNotu);
      }
      if ((key === 'imzaKantar' || key === 'imzaSaha') && saved.styles[key]) {
        Object.assign(merged, saved.styles[key]);
      }
    }
    if (saved.fieldStyles && saved.fieldStyles[key]) {
      Object.assign(merged, saved.fieldStyles[key]);
    }
    return normalizeFieldStyle(key, merged);
  }

  function getStyle(key) { return getFieldStyle(key); }

  function getImzaKantarStyle() { return getFieldStyle('imzaKantar'); }

  function getYuklemeNotuStyle() {
    const n = getFieldStyle('not');
    return {
      headGapMm: n.headGapMm,
      headPt: n.headPt,
      descPt: n.descPt,
      maxLines: n.maxLines,
      lineHeight: n.lineHeight,
      breakAfter: n.breakAfter || DEFAULT_NOTE_BREAKS.slice(),
    };
  }

  function getNoteBreakPhrases() {
    return getYuklemeNotuStyle().breakAfter || DEFAULT_NOTE_BREAKS.slice();
  }

  function splitTextByPhrases(text, phrases, maxLines) {
    let t = String(text || '').replace(/\r?\n+/g, ' ').replace(/\s+/g, ' ').trim();
    if (!t) return [];
    const list = (phrases || []).map((p) => String(p || '').trim()).filter(Boolean);
    for (const phrase of list) {
      const re = new RegExp(`^(.*?)\\b${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+(.*)$`, 'iu');
      const m = t.match(re);
      if (m) {
        const lines = [(`${m[1].trim()} ${phrase}`.trim()), m[2].trim()].filter(Boolean);
        if (lines.length <= (maxLines || 6)) return lines;
      }
    }
    return [t];
  }

  function applyLayoutToCoords(P) {
    if (!P) return P;
    const saved = load().fields;
    Object.keys(saved).forEach((key) => {
      if (!P[key] || !saved[key]) return;
      ['left', 'top', 'w', 'h'].forEach((k) => {
        if (saved[key][k] != null) P[key][k] = saved[key][k];
      });
    });
    return P;
  }

  function valignToAlign(v) {
    if (v === 'flex-end') return 'flex-end';
    if (v === 'flex-start') return 'flex-start';
    return 'center';
  }

  function wrapCss(style) {
    const wrap = style.wrap || 'wrap';
    if (wrap === 'nowrap') {
      return 'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
    }
    if (wrap === 'pre-line') {
      return 'white-space:pre-line;word-break:normal;overflow-wrap:break-word;';
    }
    if (wrap === 'break-word') {
      return 'white-space:normal;word-break:break-word;overflow-wrap:anywhere;';
    }
    return `white-space:normal;word-break:${style.wordBreak || 'normal'};overflow-wrap:${style.overflowWrap || 'break-word'};`;
  }

  function buildFieldCssRules(key, style) {
    const def = getDef(key);
    if (!def) return '';
    if (def.kind === 'sig') return '';
    const s = style || getFieldStyle(key);
    const valign = valignToAlign(s.valign);
    let css = `display:flex;align-items:${valign};box-sizing:border-box;overflow:hidden;`;
    css += wrapCss(s);
    if (s.fontPt) css += `font-size:${s.fontPt}pt !important;`;
    if (s.lineHeight) css += `line-height:${s.lineHeight} !important;`;
    if (s.fontWeight) css += `font-weight:${s.fontWeight} !important;`;
    if (s.fontStyle) css += `font-style:${s.fontStyle} !important;`;
    if (s.textDecoration === 'underline') css += 'text-decoration:underline !important;';
    if (s.align) css += `text-align:${s.align} !important;`;
    if (s.padMm != null) css += `padding:${s.padMm}mm !important;`;
    if (def.kind === 'note') {
      css += 'flex-direction:column;align-items:stretch;justify-content:flex-start;padding:1.15mm 0.5mm 0.55mm;';
    }
    return css;
  }

  /** Düzenleyicide kaydedilen ayarlar baskıda otomatik sıkıştırma olmadan birebir uygulanır. */
  function useStrictPrintLayout() {
    return true;
  }

  function hasSavedLayout() {
    const raw = _memCache;
    if (!raw) return false;
    return Object.keys(raw.fields || {}).length > 0 || Object.keys(raw.fieldStyles || {}).length > 0;
  }

  function buildPrintLayoutCss() {
    let css = '';
    FIELD_DEFS.forEach((def) => {
      if (def.kind === 'sig') return;
      const s = getFieldStyle(def.key);
      const sel = `.field.pf-field.pf-${def.key}`;
      css += `${sel}{${buildFieldCssRules(def.key, s)}}`;
      if (def.kind === 'note') {
        css += `${sel} .note-head{font-size:${s.headPt}pt !important;line-height:1.12 !important;margin:0 0 ${s.headGapMm}mm 0 !important;padding:0 !important;${typographyInlineCss(s, 'head')}}`;
        css += `${sel} .note-row{font-size:${s.descPt}pt !important;line-height:${s.lineHeight} !important;white-space:pre-line !important;margin:0 0 0.15mm 0 !important;${typographyInlineCss(s, 'desc')}}`;
        css += `${sel} .note-body{padding:1.15mm 0.5mm 0.55mm !important;box-sizing:border-box !important;}`;
        css += `${sel}.note{overflow:hidden !important;padding:0 !important;}`;
      }
    });
    return css;
  }

  function buildImzaPrintCss() {
    let css = '';
    FIELD_DEFS.filter((d) => d.kind === 'sig').forEach((def) => {
      const s = getFieldStyle(def.key);
      const alignItems = s.align === 'left' ? 'flex-start' : 'center';
      const textAlign = s.align === 'left' ? 'left' : 'center';
      const padTop = s.padTopMm != null ? s.padTopMm : 5;
      const sel = `.field.imza-block.pf-field.pf-${def.key}`;
      css += `${sel}{display:flex;flex-direction:column;align-items:${alignItems};justify-content:flex-end;padding:${padTop}mm 0.5mm 0.6mm;gap:${s.nameGapMm}mm;box-sizing:border-box;overflow:hidden;}`;
      css += `${sel} .imza-imgwrap{flex:0 0 auto;width:100%;display:flex;align-items:center;justify-content:center;padding:0;}`;
      css += `${sel} .imza-img{max-height:${s.imgMaxMm}mm !important;max-width:90%;object-fit:contain;object-position:center;}`;
      css += `${sel} .imza-name{flex:0 0 auto;font-size:${s.namePt}pt !important;font-weight:700;text-align:${textAlign};width:100%;margin:0;line-height:1.05;}`;
    });
    ['imzaYukleyen', 'imzaKalite'].forEach((key) => {
      css += `.field.pf-field.pf-${key}{${buildFieldCssRules(key)}}`;
    });
    return css;
  }

  function buildFullPrintLayoutCss() {
    return buildPrintLayoutCss() + buildImzaPrintCss();
  }

  function fieldPosStyle(key, P) {
    const r = P && P[key] ? P[key] : getFieldRect(key);
    if (!r) return '';
    let s = `left:${r.left}mm;top:${r.top}mm;width:${r.w}mm;`;
    if (r.h) s += `height:${r.h}mm;`;
    return s;
  }

  function escapeHtml(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /** Legacy print HTML (<br> satırları) → düz metin; layout motoru tek kez escape eder. */
  function normalizePrintFieldText(text) {
    let s = String(text ?? '');
    if (/<br\s*\/?>|&lt;br\s*\/?&gt;/i.test(s)) {
      s = s
        .split(/<br\s*\/?>|&lt;br\s*\/?&gt;/gi)
        .map((part) =>
          part
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
        )
        .join('\n');
    }
    return s.replace(/\r\n/g, '\n');
  }

  /** Sevk yeri: noktalı virgülle ayrılmış parçaları yazdırmadaki gibi satırlara böler. */
  function formatSevkYeriDisplay(value) {
    const raw = String(value ?? '').trim();
    if (!raw) return '';
    if (/\r?\n/.test(raw)) return raw.replace(/\r\n/g, '\n');
    const parts = raw.split(';').map((s) => s.trim()).filter(Boolean);
    if (parts.length >= 3) {
      return `${parts[0]};${parts[1]};\n${parts.slice(2).join('; ')}`;
    }
    if (parts.length === 2) {
      return `${parts[0]};\n${parts[1]}`;
    }
    return raw;
  }

  function formatAmbalajDisplay(value) {
    const raw = String(value ?? '').trim();
    if (!raw) return '';
    // Kullanıcı zaten satır kırdıysa aynen bas
    if (/\r?\n/.test(raw)) return raw.replace(/\r\n/g, '\n').replace(/[ \t]+\n/g, '\n').trim();

    let t = raw
      .replace(/LINERLI(BASKISIZ)/gi, 'LINERLI $1')
      .replace(/LİNERLİ(BASKISIZ)/gi, 'LİNERLİ $1')
      .replace(/L[Iİ]NEERL[Iİ](BASKISIZ)/gi, (m) => m.replace(/(BASKISIZ)/i, ' $1'))
      .replace(/BASKISIZ(LINERLI)/gi, 'BASKISIZ $1')
      .replace(/BASKISIZ(LİNERLİ)/gi, 'BASKISIZ $1')
      .replace(/BASKILI(L[Iİ]NE+RL[Iİ])/gi, 'BASKILI $1')
      .replace(/(KG)(LINERLI)/gi, '$1 $2')
      .replace(/(KG)(LİNERLİ)/gi, '$1 $2')
      .replace(/(KG)(L[Iİ]NE+RL[Iİ])/gi, '$1 $2')
      .replace(/(KG)(BASKILI)/gi, '$1 $2')
      .replace(/(KG)(BASKISIZ)/gi, '$1 $2')
      .replace(/\s+/g, ' ')
      .trim();

    // NET xxx KG [BASKILI|BASKISIZ]? → 1. satır; kalan TÜM kelimeler → 2. satır (hiçbirini düşürme)
    const netSplit = t.match(/^(NET\s+[\d.,]+\s*KG(?:\s+(?:BASKILI|BASKISIZ))?)\s+(.+)$/i);
    if (netSplit) {
      return `${netSplit[1].trim()}\n${netSplit[2].trim()}`;
    }

    const parts = t.split('/').map((s) => s.trim()).filter(Boolean);
    if (parts.length >= 2) return parts.join('\n');
    return t;
  }

  function formatSeperatorDisplay(value) {
    const raw = String(value ?? '').trim();
    if (!raw) return '';
    if (/\r?\n/.test(raw)) return raw.replace(/\r\n/g, '\n');

    const odemeOrg = raw.match(/^ÖDEME\s*TÜRÜ\s*:\s*(.+?)\s+ORG\s*:\s*(.+)$/i);
    if (odemeOrg) {
      return `ÖDEME TÜRÜ:\n${odemeOrg[1].trim()} ORG:${odemeOrg[2].trim()}`;
    }
    const odemeOnly = raw.match(/^ÖDEME\s*TÜRÜ\s*:\s*(.+)$/i);
    if (odemeOnly && !/ORG\s*:/i.test(raw)) {
      return `ÖDEME TÜRÜ:\n${odemeOnly[1].trim()}`;
    }
    if (/ORG\s*:/i.test(raw)) {
      const idx = raw.search(/\s+ORG\s*:/i);
      if (idx > 0) {
        const head = raw.slice(0, idx).trim();
        const tail = raw.slice(idx).trim().replace(/^ORG\s*:\s*/i, '');
        if (/^ÖDEME\s*TÜRÜ\s*:/i.test(head)) {
          const val = head.replace(/^ÖDEME\s*TÜRÜ\s*:\s*/i, '').trim();
          const line2 = val ? `${val} ORG:${tail}` : `ORG:${tail}`;
          return `ÖDEME TÜRÜ:\n${line2}`;
        }
        return `${head}\nORG:${tail}`;
      }
    }
    return raw;
  }

  /** Editör şablonu ve layout yazdırma — aynı satır kırma mantığı. */
  function formatFieldDisplayText(key, value) {
    if (key === 'sevkYeri') return formatSevkYeriDisplay(value);
    if (key === 'ambBilgi') return formatAmbalajDisplay(value);
    if (key === 'seperator') return formatSeperatorDisplay(value);
    return String(value ?? '');
  }

  function pctStyle(rect) {
    const r = rect || { left: 0, top: 0, w: 10, h: 5 };
    const left = (r.left / FORM_W_MM) * 100;
    const top = (r.top / FORM_CONTENT_H) * 100;
    const w = (r.w / FORM_W_MM) * 100;
    const h = (r.h / FORM_CONTENT_H) * 100;
    return `left:${left}%;top:${top}%;width:${w}%;height:${h}%;`;
  }

  function buildTextInnerHtml(text, style) {
    const s = style || {};
    const valign = valignToAlign(s.valign);
    let css = 'width:100%;height:100%;box-sizing:border-box;overflow:hidden;display:flex;';
    css += wrapCss(s);
    css += `font-size:${s.fontPt || 10.5}pt;line-height:${s.lineHeight || 1.05};${typographyInlineCss(s)}`;
    css += `text-align:${s.align || 'left'};align-items:${valign};padding:${s.padMm != null ? s.padMm : 0.35}mm;`;
    if (s.wrap === 'pre-line' || s.wrap === 'wrap' || s.wrap === 'break-word') css += 'align-items:flex-start;';
    const inner = escapeHtml(normalizePrintFieldText(text));
    return `<div class="plf-body plf-body--text" style="${css}"><span style="width:100%;">${inner}</span></div>`;
  }

  /**
   * Yükleme notunu düzenleyici + baskı için aynı düz metne çevirir.
   * opts.lines: hazır satırlar (print-main ihracat/piyasa işlediyse)
   */
  function normalizeNotePlainText(raw, opts) {
    const s = (opts && opts.style) || defaultNoteStyle();
    if (opts && Array.isArray(opts.lines) && opts.lines.length) {
      return opts.lines.map((x) => String(x || '').trim()).filter(Boolean).join('\n');
    }
    const t = String(raw || '').trim();
    if (!t) return '';
    const lines = t.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
    if (!lines.length) return '';
    const head = lines[0] || '';
    let desc = lines.slice(1).join(' ');
    const split = splitTextByPhrases(desc, s.breakAfter, s.maxLines);
    if (split.length > 1) desc = split.join('\n');
    else if (desc) desc = split[0] || desc;
    return desc ? `${head}\n${desc}` : head;
  }

  function buildNoteInnerHtml(raw, style, opts) {
    const s = style || defaultNoteStyle();
    const plain = normalizeNotePlainText(raw, Object.assign({}, opts, { style: s }));
    const lines = plain.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
    const head = lines[0] || '';
    const desc = lines.slice(1).join('\n');
    return (
      `<div class="plf-body plf-body--note" style="height:100%;overflow:hidden;padding:1.15mm 0.5mm 0.55mm;box-sizing:border-box;">` +
      `<div style="font-size:${s.headPt}pt;${typographyInlineCss(s, 'head')}margin:0 0 ${s.headGapMm}mm;line-height:1.1;color:#000;">${escapeHtml(head)}</div>` +
      `<div style="font-size:${s.descPt}pt;line-height:${s.lineHeight};white-space:pre-line;color:#000;${typographyInlineCss(s, 'desc')}">${escapeHtml(normalizePrintFieldText(desc))}</div>` +
      `</div>`
    );
  }

  function buildSigInnerHtml(name, imgSrc, style) {
    const s = style || defaultSigStyle('imzaKantar');
    const align = s.align === 'left' ? 'flex-start' : 'center';
    const textAlign = s.align === 'left' ? 'left' : 'center';
    const padTop = s.padTopMm != null ? s.padTopMm : 5;
    const img = imgSrc
      ? `<img src="${escapeHtml(imgSrc)}" alt="" style="max-height:${s.imgMaxMm}mm;max-width:90%;width:auto;height:auto;object-fit:contain;display:block;">`
      : '';
    return (
      `<div class="plf-body plf-body--sig" style="height:100%;display:flex;flex-direction:column;justify-content:flex-end;box-sizing:border-box;padding:${padTop}mm 0.5mm 0.5mm;align-items:${align};gap:${s.nameGapMm}mm;overflow:hidden;">` +
      img +
      `<div style="font-size:${s.namePt}pt;font-weight:700;text-align:${textAlign};line-height:1.05;color:#000;width:100%;">${escapeHtml(name || '')}</div>` +
      `</div>`
    );
  }

  /**
   * Düzenleyici şablonu ile birebir aynı motor — % konum, aynı punto/satır.
   * Ekran önizleme: 1:1 (margin yok, kırpma yok).
   * Baskı: hafif ölçek + üst boşluk (yazıcı kenar payı), içerik sığar.
   */
  function buildLayoutPrintDocument(opts) {
    const bgUrl = opts && opts.bgUrl ? opts.bgUrl : '';
    const pageSize = (opts && opts.pageSize) || 'A5';
    const values = (opts && opts.values) || {};
    const signatures = (opts && opts.signatures) || {};
    const noteLines = opts && opts.noteLines;
    const pageParams = pageSize === 'A4'
      ? { size: 'A4', width: '210mm', height: '297mm' }
      : { size: 'A5 landscape', width: '210mm', height: '148mm' };

    let fieldsHtml = '';
    FIELD_DEFS.forEach((def) => {
      const rect = getFieldRect(def.key);
      if (!rect) return;
      const pos = pctStyle(rect);
      let inner = '';
      if (def.kind === 'note') {
        inner = buildNoteInnerHtml(
          values.not != null ? values.not : '',
          getFieldStyle('not'),
          noteLines ? { lines: noteLines } : null
        );
      } else if (def.kind === 'sig') {
        const sig = signatures[def.key] || {};
        inner = buildSigInnerHtml(sig.name || values[def.key] || '', sig.src || '', getFieldStyle(def.key));
      } else {
        const val = values[def.key] != null ? values[def.key] : '';
        inner = buildTextInnerHtml(val, getFieldStyle(def.key));
      }
      fieldsHtml += `<div class="plf-field" data-key="${def.key}" style="${pos}">${inner}</div>`;
    });

    return `<!DOCTYPE html>
<html lang="tr">
<head>
<meta charset="utf-8">
<title>Sevkiyat Formu</title>
<style>
  @page { size: ${pageParams.size}; margin: 0; }
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  html, body {
    margin: 0; padding: 0;
    width: ${pageParams.width}; height: ${pageParams.height};
    overflow: hidden; font-family: Arial, sans-serif; background: #fff;
  }
  #printViewport, #printRoot {
    width: ${pageParams.width}; height: ${pageParams.height};
    overflow: hidden; position: relative;
  }
  /* Düzenleyici = önizleme = yazdır — birebir aynı (ölçek farkı yok) */
  .plf-page {
    position: relative;
    width: 210mm;
    height: ${FORM_CONTENT_H}mm;
    margin: 0 auto;
    overflow: hidden;
    transform: none;
    transform-origin: top center;
  }
  .plf-bg { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: fill; z-index: 0; display: block; }
  .plf-fields { position: absolute; inset: 0; z-index: 1; }
  .plf-field { position: absolute; overflow: hidden; }
  @media print {
    html, body, #printViewport, #printRoot { overflow: hidden !important; }
    .plf-page {
      transform: none !important;
      margin: 0 auto !important;
    }
  }
</style>
</head>
<body>
<div id="printViewport"><div id="printRoot">
  <div class="plf-page">
    <img class="plf-bg" src="${bgUrl}" alt="">
    <div class="plf-fields">${fieldsHtml}</div>
  </div>
</div></div>
</body>
</html>`;
  }

  function applyImzaKantarToCoords(P) { return applyLayoutToCoords(P); }

  function sampleForField(key) {
    const def = getDef(key);
    if (!def) return '';
    const saved = load();
    if (saved.samples && saved.samples[key] != null && String(saved.samples[key]).trim() !== '') {
      return String(saved.samples[key]);
    }
    if (def.kind === 'sig') return def.sampleName || '';
    return def.sample || '';
  }

  function getSampleText(key) {
    return sampleForField(key);
  }

  /** Ayarlar → canlı baskı önizlemesi için örnek form verileri (DOM id eşlemesi). */
  function getDemoPrintData() {
    return {
      yuklemeSirasi: sampleForField('yuklemeSirasi') || '127',
      firmaKodu: sampleForField('firma'),
      malzeme: sampleForField('malzeme'),
      yuklemeNotu: sampleForField('not'),
      soforBilgi: sampleForField('sofor'),
      iletisimBilgi: sampleForField('iletisim'),
      tcBilgi: sampleForField('tc'),
      cekiciPlakaBilgi: sampleForField('cekici'),
      dorsePlakaBilgi: sampleForField('dorse'),
      sevkYeri: sampleForField('sevkYeri'),
      tonaj: sampleForField('tonaj'),
      ambalajBilgisi: sampleForField('ambBilgi'),
      seperatorBilgisi: sampleForField('seperator'),
      bbt: sampleForField('bbt'),
      bosBbt: sampleForField('bosBbt'),
      cuval: sampleForField('cuval'),
      bosCuval: sampleForField('bosCuval'),
      palet: sampleForField('palet'),
      torba: sampleForField('torba'),
      imzaKantarAd: sampleForField('imzaKantar'),
      imzaSahaAd: sampleForField('imzaSaha'),
      imzaYukleyenAd: sampleForField('imzaYukleyen'),
      imzaKaliteAd: sampleForField('imzaKalite'),
    };
  }

  window.PrintLayoutSettings = {
    STORAGE_KEY,
    STYLE_DEFAULTS,
    FIELD_DEFS,
    WRAP_MODES,
    DEFAULT_NOTE_BREAKS,
    HEAD_BOLD_WEIGHT,
    TEXT_BOLD_WEIGHT,
    NORMAL_WEIGHT,
    DESC_BOLD_WEIGHT,
    FORM_W_MM,
    FORM_H_MM: FORM_CONTENT_H,
    buildBasePrintCoords,
    buildBaseImzaKantarRect: () => getFieldRect('imzaKantar'),
    load,
    save,
    reset,
    pushToServer,
    resetOnServer,
    ensureSynced,
    ensureSyncedOnce,
    applyRemoteLayout,
    pullFromServer,
    getDef,
    getDefaultFieldStyle,
    getFieldRect,
    getAllFieldRects,
    getFieldStyle,
    getStyle,
    getImzaKantarRect: () => getFieldRect('imzaKantar'),
    getImzaKantarStyle,
    getYuklemeNotuStyle,
    getNoteBreakPhrases,
    splitTextByPhrases,
    applyLayoutToCoords,
    applyImzaKantarToCoords,
    buildPrintLayoutCss,
    buildImzaPrintCss,
    buildFullPrintLayoutCss,
    buildLayoutPrintDocument,
    pctStyle,
    buildFieldCssRules,
    fieldPosStyle,
    normalizeFieldStyle,
    normalizePrintFieldText,
    formatFieldDisplayText,
    formatSevkYeriDisplay,
    formatAmbalajDisplay,
    getSampleText,
    getDemoPrintData,
    useStrictPrintLayout,
    hasSavedLayout,
    setPreviewSnapshot,
    clearPreviewSnapshot,
    normalizeNotePlainText,
  };

  // Sekmeler arası / SSE: düzen güncellenince belleği yenile
  try {
    window.addEventListener('storage', function (e) {
      if (!e || !e.key) return;
      if (e.key === 'printLayoutBump' || e.key === 'gpm_sync_bump_print_layout_updated') {
        ensureSynced().catch(function () {});
      }
    });
  } catch (e) { /* ignore */ }
})();
