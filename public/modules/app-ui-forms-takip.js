// app-ui-forms-takip.js — takip formu, sıra, ana render
// Otomatik bölüm — scripts/split-app-ui-forms-core.js

// ========== SIRAY SAYISI YÖNETIMI ==========
// API'den sıra sayısını çek ve ekranda göster
async function fetchQueueCount(basimYeri) {
  try {
    if (!basimYeri || !basimYeri.trim()) return null;
    
    const token = localStorage.getItem('authToken');
    const response = await fetch(`/api/reports/count?basimYeri=${encodeURIComponent(basimYeri)}`, {
      method: 'GET',
      cache: 'no-store',
      headers: {
        'Authorization': token ? `Bearer ${token}` : ''
      }
    });
    
    if (!response.ok) {
      console.warn('Queue count fetch failed:', response.status);
      return null;
    }
    
    const data = await response.json();
    return data.count ? parseInt(data.count) : 0;
  } catch (e) {
    console.error('❌ Sıra sayısı çekme hatası:', e);
    return null;
  }
}

// YÜKLEME SIRASI alanını güncelle
async function updateQueueDisplay(basimYeri) {
  const yuklemeInput = document.getElementById('yuklemeSirasi');
  if (!yuklemeInput) return;
  
  const count = await fetchQueueCount(basimYeri);
  if (count !== null) {
    yuklemeInput.value = String(count + 1); // Sıradaki sayı = mevcut sayı + 1
    yuklemeInput.style.color = '#000000';
    yuklemeInput.style.fontWeight = '700';
  }
}

function bindSahaSignaturePicker() {
  const input = document.getElementById('imzaSahaAd');
  if (!input) return;
  if (input.__sahaBound) {
    refreshSahaSignaturePreview();
    return;
  }
  input.__sahaBound = true;
  input.setAttribute('autocomplete', 'off');
  input.addEventListener('input', refreshSahaSignaturePreview);
  input.addEventListener('change', refreshSahaSignaturePreview);
  refreshSahaSignaturePreview();
}

function bindKantarSignaturePicker() {
  const input = document.getElementById('imzaKantarAd');
  if (!input) return;
  // Aynı input'a tekrar tekrar listener bağlamayalım
  if (input.__kantarBound) {
    // Form tekrar açıldıysa: kayıtlı kantarı uygula
    try {
      const saved = loadSavedKantarName();
      if (!(input.value || '').trim() && saved) input.value = saved;
    } catch (e) {}
    refreshKantarSignaturePreview();
    return;
  }
  input.__kantarBound = true;

  // Browserın eski otomatik doldurmasını bastıralım
  input.setAttribute('autocomplete', 'off');

  // Form ilk açıldığında kayıtlı kantarı otomatik getir
  try {
    const saved = loadSavedKantarName();
    if (!(input.value || '').trim() && saved) input.value = saved;
  } catch (e) {}

  const persistNow = () => {
    persistKantarName(input.value);
  };

  // Görsel önizleme + kalıcı kayıt
  input.addEventListener('input', () => {
    refreshKantarSignaturePreview();
    // ✅ Kullanıcı yazarken/ seçerken anında kaydet ("blur/change" kaçarsa da kaybolmasın)
    persistNow();
  });
  input.addEventListener('change', () => {
    refreshKantarSignaturePreview();
    persistNow();
  });
  input.addEventListener('blur', () => {
    persistNow();
  });

  refreshKantarSignaturePreview();
}

