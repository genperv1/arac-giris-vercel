/**
 * Yazdırma / form öncesi Excel tutarlılık kontrolleri.
 */
(function () {
  'use strict';

  function getActiveShipment() {
    try {
      return window.__activeExcelShipment || window.__lastChosenShipment || null;
    } catch (e) {
      return null;
    }
  }

  function getFormVal(id) {
    try {
      return String(document.getElementById(id)?.value || '').trim();
    } catch (e) {
      return '';
    }
  }

  function normPlate(s) {
    return String(s || '').replace(/\s+/g, '').toUpperCase();
  }

  /** Piyasa siparişi sonradan uygulandıysa tonaj kaynağı Excel değil; karıştırma. */
  function isTonajFromPiyasaOrder(lastOrder, formTonaj, eu) {
    if (!lastOrder || !eu.tonajCompare) return false;
    const piyTonaj = lastOrder.miktar != null && lastOrder.miktar !== ''
      ? String(lastOrder.miktar).trim()
      : '';
    if (!piyTonaj) return false;

    const plate = getFormVal('cekiciPlaka') || getFormVal('cekiciPlakaBilgi');
    const usedPlate = String(lastOrder.usedPlate || lastOrder.lastPrintPlate || '').trim();
    if (plate && usedPlate && normPlate(plate) !== normPlate(usedPlate)) return false;

    return eu.tonajCompare(formTonaj, piyTonaj).level === 'ok';
  }

  /**
   * @returns {{ ok: boolean, messages: string[], level: 'ok'|'warn'|'danger' }}
   */
  function checkExcelConsistency() {
    const messages = [];
    let level = 'ok';
    const eu = window.ExcelUtils || {};
    const shipment = getActiveShipment();
    const piy = window.piyasa && window.piyasa._state;
    const lastOrder = piy && piy._lastAppliedOrder;

    const formTonaj = getFormVal('tonaj');
    const skipExcelTonaj = isTonajFromPiyasaOrder(lastOrder, formTonaj, eu);
    if (shipment && eu.tonajCompare && !skipExcelTonaj) {
      const cmp = eu.tonajCompare(formTonaj, shipment.tonajKg || shipment.tonaj);
      if (cmp.level === 'warn') {
        messages.push(`Tonaj Excel satırından ~%${cmp.pct.toFixed(0)} farklı.`);
        level = 'warn';
      } else if (cmp.level === 'danger') {
        messages.push(`Tonaj Excel ile ciddi uyumsuz (~%${cmp.pct.toFixed(0)} fark).`);
        level = 'danger';
      }
    }

    return { ok: messages.length === 0, messages, level };
  }

  async function maybeWarnExcelConsistencyBeforePrint() {
    const r = checkExcelConsistency();
    if (r.ok) return true;
    const ui = window.rpUi || {};
    const text = r.messages.join('\n');
    if (r.level === 'danger') {
      if (typeof ui.confirm === 'function') {
        return ui.confirm(text + '\n\nYine de yazdırmak istiyor musunuz?', { okLabel: 'Yazdır' });
      }
      return confirm(text + '\n\nYine de yazdırmak istiyor musunuz?');
    }
    if (typeof ui.alert === 'function') {
      await ui.alert(text, 'warning');
      return true;
    }
    showToast && showToast('⚠️ ' + text);
    return true;
  }

  window.checkExcelConsistency = checkExcelConsistency;
  window.maybeWarnExcelConsistencyBeforePrint = maybeWarnExcelConsistencyBeforePrint;
})();
