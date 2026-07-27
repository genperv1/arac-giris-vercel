// vardiya-takvim.js — Ayarlar: premium vardiya takvimi
(function () {
  'use strict';

  const STORAGE_KEY = 'vardiyaTakvimAyarlarV3';

  const monthNames = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
  const weekdayNames = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];

  const fixedHolidayTemplates = [
    ['01-01', 'Yılbaşı'],
    ['04-23', '23 Nisan Ulusal Egemenlik ve Çocuk Bayramı'],
    ['05-01', '1 Mayıs Emek ve Dayanışma Günü'],
    ['05-19', "19 Mayıs Atatürk'ü Anma, Gençlik ve Spor Bayramı"],
    ['07-15', '15 Temmuz Demokrasi ve Milli Birlik Günü'],
    ['08-30', '30 Ağustos Zafer Bayramı'],
    ['10-28', 'Cumhuriyet Bayramı Arifesi (13:00 sonrası)'],
    ['10-29', '29 Ekim Cumhuriyet Bayramı']
  ];

  const defaultReligiousHolidays = {
    '2025-03-29': 'Ramazan Bayramı Arefe',
    '2025-03-30': 'Ramazan Bayramı 1. Gün',
    '2025-03-31': 'Ramazan Bayramı 2. Gün',
    '2025-04-01': 'Ramazan Bayramı 3. Gün',
    '2025-06-05': 'Kurban Bayramı Arefe',
    '2025-06-06': 'Kurban Bayramı 1. Gün',
    '2025-06-07': 'Kurban Bayramı 2. Gün',
    '2025-06-08': 'Kurban Bayramı 3. Gün',
    '2025-06-09': 'Kurban Bayramı 4. Gün',
    '2026-03-20': 'Ramazan Bayramı 1. Gün',
    '2026-03-21': 'Ramazan Bayramı 2. Gün',
    '2026-03-22': 'Ramazan Bayramı 3. Gün',
    '2026-05-26': 'Kurban Bayramı Arefe',
    '2026-05-27': 'Kurban Bayramı 1. Gün',
    '2026-05-28': 'Kurban Bayramı 2. Gün',
    '2026-05-29': 'Kurban Bayramı 3. Gün',
    '2026-05-30': 'Kurban Bayramı 4. Gün',
    '2027-03-09': 'Ramazan Bayramı 1. Gün',
    '2027-03-10': 'Ramazan Bayramı 2. Gün',
    '2027-03-11': 'Ramazan Bayramı 3. Gün',
    '2027-05-15': 'Kurban Bayramı Arefe',
    '2027-05-16': 'Kurban Bayramı 1. Gün',
    '2027-05-17': 'Kurban Bayramı 2. Gün',
    '2027-05-18': 'Kurban Bayramı 3. Gün',
    '2027-05-19': 'Kurban Bayramı 4. Gün',
    '2028-02-26': 'Ramazan Bayramı Arefe',
    '2028-02-27': 'Ramazan Bayramı 1. Gün',
    '2028-02-28': 'Ramazan Bayramı 2. Gün',
    '2028-02-29': 'Ramazan Bayramı 3. Gün',
    '2028-05-04': 'Kurban Bayramı Arefe',
    '2028-05-05': 'Kurban Bayramı 1. Gün',
    '2028-05-06': 'Kurban Bayramı 2. Gün',
    '2028-05-07': 'Kurban Bayramı 3. Gün',
    '2028-05-08': 'Kurban Bayramı 4. Gün',
    '2029-02-15': 'Ramazan Bayramı Arefe',
    '2029-02-16': 'Ramazan Bayramı 1. Gün',
    '2029-02-17': 'Ramazan Bayramı 2. Gün',
    '2029-02-18': 'Ramazan Bayramı 3. Gün',
    '2029-04-23': 'Kurban Bayramı Arefe',
    '2029-04-24': 'Kurban Bayramı 1. Gün',
    '2029-04-25': 'Kurban Bayramı 2. Gün',
    '2029-04-26': 'Kurban Bayramı 3. Gün',
    '2029-04-27': 'Kurban Bayramı 4. Gün',
    '2030-02-05': 'Ramazan Bayramı Arefe',
    '2030-02-06': 'Ramazan Bayramı 1. Gün',
    '2030-02-07': 'Ramazan Bayramı 2. Gün',
    '2030-02-08': 'Ramazan Bayramı 3. Gün',
    '2030-04-12': 'Kurban Bayramı Arefe',
    '2030-04-13': 'Kurban Bayramı 1. Gün',
    '2030-04-14': 'Kurban Bayramı 2. Gün',
    '2030-04-15': 'Kurban Bayramı 3. Gün',
    '2030-04-16': 'Kurban Bayramı 4. Gün'
  };

  let bound = false;
  let currentYear;
  let currentMonth;
  let selectedDateStr;
  const today = new Date();

  function toast(msg, isErr) {
    const el = document.getElementById('ayToast');
    if (!el) return;
    el.textContent = msg;
    el.className = 'toast show' + (isErr ? ' warn' : '');
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove('show'), 3200);
  }

  function toDateLocal(dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Date(y, m - 1, d);
  }

  function formatDateLocal(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function titleDate(dateStr) {
    const d = toDateLocal(dateStr);
    return `${d.getDate()} ${monthNames[d.getMonth()]} ${d.getFullYear()} ${weekdayNames[d.getDay()]}`;
  }

  function startOfWeekMonday(date) {
    const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const jsDay = d.getDay();
    const mondayOffset = jsDay === 0 ? -6 : 1 - jsDay;
    d.setDate(d.getDate() + mondayOffset);
    return d;
  }

  function dayDiff(a, b) {
    const ms = 24 * 60 * 60 * 1000;
    const utcA = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
    const utcB = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
    return Math.floor((utcB - utcA) / ms);
  }

  function getSettings() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      try { return JSON.parse(raw); } catch (_) { /* ignore */ }
    }
    const monday = startOfWeekMonday(today);
    return { cycleStart: formatDateLocal(monday), startShift: 'day' };
  }

  function buildDefaultHolidayMap() {
    const map = { ...defaultReligiousHolidays };
    for (let year = 2025; year <= 2035; year++) {
      for (const [md, label] of fixedHolidayTemplates) {
        map[`${year}-${md}`] = label;
      }
    }
    return map;
  }

  function getHolidayMap() {
    return buildDefaultHolidayMap();
  }

  function getShiftInfo(date) {
    const settings = getSettings();
    const cycleStart = startOfWeekMonday(toDateLocal(settings.cycleStart));
    const currentWeekMonday = startOfWeekMonday(date);
    const weekDiff = Math.floor(dayDiff(cycleStart, currentWeekMonday) / 7);
    const isDayWeek = settings.startShift === 'day' ? weekDiff % 2 === 0 : weekDiff % 2 !== 0;
    const dow = date.getDay();

    if (isDayWeek) {
      if (dow === 0 || dow === 6) {
        return {
          shift: 'off',
          shiftLabel: 'İzin',
          hours: 0,
          detail: dow === 6 ? 'Cumartesi tatil' : 'Pazar tatil',
          weekType: 'Gündüz haftası'
        };
      }
      return {
        shift: 'day',
        shiftLabel: 'Gündüz',
        hours: 10,
        detail: 'Gündüz vardiyası 10 saat',
        weekType: 'Gündüz haftası'
      };
    }

    if (dow >= 1 && dow <= 5) {
      return {
        shift: 'night',
        shiftLabel: 'Gece',
        hours: 8,
        detail: 'Gece vardiyası 8 saat',
        weekType: 'Gece haftası'
      };
    }

    if (dow === 6) {
      return {
        shift: 'off',
        shiftLabel: 'İzin',
        hours: 0,
        detail: 'Cumartesi sabah çıkış, gün izinli',
        weekType: 'Gece haftası',
        morningExit: true
      };
    }

    return {
      shift: 'off',
      shiftLabel: 'İzin',
      hours: 0,
      detail: 'Pazar gündüz izinli, gece vardiyası bu gece başlar',
      weekType: 'Gece haftası',
      nightStart: true
    };
  }

  function getDayModel(date, inCurrentMonth) {
    const dateStr = formatDateLocal(date);
    const holidayMap = getHolidayMap();
    return {
      date,
      dateStr,
      holiday: holidayMap[dateStr] || null,
      shiftInfo: getShiftInfo(date),
      inCurrentMonth: inCurrentMonth !== false,
      isToday: dateStr === formatDateLocal(today),
      isSelected: dateStr === selectedDateStr
    };
  }

  function escapeHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function renderSummary(year, month) {
    const el = document.getElementById('vtSummary');
    if (!el) return;
    const totalDays = new Date(year, month + 1, 0).getDate();
    let dayCount = 0;
    let nightCount = 0;
    let offCount = 0;
    let totalHours = 0;
    for (let i = 1; i <= totalDays; i++) {
      const model = getDayModel(new Date(year, month, i));
      if (model.shiftInfo.shift === 'day') dayCount++;
      if (model.shiftInfo.shift === 'night') nightCount++;
      if (model.shiftInfo.shift === 'off') offCount++;
      totalHours += model.shiftInfo.hours;
    }
    el.innerHTML =
      `<div class="vt-kpi__box vt-kpi__box--day"><span>Gündüz</span><b>${dayCount}</b></div>` +
      `<div class="vt-kpi__box vt-kpi__box--night"><span>Gece</span><b>${nightCount}</b></div>` +
      `<div class="vt-kpi__box vt-kpi__box--off"><span>İzin</span><b>${offCount}</b></div>` +
      `<div class="vt-kpi__box vt-kpi__box--hours"><span>Aylık saat</span><b>${totalHours}</b></div>`;
  }

  function renderSelectedInfo() {
    const el = document.getElementById('vtSelectedInfo');
    if (!el) return;
    const model = getDayModel(toDateLocal(selectedDateStr));
    const extra = model.shiftInfo.morningExit
      ? 'Cuma gece vardiyasından cumartesi sabahı çıkış'
      : (model.shiftInfo.nightStart ? 'Pazar gece vardiyası bu gece başlar' : '');
    const holidayBlock = model.holiday
      ? `<div class="vt-selected__row"><span class="vt-selected__label">Özel gün</span><strong>${escapeHtml(model.holiday)}</strong></div>`
      : '';
    el.innerHTML =
      `<div class="vt-selected__row"><span class="vt-selected__label">Tarih</span><strong>${escapeHtml(titleDate(model.dateStr))}</strong></div>` +
      `<div class="vt-selected__row"><span class="vt-selected__label">Vardiya</span><strong>${escapeHtml(model.shiftInfo.shiftLabel)}</strong>` +
      `<div class="ay-muted" style="margin-top:4px;">${escapeHtml(model.shiftInfo.weekType)} · ${escapeHtml(model.shiftInfo.detail)}</div>` +
      (extra ? `<div class="ay-muted" style="margin-top:4px;">${escapeHtml(extra)}</div>` : '') +
      `</div>` +
      `<div class="vt-selected__row"><span class="vt-selected__label">Süre</span><strong>${model.shiftInfo.hours} saat</strong></div>` +
      holidayBlock;
  }

  function renderCalendar(year, month) {
    const calendarEl = document.getElementById('vtCalendar');
    const monthTitle = document.getElementById('vtMonthTitle');
    if (!calendarEl || !monthTitle) return;

    monthTitle.textContent = `${monthNames[month]} ${year}`;
    renderSummary(year, month);
    calendarEl.innerHTML = '';

    const firstDay = new Date(year, month, 1);
    const startOffset = (firstDay.getDay() + 6) % 7;
    const gridStart = new Date(year, month, 1 - startOffset);

    for (let i = 0; i < 42; i++) {
      const d = new Date(gridStart);
      d.setDate(gridStart.getDate() + i);
      const inCurrentMonth = d.getMonth() === month;
      const model = getDayModel(d, inCurrentMonth);
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'vt-day';
      if (!inCurrentMonth) cell.classList.add('is-other');
      if (model.isToday) cell.classList.add('is-today');
      if (model.isSelected) cell.classList.add('is-selected');
      if (model.holiday) cell.classList.add('is-holiday');
      else cell.classList.add('is-' + model.shiftInfo.shift);

      const metaText = model.shiftInfo.hours > 0
        ? `${model.shiftInfo.hours} saat`
        : (model.shiftInfo.morningExit ? 'Sabah çıkış' : (model.shiftInfo.nightStart ? 'Gece başlar' : model.shiftInfo.detail));
      const holidayText = model.holiday
        || (model.shiftInfo.morningExit ? 'Cumartesi sabahı işten çıkış' : (model.shiftInfo.nightStart ? 'Bu gece gece vardiyası başlar' : ''));

      cell.innerHTML =
        `<div class="vt-day__head"><span class="vt-day__num">${d.getDate()}</span>` +
        `${model.holiday ? '<span class="vt-tag vt-tag--holiday">Tatil</span>' : ''}</div>` +
        `<span class="vt-tag vt-tag--${model.shiftInfo.shift}">${escapeHtml(model.shiftInfo.shiftLabel)}</span>` +
        `<div class="vt-day__meta">${escapeHtml(metaText)}</div>` +
        (holidayText ? `<div class="vt-day__holiday">${escapeHtml(holidayText)}</div>` : '');

      cell.addEventListener('click', () => {
        selectedDateStr = model.dateStr;
        if (!inCurrentMonth) {
          currentYear = d.getFullYear();
          currentMonth = d.getMonth();
        }
        render();
      });

      calendarEl.appendChild(cell);
    }
  }

  function render() {
    const cycleStartInput = document.getElementById('vtCycleStart');
    const startShiftSelect = document.getElementById('vtStartShift');
    if (!cycleStartInput || !startShiftSelect) return;

    const settings = getSettings();
    cycleStartInput.value = settings.cycleStart;
    startShiftSelect.value = settings.startShift;
    renderCalendar(currentYear, currentMonth);
    renderSelectedInfo();
  }

  function saveSettings() {
    const cycleStartInput = document.getElementById('vtCycleStart');
    const startShiftSelect = document.getElementById('vtStartShift');
    if (!cycleStartInput || !startShiftSelect || !cycleStartInput.value) {
      toast('Geçerli bir başlangıç tarihi seçin.', true);
      return;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      cycleStart: cycleStartInput.value,
      startShift: startShiftSelect.value
    }));
    render();
    toast('Vardiya ayarları kaydedildi.');
  }

  function bind() {
    if (bound) return;
    const prev = document.getElementById('vtPrevMonth');
    const next = document.getElementById('vtNextMonth');
    const goToday = document.getElementById('vtGoToday');
    const saveBtn = document.getElementById('vtSaveSettings');
    if (!prev || !next || !goToday || !saveBtn) return;

    prev.addEventListener('click', () => {
      currentMonth--;
      if (currentMonth < 0) { currentMonth = 11; currentYear--; }
      render();
    });
    next.addEventListener('click', () => {
      currentMonth++;
      if (currentMonth > 11) { currentMonth = 0; currentYear++; }
      render();
    });
    goToday.addEventListener('click', () => {
      currentYear = today.getFullYear();
      currentMonth = today.getMonth();
      selectedDateStr = formatDateLocal(today);
      render();
    });
    saveBtn.addEventListener('click', saveSettings);
    bound = true;
  }

  function init() {
    currentYear = today.getFullYear();
    currentMonth = today.getMonth();
    selectedDateStr = formatDateLocal(today);
    bind();
    render();
  }

  window.VardiyaTakvim = {
    init: init,
    render: render
  };
})();
