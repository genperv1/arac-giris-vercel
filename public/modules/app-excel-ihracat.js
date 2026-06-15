// app-excel-ihracat.js — günlük Excel / ihracat
// Otomatik bölüm — scripts/split-large-files.js

// =========================
// 📄 Günlük Excel Sevkiyat Import (offline uyumlu)
// - XLSX: ilk kullanımda ensureXlsxLoaded() ile yüklenir (asset-loader.js + CDN)
// - Login'e dokunmaz, sadece ana ekranda butonlarla çalışır.
// =========================
function _nz(v) {
  if (v == null) return '';
  const s = String(v).trim();
  if (!s) return '';
  // 0 / 0,0 / 0.0 gibi değerleri boş say
  const norm = s.replace(',', '.');
  if (norm === '0' || norm === '0.0' || norm === '0.00') return '';
  return s;
}

/** İhracat Excel: A sütunundaki R11… irsaliye numarası (başlık satırında "İRSALİYE NO" olmayabilir) */
function looksLikeIrsaliyeNo(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return false;
  if (/^YD\d+/i.test(s)) return false;
  if (/^(SIRANO|PLAKA|TOPLAM|KALAN)$/i.test(s)) return false;
  const compact = s.replace(/\s+/g, '');
  return /^(R\d{1,3})\d{6,12}$/i.test(compact) || /^R\d{1,3}\s+\d{6,12}$/i.test(s);
}

function normalizeIrsaliyeNo(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  const compact = s.replace(/\s+/g, '');
  if (!/^R\d{7,15}$/i.test(compact)) return s;

  const digitsOnly = compact.slice(1);
  const candidates = [];
  for (let prefixLen = 1; prefixLen <= 3; prefixLen++) {
    const numLen = digitsOnly.length - prefixLen;
    if (numLen >= 6 && numLen <= 12) {
      candidates.push({
        prefix: 'R' + digitsOnly.slice(0, prefixLen),
        num: digitsOnly.slice(prefixLen),
      });
    }
  }
  if (!candidates.length) return s;

  const score = (c) => {
    let sc = 0;
    if (/^R\d{2}$/i.test(c.prefix)) sc += 100;
    else if (/^R\d{1}$/i.test(c.prefix)) sc += 50;
    if (/^0/.test(c.num)) sc -= 80;
    if (/^20\d{6}$/.test(c.num)) sc += 60;
    if (c.num.length === 8) sc += 30;
    if (c.num.length === 10) sc += 20;
    return sc;
  };
  candidates.sort((a, b) => score(b) - score(a));
  const best = candidates[0];
  return `${best.prefix.toUpperCase()} ${best.num}`;
}

function resolveIrsaliyeFromRow(d, cols) {
  const row = d || [];
  if (cols && cols.irsaliyeNo !== undefined) {
    const fromCol = row[cols.irsaliyeNo];
    if (fromCol != null && String(fromCol).trim()) {
      const n = normalizeIrsaliyeNo(fromCol);
      if (n) return n;
    }
  }
  const a0 = row[0];
  if (a0 != null && looksLikeIrsaliyeNo(a0)) return normalizeIrsaliyeNo(a0);
  return '';
}

function getShipmentIrsaliyeNo(shipment) {
  if (!shipment) return '';
  const direct = normalizeIrsaliyeNo(shipment.irsaliyeNo);
  if (direct) return direct;
  const fromId = String(shipment.id || '').trim();
  if (looksLikeIrsaliyeNo(fromId)) return normalizeIrsaliyeNo(fromId);
  return '';
}

function irsaliyeCollisionKey(raw) {
  const n = normalizeIrsaliyeNo(raw);
  if (n) return n.replace(/\s+/g, ' ').trim().toUpperCase();
  return String(raw || '').replace(/\s+/g, ' ').trim().toUpperCase();
}

function getIrsaliyeCollisionInfo(rows) {
  const eu = window.ExcelUtils || {};
  const collisions = eu.findIrsaliyeCollisions ? eu.findIrsaliyeCollisions(rows || []) : [];
  const set = new Set();
  collisions.forEach((c) => {
    const k = irsaliyeCollisionKey(c.irsaliyeNo);
    if (k) set.add(k);
  });
  return { collisions, set };
}

function shipmentHasIrsaliyeCollision(shipment, collisionSet) {
  if (!collisionSet || !collisionSet.size || !shipment) return false;
  const k = irsaliyeCollisionKey(getShipmentIrsaliyeNo(shipment));
  return !!k && collisionSet.has(k);
}

function plateCollisionKey(raw) {
  const p = String(raw || '').trim();
  if (!p) return '';
  return p.replace(/\s+/g, '').toUpperCase();
}

function getDuplicatePlateInfo(rows) {
  const eu = window.ExcelUtils || {};
  const dupPlateRows = eu.findDuplicatePlateRows ? eu.findDuplicatePlateRows(rows || []) : [];
  const set = new Set();
  const byKey = new Map();
  dupPlateRows.forEach((d) => {
    const k = plateCollisionKey(d.plaka);
    if (k) {
      set.add(k);
      byKey.set(k, d);
    }
  });
  return { dupPlateRows, set, byKey };
}

function shipmentHasDuplicatePlate(shipment, collisionSet) {
  if (!collisionSet || !collisionSet.size || !shipment) return false;
  const k = plateCollisionKey(shipment.plaka);
  return !!k && collisionSet.has(k);
}

const IHR_IRS_COLLISION_CELL_STYLE = 'background:#111210;color:#FFBF00;font-weight:bold;';

function detectIrsaliyeColumnIndex(grid, headerRowIdx, cols) {
  if (cols.irsaliyeNo !== undefined) return cols.irsaliyeNo;
  const candidates = [0];
  if (cols.sirano !== undefined && cols.sirano > 0) candidates.push(cols.sirano - 1);
  for (const c of candidates) {
    for (let r = headerRowIdx + 1; r < Math.min(grid.length, headerRowIdx + 25); r++) {
      const row = grid[r] || [];
      if (looksLikeIrsaliyeNo(row[c])) return c;
    }
  }
  return undefined;
}

const DAILY_SHIPMENT_KEY = 'daily_shipments_current';

// ✅ Firma bazlı düzeltme hafızası (özellikle Sevk Yeri / Liman)
const FIRMA_OVERRIDE_KEY = 'firmaOverrides_v1';
function _normFirmaKey(f){
  return String(f || '').trim().toUpperCase();
}
function loadFirmaOverrides(){
  try{
    const obj = JSON.parse(localStorage.getItem(FIRMA_OVERRIDE_KEY) || '{}');
    return (obj && typeof obj === 'object') ? obj : {};
  }catch(e){ return {}; }
}
function saveFirmaOverrides(map){
  try{ localStorage.setItem(FIRMA_OVERRIDE_KEY, JSON.stringify(map || {})); return true; }catch(e){ return false; }
}
function getFirmaOverride(firma){
  const key = _normFirmaKey(firma);
  if (!key) return null;
  const map = loadFirmaOverrides();
  return map[key] || null;
}
function setFirmaOverride(firma, patch){
  const key = _normFirmaKey(firma);
  if (!key) return false;
  const map = loadFirmaOverrides();
  const cur = (map[key] && typeof map[key] === 'object') ? map[key] : {};
  map[key] = { ...cur, ...(patch || {}), updatedAt: new Date().toISOString() };
  return saveFirmaOverrides(map);
}
function applyFirmaOverridesToShipment(sh){
  if (!sh) return sh;
  const firma = sh.firma || sh.ydKey || '';
  const ov = getFirmaOverride(firma);
  if (!ov) return sh;
  const out = { ...sh };
  if (ov.sevkYeri && String(ov.sevkYeri).trim()) out.sevkYeri = String(ov.sevkYeri).trim();
  if (ov.ambalaj && String(ov.ambalaj).trim()) out.ambalaj = String(ov.ambalaj).trim();
  return out;
}

const DAILY_SHIPMENT_META = 'daily_shipments_meta';

// TR plaka normalize (eşleştirme için) -> "43ADD516" == "43 ADD 516"
function normPlate(v) {
  return formatPlakaForInput(String(v || '')).replace(/\s+/g, ' ').trim();
}

function _plateKeyForMatch(p) {
  return String(p || '').toLowerCase().replace(/[\s-]+/g, '');
}

function clearActiveTakipVehicleRefs() {
  try { window.__activeTakipVehicleId = ''; } catch (e) {}
  try { window.__activeTakipVehiclePlate = ''; } catch (e) {}
  try { window.__activeTakipVehicle = null; } catch (e) {}
}

function resolveTakipVehicleIdForPrint(plate, hintId) {
  const pid = String(plate || '').trim();
  const hint = String(hintId || '').trim();
  const vehicles = (typeof state !== 'undefined' && state && Array.isArray(state.vehicles)) ? state.vehicles : [];

  if (hint && hint !== 'manual') {
    const byHint = vehicles.find((v) => String(v.id) === hint);
    if (byHint) return String(byHint.id);
  }

  if (pid) {
    const key = _plateKeyForMatch(pid);
    const byPlate = vehicles.find((v) => {
      const plates = [v.cekiciPlaka, v.dorsePlaka, v.plaka].filter(Boolean);
      return plates.some((p) => _plateKeyForMatch(p) === key);
    });
    if (byPlate && byPlate.id) return String(byPlate.id);
  }

  if (hint && hint !== 'manual') return hint;
  return 'manual';
}

/** Takip formu: tek satırlık şoför adını ad/soyad alanlarına ayırır */
function splitSoforFullName(full) {
  const s = String(full || '').trim().replace(/\s+/g, ' ');
  if (!s) return { soforAdi: '', soforSoyadi: '' };
  const parts = s.split(' ');
  if (parts.length === 1) return { soforAdi: parts[0], soforSoyadi: '' };
  return { soforAdi: parts.slice(0, -1).join(' '), soforSoyadi: parts[parts.length - 1] };
}

