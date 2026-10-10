'use strict';

(function (root) {
  var limanlar = [
    { id: 'safiport', ad: 'Safiport', ara: 'safiport derince', il: 'Kocaeli', ilce: 'Derince', plaka: 41, lat: 40.7511, lon: 29.8347 },
    { id: 'dp-yarimca', ad: 'DP World Yarımca', ara: 'evyap dp world yarimca', il: 'Kocaeli', ilce: 'Körfez', plaka: 41, lat: 40.7635, lon: 29.7511 },
    { id: 'evyap-korfez', ad: 'Evyap Körfez', ara: 'evyap dp world korfez', il: 'Kocaeli', ilce: 'Körfez', plaka: 41, lat: 40.7746, lon: 29.7124 },
    { id: 'yilport', ad: 'Yılport', ara: 'yilport dilovasi gebze', il: 'Kocaeli', ilce: 'Dilovası', plaka: 41, lat: 40.7692, lon: 29.5367 },
    { id: 'gemport', ad: 'Gemport', ara: 'gemport gemlik', il: 'Bursa', ilce: 'Gemlik', plaka: 16, lat: 40.4165, lon: 29.1111 },
    { id: 'rodaport', ad: 'Rodaport', ara: 'rodaport gemlik', il: 'Bursa', ilce: 'Gemlik', plaka: 16, lat: 40.4100, lon: 29.0867 }
  ];

  var kopruler = [
    { id: 'osmangazi', ad: 'Osmangazi', kisa: 'Osmangazi', lat: 40.7547, lon: 29.5158, yaricapKm: 1.0, sinif4: 2950, sinif5: 3720, tir: true },
    { id: 'yss', ad: 'Yavuz Sultan Selim', kisa: 'Yavuz Selim', lat: 41.2031, lon: 29.1117, yaricapKm: 0.7, sinif4: 690, sinif5: 860, tir: true },
    { id: 'canakkale', ad: '1915 Çanakkale', kisa: 'Çanakkale', lat: 40.3397, lon: 26.6368, yaricapKm: 1.1, sinif4: 2925, sinif5: 5560, tir: true },
    { id: 'fsm', ad: 'Fatih Sultan Mehmet', kisa: 'FSM', lat: 41.0914, lon: 29.0612, yaricapKm: 0.55, tir: false },
    { id: 'temmuz', ad: '15 Temmuz', kisa: '15 Temmuz', lat: 41.0455, lon: 29.0344, yaricapKm: 0.5, tir: false }
  ];

  function distKm(lon1, lat1, lon2, lat2) {
    var x = (lon2 - lon1) * Math.cos(((lat1 + lat2) / 2) * Math.PI / 180) * 111;
    var y = (lat2 - lat1) * 111;
    return Math.sqrt(x * x + y * y);
  }

  function segmentKm(lon, lat, a, b) {
    var cos = Math.cos(lat * Math.PI / 180) || 1;
    var px = (lon - a[0]) * cos;
    var py = lat - a[1];
    var qx = (b[0] - a[0]) * cos;
    var qy = b[1] - a[1];
    var qq = qx * qx + qy * qy || 1e-12;
    var t = (px * qx + py * qy) / qq;
    if (t < 0) t = 0;
    if (t > 1) t = 1;
    return distKm(lon, lat, a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t);
  }

  function distToRoad(lon, lat, koord) {
    var best = Infinity;
    if (!koord || koord.length < 2) return best;
    for (var i = 1; i < koord.length; i++) {
      var d = segmentKm(lon, lat, koord[i - 1], koord[i]);
      if (d < best) best = d;
    }
    return best;
  }

  function ucretliParcalar(cizgi, yollar, limitKm) {
    var limit = limitKm == null ? 2 : limitKm;
    var line = Array.isArray(cizgi) ? cizgi : [];
    var roads = Array.isArray(yollar) ? yollar : [];
    if (line.length < 2 || !roads.length) return [];
    var tags = new Array(line.length);
    for (var i = 0; i < line.length; i++) {
      var best = null;
      var bestD = limit;
      for (var r = 0; r < roads.length; r++) {
        if (!roads[r] || !roads[r].parali) continue;
        var d = distToRoad(line[i][0], line[i][1], roads[r].koord);
        if (d < bestD) { bestD = d; best = roads[r]; }
      }
      tags[i] = best;
    }
    for (var h = 1; h < tags.length - 1; h++) {
      if (!tags[h] && tags[h - 1] && tags[h + 1] && tags[h - 1].ad === tags[h + 1].ad) tags[h] = tags[h - 1];
    }
    var runs = [];
    var start = -1;
    var current = null;
    function close(end) {
      if (start < 0 || !current || end <= start) return;
      var slice = line.slice(start, end + 1);
      if (slice.length < 2) return;
      var km = 0;
      for (var j = 1; j < slice.length; j++) km += distKm(slice[j - 1][0], slice[j - 1][1], slice[j][0], slice[j][1]);
      if (km < 7) return;
      runs.push({ id: current.ad, ad: current.ad, km: Math.round(km), cizgi: slice });
    }
    for (var p = 0; p < tags.length; p++) {
      var ad = tags[p] && tags[p].ad;
      var curAd = current && current.ad;
      if (ad && ad === curAd) continue;
      if (current) close(p - 1);
      current = tags[p] || null;
      start = tags[p] ? p : -1;
    }
    if (current) close(tags.length - 1);
    return runs;
  }

  // 1 Temmuz 2026 KGM Anadolu Otoyolu gişe tarifesi, KDV dahil.
  // Her satır, o kilometreye kadar olan resmi gişe çiftinin 4 ve 5. sınıf tutarı.
  var OTOYOL_TARIFE = {
    'O-4': [
      { km: 7.7, sinif4: 73, sinif5: 115 },
      { km: 13.2, sinif4: 102, sinif5: 115 },
      { km: 24.3, sinif4: 102, sinif5: 115 },
      { km: 26.4, sinif4: 115, sinif5: 148 },
      { km: 45.9, sinif4: 148, sinif5: 168 },
      { km: 59.4, sinif4: 148, sinif5: 168 },
      { km: 87.5, sinif4: 193, sinif5: 256 },
      { km: 122.6, sinif4: 256, sinif5: 269 },
      { km: 183.9, sinif4: 317, sinif5: 378 },
      { km: 226.1, sinif4: 522, sinif5: 640 },
      { km: 1e9, sinif4: 675, sinif5: 811 }
    ]
  };

  function otoyolBedel(ad, km) {
    var rows = OTOYOL_TARIFE[ad];
    if (!rows || !(km > 0)) return null;
    var pick = rows[rows.length - 1];
    for (var i = 0; i < rows.length; i++) {
      if (km <= rows[i].km) { pick = rows[i]; break; }
    }
    return { sinif4: pick.sinif4, sinif5: pick.sinif5 };
  }

  function gecen(cizgi) {
    var line = Array.isArray(cizgi) ? cizgi : [];
    var acik = [];
    var kapali = [];
    if (line.length < 2) return { acik: acik, kapali: kapali };
    for (var k = 0; k < kopruler.length; k++) {
      var bridge = kopruler[k];
      var hit = false;
      for (var i = 1; i < line.length; i++) {
        if (segmentKm(bridge.lon, bridge.lat, line[i - 1], line[i]) <= bridge.yaricapKm) {
          hit = true;
          break;
        }
      }
      if (!hit) continue;
      if (bridge.tir) acik.push(bridge);
      else kapali.push(bridge);
    }
    return { acik: acik, kapali: kapali };
  }

  var api = { limanlar: limanlar, kopruler: kopruler, gecen: gecen, ucretliParcalar: ucretliParcalar, otoyolBedel: otoyolBedel };
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.NK_LIMAN = api;
})(typeof window === 'undefined' ? global : window);
