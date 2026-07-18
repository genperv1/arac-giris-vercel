(function () {
  'use strict';

  function buildTakipFormBgSvg(pageSize) {
    var a4 = pageSize === 'A4';
    var w = 210;
    var h = a4 ? 297 : 148;
    var imzaTop = 119;
    var noteTop = a4 ? 107.2 : 106.8;
    var noteBottom = 118.9;
    var parts = [
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + w + ' ' + h + '" width="' + w + 'mm" height="' + h + 'mm">',
      '<rect width="100%" height="100%" fill="#fff"/>',
      '<rect x="1.5" y="1.5" width="' + (w - 3) + '" height="' + (h - 3) + '" fill="none" stroke="#111" stroke-width="0.45"/>',
      '<text x="' + (w / 2) + '" y="8" text-anchor="middle" font-family="Arial,sans-serif" font-size="4.2" font-weight="700">SEVKİYAT YÜKLEMESİ TAKİP FORMU</text>',
      '<text x="' + (w / 2) + '" y="11.5" text-anchor="middle" font-family="Arial,sans-serif" font-size="2.2" fill="#333">GENPER Mining Industry</text>',
      '<rect x="4" y="14" width="' + (w - 8) + '" height="16" fill="#fffacd" stroke="#c0392b" stroke-width="0.35"/>',
      '<text x="6" y="17.5" font-family="Arial,sans-serif" font-size="2.4" font-weight="700" fill="#c0392b">ŞOFÖR BİLGİLERİ</text>',
      '<text x="88" y="17" font-family="Arial,sans-serif" font-size="1.8">Yükleme sırası</text>',
      '<rect x="88" y="18" width="28" height="6" fill="#fff" stroke="#333" stroke-width="0.25"/>',
      '<text x="170" y="17" font-family="Arial,sans-serif" font-size="1.8">Tarih</text>',
      '<rect x="170" y="18" width="32" height="6" fill="#fff" stroke="#333" stroke-width="0.25"/>',
      '<line x1="4" y1="38" x2="' + (w - 4) + '" y2="38" stroke="#333" stroke-width="0.25"/>',
      '<rect x="4" y="38" width="42" height="8" fill="#f3f4f6" stroke="#333" stroke-width="0.2"/>',
      '<text x="6" y="43.5" font-family="Arial,sans-serif" font-size="1.7" font-weight="600">Firma / müşteri</text>',
      '<rect x="46" y="38" width="' + (w - 50) + '" height="8" fill="#fff" stroke="#333" stroke-width="0.2"/>',
      '<rect x="4" y="' + noteTop + '" width="' + (w - 8) + '" height="' + (noteBottom - noteTop) + '" fill="#fff" stroke="#333" stroke-width="0.25"/>',
      '<text x="6" y="' + (noteTop + 3) + '" font-family="Arial,sans-serif" font-size="1.7" font-weight="600">Yükleme notu</text>',
      '<line x1="4" y1="' + (imzaTop - 1) + '" x2="' + (w - 4) + '" y2="' + (imzaTop - 1) + '" stroke="#333" stroke-width="0.25"/>',
      '<rect x="4" y="' + imzaTop + '" width="48" height="24" fill="#fff" stroke="#333" stroke-width="0.2"/>',
      '<text x="28" y="' + (imzaTop + 22) + '" text-anchor="middle" font-family="Arial,sans-serif" font-size="1.5">Kantar</text>',
      '<rect x="54" y="' + imzaTop + '" width="48" height="24" fill="#fff" stroke="#333" stroke-width="0.2"/>',
      '<text x="78" y="' + (imzaTop + 22) + '" text-anchor="middle" font-family="Arial,sans-serif" font-size="1.5">Sevkiyat saha</text>',
      '<rect x="104" y="' + imzaTop + '" width="48" height="24" fill="#fff" stroke="#333" stroke-width="0.2"/>',
      '<text x="128" y="' + (imzaTop + 22) + '" text-anchor="middle" font-family="Arial,sans-serif" font-size="1.5">Yükleyen</text>',
      '<rect x="154" y="' + imzaTop + '" width="52" height="24" fill="#fff" stroke="#333" stroke-width="0.2"/>',
      '<text x="180" y="' + (imzaTop + 22) + '" text-anchor="middle" font-family="Arial,sans-serif" font-size="1.5">Kalite</text>',
      '</svg>'
    ];
    return parts.join('');
  }

  function getDataUrl(pageSize) {
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(buildTakipFormBgSvg(pageSize || 'A5'));
  }

  window.PrintFormBgBuiltin = { buildTakipFormBgSvg: buildTakipFormBgSvg, getDataUrl: getDataUrl };
})();
