// idb.js
// Basit IndexedDB yardımcı katmanı (offline HTML projeleri için)
// - async API verir.
// - Üst katman (DailyStore vb.) memory-cache ile senkron kullanım sağlayabilir.

(function(){
  'use strict';

  const DB_NAME = 'arac_giris_db_v1';
  const DB_VERSION = 1;
  const KV_STORE = 'kv'; // key-value store

  let _dbPromise = null;

  function openDB(){
    if (_dbPromise) return _dbPromise;

    _dbPromise = new Promise((resolve, reject)=>{
      try{
        const req = indexedDB.open(DB_NAME, DB_VERSION);

        req.onupgradeneeded = function(){
          const db = req.result;
          if (!db.objectStoreNames.contains(KV_STORE)) {
            db.createObjectStore(KV_STORE, { keyPath: 'key' });
          }
        };

        req.onsuccess = function(){
          resolve(req.result);
        };

        req.onerror = function(){
          reject(req.error || new Error('IndexedDB open error'));
        };
      } catch (e) {
        reject(e);
      }
    });

    return _dbPromise;
  }

  async function kvGet(key){
    const db = await openDB();
    return new Promise((resolve, reject)=>{
      try{
        const tx = db.transaction(KV_STORE, 'readonly');
        const store = tx.objectStore(KV_STORE);
        const req = store.get(String(key));
        req.onsuccess = () => resolve(req.result ? req.result.value : undefined);
        req.onerror = () => reject(req.error || new Error('kvGet error'));
      } catch (e) {
        reject(e);
      }
    });
  }

  async function kvSet(key, value){
    const db = await openDB();
    return new Promise((resolve, reject)=>{
      try{
        const tx = db.transaction(KV_STORE, 'readwrite');
        const store = tx.objectStore(KV_STORE);
        const req = store.put({ key: String(key), value });
        req.onsuccess = () => resolve(true);
        req.onerror = () => reject(req.error || new Error('kvSet error'));
      } catch (e) {
        reject(e);
      }
    });
  }

  async function kvDel(key){
    const db = await openDB();
    return new Promise((resolve, reject)=>{
      try{
        const tx = db.transaction(KV_STORE, 'readwrite');
        const store = tx.objectStore(KV_STORE);
        const req = store.delete(String(key));
        req.onsuccess = () => resolve(true);
        req.onerror = () => reject(req.error || new Error('kvDel error'));
      } catch (e) {
        reject(e);
      }
    });
  }

  // Feature detection
  function isAvailable(){
    try{
      return typeof indexedDB !== 'undefined';
    } catch (e) {
      return false;
    }
  }

  window.IDBStore = {
    DB_NAME,
    isAvailable,
    openDB,
    kvGet,
    kvSet,
    kvDel,
  };
})();