/** Takip formundaki şoför alanlarını oku (yazdırma / rapor için) */
function getTakipFormDriverPayload() {
  const formGet = (id) => {
    try { return (document.getElementById(id)?.value || '').trim(); } catch (e) { return ''; }
  };
  const full = formGet('soforBilgi');
  const split = splitSoforFullName(full);
  let phone = formGet('iletisimBilgi');
  try { phone = formatTRPhone(phone); } catch (e) { /* ignore */ }
  return {
    sofor: full,
    soforAdi: split.soforAdi,
    soforSoyadi: split.soforSoyadi,
    tcKimlik: formGet('tcBilgi'),
    iletisim: phone,
    dorsePlaka: formGet('dorsePlakaBilgi'),
  };
}

function driverFieldsFromSnapshot(snap) {
  const s = snap && typeof snap === 'object' ? snap : {};
  const full = String(s.sofor || '').trim()
    || [s.soforAdi, s.soforSoyadi].filter(Boolean).join(' ').trim();
  const split = (s.soforAdi || s.soforSoyadi)
    ? { soforAdi: String(s.soforAdi || '').trim(), soforSoyadi: String(s.soforSoyadi || '').trim() }
    : splitSoforFullName(full);
  return {
    sofor: full,
    soforAdi: split.soforAdi,
    soforSoyadi: split.soforSoyadi,
    tcKimlik: String(s.tcKimlik || '').trim(),
    iletisim: String(s.iletisim || '').trim(),
    dorsePlaka: String(s.dorsePlaka || '').trim(),
  };
}

function _isIhracatPrintContext(pending) {
  if (pending && pending.fromIhracat) return true;
  try {
    if (window.__ihracatActivePrintShipment) return true;
    const ch = window.__activeExcelShipment || window.__lastChosenShipment;
    if (ch && (ch.blockMeta || ch.headerText || ch._ihracatEdited)) return true;
    if (document.getElementById('ihracatDetailsModal') || window.__ihracatParkedDetailsModal) return true;
  } catch (e) { /* ignore */ }
  try {
    const note = String(document.getElementById('yuklemeNotu')?.value || '').trim();
    if (window.isIhracatFormContext && window.isIhracatFormContext(note)) return true;
  } catch (e) { /* ignore */ }
  return false;
}

/** print.js ile aynı anda okunan değerler — rapor = kağıttaki (WYSIWYG) */
function captureTakipPrintPayloadForReport(get) {
  const g = typeof get === 'function'
    ? get
    : (id) => {
      try { return (document.getElementById(id)?.value || '').trim(); } catch (e) { return ''; }
    };
  const excel = window.__ihracatActivePrintShipment
    || window.__activeExcelShipment
    || window.__lastChosenShipment
    || null;
  const firmaForm = g('firmaKodu') || g('firmaSelect');
  const malzemeForm = g('malzeme') || g('malzemeSelect');
  const firma = String(
    firmaForm
    || (excel && String(excel.firma || '').trim())
    || _takipFirmaFromExcelContext()
    || ''
  ).trim();
  const malzeme = String(
    malzemeForm
    || (excel && String(excel.malzeme || '').trim())
    || ''
  ).trim();
  const driver = getTakipFormDriverPayload();
  return {
    firma,
    firmaKodu: firma,
    firmaSelect: g('firmaSelect'),
    malzeme,
    sevkYeri: g('sevkYeri') || String(excel?.sevkYeri || '').trim(),
    basimYeri: g('basimYeri'),
    tonaj: g('tonaj') || String(excel?.tonajKg ?? '').trim(),
    ambalajBilgisi: g('ambalajBilgisi'),
    yuklemeNotu: g('yuklemeNotu'),
    yuklemeSirasi: g('yuklemeSirasi'),
    plaka: g('cekiciPlakaBilgi'),
    sofor: driver.sofor,
    soforAdi: driver.soforAdi,
    soforSoyadi: driver.soforSoyadi,
    tcKimlik: driver.tcKimlik,
    iletisim: driver.iletisim,
    dorsePlaka: driver.dorsePlaka || g('dorsePlakaBilgi'),
    excelShipmentKey: (() => {
      try { return excel ? _ihracatShipmentKey(excel) : ''; } catch (e) { return ''; }
    })(),
  };
}

function applyPiyasaOrderToPrintEvent(printEv, pending) {
  if (!printEv || !pending || pending.piyasaOrderIdx == null) return printEv;
  if (_isIhracatPrintContext(pending)) return printEv;
  try {
    const o = window.piyasa && typeof window.piyasa.getOrderByIdx === 'function'
      ? window.piyasa.getOrderByIdx(pending.piyasaOrderIdx)
      : null;
    if (!o) return printEv;
    const snapFirma = String(printEv.firmaKodu || printEv.firma || '').trim();
    const f = String(o.firma || '').trim();
    const m = String(o.malzeme || '').trim();
    const sehir = String(o.il || o.sevkYeri || '').trim();
    const yuk = String(o.yuklemeTuru || '').trim();
    if (f && (!snapFirma || snapFirma === f)) {
      printEv.firma = f;
      printEv.firmaKodu = f;
    }
    if (m) printEv.malzeme = m;
    if (sehir) printEv.sevkYeri = sehir;
    if (yuk) {
      printEv.yuklemeTuru = yuk;
      if (!String(printEv.ambalajBilgisi || '').trim()) printEv.ambalajBilgisi = yuk;
    }
  } catch (e) { /* ignore */ }
  return printEv;
}

function buildPrintHistoryPostBody(printEv, pending, commitTs) {
  const yuk = String(printEv.yuklemeTuru || printEv.ambalajBilgisi || '').trim();
  return {
    plaka: printEv.plaka,
    firma: printEv.firma || printEv.firmaKodu || '',
    malzeme: printEv.malzeme || '',
    tonaj: printEv.tonaj || '',
    basim_yeri: printEv.basimYeri || '',
    sevkiyat_id: piyasaSevkiyatIdForPrint(pending),
    sofor: printEv.sofor || '',
    sevk_yeri: String(printEv.sevkYeri || '').trim(),
    yukleme_turu: yuk,
    tarih: commitTs,
  };
}

function piyasaSevkiyatIdForPrint(pending) {
  if (pending && pending.fromIhracat) {
    const key = pending.printPayload?.excelShipmentKey
      || (() => {
        try {
          const sh = window.__ihracatActivePrintShipment || window.__activeExcelShipment;
          return sh ? _ihracatShipmentKey(sh) : '';
        } catch (e) { return ''; }
      })();
    if (key) return 'ihracat:' + key;
  }
  if (pending && pending.piyasaOrderIdx != null) {
    try {
      const o = window.piyasa && typeof window.piyasa.getOrderByIdx === 'function'
        ? window.piyasa.getOrderByIdx(pending.piyasaOrderIdx)
        : null;
      const pickKey = o && (o._pickKey || o.__archiveKey);
      if (pickKey) return 'piyasa:' + String(pickKey);
    } catch (e) { /* ignore */ }
    return 'piyasa:' + String(pending.piyasaOrderIdx);
  }
  try {
    return (pending && pending.snapshot && pending.snapshot.sevkiyatId) || '';
  } catch (e) {
    return '';
  }
}

/** İhracat / Excel bağlamından firma (YD…); HP2 gibi rota kodları firma sayılmaz */
function _takipFirmaFromExcelContext() {
  try {
    const ch = window.__ihracatActivePrintShipment
      || window.__activeExcelShipment
      || window.__lastChosenShipment;
    if (!ch) return '';
    const direct = String(ch.firma || '').trim();
    if (direct && /\bYD\d{1,4}\b/i.test(direct)) return direct;
    if (direct && !/^HP\d/i.test(direct)) return direct;
    const fromHeader = _extractFirmaKod(ch.headerText || '');
    if (fromHeader) return fromHeader;
    const yd = String(ch.ydKey || '').trim();
    return /\bYD\d{1,4}\b/i.test(yd) ? yd : '';
  } catch (e) {
    return '';
  }
}

/** Yazdır onayı öncesi: bekleyen snapshot = ekrandaki takip formu (eski defaultFirma ezmesin) */
function refreshPendingPrintSnapshotFromForm(pending) {
  if (!pending) return;
  const get = (id) => {
    try { return (document.getElementById(id)?.value || '').trim(); } catch (e) { return ''; }
  };
  const prev = (pending.snapshot && typeof pending.snapshot === 'object') ? pending.snapshot : {};
  const excelFirma = _takipFirmaFromExcelContext();
  pending.snapshot = Object.assign({}, prev, {
    firmaKodu: get('firmaKodu') || prev.firmaKodu || excelFirma,
    firmaSelect: get('firmaSelect') || prev.firmaSelect,
    malzeme: get('malzeme') || prev.malzeme,
    malzemeSelect: get('malzemeSelect') || prev.malzemeSelect,
    sevkYeri: get('sevkYeri') || prev.sevkYeri,
    ambalajBilgisi: get('ambalajBilgisi') || prev.ambalajBilgisi,
    tonaj: get('tonaj') || prev.tonaj,
    yuklemeNotu: get('yuklemeNotu') || prev.yuklemeNotu,
    yuklemeSirasi: get('yuklemeSirasi') || prev.yuklemeSirasi,
    basimYeri: get('basimYeri') || prev.basimYeri || pending.basimYeri,
  }, getTakipFormDriverPayload());
}

