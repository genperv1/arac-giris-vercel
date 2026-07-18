// print-main.js — window.Print API (IIFE)
// Otomatik bölüm — scripts/split-large-files.js

// print.js (extracted from original GİRİŞ.html, refactor-safe)
(() => {
  'use strict';
  const TR_APP_TZ = 'Europe/Istanbul';
  const PRINT_BG_LEGACY = 'https://i.hizliresim.com/36cc3jp.jpg';
  const PRINT_BG_API = '/api/print-form-bg';
  const PRINT_BG_ASSET = '/assets/takip-form-bg.jpg';
  const PRINT_BG_CACHE_KEY = 'printBgDataUrl_v3';

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  async function syncPrintFormBgToServer(imageData) {
    try {
      await fetch(PRINT_BG_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ imageData, source: 'auto-migrate' }),
      });
    } catch (_) {}
  }

  function getPrintOrigin() {
    try { return window.location.origin || ''; } catch (_) { return ''; }
  }

  function toPrintBgSrc(url) {
    const s = String(url || '').trim();
    if (!s) return PRINT_BG_LEGACY;
    if (/^data:/i.test(s) || /^https?:\/\//i.test(s)) return s;
    const origin = getPrintOrigin();
    if (!origin) return PRINT_BG_LEGACY;
    if (s.startsWith('/')) return origin + s;
    return origin + '/' + s;
  }

  function isRealImageDataUrl(url) {
    return /^data:image\/(jpeg|jpg|png)/i.test(String(url || ''));
  }

  async function resolvePrintBgUrl() {
    try {
      const custom = String(localStorage.getItem('printBgUrl') || '').trim();
      if (custom) return toPrintBgSrc(custom);
    } catch (_) {}

    try {
      const cached = localStorage.getItem(PRINT_BG_CACHE_KEY);
      if (cached && isRealImageDataUrl(cached)) return cached;
    } catch (_) {}

    const origin = getPrintOrigin();
    const sources = [
      origin ? origin + PRINT_BG_API : '',
      origin ? origin + PRINT_BG_ASSET : '',
      PRINT_BG_LEGACY,
    ].filter(Boolean);

    for (const src of sources) {
      try {
        const r = await fetch(src, { credentials: 'same-origin', cache: 'force-cache' });
        if (!r.ok) continue;
        const ct = String(r.headers.get('content-type') || '').toLowerCase();
        if (ct.includes('xml') || ct.includes('html') || ct.includes('json') || ct.includes('svg')) continue;
        const blob = await r.blob();
        if (!blob || blob.size < 500) continue;
        const dataUrl = await blobToDataUrl(blob);
        if (!isRealImageDataUrl(dataUrl)) continue;
        try { localStorage.setItem(PRINT_BG_CACHE_KEY, dataUrl); } catch (_) {}
        if (src === PRINT_BG_LEGACY) syncPrintFormBgToServer(dataUrl);
        return dataUrl;
      } catch (_) {}
    }

    // Orijinal JPG yoksa harici link — SVG/builtin asla kullanılmaz
    return origin ? origin + PRINT_BG_API : PRINT_BG_LEGACY;
  }

  function loadImageAsDataUrl(url) {
    return new Promise(function (resolve, reject) {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = function () {
        try {
          if (!img.naturalWidth || img.naturalWidth < 200) {
            reject(new Error('image too small'));
            return;
          }
          const canvas = document.createElement('canvas');
          canvas.width = img.naturalWidth;
          canvas.height = img.naturalHeight;
          canvas.getContext('2d').drawImage(img, 0, 0);
          resolve(canvas.toDataURL('image/jpeg', 0.92));
        } catch (e) {
          reject(e);
        }
      };
      img.onerror = function () { reject(new Error('image load failed')); };
      img.src = String(url || '') + (String(url || '').includes('?') ? '&' : '?') + 't=' + Date.now();
    });
  }

  async function ensurePrintBgDataUrl() {
    try {
      const cached = localStorage.getItem(PRINT_BG_CACHE_KEY);
      if (cached && isRealImageDataUrl(cached)) return cached;
      if (cached && !isRealImageDataUrl(cached)) {
        try { localStorage.removeItem(PRINT_BG_CACHE_KEY); } catch (_) {}
      }
    } catch (_) {}

    let url = await resolvePrintBgUrl();
    if (isRealImageDataUrl(url)) return url;

    const origin = getPrintOrigin();
    const candidates = [
      toPrintBgSrc(url),
      origin ? origin + PRINT_BG_API : '',
      origin ? origin + PRINT_BG_ASSET : '',
      PRINT_BG_LEGACY,
    ].filter(Boolean);

    const seen = new Set();
    for (const src of candidates) {
      if (seen.has(src)) continue;
      seen.add(src);
      try {
        const sameOrigin = !!(origin && src.startsWith(origin));
        const r = await fetch(src, {
          credentials: sameOrigin ? 'same-origin' : 'omit',
          mode: sameOrigin ? 'same-origin' : 'cors',
          cache: 'no-cache',
        });
        if (!r.ok) continue;
        const ct = String(r.headers.get('content-type') || '').toLowerCase();
        if (ct.includes('json') || ct.includes('html') || ct.includes('xml') || ct.includes('svg')) continue;
        const blob = await r.blob();
        if (!blob || blob.size < 500) continue;
        const dataUrl = await blobToDataUrl(blob);
        if (!isRealImageDataUrl(dataUrl)) continue;
        try { localStorage.setItem(PRINT_BG_CACHE_KEY, dataUrl); } catch (_) {}
        syncPrintFormBgToServer(dataUrl);
        return dataUrl;
      } catch (_) {}
    }

    try {
      const dataUrl = await loadImageAsDataUrl(PRINT_BG_LEGACY);
      if (isRealImageDataUrl(dataUrl)) {
        try { localStorage.setItem(PRINT_BG_CACHE_KEY, dataUrl); } catch (_) {}
        syncPrintFormBgToServer(dataUrl);
        return dataUrl;
      }
    } catch (_) {}

    if (window.PrintFormBgUpload && typeof window.PrintFormBgUpload.pickAndUpload === 'function') {
      const picked = await window.PrintFormBgUpload.pickAndUpload({ silent: false });
      if (picked && isRealImageDataUrl(picked)) return picked;
    }

    return null;
  }

  window.PrintFormBg = {
    resolvePrintBgUrl,
    ensurePrintBgDataUrl,
    toPrintBgSrc,
    syncPrintFormBgToServer,
    cacheKey: PRINT_BG_CACHE_KEY,
    clearCache() {
      try {
        localStorage.removeItem(PRINT_BG_CACHE_KEY);
        localStorage.removeItem('printBgDataUrl');
        localStorage.removeItem('printBgUrl');
      } catch (_) {}
    },
  };
  function trLocaleDateString(date) {
    const d = date || new Date();
    return d.toLocaleDateString('tr-TR', { timeZone: TR_APP_TZ });
  }
  function trLocaleString(date) {
    const d = date || new Date();
    return d.toLocaleString('tr-TR', { timeZone: TR_APP_TZ });
  }
  // AMBALAJ BİLGİSİ: kısaltmaları okunur hale getir (SP -> Streç Palet gibi)
  function normalizeAmbalajBilgisi(raw) {
    const text = String(raw ?? '').trim();
    if (!text) return '';

    const map = new Map([
      ['SP', 'Streç Palet'],
      ['BBT', 'Big Bag'],
      ['BP', 'Big Bag Palet'],
      ['PLT', 'Palet'],
      ['PALET', 'Palet'],
      ['TOR', 'Torba'],
      ['TORBA', 'Torba'],
      ['CUV', 'Çuval'],
      ['CUVAL', 'Çuval'],
      ['ÇUVAL', 'Çuval'],
      ['BOS CUV', 'Boş Çuval'],
      ['BOS CUVAL', 'Boş Çuval'],
      ['BOŞ ÇUVAL', 'Boş Çuval'],
      ['BOS BBT', 'Boş Big Bag'],
      ['BOŞ BBT', 'Boş Big Bag'],
      ['BOSBBT', 'Boş Big Bag'],
      ['BOŞBBT', 'Boş Big Bag'],
    ]);

    // "SP/BBT", "SP, BBT", "SP - BBT" gibi çoklu girişleri destekle
    const parts = text.split(/\s*(?:\/|,|;|\||\r?\n|\s+-\s+)\s*/g).filter(Boolean);

    const normOne = (p) => {
      const original = String(p ?? '').trim();
      if (!original) return '';

      // Nokta/çoklu boşluk temizle
      const key = original
        .replace(/[.]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .toUpperCase();

      // "BOŞ BBT" / "BOS BBT" varyasyonlarını yakala
      const keyNoTurkishI = key.replace(/İ/g, 'I');
      if (/^(BOS|BOŞ)\s*BBT$/.test(keyNoTurkishI)) return 'Boş Big Bag';
      if (/^(BOS|BOŞ)\s*(CUV|CUVAL|ÇUVAL)$/.test(keyNoTurkishI)) return 'Boş Çuval';

      return map.get(key) || original;
    };

    const out = parts.map(normOne).filter(Boolean);

    // Girişte çoklu ise okunur bir ayraçla yazdır
    return out.length > 1 ? out.join(' / ') : out[0];
  }




  /** Uzun açıklamayı yazdırmada 2–4 okunur satıra böler (tek satırda mikro punto olmasın) */
  function wrapYuklemeNotuText(text, maxChars) {
    const max = Math.max(32, Number(maxChars) || 54);
    const words = String(text || '').trim().split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    const out = [];
    let cur = '';
    for (const w of words) {
      const next = cur ? `${cur} ${w}` : w;
      if (next.length > max && cur) {
        out.push(cur);
        cur = w;
      } else {
        cur = next;
      }
    }
    if (cur) out.push(cur);
    return out;
  }

  function splitLinesIntoTwoColumns(lines) {
    const L = (lines || []).filter(Boolean);
    if (!L.length) return [[], []];
    const mid = Math.ceil(L.length / 2);
    return [L.slice(0, mid), L.slice(mid)];
  }

  /** Açıklamayı iki sütuna dengeli dağıt (kelime bazlı) */
  function balanceDescIntoTwoColumns(descParts) {
    const words = (descParts || [])
      .map((p) => String(p || '').trim())
      .filter(Boolean)
      .join(' ')
      .split(/\s+/)
      .filter(Boolean);
    if (!words.length) return [[], []];
    const left = [];
    const right = [];
    let leftLen = 0;
    let rightLen = 0;
    for (const w of words) {
      if (leftLen <= rightLen) {
        left.push(w);
        leftLen += w.length + 1;
      } else {
        right.push(w);
        rightLen += w.length + 1;
      }
    }
    return [
      wrapYuklemeNotuText(left.join(' '), 42),
      wrapYuklemeNotuText(right.join(' '), 42),
    ];
  }

  function isPiyasaFormContext(t) {
    try {
      const pending = window.__pendingPrintCommit;
      if (pending && pending.piyasaOrderIdx != null && pending.piyasaOrderIdx !== '') return true;
    } catch (e) {}
    try {
      if (window.piyasa && typeof window.piyasa.getActiveOrderIdx === 'function') {
        const idx = window.piyasa.getActiveOrderIdx();
        if (idx != null && idx !== '') return true;
      }
    } catch (e) {}
    if (looksLikePiyasaNote(t)) return true;
    return false;
  }

  function resolveIrsaliyeForPrint() {
    try {
      if (isPiyasaFormContext() && !isIhracatFormContext('')) return '';
    } catch (e) {}
    try {
      const xr = document.getElementById('xr_irsaliye');
      if (xr && String(xr.value || '').trim()) {
        return typeof normalizeIrsaliyeNo === 'function'
          ? normalizeIrsaliyeNo(xr.value)
          : String(xr.value).trim();
      }
    } catch (e) {}
    try {
      if (typeof getShipmentIrsaliyeNo === 'function') {
        const ch = window.__activeExcelShipment || window.__lastChosenShipment;
        const irs = getShipmentIrsaliyeNo(ch);
        if (irs) return irs;
      }
    } catch (e) {}
    return '';
  }

  const ARAC_BOS_LINE_RE = /^NET\s+BOŞ\s+AĞIRLIK\s*:/i;

  function resolveYuklemeNotuForPrint(raw) {
    let t = String(raw ?? '').trim();
    const noteKind = resolveYuklemeNotuKind(t);
    if (noteKind === 'piyasa') return t;
    if (!/^İrsaliye\s*No\s*:/im.test(t) && !/^IRSALIYE\s*NO\s*:/im.test(t)) {
      const irs = resolveIrsaliyeForPrint();
      if (irs) t = t ? `İrsaliye No: ${irs}\n${t}` : `İrsaliye No: ${irs}`;
      else t = t ? `İrsaliye No:\n${t}` : 'İrsaliye No:';
    }
    return t;
  }

  const YUKLEME_NOTU_FIT_STORAGE_KEY = 'yuklemeNotuFit_v1';
  const YUKLEME_NOTU_FIT_DEFAULTS = {
    ihracat: { headPt: 10.75, descPt: 7.5, minHeadPt: 10, minDescPt: 6.5, headStep: 0.08, descStep: 0.08 },
    piyasa: { headPt: 10, descPt: 8.5, minHeadPt: 9, minDescPt: 7.75, headStep: 0.05, descStep: 0.06 },
    screen: {
      ihracat: { minPx: 9, maxPx: 11 },
      piyasa: { minPx: 11, maxPx: 14 },
    },
  };

  function clampFitNum(v, min, max, fallback) {
    const n = Number(v);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  }

  function loadYuklemeNotuFitSettings() {
    const out = JSON.parse(JSON.stringify(YUKLEME_NOTU_FIT_DEFAULTS));
    try {
      const raw = localStorage.getItem(YUKLEME_NOTU_FIT_STORAGE_KEY);
      if (!raw) return out;
      const saved = JSON.parse(raw);
      ['ihracat', 'piyasa'].forEach((kind) => {
        const src = saved && saved[kind];
        if (!src || typeof src !== 'object') return;
        const dst = out[kind];
        dst.headPt = clampFitNum(src.headPt, 6, 14, dst.headPt);
        dst.descPt = clampFitNum(src.descPt, 5, 12, dst.descPt);
        dst.minHeadPt = clampFitNum(src.minHeadPt, 5, dst.headPt, dst.minHeadPt);
        dst.minDescPt = clampFitNum(src.minDescPt, 4, dst.descPt, dst.minDescPt);
      });
      ['ihracat', 'piyasa'].forEach((kind) => {
        const src = saved && saved.screen && saved.screen[kind];
        if (!src || typeof src !== 'object') return;
        out.screen[kind].minPx = clampFitNum(src.minPx, 7, 16, out.screen[kind].minPx);
        out.screen[kind].maxPx = clampFitNum(src.maxPx, 8, 18, out.screen[kind].maxPx);
        if (out.screen[kind].maxPx < out.screen[kind].minPx) {
          out.screen[kind].maxPx = out.screen[kind].minPx;
        }
      });
    } catch (e) { /* ignore */ }
    return out;
  }

  function saveYuklemeNotuFitSettings(next) {
    const cur = loadYuklemeNotuFitSettings();
    const merged = JSON.parse(JSON.stringify(cur));
    ['ihracat', 'piyasa'].forEach((kind) => {
      const src = next && next[kind];
      if (!src || typeof src !== 'object') return;
      if (src.headPt != null) merged[kind].headPt = clampFitNum(src.headPt, 6, 14, merged[kind].headPt);
      if (src.descPt != null) merged[kind].descPt = clampFitNum(src.descPt, 5, 12, merged[kind].descPt);
    });
    try {
      localStorage.setItem(YUKLEME_NOTU_FIT_STORAGE_KEY, JSON.stringify(merged));
    } catch (e) { /* ignore */ }
    return merged;
  }

  function looksLikePiyasaNote(t) {
    const s = String(t || '');
    return /BBT\s+HP|NET\s+BOŞ\s+AĞIRLIK|ORGANİZE\s+EDİLMESİ|ORGANIZE\s+EDILMESI|ÖDEME\s+TÜRÜ|ODEME\s+TURU|RİCA\s+OLUNUR|RICA\s+OLUNUR|ANALİZ\s+SERTİFİKA|NETSİS|UNUTULMAMALIDIR|SİPARİŞ\s+NUMARASI|SIPARIS\s+NUMARASI/i.test(s);
  }

  /** Excel satır kırıklarını kaldır; DD.MM.YYYY tarihini tek parça tut */
  function normalizePiyasaDescText(raw) {
    let t = String(raw || '')
      .replace(/\r?\n+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    // "1.\nARAÇ" gibi kırıkları tek satıra al
    t = t.replace(/(\d+\.)\s+/g, '$1 ');
    t = t.replace(/(\d{1,2})\s*\.\s*(\d{1,2})\s*\.\s*(\d{4})\b/g, '$1.$2.$3');
    t = t.replace(/\.(?=[A-ZÇĞİÖŞÜa-zçğıöşü])/g, '. ');
    return t.trim();
  }

  /** Tarih parçalarını birleştir (18. + 04. + 2026 … → 18.04.2026 …) */
  function mergePiyasaDateLineChunks(chunks) {
    const L = (chunks || []).map((s) => String(s || '').trim()).filter(Boolean);
    if (L.length < 2) return L;
    const out = [];
    for (let i = 0; i < L.length; i++) {
      if (/^\d{1,2}\.$/.test(L[i]) && i + 2 < L.length && /^\d{1,2}\.$/.test(L[i + 1]) && /^\d{4}\b/.test(L[i + 2])) {
        out.push(`${L[i]}${L[i + 1]}${L[i + 2]}`.replace(/\s+/g, ' '));
        i += 2;
        continue;
      }
      if (/^\d{1,2}\.$/.test(L[i]) && i + 1 < L.length && /^\d{1,2}\.\s*\d{4}\b/.test(L[i + 1])) {
        out.push(`${L[i]}${L[i + 1]}`.replace(/\s+/g, ' '));
        i += 1;
        continue;
      }
      out.push(L[i]);
    }
    return out;
  }

  /** Piyasa açıklaması: geniş satır, en fazla 3 cümle satırı (+ opsiyonel boş ağırlık) */
  function splitPiyasaDescIntoLines(text, maxLines = 3) {
    const t = normalizePiyasaDescText(text);
    if (!t) return [];

    // Numaralı liste: "1. ARAÇ ... 2. ARAÇ ..." — madde numarası metinden ayrılmasın
    if (/\d+\.\s+[A-ZÇĞİÖŞÜa-zçğıöşü]/i.test(t) && /\.\s+\d+\.\s+/.test(t)) {
      const listItems = t
        .split(/(?<=\.)\s+(?=\d+\.\s+[A-ZÇĞİÖŞÜa-zçğıöşü])/i)
        .map((s) => s.trim())
        .filter(Boolean);
      if (listItems.length > 1) {
        if (listItems.length <= maxLines) return listItems;
        let merged = listItems.slice();
        while (merged.length > maxLines) {
          let idx = 0;
          let minLen = Infinity;
          for (let i = 0; i < merged.length - 1; i++) {
            const len = merged[i].length + merged[i + 1].length;
            if (len < minLen) {
              minLen = len;
              idx = i;
            }
          }
          merged.splice(idx, 2, `${merged[idx]} ${merged[idx + 1]}`);
        }
        return merged;
      }
    }

    let chunks = t
      .split(/(?<=[!?])\s+|(?<=\.)\s+(?=\d+\.\s+[A-ZÇĞİÖŞÜa-zçğıöşü])|(?<=\.)(?<!\d)\s+(?!\d)/)
      .map((s) => s.trim())
      .filter(Boolean);
    chunks = mergePiyasaDateLineChunks(chunks);
    if (chunks.length <= 1 && t.includes('.')) {
      chunks = t
        .split(/(?<!\d)\.(?=\s+(?!\d))/)
        .map((s, i, arr) => (i < arr.length - 1 ? `${s.trim()}.` : s.trim()))
        .filter(Boolean);
      chunks = mergePiyasaDateLineChunks(chunks);
    }
    if (!chunks.length) chunks = [t];

    if (chunks.length <= maxLines) return chunks;

    while (chunks.length > maxLines) {
      let idx = 0;
      let minLen = Infinity;
      for (let i = 0; i < chunks.length - 1; i++) {
        const len = chunks[i].length + chunks[i + 1].length;
        if (len < minLen) {
          minLen = len;
          idx = i;
        }
      }
      chunks.splice(idx, 2, `${chunks[idx]} ${chunks[idx + 1]}`);
    }
    return chunks;
  }

  function mergeWrapLinesToMax(lines, maxLines, maxChars) {
    let L = (lines || []).filter(Boolean);
    if (!L.length) return [];
    while (L.length > maxLines) {
      let idx = 0;
      let minLen = Infinity;
      for (let i = 0; i < L.length - 1; i++) {
        const len = L[i].length + L[i + 1].length;
        if (len < minLen) {
          minLen = len;
          idx = i;
        }
      }
      L.splice(idx, 2, `${L[idx]} ${L[idx + 1]}`);
    }
    if (L.length <= maxLines) return L;
    return wrapYuklemeNotuText(L.join(' '), maxChars).slice(0, maxLines);
  }

  function isIhracatFormContext(t) {
    try {
      const fk = String(document.getElementById('firmaKodu')?.value || '').trim();
      if (/YD\d/i.test(fk)) return true;
    } catch (e) {}
    try {
      const ch = window.__activeExcelShipment || window.__lastChosenShipment;
      if (ch && (ch.blockMeta || ch.headerText)) return true;
      const chTxt = String(ch?.headerText || ch?.firma || ch?.yuklemeNotu || '');
      if (/YD\d/i.test(chTxt)) return true;
    } catch (e) {}
    if (isPiyasaFormContext(t)) return false;
    const note = String(t || '').trim();
    if (/SEVKİYATLARDA|SEVKIYATLARDA|DİKKAT\s+EDİLECEK|DIKKAT\s+EDILECEK/i.test(note)) return true;
    if (/^İrsaliye\s*No\s*:/im.test(note) && !looksLikePiyasaNote(note)) return true;
    return false;
  }

  /** Takip formu: ihracat ve piyasa ayrı — önce ihracat bağlamı, sonra piyasa siparişi */
  function resolveYuklemeNotuKind(raw) {
    const t = String(raw ?? document.getElementById('yuklemeNotu')?.value ?? '').trim();
    if (isIhracatFormContext(t)) return 'ihracat';
    if (isPiyasaFormContext(t)) return 'piyasa';
    return 'piyasa';
  }

  function getYuklemeNotuFitPreset(kind) {
    const settings = loadYuklemeNotuFitSettings();
    const key = kind === 'ihracat' ? 'ihracat' : 'piyasa';
    return Object.assign({}, settings[key]);
  }

  function getYuklemeNotuScreenFit(kind) {
    const settings = loadYuklemeNotuFitSettings();
    const key = kind === 'ihracat' ? 'ihracat' : 'piyasa';
    return Object.assign({}, settings.screen[key]);
  }

  function isAracBosNoteLine(line) {
    const s = String(line || '').trim();
    return ARAC_BOS_LINE_RE.test(s) || /^NET\s+BOŞ\s+AĞIRLIK/i.test(s);
  }

  /** İhracat: yalnızca cümle satırları (en fazla 3), kelime kırma yok — piyasa ile ayrı */
  function splitIhracatDescIntoLines(text, maxLines = 3) {
    let t = String(text || '').replace(/\r?\n+/g, ' ').replace(/\s+/g, ' ').trim();
    if (!t) return [];
    t = t.replace(/\.([A-ZÇĞİÖŞÜa-zçğıöşü])/g, '. $1');

    let chunks = t
      .split(/(?<=[.!?])\s+(?!\d)/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (chunks.length <= 1 && t.includes('.')) {
      chunks = t
        .split(/\.(?=\s+(?!\d))/)
        .map((s, i, arr) => (i < arr.length - 1 ? `${s.trim()}.` : s.trim()))
        .filter(Boolean);
    }
    if (!chunks.length) chunks = [t];

    if (chunks.length > maxLines) {
      const head = chunks.slice(0, maxLines - 1);
      const tail = chunks.slice(maxLines - 1).join(' ');
      chunks = [...head, tail];
    }
    return chunks;
  }

  function buildDescLinesForPrint(descParts, kind) {
    const parts = (descParts || []).map((s) => String(s || '').trim()).filter(Boolean);
    if (!parts.length) return [];
    if (kind === 'ihracat') {
      return splitIhracatDescIntoLines(parts.join(' '), 3);
    }

    const mainParts = parts.filter((p) => !isAracBosNoteLine(p));
    const mainText = normalizePiyasaDescText(mainParts.join(' '));

    let lines = splitPiyasaDescIntoLines(mainText, 3);
    if (!lines.length && mainText) {
      lines = mergeWrapLinesToMax(wrapYuklemeNotuText(mainText, 84), 3, 84);
    }
    return lines.length ? lines : splitPiyasaDescIntoLines(parts.join(' '), 3);
  }

  function sanitizeYuklemeNotuLines(lines) {
    const out = [];
    const seen = new Set();
    let seenAracBos = false;
    for (const line of lines || []) {
      const s = String(line || '').trim();
      if (!s) continue;
      if (/^\d{1,2}$/.test(s)) continue;
      if (ARAC_BOS_LINE_RE.test(s)) {
        if (seenAracBos) continue;
        seenAracBos = true;
      }
      const key = s.replace(/\s+/g, ' ').toUpperCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(s);
    }
    return out;
  }

  function fitYuklemeNotuPrint(box) {
    try {
      if (!box) return;
      if (!box.clientHeight || box.clientHeight < 8) return;

      const body = box.querySelector('.note-body') || box;
      const inner = body.querySelector('.note-inner');
      if (!inner) return;
      const win = box.ownerDocument?.defaultView;

      box.style.overflow = 'hidden';
      body.style.overflow = 'hidden';
      inner.style.transform = 'none';
      inner.style.width = '100%';
      inner.style.letterSpacing = 'normal';

      const kind =
        inner.getAttribute('data-not-kind') ||
        box.getAttribute('data-not-kind') ||
        resolveYuklemeNotuKind();
      const preset = getYuklemeNotuFitPreset(kind);

      const headEl = inner.querySelector('.note-head');
      const descRows = inner.querySelectorAll('.note-row');
      let headPt = preset.headPt;
      const headDescGap = Math.max(0.75, preset.headPt - preset.descPt);
      let descPt = Math.max(preset.minDescPt, headPt - headDescGap);
      const minHeadPt = preset.minHeadPt;
      const minDescPt = preset.minDescPt;

      const availH = () => {
        let pad = 0;
        try {
          if (win) {
            const cs = win.getComputedStyle(body);
            pad = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
          }
        } catch (e) {}
        return Math.max(12, box.clientHeight - pad - 6);
      };

      const rowTooWide = () => {
        if (!win) return false;
        return Array.from(descRows).some(
          (row) => row.scrollWidth > row.clientWidth + 1
        );
      };

      const applySizes = () => {
        descPt = Math.max(minDescPt, headPt - headDescGap);
        if (headEl) {
          headEl.style.lineHeight = kind === 'ihracat' ? '1.12' : '1.1';
          headEl.style.fontSize = headPt + 'pt';
        }
        descRows.forEach((row) => {
          row.style.lineHeight = kind === 'piyasa' ? '1.18' : '1.08';
          row.style.fontSize = descPt + 'pt';
          if (kind === 'ihracat') {
            row.style.whiteSpace = 'pre-line';
            row.style.letterSpacing = '0';
          }
        });
      };

      applySizes();
      const skipShrink = kind === 'piyasa' && descRows.length <= 4;
      let guard = 0;
      if (!skipShrink) {
        while (guard < 48 && (inner.scrollHeight > availH() + 1 || rowTooWide())) {
          if (descPt > minDescPt) {
            descPt -= preset.descStep;
          } else if (headEl && headPt > minHeadPt) {
            headPt -= preset.headStep;
          } else {
            break;
          }
          applySizes();
          guard++;
        }
      }

      const overflow = inner.scrollHeight > availH() + 1 || rowTooWide();
      if (overflow && kind === 'ihracat') {
        const scale = Math.max(0.72, Math.min(1, (availH() / inner.scrollHeight) * 0.98));
        inner.style.transform = `scale(${scale})`;
        inner.style.transformOrigin = 'top left';
        if (scale < 1) inner.style.width = `${(100 / scale).toFixed(2)}%`;
      } else if (overflow) {
        const scale = Math.max(0.68, Math.min(1, (availH() / inner.scrollHeight) * 0.97));
        inner.style.transform = `scale(${scale})`;
        inner.style.transformOrigin = 'top left';
        if (scale < 1) inner.style.width = `${(100 / scale).toFixed(2)}%`;
      }

      // Piyasa: kutuda boşluk kalıyorsa hafifçe büyüt (satır sayısı az olduğu için)
      if (kind === 'piyasa' && descRows.length <= 4) {
        const maxHeadPt = preset.headPt + 1.2;
        const maxDescPt = preset.descPt + 1.5;
        let grow = 0;
        while (inner.scrollHeight < availH() * 0.9 && grow < 35) {
          let grew = false;
          if (descPt < maxDescPt) {
            descPt += 0.1;
            grew = true;
          } else if (headEl && headPt < maxHeadPt) {
            headPt += 0.08;
            grew = true;
          }
          if (!grew) break;
          applySizes();
          if (inner.scrollHeight > availH()) {
            if (headEl && headPt > preset.headPt) headPt -= 0.08;
            else descPt -= 0.1;
            applySizes();
            break;
          }
          grow++;
        }
      }
    } catch (e) {}
  }

  const LEGACY_KANTAR_SIG = {
    "BURAK KARATAŞ": "/signatures/burak_karatas.png",
    "BEKİR DOĞRU": "/signatures/bekir_dogru.png",
    "BATUHAN KOCABAY": "/signatures/batuhan_kocabay.png",
    "BATUHAN CINAR": "/signatures/batuhan_cinar.png",
    "BURAK TALAY": "/signatures/burak_talay.png"
  };

  function toPrintSignatureSrc(src) {
    try {
      if (window.SignatureRegistry && typeof window.SignatureRegistry.toAbsoluteSignatureSrc === 'function') {
        return window.SignatureRegistry.toAbsoluteSignatureSrc(src);
      }
    } catch (e) { /* ignore */ }
    const s = String(src || '').trim();
    if (!s) return '';
    if (/^data:/i.test(s) || /^https?:\/\//i.test(s)) return s;
    const origin = window.location.origin || '';
    if (s.startsWith('/')) return origin + s;
    return origin + '/' + s;
  }

  function resolveKantarSignatureSrc(name) {
    try {
      if (window.SignatureRegistry) {
        const src = window.SignatureRegistry.resolveSignatureSrc('kantar', name);
        if (src) return src;
      }
    } catch (e) { /* ignore */ }
    return LEGACY_KANTAR_SIG[(name || '').trim().toUpperCase()] || '';
  }

  function resolveSahaSignatureSrc(name) {
    try {
      if (window.SignatureRegistry) {
        return window.SignatureRegistry.resolveSignatureSrc('saha', name) || '';
      }
    } catch (e) { /* ignore */ }
    return '';
  }

  function applySignaturePreview(inputId, imgId, phId, resolveFn) {
    const input = document.getElementById(inputId);
    const img = document.getElementById(imgId);
    const ph = document.getElementById(phId);
    if (!input || !img || !ph) return;
    const src = resolveFn(input.value);
    if (src) {
      img.onerror = () => {
        img.style.display = 'none';
        ph.style.display = 'block';
        ph.textContent = 'İmza bulunamadı';
      };
      img.src = src;
      img.style.display = 'block';
      ph.style.display = 'none';
    } else {
      try { img.removeAttribute('src'); } catch (_) {}
      img.style.display = 'none';
      ph.style.display = 'block';
      ph.textContent = 'İmza otomatik gelecek';
    }
  }

  function refreshKantarSignaturePreview() {
    applySignaturePreview('imzaKantarAd', 'imzaKantarImg', 'imzaKantarPlaceholder', resolveKantarSignatureSrc);
  }

  function refreshSahaSignaturePreview() {
    applySignaturePreview('imzaSahaAd', 'imzaSahaImg', 'imzaSahaPlaceholder', resolveSahaSignatureSrc);
  }

  function bindKantarSignaturePicker() {
    const input = document.getElementById('imzaKantarAd');
    if (!input) return;
    input.addEventListener('input', refreshKantarSignaturePreview);
    input.addEventListener('change', refreshKantarSignaturePreview);
    setTimeout(refreshKantarSignaturePreview, 0);
  }

  function bindSahaSignaturePicker() {
    const input = document.getElementById('imzaSahaAd');
    if (!input) return;
    input.addEventListener('input', refreshSahaSignaturePreview);
    input.addEventListener('change', refreshSahaSignaturePreview);
    setTimeout(refreshSahaSignaturePreview, 0);
  }

function getLocalDateKey() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// Legacy helper: tek malzeme döndüren eski helper (güvenli şekilde yalnızca
// eslestirmeStorage varsa tanımlanır). Bu, sayaç hesaplayan fonksiyonların
// içine yanlışlıkla yerleştirilmemeli—global scope'ta bir kez tanımlanmalı.
try {
  if (typeof eslestirmeStorage !== 'undefined') {
    eslestirmeStorage.getMalzemeByFirma = eslestirmeStorage.getMalzemeByFirma || function (firma) {
      const list = (this.getByFirma ? this.getByFirma(firma) : []).filter(Boolean);
      return list.length ? list[0].malzeme : '';
    };
  }
} catch (e) {}

// ✅ Yükleme sırası (NO-COMMIT)
// Not: Tarayıcı "Yazdır" / "İptal" bilgisini kesin vermez.
// Bu yüzden burada SADECE önerilen sırayı döndürüyoruz; localStorage sayaç yazımı YAPMIYORUZ.
// Sayaç kesinleştirme işi app.js -> afterTakipPrint içinde (kullanıcı onayıyla) yapılır.
async function getNextYuklemeSirasi() {
 try {
    const res = await fetch("/reports/count");
    const data = await res.json();
    console.log("Kayıt sayısı (yuklemeSirasi için):", data.count);
    return data.count;
  } catch (err) {
    console.error(err);
    return null;
  }
}
			
        // Firma yönetimi fonksiyonları
        const firmaStorage = {
            save: () => {
                localStorage.setItem('firmaListesi', JSON.stringify(firmaListesi));
            },
            load: () => {
                const data = localStorage.getItem('firmaListesi');
                if (data) {
                    firmaListesi = JSON.parse(data);
                }
            },
            add: (firma) => {
                // Aynı firma zaten varsa ekleme
                if (firmaListesi.includes(firma)) {
                    return false;
                }
                
                // Yeni firmayı en üste ekle
                firmaListesi.unshift(firma);
                firmaStorage.save();
                return true;
            },
            update: (index, yeniFirma) => {
                if (index >= 0 && index < firmaListesi.length) {
                    firmaListesi[index] = yeniFirma;
                    firmaStorage.save();
                    return true;
                }
                return false;
            },
            delete: (index) => {
                if (index >= 0 && index < firmaListesi.length) {
                    firmaListesi.splice(index, 1);
                    firmaStorage.save();
                    return true;
                }
                return false;
            }
        };

        // Veri depolama fonksiyonları
        // Note: localStorage usage for vehicle records removed — use in-memory store
        const _memStore = {};
        const storage = {
          save: (key, data) => {
            try { _memStore[String(key)] = JSON.parse(JSON.stringify(data)); } catch (e) { _memStore[String(key)] = data; }
          },
          load: (key) => {
            const v = _memStore[String(key)];
            try { return v === undefined ? null : JSON.parse(JSON.stringify(v)); } catch (e) { return v === undefined ? null : v; }
          },
          loadAll: () => {
            const vehicles = [];
            for (const key in _memStore) {
              if (Object.prototype.hasOwnProperty.call(_memStore, key) && key.startsWith('vehicle_')) {
                try { vehicles.push(JSON.parse(JSON.stringify(_memStore[key]))); } catch (e) { vehicles.push(_memStore[key]); }
              }
            }
            return vehicles;
          },
          delete: (key) => {
            try { delete _memStore[String(key)]; } catch (e) {}
          }
        };

        // TÜM VERİLERİ DIŞA AKTAR - YENİ
        function exportAllData() {
            const allData = {
                vehicles: storage.loadAll(),
                firmalar: firmaListesi,
                eslestirmeler: eslestirmeListesi,
                malzemeler: malzemeListesi,
                exportTarihi: trLocaleString()
            };
            
            const dataStr = JSON.stringify(allData, null, 2);
            const dataBlob = new Blob([dataStr], {type: 'application/json'});
            const url = URL.createObjectURL(dataBlob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `tum_veriler_${new Date().toISOString().split('T')[0]}.json`;
            link.click();
            
            alert('✅ TÜM veriler (araçlar, firmalar, eşleştirmeler, malzemeler) indirildi!');
        }

        // TÜM VERİLERİ İÇE AKTAR - YENİ
        function importAllData(jsonData) {
            try {
                const allData = JSON.parse(jsonData);
                let sonuc = {
                    araclar: { added: 0, duplicate: 0 },
                    firmalar: { added: 0, duplicate: 0 },
                    eslestirmeler: { added: 0, duplicate: 0 },
                    malzemeler: { added: 0, duplicate: 0 }
                };
                
                // Araçları içe aktar
                if (allData.vehicles) {
                    allData.vehicles.forEach(vehicle => {
                        if (!isPlateExists(vehicle.cekiciPlaka)) {
                            storage.save(`vehicle_${vehicle.id}`, vehicle);
                            sonuc.araclar.added++;
                        } else {
                            sonuc.araclar.duplicate++;
                        }
                    });
                }
                
                // Firmaları içe aktar
                if (allData.firmalar) {
                    allData.firmalar.forEach(firma => {
                        if (!firmaListesi.includes(firma)) {
                            firmaListesi.unshift(firma);
                            sonuc.firmalar.added++;
                        } else {
                            sonuc.firmalar.duplicate++;
                        }
                    });
                    firmaStorage.save();
                }
                
                // Eşleştirmeleri içe aktar
                if (allData.eslestirmeler) {
                    allData.eslestirmeler.forEach(eslestirme => {
                        if (!eslestirmeListesi.some(e => 
                            e.firma === eslestirme.firma && e.malzeme === eslestirme.malzeme)) {
                            eslestirmeListesi.unshift(eslestirme);
                            sonuc.eslestirmeler.added++;
                        } else {
                            sonuc.eslestirmeler.duplicate++;
                        }
                    });
                    eslestirmeStorage.save();
                }
                
                // Malzemeleri içe aktar
                if (allData.malzemeler) {
                    allData.malzemeler.forEach(malzeme => {
                        if (!malzemeListesi.includes(malzeme)) {
                            malzemeListesi.unshift(malzeme);
                            sonuc.malzemeler.added++;
                        } else {
                            sonuc.malzemeler.duplicate++;
                        }
                    });
                    localStorage.setItem('malzemeListesi', JSON.stringify(malzemeListesi));
                }
                
                return sonuc;
            } catch (e) {
                return false;
            }
        }

        // Verileri yükle
        function loadVehicles() {
            state.vehicles = storage.loadAll();
            cleanDuplicatePlates();
            firmaStorage.load();
            
            // Malzeme listesini yükle
            const malzemeData = localStorage.getItem('malzemeListesi');
            if (malzemeData) {
                malzemeListesi = JSON.parse(malzemeData);
            }
            
            eslestirmeStorage.load();
            render();
        }

        // Form verilerini güncelle
        function updateFormData(field, value) {
            state.formData[field] = value;
        }

        // Kayıt ekle/güncelle
        function saveVehicle() {
            const cekiciPlaka = state.formData.cekiciPlaka.trim();
            
            if (!cekiciPlaka) {
                alert('❌ Çekici plaka zorunludur!');
                return;
            }

            if (!isValidTC(state.formData.tcKimlik)) {
                alert('❌ TC Kimlik numarası yalnızca rakam içermeli ve en fazla 11 hane olmalıdır!');
                return;
            }

            if (!isValidIletisim(state.formData.iletisim)) {
                alert('❌ İletişim numarası geçersiz!');
                return;
            }

            if (!state.editingId && isPlateExists(cekiciPlaka)) {
                alert('❌ Bu çekici plaka zaten kayıtlı!\n\nLütfen farklı bir plaka girin veya mevcut kaydı düzenleyin.');
                return;
            }

            if (state.editingId && isPlateExists(cekiciPlaka, state.editingId)) {
                alert('❌ Bu çekici plaka başka bir araçta kayıtlı!\n\nLütfen farklı bir plaka girin.');
                return;
            }

            const vehicleData = {
                id: state.editingId || Date.now().toString(),
                ...state.formData,
                kayitTarihi: state.editingId ? 
                    state.vehicles.find(v => v.id === state.editingId)?.kayitTarihi : 
                    trLocaleString()
            };

            storage.save(`vehicle_${vehicleData.id}`, vehicleData);
            
            if (state.editingId) {
                state.vehicles = state.vehicles.map(v => 
                    v.id === state.editingId ? vehicleData : v
                );
            } else {
                state.vehicles.push(vehicleData);
            }

            alert(state.editingId ? '✅ Kayıt güncellendi!' : '✅ Kayıt eklendi!');
            resetForm();
        }

        // Form'u sıfırla
        function resetForm() {
            state.formData = {
                cekiciPlaka: '',
                dorsePlaka: '',
                soforAdi: '',
                soforSoyadi: '',
                iletisim: '',
                tcKimlik: '',
               
            };
            state.editingId = null;
            state.showForm = false;
            render();
        }

        // Arama
        function filterVehicles() {
  if (!state.searchTerm) return state.vehicles;

  const term = state.searchTerm.toLowerCase();
  // ✅ Plaka aramasında boşluk / tire farkını yok say
  const termPlate = term.replace(/[\s-]+/g, '');

  return state.vehicles.filter(vehicle =>
    (vehicle.cekiciPlaka || '').toLowerCase().replace(/[\s-]+/g, '').includes(termPlate) ||
    (vehicle.dorsePlaka  || '').toLowerCase().replace(/[\s-]+/g, '').includes(termPlate) ||
    (vehicle.soforAdi    || '').toLowerCase().includes(term) ||
    (vehicle.soforSoyadi || '').toLowerCase().includes(term) ||
    (vehicle.iletisim    || '').toLowerCase().includes(term) ||
    (vehicle.tcKimlik    || '').toLowerCase().includes(term)
  );
}

        // Veri dışa aktar - YENİ
        async function exportData() {
            if (state.vehicles.length === 0 && firmaListesi.length === 0) {
                alert('❌ Dışa aktarılacak kayıt bulunamadı!');
                return;
            }
            
            if (await confirm('TÜM verileri (araçlar, firmalar, eşleştirmeler, malzemeler) dışa aktarmak istiyor musunuz?')) {
                exportAllData();
            }
        }

        // Veri içe aktar - YENİ
        function importData() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';
  input.style.display = 'none';
  document.body.appendChild(input);

  input.addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) {
      document.body.removeChild(input);
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const result = importAllData(event.target.result);
      if (result !== false) {
        let message = '✅ VERİLER BAŞARIYLA İÇE AKTARILDI:\n\n';

        if (result.araclar.added > 0) message += `• ${result.araclar.added} araç kaydı\n`;
        if (result.firmalar.added > 0) message += `• ${result.firmalar.added} firma\n`;
        if (result.eslestirmeler.added > 0) message += `• ${result.eslestirmeler.added} eşleştirme\n`;
        if (result.malzemeler.added > 0) message += `• ${result.malzemeler.added} malzeme\n`;

        if (result.araclar.duplicate > 0) message += `\n⚠️ ${result.araclar.duplicate} araç atlandı (plaka çakışması)`;
        if (result.firmalar.duplicate > 0) message += `\n⚠️ ${result.firmalar.duplicate} firma atlandı (zaten mevcut)`;
        if (result.eslestirmeler.duplicate > 0) message += `\n⚠️ ${result.eslestirmeler.duplicate} eşleştirme atlandı (zaten mevcut)`;
        if (result.malzemeler.duplicate > 0) message += `\n⚠️ ${result.malzemeler.duplicate} malzeme atlandı (zaten mevcut)`;

        alert(message);
        loadVehicles();
      } else {
        alert('❌ Geçersiz yedek dosyası veya bozuk JSON!');
      }

      document.body.removeChild(input);
    };

    reader.onerror = () => {
      alert('❌ Dosya okunamadı!');
      document.body.removeChild(input);
    };

    reader.readAsText(file);
  }, { once: true });

  input.click();
}

        // Takip Formu Göster
        function showTakipFormu(vehicle) {
            const formContainer = document.getElementById('takipFormu');
            
            formContainer.innerHTML = `
                <div style="width: 100%; font-family: Arial, sans-serif; font-size: 11pt; line-height: 1.2; background: white; box-sizing: border-box;" class="bg-white">
                    <!-- Başlık -->
                    <div style="text-align: center; margin-bottom: 6mm;">
                        <h1 style="font-size: 18pt; font-weight: bold; margin: 0 0 2mm 0; color: #2c3e50;">SEVKİYAT YÜKLEMESİ TAKİP FORMU</h1>
                    </div>

                    <!-- Şoför Bilgileri - YENİ DÜZEN -->
<div style="border: 2px solid #d9534f; padding: 4mm; background: #fffacd; margin-bottom: 4mm;" class="highlight-section">

  <div style="font-size: 14pt; font-weight: bold; margin-bottom: 6mm; color: #d9534f; text-decoration: underline; text-align:center;" class="highlight-title">
    ŞOFÖR BİLGİLERİ:
  </div>

  <!-- ✅ Grid'i komple ortalayan wrapper -->
  <div style="max-width: 1100px; margin: 0 auto;">

    <!-- ✅ 2 Kolon: sabit genişlik + ortalama -->
    <div style="display: grid; grid-template-columns: 220px 360px; gap: 10mm; justify-content: center; align-items: start;">

      <!-- Sol Taraf - Şoför Bilgileri -->
      <div>
        <div style="margin-bottom: 6mm;">
          <strong style="font-size: 11pt; display: block; margin-bottom: 1mm;">ŞOFÖR ADI SOYADI:</strong>
          <span style="font-weight: bold; font-size: 13pt; color: #2c3e50;" class="highlight-field" id="soforBilgi">
            ${vehicle.soforAdi || ''} ${vehicle.soforSoyadi || ''}
          </span>
        </div>

        <div style="margin-bottom: 6mm;">
          <strong style="font-size: 11pt; display: block; margin-bottom: 1mm;">T.C. KİMLİK NO:</strong>
          <span style="font-weight: bold; font-size: 13pt; color: #2c3e50;" class="highlight-field" id="tcBilgi">
            ${vehicle.tcKimlik || ''}
          </span>
        </div>

        <div>
          <strong style="font-size: 11pt; display: block; margin-bottom: 1mm;">İLETİŞİM:</strong>
          <span style="font-weight: bold; font-size: 13pt; color: #2c3e50;" class="highlight-field" id="iletisimBilgi">
            ${vehicle.iletisim || ''}
          </span>
        </div>
        <div>
          <strong style="font-size:11pt; display:block; margin-bottom:1mm;">BASIM YERİ</strong>
          <select id="basimYeri" class="form-input" style="height:34px;">
            <option value="avdan">avdan</option>
            <option value="fabrika">fabrika</option>
          </select>
        </div>
      </div>
          
      <!-- Sağ Taraf - Yükleme Bilgileri -->
      <div>

        <!-- Yükleme Sırası / Tarih -->
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6mm; margin-bottom: 6mm;">
          <div>
  <strong style="font-size: 11pt; display: block; margin-bottom: 1mm;">
    YÜKLEME SIRASI
  </strong>

  <input
    type="text"
    class="form-input"
    id="yuklemeSirasi"
    readonly
    style="
      font-size: 12pt;
      font-weight: bold;
      height: 8mm;
      border: 2px solid #3498db;
      width: 100%;
      background-color: #f8fafc;
      cursor: not-allowed;
    "
  >

  <div style="
    font-size: 9pt;
    color: #6b7280;
    margin-top: 1mm;
    font-style: italic;
  ">
    🛈 Yazdır’a basıldığında otomatik atanır
  </div>
</div>

          <div>
            <strong style="font-size: 11pt; display: block; margin-bottom: 1mm;">TARİH</strong>
            <span style="font-weight: bold; font-size: 13pt; color: #d9534f; display: block; height: 8mm; line-height: 8mm;">
              ${trLocaleDateString()}
            </span>
          </div>
        </div>

        <!-- Çekici / Dorse -->
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6mm; margin-bottom: 6mm;">
          <div>
            <strong style="font-size: 11pt; display: block; margin-bottom: 1mm;">ÇEKİCİ PLAKA</strong>
            <span style="font-weight: bold; font-size: 14pt; color:  #2c3e50; display: block; height: 8mm; line-height: 8mm;"
                  class="highlight-field" id="cekiciPlakaBilgi">
              ${vehicle.cekiciPlaka || '-'}
            </span>
          </div>
          <div>
            <strong style="font-size: 11pt; display: block; margin-bottom: 1mm;">DORSE PLAKA</strong>
            <span style="font-weight: bold; font-size: 14pt;  color: #2c3e50; display: block; height: 8mm; line-height: 8mm; width:150px;"
                  class="highlight-field" id="dorsePlakaBilgi">
              ${vehicle.dorsePlaka || '-'}
            </span>
          </div>
        </div>

        <!-- Ek Alanlar -->
        <div style="display:grid; grid-template-columns: 1fr 1fr; gap: 6mm; margin-top: 2mm;">
          <div>
            <strong style="font-size:9pt; display:block; margin-bottom:1mm;">SEVK YERİ</strong>
            <textarea id="sevkYeri" class="form-input" style="min-height: 4em; resize: vertical; font-size: 11pt; padding: 3mm; border: 1px solid #ccc; font-family: Arial, sans-serif; white-space: pre-wrap; word-wrap: break-word;"></textarea>
          </div>

          <div>
            <strong style="font-size:11pt; display:block; margin-bottom:1mm;">TONAJ</strong>
            <input type="text" id="tonaj" class="form-input">
          </div>

          <div>
            <strong style="font-size:11pt; display:block; margin-bottom:1mm;">AMBALAJ BİLGİSİ</strong>
            <input type="text" id="ambalajBilgisi" class="form-input">
          </div>

          <div>
            <strong style="font-size:11pt; display:block; margin-bottom:1mm;">SEPERATÖR BİLGİSİ</strong>
            <input type="text" id="seperatorBilgisi" class="form-input">
          </div>
        </div>

      </div> <!-- Sağ Taraf -->

    </div> <!-- 2 kolon grid -->
  </div>   <!-- max-width wrapper -->
</div>

setupEslestirmeUXInsideForm();

<!-- Ana Form Tablosu -->



                    <!-- Ana Form Tablosu -->
                    <table style="width: 100%; border-collapse: collapse; margin-bottom: 4mm; font-size: 11pt;">
                        <tr>
                            <td style="border: 1px solid #000; padding: 4mm; width: 35%;"><strong style="font-size: 11pt;">FİRMA /MÜŞTERİ KODU</strong></td>
                            <td style="border: 1px solid #000; padding: 0;">
                                <select class="firma-select" id="firmaSelect" style="font-size: 11pt;">
                                    <option value="">Seçiniz veya elle yazın</option>
                                    ${firmaListesi.map(firma => `<option value="${firma}">${firma}</option>`).join('')}
                                </select>
                                <input type="text" class="form-input" style="border: none; width: 100%; padding: 3mm; font-size: 12pt; font-weight: bold; margin-top: 2mm;" id="firmaKodu" placeholder="Veya firma/müşteri kodu giriniz">
                            </td>
                        </tr>
                        <tr>
                            <td style="border: 1px solid #000; padding: 3mm;"><strong style="font-size: 11pt;">MALZEME</strong></td>
                            <td style="border: 1px solid #000; padding: 0;">
                                <select class="malzeme-select" id="malzemeSelect" style="font-size: 11pt;">
                                    <option value="">Seçiniz veya elle yazın</option>
                                    ${malzemeListesi.map(malzeme => `<option value="${malzeme}">${malzeme}</option>`).join('')}
                                </select>
                                <input type="text" class="form-input" style="border: none; width: 100%; padding: 3mm; font-size: 12pt; font-weight: bold; margin-top: 2mm;" id="malzeme" placeholder="Veya malzeme bilgisi giriniz">
                            </td>
                        </tr>
                        <tr>
  <!-- SOL: başlık -->
  <td style="border: 1px solid #000; padding: 3mm; width: 35%; vertical-align: middle;">
    <strong style="font-size: 11pt;">AMBALAJ CİNSİ</strong>
  </td>

  <!-- SAĞ: seçenekler -->
  <td class="ambalaj-section" style="border: 1px solid #000; padding: 3mm; width: 65%; box-sizing:border-box;">
    
    <!-- Başlıklar (✅ checkbox kaldırıldı) -->
    <div style="display:grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 4mm; font-weight:bold; font-size:11pt; width:100%; box-sizing:border-box; margin-bottom:2mm;">
      <div>BBT</div>
      <div>BOŞ BBT</div>
      <div>ÇUVAL</div>
      <div>BOŞ ÇUVAL</div>
      <div>PALET</div>
      <div>TORBA</div>
    </div>

    <!-- Miktar -->
    <div style="display:grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 4mm; width:100%; box-sizing:border-box;">
      <input type="text" id="bbt" class="form-input" placeholder="Miktar" style="width:100%; box-sizing:border-box;">
      <input type="text" id="bosBbt" class="form-input" placeholder="Miktar" style="width:100%; box-sizing:border-box;">
      <input type="text" id="cuval" class="form-input" placeholder="Miktar" style="width:100%; box-sizing:border-box;">
      <input type="text" id="bosCuval" class="form-input" placeholder="Miktar" style="width:100%; box-sizing:border-box;">
      <input type="text" id="palet" class="form-input" placeholder="Miktar" style="width:100%; box-sizing:border-box;">
      <input type="text" id="torba" class="form-input" placeholder="Miktar" style="width:100%; box-sizing:border-box;">
    </div>

  </td>
</tr>

                            <td style="border: 1px solid #000; padding: 3mm;"><strong style="font-size: 9pt;">YÜKLEME NOTU</strong></td>
                            <td style="border: 1px solid #000; padding: 0;">
                                <textarea class="form-input" style="border: none; width: 100%; padding: 3mm; height: 15mm; resize: none; font-size: 11pt; font-weight: bold;" id="yuklemeNotu" placeholder="Yükleme notu giriniz"></textarea>
                            </td>
                        </tr>
                    </table>

                    <!-- İmza Bölümü - 4 KUTU + İSİM -->
<div style="display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap: 3mm; margin-bottom: 2mm;">
  <div class="signature-box">
    <strong style="font-size: 11pt;">KANTAR</strong>
    <input id="imzaKantarAd" type="text" class="form-input" placeholder="İsim (seç / yaz)" list="kantarPersonelList" autocomplete="off" spellcheck="false">
    <datalist id="kantarPersonelList"></datalist>
    <div style="margin-top:0px; height:22mm; border:1px dashed rgba(0,0,0,.25); display:flex; align-items:flex-start;
padding-top:0mm; justify-content:center; overflow:hidden; background:#fff;">
      <img id="imzaKantarImg" alt="Kantar İmzası" style="max-width:100%; max-height:100%; display:none;">
      <div id="imzaKantarPlaceholder" style="font-size:10pt; opacity:.65;">İmza otomatik gelecek</div>
    </div>
  </div>

  <div class="signature-box">
    <strong style="font-size: 11pt;">SEVKİYAT SAHA</strong>
    <input id="imzaSahaAd" type="text" class="form-input" placeholder="İsim / İmza" list="sahaPersonelList" autocomplete="off" spellcheck="false">
    <datalist id="sahaPersonelList"></datalist>
    <div style="margin-top:0px; height:22mm; border:1px dashed rgba(0,0,0,.25); display:flex; align-items:flex-start; padding-top:0mm; justify-content:center; overflow:hidden; background:#fff;">
      <img id="imzaSahaImg" alt="Saha İmzası" style="max-width:100%; max-height:100%; display:none;">
      <div id="imzaSahaPlaceholder" style="font-size:10pt; opacity:.65;">İmza otomatik gelecek</div>
    </div>
  </div>

  <div class="signature-box">
    <strong style="font-size: 11pt;">YÜKLEYEN GÖREVLİ</strong>
    <input id="imzaYukleyenAd" type="text" class="form-input" placeholder="İsim / İmza">
  </div>

  <div class="signature-box">
    <strong style="font-size: 11pt;">KALİTE KONTROL</strong>
    <input id="imzaKaliteAd" type="text" class="form-input" placeholder="İsim / İmza">
  </div>
</div>

            `;

            // Malzeme seçimi event listener
            const malzemeSelect = document.getElementById('malzemeSelect');
            const malzemeInput = document.getElementById('malzeme');
            
            if (malzemeSelect && malzemeInput) {
                malzemeSelect.addEventListener('change', function() {
                    if (this.value) {
                        malzemeInput.value = this.value;
                    }
                });
                
                malzemeInput.addEventListener('input', function() {
                    if (this.value) {
                        malzemeSelect.value = '';
                    }
                });
            }

            // Firma seçimi event listener - ✅ EŞLEŞTİRMEYE GÖRE OTOMATİK DOLDURMA (ÇOKLU MALZEME + AMBALAJ + NOT)
const firmaSelect = document.getElementById('firmaSelect');
const firmaInput  = document.getElementById('firmaKodu');

const malzemeInput2  = document.getElementById('malzeme');
const malzemeSelect2 = document.getElementById('malzemeSelect');
const ambalajInput   = document.getElementById('ambalajBilgisi');
const notTextarea    = document.getElementById('yuklemeNotu');

if (ambalajInput) {
  const normalizeNow = () => { ambalajInput.value = normalizeAmbalajBilgisi(ambalajInput.value); };
  ambalajInput.addEventListener('change', normalizeNow);
  ambalajInput.addEventListener('blur', normalizeNow);
}

const applyMatch = (es) => {
  if (!es) return;
  if (malzemeInput2)  malzemeInput2.value = es.malzeme || '';
  if (malzemeSelect2) malzemeSelect2.value = es.malzeme || '';
  if (ambalajInput)   ambalajInput.value = normalizeAmbalajBilgisi(es.ambalajBilgisi || '');
  if (notTextarea)    notTextarea.value = es.yuklemeNotu || '';
};

const handleFirma = (firma) => {
  if (!firma) return;

  const matches = (eslestirmeStorage.getByFirma ? eslestirmeStorage.getByFirma(firma) : []) || [];

  if (matches.length === 1) {
    applyMatch(matches[0]);
    return;
  }

  if (matches.length > 1) {
    const listText = matches.map((m, i) => `${i + 1}) ${m.malzeme}`).join('\n');
   
  }
};

if (firmaSelect && firmaInput) {
  firmaSelect.addEventListener('change', function () {
    if (!this.value) return;
    firmaInput.value = this.value;
    handleFirma(this.value);
  });

  firmaInput.addEventListener('input', function () {
    if (!this.value) return;
    firmaSelect.value = '';
    handleFirma(this.value.trim());
  });

  // ✅ Sevk Yeri: Yazı uzunluğuna göre otomatik boyutlandır
  try {
    const sevkEl = document.getElementById('sevkYeri');
    if (sevkEl) {
      sevkEl.addEventListener('input', () => {
        try {
          if (window.fitToBoxInput) {
            window.fitToBoxInput(sevkEl, 9, 16);
          }
        } catch(e) {}
      });
      // açılışta da boyut ayarla
      if (window.fitToBoxInput) {
        try { window.fitToBoxInput(sevkEl, 9, 16); } catch(e) {}
      }
    }
  } catch(e) {}
}


            // Modal'ı göster
            document.getElementById('takipFormuModal').classList.remove('hidden');
        }

        // Takip Formunu Kapat
        function kapatForm() {
            document.getElementById('takipFormuModal').classList.add('hidden');
        }

// =========================
// Malzeme: parçalama + tek satır basım + kutuya göre font (78mm alan)
// =========================
const MALZEME_PRINT_BOX = { wMm: 78, hMm: 9.2, maxPt: 11, minPt: 5.5 };

const BBT_BLOCK_START_RE = /(?<![\d.])(?<=\s|^)(\d+\s+BBT\b)/gi;
const HP_MALZEME_TAIL_RE = /\s+(?=HP\d+\s+MALZEMESİ)/i;

function normalizeMalzemeSpacing(one) {
  let s = String(one ?? '').trim();
  if (!s) return '';
  // 0.6016 BBT → 0.60 16 BBT (ondalık + yapışık adet)
  s = s.replace(/(\d\.)(\d{2})(\d{1,3})(\s+BBT\b)/gi, (_, a, b, c, d) => a + b + ' ' + c + d);
  // (SERT)8 BBT → (SERT) 8 BBT
  s = s.replace(/(\))(\d{1,3}\s+BBT\b)/gi, (_, a, b) => a + ' ' + b);
  // YUMUŞAK5 BBT → YUMUŞAK 5 BBT
  s = s.replace(/([A-ZÇĞİÖŞÜ]{4,})(\d+\s+BBT\b)/gi, (_, a, b) => a + ' ' + b);
  // 0.60HP100 MALZEMESİ → 0.60 HP100 MALZEMESİ
  s = s.replace(/([\d.)])(HP\d+\s+MALZEMESİ)/gi, (_, a, b) => a + ' ' + b);
  s = s.replace(/\s*\/\s*(HP\d+)/gi, (_, hp) => ' / ' + hp);
  // /8 BBT ve " / 5 BBT" → tutarlı " / N BBT"
  s = s.replace(/\s*\/\s*(\d+\s+BBT\b)/gi, (_, bbt) => ' / ' + bbt);
  s = s.replace(/(\s\/\s)+/g, ' / ');
  return s.replace(/\s+/g, ' ').trim();
}

