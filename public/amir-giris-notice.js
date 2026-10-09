(function () {
  'use strict';

  const queue = [];
  const seen = new Set();
  let openItems = [];
  let showing = false;
  let closing = false;
  const scareQueue = [];
  let scareOpen = [];
  let scareShowing = false;
  let scareClosing = false;
  let watchTimer = 0;
  let pulling = false;
  let audioCtx = null;
  let chimeCursor = 0;
  const chimeNodes = [];
  let titleBase = '';
  let titleShown = 0;
  let sessionConfirmed = false;
  const CLIENT_KEY = 'amirNoticeClientId';
  const POLL_MS = 5000;

  function noticeClientId() {
    try {
      let id = String(localStorage.getItem(CLIENT_KEY) || '');
      if (!/^[a-z0-9]{12,32}$/.test(id)) {
        id = Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);
        localStorage.setItem(CLIENT_KEY, id);
      }
      return id;
    } catch (e) {
      return '';
    }
  }

  function isSelahattin() {
    try {
      return String(localStorage.getItem('currentUserId') || '').trim().toLowerCase() === 'xxr';
    } catch (e) {
      return false;
    }
  }

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

  function loginScreenVisible() {
    try {
      if (document.documentElement.classList.contains('logged-in')) return false;
      const loginScreen = document.getElementById('loginScreen');
      if (!loginScreen) return false;
      const style = window.getComputedStyle(loginScreen);
      return style.display !== 'none' && style.visibility !== 'hidden';
    } catch (e) {
      return false;
    }
  }

  /** localStorage rolü çıkıştan sonra da kalabiliyor; mesaj yalnız açık oturumda. */
  function sessionOpen() {
    try {
      if (localStorage.getItem('isLoggedIn') !== 'true') return false;
      if (window.isLoggedIn === false) return false;
      if (loginScreenVisible()) return false;
      return true;
    } catch (e) {
      return false;
    }
  }

  function canShow() {
    return sessionOpen() && isAmir() && sessionConfirmed;
  }

  function forgetUnacked(items) {
    (Array.isArray(items) ? items : []).forEach((item) => {
      if (item && item.id) seen.delete(item.id);
    });
  }

  function holdScare() {
    forgetUnacked(scareOpen);
    forgetUnacked(scareQueue);
    scareQueue.length = 0;
    scareOpen = [];
    const root = document.getElementById('amirScareNotice');
    if (root) {
      try { root.remove(); } catch (e) {}
    }
    scareShowing = false;
    scareClosing = false;
  }

  function holdNotice() {
    forgetUnacked(openItems);
    forgetUnacked(queue);
    queue.length = 0;
    openItems = [];
    const root = document.getElementById('amirGirisNotice');
    if (root) {
      try { root.remove(); } catch (e) {}
    }
    showing = false;
    closing = false;
    holdScare();
    stopChimes();
    if (titleShown) paintTitleCount(0);
  }

  function onSessionClosed() {
    sessionConfirmed = false;
    holdNotice();
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

  function malzemeFromPending(pending) {
    const snap = (pending && pending.snapshot) || {};
    const payload = (pending && pending.printPayload) || {};
    let kod = String(snap.malzeme || snap.malzemeSelect || payload.malzeme || '').trim();
    try {
      if (!kod && window.piyasa && typeof window.piyasa.getOrderByIdx === 'function' && pending && pending.piyasaOrderIdx != null) {
        const order = window.piyasa.getOrderByIdx(pending.piyasaOrderIdx);
        if (order) kod = String(order.malzeme || '').trim();
      }
    } catch (e) {}
    return kod;
  }

  function unreadCount() {
    return openItems.length + queue.length + scareOpen.length + scareQueue.length;
  }

  function titleBaseText() {
    if (!titleBase) {
      titleBase = String(document.title || 'Araç Plaka Takip Sistemi').replace(/^\(\d+\)\s*/, '') || 'Araç Plaka Takip Sistemi';
    }
    return titleBase;
  }

  function paintTitleCount(count) {
    const n = Math.max(0, Number(count) || 0);
    titleShown = n;
    document.title = n > 0 ? '(' + n + ') ' + titleBaseText() : titleBaseText();
  }

  function syncTabCount() {
    if (!canShow()) {
      if (titleShown) paintTitleCount(0);
      return;
    }
    paintTitleCount(unreadCount());
  }

  function takeFresh(items, scare) {
    const fresh = [];
    (Array.isArray(items) ? items : [items]).forEach((item) => {
      if (!item || !item.id || !item.text || seen.has(item.id)) return;
      const isScare = item.kind === 'scare';
      if (isScare !== scare) return;
      if (isScare && !isSelahattin()) return;
      seen.add(item.id);
      fresh.push(item);
    });
    return fresh;
  }

  function enqueue(items) {
    if (!canShow()) return;
    const list = Array.isArray(items) ? items : [items];
    const scare = takeFresh(list, true);
    const fresh = takeFresh(list, false);
    if (scare.length) {
      if (scareShowing) {
        scareOpen = scareOpen.concat(scare);
        renderScare();
      } else {
        scare.forEach((item) => scareQueue.push(item));
        pumpScare();
      }
    }
    if (!fresh.length) {
      if (scare.length) syncTabCount();
      return;
    }
    if (showing) {
      openItems = openItems.concat(fresh);
      renderOpen();
      syncTabCount();
      return;
    }
    fresh.forEach((item) => queue.push(item));
    syncTabCount();
    pump();
  }

  function noticeAudio() {
    if (audioCtx) return audioCtx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try { audioCtx = new AC(); } catch (e) { return null; }
    return audioCtx;
  }

  function unlockNoticeAudio() {
    const ctx = noticeAudio();
    if (ctx && ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
  }

  function stopChimes() {
    chimeCursor = 0;
    while (chimeNodes.length) {
      const node = chimeNodes.pop();
      try { node.stop(); } catch (e) {}
      try { node.disconnect(); } catch (e) {}
    }
  }

  function scheduleChime(ctx) {
    const now = ctx.currentTime;
    const t = now + 0.02;
    chimeCursor = t;
    [523.25, 659.25].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const when = t + i * 0.11;
      gain.gain.setValueAtTime(0.0001, when);
      gain.gain.exponentialRampToValueAtTime(0.045, when + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.42);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(when);
      osc.stop(when + 0.46);
      chimeNodes.push(osc);
    });
  }

  function playArrivalChime() {
    try {
      const ctx = noticeAudio();
      if (!ctx) return;
      const start = () => scheduleChime(ctx);
      if (ctx.state === 'suspended') ctx.resume().then(start).catch(() => {});
      else start();
    } catch (e) {}
  }

  function playCloseChime() {
    try {
      const ctx = noticeAudio();
      if (!ctx) return;
      const start = () => {
        const t = ctx.currentTime + 0.02;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(494, t);
        osc.frequency.exponentialRampToValueAtTime(262, t + 0.16);
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(0.05, t + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(t);
        osc.stop(t + 0.22);
      };
      if (ctx.state === 'suspended') ctx.resume().then(start).catch(() => {});
      else start();
    } catch (e) {}
  }

  function ensureNoticeStyle() {
    if (document.getElementById('amirGirisNoticeStyle')) return;
    const style = document.createElement('style');
    style.id = 'amirGirisNoticeStyle';
    style.textContent = ''
      + '@keyframes agn-in{from{transform:translateY(36px);opacity:0}to{transform:none;opacity:1}}'
      + '@keyframes agn-swing{0%{transform:rotate(0)}7%{transform:rotate(34deg)}14%{transform:rotate(-32deg)}21%{transform:rotate(28deg)}28%{transform:rotate(-24deg)}35%{transform:rotate(18deg)}42%{transform:rotate(-12deg)}49%{transform:rotate(6deg)}56%,100%{transform:rotate(0)}}'
      + '@keyframes agn-pop{0%,56%,100%{transform:scale(1)}7%{transform:scale(1.22)}14%{transform:scale(.9)}21%{transform:scale(1.14)}28%{transform:scale(.96)}}'
      + '#amirGirisNotice{position:fixed;right:18px;bottom:18px;z-index:2147483600;width:min(360px,calc(100vw - 24px));font-family:"Segoe UI",Tahoma,sans-serif;animation:agn-in .28s ease-out}'
      + '.agn-card{background:#fff;border:1px solid #7ea2d4;border-radius:8px;box-shadow:0 12px 30px rgba(20,50,90,.32);overflow:hidden}'
      + '.agn-bar{display:flex;align-items:center;gap:10px;padding:8px 12px;background:linear-gradient(180deg,#8ebaf0 0%,#3d74c0 100%);color:#fff}'
      + '.agn-bell{width:42px;height:42px;flex:none;display:block;transform-box:fill-box;transform-origin:center;animation:agn-pop .9s ease-in-out infinite}'
      + '.agn-swing{transform-box:fill-box;transform-origin:50% 0;animation:agn-swing .9s linear infinite}'
      + '.agn-title{font-size:14px;font-weight:700}'
      + '.agn-body{max-height:min(46vh,280px);overflow:auto;padding:8px 12px 2px}'
      + '.agn-line+.agn-line{border-top:1px solid #e4eef8;margin-top:6px;padding-top:6px}'
      + '.agn-plate{font-size:15px;font-weight:700;color:#1b2838;line-height:1.3}'
      + '.agn-meta{margin-top:1px;font-size:13px;color:#4d6278;line-height:1.35}'
      + '#amirGirisNoticeOk,#amirScareNoticeOk{display:block;margin:6px 10px 10px auto;border:0;background:#3d74c0;color:#fff;border-radius:4px;padding:5px 16px;font:inherit;font-size:13px;font-weight:700;cursor:pointer}'
      + '#amirGirisNoticeOk:disabled,#amirScareNoticeOk:disabled{opacity:.6;cursor:default}'
      + '#amirScareNotice{position:fixed;right:18px;bottom:18px;z-index:2147483601;width:min(360px,calc(100vw - 24px));font-family:"Segoe UI",Tahoma,sans-serif;animation:agn-in .28s ease-out}'
      + '#amirScareNotice .agn-card{border-color:#b91c1c;box-shadow:0 12px 30px rgba(127,29,29,.35)}'
      + '#amirScareNotice .agn-bar{background:linear-gradient(180deg,#f87171 0%,#b91c1c 100%)}'
      + '#amirScareNotice .agn-plate{color:#991b1b}'
      + '#amirScareNotice .agn-meta{color:#7f1d1d;font-weight:700}'
      + '#amirScareNoticeOk{background:#b91c1c}';
    document.head.appendChild(style);
  }

  function noticeLine(item) {
    const plate = showPlate(item.plate);
    const kod = String(item.malzeme || '').trim();
    const firma = String(item.firma || '').trim();
    const head = [plate, kod].filter(Boolean).join(' / ');
    return ''
      + '<div class="agn-line">'
      + '<div class="agn-plate">' + escapeText(head || 'Araç girişi') + '</div>'
      + (firma ? '<div class="agn-meta">' + escapeText(firma) + '</div>' : '')
      + '</div>';
  }

  function renderOpen() {
    const root = document.getElementById('amirGirisNotice');
    if (!root) return;
    const title = root.querySelector('[data-notice-title]');
    const body = root.querySelector('[data-notice-body]');
    if (title) title.textContent = openItems.length > 1 ? (openItems.length + ' araç giriş yaptı') : 'Araç girişi';
    if (body) {
      body.innerHTML = openItems.map(noticeLine).join('');
      body.scrollTop = body.scrollHeight;
    }
    const ok = root.querySelector('#amirGirisNoticeOk');
    if (ok && !ok.disabled) ok.textContent = openItems.length > 1 ? ('Tamam (' + openItems.length + ')') : 'Tamam';
  }

  function bellMarkup() {
    return ''
      + '<svg class="agn-bell" viewBox="0 0 48 48" aria-hidden="true">'
      + '<g class="agn-swing">'
      + '<circle cx="24" cy="5" r="3" fill="#fff"/>'
      + '<path fill="#fff" d="M24 8c-9 2.2-15 11-15 19v7h30v-7c0-8-6-16.8-15-19z"/>'
      + '<path fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" d="M15 35c1.2 5 4.6 8 9 8s7.8-3 9-8"/>'
      + '<circle cx="24" cy="41" r="2.4" fill="#ffe08a"/>'
      + '</g></svg>';
  }

  function pump() {
    if (!canShow()) {
      holdNotice();
      return;
    }
    if (showing || closing || !queue.length) return;
    openItems = queue.splice(0, queue.length);
    showing = true;
    ensureNoticeStyle();
    const old = document.getElementById('amirGirisNotice');
    if (old) old.remove();
    const overlay = document.createElement('div');
    overlay.id = 'amirGirisNotice';
    overlay.setAttribute('role', 'status');
    overlay.innerHTML = ''
      + '<div class="agn-card">'
      + '<div class="agn-bar">' + bellMarkup() + '<span class="agn-title" data-notice-title></span></div>'
      + '<div class="agn-body" data-notice-body></div>'
      + '<button type="button" id="amirGirisNoticeOk">Tamam</button>'
      + '</div>';
    document.body.appendChild(overlay);
    renderOpen();
    if (document.getElementById('amirScareNotice')) renderScare();
    playArrivalChime();
    const ok = overlay.querySelector('#amirGirisNoticeOk');
    const closeAll = () => {
      if (closing || !openItems.length) return;
      closing = true;
      if (ok) ok.disabled = true;
      stopChimes();
      playCloseChime();
      const batch = openItems.slice();
      openItems = [];
      try { overlay.remove(); } catch (e) {}
      showing = false;
      closing = false;
      if (document.getElementById('amirScareNotice')) renderScare();
      syncTabCount();
      pump();
      const client = noticeClientId();
      batch.forEach((item) => {
        fetch('/api/amir-notices/' + encodeURIComponent(item.id) + '/ack', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client: client }),
        }).then((res) => {
          if (!res.ok) seen.delete(item.id);
        }).catch(() => {
          seen.delete(item.id);
        });
      });
    };
    if (ok) ok.onclick = closeAll;
  }

  function scareLine(item) {
    const ip = String(item.plate || 'Bilinmiyor').trim();
    const meta = String(item.firma || 'NOVATEK — sistem tarafından engellendi').trim();
    return ''
      + '<div class="agn-line">'
      + '<div class="agn-plate">' + escapeText(ip) + '</div>'
      + '<div class="agn-meta">' + escapeText(meta) + '</div>'
      + '</div>';
  }

  function renderScare() {
    const root = document.getElementById('amirScareNotice');
    if (!root) return;
    const title = root.querySelector('[data-scare-title]');
    const body = root.querySelector('[data-scare-body]');
    if (title) {
      title.textContent = scareOpen.length > 1
        ? (scareOpen.length + ' giriş denemesi engellendi')
        : 'Sistem tarafından engellendi';
    }
    if (body) {
      body.innerHTML = scareOpen.map(scareLine).join('');
      body.scrollTop = body.scrollHeight;
    }
    const ok = root.querySelector('#amirScareNoticeOk');
    if (ok && !ok.disabled) ok.textContent = scareOpen.length > 1 ? ('Tamam (' + scareOpen.length + ')') : 'Tamam';
    const vehicle = document.getElementById('amirGirisNotice');
    root.style.bottom = vehicle ? (vehicle.offsetHeight + 28) + 'px' : '18px';
  }

  function pumpScare() {
    if (!canShow() || !isSelahattin()) {
      holdScare();
      return;
    }
    if (scareShowing || scareClosing || !scareQueue.length) return;
    scareOpen = scareQueue.splice(0, scareQueue.length);
    scareShowing = true;
    ensureNoticeStyle();
    const old = document.getElementById('amirScareNotice');
    if (old) old.remove();
    const overlay = document.createElement('div');
    overlay.id = 'amirScareNotice';
    overlay.setAttribute('role', 'status');
    overlay.innerHTML = ''
      + '<div class="agn-card">'
      + '<div class="agn-bar">' + bellMarkup() + '<span class="agn-title" data-scare-title></span></div>'
      + '<div class="agn-body" data-scare-body></div>'
      + '<button type="button" id="amirScareNoticeOk">Tamam</button>'
      + '</div>';
    document.body.appendChild(overlay);
    renderScare();
    playArrivalChime();
    const ok = overlay.querySelector('#amirScareNoticeOk');
    const closeAll = () => {
      if (scareClosing || !scareOpen.length) return;
      scareClosing = true;
      if (ok) ok.disabled = true;
      stopChimes();
      playCloseChime();
      const batch = scareOpen.slice();
      scareOpen = [];
      try { overlay.remove(); } catch (e) {}
      scareShowing = false;
      scareClosing = false;
      syncTabCount();
      pumpScare();
      const client = noticeClientId();
      batch.forEach((item) => {
        fetch('/api/amir-notices/' + encodeURIComponent(item.id) + '/ack', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client: client }),
        }).then((res) => {
          if (!res.ok) seen.delete(item.id);
        }).catch(() => {
          seen.delete(item.id);
        });
      });
    };
    if (ok) ok.onclick = closeAll;
  }

  function escapeText(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  async function pull() {
    if (!sessionOpen() || !isAmir()) {
      onSessionClosed();
      return;
    }
    if (pulling) return;
    pulling = true;
    try {
      const res = await fetch('/api/amir-notices?client=' + encodeURIComponent(noticeClientId()), {
        credentials: 'include',
        cache: 'no-store',
      });
      if (res.status === 401 || res.status === 403) {
        onSessionClosed();
        return;
      }
      if (!res.ok) return;
      if (!sessionOpen() || !isAmir()) {
        onSessionClosed();
        return;
      }
      sessionConfirmed = true;
      const data = await res.json();
      enqueue(data && data.items);
    } catch (e) {}
    finally { pulling = false; }
  }

  async function notifyAmirVehicleEntry(pending) {
    const plate = showPlate(pending && (pending.plaka || (pending.snapshot && pending.snapshot.plaka)));
    if (!plate) return;
    const firma = firmaFromPending(pending);
    const malzeme = malzemeFromPending(pending);
    try {
      const res = await fetch('/api/amir-notices', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plate, firma, malzeme }),
      });
      if (!res.ok) return;
      if (!sessionOpen() || !isAmir()) {
        onSessionClosed();
        return;
      }
      sessionConfirmed = true;
      const data = await res.json();
      if (data && data.notice) enqueue([data.notice]);
    } catch (e) {}
  }

  function watchLive() {
    if (watchTimer) return;
    const wake = () => {
      if (document.visibilityState === 'hidden') return;
      pull();
    };
    document.addEventListener('pointerdown', unlockNoticeAudio, true);
    document.addEventListener('keydown', unlockNoticeAudio, true);
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('focus', wake);
    window.addEventListener('online', () => pull());
    watchTimer = setInterval(() => {
      if (document.hidden) return;
      pull();
    }, POLL_MS);
  }

  function boot() {
    if (!boot.sessionWatch) {
      boot.sessionWatch = true;
      window.addEventListener('gpm-session-closed', onSessionClosed);
      window.addEventListener('gpm-session-renewed', () => { pull(); });
      window.addEventListener('storage', (e) => {
        if (!e.key || e.key === 'isLoggedIn' || e.key === 'currentUserRole' || e.key === 'currentUserId') {
          if (!sessionOpen() || !isAmir()) onSessionClosed();
        }
      });
      try {
        const obs = new MutationObserver(() => {
          if (!sessionOpen()) onSessionClosed();
        });
        obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
      } catch (e) {}
    }
    if (window.SyncManager && typeof window.SyncManager.on === 'function' && !boot.sse) {
      boot.sse = true;
      window.SyncManager.on('amir_giris', (data) => enqueue([data]));
    }
    watchLive();
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
