(function () {
  'use strict';

  const PLS = window.PrintLayoutSettings;
  if (!PLS) return;

  const STAGE_W = 840;
  const STAGE_H = 592;

  function pxToMm(px, axis) {
    const formMm = axis === 'x' ? PLS.FORM_W_MM : PLS.FORM_H_MM;
    const stagePx = axis === 'x' ? STAGE_W : STAGE_H;
    return (Number(px) / stagePx) * formMm;
  }

  function toast(msg, isErr) {
    const el = document.getElementById('ayToast');
    if (!el) return;
    el.textContent = msg;
    el.classList.toggle('is-error', !!isErr);
    el.classList.add('show');
    clearTimeout(el.__t);
    el.__t = setTimeout(() => el.classList.remove('show'), 2600);
  }

  function clamp(v, min, max) { return Math.min(max, Math.max(min, v)); }

  function val(id) { return document.getElementById(id); }

  function applyBoxRect(box, rectMm) {
    if (PLS.pctStyle) {
      box.style.cssText = 'position:absolute;' + PLS.pctStyle(rectMm);
      return;
    }
    box.style.left = ((rectMm.left / PLS.FORM_W_MM) * 100) + '%';
    box.style.top = ((rectMm.top / PLS.FORM_H_MM) * 100) + '%';
    box.style.width = ((rectMm.w / PLS.FORM_W_MM) * 100) + '%';
    box.style.height = ((rectMm.h / PLS.FORM_H_MM) * 100) + '%';
  }

  function readBoxMm(box, stage) {
    const sr = stage.getBoundingClientRect();
    const br = box.getBoundingClientRect();
    return {
      left: pxToMm((br.left - sr.left) / sr.width * STAGE_W, 'x'),
      top: pxToMm((br.top - sr.top) / sr.height * STAGE_H, 'y'),
      w: pxToMm(br.width / sr.width * STAGE_W, 'x'),
      h: pxToMm(br.height / sr.height * STAGE_H, 'y'),
    };
  }

  function bindPrintLayoutEditor() {
    const root = document.getElementById('printLayoutEditor');
    if (!root || root.__bound) return;
    root.__bound = true;

    const stage = val('pleStage');
    const bg = val('pleBg');
    const fieldsLayer = val('pleFields');
    const fieldSelect = val('pleFieldSelect');
    const stylePanel = val('pleStylePanel');
    if (!stage || !bg || !fieldsLayer) return;

    let state = PLS.load();
    if (!state || typeof state !== 'object') state = { fields: {}, fieldStyles: {}, styles: {}, samples: {} };
    if (!state.samples) state.samples = {};
    if (!state.fieldStyles) state.fieldStyles = {};
    let rects = {};
    let selectedKey = 'not';
    let drag = null;
    let editingKey = null;
    const boxes = new Map();

    function getSampleText(key) {
      const def = getDef(key);
      if (state && state.samples && state.samples[key] != null && String(state.samples[key]).trim() !== '') {
        return String(state.samples[key]);
      }
      if (!def) return '';
      if (def.kind === 'sig') return def.sampleName || '';
      return def.sample || def.label || '';
    }

    function setSampleText(key, text) {
      if (!state) return;
      if (!state.samples) state.samples = {};
      state.samples[key] = String(text ?? '');
    }

    function sampleHasManualBreaks(text) {
      return /\r?\n/.test(String(text || ''));
    }

    function ensurePreLineForBreaks(key) {
      const def = getDef(key);
      if (!def || def.kind !== 'text') return;
      const text = getSampleText(key);
      if (!sampleHasManualBreaks(text)) return;
      const s = getFieldStyle(key);
      if (s.wrap === 'nowrap') return;
      if (s.wrap !== 'pre-line') {
        setFieldStyle(key, { wrap: 'pre-line' });
        if (selectedKey === key && val('pleWrapMode')) val('pleWrapMode').value = 'pre-line';
      }
    }

    function getDef(key) { return PLS.getDef(key); }

    function getFieldStyle(key) {
      if (!state || !state.fieldStyles) {
        return PLS.normalizeFieldStyle(key, PLS.getDefaultFieldStyle(key));
      }
      return PLS.normalizeFieldStyle(key, Object.assign({}, PLS.getDefaultFieldStyle(key), state.fieldStyles[key] || {}));
    }

    function setFieldStyle(key, patch) {
      if (!state) return;
      if (!state.fieldStyles) state.fieldStyles = {};
      state.fieldStyles[key] = PLS.normalizeFieldStyle(key, Object.assign({}, getFieldStyle(key), patch));
    }

    function applyTextPreview(body, key) {
      const s = getFieldStyle(key);
      const def = getDef(key);
      const raw = getSampleText(key);
      let text = raw;
      if (editingKey !== key && typeof PLS.formatFieldDisplayText === 'function') {
        text = PLS.formatFieldDisplayText(key, raw);
      }
      body.style.cssText = '';
      body.className = 'ple-body ple-body--text';
      body.contentEditable = 'false';
      body.style.fontSize = s.fontPt + 'pt';
      body.style.lineHeight = String(s.lineHeight);
      body.style.fontWeight = String(s.fontWeight);
      body.style.fontStyle = s.fontStyle || 'normal';
      body.style.textDecoration = s.textDecoration || 'none';
      body.style.textAlign = s.align;
      body.style.padding = s.padMm + 'mm';
      body.style.display = 'flex';
      body.style.alignItems = s.valign === 'flex-start' ? 'flex-start' : (s.valign === 'flex-end' ? 'flex-end' : 'center');
      body.style.height = '100%';
      body.style.width = '100%';
      body.style.boxSizing = 'border-box';
      body.style.overflow = 'hidden';
      const usePreLine = s.wrap === 'pre-line' || def.multiline || sampleHasManualBreaks(text);
      if (s.wrap === 'nowrap') {
        body.style.whiteSpace = 'nowrap';
        body.style.textOverflow = 'ellipsis';
      } else if (usePreLine) {
        body.style.whiteSpace = 'pre-line';
        body.style.alignItems = 'flex-start';
      } else if (s.wrap === 'break-word') {
        body.style.whiteSpace = 'normal';
        body.style.wordBreak = 'break-word';
        body.style.overflowWrap = 'anywhere';
        body.style.alignItems = 'flex-start';
      } else {
        body.style.whiteSpace = 'normal';
        body.style.wordBreak = s.wordBreak || 'normal';
        body.style.overflowWrap = 'break-word';
        body.style.alignItems = 'flex-start';
      }
      if (editingKey === key) {
        body.classList.add('ple-body--edit');
        body.contentEditable = 'true';
        body.textContent = raw;
        return;
      }
      const inner = document.createElement('span');
      inner.style.width = '100%';
      inner.style.whiteSpace = body.style.whiteSpace;
      inner.textContent = text;
      body.innerHTML = '';
      body.appendChild(inner);
    }

    function applyNotePreview(body) {
      const s = getFieldStyle('not');
      const def = getDef('not');
      body.className = 'ple-body ple-body--note';
      body.style.cssText = 'height:100%;overflow:hidden;padding:1mm;box-sizing:border-box;';
      body.contentEditable = 'false';
      const raw = getSampleText('not');
      if (editingKey === 'not') {
        body.classList.add('ple-body--edit');
        body.contentEditable = 'true';
        body.style.whiteSpace = 'pre-line';
        body.textContent = raw;
        return;
      }
      const lines = raw.split(/\r?\n/);
      const head = lines[0] || '';
      let desc = lines.slice(1).join(' ');
      const split = PLS.splitTextByPhrases(desc, s.breakAfter, s.maxLines);
      if (split.length > 1) desc = split.join('\n');
      body.innerHTML =
        `<div class="ple-note-head" style="font-size:${s.headPt}pt;margin-bottom:${s.headGapMm}mm;line-height:1.1;font-weight:${s.headFontWeight};font-style:${s.headFontStyle || 'normal'};${s.headTextDecoration === 'underline' ? 'text-decoration:underline;' : ''}">${head}</div>` +
        `<div class="ple-note-body" style="font-size:${s.descPt}pt;line-height:${s.lineHeight};white-space:pre-line;font-weight:${s.descFontWeight};font-style:${s.descFontStyle || 'normal'};${s.descTextDecoration === 'underline' ? 'text-decoration:underline;' : ''}">${desc}</div>`;
    }

    function applySigPreview(body, key) {
      const s = getFieldStyle(key);
      const def = getDef(key);
      body.className = 'ple-body ple-body--sig';
      body.style.cssText = 'height:100%;display:flex;flex-direction:column;justify-content:flex-end;box-sizing:border-box;';
      body.style.paddingTop = (s.padTopMm != null ? s.padTopMm : 5) + 'mm';
      body.style.paddingBottom = '0.5mm';
      body.style.alignItems = s.align === 'left' ? 'flex-start' : 'center';
      body.style.gap = s.nameGapMm + 'mm';
      let img = body.querySelector('.ple-sig-img');
      let name = body.querySelector('.ple-sig-name');
      if (!img) {
        body.innerHTML = '<img class="ple-sig-img" alt=""><div class="ple-sig-name"></div>';
        img = body.querySelector('.ple-sig-img');
        name = body.querySelector('.ple-sig-name');
      }
      if (name) {
        name.textContent = def.sampleName || '';
        name.style.fontSize = s.namePt + 'pt';
        name.style.fontWeight = '700';
        name.style.textAlign = s.align === 'left' ? 'left' : 'center';
      }
      if (img) img.style.maxHeight = s.imgMaxMm + 'mm';
    }

    function buildBox(def) {
      const box = document.createElement('div');
      box.className = 'ple-box';
      box.dataset.key = def.key;
      const tag = document.createElement('span');
      tag.className = 'ple-tag';
      tag.textContent = def.label;
      box.appendChild(tag);
      const body = document.createElement('div');
      body.className = 'ple-body';
      box.appendChild(body);
      const handle = document.createElement('span');
      handle.className = 'ple-resize';
      box.appendChild(handle);

      box.addEventListener('mousedown', (e) => {
        if (e.target === handle || editingKey === def.key) return;
        if (e.target.closest('.ple-body')) {
          if (selectedKey === def.key && !editingKey && def.kind !== 'sig') {
            startInlineEdit(def.key);
          } else {
            selectField(def.key);
          }
          e.preventDefault();
          return;
        }
        selectField(def.key);
        drag = { key: def.key, mode: 'move', startX: e.clientX, startY: e.clientY, base: Object.assign({}, rects[def.key]) };
        e.preventDefault();
      });
      handle.addEventListener('mousedown', (e) => {
        if (editingKey) return;
        selectField(def.key);
        drag = { key: def.key, mode: 'resize', startX: e.clientX, startY: e.clientY, base: Object.assign({}, rects[def.key]) };
        e.preventDefault();
        e.stopPropagation();
      });
      boxes.set(def.key, box);
      fieldsLayer.appendChild(box);
    }

    function fillFieldSelect() {
      if (!fieldSelect) return;
      fieldSelect.innerHTML = PLS.FIELD_DEFS.map((d) => `<option value="${d.key}">${d.label}</option>`).join('');
      fieldSelect.value = selectedKey;
    }

    function updatePanelVisibility() {
      if (!stylePanel) return;
      const def = getDef(selectedKey);
      stylePanel.querySelectorAll('[data-for]').forEach((el) => {
        const modes = String(el.getAttribute('data-for') || '').split(/\s+/);
        el.style.display = modes.includes(def?.kind) ? '' : 'none';
      });
      const title = val('pleSelectedLabel');
      if (title) title.textContent = def ? def.label : '—';
    }

    function isBoldWeight(w) { return Number(w) >= 600; }

    function syncFmtButtons() {
      const def = getDef(selectedKey);
      const s = getFieldStyle(selectedKey);
      const setBtn = (id, active) => {
        const btn = val(id);
        if (!btn) return;
        btn.classList.toggle('ple-fmt-btn--active', !!active);
        btn.setAttribute('aria-pressed', active ? 'true' : 'false');
      };
      if (def?.kind === 'text') {
        setBtn('pleFmtBold', isBoldWeight(s.fontWeight));
        setBtn('pleFmtItalic', s.fontStyle === 'italic');
        setBtn('pleFmtUnderline', s.textDecoration === 'underline');
      }
      if (def?.kind === 'note') {
        setBtn('pleHeadFmtBold', isBoldWeight(s.headFontWeight));
        setBtn('pleHeadFmtItalic', s.headFontStyle === 'italic');
        setBtn('pleHeadFmtUnderline', s.headTextDecoration === 'underline');
        setBtn('pleDescFmtBold', isBoldWeight(s.descFontWeight));
        setBtn('pleDescFmtItalic', s.descFontStyle === 'italic');
        setBtn('pleDescFmtUnderline', s.descTextDecoration === 'underline');
      }
    }

    function toggleTypography(prefix) {
      const def = getDef(selectedKey);
      if (!def) return;
      const s = getFieldStyle(selectedKey);
      const p = prefix ? prefix : '';
      const wKey = p ? p + 'FontWeight' : 'fontWeight';
      const sKey = p ? p + 'FontStyle' : 'fontStyle';
      const dKey = p ? p + 'TextDecoration' : 'textDecoration';
      const defBold = p === 'head' ? (PLS.HEAD_BOLD_WEIGHT || 800) : (PLS.TEXT_BOLD_WEIGHT || 700);
      const defNormal = PLS.NORMAL_WEIGHT || 400;
      const map = {
        bold: { key: wKey, on: defBold, off: defNormal, test: (v) => isBoldWeight(v) },
        italic: { key: sKey, on: 'italic', off: 'normal', test: (v) => v === 'italic' },
        underline: { key: dKey, on: 'underline', off: 'none', test: (v) => v === 'underline' },
      };
      return map;
    }

    function bindFmtToggle(btnId, prefix, mode) {
      val(btnId)?.addEventListener('click', () => {
        const def = getDef(selectedKey);
        if (!def || (def.kind !== 'text' && def.kind !== 'note')) return;
        if (def.kind === 'text' && prefix) return;
        if (def.kind === 'note' && !prefix) return;
        const maps = toggleTypography(prefix);
        const rule = maps[mode];
        const s = getFieldStyle(selectedKey);
        const next = rule.test(s[rule.key]) ? rule.off : rule.on;
        setFieldStyle(selectedKey, { [rule.key]: next });
        syncFmtButtons();
        renderBox(selectedKey);
      });
    }

    function syncControlsFromState() {
      const s = getFieldStyle(selectedKey);
      const def = getDef(selectedKey);
      if (def?.kind === 'text' || def?.kind === 'note') {
        const sampleEl = val('pleSampleText');
        if (sampleEl) sampleEl.value = getSampleText(selectedKey);
      }
      if (def?.kind === 'text') {
        val('pleFontPt').value = String(s.fontPt);
        val('pleLineHeight').value = String(s.lineHeight);
        val('pleTextAlign').value = s.align || 'left';
        val('pleWrapMode').value = s.wrap || 'wrap';
        val('pleValign').value = s.valign || 'center';
        val('plePadMm').value = String(s.padMm);
        val('pleFontVal').textContent = s.fontPt + ' pt';
        val('pleLhVal').textContent = String(s.lineHeight);
        syncFmtButtons();
      }
      if (def?.kind === 'note') {
        val('pleHeadPt').value = String(s.headPt);
        val('pleDescPt').value = String(s.descPt);
        val('pleHeadGap').value = String(s.headGapMm);
        val('pleMaxLines').value = String(s.maxLines);
        val('pleNoteLh').value = String(s.lineHeight);
        val('pleBreakPhrases').value = (s.breakPhrasesText != null ? s.breakPhrasesText : (s.breakAfter || []).join('\n'));
        val('pleHeadPtVal').textContent = s.headPt + ' pt';
        val('pleDescPtVal').textContent = s.descPt + ' pt';
        syncFmtButtons();
      }
      if (def?.kind === 'sig') {
        val('pleImgMax').value = String(s.imgMaxMm);
        val('pleNamePt').value = String(s.namePt);
        val('pleNameGap').value = String(s.nameGapMm);
        val('pleAlign').value = s.align || 'center';
        val('pleImgMaxVal').textContent = s.imgMaxMm + ' mm';
        val('pleNamePtVal').textContent = s.namePt + ' pt';
      }
    }

    function renderBox(key) {
      const box = boxes.get(key);
      const def = getDef(key);
      if (!box || !def) return;
      applyBoxRect(box, rects[key]);
      const body = box.querySelector('.ple-body');
      if (!body) return;
      if (def.kind === 'sig') applySigPreview(body, key);
      else if (def.kind === 'note') applyNotePreview(body);
      else applyTextPreview(body, key);
    }

    function renderAll() { PLS.FIELD_DEFS.forEach((d) => renderBox(d.key)); }

    function onSampleTextInput() {
      const def = getDef(selectedKey);
      if (!def || (def.kind !== 'text' && def.kind !== 'note')) return;
      const text = val('pleSampleText')?.value ?? '';
      setSampleText(selectedKey, text);
      if (def.kind === 'text') ensurePreLineForBreaks(selectedKey);
      renderBox(selectedKey);
    }

    function startInlineEdit(key) {
      const def = getDef(key);
      if (!def || def.kind === 'sig') return;
      endInlineEdit(false);
      editingKey = key;
      const box = boxes.get(key);
      box?.classList.add('ple-box--edit');
      renderBox(key);
      const body = box?.querySelector('.ple-body');
      if (!body) return;
      body.focus();
      try {
        const range = document.createRange();
        range.selectNodeContents(body);
        range.collapse(false);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
      } catch (e) { /* ignore */ }
    }

    function endInlineEdit(save) {
      if (!editingKey) return;
      const key = editingKey;
      const box = boxes.get(key);
      const body = box?.querySelector('.ple-body');
      if (save !== false && body) {
        const text = body.innerText.replace(/\r\n/g, '\n');
        setSampleText(key, text);
        if (val('pleSampleText') && selectedKey === key) val('pleSampleText').value = text;
        ensurePreLineForBreaks(key);
      }
      editingKey = null;
      box?.classList.remove('ple-box--edit');
      renderBox(key);
    }

    function onStyleInput() {
      const def = getDef(selectedKey);
      if (!def) return;
      if (def.kind === 'text') {
        setFieldStyle(selectedKey, {
          fontPt: clamp(Number(val('pleFontPt')?.value) || 10, 5, 16),
          lineHeight: clamp(Number(val('pleLineHeight')?.value) || 1.05, 0.9, 1.6),
          align: val('pleTextAlign')?.value || 'left',
          wrap: val('pleWrapMode')?.value || 'wrap',
          valign: val('pleValign')?.value || 'center',
          padMm: clamp(Number(val('plePadMm')?.value) || 0.35, 0, 3),
        });
        val('pleFontVal').textContent = getFieldStyle(selectedKey).fontPt + ' pt';
        val('pleLhVal').textContent = String(getFieldStyle(selectedKey).lineHeight);
      }
      if (def.kind === 'note') {
        setFieldStyle('not', {
          headPt: clamp(Number(val('pleHeadPt')?.value) || 10.75, 6, 14),
          descPt: clamp(Number(val('pleDescPt')?.value) || 9, 5, 14),
          headGapMm: clamp(Number(val('pleHeadGap')?.value) || 1.1, 0, 6),
          maxLines: clamp(Number(val('pleMaxLines')?.value) || 3, 1, 6),
          lineHeight: clamp(Number(val('pleNoteLh')?.value) || 1.1, 0.9, 1.6),
          breakPhrasesText: val('pleBreakPhrases')?.value || '',
        });
        val('pleHeadPtVal').textContent = getFieldStyle('not').headPt + ' pt';
        val('pleDescPtVal').textContent = getFieldStyle('not').descPt + ' pt';
      }
      if (def.kind === 'sig') {
        setFieldStyle(selectedKey, {
          imgMaxMm: clamp(Number(val('pleImgMax')?.value) || 12, 6, 22),
          namePt: clamp(Number(val('pleNamePt')?.value) || 10, 7, 14),
          nameGapMm: clamp(Number(val('pleNameGap')?.value) || 0.3, 0, 3),
          align: val('pleAlign')?.value === 'left' ? 'left' : 'center',
        });
        val('pleImgMaxVal').textContent = getFieldStyle(selectedKey).imgMaxMm + ' mm';
        val('pleNamePtVal').textContent = getFieldStyle(selectedKey).namePt + ' pt';
      }
      renderBox(selectedKey);
    }

    function selectField(key) {
      if (editingKey && editingKey !== key) endInlineEdit(true);
      selectedKey = key;
      if (fieldSelect) fieldSelect.value = key;
      boxes.forEach((b, k) => b.classList.toggle('ple-box--active', k === key));
      syncControlsFromState();
      updatePanelVisibility();
    }

    async function loadBg() {
      if (!bg) return;
      const staticFallbacks = [
        '/assets/takip-form-bg.png',
        '/assets/takip-form-bg.jpg',
        'https://i.hizliresim.com/36cc3jp.jpg',
      ];
      let fallbackIdx = 0;

      function tryNextFallback() {
        if (fallbackIdx >= staticFallbacks.length) {
          if (window.PrintFormBgBuiltin?.getDataUrl) {
            bg.onerror = null;
            bg.src = window.PrintFormBgBuiltin.getDataUrl('A5');
          }
          return;
        }
        bg.onerror = tryNextFallback;
        bg.src = staticFallbacks[fallbackIdx++];
      }

      try {
        const cached = localStorage.getItem('printBgDataUrl_v3');
        if (cached && /^data:image\/(jpeg|jpg|png)/i.test(cached)) {
          bg.onerror = tryNextFallback;
          bg.src = cached;
          return;
        }
      } catch (e) { /* ignore */ }

      try {
        if (window.PrintFormBg?.resolvePrintBgUrl) {
          const url = await window.PrintFormBg.resolvePrintBgUrl();
          if (url) {
            bg.onerror = tryNextFallback;
            bg.src = url;
            return;
          }
        }
      } catch (e) { /* ignore */ }

      try {
        const r = await fetch('/api/print-form-bg', { credentials: 'include', cache: 'no-cache' });
        if (r.ok) {
          const blob = await r.blob();
          if (blob && blob.size > 500) {
            bg.onerror = tryNextFallback;
            bg.src = URL.createObjectURL(blob);
            return;
          }
        }
      } catch (e) { /* ignore */ }

      tryNextFallback();
    }

    async function loadSigImages() {
      try { if (window.SignatureRegistry) await window.SignatureRegistry.loadSignatures(true); } catch (e) { /* ignore */ }
      PLS.FIELD_DEFS.filter((d) => d.kind === 'sig').forEach((def) => {
        const img = boxes.get(def.key)?.querySelector('.ple-sig-img');
        if (!img) return;
        let src = def.key === 'imzaKantar' ? '/signatures/burak_karatas.png' : '';
        try {
          if (window.SignatureRegistry && def.sigRole) {
            src = window.SignatureRegistry.resolveSignatureSrc(def.sigRole, def.sampleName) || src;
          }
        } catch (e) { /* ignore */ }
        if (src && window.SignatureRegistry?.toAbsoluteSignatureSrc) src = window.SignatureRegistry.toAbsoluteSignatureSrc(src);
        if (src) img.src = src;
      });
    }

    document.addEventListener('mousemove', (e) => {
      if (!drag) return;
      const sr = stage.getBoundingClientRect();
      const dx = pxToMm((e.clientX - drag.startX) / sr.width * STAGE_W, 'x');
      const dy = pxToMm((e.clientY - drag.startY) / sr.height * STAGE_H, 'y');
      const rect = rects[drag.key];
      if (drag.mode === 'move') {
        rect.left = clamp(drag.base.left + dx, 0, PLS.FORM_W_MM - drag.base.w);
        rect.top = clamp(drag.base.top + dy, 0, PLS.FORM_H_MM - drag.base.h);
      } else {
        rect.w = clamp(drag.base.w + dx, 8, PLS.FORM_W_MM - drag.base.left);
        rect.h = clamp(drag.base.h + dy, 4, PLS.FORM_H_MM - drag.base.top);
      }
      renderBox(drag.key);
    });
    document.addEventListener('mouseup', () => { drag = null; });

    bindFmtToggle('pleFmtBold', '', 'bold');
    bindFmtToggle('pleFmtItalic', '', 'italic');
    bindFmtToggle('pleFmtUnderline', '', 'underline');
    bindFmtToggle('pleHeadFmtBold', 'head', 'bold');
    bindFmtToggle('pleHeadFmtItalic', 'head', 'italic');
    bindFmtToggle('pleHeadFmtUnderline', 'head', 'underline');
    bindFmtToggle('pleDescFmtBold', 'desc', 'bold');
    bindFmtToggle('pleDescFmtItalic', 'desc', 'italic');
    bindFmtToggle('pleDescFmtUnderline', 'desc', 'underline');

    fieldSelect?.addEventListener('change', () => selectField(fieldSelect.value));

    stylePanel?.querySelectorAll('input, select, textarea').forEach((el) => {
      if (el.id === 'pleSampleText') {
        el.addEventListener('input', onSampleTextInput);
        return;
      }
      el.addEventListener('input', onStyleInput);
      el.addEventListener('change', onStyleInput);
    });

    document.addEventListener('mousedown', (e) => {
      if (!editingKey) return;
      const box = boxes.get(editingKey);
      if (box && !box.contains(e.target) && !val('pleSampleText')?.contains(e.target)) {
        endInlineEdit(true);
      }
    });

    document.addEventListener('keydown', (e) => {
      if (!editingKey) return;
      if (e.key === 'Escape') {
        endInlineEdit(true);
        e.preventDefault();
      }
    });

    val('pleSaveBtn')?.addEventListener('click', () => {
      persistCurrentLayout(true);
    });

    val('pleLivePreviewBtn')?.addEventListener('click', () => {
      openLivePrintPreview();
    });

    // --- Günlük baskıdan örnek veri ---
    let _reportCache = [];

    function istanbulIsoToday() {
      try {
        return new Intl.DateTimeFormat('en-CA', {
          timeZone: 'Europe/Istanbul',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        }).format(new Date());
      } catch (e) {
        const d = new Date();
        return d.toISOString().slice(0, 10);
      }
    }

    function trDateToIso(tr) {
      const m = String(tr || '').trim().match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/);
      if (!m) return '';
      return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    }

    function isoToTr(iso) {
      const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (!m) return '';
      return `${m[3]}.${m[2]}.${m[1]}`;
    }

    function reportToSamples(row) {
      const d = (row && row.data) || {};
      const plate = String(d.plaka || d.cekiciPlaka || d.plate || '').trim();
      const dorse = String(d.dorsePlaka || d.dorse_plaka || '').trim();
      return {
        yuklemeSirasi: String(d.yuklemeSirasi || '').trim(),
        tarih: String(d.tarih || row.tarih || '').trim(),
        sofor: String(d.sofor || '').trim(),
        iletisim: String(d.iletisim || '').trim(),
        tc: String(d.tcKimlik || d.tc_kimlik || d.tc || '').trim(),
        sevkYeri: String(d.sevkYeri || d.sevk_yeri || '').trim(),
        cekici: plate,
        dorse: dorse,
        firma: String(d.firma || d.firmaKodu || d.firmaSelect || row.firma || '').trim(),
        malzeme: String(d.malzeme || row.malzeme || '').trim(),
        ambBilgi: String(d.ambalajBilgisi || d.yuklemeTuru || d.yukleme_turu || '').trim(),
        tonaj: String(d.tonaj || '').trim(),
        seperator: String(d.seperatorBilgisi || d.seperator || '').trim(),
        not: String(d.yuklemeNotu || d.not || '').trim(),
        bbt: String(d.bbt || '').trim(),
        bosBbt: String(d.bosBbt || d.bos_bbt || '').trim(),
        cuval: String(d.cuval || '').trim(),
        bosCuval: String(d.bosCuval || d.bos_cuval || '').trim(),
        palet: String(d.palet || '').trim(),
        torba: String(d.torba || '').trim(),
        imzaKantar: String(d.kantar || d.imzaKantarAd || '').trim(),
        imzaSaha: String(d.saha || d.imzaSahaAd || '').trim(),
        imzaYukleyen: String(d.imzaYukleyenAd || d.yukleyen || '').trim(),
        imzaKalite: String(d.imzaKaliteAd || d.kalite || '').trim(),
      };
    }

    function applySamplesToEditor(samples) {
      if (!state.samples) state.samples = {};
      Object.keys(samples || {}).forEach((k) => {
        if (samples[k] != null && String(samples[k]).trim() !== '') {
          state.samples[k] = String(samples[k]);
        }
      });
      // Ambalaj gibi çok satırlı alanlar için satır kırma modu
      if (state.samples.ambBilgi && /\n/.test(state.samples.ambBilgi)) {
        setFieldStyle('ambBilgi', { wrap: 'pre-line' });
      }
      if (state.samples.seperator && /\n/.test(state.samples.seperator)) {
        setFieldStyle('seperator', { wrap: 'pre-line' });
      }
      if (state.samples.sevkYeri && /;/.test(state.samples.sevkYeri)) {
        setFieldStyle('sevkYeri', { wrap: 'pre-line' });
      }
      renderAll();
      loadSigImages();
      syncControlsFromState();
    }

    async function fetchDailyReports() {
      const dateEl = val('pleReportDate');
      const sel = val('pleReportSelect');
      const hint = val('pleReportHint');
      const applyBtn = val('pleReportApplyBtn');
      const iso = (dateEl && dateEl.value) || istanbulIsoToday();
      const wantTr = isoToTr(iso);
      if (sel) {
        sel.disabled = true;
        sel.innerHTML = '<option value="">Yükleniyor…</option>';
      }
      if (applyBtn) applyBtn.disabled = true;
      try {
        const r = await fetch('/api/reports?limit=800&_=' + Date.now(), {
          credentials: 'include',
          cache: 'no-store',
          headers: { 'Cache-Control': 'no-cache' },
        });
        if (!r.ok) throw new Error('Raporlar alınamadı (' + r.status + ')');
        const list = await r.json();
        const rows = (Array.isArray(list) ? list : []).filter((ev) => {
          if (!ev || ev.type !== 'PRINT') return false;
          const tr = String((ev.data && ev.data.tarih) || ev.tarih || '').trim();
          if (wantTr && tr) return trDateToIso(tr) === iso || tr === wantTr;
          // tarih yoksa ts ile İstanbul günü
          if (ev.ts) {
            try {
              const isoTs = new Intl.DateTimeFormat('en-CA', {
                timeZone: 'Europe/Istanbul',
                year: 'numeric', month: '2-digit', day: '2-digit',
              }).format(new Date(Number(ev.ts)));
              return isoTs === iso;
            } catch (e) { return false; }
          }
          return false;
        });
        _reportCache = rows;
        if (!sel) return;
        if (!rows.length) {
          sel.innerHTML = '<option value="">Bu günde yazdırma yok</option>';
          if (hint) hint.textContent = wantTr + ' için kayıt bulunamadı.';
          return;
        }
        sel.innerHTML = rows.map((ev, i) => {
          const d = ev.data || {};
          const plate = d.plaka || '—';
          const firma = (d.firma || d.firmaKodu || '').toString().slice(0, 28);
          const malz = (d.malzeme || '').toString().slice(0, 22);
          const saat = d.saat || ev.saat || '';
          const label = `${saat} · ${plate} · ${firma}${malz ? ' · ' + malz : ''}`;
          return `<option value="${i}">${String(label).replace(/</g, '&lt;')}</option>`;
        }).join('');
        sel.disabled = false;
        if (applyBtn) applyBtn.disabled = false;
        if (hint) hint.textContent = rows.length + ' yazdırma yüklendi — sorunluyu seçip «Örneğe yükle» deyin.';
      } catch (e) {
        _reportCache = [];
        if (sel) sel.innerHTML = '<option value="">Hata</option>';
        if (hint) hint.textContent = (e && e.message) || 'Yüklenemedi';
        toast('Günlük baskılar alınamadı.', true);
      }
    }

    function applySelectedReport() {
      const sel = val('pleReportSelect');
      const idx = sel ? Number(sel.value) : -1;
      const row = _reportCache[idx];
      if (!row) {
        toast('Önce listeden bir yazdırma seçin.', true);
        return;
      }
      const samples = reportToSamples(row);
      applySamplesToEditor(samples);
      const d = row.data || {};
      const plate = d.plaka || '';
      toast('Örnek yüklendi: ' + plate + ' — düzenleyip Kaydet’e basın.');
      if (val('pleReportHint')) {
        val('pleReportHint').textContent = 'Şablonda gerçek veri görünüyor. Konum/punto ayarla → Kaydet → canlı siteye geçer.';
      }
    }

    const reportDateEl = val('pleReportDate');
    if (reportDateEl && !reportDateEl.value) reportDateEl.value = istanbulIsoToday();
    val('pleReportFetchBtn')?.addEventListener('click', () => { fetchDailyReports(); });
    val('pleReportApplyBtn')?.addEventListener('click', () => { applySelectedReport(); });
    // Bölüm açılınca bugünün listesini hazırla
    setTimeout(() => { fetchDailyReports().catch(() => {}); }, 400);

    function buildLayoutSnapshot() {
      const fields = {};
      PLS.FIELD_DEFS.forEach((d) => {
        fields[d.key] = Object.assign({}, rects[d.key] || PLS.getFieldRect(d.key));
      });
      const fieldStyles = {};
      PLS.FIELD_DEFS.forEach((d) => {
        fieldStyles[d.key] = Object.assign({}, getFieldStyle(d.key));
      });
      const noteStyle = fieldStyles.not || getFieldStyle('not');
      return {
        fields,
        fieldStyles,
        samples: Object.assign({}, state.samples || {}),
        styles: {
          yuklemeNotu: {
            headPt: noteStyle.headPt,
            descPt: noteStyle.descPt,
            headGapMm: noteStyle.headGapMm,
            maxLines: noteStyle.maxLines,
            lineHeight: noteStyle.lineHeight,
            breakAfter: noteStyle.breakAfter,
            headFontWeight: noteStyle.headFontWeight,
            headFontStyle: noteStyle.headFontStyle,
            headTextDecoration: noteStyle.headTextDecoration,
            descFontWeight: noteStyle.descFontWeight,
            descFontStyle: noteStyle.descFontStyle,
            descTextDecoration: noteStyle.descTextDecoration,
          },
          imzaKantar: fieldStyles.imzaKantar || getFieldStyle('imzaKantar'),
          imzaSaha: fieldStyles.imzaSaha || getFieldStyle('imzaSaha'),
        },
      };
    }

    async function persistCurrentLayout(showToast) {
      const fields = {};
      PLS.FIELD_DEFS.forEach((d) => {
        fields[d.key] = Object.assign({}, rects[d.key] || readBoxMm(boxes.get(d.key), stage));
      });
      const noteStyle = getFieldStyle('not');
      const styles = {
        yuklemeNotu: {
          headPt: noteStyle.headPt,
          descPt: noteStyle.descPt,
          headGapMm: noteStyle.headGapMm,
          maxLines: noteStyle.maxLines,
          lineHeight: noteStyle.lineHeight,
          breakAfter: noteStyle.breakAfter,
          headFontWeight: noteStyle.headFontWeight,
          headFontStyle: noteStyle.headFontStyle,
          headTextDecoration: noteStyle.headTextDecoration,
          descFontWeight: noteStyle.descFontWeight,
          descFontStyle: noteStyle.descFontStyle,
          descTextDecoration: noteStyle.descTextDecoration,
        },
        imzaKantar: getFieldStyle('imzaKantar'),
        imzaSaha: getFieldStyle('imzaSaha'),
      };
      PLS.save({ fields, fieldStyles: state.fieldStyles, samples: state.samples || {}, styles }, { skipServer: true });
      state = PLS.load();
      if (!state.samples) state.samples = {};
      Object.keys(state.fieldStyles || {}).forEach((k) => {
        state.fieldStyles[k] = PLS.normalizeFieldStyle(k, state.fieldStyles[k]);
      });
      rects = PLS.getAllFieldRects();
      renderAll();
      const result = await PLS.pushToServer(state);
      if (showToast) {
        if (result && result.ok) {
          toast('Kaydedildi — canlı sitedeki yazdırma da aynı düzeni kullanacak.');
          try {
            // Diğer sekmeler / açık ana sayfa hemen alsın
            if (window.SyncManager && typeof window.SyncManager.broadcastLocal === 'function') {
              window.SyncManager.broadcastLocal('print_layout_updated', { updatedAt: result.updatedAt || Date.now() });
            }
            localStorage.setItem('printLayoutBump', String(Date.now()));
          } catch (e) { /* ignore */ }
        } else {
          toast((result && result.error) || 'Sunucuya kaydedilemedi — ayarlar oturumunu kontrol edin.', true);
        }
      }
    }

    async function openLivePrintPreview() {
      const snapshot = buildLayoutSnapshot();
      try {
        if (typeof window.ensurePrintLoaded !== 'function') {
          throw new Error('Yazdırma modülü bulunamadı');
        }
        await window.ensurePrintLoaded();
        if (!window.Print || typeof window.Print.yazdirForm !== 'function') {
          throw new Error('Print modülü yüklenemedi');
        }
        await window.Print.yazdirForm({ preview: true, demo: true, layoutSnapshot: snapshot });
      } catch (e) {
        toast('Canlı önizleme açılamadı: ' + (e && e.message ? e.message : String(e)), true);
      }
    }

    function bootstrapEditor() {
      state = PLS.load();
      if (!state || typeof state !== 'object') state = { fields: {}, fieldStyles: {}, styles: {}, samples: {} };
      if (!state.samples) state.samples = {};
      if (!state.fieldStyles) state.fieldStyles = {};
      rects = PLS.getAllFieldRects();
      fieldsLayer.innerHTML = '';
      PLS.FIELD_DEFS.forEach((d) => buildBox(d));
      fillFieldSelect();
      selectField(selectedKey);
      renderAll();
      loadBg();
      loadSigImages();
    }

    val('pleResetBtn')?.addEventListener('click', () => {
      endInlineEdit(false);
      state = PLS.reset();
      state.samples = {};
      rects = PLS.getAllFieldRects();
      selectField(selectedKey);
      renderAll();
      loadSigImages();
      toast('Varsayılan ayarlara dönüldü — sunucu düzeni sıfırlandı.');
    });

    val('pleReloadBtn')?.addEventListener('click', async () => {
      endInlineEdit(false);
      await PLS.ensureSynced();
      state = PLS.load();
      if (!state.samples) state.samples = {};
      rects = PLS.getAllFieldRects();
      selectField(selectedKey);
      renderAll();
      loadSigImages();
      toast('Sunucudaki güncel ayarlar yüklendi.');
    });

    function refreshLayoutPreview() {
      if (!stage || !fieldsLayer) return;
      rects = PLS.getAllFieldRects();
      renderAll();
      loadSigImages();
    }

    root.__pleRefresh = refreshLayoutPreview;

    bootstrapEditor();
    PLS.ensureSynced().then(function () {
      state = PLS.load();
      if (!state.samples) state.samples = {};
      rects = PLS.getAllFieldRects();
      selectField(selectedKey);
      renderAll();
      loadSigImages();
    }).catch(function () {
      /* local bootstrapEditor state kept */
    });
  }

  window.bindPrintLayoutEditor = bindPrintLayoutEditor;
})();
