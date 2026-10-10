// Selahattin Toker (xxr) ekranı: 40 günde bir yenilenen liman şifreleri.
(function () {
  'use strict';

  var POLL_MS = 20000;
  var pulling = false;
  var openIssuedAt = 0;
  var timer = 0;

  function isSelahattin() {
    try {
      if (localStorage.getItem('isLoggedIn') !== 'true') return false;
      const id = String(localStorage.getItem('currentUserId') || '').trim().toLowerCase();
      return id === 'xxr' || id === 'burak';
    } catch (e) {
      return false;
    }
  }

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function person(slot) {
    var name = [slot.ad, slot.soyad].filter(Boolean).join(' ');
    var phone = slot.telefon ? (' · ' + slot.telefon) : '';
    return name ? (name + phone) : 'İsim yazılmadı';
  }

  function ensureStyle() {
    if (document.getElementById('limanGozetmenNoticeStyle')) return;
    var style = document.createElement('style');
    style.id = 'limanGozetmenNoticeStyle';
    style.textContent = ''
      + '#limanGozetmenNotice{position:fixed;inset:0;z-index:2147483600;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(15,23,42,.45);font-family:"Segoe UI",Tahoma,sans-serif}'
      + '#limanGozetmenNotice .card{width:min(520px,100%);max-height:calc(100vh - 32px);overflow:auto;background:#fff;border-radius:14px;box-shadow:0 18px 50px rgba(0,0,0,.28)}'
      + '#limanGozetmenNotice h2{margin:0;padding:14px 16px 4px;font-size:1.05rem;color:#14532d}'
      + '#limanGozetmenNotice .lead{margin:0;padding:0 16px 12px;color:#3f6212;font-size:.85rem}'
      + '#limanGozetmenNotice ul{list-style:none;margin:0;padding:0 12px 8px}'
      + '#limanGozetmenNotice li{display:flex;justify-content:space-between;gap:10px;align-items:center;padding:8px 10px;border:1px solid #dcfce7;border-radius:8px;margin-bottom:6px;background:#f0fdf4}'
      + '#limanGozetmenNotice .who{font-size:.78rem;color:#166534;font-weight:700}'
      + '#limanGozetmenNotice .who small{display:block;font-weight:600;color:#3f6212}'
      + '#limanGozetmenNotice .creds{display:flex;gap:12px;font-size:.72rem;color:#166534;font-weight:700;white-space:nowrap}'
      + '#limanGozetmenNotice code{font-size:.95rem;font-weight:800;letter-spacing:.03em;color:#14532d}'
      + '#limanGozetmenNotice button{display:block;margin:4px 12px 12px auto;border:0;background:#166534;color:#fff;border-radius:8px;padding:8px 16px;font:inherit;font-weight:800;cursor:pointer}';
    document.head.appendChild(style);
  }

  function closeNotice() {
    openIssuedAt = 0;
    var root = document.getElementById('limanGozetmenNotice');
    if (root) root.remove();
  }

  function showNotice(data) {
    if (!data || !data.noticePending || !isSelahattin()) {
      closeNotice();
      return;
    }
    if (openIssuedAt === data.issuedAt && document.getElementById('limanGozetmenNotice')) return;
    closeNotice();
    ensureStyle();
    openIssuedAt = data.issuedAt;
    var root = document.createElement('div');
    root.id = 'limanGozetmenNotice';
    var rows = (data.slots || []).filter(function (slot) { return slot.loginId && slot.password; }).map(function (slot) {
      return '<li><div class="who">' + esc(slot.label || ('Gözetmen ' + slot.n))
        + '<small>' + esc(person(slot)) + '</small></div><div class="creds"><span>ID <code>'
        + esc(slot.loginId) + '</code></span><span>Şifre <code>' + esc(slot.password) + '</code></span></div></li>';
    }).join('');
    root.innerHTML = '<div class="card" role="dialog" aria-modal="true" aria-labelledby="limanGozetmenNoticeTitle">'
      + '<h2 id="limanGozetmenNoticeTitle">Liman hesapları</h2>'
      + '<p class="lead">Liman giriş hesaplarının ID ve şifresi. İlgili kişilere ikisini birlikte iletin.</p>'
      + '<ul>' + rows + '</ul>'
      + '<button type="button" id="limanGozetmenNoticeOk">Gördüm</button>'
      + '</div>';
    document.body.appendChild(root);
    var ok = document.getElementById('limanGozetmenNoticeOk');
    if (ok) {
      ok.addEventListener('click', function () {
        ok.disabled = true;
        fetch('/api/liman/gozetmen/ack', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ issuedAt: data.issuedAt }),
        }).then(function (res) {
          if (res.ok) closeNotice();
          else ok.disabled = false;
        }).catch(function () { ok.disabled = false; });
      });
    }
  }

  async function pull() {
    if (pulling || !isSelahattin()) {
      if (!isSelahattin()) closeNotice();
      return;
    }
    pulling = true;
    try {
      var res = await fetch('/api/liman/gozetmen', { credentials: 'same-origin', cache: 'no-store' });
      if (!res.ok) return;
      var data = await res.json();
      showNotice(data);
    } catch (e) { /* sessiz */ }
    finally { pulling = false; }
  }

  function start() {
    pull();
    if (!timer) timer = setInterval(pull, POLL_MS);
  }

  window.limanGozetmenNoticePull = pull;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
  window.addEventListener('storage', function (ev) {
    if (!ev.key || ev.key === 'isLoggedIn' || ev.key === 'currentUserId') pull();
  });
})();