/** Parça içinde yapışık HP100… kuyruğunu ayır */
function expandMalzemeItems(items) {
  const out = [];
  items.forEach((it) => {
    const s = String(it ?? '').trim();
    if (!s) return;
    const glued = s.match(
      /^(.+?\d(?:\.\d+)?(?:-\d+(?:\.\d+)?)?(?:\([^)]*\))?)(HP\d+\s+MALZEMESİ[\s\S]*)$/i
    );
    if (glued) {
      out.push(glued[1].trim(), glued[2].trim());
      return;
    }
    const spaced = s.match(/^(.+?)\s+(HP\d+\s+MALZEMESİ[\s\S]*)$/i);
    if (spaced && /\d\s+BBT/i.test(spaced[1])) {
      out.push(spaced[1].trim(), spaced[2].trim());
      return;
    }
    out.push(s);
  });
  return out;
}

function splitMalzemeLine(line) {
  let one = normalizeMalzemeSpacing(String(line ?? ''));
  if (!one) return [];

  if (/\s\/\s/.test(one)) {
    const slashParts = one.split(/\s\/\s/).map((s) => s.trim()).filter(Boolean);
    if (slashParts.length >= 2 && slashParts.every((p) => /\d+\s+BBT\b/i.test(p))) {
      return slashParts;
    }
  }

  const starts = [];
  let m;
  BBT_BLOCK_START_RE.lastIndex = 0;
  while ((m = BBT_BLOCK_START_RE.exec(one)) !== null) {
    starts.push(m.index);
  }

  if (!starts.length) return [one];

  const segments = [];
  for (let i = 0; i < starts.length; i++) {
    const chunk = one.slice(starts[i], starts[i + 1] ?? one.length).trim();
    chunk.split(HP_MALZEME_TAIL_RE)
      .map((s) => s.trim())
      .filter(Boolean)
      .forEach((p) => segments.push(p));
  }

  if (starts[0] > 0) {
    const prefix = one.slice(0, starts[0]).trim();
    if (prefix) segments.unshift(prefix);
  }

  return segments;
}

