'use strict';

const { daysFromSheetState } = require('./liman-sheet');
const core = require('../public/nakliye-bekleyen-core');

const STOP = {
  OZET: 1, GUNUN: 1, GUNU: 1, GEC: 1, GECIR: 1, GECMIS: 1,
  GELMEYEN: 1, ARAC: 1, ARACLAR: 1, CIKTI: 1, CIKTIMI: 1, CIKMIS: 1,
  GELDI: 1, GELDIMI: 1, MI: 1, MU: 1, NE: 1, DURUM: 1, SAAT: 1,
  TARIH: 1, SOFOR: 1, KIM: 1, VAR: 1, YOK: 1, LISTE: 1, LIMAN: 1,
  BBT: 1, PLAKA: 1, PLAKALAR: 1, SU: 1, SUNLAR: 1, BUNLAR: 1,
};

function fold(raw) {
  return String(raw || '')
    .toLocaleUpperCase('tr-TR')
    .replace(/İ/g, 'I')
    .replace(/Ş/g, 'S')
    .replace(/Ğ/g, 'G')
    .replace(/Ü/g, 'U')
    .replace(/Ö/g, 'O')
    .replace(/Ç/g, 'C')
    .replace(/[^A-Z0-9]/g, '');
}

function num(v) {
  const n = Number(v) || 0;
  if (Math.abs(n - Math.round(n)) < 0.05) return String(Math.round(n));
  return String(Math.round(n * 10) / 10).replace('.', ',');
}

function istanbulDateKey(date) {
  const bag = {};
  new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Istanbul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date instanceof Date ? date : new Date(date)).forEach((part) => {
    bag[part.type] = part.value;
  });
  return bag.year + '-' + bag.month + '-' + bag.day;
}

function tokensOf(text) {
  return String(text || '')
    .toLocaleUpperCase('tr-TR')
    .split(/[^0-9A-Za-zÇĞİÖŞÜçğıöşü]+/)
    .map(fold)
    .filter((token) => token.length >= 2 && !STOP[token]);
}

function wantsSummary(text) {
  const folded = fold(text);
  if (!folded) return true;
  const codes = tokensOf(text).filter((token) => /\d/.test(token));
  if (codes.length) return false;
  return /OZET|GELMEYEN|GUNUN|DURUM/.test(folded);
}

function wantsLeft(text) {
  return /CIKTI|CIKMIS/.test(fold(text));
}

function pickDay(days, todayKey) {
  const dated = (days || []).filter((day) => day && day.dateKey && day.dateKey !== 'tarihsiz');
  return dated.find((day) => day.dateKey === todayKey) || dated[0] || null;
}

function study(block) {
  const items = ((block && block.rows) || []).map((row) => core.limanRowForGelmeyen(row, block.title || ''));
  let item = null;
  try { item = items.length ? core.analyzeBlock(items) : null; } catch (e) { item = null; }
  const waiting = item && typeof core.limanGelmeyenPlates === 'function' ? core.limanGelmeyenPlates(item) : [];
  return { block, item, waiting };
}

function nameOf(block, item) {
  const bits = [item && item.ydKey, block && (block.liman || block.port)].filter(Boolean);
  if (bits.length) return bits.join(' · ');
  const title = String((block && block.title) || '').replace(/\s+/g, ' ').trim();
  return title ? title.slice(0, 72) : 'Sevkiyat';
}

function plateBits(list) {
  return (list || []).slice(0, 12).map((plate) => {
    const no = String(plate.plaka || '').replace(/\s+/g, '');
    const bbt = Number(plate.bbt) || 0;
    return bbt ? no + ' (' + num(bbt) + ' BBT)' : no;
  }).filter(Boolean);
}

function leftRows(block) {
  return ((block && block.rows) || [])
    .map((row) => core.limanRowForGelmeyen(row, (block && block.title) || ''))
    .filter((row) => core.isLimanRowDeparted(row));
}

