// app-auth.js — giriş, oturum, yedekleme
// Otomatik bölüm — scripts/split-large-files.js

async function openWhatsAppFromCard(phone, text) {
  const sendUrl = buildWhatsAppWebUrl(phone, text);
  if (!sendUrl) {
    showToast('Geçerli telefon numarası yok.', 'warn');
    return null;
  }

  _syncWhatsAppWinRef();

  // Uygulamanın daha önce açtığı sekme varsa: aynı sekmede sohbete git
  if (_navigateWhatsAppWin(sendUrl)) {
    return _whatsappWin;
  }

  // Açık WhatsApp sekmesinde çalışır: linki panoya kopyala (Ctrl+V → Enter)
  const copied = await copyTextToClipboard(sendUrl);
  showToast(
    copied
      ? 'Link kopyalandı. Açık WhatsApp sekmesine geç → Ctrl+V → Enter'
      : 'WhatsApp sekmesinin adres çubuğuna yapıştırın: ' + sendUrl,
    'success',
    5500
  );

  // İsteğe bağlı: Alt+tıklama veya Shift+tıklama yeni yönetilen sekme açar
  return null;
}

function bindWhatsAppClickDelegation() {
  if (window.__waClickBound) return;
  window.__waClickBound = true;
  document.addEventListener('click', function (e) {
    const el = e.target.closest('.whatsapp-link');
    if (!el) return;
    e.preventDefault();
    e.stopPropagation();
    const phone = el.getAttribute('data-wa-phone');
    if (phone == null) return;
    const text = el.getAttribute('data-wa-text') || '';

    if (e.altKey || e.shiftKey) {
      openWhatsAppInManagedTab(phone, text);
      return;
    }
    openWhatsAppFromCard(phone, text);
  }, true);
}

/** Yönetilen tek WhatsApp sekmesi (Alt/Shift+tıklama). Önce ana sayfa, sonra sohbet. */
function openWhatsAppInManagedTab(phone, text) {
  const sendUrl = buildWhatsAppWebUrl(phone, text);
  if (!sendUrl) {
    showToast('Geçerli telefon numarası yok.', 'warn');
    return null;
  }

  _syncWhatsAppWinRef();

  if (_navigateWhatsAppWin(sendUrl)) {
    return _whatsappWin;
  }

  _whatsappWin = window.open('https://web.whatsapp.com/', WHATSAPP_WINDOW_NAME);
  if (!_whatsappWin) {
    showToast('Pop-up engellendi. Tarayıcıda açılır pencerelere izin verin.', 'warn');
    return null;
  }

  try { _whatsappWin.focus(); } catch (_) { /* ignore */ }

  let tries = 0;
  const goSend = function () {
    tries++;
    if (!_whatsappWin || _whatsappWin.closed || tries > 4) return;
    try { _whatsappWin.location.replace(sendUrl); } catch (_) { /* ignore */ }
  };
  setTimeout(goSend, 3500);
  setTimeout(goSend, 7000);

  showToast('WhatsApp yükleniyor… Sohbet birkaç saniye içinde açılacak.', 'info', 4500);
  return _whatsappWin;
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindWhatsAppClickDelegation);
  } else {
    bindWhatsAppClickDelegation();
  }
}

