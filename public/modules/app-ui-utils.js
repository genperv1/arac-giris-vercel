// app-ui-utils.js — toast, plaka format, WhatsApp
// Otomatik bölüm — scripts/modularize-remaining.js

        // Plaka formatlama fonksiyonu
// ✅ TR plaka standartlayıcı (il 2 hane + harf 1-3 + rakam 1-4)
// Örn: "03 VK8 78" -> "03 VK 878", "43 LU6 28" -> "43 LU 628", "01 BT9 68" -> "01 BT 968"
/** Araçlar ▾ menüsünü kapat (details açık kalmasın) */
function closeAppToolsMenu() {
  try {
    document.querySelectorAll('details.app-tools-menu').forEach(function (el) {
      el.open = false;
      el.removeAttribute('open');
    });
  } catch (e) {}
}
window.closeAppToolsMenu = closeAppToolsMenu;

/** Dropdown menüler: dışarı tıklanınca veya Escape ile kapanır */
function bindAppToolsMenuOutsideClose() {
  if (window.__appToolsMenuOutsideBound) return;
  window.__appToolsMenuOutsideBound = true;

  document.addEventListener('click', function (e) {
    const openMenus = document.querySelectorAll('details.app-tools-menu[open]');
    if (!openMenus.length) return;

    const menu = e.target.closest('details.app-tools-menu');
    if (menu) {
      openMenus.forEach(function (el) {
        if (el !== menu) {
          el.open = false;
          el.removeAttribute('open');
        }
      });
      return;
    }

    closeAppToolsMenu();
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeAppToolsMenu();
  });
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindAppToolsMenuOutsideClose);
  } else {
    bindAppToolsMenuOutsideClose();
  }
}

// ✅ Sayfa mesajı (alert) yerine hızlı bildirim — uygulama teması (Piyasa / İhracat ile ortak)
function _inferToastType(message) {
  const m = String(message || '').trim();
  if (/^✅/.test(m)) return 'success';
  if (/^❌/.test(m)) return 'error';
  if (/^⚠️?/.test(m)) return 'warn';
  if (/^ℹ️?/.test(m)) return 'info';
  return 'info';
}

function _toastIconForType(type) {
  if (type === 'success') return '✅';
  if (type === 'error') return '❌';
  if (type === 'warn') return '⚠️';
  return 'ℹ️';
}

function showToast(message, msOrType, maybeMs) {
  try {
    const TOAST_TYPES = new Set(['success', 'error', 'warn', 'info']);
    let type = 'info';
    let ms = 2200;
    if (typeof msOrType === 'string' && TOAST_TYPES.has(msOrType)) {
      type = msOrType;
      ms = typeof maybeMs === 'number' ? maybeMs : 2800;
    } else {
      if (typeof msOrType === 'number') ms = msOrType;
      type = _inferToastType(message);
    }

    const raw = String(message || '').trim();
    const text = raw.replace(/^(\u2705|\u274c|\u26a0\ufe0f?|\u2139\ufe0f?)\s*/, '').trim() || raw;
    const icon = _toastIconForType(type);

    const id = 'toastBox';
    let box = document.getElementById(id);
    if (!box) {
      box = document.createElement('div');
      box.id = id;
      document.body.appendChild(box);
    }

    const item = document.createElement('div');
    item.className = `app-toast-item is-${type}`;
    item.innerHTML = `<span class="app-toast-item__icon" aria-hidden="true">${icon}</span><span class="app-toast-item__text"></span>`;
    item.querySelector('.app-toast-item__text').textContent = text;
    box.appendChild(item);

    requestAnimationFrame(() => {
      item.style.opacity = '1';
    });

    setTimeout(() => {
      item.style.opacity = '0';
      item.style.transform = 'translateY(6px)';
      item.style.transition = 'opacity 0.18s ease, transform 0.18s ease';
      setTimeout(() => item.remove(), 200);
    }, ms);
  } catch (e) {}
}
window.showToast = showToast;

