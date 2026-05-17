/**
 * Vardiya / operasyon notlari — yazdir oncesi kural uyarilari
 */
(function () {
  'use strict';

  const CACHE_MS = 45000;
  let _cache = { ts: 0, notes: [] };

  function norm(s) {
    return String(s || '')
      .toUpperCase()
      .replace(/\u0130/g, 'I')
      .replace(/İ/g, 'I')
      .replace(/\s+/g, '');
  }

  function normTr(s) {
    return norm(
      String(s || '')
        .replace(/ü/g, 'u')
        .replace(/Ü/g, 'U')
        .replace(/ö/g, 'o')
        .replace(/Ö/g, 'O')
        .replace(/ç/g, 'c')
        .replace(/Ç/g, 'C')
        .replace(/ş/g, 's')
        .replace(/Ş/g, 'S')
        .replace(/ğ/g, 'g')
        .replace(/Ğ/g, 'G')
        .replace(/ı/g, 'i')
    );
  }

  function sehirMatches(haystack, ruleSehir) {
    const want = normTr(ruleSehir);
    if (!want) return true;
    const hay = normTr(haystack);
    if (!hay) return false;
    return hay.includes(want) || want.includes(hay);
  }

  function normMalzeme(s) {
    return norm(s).replace(/[^A-Z0-9]/g, '');
  }

  function malzemeHasP1P2(malzeme) {
    const m = normMalzeme(malzeme);
    if (!m) return false;
    return m.includes('P1') || m.includes('P2');
  }

  function extractYdTokens(text) {
    const out = new Set();
    const t = String(text || '').toUpperCase();
    const re = /\bYD\s*(\d{1,4})\b/gi;
    let m;
    while ((m = re.exec(t)) !== null) {
      out.add('YD' + m[1]);
    }
    return out;
  }

  function mergeYdFromText(intoSet, text) {
    extractYdTokens(text).forEach((k) => intoSet.add(k));
  }

  function ydKeyMatches(ctxYdKeys, ruleYd) {
    const wantSet = extractYdTokens(ruleYd);
    if (!wantSet.size) return false;
    for (const want of wantSet) {
      for (const y of ctxYdKeys) {
        if (extractYdTokens(y).has(want)) return true;
        const yd = norm(y);
        if (yd.includes(want) || want.includes(yd)) return true;
      }
    }
    return false;
  }

  function firmaMatches(ctxFirma, ruleFirma) {
    const f = norm(ctxFirma);
    const r = norm(ruleFirma);
    if (!f || !r) return false;
    return f.includes(r) || r.includes(f);
  }

  function hasIhracatExcel() {
    try {
      if (window.DailyStore && typeof DailyStore.getRows === 'function') {
        return (DailyStore.getRows() || []).length > 0;
      }
    } catch (e) {}
    try {
      if (typeof loadDailyShipments === 'function') {
        return (loadDailyShipments() || []).length > 0;
      }
    } catch (e) {}
    return false;
  }

  function hasPiyasaExcel() {
    try {
      if (window.piyasa && typeof window.piyasa.hasOrders === 'function') {
        return window.piyasa.hasOrders();
      }
    } catch (e) {}
    return false;
  }

  function buildYdKeysForPlate(plaka) {
    const keys = new Set();
    const plateNorm = norm(plaka);
    let hits = [];
    try {
      if (window.DailyStore && typeof DailyStore.findByPlate === 'function') {
        hits = DailyStore.findByPlate(plaka) || [];
      } else if (typeof loadDailyShipments === 'function') {
        hits = (loadDailyShipments() || []).filter((x) => norm(x.plaka) === plateNorm);
      }
    } catch (e) {}
    hits.forEach((h) => {
      mergeYdFromText(keys, h.ydKey);
      mergeYdFromText(keys, h.firma);
      mergeYdFromText(keys, h.headerText);
      mergeYdFromText(keys, h.yuklemeNotu);
      mergeYdFromText(keys, h.blockYuklemeNotu);
    });
    return keys;
  }

  function buildSehirHaystack(plaka, get) {
    const parts = [get('sevkYeri'), get('yuklemeNotu')];
    const plateNorm = norm(plaka);
    let hits = [];
    try {
      if (window.DailyStore && typeof DailyStore.findByPlate === 'function') {
        hits = DailyStore.findByPlate(plaka) || [];
      } else if (typeof loadDailyShipments === 'function') {
        hits = (loadDailyShipments() || []).filter((x) => norm(x.plaka) === plateNorm);
      }
    } catch (e) {}
    hits.forEach((h) => {
      if (h.sevkYeri) parts.push(h.sevkYeri);
      if (h.headerText) parts.push(h.headerText);
    });
    return parts.filter(Boolean).join(' ');
  }

  function buildPrintContext(opts) {
    const get = opts.get || (() => '');
    const plaka = String(opts.plaka || get('cekiciPlakaBilgi') || '').trim();
    const firma = [get('firmaKodu'), get('firmaSelect')].filter(Boolean).join(' ');
    const malzeme = [get('malzeme'), get('malzemeSelect')].filter(Boolean).join(' ');
    const ydKeys = buildYdKeysForPlate(plaka);
    [
      firma,
      malzeme,
      get('yuklemeNotu'),
      get('sevkYeri'),
      get('ambalajBilgisi')
    ].forEach((t) => mergeYdFromText(ydKeys, t));
    return {
      plaka,
      firma,
      malzeme,
      sehirHaystack: buildSehirHaystack(plaka, get),
      ydKeys,
      hasIhracatExcel: hasIhracatExcel(),
      hasPiyasaExcel: hasPiyasaExcel()
    };
  }

  function excelTypeAllows(note, ctx) {
    const t = String(note.excel_type || 'genel').toLowerCase();
    const rules = note.rules || {};
    if (t === 'genel' || t === 'her_ikisi') return true;
    if (t === 'ihracat') return true;
    if (t === 'piyasa') {
      if (rules.yd_key) return false;
      return true;
    }
    return true;
  }

  function noteMatches(note, ctx) {
    if (!note || note.active === false) return false;
    const rules = note.rules || {};
    if (!rules.yd_key && !rules.firma_kodu && !rules.malzeme_p1p2) return false;
    if (!excelTypeAllows(note, ctx)) return false;

    if (rules.yd_key && !ydKeyMatches(ctx.ydKeys, rules.yd_key)) return false;
    if (rules.firma_kodu) {
      const code = rules.firma_kodu;
      const okFirma =
        firmaMatches(ctx.firma, code) ||
        ydKeyMatches(ctx.ydKeys, code);
      if (!okFirma) return false;
    }
    if (rules.malzeme_p1p2 && !malzemeHasP1P2(ctx.malzeme)) return false;
    if (rules.sehir && !sehirMatches(ctx.sehirHaystack, rules.sehir)) return false;
    return true;
  }

  async function fetchActiveNotes() {
    const now = Date.now();
    if (_cache.notes.length && now - _cache.ts < CACHE_MS) {
      return _cache.notes;
    }
    try {
      const res = await fetch('/api/operation-notes?active=1', { credentials: 'include' });
      if (!res.ok) return _cache.notes || [];
      const data = await res.json();
      const notes = Array.isArray(data.notes) ? data.notes : [];
      _cache = { ts: now, notes };
      return notes;
    } catch (e) {
      return _cache.notes || [];
    }
  }

  function invalidateCache() {
    _cache = { ts: 0, notes: [] };
  }

  var SEP = '\u00B7';

  function ruleSummary(note) {
    const r = note.rules || {};
    const parts = [];
    const firmaLabel = r.yd_key || r.firma_kodu;
    if (firmaLabel) parts.push('Firma: ' + firmaLabel);
    if (r.sehir) parts.push('\u015eehir: ' + r.sehir);
    if (r.malzeme_p1p2) parts.push('Malzeme P1/P2');
    return parts.join(' ' + SEP + ' ') || '\u2014';
  }

  function showAlertsModal(matches) {
    return new Promise((resolve) => {
      const existing = document.getElementById('operation-notes-alert-overlay');
      if (existing) existing.remove();

      const overlay = document.createElement('div');
      overlay.id = 'operation-notes-alert-overlay';
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-modal', 'true');
      overlay.style.cssText =
        'position:fixed;inset:0;z-index:1000005;background:rgba(15,23,42,0.55);display:flex;align-items:center;justify-content:center;padding:16px;';

      const itemsHtml = matches
        .map((n, i) => {
          const when = n.created_at
            ? new Date(n.created_at).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' })
            : '';
          return (
            '<li style="margin-bottom:12px;padding:12px;background:#fff7ed;border:1px solid #fed7aa;border-radius:10px;text-align:left;">' +
            '<strong style="color:#9a3412;">' +
            (i + 1) +
            '. Vardiya notu</strong>' +
            '<div style="font-size:13px;color:#78350f;margin-top:6px;line-height:1.45;">' +
            escapeHtml(n.body) +
            '</div>' +
            '<div style="font-size:11px;color:#a16207;margin-top:6px;">' +
            escapeHtml(ruleSummary(n)) +
            (n.author_username ? ' ' + SEP + ' ' + escapeHtml(n.author_username) : '') +
            (when ? ' ' + SEP + ' ' + escapeHtml(when) : '') +
            '</div></li>'
          );
        })
        .join('');

      overlay.innerHTML =
        '<div style="background:#fff;border-radius:14px;max-width:520px;width:100%;box-shadow:0 20px 50px rgba(0,0,0,0.25);overflow:hidden;font-family:system-ui,sans-serif;">' +
        '<div style="background:linear-gradient(to right,#b91c1c,#dc2626);color:#fff;padding:16px 20px;">' +
        '<div style="font-weight:700;font-size:17px;">\u26A0\uFE0F Vardiya Notu</div>' +
        '<div style="font-size:12px;opacity:0.9;margin-top:4px;">Yazd\u0131rmadan \u00F6nce kontrol edin</div>' +
        '</div>' +
        '<div style="padding:16px 20px;max-height:50vh;overflow:auto;">' +
        '<ul style="list-style:none;margin:0;padding:0;">' +
        itemsHtml +
        '</ul></div>' +
        '<div style="padding:12px 20px;background:#f8fafc;border-top:1px solid #e2e8f0;text-align:right;">' +
        '<button type="button" id="operation-notes-alert-ok" style="background:#dc2626;color:#fff;border:none;padding:10px 24px;border-radius:8px;font-weight:600;cursor:pointer;font-size:14px;">Tamam</button>' +
        '</div></div>';

      document.body.appendChild(overlay);
      const okBtn = overlay.querySelector('#operation-notes-alert-ok');
      const close = () => {
        overlay.remove();
        resolve(true);
      };
      okBtn.addEventListener('click', close);
      okBtn.focus();
    });
  }

  function escapeHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  async function confirmBeforePrint(opts) {
    const ctx = buildPrintContext(opts || {});
    const notes = await fetchActiveNotes();
    const matches = notes.filter((n) => noteMatches(n, ctx));
    if (!matches.length) return true;
    await showAlertsModal(matches);
    return true;
  }

  async function getMatchingNotes(opts) {
    const ctx = buildPrintContext(opts || {});
    const notes = await fetchActiveNotes();
    return notes.filter((n) => noteMatches(n, ctx));
  }

  window.OperationNotesAlert = {
    confirmBeforePrint,
    getMatchingNotes,
    buildPrintContext,
    invalidateCache,
    noteMatches
  };
})();
