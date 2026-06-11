// app-sync-handlers.js — SSE / sekme senkronu
// Otomatik bölüm — scripts/split-large-files.js

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
    window.SyncManager.on('connected', (data, meta) => {
      console.log('🔄 Connected to synchronization server:', data || meta);
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



