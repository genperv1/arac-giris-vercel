// piyasa-api.js — window.piyasa API (IIFE sonu)
// Otomatik bölüm — scripts/modularize-remaining.js

  // Dışarıya minimal API aç (app.js Bul butonu buradan çağıracak)
  window.piyasa = window.piyasa || {};
  window.piyasa.hasOrders = ()=> (state.orders && state.orders.length > 0);
  window.piyasa.openOrderPicker = openOrderPicker;
  window.piyasa.closeOrderPicker = function closeOrderPicker() {
    if (typeof window.__piyasaCloseOrderPicker === 'function') window.__piyasaCloseOrderPicker();
    else document.getElementById('piyasaModalClose')?.click();
  };
  window.piyasa.applyOrderToForm = applyOrderToForm;
  window.piyasa.applyOrderFromPicker = applyOrderFromPicker;
  window.piyasa.maybePromptAracBosuBeforePrint = maybePromptAracBosuBeforePrint;
  window.piyasa.isHpFirma = isHpFirma;
  window.piyasa.promptAracBosuTonaj = promptAracBosuTonaj;
  window.piyasa.applyAracBosuToForm = applyAracBosuToForm;
  window.piyasa._state = state;
  window.piyasa.suggestForContext = suggestPiyasaForContext;
  window.piyasa.showSuggestionBar = showPiyasaSuggestionBar;
  window.piyasa.markOrderUsed = markOrderUsed;
  window.piyasa.recordOrderPrint = recordOrderPrint;
  window.piyasa.isDurumFrozen = isDurumFrozen;
  window.piyasa.refreshDurumStatus = refreshDurumStatus;
  window.piyasa.clearAllOrderPrintStats = clearAllOrderPrintStatsInState;
  window.piyasa.reconcileOrderPrintCountsFromReports = reconcileOrderPrintCountsFromReports;
  window.piyasa.getActiveOrderIdx = getActiveOrderIdx;
  window.piyasa.getOrderByIdx = getOrderByIdx;
  window.piyasa.showSkippedRows = showPiyasaSkippedRowsModal;
  window.piyasa.syncFromServer = syncPiyasaFromServer;
  window.piyasa.loadCustomers = loadPiyasaCustomers;
  window.piyasa.openCustomerList = openPiyasaCustomerListModal;
  window.piyasa.getCustomerByKod = getPiyasaCustomerByKod;

  // Chip'ten çağrılmak için modal açma fonksiyonu
  window.__piyasaShowOrdersModalImpl = function() {
    if (!state.orders || !state.orders.length) {
      try { loadState(); } catch (e) {}
    }
    if (state.orders && state.orders.length > 0) {
      openOrderPicker();
      return;
    }
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const payload = JSON.parse(raw);
        if (applyPayloadToState(payload, { force: true }) && state.orders.length > 0) {
          openOrderPicker();
          return;
        }
      }
    } catch (e) {}
    alert('❌ PİYASA Excel yüklü değil ya da sipariş yok.');
  };
  window.piyasaShowOrdersModal = window.__piyasaShowOrdersModalImpl;

  window.__initPiyasaModuleImpl = init;
  window.initPiyasaModule = init;
  window.__piyasaRebind = bind;
