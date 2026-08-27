(function () {
  'use strict';

  const API = '/api/print-form-bg';

  function readFileAsDataUrl(file) {
    return new Promise(function (resolve, reject) {
      const reader = new FileReader();
      reader.onload = function () { resolve(reader.result); };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  async function uploadToServer(imageData, source) {
    const r = await fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ imageData: imageData, source: source || 'upload' }),
    });
    const data = await r.json().catch(function () { return {}; });
    if (!r.ok) throw new Error(data.error || 'upload failed');
    return data;
  }

  function pickFile() {
    return new Promise(function (resolve) {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/jpeg,image/png,.jpg,.jpeg,.png';
      input.style.display = 'none';
      document.body.appendChild(input);
      input.addEventListener('change', function () {
        const file = input.files && input.files[0];
        input.remove();
        resolve(file || null);
      }, { once: true });
      input.click();
    });
  }

  async function pickAndUpload(opts) {
    const silent = !!(opts && opts.silent);
    if (!silent) {
      const ok = confirm(
        'Takip formu yazdırma şablonu sunucuda yok.\n\n' +
        'JPG/PNG dosyasını seçin (Hızlı Resim sayfasında görsele sağ tık → Farklı kaydet).\n\n' +
        'Devam etmek istiyor musunuz?'
      );
      if (!ok) return null;
    }
    const file = await pickFile();
    if (!file) return null;
    if (!/^image\/(jpeg|png)$/i.test(file.type)) {
      alert('Yalnızca JPG veya PNG seçin.');
      return null;
    }
    if (file.size > 4_500_000) {
      alert('Dosya çok büyük (en fazla ~4.5 MB).');
      return null;
    }
    const dataUrl = await readFileAsDataUrl(file);
    await uploadToServer(dataUrl, 'takip-upload');
    try {
      if (window.PrintFormBg && typeof window.PrintFormBg.clearCache === 'function') {
        window.PrintFormBg.clearCache();
      }
    } catch (_) {}
    try {
      const img = new Image();
      img.src = API;
    } catch (_) {}
    if (typeof window.showToast === 'function') {
      window.showToast('Form şablonu kaydedildi.');
    }
    return dataUrl;
  }

  window.PrintFormBgUpload = {
    pickAndUpload,
    uploadToServer,
    readFileAsDataUrl,
  };
})();
