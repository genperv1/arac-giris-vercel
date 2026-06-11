// app-signatures-prefs.js — imza + tercihler
// Otomatik bölüm — scripts/split-large-files.js

// =============================
// Kantar / Sevkiyat saha imza eşleştirme (Ayarlar + signatures-registry)
// =============================
const LEGACY_KANTAR_SIG = {
  "BURAK KARATAŞ": "signatures/burak_karatas.png",
  "BEKİR DOĞRU": "signatures/bekir_dogru.png",
  "BATUHAN KOCABAY": "signatures/batuhan_kocabay.png",
  "BATUHAN CINAR": "signatures/batuhan_cinar.png",
  "BURAK TALAY": "signatures/burak_talay.png"
};

function resolveKantarSignatureSrc(name) {
  try {
    if (window.SignatureRegistry) {
      const src = window.SignatureRegistry.resolveSignatureSrc('kantar', name);
      if (src) return src;
    }
  } catch (e) { /* ignore */ }
  return LEGACY_KANTAR_SIG[(name || '').trim().toUpperCase()] || '';
}

function resolveSahaSignatureSrc(name) {
  try {
    if (window.SignatureRegistry) {
      return window.SignatureRegistry.resolveSignatureSrc('saha', name) || '';
    }
  } catch (e) { /* ignore */ }
  return '';
}

function applySignaturePreview(inputId, imgId, phId, resolveFn) {
  const input = document.getElementById(inputId);
  const img = document.getElementById(imgId);
  const ph = document.getElementById(phId);
  if (!input || !img || !ph) return;
  const src = resolveFn(input.value);
  if (src) {
    img.onerror = () => {
      img.style.display = 'none';
      ph.style.display = 'block';
      ph.textContent = 'İmza bulunamadı';
    };
    img.src = src;
    img.style.display = 'block';
    ph.style.display = 'none';
  } else {
    try { img.removeAttribute('src'); } catch (_) {}
    img.style.display = 'none';
    ph.style.display = 'block';
    ph.textContent = 'İmza otomatik gelecek';
  }
}

function refreshKantarSignaturePreview() {
  applySignaturePreview('imzaKantarAd', 'imzaKantarImg', 'imzaKantarPlaceholder', resolveKantarSignatureSrc);
}

function refreshSahaSignaturePreview() {
  applySignaturePreview('imzaSahaAd', 'imzaSahaImg', 'imzaSahaPlaceholder', resolveSahaSignatureSrc);
}

function getKantarPersonelNames() {
  const fromReg = (window.SignatureRegistry && window.SignatureRegistry.getNamesForRole('kantar')) || [];
  if (fromReg.length) return fromReg;
  return Object.keys(LEGACY_KANTAR_SIG);
}

function getSahaPersonelNames() {
  const fromReg = (window.SignatureRegistry && window.SignatureRegistry.getNamesForRole('saha')) || [];
  return fromReg.length ? fromReg : [];
}

function populateSignatureDatalists() {
  const namesK = getKantarPersonelNames();
  const namesS = getSahaPersonelNames();
  const dlK = document.getElementById('kantarPersonelList');
  const dlS = document.getElementById('sahaPersonelList');
  if (dlK) dlK.innerHTML = namesK.map((n) => `<option value="${String(n).replace(/"/g, '&quot;')}"></option>`).join('');
  if (dlS) dlS.innerHTML = namesS.map((n) => `<option value="${String(n).replace(/"/g, '&quot;')}"></option>`).join('');
}

try {
  window.getKantarPersonelNames = getKantarPersonelNames;
  window.getSahaPersonelNames = getSahaPersonelNames;
} catch (_) {}

// =============================
// KANTAR seçimi kalıcı olsun (kullanıcı bazlı)
// - Her login ID için ayrı saklar.
// - Kullanıcı değiştirmezse form açıldığında otomatik doldurur.
// =============================
const KANTAR_PREF_PREFIX = 'pref_kantar_default_v1_';

function getCurrentUserIdSafe() {
  try {
    return String(localStorage.getItem('currentUserId') || '').trim().toUpperCase();
  } catch (e) {
    return '';
  }
}

function getKantarPrefKey() {
  const uid = getCurrentUserIdSafe();
  return KANTAR_PREF_PREFIX + (uid || 'GLOBAL');
}

function loadSavedKantarName() {
  try {
    const key = getKantarPrefKey();
    const v1 = localStorage.getItem(key);
    if (v1 && String(v1).trim()) return String(v1).trim();
    const vG = localStorage.getItem(KANTAR_PREF_PREFIX + 'GLOBAL');
    return (vG && String(vG).trim()) ? String(vG).trim() : '';
  } catch (e) {
    return '';
  }
}

function persistKantarName(name) {
  try {
    const key = getKantarPrefKey();
    const v = String(name || '').trim();
    if (v) localStorage.setItem(key, v);
    else localStorage.removeItem(key);
  } catch (e) {}
}

// Basım yeri tercihini sakla (kullanıcı bazlı, kantar ile aynı mantık)
const BASIM_PREF_PREFIX = 'pref_basim_yeri_v1_';
function getBasimPrefKey() {
  const uid = getCurrentUserIdSafe();
  return BASIM_PREF_PREFIX + (uid || 'GLOBAL');
}
function loadSavedBasimYeri() {
  try {
    const key = getBasimPrefKey();
    const v1 = localStorage.getItem(key);
    if (v1 && String(v1).trim()) return String(v1).trim();
    const vG = localStorage.getItem(BASIM_PREF_PREFIX + 'GLOBAL');
    return (vG && String(vG).trim()) ? String(vG).trim() : '';
  } catch (e) { return ''; }
}
function persistBasimYeri(val) {
  try {
    const key = getBasimPrefKey();
    const v = String(val || '').trim();
    if (v) localStorage.setItem(key, v);
    else localStorage.removeItem(key);
  } catch (e) {}
}