window.openWhatsAppFromCard = openWhatsAppFromCard;
window.openWhatsAppInManagedTab = openWhatsAppInManagedTab;

        function syncNavMoreMenu() {
          /* Katlanır menü kaldırıldı — no-op */
        }

        // Event listener'ları ekle
        function attachEventListeners() {
          if (!window.__navMoreMenuInitialized) {
            window.__navMoreMenuInitialized = true;
            syncNavMoreMenu();
            window.addEventListener('resize', syncNavMoreMenu, { passive: true });
          }
          addOnce(document.getElementById('loginButton'), 'click', login);
          addOnce(document.getElementById('loginId'), 'keypress', function(e) { if (e.key === 'Enter') login(); });
          addOnce(document.getElementById('loginPassword'), 'keypress', function(e) { if (e.key === 'Enter') login(); });
            // Note: token validation is performed once on DOMContentLoaded to avoid repeated checks on every render.
            // document.getElementById('eslestirmeButton')?.addEventListener('click', showEslestirmeModal); // kaldırıldı
// Raporlar button handler
(() => {
  const btn = document.getElementById('raporlarLinkGunluk');
  if (!btn) return;

  btn.addEventListener('click', async (ev) => {
    ev.preventDefault();
    
    // ✅ Oturum kontrolü
    if (window.SessionManager && typeof window.SessionManager.requireValidSession === 'function') {
      const isValidSession = await window.SessionManager.requireValidSession();
      if (!isValidSession) {
        return; // Oturum geçersizse işlemi durdur
      }
    }
    
    if (window.SessionManager && typeof window.SessionManager.openAppPage === 'function') {
      window.SessionManager.openAppPage('rapor.html');
    } else {
      location.href = 'rapor.html';
    }
  });
})();


            // Vardiya Notlari sayfasi
            document.getElementById('vardiyaNotlariButton')?.addEventListener('click', async () => {
                if (window.SessionManager && typeof window.SessionManager.requireValidSession === 'function') {
                    const isValidSession = await window.SessionManager.requireValidSession();
                    if (!isValidSession) return;
                }
                if (window.SessionManager && typeof window.SessionManager.openAppPage === 'function') {
                    window.SessionManager.openAppPage('vardiya-notlari.html');
                } else {
                    location.href = 'vardiya-notlari.html';
                }
            });

            // ⚠️ Şoför Sorunları (ayrı sayfa — Günlük Raporlar gibi)
            document.getElementById('issuesDashboardButton')?.addEventListener('click', async () => {
                if (window.SessionManager && typeof window.SessionManager.requireValidSession === 'function') {
                    const isValidSession = await window.SessionManager.requireValidSession();
                    if (!isValidSession) return;
                }
                if (window.SessionManager && typeof window.SessionManager.openAppPage === 'function') {
                    window.SessionManager.openAppPage('sorunlar.html');
                } else {
                    location.href = 'sorunlar.html';
                }
            });

            document.getElementById('ayarlarMenuButton')?.addEventListener('click', async (ev) => {
                ev.preventDefault();
                if (window.SessionManager && typeof window.SessionManager.requireValidSession === 'function') {
                    const isValidSession = await window.SessionManager.requireValidSession();
                    if (!isValidSession) return;
                }
                try {
                    if (window.AyarlarGate && typeof window.AyarlarGate.openAyarlarPage === 'function') {
                        await window.AyarlarGate.openAyarlarPage();
                    } else {
                        if (window.SessionManager && typeof window.SessionManager.openAppPage === 'function') {
                            window.SessionManager.openAppPage('ayarlar.html');
                        } else {
                            location.href = 'ayarlar.html';
                        }
                    }
                } catch (e) {
                    console.warn('Ayarlar açılamadı', e);
                }
            });

            // 📝 Manuel Takip Formu (araç seçmeden)
            document.getElementById('manualTakipFormButton')?.addEventListener('click', async () => {
                // ✅ Oturum kontrolü
                if (window.SessionManager && typeof window.SessionManager.requireValidSession === 'function') {
                    const isValidSession = await window.SessionManager.requireValidSession();
                    if (!isValidSession) {
                        return; // Oturum geçersizse işlemi durdur
                    }
                }
                
                try {
                    showTakipFormu({
                      id: 'manual',
                      cekiciPlaka: '',
                      dorsePlaka: '',
                      soforAdi: '',
                      soforSoyadi: '',
                  iletisim: '',
                  tcKimlik: '',
                  defaultFirma: '',
                  defaultMalzeme: '',
                  defaultSevkYeri: '',
                  defaultYuklemeNotu: ''
                });
              } catch (e) {
                // fail safe
                showTakipFormu({ id:'manual' });
              }
            });

            // Yeni kayıt formu: plaka yazılınca sorun varsa Enter/blur ile modal aç (Excel düzenleme burada açılmaz)
            const _plateEl = document.getElementById('cekiciPlaka');
            if (_plateEl) {
              safeBind(_plateEl, 'keydown', (e) => {
                if (e.key === 'Enter') {
                  const p = _plateEl.value || '';
                  if (getIssueCount(p) > 0) openIssuesModal(p);
                }
              }, 'issuesEnter');
              safeBind(_plateEl, 'blur', () => {
                const p = _plateEl.value || '';
                if (getIssueCount(p) > 0) openIssuesModal(p);
              }, 'issuesBlur');
            }

            // Kart içi "SORUN X" butonları zaten document-level delegation ile açılıyor


            // 📄 İhracat Excel — blok seçerek yükle / sil
            document.getElementById('excelBlockSelectButtonTop')?.addEventListener('click', function(){
                closeAppToolsMenu();
                let inp = document.getElementById('excelBlockFileInput');
                if (!inp) {
                    inp = document.createElement('input');
                    inp.type = 'file';
                    inp.id = 'excelBlockFileInput';
                    inp.accept = '.xlsx,.xls,.xlsm,.xlsb';
                    inp.style.display = 'none';
                    document.body.appendChild(inp);
                    inp.addEventListener('change', async function(ev){
                        const f = ev.target.files && ev.target.files[0];
                        if (!f) return;
                        const res = await importExcelHeadersOnly_ShowSelection(f);
                        if (!res || !res.ok) showToast('❌ ' + ((res && res.msg) || 'Excel okunamadı.'));
                    });
                }
                inp.value = '';
                inp.click();
            });

            document.getElementById('excelClearButtonTop')?.addEventListener('click', async function(){
                closeAppToolsMenu();
                const ui = window.rpUi || {};
                const cnt = (typeof loadDailyShipments === 'function') ? (loadDailyShipments().length || 0) : 0;
                if (!cnt) {
                    if (typeof ui.alert === 'function') await ui.alert('İHRACAT Excel verisi zaten boş.', 'info');
                    else showToast('İHRACAT Excel verisi zaten boş.');
                    return;
                }

                let selectedBlocks = null;
                if (typeof pickIhracatBlocksToDelete === 'function') {
                    selectedBlocks = await pickIhracatBlocksToDelete();
                }
                if (!selectedBlocks || !selectedBlocks.length) return;

                const blockCount = selectedBlocks.length;
                const rowCount = selectedBlocks.reduce((s, b) => s + (b.rowCount || 0), 0);
                const targetLabel = `${blockCount} sevkiyat bloğu (${rowCount} kayıt)`;

                let okDel = false;
                if (typeof ui.confirm === 'function') {
                    okDel = await ui.confirm(`${targetLabel} silinecek.\n\nDevam edilsin mi?`, { okLabel: 'Sil' });
                  } else {
                    okDel = await confirm(`${targetLabel} silinecek.\n\nDevam edilsin mi?`);
                  }
                if (!okDel) return;

                const snapshot = {
                    rows: JSON.parse(JSON.stringify(loadDailyShipments() || [])),
                    meta: JSON.parse(JSON.stringify(loadDailyMeta() || {}))
                };
                let r = false;
                if (typeof removeDailyShipmentsByBlocks === 'function') {
                    r = removeDailyShipmentsByBlocks(selectedBlocks);
                } else {
                    r = await clearDailyShipments();
                }
                if (!r) {
                    if (typeof ui.alert === 'function') await ui.alert('Silinemedi.', 'danger');
                    else showToast('Silinemedi.');
                    return;
                }
                try { if (typeof purgeStrictExcelCaches === 'function') purgeStrictExcelCaches(); } catch(e) {}
                try {
                    if (typeof rebuildListsFromExcelRows === 'function') {
                        rebuildListsFromExcelRows(loadDailyShipments() || []);
                    }
                } catch(e) {}
                try { window.refreshHeaderExcelInfo && window.refreshHeaderExcelInfo(); } catch(e) {}
                try { render(); } catch(e) {}

                const successMsg = `${blockCount} blok silindi (${rowCount} kayıt kaldırıldı).`;

                let choice = 'ok';
                if (typeof ui.alertDeleteSuccess === 'function') {
                    choice = await ui.alertDeleteSuccess({
                        message: successMsg,
                        withUndo: true
                    });
                } else {
                    showToast(successMsg);
                }
                if (choice === 'undo') {
                    try {
                        if (typeof saveDailyShipments === 'function') saveDailyShipments(snapshot.rows, snapshot.meta);
                        if (typeof rebuildListsFromExcelRows === 'function') rebuildListsFromExcelRows(snapshot.rows);
                        try { window.refreshHeaderExcelInfo && window.refreshHeaderExcelInfo(); } catch(e) {}
                        try { render(); } catch(e) {}
                        if (typeof ui.alert === 'function') await ui.alert('İHRACAT Excel verisi geri yüklendi.', 'success');
                    } catch (e) {
                        if (typeof ui.alert === 'function') await ui.alert('Geri alma başarısız.', 'danger');
                    }
                }
            });

            document.getElementById('toggleFormButton')?.addEventListener('click', async function(e) {
                // ✅ Oturum kontrolü
                if (window.SessionManager && typeof window.SessionManager.requireValidSession === 'function') {
                    const isValidSession = await window.SessionManager.requireValidSession();
                    if (!isValidSession) {
                        return; // Oturum geçersizse işlemi durdur
                    }
                }
                toggleForm();
            });
            document.getElementById('logoutButton')?.addEventListener('click', async function() {
                // ✅ Oturum kontrolü (çıkış için kritik değil ama tutarlılık için)
                if (window.SessionManager && typeof window.SessionManager.requireValidSession === 'function') {
                    const isValidSession = await window.SessionManager.requireValidSession();
                    if (!isValidSession) {
                        return; // Oturum zaten geçersizse logout'u çağır
                    }
                }
                logout();
            });

            // 🖥️ Kiosk toggle
            document.getElementById('kioskToggleButton')?.addEventListener('click', function(){
                try { toggleKioskMode(); } catch(e) {}
            });

            document.getElementById('cancelButton')?.addEventListener('click', resetForm);
            document.getElementById('saveButton')?.addEventListener('click', saveFromForm);

            // Firma ekleme butonu
            document.getElementById('firmaEkleButton')?.addEventListener('click', function() {
                const yeniFirmaInput = document.getElementById('yeniFirmaInput');
                const yeniFirma = yeniFirmaInput.value.trim();
                
                if (yeniFirma === '') {
                    alert('Lütfen bir firma adı giriniz!');
                    return;
                }
                
                if (firmaStorage.add(yeniFirma)) {
                    yeniFirmaInput.value = '';
                    showFirmaYonetimModal(); // Listeyi yenile
                    alert('✅ Firma başarıyla eklendi!');
                } else {
                    alert('Bu firma zaten kayıtlı!');
                }
            });

            // Eşleştirme ekleme butonu

            // ✏️/🗑️ Firma-Malzeme liste işlemleri (tek bind: render tekrarlarında takılmasın)
            addOnce(document.getElementById('eslestirmeFirmaEditBtn'), 'click', async () => {
                const sel = document.getElementById('eslestirmeFirmaSelect');
                const val = (sel?.value || '').trim();
                if (!val) { alert('Önce bir firma seçin.'); return; }

                const yeni = await prompt('Yeni firma kodu:', val);
                if (yeni === null) return;
                const yeniKod = String(yeni).trim();
                if (!yeniKod) return;

                // 1) Firma listesi
                const idx = firmaListesi.findIndex(f => getFirmaKodOnly(f) === val);
                if (idx >= 0) firmaStorage.update(idx, yeniKod);

                // 2) Eşleştirmelerde firma kodunu da güncelle (yoksa eşleşmeler bozulur)
                try {
                    let changed = false;
                    eslestirmeListesi = (eslestirmeListesi || []).map(es => {
                        if (es && es.firma === val) { changed = true; return { ...es, firma: yeniKod }; }
                        return es;
                    });
                    if (changed) eslestirmeStorage.save();
                } catch (e) {}

                showEslestirmeModal();
            });

            addOnce(document.getElementById('eslestirmeFirmaDeleteBtn'), 'click', async () => {
                const sel = document.getElementById('eslestirmeFirmaSelect');
                const val = (sel?.value || '').trim();
                if (!val) { alert('Önce bir firma seçin.'); return; }
                const ok = await confirm(`"${val}" firmasını silmek istiyor musunuz?\n\nBu firmaya ait eşleştirmeler de silinir.`);
                if (!ok) return;

                // firma listesi: aynı koda sahip tüm girdileri temizle
                firmaListesi = (firmaListesi || []).filter(f => getFirmaKodOnly(f) !== val);
                firmaStorage.save();

                // eşleştirmeler: firma eşleşmelerini kaldır
                try {
                    eslestirmeListesi = (eslestirmeListesi || []).filter(es => (es && es.firma !== val));
                    eslestirmeStorage.save();
                } catch (e) {}

                showEslestirmeModal();
            });

            addOnce(document.getElementById('eslestirmeMalzemeEditBtn'), 'click', async () => {
                const sel = document.getElementById('eslestirmeMalzemeSelect');
                const val = (sel?.value || '').trim();
                if (!val) { alert('Önce bir malzeme seçin.'); return; }

                const yeni = await prompt('Yeni malzeme adı:', val);
                if (yeni === null) return;
                const yeniAd = String(yeni).trim();
                if (!yeniAd) return;

                const idx = (malzemeListesi || []).findIndex(mz => String(mz).trim() === val);
                if (idx >= 0) malzemeStorage.update(idx, yeniAd);

                // eşleştirmelerde malzeme adını da güncelle
                try {
                    let changed = false;
                    eslestirmeListesi = (eslestirmeListesi || []).map(es => {
                        if (es && es.malzeme === val) { changed = true; return { ...es, malzeme: yeniAd }; }
                        return es;
                    });
                    if (changed) eslestirmeStorage.save();
                } catch (e) {}

                showEslestirmeModal();
            });

            addOnce(document.getElementById('eslestirmeMalzemeDeleteBtn'), 'click', async () => {
                const sel = document.getElementById('eslestirmeMalzemeSelect');
                const val = (sel?.value || '').trim();
                if (!val) { alert('Önce bir malzeme seçin.'); return; }
                const ok = await confirm(`"${val}" malzemesini silmek istiyor musunuz?\n\nBu malzemeye ait eşleştirmeler de silinir.`);
                if (!ok) return;

                // malzeme listesi
                malzemeListesi = (malzemeListesi || []).filter(mz => String(mz).trim() !== val);
                malzemeStorage.save();

                // eşleştirmeler
                try {
                    eslestirmeListesi = (eslestirmeListesi || []).filter(es => (es && es.malzeme !== val));
                    eslestirmeStorage.save();
                } catch (e) {}

                showEslestirmeModal();
            });


            addOnce(document.getElementById('eslestirmeEkleButton'), 'click', function() {
                const firmaSelect = document.getElementById('eslestirmeFirmaSelect');
                const malzemeSelect = document.getElementById('eslestirmeMalzemeSelect');
                const firmaInput = document.getElementById('eslestirmeFirmaInput');
                const malzemeInput = document.getElementById('eslestirmeMalzemeInput');
const ambalajBilgisi = document.getElementById('eslestirmeAmbalajInput')?.value.trim() || '';
const yuklemeNotu = document.getElementById('eslestirmeNotInput')?.value.trim() || '';
const sevkYeri = document.getElementById('eslestirmeSevkYeriInput')?.value.trim() || '';
                
                let firma = firmaSelect.value || firmaInput.value.trim();
                let malzeme = malzemeSelect.value || malzemeInput.value.trim();
                
                if (!firma && !malzeme) {
                    alert('Lütfen firma ve/veya malzeme girin!');
                    return;
                }
                
                if (eslestirmeStorage.add(firma, malzeme, ambalajBilgisi, yuklemeNotu, sevkYeri)) {

                    firmaSelect.value = '';
                    malzemeSelect.value = '';
                    firmaInput.value = '';
                    malzemeInput.value = '';
                    document.getElementById('eslestirmeSevkYeriInput') && (document.getElementById('eslestirmeSevkYeriInput').value = '');
                    showEslestirmeModal(); // Listeyi yenile
                    alert('✅ Eşleştirme başarıyla eklendi!');
                } else {
                    alert('Bu eşleştirme zaten kayıtlı!');
                }
            });

            // 🧹 Hafıza Temizle (eşleştirmeleri silmez) - sadece eski öneri/cache kayıtlarını sıfırlar
            addOnce(document.getElementById('eslestirmeMemoryCleanButton'), 'click', async function() {
                const ok = await confirm('Hafıza (öneriler) temizlenecek.\n\n• Eşleştirmeler SİLİNMEZ\n• Sadece daha önce yazdığınız son firma/malzeme/sevk yeri önerileri temizlenir\n\nDevam edilsin mi?');
                if (!ok) return;
                const result = clearRecentCaches();
                if (result) alert('✅ Hafıza temizlendi.');
                else alert('❌ Hafıza temizlenemedi.');
            });

            // Modal kapatma butonları
            document.getElementById('firmaModalKapatButton')?.addEventListener('click', kapatFirmaModal);
            document.getElementById('eslestirmeModalKapatButton')?.addEventListener('click', kapatEslestirmeModal);

            if (state.showForm) {
                ['cekiciPlaka','dorsePlaka','soforAdi','soforSoyadi','iletisim','tcKimlik'].forEach(field => {
                    const input = document.getElementById(field);
                    if (input) {
                        addOnce(input, 'input', (e) => {
                            let value = e.target.value;
                            if (field === 'cekiciPlaka' || field === 'dorsePlaka') {
                                value = formatPlakaForInput(value);
                                if (state.editingId) {
                                    const vid = state.editingId;
                                    state.vehicles = (state.vehicles || []).map((v) => {
                                        if (String(v.id) !== String(vid)) return v;
                                        return { ...v, [field]: formatPlakaForInput(value) };
                                    });
                                    try { _ihracatRefreshOpenModalStatuses(); } catch (_) {}
                                }
                            }
                            updateFormData(field, value);
                        });
                    }
                });
            }

            const searchInput = document.getElementById('searchInput');
            if (searchInput) {
                searchInput.value = state.searchTerm;
                searchInput.addEventListener('input', function(e) {
                    state.searchTerm = e.target.value;
                    state.showAll = !!(state.searchTerm && state.searchTerm.trim());
                    window.clearTimeout(window.__searchDebounce);
                    window.__searchDebounce = window.setTimeout(() => {
                        updateVehicleList();
                    }, 120);
                });
            

document.getElementById('showMoreButton')?.addEventListener('click', function () {
  const step = parseInt(state.pageSize, 10) || 20;
  const total = filterVehicles().length;

  // 20, 40, 60... şeklinde gitsin (ilk tıkta 20'ye tamamlar)
  if (state.listLimit < step) {
    state.listLimit = Math.min(step, total);
  } else {
    state.listLimit = Math.min(state.listLimit + step, total);
  }

  render(); // buton/kalan sayı güncellensin
});

}

            // Chip click: yüklüyse doğrudan ilgili detay / sipariş penceresi
            addOnce(document.getElementById('chipIhracat'), 'click', () => {
              const cnt = (typeof loadDailyShipments === 'function') ? ((loadDailyShipments() || []).length || 0) : 0;
              if (cnt > 0) {
                showIhracatDetailsModal();
              } else {
                showToast('❌ İhracat Excel yüklü değil.');
              }
            });

            addOnce(document.getElementById('chipPiyasa'), 'click', () => {
              try {
                const piyasaState = JSON.parse(localStorage.getItem('piyasa_state_v1') || 'null');
                if (piyasaState && piyasaState.orders && piyasaState.orders.length > 0) {
                  if (typeof window.piyasaShowOrdersModal === 'function') {
                    window.piyasaShowOrdersModal();
                  } else if (window.piyasa && typeof window.piyasa.openOrderPicker === 'function') {
                    window.piyasa.openOrderPicker();
                  } else {
                    showToast('❌ Piyasa modülü yüklenemedi. Ctrl+F5 ile yenileyin.');
                  }
                } else {
                  showToast('❌ Piyasa Excel yüklü değil.');
                }
              } catch (e) {
                showToast('❌ Piyasa Excel yüklü değil.');
              }
            });

            document.querySelectorAll('.edit-btn').forEach(btn => {
                btn.addEventListener('click', function() {
                    const vehicle = JSON.parse(this.getAttribute('data-vehicle'));
                    editVehicle(vehicle);
                });
            });

            document.querySelectorAll('.form-btn').forEach(btn => {
                btn.addEventListener('click', function() {
                    const vehicle = JSON.parse(this.getAttribute('data-vehicle'));
                    showTakipFormu(vehicle);
                });
            });

            document.querySelectorAll('.netsis-btn').forEach(btn => {
                btn.addEventListener('click', function() {
                    const vehicle = JSON.parse(this.getAttribute('data-vehicle'));
                    copyNetsisData(vehicle);
                });
            });

            document.querySelectorAll('.delete-btn').forEach(btn => {
                btn.addEventListener('click', function() {
                    const id = this.getAttribute('data-id');
                    deleteVehicle(id);
                });
            });
// 🖨️ Yazdır / Önizleme button handlers - NOT ADDED HERE (global setup prevents duplicates)        
  // Telefon formatı: 0555 022 75 53
  const telInp = document.getElementById('iletisim');
  if (telInp) {
    const apply = () => {
      const v = formatTRPhone(telInp.value);
      telInp.value = v;
      updateFormData('iletisim', v);
    };
    telInp.addEventListener('input', apply);
    telInp.addEventListener('blur', apply);
  }

  if (window.SessionManager && typeof window.SessionManager.bindAppPageNavigation === 'function') {
    window.SessionManager.bindAppPageNavigation();
  }
  if (window.SessionManager && typeof window.SessionManager.bindHomeNavigation === 'function') {
    window.SessionManager.bindHomeNavigation();
  }
  if (window.SessionManager && typeof window.SessionManager.claimHomeWindow === 'function') {
    window.SessionManager.claimHomeWindow();
  }

}

        
        // ✅ Kısayollar (4 kullanıcı için hız): / arama odak, Esc temizle, Enter ilk kaydı aç
        function focusSearchInput() {
            const s = document.getElementById('searchInput');
            if (s) {
                s.focus();
                // imleci sona al
                const v = s.value || '';
                s.setSelectionRange(v.length, v.length);
            }
        }

        function clearSearch() {
            state.searchTerm = '';
            state.showAll = false;
            const s = document.getElementById('searchInput');
            if (s) s.value = '';
            updateVehicleList();
            focusSearchInput();
        }


        function focusQuickPlateInput() {
            focusSearchInput();
        }

        function _plateKey(s){
            return String(s || '').toUpperCase().replace(/[\s-]+/g,'').trim();
        }

        function _todayDateVariantsTR(){
            try {
              const d = new Date();
              const dd = String(d.getDate()).padStart(2,'0');
              const mm = String(d.getMonth()+1).padStart(2,'0');
              const yyyy = d.getFullYear();
              const v1 = `${d.getDate()}.${mm}.${yyyy}`;
              const v2 = `${dd}.${mm}.${yyyy}`;
              const v3 = d.toLocaleDateString('tr-TR');
              const set = new Set([v1, v2, v3]);
              return Array.from(set).filter(Boolean);
            } catch(e){
              return [];
            }
        }

        function _isTodayKayit(kayitTarihi){
            const kt = String(kayitTarihi || '').trim();
            if (!kt) return false;
            const datePart = kt.split(' ')[0];
            const vars = _todayDateVariantsTR();
            if (vars.includes(datePart)) return true;
            return vars.some(v => kt.includes(v));
        }

        function _pickLatestById(list){
            const arr = Array.isArray(list) ? list.slice() : [];
            arr.sort((a,b)=> (parseInt(b?.id||'0',10)||0) - (parseInt(a?.id||'0',10)||0));
            return arr[0] || null;
        }

        function findBestVehicleByPlate(plate){
            const key = _plateKey(plate);
            if (!key) return null;
            const matches = (state.vehicles || []).filter(v => _plateKey(v?.cekiciPlaka) === key);
            if (!matches.length) return null;
            const todays = matches.filter(v => _isTodayKayit(v?.kayitTarihi));
            if (todays.length) return _pickLatestById(todays);
            return _pickLatestById(matches);
        }

        function openNewRecordWithPlate(plate){
            try {
              state.editingId = null;
              state.showForm = true;
              state.showAll = false;
              state.searchTerm = '';
              state.formData = {
                cekiciPlaka: formatPlakaForInput(plate),
                dorsePlaka: '',
                soforAdi: '',
                soforSoyadi: '',
                sofor2Adi: '',
                sofor2Soyadi: '',
                iletisim: '',
                tcKimlik: '',
                defaultFirma: '',
                defaultMalzeme: '',
                defaultSevkYeri: '',
                defaultYuklemeNotu: ''
              };
              render();
              setTimeout(()=>{ try { document.getElementById('soforAdi')?.focus(); } catch(_) {} }, 0);
            } catch(e) {}
        }

        window.openNewRecordWithPlate = openNewRecordWithPlate;
        window.editVehicleRecord = editVehicle;
        window.renderApp = render;
        try {
          window.addEventListener('app:render-request', () => { try { render(); } catch (e) {} });
        } catch (e) {}

        function submitQuickPlate(){
            const inp = document.getElementById('quickPlateInput');
            if (!inp) return;
            const raw = (inp.value || '').trim();
            if (!raw) return;
            const formatted = formatPlakaForInput(raw);
            inp.value = formatted;
            state.quickPlateTerm = formatted;
            const v = findBestVehicleByPlate(formatted);
            if (v) {
                try { showTakipFormu(v); } catch(e) {}
            } else {
                openNewRecordWithPlate(formatted);
            }
        }

        function _piyasaLoadedCount(){
            try {
              const raw = localStorage.getItem('piyasa_state_v1');
              if (!raw) return 0;
              const payload = JSON.parse(raw);
              const orders = payload && payload.orders;
              return Array.isArray(orders) ? orders.length : 0;
            } catch(e){ return 0; }
        }

        function isKioskModeOn(){
            try { return localStorage.getItem('kiosk_mode_v1') === '1'; } catch(e){ return false; }
        }
        function setKioskModeOn(on){
            try { localStorage.setItem('kiosk_mode_v1', on ? '1' : '0'); } catch(e) {}
            try { document.body && document.body.classList.toggle('kiosk-mode', !!on); } catch(e) {}
        }
        function toggleKioskMode(){
            const on = !isKioskModeOn();
            setKioskModeOn(on);
            // fullscreen best-effort
            try {
              if (on) {
                const el = document.documentElement;
                if (el && el.requestFullscreen) el.requestFullscreen();
              } else {
                if (document.exitFullscreen) document.exitFullscreen();
              }
            } catch(e) {}
            try { render(); } catch(e) {}
            setTimeout(()=>{ try { focusQuickPlateInput(); } catch(_) {} }, 0);
        }

        // Global kısayol dinleyici (tek sefer)
        if (!window.__shortcutsBound) {
            window.__shortcutsBound = true;
            document.addEventListener('keydown', function (e) {
                if (!isLoggedIn) return;
                const rpOv = document.getElementById('rpDialogOverlay');
                if (rpOv && !rpOv.hidden) return;
                if (window.rpDialog && typeof window.rpDialog.isOpen === 'function' && window.rpDialog.isOpen()) return;

                const tag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : '';
                const typingInField = tag === 'input' || tag === 'textarea' || (e.target && e.target.isContentEditable);
                const activeId = (document.activeElement && document.activeElement.id) ? document.activeElement.id : '';

                // F2 -> arama kutusu odak
                if (e.key === 'F2') {
                    e.preventDefault();
                    focusQuickPlateInput();
                    return;
                }

                // F4 -> Yeni Kayıt aç/kapat
                if (e.key === 'F4') {
                    e.preventDefault();
                    document.getElementById('toggleFormButton')?.click();
                    setTimeout(()=>{ try { document.getElementById('cekiciPlaka')?.focus(); } catch(_) {} }, 0);
                    return;
                }

                // "/" -> arama odak (input içinde değilken)
                if (!typingInField && e.key === '/') {
                    e.preventDefault();
                    focusSearchInput();
                    return;
                }

                // ESC -> önce modalları kapat, değilse formu kapat, değilse aramayı temizle
                if (e.key === 'Escape') {
                    if (window.__piyasaPickerOpen) {
                        if (!document.querySelector('[data-piyasa-modal-layer="1"]')) {
                            e.preventDefault();
                            try {
                              if (typeof window.__piyasaCloseOrderPicker === 'function') window.__piyasaCloseOrderPicker();
                              else document.getElementById('piyasaModalClose')?.click();
                            } catch (_) {}
                            return;
                        }
                        return;
                    }

                    const takipModal = document.getElementById('takipFormuModal');
                    if (takipModal && !takipModal.classList.contains('hidden')) {
                        e.preventDefault();
                        try { typeof kapatForm === 'function' ? kapatForm() : takipModal.classList.add('hidden'); } catch(_) { takipModal.classList.add('hidden'); }
                        return;
                    }

                    const firmaModal = document.getElementById('firmaYonetimModal');
                    if (firmaModal && !firmaModal.classList.contains('hidden')) {
                        e.preventDefault();
                        try { typeof kapatFirmaModal === 'function' ? kapatFirmaModal() : firmaModal.classList.add('hidden'); } catch(_) { firmaModal.classList.add('hidden'); }
                        return;
                    }

                    const esModal = document.getElementById('eslestirmeModal');
                    if (esModal && !esModal.classList.contains('hidden')) {
                        e.preventDefault();
                        try { typeof kapatEslestirmeModal === 'function' ? kapatEslestirmeModal() : esModal.classList.add('hidden'); } catch(_) { esModal.classList.add('hidden'); }
                        return;
                    }

                    try {
                      if (typeof state !== 'undefined' && state.showForm) {
                        e.preventDefault();
                        try { typeof resetForm === 'function' ? resetForm() : (state.showForm=false, render()); } catch(_) {}
                        return;
                      }
                    } catch(_) {}

                    if (state.searchTerm && state.searchTerm.trim()) {
                        e.preventDefault();
                        clearSearch();
                        return;
                    }
                    // hiç bir şey yoksa ESC'yi bırak
                    return;
                }

                if (e.key === 'Enter') {
                    // Yeni kayıt formu açıkken Enter -> Kaydet
                    if (typeof state !== 'undefined' && state.showForm) {
                        const ids = ['cekiciPlaka','dorsePlaka','soforAdi','soforSoyadi','iletisim','tcKimlik'];
                        if (ids.includes(activeId)) {
                            e.preventDefault();
                            document.getElementById('saveButton')?.click();
                            return;
                        }
                    }

                    // 3) Arama kutusundayken ilk kaydı aç
                    const s = document.getElementById('searchInput');
                    if (s && document.activeElement === s) {
                        const filtered = filterVehicles();
                        if (filtered && filtered.length) {
                            e.preventDefault();
                            showTakipFormu(filtered[0]);
                            return;
                        }
                    }
                }
            }, true);
        }


            

        // Giriş fonksiyonu
        // SHA-256 helper
