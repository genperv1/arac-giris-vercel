// sayi-kontrol.js — Netsis raporu ↔ Güncel/Sevkiyat: SIPNO + tarih ile blok karşılaştırma
(function (root) {
  'use strict';

  var KG_TOLERANCE = 0; // kg/kantar/ton: tolerans yok
  var CUVAL_TOLERANCE = 1; // sadece çuval ±1

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
    var s = trimStr(value);
    if (!s) return NaN;
    if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) {
      s = s.replace(/\./g, '').replace(',', '.');
    } else if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) {
      s = s.replace(/,/g, '');
    } else {
      s = s.replace(/\s/g, '').replace(',', '.');
    }
    var n = Number(s);
    return Number.isFinite(n) ? n : NaN;
  }

  function headerKey(value) {
    return foldTr(value).replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  }

  function normalizeYd(text) {
    var m = String(text || '').match(/\bYD\s*(\d{1,4})\b/i);
    return m ? ('YD' + m[1]).toUpperCase() : '';
  }

  function normalizeLot(text) {
    var m = String(text || '').match(/LOT\s*(?:NO\s*)?([\d\s\-]+)/i);
    if (!m) {
      var digits = String(text || '').replace(/\D+/g, '');
      return digits.length >= 4 && digits.length <= 10 ? digits : '';
    }
    return String(m[1] || '').replace(/\D+/g, '');
  }

  function normalizeBooking(text) {
    var m = String(text || '').match(/BOOK[Iİ]NG\s*NO\s*[:\.]?\s*([A-Z0-9\-]+)/i);
    if (m) return m[1].toUpperCase();
    var bare = trimStr(text).toUpperCase();
    if (/^[A-Z]{2,6}\d{5,}$/.test(bare)) return bare;
    return '';
  }

  function normalizeSip(text) {
    var raw = trimStr(text).toUpperCase().replace(/\s+/g, '');
    var m = raw.match(/M\d{10,}/);
    return m ? m[0] : raw;
  }

  function extractNetsisSip(text) {
    var m = String(text || '').match(/NETS[Iİ]S\s*S[Iİ]PAR[Iİ][SŞ]\s*NO\s*[:\.]?\s*(M\d{10,})/i);
    if (m) return normalizeSip(m[1]);
    m = String(text || '').match(/\b(M\d{14,})\b/i);
    return m ? normalizeSip(m[1]) : '';
  }

  function normalizeIrsaliye(text) {
    var s = trimStr(text).toUpperCase().replace(/\s+/g, '');
    var m = s.match(/^R(\d{2})(\d+)$/i);
    if (!m) return s;
    var series = m[1];
    var num = m[2];
    // Netsis: R01 + 2026 + 00003488  |  Excel: R01 + 2026 + 03488
    var ym = num.match(/^(20\d{2})(\d+)$/);
    var year = ym ? ym[1] : '';
    var seqRaw = ym ? ym[2] : num;
    var seq = String(parseInt(seqRaw, 10) || 0).padStart(6, '0');
    return ('R' + series + year + seq).toUpperCase();
  }

  /** Gösterim için boşluksuz irsaliye (karşılaştırma anahtarı değil) */
  function displayIrsaliye(text) {
    return trimStr(text).toUpperCase().replace(/\s+/g, '');
  }

  function normalizePlaka(text) {
    return trimStr(text).toUpperCase().replace(/\s+/g, '');
  }

  function normalizeGsm(text) {
    var d = String(text || '').replace(/\D+/g, '');
    if (d.length >= 10) return d.slice(-10);
    return d;
  }

  /** DD.MM.YYYY veya Excel seri → DD.MM.YYYY */
  function normalizeDate(value) {
    if (value == null || value === '') return '';
    if (value instanceof Date && !isNaN(value.getTime())) {
      var dd = String(value.getDate()).padStart(2, '0');
      var mm = String(value.getMonth() + 1).padStart(2, '0');
      var yy = value.getFullYear();
      return dd + '.' + mm + '.' + yy;
    }
    if (typeof value === 'number' && Number.isFinite(value) && value > 20000 && value < 80000) {
      // Excel serial (yaklaşık)
      var epoch = Date.UTC(1899, 11, 30);
      var d = new Date(epoch + Math.round(value) * 86400000);
      return normalizeDate(d);
    }
    var s = trimStr(value);
    var m = s.match(/(\d{1,2})[./-](\d{1,2})[./-](\d{4})/);
    if (m) {
      return String(m[1]).padStart(2, '0') + '.' + String(m[2]).padStart(2, '0') + '.' + m[3];
    }
    m = s.match(/(\d{4})[./-](\d{1,2})[./-](\d{1,2})/);
    if (m) {
      return String(m[3]).padStart(2, '0') + '.' + String(m[2]).padStart(2, '0') + '.' + m[1];
    }
    return '';
  }

  function extractDateFromName(name) {
    return normalizeDate(name || '');
  }

  function classifyTasiyici(text) {
    var t = foldTr(text);
    if (!t) return '';
    if (t.indexOf('akyuz') >= 0) return 'AKYÜZ';
    if (t.indexOf('gpm') >= 0 || t.indexOf('genper') >= 0 || t.indexOf('ozmal') >= 0 || t.indexOf('madencilik') >= 0) {
      // Genper Madencilik = özmal/GPM tarafı
      if (t.indexOf('akyuz') >= 0) return 'AKYÜZ';
      return 'GPM';
    }
    if (t === 'gpm' || t === 'akyuz') return t === 'gpm' ? 'GPM' : 'AKYÜZ';
    return trimStr(text);
  }

  function extractPlanBbtFromText(text) {
    var re = /(\d+)\s*BBT\b/gi;
    var max = 0;
    var m;
    while ((m = re.exec(String(text || '')))) {
      var n = parseInt(m[1], 10);
      if (Number.isFinite(n) && n > max) max = n;
    }
    return max > 0 ? max : 0;
  }

  function extractHeaderTon(text) {
    var m = String(text || '').match(/(\d+(?:[.,]\d+)?)\s*TON\b/i);
    if (!m) return 0;
    return parseNum(m[1]) || 0;
  }

  function matchKey(parts) {
    var yd = parts.yd || '';
    var lot = parts.lot || '';
    var booking = parts.booking || '';
    var sip = parts.sip || '';
    if (yd && booking) return yd + '|B:' + booking;
    if (yd && lot) return yd + '|L:' + lot;
    if (sip) return 'S:' + sip;
    if (yd) return yd;
    return '';
  }

  function blockKey(tarih, sip) {
    var s = normalizeSip(sip);
    var d = normalizeDate(tarih) || '';
    if (!s) return '';
    return (d ? d + '|' : '') + 'S:' + s;
  }

  function rowText(row) {
    return (row || []).map(function (c) { return trimStr(c); }).join(' ');
  }

  function isPlakaHeaderRow(row) {
    var t = foldTr(rowText(row));
    if (t.indexOf('plaka') < 0) return false;
    return t.indexOf('bbt') >= 0 || t.indexOf('sirano') >= 0 || t.indexOf('sira') >= 0;
  }

  function isToplamRow(row) {
    var t = foldTr(rowText(row));
    if (t.indexOf('ara toplam') >= 0) return false;
    return /(^|\s)toplam(\s|$)/.test(t);
  }

  function isKalanRow(row) {
    return foldTr(rowText(row)).indexOf('kalan') >= 0;
  }

  function mapBlockCols(headerRow) {
    var map = {};
    (headerRow || []).forEach(function (cell, i) {
      var k = headerKey(cell);
      if (!k) return;
      if (k === 'plaka' && map.plaka == null) map.plaka = i;
      else if (k === 'bbt' && map.bbt == null) map.bbt = i;
      else if (k.indexOf('net_tonaj') === 0 || k === 'net_tonaj') map.netTonaj = i;
      else if (k.indexOf('giden') === 0) map.giden = i;
      else if ((k === 'cuval' || k === 'cuval_sayisi') && map.cuval == null) map.cuval = i;
      else if (k === 'palet' && map.palet == null) map.palet = i;
      else if (k.indexOf('bos_bbt') === 0 && map.bosBbt == null) map.bosBbt = i;
      else if (k.indexOf('bos_cuval') === 0 && map.bosCuval == null) map.bosCuval = i;
      else if (k.indexOf('irsaliye') >= 0 && map.irsaliye == null) map.irsaliye = i;
      else if (k.indexOf('sofor') >= 0 && k.indexOf('bilgi') >= 0 && map.soforBilgi == null) map.soforBilgi = i;
      else if (k.indexOf('sofor') >= 0 && map.sofor == null) map.sofor = i;
      else if ((k === 'telefon' || k.indexOf('telefon') === 0 || k === 'gsm') && map.telefon == null) map.telefon = i;
      else if (k === 'fark') map.fark = i;
    });
    if (map.irsaliye == null) map.irsaliye = 0;
    if (map.fark != null) map.tasiyici = map.fark + 1;
    return map;
  }

  function netsisPackCounts(ac1, ac2, ac5, ac6) {
    var bbt = 0;
    var cuval = 0;
    var t1 = foldTr(ac1);
    var t5 = foldTr(ac5);
    if (t1.indexOf('bbt') >= 0) bbt = Math.round(parseNum(ac2) || 0);
    if (t1.indexOf('cuval') >= 0) cuval = Math.round(parseNum(ac2) || 0);
    if (t5.indexOf('cuval') >= 0) cuval = Math.round(parseNum(ac6) || 0) || cuval;
    if (t5.indexOf('bbt') >= 0) bbt = Math.round(parseNum(ac6) || 0) || bbt;
    return { bbt: bbt, cuval: cuval };
  }

  function pickAboveHeader(grid, headerIdx) {
    var best = '';
    var start = Math.max(0, headerIdx - 12);
    for (var r = start; r < headerIdx; r++) {
      var row = grid[r] || [];
      for (var c = 0; c < row.length; c++) {
        var s = trimStr(row[c]);
        if (!s || !/\bYD\d{1,4}/i.test(s)) continue;
        if (s.length > best.length) best = s;
      }
    }
    return best;
  }

  function pickMetaText(grid, headerIdx) {
    var parts = [];
    var start = Math.max(0, headerIdx - 14);
    for (var r = start; r < headerIdx; r++) {
      parts.push(rowText(grid[r]));
    }
    return parts.join(' \n ');
  }

  function pickBlockTasiyici(grid, headerIdx, headerText, metaText) {
    var start = Math.max(0, headerIdx - 14);
    // Aşağıdan yukarı: bu bloğa en yakın başlık (önceki bloğun GPM/AKYÜZ'ü sızmasın)
    for (var r = headerIdx - 1; r >= start; r--) {
      var row = grid[r] || [];
      if (isPlakaHeaderRow(row) || isToplamRow(row)) break;
      var raw0 = trimStr(row[0]);
      if (raw0) {
        var fold0 = foldTr(raw0);
        if (fold0.indexOf('gpm') >= 0 && fold0.indexOf('akyuz') >= 0) return 'GPM-AKYÜZ';
        var c0 = classifyTasiyici(raw0);
        if (c0 === 'AKYÜZ' || c0 === 'GPM') return c0;
      }
    }
    var fromMeta = classifyTasiyici(headerText);
    if (fromMeta === 'AKYÜZ' || fromMeta === 'GPM') return fromMeta;
    return '';
  }

  function pickSevkTarih(grid, headerIdx, hintDate) {
    var start = Math.max(0, headerIdx - 14);
    for (var r = start; r < headerIdx; r++) {
      var row = grid[r] || [];
      for (var c = 0; c < row.length; c++) {
        var cellVal = trimStr(row[c]);
        if (foldTr(cellVal).indexOf('sevk') >= 0 && foldTr(cellVal).indexOf('tarih') >= 0) {
          var next = normalizeDate(row[c + 1]);
          if (next) return next;
          var same = cellVal.match(/(\d{1,2}[./-]\d{1,2}[./-]\d{4})/);
          if (same) return normalizeDate(same[1]);
        }
      }
    }
    return normalizeDate(hintDate) || '';
  }

  function cell(row, idx) {
    if (idx == null || idx < 0) return '';
    return row[idx];
  }

  function looksLikeIrsaliye(value) {
    var s = displayIrsaliye(value);
    return /^R\d{2}\d{6,}$/i.test(s);
  }

  function looksLikePlaka(value) {
    var s = normalizePlaka(value);
    return /^[0-9]{2}[A-Z]{1,3}[0-9]{2,4}$/.test(s);
  }

  /**
   * Sevkiyat takip Excel (YD blokları + PLAKA tablosu + TOPLAM).
   * hintDate: dosya/sheet adından DD.MM.YYYY
   */
  function parseSevkiyatGrid(grid, hintDate) {
    var rows = Array.isArray(grid) ? grid : [];
    var blocks = [];
    var i = 0;
    while (i < rows.length) {
      if (!isPlakaHeaderRow(rows[i])) {
        i += 1;
        continue;
      }
      var headerIdx = i;
      var cols = mapBlockCols(rows[headerIdx]);
      var headerText = pickAboveHeader(rows, headerIdx);
      var metaText = pickMetaText(rows, headerIdx);
      var sip = extractNetsisSip(metaText) || extractNetsisSip(headerText);
      var tarih = pickSevkTarih(rows, headerIdx, hintDate);
      var blockTasiyici = pickBlockTasiyici(rows, headerIdx, headerText, metaText);
      var liman = '';
      var mLiman = metaText.match(/L[Iİ]MAN\s*[:\.]?\s*([^\n|]+)/i);
      if (mLiman) liman = trimStr(mLiman[1]).split(/\s{2,}/)[0];
      // Yan panel LİMAN / DP WORLD
      for (var rr = Math.max(0, headerIdx - 10); rr < headerIdx; rr++) {
        var prow = rows[rr] || [];
        for (var cc = 0; cc < prow.length; cc++) {
          if (foldTr(prow[cc]) === 'liman' && trimStr(prow[cc + 1])) {
            liman = trimStr(prow[cc + 1]);
          }
        }
      }

      var end = rows.length;
      var totals = null;
      var lines = [];
      for (var r = headerIdx + 1; r < rows.length; r++) {
        if (r > headerIdx + 1 && isPlakaHeaderRow(rows[r])) {
          end = r;
          break;
        }
        if (isToplamRow(rows[r])) {
          totals = {
            bbt: parseNum(cell(rows[r], cols.bbt)),
            netTonaj: parseNum(cell(rows[r], cols.netTonaj)),
            giden: parseNum(cell(rows[r], cols.giden)),
            cuval: parseNum(cell(rows[r], cols.cuval)),
            palet: parseNum(cell(rows[r], cols.palet))
          };
          end = r + 1;
          if (end < rows.length && isKalanRow(rows[end])) end += 1;
          break;
        }
        if (isKalanRow(rows[r])) {
          end = r;
          break;
        }

        var row = rows[r] || [];
        var plaka = normalizePlaka(cell(row, cols.plaka));
        var irsRaw = cell(row, cols.irsaliye);
        if (!looksLikeIrsaliye(irsRaw) && cols.irsaliye === 0) {
          // sağ panel İRSALİYE NO
          for (var ci = 0; ci < row.length; ci++) {
            if (looksLikeIrsaliye(row[ci])) { irsRaw = row[ci]; break; }
          }
        }
        var irs = displayIrsaliye(irsRaw);
        if (!plaka && !irs) continue;
        if (plaka && !looksLikePlaka(plaka) && !irs) continue;

        var netKg = parseNum(cell(row, cols.netTonaj));
        var gidenKg = parseNum(cell(row, cols.giden));
        if (Number.isFinite(netKg) && netKg > 0 && netKg < 500) netKg *= 1000;
        if (Number.isFinite(gidenKg) && gidenKg > 0 && gidenKg < 500) gidenKg *= 1000;

        var tasiRaw = cols.tasiyici != null ? cell(row, cols.tasiyici) : '';
        var tasiyici = classifyTasiyici(tasiRaw);
        if (!tasiyici && blockTasiyici && blockTasiyici !== 'GPM-AKYÜZ') tasiyici = blockTasiyici;
        if (!tasiyici && classifyTasiyici(tasiRaw) === '' && blockTasiyici === 'GPM-AKYÜZ') {
          // satır boş, ortak blok — karşılaştırırken tek taraf boş sayılacak
          tasiyici = '';
        }
        var sofor = trimStr(cell(row, cols.sofor));
        var telefon = normalizeGsm(cell(row, cols.telefon));
        var soforBilgi = trimStr(cell(row, cols.soforBilgi));
        if (!sofor && soforBilgi) {
          if (foldTr(soforBilgi) === 'gelmedi') {
            sofor = '';
          } else {
            var sp = soforBilgi.split(/[-–]/);
            sofor = trimStr(sp[0] || soforBilgi);
            if (!telefon && sp[1]) telefon = normalizeGsm(sp[1]);
          }
        }
        var bbt = Math.round(parseNum(cell(row, cols.bbt)) || 0);
        var cuval = Math.round(parseNum(cell(row, cols.cuval)) || 0);
        var bosCuval = Math.round(parseNum(cell(row, cols.bosCuval)) || 0);
        // Excel'de çuval sayısı BOŞ ÇUVAL kolonunda → raporda ACIKLAMA6
        if (!cuval && bosCuval > 0) cuval = bosCuval;

        lines.push({
          irsaliye: irs,
          plaka: plaka,
          tasiyici: tasiyici,
          tasiyiciRaw: trimStr(tasiRaw) || blockTasiyici,
          sofor: sofor,
          gsm: telefon,
          soforFull: sofor + (telefon ? (' ' + telefon) : ''),
          teslimCari: liman,
          ob1: Number.isFinite(netKg) ? netKg : 0,
          kantar: Number.isFinite(gidenKg) ? gidenKg : 0,
          bbt: bbt,
          cuval: cuval
        });
      }

      var yd = normalizeYd(headerText);
      var lot = normalizeLot(headerText);
      var booking = normalizeBooking(headerText) || normalizeBooking(metaText);
      var planBbt = (totals && totals.bbt > 0) ? Math.round(totals.bbt) : extractPlanBbtFromText(headerText);
      var netKgTot = 0;
      if (totals && totals.netTonaj > 0) {
        netKgTot = totals.netTonaj < 1000 ? totals.netTonaj * 1000 : totals.netTonaj;
      }
      var headerTon = extractHeaderTon(headerText);
      var ton = netKgTot > 0 ? netKgTot / 1000 : headerTon;

      if (yd || planBbt > 0 || sip || lines.length) {
        blocks.push({
          source: 'sevkiyat',
          headerRow: headerIdx,
          headerText: headerText,
          yd: yd,
          lot: lot,
          booking: booking,
          sip: sip,
          tarih: tarih,
          teslimCari: liman,
          bbt: planBbt,
          ton: ton,
          kg: netKgTot || (headerTon > 0 ? headerTon * 1000 : 0),
          lines: lines,
          key: blockKey(tarih, sip) || matchKey({ yd: yd, lot: lot, booking: booking, sip: sip }),
          label: (sip || yd || 'Blok') + (tarih ? (' · ' + tarih) : '') + (booking ? (' · ' + booking) : '')
        });
      }
      i = Math.max(end, headerIdx + 1);
    }
    return { ok: blocks.length > 0, items: blocks, blocks: blocks, error: blocks.length ? '' : 'Sevkiyat bloğu bulunamadı (PLAKA / TOPLAM).' };
  }

  function mapNetsisCols(headerRow) {
    var map = {};
    (headerRow || []).forEach(function (cell, i) {
      var k = headerKey(cell);
      if (!k) return;
      if (k === 'sirket') map.sirket = i;
      else if (k === 'tarih') map.tarih = i;
      else if (k === 'sipno' || k === 'siparis_no') map.sipno = i;
      else if (k.indexOf('irsaliye') >= 0) map.irsaliye = i;
      else if (k === 'firma_kodu' || k.indexOf('firma') === 0) map.firma = i;
      else if (k === 'booking') map.booking = i;
      else if (k === 'stok_adi') map.stok = i;
      else if (k.indexOf('irs_miktar') === 0 || k === 'irs_miktar_ob1') map.ob1 = i;
      else if (k === 'kantar') map.kantar = i;
      else if (k === 'aciklama1') map.ac1 = i;
      else if (k === 'aciklama2') map.ac2 = i;
      else if (k === 'aciklama3') map.ac3 = i;
      else if (k === 'aciklama4') map.ac4 = i;
      else if (k === 'aciklama5') map.ac5 = i;
      else if (k === 'aciklama6') map.ac6 = i;
      else if (k === 'aciklama7') map.ac7 = i;
      else if (k === 'aciklama8') map.ac8 = i;
      else if (k === 'plaka') map.plaka = i;
      else if (k.indexOf('tasiyici_unvan') === 0 || k === 'tasiyici_unvan') map.tasiyici = i;
      else if (k.indexOf('tasiciyi_ad') === 0 || k.indexOf('tasiyici_ad') === 0) map.sofor = i;
      else if (k.indexOf('tasiyici_gsm') === 0 || k === 'tasiyici_gsm') map.gsm = i;
      else if (k === 'ft_cari_isim') map.cariIsim = i;
      else if (k === 'ft_cari_kod') map.cariKod = i;
    });
    return map;
  }

  function isNetsisHeaderRow(row) {
    var keys = (row || []).map(headerKey);
    var hasSip = keys.indexOf('sipno') >= 0 || keys.indexOf('siparis_no') >= 0;
    var hasTarih = keys.indexOf('tarih') >= 0;
    return hasSip && hasTarih;
  }

  function isNetsisStubLine(ln) {
    if (!ln) return true;
    var ob1 = Number(ln.ob1) || 0;
    var bbt = Number(ln.bbt) || 0;
    var hasPlaka = looksLikePlaka(ln.plaka);
    // Rapor: 1 kg / boş plaka / şoförsüz kayıtlar gerçek sevkiyat değil (eşlemeyi kaydırır)
    if (ob1 > 0 && ob1 <= 1 && bbt <= 0 && !hasPlaka && !trimStr(ln.sofor)) return true;
    return false;
  }

  /**
   * Netsis RR.xls tarzı düz rapor → SIPNO+TARIH blokları.
   */
  function parseNetsisGrid(grid) {
    var rows = Array.isArray(grid) ? grid : [];
    var headerIdx = -1;
    var cols = null;
    for (var i = 0; i < Math.min(rows.length, 30); i++) {
      if (isNetsisHeaderRow(rows[i])) {
        headerIdx = i;
        cols = mapNetsisCols(rows[i]);
        break;
      }
    }
    if (headerIdx < 0 || !cols || cols.sipno == null) {
      return { ok: false, blocks: [], items: [], error: 'Netsis başlığı bulunamadı (TARIH / SIPNO).' };
    }

    var byKey = Object.create(null);
    for (var r = headerIdx + 1; r < rows.length; r++) {
      var row = rows[r] || [];
      var sip = normalizeSip(cell(row, cols.sipno));
      if (!sip) continue;
      var tarih = normalizeDate(cell(row, cols.tarih));
      var key = blockKey(tarih, sip);
      if (!byKey[key]) {
        byKey[key] = {
          source: 'netsis',
          sip: sip,
          tarih: tarih,
          yd: normalizeYd(cell(row, cols.firma)),
          booking: normalizeBooking(cell(row, cols.booking)) || trimStr(cell(row, cols.booking)).replace(/^BOOK[Iİ]NG\s*NO\s*[:\.]?\s*/i, ''),
          teslimCari: trimStr(cell(row, cols.cariIsim)),
          teslimCariKod: trimStr(cell(row, cols.cariKod)),
          firma: trimStr(cell(row, cols.firma)),
          lines: [],
          bbt: 0,
          ton: 0,
          kg: 0,
          key: key,
          label: sip + (tarih ? (' · ' + tarih) : '')
        };
      }
      var blk = byKey[key];
      var ob1 = parseNum(cell(row, cols.ob1));
      var kantar = parseNum(cell(row, cols.kantar));
      var pack = netsisPackCounts(
        cell(row, cols.ac1),
        cell(row, cols.ac2),
        cell(row, cols.ac5),
        cell(row, cols.ac6)
      );
      var bbt = pack.bbt;
      var cuval = pack.cuval;
      var tasiRaw = cell(row, cols.tasiyici);
      var sofor = trimStr(cell(row, cols.sofor));
      var gsm = normalizeGsm(cell(row, cols.gsm));
      var lineObj = {
        irsaliye: displayIrsaliye(cell(row, cols.irsaliye)),
        plaka: normalizePlaka(cell(row, cols.plaka)),
        tasiyici: classifyTasiyici(tasiRaw),
        tasiyiciRaw: trimStr(tasiRaw),
        sofor: sofor,
        gsm: gsm,
        soforFull: sofor + (gsm ? (' ' + gsm) : ''),
        teslimCari: trimStr(cell(row, cols.cariIsim)) || blk.teslimCari,
        ob1: Number.isFinite(ob1) ? ob1 : 0,
        kantar: Number.isFinite(kantar) ? kantar : 0,
        bbt: bbt,
        cuval: cuval
      };
      if (isNetsisStubLine(lineObj)) continue;
      blk.lines.push(lineObj);
      blk.bbt += bbt;
      if (Number.isFinite(ob1) && ob1 > 0) blk.kg += ob1;
    }

    var blocks = Object.keys(byKey).sort().map(function (k) {
      var b = byKey[k];
      b.ton = b.kg > 0 ? b.kg / 1000 : 0;
      return b;
    });

    return {
      ok: blocks.length > 0,
      mode: 'netsis',
      blocks: blocks,
      items: blocks,
      error: blocks.length ? '' : 'Netsis satırı yok.'
    };
  }

  function itemsFromGuncel(parsed) {
    var items = (parsed && parsed.items) || [];
    return items.filter(function (it) {
      return it && (it.bbt > 0 || it.tonaj > 0);
    }).map(function (it) {
      var yd = normalizeYd(it.musteri || '');
      var booking = normalizeBooking(it.booking || '') || normalizeBooking(it.ambalaj || '');
      var sip = normalizeSip(it.sipNo || '');
      return {
        source: 'guncel',
        yd: yd,
        lot: '',
        booking: booking,
        sip: sip,
        bbt: it.bbt || 0,
        ton: it.tonaj || it.mt || 0,
        kg: (it.tonaj || it.mt || 0) * 1000,
        kind: it.kind,
        calcKg: it.calcKg,
        unitKg: it.unitKg,
        key: matchKey({ yd: yd, booking: booking, sip: sip }),
        label: (it.musteri || yd || sip || 'Satır') + (sip ? (' · ' + sip) : '')
      };
    });
  }

  function itemsFromF358Rows(rows) {
    return (rows || []).filter(function (row) {
      return row && (row.musteri || row.sipNo);
    }).map(function (row) {
      var yd = normalizeYd(row.musteri || '');
      var booking = normalizeBooking(row.bookingNo || '');
      var sip = normalizeSip(row.sipNo || '');
      var lot = normalizeLot(row.musteriKodu || row.lotNo || '');
      var bbt = parseNum(row.bigbagCuval);
      var adet = parseNum(row.adet);
      if (bbt > 0 && adet > 0 && bbt / adet >= 20) bbt = Math.round(adet);
      else if (!(bbt > 0) && adet > 0) bbt = Math.round(adet);
      else if (bbt > 0) bbt = Math.round(bbt);
      else bbt = 0;
      var mt = parseNum(row.mt);
      return {
        source: 'rapor',
        yd: yd,
        lot: lot,
        booking: booking,
        sip: sip,
        bbt: bbt,
        ton: mt > 0 ? mt : 0,
        kg: mt > 0 ? mt * 1000 : 0,
        key: matchKey({ yd: yd, lot: lot, booking: booking, sip: sip }),
        label: (row.musteri || yd || sip || 'Satır') + (sip ? (' · ' + sip) : '')
      };
    }).filter(function (it) { return it.bbt > 0 || it.ton > 0 || it.yd; });
  }

  function parseRaporGrid(grid, helpers) {
    helpers = helpers || {};
    var asNetsis = parseNetsisGrid(grid);
    if (asNetsis.ok && asNetsis.blocks.length) {
      return asNetsis;
    }
    var asSevk = parseSevkiyatGrid(grid, helpers.hintDate);
    if (asSevk.ok && asSevk.items.length) {
      return { ok: true, mode: 'sevkiyat-blocks', items: asSevk.items, blocks: asSevk.blocks, error: '' };
    }
    if (helpers.PlanV4 && typeof helpers.PlanV4.parseGuncelGrid === 'function') {
      var g = helpers.PlanV4.parseGuncelGrid(grid);
      if (g && g.ok && g.items && g.items.length) {
        return { ok: true, mode: 'guncel', items: itemsFromGuncel(g), blocks: [], error: '' };
      }
    }
    if (helpers.ExcelListCopy && typeof helpers.ExcelListCopy.solveGrid === 'function') {
      var solved = helpers.ExcelListCopy.solveGrid(grid, { startSira: 1 });
      if (solved && solved.ok && solved.rows && solved.rows.length) {
        return { ok: true, mode: 'f358', items: itemsFromF358Rows(solved.rows), blocks: [], error: '' };
      }
    }
    return { ok: false, mode: '', items: [], blocks: [], error: 'Rapor formatı tanınmadı. Netsis Excel veya Güncel / F358 yükleyin.' };
  }

  function compareField(a, b, kind) {
    var left = Number(a);
    var right = Number(b);
    if (!Number.isFinite(left)) left = 0;
    if (!Number.isFinite(right)) right = 0;
    var delta = right - left;
    if (kind === 'bbt') {
      return {
        left: left,
        right: right,
        delta: delta,
        ok: Math.round(left) === Math.round(right)
      };
    }
    if (kind === 'cuval') {
      return {
        left: left,
        right: right,
        delta: delta,
        ok: Math.abs(Math.round(left) - Math.round(right)) <= CUVAL_TOLERANCE
      };
    }
    var tol = kind === 'ton' ? KG_TOLERANCE / 1000 : KG_TOLERANCE;
    return {
      left: left,
      right: right,
      delta: delta,
      ok: Math.abs(delta) <= tol
    };
  }

  function compareText(a, b, kind) {
    var L = trimStr(a);
    var R = trimStr(b);
    if (kind === 'irsaliye') {
      L = normalizeIrsaliye(L);
      R = normalizeIrsaliye(R);
    } else if (kind === 'plaka') {
      L = normalizePlaka(L);
      R = normalizePlaka(R);
    } else if (kind === 'gsm') {
      L = normalizeGsm(L);
      R = normalizeGsm(R);
    } else if (kind === 'tasiyici') {
      L = classifyTasiyici(L) || foldTr(L);
      R = classifyTasiyici(R) || foldTr(R);
    } else if (kind === 'cari') {
      L = foldTr(L);
      R = foldTr(R);
      // Dp World Liman ↔ DP WORLD
      if (L && R && (L.indexOf(R) >= 0 || R.indexOf(L) >= 0)) {
        return { left: trimStr(a), right: trimStr(b), ok: true };
      }
      var lTok = L.replace(/[^a-z0-9]+/g, ' ');
      var rTok = R.replace(/[^a-z0-9]+/g, ' ');
      if (lTok && rTok && (lTok.indexOf(rTok) >= 0 || rTok.indexOf(lTok) >= 0)) {
        return { left: trimStr(a), right: trimStr(b), ok: true };
      }
    } else if (kind === 'sofor') {
      // Tam isim (Türkçe katlama); 1 harf farkı artık hata (FERİZ ≠ FEİZ)
      L = foldTr(L).replace(/[^a-z\s]/g, '').replace(/\s+/g, '');
      R = foldTr(R).replace(/[^a-z\s]/g, '').replace(/\s+/g, '');
    } else {
      L = foldTr(L);
      R = foldTr(R);
    }
    return { left: trimStr(a), right: trimStr(b), ok: !L && !R ? true : L === R };
  }

  function indexByKey(items) {
    var map = Object.create(null);
    (items || []).forEach(function (it) {
      var k = it.key || '';
      if (!k) {
        k = 'NOKEY:' + (it.label || Math.random());
      }
      if (!map[k]) map[k] = [];
      map[k].push(it);
    });
    return map;
  }

  function pickBestPair(leftList, rightList) {
    var used = {};
    var pairs = [];
    leftList.forEach(function (L) {
      var best = null;
      var bestScore = Infinity;
      rightList.forEach(function (R, idx) {
        if (used[idx]) return;
        var score = Math.abs((L.bbt || 0) - (R.bbt || 0));
        if (score < bestScore) {
          bestScore = score;
          best = { R: R, idx: idx };
        }
      });
      if (best) {
        used[best.idx] = true;
        pairs.push({ left: L, right: best.R });
      } else {
        pairs.push({ left: L, right: null });
      }
    });
    rightList.forEach(function (R, idx) {
      if (!used[idx]) pairs.push({ left: null, right: R });
    });
    return pairs;
  }

  function irsaliyeKey(line) {
    return normalizeIrsaliye(line && line.irsaliye);
  }

  /** Sadece irsaliye ile eşle — plaka/şoför ile yan eşleme yok (karışmasın). */
  function pairLinesByIrsaliye(leftLines, rightLines) {
    var rByIrs = Object.create(null);
    (rightLines || []).forEach(function (R, idx) {
      var k = irsaliyeKey(R);
      if (!k) return;
      if (!rByIrs[k]) rByIrs[k] = [];
      rByIrs[k].push({ R: R, idx: idx });
    });
    var used = {};
    var pairs = [];
    (leftLines || []).forEach(function (L) {
      var k = irsaliyeKey(L);
      var bucket = k ? (rByIrs[k] || []) : [];
      var hit = null;
      for (var i = 0; i < bucket.length; i++) {
        if (!used[bucket[i].idx]) {
          hit = bucket[i];
          break;
        }
      }
      if (hit) {
        used[hit.idx] = true;
        pairs.push({ left: L, right: hit.R, irsKey: k });
      } else {
        pairs.push({ left: L, right: null, irsKey: k });
      }
    });
    (rightLines || []).forEach(function (R, idx) {
      if (!used[idx]) pairs.push({ left: null, right: R, irsKey: irsaliyeKey(R) });
    });
    return pairs;
  }

  /** İrsaliye önce; plaka çakışırsa / artan satırlar plaka ile tamamlanır (stub kayması). */
  function pairLinesByIrsaliyeThenPlaka(leftLines, rightLines) {
    var initial = pairLinesByIrsaliye(leftLines, rightLines);
    var solid = [];
    var leftRem = [];
    var rightRem = [];
    initial.forEach(function (p) {
      if (p.left && p.right) {
        var lp = normalizePlaka(p.left.plaka);
        var rp = normalizePlaka(p.right.plaka);
        if ((lp || rp) && lp !== rp) {
          leftRem.push(p.left);
          rightRem.push(p.right);
        } else {
          solid.push(p);
        }
      } else if (p.left) {
        leftRem.push(p.left);
      } else if (p.right) {
        rightRem.push(p.right);
      }
    });

    var rByPlaka = Object.create(null);
    rightRem.forEach(function (R, idx) {
      var k = normalizePlaka(R && R.plaka);
      if (!k) return;
      if (!rByPlaka[k]) rByPlaka[k] = [];
      rByPlaka[k].push({ R: R, idx: idx });
    });
    var used = {};
    leftRem.forEach(function (L) {
      var k = normalizePlaka(L && L.plaka);
      var bucket = k ? (rByPlaka[k] || []) : [];
      var hit = null;
      for (var i = 0; i < bucket.length; i++) {
        if (!used[bucket[i].idx]) {
          hit = bucket[i];
          break;
        }
      }
      if (hit) {
        used[hit.idx] = true;
        solid.push({ left: L, right: hit.R, irsKey: irsaliyeKey(L) || irsaliyeKey(hit.R), matchBy: 'plaka' });
      } else {
        solid.push({ left: L, right: null, irsKey: irsaliyeKey(L) });
      }
    });
    rightRem.forEach(function (R, idx) {
      if (!used[idx]) solid.push({ left: null, right: R, irsKey: irsaliyeKey(R) });
    });
    return solid;
  }

  function pairLines(leftLines, rightLines) {
    return pairLinesByIrsaliyeThenPlaka(leftLines, rightLines);
  }

  function compareLinePair(L, R) {
    var fields = {
      irsaliye: compareText(L && L.irsaliye, R && R.irsaliye, 'irsaliye'),
      teslimCari: compareText(L && L.teslimCari, R && R.teslimCari, 'cari'),
      tasiyici: compareText(L && L.tasiyici, R && R.tasiyici, 'tasiyici'),
      ob1: compareField(L && L.ob1, R && R.ob1, 'kg'),
      kantar: compareField(L && L.kantar, R && R.kantar, 'kg'),
      sofor: compareText(L && L.sofor, R && R.sofor, 'sofor'),
      gsm: compareText(L && L.gsm, R && R.gsm, 'gsm'),
      plaka: compareText(L && L.plaka, R && R.plaka, 'plaka'),
      bbt: compareField(L && L.bbt, R && R.bbt, 'bbt'),
      cuval: compareField(L && L.cuval, R && R.cuval, 'cuval')
    };
    var ok = true;
    Object.keys(fields).forEach(function (k) {
      // Cari / taşıyıcı tek tarafta boşsa kırmızıya çekme
      if (k === 'teslimCari' && (!trimStr(L && L.teslimCari) || !trimStr(R && R.teslimCari))) {
        fields.teslimCari.ok = true;
      }
      if (k === 'tasiyici' && (!trimStr(L && L.tasiyici) || !trimStr(R && R.tasiyici))) {
        fields.tasiyici.ok = true;
      }
      // Şoför / GSM tek tarafta boşsa kırmızıya çekme (Excel GELMEDİ → boş)
      if (k === 'sofor' && (!trimStr(L && L.sofor) || !trimStr(R && R.sofor))) {
        fields.sofor.ok = true;
      }
      if (k === 'gsm' && (!trimStr(L && L.gsm) || !trimStr(R && R.gsm))) {
        fields.gsm.ok = true;
      }
      // Kantar / OB1 tek tarafta 0 veya boşsa fark sayma (Excel henüz çıkmamış)
      if (k === 'kantar' && (isBlankKg(L && L.kantar) || isBlankKg(R && R.kantar))) {
        fields.kantar.ok = true;
      }
      if (k === 'ob1' && (isBlankKg(L && L.ob1) || isBlankKg(R && R.ob1))) {
        fields.ob1.ok = true;
      }
      if (!fields[k].ok) ok = false;
    });
    return { fields: fields, ok: ok };
  }

  function resolveBlockPairKey(block) {
    if (block.sip) return blockKey(block.tarih, block.sip);
    return block.key || '';
  }

  function flattenBlockLines(blocks, side) {
    var out = [];
    (blocks || []).forEach(function (b, bi) {
      (b.lines || []).forEach(function (ln, li) {
        out.push({
          side: side,
          block: b,
          blockIdx: bi,
          lineIdx: li,
          line: ln,
          sip: b.sip || '',
          tarih: b.tarih || '',
          irsKey: irsaliyeKey(ln)
        });
      });
    });
    return out;
  }

  /**
   * Ana eşleme: İRSALİYE NO; plaka uyuşmazsa / kalanlar plaka ile.
   * Kapsam: sadece Excel’deki SIPNO’lar (tüm Netsis yılı dökülmez).
   */
  function diffSipBlocks(leftBlocks, rightBlocks) {
    var excelLines = flattenBlockLines(rightBlocks, 'excel');
    var netsisLines = flattenBlockLines(leftBlocks, 'netsis');

    var scopeSips = Object.create(null);
    var scopeDates = Object.create(null);
    excelLines.forEach(function (x) {
      if (x.sip) scopeSips[x.sip] = true;
      if (x.tarih) scopeDates[x.tarih] = true;
    });
    (rightBlocks || []).forEach(function (b) {
      if (b.sip) scopeSips[b.sip] = true;
      if (b.tarih) scopeDates[b.tarih] = true;
    });

    var hasScope = Object.keys(scopeSips).length > 0;
    var scopedNetsis = netsisLines.filter(function (n) {
      if (!hasScope) return true;
      if (n.sip && scopeSips[n.sip]) return true;
      // SIPNO yoksa: Excel irsaliye setine düşenler ayrıca eşleşir
      return false;
    });

    var netsisByIrs = Object.create(null);
    scopedNetsis.forEach(function (n, idx) {
      var k = n.irsKey;
      if (!k) return;
      if (!netsisByIrs[k]) netsisByIrs[k] = [];
      netsisByIrs[k].push({ n: n, idx: idx });
    });
    // Kapsam dışı ama Excel irsaliyesiyle birebir gelen Netsis satırları da al
    netsisLines.forEach(function (n, idx) {
      if (hasScope && n.sip && scopeSips[n.sip]) return; // zaten scoped
      var k = n.irsKey;
      if (!k) return;
      var needed = excelLines.some(function (x) { return x.irsKey === k; });
      if (!needed) return;
      if (!netsisByIrs[k]) netsisByIrs[k] = [];
      // duplicate idx koruması
      if (netsisByIrs[k].some(function (x) { return x.n === n; })) return;
      netsisByIrs[k].push({ n: n, idx: 'x' + idx });
    });

    var usedN = {};
    var lineResults = [];
    var matchedOkLines = 0;
    var matchedBadLines = 0;
    var onlyLeftLines = 0;
    var onlyRightLines = 0;

    excelLines.forEach(function (x) {
      var k = x.irsKey;
      var bucket = k ? (netsisByIrs[k] || []) : [];
      var hit = null;
      var hitSip = null;
      for (var i = 0; i < bucket.length; i++) {
        var id = String(bucket[i].idx);
        if (usedN[id]) continue;
        if (!hit) hit = bucket[i];
        if (x.sip && bucket[i].n.sip === x.sip) {
          hitSip = bucket[i];
          break;
        }
      }
      hit = hitSip || hit;
      if (hit) {
        usedN[String(hit.idx)] = true;
        lineResults.push({
          status: 'pending',
          irsKey: k,
          sip: x.sip || hit.n.sip,
          tarih: x.tarih || hit.n.tarih,
          left: hit.n.line,
          right: x.line,
          leftMeta: hit.n,
          rightMeta: x,
          usedIdx: String(hit.idx)
        });
      } else {
        lineResults.push({
          status: 'only-right',
          irsKey: k,
          sip: x.sip,
          tarih: x.tarih,
          left: null,
          right: x.line,
          leftMeta: null,
          rightMeta: x,
          usedIdx: null
        });
      }
    });

    scopedNetsis.forEach(function (n, idx) {
      if (usedN[String(idx)]) return;
      if (!n.irsKey) return;
      lineResults.push({
        status: 'only-left',
        irsKey: n.irsKey,
        sip: n.sip,
        tarih: n.tarih,
        left: n.line,
        right: null,
        leftMeta: n,
        rightMeta: null,
        usedIdx: String(idx)
      });
    });

    // İrsaliye eşleşmesinde plaka çakışırsa / kalanlar → plaka ile yeniden eşle
    var kept = [];
    var leftRem = [];
    var rightRem = [];
    lineResults.forEach(function (lr) {
      if (lr.left && lr.right) {
        var lp = normalizePlaka(lr.left.plaka);
        var rp = normalizePlaka(lr.right.plaka);
        // Plaka yok / farklı → irsaliye kayması olabilir; plaka turuna bırak
        if ((lp || rp) && lp !== rp) {
          leftRem.push({ meta: lr.leftMeta, line: lr.left });
          rightRem.push({ meta: lr.rightMeta, line: lr.right });
          if (lr.usedIdx) delete usedN[lr.usedIdx];
        } else {
          kept.push(lr);
        }
      } else if (lr.left && lr.leftMeta) {
        leftRem.push({ meta: lr.leftMeta, line: lr.left });
        if (lr.usedIdx) delete usedN[lr.usedIdx];
      } else if (lr.right && lr.rightMeta) {
        rightRem.push({ meta: lr.rightMeta, line: lr.right });
      }
    });

    var rByPlaka = Object.create(null);
    rightRem.forEach(function (item, idx) {
      var pk = normalizePlaka(item.line && item.line.plaka);
      if (!pk) return;
      if (!rByPlaka[pk]) rByPlaka[pk] = [];
      rByPlaka[pk].push({ item: item, idx: idx });
    });
    var usedR = {};
    leftRem.forEach(function (L) {
      var pk = normalizePlaka(L.line && L.line.plaka);
      var bucket = pk ? (rByPlaka[pk] || []) : [];
      var hit = null;
      for (var i = 0; i < bucket.length; i++) {
        if (!usedR[bucket[i].idx]) {
          hit = bucket[i];
          break;
        }
      }
      if (hit) {
        usedR[hit.idx] = true;
        kept.push({
          status: 'pending',
          irsKey: irsaliyeKey(L.line) || irsaliyeKey(hit.item.line),
          sip: (L.meta && L.meta.sip) || (hit.item.meta && hit.item.meta.sip),
          tarih: (L.meta && L.meta.tarih) || (hit.item.meta && hit.item.meta.tarih),
          left: L.line,
          right: hit.item.line,
          leftMeta: L.meta,
          rightMeta: hit.item.meta,
          matchBy: 'plaka'
        });
      } else {
        kept.push({
          status: 'only-left',
          irsKey: irsaliyeKey(L.line),
          sip: L.meta && L.meta.sip,
          tarih: L.meta && L.meta.tarih,
          left: L.line,
          right: null,
          leftMeta: L.meta,
          rightMeta: null
        });
      }
    });
    rightRem.forEach(function (R, idx) {
      if (usedR[idx]) return;
      kept.push({
        status: 'only-right',
        irsKey: irsaliyeKey(R.line),
        sip: R.meta && R.meta.sip,
        tarih: R.meta && R.meta.tarih,
        left: null,
        right: R.line,
        leftMeta: null,
        rightMeta: R.meta
      });
    });

    matchedOkLines = 0;
    matchedBadLines = 0;
    onlyLeftLines = 0;
    onlyRightLines = 0;
    lineResults = kept.map(function (lr) {
      if (lr.left && lr.right) {
        var cmp = compareLinePair(lr.left, lr.right);
        // Plaka ile toparlanan satırlarda irsaliye numarası kaymış olabilir — şoför/plaka asıl kontrol
        if (lr.matchBy === 'plaka' && cmp.fields && cmp.fields.irsaliye) {
          cmp.fields.irsaliye.ok = true;
          cmp.ok = true;
          Object.keys(cmp.fields).forEach(function (fk) {
            if (!cmp.fields[fk].ok) cmp.ok = false;
          });
        }
        lr.cmp = cmp;
        lr.status = cmp.ok ? 'ok' : 'bad';
        if (lr.status === 'ok') matchedOkLines += 1;
        else matchedBadLines += 1;
      } else if (lr.left) {
        lr.cmp = compareLinePair(lr.left, null);
        lr.status = 'only-left';
        onlyLeftLines += 1;
      } else {
        lr.cmp = compareLinePair(null, lr.right);
        lr.status = 'only-right';
        onlyRightLines += 1;
      }
      return lr;
    });

    // SIPNO (+tarih) ile bloklara grupla — gösterim için
    var byBlock = Object.create(null);
    lineResults.forEach(function (lr) {
      var sip = lr.sip || '—';
      var tarih = lr.tarih || '';
      var bk = (tarih ? tarih + '|' : '') + sip;
      if (!byBlock[bk]) {
        byBlock[bk] = {
          sip: sip === '—' ? '' : sip,
          tarih: tarih,
          label: (sip === '—' ? 'İrsaliye' : sip) + (tarih ? (' · ' + tarih) : ''),
          lines: [],
          left: null,
          right: null
        };
      }
      byBlock[bk].lines.push(lr);
      if (lr.leftMeta && lr.leftMeta.block) byBlock[bk].left = lr.leftMeta.block;
      if (lr.rightMeta && lr.rightMeta.block) byBlock[bk].right = lr.rightMeta.block;
    });

    var blockRows = Object.keys(byBlock).sort().map(function (bk) {
      var blk = byBlock[bk];
      blk.lines.sort(function (a, b) {
        return String(a.irsKey || '').localeCompare(String(b.irsKey || ''));
      });
      var hasBad = blk.lines.some(function (x) { return x.status === 'bad'; });
      var hasMiss = blk.lines.some(function (x) {
        return x.status === 'only-left' || x.status === 'only-right';
      });
      var allOk = blk.lines.every(function (x) { return x.status === 'ok'; });
      blk.status = allOk ? 'ok' : (hasBad || hasMiss ? 'bad' : 'miss');
      return blk;
    });

    var matchedOk = blockRows.filter(function (b) { return b.status === 'ok'; }).length;
    var matchedBad = blockRows.filter(function (b) { return b.status === 'bad'; }).length;
    var onlyLeft = blockRows.filter(function (b) {
      return b.lines.length && b.lines.every(function (l) { return l.status === 'only-left'; });
    }).length;
    var onlyRight = blockRows.filter(function (b) {
      return b.lines.length && b.lines.every(function (l) { return l.status === 'only-right'; });
    }).length;

    return {
      mode: 'sip-blocks',
      matchBy: 'irsaliye',
      blocks: blockRows,
      rows: blockRows,
      summary: {
        matchedOk: matchedOk,
        matchedBad: matchedBad,
        onlyLeft: onlyLeft,
        onlyRight: onlyRight,
        total: blockRows.length,
        lineOk: matchedOkLines,
        lineBad: matchedBadLines,
        lineOnlyLeft: onlyLeftLines,
        lineOnlyRight: onlyRightLines
      }
    };
  }

  function diffReports(leftItems, rightItems) {
    if ((leftItems || []).some(function (x) { return x && Array.isArray(x.lines); }) &&
        (rightItems || []).some(function (x) { return x && Array.isArray(x.lines); })) {
      return diffSipBlocks(leftItems, rightItems);
    }

    var L = indexByKey(leftItems);
    var R = indexByKey(rightItems);
    var keys = {};
    Object.keys(L).forEach(function (k) { keys[k] = true; });
    Object.keys(R).forEach(function (k) { keys[k] = true; });

    var rows = [];
    var okCount = 0;
    var badCount = 0;
    var onlyLeft = 0;
    var onlyRight = 0;

    Object.keys(keys).sort().forEach(function (k) {
      if (k.indexOf('NOKEY:') === 0) {
        (L[k] || []).forEach(function (it) {
          onlyLeft += 1;
          rows.push({
            key: k,
            label: it.label,
            status: 'only-left',
            bbt: compareField(it.bbt, NaN, 'bbt'),
            ton: compareField(it.ton, NaN, 'ton'),
            left: it,
            right: null
          });
        });
        (R[k] || []).forEach(function (it) {
          onlyRight += 1;
          rows.push({
            key: k,
            label: it.label,
            status: 'only-right',
            bbt: compareField(NaN, it.bbt, 'bbt'),
            ton: compareField(NaN, it.ton, 'ton'),
            left: null,
            right: it
          });
        });
        return;
      }

      var pairs = pickBestPair(L[k] || [], R[k] || []);
      pairs.forEach(function (p) {
        if (p.left && !p.right) {
          onlyLeft += 1;
          rows.push({
            key: k,
            label: p.left.label,
            status: 'only-left',
            bbt: compareField(p.left.bbt, NaN, 'bbt'),
            ton: compareField(p.left.ton, NaN, 'ton'),
            left: p.left,
            right: null
          });
          return;
        }
        if (!p.left && p.right) {
          onlyRight += 1;
          rows.push({
            key: k,
            label: p.right.label,
            status: 'only-right',
            bbt: compareField(NaN, p.right.bbt, 'bbt'),
            ton: compareField(NaN, p.right.ton, 'ton'),
            left: null,
            right: p.right
          });
          return;
        }
        var bbt = compareField(p.left.bbt, p.right.bbt, 'bbt');
        var ton = compareField(p.left.ton, p.right.ton, 'ton');
        var status = (bbt.ok && ton.ok) ? 'ok' : 'bad';
        if (status === 'ok') okCount += 1;
        else badCount += 1;
        rows.push({
          key: k,
          label: p.left.label || p.right.label,
          status: status,
          bbt: bbt,
          ton: ton,
          left: p.left,
          right: p.right
        });
      });
    });

    return {
      rows: rows,
      summary: {
        matchedOk: okCount,
        matchedBad: badCount,
        onlyLeft: onlyLeft,
        onlyRight: onlyRight,
        total: rows.length
      }
    };
  }

  function formatTon(n) {
    if (!(Number.isFinite(n))) return '—';
    var fixed = Number(n).toFixed(3).replace(/\.?0+$/, '');
    return fixed.replace('.', ',');
  }

  function formatKg(n) {
    if (!(Number.isFinite(n)) || n === 0) return '—';
    return String(Math.round(n));
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function cellCls(ok) {
    return ok ? 'sk-cell--ok' : 'sk-cell--bad';
  }

  function isBlankDisplay(v) {
    if (v == null) return true;
    if (typeof v === 'number') return !Number.isFinite(v) || v === 0;
    var s = trimStr(v);
    return !s || s === '—' || foldTr(s) === 'gelmedi';
  }

  function isBlankKg(v) {
    var n = Number(v);
    return !Number.isFinite(n) || n === 0;
  }

  function formatCount(n) {
    if (!(Number.isFinite(n)) || n === 0) return '—';
    return String(Math.round(n));
  }

  /** Sadece iki tarafta da değer varken ve farklıysa kırmızı. */
  function pairCell(leftVal, rightVal, ok, formatter) {
    var leftBlank = isBlankDisplay(leftVal);
    var rightBlank = isBlankDisplay(rightVal);
    var fmt = formatter || function (v) { return escapeHtml(trimStr(v)); };
    var L = leftBlank ? '—' : fmt(leftVal);
    var R = rightBlank ? '—' : fmt(rightVal);
    var both = !leftBlank && !rightBlank;
    var cls = 'sk-cell--quiet';
    if (both && !ok) cls = 'sk-cell--bad';
    else if (both && ok) cls = 'sk-cell--ok';
    return '<td class="sk-pair ' + cls + '">' +
      '<div class="sk-pair__inner">' +
      '<span class="sk-pair__n" title="Netsis">' + L + '</span>' +
      '<span class="sk-pair__e" title="Excel">' + R + '</span>' +
      '</div>' +
      '</td>';
  }

  function formatSofor(line) {
    if (!line) return '';
    var name = trimStr(line.sofor);
    if (!name || foldTr(name) === 'gelmedi') name = '';
    var gsm = trimStr(line.gsm);
    if (!name && !gsm) return '';
    return name + (gsm ? ((name ? ' ' : '') + gsm) : '');
  }

  function extractPoPfkLabel(text) {
    var s = trimStr(text);
    if (!s) return '';
    var parts = [];
    var yd = normalizeYd(s);
    if (yd) parts.push(yd);
    var lot = s.match(/LOT\s*NO\s*[\d\s\-]+/i);
    if (lot) parts.push(trimStr(lot[0]).replace(/\s+/g, ' '));
    var pfk = s.match(/PFK[-\s]?[A-Z0-9\-()]+/i);
    if (pfk) parts.push(trimStr(pfk[0]));
    var po = s.match(/PO\s*(?:NO\s*)?[:\.]?\s*[A-Z0-9\-()]+/i);
    if (po) parts.push(trimStr(po[0]).replace(/\s+/g, ' '));
    return parts.join(' · ') || s.slice(0, 80);
  }

  function shortenTitle(text, maxLen) {
    var s = trimStr(text).replace(/\s+/g, ' ');
    if (!s) return '';
    maxLen = maxLen || 120;
    if (s.length <= maxLen) return s;
    return s.slice(0, maxLen - 1) + '…';
  }

  function sumField(lines, side, field) {
    var total = 0;
    (lines || []).forEach(function (ln) {
      var row = side === 'left' ? ln.left : ln.right;
      if (!row) return;
      var n = Number(row[field]);
      if (Number.isFinite(n)) total += n;
    });
    return total;
  }

  function renderSipDiffHtml(diff) {
    var html = '';
    (diff.blocks || []).forEach(function (blk) {
      var st = blk.status === 'ok' ? 'ok' : (blk.status === 'bad' ? 'bad' : 'miss');
      var stLabel = blk.status === 'ok' ? 'TUTUYOR' : (blk.status === 'bad' ? 'FARK VAR' : (blk.status === 'only-left' ? 'SADECE NETSİS' : 'SADECE EXCEL'));
      var cari = (blk.right && blk.right.teslimCari) || (blk.left && blk.left.teslimCari) || '';
      var raporTitle = (blk.left && (blk.left.firma || blk.left.headerText)) || '';
      var excelTitle = (blk.right && (blk.right.headerText || blk.right.firma)) || '';
      var raporShort = extractPoPfkLabel(raporTitle) || (blk.left && blk.left.yd) || '';
      var excelShort = extractPoPfkLabel(excelTitle) || (blk.right && blk.right.yd) || '';

      var totBbtN = sumField(blk.lines, 'left', 'bbt');
      var totBbtE = sumField(blk.lines, 'right', 'bbt');
      var totCuvalN = sumField(blk.lines, 'left', 'cuval');
      var totCuvalE = sumField(blk.lines, 'right', 'cuval');
      var totOb1N = sumField(blk.lines, 'left', 'ob1');
      var totOb1E = sumField(blk.lines, 'right', 'ob1');
      var totKantN = sumField(blk.lines, 'left', 'kantar');
      var totKantE = sumField(blk.lines, 'right', 'kantar');
      var bbtOk = Math.round(totBbtN) === Math.round(totBbtE);
      var cuvalOk = Math.abs(Math.round(totCuvalN) - Math.round(totCuvalE)) <= CUVAL_TOLERANCE;
      var ob1Ok = Math.abs(totOb1N - totOb1E) <= KG_TOLERANCE;
      var kantOk = Math.abs(totKantN - totKantE) <= KG_TOLERANCE;
      var totalsBad = !(bbtOk && cuvalOk && ob1Ok && kantOk);

      html += '<section class="sk-block sk-block--' + st + ' sk-block--flat">';
      html += '<header class="sk-block__head">' +
        '<span class="sk-badge sk-badge--' + st + '">' + stLabel + '</span>' +
        '<strong>' + escapeHtml(blk.sip || '—') + '</strong>' +
        (blk.tarih ? '<em>' + escapeHtml(blk.tarih) + '</em>' : '') +
        (cari ? '<span class="sk-chip sk-chip--muted">' + escapeHtml(cari) + '</span>' : '') +
        '<span class="sk-block__meta">' + (blk.lines || []).length + ' irsaliye</span>' +
        '</header>';

      html += '<div class="sk-titles">' +
        '<div class="sk-title-row"><span class="sk-title-lab">Rapor</span><b>' + escapeHtml(raporShort || '—') + '</b>' +
        (raporTitle ? '<span class="sk-title-full" title="' + escapeHtml(raporTitle) + '">' + escapeHtml(shortenTitle(raporTitle, 100)) + '</span>' : '') +
        '</div>' +
        '<div class="sk-title-row"><span class="sk-title-lab">Excel</span><b>' + escapeHtml(excelShort || '—') + '</b>' +
        (excelTitle ? '<span class="sk-title-full" title="' + escapeHtml(excelTitle) + '">' + escapeHtml(shortenTitle(excelTitle, 100)) + '</span>' : '') +
        '</div>' +
        '</div>';

      html += '<div class="sk-table-wrap"><table class="sk-table sk-table--flat"><thead><tr>' +
        '<th>Durum</th>' +
        '<th>İrsaliye</th>' +
        '<th>Plaka<br><small>N · E</small></th>' +
        '<th>Cari / Liman<br><small>N · E</small></th>' +
        '<th>Taşıyıcı<br><small>N · E</small></th>' +
        '<th>BBT<br><small>N · E</small></th>' +
        '<th>Çuval<br><small>N · E</small></th>' +
        '<th>OB1 / NET<br><small>N · E</small></th>' +
        '<th>Kantar / Giden<br><small>N · E</small></th>' +
        '<th>Şoför<br><small>N · E</small></th>' +
        '</tr></thead><tbody>';

      (blk.lines || []).forEach(function (ln) {
        var lst = ln.status === 'ok' ? 'ok' : (ln.status === 'bad' ? 'bad' : 'miss');
        var f = (ln.cmp && ln.cmp.fields) || {};
        var irsShow = (ln.right && ln.right.irsaliye) || (ln.left && ln.left.irsaliye) || '—';
        var soforN = formatSofor(ln.left);
        var soforE = formatSofor(ln.right);

        html += '<tr class="sk-row sk-row--' + lst + '">' +
          '<td><span class="sk-badge sk-badge--' + lst + '">' +
          (ln.status === 'ok' ? 'OK' : (ln.status === 'bad' ? 'FARK' : (ln.status === 'only-left' ? 'N' : 'E'))) +
          '</span></td>' +
          '<td class="sk-irs"><strong>' + escapeHtml(irsShow) + '</strong></td>' +
          pairCell(ln.left && ln.left.plaka, ln.right && ln.right.plaka, !f.plaka || f.plaka.ok) +
          pairCell(ln.left && ln.left.teslimCari, ln.right && ln.right.teslimCari, !f.teslimCari || f.teslimCari.ok) +
          pairCell(ln.left && ln.left.tasiyici, ln.right && ln.right.tasiyici, !f.tasiyici || f.tasiyici.ok) +
          pairCell(ln.left && ln.left.bbt, ln.right && ln.right.bbt, !f.bbt || f.bbt.ok, formatCount) +
          pairCell(ln.left && ln.left.cuval, ln.right && ln.right.cuval, !f.cuval || f.cuval.ok, formatCount) +
          pairCell(ln.left && ln.left.ob1, ln.right && ln.right.ob1, !f.ob1 || f.ob1.ok, formatKg) +
          pairCell(ln.left && ln.left.kantar, ln.right && ln.right.kantar, !f.kantar || f.kantar.ok, formatKg) +
          pairCell(soforN, soforE, (!f.sofor || f.sofor.ok) && (!f.gsm || f.gsm.ok)) +
          '</tr>';
      });

      html += '</tbody><tfoot><tr class="sk-total-row' + (totalsBad ? ' sk-total-row--bad' : ' sk-total-row--ok') + '">' +
        '<td colspan="5"><strong>TOPLAM</strong></td>' +
        pairCell(totBbtN, totBbtE, bbtOk, formatCount) +
        pairCell(totCuvalN, totCuvalE, cuvalOk, formatCount) +
        pairCell(totOb1N, totOb1E, ob1Ok, formatKg) +
        pairCell(totKantN, totKantE, kantOk, formatKg) +
        '<td></td>' +
        '</tr></tfoot></table></div>';

      html += '</section>';
    });
    return html || '<p class="sk-empty">Eşleşen blok yok.</p>';
  }

  async function loadXlsx() {
    if (typeof root.ensureXlsxLoaded === 'function') {
      await root.ensureXlsxLoaded();
    } else if (typeof XLSX === 'undefined') {
      await new Promise(function (resolve, reject) {
        var s = document.createElement('script');
        s.src = '/vendor/xlsx.full.min.js';
        s.onload = function () { resolve(true); };
        s.onerror = function () {
          var s2 = document.createElement('script');
          s2.src = 'https://cdn.jsdelivr.net/npm/xlsx/dist/xlsx.full.min.js';
          s2.onload = function () { resolve(true); };
          s2.onerror = reject;
          document.head.appendChild(s2);
        };
        document.head.appendChild(s);
      });
    }
    if (typeof XLSX === 'undefined') throw new Error('Excel okuyucu yüklenemedi');
  }

  async function workbookFromFile(file) {
    await loadXlsx();
    var buf = await file.arrayBuffer();
    return XLSX.read(buf, { type: 'array', cellDates: true });
  }

  function firstSheetGrid(wb, preferNames) {
    var names = wb.SheetNames || [];
    var pick = names[0];
    (preferNames || []).forEach(function (want) {
      var hit = names.find(function (n) { return foldTr(n).indexOf(foldTr(want)) >= 0; });
      if (hit) pick = hit;
    });
    return {
      name: pick,
      grid: XLSX.utils.sheet_to_json(wb.Sheets[pick], { header: 1, defval: '', blankrows: false })
    };
  }

  function bindAppUi(opts) {
    opts = opts || {};
    var toast = typeof opts.toast === 'function' ? opts.toast : function () {};
    var mode = 'rapor'; // rapor | guncel
    var state = { left: null, right: null, diff: null, leftFileName: '', rightFileName: '' };

    var tabs = document.getElementById('skTabs');
    var leftFile = document.getElementById('skLeftFile');
    var rightFile = document.getElementById('skRightFile');
    var leftName = document.getElementById('skLeftName');
    var rightName = document.getElementById('skRightName');
    var leftLabel = document.getElementById('skLeftLabel');
    var rightLabel = document.getElementById('skRightLabel');
    var statusEl = document.getElementById('skStatus');
    var summaryEl = document.getElementById('skSummary');
    var tableEl = document.getElementById('skTable');
    var runBtn = document.getElementById('skRunBtn');
    var homeBtn = document.getElementById('skHomeBtn');

    function setStatus(msg, isErr) {
      if (!statusEl) return;
      statusEl.textContent = msg || '';
      statusEl.className = 'sk-status' + (isErr ? ' is-err' : '');
    }

    function updateModeLabels() {
      if (mode === 'guncel') {
        if (leftLabel) leftLabel.textContent = '1) Güncel İhracat Listesi.xlsx';
        if (rightLabel) rightLabel.textContent = '2) Sevkiyat / ihracat Excel’in.xlsx';
      } else {
        if (leftLabel) leftLabel.textContent = '1) Netsis raporu (RR.xls / .xlsx)';
        if (rightLabel) rightLabel.textContent = '2) Güncel sevkiyat Excel (YD blokları)';
      }
    }

    function renderDiff() {
      if (!tableEl || !summaryEl) return;
      var d = state.diff;
      if (!d) {
        summaryEl.innerHTML = '';
        tableEl.innerHTML = '<p class="sk-empty">İki dosyayı yükle → Kontrol et.</p>';
        return;
      }
      var s = d.summary;
      summaryEl.innerHTML =
        '<span class="sk-pill sk-pill--ok">Tutuyor: ' + s.matchedOk + '</span>' +
        '<span class="sk-pill sk-pill--bad">Tutmuyor: ' + s.matchedBad + '</span>' +
        '<span class="sk-pill">Sadece Netsis: ' + s.onlyLeft + '</span>' +
        '<span class="sk-pill">Sadece Excel: ' + s.onlyRight + '</span>' +
        (s.lineOk != null
          ? ('<span class="sk-pill sk-pill--ok">İrsaliye OK: ' + s.lineOk + '</span>' +
            '<span class="sk-pill sk-pill--bad">İrsaliye fark: ' + (s.lineBad || 0) + '</span>')
          : '');

      if (d.mode === 'sip-blocks') {
        tableEl.innerHTML = renderSipDiffHtml(d);
        return;
      }

      var html = '<div class="sk-table-wrap"><table class="sk-table"><thead><tr>' +
        '<th>Durum</th><th>Satır</th><th>BBT (sol)</th><th>BBT (sağ)</th><th>Ton (sol)</th><th>Ton (sağ)</th>' +
        '</tr></thead><tbody>';
      d.rows.forEach(function (row) {
        var st = row.status === 'ok' ? 'ok' : (row.status === 'bad' ? 'bad' : 'miss');
        var stLabel = row.status === 'ok' ? 'TUTUYOR' : (row.status === 'bad' ? 'TUTMUYOR' : (row.status === 'only-left' ? 'SADECE SOL' : 'SADECE SAĞ'));
        html += '<tr class="sk-row sk-row--' + st + '">' +
          '<td><span class="sk-badge sk-badge--' + st + '">' + stLabel + '</span></td>' +
          '<td>' + escapeHtml(row.label) + '</td>' +
          '<td>' + (row.left ? Math.round(row.bbt.left) : '—') + '</td>' +
          '<td>' + (row.right ? Math.round(row.bbt.right) : '—') + '</td>' +
          '<td>' + (row.left ? formatTon(row.ton.left) : '—') + '</td>' +
          '<td>' + (row.right ? formatTon(row.ton.right) : '—') + '</td>' +
          '</tr>';
      });
      html += '</tbody></table></div>';
      tableEl.innerHTML = html;
    }

    async function loadLeft(file) {
      if (!file) return;
      state.leftFileName = file.name || '';
      if (leftName) leftName.textContent = file.name;
      var wb = await workbookFromFile(file);
      var sheet = firstSheetGrid(wb, mode === 'guncel' ? ['guncel'] : ['rapor', 'sheet']);
      var helpers = {
        PlanV4: root.PlanV4,
        ExcelListCopy: root.ExcelListCopy,
        hintDate: extractDateFromName(file.name) || extractDateFromName(sheet.name)
      };
      var parsed;
      if (mode === 'guncel') {
        if (!root.PlanV4) throw new Error('PlanV4 yok');
        var g = root.PlanV4.parseGuncelGrid(sheet.grid);
        if (!g.ok) throw new Error(g.error || 'Güncel okunamadı');
        parsed = { ok: true, items: itemsFromGuncel(g), blocks: [], mode: 'guncel' };
      } else {
        parsed = parseRaporGrid(sheet.grid, helpers);
      }
      if (!parsed.ok) throw new Error(parsed.error || 'Sol dosya okunamadı');
      state.left = parsed;
      setStatus('Sol: ' + sheet.name + ' · ' + (parsed.blocks || parsed.items).length + ' blok/kalem (' + (parsed.mode || mode) + ')');
    }

    async function loadRight(file) {
      if (!file) return;
      state.rightFileName = file.name || '';
      if (rightName) rightName.textContent = file.name;
      var wb = await workbookFromFile(file);
      var sheet = firstSheetGrid(wb, ['sevkiyat', 'ihracat', 'takip']);
      var hintDate = extractDateFromName(file.name) || extractDateFromName(sheet.name);
      var parsed = parseSevkiyatGrid(sheet.grid, hintDate);
      if (!parsed.ok) {
        if (root.PlanV4) {
          var g = root.PlanV4.parseGuncelGrid(sheet.grid);
          if (g.ok && g.items.length) {
            parsed = { ok: true, items: itemsFromGuncel(g), blocks: [], error: '' };
          }
        }
      }
      if (!parsed.ok) throw new Error(parsed.error || 'Sağ dosya okunamadı');
      state.right = parsed;
      setStatus((statusEl && statusEl.textContent ? statusEl.textContent + ' · ' : '') +
        'Sağ: ' + sheet.name + ' · ' + (parsed.blocks || parsed.items).length + ' blok/kalem' +
        (hintDate ? (' · tarih ' + hintDate) : ''));
    }

    function runCompare() {
      if (!state.left || !state.right) {
        setStatus('Önce iki dosyayı da yükle.', true);
        return;
      }
      var leftBlocks = state.left.blocks && state.left.blocks.length
        ? state.left.blocks
        : state.left.items;
      var rightBlocks = state.right.blocks && state.right.blocks.length
        ? state.right.blocks
        : state.right.items;
      state.diff = diffReports(leftBlocks, rightBlocks);
      renderDiff();
      var s = state.diff.summary;
      if (s.matchedBad === 0 && s.onlyLeft === 0 && s.onlyRight === 0) {
        setStatus('Tamam — sipariş blokları tutuyor.');
        toast('Sayı kontrol: tutuyor.');
      } else {
        setStatus('Fark var — kırmızı satırlara bak (' + s.matchedBad + ' blok / ' + s.onlyLeft + '+' + s.onlyRight + ' tek taraf).', true);
        toast('Sayı kontrol: fark bulundu.', true);
      }
    }

    if (tabs) {
      tabs.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-sk-mode]');
        if (!btn) return;
        mode = btn.getAttribute('data-sk-mode') || 'rapor';
        tabs.querySelectorAll('[data-sk-mode]').forEach(function (b) {
          b.classList.toggle('is-active', b === btn);
        });
        state.left = null;
        state.right = null;
        state.diff = null;
        if (leftName) leftName.textContent = 'Dosya seçilmedi';
        if (rightName) rightName.textContent = 'Dosya seçilmedi';
        if (leftFile) leftFile.value = '';
        if (rightFile) rightFile.value = '';
        updateModeLabels();
        renderDiff();
        setStatus('Mod: ' + (mode === 'guncel' ? 'Güncel ↔ Sevkiyat' : 'Netsis ↔ Güncel Excel'));
      });
    }
    if (leftFile) {
      leftFile.addEventListener('change', function () {
        loadLeft(leftFile.files && leftFile.files[0]).catch(function (err) {
          setStatus(err.message || 'Sol okunamadı', true);
        });
      });
    }
    if (rightFile) {
      rightFile.addEventListener('change', function () {
        loadRight(rightFile.files && rightFile.files[0]).catch(function (err) {
          setStatus(err.message || 'Sağ okunamadı', true);
        });
      });
    }
    if (runBtn) runBtn.addEventListener('click', runCompare);
    if (homeBtn) {
      homeBtn.addEventListener('click', function () {
        if (root.SessionManager && root.SessionManager.navigateToHome) root.SessionManager.navigateToHome();
        else location.href = 'GIRIS.html';
      });
    }

    updateModeLabels();
    renderDiff();
  }

  var api = {
    KG_TOLERANCE: KG_TOLERANCE,
    parseNum: parseNum,
    normalizeYd: normalizeYd,
    normalizeLot: normalizeLot,
    normalizeBooking: normalizeBooking,
    normalizeSip: normalizeSip,
    normalizeIrsaliye: normalizeIrsaliye,
    normalizeDate: normalizeDate,
    classifyTasiyici: classifyTasiyici,
    extractNetsisSip: extractNetsisSip,
    matchKey: matchKey,
    blockKey: blockKey,
    parseSevkiyatGrid: parseSevkiyatGrid,
    parseNetsisGrid: parseNetsisGrid,
    parseRaporGrid: parseRaporGrid,
    itemsFromGuncel: itemsFromGuncel,
    itemsFromF358Rows: itemsFromF358Rows,
    compareField: compareField,
    compareText: compareText,
    compareLinePair: compareLinePair,
    diffReports: diffReports,
    diffSipBlocks: diffSipBlocks,
    pairLines: pairLines,
    formatTon: formatTon,
    bindAppUi: bindAppUi
  };

  if (typeof root !== 'undefined') root.SayiKontrol = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : typeof global !== 'undefined' ? global : this);
