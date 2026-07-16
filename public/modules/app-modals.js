// Persistent confirm dialog (requires core-dom.js escapeHtml)
(function () {
  'use strict';

  function showPersistentConfirmModal(message, yesText, noText) {
    const yes = yesText || 'Evet';
    const no = noText || 'Hayır';
    return new Promise((resolve) => {
      const existing = document.getElementById('persistent-confirm-modal');
      if (existing) existing.remove();

      const modal = document.createElement('div');
      modal.id = 'persistent-confirm-modal';
      modal.innerHTML = `
      <div style="
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0,0,0,0.7);
        z-index: 999999;
        display: flex;
        align-items: center;
        justify-content: center;
      ">
        <div style="
          background: white;
          padding: 20px;
          border-radius: 10px;
          box-shadow: 0 4px 20px rgba(0,0,0,0.3);
          max-width: 400px;
          text-align: center;
          font-family: Arial, sans-serif;
        ">
          <p style="margin: 0 0 20px 0; font-size: 16px;">${escapeHtml(message)}</p>
          <button id="modal-yes" type="button" style="
            background: #4CAF50;
            color: white;
            border: none;
            padding: 10px 20px;
            margin: 0 10px;
            border-radius: 5px;
            cursor: pointer;
            font-size: 14px;
          ">${escapeHtml(yes)}</button>
          <button id="modal-no" type="button" style="
            background: #f44336;
            color: white;
            border: none;
            padding: 10px 20px;
            margin: 0 10px;
            border-radius: 5px;
            cursor: pointer;
            font-size: 14px;
          ">${escapeHtml(no)}</button>
        </div>
      </div>
    `;
      document.body.appendChild(modal);

      const yesBtn = modal.querySelector('#modal-yes');
      const noBtn = modal.querySelector('#modal-no');

      const closeModal = (result) => {
        modal.remove();
        resolve(result);
      };

      yesBtn.addEventListener('click', () => closeModal(true));
      noBtn.addEventListener('click', () => closeModal(false));
    });
  }

  window.showPersistentConfirmModal = showPersistentConfirmModal;
})();