async function sha256Hex(text) {
  /* WebCrypto (crypto.subtle) file:// gibi ortamlarda kapalı olabilir */
  try {
    if (window.crypto && window.crypto.subtle) {
      const enc = new TextEncoder().encode(text);
      const digest = await window.crypto.subtle.digest("SHA-256", enc);
      return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, "0")).join("");
    }
  } catch (e) {}
  return null;
}

// Giriş fonksiyonu (async) - Optimized for instant transition
// ✅ Tek yerden giriş (login düşmesini azaltır)
function enterAppWithDelay(ms = 0) {
  if (isEnteringApp) return;
  isEnteringApp = true;

  const loginScreen = document.getElementById('loginScreen');
  const mainApp = document.getElementById('mainApp');

  // Instant transition - no loading overlay
  try {
    try { document.documentElement.classList.add('logged-in'); } catch (e) {}
    if (loginScreen) {
      loginScreen.style.setProperty('display', 'none', 'important');
    }
    if (mainApp) {
      mainApp.style.setProperty('display', 'block', 'important');
    }

    state.vehiclesLoading = true;
    try { if (typeof render === 'function') render(); } catch (e) {}

    const runLoad = () => {
      try {
        if (typeof window.ensureXlsxLoaded === 'function') {
          window.ensureXlsxLoaded().catch(() => {});
        }
        if (window.SignatureRegistry && typeof window.SignatureRegistry.loadSignatures === 'function') {
          window.SignatureRegistry.loadSignatures(true).catch(() => {});
        }
        loadVehicles().finally(() => { isEnteringApp = false; });
      } catch (e) {
        console.error('loadVehicles hata:', e);
        state.vehiclesLoading = false;
        isEnteringApp = false;
      }
    };
    if (ms > 0) setTimeout(runLoad, ms);
    else runLoad();
  } catch (e) {
    console.error('enterAppWithDelay hata:', e);
    isEnteringApp = false;
    // Güvenli fallback
    if (mainApp) mainApp.style.display = 'none';
    if (loginScreen) loginScreen.style.display = 'flex';
  }
}

