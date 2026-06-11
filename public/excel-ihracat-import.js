/**
 * İhracat Excel: önizleme, çoklu sheet, seçili bloklardan import.
 * app.js içindeki parse fonksiyonlarına bağlanır (GIRIS.html'de app.js sonrası yüklenir).
 */
(function () {
  'use strict';

  function esc(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function pickIhracatSheet(wb) {
    return new Promise((resolve) => {
      const names = (wb && wb.SheetNames) || [];
      if (names.length <= 1) {
        resolve(names[0] || null);
        return;
      }
      const overlay = document.createElement('div');
      overlay.style.cssText =
        'position:fixed;inset:0;z-index:1000009;background:rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;padding:16px;';
      overlay.innerHTML = `
        <div style="background:#fff;border-radius:12px;padding:16px;max-width:400px;width:100%;">
          <div style="font-weight:800;margin-bottom:8px;">İhracat — sayfa seçin</div>
          <select id="ihrSheetPick" style="width:100%;padding:10px;border:1px solid #ddd;border-radius:8px;margin-bottom:12px;"></select>
          <div style="display:flex;gap:8px;">
            <button type="button" id="ihrSheetCancel" style="flex:1;padding:10px;border:0;background:#eee;border-radius:8px;cursor:pointer;">İptal</button>
            <button type="button" id="ihrSheetOk" style="flex:1;padding:10px;border:0;background:#111827;color:#fff;border-radius:8px;cursor:pointer;">Devam</button>
          </div>
        </div>`;
      document.body.appendChild(overlay);
      const sel = overlay.querySelector('#ihrSheetPick');
      names.forEach((n) => {
        const o = document.createElement('option');
        o.value = n;
        o.textContent = n;
        sel.appendChild(o);
      });
      overlay.querySelector('#ihrSheetCancel').onclick = () => {
        overlay.remove();
        resolve(null);
      };
      overlay.querySelector('#ihrSheetOk').onclick = () => {
        const v = sel.value;
        overlay.remove();
        resolve(v);
      };
    });
  }

  function formatIrsaliyeCollisionHelp(collisions) {
    if (!collisions || !collisions.length) return '';
    let html =
      `<div style="margin-top:10px;padding:10px 12px;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;font-size:12px;color:#7f1d1d;line-height:1.45;">` +
      `<div style="font-weight:800;color:#991b1b;margin-bottom:6px;">⚠️ İrsaliye çakışması (${collisions.length} adet)</div>` +
      `<p style="margin:0 0 8px;">Bu uyarı <b>kayıt eksikliği değil</b>. Excel’de aynı irsaliye numarası (R11…) <b>birden fazla farklı plakada</b> yazılmış. Hangi plakanın doğru olduğunu Excel’den kontrol edin.</p>` +
      `<ul style="margin:0;padding-left:18px;font-size:11px;">`;
    collisions.slice(0, 8).forEach((c) => {
      const plates = (c.plates || []).filter(Boolean).join(' · ') || '(plaka yok)';
      html += `<li style="margin-bottom:6px;"><span style="display:inline-block;background:#111210;color:#FFBF00;font-weight:700;padding:3px 8px;border-radius:4px;">${esc(c.irsaliyeNo)}</span> → ${esc(plates)}</li>`;
    });
    if (collisions.length > 8) {
      html += `<li style="color:#991b1b;">… ve ${collisions.length - 8} çakışma daha</li>`;
    }
    html +=
      `</ul><p style="margin:8px 0 0;font-size:11px;">Kayıttan sonra <b>İhracat detay</b> tablosunda yalnızca <b>İrsaliye No</b> hücresi siyah/sarı bantlı görünür. İsterseniz yine de kaydedebilirsiniz.</p></div>`;
    return html;
  }

  function showImportPreview(stats, onConfirm) {
    return new Promise((resolve) => {
      const collisions = stats.collisions || [];
      let body = `<p><b>${stats.accepted || 0}</b> kayıt içe aktarılacak.</p>`;
      if (stats.skipped) body += `<p style="color:#64748b;">Atlanan satır: <b>${stats.skipped}</b></p>`;
      if (stats.dupPlates) {
        body += `<p style="color:#b45309;margin-top:8px;">⚠️ ${stats.dupPlates} plaka birden fazla satırda geçiyor (aynı plaka, farklı sevkiyat satırları).</p>`;
      }
      body += formatIrsaliyeCollisionHelp(collisions);

      const overlay = document.createElement('div');
      overlay.style.cssText =
        'position:fixed;inset:0;z-index:1000009;background:rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;padding:16px;';
      overlay.innerHTML = `
        <div style="background:#fff;border-radius:12px;padding:16px;max-width:480px;width:100%;max-height:85vh;overflow:auto;">
          <div style="font-weight:800;margin-bottom:8px;">İhracat yükleme önizlemesi</div>
          <div>${body}</div>
          <div style="display:flex;gap:8px;margin-top:14px;">
            <button type="button" id="ihrPrevCancel" style="flex:1;padding:10px;border:0;background:#eee;border-radius:8px;cursor:pointer;">İptal</button>
            <button type="button" id="ihrPrevOk" style="flex:1;padding:10px;border:0;background:#16a34a;color:#fff;border-radius:8px;cursor:pointer;font-weight:700;">Kaydet</button>
          </div>
        </div>`;
      document.body.appendChild(overlay);
      overlay.querySelector('#ihrPrevCancel').onclick = () => {
        overlay.remove();
        resolve(false);
      };
      overlay.querySelector('#ihrPrevOk').onclick = () => {
        overlay.remove();
        resolve(true);
      };
    });
  }

  async function importSelectedBlocks() {
    const ctx = window.__ihracatImportContext;
    const blocks = window.__selectedShipmentBlocks;
    if (!ctx || !blocks || !blocks.length) {
      alert('Önce Excel dosyası seçip en az bir sevkiyat bloğu işaretleyin.');
      return;
    }
    if (typeof window.parseIhracatRowsFromWorkbook !== 'function') {
      alert('Import modülü hazır değil.');
      return;
    }
    const partial = window.parseIhracatRowsFromWorkbook(ctx.wb, ctx.sheetName, {
      onlyBlocks: blocks,
      fileName: ctx.fileName,
    });
    if (!partial || !partial.rows || !partial.rows.length) {
      alert('Seçilen bloklarda plaka satırı bulunamadı.');
      return;
    }
    const stats = partial.stats || {};
    const ok = await showImportPreview(stats, null);
    if (!ok) return;
    if (typeof window.commitIhracatImport === 'function') {
      const committed = await window.commitIhracatImport(partial.rows, partial.meta, ctx.file);
      if (!committed || !committed.ok) {
        alert((committed && committed.msg) || 'Kayıt başarısız.');
        return;
      }
      if (typeof window.showToast === 'function') {
        window.showToast(committed.msg || `✅ ${partial.rows.length} kayıt yüklendi.`);
      }
      if (typeof window.showIhracatDetailsModal === 'function') {
        window.showIhracatDetailsModal();
      }
      window.__selectedShipmentBlocks = null;
    }
  }

  window.ExcelIhracatImport = {
    pickIhracatSheet,
    showImportPreview,
    importSelectedBlocks,
  };
})();
