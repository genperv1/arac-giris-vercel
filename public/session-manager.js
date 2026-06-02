// session-manager.js
// Oturum yönetimi ve kontrol fonksiyonları
(function() {
    'use strict';
    
    // Oturum kontrolü için API endpoint
    const SESSION_CHECK_ENDPOINT = '/api/me';
    const SESSION_CACHE_VALID_MS = 5 * 60 * 1000;   // geçerli oturumda /api/me en fazla 5 dk'da bir
    const SESSION_CACHE_INITIAL_MS = 2 * 60 * 1000; // ilk kontrollerde 2 dk
    const KEEPALIVE_INTERVAL_MS = 20 * 60 * 1000;   // arka plan kontrolü 20 dk
    const SESSION_NETWORK_GRACE_MS = 3 * 60 * 1000; // ağ/sunucu hatasında kısa süre modal gösterme
    
    // Oturum durumunu cache'lemek için
    let sessionCache = {
        isValid: false,
        lastCheck: 0,
        checkInterval: SESSION_CACHE_INITIAL_MS
    };
    
    // Oturum süresi dolu uyarısını göstermek için
    let isShowingSessionExpired = false;
    
    // Server'a oturum durumunu kontrol et
    async function checkSessionValidity() {
        const now = Date.now();
        
        // Cache: geçerli oturumda gereksiz /api/me çağrısı yapma
        if (sessionCache.isValid && (now - sessionCache.lastCheck) < sessionCache.checkInterval) {
            return true;
        }
        
        function applyNetworkGrace() {
            if (sessionCache.isValid && (now - sessionCache.lastCheck) < SESSION_NETWORK_GRACE_MS) {
                return true;
            }
            return null;
        }
        
        try {
            const response = await fetch(SESSION_CHECK_ENDPOINT, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                    'Cache-Control': 'no-cache'
                },
                credentials: 'include'
            });
            
            if (!response.ok) {
                // 401/403: gerçek oturum bitişi; 5xx: geçici sunucu sorunu
                if (response.status === 401 || response.status === 403) {
                    sessionCache = { isValid: false, lastCheck: now, checkInterval: 0 };
                    return false;
                }
                const grace = applyNetworkGrace();
                if (grace !== null) return grace;
                sessionCache = { isValid: false, lastCheck: now, checkInterval: 0 };
                return false;
            }
            
            const isValid = true;
            sessionCache = {
                isValid: isValid,
                lastCheck: now,
                checkInterval: SESSION_CACHE_VALID_MS
            };
            
            return isValid;
        } catch (error) {
            console.error('Oturum kontrolü sırasında hata:', error);
            const grace = applyNetworkGrace();
            if (grace !== null) return grace;
            sessionCache = {
                isValid: false,
                lastCheck: now,
                checkInterval: 0
            };
            return false;
        }
    }
    
    // Oturum süresi dolu uyarısını göster
    function showSessionExpiredModal() {
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
                            Oturum Aç
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
    function redirectToLogin() {
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
        'sorunlar.html': 'gpm_page_sorunlar',
        'ayarlar.html': 'gpm_page_ayarlar',
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
        const isValid = await checkSessionValidity();
        
        if (!isValid) {
            showSessionExpiredModal();
            return false;
        }
        
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
        if (isHomePath(window.location.pathname)) return;
        keepAliveInterval = setInterval(async () => {
            try {
                const isValid = await checkSessionValidity();
                if (!isValid && !isHomePath(window.location.pathname)) {
                    stopSessionKeepAlive();
                    showSessionExpiredModal();
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
    
    // Public API
    window.SessionManager = {
        checkSessionValidity,
        requireValidSession,
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
        bindHomeNavigation,
        bindAppPageNavigation,
        claimHomeWindow
    };
    
    // Sayfa yüklendiğinde keep alive ve ana sayfa linklerini başlat
    function onDomReady() {
        claimHomeWindow();
        startSessionKeepAlive();
        bindHomeNavigation();
        bindAppPageNavigation();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', onDomReady);
    } else {
        onDomReady();
    }
    
    // Sayfa kapatılırken temizle
    window.addEventListener('beforeunload', stopSessionKeepAlive);
    
})();
