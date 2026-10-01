(function () {
  'use strict';

  const queue = [];
  const seen = new Set();
  let openItems = [];
  let showing = false;
  let closing = false;
  let watchTimer = 0;
  let pulling = false;
  let audioCtx = null;
  let chimeCursor = 0;
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

  function rowWhen(ts) {
    const when = Number(ts);
    if (!Number.isFinite(when)) return '';
    try {
      const fmt = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/Istanbul',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      });
      const parts = (value) => {
        const map = {};
        fmt.formatToParts(new Date(value)).forEach((part) => { map[part.type] = part.value; });
        return map;
      };
      const at = parts(when);
      const today = parts(Date.now());
      if (!at.hour || !at.minute) return '';
      const hm = at.hour + ':' + at.minute;
      if (at.year === today.year && at.month === today.month && at.day === today.day) return hm;
      return at.day + '.' + at.month + '.' + at.year + ' ' + hm;
    } catch (e) {
      return '';
    }
  }

  function enqueue(items) {
    if (!isAmir()) return;
    const fresh = [];
    (Array.isArray(items) ? items : [items]).forEach((item) => {
      if (!item || !item.id || !item.text || seen.has(item.id)) return;
      seen.add(item.id);
      fresh.push(item);
    });
    if (!fresh.length) return;
    if (showing && !closing) {
      openItems = openItems.concat(fresh);
      renderOpen();
      playNoticeChimes(fresh.length);
      return;
    }
    fresh.forEach((item) => queue.push(item));
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

  function scheduleChime(ctx) {
    const now = ctx.currentTime;
    if (chimeCursor < now + 0.02) chimeCursor = now + 0.02;
    const t = chimeCursor;
    chimeCursor += 0.52;
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
    });
  }

  function playNoticeChimes(count) {
    const n = Math.max(0, Number(count) || 0);
    if (!n) return;
    try {
      const ctx = noticeAudio();
      if (!ctx) return;
      const start = () => {
        for (let i = 0; i < n; i++) scheduleChime(ctx);
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
      + '#amirGirisNoticeOk{display:block;margin:6px 10px 10px auto;border:0;background:#3d74c0;color:#fff;border-radius:4px;padding:5px 16px;font:inherit;font-size:13px;font-weight:700;cursor:pointer}'
      + '#amirGirisNoticeOk:disabled{opacity:.6;cursor:default}';
    document.head.appendChild(style);
  }

  function noticeLine(item) {
    const plate = showPlate(item.plate);
    const firma = String(item.firma || '').trim();
    const when = rowWhen(item.ts);
    const meta = [firma, when].filter(Boolean).join(' · ');
    return ''
      + '<div class="agn-line">'
      + '<div class="agn-plate">' + escapeText(plate || 'Araç girişi') + '</div>'
      + (meta ? '<div class="agn-meta">' + escapeText(meta) + '</div>' : '')
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
    if (showing || closing || !queue.length || !isAmir()) return;
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
    playNoticeChimes(openItems.length);
    const ok = overlay.querySelector('#amirGirisNoticeOk');
    const close = async () => {
      if (closing) return;
      closing = true;
      if (ok) ok.disabled = true;
      const batch = openItems.slice();
      openItems = [];
      await Promise.all(batch.map(async (item) => {
        let acked = false;
        try {
          const res = await fetch('/api/amir-notices/' + encodeURIComponent(item.id) + '/ack', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ client: noticeClientId() }),
          });
          acked = res.ok;
        } catch (e) {}
        if (!acked) seen.delete(item.id);
      }));
      try { overlay.remove(); } catch (e) {}
      showing = false;
      closing = false;
      pump();
    };
    if (ok) ok.onclick = close;
  }

  function escapeText(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  async function pull() {
    if (!isAmir() || pulling) return;
    pulling = true;
    try {
      const res = await fetch('/api/amir-notices?client=' + encodeURIComponent(noticeClientId()), {
        credentials: 'include',
        cache: 'no-store',
      });
      if (!res.ok) return;
      const data = await res.json();
      enqueue(data && data.items);
    } catch (e) {}
    finally { pulling = false; }
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
