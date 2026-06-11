// app-vehicles.js — araç CRUD + liste
// Otomatik bölüm — scripts/split-large-files.js

async function restoreDeletedVehicle(vehicle, ui) {
    if (!vehicle) return false;
    try {
        const response = await fetch('/api/vehicles', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(vehicle)
        });
        if (!response.ok) {
            if (typeof ui.alert === 'function') await ui.alert('Geri alma başarısız.', 'danger');
            else alert('Geri alma başarısız.');
            return false;
        }
        const exists = state.vehicles.some(v => String(v.id) === String(vehicle.id));
        if (!exists) state.vehicles.unshift(vehicle);
        storage.save('vehicle_' + vehicle.id, vehicle);
        render();
        if (typeof ui.alert === 'function') await ui.alert('Kayıt geri getirildi.', 'success');
        else alert('Kayıt geri getirildi.');
        return true;
    } catch (e) {
        console.error('Geri alma hatası:', e);
        if (typeof ui.alert === 'function') await ui.alert('Geri alma başarısız.', 'danger');
        else alert('Geri alma başarısız.');
        return false;
    }
}

async function deleteVehicle(id) {
    const vehicle = state.vehicles.find(v => v.id === id);
    if (!vehicle) return;
    const snapshot = JSON.parse(JSON.stringify(vehicle));
    const plaka = vehicle.cekiciPlaka ? formatPlaka(vehicle.cekiciPlaka) : '';
    const ui = window.rpUi || {};

    let ok = false;
    if (typeof ui.confirm === 'function') {
        ok = await ui.confirm('"' + plaka + '" kaydı silinsin mi?', { okLabel: 'Sil' });
    } else {
        ok = await confirm('"' + plaka + '" kaydı silinsin mi?');
    }
    if (!ok) return;

    let entered = null;
    if (typeof ui.password === 'function') {
        entered = await ui.password('Silme şifresini giriniz:');
    } else {
        entered = await window.rpUi.password('Silme şifresini giriniz:');
    }
    if (entered == null || entered === false) return;
    if (String(entered).trim() !== DELETE_VEHICLE_PASSWORD) {
        if (typeof ui.alert === 'function') await ui.alert('Şifre hatalı.', 'danger');
        else alert('Şifre hatalı.');
        return;
    }

    try {
        const response = await fetch('/api/vehicles/' + encodeURIComponent(String(id)), {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' }
        });
        if (!response.ok) {
            console.error('Araç DB silme hatası:', response.status);
            if (typeof ui.alert === 'function') await ui.alert('Araç silinirken hata oluştu!', 'danger');
            else alert('Araç silinirken hata oluştu!');
            return;
        }
    } catch (error) {
        console.error('Araç DB silme hatası:', error);
        if (typeof ui.alert === 'function') await ui.alert('Araç silinirken hata oluştu!', 'danger');
        else alert('Araç silinirken hata oluştu!');
        return;
    }

    try {
        const log = JSON.parse(localStorage.getItem('deletionLog') || '[]');
        log.unshift({
            ts: new Date().toISOString(),
            userId: (localStorage.getItem('currentUserId') || '').toUpperCase(),
            id,
            cekiciPlaka: vehicle.cekiciPlaka || '',
            dorsePlaka: vehicle.dorsePlaka || '',
            sofor: ((vehicle.soforAdi || '') + ' ' + (vehicle.soforSoyadi || '')).trim()
        });
        localStorage.setItem('deletionLog', JSON.stringify(log.slice(0, 200)));
    } catch (e) {
        console.error('deletionLog yazılamadı:', e);
    }

    storage.delete('vehicle_' + id);
    state.vehicles = state.vehicles.filter(v => v.id !== id);
    render();

    let choice = 'ok';
    if (typeof ui.alertActions === 'function') {
        choice = await ui.alertActions('Kayıt silindi.', 'success', [
            { label: 'Geri Al', value: 'undo', className: 'rp-dialog-btn-ghost' },
            { label: 'Tamam', value: 'ok', className: 'rp-dialog-btn-primary' }
        ]);
    } else {
        alert('Kayıt silindi!');
    }
    if (choice === 'undo') await restoreDeletedVehicle(snapshot, ui);
}

         function maskTc(tc) {
    if (!tc || tc.length !== 11) return tc;
    return tc.slice(0, 4) + '*****' + tc.slice(9);
          }
        // Sadece araç listesini güncelle
        function updateVehicleList() {
            if (!isLoggedIn) return;
            const filteredVehicles = filterVehicles();
            const hasSearch = !!(state.searchTerm && state.searchTerm.trim());
            // ⚡ Performans: Arama yapılırken bile bir üst sınır uygula. Aksi halde
            // 500+ araç olduğunda her tuşa basışta yüzlerce kart yeniden çizilip
            // sistem kasıyor. Kullanıcı sonuçları daraltmak için yazıyor zaten.
            const searchCap = Math.max(parseInt(state.pageSize, 10) || 20, 50);
            let visibleVehicles;
            if (hasSearch) {
                visibleVehicles = filteredVehicles.slice(0, searchCap);
            } else if (state.showAll) {
                visibleVehicles = filteredVehicles;
            } else {
                visibleVehicles = filteredVehicles.slice(0, state.listLimit);
            }
            const vehicleListContainer = document.getElementById('vehicleList');

            if (!vehicleListContainer) return;

            const hiddenInSearch = hasSearch ? Math.max(0, filteredVehicles.length - visibleVehicles.length) : 0;
            const searchMoreHintHTML = hiddenInSearch > 0
                ? `<div class="col-span-full text-center text-sm text-gray-500 py-3">↳ ${hiddenInSearch} kayıt daha var. Aramayı daha da daraltın.</div>`
                : '';

            vehicleListContainer.innerHTML = state.vehiclesLoading
                ? vehicleListSkeletonHTML()
                : (filteredVehicles.length === 0
                    ? vehicleListEmptyHTML()
                    : (visibleVehicles.map((vehicle) => vehicleCardHTML(vehicle)).join('') + searchMoreHintHTML));

            const statsContainer = document.getElementById('stats');
            if (statsContainer && state.vehicles.length > 0) {
                statsContainer.innerHTML = `
                    <p class="text-center text-gray-600">
                        Toplam <span class="font-bold text-indigo-600">${state.vehicles.length}</span> araç kaydı
                        ${state.searchTerm && filteredVehicles.length !== state.vehicles.length ?
                            `| Bulunan: <span class="font-bold text-indigo-600">${filteredVehicles.length}</span>` : ''}
                    </p>
                `;
            }

            // ⚡ Event delegation: her render'da yüzlerce listener bağlamak yerine
            // konteynere bir kez bağla, tıklamayı hedefin classına göre dağıt.
            _bindVehicleListDelegation(vehicleListContainer);
        }

        // Konteynere bir defa bağlanan delege handler
        function _bindVehicleListDelegation(container) {
            if (!container || container.__cardClickBound) return;
            container.__cardClickBound = true;
            container.addEventListener('click', function (e) {
                const t = e.target.closest('.edit-btn, .form-btn, .netsis-btn, .copy-card-btn, .delete-btn');
                if (!t || !container.contains(t)) return;
                try {
                    if (t.classList.contains('delete-btn')) {
                        const id = t.getAttribute('data-id');
                        deleteVehicle(id);
                        return;
                    }
                    const raw = t.getAttribute('data-vehicle');
                    if (!raw) return;
                    const vehicle = JSON.parse(raw);
                    if (t.classList.contains('edit-btn')) editVehicle(vehicle);
                    else if (t.classList.contains('form-btn')) showTakipFormu(vehicle);
                    else if (t.classList.contains('netsis-btn')) copyNetsisData(vehicle);
                    else if (t.classList.contains('copy-card-btn')) copyCardInfo(vehicle);
                } catch (err) { console.error('vehicle click handler error:', err); }
            });
        }

        // ✅ URL parametrelerinden reprint öğesini kontrol et
        function checkReprintParam() {
          try {
            // İlk çağrıda parametreleri sakla, sonraki çağrılarda saklananları kullan
            const savedReprintId = window.__tempReprintId;
            const savedPlatePrm = window.__tempPlatePrm;
            
            let reprintId, platePrm;
            if (savedReprintId || savedPlatePrm) {
              // Saklanan parametreleri kullan
              reprintId = savedReprintId;
              platePrm = savedPlatePrm;
              console.log('🔍 Saklanan parametreler kullanılıyor - reprintId:', reprintId, 'platePrm:', platePrm);
            } else {
              // Rapor sayfasından yeniden yazdır (sayfa yenilemeden localStorage)
              try {
                const pendingRaw = localStorage.getItem('pendingReprint');
                if (pendingRaw) {
                  const pending = JSON.parse(pendingRaw);
                  const age = Date.now() - (Number(pending.at) || 0);
                  if (age < 120000) {
                    reprintId = pending.reprint || pending.vehicleId || '';
                    platePrm = pending.plate || '';
                    window.__tempReprintId = reprintId;
                    window.__tempPlatePrm = platePrm;
                    localStorage.removeItem('pendingReprint');
                    console.log('🔍 pendingReprint kullanıldı - reprintId:', reprintId, 'platePrm:', platePrm);
                  } else {
                    localStorage.removeItem('pendingReprint');
                  }
                }
              } catch (e) { /* ignore */ }

              if (!reprintId && !platePrm) {
                // İlk çağrı - URL'den parametreleri al ve sakla
                const params = new URLSearchParams(window.location.search);
                reprintId = params.get('reprint');
                platePrm = params.get('plate');
                window.__tempReprintId = reprintId;
                window.__tempPlatePrm = platePrm;
                console.log('🔍 Yeni parametreler alındı ve saklandı - reprintId:', reprintId, 'platePrm:', platePrm);
              }
            }
            
            if (reprintId || platePrm) {
              // URL'i temizle (sadece ilk çağrıda)
              if (!savedReprintId && !savedPlatePrm) {
                window.history.replaceState({}, document.title, window.location.pathname);
                console.log('🔍 URL temizlendi');
              }
              
              // ✅ Araç verilerinin yüklendiğinden emin ol
              if (state.vehiclesLoading || !state.vehicles || !state.vehicles.length) {
                console.log('🔄 Araç verileri yükleniyor, reprint kontrolü erteleniyor...');
                loadVehicles();
                
                // Storage yüklenmesini bekle ve sonra kontrol et
                const waitForVehicles = () => {
                  if (!state.vehiclesLoading && state.vehicles && state.vehicles.length > 0) {
                    console.log('✅ Araç verileri yüklendi, reprint kontrolü devam ediyor...');
                    // Tekrar kontrol et
                    checkReprintParam();
                  } else {
                    console.log('⏳ Araç verileri henuz yüklenmedi, bekleniyor...');
                    setTimeout(waitForVehicles, 500);
                  }
                };
                setTimeout(waitForVehicles, 100);
                return;
              }
              
              // Vehicle'ı bul
              console.log('🔍 Araç aranıyor - reprintId:', reprintId, 'platePrm:', platePrm);
              console.log('🔍 Mevcut araç sayısı:', state.vehicles.length);
              console.log('🔍 Araç listesi:', state.vehicles.map(v => ({id: v.id, plaka: v.cekiciPlaka})));
              
              let vehicle = null;
              if (reprintId) {
                vehicle = state.vehicles.find(v => String(v.id) === String(reprintId));
                console.log('🔍 ID ile arama sonucu:', vehicle);
              }
              if (!vehicle && platePrm) {
                const normPlate = (s) => String(s||'').toLowerCase().replace(/[\s-]+/g, '');
                vehicle = state.vehicles.find(v => normPlate(v.cekiciPlaka) === normPlate(platePrm));
                console.log('🔍 Plaka ile arama sonucu:', vehicle, 'aranan plaka:', normPlate(platePrm));
              }
              
              if (vehicle) {
                // URL'den reprint bilgilerini al (firma, malzeme, sevk yeri vb.)
                // URL parametreleri temizlendiği için report.js'den gelen event data'yı kullan
                // Rapor sayfasından event data'yı localStorage'a geçici olarak kaydetmiştik
                let reprintData = {};
                try {
                  const savedReprintData = localStorage.getItem('tempReprintData');
                  if (savedReprintData) {
                    reprintData = JSON.parse(savedReprintData);
                    localStorage.removeItem('tempReprintData'); // temizle
                    console.log('🔍 Kaydedilen reprint data kullanıldı:', reprintData);
                  }
                } catch(e) {
                  console.error('🔍 Reprint data okuma hatası:', e);
                }
                
                // Eğer kaydedilen data yoksa boş object kullan
                if (!reprintData || Object.keys(reprintData).length === 0) {
                  reprintData = {
                    firma: '',
                    malzeme: '',
                    sevkYeri: '',
                    kantar: '',
                    basimYeri: '',
                    ambalaj: '',
                    baskiNotu: ''
                  };
                  console.log('🔍 Boş reprint data oluşturuldu');
                }
                
                // Reprint bilgilerini vehicle'a geçici olarak ekle
                vehicle._reprintData = reprintData;
                
                // Takip formunu aç
                setTimeout(() => {
                  showTakipFormu(vehicle);
                }, 500);
              } else if (reprintId || platePrm) {
                showToast('⚠️ Araç kaydı bulunamadı.', 2500);
              }
              
              // İşlem bittiğinde geçici parametreleri temizle
              delete window.__tempReprintId;
              delete window.__tempPlatePrm;
              console.log('🔍 Geçici parametreler temizlendi');
            }
        } catch(e) {
            console.error('checkReprintParam error:', e);
            // Hata durumunda da temizle
            delete window.__tempReprintId;
            delete window.__tempPlatePrm;
            try { localStorage.removeItem('pendingReprint'); } catch (e) { /* ignore */ }
        }
    }

        window.checkReprintParam = checkReprintParam;
        window.addEventListener('message', function (ev) {
          if (!ev.data || ev.data.type !== 'GPM_REPRINT') return;
          if (ev.origin !== window.location.origin) return;
          try { checkReprintParam(); } catch (e) { /* ignore */ }
        });
        window.addEventListener('gpm-reprint-request', function () {
          try { checkReprintParam(); } catch (e) { /* ignore */ }
        });

