// app-shipment-ui.js — sevkiyat seçim + yedekleme
// Otomatik bölüm — scripts/split-large-files.js

/* =========================================================================
   ✅ Sevkiyat BAŞLIK OKUMA + SEÇİM TABLOSU (Sadece başlıklar)
   - Kullanıcı sevkiyatları tekli/çoklu seçer
   - Bu sürümde import YAPMAZ (sadece seçim ekranı gösterir)
   ========================================================================= */

// Alias for null-safe string conversion (use escapeHtml for HTML context)
function _safeStr(x){ return (x==null)?'':String(x); }
function _rowToText(row){
  if (!row || !Array.isArray(row)) return '';
  const parts = row.map(v => _safeStr(v).replace(/\s+/g,' ').trim()).filter(Boolean);
  return parts.join(' ').replace(/\s+/g,' ').trim();
}

function _findFirst(regex, text){
  const m = (text || '').match(regex);
  return m ? (m[1] || m[0] || '').trim() : '';
}

function _extractFirmaKod(headerText){
  // YD138(M) -> YD138
  return _findFirst(/\b(YD\d{2,4})\b/i, headerText) || '';
}

// ✅ Firma/YD anahtarı: kullanıcı "YD28(G) ..." yazsa bile "YD28" üretir.
// Autofill ve eşleştirme için her yerde aynı anahtar kullanılmalı.
function _firmaKey(val){
  const s = String(val || '');
  return (_extractFirmaKod(s) || s.trim());
}

function extractFirmaKodWithPO(raw) {
  const text = String(raw || '').replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim();
  
  // ✅ YD kodunu al ve (M) veya başka suffix'leri temizle
  // YD113(M) → YD113, YD05(MAVİ) → YD05 vb.
  const ydMatch = text.match(/\b(YD\d{1,4})\b/i);
  let ydKod = ydMatch ? ydMatch[1].toUpperCase() : '';
  
  if (!ydKod) return String(raw || '').trim();

  // ✅ PO veya PFK ile birlikte ürün bilgisini yakala
  // Formatlar: PFK 25-32, PO 21-33, PO:C2603-D1000, PO NO: 21-33, PFK NO:52-63 vb.
  // Regex: P(O|FK) + isteğe bağlı boşluk/NO + boşluk + kod (alphanumeric, dash, colon)
  const poMatch = text.match(/\b(P(?:O|FK)\s*(?:NO:?)?\s*[\w\-:]+)/i);
  let poKod = '';
  
  if (poMatch) {
    // Boşlukları normalize et (PO NO: 21-33 → PO NO: 21-33) ve büyük yapla
    poKod = poMatch[1].replace(/\s+/g, ' ').toUpperCase().trim();
  }

  console.log('extractFirmaKodWithPO called with:', raw, '-> ydKod:', ydKod, 'poKod:', poKod, 'result:', poKod ? (ydKod + ' / ' + poKod) : ydKod);

  return poKod ? (ydKod + ' / ' + poKod) : ydKod;
}

function _extractMalzeme(headerText){
  // HP 0,074-0,30 / HP 0.074-0.30
  const m = headerText.match(/\bHP\s*([0-9][0-9\.,]*\s*-\s*[0-9][0-9\.,]*)\b/i);
  if (!m) return '';
  const rng = String(m[1] || '').replace(/\s+/g,'').replace(/\./g,','); // TR format
  return `HP ${rng}`;
}

function _extractSevkYeri(headerText){
  return ''; // otomatik sevk yeri okuma kapali (manuel opsiyonel)
}


function _extractAmbalaj(headerText){
  return ''; // otomatik ambalaj okuma kapali
}


function _extractTotal(headerText, key){
  const t = (headerText || '').replace(/\s+/g,' ').trim().toUpperCase();
  if (key === 'BBT') {
    const m = t.match(/\b([0-9]{1,6})\s*BBT\b/);
    return m ? m[1] : '';
  }
  if (key === 'PALET') {
    const m = t.match(/\b([0-9]{1,6})\s*PALET\b/);
    return m ? m[1] : '';
  }
  if (key === 'ÇUVAL') {
    const m = t.match(/\b([0-9][0-9\.\,]{0,8})\s*ÇUVAL\b/);
    return m ? m[1].replace(/\./g,'').replace(/,/g,'') : '';
  }
  return '';
}

// Grid'den sevkiyat başlıklarını bul (başlık satırı + aralık)
function parseShipmentBlocksFromGrid(grid){
  const headers = [];
  for (let r=0; r<grid.length; r++){
    const rowText = _rowToText(grid[r]);
    if (!rowText) continue;

    // Başlık heuristiği: YDxxx + LOT NO olan satır
    const hasLot = /LOT\s*NO/i.test(rowText);
    const hasFirma = /\bYD\d{2,4}\b/i.test(rowText);
    if (hasLot && hasFirma) {
      headers.push({ r, headerText: rowText });
    }
  }

  // blok aralıklarını belirle
  const blocks = headers.map((h, i) => {
    const startRow = h.r;
    const endRow = (i < headers.length-1) ? (headers[i+1].r - 1) : (grid.length - 1);
    const headerText = h.headerText;

    const blk = {
      id: `B${startRow}_${i+1}`,
      index: i+1,
      startRow,
      endRow,
      headerText,
      firma: _extractFirmaKod(headerText),
      malzeme: _extractMalzeme(headerText),
      sevkYeri: _extractSevkYeri(headerText),
      ambalaj: _extractAmbalaj(headerText),
      totalBBT: _extractTotal(headerText,'BBT'),
      totalPalet: _extractTotal(headerText,'PALET')
    };
    // 🔒 Excel başlık/blok parsing sırasında EŞLEŞTİRME'den otomatik doldurma kapalı.
    // Excel ne getiriyorsa o kullanılacak; local eşleştirme/önbellek karışmasın.

    return blk;
  });

  return blocks;
}

function closeShipmentSelectUI(){
  const el = document.getElementById('shipmentSelectOverlay');
  if (el) el.remove();
}

