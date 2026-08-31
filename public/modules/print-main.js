// print-main.js — window.Print API (IIFE)
// Otomatik bölüm — scripts/split-large-files.js

// print.js (extracted from original GİRİŞ.html, refactor-safe)
(() => {
  'use strict';
  const TR_APP_TZ = 'Europe/Istanbul';
  const PRINT_BG_LEGACY = 'https://i.hizliresim.com/36cc3jp.jpg';
  const PRINT_BG_API = '/api/print-form-bg';
  const PRINT_BG_ASSET = '/assets/takip-form-bg.png';
  const PRINT_BG_ASSET_JPG = '/assets/takip-form-bg.jpg';
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
    if (/^https?:\/\//i.test(s)) return s;
    const origin = getPrintOrigin();
    if (!origin) return PRINT_BG_LEGACY;
    if (s.startsWith('/')) return origin + s;
    return origin + '/' + s;
  }

  function isHttpPrintBgUrl(url) {
    const s = String(url || '').trim();
    return /^https?:\/\//i.test(s) || s.startsWith('/');
  }

  /** Yazdırma penceresi için HTTP veya hazır blob URL. */
  function resolvePrintBgSrcForWindow() {
    try {
      if (window.__printBgBlobUrl) return window.__printBgBlobUrl;
    } catch (_) {}
    try {
      const custom = String(localStorage.getItem('printBgUrl') || '').trim();
      if (custom && isHttpPrintBgUrl(custom) && !/^data:/i.test(custom)) return toPrintBgSrc(custom);
    } catch (_) {}
    const origin = getPrintOrigin();
    return origin ? origin + PRINT_BG_API : PRINT_BG_API;
  }

  function prefetchPrintBgImage() {
    try {
      if (window.__printBgBlobUrl) return;
      const origin = getPrintOrigin();
      const httpSrc = origin ? origin + PRINT_BG_API : PRINT_BG_API;
      const img = new Image();
      img.src = httpSrc;
      fetch(httpSrc, { credentials: 'same-origin', cache: 'force-cache' })
        .then(function (r) { return r.ok ? r.blob() : null; })
        .then(function (blob) {
          if (!blob || blob.size < 500) return;
          try {
            if (window.__printBgBlobUrl) URL.revokeObjectURL(window.__printBgBlobUrl);
          } catch (_) {}
          window.__printBgBlobUrl = URL.createObjectURL(blob);
        })
        .catch(function () {});
    } catch (_) {}
  }

  async function resolvePrintBgUrl() {
    return resolvePrintBgSrcForWindow();
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

  function isRealImageDataUrl(url) {
    return /^data:image\/(jpeg|jpg|png)/i.test(String(url || ''));
  }

  async function ensurePrintBgDataUrl() {
    return resolvePrintBgSrcForWindow();
  }

  function hideTakipPrintFrame() {
    const overlay = document.getElementById('takipPrintOverlay');
    const frame = document.getElementById('takipPrintFrame');
    if (overlay) overlay.style.display = 'none';
    if (frame) {
      frame.style.cssText = 'flex:0 0 auto;width:210mm;height:148mm;border:0;background:#fff;margin:16px auto;';
      frame.setAttribute('aria-hidden', 'true');
    }
  }

  function sizeTakipPrintFrame(frame, pageSize) {
    if (!frame) return;
    const h = pageSize === 'A4' ? '297mm' : '148mm';
    frame.style.cssText =
      'flex:0 0 auto;width:210mm;height:' + h +
      ';max-width:calc(100vw - 24px);border:0;background:#fff;margin:16px auto 24px;display:block;pointer-events:auto;';
  }

  function bindTakipPrint(win) {
    if (!win) return;
    const started = Date.now();
    win.onafterprint = function () {
      if (Date.now() - started < 400) return;
      try { hideTakipPrintFrame(); } catch (e) {}
      try {
        if (typeof window.afterTakipPrint === 'function') window.afterTakipPrint();
      } catch (e) {}
    };
  }

  function getTakipPrintFrame(visible) {
    let overlay = document.getElementById('takipPrintOverlay');
    let frame = document.getElementById('takipPrintFrame');
    let bar = document.getElementById('takipPrintFrameBar');

    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'takipPrintOverlay';
      overlay.style.cssText = 'display:none;position:fixed;inset:0;z-index:2147483000;background:#020617;flex-direction:column;width:100vw;height:100vh;max-width:100vw;max-height:100vh;overflow:auto;';
      document.body.appendChild(overlay);
    }

    if (bar && bar.parentElement !== overlay) {
      try { bar.remove(); } catch (e) {}
      bar = null;
    }
    if (bar && !bar.querySelector('[data-takip-print-send]')) {
      try { bar.remove(); } catch (e) {}
      bar = null;
    }
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'takipPrintFrameBar';
      bar.style.cssText = 'flex:0 0 auto;display:flex;align-items:center;justify-content:flex-end;gap:12px;padding:12px 16px;background:#0f172a;z-index:2;pointer-events:auto;';
      const hint = document.createElement('div');
      hint.style.cssText = 'margin-right:auto;color:#e2e8f0;font:600 14px/1.3 Arial,sans-serif;';
      hint.textContent = 'Yazıcı penceresi açılmazsa sağdaki büyük düğmeye basın.';
      const printBtn = document.createElement('button');
      printBtn.type = 'button';
      printBtn.setAttribute('data-takip-print-send', '1');
      printBtn.textContent = 'Yazıcıya gönder';
      printBtn.style.cssText = 'border:0;background:#0f766e;color:#fff;border-radius:10px;padding:12px 22px;min-height:48px;min-width:180px;font:700 16px/1 Arial,sans-serif;cursor:pointer;pointer-events:auto;';
      printBtn.addEventListener('click', function (ev) {
        try { ev.preventDefault(); ev.stopPropagation(); } catch (e) {}
        const win = frame && frame.contentWindow;
        if (!win) return;
        try {
          bindTakipPrint(win);
          try { win.focus(); } catch (e) {}
          win.print();
        } catch (e) {}
      });
      const closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.textContent = 'Kapat';
      closeBtn.style.cssText = 'border:0;background:#334155;color:#fff;border-radius:10px;padding:12px 22px;min-height:48px;min-width:120px;font:700 16px/1 Arial,sans-serif;cursor:pointer;pointer-events:auto;';
      closeBtn.addEventListener('click', function () {
        hideTakipPrintFrame();
        try { window.__afterTakipPrintRequested = false; } catch (e) {}
      });
      bar.appendChild(hint);
      bar.appendChild(printBtn);
      bar.appendChild(closeBtn);
    }

    if (!frame) {
      frame = document.createElement('iframe');
      frame.id = 'takipPrintFrame';
      frame.title = 'Yazdırma';
    }
    sizeTakipPrintFrame(frame, localStorage.getItem('selectedPageSize') || 'A5');
    if (frame.parentElement !== overlay) overlay.appendChild(frame);
    if (bar.parentElement !== overlay) overlay.insertBefore(bar, frame);

    if (visible) {
      overlay.style.display = 'flex';
      frame.setAttribute('aria-hidden', 'false');
    } else {
      hideTakipPrintFrame();
    }
    return frame;
  }

  window.PrintFormBg = {
    resolvePrintBgUrl,
    resolvePrintBgSrcForWindow,
    ensurePrintBgDataUrl,
    prefetchPrintBgImage,
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
    ihracat: { headPt: 10.75, descPt: 9, minHeadPt: 10, minDescPt: 7.5, headStep: 0.08, descStep: 0.08 },
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
    const base = Object.assign({}, settings[key]);
    try {
      if (window.PrintLayoutSettings) {
        const n = window.PrintLayoutSettings.getYuklemeNotuStyle();
        if (n.headPt != null) base.headPt = n.headPt;
        if (n.descPt != null) base.descPt = n.descPt;
      }
    } catch (e) { /* ignore */ }
    return base;
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

    try {
      if (window.PrintLayoutSettings) {
        const noteStyle = window.PrintLayoutSettings.getYuklemeNotuStyle();
        const ml = noteStyle.maxLines || maxLines;
        const split = window.PrintLayoutSettings.splitTextByPhrases(t, noteStyle.breakAfter, ml);
        if (split.length > 1) return split.slice(0, ml);
      }
    } catch (e) { /* ignore */ }

    const sevkOzelMatch = t.match(/^(.*?\bSEVK\s+ED[İI]LECEK)\s+(ÖZEL\s+ETİKET.+)$/iu);
    if (sevkOzelMatch) {
      const presetLines = [sevkOzelMatch[1].trim(), sevkOzelMatch[2].trim()].filter(Boolean);
      if (presetLines.length && presetLines.length <= maxLines) return presetLines;
    }

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
      let ml = 3;
      let breakAfter = null;
      try {
        if (window.PrintLayoutSettings) {
          const ns = window.PrintLayoutSettings.getYuklemeNotuStyle();
          ml = ns.maxLines || 3;
          breakAfter = ns.breakAfter;
        }
      } catch (e) { /* ignore */ }
      const joined = parts.join(' ');
      if (window.PrintLayoutSettings && typeof window.PrintLayoutSettings.useStrictPrintLayout === 'function'
          && window.PrintLayoutSettings.useStrictPrintLayout()
          && typeof window.PrintLayoutSettings.splitTextByPhrases === 'function') {
        const split = window.PrintLayoutSettings.splitTextByPhrases(joined, breakAfter, ml);
        if (split.length) return split.slice(0, ml);
      }
      return splitIhracatDescIntoLines(joined, ml);
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
      if (window.PrintLayoutSettings && typeof window.PrintLayoutSettings.useStrictPrintLayout === 'function'
          && window.PrintLayoutSettings.useStrictPrintLayout()) {
        return;
      }
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

      let layoutNote = {};
      let useLayoutNote = false;
      try {
        if (window.PrintLayoutSettings && typeof window.PrintLayoutSettings.getYuklemeNotuStyle === 'function') {
          layoutNote = window.PrintLayoutSettings.getYuklemeNotuStyle() || {};
          useLayoutNote = layoutNote.headPt != null || layoutNote.descPt != null;
        }
      } catch (e) { /* ignore */ }

      const headEl = inner.querySelector('.note-head');
      const descRows = inner.querySelectorAll('.note-row');
      let headPt = useLayoutNote ? (layoutNote.headPt ?? preset.headPt) : preset.headPt;
      let descPt = useLayoutNote ? (layoutNote.descPt ?? preset.descPt) : preset.descPt;
      const headGapMm = useLayoutNote ? (layoutNote.headGapMm ?? 1.1) : 1.1;
      const noteLineHeight = useLayoutNote ? (layoutNote.lineHeight ?? 1.1) : (kind === 'piyasa' ? 1.18 : 1.08);
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
        if (headEl) {
          headEl.style.lineHeight = kind === 'ihracat' ? '1.12' : '1.1';
          headEl.style.fontSize = headPt + 'pt';
          if (useLayoutNote) headEl.style.marginBottom = headGapMm + 'mm';
        }
        descRows.forEach((row) => {
          row.style.lineHeight = useLayoutNote ? String(noteLineHeight) : (kind === 'piyasa' ? '1.18' : '1.08');
          row.style.fontSize = descPt + 'pt';
          if (kind === 'ihracat') {
            row.style.whiteSpace = 'pre-line';
            row.style.letterSpacing = '0';
          }
        });
      };

      applySizes();

      if (useLayoutNote) {
        let layoutGuard = 0;
        while (layoutGuard < 24 && (inner.scrollHeight > availH() + 1 || rowTooWide())) {
          if (descPt > minDescPt) descPt -= 0.08;
          else if (headEl && headPt > minHeadPt) headPt -= 0.08;
          else break;
          applySizes();
          layoutGuard++;
        }
        return;
      }

      const headDescGap = Math.max(0.75, preset.headPt - preset.descPt);
      const applyLegacySizes = () => {
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

      applyLegacySizes();
      const skipShrink =
        (kind === 'piyasa' && descRows.length <= 4) ||
        (kind === 'ihracat' && descRows.length <= 3);
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
          applyLegacySizes();
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

      // Büyütme döngüsü yazdırma sayfasını kilitliyordu (özellikle ihracat açıklaması).
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
    const clearLayoutSnapshot = () => {
      try { window.PrintLayoutSettings?.clearPreviewSnapshot?.(); } catch (e) { /* ignore */ }
    };
    if (opts.layoutSnapshot && window.PrintLayoutSettings?.setPreviewSnapshot) {
      window.PrintLayoutSettings.setPreviewSnapshot(opts.layoutSnapshot);
    } else if (window.PrintLayoutSettings) {
      const PLS = window.PrintLayoutSettings;
      if (typeof PLS.ensureSyncedOnce === 'function') {
        try { PLS.ensureSyncedOnce().catch(function () {}); } catch (e) { /* ignore */ }
      }
      try {
        if (PLS.setPreviewSnapshot && PLS.getAllFieldRects && PLS.FIELD_DEFS) {
          const fields = PLS.getAllFieldRects();
          const fieldStyles = {};
          PLS.FIELD_DEFS.forEach((d) => {
            fieldStyles[d.key] = PLS.getFieldStyle(d.key);
          });
          const cur = PLS.load() || {};
          PLS.setPreviewSnapshot({
            fields,
            fieldStyles,
            samples: cur.samples || {},
            styles: cur.styles || {},
          });
        }
      } catch (e) { /* ignore */ }
    }

    try {
    if (window.SignatureRegistry && typeof window.SignatureRegistry.loadSignatures === 'function') {
      try { window.SignatureRegistry.loadSignatures().catch(function () {}); } catch (e) { /* ignore */ }
    }

    const isDemo = !!opts.demo;
    const demoData = isDemo
      ? (opts.demoData || (typeof window.PrintLayoutSettings?.getDemoPrintData === 'function'
          ? window.PrintLayoutSettings.getDemoPrintData()
          : {}))
      : null;

    function readFormValue(id) {
      if (demoData && Object.prototype.hasOwnProperty.call(demoData, id)) {
        return String(demoData[id] ?? '');
      }
      const el = document.getElementById(id);
      if (!el) return '';
      if ('value' in el) return String(el.value || '');
      return String(el.textContent || '');
    }

    // ✅ localStorage'dan seçili sayfa boyutunu oku
    const pageSize = localStorage.getItem('selectedPageSize') || 'A5';
    
    const bgUrl = resolvePrintBgSrcForWindow();
    prefetchPrintBgImage();
    getTakipPrintFrame(true);
    sizeTakipPrintFrame(document.getElementById('takipPrintFrame'), pageSize);

    const firmaKodu = readFormValue('firmaKodu');
    const malzeme = readFormValue('malzeme');
    // ✅ Yükleme sırası: kullanıcı yazdıysa onu baz al, boşsa otomatik
    const yuklemeSirasiInput = isDemo ? null : document.getElementById('yuklemeSirasi');
    const manualStr = isDemo
      ? String(demoData?.yuklemeSirasi || '127').trim()
      : (yuklemeSirasiInput?.value || '').trim();

    let yuklemeSirasiNum = null;
    if (manualStr !== '' && /^\d+$/.test(manualStr)) {
        const m = parseInt(manualStr, 10);
        if (Number.isFinite(m) && m >= 1) {
            yuklemeSirasiNum = m;
        }
    }

    // Manuel geçersiz/boş ise otomatik artır (önizleme modunda sayaç artmaz)
    if (yuklemeSirasiNum === null && !isDemo) {
        yuklemeSirasiNum = getNextYuklemeSirasi();
        if (yuklemeSirasiInput) yuklemeSirasiInput.value = String(yuklemeSirasiNum);
    }
    if (yuklemeSirasiNum === null && isDemo) {
        yuklemeSirasiNum = 127;
    }

    const yuklemeSirasi = String(yuklemeSirasiNum);
const yuklemeNotu = resolveYuklemeNotuForPrint(readFormValue('yuklemeNotu'));

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

      // Ortak motor: kelime düşürmeden satır kır
      if (window.PrintLayoutSettings && typeof window.PrintLayoutSettings.formatAmbalajDisplay === 'function') {
        const plain = window.PrintLayoutSettings.formatAmbalajDisplay(raw);
        return escapeHtml(plain).replace(/\r?\n/g, '<br>');
      }

      if (/\r?\n/.test(raw)) {
        return escapeHtml(raw.replace(/\r\n/g, '\n').trim()).replace(/\r?\n/g, '<br>');
      }

      let t = raw
        .replace(/LINERLI(BASKISIZ)/gi, 'LINERLI $1')
        .replace(/LİNERLİ(BASKISIZ)/gi, 'LİNERLİ $1')
        .replace(/BASKILI(L[Iİ]NE+RL[Iİ])/gi, 'BASKILI $1')
        .replace(/(KG)(BASKILI)/gi, '$1 $2')
        .replace(/(KG)(BASKISIZ)/gi, '$1 $2')
        .replace(/(KG)(L[Iİ]NE+RL[Iİ])/gi, '$1 $2')
        .replace(/\s+/g, ' ')
        .trim();

      const netSplit = t.match(/^(NET\s+[\d.,]+\s*KG(?:\s+(?:BASKILI|BASKISIZ))?)\s+(.+)$/i);
      if (netSplit) {
        return escapeHtml(netSplit[1].trim()) + '<br>' + escapeHtml(netSplit[2].trim());
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

    function readFieldText(id) {
      if (demoData && Object.prototype.hasOwnProperty.call(demoData, id)) {
        return String(demoData[id] ?? '');
      }
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
const sevkYeri = readFormValue('sevkYeri');
const sevkYeriPrint = formatSevkYeriPrint(sevkYeri);
const tonaj = readFormValue('tonaj');
const ambalajBilgisi = normalizeAmbalajBilgisi(readFormValue('ambalajBilgisi'));
const ambalajBilgisiPrint = formatAmbalajBilgisiPrint(ambalajBilgisi);
const seperatorBilgisi = readFormValue('seperatorBilgisi');
const seperatorBilgisiPrint = formatSeperatorBilgisiPrint(seperatorBilgisi);
const imzaKantarAd   = readFormValue('imzaKantarAd');
const imzaKantarSrc  = toPrintSignatureSrc(resolveKantarSignatureSrc(imzaKantarAd));
const imzaKantarImgHtml = imzaKantarSrc ? `<img src="${imzaKantarSrc}" class="imza-img" alt="İmza">` : ``;

const imzaSahaAd     = readFormValue('imzaSahaAd');
const imzaSahaSrc    = toPrintSignatureSrc(resolveSahaSignatureSrc(imzaSahaAd));
const imzaSahaImgHtml = imzaSahaSrc ? `<img src="${imzaSahaSrc}" class="imza-img" alt="İmza">` : ``;
const imzaYukleyenAd = readFormValue('imzaYukleyenAd');
const imzaKaliteAd   = readFormValue('imzaKaliteAd');    // Ambalajlar (Yeni sistem: BBT, BOŞ BBT, ÇUVAL, BOŞ ÇUVAL, PALET, TORBA)
const amb = {
  bbt: "",
  bosBbt: "",
  cuval: "",
  bosCuval: "",
  palet: "",
  torba: ""
};

// ✅ Checkbox kaldırıldı: miktar girildiyse yazdır
amb.bbt = readFormValue('bbt').trim();
amb.bosBbt = readFormValue('bosBbt').trim();
amb.cuval = readFormValue('cuval').trim();
amb.bosCuval = readFormValue('bosCuval').trim();
amb.palet = readFormValue('palet').trim();
amb.torba = readFormValue('torba').trim();

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
      if (window.PrintLayoutSettings && typeof window.PrintLayoutSettings.buildBasePrintCoords === 'function') {
        return window.PrintLayoutSettings.buildBasePrintCoords();
      }
      const IMG_W = COORD_REF_W;
      const IMG_H = COORD_REF_H;
      const xMm = (px) => (px / IMG_W) * 210;
      const yMm = (py) => (py / IMG_H) * FORM_CONTENT_H;
      const mmPx = (mm) => (mm / 210) * IMG_W;
      const ry = (py) => Math.max(0, py - ROW_NUDGE_PX);
      const mid = (y0, y1, shift) => yMm((ry(y0) + ry(y1)) / 2) - shift;
      const rh = (y0, y1) => Math.max(4, yMm(ry(y1)) - yMm(ry(y0)) - 1.2);
      const packMm = [75.3, 104.4, 131.5, 158.9, 183.8, 205.7];
      const packPx = [212].concat(packMm.map(mmPx));
      const imzaMm = [54.8, 105.4, 154.8, 205.7];
      const imzaPx = [20].concat(imzaMm.map(mmPx));
      const P = {
        yuklemeSirasi: { left: xMm(455), top: mid(172, 210, 1.3), w: xMm(535 - 455), h: 5, align: 'center' },
        tarih:         { left: xMm(700), top: mid(172, 210, 1.3), w: xMm(990 - 700), h: 5, align: 'center' },
        sofor:         { left: xMm(215), top: mid(210, 248, 1.3), w: xMm(539 - 215), h: 5 },
        iletisim:      { left: xMm(738), top: mid(210, 248, 1.3), w: xMm(985 - 738), h: 5, align: 'center' },
        tc:            { left: xMm(215), top: mid(248, 286, 1.3), w: xMm(539 - 215), h: 5 },
        sevkYeri:      { left: xMm(702), top: mid(248, 286, 1.3), w: xMm(888 - 702), h: rh(248, 286), align: 'center' },
        cekici:        { left: xMm(215), top: mid(286, 325, 1.3), w: xMm(539 - 215), h: 5 },
        dorse:         { left: xMm(539), top: mid(286, 325, 1.3), w: xMm(1000 - 539), h: 5, align: 'center' },
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

    const P = buildTakipFormPrintCoords();
    if (window.PrintLayoutSettings && typeof window.PrintLayoutSettings.applyLayoutToCoords === 'function') {
      window.PrintLayoutSettings.applyLayoutToCoords(P);
    }
    const layoutKantar = (window.PrintLayoutSettings && typeof window.PrintLayoutSettings.getImzaKantarStyle === 'function')
      ? window.PrintLayoutSettings.getImzaKantarStyle()
      : { imgMaxMm: 12, namePt: 10, nameGapMm: 0.3, align: 'center' };
    const layoutSaha = (window.PrintLayoutSettings && typeof window.PrintLayoutSettings.getStyle === 'function')
      ? window.PrintLayoutSettings.getStyle('imzaSaha')
      : { imgMaxMm: 11, namePt: 9.5, nameGapMm: 0.25, align: 'center' };
    const layoutNote = (window.PrintLayoutSettings && typeof window.PrintLayoutSettings.getYuklemeNotuStyle === 'function')
      ? window.PrintLayoutSettings.getYuklemeNotuStyle()
      : { headGapMm: 1.1, headPt: 10.75, descPt: 9, lineHeight: 1.1 };
    const layoutPrintCss = (window.PrintLayoutSettings && typeof window.PrintLayoutSettings.buildFullPrintLayoutCss === 'function')
      ? window.PrintLayoutSettings.buildFullPrintLayoutCss()
      : ((window.PrintLayoutSettings && typeof window.PrintLayoutSettings.buildPrintLayoutCss === 'function')
        ? window.PrintLayoutSettings.buildPrintLayoutCss()
        : '');
    const strictPrintLayout = !!(window.PrintLayoutSettings
      && typeof window.PrintLayoutSettings.useStrictPrintLayout === 'function'
      && window.PrintLayoutSettings.useStrictPrintLayout());
    const pfPos = (key, extra) => {
      const r = P[key];
      if (!r) return strictPrintLayout ? '' : (extra || '');
      let s = `left:${r.left}mm;top:${r.top}mm;width:${r.w}mm;`;
      if (r.h != null) s += `height:${r.h}mm;`;
      return s + (strictPrintLayout ? '' : (extra || ''));
    };
    const kantarAlignItems = layoutKantar.align === 'left' ? 'flex-start' : 'center';
    const kantarTextAlign = layoutKantar.align === 'left' ? 'left' : 'center';
    const sahaAlignItems = layoutSaha.align === 'left' ? 'flex-start' : 'center';
    const sahaTextAlign = layoutSaha.align === 'left' ? 'left' : 'center';
    const malzemeTopMm = P.malzeme.top - (malzemeLayout.twoLine ? 1.8 : 0);
    const malzemeBoxClass = malzemeLayout.twoLine
      ? 'field malzeme-print-box malzeme-print-box--2'
      : 'field malzeme-print-box';

    // ✅ Sayfa boyutuna göre CSS parametrelerini ayarla
    const FORM_PAGE_H = FORM_CONTENT_H;
    const formOuterTopGap = pageSize === 'A4' ? '5mm' : '3.5mm';
    const formInnerPadTop = '0mm';
    const pageParams = pageSize === 'A4' 
      ? { size: 'A4', width: '210mm', height: '297mm' }
      : { size: 'A5 landscape', width: '210mm', height: '148mm' };

    const toLayoutPlain = (html) =>
      (window.PrintLayoutSettings && typeof window.PrintLayoutSettings.normalizePrintFieldText === 'function')
        ? window.PrintLayoutSettings.normalizePrintFieldText(html)
        : String(html || '').split(/<br\s*\/?>/gi).join('\n');

    const layoutFmt = window.PrintLayoutSettings?.formatFieldDisplayText?.bind(window.PrintLayoutSettings);

    const layoutFieldValues = {
      yuklemeSirasi,
      tarih: trLocaleDateString(),
      sofor: soforBilgi,
      iletisim: iletisimBilgi,
      tc: tcBilgi,
      cekici: cekiciPlakaBilgi,
      dorse: dorsePlakaBilgi,
      sevkYeri: layoutFmt ? layoutFmt('sevkYeri', sevkYeri) : toLayoutPlain(sevkYeriPrint),
      firma: firmaKodu,
      malzeme,
      ambBilgi: layoutFmt ? layoutFmt('ambBilgi', ambalajBilgisi) : toLayoutPlain(ambalajBilgisiPrint),
      tonaj,
      seperator: layoutFmt ? layoutFmt('seperator', seperatorBilgisi) : toLayoutPlain(seperatorBilgisiPrint),
      bbt: amb.bbt,
      bosBbt: amb.bosBbt,
      cuval: amb.cuval,
      bosCuval: amb.bosCuval,
      palet: amb.palet,
      torba: amb.torba,
      not: yuklemeNotu,
      imzaYukleyen: imzaYukleyenAd,
      imzaKalite: imzaKaliteAd,
    };
    const layoutSignatures = {
      imzaKantar: { name: imzaKantarAd, src: imzaKantarSrc },
      imzaSaha: { name: imzaSahaAd, src: imzaSahaSrc },
    };

    // Canlı önizleme / yazdırma: yükleme notu satırları print-main ile aynı mantıkta
    const noteLinesForLayout = (() => {
      try {
        const tmp = document.createElement('div');
        tmp.innerHTML = yuklemeNotuPrint;
        const rows = [];
        tmp.querySelectorAll('.note-head, .note-row').forEach((el) => {
          const t = (el.textContent || '').trim();
          if (t) rows.push(t);
        });
        return rows.length ? rows : null;
      } catch (e) {
        return null;
      }
    })();

    let printHTML;
    if (strictPrintLayout && typeof window.PrintLayoutSettings?.buildLayoutPrintDocument === 'function') {
      printHTML = window.PrintLayoutSettings.buildLayoutPrintDocument({
        bgUrl,
        pageSize,
        values: layoutFieldValues,
        signatures: layoutSignatures,
        noteLines: noteLinesForLayout,
      });
    } else {
    printHTML = `
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Sevkiyat Formu</title>
<style>
      * { page-break-inside: avoid; break-inside: avoid; }

      @page {
        size: ${pageParams.size};
        margin: 0;
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
    font-weight:700;
    color:#000;
    margin:0;
    padding:0;
    box-sizing:border-box;
    overflow:hidden;
    ${strictPrintLayout ? '' : 'font-size:12pt;white-space:nowrap;line-height:1;'}
  }

  .pf-field.field{
    overflow:hidden !important;
  }

  .field.field-center{
    text-align:center;
  }

  .field.wrap{
    white-space:normal;
    word-break:break-word;
    overflow-wrap:break-word;
    ${strictPrintLayout ? '' : 'font-size:10.5pt;line-height:1.1;'}
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
${strictPrintLayout ? '' : `
.note--ihracat .note-head,
.note-inner[data-not-kind="ihracat"] .note-head{
  font-size:${layoutNote.headPt || 10.75}pt;
  line-height:1.12;
  margin-bottom:${layoutNote.headGapMm}mm;
}
.note--ihracat .note-row,
.note-inner[data-not-kind="ihracat"] .note-row{
  font-size:${layoutNote.descPt || 9}pt;
  line-height:${layoutNote.lineHeight || 1.1};
  white-space:pre-line;
  word-break:normal;
  overflow-wrap:normal;
  margin:0 0 0.15mm 0;
}
`}

${strictPrintLayout ? '' : `
.imza-text {
  font-size: 9pt;
  font-weight: 600;
}

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
  align-items:${kantarAlignItems};
  justify-content:flex-end;
  padding:${layoutKantar.padTopMm != null ? layoutKantar.padTopMm : 5}mm 0.5mm 0.6mm;
  gap:${layoutKantar.nameGapMm}mm;
}
.imza-block--kantar .imza-imgwrap{
  flex:0 0 auto;
  width:100%;
  align-items:center;
  justify-content:center;
  padding:0;
}
.imza-block--kantar .imza-img{
  max-height:${layoutKantar.imgMaxMm}mm;
  max-width:90%;
  object-fit:contain;
  object-position:center center;
}
.imza-block--kantar .imza-name{
  flex:0 0 auto;
  font-size:${layoutKantar.namePt}pt;
  font-weight:700;
  text-align:${kantarTextAlign};
  width:100%;
  margin:0;
  padding:0;
  line-height:1.05;
}
.imza-block--saha{
  align-items:${sahaAlignItems};
  justify-content:flex-end;
  padding:${layoutSaha.padTopMm != null ? layoutSaha.padTopMm : 4.5}mm 0.5mm 0.6mm;
  gap:${layoutSaha.nameGapMm}mm;
}
.imza-block--saha .imza-imgwrap{
  flex:0 0 auto;
  width:100%;
  align-items:center;
  justify-content:center;
  padding:0;
}
.imza-block--saha .imza-img{
  max-height:${layoutSaha.imgMaxMm}mm;
  max-width:90%;
  object-fit:contain;
  object-position:center center;
}
.imza-block--saha .imza-name{
  flex:0 0 auto;
  font-size:${layoutSaha.namePt}pt;
  font-weight:700;
  text-align:${sahaTextAlign};
  width:100%;
  margin:0;
  padding:0;
  line-height:1.05;
}
`}

			

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

${strictPrintLayout ? '' : `
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
`}

${strictPrintLayout ? '' : `
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
`}

/* Düzenleyici ayarları — en son, baskıda birebir uygulanır */
${layoutPrintCss}

</style>

</head>
<body><div id="printViewport"><div id="printRoot">
<div class="page">
<img class="bg" src="${bgUrl}" alt="">

    <div class="field pf-field pf-yuklemeSirasi field-center" style="${pfPos('yuklemeSirasi', 'text-align:right;padding-right:1mm;')}">
        ${yuklemeSirasi}
    </div>

    <div class="field pf-field pf-tarih field-center" style="${pfPos('tarih', 'text-align:center;')}">
        ${trLocaleDateString()}
    </div>

    <div class="field pf-field pf-sofor" style="${pfPos('sofor')}">
        ${soforBilgi}
    </div>

    <div class="field pf-field pf-iletisim field-center" style="${pfPos('iletisim', 'text-align:center;')}">
        ${iletisimBilgi}
    </div>

    <div class="field pf-field pf-tc" style="${pfPos('tc')}">
        ${tcBilgi}
    </div>

    <div class="field pf-field pf-cekici" style="${pfPos('cekici')}">
        ${cekiciPlakaBilgi}
    </div>

    <div class="field pf-field pf-dorse field-center" style="${pfPos('dorse', 'text-align:center;')}">
        ${dorsePlakaBilgi}
    </div>

   <div class="field pf-field pf-firma" id="printFirma" style="${pfPos('firma')}">
        ${firmaKodu}
    </div>

    <div id="printMalzeme" class="${malzemeBoxClass} pf-field pf-malzeme" style="left:${P.malzeme.left}mm;top:${malzemeTopMm}mm;width:${P.malzeme.w}mm;height:${P.malzeme.h + (malzemeLayout.twoLine ? 4 : 3)}mm;">
        ${malzemeGridHtml}
    </div>

<div id="printSevkYeri" class="field pf-field pf-sevkYeri wrap sevk-box" style="${pfPos('sevkYeri', 'overflow:hidden;text-align:center;')}">
  ${sevkYeriPrint}
</div>

<div id="printAmbalaj" class="field pf-field pf-ambBilgi wrap ambalaj-box" style="${pfPos('ambBilgi', 'overflow:hidden;')}">
  ${ambalajBilgisiPrint}
</div>

<div id="printSeperator" class="field pf-field pf-seperator wrap seperator-box" style="${pfPos('seperator', 'overflow:hidden;')}">
  ${seperatorBilgisiPrint}
</div>

<div class="field pf-field pf-tonaj" style="${pfPos('tonaj')}">
  ${tonaj}
</div>


    <!-- Uzun yazılar taşmasın -->
    <!-- Ambalaj Miktarları -->
    <div class="field pf-field pf-bbt" style="${pfPos('bbt', 'text-align:center;')}">
        ${amb.bbt}
    </div>

<div class="field pf-field pf-bosBbt" style="${pfPos('bosBbt', 'text-align:center;')}">
    ${amb.bosBbt}
</div>

    <div class="field pf-field pf-cuval" style="${pfPos('cuval', 'text-align:center;')}">
        ${amb.cuval}
    </div>

    <div class="field pf-field pf-bosCuval" style="${pfPos('bosCuval', 'text-align:center;')}">
        ${bosCuvalText}
    </div>

    <div class="field pf-field pf-palet" style="${pfPos('palet', 'text-align:center;')}">
        ${amb.palet}
    </div>

    <div class="field pf-field pf-torba" style="${pfPos('torba', 'text-align:center;')}">
        ${torbaText}
    </div>

    <!-- Yükleme Notu -->
    <div id="printNot" class="note note--${notKind} pf-field pf-not" data-not-kind="${notKind}" style="${pfPos('not')}">
        <div class="note-body">${yuklemeNotuPrint}</div>
    </div>

<!-- İmza isimleri -->
<div class="field imza-block imza-block--kantar pf-field pf-imzaKantar"
     style="${pfPos('imzaKantar')}">
  <div class="imza-imgwrap">${imzaKantarImgHtml}</div>
  <div class="imza-name">${imzaKantarAd}</div>
</div>

<div class="field imza-block imza-block--saha pf-field pf-imzaSaha"
     style="${pfPos('imzaSaha')}">
  <div class="imza-imgwrap">${imzaSahaImgHtml}</div>
  <div class="imza-name">${imzaSahaAd}</div>
</div>

<div class="field imza-text pf-field pf-imzaYukleyen"
     style="${pfPos('imzaYukleyen', 'text-align:center;')}">
  ${imzaYukleyenAd}
</div>

<div class="field imza-text pf-field pf-imzaKalite"
     style="${pfPos('imzaKalite', 'text-align:center;')}">
  ${imzaKaliteAd}
</div>

</div>
</div></div></body>
</html>
`;
    }


    
    const isPreview = !!opts.preview;
    const frame = getTakipPrintFrame(true);
    sizeTakipPrintFrame(frame, pageSize);
    let w = frame && frame.contentWindow;
    if ((!w || !w.document) && frame) {
      await new Promise((resolve) => {
        const done = () => resolve();
        const t = setTimeout(done, 80);
        try {
          frame.addEventListener('load', () => { clearTimeout(t); done(); }, { once: true });
        } catch (e) {}
      });
      w = frame.contentWindow;
    }
    if (!w || !w.document) {
      alert("❌ Yazdırma hazır değil. Sayfayı yenileyip tekrar deneyin.");
      clearLayoutSnapshot();
      return null;
    }
    try { w.__takipPrintFrame = true; } catch (e) {}
    w.document.open();
    w.document.write(printHTML);
    w.document.close();

    // ✅ pageSize'ı window objesine attach et (onload'da kullanmak için)
    w.__pageSize = pageSize;

    // Önizleme ve yazdırma: aynı görünür iframe; yazdırma sistem diyaloğunu açar

    // WYSIWYG: önizleme ile yazdır aynı görünüm — ekstra ölçek/margin YOK
    const applyPrintSafeScale = () => {
      try {
        const page = w.document.querySelector('.plf-page');
        if (page) {
          page.style.transform = 'none';
          page.style.marginTop = '0';
          page.style.paddingTop = '0mm';
          return;
        }
        const legacy = w.document.querySelector('.page');
        if (!legacy) return;
        legacy.style.transformOrigin = 'top center';
        legacy.style.transform = 'scale(0.968)';
        legacy.style.marginTop = w.__pageSize === 'A4' ? '5mm' : '3.5mm';
        legacy.style.paddingTop = '0mm';
      } catch (e) {}
    };

    const doPrint = () => {
      if (isPreview) return;
      try { applyPrintSafeScale(); } catch (e) {}
      try {
        try { w.focus(); } catch (e) {}
        bindTakipPrint(w);
        w.print();
      } catch (e) {}
    };

    const onPrintWindowReady = () => {
      if (w.__printReadyRan) return;
      w.__printReadyRan = true;
      const useLayoutRenderer = !!w.document.querySelector('.plf-page');
      if (useLayoutRenderer) {
        const finishPreview = () => {
          // plf: önizleme = yazdır (ölçek yok)
          try {
            const page = w.document.querySelector('.plf-page');
            if (page) {
              page.style.transform = 'none';
              page.style.marginTop = '0';
            }
          } catch (e) { /* ignore */ }
          if (!isPreview) {
            doPrint();
          } else {
            try { w.focus(); } catch (e) { /* ignore */ }
          }
        };
        const waitForImages = (done) => {
          let finished = false;
          const finish = () => { if (finished) return; finished = true; done(); };
          const pending = [];
          const bg = w.document.querySelector('.plf-bg');
          if (bg && !bg.complete) pending.push(bg);
          w.document.querySelectorAll('.plf-body--sig img, .imza-img').forEach((img) => {
            if (img && !img.complete) pending.push(img);
          });
          if (!pending.length) { finish(); return; }
          let left = pending.length;
          const tick = () => { if (--left <= 0) finish(); };
          pending.forEach((img) => {
            img.addEventListener('load', tick, { once: true });
            img.addEventListener('error', tick, { once: true });
            if (img.complete) tick();
          });
          setTimeout(finish, 80);
        };
        waitForImages(finishPreview);
        return;
      }

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

          const qtyEls  = box.querySelectorAll('.malz-qty');
          const descEls = box.querySelectorAll('.malz-desc');

          descEls.forEach(el => {
            const base = parseFloat(w.getComputedStyle(el).fontSize) || 13;
            fitOneLineWidth(el, 7, base);
          });

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

      if (!strictPrintLayout) {
        autoFitWrapFields();
        fitMalzemeGrid();
        fitOneLineWidth(w.document.getElementById('printFirma'), 11, 12);
        w.document.querySelectorAll('.pf-field.field:not(.wrap):not(.note):not(.imza-block):not(.malzeme-print-box)').forEach((el) => {
          const base = parseFloat(w.getComputedStyle(el).fontSize) || 12;
          fitOneLineWidth(el, 7, base);
        });
        fitMultiLineBoxPt(w.document.getElementById('printSevkYeri'), 8.75, 9.5);
        fitMultiLineBoxPt(w.document.getElementById('printAmbalaj'), 7.75, 8.5);
        fitMultiLineBoxPt(w.document.getElementById('printSeperator'), 5.5, 8);
      }

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
            page.style.paddingTop = '0mm';
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
        if (!strictPrintLayout) fitNoteInBox();
        layoutFormOnPage();
        if (!isPreview) doPrint();
        else {
          try { w.focus(); } catch (e) {}
        }
      };

      const waitForImages = (done) => {
        let finished = false;
        const finish = () => { if (finished) return; finished = true; done(); };
        const pending = [];
        const bg = w.document.querySelector('.bg');
        if (bg && !bg.complete) pending.push(bg);
        w.document.querySelectorAll('.imza-img').forEach((img) => {
          if (img && !img.complete) pending.push(img);
        });
        if (!pending.length) { finish(); return; }
        let left = pending.length;
        const tick = () => { if (--left <= 0) finish(); };
        pending.forEach((img) => {
          img.addEventListener('load', tick, { once: true });
          img.addEventListener('error', tick, { once: true });
          if (img.complete) tick();
        });
        setTimeout(finish, 80);
      };

      if (strictPrintLayout) {
        waitForImages(() => {
          if (!isPreview) doPrint();
          else {
            try { w.focus(); } catch (e) {}
          }
        });
        return;
      }
      waitForImages(() => setTimeout(finishLayoutThenPrint, 0));
    };

    onPrintWindowReady();

    // ✅ Çağıran tarafta pencere referansı kullanılabilsin (closed polling)
    return w;
    } finally {
      clearLayoutSnapshot();
    }
}


        

  // global export
  window.Print = {
    yazdirForm,
    getNextYuklemeSirasi,
    getLocalDateKey,
    __aracBosRev: 'print-v11-fastdialog',
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