function buildPrintEventDataFromPending(pending, vehicle, printCount, tarihTr) {
  refreshPendingPrintSnapshotFromForm(pending);
  const snap = (pending && pending.snapshot) || {};
  const pp = (pending && pending.printPayload && typeof pending.printPayload === 'object')
    ? pending.printPayload
    : null;
  const formGet = (id) => {
    try { return (document.getElementById(id)?.value || '').trim(); } catch (e) { return ''; }
  };
  const driver = driverFieldsFromSnapshot(pp || snap);
  if (!driver.sofor) {
    try {
      const live = getTakipFormDriverPayload();
      if (live.sofor) Object.assign(driver, live);
    } catch (e) { /* ignore */ }
  }

  const plaka = String(
    pending?.plaka || pp?.plaka || vehicle?.cekiciPlaka || formGet('cekiciPlakaBilgi') || ''
  ).trim();
  const excelFirma = _takipFirmaFromExcelContext();
  const excel = window.__ihracatActivePrintShipment
    || window.__activeExcelShipment
    || window.__lastChosenShipment
    || null;

  // ✅ Rapor: yazdır tıklanınca kilitlenen printPayload (kağıt = modal = rapor)
  const firma = String(
    pp?.firma || pp?.firmaKodu
    || formGet('firmaKodu') || formGet('firmaSelect')
    || snap.firmaKodu || snap.firmaSelect || snap.firma
    || (excel && String(excel.firma || '').trim())
    || excelFirma
    || (_isIhracatPrintContext(pending) ? '' : (vehicle?.defaultFirma || ''))
  ).trim();
  const malzeme = String(
    pp?.malzeme
    || formGet('malzeme') || formGet('malzemeSelect')
    || snap.malzeme || snap.malzemeSelect
    || (excel && String(excel.malzeme || '').trim())
    || (_isIhracatPrintContext(pending) ? '' : (vehicle?.defaultMalzeme || ''))
  ).trim();

  return {
    vehicleId: vehicle?.id ? String(vehicle.id) : String(pending?.vehicleId || 'manual'),
    plaka,
    plate: plaka,
    firma,
    firmaKodu: firma,
    firmaSelect: String(pp?.firmaSelect || formGet('firmaSelect') || snap.firmaSelect || '').trim(),
    malzeme,
    sevkYeri: String(
      pp?.sevkYeri || formGet('sevkYeri') || snap.sevkYeri
      || (excel && String(excel.sevkYeri || '').trim())
      || (_isIhracatPrintContext(pending) ? '' : (vehicle?.defaultSevkYeri || ''))
    ).trim(),
    basimYeri: String(pp?.basimYeri || snap.basimYeri || pending?.basimYeri || formGet('basimYeri') || '').trim(),
    tonaj: String(pp?.tonaj || snap.tonaj || formGet('tonaj') || '').trim(),
    yuklemeSirasi: String(pending?.yuklemeSirasi || pp?.yuklemeSirasi || snap.yuklemeSirasi || formGet('yuklemeSirasi') || '').trim(),
    printCount: printCount || 1,
    tarih: tarihTr || '',
    kantar: formGet('imzaKantarAd'),
    ambalajBilgisi: String(pp?.ambalajBilgisi || snap.ambalajBilgisi || formGet('ambalajBilgisi') || '').trim(),
    yuklemeNotu: String(pp?.yuklemeNotu || snap.yuklemeNotu || formGet('yuklemeNotu') || '').trim(),
    sofor: pp?.sofor || driver.sofor,
    soforAdi: pp?.soforAdi || driver.soforAdi,
    soforSoyadi: pp?.soforSoyadi || driver.soforSoyadi,
    tcKimlik: pp?.tcKimlik || driver.tcKimlik,
    iletisim: pp?.iletisim || driver.iletisim,
    dorsePlaka: pp?.dorsePlaka || driver.dorsePlaka || String(snap.dorsePlaka || formGet('dorsePlakaBilgi') || '').trim(),
    ts: pending?.nowTs || Date.now(),
  };
}

function _todayKeyTR() {
  try {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth()+1).padStart(2,'0');
    const dd = String(d.getDate()).padStart(2,'0');
    return `${yyyy}-${mm}-${dd}`;
  } catch(e){ return 'unknown'; }
}

function findShipmentHeaderText(grid, rowIdx) {
  // ✅ En yakın header'ı al (yanlış sevkiyat bloğundan seçim yapmayı engeller)
  // Header satırı genelde '/' içerir ve NET ... KG veya BOOKING/GEMİ gibi işaretler taşır.
  const start = Math.max(0, rowIdx - 25);

  for (let r = rowIdx; r >= start; r--) {
    const row = grid[r] || [];
    const maxC = Math.min(row.length, 80);

    for (let c = 0; c < maxC; c++) {
      const v = row[c];
      if (v === null || v === undefined || v === '') continue;

      const s = String(v).trim();
      if (!s.includes('/')) continue;

      if (
        /NET\s*\d+\s*KG/i.test(s) ||
        /BOOKING\s*NO/i.test(s) ||
        /GEM[İI]\s*DETAYI/i.test(s)
      ) {
        return s;
      }
    }
  }
  return '';
}

function colIndexToLetter(idx) {
  let n = Number(idx);
  if (Number.isNaN(n) || n < 0) return '';
  let s = '';
  while (n >= 0) {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  }
  return s;
}

function getSheetCellValue(ws, colIndex, rowNumber) {
  if (!ws || rowNumber == null || colIndex == null) return '';
  const colLetter = (typeof colIndex === 'number') ? colIndexToLetter(colIndex) : String(colIndex).toUpperCase();
  if (!colLetter) return '';
  const addr = `${colLetter}${rowNumber}`;
  const cell = ws[addr];
  if (!cell) return '';
  return String(cell.v != null ? cell.v : '').trim();
}

function extractFirmaTextFromN(ws, rowNumber, maxRowsBack = 40) {
  try {
    if (!ws || !rowNumber) return '';

    // N sütunu = 13. index
    for (let r = rowNumber; r >= Math.max(1, rowNumber - maxRowsBack); r--) {
      const raw = getSheetCellValue(ws, 13, r); // N sütunu
      if (!raw) continue;

      const text = String(raw).replace(/\s+/g, ' ').trim();
      if (!text) continue;

      // YD ile başlayan N hücresini tam al
      if (/\bYD\d{1,4}\b/i.test(text)) {
        return text;
      }
    }

    return '';
  } catch (e) {
    return '';
  }
}

function findNearestSheetColumnValue(ws, startRow, colIndex, maxRowsBack = 40, predicate) {
  const endRow = Math.max(1, startRow - maxRowsBack);
  for (let r = startRow; r >= endRow; r--) {
    const val = getSheetCellValue(ws, colIndex, r);
    if (!val) continue;
    if (typeof predicate === 'function') {
      if (predicate(val)) return val;
      continue;
    }
    return val;
  }
  return '';
}

function findNearestColumnValue(grid, rowIdx, colIndex, maxRowsBack = 25) {
  const start = Math.max(0, rowIdx);
  const end = Math.max(0, rowIdx - maxRowsBack);
  for (let r = start; r >= end; r--) {
    const row = grid[r] || [];
    if (colIndex >= 0 && colIndex < row.length) {
      const raw = row[colIndex];
      if (raw !== null && raw !== undefined) {
        const text = String(raw).trim();
        if (text) return text;
      }
    }
    // Eğer N sütunu doğrudan boşsa, aynı satırda YD içeren değeri de bulmaya çalış
    for (let c = 0; c < row.length; c++) {
      const raw = row[c];
      if (raw === null || raw === undefined) continue;
      const text = String(raw).trim();
      if (!text) continue;
      if (/\bYD\d{1,4}\b/i.test(text)) return text;
    }
  }
  return '';
}

function saveDailyShipments(rows, meta) {
  try {
    // DailyStore: memory + localStorage (bu PC'ye özel, sunucu paylaşımı yok)
    if (window.DailyStore && typeof DailyStore.set === 'function') {
      DailyStore.set(rows || [], meta || {});
      return true;
    }
    localStorage.setItem(DAILY_SHIPMENT_KEY, JSON.stringify(rows || []));
    localStorage.setItem(DAILY_SHIPMENT_META, JSON.stringify(meta || {}));
    return true;
  } catch(e){ return false; }
}

function loadDailyShipments() {
  try {
    if (window.DailyStore && typeof DailyStore.getRows === 'function') {
      return DailyStore.getRows() || [];
    }
    const rows = JSON.parse(localStorage.getItem(DAILY_SHIPMENT_KEY) || '[]');
    return Array.isArray(rows) ? rows : [];
  } catch(e){ return []; }
}

function hasDailyExcelLoaded(){
  try { return (loadDailyShipments() || []).length > 0; }
  catch(e){ return false; }
}

function loadDailyMeta() {
  try {
    if (window.DailyStore && typeof DailyStore.getMeta === 'function') {
      return DailyStore.getMeta() || {};
    }
    return JSON.parse(localStorage.getItem(DAILY_SHIPMENT_META) || '{}') || {};
  } catch(e){ return {}; }
}

async function clearDailyShipments() {
  try {
    if (window.DailyStore && typeof DailyStore.clear === 'function') {
      return await DailyStore.clear();
    }
    localStorage.removeItem(DAILY_SHIPMENT_KEY);
    localStorage.removeItem(DAILY_SHIPMENT_META);
    return true;
  } catch(e){ return false; }
}

// Header Excel durum yazıları için ortak formatter
function _getExcelStatusInfo(){
  const out = {
    ihrCount: 0,
    ihrLine: '-',
    piyCount: 0,
    piyLine: '-',
  };

  // İHRACAT
  try {
    const meta = (typeof loadDailyMeta === 'function') ? (loadDailyMeta() || {}) : {};
    const cnt  = (typeof loadDailyShipments === 'function') ? ((loadDailyShipments() || []).length || 0) : 0;
    out.ihrCount = cnt;
    if (meta && meta.fileName) out.ihrLine = `${meta.fileName} • ${cnt} kayıt`;
    else if (cnt) out.ihrLine = `${cnt} kayıt`;
  } catch(e) {}

  // PİYASA
  try {
    const raw = localStorage.getItem('piyasa_state_v1');
    if (raw) {
      const piy = JSON.parse(raw) || {};
      const cnt = Array.isArray(piy.orders) ? piy.orders.length : 0;
      out.piyCount = cnt;
      // Format: haftabilgisi/tarih/kayıtsayısı
      try {
        let weekInfo = '-';
        if (piy) {
          if (piy.week) weekInfo = piy.week;
          else if (piy.sheet) weekInfo = piy.sheet;
        }
        let dateStr = '-';
        if (piy && piy.loadedAt) {
          const dt = new Date(piy.loadedAt);
          if (!isNaN(dt)) {
            const d = ('0' + dt.getDate()).slice(-2);
            const m = ('0' + (dt.getMonth() + 1)).slice(-2);
            const y = dt.getFullYear();
            dateStr = `${d}.${m}.${y}`;
          }
        }
        out.piyLine = `${weekInfo}.Hafta/${dateStr}`;
      } catch(e) {
        if (cnt) out.piyLine = `${cnt} satır`;
      }
    }
  } catch(e) {}

  // Hafta uyumu (piyasa vs ihracat)
  try {
    const piyRaw = localStorage.getItem('piyasa_state_v1');
    if (piyRaw) {
      const piy = JSON.parse(piyRaw) || {};
      const eu = window.ExcelUtils || {};
      if (eu.compareExcelWeeks) {
        const meta = (typeof loadDailyMeta === 'function') ? loadDailyMeta() : {};
        const resolvedMeta = { ...meta, dateKey: _resolveIhracatDateKey(meta) || meta.dateKey };
        out.warnings = (out.warnings || []).concat(eu.compareExcelWeeks(resolvedMeta, piy));
      }
    }
  } catch (e) {}

  return out;
}

