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
            try { if (typeof updateSearchMeta === 'function') updateSearchMeta(); } catch (_) {}
        }

        // Konteynere bir defa bağlanan delege handler
        function _bindVehicleListDelegation(container) {
            if (!container || container.__cardClickBound) return;
            container.__cardClickBound = true;
            container.addEventListener('click', function (e) {
                const t = e.target.closest('.edit-btn, .form-btn, .netsis-btn, .copy-card-btn, .delete-btn, .vehicle-card__draft-warn--clickable');
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
                    if (t.classList.contains('vehicle-card__draft-warn--clickable')) {
                        editVehicle(vehicle, { focusField: getFirstMissingContactField(vehicle) });
                    } else if (t.classList.contains('edit-btn')) editVehicle(vehicle);
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
              }
            }
            
            if (reprintId || platePrm) {
              // URL'i temizle (sadece ilk çağrıda)
              if (!savedReprintId && !savedPlatePrm) {
                window.history.replaceState({}, document.title, window.location.pathname);
              }
              
              // ✅ Araç verilerinin yüklendiğinden emin ol
              if (state.vehiclesLoading || !state.vehicles || !state.vehicles.length) {
                loadVehicles();
                
                // Storage yüklenmesini bekle ve sonra kontrol et
                const waitForVehicles = () => {
                  if (!state.vehiclesLoading && state.vehicles && state.vehicles.length > 0) {
                    // Tekrar kontrol et
                    checkReprintParam();
                  } else {
                    setTimeout(waitForVehicles, 500);
                  }
                };
                setTimeout(waitForVehicles, 100);
                return;
              }
              
              // Vehicle'ı bul (reprint id çoğu zaman print_history id'sidir — önce plaka / gerçek vehicleId)
              let reprintData = {};
              try {
                const savedReprintData = localStorage.getItem('tempReprintData');
                if (savedReprintData) {
                  reprintData = JSON.parse(savedReprintData) || {};
                  localStorage.removeItem('tempReprintData');
                }
              } catch (e) {
                console.error('🔍 Reprint data okuma hatası:', e);
              }

              const actualVid = String(
                (reprintData && (reprintData.vehicleId || reprintData.vehicle_id)) || ''
              ).trim();
              const plateFromData = String((reprintData && reprintData.plaka) || platePrm || '').trim();

              let vehicle = null;
              if (actualVid) {
                vehicle = state.vehicles.find(v => String(v.id) === String(actualVid));
              }
              if (!vehicle && reprintId) {
                vehicle = state.vehicles.find(v => String(v.id) === String(reprintId));
              }
              if (!vehicle && plateFromData) {
                const normPlate = (s) => String(s || '').toLowerCase().replace(/[\s-]+/g, '');
                vehicle = state.vehicles.find(v => normPlate(v.cekiciPlaka) === normPlate(plateFromData));
              }

              // Araç listede yoksa (çıkış yapmış vb.) rapor verisiyle sentetik araç aç
              if (!vehicle && (reprintId || plateFromData || Object.keys(reprintData).length)) {
                const plate = plateFromData || platePrm || '';
                vehicle = {
                  id: actualVid || 'manual',
                  cekiciPlaka: plate,
                  soforAdi: '',
                  soforSoyadi: '',
                  tcKimlik: reprintData.tcKimlik || '',
                  iletisim: reprintData.iletisim || '',
                  dorsePlaka: reprintData.dorsePlaka || '',
                  lastPrintSnapshot: null,
                };
                try {
                  const drv = typeof driverFieldsFromSnapshot === 'function'
                    ? driverFieldsFromSnapshot(reprintData)
                    : null;
                  if (drv) {
                    vehicle.soforAdi = drv.soforAdi || '';
                    vehicle.soforSoyadi = drv.soforSoyadi || '';
                    if (drv.tcKimlik) vehicle.tcKimlik = drv.tcKimlik;
                    if (drv.iletisim) vehicle.iletisim = drv.iletisim;
                    if (drv.dorsePlaka) vehicle.dorsePlaka = drv.dorsePlaka;
                  }
                } catch (e) { /* ignore */ }
              }

              if (vehicle) {
                if (!reprintData || Object.keys(reprintData).length === 0) {
                  reprintData = {
                    firma: '',
                    malzeme: '',
                    sevkYeri: '',
                    kantar: '',
                    basimYeri: '',
                    ambalaj: '',
                    ambalajBilgisi: '',
                    baskiNotu: '',
                    yuklemeNotu: ''
                  };
                }
                // Alan adı eşlemesi (eski/yeni)
                if (!reprintData.yuklemeNotu && reprintData.baskiNotu) reprintData.yuklemeNotu = reprintData.baskiNotu;
                if (!reprintData.baskiNotu && reprintData.yuklemeNotu) reprintData.baskiNotu = reprintData.yuklemeNotu;
                if (!reprintData.ambalajBilgisi && reprintData.ambalaj) reprintData.ambalajBilgisi = reprintData.ambalaj;
                if (!reprintData.ambalaj && reprintData.ambalajBilgisi) reprintData.ambalaj = reprintData.ambalajBilgisi;

                vehicle._reprintData = reprintData;

                setTimeout(() => {
                  showTakipFormu(vehicle);
                }, 500);
              } else if (reprintId || platePrm) {
                showToast('⚠️ Araç kaydı bulunamadı.', 2500);
              }
              
              // İşlem bittiğinde geçici parametreleri temizle
              delete window.__tempReprintId;
              delete window.__tempPlatePrm;
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
        yazdirBtn.addEventListener('click', function(e) {
            if (yazdirBtn.__printing) return;
            yazdirBtn.__printing = true;
            let startedPrint = false;

            try {
            try {
                const pickBbt = String(document.getElementById('ihrPickBbtInput')?.value || '').trim();
                const formBbt = document.getElementById('bbt');
                if (pickBbt && formBbt && !String(formBbt.value || '').trim()) formBbt.value = pickBbt;
                if (typeof window._syncIhracatPickBbt === 'function') {
                    window._syncIhracatPickBbt(pickBbt || (formBbt && formBbt.value) || '');
                }
            } catch (e) {}

            if (window.SessionManager) {
                let loggedIn = false;
                try {
                    loggedIn = (typeof window.isAppLoggedIn === 'function')
                      ? !!window.isAppLoggedIn()
                      : (localStorage.getItem('isLoggedIn') === 'true');
                } catch (e) {}
                if (!loggedIn) {
                    try { alert('Oturum gerekli. Sayfayı yenileyip tekrar giriş yapın.'); } catch (e) {}
                    return;
                }
            }

            try {
                if (typeof window.ensureIhracatExcelPickBeforePrint === 'function') {
                    const okIhr = window.ensureIhracatExcelPickBeforePrint();
                    if (okIhr === false) return;
                }
            } catch (e) {}

            try {
                const validateFunc = window.__takipFormValidate;
                if (typeof validateFunc === 'function') {
                    const valid = validateFunc();
                    if (valid === false) return;
                }
            } catch(e) {}

            try {
                const activeVehicle = window.__activeTakipVehicle;
                if (activeVehicle && activeVehicle.id !== 'manual'
                    && typeof getVehicleContactWarnings === 'function'
                    && getVehicleContactWarnings(activeVehicle).length) {
                    const lines = getVehicleContactWarnings(activeVehicle).join(', ');
                    if (!window.confirm('Bu araçta eksik bilgi var: ' + lines + '.\n\nYazdırma işlemine yine de devam edilsin mi?')) {
                        return;
                    }
                }
            } catch (contactErr) { /* ignore */ }

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
                const basimNow = String(document.getElementById('basimYeri')?.value || '').trim();
                if (ys && !(ys.value || '').trim()) ys.value = String(getSuggestedYuklemeSirasi(basimNow));
            } catch(e){}

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
                    window.OperationNotesAlert.confirmBeforePrint({
                        plaka: plateFromForm,
                        get,
                        source: 'yazdir'
                    });
                }
            } catch (vnErr) {
                console.warn('Vardiya notu uyarisi:', vnErr);
            }

            try {
                if (typeof window.checkExcelConsistency === 'function') {
                    const r = window.checkExcelConsistency();
                    if (!r.ok && r.level === 'danger') {
                        if (!window.confirm(r.messages.join('\n') + '\n\nYine de yazdırmak istiyor musunuz?')) return;
                    }
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
                        yuklemeNotu: get('yuklemeNotu'),
                        kantar: get('imzaKantarAd'),
                    }, getTakipFormDriverPayload(), getTakipPackagingPayload());
                    const any = Object.keys(s).some(k => k !== 'ts' && String(s[k] || '').trim() !== '');
                    return any ? s : null;
                } catch (e) { return null; }
            })();

            const firmaForKind = String(get('firmaKodu') || get('firmaSelect') || '').trim();
            const isYdPrint = typeof _isYdFirmaValue === 'function'
              ? _isYdFirmaValue(firmaForKind)
              : /\bYD\d{1,4}(?:\([A-Za-z]+\))?/i.test(firmaForKind);
            const fromIhracat = isYdPrint || (!!_isIhracatPrintContext(null) && isYdPrint);
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

            window.__afterTakipPrintRequested = true;
            try { upsertEslestirmeFromTakipForm(); } catch(e){}

            const schedulePrintPathVehicleSave = function () {
                const savePlate = function () {
                    Promise.resolve(saveCurrentVehicleToDatabase(plateFromForm)).catch((e) => {
                        console.warn('Yazdırma sırasında araç kaydı atlandı:', e);
                    });
                };
                setTimeout(savePlate, 700);
            };

            // Yazdırma penceresi açılsın; araç kaydı o sırada sekmeyi kilitlemesin
            const runYazdir = () => {
            let w = null;
            let printErr = null;
            const openPrint = () => {
                if (!window.Print || typeof window.Print.yazdirForm !== 'function') {
                    throw new Error('print-not-loaded');
                }
                return window.Print.yazdirForm({ preview: false });
            };
            try {
                w = openPrint();
            } catch (err) {
                printErr = err;
            }
            Promise.resolve(printErr ? null : w).then((win) => {
                handlePrintWindow(win, printErr);
                if (plateFromForm) schedulePrintPathVehicleSave();
            }).catch((err) => {
                handlePrintWindow(null, err || printErr);
                if (plateFromForm) schedulePrintPathVehicleSave();
            });
            return;

            function handlePrintWindow(win, err) {
            w = win;
            try { window.__lastPrintWin = w || null; } catch(e) {}

            if (!w) {
                const msg = err && err.message === 'print-not-loaded'
                  ? 'Yazdırma bileşeni hazır değil. Sayfayı yenileyip tekrar deneyin.'
                  : 'Yazdırma başlatılamadı. Sayfayı yenileyip tekrar deneyin.';
                alert('❌ ' + msg);
                window.__afterTakipPrintRequested = false;
                return;
            }

            // Iframe yazdırmada sekme kapanmaz; onay onafterprint ile gelir.
            if (w && w.__takipPrintFrame) return;
            }
            };
            if (window.Print && typeof window.Print.yazdirForm === 'function') {
              startedPrint = true;
              runYazdir();
            } else {
              startedPrint = true;
              Promise.resolve(typeof window.ensurePrintLoaded === 'function' ? window.ensurePrintLoaded() : null)
                .then(runYazdir)
                .catch(function(){ alert('Yazdırma bileşeni yüklenemedi. Sayfayı yenileyip tekrar deneyin.'); });
            }
            } catch (printClickErr) {
                console.warn('Yazdırma hatası:', printClickErr);
                try { alert('Yazdırma başlatılamadı. Sayfayı yenileyip tekrar deneyin.'); } catch (e) {}
            } finally {
                setTimeout(() => { yazdirBtn.__printing = false; }, startedPrint ? 800 : 0);
            }
        });
    }

    // Önizleme kaldırıldı; Yazdır doğrudan yazıcı penceresini açar.
    const onizlemeBtn = document.getElementById('onizlemeButton');
    if (onizlemeBtn) onizlemeBtn.hidden = true;
    if (onizlemeBtn && !onizlemeBtn.__previewHandlerBound) {
        onizlemeBtn.__previewHandlerBound = true;
        onizlemeBtn.addEventListener('click', async function(e) {
            try {
                const activeVehicle = window.__activeTakipVehicle;
                if (activeVehicle && activeVehicle.id !== 'manual') {
                    const okContact = await maybeConfirmIncompleteContact(activeVehicle, 'Önizleme');
                    if (!okContact) return;
                }
            } catch (contactErr) { /* ignore */ }

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
            const runPreview = function(){
                try { window.Print?.yazdirForm({ preview: true }); } catch(e){}
              };
            if (window.Print && typeof window.Print.yazdirForm === 'function') {
              runPreview();
            } else {
            Promise.resolve(
              (typeof window.ensurePrintLoaded === 'function' ? window.ensurePrintLoaded() : null)
            )
              .then(runPreview)
              .catch(function(){ alert('Önizleme bileşeni yüklenemedi.'); });
            }
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

