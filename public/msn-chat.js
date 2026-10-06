/* Eski MSN penceresi: amir ve kantar yazışması.
   Canlı mesaj mevcut SSE hattından gider. Yedek yoklama yalnız bağlantı kopunca, 30 sn'de bir. */
(function () {
    const SYNC_KEY = 'gpm_chat_sync_v1';
    const UNREAD_KEY = 'gpm_chat_unread_v1';
    const POLL_MS = 30 * 1000;
    const FRESH_MS = 20 * 1000;

    const windows = new Map();
    const seen = new Set();
    let pollTimer = 0;
    let pulling = false;
    let sseBound = false;
    let audioCtx = null;

    function siteKey(value) {
        const raw = String(value || '').trim();
        const upper = raw.toLocaleUpperCase('tr-TR').replace(/\s+/g, '');
        if (upper === 'AVDAN') return 'AVDAN';
        if (upper === '1.OSB' || upper === '1OSB' || upper === 'OSB') return '1.OSB';
        if (upper === 'AMIR' || raw === 'AMİR' || upper === 'SELAHATTİN' || upper === 'SELAHATTIN' || upper === 'XXR') return 'AMIR';
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
        return key === 'AVDAN' || key === '1.OSB';
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

    function ding() {
        try {
            const AC = window.AudioContext || window.webkitAudioContext;
            if (!AC) return;
            if (!audioCtx) audioCtx = new AC();
            const start = () => {
                const t = audioCtx.currentTime + 0.02;
                [784, 988, 1318].forEach((freq, i) => {
                    const osc = audioCtx.createOscillator();
                    const gain = audioCtx.createGain();
                    osc.type = 'sine';
                    osc.frequency.value = freq;
                    const when = t + i * 0.11;
                    gain.gain.setValueAtTime(0.0001, when);
                    gain.gain.exponentialRampToValueAtTime(0.16, when + 0.02);
                    gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.22);
                    osc.connect(gain);
                    gain.connect(audioCtx.destination);
                    osc.start(when);
                    osc.stop(when + 0.24);
                });
            };
            if (audioCtx.state === 'suspended') audioCtx.resume().then(start).catch(() => {});
            else start();
        } catch (e) { /* ignore */ }
    }

    function shortName(key) {
        const k = siteKey(key);
        return ({ AMIR: 'SELAHATTİN', SABAN: 'ŞABAN', UGUR: 'UĞUR', AVDAN: 'AVDAN', '1.OSB': '1.OSB' })[k] || k || '—';
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
            document.body.appendChild(bar);
        }
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
            + '#gpmMsnDock{position:fixed;right:12px;bottom:12px;z-index:2147483000;display:flex;flex-direction:row-reverse;align-items:flex-end;gap:8px;pointer-events:none;max-width:calc(100vw - 16px)}'
            + '.gpm-msn{pointer-events:auto;position:relative;width:280px;height:360px;display:flex;flex-direction:column;background:#fff;border:1px solid #163e73;border-radius:8px 8px 4px 4px;box-shadow:3px 6px 18px rgba(10,30,70,.35);font-family:Tahoma,"Segoe UI",sans-serif;overflow:hidden}'
            + '.gpm-msn.is-min{height:auto}'
            + '.gpm-msn.is-min .gpm-msn-log,.gpm-msn.is-min .gpm-msn-tools,.gpm-msn.is-min .gpm-msn-compose,.gpm-msn.is-min .gpm-msn-quick{display:none}'
            + '.gpm-msn-bar{display:flex;align-items:center;gap:8px;padding:6px 8px;color:#fff;background:linear-gradient(#8ec4ef,#2d6cb8 42%,#163e73);cursor:pointer;user-select:none}'
            + '.gpm-msn-ava{width:28px;height:28px;border-radius:4px;background:#0b3a6e;display:flex;align-items:center;justify-content:center;font:700 13px Tahoma,sans-serif;flex:none;border:1px solid rgba(255,255,255,.35)}'
            + '.gpm-msn-id{flex:1;min-width:0}'
            + '.gpm-msn-id b{display:block;font-size:13px;line-height:1.15;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'
            + '.gpm-msn-id small{display:flex;align-items:center;gap:4px;font-size:10px;opacity:.9;font-weight:400}'
            + '.gpm-msn-dot{width:8px;height:8px;border-radius:99px;background:#94a3b8;display:inline-block}'
            + '.gpm-msn.is-on .gpm-msn-dot{background:#4ade80;box-shadow:0 0 0 2px rgba(74,222,128,.35)}'
            + '.gpm-msn-min,.gpm-msn-x{border:0;background:transparent;color:#fff;width:22px;height:18px;cursor:pointer;font:700 14px/1 Tahoma,sans-serif;border-radius:3px}'
            + '.gpm-msn-min:hover,.gpm-msn-x:hover{background:rgba(255,255,255,.18)}'
            + '.gpm-msn-log{flex:1;overflow:auto;padding:8px 10px;background:#fff}'
            + '.gpm-msn-row{margin:0 0 8px}'
            + '.gpm-msn-row .who{font:700 12px/1.3 Tahoma,sans-serif}'
            + '.gpm-msn-row.me .who{color:#1a5196}'
            + '.gpm-msn-row.them .who{color:#9f1239}'
            + '.gpm-msn-row .time{font-weight:400;color:#94a3b8;margin-left:6px;font-size:10px}'
            + '.gpm-msn-row .txt{font:12.5px/1.35 Tahoma,sans-serif;color:#111;white-space:pre-wrap;word-break:break-word}'
            + '.gpm-msn-sys{font:italic 11px/1.3 Tahoma,sans-serif;color:#64748b;margin:0 0 8px}'
            + '.gpm-msn-read{margin-top:2px;font:700 10px Tahoma,sans-serif;color:#15803d;text-align:right}'
            + '.gpm-msn-tools{display:flex;gap:8px;padding:2px 8px 0;background:#f4f8fc}'
            + '.gpm-msn-buzz,.gpm-msn-quick-btn{border:0;background:transparent;color:#163e73;font:700 11px Tahoma,sans-serif;cursor:pointer;padding:4px 0}'
            + '.gpm-msn-buzz:hover,.gpm-msn-quick-btn:hover{text-decoration:underline}'
            + '.gpm-msn-quick{display:none;position:absolute;left:6px;right:6px;bottom:78px;max-height:190px;overflow:auto;background:#fff;border:1px solid #b9cbe0;border-radius:6px;box-shadow:0 8px 18px rgba(10,30,70,.22);padding:6px;z-index:2}'
            + '.gpm-msn.is-quick .gpm-msn-quick{display:block}'
            + '.gpm-msn.is-min .gpm-msn-quick{display:none}'
            + '.gpm-msn-emoji{display:flex;flex-wrap:wrap;gap:4px;margin-bottom:6px}'
            + '.gpm-msn-emoji button,.gpm-msn-quick-list button{border:1px solid #d5e3f2;background:#f8fbff;border-radius:4px;cursor:pointer;font:12px Tahoma,sans-serif}'
            + '.gpm-msn-emoji button{width:28px;height:28px;font-size:16px;padding:0}'
            + '.gpm-msn-quick-list{display:flex;flex-direction:column;gap:4px}'
            + '.gpm-msn-quick-list button{text-align:left;padding:6px 8px;color:#0f172a}'
            + '.gpm-msn-quick-list button:hover,.gpm-msn-emoji button:hover{background:#e8f1fb}'
            + '.gpm-msn-compose{display:flex;gap:6px;padding:6px;background:#f4f8fc;border-top:1px solid #d5e3f2}'
            + '.gpm-msn-compose textarea{flex:1;resize:none;height:46px;border:1px solid #b9cbe0;border-radius:3px;padding:4px 6px;font:12.5px/1.35 Tahoma,sans-serif}'
            + '.gpm-msn-compose textarea:focus{outline:2px solid rgba(45,108,184,.35);border-color:#2d6cb8}'
            + '.gpm-msn-compose button{border:0;background:#163e73;color:#fff;border-radius:3px;padding:0 10px;font:700 12px Tahoma,sans-serif;cursor:pointer}'
            + '.gpm-msn-compose button:hover{background:#1d4f8f}'
            + '#gpmMsnBadge{position:fixed;left:16px;bottom:16px;z-index:2147483200;display:flex;flex-direction:column;gap:6px;align-items:flex-start}'
            + '.gpm-msn-badge{border:0;background:#dc2626;color:#fff;font:800 15px/1 Tahoma,sans-serif;border-radius:999px;padding:10px 14px;cursor:pointer;box-shadow:0 6px 16px rgba(220,38,38,.45)}'
            + '.gpm-msn-badge:hover{background:#b91c1c}'
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
            const arr = JSON.parse(localStorage.getItem('gpm_chat_seen_v1') || '[]');
            seen.clear();
            if (Array.isArray(arr)) arr.slice(-100).forEach((id) => seen.add(String(id)));
        } catch (e) { /* ignore */ }
    }

    function remember(id) {
        seen.add(String(id));
        const arr = Array.from(seen).slice(-100);
        seen.clear();
        arr.forEach((item) => seen.add(item));
        try { localStorage.setItem('gpm_chat_seen_v1', JSON.stringify(arr)); } catch (e) { /* ignore */ }
    }

    function hasLine(win, id) {
        if (!win || !win.log) return false;
        const safe = String(id).replace(/"/g, '');
        return !!win.log.querySelector('[data-id="' + safe + '"]');
    }

    function appendLine(win, msg) {
        const row = document.createElement('div');
        row.className = 'gpm-msn-row ' + (msg.from === myKey() ? 'me' : 'them');
        row.setAttribute('data-id', String(msg.id || ''));
        row.setAttribute('data-ts', String(Number(msg.ts) || 0));
        const who = document.createElement('div');
        who.className = 'who';
        who.appendChild(document.createTextNode(personName(msg.from) + ' diyor:'));
        const time = document.createElement('span');
        time.className = 'time';
        time.textContent = clock(msg.ts);
        who.appendChild(time);
        const body = document.createElement('div');
        body.className = 'txt';
        body.textContent = msg.text;
        row.appendChild(who);
        row.appendChild(body);
        if (msg.from === myKey() && msg.readAt) stampRead(row);
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

    function ingest(msg, live) {
        if (!msg || !msg.id) return;
        const id = String(msg.id);
        const mine = myKey();
        const from = siteKey(msg.from);
        const to = siteKey(msg.to);
        if (!mine || (from !== mine && to !== mine)) return;
        const peer = from === mine ? to : from;
        const win = windows.get(peer);
        if (win && !hasLine(win, id)) appendLine(win, msg);
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

    async function send(win) {
        const text = String(win.input.value || '').trim();
        if (!text) return;
        win.input.value = '';
        const ok = await postChat(win, text);
        if (!ok) win.input.value = text;
    }

    function sendQuick(win, text) {
        win.el.classList.remove('is-quick');
        postChat(win, text);
    }

    async function titret(win) {
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
        const emojiBox = win.el.querySelector('.gpm-msn-emoji');
        const list = win.el.querySelector('.gpm-msn-quick-list');
        QUICK_EMOJI.forEach((item) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.textContent = item;
            btn.addEventListener('click', () => sendQuick(win, item));
            emojiBox.appendChild(btn);
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

    function create(peer) {
        ensureStyle();
        const el = document.createElement('section');
        el.className = 'gpm-msn';
        el.setAttribute('data-peer', peer);
        el.innerHTML = ''
            + '<div class="gpm-msn-bar">'
            + '<div class="gpm-msn-ava"></div>'
            + '<div class="gpm-msn-id"><b></b><small><i class="gpm-msn-dot"></i><span class="gpm-msn-status"></span></small></div>'
            + '<button type="button" class="gpm-msn-min" title="Küçült">_</button>'
            + '<button type="button" class="gpm-msn-x" title="Kapat">×</button>'
            + '</div>'
            + '<div class="gpm-msn-log"></div>'
            + '<div class="gpm-msn-quick"><div class="gpm-msn-emoji"></div><div class="gpm-msn-quick-list"></div></div>'
            + '<div class="gpm-msn-tools"><button type="button" class="gpm-msn-quick-btn">Hazır</button><button type="button" class="gpm-msn-buzz">Titret</button></div>'
            + '<form class="gpm-msn-compose"><textarea maxlength="400" placeholder="Mesaj yazın"></textarea><button type="submit">Gönder</button></form>';
        const win = {
            peer: peer,
            el: el,
            log: el.querySelector('.gpm-msn-log'),
            input: el.querySelector('textarea'),
            status: el.querySelector('.gpm-msn-status'),
            loaded: false,
        };
        el.querySelector('.gpm-msn-ava').textContent = personName(peer).slice(0, 1);
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
            el.classList.toggle('is-quick');
        });
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
        host.insertBefore(el, host.firstChild);
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
        window.__gpmChatPending = '';
        let win = windows.get(peer);
        if (!win) win = create(peer);
        else dock().insertBefore(win.el, dock().firstChild);
        win.el.classList.remove('is-min');
        paintStatus(win);
        if (opts && opts.shake) shake(win.el);
        if (opts && opts.buzz) systemLine(win, personName(peer) + ' sizi titretti');
        focusInput(win);
        await loadHistory(win);
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
            ding();
        });
    }

    function boot() {
        loadSeen();
        loadUnread();
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
            if (!ev || (ev.key !== UNREAD_KEY && ev.key !== 'gpm_chat_seen_v1')) return;
            loadSeen();
            loadUnread();
            refreshChips();
            paintBadge();
        });
        window.addEventListener('gpm-presence', () => {
            windows.forEach((win) => paintStatus(win));
        });
        document.addEventListener('pointerdown', () => {
            if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
        }, true);
    }

    window.MsnChat = { open: open, siteKey: siteKey };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
})();
