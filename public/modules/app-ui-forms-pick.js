// app-ui-forms-pick.js — firma/malzeme/plaka hızlı seçim
// Otomatik bölüm — scripts/split-app-ui-forms-core.js

// 🔎 Takip Formu: Firma/Malzeme hızlı arama (buton)
// - Input'a "HP" yaz -> Bul -> listeden seç
function _openQuickPick({ title, query, options, onPick }) {
  // ✅ SECURITY: Use global escapeHtml function (XSS protection)

  const all = (options || []).filter(Boolean).map(x => String(x));
  const initial = String(query || '').trim();

  // Eğer hiç sonuç yoksa
  if (all.length === 0) { alert('❌ Sonuç bulunamadı.'); return; }
  // Tek sonuç varsa direkt seç
  if (all.length === 1) { onPick(all[0]); return; }

  // Öncekini kapat
  const overlayId = 'quickPickOverlay';
  const old = document.getElementById(overlayId);
  if (old) old.remove();

  // Siyah arka plan YOK: sadece küçük modal (arka plan transparent)
  const overlay = document.createElement('div');
  overlay.id = overlayId;
  overlay.style.cssText = [
    'position:fixed',
    'inset:0',
    'z-index:1000001',
    'background:transparent',
    'display:flex',
    'align-items:flex-start',
    'justify-content:center',
    'padding:16px',
    'pointer-events:auto'
  ].join(';') + ';';

  const card = document.createElement('div');
  card.style.cssText = [
    'width:min(520px, 94vw)',
    'margin-top:10vh',
    'background:#fff',
    'border:1px solid #e5e7eb',
    'border-radius:12px',
    'box-shadow:0 10px 30px rgba(0,0,0,.18)',
    'overflow:hidden'
  ].join(';') + ';';

  const header = document.createElement('div');
  header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border-bottom:1px solid #e5e7eb;';
  header.innerHTML = `<strong style="font-size:14px;">${title || 'Seç'}</strong>`;

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.textContent = '✕';
  closeBtn.style.cssText = 'border:none;background:transparent;font-size:16px;cursor:pointer;opacity:.75;';
  closeBtn.onmouseenter = ()=> closeBtn.style.opacity = '1';
  closeBtn.onmouseleave = ()=> closeBtn.style.opacity = '.75';
  header.appendChild(closeBtn);

  const searchWrap = document.createElement('div');
  searchWrap.style.cssText = 'padding:10px 12px;border-bottom:1px solid #f3f4f6;';
  const input = document.createElement('input');
  input.type = 'text';
  input.value = initial;
  input.placeholder = 'Ara... (HP, HP2 gibi yaz)';
  input.className = 'form-input';
  input.style.cssText = 'width:100%;height:8mm;font-weight:bold;';
  searchWrap.appendChild(input);

  const listWrap = document.createElement('div');
  listWrap.style.cssText = 'max-height:55vh;overflow:auto;';

  const hint = document.createElement('div');
  hint.style.cssText = 'padding:8px 12px;color:#6b7280;font-size:12px;border-top:1px solid #f3f4f6;';
  hint.textContent = '↑↓ ile gez, Enter ile seç, Esc ile kapat';

  card.appendChild(header);
  card.appendChild(searchWrap);
  card.appendChild(listWrap);
  card.appendChild(hint);
  overlay.appendChild(card);
  document.body.appendChild(overlay);

  // ✅ Aday listelerini doldur (sevk yeri / ambalaj)
  try {
    const ambC = (candidates && Array.isArray(candidates.ambalaj)) ? candidates.ambalaj : [];
    const sevC = (candidates && Array.isArray(candidates.sevkYeri)) ? candidates.sevkYeri : [];

    const selAmb = card.querySelector('#xr_ambalajCand');
    const selSev = card.querySelector('#xr_sevkYeriCand');

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
// Sevk yeri: ilk aday varsa otomatik doldur
try {
  const sevInp = card.querySelector('#xr_sevkYeri');
  if (sevInp && !String(sevInp.value || '').trim() && sevC.length > 0) {
    sevInp.value = sevC[0];
    if (selSev) selSev.value = sevC[0];
  }
} catch(e) {}

// Ambalaj: ilk aday varsa otomatik doldur
try {
  const ambInp = card.querySelector('#xr_ambalaj');
  if (ambInp && !String(ambInp.value || '').trim() && ambC.length > 0) {
    ambInp.value = ambC[0];
    if (selAmb) selAmb.value = ambC[0];
  }
} catch(e) {}
	  
    addOpts(selAmb, ambC);

    // seçilince inputu doldur
    if (selSev) selSev.addEventListener('change', () => {
      const v = selSev.value || '';
      if (v) {
        const inp = card.querySelector('#xr_sevkYeri');
        if (inp) inp.value = v;
      }
    });
    if (selAmb) selAmb.addEventListener('change', () => {
      const v = selAmb.value || '';
      if (v) {
        const inp = card.querySelector('#xr_ambalaj');
        if (inp) inp.value = v;
      }
    });
  } catch(e){}

  // ✅ Aynı Excel oturumunda hızlı doldurma: YD/Firma anahtarına göre
  try {
    const key = normalizeYdKey(ydKey || chosen?.ydKey || chosen?.firma || '');
    if (key) {
      if (!window.__quickDefaultsByKey) window.__quickDefaultsByKey = {};
      const d = window.__quickDefaultsByKey[key];
      if (d) {
        const sevInp = card.querySelector('#xr_sevkYeri');
        const ambInp = card.querySelector('#xr_ambalaj');
        if (sevInp && !String(sevInp.value||'').trim() && String(d.sevkYeri||'').trim()) sevInp.value = d.sevkYeri;
        if (ambInp && !String(ambInp.value||'').trim() && String(d.ambalaj||'').trim()) ambInp.value = d.ambalaj;
      }
    }
  } catch(e){}

  let filtered = [];
  let activeIndex = 0;

  const render = () => {
    const q = (input.value || '').trim().toLowerCase();
    filtered = q ? all.filter(x => x.toLowerCase().includes(q)) : all.slice();

    // 0 sonuç
    if (filtered.length === 0) {
      listWrap.innerHTML = `<div style="padding:12px;color:#6b7280;">Sonuç yok</div>`;
      activeIndex = 0;
      return;
    }

    // Çok uzun olmasın
    const show = filtered.slice(0, 200);
    listWrap.innerHTML = show.map((val, i) => {
      const active = i === activeIndex ? 'background:#f3f4f6;' : '';
      return `<button type="button" data-idx="${i}" style="width:100%;text-align:left;padding:10px 12px;border:none;background:transparent;cursor:pointer;${active}">${escapeHtml(val)}</button>`;
    }).join('');
  };

  const pick = (val) => {
    try { onPick(val); } catch(e) { console.error(e); }
    const el = document.getElementById(overlayId);
    if (el) el.remove();
  };

  // Click outside closes
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });
  closeBtn.addEventListener('click', ()=> overlay.remove());

  listWrap.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-idx]');
    if (!btn) return;
    const i = parseInt(btn.getAttribute('data-idx'), 10);
    const val = (filtered || [])[i];
    if (val) pick(val);
  });

  input.addEventListener('input', () => { activeIndex = 0; render(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { overlay.remove(); return; }
    if (!filtered || filtered.length === 0) return;

    if (e.key === 'ArrowDown') { e.preventDefault(); activeIndex = Math.min(activeIndex + 1, Math.min(filtered.length, 200) - 1); render(); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); activeIndex = Math.max(activeIndex - 1, 0); render(); return; }
    if (e.key === 'Enter') { e.preventDefault(); const val = filtered[activeIndex]; if (val) pick(val); return; }
  });

  // İlk render
  render();
  setTimeout(()=> { input.focus(); input.select(); }, 0);
}