function showTakipFormu(vehicle) {
            const formContainer = document.getElementById('takipFormu');
            const _rawVehicle = vehicle || {};
            const _allowRememberedDefaults = !!_rawVehicle._reprintData;
            // Normal kart tıklamasında son yazdırılan takip alanlarını taşıma.
            vehicle = _allowRememberedDefaults
              ? _rawVehicle
              : {
                  ..._rawVehicle,
                  defaultFirma: '',
                  defaultMalzeme: '',
                  defaultSevkYeri: '',
                  defaultYuklemeNotu: ''
                };

            console.log('🔵 showTakipFormu çağrıldı - vehicle:', vehicle);
            console.log('🔵 vehicle._reprintData:', vehicle?._reprintData);
            
            // ✅ Raporlar / tekrar yazdır için aktif araç referansı
            try { window.__activeTakipVehicleId = vehicle && vehicle.id ? String(vehicle.id) : ''; } catch(e) {}
            try { window.__activeTakipVehiclePlate = (vehicle && vehicle.cekiciPlaka) ? String(vehicle.cekiciPlaka) : ''; } catch(e) {}
            try { window.__activeTakipVehicle = vehicle || null; } catch(e) {}

            // ✅ Reprint verileri varsa formu doldur (firma, malzeme, sevk yeri, kantar, basim yeri vb.)
            if (vehicle && vehicle._reprintData) {
              console.log('✅ Reprint verileri bulundu:', vehicle._reprintData);
              const rd = vehicle._reprintData;
              if (rd.firma) {
                state.formData.defaultFirma = rd.firma;
                vehicle.defaultFirma = rd.firma;
                console.log('✅ Firma atandı:', rd.firma);
              }
              if (rd.malzeme) {
                state.formData.defaultMalzeme = rd.malzeme;
                vehicle.defaultMalzeme = rd.malzeme;
                console.log('✅ Malzeme atandı:', rd.malzeme);
              }
              if (rd.sevkYeri) {
                state.formData.defaultSevkYeri = rd.sevkYeri;
                vehicle.defaultSevkYeri = rd.sevkYeri;
                console.log('✅ Sevk yeri atandı:', rd.sevkYeri);
              }
              if (rd.kantar) vehicle._kantarName = rd.kantar;
              if (rd.basimYeri) vehicle._basimYeri = rd.basimYeri;
              if (rd.ambalaj) vehicle._ambalaj = rd.ambalaj;
              if (rd.baskiNotu) {
                state.formData.defaultYuklemeNotu = rd.baskiNotu;
                vehicle.defaultYuklemeNotu = rd.baskiNotu;
              }
              // Geçici veriyi temizle (tekrar gösterilmesin)
              delete vehicle._reprintData;
            }

            console.log('🔵 Form render öncesi vehicle.defaultFirma:', vehicle?.defaultFirma);
            console.log('🔵 Form render öncesi vehicle.defaultMalzeme:', vehicle?.defaultMalzeme);
            console.log('🔵 Form render öncesi state.formData:', state.formData);

// ✅ Olası takılma: üstte kalan seçim overlay'leri inputları kilitlemesin
            try { document.getElementById('quickPickOverlay')?.remove(); } catch(_) {}
            try { const psb = document.getElementById('plateSearchBox'); if (psb) psb.style.display = 'none'; } catch(_) {}

            // ✅ Takip formu sıra no: ekranda öneri göster (sayacı artırmadan)
            function getLocalDateKey() {
                const d = new Date();
                const yyyy = d.getFullYear();
                const mm = String(d.getMonth() + 1).padStart(2, '0');
                const dd = String(d.getDate()).padStart(2, '0');
                return `${yyyy}-${mm}-${dd}`;
            }

            function getSuggestedYuklemeSirasi(basimYeri) {
                try {
                    const todayKey = getLocalDateKey();
                    const selectedBasim = String(
                      basimYeri ||
                      document.getElementById('basimYeri')?.value ||
                      ''
                    ).trim() || 'default';
                    const lastDate = localStorage.getItem(`yuklemeSirasiDate_${selectedBasim}`) || localStorage.getItem('yuklemeSirasiDate');
                    const counter = parseInt(
                      localStorage.getItem(`yuklemeSirasiCounter_${selectedBasim}`) || localStorage.getItem('yuklemeSirasiCounter') || '0',
                      10
                    );
                    if (lastDate !== todayKey) return 1;
                    return (Number.isFinite(counter) ? counter : 0) + 1;
                } catch (e) {
                    return 1;
                }
            }

            // ✅ Enter ile sonraki alana geç (takip formu içinde)
            function enableEnterNavigation(rootEl) {
                if (!rootEl || rootEl.__enterNavBound) return;
                rootEl.__enterNavBound = true;

                rootEl.addEventListener('keydown', function (e) {
                    if (e.key !== 'Enter') return;

                    const target = e.target;
                    if (!target) return;

                    const tag = (target.tagName || '').toLowerCase();
                    const isField = tag === 'input' || tag === 'select' || tag === 'textarea';
                    if (!isField) return;

                    // textarea'da yeni satır istenirse Ctrl+Enter
                    if (tag === 'textarea' && (e.ctrlKey || e.metaKey)) return;

                    e.preventDefault();

                    // Sadece form alanları (Yazdır/Önizleme/Kapat butonlarına Enter ile düşmesin)
                    const formScope = rootEl.querySelector('.takip-form') || rootEl;
                    const focusables = Array.from(formScope.querySelectorAll('input, select, textarea'))
                        .filter(el => !el.disabled && el.type !== 'hidden' && el.offsetParent !== null);

                    const idx = focusables.indexOf(target);
                    if (idx === -1) return;
                    const next = focusables[idx + 1] || focusables[0];
                    next.focus();
                }, true);
            }

            formContainer.innerHTML = `
            <div id="takipFormWarn" class="form-warn hidden"></div>

            <div class="takip-form">
                <h1 class="takip-form__doc-title">SEVKİYAT YÜKLEMESİ TAKİP FORMU</h1>
                <section class="takip-form__section highlight-section">
                  <h3 class="takip-form__section-title">Şoför Bilgileri</h3>
                  <div class="takip-form__driver-grid">
                    <div class="takip-form__field">
                      <label class="takip-form__label" for="soforBilgi">Şoför adı soyadı</label>
                      <div class="takip-form__control">
                        <input type="text" id="soforBilgi" class="form-input highlight-field"
                          value="${(vehicle.soforAdi || '') + (vehicle.soforSoyadi ? ' ' + vehicle.soforSoyadi : '')}"
                          placeholder="Şoför adı soyadı">
                      </div>
                    </div>
                    <div class="takip-form__field">
                      <label class="takip-form__label" for="yuklemeSirasi" title="Boş bırakılırsa yazdırmada otomatik atanır">Yükleme sırası</label>
                      <div class="takip-form__control">
                        <input readonly type="text" class="form-input" id="yuklemeSirasi" placeholder="Otomatik">
                      </div>
                    </div>
                    <div class="takip-form__field">
                      <label class="takip-form__label">Tarih</label>
                      <div class="takip-form__control">
                        <div class="takip-form__date-box" aria-readonly="true">${new Date().toLocaleDateString('tr-TR')}</div>
                      </div>
                    </div>
                    <div class="takip-form__field">
                      <label class="takip-form__label" for="tcBilgi">T.C. kimlik no</label>
                      <div class="takip-form__control">
                        <input type="text" id="tcBilgi" class="form-input highlight-field"
                          value="${vehicle.tcKimlik || ''}" placeholder="T.C. kimlik">
                      </div>
                    </div>
                    <div class="takip-form__field">
                      <label class="takip-form__label" for="cekiciPlakaBilgi">Çekici plaka</label>
                      <div class="takip-form__control">
                        <input type="text" id="cekiciPlakaBilgi" class="form-input highlight-field"
                          value="${vehicle.cekiciPlaka || ''}" placeholder="Çekici plaka">
                        <datalist id="plakaSuggestList"></datalist>
                        <div id="plateSearchBox" style="display:none;"></div>
                      </div>
                    </div>
                    <div class="takip-form__field">
                      <label class="takip-form__label" for="dorsePlakaBilgi">Dorse plaka</label>
                      <div class="takip-form__control">
                        <input type="text" id="dorsePlakaBilgi" class="form-input highlight-field"
                          value="${vehicle.dorsePlaka || ''}" placeholder="Dorse plaka">
                      </div>
                    </div>
                    <div class="takip-form__field">
                      <label class="takip-form__label" for="iletisimBilgi">İletişim</label>
                      <div class="takip-form__control">
                        <input type="text" id="iletisimBilgi" class="form-input highlight-field"
                          value="${formatTRPhone(vehicle.iletisim || '')}" placeholder="İletişim">
                      </div>
                    </div>
                    <div class="takip-form__field">
                      <label class="takip-form__label" for="seperatorBilgisi">Seperatör</label>
                      <div class="takip-form__control">
                        <input type="text" id="seperatorBilgisi" class="form-input">
                      </div>
                    </div>
                    <div class="takip-form__field">
                      <label class="takip-form__label" for="tonaj">Tonaj</label>
                      <div class="takip-form__control">
                        <input type="text" id="tonaj" class="form-input">
                      </div>
                    </div>
                    <div class="takip-form__field">
                      <label class="takip-form__label" for="sevkYeri">Sevk yeri</label>
                      <div class="takip-form__control">
                        <input type="text" id="sevkYeri" class="form-input" autocomplete="off" placeholder="Sevk yeri">
                      </div>
                    </div>
                    <div class="takip-form__field">
                      <label class="takip-form__label" for="ambalajBilgisi">Ambalaj</label>
                      <div class="takip-form__control">
                        <input type="text" id="ambalajBilgisi" class="form-input">
                      </div>
                    </div>
                    <div class="takip-form__field">
                      <label class="takip-form__label" for="basimYeri">Basım yeri</label>
                      <div class="takip-form__control">
                        <select id="basimYeri" class="form-input">
                          <option value="avdan">avdan</option>
                          <option value="1.OSB">1.OSB</option>
                        </select>
                      </div>
                    </div>
                  </div>
                </section>

                <table class="takip-form__table">
                        <tr>
                            <td class="takip-form__table-label">Firma / müşteri kodu</td>
                            <td class="takip-form__table-cell">
                                <select class="firma-select" id="firmaSelect">
                                    <option value="">Seçiniz veya elle yazın</option>
                                    ${firmaListesi.map(firma => `<option value="${getFirmaKodOnly(firma)}">${getFirmaKodOnly(firma)}</option>`).join('')}
                                </select>
                                <div class="takip-form__inline-row">
                                  <input type="text" class="form-input" id="firmaKodu" placeholder="Veya firma/müşteri kodu giriniz" autocomplete="off" value="${vehicle.defaultFirma || ''}">
                                  <button type="button" id="firmaAraBtn" class="takip-form__search-btn"><i class="fas fa-search"></i> Bul</button>
                                </div>
                            </td>
                        </tr>
                        <tr>
                            <td class="takip-form__table-label">Malzeme</td>
                            <td class="takip-form__table-cell">
                                <select class="malzeme-select" id="malzemeSelect">
                                    <option value="">Seçiniz veya elle yazın</option>
                                    ${malzemeListesi.map(malzeme => `<option value="${malzeme}">${malzeme}</option>`).join('')}
                                </select>
                                <div class="takip-form__inline-row">
                                  <input type="text" class="form-input" id="malzeme" placeholder="Veya malzeme bilgisi giriniz" autocomplete="off" value="${vehicle.defaultMalzeme || ''}">
                                  <button type="button" id="malzemeAraBtn" class="takip-form__search-btn"><i class="fas fa-search"></i> Bul</button>
                                </div>
                            </td>
                        </tr>
                        <tr>
                            <td class="takip-form__table-label">Ambalaj cinsi</td>
                            <td class="ambalaj-section takip-form__table-cell">
                                <div class="ambalaj-grid-head">
                                  <div>BBT</div><div>BOŞ BBT</div><div>ÇUVAL</div><div>BOŞ ÇUVAL</div><div>PALET</div><div>TORBA</div>
                                </div>
                                <div class="ambalaj-grid-inputs">
                                  <input type="text" id="bbt" class="form-input" placeholder="Miktar">
                                  <input type="text" id="bosBbt" class="form-input" placeholder="Miktar">
                                  <input type="text" id="cuval" class="form-input" placeholder="Miktar">
                                  <input type="text" id="bosCuval" class="form-input" placeholder="Miktar">
                                  <input type="text" id="palet" class="form-input" placeholder="Miktar">
                                  <input type="text" id="torba" class="form-input" placeholder="Miktar">
                                </div>
                            </td>
                        </tr>
                        <tr>
                            <td class="takip-form__table-label">Yükleme notu</td>
                            <td class="takip-form__table-cell">
                                <textarea class="form-input" id="yuklemeNotu" placeholder="Yükleme notu giriniz" rows="2"></textarea>
                            </td>
                        </tr>
                </table>

                <div class="takip-form__signatures">
                  <div class="signature-box">
                    <strong>Kantar</strong>
                    <div style="display:flex; gap:6px; align-items:center;">
                      <input id="imzaKantarAd" type="text" class="form-input" placeholder="İsim / İmza" list="kantarPersonelList" autocomplete="off" spellcheck="false" style="flex:1;">
                      <button id="imzaKantarBtn" type="button" title="Kantar seç" class="takip-form__picker-btn">▾</button>
                    </div>
                    <datalist id="kantarPersonelList"></datalist>
                    <div class="takip-form__sig-preview">
                      <img id="imzaKantarImg" alt="Kantar İmzası" style="max-width:100%; max-height:100%; display:none;">
                      <div id="imzaKantarPlaceholder" class="takip-form__sig-placeholder">İmza otomatik gelecek</div>
                    </div>
                  </div>
                  <div class="signature-box">
                    <strong>Sevkiyat saha</strong>
                    <input id="imzaSahaAd" type="text" class="form-input" placeholder="İsim / İmza" list="sahaPersonelList" autocomplete="off" spellcheck="false">
                    <datalist id="sahaPersonelList"></datalist>
                    <div class="takip-form__sig-preview">
                      <img id="imzaSahaImg" alt="Saha İmzası" style="max-width:100%; max-height:100%; display:none;">
                      <div id="imzaSahaPlaceholder" class="takip-form__sig-placeholder">İmza otomatik gelecek</div>
                    </div>
                  </div>
                  <div class="signature-box">
                    <strong>Yükleyen görevli</strong>
                    <input id="imzaYukleyenAd" type="text" class="form-input" placeholder="İsim / İmza">
                  </div>
                  <div class="signature-box">
                    <strong>Kalite kontrol</strong>
                    <input id="imzaKaliteAd" type="text" class="form-input" placeholder="İsim / İmza">
                  </div>
                </div>
            </div>


            `;


            try { populateSignatureDatalists(); } catch (e) { /* ignore */ }
            try { bindKantarSignaturePicker(); } catch(e) { console.warn('Kantar imza bağlama hatası', e); }
            try { bindSahaSignaturePicker(); } catch(e) { console.warn('Saha imza bağlama hatası', e); }

            // Kantar picker: show overlay list when user clicks arrow button or presses ArrowDown
            try {
              const kantarBtn = document.getElementById('imzaKantarBtn');
              const kantarInput = document.getElementById('imzaKantarAd');

              async function openKantarPicker() {
                try {
                  if (window.SignatureRegistry && typeof window.SignatureRegistry.loadSignatures === 'function') {
                    await window.SignatureRegistry.loadSignatures();
                    populateSignatureDatalists();
                  }
                } catch (_) {}

                const kantarDatalist = getKantarPersonelNames();

                try {
                  const overlayId = 'kantarPickerOverlay';
                  const old = document.getElementById(overlayId);
                  if (old) old.remove();

                  const overlay = document.createElement('div');
                  overlay.id = overlayId;
                  overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483646;background:rgba(0,0,0,.25);display:flex;align-items:flex-start;justify-content:center;padding:16px;';

                  const card = document.createElement('div');
                  card.style.cssText = 'width:min(420px,96vw);margin-top:12vh;background:#fff;border:1px solid #e5e7eb;border-radius:10px;box-shadow:0 12px 30px rgba(0,0,0,.22);overflow:auto;max-height:60vh;padding:8px;';

                  const title = document.createElement('div');
                  title.textContent = 'İmza seç — Kantar';
                  title.style.cssText = 'font-weight:800;font-size:14px;padding:8px 10px 4px;border-bottom:1px solid #eee;margin-bottom:4px;';
                  card.appendChild(title);

                  const list = document.createElement('div');
                  list.style.cssText = 'display:flex;flex-direction:column;gap:6px;padding:8px;';

                  const filterVal = (kantarInput && kantarInput.value) ? String(kantarInput.value).trim().toUpperCase() : '';

                  if (!kantarDatalist.length) {
                    const empty = document.createElement('div');
                    empty.textContent = 'Kantar personeli bulunamadı. Ayarlar → İmza ayarlarından ekleyin.';
                    empty.style.cssText = 'padding:10px;color:#666;font-size:13px;';
                    list.appendChild(empty);
                  }

                  kantarDatalist.forEach(name => {
                    const item = document.createElement('button');
                    item.type = 'button';
                    item.textContent = name;
                    item.style.cssText = 'text-align:left;padding:8px 10px;border-radius:8px;border:none;background:transparent;cursor:pointer;font-weight:600;';
                    if (filterVal && !name.toUpperCase().includes(filterVal)) {
                      item.style.opacity = '0.6';
                    }
                    item.addEventListener('click', () => {
                      try {
                        if (kantarInput) kantarInput.value = name;
                        try { refreshKantarSignaturePreview(); } catch (e) {}
                        try { persistKantarName(name); } catch (e) {}
                        overlay.remove();
                      } catch (e) {}
                    });
                    list.appendChild(item);
                  });

                  card.appendChild(list);
                  overlay.appendChild(card);
                  overlay.addEventListener('click', (ev)=>{ if (ev.target === overlay) overlay.remove(); });
                  document.body.appendChild(overlay);
                } catch (e) { console.warn('kantar picker hata', e); }
              }

              if (kantarBtn) {
                kantarBtn.addEventListener('click', (e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  openKantarPicker();
                });
              }
              if (kantarInput) {
                kantarInput.addEventListener('keydown', (e)=>{
                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    openKantarPicker();
                  }
                });
              }
            } catch (e) { console.warn('kantar picker bağlama hata', e); }


            // 🔁 Şoför Sorunları butonunu başlıktaki (Yazdır/Önizleme/Kapat) buton grubuna taşı
            try {
              // Eğer buton yoksa oluştur
              let issuesBtn = document.getElementById('takipIssuesBtn');
              if (!issuesBtn) {
                issuesBtn = document.createElement('button');
                issuesBtn.id = 'takipIssuesBtn';
                issuesBtn.type = 'button';
                issuesBtn.className = 'takip-modal__btn takip-modal__btn--issues';
                issuesBtn.innerHTML = '<i class="fas fa-exclamation-triangle" aria-hidden="true"></i> Şoför Sorunları (<span id="takipIssuesCnt">0</span>)';
              }
              const headerBtnRow = document.getElementById('yazdirButton')?.parentElement;
              const kapatBtn = document.getElementById('kapatButton');
              if (headerBtnRow) {
                // Kapat'ın hemen soluna yerleştir
                if (kapatBtn && kapatBtn.parentElement === headerBtnRow) {
                  headerBtnRow.insertBefore(issuesBtn, kapatBtn);
                } else {
                  headerBtnRow.appendChild(issuesBtn);
                }
              }
            } catch(e) {}



            // ⚠️ Takip Formu: Şoför Sorunları butonu
            try {
              const cnt = getIssueCount(vehicle.cekiciPlaka);
              const cntEl = document.getElementById('takipIssuesCnt');
              if (cntEl) cntEl.textContent = String(cnt);
              const btn = document.getElementById('takipIssuesBtn');
              if (btn) {
                btn.classList.toggle('takip-modal__btn--issues-active', cnt > 0);
                addOnce(btn,'click',()=> openIssuesModal(vehicle.cekiciPlaka));
              }
            } catch(e){}

            // ✅ Takip Formu: Plaka/Dorse otomatik doldur (format) ama sonradan manuel düzeltilebilir
            // - Kullanıcı yazdıkça plaka formatı uygulanır.
            try {
              const pEl = document.getElementById('cekiciPlakaBilgi');
              const dEl = document.getElementById('dorsePlakaBilgi');

              const onTakipPlateFieldInput = () => {
                try { _ihracatSyncVehiclePlatesFromTakipForm(); } catch (_) {}
              };

              if (pEl) {
                addOnce(pEl, 'input', () => {
                  try { pEl.value = formatPlakaForInput(pEl.value); } catch(_) {}
                  onTakipPlateFieldInput();
                });
                // açılışta da formatla
                try { pEl.value = formatPlakaForInput(pEl.value); } catch(_) {}
              }

              if (dEl) {
                addOnce(dEl, 'input', () => {
                  try { dEl.value = formatPlakaForInput(dEl.value); } catch(_) {}
                  onTakipPlateFieldInput();
                });
                try { dEl.value = formatPlakaForInput(dEl.value); } catch(_) {}
              }
              // Basım yeri: yükleme sırasında seçilen değer kaydedilsin
              try {
                const basimEl = document.getElementById('basimYeri');
                if (basimEl) {
                  addOnce(basimEl, 'change', () => { 
                    try { 
                      persistBasimYeri(basimEl.value);
                      // ✅ Basım yeri değişince sıra sayısını güncelle
                      updateQueueDisplay(basimEl.value);
                    } catch(e){} 
                  });
                  const savedBasim = loadSavedBasimYeri();
                  if (savedBasim) try { basimEl.value = savedBasim; } catch(e) {}
                  // ✅ Form açıldığında da sıra sayısını göster
                  if (basimEl.value) updateQueueDisplay(basimEl.value);
                }
              } catch(e){}

              // ✅ Sevk Yeri: Yazı uzunluğuna göre otomatik boyutlandır
              try {
                const sevkEl = document.getElementById('sevkYeri');
                if (sevkEl) {
                  addOnce(sevkEl, 'input', () => {
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
              } catch(e){}
            } catch(e){}

            // ✅ Takip Formu: Çekici plaka prefix araması (ör: 06...) + plaka bazlı şoför görünümü
            // - Login/Excel tarafına dokunmaz. Sadece takip formu içinde arama kolaylığı sağlar.
            try {
              const plateEl = document.getElementById('cekiciPlakaBilgi');
              const boxEl   = document.getElementById('plateSearchBox');
              const dlEl    = document.getElementById('plakaSuggestList');
              const bulBtn  = document.getElementById('plakaBulBtn');

              const nameEl = document.getElementById('soforBilgi');
              const tcEl   = document.getElementById('tcBilgi');
              const telEl  = document.getElementById('iletisimBilgi');

              const plateKey = (s) => String(s || '').toUpperCase().replace(/\s+/g,'').trim();

              const uniq = (arr) => {
                const seen = new Set(); const out = [];
                (arr || []).forEach(x => {
                  const k = plateKey(x);
                  if (!k || seen.has(k)) return;
                  seen.add(k); out.push(x);
                });
                return out;
              };

              const getAllPlates = () => {
                const plates = (state.vehicles || []).map(v => v && v.cekiciPlaka).filter(Boolean);
                return uniq(plates);
              };

              const getMatches = (prefix) => {
                const p = plateKey(prefix);
                if (!p) return [];
                return getAllPlates()
                  .filter(pl => plateKey(pl).startsWith(p))
                  .slice(0, 30);
              };

const getVehiclesByPlate = (plate) => {
  const p = plateKey(plate);
  return (state.vehicles || []).filter(v => plateKey(v?.cekiciPlaka) === p);
};

// Geriye uyumluluk: ilk kaydı döndürür
const getVehicleByPlate = (plate) => {
  const list = getVehiclesByPlate(plate);
  return (list && list.length) ? list[0] : null;
};

// ✅ Aynı plaka birden fazla kişi/araç kaydında varsa seçim ver
const openDriverPickForSamePlate = (plate, matches, onPick) => {
  try {
    const overlayId = 'driverPickOverlay';
    const old = document.getElementById(overlayId);
    if (old) old.remove();

    // ✅ SECURITY: Use global escapeHtml function (XSS protection)


    const overlay = document.createElement('div');
    overlay.id = overlayId;
    overlay.style.cssText = [
      'position:fixed','inset:0','z-index:1000003','background:rgba(0,0,0,.25)',
      'display:flex','align-items:flex-start','justify-content:center','padding:16px'
    ].join(';') + ';';

    const card = document.createElement('div');
    card.style.cssText = [
      'width:min(620px, 96vw)','margin-top:10vh','background:#fff','border:1px solid #e5e7eb',
      'border-radius:12px','box-shadow:0 10px 30px rgba(0,0,0,.22)','overflow:hidden'
    ].join(';') + ';';

    const header = document.createElement('div');
    header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border-bottom:1px solid #e5e7eb;';
    header.innerHTML = `<strong style="font-size:14px;">${escapeHtml(plate)} plakası birden fazla kayıtta var — seçim yap</strong>`;

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.textContent = '✕';
    closeBtn.style.cssText = 'border:none;background:transparent;font-size:16px;cursor:pointer;opacity:.75;';
    closeBtn.onclick = ()=> overlay.remove();
    header.appendChild(closeBtn);

    const list = document.createElement('div');
    list.style.cssText = 'max-height:55vh;overflow:auto;';

    const rows = (matches || []).map((v, i) => {
      const name = ((v?.soforAdi || '') + (v?.soforSoyadi ? ' ' + v.soforSoyadi : '')).trim() || 'İsimsiz';
      const tc = String(v?.tcKimlik || '').trim();
      const tel = String(v?.iletisim || '').trim();
      const right = [tc && ('TC: ' + tc), tel && ('Tel: ' + tel)].filter(Boolean).join(' • ');
      return `
        <button type="button" data-idx="${i}"
          style="width:100%;text-align:left;padding:10px 12px;border:none;background:transparent;cursor:pointer;border-bottom:1px solid #f3f4f6;">
          <div style="display:flex;justify-content:space-between;gap:10px;align-items:center;">
            <div style="display:flex;flex-direction:column;gap:2px;min-width:0;">
              <strong style="font-size:13px;">${escapeHtml(name)}</strong>
              <span style="color:#6b7280;font-size:11px;">${escapeHtml(right || '')}</span>
            </div>
            <span style="background:#111827;color:#fff;border-radius:10px;padding:6px 10px;font-weight:800;">GETİR</span>
          </div>
        </button>
      `;
    }).join('');

    list.innerHTML = rows || `<div style="padding:12px;color:#6b7280;">Kayıt bulunamadı</div>`;

    card.appendChild(header);
    card.appendChild(list);
    overlay.appendChild(card);
    document.body.appendChild(overlay);

    overlay.addEventListener('click', (e)=>{ if (e.target === overlay) overlay.remove(); });

    list.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-idx]');
      if (!btn) return;
      const idx = parseInt(btn.getAttribute('data-idx'), 10);
      const chosen = (matches || [])[idx];
      if (chosen) {
        try { onPick(chosen); } catch(_) {}
        overlay.remove();
      }
    });
  } catch(e) {
    // fallback: ilk kaydı al
    try { onPick(matches?.[0] || null); } catch(_) {}
  }
};

const applyDriverForPlate = (plate) => {
  const p = String(plate || '').trim();
  if (!p) return;

  // 1) Öncelik: araç kayıtları (aynı plaka birden fazla kayıtsa SEÇTİR)
  try {
    const matches = getVehiclesByPlate(p) || [];
    if (matches.length > 1) {
      // geçmişte seçilen şoförü (varsa) liste başına al
      try {
        const hist = soforHistoryStorage.list(p) || [];
        const h = hist[0] || null;
        if (h) {
          const hName = String(h.name || '').trim().toUpperCase();
          const hTc = String(h.tc || '').trim();
          const hPhone = String(h.phone || '').trim();

          matches.sort((a,b) => {
            const aName = (((a?.soforAdi||'') + (a?.soforSoyadi?(' '+a.soforSoyadi):'')).trim()).toUpperCase();
            const bName = (((b?.soforAdi||'') + (b?.soforSoyadi?(' '+b.soforSoyadi):'')).trim()).toUpperCase();
            const aTc = String(a?.tcKimlik || '').trim();
            const bTc = String(b?.tcKimlik || '').trim();
            const aPh = String(a?.iletisim || '').trim();
            const bPh = String(b?.iletisim || '').trim();

            const aHit = (hTc && aTc === hTc) || (hPhone && aPh === hPhone) || (hName && aName === hName);
            const bHit = (hTc && bTc === hTc) || (hPhone && bPh === hPhone) || (hName && bName === hName);
            return (bHit?1:0) - (aHit?1:0);
          });
        }
      } catch(_) {}

      openDriverPickForSamePlate(p, matches, (v) => {
        if (!v) return;
        const n1 = ((v.soforAdi || '') + (v.soforSoyadi ? ' ' + v.soforSoyadi : '')).trim();
        if (nameEl) nameEl.value = n1 || '';
        if (tcEl) tcEl.value = v.tcKimlik || '';
        if (telEl) telEl.value = formatTRPhone(v.iletisim || '');

        // seçimi geçmişe yaz (sonraki sefer otomatik gelsin)
        try {
          soforHistoryStorage.add(p, { name: n1, tc: String(v.tcKimlik||'').trim(), phone: String(v.iletisim||'').trim() });
        } catch(_) {}
      });
      return;
    }

    if (matches.length === 1) {
      const v = matches[0];

      // geçmiş varsa (tek kayıtta bile) otomatik doldurabilir
      try {
        const hist = soforHistoryStorage.list(p) || [];
        const d = hist[0];
        if (d) {
          if (nameEl) nameEl.value = d.name || '';
          if (tcEl) tcEl.value = d.tc || '';
          if (telEl) telEl.value = formatTRPhone(d.phone || '');
          return;
        }
      } catch(_) {}

      const n1 = ((v.soforAdi || '') + (v.soforSoyadi ? ' ' + v.soforSoyadi : '')).trim();
      if (nameEl) nameEl.value = n1 || '';
      if (tcEl) tcEl.value = v.tcKimlik || '';
      if (telEl) telEl.value = formatTRPhone(v.iletisim || '');
      return;
    }
  } catch(e) {}

  // 2) Araç kaydı yoksa: geçmişten doldur
  try {
    const hist = soforHistoryStorage.list(p) || [];
    const d = hist[0];
    if (d) {
      if (nameEl) nameEl.value = d.name || '';
      if (tcEl) tcEl.value = d.tc || '';
      if (telEl) telEl.value = formatTRPhone(d.phone || '');
      return;
    }
  } catch(e) {}
};

              const getDriversForPlate = (plate) => {
                const list = [];
                // 1) geçmişten (2 kişi)
                try {
                  const hist = soforHistoryStorage.list(plate) || [];
                  hist.slice(0, 2).forEach(d => {
                    const label = [d.name, d.phone].filter(Boolean).join(' • ');
                    if (label) list.push(label);
                  });
                } catch(e) {}

                // 2) araç kaydından (2 şoför alanı)
                if (list.length === 0) {
                  try {
                    const v = getVehicleByPlate(plate);
                    if (v) {
                      const n1 = ((v.soforAdi || '') + ' ' + (v.soforSoyadi || '')).trim();
                      const n2 = ((v.sofor2Adi || '') + ' ' + (v.sofor2Soyadi || '')).trim();
                      [n1, n2].filter(Boolean).forEach(n => list.push(n));
                    }
                  } catch(e) {}
                }

                return list.slice(0, 2);
              };

              const hideBox = () => {
                if (!boxEl) return;
                boxEl.style.display = 'none';
                boxEl.innerHTML = '';
              };

              const positionBox = () => {
                if (!plateEl || !boxEl) return;
                try {
                  const r = plateEl.getBoundingClientRect();
                  boxEl.style.position = 'fixed';
                  boxEl.style.left = Math.round(r.left) + 'px';
                  boxEl.style.top  = Math.round(r.bottom + 4) + 'px';
                  boxEl.style.width = Math.round(r.width) + 'px';
                  boxEl.style.zIndex = '2147483647';
                } catch(e) {}
              };

              const pickPlate = (p) => {
                if (!plateEl) return;
                plateEl.value = formatPlakaForInput(p);

                // ✅ DORSE PLAKA otomatik doldur (plaka seçildiğinde)
                try {
                  const v = getVehicleByPlate(p);
                  const dEl = document.getElementById('dorsePlakaBilgi');
                  if (dEl) {
                    const rawDorse = v?.dorsePlaka || v?.dorsePlakaBilgi || v?.dorse_plaka || v?.dorse || '';
                    dEl.value = formatPlakaForInput(String(rawDorse || ''));
                    try { dEl.dispatchEvent(new Event('input', { bubbles:true })); } catch(_) {}
                    try { dEl.dispatchEvent(new Event('change', { bubbles:true })); } catch(_) {}
                  }
                } catch(_) {}

                // şoför alanlarını doldur
                applyDriverForPlate(p);

                // mevcut şoför dropdown'unu refresh etsin
                try { plateEl.dispatchEvent(new Event('change', { bubbles:true })); } catch(e) {}

                hideBox();
                try { plateEl.focus(); } catch(e) {}
              };

              const renderBox = (prefix) => {
                if (!plateEl || !boxEl || !dlEl) return;

                const matches = getMatches(prefix);

                // datalist (tarayıcı önerisi)
                dlEl.innerHTML = matches.map(p => `<option value="${p}"></option>`).join('');

                // 2 karakterden kısa ise kutu açma
                const pfx = plateKey(prefix);
                if (!pfx || pfx.length < 2) { hideBox(); return; }

                const rows = matches.slice(0, 10).map(p => {
                  const drivers = getDriversForPlate(p);
                  const right = drivers.length ? `<span style="color:#6b7280; font-size:10pt;">${drivers.join(' / ')}</span>` : '';
                  return `
                    <button type="button" class="w-full text-left px-3 py-2 hover:bg-gray-100" data-plate="${encodeURIComponent(p)}">
                      <div style="display:flex; justify-content:space-between; gap:10px;">
                        <strong>${p}</strong>
                        ${right}
                      </div>
                    </button>
                  `;
                }).join('');

                if (!rows) { hideBox(); return; }

                boxEl.innerHTML = rows;
                positionBox();
                boxEl.style.display = 'block';
              };

              // seçim (tıklama)
              if (boxEl) {
                addOnce(boxEl, 'mousedown', (ev) => {
                  // blur olmadan seçebilmek için mousedown
                  const btn = ev.target?.closest?.('button[data-plate]');
                  if (!btn) return;
                  ev.preventDefault();
                  const p = decodeURIComponent(btn.getAttribute('data-plate') || '');
                  if (p) pickPlate(p);
                });
              }

              // input/odak/blur
              if (plateEl) {
                addOnce(plateEl, 'input', () => renderBox(plateEl.value));
                addOnce(plateEl, 'focus', () => renderBox(plateEl.value));
                addOnce(plateEl, 'blur',  () => setTimeout(hideBox, 180));

                // ✅ ENTER: Firma/Malzeme gibi "Bul" ekranını aç
                addOnce(plateEl, 'keydown', (ev) => {
                  if (ev.key !== 'Enter') return;
                  ev.preventDefault();
                  try { bulBtn?.click(); } catch(_) {}
                });
              }

              // Bul butonu
              if (bulBtn) {
                addOnce(bulBtn, 'click', () => {
                  if (!plateEl) return;
                  // ✅ Firma/Malzeme Bul gibi: ayrı seçim ekranı aç
                  try {
                    const opts = getAllPlates();
                    _openPlatePick({
                      title: 'Çekici Plaka Seç',
                      query: (plateEl.value || ''),
                      options: opts,
                      onPick: (val)=>{ if (val) pickPlate(val); }
                    });
                  } catch(e) {
                    // fallback: eski inline kutu
                    renderBox(plateEl.value);
                    plateEl.focus();
                  }
                });
              }

              // pencere/scroll değişince kutuyu güncelle
              addOnce(window, 'resize', positionBox);
              addOnce(window, 'scroll', positionBox, true);

            } catch(e) {}

            // Malzeme seçimi event listener
            const malzemeSelect = document.getElementById('malzemeSelect');
            const malzemeInput = document.getElementById('malzeme');
            
            if (malzemeSelect && malzemeInput) {
                addOnce(malzemeSelect, 'change', function() {
                    if (this.value) {
                        malzemeInput.value = this.value;
                    }
                });
                
                addOnce(malzemeInput, 'input', function() {
                    if (this.value) {
                        malzemeSelect.value = '';
                    }
                });
            }

            // Firma seçimi event listener - ✅ PROMPT YOK: Çoklu malzeme varsa dropdown ile seçilecek
