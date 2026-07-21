// print-ux-fit.js — eşleştirme UX + yazdırma sığdırma
// Otomatik bölüm — scripts/split-large-files.js

function setupEslestirmeUXInsideForm() {
  const firmaSelectEl   = document.getElementById('firmaSelect');
  const firmaInputEl    = document.getElementById('firmaKodu');
  const malzemeSelectEl = document.getElementById('malzemeSelect');
  const malzemeInputEl  = document.getElementById('malzeme');
  const ambalajInputEl  = document.getElementById('ambalajBilgisi');
  const notTextareaEl   = document.getElementById('yuklemeNotu');

  if (ambalajInputEl) {
    const normalizeNow = () => { ambalajInputEl.value = normalizeAmbalajBilgisi(ambalajInputEl.value); };
    ambalajInputEl.addEventListener('change', normalizeNow);
    ambalajInputEl.addEventListener('blur', normalizeNow);
  }

  function getKantarPersonelNamesPrint() {
    if (typeof window.getKantarPersonelNames === 'function') return window.getKantarPersonelNames();
    const fromReg = (window.SignatureRegistry && window.SignatureRegistry.getNamesForRole('kantar')) || [];
    if (fromReg.length) return fromReg;
    return Object.keys(LEGACY_KANTAR_SIG);
  }

  function populateSignatureDatalistsPrint() {
    const namesK = getKantarPersonelNamesPrint();
    const namesS = (typeof window.getSahaPersonelNames === 'function')
      ? window.getSahaPersonelNames()
      : ((window.SignatureRegistry && window.SignatureRegistry.getNamesForRole('saha')) || []);
    const dlK = document.getElementById('kantarPersonelList');
    const dlS = document.getElementById('sahaPersonelList');
    if (dlK) dlK.innerHTML = namesK.map((n) => `<option value="${String(n).replace(/"/g, '&quot;')}"></option>`).join('');
    if (dlS) dlS.innerHTML = namesS.map((n) => `<option value="${String(n).replace(/"/g, '&quot;')}"></option>`).join('');
  }

  try { populateSignatureDatalistsPrint(); } catch (e) {}
  try { bindKantarSignaturePicker(); } catch(e) {}
  try { bindSahaSignaturePicker(); } catch(e) {}


  // Form açık değilse hiç dokunma (login ekranı vs.)
  if (!firmaSelectEl || !firmaInputEl || !malzemeSelectEl || !malzemeInputEl || !ambalajInputEl || !notTextareaEl) {
    return;
  }

  let aktifEslesmeler = [];

  const fillMalzemeSelect = (list) => {
    malzemeSelectEl.innerHTML = `<option value="">Malzeme Seçiniz</option>`;
    list.forEach(es => {
      const opt = document.createElement('option');
      opt.value = es.malzeme || '';
      opt.textContent = es.malzeme || '';
      malzemeSelectEl.appendChild(opt);
    });
  };

  const applyEslesme = (es) => {
    if (!es) return;
    malzemeSelectEl.value = es.malzeme || '';
    malzemeInputEl.value  = es.malzeme || '';
    ambalajInputEl.value  = normalizeAmbalajBilgisi(es.ambalajBilgisi || '');
    notTextareaEl.value   = es.yuklemeNotu || '';
  };

  const handleFirmaChange = (firma) => {
    if (!firma) return;

    aktifEslesmeler = (eslestirmeStorage?.getByFirma ? eslestirmeStorage.getByFirma(firma) : []) || [];

    // eşleşme yoksa serbest bırak
    if (aktifEslesmeler.length === 0) return;

    fillMalzemeSelect(aktifEslesmeler);

    if (aktifEslesmeler.length === 1) {
      applyEslesme(aktifEslesmeler[0]);
    } else {
      malzemeInputEl.value  = '';
      ambalajInputEl.value  = '';
      notTextareaEl.value   = '';
    }
  };

  // Aynı form tekrar açılınca çift listener olmasın diye: clone yöntemi
  const firmaSelectClone = firmaSelectEl.cloneNode(true);
  firmaSelectEl.parentNode.replaceChild(firmaSelectClone, firmaSelectEl);

  const firmaInputClone = firmaInputEl.cloneNode(true);
  firmaInputEl.parentNode.replaceChild(firmaInputClone, firmaInputEl);

  const malzemeSelectClone = malzemeSelectEl.cloneNode(true);
  malzemeSelectEl.parentNode.replaceChild(malzemeSelectClone, malzemeSelectEl);

  // Yeni referanslar
  const firmaSelect2   = document.getElementById('firmaSelect');
  const firmaInput2    = document.getElementById('firmaKodu');
  const malzemeSelect2 = document.getElementById('malzemeSelect');

  firmaSelect2.addEventListener('change', () => {
    firmaInput2.value = firmaSelect2.value || '';
    handleFirmaChange(firmaSelect2.value || '');
  });

  firmaInput2.addEventListener('input', () => {
    firmaSelect2.value = '';
    handleFirmaChange((firmaInput2.value || '').trim());
  });

  malzemeSelect2.addEventListener('change', () => {
    const secilen = malzemeSelect2.value || '';
    const es = aktifEslesmeler.find(e => (e.malzeme || '') === secilen);
    if (es) applyEslesme(es);
    else document.getElementById('malzeme').value = secilen;
  });
}