function normalizeNetsisPlate(value) {
  if (!value) return '';
  return String(value).toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function normalizeNetsisPhone(value) {
  if (!value) return '';
  return String(value).replace(/[^0-9]/g, '');
}

function copyNetsisVehicleText(vehicle) {
  if (!vehicle) return '';
  const values = [
    normalizeNetsisPlate(vehicle.cekiciPlaka),
    vehicle.soforAdi || '',
    vehicle.soforSoyadi || '',
    normalizeNetsisPhone(vehicle.iletisim),
    vehicle.tcKimlik || '',
    normalizeNetsisPlate(vehicle.dorsePlaka)
  ].filter(Boolean);
  return values.join('\n');
}

function copyNetsisData(vehicle) {
  const text = copyNetsisVehicleText(vehicle);
  if (!text) { showToast('⚠️ NETSIS verisi bulunamadı.'); return; }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => {
      showToast('✅ NETSIS verileri kopyalandı.');
    }).catch(() => {
      showToast('❌ Kopyalama yapılamadı.');
    });
  } else {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.select();
    try {
      document.execCommand('copy');
      showToast('✅ NETSIS verileri kopyalandı.');
    } catch (e) {
      showToast('❌ Kopyalama yapılamadı.');
    }
    textarea.remove();
  }
}

function isTurkishPlateInput(raw) {
  const compact = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return /^\d{2}/.test(compact);
}

