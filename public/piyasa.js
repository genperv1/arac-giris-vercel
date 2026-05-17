
/* PİYASA MODÜLÜ
   - Login ve mevcut İHRACAT Excel sistemine dokunmaz.
   - Araçlar menüsüne eklenen:
     #piyasaExcelUploadButtonTop / #piyasaExcelClearButtonTop
   - Excel yükleyince hafta sorar, siparişleri liste modalında gösterir,
     seçince form alanlarını doldurur.
*/
(function(){
  // Sayfa yenilense bile piyasa verisini kaybetmemek için localStorage kullanıyoruz.
  // (Login ve mevcut ihracat excel sistemine dokunmadan.)
  const STORAGE_KEY = 'piyasa_state_v1';
  const state = {
    orders: [],
    week: null,
    sheet: null,
    loadedAt: null,
  };

  function saveState(){
    try{
      // ✅ Veri tutarlılığı kontrolü: firma alanında İL bilgisi varsa, localStorage'ı temizle
      const hasCorruptData = (state.orders || []).some(o => {
        const firma = String(o.firma || '').toUpperCase();
        const il = String(o.il || '').toUpperCase();
        // Eğer firma alanında il değeri yazılmışsa (hem yazılı hem de il alanında aynı ise)
        return firma === il && firma.length > 0 && 
               ['ANKARA', 'İSTANBUL', 'İZMİR', 'BURSA', 'ADANA', 'BALIKESİR', 'MERSİN', 'GEBZE', 'BOZÜYÜK', 'AKSARAY', 'ANKARA/BALA', 'TURGUTLU/MANİSA'].includes(firma);
      });
      
      if (hasCorruptData) {
        console.warn('Piyasa: Veri bozulması algılandı, localStorage temizleniyor');
        localStorage.removeItem(STORAGE_KEY);
        return false;
      }

      const payload = {
        week: state.week,
        sheet: state.sheet,
        loadedAt: state.loadedAt ? state.loadedAt.toISOString() : null,
        // LocalStorage sınırı için sadece gerekli alanları saklıyoruz
        orders: (state.orders || []).map(o => ({
          __idx: o.__idx,
          firma: o.firma,
          firmaAdi: o.firmaAdi,
          malzeme: o.malzeme,
          yuklemeTuru: o.yuklemeTuru,
          odemeTuru: o.odemeTuru,
          org: o.org,
          aciklama: o.aciklama,
          sevkYeri: o.sevkYeri,
          il: o.il,
          miktar: o.miktar,
          _hSutunValue: o.firmaAdi,
        }))
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      // GIRIS.html üstteki “Excel durumu” alanını anında güncelle
      try { window.refreshHeaderExcelInfo && window.refreshHeaderExcelInfo(); } catch(e) {}
      // Fallback: eğer global refresh fonksiyonu yoksa doğrudan DOM'u güncelle
      try {
        if (!window.refreshHeaderExcelInfo) {
          const cnt = (payload.orders || []).length || 0;
          const weekInfo = payload.week ? payload.week : (payload.sheet ? payload.sheet : '-');
          let dateStr = '-';
          if (payload.loadedAt) {
            const dt = new Date(payload.loadedAt);
            if (!isNaN(dt)){
              const d = ('0' + dt.getDate()).slice(-2);
              const m = ('0' + (dt.getMonth() + 1)).slice(-2);
              const y = dt.getFullYear();
              dateStr = `${d}.${m}.${y}`;
            }
          }
          const piyLine = `${weekInfo}.Hafta/${dateStr}`;
          try{
            const chipPiy = document.getElementById('chipPiyasa');
            const chipPiyText = document.getElementById('chipPiyasaText');
            if (chipPiy) {
              chipPiy.classList.remove('chip-ok', 'chip-warn');
              chipPiy.classList.add(cnt > 0 ? 'chip-ok' : 'chip-warn');
              chipPiy.title = cnt > 0 ? `PİYASA Excel: ${piyLine}` : 'PİYASA Excel yüklü değil';
            }
            if (chipPiyText) chipPiyText.textContent = cnt > 0 ? `Yüklü ${piyLine}` : 'Boş';
          }catch(_){ }
        }
      }catch(e){}
    }catch(e){
      // localStorage dolu olabilir; bu durumda sessiz geçiyoruz.
      console.warn('Piyasa saveState failed', e);
    }
  }

  function loadState(){
    try{
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return false;
      const payload = JSON.parse(raw);
      if (!payload || !Array.isArray(payload.orders) || payload.orders.length === 0) return false;
      
      // ✅ Veri tutarlılığı kontrolü: firma alanında İL bilgisi varsa, yüklemeyi reddet
      const hasCorruptData = payload.orders.some(o => {
        const firma = String(o.firma || '').toUpperCase();
        const il = String(o.il || '').toUpperCase();
        return firma === il && firma.length > 0 && 
               ['ANKARA', 'İSTANBUL', 'İZMİR', 'BURSA', 'ADANA', 'BALIKESİR', 'MERSİN', 'GEBZE', 'BOZÜYÜK', 'AKSARAY', 'ANKARA/BALA', 'TURGUTLU/MANİSA'].includes(firma);
      });
      
      if (hasCorruptData) {
        console.warn('Piyasa: Eski hatalı veri algılandı, temizleniyor');
        localStorage.removeItem(STORAGE_KEY);
        return false;
      }
      
      state.week = payload.week ?? null;
      state.sheet = payload.sheet ?? null;
      state.loadedAt = payload.loadedAt ? new Date(payload.loadedAt) : null;
      state.orders = payload.orders.map((o, i) => {
        // ✅ H sütunu verisini geri yükle
        const hSutunValue = o._hSutunValue || o.firmaAdi || '';
        return {
          __idx: o.__idx ?? (i+1),
          firma: o.firma || '',
          firmaAdi: hSutunValue,
          malzeme: o.malzeme || '',
          yuklemeTuru: o.yuklemeTuru || '',
          odemeTuru: o.odemeTuru || '',
          org: o.org || '',
          aciklama: o.aciklama || '',
          sevkYeri: o.sevkYeri || '',
          il: o.il || '',
          miktar: o.miktar || '',
        };
      });
      return true;
    }catch(e){
      console.warn('Piyasa loadState failed', e);
      return false;
    }
  }

  function clearSavedState(){
    try{ localStorage.removeItem(STORAGE_KEY); }catch(e){}
  }

  function toast(msg, type){
    try{
      if (typeof window.showToast === 'function') return window.showToast(msg, type || 'info');
    }catch(e){}
    // fallback
  }

  function normKey(k){
    return String(k||'')
      .toUpperCase()
      .replaceAll('İ','I')
      .replace(/\s+/g,' ')
      .trim();
  }

  function pick(obj, wanted){
    const map = {};
    for (const key of Object.keys(obj||{})) map[normKey(key)] = obj[key];
    for (const w of wanted){
      const v = map[normKey(w)];
      if (v !== undefined && v !== null && String(v).trim() !== '') return v;
    }
    return '';
  }

  function getWeekFromSheetName(name, wb){
    try{
      const s = String(name||'').toUpperCase();
      // Match a number that appears before 'HAFTA' allowing variants like '28.HAFTA', '28HAFTA', '28 HAFTA', '28,HAFTA (2)'
      const m = s.match(/(\d{1,2})(?=[^\d]*HAFTA)/i);
      if (m) return parseInt(m[1], 10);

      // Fallback: if workbook provided, try to read sheet's G1 (or nearby) to infer week from date
      if (wb && wb.SheetNames && wb.SheetNames.includes(name)){
        try{
          const ws = wb.Sheets[name];
          const found = findDateInSheet(ws);
          if (found && found.date){
            const wk = getWeekFromDate(found.date);
            if (wk) return wk;
          }
        }catch(e){}
      }
    }catch(e){}
    return null;
  }

  function ensureHiddenFileInput(id){
    let inp = document.getElementById(id);
    if (inp) return inp;
    inp = document.createElement('input');
    inp.type = 'file';
    inp.id = id;
    inp.accept = '.xlsx,.xls,.xlsm,.xlsb';
    inp.style.display = 'none';
    document.body.appendChild(inp);
    return inp;
  }

  function askWeek(weeks){
    const def = (weeks && weeks.length) ? String(weeks[0]) : '';
    const answer = prompt(`Hangi haftayı yükleyelim?\nMevcut haftalar: ${weeks.join(', ')}`, def);
    if (answer === null) return null;
    const w = parseInt(String(answer).trim(), 10);
    if (!Number.isFinite(w)) return null;
    return w;
  }

  function chooseBestSheetByRowCount(workbook, sheetNames){
    // ✅ Hız: sheet_to_json ile saymak çok pahalı.
    // !ref üzerinden yaklaşık satır sayısı (çok hızlı) ile en büyük sheet'i seç.
    let best = sheetNames[0];
    let bestCount = -1;
    for (const s of sheetNames){
      try{
        const ws = workbook.Sheets[s];
        const ref = ws && ws['!ref'];
        let rowCount = 0;
        if (ref && XLSX && XLSX.utils && XLSX.utils.decode_range){
          const range = XLSX.utils.decode_range(ref);
          rowCount = (range.e.r - range.s.r + 1) || 0;
        }
        if (rowCount > bestCount){
          bestCount = rowCount;
          best = s;
        }
      }catch(e){}
    }
    return best;
  }

  // Excel'deki bazı satırlar filtre/gizli olabilir. Varsa !rows.hidden bilgisine göre ele.
  function filterHiddenRowsAoA(ws, table){
    try{
      const rowsMeta = ws && ws['!rows'];
      if (!rowsMeta || !Array.isArray(rowsMeta)) return table;
      const out = [];
      for (let i = 0; i < table.length; i++){
        const meta = rowsMeta[i];
        if (meta && meta.hidden) continue;
        out.push(table[i]);
      }
      return out;
    }catch(e){
      return table;
    }
  }

  function parseAmount(v){
    const s = String(v ?? '').trim();
    if (!s) return NaN;
    // 1.234,56 / 1234,56 / 1234.56 gibi
    const cleaned = s
      .replace(/\s+/g,'')
      .replace(/\./g,'')
      .replace(',', '.');
    const n = parseFloat(cleaned);
    return Number.isFinite(n) ? n : NaN;
  }

  function isSummaryText(v){
    const t = String(v||'').toUpperCase().replaceAll('İ','I');
    return t.includes('TOPLAM') || t.includes('ARA TOPLAM') || t.includes('GENEL TOPLAM') || t.includes('OZET') || t.includes('ÖZET');
  }

  function parseSheetSmart(ws){
    // Bazı dosyalarda başlık satırı 1. satır değildir (üstte boş/sabit satırlar olabilir).
    // Bu yüzden sheet'i önce tablo (array-of-arrays) olarak okuyup başlık satırını buluyoruz.
    let table = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    table = filterHiddenRowsAoA(ws, table);
    const expected = ['SİRA','SIRA','SEVK','FİRMA','FIRMA','FİRMA ADI','FIRMA ADI','MALZEME','YÜKLEME TÜRÜ','YUKLEME TURU','AÇIKLAMA','ACIKLAMA','İL','IL','LOT NO','LOT','MİKTAR','MIKTAR'];

    function cellNorm(v){
      return String(v||'')
        .toUpperCase()
        .replaceAll('İ','I')
        .replace(/\s+/g,' ')
        .trim();
    }

    // İlk 40 satır içinde, beklenen başlıklardan en az 2-3 tanesini içeren satırı başlık kabul et.
    let headerRowIndex = -1;
    let bestScore = -1;
    const scanMax = Math.min(table.length, 40);
    for (let i = 0; i < scanMax; i++){
      const row = table[i] || [];
      const set = new Set(row.map(cellNorm).filter(Boolean));
      let score = 0;
      for (const k of expected) if (set.has(cellNorm(k))) score++;
      if (score > bestScore){
        bestScore = score;
        headerRowIndex = i;
      }
    }

    // Eğer hiç başlık bulamadıysa, klasik json'a dön.
    if (bestScore < 2 || headerRowIndex < 0){
      return XLSX.utils.sheet_to_json(ws, { defval: '' });
    }

    const header = (table[headerRowIndex] || []).map(v=> String(v||'').trim());
    // Boş başlıkları doldur
    const safeHeader = header.map((h, idx)=> h && h.trim() ? h : `__COL_${idx}`);

    const out = [];
    for (let r = headerRowIndex + 1; r < table.length; r++){
      const row = table[r];
      if (!row) continue;
      const obj = {};
      for (let c = 0; c < safeHeader.length; c++){
        obj[safeHeader[c]] = row[c] ?? '';
      }
      // ✅ H sütunu (7. index) direkt erişim - başlık adından bağımsız
      if (row.length > 7) {
        obj._hSutunValue = String(row[7] || '').trim();
      }
      out.push(obj);
    }
    return out;
  }

  function normalizeRows(rawRows){
    return (rawRows || []).map((r, idx)=>{
      // Extract firma code and firmaAdi (full name) separately
      const firmaCode = pick(r, ['FİRMA','FIRMA']);
      // ✅ H SÜTUNUNDAN FIRMA ADI ÇEKME (başlık adından bağımsız, direkt H6 sütunu)
      let firmaAdi = r._hSutunValue ? String(r._hSutunValue).trim() : '';
      const odemeVal = pick(r, ['ÖDEME TÜRÜ','ODEME TURU','ÖDEME','ODEME']);
      const malzemeVal = pick(r, ['MALZEME']);
      const yuklemeVal = pick(r, ['YÜKLEME TÜRÜ','YUKLEME TURU','YÜKLEME TURU']);
      let orgVal = pick(r, ['ORG','ORGANIZASYON','ORGANIZASYON','ORGANIZATION']);
      // Fallback: detect headers like 'ORG(organizasyon)' or any header containing ORG/ORGANIZ
      if (!orgVal) {
        try{
          for (const hk of Object.keys(r || {})){
            const nk = normKey(hk || '');
            if (!nk) continue;
            if (nk.includes('ORG') || nk.includes('ORGANIZ')){
              orgVal = r[hk] ?? '';
              break;
            }
          }
        }catch(e){ /* ignore */ }
      }
      return {
        __idx: idx + 1,
        firma: firmaCode,
        firmaAdi: firmaAdi,
        odemeTuru: odemeVal,
        malzeme: malzemeVal,
        yuklemeTuru: yuklemeVal,
        org: orgVal,
        aciklama: pick(r, ['AÇIKLAMA','ACIKLAMA']),
        sevkYeri: pick(r, ['SEVK','SEVK YERİ','SEVKYERI']),
        il: pick(r, ['İL','IL']),
        miktar: pick(r, ['MİKTAR','MIKTAR']),
        irsaliyeNo: pick(r, ['İRSALİYE NO','IRSALIYE NO','İRSALİYE','IRSALIYE']),
        _raw: r
      };
    }).filter(o=>{
      // Sipariş satırı filtresi (fazla satır sayımını azaltır)
      const firma = String(o.firma||'').trim();
      const malzeme = String(o.malzeme||'').trim();
      const miktarRaw = String(o.miktar||'').trim();
      const any = (firma||malzeme||o.yuklemeTuru||o.aciklama||o.il||miktarRaw||o.odemeTuru||o.org);
      if (!String(any||'').trim()) return false;
      if (isSummaryText(firma) || isSummaryText(malzeme)) return false;
      // En az firma+malzeme olmalı
      if (!firma || !malzeme) return false;
      // Miktar sayısal ve >0 olmalı (miktar yoksa sipariş saymayalım)
      const n = parseAmount(miktarRaw);
      if (!Number.isFinite(n) || n <= 0) return false;
      return true;
    });
  }

  function getSheetMetaForPicker(wb){
    const metas = [];
    const names = wb.SheetNames || [];
    for (let i = 0; i < names.length; i++){
      const name = names[i];
      const week = getWeekFromSheetName(name, wb);
      if (!week) continue;

      // HIZLI: tüm sheet'i JSON'a çevirmeden yaklaşık satır sayısı al
      let approxRows = 0;
      try{
        const ws = wb.Sheets[name];
        const ref = ws && ws['!ref'];
        if (ref && XLSX?.utils?.decode_range){
          const range = XLSX.utils.decode_range(ref);
          approxRows = (range.e.r - range.s.r + 1) || 0;
        }
      }catch(e){
        approxRows = 0;
      }

      metas.push({ name, week, count: approxRows, approx: true, orderIndex: i });
    }
    return metas;
  }

  function getWeekFromDate(dt){
    try{
      const d = new Date(Date.UTC(dt.getFullYear(), dt.getMonth(), dt.getDate()));
      const dayNum = d.getUTCDay() || 7;
      d.setUTCDate(d.getUTCDate() + 4 - dayNum);
      const yearStart = new Date(Date.UTC(d.getUTCFullYear(),0,1));
      const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1)/7);
      return weekNo;
    }catch(e){ return null; }
  }

  // Given an ISO week number and a year, return a Date representing
  // the Monday of that ISO week (UTC midnight). Returns null on error.
  function getDateFromWeekYear(week, year){
    try{
      week = parseInt(week, 10);
      year = parseInt(year, 10);
      if (!Number.isFinite(week) || !Number.isFinite(year)) return null;
      // ISO week: week 1 is the week with Jan 4th. Find the Monday of week 1, then add (week-1)*7 days.
      const jan4 = new Date(Date.UTC(year, 0, 4));
      const day = jan4.getUTCDay() || 7; // 1..7 (Mon..Sun)
      const mondayOfWeek1 = new Date(Date.UTC(year, 0, 4 - (day - 1)));
      const result = new Date(mondayOfWeek1.getTime() + (week - 1) * 7 * 86400000);
      return result;
    }catch(e){ return null; }
  }

  function parseDateFromCell(cell){
    if (!cell) return null;
    try{
      // Excel date type
      if (cell.t === 'd' && cell.v) return new Date(cell.v);
      // Excel serial number
      if (cell.t === 'n' && typeof cell.v === 'number'){
        return new Date(Math.round((cell.v - 25569) * 86400 * 1000));
      }
      const s = String(cell.v ?? cell.w ?? '').trim();
      if (!s) return null;
      // Try native parse first (ISO etc.)
      const parsed = Date.parse(s);
      if (!Number.isNaN(parsed)) return new Date(parsed);
      // Try dd.mm.yyyy or dd-mm-yyyy or dd/mm/yyyy
      const m = s.match(/^(\d{1,2})[\.\-\/](\d{1,2})[\.\-\/](\d{2,4})$/);
      if (m){
        let day = parseInt(m[1],10);
        let month = parseInt(m[2],10) - 1;
        let year = parseInt(m[3],10);
        if (year < 100) year += 2000;
        return new Date(year, month, day);
      }
      // Fallback: replace dots/dashes with slashes and try parse again
      const alt = s.replace(/\./g,'/').replace(/\-/g,'/');
      const parsed2 = Date.parse(alt);
      if (!Number.isNaN(parsed2)) return new Date(parsed2);
    }catch(e){}
    return null;
  }

  function getCell(ws, ref){
    if (!ws || !ref) return null;
    // Object-style sheet (common)
    if (!Array.isArray(ws)){
      return ws[ref] || ws[ref.toLowerCase()] || null;
    }
    // Dense-style sheet: array of rows
    // ref like 'G1'
    const m = String(ref).toUpperCase().match(/^([A-Z]+)(\d+)$/);
    if (!m) return null;
    const colLetters = m[1];
    const rowNum = parseInt(m[2], 10);
    // convert colLetters to zero-based index
    let col = 0;
    for (let i = 0; i < colLetters.length; i++){
      col = col * 26 + (colLetters.charCodeAt(i) - 65 + 1);
    }
    const colIdx = col - 1;
    const rowIdx = rowNum - 1;
    if (!Array.isArray(ws[rowIdx])) return null;
    return ws[rowIdx][colIdx] || null;
  }

  function findDateInSheet(ws){
    try{
      const checkRefs = ['G1','F1','E1','D1','C1','B1','A1'];
      for (const r of checkRefs){
        const c = getCell(ws, r);
        const d = parseDateFromCell(c);
        if (d) return { date: d, raw: (c && (c.v ?? c.w)) || null, ref: r };
      }
      // genişletilmiş tarama: ilk 3 satır, A..H sütunları
      const cols = ['A','B','C','D','E','F','G','H'];
      for (let row = 1; row <= 3; row++){
        for (const col of cols){
          const ref = `${col}${row}`;
          const c = getCell(ws, ref);
          const d = parseDateFromCell(c);
          if (d) return { date: d, raw: (c && (c.v ?? c.w)) || null, ref };
        }
      }
    }catch(e){}
    return null;
  }

  function openSheetPickerModal(metas, wb, onConfirm){
    const weeks = Array.from(new Set(metas.map(m=>m.week))).sort((a,b)=>a-b);
    const defaultWeek = weeks[0] ?? null;

    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.35);z-index:99999;display:flex;align-items:center;justify-content:center;padding:16px;';
    overlay.innerHTML = `
      <div style="background:#fff;border-radius:14px;max-width:780px;width:100%;max-height:82vh;overflow:hidden;box-shadow:0 10px 30px rgba(0,0,0,.25);display:flex;flex-direction:column;">
        <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 14px;border-bottom:1px solid #eee;gap:12px;">
          <div style="font-weight:900;">PİYASA Excel • Kitap Seç</div>
          <button id="piyasaSheetModalClose" style="border:0;background:#eee;border-radius:10px;padding:6px 10px;cursor:pointer;">Kapat</button>
        </div>
        <div style="padding:10px 14px;display:flex;gap:10px;align-items:center;border-bottom:1px solid #eee;flex-wrap:wrap;">
          <label style="font-size:12px;color:#666;">Hafta:</label>
          <select id="piyasaSheetWeek" style="padding:8px;border:1px solid #ddd;border-radius:10px;min-width:140px;"></select>
          <input id="piyasaSheetSearch" placeholder="Kitap adı ara..." style="flex:1;min-width:220px;padding:10px;border:1px solid #ddd;border-radius:10px;">
          <div style="font-size:12px;color:#666;min-width:120px;text-align:right;" id="piyasaSheetCount"></div>
        </div>
        <div style="padding:0 14px 14px;overflow:auto;flex:1;">
          <table style="width:100%;border-collapse:collapse;font-size:13px;">
            <thead>
              <tr style="background:#f6f6f6;position:sticky;top:0;z-index:1;">
                <th style="text-align:left;padding:8px;border:1px solid #eee;">Seç</th>
                <th style="text-align:left;padding:8px;border:1px solid #eee;">KİTAP (SHEET)</th>
                <th style="text-align:left;padding:8px;border:1px solid #eee;">HAFTA</th>
                <th style="text-align:left;padding:8px;border:1px solid #eee;">SİPARİŞ</th>
                <th style="text-align:left;padding:8px;border:1px solid #eee;">SIRA</th>
              </tr>
            </thead>
            <tbody id="piyasaSheetTbody"></tbody>
          </table>
        </div>
        <div style="display:flex;justify-content:flex-end;gap:10px;padding:12px 14px;border-top:1px solid #eee;">
          <button id="piyasaSheetCancel" style="border:0;background:#eee;border-radius:10px;padding:10px 12px;cursor:pointer;">İptal</button>
          <button id="piyasaSheetOk" disabled style="border:0;background:#111827;color:#fff;border-radius:10px;padding:10px 12px;cursor:pointer;opacity:.6;">Tamam</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const close = ()=> overlay.remove();
    overlay.querySelector('#piyasaSheetModalClose').onclick = close;
    overlay.querySelector('#piyasaSheetCancel').onclick = close;
    overlay.onclick = (e)=>{ if(e.target===overlay) close(); };

    const weekSel = overlay.querySelector('#piyasaSheetWeek');
    const searchEl = overlay.querySelector('#piyasaSheetSearch');
    const tbody = overlay.querySelector('#piyasaSheetTbody');
    const countEl = overlay.querySelector('#piyasaSheetCount');
    const okBtn = overlay.querySelector('#piyasaSheetOk');

    weeks.forEach(w=>{
      const opt = document.createElement('option');
      opt.value = String(w);
      opt.textContent = `${w}. HAFTA`;
      weekSel.appendChild(opt);
    });
    if (defaultWeek !== null) weekSel.value = String(defaultWeek);

    // Varsayılan sheet: o haftada parantezsiz "X.HAFTA" varsa o, yoksa en sağdaki (orderIndex en büyük)
    function defaultPickForWeek(w){
      const list = metas.filter(m=>m.week===w);
      const exactName = `${w}.HAFTA`;
      const exact = list.find(m => String(m.name||'').trim().toUpperCase() === exactName);
      if (exact) return exact.name;
      let best = list[0]?.name || '';
      let bestIdx = -1;
      for (const m of list){
        if (m.orderIndex > bestIdx){ bestIdx = m.orderIndex; best = m.name; }
      }
      return best;
    }

    let selectedName = '';
    function setSelected(name){
      selectedName = name || '';
      okBtn.disabled = !selectedName;
      okBtn.style.opacity = selectedName ? '1' : '.6';
      // radio işaretlerini güncelle
      tbody.querySelectorAll('input[type="radio"]').forEach(r=>{
        r.checked = (r.value === selectedName);
      });
    }

    function render(){
      const w = parseInt(weekSel.value, 10);
      const q = String(searchEl.value||'').trim().toLowerCase();
      let list = metas.filter(m=>m.week===w);
      if (q) list = list.filter(m => String(m.name||'').toLowerCase().includes(q));
      // Önce sipariş sayısına göre, eşitse en sağdaki önce
      list.sort((a,b)=> (b.count - a.count) || (b.orderIndex - a.orderIndex));
      countEl.textContent = `${list.length} kitap`;
      tbody.innerHTML = list.map(m=>`
        <tr>
          <td style="padding:8px;border:1px solid #eee;">
            <input type="radio" name="piyasaSheetRadio" value="${escapeHtml(m.name)}" style="transform:scale(1.1);">
          </td>
          <td style="padding:8px;border:1px solid #eee;">${escapeHtml(m.name)}</td>
          <td style="padding:8px;border:1px solid #eee;">${m.week}. hafta</td>
          <td style="padding:8px;border:1px solid #eee;">${m.approx ? ('~' + m.count) : m.count}</td>
          <td style="padding:8px;border:1px solid #eee;">${m.orderIndex+1}</td>
        </tr>
      `).join('');

      // olaylar
      tbody.querySelectorAll('tr').forEach(tr=>{
        tr.style.cursor = 'pointer';
        tr.onclick = ()=>{
          const radio = tr.querySelector('input[type="radio"]');
          if (radio){
            radio.checked = true;
            setSelected(radio.value);
          }
        };
      });

      // eğer bu hafta için seçili sheet yoksa default seç
      if (!selectedName || !list.find(x=>x.name===selectedName)){
        const def = defaultPickForWeek(w);
        setSelected(def);
      }
    }

    weekSel.onchange = ()=>{ selectedName=''; render(); };
    searchEl.oninput = ()=> render();

    okBtn.onclick = ()=>{
      if (!selectedName) return;
      const w = parseInt(weekSel.value, 10);
      const chosen = metas.find(m=>m.name===selectedName);
      if (!chosen){
        alert('❌ Seçilen kitap bulunamadı.');
        return;
      }
      // try to read a date from the chosen sheet (e.g. G1)
      let foundDate = null;
      try{
        if (wb && wb.SheetNames && wb.SheetNames.includes(chosen.name)){
          const ws = wb.Sheets[chosen.name];
          const f = findDateInSheet(ws);
          if (f && f.date) foundDate = f.date;
        }
      }catch(e){}
      close();
      onConfirm({ sheetName: chosen.name, week: w, foundDate });
    };

    render();
    setTimeout(()=> searchEl.focus(), 0);
  }

  function applyOrderToForm(o){
    const firmaKodu = document.getElementById('firmaKodu');
    const firmaSelect = document.getElementById('firmaSelect');
    const malzeme = document.getElementById('malzeme');
    const malzemeSelect = document.getElementById('malzemeSelect');
    const ambalaj = document.getElementById('ambalajBilgisi');
    const notu = document.getElementById('yuklemeNotu');
    const sevk = document.getElementById('sevkYeri');
    const tonaj = document.getElementById('tonaj');
    const seperator = document.getElementById('seperatorBilgisi');

    // Değerleri bas
    // Firma/Müşteri Kodu: hem input'u doldur hem de select içinde eşleşen varsa seç.
    const firmaVal = (o.firma || '').trim();
    if (firmaKodu) firmaKodu.value = firmaVal;
    let firmaOptMatched = false;
    if (firmaSelect) {
      const opt = Array.from(firmaSelect.options || []).find(x => (x.value||'').trim() === firmaVal);
      if (opt) {
        firmaSelect.value = opt.value;
        firmaOptMatched = true;
      }
    }
    if (malzeme) malzeme.value = o.malzeme || '';
    if (malzemeSelect) {
      // seçenek eşleşirse select'i de işaretle
      const target = (o.malzeme || '').trim();
      const opt = Array.from(malzemeSelect.options || []).find(x => (x.value||'').trim() === target);
      malzemeSelect.value = opt ? opt.value : '';
    }
    if (ambalaj) ambalaj.value = o.yuklemeTuru || '';
    if (notu) notu.value = o.aciklama || '';
    if (sevk) sevk.value = o.sevkYeri || o.il || '';
    if (tonaj) tonaj.value = o.miktar || '';
    
    // SEPERATÖR BİLGİSİ: ÖDEME TÜRÜ ve ORG bilgilerini ayrı ayrı belirterek yaz
    if (seperator) {
      const odemeTuru = (o.odemeTuru || '').trim();
      const org = (o.org || '').trim();
      if (odemeTuru && org) {
        seperator.value = `ÖDEME TÜRÜ: ${odemeTuru} ORG: ${org}`;
      } else if (odemeTuru) {
        seperator.value = `ÖDEME TÜRÜ: ${odemeTuru}`;
      } else if (org) {
        seperator.value = `ORG: ${org}`;
      }
      
      // Focus olduğunda genişle, blur olduğunda küçül
      seperator.onfocus = function() { 
        this.style.width = '300px'; 
        this.style.transition = 'all 0.3s ease';
      };
      seperator.onblur = function() { 
        this.style.width = '100px'; 
        this.style.transition = 'all 0.3s ease';
      };
    }

    // Listener'ları tetikle
    const els = [firmaKodu, malzeme, malzemeSelect, ambalaj, notu, sevk, tonaj, seperator];
    if (firmaOptMatched) els.unshift(firmaSelect);
    els.forEach(el=>{
      if (!el) return;
      try {
        el.dispatchEvent(new Event('input', { bubbles:true }));
        el.dispatchEvent(new Event('change', { bubbles:true }));
      } catch(_) {}
    });

    // Bazı akışlarda select change input'u temizleyebiliyor; en son tekrar basıyoruz.
    if (firmaKodu) firmaKodu.value = firmaVal;
    if (malzeme) malzeme.value = o.malzeme || '';
    if (malzemeSelect) {
      const target = (o.malzeme || '').trim();
      const opt = Array.from(malzemeSelect.options || []).find(x => (x.value||'').trim() === target);
      malzemeSelect.value = opt ? opt.value : '';
    }
    if (ambalaj) ambalaj.value = o.yuklemeTuru || '';
    if (notu) notu.value = o.aciklama || '';
    if (sevk) sevk.value = o.sevkYeri || o.il || '';
    if (tonaj) tonaj.value = o.miktar || '';
    
    // SEPERATÖR BİLGİSİ: ÖDEME TÜRÜ ve ORG bilgilerini ayrı ayrı belirterek yaz (ikinci kez)
    if (seperator) {
      const odemeTuru = (o.odemeTuru || '').trim();
      const org = (o.org || '').trim();
      if (odemeTuru && org) {
        seperator.value = `ÖDEME TÜRÜ: ${odemeTuru} ORG: ${org}`;
      } else if (odemeTuru) {
        seperator.value = `ÖDEME TÜRÜ: ${odemeTuru}`;
      } else if (org) {
        seperator.value = `ORG: ${org}`;
      }
      
      // Focus olduğunda genişle, blur olduğunda küçül (ikinci kez)
      seperator.onfocus = function() { 
        this.style.width = '300px'; 
        this.style.transform = 'translateY(-5px) translateX(10px)'; // Yukarı ve sağa kaydır
        this.style.transition = 'all 0.3s ease';
      };
      seperator.onblur = function() { 
        this.style.width = '100px'; 
        this.style.transform = 'translateY(0) translateX(0)'; // Orijinal pozisyon
        this.style.transition = 'all 0.3s ease';
      };
    }
  }

  // Map a firma code to a human-friendly firma name using global `firmaListesi` if available
  function getFirmaFullName(code){
    try{
      const k = String(code||'').trim();
      if (!k) return '';
      const list = (window.firmaListesi && Array.isArray(window.firmaListesi)) ? window.firmaListesi : (typeof firmaListesi !== 'undefined' && Array.isArray(firmaListesi) ? firmaListesi : []);
      // Try exact or prefix match (e.g. 'HP3' matches 'HP3 / BOZÜYÜK')
      for (const entry of list){
        if (!entry) continue;
        const e = String(entry||'').trim();
        if (!e) continue;
        // normalize
        const up = e.toUpperCase();
        const kc = k.toUpperCase();
        const parts = e.split('/').map(x=>x.trim()).filter(Boolean);
        const left = parts[0] || e;
        const right = parts.length > 1 ? parts.slice(1).join(' / ').trim() : '';
        if (String(left).toUpperCase() === kc) return right || e;
        // allow left starting with code (e.g. 'HP3  / ...')
        if (String(left).toUpperCase().startsWith(kc)) return right || e;
        // also allow entry to contain code somewhere
        if (up.includes(kc)) return right || e;
      }
    }catch(e){}
    return '';
  }


  function openOrderPicker(){
    if (!state.orders || state.orders.length === 0){
      alert('❌ PİYASA Excel yüklü değil ya da sipariş yok.');
      return;
    }

    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.35);z-index:99999;display:flex;align-items:center;justify-content:center;padding:16px;';
    overlay.innerHTML = `
      <div style="background:#fff;border-radius:14px;max-width:1000px;width:100%;max-height:82vh;overflow:hidden;box-shadow:0 10px 30px rgba(0,0,0,.25);display:flex;flex-direction:column;">
        <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 14px;border-bottom:1px solid #eee;gap:12px;">
          <div>
            <div style="font-weight:900;">Piyasa Sipariş Seç</div>
            <div id="duplicateWarning" style="font-size:12px;color:#000;background:#FFD700;padding:4px 8px;border-radius:4px;display:none;margin-top:4px;">⚠️ AYNI FİRMA BULUNUYOR - SİPARİŞ SEÇERKEN AYNI RENKLİ BANTLARA DİKKAT EDİNİZ</div>
          </div>
          <div style="font-size:12px;color:#666;">${state.sheet ? `Sheet: <b>${escapeHtml(state.sheet)}</b>` : ''}</div>
          <button id="piyasaModalClose" style="border:0;background:#eee;border-radius:10px;padding:6px 10px;cursor:pointer;">Kapat</button>
        </div>
        <div style="padding:10px 14px;display:flex;gap:10px;align-items:center;border-bottom:1px solid #eee;">
          <input id="piyasaSearch" placeholder="Firma / Malzeme / İl / Açıklama ara..." style="flex:1;padding:10px;border:1px solid #ddd;border-radius:10px;">
          <div style="font-size:12px;color:#666;min-width:120px;text-align:right;" id="piyasaCount"></div>
        </div>
        <div style="padding:0 14px 14px;overflow:auto;flex:1;">
          <table style="width:100%;border-collapse:collapse;font-size:13px;">
            <thead>
              <tr style="background:#f6f6f6;position:sticky;top:0;z-index:1;">
                <th style="text-align:left;padding:8px;border:1px solid #eee;">#</th>
                <th style="text-align:left;padding:8px;border:1px solid #eee;">FİRMA</th>
                <th style="text-align:left;padding:8px;border:1px solid #eee;">FİRMA ADI</th>
                <th style="text-align:left;padding:8px;border:1px solid #eee;">MALZEME</th>
                <th style="text-align:left;padding:8px;border:1px solid #eee;">YÜKLEME TÜRÜ</th>
                <th style="text-align:left;padding:8px;border:1px solid #eee;">ÖDEME TÜRÜ</th>
                <th style="text-align:left;padding:8px;border:1px solid #eee;">ORG</th>
                <th style="text-align:left;padding:8px;border:1px solid #eee;">Şehir</th>
                <th style="text-align:left;padding:8px;border:1px solid #eee;">Miktar (Kg)</th>
                <th style="text-align:left;padding:8px;border:1px solid #eee;">SEÇ</th>
              </tr>
            </thead>
            <tbody id="piyasaTbody"></tbody>
          </table>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const close = ()=> {
      overlay.remove();
      document.removeEventListener('keydown', handleEsc);
    };
    overlay.querySelector('#piyasaModalClose').onclick = close;
    overlay.onclick = null;
    
    // ESC tuşu ile kapat
    const handleEsc = (e)=> {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('keydown', handleEsc);

    const tbody = overlay.querySelector('#piyasaTbody');
    const countEl = overlay.querySelector('#piyasaCount');
    const searchEl = overlay.querySelector('#piyasaSearch');

    function rowHtml(o, duplicateFirmas){
      const firmaCode = String(o.firma || '').trim();
      const firmaAdi = (o.firmaAdi && String(o.firmaAdi).trim()) ? String(o.firmaAdi).trim() : (getFirmaFullName(firmaCode) || '');
      const isDuplicate = duplicateFirmas.has(firmaAdi);
      
      const normalStyle = 'padding:8px;border:1px solid #eee;';
      const redStyle = 'padding:8px;border:1px solid #eee;background:#111210;color:#FFBF00;font-weight:bold;';
      const highlightStyle = 'padding:8px;border:1px solid #eee;background:#111210;color:#FFBF00;font-weight:bold;font-size:16px;';
      
      return `
        <tr>
          <td style="${isDuplicate ? redStyle : normalStyle}">${o.__idx}</td>
          <td style="${isDuplicate ? redStyle : normalStyle}">${escapeHtml(firmaCode)}</td>
          <td style="${isDuplicate ? redStyle : normalStyle}">${escapeHtml(firmaAdi)}</td>
          <td style="${isDuplicate ? redStyle : normalStyle}">${escapeHtml(o.malzeme||'')}</td>
          <td style="${isDuplicate ? highlightStyle : normalStyle}">${escapeHtml(o.yuklemeTuru||'')}</td>
          <td style="${isDuplicate ? redStyle : normalStyle}">${escapeHtml(o.odemeTuru||'')}</td>
          <td style="${isDuplicate ? redStyle : normalStyle}">${escapeHtml(o.org||'')}</td>
          <td style="${isDuplicate ? highlightStyle : normalStyle}">${escapeHtml(o.il||'')}</td>
          <td style="${isDuplicate ? redStyle : normalStyle}">${escapeHtml(String(o.miktar||''))}</td>
          <td style="${isDuplicate ? redStyle : normalStyle}">
            <button data-idx="${o.__idx}" style="cursor:pointer;border:0;background:#111827;color:#fff;border-radius:10px;padding:6px 10px;">Seç</button>
          </td>
        </tr>
      `;
    }

    function render(filter){
      const f = String(filter||'').trim().toLowerCase();
      const rows = state.orders.filter(o=>{
        const firmaAdi = (o.firmaAdi && String(o.firmaAdi).trim()) ? String(o.firmaAdi).trim() : (getFirmaFullName(String(o.firma||'')) || '');
        const hay = `${o.firma} ${firmaAdi} ${o.malzeme} ${o.sevkYeri || ''} ${o.il} ${o.yuklemeTuru} ${o.aciklama} ${o.miktar} ${o.odemeTuru || ''} ${o.org || ''}`.toLowerCase();
        return !f || hay.includes(f);
      });
      
      // Firma duplicate kontrolü
      const firmaCount = {};
      rows.forEach(o => {
        const firmaCode = String(o.firma || '').trim();
        const firmaAdi = (o.firmaAdi && String(o.firmaAdi).trim()) ? String(o.firmaAdi).trim() : (getFirmaFullName(firmaCode) || '');
        if (firmaAdi) {
          firmaCount[firmaAdi] = (firmaCount[firmaAdi] || 0) + 1;
        }
      });
      
      const duplicateFirmas = new Set();
      Object.keys(firmaCount).forEach(firma => {
        if (firmaCount[firma] > 1) duplicateFirmas.add(firma);
      });
      
      // Uyarıyı göster/gizle
      const warningEl = overlay.querySelector('#duplicateWarning');
      if (warningEl) {
        warningEl.style.display = duplicateFirmas.size > 0 ? 'block' : 'none';
      }
      
      countEl.textContent = `${rows.length} sipariş`;
      tbody.innerHTML = rows.map(o => rowHtml(o, duplicateFirmas)).join('');
      tbody.querySelectorAll('button[data-idx]').forEach(btn=>{
        btn.onclick = ()=>{
          const idx = parseInt(btn.getAttribute('data-idx'), 10);
          const selected = state.orders.find(x=>x.__idx===idx);
          if (selected){
            applyOrderToForm(selected);
            close();
          }
        };
      });
    }

    searchEl.oninput = ()=> render(searchEl.value);
    setTimeout(()=> searchEl.focus(), 0);
    render('');
  }

  function escapeHtml(s){
    return String(s||'')
      .replaceAll('&','&amp;')
      .replaceAll('<','&lt;')
      .replaceAll('>','&gt;')
      .replaceAll('"','&quot;')
      .replaceAll("'","&#039;");
  }

  function pad(n){ return String(n).padStart(2,'0'); }

  function formatDateUTCAsLocalString(dt){
    if (!dt) return '';
    // dt is UTC-midnight produced by getDateFromWeekYear; format as dd.MM.yyyy
    const d = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate()));
    return `${pad(d.getDate())}.${pad(d.getMonth()+1)}.${d.getFullYear()}`;
  }

  // Modal that allows selecting among the detected week-sheets and previews the sheet date/count
  function showWeekPickerModal(metas, wb, currentSheetName, onConfirm){
    try{
      const overlay = document.createElement('div');
      overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.35);z-index:100000;display:flex;align-items:center;justify-content:center;padding:16px;';
      overlay.innerHTML = `
        <div style="background:#fff;border-radius:12px;max-width:640px;width:100%;box-shadow:0 8px 24px rgba(0,0,0,.2);">
          <div style="padding:14px 18px;border-bottom:1px solid #eee;font-weight:700;display:flex;justify-content:space-between;align-items:center;">
            <div>Hafta / Kitap Önizleme</div>
            <div style="font-size:12px;color:#666;">Seçilen: <span id="piyasaPickerSelected" style="font-weight:700;margin-left:6px;"></span></div>
          </div>
          <div style="padding:12px 18px;display:flex;gap:12px;align-items:center;">
            <label style="font-size:13px;color:#444;min-width:80px;">Kitap:</label>
            <select id="piyasaPickerSelect" style="flex:1;padding:8px;border:1px solid #ddd;border-radius:8px;"></select>
          </div>
          <div style="padding:0 18px 12px;display:flex;gap:12px;align-items:center;">
            <div style="flex:1;color:#333;">Tarih: <span id="piyasaPickerDate" style="font-weight:600;margin-left:6px;"></span></div>
            <div style="flex:1;text-align:right;color:#333;">Tahmini Sipariş: <span id="piyasaPickerCount" style="font-weight:600;margin-left:6px;"></span></div>
          </div>
          <div style="display:flex;justify-content:flex-end;padding:12px 18px;border-top:1px solid #eee;gap:10px;">
            <button id="piyasaPickerCancel" style="border:0;background:#eee;border-radius:8px;padding:8px 12px;cursor:pointer;">İptal</button>
            <button id="piyasaPickerOk" style="border:0;background:#111827;color:#fff;border-radius:8px;padding:8px 12px;cursor:pointer;">Tamam</button>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);

      const sel = overlay.querySelector('#piyasaPickerSelect');
      const dateEl = overlay.querySelector('#piyasaPickerDate');
      const countEl = overlay.querySelector('#piyasaPickerCount');
      const selectedLabel = overlay.querySelector('#piyasaPickerSelected');
      const okBtn = overlay.querySelector('#piyasaPickerOk');
      const cancelBtn = overlay.querySelector('#piyasaPickerCancel');

      // populate
      metas.forEach(m=>{
        const opt = document.createElement('option');
        opt.value = m.name;
        opt.textContent = `${m.name} — ${m.week}. hafta`;
        sel.appendChild(opt);
      });
      if (currentSheetName) sel.value = currentSheetName;

      function previewFor(name){
        try{
          const ws = wb.Sheets[name];
          const f = findDateInSheet(ws);
          const rawRows = parseSheetSmart(ws);
          const rows = normalizeRows(rawRows) || [];
          dateEl.textContent = f && f.date ? formatDateUTCAsLocalString(f.date) : '';
          countEl.textContent = String(rows.length || 0);
          selectedLabel.textContent = `${name}`;
          return { ws, rows, found: f };
        }catch(e){
          dateEl.textContent = '';
          countEl.textContent = '0';
          selectedLabel.textContent = name;
          return { ws: null, rows: [], found: null };
        }
      }

      sel.onchange = ()=> previewFor(sel.value);
      cancelBtn.onclick = ()=> overlay.remove();

      okBtn.onclick = ()=>{
        const name = sel.value;
        const p = previewFor(name);
        // set state from chosen sheet
        try{
          state.orders = p.rows;
          const wk = getWeekFromSheetName(name, wb) || state.week;
          state.week = wk;
          state.sheet = name;
          state.loadedAt = (p.found && p.found.date) ? p.found.date : new Date();
          if (state.orders && state.orders.length) saveState();
          toast(`✅ Piyasa yüklendi: ${name} • ${state.week}. hafta • ${state.orders.length} sipariş`, 'success');
        }catch(e){ console.error('picker apply failed', e); }
        overlay.remove();
        if (typeof onConfirm === 'function') onConfirm();
      };

      // initial preview
      setTimeout(()=> previewFor(sel.value), 0);
    }catch(e){ console.error('showWeekPickerModal error', e); if (typeof onConfirm === 'function') onConfirm(); }
  }

  function showWeekInfoModal(week, a, b, c){
    try{
      if (!week) { if (typeof b === 'function') b(); else if (typeof c === 'function') c(); return; }
      let foundDate = null;
      let year = null;
      let onClose = null;
      if (a && Object.prototype.toString.call(a) === '[object Date]'){
        foundDate = a;
        year = (typeof b === 'number') ? b : (state.loadedAt ? state.loadedAt.getFullYear() : (new Date()).getFullYear());
        onClose = c;
      } else {
        year = (typeof a === 'number') ? a : (state.loadedAt ? state.loadedAt.getFullYear() : (new Date()).getFullYear());
        onClose = b;
      }

      let rangeText = `${week}. hafta`;
      if (foundDate){
        rangeText = `${week}. hafta • ${formatDateUTCAsLocalString(foundDate)}`;
      } else {
        const start = getDateFromWeekYear(week, year);
        if (start){
          const end = new Date(start.getTime());
          end.setUTCDate(start.getUTCDate() + 6);
          rangeText = `${week}. hafta • ${formatDateUTCAsLocalString(start)} - ${formatDateUTCAsLocalString(end)}`;
        }
      }

      const overlay = document.createElement('div');
      overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.35);z-index:100000;display:flex;align-items:center;justify-content:center;padding:16px;';
      overlay.innerHTML = `
        <div style="background:#fff;border-radius:12px;max-width:520px;width:100%;box-shadow:0 8px 24px rgba(0,0,0,.2);">
          <div style="padding:16px 18px;border-bottom:1px solid #eee;font-weight:700;">Hafta Bilgisi</div>
          <div style="padding:14px 18px;font-size:14px;color:#222;">Seçilen: <div style='margin-top:8px;font-size:15px;font-weight:600;'>${escapeHtml(String(rangeText))}</div></div>
          <div style="display:flex;justify-content:flex-end;padding:12px 18px;border-top:1px solid #eee;">
            <button id="piyasaWeekInfoOk" style="border:0;background:#111827;color:#fff;border-radius:8px;padding:8px 12px;cursor:pointer;">Tamam</button>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);
      const close = ()=>{ try{ overlay.remove(); }catch(e){} if (typeof onClose === 'function') onClose(); };
      overlay.onclick = (e)=>{ if (e.target === overlay) close(); };
      const ok = overlay.querySelector('#piyasaWeekInfoOk');
      if (ok) ok.onclick = close;
    }catch(e){ if (typeof onClose === 'function') onClose(); }
  }

  async function loadPiyasaExcel(file){
    if (!file){
      alert('❌ Dosya seçilemedi.');
      return;
    }
    try {
      if (typeof window.ensureXlsxLoaded === 'function') await window.ensureXlsxLoaded();
    } catch (e) {
      alert('❌ XLSX kütüphanesi yüklenemedi.');
      return;
    }
    if (!window.XLSX){
      alert('❌ XLSX kütüphanesi yüklenmemiş.');
      return;
    }
    const ab = await file.arrayBuffer();
    const wb = XLSX.read(ab, {
      type: 'array',
      cellStyles: false,
      cellNF: false,
      cellText: false,
      dense: true
    });

    // Otomatik seçim: iki geçişli strateji
    // 1) Önce gerçek hücre tarihlerini topla (G1 vb.) ve bu tarihlerde en yaygın yılı bul
    // 2) Sonra sheet adından hafta numarası ile tarih türetirken bu yıl(ları) kullan — böylece
    //    tahminler rastgele bestDate'in yılına kaymaz.
    let bestSheet = null;
    let bestDate = null;

    const foundMap = {};
    const yearCounts = {};
    for (const name of (wb.SheetNames||[])){
      try{
        const ws = wb.Sheets[name];
        const found = findDateInSheet(ws);
        foundMap[name] = found || null;
        if (found && found.date){
          const y = found.date.getFullYear();
          yearCounts[y] = (yearCounts[y] || 0) + 1;
        }
      }catch(e){ foundMap[name] = null; }
    }

    // Determine base year for inference: prefer the most common year among real dates, otherwise current year
    let baseYear = (new Date()).getFullYear();
    const years = Object.keys(yearCounts);
    if (years.length){
      baseYear = parseInt(years.reduce((a,b)=> yearCounts[a] > yearCounts[b] ? a : b), 10);
    }

    for (const name of (wb.SheetNames||[])){
      try{
        const ws = wb.Sheets[name];
        const found = foundMap[name];
        let d = found ? found.date : null;
        let raw = found ? found.raw : null;
        let ref = found ? found.ref : 'G1';

        if (!d){
          const wk = getWeekFromSheetName(name, wb);
          if (wk){
            const inferred = getDateFromWeekYear(wk, baseYear);
            if (inferred){
              d = inferred;
              raw = null;
              ref = `WEEK(${wk})`;
            }
          }
        }

        try{  }catch(_){ }

        if (d && (!bestDate || d > bestDate)){
          bestDate = d;
          bestSheet = name;
        }
      }catch(e){ }
    }

    if (!bestSheet){
      // fallback: önceki haftaya dayalı seçim (uyumluluk)
      const metas = getSheetMetaForPicker(wb);
      if (!metas.length){
        alert('❌ Bu dosyada HAFTA sheet’i bulamadım (ör: 21.HAFTA) ve G1 tarihleri yok.');
        return;
      }
      // en büyük satır sayısına sahip sheet'i al
      const chosen = metas.sort((a,b)=> (b.count - a.count) || (b.orderIndex - a.orderIndex))[0];
      try{
        const ws = wb.Sheets[chosen.name];
        const rawRows = parseSheetSmart(ws);
        const orders = normalizeRows(rawRows);

        state.orders = orders;
        state.week = chosen.week;
        state.sheet = chosen.name;
        // prefer sheet G1 date if present
        const f = findDateInSheet(ws);
        state.loadedAt = (f && f.date) ? f.date : new Date();

        if (state.orders && state.orders.length) saveState();

        toast(`✅ Piyasa yüklendi: ${chosen.name} • ${chosen.week}. hafta • ${state.orders.length} sipariş`, 'success');
        // report event removed: EXCEL_PIYASA_LOADED

        if (!state.orders.length){
          alert('⚠️ Seçilen kitapta sipariş bulunamadı. (Filtre kuralları nedeniyle bazı satırlar atılmış olabilir.)');
          return;
        }
        // open picker modal that allows switching sheets (pass metas + wb)
        const metas = getSheetMetaForPicker(wb);
        showWeekPickerModal(metas, wb, state.sheet, openOrderPicker);
      }catch(e){
        console.error('Piyasa load failed', e);
        alert('❌ Seçilen kitabı okurken hata oluştu.');
      }
      return;
    }



    // Eğer G1 ile bir sheet seçildiyse, o sheet'i kullan
    try{
      const ws = wb.Sheets[bestSheet];
      const rawRows = parseSheetSmart(ws);
      const orders = normalizeRows(rawRows);
      const weekFromName = getWeekFromSheetName(bestSheet, wb);
      const week = weekFromName || (bestDate ? getWeekFromDate(bestDate) : null);

      state.orders = orders;
      state.week = week;
      state.sheet = bestSheet;
      // prefer bestDate (found from G1 earlier) for loadedAt
      state.loadedAt = bestDate || new Date();

      if (state.orders && state.orders.length) saveState();

      toast(`✅ Piyasa yüklendi: ${bestSheet} • ${week ? week + '. hafta' : 'hafta bilinmiyor'} • ${state.orders.length} sipariş`, 'success');
      // report event removed: EXCEL_PIYASA_LOADED

      if (!state.orders.length){
        alert('⚠️ Seçilen kitapta sipariş bulunamadı. (Filtre kuralları nedeniyle bazı satırlar atılmış olabilir.)');
        return;
      }
      const metas = getSheetMetaForPicker(wb);
      showWeekPickerModal(metas, wb, state.sheet || bestSheet, openOrderPicker);
    }catch(e){
      console.error('Piyasa load failed', e);
      alert('❌ Seçilen kitabı okurken hata oluştu.');
    }
  }

  function clearPiyasa(){
    state.orders = [];
    state.week = null;
    state.sheet = null;
    state.loadedAt = null;
    clearSavedState();
    try { window.refreshHeaderExcelInfo && window.refreshHeaderExcelInfo(); } catch(e) {}
  }

  function restorePiyasa(snapshot) {
    if (!snapshot) return false;
    state.orders = Array.isArray(snapshot.orders) ? snapshot.orders : [];
    state.week = snapshot.week != null ? snapshot.week : null;
    state.sheet = snapshot.sheet != null ? snapshot.sheet : null;
    state.loadedAt = snapshot.loadedAt ? new Date(snapshot.loadedAt) : null;
    if (state.orders.length) saveState();
    else clearSavedState();
    try { window.refreshHeaderExcelInfo && window.refreshHeaderExcelInfo(); } catch(e) {}
    return true;
  }

  async function handleClearPiyasaClick() {
    try { window.closeAppToolsMenu && window.closeAppToolsMenu(); } catch (e) {}
    const ui = window.rpUi || {};
    if (!state.orders.length) {
      if (typeof ui.alert === 'function') await ui.alert('PİYASA Excel verisi zaten boş.', 'info');
      else toast('Piyasa verisi zaten boş.', 'info');
      return;
    }
    let okDel = false;
    if (typeof ui.confirm === 'function') {
      okDel = await ui.confirm('PİYASA Excel verisi silinecek.\n\nDevam edilsin mi?', { okLabel: 'Sil' });
    } else {
      okDel = confirm('Piyasa verisini silmek istiyor musun?');
    }
    if (!okDel) return;

    const snapshot = {
      orders: JSON.parse(JSON.stringify(state.orders)),
      week: state.week,
      sheet: state.sheet,
      loadedAt: state.loadedAt ? state.loadedAt.toISOString() : null
    };
    clearPiyasa();

    let choice = 'ok';
    if (typeof ui.alertDeleteSuccess === 'function') {
      choice = await ui.alertDeleteSuccess({
        message: 'PİYASA Excel verisi silindi.',
        withUndo: true
      });
    } else {
      toast('Piyasa verisi temizlendi.', 'info');
    }
    if (choice === 'undo') {
      restorePiyasa(snapshot);
      if (typeof ui.alert === 'function') await ui.alert('PİYASA Excel verisi geri yüklendi.', 'success');
    }
  }

  function bind(){
    const uploadBtn = document.getElementById('piyasaExcelUploadButtonTop');
    const clearBtn = document.getElementById('piyasaExcelClearButtonTop');

    // Menü butonları
    if (uploadBtn && !uploadBtn.__piyasaBound){
      uploadBtn.__piyasaBound = true;
      uploadBtn.addEventListener('click', ()=>{
        try { window.closeAppToolsMenu && window.closeAppToolsMenu(); } catch (e) {}
        const inp = ensureHiddenFileInput('piyasaExcelInputHidden');
        inp.onchange = ()=> {
          const f = inp.files && inp.files[0];
          inp.value = '';
          loadPiyasaExcel(f);
        };
        // Safari vb. için güvenli click
        try { inp.showPicker ? inp.showPicker() : inp.click(); } catch(e){ inp.click(); }
      });
      console.log('✅ Piyasa: UPLOAD button bağlandı');
    }

    if (clearBtn && !clearBtn.__piyasaBound){
      clearBtn.__piyasaBound = true;
      clearBtn.addEventListener('click', () => { handleClearPiyasaClick(); });
      console.log('✅ Piyasa: CLEAR button bağlandı');
    }

    if (!document.__piyasaDelegatedBound) {
      document.__piyasaDelegatedBound = true;
      document.addEventListener('click', (e)=>{
        const target = e.target.closest('#piyasaExcelUploadButtonTop, #piyasaExcelClearButtonTop');
        if (!target) return;
        if (target.id === 'piyasaExcelUploadButtonTop'){
          e.preventDefault();
          e.stopPropagation();
          try { window.closeAppToolsMenu && window.closeAppToolsMenu(); } catch (err) {}
          const inp = ensureHiddenFileInput('piyasaExcelInputHidden');
          inp.onchange = ()=> {
            const f = inp.files && inp.files[0];
            inp.value = '';
            loadPiyasaExcel(f);
          };
          try { inp.showPicker ? inp.showPicker() : inp.click(); } catch(err){ inp.click(); }
          return;
        }
        if (target.id === 'piyasaExcelClearButtonTop'){
          e.preventDefault();
          e.stopPropagation();
          handleClearPiyasaClick();
        }
      }, true);
    }
    
    // ✅ Debug: Butonlar tam olarak bağlandı mı kontrol et
    if (!uploadBtn && window.location.href.includes('GIRIS')) {
      console.warn('⚠️ Piyasa: #piyasaExcelUploadButtonTop bulunamadı!');
    }
    if (!clearBtn && window.location.href.includes('GIRIS')) {
      console.warn('⚠️ Piyasa: #piyasaExcelClearButtonTop bulunamadı!');
    }

    // "Bul" butonunu PİYASA modunda sipariş seçtirir yap
    const firmaAraBtn = document.getElementById('firmaAraBtn');
    if (firmaAraBtn && !firmaAraBtn.__piyasaHijacked){
      firmaAraBtn.__piyasaHijacked = true;
      firmaAraBtn.addEventListener('click', (e)=>{
        if (state.orders && state.orders.length){
          e.preventDefault();
          e.stopImmediatePropagation();
          openOrderPicker();
        }
      }, true); // capture: önce biz
    }

    const malzemeAraBtn = document.getElementById('malzemeAraBtn');
    if (malzemeAraBtn && !malzemeAraBtn.__piyasaHijacked){
      malzemeAraBtn.__piyasaHijacked = true;
      malzemeAraBtn.addEventListener('click', (e)=>{
        if (state.orders && state.orders.length){
          e.preventDefault();
          e.stopImmediatePropagation();
          openOrderPicker();
        }
      }, true);
    }
  }

  // init: UI render edildikten sonra butonlar geliyor, o yüzden kısa süre poll.
  function init(){
    if (window.__piyasaInitStarted) return;
    window.__piyasaInitStarted = true;
    // Sayfa yenilense bile piyasa verisini geri al
    const restored = loadState();
    if (restored){
      toast(`✅ Piyasa verisi geri yüklendi (${state.orders.length} satır)`, 'success');
      // Sayfa yenilendiğinde de header bilgisi doğru görünsün
      try { window.refreshHeaderExcelInfo && window.refreshHeaderExcelInfo(); } catch(e) {}
    }

    console.log('🔵 Piyasa init başladı - butonları arayacak...');
    
    let tries = 0;
    let boundSuccess = false;
    
    const t = setInterval(()=>{
      tries++;
      bind();
      const uploadBtn = document.getElementById('piyasaExcelUploadButtonTop');
      
      if (uploadBtn && uploadBtn.__piyasaBound && !boundSuccess) {
        console.log('✅ Piyasa init: Başarıyla bağlandı (try #' + tries + ')');
        boundSuccess = true;
        clearInterval(t);
        return;
      }
      
      if (tries > 200) {
        // 200 * 100ms = 20 saniye timeout
        console.error('❌ Piyasa init: HATA - 20 saniye sonra butonlar hala bulunamadı. Sayfayı yenileyin!');
        clearInterval(t);
      }
    }, 100); // ✅ Daha hızlı polling (250ms -> 100ms)
  }

  
  // Dışarıya minimal API aç (app.js Bul butonu buradan çağıracak)
  window.piyasa = window.piyasa || {};
  window.piyasa.hasOrders = ()=> (state.orders && state.orders.length > 0);
  window.piyasa.openOrderPicker = openOrderPicker;
  window.piyasa.applyOrderToForm = applyOrderToForm;
  window.piyasa._state = state;

  // Chip'ten çağrılmak için modal açma fonksiyonu
  window.piyasaShowOrdersModal = function() {
    if (state.orders && state.orders.length > 0) {
      openOrderPicker();
    }
  };

window.initPiyasaModule = init;
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
  document.addEventListener('DOMContentLoaded', init);
})();
