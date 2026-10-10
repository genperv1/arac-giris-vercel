/* Eski MSN penceresi: amir ve kantar yazışması.
   Canlı mesaj mevcut SSE hattından gider. Yedek yoklama yalnız bağlantı kopunca, 30 sn'de bir. */
(function () {
    const SYNC_KEY = 'gpm_chat_sync_v1';
    const UNREAD_KEY = 'gpm_chat_unread_v1';
    const REPLY_KEY = 'gpm_chat_reply_v1';
    const SEEN_KEY = 'gpm_chat_seen_v1';
    const CLEARED_KEY = 'gpm_chat_cleared_v1';
    const POLL_MS = 30 * 1000;
    const FRESH_MS = 20 * 1000;

    const windows = new Map();
    const seen = new Set();
    let appliedCleared = 0;
    let pollTimer = 0;
    let pulling = false;
    let sseBound = false;
    let dingAudio = null;
    let buzzAudio = null;
    let audioReady = false;

    function siteKey(value) {
        const raw = String(value || '').trim();
        const upper = raw.toLocaleUpperCase('tr-TR').replace(/\s+/g, '');
        if (upper === 'AVDAN') return 'AVDAN';
        if (upper === '1.OSB' || upper === '1OSB' || upper === 'OSB') return '1.OSB';
        if (upper === 'AMIR' || raw === 'AMİR' || upper === 'SELAHATTİN' || upper === 'SELAHATTIN' || upper === 'XXR') return 'AMIR';
        if (upper === 'BURAK' || upper === 'BURAKKARATAŞ' || upper === 'BURAKKARATAS') return 'BURAK';
        if (upper === 'SABAN' || upper === 'ŞABAN') return 'SABAN';
        if (upper === 'UGUR' || upper === 'UĞUR') return 'UGUR';
        return '';
    }

    function myKey() {
        try { return siteKey(localStorage.getItem('currentUserId')); } catch (e) { return ''; }
    }

    function personName(key) {
        const k = siteKey(key);
        try {
            if (window.SessionManager && typeof SessionManager.presencePersonName === 'function') {
                const n = SessionManager.presencePersonName(k);
                if (n) return n;
            }
        } catch (e) { /* ignore */ }
        return k || '—';
    }

    function isAmir() {
        try { return !!(window.SessionManager && SessionManager.isAmirUser && SessionManager.isAmirUser()); } catch (e) { return false; }
    }

    function isKantar(key) {
        const k = siteKey(key);
        return k === 'AVDAN' || k === '1.OSB';
    }

    function avatarSrc(key) {
        const k = siteKey(key);
        if (k === 'AVDAN') return '/login-baret-avdan.png?v=20261003c';
        if (k === '1.OSB') return '/login-baret-osb.png?v=20261003c';
        if (k === 'BURAK') return '/login-burak.png?v=20261010i';
        return '/login-baret-amir.png?v=20261003c';
    }

    function loadReply() {
        try {
            const raw = JSON.parse(localStorage.getItem(REPLY_KEY) || '{}');
            window.__gpmChatReply = raw && typeof raw === 'object' ? raw : {};
        } catch (e) {
            window.__gpmChatReply = {};
        }
    }

    function saveReply() {
        try { localStorage.setItem(REPLY_KEY, JSON.stringify(window.__gpmChatReply || {})); } catch (e) { /* ignore */ }
    }

    function mayReply() {
        return true;
    }

    function markReply(peer) {
        const key = siteKey(peer);
        if (!key) return;
        const map = window.__gpmChatReply || (window.__gpmChatReply = {});
        if (map[key]) return;
        map[key] = 1;
        saveReply();
        const win = windows.get(key);
        if (win) paintCompose(win);
        refreshChips();
    }

    function applyReplyPeers(list) {
        const map = {};
        (list || []).forEach((k) => {
            const key = siteKey(k);
            if (key) map[key] = 1;
        });
        window.__gpmChatReply = map;
        saveReply();
        windows.forEach((win) => paintCompose(win));
        refreshChips();
    }

    function readSync() {
        try { return Number(localStorage.getItem(SYNC_KEY)) || 0; } catch (e) { return 0; }
    }

    function writeSync(ts) {
        const n = Number(ts) || 0;
        if (n > readSync()) {
            try { localStorage.setItem(SYNC_KEY, String(n)); } catch (e) { /* ignore */ }
        }
    }

    function loadUnread() {
        try {
            const raw = JSON.parse(localStorage.getItem(UNREAD_KEY) || '{}');
            window.__gpmChatUnread = raw && typeof raw === 'object' ? raw : {};
        } catch (e) {
            window.__gpmChatUnread = {};
        }
    }

    function saveUnread() {
        try { localStorage.setItem(UNREAD_KEY, JSON.stringify(window.__gpmChatUnread || {})); } catch (e) { /* ignore */ }
    }

    function refreshChips() {
        try {
            const list = window.SessionManager && typeof SessionManager.getPresence === 'function' ? SessionManager.getPresence() : [];
            window.dispatchEvent(new CustomEvent('gpm-presence', { detail: { list: list || [] } }));
        } catch (e) { /* ignore */ }
    }

    function addUnread(peer) {
        const map = window.__gpmChatUnread || (window.__gpmChatUnread = {});
        map[peer] = (Number(map[peer]) || 0) + 1;
        saveUnread();
        refreshChips();
        paintBadge();
    }

    function clearUnread(peer) {
        const map = window.__gpmChatUnread;
        if (map && map[peer]) {
            delete map[peer];
            saveUnread();
            refreshChips();
        }
        paintBadge();
    }

    function clip(kind) {
        if (kind === 'buzz') {
            if (!buzzAudio) {
                buzzAudio = new Audio('/msn-nudge.mp3');
                buzzAudio.preload = 'auto';
            }
            return buzzAudio;
        }
        if (!dingAudio) {
            dingAudio = new Audio('/mesaj-bildirim.mp3');
            dingAudio.preload = 'auto';
        }
        return dingAudio;
    }

    function playClip(a) {
        try {
            a.muted = false;
            a.volume = 1;
            a.currentTime = 0;
            const p = a.play();
            if (p && typeof p.catch === 'function') p.catch(() => {});
        } catch (e) { /* ignore */ }
    }

    function unlockAudio() {
        if (audioReady) return;
        try {
            const a = clip('ding');
            clip('buzz');
            if (!a.paused && a.currentTime > 0) {
                audioReady = true;
                return;
            }
            audioReady = true;
            a.muted = true;
            const p = a.play();
            const done = () => {
                a.pause();
                a.currentTime = 0;
                a.muted = false;
            };
            if (p && typeof p.then === 'function') p.then(done).catch(() => { a.muted = false; audioReady = false; });
            else done();
        } catch (e) { audioReady = false; }
    }

    function ding() {
        playClip(clip('ding'));
    }

    function buzzSound() {
        playClip(clip('buzz'));
    }

    function shortName(key) {
        const k = siteKey(key);
        return ({ AMIR: 'SELAHATTİN', BURAK: 'BURAK', SABAN: 'ŞABAN', UGUR: 'UĞUR', AVDAN: 'AVDAN', '1.OSB': '1.OSB' })[k] || k || '—';
    }

    function paintBadge() {
        ensureStyle();
        const map = window.__gpmChatUnread || {};
        const keys = Object.keys(map).filter((k) => Number(map[k]) > 0);
        let bar = document.getElementById('gpmMsnBadge');
        if (!keys.length) {
            if (bar) bar.remove();
            return;
        }
        if (!bar) {
            bar = document.createElement('div');
            bar.id = 'gpmMsnBadge';
        }
        const host = dock();
        if (bar.parentNode !== host) host.prepend(bar);
        bar.textContent = '';
        keys.forEach((key) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'gpm-msn-badge';
            btn.textContent = shortName(key) + '  ' + Number(map[key]);
            btn.addEventListener('click', () => open(key));
            bar.appendChild(btn);
        });
    }

    function ensureStyle() {
        if (document.getElementById('gpmMsnStyle')) return;
        const style = document.createElement('style');
        style.id = 'gpmMsnStyle';
        style.textContent = ''
            + '#gpmMsnDock{position:fixed;right:16px;bottom:16px;z-index:2147483000;display:flex;flex-direction:row-reverse;align-items:flex-end;gap:12px;pointer-events:none;max-width:calc(100vw - 24px)}'
            + '.gpm-msn{pointer-events:auto;position:relative;width:340px;height:480px;display:flex;flex-direction:column;background:#fff;border:1px solid #e2e8f0;border-radius:18px;box-shadow:0 22px 50px rgba(15,23,42,.16),0 2px 8px rgba(15,23,42,.06);font-family:"Segoe UI",system-ui,sans-serif;overflow:hidden}'
            + '.gpm-msn.is-min{height:auto}'
            + '.gpm-msn.is-min .gpm-msn-log,.gpm-msn.is-min .gpm-msn-tools,.gpm-msn.is-min .gpm-msn-compose,.gpm-msn.is-min .gpm-msn-quick,.gpm-msn.is-min .gpm-msn-emoji-pop,.gpm-msn.is-min .gpm-msn-lock{display:none}'
            + '.gpm-msn-bar{display:flex;align-items:center;gap:10px;padding:12px 12px 10px;background:#fff;border-bottom:1px solid #eef2f7;cursor:pointer;user-select:none}'
            + '.gpm-msn-ava{width:44px;height:44px;border-radius:999px;overflow:hidden;flex:none;background:#f1f5f9;box-shadow:0 0 0 2px #fff,0 0 0 3px #c7d2fe}'
            + '.gpm-msn-ava img{width:100%;height:140%;object-fit:cover;object-position:center 0;display:block;transform:translateY(-6%)}'
            + '.gpm-msn-id{flex:1;min-width:0}'
            + '.gpm-msn-id b{display:block;font-size:14px;font-weight:700;letter-spacing:-.01em;line-height:1.2;color:#0f172a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'
            + '.gpm-msn-id small{display:flex;align-items:center;gap:5px;margin-top:2px;font-size:11px;color:#64748b;font-weight:600}'
            + '.gpm-msn-dot{width:8px;height:8px;border-radius:99px;background:#cbd5e1;display:inline-block}'
            + '.gpm-msn.is-on .gpm-msn-dot{background:#22c55e;box-shadow:0 0 0 3px rgba(34,197,94,.18)}'
            + '.gpm-msn-min,.gpm-msn-x{border:1px solid #e2e8f0;background:#f8fafc;color:#475569;width:28px;height:28px;cursor:pointer;font:700 16px/1 "Segoe UI",sans-serif;border-radius:9px}'
            + '.gpm-msn-min:hover,.gpm-msn-x:hover{background:#eef2ff;border-color:#c7d2fe;color:#3730a3}'
            + '.gpm-msn-log{flex:1;overflow:auto;padding:14px 12px;background:linear-gradient(180deg,#f8fafc,#f1f5f9)}'
            + '.gpm-msn-row{display:flex;flex-direction:column;align-items:flex-start;margin:0 0 8px;max-width:100%}'
            + '.gpm-msn-row.me{align-items:flex-end}'
            + '.gpm-msn-bubble{max-width:80%;padding:8px 11px 5px;border-radius:16px}'
            + '.gpm-msn-row.them .gpm-msn-bubble{background:#fff;color:#0f172a;border:1px solid #e2e8f0;border-bottom-left-radius:5px;box-shadow:0 1px 2px rgba(15,23,42,.04)}'
            + '.gpm-msn-row.me .gpm-msn-bubble{background:linear-gradient(180deg,#4f46e5,#4338ca);color:#fff;border-bottom-right-radius:5px}'
            + '.gpm-msn-row .time{display:block;margin-top:2px;font-size:10px;font-weight:600;text-align:right;opacity:.72}'
            + '.gpm-msn-row .txt{font-size:13.5px;line-height:1.4;white-space:pre-wrap;word-break:break-word}'
            + '.gpm-msn-sys{align-self:center;font:600 11px/1.35 "Segoe UI",sans-serif;color:#64748b;background:#e2e8f0;border-radius:999px;padding:4px 10px;margin:0 auto 8px;width:fit-content}'
            + '.gpm-msn-read{margin-top:2px;font:700 10px "Segoe UI",sans-serif;color:#16a34a;text-align:right}'
            + '.gpm-msn-tools{display:flex;gap:6px;padding:8px 10px 0;background:#fff}'
            + '.gpm-msn-buzz,.gpm-msn-quick-btn{border:1px solid #e2e8f0;background:#f8fafc;color:#334155;font:600 12px/1 "Segoe UI",sans-serif;cursor:pointer;padding:7px 11px;border-radius:999px}'
            + '.gpm-msn-buzz:hover,.gpm-msn-quick-btn:hover{background:#eef2ff;border-color:#c7d2fe;color:#3730a3}'
            + '.gpm-msn-quick{display:none;position:absolute;left:10px;right:10px;bottom:112px;max-height:220px;overflow:auto;background:#fff;border:1px solid #e2e8f0;border-radius:14px;box-shadow:0 16px 36px rgba(15,23,42,.14);padding:6px;z-index:3}'
            + '.gpm-msn.is-quick:not(.is-min) .gpm-msn-quick{display:block}'
            + '.gpm-msn-emoji-pop{display:none;position:absolute;right:10px;bottom:64px;width:188px;background:#fff;border:1px solid #e2e8f0;border-radius:14px;box-shadow:0 16px 36px rgba(15,23,42,.14);padding:8px;gap:2px;flex-wrap:wrap;z-index:4}'
            + '.gpm-msn.is-emoji:not(.is-min) .gpm-msn-emoji-pop{display:flex}'
            + '.gpm-msn-emoji-pop button{width:32px;height:32px;border:0;background:transparent;border-radius:8px;cursor:pointer;font-size:18px;padding:0}'
            + '.gpm-msn-emoji-pop button:hover{background:#eef2ff}'
            + '.gpm-msn-quick-list{display:flex;flex-direction:column;gap:4px}'
            + '.gpm-msn-quick-list button{text-align:left;padding:8px 10px;color:#0f172a;border:0;background:#f8fafc;border-radius:10px;cursor:pointer;font:600 12.5px/1.3 "Segoe UI",sans-serif}'
            + '.gpm-msn-quick-list button:hover{background:#eef2ff;color:#3730a3}'
            + '.gpm-msn-lock{display:none;margin:0;padding:14px 12px;background:#fff;border-top:1px solid #eef2f7;color:#64748b;font:600 12.5px/1.4 "Segoe UI",sans-serif;text-align:center}'
            + '.gpm-msn.is-locked .gpm-msn-lock{display:block}'
            + '.gpm-msn.is-locked .gpm-msn-tools,.gpm-msn.is-locked .gpm-msn-compose,.gpm-msn.is-locked .gpm-msn-quick,.gpm-msn.is-locked .gpm-msn-emoji-pop{display:none}'
            + '.gpm-msn-compose{display:flex;gap:8px;align-items:flex-end;padding:8px 10px 12px;background:#fff}'
            + '.gpm-msn-compose textarea{flex:1;resize:none;height:42px;border:1px solid #e2e8f0;border-radius:12px;padding:10px 12px;font:13.5px/1.35 "Segoe UI",sans-serif;background:#f8fafc;color:#0f172a}'
            + '.gpm-msn-compose textarea:focus{outline:2px solid rgba(79,70,229,.28);border-color:#6366f1;background:#fff}'
            + '.gpm-msn-actions{display:flex;gap:6px;align-items:center}'
            + '.gpm-msn-emoji-btn{width:40px;height:40px;border:1px solid #e2e8f0;background:#fff;border-radius:12px;cursor:pointer;font-size:18px;padding:0;line-height:1}'
            + '.gpm-msn-emoji-btn:hover,.gpm-msn.is-emoji .gpm-msn-emoji-btn{background:#eef2ff;border-color:#c7d2fe}'
            + '.gpm-msn-send{height:40px;border:0;background:#4f46e5;color:#fff;border-radius:12px;padding:0 14px;font:700 13px/1 "Segoe UI",sans-serif;cursor:pointer}'
            + '.gpm-msn-send:hover{background:#4338ca}'
            + '#gpmMsnBadge{position:relative;z-index:1;display:flex;flex-direction:column;gap:6px;align-items:flex-end;pointer-events:auto}'
            + '.gpm-msn-badge{border:0;background:#4f46e5;color:#fff;font:700 14px/1 "Segoe UI",sans-serif;border-radius:999px;padding:10px 14px;cursor:pointer;box-shadow:0 8px 20px rgba(79,70,229,.35)}'
            + '.gpm-msn-badge:hover{background:#4338ca}'
            + '@media (max-width:640px){#gpmMsnDock{left:8px;right:8px;flex-direction:column-reverse}.gpm-msn{width:100%}}';
        document.head.appendChild(style);
    }

    function dock() {
        let el = document.getElementById('gpmMsnDock');
        if (!el) {
            el = document.createElement('div');
            el.id = 'gpmMsnDock';
            document.body.appendChild(el);
        }
        return el;
    }

    function clock(ts) {
        try {
            return new Date(ts || Date.now()).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
        } catch (e) {
            return '';
        }
    }

    function peerOnline(peer) {
        try {
            const list = window.SessionManager && SessionManager.getPresence ? SessionManager.getPresence() : [];
            return (list || []).some((p) => siteKey(p && (p.key || p.label)) === peer && p.online);
        } catch (e) {
            return false;
        }
    }

    function paintStatus(win) {
        const on = peerOnline(win.peer);
        win.el.classList.toggle('is-on', on);
        if (win.status) win.status.textContent = on ? 'Çevrimiçi' : 'Çevrimdışı';
    }

    function scrollLog(win) {
        if (win.log) win.log.scrollTop = win.log.scrollHeight;
    }

    function loadSeen() {
        try {
            const arr = JSON.parse(localStorage.getItem(SEEN_KEY) || '[]');
            seen.clear();
            if (Array.isArray(arr)) arr.slice(-100).forEach((id) => seen.add(String(id)));
        } catch (e) { /* ignore */ }
    }

    function remember(id) {
        seen.add(String(id));
        const arr = Array.from(seen).slice(-100);
        seen.clear();
        arr.forEach((item) => seen.add(item));
        try { localStorage.setItem(SEEN_KEY, JSON.stringify(arr)); } catch (e) { /* ignore */ }
    }

    function hasLine(win, id) {
        if (!win || !win.log) return false;
        const safe = String(id).replace(/"/g, '');
        return !!win.log.querySelector('[data-id="' + safe + '"]');
    }

    function appendLine(win, msg) {
        const mine = msg.from === myKey();
        const row = document.createElement('div');
        row.className = 'gpm-msn-row ' + (mine ? 'me' : 'them');
        row.setAttribute('data-id', String(msg.id || ''));
        row.setAttribute('data-ts', String(Number(msg.ts) || 0));
        const bubble = document.createElement('div');
        bubble.className = 'gpm-msn-bubble';
        const body = document.createElement('div');
        body.className = 'txt';
        body.textContent = msg.text;
        const time = document.createElement('span');
        time.className = 'time';
        time.textContent = clock(msg.ts);
        bubble.appendChild(body);
        bubble.appendChild(time);
        row.appendChild(bubble);
        if (mine && msg.readAt) stampRead(row);
        win.log.appendChild(row);
        scrollLog(win);
    }

    function stampRead(row) {
        if (!row || row.querySelector('.gpm-msn-read')) return;
        const el = document.createElement('div');
        el.className = 'gpm-msn-read';
        el.textContent = 'okundu';
        row.appendChild(el);
    }

    function applyRead(peer, readAt) {
        const win = windows.get(siteKey(peer));
        if (!win || !win.log) return;
        const limit = Number(readAt) || 0;
        win.log.querySelectorAll('.gpm-msn-row.me').forEach((row) => {
            const ts = Number(row.getAttribute('data-ts')) || 0;
            if (!limit || ts <= limit) stampRead(row);
        });
    }

    function ackRead(peer) {
        const key = siteKey(peer);
        if (!key) return;
        try {
            fetch('/api/chat/read', {
                method: 'POST',
                credentials: 'include',
                keepalive: true,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ peer: key }),
            }).catch(() => {});
        } catch (e) { /* ignore */ }
    }
    function systemLine(win, text) {
        const row = document.createElement('div');
        row.className = 'gpm-msn-sys';
        row.textContent = text;
        win.log.appendChild(row);
        scrollLog(win);
    }

    function shake(el) {
        if (!el) return;
        if (el.__gpmShakeTimer) clearInterval(el.__gpmShakeTimer);
        const steps = [-10, 10, -8, 8, -5, 5, -2, 2, 0];
        let i = 0;
        el.__gpmShakeTimer = setInterval(() => {
            if (i >= steps.length) {
                clearInterval(el.__gpmShakeTimer);
                el.__gpmShakeTimer = 0;
                el.style.transform = '';
                return;
            }
            el.style.transform = 'translateX(' + steps[i] + 'px)';
            i += 1;
        }, 45);
    }

    function reading(win) {
        return !!(win && win.el && !win.el.classList.contains('is-min'));
    }

    function readCleared() {
        try { return Number(localStorage.getItem(CLEARED_KEY)) || 0; } catch (e) { return 0; }
    }

    function wipeChat(clearedAt) {
        const n = Number(clearedAt) || 0;
        if (!n || n <= appliedCleared) return;
        appliedCleared = n;
        seen.clear();
        window.__gpmChatUnread = {};
        window.__gpmChatReply = {};
        windows.forEach((win) => {
            if (win.log) win.log.textContent = '';
            win.loaded = true;
            systemLine(win, 'Yazışma temizlendi');
            paintCompose(win);
        });
        try {
            localStorage.removeItem(SYNC_KEY);
            localStorage.removeItem(UNREAD_KEY);
            localStorage.removeItem(REPLY_KEY);
            localStorage.removeItem(SEEN_KEY);
            localStorage.setItem(CLEARED_KEY, String(n));
        } catch (e) { /* ignore */ }
        refreshChips();
        paintBadge();
    }

    function ingest(msg, live) {
        if (!msg || !msg.id) return;
        if (appliedCleared && Number(msg.ts) && Number(msg.ts) <= appliedCleared) return;
        const id = String(msg.id);
        const mine = myKey();
        const from = siteKey(msg.from);
        const to = siteKey(msg.to);
        if (!mine || (from !== mine && to !== mine)) return;
        const peer = from === mine ? to : from;
        const win = windows.get(peer);
        if (win && !hasLine(win, id)) appendLine(win, msg);
        if (to === mine && from && from !== mine) markReply(from);
        if (seen.has(id)) return;
        remember(id);
        writeSync(msg.ts);
        const incoming = to === mine && live && Date.now() - Number(msg.ts || 0) < FRESH_MS;
        if (incoming) ding();
        if (to === mine && reading(win) && !document.hidden) {
            clearUnread(peer);
            ackRead(peer);
            return;
        }
        if (to !== mine) return;
        addUnread(peer);
    }

    async function loadHistory(win) {
        if (win.loaded) return;
        try {
            const res = await fetch('/api/chat?peer=' + encodeURIComponent(win.peer), { credentials: 'include', cache: 'no-store' });
            if (!res.ok) return;
            const data = await res.json();
            if (data && data.clearedAt) wipeChat(data.clearedAt);
            win.loaded = true;
            (data.messages || []).forEach((m) => ingest(m, false));
        } catch (e) { /* ignore */ }
    }

    async function postChat(win, text) {
        const body = String(text || '').trim();
        if (!body) return false;
        try {
            const res = await fetch('/api/chat', {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ to: win.peer, text: body }),
            });
            let data = {};
            try { data = await res.json(); } catch (e) { data = {}; }
            if (res.status === 429) {
                systemLine(win, 'Biraz bekleyin');
                return false;
            }
            if (res.status === 403 && data.code === 'NO_OPEN') {
                systemLine(win, 'Amir yazınca cevap verebilirsiniz');
                paintCompose(win);
                return false;
            }
            if (!res.ok || !data.message) {
                systemLine(win, 'Gönderilemedi');
                return false;
            }
            ingest(data.message, false);
            return true;
        } catch (e) {
            systemLine(win, 'Gönderilemedi');
            return false;
        }
    }

    function paintCompose(win) {
        if (!win || !win.el) return;
        const locked = !mayReply(win.peer);
        win.el.classList.toggle('is-locked', locked);
        if (locked) {
            win.el.classList.remove('is-quick');
            win.el.classList.remove('is-emoji');
        }
        if (win.input) win.input.disabled = locked;
    }

    function denyClosed(win) {
        if (mayReply(win.peer)) return false;
        systemLine(win, 'Amir yazınca cevap verebilirsiniz');
        paintCompose(win);
        return true;
    }

    async function send(win) {
        if (denyClosed(win)) return;
        const text = String(win.input.value || '').trim();
        if (!text) return;
        win.input.value = '';
        win.el.classList.remove('is-emoji');
        const ok = await postChat(win, text);
        if (!ok) win.input.value = text;
    }

    function sendQuick(win, text) {
        if (denyClosed(win)) return;
        win.el.classList.remove('is-quick');
        postChat(win, text);
    }

    function insertEmoji(win, item) {
        const el = win.input;
        if (!el || el.disabled) return;
        const start = el.selectionStart == null ? el.value.length : el.selectionStart;
        const end = el.selectionEnd == null ? el.value.length : el.selectionEnd;
        el.value = el.value.slice(0, start) + item + el.value.slice(end);
        const pos = start + item.length;
        win.el.classList.remove('is-emoji');
        try {
            el.focus();
            el.setSelectionRange(pos, pos);
        } catch (e) { /* ignore */ }
    }

    async function titret(win) {
        if (denyClosed(win)) return;
        shake(win.el);
        if (isKantar(win.peer) && isAmir()) {
            try {
                if (window.SessionManager && typeof SessionManager.sendKantarNudge === 'function') {
                    SessionManager.sendKantarNudge(win.peer);
                }
            } catch (e) { /* ignore */ }
            systemLine(win, 'Evrak notu gönderildi');
            return;
        }
        try {
            const res = await fetch('/api/chat/buzz', {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ to: win.peer }),
            });
            if (res.status === 429) {
                systemLine(win, 'Biraz bekleyin');
                return;
            }
            if (!res.ok) {
                systemLine(win, 'Titretme gönderilemedi');
                return;
            }
            systemLine(win, 'Titreşim gönderildi');
        } catch (e) {
            systemLine(win, 'Titretme gönderilemedi');
        }
    }

    const QUICK_TEXT = ['Tamam', 'Geliyorum', 'Evraklar yolda', 'Evraklar geldi', 'Bekleyin', 'Müsait misiniz?', 'Kantara gelin', 'Ofise gelin', 'Araç çıktı', 'Anlaşıldı'];
    const QUICK_EMOJI = ['👍', '✅', '📞', '⏰', '🚛', '📄', '👋', '🙏'];

    function fillQuick(win) {
        const list = win.el.querySelector('.gpm-msn-quick-list');
        const emojiPop = win.el.querySelector('.gpm-msn-emoji-pop');
        QUICK_EMOJI.forEach((item) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.textContent = item;
            btn.title = item;
            btn.addEventListener('click', () => insertEmoji(win, item));
            emojiPop.appendChild(btn);
        });
        QUICK_TEXT.forEach((item) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.textContent = item;
            btn.addEventListener('click', () => sendQuick(win, item));
            list.appendChild(btn);
        });
    }

    function focusInput(win) {
        const active = document.activeElement;
        const typing = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT');
        if (typing && active !== win.input) return;
        try { win.input.focus(); } catch (e) { /* ignore */ }
    }

    function placeWindow(host, el) {
        const badge = host.querySelector('#gpmMsnBadge');
        if (badge) host.insertBefore(el, badge.nextSibling);
        else host.insertBefore(el, host.firstChild);
    }

    function create(peer) {
        ensureStyle();
        const el = document.createElement('section');
        el.className = 'gpm-msn';
        el.setAttribute('data-peer', peer);
        el.innerHTML = ''
            + '<div class="gpm-msn-bar">'
            + '<div class="gpm-msn-ava"><img alt=""></div>'
            + '<div class="gpm-msn-id"><b></b><small><i class="gpm-msn-dot"></i><span class="gpm-msn-status"></span></small></div>'
            + '<button type="button" class="gpm-msn-min" title="Küçült">–</button>'
            + '<button type="button" class="gpm-msn-x" title="Kapat">×</button>'
            + '</div>'
            + '<div class="gpm-msn-log"></div>'
            + '<div class="gpm-msn-quick"><div class="gpm-msn-quick-list"></div></div>'
            + '<div class="gpm-msn-emoji-pop"></div>'
            + '<div class="gpm-msn-tools"><button type="button" class="gpm-msn-quick-btn">Hazır</button><button type="button" class="gpm-msn-buzz">Titret</button></div>'
            + '<p class="gpm-msn-lock">Amir yazınca cevap verebilirsiniz</p>'
            + '<form class="gpm-msn-compose"><textarea maxlength="400" placeholder="Mesaj yazın"></textarea><div class="gpm-msn-actions"><button type="button" class="gpm-msn-emoji-btn" title="Emoji">😊</button><button type="submit" class="gpm-msn-send">Gönder</button></div></form>';
        const win = {
            peer: peer,
            el: el,
            log: el.querySelector('.gpm-msn-log'),
            input: el.querySelector('textarea'),
            status: el.querySelector('.gpm-msn-status'),
            loaded: false,
        };
        const ava = el.querySelector('.gpm-msn-ava img');
        ava.src = avatarSrc(peer);
        ava.alt = personName(peer);
        el.querySelector('.gpm-msn-id b').textContent = personName(peer);
        paintStatus(win);
        el.querySelector('.gpm-msn-bar').addEventListener('click', (ev) => {
            if (ev.target.closest('.gpm-msn-min') || ev.target.closest('.gpm-msn-x')) return;
            el.classList.toggle('is-min');
            if (reading(win)) {
                clearUnread(peer);
                ackRead(peer);
            }
        });
        el.querySelector('.gpm-msn-min').addEventListener('click', () => {
            el.classList.toggle('is-min');
            if (reading(win)) {
                clearUnread(peer);
                ackRead(peer);
            }
        });
        el.querySelector('.gpm-msn-x').addEventListener('click', () => close(peer));
        el.querySelector('.gpm-msn-buzz').addEventListener('click', () => titret(win));
        fillQuick(win);
        el.querySelector('.gpm-msn-quick-btn').addEventListener('click', () => {
            el.classList.remove('is-emoji');
            el.classList.toggle('is-quick');
        });
        el.querySelector('.gpm-msn-emoji-btn').addEventListener('click', () => {
            el.classList.remove('is-quick');
            el.classList.toggle('is-emoji');
        });
        paintCompose(win);
        el.querySelector('form').addEventListener('submit', (ev) => {
            ev.preventDefault();
            send(win);
        });
        win.input.addEventListener('keydown', (ev) => {
            if (ev.key === 'Escape') {
                ev.preventDefault();
                close(peer);
                return;
            }
            if (ev.key === 'Enter' && !ev.shiftKey) {
                ev.preventDefault();
                send(win);
            }
        });
        const host = dock();
        placeWindow(host, el);
        windows.set(peer, win);
        while (windows.size > 3) {
            const oldest = host.lastElementChild;
            const oldKey = oldest && oldest.getAttribute('data-peer');
            if (!oldKey || oldKey === peer) break;
            close(oldKey);
        }
        return win;
    }

    function close(peer) {
        const win = windows.get(peer);
        if (!win) return;
        windows.delete(peer);
        if (win.el && win.el.parentNode) win.el.parentNode.removeChild(win.el);
    }

    async function open(key, opts) {
        const peer = siteKey(key);
        const mine = myKey();
        if (!peer || !mine || peer === mine) return null;
        const incoming = !!(opts && (opts.buzz || opts.force));
        if (!incoming && !mayReply(peer)) return null;
        window.__gpmChatPending = '';
        let win = windows.get(peer);
        if (!win) win = create(peer);
        else placeWindow(dock(), win.el);
        win.el.classList.remove('is-min');
        paintStatus(win);
        if (opts && opts.shake) shake(win.el);
        if (opts && opts.buzz) systemLine(win, personName(peer) + ' sizi titretti');
        focusInput(win);
        await loadHistory(win);
        paintCompose(win);
        clearUnread(peer);
        ackRead(peer);
        return win;
    }

    async function pullInbox() {
        if (pulling || !myKey()) return;
        pulling = true;
        try {
            const since = Math.max(0, readSync() - FRESH_MS);
            const res = await fetch('/api/chat/inbox?since=' + encodeURIComponent(String(since)), {
                credentials: 'include',
                cache: 'no-store',
            });
            if (!res.ok) return;
            const data = await res.json();
            if (data && data.clearedAt) wipeChat(data.clearedAt);
            if (Array.isArray(data.replyPeers)) applyReplyPeers(data.replyPeers);
            (data.messages || []).forEach((m) => ingest(m, true));
        } catch (e) { /* ignore */ }
        finally { pulling = false; }
    }

    function sseUp() {
        try { return !!(window.SyncManager && SyncManager.isConnected && SyncManager.isConnected()); } catch (e) { return false; }
    }

    function bindSse() {
        if (sseBound) return;
        if (!window.SyncManager || typeof SyncManager.on !== 'function') return;
        sseBound = true;
        SyncManager.on('chat_message', (data) => ingest(data, true));
        SyncManager.on('chat_read', (data) => {
            if (!data || siteKey(data.from) !== myKey()) return;
            applyRead(data.by, data.readAt);
        });
        SyncManager.on('chat_buzz', (data) => {
            if (!data || siteKey(data.to) !== myKey()) return;
            open(data.from, { shake: true, buzz: true });
            buzzSound();
        });
        SyncManager.on('chat_cleared', (data) => {
            wipeChat(data && data.clearedAt);
        });
    }

    function boot() {
        appliedCleared = readCleared();
        loadSeen();
        loadUnread();
        loadReply();
        ensureStyle();
        bindSse();
        refreshChips();
        paintBadge();
        const pending = window.__gpmChatPending;
        if (pending) open(pending);
        pullInbox();
        if (pollTimer) return;
        pollTimer = setInterval(() => {
            bindSse();
            if (document.hidden) return;
            if (sseUp()) return;
            pullInbox();
        }, POLL_MS);
        document.addEventListener('visibilitychange', () => { if (!document.hidden) pullInbox(); });
        window.addEventListener('online', () => pullInbox());
        window.addEventListener('storage', (ev) => {
            if (!ev) return;
            if (ev.key === CLEARED_KEY) {
                wipeChat(ev.newValue);
                return;
            }
            if (ev.key !== UNREAD_KEY && ev.key !== SEEN_KEY) return;
            loadSeen();
            loadUnread();
            refreshChips();
            paintBadge();
        });
        window.addEventListener('gpm-presence', () => {
            windows.forEach((win) => paintStatus(win));
        });
        document.addEventListener('pointerdown', unlockAudio, true);
        document.addEventListener('keydown', unlockAudio, true);
    }

    window.MsnChat = { open: open, siteKey: siteKey, wipe: wipeChat };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
})();