function lineOf(studied) {
  const item = studied.item;
  const block = studied.block;
  if (!item) return '';
  const gone = leftRows(block);
  const goneKeys = {};
  gone.forEach((row) => { goneKeys[fold(row.plaka)] = 1; });
  const plan = Number(item.planBbt) || 0;
  const leftFromRows = gone.reduce((sum, row) => sum + (Number(row.bbt) || 0), 0);
  const left = leftFromRows || Number(item.departedBbt) || 0;
  const inside = Number(item.insideBbt) || 0;
  const remain = Number(item.remainingBbt) || 0;
  const waiting = (studied.waiting || []).filter((plate) => !goneKeys[fold(plate.plaka)]);
  const open = waiting.length || remain > 0 || inside > 0;
  if (!open && plan > 0 && left >= plan) return nameOf(block, item) + '\nTamam, hepsi çıktı.';
  if (!plan && !left && !waiting.length && remain <= 0) return '';
  const title = nameOf(block, item);
  const lines = [title];
  if (plan || left || inside) {
    lines.push(num(plan) + ' BBT idi, ' + num(left) + ' BBT çıktı');
  }
  const stay = plan > left ? plan - left : 0;
  if (stay > 0) lines.push(num(stay) + ' BBT kaldı');
  if (inside > 0) lines.push(num(inside) + ' BBT içeride');
  if (waiting.length) {
    const shown = plateBits(waiting);
    const more = waiting.length - shown.length;
    lines.push('Gelmedi:');
    shown.forEach((bit) => lines.push(bit));
    if (more > 0) lines.push(num(more) + ' plaka daha verilecek');
  }
  if (remain > 0) lines.push(num(remain) + ' BBT için plaka verilecek');
  return lines.join('\n');
}

function summary(day, todayKey) {
  if (!day || !(day.blocks || []).length) return 'Limanda açık sevkiyat listesi yok.';
  const studied = (day.blocks || []).map(study).filter((row) => row.item);
  const lines = studied.map(lineOf).filter(Boolean);
  const open = lines.filter((line) => line.indexOf('Tamam,') === -1);
  const done = lines.length - open.length;
  const head = (day.dateKey === todayKey ? 'Bugün ' : 'Son liste ') + (day.label || day.dateKey) + '. '
    + open.length + ' sevkiyat açık'
    + (done ? ', ' + done + ' sevkiyat tamam' : '') + '.';
  const body = (open.length ? open : lines).slice(0, 12);
  if (!body.length) return head + ' Gelmeyen araç yok.';
  return [head].concat(body).join('\n');
}

function blob(block) {
  return fold([
    block && block.title,
    block && block.yd,
    block && block.lot,
    block && block.sip,
    block && block.booking,
    block && block.liman,
    block && block.gemi,
  ].join(' '));
}

function rowBlob(row) {
  return fold([row && row.plaka, row && row.irsaliye, row && row.irsaliyeNo, row && row.sofor].join(' '));
}

function plateStatus(studied, plate) {
  const key = fold(plate);
  const row = ((studied.block && studied.block.rows) || []).find((item) => fold(item.plaka) === key);
  const shaped = row ? core.limanRowForGelmeyen(row, studied.block.title || '') : null;
  if (shaped && core.isLimanRowDeparted(shaped)) return 'geldi ve çıktı';
  if ((studied.waiting || []).some((item) => fold(item.plaka) === key && !core.isLimanRowDeparted(core.limanRowForGelmeyen(item, '')))) return 'henüz gelmedi';
  if (((studied.item && studied.item.insidePlates) || []).some((item) => fold(item.plaka) === key)) return 'içeride, henüz çıkmadı';
  if ((studied.waiting || []).some((item) => fold(item.plaka) === key)) return 'henüz gelmedi';
  return 'geldi ve çıktı';
}

function rowLine(row, studied, day) {
  const plate = String((row && row.plaka) || '').replace(/\s+/g, '') || 'Araç';
  const lines = [plate + ' — ' + plateStatus(studied, plate)];
  if (day && day.label && day.label !== 'Tarihsiz') lines.push(day.label);
  const giris = String((row && row.kantarGiris) || '').trim();
  const cikis = String((row && row.kantarCikis) || '').trim();
  if (giris) lines.push('Giriş ' + giris);
  if (cikis) lines.push('Çıkış ' + cikis);
  const sofor = String((row && row.sofor) || '').trim();
  if (sofor) lines.push('Şoför ' + sofor);
  const bbt = Number(row && row.bbt) || 0;
  if (bbt) lines.push(num(bbt) + ' BBT');
  return lines.join('\n');
}

