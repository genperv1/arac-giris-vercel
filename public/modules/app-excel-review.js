// app-excel-review.js — Excel düzeltme penceresi
// Otomatik bölüm — scripts/split-large-files.js

/* ===============================
   EXCEL DÜZELTME PENCERESİ
================================ */


function closeExcelReviewUI(){
  const el = document.getElementById('excelReviewOverlay');
  if (el) el.remove();
}

function openExcelReviewUI({ plate, chosen, candidates, ydKey, onApply }){
  closeExcelReviewUI();

  const overlay = document.createElement('div');
  overlay.id = 'excelReviewOverlay';
  overlay.className = 'excel-review-overlay';

  const card = document.createElement('div');
  card.className = 'excel-review-modal';

  const safe = (v) => (v == null ? '' : String(v));
  const esc = (v) => (typeof escapeHtml === 'function' ? escapeHtml(safe(v)) : safe(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'));

  // İhracat Excel Detayları ile aynı mantık: kayıtta boşsa headerText adaylarından türet
  const resolvedSevk = String(chosen?.sevkYeri || _defaultSevkForShipment(chosen || {})).trim();
  const resolvedAmb = String(
    chosen?.ambalaj || chosen?.ambalajBilgisi || _defaultAmbalajTextForShipment(chosen || {})
  ).trim();

  card.innerHTML = `
    <div class="excel-review-modal__header">
      <div class="excel-review-modal__header-main">
        <span class="excel-review-modal__icon" aria-hidden="true">🧾</span>
        <div>
          <h2 class="excel-review-modal__title">Excel Düzeltme</h2>
          <p class="excel-review-modal__subtitle">
            Plaka: <b>${esc(plate||'')}</b>
            · Excel’den gelen bilgileri kontrol et, düzeltip <b>Uygula</b>.
          </p>
        </div>
      </div>
      <button type="button" id="excelReviewCloseBtn" class="excel-review-modal__btn excel-review-modal__btn--ghost">Kapat</button>
    </div>

    <div class="excel-review-modal__body">
      <div class="excel-review-grid excel-review-grid--2">
        <div class="excel-review-field">
          <label for="xr_firma">FİRMA / MÜŞTERİ KODU</label>
          <input id="xr_firma" type="text" value="${esc(chosen?.firma || '')}">
        </div>
        <div class="excel-review-field">
          <label for="xr_malzeme">MALZEME</label>
          <input id="xr_malzeme" type="text" value="${esc(chosen?.malzeme || '')}">
        </div>
        <div class="excel-review-field">
          <label for="xr_sevkYeri">SEVK YERİ</label>
          <select id="xr_sevkYeriCand">
            <option value="">(Aday seç / boş bırak)</option>
          </select>
          <input id="xr_sevkYeri" type="text" value="${esc(resolvedSevk)}">
        </div>
        <div class="excel-review-field">
          <label for="xr_ambalaj">AMBALAJ BİLGİSİ</label>
          <select id="xr_ambalajCand">
            <option value="">(Aday seç / boş bırak)</option>
          </select>
          <input id="xr_ambalaj" type="text" value="${esc(resolvedAmb)}">
        </div>
      </div>

      <div class="excel-review-grid excel-review-grid--4">
        <div class="excel-review-field">
          <label for="xr_bbt">BBT</label>
          <input id="xr_bbt" type="text" value="${esc(chosen?.bbt || '')}">
        </div>
        <div class="excel-review-field">
          <label for="xr_bosBbt">BOŞ BBT</label>
          <input id="xr_bosBbt" type="text" value="${esc(chosen?.bosBbt || '')}">
        </div>
        <div class="excel-review-field">
          <label for="xr_cuval">ÇUVAL</label>
          <input id="xr_cuval" type="text" value="${esc(chosen?.cuval || '')}">
        </div>
        <div class="excel-review-field">
          <label for="xr_bosCuval">BOŞ ÇUVAL</label>
          <input id="xr_bosCuval" type="text" value="${esc(chosen?.bosCuval || '')}">
        </div>
      </div>

      <div class="excel-review-grid excel-review-grid--3">
        <div class="excel-review-field">
          <label for="xr_palet">PALET</label>
          <input id="xr_palet" type="text" value="${esc(chosen?.palet || '')}">
        </div>
        <div class="excel-review-field">
          <label for="xr_tonaj">TONAJ (KG)</label>
          <input id="xr_tonaj" type="text" value="${esc(chosen?.tonajKg || '')}">
        </div>
        <div class="excel-review-field">
          <label for="xr_irsaliye">İRSALİYE NO</label>
          <input id="xr_irsaliye" type="text" value="${esc(getShipmentIrsaliyeNo(chosen))}">
        </div>
      </div>

      <div class="excel-review-modal__footer">
        <button type="button" id="excelReviewCancelBtn" class="excel-review-modal__btn excel-review-modal__btn--ghost">İptal</button>
        <button type="button" id="excelReviewApplyBtn" class="excel-review-modal__btn excel-review-modal__btn--apply">Uygula</button>
      </div>
    </div>
  `;

  overlay.appendChild(card);
  document.body.appendChild(overlay);

  // ✅ Aday listelerini doldur (sevk yeri / ambalaj) + mevcut değeri seçili getir
  try {
    const ambC = (candidates && Array.isArray(candidates.ambalaj)) ? [...candidates.ambalaj] : [];
    const sevC = (candidates && Array.isArray(candidates.sevkYeri)) ? [...candidates.sevkYeri] : [];

    const selAmb = card.querySelector('#xr_ambalajCand');
    const selSev = card.querySelector('#xr_sevkYeriCand');
    const sevInp = card.querySelector('#xr_sevkYeri');
    const ambInp = card.querySelector('#xr_ambalaj');

    const addUnique = (arr, val) => {
      const v = String(val || '').trim();
      if (!v) return;
      if (!arr.some((x) => String(x || '').trim().toUpperCase() === v.toUpperCase())) arr.unshift(v);
    };

    addUnique(sevC, resolvedSevk);
    addUnique(ambC, resolvedAmb);

    // Aynı Excel oturumunda daha önce girilen YD/Firma varsayılanları
    try {
      const key = normalizeYdKey(ydKey || chosen?.ydKey || chosen?.firma || '');
      if (key) {
        if (!window.__quickDefaultsByKey) window.__quickDefaultsByKey = {};
        const d = window.__quickDefaultsByKey[key];
        if (d) {
          const ds = String(d.sevkYeri || '').trim();
          const da = String(d.ambalaj || '').trim();
          addUnique(sevC, ds);
          addUnique(ambC, da);
          if (sevInp && !String(sevInp.value || '').trim() && ds) sevInp.value = ds;
          if (ambInp && !String(ambInp.value || '').trim() && da) ambInp.value = da;
        }
      }
    } catch (e) {}

    const addOpts = (sel, arr) => {
      if (!sel) return;
      for (const v of (arr || [])) {
        const opt = document.createElement('option');
        opt.value = String(v || '');
        opt.textContent = String(v || '');
        sel.appendChild(opt);
      }
    };

    addOpts(selSev, sevC);
    addOpts(selAmb, ambC);

    const pickSelect = (sel, val) => {
      const v = String(val || '').trim();
      if (!sel || !v) return;
      const match = Array.from(sel.options || []).find(
        (o) => String(o.value || '').trim().toUpperCase() === v.toUpperCase()
      );
      if (match) sel.value = match.value;
    };

    pickSelect(selSev, sevInp?.value || resolvedSevk);
    pickSelect(selAmb, ambInp?.value || resolvedAmb);

    // seçilince inputu doldur
    if (selSev) selSev.addEventListener('change', () => {
      const v = selSev.value || '';
      if (v && sevInp) sevInp.value = v;
    });
    if (selAmb) selAmb.addEventListener('change', () => {
      const v = selAmb.value || '';
      if (v && ambInp) ambInp.value = v;
    });
  } catch(e){}

  const close = () => closeExcelReviewUI();
  card.querySelector('#excelReviewCloseBtn').addEventListener('click', close);
  card.querySelector('#excelReviewCancelBtn').addEventListener('click', close);

  card.querySelector('#excelReviewApplyBtn').addEventListener('click', () => {
    const fixed = {
      ydKey: normalizeYdKey(ydKey || chosen?.ydKey || chosen?.firma || ''),
      firma: (document.getElementById('xr_firma')?.value || '').trim(),
      malzeme: (document.getElementById('xr_malzeme')?.value || '').trim(),
      sevkYeri: (document.getElementById('xr_sevkYeri')?.value || '').trim(),
      ambalaj: (document.getElementById('xr_ambalaj')?.value || '').trim(),
      bbt: (document.getElementById('xr_bbt')?.value || '').trim(),
      bosBbt: (document.getElementById('xr_bosBbt')?.value || '').trim(),
      cuval: (document.getElementById('xr_cuval')?.value || '').trim(),
      bosCuval: (document.getElementById('xr_bosCuval')?.value || '').trim(),
      palet: (document.getElementById('xr_palet')?.value || '').trim(),
      tonaj: (document.getElementById('xr_tonaj')?.value || '').trim(),
      irsaliyeNo: (document.getElementById('xr_irsaliye')?.value || '').trim(),
    };

    // ✅ Kullanıcı düzeltmesini FIRMA bazlı hafızaya al (özellikle Sevk Yeri / Liman)
    try{
      const fk = _normFirmaKey(fixed.firma);
      const newSevk = String(fixed.sevkYeri || '').trim();
      if (fk && newSevk) {
        setFirmaOverride(fixed.firma, { sevkYeri: newSevk });
      }
    }catch(e){}
try { onApply && onApply(fixed); } catch(e){}
    close();
  });
}

