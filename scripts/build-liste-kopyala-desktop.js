'use strict';

/**
 * Builds a self-contained liste-kopyala HTML for desktop (file://) use.
 * Embeds excel-list-copy.js + page CSS; loads SheetJS from CDN when opened.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const jsPath = path.join(root, 'public/modules/excel-list-copy.js');
const outPath = path.join(root, 'public/liste-kopyala-desktop.html');

const CSS = `
*,*::before,*::after{box-sizing:border-box}
html,body{margin:0;padding:0}
body{font-family:Segoe UI,Tahoma,Geneva,Verdana,sans-serif}
@keyframes elc-bolt-flash{
  0%,100%{filter:drop-shadow(0 0 0 #fbbf24);transform:scale(1) rotate(0deg);color:#f59e0b}
  16%{filter:drop-shadow(0 0 10px #fde68a);transform:scale(1.25) rotate(-12deg);color:#facc15}
  28%{filter:drop-shadow(0 0 2px #f59e0b);transform:scale(0.92) rotate(6deg);color:#d97706}
  42%{filter:drop-shadow(0 0 14px #fef08a);transform:scale(1.3) rotate(-6deg);color:#fde047}
  58%{filter:drop-shadow(0 0 4px #f59e0b);transform:scale(1.05) rotate(3deg);color:#f59e0b}
}
.elc-bolt-icon{display:inline-flex;align-items:center;justify-content:center;color:#f59e0b;width:1.15rem;animation:elc-bolt-flash 1.55s ease-in-out infinite}
.elc-bolt-icon--lg{font-size:1.6rem;color:#fde047;width:auto}
body.elc-page{min-height:100vh;background:#eef2f7;color:#334155;display:flex;flex-direction:column}
.elc-top{background:linear-gradient(90deg,#0f172a,#4338ca);color:#fff;flex-shrink:0}
.elc-top__inner{width:min(100%,92rem);margin:0 auto;padding:0.9rem 1.25rem;display:flex;align-items:center;justify-content:space-between;gap:1rem}
.elc-brand{display:flex;align-items:center;gap:0.75rem;min-width:0}
.elc-brand h1{margin:0;font-size:1.2rem;font-weight:800;letter-spacing:-0.02em}
.elc-brand p{margin:0.15rem 0 0;font-size:0.78rem;color:rgba(255,255,255,.78)}
.elc-badge{border:1px solid rgba(255,255,255,.28);background:rgba(255,255,255,.1);color:#fff;border-radius:8px;padding:0.45rem 0.9rem;font-size:0.8125rem;font-weight:600}
.elc-main{width:min(100%,92rem);margin:0 auto;padding:1rem 1.25rem 1.4rem;flex:1;min-height:0;display:flex;flex-direction:column;gap:0.85rem}
.elc-panel{background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:0.9rem 1rem;flex-shrink:0}
.elc-sheet-wrap{flex:1;min-height:0;display:flex;flex-direction:column}
body.elc-page .elc-sheet{flex:1;min-height:0;display:flex;flex-direction:column;overflow:auto}
body.elc-page .elc-tree{flex:1;max-height:none}
body.elc-page .elc-status{margin:0}
body.elc-page .toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#1e293b;color:#fff;padding:10px 20px;border-radius:8px;opacity:0;pointer-events:none;z-index:200;font-size:13px}
body.elc-page .toast.show{opacity:1}
body.elc-page .toast.warn{background:#7f1d1d}
.elc-drop{border:1.5px dashed #c7d2fe;background:#eef2ff;border-radius:12px;padding:0.85rem 1rem;cursor:pointer;margin-bottom:0.85rem}
.elc-drop.is-over,.elc-drop:hover{border-color:#6366f1;background:#e0e7ff}
.elc-drop strong{display:block;color:#0f172a}
.elc-drop span{display:block;margin-top:0.2rem;font-size:0.75rem;color:#64748b}
.elc-drop__file{display:flex;flex-wrap:wrap;gap:0.5rem;align-items:center;margin-top:0.55rem}
.elc-file-btn{background:#4f46e5;color:#fff;border-radius:8px;padding:0.35rem 0.7rem;font-size:0.78rem;font-weight:700;cursor:pointer}
.elc-actions{display:flex;flex-wrap:wrap;gap:0.55rem;align-items:center;margin-bottom:0.7rem}
.elc-bolt-btn{display:inline-flex;align-items:center;gap:0.35rem;border:0;border-radius:11px;padding:0.62rem 1rem;font-weight:800;cursor:pointer;color:#fff}
.elc-bolt-btn:disabled{opacity:0.45;cursor:not-allowed}
.elc-bolt-btn--solve{background:linear-gradient(135deg,#f59e0b,#d97706)}
.elc-bolt-btn--copy{background:linear-gradient(135deg,#4f46e5,#7c3aed)}
.elc-bolt-btn .elc-bolt-icon{color:#fff}
.elc-sira{display:flex;align-items:center;gap:0.35rem;font-size:0.75rem;font-weight:700;color:#475569}
.elc-sira input{width:4.2rem;border:1px solid #cbd5e1;border-radius:8px;padding:0.35rem 0.45rem}
.elc-status{margin:0 0 0.65rem;font-size:0.8rem;color:#334155}
.elc-status.is-error{color:#991b1b;font-weight:700}
.elc-toolbar{display:flex;justify-content:space-between;align-items:center;gap:0.5rem;margin-bottom:0.45rem;font-size:0.75rem;color:#64748b}
.elc-mini-btn{border:1px solid #e2e8f0;background:#fff;border-radius:8px;padding:0.3rem 0.55rem;font-size:0.72rem;font-weight:700;cursor:pointer;margin-right:0.3rem}
.elc-sheet{border:1px solid #d1d5db;border-radius:10px;overflow:hidden;background:#fff;min-width:0}
.elc-sheet__cols,.elc-tree{min-width:118rem}
.elc-sheet__cols{display:grid;grid-template-columns:1.4rem 2.2rem 6.6rem 6.6rem 5.4rem minmax(7rem,1fr) 6.2rem minmax(8rem,1.1fr) 4.4rem 4.4rem 6rem 5.4rem 6.4rem 3.6rem 3.6rem 5.6rem 3.8rem 5.6rem;gap:0.3rem;padding:0.4rem 0.65rem 0.4rem 2.1rem;background:#f3f4f6;font-size:0.58rem;font-weight:800;color:#6b7280;text-transform:uppercase;letter-spacing:0.02em}
.elc-tree{max-height:min(52vh,520px);overflow:auto}
.elc-empty{padding:1.1rem;color:#64748b;font-size:0.82rem}
.elc-banner{display:flex;align-items:center;gap:0.5rem;width:100%;border:0;text-align:left;font-weight:800;font-size:0.78rem;padding:0.38rem 0.65rem;cursor:pointer}
.elc-banner--year{background:#e5e7eb;color:#111827;cursor:default}
.elc-banner--week{background:#f3f4f6;color:#1f2937;padding-left:1.4rem}
.elc-banner--week small{margin-left:auto;color:#6b7280;font-weight:700}
.elc-week__rows{display:flex;flex-direction:column}
.elc-row{display:grid;grid-template-columns:1.4rem 2.2rem 6.6rem 6.6rem 5.4rem minmax(7rem,1fr) 6.2rem minmax(8rem,1.1fr) 4.4rem 4.4rem 6rem 5.4rem 6.4rem 3.6rem 3.6rem 5.6rem 3.8rem 5.6rem;gap:0.3rem;align-items:center;width:100%;border:0;border-top:1px solid #f3f4f6;background:#fff;text-align:left;padding:0.38rem 0.65rem 0.38rem 1.85rem;font-size:0.76rem;color:#111827;cursor:pointer}
.elc-row:hover{background:#eff6ff}
.elc-row.is-selected{background:#dbeafe}
.elc-row__sira{color:#64748b;font-variant-numeric:tabular-nums}
.elc-cell--var{display:inline-block;background:#fdecc8;color:#7c4a03;border-radius:4px;padding:0.08rem 0.34rem;font-weight:700}
.elc-check{width:0.9rem;height:0.9rem;border:1.5px solid #94a3b8;border-radius:3px;background:#fff;flex:0 0 auto}
.elc-check.is-on{background:#2563eb;border-color:#2563eb;box-shadow:inset 0 0 0 2px #fff}
.elc-check.is-mixed{background:#93c5fd;border-color:#2563eb}
@media (max-width:720px){.elc-brand p{display:none}}
`.trim();

function build() {
  const logic = fs.readFileSync(jsPath, 'utf8');
  const html = `<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Liste kopyala — Masaüstü</title>
  <style>
${CSS}
  </style>
</head>
<body class="elc-page">
  <header class="elc-top">
    <div class="elc-top__inner">
      <div class="elc-brand">
        <span class="elc-bolt-icon elc-bolt-icon--lg" aria-hidden="true">⚡</span>
        <div>
          <h1>Liste kopyala</h1>
          <p>Masaüstü sürümü — F358 seç, hafta seç, panoya kopyala</p>
        </div>
      </div>
      <span class="elc-badge">PC / dosya</span>
    </div>
  </header>

  <main id="elcPage" class="elc-main">
    <section class="elc-panel">
      <div id="elcDrop" class="elc-drop" role="button" tabindex="0">
        <strong>F358 kaynağını bırakın veya seçin</strong>
        <span>Excel’deki gibi yıl / hafta grupları açılır. Komple kopyalanmaz.</span>
        <div class="elc-drop__file">
          <label class="elc-file-btn" for="elcFile">Dosya seç</label>
          <input id="elcFile" type="file" accept=".xlsx,.xls,.xlsm,.xlsb" hidden>
          <span id="elcFileName">Dosya seçilmedi</span>
        </div>
      </div>
      <div class="elc-actions">
        <button type="button" id="elcSolveBtn" class="elc-bolt-btn elc-bolt-btn--solve">
          <span class="elc-bolt-icon" aria-hidden="true">⚡</span> Çöz
        </button>
        <button type="button" id="elcCopyBtn" class="elc-bolt-btn elc-bolt-btn--copy" disabled>
          <span class="elc-bolt-icon" aria-hidden="true">⚡</span> Kopyala
        </button>
        <label class="elc-sira" for="elcStartSira">Başlangıç sıra
          <input id="elcStartSira" type="number" min="1" step="1" value="1">
        </label>
        <p id="elcStatus" class="elc-status">HAFTA satırına tıklayınca o haftanın sevki seçilir.</p>
      </div>
    </section>

    <section class="elc-sheet-wrap">
      <div class="elc-toolbar">
        <div>
          <button type="button" class="elc-mini-btn" id="elcSelectAllBtn">Tümünü seç</button>
          <button type="button" class="elc-mini-btn" id="elcClearSelBtn">Seçimi temizle</button>
        </div>
        <span id="elcCount">0 satır</span>
      </div>
      <div class="elc-sheet" id="elcSheet">
        <div class="elc-sheet__cols">
          <span></span>
          <span>SIRA</span>
          <span>KUTAHYA_CIKIS_TARIH</span>
          <span>LIMAN_DOL_TARIH</span>
          <span>MÜŞTERİ</span>
          <span>ÜRÜN</span>
          <span>SEVKPLANMIK</span>
          <span>PAKET</span>
          <span>BB_ADET</span>
          <span>CV_ADET</span>
          <span>PALET_TR</span>
          <span>PALET_SAYISI</span>
          <span>PALET_URUN_SAYISI</span>
          <span>PRES</span>
          <span>STREC</span>
          <span>PALET_ORTUSU</span>
          <span>SERIT</span>
          <span>TEDARİKÇİ</span>
        </div>
        <div id="elcTree" class="elc-tree"></div>
      </div>
    </section>
  </main>

  <div class="toast" id="elcToast"></div>

  <script>
  window.ensureXlsxLoaded = function () {
    if (window.XLSX && window.XLSX.read) return Promise.resolve(window.XLSX);
    if (window.__elcXlsxPromise) return window.__elcXlsxPromise;
    window.__elcXlsxPromise = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/xlsx/dist/xlsx.full.min.js';
      s.onload = function () {
        if (window.XLSX && window.XLSX.read) resolve(window.XLSX);
        else reject(new Error('Excel okuyucu yüklenemedi.'));
      };
      s.onerror = function () {
        var s2 = document.createElement('script');
        s2.src = 'https://unpkg.com/xlsx/dist/xlsx.full.min.js';
        s2.onload = function () {
          if (window.XLSX && window.XLSX.read) resolve(window.XLSX);
          else reject(new Error('Excel okuyucu yüklenemedi.'));
        };
        s2.onerror = function () { reject(new Error('Excel okuyucu yüklenemedi (internet gerekli).')); };
        document.head.appendChild(s2);
      };
      document.head.appendChild(s);
    });
    return window.__elcXlsxPromise;
  };
  </script>
  <script>
${logic}
  </script>
  <script>
  (function () {
    function toast(msg, isErr) {
      var el = document.getElementById('elcToast');
      if (!el) return;
      el.textContent = msg || '';
      el.className = 'toast show' + (isErr ? ' warn' : '');
      clearTimeout(el._t);
      el._t = setTimeout(function () { el.classList.remove('show'); }, 3200);
    }
    function boot() {
      if (window.ExcelListCopy && typeof window.ExcelListCopy.bindAppUi === 'function') {
        window.ExcelListCopy.bindAppUi({ toast: toast });
      }
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
  })();
  </script>
</body>
</html>
`;

  fs.writeFileSync(outPath, html, 'utf8');
  console.log('Wrote', path.relative(root, outPath), '(' + html.length + ' bytes)');
}

build();