// Ýlk yükleme
        document.addEventListener('DOMContentLoaded', function() {
    const savedLogin = localStorage.getItem('isLoggedIn');
    const loginScreen = document.getElementById('loginScreen');
    // Oturum kaydı yoksa login göster; varsa head script logged-in sınıfı ile ana uygulama açık kalır
    if (savedLogin !== 'true' && loginScreen) {
        loginScreen.style.display = 'flex';
    }

    // Ù¨ 1) Tarayýcýda 'isLoggedIn' kaydý var mý diye bak
    if (savedLogin === 'true') {
        // Daha önce giriþ yapýlmýþ ise token geçerli mi kontrol et
        validateToken().then(() => {
            if (isLoggedIn) {
                enterAppWithDelay(0);
                // Start session monitoring for existing sessions
                startSessionMonitoring();
                // Reprint parametresini kontrol et (delay sonrasýnda)
                checkReprintParam();
            }
        });
    }

    // ✨ 2) Yine de login butonuna olay bağla (ilk giriş için lazım)
    const loginButton = document.getElementById('loginButton');
    const loginIdInput = document.getElementById('loginId');
    const loginPasswordInput = document.getElementById('loginPassword');

    if (loginButton) {
        loginButton.addEventListener('click', login);
    }

    if (loginIdInput) {
        loginIdInput.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') login();
        });
    }

    if (loginPasswordInput) {
        loginPasswordInput.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') login();
        });
    }

    // ✅ Global setup for Takip Form Modal buttons (print/preview/close) - bound ONCE to prevent duplicates
    setupTakipFormButtons();
});