const firmaSelect = document.getElementById('firmaSelect');
const firmaInput  = document.getElementById('firmaKodu');

const malzemeInput2  = document.getElementById('malzeme');
const malzemeSelect2 = document.getElementById('malzemeSelect');
const ambalajInput   = document.getElementById('ambalajBilgisi');
const notTextarea    = document.getElementById('yuklemeNotu');

// 🔧 Global ref: takip formundaki sevkYeri input'u (showTakipFormu içinde set edilir)
let sevkYeriInput = null;

// Malzeme dropdown'u "tam liste"ye döndürmek için
const buildFullMalzemeOptionsHTML = () => {
  // ✅ SECURITY: Escape malzeme values (XSS protection)
  return `<option value="">Seçiniz veya elle yazın</option>` + (malzemeListesi || [])
    .map(m => `<option value="${escapeAttr(m)}">${escapeHtml(m)}</option>`).join('');
};

let currentFirmaMatches = [];

const applyMatch = (es) => {
  if (!es) return;
  if (malzemeInput2)  malzemeInput2.value = es.malzeme || '';
  if (malzemeSelect2) malzemeSelect2.value = es.malzeme || '';
  if (ambalajInput)   ambalajInput.value = es.ambalajBilgisi || '';
  if (notTextarea)    notTextarea.value = es.yuklemeNotu || '';
  if (sevkYeriInput)  sevkYeriInput.value = es.sevkYeri || '';
};