function lookup(days, text) {
  const tokens = tokensOf(text);
  if (!tokens.length) return '';
  const hits = [];
  (days || []).forEach((day) => {
    (day.blocks || []).forEach((block) => {
      const studied = study(block);
      const blockHit = tokens.some((token) => blob(block).indexOf(token) !== -1);
      const rows = (block.rows || []).filter((row) => tokens.some((token) => rowBlob(row).indexOf(token) !== -1));
      if (rows.length) {
        rows.slice(0, 6).forEach((row) => hits.push(rowLine(row, studied, day)));
        return;
      }
      if (blockHit) {
        const line = lineOf(studied);
        if (line) hits.push((day.label && day.label !== 'Tarihsiz' ? day.label + ' · ' : '') + line);
      }
    });
  });
  if (!hits.length) return tokens[0] + ' liman listesinde yok.';
  const unique = [];
  hits.forEach((line) => { if (unique.indexOf(line) === -1) unique.push(line); });
  const body = unique.slice(0, 8).join('\n');
  if (!wantsLeft(text)) return body;
  const finished = body.indexOf('henüz') === -1 && body.indexOf('Gelmedi') === -1 && body.indexOf('içeride') === -1;
  return (finished ? 'Çıktı.\n' : 'Henüz tam çıkmadı.\n') + body;
}

function firmaCodes(text) {
  const out = [];
  String(text || '')
    .toLocaleUpperCase('tr-TR')
    .split(/[^0-9A-Za-zÇĞİÖŞÜçğıöşü]+/)
    .map(fold)
    .forEach((token) => {
      if (!/^[A-Z]{1,4}\d{1,4}[A-Z]{0,6}$/.test(token)) return;
      if (/^\d{2}[A-Z]{1,3}\d{2,5}$/.test(token)) return;
      if (/^(HP|YD|PFK|PO|I)\d/.test(token)) return;
      if (out.indexOf(token) === -1) out.push(token);
    });
  return out;
}

function rowBits(order) {
  return {
    sira: String(order.siraNo || order.__idx || '').trim(),
    plan: String(order.planlananSev || '').trim(),
    fiili: String(order.fiiliSevkCikis || '').trim(),
    firma: String(order.firma || '').trim(),
    sip: String(order.sipNo || '').trim(),
    ad: String(order.firmaAdi || '').trim(),
    malzeme: String(order.malzeme || '').trim(),
    yukleme: String(order.yuklemeTuru || '').trim(),
    odeme: String(order.odemeTuru || '').trim(),
    org: String(order.org || '').trim(),
    sehir: String(order.il || order.sevkYeri || '').trim(),
    miktar: String(order.miktar || '').trim(),
    aciklama: String(order.aciklama || '').trim(),
  };
}

function columnAsked(text) {
  const folded = fold(text);
  if (/ODEME|MUSTERI/.test(folded)) return 'odeme';
  if (/SEHIR|NEREYE/.test(folded)) return 'sehir';
  if (/MALZEME|URUN/.test(folded)) return 'malzeme';
  if (/YUKLEME|DOKME|PALET/.test(folded)) return 'yukleme';
  if (/MIKTAR|TON|BBT/.test(folded)) return 'miktar';
  if (/SIPARIS|SIPNO|\bSIP\b/.test(folded)) return 'sip';
  if (/PLANLAN/.test(folded)) return 'plan';
  if (/FIILI|CIKIS TARIH/.test(folded)) return 'fiili';
  if (/ACIKLAMA/.test(folded)) return 'aciklama';
  if (/\bORG\b/.test(folded)) return 'org';
  return '';
}

function paySentence(shown, bits, text) {
  const pay = bits.odeme;
  const where = shown + (bits.sira ? ' satır ' + bits.sira : '');
  if (!pay) return where + ' ödeme türü boş.';
  if (/MUSTERI/.test(fold(text))) {
    if (fold(pay).indexOf('MUSTERI') !== -1) return 'Evet. ' + where + ' ödeme türü müşteri.';
    return 'Hayır. ' + where + ' ödeme türü ' + pay + '.';
  }
  return where + ' ödeme türü ' + pay + '.';
}

function excelLine(shown, order, excelWeek, text) {
  const bits = rowBits(order);
  const week = (excelWeek || 'Bu') + '. hafta';
  const place = week + ' Excel' + (bits.sira ? ' satır ' + bits.sira : '');
  const focus = columnAsked(text);
  if (focus === 'odeme') return paySentence(shown, bits, text);
  const named = {
    sehir: 'şehir',
    malzeme: 'malzeme',
    yukleme: 'yükleme',
    miktar: 'miktar',
    sip: 'sipariş no',
    plan: 'planlanan sev',
    fiili: 'fiili çıkış',
    aciklama: 'açıklama',
    org: 'org',
  };
  if (focus && named[focus]) {
    const value = bits[focus] || 'boş';
    return place + ' ' + named[focus] + ': ' + value + '.';
  }
  const parts = [
    bits.odeme && ('Ödeme: ' + bits.odeme),
    bits.ad && ('Firma: ' + bits.ad),
    bits.sehir && ('Şehir: ' + bits.sehir),
    bits.malzeme && ('Malzeme: ' + bits.malzeme),
    bits.miktar && ('Miktar: ' + bits.miktar),
    bits.yukleme && ('Yükleme: ' + bits.yukleme),
    bits.sip && ('Sipariş: ' + bits.sip),
    bits.plan && ('Planlanan: ' + bits.plan),
    bits.fiili && ('Fiili çıkış: ' + bits.fiili),
  ].filter(Boolean);
  return [place].concat(parts).join('\n');
}

