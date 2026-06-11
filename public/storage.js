// storage.js
// Araç kayıtlarını SQLite (sunucu) üzerinde tutar, memory cache + localStorage fallback ile.
// Ensure Authorization header is attached to all fetch calls (useful for pages that
// include this script directly, e.g. rapor.html)
(function(){
  try {
    const origFetch = window.fetch.bind(window);
    window.fetch = function(input, init){
      try {
        init = init || {};
        if (!init.credentials) init.credentials = 'same-origin';
      } catch(e){}
      return origFetch(input, init);
    };
  } catch(e){}
})();
// API endpoints: GET /api/vehicles, POST /api/vehicles, DELETE /api/vehicles/:id
(() => {
  const storage = {
    _KEY: 'vehicles',
    _cache: null,
    _loaded: false,
    _readPromise: null,

    /** Oturum açıldığında veya yeniden yüklemede cache'i sıfırla */
    invalidate() {
      storage._cache = [];
      storage._loaded = false;
      storage._readPromise = null;
    },

    _readAll: async () => {
      if (storage._readPromise) return storage._readPromise;

      storage._readPromise = (async () => {
        try {
          const resp = await fetch('/api/vehicles?limit=20000', { credentials: 'same-origin' });
          if (resp.ok) {
            const vehicles = await resp.json();
            storage._cache = Array.isArray(vehicles) ? vehicles : [];
            storage._loaded = true;
            return storage._cache;
          }
          // 401 vb. — tekrar denenebilsin diye _loaded false kalsın
          if (resp.status === 401 || resp.status === 403) {
            storage._loaded = false;
          }
        } catch (e) {
          storage._loaded = false;
        }
        if (!Array.isArray(storage._cache)) storage._cache = [];
        return storage._cache;
      })();

      try {
        return await storage._readPromise;
      } finally {
        storage._readPromise = null;
      }
    },

    _writeAll: async (vehicles) => {
      const arr = Array.isArray(vehicles) ? vehicles : [];
      storage._cache = arr;

      // Server'a yaz (SQLite)
      try {
        for (const v of arr) {
          try {
            const res = await fetch('/api/vehicles', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(v)
            });
            if (!res.ok) {
              try { const txt = await res.text(); console.warn('POST /api/vehicles failed', res.status, txt); } catch(e) { console.warn('POST /api/vehicles failed', res.status); }
            }
          } catch (e) { console.warn('POST /api/vehicles error', e); }
        }
      } catch (e) {}

      // localStorage fallback removed (no-op)
    },

    // SENKRON: cache'i döndür (hızlı fallback)
    loadAll: () => {
      if (Array.isArray(storage._cache)) return storage._cache;
      // No local fallback available; ensure empty cache
      storage._cache = [];
      return storage._cache;
    },

    save: (key, data) => {
      const vehicles = storage.loadAll();
      const id =
        (data && data.id) ? String(data.id) :
        (String(key).startsWith('vehicle_') ? String(key).slice(8) : null);

      if (!id) return;

      const idx = vehicles.findIndex(v => String(v.id) === id);
      if (idx >= 0) vehicles[idx] = data;
      else vehicles.push(data);

      storage._cache = vehicles;
      // localStorage write removed (no-op)

      // Arkada server'a yaz (fire-and-forget) - GEÇİCİ OLARAK DEVRE DIŞI
      // Rate limit ve IP ban sorununu önlemek için otomatik sync kapatıldı
      try {
        // Sadece manuel kaydetme工作时才发送到server
        // fetch('/api/vehicles', {
        //   method: 'POST',
        //   headers: { 'Content-Type': 'application/json' },
        //   body: JSON.stringify(payload)
        // }).then(async (res)=>{
        //   if (!res.ok) {
        //     try { const txt = await res.text(); console.warn('POST /api/vehicles failed', res.status, txt); } catch(e) { console.warn('POST /api/vehicles failed', res.status); }
        //   }
        // }).catch((e)=>{ console.warn('POST /api/vehicles error', e); });
      } catch (e) {}
    },

    load: (key) => {
      const vehicles = storage.loadAll();
      const id = String(key).startsWith('vehicle_') ? String(key).slice(8) : null;
      if (!id) return null;
      return vehicles.find(v => String(v.id) === id) || null;
    },

    delete: (key) => {
      const vehicles = storage.loadAll();
      const id = String(key).startsWith('vehicle_') ? String(key).slice(8) : null;
      if (!id) return;

      const filtered = vehicles.filter(v => String(v.id) !== id);
      storage._cache = filtered;
      // localStorage write removed (no-op)

      // Arkada server'dan sil (fire-and-forget) - TAMAMEN DEVRE DIŞI
      // Çift silme işlemi yapıyor ve rate limit aşıyor IP ban atıyor
      // Sadece app.js üzerinden silme işlemi yapılacak
      // try {
      //   fetch(`/api/vehicles/${id}`, { 
      //     method: 'DELETE',
      //     credentials: 'include',
      //     headers: {
      //       'Content-Type': 'application/json'
      //     }
      //   }).catch(()=>{});
      // } catch (e) {}
    }
  };

  window.storage = storage;

  // Boot: sunucudan veri çekme; giriş doğrulanana kadar _loaded false kalsın (ilk girişte boş liste hatasını önler).
  try {
    storage._cache = [];
    storage._loaded = false;
  } catch (e) {
    storage._cache = [];
    storage._loaded = false;
  }
})();