function splitMalzemeItems(raw) {
  let t = String(raw ?? '').trim();
  if (!t) return [];
  t = t.replace(/''\s*/g, '\n').replace(/[ \t]{2,}/g, ' ');
  const lines = t.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const inputs = lines.length ? lines : [t];
  const out = [];
  inputs.forEach((line) => {
    splitMalzemeLine(line).forEach((p) => out.push(p));
  });
  return out;
}

/** Uzun listelerde 2 satır (malzeme başına " / " ile) */
function layoutMalzemeLines(items) {
  const parts = expandMalzemeItems(items);
  if (!parts.length) return { lines: [''], twoLine: false };
  if (parts.length === 1) return { lines: [parts[0]], twoLine: false };

  const joined = parts.join(' / ');
  const tryTwo = parts.length >= 3 || joined.length >= 68;
  if (!tryTwo) return { lines: [joined], twoLine: false };

  const hpIdx = parts.findIndex((it) => /^HP\d+\s+MALZEMESİ/i.test(String(it).trim()));
  if (hpIdx > 0) {
    return {
      lines: [
        parts.slice(0, hpIdx).join(' / ') + ' /',
        parts.slice(hpIdx).join(' / '),
      ],
      twoLine: true,
    };
  }

  // 3+ BBT parça: üstte hepsi son hariç, altta "/ son parça" (büyük puntoda okunur)
  if (parts.length >= 3) {
    const line1 = parts.slice(0, -1).join(' / ') + ' /';
    let line2 = '/ ' + parts[parts.length - 1];
    if (line1.length > 76 && parts.length >= 4) {
      const alt1 = parts.slice(0, -2).join(' / ') + ' /';
      const alt2 = '/ ' + parts.slice(-2).join(' / ');
      if (Math.max(alt1.length, alt2.length) < Math.max(line1.length, line2.length)) {
        return { lines: [alt1, alt2], twoLine: true };
      }
    }
    return { lines: [line1, line2], twoLine: true };
  }

  // 2 parça ama çok uzun: dengeli böl
  let best = null;
  for (let i = 1; i < parts.length; i++) {
    const line1 = parts.slice(0, i).join(' / ') + ' /';
    const line2 = '/ ' + parts.slice(i).join(' / ');
    const score = Math.max(line1.length, line2.length);
    if (!best || score < best.score) best = { lines: [line1, line2], score };
  }
  return { lines: best.lines, twoLine: true };
}