// Global function to setup takip form buttons - called once on DOMContentLoaded
function setupTakipFormButtons() {
    // Yazdır button - with debounce to prevent multiple rapid clicks
    const yazdirBtn = document.getElementById('yazdirButton');
    if (yazdirBtn && !yazdirBtn.__printHandlerBound) {
        yazdirBtn.__printHandlerBound = true;
        yazdirBtn.addEventListener('click', async function(e) {
            // Prevent multiple rapid clicks
            if (yazdirBtn.__printing) return;
            yazdirBtn.__printing = true;

            try {
            // ✅ Oturum kontrolü
            if (window.SessionManager && typeof window.SessionManager.requireValidSession === 'function') {
                const isValidSession = await window.SessionManager.requireValidSession();
                if (!isValidSession) {
                    return; // Oturum geçersizse işlemi durdur
                }
            }

            try {
                const validateFunc = window.__takipFormValidate;
                if (typeof validateFunc === 'function') {
                    const valid = validateFunc({ forPrint: true });
                    if (valid === false) return;
                }
            } catch(e) {}

            // ✅ KANTAR: seçimi zorunlu tekrar tekrar istemesin
            try {
                const k = document.getElementById('imzaKantarAd');
                if (k) {
                    const cur = (k.value || '').trim();
                    if (!cur) {
                        const saved = (loadSavedKantarName() || '').trim();
                        if (saved) k.value = saved;
                    }
                    persistKantarName(k.value);
                    refreshKantarSignaturePreview();
                }
            } catch(e) {}

            // boşsa otomatik sıra ata
            try {
                const ys = document.getElementById('yuklemeSirasi');
                if (ys && !(ys.value || '').trim()) ys.value = String(getSuggestedYuklemeSirasi(get('basimYeri')));
            } catch(e){}

            // ✅ Şoför geçmişini kaydet (plaka sabit, şoför değişebilir)
            try { saveSoforHistoryFromTakipForm(); } catch(e) {}

            const nowTs = Date.now();
            const get = (id) => (document.getElementById(id)?.value || '').trim();
            const plateFromForm = (get('cekiciPlakaBilgi') || window.__activeTakipVehiclePlate || '').trim();
            const vid = resolveTakipVehicleIdForPrint(
                plateFromForm,
                (window.__activeTakipVehicleId || '').trim() || 'manual'
            );

            try {
                window.__activeTakipVehicleId = vid;
                window.__activeTakipVehiclePlate = plateFromForm;
            } catch (e) {}

            let basimYeriValue = get('basimYeri');
            const VALID_BASIM_YERLERI = ['1.OSB', 'AVDAN'];

            if (!basimYeriValue) {
                basimYeriValue = '1.OSB';
            } else {
                const isValid = VALID_BASIM_YERLERI.some(v => v.toUpperCase() === basimYeriValue.toUpperCase());
                if (!isValid) {
                    alert(`❌ Hatalı Basım Yeri: "${basimYeriValue}"\n\nKabul edilen: ${VALID_BASIM_YERLERI.join(', ')}`);
                    return;
                }
                basimYeriValue = basimYeriValue.toUpperCase();
            }

            try {
                if (window.OperationNotesAlert && typeof window.OperationNotesAlert.confirmBeforePrint === 'function') {
                    await window.OperationNotesAlert.confirmBeforePrint({
                        plaka: plateFromForm,
                        get,
                        source: 'yazdir'
                    });
                }
            } catch (vnErr) {
                console.warn('Vardiya notu uyarisi:', vnErr);
            }

            try {
                if (typeof window.maybeWarnExcelConsistencyBeforePrint === 'function') {
                    const okExcel = await window.maybeWarnExcelConsistencyBeforePrint();
                    if (!okExcel) return;
                }
            } catch (exErr) {
                console.warn('Excel tutarlılık:', exErr);
            }

            const snap = (() => {
                try {
                    const excelFirma = _takipFirmaFromExcelContext();
                    const s = Object.assign({
                        ts: nowTs,
                        firmaSelect: get('firmaSelect'),
                        firmaKodu: get('firmaKodu') || excelFirma,
                        malzemeSelect: get('malzemeSelect'),
                        malzeme: get('malzeme'),
                        sevkYeri: get('sevkYeri'),
                        basimYeri: basimYeriValue,
                        ambalajBilgisi: get('ambalajBilgisi'),
                        tonaj: get('tonaj'),
                        yuklemeSirasi: get('yuklemeSirasi'),
                        yuklemeNotu: get('yuklemeNotu')
                    }, getTakipFormDriverPayload());
                    const any = Object.keys(s).some(k => k !== 'ts' && String(s[k] || '').trim() !== '');
                    return any ? s : null;
                } catch (e) { return null; }
            })();

            const fromIhracat = _isIhracatPrintContext(null);
            const printPayload = captureTakipPrintPayloadForReport(get);
            printPayload.basimYeri = basimYeriValue;
            printPayload.yuklemeSirasi = get('yuklemeSirasi');
            printPayload.plaka = plateFromForm;

            window.__pendingPrintCommit = {
                vehicleId: vid,
                plaka: plateFromForm,
                nowTs,
                yuklemeSirasi: get('yuklemeSirasi'),
                basimYeri: basimYeriValue,
                snapshot: snap,
                printPayload,
                fromIhracat,
                piyasaOrderIdx: fromIhracat
                  ? null
                  : ((window.piyasa && typeof window.piyasa.getActiveOrderIdx === 'function')
                    ? window.piyasa.getActiveOrderIdx()
                    : null),
            };

            // Plaka + şoför: yazdırmayı bekletme (ağ yavaşsa pencere hiç açılmıyordu)
            if (plateFromForm) {
                Promise.resolve(saveCurrentVehicleToDatabase(plateFromForm)).catch((e) => {
                    console.warn('Yazdırma sırasında araç kaydı atlandı:', e);
                });
            }

            window.__afterTakipPrintRequested = true;
            try { upsertEslestirmeFromTakipForm(); } catch(e){}

            const runYazdir = () => {
            let w = null;
            let printErr = null;
            try {
                if (!window.Print || typeof window.Print.yazdirForm !== 'function') {
                    throw new Error('print-not-loaded');
                }
                w = window.Print.yazdirForm({ preview: false });
            } catch (err) {
                printErr = err;
            }
            try { window.__lastPrintWin = w || null; } catch(e) {}

            if (!w) {
                const msg = printErr && printErr.message === 'print-not-loaded'
                  ? 'Yazdırma bileşeni hazır değil. Sayfayı yenileyip tekrar deneyin.'
                  : 'Yazdırma penceresi açılamadı. Tarayıcıda açılır pencere (popup) iznini kontrol edin veya sayfayı yenileyin.';
                alert('❌ ' + msg);
                window.__afterTakipPrintRequested = false;
                return;
            }

            // ✅ Fallback: bazı tarayıcılarda opener.afterTakipPrint gelmeyebilir.
            try {
                if (w && typeof w.closed !== 'undefined') {
                    const t = setInterval(() => {
                        if (!window.__afterTakipPrintRequested) { clearInterval(t); return; }
                        if (w.closed) {
                            clearInterval(t);
                            try { window.afterTakipPrint && window.afterTakipPrint(); } catch(e){}
                        }
                    }, 400);
                }
            } catch(e) {}
            };
            Promise.resolve(typeof window.ensurePrintLoaded === 'function' ? window.ensurePrintLoaded() : null)
              .then(runYazdir)
              .catch(function(){ alert('Yazdırma bileşeni yüklenemedi. Sayfayı yenileyip tekrar deneyin.'); });
            } finally {
                setTimeout(() => { yazdirBtn.__printing = false; }, 800);
            }
        });
    }

    // Önizleme button
    const onizlemeBtn = document.getElementById('onizlemeButton');
    if (onizlemeBtn && !onizlemeBtn.__previewHandlerBound) {
        onizlemeBtn.__previewHandlerBound = true;
        onizlemeBtn.addEventListener('click', function(e) {
            try {
                const validateFunc = window.__takipFormValidate;
                if (typeof validateFunc === 'function') validateFunc();
            } catch(e) {}

            // ✅ Önizleme de: KANTAR otomatik gelsin
            try {
                const k = document.getElementById('imzaKantarAd');
                if (k) {
                    const cur = (k.value || '').trim();
                    if (!cur) {
                        const saved = (loadSavedKantarName() || '').trim();
                        if (saved) k.value = saved;
                    }
                    persistKantarName(k.value);
                    refreshKantarSignaturePreview();
                }
            } catch(e) {}

            try {
                const ys = document.getElementById('yuklemeSirasi');
                if (ys && !(ys.value || '').trim()) ys.value = String(getSuggestedYuklemeSirasi(document.getElementById('basimYeri')?.value || ''));
            } catch(e){}

            try { saveSoforHistoryFromTakipForm(); } catch(e) {}
            try { upsertEslestirmeFromTakipForm(); } catch(e){}
            Promise.resolve(typeof window.ensurePrintLoaded === 'function' ? window.ensurePrintLoaded() : null)
              .then(function(){
                try { window.Print?.yazdirForm({ preview: true }); } catch(e){}
              })
              .catch(function(){ alert('Önizleme bileşeni yüklenemedi.'); });
        });
    }

    // Kapat button
    const kapatBtn = document.getElementById('kapatButton');
    if (kapatBtn && !kapatBtn.__closeHandlerBound) {
        kapatBtn.__closeHandlerBound = true;
        kapatBtn.addEventListener('click', function(e) {
            const kapatFormFunc = window.__kapatForm;
            if (typeof kapatFormFunc === 'function') {
                kapatFormFunc();
            } else {
                // Fallback
                const modal = document.getElementById('takipFormuModal');
                if (modal) modal.classList.add('hidden');
            }
        });
    }
}



