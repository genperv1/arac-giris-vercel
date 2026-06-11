// Kurumsal dialog (alert / confirm / şifre / metin girişi)
(function () {
  'use strict';

  function inferAlertType(message) {
    const s = String(message == null ? '' : message);
    if (/❌|hata|başarısız|basarisiz|geçersiz|gecersiz/i.test(s)) return 'danger';
    if (/✅|başarı|basari|tamamlandı|tamamlandi|kopyalandı|kopyalandi/i.test(s)) return 'success';
    if (/⚠️|uyarı|uyari|dikkat/i.test(s)) return 'warning';
    return 'info';
  }

  function initRpDialog() {
    if (window.rpDialog && window.rpDialog._ready) return;

    let overlay = document.getElementById('rpDialogOverlay');
    if (!overlay) {
      document.body.insertAdjacentHTML('beforeend',
        '<div id="rpDialogOverlay" class="rp-dialog-overlay" hidden aria-modal="true" role="dialog" aria-labelledby="rpDialogTitle">' +
          '<div class="rp-dialog">' +
            '<div class="rp-dialog-head">' +
              '<div id="rpDialogIcon" class="rp-dialog-icon is-info" aria-hidden="true"></div>' +
              '<div id="rpDialogTitle" class="rp-dialog-title">Bilgi</div>' +
            '</div>' +
            '<div id="rpDialogBody" class="rp-dialog-body"></div>' +
            '<div id="rpDialogActions" class="rp-dialog-actions"></div>' +
          '</div>' +
        '</div>'
      );
      overlay = document.getElementById('rpDialogOverlay');
    }

    const iconEl = document.getElementById('rpDialogIcon');
    const titleEl = document.getElementById('rpDialogTitle');
    const bodyEl = document.getElementById('rpDialogBody');
    const actionsEl = document.getElementById('rpDialogActions');
    if (!overlay || !iconEl || !titleEl || !bodyEl || !actionsEl) return;

    let resolveDialog = null;
    let previousFocus = null;
    let trapKeydown = null;
    let trapBeforeInput = null;
    let inertRoots = [];

    function isOpen() {
      return !!resolveDialog && overlay && !overlay.hidden;
    }

    function blurBackgroundFocus() {
      try {
        var active = document.activeElement;
        if (active && active !== document.body && !overlay.contains(active) && typeof active.blur === 'function') {
          active.blur();
        }
      } catch (e) { /* ignore */ }
    }

    function setBackgroundInert(on) {
      if (on) {
        inertRoots = [];
        Array.prototype.forEach.call(document.body.children, function (el) {
          if (el === overlay) return;
          if ('inert' in el) {
            el.inert = true;
            inertRoots.push(el);
          }
        });
      } else {
        inertRoots.forEach(function (el) {
          if (document.contains(el)) el.inert = false;
        });
        inertRoots = [];
      }
    }

    function forwardKeyToDialogInput(inp, e) {
      if (!inp || !e || !e.key) return;
      var start, end;
      if (e.key === 'Backspace') {
        start = inp.selectionStart;
        end = inp.selectionEnd;
        if (start != null && end != null && start === end && start > 0) {
          inp.value = inp.value.slice(0, start - 1) + inp.value.slice(end);
          inp.selectionStart = inp.selectionEnd = start - 1;
        } else if (start != null && end != null && start !== end) {
          inp.value = inp.value.slice(0, start) + inp.value.slice(end);
          inp.selectionStart = inp.selectionEnd = start;
        } else {
          inp.value = inp.value.slice(0, -1);
        }
        return;
      }
      if (e.key === 'Enter') {
        close(inp.value);
        return;
      }
      if (e.key.length === 1) {
        start = inp.selectionStart;
        end = inp.selectionEnd;
        if (start != null && end != null) {
          inp.value = inp.value.slice(0, start) + e.key + inp.value.slice(end);
          inp.selectionStart = inp.selectionEnd = start + 1;
        } else {
          inp.value += e.key;
        }
      }
    }

    function engageTrap() {
      if (trapKeydown) return;
      trapKeydown = function (e) {
        if (!isOpen()) return;
        if (overlay.contains(e.target)) return;
        var blockKeys = e.key === 'Backspace' || e.key === 'Delete' || e.key === 'Enter' ||
          (e.key && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey);
        if (!blockKeys) return;
        e.preventDefault();
        e.stopPropagation();
        var inp = bodyEl.querySelector('.rp-dialog-input');
        if (inp) {
          inp.focus();
          forwardKeyToDialogInput(inp, e);
        } else {
          var btn = actionsEl.querySelector('button');
          if (btn) btn.focus();
        }
      };
      trapBeforeInput = function (e) {
        if (!isOpen()) return;
        if (overlay.contains(e.target)) return;
        e.preventDefault();
        e.stopPropagation();
      };
      document.addEventListener('keydown', trapKeydown, true);
      document.addEventListener('beforeinput', trapBeforeInput, true);
      document.addEventListener('input', trapBeforeInput, true);
    }

    function releaseTrap() {
      if (trapKeydown) {
        document.removeEventListener('keydown', trapKeydown, true);
        trapKeydown = null;
      }
      if (trapBeforeInput) {
        document.removeEventListener('beforeinput', trapBeforeInput, true);
        document.removeEventListener('input', trapBeforeInput, true);
        trapBeforeInput = null;
      }
      setBackgroundInert(false);
    }

    function focusDialogField(el) {
      if (!el || typeof el.focus !== 'function') return;
      try {
        el.focus({ preventScroll: true });
      } catch (e) {
        try { el.focus(); } catch (_e) {}
      }
      try {
        if (typeof el.select === 'function') el.select();
      } catch (e2) { /* ignore */ }
    }

    const RP_DIALOG_Z_MIN = 1000090;

    function resolveDialogZIndex() {
      var maxZ = RP_DIALOG_Z_MIN;
      try {
        document.querySelectorAll('[data-piyasa-modal-layer]').forEach(function (el) {
          var z = parseInt(el.style.zIndex, 10);
          if (!isNaN(z) && z >= maxZ) maxZ = z + 10;
        });
      } catch (e) { /* ignore */ }
      return String(maxZ);
    }

    const ICONS = {
      success: { cls: 'is-success', icon: 'fa-check', title: 'Başarılı' },
      warning: { cls: 'is-warning', icon: 'fa-exclamation-triangle', title: 'Uyarı' },
      danger: { cls: 'is-danger', icon: 'fa-times-circle', title: 'Hata' },
      info: { cls: 'is-info', icon: 'fa-info-circle', title: 'Bilgi' },
      confirm: { cls: 'is-warning', icon: 'fa-trash-alt', title: 'Onay' },
      password: { cls: 'is-info', icon: 'fa-lock', title: 'Şifre Doğrulama' },
      reason: { cls: 'is-warning', icon: 'fa-pen', title: 'Silme Nedeni' }
    };

    function setType(type) {
      const cfg = ICONS[type] || ICONS.info;
      iconEl.className = 'rp-dialog-icon ' + cfg.cls;
      iconEl.innerHTML = '<i class="fas ' + cfg.icon + '" aria-hidden="true"></i>';
      titleEl.textContent = cfg.title;
    }

    function close(result) {
      const inp = bodyEl.querySelector('.rp-dialog-input');
      if (inp && (inp.type === 'password' || inp.autocomplete === 'new-password')) {
        inp.value = '';
      }
      releaseTrap();
      overlay.hidden = true;
      document.body.style.overflow = '';
      overlay.removeAttribute('aria-hidden');
      const fn = resolveDialog;
      resolveDialog = null;
      const restore = previousFocus;
      previousFocus = null;
      if (typeof fn === 'function') fn(result);
      if (restore && typeof restore.focus === 'function' && document.contains(restore)) {
        try { restore.focus({ preventScroll: true }); } catch (e) { try { restore.focus(); } catch (_e) {} }
      }
    }

    function openDialog(type, message, buttons, opts) {
      opts = opts || {};
      return new Promise(function (resolve) {
        resolveDialog = resolve;
        setType(type);
        bodyEl.innerHTML = '';
        var focusEl = null;
        if (opts.input) {
          const msgEl = document.createElement('p');
          msgEl.className = 'rp-dialog-msg';
          msgEl.textContent = message;
          bodyEl.appendChild(msgEl);
          const input = document.createElement('input');
          input.type = opts.inputType || 'text';
          input.className = 'rp-dialog-input';
          input.autocomplete = (opts.inputType === 'password') ? 'new-password' : 'off';
          if (opts.inputType === 'password') input.setAttribute('data-lpignore', 'true');
          input.setAttribute('aria-label', message);
          if (opts.placeholder) input.placeholder = opts.placeholder;
          if (opts.defaultValue != null && opts.defaultValue !== '') input.value = String(opts.defaultValue);
          bodyEl.appendChild(input);
          input.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') close(input.value);
          });
          focusEl = input;
        } else {
          bodyEl.textContent = message;
        }
        actionsEl.innerHTML = '';
        buttons.forEach(function (btn) {
          const el = document.createElement('button');
          el.type = 'button';
          el.className = 'rp-dialog-btn ' + (btn.className || 'rp-dialog-btn-ghost');
          el.textContent = btn.label;
          el.addEventListener('click', function () {
            if (opts.input && btn.submit) {
              const inp = bodyEl.querySelector('.rp-dialog-input');
              close(inp ? inp.value : '');
            } else {
              close(btn.value);
            }
          });
          actionsEl.appendChild(el);
        });
        previousFocus = document.activeElement;
        blurBackgroundFocus();
        overlay.style.zIndex = resolveDialogZIndex();
        overlay.hidden = false;
        overlay.setAttribute('aria-hidden', 'false');
        document.body.style.overflow = 'hidden';
        setBackgroundInert(true);
        engageTrap();
        const first = focusEl || actionsEl.querySelector('button');
        requestAnimationFrame(function () {
          requestAnimationFrame(function () { focusDialogField(first); });
        });
      });
    }

    function dismissDialog() {
      const hasInput = !!bodyEl.querySelector('.rp-dialog-input');
      close(hasInput ? null : false);
    }

    if (!overlay.dataset.rpBound) {
      overlay.dataset.rpBound = '1';
      overlay.addEventListener('click', function (e) {
        if (e.target === overlay && resolveDialog) dismissDialog();
      });
      document.addEventListener('keydown', function (e) {
        if (overlay.hidden || !resolveDialog) return;
        if (e.key === 'Escape') dismissDialog();
      });
    }

    window.rpDialog = {
      _ready: true,
      isOpen: isOpen,
      alert: function (message, type) {
        return openDialog(type || 'success', message, [
          { label: 'Tamam', value: true, className: 'rp-dialog-btn-primary' }
        ]);
      },
      confirm: function (message, opts) {
        opts = opts || {};
        return openDialog('confirm', message, [
          { label: opts.cancelLabel || 'İptal', value: false, className: 'rp-dialog-btn-ghost' },
          { label: opts.okLabel || 'Sil', value: true, className: 'rp-dialog-btn-danger' }
        ]);
      },
      password: function (message) {
        return openDialog('password', message, [
          { label: 'İptal', value: null, className: 'rp-dialog-btn-ghost' },
          { label: 'Tamam', value: null, submit: true, className: 'rp-dialog-btn-primary' }
        ], { input: true, inputType: 'password' });
      },
      prompt: function (message, opts) {
        opts = opts || {};
        return openDialog(opts.type || 'reason', message, [
          { label: 'İptal', value: null, className: 'rp-dialog-btn-ghost' },
          { label: 'Tamam', value: null, submit: true, className: 'rp-dialog-btn-primary' }
        ], { input: true, inputType: opts.inputType || 'text', placeholder: opts.placeholder || '', defaultValue: opts.defaultValue });
      },
      actions: function (message, type, buttons) {
        return openDialog(type || 'info', message, buttons || []);
      }
    };

    window.rpUi = {
      alert: function (message, type) {
        initRpDialog();
        if (!window.rpDialog) return Promise.resolve();
        return window.rpDialog.alert(message, type || inferAlertType(message));
      },
      confirm: function (message, opts) {
        initRpDialog();
        if (!window.rpDialog) return Promise.resolve(false);
        return window.rpDialog.confirm(message, opts);
      },
      password: function (message) {
        initRpDialog();
        if (!window.rpDialog) return Promise.resolve(null);
        return window.rpDialog.password(message);
      },
      prompt: function (message, opts) {
        initRpDialog();
        if (!window.rpDialog) return Promise.resolve(null);
        return window.rpDialog.prompt(message, opts);
      },
      alertActions: function (message, type, buttons) {
        initRpDialog();
        if (!window.rpDialog) return Promise.resolve('ok');
        return window.rpDialog.actions(message, type, buttons);
      },
      /** Onay + şifre (varsayılan: 2026genper) */
      confirmSecureDelete: async function (opts) {
        opts = opts || {};
        initRpDialog();
        const pwd = opts.password || '2026genper';
        const msg = opts.message || 'Bu işlem geri alınamaz. Devam edilsin mi?';
        let ok = false;
        ok = await window.rpDialog.confirm(msg, {
          okLabel: opts.okLabel || 'Sil',
          cancelLabel: opts.cancelLabel || 'İptal'
        });
        if (!ok) return { ok: false, cancelled: true };
        let entered = await window.rpDialog.password(opts.passwordMessage || 'Silme şifresini giriniz:');
        if (entered == null || entered === false) return { ok: false, cancelled: true };
        if (String(entered).trim() !== pwd) {
          await window.rpUi.alert('Şifre hatalı.', 'danger');
          return { ok: false, wrongPassword: true };
        }
        return { ok: true };
      },
      /** Başarı + isteğe bağlı Geri Al */
      alertDeleteSuccess: async function (opts) {
        opts = opts || {};
        initRpDialog();
        const msg = opts.message || 'Silme işlemi tamamlandı.';
        if (opts.withUndo) {
          return window.rpUi.alertActions(msg, 'success', [
            { label: 'Geri Al', value: 'undo', className: 'rp-dialog-btn-ghost' },
            { label: 'Tamam', value: 'ok', className: 'rp-dialog-btn-primary' }
          ]);
        }
        await window.rpUi.alert(msg, 'success');
        return 'ok';
      }
    };
  }

  function whenBodyReady(fn) {
    if (document.body) {
      fn();
      return;
    }
    document.addEventListener('DOMContentLoaded', fn, { once: true });
  }

  function patchNativeDialogs() {
    if (window.__rpNativeDialogsPatched) return;
    window.__rpNativeDialogsPatched = true;

    window.__rpNativeAlert = window.alert;
    window.__rpNativeConfirm = window.confirm;
    window.__rpNativePrompt = window.prompt;

    window.alert = function (message) {
      whenBodyReady(function () {
        initRpDialog();
        if (!window.rpDialog) return;
        void window.rpDialog.alert(String(message == null ? '' : message), inferAlertType(message));
      });
    };

    window.confirm = function (message) {
      return new Promise(function (resolve) {
        whenBodyReady(function () {
          initRpDialog();
          if (!window.rpDialog) {
            resolve(false);
            return;
          }
          window.rpDialog.confirm(String(message == null ? '' : message), {
            okLabel: 'Tamam',
            cancelLabel: 'İptal'
          }).then(resolve);
        });
      });
    };

    window.prompt = function (message, defaultValue) {
      return new Promise(function (resolve) {
        whenBodyReady(function () {
          initRpDialog();
          if (!window.rpDialog) {
            resolve(null);
            return;
          }
          window.rpDialog.prompt(String(message == null ? '' : message), {
            defaultValue: defaultValue != null ? String(defaultValue) : '',
            type: 'reason'
          }).then(resolve);
        });
      });
    };
  }

  function bootstrapRpDialog() {
    initRpDialog();
    patchNativeDialogs();
  }

  if (document.body) {
    bootstrapRpDialog();
  } else {
    document.addEventListener('DOMContentLoaded', bootstrapRpDialog, { once: true });
  }
})();
