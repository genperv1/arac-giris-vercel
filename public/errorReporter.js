// errorReporter.js
// "Tek tık hata raporu" için global error yakalama + UI (🐞)
// - window.onerror / unhandledrejection yakalar
// - Son aksiyonları (Report varsa) ve son hataları tek JSON olarak kopyalatır

(function(){
  'use strict';

  const ERR_KEY = 'error_events_v1';
  const MAX = 150;

  function _read(){
    try{
      const raw = localStorage.getItem(ERR_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    }catch(e){ return []; }
  }

  function _write(arr){
    try{ localStorage.setItem(ERR_KEY, JSON.stringify(arr)); return true; }catch(e){ return false; }
  }

  function addError(payload){
    try{
      const ev = {
        id: 'ER' + Date.now().toString(36) + Math.random().toString(16).slice(2),
        ts: Date.now(),
        iso: new Date().toISOString(),
        userId: (localStorage.getItem('currentUserId') || ''),
        payload: payload || {}
      };
      const arr = _read();
      arr.unshift(ev);
      if (arr.length > MAX) arr.length = MAX;
      _write(arr);

      // Report katmanı varsa oraya da düş (rapor.html zaten bunu okuyabiliyor)
      // report event removed: ERROR

      return ev;
    }catch(e){ return null; }
  }

  function getErrors(){
    return _read();
  }

  function clear(){
    try{ localStorage.removeItem(ERR_KEY); }catch(e){}
  }

  function _safeString(v){
    try{
      if (v === null || v === undefined) return '';
      if (typeof v === 'string') return v;
      return JSON.stringify(v);
    }catch(e){
      return String(v);
    }
  }

  // Global yakalayıcılar
  window.addEventListener('error', function(ev){
    try{
      addError({
        where: 'window.error',
        message: ev?.message || 'Script error',
        filename: ev?.filename || '',
        lineno: ev?.lineno || null,
        colno: ev?.colno || null,
        stack: ev?.error?.stack || '',
      });
    }catch(e){}
  });

  window.addEventListener('unhandledrejection', function(ev){
    try{
      const reason = ev?.reason;
      addError({
        where: 'unhandledrejection',
        reason: _safeString(reason),
        stack: reason?.stack || '',
      });
    }catch(e){}
  });

  function snapshot(){
    const dailyMeta = (window.DailyStore && typeof DailyStore.getMeta === 'function') ? (DailyStore.getMeta() || {}) : {};
    const dailyCount = (window.DailyStore && typeof DailyStore.getRows === 'function') ? ((DailyStore.getRows() || []).length) : null;

    let reportEvents = [];
    try{
      if (window.Report && typeof Report.getEvents === 'function') reportEvents = Report.getEvents() || [];
    }catch(e){}

    const errors = getErrors();
    return {
      at: new Date().toISOString(),
      userId: (localStorage.getItem('currentUserId') || ''),
      page: location?.href || '',
      userAgent: navigator?.userAgent || '',
      daily: { meta: dailyMeta, count: dailyCount },
      recentActions: reportEvents.slice(0, 40),
      recentErrors: errors.slice(0, 40),
    };
  }

  // --- UI ---
  function ensureUI(){
    if (document.getElementById('errorReporterBtn')) return;

    const btn = document.createElement('button');
    btn.id = 'errorReporterBtn';
    btn.type = 'button';
    btn.textContent = '🐞';
    btn.title = 'Hata Raporu';
    btn.style.position = 'fixed';
    btn.style.right = '14px';
    btn.style.bottom = '14px';
    btn.style.zIndex = '99999';
    btn.style.width = '44px';
    btn.style.height = '44px';
    btn.style.borderRadius = '999px';
    btn.style.border = 'none';
    btn.style.cursor = 'pointer';
    btn.style.boxShadow = '0 10px 22px rgba(0,0,0,.22)';
    btn.style.background = '#111827';
    btn.style.color = '#fff';

    // Modal
    const modal = document.createElement('div');
    modal.id = 'errorReporterModal';
    modal.style.position = 'fixed';
    modal.style.inset = '0';
    modal.style.zIndex = '99998';
    modal.style.display = 'none';
    modal.style.background = 'rgba(0,0,0,.55)';

    modal.innerHTML = `
      <div style="max-width: 980px; margin: 6vh auto; background: #fff; border-radius: 16px; overflow: hidden; box-shadow: 0 20px 60px rgba(0,0,0,.35);">
        <div style="display:flex; align-items:center; justify-content:space-between; gap:12px; padding: 12px 14px; background:#111827; color:#fff;">
          <div style="font-weight:700;">🐞 Hata Raporu</div>
          <div style="display:flex; gap:8px;">
            <button id="erCopy" style="background:#2563eb; color:#fff; border:none; padding:8px 12px; border-radius:10px; cursor:pointer;">Kopyala</button>
            <button id="erClear" style="background:#dc2626; color:#fff; border:none; padding:8px 12px; border-radius:10px; cursor:pointer;">Temizle</button>
            <button id="erClose" style="background:#6b7280; color:#fff; border:none; padding:8px 12px; border-radius:10px; cursor:pointer;">Kapat</button>
          </div>
        </div>
        <div style="padding: 14px;">
          <div style="font-size:12px; color:#6b7280; margin-bottom:10px;">
            Bu JSON'u kopyalayıp bana gönder. (Son aksiyonlar + son hatalar + Excel meta)
          </div>
          <textarea id="erText" style="width:100%; height: 54vh; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace; font-size: 12px; padding: 12px; border: 1px solid #e5e7eb; border-radius: 12px; background:#f9fafb;"></textarea>
        </div>
      </div>
    `;

    function open(){
      const data = snapshot();
      const ta = modal.querySelector('#erText');
      if (ta) ta.value = JSON.stringify(data, null, 2);
      modal.style.display = 'block';
    }

    function close(){
      modal.style.display = 'none';
    }

    btn.addEventListener('click', open);
    modal.addEventListener('click', (e)=>{
      if (e.target === modal) close();
    });
    modal.querySelector('#erClose')?.addEventListener('click', close);
    modal.querySelector('#erCopy')?.addEventListener('click', async ()=>{
      try{
        const ta = modal.querySelector('#erText');
        const txt = ta ? ta.value : JSON.stringify(snapshot(), null, 2);
        await navigator.clipboard.writeText(txt);
        alert('✅ Kopyalandı');
      }catch(e){
        alert('❌ Kopyalanamadı');
      }
    });
    modal.querySelector('#erClear')?.addEventListener('click', ()=>{
      if (!confirm('Hata kayıtları temizlensin mi?')) return;
      clear();
      try{ if (window.Report && typeof Report.clearEvents === 'function') Report.clearEvents(); }catch(e){}
      open();
    });

    // UI disabled: do not append modal or button to the page
    // document.body.appendChild(modal);
    // document.body.appendChild(btn);
  }

  // UI disabled: hotkey and automatic DOM append removed to avoid floating button
  // window.addEventListener('keydown', ... ) removed
  // document.addEventListener('DOMContentLoaded', ... ) removed

  window.ErrorReporter = {
    addError,
    getErrors,
    clear,
    snapshot,
  };
})();