async function login() {
  const idInput = document.getElementById('loginId');
  const passInput = document.getElementById('loginPassword');
  const id = (idInput.value || '').trim();
  const password = (passInput.value || '').trim();
  const loginError = document.getElementById('loginError');

  if (loginError) loginError.classList.add('hidden');
  idInput.classList.remove('border-red-500');
  passInput.classList.remove('border-red-500');

  if (!id || !password) {
    if (loginError) loginError.classList.remove('hidden');
    idInput.classList.add('border-red-500');
    passInput.classList.add('border-red-500');
    return;
  }

  // Skip loading overlay for instant login

  try {
    const resp = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: id, password })
    });

    // Loading overlay removed

    if (!resp.ok) {
      try {
        const j = await resp.json();
        if (loginError) {
          let msg = j && j.error ? j.error : 'Giriş başarısız';
          if (j && (j.code === 'IP_BANNED' || /engellendi|banned/i.test(msg))) {
            msg += ' — Acil kurtarma: ayarlar.html#ban (ayarlar parolası ile IP engelini kaldırın).';
          }
          loginError.textContent = msg;
          loginError.classList.remove('hidden');
        }
      } catch (e) { if (loginError) loginError.classList.remove('hidden'); }
      passInput.value = '';
      idInput.classList.add('border-red-500');
      passInput.classList.add('border-red-500');
      passInput.focus();
      return;
    }

    const data = await resp.json();
    if (!data || !data.ok) {
      if (loginError) { loginError.textContent = (data && data.error) ? data.error : 'Giriş başarısız'; loginError.classList.remove('hidden'); }
      return;
    }

    // Server set httpOnly cookie; avoid storing token in localStorage
    try { localStorage.setItem('currentUserId', id); } catch(e){}
    try { localStorage.setItem('isLoggedIn', 'true'); } catch(e){}
    syncLoginFlag(true);
    if (window.SessionManager && typeof window.SessionManager.markSessionValid === 'function') {
      window.SessionManager.markSessionValid();
    }
    try { if (window.storage && typeof window.storage.invalidate === 'function') window.storage.invalidate(); } catch (e) {}
    state.vehiclesLoading = true;
    try { document.documentElement.classList.add('logged-in'); } catch(e){}

    // Start session monitoring to prevent white screen on token expiry
    startSessionMonitoring();

    // Initialize protected data now that auth succeeded
    try { if (typeof startPostLoginTasks === 'function') startPostLoginTasks(); } catch(e){}

    // ✅ Redirect after login kontrolü
    try {
      const redirectPath = localStorage.getItem('redirectAfterLogin');
      if (redirectPath && redirectPath !== window.location.pathname) {
        localStorage.removeItem('redirectAfterLogin');
        window.location.href = redirectPath;
        return; // enterAppWithDelay'i çalıştırma
      }
    } catch(e) {}

    // start app
    try {
      enterAppWithDelay(0);
      try { if (typeof window.checkReprintParam === 'function') window.checkReprintParam(); } catch (e) { /* ignore */ }
    } catch(e) { try { if (typeof loadVehicles === 'function') loadVehicles(); } catch(e){} }

  } catch (e) {
    // Loading overlay removed
    if (loginError) { loginError.textContent = 'Giriş sırasında hata oluştu'; loginError.classList.remove('hidden'); }
  }
}

