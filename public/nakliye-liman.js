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

  var api = { limanlar: limanlar, kopruler: kopruler, gecen: gecen };
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.NK_LIMAN = api;
})(typeof window === 'undefined' ? global : window);
