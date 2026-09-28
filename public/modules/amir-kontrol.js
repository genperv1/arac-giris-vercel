// amir-kontrol.js — Netsis raporu ↔ amir irsaliye Excel, tarih aralığı
(function (root) {
  'use strict';

  function sk() {
    return root.SayiKontrol || null;
  }

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

  function headerKey(value) {
    return foldTr(value).replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  }

  function stampFromTr(value) {
    var api = sk();
    var shown = api ? api.normalizeDate(value) : '';
    var m = String(shown || '').match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
    if (!m) return 0;
    return Number(m[3] + m[2] + m[1]);
  }

  function stampFromIso(value) {
    var m = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return 0;
    return Number(m[1] + m[2] + m[3]);
  }

  function isoFromDate(d) {
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }

  function rangePresets(today) {
    var d = today instanceof Date ? today : new Date();
    var day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    var weekDay = day.getDay();
    var mondayOffset = weekDay === 0 ? 6 : weekDay - 1;
    var monday = new Date(day.getFullYear(), day.getMonth(), day.getDate() - mondayOffset);
    var sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6);
    var monthStart = new Date(day.getFullYear(), day.getMonth(), 1);
    var monthEnd = new Date(day.getFullYear(), day.getMonth() + 1, 0);
    return {
      today: { from: isoFromDate(day), to: isoFromDate(day) },
      week: { from: isoFromDate(monday), to: isoFromDate(sunday) },
      month: { from: isoFromDate(monthStart), to: isoFromDate(monthEnd) }
    };
  }

  function mapAmirCols(headerRow) {
    var map = {};
    (headerRow || []).forEach(function (cell, i) {
      var k = headerKey(cell);
      if (!k) return;
      if (k === 'firma_kodu') map.firmaKodu = i;
      else if (k === 'irs_no' || k === 'irsaliye_no') map.irsNo = i;
      else if (k === 'irs_tarihi' || k === 'tarih') map.tarih = i;
      else if (k === 'sevk_tipi') map.sevk = i;
      else if (k === 'firma' && map.firma == null) map.firma = i;
      else if (k === 'lot_no' || k === 'lot') map.lot = i;
      else if (k === 'malzeme' || k === 'stok_adi') map.malzeme = i;
      else if (k === 'irs_tonaji') map.irsKg = i;
      else if (k === 'kantar_tonaji' || k === 'kantar') map.kantar = i;
      else if (k === 'ambalaj') map.ambalaj = i;
      else if (k === 'miktar') map.miktar = i;
      else if (k === 'bos_bbt') map.bosBbt = i;
      else if (k === 'bos_cuval') map.bosCuval = i;
      else if (k === 'palet') map.palet = i;
      else if (k === 'plaka') map.plaka = i;
      else if (k === 'siparis_no' || k === 'sipno') map.sip = i;
    });
    return map;
  }

  function normalizePlaka(value) {
    return trimStr(value).toUpperCase().replace(/\s+/g, '');
  }

  function cellAt(row, idx) {
    if (idx == null || idx < 0) return '';
    return row[idx];
  }

  function numAt(row, idx) {
    var api = sk();
    var n = api ? api.parseNum(cellAt(row, idx)) : Number(cellAt(row, idx));
    return Number.isFinite(n) ? n : 0;
  }

  function parseAmirGrid(grid) {
    var rows = Array.isArray(grid) ? grid : [];
    var headerIdx = -1;
    var cols = null;
    for (var i = 0; i < Math.min(rows.length, 20); i++) {
      var mapped = mapAmirCols(rows[i]);
      if (mapped.tarih != null && (mapped.sip != null || mapped.irsNo != null)) {
        headerIdx = i;
        cols = mapped;
        break;
      }
    }
    if (headerIdx < 0) {
      return { ok: false, rows: [], error: 'İrsaliye başlığı bulunamadı (İRS. TARİHİ / SİPARİŞ NO).' };
    }
    var api = sk();
    var out = [];
    for (var r = headerIdx + 1; r < rows.length; r++) {
      var row = rows[r] || [];
      var tarih = api ? api.normalizeDate(cellAt(row, cols.tarih)) : trimStr(cellAt(row, cols.tarih));
      var sip = api ? api.normalizeSip(cellAt(row, cols.sip)) : trimStr(cellAt(row, cols.sip));
      var irsNo = trimStr(cellAt(row, cols.irsNo));
      if (/e\+/i.test(irsNo)) irsNo = String(Math.round(Number(cellAt(row, cols.irsNo))));
      if (!tarih && !sip && !irsNo) continue;
      var plaka = normalizePlaka(cellAt(row, cols.plaka));
      var firmaKodu = trimStr(cellAt(row, cols.firmaKodu)).toUpperCase().replace(/\s+/g, '');
      out.push({
        tarih: tarih,
        sip: sip,
        irsNo: irsNo,
        firmaKodu: firmaKodu,
        sevkTipi: trimStr(cellAt(row, cols.sevk)),
        firma: trimStr(cellAt(row, cols.firma)),
        lotNo: trimStr(cellAt(row, cols.lot)),
        malzeme: trimStr(cellAt(row, cols.malzeme)),
        ambalaj: trimStr(cellAt(row, cols.ambalaj)),
        irsKg: numAt(row, cols.irsKg),
        kantar: numAt(row, cols.kantar),
        miktar: Math.round(numAt(row, cols.miktar)),
        bosBbt: Math.round(numAt(row, cols.bosBbt)),
        bosCuval: Math.round(numAt(row, cols.bosCuval)),
        palet: Math.round(numAt(row, cols.palet)),
        plaka: plaka
      });
    }
    return { ok: out.length > 0, rows: out, error: out.length ? '' : 'İrsaliye satırı yok.' };
  }

  function flattenNetsis(parsed) {
    var blocks = (parsed && parsed.blocks) || [];
    var out = [];
    blocks.forEach(function (block) {
      (block.lines || []).forEach(function (ln) {
        out.push({
          tarih: block.tarih || '',
          sip: block.sip || '',
          plaka: ln.plaka || '',
          irsaliye: ln.irsaliye || '',
          irsKg: Number(ln.ob1) || 0,
          kantar: Number(ln.kantar) || 0,
          bbt: Number(ln.bbt) || 0,
          cuval: Number(ln.cuval) || 0,
          firmaKodu: ln.firmaKodu || block.firma || '',
          cari: ln.teslimCari || block.teslimCari || ''
        });
      });
    });
    return out;
  }

  function sipQuery(value) {
    var raw = trimStr(value).toUpperCase().replace(/\s+/g, '');
    if (!raw) return '';
    var api = sk();
    if (api && typeof api.normalizeSip === 'function') return api.normalizeSip(raw) || raw;
    return raw;
  }

  function sipHit(sip, query) {
    if (!query) return true;
    return sipQuery(sip).indexOf(query) >= 0;
  }

  function inSpan(tarih, fromStamp, toStamp) {
    var s = stampFromTr(tarih);
    if (!s) return false;
    return s >= fromStamp && s <= toStamp;
  }

  function groupKey(line) {
    return (line.tarih || '') + '|' + (line.sip || '') + '|' + (line.plaka || '');
  }

  /** Netsis R11202600001402 ve irsaliye 202600001402 → aynı evrak (2026:1402). */
  function irsJoinKey(text) {
    var digits = String(text || '').replace(/\D/g, '');
    if (!digits) return '';
    var withSeries = digits.match(/^(\d{2})(20\d{2})(\d{4,})$/);
    if (withSeries && digits.length >= 13) {
      var seq = parseInt(withSeries[3], 10);
      return seq ? (withSeries[2] + ':' + seq) : '';
    }
    var plain = digits.match(/^(20\d{2})(\d{4,})$/);
    if (!plain) return '';
    var n = parseInt(plain[2], 10);
    return n ? (plain[1] + ':' + n) : '';
  }

  function isRSeries(firmaKodu, irsNo) {
    var code = trimStr(firmaKodu).toUpperCase().replace(/\s+/g, '');
    if (code) return code.charAt(0) === 'R';
    return trimStr(irsNo).toUpperCase().charAt(0) === 'R';
  }

  function formatAmirIrs(firmaKodu, irsNo) {
    var code = trimStr(firmaKodu).toUpperCase().replace(/\s+/g, '');
    var no = trimStr(irsNo).toUpperCase().replace(/\s+/g, '');
    if (!no) return '';
    if (!code || no.indexOf(code) === 0) return no;
    return code + no;
  }

  function platesLabel(netsisPlate, amirPlate) {
    if (netsisPlate && amirPlate && netsisPlate !== amirPlate) return netsisPlate + ' / ' + amirPlate;
    return netsisPlate || amirPlate || '';
  }

  function splitFirmaLot(text) {
    var raw = trimStr(text);
    if (!raw) return { firma: '', lot: '' };
    var m = raw.match(/^(.*?)\s*\/\s*LOT\s*NO\s*[:.]?\s*(.*)$/i);
    if (!m) return { firma: raw, lot: '' };
    return { firma: trimStr(m[1]), lot: trimStr(m[2]) };
  }

  function firmaLotOf(line, side) {
    if (side === 'netsis') return splitFirmaLot(line && line.firmaKodu);
    return { firma: trimStr(line && line.firma), lot: trimStr(line && line.lotNo) };
  }

  function fieldNum(left, right, kind) {
    if (kind === 'cuval') {
      var l = Math.round(Number(left) || 0);
      var r = Math.round(Number(right) || 0);
      return { left: l, right: r, delta: r - l, ok: l === r };
    }
    var api = sk();
    if (!api) return { left: left, right: right, delta: right - left, ok: left === right };
    return api.compareField(left, right, kind);
  }

  function comparePair(netsis, amir) {
    var fields = {
      kantar: fieldNum(netsis.kantar, amir.kantar, 'kg'),
      irsKg: fieldNum(netsis.irsKg, amir.irsKg, 'kg'),
      bbt: fieldNum(netsis.bbt, amir.miktar, 'bbt'),
      cuval: fieldNum(netsis.cuval, amir.bosCuval, 'cuval')
    };
    var net = firmaLotOf(netsis, 'netsis');
    var irs = firmaLotOf(amir, 'amir');
    var ok = fields.kantar.ok && fields.irsKg.ok && fields.bbt.ok && fields.cuval.ok;
    return {
      status: ok ? 'ok' : 'bad',
      tarih: amir.tarih || netsis.tarih,
      sip: amir.sip || netsis.sip,
      plaka: platesLabel(netsis.plaka, amir.plaka),
      malzeme: amir.malzeme || '',
      firma: irs.firma || net.firma || '',
      lot: irs.lot || net.lot || '',
      netsisFirma: net.firma,
      amirFirma: irs.firma,
      netsisLot: net.lot,
      amirLot: irs.lot,
      sevkTipi: amir.sevkTipi || '',
      netsisIrs: netsis.irsaliye || '',
      amirIrs: formatAmirIrs(amir.firmaKodu, amir.irsNo),
      palet: amir.palet || 0,
      fields: fields
    };
  }

  function lone(side, line) {
    var empty = { left: 0, right: 0, delta: 0, ok: false };
    var fields = { kantar: empty, irsKg: empty, bbt: empty, cuval: empty };
    if (side === 'netsis') {
      fields = {
        kantar: { left: line.kantar, right: 0, delta: 0, ok: false },
        irsKg: { left: line.irsKg, right: 0, delta: 0, ok: false },
        bbt: { left: line.bbt, right: 0, delta: 0, ok: false },
        cuval: { left: line.cuval, right: 0, delta: 0, ok: false }
      };
    } else {
      fields = {
        kantar: { left: 0, right: line.kantar, delta: 0, ok: false },
        irsKg: { left: 0, right: line.irsKg, delta: 0, ok: false },
        bbt: { left: 0, right: line.miktar, delta: 0, ok: false },
        cuval: { left: 0, right: line.bosCuval, delta: 0, ok: false }
      };
    }
    var sideInfo = firmaLotOf(line, side);
    return {
      status: side === 'netsis' ? 'only-netsis' : 'only-amir',
      tarih: line.tarih || '',
      sip: line.sip || '',
      plaka: line.plaka || '',
      malzeme: line.malzeme || '',
      firma: sideInfo.firma || line.cari || '',
      lot: sideInfo.lot || '',
      netsisFirma: side === 'netsis' ? sideInfo.firma : '',
      amirFirma: side === 'amir' ? sideInfo.firma : '',
      netsisLot: side === 'netsis' ? sideInfo.lot : '',
      amirLot: side === 'amir' ? sideInfo.lot : '',
      sevkTipi: line.sevkTipi || '',
      netsisIrs: line.irsaliye || '',
      amirIrs: line.irsNo ? formatAmirIrs(line.firmaKodu, line.irsNo) : '',
      palet: line.palet || 0,
      fields: fields
    };
  }

  function compareRange(netsisParsed, amirParsed, range, opts) {
    opts = opts || {};
    var fromStamp = stampFromIso(range && range.from);
    var toStamp = stampFromIso(range && range.to);
    if (!fromStamp || !toStamp || fromStamp > toStamp) {
      return { ok: false, error: 'Tarih aralığı seç.', rows: [], summary: null };
    }
    var sevk = foldTr(opts.sevkTipi || '');
    var sipQ = sipQuery(opts.sip);
    var amirRows = ((amirParsed && amirParsed.rows) || []).filter(function (row) {
      if (!isRSeries(row.firmaKodu, row.irsNo)) return false;
      if (!inSpan(row.tarih, fromStamp, toStamp)) return false;
      if (!sipHit(row.sip, sipQ)) return false;
      if (sevk && sevk !== 'tumu' && foldTr(row.sevkTipi) !== sevk) return false;
      return true;
    });
    var netsisRows = flattenNetsis(netsisParsed).filter(function (row) {
      if (!isRSeries('', row.irsaliye)) return false;
      return inSpan(row.tarih, fromStamp, toStamp) && sipHit(row.sip, sipQ);
    });
    if (sevk && sevk !== 'tumu') {
      var scope = Object.create(null);
      amirRows.forEach(function (row) {
        scope[(row.tarih || '') + '|' + (row.sip || '')] = true;
      });
      netsisRows = netsisRows.filter(function (row) {
        return !!scope[(row.tarih || '') + '|' + (row.sip || '')];
      });
    }

    var groups = Object.create(null);
    function bucket(line) {
      var key = groupKey(line);
      if (!groups[key]) groups[key] = { netsis: [], amir: [] };
      return groups[key];
    }
    netsisRows.forEach(function (row) { bucket(row).netsis.push(row); });
    amirRows.forEach(function (row) { bucket(row).amir.push(row); });

    var rows = [];
    var leftN = [];
    var leftA = [];
    Object.keys(groups).sort().forEach(function (key) {
      var g = groups[key];
      var n = Math.min(g.netsis.length, g.amir.length);
      for (var i = 0; i < n; i++) rows.push(comparePair(g.netsis[i], g.amir[i]));
      for (var j = n; j < g.netsis.length; j++) leftN.push(g.netsis[j]);
      for (var k = n; k < g.amir.length; k++) leftA.push(g.amir[k]);
    });
    // Plaka bir rakam kaymışsa (43AEA633 / 43AEA533) irsaliye sırası aynı evrakı tutar.
    var amirByIrs = Object.create(null);
    leftA.forEach(function (row, idx) {
      var jk = irsJoinKey(row.irsNo);
      if (!jk) return;
      var key = (row.tarih || '') + '|' + (row.sip || '') + '|' + jk;
      if (!amirByIrs[key]) amirByIrs[key] = [];
      amirByIrs[key].push(idx);
    });
    var netsisByIrs = Object.create(null);
    leftN.forEach(function (row, idx) {
      var jk = irsJoinKey(row.irsaliye);
      if (!jk) return;
      var key = (row.tarih || '') + '|' + (row.sip || '') + '|' + jk;
      if (!netsisByIrs[key]) netsisByIrs[key] = [];
      netsisByIrs[key].push(idx);
    });
    var usedN = Object.create(null);
    var usedA = Object.create(null);
    Object.keys(amirByIrs).forEach(function (key) {
      var aIdx = amirByIrs[key];
      var nIdx = netsisByIrs[key];
      if (!nIdx || aIdx.length !== 1 || nIdx.length !== 1) return;
      usedN[nIdx[0]] = true;
      usedA[aIdx[0]] = true;
      rows.push(comparePair(leftN[nIdx[0]], leftA[aIdx[0]]));
    });
    leftN.forEach(function (row, idx) { if (!usedN[idx]) rows.push(lone('netsis', row)); });
    leftA.forEach(function (row, idx) { if (!usedA[idx]) rows.push(lone('amir', row)); });

    var summary = { matchedOk: 0, matchedBad: 0, onlyNetsis: 0, onlyAmir: 0, total: rows.length };
    rows.forEach(function (row) {
      if (row.status === 'ok') summary.matchedOk += 1;
      else if (row.status === 'bad') summary.matchedBad += 1;
      else if (row.status === 'only-netsis') summary.onlyNetsis += 1;
      else summary.onlyAmir += 1;
    });
    var sipInfo = null;
    if (sipQ) {
      function sideSpan(list) {
        var dates = list.map(function (row) { return row.tarih; }).filter(Boolean).sort(function (a, b) {
          return stampFromTr(a) - stampFromTr(b);
        });
        return { count: list.length, first: dates[0] || '', last: dates[dates.length - 1] || '' };
      }
      var allAmir = ((amirParsed && amirParsed.rows) || []).filter(function (row) {
        return isRSeries(row.firmaKodu, row.irsNo) && sipHit(row.sip, sipQ);
      });
      var allNetsis = flattenNetsis(netsisParsed).filter(function (row) {
        return isRSeries('', row.irsaliye) && sipHit(row.sip, sipQ);
      });
      sipInfo = { query: sipQ, amir: sideSpan(allAmir), netsis: sideSpan(allNetsis) };
    }
    return { ok: true, error: '', rows: rows, summary: summary, sipInfo: sipInfo };
  }

  function resultMessage(diff) {
    if (!diff || !diff.ok) return { text: (diff && diff.error) || 'Karşılaştırılamadı.', err: true };
    var s = diff.summary || { matchedOk: 0, matchedBad: 0, onlyNetsis: 0, onlyAmir: 0 };
    var info = diff.sipInfo;
    var both = s.matchedOk + s.matchedBad;
    if (info && !info.netsis.count && !info.amir.count) {
      return { text: 'Bu sipariş iki dosyada da yok.', err: true };
    }
    if (info && both === 0 && s.onlyNetsis === 0 && s.onlyAmir === 0) {
      function spanText(side, name) {
        if (!side || !side.count) return '';
        var when = side.first === side.last ? side.first : (side.first + '–' + side.last);
        return name + ' ' + when + ' (' + side.count + ' satır)';
      }
      var bits = [spanText(info.netsis, 'Netsis'), spanText(info.amir, 'irsaliye')].filter(Boolean);
      return { text: 'Bu sipariş dosyada var (' + bits.join(', ') + ') ama seçili tarihte değil.', err: true };
    }
    if (s.matchedBad === 0 && s.onlyNetsis === 0 && s.onlyAmir === 0) {
      return { text: 'R serisi tutuyor. ' + s.matchedOk + ' satır.', err: false };
    }
    var parts = [];
    if (both) parts.push(both + ' satır iki listede de var' + (s.matchedBad ? ' (' + s.matchedBad + ' fark)' : ''));
    if (s.onlyNetsis) parts.push(s.onlyNetsis + ' satır sadece Netsis’te');
    if (s.onlyAmir) parts.push(s.onlyAmir + ' satır sadece irsaliyede');
    if (!parts.length) return { text: 'Bu aralıkta satır yok.', err: false };
    return { text: parts.join('. ') + '.', err: !!(s.matchedBad || s.onlyNetsis || s.onlyAmir) };
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatKg(n) {
    var v = Math.round(Number(n) || 0);
    return v.toLocaleString('tr-TR');
  }

  function irsLine(tag, value) {
    var text = trimStr(value) ? escapeHtml(value) : '—';
    return '<div><span>' + tag + '</span> ' + text + '</div>';
  }

  function irsCell(row) {
    return '<td class="am-irsno">' + irsLine('N', row.netsisIrs) + irsLine('İ', row.amirIrs) + '</td>';
  }

  function pairCell(field, fmt) {
    var ok = field && field.ok;
    var left = field ? field.left : 0;
    var right = field ? field.right : 0;
    return '<td class="' + (ok ? 'am-ok' : 'am-bad') + '">' +
      escapeHtml(fmt(left)) + ' <span>/ ' + escapeHtml(fmt(right)) + '</span></td>';
  }

  function renderRows(diff) {
    if (!diff || !diff.ok) return '';
    var rank = { bad: 1, ok: 2, 'only-netsis': 3, 'only-amir': 4 };
    var rows = (diff.rows || []).slice().sort(function (a, b) {
      return (rank[a.status] || 9) - (rank[b.status] || 9);
    });
    if (!rows.length) {
      return '<p class="am-empty">Bu aralıkta satır yok.</p>';
    }
    var capped = rows.length > 400;
    var view = capped ? rows.slice(0, 400) : rows;
    var html = '<div class="am-table-wrap"><table class="am-table"><thead><tr>' +
      '<th>Durum</th><th>Tarih</th><th>Sipariş</th><th>İrsaliye no</th><th>Plaka</th><th>Firma</th><th>Lot no</th><th>Malzeme</th>' +
      '<th>Kantar N / İ</th><th>İrs. kg N / İ</th><th>BBT / miktar</th><th>Çuval</th>' +
      '</tr></thead><tbody>';
    view.forEach(function (row) {
      var label = row.status === 'ok' ? 'TUTUYOR' : (row.status === 'bad' ? 'FARK' : (row.status === 'only-netsis' ? 'SADECE NETSİS' : 'SADECE İRSALİYE'));
      html += '<tr class="am-row am-row--' + row.status + '">' +
        '<td><span class="am-badge am-badge--' + row.status + '">' + label + '</span></td>' +
        '<td>' + escapeHtml(row.tarih) + '</td>' +
        '<td>' + escapeHtml(row.sip) + '</td>' +
        irsCell(row) +
        '<td>' + escapeHtml(row.plaka) + '</td>' +
        irsCell({ netsisIrs: row.netsisFirma, amirIrs: row.amirFirma }) +
        irsCell({ netsisIrs: row.netsisLot, amirIrs: row.amirLot }) +
        '<td>' + escapeHtml(row.malzeme || '') + '</td>' +
        pairCell(row.fields.kantar, formatKg) +
        pairCell(row.fields.irsKg, formatKg) +
        pairCell(row.fields.bbt, function (n) { return String(Math.round(Number(n) || 0)); }) +
        pairCell(row.fields.cuval, function (n) { return String(Math.round(Number(n) || 0)); }) +
        '</tr>';
    });
    html += '</tbody></table></div>';
    if (capped) html += '<p class="am-note">İlk 400 satır. Aralığı daralt.</p>';
    return html;
  }

  function renderSummary(diff) {
    if (!diff || !diff.summary) return '';
    var s = diff.summary;
    return '<div class="am-summary">' +
      '<span class="am-pill am-pill--ok"><b>' + s.matchedOk + '</b> tutuyor</span>' +
      '<span class="am-pill am-pill--bad"><b>' + s.matchedBad + '</b> fark</span>' +
      '<span class="am-pill"><b>' + s.onlyNetsis + '</b> sadece Netsis</span>' +
      '<span class="am-pill"><b>' + s.onlyAmir + '</b> sadece irsaliye</span>' +
      '</div>';
  }

  async function loadXlsx() {
    if (typeof root.ensureXlsxLoaded === 'function') await root.ensureXlsxLoaded();
    if (typeof root.XLSX === 'undefined') throw new Error('Excel okuyucu yüklenemedi');
  }

  async function gridFromFile(file) {
    await loadXlsx();
    var buf = await file.arrayBuffer();
    var wb = root.XLSX.read(buf, { type: 'array', cellDates: true });
    var name = (wb.SheetNames || [])[0];
    return {
      name: name,
      grid: root.XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '', blankrows: false })
    };
  }

  function bindAppUi(opts) {
    opts = opts || {};
    var toast = typeof opts.toast === 'function' ? opts.toast : function () {};
    var page = document.getElementById('amPage');
    if (!page) return null;
    var state = { netsis: null, amir: null, diff: null };
    var leftName = document.getElementById('amLeftName');
    var rightName = document.getElementById('amRightName');
    var fromIn = document.getElementById('amFrom');
    var toIn = document.getElementById('amTo');
    var sipIn = document.getElementById('amSip');
    var statusEl = document.getElementById('amStatus');
    var summaryEl = document.getElementById('amSummary');
    var tableEl = document.getElementById('amTable');
    var sevkEl = document.getElementById('amSevk');

    function setStatus(msg, isErr) {
      if (!statusEl) return;
      statusEl.textContent = msg || '';
      statusEl.className = 'am-status' + (isErr ? ' is-err' : '');
    }

    function paint() {
      if (summaryEl) summaryEl.innerHTML = renderSummary(state.diff);
      if (tableEl) tableEl.innerHTML = renderRows(state.diff);
    }

    function fillSevk() {
      if (!sevkEl) return;
      var current = sevkEl.value || '';
      var types = {};
      ((state.amir && state.amir.rows) || []).forEach(function (row) {
        if (row.sevkTipi && isRSeries(row.firmaKodu, row.irsNo)) types[row.sevkTipi] = true;
      });
      var keys = Object.keys(types).sort();
      sevkEl.innerHTML = '<option value="">Tümü</option>' + keys.map(function (name) {
        return '<option value="' + escapeHtml(name) + '">' + escapeHtml(name) + '</option>';
      }).join('');
      sevkEl.value = keys.indexOf(current) >= 0 ? current : '';
    }

    function ensureRange() {
      if (fromIn && toIn && fromIn.value && toIn.value) return;
      var month = rangePresets(new Date()).month;
      if (fromIn && !fromIn.value) fromIn.value = month.from;
      if (toIn && !toIn.value) toIn.value = month.to;
    }

    function run() {
      if (!state.netsis || !state.amir) {
        setStatus('Netsis raporunu ve irsaliye Excel’ini yükle.', true);
        return;
      }
      ensureRange();
      state.diff = compareRange(state.netsis, state.amir, {
        from: fromIn && fromIn.value,
        to: toIn && toIn.value
      }, {
        sevkTipi: sevkEl ? sevkEl.value : '',
        sip: sipIn ? sipIn.value : ''
      });
      paint();
      if (!state.diff.ok) {
        setStatus(state.diff.error || 'Karşılaştırılamadı.', true);
        return;
      }
      var msg = resultMessage(state.diff);
      setStatus(msg.text, msg.err);
      toast(msg.err ? 'Amir: fark bulundu.' : 'Amir: tutuyor.', msg.err);
    }

    var leftFile = document.getElementById('amLeftFile');
    var rightFile = document.getElementById('amRightFile');
    if (leftFile) {
      leftFile.addEventListener('change', function () {
        var file = leftFile.files && leftFile.files[0];
        if (!file) return;
        if (leftName) leftName.textContent = file.name;
        gridFromFile(file).then(function (sheet) {
          if (!sk()) throw new Error('Sayı kontrol modülü yok');
          var parsed = sk().parseNetsisGrid(sheet.grid);
          if (!parsed.ok) throw new Error(parsed.error || 'Netsis okunamadı');
          state.netsis = parsed;
          var lines = flattenNetsis(parsed).length;
          setStatus('Netsis: ' + lines + ' satır.');
        }).catch(function (err) {
          state.netsis = null;
          setStatus(err.message || 'Netsis okunamadı', true);
        });
      });
    }
    if (rightFile) {
      rightFile.addEventListener('change', function () {
        var file = rightFile.files && rightFile.files[0];
        if (!file) return;
        if (rightName) rightName.textContent = file.name;
        gridFromFile(file).then(function (sheet) {
          var parsed = parseAmirGrid(sheet.grid);
          if (!parsed.ok) throw new Error(parsed.error || 'İrsaliye okunamadı');
          state.amir = parsed;
          fillSevk();
          ensureRange();
          setStatus('İrsaliye: ' + parsed.rows.length + ' satır.');
        }).catch(function (err) {
          state.amir = null;
          setStatus(err.message || 'İrsaliye okunamadı', true);
        });
      });
    }

    page.addEventListener('click', function (e) {
      var preset = e.target.closest('[data-am-preset]');
      if (!preset || !fromIn || !toIn) return;
      var key = preset.getAttribute('data-am-preset');
      var span = rangePresets(new Date())[key];
      if (!span) return;
      fromIn.value = span.from;
      toIn.value = span.to;
    });
    var runBtn = document.getElementById('amRun');
    if (runBtn) runBtn.addEventListener('click', run);
    if (sipIn) {
      sipIn.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') run();
      });
    }
    if (sevkEl) sevkEl.addEventListener('change', function () { if (state.diff) run(); });
    var homeBtn = document.getElementById('amHomeBtn');
    if (homeBtn) {
      homeBtn.addEventListener('click', function () {
        if (root.SessionManager && root.SessionManager.navigateToHome) root.SessionManager.navigateToHome();
        else location.href = 'GIRIS.html';
      });
    }
    ensureRange();
    return { state: state, run: run };
  }

  var api = {
    parseAmirGrid: parseAmirGrid,
    flattenNetsis: flattenNetsis,
    compareRange: compareRange,
    resultMessage: resultMessage,
    rangePresets: rangePresets,
    renderRows: renderRows,
    bindAppUi: bindAppUi
  };

  if (typeof root !== 'undefined') root.AmirKontrol = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : typeof global !== 'undefined' ? global : this);
