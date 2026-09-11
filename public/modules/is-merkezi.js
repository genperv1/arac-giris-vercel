// is-merkezi.js — Sabah / Haftalık / Sevkiyat sonrası iş kontrol listesi
(function (root) {
  'use strict';

  var STORAGE_KEY = 'gpm_is_merkezi_v1';

  var FLOWS = {
    sabah: {
      id: 'sabah',
      title: 'Sabah yapılacak işler',
      hint: 'İrsaliye → liste → BBT → son kontrol',
      sections: [
        {
          title: '1. İrsaliye kontrolü',
          items: [
            { id: 's-irs-1', text: 'İrsaliyeleri kontrol et (ilk iş).' },
            { id: 's-irs-2', text: '2 Excel dosyasını indir.' },
            { id: 's-irs-3', text: 'Excel’leri birleştir (Özel Yapıştır).' },
            { id: 's-irs-4', text: 'Kontrol: irsaliye no, teslim cari, taşıyıcı, miktar 1/2, şoför, sipariş no.' },
            { id: 's-irs-5', text: 'Sevkiyat bitince Netsis rapordan tekrar kontrol et.' }
          ]
        },
        {
          title: '2. Liste hazırlama',
          items: [
            { id: 's-lst-1', text: 'Halil’e 2 günlük “iboya nereden satılacak” sor.' },
            { id: 's-lst-2', text: 'İhracat listesini aç ve kopyala.' },
            { id: 's-lst-3', text: 'İhracat listesinde D sütununa ekle → kendi Excel ihracat bölümüne yapıştır.' },
            { id: 's-lst-4', text: 'Sevkiyat Takip Formu’na numarayı yaz.' },
            { id: 's-lst-5', text: 'Gerekli verileri kopyalayıp Excel’e yapıştır.' },
            { id: 's-lst-6', text: 'Ton ÷ 27 yap; ona göre satır ekle (sağdaki hesap kutusu).' }
          ]
        },
        {
          title: '3. Kendi araç yük kuralları',
          items: [
            { id: 's-yuk-1', text: 'Akyüz’e 1–19 BBT gibi az / 38 gibi tek küsürat bırakma; en az ~20 BBT kalsın.', critical: true },
            { id: 's-yuk-2', text: 'Sarı alana KG ve yükleme yeri bilgilerini gir.' }
          ]
        },
        {
          title: '4. BBT / paketleme',
          items: [
            { id: 's-bbt-1', text: 'Bizim tipik: 1350→19 · 1250→20 · 1150→22 BBT/araç (≤~27 ton).' },
            { id: 's-bbt-2', text: 'Başlıklarda BBT→çuval, palet→BBT çevir.' }
          ]
        },
        {
          title: '5. Son kontrol',
          items: [
            { id: 's-son-1', text: 'Güncel ihracat listesiyle yaptığın Excel’i karşılaştır.' },
            { id: 's-son-2', text: 'Lot no ile maillerden de bak.' },
            { id: 's-son-3', text: 'Eksik veya uyuşmayan kayıt var mı kontrol et.' }
          ]
        }
      ]
    },
    haftalik: {
      id: 'haftalik',
      title: 'Haftalık ihracat sevk',
      hint: 'Sibel maili → Liste kopyala → GPM/Akyüz',
      sections: [
        {
          title: 'Akış',
          items: [
            { id: 'h-1', text: 'Sibel Hanım’ın mailini indir; dosya adını kopyala.' },
            { id: 'h-2', text: 'Liste kopyala’ya bas (filtreyi kapatıp güncel listeye yapıştır).', link: 'liste-kopyala' },
            { id: 'h-3', text: 'GPM ayrı, Akyüz ayrı düzenle.' },
            { id: 'h-4', text: 'Paketlemeleri 1375’ten hesapla.' },
            { id: 'h-5', text: 'Bizim arabaların sardığı yükü Akyüz’den düş — çok önemli.', critical: true },
            { id: 'h-6', text: 'Paletli/streçli ise sal dorse veya babaları çıkan araba iste.' },
            { id: 'h-7', text: 'Bizim araçları Selahattin abiye; Akyüz listesini Akyüz’e mail at.' }
          ]
        }
      ]
    },
    sonra: {
      id: 'sonra',
      title: 'Sevkiyat bittikten sonra',
      hint: 'Netsis → Selahattin → bloklar → mail → muhasebe',
      sections: [
        {
          title: '1. Netsis kayıtlı rapor',
          items: [
            { id: 'z-1', text: 'Netsis’te kayıtlı raporu aç.' },
            { id: 'z-2', text: 'OSB sevkiyatlarında KG hariç gerekli düzenlemeleri yap.' },
            { id: 'z-3', text: 'Hata / eksik / yanlış varsa düzelt.' },
            { id: 'z-4', text: 'Verileri Excel’e aktar ve filtrele.' },
            { id: 'z-5', text: 'Toplam KG, BBT sayıları ve diğer bilgileri tek tek karşılaştır.' },
            { id: 'z-6', text: 'Tutuyorsa yeni Excel kitabını tarihle adlandırıp kaydet.' }
          ]
        },
        {
          title: '2. Selahattin abi',
          items: [
            { id: 'z-7', text: '“Netsis tutuyor.” mesajını hazırla — “tamam, gönder” dedikten sonra at.', critical: true }
          ]
        },
        {
          title: '3. Sevkiyat ve bloklar',
          items: [
            { id: 'z-8', text: 'Kaç blok / sevkiyat olduğunu say; taslakta o kadar kopya oluştur.' },
            { id: 'z-9', text: 'Her sevkiyatın son kısmını + yükleme yerini ilgili taslağa yapıştır.' },
            { id: 'z-10', text: 'Sevkiyat listesinde bizim araçlarımız varsa sil.' },
            { id: 'z-11', text: 'Blok başlığına dosya adı + PO (yoksa Lot No) yaz.' }
          ]
        },
        {
          title: '4. Gönderilen mailler',
          items: [
            { id: 'z-12', text: 'Gönderilen Mailler → ilgili mail → Tümünü Yanıtla.' },
            { id: 'z-13', text: 'Biten dosyaları ekle; tonaj / madencilik / tarih / ekleri kontrol et.' }
          ]
        },
        {
          title: '5. Muhasebe dosyaları',
          items: [
            { id: 'z-14', text: 'Muhasebeye gönderilecek işlemi başlat.' },
            { id: 'z-15', text: 'Masaüstündeki gerekli dosyayı Akyüz klasörüne kopyala.' },
            { id: 'z-16', text: 'Maillerde Lot No ara; sipariş formları + ihracat listesini klasöre ekle.' },
            { id: 'z-17', text: 'Dosyaları Arşiv klasörüne de ekle; klasörü sevkiyat tarihiyle adlandır.' }
          ]
        },
        {
          title: '6. Son kontrol',
          items: [
            { id: 'z-18', text: 'Sevkiyat tarihi, tonaj, Lot/PO, sipariş formları, ihracat listesi, Akyüz+Arşiv tamam mı?' },
            { id: 'z-19', text: 'Her şey tamamsa Muhasebeye gönder.' }
          ]
        }
      ]
    }
  };

  function todayKey() {
    var d = new Date();
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }

  function loadState() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { date: todayKey(), checked: {}, tab: 'sabah' };
      var parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return { date: todayKey(), checked: {}, tab: 'sabah' };
      if (parsed.date !== todayKey()) {
        return { date: todayKey(), checked: {}, tab: 'sabah' };
      }
      var tab = parsed.tab || 'sabah';
      if (!FLOWS[tab]) tab = 'sabah';
      return {
        date: parsed.date,
        checked: parsed.checked && typeof parsed.checked === 'object' ? parsed.checked : {},
        tab: tab
      };
    } catch (e) {
      return { date: todayKey(), checked: {}, tab: 'sabah' };
    }
  }

  function saveState(state) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        date: state.date || todayKey(),
        checked: state.checked || {},
        tab: state.tab || 'sabah'
      }));
    } catch (e) { /* ignore */ }
  }

  function flowProgress(flow, checked) {
    var total = 0;
    var done = 0;
    (flow.sections || []).forEach(function (sec) {
      (sec.items || []).forEach(function (item) {
        total += 1;
        if (checked[item.id]) done += 1;
      });
    });
    return { total: total, done: done };
  }

  function parseNum(value) {
    var s = String(value == null ? '' : value).trim().replace(/\s/g, '').replace(',', '.');
    if (!s) return NaN;
    var n = Number(s);
    return Number.isFinite(n) ? n : NaN;
  }

  function formatNum(n, digits) {
    if (!Number.isFinite(n)) return '—';
    var d = digits == null ? 2 : digits;
    var fixed = n.toFixed(d);
    return fixed.replace(/\.?0+$/, '').replace('.', ',');
  }

  /** Ton ÷ 27 → satır sayısı */
  function calcTonRows(ton) {
    var t = parseNum(ton);
    if (!(t > 0)) return { ok: false, rows: 0, text: 'Ton girin' };
    var rows = t / 27;
    return {
      ok: true,
      rows: rows,
      text: formatNum(t, 2) + ' ton ÷ 27 = ' + formatNum(rows, 2) + ' satır (yuvarla: ' + Math.ceil(rows) + ')'
    };
  }

  /** Ambalaj BBT × birim kg → tonaj */
  function calcTonajFromBbt(bbtCount, unitKg) {
    var b = parseNum(bbtCount);
    var kg = parseNum(unitKg);
    if (!(b > 0) && !(kg > 0)) return { ok: false, ton: 0, text: 'BBT ve birim kg girin' };
    if (!(b > 0)) return { ok: false, ton: 0, text: 'Ambalaj BBT sayısını girin' };
    if (!(kg > 0)) return { ok: false, ton: 0, text: 'Birim ağırlığı (kg) girin' };
    var totalKg = b * kg;
    var ton = totalKg / 1000;
    return {
      ok: true,
      ton: ton,
      totalKg: totalKg,
      text: formatNum(b, 0) + ' BBT × ' + formatNum(kg, 0) + ' kg = ' + formatNum(ton, 3) + ' ton'
    };
  }

  /** Akyüz’e tek sağlam yük için pratik alt sınır (örneklerde ~20 BBT). */
  var MIN_NAKLIYECI_BBT = 20;

  /**
   * Birim kg → bizim (GPM) tipik BBT / araç (~25–27 ton, max ~26–27).
   * Gerçek sevkiyat örnekleri: 1350→19 · 1250→20 · 1300→20 · 1150→22.
   */
  function perTruckFromUnitKg(unitKg) {
    var kg = parseNum(unitKg);
    if (!(kg > 0)) {
      return {
        perTruck: 20,
        ton: 0,
        rule: 'Birim kg gir → bizim tipik BBT/araç görünsün'
      };
    }
    var per = 20;
    if (Math.abs(kg - 1150) < 1) per = 22;
    else if (Math.abs(kg - 1250) < 1) per = 20;
    else if (Math.abs(kg - 1300) < 1) per = 20;
    else if (Math.abs(kg - 1350) < 1) per = 19;
    else {
      per = Math.round(27000 / kg);
      if (per < 19) per = 19;
      if (per > 24) per = 24;
    }
    var ton = (per * kg) / 1000;
    return {
      perTruck: per,
      ton: ton,
      rule: 'Bizim tipik: ' + per + ' BBT/araç ≈ ' + formatNum(ton, 2) + ' ton (' +
        formatNum(kg, 0) + ' kg). Örnek 6 araç → ' + (6 * per) + ' BBT'
    };
  }

  /**
   * Nakliyeci kalan = toplam − bizim (sarı GPM).
   * Kırmızı: bizim fazla (kalan < 0) veya az kaldı (0 < kalan < 20).
   * Yeşil: kalan 0 veya ≥ 20. Akyüz araç sayısı / çift kuralı yok.
   */
  function calcNakliyeciKalan(totalBbt, bizimBbt, unitKg) {
    var total = parseNum(totalBbt);
    var bizim = parseNum(bizimBbt);
    var tip = perTruckFromUnitKg(unitKg);
    var per = tip.perTruck;
    var minOk = MIN_NAKLIYECI_BBT;

    if (!(total > 0) && !(bizim >= 0 && String(bizimBbt == null ? '' : bizimBbt).trim() !== '')) {
      return {
        ok: false,
        level: 'idle',
        kalan: 0,
        text: '1) Toplam BBT  2) Bizim BBT yaz',
        steps: '',
        rule: tip.rule,
        perTruck: per
      };
    }
    if (!(total > 0)) {
      return {
        ok: false,
        level: 'idle',
        kalan: 0,
        text: 'Sipariş toplam BBT girin',
        steps: '',
        rule: tip.rule,
        perTruck: per
      };
    }
    if (!(bizim >= 0) || !Number.isFinite(bizim) || String(bizimBbt == null ? '' : bizimBbt).trim() === '') {
      return {
        ok: false,
        level: 'idle',
        kalan: 0,
        text: 'Sarı GPM satırlarının BBT toplamını girin',
        steps: '',
        rule: tip.rule,
        perTruck: per
      };
    }

    var t = Math.round(total);
    var b = Math.round(bizim);
    var kalan = t - b;
    var level = 'ok';
    var durum = '';
    var text = '';

    if (kalan < 0) {
      level = 'bad';
      durum = 'HATA: Bizim BBT, toplamı aşıyor.';
      text = durum + ' (kalan ' + kalan + ')';
    } else if (kalan === 0) {
      level = 'ok';
      durum = 'Tamam — nakliyeciye kalan yok (hepsi bizim).';
      text = durum;
    } else if (kalan < minOk) {
      level = 'bad';
      durum = 'AZ KALDI: ' + kalan + ' BBT — Akyüz’e tek sağlam yük yetmez (en az ' +
        minOk + '). Bizim yükü azalt veya artır.';
      text = durum;
    } else {
      level = 'ok';
      durum = 'Tamam — nakliyeciye ' + kalan + ' BBT kaldı (≥' + minOk + ').';
      text = durum;
    }

    var steps = t + ' (toplam) − ' + b + ' (bizim) = ' + kalan + ' (nakliyeci)';

    return {
      ok: true,
      level: level,
      kalan: kalan,
      total: t,
      bizim: b,
      perTruck: per,
      rule: tip.rule,
      steps: steps,
      durum: durum,
      text: steps + ' · ' + durum,
      short: 'Nakliyeci kalan: ' + kalan + ' BBT'
    };
  }

  /** Bizim araç adedi × tipik BBT/araç → önerilen bizim toplam */
  function suggestBizimBbt(aracSayisi, unitKg) {
    var n = parseNum(aracSayisi);
    var tip = perTruckFromUnitKg(unitKg);
    if (!(n > 0) || !Number.isFinite(n)) {
      return { ok: false, bbt: 0, perTruck: tip.perTruck, rule: tip.rule, text: tip.rule };
    }
    var arac = Math.round(n);
    var bbt = arac * tip.perTruck;
    return {
      ok: true,
      bbt: bbt,
      arac: arac,
      perTruck: tip.perTruck,
      rule: tip.rule,
      text: arac + ' araç × ' + tip.perTruck + ' BBT = ' + bbt + ' BBT (bizim)'
    };
  }

  /** Paketleme: kg veya ton → 1375’e böl */
  function calcPaket1375(amount, unit) {
    var n = parseNum(amount);
    if (!(n > 0)) return { ok: false, text: 'Miktar girin' };
    var kg = (unit === 'ton') ? n * 1000 : n;
    var bbt = kg / 1375;
    return {
      ok: true,
      bbt: bbt,
      text: formatNum(kg, 0) + ' kg ÷ 1375 = ' + formatNum(bbt, 2) + ' BBT (yuvarla: ' + Math.ceil(bbt) + ')'
    };
  }

  /** Ton ÷ 27 = araba; BBT elle → araç başı BBT */
  function calcBbt(ton, bbtCount) {
    var t = parseNum(ton);
    var b = parseNum(bbtCount);
    if (!(t > 0) && !(b > 0)) {
      return { ok: false, arabalar: 0, perArac: 0, text: 'Ton ve BBT sayısını girin' };
    }
    if (!(t > 0)) {
      return { ok: false, arabalar: 0, perArac: 0, text: 'Ton girin (÷27 = araba)' };
    }
    var arabalar = t / 27;
    if (!(b > 0)) {
      return {
        ok: true,
        arabalar: arabalar,
        perArac: 0,
        text: formatNum(t, 2) + ' ton ÷ 27 = ' + formatNum(arabalar, 2) + ' araba · BBT sayısını girin'
      };
    }
    var per = b / arabalar;
    return {
      ok: true,
      arabalar: arabalar,
      perArac: per,
      text: formatNum(t, 2) + ' ton ÷ 27 = ' + formatNum(arabalar, 2) + ' araba · ' +
        formatNum(b, 1) + ' BBT → araç başı ' + formatNum(per, 2) + ' BBT'
    };
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function bindAppUi(opts) {
    opts = opts || {};
    var toast = typeof opts.toast === 'function' ? opts.toast : function () {};
    var rootEl = document.getElementById('imPage');
    if (!rootEl) return null;

    var state = loadState();
    var tabsEl = document.getElementById('imTabs');
    var bodyEl = document.getElementById('imBody');
    var progressEl = document.getElementById('imProgress');
    var resetBtn = document.getElementById('imResetBtn');
    var homeBtn = document.getElementById('imHomeBtn');
    var openListeBtn = document.getElementById('imOpenListeBtn');
    var openNakliyeBtn = document.getElementById('imOpenNakliyeBtn');

    function openPage(path) {
      if (window.SessionManager && typeof window.SessionManager.openAppPage === 'function') {
        window.SessionManager.openAppPage(path);
      } else {
        location.href = path;
      }
    }

    function renderTabs() {
      if (!tabsEl) return;
      tabsEl.innerHTML = Object.keys(FLOWS).map(function (key) {
        var flow = FLOWS[key];
        var on = state.tab === key ? ' is-active' : '';
        var prog = flowProgress(flow, state.checked);
        return '<button type="button" class="im-tab' + on + '" data-im-tab="' + key + '">' +
          '<strong>' + escapeHtml(flow.title) + '</strong>' +
          '<span>' + prog.done + '/' + prog.total + '</span>' +
          '</button>';
      }).join('');
    }

    function renderBody() {
      var flow = FLOWS[state.tab] || FLOWS.sabah;
      if (!FLOWS[state.tab]) state.tab = 'sabah';
      flow = FLOWS[state.tab] || FLOWS.sabah;
      var prog = flowProgress(flow, state.checked);
      if (progressEl) {
        progressEl.textContent = todayKey() + ' · ' + flow.title + ' · ' + prog.done + '/' + prog.total;
      }
      if (!bodyEl) return;
      bodyEl.hidden = false;
      var html = '<p class="im-hint">' + escapeHtml(flow.hint) + '</p>';
      flow.sections.forEach(function (sec) {
        html += '<section class="im-section"><h2>' + escapeHtml(sec.title) + '</h2><ul class="im-list">';
        sec.items.forEach(function (item) {
          var on = !!state.checked[item.id];
          html += '<li class="im-item' + (on ? ' is-done' : '') + (item.critical ? ' is-critical' : '') + '">' +
            '<label>' +
            '<input type="checkbox" data-im-id="' + escapeHtml(item.id) + '"' + (on ? ' checked' : '') + '>' +
            '<span>' + escapeHtml(item.text) + '</span>' +
            '</label>';
          if (item.link === 'liste-kopyala') {
            html += '<button type="button" class="im-inline-link" data-im-open="liste-kopyala.html">Liste kopyala</button>';
          }
          html += '</li>';
        });
        html += '</ul></section>';
      });
      bodyEl.innerHTML = html;
    }

    function renderAll() {
      renderTabs();
      renderBody();
      saveState(state);
    }

    function wireCalcs() {
      var tonIn = document.getElementById('imTonInput');
      var tonOut = document.getElementById('imTonOut');
      var bbtIn = document.getElementById('imBbtCountInput');
      var unitIn = document.getElementById('imUnitKgInput');
      var tonajOut = document.getElementById('imTonajOut');
      var nakTotal = document.getElementById('imNakTotalBbt');
      var nakUnit = document.getElementById('imNakUnitKg');
      var nakArac = document.getElementById('imNakArac');
      var nakBizim = document.getElementById('imNakBizimBbt');
      var nakHint = document.getElementById('imNakCapHint');
      var nakSteps = document.getElementById('imNakSteps');
      var nakOut = document.getElementById('imNakOut');

      function refreshTon() {
        if (!tonOut) return;
        tonOut.textContent = calcTonRows(tonIn && tonIn.value).text;
      }
      function refreshTonaj() {
        if (!tonajOut) return;
        tonajOut.textContent = calcTonajFromBbt(bbtIn && bbtIn.value, unitIn && unitIn.value).text;
      }
      function applyAracSuggest() {
        if (!nakArac || !nakBizim) return;
        var s = suggestBizimBbt(nakArac.value, nakUnit && nakUnit.value);
        if (s.ok) nakBizim.value = String(s.bbt);
      }
      function refreshNak() {
        var r = calcNakliyeciKalan(
          nakTotal && nakTotal.value,
          nakBizim && nakBizim.value,
          nakUnit && nakUnit.value
        );
        if (nakHint) nakHint.textContent = r.rule || '';
        if (nakSteps) {
          nakSteps.textContent = r.steps || '';
          nakSteps.hidden = !r.steps;
        }
        if (!nakOut) return;
        nakOut.textContent = r.durum || r.text;
        nakOut.className = 'im-calc-out' +
          (r.level === 'bad' ? ' im-calc-out--bad' : (r.level === 'ok' && r.ok ? ' im-calc-out--ok' : ''));
      }
      if (tonIn) tonIn.addEventListener('input', refreshTon);
      if (bbtIn) bbtIn.addEventListener('input', refreshTonaj);
      if (unitIn) unitIn.addEventListener('input', refreshTonaj);
      if (nakArac) {
        nakArac.addEventListener('input', function () {
          applyAracSuggest();
          refreshNak();
        });
      }
      if (nakUnit) {
        nakUnit.addEventListener('input', function () {
          if (nakArac && String(nakArac.value || '').trim() !== '') applyAracSuggest();
          refreshNak();
        });
      }
      if (nakBizim) nakBizim.addEventListener('input', refreshNak);
      if (nakTotal) nakTotal.addEventListener('input', refreshNak);
      refreshTon();
      refreshTonaj();
      refreshNak();
    }

    if (tabsEl) {
      tabsEl.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-im-tab]');
        if (!btn) return;
        state.tab = btn.getAttribute('data-im-tab') || 'sabah';
        renderAll();
      });
    }

    if (bodyEl) {
      bodyEl.addEventListener('change', function (e) {
        var input = e.target;
        if (!input || !input.matches('input[type="checkbox"][data-im-id]')) return;
        var id = input.getAttribute('data-im-id');
        if (!id) return;
        if (input.checked) state.checked[id] = true;
        else delete state.checked[id];
        renderAll();
      });
      bodyEl.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-im-open]');
        if (!btn) return;
        openPage(btn.getAttribute('data-im-open'));
      });
    }

    if (resetBtn) {
      resetBtn.addEventListener('click', function () {
        state.checked = {};
        state.date = todayKey();
        renderAll();
        toast('Bugünkü işaretler sıfırlandı.');
      });
    }

    if (homeBtn) {
      homeBtn.addEventListener('click', function () {
        if (window.SessionManager && typeof window.SessionManager.navigateToHome === 'function') {
          window.SessionManager.navigateToHome();
        } else if (window.SessionManager && typeof window.SessionManager.openHomePage === 'function') {
          window.SessionManager.openHomePage();
        } else {
          location.href = 'GIRIS.html';
        }
      });
    }

    if (openListeBtn) {
      openListeBtn.addEventListener('click', function () {
        openPage('liste-kopyala.html');
      });
    }

    if (openNakliyeBtn) {
      openNakliyeBtn.addEventListener('click', function () {
        openPage('nakliye-bekleyen.html');
      });
    }

    wireCalcs();
    renderAll();
    return { state: state, renderAll: renderAll };
  }

  var api = {
    STORAGE_KEY: STORAGE_KEY,
    FLOWS: FLOWS,
    todayKey: todayKey,
    loadState: loadState,
    saveState: saveState,
    flowProgress: flowProgress,
    calcTonRows: calcTonRows,
    calcTonajFromBbt: calcTonajFromBbt,
    MIN_NAKLIYECI_BBT: MIN_NAKLIYECI_BBT,
    perTruckFromUnitKg: perTruckFromUnitKg,
    calcNakliyeciKalan: calcNakliyeciKalan,
    suggestBizimBbt: suggestBizimBbt,
    calcPaket1375: calcPaket1375,
    calcBbt: calcBbt,
    bindAppUi: bindAppUi
  };

  if (typeof window !== 'undefined') window.IsMerkezi = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : typeof global !== 'undefined' ? global : this);