function showShipmentSelectUI(blocks, fileName){
  closeShipmentSelectUI();

  const overlay = document.createElement('div');
  overlay.id = 'shipmentSelectOverlay';
  overlay.style.cssText = `
    position: fixed; inset: 0; z-index: 999999;
    background: rgba(0,0,0,.55);
    display: flex; align-items: flex-start; justify-content: center;
    padding: 24px;
  `;

  const card = document.createElement('div');
  card.style.cssText = `
    width: min(1100px, 98vw);
    max-height: 92vh;
    overflow: auto;
    background: #101217;
    color: #fff;
    border: 1px solid rgba(255,255,255,.15);
    border-radius: 16px;
    box-shadow: 0 20px 60px rgba(0,0,0,.5);
    padding: 18px;
  `;

  const title = document.createElement('div');
  title.style.cssText = `display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom: 12px;`;
  // ✅ SECURITY: Use escapeHtml for user input (XSS protection)
  title.innerHTML = `
    <div>
      <div style="font-size:18px; font-weight:800;">📌 Excel Sevkiyat Seçimi</div>
      <div style="opacity:.85; margin-top:4px; font-size:13px;">
        Dosya: <b>${escapeHtml(fileName||'')}</b> • Bulunan sevkiyat: <b>${blocks.length}</b>
      </div>
      <div style="opacity:.85; margin-top:4px; font-size:12px;">
        Bu ekranda sadece <b>başlık bilgileri</b> gösterilir. (Henüz import yapılmaz.)
      </div>
    </div>
    <button id="shipmentSelectCloseBtn" style="background:#2b2f3a;color:#fff;border:1px solid rgba(255,255,255,.18);padding:10px 14px;border-radius:12px;cursor:pointer;">Kapat</button>
  `;

  const tableWrap = document.createElement('div');
  tableWrap.style.cssText = `margin-top: 10px; border:1px solid rgba(255,255,255,.12); border-radius:12px; overflow:hidden;`;
  const rows = blocks.map((b) => {
    // ✅ SECURITY: Use escapeHtml for user input in HTML context (XSS protection)
    const headerShort = escapeHtml(_safeStr(b.headerText)).slice(0,160) + (escapeHtml(_safeStr(b.headerText)).length>160 ? '…' : '');
    return `
      <tr style="border-bottom:1px solid rgba(255,255,255,.08);">
        <td style="padding:10px; text-align:center;"><input type="checkbox" class="shipPick" data-id="${escapeAttr(b.id)}" /></td>
        <td style="padding:10px; max-width:260px; white-space:normal; overflow-wrap:break-word; word-break:break-word; font-size:13px;"><b>${escapeHtml(b.firma || '-')}</b></td>
        <td style="padding:10px;">${escapeHtml(b.malzeme || '-')}</td>
        <td style="padding:10px; white-space:nowrap;">${escapeHtml(b.sevkYeri || '-')}</td>
        <td style="padding:10px;">${escapeHtml(b.ambalaj || '-')}</td>
        <td style="padding:10px; text-align:center;">${escapeHtml(b.totalBBT || '-')}</td>
        <td style="padding:10px; text-align:center;">${escapeHtml(b.totalPalet || '-')}</td>
        <td style="padding:10px; font-size:12px; opacity:.85;">${headerShort}</td>
      </tr>
    `;
  }).join('');

  tableWrap.innerHTML = `
    <table style="width:100%; border-collapse:collapse;">
      <thead style="background:rgba(255,255,255,.06);">
        <tr>
          <th style="padding:10px; width:60px;">Seç</th>
          <th style="padding:10px; width:90px;">Firma</th>
          <th style="padding:10px; width:160px;">Malzeme</th>
          <th style="padding:10px; width:120px;">Sevk Yeri</th>
          <th style="padding:10px;">Ambalaj</th>
          <th style="padding:10px; width:70px;">BBT</th>
          <th style="padding:10px; width:70px;">Palet</th>
          <th style="padding:10px; width:260px;">Başlık (kısa)</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;

  const actions = document.createElement('div');
  actions.style.cssText = `display:flex; gap:10px; align-items:center; justify-content:flex-end; margin-top: 14px; flex-wrap:wrap;`;

  actions.innerHTML = `
    <button id="shipPickAll" style="background:#1f6feb;color:#fff;border:none;padding:10px 14px;border-radius:12px;cursor:pointer;">Hepsini Seç</button>
    <button id="shipClearAll" style="background:#2b2f3a;color:#fff;border:1px solid rgba(255,255,255,.18);padding:10px 14px;border-radius:12px;cursor:pointer;">Temizle</button>
    <button id="shipConfirm" style="background:#7c3aed;color:#fff;border:none;padding:10px 14px;border-radius:12px;cursor:pointer;">Seçimleri Onayla</button>
  `;

  card.appendChild(title);
  card.appendChild(tableWrap);
  card.appendChild(actions);
  overlay.appendChild(card);
  document.body.appendChild(overlay);

  // ✅ Aday listelerini doldur (sevk yeri / ambalaj)
  try {
    const ambC = (candidates && Array.isArray(candidates.ambalaj)) ? candidates.ambalaj : [];
    const sevC = (candidates && Array.isArray(candidates.sevkYeri)) ? candidates.sevkYeri : [];

    // ✅ Son kullanılan (YD/Firma) değerlerini aday listesine EKLE,
    // ama mevcut header'dan gelen adaylar varsa otomatik override ETME.
    const origAmbLen = ambC.length;
    const origSevLen = sevC.length;
    try {
      const key = normalizeYdKey(ydKey || chosen?.ydKey || chosen?.firma || '');
      if (key) {
        if (!window.__quickDefaultsByKey) window.__quickDefaultsByKey = {};
        const d = window.__quickDefaultsByKey[key];
        if (d) {
          const da = String(d.ambalaj || '').trim();
          const ds = String(d.sevkYeri || '').trim();
          if (ds && !sevC.map(x=>String(x||'').toUpperCase()).includes(ds.toUpperCase())) sevC.unshift(ds);
          if (da && !ambC.map(x=>String(x||'').toUpperCase()).includes(da.toUpperCase())) ambC.unshift(da);

          // Eğer header'dan HİÇ aday yoksa (yani sadece kullanıcı hafızası var),
          // inputlar boşken otomatik doldur.
          if (origSevLen === 0) {
            const sevInp = card.querySelector('#xr_sevkYeri');
            if (sevInp && !String(sevInp.value||'').trim() && ds) sevInp.value = ds;
          }
          if (origAmbLen === 0) {
            const ambInp = card.querySelector('#xr_ambalaj');
            if (ambInp && !String(ambInp.value||'').trim() && da) ambInp.value = da;
          }
        }
      }
    } catch(e) {}


    const selAmb = card.querySelector('#xr_ambalajCand');
    const selSev = card.querySelector('#xr_sevkYeriCand');

    const addOpts = (sel, arr) => {
      if (!sel) return;
      for (const v of (arr || [])) {
        const opt = document.createElement('option');
        opt.value = String(v || '');
        opt.textContent = String(v || '');
        sel.appendChild(opt);
      }
    };

    addOpts(selSev, sevC);
    addOpts(selAmb, ambC);

    // seçilince inputu doldur
    if (selSev) selSev.addEventListener('change', () => {
      const v = selSev.value || '';
      if (v) {
        const inp = card.querySelector('#xr_sevkYeri');
        if (inp) inp.value = v;
      }
    });
    if (selAmb) selAmb.addEventListener('change', () => {
      const v = selAmb.value || '';
      if (v) {
        const inp = card.querySelector('#xr_ambalaj');
        if (inp) inp.value = v;
      }
    });
  } catch(e){}

  const close = () => closeShipmentSelectUI();
  document.getElementById('shipmentSelectCloseBtn')?.addEventListener('click', close);

  document.getElementById('shipPickAll')?.addEventListener('click', () => {
    overlay.querySelectorAll('input.shipPick').forEach(ch => ch.checked = true);
  });
  document.getElementById('shipClearAll')?.addEventListener('click', () => {
    overlay.querySelectorAll('input.shipPick').forEach(ch => ch.checked = false);
  });

  document.getElementById('shipConfirm')?.addEventListener('click', () => {
    const picks = Array.from(overlay.querySelectorAll('input.shipPick'))
      .filter(ch => ch.checked)
      .map(ch => ch.getAttribute('data-id'));

    if (!picks.length) { alert('Önce en az 1 sevkiyat seçmelisin.'); return; }

    window.__selectedShipmentBlocks = blocks.filter(b => picks.includes(b.id));
    close();
    if (window.ExcelIhracatImport && typeof window.ExcelIhracatImport.importSelectedBlocks === 'function') {
      window.ExcelIhracatImport.importSelectedBlocks();
    } else {
      showToast(`✅ ${window.__selectedShipmentBlocks.length} sevkiyat bloğu seçildi.`);
    }
  });
}

// Excel oku -> blokları çıkar -> seçim ekranını göster (import yapmaz)
async function importExcelHeadersOnly_ShowSelection(file){
  if (!file) return { ok:false, msg:'Dosya seçilmedi.' };
  try {
    if (typeof window.ensureXlsxLoaded === 'function') await window.ensureXlsxLoaded();
  } catch (e) {
    return { ok:false, msg:'XLSX kütüphanesi yüklenemedi. İnternet bağlantınızı kontrol edin.' };
  }
  if (typeof XLSX === 'undefined') return { ok:false, msg:'XLSX kütüphanesi yüklenemedi. (xlsx.full.min.js)' };

  const data = await file.arrayBuffer();
  const wb = XLSX.read(data, { type: 'array' });
  let sheetName = wb.SheetNames && wb.SheetNames[0];
  if (window.ExcelIhracatImport && wb.SheetNames && wb.SheetNames.length > 1) {
    const picked = await window.ExcelIhracatImport.pickIhracatSheet(wb);
    if (!picked) return { ok: false, msg: 'Sayfa seçilmedi.', blocks: [] };
    sheetName = picked;
  }
  const ws = wb.Sheets[sheetName];
  // blankrows: true — parseIhracatRowsFromWorkbook ile aynı (satır indeksleri seçim = import)
  const grid = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, blankrows: true });

  const blocks = parseShipmentBlocksFromGrid(grid);

  window.__ihracatImportContext = { wb, sheetName, fileName: file.name, grid, ws, file };

  if (!blocks.length) {
    showShipmentSelectUI([], file.name);
    return { ok: false, msg: 'Başlık bulunamadı (LOT NO / YDxxx).', blocks: [] };
  }

  showShipmentSelectUI(blocks, file.name);
  return { ok: true, msg: `✅ Başlıklar bulundu: ${blocks.length} sevkiyat`, blocks };
}


// Takip formu açılınca plaka ile excel satırını uygula

function _shipmentSiraSortKey(h) {
  const raw = String(h?.sira ?? '').trim();
  const n = parseInt(raw.replace(/[^\d]/g, ''), 10);
  return Number.isFinite(n) ? n : 999999;
}

function _sortShipmentsByExcelSira(hits) {
  return (Array.isArray(hits) ? hits.slice() : []).sort((a, b) => {
    const da = _shipmentSiraSortKey(a);
    const db = _shipmentSiraSortKey(b);
    if (da !== db) return da - db;
    return String(a?.id || '').localeCompare(String(b?.id || ''), 'tr');
  });
}

/** Aynı plakaya ait birden fazla Excel sevkiyat kaydı — kurumsal seçim penceresi */
function openShipmentPickForSamePlate(plate, hits, onPick, onDismiss) {
  try {
    const overlayId = 'shipmentPickOverlay';
    const old = document.getElementById(overlayId);
    if (old) old.remove();

    const overlay = document.createElement('div');
    overlay.id = overlayId;
    overlay.style.cssText = [
      'position:fixed', 'inset:0', 'z-index:1000006', 'background:rgba(0,0,0,.25)',
      'display:flex', 'align-items:flex-start', 'justify-content:center', 'padding:16px'
    ].join(';') + ';';

    const card = document.createElement('div');
    card.style.cssText = [
      'width:min(680px, 96vw)', 'margin-top:8vh', 'background:#fff', 'border:1px solid #e5e7eb',
      'border-radius:12px', 'box-shadow:0 10px 30px rgba(0,0,0,.22)', 'overflow:hidden'
    ].join(';') + ';';

    const header = document.createElement('div');
    header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:12px 14px;border-bottom:1px solid #e5e7eb;background:#f8fafc;';
    header.innerHTML = `
      <div style="min-width:0;">
        <strong style="font-size:14px;color:#0f172a;">${escapeHtml(plate)} — sevkiyat seçimi</strong>
        <div style="font-size:12px;color:#64748b;margin-top:4px;">Bu plakaya ait <b>${(hits || []).length}</b> kayıt bulundu. Doğru sevkiyatı seçin.</div>
      </div>`;

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.textContent = '✕';
    closeBtn.title = 'İlk kaydı kullan';
    closeBtn.style.cssText = 'border:none;background:transparent;font-size:16px;cursor:pointer;opacity:.75;padding:4px 8px;';
    closeBtn.onmouseenter = () => { closeBtn.style.opacity = '1'; };
    closeBtn.onmouseleave = () => { closeBtn.style.opacity = '.75'; };
    header.appendChild(closeBtn);

    const list = document.createElement('div');
    list.style.cssText = 'max-height:55vh;overflow:auto;';

    const sortedHits = _sortShipmentsByExcelSira(hits);
    const rows = sortedHits.map((h, i) => {
      const sira = String(h.sira ?? '').trim() || '-';
      const bbt = h.bbt != null && String(h.bbt).trim() !== '' ? String(h.bbt).trim() : '-';
      const ton = h.tonajKg != null && String(h.tonajKg).trim() !== '' ? String(h.tonajKg).trim() : '-';
      const fir = String(h.firma || h.ydKey || '').trim() || '-';
      const mal = String(h.malzeme || '').trim() || '-';
      const dosya = String(h.fileName || h.id || '').trim();
      const dosyaHtml = dosya ? `<span style="color:#94a3b8;font-size:11px;">${escapeHtml(dosya)}</span>` : '';
      return `
        <button type="button" data-idx="${i}"
          style="width:100%;text-align:left;padding:12px 14px;border:none;background:transparent;cursor:pointer;border-bottom:1px solid #f3f4f6;">
          <div style="display:flex;justify-content:space-between;gap:12px;align-items:center;">
            <div style="display:flex;flex-direction:column;gap:4px;min-width:0;flex:1;">
              <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
                <span style="background:#f1f5f9;color:#475569;border-radius:6px;padding:2px 8px;font-size:11px;font-weight:800;">Sıra: ${escapeHtml(sira)}</span>
                <span style="background:#e0e7ff;color:#3730a3;border-radius:6px;padding:2px 8px;font-size:11px;font-weight:700;">BBT: ${escapeHtml(bbt)}</span>
                <span style="background:#ecfdf5;color:#166534;border-radius:6px;padding:2px 8px;font-size:11px;font-weight:700;">Tonaj: ${escapeHtml(ton)} kg</span>
              </div>
              <span style="color:#334155;font-size:12px;">Firma: ${escapeHtml(fir)}</span>
              <span style="color:#64748b;font-size:12px;">Malzeme: ${escapeHtml(mal)}</span>
              ${dosyaHtml}
            </div>
            <span style="flex-shrink:0;background:#4f46e5;color:#fff;border-radius:10px;padding:8px 14px;font-weight:800;font-size:12px;">SEÇ</span>
          </div>
        </button>`;
    }).join('');

    list.innerHTML = rows || `<div style="padding:12px;color:#6b7280;">Kayıt bulunamadı</div>`;

    const footer = document.createElement('div');
    footer.style.cssText = 'padding:10px 14px;border-top:1px solid #e5e7eb;background:#f8fafc;font-size:11px;color:#64748b;';
    footer.textContent = 'Kapatırsanız ilk kayıt kullanılır.';

    const finish = (chosen, dismissed) => {
      overlay.remove();
      if (dismissed) {
        try { onDismiss && onDismiss(); } catch (_) {}
      } else {
        try { onPick && onPick(chosen); } catch (_) {}
      }
    };

    closeBtn.onclick = () => finish(sortedHits[0], true);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) finish(sortedHits[0], true);
    });

    list.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-idx]');
      if (!btn) return;
      const idx = parseInt(btn.getAttribute('data-idx'), 10);
      const chosen = sortedHits[idx];
      if (chosen) finish(chosen, false);
    });

    card.appendChild(header);
    card.appendChild(list);
    card.appendChild(footer);
    overlay.appendChild(card);
    document.body.appendChild(overlay);
  } catch (e) {
    try { onPick && onPick((hits || [])[0] || null); } catch (_) {}
  }
}

function pickShipmentFromHits(plate, hits) {
  return new Promise((resolve) => {
    const list = Array.isArray(hits) ? hits : [];
    if (!list.length) { resolve(null); return; }
    if (list.length === 1) { resolve(list[0]); return; }
    openShipmentPickForSamePlate(
      plate,
      list,
      (chosen) => resolve(chosen || list[0]),
      () => resolve(list[0])
    );
  });
}

function sanitizeYuklemeNotuLines(lines) {
  const out = [];
  const seen = new Set();
  for (const line of lines || []) {
    const s = String(line || '').trim();
    if (!s) continue;
    if (/^\d{1,2}$/.test(s)) continue;
    const key = s.replace(/\s+/g, ' ').toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

/** Seçilen Excel satırının tonaj, irsaliye ve blok uyarı notunu takip formuna yazar */
function applyShipmentTonajAndIrsaliye(chosen) {
  if (!chosen) return;
  try {
    const tonajEl = document.getElementById('tonaj');
    const t = chosen.tonajKg != null ? String(chosen.tonajKg).trim() : '';
    if (tonajEl && t) tonajEl.value = t;

    const notuEl = document.getElementById('yuklemeNotu');
    if (!notuEl) return;

    const parts = [];
    const irs = getShipmentIrsaliyeNo(chosen);
    if (irs) parts.push('İrsaliye No: ' + irs);

    const blockNote = getIhracatBlockFooterNote(chosen);
    if (blockNote) {
      blockNote.split(/\r?\n/).forEach((ln) => {
        const s = String(ln || '').trim();
        if (s) parts.push(s);
      });
    }

    const rowNote = String(chosen.yuklemeNotu || '').trim();
    if (
      rowNote &&
      rowNote !== blockNote &&
      !rowNote.includes(blockNote) &&
      !(blockNote && blockNote.includes(rowNote))
    ) {
      const irsPrefix = irs ? 'İrsaliye No: ' + irs : '';
      rowNote.split(/\r?\n/).forEach((ln) => {
        const s = String(ln || '').trim();
        if (!s) return;
        if (irsPrefix && s === irsPrefix) return;
        parts.push(s);
      });
    }

    const merged = sanitizeYuklemeNotuLines(parts);
    if (!merged.length) return;
    notuEl.value = merged.join('\n');
  } catch (e) {}
}

// ✅ Araç varsayılanlarını takip formuna uygula (Excel'e / kullanıcı girdisine dokunmaz)
// - Sadece ilgili alan BOŞSA doldurur.
// - Excel import varsa applyShipmentToTakipForm zaten doldurur; burada tekrar ezmeyiz.
function applyVehicleDefaultsToTakipForm(vehicle) {
  try {
    if (!vehicle) return;

    const firmaKodu = document.getElementById('firmaKodu');
    const firmaSelect = document.getElementById('firmaSelect');
    const malzeme = document.getElementById('malzeme');
    const malzemeSelect = document.getElementById('malzemeSelect');
    const sevkYeri = document.getElementById('sevkYeri');
    const yuklemeNotu = document.getElementById('yuklemeNotu');

    const df = String(vehicle.defaultFirma || '').trim();
    const dm = String(vehicle.defaultMalzeme || '').trim();
    const ds = String(vehicle.defaultSevkYeri || '').trim();
    const dn = String(vehicle.defaultYuklemeNotu || '').trim();
    const dbbt = String(vehicle.defaultBbtSayisi || '').trim();

    console.log('🔍 applyVehicleDefaults - vehicle:', vehicle);
    console.log('🔍 Değerler:', { df, dm, ds, dn, dbbt });

    // Firma - INPUT (önce input'u doldur)
    if (firmaKodu && !String(firmaKodu.value || '').trim() && df) {
      firmaKodu.value = df;
      console.log('✅ Firma input dolduruldu:', df);
    }
    
    // Firma - SELECT
    if (firmaSelect && !String(firmaSelect.value || '').trim() && df) {
      try {
        firmaSelect.value = df;
        console.log('✅ Firma select set edildi:', df, '-> sonuç:', firmaSelect.value);
      } catch (e) {
        console.error('❌ Firma select hatası:', e);
      }
    }

    // Malzeme - INPUT (önce input'u doldur)
    if (malzeme && !String(malzeme.value || '').trim() && dm) {
      malzeme.value = dm;
      console.log('✅ Malzeme input dolduruldu:', dm);
    }
    
    // Malzeme - SELECT
    if (malzemeSelect && !String(malzemeSelect.value || '').trim() && dm) {
      try {
        const opt = Array.from(malzemeSelect.options || []).find(o => String(o.value||'').trim() === dm);
        if (opt) {
          malzemeSelect.value = dm;
          console.log('✅ Malzeme select dolduruldu:', dm);
        } else {
          console.warn('⚠️ Malzeme dropdown\'da bulunamadı:', dm);
        }
      } catch (e) {
        console.error('❌ Malzeme select hatası:', e);
      }
    }

    // Sevk yeri
    if (sevkYeri && !String(sevkYeri.value || '').trim() && ds) {
      sevkYeri.value = ds;
      console.log('✅ Sevk yeri dolduruldu:', ds);
    }

    // Yükleme notu
    if (yuklemeNotu && !String(yuklemeNotu.value || '').trim() && dn) {
      yuklemeNotu.value = dn;
      console.log('✅ Yükleme notu dolduruldu:', dn);
    }
  } catch(e) {
    console.error('applyVehicleDefaultsToTakipForm hata:', e);
  }
}

async function applyShipmentToTakipForm(vehicle, opts) {
  opts = opts || {};
  try {
    const plateNeedle = normPlate(vehicle?.cekiciPlaka || '');
    if (!plateNeedle) return;

    let chosen;
    if (opts.prefilledShipment) {
      chosen = { ...opts.prefilledShipment, plaka: plateNeedle };
    } else {
      // ✅ Hız: plaka->kayıt index (DailyStore) varsa onu kullan
      let hits = [];
      try {
        if (window.DailyStore && typeof DailyStore.findByPlate === 'function') {
          hits = DailyStore.findByPlate(plateNeedle) || [];
        } else {
          const list = loadDailyShipments();
          if (!list.length) return;
          hits = list.filter((x) => x.plaka === plateNeedle);
        }
      } catch (e) {
        const list = loadDailyShipments();
        if (!list.length) return;
        hits = list.filter((x) => x.plaka === plateNeedle);
      }
      if (!hits.length) return;

      chosen = hits[0];
      if (hits.length > 1) {
        const picked = await pickShipmentFromHits(plateNeedle, hits);
        if (picked) chosen = picked;
      }
    }

    // ✅ Firma bazlı override (örn: Liman/Sevk Yeri düzeltmesi)
    chosen = applyFirmaOverridesToShipment(chosen);

    // ✅ Seçilen kaydın tonajı (çoklu sevkiyatta 2. kayıt için doğru değer)
    applyShipmentTonajAndIrsaliye(chosen);
    try {
      window.__activeExcelShipment = chosen;
      window.__lastChosenShipment = chosen;
    } catch (e) {}

    try {
      if (window.piyasa && typeof window.piyasa.suggestForContext === 'function') {
        const sug = window.piyasa.suggestForContext({
          plate: plateNeedle,
          firma: chosen.firma || chosen.ydKey,
          malzeme: chosen.malzeme,
          sevkYeri: chosen.sevkYeri,
        });
        if (sug.length && typeof window.piyasa.showSuggestionBar === 'function') {
          window.piyasa.showSuggestionBar(sug, { plate: plateNeedle });
        }
      }
    } catch (e) {}

    _applyExcelShipmentFieldsToTakipForm(chosen);

    const sevkFilled = String(chosen.sevkYeri || _defaultSevkForShipment(chosen)).trim();
    const ambFilled =
      String(chosen.ambalaj || chosen.ambalajBilgisi || '').trim() ||
      String(chosen.bbt || '').trim() ||
      String(chosen.cuval || '').trim() ||
      String(chosen.palet || '').trim();

    if (opts.skipExcelReview || (chosen._ihracatEdited && sevkFilled && ambFilled)) {
      return;
    }

    openExcelReviewUI({
      plate: plateNeedle,
      chosen,
      ydKey: chosen?.ydKey || chosen?.firma || '',
      candidates: {
        ambalaj: getAmbalajCandidates(chosen?.headerText || ''),
        sevkYeri: getLimanCandidates(chosen?.headerText || '')
      },
      onApply: (fixed) => {
        const firmaKodu = document.getElementById('firmaKodu');
        const malzeme = document.getElementById('malzeme');
        const malzemeSelect = document.getElementById('malzemeSelect');
        const sevkYeri = document.getElementById('sevkYeri');
        const ambalajBilgisi = document.getElementById('ambalajBilgisi');

        const bbt = document.getElementById('bbt');
        const cuval = document.getElementById('cuval');
        const palet = document.getElementById('palet');
        const bosBbt = document.getElementById('bosBbt');
        const bosCuval = document.getElementById('bosCuval');

        if (firmaKodu) firmaKodu.value = fixed.firma || '';
        if (malzeme) malzeme.value = fixed.malzeme || '';
        if (malzemeSelect) malzemeSelect.value = fixed.malzeme || '';
        if (sevkYeri) sevkYeri.value = fixed.sevkYeri || '';
        if (ambalajBilgisi) ambalajBilgisi.value = fixed.ambalaj || '';
        const yuklemeNotu = document.getElementById('yuklemeNotu');
        if (yuklemeNotu && typeof fixed.yuklemeNotu !== 'undefined') {
          yuklemeNotu.value = fixed.yuklemeNotu || '';
        }

        // ✅ Bu Excel oturumunda aynı firmaya (YDxx) hızlı varsayılan kaydı:
        // Bir kez girildi mi, sonraki plakalarda otomatik dolsun.
        try {
          if (!window.__firmaQuickDefaults) window.__firmaQuickDefaults = {};
          const fKey = _firmaKey(fixed.firma);
          if (fKey) {
            const amb = String(fixed.ambalaj || '').trim();
            const svk = String(fixed.sevkYeri || '').trim();
            // Boşları kaydetme; önceki dolu değer varsa koru
            const prev = window.__firmaQuickDefaults[fKey] || {};
            window.__firmaQuickDefaults[fKey] = {
              ambalaj: amb || prev.ambalaj || '',
              sevkYeri: svk || prev.sevkYeri || ''
            };
          }
        } catch(e) {}

        if (bbt) bbt.value = fixed.bbt || '';
        if (palet) palet.value = fixed.palet || '';
        if (bosBbt) bosBbt.value = fixed.bosBbt || '';

        const tonajEl = document.getElementById('tonaj');
        if (tonajEl && typeof fixed.tonaj !== 'undefined') tonajEl.value = fixed.tonaj || '';

        if (fixed.irsaliyeNo) applyShipmentTonajAndIrsaliye({ irsaliyeNo: fixed.irsaliyeNo });

        // ✅ Çuval özel mantık: 0 gelirse boş çuvalı çuval gibi göster (mevcut davranış korunur)
        if (cuval) {
          const cv = Number(fixed.cuval || 0);
          const bcv = Number(fixed.bosCuval || 0);
          if (cv > 0) {
            cuval.value = String(fixed.cuval);
            if (bosCuval) bosCuval.value = (bcv > 0 ? String(fixed.bosCuval) : '');
          } else if (bcv > 0) {
            cuval.value = String(fixed.bosCuval);
            if (bosCuval) bosCuval.value = '';
          } else {
            cuval.value = '';
            if (bosCuval) bosCuval.value = '';
          }
        }
        // ✅ Excel düzeltmesinden sonra: firma+malzeme eşleştirmesini güncelle (ambalaj/sevk)
        try {
          const f = _firmaKey(fixed.firma);
          const m = (fixed.malzeme || '').trim();
          if (f && m) {
            const existing = eslestirmeListesi.find(es => es.firma === f && es.malzeme === m);
            if (existing && existing.id) {
              eslestirmeStorage.update(existing.id, {
                ambalajBilgisi: (fixed.ambalaj || '').trim(),
                sevkYeri: (fixed.sevkYeri || '').trim()
              });
            } else {
              eslestirmeStorage.add(f, m, (fixed.ambalaj || '').trim(), '', (fixed.sevkYeri || '').trim());
            }
          }
        } catch(e){}

        // ✅ Aynı Excel oturumunda hızlı doldurma (firma/YD bazlı)
        // Kullanıcı bir kez ambalaj/sevk yeri girdiyse, aynı firmaya ait sonraki plakalarda otomatik gelsin.
        try {
          const f = _firmaKey(fixed.firma);
          const a = (fixed.ambalaj || '').trim();
          const s = (fixed.sevkYeri || '').trim();
          if (f && (a || s)) {
            const key = normalizeYdKey(fixed.ydKey || chosen?.ydKey || fixed.firma || chosen?.firma || '');
            if (!window.__quickDefaultsByKey) window.__quickDefaultsByKey = {};
            if (key && (a || s)) {
              window.__quickDefaultsByKey[key] = {
                ambalaj: a || (window.__quickDefaultsByKey[key]?.ambalaj || ''),
                sevkYeri: s || (window.__quickDefaultsByKey[key]?.sevkYeri || '')
              };
            }
          }
        } catch(e){}

      }
    });

  } catch(e) {
    console.error('applyShipmentToTakipForm hata:', e);
  }
}






// 🛡️ Sessiz koruma: hata olursa uygulama çökmesin (login'i etkilemez)
function showUiWarning(message) {
    try {
        let bar = document.getElementById('uiWarningBar');
        if (!bar) {
            bar = document.createElement('div');
            bar.id = 'uiWarningBar';
            bar.className = 'ui-warning hidden';
            bar.innerHTML = `
                <div class="ui-warning__content">
                    <span id="uiWarningText"></span>
                    <button id="uiWarningClose" class="ui-warning__close" title="Kapat">✖</button>
                </div>
            `;
            document.body.appendChild(bar);
            document.getElementById('uiWarningClose')?.addEventListener('click', () => {
                bar.classList.add('hidden');
            });
        }
        const t = document.getElementById('uiWarningText');
        if (t) t.textContent = String(message || 'Bir hata oluştu.');
        bar.classList.remove('hidden');
    } catch (e) {
        console.error('showUiWarning hata:', e);
    }
}

window.addEventListener('error', (e) => {
  console.error('JS ERROR:', e?.error || e?.message || e);
  logClientError('error', e?.error || e?.message || e);
  logClientError('promise', e?.reason || e);
  // UI warning suppressed to avoid bottom-bar notices; still logged to console/localStorage
});


// ✅ Görünmez otomatik günlük yedek (indirirmez, localStorage'a snapshot alır)
function autoDailySnapshot() {
  try {
    const today = new Date();
    const y = today.getFullYear();
    const m = String(today.getMonth()+1).padStart(2,'0');
    const d = String(today.getDate()).padStart(2,'0');
    const key = `auto_backup_${y}-${m}-${d}`;

    if (localStorage.getItem(key)) return; // bugün alındı

    const snap = {
      ts: new Date().toISOString(),
      vehicles: (window.storage && window.storage.loadAll) ? window.storage.loadAll() : []
    };
    localStorage.setItem(key, JSON.stringify(snap));

    // son 7 günü tut, eskileri temizle
    const keys = [];
    for (let i=0;i<localStorage.length;i++){
      const k = localStorage.key(i);
      if (k && k.startsWith('auto_backup_')) keys.push(k);
    }
    keys.sort().reverse();
    keys.slice(7).forEach(k => localStorage.removeItem(k));
  } catch (e) {}
}

// ✅ Sessiz hata günlüğü (en fazla 120 kayıt)
function logClientError(type, payload) {
  try {
    const key = 'client_error_log';
    const arr = JSON.parse(localStorage.getItem(key) || '[]');
    const item = { ts: new Date().toISOString(), type, payload: String(payload || '') };
    arr.unshift(item);
    localStorage.setItem(key, JSON.stringify(arr.slice(0, 120)));
  } catch (e) {}
}

window.addEventListener('unhandledrejection', (e) => {
  console.error('PROMISE ERROR:', e?.reason || e);
  logClientError('error', e?.error || e?.message || e);
  // UI warning suppressed to avoid bottom-bar notices; still logged to console/localStorage
});
        // TÜM VERİLERİ DIŞA AKTAR - YENİ
        function exportFullBackup() {
  try {
    const storageDump = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k) continue;
      // 🔗 Eşleştirme kaldırıldı: yedeğe dahil etme
      if (/eslestirme/i.test(k) || k === 'eslestirmeListesi') continue;
      // ❌ Firma/Malzeme/Sevk hafızaları: yedeğe dahil etme
      if (DISABLED_STORAGE_KEYS && DISABLED_STORAGE_KEYS.includes(k)) continue;
      storageDump[k] = localStorage.getItem(k);
}

    const allData = {
      __type: "V8_FULL_BACKUP",
      exportTarihi: new Date().toLocaleString('tr-TR'),
      storageDump
    };

    const dataStr = JSON.stringify(allData, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);

    const link = document.createElement('a');
    link.href = url;
    link.download = `V8_TAM_YEDEK_${new Date().toISOString().slice(0,19).replace(/[:T]/g,'-')}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  } catch (e) {
    console.error(e);
    alert('❌ Yedek alınırken hata oluştu!');
  }
}