const resetMatchFields = () => {
  if (malzemeInput2)  malzemeInput2.value = '';
  if (ambalajInput)   ambalajInput.value = '';
  if (notTextarea)    notTextarea.value = '';
  if (sevkYeriInput)  sevkYeriInput.value = '';
};

// Firmaya göre eşleşme uygula (PROMPT YOK)
const handleFirma = (firma) => {
  if (window.__piyasaApplyingOrder) return;
  const f = (firma || '').trim();
  currentFirmaMatches = (f && eslestirmeStorage.getByFirma) ? (eslestirmeStorage.getByFirma(f) || []) : [];

  if (!malzemeSelect2) return;

  // Eşleşme yoksa: malzeme dropdown'u full listeye dönsün, alanları otomatik doldurma
  if (currentFirmaMatches.length === 0) {
    malzemeSelect2.innerHTML = buildFullMalzemeOptionsHTML();
    return;
  }

  // Eşleşme varsa: dropdown'u sadece o firmaya ait malzemelerle doldur
  malzemeSelect2.innerHTML =
    `<option value="">Malzeme Seçiniz</option>` +
    currentFirmaMatches.map(es => `<option value="${es.malzeme}">${es.malzeme}</option>`).join('');

  // Tek eşleşme varsa otomatik uygula
  if (currentFirmaMatches.length === 1) {
    applyMatch(currentFirmaMatches[0]);
  } else {
    // Çokluysa kullanıcı dropdown'dan seçsin
    resetMatchFields();
  }
};

if (firmaSelect && firmaInput) {
  firmaSelect.addEventListener('change', function () {
    const val = this.value || '';
    firmaInput.value = val;
    handleFirma(val);
  });

  firmaInput.addEventListener('input', function () {
    const val = (this.value || '').trim();
    firmaSelect.value = '';
    handleFirma(val);
  });
}

// Malzeme seçilince eşleşme varsa otomatik uygula
if (malzemeSelect2) {
  malzemeSelect2.addEventListener('change', function () {
    const secilen = this.value || '';

    // Normal davranış: dropdown seçimini input'a yaz
    if (malzemeInput2 && secilen) malzemeInput2.value = secilen;

    if (!secilen || currentFirmaMatches.length === 0) return;

    const es = currentFirmaMatches.find(e => (e.malzeme || '') === secilen);
    if (es) applyMatch(es);
  });
}



