// Kurumsal dialog (alert / confirm / şifre / metin girişi)
(function () {
  'use strict';

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
      overlay.hidden = true;
      document.body.style.overflow = '';
      const fn = resolveDialog;
      resolveDialog = null;
      if (typeof fn === 'function') fn(result);
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
          input.autocomplete = 'off';
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
        overlay.hidden = false;
        document.body.style.overflow = 'hidden';
        const first = focusEl || actionsEl.querySelector('button');
        if (first) first.focus();
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
        if (window.rpDialog) return window.rpDialog.alert(message, type || 'info');
        alert(message);
        return Promise.resolve();
      },
      confirm: function (message, opts) {
        initRpDialog();
        if (window.rpDialog) return window.rpDialog.confirm(message, opts);
        return Promise.resolve(confirm(message));
      },
      password: function (message) {
        initRpDialog();
        if (window.rpDialog) return window.rpDialog.password(message);
        return Promise.resolve(window.prompt(message));
      },
      prompt: function (message, opts) {
        initRpDialog();
        if (window.rpDialog) return window.rpDialog.prompt(message, opts);
        return Promise.resolve(window.prompt(message));
      },
      alertActions: function (message, type, buttons) {
        initRpDialog();
        if (window.rpDialog) return window.rpDialog.actions(message, type, buttons);
        alert(message);
        return Promise.resolve('ok');
      },
      /** Onay + şifre (varsayılan: 2026genper) */
      confirmSecureDelete: async function (opts) {
        opts = opts || {};
        initRpDialog();
        const pwd = opts.password || '2026genper';
        const msg = opts.message || 'Bu işlem geri alınamaz. Devam edilsin mi?';
        let ok = false;
        if (window.rpDialog) {
          ok = await window.rpDialog.confirm(msg, {
            okLabel: opts.okLabel || 'Sil',
            cancelLabel: opts.cancelLabel || 'İptal'
          });
        } else {
          ok = confirm(msg);
        }
        if (!ok) return { ok: false, cancelled: true };
        let entered = null;
        if (window.rpDialog) {
          entered = await window.rpDialog.password(opts.passwordMessage || 'Silme şifresini giriniz:');
        } else {
          entered = prompt(opts.passwordMessage || 'Silme şifresini giriniz:');
        }
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

  initRpDialog();
})();