// Validate stored token with server; if invalid, clear auth and show login
async function validateToken() {
  // Validate server-side session via /api/me (cookie based)
  try {
    const resp = await fetch('/api/me', { method: 'GET', credentials: 'include' });
    if (resp.ok) {
      const j = await resp.json().catch(()=>null);
      syncLoginFlag(true);
      state.vehiclesLoading = true;
      try { localStorage.setItem('isLoggedIn', 'true'); } catch(e){}
      try { document.documentElement.classList.add('logged-in'); } catch(e){}
      if (j && j.user && j.user.username) {
        try { localStorage.setItem('currentUserId', j.user.username); } catch(e){}
      }
      try { if (typeof startPostLoginTasks === 'function') startPostLoginTasks(); } catch(e){}
      if (window.SessionManager && typeof window.SessionManager.markSessionValid === 'function') {
        window.SessionManager.markSessionValid();
      }
      return;
    }
    // Yalnızca gerçek oturum bitişinde çıkış — geçici sunucu/ağ hatasında local oturumu koru
    if (resp.status !== 401 && resp.status !== 403) {
      console.warn('validateToken: geçici /api/me hatası, oturum korunuyor:', resp.status);
      syncLoginFlag(true);
      try { localStorage.setItem('isLoggedIn', 'true'); } catch(e){}
      try { document.documentElement.classList.add('logged-in'); } catch(e){}
      if (window.SessionManager && typeof window.SessionManager.markSessionValid === 'function') {
        window.SessionManager.markSessionValid();
      }
      try { if (typeof startPostLoginTasks === 'function') startPostLoginTasks(); } catch(e){}
      return;
    }
  } catch (e) {
    console.warn('validateToken: ağ hatası, oturum korunuyor:', e && e.message ? e.message : e);
    syncLoginFlag(true);
    try { localStorage.setItem('isLoggedIn', 'true'); } catch(e){}
    try { document.documentElement.classList.add('logged-in'); } catch(e){}
    if (window.SessionManager && typeof window.SessionManager.markSessionValid === 'function') {
      window.SessionManager.markSessionValid();
    }
    try { if (typeof startPostLoginTasks === 'function') startPostLoginTasks(); } catch(e){}
    return;
  }

  syncLoginFlag(false);
  try { localStorage.removeItem('isLoggedIn'); } catch(e){}
  try { localStorage.removeItem('currentUserId'); } catch(e){}
  try { document.documentElement.classList.remove('logged-in'); } catch(e){}
  try {
    const mainApp = document.getElementById('mainApp');
    const loginScreen = document.getElementById('loginScreen');
    if (mainApp) mainApp.style.display = 'none';
    if (loginScreen) loginScreen.style.display = 'flex';
  } catch (e) {}
  try { showSessionExpiredModal(); } catch (e) {}
}

