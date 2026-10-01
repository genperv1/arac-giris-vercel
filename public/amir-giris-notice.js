(function () {
  'use strict';

  const queue = [];
  const seen = new Set();
  let showing = false;
  let pollTimer = 0;

  function isAmir() {
    try {
      if (window.SessionManager && typeof window.SessionManager.isAmirUser === 'function') {
        return !!window.SessionManager.isAmirUser();
      }
      const role = String(localStorage.getItem('currentUserRole') || '').trim().toLowerCase();
      const id = String(localStorage.getItem('currentUserId') || '').trim().toLowerCase();
      return role === 'amir' || id === 'xxr';
    } catch (e) {
      return false;
    }
  }

  function showPlate(raw) {
    const n = String(raw || '').trim();
    if (!n) return '';
    if (typeof formatPlakaForInput === 'function') {
      try {
        const formatted = formatPlakaForInput(n);
        if (formatted) return String(formatted).trim();
      } catch (e) {}
    }
    return n;
  }

  function firmaFromPending(pending) {
    const snap = (pending && pending.snapshot) || {};
    const payload = (pending && pending.printPayload) || {};
    let name = String(snap.firmaAdi || payload.firmaAdi || '').trim();
    let code = String(
      snap.firmaKodu || snap.firmaSelect || payload.firma || payload.firmaKodu || payload.firmaSelect || ''
    ).trim();
    try {
      if (window.piyasa && typeof window.piyasa.getOrderByIdx === 'function' && pending && pending.piyasaOrderIdx != null) {
        const order = window.piyasa.getOrderByIdx(pending.piyasaOrderIdx);
        if (order) {
          if (!name) name = String(order.firmaAdi || order._hSutunValue || '').trim();
          if (!code) code = String(order.firma || '').trim();
        }
      }
    } catch (e) {}
    if (name && code && name.toLocaleUpperCase('tr-TR') !== code.toLocaleUpperCase('tr-TR')) return name;
    return name || code;
  }

  function enqueue(items) {
    if (!isAmir()) return;
    (Array.isArray(items) ? items : [items]).forEach((item) => {
      if (!item || !item.id || !item.text || seen.has(item.id)) return;
      seen.add(item.id);
      queue.push(item);
    });
    pump();
  }

  function pump() {
    if (showing || !queue.length || !isAmir()) return;
    const item = queue.shift();
    showing = true;
    const old = document.getElementById('amirGirisNotice');
    if (old) old.remove();
    const overlay = document.createElement('div');
    overlay.id = 'amirGirisNotice';
    overlay.setAttribute('role', 'alertdialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483600;background:rgba(15,23,42,.45);display:flex;align-items:center;justify-content:center;padding:18px;';
    overlay.innerHTML = ''
      + '<div style="width:min(440px,94vw);background:#fff;border-radius:16px;box-shadow:0 18px 50px rgba(0,0,0,.28);padding:28px 22px 20px;text-align:center;">'
      + '<div style="font-size:18px;font-weight:800;line-height:1.45;color:#0f172a;">' + escapeText(item.text) + '</div>'
      + '<button type="button" id="amirGirisNoticeOk" style="margin-top:22px;border:0;background:#111827;color:#fff;border-radius:10px;padding:10px 28px;font-weight:800;cursor:pointer;font-size:15px;">Tamam</button>'
      + '</div>';
    document.body.appendChild(overlay);
    const ok = overlay.querySelector('#amirGirisNoticeOk');
    const close = async () => {
      if (ok) ok.disabled = true;
      let acked = false;
      try {
        const res = await fetch('/api/amir-notices/' + encodeURIComponent(item.id) + '/ack', {
          method: 'POST',
          credentials: 'include',
        });
        acked = res.ok;
      } catch (e) {}
      if (!acked) seen.delete(item.id);
      try { overlay.remove(); } catch (e) {}
      showing = false;
      pump();
    };
    if (ok) ok.onclick = close;
    try { ok.focus(); } catch (e) {}
  }

  function escapeText(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  async function pull() {
    if (!isAmir()) return;
    try {
      const res = await fetch('/api/amir-notices', { credentials: 'include', cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      enqueue(data && data.items);
    } catch (e) {}
  }

  async function notifyAmirVehicleEntry(pending) {
    const plate = showPlate(pending && (pending.plaka || (pending.snapshot && pending.snapshot.plaka)));
    if (!plate) return;
    const firma = firmaFromPending(pending);
    try {
      const res = await fetch('/api/amir-notices', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plate, firma }),
      });
      if (!res.ok) return;
      const data = await res.json();
      if (data && data.notice) enqueue([data.notice]);
    } catch (e) {}
  }

  function boot() {
    if (window.SyncManager && typeof window.SyncManager.on === 'function' && !boot.sse) {
      boot.sse = true;
      window.SyncManager.on('amir_giris', (data) => enqueue([data]));
    }
    if (!pollTimer) pollTimer = setInterval(pull, 30000);
    pull();
  }

  window.notifyAmirVehicleEntry = notifyAmirVehicleEntry;
  window.amirGirisNoticePull = function () {
    boot();
    return pull();
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
