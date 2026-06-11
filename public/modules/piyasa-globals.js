// piyasa-globals.js — tüm piyasa parçalarının paylaştığı global değişkenler
// (Ayrı <script> dosyalarında const/let dosyalar arası görünmez; var + window kullanılır.)

(function initPiyasaGlobals() {
  if (window.__piyasaGlobalsReady) return;
  window.__piyasaGlobalsReady = true;

  window.STORAGE_KEY = 'piyasa_state_v1';

  if (!window.__PIYASA_STATE__ || typeof window.__PIYASA_STATE__ !== 'object') {
    window.__PIYASA_STATE__ = {
      orders: [],
      weekArchive: [],
      week: null,
      sheet: null,
      loadedAt: null,
      sheetDate: null,
      sheetDateRaw: null,
      fileFingerprint: null,
      lastImportReport: null,
      lastSkippedRows: [],
      _lastAppliedOrder: null,
    };
  }
  window.state = window.__PIYASA_STATE__;

  window._localSyncTs = window._localSyncTs || 0;
  window._syncInFlight = window._syncInFlight || false;
  window._pickerRenderHook = window._pickerRenderHook || null;

  window.CUSTOMER_LIST_LS_KEY = 'piyasa_customer_list_cache_v2';
  window.CUSTOMER_LIST_PASSWORD = '2026genper';
  window.DURUM_RESET_EPOCH_LS = 'piyasa_durum_reset_epoch_v1';
  window._durumStatus = window._durumStatus || {
    frozen: false,
    freezeUntil: 0,
    durumCountStartMs: 0,
    resetEpoch: 0,
    message: '',
  };

  window._customerStore = window._customerStore || {
    customers: [],
    byKod: new Map(),
    searchIndex: [],
    updatedAt: 0,
    loaded: false,
    loading: false,
    source: '',
  };

  window.PIYASA_MODAL_LAYER_ATTR = 'data-piyasa-modal-layer';
  window.PIYASA_Z_BASE = 1000060;
  window.PIYASA_Z_LAYER = 1000070;
  window.PIYASA_Z_TOP = 1000080;

  // Chip / menü tıklanmadan önce API hazır olsun (parçalar yüklenene kadar kuyruk)
  window.piyasaShowOrdersModal = window.piyasaShowOrdersModal || function piyasaShowOrdersModalStub() {
    if (typeof window.__piyasaShowOrdersModalImpl === 'function') {
      return window.__piyasaShowOrdersModalImpl();
    }
    if (window.piyasa && typeof window.piyasa.openOrderPicker === 'function') {
      return window.piyasa.openOrderPicker();
    }
    if (typeof showToast === 'function') {
      showToast('❌ Piyasa modülü henüz yüklenmedi. Sayfayı yenileyin (Ctrl+F5).', 'error');
    } else {
      alert('❌ Piyasa modülü henüz yüklenmedi. Sayfayı yenileyin.');
    }
  };

  window.initPiyasaModule = window.initPiyasaModule || function initPiyasaModuleStub() {
    if (typeof window.__initPiyasaModuleImpl === 'function') {
      return window.__initPiyasaModuleImpl();
    }
  };
})();
