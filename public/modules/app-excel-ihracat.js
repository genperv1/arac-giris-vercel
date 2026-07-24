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

function _irsaliyeFromCell(val) {
  if (val == null || !String(val).trim()) return '';
  const n = normalizeIrsaliyeNo(val);
  return n && looksLikeIrsaliyeNo(n) ? n : '';
}

function _irsaliyeReservedColumns(cols) {
  return new Set([
    cols?.sirano,
    cols?.plaka,
    cols?.bbt,
    cols?.cuval,
    cols?.palet,
    cols?.malzeme,
    cols?.aciklama,
    cols?.firma,
    cols?.tonajKg,
    cols?.bosBbt,
    cols?.bosCuval,
    cols?.netTonaj,
    cols?.ogrTonaj,
    cols?.gidenTonaj,
    cols?.fark,
    cols?.irsaliyeNo,
  ].filter((x) => x !== undefined));
}

/** İhracat satırında irsaliye okunabilecek sütunlar (sıra: plakanın yanı / A sütunu; SIRANO hariç) */
function _ihracatIrsaliyeColumnCandidates(cols) {
  const sirano = cols?.sirano;
  const plaka = cols?.plaka;
  const out = [];
  const add = (c) => {
    if (c === undefined || c < 0 || c === sirano) return;
    if (!out.includes(c)) out.push(c);
  };

  // Tipik ihracat: A=irsaliye, B=sira, C=plaka — global detect bazen yanlış sütunu seçer; önce A
  if (plaka !== undefined && plaka >= 2) add(plaka - 2);
  if (cols?.irsaliyeNo !== undefined && cols.irsaliyeNo !== sirano) add(cols.irsaliyeNo);
  if (sirano !== undefined && sirano > 0) add(sirano - 1);
  add(0);
  return out;
}

function resolveIrsaliyeFromRow(d, cols) {
  const row = d || [];
  for (const c of _ihracatIrsaliyeColumnCandidates(cols)) {
    const hit = _irsaliyeFromCell(row[c]);
    if (hit) return hit;
  }
  return '';
}

