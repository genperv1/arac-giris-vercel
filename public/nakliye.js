(function () {
  'use strict';

  var W = 1000;
  var H = 460;
  var TURKEY = { minLon: 25.6, maxLon: 44.9, minLat: 35.7, maxLat: 42.2 };
  var CIKISLAR = [
    { id: 'ist-fabrika', ad: 'İstanbul Fabrika', adres: 'Ayazağa Mah. Kemerburgaz Cad. No:24 Sarıyer / İSTANBUL', plaka: 34, il: 'İstanbul', ilce: 'Sarıyer', lat: 41.1173, lon: 28.9723 },
    { id: 'ist-ofis', ad: 'İstanbul Ofis', adres: 'Mimar Sinan Mah. 3. Deniz Sokak No:13/D1 Kemerburgaz Eyüpsultan / İSTANBUL', plaka: 34, il: 'İstanbul', ilce: 'Eyüpsultan', lat: 41.1591, lon: 28.9147 },
    { id: 'kut-fabrika', ad: 'Kütahya Fabrika', adres: '1. Organize Sanayi Bölgesi Rıza Güral Caddesi No:16 Merkez / KÜTAHYA', plaka: 43, il: 'Kütahya', ilce: 'Merkez', lat: 39.3989, lon: 30.1124 },
    { id: 'maden', ad: 'Maden Sahası', adres: 'Teşvikiye Köyü 4. Kd Sokak Merkez / KÜTAHYA', plaka: 43, il: 'Kütahya', ilce: 'Merkez', lat: 39.2857, lon: 30.3142 }
  ];
  var state = {
    side: 'to',
    from: null,
    to: null,
    focus: null,
    litrePer100: 35,
    preset: 'yuklu',
    donus: false,
    mazot: null,
    route: null,
    places: null,
    geo: null,
    boxes: {},
  };
  var routeCtl = null;

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function foldTr(value) {
    return String(value || '')
      .toLocaleLowerCase('tr-TR')
      .replace(/ı/g, 'i').replace(/ğ/g, 'g').replace(/ü/g, 'u')
      .replace(/ş/g, 's').replace(/ö/g, 'o').replace(/ç/g, 'c')
      .replace(/[^a-z0-9]/g, '');
  }

  function authHeaders() {
    var h = {};
    try {
      var token = localStorage.getItem('authToken') || '';
      if (token) h.Authorization = 'Bearer ' + token;
    } catch (e) { /* ignore */ }
    return h;
  }

  function isSaban() {
    try {
      if (window.SessionManager && typeof window.SessionManager.isSabanUser === 'function') {
        return !!window.SessionManager.isSabanUser();
      }
      return String(localStorage.getItem('currentUserId') || '').trim().toLowerCase() === 'saban';
    } catch (e) {
      return false;
    }
  }

  function goHome() {
    try {
      if (window.SessionManager && typeof window.SessionManager.navigateToHome === 'function') {
        window.SessionManager.navigateToHome();
        return;
      }
    } catch (e) { /* ignore */ }
    window.location.href = '/GIRIS.html';
  }

  function fmt(n, digits) {
    return new Intl.NumberFormat('tr-TR', {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(n);
  }

  function sureText(dk) {
    if (dk == null || !isFinite(dk)) return '';
    var total = Math.round(dk) * (state.donus ? 2 : 1);
    var h = Math.floor(total / 60);
    var m = total % 60;
    if (h <= 0) return m + ' dk';
    return h + ' sa ' + m + ' dk';
  }

  function project(lon, lat, box) {
    var x = (lon - box.minLon) / (box.maxLon - box.minLon) * W;
    var y = (1 - (lat - box.minLat) / (box.maxLat - box.minLat)) * H;
    return [x, y];
  }

  function padBox(box) {
    var dx = (box.maxLon - box.minLon) * 0.12 || 0.4;
    var dy = (box.maxLat - box.minLat) * 0.12 || 0.3;
    return {
      minLon: box.minLon - dx,
      maxLon: box.maxLon + dx,
      minLat: box.minLat - dy,
      maxLat: box.maxLat + dy,
    };
  }

  function geomBox(geometry) {
    var minLon = Infinity; var minLat = Infinity; var maxLon = -Infinity; var maxLat = -Infinity;
    function visit(node) {
      if (typeof node[0] === 'number') {
        if (node[0] < minLon) minLon = node[0];
        if (node[0] > maxLon) maxLon = node[0];
        if (node[1] < minLat) minLat = node[1];
        if (node[1] > maxLat) maxLat = node[1];
        return;
      }
      for (var i = 0; i < node.length; i++) visit(node[i]);
    }
    visit(geometry.coordinates);
    return { minLon: minLon, minLat: minLat, maxLon: maxLon, maxLat: maxLat };
  }

  function pathOf(geometry, box) {
    var polys = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
    var d = '';
    for (var p = 0; p < polys.length; p++) {
      var rings = polys[p];
      for (var r = 0; r < rings.length; r++) {
        var ring = rings[r];
        for (var i = 0; i < ring.length; i++) {
          var xy = project(ring[i][0], ring[i][1], box);
          d += (i ? 'L' : 'M') + xy[0].toFixed(1) + ' ' + xy[1].toFixed(1);
        }
        d += 'Z';
      }
    }
    return d;
  }

  function ilByPlaka(plaka) {
    var iller = (state.places && state.places.iller) || [];
    for (var i = 0; i < iller.length; i++) if (iller[i].plaka === plaka) return iller[i];
    return null;
  }

  function ilcelerOf(plaka) {
    return ((state.places && state.places.ilceler) || []).filter(function (d) { return d.plaka === plaka; });
  }

  function ilCenter(plaka) {
    var rows = ilcelerOf(plaka);
    if (!rows.length) {
      var il = ilByPlaka(plaka);
      return il ? { lat: il.lat, lon: il.lon } : null;
    }
    var lat = 0; var lon = 0;
    for (var i = 0; i < rows.length; i++) { lat += rows[i].lat; lon += rows[i].lon; }
    return { lat: lat / rows.length, lon: lon / rows.length };
  }

  function placeLabel(place) {
    if (!place) return 'Seçilmedi';
    return place.ilce ? (place.il + ' / ' + place.ilce) : (place.il + ' (il merkezi)');
  }

  function selectOrigin(id) {
    var site = null;
    for (var i = 0; i < CIKISLAR.length; i++) if (CIKISLAR[i].id === id) site = CIKISLAR[i];
    if (!site) return;
    state.from = {
      plaka: site.plaka, il: site.il, ilce: site.ilce,
      lat: site.lat, lon: site.lon, tesis: site.ad, adres: site.adres, id: site.id
    };
    state.side = 'to';
    fillPrice();
    render();
    scheduleRoute();
  }

  function choose(place) {
    state.to = place;
    state.focus = place.plaka;
    state.side = 'to';
    render();
    scheduleRoute();
  }

  function selectIl(plaka, advance) {
    var il = ilByPlaka(plaka);
    var center = ilCenter(plaka);
    if (!il || !center) return;
    choose({ plaka: plaka, il: il.ad, ilce: null, lat: center.lat, lon: center.lon });
    void advance;
  }

  function selectIlce(row, advance) {
    var il = ilByPlaka(row.plaka);
    if (!il) return;
    choose({ plaka: row.plaka, il: il.ad, ilce: row.ad, lat: row.lat, lon: row.lon });
    void advance;
  }

  function fiyatOf(place) {
    if (!place || !state.mazot) return null;
    if (place.ilce) {
      var list = state.mazot.ilceler || [];
      for (var i = 0; i < list.length; i++) {
        if (list[i].plaka === place.plaka && foldTr(list[i].ad) === foldTr(place.ilce)) return list[i].mazot;
      }
    }
    var iller = state.mazot.iller || [];
    for (var j = 0; j < iller.length; j++) if (iller[j].plaka === place.plaka) return iller[j].mazot;
    return null;
  }

  function activePrice() {
    return fiyatOf(state.from);
  }

  function fillPrice() {
    var price = fiyatOf(state.from);
    var meta = document.getElementById('nkMazotMeta');
    var where = document.getElementById('nkMazotWhere');
    if (!state.mazot) {
      if (meta) meta.textContent = 'Güncel mazot fiyatı internetten alınıyor…';
      if (where) where.textContent = 'OPET pompa fiyatı';
      return;
    }
    if (!state.from) {
      if (where) where.textContent = 'Çıkış seçilince o ilin fiyatı kullanılır';
      if (meta) meta.textContent = 'Litre fiyatı internetten gelir, elle girilmez.';
      return;
    }
    if (price == null) {
      if (where) where.textContent = state.from.il + ' fiyatı alınamadı';
      if (meta) meta.textContent = 'Yenile ile tekrar internetten isteyin.';
      return;
    }
    var yer = state.from.tesis ? (state.from.tesis + ' · ' + state.from.il) : state.from.il;
    if (where) where.textContent = yer;
    if (meta) meta.textContent = fmt(price, 2) + ' TL/L · güncel pompa fiyatı';
  }

  function round1(n) { return Math.round(n * 10) / 10; }
  function round2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }

  function fuel() {
    var tek = state.route && isFinite(state.route.km) ? Number(state.route.km) : 0;
    var mesafe = round1(tek * (state.donus ? 2 : 1));
    var litre = round1(mesafe * state.litrePer100 / 100);
    var fiyat = activePrice();
    var tutar = fiyat == null ? null : round2(litre * fiyat);
    return { mesafe: mesafe, litre: litre, fiyat: fiyat, tutar: tutar };
  }

  function renderOrigin() {
    var host = document.getElementById('nkOrigins');
    host.innerHTML = CIKISLAR.map(function (site) {
      var on = state.from && state.from.id === site.id;
      return '<button type="button" class="nk-origin' + (on ? ' is-on' : '') + '" data-origin="' + site.id + '">' + esc(site.ad) + '</button>';
    }).join('');
    var card = document.getElementById('nkOriginCard');
    if (!state.from) { card.hidden = true; }
    else {
      card.hidden = false;
      document.getElementById('nkOriginName').textContent = state.from.tesis;
      document.getElementById('nkOriginAddr').textContent = state.from.adres;
    }
    document.getElementById('nkToLine').textContent = state.to ? placeLabel(state.to) : 'İl ve ilçe seçilmedi';
  }

  function renderIlceler() {
    var host = document.getElementById('nkIlceList');
    if (!state.focus) { host.innerHTML = ''; return; }
    var il = ilByPlaka(state.focus);
    var rows = ilcelerOf(state.focus).slice().sort(function (a, b) { return a.ad.localeCompare(b.ad, 'tr'); });
    var current = state.to;
    host.innerHTML = rows.map(function (row) {
      var on = current && current.plaka === row.plaka && foldTr(current.ilce) === foldTr(row.ad);
      return '<button type="button" class="nk-chip' + (on ? ' is-on' : '') + '" data-ilce="' + esc(row.ad) + '" data-plaka="' + row.plaka + '">' + esc(row.ad) + '</button>';
    }).join('');
    document.getElementById('nkMapHint').textContent = (il ? il.ad : 'İl') + ' ilçesinden varışı seçin.';
  }

  function arrowParts(x1, y1, x2, y2) {
    var dx = x2 - x1;
    var dy = y2 - y1;
    var len = Math.sqrt(dx * dx + dy * dy) || 1;
    var ux = dx / len;
    var uy = dy / len;
    var sx = x1 + ux * 16;
    var sy = y1 + uy * 16;
    var ex = x2 - ux * 18;
    var ey = y2 - uy * 18;
    var px = -uy;
    var py = ux;
    var bx = ex - ux * 16;
    var by = ey - uy * 16;
    return {
      line: 'M' + sx.toFixed(1) + ' ' + sy.toFixed(1) + ' L' + bx.toFixed(1) + ' ' + by.toFixed(1),
      head: 'M' + ex.toFixed(1) + ' ' + ey.toFixed(1)
        + ' L' + (bx + px * 8).toFixed(1) + ' ' + (by + py * 8).toFixed(1)
        + ' L' + (bx - px * 8).toFixed(1) + ' ' + (by - py * 8).toFixed(1) + ' Z'
    };
  }

  function renderMap() {
    var svg = document.getElementById('nkMap');
    if (!state.geo) { svg.innerHTML = ''; return; }
    var box = TURKEY;
    var html = '';
    var features = state.geo.features || [];
    for (var i = 0; i < features.length; i++) {
      var f = features[i];
      var plaka = Number(f.properties.number);
      var cls = 'nk-il';
      var fromHere = state.from && state.from.plaka === plaka;
      var toHere = state.to && state.to.plaka === plaka;
      if (fromHere && toHere) cls += ' is-both';
      else if (fromHere) cls += ' is-from';
      else if (toHere) cls += ' is-to';
      html += '<path class="' + cls + '" vector-effect="non-scaling-stroke" data-plaka="' + plaka + '" d="' + pathOf(f.geometry, box) + '"><title>' + esc(f.properties.name) + '</title></path>';
    }
    var fromPt = state.from ? project(state.from.lon, state.from.lat, box) : null;
    var toPt = state.to ? project(state.to.lon, state.to.lat, box) : null;
    if (fromPt && toPt) {
      var arrow = arrowParts(fromPt[0], fromPt[1], toPt[0], toPt[1]);
      html += '<path class="nk-route" vector-effect="non-scaling-stroke" d="' + arrow.line + '"></path>';
      html += '<path class="nk-arrow-head" d="' + arrow.head + '"></path>';
      var fromName = state.from.tesis || state.from.ilce || state.from.il;
      var toName = state.to.ilce ? (state.to.il + ' / ' + state.to.ilce) : state.to.il;
      html += '<text class="nk-pin-label" x="' + (fromPt[0] + 10).toFixed(1) + '" y="' + (fromPt[1] - 8).toFixed(1) + '">Buradan · ' + esc(fromName) + '</text>';
      html += '<text class="nk-pin-label" x="' + (toPt[0] + 10).toFixed(1) + '" y="' + (toPt[1] - 8).toFixed(1) + '">Buraya · ' + esc(toName) + '</text>';
      document.getElementById('nkMapHint').textContent = 'Buradan ' + fromName + ' → buraya ' + toName;
    } else if (fromPt) {
      document.getElementById('nkMapHint').textContent = 'Çıkış hazır. Haritadan varış iline basın, ilçeyi listeden seçin.';
    }
    if (fromPt) html += '<circle class="nk-end is-from" cx="' + fromPt[0].toFixed(1) + '" cy="' + fromPt[1].toFixed(1) + '" r="7"></circle>';
    if (toPt) html += '<circle class="nk-end is-to" cx="' + toPt[0].toFixed(1) + '" cy="' + toPt[1].toFixed(1) + '" r="7"></circle>';
    svg.innerHTML = html;
    renderLabels();
  }

  function userPx(screenPx) {
    var svg = document.getElementById('nkMap');
    var css = svg.getBoundingClientRect().width || 900;
    return screenPx * mapView.w / css;
  }

  function provinceSpan(plaka) {
    var box = state.boxes[plaka];
    if (!box) return 70;
    var a = project(box.minLon, box.minLat, TURKEY);
    var b = project(box.maxLon, box.maxLat, TURKEY);
    return Math.max(12, Math.abs(b[0] - a[0]));
  }

  function labelAnchor(plaka, fallbackLon, fallbackLat) {
    var il = ilByPlaka(plaka);
    if (il && isFinite(il.lon) && isFinite(il.lat)) return project(il.lon, il.lat, TURKEY);
    if (isFinite(fallbackLon) && isFinite(fallbackLat)) return project(fallbackLon, fallbackLat, TURKEY);
    var box = state.boxes[plaka];
    if (!box) return null;
    return project((box.minLon + box.maxLon) / 2, (box.minLat + box.maxLat) / 2, TURKEY);
  }

  function seenOnMap(x, y) {
    var pad = 24;
    return x >= mapView.x - pad && x <= mapView.x + mapView.w + pad
      && y >= mapView.y - pad && y <= mapView.y + mapView.h + pad;
  }

  function addMapText(parent, cls, x, y, size, text) {
    var node = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    node.setAttribute('class', cls);
    node.setAttribute('x', x.toFixed(1));
    node.setAttribute('y', y.toFixed(1));
    node.setAttribute('font-size', size.toFixed(2));
    node.setAttribute('stroke-width', (size * 0.28).toFixed(2));
    node.textContent = text;
    parent.appendChild(node);
  }

  var labelFrame = 0;
  function scheduleLabels() {
    if (labelFrame) return;
    labelFrame = requestAnimationFrame(function () {
      labelFrame = 0;
      renderLabels();
    });
  }

  function renderLabels() {
    var svg = document.getElementById('nkMap');
    if (!svg || !state.geo) return;
    var prev = document.getElementById('nkLabels');
    if (prev) prev.remove();
    var g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('id', 'nkLabels');
    var ilSize = userPx(12);
    var features = state.geo.features || [];
    for (var i = 0; i < features.length; i++) {
      var f = features[i];
      var plaka = Number(f.properties.number);
      var pt = labelAnchor(plaka);
      if (!pt || !seenOnMap(pt[0], pt[1])) continue;
      var name = f.properties.name || '';
      var span = provinceSpan(plaka);
      var size = ilSize;
      var est = name.length * size * 0.54;
      if (est > span * 0.9) size = Math.max(userPx(7), span * 0.9 / (name.length * 0.54 || 1));
      addMapText(g, 'nk-il-label', pt[0], pt[1], size, name);
    }
    svg.appendChild(g);
  }

  function renderResults() {
    var sonuc = fuel();
    var hasEnds = !!(state.from && state.to);
    document.getElementById('nkKm').textContent = hasEnds && state.route ? fmt(sonuc.mesafe, 1) + ' km' : '—';
    var sure = document.getElementById('nkSure');
    if (!state.route) sure.textContent = hasEnds ? 'Mesafe hesaplanıyor' : 'İki nokta seçin';
    else if (state.route.kaynak === 'kus-ucusu') sure.textContent = 'Kuş uçuşu tahmin, yol payı %30' + (state.donus ? ' · gidiş-dönüş' : '');
    else if (state.route.kaynak === 'ayni') sure.textContent = 'Çıkış ve varış aynı yer';
    else sure.textContent = 'Karayolu' + (sureText(state.route.sureDk) ? ' · ' + sureText(state.route.sureDk) : '') + (state.donus ? ' · gidiş-dönüş' : '');
    document.getElementById('nkMazot').textContent = sonuc.fiyat == null ? '—' : fmt(sonuc.fiyat, 2) + ' TL';
    document.getElementById('nkLitreOut').textContent = hasEnds && state.route ? fmt(sonuc.litre, 1) + ' L' : '—';
    document.getElementById('nkTutar').textContent = hasEnds && state.route && sonuc.tutar != null ? fmt(sonuc.tutar, 2) + ' TL' : '—';
    var note = state.preset === 'bos' ? 'Boş tır · 28 L/100 km' : (state.preset === 'agir' ? 'Ağır tır · 40 L/100 km' : 'Yüklü tır · ' + fmt(state.litrePer100, 1) + ' L/100 km');
    if (state.preset === 'elle') note = fmt(state.litrePer100, 1) + ' L/100 km';
    document.getElementById('nkTuketimNote').textContent = note;
  }

  function renderPrices() {
    var lead = document.getElementById('nkPriceLead');
    var grid = document.getElementById('nkPriceGrid');
    if (!state.mazot || !state.mazot.iller) {
      lead.textContent = 'Güncel mazot fiyatı internetten alınamadı. Yenile ile tekrar deneyin.';
      grid.innerHTML = '';
      return;
    }
    var when = '';
    if (state.mazot.updatedAt) {
      when = new Date(state.mazot.updatedAt).toLocaleString('tr-TR', {
        timeZone: 'Europe/Istanbul', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
      });
    }
    lead.textContent = (state.mazot.urun || 'Motorin') + ' · ' + (state.mazot.kaynak || 'OPET')
      + (when ? ' · ' + when : '')
      + (state.mazot.bayat ? ' · son bilinen fiyat' : '')
      + '. Hesap çıkış ilçesinin fiyatıyla yapılır.';
    var iller = state.mazot.iller.slice().sort(function (a, b) { return a.ad.localeCompare(b.ad, 'tr'); });
    grid.innerHTML = iller.map(function (il) {
      var cls = 'nk-price';
      if (state.from && state.from.plaka === il.plaka) cls += ' is-from';
      if (state.to && state.to.plaka === il.plaka) cls += ' is-to';
      return '<button type="button" class="' + cls + '" data-price-plaka="' + il.plaka + '"><b>' + esc(il.ad) + '</b><span>' + fmt(il.mazot, 2) + ' TL</span></button>';
    }).join('');
  }

  function render() {
    renderOrigin();
    renderIlceler();
    renderMap();
    renderResults();
    renderPrices();
  }

  function scheduleRoute() {
    if (routeCtl) routeCtl.abort();
    if (!state.from || !state.to) {
      state.route = null;
      renderResults();
      return;
    }
    var straight = Math.abs(state.from.lat - state.to.lat) + Math.abs(state.from.lon - state.to.lon);
    if (straight < 0.02 && foldTr(state.from.ilce || state.from.il) === foldTr(state.to.ilce || state.to.il)) {
      state.route = { km: 0, sureDk: 0, cizgi: [], kaynak: 'ayni' };
      render();
      return;
    }
    routeCtl = new AbortController();
    var ctl = routeCtl;
    var q = 'olon=' + encodeURIComponent(state.from.lon) + '&olat=' + encodeURIComponent(state.from.lat)
      + '&dlon=' + encodeURIComponent(state.to.lon) + '&dlat=' + encodeURIComponent(state.to.lat);
    fetch('/api/nakliye/mesafe?' + q, { credentials: 'include', cache: 'no-store', headers: authHeaders(), signal: ctl.signal })
      .then(function (res) { if (!res.ok) throw new Error('mesafe'); return res.json(); })
      .then(function (data) {
        if (ctl.signal.aborted) return;
        state.route = data;
        render();
      })
      .catch(function (err) {
        if (err && err.name === 'AbortError') return;
        state.route = null;
        renderResults();
      });
  }

  function loadMazot() {
    document.getElementById('nkPriceLead').textContent = 'Güncel mazot fiyatları alınıyor…';
    return fetch('/api/nakliye/mazot', { credentials: 'include', cache: 'no-store', headers: authHeaders() })
      .then(function (res) {
        if (!res.ok) throw new Error('mazot');
        return res.json();
      })
      .then(function (data) {
        if (!data) return;
        state.mazot = data;
        fillPrice();
        render();
      })
      .catch(function () {
        state.mazot = null;
        fillPrice();
        renderPrices();
      });
  }

  function searchHits(q) {
    var f = foldTr(q);
    if (f.length < 2 || !state.places) return [];
    var hits = [];
    var iller = state.places.iller || [];
    for (var i = 0; i < iller.length; i++) {
      if (foldTr(iller[i].ad).indexOf(f) >= 0) hits.push({ kind: 'il', plaka: iller[i].plaka, ad: iller[i].ad });
    }
    var ilceler = state.places.ilceler || [];
    for (var j = 0; j < ilceler.length && hits.length < 14; j++) {
      var il = ilByPlaka(ilceler[j].plaka);
      var label = (il ? il.ad : '') + ilceler[j].ad;
      if (foldTr(ilceler[j].ad).indexOf(f) >= 0 || foldTr(label).indexOf(f) >= 0) {
        hits.push({ kind: 'ilce', plaka: ilceler[j].plaka, ad: ilceler[j].ad, il: il ? il.ad : '', lat: ilceler[j].lat, lon: ilceler[j].lon });
      }
    }
    return hits.slice(0, 14);
  }

  function showSuggest(hits) {
    var box = document.getElementById('nkSuggest');
    if (!hits.length) { box.hidden = true; box.innerHTML = ''; return; }
    box.hidden = false;
    box.innerHTML = hits.map(function (hit, idx) {
      var text = hit.kind === 'il' ? hit.ad : (hit.il + ' / ' + hit.ad);
      return '<button type="button" data-idx="' + idx + '">' + esc(text) + '</button>';
    }).join('');
    box._hits = hits;
  }

  var mapView = { x: 0, y: 0, w: W, h: H };
  var mapDrag = null;
  var mapSkipClick = false;

  function applyMapView() {
    var svg = document.getElementById('nkMap');
    svg.setAttribute('viewBox', mapView.x.toFixed(2) + ' ' + mapView.y.toFixed(2) + ' ' + mapView.w.toFixed(2) + ' ' + mapView.h.toFixed(2));
    scheduleLabels();
  }

  function clampMapView() {
    var minW = W / 16;
    if (mapView.w >= W) {
      mapView.x = 0;
      mapView.y = 0;
      mapView.w = W;
      mapView.h = H;
      return;
    }
    if (mapView.w < minW) {
      var cx = mapView.x + mapView.w / 2;
      var cy = mapView.y + mapView.h / 2;
      mapView.w = minW;
      mapView.h = minW * H / W;
      mapView.x = cx - mapView.w / 2;
      mapView.y = cy - mapView.h / 2;
    }
    var mx = mapView.w * 0.4;
    var my = mapView.h * 0.4;
    if (mapView.x < -mx) mapView.x = -mx;
    if (mapView.y < -my) mapView.y = -my;
    if (mapView.x + mapView.w > W + mx) mapView.x = W + mx - mapView.w;
    if (mapView.y + mapView.h > H + my) mapView.y = H + my - mapView.h;
  }

  function pointInMap(ev) {
    var svg = document.getElementById('nkMap');
    var rect = svg.getBoundingClientRect();
    return {
      x: mapView.x + ((ev.clientX - rect.left) / rect.width) * mapView.w,
      y: mapView.y + ((ev.clientY - rect.top) / rect.height) * mapView.h,
      rect: rect,
    };
  }

  function bindMapPointer() {
    var svg = document.getElementById('nkMap');
    svg.addEventListener('wheel', function (ev) {
      ev.preventDefault();
      var here = pointInMap(ev);
      var dy = ev.deltaY;
      if (ev.deltaMode === 1) dy *= 16;
      else if (ev.deltaMode === 2) dy *= here.rect.height;
      var steps = Math.max(-3, Math.min(3, dy / 80));
      if (!steps) steps = dy > 0 ? 1 : -1;
      var factor = Math.pow(1.14, steps);
      var nextW = mapView.w * factor;
      if (nextW > W) nextW = W;
      var nextH = nextW * H / W;
      var rx = (here.x - mapView.x) / mapView.w;
      var ry = (here.y - mapView.y) / mapView.h;
      mapView.w = nextW;
      mapView.h = nextH;
      mapView.x = here.x - rx * nextW;
      mapView.y = here.y - ry * nextH;
      clampMapView();
      applyMapView();
    }, { passive: false });
    svg.addEventListener('mousedown', function (ev) {
      if (ev.button !== 0) return;
      mapDrag = { x: ev.clientX, y: ev.clientY, vx: mapView.x, vy: mapView.y, moved: false };
      svg.classList.add('is-drag');
    });
    window.addEventListener('mousemove', function (ev) {
      if (!mapDrag) return;
      var rect = svg.getBoundingClientRect();
      var dx = (ev.clientX - mapDrag.x) / rect.width * mapView.w;
      var dy = (ev.clientY - mapDrag.y) / rect.height * mapView.h;
      if (Math.abs(ev.clientX - mapDrag.x) > 4 || Math.abs(ev.clientY - mapDrag.y) > 4) mapDrag.moved = true;
      mapView.x = mapDrag.vx - dx;
      mapView.y = mapDrag.vy - dy;
      clampMapView();
      applyMapView();
    });
    window.addEventListener('mouseup', function () {
      if (!mapDrag) return;
      mapSkipClick = mapDrag.moved;
      mapDrag = null;
      svg.classList.remove('is-drag');
    });
    svg.addEventListener('dblclick', function (ev) {
      ev.preventDefault();
      mapView.x = 0;
      mapView.y = 0;
      mapView.w = W;
      mapView.h = H;
      applyMapView();
    });
  }

  function bind() {
    if (!isSaban()) { goHome(); return; }
    bindMapPointer();
    document.getElementById('nkOrigins').addEventListener('click', function (ev) {
      var btn = ev.target.closest ? ev.target.closest('[data-origin]') : null;
      if (!btn) return;
      selectOrigin(btn.getAttribute('data-origin'));
    });
    document.getElementById('nkMap').addEventListener('click', function (ev) {
      if (mapSkipClick) { mapSkipClick = false; return; }
      var path = ev.target.closest ? ev.target.closest('[data-plaka]') : null;
      if (path) selectIl(Number(path.getAttribute('data-plaka')), false);
    });
    document.getElementById('nkIlceList').addEventListener('click', function (ev) {
      var btn = ev.target.closest ? ev.target.closest('[data-ilce]') : null;
      if (!btn) return;
      var plaka = Number(btn.getAttribute('data-plaka'));
      var ad = btn.getAttribute('data-ilce');
      var rows = ilcelerOf(plaka);
      for (var i = 0; i < rows.length; i++) if (rows[i].ad === ad) selectIlce(rows[i], true);
    });
    document.getElementById('nkPriceGrid').addEventListener('click', function (ev) {
      var btn = ev.target.closest ? ev.target.closest('[data-price-plaka]') : null;
      if (!btn) return;
      selectIl(Number(btn.getAttribute('data-price-plaka')), false);
    });
    var search = document.getElementById('nkSearch');
    search.addEventListener('input', function () { showSuggest(searchHits(search.value)); });
    document.getElementById('nkSuggest').addEventListener('click', function (ev) {
      var btn = ev.target.closest ? ev.target.closest('[data-idx]') : null;
      if (!btn) return;
      var hit = document.getElementById('nkSuggest')._hits[Number(btn.getAttribute('data-idx'))];
      document.getElementById('nkSuggest').hidden = true;
      search.value = '';
      if (hit.kind === 'il') selectIl(hit.plaka, false);
      else selectIlce(hit, true);
    });
    document.getElementById('nkPresets').addEventListener('click', function (ev) {
      var btn = ev.target.closest ? ev.target.closest('[data-litre]') : null;
      if (!btn) return;
      state.preset = btn.getAttribute('data-preset');
      state.litrePer100 = Number(btn.getAttribute('data-litre'));
      document.getElementById('nkLitre').value = String(state.litrePer100);
      document.querySelectorAll('#nkPresets .nk-btn').forEach(function (el) {
        el.classList.toggle('nk-btn--primary', el === btn);
      });
      renderResults();
    });
    document.getElementById('nkLitre').addEventListener('input', function (ev) {
      var n = Number(String(ev.target.value || '').replace(',', '.'));
      if (!isFinite(n) || n < 0) return;
      state.litrePer100 = n;
      state.preset = 'elle';
      document.querySelectorAll('#nkPresets .nk-btn').forEach(function (el) { el.classList.remove('nk-btn--primary'); });
      renderResults();
    });
    document.getElementById('nkDonus').addEventListener('change', function (ev) {
      state.donus = !!ev.target.checked;
      renderResults();
    });
    document.getElementById('nkMazotBtn').addEventListener('click', function () {
      state.mazot = null;
      fillPrice();
      loadMazot();
    });

    Promise.all([
      fetch('data/tr-iller.geojson?v=20261008-nakliye', { cache: 'force-cache' }).then(function (r) { return r.json(); }),
      fetch('data/tr-ilceler.json?v=20261008-nakliye', { cache: 'force-cache' }).then(function (r) { return r.json(); }),
    ]).then(function (pair) {
      state.geo = pair[0];
      state.places = pair[1];
      (state.geo.features || []).forEach(function (f) {
        state.boxes[Number(f.properties.number)] = geomBox(f.geometry);
      });
      render();
      loadMazot();
    }).catch(function () {
      document.getElementById('nkMapHint').textContent = 'Harita verisi yüklenemedi.';
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind);
  else bind();
})();
