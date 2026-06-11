// 🔄 Cross-Tab Synchronization Manager
// Provides real-time data synchronization across multiple browser tabs/windows
(function() {
  'use strict';

  // Configuration
  const CONFIG = {
    RECONNECT_DELAY: 3000,
    MAX_RECONNECT_ATTEMPTS: 50,
    STORAGE_KEY: 'sync_last_update',
    TAB_ID_KEY: 'sync_tab_id',
    HEARTBEAT_INTERVAL: 30000
  };

  // State management
  let eventSource = null;
  let reconnectTimeout = null;
  let reconnectAttempts = 0;
  let isTabActive = true;
  let tabId = null;
  let heartbeatInterval = null;
  let lastEventTimestamp = 0;

  // Event handlers registry
  const eventHandlers = new Map();

  // Tab communication via localStorage events
  class TabCommunicator {
    constructor() {
      this.setupListeners();
    }

    setupListeners() {
      try {
        window.addEventListener('storage', (e) => {
          if (e.key === CONFIG.STORAGE_KEY) {
            try {
              const data = JSON.parse(e.newValue || '{}');
              if (data.tabId !== tabId && data.timestamp > lastEventTimestamp) {
                this.handleCrossTabEvent(data);
              }
            } catch (err) {
              console.warn('Failed to parse cross-tab event:', err);
            }
          }
        });

        // Generate unique tab ID
        tabId = this.generateTabId();
        localStorage.setItem(CONFIG.TAB_ID_KEY, tabId);

        // Cleanup on tab close
        window.addEventListener('beforeunload', () => {
          this.cleanup();
        });

      } catch (err) {
        console.warn('Tab communicator setup failed:', err);
      }
    }

    generateTabId() {
      return 'tab_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }

    broadcastEvent(type, data) {
      try {
        const eventData = {
          type,
          data,
          timestamp: Date.now(),
          tabId: tabId
        };

        // Store in localStorage for other tabs
        localStorage.setItem(CONFIG.STORAGE_KEY, JSON.stringify(eventData));

        // Trigger localStorage event manually for same tab
        setTimeout(() => {
          localStorage.removeItem(CONFIG.STORAGE_KEY);
        }, 100);

        return true;
      } catch (err) {
        console.warn('Failed to broadcast cross-tab event:', err);
        return false;
      }
    }

    handleCrossTabEvent(eventData) {
      try {
        const handlers = eventHandlers.get(eventData.type);
        if (handlers && handlers.length > 0) {
          handlers.forEach(handler => {
            try {
              handler(eventData.data, eventData);
            } catch (err) {
              console.error('Handler error for event', eventData.type, err);
            }
          });
        }
      } catch (err) {
        console.warn('Failed to handle cross-tab event:', err);
      }
    }

    cleanup() {
      try {
        if (tabId) {
          localStorage.removeItem(CONFIG.TAB_ID_KEY);
        }
        if (heartbeatInterval) {
          clearInterval(heartbeatInterval);
        }
      } catch (err) {
        // Ignore cleanup errors
      }
    }
  }

  // Server-Sent Events manager
  class SSEManager {
    constructor() {
      this.tabCommunicator = new TabCommunicator();
    }

    connect() {
      if (eventSource) {
        this.disconnect();
      }

      try {
        console.log('🔄 Connecting to SSE stream...');
        
        // Try new unified endpoint first, fallback to legacy
        const endpoint = '/api/events-stream';
        
        eventSource = new EventSource(endpoint);
        
        eventSource.onopen = () => {
          console.log('✅ Connected to real-time synchronization');
          reconnectAttempts = 0;
          if (reconnectTimeout) {
            clearTimeout(reconnectTimeout);
            reconnectTimeout = null;
          }
          this.startHeartbeat();
        };

        eventSource.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            this.handleServerEvent(data);
            lastEventTimestamp = Date.now();
          } catch (err) {
            console.error('Failed to parse SSE message:', err);
          }
        };

        eventSource.onerror = (error) => {
          // SSE kopması oturumu sonlandırmaz; yalnızca canlı senkronu etkiler
          const state = eventSource ? eventSource.readyState : EventSource.CLOSED;
          if (state === EventSource.CONNECTING) {
            console.warn('SSE yeniden bağlanıyor...');
            return;
          }
          console.warn('SSE bağlantısı koptu, yeniden denenecek');
          this.disconnect();
          this.scheduleReconnect();
        };

      } catch (error) {
        console.error('Failed to create EventSource:', error);
        this.scheduleReconnect();
      }
    }

    disconnect() {
      if (eventSource) {
        eventSource.close();
        eventSource = null;
      }
      if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
        heartbeatInterval = null;
      }
    }

    scheduleReconnect() {
      if (reconnectAttempts >= CONFIG.MAX_RECONNECT_ATTEMPTS) {
        console.warn('🔄 Max reconnection attempts reached');
        return;
      }

      if (!reconnectTimeout) {
        reconnectAttempts++;
        const delay = CONFIG.RECONNECT_DELAY * Math.pow(1.5, reconnectAttempts - 1);
        
        console.log(`🔄 Scheduling reconnection attempt ${reconnectAttempts} in ${delay}ms`);
        
        reconnectTimeout = setTimeout(() => {
          reconnectTimeout = null;
          this.connect();
        }, delay);
      }
    }

    startHeartbeat() {
      if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
      }

      heartbeatInterval = setInterval(() => {
        if (eventSource && eventSource.readyState === EventSource.OPEN) {
          // Send heartbeat via a lightweight API call
          fetch('/api/heartbeat', { 
            method: 'HEAD',
            credentials: 'same-origin'
          }).catch(() => {
            // Ignore heartbeat failures
          });
        }
      }, CONFIG.HEARTBEAT_INTERVAL);
    }

    handleServerEvent(event) {
      try {
        // Broadcast to other tabs
        this.tabCommunicator.broadcastEvent(event.type, event.data);

        // Handle locally
        this.handleLocalEvent(event.type, event.data);

      } catch (err) {
        console.error('Failed to handle server event:', err);
      }
    }

    handleLocalEvent(type, data) {
      const handlers = eventHandlers.get(type);
      if (handlers && handlers.length > 0) {
        handlers.forEach(handler => {
          try {
            handler(data, { source: 'server', type });
          } catch (err) {
            console.error('Handler error for event', type, err);
          }
        });
      }
    }
  }

  // Public API
  const SyncManager = {
    // Initialize synchronization
    init() {
      if (!window.EventSource) {
        console.warn('EventSource not supported, cross-tab sync disabled');
        return false;
      }

      const sseManager = new SSEManager();
      
      // Connect immediately
      sseManager.connect();

      // Reconnect when page becomes visible
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden && isTabActive) {
          sseManager.connect();
        }
      });

      // Handle page focus
      window.addEventListener('focus', () => {
        isTabActive = true;
        if (!eventSource) {
          sseManager.connect();
        }
      });

      window.addEventListener('blur', () => {
        isTabActive = false;
      });

      // Store manager instance
      this._sseManager = sseManager;
      
      return true;
    },

    // Register event handler
    on(eventType, handler) {
      if (!eventHandlers.has(eventType)) {
        eventHandlers.set(eventType, []);
      }
      eventHandlers.get(eventType).push(handler);
    },

    // Remove event handler
    off(eventType, handler) {
      const handlers = eventHandlers.get(eventType);
      if (handlers) {
        const index = handlers.indexOf(handler);
        if (index > -1) {
          handlers.splice(index, 1);
        }
      }
    },

    // Manual refresh trigger
    triggerRefresh(dataType, data) {
      if (this._sseManager) {
        this._sseManager.tabCommunicator.broadcastEvent('manual_refresh', {
          dataType,
          data,
          timestamp: Date.now()
        });
      }
    },

    // Get connection status
    isConnected() {
      return eventSource && eventSource.readyState === EventSource.OPEN;
    },

    // Get tab ID
    getTabId() {
      return tabId;
    },

    // Cleanup
    destroy() {
      if (this._sseManager) {
        this._sseManager.disconnect();
        this._sseManager.tabCommunicator.cleanup();
      }
      eventHandlers.clear();
    }
  };

  // Auto-initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      SyncManager.init();
    });
  } else {
    SyncManager.init();
  }

  // Expose globally
  window.SyncManager = SyncManager;

})();