function firmaAnswer(code, sources, text) {
  const { displayFirmaKod, firmaMatchesQuery, isoWeekInfoFromMs } = require('./piyasa-cikanlar');
  const now = sources.now instanceof Date ? sources.now : new Date();
  const weekInfo = isoWeekInfoFromMs(now.getTime());
  const week = weekInfo ? String(weekInfo.week) : '';
  const excelWeek = String((sources.piyasa && (sources.piyasa.week || sources.piyasa.sheet)) || week || '');
  const shown = displayFirmaKod(code) || code;
  const focus = columnAsked(text);
  const orders = (sources.piyasa && Array.isArray(sources.piyasa.orders) ? sources.piyasa.orders : []).filter((order) => {
    return firmaMatchesQuery(order && order.firma, shown) || firmaMatchesQuery(order && order.firmaAdi, shown);
  });
  const lines = [];
  if (!orders.length) {
    lines.push((excelWeek || 'Bu') + '. hafta Excel listesinde ' + shown + ' satırı yok.');
  } else {
    lines.push(orders.slice(0, 6).map((order) => excelLine(shown, order, excelWeek, text)).join('\n'));
  }
  if (focus) return lines.join('\n');
  const cikan = (Array.isArray(sources.cikanlar) ? sources.cikanlar : []).filter((row) => {
    const hafta = String((row && row.hafta) || '').replace(/[^\d].*$/, '');
    if (week && hafta && hafta !== week) return false;
    return firmaMatchesQuery(row && row.firma, shown);
  });
  if (!cikan.length) {
    lines.push(shown + ' bu hafta çıkanlarda yok.');
  } else {
    const plates = [];
    cikan.forEach((row) => {
      const plate = String((row && row.plaka) || '').replace(/\s+/g, '');
      if (!plate || plates.some((item) => item === plate)) return;
      plates.push(plate);
    });
    lines.unshift(shown + ' bu hafta ' + plates.length + ' plaka çıktı:\n' + plates.join('\n'));
  }
  return lines.join('\n');
}

function codesIn(text) {
  const raw = fold(text);
  const plates = raw.match(/\d{2}[A-Z]{1,3}\d{2,5}/g) || [];
  const codes = raw.match(/(?:HP|YD|PFK|PO|I)\d{2,6}/g) || [];
  const out = [];
  plates.concat(codes).forEach((bit) => {
    const clean = String(bit || '').replace(/\s+/g, '');
    if (clean && out.indexOf(clean) === -1) out.push(clean);
  });
  return out;
}

function lastUserText(messages) {
  const list = Array.isArray(messages) ? messages : [];
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const row = list[i];
    if (row && (row.role === 'user' || row.me)) return String(row.text || '');
  }
  return '';
}

function remembered(messages) {
  const list = Array.isArray(messages) ? messages : [];
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const found = codesIn(list[i] && list[i].text);
    if (found.length) return found[0];
  }
  return '';
}

function isSmallTalk(text) {
  if (isFollow(text)) return false;
  const folded = fold(text);
  if (!folded) return true;
  if (codesIn(text).length) return false;
  if (/OZET|GELMEYEN|GUNUN|PIYASA|RAPOR|LIMAN/.test(folded)) return false;
  return /SELAM|MERHABA|NAPIYOR|NABIYOR|NASILSIN|KIMSIN|TESEKKUR|SAGOL|NABER|NEYAPABILIR/.test(folded)
    || (folded.length <= 16 && !/\d/.test(folded));
}

function isFollow(text) {
  const folded = fold(text);
  if (!folded || codesIn(text).length) return false;
  return folded.length <= 24 && /PEKI|SOFOR|SAAT|DEVAM|AYNI/.test(folded);
}

function clockOf(ms) {
  const dt = new Date(Number(ms));
  if (!Number.isFinite(dt.getTime())) return '';
  const bag = {};
  new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Istanbul',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(dt).forEach((part) => { bag[part.type] = part.value; });
  if (!bag.hour) return '';
  return bag.day + '.' + bag.month + ' ' + bag.hour + ':' + bag.minute;
}