/** Yazdırma / önizleme metni (2 satırda \n ile) */
function formatMalzemeForPrint(raw) {
  const items = splitMalzemeItems(raw);
  if (!items.length) return '';
  const { lines, twoLine } = layoutMalzemeLines(items);
  return twoLine ? lines.join('\n') : lines[0];
}

/** 78mm kutu: en uzun satıra göre font (2 satırda satır başına daha büyük) */
function estimateMalzemeFontPt(textOrLines, wMm = MALZEME_PRINT_BOX.wMm) {
  const lines = Array.isArray(textOrLines)
    ? textOrLines
    : [String(textOrLines || '')];
  const n = Math.max(0, ...lines.map((l) => String(l).length));
  const scale = wMm / MALZEME_PRINT_BOX.wMm;
  const cap = (x) => Math.round(x * scale);
  const two = lines.length >= 2;

  if (two) {
    if (n <= cap(44)) return 10.5;
    if (n <= cap(54)) return 10;
    if (n <= cap(64)) return 9.5;
    if (n <= cap(74)) return 9;
    return 8.5;
  }

  if (n <= cap(38)) return MALZEME_PRINT_BOX.maxPt;
  if (n <= cap(48)) return 10.5;
  if (n <= cap(58)) return 10;
  if (n <= cap(70)) return 9.5;
  if (n <= cap(82)) return 9;
  if (n <= cap(95)) return 8.5;
  if (n <= cap(108)) return 8;
  if (n <= cap(122)) return 7.5;
  return MALZEME_PRINT_BOX.minPt;
}

