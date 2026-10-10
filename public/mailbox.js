/* Kişiye özel posta. Herkes yalnız kendi mesajını, duyuruyu ve kendine düşen hatayı görür.
   Hata bildirimi Burak K.'ye gider. Simge yalnız ana sayfadadır. */
(function () {
    const POLL_MS = 30 * 1000;
    const NAMES = {
        AMIR: 'Selahattin',
        BURAK: 'Burak K.',
        SABAN: 'Şaban',
        UGUR: 'Uğur',
        AVDAN: 'Avdan',
        '1.OSB': '1.OSB',
        HERKES: 'Herkese',
        SISTEM: 'Sistem',
    };

    let threads = [];
    let unreadCount = 0;
    let clearedAt = 0;
    let openId = '';
    let mode = 'list';
    let boxName = 'gelen';
    let findText = '';
    let panel = null;
    let pollTimer = 0;
    let pulling = false;
    let sseBound = false;
    let lastFault = '';
    let dingAudio = null;
    let ozetLog = [];
    let ozetOn = false;

    function siteKey(value) {
        const raw = String(value || '').trim();
        const upper = raw.toLocaleUpperCase('tr-TR').replace(/\s+/g, '');
        if (upper === 'AVDAN') return 'AVDAN';
        if (upper === '1.OSB' || upper === '1OSB' || upper === 'OSB') return '1.OSB';
        if (upper === 'AMIR' || raw === 'AMİR' || upper === 'SELAHATTİN' || upper === 'SELAHATTIN' || upper === 'XXR') return 'AMIR';
        if (upper === 'BURAK' || upper === 'BURAKKARATAŞ' || upper === 'BURAKKARATAS') return 'BURAK';
        if (upper === 'SABAN' || upper === 'ŞABAN') return 'SABAN';
        if (upper === 'UGUR' || upper === 'UĞUR') return 'UGUR';
        if (upper === 'HERKES') return 'HERKES';
        return '';
    }

    function myKey() {
        try { return siteKey(localStorage.getItem('currentUserId')); } catch (e) { return ''; }
    }

    function signedIn() {
        try {
            if (localStorage.getItem('isLoggedIn') !== 'true') return false;
        } catch (e) { return false; }
        return !!myKey();
    }

    function loginScreenOpen() {
        try {
            if (document.documentElement.classList.contains('logged-in')) return false;
        } catch (e) { /* ignore */ }
        const loginScreen = document.getElementById('loginScreen');
        if (!loginScreen) return false;
        try {
            const style = window.getComputedStyle(loginScreen);
            return style.display !== 'none' && style.visibility !== 'hidden';
        } catch (e) { return false; }
    }

    function sessionOpen() {
        return signedIn() && !loginScreenOpen();
    }

    function onDriverHome() {
        try {
            const path = String(location.pathname || '/').split('?')[0].replace(/\\/g, '/').toLowerCase();
            const file = path.split('/').filter(Boolean).pop() || '';
            return file === '' || file === 'giris.html' || file === 'index.html';
        } catch (e) { return false; }
    }

    function homeSlot() {
        return onDriverHome() ? document.getElementById('gpmMailHome') : null;
    }

    function nameOf(key) {
        const upper = String(key || '').trim().toLocaleUpperCase('tr-TR');
        if (upper === 'SISTEM' || upper === 'SİSTEM') return 'Sistem';
        return NAMES[siteKey(key)] || siteKey(key) || '—';
    }

    function isAmir() {
        try { return !!(window.SessionManager && SessionManager.isAmirUser && SessionManager.isAmirUser()); } catch (e) { return false; }
    }

    function isBurak() {
        return myKey() === 'BURAK';
    }

    function clock(ts) {
        try {
            return new Date(ts || Date.now()).toLocaleString('tr-TR', {
                day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
            });
        } catch (e) { return ''; }
    }

    function buzzClip() {
        try {
            if (!window.__gpmMailBuzz) {
                window.__gpmMailBuzz = new Audio('/msn-nudge.mp3');
                window.__gpmMailBuzz.preload = 'auto';
            }
            const a = window.__gpmMailBuzz;
            a.volume = 1;
            a.currentTime = 0;
            const p = a.play();
            if (p && typeof p.catch === 'function') p.catch(function () {});
        } catch (e) { /* ignore */ }
    }

    function shakeLaunch() {
        const btn = document.querySelector('#gpmMailRail [data-box="gelen"]');
        if (!btn) return;
        btn.classList.remove('is-buzz');
        void btn.offsetWidth;
        btn.classList.add('is-buzz');
    }

    function titretTarget(thread) {
        if (!thread) return '';
        const me = myKey();
        const list = Array.isArray(thread.to) ? thread.to : [thread.to];
        const other = list.map(siteKey).filter(function (key) { return key && key !== me; });
        if (thread.scope !== 'HERKES' && other.length === 1) return other[0];
        const from = siteKey(thread.from);
        if (from && from !== me) return from;
        return '';
    }

    async function titret(target, noteEl) {
        const key = siteKey(target);
        if (!key || key === myKey() || key === 'HERKES') {
            showErr(noteEl, key === 'HERKES' ? 'Titretmek için kişi seçin' : 'Titretilecek kişi yok');
            return;
        }
        showErr(noteEl, '');
        if ((key === 'AVDAN' || key === '1.OSB') && isAmir()) {
            try {
                if (window.SessionManager && typeof SessionManager.sendKantarNudge === 'function') {
                    SessionManager.sendKantarNudge(key);
                }
            } catch (e) { /* ignore */ }
            return;
        }
        try {
            const res = await fetch('/api/chat/buzz', {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ to: key }),
            });
            let data = {};
            try { data = await res.json(); } catch (e) { data = {}; }
            if (!res.ok) showErr(noteEl, (data && data.error) || 'Titretme gönderilemedi');
        } catch (e) {
            showErr(noteEl, 'Titretme gönderilemedi');
        }
    }

    function titretButton(resolve, host) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'gpm-mail-send';
        btn.textContent = 'Titret';
        btn.addEventListener('click', function (ev) {
            ev.preventDefault();
            const raw = typeof resolve === 'function' ? resolve() : resolve;
            titret(raw, host.querySelector('.gpm-mail-err'));
        });
        return btn;
    }

    function ding() {
        try {
            if (!dingAudio) {
                dingAudio = new Audio('/mesaj-bildirim.mp3');
                dingAudio.preload = 'auto';
            }
            dingAudio.volume = 1;
            dingAudio.currentTime = 0;
            const p = dingAudio.play();
            if (p && typeof p.catch === 'function') p.catch(function () {});
        } catch (e) { /* ignore */ }
    }

    function unreadOf(thread, me) {
        if (!thread) return 0;
        const seen = thread.readAt && Number(thread.readAt[me]) || 0;
        return (thread.messages || []).filter(function (m) {
            return m.from !== me && Number(m.ts) > seen;
        }).length;
    }

    function unreadTotal() {
        return unreadCount;
    }

    function namesTo(thread) {
        if (!thread) return '—';
        if (thread.scope === 'HERKES') return 'Herkese';
        const list = Array.isArray(thread.to) ? thread.to : [thread.to];
        return list.map(nameOf).filter(Boolean).join(', ') || '—';
    }

    function inNamedBox(thread, me, name) {
        if (!thread) return false;
        if (name === 'gonderilen') return thread.from === me;
        if (name === 'herkese') return thread.scope === 'HERKES';
        if (name === 'hata') return thread.kind === 'hata';
        if (me === 'BURAK') return thread.kind !== 'hata' && thread.scope !== 'HERKES' && thread.from !== 'BURAK';
        return thread.kind !== 'hata' && thread.scope !== 'HERKES' && (thread.to || []).indexOf(me) !== -1 && thread.from !== me;
    }

    function inBox(thread, me) {
        return inNamedBox(thread, me, boxName);
    }

    function unreadIn(name) {
        const me = myKey();
        return threads.reduce(function (n, thread) {
            return n + (inNamedBox(thread, me, name) && unreadOf(thread, me) ? 1 : 0);
        }, 0);
    }

    function pagePath() {
        try { return String(location.pathname || '').slice(0, 120); } catch (e) { return ''; }
    }

    function rememberFault(msg) {
        const text = String(msg || '').replace(/\s+/g, ' ').trim().slice(0, 180);
        if (!text || text === 'Script error.') return;
        lastFault = text;
    }

    function ensureStyle() {
        if (document.getElementById('gpmMailStyle')) return;
        const style = document.createElement('style');
        style.id = 'gpmMailStyle';
        style.textContent = ''
            + '#gpmMailDock{position:relative;z-index:5;width:100%;max-width:100%;box-sizing:border-box;margin:.65rem 0 0;pointer-events:none}'
            + '.app-header:has(.gpm-mail:not([hidden])),body.session-amir .app-header:has(.gpm-mail:not([hidden])){overflow:visible}'
            + '.gpm-mail-home{display:none !important}'
            + '#gpmMailRail{pointer-events:auto;display:flex;align-items:center;gap:6px;width:100%;box-sizing:border-box;padding:6px;border-radius:12px;background:#fff;border:1px solid #e5e7eb}'
            + '.gpm-mail-tile{position:relative;min-width:0;height:36px;padding:0 12px;border:1px solid #e5e7eb;border-radius:8px;background:#fff;color:#334155;display:flex;align-items:center;justify-content:center;gap:6px;cursor:pointer;font:600 13px/1 "Segoe UI",sans-serif}'
            + '.gpm-mail-tile svg{width:16px;height:16px;stroke:currentColor;fill:none;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round;flex:none}'
            + '.gpm-mail-tile:hover{background:#f8fafc;border-color:#cbd5e1}'
            + '.gpm-mail-tile.on{background:#f1f5f9;border-color:#94a3b8;color:#0f172a}'
            + '.gpm-mail-tile .n{position:absolute;top:-6px;right:-4px;min-width:18px;height:18px;padding:0 4px;border-radius:999px;background:#e11d48;color:#fff;font:700 11px/18px "Segoe UI",sans-serif;text-align:center;box-sizing:border-box;box-shadow:0 0 0 2px #fff}'
            + '.gpm-mail-tile .n[hidden]{display:none !important}'
            + '.gpm-mail-tile.is-buzz{animation:gpmMailBuzz .45s linear}'
            + '.gpm-mail-write{margin-left:auto;height:36px;padding:0 12px;border:1px solid #e5e7eb;border-radius:8px;background:#fff;color:#0f172a;display:flex;align-items:center;gap:6px;cursor:pointer;font:600 13px/1 "Segoe UI",sans-serif}'
            + '.gpm-mail-write svg{width:15px;height:15px;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}'
            + '.gpm-mail-write.on,.gpm-mail-write:hover{background:#f8fafc;border-color:#94a3b8}'
            + '@keyframes gpmMailBuzz{0%,100%{transform:translateX(0)}20%{transform:translateX(-5px)}40%{transform:translateX(5px)}60%{transform:translateX(-4px)}80%{transform:translateX(4px)}}'
            + '.gpm-mail-mark{width:28px;height:28px;object-fit:contain;flex:none}'
            + '.gpm-mail{pointer-events:auto;position:absolute;left:50%;top:calc(100% + 8px);transform:translateX(-50%);z-index:40;width:min(760px,calc(100vw - 24px));height:min(520px,calc(100vh - 180px));display:flex;flex-direction:column;background:#fff;border:1px solid #e5e7eb;border-radius:12px;box-shadow:0 12px 32px rgba(15,23,42,.08);font-family:"Segoe UI",system-ui,sans-serif;overflow:hidden}'
            + '.gpm-mail[hidden]{display:none !important}'
            + '.gpm-mail-bar{display:flex;align-items:center;gap:8px;padding:12px 14px 10px;border-bottom:1px solid #f1f5f9;background:#fff}'
            + '.gpm-mail-title{font:700 14px/1 "Segoe UI",sans-serif;color:#0f172a}'
            + '.gpm-mail-gap{flex:1}'
            + '.gpm-mail-bar button,.gpm-mail-tools button,.gpm-mail-send{border:1px solid #e2e8f0;background:#f8fafc;color:#334155;font:700 12px/1 "Segoe UI",sans-serif;border-radius:999px;padding:8px 12px;cursor:pointer}'
            + '.gpm-mail-bar button:hover,.gpm-mail-tools button:hover{background:#eef2ff;border-color:#c7d2fe;color:#3730a3}'
            + '.gpm-mail-hata{background:#fef2f2 !important;border-color:#fecaca !important;color:#b91c1c !important}'
            + '.gpm-mail-body{flex:1;display:flex;min-height:0}'
            + '.gpm-mail-list{width:250px;flex:none;overflow:auto;border-right:1px solid #f1f5f9;background:#fff}'
            + '.gpm-mail-find{display:block;width:calc(100% - 16px);margin:8px;box-sizing:border-box;border:1px solid #e2e8f0;border-radius:10px;padding:7px 9px;font:600 12px "Segoe UI",sans-serif}'
            + '.gpm-mail-boxes{display:flex;flex-wrap:wrap;gap:4px;padding:0 8px 8px}'
            + '.gpm-mail-boxes button{border:1px solid #e2e8f0;background:#fff;color:#334155;font:700 11px/1 "Segoe UI",sans-serif;border-radius:999px;padding:5px 8px;cursor:pointer}'
            + '.gpm-mail-boxes button.on{background:#4f46e5;color:#fff;border-color:#4f46e5}'
            + '.gpm-mail-people{display:flex;flex-wrap:wrap;gap:6px 10px}'
            + '.gpm-mail-people label{font:600 12px/1.2 "Segoe UI",sans-serif;color:#334155;display:flex;align-items:center;gap:4px}'
            + '.gpm-mail-read{display:block;margin-top:4px;color:#475569;font-weight:650}'
            + '.gpm-mail-item{display:block;width:100%;text-align:left;border:0;border-bottom:1px solid #eef2f7;background:transparent;padding:10px 12px;cursor:pointer;font:600 12.5px/1.35 "Segoe UI",sans-serif;color:#0f172a}'
            + '.gpm-mail-item.on{background:#f8fafc}'
            + '.gpm-mail-item .sub{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'
            + '.gpm-mail-item small{display:block;margin-top:3px;color:#64748b;font-weight:600}'
            + '.gpm-mail-item .tag{display:inline-block;margin-right:6px;background:#fee2e2;color:#b91c1c;border-radius:999px;padding:1px 6px;font-size:10px}'
            + '.gpm-mail-item.is-new{box-shadow:inset 3px 0 0 #94a3b8}'
            + '.gpm-mail-main{flex:1;min-width:0;display:flex;flex-direction:column;background:#fff}'
            + '.gpm-mail-log{flex:1;overflow:auto;padding:14px 14px 8px}'
            + '.gpm-mail-empty{padding:28px 16px;color:#64748b;font:600 13px/1.45 "Segoe UI",sans-serif}'
            + '.gpm-mail-head{margin:0 0 12px}'
            + '.gpm-mail-head b{display:block;font-size:16px;color:#0f172a}'
            + '.gpm-mail-head small{display:block;margin-top:4px;color:#64748b;font-weight:600}'
            + '.gpm-mail-msg{margin:0 0 10px;max-width:92%}'
            + '.gpm-mail-msg.me{margin-left:auto}'
            + '.gpm-mail-msg .who{font:700 11px/1.2 "Segoe UI",sans-serif;color:#64748b;margin-bottom:3px}'
            + '.gpm-mail-msg .bubble{padding:8px 11px;border-radius:14px;background:#f1f5f9;color:#0f172a;font:13.5px/1.4 "Segoe UI",sans-serif;white-space:pre-wrap;word-break:break-word}'
            + '.gpm-mail-msg.me .bubble{background:#0f172a;color:#fff}'
            + '.gpm-mail-msg .time{display:block;margin-top:3px;font:600 10px "Segoe UI",sans-serif;color:#94a3b8;text-align:right}'
            + '.gpm-ozet-pick{align-self:flex-start;border:1px solid #e5e7eb;background:#fff;color:#0f172a;border-radius:8px;padding:8px 12px;font:700 13px "Segoe UI",sans-serif;cursor:pointer}'
            + '.gpm-ozet-chat{flex:1;min-height:0;display:flex;flex-direction:column;background:#fff}'
            + '.gpm-ozet-top{display:flex;align-items:center;justify-content:space-between;padding:8px 12px;border-bottom:1px solid #f1f5f9}'
            + '.gpm-ozet-top b{font:700 14px "Segoe UI",sans-serif;color:#0f172a}'
            + '.gpm-ozet-back{border:0;background:transparent;color:#64748b;font:600 12px "Segoe UI",sans-serif;cursor:pointer}'
            + '.gpm-ozet-log{flex:1;overflow:auto;padding:12px;display:flex;flex-direction:column;gap:8px}'
            + '.gpm-ozet-hint{margin:0;color:#64748b;font:600 13px/1.45 "Segoe UI",sans-serif}'
            + '.gpm-ozet-ask{display:flex;gap:8px;padding:10px 12px;border-top:1px solid #f1f5f9}'
            + '.gpm-ozet-ask input{flex:1;width:auto;border:1px solid #e5e7eb;border-radius:8px;padding:9px 11px;font:13.5px/1.35 "Segoe UI",sans-serif;background:#fff;color:#0f172a}'
            + '.gpm-ozet-ask button{border:1px solid #0f172a;background:#0f172a;color:#fff;border-radius:8px;padding:0 14px;font:600 13px "Segoe UI",sans-serif;cursor:pointer}'
            + '.gpm-mail-compose{display:flex;flex-direction:column;gap:8px;padding:10px 12px 12px;border-top:1px solid #eef2f7}'
            + '.gpm-mail-compose input,.gpm-mail-compose textarea,.gpm-mail-compose select{width:100%;box-sizing:border-box;border:1px solid #e5e7eb;border-radius:8px;padding:9px 11px;font:13.5px/1.35 "Segoe UI",sans-serif;background:#fff;color:#0f172a}'
            + '.gpm-mail-compose .gpm-ozet-ask input{width:auto;flex:1}'
            + '.gpm-mail-compose textarea{resize:none;height:96px}'
            + '.gpm-mail-compose input:focus,.gpm-mail-compose textarea:focus,.gpm-mail-compose select:focus{outline:2px solid rgba(15,23,42,.12);border-color:#94a3b8;background:#fff}'
            + '.gpm-mail-row{display:flex;gap:8px}'
            + '.gpm-mail-row select{flex:1}'
            + '.gpm-mail-actions{display:flex;align-items:center;justify-content:flex-end;gap:8px;flex-wrap:wrap}'
            + '.gpm-mail-actions button{border:1px solid #e2e8f0;background:#f8fafc;color:#334155;font:700 12px/1 "Segoe UI",sans-serif;border-radius:999px;padding:8px 12px;cursor:pointer}'
            + '.gpm-mail-send{background:#0f172a !important;color:#fff !important;border:0 !important}'
            + '.gpm-mail-del{margin-right:auto;border:1px solid #fecaca;background:#fff;color:#b91c1c;font:700 12px/1 "Segoe UI",sans-serif;border-radius:999px;padding:8px 12px;cursor:pointer}'
            + '.gpm-mail-note{margin:0;color:#64748b;font:600 12px/1.4 "Segoe UI",sans-serif}'
            + '.gpm-mail-err{margin:0;color:#b91c1c;font:700 12px/1.3 "Segoe UI",sans-serif}'
            + '@media (max-width:720px){#gpmMailRail{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px;align-items:stretch}.gpm-mail-tile{flex-direction:column;height:auto;min-height:54px;padding:7px 2px;gap:3px;font-size:11px;line-height:1.1}.gpm-mail-tile > span:not(.n){display:block;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.gpm-mail-write{grid-column:1 / -1;margin:0;width:100%;height:38px;justify-content:center}.gpm-mail-body{flex-direction:column}.gpm-mail-list{width:100%;max-height:160px;border-right:0;border-bottom:1px solid #f1f5f9}}';
        document.head.appendChild(style);
    }

    const POS_KEY = 'gpmMailPos';

    function readPos() {
        try {
            const raw = JSON.parse(localStorage.getItem(POS_KEY) || '');
            if (raw && Number.isFinite(raw.left) && Number.isFinite(raw.top)) return raw;
        } catch (e) { /* ignore */ }
        return null;
    }

    function clampDock(dock) {
        const btn = document.getElementById('gpmMailLaunch');
        if (btn && btn.classList.contains('is-drag')) return;
        const w = dock.offsetWidth || 72;
        const h = dock.offsetHeight || 76;
        const maxL = Math.max(8, window.innerWidth - w - 8);
        const maxT = Math.max(8, window.innerHeight - h - 8);
        const saved = readPos();
        const left = saved ? Math.min(maxL, Math.max(8, saved.left)) : 16;
        const top = saved ? Math.min(maxT, Math.max(8, saved.top)) : Math.max(8, window.innerHeight - h - 16);
        dock.style.left = left + 'px';
        dock.style.top = top + 'px';
        const midY = top + h / 2;
        const midX = left + w / 2;
        dock.classList.toggle('is-down', midY < window.innerHeight * 0.42);
        dock.classList.toggle('is-right', midX > window.innerWidth * 0.55);
    }

    function bindDrag(btn) {
        if (btn.dataset.drag === '1') return;
        btn.dataset.drag = '1';
        let pointer = null;
        let startX = 0;
        let startY = 0;
        let origL = 0;
        let origT = 0;
        let moved = false;
        btn.addEventListener('pointerdown', function (ev) {
            if (ev.button != null && ev.button !== 0) return;
            const dock = document.getElementById('gpmMailDock');
            if (!dock) return;
            pointer = ev.pointerId;
            moved = false;
            const box = dock.getBoundingClientRect();
            startX = ev.clientX;
            startY = ev.clientY;
            origL = box.left;
            origT = box.top;
            try { btn.setPointerCapture(pointer); } catch (e) { /* ignore */ }
        });
        btn.addEventListener('pointermove', function (ev) {
            if (pointer !== ev.pointerId) return;
            const dx = ev.clientX - startX;
            const dy = ev.clientY - startY;
            if (!moved && Math.abs(dx) + Math.abs(dy) < 6) return;
            moved = true;
            btn.classList.add('is-drag');
            const dock = document.getElementById('gpmMailDock');
            if (!dock) return;
            const w = dock.offsetWidth || 72;
            const h = dock.offsetHeight || 76;
            const left = Math.min(window.innerWidth - w - 8, Math.max(8, origL + dx));
            const top = Math.min(window.innerHeight - h - 8, Math.max(8, origT + dy));
            dock.style.left = left + 'px';
            dock.style.top = top + 'px';
            dock.classList.toggle('is-down', top + h / 2 < window.innerHeight * 0.42);
            dock.classList.toggle('is-right', left + w / 2 > window.innerWidth * 0.55);
        });
        function endDrag(ev) {
            if (pointer == null || (ev && ev.pointerId != null && pointer !== ev.pointerId)) return;
            pointer = null;
            btn.classList.remove('is-drag');
            const dock = document.getElementById('gpmMailDock');
            if (moved && dock) {
                const box = dock.getBoundingClientRect();
                try {
                    localStorage.setItem(POS_KEY, JSON.stringify({
                        left: Math.round(box.left),
                        top: Math.round(box.top),
                    }));
                } catch (e) { /* ignore */ }
                return;
            }
            if (panel && !panel.hidden) closePanel();
            else openPanel('list');
        }
        btn.addEventListener('pointerup', endDrag);
        btn.addEventListener('pointercancel', function () {
            pointer = null;
            btn.classList.remove('is-drag');
        });
    }

    const RAIL = [
        ['gelen', 'Gelen', '<path d="M4 13h4.2L10 15.2h4L16 13H20v7H4z"/><path d="M12 3v8"/><path d="M9 8l3 3 3-3"/>'],
        ['gonderilen', 'Giden', '<path d="M4 11h16v8H4z"/><path d="M12 14V3"/><path d="M9 6l3-3 3 3"/>'],
        ['herkese', 'Herkese', '<circle cx="8" cy="8" r="2"/><circle cx="16" cy="8" r="2"/><path d="M4.5 17c.5-2.2 2-3.2 3.5-3.2S11 14.8 11.5 17"/><path d="M12.5 17c.5-2.2 2-3.2 3.5-3.2S19 14.8 19.5 17"/>'],
        ['hata', 'Hata', '<path d="M12 4l8 14H4z"/><path d="M12 10v4"/><path d="M12 16.2h.01"/>'],
    ];

    function boxLabel(name) {
        const row = RAIL.find(function (item) { return item[0] === name; });
        return row ? row[1] : 'Gelen';
    }

    function openTile(name) {
        const open = panel && !panel.hidden && boxName === name && mode !== 'new' && mode !== 'thread';
        if (open) {
            closePanel();
            return;
        }
        boxName = name;
        openId = '';
        mode = 'list';
        openPanel('list');
    }

    function openCompose() {
        if (panel && !panel.hidden && mode === 'new') {
            closePanel();
            return;
        }
        openId = '';
        openPanel('new');
    }

    function paintRail() {
        const rail = document.getElementById('gpmMailRail');
        if (!rail) return;
        const open = panel && !panel.hidden && mode !== 'new';
        rail.querySelectorAll('.gpm-mail-tile').forEach(function (tile) {
            const name = tile.getAttribute('data-box');
            tile.classList.toggle('on', !!(open && name === boxName));
            const badge = tile.querySelector('.n');
            const count = unreadIn(name);
            if (!badge) return;
            badge.hidden = !count;
            badge.textContent = count ? String(count) : '';
        });
        const write = rail.querySelector('.gpm-mail-write');
        if (write) write.classList.toggle('on', !!(panel && !panel.hidden && mode === 'new'));
    }

    function placeDock(dock) {
        const header = document.querySelector('.app-sticky-top .app-header');
        if (!header) return false;
        if (dock.parentNode !== header) header.appendChild(dock);
        return true;
    }

    function launch() {
        if (!sessionOpen() || !onDriverHome()) return;
        ensureStyle();
        if (panel && !panel.isConnected) panel = null;
        const slot = document.getElementById('gpmMailHome');
        if (slot) slot.hidden = true;
        if (!document.querySelector('.app-sticky-top .app-header')) return;
        let dock = document.getElementById('gpmMailDock');
        if (!dock) {
            dock = document.createElement('div');
            dock.id = 'gpmMailDock';
        }
        placeDock(dock);
        let rail = document.getElementById('gpmMailRail');
        if (!rail) {
            const old = document.getElementById('gpmMailLaunch');
            if (old) old.remove();
            rail = document.createElement('div');
            rail.id = 'gpmMailRail';
            rail.setAttribute('role', 'tablist');
            rail.setAttribute('aria-label', 'Posta');
            RAIL.forEach(function (item) {
                const tile = document.createElement('button');
                tile.type = 'button';
                tile.className = 'gpm-mail-tile';
                tile.setAttribute('data-box', item[0]);
                tile.setAttribute('aria-label', item[1]);
                tile.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true">' + item[2] + '</svg><span>' + item[1] + '</span><span class="n" hidden></span>';
                tile.addEventListener('click', function () { openTile(item[0]); });
                rail.appendChild(tile);
            });
            const write = document.createElement('button');
            write.type = 'button';
            write.className = 'gpm-mail-write';
            write.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg><span>Yeni mesaj</span>';
            write.addEventListener('click', openCompose);
            rail.appendChild(write);
            dock.insertBefore(rail, dock.firstChild);
        }
        paintRail();
    }

    function current() {
        return threads.find(function (t) { return t.id === openId; }) || null;
    }

    function peopleOptions(selected) {
        const me = myKey();
        const keys = ['HERKES', 'AMIR', 'BURAK', 'SABAN', 'UGUR', 'AVDAN', '1.OSB'];
        return keys.filter(function (k) { return k === 'HERKES' || k !== me; }).map(function (k) {
            return '<option value="' + k + '"' + (k === selected ? ' selected' : '') + '>' + nameOf(k) + '</option>';
        }).join('');
    }

    function paintList(host) {
        const me = myKey();
        const find = host.querySelector('.gpm-mail-find');
        const keepFind = find && document.activeElement === find;
        if (!keepFind) {
            host.textContent = '';
            const search = document.createElement('input');
            search.className = 'gpm-mail-find';
            search.type = 'search';
            search.placeholder = 'Ara: konu, kişi, plaka';
            search.value = findText;
            search.addEventListener('input', function () {
                findText = search.value;
                clearTimeout(search._wait);
                search._wait = setTimeout(pull, 250);
            });
            host.appendChild(search);
        } else {
            Array.prototype.slice.call(host.querySelectorAll('.gpm-mail-item, .gpm-mail-empty')).forEach(function (el) { el.remove(); });
        }
        const rows = threads.filter(function (t) { return inBox(t, me); });
        if (!rows.length) {
            const empty = document.createElement('div');
            empty.className = 'gpm-mail-empty';
            empty.textContent = findText ? 'Sonuç yok.' : 'Bu kutuda mesaj yok.';
            host.appendChild(empty);
            return;
        }
        rows.forEach(function (t) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'gpm-mail-item' + (t.id === openId ? ' on' : '') + (unreadOf(t, me) ? ' is-new' : '');
            const sub = document.createElement('span');
            sub.className = 'sub';
            if (t.pinned) sub.appendChild(document.createTextNode('📌 '));
            if (t.kind === 'hata') {
                const tag = document.createElement('span');
                tag.className = 'tag';
                tag.textContent = 'Hata';
                sub.appendChild(tag);
            }
            sub.appendChild(document.createTextNode(t.subject || 'Konu'));
            const meta = document.createElement('small');
            meta.textContent = nameOf(t.from) + ' → ' + namesTo(t);
            btn.appendChild(sub);
            btn.appendChild(meta);
            btn.addEventListener('click', function () {
                openId = t.id;
                mode = 'thread';
                paint();
                markRead(t.id);
            });
            host.appendChild(btn);
        });
    }

    function paintThread(main) {
        const t = current();
        main.textContent = '';
        if (!t) {
            const empty = document.createElement('div');
            empty.className = 'gpm-mail-empty';
            empty.textContent = 'Soldan bir konu seçin veya yeni mesaj yazın.';
            main.appendChild(empty);
            return;
        }
        const log = document.createElement('div');
        log.className = 'gpm-mail-log';
        const head = document.createElement('div');
        head.className = 'gpm-mail-head';
        const title = document.createElement('b');
        title.textContent = (t.pinned ? '📌 ' : '') + (t.kind === 'hata' ? 'Hata · ' : '') + (t.subject || '');
        const meta = document.createElement('small');
        const bits = [nameOf(t.from) + ' → ' + namesTo(t)];
        if (t.plate) bits.push(t.plate);
        if (t.page) bits.push(t.page);
        meta.textContent = bits.join(' · ');
        head.appendChild(title);
        head.appendChild(meta);
        const me = myKey();
        if (t.from === me || me === 'BURAK') {
            const people = (t.to || []).filter(function (key) { return key !== t.from; });
            if (people.length) {
                const seen = document.createElement('small');
                seen.className = 'gpm-mail-read';
                seen.textContent = people.map(function (key) {
                    const at = t.readAt && t.readAt[key];
                    return nameOf(key) + (at ? ' okudu ' + clock(at) : ' okumadı');
                }).join(' · ');
                head.appendChild(seen);
            }
        }
        log.appendChild(head);
        (t.messages || []).forEach(function (m) {
            const row = document.createElement('div');
            row.className = 'gpm-mail-msg' + (m.from === me ? ' me' : '');
            const who = document.createElement('div');
            who.className = 'who';
            who.textContent = nameOf(m.from);
            const bubble = document.createElement('div');
            bubble.className = 'bubble';
            bubble.textContent = m.text || '';
            const time = document.createElement('span');
            time.className = 'time';
            time.textContent = clock(m.ts);
            row.appendChild(who);
            row.appendChild(bubble);
            row.appendChild(time);
            log.appendChild(row);
        });
        const form = document.createElement('form');
        form.className = 'gpm-mail-compose';
        const area = document.createElement('textarea');
        area.maxLength = 1500;
        area.placeholder = 'Cevap yazın';
        area.required = true;
        const err = document.createElement('p');
        err.className = 'gpm-mail-err';
        err.hidden = true;
        const send = document.createElement('button');
        send.type = 'submit';
        send.className = 'gpm-mail-send';
        send.textContent = 'Cevapla';
        form.appendChild(area);
        form.appendChild(err);
        const actions = document.createElement('div');
        actions.className = 'gpm-mail-actions';
        if (isBurak()) {
            const del = document.createElement('button');
            del.type = 'button';
            del.className = 'gpm-mail-del';
            del.textContent = 'Mesaj sil';
            del.addEventListener('click', function () { removeThread(t.id); });
            actions.appendChild(del);
        }
        if (t.scope === 'HERKES' && (isBurak() || t.from === myKey())) {
            const pin = document.createElement('button');
            pin.type = 'button';
            pin.textContent = t.pinned ? 'Sabiti kaldır' : 'Sabitle';
            pin.addEventListener('click', function () { pinThread(t.id, !t.pinned); });
            actions.appendChild(pin);
        }
        if (t.kind === 'hata' && isBurak()) {
            const share = document.createElement('button');
            share.type = 'button';
            share.textContent = t.shared ? 'Ortakta gizle' : 'Herkese göster';
            share.addEventListener('click', function () { shareThread(t.id, !t.shared); });
            actions.appendChild(share);
        }
        actions.appendChild(titretButton(function () { return titretTarget(t); }, form));
        actions.appendChild(send);
        form.appendChild(actions);
        form.addEventListener('submit', function (ev) {
            ev.preventDefault();
            sendReply(t.id, area.value, err, send);
        });
        main.appendChild(log);
        main.appendChild(form);
        log.scrollTop = log.scrollHeight;
    }

    function chosenPeople(wrap) {
        const all = wrap.querySelector('input[value="HERKES"]');
        if (all && all.checked) return ['HERKES'];
        return Array.prototype.slice.call(wrap.querySelectorAll('input[data-person]:checked')).map(function (el) { return el.value; });
    }

    function paintOzetChat(main) {
        main.textContent = '';
        const chat = document.createElement('div');
        chat.className = 'gpm-ozet-chat';
        const top = document.createElement('div');
        top.className = 'gpm-ozet-top';
        const name = document.createElement('b');
        name.textContent = 'Özet';
        const back = document.createElement('button');
        back.type = 'button';
        back.className = 'gpm-ozet-back';
        back.textContent = 'Mesaja dön';
        back.addEventListener('click', function () {
            ozetOn = false;
            paint();
        });
        top.appendChild(name);
        top.appendChild(back);
        const log = document.createElement('div');
        log.className = 'gpm-ozet-log';
        paintOzetLog(log);
        const row = document.createElement('form');
        row.className = 'gpm-ozet-ask';
        const input = document.createElement('input');
        input.maxLength = 500;
        input.placeholder = 'Yaz…';
        const ask = document.createElement('button');
        ask.type = 'submit';
        ask.textContent = 'Gönder';
        row.addEventListener('submit', function (e) {
            e.preventDefault();
            askOzet(input, log, ask);
        });
        row.appendChild(input);
        row.appendChild(ask);
        chat.appendChild(top);
        chat.appendChild(log);
        chat.appendChild(row);
        main.appendChild(chat);
        input.focus();
    }

    function paintOzetLog(log) {
        log.textContent = '';
        if (!ozetLog.length) {
            const hint = document.createElement('p');
            hint.className = 'gpm-ozet-hint';
            hint.textContent = 'Limana, piyasa listesine ve bugünün raporuna bakıp cevap veririm. Konuştuklarımızı hatırlarım.';
            log.appendChild(hint);
            return;
        }
        ozetLog.forEach(function (row) {
            const wrap = document.createElement('div');
            wrap.className = 'gpm-mail-msg' + (row.me ? ' me' : '');
            const who = document.createElement('div');
            who.className = 'who';
            who.textContent = row.me ? 'Sen' : 'Özet';
            const bubble = document.createElement('div');
            bubble.className = 'bubble';
            bubble.textContent = row.text;
            wrap.appendChild(who);
            wrap.appendChild(bubble);
            log.appendChild(wrap);
        });
        log.scrollTop = log.scrollHeight;
    }

    async function askOzet(input, log, ask) {
        const text = String(input.value || '').trim();
        if (!text) return;
        input.value = '';
        ozetLog.push({ me: true, text: text });
        paintOzetLog(log);
        if (ask) ask.disabled = true;
        try {
            const res = await fetch('/api/ozet', {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    messages: ozetLog.map(function (row) {
                        return { role: row.me ? 'user' : 'assistant', text: row.text };
                    }),
                }),
            });
            const data = await res.json().catch(function () { return {}; });
            ozetLog.push({ me: false, text: (data && data.reply) || 'Şu an bakamadım, bir daha dene.' });
        } catch (e) {
            ozetLog.push({ me: false, text: 'Şu an bakamadım, bir daha dene.' });
        }
        if (ask) ask.disabled = false;
        paintOzetLog(log);
        while (ozetLog.length > 24) ozetLog.shift();
    }

    function paintCompose(main) {
        const hata = mode === 'hata' || (boxName === 'hata' && mode !== 'new');
        main.textContent = '';
        const form = document.createElement('form');
        form.className = 'gpm-mail-compose';
        form.style.borderTop = '0';
        form.style.flex = '1';
        const note = document.createElement('p');
        note.className = 'gpm-mail-note';
        note.textContent = hata
            ? 'Bu bildirim yalnız Burak K.’ye gider. O isterse herkese açar.'
            : 'Seçtiğin kişiler görür. Herkese, altı hesabın duyurusudur.';
        const people = document.createElement('div');
        people.className = 'gpm-mail-people';
        if (hata) {
            const fixed = document.createElement('input');
            fixed.readOnly = true;
            fixed.value = 'Burak K.';
            people.appendChild(fixed);
        } else {
            const me = myKey();
            const allLabel = document.createElement('label');
            const all = document.createElement('input');
            all.type = 'checkbox';
            all.value = 'HERKES';
            allLabel.appendChild(all);
            allLabel.appendChild(document.createTextNode('Herkese'));
            people.appendChild(allLabel);
            ['AMIR', 'BURAK', 'SABAN', 'UGUR', 'AVDAN', '1.OSB'].filter(function (key) { return key !== me; }).forEach(function (key) {
                const label = document.createElement('label');
                const box = document.createElement('input');
                box.type = 'checkbox';
                box.value = key;
                box.setAttribute('data-person', '1');
                label.appendChild(box);
                label.appendChild(document.createTextNode(nameOf(key)));
                people.appendChild(label);
            });
            all.addEventListener('change', function () {
                people.querySelectorAll('input[data-person]').forEach(function (el) {
                    el.checked = all.checked;
                    el.disabled = all.checked;
                });
            });
        }
        const subject = document.createElement('input');
        subject.maxLength = 80;
        subject.placeholder = hata ? 'Hata başlığı' : 'Konu';
        subject.required = true;
        if (hata && lastFault) subject.value = lastFault;
        const plate = document.createElement('input');
        plate.maxLength = 16;
        plate.placeholder = 'Plaka (isteğe bağlı)';
        const area = document.createElement('textarea');
        area.maxLength = 1500;
        area.placeholder = hata ? 'Ne oldu, hangi ekranda?' : 'Mesaj';
        area.required = true;
        const err = document.createElement('p');
        err.className = 'gpm-mail-err';
        err.hidden = true;
        const send = document.createElement('button');
        send.type = 'submit';
        send.className = 'gpm-mail-send';
        send.textContent = hata ? 'Burak K.’ye bildir' : 'Gönder';
        form.appendChild(note);
        if (!hata) {
            const pick = document.createElement('button');
            pick.type = 'button';
            pick.className = 'gpm-ozet-pick';
            pick.textContent = 'Özet';
            pick.addEventListener('click', function () {
                ozetOn = true;
                paint();
            });
            form.appendChild(pick);
        }
        form.appendChild(people);
        form.appendChild(subject);
        form.appendChild(plate);
        form.appendChild(area);
        form.appendChild(err);
        const actions = document.createElement('div');
        actions.className = 'gpm-mail-actions';
        if (!hata) {
            actions.appendChild(titretButton(function () {
                const picked = chosenPeople(people).filter(function (key) { return key !== 'HERKES'; });
                return picked.length === 1 ? picked[0] : '';
            }, form));
        }
        actions.appendChild(send);
        form.appendChild(actions);
        form.addEventListener('submit', function (ev) {
            ev.preventDefault();
            const to = hata ? ['BURAK'] : chosenPeople(people);
            if (!hata && !to.length) {
                showErr(err, 'Kişi seçin');
                return;
            }
            sendOpen({
                to: to,
                subject: subject.value,
                text: area.value,
                kind: hata ? 'hata' : 'mail',
                page: hata ? pagePath() : '',
                plate: plate.value,
            }, err, send);
        });
        main.appendChild(form);
        subject.focus();
    }

    function paint() {
        if (!panel) return;
        const list = panel.querySelector('.gpm-mail-list');
        const main = panel.querySelector('.gpm-mail-main');
        paintList(list);
        const title = panel.querySelector('.gpm-mail-title');
        if (title) title.textContent = mode === 'new' && ozetOn ? 'Özet' : (mode === 'new' ? 'Yeni mesaj' : boxLabel(boxName));
        if (mode === 'new' && ozetOn) paintOzetChat(main);
        else if (mode === 'new' || mode === 'hata' || (boxName === 'hata' && !current())) paintCompose(main);
        else paintThread(main);
        launch();
    }

    function openPanel(next) {
        if (!sessionOpen()) return;
        ensureStyle();
        mode = next || 'list';
        if (!panel) {
            panel = document.createElement('section');
            panel.className = 'gpm-mail';
            panel.innerHTML = ''
                + '<div class="gpm-mail-bar"><b class="gpm-mail-title">Gelen</b></div>'
                + '<div class="gpm-mail-body"><div class="gpm-mail-list"></div><div class="gpm-mail-main"></div></div>';
            bindDismiss();
            document.getElementById('gpmMailDock').appendChild(panel);
        }
        panel.hidden = false;
        paint();
        pull();
    }

    let dismissBound = false;

    function bindDismiss() {
        if (dismissBound) return;
        dismissBound = true;
        document.addEventListener('keydown', function (ev) {
            if (ev.key === 'Escape' && panel && !panel.hidden) closePanel();
        });
        document.addEventListener('pointerdown', function (ev) {
            if (!panel || panel.hidden) return;
            const dock = document.getElementById('gpmMailDock');
            if (dock && ev.target && dock.contains(ev.target)) return;
            closePanel();
        });
    }

    function closePanel() {
        if (panel) panel.hidden = true;
        mode = 'list';
        paintRail();
    }

    function showErr(el, text) {
        if (!el) return;
        el.hidden = !text;
        el.textContent = text || '';
    }

    async function post(url, body) {
        const res = await fetch(url, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body || {}),
        });
        let data = {};
        try { data = await res.json(); } catch (e) { data = {}; }
        if (!res.ok || !data.ok) {
            const err = new Error((data && data.error) || 'Gönderilemedi');
            err.code = data && data.code;
            throw err;
        }
        return data;
    }

    function upsert(thread, announce) {
        if (!sessionOpen()) return;
        if (!thread || !thread.id) return;
        if (thread.updatedAt && clearedAt && thread.updatedAt < clearedAt) return;
        const prev = threads.find(function (t) { return t.id === thread.id; });
        const me = myKey();
        const last = (thread.messages || [])[thread.messages.length - 1];
        const fresh = !!(last && last.from !== me && (!prev || Number(thread.updatedAt) > Number(prev.updatedAt || 0)));
        threads = threads.filter(function (t) { return t.id !== thread.id; });
        threads.push(thread);
        threads.sort(function (a, b) {
            if (!!b.pinned !== !!a.pinned) return b.pinned ? 1 : -1;
            return b.updatedAt - a.updatedAt;
        });
        if (!findText) {
            unreadCount = threads.filter(function (row) { return unreadOf(row, me); }).length;
        } else if (fresh) unreadCount += 1;
        if (announce && fresh) ding();
        const typing = panel && panel.querySelector('textarea') && document.activeElement === panel.querySelector('textarea');
        if (panel && !panel.hidden && !typing) paint();
        else launch();
    }

    async function sendOpen(body, errEl, btn) {
        if (btn) btn.disabled = true;
        showErr(errEl, '');
        try {
            const data = await post('/api/mailbox', body);
            if (data.thread) {
                if (data.thread.kind === 'hata') boxName = 'hata';
                else if (data.thread.scope === 'HERKES') boxName = 'herkese';
                else boxName = 'gonderilen';
                upsert(data.thread, false);
                openId = data.thread.id;
                mode = 'thread';
                paint();
            }
        } catch (e) {
            showErr(errEl, e.message || 'Gönderilemedi');
        } finally {
            if (btn) btn.disabled = false;
        }
    }

    async function sendReply(id, text, errEl, btn) {
        if (btn) btn.disabled = true;
        showErr(errEl, '');
        try {
            const data = await post('/api/mailbox/reply', { id: id, text: text });
            if (data.thread) upsert(data.thread, false);
            mode = 'thread';
            paint();
        } catch (e) {
            showErr(errEl, e.message || 'Gönderilemedi');
        } finally {
            if (btn) btn.disabled = false;
        }
    }

    async function markRead(id) {
        const me = myKey();
        const t = threads.find(function (row) { return row.id === id; });
        if (!t || !unreadOf(t, me)) return;
        t.readAt = t.readAt || {};
        t.readAt[me] = Date.now();
        launch();
        try { await post('/api/mailbox/read', { id: id }); } catch (e) { /* ignore */ }
    }

    async function removeThread(id) {
        if (!window.confirm('Bu mesaj silinsin mi?')) return;
        try {
            await post('/api/mailbox/remove', { id: id });
            threads = threads.filter(function (t) { return t.id !== id; });
            if (openId === id) {
                openId = '';
                mode = 'list';
            }
            paint();
        } catch (e) { /* ignore */ }
    }

    async function pinThread(id, on) {
        try {
            const data = await post('/api/mailbox/pin', { id: id, pinned: !!on });
            if (data.thread) upsert(data.thread, false);
        } catch (e) { /* ignore */ }
    }

    async function shareThread(id, on) {
        try {
            const data = await post('/api/mailbox/share', { id: id, shared: !!on });
            if (data.thread) upsert(data.thread, false);
        } catch (e) { /* ignore */ }
    }

    function wipe(ts) {
        const n = Number(ts) || Date.now();
        if (n < clearedAt) return;
        clearedAt = n;
        threads = [];
        openId = '';
        mode = 'list';
        if (panel && !panel.hidden) paint();
        else launch();
    }

    async function pull() {
        if (pulling || !sessionOpen()) return;
        pulling = true;
        try {
            const q = findText ? ('?q=' + encodeURIComponent(findText)) : '';
            const res = await fetch('/api/mailbox' + q, { credentials: 'include', cache: 'no-store' });
            if (!res.ok) return;
            const data = await res.json();
            threads = Array.isArray(data.threads) ? data.threads : [];
            unreadCount = Number(data.unread) || 0;
            if (panel && !panel.hidden) paint();
            else launch();
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
        SyncManager.on('mailbox_opened', function (data) { upsert(data, true); });
        SyncManager.on('mailbox_reply', function (data) { upsert(data, true); });
        SyncManager.on('mailbox_removed', function (data) {
            if (!data || !data.id) return;
            threads = threads.filter(function (t) { return t.id !== data.id; });
            if (openId === data.id) {
                openId = '';
                mode = 'list';
            }
            if (panel && !panel.hidden) paint();
            else launch();
        });
        SyncManager.on('mailbox_cleared', function (data) { wipe(data && data.clearedAt); });
        SyncManager.on('mailbox_read', function (data) {
            if (!data || !data.id || !data.by) return;
            const row = threads.find(function (t) { return t.id === data.id; });
            if (!row) return;
            row.readAt = row.readAt || {};
            row.readAt[data.by] = data.readAt;
            if (panel && !panel.hidden && openId === row.id) paint();
        });
        SyncManager.on('chat_buzz', function (data) {
            if (!sessionOpen() || !data || siteKey(data.to) !== myKey()) return;
            buzzClip();
            shakeLaunch();
        });
    }

    function park() {
        if (pollTimer) {
            clearInterval(pollTimer);
            pollTimer = 0;
        }
        closePanel();
        const dock = document.getElementById('gpmMailDock');
        if (dock) dock.remove();
        const slot = document.getElementById('gpmMailHome');
        if (slot) slot.hidden = true;
        panel = null;
        openId = '';
        mode = 'list';
    }

    function start() {
        ensureStyle();
        launch();
        bindSse();
        pull();
        if (!pollTimer) {
            pollTimer = setInterval(function () {
                if (!sessionOpen()) {
                    park();
                    return;
                }
                bindSse();
                if (document.hidden) return;
                if (sseUp()) return;
                pull();
            }, POLL_MS);
        }
    }

    let syncTimer = 0;
    let syncTries = 0;

    function sync() {
        if (!onDriverHome()) {
            park();
            return;
        }
        if (sessionOpen()) {
            syncTries = 0;
            if (syncTimer) {
                clearTimeout(syncTimer);
                syncTimer = 0;
            }
            start();
            return;
        }
        park();
        if (!signedIn()) {
            syncTries = 0;
            return;
        }
        if (syncTimer || syncTries > 12) return;
        syncTries += 1;
        syncTimer = setTimeout(function () {
            syncTimer = 0;
            sync();
        }, 250);
    }

    function boot() {
        window.addEventListener('gpm-session-closed', sync);
        window.addEventListener('gpm-session-renewed', sync);
        window.addEventListener('storage', function (ev) {
            if (!ev || ev.key === 'isLoggedIn' || ev.key === 'currentUserId') sync();
        });
        window.addEventListener('error', function (ev) {
            rememberFault(ev && ev.message);
        });
        window.addEventListener('unhandledrejection', function (ev) {
            const reason = ev && ev.reason;
            rememberFault(reason && (reason.message || reason));
        });
        sync();
    }

    window.GpmMailbox = {
        open: function () { boxName = 'gelen'; openId = ''; openPanel('list'); },
        report: function () { openPanel('hata'); },
        sync: sync,
    };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
})();