try {
  const firmaAraBtn = document.getElementById('firmaAraBtn');
  const malzemeAraBtn = document.getElementById('malzemeAraBtn');

  const firmaKoduEl = document.getElementById('firmaKodu');
  const malzemeEl = document.getElementById('malzeme');

  if (firmaAraBtn) addOnce(firmaAraBtn, 'click', ()=>{
    // PİYASA yüklüyse: firma seçmek yerine sipariş listesi aç
    try {
      if (window.piyasa && typeof window.piyasa.hasOrders === 'function' && window.piyasa.hasOrders()) {
        const q = (document.getElementById('firmaKodu')?.value || '').trim();
        window.piyasa.openOrderPicker({ searchAllSheets: true, initialQuery: q });
        return;
      }
    } catch(_) {}
    const q = (document.getElementById('firmaKodu')?.value || '').trim();
    const opts = (firmaListesi || []).map(f => getFirmaKodOnly(f)).filter(Boolean);
    _openQuickPick({
      title: 'Firma/Müşteri Kodu Seç',
      query: q,
      options: opts,
      onPick: (val)=>{
        if (firmaInput) { firmaInput.value = val; handleFirma(val); }
        if (firmaSelect) firmaSelect.value = '';
      }
    });
  });

  if (malzemeAraBtn) addOnce(malzemeAraBtn, 'click', ()=>{
    try {
      if (window.piyasa && typeof window.piyasa.hasOrders === 'function' && window.piyasa.hasOrders()) {
        const q = (document.getElementById('malzeme')?.value || '').trim();
        window.piyasa.openOrderPicker({ searchAllSheets: true, initialQuery: q });
        return;
      }
    } catch (_) {}
    const q = (document.getElementById('malzeme')?.value || '').trim();
    const opts = (malzemeListesi || []).slice();
    _openQuickPick({
      title: 'Malzeme Seç',
      query: q,
      options: opts,
      onPick: (val)=>{
        if (malzemeInput2) malzemeInput2.value = val;
        if (malzemeSelect2) malzemeSelect2.value = val;
        // Eşleşme uygula (varsa)
        if (currentFirmaMatches && currentFirmaMatches.length) {
          const es = currentFirmaMatches.find(e => (e.malzeme || '') === val);
          if (es) applyMatch(es);
        }
      }
    });
  });

  // ⌨️ Enter ile "Bul" çalıştır (HP yaz -> Enter)
  if (firmaKoduEl) addOnce(firmaKoduEl, 'keydown', (e)=>{ if (e.key === 'Enter') { e.preventDefault(); firmaAraBtn?.click(); } });
  if (malzemeEl) addOnce(malzemeEl, 'keydown', (e)=>{ if (e.key === 'Enter') { e.preventDefault(); malzemeAraBtn?.click(); } });

} catch(e){}


            // Modal'ı göster
            // ⛔ Datalist önerileri kapatıldı (siyah öneri kutusu çıkmasın)
            // ✅ Kullanıcı seçim/yazım yaptıkça hafızaya al (rahatsız etmez)
            const firmaKoduInput = document.getElementById('firmaKodu');
            const malzemeInput3 = document.getElementById('malzeme');
            sevkYeriInput = document.getElementById('sevkYeri');

            // ✅ İSTEK: Takip formu her açılışta BOŞ (Excel okuma doldurur).
            try { resetTakipFormUI(); } catch (e) {}

            // ✅ İSTEK: Takip formu BUTONUNA basınca YÜKLEME SIRASI boş gelmesin.
            // Burada sadece ekranda gösterilecek değer atanır; sayaç/arttırma yapılmaz.
            try {
              const ysEl = document.getElementById('yuklemeSirasi');
              if (ysEl && !(ysEl.value || '').trim()) {
                ysEl.value = String(getSuggestedYuklemeSirasi(document.getElementById('basimYeri')?.value || ''));
              }
              // ✅ Stil garantisi: siyah renk sorunu yok
              if (ysEl) {
                ysEl.style.color = '#e74c3c';
                ysEl.style.fontWeight = 'bold';
                ysEl.style.backgroundColor = '#ffffff';
              }
            } catch(e) {}

            // ✅ BASIM YERİ otomatik seçilsin → updateQueueDisplay() çağrılsın
            try {
              const basimEl = document.getElementById('basimYeri');
              if (basimEl && !String(basimEl.value || '').trim()) {
                const savedBasim = loadSavedBasimYeri() || 'avdan';
                basimEl.value = savedBasim;
                persistBasimYeri(savedBasim);
                // Otomatik seçildi mi hemen sıra sayısını çek
                console.log('✅ Basım Yeri otomatik seçildi:', savedBasim);
                updateQueueDisplay(savedBasim);
              } else if (basimEl && String(basimEl.value || '').trim()) {
                // Zaten seçili ise, sıra sayısını güncelle
                updateQueueDisplay(basimEl.value);
              }
            } catch(e) { console.warn('⚠️ Basım Yeri auto-select hatası:', e); }

            // ✅ Enter ile alanlar arasında dolaş
            enableEnterNavigation(document.getElementById('takipFormuModal') || formContainer);

            document.getElementById('takipFormuModal').classList.remove('hidden');

            // ✅ A4/A5 sayfa boyutu seçim butonları
            const btnA5 = document.getElementById('btnPageSizeA5');
            const btnA4 = document.getElementById('btnPageSizeA4');
            
            // localStorage'dan kayıtlı seçimi yükle
            const savedPageSize = localStorage.getItem('selectedPageSize') || 'A5';
            
            // Başlangıç rengi ayarla
            const updatePageSizeDisplay = (size) => {
              btnA5?.classList.toggle('is-active', size === 'A5');
              btnA4?.classList.toggle('is-active', size === 'A4');
            };
            updatePageSizeDisplay(savedPageSize);

            if (btnA5) {
              btnA5.addEventListener('click', (e) => {
                e.preventDefault();
                localStorage.setItem('selectedPageSize', 'A5');
                updatePageSizeDisplay('A5');
              });
            }
            if (btnA4) {
              btnA4.addEventListener('click', (e) => {
                e.preventDefault();
                localStorage.setItem('selectedPageSize', 'A4');
                updatePageSizeDisplay('A4');
              });
            }


            // ✅ İlk odağı ver: bazen odak kaçıp yazı yazmıyor gibi görünebiliyor
            setTimeout(()=>{ try { document.getElementById('soforBilgi')?.focus(); } catch(_) {} }, 0);

            // 📄 Günlük Excel varsa otomatik doldur (plaka eşleşmesi)
            let takipApplyOpts = null;
            try {
              if (vehicle && vehicle._ihracatTakipApplyOpts) {
                takipApplyOpts = { ...vehicle._ihracatTakipApplyOpts };
                delete vehicle._ihracatTakipApplyOpts;
              }
            } catch (e) {}
            try {
              applyShipmentToTakipForm(vehicle, takipApplyOpts);
            } catch (e) {}

            // ✅ Araç varsayılan bilgilerini (ve reprint bilgilerini) doldur
            try { applyVehicleDefaultsToTakipForm(vehicle); } catch(e) {}

}

        // Takip Formunu Kapat
        function kapatForm() {
            try { document.getElementById('quickPickOverlay')?.remove(); } catch(_) {}
            try { const psb = document.getElementById('plateSearchBox'); if (psb) { psb.style.display = 'none'; psb.innerHTML=''; } } catch(_) {}
            const takipModal = document.getElementById('takipFormuModal');
            if (takipModal) {
              takipModal.classList.add('hidden');
              takipModal.style.zIndex = '';
            }
            try {
              window._ihracatRestoreParkedDetailsModal?.();
            } catch (_) {}
            clearActiveTakipVehicleRefs();
        }

        // ✅ Make local functions available to global button handlers
        window.__kapatForm = kapatForm;

        // =========================
        // ✅ Takip Formu: zorunlu alan kontrolü + yazdırınca otomatik temizleme
        // =========================
        function _clearTakipFormErrors(){
            try {
                document.querySelectorAll('#takipFormuModal .input-error').forEach(el => el.classList.remove('input-error'));
            } catch(e){}
            const w = document.getElementById('takipFormWarn');
            if (w) { w.classList.add('hidden'); w.textContent = ''; }
        }

        function resetTakipFormUI(){
          _clearTakipFormErrors();
          // ✅ KANTAR ismi/ imzası kullanıcı değiştirene kadar kalsın
          // (form temizlenirken silme; yazdırırken tekrar seçim istemesin)
          let keepKantar = '';
          try {
            keepKantar = (document.getElementById('imzaKantarAd')?.value || '').trim();
            if (!keepKantar) keepKantar = (loadSavedKantarName() || '').trim();
          } catch(e) { keepKantar = ''; }

          // ✅ BASIM YERİ: kullanıcı bir kez seçtiyse devam etsin
          let keepBasim = '';
          try {
            keepBasim = (document.getElementById('basimYeri')?.value || '').trim();
            if (!keepBasim) keepBasim = (loadSavedBasimYeri() || '').trim();
          } catch(e) { keepBasim = ''; }

            const ids = [
                'firmaKodu','malzeme','sevkYeri','tonaj','ambalajBilgisi','seperatorBilgisi',
                'bbt','bosBbt','cuval','bosCuval','palet','torba',
                'yuklemeNotu',
                // ❌ yuklemeSirasi'i TEMIZLEME (updateQueueDisplay() çalışınca otomatik güncellenir)
                // imzaKantarAd bilerek temizlenmiyor
                'imzaSahaAd','imzaYukleyenAd','imzaKaliteAd'
            ];
            ids.forEach(id => {
                const el = document.getElementById(id);
                if (!el) return;
                const tag = (el.tagName || '').toLowerCase();
                if (tag === 'select') el.value = '';
                else el.value = '';
            });

            // ✅ KANTAR'ı geri uygula + BASIM YERİ'ni geri uygula, ardından önizlemeyi güncelle
            try {
                const k = document.getElementById('imzaKantarAd');
                if (k && keepKantar) k.value = keepKantar;
                if (k) { persistKantarName(k.value); }
                refreshKantarSignaturePreview();
            } catch(e) {}

            try {
              const b = document.getElementById('basimYeri');
              if (b && keepBasim) b.value = keepBasim;
              if (b) { persistBasimYeri(b.value); }
            } catch(e) {}

            // ✅ YÜKLEME SIRASI: yazdırma sonrası bir sonraki sırayı göster
            try {
              const ys = document.getElementById('yuklemeSirasi');
              if (ys) {
                ys.value = '';
                ys.style.color = '#e74c3c';
                ys.style.fontWeight = 'bold';
                ys.style.backgroundColor = '#ffffff';
              }
              const basim = (document.getElementById('basimYeri')?.value || '').trim();
              if (ys) ys.value = String(getSuggestedYuklemeSirasi(basim || 'default'));
            } catch(e) {}
            
            // dropdown'ları da sıfırla
            try { const fs = document.getElementById('firmaSelect'); if (fs) fs.value = ''; } catch(e){}
            try { const ms = document.getElementById('malzemeSelect'); if (ms) ms.value = ''; } catch(e){}
        }

        function validateTakipForm(opts = {}){
            _clearTakipFormErrors();

            if (opts.forPrint) return true;

            const required = [
                { id:'malzeme',   label:'Malzeme' },
                { id:'sevkYeri',  label:'Sevk Yeri' }
            ];
            if (opts.requireFirma !== false) {
                required.unshift({ id:'firmaKodu', label:'Firma/Müşteri Kodu' });
            }

            const missing = [];
            let firstEl = null;

            required.forEach(r => {
                const el = document.getElementById(r.id);
                const val = (el && 'value' in el) ? String(el.value || '').trim() : '';
                if (!val) {
                    missing.push(r.label);
                    if (el) {
                        el.classList.add('input-error');
                        if (!firstEl) firstEl = el;
                    }
                }
            });

            if (missing.length) {
                const w = document.getElementById('takipFormWarn');
                if (w) {
                    w.textContent = '⚠️ Zorunlu alanlar eksik: ' + missing.join(', ');
                    w.classList.remove('hidden');
                } else {
                    alert('⚠️ Zorunlu alanlar eksik: ' + missing.join(', '));
                }
                try { firstEl && firstEl.focus(); } catch(e){}
                return false;
            }

            return true;
        }

        // ✅ Make validateTakipForm available to global button handlers
        window.__takipFormValidate = validateTakipForm;

        // ✅ Takip Formu'nda kullanıcı manuel düzeltme yapınca
        //    aynı Firma+Malzeme için eşleştirmeyi otomatik günceller (Ambalaj/Not/SevkYeri).
        function upsertEslestirmeFromTakipForm(){
            try {
                const firma = (document.getElementById('firmaKodu')?.value || '').trim();
                const malzeme = (document.getElementById('malzeme')?.value || '').trim();
                if (!firma || !malzeme) return;

                const ambalajBilgisi = (document.getElementById('ambalajBilgisi')?.value || '').trim();
                const yuklemeNotu = (document.getElementById('yuklemeNotu')?.value || '').trim();
                const sevkYeri = (document.getElementById('sevkYeri')?.value || '').trim();

                const existing = eslestirmeListesi.find(es => es.firma === firma && es.malzeme === malzeme);
                if (existing && existing.id) {
                    // Sadece boş değilse üzerine yaz
                    const patch = {};
                    if (ambalajBilgisi) patch.ambalajBilgisi = ambalajBilgisi;
                    if (yuklemeNotu) patch.yuklemeNotu = yuklemeNotu;
                    if (sevkYeri) patch.sevkYeri = sevkYeri;
                    if (Object.keys(patch).length) eslestirmeStorage.update(existing.id, patch);
                } else {
                    eslestirmeStorage.add(firma, malzeme, ambalajBilgisi, yuklemeNotu, sevkYeri);
                }
            } catch(e){}
        }

        // ✅ Takip Formu'nda şoför bilgilerini plaka bazlı hafızaya yaz
        // - Bu sayede aynı plakaya birden fazla şoför geldiğinde hızlı seçim yapılabilir.
        function saveSoforHistoryFromTakipForm() {
            try {
                const plakaEl = document.getElementById('cekiciPlakaBilgi');
                const plaka = plakaEl ? (('value' in plakaEl) ? plakaEl.value : plakaEl.textContent) : '';
                const plate = formatPlakaForInput(String(plaka || '')).trim();
                if (!plate) return;

                const nameEl = document.getElementById('soforBilgi');
                const tcEl = document.getElementById('tcBilgi');
                const telEl = document.getElementById('iletisimBilgi');

                const name = nameEl ? (('value' in nameEl) ? nameEl.value : nameEl.textContent) : '';
                const tc = tcEl ? (('value' in tcEl) ? tcEl.value : tcEl.textContent) : '';
                const telRaw = telEl ? (('value' in telEl) ? telEl.value : telEl.textContent) : '';
                const tel = formatTRPhone(String(telRaw || ''));

                soforHistoryStorage.add(plate, { name: String(name || '').trim(), tc: String(tc || '').trim(), phone: String(tel || '').trim() });
            } catch (e) {
                // sessiz
            }
        }


        // Print penceresi (print.js) yazdırma bittikten sonra bunu çağırır
        window.afterTakipPrint = async function(){
          if (window.__afterTakipPrintRunning) return;

          const pending = window.__pendingPrintCommit;
          const wasRequested = !!window.__afterTakipPrintRequested;
          if (!pending && !wasRequested) return;

          window.__afterTakipPrintRunning = true;
          try { window.__afterTakipPrintRequested = false; } catch(e){}

          try {
            if (pending || wasRequested) {
              // Kullanıcıdan onay al: çıktı gerçekten alındı mı?
              // Özel modal ile inatçı onay al
              const printed = await showPersistentConfirmModal('Rapor yazdırıldı mı?', 'Evet (Tamam)', 'Hayır (İptal)');
              if (!printed) {
                try { window.__pendingPrintCommit = null; } catch(e){}
                try { resetTakipFormUI(); } catch(e){}
                try { kapatForm(); } catch(e){}
                return;
              }
              if (!pending) {
                console.warn('Yazdırma onaylandı ancak bekleyen kayıt bulunamadı; rapora eklenmedi.');
                try { resetTakipFormUI(); } catch(e){}
                try { kapatForm(); } catch(e){}
                return;
              }
              // Yazdır tıklanınca değil, kullanıcı çıktıyı onayladığında anlık zaman damgası
              const commitTs = Date.now();
              const commitTarihTr = (() => {
                try {
                  return new Date(commitTs).toLocaleDateString('tr-TR', { timeZone: 'Europe/Istanbul' });
                } catch (e) {
                  return new Date(commitTs).toLocaleDateString('tr-TR');
                }
              })();
// ✅ 1) Yükleme sırası sayacını kesinleştir (günlük + BASIM YERİ BAZINDA)
                try {
                    const ys = parseInt(String(pending.yuklemeSirasi || '').trim() || '0', 10);
                    const basimYeri = String(pending.snapshot?.basimYeri || '').trim() || 'default';
                    if (Number.isFinite(ys) && ys >= 1) {
                        const d = new Date();
                        const todayKey = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
                        // ✅ Basım yerine göre ayrı tarih ve sayaç tut
                        localStorage.setItem(`yuklemeSirasiDate_${basimYeri}`, todayKey);
                        localStorage.setItem(`yuklemeSirasiCounter_${basimYeri}`, String(ys));
                        // Legacy keyleri de güncel tut (fallback akışları için)
                        localStorage.setItem('yuklemeSirasiDate', todayKey);
                        localStorage.setItem('yuklemeSirasiCounter', String(ys));
                        console.log(`✅ Sayaç kaydedildi - ${basimYeri}: ${ys}`);
                    }
                } catch(e) { console.warn('⚠️ Sayaç kaydet hatası:', e); }

                // ✅ 2) Yazdırma raporu + printCount kesinleştir
                try {
                    try { refreshPendingPrintSnapshotFromForm(pending); } catch (e) {}
                    const plateForResolve = String(pending.plaka || '').trim();
                    const vid = resolveTakipVehicleIdForPrint(plateForResolve, pending.vehicleId);
                    if (vid && vid !== 'manual') {
                        const cur = (state.vehicles || []).find(v => String(v.id) === String(vid));
                        if (cur) {
                            const nextCount = (parseInt(cur.printCount || '0', 10) || 0) + 1;
                            let snap = pending.snapshot || cur.lastPrintSnapshot || null;
                            const driverAtPrint = getTakipFormDriverPayload();
                            if (snap && typeof snap === 'object') {
                              snap = Object.assign({}, snap, {
                                ts: commitTs,
                                plaka: String(pending.plaka || cur.cekiciPlaka || '').trim(),
                                cekiciPlaka: String(cur.cekiciPlaka || pending.plaka || '').trim(),
                                dorsePlaka: String(
                                  driverAtPrint.dorsePlaka || snap.dorsePlaka || cur.dorsePlaka || ''
                                ).trim(),
                              });
                            } else {
                              snap = {
                                ts: commitTs,
                                plaka: String(pending.plaka || cur.cekiciPlaka || '').trim(),
                                cekiciPlaka: String(cur.cekiciPlaka || pending.plaka || '').trim(),
                                dorsePlaka: String(
                                  driverAtPrint.dorsePlaka || cur.dorsePlaka || ''
                                ).trim(),
                              };
                            }
                            const updated = { ...cur, printCount: nextCount, lastPrintSnapshot: snap };
                            try { window.storage?.save('vehicle_' + updated.id, updated); } catch(e) {}
                            state.vehicles = (state.vehicles || []).map(v => String(v.id) === String(updated.id) ? updated : v);
                            try { saveVehicleToDatabase(updated); } catch (e) {}
                            try { await _ihracatFetchRemotePrintReports(true); } catch (e) {}
                            try { _ihracatRefreshOpenModalStatuses(); } catch (_) {}

                            try {
                              const printEv = applyPiyasaOrderToPrintEvent(
                                buildPrintEventDataFromPending(pending, updated, nextCount, commitTarihTr),
                                pending
                              );
                              const firma = printEv.firma;
                              if (printEv.firma || printEv.malzeme || printEv.sevkYeri) {
                                const snapFix = Object.assign({}, updated.lastPrintSnapshot || {}, {
                                  firmaKodu: printEv.firma || '',
                                  firmaSelect: printEv.firmaSelect || printEv.firma || '',
                                  malzeme: printEv.malzeme || '',
                                  sevkYeri: printEv.sevkYeri || '',
                                });
                                updated.lastPrintSnapshot = snapFix;
                                try { window.storage?.save('vehicle_' + updated.id, updated); } catch (e) {}
                                state.vehicles = (state.vehicles || []).map(v =>
                                  String(v.id) === String(updated.id) ? updated : v
                                );
                                try { saveVehicleToDatabase(updated); } catch (e) {}
                              }

                              try{
                                window.Report?.addEvent('PRINT', printEv);

                                // Print history'ye ekle (raporlar — DURUM dondurmasından bağımsız)
                                try {
                                  const phRes = await fetch('/api/print_history', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify(buildPrintHistoryPostBody(printEv, pending, commitTs)),
                                  });
                                  if (phRes && phRes.ok) {
                                    try { if (typeof window.refreshReportCache === 'function') window.refreshReportCache(); } catch (e) {}
                                  }
                                } catch(e) { console.warn('Print history save failed:', e); }
                              } catch(e) { }
                            } catch(e) {}
                        }
                    } else {
                        try {
                            const printEv = applyPiyasaOrderToPrintEvent(
                              buildPrintEventDataFromPending(pending, null, 1, commitTarihTr),
                              pending
                            );
                            printEv.vehicleId = 'manual';
                            const firma = printEv.firma;

                            try{
                              window.Report?.addEvent('PRINT', printEv);

                              // Print history'ye ekle (manual için)
                              try {
                                const phRes = await fetch('/api/print_history', {
                                  method: 'POST',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify(buildPrintHistoryPostBody(printEv, pending, commitTs)),
                                });
                                if (phRes && phRes.ok) {
                                  try { if (typeof window.refreshReportCache === 'function') window.refreshReportCache(); } catch (e) {}
                                }
                              } catch(e) { console.warn('Print history save failed:', e); }
                            } catch(e) { }
                        } catch(e) {}
                    }
                } catch(e) {}

                // ✅ Piyasa siparişi yazdırma sayacı (takip formu onaylandıysa)
                try {
                  if (window.piyasa && typeof window.piyasa.recordOrderPrint === 'function' && pending) {
                    const po = (typeof window.piyasa.getOrderByIdx === 'function')
                      ? window.piyasa.getOrderByIdx(pending.piyasaOrderIdx)
                      : null;
                    const snap = pending.snapshot || {};
                    window.piyasa.recordOrderPrint({
                      plate: pending.plaka || '',
                      ts: commitTs,
                      orderIdx: pending.piyasaOrderIdx,
                      firma: (po && po.firma) || snap.firmaKodu || snap.firmaSelect || '',
                      malzeme: (po && po.malzeme) || snap.malzeme || snap.malzemeSelect || '',
                    });
                  }
                } catch (e) {
                  console.warn('Piyasa yazdırma sayacı güncellenemedi:', e);
                }

                try { window.__pendingPrintCommit = null; } catch(e) {}
            }

            try { resetTakipFormUI(); } catch(e){}
            try { kapatForm(); } catch(e){}
          } finally {
            try { window.__afterTakipPrintRunning = false; } catch(e) {}
          }
        };


        // Takip Formunu Yazdır (print.js içine taşındı)


        // Firma Yönetim Modalını Göster
        function showFirmaYonetimModal() {
            const modal = document.getElementById('firmaYonetimModal');
            const firmaListesiContainer = document.getElementById('firmaListesi');
            
            // Firma listesini doldur
            firmaListesiContainer.innerHTML = '';
            
            if (firmaListesi.length === 0) {
                firmaListesiContainer.innerHTML = '<div class="p-4 text-center text-gray-500">Henüz firma eklenmemiş.</div>';
            } else {
                firmaListesi.forEach((firma, index) => {
                    const firmaItem = document.createElement('div');
                    firmaItem.className = 'firma-item';
                    firmaItem.innerHTML = `
                        <span>${firma}</span>
                        <div class="firma-actions">
                            <button class="firma-duzenle-btn text-blue-600 hover:text-blue-800" data-index="${index}">
                                ✏️
                            </button>
                            <button class="firma-sil-btn text-red-600 hover:text-red-800" data-index="${index}">
                                🗑️
                            </button>
                        </div>
                    `;
                    firmaListesiContainer.appendChild(firmaItem);
                });
            }
            
            // Event listener'ları ekle
            document.querySelectorAll('.firma-duzenle-btn').forEach(btn => {
                btn.addEventListener('click', async function() {
                    const index = parseInt(this.getAttribute('data-index'));
                    const yeniFirma = await prompt('Firma adını düzenleyin:', firmaListesi[index]);
                    if (yeniFirma && yeniFirma.trim() !== '') {
                        if (firmaStorage.update(index, yeniFirma.trim())) {
                            showFirmaYonetimModal(); // Listeyi yenile
                        } else {
                            alert('Firma düzenlenirken bir hata oluştu!');
                        }
                    }
                });
            });
            
            document.querySelectorAll('.firma-sil-btn').forEach(btn => {
                btn.addEventListener('click', async function() {
                    const index = parseInt(this.getAttribute('data-index'));
                    if (await confirm(`"${firmaListesi[index]}" firmasını silmek istediğinizden emin misiniz?`)) {
                        if (firmaStorage.delete(index)) {
                            showFirmaYonetimModal(); // Listeyi yenile
                        } else {
                            alert('Firma silinirken bir hata oluştu!');
                        }
                    }
                });
            });
            
            // Modal'ı göster
            modal.classList.remove('hidden');
        }

        // Eşleştirme Modalını Göster
        function showEslestirmeModal() {
            const modal = document.getElementById('eslestirmeModal');
            // Eşleştirme özelliği kaldırıldı: modal yoksa hiçbir şey yapma
            if (!modal) { try{ showToast && showToast('ℹ️ Eşleştirme kaldırıldı. Excel okuma ile devam.'); }catch(e){} return; }
            const eslestirmeListesiContainer = document.getElementById('eslestirmeListesi');
            const firmaSelect = document.getElementById('eslestirmeFirmaSelect');
            const malzemeSelect = document.getElementById('eslestirmeMalzemeSelect');
            const firmaInput = document.getElementById('eslestirmeFirmaInput');
            const malzemeInput = document.getElementById('eslestirmeMalzemeInput');
            
            // Inputları temizle
            firmaInput.value = '';
            malzemeInput.value = '';
            
            // Select'leri doldur
            firmaSelect.innerHTML = '<option value="">Firma seçin</option>';
            firmaListesi.forEach(firma => {
                firmaSelect.innerHTML += `<option value="${getFirmaKodOnly(firma)}">${getFirmaKodOnly(firma)}</option>`;
            });
            
            malzemeSelect.innerHTML = '<option value="">Malzeme seçin</option>';
            malzemeListesi.forEach(malzeme => {
                malzemeSelect.innerHTML += `<option value="${malzeme}">${malzeme}</option>`;
            });
            
            // Select değişikliklerini dinle
            addOnce(firmaSelect, 'change', function() {
                if (this.value) {
                    firmaInput.value = '';
                }
            });
            
            addOnce(malzemeSelect, 'change', function() {
                if (this.value) {
                    malzemeInput.value = '';
                }
            });
            
            // Input değişikliklerini dinle
            addOnce(firmaInput, 'input', function() {
                if (this.value) {
                    firmaSelect.value = '';
                }
            });
            
            addOnce(malzemeInput, 'input', function() {
                if (this.value) {
                    malzemeSelect.value = '';
                }
            });
            
            // Eşleştirme listesini doldur
            eslestirmeListesiContainer.innerHTML = '';
            
            if (eslestirmeListesi.length === 0) {
                eslestirmeListesiContainer.innerHTML = '<div class="p-4 text-center text-gray-500">Henüz eşleştirme eklenmemiş.</div>';
            } else {
                eslestirmeListesi.forEach((eslestirme, index) => {
                    const eslestirmeItem = document.createElement('div');
                    eslestirmeItem.className = 'eslestirme-item';
                    eslestirmeItem.innerHTML = `
  <div>
    <div><strong>Firma:</strong> ${eslestirme.firma}</div>
    <div><strong>Malzeme:</strong> ${eslestirme.malzeme}</div>
    ${eslestirme.ambalajBilgisi ? `<div><strong>Ambalaj:</strong> ${eslestirme.ambalajBilgisi}</div>` : ''}
    ${eslestirme.sevkYeri ? `<div><strong>Sevk Yeri:</strong> ${eslestirme.sevkYeri}</div>` : ''}
    ${eslestirme.yuklemeNotu ? `<div><strong>Not:</strong> ${eslestirme.yuklemeNotu}</div>` : ''}
  </div>
  <div class="eslestirme-actions">
    <button class="eslestirme-duzenle-btn text-blue-600 hover:text-blue-800" data-id="${eslestirme.id}">
      ✏️
    </button>
    <button class="eslestirme-sil-btn text-red-600 hover:text-red-800" data-id="${eslestirme.id}">
      🗑️
    </button>
  </div>
`;

                    eslestirmeListesiContainer.appendChild(eslestirmeItem);
                });
            }
            
            // Event listener'ları ekle
            document.querySelectorAll('.eslestirme-sil-btn').forEach(btn => {
  btn.addEventListener('click', async function() {
    const id = this.getAttribute('data-id');
    const es = eslestirmeListesi.find(x => x.id === id);
    if (!es) return;

    if (await confirm(`"${es.firma}" - "${es.malzeme}" eşleştirmesini silmek istediğinizden emin misiniz?`)) {
      if (eslestirmeStorage.delete(id)) showEslestirmeModal();
      else alert('Eşleştirme silinirken bir hata oluştu!');
    }
  });
});
        

document.querySelectorAll('.eslestirme-duzenle-btn').forEach(btn => {
  btn.addEventListener('click', async function() {
    const id = this.getAttribute('data-id');
    const es = eslestirmeListesi.find(x => x.id === id);
    if (!es) return;

    const yeniFirma = await prompt('Firma:', es.firma);
    if (yeniFirma === null) return;

    const yeniMalzeme = await prompt('Malzeme:', es.malzeme);
    if (yeniMalzeme === null) return;

    const yeniAmbalaj = await prompt('Ambalaj Bilgisi (varsayılan):', es.ambalajBilgisi || '');
    if (yeniAmbalaj === null) return;

    const yeniSevk = await prompt('Sevk Yeri (varsayılan):', es.sevkYeri || '');
    if (yeniSevk === null) return;

    const yeniNot = await prompt('Yükleme Notu (varsayılan):', es.yuklemeNotu || '');
    if (yeniNot === null) return;

    const ok = eslestirmeStorage.update(id, {
      firma: yeniFirma.trim(),
      malzeme: yeniMalzeme.trim(),
      ambalajBilgisi: yeniAmbalaj.trim(),
      sevkYeri: yeniSevk.trim(),
      yuklemeNotu: yeniNot.trim()
    });

    if (!ok) {
      alert('❌ Aynı firma + aynı malzeme zaten var veya güncelleme hatası.');
      return;
    }

    showEslestirmeModal();
  });
});








            // Modal'ı göster
            modal.classList.remove('hidden');
        }

        // Firma Yönetim Modalını Kapat
        function kapatFirmaModal() {
            document.getElementById('firmaYonetimModal').classList.add('hidden');
        }

        // Eşleştirme Modalını Kapat
        function kapatEslestirmeModal() {
            document.getElementById('eslestirmeModal')?.classList.add('hidden');
        }

        function vehicleListSkeletonHTML(count) {
            const n = count || state.listLimit || 6;
            const card = '<div class="vehicle-card vehicle-card--skeleton animate-pulse">' +
                '<div class="vehicle-card__skel vehicle-card__skel--head"></div>' +
                '<div class="vehicle-card__skel vehicle-card__skel--line"></div>' +
                '<div class="vehicle-card__skel vehicle-card__skel--line short"></div>' +
                '<div class="vehicle-card__skel vehicle-card__skel--foot"></div>' +
                '</div>';
            return Array.from({ length: n }, () => card).join('');
        }

        function vehicleListEmptyHTML() {
            if (state.vehiclesLoading) return vehicleListSkeletonHTML();
            const msg = state.vehicles.length === 0
                ? 'Henüz kayıt yok. Yeni kayıt ekleyin!'
                : 'Aramanıza uygun kayıt bulunamadı.';
            return `
                <div class="col-span-full text-center py-12 bg-white rounded-lg shadow-lg">
                    <svg class="w-16 h-16 text-gray-300 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 17a2 2 0 11-4 0 2 2 0 014 0zM19 17a2 2 0 11-4 0 2 2 0 014 0z"/>
                    </svg>
                    <p class="text-gray-500 text-lg">${msg}</p>
                </div>`;
        }

        // UI render
        function render() {
            if (!isLoggedIn) return;
            
            const filteredVehicles = filterVehicles();
            
            const hasSearch = !!(state.searchTerm && state.searchTerm.trim());
            const shouldLimit = !hasSearch && !state.showAll;
            const visibleVehicles = shouldLimit ? filteredVehicles.slice(0, state.listLimit) : filteredVehicles;

            const app = document.getElementById('mainApp');
            // ⚠️ Excel tarihi bugünün değilse uyarı göster (İHRACAT + PİYASA, ASLA otomatik silme)
            const _excelMeta = (typeof loadDailyMeta === 'function') ? (loadDailyMeta() || {}) : {};
            const _excelCnt  = (typeof loadDailyShipments === 'function') ? ((loadDailyShipments() || []).length || 0) : 0;
            const excelWarnHTML = (typeof _computeExcelDateWarnHtml === 'function') ? _computeExcelDateWarnHtml() : '';

            // 🖥️ Kiosk/Status satırı (hızlı özet)
            const _kioskOn = (typeof isKioskModeOn === 'function') ? isKioskModeOn() : false;
            const _piyasaCnt = (typeof _piyasaLoadedCount === 'function') ? _piyasaLoadedCount() : 0;
            // ✅ Excel yükleme bilgileri (raporlar sayfasındaki formatla aynı)
            const _ihrInfoLine = (()=>{
              try {
                if (_excelMeta && _excelMeta.fileName) return `${_excelMeta.fileName} • ${_excelCnt} kayıt`;
                if (_excelCnt) return `${_excelCnt} kayıt`;
              } catch(e) {}
              return '-';
            })();

            const _excelStatusInfo = (typeof _getExcelStatusInfo === 'function') ? _getExcelStatusInfo() : {
              ihrCount: _excelCnt,
              ihrLine: _ihrInfoLine,
              piyCount: _piyasaCnt,
              piyLine: '-',
            };
            const _ihrChipText = _buildIhracatChipText(_excelStatusInfo);
            const _piyChipText = _buildPiyasaChipText(_excelStatusInfo);
            const _totalVehicleCount = (state.vehicles || []).length;
            app.innerHTML = `
                <div class="max-w-7xl mx-auto">
                    <!-- Header -->
                    <header class="app-header mb-6" role="banner">
  <div class="app-header-toolbar">
    <div class="app-header-brand">
      <img class="app-header-logo" src="/logo.png" alt="Logo" />
    </div>
    <div class="app-header-menus">
      <nav class="app-nav" aria-label="Ana menü">
        <button id="toggleFormButton" class="app-nav-btn app-nav-btn--primary app-nav-btn--always">
          ${state.showForm ? 'İptal' : 'Yeni Kayıt'}
        </button>
        <details class="app-nav-more-menu app-tools-menu">
          <summary class="app-nav-btn app-nav-btn--always app-nav-more-toggle list-none select-none">
            Menü <span class="app-nav-chevron" aria-hidden="true">▾</span>
          </summary>
          <div class="app-nav-more-panel">
            <button id="raporlarLinkGunluk" class="app-nav-btn" title="Günlük Raporlar">Günlük Raporlar</button>
            <button id="vardiyaNotlariButton" class="app-nav-btn app-nav-btn--danger" title="Vardiya notları — yazdır uyarıları">Vardiya Notları</button>
            <button id="issuesDashboardButton" class="app-nav-btn" title="Şoför sorun kayıtları">Sorunlar</button>
            <a href="plaka.html" class="app-nav-btn" title="Plaka ayırma">Plaka Ayırma</a>
            <details class="app-tools-menu app-tools-menu--nested relative">
              <summary class="app-nav-btn list-none select-none">
                Araçlar <span class="app-nav-chevron" aria-hidden="true">▾</span>
              </summary>
              <div class="app-dropdown app-dropdown--nested absolute left-0 mt-2 w-56 z-50">
                <button id="excelBlockSelectButtonTop" class="w-full text-left px-3 py-2 rounded-lg hover:bg-gray-100 text-sm" title="Excel dosyasından sevkiyat bloklarını seçerek yükle">📌 İHRACAT Blok Seçerek Yükle</button>
                <button id="excelClearButtonTop" class="w-full text-left px-3 py-2 rounded-lg hover:bg-gray-100 text-sm" title="Günlük excel verisini temizle">🗑️ İHRACAT Excel Sil</button>
                <div class="my-1 border-t"></div>
                <div class="px-3 py-1 text-xs text-gray-500 font-semibold">PİYASA</div>
                <button type="button" id="piyasaExcelUploadButtonTop" class="w-full text-left px-3 py-2 rounded-lg hover:bg-gray-100 text-sm" title="İç piyasa excel yükle">🧾 PİYASA Excel Yükle</button>
                <button type="button" id="piyasaExcelClearButtonTop" class="w-full text-left px-3 py-2 rounded-lg hover:bg-gray-100 text-sm" title="İç piyasa excel verisini temizle">🗑️ PİYASA Excel Sil</button>
                <div class="my-1 border-t"></div>
                <button type="button" id="ayarlarMenuButton" class="w-full text-left px-3 py-2 rounded-lg hover:bg-gray-100 text-sm">⚙️ Ayarlar</button>
              </div>
            </details>
            <button id="manualTakipFormButton" class="app-nav-btn" title="Manuel takip formu">Takip Formu</button>
          </div>
        </details>
        <button id="logoutButton" class="app-nav-btn app-nav-btn--danger app-nav-btn--always">Çıkış</button>
      </nav>
      <div class="app-header-status" id="quickStatusRow">
        <span class="status-chip">Tanımlı şoför: <b>${_totalVehicleCount}</b></span>
        <button type="button" id="chipIhracat" class="status-chip status-chip--excel ${_excelCnt>0?'chip-ok':'chip-warn'}" title="${_excelCnt>0?('İHRACAT Excel: '+_ihrInfoLine):'İHRACAT Excel yüklü değil'}">📄 İHRACAT: <b id="chipIhracatText">${_ihrChipText}</b></button>
        <button type="button" id="chipPiyasa" class="status-chip status-chip--excel ${_piyasaCnt>0?'chip-ok':'chip-warn'}" title="${_piyasaCnt>0?('PİYASA Excel: '+_excelStatusInfo.piyLine):'PİYASA Excel yüklü değil'}">🧾 PİYASA: <b id="chipPiyasaText">${_piyChipText}</b></button>
      </div>
    </div>
  </div>
</header>
                    <div id="excelDateWarnContainer">${excelWarnHTML}</div>

                    <!-- Form -->
                    ${state.showForm ? `
                    <div class="bg-white rounded-lg shadow-lg p-6 mb-6">
                        <h2 class="text-xl font-bold text-gray-800 mb-4">
                            ${state.editingId ? '📝 Kayıt Düzenle' : '➕ Yeni Araç Kaydı'}
                        </h2>
                        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label class="block text-sm font-medium text-gray-700 mb-1">🚛 Çekici Plaka *</label>
                                <input type="text" id="cekiciPlaka" value="${state.formData.cekiciPlaka}" 
                                    class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 uppercase" 
                                    placeholder="34 ABC 123"
                                    style="text-transform: uppercase;"
                                    oninput="formatPlakaInput(this);">
                                <div id="plateWarning" class="text-xs mt-1 hidden"></div>
                            </div>
                            <div>
                                <label class="block text-sm font-medium text-gray-700 mb-1">🚚 Dorse Plaka</label>
                                <input type="text" id="dorsePlaka" value="${state.formData.dorsePlaka}" 
                                    class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 uppercase" 
                                    placeholder="34 XYZ 456"
                                    style="text-transform: uppercase;"
                                    oninput="formatPlakaInput(this);">
                            </div>
                            <div>
                                <label class="block text-sm font-medium text-gray-700 mb-1">👤 Şoför Adı</label>
                                <input type="text" id="soforAdi" value="${state.formData.soforAdi}" 
                                    maxlength="100"
                                    class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 uppercase" 
                                    placeholder="Ahmet"
                                    style="text-transform: uppercase;">
                            </div>
                            <div>
                                <label class="block text-sm font-medium text-gray-700 mb-1">👤 Şoför Soyadı</label>
                                <input type="text" id="soforSoyadi" value="${state.formData.soforSoyadi}" 
                                    maxlength="100"
                                    class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 uppercase" 
                                    placeholder="Yılmaz"
                                    style="text-transform: uppercase;">
                            </div>
<div>
                                <label class="block text-sm font-medium text-gray-700 mb-1">📞 İletişim</label>
                                <input type="text" id="iletisim" value="${state.formData.iletisim}" 
                                    class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 uppercase" 
                                    placeholder="0555 123 45 67"
                                    style="text-transform: uppercase;">
                                <div id="iletisimWarning" class="text-xs mt-1 hidden"></div>
                            </div>
                            <div>
                                <label class="block text-sm font-medium text-gray-700 mb-1">🆔 TC Kimlik No</label>
                                <input type="text" id="tcKimlik" value="${state.formData.tcKimlik}" 
                                    maxlength="11"
                                    class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500" 
                                    placeholder="12345678901">

                            </div>
<div class="md:col-span-2 flex gap-2 justify-end">
                                <button id="cancelButton" class="px-6 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition">
                                    ❌ İptal
                                </button>
                                <button id="saveButton" class="bg-indigo-600 text-white px-6 py-2 rounded-lg hover:bg-indigo-700 transition">
                                    💾 ${state.editingId ? 'Güncelle' : 'Kaydet'}
                                </button>
                            </div>
                        </div>
                    </div>
                    ` : ''}

                    <!-- Search -->
                    <div class="bg-white rounded-lg shadow-lg p-4 mb-6 border-l-4 border-indigo-600">
                        <div class="relative">
                            <input type="text" id="searchInput" 
                                class="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500" 
                                placeholder="Plaka, şoför adı, soyadı veya kantar personeli ile ara...">
                            <svg class="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
                            </svg>
                        </div>
                    </div>

                    <!-- Vehicle List -->
                    <div id="vehicleList" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 vehicle-list-grid">
                        ${state.vehiclesLoading ? vehicleListSkeletonHTML() : (
                            filteredVehicles.length === 0
                                ? vehicleListEmptyHTML()
                                : visibleVehicles.map((vehicle) => vehicleCardHTML(vehicle)).join('')
                        )}
                    </div>

                    <!-- Devamını Göster -->
                    ${(!state.searchTerm && filteredVehicles.length > state.listLimit) ? `
                      <div class="mt-4 flex justify-center">
                        <button id="showMoreButton" class="show-more-btn">
                          ${state.showAll ? 'Gizle' : `Devamını Göster (${filteredVehicles.length - state.listLimit})`}
                        </button>
                      </div>
                    ` : ''}
</div>

                    <!-- Stats -->
                    
                    <div id="stats" class="mt-6 bg-white rounded-lg shadow-lg p-4">
                        ${state.vehicles.length > 0 ? `
                        <p class="text-center text-gray-600">
                            Toplam <span class="font-bold text-indigo-600">${state.vehicles.length}</span> araç kaydı
                            ${state.searchTerm && filteredVehicles.length !== state.vehicles.length ? 
                                `| Gösterilen: <span class="font-bold text-indigo-600">${filteredVehicles.length}</span>` : ''}
                        </p>
                        ` : ''}
                    </div>
                </div>
            `;

            // Event listener'ları ekle
            attachEventListeners();
            try {
              if (typeof window.__piyasaRebind === 'function') window.__piyasaRebind();
              if (typeof window.initPiyasaModule === 'function') window.initPiyasaModule();
            } catch (e) { console.warn('Piyasa rebind:', e); }
        }


