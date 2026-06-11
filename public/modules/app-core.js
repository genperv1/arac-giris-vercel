// app-core.js — giriş, listeler, state
// Otomatik bölüm — scripts/split-large-files.js

﻿// core-dom.js: fetch (credentials), safeBind, addOnce, escapeHtml, escapeAttr

// showPersistentConfirmModal → public/modules/app-modals.js

// ⚠️ Session expired modal - büyük, merkezi, unescapable
function showSessionExpiredModal() {
  console.log('📢 showSessionExpiredModal() açılıyor...');
  return new Promise((resolve) => {
    const existing = document.getElementById('session-expired-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'session-expired-modal';
    modal.style.cssText = [
      'position: fixed',
      'top: 0',
      'left: 0',
      'width: 100%',
      'height: 100%',
      'z-index: 9999999',
      'display: flex',
      'align-items: center',
      'justify-content: center',
      'background: rgba(0,0,0,0.75)',
      'pointer-events: auto',
    ].join(';');

    modal.innerHTML = `
      <div class="session-modal-overlay" style="position: relative; width: 100%; height: 100%; display: flex; align-items: center; justify-content: center;">
        <div class="session-modal-box" style="max-width: 520px; width: 90%; padding: 32px 28px; background: #ffffff; border-radius: 18px; box-shadow: 0 24px 80px rgba(15, 23, 42, 0.24); text-align: center;">
          <div class="session-modal-icon" style="font-size: 48px; margin-bottom: 18px;">⚠️</div>
          <h2 class="session-modal-title" style="font-size: 24px; font-weight: 700; color: #111827; margin: 0 0 16px;">Oturumunuz Sonlandı</h2>
          <p class="session-modal-text" style="font-size: 16px; color: #475569; line-height: 1.7; margin: 0 0 28px;">Uzun süre işlem yapılmadığından güvenlik nedeniyle oturumunuz kapanmıştır.</p>
          <button id="session-modal-confirm" class="session-modal-btn" style="background: linear-gradient(135deg, #2563eb 0%, #3b82f6 100%); color: white; border: none; padding: 14px 26px; border-radius: 12px; font-size: 16px; font-weight: 700; cursor: pointer;">Giriş Yap</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    console.log('Modal DOMa eklendi');

    const confirmBtn = modal.querySelector('#session-modal-confirm');
    if (!confirmBtn) {
      console.error('showSessionExpiredModal: confirmBtn bulunamadı!');
    }

    const cleanup = () => {
      try { document.removeEventListener('keydown', preventEsc); } catch (e) {}
      if (modal && modal.parentNode) modal.remove();
    };

    const closeModal = () => {
      console.log('Modal butona tıklandı');
      cleanup();
      
      // INLINE LOGOUT
      syncLoginFlag(false);
      // SessionManager üzerinden logout yap
      try { 
        if (window.SessionManager && window.SessionManager.logout) {
          window.SessionManager.logout();
        }
      } catch(e) {}
      try { document.documentElement.classList.remove('logged-in'); } catch (e) {}
      try { stopSessionMonitoring(); } catch (e) {}
      const mainApp = document.getElementById('mainApp');
      const loginScreen = document.getElementById('loginScreen');
      if (mainApp) mainApp.style.display = 'none';
      if (loginScreen) loginScreen.style.display = 'flex';
      try { fetch('/api/logout', { method: 'POST' }).catch(()=>{}); } catch(e){}
      
      console.log('LOGIN EKRANI GORUNUR YAPILDI (MODAL BUTTON)');
      resolve();
    };

    if (confirmBtn) {
      confirmBtn.addEventListener('click', closeModal);
    }

    // Auto-dismiss fallback after 10 seconds
    const autoDismiss = setTimeout(() => {
      console.log('Modal auto-dismiss tetiklendi');
      cleanup();
      resolve();
    }, 10000);

    const preventEsc = (e) => {
      if (e.key === 'Escape') e.preventDefault();
    };
    document.addEventListener('keydown', preventEsc);
  });
}



// app.js - GİRİŞ.html içinden ayrıldı
// Giriş kontrolü (çoklu kullanıcı + hash)
let isLoggedIn = false;
let isEnteringApp = false; // çift giriş tetiklenmesini engeller

function syncLoginFlag(value) {
  isLoggedIn = !!value;
  try { window.isLoggedIn = isLoggedIn; } catch (e) { /* ignore */ }
}
syncLoginFlag(localStorage.getItem('isLoggedIn') === 'true');

// 🖥️ Kiosk modu (tam ekran + büyük yazı) - başlangıçta uygula
try {
  if (localStorage.getItem('kiosk_mode_v1') === '1') {
    document.body && document.body.classList.add('kiosk-mode');
  }
} catch (e) {}


// ⚠️ Not: Bu offline çalışan (sunucusuz) bir sistem. Gerçek güvenlik için backend gerekir.
// Yine de şifreyi düz yazı tutmamak için sadece SHA-256 + salt hash'leri saklıyoruz.
const AUTH_SALT = "collabiq_salt_v1";
const USERS = [
  { id: "GENPER", passHash: "b47f62fb2692177aa12dc99be4ace000825f2c6a72818242f69791645bd658c0", role: "admin" },
  // örnek: { id: "KANTAR1", passHash: "SHA256_HASH", role: "user" }
];

// Eğer sunucu tarafı /api/login kullanıma açıksa, istemci login formunu backend'e yönlendir.
// Bu kod var olan (offline) login mantarını bozmaz — sadece /login butonuna yeni handler atar.
(function initServerLogin() {
  try {
    setTimeout(() => {
      const btn = document.getElementById('loginButton');
      const idEl = document.getElementById('loginId');
      const pwEl = document.getElementById('loginPassword');
      const errEl = document.getElementById('loginError');
      const loadingEl = document.getElementById('loginLoading');
      if (!btn || !idEl || !pwEl) return;

      const showLoading = () => { try { loadingEl?.classList.remove('hidden'); } catch (e) {} };
      const hideLoading = () => { try { loadingEl?.classList.add('hidden'); } catch (e) {} };
      const showError = (msg) => { try { if (errEl) { errEl.textContent = String(msg || 'Hatalı ID veya Şifre!'); errEl.classList.remove('hidden'); } } catch(e){} };
      const hideError = () => { try { if (errEl) errEl.classList.add('hidden'); } catch(e){} };

      // NOTE: click handler is attached centrally via `attachEventListeners()` -> `login()`.
      // This block intentionally does not add another click handler to avoid duplicate calls.
    }, 0);
  } catch (e) {}
})();

// Malzeme listesi
        let malzemeListesi = [
            "HP 0.074-0.30",
            "HP 0.074-0.60",
            "HP 0.15-0.30",
            "HP 0.15-0.40",
            "HP 0.15-0.60",
            "HP 0.30-0.50",
            "HP 0.30-0.85",
            "HP 0.60-1.20",
            "HP 1.20-2.40",
            "HP 1.20-2.80",
            "HP 1.60-4.00"
        ];

        // Firma listesi - başlangıç değerleri
        let firmaListesi = [
            "HP3 / BOZÜYÜK",
            "HP3 / MERSİN",
            "HP3 / GÖLBAŞI",
            "HP3 / SİVAS / İKİNCİ EL BBT",
            "HP8 / ANKARA",
            "HP11 / ANKARA",
            "HP77 / AKSARAY",
            "HP7  / ANKARA",
            "HP2  / GEBZE",
            "HP2  / ANKARA/BALA/SİLOBAS",
            "HP2 / ANKARA",
            "HP2  / TURGUTLU-MANİSA",
            "HP22  / ANKARA",
            "HP9 / ESKİŞEHİR",
            "HP5 /İSTANBUL"
        ];

        // Eşleştirme listesi
        let eslestirmeListesi = [];

        // 🔗 Eşleştirme kaldırıldı: eski kayıtlar varsa temizle
        try { localStorage.removeItem('eslestirmeListesi'); } catch(e) {}
        try { localStorage.removeItem('firmaOverrides_v1'); } catch(e) {}
        try { eslestirmeListesi = []; } catch(e) {}

        // Ana uygulama state
        let state = {
            vehicles: [],
            vehiclesLoading: false,
            searchTerm: '',
            quickPlateTerm: '',
            showForm: false,
            editingId: null,
            listLimit: 6,
            showAll: false,  
			pageSize: 20,
			visibleCount: 20,
			lastTotal: 0,
            
            formData: {
                cekiciPlaka: '',
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
            }
        };

        // TC Kimlik kontrolü
        function isValidTC(tc) {
            if (!tc) return true;
            return /^\d{11}$/.test(tc);
        }

        // İletişim numarası kontrolü
        function isValidIletisim(iletisim) {
            if (!iletisim) return true;
            const cleaned = iletisim.replace(/\D/g, '');
            return cleaned.length === 10 || cleaned.length === 11;
        }

        // Plaka kontrol fonksiyonu
        function isPlateExists(cekiciPlaka, excludeId = null) {
            const needle = String(cekiciPlaka || '').toLowerCase().trim();
            if (!needle) return false;

            return state.vehicles.some(vehicle => {
                const hay = String(vehicle?.cekiciPlaka || '').toLowerCase().trim();
                return vehicle?.id !== excludeId && hay && hay === needle;
            });
        }

        // Çakışan plakaları otomatik temizleme (✅ Artık silmez, sadece raporlar)
        // - Aynı plaka iki farklı kişi/araç kaydında bulunabilir.
        // - Login / Excel okuma tarafına dokunmaz.
        function cleanDuplicatePlates() {
    const duplicates = [];
    const seen = {};
    const vehiclesToKeep = [];

    (state.vehicles || []).forEach(vehicle => {
        const plate = String(vehicle?.cekiciPlaka || '').toLowerCase().trim();

        // Bozuk / eksik kayıt (plaka yok) -> saklama alanından da temizle
        if (!plate) {
            if (vehicle?.id) storage.delete(`vehicle_${vehicle.id}`);
            return;
        }

        // ✅ Bu plaka için şoför bilgilerini geçmişe ekle (çok şoför / tek plaka)
        try {
          const pKey = String(vehicle?.cekiciPlaka || '').trim();
          const n = ((vehicle?.soforAdi || '') + ' ' + (vehicle?.soforSoyadi || '')).trim();
          soforHistoryStorage.add(pKey, {
            name: n,
            tc: String(vehicle?.tcKimlik || '').trim(),
            phone: formatTRPhone(String(vehicle?.iletisim || '').trim())
          });
        } catch (e) {}

        // Duplicates: sadece raporla, silme
        if (seen[plate]) duplicates.push(vehicle.cekiciPlaka);
        else seen[plate] = true;

        vehiclesToKeep.push(vehicle);
    });

    state.vehicles = vehiclesToKeep;

    return duplicates.length;
}

// Eşleştirme yönetimi fonksiyonları
        const eslestirmeStorage = {
  save() {
    localStorage.setItem('eslestirmeListesi', JSON.stringify(eslestirmeListesi));
  },

  load() {
    const data = localStorage.getItem('eslestirmeListesi');
    if (!data) return;

    try {
      const parsed = JSON.parse(data);

      // ✅ Eski formatı (firma, malzeme) yeni formata migrate et
      eslestirmeListesi = (Array.isArray(parsed) ? parsed : [])
        .map((e) => {
          if (e && typeof e === 'object') {
            // yeni format
            if (e.id && 'ambalajBilgisi' in e && 'yuklemeNotu' in e) return e;

            // eski format (id yok)
            return {
              id: e.id || (Date.now().toString() + Math.random().toString(16).slice(2)),
              firma: e.firma || '',
              malzeme: e.malzeme || '',
              ambalajBilgisi: e.ambalajBilgisi || '',
              yuklemeNotu: e.yuklemeNotu || '',
              sevkYeri: e.sevkYeri || ''
            };
          }
          return null;
        })
        .filter(Boolean);

      // Eşleştirmelerden yeni firmaları/malzemeleri listelere ekle
      eslestirmeListesi.forEach(es => {
        if (es.firma && !firmaListesi.includes(es.firma)) firmaListesi.push(es.firma);
        if (es.malzeme && !malzemeListesi.includes(es.malzeme)) malzemeListesi.push(es.malzeme);
      });

      firmaStorage.save();
      try { localStorage.removeItem('malzemeListesi'); } catch(e) {}
// ✅ artık this çalışır
      this.save();
    } catch (e) {
      // bozuk json olursa sıfırlama
      eslestirmeListesi = [];
      this.save();
    }
  },

  // ✅ aynı firma + aynı malzeme varsa ekleme (ama aynı firma için farklı malzeme eklenebilir!)
  add(firma, malzeme, ambalajBilgisi = '', yuklemeNotu = '', sevkYeri = '') {
    if (eslestirmeListesi.some(es => es.firma === firma && es.malzeme === malzeme)) return false;

    if (!firmaListesi.includes(firma)) {
      firmaListesi.unshift(firma);
      firmaStorage.save();
    }

    if (!malzemeListesi.includes(malzeme)) {
      malzemeListesi.unshift(malzeme);
      try { localStorage.removeItem('malzemeListesi'); } catch(e) {}
}

    eslestirmeListesi.unshift({
      id: Date.now().toString() + Math.random().toString(16).slice(2),
      firma,
      malzeme,
      ambalajBilgisi,
      yuklemeNotu,
      sevkYeri
    });

    this.save();
    return true;
  },

  update(id, yeniData) {
    const idx = eslestirmeListesi.findIndex(es => es.id === id);
    if (idx === -1) return false;

    const target = eslestirmeListesi[idx];
    const newFirma = (yeniData.firma ?? target.firma);
    const newMalzeme = (yeniData.malzeme ?? target.malzeme);

    const conflict = eslestirmeListesi.some(es =>
      es.id !== id && es.firma === newFirma && es.malzeme === newMalzeme
    );
    if (conflict) return false;

    eslestirmeListesi[idx] = {
      ...target,
      ...yeniData,
      firma: newFirma,
      malzeme: newMalzeme
    };

    this.save();
    return true;
  },

  delete(id) {
    const idx = eslestirmeListesi.findIndex(es => es.id === id);
    if (idx === -1) return false;

    eslestirmeListesi.splice(idx, 1);
    this.save();
    return true;
  },

  // ✅ artık tek malzeme değil, firmaya ait TÜM eşleştirmeleri döndür
  // ✅ Firma eşleştirmesi normalize: Türkçe karakter/boşluk farklarında da bulsun (HP3 GÖLBAŞI vs HP3 GOLBASI)
  getByFirma(firma) {
    const norm = (s) => String(s || '')
      .toUpperCase()
      .replace(/İ/g,'I')
      .replace(/Ş/g,'S')
      .replace(/Ğ/g,'G')
      .replace(/Ü/g,'U')
      .replace(/Ö/g,'O')
      .replace(/Ç/g,'C')
      .replace(/[\s\-_/]+/g,' ')
      .trim();

    const key = norm(firma);
    return eslestirmeListesi.filter(es => norm(es?.firma) === key);
  }
};


		// Firma yönetimi fonksiyonları
        const firmaStorage = {
            save: () => {
                // ❌ Firma listesi kalıcı tutulmayacak
                try { localStorage.removeItem('firmaListesi'); } catch(e) {}
            },
            load: () => {
                // ❌ Firma listesi localStorage'dan okunmayacak
                try { localStorage.removeItem('firmaListesi'); } catch(e) {}
                firmaListesi = Array.isArray(firmaListesi) ? firmaListesi : [];
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


        // Malzeme yönetimi fonksiyonları
        // Not: malzemeListesi, localStorage'da "malzemeListesi" altında tutulur.
        const malzemeStorage = {
            save: () => {
                // ❌ Malzeme listesi kalıcı tutulmayacak
                try { localStorage.removeItem('malzemeListesi'); } catch(e) {}
            },
            load: () => {
                // ❌ Malzeme listesi localStorage'dan okunmayacak
                try { localStorage.removeItem('malzemeListesi'); } catch(e) {}
                malzemeListesi = Array.isArray(malzemeListesi) ? malzemeListesi : [];
            },
            
            add: (malzeme) => {
                const m = String(malzeme || '').trim();
                if (!m) return false;
                if (malzemeListesi.includes(m)) return false;
                malzemeListesi.unshift(m);
                malzemeStorage.save();
                return true;
            },
            update: (index, yeniMalzeme) => {
                const m = String(yeniMalzeme || '').trim();
                if (!m) return false;
                if (index >= 0 && index < malzemeListesi.length) {
                    // aynı isim varsa engelle
                    if (malzemeListesi.some((x, i) => i !== index && String(x).trim() === m)) return false;
                    malzemeListesi[index] = m;
                    malzemeStorage.save();
                    return true;
                }
                return false;
            },
            delete: (index) => {
                if (index >= 0 && index < malzemeListesi.length) {
                    malzemeListesi.splice(index, 1);
                    malzemeStorage.save();
                    return true;
                }
                return false;
            }
        };

                // Veri depolama fonksiyonları (storage.js)
        const storage = window.storage;


// ✅ Son kullanılanlar (akıllı hafıza) - localStorage
const RECENT_KEYS = {
  firmalar: 'recent_firmalar',
  malzemeler: 'recent_malzemeler',
  sevkYerleri: 'recent_sevk_yerleri'
};

// ❌ İSTENMEYEN LİSTELER: sistemde tutulmasın, yedekte taşınmasın
const DISABLED_STORAGE_KEYS = [
  'firmaListesi','malzemeListesi',
  'firmalar','malzemeler',
  'recent_firmalar','recent_malzemeler','recent_sevk_yerleri'
];

function purgeDisabledKeys() {
  try {
    DISABLED_STORAGE_KEYS.forEach(k => { try { localStorage.removeItem(k); } catch(e) {} });
  } catch (e) {}
}

// Sayfa açılır açılmaz temizle
try { purgeDisabledKeys(); } catch(e) {}


function _readRecent(key) {
  try {
    if (typeof DISABLED_STORAGE_KEYS !== 'undefined' && DISABLED_STORAGE_KEYS.includes(key)) return [];
    const arr = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(arr) ? arr.filter(Boolean) : [];
  } catch (e) { return []; }
}

function _writeRecent(key, arr) {
  try {
    if (typeof DISABLED_STORAGE_KEYS !== 'undefined' && DISABLED_STORAGE_KEYS.includes(key)) return;
    localStorage.setItem(key, JSON.stringify((Array.isArray(arr) ? arr : []).slice(0, 50)));
  } catch (e) {}
}

function pushRecent(key, value) {
  const v = String(value || '').trim();
  if (!v) return;
  const arr = _readRecent(key);
  const next = [v, ...arr.filter(x => String(x).trim() !== v)];
  _writeRecent(key, next);
}

function fillDatalist(datalistId, values) {
  const dl = document.getElementById(datalistId);
  if (!dl) return;
  // ✅ SECURITY: Use escapeAttr for datalist values (XSS protection)
  dl.innerHTML = (values || []).slice(0, 8).map(v => `<option value="${escapeAttr(v)}"></option>`).join('');
}

// ✅ Hafıza / cache temizliği (eşleştirmeleri silmez)
function clearRecentCaches() {
  try {
    Object.values(RECENT_KEYS).forEach(k => {
      try { localStorage.removeItem(k); } catch (e) {}
    });

    // Bazı eski sürümlerde kalmış olabilecek yardımcı cache anahtarları
    const legacyKeys = [
      'recentFirmalar',
      'recentMalzemeler',
      'recentSevkYerleri',
      'lastFirmaKodu',
      'lastMalzeme',
      'lastSevkYeri'
    ];
    legacyKeys.forEach(k => { try { localStorage.removeItem(k); } catch (e) {} });

    // UI tarafında datalist'leri de sıfırla
    try { fillDatalist('recentFirmalar', []); } catch (e) {}
    try { fillDatalist('recentMalzemeler', []); } catch (e) {}
    try { fillDatalist('recentSevkYerleri', []); } catch (e) {}

    return true;
  } catch (e) {
    return false;
  }
}


// soforHistoryStorage, populateSoforHistoryFromVehicles → public/modules/app-sofor-history.js

// ✅ Firma kodu normalize: "HP8 / İstanbul" -> "HP8"
function getFirmaKodOnly(firmaStr) {
  try { return String(firmaStr || '').split('/')[0].trim(); }
  catch (e) { return String(firmaStr || '').trim(); }
}

