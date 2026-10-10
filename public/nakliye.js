(function () {
  'use strict';

  var W = 1000;
  var H = 460;
  var TURKEY = { minLon: 25.6, maxLon: 44.9, minLat: 35.7, maxLat: 42.2 };
  var CIKISLAR = [
    { id: 'kut-fabrika', ad: 'Kütahya Fabrika', adres: '1. Organize Sanayi Bölgesi Rıza Güral Caddesi No:16 Merkez / KÜTAHYA', plaka: 43, il: 'Kütahya', ilce: 'Merkez', lat: 39.3989, lon: 30.1124 },
    { id: 'maden', ad: 'Maden Sahası', adres: 'Teşvikiye Köyü 4. Kd Sokak Merkez / KÜTAHYA', plaka: 43, il: 'Kütahya', ilce: 'Merkez', lat: 39.2857, lon: 30.3142 }
  ];
  var state = {
    side: 'to',
    pickFrom: false,
    fromFocus: null,
    from: null,
    to: null,
    focus: null,
    litrePer100: 37,
    preset: 'agir',
    donus: false,
    mazot: null,
    mazotError: '',
    route: null,
    routeError: '',
    yollar: [],
    yolIndex: 0,
    places: null,
    geo: null,
    otoyol: null,
    ucret: [],
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

  function isSaban() {
    try {
      const id = String(localStorage.getItem('currentUserId') || '').trim().toLowerCase();
      if (id === 'saban' || id === 'burak') return true;
      if (window.SessionManager && typeof window.SessionManager.isSabanUser === 'function') {
        return !!window.SessionManager.isSabanUser();
      }
      return false;
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

  var TIR_SURUS = { kmSaatMin: 60, kmSaatMax: 70, blokSaat: 4, gunlukSaat: 9, pencereSaat: 24 };
  var PRESET_AD = {
    bos: 'Boş',
    agir: 'Yüklü',
  };

  function surusDakika(km, kmSaat) {
    var mesafe = Math.max(0, Number(km) || 0);
    var hiz = Number(kmSaat);
    if (!mesafe || !isFinite(hiz) || hiz <= 0) return 0;
    return Math.round(mesafe / hiz * 60);
  }

  function varisDakika(surusDk) {
    var surus = Math.max(0, Math.round(Number(surusDk) || 0));
    var gunluk = TIR_SURUS.gunlukSaat * 60;
    var pencere = TIR_SURUS.pencereSaat * 60;
    var dinlenme = pencere - gunluk;
    if (surus <= gunluk) return surus;
    var tamGun = Math.floor(surus / gunluk);
    var kalan = surus % gunluk;
    if (kalan === 0) return surus + (tamGun - 1) * dinlenme;
    return tamGun * pencere + kalan;
  }

  function tirYolPlani(km) {
    var mesafeKm = round1(Math.max(0, Number(km) || 0));
    var kmSaat = (TIR_SURUS.kmSaatMin + TIR_SURUS.kmSaatMax) / 2;
    var surusDk = surusDakika(mesafeKm, kmSaat);
    var surusHizliDk = surusDakika(mesafeKm, TIR_SURUS.kmSaatMax);
    var surusYavasDk = surusDakika(mesafeKm, TIR_SURUS.kmSaatMin);
    return {
      mesafeKm: mesafeKm,
      surusDk: surusDk,
      surusHizliDk: surusHizliDk,
      surusYavasDk: surusYavasDk,
      varisDk: varisDakika(surusDk),
      varisHizliDk: varisDakika(surusHizliDk),
      varisYavasDk: varisDakika(surusYavasDk),
    };
  }

  function truckPlan() {
    if (!state.route || !isFinite(Number(state.route.km))) return null;
    return tirYolPlani(round1(Number(state.route.km) * (state.donus ? 2 : 1)));
  }

  function formatDk(dk) {
    if (dk == null || !isFinite(dk)) return '';
    var total = Math.max(0, Math.round(Number(dk)));
    var h = Math.floor(total / 60);
    var m = total % 60;
    if (h <= 0) return m + ' dk';
    if (m === 0) return h + ' sa';
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
    if (place.liman) return place.ad + ' · ' + place.ilce + ' / ' + place.il;
    return place.ilce ? (place.il + ' / ' + place.ilce) : (place.il + ' (il merkezi)');
  }

  function limanlar() {
    return (window.NK_LIMAN && window.NK_LIMAN.limanlar) || [];
  }

  function selectLiman(id) {
    var rows = limanlar();
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].id !== id) continue;
      choose({
        plaka: rows[i].plaka,
        il: rows[i].il,
        ilce: rows[i].ilce,
        lat: rows[i].lat,
        lon: rows[i].lon,
        liman: true,
        ad: rows[i].ad,
        limanId: rows[i].id,
      });
      return;
    }
  }

  function selectOrigin(id) {
    var site = null;
    for (var i = 0; i < CIKISLAR.length; i++) if (CIKISLAR[i].id === id) site = CIKISLAR[i];
    if (!site) return;
    state.pickFrom = false;
    state.fromFocus = null;
    state.from = {
      plaka: site.plaka, il: site.il, ilce: site.ilce,
      lat: site.lat, lon: site.lon, tesis: site.ad, adres: site.adres, id: site.id
    };
    state.side = 'to';
    fillPrice();
    render();
    scheduleRoute();
  }

  function setCustomFrom(place) {
    state.from = {
      plaka: place.plaka,
      il: place.il,
      ilce: place.ilce || null,
      lat: place.lat,
      lon: place.lon,
      tesis: place.tesis,
      adres: place.adres || 'Elle seçildi',
      id: null,
      liman: !!place.liman,
      ad: place.ad || '',
      limanId: place.limanId || null,
    };
    state.fromFocus = place.plaka;
    state.side = 'to';
    fillPrice();
    render();
    scheduleRoute();
  }

  function selectFromIl(plaka) {
    var il = ilByPlaka(plaka);
    var center = ilCenter(plaka);
    if (!il || !center) return;
    setCustomFrom({
      plaka: plaka,
      il: il.ad,
      ilce: null,
      lat: center.lat,
      lon: center.lon,
      tesis: il.ad,
      adres: 'Elle seçildi · il merkezi',
    });
  }

  function selectFromIlce(row) {
    var il = ilByPlaka(row.plaka);
    if (!il || row.lat == null || row.lon == null) return;
    setCustomFrom({
      plaka: row.plaka,
      il: il.ad,
      ilce: row.ad,
      lat: row.lat,
      lon: row.lon,
      tesis: il.ad + ' / ' + row.ad,
      adres: 'Elle seçildi',
    });
  }

  function selectFromLiman(id) {
    var rows = limanlar();
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].id !== id) continue;
      setCustomFrom({
        plaka: rows[i].plaka,
        il: rows[i].il,
        ilce: rows[i].ilce,
        lat: rows[i].lat,
        lon: rows[i].lon,
        liman: true,
        ad: rows[i].ad,
        limanId: rows[i].id,
        tesis: rows[i].ad,
        adres: rows[i].ilce + ' / ' + rows[i].il,
      });
      return;
    }
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

  function ilMazot(plaka) {
    var iller = (state.mazot && state.mazot.iller) || [];
    for (var i = 0; i < iller.length; i++) if (iller[i].plaka === plaka) return iller[i];
    return null;
  }

  function mazotWhen() {
    if (!state.mazot || !state.mazot.updatedAt) return '';
    return new Date(state.mazot.updatedAt).toLocaleString('tr-TR', {
      timeZone: 'Europe/Istanbul', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
    });
  }

  function mazotEski() {
    var m = state.mazot;
    if (!m || !m.iller || !m.iller.length) return false;
    return m.guncel !== true || m.bayat === true || m.dosya === true;
  }

  function mazotBaslikYaz() {
    var baslik = 'Mazot fiyatı';
    if (state.mazot && state.mazot.iller && state.mazot.iller.length) {
      baslik = mazotEski() ? 'Son doğrulanmış mazot' : 'Güncel mazot';
    }
    var card = document.getElementById('nkMazotTitle');
    var list = document.getElementById('nkPriceTitle');
    if (card) card.textContent = baslik;
    if (list) list.textContent = baslik;
  }

  function mazotKaynakMetni() {
    var when = mazotWhen();
    var kaynak = state.mazot.kaynak || 'OPET';
    if (mazotEski()) return 'Son doğrulanmış ' + kaynak + ' kaydı' + (when ? ' · ' + when : '') + ' · güncel fiyat değil';
    return (state.mazot.urun || 'Motorin') + ' · ' + kaynak + (when ? ' · ' + when : '');
  }

  function fillPrice() {
    var price = fiyatOf(state.from);
    var now = document.getElementById('nkMazotNow');
    var meta = document.getElementById('nkMazotMeta');
    var where = document.getElementById('nkMazotWhere');
    var kutahya = ilMazot(43);
    var istanbul = ilMazot(34);
    mazotBaslikYaz();
    if (!state.mazot || !state.mazot.iller || !state.mazot.iller.length) {
      if (now) now.textContent = '—';
      if (meta) meta.textContent = state.mazotError || 'Mazot fiyatı kontrol ediliyor…';
      if (where) where.textContent = 'OPET pompa fiyatı';
      return;
    }
    var shown = price;
    if (shown == null && state.from) {
      var fromIl = ilMazot(state.from.plaka);
      if (fromIl) shown = fromIl.mazot;
    }
    if (shown == null && kutahya) shown = kutahya.mazot;
    if (now) now.textContent = shown == null ? '—' : fmt(shown, 2) + ' TL/L';
    var bits = [];
    if (kutahya) bits.push('Kütahya ' + fmt(kutahya.mazot, 2));
    if (istanbul) bits.push('İstanbul ' + fmt(istanbul.mazot, 2));
    var kaynak = mazotKaynakMetni();
    if (state.from && price != null) {
      var yer = state.from.tesis ? (state.from.tesis + ' · ' + state.from.il) : state.from.il;
      if (where) where.textContent = yer;
      if (meta) meta.textContent = kaynak + (bits.length ? ' · ' + bits.join(' · ') : '');
      return;
    }
    if (where) where.textContent = state.from ? (state.from.il + ' fiyatı') : 'Çıkış ilinin pompa fiyatı';
    if (meta) meta.textContent = kaynak + (bits.length ? ' · ' + bits.join(' · ') : '');
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
    renderManual();
  }

  function renderManual() {
    var btn = document.getElementById('nkPickFrom');
    if (btn) btn.classList.toggle('is-on', !!state.pickFrom);
    var hint = document.getElementById('nkPickHint');
    if (hint) {
      hint.textContent = state.pickFrom
        ? 'Açık. Haritadaki ile veya limana basın, çıkış orası olur. İlçeyi alttaki düğmelerden seçin. Kütahya düğmesi bunu kapatır.'
        : 'Kutuya yazınca çıkış orası olur. Haritaya basarak seçmek için düğmeyi açın. Kapalıyken harita tıklaması varış seçer.';
    }
    var host = document.getElementById('nkFromIlce');
    if (!host) return;
    if (!state.pickFrom || !state.fromFocus) { host.innerHTML = ''; return; }
    var rows = ilcelerOf(state.fromFocus).slice().sort(function (a, b) { return a.ad.localeCompare(b.ad, 'tr'); });
    var current = state.from;
    host.innerHTML = rows.map(function (row) {
      var on = current && !current.id && current.plaka === row.plaka && foldTr(current.ilce) === foldTr(row.ad);
      return '<button type="button" class="nk-chip' + (on ? ' is-on' : '') + '" data-from-ilce="' + esc(row.ad) + '" data-plaka="' + row.plaka + '">' + esc(row.ad) + '</button>';
    }).join('');
  }

  function renderLimanlar() {
    var host = document.getElementById('nkLimanlar');
    if (!host) return;
    host.innerHTML = limanlar().map(function (row) {
      var on = state.to && state.to.limanId === row.id;
      return '<button type="button" class="nk-chip' + (on ? ' is-on' : '') + '" data-liman="' + esc(row.id) + '">' + esc(row.ad) + '</button>';
    }).join('');
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

  function linePath(cizgi, box) {
    if (!cizgi || cizgi.length < 2) return '';
    var d = '';
    for (var i = 0; i < cizgi.length; i++) {
      var xy = project(cizgi[i][0], cizgi[i][1], box);
      d += (i ? 'L' : 'M') + xy[0].toFixed(1) + ' ' + xy[1].toFixed(1);
    }
    return d;
  }

  function roadPath(box) {
    return linePath(state.route && state.route.cizgi, box);
  }

  function kopruDurumu() {
    var api = window.NK_LIMAN;
    var cizgi = state.route && state.route.cizgi;
    if (!api || typeof api.gecen !== 'function' || !cizgi) return { acik: [], kapali: [] };
    return api.gecen(cizgi);
  }

  var DENIZLER = [
    { ad: 'KARADENİZ', lon: 37.6, lat: 42.02, px: 15 },
    { ad: 'MARMARA', lon: 28.0, lat: 40.63, px: 11 },
    { ad: 'EGE', lon: 26.05, lat: 37.55, px: 13 },
    { ad: 'AKDENİZ', lon: 31.5, lat: 36.16, px: 15 }
  ];

  function otoyolPath(box) {
    var yollar = (state.otoyol && state.otoyol.yollar) || [];
    var d = '';
    for (var i = 0; i < yollar.length; i++) {
      var koord = yollar[i].koord;
      if (!koord || koord.length < 2) continue;
      for (var p = 0; p < koord.length; p++) {
        var xy = project(koord[p][0], koord[p][1], box);
        d += (p ? 'L' : 'M') + xy[0].toFixed(1) + ' ' + xy[1].toFixed(1);
      }
    }
    return d;
  }

  function syncUcret() {
    var api = window.NK_LIMAN;
    var cizgi = state.route && state.route.cizgi;
    var yollar = (state.otoyol && state.otoyol.yollar) || [];
    if (!api || typeof api.ucretliParcalar !== 'function' || !cizgi || !yollar.length || (state.route && state.route.kaynak === 'kus-ucusu')) {
      state.ucret = [];
      return;
    }
    state.ucret = api.ucretliParcalar(cizgi, yollar);
  }

  function netUcret4() {
    var api = window.NK_LIMAN;
    var parts = state.ucret || [];
    if (!api || typeof api.otoyolBedel !== 'function') return 0;
    var n = 0;
    for (var i = 0; i < parts.length; i++) {
      var bedel = api.otoyolBedel(parts[i].ad, parts[i].km);
      if (bedel) n += bedel.sinif4;
    }
    return n;
  }

  function ucretAdlari() {
    var names = [];
    var parts = state.ucret || [];
    for (var i = 0; i < parts.length; i++) {
      if (parts[i].ad && names.indexOf(parts[i].ad) < 0) names.push(parts[i].ad);
    }
    return names;
  }

  function renderMap() {
    var svg = document.getElementById('nkMap');
    if (!state.geo) { svg.innerHTML = ''; return; }
    var box = TURKEY;
    var html = '<defs>'
      + '<linearGradient id="nkSea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7eafd0"/><stop offset="1" stop-color="#b9d6ea"/></linearGradient>'
      + '<marker id="nkRoadArrow" markerUnits="strokeWidth" markerWidth="3.4" markerHeight="3.4" refX="2.6" refY="1.7" orient="auto">'
      + '<path d="M0,0 L3.4,1.7 L0,3.4 Z" fill="#3f362e"></path></marker></defs>';
    html += '<rect class="nk-sea" x="-500" y="-300" width="2000" height="1100" fill="url(#nkSea)"></rect>';
    var features = state.geo.features || [];
    for (var i = 0; i < features.length; i++) {
      var f = features[i];
      var plaka = Number(f.properties.number);
      var cls = 'nk-il nk-land-' + (Math.abs(plaka) % 6);
      var fromHere = state.from && state.from.plaka === plaka;
      var toHere = state.to && state.to.plaka === plaka;
      if (fromHere && toHere) cls += ' is-both';
      else if (fromHere) cls += ' is-from';
      else if (toHere) cls += ' is-to';
      html += '<path class="' + cls + '" vector-effect="non-scaling-stroke" data-plaka="' + plaka + '" d="' + pathOf(f.geometry, box) + '"><title>' + esc(f.properties.name) + '</title></path>';
    }
    var net = otoyolPath(box);
    if (net) html += '<path class="nk-otoyol" vector-effect="non-scaling-stroke" d="' + net + '"></path>';
    var fromPt = state.from ? project(state.from.lon, state.from.lat, box) : null;
    var toPt = state.to ? project(state.to.lon, state.to.lat, box) : null;
    if (fromPt && toPt) {
      var fromName = state.from.tesis || state.from.ilce || state.from.il;
      var toName = state.to.liman ? state.to.ad : (state.to.ilce ? (state.to.il + ' / ' + state.to.ilce) : state.to.il);
      var road = roadPath(box);
      var yollar = state.yollar || [];
      for (var y = 0; y < yollar.length; y++) {
        if (y === state.yolIndex) continue;
        var alt = linePath(yollar[y] && yollar[y].cizgi, box);
        if (alt) html += '<path class="nk-route-alt" vector-effect="non-scaling-stroke" d="' + alt + '"></path>';
      }
      if (road) {
        var kus = state.route && state.route.kaynak === 'kus-ucusu';
        if (kus) {
          html += '<path class="nk-route-air" vector-effect="non-scaling-stroke" d="' + road + '"></path>';
        } else {
          html += '<path class="nk-route-case" vector-effect="non-scaling-stroke" d="' + road + '"></path>';
          html += '<path class="nk-route" vector-effect="non-scaling-stroke" marker-end="url(#nkRoadArrow)" d="' + road + '"></path>';
          html += '<path class="nk-route-dash" vector-effect="non-scaling-stroke" d="' + road + '"></path>';
          var tollParts = state.ucret || [];
          for (var t = 0; t < tollParts.length; t++) {
            var toll = linePath(tollParts[t].cizgi, box);
            if (toll) html += '<path class="nk-route-toll" vector-effect="non-scaling-stroke" d="' + toll + '"></path>';
          }
        }
        var ucretAd = ucretAdlari();
        var net = netUcret4();
        document.getElementById('nkMapHint').textContent = 'Buradan ' + fromName + ' → buraya ' + toName + ' · ' + (kus ? 'kuş uçuşu' : 'karayolu') + (ucretAd.length ? ' · paralı ' + ucretAd.join(', ') + (net ? ' · net ' + fmt(net, 0) + ' TL' : '') : '') + (state.pickFrom ? ' · haritadan çıkış açık' : '');
      } else {
        document.getElementById('nkMapHint').textContent = 'Karayolu çiziliyor: ' + fromName + ' → ' + toName;
      }
      html += '<text class="nk-pin-label" x="' + (fromPt[0] + 10).toFixed(1) + '" y="' + (fromPt[1] - 8).toFixed(1) + '">Buradan · ' + esc(fromName) + '</text>';
      html += '<text class="nk-pin-label" x="' + (toPt[0] + 10).toFixed(1) + '" y="' + (toPt[1] - 8).toFixed(1) + '">Buraya · ' + esc(toName) + '</text>';
    } else if (fromPt) {
      document.getElementById('nkMapHint').textContent = state.pickFrom
        ? 'Çıkış seçimi açık. Başka ile veya limana basın, çıkış değişir.'
        : 'Çıkış hazır. Limana veya varış iline basın.';
    } else {
      document.getElementById('nkMapHint').textContent = state.pickFrom
        ? 'Çıkış seçimi açık. Haritadan bir ile veya limana basın.'
        : 'Limanlar haritada. Bir limana basınca varış orası olur.';
    }
    if (fromPt) html += '<circle class="nk-end is-from" cx="' + fromPt[0].toFixed(1) + '" cy="' + fromPt[1].toFixed(1) + '" r="4"></circle>';
    if (toPt) html += '<circle class="nk-end is-to" cx="' + toPt[0].toFixed(1) + '" cy="' + toPt[1].toFixed(1) + '" r="4"></circle>';
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
    return node;
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
    drawSeas(g);
    drawMapMarks(g);
    drawDollars(g);
    var ends = svg.querySelectorAll('.nk-end');
    var endR = userPx(4.5);
    for (var e = 0; e < ends.length; e++) ends[e].setAttribute('r', endR.toFixed(2));
    svg.appendChild(g);
  }

  function svgNode(name) {
    return document.createElementNS('http://www.w3.org/2000/svg', name);
  }

  function drawSeas(g) {
    for (var i = 0; i < DENIZLER.length; i++) {
      var sea = DENIZLER[i];
      if (ilAdiAt(sea.lon, sea.lat)) continue;
      var xy = project(sea.lon, sea.lat, TURKEY);
      if (!seenOnMap(xy[0], xy[1])) continue;
      var size = userPx(sea.px);
      var node = addMapText(g, 'nk-sea-name', xy[0], xy[1], size, sea.ad);
      if (node) node.setAttribute('letter-spacing', (size * 0.1).toFixed(2));
    }
  }

  function drawDollars(g) {
    var u = userPx(1);
    var used = [];
    function near(x, y) {
      for (var i = 0; i < used.length; i++) {
        if (Math.hypot(used[i][0] - x, used[i][1] - y) < 16 * u) return true;
      }
      return false;
    }
    function badge(x, y) {
      if (!seenOnMap(x, y) || near(x, y)) return;
      used.push([x, y]);
      var mark = svgNode('g');
      mark.setAttribute('class', 'nk-dollar');
      var r = 7.2 * u;
      var c = svgNode('circle');
      c.setAttribute('class', 'nk-dollar-badge');
      c.setAttribute('cx', x.toFixed(1));
      c.setAttribute('cy', y.toFixed(1));
      c.setAttribute('r', r.toFixed(2));
      c.setAttribute('stroke-width', (u * 1.1).toFixed(2));
      mark.appendChild(c);
      addMapText(mark, 'nk-dollar-text', x, y, userPx(11), '$');
      g.appendChild(mark);
    }
    var durum = kopruDurumu();
    for (var b = 0; b < durum.acik.length; b++) {
      var bp = project(durum.acik[b].lon, durum.acik[b].lat, TURKEY);
      badge(bp[0], bp[1] - 8 * u);
    }
    var parts = state.ucret || [];
    for (var p = 0; p < parts.length; p++) {
      var line = parts[p].cizgi || [];
      if (line.length < 2) continue;
      var step = Math.max(1, Math.floor(line.length / Math.max(1, Math.round(parts[p].km / 45))));
      for (var i = Math.floor(step / 2); i < line.length; i += step) {
        var xy = project(line[i][0], line[i][1], TURKEY);
        badge(xy[0], xy[1]);
      }
    }
  }

  function drawMapMarks(g) {
    var u = userPx(1);
    var ports = limanlar();
    var used = [];
    for (var i = 0; i < ports.length; i++) {
      var xy = project(ports[i].lon, ports[i].lat, TURKEY);
      if (!seenOnMap(xy[0], xy[1])) continue;
      var dy = 0;
      for (var guard = 0; guard < 5; guard++) {
        var hit = false;
        for (var k = 0; k < used.length; k++) {
          if (Math.abs(used[k][0] - xy[0]) < u * 78 && Math.abs(used[k][1] - (xy[1] + dy)) < u * 12) {
            dy += u * 12;
            hit = true;
            break;
          }
        }
        if (!hit) break;
      }
      used.push([xy[0], xy[1] + dy]);
      var on = state.to && state.to.limanId === ports[i].id;
      var pin = svgNode('g');
      pin.setAttribute('class', 'nk-port' + (on ? ' is-to' : ''));
      pin.setAttribute('data-liman', ports[i].id);
      var r = 3.6 * u;
      var cy = xy[1] - 7 * u;
      var d = 'M' + xy[0].toFixed(1) + ',' + xy[1].toFixed(1)
        + 'C' + (xy[0] - 1.3 * u).toFixed(1) + ',' + (xy[1] - 3.2 * u).toFixed(1)
        + ' ' + (xy[0] - r).toFixed(1) + ',' + (xy[1] - 3.8 * u).toFixed(1)
        + ' ' + (xy[0] - r).toFixed(1) + ',' + cy.toFixed(1)
        + 'A' + r.toFixed(2) + ',' + r.toFixed(2) + ' 0 1 1 ' + (xy[0] + r).toFixed(1) + ',' + cy.toFixed(1)
        + 'C' + (xy[0] + r).toFixed(1) + ',' + (xy[1] - 3.8 * u).toFixed(1)
        + ' ' + (xy[0] + 1.3 * u).toFixed(1) + ',' + (xy[1] - 3.2 * u).toFixed(1)
        + ' ' + xy[0].toFixed(1) + ',' + xy[1].toFixed(1) + 'Z';
      var path = svgNode('path');
      path.setAttribute('class', 'nk-port-mark');
      path.setAttribute('d', d);
      path.setAttribute('stroke-width', (u * 0.8).toFixed(2));
      pin.appendChild(path);
      var hole = svgNode('circle');
      hole.setAttribute('class', 'nk-port-hole');
      hole.setAttribute('cx', xy[0].toFixed(1));
      hole.setAttribute('cy', cy.toFixed(1));
      hole.setAttribute('r', (1.3 * u).toFixed(2));
      pin.appendChild(hole);
      addMapText(pin, 'nk-port-name', xy[0] + 6 * u, xy[1] - 7 * u + dy, userPx(11), ports[i].ad);
      g.appendChild(pin);
    }
    var api = window.NK_LIMAN;
    if (!api || !api.kopruler) return;
    var durum = kopruDurumu();
    for (var b = 0; b < api.kopruler.length; b++) {
      var bridge = api.kopruler[b];
      var bp = project(bridge.lon, bridge.lat, TURKEY);
      if (!seenOnMap(bp[0], bp[1])) continue;
      var banned = false;
      for (var c = 0; c < durum.kapali.length; c++) if (durum.kapali[c].id === bridge.id) banned = true;
      var s = 2.2 * u;
      var diamond = svgNode('path');
      diamond.setAttribute('class', 'nk-bridge-mark' + (bridge.tir ? '' : ' is-ban'));
      diamond.setAttribute('d', 'M' + bp[0].toFixed(1) + ',' + (bp[1] - s).toFixed(1)
        + 'L' + (bp[0] + s).toFixed(1) + ',' + bp[1].toFixed(1)
        + 'L' + bp[0].toFixed(1) + ',' + (bp[1] + s).toFixed(1)
        + 'L' + (bp[0] - s).toFixed(1) + ',' + bp[1].toFixed(1) + 'Z');
      diamond.setAttribute('stroke-width', (u * 0.6).toFixed(2));
      g.appendChild(diamond);
      addMapText(g, 'nk-bridge-name' + (bridge.tir ? '' : ' is-ban'), bp[0] + 4 * u, bp[1], userPx(10), (bridge.kisa || bridge.ad) + (banned ? ' kapalı' : ''));
    }
  }

  function renderResults() {
    var sonuc = fuel();
    var hasEnds = !!(state.from && state.to);
    document.getElementById('nkKm').textContent = hasEnds && state.route ? fmt(sonuc.mesafe, 1) + ' km' : '—';
    var sure = document.getElementById('nkSure');
    var plan = truckPlan();
    if (!state.route) sure.textContent = hasEnds ? (state.routeError || 'Mesafe hesaplanıyor') : 'İki nokta seçin';
    else if (state.route.kaynak === 'ayni') sure.textContent = 'Çıkış ve varış aynı yer';
    else {
      var onEk = state.route.kaynak === 'kus-ucusu' ? 'Kuş uçuşu, yol payı %30 · ' : '';
      sure.textContent = onEk + 'Sürüş ' + formatDk(plan ? plan.surusDk : 0) + ' · 4 saatte 240–280 km' + (state.donus ? ' · gidiş-dönüş' : '');
    }
    document.getElementById('nkMazot').textContent = (function () {
      var litreFiyat = sonuc.fiyat;
      if (litreFiyat == null && state.from) {
        var fromIl = ilMazot(state.from.plaka);
        if (fromIl) litreFiyat = fromIl.mazot;
      }
      if (litreFiyat == null) {
        var kutahya = ilMazot(43);
        if (kutahya) litreFiyat = kutahya.mazot;
      }
      return litreFiyat == null ? '—' : fmt(litreFiyat, 2) + ' TL/L';
    })();
    document.getElementById('nkLitreOut').textContent = hasEnds && state.route ? fmt(sonuc.litre, 1) + ' L' : '—';
    document.getElementById('nkTutar').textContent = hasEnds && state.route && sonuc.tutar != null ? fmt(sonuc.tutar, 2) + ' TL' : '—';
    var formula = document.getElementById('nkFormula');
    if (formula) {
      formula.textContent = (hasEnds && state.route && sonuc.tutar != null && mazotEski())
        ? ('Son doğrulanmış fiyat · ' + (mazotWhen() || 'kayıt tarihi yok') + ' · güncel değil')
        : 'km × litre / 100';
    }
    var litreNot = fmt(state.litrePer100, 1) + ' L/100 km';
    if (state.litrePer100 > 0) litreNot += ' · 1 L ≈ ' + fmt(100 / state.litrePer100, 1) + ' km';
    var note = (PRESET_AD[state.preset] || 'Tüketim') + ' · ' + litreNot;
    if (state.preset === 'elle') note = litreNot;
    document.getElementById('nkTuketimNote').textContent = note;
    renderSaat();
    renderGecilen();
    renderDolum();
    renderDun(sonuc);
    renderKopru(sonuc);
  }

  function renderKopru(sonuc) {
    var host = document.getElementById('nkKopru');
    if (!host) return;
    var durum = kopruDurumu();
    var ucretAd = ucretAdlari();
    if (!state.route || state.route.kaynak === 'kus-ucusu' || (!durum.acik.length && !durum.kapali.length && !ucretAd.length)) {
      host.innerHTML = '';
      return;
    }
    var carpan = state.donus ? 2 : 1;
    var toplam4 = 0;
    var toplam5 = 0;
    var cards = '';
    for (var i = 0; i < durum.acik.length; i++) {
      var bridge = durum.acik[i];
      toplam4 += bridge.sinif4 * carpan;
      toplam5 += bridge.sinif5 * carpan;
      cards += '<div><span>' + esc(bridge.ad) + '</span><b>' + fmt(bridge.sinif4 * carpan, 0) + ' TL</b><small>4-5 dingil · 6+ dingil ' + fmt(bridge.sinif5 * carpan, 0) + ' TL</small></div>';
    }
    var yssVar = false;
    for (var j = 0; j < durum.acik.length; j++) if (durum.acik[j].id === 'yss') yssVar = true;
    var note = '';
    if (durum.kapali.length) {
      var names = durum.kapali.map(function (row) { return row.ad; }).join(', ');
      var yss = null;
      var list = (window.NK_LIMAN && window.NK_LIMAN.kopruler) || [];
      for (var k = 0; k < list.length; k++) if (list[k].id === 'yss') yss = list[k];
      note = esc(names) + ' çizgide. Tır bu köprüden geçmez.';
      if (yss && !yssVar) {
        toplam4 += yss.sinif4 * carpan;
        toplam5 += yss.sinif5 * carpan;
        cards += '<div><span>Yavuz Sultan Selim</span><b>' + fmt(yss.sinif4 * carpan, 0) + ' TL</b><small>Tır geçişi · 6+ dingil ' + fmt(yss.sinif5 * carpan, 0) + ' TL</small></div>';
      }
    }
    if (toplam4) {
      cards += '<div><span>Köprü toplamı</span><b>' + fmt(toplam4, 0) + ' TL</b></div>';
    }
    var yol4 = 0;
    var yol5 = 0;
    var yolSatir = [];
    var parcalar = state.ucret || [];
    for (var u = 0; u < parcalar.length; u++) {
      var parca = parcalar[u];
      var bedel = window.NK_LIMAN && window.NK_LIMAN.otoyolBedel
        ? window.NK_LIMAN.otoyolBedel(parca.ad, parca.km)
        : null;
      if (!bedel) {
        yolSatir.push(parca.ad);
        continue;
      }
      yol4 += bedel.sinif4 * carpan;
      yol5 += bedel.sinif5 * carpan;
      yolSatir.push(parca.ad + ' · ' + parca.km + ' km');
    }
    if (yol4) {
      cards += '<div><span>Net ücret</span><b>' + fmt(yol4, 0) + ' TL</b><small>'
        + esc(yolSatir.join(' · ')) + ' · 4-5 dingil · 6+ dingil ' + fmt(yol5, 0) + ' TL</small></div>';
    } else if (ucretAd.length) {
      cards += '<div><span>Paralı otoyol</span><b>' + esc(ucretAd.join(' · ')) + '</b></div>';
    }
    var gecis = toplam4 + yol4;
    if (gecis && sonuc && sonuc.tutar != null) {
      cards += '<div><span>Mazot ile birlikte</span><b>' + fmt(round2(sonuc.tutar + gecis), 2) + ' TL</b></div>';
    }
    if (!cards && !note) { host.innerHTML = ''; return; }
    var dipnot = (toplam4 || yol4)
      ? ((note ? note + ' ' : '') + '1 Temmuz 2026 KGM tarifesi, KDV dahil. Net ücret güzergâhtaki paralı kesimin gişe tutarı.' + (state.donus ? ' Gidiş-dönüş iki geçiş.' : ''))
      : 'Yeşil $ paralı otoyol ve tırın geçtiği köprüyü gösterir.';
    host.innerHTML = '<div class="nk-kopru-card">' + cards
      + '<p class="nk-kopru-note">' + dipnot + '</p></div>';
  }

  function renderYollar() {
    var host = document.getElementById('nkYollar');
    if (!host) return;
    var list = state.yollar || [];
    if (!state.from || !state.to || !list.length) { host.innerHTML = ''; return; }
    var shortest = 0;
    for (var k = 1; k < list.length; k++) {
      if ((list[k].km || 1e9) < (list[shortest].km || 1e9)) shortest = k;
    }
    host.innerHTML = list.map(function (row, i) {
      var ad = 'Tek güzergâh';
      if (list.length > 1) ad = i === shortest ? 'En kısa' : 'Alternatif';
      var yol = tirYolPlani(row.km);
      var sure = yol.surusDk ? formatDk(yol.surusDk) + ' sürüş' : '';
      return '<button type="button" class="nk-yol' + (i === state.yolIndex ? ' is-on' : '') + '" data-yol="' + i + '">'
        + esc(ad) + ' · ' + fmt(row.km, 1) + ' km' + (sure ? ' · ' + esc(sure) : '') + '</button>';
    }).join('');
  }

  function saatEtiket(start, dk) {
    var end = new Date(start.getTime() + Math.round(dk) * 60000);
    var hh = String(end.getHours()).padStart(2, '0');
    var mm = String(end.getMinutes()).padStart(2, '0');
    var gun = Math.round((new Date(end.getFullYear(), end.getMonth(), end.getDate()) - new Date(start.getFullYear(), start.getMonth(), start.getDate())) / 86400000);
    var extra = gun === 1 ? 'ertesi gün ' : (gun > 1 ? gun + ' gün sonra ' : '');
    return extra + hh + ':' + mm;
  }

  function renderSaat() {
    var host = document.getElementById('nkVarisSaat');
    if (!host) return;
    var input = document.getElementById('nkCikisSaat');
    var saat = (input && input.value) || '08:00';
    var plan = truckPlan();
    if (!state.from || !state.to || !plan) {
      host.textContent = 'Varış, 60–70 km/sa ve günde 9 saat sürüşe göre hesaplanır.';
      return;
    }
    var bits = String(saat).split(':');
    var start = new Date();
    start.setSeconds(0, 0);
    start.setHours(Number(bits[0]) || 0, Number(bits[1]) || 0, 0, 0);
    var line = saat + ' çıkış → ' + saatEtiket(start, plan.varisDk) + ' varış';
    line += ' · sürüş ' + formatDk(plan.surusDk) + ' (65 km/sa)';
    line += ' · 70 km/sa ' + saatEtiket(start, plan.varisHizliDk);
    line += ' · 60 km/sa ' + saatEtiket(start, plan.varisYavasDk);
    if (plan.varisDk > plan.surusDk) line += ' · 9 saati aşan sürüş 15 saat dinlenir';
    if (state.donus) line += ' · gidiş-dönüş';
    host.textContent = line;
  }

  function ringHas(ring, lon, lat) {
    var inside = false;
    for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      var yi = ring[i][1];
      var yj = ring[j][1];
      var xi = ring[i][0];
      var xj = ring[j][0];
      if (((yi > lat) !== (yj > lat)) && (lon < (xj - xi) * (lat - yi) / ((yj - yi) || 1e-12) + xi)) inside = !inside;
    }
    return inside;
  }

  function ilAdiAt(lon, lat) {
    var features = (state.geo && state.geo.features) || [];
    for (var i = 0; i < features.length; i++) {
      var geometry = features[i].geometry;
      if (!geometry) continue;
      var polys = geometry.type === 'Polygon' ? [geometry.coordinates] : (geometry.type === 'MultiPolygon' ? geometry.coordinates : []);
      for (var p = 0; p < polys.length; p++) {
        if (polys[p][0] && ringHas(polys[p][0], lon, lat)) return features[i].properties.name || '';
      }
    }
    return '';
  }

  function renderGecilen() {
    var host = document.getElementById('nkGecilen');
    if (!host) return;
    var cizgi = state.route && state.route.cizgi;
    if (!state.from || !state.to || !cizgi || cizgi.length < 2) { host.innerHTML = ''; return; }
    var runs = [];
    for (var i = 0; i < cizgi.length; i++) {
      var name = ilAdiAt(cizgi[i][0], cizgi[i][1]);
      if (!name) continue;
      if (!runs.length || runs[runs.length - 1].name !== name) runs.push({ name: name, n: 1 });
      else runs[runs.length - 1].n += 1;
    }
    var r = 0;
    while (r < runs.length) {
      if (r > 0 && r < runs.length - 1 && runs[r].n < 8 && runs[r - 1].name === runs[r + 1].name) {
        runs[r - 1].n += runs[r].n + runs[r + 1].n;
        runs.splice(r, 2);
        r = Math.max(0, r - 1);
        continue;
      }
      r++;
    }
    var names = runs.map(function (row) { return row.name; });
    var last = ilAdiAt(cizgi[cizgi.length - 1][0], cizgi[cizgi.length - 1][1]);
    if (last && names[names.length - 1] !== last) names.push(last);
    if (!names.length) { host.innerHTML = ''; return; }
    host.innerHTML = '<div class="nk-ozet-kicker">Geçilen iller</div><div class="nk-iller">'
      + names.map(function (name, i) {
        return (i ? '<span class="nk-il-arrow">→</span>' : '') + '<span class="nk-il-chip">' + esc(name) + '</span>';
      }).join('')
      + '</div>';
  }

  function renderDolum() {
    var host = document.getElementById('nkDolum');
    if (!host) return;
    if (!state.from || !state.to || !state.mazot) { host.textContent = ''; return; }
    var cikis = fiyatOf(state.from);
    var varis = fiyatOf(state.to);
    if (cikis == null || varis == null) { host.textContent = ''; return; }
    var cAd = state.from.il;
    var vAd = state.to.ilce ? (state.to.il + ' / ' + state.to.ilce) : state.to.il;
    var line = cAd + ' ' + fmt(cikis, 2) + ' TL/L · ' + vAd + ' ' + fmt(varis, 2) + ' TL/L. ';
    if (mazotEski()) line = 'Son doğrulanmış fiyat, güncel değil. ' + line;
    if (Math.abs(cikis - varis) < 0.05) line += 'Fiyat aynı, çıkışta dolum yeterli.';
    else if (cikis < varis) line += 'Çıkış daha ucuz. Dolumu ' + cAd + ' ilinde yapın.';
    else line += 'Varış daha ucuz. Dolumu ' + state.to.il + ' ilinde yapın.';
    host.textContent = line;
  }

  function renderDun(sonuc) {
    var host = document.getElementById('nkDunFark');
    if (!host) return;
    if (!state.from || !state.to || !state.route || sonuc.tutar == null || !sonuc.litre) {
      host.textContent = '';
      return;
    }
    var onceki = state.mazot && state.mazot.onceki && state.mazot.onceki.iller;
    var dunIl = null;
    if (onceki) {
      for (var i = 0; i < onceki.length; i++) if (onceki[i].plaka === state.from.plaka) dunIl = onceki[i];
    }
    if (mazotEski()) {
      host.textContent = 'Tutar son doğrulanmış fiyatla hesaplandı'
        + (mazotWhen() ? ' (' + mazotWhen() + ')' : '')
        + '. Bu güncel pompa fiyatı değildir.';
      return;
    }
    if (!dunIl || sonuc.fiyat == null) {
      host.textContent = 'Dünkü mazot fiyatı henüz kayıtlı değil. Yarın aynı seferin farkı burada görünür.';
      return;
    }
    var dunTutar = round2(sonuc.litre * dunIl.mazot);
    var fark = round2(sonuc.tutar - dunTutar);
    var isaret = fark > 0 ? '+' : '';
    host.textContent = 'Bugün ' + fmt(sonuc.tutar, 2) + ' TL · dün ' + fmt(dunTutar, 2) + ' TL · fark ' + isaret + fmt(fark, 2) + ' TL (' + fmt(sonuc.fiyat, 2) + ' / ' + fmt(dunIl.mazot, 2) + ' TL/L)';
  }

  function renderPrices() {
    var lead = document.getElementById('nkPriceLead');
    var grid = document.getElementById('nkPriceGrid');
    mazotBaslikYaz();
    if (!state.mazot || !state.mazot.iller) {
      lead.textContent = state.mazotError || 'Doğrulanmış mazot fiyatı bulunamadı. Arama ve mesafe çalışmaya devam eder.';
      grid.innerHTML = '';
      return;
    }
    lead.textContent = mazotKaynakMetni() + '. Hesap çıkış ilçesinin fiyatıyla yapılır.';
    var iller = state.mazot.iller.slice().sort(function (a, b) { return a.ad.localeCompare(b.ad, 'tr'); });
    grid.innerHTML = iller.map(function (il) {
      var cls = 'nk-price';
      if (state.from && state.from.plaka === il.plaka) cls += ' is-from';
      if (state.to && state.to.plaka === il.plaka) cls += ' is-to';
      return '<button type="button" class="' + cls + '" data-price-plaka="' + il.plaka + '"><b>' + esc(il.ad) + '</b><span>' + fmt(il.mazot, 2) + ' TL</span></button>';
    }).join('');
  }

  function render() {
    syncUcret();
    renderOrigin();
    renderLimanlar();
    renderIlceler();
    renderYollar();
    renderMap();
    renderResults();
    renderPrices();
    fillPrice();
  }

  function applyRoutes(data) {
    var yollar = (data && data.yollar && data.yollar.length) ? data.yollar : [];
    if (!yollar.length && data && data.cizgi) {
      yollar = [{ km: data.km, sureDk: data.sureDk, cizgi: data.cizgi, kaynak: data.kaynak }];
    }
    state.yollar = yollar;
    state.yolIndex = 0;
    state.route = yollar[0] || null;
    state.routeError = state.route ? '' : 'Yol hesaplanamadı';
  }

  function round4(n) { return Math.round(Number(n) * 10000) / 10000; }

  function havelineKm(a, b) {
    var lat1 = Number(a && a.lat);
    var lon1 = Number(a && a.lon);
    var lat2 = Number(b && b.lat);
    var lon2 = Number(b && b.lon);
    if (![lat1, lon1, lat2, lon2].every(isFinite)) return null;
    var R = 6371;
    var dLat = (lat2 - lat1) * Math.PI / 180;
    var dLon = (lon2 - lon1) * Math.PI / 180;
    var s1 = Math.sin(dLat / 2) * Math.sin(dLat / 2)
      + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(s1)));
  }

  function downsampleCoords(coords, max) {
    var list = (coords || []).filter(function (pt) {
      return pt && isFinite(Number(pt[0])) && isFinite(Number(pt[1]));
    });
    if (list.length <= max) return list.map(function (pt) { return [round4(pt[0]), round4(pt[1])]; });
    var out = [];
    var step = (list.length - 1) / (max - 1);
    for (var i = 0; i < max; i++) {
      var pt = list[Math.round(i * step)];
      out.push([round4(pt[0]), round4(pt[1])]);
    }
    return out;
  }

  function yollarFromOsrm(body) {
    var routes = (body && body.routes) || [];
    var out = [];
    for (var i = 0; i < routes.length && out.length < 3; i++) {
      var route = routes[i];
      if (!route || !isFinite(Number(route.distance))) continue;
      var coords = route.geometry && route.geometry.coordinates;
      out.push({
        km: round1(Number(route.distance) / 1000),
        sureDk: Math.max(0, Math.round(Number(route.duration || 0) / 60)),
        cizgi: downsampleCoords(coords, 180),
        kaynak: 'karayolu',
      });
    }
    return out;
  }

  function kusUcusuRota(from, to) {
    var straight = havelineKm(from, to);
    if (straight == null) return null;
    return {
      km: round1(straight * 1.3),
      sureDk: null,
      cizgi: [[Number(from.lon), Number(from.lat)], [Number(to.lon), Number(to.lat)]],
      kaynak: 'kus-ucusu',
    };
  }

  function paintRoute() {
    try { render(); }
    catch (e) { renderResults(); renderYollar(); }
  }

  function useFallbackRoute(ctl) {
    var url = 'https://router.project-osrm.org/route/v1/driving/'
      + Number(state.from.lon).toFixed(5) + ',' + Number(state.from.lat).toFixed(5) + ';'
      + Number(state.to.lon).toFixed(5) + ',' + Number(state.to.lat).toFixed(5)
      + '?overview=simplified&geometries=geojson&alternatives=true';
    return fetch(url, { signal: ctl.signal, headers: { Accept: 'application/json' } })
      .then(function (res) { if (!res.ok) throw new Error('osrm'); return res.json(); })
      .then(function (body) {
        if (ctl.signal.aborted) return;
        var yollar = yollarFromOsrm(body);
        if (!yollar.length) throw new Error('osrm');
        state.yollar = yollar;
        state.yolIndex = 0;
        state.route = yollar[0];
        state.routeError = '';
        paintRoute();
      })
      .catch(function (err) {
        if ((err && err.name === 'AbortError') || ctl.signal.aborted) return;
        var rota = kusUcusuRota(state.from, state.to);
        if (!rota) {
          state.route = null;
          state.yollar = [];
          state.routeError = 'Yol hesaplanamadı';
          renderResults();
          renderYollar();
          return;
        }
        state.yollar = [rota];
        state.yolIndex = 0;
        state.route = rota;
        state.routeError = '';
        paintRoute();
      });
  }

  function scheduleRoute() {
    if (routeCtl) routeCtl.abort();
    if (!state.from || !state.to) {
      state.route = null;
      state.yollar = [];
      state.yolIndex = 0;
      state.routeError = '';
      renderResults();
      renderYollar();
      return;
    }
    var straight = Math.abs(state.from.lat - state.to.lat) + Math.abs(state.from.lon - state.to.lon);
    if (straight < 0.02 && foldTr(state.from.ilce || state.from.il) === foldTr(state.to.ilce || state.to.il)) {
      state.route = { km: 0, sureDk: 0, cizgi: [], kaynak: 'ayni' };
      state.yollar = [state.route];
      state.yolIndex = 0;
      state.routeError = '';
      render();
      return;
    }
    routeCtl = new AbortController();
    var ctl = routeCtl;
    var settled = false;
    state.route = null;
    state.yollar = [];
    state.routeError = '';
    renderResults();
    var timer = setTimeout(function () {
      if (settled || ctl.signal.aborted) return;
      settled = true;
      useFallbackRoute(ctl);
    }, 8000);
    var q = 'olon=' + encodeURIComponent(state.from.lon) + '&olat=' + encodeURIComponent(state.from.lat)
      + '&dlon=' + encodeURIComponent(state.to.lon) + '&dlat=' + encodeURIComponent(state.to.lat);
    apiFetch('/api/nakliye/mesafe?' + q, { signal: ctl.signal })
      .then(function (res) { if (!res.ok) throw new Error('mesafe'); return res.json(); })
      .then(function (data) {
        if (settled || ctl.signal.aborted) return;
        applyRoutes(data);
        if (!state.route || !isFinite(Number(state.route.km))) throw new Error('bos');
        settled = true;
        clearTimeout(timer);
        paintRoute();
      })
      .catch(function (err) {
        if (err && err.name === 'AbortError') return;
        if (settled || ctl.signal.aborted) return;
        settled = true;
        clearTimeout(timer);
        useFallbackRoute(ctl);
      });
  }

  var mazotSeq = 0;

  function apiFetch(url, extra) {
    var opts = Object.assign({ credentials: 'same-origin', cache: 'no-store' }, extra || {});
    if (window.SessionManager && typeof window.SessionManager.fetchWithSession === 'function') {
      return window.SessionManager.fetchWithSession(url, opts);
    }
    return fetch(url, opts);
  }

  function mazotPayloadOk(data) {
    return !!(data && data.ok !== false && data.iller && data.iller.length);
  }

  function readMazotResponse(res) {
    return res.json().catch(function () { return {}; }).then(function (data) {
      if (!res.ok || !mazotPayloadOk(data)) {
        var err = new Error((data && data.error) || (res.status === 401 ? 'Oturum mazot fiyatını alamadı.' : 'Mazot fiyatı alınamadı.'));
        err.status = res.status;
        throw err;
      }
      return data;
    });
  }

  function loadMazotFile() {
    return fetch('data/mazot-guncel.json?v=20261008-mazot3', { cache: 'no-store' }).then(function (res) {
      if (!res.ok) throw new Error('Kayıtlı mazot listesi yok.');
      return res.json();
    }).then(function (data) {
      if (!mazotPayloadOk(data)) throw new Error('Kayıtlı mazot listesi boş.');
      data.dosya = true;
      data.guncel = false;
      data.bayat = true;
      return data;
    });
  }

  function showMazot(seq, data) {
    if (seq !== mazotSeq || !mazotPayloadOk(data)) return false;
    state.mazot = data;
    state.mazotError = '';
    fillPrice();
    try { render(); } catch (e) { renderPrices(); fillPrice(); }
    return true;
  }

  function loadMazot(force) {
    var seq = ++mazotSeq;
    var apiShown = false;
    state.mazotError = '';
    var lead = document.getElementById('nkPriceLead');
    if (lead) lead.textContent = 'Mazot fiyatı kontrol ediliyor…';
    fillPrice();
    if (!force) {
      loadMazotFile().then(function (data) {
        if (apiShown || seq !== mazotSeq) return;
        showMazot(seq, data);
      }).catch(function () {});
    }
    var url = '/api/nakliye/mazot' + (force ? '?yenile=1' : '');
    var timed = new Promise(function (resolve, reject) {
      var timer = setTimeout(function () { reject(new Error('Mazot isteği zaman aşımına uğradı.')); }, 8000);
      apiFetch(url).then(function (res) {
        clearTimeout(timer);
        resolve(res);
      }, function (err) {
        clearTimeout(timer);
        reject(err);
      });
    });
    return timed.then(readMazotResponse).then(function (data) {
      apiShown = true;
      showMazot(seq, data);
    }).catch(function (err) {
      if (seq !== mazotSeq) return;
      if (state.mazot && state.mazot.iller && state.mazot.iller.length) return;
      return loadMazotFile().then(function (data) {
        if (!showMazot(seq, data)) throw err;
      }).catch(function () {
        if (seq !== mazotSeq) return;
        state.mazot = null;
        state.mazotError = (err && err.message) || 'Doğrulanmış mazot fiyatı bulunamadı.';
        fillPrice();
        renderPrices();
      });
    });
  }

  function searchHits(q) {
    var f = foldTr(q);
    if (f.length < 2 || !state.places) return [];
    var hits = [];
    var ports = limanlar();
    for (var p = 0; p < ports.length; p++) {
      var blob = foldTr(ports[p].ad + ' ' + ports[p].il + ' ' + ports[p].ilce + ' ' + (ports[p].ara || ''));
      if (blob.indexOf(f) >= 0) hits.push({ kind: 'liman', id: ports[p].id, ad: ports[p].ad, il: ports[p].il });
    }
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

  function fillSuggest(box, hits) {
    if (!box) return;
    if (!hits.length) { box.hidden = true; box.innerHTML = ''; box._hits = []; return; }
    box.hidden = false;
    box.innerHTML = hits.map(function (hit, idx) {
      var text = hit.kind === 'il' ? hit.ad : (hit.kind === 'liman' ? (hit.ad + ' · ' + hit.il) : (hit.il + ' / ' + hit.ad));
      return '<button type="button" data-idx="' + idx + '">' + esc(text) + '</button>';
    }).join('');
    box._hits = hits;
  }

  function showSuggest(hits) {
    fillSuggest(document.getElementById('nkSuggest'), hits);
  }

  function applySearchHit(hit, asFrom) {
    if (!hit) return;
    if (asFrom) {
      if (hit.kind === 'il') selectFromIl(hit.plaka);
      else if (hit.kind === 'liman') selectFromLiman(hit.id);
      else selectFromIlce(hit);
      return;
    }
    if (hit.kind === 'il') selectIl(hit.plaka, false);
    else if (hit.kind === 'liman') selectLiman(hit.id);
    else selectIlce(hit, true);
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
    document.getElementById('nkPickFrom').addEventListener('click', function () {
      state.pickFrom = !state.pickFrom;
      if (state.pickFrom && state.from && !state.from.id) state.fromFocus = state.from.plaka;
      render();
    });
    document.getElementById('nkFromIlce').addEventListener('click', function (ev) {
      var btn = ev.target.closest ? ev.target.closest('[data-from-ilce]') : null;
      if (!btn) return;
      var plaka = Number(btn.getAttribute('data-plaka'));
      var ad = btn.getAttribute('data-from-ilce');
      var rows = ilcelerOf(plaka);
      for (var i = 0; i < rows.length; i++) if (rows[i].ad === ad) selectFromIlce(rows[i]);
    });
    var fromSearch = document.getElementById('nkFromSearch');
    fromSearch.addEventListener('input', function () { fillSuggest(document.getElementById('nkFromSuggest'), searchHits(fromSearch.value)); });
    document.getElementById('nkFromSuggest').addEventListener('click', function (ev) {
      var btn = ev.target.closest ? ev.target.closest('[data-idx]') : null;
      if (!btn) return;
      var hit = document.getElementById('nkFromSuggest')._hits[Number(btn.getAttribute('data-idx'))];
      document.getElementById('nkFromSuggest').hidden = true;
      fromSearch.value = '';
      applySearchHit(hit, true);
    });
    document.getElementById('nkMap').addEventListener('click', function (ev) {
      if (mapSkipClick) { mapSkipClick = false; return; }
      var port = ev.target.closest ? ev.target.closest('[data-liman]') : null;
      if (port) {
        if (state.pickFrom) selectFromLiman(port.getAttribute('data-liman'));
        else selectLiman(port.getAttribute('data-liman'));
        return;
      }
      var path = ev.target.closest ? ev.target.closest('[data-plaka]') : null;
      if (!path) return;
      if (state.pickFrom) selectFromIl(Number(path.getAttribute('data-plaka')));
      else selectIl(Number(path.getAttribute('data-plaka')), false);
    });
    document.getElementById('nkLimanlar').addEventListener('click', function (ev) {
      var btn = ev.target.closest ? ev.target.closest('[data-liman]') : null;
      if (!btn) return;
      selectLiman(btn.getAttribute('data-liman'));
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
      applySearchHit(hit, false);
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
    document.getElementById('nkCikisSaat').addEventListener('input', function () {
      renderSaat();
    });
    document.getElementById('nkYollar').addEventListener('click', function (ev) {
      var btn = ev.target.closest ? ev.target.closest('[data-yol]') : null;
      if (!btn) return;
      var idx = Number(btn.getAttribute('data-yol'));
      if (!state.yollar[idx]) return;
      state.yolIndex = idx;
      state.route = state.yollar[idx];
      render();
    });
    document.getElementById('nkMazotBtn').addEventListener('click', function () {
      loadMazot(true);
    });
    loadMazot(false);

    Promise.all([
      fetch('data/tr-iller.geojson?v=20261008-nakliye', { cache: 'force-cache' }).then(function (r) { return r.json(); }),
      fetch('data/tr-ilceler.json?v=20261008-nakliye', { cache: 'force-cache' }).then(function (r) { return r.json(); }),
      fetch('data/tr-otoyol.json?v=20261010-yol', { cache: 'force-cache' }).then(function (r) { return r.json(); }).catch(function () { return null; }),
    ]).then(function (pair) {
      state.geo = pair[0];
      state.places = pair[1];
      state.otoyol = pair[2];
      (state.geo.features || []).forEach(function (f) {
        state.boxes[Number(f.properties.number)] = geomBox(f.geometry);
      });
      render();
    }).catch(function () {
      document.getElementById('nkMapHint').textContent = 'Harita verisi yüklenemedi.';
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind);
  else bind();
})();