// Eski kısmi yedek (geriye dönük uyumluluk için)
function exportAllDataLegacy() {
  const allData = {
    vehicles: storage.loadAll(),
    // ❌ firmalar/malzemeler/export kaldırıldı

    driverIssuesByPlate: loadIssuesMap(),
    dailyShipmentsCurrent: (() => { try { return JSON.parse(localStorage.getItem(DAILY_SHIPMENT_KEY) || 'null'); } catch(e){ return null; } })(),
    yuklemeSirasiCounter: localStorage.getItem('yuklemeSirasiCounter'),
    yuklemeSirasiDate: localStorage.getItem('yuklemeSirasiDate'),
    deletionLog: (() => { try { return JSON.parse(localStorage.getItem('deletionLog') || '[]'); } catch(e){ return []; } })(),
    exportTarihi: new Date().toLocaleString('tr-TR')
  };

  const dataStr = JSON.stringify(allData, null, 2);
  const dataBlob = new Blob([dataStr], {type: 'application/json'});
  const url = URL.createObjectURL(dataBlob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `V8_YEDEK_${new Date().toISOString().slice(0,19).replace(/[:T]/g,'-')}.json`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function exportAllData(){ return exportAllDataLegacy(); }


        // TÜM VERİLERİ İÇE AKTAR - YENİ
        function importAllData(jsonData) {
            try {
                const allData = JSON.parse(jsonData);

                // ✅ TAM YEDEK (tüm localStorage dump) içe aktarma
                if (allData && allData.storageDump && typeof allData.storageDump === 'object') {
                    try {
                        // send full storageDump to server to persist into SQLite
                        fetch('/api/restore-full', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(allData)
                        }).then(resp => resp.json()).then(result => {
                          try { console.log('restore-full result', result); } catch(e){}
                          // reload app state from server by forcing storage to re-fetch
                          try {
                            if (window.storage && typeof window.storage._readAll === 'function') {
                              window.storage._readAll().then(()=>{
                                try { loadVehicles(); } catch(e){}
                                try { loadFirmalar(); } catch(e){}
                                try { loadEslestirmeler(); } catch(e){}
                                try { loadMalzemeler(); } catch(e){}
                                try { purgeDisabledKeys(); } catch(e){}
                              }).catch(()=>{
                                try { loadVehicles(); } catch(e){}
                              });
                            } else {
                              try { loadVehicles(); } catch(e){}
                            }
                          } catch(e) { try { loadVehicles(); } catch(e){} }
                        }).catch(e => {
                          console.error('Restore failed', e);
                        });
                        return { __fullRestore: true };
                    } catch(e) {
                        return false;
                    }
                }

let sonuc = {
                    araclar: { added: 0, duplicate: 0 },
                    firmalar: { added: 0, duplicate: 0 },
                    eslestirmeler: { added: 0, duplicate: 0 },
                    malzemeler: { added: 0, duplicate: 0 }
                };
                // Araçları içe aktar
                // ✅ Artık plaka benzersiz değil: aynı plaka birden fazla kayıt olabilir.
                // Bu yüzden sadece ID bazlı çakışma kontrolü yapılır.
                if (allData.vehicles) {
                    allData.vehicles.forEach(vehicle => {
                        const key = `vehicle_${vehicle.id}`;
                        if (!localStorage.getItem(key)) {
                            storage.save(key, vehicle);
                            sonuc.araclar.added++;
                        } else {
                            sonuc.araclar.duplicate++;
                        }
                    });
                }
                // ❌ Firmaları içe aktarma kaldırıldı (yedek taşınmasın)
// Eşleştirmeler kaldırıldı: içe aktarma yapılmaz, varsa da temizlenir
                try { localStorage.removeItem('eslestirmeListesi'); } catch(e) {}
        try { localStorage.removeItem('firmaOverrides_v1'); } catch(e) {}
                try { eslestirmeListesi = []; } catch(e) {}

                // Malzemeleri içe aktar
                if (allData.malzemeler) {
                    allData.malzemeler.forEach(malzeme => {
                        if (!malzemeListesi.includes(malzeme)) {
                            malzemeListesi.unshift(malzeme);
                            sonuc.malzemeler.added++;
                        } else {
                            sonuc.malzemeler.duplicate++;
                        }
                    });
                    try { localStorage.removeItem('malzemeListesi'); } catch(e) {}
}

                // ⚠️ Sorunlar / Şoför-Plaka sorun kayıtlarını içe aktar (merge)
                if (allData.driverIssuesByPlate && typeof allData.driverIssuesByPlate === 'object') {
                    const existing = loadIssuesMap();
                    let addedCount = 0;
                    Object.keys(allData.driverIssuesByPlate).forEach(k => {
                        const arr = Array.isArray(allData.driverIssuesByPlate[k]) ? allData.driverIssuesByPlate[k] : [];
                        if (!Array.isArray(existing[k])) existing[k] = [];
                        arr.forEach(it => {
                            const id = it && it.id;
                            if (id && !existing[k].some(x => x && x.id === id)) {
                                existing[k].push(it);
                                addedCount++;
                            }
                        });
                        // newest first
                        existing[k].sort((a,b) => (b?.ts||0) - (a?.ts||0));
                    });
                    saveIssuesMap(existing);
                    sonuc.sorunlar = { added: addedCount };
                } else {
                    sonuc.sorunlar = { added: 0 };
                }

                // Günlük sevkiyat / sayaç / loglar (varsa)
                if (allData.dailyShipmentsCurrent !== undefined) {
                    try { localStorage.setItem(DAILY_SHIPMENT_KEY, JSON.stringify(allData.dailyShipmentsCurrent)); } catch(e){}
                }
                if (allData.yuklemeSirasiCounter !== undefined && allData.yuklemeSirasiCounter !== null) {
                    try { localStorage.setItem('yuklemeSirasiCounter', String(allData.yuklemeSirasiCounter)); } catch(e){}
                }
                if (allData.yuklemeSirasiDate !== undefined && allData.yuklemeSirasiDate !== null) {
                    try { localStorage.setItem('yuklemeSirasiDate', String(allData.yuklemeSirasiDate)); } catch(e){}
                }
                if (allData.deletionLog) {
                    try { localStorage.setItem('deletionLog', JSON.stringify(allData.deletionLog)); } catch(e){}
                }

                return sonuc;
            } catch (e) {
                return false;
            }
        }

        // Verileri yükle (araç + şoför geçmişi tek sunucu isteğiyle)
        async function loadVehicles() {
            state.searchTerm = '';
            state.showAll = false;
            state.vehiclesLoading = true;
            try { render(); } catch (e) {}

            try {
                if (window.storage && typeof window.storage._readAll === 'function') {
                    await window.storage._readAll();
                }
                state.vehicles = storage.loadAll();
                try {
                  if (window.Report && typeof window.Report.getEvents === 'function') {
                    state.reports = window.Report.getEvents();
                  }
                } catch (e) { /* ignore */ }
                populateSoforHistoryFromVehicles(state.vehicles);
                // Telefonları otomatik formatla ve kaydet
                try {
                    let changed = false;
                    const all = state.vehicles.map(v => {
                        const old = v.iletisim || '';
                        const neu = formatTRPhone(old);
                        if (neu && neu !== old) { changed = true; return { ...v, iletisim: neu }; }
                        return v;
                    });
                    if (changed && window.storage && window.storage.save) {
                        all.forEach(v => window.storage.save('vehicle_' + v.id, v));
                        state.vehicles = all;
                    }
                } catch (e) {}

                cleanDuplicatePlates();
                firmaStorage.load();
                eslestirmeStorage.load();
                autoDailySnapshot();
            } catch (e) {
                console.error('loadVehicles hata:', e);
            }

            state.vehiclesLoading = false;
            try { render(); } catch (e) {}
            try {
                if (window.initPiyasaModule && typeof window.initPiyasaModule === 'function') {
                    window.initPiyasaModule();
                }
            } catch (e) { console.warn('Piyasa init hatası:', e); }

            try { if (typeof updateVehicleList === 'function') updateVehicleList(); } catch (e) {}
            try { _ihracatFetchRemotePrintReports(true); } catch (e) {}
        }

        // Form verilerini güncelle
        function updateFormData(field, value) {
  if (field === 'iletisim') {
    state.formData[field] = formatTRPhone(value);
    return;
  }
  state.formData[field] = value;
}

        // Kayıt ekle/güncelle
        async function saveVehicle() {
            const ui = window.rpUi || {};
            const cekiciPlaka = state.formData.cekiciPlaka.trim();
            
            if (!cekiciPlaka) {
                if (typeof ui.alert === 'function') await ui.alert('Çekici plaka zorunludur!', 'danger');
                else alert('Çekici plaka zorunludur!');
                return;
            }

            if (!isValidTC(state.formData.tcKimlik)) {
                if (typeof ui.alert === 'function') await ui.alert('TC Kimlik numarası 11 haneli olmalıdır!', 'danger');
                else alert('TC Kimlik numarası 11 haneli olmalıdır!');
                return;
            }

            if (!isValidIletisim(state.formData.iletisim)) {
                if (typeof ui.alert === 'function') await ui.alert('İletişim numarası 10 veya 11 haneli olmalıdır!', 'danger');
                else alert('İletişim numarası 10 veya 11 haneli olmalıdır!');
                return;
            }
            
            const prevVehicle = state.editingId
                ? (state.vehicles || []).find((v) => v.id === state.editingId)
                : null;
            const vehicleData = {
                id: state.editingId || Date.now().toString(),
                ...state.formData,
                kayitTarihi: state.editingId
                    ? (prevVehicle?.kayitTarihi)
                    : new Date().toLocaleString('tr-TR'),
                printCount: prevVehicle?.printCount,
                lastPrintSnapshot: prevVehicle?.lastPrintSnapshot ?? null,
            };

            // Veritabanına kaydet (asenkron)
            saveVehicleToDatabase(vehicleData);
            
            // Storage cache'e de kaydet (geçici)
            storage.save(`vehicle_${vehicleData.id}`, vehicleData);
            
            // Yeni veya düzenlenen kayıt her zaman listenin en üstüne gelsin
            // Önce aynı ID'li kaydı listeden çıkar, sonra başa ekle
            state.vehicles = (state.vehicles || []).filter(v => v.id !== vehicleData.id);
            state.vehicles.unshift(vehicleData);
            try { _ihracatRefreshOpenModalStatuses(); } catch (_) {}

            // Filtre cache'ini temizle ki yeni sıralama hemen yansısın
            try { window.__filterCache = { term: null, ver: 0, out: null }; } catch (_) {}

            // Yeni kayıttan sonra arama ve sayfalama durumunu sıfırla ki
            // eklenen/düzenlenen araç listenin en üstünde net olarak görünsün
            state.searchTerm = '';
            state.showAll = false;
            state.listLimit = 6;

            if (!state.editingId) {
                try {
                    window.__activeTakipVehicleId = String(vehicleData.id);
                    window.__activeTakipVehiclePlate = vehicleData.cekiciPlaka || '';
                    window.__activeTakipVehicle = vehicleData;
                } catch (e) {}
            }

            const wasEdit = !!state.editingId;
            if (typeof ui.alert === 'function') {
                await ui.alert(wasEdit ? 'Kayıt güncellendi!' : 'Kayıt eklendi!', 'success');
            } else {
                alert(wasEdit ? 'Kayıt güncellendi!' : 'Kayıt eklendi!');
            }
            resetForm();
            _ihracatMaybeReopenAfterVehicleSave();
        }

        // Veritabanına araç kaydetme fonksiyonu - Session olmadan çalışacak
        async function saveVehicleToDatabase(vehicleData) {
            try {
                const payload = Object.assign({}, vehicleData);
                try {
                    const uid = localStorage.getItem('currentUserId') || '';
                    if (uid) payload.editedBy = String(uid).toUpperCase();
                } catch (e) { /* ignore */ }
                const response = await fetch('/api/vehicles', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                
                if (!response.ok) {
                    const errorText = await response.text();
                    console.error('❌ Araç DB kaydetme hatası:', response.status, errorText);
                } else {
                    console.log('✅ Araç veritabanına kaydedildi:', vehicleData.cekiciPlaka);
                }
            } catch (error) {
                console.error('❌ Araç DB kaydetme hatası:', error);
            }
        }

        // Yazdırma öncesi araç kontrol fonksiyonları
        async function checkVehicleInDatabase(plate) {
            try {
                const response = await fetch('/api/vehicles/lookup?plate=' + encodeURIComponent(plate));
                if (response.ok) {
                    const vehicle = await response.json();
                    return !!vehicle;
                }
            } catch (error) {
                console.error('❌ Araç kontrol hatası:', error);
            }
            return false;
        }

        async function saveCurrentVehicleToDatabase(plate) {
            try {
                const get = (id) => (document.getElementById(id)?.value || '').trim();
                const driver = getTakipFormDriverPayload();
                let vehicleId = Date.now().toString();
                try {
                    const lookup = await fetch('/api/vehicles/lookup?plate=' + encodeURIComponent(plate));
                    if (lookup.ok) {
                        const existing = await lookup.json();
                        if (existing && existing.id) vehicleId = String(existing.id);
                    }
                } catch (e) { /* ignore */ }

                const vehicleData = {
                    id: vehicleId,
                    cekiciPlaka: plate,
                    dorsePlaka: driver.dorsePlaka || get('dorsePlakaBilgi') || '',
                    soforAdi: driver.soforAdi,
                    soforSoyadi: driver.soforSoyadi,
                    iletisim: driver.iletisim,
                    tcKimlik: driver.tcKimlik,
                    defaultFirma: '',
                    defaultMalzeme: '',
                    defaultSevkYeri: '',
                    defaultYuklemeNotu: '',
                    kayitTarihi: new Date().toLocaleString('tr-TR')
                };

                await saveVehicleToDatabase(vehicleData);
                
                // Cache'i güncelle
                const prevV = (state.vehicles || []).find((v) => String(v.id) === String(vehicleData.id));
                if (prevV) {
                    vehicleData.printCount = prevV.printCount;
                    vehicleData.lastPrintSnapshot = prevV.lastPrintSnapshot ?? null;
                }
                state.vehicles = (state.vehicles || []).filter(v => v.id !== vehicleData.id);
                state.vehicles.unshift(vehicleData);
                storage.save(`vehicle_${vehicleData.id}`, vehicleData);
                try { _ihracatRefreshOpenModalStatuses(); } catch (_) {}
                
                console.log('✅ Yazdırma öncesi araç DB\'ye kaydedildi:', plate);
            } catch (error) {
                console.error('❌ Yazdırma öncesi araç kaydetme hatası:', error);
            }
        }

        // Form'u sıfırla
        function resetForm() {
            state.formData = {
                cekiciPlaka: '',
                dorsePlaka: '',
                soforAdi: '',
                soforSoyadi: '',
                sofor2Adi: '',
                sofor2Soyadi: '',
                iletisim: '',
                tcKimlik: '',
                defaultFirma: '',
                defaultMalzeme: '',
                defaultSevkYeri: '',
                defaultYuklemeNotu: ''
            };
            state.editingId = null;
            state.showForm = false;
            render();
        }

        // Arama
        function filterVehicles() {
  // ✅ Görünmez performans: basit cache
  window.__filterCache = window.__filterCache || { term: null, ver: 0, out: null };
  const currentVer = (state.vehicles && state.vehicles.length) ? state.vehicles.length : 0;
  if (window.__filterCache.term === state.searchTerm && window.__filterCache.ver === currentVer && window.__filterCache.out) {
    return window.__filterCache.out;
  }
  if (!state.searchTerm) return state.vehicles;

  const term = state.searchTerm.toLowerCase();
  // ✅ Plaka aramasında boşluk / tire farkını yok say
  // Örn: "34ABC123" yazılsa da "34 ABC 123" eşleşsin
  const termPlate = term.replace(/[\s-]+/g, '');

  // ✅ Arama iyileştirmesi: sayı içeriyorsa plaka olarak, içermiyorsa isim olarak ara
  const hasNumbers = /\d/.test(term);
  const searchInPlates = hasNumbers; // sayı varsa plaka ara
  const searchInNames = !hasNumbers || term.length < 3; // sayı yoksa veya çok kısa ise isim ara

  const out = state.vehicles.filter(vehicle => {
    let matches = false;

    // Plaka araması (sayı içeriyorsa)
    if (searchInPlates) {
      matches = matches ||
        (vehicle.cekiciPlaka || '').toLowerCase().replace(/[\s-]+/g, '').includes(termPlate) ||
        (vehicle.dorsePlaka  || '').toLowerCase().replace(/[\s-]+/g, '').includes(termPlate);
    }

    // İsim araması (sayı içermiyorsa veya kısa ise)
    if (searchInNames) {
      matches = matches ||
        (vehicle.soforAdi    || '').toLowerCase().includes(term) ||
        (vehicle.soforSoyadi || '').toLowerCase().includes(term) ||
        (vehicle.sofor2Adi   || '').toLowerCase().includes(term) ||
        (vehicle.sofor2Soyadi|| '').toLowerCase().includes(term) ||
        (vehicle.iletisim    || '').toLowerCase().includes(term) ||
        (vehicle.tcKimlik    || '').toLowerCase().includes(term);
    }

    return matches;
  });
  // ✅ Aramada: sorunlu olanları üste taşı (1 sorun bile varsa)
  try {
    // ⚡ Performans: comparator içinde getIssueCount'u tekrar tekrar çağırmak yerine
    // her plaka için sorun sayısını ve normalize edilmiş plakayı önceden hesapla.
    const meta = new Map();
    for (let i = 0; i < out.length; i++) {
      const v = out[i];
      const plaka = v.cekiciPlaka || '';
      meta.set(v, {
        normPlate: plaka.toLowerCase().replace(/[\s-]+/g,''),
        issueCnt: getIssueCount(plaka)
      });
    }
    out.sort((a,b)=>{
      const ma = meta.get(a), mb = meta.get(b);
      if (searchInPlates) {
        const aExact = ma.normPlate === termPlate ? 1 : 0;
        const bExact = mb.normPlate === termPlate ? 1 : 0;
        if (aExact !== bExact) return bExact - aExact;
      }
      if (ma.issueCnt !== mb.issueCnt) return mb.issueCnt - ma.issueCnt;
      return 0;
    });
  } catch(e){}


  window.__filterCache = { term: state.searchTerm, ver: currentVer, out };
  return out;
}

        // Veri dışa aktar - YENİ
        async function exportData() {
            closeAppToolsMenu();
            if (await confirm('✅ TAM YEDEK AL: Sistem içindeki ne var ne yok (tüm kayıtlar + ayarlar + arşivler) yedeklensin mi?')) {
                exportFullBackup();
            }
        }

        // Veri içe aktar - YENİ
        function importData() {
  closeAppToolsMenu();
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';
  input.style.display = 'none';
  document.body.appendChild(input);

  input.addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) {
      document.body.removeChild(input);
      return;
    }

    const reader = new FileReader();
    reader.onload = async (event) => {
      const result = importAllData(event.target.result);
      if (result !== false) {
        let message = '✅ VERİLER BAŞARIYLA İÇE AKTARILDI:\n\n';

        if (result && result.__fullRestore) {
          alert('✅ TAM YEDEK GERİ YÜKLENDİ!\\n\\nSayfa şimdi yenilenecek.');
          setTimeout(() => { try { location.reload(); } catch(e) {} }, 200);
          document.body.removeChild(input);
          return;
        }

        if (result.araclar.added > 0) message += `• ${result.araclar.added} araç kaydı\n`;
        if (result.firmalar.added > 0) message += `• ${result.firmalar.added} firma\n`;
        if (result.eslestirmeler.added > 0) message += `• ${result.eslestirmeler.added} eşleştirme\n`;
        if (result.malzemeler.added > 0) message += `• ${result.malzemeler.added} malzeme\n`;

        if (result.araclar.duplicate > 0) message += `\n⚠️ ${result.araclar.duplicate} araç atlandı (plaka çakışması)`;
        if (result.firmalar.duplicate > 0) message += `\n⚠️ ${result.firmalar.duplicate} firma atlandı (zaten mevcut)`;
        if (result.eslestirmeler.duplicate > 0) message += `\n⚠️ ${result.eslestirmeler.duplicate} eşleştirme atlandı (zaten mevcut)`;
        if (result.malzemeler.duplicate > 0) message += `\n⚠️ ${result.malzemeler.duplicate} malzeme atlandı (zaten mevcut)`;

        alert(message);
        loadVehicles();
      } else {
        alert('❌ Geçersiz yedek dosyası veya bozuk JSON!');
      }

      document.body.removeChild(input);
    };

    reader.onerror = () => {
      alert('❌ Dosya okunamadı!');
      document.body.removeChild(input);
    };

    reader.readAsText(file);
  }, { once: true });

  input.click();
}

        // Takip Formu Göster
        
