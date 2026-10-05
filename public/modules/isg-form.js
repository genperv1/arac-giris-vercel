// isg-form.js — plaka / şoför İş Güvenliği Formu (ISG-T004) durumu
'use strict';

(function () {
  const api = createIsgApi();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') {
    window.IsgForm = api;
    window.isgCardBlockHTML = function (vehicle) {
      return api.cardHtml(vehicle);
    };
    const boot = function () {
      try { api.boot(); } catch (e) { /* ignore */ }
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
  }
})();

function createIsgApi() {
  const FORM_CODE = 'ISG-T004';
  const FORM_DATE = '28.10.2025';
  const FILE_MAX = 7000000;

  const RULES = [
    'İşyerinde alınmış tüm iş sağlığı ve güvenliği kurallarına uyunuz.',
    'İşyerinin giriş bölümünde bulunan KANTAR kontrol noktasında giriş kaydı yaptırınız, çıkarken aynı noktada çıkış kaydınızı yaptırınız.',
    'İşyerine silahla veya kesici/delici her türlü aletle girmek, alkol içmek, bina içlerinde sigara içmek yasaktır.',
    'Yalnızca güvenlik tarafından gösterilen yoldan ziyaret edeceğiniz kişi veya bölgeye gidiniz. Ziyaret amacı dışındaki hiçbir alana geçiş yapmayınız.',
    'Fabrika sahasını bilen bir refakatçi eşlik etmeden ve üzerinizde uygun Kişisel Koruyucu Donanım (baret, reflektif yelek, iş botu) bulunmadan çalışma sahasına girmeyiniz. Şantiye sahasının aydınlatması az veya hiç olmayan, çalışmanın devam ettiği yerlere, yakıt tankının olduğu yerlerden, iskele, döşeme kenarı ve zemin boşluklarına yakın bölgelerden ve iş makinelerinin çevresinden kesinlikle geçiş yapmayınız.',
    'Yükleme için gelen araçlar girişiniz yapıldıktan sonra yükleme sırasına göre sarım alanina dogru hareket ediniz.',
    'YÜKLEME kurallarına ve sırasına riyayet ediniz. ARAÇDAN kişisel koruyucu ekipmanlarınız olmadan inmeyiniz. Araçta bulunduğunuz sürece emniyet kemerinizi takılı tutunuz. Baretinizi takmadan,iş ayakkabısı giyinmeden kapak açmayınız. Size verilen yükleme takip formunu saha sevkiyat personeline veriniz. Yükeleme esnasında ve sıra beklereken aracınızın başından ayrılmayınız.',
    'Aracınızı işyeri sahasındaki araçların acil çıkışını kapatmayacak şekilde, size gösterilen yere park ediniz. Şantiye içi hız sınırına (azami 20 km/h) uyunuz.',
    'Acil bir durumda: ziyaret ettiğiniz kişi tarafından verilecek talimatlara uyunuz; paniğe kapılmayınız. Aksi belirtilmedikçe, işyerinde asılı olan Acil Durum Talimatlarında gösterilen acil çıkış yolunu kullanarak toplanma noktasına gidiniz.',
    'Bir kaza halinde: sakin olunuz; karşılaştığınız her türlü kazayı veya olayı ziyaret ettiğiniz kişiye bildiriniz.'
  ];

  const state = {
    records: [],
    loaded: false,
    authRequired: false,
    inflight: null
  };

  function esc(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function normPlate(p) {
    return String(p || '')
      .toLowerCase()
      .replace(/\s+/g, '')
      .replace(/[^a-z0-9ığüşöç]/gi, '');
  }

  function normName(s) {
    return String(s || '').trim().replace(/\s+/g, ' ').toLocaleUpperCase('tr-TR');
  }

  function splitDriverName(full) {
    const parts = String(full || '').trim().replace(/\s+/g, ' ').split(' ').filter(Boolean);
    if (!parts.length) return { soforAdi: '', soforSoyadi: '' };
    if (parts.length === 1) return { soforAdi: parts[0], soforSoyadi: '' };
    return { soforAdi: parts.slice(0, -1).join(' '), soforSoyadi: parts[parts.length - 1] };
  }

  function driverKeyFromParts(tc, ad, soyad) {
    const digits = String(tc || '').replace(/\D/g, '');
    if (digits.length === 11) return 'tc:' + digits;
    const name = normName([ad, soyad].filter(Boolean).join(' '));
    if (name.length >= 3) return 'name:' + name;
    return '';
  }

  function nameKeyFromParts(ad, soyad) {
    const name = normName([ad, soyad].filter(Boolean).join(' '));
    return name.length >= 3 ? ('name:' + name) : '';
  }

  function vehicleIdentity(vehicle) {
    const v = vehicle || {};
    const ad = String(v.soforAdi || '').trim();
    const soyad = String(v.soforSoyadi || '').trim();
    return {
      id: String(v.id || '').trim(),
      plateKey: normPlate(v.cekiciPlaka || v.plaka || ''),
      driverKey: driverKeyFromParts(v.tcKimlik || v.tc || '', ad, soyad),
      nameKey: nameKeyFromParts(ad, soyad),
      plateText: String(v.cekiciPlaka || v.plaka || '').trim(),
      driverName: [ad, soyad].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim(),
      tc: String(v.tcKimlik || v.tc || '').replace(/\D/g, '')
    };
  }

  function isSignedRecord(record) {
    if (!record) return false;
    return record.signed === true || record.signed === 1 || record.signed === 'true'
      || record.signed === 't' || record.signed === '1';
  }

  function personKeysOf(obj) {
    if (!obj) return [];
    return [obj.driverKey, obj.nameKey].map((k) => String(k || '')).filter(Boolean);
  }

  function recordMatches(record, identity) {
    if (!isSignedRecord(record) || !identity) return false;
    const vid = String(identity.id || identity.vehicleId || '').trim();
    const rv = String(record.vehicleId || record.vehicle_id || '').trim();
    if (vid && rv && vid === rv) return true;
    const left = personKeysOf(identity);
    const right = personKeysOf(record);
    if (left.length && right.length) return left.some((k) => right.indexOf(k) !== -1);
    if (identity.plateKey && record.plateKey && identity.plateKey === record.plateKey) {
      if (!left.length && !right.length) return true;
      if (left.length || right.length) return left.some((k) => right.indexOf(k) !== -1);
    }
    return false;
  }

  function resolveIsgStatus(vehicle, records) {
    const identity = vehicleIdentity(vehicle);
    const hits = (Array.isArray(records) ? records : []).filter((r) => recordMatches(r, identity));
    hits.sort((a, b) => (Number(b.signedAt) || 0) - (Number(a.signedAt) || 0));
    if (!hits.length) return { signed: false, identity, record: null };
    return { signed: true, identity, record: hits[0] };
  }

  function buildSavePayload(body, recordedBy) {
    const src = body || {};
    const identity = vehicleIdentity({
      id: src.vehicleId || src.id || '',
      cekiciPlaka: src.cekiciPlaka || src.plaka || src.plateText || '',
      soforAdi: src.soforAdi || '',
      soforSoyadi: src.soforSoyadi || '',
      tcKimlik: src.tcKimlik || src.tc || ''
    });
    if (!identity.driverName && src.driverName) {
      const split = splitDriverName(src.driverName);
      identity.driverName = [split.soforAdi, split.soforSoyadi].filter(Boolean).join(' ');
      identity.driverKey = identity.driverKey || driverKeyFromParts(identity.tc, split.soforAdi, split.soforSoyadi);
      identity.nameKey = identity.nameKey || nameKeyFromParts(split.soforAdi, split.soforSoyadi);
    }
    const signed = !(src.signed === false || src.signed === 'false' || src.signed === 0);
    let signedAt = Number(src.signedAt || src.signed_at);
    if (!Number.isFinite(signedAt) || signedAt <= 0) signedAt = Date.now();
    return {
      signed,
      signedAt: signed ? signedAt : null,
      docNo: String(src.docNo || src.doc_no || '').trim().slice(0, 80),
      formCode: FORM_CODE,
      recordedBy: String(recordedBy || '').trim().slice(0, 80),
      plateKey: identity.plateKey,
      driverKey: identity.driverKey,
      nameKey: identity.nameKey || '',
      vehicleId: identity.id.slice(0, 80),
      plateText: identity.plateText.slice(0, 40),
      driverName: identity.driverName.slice(0, 160)
    };
  }

  function safeHttpUrl(input) {
    const t = String(input || '').trim();
    if (!t) return '';
    if (!/^https?:\/\//i.test(t)) return '';
    if (t.length > 500) return '';
    return t;
  }

  function safeFileData(input) {
    const raw = String(input || '').trim();
    if (!raw) return '';
    if (raw.length > FILE_MAX) return null;
    if (!/^data:(image\/(?:jpeg|jpg|png|webp)|application\/pdf);base64,[a-z0-9+/=\r\n]+$/i.test(raw)) return null;
    return raw.replace(/\s+/g, '');
  }

  function formatTrDate(ms) {
    const n = Number(ms);
    if (!Number.isFinite(n) || n <= 0) return '';
    try {
      return new Date(n).toLocaleString('tr-TR', {
        timeZone: 'Europe/Istanbul',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch (e) {
      return '';
    }
  }

  function todayInputValue() {
    const d = new Date();
    const z = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate());
  }

  function msToInputDate(ms) {
    const n = Number(ms);
    if (!Number.isFinite(n) || n <= 0) return todayInputValue();
    try {
      return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Europe/Istanbul',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }).format(new Date(n));
    } catch (e) {
      return todayInputValue();
    }
  }

  function inputDateToMs(value) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
    if (!m) return Date.now();
    if (value === todayInputValue()) return Date.now();
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0, 0).getTime();
  }

  function currentUserName() {
    try { return String(localStorage.getItem('currentUserId') || '').trim(); } catch (e) { return ''; }
  }

  function readField(id) {
    if (typeof document === 'undefined') return '';
    const el = document.getElementById(id);
    if (!el) return '';
    if ('value' in el) return String(el.value || '').trim();
    return String(el.textContent || '').trim();
  }

  function capturePrintContext() {
    const active = (typeof window !== 'undefined' && window.__activeTakipVehicle) || {};
    const typed = readField('soforBilgi');
    const split = splitDriverName(typed);
    const useTyped = !!typed;
    return vehicleIdentity({
      id: (typeof window !== 'undefined' && window.__activeTakipVehicleId) || active.id || '',
      cekiciPlaka: readField('cekiciPlakaBilgi') || active.cekiciPlaka || '',
      tcKimlik: readField('tcBilgi') || active.tcKimlik || '',
      soforAdi: useTyped ? split.soforAdi : (active.soforAdi || ''),
      soforSoyadi: useTyped ? split.soforSoyadi : (active.soforSoyadi || '')
    });
  }

  /** Yazdır tıklanınca / form kapandıktan sonra kalan ISG bağlamı (snapshot + plaka). */
  function normalizeIsgPrintCtx(ctx) {
    const raw = ctx && typeof ctx === 'object' ? ctx : {};
    const snap = raw.snapshot && typeof raw.snapshot === 'object' ? raw.snapshot : {};
    let soforAdi = String(raw.soforAdi || snap.soforAdi || '').trim();
    let soforSoyadi = String(raw.soforSoyadi || snap.soforSoyadi || '').trim();
    if (!soforAdi && !soforSoyadi) {
      const fromName = splitDriverName(raw.driverName || snap.soforBilgi || readField('soforBilgi') || '');
      soforAdi = fromName.soforAdi;
      soforSoyadi = fromName.soforSoyadi;
    }
    return vehicleIdentity({
      id: String(raw.vehicleId || raw.id || '').trim(),
      cekiciPlaka: raw.cekiciPlaka || raw.plateText || raw.plaka || snap.cekiciPlaka || snap.plaka || '',
      soforAdi,
      soforSoyadi,
      tcKimlik: raw.tcKimlik || raw.tc || snap.tcKimlik || snap.tc || ''
    });
  }

  function persistedIsgRecords() {
    return (state.records || []).filter(function (r) {
      return !String(r.id || '').startsWith('local_');
    });
  }

  function needsIsgShipmentPrint(ctx) {
    const idn = normalizeIsgPrintCtx(ctx || capturePrintContext());
    return !resolveIsgStatus(idn, persistedIsgRecords()).signed;
  }

  function resolveFromForm() {
    return resolveIsgStatus(capturePrintContext(), state.records);
  }

  /** Takip formu baskısındaki ISG damgası (2 kantar: takip + ISG aynı oturum). */
  function resolveIsgSignedForTakipPrint() {
    try {
      const pending = typeof window !== 'undefined' ? window.__pendingPrintCommit : null;
      if (pending && (pending.isgPrint || pending.isgRequired)) {
        return true;
      }
      const fromForm = resolveIsgStatus(capturePrintContext(), state.records);
      if (fromForm.signed) return true;
      if (pending) {
        const raw = pending.isgPrint || {
          vehicleId: pending.vehicleId,
          id: pending.vehicleId,
          plaka: pending.plaka,
          cekiciPlaka: pending.plaka,
          snapshot: pending.snapshot
        };
        const idn = normalizeIsgPrintCtx(raw);
        if (resolveIsgStatus(idn, state.records).signed) return true;
      }
    } catch (e) { /* ignore */ }
    return false;
  }

  function printBadgeHtml(signed) {
    const ok = !!signed;
    try {
      const PLS = typeof window !== 'undefined' && window.PrintLayoutSettings;
      if (PLS && typeof PLS.buildIsgStampPrintFragment === 'function') {
        const html = PLS.buildIsgStampPrintFragment(ok);
        if (html) return html;
      }
    } catch (e) { /* ignore */ }
    const text = ok ? '✅ İSG Formu İmzalı' : '❌ İSG Formu İmzasız';
    const cls = ok ? 'isg-stamp isg-stamp--ok' : 'isg-stamp isg-stamp--miss';
    return '<div class="plf-field plf-field--isg ' + cls + '" style="position:absolute;left:79mm;top:12.6mm;width:52mm;height:6.8mm;z-index:6;">'
      + '<div class="plf-body plf-body--isg" style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:5pt;font-weight:800;">'
      + esc(text) + '</div></div>';
  }

  function buildCommitmentHtml(ctx) {
    const idn = ctx && ctx.plateText != null ? ctx : vehicleIdentity(ctx || {});
    const when = formatTrDate(Date.now());
    const rules = RULES.map((line, i) => '<li>' + esc(line) + '</li>').join('');
    return '<!DOCTYPE html><html lang="tr"><head><meta charset="utf-8"><title>' + FORM_CODE + ' İş Güvenliği Formu</title><style>'
      + '@page{size:A4;margin:10mm;}*{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact;}'
      + 'html,body{margin:0;padding:0;font-family:Arial,sans-serif;color:#111;background:#fff;}'
      + '.sheet{width:190mm;margin:0 auto;}'
      + '.head{display:flex;align-items:center;justify-content:space-between;gap:6mm;border-bottom:0.6mm solid #111;padding-bottom:2.5mm;margin-bottom:3mm;}'
      + '.brand{display:flex;align-items:center;gap:3mm;}'
      + '.brand img{height:14mm;width:auto;object-fit:contain;}'
      + '.brand-name{font-size:8pt;font-weight:700;letter-spacing:.04em;}'
      + '.docmeta{text-align:right;font-size:8.5pt;line-height:1.35;}'
      + 'h1{font-size:13pt;text-align:center;margin:1mm 0 1mm;letter-spacing:.02em;}'
      + 'h2{font-size:10.5pt;margin:0 0 1.5mm;}'
      + 'ol{margin:0 0 3mm 4.5mm;padding:0;font-size:8.6pt;line-height:1.28;}'
      + 'li{margin:0 0 1.1mm;}'
      + '.commit{border:0.35mm solid #111;padding:2.2mm 2.6mm;font-size:9pt;font-weight:700;margin:2mm 0 3mm;}'
      + 'table{width:100%;border-collapse:collapse;font-size:9.5pt;}'
      + 'td{border:0.3mm solid #111;padding:1.6mm 2mm;vertical-align:top;}'
      + '.k{width:38mm;font-weight:700;background:#f4f4f4;}'
      + '.sign{height:16mm;}'
      + '.note{margin-top:2mm;font-size:8pt;color:#333;}'
      + '</style></head><body><div class="sheet">'
      + '<div class="head"><div class="brand"><img src="/assets/isg-logo.jpeg" alt="GPM"><div><div class="brand-name">GPM</div><div class="brand-name">GENPER MINING INDUSTRY</div></div></div>'
      + '<div class="docmeta"><div><b>' + FORM_CODE + '</b></div><div>Yayın: ' + FORM_DATE + '</div><div>Şantiye genel iş güvenliği</div></div></div>'
      + '<h1>GENEL İŞ GÜVENLİĞİ TALİMAT VE TAAHHÜTNAMESİ</h1>'
      + '<h2>Ziyaretçilerin işyerinde uyması gereken kurallar</h2>'
      + '<ol>' + rules + '</ol>'
      + '<div class="commit">Yukarıdaki maddeleri okuyup anladım ve işyerinizi ziyaretim sırasında bu maddelere eksiksiz şekilde uyacağımı taahhüt ediyorum.</div>'
      + '<table>'
      + '<tr><td class="k">Ziyaretçinin adı soyadı</td><td>' + esc(idn.driverName || '') + '</td></tr>'
      + '<tr><td class="k">Araç plakası</td><td>' + esc(idn.plateText || '') + '</td></tr>'
      + '<tr><td class="k">Tarih / saat</td><td>' + esc(when) + '</td></tr>'
      + '<tr><td class="k">İmza</td><td class="sign"></td></tr>'
      + '</table>'
      + '<p class="note">Bu form şoföre imzalatılır. İmzalandıktan sonra sevkiyat görevlisi şoför kartından «İmzalandı» olarak işaretler. Sonraki sevkiyatlarda yalnızca takip formu basılır.</p>'
      + '</div></body></html>';
  }

  function metaLine(record) {
    if (!record) return '';
    const bits = [];
    const when = formatTrDate(record.signedAt);
    if (when) bits.push(when);
    bits.push(record.formCode || FORM_CODE);
    if (record.docNo) bits.push('Evrak ' + record.docNo);
    if (record.recordedBy) bits.push(record.recordedBy);
    return bits.join(' · ');
  }

  const ISG_DOC_URL = '/assets/isg-t004.pdf';

  function cardHtml(vehicle) {
    if (!state.loaded) {
      return '<div class="vehicle-card__field vehicle-card__field--wide vehicle-card__isg vehicle-card__isg--wait"><span class="vehicle-card__isg-status">İSG</span></div>';
    }
    const st = resolveIsgStatus(vehicle, state.records);
    if (!st.signed) {
      return '<div class="vehicle-card__field vehicle-card__field--wide vehicle-card__isg"><span class="vehicle-card__isg-status">❌ İSG Formu İmzasız</span></div>';
    }
    return '<div class="vehicle-card__field vehicle-card__field--wide vehicle-card__isg vehicle-card__isg--signed"><span class="vehicle-card__isg-status">✅ İSG Formu İmzalı</span></div>';
  }

  function bannerHtml(st) {
    if (!state.loaded) return '';
    if (st && st.signed) {
      return '<div class="isg-banner isg-banner--ok"><div class="isg-banner__title">✅ İSG Formu İmzalı</div></div>';
    }
    return '<div class="isg-banner isg-banner--miss"><div class="isg-banner__title">❌ İSG Formu İmzasız</div></div>';
  }

  function mountTakipBanner() {
    if (typeof document === 'undefined') return;
    const host = document.getElementById('isgTakipBanner');
    if (!host) return;
    const st = state.loaded ? resolveFromForm() : { signed: false, record: null };
    host.innerHTML = bannerHtml(st);
    if (!host.__isgWatch) {
      host.__isgWatch = true;
      ['soforBilgi', 'tcBilgi', 'cekiciPlakaBilgi'].forEach(function (id) {
        const el = document.getElementById(id);
        if (!el || el.__isgBound) return;
        el.__isgBound = true;
        el.addEventListener('input', function () { mountTakipBanner(); });
      });
    }
  }

  function identityFromButton(btn) {
    const name = splitDriverName(btn.getAttribute('data-isg-name') || '');
    return vehicleIdentity({
      id: btn.getAttribute('data-isg-id') || '',
      cekiciPlaka: btn.getAttribute('data-isg-plate') || '',
      soforAdi: name.soforAdi,
      soforSoyadi: name.soforSoyadi,
      tcKimlik: btn.getAttribute('data-isg-tc') || ''
    });
  }

  function closeDialog() {
    const el = document.getElementById('isgDialog');
    if (el) el.remove();
  }

  function openDialog(identity, status) {
    if (typeof document === 'undefined') return;
    closeDialog();
    const idn = identity && identity.plateKey != null ? identity : vehicleIdentity(identity);
    const st = status || resolveIsgStatus(idn, state.records);
    const rec = st.record || {};
    const fileLink = rec.hasFile && rec.id
      ? '<a href="/api/isg/' + encodeURIComponent(rec.id) + '/file" target="_blank" rel="noopener">Mevcut taranmış form</a>'
      : '<span class="isg-dialog__muted">Taranmış form yok</span>';
    const overlay = document.createElement('div');
    overlay.id = 'isgDialog';
    overlay.className = 'isg-dialog';
    overlay.innerHTML = '<div class="isg-dialog__card" role="dialog" aria-modal="true" aria-labelledby="isgDialogTitle">'
      + '<h2 id="isgDialogTitle">İş Güvenliği Formu</h2>'
      + '<p class="isg-dialog__who"><b>' + esc(idn.plateText || 'Plaka yok') + '</b>'
      + (idn.driverName ? ' · ' + esc(idn.driverName) : '') + '</p>'
      + '<p class="isg-dialog__status ' + (st.signed ? 'is-ok' : 'is-miss') + '">'
      + (st.signed ? '✅ İmzalı' : '❌ İmzasız') + '</p>'
      + '<label>İmzalanma tarihi<input type="date" id="isgSignedDate" value="' + esc(msToInputDate(rec.signedAt)) + '"></label>'
      + '<label>Form / evrak no<input type="text" id="isgDocNo" maxlength="80" placeholder="Varsa evrak no" value="' + esc(rec.docNo || '') + '"></label>'
      + '<p class="isg-dialog__meta">Form kodu: <b>' + FORM_CODE + '</b><br>Kaydı işleyen: <b>' + esc(rec.recordedBy || currentUserName() || '—') + '</b></p>'
      + '<label>Taranmış form<input type="file" id="isgFile" accept="image/jpeg,image/png,image/webp,application/pdf"></label>'
      + '<label>Dosya bağlantısı<input type="url" id="isgFileUrl" placeholder="https://..." value="' + esc(rec.fileUrl || '') + '"></label>'
      + '<div class="isg-dialog__file">' + fileLink + '</div>'
      + '<div class="isg-dialog__actions">'
      + '<button type="button" class="isg-dialog__btn isg-dialog__btn--ok" data-isg-save="1">İmzalandı olarak kaydet</button>'
      + (st.signed ? '<button type="button" class="isg-dialog__btn isg-dialog__btn--miss" data-isg-save="0">İmzasız yap</button>' : '')
      + '<button type="button" class="isg-dialog__btn isg-dialog__btn--ghost" data-isg-print="1">Formu yazdır</button>'
      + '<button type="button" class="isg-dialog__btn isg-dialog__btn--ghost" data-isg-close="1">Kapat</button>'
      + '</div></div>';
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) closeDialog();
    });
    overlay.querySelector('[data-isg-close]')?.addEventListener('click', closeDialog);
    overlay.querySelector('[data-isg-print]')?.addEventListener('click', function () {
      printCommitment(idn);
    });
    overlay.querySelectorAll('[data-isg-save]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const signed = btn.getAttribute('data-isg-save') === '1';
        saveFromDialog(idn, signed, btn);
      });
    });
    document.body.appendChild(overlay);
    try { document.getElementById('isgDocNo')?.focus(); } catch (e) { /* ignore */ }
  }

  function notifyUi() {
    try { mountTakipBanner(); } catch (e) { /* ignore */ }
    try {
      if (typeof state !== 'undefined' && state.vehiclesLoading) return;
    } catch (e) { /* state henüz yok */ }
    try { if (typeof updateVehicleList === 'function') updateVehicleList(); } catch (e) { /* ignore */ }
  }

  async function ensureLoaded(opts) {
    const force = !!(opts && opts.force);
    if (state.inflight && !force) return state.inflight;
    if (state.loaded && !force) return state.records;
    const run = (async function () {
      try {
        const res = await fetch('/api/isg', { credentials: 'same-origin', cache: 'no-store' });
        if (res.status === 401) {
          state.authRequired = true;
          return state.records;
        }
        if (!res.ok) throw new Error('isg-list');
        const data = await res.json();
        state.records = Array.isArray(data && data.records) ? data.records : [];
        state.loaded = true;
        state.authRequired = false;
        notifyUi();
        return state.records;
      } catch (e) {
        state.loaded = true;
        notifyUi();
        return state.records;
      }
    })();
    state.inflight = run;
    try { return await run; } finally { if (state.inflight === run) state.inflight = null; }
  }

  async function saveFromDialog(idn, signed, btn) {
    if (!idn.plateKey && !idn.driverKey) {
      window.alert('Plaka veya şoför bilgisi olmadan İş Güvenliği kaydı tutulamaz.');
      return;
    }
    const fileEl = document.getElementById('isgFile');
    const urlEl = document.getElementById('isgFileUrl');
    const docEl = document.getElementById('isgDocNo');
    const dateEl = document.getElementById('isgSignedDate');
    let fileData = '';
    const file = fileEl && fileEl.files && fileEl.files[0];
    if (file) {
      if (file.size > 5 * 1024 * 1024) {
        window.alert('Dosya 5 MB sınırını aşıyor. Daha küçük bir tarama veya bağlantı kullanın.');
        return;
      }
      fileData = await new Promise(function (resolve, reject) {
        const reader = new FileReader();
        reader.onload = function () { resolve(String(reader.result || '')); };
        reader.onerror = function () { reject(new Error('read')); };
        reader.readAsDataURL(file);
      });
      if (safeFileData(fileData) == null) {
        window.alert('Yalnızca JPG, PNG, WEBP veya PDF yüklenebilir.');
        return;
      }
    }
    const fileUrl = String(urlEl && urlEl.value || '').trim();
    if (fileUrl && !safeHttpUrl(fileUrl)) {
      window.alert('Dosya bağlantısı http veya https ile başlamalı.');
      return;
    }
    if (btn) btn.disabled = true;
    try {
      const res = await fetch('/api/isg', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vehicleId: idn.id,
          cekiciPlaka: idn.plateText,
          soforAdi: splitDriverName(idn.driverName).soforAdi,
          soforSoyadi: splitDriverName(idn.driverName).soforSoyadi,
          tcKimlik: idn.tc,
          driverName: idn.driverName,
          signed: signed,
          signedAt: inputDateToMs(dateEl && dateEl.value),
          docNo: docEl ? docEl.value : '',
          fileName: file ? file.name : '',
          fileData: fileData || undefined,
          fileUrl: fileUrl
        })
      });
      const data = await res.json().catch(function () { return {}; });
      if (!res.ok) {
        window.alert((data && (data.message || data.error)) || 'Kayıt yazılamadı.');
        return;
      }
      await ensureLoaded({ force: true });
      closeDialog();
      try {
        if (typeof showToast === 'function') {
          showToast(signed ? 'İş Güvenliği Formu imzalı olarak kaydedildi.' : 'İş Güvenliği Formu imzasız olarak işaretlendi.', 'success');
        }
      } catch (e) { /* ignore */ }
    } catch (e) {
      window.alert('Kayıt yazılamadı. Bağlantıyı kontrol edip tekrar deneyin.');
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  function spoolIsLocal() {
    try {
      const host = String(location.hostname || '').toLowerCase();
      return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1';
    } catch (e) {
      return false;
    }
  }

  async function readSpoolSeq() {
    try {
      const res = await fetch('/api/print-spool/cursor', { cache: 'no-store', credentials: 'same-origin' });
      if (!res.ok) return null;
      const data = await res.json();
      const seq = Number(data && data.seq);
      return Number.isFinite(seq) ? seq : null;
    } catch (e) {
      return null;
    }
  }

  async function confirmIsgPrinted(sinceSeq) {
    // Kantar PC dışında yazıcı kuyruğu yok; yazdır penceresi kapandıysa (afterprint) imzalı say.
    if (!spoolIsLocal()) return true;
    const deadline = Date.now() + 25000;
    do {
      try {
        const qs = new URLSearchParams();
        if (sinceSeq != null) qs.set('seq', String(sinceSeq));
        const res = await fetch('/api/print-spool/since?' + qs.toString(), { cache: 'no-store', credentials: 'same-origin' });
        if (res.status === 404) return false;
        if (res.ok) {
          const data = await res.json();
          if (data && data.seen) return true;
        }
      } catch (e) { /* ignore */ }
      if (Date.now() >= deadline) break;
      await new Promise(function (r) { setTimeout(r, 200); });
    } while (Date.now() < deadline);
    return false;
  }

  function mergeServerRecord(rec) {
    if (!rec || !isSignedRecord(rec)) return;
    const identity = {
      id: rec.vehicleId || '',
      plateKey: rec.plateKey || '',
      driverKey: rec.driverKey || '',
      nameKey: rec.nameKey || ''
    };
    const rest = (state.records || []).filter(function (r) {
      if (String(r.id || '') === String(rec.id || '')) return false;
      if (!isSignedRecord(r)) return true;
      return !recordMatches(r, identity);
    });
    state.records = [rec].concat(rest);
    state.loaded = true;
  }

  function patchLocalSignedRecord(idn) {
    const identity = vehicleIdentity(idn || {});
    if (!identity.plateKey && !identity.driverKey && !identity.id) return false;
    const rec = {
      id: 'local_' + Date.now(),
      signed: true,
      signedAt: Date.now(),
      plateKey: identity.plateKey,
      driverKey: identity.driverKey,
      nameKey: identity.nameKey || '',
      plateText: identity.plateText,
      driverName: identity.driverName,
      vehicleId: identity.id || idn.vehicleId || ''
    };
    const rest = (state.records || []).filter(function (r) {
      if (!isSignedRecord(r)) return true;
      return !recordMatches(r, identity);
    });
    state.records = [rec].concat(rest);
    state.loaded = true;
    notifyUi();
    return true;
  }

  async function markIsgPrinted(idn) {
    const identity = idn && idn.plateText != null ? idn : vehicleIdentity(idn || {});
    if (!identity.plateKey && !identity.driverKey) return false;
    const name = splitDriverName(identity.driverName || '');
    try {
      const res = await fetch('/api/isg', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vehicleId: identity.id,
          cekiciPlaka: identity.plateText,
          soforAdi: name.soforAdi,
          soforSoyadi: name.soforSoyadi,
          tcKimlik: identity.tc,
          driverName: identity.driverName,
          signed: true,
          signedAt: Date.now()
        })
      });
      if (!res.ok) {
        try {
          if (typeof showToast === 'function') {
            showToast('ISG imza kaydı sunucuya yazılamadı.', 'warn', 5000);
          }
        } catch (e2) { /* ignore */ }
        return false;
      }
      const data = await res.json().catch(function () { return {}; });
      if (data && data.record) {
        mergeServerRecord(data.record);
        notifyUi();
      }
      try {
        if (window.SyncManager && typeof window.SyncManager.broadcastLocal === 'function') {
          window.SyncManager.broadcastLocal('isg_updated', { signed: true });
        }
      } catch (e3) { /* ignore */ }
      await ensureLoaded({ force: true });
      notifyUi();
      return true;
    } catch (e) {
      return false;
    }
  }

  /** PDF iframe afterprint güvenilmez — yazdır penceresi kapanışını yakala. */
  function watchIsgPrintDialogEnd(win, onDone) {
    let finished = false;
    let sawPrintMode = false;
    const cleanups = [];
    const finish = function () {
      if (finished) return;
      finished = true;
      cleanups.forEach(function (fn) { try { fn(); } catch (e) { /* ignore */ } });
      cleanups.length = 0;
      onDone();
    };

    const trackMq = function (target) {
      if (!target || !target.matchMedia) return;
      const mq = target.matchMedia('print');
      const onMq = function () {
        if (mq.matches) sawPrintMode = true;
        else if (sawPrintMode) finish();
      };
      try {
        if (mq.addEventListener) mq.addEventListener('change', onMq);
        else mq.addListener(onMq);
        cleanups.push(function () {
          if (mq.removeEventListener) mq.removeEventListener('change', onMq);
          else mq.removeListener(onMq);
        });
      } catch (e) { /* ignore */ }
    };

    try { win.addEventListener('afterprint', finish, { once: true }); } catch (e) { /* ignore */ }
    trackMq(win);
    trackMq(window);

    let sawBlur = false;
    const onBlur = function () { sawBlur = true; };
    const onFocus = function () {
      if (!sawBlur && !sawPrintMode) return;
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('blur', onBlur);
      setTimeout(finish, 350);
    };
    const startedAt = Date.now();
    try { window.addEventListener('blur', onBlur); } catch (e) { /* ignore */ }
    try { window.addEventListener('focus', onFocus); } catch (e) { /* ignore */ }
    cleanups.push(function () {
      try { window.removeEventListener('focus', onFocus); } catch (e) { /* ignore */ }
      try { window.removeEventListener('blur', onBlur); } catch (e) { /* ignore */ }
    });

    const poll = setInterval(function () {
      if (finished) return;
      if (Date.now() - startedAt < 700) return;
      try {
        const mq = (win && win.matchMedia) ? win.matchMedia('print') : null;
        if (mq && mq.matches) sawPrintMode = true;
        if (sawPrintMode && mq && !mq.matches) finish();
      } catch (e) { /* ignore */ }
    }, 320);
    cleanups.push(function () { clearInterval(poll); });

    return finish;
  }

  function isgPdfAbsoluteUrl() {
    try {
      return new URL(ISG_DOC_URL + '?v=1', location.href).href;
    } catch (e) {
      return ISG_DOC_URL + '?v=1';
    }
  }

  function buildShipmentPrintCtx(pending) {
    if (!pending) return null;
    if (pending.isgPrint) {
      return normalizeIsgPrintCtx(Object.assign({}, pending.isgPrint, {
        id: pending.vehicleId || pending.isgPrint.id || '',
        vehicleId: pending.vehicleId || pending.isgPrint.vehicleId || '',
        plaka: pending.plaka || pending.isgPrint.plateText || '',
        cekiciPlaka: pending.plaka || pending.isgPrint.plateText || pending.isgPrint.cekiciPlaka || '',
        snapshot: pending.snapshot || pending.isgPrint.snapshot || null
      }));
    }
    if (pending.isgRequired === false) return null;
    const fallback = {
      id: pending.vehicleId,
      vehicleId: pending.vehicleId,
      plaka: pending.plaka,
      cekiciPlaka: pending.plaka,
      snapshot: pending.snapshot
    };
    if (pending.isgRequired === true) return normalizeIsgPrintCtx(fallback);
    if (needsIsgShipmentPrint(fallback)) return normalizeIsgPrintCtx(fallback);
    try {
      if (!resolveFromForm().signed) return normalizeIsgPrintCtx(fallback);
    } catch (e) { /* ignore */ }
    return null;
  }

  /** Takip afterprint ile aynı anda (await öncesi) — Chrome yazdırma engelini aşmak için. */
  function queueIsgPrintAfterTakip(pending) {
    if (typeof document === 'undefined') return null;
    if (window.__isgPrintQueuedForSession) return null;
    const ctx = buildShipmentPrintCtx(pending);
    if (!ctx) return null;
    window.__isgPrintQueuedForSession = true;
    try {
      if (typeof showToast === 'function') {
        showToast('Sırada: İSG formu — yazıcı penceresini onaylayın.', 'info', 5000);
      }
    } catch (e) { /* ignore */ }
    printIsgFormWithDialog(ctx).then(function () {
      try { if (typeof updateVehicleList === 'function') updateVehicleList(); } catch (e) {}
    }).catch(function () {
      try {
        if (typeof showToast === 'function') {
          showToast('ISG otomatik açılamadı. Ekrandaki ISG Yazdır düğmesine basın.', 'warn', 8000);
        }
      } catch (e) { /* ignore */ }
    });
    return ctx;
  }

  function isgPrintShellBlobUrl() {
    const pdfAbs = isgPdfAbsoluteUrl().replace(/"/g, '%22');
    const html = '<!DOCTYPE html><html lang="tr"><head><meta charset="utf-8"><title>ISG-T004 ISG Formu</title>'
      + '<style>@page{size:A4;margin:0;}html,body{margin:0;padding:0;width:210mm;height:297mm;overflow:hidden;background:#fff;}'
      + 'embed{display:block;width:210mm;height:297mm;border:0;}</style></head><body>'
      + '<embed src="' + pdfAbs + '" type="application/pdf">'
      + '<script>(function(){function notify(){try{parent.postMessage({type:"isgPrintEnd"},"*");}catch(e){}}'
      + 'window.addEventListener("afterprint",notify,{once:true});})();<\/script></body></html>';
    return URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
  }

  /** Takip formu (A5) bittikten sonra: yazıcı seçim penceresi ile ISG PDF bas. */
  function printIsgFormWithDialog(ctx) {
    if (typeof document === 'undefined') {
      return Promise.reject(new Error('no-dom'));
    }
    const idn = normalizeIsgPrintCtx(ctx && (ctx.plateText != null || ctx.plateKey || ctx.driverKey || ctx.snapshot) ? ctx : capturePrintContext(ctx || {}));
    return new Promise(function (resolve, reject) {
      let blobUrl = null;
      const prev = document.getElementById('isgDirectPrintFrame');
      if (prev) prev.remove();
      const takip = document.getElementById('takipDirectPrintFrame');
      if (takip) {
        takip.style.left = '-10000px';
        takip.style.visibility = 'hidden';
        takip.style.pointerEvents = 'none';
      }
      try {
        const overlay = document.getElementById('takipPrintOverlay');
        if (overlay) overlay.style.display = 'none';
      } catch (e) { /* ignore */ }

      const iframe = document.createElement('iframe');
      iframe.id = 'isgDirectPrintFrame';
      iframe.title = 'ISG-T004 İSG Formu';
      iframe.setAttribute('aria-hidden', 'true');
      iframe.style.cssText =
        'position:fixed;left:0;top:0;width:210mm;height:297mm;border:0;margin:0;padding:0;'
        + 'visibility:visible;pointer-events:auto;opacity:1;z-index:2147483001;overflow:hidden;background:#fff;';
      let settled = false;
      let dialogClosed = false;
      let printStarted = false;
      let printInvoked = false;

      const teardown = function () {
        iframe.style.left = '-10000px';
        iframe.style.visibility = 'hidden';
        iframe.style.pointerEvents = 'none';
        iframe.style.opacity = '0';
        iframe.style.zIndex = '-1';
        setTimeout(function () {
          try { iframe.remove(); } catch (e2) { /* ignore */ }
        }, 400);
      };

      const settle = function (ok, err) {
        if (settled) return;
        settled = true;
        try { window.removeEventListener('message', onParentMsg); } catch (e) { /* ignore */ }
        clearTimeout(safetyTimer);
        clearInterval(printWatch);
        clearTimeout(printDelayTimer);
        if (blobUrl) {
          try { URL.revokeObjectURL(blobUrl); } catch (e4) { /* ignore */ }
          blobUrl = null;
        }
        try {
          if (manualBar) manualBar.remove();
        } catch (e) { /* ignore */ }
        teardown();
        if (ok) resolve(true);
        else reject(err || new Error('isg-not-printed'));
      };

      const onPrintDialogClosed = function () {
        if (dialogClosed || !printInvoked) return;
        dialogClosed = true;
        patchLocalSignedRecord(idn);
        markIsgPrinted(idn).then(function (saved) {
          if (!saved) notifyUi();
          settle(true);
        });
      };

      const onParentMsg = function (ev) {
        if (!ev || !ev.data || ev.data.type !== 'isgPrintEnd') return;
        onPrintDialogClosed();
      };

      window.addEventListener('message', onParentMsg);

      const safetyTimer = setTimeout(function () {
        if (!dialogClosed && printInvoked) {
          settle(false, new Error('isg-timeout'));
        }
      }, 180000);

      let printDelayTimer = null;
      let manualBar = null;

      const showManualPrintBar = function () {
        if (manualBar || settled) return;
        manualBar = document.createElement('div');
        manualBar.id = 'isgManualPrintBar';
        manualBar.style.cssText =
          'position:fixed;inset:0;z-index:2147483002;background:rgba(2,6,23,0.92);'
          + 'display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;padding:24px;';
        const msg = document.createElement('div');
        msg.style.cssText = 'color:#e2e8f0;font:600 16px/1.4 Arial,sans-serif;text-align:center;max-width:420px;';
        msg.textContent = 'İSG-T004 formu hazır. Yazıcı penceresi açılmadıysa aşağıdaki düğmeye basın.';
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = 'ISG Yazdır';
        btn.style.cssText =
          'border:0;background:#0f766e;color:#fff;border-radius:10px;padding:14px 28px;'
          + 'min-height:48px;font:700 17px/1 Arial,sans-serif;cursor:pointer;';
        btn.addEventListener('click', function () {
          invokePrint(true);
        });
        manualBar.appendChild(msg);
        manualBar.appendChild(btn);
        document.body.appendChild(manualBar);
      };

      const invokePrint = function (fromUserClick) {
        if (printInvoked && !fromUserClick) return;
        printInvoked = true;
        const w = iframe.contentWindow;
        if (!w) {
          settle(false, new Error('isg-frame'));
          return;
        }
        watchIsgPrintDialogEnd(w, onPrintDialogClosed);
        try { iframe.style.left = '-10000px'; iframe.style.visibility = 'hidden'; } catch (e) { /* ignore */ }
        try { w.focus(); } catch (e) { /* ignore */ }
        try {
          w.print();
        } catch (e) {
          if (!fromUserClick) {
            showManualPrintBar();
            printInvoked = false;
            return;
          }
          settle(false, e);
        }
      };

      const startPrint = function () {
        if (printStarted) return;
        printStarted = true;
        printDelayTimer = setTimeout(function () {
          invokePrint(false);
          setTimeout(function () {
            if (!dialogClosed && !settled && !manualBar) showManualPrintBar();
          }, 2200);
        }, 450);
      };

      let printWatch = setInterval(function () {
        if (dialogClosed || printStarted) return;
        try {
          const w = iframe.contentWindow;
          if (w && w.document && w.document.readyState === 'complete') {
            clearInterval(printWatch);
            startPrint();
          }
        } catch (e) { /* ignore */ }
      }, 120);

      iframe.onload = function () {
        clearInterval(printWatch);
        startPrint();
      };

      document.body.appendChild(iframe);
      const pdfDirect = isgPdfAbsoluteUrl();
      try {
        blobUrl = isgPrintShellBlobUrl();
        iframe.src = blobUrl;
      } catch (e) {
        iframe.src = pdfDirect;
      }
      setTimeout(function () {
        if (!printStarted && !settled) startPrint();
      }, 4500);
    });
  }

  function printCommitment(ctx) {
    return printIsgFormWithDialog(ctx);
  }

  function boot() {
    ensureLoaded().catch(function () {});
    const bindSync = function () {
      if (!window.SyncManager || typeof window.SyncManager.on !== 'function') {
        setTimeout(bindSync, 400);
        return;
      }
      if (window.__isgSyncBound) return;
      window.__isgSyncBound = true;
      window.SyncManager.on('isg_updated', function () {
        ensureLoaded({ force: true }).catch(function () {});
      });
    };
    bindSync();
  }

  return {
    FORM_CODE,
    FORM_DATE,
    RULES,
    esc,
    normPlate,
    splitDriverName,
    driverKeyFromParts,
    vehicleIdentity,
    recordMatches,
    resolveIsgStatus,
    buildSavePayload,
    safeHttpUrl,
    safeFileData,
    formatTrDate,
    printBadgeHtml,
    buildCommitmentHtml,
    capturePrintContext,
    resolveFromForm,
    needsIsgShipmentPrint,
    resolveIsgSignedForTakipPrint,
    buildShipmentPrintCtx,
    queueIsgPrintAfterTakip,
    normalizeIsgPrintCtx,
    cardHtml,
    mountTakipBanner,
    ensureLoaded,
    printCommitment,
    printIsgFormWithDialog,
    boot,
    _state: state
  };
}