// ✅ ESC: Takip Formu/Eşleştirme/Diğer modallar kapanır; hiçbiri açık değilse çıkış yapar
if (!window.__escCloseBound) {
  window.__escCloseBound = true;
  document.addEventListener('keydown', function(e) {
    if (e.key !== 'Escape') return;
    const rpOv = document.getElementById('rpDialogOverlay');
    if (rpOv && !rpOv.hidden) return;
    if (window.rpDialog && typeof window.rpDialog.isOpen === 'function' && window.rpDialog.isOpen()) return;
    if (typeof isLoggedIn !== 'undefined' && !isLoggedIn) return;

    // Önce açık modalları kapat (üstteki önce)

    if (document.getElementById('excelReviewOverlay')) {
      try {
        closeExcelReviewUI();
      } catch (_) {}
      e.preventDefault();
      return;
    }

    // Piyasa Sipariş Seç (üst katman: geçmiş / boş tonaj vb. varsa onlar önce kapanır)
    if (window.__piyasaPickerOpen) {
      if (!document.querySelector('[data-piyasa-modal-layer="1"]')) {
        try {
          if (typeof window.__piyasaCloseOrderPicker === 'function') window.__piyasaCloseOrderPicker();
          else document.getElementById('piyasaModalClose')?.click();
        } catch (_) {}
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      return;
    }

    // Yeni Araç Kaydı formu açıksa kapat (login'e dönmesin)
    try {
      if (typeof state !== 'undefined' && state.showForm) {
        state.showForm = false;
        try { typeof render === 'function' && render(); } catch(_) {}
        e.preventDefault();
        return;
      }
    } catch(_) {}


    const takipModal = document.getElementById('takipFormuModal');
    if (takipModal && !takipModal.classList.contains('hidden')) {
      try { typeof kapatForm === 'function' ? kapatForm() : takipModal.classList.add('hidden'); } catch (_) { takipModal.classList.add('hidden'); }
      e.preventDefault();
      return;
    }

    const esModal = document.getElementById('eslestirmeModal');
    if (esModal && !esModal.classList.contains('hidden')) {
      try { typeof kapatEslestirmeModal === 'function' ? kapatEslestirmeModal() : esModal.classList.add('hidden'); } catch (_) { esModal.classList.add('hidden'); }
      e.preventDefault();
      return;
    }

    const editModal = document.getElementById('editModal');
    if (editModal && !editModal.classList.contains('hidden')) {
      try { editModal.classList.add('hidden'); } catch (_) {}
      e.preventDefault();
      return;
    }

    const ihrModal = document.getElementById('ihracatDetailsModal');
    if (ihrModal) {
      try {
        ihrModal.remove();
      } catch (_) {}
      e.preventDefault();
      return;
    }

    // Hiçbiri açık değilse: hiçbir şey yapma (yanlışlıkla çıkış olmasın)
    e.preventDefault();
  }, true);
}