// ✅ Takip Formu: Çekici Plaka "Bul" ekranı (Firma/Malzeme Bul ile aynı UX)
// - Arama kutusu + liste + her satırda "GETİR" butonu
// - Login / Excel okuma tarafına dokunmaz
function _openPlatePick({ title='Çekici Plaka Seç', query='', options=[], onPick }) {
  // ✅ SECURITY: Use global escapeHtml function (XSS protection)

  const all = (options || []).filter(Boolean).map(x => String(x));
  const initial = String(query || '').trim();

  if (all.length === 0) { alert('❌ Kayıtlı çekici plaka bulunamadı.'); return; }

  const overlayId = 'quickPickOverlay_plate';
  const old = document.getElementById(overlayId);
  if (old) old.remove();

  const overlay = document.createElement('div');
  overlay.id = overlayId;
  overlay.style.cssText = [
    'position:fixed','inset:0','z-index:1000002','background:transparent',
    'display:flex','align-items:flex-start','justify-content:center','padding:16px','pointer-events:auto'
  ].join(';') + ';';

  const card = document.createElement('div');
  card.style.cssText = [
    'width:min(620px, 96vw)','margin-top:10vh','background:#fff','border:1px solid #e5e7eb',
    'border-radius:12px','box-shadow:0 10px 30px rgba(0,0,0,.18)','overflow:hidden'
  ].join(';') + ';';

  const header = document.createElement('div');
  header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border-bottom:1px solid #e5e7eb;';
  header.innerHTML = `<strong style="font-size:14px;">${escapeHtml(title || 'Çekici Plaka Seç')}</strong>`;

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.textContent = '✕';
  closeBtn.style.cssText = 'border:none;background:transparent;font-size:16px;cursor:pointer;opacity:.75;';
  closeBtn.onmouseenter = ()=> closeBtn.style.opacity = '1';
  closeBtn.onmouseleave = ()=> closeBtn.style.opacity = '.75';
  header.appendChild(closeBtn);

  const searchWrap = document.createElement('div');
  searchWrap.style.cssText = 'padding:10px 12px;border-bottom:1px solid #f3f4f6;';
  const input = document.createElement('input');
  input.type = 'text';
  input.value = initial;
  input.placeholder = 'Plaka ara... (06, 34ABC123 gibi)';
  input.className = 'form-input';
  input.style.cssText = 'width:100%;height:8mm;font-weight:bold;';
  searchWrap.appendChild(input);

  const listWrap = document.createElement('div');
  listWrap.style.cssText = 'max-height:55vh;overflow:auto;';

  const hint = document.createElement('div');
  hint.style.cssText = 'padding:8px 12px;color:#6b7280;font-size:12px;border-top:1px solid #f3f4f6;';
  hint.textContent = '↑↓ ile gez, Enter ile GETİR, Esc ile kapat';

  card.appendChild(header);
  card.appendChild(searchWrap);
  card.appendChild(listWrap);
  card.appendChild(hint);
  overlay.appendChild(card);
  document.body.appendChild(overlay);

  // ✅ Aday listelerini doldur (sevk yeri / ambalaj)
  try {
    const ambC = (candidates && Array.isArray(candidates.ambalaj)) ? candidates.ambalaj : [];
    const sevC = (candidates && Array.isArray(candidates.sevkYeri)) ? candidates.sevkYeri : [];

    const selAmb = card.querySelector('#xr_ambalajCand');
    const selSev = card.querySelector('#xr_sevkYeriCand');

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

    // seçilince inputu doldur
    if (selSev) selSev.addEventListener('change', () => {
      const v = selSev.value || '';
      if (v) {
        const inp = card.querySelector('#xr_sevkYeri');
        if (inp) inp.value = v;
      }
    });
    if (selAmb) selAmb.addEventListener('change', () => {
      const v = selAmb.value || '';
      if (v) {
        const inp = card.querySelector('#xr_ambalaj');
        if (inp) inp.value = v;
      }
    });
  } catch(e){}

  // ✅ Aynı Excel oturumunda hızlı doldurma: YD/Firma anahtarına göre
  try {
    const key = normalizeYdKey(ydKey || chosen?.ydKey || chosen?.firma || '');
    if (key) {
      if (!window.__quickDefaultsByKey) window.__quickDefaultsByKey = {};
      const d = window.__quickDefaultsByKey[key];
      if (d) {
        const sevInp = card.querySelector('#xr_sevkYeri');
        const ambInp = card.querySelector('#xr_ambalaj');
        if (sevInp && !String(sevInp.value||'').trim() && String(d.sevkYeri||'').trim()) sevInp.value = d.sevkYeri;
        if (ambInp && !String(ambInp.value||'').trim() && String(d.ambalaj||'').trim()) ambInp.value = d.ambalaj;
      }
    }
  } catch(e){}

  let filtered = [];
  let activeIndex = 0;

  const render = () => {
  const q = (input.value || '').trim().toLowerCase();

  // Arama değiştiyse: tekrar 20'ye dön + index sıfırla
  if (q !== state.lastQuery) {
    state.lastQuery = q;
    state.visibleCount = state.pageSize;
    activeIndex = 0;
  }

  filtered = q ? all.filter(x => x.toLowerCase().includes(q)) : all.slice();
  state.lastTotal = filtered.length;

  const btn = document.getElementById('showMoreButton');

  // 0 sonuç
  if (filtered.length === 0) {
    listWrap.innerHTML = `<div style="padding:12px;color:#6b7280;">Sonuç yok</div>`;
    activeIndex = 0;
    if (btn) btn.style.display = 'none';
    return;
  }

  // Gösterilecek kayıt sayısı (20,40,60... max toplam)
  const visible = filtered.slice(0, Math.min(state.visibleCount, filtered.length));

  // activeIndex görünür aralığın dışına taşmasın
  if (activeIndex >= visible.length) activeIndex = 0;

  listWrap.innerHTML = visible.map((val, i) => {
    const active = i === activeIndex ? 'background:#f3f4f6;' : '';
    return `<button type="button" data-idx="${i}" style="width:100%;text-align:left;padding:10px 12px;border:none;background:transparent;cursor:pointer;${active}">${escapeHtml(val)}</button>`;
  }).join('');

  // Buton: toplam 20'den fazlaysa göster, metin güncelle
  if (btn) {
    if (filtered.length <= state.pageSize) {
      btn.style.display = 'none';
    } else {
      btn.style.display = '';
      btn.textContent =
        (state.visibleCount >= filtered.length)
          ? 'Gizle'
          : `Devamını Göster (+${state.pageSize})`;
    }
  }
};

  const pick = (val) => {
    try { onPick(val); } catch(e) { console.error(e); }
    const el = document.getElementById(overlayId);
    if (el) el.remove();
  };

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });
  closeBtn.addEventListener('click', ()=> overlay.remove());

  listWrap.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-getir]');
    if (btn) {
      const i = parseInt(btn.getAttribute('data-getir'), 10);
      const val = (filtered || [])[i];
      if (val) pick(val);
      return;
    }
    const row = e.target.closest('div[data-idx]');
    if (!row) return;
    const i = parseInt(row.getAttribute('data-idx'), 10);
    const val = (filtered || [])[i];
    if (val) pick(val);
  });

  input.addEventListener('input', () => { activeIndex = 0; render(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { overlay.remove(); return; }
    if (!filtered || filtered.length === 0) return;

    if (e.key === 'ArrowDown') { e.preventDefault(); activeIndex = Math.min(activeIndex + 1, Math.min(filtered.length, 200) - 1); render(); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); activeIndex = Math.max(activeIndex - 1, 0); render(); return; }
    if (e.key === 'Enter') { e.preventDefault(); const val = filtered[activeIndex]; if (val) pick(val); return; }
  });

  render();
  setTimeout(()=> { input.focus(); input.select(); }, 0);
}
