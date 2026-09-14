// plan-v4.js — Güncel İhracat Listesi → BBT / paketleme ayır → özmal / Akyüz kalan
(function (root) {
  'use strict';

  var MIN_NAKLIYECI_BBT = 20;
  var KUSURAT_LOW = 33;
  var KUSURAT_HIGH = 39;
  /** Paketleme Akyüz bildirimi: ambalaj NET değil, sabit 1375 kg */
  var PAKETLEME_BIRIM_KG = 1375;

  function trimStr(value) {
    return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  }

  function foldTr(value) {
    return trimStr(value)
      .replace(/İ/g, 'i')
      .replace(/I/g, 'i')
      .toLowerCase()
      .replace(/\u0307/g, '')
      .replace(/ı/g, 'i')
      .replace(/ş/g, 's')
      .replace(/ğ/g, 'g')
      .replace(/ü/g, 'u')
      .replace(/ö/g, 'o')
      .replace(/ç/g, 'c');
  }

  function parseNum(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    var s = trimStr(value).replace(/\s/g, '').replace(',', '.');
    if (!s) return NaN;
    var n = Number(s);
    return Number.isFinite(n) ? n : NaN;
  }

  function headerKey(value) {
    return foldTr(value)
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '');
  }

  /** Ambalaj metninden NET xxx KG */
  function extractUnitKg(ambalaj) {
    var s = trimStr(ambalaj);
    var m = s.match(/NET\s*([0-9]{3,5})\s*KG/i) || s.match(/\b([0-9]{3,5})\s*KG\b/i);
    if (!m) return 0;
    var kg = Number(m[1]);
    return Number.isFinite(kg) ? kg : 0;
  }

  /** BBT × birim kg → ton (örn. 40 × 1300 = 52 ton) */
  function tonajFromBbt(bbtCount, unitKg) {
    var b = parseNum(bbtCount);
    var kg = parseNum(unitKg);
    if (!(b > 0) || !(kg > 0)) return 0;
    return (b * kg) / 1000;
  }

  /** Hesap kg: paketleme → 1375 (Akyüz), diğer → ambalaj NET */
  function calcKgForKind(kind, ambalajUnitKg) {
    if (kind === 'paketleme') return PAKETLEME_BIRIM_KG;
    var kg = parseNum(ambalajUnitKg);
    return kg > 0 ? kg : 0;
  }

  function formatTon(n) {
    if (!(n > 0) || !Number.isFinite(n)) return '—';
    var fixed = n.toFixed(3).replace(/\.?0+$/, '');
    return fixed.replace('.', ',');
  }

  var TR_MONTHS = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];

  /** Excel serial / Date / gg.aa.yyyy / uzun TR metin → {y,m,d} */
  function parseDateParts(value) {
    if (value instanceof Date && !isNaN(value.getTime())) {
      var y = value.getUTCFullYear();
      var m = value.getUTCMonth();
      var d = value.getUTCDate();
      var h = value.getUTCHours();
      var mi = value.getUTCMinutes();
      var s = value.getUTCSeconds();
      if (h === 0 && mi === 0 && s === 0) {
        return { y: y, m: m + 1, d: d };
      }
      if (h >= 12) {
        var next = new Date(Date.UTC(y, m, d + 1));
        return { y: next.getUTCFullYear(), m: next.getUTCMonth() + 1, d: next.getUTCDate() };
      }
      return { y: y, m: m + 1, d: d };
    }
    if (typeof value === 'number' && Number.isFinite(value) && value > 20000 && value < 80000) {
      var serial = Math.floor(value + 1e-8);
      var utc = Date.UTC(1899, 11, 30) + serial * 86400000;
      var dt = new Date(utc);
      return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
    }
    var text = trimStr(value);
    if (!text) return null;
    var iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (iso) return { y: Number(iso[1]), m: Number(iso[2]), d: Number(iso[3]) };
    var tr = text.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})/);
    if (tr) return { y: Number(tr[3]), m: Number(tr[2]), d: Number(tr[1]) };
    var longTr = text.match(/^(\d{1,2})\s+([A-Za-zÇĞİÖŞÜçğıöşü]+)\s+(\d{4})/);
    if (longTr) {
      var monthIdx = TR_MONTHS.findIndex(function (name) {
        return foldTr(name) === foldTr(longTr[2]);
      });
      if (monthIdx >= 0) return { y: Number(longTr[3]), m: monthIdx + 1, d: Number(longTr[1]) };
    }
    return null;
  }

  function formatDateTr(value) {
    var p = parseDateParts(value);
    if (!p) return '';
    return String(p.d).padStart(2, '0') + '.' + String(p.m).padStart(2, '0') + '.' + p.y;
  }

  function formatHaftaLabel(value) {
    var text = trimStr(value);
    if (!text) return '';
    var m = text.match(/(\d{1,2})\s*\.?\s*hafta/i) || text.match(/^(\d{1,2})$/);
    if (m) return Number(m[1]) + '.hafta';
    var p = parseDateParts(value);
    if (!p) return text;
    var date = new Date(Date.UTC(p.y, p.m - 1, p.d));
    var dayNum = date.getUTCDay() || 7;
    date.setUTCDate(date.getUTCDate() + 4 - dayNum);
    var yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
    var week = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
    return week + '.hafta';
  }

  function findHeaderRow(grid) {
    for (var r = 0; r < Math.min(grid.length, 15); r++) {
      var row = grid[r] || [];
      var keys = row.map(function (c) { return headerKey(c); });
      var hasTed = keys.some(function (k) { return k.indexOf('tedarik') === 0; });
      var hasSip = keys.some(function (k) {
        return k.indexOf('netsis') >= 0 || k === 'sipno' || k.indexOf('siparis_no') >= 0;
      });
      var hasAmb = keys.some(function (k) { return k.indexOf('ambalaj') === 0; });
      if (hasTed && (hasSip || hasAmb)) return r;
    }
    return -1;
  }

  function mapColumns(headerRow) {
    var map = {};
    (headerRow || []).forEach(function (cell, i) {
      var k = headerKey(cell);
      if (!k) return;
      if (k.indexOf('tedarik') === 0) map.tedarikci = i;
      else if (k.indexOf('netsis') >= 0 && k.indexOf('siparis') >= 0) map.sipNo = i;
      else if (k === 'sipno' || k === 'netsis_siparis_no') map.sipNo = i;
      else if (k.indexOf('musteri') === 0 && k.indexOf('kod') < 0) map.musteri = i;
      else if (k === 'urun' || k.indexOf('urun') === 0) map.urun = i;
      else if (k === 'mt') map.mt = i;
      else if (k.indexOf('ambalaj') === 0) map.ambalaj = i;
      else if (k.indexOf('bigbag') >= 0 || k.indexOf('cuval') >= 0) map.bbCuval = i;
      else if (k === 'palet' || k.indexOf('palet') === 0) map.palet = i;
      else if (k === 'strec' || k.indexOf('strec') === 0 || k === 'stretch') map.strec = i;
      else if (k === 'adet') map.adet = i;
      else if (k === 'hafta' || k.indexOf('hafta') === 0) map.hafta = i;
      else if (k.indexOf('cikis') >= 0 && k.indexOf('tarih') >= 0) map.cikis = i;
      else if (k.indexOf('genper') >= 0 && k.indexOf('tarih') >= 0) map.cikis = i;
      else if (k.indexOf('liman') >= 0 && k.indexOf('dolum') < 0 && k.indexOf('gidecegi') >= 0) map.liman = i;
      else if (k.indexOf('gidecegi_liman') >= 0 || k === 'gidecegi_liman') map.liman = i;
      else if (k.indexOf('liman_dolum') >= 0 || (k.indexOf('dolum') >= 0 && k.indexOf('tarih') >= 0)) map.dolum = i;
      else if (k.indexOf('siparis_tarih') >= 0 || (k.indexOf('siparis') >= 0 && k.indexOf('tarih') >= 0)) map.sipTarih = i;
      else if (k.indexOf('booking') >= 0) map.booking = i;
      else if (k.indexOf('gemi') >= 0) map.gemi = i;
      else if (k === 'aciklama' || k.indexOf('aciklama') === 0) map.aciklama = i;
    });
    return map;
  }

  function cell(row, idx) {
    if (idx == null || idx < 0) return '';
    return row[idx];
  }

  /**
   * Bigbag/Çuval + ADET → tip:
   * - paketleme: çuval/BBT oranı ≥ 20 (genelde ~54) → BBT = ADET
   * - bbt: Bigbag sütunu BBT sayısı
   */
  function classifyPack(bbCuval, adet, ambalaj) {
    var bb = parseNum(bbCuval);
    var ad = parseNum(adet);
    var kg = extractUnitKg(ambalaj);
    var ambFold = foldTr(ambalaj);
    var paketHint = /25\s*kg|baskili\s*cuvall|cuval.*istif|bigbage\s*istif|istifli/.test(ambFold);

    if (bb > 0 && ad > 0) {
      var ratio = bb / ad;
      if (ratio >= 20 || (paketHint && ratio >= 10)) {
        return {
          kind: 'paketleme',
          bbt: Math.round(ad),
          cuval: Math.round(bb),
          palet: 0,
          unitKg: kg,
          calcKg: PAKETLEME_BIRIM_KG,
          note: Math.round(bb) + ' çuval → ' + Math.round(ad) + ' BBT · Akyüz ' + PAKETLEME_BIRIM_KG + ' kg'
        };
      }
      return {
        kind: 'bbt',
        bbt: Math.round(bb),
        cuval: 0,
        palet: Math.round(ad),
        unitKg: kg,
        calcKg: kg,
        note: Math.round(bb) + ' BBT' + (ad > 0 ? (' / ' + Math.round(ad) + ' palet') : '')
      };
    }
    if (bb > 0) {
      var isPaket = paketHint && bb > 500;
      return {
        kind: isPaket ? 'paketleme' : 'bbt',
        bbt: isPaket ? 0 : Math.round(bb),
        cuval: isPaket ? Math.round(bb) : 0,
        palet: 0,
        unitKg: kg,
        calcKg: isPaket ? PAKETLEME_BIRIM_KG : kg,
        note: isPaket
          ? (Math.round(bb) + ' çuval (BBT belirsiz) · Akyüz ' + PAKETLEME_BIRIM_KG + ' kg')
          : (Math.round(bb) + ' BBT')
      };
    }
    if (ad > 0) {
      return {
        kind: 'bbt',
        bbt: Math.round(ad),
        cuval: 0,
        palet: 0,
        unitKg: kg,
        calcKg: kg,
        note: Math.round(ad) + ' BBT (ADET)'
      };
    }
    return { kind: 'bos', bbt: 0, cuval: 0, palet: 0, unitKg: kg, calcKg: 0, note: 'Boş' };
  }

  /** Boş / yok sayılan PALET-STREÇ hücreleri */
  function isNegationValue(value) {
    var s = foldTr(value);
    if (!s) return true;
    if (s === '-' || s === '—' || s === '.' || s === '0' || s === '0.0') return true;
    if (/^(yok|yoktur|yok\.|none|null|hayir|h\.?)$/.test(s)) return true;
    return false;
  }

  /**
   * Paletli / streçli sevkiyat → sal dorse / babalı araba (kritik uyarı).
   * Kaynak: PALET sütunu metni, ADET (BBT satırında palet adedi), STREC sütunu, ambalaj/açıklama.
   */
  function detectPaletStrec(opts) {
    opts = opts || {};
    var paletCol = trimStr(opts.paletCol);
    var strecCol = trimStr(opts.strecCol);
    var ambalaj = trimStr(opts.ambalaj);
    var aciklama = trimStr(opts.aciklama);
    var paletCount = parseNum(opts.paletCount);
    var kind = opts.kind || '';

    var blob = foldTr([paletCol, strecCol, ambalaj, aciklama].join(' '));

    var hasPalet = false;
    var hasStrec = false;

    if (paletCol && !isNegationValue(paletCol)) hasPalet = true;
    if (kind === 'bbt' && paletCount > 0) hasPalet = true;
    if (/paletli|palet\b|\bplt\b|\bsp\b|cift\s*muhur|ciftmuhur/.test(blob)) hasPalet = true;

    if (strecCol && !isNegationValue(strecCol)) hasStrec = true;
    if (parseNum(strecCol) > 0) hasStrec = true;
    if (/strec|stretch|\bsp\b|shrink\s*wrap/.test(blob)) hasStrec = true;

    var labels = [];
    if (hasPalet) labels.push('PALET');
    if (hasStrec) labels.push('STREÇ');
    var detailParts = [];
    if (hasPalet) {
      detailParts.push(paletCol && !isNegationValue(paletCol)
        ? ('Palet: ' + paletCol + (paletCount > 0 ? (' ×' + Math.round(paletCount)) : ''))
        : (paletCount > 0 ? (Math.round(paletCount) + ' palet') : 'Paletli'));
    }
    if (hasStrec) {
      detailParts.push(strecCol && !isNegationValue(strecCol) ? ('Streç: ' + strecCol) : 'Streçli');
    }

    return {
      hasPalet: hasPalet,
      hasStrec: hasStrec,
      alert: hasPalet || hasStrec,
      labels: labels,
      badge: labels.join('+') || '',
      detail: detailParts.join(' · '),
      banner: 'PALETLİ / STREÇLİ — sal dorse veya babaları çıkan araba iste. Gözden kaçırma!'
    };
  }

  function tedarikciFlag(tedarikci) {
    var t = foldTr(tedarikci);
    if (!t) return { key: 'bos', label: '—' };
    if (t.indexOf('gpm') >= 0 && t.indexOf('akyuz') >= 0) {
      return { key: 'ortak', label: 'GPM-AKYÜZ' };
    }
    if (t.indexOf('gpm') >= 0 || t === 'ozmal') return { key: 'gpm', label: 'GPM' };
    if (t.indexOf('akyuz') >= 0) return { key: 'akyuz', label: 'AKYÜZ' };
    return { key: 'diger', label: trimStr(tedarikci) };
  }

  function perTruckFromUnitKg(unitKg) {
    if (root.IsMerkezi && typeof root.IsMerkezi.perTruckFromUnitKg === 'function') {
      return root.IsMerkezi.perTruckFromUnitKg(unitKg);
    }
    var kg = parseNum(unitKg);
    if (!(kg > 0)) return { perTruck: 20, ton: 0, rule: '' };
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
    return { perTruck: per, ton: (per * kg) / 1000, rule: per + ' BBT/araç' };
  }

  function calcKalan(totalBbt, bizimBbt) {
    if (root.IsMerkezi && typeof root.IsMerkezi.calcNakliyeciKalan === 'function') {
      var r = root.IsMerkezi.calcNakliyeciKalan(totalBbt, bizimBbt, '');
      var kalan = r.kalan;
      var warnKusurat = kalan >= KUSURAT_LOW && kalan <= KUSURAT_HIGH;
      return Object.assign({}, r, {
        warnKusurat: warnKusurat,
        kusuratText: warnKusurat
          ? ('Dikkat: ' + kalan + ' BBT tek yük gibi küsürat — 2 arabaya böl (ör. 20+18).')
          : ''
      });
    }
    var total = Math.round(parseNum(totalBbt));
    var bizim = Math.round(parseNum(bizimBbt));
    if (!(total > 0) || !Number.isFinite(bizim)) {
      return { ok: false, level: 'idle', kalan: 0, text: 'Toplam ve bizim BBT girin' };
    }
    var kalan = total - bizim;
    var level = 'ok';
    var durum = '';
    if (kalan < 0) {
      level = 'bad';
      durum = 'HATA: Bizim BBT toplamı aşıyor.';
    } else if (kalan === 0) {
      durum = 'Tamam — nakliyeciye kalan yok.';
    } else if (kalan < MIN_NAKLIYECI_BBT) {
      level = 'bad';
      durum = 'AZ KALDI: ' + kalan + ' BBT (en az ' + MIN_NAKLIYECI_BBT + ').';
    } else {
      durum = 'Tamam — nakliyeciye ' + kalan + ' BBT.';
    }
    var warnKusurat = kalan >= KUSURAT_LOW && kalan <= KUSURAT_HIGH;
    return {
      ok: true,
      level: level,
      kalan: kalan,
      total: total,
      bizim: bizim,
      steps: total + ' − ' + bizim + ' = ' + kalan,
      durum: durum,
      warnKusurat: warnKusurat,
      kusuratText: warnKusurat
        ? ('Dikkat: ' + kalan + ' BBT tek yük gibi küsürat — 2 arabaya böl.')
        : '',
      text: durum
    };
  }

  function parseGuncelGrid(grid) {
    var rows = Array.isArray(grid) ? grid : [];
    var headerIdx = findHeaderRow(rows);
    if (headerIdx < 0) {
      return { ok: false, error: 'Başlık satırı bulunamadı (TEDARİKÇİ / AMBALAJ).', items: [] };
    }
    var col = mapColumns(rows[headerIdx]);
    if (col.ambalaj == null && col.bbCuval == null) {
      return { ok: false, error: 'AMBALAJ veya Bigbag/Çuval sütunu yok.', items: [] };
    }

    var items = [];
    for (var r = headerIdx + 1; r < rows.length; r++) {
      var row = rows[r] || [];
      var sip = trimStr(cell(row, col.sipNo));
      var mus = trimStr(cell(row, col.musteri));
      var amb = trimStr(cell(row, col.ambalaj));
      var bb = cell(row, col.bbCuval);
      var adet = cell(row, col.adet);
      if (!sip && !mus && !amb && !(parseNum(bb) > 0) && !(parseNum(adet) > 0)) continue;

      var pack = classifyPack(bb, adet, amb);
      var ted = tedarikciFlag(cell(row, col.tedarikci));
      var calcKg = pack.calcKg != null ? pack.calcKg : calcKgForKind(pack.kind, pack.unitKg);
      var tip = perTruckFromUnitKg(calcKg);
      var tonaj = tonajFromBbt(pack.bbt, calcKg);
      var paletColVal = trimStr(cell(row, col.palet));
      var strecColVal = trimStr(cell(row, col.strec));
      var aciklama = trimStr(cell(row, col.aciklama));
      var cikisRaw = cell(row, col.cikis);
      var dolumRaw = cell(row, col.dolum);
      var sipTarihRaw = cell(row, col.sipTarih);
      var haftaRaw = cell(row, col.hafta);
      var cikisTarih = formatDateTr(cikisRaw);
      var limanDolum = formatDateTr(dolumRaw);
      var sipTarih = formatDateTr(sipTarihRaw);
      var hafta = formatHaftaLabel(haftaRaw) || (cikisTarih ? formatHaftaLabel(cikisRaw) : '');
      var special = detectPaletStrec({
        paletCol: paletColVal,
        strecCol: strecColVal,
        ambalaj: amb,
        aciklama: aciklama,
        paletCount: pack.palet,
        kind: pack.kind
      });

      items.push({
        row: r + 1,
        tedarikci: ted.label,
        tedarikciKey: ted.key,
        sipNo: sip,
        musteri: mus,
        urun: trimStr(cell(row, col.urun)),
        mt: parseNum(cell(row, col.mt)),
        ambalaj: amb,
        aciklama: aciklama,
        hafta: hafta,
        cikisTarih: cikisTarih,
        limanDolum: limanDolum,
        sipTarih: sipTarih,
        liman: trimStr(cell(row, col.liman)),
        booking: trimStr(cell(row, col.booking)),
        gemi: trimStr(cell(row, col.gemi)),
        kind: pack.kind,
        bbt: pack.bbt,
        cuval: pack.cuval,
        palet: pack.palet,
        paletCol: paletColVal,
        strecCol: strecColVal,
        special: special,
        unitKg: pack.unitKg,
        calcKg: calcKg,
        tonaj: tonaj,
        note: pack.note,
        tipikPerArac: tip.perTruck,
        tipikTon: tip.ton
      });
    }

    return {
      ok: true,
      error: '',
      headerRow: headerIdx,
      items: items,
      summary: summarizeItems(items)
    };
  }

  function summarizeItems(items) {
    var bbtItems = [];
    var paketItems = [];
    var bosItems = [];
    var ortak = 0;
    var specialCount = 0;
    var dateSet = {};
    var dates = [];
    items.forEach(function (it) {
      if (it.tedarikciKey === 'ortak') ortak += 1;
      if (it.special && it.special.alert) specialCount += 1;
      if (it.kind === 'paketleme') paketItems.push(it);
      else if (it.kind === 'bbt' && it.bbt > 0) bbtItems.push(it);
      else bosItems.push(it);
      var d = trimStr(it.cikisTarih);
      if (d && !dateSet[d]) {
        dateSet[d] = true;
        dates.push(d);
      }
    });
    var totalBbt = bbtItems.reduce(function (s, it) { return s + (it.bbt || 0); }, 0);
    var totalPaketBbt = paketItems.reduce(function (s, it) { return s + (it.bbt || 0); }, 0);
    var totalTon = items.reduce(function (s, it) { return s + (it.tonaj || 0); }, 0);
    var bbtTon = bbtItems.reduce(function (s, it) { return s + (it.tonaj || 0); }, 0);
    var paketTon = paketItems.reduce(function (s, it) { return s + (it.tonaj || 0); }, 0);
    return {
      count: items.length,
      bbtCount: bbtItems.length,
      paketCount: paketItems.length,
      bosCount: bosItems.length,
      ortakCount: ortak,
      specialCount: specialCount,
      cikisDates: dates,
      totalBbt: totalBbt,
      totalPaketBbt: totalPaketBbt,
      totalTon: totalTon,
      bbtTon: bbtTon,
      paketTon: paketTon
    };
  }

  function planForItem(item, ozmalArac, ozmalBbtOverride) {
    var total = item && item.bbt > 0 ? item.bbt : 0;
    var calcKg = item && item.calcKg
      ? item.calcKg
      : calcKgForKind(item && item.kind, item && item.unitKg);
    var tip = perTruckFromUnitKg(calcKg);
    var arac = Math.round(parseNum(ozmalArac));
    var bizim = Number.isFinite(parseNum(ozmalBbtOverride)) && String(ozmalBbtOverride).trim() !== ''
      ? Math.round(parseNum(ozmalBbtOverride))
      : (arac > 0 ? arac * tip.perTruck : 0);
    var kalan = calcKalan(total, bizim);
    return {
      total: total,
      unitKg: item && item.unitKg || 0,
      calcKg: calcKg,
      tipikPerArac: tip.perTruck,
      ozmalArac: arac > 0 ? arac : 0,
      bizimBbt: bizim,
      kalan: kalan
    };
  }

  function listOzmalPlates() {
    try {
      if (root.OzmalPlates && typeof root.OzmalPlates.getOzmalPlates === 'function') {
        return root.OzmalPlates.getOzmalPlates() || [];
      }
    } catch (e) { /* ignore */ }
    return [];
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
    var fileIn = document.getElementById('pv4File');
    var drop = document.getElementById('pv4Drop');
    var fileName = document.getElementById('pv4FileName');
    var statusEl = document.getElementById('pv4Status');
    var listEl = document.getElementById('pv4List');
    var detailEl = document.getElementById('pv4Detail');
    var ozmalEl = document.getElementById('pv4Ozmal');
    var homeBtn = document.getElementById('pv4HomeBtn');
    var state = { parsed: null, selected: -1 };

    function setStatus(msg, isErr) {
      if (!statusEl) return;
      statusEl.textContent = msg || '';
      statusEl.className = 'pv4-status' + (isErr ? ' is-err' : '');
    }

    function renderOzmal() {
      if (!ozmalEl) return;
      var plates = listOzmalPlates();
      if (!plates.length) {
        ozmalEl.innerHTML = '<p class="pv4-hint">Özmal plaka listesi bu oturumda yok — araç sayısını elle yazabilirsin (sistemde Ayarlar’da kayıtlı).</p>';
        return;
      }
      ozmalEl.innerHTML = '<p class="pv4-hint"><strong>Özmal (' + plates.length + '):</strong> ' +
        plates.map(function (p) { return escapeHtml(p); }).join(' · ') + '</p>';
    }

    function renderList() {
      if (!listEl) return;
      if (!state.parsed || !state.parsed.items.length) {
        listEl.innerHTML = '<p class="pv4-empty">Güncel İhracat Excel’ini yükle.</p>';
        return;
      }
      var s = state.parsed.summary;
      var dateLabel = (s.cikisDates && s.cikisDates.length)
        ? s.cikisDates.join(' · ')
        : 'tarih yok';
      var head = '<div class="pv4-summary">' +
        '<span class="pv4-tag pv4-tag--date" title="GENPER çıkış tarihi">Çıkış: ' + escapeHtml(dateLabel) + '</span>' +
        '<span>' + s.count + ' satır</span>' +
        '<span class="pv4-tag pv4-tag--bbt">' + s.bbtCount + ' BBT malzeme (' + s.totalBbt + ' BBT · ' +
        formatTon(s.bbtTon) + ' ton)</span>' +
        '<span class="pv4-tag pv4-tag--paket">' + s.paketCount + ' paketleme (' + s.totalPaketBbt + ' BBT · ' +
        formatTon(s.paketTon) + ' ton)</span>' +
        (s.ortakCount ? '<span class="pv4-tag pv4-tag--warn">' + s.ortakCount + ' GPM-AKYÜZ</span>' : '') +
        (s.specialCount
          ? '<span class="pv4-tag pv4-tag--danger">' + s.specialCount + ' PALET / STREÇ</span>'
          : '') +
        '</div>';

      var html = head + '<div class="pv4-table-wrap"><table class="pv4-table"><thead><tr>' +
        '<th>#</th><th>Çıkış</th><th>Tip</th><th>Uyarı</th><th>Tedarikçi</th><th>Müşteri / Sipariş</th><th>Hesap kg</th><th>BBT</th><th>Tonaj</th><th>Not</th>' +
        '</tr></thead><tbody>';

      state.parsed.items.forEach(function (it, i) {
        var on = state.selected === i ? ' is-on' : '';
        var tipCls = it.kind === 'paketleme' ? 'paket' : (it.kind === 'bbt' ? 'bbt' : 'bos');
        var tipLabel = it.kind === 'paketleme' ? 'PAKET' : (it.kind === 'bbt' ? 'BBT' : '—');
        var kgLabel = it.kind === 'paketleme'
          ? (String(it.calcKg || PAKETLEME_BIRIM_KG) + '¹')
          : String(it.unitKg || '—');
        var sp = it.special || {};
        var alertCls = sp.alert ? ' pv4-row--alert' : '';
        var warnCell = sp.alert
          ? ('<span class="pv4-alert-badge" title="' + escapeHtml(sp.detail || sp.banner || '') + '">' +
            escapeHtml(sp.badge || '!') + '</span>')
          : '—';
        var dateCell = it.cikisTarih
          ? ('<strong>' + escapeHtml(it.cikisTarih) + '</strong>' +
            (it.hafta ? ('<br><small>' + escapeHtml(it.hafta) + '</small>') : ''))
          : (it.hafta ? escapeHtml(it.hafta) : '—');
        html += '<tr class="pv4-row' + on + alertCls + '" data-pv4-i="' + i + '">' +
          '<td>' + (i + 1) + '</td>' +
          '<td>' + dateCell + '</td>' +
          '<td><span class="pv4-kind pv4-kind--' + tipCls + '">' + tipLabel + '</span></td>' +
          '<td>' + warnCell + '</td>' +
          '<td>' + escapeHtml(it.tedarikci) + '</td>' +
          '<td><strong>' + escapeHtml(it.musteri || '—') + '</strong><br><small>' +
          escapeHtml(it.sipNo || '') + '</small></td>' +
          '<td title="' + (it.kind === 'paketleme'
            ? ('Ambalaj NET ' + (it.unitKg || '?') + ' · Akyüz hesabı ' + (it.calcKg || PAKETLEME_BIRIM_KG))
            : ('Ambalaj NET ' + (it.unitKg || '—'))) + '">' + kgLabel + '</td>' +
          '<td><strong>' + (it.bbt || '—') + '</strong></td>' +
          '<td><strong>' + formatTon(it.tonaj) + '</strong></td>' +
          '<td>' + escapeHtml(it.note) +
          (sp.detail ? ('<br><small class="pv4-alert-note">' + escapeHtml(sp.detail) + '</small>') : '') +
          '</td>' +
          '</tr>';
      });
      html += '</tbody></table></div>';
      if (s.paketCount > 0) {
        html += '<p class="pv4-hint">¹ Paketleme tonajı Akyüz bildirimi için <strong>1375 kg</strong> ile hesaplanır (ambalaj NET değil).</p>';
      }
      if (s.specialCount > 0) {
        html += '<p class="pv4-hint pv4-hint--danger">Kırmızı satırlar paletli / streçli — <strong>sal dorse veya babalı araba</strong> gerekir.</p>';
      }
      listEl.innerHTML = html;
    }

    function renderDetail() {
      if (!detailEl) return;
      var it = state.parsed && state.parsed.items[state.selected];
      if (!it) {
        detailEl.innerHTML = '<p class="pv4-hint">Soldan bir satır seç → özmal / Akyüz kalanı burada çıkar.</p>';
        return;
      }

      var calcKg = it.calcKg || calcKgForKind(it.kind, it.unitKg);
      var tip = perTruckFromUnitKg(calcKg);
      var sp = it.special || {};
      detailEl.innerHTML =
        '<div class="pv4-detail-head">' +
        '<h2>' + escapeHtml(it.musteri || 'Satır') + '</h2>' +
        '<p class="pv4-date-line">' +
        (it.cikisTarih
          ? ('<strong>Çıkış:</strong> ' + escapeHtml(it.cikisTarih))
          : '<strong>Çıkış:</strong> —') +
        (it.hafta ? (' · ' + escapeHtml(it.hafta)) : '') +
        (it.limanDolum ? (' · <strong>Liman dolum:</strong> ' + escapeHtml(it.limanDolum)) : '') +
        '</p>' +
        '<p>' + escapeHtml(it.sipNo) + ' · ' + escapeHtml(it.liman || 'liman?') + '</p>' +
        '<p class="pv4-amb">' + escapeHtml(it.ambalaj) + '</p>' +
        (sp.alert
          ? '<p class="pv4-banner pv4-banner--danger"><strong>' + escapeHtml(sp.badge) + '</strong> — ' +
            escapeHtml(sp.banner) +
            (sp.detail ? ('<br><span>' + escapeHtml(sp.detail) + '</span>') : '') +
            '</p>'
          : '') +
        (it.tedarikciKey === 'ortak'
          ? '<p class="pv4-banner pv4-banner--warn">GPM-AKYÜZ satırı — özmal + Akyüz birlikte planlanacak.</p>'
          : '') +
        (it.kind === 'paketleme'
          ? '<p class="pv4-banner pv4-banner--warn">Paketleme → Akyüz hesabı <strong>1375 kg</strong> (ambalaj NET ' +
            (it.unitKg || '?') + ' gösterge).</p>'
          : '') +
        '</div>' +
        '<div class="pv4-num-row">' +
        '<div class="pv4-num"><span>TOPLAM BBT</span><b>' + (it.bbt || 0) + '</b></div>' +
        '<div class="pv4-num"><span>HESAP kg</span><b>' + (calcKg || '—') + '</b></div>' +
        '<div class="pv4-num"><span>TONAJ</span><b>' + formatTon(it.tonaj) + '</b></div>' +
        '</div>' +
        '<div class="pv4-facts">' +
        '<div><span>Tip</span><b>' + (it.kind === 'paketleme' ? 'Paketleme' : 'BBT malzeme') + '</b></div>' +
        '<div><span>Ambalaj NET</span><b>' + (it.unitKg || '—') + '</b></div>' +
        '<div><span>Hesap</span><b>' + (it.bbt || 0) + ' × ' + (calcKg || 0) + '</b></div>' +
        '<div><span>Tipik özmal</span><b>' + tip.perTruck + ' BBT/araç</b></div>' +
        '</div>' +
        '<label class="im-field">Özmal kaç araç saracak?' +
        '<input id="pv4Arac" type="text" inputmode="numeric" placeholder="ör. 6 (sistemde ' +
        listOzmalPlates().length + ' plaka)">' +
        '</label>' +
        '<label class="im-field">veya bizim toplam BBT (elle)' +
        '<input id="pv4Bizim" type="text" inputmode="numeric" placeholder="boş bırak → araç × tipik">' +
        '</label>' +
        '<div class="pv4-num-row">' +
        '<div class="pv4-num"><span>BİZİM BBT</span><b id="pv4NumBizim">0</b></div>' +
        '<div class="pv4-num"><span>AKYÜZ KALAN</span><b id="pv4NumKalan">—</b></div>' +
        '<div class="pv4-num"><span>TOPLAM</span><b>' + (it.bbt || 0) + '</b></div>' +
        '</div>' +
        '<p id="pv4Steps" class="im-nak-steps" hidden></p>' +
        '<p id="pv4Out" class="im-calc-out">Araç veya bizim BBT yaz</p>' +
        '<p id="pv4Kusurat" class="pv4-banner pv4-banner--warn" hidden></p>';

      var aracIn = document.getElementById('pv4Arac');
      var bizimIn = document.getElementById('pv4Bizim');
      var stepsEl = document.getElementById('pv4Steps');
      var outEl = document.getElementById('pv4Out');
      var kusEl = document.getElementById('pv4Kusurat');

      function refresh() {
        var plan = planForItem(it, aracIn && aracIn.value, bizimIn && bizimIn.value);
        var k = plan.kalan;
        if (stepsEl) {
          stepsEl.textContent = k.steps || '';
          stepsEl.hidden = !k.steps;
        }
        if (outEl) {
          outEl.textContent = k.durum || k.text || '';
          outEl.className = 'im-calc-out' +
            (k.level === 'bad' ? ' im-calc-out--bad' : (k.level === 'ok' && k.ok ? ' im-calc-out--ok' : ''));
        }
        var numBizim = document.getElementById('pv4NumBizim');
        var numKalan = document.getElementById('pv4NumKalan');
        if (numBizim) numBizim.textContent = String(plan.bizimBbt || 0);
        if (numKalan) {
          numKalan.textContent = String(k.kalan != null ? k.kalan : '—');
          numKalan.parentElement.className = 'pv4-num' +
            (k.level === 'bad' ? ' pv4-num--warn' : (k.level === 'ok' && k.ok ? ' pv4-num--ok' : ''));
        }
        if (kusEl) {
          if (k.warnKusurat && k.kusuratText) {
            kusEl.hidden = false;
            kusEl.textContent = k.kusuratText;
          } else {
            kusEl.hidden = true;
            kusEl.textContent = '';
          }
        }
      }
      if (aracIn) aracIn.addEventListener('input', refresh);
      if (bizimIn) bizimIn.addEventListener('input', refresh);
      refresh();
    }

    async function loadFile(file) {
      if (!file) return;
      if (fileName) fileName.textContent = file.name;
      setStatus('Okunuyor…');
      try {
        if (typeof root.ensureXlsxLoaded === 'function') {
          await root.ensureXlsxLoaded();
        } else if (typeof XLSX === 'undefined') {
          await new Promise(function (resolve, reject) {
            var s = document.createElement('script');
            s.src = '/vendor/xlsx.full.min.js';
            s.onload = function () { resolve(true); };
            s.onerror = function () {
              s = document.createElement('script');
              s.src = 'https://cdn.jsdelivr.net/npm/xlsx/dist/xlsx.full.min.js';
              s.onload = function () { resolve(true); };
              s.onerror = reject;
              document.head.appendChild(s);
            };
            document.head.appendChild(s);
          });
        }
        if (typeof XLSX === 'undefined') {
          setStatus('Excel okuyucu yüklenemedi.', true);
          return;
        }
        var buf = await file.arrayBuffer();
        var wb = XLSX.read(buf, { type: 'array', cellDates: false });
        var sheetName = wb.SheetNames.find(function (n) {
          return foldTr(n).indexOf('guncel') >= 0;
        }) || wb.SheetNames[0];
        var grid = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], {
          header: 1,
          defval: '',
          blankrows: false
        });
        var parsed = parseGuncelGrid(grid);
        if (!parsed.ok) {
          state.parsed = null;
          state.selected = -1;
          renderList();
          renderDetail();
          setStatus(parsed.error || 'Okunamadı', true);
          return;
        }
        state.parsed = parsed;
        state.selected = parsed.items.length ? 0 : -1;
        renderList();
        renderDetail();
        var dates = (parsed.summary && parsed.summary.cikisDates) || [];
        var dateMsg = dates.length ? (' · çıkış ' + dates.join(', ')) : ' · çıkış tarihi okunamadı';
        setStatus(sheetName + ' · ' + parsed.items.length + ' satır hazır' + dateMsg + '. Satır seç, özmal yaz.');
        toast('Plan v4: ' + parsed.items.length + ' satır' + (dates.length ? (' · ' + dates[0]) : '') + '.');
      } catch (err) {
        setStatus('Dosya okunamadı: ' + (err && err.message ? err.message : 'hata'), true);
      }
    }

    if (fileIn) {
      fileIn.addEventListener('change', function () {
        loadFile(fileIn.files && fileIn.files[0]);
      });
    }
    if (drop) {
      drop.addEventListener('click', function () {
        if (fileIn) fileIn.click();
      });
      drop.addEventListener('dragover', function (e) {
        e.preventDefault();
        drop.classList.add('is-over');
      });
      drop.addEventListener('dragleave', function () {
        drop.classList.remove('is-over');
      });
      drop.addEventListener('drop', function (e) {
        e.preventDefault();
        drop.classList.remove('is-over');
        var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        loadFile(f);
      });
    }
    if (listEl) {
      listEl.addEventListener('click', function (e) {
        var tr = e.target.closest('[data-pv4-i]');
        if (!tr) return;
        state.selected = Number(tr.getAttribute('data-pv4-i'));
        renderList();
        renderDetail();
      });
    }
    if (homeBtn) {
      homeBtn.addEventListener('click', function () {
        if (root.SessionManager && typeof root.SessionManager.navigateToHome === 'function') {
          root.SessionManager.navigateToHome();
        } else {
          location.href = 'GIRIS.html';
        }
      });
    }

    renderOzmal();
    renderList();
    renderDetail();
    return { state: state, loadFile: loadFile };
  }

  var api = {
    MIN_NAKLIYECI_BBT: MIN_NAKLIYECI_BBT,
    PAKETLEME_BIRIM_KG: PAKETLEME_BIRIM_KG,
    extractUnitKg: extractUnitKg,
    tonajFromBbt: tonajFromBbt,
    calcKgForKind: calcKgForKind,
    formatTon: formatTon,
    formatDateTr: formatDateTr,
    parseDateParts: parseDateParts,
    classifyPack: classifyPack,
    detectPaletStrec: detectPaletStrec,
    tedarikciFlag: tedarikciFlag,
    perTruckFromUnitKg: perTruckFromUnitKg,
    calcKalan: calcKalan,
    parseGuncelGrid: parseGuncelGrid,
    planForItem: planForItem,
    listOzmalPlates: listOzmalPlates,
    bindAppUi: bindAppUi
  };

  if (typeof root !== 'undefined') root.PlanV4 = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : typeof global !== 'undefined' ? global : this);