function startPostLoginTasks() {
  try {
    if (window.storage && typeof window.storage._readAll === 'function') {
      window.storage._readAll().catch(()=>{});
    }
  } catch(e) {}
  // Sunucu sayaçları geldikten sonra kartları tekrar çiz; aksi halde eski localStorage
  // sorunları "hayalet rozet/overlay" olarak kalır.
  try {
    if (typeof updateIssuesIndicators === 'function') {
      Promise.resolve(updateIssuesIndicators()).then(() => {
        if (state.vehiclesLoading) return;
        try { if (typeof render === 'function') render(); } catch (e) { /* ignore */ }
        try { if (typeof updateVehicleList === 'function') updateVehicleList(); } catch (e) { /* ignore */ }
      }).catch(() => { /* ignore */ });
    }
  } catch(e) {}
  try { if (typeof startReportCache === 'function') startReportCache(); } catch(e) {}
}

// Session monitoring to prevent white screen on token expiry
let sessionCheckInterval = null;
let lastActivityTime = Date.now();
let activityListeners = []; // Track listeners for cleanup
const INACTIVITY_TIMEOUT_MS = 60 * 60 * 1000; // 60 minutes (increased from 30)
const ACTIVITY_CHECK_INTERVAL_MS = 30 * 1000; // Check every 30 seconds (reduced from 5 minutes)

