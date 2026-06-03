// core-dom.js: fetch (credentials), safeBind, addOnce, escapeHtml, escapeAttr

// Özel inatçı onay modal'ı (kullanıcı cevap vermeden kapanmaz)
function showPersistentConfirmModal(message, yesText = 'Evet', noText = 'Hayır') {
  return new Promise((resolve) => {
    // Mevcut modal varsa kaldır
    const existing = document.getElementById('persistent-confirm-modal');
    if (existing) existing.remove();

    // Modal HTML oluştur
    const modal = document.createElement('div');
    modal.id = 'persistent-confirm-modal';
    modal.innerHTML = `
      <div style="
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0,0,0,0.7);
        z-index: 999999;
        display: flex;
        align-items: center;
        justify-content: center;
      ">
        <div style="
          background: white;
          padding: 20px;
          border-radius: 10px;
          box-shadow: 0 4px 20px rgba(0,0,0,0.3);
          max-width: 400px;
          text-align: center;
          font-family: Arial, sans-serif;
        ">
          <p style="margin: 0 0 20px 0; font-size: 16px;">${escapeHtml(message)}</p>
          <button id="modal-yes" style="
            background: #4CAF50;
            color: white;
            border: none;
            padding: 10px 20px;
            margin: 0 10px;
            border-radius: 5px;
            cursor: pointer;
            font-size: 14px;
          ">${escapeHtml(yesText)}</button>
          <button id="modal-no" style="
            background: #f44336;
            color: white;
            border: none;
            padding: 10px 20px;
            margin: 0 10px;
            border-radius: 5px;
            cursor: pointer;
            font-size: 14px;
          ">${escapeHtml(noText)}</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    // Buton event'leri
    const yesBtn = modal.querySelector('#modal-yes');
    const noBtn = modal.querySelector('#modal-no');

    const closeModal = (result) => {
      modal.remove();
      resolve(result);
    };

    yesBtn.addEventListener('click', () => closeModal(true));
    noBtn.addEventListener('click', () => closeModal(false));

    // ESC ile kapanmasın, sadece butonlarla
    // Modal dışına tıklamayla kapanmasın
  });
}

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
          <p class="session-modal-text" style="font-size: 16px; color: #475569; line-height: 1.7; margin: 0 0 28px;">30 dakika işlem yapılmadığından güvenlik nedeniyle oturumunuz kapanmıştır.</p>
          <button id="session-modal-confirm" class="session-modal-btn" style="background: linear-gradient(135deg, #2563eb 0%, #3b82f6 100%); color: white; border: none; padding: 14px 26px; border-radius: 12px; font-size: 16px; font-weight: 700; cursor: pointer;">Gördüm - Tekrar Giriş Yap</button>
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
      isLoggedIn = false;
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


// =========================
// ✅ Plaka -> Şoför Geçmişi (çok şoför / tek plaka)
// - Excel okuma ve login akışına dokunmaz.
// - Takip Formu'nda şoför bilgileri değişirse burada saklanır.
// =========================
const SOFOR_HISTORY_KEY = 'soforHistoryByPlaka';

const soforHistoryStorage = (function(){
  // In-memory driver history map (plateKey -> array of drivers)
  const _mem = {};
  return {
    load() { try { return _mem; } catch(e) { return {}; } },
    save(map) { try { Object.keys(_mem).forEach(k => delete _mem[k]); Object.assign(_mem, map || {}); } catch(e) {} },
  _key(plate) {
    return String(plate || '').toUpperCase().replace(/\s+/g,'').trim();
  },
  list(plate) {
    const k = this._key(plate);
    const map = this.load();
    const arr = map[k];
    return Array.isArray(arr) ? arr.filter(Boolean) : [];
  },
  add(plate, driver) {
    const k = this._key(plate);
    if (!k) return;
    const d = driver || {};
    const name = String(d.name || '').trim();
    const tc = String(d.tc || '').trim();
    const tel = String(d.phone || '').trim();
    if (!name && !tc && !tel) return;

    const map = this.load();
    const arr = Array.isArray(map[k]) ? map[k].filter(Boolean) : [];

    // aynı kayıt tekrar gelirse başa al
    const same = (x) => {
      if (!x) return false;
      const xName = String(x.name || '').trim();
      const xTc = String(x.tc || '').trim();
      const xTel = String(x.phone || '').trim();
      if (tc && xTc && tc === xTc) return true;
      if (name && xName && tel && xTel) return (name === xName && tel === xTel);
      return name && xName && (name === xName);
    };

    const cleaned = arr.filter(x => !same(x));
    const next = [{
      name,
      tc,
      phone: tel,
      updatedAt: Date.now()
    }, ...cleaned].slice(0, 12);

    map[k] = next;
    this.save(map);
  }
  };
})();

/** Araç listesinden şoför geçmişini doldur (ek API çağrısı yok). */
function populateSoforHistoryFromVehicles(vehicles) {
  const arr = Array.isArray(vehicles) ? vehicles : [];
  const ts = Date.now();
  for (const v of arr) {
    try {
      const plate = v.cekiciPlaka || '';
      if (v.soforAdi || v.soforSoyadi || v.iletisim || v.tcKimlik) {
        soforHistoryStorage.add(plate, {
          name: ((v.soforAdi || '') + ' ' + (v.soforSoyadi || '')).trim(),
          tc: v.tcKimlik || '',
          phone: v.iletisim || '',
          updatedAt: ts
        });
      }
      if (v.sofor2Adi || v.sofor2Soyadi) {
        soforHistoryStorage.add(plate, {
          name: ((v.sofor2Adi || '') + ' ' + (v.sofor2Soyadi || '')).trim(),
          tc: '',
          phone: '',
          updatedAt: ts
        });
      }
    } catch (e) { /* ignore */ }
  }
}

// ✅ Firma kodu normalize: "HP8 / İstanbul" -> "HP8"
function getFirmaKodOnly(firmaStr) {
  try { return String(firmaStr || '').split('/')[0].trim(); }
  catch (e) { return String(firmaStr || '').trim(); }
}

// =========================
// 📄 Günlük Excel Sevkiyat Import (offline uyumlu)
// - XLSX: ilk kullanımda ensureXlsxLoaded() ile yüklenir (asset-loader.js + CDN)
// - Login'e dokunmaz, sadece ana ekranda butonlarla çalışır.
// =========================
function _nz(v) {
  if (v == null) return '';
  const s = String(v).trim();
  if (!s) return '';
  // 0 / 0,0 / 0.0 gibi değerleri boş say
  const norm = s.replace(',', '.');
  if (norm === '0' || norm === '0.0' || norm === '0.00') return '';
  return s;
}

/** İhracat Excel: A sütunundaki R11… irsaliye numarası (başlık satırında "İRSALİYE NO" olmayabilir) */
function looksLikeIrsaliyeNo(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return false;
  if (/^YD\d+/i.test(s)) return false;
  if (/^(SIRANO|PLAKA|TOPLAM|KALAN)$/i.test(s)) return false;
  const compact = s.replace(/\s+/g, '');
  return /^(R\d{1,3})\d{6,12}$/i.test(compact) || /^R\d{1,3}\s+\d{6,12}$/i.test(s);
}

function normalizeIrsaliyeNo(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  const compact = s.replace(/\s+/g, '');
  const m = compact.match(/^(R\d{1,3})(\d{6,12})$/i);
  if (m) return `${m[1].toUpperCase()} ${m[2]}`;
  const m2 = s.match(/^(R\d{1,3})\s+(\d{6,12})$/i);
  if (m2) return `${m2[1].toUpperCase()} ${m2[2]}`;
  return s;
}

function resolveIrsaliyeFromRow(d, cols) {
  const row = d || [];
  if (cols && cols.irsaliyeNo !== undefined) {
    const fromCol = row[cols.irsaliyeNo];
    if (fromCol != null && String(fromCol).trim()) {
      const n = normalizeIrsaliyeNo(fromCol);
      if (n) return n;
    }
  }
  const a0 = row[0];
  if (a0 != null && looksLikeIrsaliyeNo(a0)) return normalizeIrsaliyeNo(a0);
  return '';
}

function getShipmentIrsaliyeNo(shipment) {
  if (!shipment) return '';
  const direct = normalizeIrsaliyeNo(shipment.irsaliyeNo);
  if (direct) return direct;
  const fromId = String(shipment.id || '').trim();
  if (looksLikeIrsaliyeNo(fromId)) return normalizeIrsaliyeNo(fromId);
  return '';
}

function irsaliyeCollisionKey(raw) {
  const n = normalizeIrsaliyeNo(raw);
  if (n) return n.replace(/\s+/g, ' ').trim().toUpperCase();
  return String(raw || '').replace(/\s+/g, ' ').trim().toUpperCase();
}

function getIrsaliyeCollisionInfo(rows) {
  const eu = window.ExcelUtils || {};
  const collisions = eu.findIrsaliyeCollisions ? eu.findIrsaliyeCollisions(rows || []) : [];
  const set = new Set();
  collisions.forEach((c) => {
    const k = irsaliyeCollisionKey(c.irsaliyeNo);
    if (k) set.add(k);
  });
  return { collisions, set };
}

function shipmentHasIrsaliyeCollision(shipment, collisionSet) {
  if (!collisionSet || !collisionSet.size || !shipment) return false;
  const k = irsaliyeCollisionKey(getShipmentIrsaliyeNo(shipment));
  return !!k && collisionSet.has(k);
}

const IHR_IRS_COLLISION_CELL_STYLE = 'background:#111210;color:#FFBF00;font-weight:bold;';

function detectIrsaliyeColumnIndex(grid, headerRowIdx, cols) {
  if (cols.irsaliyeNo !== undefined) return cols.irsaliyeNo;
  const candidates = [0];
  if (cols.sirano !== undefined && cols.sirano > 0) candidates.push(cols.sirano - 1);
  for (const c of candidates) {
    for (let r = headerRowIdx + 1; r < Math.min(grid.length, headerRowIdx + 25); r++) {
      const row = grid[r] || [];
      if (looksLikeIrsaliyeNo(row[c])) return c;
    }
  }
  return undefined;
}

const DAILY_SHIPMENT_KEY = 'daily_shipments_current';

// ✅ Firma bazlı düzeltme hafızası (özellikle Sevk Yeri / Liman)
const FIRMA_OVERRIDE_KEY = 'firmaOverrides_v1';
function _normFirmaKey(f){
  return String(f || '').trim().toUpperCase();
}
function loadFirmaOverrides(){
  try{
    const obj = JSON.parse(localStorage.getItem(FIRMA_OVERRIDE_KEY) || '{}');
    return (obj && typeof obj === 'object') ? obj : {};
  }catch(e){ return {}; }
}
function saveFirmaOverrides(map){
  try{ localStorage.setItem(FIRMA_OVERRIDE_KEY, JSON.stringify(map || {})); return true; }catch(e){ return false; }
}
function getFirmaOverride(firma){
  const key = _normFirmaKey(firma);
  if (!key) return null;
  const map = loadFirmaOverrides();
  return map[key] || null;
}
function setFirmaOverride(firma, patch){
  const key = _normFirmaKey(firma);
  if (!key) return false;
  const map = loadFirmaOverrides();
  const cur = (map[key] && typeof map[key] === 'object') ? map[key] : {};
  map[key] = { ...cur, ...(patch || {}), updatedAt: new Date().toISOString() };
  return saveFirmaOverrides(map);
}
function applyFirmaOverridesToShipment(sh){
  if (!sh) return sh;
  const firma = sh.firma || sh.ydKey || '';
  const ov = getFirmaOverride(firma);
  if (!ov) return sh;
  const out = { ...sh };
  if (ov.sevkYeri && String(ov.sevkYeri).trim()) out.sevkYeri = String(ov.sevkYeri).trim();
  if (ov.ambalaj && String(ov.ambalaj).trim()) out.ambalaj = String(ov.ambalaj).trim();
  return out;
}

const DAILY_SHIPMENT_META = 'daily_shipments_meta';

// TR plaka normalize (eşleştirme için) -> "43ADD516" == "43 ADD 516"
function normPlate(v) {
  return formatTRPlate(String(v || '')).replace(/\s+/g, ' ').trim();
}

function _plateKeyForMatch(p) {
  return String(p || '').toLowerCase().replace(/[\s-]+/g, '');
}

function clearActiveTakipVehicleRefs() {
  try { window.__activeTakipVehicleId = ''; } catch (e) {}
  try { window.__activeTakipVehiclePlate = ''; } catch (e) {}
  try { window.__activeTakipVehicle = null; } catch (e) {}
}

function resolveTakipVehicleIdForPrint(plate, hintId) {
  const pid = String(plate || '').trim();
  const hint = String(hintId || '').trim();
  const vehicles = (typeof state !== 'undefined' && state && Array.isArray(state.vehicles)) ? state.vehicles : [];

  if (hint && hint !== 'manual') {
    const byHint = vehicles.find((v) => String(v.id) === hint);
    if (byHint) return String(byHint.id);
  }

  if (pid) {
    const key = _plateKeyForMatch(pid);
    const byPlate = vehicles.find((v) => {
      const plates = [v.cekiciPlaka, v.dorsePlaka, v.plaka].filter(Boolean);
      return plates.some((p) => _plateKeyForMatch(p) === key);
    });
    if (byPlate && byPlate.id) return String(byPlate.id);
  }

  if (hint && hint !== 'manual') return hint;
  return 'manual';
}

/** Takip formu: tek satırlık şoför adını ad/soyad alanlarına ayırır */
function splitSoforFullName(full) {
  const s = String(full || '').trim().replace(/\s+/g, ' ');
  if (!s) return { soforAdi: '', soforSoyadi: '' };
  const parts = s.split(' ');
  if (parts.length === 1) return { soforAdi: parts[0], soforSoyadi: '' };
  return { soforAdi: parts.slice(0, -1).join(' '), soforSoyadi: parts[parts.length - 1] };
}

/** Takip formundaki şoför alanlarını oku (yazdırma / rapor için) */
function getTakipFormDriverPayload() {
  const formGet = (id) => {
    try { return (document.getElementById(id)?.value || '').trim(); } catch (e) { return ''; }
  };
  const full = formGet('soforBilgi');
  const split = splitSoforFullName(full);
  let phone = formGet('iletisimBilgi');
  try { phone = formatTRPhone(phone); } catch (e) { /* ignore */ }
  return {
    sofor: full,
    soforAdi: split.soforAdi,
    soforSoyadi: split.soforSoyadi,
    tcKimlik: formGet('tcBilgi'),
    iletisim: phone,
    dorsePlaka: formGet('dorsePlakaBilgi'),
  };
}

function driverFieldsFromSnapshot(snap) {
  const s = snap && typeof snap === 'object' ? snap : {};
  const full = String(s.sofor || '').trim()
    || [s.soforAdi, s.soforSoyadi].filter(Boolean).join(' ').trim();
  const split = (s.soforAdi || s.soforSoyadi)
    ? { soforAdi: String(s.soforAdi || '').trim(), soforSoyadi: String(s.soforSoyadi || '').trim() }
    : splitSoforFullName(full);
  return {
    sofor: full,
    soforAdi: split.soforAdi,
    soforSoyadi: split.soforSoyadi,
    tcKimlik: String(s.tcKimlik || '').trim(),
    iletisim: String(s.iletisim || '').trim(),
    dorsePlaka: String(s.dorsePlaka || '').trim(),
  };
}

function applyPiyasaOrderToPrintEvent(printEv, pending) {
  if (!printEv || !pending || pending.piyasaOrderIdx == null) return printEv;
  try {
    const o = window.piyasa && typeof window.piyasa.getOrderByIdx === 'function'
      ? window.piyasa.getOrderByIdx(pending.piyasaOrderIdx)
      : null;
    if (!o) return printEv;
    const snapFirma = String(printEv.firmaKodu || printEv.firma || '').trim();
    const f = String(o.firma || '').trim();
    const m = String(o.malzeme || '').trim();
    if (f && (!snapFirma || snapFirma === f)) {
      printEv.firma = f;
      printEv.firmaKodu = f;
    }
    if (m) printEv.malzeme = m;
  } catch (e) { /* ignore */ }
  return printEv;
}

function piyasaSevkiyatIdForPrint(pending) {
  if (pending && pending.piyasaOrderIdx != null) {
    return 'piyasa:' + String(pending.piyasaOrderIdx);
  }
  try {
    return (pending && pending.snapshot && pending.snapshot.sevkiyatId) || '';
  } catch (e) {
    return '';
  }
}

function buildPrintEventDataFromPending(pending, vehicle, printCount, tarihTr) {
  const snap = (pending && pending.snapshot) || {};
  const formGet = (id) => {
    try { return (document.getElementById(id)?.value || '').trim(); } catch (e) { return ''; }
  };
  const driver = driverFieldsFromSnapshot(snap);
  if (!driver.sofor) {
    try {
      const live = getTakipFormDriverPayload();
      if (live.sofor) Object.assign(driver, live);
    } catch (e) { /* ignore */ }
  }

  const plaka = String(pending?.plaka || vehicle?.cekiciPlaka || formGet('cekiciPlakaBilgi') || '').trim();
  const firma = String(
    snap.firmaKodu || snap.firmaSelect || vehicle?.defaultFirma || formGet('firmaKodu') || formGet('firmaSelect') || ''
  ).trim();
  const malzeme = String(
    snap.malzeme || snap.malzemeSelect || vehicle?.defaultMalzeme || formGet('malzeme') || formGet('malzemeSelect') || ''
  ).trim();

  return {
    vehicleId: vehicle?.id ? String(vehicle.id) : String(pending?.vehicleId || 'manual'),
    plaka,
    plate: plaka,
    firma,
    firmaKodu: firma,
    firmaSelect: String(snap.firmaSelect || formGet('firmaSelect') || '').trim(),
    malzeme,
    sevkYeri: String(snap.sevkYeri || vehicle?.defaultSevkYeri || formGet('sevkYeri') || '').trim(),
    basimYeri: String(snap.basimYeri || pending?.basimYeri || formGet('basimYeri') || '').trim(),
    tonaj: String(snap.tonaj || formGet('tonaj') || '').trim(),
    yuklemeSirasi: String(pending?.yuklemeSirasi || snap.yuklemeSirasi || formGet('yuklemeSirasi') || '').trim(),
    printCount: printCount || 1,
    tarih: tarihTr || '',
    kantar: formGet('imzaKantarAd'),
    ambalajBilgisi: String(snap.ambalajBilgisi || formGet('ambalajBilgisi') || '').trim(),
    yuklemeNotu: String(snap.yuklemeNotu || formGet('yuklemeNotu') || '').trim(),
    sofor: driver.sofor,
    soforAdi: driver.soforAdi,
    soforSoyadi: driver.soforSoyadi,
    tcKimlik: driver.tcKimlik,
    iletisim: driver.iletisim,
    dorsePlaka: driver.dorsePlaka || String(snap.dorsePlaka || formGet('dorsePlakaBilgi') || '').trim(),
    ts: pending?.nowTs || Date.now(),
  };
}

function _todayKeyTR() {
  try {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth()+1).padStart(2,'0');
    const dd = String(d.getDate()).padStart(2,'0');
    return `${yyyy}-${mm}-${dd}`;
  } catch(e){ return 'unknown'; }
}

function findShipmentHeaderText(grid, rowIdx) {
  // ✅ En yakın header'ı al (yanlış sevkiyat bloğundan seçim yapmayı engeller)
  // Header satırı genelde '/' içerir ve NET ... KG veya BOOKING/GEMİ gibi işaretler taşır.
  const start = Math.max(0, rowIdx - 25);

  for (let r = rowIdx; r >= start; r--) {
    const row = grid[r] || [];
    const maxC = Math.min(row.length, 80);

    for (let c = 0; c < maxC; c++) {
      const v = row[c];
      if (v === null || v === undefined || v === '') continue;

      const s = String(v).trim();
      if (!s.includes('/')) continue;

      if (
        /NET\s*\d+\s*KG/i.test(s) ||
        /BOOKING\s*NO/i.test(s) ||
        /GEM[İI]\s*DETAYI/i.test(s)
      ) {
        return s;
      }
    }
  }
  return '';
}

function colIndexToLetter(idx) {
  let n = Number(idx);
  if (Number.isNaN(n) || n < 0) return '';
  let s = '';
  while (n >= 0) {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  }
  return s;
}

function getSheetCellValue(ws, colIndex, rowNumber) {
  if (!ws || rowNumber == null || colIndex == null) return '';
  const colLetter = (typeof colIndex === 'number') ? colIndexToLetter(colIndex) : String(colIndex).toUpperCase();
  if (!colLetter) return '';
  const addr = `${colLetter}${rowNumber}`;
  const cell = ws[addr];
  if (!cell) return '';
  return String(cell.v != null ? cell.v : '').trim();
}

function extractFirmaTextFromN(ws, rowNumber, maxRowsBack = 40) {
  try {
    if (!ws || !rowNumber) return '';

    // N sütunu = 13. index
    for (let r = rowNumber; r >= Math.max(1, rowNumber - maxRowsBack); r--) {
      const raw = getSheetCellValue(ws, 13, r); // N sütunu
      if (!raw) continue;

      const text = String(raw).replace(/\s+/g, ' ').trim();
      if (!text) continue;

      // YD ile başlayan N hücresini tam al
      if (/\bYD\d{1,4}\b/i.test(text)) {
        return text;
      }
    }

    return '';
  } catch (e) {
    return '';
  }
}

function findNearestSheetColumnValue(ws, startRow, colIndex, maxRowsBack = 40, predicate) {
  const endRow = Math.max(1, startRow - maxRowsBack);
  for (let r = startRow; r >= endRow; r--) {
    const val = getSheetCellValue(ws, colIndex, r);
    if (!val) continue;
    if (typeof predicate === 'function') {
      if (predicate(val)) return val;
      continue;
    }
    return val;
  }
  return '';
}

function findNearestColumnValue(grid, rowIdx, colIndex, maxRowsBack = 25) {
  const start = Math.max(0, rowIdx);
  const end = Math.max(0, rowIdx - maxRowsBack);
  for (let r = start; r >= end; r--) {
    const row = grid[r] || [];
    if (colIndex >= 0 && colIndex < row.length) {
      const raw = row[colIndex];
      if (raw !== null && raw !== undefined) {
        const text = String(raw).trim();
        if (text) return text;
      }
    }
    // Eğer N sütunu doğrudan boşsa, aynı satırda YD içeren değeri de bulmaya çalış
    for (let c = 0; c < row.length; c++) {
      const raw = row[c];
      if (raw === null || raw === undefined) continue;
      const text = String(raw).trim();
      if (!text) continue;
      if (/\bYD\d{1,4}\b/i.test(text)) return text;
    }
  }
  return '';
}

function saveDailyShipments(rows, meta) {
  try {
    // ✅ Yeni katman: DailyStore (memory + IndexedDB). Yoksa localStorage fallback.
    if (window.DailyStore && typeof DailyStore.set === 'function') {
      DailyStore.set(rows || [], meta || {});
      return true;
    }
    localStorage.setItem(DAILY_SHIPMENT_KEY, JSON.stringify(rows || []));
    localStorage.setItem(DAILY_SHIPMENT_META, JSON.stringify(meta || {}));
    return true;
  } catch(e){ return false; }
}

function loadDailyShipments() {
  try {
    if (window.DailyStore && typeof DailyStore.getRows === 'function') {
      return DailyStore.getRows() || [];
    }
    const rows = JSON.parse(localStorage.getItem(DAILY_SHIPMENT_KEY) || '[]');
    return Array.isArray(rows) ? rows : [];
  } catch(e){ return []; }
}

function hasDailyExcelLoaded(){
  try { return (loadDailyShipments() || []).length > 0; }
  catch(e){ return false; }
}

function loadDailyMeta() {
  try {
    if (window.DailyStore && typeof DailyStore.getMeta === 'function') {
      return DailyStore.getMeta() || {};
    }
    return JSON.parse(localStorage.getItem(DAILY_SHIPMENT_META) || '{}') || {};
  } catch(e){ return {}; }
}

async function clearDailyShipments() {
  try {
    if (window.DailyStore && typeof DailyStore.clear === 'function') {
      return await DailyStore.clear();
    }
    localStorage.removeItem(DAILY_SHIPMENT_KEY);
    localStorage.removeItem(DAILY_SHIPMENT_META);
    return true;
  } catch(e){ return false; }
}

// Header Excel durum yazıları için ortak formatter
function _getExcelStatusInfo(){
  const out = {
    ihrCount: 0,
    ihrLine: '-',
    piyCount: 0,
    piyLine: '-',
  };

  // İHRACAT
  try {
    const meta = (typeof loadDailyMeta === 'function') ? (loadDailyMeta() || {}) : {};
    const cnt  = (typeof loadDailyShipments === 'function') ? ((loadDailyShipments() || []).length || 0) : 0;
    out.ihrCount = cnt;
    if (meta && meta.fileName) out.ihrLine = `${meta.fileName} • ${cnt} kayıt`;
    else if (cnt) out.ihrLine = `${cnt} kayıt`;
  } catch(e) {}

  // PİYASA
  try {
    const raw = localStorage.getItem('piyasa_state_v1');
    if (raw) {
      const piy = JSON.parse(raw) || {};
      const cnt = Array.isArray(piy.orders) ? piy.orders.length : 0;
      out.piyCount = cnt;
      // Format: haftabilgisi/tarih/kayıtsayısı
      try {
        let weekInfo = '-';
        if (piy) {
          if (piy.week) weekInfo = piy.week;
          else if (piy.sheet) weekInfo = piy.sheet;
        }
        let dateStr = '-';
        if (piy && piy.loadedAt) {
          const dt = new Date(piy.loadedAt);
          if (!isNaN(dt)) {
            const d = ('0' + dt.getDate()).slice(-2);
            const m = ('0' + (dt.getMonth() + 1)).slice(-2);
            const y = dt.getFullYear();
            dateStr = `${d}.${m}.${y}`;
          }
        }
        out.piyLine = `${weekInfo}.Hafta/${dateStr}`;
      } catch(e) {
        if (cnt) out.piyLine = `${cnt} satır`;
      }
    }
  } catch(e) {}

  // Hafta uyumu (piyasa vs ihracat)
  try {
    const piyRaw = localStorage.getItem('piyasa_state_v1');
    if (piyRaw) {
      const piy = JSON.parse(piyRaw) || {};
      const eu = window.ExcelUtils || {};
      if (eu.compareExcelWeeks) {
        const meta = (typeof loadDailyMeta === 'function') ? loadDailyMeta() : {};
        const resolvedMeta = { ...meta, dateKey: _resolveIhracatDateKey(meta) || meta.dateKey };
        out.warnings = (out.warnings || []).concat(eu.compareExcelWeeks(resolvedMeta, piy));
      }
    }
  } catch (e) {}

  return out;
}

function _formatDateKeyTR(dateKey) {
  const s = String(dateKey || '').trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return s || '-';
  return `${m[3]}.${m[2]}.${m[1]}`;
}

/** İHRACAT uyarı bandı — header chip ile aynı “Yüklü …” formatı (kayıt sayısı yok) */
function _buildIhracatWarnLabel(meta) {
  const fileName = String(meta?.fileName || '').trim();
  if (fileName) return `Yüklü ${fileName}`;
  const dk = String(meta?.dateKey || '').trim();
  if (dk) return `Yüklü ${_formatDateKeyTR(dk)}`;
  return 'Yüklü';
}

function _buildIhracatChipText(info){
  if ((info?.ihrCount || 0) > 0) {
    const detail = (info.ihrLine && info.ihrLine !== '-') ? info.ihrLine : `${info.ihrCount} kayıt`;
    return `Yüklü ${detail}`;
  }
  return 'Boş';
}

function _buildPiyasaChipText(info){
  if ((info?.piyCount || 0) > 0) {
    const detail = (info.piyLine && info.piyLine !== '-') ? info.piyLine : `${info.piyCount} kayıt`;
    return `Yüklü ${detail}`;
  }
  return 'Boş';
}

function _dateKeyFromDate(d) {
  if (!d || !(d instanceof Date) || isNaN(d.getTime())) return '';
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/** Dosya adından tarih: 21.05.2026.xlsx → 2026-05-21 */
function _dateKeyFromFileName(fileName) {
  const s = String(fileName || '').trim();
  if (!s) return '';
  let m = s.match(/(?:^|[^0-9])(\d{2})[.\-_](\d{2})[.\-_](\d{4})(?:[^0-9]|$)/);
  if (m) {
    const dd = m[1];
    const mm = m[2];
    const yyyy = m[3];
    if (+mm >= 1 && +mm <= 12 && +dd >= 1 && +dd <= 31) return `${yyyy}-${mm}-${dd}`;
  }
  m = s.match(/(?:^|[^0-9])(\d{4})[.\-_](\d{2})[.\-_](\d{2})(?:[^0-9]|$)/);
  if (m) {
    const yyyy = m[1];
    const mm = m[2];
    const dd = m[3];
    if (+mm >= 1 && +mm <= 12 && +dd >= 1 && +dd <= 31) return `${yyyy}-${mm}-${dd}`;
  }
  return '';
}

/** İHRACAT Excel'in gerçek tarihi — dosya adı öncelikli (dateKey yükleme günü olabilir) */
function _resolveIhracatDateKey(meta) {
  if (!meta) return '';
  const fromFile = _dateKeyFromFileName(meta.fileName);
  if (fromFile) return fromFile;
  return String(meta.dateKey || '').trim();
}

function _loadPiyasaState() {
  try {
    const raw = localStorage.getItem('piyasa_state_v1');
    if (!raw) return null;
    return JSON.parse(raw) || null;
  } catch (e) { return null; }
}

/** PİYASA uyarı bandı — header chip ile aynı “Yüklü …Hafta/tarih” formatı */
function _buildPiyasaWarnLabel(piy) {
  if (!piy) return 'Yüklü';
  const weekInfo = piy.week != null ? piy.week : (piy.sheet ? piy.sheet : '');
  let dateStr = '';
  if (piy.loadedAt) {
    const dt = new Date(piy.loadedAt);
    if (!isNaN(dt)) dateStr = _formatDateKeyTR(_dateKeyFromDate(dt));
  }
  if (weekInfo && dateStr) return `Yüklü ${weekInfo}.Hafta/${dateStr}`;
  if (weekInfo) return `Yüklü ${weekInfo}.Hafta`;
  if (dateStr) return `Yüklü ${dateStr}`;
  if (piy.sheet) return `Yüklü ${piy.sheet}`;
  return 'Yüklü';
}

function _buildExcelDateWarnBannerHtml(title, label) {
  const titleUpper = String(title || '').toLocaleUpperCase('tr-TR');
  return `<div class="excel-date-warn" role="alert">
    <span class="excel-date-warn__icon" aria-hidden="true"><i class="fas fa-exclamation"></i></span>
    <div class="excel-date-warn__body">
      <span class="excel-date-warn__title">${titleUpper}</span>
      <span class="excel-date-warn__pill excel-date-warn__pill--loaded">${label}</span>
    </div>
  </div>`;
}

function _computeExcelDateWarnHtml() {
  const todayKey = (typeof _todayKeyTR === 'function') ? _todayKeyTR() : '';
  const parts = [];

  try {
    const meta = (typeof loadDailyMeta === 'function') ? (loadDailyMeta() || {}) : {};
    const ihrCnt = (typeof loadDailyShipments === 'function') ? ((loadDailyShipments() || []).length || 0) : 0;
    const ihrDateKey = _resolveIhracatDateKey(meta);
    if (ihrCnt > 0 && ihrDateKey && todayKey && ihrDateKey !== todayKey) {
      parts.push(_buildExcelDateWarnBannerHtml('ihracat güncel tarih değil', _buildIhracatWarnLabel(meta)));
    }
  } catch (e) {}

  try {
    const piy = _loadPiyasaState();
    const piyCnt = Array.isArray(piy?.orders) ? piy.orders.length : 0;
    const piyDateKey = piy?.loadedAt ? _dateKeyFromDate(new Date(piy.loadedAt)) : '';
    if (piyCnt > 0 && piyDateKey && todayKey && piyDateKey !== todayKey) {
      parts.push(_buildExcelDateWarnBannerHtml('piyasa güncel tarih değil', _buildPiyasaWarnLabel(piy)));
    }
  } catch (e) {}

  return parts.join('');
}

function _refreshExcelDateWarnBanner() {
  const container = document.getElementById('excelDateWarnContainer');
  if (!container) return;
  container.innerHTML = _computeExcelDateWarnHtml();
}

// PİYASA modülü gibi dış modüller Excel yükleyince, header'daki yazıları anında güncellemek için
function refreshHeaderExcelInfo(){
  try {
    const info = _getExcelStatusInfo();

    const chipIhr = document.getElementById('chipIhracat');
    const chipIhrText = document.getElementById('chipIhracatText');
    if (chipIhr) {
      chipIhr.classList.remove('chip-ok','chip-warn');
      chipIhr.classList.add(info.ihrCount > 0 ? 'chip-ok' : 'chip-warn');
      chipIhr.title = info.ihrCount > 0 ? `İHRACAT Excel: ${info.ihrLine}` : 'İHRACAT Excel yüklü değil';
    }
    if (chipIhrText) chipIhrText.textContent = _buildIhracatChipText(info);

    const chipPiy = document.getElementById('chipPiyasa');
    const chipPiyText = document.getElementById('chipPiyasaText');
    if (chipPiy) {
      chipPiy.classList.remove('chip-ok','chip-warn','chip-alert');
      const piyCls = info.piyCount > 0 ? 'chip-ok' : 'chip-warn';
      const weekWarn = (info.warnings || []).some((w) => w.code === 'week_mismatch');
      chipPiy.classList.add(weekWarn ? 'chip-alert' : piyCls);
      chipPiy.title = info.piyCount > 0 ? `PİYASA Excel: ${info.piyLine}` : 'PİYASA Excel yüklü değil';
      if (weekWarn) chipPiy.title += ' — Hafta uyumsuzluğu olabilir';
    }
    if (chipPiyText) chipPiyText.textContent = _buildPiyasaChipText(info);
    try {
      const ihrChip = document.getElementById('chipIhracat');
      if (ihrChip && (info.warnings || []).length) ihrChip.classList.add('chip-alert');
    } catch (e) {}
    _refreshExcelDateWarnBanner();
  } catch(e) {}
}

// dışarı aç
try { window.refreshHeaderExcelInfo = refreshHeaderExcelInfo; } catch(e) {}

function purgeStrictExcelCaches(){
  // Excel yüklendiğinde: Excel dışındaki local veriler (eşleştirme/override/liste önbelleği) tamamen kapalı.
  const keys = [
    'eslestirmeListesi',
    'firmaListesi',
    'malzemeListesi',
    'recent_sevk_yerleri',
    'recent_firmalar',
    'recent_malzemeler',
    'firmaOverrides_v1'
  ];
  try {
    keys.forEach(k => { try { localStorage.removeItem(k); } catch(e){} });
  } catch(e){}
}

function rebuildListsFromExcelRows(rows){
  try{
    const r = Array.isArray(rows) ? rows : [];
    const firms = new Set();
    const mats = new Set();

    for (const x of r){
      const f = String(x?.firma || '').trim();
      if (f) firms.add(getFirmaKodOnly(f));
      const m = String(x?.malzeme || '').trim();
      if (m) mats.add(m);

      // ✅ Excel'den yükleme notu'nu eşleştirmeye ekle/güncelle
      const yuklemeNotu = String(x?.yuklemeNotu || '').trim();
      if (f && m && yuklemeNotu) {
        const existing = eslestirmeListesi.find(es => es.firma === f && es.malzeme === m);
        if (existing) {
          if (existing.yuklemeNotu !== yuklemeNotu) {
            eslestirmeStorage.update(existing.id, { yuklemeNotu });
          }
        } else {
          eslestirmeStorage.add(f, m, '', yuklemeNotu, '');
        }
      }
    }

    // ✅ Excel yüklüyken seçenekleri sadece Excel'den üret
    firmaListesi = Array.from(firms).filter(Boolean).sort();
    malzemeListesi = Array.from(mats).filter(Boolean).sort();

    // UI açık ise select'leri güncelle
    const firmaSel = document.getElementById('firmaSelect');
    if (firmaSel) {
      const cur = firmaSel.value;
      // ✅ SECURITY: Escape firma values (XSS protection)
      firmaSel.innerHTML = '<option value="">Seçiniz veya elle yazın</option>' +
        firmaListesi.map(f => `<option value="${escapeAttr(f)}">${escapeHtml(f)}</option>`).join('');
      if (cur) firmaSel.value = cur;
    }

    const malSel = document.getElementById('malzemeSelect');
    if (malSel) {
      const curM = malSel.value;
      // ✅ SECURITY: Escape malzeme values (XSS protection)
      malSel.innerHTML = '<option value="">Seçiniz veya elle yazın</option>' +
        malzemeListesi.map(m => `<option value="${escapeAttr(m)}">${escapeHtml(m)}</option>`).join('');
      if (curM) malSel.value = curM;
    }
  }catch(e){}
}
// Ambalaj metnini header satırından yakala (NET'li/NET'siz, 1 veya 2 ambalaj):
// Örn: "NET 25 KG ... NET 1200 KG ..." -> "NET 25 KG ... + NET 1200 KG ..."
// Örn: "1250 KG'LIK ... BIGBAGLER"     -> "NET 1250 KG ... BIGBAGLER"
function extractAmbalajFromHeader(headerText) {
  const raw = String(headerText || '')
    .replace(/\./g, '')       // 1.250 -> 1250
    .replace(/'/g, '')         // KG'LIK -> KGLIK
    .replace(/\s+/g, ' ')
    .toUpperCase()
    .trim();

  const parts = raw.split('/').map(p => p.trim()).filter(Boolean);
  const results = [];

  for (const part of parts) {
    // 1) NET 25 KG / NET 1200 KG (aynı segmentte birden fazla olabilir)
    const netMatches = [...part.matchAll(/\bNET\s*([0-9]{1,5})\s*KG\b([^\/]*)/gi)];
    for (const m of netMatches) {
      const kg = parseInt(m[1], 10);
      let text = `NET ${kg} KG ${m[2] || ''}`;
      text = cleanAmbalajText(text);
      if (text) results.push({ kg, text });
    }

    // 2) NET yok ama "1250 KG'LIK ... BIGBAG/ÇUVAL" gibi
    const nonNetMatches = [...part.matchAll(/\b([0-9]{1,5})\s*KG(LIK)?\b([^\/]*)/gi)];
    for (const m of nonNetMatches) {
      const kg = parseInt(m[1], 10);
      const rest = String(m[3] || '').trim();

      // Ambalaj anahtar kelimesi yoksa alma (HP 0,074-0,30 gibi alanları ele)
      if (!/(BIGBAG|BIG BAG|BİGBAG|CUVAL|ÇUVAL|PALET|BBT)/i.test(rest)) continue;

      let text = `NET ${kg} KG ${rest}`;
      text = cleanAmbalajText(text);
      if (text) results.push({ kg, text });
    }
  }

  if (!results.length) return '';

  // Tekrarları temizle
  const uniq = [];
  const seen = new Set();
  for (const r of results) {
    const key = String(r.text || '').toUpperCase().trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    uniq.push(r);
  }

  // Küçükten büyüğe: 25 KG + 1200/1250 KG
  uniq.sort((a, b) => (a.kg || 0) - (b.kg || 0));

  return uniq.map(x => x.text).join(' + ');
}

function cleanAmbalajText(text) {
  return String(text || '')
    // sevkiyat sonrası alanları buda
    .replace(/\bBOOKING\b.*$/i, '')
    .replace(/\bGEM[İI]\b.*$/i, '')
    .replace(/\bGEMI\b.*$/i, '')
    .replace(/\bEXPORT\b.*$/i, '')
    .replace(/\bTON\b.*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}


// ✅ Aday üretimi: Ambalaj (NET'li + NET'siz KG'LIK) -> seçenek listesi
function getAmbalajCandidates(headerText){
  const raw = String(headerText || '')
    .replace(/\./g,'')
    .replace(/'/g,'')
    .replace(/\s+/g,' ')
    .toUpperCase()
    .trim();

  const parts = raw.split('/').map(p=>p.trim()).filter(Boolean);
  const out = [];

  for (const part of parts) {
    // NET xxx KG ... (aynı segmentte birden fazla)
    for (const m of part.matchAll(/\bNET\s*([0-9]{1,5})\s*KG\b([^\/]*)/gi)) {
      const kg = parseInt(m[1],10);
      let t = `NET ${kg} KG ${m[2]||''}`;
      t = cleanAmbalajText(t);
      if (t) out.push({kg, text:t});
    }
    // NET yok ama 1250 KG'LIK ...
    for (const m of part.matchAll(/\b([0-9]{1,5})\s*KG(LIK)?\b([^\/]*)/gi)) {
      const kg = parseInt(m[1],10);
      const rest = String(m[3]||'').trim();
      if (!/(BIGBAG|BIG BAG|BİGBAG|ÇUVAL|CUVAL|TORBA|JUMBO|SACK|BAG|PALET|BBT)/i.test(rest)) continue;
      let t = `NET ${kg} KG ${rest}`;
      t = cleanAmbalajText(t);
      if (t) out.push({kg, text:t});
    }
  }

  // uniq + küçükten büyüğe
  const seen = new Set();
  const uniq = [];
  for (const x of out) {
    const k = x.text;
    if (!k || seen.has(k)) continue;
    seen.add(k);
    uniq.push(x);
  }
  uniq.sort((a,b)=> (a.kg||0)-(b.kg||0));
  return uniq.map(x=>x.text);
}

// ✅ Aday üretimi: Liman / Sevk Yeri (çoğunlukla son segment + bilinen isimler)
function getLimanCandidates(headerText){
  const s = String(headerText || '').replace(/\s+/g,' ').trim();
  if (!s) return [];
  const parts = s.split('/').map(p=>p.trim()).filter(Boolean);

  // Bilinen liman/terminal kelimeleri (gerekirse buraya ekleyebilirsin)
  const known = [
    'DP WORLD','EVYAP','GEMPORT','SAFIPORT','MARDAS','MARDAŞ','MARPORT','ASYA PORT','ASYA PORTS',
    'KUMPORT','KUMPORT LİMANI','KUMPORT LIMANI','LIMAŞ','LIMAS','LİMAŞ','ALSANCAK','HAYDARPASA','HAYDARPAŞA',
    'GEMLIK','GEMLİK','YILPORT','YILPORT GEMLIK','AKDENIZ PORT','AKDENİZ PORT',
    'KORFEZ','KÖRFEZ','MEDLOG','KORFEZ MEDLOG','KÖRFEZ MEDLOG','DEPO','TERMINAL','TERMİNAL','LIMAN','LİMAN','PORT'
  ];

  const skipRe = /(GEM[İI]\s*DETAYI|BOOKING\s*NO|LOT\s*NO|HP\s*\d|TON\b|BBT\b|PALET\b|ÇUVAL\b|CUVAL\b|NET\s*\d+\s*KG)/i;

  // Adayları topla: son segmentlere daha fazla ağırlık veriyoruz
  const candidates = [];
  for (let i = 0; i < parts.length; i++) {
    const seg = parts[i];
    if (!seg) continue;
    if (skipRe.test(seg)) continue;

    // Bilinen kelime içeriyorsa güçlü aday
    const upper = seg.toUpperCase();

    let score = 0;
    for (const k of known) {
      if (upper.includes(k)) { score += 3; break; }
    }

    // sonlara yakınsa bonus
    const distFromEnd = (parts.length - 1) - i;
    if (distFromEnd <= 1) score += 2;
    if (distFromEnd <= 3) score += 1;

    // Liman/terminal/depo gibi sinyaller
    if (/(PORT|LIMAN|LİMAN|TERMINAL|TERMİNAL|DEPO|MEDLOG|KORFEZ|KÖRFEZ)/i.test(seg)) score += 2;

    if (score > 0) candidates.push({ text: seg, score });
  }

  // Sadece text'e indir, tekrarları temizle
  candidates.sort((a,b)=> b.score - a.score);
  const uniq = [];
  const seen = new Set();
  for (const x of candidates) {
    const key = x.text.toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    uniq.push(x.text);
  }

  return uniq.slice(0,6); // UI şişmesin
}

// ✅ YD anahtarını normalize et (YD28(G) -> YD28)
function normalizeYdKey(val){
  const s = String(val || '');
  const m = s.match(/\b(YD\d{1,4})\b/i);
  return m ? m[1].toUpperCase() : s.trim().toUpperCase();
}
function findSevkYeriNear(grid, headerRowIdx, headerText) {
  const ht = String(headerText || '').trim();
  if (ht && ht.includes('/')) {
    const parts = ht.split('/').map(p => p.trim()).filter(Boolean);
    if (parts.length) return parts[parts.length - 1];
  }
  return '';
}

// ✅ Dinamik header satırını bul (hard-coded indeks yerine)
function findHeaderRowIndex(grid) {
  // SIRANO+PLAKA veya YDxxx + PLAKA + BBT (ihracat takip listesi) satırını bul
  for (let r = 0; r < Math.min(grid.length, 80); r++) {
    const row = grid[r] || [];
    const rowText = _rowToText(row).toUpperCase();
    if (rowText.includes('SIRANO') && rowText.includes('PLAKA')) return r;
    if (rowText.includes('PLAKA') && rowText.includes('BBT') && /\bYD\d{1,4}\b/.test(rowText)) return r;
  }
  return -1;
}

// ✅ Header satırından kolonna indekslerini dinamik olarak bul
function findColumnIndices(headerRow) {
  const indices = {};
  if (!Array.isArray(headerRow)) return indices;
  
  const targets = [
    { key: 'sirano', names: ['SIRANO'] },
    { key: 'plaka', names: ['PLAKA'] },
    { key: 'aciklama', names: ['AÇIKLAMA','ACIKLAMA','NOT','YÜKLEME NOTU','YUKLEME NOTU'] },
    { key: 'firma', names: ['FİRMA / MÜŞTERİ KODU','FIRMA / MÜŞTERİ KODU','FİRMA / MÜŞTERİ','MÜŞTERİ KODU','MUSTERI KODU'] },
    { key: 'irsaliyeNo', names: ['İRSALİYE NO', 'IRSALIYE NO', 'İRSALİYE','IRSALIYE'] },
    { key: 'malzeme', names: ['MALIN CİNSİ','MALIN CINSI','MALZEME'] },
    { key: 'tonajKg', names: ['TONAJ','TONAJ(KG)','KG'] },
    { key: 'bbt', names: ['BBT'] },
    { key: 'cuval', names: ['ÇUVAL','CUVAL'] },
    { key: 'palet', names: ['PALET'] },
    { key: 'bosBbt', names: ['BOŞ BBT','BOS BBT'] },
    { key: 'bosCuval', names: ['BOŞ ÇUVAL','BOS CUVAL'] },
    { key: 'netTonaj', names: ['NET TONAJ'] },
    { key: 'ogrTonaj', names: ['O.GR. TONAJ', 'O.GR TONAJ', 'BRÜT TONAJ'] },
    { key: 'gidenTonaj', names: ['GİDEN TONAJ', 'GIDEN TONAJ'] },
    { key: 'fark', names: ['FARK'] }
  ];
  
  for (let c = 0; c < headerRow.length; c++) {
    const cell = String(headerRow[c] || '').toUpperCase().trim();
    for (const target of targets) {
      if (indices[target.key] !== undefined) continue;
      for (const name of target.names) {
        if (cell.includes(name)) {
          indices[target.key] = c;
          break;
        }
      }
    }
  }
  
  return indices;
}

/** İhracat bloğu: sol taraftaki ilk PLAKA sütunundan sabit kolon düzeni */
function resolveIhracatBlockCols(headerRow) {
  const row = headerRow || [];
  let plakaCol = -1;
  for (let c = 0; c < row.length; c++) {
    if (String(row[c] || '').toUpperCase().trim() === 'PLAKA') {
      plakaCol = c;
      break;
    }
  }
  if (plakaCol >= 0) {
    return {
      plaka: plakaCol,
      sirano: plakaCol > 0 ? plakaCol - 1 : 0,
      bbt: plakaCol + 1,
      cuval: plakaCol + 2,
      palet: plakaCol + 3,
      bosBbt: plakaCol + 4,
      bosCuval: plakaCol + 5,
      netTonaj: plakaCol + 6,
      ogrTonaj: plakaCol + 7,
      gidenTonaj: plakaCol + 8,
      fark: plakaCol + 9,
    };
  }
  const merged = findColumnIndices(row);
  for (let c = 0; c < row.length; c++) {
    const cell = String(row[c] || '').toUpperCase().trim();
    if (merged.netTonaj === undefined && cell.includes('NET TONAJ')) merged.netTonaj = c;
    if (merged.ogrTonaj === undefined && cell.includes('O.GR') && cell.includes('TONAJ')) merged.ogrTonaj = c;
    if (merged.gidenTonaj === undefined && (cell.includes('GİDEN') || cell.includes('GIDEN'))) merged.gidenTonaj = c;
    if (merged.fark === undefined && cell === 'FARK') merged.fark = c;
  }
  return merged;
}

function isIhracatBlockHeaderRow(row) {
  const rowText = _rowToText(row).toUpperCase();
  if (!rowText.includes('PLAKA') || !rowText.includes('BBT')) return false;
  const c0 = String(row[0] || '').toUpperCase().trim();
  if (/^YD\d{1,4}$/.test(c0)) return true;
  return rowText.includes('SIRANO') && rowText.includes('PLAKA');
}

/** Excel blok üst satırları: uzun YD başlığı hücresi (birleştirilmiş satır değil) */
function _pickIhracatMainHeaderCell(row) {
  let best = '';
  for (const v of row || []) {
    const s = String(v ?? '').trim();
    if (!s || !/\bYD\d{1,4}/i.test(s) || !s.includes('/')) continue;
    if (!/BOOKING\s*NO/i.test(s) && !/NET\s*\d+\s*KG/i.test(s)) continue;
    if (s.length > best.length) best = s;
  }
  return best;
}

function _pickIhracatExportRefCell(row) {
  for (const v of row || []) {
    const s = String(v ?? '').trim();
    if (/EXPORT\s*REF/i.test(s)) return s;
  }
  return '';
}

function _pickIhracatPortFromRow(row) {
  for (const v of row || []) {
    const s = String(v ?? '').trim();
    if (/^BORUSAN\/GEML[Iİ]K$/i.test(s)) return s.toUpperCase();
    if (/^DP\s+WORLD$/i.test(s)) return 'DP WORLD';
  }
  return '';
}

function _pickIhracatFooterCell(row) {
  for (const v of row || []) {
    const s = String(v ?? '').trim();
    if (!s || /MAX\.|ARTI TOLERANS|^BOOKING$/i.test(s)) continue;
    if (/^\d+\s*BBT\s+\d+\s*PALET/i.test(s)) return s.match(/^\d+\s*BBT\s+\d+\s*PALET/i)[0].toUpperCase();
    if (/YENİ\s+MÜŞTERİ|MÜŞTERİ\.|rica ederim|standart değer/i.test(s)) return s;
    if (/SEVKİYATLARDA|SEVKIYATLARDA|DİKKAT\s+EDİLECEK|DIKKAT\s+EDILECEK/i.test(s)) return s;
    if (s.length > 35 && !/EXPORT\s*REF|BOOKING|GEM[İI]\s*DETAYI|YD\d{1,4}/i.test(s)) return s;
  }
  return '';
}

function _stripPortFromHeaderLine(s) {
  return String(s || '')
    .replace(/\s*\/\s*BORUSAN\/GEML[Iİ]K\s*/gi, ' / ')
    .replace(/\s*\/\s*DP\s+WORLD\s*/gi, ' / ')
    .replace(/\s*\/\s*$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function _splitMainHeaderBlackLines(mainHeader) {
  let s = String(mainHeader || '').replace(/\s+/g, ' ').trim();
  if (!s) return { line1: '', line2: '' };
  s = s.replace(/\s*\/\s*(BORUSAN\/GEML[Iİ]K|DP\s+WORLD)\s*$/i, '').trim();

  const istifli = s.match(/^(.*?)\s*(PALETE İSTİFLİ\s*\/.*)$/i);
  if (istifli) {
    return { line1: istifli[1].replace(/\s*\/\s*$/, '').trim(), line2: istifli[2].trim() };
  }

  const lineerRe = /\b(L[Iİ]NEERL[Iİ]|LINEERLI)\s*\([^)]+\)/i;
  const lm = s.match(lineerRe);
  if (lm && lm.index != null) {
    return {
      line1: s.slice(0, lm.index).trim().replace(/\s*\/\s*$/, ''),
      line2: s.slice(lm.index).trim(),
    };
  }

  const gemi = s.match(/^(.*?)\s*(GEM[İI]\s*DETAYI\s*:.*)$/i);
  if (gemi) {
    return { line1: gemi[1].replace(/\s*\/\s*$/, '').trim(), line2: gemi[2].trim() };
  }

  return _splitHeaderBlackLines(s);
}

function parseIhracatBlockMeta(grid, tableHeaderRowIdx) {
  const out = {
    mainHeader: '',
    blackLine1: '',
    blackLine2: '',
    portLine: '',
    borusanLine: '',
    exportLine: '',
    footerLine: '',
    bbtPaletLine: '',
    noteLine: '',
    subLines: [],
  };

  const above = [];
  for (let rr = tableHeaderRowIdx - 1; rr >= Math.max(0, tableHeaderRowIdx - 8); rr--) {
    const row = grid[rr] || [];
    const text = _rowToText(row);
    if (!text) continue;
    above.unshift({ rr, row, text });
  }

  let mainItem = null;
  for (const item of above) {
    const main = _pickIhracatMainHeaderCell(item.row);
    if (main) {
      mainItem = { ...item, main };
      break;
    }
  }

  if (mainItem) {
    out.mainHeader = mainItem.main;
    const portFromMain = mainItem.main.match(/\s*\/\s*(BORUSAN\/GEML[Iİ]K|DP\s+WORLD)\s*$/i);
    if (portFromMain) out.portLine = portFromMain[1].toUpperCase().replace('BORUSAN/GEMLIK', 'BORUSAN/GEMLİK');
    const split = _splitMainHeaderBlackLines(mainItem.main);
    out.blackLine1 = split.line1;
    out.blackLine2 = split.line2;
  }

  let exportItem = null;
  for (const item of above) {
    if (item === mainItem) continue;
    const { row, text } = item;

    if (/EXPORT\s*REF/i.test(text)) {
      exportItem = item;
      const raw = _pickIhracatExportRefCell(row) || text;
      const normalized = _normalizeExportRefLine(raw);
      if (normalized) {
        out.exportLine = normalized;
        out.subLines = [normalized];
      }
      const port = _pickIhracatPortFromRow(row);
      if (port) out.portLine = port;
    }
  }

  const footerAnchorRr = Math.max(mainItem ? mainItem.rr : -1, exportItem ? exportItem.rr : -1);
  const footerCandidates = above
    .filter((item) => item.rr > footerAnchorRr && item.rr < tableHeaderRowIdx)
    .filter((item) => item !== mainItem && item !== exportItem)
    .sort((a, b) => b.rr - a.rr);

  for (const item of footerCandidates) {
    const footer = _pickIhracatFooterCell(item.row, item.text);
    if (!footer) continue;
    out.footerLine = footer;
    if (/^\d+\s*BBT/i.test(footer)) {
      const bp = footer.match(/(\d+)\s*BBT\s+(\d+)\s*PALET/i);
      out.bbtPaletLine = bp ? `${bp[1]} BBT ${bp[2]} PALET` : footer;
    } else {
      out.noteLine = footer;
    }
    break;
  }

  out.borusanLine = out.portLine;
  return out;
}

function parseIhracatBlockToplamRow(row, blockCols) {
  if (!row || !blockCols) return null;
  const pick = (key) => {
    const idx = blockCols[key];
    if (idx === undefined) return '';
    const v = row[idx];
    if (v == null || v === '') return '';
    return typeof v === 'number' ? String(v) : String(v).trim();
  };
  const totals = {
    bbt: pick('bbt'),
    cuval: pick('cuval'),
    palet: pick('palet'),
    bosBbt: pick('bosBbt'),
    bosCuval: pick('bosCuval'),
    netTonaj: pick('netTonaj'),
    ogrTonaj: pick('ogrTonaj'),
    gidenTonaj: pick('gidenTonaj'),
    fark: pick('fark'),
  };
  return Object.values(totals).some((x) => String(x).trim() !== '') ? totals : null;
}

function extractBorusanLineFromHeader(headerText) {
  const t = String(headerText || '').trim();
  if (!t) return '';
  const m = t.match(/\b(BORUSAN\/GEML[Iİ]K|DP\s+WORLD)\b/i);
  if (!m) return '';
  if (/DP/i.test(m[1])) return 'DP WORLD';
  return m[1].toUpperCase().replace('BORUSAN/GEMLIK', 'BORUSAN/GEMLİK');
}

function _normalizeExportRefLine(raw) {
  let s = String(raw || '').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  s = s.replace(/\s*L[Iİ]MAN\s+BORUSAN\/GEML[Iİ]K\s*$/i, '').trim();
  s = s.replace(/\s+L[Iİ]MAN\s*$/i, '').trim();
  const idx = s.search(/EXPORT\s*REF/i);
  if (idx < 0) return '';
  s = s.slice(idx);
  if (!/^-{2,}/.test(s)) s = `---------- ${s}`;
  if (/L[Iİ]MAN\s*DOLUM/i.test(s) && !/\s-{2,}\s*L[Iİ]MAN\s*DOLUM/i.test(s)) {
    s = s.replace(/\s+(L[Iİ]MAN\s*DOLUM)/i, ' ---------- $1');
  }
  return s;
}

function _splitHeaderBlackLines(headerMain) {
  const main = String(headerMain || '').replace(/\s+/g, ' ').trim();
  if (!main) return { line1: '', line2: '' };
  const lineerRe = /\b(L[Iİ]NEERL[Iİ]|LINEERLI)\s*\([^)]+\)/i;
  const m = main.match(lineerRe);
  if (m && m.index != null) {
    return {
      line1: main.slice(0, m.index).trim().replace(/\s*\/\s*$/, ''),
      line2: main.slice(m.index).trim(),
    };
  }
  const parts = main.split(/\s*\/\s*/);
  const li = parts.findIndex((p) => /^L[Iİ]NEERL/i.test(p));
  if (li > 0) {
    return { line1: parts.slice(0, li).join(' / '), line2: parts.slice(li).join(' / ') };
  }
  return { line1: main, line2: '' };
}

function _buildIhracatHeaderDisplay(sample) {
  const meta = sample?.blockMeta || {};
  const headerText = String(meta.mainHeader || sample?.headerText || '').trim();

  let blackLine1 = String(meta.blackLine1 || '').trim();
  let blackLine2 = String(meta.blackLine2 || '').trim();
  if (!blackLine1 && headerText) {
    const split = _splitMainHeaderBlackLines(headerText);
    blackLine1 = split.line1;
    blackLine2 = split.line2;
  }

  let portLine = String(meta.portLine || meta.borusanLine || '').trim();
  if (!portLine && headerText) portLine = extractBorusanLineFromHeader(headerText);
  blackLine1 = _stripPortFromHeaderLine(blackLine1);
  blackLine2 = _stripPortFromHeaderLine(blackLine2);
  if (!portLine && blackLine2) {
    const pm = String(meta.mainHeader || headerText).match(/\s*\/\s*(BORUSAN\/GEML[Iİ]K|DP\s+WORLD)\s*$/i);
    if (pm) portLine = pm[1].toUpperCase().replace('BORUSAN/GEMLIK', 'BORUSAN/GEMLİK');
  }

  let exportLine = String(meta.exportLine || '').trim();
  if (!exportLine) {
    for (const ln of Array.isArray(meta.subLines) ? meta.subLines : []) {
      const n = _normalizeExportRefLine(ln);
      if (n) {
        exportLine = n;
        break;
      }
    }
  }

  const noteLine = String(meta.noteLine || '').trim();
  let footerLine = String(meta.footerLine || meta.bbtPaletLine || noteLine || '').trim();
  if (!footerLine && meta.bbtPaletLine) footerLine = meta.bbtPaletLine;
  const isBbtFooter = /^\d+\s*BBT/i.test(footerLine);
  const isFooterNote =
    !!noteLine ||
    (!isBbtFooter &&
      !!footerLine &&
      /YENİ\s+MÜŞTERİ|MÜŞTERİ\.|rica ederim|standart değer|SEVKİYATLARDA|SEVKIYATLARDA|DİKKAT\s+EDİLECEK|DIKKAT\s+EDILECEK/i.test(
        footerLine
      ));

  return {
    blackLine1,
    blackLine2,
    borusanLine: portLine,
    portLine,
    exportLine,
    bbtPaletSummary: footerLine,
    footerLine,
    noteLine,
    isFooterNote,
    isBbtFooter,
  };
}

/** İhracat Excel üst kutusundaki müşteri / sevkiyat uyarı metni (kırmızı alan) */
function getIhracatBlockFooterNote(shipment) {
  if (!shipment) return '';
  const cached = String(shipment.blockFooterNote || '').trim();
  if (cached) return cached;
  const d = _buildIhracatHeaderDisplay(shipment);
  if (d.isBbtFooter) return '';
  if (d.isFooterNote) return String(d.noteLine || d.footerLine || '').trim();
  const footer = String(d.footerLine || '').trim();
  if (
    footer &&
    /SEVKİYAT|SEVKIYAT|DİKKAT\s+EDİLECEK|DIKKAT\s+EDILECEK|YENİ\s+MÜŞTERİ|MÜŞTERİ\.|rica ederim/i.test(footer)
  ) {
    return footer;
  }
  return '';
}

function _ihracatBlockSelectionKey(headerText) {
  const ht = String(headerText || '').replace(/\s+/g, ' ').trim();
  if (!ht) return '';
  const yd = (ht.match(/\b(YD\d{1,4})\b/i) || [])[1] || '';
  const book = (ht.match(/BOOKING\s*NO\s*:\s*(\d+)/i) || [])[1] || '';
  const mal = _extractMalzeme(ht) || '';
  return [yd, book, mal].join('|').toUpperCase();
}

function _rowInSelectedBlocks(rowIdx, onlyBlocks, headerText) {
  if (!onlyBlocks || !onlyBlocks.length) return true;
  const selKey = _ihracatBlockSelectionKey(headerText);
  if (selKey) {
    const byHeader = onlyBlocks.some((b) => _ihracatBlockSelectionKey(b.headerText) === selKey);
    if (byHeader) return true;
  }
  return onlyBlocks.some((b) => rowIdx >= b.startRow && rowIdx <= b.endRow);
}

function parseIhracatRowsFromWorkbook(wb, sheetName, opts) {
  opts = opts || {};
  const onlyBlocks = opts.onlyBlocks || null;
  const fileLabel = opts.fileName || '';
  if (!wb || !sheetName) return { ok: false, msg: 'Sayfa yok.', rows: [], meta: {}, stats: {} };
  const ws = wb.Sheets[sheetName];
  const grid = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, blankrows: true });

  // ✅ Header satırını dinamik olarak bul
  const headerRowIdx = findHeaderRowIndex(grid);
  if (headerRowIdx < 0) {
    return { ok: false, msg: 'Excel başlığı bulunamadı (SIRANO + PLAKA).', rows: [], meta: {}, stats: {} };
  }

  // ✅ Kolonna indekslerini dinamik olarak bul
  const headerRow = grid[headerRowIdx] || [];
  const cols = findColumnIndices(headerRow);
  
  // Excel'de B sütununda not varsa, header adının olmaması durumunda B'yi fallback olarak al
  if (cols.aciklama === undefined && headerRow.length > 1) {
    const secondHeader = String(headerRow[1] || '').trim().toUpperCase();
    const isKnown = /SIRANO|PLAKA|FIRMA|MALZEME|TONAJ|BBT|ÇUVAL|CUVAL|PALET|KOLI|AÇIKLAMA|ACIKLAMA|NOT|YÜKLEME|YUKLEME|İRSALİYE|IRSALİYE/.test(secondHeader);
    if (!isKnown) {
      cols.aciklama = 1;
    }
  }

  // Zorunlu kolonnaları kontrol et
  if (cols.sirano === undefined || cols.plaka === undefined) {
    return { ok: false, msg: 'Excel formatı tanınmadı (SIRANO veya PLAKA bulunamadı).', rows: [], meta: {}, stats: {} };
  }

  // Başlıkta "İRSALİYE NO" yoksa A sütunu (R11…) otomatik tanı
  const irsaliyeCol = detectIrsaliyeColumnIndex(grid, headerRowIdx, cols);
  if (irsaliyeCol !== undefined) cols.irsaliyeNo = irsaliyeCol;

  const rowsOut = [];

  for (let r = 0; r < grid.length; r++) {
    const row = grid[r] || [];
    if (!isIhracatBlockHeaderRow(row)) continue;

    const blockCols = resolveIhracatBlockCols(row);
    if (blockCols.plaka === undefined) continue;

    const blockMeta = parseIhracatBlockMeta(grid, r);
    const headerText = blockMeta.mainHeader || findShipmentHeaderText(grid, r) || '';
    if (!/\bYD\d{1,4}\b/i.test(headerText)) continue;
    if (!_rowInSelectedBlocks(r, onlyBlocks, headerText)) continue;
    const ambalaj = ''; // otomatik ambalaj okuma kapali (manuel / aday secim)
    const sevkYeri = ''; // otomatik sevk yeri okuma kapali (manuel / aday secim)
    const noteColumnIndex = (cols.aciklama !== undefined ? cols.aciklama : 1);
    let blockYuklemeNotu = '';
    let blockTotals = null;

    for (let rr = r+1; rr < grid.length; rr++) {
      const d = grid[rr] || [];
      const rawA0 = String(d[0] || '').trim();
      const rowTextUpper = _rowToText(d).toUpperCase();
      if (rr > r + 1 && isIhracatBlockHeaderRow(d)) break;
      if (/\bTOPLAM\b/.test(rowTextUpper) && !/ARA\s+TOPLAM/.test(rowTextUpper)) {
        blockTotals = parseIhracatBlockToplamRow(d, blockCols);
        break;
      }
      if (/\bKALAN\b/.test(rowTextUpper)) break;

      const plakaRaw = blockCols.plaka !== undefined ? d[blockCols.plaka] : null;
      const maybeNote = String(d[noteColumnIndex] || '').trim();
      const rowText = _rowToText(d).toUpperCase();
      const isLikelyNote = maybeNote.length > 20 && /[A-ZÇĞİÖŞÜİ]/i.test(maybeNote) && !/(SIRANO|PLAKA|BBT|ÇUVAL|CUVAL|PALET|TONAJ|TARİH|TARIH|FİRMA|FIRMA|MALZEME|AÇIKLAMA|ACIKLAMA|NOT|YÜKLEME|YUKLEME)/i.test(rowText);
      if (!plakaRaw && !blockYuklemeNotu && isLikelyNote) {
        blockYuklemeNotu = maybeNote;
        continue;
      }
      if (!plakaRaw) continue;

      // ✅ ydKey kısa anahtar olarak kalsın
const firmaFromN = extractFirmaTextFromN(ws, rr + 1, 40);
const ydFromHeader = ((headerText || '').match(/\b(YD\d{1,4})\b/i) || [])[1]?.toUpperCase() || '';
const ydKey = (((firmaFromN || '').match(/\b(YD\d{1,4})\b/i) || [])[1] || ydFromHeader || '').trim().toUpperCase();

// ✅ Firma = N sütunundaki TAM hücre
const firma = String(firmaFromN || ydKey || '').trim();

     const irsaliyeNo = resolveIrsaliyeFromRow(d, { ...cols, ...blockCols });
     const blockFooterNote = getIhracatBlockFooterNote({ blockMeta });
     rowsOut.push({
  id: irsaliyeNo || String(d[0] || '').trim(),
  sira: blockCols.sirano !== undefined ? (d[blockCols.sirano] != null ? String(d[blockCols.sirano]).trim() : '') : '',
  plaka: normPlate(plakaRaw),
  ydKey: ydKey,
  headerText: headerText,
  blockKey: `BLK_${r}`,
  blockHeaderRow: r,
  blockMeta,
  blockFooterNote,
  blockTotals,
  fileName: String(fileLabel || '').trim(),
firma: (firma || '').slice(0, 40),

  irsaliyeNo,
  malzeme: cols.malzeme !== undefined ? (d[cols.malzeme] != null ? String(d[cols.malzeme]).trim() : '') : '',
  tonajKg: blockCols.netTonaj !== undefined ? _nz(d[blockCols.netTonaj]) : (cols.tonajKg !== undefined ? _nz(d[cols.tonajKg]) : ''),
  bbt: blockCols.bbt !== undefined ? _nz(d[blockCols.bbt]) : '',
  cuval: blockCols.cuval !== undefined ? _nz(d[blockCols.cuval]) : '',
  palet: blockCols.palet !== undefined ? _nz(d[blockCols.palet]) : '',
  bosBbt: blockCols.bosBbt !== undefined ? _nz(d[blockCols.bosBbt]) : '',
  bosCuval: blockCols.bosCuval !== undefined ? _nz(d[blockCols.bosCuval]) : '',

  yuklemeNotu: (String(d[noteColumnIndex] || '').trim() || blockYuklemeNotu),

  firma,
  sevkYeri,
  ambalaj
});
    }
  }

  // uniq
  const uniq = [];
  const seen = new Set();
  for (const x of rowsOut) {
    const k = `${x.plaka}__${x.id}__${x.sira}`;
    if (seen.has(k)) continue;
    seen.add(k);
    uniq.push(x);
  }

  const meta = {
    dateKey: _dateKeyFromFileName(fileLabel) || _todayKeyTR(),
    sheetName: sheetName,
    fileName: fileLabel,
    importedAt: new Date().toISOString(),
    count: uniq.length,
    fileFingerprint: opts.fileFingerprint || null,
  };

  const counts = new Map();
  for (const r of uniq) {
    const p = String(r?.plaka || '').trim();
    if (!p) continue;
    counts.set(p, (counts.get(p) || 0) + 1);
  }
  const dupPlates = Array.from(counts.values()).filter((c) => c > 1).length;
  const eu = window.ExcelUtils || {};
  const collisions = eu.findIrsaliyeCollisions ? eu.findIrsaliyeCollisions(uniq) : [];

  return {
    ok: true,
    rows: uniq,
    meta,
    stats: {
      accepted: uniq.length,
      raw: rowsOut.length,
      skipped: Math.max(0, rowsOut.length - uniq.length),
      dupPlates,
      collisions,
    },
  };
}

async function commitIhracatImport(uniq2, meta, file) {
  let rowsToSave = uniq2;
  let metaToSave = meta;

  try {
    const existing = (typeof loadDailyShipments === 'function') ? (loadDailyShipments() || []) : [];
    const existingMeta = (typeof loadDailyMeta === 'function') ? (loadDailyMeta() || {}) : {};

    if (Array.isArray(existing) && existing.length > 0) {
      const doAppend = await confirm(
        `Mevcut Excel verisi var: ${existing.length} kayıt.\n\nYeni dosya EKLENSİN mi?\n• OK  = Ekle (2 Excel aynı anda)\n• İptal = Değiştir (eskisi silinir)`
      );

      if (doAppend) {
        rowsToSave = existing.concat(uniq2);
        const files = []
          .concat(existingMeta.files || (existingMeta.fileName ? [existingMeta.fileName] : []))
          .concat((file && file.name) || meta.fileName || '')
          .map((s) => String(s || '').trim())
          .filter(Boolean);
        const seenF = new Set();
        const uniqFiles = [];
        for (const f of files) {
          if (!seenF.has(f)) {
            seenF.add(f);
            uniqFiles.push(f);
          }
        }
        metaToSave = {
          ...existingMeta,
          ...meta,
          importedAt: existingMeta.importedAt || meta.importedAt,
          files: uniqFiles,
          fileName: uniqFiles.join(' + '),
          count: rowsToSave.length,
          appendedAt: new Date().toISOString(),
        };
      } else {
        rowsToSave = uniq2;
        metaToSave = meta;
      }
    }
  } catch (e) {
    rowsToSave = uniq2;
    metaToSave = meta;
  }

  const ok = saveDailyShipments(rowsToSave, metaToSave);
  if (!ok) return { ok: false, msg: 'Kaydetme başarısız (localStorage dolu olabilir).' };

  purgeStrictExcelCaches();
  rebuildListsFromExcelRows(rowsToSave);
  try {
    window.refreshHeaderExcelInfo && window.refreshHeaderExcelInfo();
  } catch (e) {}

  return { ok: true, msg: `✅ Excel yüklendi: ${uniq2.length} satır`, meta: metaToSave };
}

window.parseIhracatRowsFromWorkbook = parseIhracatRowsFromWorkbook;
window.commitIhracatImport = commitIhracatImport;

// Excel okuma (XLSX) - Dinamik header arama ile
async function importDailyExcel(file) {
  if (!file) return { ok: false, msg: 'Dosya seçilmedi.' };
  try {
    if (typeof window.ensureXlsxLoaded === 'function') await window.ensureXlsxLoaded();
  } catch (e) {
    return { ok: false, msg: 'XLSX kütüphanesi yüklenemedi. İnternet bağlantınızı kontrol edin.' };
  }
  if (typeof XLSX === 'undefined') {
    return { ok: false, msg: 'XLSX kütphanesi yüklenemedi. (xlsx.full.min.js)' };
  }

  let fp = '';
  try {
    if (window.ExcelUtils && window.ExcelUtils.fingerprintFile) fp = await window.ExcelUtils.fingerprintFile(file);
  } catch (e) {}

  const existingMeta = (typeof loadDailyMeta === 'function') ? loadDailyMeta() : {};
  if (fp && existingMeta.fileFingerprint === fp && (loadDailyShipments() || []).length) {
    const again = confirm('Bu dosya daha önce yüklendi.\n\nYine de yüklemek istiyor musunuz?');
    if (!again) return { ok: false, msg: 'Yükleme iptal edildi.' };
  }

  const data = await file.arrayBuffer();
  const wb = XLSX.read(data, { type: 'array' });
  let sheetName = wb.SheetNames && wb.SheetNames[0];
  if (window.ExcelIhracatImport && wb.SheetNames && wb.SheetNames.length > 1) {
    const picked = await window.ExcelIhracatImport.pickIhracatSheet(wb);
    if (!picked) return { ok: false, msg: 'Sayfa seçilmedi.' };
    sheetName = picked;
  }
  if (!sheetName) return { ok: false, msg: 'Excel sayfası bulunamadı.' };

  const parsed = parseIhracatRowsFromWorkbook(wb, sheetName, {
    fileName: file.name,
    fileFingerprint: fp,
  });
  if (!parsed.ok) return { ok: false, msg: parsed.msg || 'Excel okunamadı.' };

  if (window.ExcelIhracatImport) {
    const confirmed = await window.ExcelIhracatImport.showImportPreview(parsed.stats);
    if (!confirmed) return { ok: false, msg: 'Yükleme iptal edildi.' };
  }

  const committed = await commitIhracatImport(parsed.rows, { ...parsed.meta, fileFingerprint: fp }, file);
  return committed;
}


/* =========================================================================
   ✅ Sevkiyat BAŞLIK OKUMA + SEÇİM TABLOSU (Sadece başlıklar)
   - Kullanıcı sevkiyatları tekli/çoklu seçer
   - Bu sürümde import YAPMAZ (sadece seçim ekranı gösterir)
   ========================================================================= */

// Alias for null-safe string conversion (use escapeHtml for HTML context)
function _safeStr(x){ return (x==null)?'':String(x); }
function _rowToText(row){
  if (!row || !Array.isArray(row)) return '';
  const parts = row.map(v => _safeStr(v).replace(/\s+/g,' ').trim()).filter(Boolean);
  return parts.join(' ').replace(/\s+/g,' ').trim();
}

function _findFirst(regex, text){
  const m = (text || '').match(regex);
  return m ? (m[1] || m[0] || '').trim() : '';
}

function _extractFirmaKod(headerText){
  // YD138(M) -> YD138
  return _findFirst(/\b(YD\d{2,4})\b/i, headerText) || '';
}

// ✅ Firma/YD anahtarı: kullanıcı "YD28(G) ..." yazsa bile "YD28" üretir.
// Autofill ve eşleştirme için her yerde aynı anahtar kullanılmalı.
function _firmaKey(val){
  const s = String(val || '');
  return (_extractFirmaKod(s) || s.trim());
}

function extractFirmaKodWithPO(raw) {
  const text = String(raw || '').replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim();
  
  // ✅ YD kodunu al ve (M) veya başka suffix'leri temizle
  // YD113(M) → YD113, YD05(MAVİ) → YD05 vb.
  const ydMatch = text.match(/\b(YD\d{1,4})\b/i);
  let ydKod = ydMatch ? ydMatch[1].toUpperCase() : '';
  
  if (!ydKod) return String(raw || '').trim();

  // ✅ PO veya PFK ile birlikte ürün bilgisini yakala
  // Formatlar: PFK 25-32, PO 21-33, PO:C2603-D1000, PO NO: 21-33, PFK NO:52-63 vb.
  // Regex: P(O|FK) + isteğe bağlı boşluk/NO + boşluk + kod (alphanumeric, dash, colon)
  const poMatch = text.match(/\b(P(?:O|FK)\s*(?:NO:?)?\s*[\w\-:]+)/i);
  let poKod = '';
  
  if (poMatch) {
    // Boşlukları normalize et (PO NO: 21-33 → PO NO: 21-33) ve büyük yapla
    poKod = poMatch[1].replace(/\s+/g, ' ').toUpperCase().trim();
  }

  console.log('extractFirmaKodWithPO called with:', raw, '-> ydKod:', ydKod, 'poKod:', poKod, 'result:', poKod ? (ydKod + ' / ' + poKod) : ydKod);

  return poKod ? (ydKod + ' / ' + poKod) : ydKod;
}

function _extractMalzeme(headerText){
  // HP 0,074-0,30 / HP 0.074-0.30
  const m = headerText.match(/\bHP\s*([0-9][0-9\.,]*\s*-\s*[0-9][0-9\.,]*)\b/i);
  if (!m) return '';
  const rng = String(m[1] || '').replace(/\s+/g,'').replace(/\./g,','); // TR format
  return `HP ${rng}`;
}

function _extractSevkYeri(headerText){
  return ''; // otomatik sevk yeri okuma kapali (manuel opsiyonel)
}


function _extractAmbalaj(headerText){
  return ''; // otomatik ambalaj okuma kapali
}


function _extractTotal(headerText, key){
  const t = (headerText || '').replace(/\s+/g,' ').trim().toUpperCase();
  if (key === 'BBT') {
    const m = t.match(/\b([0-9]{1,6})\s*BBT\b/);
    return m ? m[1] : '';
  }
  if (key === 'PALET') {
    const m = t.match(/\b([0-9]{1,6})\s*PALET\b/);
    return m ? m[1] : '';
  }
  if (key === 'ÇUVAL') {
    const m = t.match(/\b([0-9][0-9\.\,]{0,8})\s*ÇUVAL\b/);
    return m ? m[1].replace(/\./g,'').replace(/,/g,'') : '';
  }
  return '';
}

// Grid'den sevkiyat başlıklarını bul (başlık satırı + aralık)
function parseShipmentBlocksFromGrid(grid){
  const headers = [];
  for (let r=0; r<grid.length; r++){
    const rowText = _rowToText(grid[r]);
    if (!rowText) continue;

    // Başlık heuristiği: YDxxx + LOT NO olan satır
    const hasLot = /LOT\s*NO/i.test(rowText);
    const hasFirma = /\bYD\d{2,4}\b/i.test(rowText);
    if (hasLot && hasFirma) {
      headers.push({ r, headerText: rowText });
    }
  }

  // blok aralıklarını belirle
  const blocks = headers.map((h, i) => {
    const startRow = h.r;
    const endRow = (i < headers.length-1) ? (headers[i+1].r - 1) : (grid.length - 1);
    const headerText = h.headerText;

    const blk = {
      id: `B${startRow}_${i+1}`,
      index: i+1,
      startRow,
      endRow,
      headerText,
      firma: _extractFirmaKod(headerText),
      malzeme: _extractMalzeme(headerText),
      sevkYeri: _extractSevkYeri(headerText),
      ambalaj: _extractAmbalaj(headerText),
      totalBBT: _extractTotal(headerText,'BBT'),
      totalPalet: _extractTotal(headerText,'PALET')
    };
    // 🔒 Excel başlık/blok parsing sırasında EŞLEŞTİRME'den otomatik doldurma kapalı.
    // Excel ne getiriyorsa o kullanılacak; local eşleştirme/önbellek karışmasın.

    return blk;
  });

  return blocks;
}

function closeShipmentSelectUI(){
  const el = document.getElementById('shipmentSelectOverlay');
  if (el) el.remove();
}

function showShipmentSelectUI(blocks, fileName){
  closeShipmentSelectUI();

  const overlay = document.createElement('div');
  overlay.id = 'shipmentSelectOverlay';
  overlay.style.cssText = `
    position: fixed; inset: 0; z-index: 999999;
    background: rgba(0,0,0,.55);
    display: flex; align-items: flex-start; justify-content: center;
    padding: 24px;
  `;

  const card = document.createElement('div');
  card.style.cssText = `
    width: min(1100px, 98vw);
    max-height: 92vh;
    overflow: auto;
    background: #101217;
    color: #fff;
    border: 1px solid rgba(255,255,255,.15);
    border-radius: 16px;
    box-shadow: 0 20px 60px rgba(0,0,0,.5);
    padding: 18px;
  `;

  const title = document.createElement('div');
  title.style.cssText = `display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom: 12px;`;
  // ✅ SECURITY: Use escapeHtml for user input (XSS protection)
  title.innerHTML = `
    <div>
      <div style="font-size:18px; font-weight:800;">📌 Excel Sevkiyat Seçimi</div>
      <div style="opacity:.85; margin-top:4px; font-size:13px;">
        Dosya: <b>${escapeHtml(fileName||'')}</b> • Bulunan sevkiyat: <b>${blocks.length}</b>
      </div>
      <div style="opacity:.85; margin-top:4px; font-size:12px;">
        Bu ekranda sadece <b>başlık bilgileri</b> gösterilir. (Henüz import yapılmaz.)
      </div>
    </div>
    <button id="shipmentSelectCloseBtn" style="background:#2b2f3a;color:#fff;border:1px solid rgba(255,255,255,.18);padding:10px 14px;border-radius:12px;cursor:pointer;">Kapat</button>
  `;

  const tableWrap = document.createElement('div');
  tableWrap.style.cssText = `margin-top: 10px; border:1px solid rgba(255,255,255,.12); border-radius:12px; overflow:hidden;`;
  const rows = blocks.map((b) => {
    // ✅ SECURITY: Use escapeHtml for user input in HTML context (XSS protection)
    const headerShort = escapeHtml(_safeStr(b.headerText)).slice(0,160) + (escapeHtml(_safeStr(b.headerText)).length>160 ? '…' : '');
    return `
      <tr style="border-bottom:1px solid rgba(255,255,255,.08);">
        <td style="padding:10px; text-align:center;"><input type="checkbox" class="shipPick" data-id="${escapeAttr(b.id)}" /></td>
        <td style="padding:10px; max-width:260px; white-space:normal; overflow-wrap:break-word; word-break:break-word; font-size:13px;"><b>${escapeHtml(b.firma || '-')}</b></td>
        <td style="padding:10px;">${escapeHtml(b.malzeme || '-')}</td>
        <td style="padding:10px; white-space:nowrap;">${escapeHtml(b.sevkYeri || '-')}</td>
        <td style="padding:10px;">${escapeHtml(b.ambalaj || '-')}</td>
        <td style="padding:10px; text-align:center;">${escapeHtml(b.totalBBT || '-')}</td>
        <td style="padding:10px; text-align:center;">${escapeHtml(b.totalPalet || '-')}</td>
        <td style="padding:10px; font-size:12px; opacity:.85;">${headerShort}</td>
      </tr>
    `;
  }).join('');

  tableWrap.innerHTML = `
    <table style="width:100%; border-collapse:collapse;">
      <thead style="background:rgba(255,255,255,.06);">
        <tr>
          <th style="padding:10px; width:60px;">Seç</th>
          <th style="padding:10px; width:90px;">Firma</th>
          <th style="padding:10px; width:160px;">Malzeme</th>
          <th style="padding:10px; width:120px;">Sevk Yeri</th>
          <th style="padding:10px;">Ambalaj</th>
          <th style="padding:10px; width:70px;">BBT</th>
          <th style="padding:10px; width:70px;">Palet</th>
          <th style="padding:10px; width:260px;">Başlık (kısa)</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;

  const actions = document.createElement('div');
  actions.style.cssText = `display:flex; gap:10px; align-items:center; justify-content:flex-end; margin-top: 14px; flex-wrap:wrap;`;

  actions.innerHTML = `
    <button id="shipPickAll" style="background:#1f6feb;color:#fff;border:none;padding:10px 14px;border-radius:12px;cursor:pointer;">Hepsini Seç</button>
    <button id="shipClearAll" style="background:#2b2f3a;color:#fff;border:1px solid rgba(255,255,255,.18);padding:10px 14px;border-radius:12px;cursor:pointer;">Temizle</button>
    <button id="shipConfirm" style="background:#7c3aed;color:#fff;border:none;padding:10px 14px;border-radius:12px;cursor:pointer;">Seçimleri Onayla</button>
  `;

  card.appendChild(title);
  card.appendChild(tableWrap);
  card.appendChild(actions);
  overlay.appendChild(card);
  document.body.appendChild(overlay);

  // ✅ Aday listelerini doldur (sevk yeri / ambalaj)
  try {
    const ambC = (candidates && Array.isArray(candidates.ambalaj)) ? candidates.ambalaj : [];
    const sevC = (candidates && Array.isArray(candidates.sevkYeri)) ? candidates.sevkYeri : [];

    // ✅ Son kullanılan (YD/Firma) değerlerini aday listesine EKLE,
    // ama mevcut header'dan gelen adaylar varsa otomatik override ETME.
    const origAmbLen = ambC.length;
    const origSevLen = sevC.length;
    try {
      const key = normalizeYdKey(ydKey || chosen?.ydKey || chosen?.firma || '');
      if (key) {
        if (!window.__quickDefaultsByKey) window.__quickDefaultsByKey = {};
        const d = window.__quickDefaultsByKey[key];
        if (d) {
          const da = String(d.ambalaj || '').trim();
          const ds = String(d.sevkYeri || '').trim();
          if (ds && !sevC.map(x=>String(x||'').toUpperCase()).includes(ds.toUpperCase())) sevC.unshift(ds);
          if (da && !ambC.map(x=>String(x||'').toUpperCase()).includes(da.toUpperCase())) ambC.unshift(da);

          // Eğer header'dan HİÇ aday yoksa (yani sadece kullanıcı hafızası var),
          // inputlar boşken otomatik doldur.
          if (origSevLen === 0) {
            const sevInp = card.querySelector('#xr_sevkYeri');
            if (sevInp && !String(sevInp.value||'').trim() && ds) sevInp.value = ds;
          }
          if (origAmbLen === 0) {
            const ambInp = card.querySelector('#xr_ambalaj');
            if (ambInp && !String(ambInp.value||'').trim() && da) ambInp.value = da;
          }
        }
      }
    } catch(e) {}


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

  const close = () => closeShipmentSelectUI();
  document.getElementById('shipmentSelectCloseBtn')?.addEventListener('click', close);

  document.getElementById('shipPickAll')?.addEventListener('click', () => {
    overlay.querySelectorAll('input.shipPick').forEach(ch => ch.checked = true);
  });
  document.getElementById('shipClearAll')?.addEventListener('click', () => {
    overlay.querySelectorAll('input.shipPick').forEach(ch => ch.checked = false);
  });

  document.getElementById('shipConfirm')?.addEventListener('click', () => {
    const picks = Array.from(overlay.querySelectorAll('input.shipPick'))
      .filter(ch => ch.checked)
      .map(ch => ch.getAttribute('data-id'));

    if (!picks.length) { alert('Önce en az 1 sevkiyat seçmelisin.'); return; }

    window.__selectedShipmentBlocks = blocks.filter(b => picks.includes(b.id));
    close();
    if (window.ExcelIhracatImport && typeof window.ExcelIhracatImport.importSelectedBlocks === 'function') {
      window.ExcelIhracatImport.importSelectedBlocks();
    } else {
      showToast(`✅ ${window.__selectedShipmentBlocks.length} sevkiyat bloğu seçildi.`);
    }
  });
}

// Excel oku -> blokları çıkar -> seçim ekranını göster (import yapmaz)
async function importExcelHeadersOnly_ShowSelection(file){
  if (!file) return { ok:false, msg:'Dosya seçilmedi.' };
  try {
    if (typeof window.ensureXlsxLoaded === 'function') await window.ensureXlsxLoaded();
  } catch (e) {
    return { ok:false, msg:'XLSX kütüphanesi yüklenemedi. İnternet bağlantınızı kontrol edin.' };
  }
  if (typeof XLSX === 'undefined') return { ok:false, msg:'XLSX kütüphanesi yüklenemedi. (xlsx.full.min.js)' };

  const data = await file.arrayBuffer();
  const wb = XLSX.read(data, { type: 'array' });
  let sheetName = wb.SheetNames && wb.SheetNames[0];
  if (window.ExcelIhracatImport && wb.SheetNames && wb.SheetNames.length > 1) {
    const picked = await window.ExcelIhracatImport.pickIhracatSheet(wb);
    if (!picked) return { ok: false, msg: 'Sayfa seçilmedi.', blocks: [] };
    sheetName = picked;
  }
  const ws = wb.Sheets[sheetName];
  // blankrows: true — parseIhracatRowsFromWorkbook ile aynı (satır indeksleri seçim = import)
  const grid = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, blankrows: true });

  const blocks = parseShipmentBlocksFromGrid(grid);

  window.__ihracatImportContext = { wb, sheetName, fileName: file.name, grid, ws, file };

  if (!blocks.length) {
    showShipmentSelectUI([], file.name);
    return { ok: false, msg: 'Başlık bulunamadı (LOT NO / YDxxx).', blocks: [] };
  }

  showShipmentSelectUI(blocks, file.name);
  return { ok: true, msg: `✅ Başlıklar bulundu: ${blocks.length} sevkiyat`, blocks };
}


// Takip formu açılınca plaka ile excel satırını uygula

/** Aynı plakaya ait birden fazla Excel sevkiyat kaydı — kurumsal seçim penceresi */
function openShipmentPickForSamePlate(plate, hits, onPick, onDismiss) {
  try {
    const overlayId = 'shipmentPickOverlay';
    const old = document.getElementById(overlayId);
    if (old) old.remove();

    const overlay = document.createElement('div');
    overlay.id = overlayId;
    overlay.style.cssText = [
      'position:fixed', 'inset:0', 'z-index:1000006', 'background:rgba(0,0,0,.25)',
      'display:flex', 'align-items:flex-start', 'justify-content:center', 'padding:16px'
    ].join(';') + ';';

    const card = document.createElement('div');
    card.style.cssText = [
      'width:min(680px, 96vw)', 'margin-top:8vh', 'background:#fff', 'border:1px solid #e5e7eb',
      'border-radius:12px', 'box-shadow:0 10px 30px rgba(0,0,0,.22)', 'overflow:hidden'
    ].join(';') + ';';

    const header = document.createElement('div');
    header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:12px 14px;border-bottom:1px solid #e5e7eb;background:#f8fafc;';
    header.innerHTML = `
      <div style="min-width:0;">
        <strong style="font-size:14px;color:#0f172a;">${escapeHtml(plate)} — sevkiyat seçimi</strong>
        <div style="font-size:12px;color:#64748b;margin-top:4px;">Bu plakaya ait <b>${(hits || []).length}</b> kayıt bulundu. Doğru sevkiyatı seçin.</div>
      </div>`;

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.textContent = '✕';
    closeBtn.title = 'İlk kaydı kullan';
    closeBtn.style.cssText = 'border:none;background:transparent;font-size:16px;cursor:pointer;opacity:.75;padding:4px 8px;';
    closeBtn.onmouseenter = () => { closeBtn.style.opacity = '1'; };
    closeBtn.onmouseleave = () => { closeBtn.style.opacity = '.75'; };
    header.appendChild(closeBtn);

    const list = document.createElement('div');
    list.style.cssText = 'max-height:55vh;overflow:auto;';

    const rows = (hits || []).map((h, i) => {
      const ton = h.tonajKg != null && String(h.tonajKg).trim() !== '' ? String(h.tonajKg).trim() : '-';
      const fir = String(h.firma || h.ydKey || '').trim() || '-';
      const mal = String(h.malzeme || '').trim() || '-';
      const dosya = String(h.fileName || h.id || '').trim();
      const dosyaHtml = dosya ? `<span style="color:#94a3b8;font-size:11px;">${escapeHtml(dosya)}</span>` : '';
      return `
        <button type="button" data-idx="${i}"
          style="width:100%;text-align:left;padding:12px 14px;border:none;background:transparent;cursor:pointer;border-bottom:1px solid #f3f4f6;">
          <div style="display:flex;justify-content:space-between;gap:12px;align-items:center;">
            <div style="display:flex;flex-direction:column;gap:4px;min-width:0;flex:1;">
              <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                <span style="background:#e0e7ff;color:#3730a3;border-radius:8px;padding:2px 8px;font-size:11px;font-weight:800;">${i + 1}</span>
                <strong style="font-size:13px;color:#0f172a;">Tonaj: ${escapeHtml(ton)} kg</strong>
              </div>
              <span style="color:#334155;font-size:12px;">Firma: ${escapeHtml(fir)}</span>
              <span style="color:#64748b;font-size:12px;">Malzeme: ${escapeHtml(mal)}</span>
              ${dosyaHtml}
            </div>
            <span style="flex-shrink:0;background:#111827;color:#fff;border-radius:10px;padding:8px 14px;font-weight:800;font-size:12px;">SEÇ</span>
          </div>
        </button>`;
    }).join('');

    list.innerHTML = rows || `<div style="padding:12px;color:#6b7280;">Kayıt bulunamadı</div>`;

    const footer = document.createElement('div');
    footer.style.cssText = 'padding:10px 14px;border-top:1px solid #e5e7eb;background:#f8fafc;font-size:11px;color:#64748b;';
    footer.textContent = 'Kapatırsanız ilk kayıt kullanılır.';

    const finish = (chosen, dismissed) => {
      overlay.remove();
      if (dismissed) {
        try { onDismiss && onDismiss(); } catch (_) {}
      } else {
        try { onPick && onPick(chosen); } catch (_) {}
      }
    };

    closeBtn.onclick = () => finish((hits || [])[0], true);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) finish((hits || [])[0], true);
    });

    list.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-idx]');
      if (!btn) return;
      const idx = parseInt(btn.getAttribute('data-idx'), 10);
      const chosen = (hits || [])[idx];
      if (chosen) finish(chosen, false);
    });

    card.appendChild(header);
    card.appendChild(list);
    card.appendChild(footer);
    overlay.appendChild(card);
    document.body.appendChild(overlay);
  } catch (e) {
    try { onPick && onPick((hits || [])[0] || null); } catch (_) {}
  }
}

function pickShipmentFromHits(plate, hits) {
  return new Promise((resolve) => {
    const list = Array.isArray(hits) ? hits : [];
    if (!list.length) { resolve(null); return; }
    if (list.length === 1) { resolve(list[0]); return; }
    openShipmentPickForSamePlate(
      plate,
      list,
      (chosen) => resolve(chosen || list[0]),
      () => resolve(list[0])
    );
  });
}

function sanitizeYuklemeNotuLines(lines) {
  const out = [];
  const seen = new Set();
  for (const line of lines || []) {
    const s = String(line || '').trim();
    if (!s) continue;
    if (/^\d{1,2}$/.test(s)) continue;
    const key = s.replace(/\s+/g, ' ').toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

/** Seçilen Excel satırının tonaj, irsaliye ve blok uyarı notunu takip formuna yazar */
function applyShipmentTonajAndIrsaliye(chosen) {
  if (!chosen) return;
  try {
    const tonajEl = document.getElementById('tonaj');
    const t = chosen.tonajKg != null ? String(chosen.tonajKg).trim() : '';
    if (tonajEl && t) tonajEl.value = t;

    const notuEl = document.getElementById('yuklemeNotu');
    if (!notuEl) return;

    const parts = [];
    const irs = getShipmentIrsaliyeNo(chosen);
    if (irs) parts.push('İrsaliye No: ' + irs);

    const blockNote = getIhracatBlockFooterNote(chosen);
    if (blockNote) {
      blockNote.split(/\r?\n/).forEach((ln) => {
        const s = String(ln || '').trim();
        if (s) parts.push(s);
      });
    }

    const rowNote = String(chosen.yuklemeNotu || '').trim();
    if (
      rowNote &&
      rowNote !== blockNote &&
      !rowNote.includes(blockNote) &&
      !(blockNote && blockNote.includes(rowNote))
    ) {
      const irsPrefix = irs ? 'İrsaliye No: ' + irs : '';
      rowNote.split(/\r?\n/).forEach((ln) => {
        const s = String(ln || '').trim();
        if (!s) return;
        if (irsPrefix && s === irsPrefix) return;
        parts.push(s);
      });
    }

    const merged = sanitizeYuklemeNotuLines(parts);
    if (!merged.length) return;
    notuEl.value = merged.join('\n');
  } catch (e) {}
}

// ✅ Araç varsayılanlarını takip formuna uygula (Excel'e / kullanıcı girdisine dokunmaz)
// - Sadece ilgili alan BOŞSA doldurur.
// - Excel import varsa applyShipmentToTakipForm zaten doldurur; burada tekrar ezmeyiz.
function applyVehicleDefaultsToTakipForm(vehicle) {
  try {
    if (!vehicle) return;

    const firmaKodu = document.getElementById('firmaKodu');
    const firmaSelect = document.getElementById('firmaSelect');
    const malzeme = document.getElementById('malzeme');
    const malzemeSelect = document.getElementById('malzemeSelect');
    const sevkYeri = document.getElementById('sevkYeri');
    const yuklemeNotu = document.getElementById('yuklemeNotu');

    const df = String(vehicle.defaultFirma || '').trim();
    const dm = String(vehicle.defaultMalzeme || '').trim();
    const ds = String(vehicle.defaultSevkYeri || '').trim();
    const dn = String(vehicle.defaultYuklemeNotu || '').trim();
    const dbbt = String(vehicle.defaultBbtSayisi || '').trim();

    console.log('🔍 applyVehicleDefaults - vehicle:', vehicle);
    console.log('🔍 Değerler:', { df, dm, ds, dn, dbbt });

    // Firma - INPUT (önce input'u doldur)
    if (firmaKodu && !String(firmaKodu.value || '').trim() && df) {
      firmaKodu.value = df;
      console.log('✅ Firma input dolduruldu:', df);
    }
    
    // Firma - SELECT
    if (firmaSelect && !String(firmaSelect.value || '').trim() && df) {
      try {
        firmaSelect.value = df;
        console.log('✅ Firma select set edildi:', df, '-> sonuç:', firmaSelect.value);
      } catch (e) {
        console.error('❌ Firma select hatası:', e);
      }
    }

    // Malzeme - INPUT (önce input'u doldur)
    if (malzeme && !String(malzeme.value || '').trim() && dm) {
      malzeme.value = dm;
      console.log('✅ Malzeme input dolduruldu:', dm);
    }
    
    // Malzeme - SELECT
    if (malzemeSelect && !String(malzemeSelect.value || '').trim() && dm) {
      try {
        const opt = Array.from(malzemeSelect.options || []).find(o => String(o.value||'').trim() === dm);
        if (opt) {
          malzemeSelect.value = dm;
          console.log('✅ Malzeme select dolduruldu:', dm);
        } else {
          console.warn('⚠️ Malzeme dropdown\'da bulunamadı:', dm);
        }
      } catch (e) {
        console.error('❌ Malzeme select hatası:', e);
      }
    }

    // Sevk yeri
    if (sevkYeri && !String(sevkYeri.value || '').trim() && ds) {
      sevkYeri.value = ds;
      console.log('✅ Sevk yeri dolduruldu:', ds);
    }

    // Yükleme notu
    if (yuklemeNotu && !String(yuklemeNotu.value || '').trim() && dn) {
      yuklemeNotu.value = dn;
      console.log('✅ Yükleme notu dolduruldu:', dn);
    }
  } catch(e) {
    console.error('applyVehicleDefaultsToTakipForm hata:', e);
  }
}

async function applyShipmentToTakipForm(vehicle, opts) {
  opts = opts || {};
  try {
    const plateNeedle = normPlate(vehicle?.cekiciPlaka || '');
    if (!plateNeedle) return;

    let chosen;
    if (opts.prefilledShipment) {
      chosen = { ...opts.prefilledShipment, plaka: plateNeedle };
    } else {
      // ✅ Hız: plaka->kayıt index (DailyStore) varsa onu kullan
      let hits = [];
      try {
        if (window.DailyStore && typeof DailyStore.findByPlate === 'function') {
          hits = DailyStore.findByPlate(plateNeedle) || [];
        } else {
          const list = loadDailyShipments();
          if (!list.length) return;
          hits = list.filter((x) => x.plaka === plateNeedle);
        }
      } catch (e) {
        const list = loadDailyShipments();
        if (!list.length) return;
        hits = list.filter((x) => x.plaka === plateNeedle);
      }
      if (!hits.length) return;

      chosen = hits[0];
      if (hits.length > 1) {
        const picked = await pickShipmentFromHits(plateNeedle, hits);
        if (picked) chosen = picked;
      }
    }

    // ✅ Firma bazlı override (örn: Liman/Sevk Yeri düzeltmesi)
    chosen = applyFirmaOverridesToShipment(chosen);

    // ✅ Seçilen kaydın tonajı (çoklu sevkiyatta 2. kayıt için doğru değer)
    applyShipmentTonajAndIrsaliye(chosen);
    try {
      window.__activeExcelShipment = chosen;
      window.__lastChosenShipment = chosen;
    } catch (e) {}

    try {
      if (window.piyasa && typeof window.piyasa.suggestForContext === 'function') {
        const sug = window.piyasa.suggestForContext({
          plate: plateNeedle,
          firma: chosen.firma || chosen.ydKey,
          malzeme: chosen.malzeme,
          sevkYeri: chosen.sevkYeri,
        });
        if (sug.length && typeof window.piyasa.showSuggestionBar === 'function') {
          window.piyasa.showSuggestionBar(sug, { plate: plateNeedle });
        }
      }
    } catch (e) {}

    _applyExcelShipmentFieldsToTakipForm(chosen);

    const sevkFilled = String(chosen.sevkYeri || _defaultSevkForShipment(chosen)).trim();
    const ambFilled =
      String(chosen.ambalaj || chosen.ambalajBilgisi || '').trim() ||
      String(chosen.bbt || '').trim() ||
      String(chosen.cuval || '').trim() ||
      String(chosen.palet || '').trim();

    if (opts.skipExcelReview || (chosen._ihracatEdited && sevkFilled && ambFilled)) {
      return;
    }

    openExcelReviewUI({
      plate: plateNeedle,
      chosen,
      ydKey: chosen?.ydKey || chosen?.firma || '',
      candidates: {
        ambalaj: getAmbalajCandidates(chosen?.headerText || ''),
        sevkYeri: getLimanCandidates(chosen?.headerText || '')
      },
      onApply: (fixed) => {
        const firmaKodu = document.getElementById('firmaKodu');
        const malzeme = document.getElementById('malzeme');
        const malzemeSelect = document.getElementById('malzemeSelect');
        const sevkYeri = document.getElementById('sevkYeri');
        const ambalajBilgisi = document.getElementById('ambalajBilgisi');

        const bbt = document.getElementById('bbt');
        const cuval = document.getElementById('cuval');
        const palet = document.getElementById('palet');
        const bosBbt = document.getElementById('bosBbt');
        const bosCuval = document.getElementById('bosCuval');

        if (firmaKodu) firmaKodu.value = fixed.firma || '';
        if (malzeme) malzeme.value = fixed.malzeme || '';
        if (malzemeSelect) malzemeSelect.value = fixed.malzeme || '';
        if (sevkYeri) sevkYeri.value = fixed.sevkYeri || '';
        if (ambalajBilgisi) ambalajBilgisi.value = fixed.ambalaj || '';
        const yuklemeNotu = document.getElementById('yuklemeNotu');
        if (yuklemeNotu && typeof fixed.yuklemeNotu !== 'undefined') {
          yuklemeNotu.value = fixed.yuklemeNotu || '';
        }

        // ✅ Bu Excel oturumunda aynı firmaya (YDxx) hızlı varsayılan kaydı:
        // Bir kez girildi mi, sonraki plakalarda otomatik dolsun.
        try {
          if (!window.__firmaQuickDefaults) window.__firmaQuickDefaults = {};
          const fKey = _firmaKey(fixed.firma);
          if (fKey) {
            const amb = String(fixed.ambalaj || '').trim();
            const svk = String(fixed.sevkYeri || '').trim();
            // Boşları kaydetme; önceki dolu değer varsa koru
            const prev = window.__firmaQuickDefaults[fKey] || {};
            window.__firmaQuickDefaults[fKey] = {
              ambalaj: amb || prev.ambalaj || '',
              sevkYeri: svk || prev.sevkYeri || ''
            };
          }
        } catch(e) {}

        if (bbt) bbt.value = fixed.bbt || '';
        if (palet) palet.value = fixed.palet || '';
        if (bosBbt) bosBbt.value = fixed.bosBbt || '';

        const tonajEl = document.getElementById('tonaj');
        if (tonajEl && typeof fixed.tonaj !== 'undefined') tonajEl.value = fixed.tonaj || '';

        if (fixed.irsaliyeNo) applyShipmentTonajAndIrsaliye({ irsaliyeNo: fixed.irsaliyeNo });

        // ✅ Çuval özel mantık: 0 gelirse boş çuvalı çuval gibi göster (mevcut davranış korunur)
        if (cuval) {
          const cv = Number(fixed.cuval || 0);
          const bcv = Number(fixed.bosCuval || 0);
          if (cv > 0) {
            cuval.value = String(fixed.cuval);
            if (bosCuval) bosCuval.value = (bcv > 0 ? String(fixed.bosCuval) : '');
          } else if (bcv > 0) {
            cuval.value = String(fixed.bosCuval);
            if (bosCuval) bosCuval.value = '';
          } else {
            cuval.value = '';
            if (bosCuval) bosCuval.value = '';
          }
        }
        // ✅ Excel düzeltmesinden sonra: firma+malzeme eşleştirmesini güncelle (ambalaj/sevk)
        try {
          const f = _firmaKey(fixed.firma);
          const m = (fixed.malzeme || '').trim();
          if (f && m) {
            const existing = eslestirmeListesi.find(es => es.firma === f && es.malzeme === m);
            if (existing && existing.id) {
              eslestirmeStorage.update(existing.id, {
                ambalajBilgisi: (fixed.ambalaj || '').trim(),
                sevkYeri: (fixed.sevkYeri || '').trim()
              });
            } else {
              eslestirmeStorage.add(f, m, (fixed.ambalaj || '').trim(), '', (fixed.sevkYeri || '').trim());
            }
          }
        } catch(e){}

        // ✅ Aynı Excel oturumunda hızlı doldurma (firma/YD bazlı)
        // Kullanıcı bir kez ambalaj/sevk yeri girdiyse, aynı firmaya ait sonraki plakalarda otomatik gelsin.
        try {
          const f = _firmaKey(fixed.firma);
          const a = (fixed.ambalaj || '').trim();
          const s = (fixed.sevkYeri || '').trim();
          if (f && (a || s)) {
            const key = normalizeYdKey(fixed.ydKey || chosen?.ydKey || fixed.firma || chosen?.firma || '');
            if (!window.__quickDefaultsByKey) window.__quickDefaultsByKey = {};
            if (key && (a || s)) {
              window.__quickDefaultsByKey[key] = {
                ambalaj: a || (window.__quickDefaultsByKey[key]?.ambalaj || ''),
                sevkYeri: s || (window.__quickDefaultsByKey[key]?.sevkYeri || '')
              };
            }
          }
        } catch(e){}

      }
    });

  } catch(e) {
    console.error('applyShipmentToTakipForm hata:', e);
  }
}






// 🛡️ Sessiz koruma: hata olursa uygulama çökmesin (login'i etkilemez)
function showUiWarning(message) {
    try {
        let bar = document.getElementById('uiWarningBar');
        if (!bar) {
            bar = document.createElement('div');
            bar.id = 'uiWarningBar';
            bar.className = 'ui-warning hidden';
            bar.innerHTML = `
                <div class="ui-warning__content">
                    <span id="uiWarningText"></span>
                    <button id="uiWarningClose" class="ui-warning__close" title="Kapat">✖</button>
                </div>
            `;
            document.body.appendChild(bar);
            document.getElementById('uiWarningClose')?.addEventListener('click', () => {
                bar.classList.add('hidden');
            });
        }
        const t = document.getElementById('uiWarningText');
        if (t) t.textContent = String(message || 'Bir hata oluştu.');
        bar.classList.remove('hidden');
    } catch (e) {
        console.error('showUiWarning hata:', e);
    }
}

window.addEventListener('error', (e) => {
  console.error('JS ERROR:', e?.error || e?.message || e);
  logClientError('error', e?.error || e?.message || e);
  logClientError('promise', e?.reason || e);
  // UI warning suppressed to avoid bottom-bar notices; still logged to console/localStorage
});


// ✅ Görünmez otomatik günlük yedek (indirirmez, localStorage'a snapshot alır)
function autoDailySnapshot() {
  try {
    const today = new Date();
    const y = today.getFullYear();
    const m = String(today.getMonth()+1).padStart(2,'0');
    const d = String(today.getDate()).padStart(2,'0');
    const key = `auto_backup_${y}-${m}-${d}`;

    if (localStorage.getItem(key)) return; // bugün alındı

    const snap = {
      ts: new Date().toISOString(),
      vehicles: (window.storage && window.storage.loadAll) ? window.storage.loadAll() : []
    };
    localStorage.setItem(key, JSON.stringify(snap));

    // son 7 günü tut, eskileri temizle
    const keys = [];
    for (let i=0;i<localStorage.length;i++){
      const k = localStorage.key(i);
      if (k && k.startsWith('auto_backup_')) keys.push(k);
    }
    keys.sort().reverse();
    keys.slice(7).forEach(k => localStorage.removeItem(k));
  } catch (e) {}
}

// ✅ Sessiz hata günlüğü (en fazla 120 kayıt)
function logClientError(type, payload) {
  try {
    const key = 'client_error_log';
    const arr = JSON.parse(localStorage.getItem(key) || '[]');
    const item = { ts: new Date().toISOString(), type, payload: String(payload || '') };
    arr.unshift(item);
    localStorage.setItem(key, JSON.stringify(arr.slice(0, 120)));
  } catch (e) {}
}

window.addEventListener('unhandledrejection', (e) => {
  console.error('PROMISE ERROR:', e?.reason || e);
  logClientError('error', e?.error || e?.message || e);
  // UI warning suppressed to avoid bottom-bar notices; still logged to console/localStorage
});
        // TÜM VERİLERİ DIŞA AKTAR - YENİ
        function exportFullBackup() {
  try {
    const storageDump = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k) continue;
      // 🔗 Eşleştirme kaldırıldı: yedeğe dahil etme
      if (/eslestirme/i.test(k) || k === 'eslestirmeListesi') continue;
      // ❌ Firma/Malzeme/Sevk hafızaları: yedeğe dahil etme
      if (DISABLED_STORAGE_KEYS && DISABLED_STORAGE_KEYS.includes(k)) continue;
      storageDump[k] = localStorage.getItem(k);
}

    const allData = {
      __type: "V8_FULL_BACKUP",
      exportTarihi: new Date().toLocaleString('tr-TR'),
      storageDump
    };

    const dataStr = JSON.stringify(allData, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);

    const link = document.createElement('a');
    link.href = url;
    link.download = `V8_TAM_YEDEK_${new Date().toISOString().slice(0,19).replace(/[:T]/g,'-')}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  } catch (e) {
    console.error(e);
    alert('❌ Yedek alınırken hata oluştu!');
  }
}

// Eski kısmi yedek (geriye dönük uyumluluk için)
function exportAllDataLegacy() {
  const allData = {
    vehicles: storage.loadAll(),
    // ❌ firmalar/malzemeler/export kaldırıldı

    driverIssuesByPlate: loadIssuesMap(),
    dailyShipmentsCurrent: (() => { try { return JSON.parse(localStorage.getItem(DAILY_SHIPMENT_KEY) || 'null'); } catch(e){ return null; } })(),
    yuklemeSirasiCounter: localStorage.getItem('yuklemeSirasiCounter'),
    yuklemeSirasiDate: localStorage.getItem('yuklemeSirasiDate'),
    deletionLog: (() => { try { return JSON.parse(localStorage.getItem('deletionLog') || '[]'); } catch(e){ return []; } })(),
    exportTarihi: new Date().toLocaleString('tr-TR')
  };

  const dataStr = JSON.stringify(allData, null, 2);
  const dataBlob = new Blob([dataStr], {type: 'application/json'});
  const url = URL.createObjectURL(dataBlob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `V8_YEDEK_${new Date().toISOString().slice(0,19).replace(/[:T]/g,'-')}.json`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function exportAllData(){ return exportAllDataLegacy(); }


        // TÜM VERİLERİ İÇE AKTAR - YENİ
        function importAllData(jsonData) {
            try {
                const allData = JSON.parse(jsonData);

                // ✅ TAM YEDEK (tüm localStorage dump) içe aktarma
                if (allData && allData.storageDump && typeof allData.storageDump === 'object') {
                    try {
                        // send full storageDump to server to persist into SQLite
                        fetch('/api/restore-full', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(allData)
                        }).then(resp => resp.json()).then(result => {
                          try { console.log('restore-full result', result); } catch(e){}
                          // reload app state from server by forcing storage to re-fetch
                          try {
                            if (window.storage && typeof window.storage._readAll === 'function') {
                              window.storage._readAll().then(()=>{
                                try { loadVehicles(); } catch(e){}
                                try { loadFirmalar(); } catch(e){}
                                try { loadEslestirmeler(); } catch(e){}
                                try { loadMalzemeler(); } catch(e){}
                                try { purgeDisabledKeys(); } catch(e){}
                              }).catch(()=>{
                                try { loadVehicles(); } catch(e){}
                              });
                            } else {
                              try { loadVehicles(); } catch(e){}
                            }
                          } catch(e) { try { loadVehicles(); } catch(e){} }
                        }).catch(e => {
                          console.error('Restore failed', e);
                        });
                        return { __fullRestore: true };
                    } catch(e) {
                        return false;
                    }
                }

let sonuc = {
                    araclar: { added: 0, duplicate: 0 },
                    firmalar: { added: 0, duplicate: 0 },
                    eslestirmeler: { added: 0, duplicate: 0 },
                    malzemeler: { added: 0, duplicate: 0 }
                };
                // Araçları içe aktar
                // ✅ Artık plaka benzersiz değil: aynı plaka birden fazla kayıt olabilir.
                // Bu yüzden sadece ID bazlı çakışma kontrolü yapılır.
                if (allData.vehicles) {
                    allData.vehicles.forEach(vehicle => {
                        const key = `vehicle_${vehicle.id}`;
                        if (!localStorage.getItem(key)) {
                            storage.save(key, vehicle);
                            sonuc.araclar.added++;
                        } else {
                            sonuc.araclar.duplicate++;
                        }
                    });
                }
                // ❌ Firmaları içe aktarma kaldırıldı (yedek taşınmasın)
// Eşleştirmeler kaldırıldı: içe aktarma yapılmaz, varsa da temizlenir
                try { localStorage.removeItem('eslestirmeListesi'); } catch(e) {}
        try { localStorage.removeItem('firmaOverrides_v1'); } catch(e) {}
                try { eslestirmeListesi = []; } catch(e) {}

                // Malzemeleri içe aktar
                if (allData.malzemeler) {
                    allData.malzemeler.forEach(malzeme => {
                        if (!malzemeListesi.includes(malzeme)) {
                            malzemeListesi.unshift(malzeme);
                            sonuc.malzemeler.added++;
                        } else {
                            sonuc.malzemeler.duplicate++;
                        }
                    });
                    try { localStorage.removeItem('malzemeListesi'); } catch(e) {}
}

                // ⚠️ Sorunlar / Şoför-Plaka sorun kayıtlarını içe aktar (merge)
                if (allData.driverIssuesByPlate && typeof allData.driverIssuesByPlate === 'object') {
                    const existing = loadIssuesMap();
                    let addedCount = 0;
                    Object.keys(allData.driverIssuesByPlate).forEach(k => {
                        const arr = Array.isArray(allData.driverIssuesByPlate[k]) ? allData.driverIssuesByPlate[k] : [];
                        if (!Array.isArray(existing[k])) existing[k] = [];
                        arr.forEach(it => {
                            const id = it && it.id;
                            if (id && !existing[k].some(x => x && x.id === id)) {
                                existing[k].push(it);
                                addedCount++;
                            }
                        });
                        // newest first
                        existing[k].sort((a,b) => (b?.ts||0) - (a?.ts||0));
                    });
                    saveIssuesMap(existing);
                    sonuc.sorunlar = { added: addedCount };
                } else {
                    sonuc.sorunlar = { added: 0 };
                }

                // Günlük sevkiyat / sayaç / loglar (varsa)
                if (allData.dailyShipmentsCurrent !== undefined) {
                    try { localStorage.setItem(DAILY_SHIPMENT_KEY, JSON.stringify(allData.dailyShipmentsCurrent)); } catch(e){}
                }
                if (allData.yuklemeSirasiCounter !== undefined && allData.yuklemeSirasiCounter !== null) {
                    try { localStorage.setItem('yuklemeSirasiCounter', String(allData.yuklemeSirasiCounter)); } catch(e){}
                }
                if (allData.yuklemeSirasiDate !== undefined && allData.yuklemeSirasiDate !== null) {
                    try { localStorage.setItem('yuklemeSirasiDate', String(allData.yuklemeSirasiDate)); } catch(e){}
                }
                if (allData.deletionLog) {
                    try { localStorage.setItem('deletionLog', JSON.stringify(allData.deletionLog)); } catch(e){}
                }

                return sonuc;
            } catch (e) {
                return false;
            }
        }

        // Verileri yükle (araç + şoför geçmişi tek sunucu isteğiyle)
        async function loadVehicles() {
            state.searchTerm = '';
            state.showAll = false;
            state.vehiclesLoading = true;
            try { render(); } catch (e) {}

            try {
                if (window.storage && typeof window.storage._readAll === 'function') {
                    await window.storage._readAll();
                }
                state.vehicles = storage.loadAll();
                try {
                  if (window.Report && typeof window.Report.getEvents === 'function') {
                    state.reports = window.Report.getEvents();
                  }
                } catch (e) { /* ignore */ }
                populateSoforHistoryFromVehicles(state.vehicles);
                // Telefonları otomatik formatla ve kaydet
                try {
                    let changed = false;
                    const all = state.vehicles.map(v => {
                        const old = v.iletisim || '';
                        const neu = formatTRPhone(old);
                        if (neu && neu !== old) { changed = true; return { ...v, iletisim: neu }; }
                        return v;
                    });
                    if (changed && window.storage && window.storage.save) {
                        all.forEach(v => window.storage.save('vehicle_' + v.id, v));
                        state.vehicles = all;
                    }
                } catch (e) {}

                cleanDuplicatePlates();
                firmaStorage.load();
                eslestirmeStorage.load();
                autoDailySnapshot();
            } catch (e) {
                console.error('loadVehicles hata:', e);
            }

            state.vehiclesLoading = false;
            try { render(); } catch (e) {}
            try {
                if (window.initPiyasaModule && typeof window.initPiyasaModule === 'function') {
                    window.initPiyasaModule();
                }
            } catch (e) { console.warn('Piyasa init hatası:', e); }

            try { if (typeof updateVehicleList === 'function') updateVehicleList(); } catch (e) {}
            try { _ihracatFetchRemotePrintReports(true); } catch (e) {}
        }

        // Form verilerini güncelle
        function updateFormData(field, value) {
  if (field === 'iletisim') {
    state.formData[field] = formatTRPhone(value);
    return;
  }
  state.formData[field] = value;
}

        // Kayıt ekle/güncelle
        async function saveVehicle() {
            const ui = window.rpUi || {};
            const cekiciPlaka = state.formData.cekiciPlaka.trim();
            
            if (!cekiciPlaka) {
                if (typeof ui.alert === 'function') await ui.alert('Çekici plaka zorunludur!', 'danger');
                else alert('Çekici plaka zorunludur!');
                return;
            }

            if (!isValidTC(state.formData.tcKimlik)) {
                if (typeof ui.alert === 'function') await ui.alert('TC Kimlik numarası 11 haneli olmalıdır!', 'danger');
                else alert('TC Kimlik numarası 11 haneli olmalıdır!');
                return;
            }

            if (!isValidIletisim(state.formData.iletisim)) {
                if (typeof ui.alert === 'function') await ui.alert('İletişim numarası 10 veya 11 haneli olmalıdır!', 'danger');
                else alert('İletişim numarası 10 veya 11 haneli olmalıdır!');
                return;
            }
            
            const prevVehicle = state.editingId
                ? (state.vehicles || []).find((v) => v.id === state.editingId)
                : null;
            const vehicleData = {
                id: state.editingId || Date.now().toString(),
                ...state.formData,
                kayitTarihi: state.editingId
                    ? (prevVehicle?.kayitTarihi)
                    : new Date().toLocaleString('tr-TR'),
                printCount: prevVehicle?.printCount,
                lastPrintSnapshot: prevVehicle?.lastPrintSnapshot ?? null,
            };

            // Veritabanına kaydet (asenkron)
            saveVehicleToDatabase(vehicleData);
            
            // Storage cache'e de kaydet (geçici)
            storage.save(`vehicle_${vehicleData.id}`, vehicleData);
            
            // Yeni veya düzenlenen kayıt her zaman listenin en üstüne gelsin
            // Önce aynı ID'li kaydı listeden çıkar, sonra başa ekle
            state.vehicles = (state.vehicles || []).filter(v => v.id !== vehicleData.id);
            state.vehicles.unshift(vehicleData);
            try { _ihracatRefreshOpenModalStatuses(); } catch (_) {}

            // Filtre cache'ini temizle ki yeni sıralama hemen yansısın
            try { window.__filterCache = { term: null, ver: 0, out: null }; } catch (_) {}

            // Yeni kayıttan sonra arama ve sayfalama durumunu sıfırla ki
            // eklenen/düzenlenen araç listenin en üstünde net olarak görünsün
            state.searchTerm = '';
            state.showAll = false;
            state.listLimit = 6;

            if (!state.editingId) {
                try {
                    window.__activeTakipVehicleId = String(vehicleData.id);
                    window.__activeTakipVehiclePlate = vehicleData.cekiciPlaka || '';
                    window.__activeTakipVehicle = vehicleData;
                } catch (e) {}
            }

            const wasEdit = !!state.editingId;
            if (typeof ui.alert === 'function') {
                await ui.alert(wasEdit ? 'Kayıt güncellendi!' : 'Kayıt eklendi!', 'success');
            } else {
                alert(wasEdit ? 'Kayıt güncellendi!' : 'Kayıt eklendi!');
            }
            resetForm();
            _ihracatMaybeReopenAfterVehicleSave();
        }

        // Veritabanına araç kaydetme fonksiyonu - Session olmadan çalışacak
        async function saveVehicleToDatabase(vehicleData) {
            try {
                const payload = Object.assign({}, vehicleData);
                try {
                    const uid = localStorage.getItem('currentUserId') || '';
                    if (uid) payload.editedBy = String(uid).toUpperCase();
                } catch (e) { /* ignore */ }
                const response = await fetch('/api/vehicles', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                
                if (!response.ok) {
                    const errorText = await response.text();
                    console.error('❌ Araç DB kaydetme hatası:', response.status, errorText);
                } else {
                    console.log('✅ Araç veritabanına kaydedildi:', vehicleData.cekiciPlaka);
                }
            } catch (error) {
                console.error('❌ Araç DB kaydetme hatası:', error);
            }
        }

        // Yazdırma öncesi araç kontrol fonksiyonları
        async function checkVehicleInDatabase(plate) {
            try {
                const response = await fetch('/api/vehicles/lookup?plate=' + encodeURIComponent(plate));
                if (response.ok) {
                    const vehicle = await response.json();
                    return !!vehicle;
                }
            } catch (error) {
                console.error('❌ Araç kontrol hatası:', error);
            }
            return false;
        }

        async function saveCurrentVehicleToDatabase(plate) {
            try {
                const get = (id) => (document.getElementById(id)?.value || '').trim();
                const driver = getTakipFormDriverPayload();
                let vehicleId = Date.now().toString();
                try {
                    const lookup = await fetch('/api/vehicles/lookup?plate=' + encodeURIComponent(plate));
                    if (lookup.ok) {
                        const existing = await lookup.json();
                        if (existing && existing.id) vehicleId = String(existing.id);
                    }
                } catch (e) { /* ignore */ }

                const vehicleData = {
                    id: vehicleId,
                    cekiciPlaka: plate,
                    dorsePlaka: driver.dorsePlaka || get('dorsePlakaBilgi') || '',
                    soforAdi: driver.soforAdi,
                    soforSoyadi: driver.soforSoyadi,
                    iletisim: driver.iletisim,
                    tcKimlik: driver.tcKimlik,
                    defaultFirma: '',
                    defaultMalzeme: '',
                    defaultSevkYeri: '',
                    defaultYuklemeNotu: '',
                    kayitTarihi: new Date().toLocaleString('tr-TR')
                };

                await saveVehicleToDatabase(vehicleData);
                
                // Cache'i güncelle
                const prevV = (state.vehicles || []).find((v) => String(v.id) === String(vehicleData.id));
                if (prevV) {
                    vehicleData.printCount = prevV.printCount;
                    vehicleData.lastPrintSnapshot = prevV.lastPrintSnapshot ?? null;
                }
                state.vehicles = (state.vehicles || []).filter(v => v.id !== vehicleData.id);
                state.vehicles.unshift(vehicleData);
                storage.save(`vehicle_${vehicleData.id}`, vehicleData);
                try { _ihracatRefreshOpenModalStatuses(); } catch (_) {}
                
                console.log('✅ Yazdırma öncesi araç DB\'ye kaydedildi:', plate);
            } catch (error) {
                console.error('❌ Yazdırma öncesi araç kaydetme hatası:', error);
            }
        }

        // Form'u sıfırla
        function resetForm() {
            state.formData = {
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
            };
            state.editingId = null;
            state.showForm = false;
            render();
        }

        // Arama
        function filterVehicles() {
  // ✅ Görünmez performans: basit cache
  window.__filterCache = window.__filterCache || { term: null, ver: 0, out: null };
  const currentVer = (state.vehicles && state.vehicles.length) ? state.vehicles.length : 0;
  if (window.__filterCache.term === state.searchTerm && window.__filterCache.ver === currentVer && window.__filterCache.out) {
    return window.__filterCache.out;
  }
  if (!state.searchTerm) return state.vehicles;

  const term = state.searchTerm.toLowerCase();
  // ✅ Plaka aramasında boşluk / tire farkını yok say
  // Örn: "34ABC123" yazılsa da "34 ABC 123" eşleşsin
  const termPlate = term.replace(/[\s-]+/g, '');

  // ✅ Arama iyileştirmesi: sayı içeriyorsa plaka olarak, içermiyorsa isim olarak ara
  const hasNumbers = /\d/.test(term);
  const searchInPlates = hasNumbers; // sayı varsa plaka ara
  const searchInNames = !hasNumbers || term.length < 3; // sayı yoksa veya çok kısa ise isim ara

  const out = state.vehicles.filter(vehicle => {
    let matches = false;

    // Plaka araması (sayı içeriyorsa)
    if (searchInPlates) {
      matches = matches ||
        (vehicle.cekiciPlaka || '').toLowerCase().replace(/[\s-]+/g, '').includes(termPlate) ||
        (vehicle.dorsePlaka  || '').toLowerCase().replace(/[\s-]+/g, '').includes(termPlate);
    }

    // İsim araması (sayı içermiyorsa veya kısa ise)
    if (searchInNames) {
      matches = matches ||
        (vehicle.soforAdi    || '').toLowerCase().includes(term) ||
        (vehicle.soforSoyadi || '').toLowerCase().includes(term) ||
        (vehicle.sofor2Adi   || '').toLowerCase().includes(term) ||
        (vehicle.sofor2Soyadi|| '').toLowerCase().includes(term) ||
        (vehicle.iletisim    || '').toLowerCase().includes(term) ||
        (vehicle.tcKimlik    || '').toLowerCase().includes(term);
    }

    return matches;
  });
  // ✅ Aramada: sorunlu olanları üste taşı (1 sorun bile varsa)
  try {
    // ⚡ Performans: comparator içinde getIssueCount'u tekrar tekrar çağırmak yerine
    // her plaka için sorun sayısını ve normalize edilmiş plakayı önceden hesapla.
    const meta = new Map();
    for (let i = 0; i < out.length; i++) {
      const v = out[i];
      const plaka = v.cekiciPlaka || '';
      meta.set(v, {
        normPlate: plaka.toLowerCase().replace(/[\s-]+/g,''),
        issueCnt: getIssueCount(plaka)
      });
    }
    out.sort((a,b)=>{
      const ma = meta.get(a), mb = meta.get(b);
      if (searchInPlates) {
        const aExact = ma.normPlate === termPlate ? 1 : 0;
        const bExact = mb.normPlate === termPlate ? 1 : 0;
        if (aExact !== bExact) return bExact - aExact;
      }
      if (ma.issueCnt !== mb.issueCnt) return mb.issueCnt - ma.issueCnt;
      return 0;
    });
  } catch(e){}


  window.__filterCache = { term: state.searchTerm, ver: currentVer, out };
  return out;
}

        // Veri dışa aktar - YENİ
        async function exportData() {
            closeAppToolsMenu();
            if (await confirm('✅ TAM YEDEK AL: Sistem içindeki ne var ne yok (tüm kayıtlar + ayarlar + arşivler) yedeklensin mi?')) {
                exportFullBackup();
            }
        }

        // Veri içe aktar - YENİ
        function importData() {
  closeAppToolsMenu();
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';
  input.style.display = 'none';
  document.body.appendChild(input);

  input.addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) {
      document.body.removeChild(input);
      return;
    }

    const reader = new FileReader();
    reader.onload = async (event) => {
      const result = importAllData(event.target.result);
      if (result !== false) {
        let message = '✅ VERİLER BAŞARIYLA İÇE AKTARILDI:\n\n';

        if (result && result.__fullRestore) {
          alert('✅ TAM YEDEK GERİ YÜKLENDİ!\\n\\nSayfa şimdi yenilenecek.');
          setTimeout(() => { try { location.reload(); } catch(e) {} }, 200);
          document.body.removeChild(input);
          return;
        }

        if (result.araclar.added > 0) message += `• ${result.araclar.added} araç kaydı\n`;
        if (result.firmalar.added > 0) message += `• ${result.firmalar.added} firma\n`;
        if (result.eslestirmeler.added > 0) message += `• ${result.eslestirmeler.added} eşleştirme\n`;
        if (result.malzemeler.added > 0) message += `• ${result.malzemeler.added} malzeme\n`;

        if (result.araclar.duplicate > 0) message += `\n⚠️ ${result.araclar.duplicate} araç atlandı (plaka çakışması)`;
        if (result.firmalar.duplicate > 0) message += `\n⚠️ ${result.firmalar.duplicate} firma atlandı (zaten mevcut)`;
        if (result.eslestirmeler.duplicate > 0) message += `\n⚠️ ${result.eslestirmeler.duplicate} eşleştirme atlandı (zaten mevcut)`;
        if (result.malzemeler.duplicate > 0) message += `\n⚠️ ${result.malzemeler.duplicate} malzeme atlandı (zaten mevcut)`;

        alert(message);
        loadVehicles();
      } else {
        alert('❌ Geçersiz yedek dosyası veya bozuk JSON!');
      }

      document.body.removeChild(input);
    };

    reader.onerror = () => {
      alert('❌ Dosya okunamadı!');
      document.body.removeChild(input);
    };

    reader.readAsText(file);
  }, { once: true });

  input.click();
}

        // Takip Formu Göster
        

// =============================
// Kantar / Sevkiyat saha imza eşleştirme (Ayarlar + signatures-registry)
// =============================
const LEGACY_KANTAR_SIG = {
  "BURAK KARATAŞ": "signatures/burak_karatas.png",
  "BEKİR DOĞRU": "signatures/bekir_dogru.png",
  "BATUHAN KOCABAY": "signatures/batuhan_kocabay.png",
  "BATUHAN CINAR": "signatures/batuhan_cinar.png",
  "BURAK TALAY": "signatures/burak_talay.png"
};

function resolveKantarSignatureSrc(name) {
  try {
    if (window.SignatureRegistry) {
      const src = window.SignatureRegistry.resolveSignatureSrc('kantar', name);
      if (src) return src;
    }
  } catch (e) { /* ignore */ }
  return LEGACY_KANTAR_SIG[(name || '').trim().toUpperCase()] || '';
}

function resolveSahaSignatureSrc(name) {
  try {
    if (window.SignatureRegistry) {
      return window.SignatureRegistry.resolveSignatureSrc('saha', name) || '';
    }
  } catch (e) { /* ignore */ }
  return '';
}

function applySignaturePreview(inputId, imgId, phId, resolveFn) {
  const input = document.getElementById(inputId);
  const img = document.getElementById(imgId);
  const ph = document.getElementById(phId);
  if (!input || !img || !ph) return;
  const src = resolveFn(input.value);
  if (src) {
    img.onerror = () => {
      img.style.display = 'none';
      ph.style.display = 'block';
      ph.textContent = 'İmza bulunamadı';
    };
    img.src = src;
    img.style.display = 'block';
    ph.style.display = 'none';
  } else {
    try { img.removeAttribute('src'); } catch (_) {}
    img.style.display = 'none';
    ph.style.display = 'block';
    ph.textContent = 'İmza otomatik gelecek';
  }
}

function refreshKantarSignaturePreview() {
  applySignaturePreview('imzaKantarAd', 'imzaKantarImg', 'imzaKantarPlaceholder', resolveKantarSignatureSrc);
}

function refreshSahaSignaturePreview() {
  applySignaturePreview('imzaSahaAd', 'imzaSahaImg', 'imzaSahaPlaceholder', resolveSahaSignatureSrc);
}

function getKantarPersonelNames() {
  const fromReg = (window.SignatureRegistry && window.SignatureRegistry.getNamesForRole('kantar')) || [];
  if (fromReg.length) return fromReg;
  return Object.keys(LEGACY_KANTAR_SIG);
}

function getSahaPersonelNames() {
  const fromReg = (window.SignatureRegistry && window.SignatureRegistry.getNamesForRole('saha')) || [];
  return fromReg.length ? fromReg : [];
}

function populateSignatureDatalists() {
  const namesK = getKantarPersonelNames();
  const namesS = getSahaPersonelNames();
  const dlK = document.getElementById('kantarPersonelList');
  const dlS = document.getElementById('sahaPersonelList');
  if (dlK) dlK.innerHTML = namesK.map((n) => `<option value="${String(n).replace(/"/g, '&quot;')}"></option>`).join('');
  if (dlS) dlS.innerHTML = namesS.map((n) => `<option value="${String(n).replace(/"/g, '&quot;')}"></option>`).join('');
}

try {
  window.getKantarPersonelNames = getKantarPersonelNames;
  window.getSahaPersonelNames = getSahaPersonelNames;
} catch (_) {}

// =============================
// KANTAR seçimi kalıcı olsun (kullanıcı bazlı)
// - Her login ID için ayrı saklar.
// - Kullanıcı değiştirmezse form açıldığında otomatik doldurur.
// =============================
const KANTAR_PREF_PREFIX = 'pref_kantar_default_v1_';

function getCurrentUserIdSafe() {
  try {
    return String(localStorage.getItem('currentUserId') || '').trim().toUpperCase();
  } catch (e) {
    return '';
  }
}

function getKantarPrefKey() {
  const uid = getCurrentUserIdSafe();
  return KANTAR_PREF_PREFIX + (uid || 'GLOBAL');
}

function loadSavedKantarName() {
  try {
    const key = getKantarPrefKey();
    const v1 = localStorage.getItem(key);
    if (v1 && String(v1).trim()) return String(v1).trim();
    const vG = localStorage.getItem(KANTAR_PREF_PREFIX + 'GLOBAL');
    return (vG && String(vG).trim()) ? String(vG).trim() : '';
  } catch (e) {
    return '';
  }
}

function persistKantarName(name) {
  try {
    const key = getKantarPrefKey();
    const v = String(name || '').trim();
    if (v) localStorage.setItem(key, v);
    else localStorage.removeItem(key);
  } catch (e) {}
}

// Basım yeri tercihini sakla (kullanıcı bazlı, kantar ile aynı mantık)
const BASIM_PREF_PREFIX = 'pref_basim_yeri_v1_';
function getBasimPrefKey() {
  const uid = getCurrentUserIdSafe();
  return BASIM_PREF_PREFIX + (uid || 'GLOBAL');
}
function loadSavedBasimYeri() {
  try {
    const key = getBasimPrefKey();
    const v1 = localStorage.getItem(key);
    if (v1 && String(v1).trim()) return String(v1).trim();
    const vG = localStorage.getItem(BASIM_PREF_PREFIX + 'GLOBAL');
    return (vG && String(vG).trim()) ? String(vG).trim() : '';
  } catch (e) { return ''; }
}
function persistBasimYeri(val) {
  try {
    const key = getBasimPrefKey();
    const v = String(val || '').trim();
    if (v) localStorage.setItem(key, v);
    else localStorage.removeItem(key);
  } catch (e) {}
}

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
                <input type="hidden" id="aracBosuBilgi" value="">
                <p id="aracBosuSatir" class="takip-form__arac-bos" hidden></p>

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

try {
  const firmaAraBtn = document.getElementById('firmaAraBtn');
  const malzemeAraBtn = document.getElementById('malzemeAraBtn');

  const firmaKoduEl = document.getElementById('firmaKodu');
  const malzemeEl = document.getElementById('malzeme');

  if (firmaAraBtn) addOnce(firmaAraBtn, 'click', ()=>{
    // PİYASA yüklüyse: firma seçmek yerine sipariş listesi aç
    try {
      if (window.piyasa && typeof window.piyasa.hasOrders === 'function' && window.piyasa.hasOrders()) {
        window.piyasa.openOrderPicker();
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
                'yuklemeNotu','aracBosuBilgi',
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
            try {
              const ab = document.getElementById('aracBosuSatir');
              if (ab) { ab.textContent = ''; ab.hidden = true; }
            } catch(e){}
        }

        function validateTakipForm(){
            _clearTakipFormErrors();

            const required = [
                { id:'firmaKodu', label:'Firma/Müşteri Kodu' },
                { id:'malzeme',   label:'Malzeme' },
                { id:'sevkYeri',  label:'Sevk Yeri' }
            ];

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

                              try{
                                window.Report?.addEvent('PRINT', printEv);

                                // Print history'ye ekle
                                try {
                                  const phRes = await fetch('/api/print_history', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({
                                      plaka: printEv.plaka,
                                      firma: firma,
                                      malzeme: printEv.malzeme || '',
                                      tonaj: printEv.tonaj || '',
                                      basim_yeri: printEv.basimYeri || '',
                                      sevkiyat_id: piyasaSevkiyatIdForPrint(pending),
                                      sofor: printEv.sofor || '',
                                      tarih: commitTs
                                    })
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
                                  body: JSON.stringify({
                                    plaka: printEv.plaka,
                                    firma: firma,
                                    malzeme: printEv.malzeme || '',
                                    tonaj: printEv.tonaj || '',
                                    basim_yeri: printEv.basimYeri || '',
                                    sevkiyat_id: piyasaSevkiyatIdForPrint(pending),
                                    sofor: printEv.sofor || '',
                                    tarih: commitTs
                                  })
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
        <button id="toggleFormButton" class="app-nav-btn app-nav-btn--primary">
          ${state.showForm ? 'İptal' : 'Yeni Kayıt'}
        </button>
        <button id="raporlarLinkGunluk" class="app-nav-btn" title="Günlük Raporlar">Günlük Raporlar</button>
        <button id="vardiyaNotlariButton" class="app-nav-btn app-nav-btn--danger" title="Vardiya notları — yazdır uyarıları">Vardiya Notları</button>
        <button id="issuesDashboardButton" class="app-nav-btn" title="Şoför sorun kayıtları">Sorunlar</button>
        <a href="plaka.html" class="app-nav-btn" title="Plaka ayırma">Plaka Ayırma</a>
        <details class="app-tools-menu relative">
          <summary class="app-nav-btn list-none select-none">
            Araçlar <span class="app-nav-chevron" aria-hidden="true">▾</span>
          </summary>
          <div class="app-dropdown absolute left-0 mt-2 w-56 z-50">
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
        <button id="logoutButton" class="app-nav-btn app-nav-btn--danger">Çıkış</button>
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
        }

        // Plaka formatlama fonksiyonu
// ✅ TR plaka standartlayıcı (il 2 hane + harf 1-3 + rakam 1-4)
// Örn: "03 VK8 78" -> "03 VK 878", "43 LU6 28" -> "43 LU 628", "01 BT9 68" -> "01 BT 968"
/** Araçlar ▾ menüsünü kapat (details açık kalmasın) */
function closeAppToolsMenu() {
  try {
    document.querySelectorAll('details.app-tools-menu').forEach(function (el) {
      el.open = false;
      el.removeAttribute('open');
    });
  } catch (e) {}
}
window.closeAppToolsMenu = closeAppToolsMenu;

// ✅ Sayfa mesajı (alert) yerine hızlı bildirim — uygulama teması (Piyasa / İhracat ile ortak)
function _inferToastType(message) {
  const m = String(message || '').trim();
  if (/^✅/.test(m)) return 'success';
  if (/^❌/.test(m)) return 'error';
  if (/^⚠️?/.test(m)) return 'warn';
  if (/^ℹ️?/.test(m)) return 'info';
  return 'info';
}

function _toastIconForType(type) {
  if (type === 'success') return '✅';
  if (type === 'error') return '❌';
  if (type === 'warn') return '⚠️';
  return 'ℹ️';
}

function showToast(message, msOrType, maybeMs) {
  try {
    const TOAST_TYPES = new Set(['success', 'error', 'warn', 'info']);
    let type = 'info';
    let ms = 2200;
    if (typeof msOrType === 'string' && TOAST_TYPES.has(msOrType)) {
      type = msOrType;
      ms = typeof maybeMs === 'number' ? maybeMs : 2800;
    } else {
      if (typeof msOrType === 'number') ms = msOrType;
      type = _inferToastType(message);
    }

    const raw = String(message || '').trim();
    const text = raw.replace(/^(\u2705|\u274c|\u26a0\ufe0f?|\u2139\ufe0f?)\s*/, '').trim() || raw;
    const icon = _toastIconForType(type);

    const id = 'toastBox';
    let box = document.getElementById(id);
    if (!box) {
      box = document.createElement('div');
      box.id = id;
      document.body.appendChild(box);
    }

    const item = document.createElement('div');
    item.className = `app-toast-item is-${type}`;
    item.innerHTML = `<span class="app-toast-item__icon" aria-hidden="true">${icon}</span><span class="app-toast-item__text"></span>`;
    item.querySelector('.app-toast-item__text').textContent = text;
    box.appendChild(item);

    requestAnimationFrame(() => {
      item.style.opacity = '1';
    });

    setTimeout(() => {
      item.style.opacity = '0';
      item.style.transform = 'translateY(6px)';
      item.style.transition = 'opacity 0.18s ease, transform 0.18s ease';
      setTimeout(() => item.remove(), 200);
    }, ms);
  } catch (e) {}
}
window.showToast = showToast;

function normalizeNetsisPlate(value) {
  if (!value) return '';
  return String(value).toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function normalizeNetsisPhone(value) {
  if (!value) return '';
  return String(value).replace(/[^0-9]/g, '');
}

function copyNetsisVehicleText(vehicle) {
  if (!vehicle) return '';
  const values = [
    normalizeNetsisPlate(vehicle.cekiciPlaka),
    vehicle.soforAdi || '',
    vehicle.soforSoyadi || '',
    normalizeNetsisPhone(vehicle.iletisim),
    vehicle.tcKimlik || '',
    normalizeNetsisPlate(vehicle.dorsePlaka)
  ].filter(Boolean);
  return values.join('\n');
}

function copyNetsisData(vehicle) {
  const text = copyNetsisVehicleText(vehicle);
  if (!text) { showToast('⚠️ NETSIS verisi bulunamadı.'); return; }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => {
      showToast('✅ NETSIS verileri kopyalandı.');
    }).catch(() => {
      showToast('❌ Kopyalama yapılamadı.');
    });
  } else {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.select();
    try {
      document.execCommand('copy');
      showToast('✅ NETSIS verileri kopyalandı.');
    } catch (e) {
      showToast('❌ Kopyalama yapılamadı.');
    }
    textarea.remove();
  }
}

function formatTRPlate(input) {
  if (!input) return '';
  const raw = String(input).toUpperCase().replace(/[^A-Z0-9]/g, '');

  // İlk 2 karakter il kodu olmalı (rakam)
  const il = raw.slice(0, 2);
  if (!/^\d{2}$/.test(il)) return raw;

  const rest = raw.slice(2);

  // Harfler: rest'in başından digit gelene kadar
  let letters = '';
  let digits = '';
  let i = 0;

  while (i < rest.length && /[A-Z]/.test(rest[i])) {
    letters += rest[i];
    i++;
  }

  // Geri kalanlardan sadece rakamları topla (araya yanlışlıkla harf girse bile bozmasın)
  for (; i < rest.length; i++) {
    if (/\d/.test(rest[i])) digits += rest[i];
  }

  letters = letters.slice(0, 3);
  digits = digits.slice(0, 4);

  let out = il;
  if (letters) out += ' ' + letters;
  if (digits) out += ' ' + digits;
  return out.trim();
}

function formatTRPhone(input) {
  const raw = String(input || '');
  let digits = raw.replace(/\D/g, '');
  if (!digits) return '';

  // 10 haneli girildiyse başına 0 ekle
  if (digits.length === 10) digits = '0' + digits;

  // 11 haneden fazlaysa son 11'i al (yanlış yapıştırma durumları)
  if (digits.length > 11) digits = digits.slice(-11);

  if (digits.length < 11) return digits;

  const p1 = digits.slice(0,4);
  const p2 = digits.slice(4,7);
  const p3 = digits.slice(7,9);
  const p4 = digits.slice(9,11);
  return `${p1} ${p2} ${p3} ${p4}`;
}


function formatPlaka(plaka) {
  return formatTRPlate(plaka);
}

// Input alanı için plaka formatlama
function formatPlakaInput(input) {
  if (!input) return;
  let value = input.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  
  if (value.length >= 2) {
    let first = value.substring(0, 2);
    let rest = value.substring(2);
    
    // Harf ve rakam kısmını ayır
    let letters = '';
    let numbers = '';
    for (let i = 0; i < rest.length; i++) {
      if (isNaN(rest[i])) {
        letters += rest[i];
      } else {
        numbers = rest.substring(i);
        break;
      }
    }
    
    if (letters && numbers) {
      input.value = first + ' ' + letters + ' ' + numbers;
    } else if (letters) {
      input.value = first + ' ' + letters;
    } else {
      input.value = first;
    }
  } else {
    input.value = value;
  }
}

// NETSIS — şoför kartı butonu (sadece logo)
const NETSIS_ICON_SRC = 'https://www.evoset.com.tr/wp-content/uploads/2024/11/netsis.png';

const WHATSAPP_ICON_SRC = 'https://upload.wikimedia.org/wikipedia/commons/6/6b/WhatsApp.svg';
const WHATSAPP_WINDOW_NAME = 'whatsapp_chat';

let _whatsappWin = null;

function toWhatsAppPhone(input) {
  try {
    let d = String(input || '').replace(/\D/g, '');
    if (!d) return '';
    if (d.length === 10 && d[0] !== '0') d = '90' + d;
    if (d.length === 10 && d[0] === '0') d = '90' + d.slice(1);
    if (d.length === 11 && d.startsWith('0')) d = '9' + d;
    return d;
  } catch (e) { return ''; }
}

function buildWhatsAppWebUrl(phone, text) {
  const p = toWhatsAppPhone(phone);
  if (!p) return '';
  const q = text ? ('&text=' + encodeURIComponent(String(text))) : '';
  return 'https://web.whatsapp.com/send/?phone=' + p + q;
}

function copyTextToClipboard(text) {
  return new Promise(function (resolve) {
    const s = String(text || '');
    if (!s) { resolve(false); return; }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(s).then(function () { resolve(true); }).catch(function () {
        resolve(_fallbackCopyText(s));
      });
      return;
    }
    resolve(_fallbackCopyText(s));
  });
}

function _fallbackCopyText(text) {
  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(textarea);
    return ok;
  } catch (e) { return false; }
}

function _syncWhatsAppWinRef() {
  if (_whatsappWin && _whatsappWin.closed) _whatsappWin = null;
}

function _navigateWhatsAppWin(sendUrl) {
  if (!_whatsappWin || _whatsappWin.closed) return false;
  try {
    _whatsappWin.focus();
    _whatsappWin.location.replace(sendUrl);
    return true;
  } catch (_) {
    return false;
  }
}

/** WhatsApp Web — giriş yapılmış sekmede sohbet aç (yeni sekmede /send takılmasın). */
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

        // Event listener'ları ekle
        function attachEventListeners() {
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
                let okDel = false;
                if (typeof ui.confirm === 'function') {
                    okDel = await ui.confirm('İHRACAT Excel verisi silinecek.\n\nDevam edilsin mi?', { okLabel: 'Sil' });
                  } else {
                    okDel = await confirm('İHRACAT Excel verisi silinecek.\n\nDevam edilsin mi?');
                  }
                if (!okDel) return;

                const snapshot = {
                    rows: JSON.parse(JSON.stringify(loadDailyShipments() || [])),
                    meta: JSON.parse(JSON.stringify(loadDailyMeta() || {}))
                };
                const r = await clearDailyShipments();
                if (!r) {
                    if (typeof ui.alert === 'function') await ui.alert('Silinemedi.', 'danger');
                    else showToast('Silinemedi.');
                    return;
                }
                try { if (typeof purgeStrictExcelCaches === 'function') purgeStrictExcelCaches(); } catch(e) {}
                try { if (typeof rebuildListsFromExcelRows === 'function') rebuildListsFromExcelRows([]); } catch(e) {}
                try { window.refreshHeaderExcelInfo && window.refreshHeaderExcelInfo(); } catch(e) {}
                try { render(); } catch(e) {}

                let choice = 'ok';
                if (typeof ui.alertDeleteSuccess === 'function') {
                    choice = await ui.alertDeleteSuccess({
                        message: 'İHRACAT Excel verisi silindi.',
                        withUndo: true
                    });
                } else {
                    showToast('Günlük Excel verisi silindi.');
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
                                        return { ...v, [field]: formatTRPlate(value) };
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
                  } else {
                    showToast('❌ Piyasa modal fonksiyonu bulunamadı.');
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

// Input için plaka formatlama fonksiyonu// Input için plaka formatlama fonksiyonu
function formatPlakaForInput(plaka) {
  return formatTRPlate(plaka);
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
    isLoggedIn = true;
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
    try { enterAppWithDelay(0); } catch(e) { try { if (typeof loadVehicles === 'function') loadVehicles(); } catch(e){} }

  } catch (e) {
    // Loading overlay removed
    if (loginError) { loginError.textContent = 'Giriş sırasında hata oluştu'; loginError.classList.remove('hidden'); }
  }
}

// Validate stored token with server; if invalid, clear auth and show login
async function validateToken() {
  // Validate server-side session via /api/me (cookie based)
  try {
    const resp = await fetch('/api/me', { method: 'GET' });
    if (resp.ok) {
      const j = await resp.json().catch(()=>null);
      isLoggedIn = true;
      state.vehiclesLoading = true;
      try { localStorage.setItem('isLoggedIn', 'true'); } catch(e){}
      try { document.documentElement.classList.add('logged-in'); } catch(e){}
      if (j && j.user && j.user.username) {
        try { localStorage.setItem('currentUserId', j.user.username); } catch(e){}
      }
      try { if (typeof startPostLoginTasks === 'function') startPostLoginTasks(); } catch(e){}
      return;
    }
  } catch (e) {}

  // invalid or error -> clear stored auth flags
  isLoggedIn = false;
  try { localStorage.removeItem('isLoggedIn'); } catch(e){}
  try { localStorage.removeItem('currentUserId'); } catch(e){}
  try { document.documentElement.classList.remove('logged-in'); } catch(e){}
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
      isLoggedIn = false;
      
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
          isLoggedIn = false;
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
            state.formData.cekiciPlaka = formatTRPlate(document.getElementById('cekiciPlaka').value);
            state.formData.dorsePlaka = formatTRPlate(document.getElementById('dorsePlaka').value);
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
              // İlk çağrı - URL'den parametreleri al ve sakla
              const params = new URLSearchParams(window.location.search);
              reprintId = params.get('reprint');
              platePrm = params.get('plate');
              window.__tempReprintId = reprintId;
              window.__tempPlatePrm = platePrm;
              console.log('🔍 Yeni parametreler alındı ve saklandı - reprintId:', reprintId, 'platePrm:', platePrm);
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
        }
    }

// Ýlk yükleme
        document.addEventListener('DOMContentLoaded', function() {
    // ✅ Show login screen immediately to prevent white screen
    const loginScreen = document.getElementById('loginScreen');
    if (loginScreen) {
        loginScreen.style.display = 'flex';
    }

    // Ù¨ 1) Tarayýcýda 'isLoggedIn' kaydý var mý diye bak
    const savedLogin = localStorage.getItem('isLoggedIn');
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
            setTimeout(() => { yazdirBtn.__printing = false; }, 500);

            // ✅ Oturum kontrolü
            if (window.SessionManager && typeof window.SessionManager.requireValidSession === 'function') {
                const isValidSession = await window.SessionManager.requireValidSession();
                if (!isValidSession) {
                    return; // Oturum geçersizse işlemi durdur
                }
            }

            try {
                const validateFunc = window.__takipFormValidate;
                if (typeof validateFunc === 'function') validateFunc();
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
                alert('❌ Basım Yeri seçilmedi!');
                return;
            }

            const isValid = VALID_BASIM_YERLERI.some(v => v.toUpperCase() === basimYeriValue.toUpperCase());
            if (!isValid) {
                alert(`❌ Hatalı Basım Yeri: "${basimYeriValue}"\n\nKabul edilen: ${VALID_BASIM_YERLERI.join(', ')}`);
                return;
            }

            basimYeriValue = basimYeriValue.toUpperCase();

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

            try {
                if (window.piyasa && typeof window.piyasa.maybePromptAracBosuBeforePrint === 'function') {
                    await window.piyasa.maybePromptAracBosuBeforePrint();
                }
            } catch (bosErr) {
                console.warn('Araç boş ağırlık sorusu:', bosErr);
            }

            const snap = (() => {
                try {
                    const s = Object.assign({
                        ts: nowTs,
                        firmaSelect: get('firmaSelect'),
                        firmaKodu: get('firmaKodu'),
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

            window.__pendingPrintCommit = {
                vehicleId: vid,
                plaka: plateFromForm,
                nowTs,
                yuklemeSirasi: get('yuklemeSirasi'),
                basimYeri: basimYeriValue,
                snapshot: snap,
                piyasaOrderIdx: (window.piyasa && typeof window.piyasa.getActiveOrderIdx === 'function')
                  ? window.piyasa.getActiveOrderIdx()
                  : null,
            };

            // Plaka + şoför bilgisini DB ile eşitle (rapor Excel/NETSIS doğru şoförü görsün)
            if (plateFromForm) {
                try {
                    await saveCurrentVehicleToDatabase(plateFromForm);
                } catch (e) {
                    console.warn('Yazdırma öncesi araç kaydı atlandı:', e);
                }
            }

            window.__afterTakipPrintRequested = true;
            try { upsertEslestirmeFromTakipForm(); } catch(e){}

            const runYazdir = () => {
            let w = null;
            try { w = window.Print?.yazdirForm({ preview: false }); } catch(e) {}
            try { window.__lastPrintWin = w || null; } catch(e) {}

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


/* ===============================
   ⚠️ ŞOFÖR / PLAKA SORUN KAYDI
   - Plaka girince otomatik uyarı
   - Tarih + not + opsiyonel foto
================================ */

const ISSUE_STORAGE_KEY = 'driverIssuesByPlate_v1';

// ⚡ Performans: localStorage'dan sürekli okuma yerine bellekte cache tut.
// Her tuşa basışta filterVehicles() + her kart render'ı getIssueCount'u defalarca
// çağırıyor; her çağrı JSON.parse(localStorage) yapıyordu -> donma/kasma kaynağı.
let __issuesMapCache = null;
let __issueCountCache = new Map();
let __normPlateCache = new Map();

function _invalidateIssuesCache(){
  __issuesMapCache = null;
  __issueCountCache.clear();
}

// Başka sekmeden değişirse cache'i tazele + kartları yenile
try {
  window.addEventListener('storage', function(ev){
    if (ev && ev.key === ISSUE_STORAGE_KEY) {
      _invalidateIssuesCache();
      try {
        Promise.resolve(syncProblemsToDriverCards('')).catch(function () {});
      } catch (e) { /* ignore */ }
    }
  });
} catch(e){}

/** sorunlar.html sekmesinden gelen sorun/red güncellemeleri */
async function refreshVehicleRejectionForPlate(plate) {
  const norm = _normPlate(plate || '');
  if (!norm) return;
  try {
    const res = await fetch('/api/vehicles/lookup?plate=' + encodeURIComponent(plate));
    if (!res.ok) return;
    const fresh = await res.json();
    if (!fresh || !fresh.id) return;
    const mergeOne = function (v) {
      if (!v || _normPlate(v.cekiciPlaka) !== norm) return v;
      const merged = Object.assign({}, v, fresh);
      if (fresh.rejection) merged.rejection = fresh.rejection;
      if (fresh.rejection_status != null) merged.rejection_status = fresh.rejection_status;
      if (fresh.rejection_duration != null) merged.rejection_duration = fresh.rejection_duration;
      if (fresh.rejection_start_ts != null) merged.rejection_start_ts = fresh.rejection_start_ts;
      if (fresh.rejection_end_ts != null) merged.rejection_end_ts = fresh.rejection_end_ts;
      if (!fresh.rejection && !fresh.rejection_status) {
        delete merged.rejection;
        delete merged.rejection_status;
        delete merged.rejection_duration;
        delete merged.rejection_start_ts;
        delete merged.rejection_end_ts;
      }
      return merged;
    };
    state.vehicles = (state.vehicles || []).map(mergeOne);
    try {
      const updated = (state.vehicles || []).find(function (v) { return _normPlate(v.cekiciPlaka) === norm; });
      if (updated && window.storage && window.storage.save) storage.save('vehicle_' + updated.id, updated);
    } catch (e) { /* ignore */ }
    try { if (typeof render === 'function') render(); } catch (e) { /* ignore */ }
    try { if (typeof updateVehicleList === 'function') updateVehicleList(); } catch (e) { /* ignore */ }
  } catch (e) { /* ignore */ }
}

try {
  if (window.IssuesSyncBus && typeof window.IssuesSyncBus.onNotify === 'function') {
    window.IssuesSyncBus.onNotify(function (msg) {
      if (!msg || !msg.ts) return;
      const plate = msg.plate || '';
      Promise.resolve().then(async function () {
        try { await syncProblemsToDriverCards(plate); } catch (e) { /* ignore */ }
        if (msg.rejection || msg.rejectionClear) {
          try { await refreshVehicleRejectionForPlate(plate); } catch (e) { /* ignore */ }
        }
      });
    });
  }
} catch (e) { /* ignore */ }

function _normPlate(p){
  if (typeof p !== 'string') p = String(p || '');
  if (__normPlateCache.has(p)) return __normPlateCache.get(p);
  const out = p.toLowerCase().replace(/\s+/g,'').replace(/[^a-z0-9ığüşöç]/gi,'');
  if (__normPlateCache.size > 5000) __normPlateCache.clear();
  __normPlateCache.set(p, out);
  return out;
}

function loadIssuesMap(){
  if (__issuesMapCache) return __issuesMapCache;
  try {
    __issuesMapCache = JSON.parse(localStorage.getItem(ISSUE_STORAGE_KEY) || '{}') || {};
  } catch(e){
    __issuesMapCache = {};
  }
  return __issuesMapCache;
}

function saveIssuesMap(map){
  try { localStorage.setItem(ISSUE_STORAGE_KEY, JSON.stringify(map || {})); } catch(e){}
  __issuesMapCache = map || {};
  __issueCountCache.clear();
}

function getIssues(plate){
  const key = _normPlate(plate);
  const map = loadIssuesMap();
  const issues = Array.isArray(map[key]) ? map[key] : [];

  const validIssues = issues.filter(issue =>
    issue &&
    typeof issue === 'object' &&
    (issue.text || issue.description || issue.note)
  );

  if (validIssues.length !== issues.length) {
    map[key] = validIssues;
    saveIssuesMap(map);
    console.log(`🧹 Temizlendi: ${plate} - ${issues.length - validIssues.length} geçersiz sorun kaydı silindi`);
  }

  return validIssues;
}

function getIssueCount(plate){
  const key = _normPlate(plate);
  if (!key) return 0;
  if (__issueCountCache.has(key)) return __issueCountCache.get(key);
  const map = loadIssuesMap();
  const arr = Array.isArray(map[key]) ? map[key] : [];
  let cnt = 0;
  for (let i = 0; i < arr.length; i++) {
    const it = arr[i];
    if (it && typeof it === 'object'
        && (it.text || it.description || it.note)
        && it.status !== 'closed') {
      cnt++;
    }
  }
  __issueCountCache.set(key, cnt);
  return cnt;
}

function addIssue(plate, issue){
  const key = _normPlate(plate);
  if (!key) return;
  const map = loadIssuesMap();
  if (!Array.isArray(map[key])) map[key] = [];
  map[key].unshift(issue); // newest first
  saveIssuesMap(map);
}

function deleteIssue(plate, idx){
  const key = _normPlate(plate);
  const map = loadIssuesMap();
  if (!Array.isArray(map[key])) return;
  map[key].splice(idx,1);
  saveIssuesMap(map);
}
function updateIssue(plate, idx, patch){
  const key = _normPlate(plate);
  const map = loadIssuesMap();
  if (!Array.isArray(map[key])) return false;
  if (idx < 0 || idx >= map[key].length) return false;
  const prev = map[key][idx] || {};
  map[key][idx] = { ...prev, ...(patch || {}) };
  saveIssuesMap(map);
  return true;
}

function clearIssues(plate){
  const key = _normPlate(plate);
  if (!key) return false;
  const map = loadIssuesMap();
  if (map && Object.prototype.hasOwnProperty.call(map, key)) {
    delete map[key];
    saveIssuesMap(map);
    return true;
  }
  return false;
}
function clearAllIssues(){
  saveIssuesMap({});
}



function issueCardClass(plate){
  // Prefer server-provided cached counts when available, fallback to localStorage
  try {
    if (window.__problemsCountMap && typeof plate === 'string') {
      const key = _normPlate(plate);
      if (typeof window.__problemsCountMap[key] === 'number') {
        return window.__problemsCountMap[key] > 0 ? 'vehicle-card--issues' : '';
      }
      if (window.__problemsCountMap.__fromServerFull === true) {
        return '';
      }
    }
  } catch(e){}
  const cnt = getIssueCount(plate);
  return cnt > 0 ? 'vehicle-card--issues' : '';
}
function issuesBadgeHTML(plate){
  const p = _normPlate(plate);
  if (!p) return '';
  // Önce sunucu cache, sonra local cache — fazladan parse olmasın
  let cnt;
  try {
    if (window.__problemsCountMap) {
      if (typeof window.__problemsCountMap[p] === 'number') {
        cnt = Number(window.__problemsCountMap[p]) || 0;
      } else if (window.__problemsCountMap.__fromServerFull === true) {
        cnt = 0;
      }
    }
  } catch(e){}
  if (cnt === undefined) cnt = getIssueCount(plate);
  if (cnt > 0) {
    return `<button class="issues-open ml-2 text-xs px-2 py-1 rounded-full bg-red-600 text-white font-bold" data-plate="${p}" title="Sorun kayıtlarını gör">SORUN ${cnt}</button>`;
  }
  return `<button class="issues-open ml-2 text-xs px-2 py-1 rounded-full bg-gray-200 text-gray-700 font-semibold" data-plate="${p}" title="Sorun ekle / gör">SORUN 0</button>`;
}

/** Aktif red varsa { duration, endTs }; API sadece `rejection` nesnesi verebilir, DB kolonları düz alan olarak da gelir. */
function vehicleActiveRejection(vehicle) {
  if (!vehicle) return null;
  const r = vehicle.rejection;
  const status = vehicle.rejection_status || (r && r.status);
  if (status !== 'rejected') return null;
  let endTs = vehicle.rejection_end_ts != null ? Number(vehicle.rejection_end_ts) : NaN;
  if (!Number.isFinite(endTs) && r && r.endTs != null) endTs = Number(r.endTs);
  const hasEnd = Number.isFinite(endTs);
  if (hasEnd && Date.now() > endTs) return null;
  const duration = vehicle.rejection_duration || (r && r.duration) || 'Reddedildi';
  return { duration, endTs: hasEnd ? endTs : null };
}

function getRejectionDuration(vehicle){
  const act = vehicleActiveRejection(vehicle);
  if (act && act.duration) return act.duration;
  return '';
}

function rejectionBadgeHTML(vehicle, options){
  if (!vehicle) return '';
  if (options && options.hideWhenOverlay) return '';
  const act = vehicleActiveRejection(vehicle);
  if (!act) return '';

  const durationText = act.duration || 'Reddedildi';
  let banText = durationText;
  
  // Calculate end date for display
  const rejectionEndTs = act.endTs;
  if (rejectionEndTs) {
    const endDate = new Date(rejectionEndTs);
    const formattedDate = endDate.toLocaleDateString('tr-TR');
    const formattedTime = endDate.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
    banText = `${formattedDate} ${formattedTime} kadar girişi yasak`;
  }
  const esc = (s) => String(s || '').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  return `<div class="vehicle-rejection-badge mt-1 flex flex-col gap-1 items-start max-w-full min-w-0 w-full sm:w-auto">
    <span class="inline-flex items-center px-2 py-1 rounded-full text-xs font-bold bg-black text-white whitespace-nowrap" title="Araç reddedildi: ${esc(durationText)}">
      🔒 ${esc(durationText)}
    </span>
    <span class="text-[11px] sm:text-xs text-red-600 font-semibold leading-snug max-w-full break-words">${esc(banText)}</span>
  </div>`;
}

function escapeDataVehicleAttr(vehicle) {
  try {
    return JSON.stringify(vehicle).replace(/"/g, '&quot;');
  } catch (e) {
    return '';
  }
}

/** Sunucu sayacı veya yerel sorun listesi — JSON.stringify hack'i yok. */
function vehicleCardHasOpenProblems(vehicle) {
  if (!vehicle || !vehicle.cekiciPlaka) return false;
  const key = _normPlate(vehicle.cekiciPlaka);
  try {
    const map = window.__problemsCountMap;
    if (map && typeof map[key] === 'number') {
      return map[key] > 0;
    }
    /** Tüm /api/problems ile doldurulduysa, map'te olmayan plaka = 0 açık sorun (localStorage'a düşme). */
    if (map && map.__fromServerFull === true) {
      return false;
    }
  } catch (e) { /* ignore */ }
  try {
    return getIssueCount(vehicle.cekiciPlaka) > 0;
  } catch (e) {
    return false;
  }
}

function rejectionOverlayDetailText(vehicle) {
  const act = vehicleActiveRejection(vehicle);
  if (!act) return '';
  if (act.endTs) {
    const endDate = new Date(act.endTs);
    const formattedDate = endDate.toLocaleDateString('tr-TR');
    const formattedTime = endDate.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
    return `${formattedDate} ${formattedTime} kadar girişi yasak`;
  }
  return act.duration || '';
}

function vehicleCardBlockOverlayHTML(vehicle, isRejected, hasProblems) {
  const lines = [];
  if (isRejected) {
    const t = rejectionOverlayDetailText(vehicle);
    if (t) lines.push(t);
  }
  if (hasProblems) {
    try {
      const n = getIssueCount(vehicle.cekiciPlaka);
      if (n > 0) lines.push(`Açık sorun kaydı: ${n}`);
    } catch (e) { /* ignore */ }
  }
  const esc = (s) => String(s || '').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const blockDetail = lines.length
    ? lines.map((l) => `<p class="vehicle-card__overlay-detail">${esc(l)}</p>`).join('')
    : '';
  return `
    <div class="vehicle-card__overlay" role="alert" aria-live="polite">
      <svg class="vehicle-card__overlay-icon" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 2C9.243 2 7 4.243 7 7v3H6c-1.103 0-2 .897-2 2v7c0 1.103.897 2 2 2h12c1.103 0 2-.897 2-2v-7c0-1.103-.897-2-2-2h-1V7c0-2.757-2.243-5-5-5zm0 2c1.654 0 3 1.346 3 3v3H9V7c0-1.654 1.346-3 3-3zm-5 7h10v7H7v-7z"/>
      </svg>
      <p class="vehicle-card__overlay-title">SORUNLU ARAÇ</p>
      <p class="vehicle-card__overlay-sub">İşlem yapılamaz</p>
      ${blockDetail}
    </div>`;
}

/** Verilen plakaya sahip TÜM araçların rejection_* alanlarını DB'de NULL yapar
 *  ve bellekteki state'i de günceller. Sorun silindiğinde otomatik çağrılır. */
async function clearRejectionForPlate(plate) {
  const norm = _normPlate(plate || '');
  if (!norm) return;
  const matches = (state.vehicles || []).filter((v) => v && _normPlate(v.cekiciPlaka) === norm);
  for (const v of matches) {
    if (!v || !v.id) continue;
    // Sadece reddi olanlara API gönder; gereksiz istek yapma.
    const status = v.rejection_status || (v.rejection && v.rejection.status);
    if (status !== 'rejected') continue;
    try {
      const res = await fetch(`/api/vehicles/${encodeURIComponent(v.id)}/remove-rejection`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      if (!res.ok) {
        console.warn('remove-rejection başarısız:', v.id, res.status);
        continue;
      }
    } catch (err) {
      console.warn('remove-rejection exception:', err);
      continue;
    }
    try {
      const cleared = { ...v };
      delete cleared.rejection;
      delete cleared.rejection_status;
      delete cleared.rejection_duration;
      delete cleared.rejection_start_ts;
      delete cleared.rejection_end_ts;
      state.vehicles = (state.vehicles || []).map((x) => (String(x.id) === String(v.id) ? cleared : x));
      try { if (window.storage && window.storage.save) window.storage.save('vehicle_' + v.id, cleared); } catch (e) { /* ignore */ }
    } catch (e) { /* ignore */ }
  }
}

/** Tek şoför kartı — liste (render) ve arama (updateVehicleList) ortak. */
function vehicleCardHTML(vehicle) {
  const isRejected = !!vehicleActiveRejection(vehicle);
  const hasProblems = vehicleCardHasOpenProblems(vehicle);
  // Kilit overlay'i SADECE araç reddedilmişse (girişi yasaksa) gösterilir.
  // Sadece "sorun kaydı" varsa kart siyah/kilitli görünmez; kırmızı çerçeve + SORUN rozeti yeterli.
  const showBlockOverlay = isRejected;
  const plate = formatPlaka(vehicle.cekiciPlaka);
  const dv = escapeDataVehicleAttr(vehicle);
  const cardClass = showBlockOverlay
    ? 'vehicle-card vehicle-card--blocked'
    : `vehicle-card ${issueCardClass(vehicle.cekiciPlaka)}`;
  const overlay = showBlockOverlay ? vehicleCardBlockOverlayHTML(vehicle, isRejected, hasProblems) : '';
  const rejectionInline = rejectionBadgeHTML(vehicle, { hideWhenOverlay: showBlockOverlay });
  const waTextPlain = 'Merhaba ' + formatPlaka(vehicle.cekiciPlaka)
    + (vehicle.soforAdi ? ' - ' + (vehicle.soforAdi + (vehicle.soforSoyadi ? ' ' + vehicle.soforSoyadi : '')) : '');
  const waPhone = toWhatsAppPhone(vehicle.iletisim);
  const formBtn = showBlockOverlay ? '' : `
    <button type="button" class="vehicle-card__form-btn form-btn" data-vehicle="${dv}" title="Takip Formu">
      <svg class="vehicle-card__form-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
      <span>Takip Formu</span>
    </button>`;
  const footerActions = showBlockOverlay ? '' : `
    <div class="vehicle-card__toolbar">
      <button type="button" class="vehicle-card__tool copy-card-btn" data-vehicle="${dv}" title="Kartı Kopyala">Kopyala</button>
      <button type="button" class="vehicle-card__tool vehicle-card__tool--danger delete-btn" data-id="${vehicle.id}" title="Sil">Sil</button>
      <button type="button" class="vehicle-card__tool vehicle-card__tool--primary edit-btn" data-vehicle="${dv}" title="Düzenle">Düzenle</button>
    </div>`;

  const footerStatusHtml = showBlockOverlay
    ? '<span class="vehicle-card__status-blocked">SORUNLU ARAÇ</span>'
    : '';

  return `<div class="${cardClass}" data-vehicle="${dv}">
${overlay}
    <div class="vehicle-card__header">
      <div class="vehicle-card__header-main">
        <div class="vehicle-card__plate-row">
          <span class="vehicle-card__plate">${plate}</span>
          ${issuesBadgeHTML(vehicle.cekiciPlaka)}
        </div>
        ${rejectionInline}
      </div>
      <div class="vehicle-card__brand" title="NETSIS verilerini kopyala">
        <button type="button" class="netsis-btn" data-vehicle="${dv}" aria-label="NETSIS verilerini kopyala">
          <img class="netsis-btn-icon" src="${NETSIS_ICON_SRC}" alt="NETSIS" onerror="if(!this.dataset.fb){this.dataset.fb='1';this.src='/assets/netsis.png';}" />
        </button>
      </div>
    </div>
    <div class="vehicle-card__body">
      ${vehicle.dorsePlaka ? `<div class="vehicle-card__field"><span class="vehicle-card__label">Dorse</span><span class="vehicle-card__value">${formatPlaka(vehicle.dorsePlaka)}</span></div>` : ''}
      ${vehicle.soforAdi ? `<div class="vehicle-card__field"><span class="vehicle-card__label">Şoför</span><span class="vehicle-card__value">${vehicle.soforAdi} ${vehicle.soforSoyadi || ''}</span></div>` : ''}
      ${(vehicle.iletisim || vehicle.tcKimlik) ? `<div class="vehicle-card__field vehicle-card__field--wide vehicle-card__contact-tc">
        ${vehicle.iletisim ? `<div class="vehicle-card__contact-tc-item">
          <span class="vehicle-card__label">İletişim</span>
          <span class="vehicle-card__value vehicle-card__value--contact">
            <span>${vehicle.iletisim}</span>
            ${waPhone ? `<button type="button" class="vehicle-card__wa whatsapp-link" data-wa-phone="${waPhone}" data-wa-text="${escapeAttr(waTextPlain)}" title="WhatsApp — link kopyala (açık sekmede Ctrl+V → Enter)">
              <img src="${WHATSAPP_ICON_SRC}" alt="" width="18" height="18"/>
            </button>` : ''}
          </span>
        </div>` : ''}
        ${vehicle.tcKimlik ? `<div class="vehicle-card__contact-tc-item">
          <span class="vehicle-card__label">TC</span>
          <span class="vehicle-card__value">${maskTc(vehicle.tcKimlik)}</span>
        </div>` : ''}
      </div>` : ''}
    </div>
    <div class="vehicle-card__footer">
      ${footerActions}
      ${footerStatusHtml ? `<div class="vehicle-card__status">${footerStatusHtml}</div>` : ''}
      <time class="vehicle-card__date">${vehicle.kayitTarihi || ''}</time>
      ${formBtn}
    </div>
  </div>`;
}

async function updateIssuesIndicators(plate){
  // Update issue counts on UI. Prefer server counts, fall back to localStorage.
  try {
    const norm = _normPlate(plate || document.getElementById('cekiciPlaka')?.value || '');
    const setBtnForPlate = (p, cnt) => {
      // update quick btn if matching
      try {
        const qb = document.getElementById('issuesQuickBtn');
        if (qb && String(p || '') === _normPlate(document.getElementById('cekiciPlaka')?.value || '')) {
          qb.textContent = `⚠️ Şoför Sorunları (${cnt})`;
          qb.style.background = cnt>0 ? '#ef4444' : '#374151';
        }
      } catch(e){}
      // update any .issues-open buttons with matching data-plate
      try {
        Array.from(document.querySelectorAll('.issues-open')).forEach(el => {
          const dp = el.getAttribute('data-plate') || '';
          if (_normPlate(dp) === _normPlate(p || '')) {
            const text = cnt>0 ? `SORUN ${cnt}` : `SORUN 0`;
            el.innerHTML = text;
            el.style.background = cnt>0 ? '#ef4444' : '';
          }
        });
      } catch(e){}
    };

    if (norm) {
      try {
        const res = await fetch('/api/problems?plate=' + encodeURIComponent(norm));
        if (res.ok) {
          const arr = await res.json();
          const cnt = Array.isArray(arr) ? arr.filter(it => { const s = (it && it.data && it.data.status) || it.status; return s !== 'closed'; }).length : 0;
            window.__problemsCountMap = window.__problemsCountMap || {};
            delete window.__problemsCountMap.__fromServerFull;
            window.__problemsCountMap[norm] = cnt;
            setBtnForPlate(norm, cnt);
          return;
        }
      } catch(e){}
      // fallback to local
      const cntLocal = getIssueCount(norm);
      setBtnForPlate(norm, cntLocal);
      return;
    }

    // no specific plate: update quick button and all issue-open buttons
    try {
      const qbPlate = _normPlate(document.getElementById('cekiciPlaka')?.value || '');
      if (qbPlate) {
        const res0 = await fetch('/api/problems?plate=' + encodeURIComponent(qbPlate));
        if (res0.ok) {
          const arr0 = await res0.json();
          const cnt0 = Array.isArray(arr0) ? arr0.filter(it => { const s = (it && it.data && it.data.status) || it.status; return s !== 'closed'; }).length : 0;
          window.__problemsCountMap = window.__problemsCountMap || {};
          delete window.__problemsCountMap.__fromServerFull;
          window.__problemsCountMap[qbPlate] = cnt0;
          setBtnForPlate(qbPlate, cnt0);
        }
      }
    } catch(e){}

    // update all buttons by querying server once for all problems and grouping (if server reachable)
    try {
      const res = await fetch('/api/problems');
      if (res.ok) {
        const all = await res.json();
        const grouped = {};
        (all || []).forEach(it => { const p = _normPlate(it.plate || it.addedPlate || ''); if (!p) return; if (!grouped[p]) grouped[p]=0; const s = (it && it.data && it.data.status) || it.status; if (s !== 'closed') grouped[p]++; });
        grouped.__fromServerFull = true;
        // Önce tüm eski rozetleri sıfırla, sonra sunucudaki sayımları yaz.
        try {
          const oldMap = window.__problemsCountMap || {};
          Object.keys(oldMap).forEach((p) => { if (p !== '__fromServerFull') setBtnForPlate(p, 0); });
        } catch (e) { /* ignore */ }
        window.__problemsCountMap = grouped;
        Object.keys(grouped).forEach((p) => { if (p !== '__fromServerFull') setBtnForPlate(p, grouped[p]); });
        // Sunucu otoritedir — tarayıcıdaki eski "addIssue fallback" kayıtlarını kaldır,
        // böylece kartlar bir sonraki render'da hayalet sorun göstermez.
        try {
          const localMap = loadIssuesMap();
          let changed = false;
          Object.keys(localMap || {}).forEach((k) => {
            const norm = _normPlate(k);
            const serverCnt = norm ? grouped[norm] : 0;
            if (!serverCnt) {
              delete localMap[k];
              changed = true;
            }
          });
          if (changed) saveIssuesMap(localMap);
        } catch (e) { /* ignore */ }
        return;
      }
    } catch(e){}

    // final fallback: update using localStorage map
    try {
      const map = loadIssuesMap();
      const localMap = {};
      Object.keys(map || {}).forEach(k => { const cnt = Array.isArray(map[k]) ? map[k].filter(it => (it && it.status) !== 'closed').length : 0; localMap[k] = cnt; setBtnForPlate(k, cnt); });
      window.__problemsCountMap = window.__problemsCountMap || {};
      delete window.__problemsCountMap.__fromServerFull;
      Object.assign(window.__problemsCountMap, localMap);
    } catch(e){}
  } catch(e){}
}

/** Sorun silindikten sonra çağrılır: o plakaya bağlı aktif redleri de DB'den siler,
 *  ardından sayaçları/kartları sunucudan tazeler. */
async function clearRejectionAndSyncCards(plate) {
  try { await clearRejectionForPlate(plate); } catch (e) { /* ignore */ }
  await syncProblemsToDriverCards(plate);
}

/** Sorun sayacını sunucudan güncelle, sonra kartları yeniden çiz (render önce sayaç olmalı). */
async function syncProblemsToDriverCards(plate) {
  const p = (plate != null && String(plate).trim() !== '') ? _normPlate(String(plate)) : '';
  try {
    // Tek plaka senkronu hep yapılır; ek olarak tüm plakaların tutarlı kalması için
    // tam sunucu senkronunu da çalıştır (sunucu otorite, localStorage temizlenir).
    if (p) await updateIssuesIndicators(p);
    await updateIssuesIndicators();
  } catch (e) { /* ignore */ }
  // Bireysel plaka için localStorage cache'i de temizle (API'den sıfır geldiyse).
  try {
    if (p && window.__problemsCountMap && window.__problemsCountMap[p] === 0) {
      const localMap = loadIssuesMap();
      if (localMap && Object.prototype.hasOwnProperty.call(localMap, p)) {
        delete localMap[p];
        saveIssuesMap(localMap);
      }
    }
  } catch (e) { /* ignore */ }
  try { if (typeof render === 'function') render(); } catch (e) { /* ignore */ }
  try { if (typeof updateVehicleList === 'function') updateVehicleList(); } catch (e) { /* ignore */ }
}

function closeIssuesModal(){
  const el = document.getElementById('issuesOverlay');
  if (el) el.remove();
}

async function fileToDataUrl(file){
  return new Promise((resolve,reject)=>{
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

function openIssuesModal(plateOrEmpty) {
  const plate = (plateOrEmpty || '').trim();
  let url = 'sorunlar.html';
  if (plate) url += '?plate=' + encodeURIComponent(plate);
  if (window.SessionManager && typeof window.SessionManager.openAppPage === 'function') {
    window.SessionManager.openAppPage(url);
  } else {
    location.href = url;
  }
}

function autoOpenIssuesIfExists(plate){
  const cnt = getIssueCount(plate);
  if (cnt > 0) openIssuesModal(plate);
}

// Global delegation: kartlardaki butonlar
document.addEventListener('click', (e)=>{
  const t = e.target && e.target.closest
    ? e.target.closest('.issues-open, .copy-card-btn')
    : null;
  if (!t) return;

  // Issues-open butonları
  if (t.classList.contains('issues-open')) {
    e.preventDefault();
    const plateKey = t.getAttribute('data-plate') || '';
    // plateKey normalized; modal plate input ham da olabilir
    openIssuesModal(plateKey);
    return;
  }

  // Copy card butonu
  if (t.classList.contains('copy-card-btn')) {
    e.preventDefault();
    try {
      const vehicleData = JSON.parse(t.getAttribute('data-vehicle') || '{}');
      copyCardInfo(vehicleData);
    } catch(err) {
      console.error('Copy card error:', err);
    }
  }
});

// Kart Bilgilerini Kopyala Fonksiyonu
function copyCardInfo(vehicle) {
  try {
    // Tüm kart bilgilerini clipboard'a kopyala
    const cardText = `Plaka: ${vehicle.cekiciPlaka || ''}
Dorse: ${vehicle.dorsePlaka || ''}
Şoför: ${vehicle.soforAdi || ''} ${vehicle.soforSoyadi || ''}
İletişim: ${vehicle.iletisim || ''}
TC: ${vehicle.tcKimlik || ''}
Kayıt: ${vehicle.kayitTarihi || ''}`;
    
    navigator.clipboard.writeText(cardText).then(() => {
      // Başarı mesajı göster
      showCopyMessage('Kart bilgileri kopyalandı!');
      
      // Otomatik olarak yeni form oluştur
      setTimeout(() => {
        createNewVehicleWithCopiedInfo(vehicle);
      }, 500);
    }).catch(err => {
      console.error('Clipboard error:', err);
      alert('Kopyalama başarısız!');
    });
  } catch(e) {
    console.error('Copy card error:', e);
    alert('Kopyalama hatası!');
  }
}

function createNewVehicleWithCopiedInfo(originalVehicle) {
  clearActiveTakipVehicleRefs();
  state.editingId = null;

  // Formu göster
  state.showForm = true;
  
  // Form alanlarını doldur - plakayı temizle, diğer bilgileri koru
  state.formData = {
    cekiciPlaka: '', // Plakayı temizle
    dorsePlaka: originalVehicle.dorsePlaka || '',
    soforAdi: originalVehicle.soforAdi || '',
    soforSoyadi: originalVehicle.soforSoyadi || '',
    sofor2Adi: '',
    sofor2Soyadi: '',
    iletisim: originalVehicle.iletisim || '',
    tcKimlik: originalVehicle.tcKimlik || '',
    defaultFirma: originalVehicle.defaultFirma || '',
    defaultMalzeme: originalVehicle.defaultMalzeme || '',
    defaultSevkYeri: originalVehicle.defaultSevkYeri || '',
    defaultYuklemeNotu: originalVehicle.defaultYuklemeNotu || ''
  };
  
  // UI'ı güncelle
  render();
  
  // Plaka alanına odaklan
  setTimeout(() => {
    document.getElementById('cekiciPlaka')?.focus();
  }, 100);
}

function showCopyMessage(message) {
  showToast(message, 'success', 3000);
}

// İçerideki araçlar özelliği kaldırıldı – ilgili fonksiyonlar silindi.
// $('#iceridekiAraclar...') DOM manipülasyonu ve periyodik refresh artık yok.

function _ihracatShipmentKey(s) {
  return `${String(s.plaka || '').trim()}__${String(s.id || '').trim()}__${String(s.sira || '').trim()}`;
}

function _ihracatFirmaGroupKey(s) {
  const m = String(s.ydKey || s.firma || 'GENEL').match(/\b(YD\d{1,4})\b/i);
  const raw = (m ? m[1] : String(s.firma || 'GENEL')).toUpperCase();
  return raw.replace(/[^A-Z0-9]/g, '_') || 'GENEL';
}

/** Excel’deki her sevkiyat bloğu ayrı (aynı booking + farklı malzeme/HP = ayrı blok) */
function _ihracatBlockGroupKey(s) {
  const stored = String(s.blockKey || '').trim();
  if (stored) return stored;

  const ht = String(s.headerText || '').trim();
  const malzeme = String(s.malzeme || '').trim();
  const book = (ht.match(/BOOKING\s*NO\s*:\s*(\d+)/i) || [])[1];
  const lot = (ht.match(/LOT\s*NO\s*([\d\s]+)/i) || [])[1];
  const hp = (ht.match(/HP\s*([\d.,]+\s*-\s*[\d.,]+)/i) || [])[1];
  const parts = [];
  if (book) parts.push(`BOOKING_${book}`);
  else if (lot) parts.push(`LOT_${lot.replace(/\s+/g, '')}`);
  if (malzeme) parts.push(`M_${malzeme.replace(/\W+/g, '_').slice(0, 36)}`);
  else if (hp) parts.push(`HP_${hp.replace(/\W+/g, '_')}`);
  if (parts.length) return parts.join('__');
  if (ht) return `HDR_${ht.length}_${ht.slice(0, 48).replace(/\W+/g, '_')}`;
  return `FIRMA_${_ihracatFirmaGroupKey(s)}`;
}

function _ihracatShortBlockTitle(headerText, malzemeHint) {
  const ht = String(headerText || '').trim();
  if (!ht) return '';
  const yd = _extractFirmaKod(ht);
  const lot = (ht.match(/LOT\s*NO\s*([\d\s]+)/i) || [])[1];
  const book = (ht.match(/BOOKING\s*NO\s*:\s*(\d+)/i) || [])[1];
  const hp = (ht.match(/HP\s*([\d.,]+\s*-\s*[\d.,]+)/i) || [])[1];
  const malzeme = String(malzemeHint || '').trim();
  const parts = [];
  if (yd) parts.push(yd);
  if (lot) parts.push(`LOT ${lot.trim()}`);
  if (book) parts.push(`Booking ${book}`);
  if (malzeme) parts.push(malzeme);
  else if (hp) parts.push(`HP ${hp.trim()}`);
  return parts.join(' · ') || ht.slice(0, 80);
}

function _ihracatDisplayTonajCell(val) {
  const s = String(val ?? '').trim();
  if (!s) return '—';
  const n = Number(s.replace(/\./g, '').replace(',', '.'));
  if (!Number.isFinite(n)) return s;
  if (n >= 1000) {
    return (n / 1000).toLocaleString('tr-TR', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
  }
  return s;
}

function _ihracatSumItemsTotals(items) {
  const sumField = (field) => {
    let total = 0;
    let any = false;
    (items || []).forEach((it) => {
      const n = _ihracatParseNum(it[field]);
      if (n) {
        total += n;
        any = true;
      }
    });
    return any ? String(Math.round(total)) : '0';
  };
  const tonaj = sumField('tonajKg');
  return {
    bbt: sumField('bbt'),
    cuval: sumField('cuval'),
    palet: sumField('palet'),
    bosBbt: sumField('bosBbt'),
    bosCuval: sumField('bosCuval'),
    tonajKg: tonaj,
    netTonaj: tonaj,
  };
}

function _stripPackedQtyFromHeaderLine(s) {
  return String(s || '')
    .replace(/\s*\/\s*\d+[\d.,]*\s*BBT\b/gi, '')
    .replace(/\s*\/\s*\d+[\d.,]*\s*ÇUVAL\b/gi, '')
    .replace(/\s*\/\s*\d+[\d.,]*\s*CUVAL\b/gi, '')
    .replace(/\s*\/\s*\d+[\d.,]*\s*PALET\b/gi, '')
    .replace(/\s*\/\s*$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function _ihracatLiveBbtPaletFooterText(items, defaultText) {
  const sums = _ihracatSumItemsTotals(items || []);
  const bbt = Math.round(sums.bbt);
  const palet = Math.round(sums.palet);
  if (bbt > 0 || palet > 0) return `${bbt} BBT ${palet} PALET`;
  return String(defaultText || '').trim();
}

function _ihracatRenderExcelBlockFooterHtml(d, items, rule, black) {
  const footer = String(d.footerLine || d.bbtPaletSummary || d.noteLine || '').trim();
  if (!footer) return '';
  if (d.isFooterNote) {
    return `<div style="${rule}"><div style="${black}" data-ihr-footer-is-note="1">${escapeHtml(footer)}</div></div>`;
  }
  if (d.isBbtFooter || /^\d+\s*BBT/i.test(footer)) {
    const shown = _ihracatLiveBbtPaletFooterText(items, footer);
    return `<div style="${rule}"><div style="${black}" data-ihr-header-bbt-palet="1" data-ihr-header-bbt-palet-default="${escapeHtml(footer)}">${escapeHtml(shown)}</div></div>`;
  }
  return `<div style="${rule}"><div style="${black}">${escapeHtml(footer)}</div></div>`;
}

/** Excel üst bilgi kutusu — export altında BBT özeti veya müşteri notu */
function _ihracatRenderExcelBlockHeader(sample, items) {
  const d = _buildIhracatHeaderDisplay(sample);
  if (!d.blackLine1 && !d.exportLine && !d.portLine && !d.borusanLine && !d.footerLine) return '';
  const rule = 'border-top:1px solid #000;padding:6px 8px 5px;';
  const black = 'color:#000;font-weight:700;font-size:11px;line-height:1.4;text-align:center;margin:0;';
  const red = 'color:#991b1b;font-weight:700;font-size:10px;line-height:1.35;text-align:center;margin:0;';
  const redRef =
    'color:#991b1b;font-weight:600;font-size:10px;line-height:1.35;text-align:center;margin:0;word-break:break-word;';
  const wrap =
    'margin:0 0 12px;border:1px solid #000;border-radius:4px;background:#fff;overflow:hidden;';
  const port = d.portLine || d.borusanLine;
  const line2 = _stripPackedQtyFromHeaderLine(d.blackLine2);
  let html = `<div class="ihr-excel-desc" style="${wrap}">`;
  html += '<div class="ihr-excel-desc-top" style="padding:8px 10px 6px;">';
  if (d.blackLine1) html += `<div style="${black}">${escapeHtml(d.blackLine1)}</div>`;
  if (line2) {
    html += `<div style="${black}${d.blackLine1 ? 'margin-top:3px;' : ''}">${escapeHtml(line2)}</div>`;
  }
  if (port) {
    html += `<div style="${red}${d.blackLine1 || line2 ? 'margin-top:4px;' : ''}">${escapeHtml(port)}</div>`;
  }
  html += '</div>';
  if (d.exportLine) html += `<div style="${rule}"><div style="${redRef}">${escapeHtml(d.exportLine)}</div></div>`;
  html += _ihracatRenderExcelBlockFooterHtml(d, items, rule, black);
  html += '</div>';
  return html;
}

function _ihracatRenderExcelBlockHeaderRows(sample, opts) {
  const d = _buildIhracatHeaderDisplay(sample);
  if (!d.blackLine1 && !d.exportLine && !d.portLine) return '';
  const cols = Number(opts?.colSpan) > 0 ? Number(opts.colSpan) : 8;
  const td =
    'border:1px solid #ddd;padding:7px 8px;font-size:11px;text-align:center;vertical-align:middle;line-height:1.4;';
  const tdBlack = `${td}background:#fff;color:#000;font-weight:700;`;
  const tdRed = `${td}background:#fff;color:#991b1b;font-weight:700;font-size:10px;`;
  const tdRedRef = `${td}background:#fff;color:#991b1b;font-weight:600;font-size:10px;word-break:break-word;`;
  const tdPlan = `${td}background:#f8fafc;color:#000;font-weight:700;`;
  const row = (inner, style) =>
    `<tr class="ihr-sheet-meta-row"><td colspan="${cols}" style="${style}">${inner}</td></tr>`;
  const out = [];
  const port = d.portLine || d.borusanLine;
  const line2 = _stripPackedQtyFromHeaderLine(d.blackLine2);
  if (d.blackLine1) out.push(row(escapeHtml(d.blackLine1), tdBlack));
  if (line2) out.push(row(escapeHtml(line2), tdBlack));
  if (port) out.push(row(escapeHtml(port), tdRed));
  if (d.exportLine) out.push(row(escapeHtml(d.exportLine), tdRedRef));
  const footer = String(d.footerLine || d.bbtPaletSummary || d.noteLine || '').trim();
  if (footer) {
    if (d.isFooterNote) {
      out.push(row(escapeHtml(footer), tdPlan));
    } else if (d.isBbtFooter || /^\d+\s*BBT/i.test(footer)) {
      const shown = _ihracatLiveBbtPaletFooterText(null, footer);
      out.push(
        row(
          `<span data-ihr-header-bbt-palet="1">${escapeHtml(shown)}</span>`,
          tdPlan
        )
      );
    } else {
      out.push(row(escapeHtml(footer), tdPlan));
    }
  }
  return out.join('');
}

function _ihracatRenderExcelToplamRow(excelTotals, items) {
  const live = _ihracatSumItemsTotals(items);
  const t = excelTotals && Object.values(excelTotals).some((v) => String(v).trim() !== '')
    ? excelTotals
    : live;
  const cell = (val, extra) => {
    const raw = String(val ?? '').trim();
    const shown = raw ? escapeHtml(_ihracatDisplayTonajCell(raw)) : '0';
    return `<td style="border:1px solid #000;padding:6px 8px;text-align:center;font-weight:800;font-size:12px;${extra || ''}">${shown}</td>`;
  };
  const th = 'border:1px solid #000;padding:5px 6px;font-size:10px;font-weight:800;text-align:center;background:#fef9c3;';
  const thPeach = 'border:1px solid #000;padding:5px 6px;font-size:10px;font-weight:800;text-align:center;background:#fed7aa;';
  const thGrey = 'border:1px solid #000;padding:5px 6px;font-size:10px;font-weight:800;text-align:center;background:#e5e7eb;';
  const farkStyle = String(t.fark || '').trim().startsWith('-') ? 'background:#e5e7eb;' : 'background:#bbf7d0;';
  return `
    <table style="width:100%;border-collapse:collapse;margin-top:8px;font-size:12px;">
      <thead>
        <tr>
          <th colspan="2" style="${th}">TOPLAM</th>
          <th style="${th}">BBT</th>
          <th style="${th}">ÇUVAL</th>
          <th style="${th}">PALET</th>
          <th style="${th}">BOŞ BBT</th>
          <th style="${th}">BOŞ ÇUVAL</th>
          <th style="${thPeach}">NET TONAJ</th>
          <th style="${thPeach}">O.GR. TONAJ</th>
          <th style="${thPeach}">GİDEN TONAJ</th>
          <th style="${thGrey}">FARK</th>
        </tr>
      </thead>
      <tbody>
        <tr style="background:#fef08a;">
          <td colspan="2" style="border:1px solid #000;padding:6px 8px;font-weight:900;text-align:center;background:#fef08a;">TOPLAM</td>
          ${cell(t.bbt)}
          ${cell(t.cuval)}
          ${cell(t.palet)}
          ${cell(t.bosBbt)}
          ${cell(t.bosCuval)}
          ${cell(t.netTonaj, 'background:#ffedd5;')}
          ${cell(t.ogrTonaj, 'background:#ffedd5;')}
          ${cell(t.gidenTonaj, 'background:#ffedd5;')}
          ${cell(t.fark, farkStyle)}
        </tr>
      </tbody>
    </table>`;
}

function _defaultSevkForShipment(s) {
  const direct = String(s.sevkYeri || '').trim();
  if (direct) return direct;
  const cands = getLimanCandidates(s.headerText || '');
  return cands[0] || '';
}

function _defaultAmbalajTextForShipment(s) {
  const direct = String(s.ambalaj || s.ambalajBilgisi || '').trim();
  if (direct) return direct;
  const cands = getAmbalajCandidates(s.headerText || '');
  return cands[0] || '';
}

function _applyExcelShipmentFieldsToTakipForm(chosen) {
  if (!chosen) return;
  const firmaKodu = document.getElementById('firmaKodu');
  const firmaSelect = document.getElementById('firmaSelect');
  const malzeme = document.getElementById('malzeme');
  const malzemeSelect = document.getElementById('malzemeSelect');
  const sevkYeri = document.getElementById('sevkYeri');
  const ambalajBilgisi = document.getElementById('ambalajBilgisi');
  const tonajEl = document.getElementById('tonaj');
  const bbt = document.getElementById('bbt');
  const cuval = document.getElementById('cuval');
  const palet = document.getElementById('palet');
  const bosBbt = document.getElementById('bosBbt');
  const bosCuval = document.getElementById('bosCuval');
  const yuklemeNotu = document.getElementById('yuklemeNotu');

  const firmaVal = String(chosen.firma || chosen.ydKey || '').trim();
  const malzemeVal = String(chosen.malzeme || '').trim();
  if (firmaKodu && firmaVal) firmaKodu.value = firmaVal;
  if (firmaSelect && firmaVal) {
    try {
      const opt = Array.from(firmaSelect.options || []).find((o) => String(o.value || '').trim() === firmaVal);
      if (opt) firmaSelect.value = opt.value;
    } catch (e) {}
  }
  if (malzeme && malzemeVal) malzeme.value = malzemeVal;
  if (malzemeSelect && malzemeVal) malzemeSelect.value = malzemeVal;

  const sevk = String(chosen.sevkYeri || _defaultSevkForShipment(chosen)).trim();
  if (sevkYeri && sevk) sevkYeri.value = sevk;

  const ambText = String(chosen.ambalaj || chosen.ambalajBilgisi || _defaultAmbalajTextForShipment(chosen)).trim();
  if (ambalajBilgisi && ambText) ambalajBilgisi.value = ambText;

  if (tonajEl && chosen.tonajKg != null && String(chosen.tonajKg).trim() !== '') {
    tonajEl.value = String(chosen.tonajKg).trim();
  }

  if (bbt) bbt.value = String(chosen.bbt || '').trim();
  if (palet) palet.value = String(chosen.palet || '').trim();
  if (bosBbt) bosBbt.value = String(chosen.bosBbt || '').trim();
  if (cuval) {
    const cv = Number(chosen.cuval || 0);
    const bcv = Number(chosen.bosCuval || 0);
    if (cv > 0) {
      cuval.value = String(chosen.cuval);
      if (bosCuval) bosCuval.value = bcv > 0 ? String(chosen.bosCuval) : '';
    } else if (bcv > 0) {
      cuval.value = String(chosen.bosCuval);
      if (bosCuval) bosCuval.value = '';
    }
  }

  applyShipmentTonajAndIrsaliye(chosen);
}

function _ihracatReadRowFields(row, cur, blockSevk, blockAmb) {
  const gk = _ihracatBlockGroupKey(cur);
  const plakaInp = row.querySelector('[data-field="plaka"]');
  const plakaText = row.querySelector('[data-field="plaka-text"]');
  const plaka = plakaInp
    ? normPlate(plakaInp.value)
    : plakaText
      ? normPlate(plakaText.textContent)
      : normPlate(cur.plaka || '');
  if (!plaka || !_ihracatPlateKey(plaka)) return null;
  cur.plaka = plaka;

  const firmaEl = row.querySelector('[data-field="firma"]');
  const malzemeEl = row.querySelector('[data-field="malzeme"]');
  if (firmaEl) cur.firma = String(firmaEl.textContent || '').trim();
  if (malzemeEl) cur.malzeme = String(malzemeEl.textContent || '').trim();

  const tonaj = row.querySelector('[data-field="tonaj"]');
  const irs = row.querySelector('[data-field="irsaliye"]');
  const bbt = row.querySelector('[data-field="bbt"]');
  const bosBbt = row.querySelector('[data-field="bosBbt"]');
  const cuval = row.querySelector('[data-field="cuval"]');
  const bosCuval = row.querySelector('[data-field="bosCuval"]');
  const palet = row.querySelector('[data-field="palet"]');

  if (tonaj) cur.tonajKg = String(tonaj.value || '').trim();
  if (irs) {
    const n = normalizeIrsaliyeNo(irs.value);
    cur.irsaliyeNo = n;
    if (n) cur.id = n;
  }
  if (bbt) cur.bbt = String(bbt.value || '').trim();
  if (bosBbt) cur.bosBbt = String(bosBbt.value || '').trim();
  if (cuval) cur.cuval = String(cuval.value || '').trim();
  if (bosCuval) cur.bosCuval = String(bosCuval.value || '').trim();
  if (palet) cur.palet = String(palet.value || '').trim();

  const sevk = blockSevk[gk] || cur.sevkYeri || '';
  if (sevk) cur.sevkYeri = sevk;
  const amb = blockAmb[gk] || '';
  if (amb) {
    cur.ambalaj = amb;
    cur.ambalajBilgisi = amb;
  }

  cur._ihracatEdited = true;
  cur._ihracatEditedAt = Date.now();
  return cur;
}

function _saveIhracatDetailsFromModal(originalShipments, meta) {
  const modal = document.getElementById('ihracatDetailsModal');
  if (!modal) return false;

  const byKey = new Map();
  (originalShipments || []).forEach((s) => {
    byKey.set(_ihracatShipmentKey(s), { ...s });
  });

  const blockSevk = {};
  const blockAmb = {};
  modal.querySelectorAll('[data-ihr-firma-sevk]').forEach((inp) => {
    blockSevk[inp.getAttribute('data-ihr-firma-sevk')] = String(inp.value || '').trim();
  });
  modal.querySelectorAll('[data-ihr-firma-amb]').forEach((inp) => {
    blockAmb[inp.getAttribute('data-ihr-firma-amb')] = String(inp.value || '').trim();
  });

  modal.querySelectorAll('tr[data-ihr-row-key]').forEach((row) => {
    const key = row.getAttribute('data-ihr-row-key');
    if (!key) return;

    let cur = byKey.get(key);
    const isNew = row.getAttribute('data-ihr-is-new') === '1' || String(key).startsWith('new__');
    if (!cur && isNew) {
      const tbody = row.closest('tbody[data-ihr-tbody]');
      let template = {};
      try {
        template = JSON.parse(tbody?.getAttribute('data-ihr-template') || '{}');
      } catch (e) {}
      cur = {
        ...template,
        id: '',
        sira: '',
        plaka: '',
        _ihracatManual: true,
      };
    }
    if (!cur) return;

    const updated = _ihracatReadRowFields(row, cur, blockSevk, blockAmb);
    if (!updated) return;
    byKey.set(key, updated);
  });

  let deletedKeys = [];
  try { deletedKeys = JSON.parse(modal.dataset.ihrDeletedKeys || '[]'); } catch (e) {}
  deletedKeys.forEach((k) => byKey.delete(k));

  const rows = Array.from(byKey.values());
  const ok = saveDailyShipments(rows, meta);
  if (ok) {
    try {
      purgeStrictExcelCaches();
      rebuildListsFromExcelRows(rows);
      window.refreshHeaderExcelInfo && window.refreshHeaderExcelInfo();
    } catch (e) {}
  }
  return ok;
}

function _ihracatPlateKey(value) {
  const formatted = normPlate(value || '');
  return _plateKeyForMatch(formatted || value);
}

function _ihracatFindVehicleByPlate(plateRaw) {
  const key = _ihracatPlateKey(plateRaw);
  if (!key) return null;
  return (state.vehicles || []).find((v) => {
    const plates = [v.cekiciPlaka, v.dorsePlaka, v.plaka].filter(Boolean);
    return plates.some((p) => _ihracatPlateKey(p) === key);
  }) || null;
}

const IHR_AMBALAJ_GRID_STYLE =
  'display:grid;grid-template-columns:repeat(6,minmax(0,auto));gap:2px 4px;justify-items:center;align-items:center;';
const IHR_AMBALAJ_LABEL_STYLE = 'font-size:9px;color:#64748b;white-space:nowrap;line-height:1.1;text-align:center;';
const IHR_AMBALAJ_INP_STYLE = 'width:28px;min-width:28px;max-width:32px;padding:2px 3px;border:1px solid #cbd5e1;border-radius:4px;font-size:11px;box-sizing:border-box;text-align:center;';
const IHR_AMBALAJ_INP_WIDE_STYLE =
  'width:42px;min-width:42px;max-width:48px;padding:2px 3px;border:1px solid #cbd5e1;border-radius:4px;font-size:11px;box-sizing:border-box;text-align:center;';
const IHR_AMBALAJ_INP_BOS_CUVAL_STYLE = IHR_AMBALAJ_INP_WIDE_STYLE;
const IHR_CUVAL_TRANSFER_BTN_STYLE =
  'width:20px;height:22px;min-width:20px;padding:0;border:1px solid #94a3b8;border-radius:4px;background:#e2e8f0;color:#1e40af;font-size:13px;line-height:1;cursor:pointer;font-weight:700;box-sizing:border-box;';
const IHR_AMBALAJ_TRANSFER_GAP =
  '<span style="font-size:9px;line-height:1.1;" aria-hidden="true">&nbsp;</span>';
const IHR_AMBALAJ_TD_STYLE = 'white-space:nowrap;';
const IHR_AMBALAJ_FIELDS = [
  { key: 'bbt', label: 'BBT' },
  { key: 'bosBbt', label: 'Boş BBT' },
  { key: 'cuval', label: 'Çuval' },
  { key: 'bosCuval', label: 'Boş çuval' },
  { key: 'palet', label: 'Palet' },
];

function _ihracatAmbalajCuvalTransferBtnHtml() {
  return `<button type="button" class="ihr-cuval-transfer" title="Boş çuvalı çuvale taşı ve boş çuvalı sil (takip formuna da yansır)" aria-label="Boş çuvalı çuvale aktar" style="${IHR_CUVAL_TRANSFER_BTN_STYLE}">←</button>`;
}

function _ihracatAmbalajGridHtml(inpStyle, s, opts) {
  const ambInp = inpStyle || IHR_AMBALAJ_INP_STYLE;
  const withTransfer = opts?.withTransfer !== false;
  const v = (f) => escapeHtml(String((s && s[f]) || ''));
  const ambField = (field) =>
    `<input type="text" data-field="${field}" value="${v(field)}" maxlength="${_ihracatAmbalajFieldMaxLen(field)}" inputmode="numeric" style="${_ihracatAmbalajFieldInpStyle(field, ambInp)}" />`;
  const labels = [];
  const inputs = [];
  IHR_AMBALAJ_FIELDS.forEach((f) => {
    labels.push(`<span style="${IHR_AMBALAJ_LABEL_STYLE}">${f.label}</span>`);
    inputs.push(ambField(f.key));
    if (f.key === 'cuval') {
      labels.push(IHR_AMBALAJ_TRANSFER_GAP);
      inputs.push(
        withTransfer
          ? _ihracatAmbalajCuvalTransferBtnHtml()
          : '<span style="width:20px;" aria-hidden="true"></span>'
      );
    }
  });
  return `<div class="ihr-ambalaj-grid" style="${IHR_AMBALAJ_GRID_STYLE}">${labels.join('')}${inputs.join('')}</div>`;
}

function _ihracatAmbalajCellHtml(inpStyle, s) {
  return _ihracatAmbalajGridHtml(inpStyle, s, { withTransfer: true });
}

function _ihracatParseNum(val) {
  const n = Number(String(val ?? '').replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

const IHR_TOPLAM_ROW_BG = '#fffbeb';
const IHR_TOPLAM_INP_STYLE =
  'width:100%;max-width:90px;padding:4px 6px;border:1px solid #cbd5e1;border-radius:6px;font-size:12px;box-sizing:border-box;text-align:left;font-weight:700;background:#fffbeb;color:#0f172a;';
const IHR_TOPLAM_AMB_INP_STYLE =
  'width:28px;min-width:28px;max-width:32px;padding:2px 3px;border:1px solid #cbd5e1;border-radius:4px;font-size:11px;box-sizing:border-box;text-align:center;font-weight:700;background:#fffbeb;color:#0f172a;';
const IHR_TOPLAM_AMB_INP_WIDE_STYLE =
  'width:42px;min-width:42px;max-width:48px;padding:2px 3px;border:1px solid #cbd5e1;border-radius:4px;font-size:11px;box-sizing:border-box;text-align:center;font-weight:700;background:#fffbeb;color:#0f172a;';
const IHR_TOPLAM_AMB_INP_BOS_CUVAL_STYLE = IHR_TOPLAM_AMB_INP_WIDE_STYLE;

function _ihracatAmbalajFieldInpStyle(field, baseStyle) {
  const isToplam = baseStyle === IHR_TOPLAM_AMB_INP_STYLE;
  if (field === 'cuval' || field === 'bosCuval') {
    return isToplam ? IHR_TOPLAM_AMB_INP_WIDE_STYLE : IHR_AMBALAJ_INP_WIDE_STYLE;
  }
  return baseStyle || IHR_AMBALAJ_INP_STYLE;
}

function _ihracatAmbalajFieldMaxLen(field) {
  return field === 'bosCuval' || field === 'cuval' ? 4 : 2;
}

function _ihracatSyncTakipAmbalajFromRow(row) {
  const snap = _ihracatReadRowSnapshot(row);
  if (!snap) return;
  const takipModal = document.getElementById('takipFormuModal');
  if (!takipModal || takipModal.classList.contains('hidden')) return;
  const plateOnForm = normPlate(document.getElementById('cekiciPlakaBilgi')?.value || '');
  if (plateOnForm !== snap.plaka) return;
  const cuvalEl = document.getElementById('cuval');
  const bosCuvalEl = document.getElementById('bosCuval');
  if (cuvalEl) cuvalEl.value = snap.cuval || '';
  if (bosCuvalEl) bosCuvalEl.value = snap.bosCuval || '';
  try {
    const patch = { cuval: snap.cuval || '', bosCuval: snap.bosCuval || '' };
    if (window.__activeExcelShipment && normPlate(window.__activeExcelShipment.plaka) === snap.plaka) {
      window.__activeExcelShipment = { ...window.__activeExcelShipment, ...patch };
    }
    if (window.__lastChosenShipment && normPlate(window.__lastChosenShipment.plaka) === snap.plaka) {
      window.__lastChosenShipment = { ...window.__lastChosenShipment, ...patch };
    }
  } catch (e) {}
}

function _ihracatPersistSingleRowFromModal(row, modal) {
  if (!row || !modal) return false;
  const key = row.getAttribute('data-ihr-row-key');
  if (!key) return false;
  const meta = modal.__ihrMeta || (typeof loadDailyMeta === 'function' ? loadDailyMeta() || {} : {});
  const list = typeof loadDailyShipments === 'function' ? loadDailyShipments() || [] : [];
  const idx = list.findIndex((s) => _ihracatShipmentKey(s) === key);

  const blockSevk = {};
  const blockAmb = {};
  modal.querySelectorAll('[data-ihr-firma-sevk]').forEach((inp) => {
    blockSevk[inp.getAttribute('data-ihr-firma-sevk')] = String(inp.value || '').trim();
  });
  modal.querySelectorAll('[data-ihr-firma-amb]').forEach((inp) => {
    blockAmb[inp.getAttribute('data-ihr-firma-amb')] = String(inp.value || '').trim();
  });

  let cur = idx >= 0 ? { ...list[idx] } : null;
  if (!cur) {
    const tbody = row.closest('tbody[data-ihr-tbody]');
    try {
      cur = { ...JSON.parse(tbody?.getAttribute('data-ihr-template') || '{}'), _ihracatManual: true };
    } catch (e) {
      return false;
    }
  }

  const updated = _ihracatReadRowFields(row, cur, blockSevk, blockAmb);
  if (!updated) return false;

  const next = [...list];
  if (idx >= 0) next[idx] = updated;
  else next.push(updated);

  const ok = typeof saveDailyShipments === 'function' ? saveDailyShipments(next, meta) : false;
  if (ok) {
    try {
      const shipKey = _ihracatShipmentKey(updated);
      if (window.__activeExcelShipment && _ihracatShipmentKey(window.__activeExcelShipment) === shipKey) {
        window.__activeExcelShipment = { ...window.__activeExcelShipment, ...updated };
      }
      purgeStrictExcelCaches();
      rebuildListsFromExcelRows(next);
      window.refreshHeaderExcelInfo && window.refreshHeaderExcelInfo();
    } catch (e) {}
  }
  return ok;
}

function _ihracatTransferBosCuvalToCuval(row, modal) {
  if (!row) return false;
  const bos = row.querySelector('[data-field="bosCuval"]');
  const cuval = row.querySelector('[data-field="cuval"]');
  if (!bos || !cuval) return false;
  const val = String(bos.value || '').trim();
  if (!val) return false;
  cuval.value = val;
  bos.value = '';
  cuval.dispatchEvent(new Event('input', { bubbles: true }));
  cuval.dispatchEvent(new Event('change', { bubbles: true }));
  bos.dispatchEvent(new Event('input', { bubbles: true }));
  bos.dispatchEvent(new Event('change', { bubbles: true }));

  const tbody = row.closest('tbody[data-ihr-tbody]');
  _ihracatRefreshToplamForTbody(tbody);

  const rowKey = row.getAttribute('data-ihr-row-key');
  const detail = row.nextElementSibling;
  if (
    rowKey &&
    detail &&
    detail.classList.contains('ihr-detail-row') &&
    detail.getAttribute('data-ihr-detail-for') === rowKey
  ) {
    detail.remove();
    _ihracatToggleDetailRow(row, modal);
  }

  const modalEl = modal || document.getElementById('ihracatDetailsModal');
  if (modalEl) _ihracatPersistSingleRowFromModal(row, modalEl);
  _ihracatSyncTakipAmbalajFromRow(row);
  return true;
}

function _ihracatBindCuvalTransfer(modal) {
  if (!modal || modal.dataset.ihrCuvalXferBound === '1') return;
  modal.dataset.ihrCuvalXferBound = '1';
  modal.addEventListener('click', (e) => {
    const btn = e.target.closest('.ihr-cuval-transfer');
    if (!btn) return;
    e.preventDefault();
    const row = btn.closest('tr[data-ihr-row-key]');
    if (!row) return;
    if (!_ihracatTransferBosCuvalToCuval(row, modal)) {
      if (typeof showToast === 'function') showToast('Boş çuval alanı boş.', 'info');
    }
  });
}

function _ihracatToplamAmbalajHtml(totals) {
  const sumVal = (key) => {
    const n = _ihracatParseNum(totals && totals[key]);
    return n > 0 ? String(Math.round(n)) : '0';
  };
  const labels = [];
  const inputs = [];
  IHR_AMBALAJ_FIELDS.forEach((f) => {
    labels.push(`<span style="${IHR_AMBALAJ_LABEL_STYLE}">${f.label}</span>`);
    inputs.push(
      `<input type="text" readonly tabindex="-1" aria-readonly="true" data-ihr-sum="${f.key}" value="${escapeHtml(sumVal(f.key))}" style="${_ihracatAmbalajFieldInpStyle(f.key, IHR_TOPLAM_AMB_INP_STYLE)}" />`
    );
    if (f.key === 'cuval') {
      labels.push(IHR_AMBALAJ_TRANSFER_GAP);
      inputs.push('<span style="width:20px;" aria-hidden="true"></span>');
    }
  });
  return `<div class="ihr-ambalaj-grid" style="${IHR_AMBALAJ_GRID_STYLE}">${labels.join('')}${inputs.join('')}</div>`;
}

/** Tablo altı özet satırı — plaka satırı gibi hizalı, "TOPLAM" yazısı yok */
function _ihracatToplamRowHtml(items) {
  const t = _ihracatSumItemsTotals(items || []);
  const tonajShown = escapeHtml(String(t.tonajKg || '0'));
  const td = `border:1px solid #ddd;padding:6px;vertical-align:middle;background:${IHR_TOPLAM_ROW_BG};`;
  return `
    <tr data-ihr-toplam-row="1" style="background:${IHR_TOPLAM_ROW_BG};">
      <td style="${IHR_PLAKA_TD_STYLE}${td}"></td>
      <td style="${td}"></td>
      <td style="${td}"></td>
      <td style="${td}">
        <input type="text" readonly tabindex="-1" aria-readonly="true" data-ihr-sum="tonajKg" value="${tonajShown}" style="${IHR_TOPLAM_INP_STYLE}" />
      </td>
      <td style="${td}${IHR_AMBALAJ_TD_STYLE}">${_ihracatToplamAmbalajHtml(t)}</td>
      <td style="${td}text-align:center;color:#94a3b8;font-size:11px;">—</td>
      <td style="${td}"></td>
      <td style="${td}"></td>
    </tr>`;
}

function _ihracatPrintToplamRowHtml(items) {
  const t = _ihracatSumItemsTotals(items || []);
  const cell = (val) => {
    const raw = String(val ?? '').trim() || '0';
    return `<td style="border:1px solid #000;padding:6px 8px;text-align:center;font-weight:700;background:#fffbeb;">${escapeHtml(raw)}</td>`;
  };
  return `
    <tr class="ihr-print-toplam" style="background:#fffbeb;">
      <td style="border:1px solid #000;padding:6px 8px;background:#fffbeb;"></td>
      <td style="border:1px solid #000;padding:6px 8px;background:#fffbeb;"></td>
      ${cell(t.tonajKg)}
      ${cell(t.bbt)}
      ${cell(t.bosBbt)}
      ${cell(t.cuval)}
      ${cell(t.bosCuval)}
      ${cell(t.palet)}
    </tr>`;
}

function _ihracatSetToplamCell(topRow, key, val) {
  const el = topRow.querySelector(`[data-ihr-sum="${key}"]`);
  if (!el) return;
  const shown = val > 0 ? String(Math.round(val)) : '0';
  if (el.tagName === 'INPUT') el.value = shown;
  else el.textContent = shown;
}

function _ihracatSumRowsInTbody(tbody) {
  const sums = { tonajKg: 0, bbt: 0, bosBbt: 0, cuval: 0, bosCuval: 0, palet: 0 };
  if (!tbody) return sums;
  tbody.querySelectorAll('tr[data-ihr-row-key]').forEach((row) => {
    if (row.getAttribute('data-ihr-is-new') === '1') {
      const plateInp = row.querySelector('[data-field="plaka"]');
      if (!String(plateInp?.value || '').trim() && !row.querySelector('[data-field="plaka-text"]')?.textContent?.trim()) {
        return;
      }
    }
    sums.tonajKg += _ihracatParseNum(row.querySelector('[data-field="tonaj"]')?.value);
    IHR_AMBALAJ_FIELDS.forEach(({ key }) => {
      sums[key] += _ihracatParseNum(row.querySelector(`[data-field="${key}"]`)?.value);
    });
  });
  return sums;
}

function _ihracatRefreshToplamForTbody(tbody) {
  if (!tbody) return;
  const sums = _ihracatSumRowsInTbody(tbody);
  const topRow = tbody.querySelector('tr[data-ihr-toplam-row]');
  if (topRow) {
    _ihracatSetToplamCell(topRow, 'tonajKg', sums.tonajKg);
    IHR_AMBALAJ_FIELDS.forEach(({ key }) => _ihracatSetToplamCell(topRow, key, sums[key]));
  }
  const section = tbody.closest('[data-ihr-block-section]');
  const bbtPaletEl = section?.querySelector('[data-ihr-header-bbt-palet]');
  if (bbtPaletEl && !bbtPaletEl.closest('[data-ihr-footer-is-note]')) {
    const bbt = Math.round(sums.bbt);
    const palet = Math.round(sums.palet);
    if (bbt > 0 || palet > 0) {
      bbtPaletEl.textContent = `${bbt} BBT ${palet} PALET`;
    } else {
      const def = bbtPaletEl.getAttribute('data-ihr-header-bbt-palet-default') || '';
      if (def) bbtPaletEl.textContent = def;
    }
  }
}

function _ihracatBindToplamLiveUpdate(modal) {
  if (!modal || modal.dataset.ihrToplamBound === '1') return;
  modal.dataset.ihrToplamBound = '1';
  const onChange = (e) => {
    const t = e.target;
    if (
      !t ||
      !t.matches(
        '[data-field="tonaj"], [data-field="bbt"], [data-field="bosBbt"], [data-field="cuval"], [data-field="bosCuval"], [data-field="palet"]'
      )
    ) {
      return;
    }
    _ihracatRefreshToplamForTbody(t.closest('tbody[data-ihr-tbody]'));
  };
  modal.addEventListener('input', onChange);
  modal.addEventListener('change', onChange);
  modal.querySelectorAll('tbody[data-ihr-tbody]').forEach(_ihracatRefreshToplamForTbody);
}

function _ihracatStripNewPlateQtyFields(snap) {
  if (!snap || typeof snap !== 'object') return snap;
  return {
    ...snap,
    tonajKg: '',
    bbt: '',
    bosBbt: '',
    cuval: '',
    bosCuval: '',
    palet: '',
    irsaliyeNo: '',
  };
}

function _ihracatClearNewPlateQtyOnRow(row, inpStyle) {
  if (!row) return;
  const style = inpStyle || IHR_AMBALAJ_INP_STYLE;
  const tonajInp = row.querySelector('[data-field="tonaj"]');
  if (tonajInp) {
    tonajInp.value = '';
    tonajInp.removeAttribute('disabled');
  }
  const irsInp = row.querySelector('[data-field="irsaliye"]');
  if (irsInp) {
    irsInp.value = '';
    irsInp.removeAttribute('disabled');
  }
  if (row.cells && row.cells.length >= 5) {
    row.cells[4].innerHTML = _ihracatAmbalajCellHtml(style, null);
    row.cells[4].style.opacity = '1';
  }
}

function _ihracatCopyRowFromPrev(prevRow, targetRow) {
  if (!prevRow || !targetRow) return;
  ['firma', 'malzeme'].forEach((f) => {
    const from = prevRow.querySelector(`[data-field="${f}"]`);
    const to = targetRow.querySelector(`[data-field="${f}"]`);
    if (from && to) {
      to.textContent = from.textContent || '';
      to.style.color = '';
    }
  });
}

const IHR_PLAKA_WRAP_STYLE = 'display:inline-flex;align-items:center;flex-wrap:nowrap;gap:2px;min-width:0;max-width:100%;';
const IHR_PLAKA_INP_STYLE = 'width:92px;max-width:92px;flex:0 1 92px;min-width:0;padding:4px 5px;border:1px solid #cbd5e1;border-radius:6px;font-size:12px;box-sizing:border-box;';
const IHR_PLAKA_INP_ADD_STYLE = 'width:92px;max-width:92px;flex:0 1 92px;min-width:0;padding:4px 5px;border:1px dashed #f59e0b;border-radius:6px;font-size:12px;box-sizing:border-box;';
const IHR_PLAKA_TEXT_STYLE = 'display:inline-block;flex:1 1 auto;min-width:0;max-width:100px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;vertical-align:middle;';
const IHR_PLAKA_TD_STYLE = 'border:1px solid #ddd;padding:4px 6px;white-space:nowrap;width:172px;max-width:172px;overflow:hidden;vertical-align:middle;';

function _ihracatActionBtnsHtml() {
  const btn = 'border:none;background:transparent;cursor:pointer;padding:3px 7px;border-radius:6px;line-height:1;flex-shrink:0;';
  return `<span class="ihr-row-actions" style="display:inline-flex;flex-shrink:0;gap:2px;margin-left:2px;vertical-align:middle;">
    <button type="button" class="ihr-row-edit" title="Plakayı düzenle" style="${btn}color:#2563eb;" onmouseover="this.style.background='#eff6ff'" onmouseout="this.style.background='transparent'"><i class="fas fa-pen" style="font-size:13px;"></i></button>
    <button type="button" class="ihr-row-del" title="Satırı sil" style="${btn}color:#dc2626;" onmouseover="this.style.background='#fef2f2'" onmouseout="this.style.background='transparent'"><i class="fas fa-trash" style="font-size:13px;"></i></button>
  </span>`;
}

function _ihracatPlakaCellHtml(plate, editable, isAddRow) {
  const actions = isAddRow ? '' : _ihracatActionBtnsHtml();
  const p = normPlate(plate || '');
  const inpStyle = isAddRow ? IHR_PLAKA_INP_ADD_STYLE : IHR_PLAKA_INP_STYLE;
  if (editable) {
    return `<span data-ihr-plaka-wrap style="${IHR_PLAKA_WRAP_STYLE}">
      <input type="text" data-field="plaka" value="${escapeHtml(p)}" placeholder="${isAddRow ? 'Yeni plaka…' : ''}" style="${inpStyle}" />
      ${actions}
    </span>`;
  }
  return `<span data-ihr-plaka-wrap style="${IHR_PLAKA_WRAP_STYLE}">
    <span data-field="plaka-text" style="${IHR_PLAKA_TEXT_STYLE}" title="${escapeHtml(p || '')}">${escapeHtml(p || '—')}</span>
    ${actions}
  </span>`;
}

function _ihracatEnsureRowActions(row) {
  if (!row || !row.hasAttribute('data-ihr-row-key')) return;
  const cell = row.cells[0];
  if (!cell || cell.querySelector('.ihr-row-actions')) return;
  const wrap = cell.querySelector('[data-ihr-plaka-wrap]');
  if (wrap) {
    wrap.insertAdjacentHTML('beforeend', _ihracatActionBtnsHtml());
  }
}

function _ihracatPlateCommitReady(raw, normalizePlate) {
  const plate = normalizePlate(raw || '');
  return plate && plate.replace(/\s/g, '').length >= 7;
}

function _ihracatVehicleHasDriver(vehicle) {
  if (!vehicle) return false;
  const n1 = `${vehicle.soforAdi || ''} ${vehicle.soforSoyadi || ''}`.trim();
  const n2 = `${vehicle.sofor2Adi || ''} ${vehicle.sofor2Soyadi || ''}`.trim();
  return !!(n1 || n2 || String(vehicle.iletisim || '').trim() || String(vehicle.tcKimlik || '').trim());
}

function _ihracatDurumPlainText(st, plateRaw) {
  if (st === 'printed') return 'Yazdırıldı';
  const v = _ihracatFindVehicleByPlate(plateRaw);
  if (!v) return 'Kayıt yok';
  if (_ihracatVehicleHasDriver(v)) return 'Şoför var';
  return 'Şoför yok';
}

function _ihracatKayitEtBtnHtml(plate) {
  const p = escapeHtml(normPlate(plate || ''));
  return `<button type="button" class="ihr-kayit-et-btn" data-plate="${p}" style="margin-top:5px;display:block;width:100%;max-width:110px;padding:4px 8px;font-size:10px;background:#4f46e5;color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:600;">Kayıt Et</button>`;
}

function _ihracatScrollToPlate(plateRaw, rowKey) {
  const modal = document.getElementById('ihracatDetailsModal');
  if (!modal) return false;
  let row = null;
  if (rowKey) {
    row = Array.from(modal.querySelectorAll('tr[data-ihr-row-key]')).find(
      (r) => r.getAttribute('data-ihr-row-key') === rowKey
    ) || null;
  }
  if (!row && plateRaw) {
    const key = _ihracatPlateKey(plateRaw);
    row = Array.from(modal.querySelectorAll('tr[data-ihr-row-key]')).find((r) => {
      const p =
        r.querySelector('[data-field="plaka-text"]')?.textContent ||
        r.querySelector('[data-field="plaka"]')?.value ||
        '';
      return key && _ihracatPlateKey(p) === key;
    }) || null;
  }
  if (!row) return false;
  try {
    row.scrollIntoView({ behavior: 'smooth', block: 'center' });
  } catch (e) {
    row.scrollIntoView(true);
  }
  row.style.outline = '3px solid #4f46e5';
  row.style.outlineOffset = '2px';
  setTimeout(() => {
    row.style.outline = '';
    row.style.outlineOffset = '';
  }, 2800);
  return true;
}

function _ihracatShipmentsHasPlate(plateRaw) {
  const key = _ihracatPlateKey(plateRaw);
  if (!key) return false;
  const rows = (typeof loadDailyShipments === 'function') ? (loadDailyShipments() || []) : [];
  return rows.some((s) => _ihracatPlateKey(s.plaka) === key);
}

function _ihracatPersistPendingShipment(ctx) {
  if (!ctx || !ctx.plate) return null;
  const plate = normPlate(ctx.plate);
  if (!plate) return null;
  if (_ihracatShipmentsHasPlate(plate) && !ctx.forceAdd) {
    return null;
  }

  const meta = (typeof loadDailyMeta === 'function') ? (loadDailyMeta() || {}) : {};
  const rows = (typeof loadDailyShipments === 'function') ? (loadDailyShipments() || []).slice() : [];
  const snap = ctx.pendingShipment || {};
  const template = ctx.template || {};
  const gk = _ihracatBlockGroupKey({ ...template, firma: snap.firma || template.firma, ydKey: template.ydKey });

  const isNewPlateRow = !!ctx.forceAdd;
  const newShipment = {
    ...template,
    id: isNewPlateRow ? '' : (normalizeIrsaliyeNo(snap.irsaliyeNo || '') || String(template.id || '').trim()),
    sira: String(template.sira || `M${Date.now()}`),
    plaka: plate,
    firma: (snap.firma && snap.firma !== '—') ? snap.firma : (template.firma || ''),
    malzeme: (snap.malzeme && snap.malzeme !== '—') ? snap.malzeme : (template.malzeme || ''),
    tonajKg: isNewPlateRow ? '' : (snap.tonajKg || template.tonajKg || ''),
    bbt: isNewPlateRow ? '' : (snap.bbt || template.bbt || ''),
    bosBbt: isNewPlateRow ? '' : (snap.bosBbt || template.bosBbt || ''),
    cuval: isNewPlateRow ? '' : (snap.cuval || template.cuval || ''),
    bosCuval: isNewPlateRow ? '' : (snap.bosCuval || template.bosCuval || ''),
    palet: isNewPlateRow ? '' : (snap.palet || template.palet || ''),
    irsaliyeNo: isNewPlateRow ? '' : normalizeIrsaliyeNo(snap.irsaliyeNo || ''),
    sevkYeri: snap.sevkYeri || template.sevkYeri || '',
    ambalaj: isNewPlateRow ? '' : (snap.ambalaj || template.ambalaj || template.ambalajBilgisi || ''),
    ambalajBilgisi: isNewPlateRow ? '' : (snap.ambalaj || template.ambalajBilgisi || ''),
    ydKey: template.ydKey || '',
    headerText: template.headerText || '',
    fileName: template.fileName || meta.fileName || '',
    _ihracatManual: true,
    _ihracatEdited: true,
    _ihracatEditedAt: Date.now(),
  };

  const vehicle = _ihracatFindVehicleByPlate(plate);
  if (vehicle) {
    if (!newShipment.sevkYeri && vehicle.defaultSevkYeri) newShipment.sevkYeri = vehicle.defaultSevkYeri;
  }

  const existingIdx = rows.findIndex((s) => _ihracatPlateKey(s.plaka) === _ihracatPlateKey(plate));
  let savedRow;
  if (existingIdx >= 0) {
    rows[existingIdx] = { ...rows[existingIdx], ...newShipment, plaka: plate };
    savedRow = rows[existingIdx];
  } else {
    rows.push(newShipment);
    savedRow = newShipment;
  }

  const ok = (typeof saveDailyShipments === 'function') ? saveDailyShipments(rows, meta) : false;
  if (ok) {
    try {
      purgeStrictExcelCaches();
      rebuildListsFromExcelRows(rows);
      window.refreshHeaderExcelInfo && window.refreshHeaderExcelInfo();
    } catch (e) {}
  }
  return ok ? _ihracatShipmentKey(savedRow) : null;
}

function _ihracatSnapForKayitRow(row, plateFromBtn) {
  const plate = normPlate(plateFromBtn || '');
  if (!row) return plate ? { plaka: plate } : null;
  let snap = _ihracatReadRowSnapshot(row);
  if (!snap && plate) snap = { plaka: plate };
  else if (snap && plate) snap.plaka = plate;
  if (row.getAttribute('data-ihr-add-row') === '1') {
    const prevRow = row.previousElementSibling;
    if (prevRow && prevRow.hasAttribute('data-ihr-row-key')) {
      const prevSnap = _ihracatReadRowSnapshot(prevRow);
      if (prevSnap) {
        snap = { ...prevSnap, ...(snap || {}), plaka: plate || (snap && snap.plaka) || prevSnap.plaka };
      }
    }
    snap = _ihracatStripNewPlateQtyFields(snap);
  }
  return snap;
}

function _ihracatOpenVehicleRegistration(plateRaw, opts) {
  const plate = normPlate(plateRaw || '');
  if (!plate) {
    showToast('❌ Önce geçerli bir plaka girin.', 'error');
    return;
  }
  const row = opts?.row || null;
  const rowKey = opts?.rowKey || row?.getAttribute('data-ihr-row-key') || '';
  let snap = opts?.snap || (row ? _ihracatReadRowSnapshot(row) : null) || {};

  const isAddRow = row && row.getAttribute('data-ihr-add-row') === '1';
  if (isAddRow) {
    const prevRow = row.previousElementSibling;
    if (prevRow && prevRow.hasAttribute('data-ihr-row-key')) {
      const prevSnap = _ihracatReadRowSnapshot(prevRow);
      if (prevSnap) {
        snap = { ...prevSnap, ...snap, plaka: plate };
      }
    }
    snap = _ihracatStripNewPlateQtyFields(snap);
  }

  const tbody = row?.closest('tbody[data-ihr-tbody]');
  let template = {};
  try {
    template = JSON.parse(tbody?.getAttribute('data-ihr-template') || '{}');
  } catch (e) {}

  const blockSevk = {};
  const blockAmb = {};
  const modal = document.getElementById('ihracatDetailsModal');
  if (modal) {
    modal.querySelectorAll('[data-ihr-firma-sevk]').forEach((inp) => {
      const k = inp.getAttribute('data-ihr-firma-sevk');
      if (k) blockSevk[k] = String(inp.value || '').trim();
    });
    modal.querySelectorAll('[data-ihr-firma-amb]').forEach((inp) => {
      const k = inp.getAttribute('data-ihr-firma-amb');
      if (k) blockAmb[k] = String(inp.value || '').trim();
    });
  }
  const gk = _ihracatBlockGroupKey({ ...template, firma: snap.firma || template.firma, ydKey: template.ydKey });
  if (blockSevk[gk]) snap.sevkYeri = blockSevk[gk];
  if (blockAmb[gk]) {
    snap.ambalaj = blockAmb[gk];
    snap.ambalajBilgisi = blockAmb[gk];
  }

  const forceAdd = isAddRow || !_ihracatShipmentsHasPlate(plate);

  window.__ihracatReturnContext = {
    reopen: true,
    plate,
    rowKey,
    pendingShipment: snap,
    template,
    forceAdd,
  };

  const persistedKey = _ihracatPersistPendingShipment(window.__ihracatReturnContext);
  if (persistedKey) window.__ihracatReturnContext.rowKey = persistedKey;

  document.getElementById('ihracatDetailsModal')?.remove();

  const vehicle = _ihracatFindVehicleByPlate(plate);

  if (vehicle && !_ihracatVehicleHasDriver(vehicle)) {
    if (typeof window.editVehicleRecord === 'function') {
      window.editVehicleRecord(vehicle);
      try {
        if (snap.firma) state.formData.defaultFirma = snap.firma;
        if (snap.malzeme) state.formData.defaultMalzeme = snap.malzeme;
        if (typeof window.renderApp === 'function') window.renderApp();
      } catch (e) {}
      setTimeout(() => {
        try { document.getElementById('soforAdi')?.focus(); } catch (e) {}
      }, 150);
      showToast('Şoför bilgilerini tamamlayıp kaydedin; ardından İhracat listesine dönersiniz.', 'info');
      return;
    }
  }

  if (typeof window.openNewRecordWithPlate === 'function') {
    window.openNewRecordWithPlate(plate);
    try {
      if (snap.firma) state.formData.defaultFirma = snap.firma;
      if (snap.malzeme) state.formData.defaultMalzeme = snap.malzeme;
      if (typeof window.renderApp === 'function') window.renderApp();
    } catch (e) {}
    showToast('➕ Yeni araç kaydı açıldı. Şoför bilgilerini girip kaydedin.', 'info');
    return;
  }

  try {
    state.editingId = null;
    state.showForm = true;
    state.showAll = false;
    state.searchTerm = '';
    state.formData = {
      cekiciPlaka: plate,
      dorsePlaka: '',
      soforAdi: '',
      soforSoyadi: '',
      sofor2Adi: '',
      sofor2Soyadi: '',
      iletisim: '',
      tcKimlik: '',
      defaultFirma: snap.firma || '',
      defaultMalzeme: snap.malzeme || '',
      defaultSevkYeri: '',
      defaultYuklemeNotu: '',
    };
    window.dispatchEvent(new CustomEvent('app:render-request'));
    setTimeout(() => {
      try { document.getElementById('soforAdi')?.focus(); } catch (e) {}
    }, 150);
  } catch (e) {
    showToast('❌ Kayıt formu açılamadı.', 'error');
  }
}

function _ihracatBindKayitEtAndSearch(modal) {
  modal.addEventListener('click', (e) => {
    const regBtn = e.target.closest('.ihr-kayit-et-btn');
    if (regBtn) {
      e.preventDefault();
      const plate = regBtn.getAttribute('data-plate') || '';
      const row = regBtn.closest('tr[data-ihr-row-key], tr[data-ihr-add-row]');
      const rowKey = row?.getAttribute('data-ihr-row-key') || '';
      const snap = _ihracatSnapForKayitRow(row, plate);
      _ihracatOpenVehicleRegistration(plate, { rowKey, snap, row });
    }
  });

  const runSearch = () => {
    const inp = modal.querySelector('#ihracatPlateSearch');
    const q = String(inp?.value || '').trim();
    if (!q) {
      showToast('Plaka yazın veya yapıştırın.', 'warn');
      return;
    }
    const ok = _ihracatScrollToPlate(q, '');
    if (ok) showToast(`✅ Plaka bulundu: ${normPlate(q)}`, 'success');
    else showToast('❌ Bu plaka listede yok (boşluklu/boşluksuz deneyin).', 'warn');
  };

  modal.querySelector('#ihracatPlateSearchBtn')?.addEventListener('click', runSearch);
  modal.querySelector('#ihracatPlateSearch')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      runSearch();
    }
  });
}

function _ihracatMaybeReopenAfterVehicleSave() {
  const ctx = window.__ihracatReturnContext;
  if (!ctx || !ctx.reopen) return;
  const plate = ctx.plate || '';
  let rowKey = ctx.rowKey || '';

  const addedKey = _ihracatPersistPendingShipment(ctx);
  if (addedKey) rowKey = addedKey;

  window.__ihracatReturnContext = null;
  window.__ihracatReopenTarget = { plate, rowKey };
  setTimeout(() => {
    showIhracatDetailsModal();
  }, 300);
}

function _ihracatScrollToReopenTarget() {
  const target = window.__ihracatReopenTarget;
  if (!target || !target.plate) return;
  const tryScroll = (attempt) => {
    const modal = document.getElementById('ihracatDetailsModal');
    if (!modal) {
      if (attempt < 8) setTimeout(() => tryScroll(attempt + 1), 150);
      return;
    }
    if (_ihracatScrollToPlate(target.plate, target.rowKey)) {
      showToast(`✅ ${target.plate} listeye eklendi.`, 'success');
      window.__ihracatReopenTarget = null;
      return;
    }
    if (attempt < 8) setTimeout(() => tryScroll(attempt + 1), 180);
    else {
      showToast('Kayıt tamam. Plakayı üstteki arama kutusundan bulabilirsiniz.', 'info');
      window.__ihracatReopenTarget = null;
    }
  };
  tryScroll(0);
}

function _ihracatRenderDurumHtml(st, plateRaw) {
  const plate = normPlate(plateRaw || '');
  const regBtn = plate ? _ihracatKayitEtBtnHtml(plate) : '';
  if (st === 'printed') {
    return '<span style="display:inline-flex;align-items:center;gap:4px;font-weight:600;color:#991b1b;" title="Yazdırıldı">🖨️ <span style="font-size:11px;">Yazdırıldı</span></span>';
  }
  const v = _ihracatFindVehicleByPlate(plateRaw);
  if (!v) {
    return `<span style="display:flex;flex-direction:column;align-items:flex-start;gap:2px;">
      <span style="display:inline-flex;align-items:center;gap:4px;" title="Sistemde kayıt yok"><span style="font-size:18px;line-height:1;">❌</span><span style="font-size:11px;color:#991b1b;font-weight:600;">Kayıt yok</span></span>
      ${regBtn}
    </span>`;
  }
  if (_ihracatVehicleHasDriver(v)) {
    return '<span style="display:inline-flex;align-items:center;gap:4px;" title="Şoför bilgisi mevcut"><span style="font-size:18px;line-height:1;color:#16a34a;">✅</span><span style="font-size:11px;color:#166534;font-weight:600;">Şoför var</span></span>';
  }
  return `<span style="display:flex;flex-direction:column;align-items:flex-start;gap:2px;">
    <span style="display:inline-flex;align-items:center;gap:4px;" title="Araç kayıtlı, şoför bilgisi eksik"><span style="font-size:18px;line-height:1;">❌</span><span style="font-size:11px;color:#991b1b;font-weight:600;">Şoför yok</span></span>
    ${regBtn}
  </span>`;
}

function _ihracatApplyDurumCell(statusCell, row, plateRaw, statusApi, stOverride) {
  if (!statusCell) return;
  const { normalizePlate, statusForPlate, statusStyle, renderDurumHtml } = statusApi;
  const raw = String(plateRaw || '').trim();
  if (!raw) {
    statusCell.innerHTML = '<span style="font-size:11px;color:#92400e;">Plaka girin</span>';
    statusCell.removeAttribute('data-ihr-durum-text');
    if (row) row.style.cssText = row.getAttribute('data-ihr-add-row') === '1' ? 'background:#fffbeb;color:#92400e;' : (row.style.cssText || '');
    return;
  }
  const plate = normalizePlate(raw);
  if (!plate || plate.replace(/\s/g, '').length < 5) {
    statusCell.innerHTML = '<span style="font-size:11px;color:#92400e;">Kontrol…</span>';
    statusCell.removeAttribute('data-ihr-durum-text');
    return;
  }
  const st = stOverride != null ? stOverride : statusForPlate(raw);
  statusCell.innerHTML = renderDurumHtml(st, raw);
  statusCell.setAttribute('data-ihr-durum-text', _ihracatDurumPlainText(st, raw));
  if (row) {
    row.style.cssText = row.getAttribute('data-ihr-add-row') === '1'
      ? 'background:#fffbeb;color:#92400e;'
      : (statusStyle[st] || '');
  }
}

function _ihracatDeleteShipmentRow(rowKey, plateRaw) {
  const rk = String(rowKey || '').trim();
  const pk = _ihracatPlateKey(plateRaw);
  const rows = (typeof loadDailyShipments === 'function') ? (loadDailyShipments() || []).slice() : [];
  const meta = (typeof loadDailyMeta === 'function') ? (loadDailyMeta() || {}) : {};
  const ephemeralKey = rk.startsWith('new__');
  const next = rows.filter((s) => {
    const sk = _ihracatShipmentKey(s);
    if (rk && sk === rk) return false;
    if (ephemeralKey && pk && _ihracatPlateKey(s.plaka) === pk && (s._ihracatManual || s._ihracatEdited)) return false;
    return true;
  });
  if (next.length === rows.length) return false;
  const ok = (typeof saveDailyShipments === 'function') ? saveDailyShipments(next, meta) : false;
  if (ok) {
    try {
      purgeStrictExcelCaches();
      rebuildListsFromExcelRows(next);
      window.refreshHeaderExcelInfo && window.refreshHeaderExcelInfo();
    } catch (e) {}
  }
  return ok;
}

function _ihracatBindRowActions(modal, statusApi) {
  const { normalizePlate } = statusApi;

  const updateRowStatus = (row, plateRaw) => {
    _ihracatApplyDurumCell(row.querySelector('[data-field="durum"]'), row, plateRaw, statusApi);
  };

  modal.addEventListener('click', (e) => {
    const editBtn = e.target.closest('.ihr-row-edit');
    if (editBtn) {
      e.preventDefault();
      const row = editBtn.closest('tr[data-ihr-row-key]');
      if (!row) return;
      const existingInp = row.querySelector('[data-field="plaka"]');
      if (existingInp) {
        existingInp.focus();
        existingInp.select();
        return;
      }
      const textEl = row.querySelector('[data-field="plaka-text"]');
      if (!textEl) return;
      const wrap = row.querySelector('[data-ihr-plaka-wrap]');
      const plate = textEl.textContent || '';
      wrap.innerHTML = `<input type="text" data-field="plaka" value="${escapeHtml(plate)}" style="${IHR_PLAKA_INP_STYLE}" />${_ihracatActionBtnsHtml()}`;
      const inp = wrap.querySelector('[data-field="plaka"]');
      inp.addEventListener('input', () => updateRowStatus(row, inp.value));
      inp.addEventListener('blur', () => {
        const p = normalizePlate(inp.value);
        if (p) inp.value = p;
        updateRowStatus(row, inp.value);
      });
      inp.focus();
      inp.select();
      return;
    }

    const delBtn = e.target.closest('.ihr-row-del');
    if (delBtn) {
      e.preventDefault();
      const row = delBtn.closest('tr[data-ihr-row-key]');
      if (!row) return;
      const plate =
        row.querySelector('[data-field="plaka-text"]')?.textContent?.trim() ||
        row.querySelector('[data-field="plaka"]')?.value?.trim() ||
        '';
      const msg = plate
        ? `"${plate}" plakalı sevkiyat satırı silinsin mi?`
        : 'Bu sevkiyat satırı silinsin mi?';
      if (!confirm(msg)) return;
      const key = row.getAttribute('data-ihr-row-key');
      if (key) {
        let del = [];
        try { del = JSON.parse(modal.dataset.ihrDeletedKeys || '[]'); } catch (err) {}
        if (!del.includes(key)) del.push(key);
        modal.dataset.ihrDeletedKeys = JSON.stringify(del);
      }
      const detail = row.nextElementSibling;
      if (detail && detail.classList.contains('ihr-detail-row')) detail.remove();
      const tbody = row.closest('tbody[data-ihr-tbody]');
      row.remove();
      _ihracatRefreshToplamForTbody(tbody);
      const saved = _ihracatDeleteShipmentRow(key, plate);
      if (saved) showToast(plate ? `🗑️ ${plate} silindi.` : '🗑️ Satır silindi.', 'success');
      else if (key) showToast('Satır kaldırıldı. Değişiklikleri Kaydet ile de onaylayabilirsiniz.', 'info');
    }
  });
}

function _ihracatTakipBtnHtml() {
  return `<button type="button" class="ihr-takip-btn" style="padding:5px 8px;font-size:11px;background:#2563eb;color:#fff;border:none;border-radius:6px;cursor:pointer;white-space:nowrap;font-weight:600;">Takip Formu</button>`;
}

function _ihracatReadRowSnapshot(row) {
  if (!row) return null;
  const plakaInp = row.querySelector('[data-field="plaka"]');
  const plakaText = row.querySelector('[data-field="plaka-text"]');
  const plaka = plakaInp
    ? normPlate(plakaInp.value)
    : plakaText
      ? normPlate(plakaText.textContent)
      : '';
  if (!plaka) return null;
  const readVal = (sel) => {
    const el = row.querySelector(sel);
    if (!el) return '';
    return 'value' in el ? String(el.value || '').trim() : String(el.textContent || '').trim();
  };
  return {
    plaka,
    firma: readVal('[data-field="firma"]'),
    malzeme: readVal('[data-field="malzeme"]'),
    tonajKg: readVal('[data-field="tonaj"]'),
    bbt: readVal('[data-field="bbt"]'),
    bosBbt: readVal('[data-field="bosBbt"]'),
    cuval: readVal('[data-field="cuval"]'),
    bosCuval: readVal('[data-field="bosCuval"]'),
    palet: readVal('[data-field="palet"]'),
    irsaliyeNo: readVal('[data-field="irsaliye"]'),
    durum: row.querySelector('[data-field="durum"]')?.getAttribute('data-ihr-durum-text') || readVal('[data-field="durum"]'),
  };
}

function _ihracatDetailRowHtml(rowKey, snap, vehicle) {
  const ambParts = [];
  if (snap.bbt) ambParts.push(`BBT: ${snap.bbt}`);
  if (snap.bosBbt) ambParts.push(`Boş BBT: ${snap.bosBbt}`);
  if (snap.cuval) ambParts.push(`Çuval: ${snap.cuval}`);
  if (snap.bosCuval) ambParts.push(`Boş Çuval: ${snap.bosCuval}`);
  if (snap.palet) ambParts.push(`Palet: ${snap.palet}`);
  const amb = ambParts.join(' • ') || '—';

  const sofor1 = vehicle
    ? `${String(vehicle.soforAdi || '').trim()} ${String(vehicle.soforSoyadi || '').trim()}`.trim()
    : '';
  const sofor2 = vehicle
    ? `${String(vehicle.sofor2Adi || '').trim()} ${String(vehicle.sofor2Soyadi || '').trim()}`.trim()
    : '';

  const infoLine = (label, val) => `
    <div style="margin-bottom:6px;font-size:12px;">
      <span style="color:#64748b;">${escapeHtml(label)}:</span>
      <strong style="color:#0f172a;margin-left:4px;">${escapeHtml(val || '—')}</strong>
    </div>`;

  return `
    <tr class="ihr-detail-row" data-ihr-detail-for="${escapeHtml(rowKey)}" style="background:#f1f5f9;">
      <td colspan="8" style="border:1px solid #ddd;padding:0;">
        <div style="padding:12px 14px;border-left:4px solid #2563eb;">
          <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:10px;">
            <strong style="font-size:13px;color:#1e3a8a;">📋 Takip Özeti — ${escapeHtml(snap.plaka)}</strong>
            <button type="button" class="ihr-takip-full-btn" data-ihr-row-key="${escapeHtml(rowKey)}" style="padding:6px 12px;font-size:11px;background:#16a34a;color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:600;">Tam Takip Formunu Aç</button>
          </div>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px;">
            <div style="background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:10px;">
              <div style="font-size:11px;font-weight:700;color:#4338ca;margin-bottom:8px;">SEVKİYAT BİLGİLERİ</div>
              ${infoLine('Firma', snap.firma)}
              ${infoLine('Malzeme', snap.malzeme)}
              ${infoLine('Miktar (Kg)', snap.tonajKg)}
              ${infoLine('Ambalaj', amb)}
              ${infoLine('İrsaliye', snap.irsaliyeNo)}
              ${infoLine('Durum', snap.durum)}
            </div>
            <div style="background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:10px;">
              <div style="font-size:11px;font-weight:700;color:#4338ca;margin-bottom:8px;">ŞOFÖR BİLGİLERİ</div>
              ${vehicle ? infoLine('Çekici', vehicle.cekiciPlaka || snap.plaka) : infoLine('Çekici', snap.plaka)}
              ${vehicle && vehicle.dorsePlaka ? infoLine('Dorse', vehicle.dorsePlaka) : ''}
              ${infoLine('Şoför 1', sofor1 || 'Kayıt yok')}
              ${sofor2 ? infoLine('Şoför 2', sofor2) : ''}
              ${infoLine('Telefon', vehicle?.iletisim || '—')}
              ${infoLine('TC Kimlik', vehicle?.tcKimlik || '—')}
              ${!vehicle ? '<div style="font-size:11px;color:#b45309;margin-top:6px;">Bu plaka henüz sisteme kayıtlı değil. Tam formdan kayıt açabilirsiniz.</div>' : ''}
            </div>
          </div>
        </div>
      </td>
    </tr>
  `;
}

function _ihracatToggleDetailRow(row, modal) {
  if (!row || !row.hasAttribute('data-ihr-row-key')) return;
  const key = row.getAttribute('data-ihr-row-key');
  const tbody = row.closest('tbody');
  const next = row.nextElementSibling;
  if (next && next.classList.contains('ihr-detail-row') && next.getAttribute('data-ihr-detail-for') === key) {
    next.remove();
    return;
  }
  tbody?.querySelectorAll('tr.ihr-detail-row').forEach((r) => r.remove());

  const snap = _ihracatReadRowSnapshot(row);
  if (!snap) {
    showToast('❌ Önce geçerli bir plaka girin.');
    return;
  }
  const vehicle = _ihracatFindVehicleByPlate(snap.plaka);
  row.insertAdjacentHTML('afterend', _ihracatDetailRowHtml(key, snap, vehicle));
}

function _ihracatBuildShipmentFromDetailRow(row, modal) {
  const snap = _ihracatReadRowSnapshot(row);
  if (!snap) return null;
  const section = row.closest('[data-ihr-block-section]');
  const sevk = String(section?.querySelector('[data-ihr-firma-sevk]')?.value || '').trim();
  const amb = String(section?.querySelector('[data-ihr-firma-amb]')?.value || '').trim();
  let template = {};
  try {
    const tbody = row.closest('tbody[data-ihr-tbody]');
    template = JSON.parse(tbody?.getAttribute('data-ihr-template') || '{}');
  } catch (e) {}
  const irs = normalizeIrsaliyeNo(snap.irsaliyeNo || template.irsaliyeNo || '');
  return {
    ...template,
    plaka: snap.plaka,
    firma: snap.firma || template.firma || '',
    malzeme: snap.malzeme || template.malzeme || '',
    tonajKg: snap.tonajKg,
    bbt: snap.bbt,
    bosBbt: snap.bosBbt,
    cuval: snap.cuval,
    bosCuval: snap.bosCuval,
    palet: snap.palet,
    irsaliyeNo: irs,
    id: irs || template.id || '',
    sevkYeri: sevk || template.sevkYeri || '',
    ambalaj: amb || template.ambalaj || '',
    ambalajBilgisi: amb || template.ambalajBilgisi || '',
    _ihracatEdited: true,
  };
}

function _ihracatParkDetailsModal(modalEl) {
  const modal = modalEl || document.getElementById('ihracatDetailsModal');
  if (!modal) return;
  window.__ihracatParkedDetailsModal = modal;
  modal.style.visibility = 'hidden';
  modal.style.pointerEvents = 'none';
}

function _ihracatRestoreParkedDetailsModal() {
  const modal = window.__ihracatParkedDetailsModal;
  window.__ihracatParkedDetailsModal = null;
  if (!modal || !modal.isConnected) return;
  modal.style.visibility = '';
  modal.style.pointerEvents = '';
}
window._ihracatRestoreParkedDetailsModal = _ihracatRestoreParkedDetailsModal;

async function _ihracatOpenFullTakipFromRow(row, modal) {
  const snap = _ihracatReadRowSnapshot(row);
  if (!snap) {
    showToast('❌ Önce geçerli bir plaka girin.');
    return;
  }
  const prefilled = _ihracatBuildShipmentFromDetailRow(row, modal);
  let vehicle = _ihracatFindVehicleByPlate(snap.plaka);
  if (!vehicle) {
    vehicle = {
      id: 'manual',
      cekiciPlaka: snap.plaka,
      dorsePlaka: '',
      soforAdi: '',
      soforSoyadi: '',
      sofor2Adi: '',
      sofor2Soyadi: '',
      iletisim: '',
      tcKimlik: '',
      defaultFirma: snap.firma || '',
      defaultMalzeme: snap.malzeme || '',
      defaultSevkYeri: '',
      defaultYuklemeNotu: '',
    };
  } else {
    vehicle = {
      ...vehicle,
      cekiciPlaka: snap.plaka || vehicle.cekiciPlaka,
      defaultFirma: snap.firma || vehicle.defaultFirma || '',
      defaultMalzeme: snap.malzeme || vehicle.defaultMalzeme || '',
    };
  }
  vehicle._ihracatTakipApplyOpts = {
    prefilledShipment: prefilled,
    skipExcelReview: true,
  };
  _ihracatParkDetailsModal(modal);
  showTakipFormu(vehicle);
  const takipModal = document.getElementById('takipFormuModal');
  if (takipModal) {
    takipModal.style.zIndex = '10050';
  }
}

function _ihracatBindTakipPanel(modal) {
  modal.addEventListener('click', (e) => {
    const fullBtn = e.target.closest('.ihr-takip-full-btn');
    if (fullBtn) {
      e.preventDefault();
      const detailRow = fullBtn.closest('tr.ihr-detail-row');
      const key = fullBtn.getAttribute('data-ihr-row-key');
      let row = null;
      if (detailRow && detailRow.previousElementSibling?.getAttribute('data-ihr-row-key') === key) {
        row = detailRow.previousElementSibling;
      } else if (key) {
        row = Array.from(modal.querySelectorAll('tr[data-ihr-row-key]')).find(
          (r) => r.getAttribute('data-ihr-row-key') === key
        ) || null;
      }
      if (row) _ihracatOpenFullTakipFromRow(row, modal);
      return;
    }
    const btn = e.target.closest('.ihr-takip-btn');
    if (!btn) return;
    e.preventDefault();
    const row = btn.closest('tr[data-ihr-row-key]');
    if (row) _ihracatToggleDetailRow(row, modal);
  });
}

function _ihracatBindModalPlateAdd(modal, statusApi) {
  const { normalizePlate } = statusApi;

  const updateRowStatus = (row, plateRaw) => {
    _ihracatApplyDurumCell(row.querySelector('[data-field="durum"]'), row, plateRaw, statusApi);
  };

  const bindAddRow = (row, commitFn) => {
    const plakaInp = row.querySelector('[data-field="plaka"]');
    if (!plakaInp) return;
    plakaInp.addEventListener('input', () => {
      updateRowStatus(row, plakaInp.value);
    });
    plakaInp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        commitFn(row);
      }
    });
    plakaInp.addEventListener('blur', (e) => {
      const rt = e.relatedTarget;
      if (rt && row.contains(rt)) return;
      commitFn(row);
    });
  };

  const rowInpStyle = 'width:100%;max-width:72px;padding:4px 6px;border:1px solid #cbd5e1;border-radius:6px;font-size:12px;box-sizing:border-box;';

  const onPlateCommit = (row) => {
    if (!row || row.getAttribute('data-ihr-add-row') !== '1') return;
    const plakaInp = row.querySelector('[data-field="plaka"]');
    const raw = plakaInp?.value || '';
    if (!_ihracatPlateCommitReady(raw, normalizePlate)) return;
    const plate = normalizePlate(raw);

    const tbody = row.closest('tbody[data-ihr-tbody]');
    const prevRow = row.previousElementSibling;
    if (prevRow && prevRow.hasAttribute('data-ihr-row-key')) {
      _ihracatCopyRowFromPrev(prevRow, row);
    }
    _ihracatClearNewPlateQtyOnRow(row, rowInpStyle);

    const gk = tbody?.getAttribute('data-ihr-firma-group') || 'GENEL';
    const newKey = `new__${gk}__${Date.now()}`;
    row.setAttribute('data-ihr-row-key', newKey);
    row.setAttribute('data-ihr-is-new', '1');
    row.removeAttribute('data-ihr-add-row');

    if (row.cells[0]) {
      row.cells[0].innerHTML = _ihracatPlakaCellHtml(plate, false, false);
    }

    updateRowStatus(row, plate);

    let template = {};
    try {
      template = JSON.parse(tbody?.getAttribute('data-ihr-template') || '{}');
    } catch (e) {}
    const snap = _ihracatStripNewPlateQtyFields(_ihracatReadRowSnapshot(row));
    const storedKey = _ihracatPersistPendingShipment({
      plate,
      rowKey: newKey,
      pendingShipment: snap,
      template,
      forceAdd: true,
    });
    if (storedKey) row.setAttribute('data-ihr-row-key', storedKey);

    _ihracatRefreshToplamForTbody(tbody);

    const addRowMarkup = `
      <tr data-ihr-add-row="1" style="background:#fffbeb;color:#92400e;">
        <td style="${IHR_PLAKA_TD_STYLE}">${_ihracatPlakaCellHtml('', true, true)}</td>
        <td data-field="firma" style="border:1px solid #ddd;padding:6px;font-size:11px;color:#94a3b8;">—</td>
        <td data-field="malzeme" style="border:1px solid #ddd;padding:6px;color:#94a3b8;">—</td>
        <td style="border:1px solid #ddd;padding:6px;"><input type="text" data-field="tonaj" value="" style="${rowInpStyle}max-width:90px;" disabled /></td>
        <td style="border:1px solid #ddd;padding:6px;opacity:0.5;"><span style="font-size:11px;">Firma ve malzeme üst satırdan kopyalanır</span></td>
        <td style="border:1px solid #ddd;padding:4px;text-align:center;color:#94a3b8;font-size:11px;">—</td>
        <td style="border:1px solid #ddd;padding:6px;"><input type="text" data-field="irsaliye" value="" style="${rowInpStyle}max-width:130px;" disabled /></td>
        <td data-field="durum" style="border:1px solid #ddd;padding:6px;font-size:11px;">Plaka girin</td>
      </tr>
    `;
    const topRow = tbody?.querySelector('tr[data-ihr-toplam-row]');
    if (topRow) topRow.insertAdjacentHTML('beforebegin', addRowMarkup);
    else tbody?.insertAdjacentHTML('beforeend', addRowMarkup);
    const newAdd = tbody?.querySelector('tr[data-ihr-add-row]:last-of-type');
    if (newAdd) bindAddRow(newAdd, onPlateCommit);
    _ihracatRefreshToplamForTbody(tbody);
  };

  modal.querySelectorAll('tr[data-ihr-add-row]').forEach((row) => bindAddRow(row, onPlateCommit));
}

function _ihracatPad2(n) {
  return String(n).padStart(2, '0');
}

/** Yazdırma anı, Excel meta ile uyumlu mu (yeniden yüklemede aynı gün yazdırmalar korunur). */
function _ihracatPrintSnapValidForMeta(snapTs, meta) {
  const ts = Number(snapTs);
  if (!Number.isFinite(ts) || ts <= 0) return false;
  const importTimestamp = Number(new Date(meta?.importedAt || 0));
  if (!importTimestamp || ts >= importTimestamp) return true;
  const dateKey = String(_resolveIhracatDateKey(meta) || meta?.dateKey || '').trim();
  if (!dateKey || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return false;
  try {
    const printDay = new Date(ts).toLocaleDateString('sv-SE', { timeZone: 'Europe/Istanbul' });
    return printDay === dateKey;
  } catch (e) {
    return false;
  }
}

/** Takip formundan yazdırılmış / çıkış yapmış plaka (araç veya rapor kaydı). */
function _ihracatPlateHasCheckout(plateRaw, meta) {
  const key = _ihracatPlateKey(plateRaw);
  if (!key) return false;

  if (window.__ihracatRemotePrintCache?.loaded) {
    for (const r of _ihracatGetPrintReports()) {
      const d = r.data || {};
      const plates = [d.plaka, d.plate, r.plaka, d.cekiciPlaka, d.dorsePlaka];
      for (const raw of plates) {
        const p = normPlate(raw || '');
        if (p && _ihracatPlateKey(p) === key) return true;
      }
    }
    return false;
  }

  const v = _ihracatFindVehicleByPlate(plateRaw);
  if (v && (Number(v.printCount || 0) || 0) > 0) {
    const snap = v.lastPrintSnapshot || {};
    const snapTs = Number(snap.ts || snap.timestamp || 0);
    if (!_ihracatPrintSnapValidForMeta(snapTs, meta)) return false;
    const pk = _ihracatPlateKey;
    const snapKeys = new Set();
    [snap.plaka, snap.cekiciPlaka, snap.dorsePlaka, snap.plate].forEach((raw) => {
      const k = pk(raw);
      if (k) snapKeys.add(k);
    });
    const currentKeys = new Set();
    [v.cekiciPlaka, v.dorsePlaka, v.plaka].forEach((raw) => {
      const k = pk(raw);
      if (k) currentKeys.add(k);
    });
    return [...snapKeys].some((k) => currentKeys.has(k) && k === key);
  }

  try {
    for (const r of _ihracatGetPrintReports()) {
      if (!r || String(r.type || '').toUpperCase() !== 'PRINT') continue;
      const d = r.data || {};
      const plates = [d.plaka, d.plate, r.plaka, d.cekiciPlaka, d.dorsePlaka];
      for (const raw of plates) {
        const p = normPlate(raw || '');
        if (p && _ihracatPlateKey(p) === key) return true;
      }
    }
  } catch (e) { /* ignore */ }
  return false;
}

/** Yazdırma: yalnızca takip formundan çıkış yapan plakalar işaretlenir. */
function _ihracatRowHasCheckout(row, updated, cur, statusApi, meta) {
  const plate = updated.plaka;
  const cellText = String(row.querySelector('[data-field="durum"]')?.getAttribute('data-ihr-durum-text') || '').trim();
  return (
    cur._status === 'printed' ||
    statusApi.statusForPlate(plate) === 'printed' ||
    _ihracatPlateHasCheckout(plate, meta) ||
    /yazdır/i.test(cellText)
  );
}

/** Modaldeki güncel değerleri yazdırma için topla (Kaydet gerekmez). */
function _ihracatCollectModalRowsForPrint(modal, originalShipments, statusApi, meta) {
  if (!modal) return [];
  const blockSevk = {};
  const blockAmb = {};
  modal.querySelectorAll('[data-ihr-firma-sevk]').forEach((inp) => {
    blockSevk[inp.getAttribute('data-ihr-firma-sevk')] = String(inp.value || '').trim();
  });
  modal.querySelectorAll('[data-ihr-firma-amb]').forEach((inp) => {
    blockAmb[inp.getAttribute('data-ihr-firma-amb')] = String(inp.value || '').trim();
  });

  const byKey = new Map();
  (originalShipments || []).forEach((s) => {
    byKey.set(_ihracatShipmentKey(s), { ...s });
  });

  const rows = [];
  let domOrder = 0;
  modal.querySelectorAll('tr[data-ihr-row-key]').forEach((row) => {
    const key = row.getAttribute('data-ihr-row-key');
    if (!key) return;
    let cur = byKey.get(key);
    const isNew = row.getAttribute('data-ihr-is-new') === '1' || String(key).startsWith('new__');
    if (!cur && isNew) {
      const tbody = row.closest('tbody[data-ihr-tbody]');
      let template = {};
      try {
        template = JSON.parse(tbody?.getAttribute('data-ihr-template') || '{}');
      } catch (e) {}
      cur = { ...template, _ihracatManual: true };
    }
    if (!cur) cur = {};
    else cur = { ...cur };

    const updated = _ihracatReadRowFields(row, cur, blockSevk, blockAmb);
    if (!updated) return;

    const gk = _ihracatBlockGroupKey(updated);
    const hasCikis = _ihracatRowHasCheckout(row, updated, cur, statusApi, meta);
    const durumText = hasCikis ? 'Çıkış yaptı' : '';
    const st = hasCikis ? 'printed' : statusApi.statusForPlate(updated.plaka);

    rows.push({
      ...updated,
      _domOrder: domOrder++,
      _status: st,
      _durumText: durumText,
      _blockSevk: blockSevk[gk] || updated.sevkYeri || '',
      _blockAmb: blockAmb[gk] || updated.ambalaj || updated.ambalajBilgisi || '',
    });
  });
  return rows;
}

function _ihracatFirmaMatchesExcel(firmaRaw, excelFirma) {
  const fa = String(firmaRaw || '').trim().toUpperCase();
  const fb = String(excelFirma || '').trim().toUpperCase();
  if (!fa || !fb) return false;
  if (fa === fb) return true;
  const ya = (fa.match(/\b(YD\d{1,4})\b/i) || [])[1];
  const yb = (fb.match(/\b(YD\d{1,4})\b/i) || [])[1];
  if (ya && yb && ya === yb) return true;
  return fa.includes(fb) || fb.includes(fa);
}

/** Sunucudaki yazdırma kayıtları (/api/reports = print_history). F5 sonrası localStorage yetmez. */
window.__ihracatRemotePrintCache = window.__ihracatRemotePrintCache || { ts: 0, reports: [], loading: null, loaded: false };

function _ihracatInvalidatePrintReportsCache() {
  const cache = window.__ihracatRemotePrintCache;
  if (!cache) return;
  cache.ts = 0;
  cache.loaded = false;
  cache.reports = [];
  cache.loading = null;
}
window._ihracatInvalidatePrintReportsCache = _ihracatInvalidatePrintReportsCache;

async function _ihracatFetchRemotePrintReports(force) {
  const cache = window.__ihracatRemotePrintCache;
  const now = Date.now();
  if (!force && cache.loaded && (now - cache.ts) < 45000) {
    return cache.reports;
  }
  if (cache.loading) {
    try { return await cache.loading; } catch (e) { return cache.reports; }
  }
  cache.loading = (async () => {
    try {
      const r = await fetch('/api/reports?limit=2000&_=' + now, {
        method: 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' },
      });
      if (r.ok) {
        const data = await r.json();
        cache.reports = Array.isArray(data) ? data : [];
        cache.ts = Date.now();
        cache.loaded = true;
      }
    } catch (e) {
      console.warn('İhracat yazdırma listesi alınamadı:', e);
    } finally {
      cache.loading = null;
    }
    return cache.reports;
  })();
  try { return await cache.loading; } catch (e) { return cache.reports; }
}
window._ihracatFetchRemotePrintReports = _ihracatFetchRemotePrintReports;

/** Yazdırma olayları — sunucu listesi tek kaynak; offline ise localStorage yedek. */
function _ihracatGetPrintReports() {
  const cache = window.__ihracatRemotePrintCache || {};
  const isPrint = (r) => r && String(r.type || '').toUpperCase() === 'PRINT';

  if (cache.loaded) {
    return (cache.reports || []).filter(isPrint);
  }

  const merged = [];
  const seen = new Set();
  const push = (r) => {
    if (!isPrint(r)) return;
    const data = r.data || {};
    const id = String(r.id || `${r.ts || 0}__${data.plaka || r.plaka || ''}`);
    if (seen.has(id)) return;
    seen.add(id);
    merged.push(r);
  };
  try {
    (cache.reports || []).forEach(push);
    if (state.reports && Array.isArray(state.reports) && state.reports.length) {
      state.reports.forEach(push);
    } else if (window.Report && typeof window.Report.getEvents === 'function') {
      (window.Report.getEvents() || []).forEach(push);
    }
  } catch (e) { /* ignore */ }
  return merged;
}

function _ihracatReportMatchesExcelFirmalar(report, firmalar) {
  if (!(firmalar instanceof Set) || firmalar.size === 0) return true;
  const data = (report && report.data) || {};
  const firma = String(report.firma || data.firma || data.firmaKodu || data.firmaSelect || '').trim();
  if (!firma) return true;
  for (const ef of firmalar) {
    if (_ihracatFirmaMatchesExcel(firma, ef)) return true;
  }
  return false;
}

/** Rapor / sunucu yazdırma kayıtlarından plaka başına yazdırma adedi. */
function _ihracatCollectReportPrintCountsByPlate(meta, excelFirmalar) {
  const map = new Map();
  const pk = (value) => _ihracatPlateKey(value);
  const firmalar = excelFirmalar instanceof Set ? excelFirmalar : new Set();
  const twoDaysAgo = Date.now() - 2 * 24 * 60 * 60 * 1000;

  _ihracatGetPrintReports().forEach((r) => {
    const ts = Number(r.ts || (r.data && r.data.ts) || 0);
    if (Number.isFinite(ts) && ts > 0 && ts < twoDaysAgo) return;
    if (!_ihracatReportMatchesExcelFirmalar(r, firmalar)) return;

    const data = r.data || {};
    const raw = data.plaka || data.plate || r.plaka || data.cekiciPlaka || data.dorsePlaka || '';
    const k = pk(raw);
    if (!k) return;
    map.set(k, (map.get(k) || 0) + 1);
  });

  return map;
}

/** Takip formu yazdırılmış; Excel satırında olmayan plakaları yazdırmaya ekle. */
function _ihracatCollectPrintedExitRows(shipments, meta, existingRows) {
  const excelFirmalar = [];
  const seenFirma = new Set();
  (shipments || []).forEach((s) => {
    const f = String(s.firma || '').trim();
    if (f && !seenFirma.has(f)) {
      seenFirma.add(f);
      excelFirmalar.push(f);
    }
  });
  if (!excelFirmalar.length) return [];

  const plateKeys = new Set((existingRows || []).map((r) => _ihracatPlateKey(r.plaka)).filter(Boolean));
  const addedKeys = new Set();
  const out = [];

  const pushExit = (plateRaw, firmaRaw, data) => {
    const plate = normPlate(plateRaw || '');
    const pKey = _ihracatPlateKey(plate);
    if (!pKey || plateKeys.has(pKey) || addedKeys.has(pKey)) return;

    const matchedFirma = excelFirmalar.find((ef) => _ihracatFirmaMatchesExcel(firmaRaw, ef));
    if (!matchedFirma) return;

    const template = (shipments || []).find((s) => _ihracatFirmaMatchesExcel(s.firma, matchedFirma)) || {};
    addedKeys.add(pKey);
    plateKeys.add(pKey);
    out.push({
      plaka: plate,
      firma: matchedFirma,
      malzeme: String(data.malzeme || data.malzemeSelect || template.malzeme || '').trim(),
      tonajKg: String(data.tonaj || data.tonajKg || '').trim(),
      bbt: String(data.bbt || '').trim(),
      bosBbt: String(data.bosBbt || '').trim(),
      cuval: String(data.cuval || '').trim(),
      bosCuval: String(data.bosCuval || '').trim(),
      palet: String(data.palet || '').trim(),
      fileName: String(template.fileName || meta?.fileName || '').trim(),
      headerText: template.headerText || '',
      ydKey: template.ydKey || '',
      _status: 'printed',
      _cikisYapti: true,
      _fromTakipPrint: true,
    });
  };

  (state.vehicles || []).forEach((v) => {
    const snap = v.lastPrintSnapshot;
    const snapTs = Number(snap?.ts || snap?.timestamp || 0);
    if (!Number.isFinite(snapTs) || snapTs <= 0) return;
    if (!_ihracatPrintSnapValidForMeta(snapTs, meta)) return;
    if ((Number(v.printCount || 0) || 0) <= 0) return;
    const firma = snap.firmaKodu || snap.firmaSelect || v.defaultFirma || '';
    const payload = { ...snap, malzeme: snap.malzeme || v.defaultMalzeme };
    pushExit(v.cekiciPlaka, firma, payload);
    if (v.dorsePlaka && _ihracatPlateKey(v.dorsePlaka) !== _ihracatPlateKey(v.cekiciPlaka)) {
      pushExit(v.dorsePlaka, firma, payload);
    }
  });

  try {
    _ihracatGetPrintReports()
      .filter((r) => r && String(r.type || '').toUpperCase() === 'PRINT')
      .forEach((r) => {
        const d = r.data || {};
        const firma = d.firma || d.firmaKodu || d.firmaSelect || r.firma || '';
        pushExit(d.plaka || d.plate || r.plaka || d.cekiciPlaka, firma, d);
      });
  } catch (e) {
    console.warn('Yazdırılmış plaka listesi okunamadı:', e);
  }

  return out;
}

/** Yazdırma = modalde görünen satırlar (WYSIWYG); ek plaka / sıra değişikliği yok. */
function _ihracatPrepareRowsForPrint(modal, shipments, meta, statusApi) {
  return _ihracatCollectModalRowsForPrint(modal, shipments, statusApi, meta);
}

function _ihracatGroupPrintRows(rows, meta) {
  const files = [];
  const grouped = {};
  (rows || []).forEach((r) => {
    const fileLabel = String(r.fileName || meta?.fileName || '').trim() || 'Excel';
    const firma = String(r.firma || '').trim() || 'Bilinmiyor';
    if (!grouped[fileLabel]) grouped[fileLabel] = {};
    if (!grouped[fileLabel][firma]) grouped[fileLabel][firma] = [];
    grouped[fileLabel][firma].push(r);
    if (!files.includes(fileLabel)) files.push(fileLabel);
  });
  if (!files.length) files.push('Excel');
  return { files, grouped };
}

/** Yazdırma: plaka sayısına göre blok sıkıştırma (sayfada bölünmesin diye) */
function _ihracatPrintFirmaSizeClass(plakaCount) {
  const n = Number(plakaCount) || 0;
  if (n > 14) return 'ihr-print-firma--xs';
  if (n > 9) return 'ihr-print-firma--sm';
  if (n > 6) return 'ihr-print-firma--md';
  return '';
}

function _printIhracatDetailsFromModal(modal, ctx) {
  const { shipments, meta, ihracatStatusApi } = ctx || {};
  const rows = _ihracatPrepareRowsForPrint(modal, shipments, meta, ihracatStatusApi);
  if (!rows.length) {
    alert('Yazdırılacak sevkiyat satırı yok.');
    return;
  }
  const cikisCount = rows.filter((r) => r._status === 'printed').length;

  const tarih = meta?.dateKey
    ? meta.dateKey.replace(/(\d{4})-(\d{2})-(\d{2})/, '$3.$2.$1')
    : '';
  const now = new Date();
  const printedAt = `${_ihracatPad2(now.getDate())}.${_ihracatPad2(now.getMonth() + 1)}.${now.getFullYear()} ${_ihracatPad2(now.getHours())}:${_ihracatPad2(now.getMinutes())}`;
  const { files, grouped } = _ihracatGroupPrintRows(rows, meta);

  const cell = (val, cls) => {
    const t = String(val ?? '').trim();
    return `<td class="${cls || ''}">${t ? escapeHtml(t) : '—'}</td>`;
  };

  const plakaCellHtml = (r) => {
    const plate = String(r.plaka || '').trim();
    const durum = String(r._durumText || '').trim();
    return `<td class="c-plaka">${plate ? escapeHtml(plate) : '—'}${
      durum ? `<div class="c-durum">${escapeHtml(durum)}</div>` : ''
    }</td>`;
  };

  const printRowHtml = (r) => `<tr${r._status === 'printed' ? ' class="row-printed"' : ''}>
      ${plakaCellHtml(r)}
      ${cell(r.malzeme, 'c-malzeme')}
      ${cell(r.tonajKg, 'c-num')}
      ${cell(r.bbt, 'c-num c-bbt')}
      ${cell(r.bosBbt, 'c-num')}
      ${cell(r.cuval, 'c-num')}
      ${cell(r.bosCuval, 'c-num')}
      ${cell(r.palet, 'c-num')}
    </tr>`;

  const blockSectionHtml = (sectionTitle, items) => {
    const sortedItems = [...items].sort(
      (a, b) => (a._domOrder ?? 0) - (b._domOrder ?? 0)
    );
    const sample = sortedItems[0] || {};
    const sevk = String(sample._blockSevk || sample.sevkYeri || '').trim();
    const amb = String(sample._blockAmb || sample.ambalaj || sample.ambalajBilgisi || '').trim();
    const malzeme = String(sample.malzeme || '').trim();
    const firmaCikis = sortedItems.filter((it) => it._status === 'printed').length;
    const excelDescHtml = _ihracatRenderExcelBlockHeader(sample, sortedItems);
    const printToplamHtml = _ihracatPrintToplamRowHtml(sortedItems);
    const sizeCls = _ihracatPrintFirmaSizeClass(sortedItems.length);
    return `
      <div class="ihr-print-block-unit ihr-print-firma ${sizeCls}">
        <div class="ihr-print-firma-head">
          <strong>${escapeHtml(sectionTitle)}</strong>
          <span class="ihr-print-firma-meta">${sortedItems.length} plaka${firmaCikis ? ` · ${firmaCikis} çıkış yaptı` : ''}</span>
        </div>
        <div class="ihr-print-excel-box">${excelDescHtml}</div>
        <div class="ihr-print-block-fields">
          <div class="ihr-print-field"><span class="ihr-print-label">Ambalaj bilgisi</span><span class="ihr-print-value">${amb ? escapeHtml(amb) : '—'}</span></div>
          <div class="ihr-print-field"><span class="ihr-print-label">Sevk yeri</span><span class="ihr-print-value">${sevk ? escapeHtml(sevk) : '—'}</span></div>
        </div>
        <div class="ihr-print-table-shell">
        <table class="ihr-print-plaka-table">
          <colgroup>
            <col style="width:14%"><col style="width:22%"><col style="width:8%">
            <col style="width:9%"><col style="width:9%"><col style="width:9%"><col style="width:9%"><col style="width:9%">
          </colgroup>
          <thead>
            <tr>
              <th>Plaka</th>
              <th>Malzeme</th>
              <th>Kg</th>
              <th>BBT</th>
              <th>Boş BBT</th>
              <th>Çuval</th>
              <th>Boş çuval</th>
              <th>Palet</th>
            </tr>
          </thead>
          <tbody>${sortedItems.map(printRowHtml).join('')}${printToplamHtml}</tbody>
        </table>
        </div>
      </div>`;
  };

  const fileSectionHtml = (fileLabel) => {
    const firmas = grouped[fileLabel] || {};
    const blockGroups = {};
    Object.keys(firmas).forEach((firmaKey) => {
      (firmas[firmaKey] || []).forEach((item) => {
        const bk = _ihracatBlockGroupKey(item);
        if (!blockGroups[bk]) {
          blockGroups[bk] = {
            title: _ihracatShortBlockTitle(item.headerText, item.malzeme) || firmaKey,
            items: [],
          };
        }
        blockGroups[bk].items.push(item);
      });
    });
    const blockOrder = Object.keys(blockGroups).sort((a, b) => {
      const ra = Number(blockGroups[a].items[0]?.blockHeaderRow) || 0;
      const rb = Number(blockGroups[b].items[0]?.blockHeaderRow) || 0;
      return ra - rb;
    });
    const fileCount = blockOrder.reduce((n, bk) => n + (blockGroups[bk].items?.length || 0), 0);
    const blockCount = blockOrder.length;
    const pairOnPage =
      blockCount === 2 &&
      blockOrder.every((bk) => (blockGroups[bk].items?.length || 0) <= 8);
    const fileCls = [
      'ihr-print-file',
      blockCount >= 2 ? 'ihr-print-file--multi' : '',
      pairOnPage ? 'ihr-print-file--pair' : '',
    ]
      .filter(Boolean)
      .join(' ');
    return `
      <div class="${fileCls}">
        <h2>${escapeHtml(fileLabel)} <span class="ihr-print-file-count">(${fileCount} kayıt)</span></h2>
        ${blockOrder.map((bk) => blockSectionHtml(blockGroups[bk].title, blockGroups[bk].items)).join('')}
      </div>`;
  };

  const bodyContent = `
  <div class="ihr-print-head">
    <h1>İhracat Sevkiyat Listesi</h1>
    ${tarih ? `<div class="ihr-print-date">${escapeHtml(tarih)}</div>` : ''}
  </div>
  <div class="ihr-print-meta"><b>${rows.length}</b> plaka${cikisCount ? ` · <b>${cikisCount}</b> çıkış yaptı` : ''} · Yazdırma: ${escapeHtml(printedAt)}</div>
  ${files.map(fileSectionHtml).join('')}`;

  const printHtml = `<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="utf-8">
  <title>İhracat Sevkiyat Listesi</title>
  <style>
    @page { size: A4 landscape; margin: 6mm; }
    html, body { margin: 0; padding: 0; height: auto; min-height: 0; }
    * { box-sizing: border-box; }
    body { font-family: Arial, 'Segoe UI', sans-serif; font-size: 11px; color: #000; background: #fff; }
    .ihr-print-root { padding: 0; }
    .ihr-print-head { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; margin: 0 0 8px; padding-bottom: 6px; border-bottom: 2px solid #000; }
    h1 { font-size: 16px; margin: 0; font-weight: 800; }
    .ihr-print-date { font-size: 18px; font-weight: 800; white-space: nowrap; }
    .ihr-print-meta { font-size: 10px; margin: 0 0 10px; }
    .ihr-print-file { margin-bottom: 12px; }
    .ihr-print-file h2 { font-size: 13px; margin: 0 0 8px; font-weight: 800; page-break-after: avoid; }
    .ihr-print-file-count { font-weight: 600; font-size: 11px; }
    .ihr-print-block-unit {
      display: block;
      margin: 0 0 12px;
      padding: 8px 10px;
      border: 1px solid #000;
      break-inside: avoid-page;
      page-break-inside: avoid;
      -webkit-column-break-inside: avoid;
    }
    .ihr-print-excel-box { margin-bottom: 6px; }
    .ihr-print-excel-box .ihr-excel-desc { margin: 0 !important; border-radius: 0; }
    .ihr-print-firma-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 8px; margin-bottom: 5px; }
    .ihr-print-firma-head strong { font-size: 13px; font-weight: 800; line-height: 1.3; }
    .ihr-print-firma-meta { font-size: 10px; margin-left: auto; white-space: nowrap; }
    .ihr-print-block-fields { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 6px; }
    .ihr-print-field { flex: 1; min-width: 160px; padding: 5px 7px; border: 1px solid #000; }
    .ihr-print-label { display: block; font-size: 9px; font-weight: 800; text-transform: uppercase; margin-bottom: 2px; }
    .ihr-print-value { display: block; font-size: 11px; font-weight: 700; line-height: 1.3; word-break: break-word; }
    .ihr-print-table-shell {
      break-inside: avoid-page;
      page-break-inside: avoid;
      -webkit-column-break-inside: avoid;
    }
    .ihr-print-plaka-table { width: 100%; border-collapse: collapse; table-layout: fixed; margin: 0; }
    .ihr-print-plaka-table thead { display: table-header-group; }
    .ihr-print-plaka-table th,
    .ihr-print-plaka-table td { border: 1px solid #000; padding: 5px 6px; vertical-align: middle; word-break: break-word; line-height: 1.25; }
    .ihr-print-plaka-table th { font-size: 10px; font-weight: 800; text-align: center; background: #f5f5f5; }
    .ihr-print-toplam td { background: #fffbeb !important; font-weight: 800; }
    td.c-plaka { font-size: 12px; font-weight: 800; text-align: center; }
    .c-durum { font-size: 8px; font-weight: 700; margin-top: 2px; line-height: 1.15; }
    tr.row-printed td { font-style: normal; }
    td.c-malzeme { font-size: 11px; font-weight: 700; }
    td.c-num { font-size: 12px; font-weight: 800; text-align: center; }
    td.c-bbt { font-size: 13px; font-weight: 800; }
    .ihr-print-firma--md .ihr-print-firma-head strong { font-size: 12px; }
    .ihr-print-firma--md .ihr-print-plaka-table th,
    .ihr-print-firma--md .ihr-print-plaka-table td { padding: 4px 5px; font-size: 10px; }
    .ihr-print-firma--md td.c-plaka { font-size: 11px; }
    .ihr-print-firma--md td.c-bbt { font-size: 12px; }
    .ihr-print-firma--md .ihr-excel-desc { font-size: 10px; }
    .ihr-print-firma--sm { font-size: 10px; }
    .ihr-print-firma--sm .ihr-print-firma-head strong { font-size: 11px; }
    .ihr-print-firma--sm .ihr-print-plaka-table th,
    .ihr-print-firma--sm .ihr-print-plaka-table td { padding: 3px 4px; font-size: 9px; }
    .ihr-print-firma--sm td.c-plaka { font-size: 10px; }
    .ihr-print-firma--sm td.c-bbt { font-size: 11px; }
    .ihr-print-firma--sm .ihr-excel-desc { font-size: 9px; }
    .ihr-print-firma--sm .ihr-print-field { padding: 4px 6px; }
    .ihr-print-firma--xs { font-size: 9px; }
    .ihr-print-firma--xs .ihr-print-firma-head strong { font-size: 10px; }
    .ihr-print-firma--xs .ihr-print-plaka-table th,
    .ihr-print-firma--xs .ihr-print-plaka-table td { padding: 2px 3px; font-size: 8px; line-height: 1.15; }
    .ihr-print-firma--xs td.c-plaka { font-size: 9px; }
    .ihr-print-firma--xs td.c-bbt { font-size: 10px; }
    .ihr-print-firma--xs .ihr-excel-desc { font-size: 8px; }
    .ihr-print-firma--xs .ihr-print-block-unit { padding: 6px 8px; }
    .ihr-print-file--multi .ihr-print-block-unit:not(.ihr-print-firma--xs):not(.ihr-print-firma--sm) {
      font-size: 10px;
    }
    .ihr-print-file--multi .ihr-print-block-unit:not(.ihr-print-firma--xs):not(.ihr-print-firma--sm) .ihr-print-plaka-table th,
    .ihr-print-file--multi .ihr-print-block-unit:not(.ihr-print-firma--xs):not(.ihr-print-firma--sm) .ihr-print-plaka-table td {
      padding: 4px 5px;
      font-size: 9px;
    }
    .ihr-print-file--pair .ihr-print-block-unit {
      margin-bottom: 8px;
      padding: 6px 8px;
    }
    .ihr-print-file--pair .ihr-print-firma-head strong { font-size: 11px; }
    .ihr-print-file--pair .ihr-excel-desc { font-size: 9px !important; }
    @media print {
      html, body { margin: 0 !important; padding: 0 !important; }
      body, th, td, .ihr-print-field { background: #fff !important; color: #000 !important; }
      .ihr-print-block-unit,
      .ihr-print-table-shell,
      .ihr-print-excel-box,
      .ihr-print-block-fields {
        break-inside: avoid-page !important;
        page-break-inside: avoid !important;
        -webkit-column-break-inside: avoid !important;
      }
      .ihr-print-plaka-table { page-break-inside: avoid !important; break-inside: avoid-page !important; }
      .ihr-print-plaka-table tr { page-break-inside: avoid !important; break-inside: avoid !important; }
      .ihr-print-block-unit + .ihr-print-block-unit {
        page-break-before: auto;
      }
      .ihr-print-firma--xs,
      .ihr-print-firma--sm {
        page-break-before: always;
      }
      .ihr-print-file > .ihr-print-block-unit:first-of-type.ihr-print-firma--xs,
      .ihr-print-file > .ihr-print-block-unit:first-of-type.ihr-print-firma--sm {
        page-break-before: auto;
      }
    }
  </style>
</head>
<body><div class="ihr-print-root">${bodyContent}</div></body>
</html>`;

  const IHR_PRINT_FRAME_HIDE = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;border:0;overflow:hidden;';
  let frame = document.getElementById('ihracatDetailsPrintFrame');
  if (!frame) {
    frame = document.createElement('iframe');
    frame.id = 'ihracatDetailsPrintFrame';
    frame.setAttribute('aria-hidden', 'true');
    frame.style.cssText = IHR_PRINT_FRAME_HIDE;
    document.body.appendChild(frame);
  }
  const win = frame.contentWindow;
  const doc = frame.contentDocument || win.document;
  doc.open();
  doc.write(printHtml);
  doc.close();

  const doPrint = () => {
    try {
      win.focus();
      win.print();
    } catch (e) {
      alert('Yazdırma başlatılamadı.');
    }
  };
  if (doc.readyState === 'complete') setTimeout(doPrint, 200);
  else frame.onload = () => setTimeout(doPrint, 200);
}

/** Yazdırılmış plaka: rapor listesi (print_history) tek kaynak; silinince durum düşer. */
function _ihracatCollectPrintedCapacityByPlate(meta, excelFirmalar) {
  const map = new Map();
  const firmalar = excelFirmalar instanceof Set ? excelFirmalar : new Set();

  try {
    const reportCounts = _ihracatCollectReportPrintCountsByPlate(meta, firmalar);
    reportCounts.forEach((count, k) => map.set(k, count));
  } catch (e) {
    console.warn('Raporlardan yazdırılma durumu kontrol edilemedi:', e);
  }

  if (window.__ihracatRemotePrintCache?.loaded) {
    return map;
  }

  const pk = (value) => _ihracatPlateKey(value);
  const creditKeys = (keys, count) => {
    const n = Number(count);
    if (!Number.isFinite(n) || n <= 0) return;
    keys.forEach((k) => {
      if (!k) return;
      map.set(k, Math.max(map.get(k) || 0, n));
    });
  };

  (state.vehicles || []).forEach((v) => {
    const printCount = Number(v.printCount || 0);
    if (!Number.isFinite(printCount) || printCount <= 0) return;
    const snap = v.lastPrintSnapshot || {};
    const snapTs = Number(snap?.ts || snap?.timestamp || 0);
    if (!Number.isFinite(snapTs) || snapTs <= 0) return;
    if (!_ihracatPrintSnapValidForMeta(snapTs, meta)) return;

    const snapKeys = new Set();
    [snap.plaka, snap.cekiciPlaka, snap.dorsePlaka, snap.plate].forEach((raw) => {
      const k = pk(raw);
      if (k) snapKeys.add(k);
    });

    const currentKeys = new Set();
    [v.cekiciPlaka, v.dorsePlaka, v.plaka].forEach((raw) => {
      const k = pk(raw);
      if (k) currentKeys.add(k);
    });

    let keysToCredit = [];
    if (snapKeys.size > 0) {
      keysToCredit = [...snapKeys].filter((k) => currentKeys.has(k));
    } else {
      const primary = pk(snap.plaka || v.cekiciPlaka || '');
      if (primary && currentKeys.has(primary)) keysToCredit = [primary];
    }
    creditKeys(keysToCredit, printCount);
  });

  return map;
}

function _ihracatCreateStatusApi(meta, excelFirmalar) {
  const normalizePlate = (value) => normPlate(value || '');
  const plateKeyFn = (value) => _ihracatPlateKey(value);
  const statusStyle = {
    printed: 'background:#fee2e2;color:#991b1b;',
    pending: 'background:#dcfce7;color:#166534;',
    missing: 'background:#f1f5f9;color:#0f172a;',
  };

  let cachedCapacityMap = null;
  const capacityMap = () => {
    if (!cachedCapacityMap) {
      cachedCapacityMap = _ihracatCollectPrintedCapacityByPlate(meta, excelFirmalar);
    }
    return cachedCapacityMap;
  };

  const resolveRowStatus = (plateRaw, assignmentCountByPlate) => {
    const key = plateKeyFn(plateRaw);
    if (!key) return 'missing';
    const allowed = capacityMap().get(key) || 0;
    const alreadyAssigned = assignmentCountByPlate.get(key) || 0;
    if (allowed > alreadyAssigned) {
      assignmentCountByPlate.set(key, alreadyAssigned + 1);
      return 'printed';
    }
    if (_ihracatFindVehicleByPlate(plateRaw)) return 'pending';
    return 'missing';
  };

  const statusForPlate = (plateRaw) => {
    const counter = new Map();
    return resolveRowStatus(plateRaw, counter);
  };

  const getShipmentStatus = (shipment, assignmentCountByPlate) => {
    return resolveRowStatus(shipment.plaka, assignmentCountByPlate);
  };

  return {
    normalizePlate,
    plateKey: plateKeyFn,
    statusForPlate,
    resolveRowStatus,
    getShipmentStatus,
    statusStyle,
    durumLabel: (st) => _ihracatDurumPlainText(st, ''),
    renderDurumHtml: _ihracatRenderDurumHtml,
    meta,
    excelFirmalar,
  };
}

function _ihracatRefreshOpenModalStatuses() {
  const modal = document.getElementById('ihracatDetailsModal');
  if (!modal) return;
  const apply = () => {
    const meta = (typeof loadDailyMeta === 'function') ? (loadDailyMeta() || {}) : (modal.__ihrMeta || {});
    modal.__ihrMeta = meta;

    let firmalar = modal.__ihrExcelFirmalar;
    if (!(firmalar instanceof Set) || firmalar.size === 0) {
      firmalar = new Set();
      const rows = (typeof loadDailyShipments === 'function') ? (loadDailyShipments() || []) : [];
      rows.forEach((s) => {
        const firma = String(s.firma || '').trim();
        if (firma) firmalar.add(firma);
      });
    }
    modal.__ihrExcelFirmalar = firmalar;

    const statusApi = _ihracatCreateStatusApi(meta, firmalar);
    modal.__ihracatStatusApi = statusApi;
    const assignmentCountByPlate = new Map();

    modal.querySelectorAll('tr[data-ihr-row-key]').forEach((row) => {
      const plate =
        row.querySelector('[data-field="plaka-text"]')?.textContent?.trim() ||
        row.querySelector('[data-field="plaka"]')?.value?.trim() ||
        '';
      const st = statusApi.resolveRowStatus(plate, assignmentCountByPlate);
      _ihracatApplyDurumCell(row.querySelector('[data-field="durum"]'), row, plate, statusApi, st);
    });
  };
  _ihracatFetchRemotePrintReports(false).then(apply).catch(apply);
}

function _ihracatSyncVehiclePlatesFromTakipForm() {
  const vid = String(window.__activeTakipVehicleId || '').trim();
  if (!vid) return;
  const read = (id) => String(document.getElementById(id)?.value || '').trim();
  let cekici = read('cekiciPlakaBilgi');
  let dorse = read('dorsePlakaBilgi');
  try { cekici = formatTRPlate(formatPlakaForInput(cekici)); } catch (_) {}
  try { dorse = formatTRPlate(formatPlakaForInput(dorse)); } catch (_) {}
  const patch = (v) => {
    if (!v || String(v.id) !== vid) return v;
    return { ...v, cekiciPlaka: cekici || v.cekiciPlaka, dorsePlaka: dorse };
  };
  try {
    if (window.__activeTakipVehicle) window.__activeTakipVehicle = patch(window.__activeTakipVehicle);
  } catch (_) {}
  state.vehicles = (state.vehicles || []).map(patch);
  _ihracatRefreshOpenModalStatuses();
}

function _ihracatOnReportsChanged() {
  try { _ihracatInvalidatePrintReportsCache(); } catch (e) {}
  _ihracatFetchRemotePrintReports(true)
    .then(() => { try { _ihracatRefreshOpenModalStatuses(); } catch (e) {} })
    .catch(() => {});
}
window._ihracatOnReportsChanged = _ihracatOnReportsChanged;
window._ihracatRefreshOpenModalStatuses = _ihracatRefreshOpenModalStatuses;

// İhracat Excel Detay Modal
async function showIhracatDetailsModal() {
  try {
    await _ihracatFetchRemotePrintReports(true);
    if (window.Report && typeof window.Report.getEvents === 'function') {
      state.reports = window.Report.getEvents();
    }
  } catch (e) { /* ignore */ }
  const shipments = (typeof loadDailyShipments === 'function') ? (loadDailyShipments() || []) : [];
  const meta = (typeof loadDailyMeta === 'function') ? (loadDailyMeta() || {}) : {};
  const tarih = meta.dateKey ? meta.dateKey.replace(/(\d{4})-(\d{2})-(\d{2})/, '$3.$2.$1') : 'Bilinmiyor';
  if (!shipments.length) {
    showToast('❌ İhracat verisi bulunamadı.');
    return;
  }

  // Excel'deki firmaları topla (rapor filtreleme için)
  const excelFirmalar = new Set();
  shipments.forEach(s => {
    const firma = String(s.firma || '').trim();
    if (firma) excelFirmalar.add(firma);
  });

  const assignmentCountByPlate = new Map();
  const ihracatStatusApi = _ihracatCreateStatusApi(meta, excelFirmalar);
  const { statusStyle, getShipmentStatus } = ihracatStatusApi;

  const getStatus = (shipment) => shipment._status || 'pending';
  const getFileLabel = (shipment) => {
    const label = String(shipment.fileName || meta.fileName || '').trim();
    return label || 'Excel';
  };
  const getFirmaLabel = (shipment) => {
    const label = String(shipment.firma || '').trim();
    return label || 'Bilinmiyor';
  };

  // Aynı plakaya ait birden fazla sevkiyat varsa, yazdırma durumunu sadece yazdırılan miktar kadar atıyoruz.
  shipments.forEach((shipment) => {
    shipment._status = getShipmentStatus(shipment, assignmentCountByPlate);
  });

  const { collisions: irsCollisions, set: irsCollisionSet } = getIrsaliyeCollisionInfo(shipments);
  const collisionByKey = new Map();
  irsCollisions.forEach((c) => {
    collisionByKey.set(irsaliyeCollisionKey(c.irsaliyeNo), c);
  });

  const inpStyle = 'width:100%;max-width:72px;padding:4px 6px;border:1px solid #cbd5e1;border-radius:6px;font-size:12px;box-sizing:border-box;';
  const rowHtml = (s, status) => {
    const rowKey = _ihracatShipmentKey(s);
    const durumHtml = _ihracatRenderDurumHtml(status, s.plaka || '');
    const durumText = _ihracatDurumPlainText(status, s.plaka || '');
    const irs = getShipmentIrsaliyeNo(s);
    const isManual = s._ihracatManual || String(rowKey).startsWith('new__');
    const isIrsCollision = shipmentHasIrsaliyeCollision(s, irsCollisionSet);
    const rowStyle = statusStyle[status] || '';
    const coll = collisionByKey.get(irsaliyeCollisionKey(irs));
    const irsTitle = coll
      ? `Aynı irsaliye birden fazla plakada: ${(coll.plates || []).join(' · ')}`
      : '';
    const irsCellStyle = isIrsCollision
      ? `border:1px solid #eee;padding:6px;${IHR_IRS_COLLISION_CELL_STYLE}`
      : 'border:1px solid #ddd;padding:6px;';
    const irsInpStyle = isIrsCollision
      ? `${inpStyle}max-width:130px;background:#111210;color:#FFBF00;font-weight:700;border-color:#FFBF00;`
      : `${inpStyle}max-width:130px;`;
    return `
      <tr data-ihr-row-key="${escapeHtml(rowKey)}"${isManual ? ' data-ihr-is-new="1"' : ''}${isIrsCollision ? ' data-ihr-irs-collision="1"' : ''} style="${rowStyle}">
        <td style="${IHR_PLAKA_TD_STYLE}">${_ihracatPlakaCellHtml(s.plaka, false, false)}</td>
        <td data-field="firma" style="border:1px solid #ddd;padding:6px;font-size:11px;">${escapeHtml(s.firma || '')}</td>
        <td data-field="malzeme" style="border:1px solid #ddd;padding:6px;">${escapeHtml(s.malzeme || '')}</td>
        <td style="border:1px solid #ddd;padding:6px;">
          <input type="text" data-field="tonaj" value="${escapeHtml(String(s.tonajKg || ''))}" style="${inpStyle}max-width:90px;" inputmode="numeric" />
        </td>
        <td style="border:1px solid #ddd;padding:4px 6px;${IHR_AMBALAJ_TD_STYLE}">
          ${_ihracatAmbalajCellHtml(null, s)}
        </td>
        <td style="border:1px solid #ddd;padding:4px;text-align:center;white-space:nowrap;width:96px;">
          ${_ihracatTakipBtnHtml()}
        </td>
        <td style="${irsCellStyle}" title="${escapeHtml(irsTitle)}">
          <input type="text" data-field="irsaliye" value="${escapeHtml(irs)}" style="${irsInpStyle}" title="${escapeHtml(irsTitle)}" />
        </td>
        <td data-field="durum" data-ihr-durum-text="${escapeHtml(durumText)}" style="border:1px solid #ddd;padding:6px;font-size:11px;white-space:nowrap;">${durumHtml}</td>
      </tr>
    `;
  };

  const addRowHtml = () => `
    <tr data-ihr-add-row="1" style="background:#fffbeb;color:#92400e;">
      <td style="${IHR_PLAKA_TD_STYLE}">${_ihracatPlakaCellHtml('', true, true)}</td>
      <td data-field="firma" style="border:1px solid #ddd;padding:6px;font-size:11px;color:#94a3b8;">—</td>
      <td data-field="malzeme" style="border:1px solid #ddd;padding:6px;color:#94a3b8;">—</td>
      <td style="border:1px solid #ddd;padding:6px;"><input type="text" data-field="tonaj" value="" style="${inpStyle}max-width:90px;" disabled /></td>
      <td style="border:1px solid #ddd;padding:6px;opacity:0.5;"><span style="font-size:11px;">Firma ve malzeme üst satırdan kopyalanır</span></td>
      <td style="border:1px solid #ddd;padding:4px;text-align:center;color:#94a3b8;font-size:11px;">—</td>
      <td style="border:1px solid #ddd;padding:6px;"><input type="text" data-field="irsaliye" value="" style="${inpStyle}max-width:130px;" disabled /></td>
      <td data-field="durum" style="border:1px solid #ddd;padding:6px;font-size:11px;">Plaka girin</td>
    </tr>
  `;

  const renderTable = (items, title, badgeColor, tableCtx) => {
    if (!items || !items.length) return '';
    const { gk, templateJson } = tableCtx || {};
    const toplamRowHtml = _ihracatToplamRowHtml(items);
    return `
      <div style="margin-bottom:16px;">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">
          <strong style="font-size:13px;">${escapeHtml(title)}</strong>
          <span style="padding:4px 10px;border-radius:999px; background:${badgeColor}; color:#fff; font-size:12px;">${items.length}</span>
        </div>
        <table class="ihr-sevkiyat-table" style="width:100%;border-collapse:collapse;font-size:12px;margin-bottom:8px;">
          <thead>
            <tr style="background:#f5f5f5;">
              <th style="border:1px solid #ddd;padding:6px;text-align:left;width:172px;">Plaka</th>
              <th style="border:1px solid #ddd;padding:6px;text-align:left;">Firma</th>
              <th style="border:1px solid #ddd;padding:6px;text-align:left;">Malzeme</th>
              <th style="border:1px solid #ddd;padding:6px;text-align:left;">Miktar (Kg)</th>
              <th style="border:1px solid #ddd;padding:6px;text-align:left;white-space:nowrap;">Ambalaj</th>
              <th style="border:1px solid #ddd;padding:6px;text-align:center;width:96px;">Takip</th>
              <th style="border:1px solid #ddd;padding:6px;text-align:left;">İrsaliye No</th>
              <th style="border:1px solid #ddd;padding:6px;text-align:left;">Durum</th>
            </tr>
          </thead>
          <tbody data-ihr-tbody="1" data-ihr-firma-group="${escapeHtml(gk || '')}" data-ihr-template="${templateJson || '{}'}">
            ${items.map((item) => rowHtml(item, getStatus(item))).join('')}
            ${addRowHtml()}
            ${toplamRowHtml}
          </tbody>
        </table>
      </div>
    `;
  };

  const renderFirmaSection = (sectionTitle, items) => {
    const counts = { printed: 0, pending: 0, missing: 0 };
    items.forEach((item) => { counts[getStatus(item)] = (counts[getStatus(item)] || 0) + 1; });
    const sample = items[0] || {};
    const gk = _ihracatBlockGroupKey(sample);
    const sevkVal = _defaultSevkForShipment(sample);
    const ambVal = _defaultAmbalajTextForShipment(sample);
    const sevkCands = getLimanCandidates(sample.headerText || '').slice(0, 4);
    const ambCands = getAmbalajCandidates(sample.headerText || '').slice(0, 4);
    const boxStyle = 'flex:1;min-width:200px;padding:10px;border:2px solid #c7d2fe;border-radius:10px;background:#fff;';
    const fieldInp = 'width:100%;padding:8px;border:1px solid #cbd5e1;border-radius:8px;font-size:13px;box-sizing:border-box;';
    const templateJson = String(JSON.stringify(sample))
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;');
    const excelDescHtml = _ihracatRenderExcelBlockHeader(sample, items);
    return `
      <div data-ihr-block-section="1" style="margin-bottom:20px;border:1px solid #e2e8f0;border-radius:12px;padding:14px;background:#f8fafc;">
        <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:10px;margin-bottom:8px;">
          <strong style="font-size:14px;color:#0f172a;">${escapeHtml(sectionTitle)}</strong>
          <span style="font-size:12px;color:#475569;">Toplam: ${items.length} • Yazdırıldı: ${counts.printed} • Bekleniyor: ${counts.pending} • Kayıt yok: ${counts.missing}</span>
        </div>
        ${excelDescHtml}
        <div style="display:flex;flex-wrap:wrap;gap:12px;margin-bottom:14px;">
          <div style="${boxStyle}">
            <div style="font-size:11px;font-weight:700;color:#4338ca;margin-bottom:6px;">SEVK YERİ</div>
            <input type="text" data-ihr-firma-sevk="${escapeHtml(gk)}" value="${escapeHtml(sevkVal)}" list="ihr-sevk-list-${escapeHtml(gk)}" style="${fieldInp}" placeholder="Liman / sevk yeri" />
            <datalist id="ihr-sevk-list-${escapeHtml(gk)}">${sevkCands.map((c) => `<option value="${escapeHtml(c)}"></option>`).join('')}</datalist>
          </div>
          <div style="${boxStyle}">
            <div style="font-size:11px;font-weight:700;color:#4338ca;margin-bottom:6px;">AMBALAJ BİLGİSİ</div>
            <input type="text" data-ihr-firma-amb="${escapeHtml(gk)}" value="${escapeHtml(ambVal)}" list="ihr-amb-list-${escapeHtml(gk)}" style="${fieldInp}" placeholder="Örn: BBT, çuval, palet" />
            <datalist id="ihr-amb-list-${escapeHtml(gk)}">${ambCands.map((c) => `<option value="${escapeHtml(c)}"></option>`).join('')}</datalist>
            <div style="font-size:10px;color:#64748b;margin-top:6px;">Alttaki boş satıra plaka yazın; firma ve malzeme üst satırdan kopyalanır. Miktar, ambalaj ve irsaliye boş gelir.</div>
          </div>
        </div>
        ${renderTable(items, 'Sevkiyatlar', '#0f172a', { gk, templateJson })}
      </div>
    `;
  };

  const renderFileSection = (fileName, items) => {
    const blockGroups = {};
    items.forEach((item) => {
      const bk = _ihracatBlockGroupKey(item);
      if (!blockGroups[bk]) {
        blockGroups[bk] = {
          title:
            _ihracatShortBlockTitle(item.headerText, item.malzeme) || getFirmaLabel(item),
          items: [],
        };
      }
      blockGroups[bk].items.push(item);
    });

    const blockOrder = Object.keys(blockGroups).sort((a, b) => {
      const ia = blockGroups[a].items[0];
      const ib = blockGroups[b].items[0];
      const ra = Number(ia?.blockHeaderRow) || 0;
      const rb = Number(ib?.blockHeaderRow) || 0;
      if (ra !== rb) return ra - rb;
      return String(ia?.headerText || '').localeCompare(String(ib?.headerText || ''), 'tr');
    });
    return `
      <div style="margin-bottom:26px;">
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px; margin-bottom:12px;">
          <h4 style="margin:0; font-size:15px;">📄 ${escapeHtml(fileName)} - ${items.length} kayıt</h4>
          <span style="font-size:12px; color:#475569;">Sevkiyat bloğu bazında (Excel başlığı + toplam)</span>
        </div>
        ${blockOrder.map((bk) => renderFirmaSection(blockGroups[bk].title, blockGroups[bk].items)).join('')}
      </div>
    `;
  };

  const files = [];
  if (Array.isArray(meta.files)) {
    meta.files.forEach((f) => { const name = String(f || '').trim(); if (name && !files.includes(name)) files.push(name); });
  }
  if (meta.fileName && !files.includes(meta.fileName)) files.push(meta.fileName);
  const groupedByFile = {};
  shipments.forEach((s) => {
    const fileLabel = getFileLabel(s);
    if (!groupedByFile[fileLabel]) groupedByFile[fileLabel] = [];
    groupedByFile[fileLabel].push(s);
    if (!files.includes(fileLabel)) files.push(fileLabel);
  });
  if (!files.length) files.push('Excel');

  const modalSections = files.map((fileLabel) => {
    const items = groupedByFile[fileLabel] || [];
    return renderFileSection(fileLabel, items);
  }).join('');

  const collisionBannerHtml = irsCollisions.length
    ? `<div style="margin-bottom:14px;padding:10px 12px;background:#FFD700;color:#000;border-radius:8px;font-size:12px;">
        <div style="font-weight:800;">⚠️ AYNI İRSALİYE NUMARASI BİRDEN FAZLA PLAKADA — İrsaliye No sütunundaki siyah/sarı bantlara dikkat edin</div>
        <ul style="margin:8px 0 0;padding-left:18px;font-size:11px;font-weight:600;line-height:1.5;">
          ${irsCollisions.slice(0, 10).map((c) => `<li><span style="background:#111210;color:#FFBF00;padding:2px 6px;border-radius:4px;">${escapeHtml(c.irsaliyeNo)}</span> → ${escapeHtml((c.plates || []).join(' · '))}</li>`).join('')}
          ${irsCollisions.length > 10 ? `<li>… ve ${irsCollisions.length - 10} irsaliye daha</li>` : ''}
        </ul>
      </div>`
    : '';

  const btnSaveStyle = 'background:#16a34a;color:#fff;border:none;padding:10px 22px;border-radius:8px;cursor:pointer;font-weight:700;';
  const btnCloseStyle = 'background:#64748b;color:#fff;border:none;padding:10px 18px;border-radius:8px;cursor:pointer;';

  const modalHtml = `
    <div id="ihracatDetailsModal" style="
      position: fixed; top: 0; left: 0; width: 100%; height: 100%;
      background: rgba(0,0,0,0.7); z-index: 9999; display: flex;
      align-items: center; justify-content: center; font-family: Arial, sans-serif;">
      <div style="
        background: white; padding: 20px; border-radius: 10px;
        max-width: 95%; max-height: 85%; overflow: auto; box-shadow: 0 4px 20px rgba(0,0,0,0.3);">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px;margin-bottom:12px;flex-wrap:wrap;">
          <div style="flex:1;min-width:220px;">
            <h3 style="margin: 0 0 6px 0; color: #333;">📄 İhracat Excel Detayları (${shipments.length} kayıt) - Tarih: ${tarih}</h3>
            <p style="margin:0;font-size:12px;color:#64748b;">Sevk/ambalaj bloktan; satırda miktar, ambalaj, irsaliye. <b>←</b> ok: boş çuval → çuval (boş çuval silinir, kayıt ve takip formu güncellenir). Şoför yoksa <b>Kayıt Et</b> ile ➕ Yeni Araç Kaydı açılır.</p>
          </div>
          <button type="button" class="ihr-save-btn" style="${btnSaveStyle}flex-shrink:0;">Kaydet</button>
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:14px;padding:10px 12px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;">
          <label for="ihracatPlateSearch" style="font-size:12px;font-weight:600;color:#475569;white-space:nowrap;">🔍 Plaka ara</label>
          <input type="text" id="ihracatPlateSearch" placeholder="03 AJH 861 veya 03AJH861…" style="flex:1;min-width:160px;max-width:280px;padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px;font-size:13px;box-sizing:border-box;" />
          <button type="button" id="ihracatPlateSearchBtn" style="padding:8px 14px;font-size:12px;background:#4f46e5;color:#fff;border:none;border-radius:8px;cursor:pointer;font-weight:600;">Ara</button>
          <button type="button" id="ihracatPrintBtn" title="Ekrandaki liste (güncel miktar/ambalaj) A4 yatay yazdır" style="padding:8px 14px;font-size:12px;background:#4f46e5;color:#fff;border:none;border-radius:8px;cursor:pointer;font-weight:700;white-space:nowrap;">🖨️ Yazdır</button>
          <span style="font-size:11px;color:#64748b;">Boşluklu/boşluksuz yazım fark etmez</span>
        </div>
        ${collisionBannerHtml}
        ${modalSections}
        <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:16px;flex-wrap:wrap;">
          <button type="button" class="ihr-save-btn" style="${btnSaveStyle}">Kaydet</button>
          <button type="button" id="closeIhracatModal" style="${btnCloseStyle}">Kapat</button>
        </div>
      </div>
    </div>
  `;

  document.body.insertAdjacentHTML('beforeend', modalHtml);

  const modal = document.getElementById('ihracatDetailsModal');
  if (modal) {
    modal.__ihrMeta = meta;
    modal.__ihrExcelFirmalar = excelFirmalar;
    modal.__ihracatStatusApi = ihracatStatusApi;
  }
  const closeModal = () => modal?.remove();

  const doSave = () => {
    const ok = _saveIhracatDetailsFromModal(shipments, meta);
    if (ok) {
      showToast('✅ İhracat verileri kaydedildi. Takip formunda plaka seçince güncel değerler gelir.');
      closeModal();
    } else {
      showToast('❌ Kaydetme başarısız.');
    }
  };

  modal?.querySelectorAll('.ihr-save-btn').forEach((btn) => btn.addEventListener('click', doSave));

  _ihracatBindModalPlateAdd(modal, ihracatStatusApi);

  _ihracatBindToplamLiveUpdate(modal);

  _ihracatBindCuvalTransfer(modal);

  _ihracatBindRowActions(modal, ihracatStatusApi);

  _ihracatBindTakipPanel(modal);

  _ihracatBindKayitEtAndSearch(modal);

  document.getElementById('ihracatPrintBtn')?.addEventListener('click', () => {
    _printIhracatDetailsFromModal(modal, {
      shipments,
      meta,
      ihracatStatusApi,
    });
  });

  if (window.__ihracatReopenTarget?.plate) {
    setTimeout(() => _ihracatScrollToReopenTarget(), 120);
  }

  document.getElementById('closeIhracatModal')?.addEventListener('click', closeModal);

  document.addEventListener('keydown', function escHandler(e) {
    if (e.key !== 'Escape') return;
    if (document.getElementById('excelReviewOverlay')) return;
    const takipModal = document.getElementById('takipFormuModal');
    if (takipModal && !takipModal.classList.contains('hidden')) return;
    closeModal();
    document.removeEventListener('keydown', escHandler);
  });
}
window.showIhracatDetailsModal = showIhracatDetailsModal;

// 🔄 CROSS-TAB SYNCHRONIZATION INTEGRATION
(function() {
  'use strict';

  // Wait for SyncManager to be available
  function initSyncHandlers() {
    if (!window.SyncManager) {
      setTimeout(initSyncHandlers, 100);
      return;
    }

    console.log('🔄 Initializing cross-tab synchronization handlers...');

    // Vehicle data synchronization
    window.SyncManager.on('vehicle_created', (data) => {
      console.log('🔄 Vehicle created in another tab:', data);
      refreshVehicleList();
      if (window.storage && typeof window.storage._readAll === 'function') {
        window.storage._readAll().catch(() => {});
      }
    });

    window.SyncManager.on('vehicle_updated', (data) => {
      console.log('🔄 Vehicle updated in another tab:', data);
      refreshVehicleList();
      if (window.storage && typeof window.storage._readAll === 'function') {
        window.storage._readAll().catch(() => {});
      }
      try { _ihracatRefreshOpenModalStatuses(); } catch (_) {}
    });

    window.SyncManager.on('vehicle_deleted', (data) => {
      console.log('🔄 Vehicle deleted in another tab:', data);
      refreshVehicleList();
      if (window.storage && typeof window.storage.delete === 'function') {
        window.storage.delete(`vehicle_${data.id}`);
      }
    });

    // Daily rows synchronization
    window.SyncManager.on('daily_row_created', (data) => {
      console.log('🔄 Daily row created in another tab:', data);
      if (typeof loadDailyShipments === 'function') {
        loadDailyShipments();
      }
      if (typeof rebuildListsFromExcelRows === 'function') {
        rebuildListsFromExcelRows(loadDailyShipments() || []);
      }
    });

    window.SyncManager.on('daily_row_deleted', (data) => {
      console.log('🔄 Daily row deleted in another tab:', data);
      if (typeof loadDailyShipments === 'function') {
        loadDailyShipments();
      }
      if (typeof rebuildListsFromExcelRows === 'function') {
        rebuildListsFromExcelRows(loadDailyShipments() || []);
      }
    });

    window.SyncManager.on('daily_rows_cleared', async () => {
      try {
        if (window.DailyStore && typeof DailyStore.clear === 'function') {
          await DailyStore.clear({ localOnly: true });
        } else if (typeof clearDailyShipments === 'function') {
          await clearDailyShipments();
        }
      } catch (e) {}
      try { if (typeof rebuildListsFromExcelRows === 'function') rebuildListsFromExcelRows([]); } catch (e) {}
      try { window.refreshHeaderExcelInfo && window.refreshHeaderExcelInfo(); } catch (e) {}
      try { if (typeof render === 'function') render(); } catch (e) {}
    });

    // Reports synchronization
    window.SyncManager.on('new_report', (data) => {
      console.log('🔄 New report created in another tab:', data);
      if (typeof refreshReportCache === 'function') {
        refreshReportCache();
      }
    });

    window.SyncManager.on('report_deleted', (data) => {
      console.log('🔄 Report deleted in another tab:', data);
      if (typeof refreshReportCache === 'function') {
        refreshReportCache();
      }
      try { _ihracatOnReportsChanged(); } catch (e) {}
    });

    window.SyncManager.on('reports_deleted', (data) => {
      console.log('🔄 Multiple reports deleted in another tab:', data);
      if (typeof refreshReportCache === 'function') {
        refreshReportCache();
      }
      try { _ihracatOnReportsChanged(); } catch (e) {}
    });

    // Manual refresh trigger
    window.SyncManager.on('manual_refresh', (data) => {
      console.log('🔄 Manual refresh triggered from another tab:', data);
      switch (data.dataType) {
        case 'vehicles':
          refreshVehicleList();
          break;
        case 'daily_rows':
          if (typeof loadDailyShipments === 'function') {
            loadDailyShipments();
          }
          break;
        case 'reports':
          if (typeof refreshReportCache === 'function') {
            refreshReportCache();
          }
          break;
        case 'all':
          refreshVehicleList();
          if (typeof loadDailyShipments === 'function') {
            loadDailyShipments();
          }
          if (typeof refreshReportCache === 'function') {
            refreshReportCache();
          }
          break;
      }
    });

    // Connection status monitoring
    window.SyncManager.on('connected', (data) => {
      console.log('🔄 Connected to synchronization server:', data);
    });

    console.log('✅ Cross-tab synchronization handlers initialized');
  }

  // Helper function to refresh vehicle list
  function refreshVehicleList() {
    try {
      if (window.storage && typeof window.storage._readAll === 'function') {
        window.storage._readAll().then(() => {
          // Trigger UI updates if vehicle list is visible
          const vehicleList = document.getElementById('araclarListesi');
          if (vehicleList) {
            // Force re-render of vehicle list
            const event = new CustomEvent('vehiclesUpdated', { 
              detail: { source: 'cross-tab-sync' } 
            });
            document.dispatchEvent(event);
          }
        }).catch(err => {
          console.warn('Failed to refresh storage after cross-tab sync:', err);
        });
      }
    } catch (err) {
      console.warn('Error in refreshVehicleList:', err);
    }
  }

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSyncHandlers);
  } else {
    initSyncHandlers();
  }

  // Expose manual refresh function
  window.triggerCrossTabRefresh = (dataType, data) => {
    if (window.SyncManager) {
      window.SyncManager.triggerRefresh(dataType, data);
    }
  };

})();