function piyasaSentence(state, now) {
  const orders = state && Array.isArray(state.orders) ? state.orders : [];
  const raw = state && (state.excelUpdatedAt || state.loadedAt);
  const at = Date.parse(raw || '');
  const when = Number.isFinite(at) ? clockOf(at) : '';
  const week = state && (state.week || state.sheet) ? String(state.week || state.sheet) : '';
  const stale = !Number.isFinite(at) || now.getTime() - at >= 3 * 60 * 60 * 1000;
  let line = 'Piyasa listesinde ' + orders.length + ' sipariş var';
  if (week) line += ', hafta ' + week;
  line += when ? '. Son güncelleme ' + when + '.' : '. Güncelleme saati yok.';
  if (orders.length && stale) line += ' Uzun süredir güncellenmemiş.';
  return line;
}

function reportSentence(rows) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return 'Bugünün günlük raporunda kayıt yok.';
  const last = list[0] || {};
  const bit = [last.plaka, last.sofor, last.firma, clockOf(last.tarih)].filter(Boolean).join(', ');
  return 'Bugün günlük raporda ' + list.length + ' kayıt var. Sonuncusu ' + bit + '.';
}

function reportHit(rows, code) {
  const key = fold(code);
  if (!key) return [];
  return (Array.isArray(rows) ? rows : []).filter((row) => {
    const bag = fold([row.plaka, row.sofor, row.firma, row.malzeme, row.sevk_yeri].join(' '));
    return bag.indexOf(key) !== -1;
  }).slice(0, 3);
}

function speak(messages, sources) {
  const src = sources || {};
  const now = src.now instanceof Date ? src.now : new Date(src.now || Date.now());
  const text = lastUserText(messages);
  const folded = fold(text);
  const piyasaLine = piyasaSentence(src.piyasa, now);
  const reportLine = reportSentence(src.reports);
  const days = daysFromSheetState(src.liman || {});
  const todayKey = istanbulDateKey(now);
  const prior = messages.slice(0, -1);
  const askedFirma = firmaCodes(text)[0];
  const rememberedFirma = (() => {
    for (let i = prior.length - 1; i >= 0; i -= 1) {
      const found = firmaCodes(prior[i] && prior[i].text);
      if (found.length) return found[0];
    }
    return '';
  })();
  const firmaCode = askedFirma || (isFollow(text) ? rememberedFirma : '');
  if (firmaCode && !codesIn(text).length) {
    return firmaAnswer(firmaCode, Object.assign({}, src, { now: now }), text);
  }

  if (isSmallTalk(text)) {
    return 'Buradayım. Firma kodu, plaka veya YD yazman yeter.';
  }

  const asked = codesIn(text);
  const code = asked[0] || (isFollow(text) ? remembered(prior) : '');
  if (code) {
    const limanHit = lookup(days, asked.length ? text : code);
    const missing = /listesinde yok/.test(limanHit);
    const reports = reportHit(src.reports, code);
    if (missing && !reports.length) return code + ' listede yok.';
    if (missing) return code + ' limanda yok.';
    return limanHit;
  }

  if (/PIYASA/.test(folded)) {
    const orders = src.piyasa && Array.isArray(src.piyasa.orders) ? src.piyasa.orders : [];
    const words = tokensOf(text).filter((token) => token.length >= 3 && !/PIYASA|LISTE|GUNCEL|NEZAMAN/.test(token));
    const hits = words.length ? orders.filter((order) => {
      const bag = fold([order.firma, order.firmaAdi, order.il, order.sevkYeri, order.sipNo, order.malzeme].join(' '));
      return words.some((word) => bag.indexOf(word) !== -1);
    }).slice(0, 5) : [];
    const extra = hits.length
      ? '\n' + hits.map((order) => [order.firmaAdi || order.firma, order.il || order.sevkYeri, order.malzeme, order.miktar].filter(Boolean).join(' · ')).join('\n')
      : '';
    return piyasaLine + extra;
  }

  if (/OZET|GELMEYEN|GUNUN|LIMAN/.test(folded)) {
    return summary(pickDay(days, todayKey), todayKey);
  }

  if (/RAPOR|YAZDIR/.test(folded)) return reportLine;

  return 'Firma kodu, plaka veya YD yaz.';
}

module.exports = {
  answerOzet: (state, text, now) => speak([{ role: 'user', text: text }], { liman: state, now: now }),
  speak,
  wantsSummary,
  tokensOf,
  istanbulDateKey,
};