function startSessionMonitoring() {
  console.log('startSessionMonitoring() çağrıldı');
  
  // Clear any existing interval
  if (sessionCheckInterval) {
    clearInterval(sessionCheckInterval);
  }

  // Clear old activity listeners
  activityListeners.forEach(({ event, handler }) => {
    try {
      document.removeEventListener(event, handler, { passive: true });
    } catch (e) {}
  });
  activityListeners = [];

  // Track user activity
  const activityEvents = ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart', 'click'];
  const updateActivity = () => { lastActivityTime = Date.now(); };
  
  activityEvents.forEach(event => {
    document.addEventListener(event, updateActivity, { passive: true });
    activityListeners.push({ event, handler: updateActivity });
  });
  
  console.log('Activity listeners eklendi:', activityListeners.length);

  // Check session every 30 seconds
  sessionCheckInterval = setInterval(async () => {
    const now = Date.now();
    const timeSinceActivity = now - lastActivityTime;

    // Sunucu oturum kontrolü (JWT süresi dolmuşsa giriş ekranına yönlendir)
    if (isLoggedIn && window.SessionManager && typeof window.SessionManager.checkSessionValidity === 'function') {
      try {
        const serverValid = await window.SessionManager.checkSessionValidity();
        if (!serverValid) {
          if (sessionCheckInterval) {
            clearInterval(sessionCheckInterval);
            sessionCheckInterval = null;
          }
          stopSessionMonitoring();
          syncLoginFlag(false);
          try { localStorage.removeItem('isLoggedIn'); } catch (e) {}
          try { localStorage.removeItem('currentUserId'); } catch (e) {}
          try { document.documentElement.classList.remove('logged-in'); } catch (e) {}
          const mainApp = document.getElementById('mainApp');
          const loginScreen = document.getElementById('loginScreen');
          if (mainApp) mainApp.style.display = 'none';
          if (loginScreen) loginScreen.style.display = 'flex';
          await showSessionExpiredModal();
          try { fetch('/api/logout', { method: 'POST' }).catch(() => {}); } catch (e) {}
          return;
        }
      } catch (e) {
        console.warn('Sunucu oturum kontrolü atlandı:', e && e.message ? e.message : e);
      }
    }

    // Check if user has been inactive
    if (timeSinceActivity > INACTIVITY_TIMEOUT_MS) {
      // IMMEDIATELY STOP THE INTERVAL
      if (sessionCheckInterval) {
        clearInterval(sessionCheckInterval);
        sessionCheckInterval = null;
      }
      
      // Show modal FIRST
      await showSessionExpiredModal();
      
      // Then logout
      syncLoginFlag(false);
      
      // Show loading overlay to prevent white screen
      const loader = document.createElement('div');
      loader.id = 'logout-overlay';
      loader.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: white;
        z-index: 999998;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 16px;
        color: #666;
      `;
      loader.innerHTML = 'Çıkış yapılıyor...';
      document.body.appendChild(loader);
      
      // Stop all monitoring
      stopSessionMonitoring();
      
      // Tell server to clear cookie
      try { fetch('/api/logout', { method: 'POST' }).catch(()=>{}); } catch(e){}
      
      // Clear localStorage
      localStorage.removeItem('isLoggedIn');
      localStorage.removeItem('currentUserId');
      
      // Remove logged-in class
      try { document.documentElement.classList.remove('logged-in'); } catch (e) {}
      
      // Clear form
      const loginId = document.getElementById('loginId');
      const loginPassword = document.getElementById('loginPassword');
      if (loginId) loginId.value = '';
      if (loginPassword) loginPassword.value = '';
      
      // Hide main, show login
      const mainApp = document.getElementById('mainApp');
      const loginScreen = document.getElementById('loginScreen');
      if (mainApp) mainApp.style.display = 'none';
      if (loginScreen) loginScreen.style.display = 'flex';
      
      console.log('LOGIN EKRANI GORUNUR YAPILDI');
      
      // Remove loading overlay
      setTimeout(() => {
        if (loader && loader.parentNode) loader.remove();
      }, 300);
    }
  }, ACTIVITY_CHECK_INTERVAL_MS);
  console.log('Session monitoring interval başlatıldı');
}

function stopSessionMonitoring() {
  console.log('stopSessionMonitoring() çağrıldı');
  if (sessionCheckInterval) {
    clearInterval(sessionCheckInterval);
    sessionCheckInterval = null;
    console.log('Session interval temizlendi');
  }
  
  // Remove all activity listeners
  activityListeners.forEach(({ event, handler }) => {
    try {
      document.removeEventListener(event, handler, { passive: true });
    } catch (e) {}
  });
  activityListeners = [];
  console.log('Activity listeners temizlendi');
}


        // Çıkış fonksiyonu - with confirmation
      function logout() {
        showPersistentConfirmModal('Çıkış yapmak istediğinizden emin misiniz?', 'Evet Çıkış Yap', 'İptal').then(confirmed => {
          if (confirmed) {
            logoutSilent();
          }
        }).catch(() => {});
      }

      // Silent logout - no confirm, just cleanup and redirect
      function logoutSilent() {
        console.log('logoutSilent() başladı');
        try {
          syncLoginFlag(false);
          console.log('isLoggedIn = false');
          
          // 1. Show loading overlay to prevent white screen
          const loader = document.createElement('div');
          loader.id = 'logout-overlay';
          loader.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: white;
            z-index: 999998;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 16px;
            color: #666;
          `;
          loader.innerHTML = 'Çıkış yapılıyor...';
          document.body.appendChild(loader);
          console.log('Loading overlay gösterildi');
          
          // 2. Stop all monitoring and cleanup
          stopSessionMonitoring();
          console.log('Session monitoring durduruldu');
          
          // 3. Remove session modal if visible
          const sessionModal = document.getElementById('session-expired-modal');
          if (sessionModal) {
            sessionModal.remove();
            console.log('Session modal kaldırıldı');
          }
          
          // 4. Tell server to clear cookie (fire and forget)
          try { fetch('/api/logout', { method: 'POST' }).catch(()=>{}); } catch(e){}
          console.log('Server logout isteği gönderildi');
          
          // 5. Clear localStorage
          localStorage.removeItem('isLoggedIn');
          localStorage.removeItem('currentUserId');
          console.log('localStorage temizlendi');
          
          // 6. Update CSS and DOM in single batch to prevent reflow
          try { document.documentElement.classList.remove('logged-in'); } catch (e) {}
          console.log('logged-in class kaldırıldı');
          
          // 7. Clear form inputs
          const loginId = document.getElementById('loginId');
          const loginPassword = document.getElementById('loginPassword');
          if (loginId) loginId.value = '';
          if (loginPassword) loginPassword.value = '';
          console.log('Form inputları temizlendi');
          
          // 8. Update DOM visibility
          const mainApp = document.getElementById('mainApp');
          const loginScreen = document.getElementById('loginScreen');
          if (mainApp) mainApp.style.display = 'none';
          if (loginScreen) loginScreen.style.display = 'flex';
          console.log('DOM visibility güncellendi');
          
          // 9. Remove loading overlay
          setTimeout(() => {
            if (loader && loader.parentNode) loader.remove();
            console.log('Loading overlay kaldırıldı - login ekranı gösteriliyor');
          }, 300);
          
        } catch (e) {
          console.error('Logout error:', e);
        }
      }


        // Form toggle
        function toggleForm() {
            state.showForm = !state.showForm;
            if (!state.showForm) {
                resetForm();
            } else {
            render();
            // Form açıldığında ilk alan (çekici plaka) otomatik odaklansın
            window.setTimeout(() => {
              try { document.getElementById('cekiciPlaka')?.focus(); } catch(_) {}
            }, 0);
            }
        }

        // Kayıt ekle/güncelle
        function saveFromForm() {
            // Tüm alanları büyük harfe çevir ve plakaları formatla
            state.formData.cekiciPlaka = formatPlakaForInput(document.getElementById('cekiciPlaka').value);
            state.formData.dorsePlaka = formatPlakaForInput(document.getElementById('dorsePlaka').value);
            state.formData.soforAdi = document.getElementById('soforAdi').value.toUpperCase();
            state.formData.soforSoyadi = document.getElementById('soforSoyadi').value.toUpperCase();
            state.formData.sofor2Adi = document.getElementById('sofor2Adi')?.value?.toUpperCase() || '';
            state.formData.sofor2Soyadi = document.getElementById('sofor2Soyadi')?.value?.toUpperCase() || '';
            state.formData.iletisim = document.getElementById('iletisim').value.toUpperCase();
            state.formData.tcKimlik = document.getElementById('tcKimlik').value;
            state.formData.defaultFirma = document.getElementById('defaultFirma')?.value || '';
            state.formData.defaultMalzeme = document.getElementById('defaultMalzeme')?.value || '';
            state.formData.defaultSevkYeri = document.getElementById('defaultSevkYeri')?.value || '';
            state.formData.defaultYuklemeNotu = document.getElementById('defaultYuklemeNotu')?.value || '';
            saveVehicle();

            // Seri giriş için: formu temizle ve plakaya odaklan
            try {
              resetForm();
              window.setTimeout(() => {
                try { document.getElementById('cekiciPlaka')?.focus(); } catch(_) {}
              }, 0);
            } catch(_) {}
        }

        // Düzenle
        function editVehicle(vehicle) {
                        state.formData = {
                cekiciPlaka: vehicle.cekiciPlaka,
                dorsePlaka: vehicle.dorsePlaka,
                soforAdi: vehicle.soforAdi,
                soforSoyadi: vehicle.soforSoyadi,
                sofor2Adi: vehicle.sofor2Adi || '',
                sofor2Soyadi: vehicle.sofor2Soyadi || '',
                iletisim: vehicle.iletisim,
                tcKimlik: vehicle.tcKimlik,
                defaultFirma: vehicle.defaultFirma || '',
                defaultMalzeme: vehicle.defaultMalzeme || '',
                defaultSevkYeri: vehicle.defaultSevkYeri || '',
                defaultYuklemeNotu: vehicle.defaultYuklemeNotu || ''
            };
            state.editingId = vehicle.id;
            state.showForm = true;
            render();
        }

const DELETE_VEHICLE_PASSWORD = '2026genper';