// =========================
// ✅ Print/Önizleme: kutuya sığdırma (ambalaj vb. uzun metinler)
// =========================
function fitToBoxInput(el, minPx = 10, maxPx = 16) {
  try {
    if (!el) return;
    el.style.fontSize = maxPx + 'px';
    // scrollHeight/Width ölçümü için kısa timeout gerekebilir; burada sync deniyoruz
    for (let s = maxPx; s >= minPx; s--) {
      el.style.fontSize = s + 'px';
      const overW = el.scrollWidth > el.clientWidth + 1;
      const overH = el.scrollHeight > el.clientHeight + 1;
      if (!overW && !overH) break;
    }
  } catch(e) {}
}

// Global: diğer scriptler tarafından erişilsin
window.fitToBoxInput = fitToBoxInput;

/** Takip formu textarea: piyasa / ihracat için ayrı ekran boyutu */
function fitYuklemeNotuOnScreen(el) {
  const kind =
    typeof window.resolveYuklemeNotuKind === 'function'
      ? window.resolveYuklemeNotuKind(el?.value || '')
      : 'piyasa';
  const screen =
    typeof window.YuklemeNotuFitSettings?.load === 'function'
      ? window.YuklemeNotuFitSettings.load().screen[kind === 'ihracat' ? 'ihracat' : 'piyasa']
      : (kind === 'ihracat' ? { minPx: 9, maxPx: 11 } : { minPx: 10, maxPx: 12 });
  fitToBoxInput(el, screen.minPx, screen.maxPx);
}
window.fitYuklemeNotuOnScreen = fitYuklemeNotuOnScreen;

(function hookPrintFit(){
  try {
    if (!window.Print || window.Print.__fitHooked) return;
    window.Print.__fitHooked = true;

    const orig = window.Print.yazdirForm;
    window.Print.yazdirForm = function(opts){
      try {
        // ambalaj bilgisi + yükleme notu uzun olabiliyor
        fitToBoxInput(document.getElementById('ambalajBilgisi'), 9, 16);
        fitToBoxInput(document.getElementById('sevkYeri'), 9, 16);
        fitYuklemeNotuOnScreen(document.getElementById('yuklemeNotu'));
        if (window.fitMalzemeInput) {
          try { window.fitMalzemeInput(document.getElementById('malzeme')); } catch (e) {}
        }
      } catch(e) {}
      return orig.call(window.Print, opts);
    };
  } catch(e) {}
})();


function fitToBoxDiv(el, minPx = 8, maxPx = 14, allowHeightOverflow = false) {
  try {
    if (!el) return;
    
    // Deneme: en yüksek font size'dan başla
    for (let s = maxPx; s >= minPx; s--) {
      el.style.fontSize = s + 'px';
      // Line-height ve padding'i font size'a göre ayarla
      el.style.lineHeight = (1.0 + (maxPx - s) * 0.02) + '';  // küçüldükçe artsın
      el.style.padding = (0.8 - (maxPx - s) * 0.05) + 'mm';
      
      // Işın kontrol: kutuya sığıyor mu?
      const overW = el.scrollWidth > el.clientWidth + 1;
      const overH = allowHeightOverflow ? false : (el.scrollHeight > el.clientHeight + 1);
      if (!overW && !overH) break;
    }
  } catch(e) {}
}

(function hookMalzemeInputFit() {
  const bind = () => {
    const el = document.getElementById('malzeme');
    if (!el || el.__malzemeFitHooked) return;
    el.__malzemeFitHooked = true;
    el.addEventListener('blur', () => {
      try { fitMalzemeInput(el); } catch (e) {}
    });
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }
})();

(function hookPrintFit2(){
  try {
    if (!window.Print || window.Print.__fitHooked2) return;
    window.Print.__fitHooked2 = true;

    const orig = window.Print.yazdirForm;
    window.Print.yazdirForm = function(opts){
      const ret = orig.call(window.Print, opts);
      try {
        // Print penceresi DOM'u oluştuktan sonra sığdır
        setTimeout(() => {
          try { fitToBoxDiv(document.getElementById('printAmbalaj'), 10, 22, true); } catch(e) {}
          try { fitToBoxDiv(document.getElementById('printSevkYeri'), 10, 22, true); } catch(e) {}
          try {
            const pw = ret && ret.document ? ret : null;
            if (pw && pw.document) window.fitYuklemeNotuPrint(pw.document.getElementById('printNot'), pw);
          } catch (e) {}
        }, 0);
        setTimeout(() => {
          try {
            const pw = ret && ret.document ? ret : null;
            if (pw && pw.document) {
              window.fitYuklemeNotuPrint(pw.document.getElementById('printNot'), pw);
              const malzEl = pw.document.querySelector('#printMalzeme .malz-inline');
              if (malzEl) fitMalzemeInlineEl(malzEl, pw);
            }
          } catch (e) {}
        }, 150);
      } catch(e) {}
      return ret;
    };
  } catch(e) {}
})();