function buildMalzemePrintHtml(raw, escapeHtml, boxWMm = MALZEME_PRINT_BOX.wMm) {
  const items = splitMalzemeItems(raw);
  if (!items.length) return '';

  const { lines, twoLine } = layoutMalzemeLines(items);
  const pt = estimateMalzemeFontPt(twoLine ? lines : lines[0], boxWMm);
  const esc = escapeHtml || ((s) => String(s ?? ''));

  if (!twoLine) {
    return `<div class="malz-inline" style="font-size:${pt}pt">${esc(lines[0])}</div>`;
  }

  const rows = lines.map((ln) => `<div class="malz-row">${esc(ln)}</div>`).join('');
  return `<div class="malz-inline malz-inline--2" style="font-size:${pt}pt">${rows}</div>`;
}

function fitMalzemeInlineEl(el, w) {
  try {
    if (!el || !w) return;
    const minPx = MALZEME_PRINT_BOX.minPt * (96 / 72);
    const box = w.document.getElementById('printMalzeme');
    const rows = el.querySelectorAll('.malz-row');

    const shrinkUntilFit = () => {
      let size = parseFloat(w.getComputedStyle(el).fontSize) || (MALZEME_PRINT_BOX.maxPt * (96 / 72));
      let guard = 0;
      const fits = () => {
        const widthOk = rows.length
          ? Array.from(rows).every((r) => r.scrollWidth <= r.clientWidth + 1)
          : el.scrollWidth <= el.clientWidth + 1;
        const heightOk = !box || box.scrollHeight <= box.clientHeight + 1;
        return widthOk && heightOk;
      };
      while (guard < 55 && !fits() && size > minPx) {
        size -= 0.5;
        el.style.fontSize = size + 'px';
        guard++;
      }
    };

    shrinkUntilFit();
  } catch (e) {}
}

function fitMalzemeInput(el) {
  try {
    if (!el) return;
    const formatted = formatMalzemeForPrint(el.value);
    if (formatted) el.value = formatted;
    const lines = String(formatted || el.value || '').split(/\r?\n/);
    const pt = estimateMalzemeFontPt(lines.length >= 2 ? lines : (lines[0] || ''));
    el.style.fontWeight = '800';
    el.style.whiteSpace = lines.length >= 2 ? 'pre-line' : 'nowrap';
    el.style.overflow = 'hidden';
    el.style.textOverflow = 'ellipsis';
    el.style.lineHeight = lines.length >= 2 ? '1.15' : '';
    let px = Math.round(pt * 1.333);
    const minPx = Math.round(MALZEME_PRINT_BOX.minPt * 1.333);
    const maxPx = Math.round(MALZEME_PRINT_BOX.maxPt * 1.333);
    for (let s = px; s >= minPx; s--) {
      el.style.fontSize = s + 'px';
      const wOk = el.scrollWidth <= el.clientWidth + 1;
      const hOk = lines.length < 2 || el.scrollHeight <= el.clientHeight + 2;
      if (wOk && hOk) break;
    }
  } catch (e) {}
}