function getShipmentIrsaliyeNo(shipment) {
  if (!shipment) return '';
  const direct = normalizeIrsaliyeNo(shipment.irsaliyeNo);
  return direct || '';
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

const IHR_IRS_COLLISION_CELL_STYLE = 'background:#fef3c7;color:#92400e;font-weight:700;border:1px solid #fbbf24;';

function detectIrsaliyeColumnIndex(grid, headerRowIdx, cols) {
  if (cols.irsaliyeNo !== undefined && cols.irsaliyeNo !== cols.sirano) return cols.irsaliyeNo;

  const reserved = _irsaliyeReservedColumns(cols);
  const scores = new Map();
  const plakaCol = cols.plaka;
  const siranoCol = cols.sirano;
  const start = headerRowIdx + 1;
  const end = Math.min(grid.length, headerRowIdx + 150);

  // Tipik ihracat düzeni: plaka sütununun 2 solu (A) irsaliye
  if (plakaCol !== undefined && plakaCol >= 2) scores.set(plakaCol - 2, 1000);

  for (let r = start; r < end; r++) {
    const row = grid[r] || [];
    const hasPlaka = plakaCol !== undefined && row[plakaCol] != null && String(row[plakaCol]).trim();
    if (!hasPlaka) continue;

    for (let c = 0; c < row.length; c++) {
      if (reserved.has(c) || c === siranoCol) continue;
      if (looksLikeIrsaliyeNo(row[c])) scores.set(c, (scores.get(c) || 0) + 1);
    }
  }

  let bestCol;
  let bestScore = 0;
  for (const [c, score] of scores.entries()) {
    if (c === siranoCol) continue;
    if (score > bestScore) {
      bestScore = score;
      bestCol = c;
    }
  }
  if (bestScore > 0 && bestCol !== undefined) return bestCol;

  const candidates = [];
  if (plakaCol !== undefined && plakaCol >= 2) candidates.push(plakaCol - 2);
  if (siranoCol !== undefined && siranoCol > 0) candidates.push(siranoCol - 1);
  candidates.push(0);
  for (const c of candidates) {
    if (c === siranoCol) continue;
    for (let r = start; r < Math.min(grid.length, headerRowIdx + 25); r++) {
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
  const out = { ...sh };
  const headerText = String(sh.blockMeta?.mainHeader || sh.headerText || '').trim();
  const manuallyEdited = !!(sh._ihracatBlockEdited || sh._ihracatEdited);

  if (!String(out.sevkYeri || '').trim()) {
    const meta = typeof loadDailyMeta === 'function' ? (loadDailyMeta() || {}) : {};
    const gk = typeof _ihracatBlockGroupKey === 'function' ? _ihracatBlockGroupKey(sh) : '';
    const blockOv = gk && meta.blockOverrides ? meta.blockOverrides[gk] : null;
    if (blockOv && String(blockOv.sevkYeri || '').trim()) {
      out.sevkYeri = String(blockOv.sevkYeri).trim();
    }
  }
  if (!String(out.ambalaj || out.ambalajBilgisi || '').trim()) {
    const meta = typeof loadDailyMeta === 'function' ? (loadDailyMeta() || {}) : {};
    const gk = typeof _ihracatBlockGroupKey === 'function' ? _ihracatBlockGroupKey(sh) : '';
    const blockOv = gk && meta.blockOverrides ? meta.blockOverrides[gk] : null;
    if (blockOv && String(blockOv.ambalaj || '').trim()) {
      out.ambalaj = String(blockOv.ambalaj).trim();
      out.ambalajBilgisi = out.ambalaj;
    }
  }

  if (!String(out.sevkYeri || '').trim()) {
    const fromBlock = extractPrimaryPortFromShipment(sh);
    if (fromBlock) out.sevkYeri = fromBlock;
  }
  if (!String(out.ambalaj || out.ambalajBilgisi || '').trim()) {
    const fromHeader = extractPrimaryAmbalajFromHeader(headerText);
    if (fromHeader) {
      out.ambalaj = fromHeader;
      out.ambalajBilgisi = fromHeader;
    }
  }

  if (manuallyEdited) return out;

  const firma = sh.firma || sh.ydKey || '';
  const ov = getFirmaOverride(firma);
  if (!ov) return out;
  if (!String(out.sevkYeri || '').trim() && ov.sevkYeri && String(ov.sevkYeri).trim()) {
    out.sevkYeri = String(ov.sevkYeri).trim();
  }
  if (!String(out.ambalaj || out.ambalajBilgisi || '').trim() && ov.ambalaj && String(ov.ambalaj).trim()) {
    out.ambalaj = String(ov.ambalaj).trim();
    out.ambalajBilgisi = out.ambalaj;
  }
  return out;
}

const DAILY_SHIPMENT_META = 'daily_shipments_meta';

// TR plaka normalize (eşleştirme için) -> "43ADD516" == "43 ADD 516"
function normPlate(v) {
  const raw = String(v ?? '').trim();
  if (!raw) return '';
  try {
    if (typeof formatPlakaForInput === 'function') {
      return formatPlakaForInput(raw).replace(/\s+/g, ' ').trim();
    }
  } catch (e) { /* ignore */ }
  const compact = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const m = compact.match(/^(\d{2})([A-Z]{1,3})(\d{2,5})$/);
  if (m) return `${m[1]} ${m[2]} ${m[3]}`;
  return raw.toUpperCase();
}

/** Excel plaka hücresinde "PLAKA VERİLECEK" / "92BBT PLAKA VERİLECEK" gibi bekleyen notlar */
function isIhracatPendingPlakaCell(raw) {
  const norm = String(raw || '')
    .trim()
    .toUpperCase()
    .replace(/İ/g, 'I')
    .replace(/Ş/g, 'S')
    .replace(/Ğ/g, 'G')
    .replace(/Ü/g, 'U')
    .replace(/Ö/g, 'O')
    .replace(/Ç/g, 'C');
  return !!norm && /PLAKA\s*VER/i.test(norm);
}

function parseIhracatPendingPlakaBbt(raw) {
  const norm = String(raw || '')
    .trim()
    .toUpperCase()
    .replace(/İ/g, 'I');
  const m = norm.match(/(\d+)\s*BBT\s+PLAKA\s*VER/i);
  if (m) return parseInt(m[1], 10);
  return null;
}

function _plateKeyForMatch(p) {
  return String(p || '').toLowerCase().replace(/[\s-]+/g, '');
}

function clearActiveTakipVehicleRefs() {
  try { window.__activeTakipVehicleId = ''; } catch (e) {}
  try { window.__activeTakipVehiclePlate = ''; } catch (e) {}
  try { window.__activeTakipVehicle = null; } catch (e) {}
  try { window.__takipUseLastPrintMemory = false; } catch (e) {}
}

function resolveTakipVehicleIdForPrint(plate, hintId) {
  const pid = String(plate || '').trim();
  const hint = String(hintId || '').trim();
  const vehicles = (typeof state !== 'undefined' && state && Array.isArray(state.vehicles)) ? state.vehicles : [];
  const key = pid ? _plateKeyForMatch(pid) : '';

  // Hint yalnızca formdaki çekici plaka ile uyuşuyorsa kullanılır.
  // Aksi halde (ör. eski özmal kartı açıkken yeni plaka yazılınca) yanlış araca bağlanır.
  if (hint && hint !== 'manual') {
    const byHint = vehicles.find((v) => String(v.id) === hint);
    if (byHint) {
      if (!key || _plateKeyForMatch(byHint.cekiciPlaka) === key) {
        return String(byHint.id);
      }
    }
  }

  if (key) {
    const byCekici = vehicles.find((v) => _plateKeyForMatch(v?.cekiciPlaka) === key);
    if (byCekici && byCekici.id) return String(byCekici.id);
  }

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

/** Takip formundaki ambalaj / BBT alanlarını oku */
function getTakipPackagingPayload() {
  const formGet = (id) => {
    try { return (document.getElementById(id)?.value || '').trim(); } catch (e) { return ''; }
  };
  return {
    bbt: formGet('bbt'),
    bosBbt: formGet('bosBbt'),
    cuval: formGet('cuval'),
    bosCuval: formGet('bosCuval'),
    palet: formGet('palet'),
    torba: formGet('torba'),
    seperatorBilgisi: formGet('seperatorBilgisi'),
  };
}

/** Rapor → Tekrar Yazdır: kayıtlı tüm alanları takip formuna yazar */
function applyReprintSnapshotToTakipForm(rd) {
  if (!rd || typeof rd !== 'object') return;
  const pick = (...keys) => {
    for (const k of keys) {
      const v = rd[k];
      if (v != null && String(v).trim() !== '') return String(v).trim();
    }
    return '';
  };
  const set = (id, val) => {
    const v = val != null ? String(val).trim() : '';
    if (!v) return;
    const el = document.getElementById(id);
    if (el) el.value = v;
  };

  const firma = pick('firma', 'firmaKodu', 'firmaSelect');
  set('firmaKodu', firma);
  set('firmaSelect', pick('firmaSelect', 'firmaKodu', 'firma'));
  set('malzeme', pick('malzeme', 'malzemeSelect'));
  set('malzemeSelect', pick('malzemeSelect', 'malzeme'));
  set('sevkYeri', pick('sevkYeri'));
  set('ambalajBilgisi', pick('ambalajBilgisi', 'ambalaj'));
  set('tonaj', pick('tonaj'));
  set('yuklemeNotu', pick('yuklemeNotu', 'baskiNotu'));
  set('yuklemeSirasi', pick('yuklemeSirasi'));
  set('basimYeri', pick('basimYeri'));
  set('bbt', pick('bbt'));
  set('bosBbt', pick('bosBbt'));
  set('cuval', pick('cuval'));
  set('bosCuval', pick('bosCuval'));
  set('palet', pick('palet'));
  set('torba', pick('torba'));
  set('seperatorBilgisi', pick('seperatorBilgisi'));
  set('cekiciPlakaBilgi', pick('plaka', 'cekiciPlaka', 'plate'));
  set('imzaKantarAd', pick('kantar', 'imzaKantarAd'));

  try {
    const drv = driverFieldsFromSnapshot(rd);
    set('soforBilgi', drv.sofor);
    set('tcBilgi', drv.tcKimlik);
    set('iletisimBilgi', drv.iletisim);
    set('dorsePlakaBilgi', drv.dorsePlaka);
  } catch (e) { /* ignore */ }

  try { refreshKantarSignaturePreview(); } catch (e) { /* ignore */ }
  try { refreshSahaSignaturePreview(); } catch (e) { /* ignore */ }
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
  if (pending && pending.piyasaOrderIdx != null && pending.piyasaOrderIdx !== '') return false;
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
  const packaging = getTakipPackagingPayload();
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
    bbt: packaging.bbt,
    bosBbt: packaging.bosBbt,
    cuval: packaging.cuval,
    bosCuval: packaging.bosCuval,
    palet: packaging.palet,
    torba: packaging.torba,
    seperatorBilgisi: packaging.seperatorBilgisi,
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
    const userSevk = String(printEv.sevkYeri || '').trim();
    if (sehir && !userSevk) printEv.sevkYeri = sehir;
    if (yuk) {
      printEv.yuklemeTuru = yuk;
      if (!String(printEv.ambalajBilgisi || '').trim()) printEv.ambalajBilgisi = yuk;
    }
  } catch (e) { /* ignore */ }
  return printEv;
}

function buildPrintHistoryPostBody(printEv, pending, commitTs) {
  const yuk = String(printEv.yuklemeTuru || printEv.ambalajBilgisi || '').trim();
  const vehicleId = String(printEv.vehicleId || pending?.vehicleId || '').trim();
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
    iletisim: String(printEv.iletisim || '').trim(),
    tcKimlik: String(printEv.tcKimlik || '').trim(),
    dorsePlaka: String(printEv.dorsePlaka || '').trim(),
    vehicleId: vehicleId && vehicleId !== 'manual' ? vehicleId : '',
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
    kantar: get('imzaKantarAd') || prev.kantar,
  }, getTakipFormDriverPayload(), getTakipPackagingPayload());
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

  // Rapora her zaman form/pending plakası gitsin; eski araç kaydı (özmal vb.) ezmesin
  const plaka = String(
    pending?.plaka || pp?.plaka || formGet('cekiciPlakaBilgi') || vehicle?.cekiciPlaka || ''
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
    bbt: String(pp?.bbt || snap.bbt || formGet('bbt') || '').trim(),
    bosBbt: String(pp?.bosBbt || snap.bosBbt || formGet('bosBbt') || '').trim(),
    cuval: String(pp?.cuval || snap.cuval || formGet('cuval') || '').trim(),
    bosCuval: String(pp?.bosCuval || snap.bosCuval || formGet('bosCuval') || '').trim(),
    palet: String(pp?.palet || snap.palet || formGet('palet') || '').trim(),
    torba: String(pp?.torba || snap.torba || formGet('torba') || '').trim(),
    seperatorBilgisi: String(pp?.seperatorBilgisi || snap.seperatorBilgisi || formGet('seperatorBilgisi') || '').trim(),
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

function slimIhracatRowsForStorage(rows) {
  return (Array.isArray(rows) ? rows : []).map((r) => {
    if (!r || typeof r !== 'object') return r;
    const out = { ...r };
    delete out._domOrder;
    delete out._status;
    delete out._durumText;
    delete out._blockSevk;
    delete out._blockAmb;
    if (out.blockMeta && typeof out.blockMeta === 'object') {
      const bm = out.blockMeta;
      out.blockMeta = {
        mainHeader: bm.mainHeader || '',
        blackLine1: bm.blackLine1 || '',
        blackLine2: bm.blackLine2 || '',
        portLine: bm.portLine || '',
        borusanLine: bm.borusanLine || '',
        exportLine: bm.exportLine || '',
        footerLine: bm.footerLine || '',
        bbtPaletLine: bm.bbtPaletLine || '',
        noteLine: bm.noteLine || '',
      };
      if (Array.isArray(bm.subLines) && bm.subLines.length) {
        out.blockMeta.subLines = bm.subLines.slice(0, 8);
      }
    }
    return out;
  });
}

async function saveDailyShipments(rows, meta) {
  try {
    const payload = slimIhracatRowsForStorage(rows);
    const metaObj = (meta && typeof meta === 'object') ? meta : {};
    if (window.DailyStore && typeof DailyStore.ensureReady === 'function') {
      await DailyStore.ensureReady();
    }
    let ok = false;
    if (window.DailyStore && typeof DailyStore.setAsync === 'function') {
      ok = await DailyStore.setAsync(payload, metaObj);
    } else if (window.DailyStore && typeof DailyStore.set === 'function') {
      ok = DailyStore.set(payload, metaObj);
    } else {
      localStorage.setItem(DAILY_SHIPMENT_KEY, JSON.stringify(payload));
      localStorage.setItem(DAILY_SHIPMENT_META, JSON.stringify(metaObj));
      ok = true;
    }
    if (!ok) return false;
    const cached = (window.DailyStore && typeof DailyStore.getRows === 'function')
      ? (DailyStore.getRows() || [])
      : payload;
    return Array.isArray(cached) && cached.length === payload.length;
  } catch (e) {
    return false;
  }
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

function _readAllShipmentRowsRaw() {
  const out = [];
  try {
    const raw = JSON.parse(localStorage.getItem(DAILY_SHIPMENT_KEY) || '[]');
    if (Array.isArray(raw)) out.push(...raw);
  } catch (e) { /* ignore */ }
  try {
    if (window.DailyStore && typeof DailyStore.getRows === 'function') {
      out.push(...(DailyStore.getRows() || []));
    }
  } catch (e) { /* ignore */ }
  try {
    if (typeof loadDailyShipments === 'function') {
      out.push(...(loadDailyShipments() || []));
    }
  } catch (e) { /* ignore */ }
  return out;
}

function _ensureDailyStoreSyncedFromLS() {
  try {
    if (!window.DailyStore || typeof DailyStore.getRows !== 'function' || typeof DailyStore.set !== 'function') return;
    const lsRows = JSON.parse(localStorage.getItem(DAILY_SHIPMENT_KEY) || '[]');
    if (!Array.isArray(lsRows) || !lsRows.length) return;
    const cached = DailyStore.getRows() || [];
    if (cached.length >= lsRows.length) return;
    const meta = JSON.parse(localStorage.getItem(DAILY_SHIPMENT_META) || '{}');
    DailyStore.set(lsRows, meta);
  } catch (e) { /* ignore */ }
}

function hasDailyExcelLoaded(){
  try {
    const rows = (_allDailyShipmentRows() || []).filter((x) => x && !x._ihracatEmptyBlock && _plateMatchKey(x.plaka));
    if (rows.length) return true;
    if (document.getElementById('ihracatDetailsModal') || window.__ihracatParkedDetailsModal) return true;
    return false;
  }
  catch(e){ return false; }
}

function _allDailyShipmentRows() {
  _ensureDailyStoreSyncedFromLS();
  const out = [];
  const seen = new Set();
  const addRow = (row) => {
    if (!row || row._ihracatEmptyBlock) return;
    const pk = _plateMatchKey(row.plaka);
    const fingerprint = [
      row.blockKey || '',
      row.blockHeaderRow ?? '',
      pk,
      String(row.id || ''),
      String(row.irsaliyeNo || ''),
      String(row.sira || ''),
      String(row.firma || ''),
      String(row.malzeme || ''),
      String(row.bbt || ''),
    ].join('\0');
    if (seen.has(fingerprint)) return;
    seen.add(fingerprint);
    out.push(row);
  };

  _readAllShipmentRowsRaw().forEach(addRow);

  try {
    if (typeof window._collectLiveIhracatShipmentRows === 'function') {
      (window._collectLiveIhracatShipmentRows() || []).forEach(addRow);
    }
  } catch (e) { /* ignore */ }

  return out;
}

/** Plaka İHRACAT Excel listesinde var mı? (piyasa-only plakalar false döner) */
function _plateMatchKey(plate) {
  const formatted = normPlate(plate || '');
  return _plateKeyForMatch(formatted || plate || '');
}

function _plateLookupCandidates(vehicle) {
  const seen = new Set();
  const out = [];
  const add = (raw) => {
    const key = _plateMatchKey(raw);
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(String(raw || '').trim());
  };
  add(vehicle?.cekiciPlaka);
  add(vehicle?.dorsePlaka);
  add(vehicle?.plaka);
  try { add(document.getElementById('cekiciPlakaBilgi')?.value); } catch (e) {}
  try { add(document.getElementById('dorsePlakaBilgi')?.value); } catch (e) {}
  return out;
}

function findDailyShipmentsByPlate(plate) {
  const needle = _plateMatchKey(plate);
  if (!needle) return [];
  const hits = [];
  const seen = new Set();
  const addHit = (row) => {
    if (!row || row._ihracatEmptyBlock) return;
    if (_plateMatchKey(row.plaka) !== needle) return;
    const sig = [
      row.blockKey || '',
      row.id || '',
      row.sira || '',
      row.firma || '',
      row.malzeme || '',
      row.bbt || '',
    ].join('|');
    if (seen.has(sig)) return;
    seen.add(sig);
    hits.push(row);
  };
  try {
    _readAllShipmentRowsRaw().forEach(addHit);
    (_allDailyShipmentRows() || []).forEach(addHit);
  } catch (e) { /* ignore */ }
  try {
    if (window.DailyStore && typeof DailyStore.findByPlate === 'function') {
      (DailyStore.findByPlate(plate) || []).forEach(addHit);
    }
  } catch (e) { /* ignore */ }
  return hits;
}

/** Kart açılışı: depo + canlı İhracat modal satırlarında plaka ara */
function findShipmentForPlate(plateOrVehicle) {
  const candidates = (plateOrVehicle && typeof plateOrVehicle === 'object')
    ? _plateLookupCandidates(plateOrVehicle)
    : [String(plateOrVehicle || '').trim()].filter(Boolean);

  for (const plate of candidates) {
    const hits = findDailyShipmentsByPlate(plate);
    if (hits.length) return hits.length === 1 ? hits[0] : hits[0];
  }

  try {
    if (typeof window.findIhracatShipmentByPlate === 'function') {
      for (const plate of candidates) {
        const live = window.findIhracatShipmentByPlate(plate);
        if (live) return live;
      }
    }
  } catch (e) { /* ignore */ }

  return null;
}

/** Excel satırını takip formu alanlarına yazar — ihracat-modal.js'e bağlı değil */
function fillTakipFormFromExcelRow(chosen) {
  if (!chosen) return false;
  const set = (id, val) => {
    const v = val != null ? String(val).trim() : '';
    if (!v) return;
    const el = document.getElementById(id);
    if (el) el.value = v;
  };

  const firmaFromRow = String(chosen.firma || '').trim();
  const ydOnly = String(chosen.ydKey || '').trim();
  const firmaVal = firmaFromRow
    || (/\bYD\d{1,4}\b/i.test(ydOnly) ? ydOnly : '')
    || ((String(chosen.headerText || '').match(/\b(YD\d{1,4})\b/i) || [])[1] || '');

  set('firmaKodu', firmaVal);
  set('firmaSelect', firmaVal);
  set('malzeme', chosen.malzeme);
  set('malzemeSelect', chosen.malzeme);

  let sevk = String(chosen.sevkYeri || '').trim();
  if (!sevk && typeof extractPrimaryPortFromShipment === 'function') {
    sevk = extractPrimaryPortFromShipment(chosen) || '';
  }
  if (!sevk && typeof getLimanCandidates === 'function') {
    sevk = (getLimanCandidates(chosen.headerText || '') || [])[0] || '';
  }
  set('sevkYeri', sevk);

  let amb = String(chosen.ambalaj || chosen.ambalajBilgisi || '').trim();
  if (!amb && typeof extractPrimaryAmbalajFromHeader === 'function') {
    amb = extractPrimaryAmbalajFromHeader(String(chosen.blockMeta?.mainHeader || chosen.headerText || '')) || '';
  }
  set('ambalajBilgisi', amb);

  const tonaj = (chosen.tonajKg != null && String(chosen.tonajKg).trim() !== '')
    ? String(chosen.tonajKg).trim()
    : (chosen.gidenTonaj != null && String(chosen.gidenTonaj).trim() !== ''
      ? String(chosen.gidenTonaj).trim()
      : '');
  set('tonaj', tonaj);
  set('bbt', chosen.bbt);
  set('palet', chosen.palet);
  set('bosBbt', chosen.bosBbt);
  set('yuklemeNotu', chosen.yuklemeNotu);

  const cuval = document.getElementById('cuval');
  const bosCuval = document.getElementById('bosCuval');
  if (cuval) {
    const cv = Number(chosen.cuval || 0);
    const bcv = Number(chosen.bosCuval || 0);
    if (cv > 0) {
      cuval.value = String(chosen.cuval);
      if (bosCuval) bosCuval.value = bcv > 0 ? String(chosen.bosCuval) : '';
    } else if (bcv > 0) {
      cuval.value = String(chosen.bosCuval);
      if (bosCuval) bosCuval.value = '';
    }
  }

  try {
    if (typeof applyShipmentTonajAndIrsaliye === 'function') applyShipmentTonajAndIrsaliye(chosen);
  } catch (e) { /* ignore */ }
  return true;
}

function hasDailyShipmentForPlate(plate) {
  return findDailyShipmentsByPlate(plate).length > 0;
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

/** "a.xlsx + b.xlsx" gibi birleşik etiketleri tekil dosya adlarına ayırır */
function splitIhracatFileNames(raw) {
  return String(raw || '')
    .split(/\s*\+\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function normalizeIhracatMetaFiles(meta) {
  const m = meta || {};
  const seen = new Set();
  const out = [];
  const add = (raw) => {
    splitIhracatFileNames(raw).forEach((n) => {
      if (!n || seen.has(n)) return;
      seen.add(n);
      out.push(n);
    });
  };
  if (Array.isArray(m.files)) m.files.forEach(add);
  if (m.fileName) add(m.fileName);
  return out;
}

function _ihracatRowBlockContentKey(row) {
  return (
    String(row?.blockKey || '').trim()
    || (row?.blockHeaderRow != null ? `BLK_${row.blockHeaderRow}` : '')
  );
}

function resolveIhracatRowFileLabel(row, meta) {
  const parts = splitIhracatFileNames(row?.fileName);
  if (parts.length === 1) return parts[0];
  const sources = normalizeIhracatMetaFiles(meta);
  const ck = _ihracatRowBlockContentKey(row);
  const rowHeader = String(row?.headerText || '').trim();
  const allRows = (typeof loadDailyShipments === 'function') ? (loadDailyShipments() || []) : [];
  if (ck && sources.length) {
    const headerMatches = [];
    for (const src of sources) {
      const hit = allRows.find((r) => {
        const p = splitIhracatFileNames(r?.fileName);
        return p.length === 1 && p[0] === src && _ihracatRowBlockContentKey(r) === ck;
      });
      if (!hit) continue;
      if (rowHeader && String(hit.headerText || '').trim() === rowHeader) {
        return src;
      }
      headerMatches.push(src);
    }
    if (headerMatches.length === 1) return headerMatches[0];
    for (const src of sources) {
      if (allRows.some((r) => {
        const p = splitIhracatFileNames(r?.fileName);
        return p.length === 1 && p[0] === src && _ihracatRowBlockContentKey(r) === ck;
      })) {
        return src;
      }
    }
  }
  if (sources.length === 1) return sources[0];
  return parts[0] || '';
}

/** Çoklu Excel: birleşik fileName ve meta.files kayıtlarını düzeltir */
function repairIhracatRowFileNames(rows, meta) {
  const list = Array.isArray(rows) ? rows : [];
  const baseMeta = meta || {};
  const sources = normalizeIhracatMetaFiles(baseMeta);
  if (!list.length && !sources.length) {
    return { rows: list, meta: baseMeta, changed: false };
  }

  const scoped = new Map();
  list.forEach((r) => {
    const parts = splitIhracatFileNames(r?.fileName);
    if (parts.length !== 1) return;
    const ck = _ihracatRowBlockContentKey(r);
    if (!ck) return;
    scoped.set(`${parts[0]}::${ck}`, parts[0]);
  });

  let rowsChanged = false;
  const fixedRows = list.map((r) => {
    const parts = splitIhracatFileNames(r?.fileName);
    if (parts.length === 1) return r;
    const ck = _ihracatRowBlockContentKey(r);
    let resolved = '';
    if (ck) {
      const rowHeader = String(r?.headerText || '').trim();
      if (rowHeader) {
        for (const src of sources) {
          const match = list.find((x) => {
            const p = splitIhracatFileNames(x?.fileName);
            return p.length === 1 && p[0] === src
              && _ihracatRowBlockContentKey(x) === ck
              && String(x?.headerText || '').trim() === rowHeader;
          });
          if (match) {
            resolved = src;
            break;
          }
        }
      }
      if (!resolved) {
        for (const src of sources) {
          if (scoped.has(`${src}::${ck}`)) {
            resolved = scoped.get(`${src}::${ck}`);
            break;
          }
        }
      }
    }
    if (!resolved && sources.length === 1) resolved = sources[0];
    if (!resolved && parts.length) resolved = parts[0];
    if (!resolved || String(r.fileName || '').trim() === resolved) return r;
    rowsChanged = true;
    return { ...r, fileName: resolved };
  });

  const fixedMeta = { ...baseMeta };
  const normFiles = normalizeIhracatMetaFiles(fixedMeta);
  let metaChanged = false;
  if (normFiles.length) {
    const prevJson = JSON.stringify(fixedMeta.files || []);
    if (prevJson !== JSON.stringify(normFiles)) metaChanged = true;
    fixedMeta.files = normFiles;
    const joined = normFiles.join(' + ');
    if (String(fixedMeta.fileName || '') !== joined) metaChanged = true;
    fixedMeta.fileName = joined;
  }

  return { rows: fixedRows, meta: fixedMeta, changed: rowsChanged || metaChanged };
}

/** Yüklü İHRACAT Excel dosya adları (meta + satır fileName) */
function listIhracatExcelSources() {
  const rows = loadDailyShipments() || [];
  const meta = loadDailyMeta() || {};
  const seen = new Set();
  const out = [];
  const addName = (raw) => {
    splitIhracatFileNames(raw).forEach((n) => {
      if (!n || seen.has(n)) return;
      seen.add(n);
      out.push(n);
    });
  };
  normalizeIhracatMetaFiles(meta).forEach(addName);
  rows.forEach((r) => addName(r.fileName));
  return out;
}

function countIhracatRowsForSource(sourceName) {
  const target = String(sourceName || '').trim();
  if (!target) return 0;
  const rows = loadDailyShipments() || [];
  const tagged = rows.filter((r) => String(r.fileName || '').trim() === target);
  if (tagged.length) return tagged.length;
  const sources = listIhracatExcelSources();
  if (sources.length === 1 && sources[0] === target) return rows.length;
  return 0;
}

function removeDailyShipmentsBySource(sourceName) {
  return removeDailyShipmentsBySourceAsync(sourceName);
}

async function removeDailyShipmentsBySourceAsync(sourceName) {
  const target = String(sourceName || '').trim();
  if (!target) return false;
  const rows = loadDailyShipments() || [];
  const meta = loadDailyMeta() || {};
  let kept = rows.filter((r) => String(r.fileName || '').trim() !== target);
  if (kept.length === rows.length && countIhracatRowsForSource(target) === rows.length) {
    kept = [];
  }
  if (!kept.length) {
    try {
      if (window.DailyStore && typeof DailyStore.clear === 'function') {
        return DailyStore.clear();
      }
      if (window.DailyStore && typeof DailyStore.setAsync === 'function') {
        return DailyStore.setAsync([], {});
      }
      localStorage.removeItem(DAILY_SHIPMENT_KEY);
      localStorage.removeItem(DAILY_SHIPMENT_META);
      return true;
    } catch (e) {
      return false;
    }
  }
  const prevFiles = normalizeIhracatMetaFiles(meta);
  const nextFiles = prevFiles.filter((f) => String(f).trim() !== target);
  const rowFiles = [];
  kept.forEach((r) => splitIhracatFileNames(r.fileName).forEach((n) => rowFiles.push(n)));
  const files = nextFiles.length ? nextFiles : [...new Set(rowFiles)];
  const metaToSave = Object.assign({}, meta, {
    files: files.length ? files : undefined,
    fileName: files.length ? files.join(' + ') : '',
    count: kept.length,
  });
  if (!metaToSave.fileName && kept.length) {
    metaToSave.fileName = files.join(' + ') || meta.fileName || '';
  }
  return saveDailyShipments(kept, metaToSave);
}

function _ihracatLoadedRowBlockId(row) {
  if (typeof window.buildIhracatLoadedRowBlockId === 'function') {
    return window.buildIhracatLoadedRowBlockId(row);
  }
  const fileName = String(row?.fileName || '').trim() || '_';
  const blockKey = String(row?.blockKey || '').trim()
    || (row?.blockHeaderRow != null ? `BLK_${row.blockHeaderRow}` : 'unknown');
  return `${fileName}::${blockKey}`;
}

function removeDailyShipmentsByBlocks(selectedBlocks) {
  return removeDailyShipmentsByBlocksAsync(selectedBlocks);
}

async function removeDailyShipmentsByBlocksAsync(selectedBlocks) {
  const selectedIds = new Set(
    (selectedBlocks || []).map((b) => String(b.id || '').trim()).filter(Boolean)
  );
  if (!selectedIds.size) return false;

  const rows = loadDailyShipments() || [];
  const meta = loadDailyMeta() || {};
  const kept = rows.filter((r) => !selectedIds.has(_ihracatLoadedRowBlockId(r)));

  if (!kept.length) {
    try {
      if (window.DailyStore && typeof DailyStore.clear === 'function') {
        return DailyStore.clear();
      }
      if (window.DailyStore && typeof DailyStore.setAsync === 'function') {
        return DailyStore.setAsync([], {});
      }
      localStorage.removeItem(DAILY_SHIPMENT_KEY);
      localStorage.removeItem(DAILY_SHIPMENT_META);
      return true;
    } catch (e) {
      return false;
    }
  }

  const rowFiles = [];
  kept.forEach((r) => splitIhracatFileNames(r.fileName).forEach((n) => rowFiles.push(n)));
  const prevFiles = normalizeIhracatMetaFiles(meta).filter((f) => rowFiles.includes(String(f).trim()));
  const uniqRowFiles = [...new Set(rowFiles)];
  const metaToSave = Object.assign({}, meta, {
    files: prevFiles.length ? prevFiles : undefined,
    fileName: prevFiles.length ? prevFiles.join(' + ') : (uniqRowFiles.join(' + ') || meta.fileName || ''),
    count: kept.length,
  });
  return saveDailyShipments(kept, metaToSave);
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
    const allRows = (typeof loadDailyShipments === 'function') ? (loadDailyShipments() || []) : [];
    const cnt = allRows.filter((r) => !r._ihracatEmptyBlock).length;
    out.ihrCount = cnt;
    if (meta && meta.fileName) {
      out.ihrLine = meta.fileName;
    } else if (meta && meta.dateKey) {
      out.ihrLine = _formatDateKeyTR(meta.dateKey);
    } else if (cnt) out.ihrLine = `${cnt} kayıt`;
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
    try {
      const meta = (typeof loadDailyMeta === 'function') ? (loadDailyMeta() || {}) : {};
      return _buildIhracatWarnLabel(meta);
    } catch (e) {}
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
/** Bilinen liman/terminal adları — uzun eşleşmeler önce (GEMPORT/SAFIPORT karışmasın diye genel PORT yok) */
const IHR_PORT_DEFS = [
  { re: /\bDP\s+WORLD\b/i, label: 'DP WORLD' },
  { re: /\bBORUSAN\s*\/\s*GEML[Iİ]K\b/i, label: 'BORUSAN/GEMLİK' },
  { re: /\bKUMPORT\s+L[Iİ]MAN[Iİ]?\b/i, label: 'KUMPORT LİMANI' },
  { re: /\bK[OÖ]RFEZ\s+MEDLOG\b/i, label: 'KÖRFEZ MEDLOG' },
  { re: /\bYILPORT\s+GEML[Iİ]K\b/i, label: 'YILPORT GEMLİK' },
  { re: /\bAKDEN[Iİ]Z\s+PORT\b/i, label: 'AKDENİZ PORT' },
  { re: /\bASYA\s+PORTS?\b/i, label: 'ASYA PORT' },
  { re: /\bHAYDARPA[SŞ]A\b/i, label: 'HAYDARPAŞA' },
  { re: /\bGEMPORT\b/i, label: 'GEMPORT' },
  { re: /\bSAF[Iİ]PORT\b/i, label: 'SAFİPORT' },
  { re: /\bMARDA[SŞ]\b/i, label: 'MARDAŞ' },
  { re: /\bMARPORT\b/i, label: 'MARPORT' },
  { re: /\bKUMPORT\b/i, label: 'KUMPORT' },
  { re: /\bL[Iİ]MA[SŞ]\b/i, label: 'LİMAŞ' },
  { re: /\bALSANCAK\b/i, label: 'ALSANCAK' },
  { re: /\bYILPORT\b/i, label: 'YILPORT' },
  { re: /\bEVYAP\b/i, label: 'EVYAP' },
  { re: /\bGEML[Iİ]K\b/i, label: 'GEMLİK' },
  { re: /\bMEDLOG\b/i, label: 'MEDLOG' },
  { re: /\bK[OÖ]RFEZ\b/i, label: 'KÖRFEZ' },
];

function _findKnownPortsInText(text) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  if (!s) return [];
  const hits = [];
  for (const def of IHR_PORT_DEFS) {
    const m = s.match(def.re);
    if (m && m.index != null) hits.push({ label: def.label, index: m.index });
  }
  hits.sort((a, b) => a.index - b.index);
  const seen = new Set();
  const out = [];
  for (const h of hits) {
    if (seen.has(h.label)) continue;
    seen.add(h.label);
    out.push(h.label);
  }
  return out;
}

function extractPortFromHeaderText(headerText) {
  const s = String(headerText || '').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  const parts = s.split('/').map((p) => p.trim()).filter(Boolean);
  for (let i = parts.length - 1; i >= 0; i--) {
    const segPorts = _findKnownPortsInText(parts[i]);
    if (segPorts.length) return segPorts[segPorts.length - 1];
  }
  const all = _findKnownPortsInText(s);
  return all.length ? all[all.length - 1] : '';
}

function extractPrimaryPortFromShipment(sh) {
  const meta = sh?.blockMeta || {};
  const stored = String(meta.portLine || meta.borusanLine || sh?.sevkYeri || '').trim();
  if (stored) return stored;
  const ht = String(meta.mainHeader || sh?.headerText || '').trim();
  return extractPortFromHeaderText(ht);
}

function _normalizeAmbalajHeaderRaw(raw) {
  let s = String(raw || '');
  s = s.replace(/\b(\d{1,3})\.(\d{3})\b/g, '$1$2');
  s = s.replace(/\b(\d{1,3}),(\d{3})\b/g, '$1$2');
  s = s.replace(/'/g, ' ');
  s = s.replace(/\bKG\s*LIK\b/gi, 'KG LIK');
  return s.replace(/\s+/g, ' ').trim();
}

function _ambalajPartIsNoise(part) {
  const p = String(part || '').trim();
  if (!p) return true;
  if (/\bHP\s*[\d.,]+\s*-\s*[\d.,]+/i.test(p)) return true;
  if (/\bBOOKING\s*NO\b/i.test(p)) return true;
  if (/\bLOT\s*NO\b/i.test(p)) return true;
  if (/\bEXPORT\s*REF\b/i.test(p)) return true;
  if (/\bGEM[İI]\s*DETAYI\b/i.test(p)) return true;
  return false;
}

function _collectAmbalajMatches(headerText) {
  const normalized = _normalizeAmbalajHeaderRaw(headerText).toUpperCase();
  if (!normalized) return [];

  const parts = normalized.split('/').map((p) => p.trim()).filter(Boolean);
  const results = [];

  for (const part of parts) {
    if (_ambalajPartIsNoise(part)) continue;

    for (const m of part.matchAll(/\bNET\s*([0-9]{1,5})\s*KG\b([^\/]*)/gi)) {
      const kg = parseInt(m[1], 10);
      if (!Number.isFinite(kg)) continue;
      let text = cleanAmbalajText(`NET ${kg} KG ${m[2] || ''}`);
      if (text) results.push({ kg, text });
    }

    // NET 1250 BASKISIZ … (Excel'de KG yazılmadan)
    for (const m of part.matchAll(/\bNET\s*([0-9]{1,5})\s+(?!KG\b)((?:BASK|LINER|LİNER|BIG|BİG|ÇUV|CUVAL|PALET|BBT|TORBA|BAG)[^\/]*)/gi)) {
      const kg = parseInt(m[1], 10);
      if (!Number.isFinite(kg)) continue;
      let text = cleanAmbalajText(`NET ${kg} KG ${m[2] || ''}`);
      if (text) results.push({ kg, text });
    }

    for (const m of part.matchAll(/\b([0-9]{1,5})\s*KG\s*(LIK)?\b([^\/]*)/gi)) {
      const before = part.slice(Math.max(0, m.index - 4), m.index);
      if (/\bNET\s*$/i.test(before)) continue;
      const kg = parseInt(m[1], 10);
      if (!Number.isFinite(kg)) continue;
      const rest = String(m[3] || '').trim();
      if (!/(BIGBAG|BIG BAG|BİGBAG|CUVAL|ÇUVAL|TORBA|JUMBO|SACK|BAG|PALET|BBT)/i.test(rest)) continue;
      let text = cleanAmbalajText(`NET ${kg} KG ${rest}`);
      if (text) results.push({ kg, text });
    }
  }

  const uniq = [];
  const seen = new Set();
  for (const r of results) {
    const key = String(r.text || '').toUpperCase().trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    uniq.push(r);
  }
  uniq.sort((a, b) => (a.kg || 0) - (b.kg || 0));
  return uniq;
}

// Ambalaj metnini header satırından yakala (NET'li/NET'siz, 1 veya 2 ambalaj):
function extractAmbalajFromHeader(headerText) {
  const uniq = _collectAmbalajMatches(headerText);
  if (!uniq.length) return '';
  return uniq.map((x) => x.text).join(' + ');
}

function extractPrimaryAmbalajFromHeader(headerText) {
  return extractAmbalajFromHeader(headerText);
}

/** Blok ambalaj metninden birim NET kg (örn. NET 1250 KG → 1250). */
function extractNetKgFromAmbalajText(text) {
  const matches = _collectAmbalajMatches(text);
  if (matches.length && matches[0].kg > 0) return matches[0].kg;
  const s = String(text || '').replace(/\b(\d{1,3})\.(\d{3})\b/g, '$1$2').replace(/\s+/g, ' ');
  const m =
    s.match(/\bNET\s*([0-9]{1,5})\s*KG\b/i) ||
    s.match(/\bNET\s*([0-9]{1,5})\b/i) ||
    s.match(/\b([0-9]{3,5})\s*KG\b/i);
  if (!m) return 0;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function cleanAmbalajText(text) {
  return String(text || '')
    .replace(/\bBOOKING\b.*$/i, '')
    .replace(/\bGEM[İI]\s*DETAYI\b.*$/i, '')
    .replace(/\bGEM[İI]\b.*$/i, '')
    .replace(/\bGEMI\b.*$/i, '')
    .replace(/\bEXPORT\b.*$/i, '')
    .replace(/\b(GEMPORT|SAF[Iİ]PORT|KUMPORT|MARPORT|MARDA[SŞ]|EVYAP|YILPORT)\b.*$/i, '')
    .replace(/\bTON\b.*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function getAmbalajCandidates(headerText) {
  return _collectAmbalajMatches(headerText).map((x) => x.text);
}

function getLimanCandidates(headerText) {
  const s = String(headerText || '').replace(/\s+/g, ' ').trim();
  if (!s) return [];

  const ordered = [];
  const seen = new Set();
  const add = (label) => {
    const key = String(label || '').trim();
    if (!key || seen.has(key)) return;
    seen.add(key);
    ordered.push(key);
  };

  const parts = s.split('/').map((p) => p.trim()).filter(Boolean);
  for (let i = parts.length - 1; i >= 0; i--) {
    _findKnownPortsInText(parts[i]).forEach(add);
  }
  _findKnownPortsInText(s).forEach(add);

  const primary = extractPortFromHeaderText(s);
  if (primary) {
    return [primary, ...ordered.filter((x) => x !== primary)].slice(0, 6);
  }
  return ordered.slice(0, 6);
}

// ✅ YD anahtarını normalize et (YD28(G) -> YD28)
function normalizeYdKey(val){
  const s = String(val || '');
  const m = s.match(/\b(YD\d{1,4})\b/i);
  return m ? m[1].toUpperCase() : s.trim().toUpperCase();
}
function findSevkYeriNear(grid, headerRowIdx, headerText) {
  const fromHeader = extractPortFromHeaderText(headerText);
  if (fromHeader) return fromHeader;
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
    if (!s) continue;
    const port = extractPortFromHeaderText(s);
    if (port) return port;
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
  let out = String(s || '');
  for (const def of IHR_PORT_DEFS) {
    out = out.replace(new RegExp(`\\s*\\/\\s*${def.re.source}\\s*`, 'gi'), ' / ');
  }
  return out.replace(/\s*\/\s*$/g, '').replace(/\s+/g, ' ').trim();
}

function _stripTrailingPortFromHeader(s) {
  const text = String(s || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  const parts = text.split('/').map((p) => p.trim()).filter(Boolean);
  if (parts.length <= 1) return text;
  const last = parts[parts.length - 1];
  if (extractPortFromHeaderText(last)) return parts.slice(0, -1).join(' / ');
  return text;
}

function _splitMainHeaderBlackLines(mainHeader) {
  let s = _stripTrailingPortFromHeader(mainHeader);
  if (!s) return { line1: '', line2: '' };

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
    const portFromMain = extractPortFromHeaderText(mainItem.main);
    if (portFromMain) out.portLine = portFromMain;
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
  return extractPortFromHeaderText(headerText);
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
    const pm = extractPortFromHeaderText(String(meta.mainHeader || headerText));
    if (pm) portLine = pm;
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

function _expandMergedCellsInGrid(grid, ws) {
  const merges = ws && ws['!merges'];
  if (!Array.isArray(merges) || !merges.length) return grid;
  for (const m of merges) {
    if (!m || !m.s) continue;
    const src = grid[m.s.r]?.[m.s.c];
    if (src == null || !String(src).trim()) continue;
    for (let rr = m.s.r; rr <= m.e.r; rr++) {
      if (!grid[rr]) grid[rr] = [];
      for (let cc = m.s.c; cc <= m.e.c; cc++) {
        const cur = grid[rr][cc];
        if (cur == null || !String(cur).trim()) grid[rr][cc] = src;
      }
    }
  }
  return grid;
}

function parseIhracatRowsFromWorkbook(wb, sheetName, opts) {
  opts = opts || {};
  const onlyBlocks = opts.onlyBlocks || null;
  const fileLabel = opts.fileName || '';
  if (!wb || !sheetName) return { ok: false, msg: 'Sayfa yok.', rows: [], meta: {}, stats: {} };
  const ws = wb.Sheets[sheetName];
  let grid = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, blankrows: true });
  grid = _expandMergedCellsInGrid(grid, ws);

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
    const sevkYeri = extractPrimaryPortFromShipment({ headerText, blockMeta }) || '';
    const ambalaj = extractPrimaryAmbalajFromHeader(headerText) || '';
    const noteColumnIndex = (cols.aciklama !== undefined ? cols.aciklama : 1);
    let blockYuklemeNotu = '';
    let blockTotals = null;
    const ydFromHeader = ((headerText || '').match(/\b(YD\d{1,4})\b/i) || [])[1]?.toUpperCase() || '';
    const blockMalzeme = (typeof _extractMalzeme === 'function' ? _extractMalzeme(headerText) : '') || '';
    const blockRows = [];
    const blockPendingPlakaNotes = [];
    const blockIrsCol = detectIrsaliyeColumnIndex(grid, r, { ...cols, ...blockCols });
    const parseCols = { ...cols, ...blockCols };
    if (blockIrsCol !== undefined) parseCols.irsaliyeNo = blockIrsCol;
    else if (blockCols.plaka !== undefined && blockCols.plaka >= 2) parseCols.irsaliyeNo = blockCols.plaka - 2;

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

      if (isIhracatPendingPlakaCell(plakaRaw)) {
        blockPendingPlakaNotes.push({
          text: String(plakaRaw).trim(),
          remainingBbt: parseIhracatPendingPlakaBbt(plakaRaw),
        });
        continue;
      }

      // ✅ ydKey kısa anahtar olarak kalsın
const firmaFromN = extractFirmaTextFromN(ws, rr + 1, 40);
const ydKey = (((firmaFromN || '').match(/\b(YD\d{1,4})\b/i) || [])[1] || ydFromHeader || '').trim().toUpperCase();

// ✅ Firma = N sütunundaki TAM hücre
const firma = String(firmaFromN || ydKey || '').trim();

     const irsaliyeNo = resolveIrsaliyeFromRow(d, parseCols);
     const siraVal = blockCols.sirano !== undefined ? (d[blockCols.sirano] != null ? String(d[blockCols.sirano]).trim() : '') : '';
     const blockFooterNote = getIhracatBlockFooterNote({ blockMeta });
     blockRows.push({
  id: irsaliyeNo || siraVal,
  sira: siraVal,
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
  gidenTonaj: blockCols.gidenTonaj !== undefined ? _nz(d[blockCols.gidenTonaj]) : '',

  yuklemeNotu: (String(d[noteColumnIndex] || '').trim() || blockYuklemeNotu),

  firma,
  sevkYeri,
  ambalaj,
  blockPendingPlakaNotes,
});
    }

    blockRows.forEach((br) => {
      br.blockPendingPlakaNotes = blockPendingPlakaNotes;
    });

    if (!blockRows.length) {
      rowsOut.push({
        id: `BLK_EMPTY_${r}`,
        plaka: '',
        sira: '',
        _ihracatEmptyBlock: true,
        blockPendingPlakaNotes,
        ydKey: ydFromHeader,
        firma: ydFromHeader,
        headerText,
        blockKey: `BLK_${r}`,
        blockHeaderRow: r,
        blockMeta,
        blockFooterNote: getIhracatBlockFooterNote({ blockMeta }),
        blockTotals,
        fileName: String(fileLabel || '').trim(),
        malzeme: blockMalzeme,
        sevkYeri,
        ambalaj,
        tonajKg: '',
        bbt: '',
        cuval: '',
        palet: '',
        bosBbt: '',
        bosCuval: '',
        yuklemeNotu: blockYuklemeNotu,
      });
    } else {
      rowsOut.push(...blockRows);
    }
  }

  // uniq
  const uniq = [];
  const seen = new Set();
  for (const x of rowsOut) {
    const blockScope = (typeof _ihracatBlockGroupKey === 'function')
      ? _ihracatBlockGroupKey(x)
      : `${String(x.fileName || '').trim()}::${String(x.blockKey || x.id || '').trim()}`;
    const k = x._ihracatEmptyBlock
      ? `${blockScope}::__empty__${String(x.id || x.blockKey || '').trim()}`
      : `${blockScope}::${x.plaka}__${x.id}__${x.sira}`;
    if (seen.has(k)) continue;
    seen.add(k);
    uniq.push(x);
  }

  const meta = {
    dateKey: _dateKeyFromFileName(fileLabel) || _todayKeyTR(),
    sheetName: sheetName,
    fileName: fileLabel,
    importedAt: new Date().toISOString(),
    count: uniq.filter((x) => !x._ihracatEmptyBlock).length,
    blockCount: new Set(uniq.map((x) => x.blockKey).filter(Boolean)).size,
    fileFingerprint: opts.fileFingerprint || null,
  };

  const plateRows = uniq.filter((x) => !x._ihracatEmptyBlock);
  const eu = window.ExcelUtils || {};
  const dupPlateRows = eu.findDuplicatePlateRows ? eu.findDuplicatePlateRows(plateRows) : [];
  const dupPlates = dupPlateRows.length;
  const collisions = eu.findIrsaliyeCollisions ? eu.findIrsaliyeCollisions(plateRows) : [];

  return {
    ok: true,
    rows: uniq,
    meta,
    stats: {
      accepted: plateRows.length,
      blocks: meta.blockCount,
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
          .concat(normalizeIhracatMetaFiles(existingMeta))
          .concat((file && file.name) || meta.fileName || '');
        const seenF = new Set();
        const uniqFiles = [];
        files.forEach((f) => {
          splitIhracatFileNames(f).forEach((part) => {
            if (!seenF.has(part)) {
              seenF.add(part);
              uniqFiles.push(part);
            }
          });
        });
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

  try {
    if (window.DailyStore && typeof DailyStore.ensureReady === 'function') {
      await DailyStore.ensureReady();
    }
  } catch (e) { /* ignore */ }

  const ok = await saveDailyShipments(rowsToSave, metaToSave);
  if (!ok) {
    return {
      ok: false,
      msg: 'Kaydetme başarısız (tarayıcı deposu dolu). F12 → Application → Local Storage içindeki eski yedekleri silin veya Ctrl+F5 sonrası tekrar deneyin.',
    };
  }

  purgeStrictExcelCaches();
  rebuildListsFromExcelRows(rowsToSave);
  try {
    window.refreshHeaderExcelInfo && window.refreshHeaderExcelInfo();
  } catch (e) {}

  return { ok: true, msg: `✅ Excel yüklendi: ${uniq2.length} satır`, meta: metaToSave };
}

window.parseIhracatRowsFromWorkbook = parseIhracatRowsFromWorkbook;
window.normPlate = normPlate;
window.fillTakipFormFromExcelRow = fillTakipFormFromExcelRow;
window.findDailyShipmentsByPlate = findDailyShipmentsByPlate;
window.findShipmentForPlate = findShipmentForPlate;
window.hasDailyExcelLoaded = hasDailyExcelLoaded;
window.commitIhracatImport = commitIhracatImport;
window.applyReprintSnapshotToTakipForm = applyReprintSnapshotToTakipForm;
window.getTakipPackagingPayload = getTakipPackagingPayload;
window.splitIhracatFileNames = splitIhracatFileNames;
window.normalizeIhracatMetaFiles = normalizeIhracatMetaFiles;
window.listIhracatExcelSources = listIhracatExcelSources;
window.resolveIhracatRowFileLabel = resolveIhracatRowFileLabel;
window.repairIhracatRowFileNames = repairIhracatRowFileNames;
window.resolveTakipVehicleIdForPrint = resolveTakipVehicleIdForPrint;

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
