// app-sync-handlers.js — SSE / sekme senkronu
// Otomatik bölüm — scripts/split-large-files.js

(function() {
  'use strict';

  function initSyncHandlers() {
    if (!window.SyncManager) {
      setTimeout(initSyncHandlers, 100);
      return;
    }

    window.SyncManager.on('vehicle_created', () => {
      refreshVehicleList();
    });

    window.SyncManager.on('vehicle_updated', () => {
      refreshVehicleList();
      try { _ihracatRefreshOpenModalStatuses(); } catch (_) {}
    });

    window.SyncManager.on('vehicle_deleted', (data) => {
      refreshVehicleList();
      if (window.storage && typeof window.storage.delete === 'function' && data && data.id) {
        window.storage.delete(`vehicle_${data.id}`);
      }
    });

    window.SyncManager.on('new_report', () => {
      if (typeof refreshReportCache === 'function') refreshReportCache();
    });

    window.SyncManager.on('report_deleted', () => {
      if (typeof refreshReportCache === 'function') refreshReportCache();
      try { _ihracatOnReportsChanged(); } catch (e) {}
    });

    window.SyncManager.on('reports_deleted', () => {
      if (typeof refreshReportCache === 'function') refreshReportCache();
      try { _ihracatOnReportsChanged(); } catch (e) {}
    });

    window.SyncManager.on('manual_refresh', (data) => {
      switch (data && data.dataType) {
        case 'vehicles':
          refreshVehicleList();
          break;
        case 'reports':
          if (typeof refreshReportCache === 'function') refreshReportCache();
          break;
        case 'all':
          refreshVehicleList();
          if (typeof refreshReportCache === 'function') refreshReportCache();
          break;
      }
    });

    window.SyncManager.on('print_layout_updated', () => {
      try {
        if (window.PrintLayoutSettings && typeof window.PrintLayoutSettings.ensureSynced === 'function') {
          window.PrintLayoutSettings.ensureSynced().then(() => {
            try {
              const root = document.getElementById('printLayoutEditor');
              if (root && typeof root.__pleRefresh === 'function') root.__pleRefresh();
            } catch (e) {}
          }).catch(() => {});
        }
      } catch (e) {}
    });
  }

  function refreshVehicleList() {
    try {
      const applyUi = () => {
        try {
          if (typeof state !== 'undefined' && window.storage && typeof window.storage.loadAll === 'function') {
            state.vehicles = window.storage.loadAll();
          }
        } catch (e) {}
        try {
          if (typeof refreshAppPartial === 'function') refreshAppPartial();
          else if (typeof updateVehicleList === 'function') updateVehicleList();
        } catch (e) {}
      };

      if (window.storage && typeof window.storage._readAll === 'function') {
        window.storage._readAll().then(applyUi).catch(() => applyUi());
      } else {
        applyUi();
      }
    } catch (err) {
      console.warn('Error in refreshVehicleList:', err);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSyncHandlers);
  } else {
    initSyncHandlers();
  }

  window.triggerCrossTabRefresh = (dataType, data) => {
    if (window.SyncManager) {
      window.SyncManager.triggerRefresh(dataType, data);
    }
  };
})();
