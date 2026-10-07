// session-manager.js
// Oturum yönetimi ve kontrol fonksiyonları
(function() {
    'use strict';
    
    // Oturum kontrolü için API endpoint
    const SESSION_CHECK_ENDPOINT = '/api/me';
    const SESSION_CACHE_VALID_MS = 5 * 60 * 1000;   // geçerli oturumda /api/me en fazla 5 dk'da bir
    const SESSION_CACHE_INITIAL_MS = 2 * 60 * 1000; // ilk kontrollerde 2 dk
    const KEEPALIVE_INTERVAL_MS = 3 * 60 * 1000;    // periyodik oturum kontrolü 3 dk
    const SESSION_NETWORK_GRACE_MS = 15 * 60 * 1000; // ağ/sunucu hatasında oturumu koru (yanlış çıkış önleme)
    const SESSION_CHECK_RETRIES = 3;
    const SESSION_CHECK_RETRY_MS = 500;
    
    // Oturum durumunu cache'lemek için
    let sessionCache = {
        isValid: false,
        lastCheck: 0,
        checkInterval: SESSION_CACHE_INITIAL_MS
    };
    
    // Oturum süresi dolu uyarısını göstermek için
    let isShowingSessionExpired = false;
    
    function isAuthFailureStatus(status) {
        return status === 401 || status === 403;
    }

    function isTransientStatus(status) {
        return !status || status >= 500 || status === 408 || status === 429 || status === 502 || status === 503 || status === 504;
    }

    /** Geçici ağ/sunucu hatasında oturumu koru; yalnızca 401/403 gerçek çıkış sayılır */
    function keepSessionDuringTransientIssue(reason) {
        const now = Date.now();
        if (sessionCache.isValid && (now - sessionCache.lastCheck) < SESSION_NETWORK_GRACE_MS) {
            console.warn('[SessionManager] Geçici sorun, oturum korunuyor:', reason);
            sessionCache.lastCheck = now;
            return true;
        }
        return false;
    }

    async function fetchSessionMe() {
        let lastError = null;
        for (let attempt = 1; attempt <= SESSION_CHECK_RETRIES; attempt++) {
            try {
                const response = await fetch(SESSION_CHECK_ENDPOINT, {
                    method: 'GET',
                    headers: {
                        'Content-Type': 'application/json',
                        'Cache-Control': 'no-cache'
                    },
                    credentials: 'include'
                });
                return response;
            } catch (error) {
                lastError = error;
                if (attempt < SESSION_CHECK_RETRIES) {
                    await new Promise((r) => setTimeout(r, SESSION_CHECK_RETRY_MS * attempt));
                }
            }
        }
        throw lastError || new Error('session check failed');
    }

    // ---- Hatırlanan cihaz: oturum düşünce şifresiz yenileme (kantar PC) ----
    const RENEW_ENDPOINT = '/api/session/renew';
    const RENEW_RETRY_COOLDOWN_MS = 20 * 1000; // başarısız renew sonrası sunucuyu dövme
    let renewInFlight = null;
    let lastRenewFailAt = 0;
    let lastRenewFailCode = '';

    function applyRenewedUser(data) {
        try {
            const u = data && data.user;
            if (u && u.username) localStorage.setItem('currentUserId', String(u.username).trim());
            if (u) localStorage.setItem('currentUserRole', String(u.role || '').trim().toLowerCase());
            if (data && data.clientSite) { localStorage.setItem('currentClientSite', String(data.clientSite)); window.__clientSite = String(data.clientSite); }
            if (data && data.clientIp) { localStorage.setItem('currentClientIp', String(data.clientIp)); window.__clientIp = String(data.clientIp); }
            localStorage.setItem('isLoggedIn', 'true');
        } catch (e) { /* ignore */ }
        try { document.documentElement.classList.add('logged-in'); } catch (e) { /* ignore */ }
        try { window.dispatchEvent(new CustomEvent('gpm-session-renewed', { detail: data || {} })); } catch (e) { /* ignore */ }
    }

    /**
     * Cihaz çereziyle yeni oturum ister. true → oturum tazelendi.
     * Aynı anda tek istek; başarısızlıkta 20 sn bekler (401 fırtınası olmasın).
     */
    async function renewSession(opts) {
        const force = !!(opts && opts.force);
        if (renewInFlight) return renewInFlight;
        if (!force && lastRenewFailAt && Date.now() - lastRenewFailAt < RENEW_RETRY_COOLDOWN_MS) return false;
        renewInFlight = (async () => {
            try {
                const res = await fetch(RENEW_ENDPOINT, {
                    method: 'POST',
                    credentials: 'include',
                    headers: { 'Cache-Control': 'no-cache', 'Content-Type': 'application/json' },
                    body: '{}',
                });
                let data = {};
                try { data = await res.json(); } catch (e) { data = {}; }
                if (res.ok && data && data.ok) {
                    lastRenewFailAt = 0;
                    lastRenewFailCode = '';
                    applyRenewedUser(data);
                    markSessionValid();
                    hideSessionBanner();
                    console.info('[SessionManager] Oturum cihaz anahtarıyla yenilendi');
                    return true;
                }
                lastRenewFailAt = Date.now();
                lastRenewFailCode = (data && data.code) || ('HTTP ' + res.status);
                if (isTransientStatus(res.status)) {
                    // Sunucu/ağ sorunu: cihaz anahtarı geçersiz değil, sonra tekrar denenecek
                    return false;
                }
                return false;
            } catch (e) {
                lastRenewFailAt = Date.now();
                lastRenewFailCode = 'network';
                return false;
            } finally {
                renewInFlight = null;
            }
        })();
        return renewInFlight;
    }

    /** Son renew denemesi cihaz anahtarı yüzünden mi düştü (şifre gerekli)? */
    function renewNeedsPassword() {
        return /^DEVICE_|^USER_/.test(String(lastRenewFailCode || ''));
    }

    // ---- Kalıcı uyarı bandı: kantar ekranında oturum yenilenemediğinde ----
    const BANNER_ID = 'gpmSessionBanner';
    function showSessionBanner(text, opts) {
        if (isLimanViewerPage()) return;
        let el = document.getElementById(BANNER_ID);
        if (!el) {
            el = document.createElement('div');
            el.id = BANNER_ID;
            el.setAttribute('role', 'alert');
            el.style.cssText = 'position:fixed;left:0;right:0;top:0;z-index:100000;background:#b91c1c;color:#fff;font:700 15px/1.3 system-ui,Segoe UI,sans-serif;padding:12px 16px;display:flex;gap:12px;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(0,0,0,.3)';
            document.body.appendChild(el);
        }
        const action = opts && opts.actionLabel
            ? '<button type="button" id="' + BANNER_ID + 'Btn" style="background:#fff;color:#7f1d1d;border:0;border-radius:6px;padding:6px 12px;font:inherit;cursor:pointer">' + opts.actionLabel + '</button>'
            : '';
        el.innerHTML = '<span>' + String(text || '') + '</span>' + action;
        const btn = document.getElementById(BANNER_ID + 'Btn');
        if (btn && opts && typeof opts.onAction === 'function') btn.addEventListener('click', opts.onAction);
        el.style.display = 'flex';
    }

    function hideSessionBanner() {
        const el = document.getElementById(BANNER_ID);
        if (el) el.style.display = 'none';
    }

    /**
     * Oturumu garanti et: önbelleği atlayıp /api/me sorar, düşmüşse cihaz anahtarıyla yeniler.
     * Liman gönderimi / 10 dk otomatik yenileme öncesi çağrılır.
     */
    async function ensureSession() {
        sessionCache.lastCheck = 0;
        const ok = await checkSessionValidity();
        if (!ok && renewNeedsPassword()) {
            showSessionBanner('Oturum yenilenemedi — kantar listesi gönderilemiyor. Şifreyle tekrar giriş yapın.', {
                actionLabel: 'Giriş ekranı',
                onAction: () => { try { localStorage.removeItem('isLoggedIn'); } catch (e) {} window.location.href = '/GIRIS.html'; },
            });
        }
        return ok;
    }

    /**
     * fetch sarmalayıcı: 401 gelirse bir kez oturumu yeniler ve isteği tekrarlar.
     * Body string/JSON olmalı (tekrar gönderilebilir).
     */
    async function fetchWithSession(url, options) {
        const opts = Object.assign({ credentials: 'same-origin' }, options || {});
        let res = await fetch(url, opts);
        if (res.status !== 401) return res;
        const renewed = await renewSession();
        if (!renewed) return res;
        return fetch(url, opts);
    }

    // Server'a oturum durumunu kontrol et
    async function checkSessionValidity() {
        const now = Date.now();
        
        // Cache: geçerli oturumda gereksiz /api/me çağrısı yapma
        if (sessionCache.isValid && (now - sessionCache.lastCheck) < sessionCache.checkInterval) {
            return true;
        }
        
        try {
            const response = await fetchSessionMe();
            
            if (!response.ok) {
                if (isAuthFailureStatus(response.status)) {
                    // Oturum düşmüş: önce cihaz anahtarıyla sessizce yenilemeyi dene
                    if (await renewSession()) return true;
                    sessionCache = { isValid: false, lastCheck: now, checkInterval: 0 };
                    return false;
                }
                if (isTransientStatus(response.status) && keepSessionDuringTransientIssue('HTTP ' + response.status)) {
                    return true;
                }
                if (sessionCache.isValid && keepSessionDuringTransientIssue('HTTP ' + response.status)) {
                    return true;
                }
                sessionCache = { isValid: false, lastCheck: now, checkInterval: 0 };
                return false;
            }
            
            sessionCache = {
                isValid: true,
                lastCheck: now,
                checkInterval: SESSION_CACHE_VALID_MS
            };
            
            return true;
        } catch (error) {
            console.warn('Oturum kontrolü sırasında ağ hatası:', error && error.message ? error.message : error);
            if (keepSessionDuringTransientIssue('network')) {
                return true;
            }
            sessionCache = {
                isValid: false,
                lastCheck: now,
                checkInterval: 0
            };
            return false;
        }
    }
    
    function isLoginScreenActive() {
        try {
            if (document.documentElement.classList.contains('logged-in')) return false;
            const loginScreen = document.getElementById('loginScreen');
            if (!loginScreen) return isHomePath(window.location.pathname);
            const style = window.getComputedStyle(loginScreen);
            return style.display !== 'none' && style.visibility !== 'hidden';
        } catch (e) {
            return false;
        }
    }

    /** Giriş ekranındayken veya oturum zaten kapalıyken modal gösterme */
    function shouldPromptSessionExpired() {
        if (isLikelyLoggedIn()) return true;
        return !isLoginScreenActive();
    }

    function invalidateSession() {
        sessionCache = { isValid: false, lastCheck: 0, checkInterval: 0 };
        stopSessionKeepAlive();
    }

    /** Yerel oturum kapandı: araç giriş bildirimi aynı anda kalksın. */
    function forgetLocalLogin() {
        try { localStorage.removeItem('isLoggedIn'); } catch (e) { /* ignore */ }
        try { window.dispatchEvent(new CustomEvent('gpm-session-closed')); } catch (e) { /* ignore */ }
    }

    // Oturum süresi dolu uyarısını göster
    function showSessionExpiredModal() {
        if (!shouldPromptSessionExpired()) return;
        if (isShowingSessionExpired) return;
        isShowingSessionExpired = true;
        
        // Modal varsa kullan, yoksa oluştur
        let modal = document.getElementById('sessionExpiredModal');
        if (!modal) {
            modal = createSessionExpiredModal();
            document.body.appendChild(modal);
        }
        
        modal.classList.remove('hidden');
        modal.classList.add('flex');
        
        // Arka planı kilitle
        document.body.style.overflow = 'hidden';
    }
    
    // Oturum süresi dolu modal'ı oluştur
    function createSessionExpiredModal() {
        const modal = document.createElement('div');
        modal.id = 'sessionExpiredModal';
        modal.className = 'hidden fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50';
        modal.innerHTML = `
            <div class="bg-white rounded-lg shadow-xl max-w-md w-full mx-auto">
                <div class="p-6">
                    <div class="text-center mb-4">
                        <div class="mx-auto w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mb-4">
                            <svg class="w-8 h-8 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                            </svg>
                        </div>
                        <h3 class="text-xl font-bold text-gray-900 mb-2">Oturum Süreniz Dolmuş</h3>
                        <p class="text-gray-600 mb-6">Oturum süreniz dolmuş. Lütfen tekrar giriş yapınız.</p>
                    </div>
                    
                    <div>
                        <button id="reloginBtn" class="w-full bg-indigo-600 text-white py-3 px-4 rounded-lg hover:bg-indigo-700 font-medium transition-colors">
                            Giriş Yap
                        </button>
                    </div>
                </div>
            </div>
        `;
        
        // Event listener'ları ekle
        const reloginBtn = modal.querySelector('#reloginBtn');
        
        reloginBtn.addEventListener('click', () => {
            redirectToLogin();
        });

        // ESC ve arka plan tıklaması ile kapatılamaz
        modal.addEventListener('click', (e) => {
            if (e.target === modal) e.stopPropagation();
        });
        document.addEventListener('keydown', function preventEsc(e) {
            if (e.key === 'Escape' && !modal.classList.contains('hidden')) {
                e.preventDefault();
                e.stopPropagation();
            }
        });
        
        return modal;
    }
    
    // Modal'ı gizle
    function hideSessionExpiredModal() {
        const modal = document.getElementById('sessionExpiredModal');
        if (modal) {
            modal.classList.add('hidden');
            modal.classList.remove('flex');
        }
        document.body.style.overflow = '';
        isShowingSessionExpired = false;
    }
    
    // Login sayfasına yönlendir
    function isLimanViewerPage() {
        const p = String(window.location.pathname || '').toLowerCase();
        return p === '/liman' || p.endsWith('/liman.html');
    }

    function redirectToLogin() {
        if (isLimanViewerPage()) return;
        // Mevcut sayfayı kaydet
        const currentPath = window.location.pathname + window.location.search;
        localStorage.setItem('redirectAfterLogin', currentPath);
        
        // Login sayfasına yönlendir
        window.location.href = '/GIRIS.html';
    }

    const HOME_PAGE = 'GIRIS.html';
    const HOME_WINDOW_NAME = 'gpm_app_home';

    const PAGE_WINDOW_NAMES = {
        'rapor.html': 'gpm_page_rapor',
        'vardiya-notlari.html': 'gpm_page_vardiya',
        'nakliye-bekleyen.html': 'gpm_page_nakliye',
        'liman.html': 'gpm_page_liman',
        'piyasa-cikanlar.html': 'gpm_page_piyasa_cikanlar',
        'sorunlar.html': 'gpm_page_sorunlar',
        'ayarlar.html': 'gpm_page_ayarlar',
        'liste-kopyala.html': 'gpm_page_liste_kopyala',
        'akyuz-liste.html': 'gpm_page_akyuz_liste',
        'is-merkezi.html': 'gpm_page_is_merkezi',
        'sayi-kontrol.html': 'gpm_page_sayi_kontrol',
        'amir-kontrol.html': 'gpm_page_amir',
        'ihracat-takip.html': 'gpm_page_ihracat_takip',
        'plaka.html': 'gpm_page_plaka',
        'gunlukraporlar.html': 'gpm_page_gunluk',
        'advanced_reports.html': 'gpm_page_advanced'
    };

    const AUTO_APP_PAGE_LINKS = Object.keys(PAGE_WINDOW_NAMES);

    function isHomePath(pathname) {
        if (!pathname) return false;
        const p = String(pathname).toLowerCase();
        if (p === '/' || p.endsWith('/giris.html')) return true;
        const base = p.split('/').pop() || '';
        return base === 'giris.html' || base === '';
    }

    function resolveAppUrl(path) {
        return new URL(path, window.location.href).href;
    }

    function pageBaseName(path) {
        const s = String(path || '').split('?')[0].split('#')[0];
        return (s.split('/').pop() || '').toLowerCase();
    }

    function getPageWindowName(path) {
        const base = pageBaseName(path);
        if (PAGE_WINDOW_NAMES[base]) return PAGE_WINDOW_NAMES[base];
        return 'gpm_page_' + base.replace(/[^a-z0-9]+/gi, '_');
    }

    function claimHomeWindow() {
        if (!isHomePath(window.location.pathname)) return;
        try {
            window.name = HOME_WINDOW_NAME;
        } catch (e) { /* ignore */ }
    }

    /**
     * İsimli pencere/sekme: varsa odaklan (isteğe bağlı URL güncelle), yoksa yeni sekme aç.
     * allowSameTabNavigate: popup engelliyse mevcut sekmeyi kullan (yalnızca ana sayfa için).
     */
    function focusOrOpenWindow(url, windowName, options) {
        options = options || {};
        let targetWin = null;
        try {
            targetWin = window.open(url, windowName);
        } catch (e) {
            targetWin = null;
        }

        if (targetWin && !targetWin.closed) {
            if (options.updateUrl) {
                try {
                    const targetBase = String(url).split('#')[0];
                    const currentBase = String(targetWin.location.href || '').split('#')[0];
                    if (currentBase !== targetBase) {
                        targetWin.location.href = url;
                    }
                } catch (e) { /* henüz yüklenmemiş olabilir */ }
            }
            try { targetWin.focus(); } catch (e) { /* ignore */ }
            return targetWin;
        }

        if (options.allowSameTabNavigate) {
            window.location.href = url;
        }
        return null;
    }

    /** Alt uygulama sayfasını ayrı sekmede aç (aynı sayfa için tek sekme). */
    function openAppPage(path, options) {
        if (!path) return null;
        options = options || {};
        const url = resolveAppUrl(path);
        const winName = options.windowName || getPageWindowName(path);

        if (isHomePath(window.location.pathname)) {
            return focusOrOpenWindow(url, winName, { updateUrl: options.updateUrl !== false });
        }

        return focusOrOpenWindow(url, winName, {
            updateUrl: options.updateUrl !== false,
            allowSameTabNavigate: !!options.allowSameTabNavigate
        });
    }

    /** Alt sayfa sekmesini kapat (ana sayfaya geçildikten sonra). */
    function tryCloseSubPageTab() {
        if (isHomePath(window.location.pathname)) return;
        try {
            window.close();
        } catch (e) { /* ignore */ }
    }

    /**
     * Ana sayfayı aç/odakla.
     * @param {string} [pathAndQuery]
     * @param {{ closeSubTab?: boolean }} [options] closeSubTab: alt sayfa sekmesini kapat (varsayılan true)
     */
    function openHomePage(pathAndQuery, options) {
        options = options || {};
        const closeSubTab = options.closeSubTab !== false;
        const path = pathAndQuery || HOME_PAGE;
        const url = resolveAppUrl(path);

        if (isHomePath(window.location.pathname)) {
            if (pathAndQuery && pageBaseName(path) === pageBaseName(HOME_PAGE)) {
                const next = url.split('#')[0];
                const cur = window.location.href.split('#')[0];
                if (cur !== next) window.location.href = url;
            }
            window.focus();
            return window;
        }

        let openerWin = null;
        try {
            if (window.opener && !window.opener.closed) openerWin = window.opener;
        } catch (e) { /* ignore */ }

        if (openerWin) {
            try {
                if (!isHomePath(openerWin.location.pathname) || pathAndQuery) {
                    openerWin.location.href = url;
                }
                openerWin.focus();
                if (closeSubTab) tryCloseSubPageTab();
                return openerWin;
            } catch (e) { /* ignore */ }
        }

        const homeWin = focusOrOpenWindow(url, HOME_WINDOW_NAME, { updateUrl: true });
        if (homeWin) {
            try { homeWin.focus(); } catch (e) { /* ignore */ }
            if (closeSubTab) tryCloseSubPageTab();
            return homeWin;
        }

        // Popup engelli veya tek sekme: bu sekmeyi ana sayfaya çevir
        window.location.href = url;
        return null;
    }

    /**
     * Rapor sayfasından yeniden yazdır: mümkünse ana sayfayı yenilemeden takip formunu aç.
     * @param {{ vehicleId?: string, plate?: string }} payload
     */
    function openHomeForReprint(payload) {
        payload = payload || {};
        const vehicleId = String(payload.vehicleId || payload.reprint || '').trim();
        const plate = String(payload.plate || '').trim();

        try {
            localStorage.setItem('pendingReprint', JSON.stringify({
                reprint: vehicleId,
                plate: plate,
                at: Date.now()
            }));
        } catch (e) { /* ignore */ }

        if (isHomePath(window.location.pathname)) {
            try {
                if (typeof window.checkReprintParam === 'function') {
                    window.checkReprintParam();
                } else {
                    window.dispatchEvent(new CustomEvent('gpm-reprint-request'));
                }
            } catch (e) { /* ignore */ }
            window.focus();
            return window;
        }

        let homeWin = null;
        try {
            homeWin = window.open('', HOME_WINDOW_NAME);
        } catch (e) {
            homeWin = null;
        }

        if (homeWin && !homeWin.closed) {
            try {
                if (typeof homeWin.checkReprintParam === 'function') {
                    homeWin.checkReprintParam();
                    try { homeWin.focus(); } catch (e) { /* ignore */ }
                    tryCloseSubPageTab();
                    return homeWin;
                }
            } catch (e) { /* ignore */ }

            try {
                homeWin.postMessage({ type: 'GPM_REPRINT', vehicleId: vehicleId, plate: plate }, window.location.origin);
                try { homeWin.focus(); } catch (e) { /* ignore */ }
                tryCloseSubPageTab();
                return homeWin;
            } catch (e) { /* ignore */ }

            const q = new URLSearchParams();
            if (vehicleId) q.set('reprint', vehicleId);
            if (plate) q.set('plate', plate);
            const qs = q.toString();
            homeWin.location.href = resolveAppUrl(HOME_PAGE + (qs ? '?' + qs : ''));
            try { homeWin.focus(); } catch (e) { /* ignore */ }
            tryCloseSubPageTab();
            return homeWin;
        }

        const q = new URLSearchParams();
        if (vehicleId) q.set('reprint', vehicleId);
        if (plate) q.set('plate', plate);
        const qs = q.toString();
        return openHomePage(HOME_PAGE + (qs ? '?' + qs : ''), { closeSubTab: true });
    }

    // Ana sayfaya dön: ana sayfa sekmesine geç, alt sayfa sekmesini kapat
    function navigateToHome() {
        if (isHomePath(window.location.pathname)) {
            window.focus();
            return window;
        }
        return openHomePage(HOME_PAGE, { closeSubTab: true });
    }

    function bindHomeNavigation() {
        const selector = 'a[href="GIRIS.html"], a[href="/GIRIS.html"], [data-nav-home]';
        document.querySelectorAll(selector).forEach(function (el) {
            if (el.dataset.homeNavBound) return;
            el.dataset.homeNavBound = '1';
            el.addEventListener('click', function (e) {
                e.preventDefault();
                navigateToHome();
            });
        });
    }

    function bindAppPageNavigation() {
        const explicit = 'a[data-app-page], [data-open-app-page]';
        document.querySelectorAll(explicit).forEach(function (el) {
            if (el.dataset.appPageNavBound) return;
            el.dataset.appPageNavBound = '1';
            el.addEventListener('click', function (e) {
                const path = el.getAttribute('data-app-page') || el.getAttribute('data-open-app-page');
                if (!path) return;
                e.preventDefault();
                openAppPage(path);
            });
        });

        AUTO_APP_PAGE_LINKS.forEach(function (page) {
            const linkSelector = 'a[href="' + page + '"], a[href="/' + page + '"]';
            document.querySelectorAll(linkSelector).forEach(function (el) {
                if (el.dataset.appPageNavBound) return;
                el.dataset.appPageNavBound = '1';
                el.addEventListener('click', function (e) {
                    e.preventDefault();
                    openAppPage(page);
                });
            });
        });
    }
    
    // Oturum kontrolü yapılmadan önce bir işlemi engelle
    async function requireValidSession() {
        if (!isLikelyLoggedIn()) {
            return false;
        }

        const isValid = await checkSessionValidity();
        
        if (!isValid) {
            const shouldNotify = shouldPromptSessionExpired();
            invalidateSession();
            forgetLocalLogin();
            if (shouldNotify && !isLimanViewerPage()) {
                showSessionExpiredModal();
            }
            return false;
        }

        startPresence();
        startNudge();
        return true;
    }

    // Form submit veya buton tıklamalarında kullanılmak üzere wrapper
    async function withSessionCheck(callback, options = {}) {
        const { showImmediateError = false } = options;
        
        const isValid = await requireValidSession();
        
        if (!isValid) {
            if (showImmediateError) {
                alert('Oturum süreniz dolmuş. Lütfen tekrar giriş yapınız.');
            }
            return false;
        }
        
        try {
            return await callback();
        } catch (error) {
            console.error('İşlem sırasında hata:', error);
            throw error;
        }
    }
    
    // Butonlara oturum kontrolü eklemek için helper
    function addSessionCheckToButton(button, callback, options = {}) {
        if (!button) return;
        
        const originalHandler = button.onclick || null;
        
        button.onclick = async function(event) {
            event.preventDefault();
            event.stopPropagation();
            
            // Butonu geçici olarak devre dışı bırak
            const wasDisabled = button.disabled;
            button.disabled = true;
            const originalText = button.textContent;
            
            if (options.showLoadingText) {
                button.textContent = options.loadingText || 'Kontrol ediliyor...';
            }
            
            try {
                const isValid = await requireValidSession();
                
                if (isValid) {
                    // Orijinal handler'ı çağır
                    if (originalHandler) {
                        await originalHandler.call(this, event);
                    } else if (callback) {
                        await callback.call(this, event);
                    }
                }
            } catch (error) {
                console.error('Oturum kontrolü sırasında hata:', error);
                if (options.showImmediateError) {
                    alert('İşlem sırasında hata oluştu.');
                }
            } finally {
                // Butonu eski haline getir
                button.disabled = wasDisabled;
                button.textContent = originalText;
            }
        };
    }
    
    // Form submit'lerine oturum kontrolü eklemek için helper
    function addSessionCheckToForm(form, options = {}) {
        if (!form) return;
        
        form.addEventListener('submit', async function(event) {
            event.preventDefault();
            event.stopPropagation();
            
            const submitButton = form.querySelector('button[type="submit"], input[type="submit"]');
            
            // Submit butonunu geçici olarak devre dışı bırak
            if (submitButton) {
                submitButton.disabled = true;
                const originalText = submitButton.textContent;
                submitButton.textContent = options.loadingText || 'Kontrol ediliyor...';
                
                setTimeout(() => {
                    submitButton.disabled = false;
                    submitButton.textContent = originalText;
                }, 2000);
            }
            
            const isValid = await requireValidSession();
            
            if (isValid) {
                // Formu normal şekilde submit et
                form.submit();
            }
        });
    }
    
    // Session keep alive - periyodik oturum yenileme
    let keepAliveInterval = null;
    
    function startSessionKeepAlive() {
        if (keepAliveInterval) return;
        keepAliveInterval = setInterval(async () => {
            if (!isLikelyLoggedIn()) {
                stopSessionKeepAlive();
                return;
            }
            try {
                const isValid = await checkSessionValidity();
                if (!isValid) {
                    const shouldNotify = shouldPromptSessionExpired();
                    invalidateSession();
                    forgetLocalLogin();
                    if (shouldNotify) {
                        showSessionExpiredModal();
                    }
                }
            } catch (error) {
                console.error('Keep alive check failed:', error);
            }
        }, KEEPALIVE_INTERVAL_MS);
    }
    
    function stopSessionKeepAlive() {
        if (keepAliveInterval) {
            clearInterval(keepAliveInterval);
            keepAliveInterval = null;
        }
    }
    
    function isLikelyLoggedIn() {
        try {
            if (typeof window.isAppLoggedIn === 'function') return window.isAppLoggedIn();
            return localStorage.getItem('isLoggedIn') === 'true';
        } catch (e) {
            return false;
        }
    }

    function markSessionValid() {
        const now = Date.now();
        sessionCache = {
            isValid: true,
            lastCheck: now,
            checkInterval: SESSION_CACHE_VALID_MS
        };
        startSessionKeepAlive();
        startPresence();
        startNudge();
    }

    // Public API
    function isAmirUser() {
        try {
            const role = String(localStorage.getItem('currentUserRole') || '').trim().toLowerCase();
            const id = String(localStorage.getItem('currentUserId') || '').trim().toLowerCase();
            return role === 'amir' || id === 'xxr' || id === 'saban' || id === 'ugur';
        } catch (e) {
            return false;
        }
    }

    function currentUserKey() {
        try {
            return String(localStorage.getItem('currentUserId') || '').trim().toLowerCase();
        } catch (e) {
            return '';
        }
    }

    function isSabanUser() {
        return currentUserKey() === 'saban';
    }

    function amirDisplayLabel() {
        const id = currentUserKey();
        if (id === 'saban') return 'ŞABAN LAHAÇLAR';
        if (id === 'ugur') return 'UĞUR AKTAŞ';
        if (id === 'xxr') return 'SELAHATTİN TOKER';
        return 'GENPER · AMİR';
    }

    // Kim çevrimiçi: 2 dk'da bir küçük istek. Liste/nabız zaten hemen online yazar; sık yoklama gerekmez.
    const PRESENCE_KEY = 'gpm_presence_v1';
    const PRESENCE_INTERVAL_MS = 2 * 60 * 1000;
    const PRESENCE_FETCH_MIN_MS = 20 * 1000;
    let presenceTimer = null;
    let lastPresenceFetchAt = 0;

    function readPresenceCache() {
        try {
            const raw = JSON.parse(localStorage.getItem(PRESENCE_KEY) || 'null');
            return raw && Array.isArray(raw.list) ? raw : null;
        } catch (e) {
            return null;
        }
    }

    function emitPresence(list) {
        try {
            window.dispatchEvent(new CustomEvent('gpm-presence', { detail: { list: list || [] } }));
        } catch (e) { /* ignore */ }
    }

    async function pollPresence() {
        if (!isLikelyLoggedIn()) return;
        const cached = readPresenceCache();
        if (cached) emitPresence(cached.list);
        if (Date.now() - lastPresenceFetchAt < PRESENCE_FETCH_MIN_MS) return;
        lastPresenceFetchAt = Date.now();
        try {
            const res = await fetch('/api/presence', { credentials: 'include', cache: 'no-store' });
            if (!res.ok) return;
            const data = await res.json();
            const list = Array.isArray(data.presence) ? data.presence : [];
            try { localStorage.setItem(PRESENCE_KEY, JSON.stringify({ at: Date.now(), list })); } catch (e) { /* ignore */ }
            emitPresence(list);
        } catch (e) { /* ignore */ }
    }

    function startPresence() {
        if (presenceTimer) return;
        pollPresence();
        presenceTimer = setInterval(pollPresence, PRESENCE_INTERVAL_MS);
        document.addEventListener('visibilitychange', () => { if (!document.hidden) pollPresence(); });
        window.addEventListener('storage', (ev) => {
            if (ev.key !== PRESENCE_KEY) return;
            const cached = readPresenceCache();
            if (cached) emitPresence(cached.list);
        });
    }

    function getPresence() {
        const cached = readPresenceCache();
        return cached ? cached.list : [];
    }

    function presenceSiteKey(value) {
        const raw = String(value || '').trim();
        const upper = raw.toLocaleUpperCase('tr-TR').replace(/\s+/g, '');
        if (upper === 'AVDAN') return 'AVDAN';
        if (upper === '1.OSB' || upper === '1OSB' || upper === 'OSB') return '1.OSB';
        if (upper === 'AMIR' || raw === 'AMİR' || upper === 'SELAHATTİN' || upper === 'SELAHATTIN' || upper === 'XXR') return 'AMIR';
        if (upper === 'SABAN' || upper === 'ŞABAN') return 'SABAN';
        if (upper === 'UGUR' || upper === 'UĞUR') return 'UGUR';
        return '';
    }

    function canDirectMessage() {
        const id = currentUserKey();
        return id === 'xxr' || id === 'saban';
    }

    function canOpenChat(key) {
        const mine = presenceSiteKey(currentUserKey());
        const peer = presenceSiteKey(key);
        if (!mine || !peer || mine === peer) return false;
        return true;
    }

    function chatUnreadCount(key) {
        try {
            const n = window.__gpmChatUnread && window.__gpmChatUnread[presenceSiteKey(key)];
            return n > 0 ? n : 0;
        } catch (e) {
            return 0;
        }
    }

    function isPersonPresenceKey(key) {
        return key === 'AMIR' || key === 'SABAN' || key === 'UGUR';
    }

    function presencePersonName(key) {
        return ({ AMIR: 'SELAHATTİN TOKER', SABAN: 'ŞABAN LAHAÇLAR', UGUR: 'UĞUR AKTAŞ' })[presenceSiteKey(key)] || '';
    }

    function nudgeSenderName(nudge) {
        const from = String((nudge && nudge.from) || '').trim();
        if (from) return from;
        return presencePersonName(nudge && nudge.fromKey) || 'AMİR';
    }

    function currentKantarSite() {
        try {
            return presenceSiteKey(localStorage.getItem('currentUserId'));
        } catch (e) {
            return '';
        }
    }

    /** Tek chip: "AVDAN ● · 1.OSB ○ · AMİR ●" — amir online tesise basınca titre */
    function presenceChipHtml(list) {
        const items = (list || []).map((p) => {
            const key = presenceSiteKey(p && (p.key || p.label));
            const online = !!(p && p.online);
            const label = (p && p.label) || key;
            let cls = online ? 'presence-item is-on' : 'presence-item';
            let title = online ? 'çevrimiçi' : (p.lastSeen ? 'son görülme ' + new Date(p.lastSeen).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }) : 'çevrimdışı');
            let extra = '';
            let small = online ? 'online' : 'offline';
            if (canOpenChat(key)) {
                cls += ' is-chat';
                title = label + ' ile yazış';
                extra = ' role="button" tabindex="0"';
                const unread = chatUnreadCount(key);
                if (unread) {
                    cls += ' is-unread';
                    small = unread + ' yeni';
                    title = unread + ' yeni mesaj · ' + label;
                }
                const status = nudgeStatusLabel(key);
                if (status && !unread) {
                    small = status;
                    title += ' · ' + status;
                }
            }
            return '<span class="' + cls + '" data-presence-key="' + key + '" data-online="' + (online ? '1' : '0') + '" title="' + title + '"' + extra + '><i aria-hidden="true"></i>' + label + ' <small>' + small + '</small></span>';
        }).join('');
        if (items) return items;
        return [['AVDAN', 'AVDAN'], ['1.OSB', '1.OSB'], ['SELAHATTİN', 'AMIR'], ['ŞABAN', 'SABAN'], ['UĞUR', 'UGUR']].map((pair) => {
            const chat = canOpenChat(pair[1]);
            const unread = chat ? chatUnreadCount(pair[1]) : 0;
            const cls = 'presence-item' + (chat ? ' is-chat' : '') + (unread ? ' is-unread' : '');
            const extra = chat ? ' role="button" tabindex="0"' : '';
            const small = unread ? (unread + ' yeni') : '…';
            return '<span class="' + cls + '" data-presence-key="' + pair[1] + '" title="' + (chat ? (pair[0] + ' ile yazış') : '') + '"' + extra + '><i aria-hidden="true"></i>' + pair[0] + ' <small>' + small + '</small></span>';
        }).join('');
    }

    const NUDGE_COOLDOWN_MS = 8 * 1000;
    const NUDGE_POLL_MS = 2000;
    const nudgeSeen = new Set();
    const nudgeLastSend = Object.create(null);
    let nudgeTimer = 0;
    let nudgeSince = Date.now();
    let nudgePulling = false;
    let nudgeSseBound = false;
    let nudgeAudioCtx = null;
    const NUDGE_STATUS_KEY = 'gpm_nudge_status_v1';
    const NUDGE_STATUS_SHOW_MS = 15 * 60 * 1000;
    const NUDGE_STATUS_WAIT_MS = 2 * 60 * 1000;
    const NUDGE_STATUS_POLL_MS = 3000;
    let nudgeStatusTimer = 0;

    function readNudgeStatus() {
        try {
            const raw = JSON.parse(localStorage.getItem(NUDGE_STATUS_KEY) || 'null');
            return raw && typeof raw === 'object' ? raw : {};
        } catch (e) {
            return {};
        }
    }

    function nudgeStatusLabel(key) {
        const s = readNudgeStatus()[key];
        if (!s || !s.ts || Date.now() - s.ts > NUDGE_STATUS_SHOW_MS) return '';
        if (s.ackAt) return 'okundu ✓ ' + new Date(s.ackAt).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
        return 'çağrıldı…';
    }

    function setNudgeStatus(nudge) {
        if (!nudge || !nudge.id) return;
        const key = presenceSiteKey(nudge.target);
        if (key !== 'AVDAN' && key !== '1.OSB' && !isPersonPresenceKey(key)) return;
        const map = readNudgeStatus();
        const prev = map[key];
        if (prev && prev.id !== nudge.id && Number(prev.ts) > Number(nudge.ts)) return;
        const sameAcked = prev && prev.id === nudge.id && prev.ackAt;
        const ackAt = nudge.ackAt || (sameAcked ? prev.ackAt : null);
        if (prev && prev.id === nudge.id && prev.ackAt === ackAt) return;
        map[key] = { id: String(nudge.id), ts: Number(nudge.ts) || Date.now(), ackAt: ackAt || null };
        try { localStorage.setItem(NUDGE_STATUS_KEY, JSON.stringify(map)); } catch (e) { /* ignore */ }
        if (ackAt && !sameAcked && Date.now() - ackAt < NUDGE_STATUS_WAIT_MS) nudgeToast(key + ' okudu');
        emitPresence(getPresence());
    }

    function hasWaitingNudge() {
        const map = readNudgeStatus();
        return Object.keys(map).some((k) => {
            const s = map[k];
            return s && !s.ackAt && Date.now() - Number(s.ts || 0) < NUDGE_STATUS_WAIT_MS;
        });
    }

    async function pullNudgeStatus() {
        if (!isAmirUser() || !isLikelyLoggedIn()) return;
        try {
            const res = await fetch('/api/nudge/status', { credentials: 'include', cache: 'no-store' });
            if (!res.ok) return;
            const data = await res.json();
            const status = (data && data.status) || {};
            Object.keys(status).forEach((k) => setNudgeStatus(status[k]));
        } catch (e) { /* ignore */ }
    }

    // SSE kopuksa da amir okundu bilgisini görsün: yalnız bekleyen çağrı varken yokla.
    function watchNudgeStatus() {
        if (nudgeStatusTimer) return;
        nudgeStatusTimer = setInterval(() => {
            if (!hasWaitingNudge()) {
                clearInterval(nudgeStatusTimer);
                nudgeStatusTimer = 0;
                return;
            }
            if (!document.hidden) pullNudgeStatus();
        }, NUDGE_STATUS_POLL_MS);
    }

    function ensureNudgeStyle() {
        if (document.getElementById('gpmNudgeStyle')) return;
        const style = document.createElement('style');
        style.id = 'gpmNudgeStyle';
        style.textContent = ''
            + '.presence-item.is-nudge,.presence-item.is-chat{cursor:pointer;user-select:none}'
            + '.presence-item.is-nudge:hover,.presence-item.is-chat:hover{filter:brightness(1.18)}'
            + '.presence-item.is-nudge:focus,.presence-item.is-chat:focus{outline:2px solid rgba(134,239,172,.7);outline-offset:2px}'
            + '.presence-item.is-nudge-off{cursor:not-allowed}'
            + '.presence-item.is-unread small{color:#ea580c;font-weight:800}'
            + 'body.session-amir .presence-item.is-unread small{color:#fdba74}'
            + '.presence-item.is-sending{animation:gpm-nudge-pulse .45s ease}'
            + '.presence-item.is-called{animation:gpm-nudge-called .85s ease}'
            + '@keyframes gpm-nudge-pulse{0%,100%{transform:scale(1)}40%{transform:scale(1.08)}}'
            + '@keyframes gpm-nudge-called{0%,100%{filter:none}25%,70%{color:#fdba74;filter:drop-shadow(0 0 6px rgba(251,146,60,.55))}}'
            + '#gpmNudgeNotice{position:fixed;inset:0;z-index:2147483602;display:flex;align-items:center;justify-content:center;padding:20px;background:rgba(15,23,42,.45);-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px)}'
            + 'html.gpm-nn-open,html.gpm-nn-open body{overflow:hidden}'
            + '.gpm-nn-card{width:min(460px,100%);background:#fff;border-radius:18px;border-top:6px solid #ea580c;box-shadow:0 24px 60px rgba(0,0,0,.35);padding:26px 26px 22px;text-align:center;font-family:"Segoe UI",Tahoma,sans-serif}'
            + '.gpm-nn-icon{width:64px;height:64px;margin:0 auto 10px;border-radius:999px;background:#fff7ed;color:#ea580c;display:flex;align-items:center;justify-content:center;font-size:28px;box-shadow:0 0 0 6px rgba(234,88,12,.12)}'
            + '.gpm-nn-from{font-size:20px;font-weight:800;letter-spacing:.01em;color:#9a3412;line-height:1.3}'
            + '.gpm-nn-text{margin:8px 0 20px;font-size:22px;line-height:1.35;font-weight:800;color:#1c1917}'
            + '.gpm-nn-ok{min-width:160px;border:0;border-radius:12px;background:#ea580c;color:#fff;font:800 17px/1 "Segoe UI",Tahoma,sans-serif;padding:14px 22px;cursor:pointer;box-shadow:0 8px 18px rgba(234,88,12,.35)}'
            + '.gpm-nn-ok:hover{background:#c2410c}'
            + '.gpm-nn-ok:focus{outline:3px solid rgba(234,88,12,.4);outline-offset:3px}'
            + '#gpmNudgeToast{position:fixed;right:16px;bottom:20px;z-index:2147483601;background:#7c2d12;color:#fff7ed;padding:10px 14px;border-radius:10px;font:700 14px/1.35 "Segoe UI",Tahoma,sans-serif;box-shadow:0 10px 28px rgba(124,45,18,.35)}';
        document.head.appendChild(style);
    }

    function nudgeToast(message) {
        const text = String(message || '').trim();
        if (!text) return;
        if (typeof window.showToast === 'function') {
            try { window.showToast(text, 'info', 2400); return; } catch (e) { /* fallback */ }
        }
        ensureNudgeStyle();
        let el = document.getElementById('gpmNudgeToast');
        if (!el) {
            el = document.createElement('div');
            el.id = 'gpmNudgeToast';
            el.setAttribute('role', 'status');
            document.body.appendChild(el);
        }
        el.textContent = text;
        el.style.display = 'block';
        clearTimeout(nudgeToast.hideTimer);
        nudgeToast.hideTimer = setTimeout(() => {
            try { el.style.display = 'none'; } catch (err) { /* ignore */ }
        }, 2400);
    }

    function nudgeAudio() {
        if (nudgeAudioCtx) return nudgeAudioCtx;
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        try { nudgeAudioCtx = new AC(); } catch (e) { return null; }
        return nudgeAudioCtx;
    }

    function unlockNudgeAudio() {
        const ctx = nudgeAudio();
        if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
    }

    function playNudgeBeep() {
        try {
            const ctx = nudgeAudio();
            if (!ctx) return;
            const start = () => {
                const t = ctx.currentTime + 0.02;
                [880, 1174].forEach((freq, i) => {
                    const osc = ctx.createOscillator();
                    const gain = ctx.createGain();
                    osc.type = 'sine';
                    osc.frequency.value = freq;
                    const when = t + i * 0.12;
                    gain.gain.setValueAtTime(0.0001, when);
                    gain.gain.exponentialRampToValueAtTime(0.07, when + 0.015);
                    gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.16);
                    osc.connect(gain);
                    gain.connect(ctx.destination);
                    osc.start(when);
                    osc.stop(when + 0.18);
                });
            };
            if (ctx.state === 'suspended') ctx.resume().then(start).catch(() => {});
            else start();
        } catch (e) { /* ignore */ }
    }

    function flashAmirPresence(key) {
        const sel = '[data-presence-key="' + (presenceSiteKey(key) || 'AMIR') + '"]';
        document.querySelectorAll(sel).forEach((el) => {
            el.classList.remove('is-called');
            void el.offsetWidth;
            el.classList.add('is-called');
            setTimeout(() => { try { el.classList.remove('is-called'); } catch (e) { /* ignore */ } }, 900);
        });
    }

    function playIncomingNudge(nudge) {
        if (!nudge || !nudge.id || nudgeSeen.has(nudge.id)) return;
        const mine = currentKantarSite();
        if (!mine || presenceSiteKey(nudge.target) !== mine) return;
        nudgeSeen.add(nudge.id);
        if (nudge.ts) nudgeSince = Math.max(nudgeSince, Number(nudge.ts) || 0);
        openNudgeNotice(nudge);
        flashAmirPresence(nudge.fromKey || 'AMIR');
    }

    const NUDGE_NOTICE_TEXT = 'Evrakları sevkiyat ofisine gönderin.';
    const NUDGE_ACK_KEY = 'gpm_nudge_ack_v1';
    const NUDGE_REPEAT_MS = 6000;
    const NUDGE_RING_MAX = 10;
    let nudgeNoticeId = '';
    let nudgeRepeatTimer = 0;
    let nudgeRingCount = 0;

    // Kantar PC'de Windows animasyonları kapalı olabilir; CSS animasyonu yerine adım adım transform.
    function shakeElement(el) {
        if (!el) return;
        if (el.__gpmShakeTimer) clearInterval(el.__gpmShakeTimer);
        const steps = [-18, 18, -16, 16, -13, 13, -10, 10, -7, 7, -4, 4, -2, 2, 0];
        let i = 0;
        el.__gpmShakeTimer = setInterval(() => {
            if (i >= steps.length) {
                clearInterval(el.__gpmShakeTimer);
                el.__gpmShakeTimer = 0;
                el.style.transform = '';
                return;
            }
            el.style.transform = 'translateX(' + steps[i] + 'px)';
            i += 1;
        }, 50);
    }

    function ringNudgeNotice() {
        const card = document.querySelector('#gpmNudgeNotice .gpm-nn-card');
        if (!card) return;
        shakeElement(card);
        playNudgeBeep();
        nudgeRingCount += 1;
        // Kantarda kimse yoksa saatlerce çalmasın; not ekranda kalır.
        if (nudgeRingCount >= NUDGE_RING_MAX && nudgeRepeatTimer) {
            clearInterval(nudgeRepeatTimer);
            nudgeRepeatTimer = 0;
        }
    }

    function sendNudgeAck(id) {
        try {
            fetch('/api/nudge/ack', {
                method: 'POST',
                credentials: 'include',
                keepalive: true,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id }),
            }).catch(() => {});
        } catch (e) { /* ignore */ }
    }

    function closeNudgeNotice(broadcast) {
        const root = document.getElementById('gpmNudgeNotice');
        if (nudgeRepeatTimer) clearInterval(nudgeRepeatTimer);
        nudgeRepeatTimer = 0;
        if (broadcast && nudgeNoticeId) {
            try { localStorage.setItem(NUDGE_ACK_KEY, JSON.stringify({ id: nudgeNoticeId, at: Date.now() })); } catch (e) { /* ignore */ }
            sendNudgeAck(nudgeNoticeId);
        }
        nudgeNoticeId = '';
        if (root) root.remove();
        document.documentElement.classList.remove('gpm-nn-open');
    }

    function openNudgeNotice(nudgeOrId) {
        ensureNudgeStyle();
        const nudge = nudgeOrId && typeof nudgeOrId === 'object' ? nudgeOrId : { id: nudgeOrId };
        nudgeNoticeId = String(nudge.id || '');
        let root = document.getElementById('gpmNudgeNotice');
        if (!root) {
            root = document.createElement('div');
            root.id = 'gpmNudgeNotice';
            root.setAttribute('role', 'alertdialog');
            root.setAttribute('aria-modal', 'true');
            root.setAttribute('aria-labelledby', 'gpmNudgeNoticeText');
            root.innerHTML = ''
                + '<div class="gpm-nn-card">'
                + '<div class="gpm-nn-icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h8M8 17h5"/></svg></div>'
                + '<div class="gpm-nn-from">AMİR</div>'
                + '<p class="gpm-nn-text" id="gpmNudgeNoticeText"></p>'
                + '<button type="button" class="gpm-nn-ok">Tamam</button>'
                + '</div>';
            // Arka plana tıklama / Escape kapatmaz; yalnız Tamam.
            root.addEventListener('keydown', (ev) => {
                if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); }
            }, true);
            root.querySelector('.gpm-nn-ok').addEventListener('click', () => closeNudgeNotice(true));
            document.body.appendChild(root);
        }
        const sender = nudgeSenderName(nudge);
        const fromEl = root.querySelector('.gpm-nn-from');
        if (fromEl) fromEl.textContent = sender + ' gönderdi';
        root.querySelector('.gpm-nn-text').textContent = sender + ': ' + String(nudge.text || NUDGE_NOTICE_TEXT);
        document.documentElement.classList.add('gpm-nn-open');
        try { root.querySelector('.gpm-nn-ok').focus({ preventScroll: true }); } catch (e) { /* ignore */ }
        if (nudgeRepeatTimer) clearInterval(nudgeRepeatTimer);
        nudgeRingCount = 0;
        nudgeRepeatTimer = setInterval(ringNudgeNotice, NUDGE_REPEAT_MS);
        ringNudgeNotice();
    }

    try {
        window.addEventListener('storage', (ev) => {
            if (ev.key === NUDGE_STATUS_KEY) {
                emitPresence(getPresence());
                return;
            }
            if (ev.key !== NUDGE_ACK_KEY || !nudgeNoticeId) return;
            closeNudgeNotice(false);
        });
    } catch (e) { /* ignore */ }

    function markPresenceSending(key, on) {
        document.querySelectorAll('[data-presence-key="' + key + '"]').forEach((el) => {
            el.classList.toggle('is-sending', !!on);
        });
    }

    function ensureMsnScript() {
        if (document.getElementById('gpmMsnScript')) return;
        const s = document.createElement('script');
        s.id = 'gpmMsnScript';
        s.src = '/msn-chat.js?v=20261007-chatfree';
        s.async = true;
        document.head.appendChild(s);
    }

    function openMsnChat(key) {
        window.__gpmChatPending = key;
        if (window.MsnChat && typeof window.MsnChat.open === 'function') {
            window.MsnChat.open(key);
            return;
        }
        ensureMsnScript();
    }

    async function sendNudge(target, text) {
        const key = presenceSiteKey(target);
        const person = isPersonPresenceKey(key);
        const mine = presenceSiteKey(currentUserKey());
        if (person) {
            if (!canDirectMessage() || key === mine) return;
        } else if (!isAmirUser() || (key !== 'AVDAN' && key !== '1.OSB')) {
            return;
        }
        const body = String(text || '').trim();
        if (person && !body) {
            nudgeToast('Mesaj yazın');
            return;
        }
        const now = Date.now();
        if (nudgeLastSend[key] && now - nudgeLastSend[key] < NUDGE_COOLDOWN_MS) {
            nudgeToast('Biraz bekleyin');
            return;
        }
        markPresenceSending(key, true);
        try {
            const payload = person ? { target: key, text: body } : { target: key };
            const res = await fetch('/api/nudge', {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            let data = {};
            try { data = await res.json(); } catch (e) { data = {}; }
            if (res.status === 409) {
                nudgeToast((person ? 'Kişi' : key) + ' çevrimdışı');
                return;
            }
            if (res.status === 429) {
                nudgeToast('Biraz bekleyin');
                return;
            }
            if (!res.ok) {
                nudgeToast(person ? 'Mesaj gönderilemedi' : 'Çağrı gönderilemedi');
                return;
            }
            nudgeLastSend[key] = Date.now();
            const who = presencePersonName(key) || key;
            nudgeToast(person ? (who + ' kullanıcısına gönderildi') : (key + ' çağrıldı'));
            if (data && data.nudge) {
                setNudgeStatus(data.nudge);
                watchNudgeStatus();
            }
        } catch (e) {
            nudgeToast(person ? 'Mesaj gönderilemedi' : 'Çağrı gönderilemedi');
        } finally {
            setTimeout(() => markPresenceSending(key, false), 400);
        }
    }

    function onPresenceNudgeActivate(el) {
        if (!el) return;
        const key = presenceSiteKey(el.getAttribute('data-presence-key'));
        if (!canOpenChat(key)) return;
        openMsnChat(key);
    }

    function bindNudgeControls() {
        if (bindNudgeControls.bound) return;
        bindNudgeControls.bound = true;
        document.addEventListener('pointerdown', unlockNudgeAudio, true);
        document.addEventListener('click', (ev) => {
            const el = ev.target && ev.target.closest && ev.target.closest('.presence-item[data-presence-key]');
            if (!el) return;
            onPresenceNudgeActivate(el);
        });
        document.addEventListener('keydown', (ev) => {
            if (ev.key !== 'Enter' && ev.key !== ' ') return;
            const el = ev.target && ev.target.closest && ev.target.closest('.presence-item.is-chat');
            if (!el) return;
            ev.preventDefault();
            onPresenceNudgeActivate(el);
        });
    }

    async function pullNudge() {
        if (!isLikelyLoggedIn() || !currentKantarSite() || nudgePulling) return;
        nudgePulling = true;
        try {
            const res = await fetch('/api/nudge?since=' + encodeURIComponent(String(nudgeSince)), {
                credentials: 'include',
                cache: 'no-store',
            });
            if (!res.ok) return;
            const data = await res.json();
            if (data && data.nudge) playIncomingNudge(data.nudge);
        } catch (e) { /* ignore */ }
        finally { nudgePulling = false; }
    }

    function bindNudgeSse() {
        if (nudgeSseBound) return;
        if (!window.SyncManager || typeof window.SyncManager.on !== 'function') return;
        nudgeSseBound = true;
        window.SyncManager.on('kantar_nudge', (data) => playIncomingNudge(data));
        window.SyncManager.on('kantar_nudge_ack', (data) => {
            if (isAmirUser()) setNudgeStatus(data);
        });
    }

    function startNudge() {
        ensureNudgeStyle();
        bindNudgeControls();
        bindNudgeSse();
        if (isAmirUser() && !startNudge.amirStatusPulled) {
            startNudge.amirStatusPulled = true;
            pullNudgeStatus().then(() => { if (hasWaitingNudge()) watchNudgeStatus(); });
        }
        if (nudgeTimer) return;
        if (!isLikelyLoggedIn() || !currentKantarSite()) return;
        pullNudge();
        nudgeTimer = setInterval(() => {
            bindNudgeSse();
            if (document.hidden) return;
            pullNudge();
        }, NUDGE_POLL_MS);
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) pullNudge();
        });
        window.addEventListener('focus', () => pullNudge());
        window.addEventListener('online', () => pullNudge());
    }

    // PC uykudan dönünce / ağ gelince / sekme öne gelince beklemeden kontrol et.
    // Süre dolmuşsa cihaz anahtarıyla yenilenir; keep-alive zamanlayıcısı uykuda durmuş olabilir.
    let lastWakeCheck = 0;
    function wakeCheck(reason) {
        if (!isLikelyLoggedIn()) return;
        if (Date.now() - lastWakeCheck < 10 * 1000) return;
        lastWakeCheck = Date.now();
        sessionCache.lastCheck = 0;
        checkSessionValidity().then((ok) => {
            if (ok) {
                hideSessionBanner();
                if (!keepAliveInterval) startSessionKeepAlive();
            } else if (renewNeedsPassword()) {
                showSessionBanner('Oturum düştü ve bu cihaz hatırlanmıyor. Şifreyle tekrar giriş yapın.', {
                    actionLabel: 'Giriş ekranı',
                    onAction: () => { try { localStorage.removeItem('isLoggedIn'); } catch (e) {} window.location.href = '/GIRIS.html'; },
                });
            }
        }).catch(() => {});
        void reason;
    }
    try {
        document.addEventListener('visibilitychange', () => { if (!document.hidden) wakeCheck('visible'); });
        window.addEventListener('online', () => wakeCheck('online'));
        window.addEventListener('focus', () => wakeCheck('focus'));
        window.addEventListener('pageshow', () => wakeCheck('pageshow'));
    } catch (e) { /* ignore */ }

    window.SessionManager = {
        startPresence,
        startNudge,
        sendKantarNudge: function (key) { sendNudge(key); },
        presencePersonName,
        getPresence,
        presenceChipHtml,
        markSessionValid,
        invalidateSession,
        checkSessionValidity,
        renewSession,
        renewNeedsPassword,
        ensureSession,
        fetchWithSession,
        showSessionBanner,
        hideSessionBanner,
        requireValidSession,
        isAmirUser,
        clientIsAmir: isAmirUser,
        isSabanUser,
        amirDisplayLabel,
        withSessionCheck,
        addSessionCheckToButton,
        addSessionCheckToForm,
        showSessionExpiredModal,
        hideSessionExpiredModal,
        startSessionKeepAlive,
        stopSessionKeepAlive,
        navigateToHome,
        openAppPage,
        openHomePage,
        openHomeForReprint,
        bindHomeNavigation,
        bindAppPageNavigation,
        claimHomeWindow
    };
    window.clientIsAmir = isAmirUser;
    
    // Sayfa yüklendiğinde ana sayfa linklerini başlat.
    // Keep-alive yalnızca başarılı giriş/doğrulama sonrası markSessionValid() ile başlar.
    function onDomReady() {
        claimHomeWindow();
        bindHomeNavigation();
        bindAppPageNavigation();
        bindNudgeControls();
        if (isLikelyLoggedIn()) {
            startNudge();
            ensureMsnScript();
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', onDomReady);
    } else {
        onDomReady();
    }
    
    // Sayfa kapatılırken temizle
    window.addEventListener('beforeunload', stopSessionKeepAlive);
    
})();