function _formatDateKeyTR(dateKey) {
  const s = String(dateKey || '').trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return s || '-';
  return `${m[3]}.${m[2]}.${m[1]}`;
}

/** İHRACAT uyarı bandı — header chip ile aynı “Yüklü …” formatı (kayıt sayısı yok) */
function _buildIhracatWarnLabel(meta) {
  const fileName = String(meta?.fileName || '').trim();
  if (fileName) return `Yüklü ${fileName}`;
  const dk = String(meta?.dateKey || '').trim();
  if (dk) return `Yüklü ${_formatDateKeyTR(dk)}`;
  return 'Yüklü';
}

function _buildIhracatChipText(info){
  if ((info?.ihrCount || 0) > 0) {
    const detail = (info.ihrLine && info.ihrLine !== '-') ? info.ihrLine : `${info.ihrCount} kayıt`;
    return `Yüklü ${detail}`;
  }
  return 'Boş';
}

function _buildPiyasaChipText(info){
  if ((info?.piyCount || 0) > 0) {
    const detail = (info.piyLine && info.piyLine !== '-') ? info.piyLine : `${info.piyCount} kayıt`;
    return `Yüklü ${detail}`;
  }
  return 'Boş';
}

function _dateKeyFromDate(d) {
  if (!d || !(d instanceof Date) || isNaN(d.getTime())) return '';
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/** Dosya adından tarih: 21.05.2026.xlsx → 2026-05-21 */
function _dateKeyFromFileName(fileName) {
  const s = String(fileName || '').trim();
  if (!s) return '';
  let m = s.match(/(?:^|[^0-9])(\d{2})[.\-_](\d{2})[.\-_](\d{4})(?:[^0-9]|$)/);
  if (m) {
    const dd = m[1];
    const mm = m[2];
    const yyyy = m[3];
    if (+mm >= 1 && +mm <= 12 && +dd >= 1 && +dd <= 31) return `${yyyy}-${mm}-${dd}`;
  }
  m = s.match(/(?:^|[^0-9])(\d{4})[.\-_](\d{2})[.\-_](\d{2})(?:[^0-9]|$)/);
  if (m) {
    const yyyy = m[1];
    const mm = m[2];
    const dd = m[3];
    if (+mm >= 1 && +mm <= 12 && +dd >= 1 && +dd <= 31) return `${yyyy}-${mm}-${dd}`;
  }
  return '';
}

/** İHRACAT Excel'in gerçek tarihi — dosya adı öncelikli (dateKey yükleme günü olabilir) */
function _resolveIhracatDateKey(meta) {
  if (!meta) return '';
  const fromFile = _dateKeyFromFileName(meta.fileName);
  if (fromFile) return fromFile;
  return String(meta.dateKey || '').trim();
}

function _loadPiyasaState() {
  try {
    const raw = localStorage.getItem('piyasa_state_v1');
    if (!raw) return null;
    return JSON.parse(raw) || null;
  } catch (e) { return null; }
}

/** PİYASA uyarı bandı — header chip ile aynı “Yüklü …Hafta/tarih” formatı */
function _buildPiyasaWarnLabel(piy) {
  if (!piy) return 'Yüklü';
  const weekInfo = piy.week != null ? piy.week : (piy.sheet ? piy.sheet : '');
  let dateStr = '';
  if (piy.loadedAt) {
    const dt = new Date(piy.loadedAt);
    if (!isNaN(dt)) dateStr = _formatDateKeyTR(_dateKeyFromDate(dt));
  }
  if (weekInfo && dateStr) return `Yüklü ${weekInfo}.Hafta/${dateStr}`;
  if (weekInfo) return `Yüklü ${weekInfo}.Hafta`;
  if (dateStr) return `Yüklü ${dateStr}`;
  if (piy.sheet) return `Yüklü ${piy.sheet}`;
  return 'Yüklü';
}

function _buildExcelDateWarnBannerHtml(title, label) {
  const titleUpper = String(title || '').toLocaleUpperCase('tr-TR');
  return `<div class="excel-date-warn" role="alert">
    <span class="excel-date-warn__icon" aria-hidden="true"><i class="fas fa-exclamation"></i></span>
    <div class="excel-date-warn__body">
      <span class="excel-date-warn__title">${titleUpper}</span>
      <span class="excel-date-warn__pill excel-date-warn__pill--loaded">${label}</span>
    </div>
  </div>`;
}

function _computeExcelDateWarnHtml() {
  const todayKey = (typeof _todayKeyTR === 'function') ? _todayKeyTR() : '';
  const parts = [];

  try {
    const meta = (typeof loadDailyMeta === 'function') ? (loadDailyMeta() || {}) : {};
    const ihrCnt = (typeof loadDailyShipments === 'function') ? ((loadDailyShipments() || []).length || 0) : 0;
    const ihrDateKey = _resolveIhracatDateKey(meta);
    if (ihrCnt > 0 && ihrDateKey && todayKey && ihrDateKey !== todayKey) {
      parts.push(_buildExcelDateWarnBannerHtml('ihracat güncel tarih değil', _buildIhracatWarnLabel(meta)));
    }
  } catch (e) {}

  try {
    const piy = _loadPiyasaState();
    const piyCnt = Array.isArray(piy?.orders) ? piy.orders.length : 0;
    const piyDateKey = piy?.loadedAt ? _dateKeyFromDate(new Date(piy.loadedAt)) : '';
    if (piyCnt > 0 && piyDateKey && todayKey && piyDateKey !== todayKey) {
      parts.push(_buildExcelDateWarnBannerHtml('piyasa güncel tarih değil', _buildPiyasaWarnLabel(piy)));
    }
  } catch (e) {}

  return parts.join('');
}

function _refreshExcelDateWarnBanner() {
  const container = document.getElementById('excelDateWarnContainer');
  if (!container) return;
  container.innerHTML = _computeExcelDateWarnHtml();
}

// PİYASA modülü gibi dış modüller Excel yükleyince, header'daki yazıları anında güncellemek için
function refreshHeaderExcelInfo(){
  try {
    const info = _getExcelStatusInfo();

    const chipIhr = document.getElementById('chipIhracat');
    const chipIhrText = document.getElementById('chipIhracatText');
    if (chipIhr) {
      chipIhr.classList.remove('chip-ok','chip-warn');
      chipIhr.classList.add(info.ihrCount > 0 ? 'chip-ok' : 'chip-warn');
      chipIhr.title = info.ihrCount > 0 ? `İHRACAT Excel: ${info.ihrLine}` : 'İHRACAT Excel yüklü değil';
    }
    if (chipIhrText) chipIhrText.textContent = _buildIhracatChipText(info);

    const chipPiy = document.getElementById('chipPiyasa');
    const chipPiyText = document.getElementById('chipPiyasaText');
    if (chipPiy) {
      chipPiy.classList.remove('chip-ok','chip-warn','chip-alert');
      const piyCls = info.piyCount > 0 ? 'chip-ok' : 'chip-warn';
      const weekWarn = (info.warnings || []).some((w) => w.code === 'week_mismatch');
      chipPiy.classList.add(weekWarn ? 'chip-alert' : piyCls);
      chipPiy.title = info.piyCount > 0 ? `PİYASA Excel: ${info.piyLine}` : 'PİYASA Excel yüklü değil';
      if (weekWarn) chipPiy.title += ' — Hafta uyumsuzluğu olabilir';
    }
    if (chipPiyText) chipPiyText.textContent = _buildPiyasaChipText(info);
    try {
      const ihrChip = document.getElementById('chipIhracat');
      if (ihrChip && (info.warnings || []).length) ihrChip.classList.add('chip-alert');
    } catch (e) {}
    _refreshExcelDateWarnBanner();
  } catch(e) {}
}

// dışarı aç
try { window.refreshHeaderExcelInfo = refreshHeaderExcelInfo; } catch(e) {}

function purgeStrictExcelCaches(){
  // Excel yüklendiğinde: Excel dışındaki local veriler (eşleştirme/override/liste önbelleği) tamamen kapalı.
  const keys = [
    'eslestirmeListesi',
    'firmaListesi',
    'malzemeListesi',
    'recent_sevk_yerleri',
    'recent_firmalar',
    'recent_malzemeler',
    'firmaOverrides_v1'
  ];
  try {
    keys.forEach(k => { try { localStorage.removeItem(k); } catch(e){} });
  } catch(e){}
}

function rebuildListsFromExcelRows(rows){
  try{
    const r = Array.isArray(rows) ? rows : [];
    const firms = new Set();
    const mats = new Set();

    for (const x of r){
      const f = String(x?.firma || '').trim();
      if (f) firms.add(getFirmaKodOnly(f));
      const m = String(x?.malzeme || '').trim();
      if (m) mats.add(m);

      // ✅ Excel'den yükleme notu'nu eşleştirmeye ekle/güncelle
      const yuklemeNotu = String(x?.yuklemeNotu || '').trim();
      if (f && m && yuklemeNotu) {
        const existing = eslestirmeListesi.find(es => es.firma === f && es.malzeme === m);
        if (existing) {
          if (existing.yuklemeNotu !== yuklemeNotu) {
            eslestirmeStorage.update(existing.id, { yuklemeNotu });
          }
        } else {
          eslestirmeStorage.add(f, m, '', yuklemeNotu, '');
        }
      }
    }

    // ✅ Excel yüklüyken seçenekleri sadece Excel'den üret
    firmaListesi = Array.from(firms).filter(Boolean).sort();
    malzemeListesi = Array.from(mats).filter(Boolean).sort();

    // UI açık ise select'leri güncelle
    const firmaSel = document.getElementById('firmaSelect');
    if (firmaSel) {
      const cur = firmaSel.value;
      // ✅ SECURITY: Escape firma values (XSS protection)
      firmaSel.innerHTML = '<option value="">Seçiniz veya elle yazın</option>' +
        firmaListesi.map(f => `<option value="${escapeAttr(f)}">${escapeHtml(f)}</option>`).join('');
      if (cur) firmaSel.value = cur;
    }

    const malSel = document.getElementById('malzemeSelect');
    if (malSel) {
      const curM = malSel.value;
      // ✅ SECURITY: Escape malzeme values (XSS protection)
      malSel.innerHTML = '<option value="">Seçiniz veya elle yazın</option>' +
        malzemeListesi.map(m => `<option value="${escapeAttr(m)}">${escapeHtml(m)}</option>`).join('');
      if (curM) malSel.value = curM;
    }
  }catch(e){}
}
// Ambalaj metnini header satırından yakala (NET'li/NET'siz, 1 veya 2 ambalaj):
// Örn: "NET 25 KG ... NET 1200 KG ..." -> "NET 25 KG ... + NET 1200 KG ..."
// Örn: "1250 KG'LIK ... BIGBAGLER"     -> "NET 1250 KG ... BIGBAGLER"
function extractAmbalajFromHeader(headerText) {
  const raw = String(headerText || '')
    .replace(/\./g, '')       // 1.250 -> 1250
    .replace(/'/g, '')         // KG'LIK -> KGLIK
    .replace(/\s+/g, ' ')
    .toUpperCase()
    .trim();

  const parts = raw.split('/').map(p => p.trim()).filter(Boolean);
  const results = [];

  for (const part of parts) {
    // 1) NET 25 KG / NET 1200 KG (aynı segmentte birden fazla olabilir)
    const netMatches = [...part.matchAll(/\bNET\s*([0-9]{1,5})\s*KG\b([^\/]*)/gi)];
    for (const m of netMatches) {
      const kg = parseInt(m[1], 10);
      let text = `NET ${kg} KG ${m[2] || ''}`;
      text = cleanAmbalajText(text);
      if (text) results.push({ kg, text });
    }

    // 2) NET yok ama "1250 KG'LIK ... BIGBAG/ÇUVAL" gibi
    const nonNetMatches = [...part.matchAll(/\b([0-9]{1,5})\s*KG(LIK)?\b([^\/]*)/gi)];
    for (const m of nonNetMatches) {
      const kg = parseInt(m[1], 10);
      const rest = String(m[3] || '').trim();

      // Ambalaj anahtar kelimesi yoksa alma (HP 0,074-0,30 gibi alanları ele)
      if (!/(BIGBAG|BIG BAG|BİGBAG|CUVAL|ÇUVAL|PALET|BBT)/i.test(rest)) continue;

      let text = `NET ${kg} KG ${rest}`;
      text = cleanAmbalajText(text);
      if (text) results.push({ kg, text });
    }
  }

  if (!results.length) return '';

  // Tekrarları temizle
  const uniq = [];
  const seen = new Set();
  for (const r of results) {
    const key = String(r.text || '').toUpperCase().trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    uniq.push(r);
  }

  // Küçükten büyüğe: 25 KG + 1200/1250 KG
  uniq.sort((a, b) => (a.kg || 0) - (b.kg || 0));

  return uniq.map(x => x.text).join(' + ');
}

function cleanAmbalajText(text) {
  return String(text || '')
    // sevkiyat sonrası alanları buda
    .replace(/\bBOOKING\b.*$/i, '')
    .replace(/\bGEM[İI]\b.*$/i, '')
    .replace(/\bGEMI\b.*$/i, '')
    .replace(/\bEXPORT\b.*$/i, '')
    .replace(/\bTON\b.*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}


// ✅ Aday üretimi: Ambalaj (NET'li + NET'siz KG'LIK) -> seçenek listesi
function getAmbalajCandidates(headerText){
  const raw = String(headerText || '')
    .replace(/\./g,'')
    .replace(/'/g,'')
    .replace(/\s+/g,' ')
    .toUpperCase()
    .trim();

  const parts = raw.split('/').map(p=>p.trim()).filter(Boolean);
  const out = [];

  for (const part of parts) {
    // NET xxx KG ... (aynı segmentte birden fazla)
    for (const m of part.matchAll(/\bNET\s*([0-9]{1,5})\s*KG\b([^\/]*)/gi)) {
      const kg = parseInt(m[1],10);
      let t = `NET ${kg} KG ${m[2]||''}`;
      t = cleanAmbalajText(t);
      if (t) out.push({kg, text:t});
    }
    // NET yok ama 1250 KG'LIK ...
    for (const m of part.matchAll(/\b([0-9]{1,5})\s*KG(LIK)?\b([^\/]*)/gi)) {
      const kg = parseInt(m[1],10);
      const rest = String(m[3]||'').trim();
      if (!/(BIGBAG|BIG BAG|BİGBAG|ÇUVAL|CUVAL|TORBA|JUMBO|SACK|BAG|PALET|BBT)/i.test(rest)) continue;
      let t = `NET ${kg} KG ${rest}`;
      t = cleanAmbalajText(t);
      if (t) out.push({kg, text:t});
    }
  }

  // uniq + küçükten büyüğe
  const seen = new Set();
  const uniq = [];
  for (const x of out) {
    const k = x.text;
    if (!k || seen.has(k)) continue;
    seen.add(k);
    uniq.push(x);
  }
  uniq.sort((a,b)=> (a.kg||0)-(b.kg||0));
  return uniq.map(x=>x.text);
}

// ✅ Aday üretimi: Liman / Sevk Yeri (çoğunlukla son segment + bilinen isimler)
function getLimanCandidates(headerText){
  const s = String(headerText || '').replace(/\s+/g,' ').trim();
  if (!s) return [];
  const parts = s.split('/').map(p=>p.trim()).filter(Boolean);

  // Bilinen liman/terminal kelimeleri (gerekirse buraya ekleyebilirsin)
  const known = [
    'DP WORLD','EVYAP','GEMPORT','SAFIPORT','MARDAS','MARDAŞ','MARPORT','ASYA PORT','ASYA PORTS',
    'KUMPORT','KUMPORT LİMANI','KUMPORT LIMANI','LIMAŞ','LIMAS','LİMAŞ','ALSANCAK','HAYDARPASA','HAYDARPAŞA',
    'GEMLIK','GEMLİK','YILPORT','YILPORT GEMLIK','AKDENIZ PORT','AKDENİZ PORT',
    'KORFEZ','KÖRFEZ','MEDLOG','KORFEZ MEDLOG','KÖRFEZ MEDLOG','DEPO','TERMINAL','TERMİNAL','LIMAN','LİMAN','PORT'
  ];

  const skipRe = /(GEM[İI]\s*DETAYI|BOOKING\s*NO|LOT\s*NO|HP\s*\d|TON\b|BBT\b|PALET\b|ÇUVAL\b|CUVAL\b|NET\s*\d+\s*KG)/i;

  // Adayları topla: son segmentlere daha fazla ağırlık veriyoruz
  const candidates = [];
  for (let i = 0; i < parts.length; i++) {
    const seg = parts[i];
    if (!seg) continue;
    if (skipRe.test(seg)) continue;

    // Bilinen kelime içeriyorsa güçlü aday
    const upper = seg.toUpperCase();

    let score = 0;
    for (const k of known) {
      if (upper.includes(k)) { score += 3; break; }
    }

    // sonlara yakınsa bonus
    const distFromEnd = (parts.length - 1) - i;
    if (distFromEnd <= 1) score += 2;
    if (distFromEnd <= 3) score += 1;

    // Liman/terminal/depo gibi sinyaller
    if (/(PORT|LIMAN|LİMAN|TERMINAL|TERMİNAL|DEPO|MEDLOG|KORFEZ|KÖRFEZ)/i.test(seg)) score += 2;

    if (score > 0) candidates.push({ text: seg, score });
  }

  // Sadece text'e indir, tekrarları temizle
  candidates.sort((a,b)=> b.score - a.score);
  const uniq = [];
  const seen = new Set();
  for (const x of candidates) {
    const key = x.text.toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    uniq.push(x.text);
  }

  return uniq.slice(0,6); // UI şişmesin
}

// ✅ YD anahtarını normalize et (YD28(G) -> YD28)
function normalizeYdKey(val){
  const s = String(val || '');
  const m = s.match(/\b(YD\d{1,4})\b/i);
  return m ? m[1].toUpperCase() : s.trim().toUpperCase();
}
function findSevkYeriNear(grid, headerRowIdx, headerText) {
  const ht = String(headerText || '').trim();
  if (ht && ht.includes('/')) {
    const parts = ht.split('/').map(p => p.trim()).filter(Boolean);
    if (parts.length) return parts[parts.length - 1];
  }
  return '';
}

// ✅ Dinamik header satırını bul (hard-coded indeks yerine)
function findHeaderRowIndex(grid) {
  // SIRANO+PLAKA veya YDxxx + PLAKA + BBT (ihracat takip listesi) satırını bul
  for (let r = 0; r < Math.min(grid.length, 80); r++) {
    const row = grid[r] || [];
    const rowText = _rowToText(row).toUpperCase();
    if (rowText.includes('SIRANO') && rowText.includes('PLAKA')) return r;
    if (rowText.includes('PLAKA') && rowText.includes('BBT') && /\bYD\d{1,4}\b/.test(rowText)) return r;
  }
  return -1;
}

// ✅ Header satırından kolonna indekslerini dinamik olarak bul
function findColumnIndices(headerRow) {
  const indices = {};
  if (!Array.isArray(headerRow)) return indices;
  
  const targets = [
    { key: 'sirano', names: ['SIRANO'] },
    { key: 'plaka', names: ['PLAKA'] },
    { key: 'aciklama', names: ['AÇIKLAMA','ACIKLAMA','NOT','YÜKLEME NOTU','YUKLEME NOTU'] },
    { key: 'firma', names: ['FİRMA / MÜŞTERİ KODU','FIRMA / MÜŞTERİ KODU','FİRMA / MÜŞTERİ','MÜŞTERİ KODU','MUSTERI KODU'] },
    { key: 'irsaliyeNo', names: ['İRSALİYE NO', 'IRSALIYE NO', 'İRSALİYE','IRSALIYE'] },
    { key: 'malzeme', names: ['MALIN CİNSİ','MALIN CINSI','MALZEME'] },
    { key: 'tonajKg', names: ['TONAJ','TONAJ(KG)','KG'] },
    { key: 'bbt', names: ['BBT'] },
    { key: 'cuval', names: ['ÇUVAL','CUVAL'] },
    { key: 'palet', names: ['PALET'] },
    { key: 'bosBbt', names: ['BOŞ BBT','BOS BBT'] },
    { key: 'bosCuval', names: ['BOŞ ÇUVAL','BOS CUVAL'] },
    { key: 'netTonaj', names: ['NET TONAJ'] },
    { key: 'ogrTonaj', names: ['O.GR. TONAJ', 'O.GR TONAJ', 'BRÜT TONAJ'] },
    { key: 'gidenTonaj', names: ['GİDEN TONAJ', 'GIDEN TONAJ'] },
    { key: 'fark', names: ['FARK'] }
  ];
  
  for (let c = 0; c < headerRow.length; c++) {
    const cell = String(headerRow[c] || '').toUpperCase().trim();
    for (const target of targets) {
      if (indices[target.key] !== undefined) continue;
      for (const name of target.names) {
        if (cell.includes(name)) {
          indices[target.key] = c;
          break;
        }
      }
    }
  }
  
  return indices;
}

/** İhracat bloğu: sol taraftaki ilk PLAKA sütunundan sabit kolon düzeni */
function resolveIhracatBlockCols(headerRow) {
  const row = headerRow || [];
  let plakaCol = -1;
  for (let c = 0; c < row.length; c++) {
    if (String(row[c] || '').toUpperCase().trim() === 'PLAKA') {
      plakaCol = c;
      break;
    }
  }
  if (plakaCol >= 0) {
    return {
      plaka: plakaCol,
      sirano: plakaCol > 0 ? plakaCol - 1 : 0,
      bbt: plakaCol + 1,
      cuval: plakaCol + 2,
      palet: plakaCol + 3,
      bosBbt: plakaCol + 4,
      bosCuval: plakaCol + 5,
      netTonaj: plakaCol + 6,
      ogrTonaj: plakaCol + 7,
      gidenTonaj: plakaCol + 8,
      fark: plakaCol + 9,
    };
  }
  const merged = findColumnIndices(row);
  for (let c = 0; c < row.length; c++) {
    const cell = String(row[c] || '').toUpperCase().trim();
    if (merged.netTonaj === undefined && cell.includes('NET TONAJ')) merged.netTonaj = c;
    if (merged.ogrTonaj === undefined && cell.includes('O.GR') && cell.includes('TONAJ')) merged.ogrTonaj = c;
    if (merged.gidenTonaj === undefined && (cell.includes('GİDEN') || cell.includes('GIDEN'))) merged.gidenTonaj = c;
    if (merged.fark === undefined && cell === 'FARK') merged.fark = c;
  }
  return merged;
}

function isIhracatBlockHeaderRow(row) {
  const rowText = _rowToText(row).toUpperCase();
  if (!rowText.includes('PLAKA') || !rowText.includes('BBT')) return false;
  const c0 = String(row[0] || '').toUpperCase().trim();
  if (/^YD\d{1,4}$/.test(c0)) return true;
  return rowText.includes('SIRANO') && rowText.includes('PLAKA');
}

/** Excel blok üst satırları: uzun YD başlığı hücresi (birleştirilmiş satır değil) */
function _pickIhracatMainHeaderCell(row) {
  let best = '';
  for (const v of row || []) {
    const s = String(v ?? '').trim();
    if (!s || !/\bYD\d{1,4}/i.test(s) || !s.includes('/')) continue;
    if (!/BOOKING\s*NO/i.test(s) && !/NET\s*\d+\s*KG/i.test(s)) continue;
    if (s.length > best.length) best = s;
  }
  return best;
}

function _pickIhracatExportRefCell(row) {
  for (const v of row || []) {
    const s = String(v ?? '').trim();
    if (/EXPORT\s*REF/i.test(s)) return s;
  }
  return '';
}

function _pickIhracatPortFromRow(row) {
  for (const v of row || []) {
    const s = String(v ?? '').trim();
    if (/^BORUSAN\/GEML[Iİ]K$/i.test(s)) return s.toUpperCase();
    if (/^DP\s+WORLD$/i.test(s)) return 'DP WORLD';
  }
  return '';
}

function _pickIhracatFooterCell(row) {
  for (const v of row || []) {
    const s = String(v ?? '').trim();
    if (!s || /MAX\.|ARTI TOLERANS|^BOOKING$/i.test(s)) continue;
    if (/^\d+\s*BBT\s+\d+\s*PALET/i.test(s)) return s.match(/^\d+\s*BBT\s+\d+\s*PALET/i)[0].toUpperCase();
    if (/YENİ\s+MÜŞTERİ|MÜŞTERİ\.|rica ederim|standart değer/i.test(s)) return s;
    if (/SEVKİYATLARDA|SEVKIYATLARDA|DİKKAT\s+EDİLECEK|DIKKAT\s+EDILECEK/i.test(s)) return s;
    if (s.length > 35 && !/EXPORT\s*REF|BOOKING|GEM[İI]\s*DETAYI|YD\d{1,4}/i.test(s)) return s;
  }
  return '';
}

function _stripPortFromHeaderLine(s) {
  return String(s || '')
    .replace(/\s*\/\s*BORUSAN\/GEML[Iİ]K\s*/gi, ' / ')
    .replace(/\s*\/\s*DP\s+WORLD\s*/gi, ' / ')
    .replace(/\s*\/\s*$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function _splitMainHeaderBlackLines(mainHeader) {
  let s = String(mainHeader || '').replace(/\s+/g, ' ').trim();
  if (!s) return { line1: '', line2: '' };
  s = s.replace(/\s*\/\s*(BORUSAN\/GEML[Iİ]K|DP\s+WORLD)\s*$/i, '').trim();

  const istifli = s.match(/^(.*?)\s*(PALETE İSTİFLİ\s*\/.*)$/i);
  if (istifli) {
    return { line1: istifli[1].replace(/\s*\/\s*$/, '').trim(), line2: istifli[2].trim() };
  }

  const lineerRe = /\b(L[Iİ]NEERL[Iİ]|LINEERLI)\s*\([^)]+\)/i;
  const lm = s.match(lineerRe);
  if (lm && lm.index != null) {
    return {
      line1: s.slice(0, lm.index).trim().replace(/\s*\/\s*$/, ''),
      line2: s.slice(lm.index).trim(),
    };
  }

  const gemi = s.match(/^(.*?)\s*(GEM[İI]\s*DETAYI\s*:.*)$/i);
  if (gemi) {
    return { line1: gemi[1].replace(/\s*\/\s*$/, '').trim(), line2: gemi[2].trim() };
  }

  return _splitHeaderBlackLines(s);
}

function parseIhracatBlockMeta(grid, tableHeaderRowIdx) {
  const out = {
    mainHeader: '',
    blackLine1: '',
    blackLine2: '',
    portLine: '',
    borusanLine: '',
    exportLine: '',
    footerLine: '',
    bbtPaletLine: '',
    noteLine: '',
    subLines: [],
  };

  const above = [];
  for (let rr = tableHeaderRowIdx - 1; rr >= Math.max(0, tableHeaderRowIdx - 8); rr--) {
    const row = grid[rr] || [];
    const text = _rowToText(row);
    if (!text) continue;
    above.unshift({ rr, row, text });
  }

  let mainItem = null;
  for (const item of above) {
    const main = _pickIhracatMainHeaderCell(item.row);
    if (main) {
      mainItem = { ...item, main };
      break;
    }
  }

  if (mainItem) {
    out.mainHeader = mainItem.main;
    const portFromMain = mainItem.main.match(/\s*\/\s*(BORUSAN\/GEML[Iİ]K|DP\s+WORLD)\s*$/i);
    if (portFromMain) out.portLine = portFromMain[1].toUpperCase().replace('BORUSAN/GEMLIK', 'BORUSAN/GEMLİK');
    const split = _splitMainHeaderBlackLines(mainItem.main);
    out.blackLine1 = split.line1;
    out.blackLine2 = split.line2;
  }

  let exportItem = null;
  for (const item of above) {
    if (item === mainItem) continue;
    const { row, text } = item;

    if (/EXPORT\s*REF/i.test(text)) {
      exportItem = item;
      const raw = _pickIhracatExportRefCell(row) || text;
      const normalized = _normalizeExportRefLine(raw);
      if (normalized) {
        out.exportLine = normalized;
        out.subLines = [normalized];
      }
      const port = _pickIhracatPortFromRow(row);
      if (port) out.portLine = port;
    }
  }

  const footerAnchorRr = Math.max(mainItem ? mainItem.rr : -1, exportItem ? exportItem.rr : -1);
  const footerCandidates = above
    .filter((item) => item.rr > footerAnchorRr && item.rr < tableHeaderRowIdx)
    .filter((item) => item !== mainItem && item !== exportItem)
    .sort((a, b) => b.rr - a.rr);

  for (const item of footerCandidates) {
    const footer = _pickIhracatFooterCell(item.row, item.text);
    if (!footer) continue;
    out.footerLine = footer;
    if (/^\d+\s*BBT/i.test(footer)) {
      const bp = footer.match(/(\d+)\s*BBT\s+(\d+)\s*PALET/i);
      out.bbtPaletLine = bp ? `${bp[1]} BBT ${bp[2]} PALET` : footer;
    } else {
      out.noteLine = footer;
    }
    break;
  }

  out.borusanLine = out.portLine;
  return out;
}

function parseIhracatBlockToplamRow(row, blockCols) {
  if (!row || !blockCols) return null;
  const pick = (key) => {
    const idx = blockCols[key];
    if (idx === undefined) return '';
    const v = row[idx];
    if (v == null || v === '') return '';
    return typeof v === 'number' ? String(v) : String(v).trim();
  };
  const totals = {
    bbt: pick('bbt'),
    cuval: pick('cuval'),
    palet: pick('palet'),
    bosBbt: pick('bosBbt'),
    bosCuval: pick('bosCuval'),
    netTonaj: pick('netTonaj'),
    ogrTonaj: pick('ogrTonaj'),
    gidenTonaj: pick('gidenTonaj'),
    fark: pick('fark'),
  };
  return Object.values(totals).some((x) => String(x).trim() !== '') ? totals : null;
}

function extractBorusanLineFromHeader(headerText) {
  const t = String(headerText || '').trim();
  if (!t) return '';
  const m = t.match(/\b(BORUSAN\/GEML[Iİ]K|DP\s+WORLD)\b/i);
  if (!m) return '';
  if (/DP/i.test(m[1])) return 'DP WORLD';
  return m[1].toUpperCase().replace('BORUSAN/GEMLIK', 'BORUSAN/GEMLİK');
}

function _normalizeExportRefLine(raw) {
  let s = String(raw || '').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  s = s.replace(/\s*L[Iİ]MAN\s+BORUSAN\/GEML[Iİ]K\s*$/i, '').trim();
  s = s.replace(/\s+L[Iİ]MAN\s*$/i, '').trim();
  const idx = s.search(/EXPORT\s*REF/i);
  if (idx < 0) return '';
  s = s.slice(idx);
  if (!/^-{2,}/.test(s)) s = `---------- ${s}`;
  if (/L[Iİ]MAN\s*DOLUM/i.test(s) && !/\s-{2,}\s*L[Iİ]MAN\s*DOLUM/i.test(s)) {
    s = s.replace(/\s+(L[Iİ]MAN\s*DOLUM)/i, ' ---------- $1');
  }
  return s;
}

function _splitHeaderBlackLines(headerMain) {
  const main = String(headerMain || '').replace(/\s+/g, ' ').trim();
  if (!main) return { line1: '', line2: '' };
  const lineerRe = /\b(L[Iİ]NEERL[Iİ]|LINEERLI)\s*\([^)]+\)/i;
  const m = main.match(lineerRe);
  if (m && m.index != null) {
    return {
      line1: main.slice(0, m.index).trim().replace(/\s*\/\s*$/, ''),
      line2: main.slice(m.index).trim(),
    };
  }
  const parts = main.split(/\s*\/\s*/);
  const li = parts.findIndex((p) => /^L[Iİ]NEERL/i.test(p));
  if (li > 0) {
    return { line1: parts.slice(0, li).join(' / '), line2: parts.slice(li).join(' / ') };
  }
  return { line1: main, line2: '' };
}

function _buildIhracatHeaderDisplay(sample) {
  const meta = sample?.blockMeta || {};
  const headerText = String(meta.mainHeader || sample?.headerText || '').trim();

  let blackLine1 = String(meta.blackLine1 || '').trim();
  let blackLine2 = String(meta.blackLine2 || '').trim();
  if (!blackLine1 && headerText) {
    const split = _splitMainHeaderBlackLines(headerText);
    blackLine1 = split.line1;
    blackLine2 = split.line2;
  }

  let portLine = String(meta.portLine || meta.borusanLine || '').trim();
  if (!portLine && headerText) portLine = extractBorusanLineFromHeader(headerText);
  blackLine1 = _stripPortFromHeaderLine(blackLine1);
  blackLine2 = _stripPortFromHeaderLine(blackLine2);
  if (!portLine && blackLine2) {
    const pm = String(meta.mainHeader || headerText).match(/\s*\/\s*(BORUSAN\/GEML[Iİ]K|DP\s+WORLD)\s*$/i);
    if (pm) portLine = pm[1].toUpperCase().replace('BORUSAN/GEMLIK', 'BORUSAN/GEMLİK');
  }

  let exportLine = String(meta.exportLine || '').trim();
  if (!exportLine) {
    for (const ln of Array.isArray(meta.subLines) ? meta.subLines : []) {
      const n = _normalizeExportRefLine(ln);
      if (n) {
        exportLine = n;
        break;
      }
    }
  }

  const noteLine = String(meta.noteLine || '').trim();
  let footerLine = String(meta.footerLine || meta.bbtPaletLine || noteLine || '').trim();
  if (!footerLine && meta.bbtPaletLine) footerLine = meta.bbtPaletLine;
  const isBbtFooter = /^\d+\s*BBT/i.test(footerLine);
  const isFooterNote =
    !!noteLine ||
    (!isBbtFooter &&
      !!footerLine &&
      /YENİ\s+MÜŞTERİ|MÜŞTERİ\.|rica ederim|standart değer|SEVKİYATLARDA|SEVKIYATLARDA|DİKKAT\s+EDİLECEK|DIKKAT\s+EDILECEK/i.test(
        footerLine
      ));

  return {
    blackLine1,
    blackLine2,
    borusanLine: portLine,
    portLine,
    exportLine,
    bbtPaletSummary: footerLine,
    footerLine,
    noteLine,
    isFooterNote,
    isBbtFooter,
  };
}

/** İhracat Excel üst kutusundaki müşteri / sevkiyat uyarı metni (kırmızı alan) */
function getIhracatBlockFooterNote(shipment) {
  if (!shipment) return '';
  const cached = String(shipment.blockFooterNote || '').trim();
  if (cached) return cached;
  const d = _buildIhracatHeaderDisplay(shipment);
  if (d.isBbtFooter) return '';
  if (d.isFooterNote) return String(d.noteLine || d.footerLine || '').trim();
  const footer = String(d.footerLine || '').trim();
  if (
    footer &&
    /SEVKİYAT|SEVKIYAT|DİKKAT\s+EDİLECEK|DIKKAT\s+EDILECEK|YENİ\s+MÜŞTERİ|MÜŞTERİ\.|rica ederim/i.test(footer)
  ) {
    return footer;
  }
  return '';
}

function _ihracatBlockSelectionKey(headerText) {
  const ht = String(headerText || '').replace(/\s+/g, ' ').trim();
  if (!ht) return '';
  const yd = (ht.match(/\b(YD\d{1,4})\b/i) || [])[1] || '';
  const book = (ht.match(/BOOKING\s*NO\s*:\s*(\d+)/i) || [])[1] || '';
  const mal = _extractMalzeme(ht) || '';
  return [yd, book, mal].join('|').toUpperCase();
}

function _rowInSelectedBlocks(rowIdx, onlyBlocks, headerText) {
  if (!onlyBlocks || !onlyBlocks.length) return true;
  const selKey = _ihracatBlockSelectionKey(headerText);
  if (selKey) {
    const byHeader = onlyBlocks.some((b) => _ihracatBlockSelectionKey(b.headerText) === selKey);
    if (byHeader) return true;
  }
  return onlyBlocks.some((b) => rowIdx >= b.startRow && rowIdx <= b.endRow);
}

function parseIhracatRowsFromWorkbook(wb, sheetName, opts) {
  opts = opts || {};
  const onlyBlocks = opts.onlyBlocks || null;
  const fileLabel = opts.fileName || '';
  if (!wb || !sheetName) return { ok: false, msg: 'Sayfa yok.', rows: [], meta: {}, stats: {} };
  const ws = wb.Sheets[sheetName];
  const grid = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, blankrows: true });

  // ✅ Header satırını dinamik olarak bul
  const headerRowIdx = findHeaderRowIndex(grid);
  if (headerRowIdx < 0) {
    return { ok: false, msg: 'Excel başlığı bulunamadı (SIRANO + PLAKA).', rows: [], meta: {}, stats: {} };
  }

  // ✅ Kolonna indekslerini dinamik olarak bul
  const headerRow = grid[headerRowIdx] || [];
  const cols = findColumnIndices(headerRow);
  
  // Excel'de B sütununda not varsa, header adının olmaması durumunda B'yi fallback olarak al
  if (cols.aciklama === undefined && headerRow.length > 1) {
    const secondHeader = String(headerRow[1] || '').trim().toUpperCase();
    const isKnown = /SIRANO|PLAKA|FIRMA|MALZEME|TONAJ|BBT|ÇUVAL|CUVAL|PALET|KOLI|AÇIKLAMA|ACIKLAMA|NOT|YÜKLEME|YUKLEME|İRSALİYE|IRSALİYE/.test(secondHeader);
    if (!isKnown) {
      cols.aciklama = 1;
    }
  }

  // Zorunlu kolonnaları kontrol et
  if (cols.sirano === undefined || cols.plaka === undefined) {
    return { ok: false, msg: 'Excel formatı tanınmadı (SIRANO veya PLAKA bulunamadı).', rows: [], meta: {}, stats: {} };
  }

  // Başlıkta "İRSALİYE NO" yoksa A sütunu (R11…) otomatik tanı
  const irsaliyeCol = detectIrsaliyeColumnIndex(grid, headerRowIdx, cols);
  if (irsaliyeCol !== undefined) cols.irsaliyeNo = irsaliyeCol;

  const rowsOut = [];

  for (let r = 0; r < grid.length; r++) {
    const row = grid[r] || [];
    if (!isIhracatBlockHeaderRow(row)) continue;

    const blockCols = resolveIhracatBlockCols(row);
    if (blockCols.plaka === undefined) continue;

    const blockMeta = parseIhracatBlockMeta(grid, r);
    const headerText = blockMeta.mainHeader || findShipmentHeaderText(grid, r) || '';
    if (!/\bYD\d{1,4}\b/i.test(headerText)) continue;
    if (!_rowInSelectedBlocks(r, onlyBlocks, headerText)) continue;
    const ambalaj = ''; // otomatik ambalaj okuma kapali (manuel / aday secim)
    const sevkYeri = ''; // otomatik sevk yeri okuma kapali (manuel / aday secim)
    const noteColumnIndex = (cols.aciklama !== undefined ? cols.aciklama : 1);
    let blockYuklemeNotu = '';
    let blockTotals = null;

    for (let rr = r+1; rr < grid.length; rr++) {
      const d = grid[rr] || [];
      const rawA0 = String(d[0] || '').trim();
      const rowTextUpper = _rowToText(d).toUpperCase();
      if (rr > r + 1 && isIhracatBlockHeaderRow(d)) break;
      if (/\bTOPLAM\b/.test(rowTextUpper) && !/ARA\s+TOPLAM/.test(rowTextUpper)) {
        blockTotals = parseIhracatBlockToplamRow(d, blockCols);
        break;
      }
      if (/\bKALAN\b/.test(rowTextUpper)) break;

      const plakaRaw = blockCols.plaka !== undefined ? d[blockCols.plaka] : null;
      const maybeNote = String(d[noteColumnIndex] || '').trim();
      const rowText = _rowToText(d).toUpperCase();
      const isLikelyNote = maybeNote.length > 20 && /[A-ZÇĞİÖŞÜİ]/i.test(maybeNote) && !/(SIRANO|PLAKA|BBT|ÇUVAL|CUVAL|PALET|TONAJ|TARİH|TARIH|FİRMA|FIRMA|MALZEME|AÇIKLAMA|ACIKLAMA|NOT|YÜKLEME|YUKLEME)/i.test(rowText);
      if (!plakaRaw && !blockYuklemeNotu && isLikelyNote) {
        blockYuklemeNotu = maybeNote;
        continue;
      }
      if (!plakaRaw) continue;

      // ✅ ydKey kısa anahtar olarak kalsın
const firmaFromN = extractFirmaTextFromN(ws, rr + 1, 40);
const ydFromHeader = ((headerText || '').match(/\b(YD\d{1,4})\b/i) || [])[1]?.toUpperCase() || '';
const ydKey = (((firmaFromN || '').match(/\b(YD\d{1,4})\b/i) || [])[1] || ydFromHeader || '').trim().toUpperCase();

// ✅ Firma = N sütunundaki TAM hücre
const firma = String(firmaFromN || ydKey || '').trim();

     const irsaliyeNo = resolveIrsaliyeFromRow(d, { ...cols, ...blockCols });
     const blockFooterNote = getIhracatBlockFooterNote({ blockMeta });
     rowsOut.push({
  id: irsaliyeNo || String(d[0] || '').trim(),
  sira: blockCols.sirano !== undefined ? (d[blockCols.sirano] != null ? String(d[blockCols.sirano]).trim() : '') : '',
  plaka: normPlate(plakaRaw),
  ydKey: ydKey,
  headerText: headerText,
  blockKey: `BLK_${r}`,
  blockHeaderRow: r,
  blockMeta,
  blockFooterNote,
  blockTotals,
  fileName: String(fileLabel || '').trim(),
firma: (firma || '').slice(0, 40),

  irsaliyeNo,
  malzeme: cols.malzeme !== undefined ? (d[cols.malzeme] != null ? String(d[cols.malzeme]).trim() : '') : '',
  tonajKg: blockCols.netTonaj !== undefined ? _nz(d[blockCols.netTonaj]) : (cols.tonajKg !== undefined ? _nz(d[cols.tonajKg]) : ''),
  bbt: blockCols.bbt !== undefined ? _nz(d[blockCols.bbt]) : '',
  cuval: blockCols.cuval !== undefined ? _nz(d[blockCols.cuval]) : '',
  palet: blockCols.palet !== undefined ? _nz(d[blockCols.palet]) : '',
  bosBbt: blockCols.bosBbt !== undefined ? _nz(d[blockCols.bosBbt]) : '',
  bosCuval: blockCols.bosCuval !== undefined ? _nz(d[blockCols.bosCuval]) : '',

  yuklemeNotu: (String(d[noteColumnIndex] || '').trim() || blockYuklemeNotu),

  firma,
  sevkYeri,
  ambalaj
});
    }
  }

  // uniq
  const uniq = [];
  const seen = new Set();
  for (const x of rowsOut) {
    const k = `${x.plaka}__${x.id}__${x.sira}`;
    if (seen.has(k)) continue;
    seen.add(k);
    uniq.push(x);
  }

  const meta = {
    dateKey: _dateKeyFromFileName(fileLabel) || _todayKeyTR(),
    sheetName: sheetName,
    fileName: fileLabel,
    importedAt: new Date().toISOString(),
    count: uniq.length,
    fileFingerprint: opts.fileFingerprint || null,
  };

  const eu = window.ExcelUtils || {};
  const dupPlateRows = eu.findDuplicatePlateRows ? eu.findDuplicatePlateRows(uniq) : [];
  const dupPlates = dupPlateRows.length;
  const collisions = eu.findIrsaliyeCollisions ? eu.findIrsaliyeCollisions(uniq) : [];

  return {
    ok: true,
    rows: uniq,
    meta,
    stats: {
      accepted: uniq.length,
      raw: rowsOut.length,
      skipped: Math.max(0, rowsOut.length - uniq.length),
      dupPlates,
      dupPlateRows,
      collisions,
    },
  };
}

async function commitIhracatImport(uniq2, meta, file) {
  let rowsToSave = uniq2;
  let metaToSave = meta;

  try {
    const existing = (typeof loadDailyShipments === 'function') ? (loadDailyShipments() || []) : [];
    const existingMeta = (typeof loadDailyMeta === 'function') ? (loadDailyMeta() || {}) : {};

    if (Array.isArray(existing) && existing.length > 0) {
      const doAppend = await confirm(
        `Mevcut Excel verisi var: ${existing.length} kayıt.\n\nYeni dosya EKLENSİN mi?\n• OK  = Ekle (2 Excel aynı anda)\n• İptal = Değiştir (eskisi silinir)`
      );

      if (doAppend) {
        rowsToSave = existing.concat(uniq2);
        const files = []
          .concat(existingMeta.files || (existingMeta.fileName ? [existingMeta.fileName] : []))
          .concat((file && file.name) || meta.fileName || '')
          .map((s) => String(s || '').trim())
          .filter(Boolean);
        const seenF = new Set();
        const uniqFiles = [];
        for (const f of files) {
          if (!seenF.has(f)) {
            seenF.add(f);
            uniqFiles.push(f);
          }
        }
        metaToSave = {
          ...existingMeta,
          ...meta,
          importedAt: existingMeta.importedAt || meta.importedAt,
          files: uniqFiles,
          fileName: uniqFiles.join(' + '),
          count: rowsToSave.length,
          appendedAt: new Date().toISOString(),
        };
      } else {
        rowsToSave = uniq2;
        metaToSave = meta;
      }
    }
  } catch (e) {
    rowsToSave = uniq2;
    metaToSave = meta;
  }

  const ok = saveDailyShipments(rowsToSave, metaToSave);
  if (!ok) return { ok: false, msg: 'Kaydetme başarısız (localStorage dolu olabilir).' };

  purgeStrictExcelCaches();
  rebuildListsFromExcelRows(rowsToSave);
  try {
    window.refreshHeaderExcelInfo && window.refreshHeaderExcelInfo();
  } catch (e) {}

  return { ok: true, msg: `✅ Excel yüklendi: ${uniq2.length} satır`, meta: metaToSave };
}

window.parseIhracatRowsFromWorkbook = parseIhracatRowsFromWorkbook;
window.commitIhracatImport = commitIhracatImport;

// Excel okuma (XLSX) - Dinamik header arama ile
async function importDailyExcel(file) {
  if (!file) return { ok: false, msg: 'Dosya seçilmedi.' };
  try {
    if (typeof window.ensureXlsxLoaded === 'function') await window.ensureXlsxLoaded();
  } catch (e) {
    return { ok: false, msg: 'XLSX kütüphanesi yüklenemedi. İnternet bağlantınızı kontrol edin.' };
  }
  if (typeof XLSX === 'undefined') {
    return { ok: false, msg: 'XLSX kütphanesi yüklenemedi. (xlsx.full.min.js)' };
  }

  let fp = '';
  try {
    if (window.ExcelUtils && window.ExcelUtils.fingerprintFile) fp = await window.ExcelUtils.fingerprintFile(file);
  } catch (e) {}

  const existingMeta = (typeof loadDailyMeta === 'function') ? loadDailyMeta() : {};
  if (fp && existingMeta.fileFingerprint === fp && (loadDailyShipments() || []).length) {
    const again = confirm('Bu dosya daha önce yüklendi.\n\nYine de yüklemek istiyor musunuz?');
    if (!again) return { ok: false, msg: 'Yükleme iptal edildi.' };
  }

  const data = await file.arrayBuffer();
  const wb = XLSX.read(data, { type: 'array' });
  let sheetName = wb.SheetNames && wb.SheetNames[0];
  if (window.ExcelIhracatImport && wb.SheetNames && wb.SheetNames.length > 1) {
    const picked = await window.ExcelIhracatImport.pickIhracatSheet(wb);
    if (!picked) return { ok: false, msg: 'Sayfa seçilmedi.' };
    sheetName = picked;
  }
  if (!sheetName) return { ok: false, msg: 'Excel sayfası bulunamadı.' };

  const parsed = parseIhracatRowsFromWorkbook(wb, sheetName, {
    fileName: file.name,
    fileFingerprint: fp,
  });
  if (!parsed.ok) return { ok: false, msg: parsed.msg || 'Excel okunamadı.' };

  if (window.ExcelIhracatImport) {
    const confirmed = await window.ExcelIhracatImport.showImportPreview(parsed.stats);
    if (!confirmed) return { ok: false, msg: 'Yükleme iptal edildi.' };
  }

  const committed = await commitIhracatImport(parsed.rows, { ...parsed.meta, fileFingerprint: fp }, file);
  return committed;
}