window.formatMalzemeForPrint = formatMalzemeForPrint;
window.splitMalzemeItems = splitMalzemeItems;
window.fitMalzemeInput = fitMalzemeInput;
window.MALZEME_PRINT_BOX = MALZEME_PRINT_BOX;

        // Takip Formunu Yazdır
    async function yazdirForm(opts = {}) {
    if (window.SignatureRegistry && typeof window.SignatureRegistry.loadSignatures === 'function') {
      try { await window.SignatureRegistry.loadSignatures(); } catch (e) { /* ignore */ }
    }

    // ✅ localStorage'dan seçili sayfa boyutunu oku
    const pageSize = localStorage.getItem('selectedPageSize') || 'A5';
    
    // ✅ Yazdırma şablonu — mutlaka data URL (about:blank penceresinde güvenilir)
    const bgDataUrl = await ensurePrintBgDataUrl();
    if (!bgDataUrl) {
      alert('Takip formu arka plan görseli yüklenemedi. Ayarlar → Yazdırma bölümünden şablon JPG yükleyin veya sunucuyu yeniden başlatın.');
      return null;
    }
    const bgUrl = bgDataUrl;

    const firmaKodu = document.getElementById('firmaKodu')?.value || '';
    const malzeme = document.getElementById('malzeme')?.value || '';
    // ✅ Yükleme sırası: kullanıcı yazdıysa onu baz al, boşsa otomatik
    const yuklemeSirasiInput = document.getElementById('yuklemeSirasi');
    const manualStr = (yuklemeSirasiInput?.value || '').trim();

    let yuklemeSirasiNum = null;
    if (manualStr !== '' && /^\d+$/.test(manualStr)) {
        const m = parseInt(manualStr, 10);
        if (Number.isFinite(m) && m >= 1) {
            yuklemeSirasiNum = m;
        }
    }

    // Manuel geçersiz/boş ise otomatik artır
    if (yuklemeSirasiNum === null) {
        yuklemeSirasiNum = getNextYuklemeSirasi();
        if (yuklemeSirasiInput) yuklemeSirasiInput.value = String(yuklemeSirasiNum);
    }

    const yuklemeSirasi = String(yuklemeSirasiNum);
const yuklemeNotu = resolveYuklemeNotuForPrint(document.getElementById('yuklemeNotu')?.value || '');

    // ✅ Print güvenliği: HTML escape + satır normalize
    const escapeHtml = (s) => String(s ?? '')
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

    const normalizeToLines = (s) => {
      let t = String(s ?? '').trim();
      if (!t) return '';
      // Kullanıcı/Excel bazen '' ile ayırıyor
      t = t.replace(/''\s*/g, "\n");
      // Çoklu boşlukları toparla
      t = t.replace(/[ \t]{2,}/g, ' ');
      return t;
    };

    const notKind = isIhracatFormContext(yuklemeNotu)
      ? 'ihracat'
      : (isPiyasaFormContext(yuklemeNotu) ? 'piyasa' : resolveYuklemeNotuKind(yuklemeNotu));
    const buildYuklemeNotuPrintHtml = (raw, kind) => {
      const t = normalizeToLines(raw);
      const noteKind = kind === 'ihracat' || kind === 'piyasa'
        ? kind
        : (isIhracatFormContext(t) ? 'ihracat' : resolveYuklemeNotuKind(t));
      if (!t) return `<div class="note-inner" data-not-kind="${noteKind}"></div>`;
      const lines = sanitizeYuklemeNotuLines(t.split(/\r?\n/).map((s) => s.trim()).filter(Boolean));
      const esc = (s) => escapeHtml(s);
      const rowHtml = (line) => `<div class="note-row">${esc(line)}</div>`;

      let irsLine = '';
      const descParts = [];
      for (const line of lines) {
        if (/^İrsaliye\s*No\s*:/i.test(line) || /^IRSALIYE\s*NO\s*:/i.test(line)) {
          if (!irsLine) irsLine = line;
        } else {
          descParts.push(line);
        }
      }
      if (!irsLine && noteKind === 'ihracat') {
        const irs = resolveIrsaliyeForPrint();
        irsLine = irs ? `İrsaliye No: ${irs}` : 'İrsaliye No:';
      }

      const descJoined = descParts.join(' ').replace(/\s+/g, ' ').trim();
      const descInput =
        noteKind === 'piyasa'
          ? [normalizePiyasaDescText(descJoined)].filter(Boolean)
          : [descJoined].filter(Boolean);
      const descLines = buildDescLinesForPrint(descInput, noteKind);

      const parts = [];
      if (irsLine) parts.push(`<div class="note-head">${esc(irsLine)}</div>`);
      descLines.forEach((ln) => {
        const bos = isAracBosNoteLine(ln);
        parts.push(
          bos
            ? `<div class="note-row note-row--bos">${esc(ln)}</div>`
            : rowHtml(ln)
        );
      });

      const layoutAttr = noteKind === 'ihracat' ? ' data-not-layout="ihracat-3line-v2"' : '';
      return `<div class="note-inner" data-not-kind="${noteKind}"${layoutAttr}>${parts.join('')}</div>`;
    };

    const formatSevkYeriPrint = (value) => {
      const raw = String(value ?? '').trim();
      if (!raw) return '';
      const parts = raw.split(';').map(s => s.trim()).filter(Boolean);
      if (parts.length >= 3) {
        const first = `${parts[0]};${parts[1]};`;
        const second = parts.slice(2).join('; ');
        return `${escapeHtml(first)}<br>${escapeHtml(second)}`;
      }
      if (parts.length === 2) {
        return `${escapeHtml(parts[0] + ';')}<br>${escapeHtml(parts[1])}`;
      }
      return escapeHtml(raw).replace(/\r?\n/g, '<br>');
    };

    const formatAmbalajBilgisiPrint = (value) => {
      const raw = String(value ?? '').trim();
      if (!raw) return '';

      let t = raw
        .replace(/LINERLI(BASKISIZ)/gi, 'LINERLI $1')
        .replace(/LİNERLİ(BASKISIZ)/gi, 'LİNERLİ $1')
        .replace(/BASKISIZ(LINERLI)/gi, 'BASKISIZ $1')
        .replace(/BASKISIZ(LİNERLİ)/gi, 'BASKISIZ $1')
        .replace(/(KG)(LINERLI)/gi, '$1 $2')
        .replace(/(KG)(LİNERLİ)/gi, '$1 $2')
        .replace(/\bBIG\s*BAG\b/gi, 'BİGBAG')
        .replace(/\bBIGBAG\b/gi, 'BİGBAG')
        .replace(/\s+/g, ' ')
        .trim();

      const netKgMatch = t.match(/NET\s+[\d.,]+\s*KG/i);
      if (netKgMatch) {
        const netKg = netKgMatch[0].trim();
        const tail = t.slice(netKgMatch.index + netKgMatch[0].length).trim();
        const hasBaskisiz = /BASKISIZ/i.test(tail);
        const hasLiner = /L[Iİ]NERL[Iİ]/i.test(tail);
        const hasBigbag = /B[Iİ]G\s*BAG|B[Iİ]GBAG/i.test(tail);

        if (hasBaskisiz || hasLiner || hasBigbag) {
          const line1 = hasBaskisiz ? `${netKg} BASKISIZ` : netKg;
          let line2 = '';
          if (hasLiner && hasBigbag) line2 = 'LİNERLİ BİGBAG';
          else if (hasLiner) line2 = 'LİNERLİ';
          else if (hasBigbag) line2 = 'BİGBAG';
          else {
            const rest = tail.replace(/BASKISIZ/i, '').trim();
            if (rest) line2 = rest.replace(/L[Iİ]NERL[Iİ]/i, 'LİNERLİ').replace(/B[Iİ]G\s*BAG|B[Iİ]GBAG/gi, 'BİGBAG');
          }
          if (line2) {
            return escapeHtml(line1) + '<br>' + escapeHtml(line2);
          }
          return escapeHtml(line1);
        }
      }

      const netLinerSplit = t.match(/^(NET\s+[\d.,]+\s*KG\s+L[Iİ]NERL[Iİ])\s+(BASKISIZ.+)$/i);
      if (netLinerSplit) {
        const line1 = `${netLinerSplit[1].replace(/\s+L[Iİ]NERL[Iİ]$/i, '').trim()} BASKISIZ`;
        const line2 = 'LİNERLİ BİGBAG';
        return escapeHtml(line1) + '<br>' + escapeHtml(line2);
      }

      if (/NET/i.test(t) && /LINERL/i.test(t) && /BASKISIZ/i.test(t)) {
        const head = t.match(/^(NET\s+[\d.,]+\s*KG\s+L[Iİ]NERL[Iİ])/i);
        if (head) {
          const tail = t.slice(head[0].length).trim();
          if (tail) {
            return escapeHtml(head[0].trim()) + '<br>' + escapeHtml(tail);
          }
        }
      }

      // Özel: NET ve LINERLI varsa ayır (tek LINERLI parçası)
      if (t.toUpperCase().includes('NET') && /LINERL/i.test(t)) {
        const netIndex = t.toUpperCase().indexOf('NET');
        const linerMatch = t.slice(netIndex).match(/LINERL[Iİ]/i);
        if (linerMatch && typeof linerMatch.index === 'number') {
          const rel = netIndex + linerMatch.index;
          const netPart = t.slice(netIndex, rel + linerMatch[0].length).trim();
          const linerPart = t.slice(rel + linerMatch[0].length).trim();
          if (netPart && linerPart) {
            return escapeHtml(netPart) + '<br>' + escapeHtml(linerPart);
          }
        }
      }

      const parts = t.split('/').map(s => s.trim()).filter(Boolean);
      if (parts.length >= 2) {
        return parts.map(p => escapeHtml(p)).join('<br>');
      }
      return escapeHtml(t).replace(/\r?\n/g, '<br>');
    };

    const formatSeperatorBilgisiPrint = (value) => {
      const raw = String(value ?? '').trim();
      if (!raw) return '';
      const esc = (s) => escapeHtml(s);
      const odemeOrg = raw.match(/^ÖDEME\s*TÜRÜ\s*:\s*(.+?)\s+ORG\s*:\s*(.+)$/i);
      if (odemeOrg) {
        const odeme = odemeOrg[1].trim();
        const org = odemeOrg[2].trim();
        return `${esc('ÖDEME TÜRÜ:')}<br>${esc(`${odeme} ORG:${org}`)}`;
      }
      const odemeOnly = raw.match(/^ÖDEME\s*TÜRÜ\s*:\s*(.+)$/i);
      if (odemeOnly && !/ORG\s*:/i.test(raw)) {
        return `${esc('ÖDEME TÜRÜ:')}<br>${esc(odemeOnly[1].trim())}`;
      }
      if (/ORG\s*:/i.test(raw)) {
        const idx = raw.search(/\s+ORG\s*:/i);
        if (idx > 0) {
          const head = raw.slice(0, idx).trim();
          const tail = raw.slice(idx).trim().replace(/^ORG\s*:\s*/i, '');
          if (/^ÖDEME\s*TÜRÜ\s*:/i.test(head)) {
            const val = head.replace(/^ÖDEME\s*TÜRÜ\s*:\s*/i, '').trim();
            const line2 = val ? `${val} ORG:${tail}` : `ORG:${tail}`;
            return `${esc('ÖDEME TÜRÜ:')}<br>${esc(line2)}`;
          }
          return `${esc(head)}<br>${esc(`ORG:${tail}`)}`;
        }
      }
      return esc(raw).replace(/\r?\n/g, '<br>');
    };

    const malzemeLayout = layoutMalzemeLines(splitMalzemeItems(malzeme));
    const malzemeGridHtml = buildMalzemePrintHtml(malzeme, escapeHtml, MALZEME_PRINT_BOX.wMm);
    const yuklemeNotuPrint = buildYuklemeNotuPrintHtml(yuklemeNotu, notKind);

    // ✅ Takip formu alanları artık span *veya* input olabilir.
    // - input varsa .value
    // - span/div varsa .textContent
    function readFieldText(id) {
      const el = document.getElementById(id);
      if (!el) return '';
      if ('value' in el) return String(el.value || '');
      return String(el.textContent || '');
    }

    const soforBilgi       = readFieldText('soforBilgi');
    const iletisimBilgi    = readFieldText('iletisimBilgi');
    const tcBilgi          = readFieldText('tcBilgi');
    const cekiciPlakaBilgi = readFieldText('cekiciPlakaBilgi');
    const dorsePlakaBilgi  = readFieldText('dorsePlakaBilgi');
const sevkYeri = document.getElementById('sevkYeri')?.value || '';
const sevkYeriPrint = formatSevkYeriPrint(sevkYeri);
const tonaj = document.getElementById('tonaj')?.value || '';
const ambalajBilgisi = normalizeAmbalajBilgisi(document.getElementById('ambalajBilgisi')?.value || '');
const ambalajBilgisiPrint = formatAmbalajBilgisiPrint(ambalajBilgisi);
const seperatorBilgisi = document.getElementById('seperatorBilgisi')?.value || '';
const seperatorBilgisiPrint = formatSeperatorBilgisiPrint(seperatorBilgisi);
const imzaKantarAd   = document.getElementById('imzaKantarAd')?.value || '';
const imzaKantarSrc  = toPrintSignatureSrc(resolveKantarSignatureSrc(imzaKantarAd));
const imzaKantarImgHtml = imzaKantarSrc ? `<img src="${imzaKantarSrc}" class="imza-img" alt="İmza">` : ``;

const imzaSahaAd     = document.getElementById('imzaSahaAd')?.value || '';
const imzaSahaSrc    = toPrintSignatureSrc(resolveSahaSignatureSrc(imzaSahaAd));
const imzaSahaImgHtml = imzaSahaSrc ? `<img src="${imzaSahaSrc}" class="imza-img" alt="İmza">` : ``;
const imzaYukleyenAd = document.getElementById('imzaYukleyenAd')?.value || '';
const imzaKaliteAd   = document.getElementById('imzaKaliteAd')?.value || '';    // Ambalajlar (Yeni sistem: BBT, BOŞ BBT, ÇUVAL, BOŞ ÇUVAL, PALET, TORBA)
const amb = {
  bbt: "",
  bosBbt: "",
  cuval: "",
  bosCuval: "",
  palet: "",
  torba: ""
};

// ✅ Checkbox kaldırıldı: miktar girildiyse yazdır
amb.bbt = (document.getElementById('bbt')?.value || '').trim();
amb.bosBbt = (document.getElementById('bosBbt')?.value || '').trim();
amb.cuval = (document.getElementById('cuval')?.value || '').trim();
amb.bosCuval = (document.getElementById('bosCuval')?.value || '').trim();
amb.palet = (document.getElementById('palet')?.value || '').trim();
amb.torba = (document.getElementById('torba')?.value || '').trim();

// Print’e basılacak net değerler
const torbaText = amb.torba;
const bosCuvalText = amb.bosCuval;
const bosBbtText = amb.bosBbt;

    // --- KONUM AYARLARI (mm) — koordinat referansı 1024×723; AA.jpg (1492×1054) aynı oran, kayıpsız ---
    const FORM_CONTENT_H = 148;
    const COORD_REF_W = 1024;
    const COORD_REF_H = 723;
    const ROW_NUDGE_PX = 38; // grid satırı bir tık yukarı (değerler bir alt satırda kalıyordu)
    function buildTakipFormPrintCoords() {
      const IMG_W = COORD_REF_W;
      const IMG_H = COORD_REF_H;
      const pageH = FORM_CONTENT_H;
      const xMm = (px) => (px / IMG_W) * 210;
      const yMm = (py) => (py / IMG_H) * pageH;
      const mmPx = (mm) => (mm / 210) * IMG_W;
      const ry = (py) => Math.max(0, py - ROW_NUDGE_PX);
      const mid = (y0, y1, shift) => yMm((ry(y0) + ry(y1)) / 2) - shift;
      const rh = (y0, y1) => Math.max(4, yMm(ry(y1)) - yMm(ry(y0)) - 1.2);
      const packMm = [75.3, 104.4, 131.5, 158.9, 183.8, 205.7];
      const packPx = [212].concat(packMm.map(mmPx));
      const imzaMm = [54.8, 105.4, 154.8, 205.7];
      const imzaPx = [20].concat(imzaMm.map(mmPx));

      const P = {
        yuklemeSirasi: { left: xMm(455), top: mid(172, 210, 1.3), w: xMm(535 - 455), align: 'center' },
        tarih:         { left: xMm(700), top: mid(172, 210, 1.3), w: xMm(990 - 700), align: 'center' },
        sofor:         { left: xMm(215), top: mid(210, 248, 1.3), w: xMm(539 - 215) },
        iletisim:      { left: xMm(738), top: mid(210, 248, 1.3), w: xMm(985 - 738), align: 'center' },
        tc:            { left: xMm(215), top: mid(248, 286, 1.3), w: xMm(539 - 215) },
        sevkYeri:      { left: xMm(702), top: mid(248, 286, 1.3), w: xMm(888 - 702), h: rh(248, 286), align: 'center' },
        cekici:        { left: xMm(215), top: mid(286, 325, 1.3), w: xMm(539 - 215) },
        dorse:         { left: xMm(539), top: mid(286, 325, 1.3), w: xMm(1000 - 539), align: 'center' },
        firma:         { left: xMm(215), top: mid(325, 362, 1.3), w: xMm(1000 - 215) },
        malzeme:       { left: xMm(215), top: mid(362, 399, 1.3), w: xMm(653 - 215), h: 6.2 },
        ambBilgi:      { left: xMm(798), top: mid(362, 399, 2.4), w: xMm(1000 - 798), h: rh(362, 399) },
        tonaj:         { left: xMm(215), top: mid(399, 445, 1.3), w: xMm(509 - 215) },
        seperator:     { left: xMm(798), top: mid(399, 445, 3.6), w: xMm(996 - 798), h: Math.max(3.8, rh(399, 445) - 0.8) },
        not:           { left: xMm(215), top: yMm(ry(530)), w: xMm(1000 - 215), h: rh(514, 578) },
      };

      ['bbt', 'bosBbt', 'cuval', 'bosCuval', 'palet', 'torba'].forEach(function (key, i) {
        P[key] = {
          left: xMm(packPx[i] + 3),
          top: mid(484, 548, 3.5),
          w: xMm(packPx[i + 1] - packPx[i] - 6),
        };
      });

      ['imzaKantar', 'imzaSaha', 'imzaYukleyen', 'imzaKalite'].forEach(function (key, i) {
        P[key] = {
          left: xMm(imzaPx[i] + 6),
          top: mid(588, 668, 0.5),
          w: xMm(imzaPx[i + 1] - imzaPx[i] - 12),
          h: rh(584, 662),
        };
      });

      P.imzaKantar = {
        left: xMm(imzaPx[0] + 4),
        top: mid(588, 668, 0.35),
        w: xMm(imzaPx[1] - imzaPx[0] - 10),
        h: rh(584, 662),
      };

      return P;
    }

    const P = buildTakipFormPrintCoords();
    const malzemeTopMm = P.malzeme.top - (malzemeLayout.twoLine ? 1.8 : 0);
    const malzemeBoxClass = malzemeLayout.twoLine
      ? 'field malzeme-print-box malzeme-print-box--2'
      : 'field malzeme-print-box';

    // ✅ Sayfa boyutuna göre CSS parametrelerini ayarla
    const FORM_PAGE_H = FORM_CONTENT_H;
    const formOuterTopGap = pageSize === 'A4' ? '5mm' : '0mm';
    const formInnerPadTop = pageSize === 'A4' ? '0mm' : '1.5mm';
    const pageParams = pageSize === 'A4' 
      ? { size: 'A4', width: '210mm', height: '297mm' }
      : { size: 'A5 landscape', width: '210mm', height: '148mm' };

    const printHTML = `
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Sevkiyat Formu</title>
<style>
      * { page-break-inside: avoid; break-inside: avoid; }

      @page {
        size: ${pageParams.size};
        margin: ${pageSize === 'A4' ? '0' : '0'};
      }

      #printViewport {
        width:${pageParams.width};
        height:${pageParams.height};
        overflow:hidden;
        box-sizing:border-box;
      }
      #printRoot {
        width:${pageParams.width};
        height:${pageParams.height};
        max-height:${pageParams.height};
        overflow:hidden;
        box-sizing:border-box;
        transform:none;
      }

      html, body {
        margin:0;
        padding:0;
        width:${pageParams.width};
        height:${pageParams.height};
        max-height:${pageParams.height};
        overflow:hidden;
        box-sizing:border-box;
        page-break-after: avoid;
        break-after: avoid-page;
      }
      body { font-family: Arial, sans-serif; }

      .page{
        position: relative;
        width: 210mm;
        height: ${FORM_PAGE_H}mm;
        max-height: ${FORM_PAGE_H}mm;
        margin: ${formOuterTopGap} auto 0;
        padding-top: ${formInnerPadTop};
        overflow: hidden;
        box-sizing: border-box;
        page-break-after: avoid !important;
        page-break-before: avoid !important;
        break-inside: avoid-page;
        break-after: avoid-page;
      }

      @media print {
        html, body {
          width: ${pageParams.width} !important;
          height: ${pageParams.height} !important;
          max-height: ${pageParams.height} !important;
          margin: 0 !important;
          padding: 0 !important;
          overflow: hidden !important;
        }
        #printViewport, #printRoot {
          position: relative !important;
          width: ${pageParams.width} !important;
          height: ${pageParams.height} !important;
          max-height: ${pageParams.height} !important;
          min-height: 0 !important;
          overflow: hidden !important;
          transform: none !important;
          page-break-after: avoid !important;
          break-after: avoid-page !important;
        }
        .page {
          transform: scale(0.968) !important;
          transform-origin: top center !important;
          margin-left: auto !important;
          margin-right: auto !important;
          margin-top: ${formOuterTopGap} !important;
          padding-top: ${formInnerPadTop} !important;
          page-break-after: avoid !important;
          break-after: avoid-page !important;
        }
      }

      * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }

  .bg{
    position:absolute;
    left:0; top:0;
    width: 100%;
    height: 100%;
    display:block;
    object-fit: fill;
  }

  .field{
    position:absolute;
    font-size:12pt;
    font-weight:700;
    color:#000;
    white-space:nowrap;
    line-height:1;
    margin:0;
    padding:0;
  }

  .field.field-center{
    text-align:center;
  }

  .field.wrap{
    white-space:normal;
    word-break:break-word;
    overflow-wrap:break-word;
    font-size:10.5pt;
    line-height:1.1;
  }

 .note{
  position:absolute;
  overflow:hidden !important;
  box-sizing:border-box;
  padding:0;
  margin:0;
}
.note-body{
  width:100%;
  height:100%;
  box-sizing:border-box;
  overflow:hidden;
  padding:1.15mm 0.5mm 0.55mm;
  position:relative;
  display:flex;
  flex-direction:column;
  justify-content:flex-start;
  align-items:stretch;
}
.note-inner{
  width:100%;
  max-width:100%;
  box-sizing:border-box;
  font-weight:700;
  letter-spacing:normal;
  color:#000;
}
.note-head{
  display:block;
  width:100%;
  white-space:nowrap;
  overflow:hidden;
  margin:0 0 0.08mm 0;
  padding:0;
  font-size:9.5pt;
  line-height:1.12;
}
.note-row{
  display:block;
  width:100%;
  white-space:normal;
  word-break:break-word;
  overflow-wrap:break-word;
  margin:0 0 0.1mm 0;
  padding:0;
  font-size:6.35pt;
  line-height:1.06;
}
.note--piyasa .note-head,
.note-inner[data-not-kind="piyasa"] .note-head{
  font-size:10pt;
  line-height:1.14;
}
.note--piyasa .note-row,
.note-inner[data-not-kind="piyasa"] .note-row{
  font-size:8.5pt;
  line-height:1.18;
  word-break:normal;
  overflow-wrap:normal;
  margin:0 0 0.4mm 0;
}
.note--piyasa .note-row--bos,
.note-inner[data-not-kind="piyasa"] .note-row--bos{
  font-size:8pt;
  font-weight:800;
  line-height:1.08;
  margin-top:0.15mm;
}
.note--ihracat .note-head,
.note-inner[data-not-kind="ihracat"] .note-head{
  font-size:10.75pt;
  line-height:1.1;
  margin-bottom:0.05mm;
}
.note--ihracat .note-row,
.note-inner[data-not-kind="ihracat"] .note-row{
  font-size:7.5pt;
  line-height:1.06;
  white-space:pre-line;
  word-break:normal;
  overflow-wrap:normal;
  margin:0 0 0.05mm 0;
}
.note--ihracat .note-row:first-of-type,
.note-inner[data-not-kind="ihracat"] .note-row:first-of-type{
  margin-top:-0.08mm;
}

.imza-text {
  font-size: 9pt;
  font-weight: 600;
}

/* KANTAR imza bloğu: üstte imza, altta isim (kutu içinde) */
.imza-block{
  display:flex;
  flex-direction:column;
  align-items:center;
  justify-content:center;
  overflow: visible;
  white-space: normal;
  box-sizing: border-box;
  padding: 2mm 1mm 0.6mm;
}
.imza-imgwrap{
  flex: 1 1 auto;
  width: 100%;
  min-height: 0;
  display:flex;
  align-items:center;
  justify-content:center;
  padding: 0 0.5mm;
  overflow: visible;
  box-sizing: border-box;
}
.imza-img{
  max-width: 100%;
  width: auto;
  height: auto;
  max-height: 12mm;
  object-fit: contain;
  object-position: center center;
  display:block;
}
.imza-name{
  position: static;
  flex: 0 0 auto;
  margin-top: 0.3mm;
  font-size: 8.5pt;
  font-weight: 600;
  text-align:center;
  white-space: normal;
  line-height: 1.05;
  word-break: break-word;
}
.imza-block--kantar{
  align-items:center;
  justify-content:center;
  padding:2.4mm 0.6mm 0.9mm 0.6mm;
}
.imza-block--kantar .imza-imgwrap{
  align-items:center;
  justify-content:center;
  flex:0 1 auto;
  width:100%;
  padding:0;
}
.imza-block--kantar .imza-img{
  max-height:14mm;
  max-width:88%;
  object-position:center center;
}
.imza-block--kantar .imza-name{
  font-size:9.75pt;
  font-weight:700;
  text-align:center;
  width:100%;
  padding-left:0;
  margin-top:0.2mm;
}

			

/* ✅ Malzeme kutusu: 78mm — taşma yok (ambalaj sütununa binmesin) */
#printMalzeme.malzeme-print-box{
  overflow: hidden !important;
  box-sizing: border-box;
  padding-right: 0.5mm;
  white-space: normal !important;
  display: flex;
  flex-direction: column;
  justify-content: flex-start;
  align-items: flex-start;
  padding-top: 0 !important;
  line-height: 1;
}
#printMalzeme.malzeme-print-box--2{
  padding-top: 0 !important;
  padding-bottom: 0.6mm;
}
.malz-inline{
  font-weight: 800;
  white-space: nowrap;
  line-height: 1.05;
  width: 100%;
  max-width: 100%;
  overflow: hidden;
  display: block;
}
.malz-inline--2{
  white-space: normal;
  line-height: 1;
  padding: 0;
  margin: 0;
}
.malz-inline--2 .malz-row{
  white-space: nowrap;
  overflow: hidden;
  line-height: 1.02;
}
.malz-inline--2 .malz-row + .malz-row{
  margin-top: 0.12mm;
}

/* ✅ MALZEME 2/3 kolon görünüm (BBT üstte, HP altta) — eski grid (uyumluluk) */
.malz-grid{
  /* ✅ Hücre içinde yukarı çek (HP satırı daha okunur olsun) */
  position: relative;

  display:grid;
  align-items:start;
  /* ✅ Aralarda boşluk yerine çizgi kullanacağız (taşmayı azaltır) */
  column-gap: 0mm;
  row-gap: 0mm;
}
.malz-grid.cols-2{ grid-template-columns: 1fr 1fr; }
.malz-grid.cols-3{ grid-template-columns: 1fr 1fr 1fr; }
.malz-grid.cols-4{ grid-template-columns: 1fr 1fr 1fr 1fr; }
.malz-grid.cols-5{ grid-template-columns: 1fr 1fr 1fr 1fr 1fr; }
.malz-grid.cols-6{ grid-template-columns: 1fr 1fr 1fr 1fr 1fr 1fr; }

.malz-item{
  display:flex;
  flex-direction:column;
  gap: 0.25mm;
  padding: 0 1.2mm;
}

/* ✅ Kolon ayırıcı çizgiler */
.malz-item:not(:first-child){
  border-left: 1px solid #000;
}

/* ÜST SATIR: miktar (hiza bozulmasın) */
.malz-qty{
  font-weight: 800;
  font-size: 10.5pt;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 1.05;
}

/* ALT SATIR: HP açıklaması (gerekirse JS küçültür) */
.malz-desc{
  font-weight: 800;
  font-size: 8.5pt;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 1.05;
}

/* 4+ kolon olduğunda fontları daha küçük yap */
.malz-grid.cols-4 .malz-qty { font-size: 9pt; }
.malz-grid.cols-4 .malz-desc { font-size: 7.5pt; }
.malz-grid.cols-5 .malz-qty { font-size: 8pt; }
.malz-grid.cols-5 .malz-desc { font-size: 7pt; }
.malz-grid.cols-6 .malz-qty { font-size: 7.5pt; }
.malz-grid.cols-6 .malz-desc { font-size: 6.5pt; }

/* ✅ SEVK YERİ: değer hücresinde ortalı, bir tık büyük punto */
.field.wrap.sevk-box{
  display:flex;
  align-items:center;
  justify-content:center;
  text-align:center;
  width:100%;
  max-width:none;
  padding:0.4mm 1mm;
  box-sizing:border-box;
  white-space: normal !important;
  word-break: break-word;
  line-height: 1.12;
  font-size: 9.5pt;
  font-weight: 700;
  overflow:hidden;
}

/* ✅ AMBALAJ: yükleme notu açıklama satırı ile aynı punto (8.5pt) */
.field.wrap.ambalaj-box{
  display:flex;
  align-items:flex-start;
  justify-content:center;
  text-align:center;
  max-width:51mm;
  padding:0.45mm 0.35mm 0.35mm 1.55mm;
  box-sizing:border-box;
  white-space: normal !important;
  word-break: break-word;
  line-height: 1.12;
  font-size: 8.5pt;
  font-weight: 700;
  overflow:hidden;
}

/* ✅ SEPERATÖR: 2 satır (ÖDEME TÜRÜ: / GNP ORG:GNP), hücre üstünde */
.field.wrap.seperator-box{
  display:flex;
  align-items:flex-start;
  justify-content:center;
  text-align:center;
  padding:0.35mm 0.4mm 0.15mm 0.7mm;
  box-sizing:border-box;
  white-space: normal !important;
  word-break: break-word;
  overflow-wrap: anywhere;
  line-height: 1.06;
  font-size: 8pt;
  font-weight: 700;
  overflow:hidden;
}
.fit-one-line{
  white-space:nowrap !important;
}
.sevk-box .fit-span{
  display:inline-block;
  max-width:100%;
  white-space:nowrap;
}


/* Uzun yazılar taşmasın */
.wrap{
  white-space: normal !important;
  line-height: 1.15;
  word-break: break-word;
  overflow: hidden;
}

/* Sadece imza isimleri */
.imza-text{
  font-size: 9pt;
  font-weight: 600;
  white-space: normal;
  line-height: 1.1;
  word-break: break-word;
}

/* imza isimleri */

</style>

</head>
<body><div id="printViewport"><div id="printRoot">
<div class="page">
<img class="bg" src="${bgUrl}" alt="">

    <div class="field field-center" style="left:${P.yuklemeSirasi.left}mm; top:${P.yuklemeSirasi.top}mm; width:${P.yuklemeSirasi.w}mm; text-align:right; padding-right:1mm;">
        ${yuklemeSirasi}
    </div>

    <div class="field field-center" style="left:${P.tarih.left}mm; top:${P.tarih.top}mm; width:${P.tarih.w}mm; text-align:center;">
        ${trLocaleDateString()}
    </div>

    <div class="field" style="left:${P.sofor.left}mm; top:${P.sofor.top}mm; width:${P.sofor.w}mm;">
        ${soforBilgi}
    </div>

    <div class="field field-center" style="left:${P.iletisim.left}mm; top:${P.iletisim.top}mm; width:${P.iletisim.w}mm; text-align:center;">
        ${iletisimBilgi}
    </div>

    <div class="field" style="left:${P.tc.left}mm; top:${P.tc.top}mm; width:${P.tc.w}mm;">
        ${tcBilgi}
    </div>

    <div class="field" style="left:${P.cekici.left}mm; top:${P.cekici.top}mm; width:${P.cekici.w}mm;">
        ${cekiciPlakaBilgi}
    </div>

    <div class="field field-center" style="left:${P.dorse.left}mm; top:${P.dorse.top}mm; width:${P.dorse.w}mm;">
        ${dorsePlakaBilgi}
    </div>

   <div class="field" id="printFirma" style="left:${P.firma.left}mm; top:${P.firma.top}mm; width:${P.firma.w}mm; white-space:nowrap;">
        ${firmaKodu}
    </div>

    <div id="printMalzeme" class="${malzemeBoxClass}" style="left:${P.malzeme.left}mm; top:${malzemeTopMm}mm; width:${P.malzeme.w}mm; height:${P.malzeme.h + (malzemeLayout.twoLine ? 4 : 3)}mm;">
        ${malzemeGridHtml}
    </div>

<div id="printSevkYeri" class="field wrap sevk-box" style="left:${P.sevkYeri.left}mm; top:${P.sevkYeri.top}mm; width:${P.sevkYeri.w}mm; height:${P.sevkYeri.h}mm; overflow:hidden; text-align:center;">
  ${sevkYeriPrint}
</div>

<div id="printAmbalaj" class="field wrap ambalaj-box" style="left:${P.ambBilgi.left}mm; top:${P.ambBilgi.top}mm; width:${P.ambBilgi.w}mm; height:${P.ambBilgi.h}mm; overflow:hidden;">
  ${ambalajBilgisiPrint}
</div>

<div id="printSeperator" class="field wrap seperator-box" style="left:${P.seperator.left}mm; top:${P.seperator.top}mm; width:${P.seperator.w}mm; height:${P.seperator.h}mm; overflow:hidden;">
  ${seperatorBilgisiPrint}
</div>

<div class="field" style="left:${P.tonaj.left}mm; top:${P.tonaj.top}mm; width:${P.tonaj.w}mm;">
  ${tonaj}
</div>


    <!-- Uzun yazılar taşmasın -->
    <!-- Ambalaj Miktarları -->
    <div class="field" style="left:${P.bbt.left}mm; top:${P.bbt.top}mm; width:${P.bbt.w}mm; text-align:center;">
        ${amb.bbt}
    </div>

<div class="field" style="left:${P.bosBbt.left}mm; top:${P.bosBbt.top}mm; width:${P.bosBbt.w}mm; text-align:center;">
    ${amb.bosBbt}
</div>

    <div class="field" style="left:${P.cuval.left}mm; top:${P.cuval.top}mm; width:${P.cuval.w}mm; text-align:center;">
        ${amb.cuval}
    </div>

    <div class="field" style="left:${P.bosCuval.left}mm; top:${P.bosCuval.top}mm; width:${P.bosCuval.w}mm; text-align:center;">
        ${bosCuvalText}
    </div>

    <div class="field" style="left:${P.palet.left}mm; top:${P.palet.top}mm; width:${P.palet.w}mm; text-align:center;">
        ${amb.palet}
    </div>

    <div class="field" style="left:${P.torba.left}mm; top:${P.torba.top}mm; width:${P.torba.w}mm; text-align:center;">
        ${torbaText}
    </div>

    <!-- Yükleme Notu -->
    <div id="printNot" class="note note--${notKind}" data-not-kind="${notKind}" style="left:${P.not.left}mm; top:${P.not.top}mm; width:${P.not.w}mm; height:${P.not.h}mm;">
        <div class="note-body">${yuklemeNotuPrint}</div>
    </div>

<!-- İmza isimleri -->
<div class="field imza-block imza-block--kantar"
     style="left:${P.imzaKantar.left}mm; top:${P.imzaKantar.top}mm; width:${P.imzaKantar.w}mm; height:${P.imzaKantar.h}mm;">
  <div class="imza-imgwrap">${imzaKantarImgHtml}</div>
  <div class="imza-name">${imzaKantarAd}</div>
</div>

<div class="field imza-block"
     style="left:${P.imzaSaha.left}mm; top:${P.imzaSaha.top}mm; width:${P.imzaSaha.w}mm; height:${P.imzaSaha.h}mm;">
  <div class="imza-imgwrap">${imzaSahaImgHtml}</div>
  <div class="imza-name">${imzaSahaAd}</div>
</div>

<div class="field imza-text"
     style="left:${P.imzaYukleyen.left}mm; top:${P.imzaYukleyen.top}mm; width:${P.imzaYukleyen.w}mm; text-align:center;">
  ${imzaYukleyenAd}
</div>

<div class="field imza-text"
     style="left:${P.imzaKalite.left}mm; top:${P.imzaKalite.top}mm; width:${P.imzaKalite.w}mm; text-align:center;">
  ${imzaKaliteAd}
</div>

</div>
</div></div></body>
</html>
`;


    
    const shellPath = '/print-shell.html';
    const shellUrl = (getPrintOrigin() || '') + shellPath;
    const w = window.open(shellUrl, '_blank');
    if (!w || !w.document) {
      alert("❌ Yazdırma penceresi açılamadı (popup engeli veya tarayıcı kısıtı). Site için açılır pencere izni verip tekrar deneyin.");
      return null;
    }
    w.document.open();
    w.document.write(printHTML);
    w.document.close();

    // ✅ pageSize'ı window objesine attach et (onload'da kullanmak için)
    w.__pageSize = pageSize;

    // ✅ Önizleme modunda: sadece sekmeyi aç, otomatik yazdırma yapma
    const isPreview = !!opts.preview;
    const PRINT_SAFE_SCALE = 0.968;

    const applyPrintSafeScale = () => {
      try {
        const page = w.document.querySelector('.page');
        if (!page) return;
        page.style.transformOrigin = 'top center';
        page.style.transform = `scale(${PRINT_SAFE_SCALE})`;
      } catch (e) {}
    };

    const doPrint = () => {
      if (isPreview) return;
      try {
        applyPrintSafeScale();
        w.focus();
        w.print();
        w.onafterprint = () => {
          try {
            const parent = w.opener;
            if (parent && typeof parent.afterTakipPrint === 'function') {
              parent.afterTakipPrint();
            }
          } catch (e) {}
          try { w.close(); } catch (e) {}
        };
      } catch (e) {
        // fallback: yine de kapatma
        try { w.close(); } catch (_) {}
      }
    };

    w.onload = () => {
      // ✅ Tek satır / çok satır kutuya sığdırma (print penceresi içinde)
      const fitToBoxDiv = (el, minPx = 7, maxPx = 12) => {
        try {
          if (!el) return;
          el.style.fontSize = maxPx + 'px';
          for (let s = maxPx; s >= minPx; s--) {
            el.style.fontSize = s + 'px';
            const overW = el.scrollWidth > el.clientWidth + 1;
            const overH = el.scrollHeight > el.clientHeight + 1;
            if (!overW && !overH) break;
          }
        } catch(e) {}
      };

      // ✅ Otomatik yazı küçültme (taşma önleyici)
      const DESC_BOX_IDS = new Set(['printSevkYeri', 'printAmbalaj', 'printSeperator']);

      const autoFitWrapFields = () => {
        try {
          const fields = w.document.querySelectorAll('.wrap');
          fields.forEach(el => {
            if (!el) return;
            if (el.id === 'printMalzeme') return;
            if (DESC_BOX_IDS.has(el.id)) return;
            let size = parseFloat(w.getComputedStyle(el).fontSize) || 12;
            let guard = 0;
            while (guard < 18 && (el.scrollWidth > el.clientWidth || el.scrollHeight > el.clientHeight) && size > 7) {
              size -= 0.5;
              el.style.fontSize = size + 'px';
              guard++;
            }
          });
        } catch(e){}
      };
      autoFitWrapFields();
      // ✅ MALZEME: 2/3 kolon (üstte BBT, altta HP) - sadece alt satırı küçültmeye çalış
      const fitOneLineWidth = (el, minPx, maxPx) => {
        try {
          if (!el) return;
          let size = maxPx;
          el.style.fontSize = size + 'px';
          let guard = 0;
          while (guard < 40 && el.scrollWidth > el.clientWidth + 1 && size > minPx) {
            size -= 0.5;
            el.style.fontSize = size + 'px';
            guard++;
          }
        } catch(e){}
      };

      const fitMultiLineBoxPt = (el, minPt, maxPt) => {
        try {
          if (!el) return;
          let size = maxPt;
          el.style.fontSize = size + 'pt';
          let guard = 0;
          while (
            guard < 80 &&
            (el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1) &&
            size > minPt
          ) {
            size -= 0.2;
            el.style.fontSize = size + 'pt';
            guard++;
          }
        } catch(e){}
      };

      const fitMalzemeGrid = () => {
        try {
          const box = w.document.getElementById('printMalzeme');
          if (!box) return;

          const inlineEl = box.querySelector('.malz-inline');
          if (inlineEl) {
            fitMalzemeInlineEl(inlineEl, w);
            return;
          }

          // önce CSS fontlarını baz al
          const qtyEls  = box.querySelectorAll('.malz-qty');
          const descEls = box.querySelectorAll('.malz-desc');

          // 1) Önce sadece ALT SATIR (HP...) küçülsün
          descEls.forEach(el => {
            const base = parseFloat(w.getComputedStyle(el).fontSize) || 13;
            fitOneLineWidth(el, 7, base);
          });

          // 2) Eğer yine de yükseklik taşıyorsa, alt satırları birlikte küçült
          let guard = 0;
          while (guard < 40 && box.scrollHeight > box.clientHeight + 1) {
            let changed = false;
            descEls.forEach(el => {
              const cur = parseFloat(w.getComputedStyle(el).fontSize) || 10;
              if (cur > 7) {
                el.style.fontSize = (cur - 0.5) + 'px';
                changed = true;
              }
            });
            if (!changed) break;
            guard++;
          }

          // 3) Hâlâ taşarsa son çare: üst satırları (BBT) biraz küçült
          guard = 0;
          while (guard < 30 && box.scrollHeight > box.clientHeight + 1) {
            let changed = false;
            qtyEls.forEach(el => {
              const cur = parseFloat(w.getComputedStyle(el).fontSize) || 14;
              if (cur > 9) {
                el.style.fontSize = (cur - 0.5) + 'px';
                changed = true;
              }
            });
            if (!changed) break;
            guard++;
          }

		  
		  
        } catch(e){}
      };

fitMalzemeGrid();
      fitOneLineWidth(w.document.getElementById('printFirma'), 11, 12);

      // ✅ SEVK YERİ / AMBALAJ: bir tık büyük; SEPERATÖR: sağ hücreye oturt
      fitMultiLineBoxPt(w.document.getElementById('printSevkYeri'), 8.75, 9.5);
      fitMultiLineBoxPt(w.document.getElementById('printAmbalaj'), 7.75, 8.5);
      fitMultiLineBoxPt(w.document.getElementById('printSeperator'), 5.5, 8);

      // ✅ Yazdırma: yazıcı güvenli alanı (~%96.8), ekranda 1:1
      const layoutFormOnPage = () => {
        try {
          const root = w.document.getElementById('printRoot');
          const page = w.document.querySelector('.page');
          if (root) root.style.transform = 'none';
          if (page) {
            page.style.transform = 'none';
            page.style.transformOrigin = '';
            page.style.marginTop = w.__pageSize === 'A4' ? '5mm' : '0mm';
            page.style.paddingTop = w.__pageSize === 'A4' ? '0mm' : '1.5mm';
          }
        } catch (e) {}
      };

      const applyPrintSafeScaleOnLoad = applyPrintSafeScale;

      w.addEventListener('beforeprint', applyPrintSafeScaleOnLoad);
      w.addEventListener('afterprint', layoutFormOnPage);

      const printRoot = w.document.getElementById('printRoot');
      const pageEl = w.document.querySelector('.page');
      const fitNoteInBox = () => {
        const noteBox = w.document.getElementById('printNot');
        const savedRoot = printRoot ? printRoot.style.transform : '';
        const savedPage = pageEl ? pageEl.style.transform : '';
        try {
          if (printRoot) printRoot.style.transform = 'none';
          if (pageEl) pageEl.style.transform = 'none';
          fitYuklemeNotuPrint(noteBox);
        } finally {
          if (printRoot) printRoot.style.transform = savedRoot;
          if (pageEl) pageEl.style.transform = savedPage;
        }
      };

      const finishLayoutThenPrint = () => {
        const runAll = () => {
          fitNoteInBox();
          layoutFormOnPage();
          fitNoteInBox();
        };
        runAll();
        w.requestAnimationFrame(() => {
          runAll();
          w.requestAnimationFrame(() => {
            runAll();
            if (!isPreview) doPrint();
            else {
              try { w.focus(); } catch (e) {}
            }
          });
        });
      };

      const waitForImages = (done) => {
        const pending = [];
        const bg = w.document.querySelector('.bg');
        if (bg && !bg.complete) pending.push(bg);
        w.document.querySelectorAll('.imza-img').forEach((img) => {
          if (!img.complete) pending.push(img);
        });
        if (!pending.length) { done(); return; }
        let left = pending.length;
        const tick = () => { if (--left <= 0) done(); };
        pending.forEach((img) => {
          img.addEventListener('load', tick, { once: true });
          img.addEventListener('error', tick, { once: true });
        });
        setTimeout(done, 2500);
      };

      waitForImages(() => setTimeout(finishLayoutThenPrint, 0));
    };

    // ✅ Çağıran tarafta pencere referansı kullanılabilsin (closed polling)
    return w;
}


        

  // global export
  window.Print = {
    yazdirForm,
    getNextYuklemeSirasi,
    getLocalDateKey,
    __aracBosRev: '20260718-field-tune-v19',
  };
  window.fitYuklemeNotuPrint = fitYuklemeNotuPrint;
  window.resolveYuklemeNotuKind = resolveYuklemeNotuKind;
  window.isPiyasaFormContext = isPiyasaFormContext;
  window.isIhracatFormContext = isIhracatFormContext;
  window.YuklemeNotuFitSettings = {
    storageKey: YUKLEME_NOTU_FIT_STORAGE_KEY,
    defaults: YUKLEME_NOTU_FIT_DEFAULTS,
    load: loadYuklemeNotuFitSettings,
    save: saveYuklemeNotuFitSettings,
  };
})();
