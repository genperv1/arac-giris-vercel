/* Ortak mesaj kutusu. Giriş yapmış her üye aynı konuları görür.
   Hata bildirimi Burak K.'ye gider ve kutuda herkese açıktır. */
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
    };

    let threads = [];
    let clearedAt = 0;
    let openId = '';
    let mode = 'list';
    let panel = null;
    let pollTimer = 0;
    let pulling = false;
    let sseBound = false;
    let lastFault = '';
    let dingAudio = null;

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

    function nameOf(key) {
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
        const btn = document.getElementById('gpmMailLaunch');
        if (!btn) return;
        btn.classList.remove('is-buzz');
        void btn.offsetWidth;
        btn.classList.add('is-buzz');
    }

    function titretTarget(thread) {
        if (!thread) return '';
        const me = myKey();
        const to = siteKey(thread.to);
        const from = siteKey(thread.from);
        if (to && to !== 'HERKES' && to !== me) return to;
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
        const me = myKey();
        return threads.reduce(function (n, t) { return n + (unreadOf(t, me) ? 1 : 0); }, 0);
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
            + '#gpmMailDock{position:fixed;left:16px;bottom:16px;z-index:2147483000;display:flex;flex-direction:column-reverse;align-items:flex-start;gap:8px;pointer-events:none}'
            + '#gpmMailLaunch{pointer-events:auto;position:relative;width:auto;height:auto;padding:0;border:0;background:transparent;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:3px}'
            + '.gpm-mail-markwrap{position:relative;width:46px;height:46px;display:block}'
            + '#gpmMailLaunch img{width:46px;height:46px;display:block;object-fit:contain;filter:drop-shadow(0 6px 12px rgba(15,23,42,.28))}'
            + '#gpmMailLaunch .n{position:absolute;top:-4px;right:-6px;min-width:18px;height:18px;padding:0 4px;border-radius:999px;background:#e11d48;color:#fff;font:700 11px/18px "Segoe UI",sans-serif;text-align:center;box-sizing:border-box;box-shadow:0 0 0 2px #fff}'
            + '#gpmMailLaunch .n[hidden]{display:none !important}'
            + '#gpmMailLaunch .gpm-mail-caption{font:700 11px/1 "Segoe UI",sans-serif;color:#0f172a;background:rgba(255,255,255,.94);border:1px solid #e2e8f0;border-radius:999px;padding:4px 8px;white-space:nowrap;box-shadow:0 2px 8px rgba(15,23,42,.12)}'
            + '#gpmMailLaunch.is-buzz{animation:gpmMailBuzz .45s linear}'
            + '@keyframes gpmMailBuzz{0%,100%{transform:translateX(0)}20%{transform:translateX(-5px)}40%{transform:translateX(5px)}60%{transform:translateX(-4px)}80%{transform:translateX(4px)}}'
            + '.gpm-mail-mark{width:28px;height:28px;object-fit:contain;flex:none}'
            + '.gpm-mail{pointer-events:auto;width:min(760px,calc(100vw - 32px));height:min(560px,calc(100vh - 88px));display:flex;flex-direction:column;background:#fff;border:1px solid #e2e8f0;border-radius:18px;box-shadow:0 22px 50px rgba(15,23,42,.18);font-family:"Segoe UI",system-ui,sans-serif;overflow:hidden}'
            + '.gpm-mail[hidden]{display:none !important}'
            + '.gpm-mail-bar{display:flex;align-items:center;gap:8px;padding:12px 12px 10px;border-bottom:1px solid #eef2f7}'
            + '.gpm-mail-gap{flex:1}'
            + '.gpm-mail-bar button,.gpm-mail-tools button,.gpm-mail-send{border:1px solid #e2e8f0;background:#f8fafc;color:#334155;font:700 12px/1 "Segoe UI",sans-serif;border-radius:999px;padding:8px 12px;cursor:pointer}'
            + '.gpm-mail-bar button:hover,.gpm-mail-tools button:hover{background:#eef2ff;border-color:#c7d2fe;color:#3730a3}'
            + '.gpm-mail-hata{background:#fef2f2 !important;border-color:#fecaca !important;color:#b91c1c !important}'
            + '.gpm-mail-body{flex:1;display:flex;min-height:0}'
            + '.gpm-mail-list{width:250px;flex:none;overflow:auto;border-right:1px solid #eef2f7;background:#f8fafc}'
            + '.gpm-mail-item{display:block;width:100%;text-align:left;border:0;border-bottom:1px solid #eef2f7;background:transparent;padding:10px 12px;cursor:pointer;font:600 12.5px/1.35 "Segoe UI",sans-serif;color:#0f172a}'
            + '.gpm-mail-item.on{background:#eef2ff}'
            + '.gpm-mail-item .sub{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'
            + '.gpm-mail-item small{display:block;margin-top:3px;color:#64748b;font-weight:600}'
            + '.gpm-mail-item .tag{display:inline-block;margin-right:6px;background:#fee2e2;color:#b91c1c;border-radius:999px;padding:1px 6px;font-size:10px}'
            + '.gpm-mail-item.is-new{box-shadow:inset 3px 0 0 #4f46e5}'
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
            + '.gpm-mail-msg.me .bubble{background:#4f46e5;color:#fff}'
            + '.gpm-mail-msg .time{display:block;margin-top:3px;font:600 10px "Segoe UI",sans-serif;color:#94a3b8;text-align:right}'
            + '.gpm-mail-compose{display:flex;flex-direction:column;gap:8px;padding:10px 12px 12px;border-top:1px solid #eef2f7}'
            + '.gpm-mail-compose input,.gpm-mail-compose textarea,.gpm-mail-compose select{width:100%;box-sizing:border-box;border:1px solid #e2e8f0;border-radius:12px;padding:9px 11px;font:13.5px/1.35 "Segoe UI",sans-serif;background:#f8fafc;color:#0f172a}'
            + '.gpm-mail-compose textarea{resize:none;height:72px}'
            + '.gpm-mail-compose input:focus,.gpm-mail-compose textarea:focus,.gpm-mail-compose select:focus{outline:2px solid rgba(79,70,229,.28);border-color:#6366f1;background:#fff}'
            + '.gpm-mail-row{display:flex;gap:8px}'
            + '.gpm-mail-row select{flex:1}'
            + '.gpm-mail-actions{display:flex;align-items:center;justify-content:flex-end;gap:8px}'
            + '.gpm-mail-send{background:#4f46e5 !important;color:#fff !important;border:0 !important}'
            + '.gpm-mail-del{margin-right:auto;border:1px solid #fecaca;background:#fff;color:#b91c1c;font:700 12px/1 "Segoe UI",sans-serif;border-radius:999px;padding:8px 12px;cursor:pointer}'
            + '.gpm-mail-note{margin:0;color:#64748b;font:600 12px/1.4 "Segoe UI",sans-serif}'
            + '.gpm-mail-err{margin:0;color:#b91c1c;font:700 12px/1.3 "Segoe UI",sans-serif}'
            + '@media (max-width:720px){.gpm-mail-body{flex-direction:column}.gpm-mail-list{width:100%;max-height:160px;border-right:0;border-bottom:1px solid #eef2f7}}';
        document.head.appendChild(style);
    }

    function launch() {
        if (!sessionOpen()) return;
        ensureStyle();
        let dock = document.getElementById('gpmMailDock');
        if (!dock) {
            dock = document.createElement('div');
            dock.id = 'gpmMailDock';
            document.body.appendChild(dock);
        }
        let btn = document.getElementById('gpmMailLaunch');
        if (!btn) {
            btn = document.createElement('button');
            btn.id = 'gpmMailLaunch';
            btn.type = 'button';
            btn.setAttribute('aria-label', 'Mesaj yaz');
            const mark = document.createElement('span');
            mark.className = 'gpm-mail-markwrap';
            const img = document.createElement('img');
            img.src = '/mailbox-icon.png?v=20261010f';
            img.alt = '';
            const badge = document.createElement('span');
            badge.className = 'n';
            badge.hidden = true;
            const cap = document.createElement('span');
            cap.className = 'gpm-mail-caption';
            cap.textContent = 'mesaj yaz';
            mark.appendChild(img);
            mark.appendChild(badge);
            btn.appendChild(mark);
            btn.appendChild(cap);
            btn.addEventListener('click', function () {
                if (panel && !panel.hidden) closePanel();
                else openPanel('list');
            });
            dock.appendChild(btn);
        }
        const n = unreadTotal();
        const badge = btn.querySelector('.n');
        if (!badge) return;
        badge.hidden = !n;
        badge.textContent = n ? String(n) : '';
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
        host.textContent = '';
        if (!threads.length) {
            const empty = document.createElement('div');
            empty.className = 'gpm-mail-empty';
            empty.textContent = 'Henüz konu yok.';
            host.appendChild(empty);
            return;
        }
        const me = myKey();
        threads.forEach(function (t) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'gpm-mail-item' + (t.id === openId ? ' on' : '') + (unreadOf(t, me) ? ' is-new' : '');
            const sub = document.createElement('span');
            sub.className = 'sub';
            if (t.kind === 'hata') {
                const tag = document.createElement('span');
                tag.className = 'tag';
                tag.textContent = 'Hata';
                sub.appendChild(tag);
            }
            sub.appendChild(document.createTextNode(t.subject || 'Konu'));
            const meta = document.createElement('small');
            meta.textContent = nameOf(t.from) + ' → ' + nameOf(t.to);
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
        title.textContent = (t.kind === 'hata' ? 'Hata · ' : '') + (t.subject || '');
        const meta = document.createElement('small');
        meta.textContent = nameOf(t.from) + ' → ' + nameOf(t.to) + (t.page ? ' · ' + t.page : '');
        head.appendChild(title);
        head.appendChild(meta);
        log.appendChild(head);
        const me = myKey();
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
        area.maxLength = 400;
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

    function paintCompose(main) {
        const hata = mode === 'hata';
        main.textContent = '';
        const form = document.createElement('form');
        form.className = 'gpm-mail-compose';
        form.style.borderTop = '0';
        form.style.flex = '1';
        const note = document.createElement('p');
        note.className = 'gpm-mail-note';
        note.textContent = hata
            ? 'Bu bildirim Burak K.’ye gider. Ortak kutuda bütün üyeler görür.'
            : 'Konu ortak kutuya düşer. Her üye okur ve cevap yazar.';
        const row = document.createElement('div');
        row.className = 'gpm-mail-row';
        let target;
        if (hata) {
            target = document.createElement('input');
            target.readOnly = true;
            target.value = 'Burak K.';
        } else {
            target = document.createElement('select');
            target.innerHTML = peopleOptions('HERKES');
        }
        const subject = document.createElement('input');
        subject.maxLength = 80;
        subject.placeholder = hata ? 'Hata başlığı' : 'Konu';
        subject.required = true;
        if (hata && lastFault) subject.value = lastFault;
        row.appendChild(target);
        const area = document.createElement('textarea');
        area.maxLength = 400;
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
        form.appendChild(row);
        form.appendChild(subject);
        form.appendChild(area);
        form.appendChild(err);
        const actions = document.createElement('div');
        actions.className = 'gpm-mail-actions';
        if (!hata) actions.appendChild(titretButton(function () { return target.value; }, form));
        actions.appendChild(send);
        form.appendChild(actions);
        form.addEventListener('submit', function (ev) {
            ev.preventDefault();
            sendOpen({
                to: hata ? 'BURAK' : target.value,
                subject: subject.value,
                text: area.value,
                kind: hata ? 'hata' : 'mail',
                page: hata ? pagePath() : '',
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
        if (mode === 'new' || mode === 'hata') paintCompose(main);
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
                + '<div class="gpm-mail-bar"><img class="gpm-mail-mark" src="/mailbox-icon.png?v=20261010f" alt=""><span class="gpm-mail-gap"></span>'
                + '<button type="button" data-act="new">Yeni mesaj</button>'
                + '<button type="button" class="gpm-mail-hata" data-act="hata">Hata bildir</button>'
                + '<button type="button" data-act="close">Kapat</button></div>'
                + '<div class="gpm-mail-body"><div class="gpm-mail-list"></div><div class="gpm-mail-main"></div></div>';
            panel.querySelector('[data-act="new"]').addEventListener('click', function () {
                openId = '';
                mode = 'new';
                paint();
            });
            panel.querySelector('[data-act="hata"]').addEventListener('click', function () {
                openId = '';
                mode = 'hata';
                paint();
            });
            panel.querySelector('[data-act="close"]').addEventListener('click', closePanel);
            document.getElementById('gpmMailDock').appendChild(panel);
        }
        panel.hidden = false;
        paint();
        pull();
    }

    function closePanel() {
        if (panel) panel.hidden = true;
        mode = 'list';
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
        threads.sort(function (a, b) { return b.updatedAt - a.updatedAt; });
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
            const res = await fetch('/api/mailbox', { credentials: 'include', cache: 'no-store' });
            if (!res.ok) return;
            const data = await res.json();
            if (data && data.clearedAt && data.clearedAt > clearedAt && !(data.threads || []).length) {
                clearedAt = data.clearedAt;
            }
            threads = Array.isArray(data.threads) ? data.threads : [];
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
        open: function () { openPanel('list'); },
        report: function () { openPanel('hata'); },
        sync: sync,
    };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
})();