function formatForeignPlate(input) {
  if (!input) return '';
  return String(input)
    .toUpperCase()
    .replace(/[^A-Z0-9\s\-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function formatTRPlate(input) {
  if (!input) return '';
  const raw = String(input).toUpperCase().replace(/[^A-Z0-9]/g, '');

  // İlk 2 karakter il kodu olmalı (rakam)
  const il = raw.slice(0, 2);
  if (!/^\d{2}$/.test(il)) return formatForeignPlate(input);

  const rest = raw.slice(2);

  // Harfler: rest'in başından digit gelene kadar
  let letters = '';
  let digits = '';
  let i = 0;

  while (i < rest.length && /[A-Z]/.test(rest[i])) {
    letters += rest[i];
    i++;
  }

  // Geri kalanlardan sadece rakamları topla (araya yanlışlıkla harf girse bile bozmasın)
  for (; i < rest.length; i++) {
    if (/\d/.test(rest[i])) digits += rest[i];
  }

  letters = letters.slice(0, 3);
  digits = digits.slice(0, 4);

  let out = il;
  if (letters) out += ' ' + letters;
  if (digits) out += ' ' + digits;
  return out.trim();
}

function formatTRPhone(input) {
  const raw = String(input || '');
  let digits = raw.replace(/\D/g, '');
  if (!digits) return '';

  // 10 haneli girildiyse başına 0 ekle
  if (digits.length === 10) digits = '0' + digits;

  // 11 haneden fazlaysa son 11'i al (yanlış yapıştırma durumları)
  if (digits.length > 11) digits = digits.slice(-11);

  if (digits.length < 11) return digits;

  const p1 = digits.slice(0,4);
  const p2 = digits.slice(4,7);
  const p3 = digits.slice(7,9);
  const p4 = digits.slice(9,11);
  return `${p1} ${p2} ${p3} ${p4}`;
}

/** Türk cep numaralarını formatlar; uluslararası numaraları olduğu gibi bırakır */
function formatPhoneForInput(input) {
  const raw = String(input || '').trim();
  if (!raw) return '';

  const digits = raw.replace(/\D/g, '');
  const isTRMobile =
    (digits.length === 11 && digits.startsWith('05')) ||
    (digits.length === 10 && digits.startsWith('5'));

  if (isTRMobile) return formatTRPhone(raw);

  return raw.replace(/[^\d+\s\-().]/g, '').trim();
}

function showFormFieldWarning(fieldId, warningId, message) {
  const input = document.getElementById(fieldId);
  const warn = document.getElementById(warningId);
  if (warn) {
    warn.textContent = message;
    warn.classList.remove('hidden');
    warn.classList.add('text-red-600');
  }
  if (input) {
    input.classList.add('border-red-500');
    input.classList.remove('border-gray-300');
  }
}

function clearFormFieldWarning(fieldId, warningId) {
  const input = document.getElementById(fieldId);
  const warn = document.getElementById(warningId);
  if (warn) {
    warn.textContent = '';
    warn.classList.add('hidden');
    warn.classList.remove('text-red-600', 'text-amber-600');
  }
  if (input) {
    input.classList.remove('border-red-500', 'border-amber-500');
    input.classList.add('border-gray-300');
  }
}

function isCompleteTC(tc) {
  return /^\d{11}$/.test(String(tc || '').trim());
}

/** Taslak kayıt: eksik veya tamamlanmamış iletişim / TC uyarıları */
function getVehicleContactWarnings(vehicle) {
  const warnings = [];
  const phone = String(vehicle?.iletisim || '').trim();
  const tc = String(vehicle?.tcKimlik || '').trim();
  if (!phone) warnings.push('İletişim');
  if (!tc) warnings.push('TC Kimlik No');
  else if (!isCompleteTC(tc)) warnings.push('TC Kimlik No (eksik)');
  return warnings;
}

function countIncompleteVehicles(vehicles) {
  return (vehicles || []).filter((v) => getVehicleContactWarnings(v).length > 0).length;
}

function getFirstMissingContactField(vehicle) {
  const phone = String(vehicle?.iletisim || '').trim();
  const tc = String(vehicle?.tcKimlik || '').trim();
  if (!phone) return 'iletisim';
  if (!tc || !isCompleteTC(tc)) return 'tcKimlik';
  return null;
}

function getContactFieldStatus(vehicle, field) {
  if (field === 'phone' || field === 'iletisim') {
    return String(vehicle?.iletisim || '').trim() ? 'Tamam' : 'Eksik';
  }
  const tc = String(vehicle?.tcKimlik || '').trim();
  if (!tc) return 'Eksik';
  if (isCompleteTC(tc)) return 'Tamam';
  return 'Eksik (taslak)';
}

async function maybeConfirmIncompleteContact(vehicle, actionLabel) {
  if (!vehicle || !getVehicleContactWarnings(vehicle).length) return true;
  const lines = getVehicleContactWarnings(vehicle).join(', ');
  const msg = `Bu araçta eksik bilgi var: ${lines}.\n\n${actionLabel} işlemine yine de devam edilsin mi?`;
  const ui = window.rpUi || {};
  if (typeof ui.confirm === 'function') {
    return ui.confirm(msg, { title: 'Eksik şoför bilgisi' });
  }
  return window.confirm(msg);
}

function focusVehicleFormField(fieldId) {
  try {
    const el = document.getElementById(fieldId);
    if (!el) return;
    el.focus({ preventScroll: false });
    if (typeof el.select === 'function') el.select();
  } catch (_) {}
}

function vehicleContactWarningsHTML(vehicle, dataVehicleAttr) {
  const warnings = getVehicleContactWarnings(vehicle);
  if (!warnings.length) return '';
  const dv = dataVehicleAttr || '';
  return `<button type="button" class="vehicle-card__draft-warn vehicle-card__draft-warn--clickable" data-vehicle="${dv}" title="Eksik bilgileri düzenlemek için tıklayın">
    <span class="vehicle-card__draft-warn-icon" aria-hidden="true">⚠️</span>
    <span class="vehicle-card__draft-warn-text">Eksik bilgi: ${warnings.join(', ')}</span>
  </button>`;
}

async function exportVehiclesExcel() {
  closeAppToolsMenu();
  const vehicles = (state && state.vehicles) ? state.vehicles : [];
  if (!vehicles.length) {
    showToast('Dışa aktarılacak araç kaydı yok.', 'warn');
    return;
  }
  try {
    if (typeof window.ensureXlsxLoaded === 'function') await window.ensureXlsxLoaded();
  } catch (_) {}
  if (typeof XLSX === 'undefined') {
    showToast('Excel kütüphanesi yüklenemedi.', 'error');
    return;
  }
  const rows = vehicles.map((v) => ({
    'Çekici Plaka': v.cekiciPlaka || '',
    'Dorse Plaka': v.dorsePlaka || '',
    'Şoför Adı': v.soforAdi || '',
    'Şoför Soyadı': v.soforSoyadi || '',
    'İletişim': v.iletisim || '',
    'TC Kimlik': v.tcKimlik || '',
    'Telefon Durumu': getContactFieldStatus(v, 'phone'),
    'TC Durumu': getContactFieldStatus(v, 'tc'),
    'Kayıt Tarihi': v.kayitTarihi || '',
  }));
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Araçlar');
  const stamp = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `arac_listesi_${stamp}.xlsx`);
  showToast(`✅ ${vehicles.length} araç Excel olarak indirildi.`, 'success');
}

function handlePendingEditVehicle() {
  let id = '';
  try { id = sessionStorage.getItem('pendingEditVehicleId') || ''; } catch (_) {}
  if (!id) return;
  try { sessionStorage.removeItem('pendingEditVehicleId'); } catch (_) {}
  let focusField = '';
  try { focusField = sessionStorage.getItem('pendingEditFocusField') || ''; } catch (_) {}
  try { sessionStorage.removeItem('pendingEditFocusField'); } catch (_) {}
  const vehicle = (state.vehicles || []).find((v) => String(v.id) === String(id));
  const editFn = (typeof editVehicle === 'function') ? editVehicle : window.editVehicleRecord;
  if (!vehicle || typeof editFn !== 'function') return;
  editFn(vehicle, { focusField: focusField || getFirstMissingContactField(vehicle) });
}


function formatPlakaForInput(plaka) {
  const raw = String(plaka || '').trim();
  if (!raw) return '';
  if (isTurkishPlateInput(raw)) return formatTRPlate(raw);
  return formatForeignPlate(raw);
}

function formatPlaka(plaka) {
  return formatPlakaForInput(plaka);
}

// Input alanı için plaka formatlama
function formatPlakaInput(input) {
  if (!input) return;
  if (isTurkishPlateInput(input.value)) {
    let value = input.value.toUpperCase().replace(/[^A-Z0-9]/g, '');

    if (value.length >= 2) {
      let first = value.substring(0, 2);
      let rest = value.substring(2);

      let letters = '';
      let numbers = '';
      for (let i = 0; i < rest.length; i++) {
        if (isNaN(rest[i])) {
          letters += rest[i];
        } else {
          numbers = rest.substring(i);
          break;
        }
      }

      if (letters && numbers) {
        input.value = first + ' ' + letters + ' ' + numbers;
      } else if (letters) {
        input.value = first + ' ' + letters;
      } else {
        input.value = first;
      }
    } else {
      input.value = value;
    }
  } else {
    input.value = formatForeignPlate(input.value);
  }
}

// NETSIS — şoför kartı butonu (sadece logo)
const NETSIS_ICON_SRC = 'https://www.evoset.com.tr/wp-content/uploads/2024/11/netsis.png';

const WHATSAPP_ICON_SRC = 'https://upload.wikimedia.org/wikipedia/commons/6/6b/WhatsApp.svg';
const WHATSAPP_WINDOW_NAME = 'whatsapp_chat';

let _whatsappWin = null;

function toWhatsAppPhone(input) {
  try {
    let d = String(input || '').replace(/\D/g, '');
    if (!d) return '';
    if (d.length === 10 && d[0] !== '0') d = '90' + d;
    if (d.length === 10 && d[0] === '0') d = '90' + d.slice(1);
    if (d.length === 11 && d.startsWith('0')) d = '9' + d;
    return d;
  } catch (e) { return ''; }
}

function buildWhatsAppWebUrl(phone, text) {
  const p = toWhatsAppPhone(phone);
  if (!p) return '';
  const q = text ? ('&text=' + encodeURIComponent(String(text))) : '';
  return 'https://web.whatsapp.com/send/?phone=' + p + q;
}

function copyTextToClipboard(text) {
  return new Promise(function (resolve) {
    const s = String(text || '');
    if (!s) { resolve(false); return; }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(s).then(function () { resolve(true); }).catch(function () {
        resolve(_fallbackCopyText(s));
      });
      return;
    }
    resolve(_fallbackCopyText(s));
  });
}

function _fallbackCopyText(text) {
  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(textarea);
    return ok;
  } catch (e) { return false; }
}

function _syncWhatsAppWinRef() {
  if (_whatsappWin && _whatsappWin.closed) _whatsappWin = null;
}

function _navigateWhatsAppWin(sendUrl) {
  if (!_whatsappWin || _whatsappWin.closed) return false;
  try {
    _whatsappWin.focus();
    _whatsappWin.location.replace(sendUrl);
    return true;
  } catch (_) {
    return false;
  }
}

/** WhatsApp Web — giriş yapılmış sekmede sohbet aç (yeni sekmede /send takılmasın). */

