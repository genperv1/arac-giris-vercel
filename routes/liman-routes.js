'use strict';

const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { SITES, normalizeSite, slimRow, emptyState, irsaliyeKey } = require('../lib/liman-merge');
const { daysFromSheetState, siteHasBlocks, sanitizeBlocks, carryTasiyici, retainDroppedBooks, fileLabelOf, dateKeyFromFileName, labelFromDateKey, labelsReadyToDelete, pendingDropLabels, confirmSettledLabels, withoutSettledFiles } = require('../lib/liman-sheet');
const { buildArchiveFromPrints } = require('../lib/liman-archive-recover');
const { extractAuthTokenFromRequest } = require('../lib/auth-session');
const { canManageLimanList } = require('../lib/amir-user');
const { GATE_COOKIE, GATE_PURPOSE, KV_KEY, sanitizeState, gateAllows } = require('../lib/liman-gozetmen');
const { printHistoryListColumns, printHistoryKantarSelect, printHistoryExcelDaySelect, mapPrintHistoryRowToReport } = require('../lib/print-history-report-map');

// Liman listesi ofis oturumu ya da liman kapı çerezi ister.
// Çıkış akışı en fazla bu kadar geriye gider.
const DEPARTED_MAX_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const DEPARTED_MAX_ROWS = 3000;
const STAMP_REFRESH_MS = 120000;
const PRINT_MARK_TTL_MS = 20000;
const DEPARTED_CACHE_MS = 20000;

const STATE_KEY = 'liman_state_v1';
const MAX_ROWS = 2000;
// Amirin kapattığı günler bu kadar süre sonra kendiliğinden listeden düşer (kv_store şişmesin).
const CLOSED_DAY_TTL_MS = 45 * 24 * 60 * 60 * 1000;
const DAY_KEY_RE = /^(\d{4}-\d{2}-\d{2}|tarihsiz)$/;
// Kapatılan günün mühürlü kopyası. Canlı liste kantar Excel silince düşmez; amir kapatır. Sayı kontrol mühürlü kopyayı kullanır.
const ARCHIVE_PREFIX = 'liman_archive_v1:';
const ARCHIVE_INDEX_KEY = 'liman_archive_index_v1';
const ARCHIVE_ROW_FIELDS = ['sira', 'plaka', 'bbt', 'cuval', 'palet', 'bosBbt', 'bosCuval', 'net', 'ogr', 'giden', 'fark', 'yukleme', 'sofor', 'telefon', 'irsaliye', 'tasiyici', 'note', 'kantarGiris', 'kantarCikis'];
const CHECK_SUMMARY_FIELDS = ['matchedOk', 'matchedBad', 'onlyLeft', 'onlyRight', 'total', 'lineOk', 'lineBad', 'lineOnlyLeft', 'lineOnlyRight'];
const DEFAULT_SITE_IPS = {
  AVDAN: ['95.3.27.82'],
  '1.OSB': ['195.175.103.150'],
};

// Liman görevlisi giriş yapmaz ama aracı karşılamak için şoför adı ve telefonu gerekir.
function departedDataFields(d, inst) {
  return {
    plaka: d.plaka || '',
    cekiciPlaka: d.cekiciPlaka || '',
    dorsePlaka: d.dorsePlaka || '',
    firma: d.firma || '',
    malzeme: d.malzeme || '',
    ydKey: d.ydKey || '',
    headerText: d.headerText || '',
    lotNo: d.lotNo || '',
    yuklemeNotu: d.yuklemeNotu || '',
    excelFileName: d.excelFileName || '',
    excelDateKey: d.excelDateKey || '',
    basimYeri: d.basimYeri || '',
    sofor: d.sofor || '',
    iletisim: d.iletisim || '',
    tarih: (inst && inst.tarih) || '',
    saat: (inst && inst.saat) || '',
  };
}

function loadSiteIps() {
  const out = { AVDAN: DEFAULT_SITE_IPS.AVDAN.slice(), '1.OSB': DEFAULT_SITE_IPS['1.OSB'].slice() };
  try {
    const extra = JSON.parse(process.env.LIMAN_SITE_IPS || '{}');
    SITES.forEach((site) => {
      if (Array.isArray(extra[site])) out[site] = extra[site].map((ip) => String(ip || '').trim()).filter(Boolean);
    });
  } catch (_) { /* geçersiz env: varsayılan IP'ler */ }
  return out;
}

/**
 * api: JWT korumalı router (kantar gönderimi, amir işlemleri).
 * publicApp: opsiyonel; verilirse GET uçları ana uygulamaya bağlanır.
 * Ofis oturumu veya liman kapı çerezi yoksa 401 döner.
 */
function registerLimanRoutes(api, ctx, publicApp) {
  const { q, sendApiError, requireValidSession, requireAmir, sanitizeString, getClientIp, normalizeClientIp, formatReportInstant, presence } = ctx;

  function notePresence(req) {
    try { if (presence && req && req.user) presence.touch(req.user); } catch (_) { /* ignore */ }
  }
  const siteIps = loadSiteIps();
  const jwtSecret = ctx.JWT_SECRET || ctx.jwtSecret || process.env.JWT_SECRET || '';

  /** Oturum varsa req.user'ı doldurur; yoksa anonim devam eder (hata vermez). */
  function attachOptionalUser(req, _res, next) {
    if (!req.user && jwtSecret) {
      try {
        const token = extractAuthTokenFromRequest(req, ctx.AUTH_COOKIE_NAME || 'auth_token');
        if (token) req.user = jwt.verify(token, jwtSecret);
        else req.authError = 'no-token';
      } catch (err) {
        req.authError = (err && err.name === 'TokenExpiredError') ? 'expired' : 'invalid';
      }
    }
    next();
  }

  function readNamedCookie(req, name) {
    const raw = req && req.headers && req.headers.cookie;
    if (typeof raw !== 'string' || !raw) return '';
    const parts = raw.split(';');
    for (let i = 0; i < parts.length; i++) {
      const idx = parts[i].indexOf('=');
      if (idx <= 0) continue;
      if (parts[i].slice(0, idx).trim() !== name) continue;
      const value = parts[i].slice(idx + 1).trim();
      try { return decodeURIComponent(value); } catch (e) { return value; }
    }
    return '';
  }

  /** Ofis oturumu (req.user) veya liman kapı çerezi. İkisi de yoksa liste verilmez. */
  async function limanReaderAllowed(req) {
    if (req.user) return true;
    const token = readNamedCookie(req, GATE_COOKIE);
    if (!token || !jwtSecret) return false;
    let decoded;
    try {
      decoded = jwt.verify(token, jwtSecret);
    } catch (e) {
      return false;
    }
    if (!decoded || decoded.purpose !== GATE_PURPOSE) return false;
    if (decoded.grup !== 'admin') {
      let accounts = null;
      try {
        const result = await q('SELECT value FROM kv_store WHERE key = $1', [KV_KEY]);
        accounts = result.rows[0] ? sanitizeState(JSON.parse(result.rows[0].value)) : sanitizeState(null);
      } catch (e) {
        return false;
      }
      if (!gateAllows(accounts, decoded, requestIp(req))) return false;
    }
    req.limanGate = decoded;
    return true;
  }

  function rejectLimanReader(res) {
    return res.status(401).json({
      ok: false,
      error: 'Liman girişi gerekli',
      code: 'LIMAN_LOGIN_REQUIRED',
    });
  }

  // --- Gönderim günlüğü (bellekte, son 40 olay): amir "kantar gönderdi mi, neden reddedildi?" görür ---
  const EVENT_MAX = 40;
  const events = [];
  function logEvent(kind, req, extra) {
    const entry = Object.assign({
      at: new Date().toISOString(),
      kind,
      user: String((req && req.user && req.user.username) || ''),
      ip: req ? requestIp(req) : '',
    }, extra || {});
    events.unshift(entry);
    if (events.length > EVENT_MAX) events.length = EVENT_MAX;
    if (kind === 'denied' || kind === 'error') {
      console.warn('[liman] ' + kind + ' ' + JSON.stringify(entry));
    }
  }

  /** Kantar yazma uçları: oturum zorunlu; red sebebi günlüğe düşer (401 sessizce kaybolmasın). */
  function requireKantarSession(req, res, next) {
    attachOptionalUser(req, res, () => {
      if (req.user) return next();
      const reason = req.authError || 'no-token';
      logEvent('denied', req, { reason, path: req.path || req.originalUrl || '' });
      return res.status(401).json({
        ok: false,
        code: reason === 'expired' ? 'SESSION_EXPIRED' : 'SESSION_MISSING',
        error: reason === 'expired' ? 'Oturum süresi dolmuş.' : 'Oturum yok.',
      });
    });
  }

  function ipSite(ip) {
    for (let i = 0; i < SITES.length; i++) {
      if ((siteIps[SITES[i]] || []).indexOf(ip) >= 0) return SITES[i];
    }
    return '';
  }

  function requestIp(req) {
    const raw = typeof getClientIp === 'function' ? getClientIp(req) : (req.ip || '');
    return typeof normalizeClientIp === 'function' ? normalizeClientIp(raw) : String(raw || '');
  }

  // Bellekte tutulur; okumada DB de bakılır (localhost + canlı aynı veritabanını kullanınca eski liste kalmasın).
  let cachedRaw = null;
  let version = '';
  let sheetStamp = '';
  let heartbeatStamp = '';
  let heartbeatBrief = {};
  let stampsLoadedAt = 0;
  let stampsPromise = null;
  let printMarkCache = { at: 0, value: null };
  let departedCache = { key: '', at: 0, body: null };

  async function loadRaw() {
    const r = await q('SELECT value FROM kv_store WHERE key = $1', [STATE_KEY]);
    const raw = (r.rows[0] && r.rows[0].value) || '';
    if (cachedRaw === null || raw !== cachedRaw) {
      cachedRaw = raw;
      version = String(Date.now());
    }
    return cachedRaw;
  }

  async function readState() {
    const raw = await loadRaw();
    const base = emptyState();
    if (!raw) return base;
    try {
      const parsed = JSON.parse(raw);
      SITES.forEach((site) => {
        if (parsed.sites && parsed.sites[site]) base.sites[site] = parsed.sites[site];
      });
      if (parsed.notes && typeof parsed.notes === 'object') base.notes = parsed.notes;
      base.closedDays = pruneClosedDays(parsed.closedDays);
      if (parsed.heartbeats && typeof parsed.heartbeats === 'object') base.heartbeats = parsed.heartbeats;
      if (parsed.fileSeen && typeof parsed.fileSeen === 'object') base.fileSeen = parsed.fileSeen;
      if (parsed.dropConfirmed && typeof parsed.dropConfirmed === 'object') base.dropConfirmed = parsed.dropConfirmed;
      (Array.isArray(parsed.pending) ? parsed.pending : []).forEach((p) => {
        const site = ipSite(p && p.ip) || normalizeSite(p && p.guess);
        if (!site || !p.snapshot) return;
        const cur = base.sites[site];
        if (!cur || String(cur.updatedAt || '') < String(p.snapshot.updatedAt || '')) base.sites[site] = p.snapshot;
      });
      return base;
    } catch (_) {
      return base;
    }
  }

  /** opts.silent: liste içeriği değişmedi (nabız / alındı damgası) → liman sayfaları yeniden yüklemesin. */
  async function writeState(state, opts) {
    const raw = JSON.stringify(state);
    if (raw === cachedRaw) return { ok: true, unchanged: true };
    const expected = opts && Object.prototype.hasOwnProperty.call(opts, 'expectedRaw')
      ? opts.expectedRaw
      : cachedRaw;
    const r = await q(
      `INSERT INTO kv_store(key, value) VALUES($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
       WHERE kv_store.value IS NOT DISTINCT FROM $3
       RETURNING key`,
      [STATE_KEY, raw, expected == null ? '' : expected]
    );
    const applied = !!(r && ((r.rowCount > 0) || (r.rows && r.rows.length)));
    if (!applied) {
      cachedRaw = null;
      stampsLoadedAt = 0;
      return { ok: false, conflict: true };
    }
    cachedRaw = raw;
    rememberStamps(state);
    if (!(opts && opts.silent)) version = String(Date.now());
    return { ok: true };
  }

  async function commitState(mutator, opts) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const state = await readState();
      const expectedRaw = cachedRaw;
      const extra = (await mutator(state)) || {};
      if (extra.shortCircuit) return extra;
      const writeOpts = Object.assign({}, opts, { expectedRaw });
      if (extra.silent) writeOpts.silent = true;
      const wrote = await writeState(state, writeOpts);
      if (wrote.ok) return Object.assign({ ok: true, state }, extra, wrote);
    }
    return { ok: false, conflict: true, error: 'Liste aynı anda güncellendi, tekrar deneyin.' };
  }

  function isAmirUser(req) {
    const role = String((req.user && req.user.role) || '').toLowerCase();
    const username = String((req.user && req.user.username) || '').toLowerCase();
    return role === 'amir' || username === 'xxr';
  }

  /** Kapalı gün kaydı: { 'YYYY-MM-DD': { at, by } } — süresi dolanlar ve bozuk anahtarlar atılır. */
  function pruneClosedDays(raw) {
    const out = {};
    if (!raw || typeof raw !== 'object') return out;
    const now = Date.now();
    Object.keys(raw).forEach((key) => {
      if (!DAY_KEY_RE.test(key)) return;
      const entry = raw[key] && typeof raw[key] === 'object' ? raw[key] : {};
      const at = Date.parse(entry.at || '') || 0;
      if (at && now - at > CLOSED_DAY_TTL_MS) return;
      const files = [];
      (Array.isArray(entry.files) ? entry.files : []).forEach((name) => {
        const label = fileLabelOf(name) || String(name || '').trim().slice(0, 80);
        if (label && files.indexOf(label) < 0) files.push(label);
      });
      out[key] = {
        at: entry.at || '',
        by: String(entry.by || '').slice(0, 40),
        label: String(entry.label || '').slice(0, 40),
        rowCount: Math.max(0, Math.round(Number(entry.rowCount) || 0)),
        files: files.slice(0, 30),
      };
    });
    return out;
  }

  function closedDays(state) {
    return state && state.closedDays && typeof state.closedDays === 'object' ? state.closedDays : {};
  }

  /** Liman görevlisinin gördüğü günler: amirin kapattıkları çıkarılır. */
  function openDays(state) {
    const closed = closedDays(state);
    return daysFromSheetState(state).filter((day) => !closed[day.dateKey]);
  }

  function closedDayList(state) {
    const closed = closedDays(state);
    const live = {};
    daysFromSheetState(state).forEach((day) => { live[day.dateKey] = day; });
    return Object.keys(closed).filter((key) => DAY_KEY_RE.test(key)).sort().reverse().map((key) => {
      const day = live[key];
      const meta = closed[key] || {};
      const rowCount = day
        ? day.blocks.reduce((sum, block) => sum + ((block.rows && block.rows.length) || 0), 0)
        : (Number(meta.rowCount) || 0);
      return {
        dateKey: key,
        label: (day && day.label) || meta.label || labelFromDateKey(key),
        rowCount,
        at: meta.at || '',
        by: meta.by || '',
      };
    });
  }

  /** Kapalı günün bloklarını canlı listeden çıkarır; dosya adları kapalı kalır, kantar geri yazamaz. */
  function suppressDay(state, key, by) {
    const prev = closedDays(state)[key] || {};
    const day = daysFromSheetState(state).find((item) => item.dateKey === key);
    const files = [];
    const add = (label) => { if (label && files.indexOf(label) < 0) files.push(label); };
    (prev.files || []).forEach(add);
    if (day) (day.blocks || []).forEach((block) => (block.files || []).forEach(add));
    const rowCount = day
      ? day.blocks.reduce((sum, block) => sum + ((block.rows && block.rows.length) || 0), 0)
      : (Number(prev.rowCount) || 0);
    state.closedDays = Object.assign({}, closedDays(state), {
      [key]: {
        at: new Date().toISOString(),
        by: by || prev.by || '',
        label: (day && day.label) || prev.label || labelFromDateKey(key),
        rowCount,
        files,
      },
    });
    SITES.forEach((site) => {
      const snap = state.sites[site];
      if (!snap) return;
      const hidden = (block) => (dateKeyFromFileName((block && block.fileName) || snap.fileName || '') || 'tarihsiz') === key;
      if (Array.isArray(snap.blocks)) snap.blocks = snap.blocks.filter((block) => !hidden(block));
      if (Array.isArray(snap.rows)) snap.rows = snap.rows.filter((row) => !hidden(row));
      snap.fileName = withoutSettledFiles(snap.fileName || '', files);
    });
  }

  function blockIsClosed(block, state, fallbackFile) {
    const ownName = String((block && block.fileName) || '').trim();
    const ownLabel = fileLabelOf(ownName);
    const fallbackLabel = fileLabelOf(fallbackFile);
    const label = (ownLabel || fallbackLabel || '').toLowerCase();
    const closed = closedDays(state);
    if (label) {
      const named = Object.keys(closed).some((key) => (closed[key].files || []).some((file) => String(file).toLowerCase() === label));
      if (named) return true;
    }
    // "a.xlsx + b.xlsx" tek gün değildir. Kapalı eski dosyanın tarihi yeni Excel'i de kapatmasın.
    const dateSource = ownLabel ? ownName : (fallbackLabel ? String(fallbackFile || '') : '');
    const dateKey = dateKeyFromFileName(dateSource);
    return !!(dateKey && closed[dateKey]);
  }

  async function readKvJson(key) {
    const r = await q('SELECT value FROM kv_store WHERE key = $1', [key]);
    const raw = (r.rows[0] && r.rows[0].value) || '';
    let value = null;
    try { value = raw ? JSON.parse(raw) : null; } catch (_) { value = null; }
    return { raw, value };
  }

  /** mutator(eski) → yeni değer; undefined dönerse yazılmaz. Aynı anda yazımda 3 kez dener. */
  async function updateKvJson(key, mutator) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const cur = await readKvJson(key);
      const next = mutator(cur.value);
      if (next === undefined) return { ok: true, skipped: true, value: cur.value };
      const r = await q(
        `INSERT INTO kv_store(key, value) VALUES($1, $2)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
         WHERE kv_store.value IS NOT DISTINCT FROM $3
         RETURNING key`,
        [key, JSON.stringify(next), cur.raw]
      );
      if (r && ((r.rowCount > 0) || (r.rows && r.rows.length))) return { ok: true, value: next };
    }
    const err = new Error('Arşiv aynı anda güncellendi, tekrar deneyin.');
    err.status = 409;
    err.code = 'LIMAN_ARCHIVE_CONFLICT';
    throw err;
  }

  /** Arşiv ile canlı listenin aynı olup olmadığını anlamak için (anlık durum / not hariç). */
  function dayFingerprint(day) {
    const shape = (day.blocks || []).map((block) => [
      block.title, block.sip || '',
      (block.rows || []).map((row) => [row.irsaliye, row.plaka, row.bbt, row.cuval, row.bosCuval, row.net, row.giden, row.sofor, row.telefon, row.tasiyici]),
    ]);
    return crypto.createHash('sha1').update(JSON.stringify(shape)).digest('hex').slice(0, 16);
  }

  function archiveBlocks(day) {
    return (day.blocks || []).map((block) => ({
      title: block.title || '',
      liman: block.liman || '',
      gemi: block.gemi || '',
      booking: block.booking || '',
      sevk: block.sevk || '',
      dolum: block.dolum || '',
      sip: block.sip || '',
      note: block.note || '',
      tolerans: block.tolerans || '',
      exportLine: block.exportLine || '',
      tasiyici: block.tasiyici || '',
      yd: block.yd || '',
      lot: block.lot || '',
      fileName: (block.files && block.files[0]) || '',
      toplam: block.toplam || null,
      kalan: block.kalan || null,
      rows: (block.rows || []).map((row) => {
        const out = {};
        ARCHIVE_ROW_FIELDS.forEach((field) => { out[field] = row[field] == null ? '' : row[field]; });
        return out;
      }),
    }));
  }

  function archiveSummary(rec) {
    const blocks = Array.isArray(rec.blocks) ? rec.blocks : [];
    return {
      dateKey: rec.dateKey,
      label: rec.label,
      closedAt: rec.closedAt || '',
      closedBy: rec.closedBy || '',
      fp: rec.fp || '',
      blockCount: blocks.length,
      rowCount: blocks.reduce((sum, block) => sum + ((block.rows && block.rows.length) || 0), 0),
      recovered: !!rec.recovered,
      check: rec.check || null,
    };
  }

  async function writeArchiveIndex(rec) {
    await updateKvJson(ARCHIVE_INDEX_KEY, (idx) => {
      const next = idx && typeof idx === 'object' ? idx : {};
      next[rec.dateKey] = archiveSummary(rec);
      return next;
    });
  }

  /** Günün iki kantardan birleşmiş son halini mühürler. İçerik aynıysa önceki kontrol sonucu korunur. */
  async function archiveDay(state, key, by) {
    const day = daysFromSheetState(state).find((d) => d.dateKey === key);
    if (!day) return null;
    const fp = dayFingerprint(day);
    const saved = await updateKvJson(ARCHIVE_PREFIX + key, (prev) => ({
      dateKey: key,
      label: day.label,
      closedAt: new Date().toISOString(),
      closedBy: by,
      fp,
      blocks: archiveBlocks(day),
      check: prev && prev.fp === fp ? (prev.check || null) : null,
    }));
    await writeArchiveIndex(saved.value);
    return saved.value;
  }

  /** Kantarın bildirdiği yer; yoksa listedeki yükleme yerlerinin çoğunluğu. */
  function siteFromPayload(guess, blocks, rows) {
    const direct = normalizeSite(guess);
    if (direct) return direct;
    const count = {};
    const add = (raw) => {
      const s = String(raw || '').toUpperCase();
      const site = s.indexOf('OSB') >= 0 ? '1.OSB' : (s.indexOf('AVDAN') >= 0 ? 'AVDAN' : '');
      if (site) count[site] = (count[site] || 0) + 1;
    };
    blocks.forEach((b) => (b.rows || []).forEach((r) => add(r.yukleme)));
    if (!blocks.length) rows.forEach((r) => add(r.yuklemeYeri));
    const sorted = Object.keys(count).sort((a, b) => count[b] - count[a]);
    return sorted[0] || '';
  }

  function snapshotRowCount(snap) {
    if (!snap) return 0;
    if (siteHasBlocks(snap)) {
      return snap.blocks.reduce((sum, block) => sum + ((block.rows && block.rows.length) || 0), 0);
    }
    return Array.isArray(snap.rows) ? snap.rows.length : 0;
  }

  /** Kantarın yüklediği Excel'ler, kantardaki yükleme sırasıyla ("a.xlsx + b.xlsx" + blok dosyaları). */
  function snapshotFileLabels(snap) {
    const out = [];
    const add = (name) => {
      const label = fileLabelOf(name);
      if (label && out.indexOf(label) < 0) out.push(label);
    };
    if (!snap) return out;
    String(snap.fileName || '').split(/\s+\+\s+/).forEach(add);
    (snap.blocks || []).forEach((block) => add(block.fileName));
    return out;
  }

  /** Alt sekmeler yükleme sırasına dizilsin: her Excel'in limana ilk geldiği an saklanır. */
  function noteFileSeen(state, snap) {
    const now = Date.now();
    const seen = {};
    const known = fileOrder(state);
    let next = now;
    Object.keys(known).forEach((label) => {
      const at = Date.parse(known[label]) || 0;
      if (!at || now - at > CLOSED_DAY_TTL_MS) return;
      seen[label] = known[label];
      if (at >= next) next = at + 1;
    });
    snapshotFileLabels(snap).forEach((label) => {
      if (!seen[label]) seen[label] = new Date(next++).toISOString();
    });
    state.fileSeen = seen;
  }

  /** Kayıtlı ilk geliş anı; eski kayıtlarda kantar listesindeki sıra (liste alınma anı + sıra) kullanılır. */
  function fileOrder(state) {
    const out = Object.assign({}, state.fileSeen || {});
    SITES.forEach((site) => {
      const snap = state.sites[site];
      if (!snap) return;
      const base = Date.parse(snap.receivedAt || snap.updatedAt || '') || 0;
      snapshotFileLabels(snap).forEach((label, i) => {
        if (!out[label]) out[label] = new Date(base + i).toISOString();
      });
    });
    return out;
  }

  function heartbeats(state) {
    return state && state.heartbeats && typeof state.heartbeats === 'object' ? state.heartbeats : {};
  }

  function publicSites(state) {
    const out = {};
    const hb = heartbeats(state);
    const doneFiles = labelsReadyToDelete(state);
    const openName = (raw) => withoutSettledFiles(raw, doneFiles);
    SITES.forEach((site) => {
      const snap = state.sites[site];
      const beat = hb[site] || null;
      const fileName = openName(snap && snap.fileName);
      const heartbeatFile = openName(beat && beat.fileName);
      const stillLoaded = !!(fileName || heartbeatFile);
      out[site] = (snap || beat) ? {
        fileName,
        updatedAt: (snap && snap.updatedAt) || '',
        receivedAt: (snap && (snap.receivedAt || snap.updatedAt)) || '',
        user: (snap && snap.user) || (beat && beat.user) || '',
        rowCount: snapshotRowCount(snap),
        hasList: !!snap,
        // Kantar PC'nin son nabzı (10 dk otomatik döngü): bağlı mı, Excel yüklü mü, oturum kimde
        heartbeatAt: (beat && beat.at) || '',
        heartbeatExcel: stillLoaded ? (beat ? !!beat.excel : null) : false,
        heartbeatFile,
        // Son otomatik/elle Excel okumasının sonucu: true okundu, false okunamadı, null bilinmiyor (eski istemci)
        heartbeatReadOk: beat && typeof beat.readOk === 'boolean' ? beat.readOk : null,
        heartbeatReadReason: (beat && beat.readReason) || '',
        heartbeatReadOkAt: (beat && beat.readOkAt) || '',
      } : null;
    });
    return out;
  }

  /** Nakliyeci (GPM / AKYÜZ) iç bilgi: liman görevlisi ve gözetmen görmez. */
  function withoutTasiyici(days) {
    return days.map((day) => Object.assign({}, day, {
      blocks: day.blocks.map((block) => {
        const { tasiyici, ...rest } = block;
        return Object.assign(rest, {
          rows: (block.rows || []).map((row) => {
            const { tasiyici: _t, ...r } = row;
            return r;
          }),
        });
      }),
    }));
  }

  function rememberStamps(state) {
    sheetStamp = sheetStampOf(state);
    heartbeatStamp = heartbeatStampOf(state);
    heartbeatBrief = heartbeatBriefOf(state);
    stampsLoadedAt = Date.now();
  }

  async function ensureStamps() {
    const fresh = stampsLoadedAt && (Date.now() - stampsLoadedAt < STAMP_REFRESH_MS) && version !== '';
    if (fresh) return;
    if (!stampsPromise) {
      stampsPromise = (async () => {
        rememberStamps(await readState());
      })().finally(() => { stampsPromise = null; });
    }
    await stampsPromise;
  }

  function printMarkTtl() {
    const n = Number(process.env.LIMAN_PRINT_MARK_MS);
    return Number.isFinite(n) && n >= 0 ? n : PRINT_MARK_TTL_MS;
  }

  async function lastPrintMark() {
    if (printMarkCache.at && Date.now() - printMarkCache.at < printMarkTtl()) return printMarkCache.value;
    let lastPrint = null;
    try {
      const pr = await q('SELECT MAX(tarih) AS t FROM print_history');
      lastPrint = (pr.rows[0] && pr.rows[0].t != null) ? String(pr.rows[0].t) : null;
    } catch (_) { /* baskı bilgisi yoksa yalnız liste sürümü */ }
    printMarkCache = { at: Date.now(), value: lastPrint };
    return lastPrint;
  }

  /** Liste içeriği (giden tonaj / durum). Nabız bu damgayı değiştirmez; liman sayfası bunu izler. */
  function sheetStampOf(state) {
    const sites = {};
    SITES.forEach((site) => {
      const snap = state && state.sites && state.sites[site];
      if (!snap) return;
      sites[site] = {
        fileName: snap.fileName || '',
        blocks: snap.blocks || [],
        rows: snap.rows || [],
      };
    });
    return crypto.createHash('sha1').update(JSON.stringify(sites)).digest('hex').slice(0, 12);
  }

  /** Kantar nabzı. Liste damgasını değiştirmez; amir ekranındaki Excel durumu bunu izler. */
  function heartbeatStampOf(state) {
    return crypto.createHash('sha1').update(JSON.stringify(heartbeats(state))).digest('hex').slice(0, 12);
  }

  /** Nabız özeti: liman sayfası tam listeyi indirmeden Excel durumunu günceller. */
  function heartbeatBriefOf(state) {
    const hb = heartbeats(state);
    const out = {};
    SITES.forEach((site) => {
      const beat = hb[site] || null;
      const snap = state && state.sites && state.sites[site];
      if (!beat && !snap) return;
      out[site] = {
        heartbeatAt: (beat && beat.at) || '',
        heartbeatReadOk: beat && typeof beat.readOk === 'boolean' ? beat.readOk : null,
        heartbeatReadReason: (beat && beat.readReason) || '',
        heartbeatReadOkAt: (beat && beat.readOkAt) || '',
        receivedAt: (snap && (snap.receivedAt || snap.updatedAt)) || '',
        updatedAt: (snap && snap.updatedAt) || '',
      };
    });
    return out;
  }

  function noStore(res) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('CDN-Cache-Control', 'no-store');
    res.setHeader('Vercel-CDN-Cache-Control', 'no-store');
  }

  function viewFor(req, state) {
    rememberStamps(state);
    const amir = isAmirUser(req);
    const days = openDays(state);
    return {
      ok: true,
      version,
      sheet: sheetStamp,
      h: heartbeatStamp,
      canEdit: amir,
      // Kapat / yeniden aç / listeyi kaldır: yalnız Selahattin Toker
      canClose: canManageLimanList(req.user),
      sites: publicSites(state),
      days: amir ? days : withoutTasiyici(days),
      // Alt sekme sırası: Excel'in ilk geliş anı (soldan sağa ilk yüklenenden son yüklenene)
      fileOrder: fileOrder(state),
      // Kapatılan günler: amir yeniden açabilsin, liman görevlisi "sevkiyat bitti" diye anlasın
      closedDays: closedDayList(state),
      // Yalnız amir: gönderim günlüğü (kabul / aynı / nabız / red)
      events: amir ? events.slice(0, EVENT_MAX) : undefined,
      presence: amir && presence && typeof presence.snapshot === 'function' ? presence.snapshot() : undefined,
    };
  }

  function dayKeyParam(req) {
    const key = String((req.params && req.params.dateKey) || '').trim();
    return DAY_KEY_RE.test(key) ? key : '';
  }

  // --- Okuma uçları (oturumsuz) ---
  const reader = publicApp || api;
  const readPrefix = publicApp ? '/api' : '';

  /** Kapalı günün mühürü boşsa kantar baskılarından arşive yazar. Dolu arşive dokunmaz. */
  async function healClosedArchives(state) {
    const closed = closedDays(state);
    const keys = Object.keys(closed).filter((key) => DAY_KEY_RE.test(key));
    if (!keys.length) return;
    const idx = (await readKvJson(ARCHIVE_INDEX_KEY)).value || {};
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      if (idx[key] && Number(idx[key].rowCount) > 0) continue;
      const cur = await readKvJson(ARCHIVE_PREFIX + key);
      if (cur.value && Array.isArray(cur.value.blocks) && cur.value.blocks.length) {
        if (!idx[key]) {
          await writeArchiveIndex(cur.value);
          idx[key] = archiveSummary(cur.value);
        }
        continue;
      }
      const r = await q(
        `SELECT tarih, snapshot FROM print_history
         WHERE COALESCE((NULLIF(btrim(snapshot), ''))::json->>'excelDateKey', '') = $1`,
        [key]
      );
      const prints = [];
      (r.rows || []).forEach((row) => {
        let snapshot = null;
        try { snapshot = row.snapshot ? JSON.parse(row.snapshot) : null; } catch (_) { snapshot = null; }
        if (snapshot) prints.push({ snapshot, ts: Number(row.tarih) || 0 });
      });
      const rebuilt = buildArchiveFromPrints(prints, key, closed[key]);
      if (!rebuilt) continue;
      const saved = await updateKvJson(ARCHIVE_PREFIX + key, () => rebuilt);
      await writeArchiveIndex(saved.value);
      idx[key] = archiveSummary(saved.value);
    }
  }

  async function attachArchive(view, state) {
    if (!view || !view.canClose) return view;
    if (state) {
      try { await healClosedArchives(state); } catch (err) {
        console.warn('[liman] kapalı gün arşive tamamlanamadı', (err && err.message) || err);
      }
    }
    const idx = (await readKvJson(ARCHIVE_INDEX_KEY)).value || {};
    view.archive = Object.keys(idx).filter((key) => DAY_KEY_RE.test(key)).sort().reverse().map((key) => {
      const s = idx[key] || {};
      return {
        dateKey: s.dateKey || key,
        label: s.label || labelFromDateKey(key),
        closedAt: s.closedAt || '',
        closedBy: s.closedBy || '',
        rowCount: s.rowCount || 0,
        blockCount: s.blockCount || 0,
        recovered: !!s.recovered,
      };
    });
    return view;
  }

  async function clearArchive(key) {
    await q(
      `INSERT INTO kv_store(key, value) VALUES($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [ARCHIVE_PREFIX + key, '']
    );
    await updateKvJson(ARCHIVE_INDEX_KEY, (idx) => {
      const next = idx && typeof idx === 'object' ? Object.assign({}, idx) : {};
      if (!next[key]) return undefined;
      delete next[key];
      return next;
    });
  }

  reader.get(readPrefix + '/liman', attachOptionalUser, async (req, res) => {
    try {
      if (!(await limanReaderAllowed(req))) return rejectLimanReader(res);
      noStore(res);
      const state = await readState();
      return res.json(await attachArchive(viewFor(req, state), state));
    } catch (err) {
      return sendApiError(res, err, 500, 'LIMAN_READ_FAILED');
    }
  });

  reader.get(readPrefix + '/liman/version', attachOptionalUser, async (req, res) => {
    try {
      if (!(await limanReaderAllowed(req))) return rejectLimanReader(res);
      await ensureStamps();
      const lastPrint = await lastPrintMark();
      noStore(res);
      return res.json({ v: version, p: lastPrint, s: sheetStamp, h: heartbeatStamp, hb: heartbeatBrief });
    } catch (err) {
      return sendApiError(res, err, 500, 'LIMAN_VERSION_FAILED');
    }
  });

  /**
   * Sarılmış (çıkış yapmış) işareti için kantar baskılarının küçültülmüş akışı.
   * Listeyle aynı kapı: ofis oturumu veya liman çerezi ister. Şoför adı ve telefon giriş yapana görünür.
   */
  reader.get(readPrefix + '/liman/departed', attachOptionalUser, async (req, res) => {
    try {
      if (!(await limanReaderAllowed(req))) return rejectLimanReader(res);
      const now = Date.now();
      let since = Number(req.query && req.query.since);
      if (!Number.isFinite(since) || since <= 0 || now - since > DEPARTED_MAX_WINDOW_MS) since = now - 3 * 24 * 60 * 60 * 1000;
      const printMark = await lastPrintMark();
      const cacheKey = Math.floor(since / (60 * 60 * 1000)) + ':' + (printMark || '');
      if (departedCache.key === cacheKey && Date.now() - departedCache.at < DEPARTED_CACHE_MS && Array.isArray(departedCache.body)) {
        noStore(res);
        return res.json(departedCache.body);
      }
      const r = await q(
        'SELECT ' + printHistoryListColumns(true) + ', ' + printHistoryKantarSelect() + ', ' + printHistoryExcelDaySelect() +
        ' FROM print_history WHERE tarih >= $1 ORDER BY tarih DESC LIMIT $2',
        [since, DEPARTED_MAX_ROWS]
      );
      const out = [];
      (r.rows || []).forEach((row) => {
        try {
          const m = mapPrintHistoryRowToReport(row, { slim: true });
          const d = m.data || {};
          if (!d.excelDateKey && row.excel_date_key) d.excelDateKey = String(row.excel_date_key);
          if (!d.excelFileName && row.excel_file_name) d.excelFileName = String(row.excel_file_name);
          const inst = typeof formatReportInstant === 'function' ? formatReportInstant(m.ts) : { tarih: '', saat: '' };
          out.push({
            type: 'PRINT',
            ts: m.ts,
            tarih: inst.tarih,
            saat: inst.saat,
            plaka: d.plaka || '',
            firma: m.firma || '',
            data: departedDataFields(d, inst),
          });
        } catch (_) { /* bozuk satır atlanır */ }
      });
      departedCache = { key: cacheKey, at: Date.now(), body: out };
      noStore(res);
      return res.json(out);
    } catch (err) {
      return sendApiError(res, err, 500, 'LIMAN_DEPARTED_FAILED');
    }
  });

  // --- Kantar yazma uçları: publicApp verildiyse app'e (kendi oturum kontrolü + günlük), yoksa router'a ---
  const writer = publicApp || api;
  const writePrefix = publicApp ? '/api' : '';
  const kantarAuth = publicApp ? requireKantarSession : requireValidSession;

  /** Kantar PC nabzı: 10 dk döngüsünde Excel değişmese de "bağlıyım" der. */
  writer.put(writePrefix + '/liman/heartbeat', kantarAuth, async (req, res) => {
    try {
      if (isAmirUser(req)) return res.json({ ok: true, skipped: true });
      notePresence(req);
      const body = req.body || {};
      const site = normalizeSite(req.user && req.user.username) || ipSite(requestIp(req)) || normalizeSite(body.site);
      if (!site) return res.status(400).json({ ok: false, error: 'Kantar anlaşılamadı.' });
      const readOk = typeof body.readOk === 'boolean' ? body.readOk : null;
      const committed = await commitState((state) => {
        const hb = Object.assign({}, heartbeats(state));
        const prev = hb[site] || {};
        const at = new Date().toISOString();
        const openFile = withoutSettledFiles(sanitizeString(body.fileName || '', 180), labelsReadyToDelete(state));
        hb[site] = {
          at,
          user: sanitizeString((req.user && req.user.username) || '', 40),
          ip: requestIp(req),
          excel: !!body.excelLoaded && !!openFile,
          fileName: openFile,
          // Okuma sonucu taşımayan nabız (sayfa açılışı) son bilinen sonucu silmez
          readOk: readOk === null ? (typeof prev.readOk === 'boolean' ? prev.readOk : null) : readOk,
          readReason: readOk === false ? sanitizeString(body.readReason || '', 40) : (readOk === null ? (prev.readReason || '') : ''),
          readOkAt: readOk === true ? at : (prev.readOkAt || ''),
        };
        state.heartbeats = hb;
        return { site, at: hb[site].at };
      }, { silent: true });
      if (committed.conflict) return res.status(409).json({ ok: false, error: committed.error });
      logEvent('heartbeat', req, { site, excel: !!body.excelLoaded, readOk });
      res.setHeader('Cache-Control', 'no-store');
      return res.json({
        ok: true,
        site,
        at: committed.at,
        dropFiles: labelsReadyToDelete(committed.state),
      });
    } catch (err) {
      logEvent('error', req, { path: 'heartbeat', error: String(err && err.message || err) });
      return sendApiError(res, err, 500, 'LIMAN_HEARTBEAT_FAILED');
    }
  });

  writer.put(writePrefix + '/liman/snapshot', kantarAuth, async (req, res) => {
    try {
      const body = req.body || {};
      if (isAmirUser(req)) {
        return res.json({ ok: true, skipped: true });
      }
      notePresence(req);
      const fileName = sanitizeString(body.fileName || '', 180);
      const incoming = Array.isArray(body.rows) ? body.rows.slice(0, MAX_ROWS) : [];
      const blocks = sanitizeBlocks(body.blocks);
      const site = normalizeSite(req.user && req.user.username)
        || ipSite(requestIp(req))
        || siteFromPayload(body.site, blocks, incoming);
      if (!site) {
        logEvent('error', req, { path: 'snapshot', error: 'site-unknown' });
        return res.status(400).json({ ok: false, error: 'Kantar (AVDAN / 1.OSB) anlaşılamadı. Basım yerini seçin.' });
      }
      const rows = incoming.map((row) => slimRow(row, site, fileName)).filter((row) => {
        return row.irsaliyeNo || row.plaka || row.headerText;
      });
      const incomingBlocks = blocks;
      const confirmDrop = body.confirmDrop === true;
      const dropInfo = (state) => ({
        dropFiles: labelsReadyToDelete(state),
        dropPending: pendingDropLabels(state),
      });
      // Silme kilidi yalnız ikinci Güncelle'den (veya amirin kapattığı günden) sonra. İlk gönderim veriyi yazar.
      const dropSetOf = (state) => new Set(labelsReadyToDelete(state).map((label) => label.toLowerCase()));
      const blockIsSettled = (block, state) => {
        const label = (fileLabelOf(block && block.fileName) || fileLabelOf(fileName) || '').toLowerCase();
        return !!(label && dropSetOf(state).has(label));
      };
      const snapshot = {
        fileName,
        updatedAt: new Date().toISOString(),
        user: sanitizeString((req.user && req.user.username) || '', 40),
        rows: incomingBlocks.length ? [] : rows,
        blocks: incomingBlocks,
      };
      const committed = await commitState((state) => {
        const prev = state.sites[site];
        const prevSiteBlocks = prev && Array.isArray(prev.blocks) ? prev.blocks : [];
        const carryFrom = prevSiteBlocks.slice();
        Object.keys(state.sites).forEach((other) => {
          const snap = state.sites[other];
          if (other !== site && snap && Array.isArray(snap.blocks)) carryFrom.push(...snap.blocks);
        });
        const activeBlocks = incomingBlocks.filter((block) => !blockIsSettled(block, state) && !blockIsClosed(block, state, fileName));
        const activeRows = rows.filter((row) => !blockIsSettled(row, state) && !blockIsClosed(row, state, fileName));
        // Onaylanmış (ikinci Güncelle) veya amirin kapattığı Excel bir daha işlenmez.
        if (incomingBlocks.length && !activeBlocks.length) {
          return Object.assign({ shortCircuit: true, unchanged: true, settled: true }, dropInfo(state));
        }
        if (!incomingBlocks.length && rows.length && !activeRows.length) {
          return Object.assign({ shortCircuit: true, unchanged: true, settled: true }, dropInfo(state));
        }
        // Boş gönderim (Excel silindi) listeyi silmez. Dolu gönderim: o dosya güncellenir, yeni kitap eklenir, eksik kitap durur.
        if (activeBlocks.length) {
          snapshot.fileName = fileName;
          snapshot.blocks = retainDroppedBooks(
            prevSiteBlocks,
            carryTasiyici(carryFrom, activeBlocks),
            prev && prev.fileName,
            fileName
          );
          snapshot.rows = [];
        } else if (!activeRows.length) {
          snapshot.fileName = (prev && prev.fileName) || fileName;
          snapshot.blocks = prevSiteBlocks.slice();
          snapshot.rows = prev && Array.isArray(prev.rows) ? prev.rows : [];
        } else {
          snapshot.fileName = fileName;
          snapshot.blocks = [];
          snapshot.rows = activeRows;
        }
        const openLabels = labelsReadyToDelete(Object.assign({}, state, {
          sites: Object.assign({}, state.sites, { [site]: snapshot }),
        }));
        snapshot.fileName = withoutSettledFiles(snapshot.fileName || fileName, openLabels);
        const sameContent = prev && prev.fileName === snapshot.fileName
          && JSON.stringify(prev.blocks || []) === JSON.stringify(snapshot.blocks)
          && JSON.stringify(prev.rows || []) === JSON.stringify(snapshot.rows);
        noteFileSeen(state, snapshot);
        if (sameContent) {
          state.sites[site] = Object.assign({}, prev, { receivedAt: snapshot.updatedAt });
        } else {
          snapshot.receivedAt = snapshot.updatedAt;
          state.sites[site] = snapshot;
        }
        // Veri yazıldıktan sonra: ancak bu istek "tekrar Güncelle" ise Excel silinsin.
        if (confirmDrop) confirmSettledLabels(state, snapshotFileLabels(state.sites[site]));
        return Object.assign({ unchanged: !!sameContent, silent: !!sameContent }, dropInfo(state));
      }, { silent: false });
      if (committed.conflict) return res.status(409).json({ ok: false, error: committed.error });
      const dropFiles = committed.dropFiles || [];
      const dropPending = committed.dropPending || [];
      if (committed.settled) {
        return res.json({ ok: true, site, unchanged: true, settled: true, dropFiles, dropPending });
      }
      if (committed.unchanged) {
        logEvent('unchanged', req, { site, fileName, rows: snapshotRowCount(snapshot) });
        return res.json({ ok: true, site, unchanged: true, dropFiles, dropPending });
      }
      logEvent('changed', req, { site, fileName, rows: snapshotRowCount(snapshot) });
      return res.json({ ok: true, site, dropFiles, dropPending });
    } catch (err) {
      logEvent('error', req, { path: 'snapshot', error: String(err && err.message || err) });
      return sendApiError(res, err, 500, 'LIMAN_SNAPSHOT_FAILED');
    }
  });

  api.delete('/liman/snapshot/:site', requireAmir, async (req, res) => {
    try {
      if (!canManageLimanList(req.user)) {
        return res.status(403).json({ ok: false, error: 'Listeyi kaldırmak yalnızca Selahattin Toker hesabına açıktır.' });
      }
      const site = normalizeSite(req.params.site);
      if (!site) return res.status(400).json({ ok: false, error: 'Geçersiz yükleme yeri.' });
      const committed = await commitState((state) => {
        state.sites[site] = null;
      });
      if (committed.conflict) return res.status(409).json({ ok: false, error: committed.error });
      return res.json(viewFor(req, committed.state));
    } catch (err) {
      return sendApiError(res, err, 500, 'LIMAN_SNAPSHOT_DELETE_FAILED');
    }
  });

  api.put('/liman/note', requireAmir, async (req, res) => {
    try {
      const body = req.body || {};
      const key = irsaliyeKey({ irsaliyeNo: body.irsaliye });
      if (!key) return res.status(400).json({ ok: false, error: 'İrsaliye gerekli.' });
      const note = sanitizeString(body.note || '', 240);
      const committed = await commitState((state) => {
        if (!state.notes || typeof state.notes !== 'object') state.notes = {};
        if (note) state.notes[key] = note;
        else delete state.notes[key];
      });
      if (committed.conflict) return res.status(409).json({ ok: false, error: committed.error });
      return res.json({ ok: true, days: openDays(committed.state) });
    } catch (err) {
      return sendApiError(res, err, 500, 'LIMAN_NOTE_FAILED');
    }
  });

  // Selahattin Toker: sevkiyat bitince günü kapatır. Son hali arşive mühürlenir,
  // canlı listeden düşer. Kantar aynı Excel'i tekrar gönderse de limanda açılmaz.
  api.put('/liman/day/:dateKey/close', requireAmir, async (req, res) => {
    try {
      if (!canManageLimanList(req.user)) {
        return res.status(403).json({ ok: false, error: 'Listeyi kapatmak yalnızca Selahattin Toker hesabına açıktır.' });
      }
      const key = dayKeyParam(req);
      if (!key) return res.status(400).json({ ok: false, error: 'Geçersiz gün.' });
      const by = sanitizeString((req.user && req.user.username) || '', 40);
      const archived = await archiveDay(await readState(), key, by);
      if (!archived) return res.status(404).json({ ok: false, error: 'Bu güne ait liste yok.' });
      const committed = await commitState((state) => {
        if (!daysFromSheetState(state).some((day) => day.dateKey === key) && !closedDays(state)[key]) {
          return { shortCircuit: true, missing: true };
        }
        suppressDay(state, key, by);
      });
      if (committed.missing) return res.status(404).json({ ok: false, error: 'Bu güne ait liste yok.' });
      if (committed.conflict) return res.status(409).json({ ok: false, error: committed.error });
      return res.json(await attachArchive(viewFor(req, committed.state), committed.state));
    } catch (err) {
      return sendApiError(res, err, 500, 'LIMAN_DAY_CLOSE_FAILED');
    }
  });

  // Kapanan gün limanda yeniden açılmaz. Eski istemci bu ucu çağırırsa liste geri gelmez.
  api.delete('/liman/day/:dateKey/close', requireAmir, async (req, res) => {
    try {
      if (!canManageLimanList(req.user)) {
        return res.status(403).json({ ok: false, error: 'Kapalı listeyi açmak yalnızca Selahattin Toker hesabına açıktır.' });
      }
      const key = dayKeyParam(req);
      if (!key) return res.status(400).json({ ok: false, error: 'Geçersiz gün.' });
      return res.status(409).json({ ok: false, error: 'Kapanan liste yeniden açılmaz. Arşivden silinebilir.' });
    } catch (err) {
      return sendApiError(res, err, 500, 'LIMAN_DAY_REOPEN_FAILED');
    }
  });

  /** Açık listeyi arşive koymadan siler. Kantar aynı dosyayı gönderse de limanda görünmez. */
  api.delete('/liman/day/:dateKey', requireAmir, async (req, res) => {
    try {
      if (!canManageLimanList(req.user)) {
        return res.status(403).json({ ok: false, error: 'Listeyi silmek yalnızca Selahattin Toker hesabına açıktır.' });
      }
      const key = dayKeyParam(req);
      if (!key) return res.status(400).json({ ok: false, error: 'Geçersiz gün.' });
      const by = sanitizeString((req.user && req.user.username) || '', 40);
      const committed = await commitState((state) => {
        const exists = daysFromSheetState(state).some((day) => day.dateKey === key) || closedDays(state)[key];
        if (!exists) return { shortCircuit: true, missing: true };
        suppressDay(state, key, by);
      });
      if (committed.missing) return res.status(404).json({ ok: false, error: 'Bu güne ait liste yok.' });
      if (committed.conflict) return res.status(409).json({ ok: false, error: committed.error });
      await clearArchive(key);
      return res.json(await attachArchive(viewFor(req, committed.state), committed.state));
    } catch (err) {
      return sendApiError(res, err, 500, 'LIMAN_DAY_DELETE_FAILED');
    }
  });

  // --- Arşiv (yalnız amir): sayı kontrol kapanmış sevkiyatı Excel yerine buradan alır ---
  api.get('/liman/archive', requireAmir, async (req, res) => {
    try {
      const idx = (await readKvJson(ARCHIVE_INDEX_KEY)).value || {};
      const live = Object.create(null);
      daysFromSheetState(await readState()).forEach((day) => { live[day.dateKey] = dayFingerprint(day); });
      const days = Object.keys(idx).filter((key) => DAY_KEY_RE.test(key)).sort().reverse().map((key) => {
        const s = idx[key] || {};
        return Object.assign({}, s, {
          // Kapandıktan sonra kantardan farklı liste geldi: arşiv eski kalmış olabilir
          changedSinceClose: !!(live[key] && s.fp && live[key] !== s.fp),
        });
      });
      res.setHeader('Cache-Control', 'no-store');
      return res.json({ ok: true, days });
    } catch (err) {
      return sendApiError(res, err, 500, 'LIMAN_ARCHIVE_LIST_FAILED');
    }
  });

  function excelFileName(label) {
    const s = String(label || '').trim();
    if (!s) return '';
    if (/\.xlsx?$/i.test(s)) return s;
    return s + '.xlsx';
  }

  function siteForArchive(rec) {
    const count = { AVDAN: 0, '1.OSB': 0 };
    (rec.blocks || []).forEach((block) => (block.rows || []).forEach((row) => {
      const raw = String(row.yukleme || '').toUpperCase();
      if (raw.indexOf('OSB') >= 0) count['1.OSB'] += 1;
      else if (raw.indexOf('AVDAN') >= 0) count.AVDAN += 1;
    }));
    return count['1.OSB'] > count.AVDAN ? '1.OSB' : 'AVDAN';
  }

  /** Arşivdeki günü liman listesine geri koyar. Klasördeki kopya durur. */
  function restoreArchivedDay(state, rec) {
    const key = rec.dateKey;
    const next = Object.assign({}, closedDays(state));
    delete next[key];
    state.closedDays = next;
    const fallback = excelFileName(rec.label || labelFromDateKey(key));
    const blocks = (rec.blocks || []).map((block) => Object.assign({}, block, {
      fileName: block.fileName || fallback,
    }));
    const site = siteForArchive(rec);
    const prev = state.sites[site] && typeof state.sites[site] === 'object' ? state.sites[site] : {};
    const kept = (Array.isArray(prev.blocks) ? prev.blocks : []).filter((block) => {
      return (dateKeyFromFileName(block.fileName || prev.fileName || '') || 'tarihsiz') !== key;
    });
    const names = [];
    const addName = (raw) => {
      const label = fileLabelOf(raw);
      if (label && names.indexOf(label) < 0) names.push(label);
    };
    String(prev.fileName || '').split(/\s+\+\s+/).forEach(addName);
    blocks.forEach((block) => addName(block.fileName));
    state.sites[site] = Object.assign({}, prev, {
      fileName: names.map((label) => excelFileName(label)).join(' + ') || fallback,
      blocks: kept.concat(blocks),
      rows: Array.isArray(prev.rows) ? prev.rows.filter((row) => (dateKeyFromFileName(row.fileName || prev.fileName || '') || '') !== key) : [],
      updatedAt: new Date().toISOString(),
    });
  }

  api.post('/liman/archive/:dateKey/restore', requireAmir, async (req, res) => {
    try {
      if (!canManageLimanList(req.user)) {
        return res.status(403).json({ ok: false, error: 'Arşivden geri almak yalnızca Selahattin Toker hesabına açıktır.' });
      }
      const key = dayKeyParam(req);
      if (!key) return res.status(400).json({ ok: false, error: 'Geçersiz gün.' });
      const rec = (await readKvJson(ARCHIVE_PREFIX + key)).value;
      if (!rec || !Array.isArray(rec.blocks)) return res.status(404).json({ ok: false, error: 'Bu gün arşivde yok.' });
      const committed = await commitState((state) => {
        restoreArchivedDay(state, rec);
      });
      if (committed.conflict) return res.status(409).json({ ok: false, error: committed.error });
      return res.json(await attachArchive(viewFor(req, committed.state), committed.state));
    } catch (err) {
      return sendApiError(res, err, 500, 'LIMAN_ARCHIVE_RESTORE_FAILED');
    }
  });

  api.delete('/liman/archive/:dateKey', requireAmir, async (req, res) => {
    try {
      if (!canManageLimanList(req.user)) {
        return res.status(403).json({ ok: false, error: 'Arşivi silmek yalnızca Selahattin Toker hesabına açıktır.' });
      }
      const key = dayKeyParam(req);
      if (!key) return res.status(400).json({ ok: false, error: 'Geçersiz gün.' });
      const rec = (await readKvJson(ARCHIVE_PREFIX + key)).value;
      const idx = (await readKvJson(ARCHIVE_INDEX_KEY)).value || {};
      if (!rec && !idx[key]) return res.status(404).json({ ok: false, error: 'Bu gün arşivde yok.' });
      const by = sanitizeString((req.user && req.user.username) || '', 40);
      const committed = await commitState((state) => {
        if (daysFromSheetState(state).some((day) => day.dateKey === key) || closedDays(state)[key]) {
          suppressDay(state, key, by);
        }
      });
      if (committed.conflict) return res.status(409).json({ ok: false, error: committed.error });
      await clearArchive(key);
      return res.json(await attachArchive(viewFor(req, committed.state), committed.state));
    } catch (err) {
      return sendApiError(res, err, 500, 'LIMAN_ARCHIVE_DELETE_FAILED');
    }
  });

  api.get('/liman/archive/:dateKey', requireAmir, async (req, res) => {
    try {
      const key = dayKeyParam(req);
      if (!key) return res.status(400).json({ ok: false, error: 'Geçersiz gün.' });
      const rec = (await readKvJson(ARCHIVE_PREFIX + key)).value;
      if (!rec) return res.status(404).json({ ok: false, error: 'Bu gün arşivde yok.' });
      res.setHeader('Cache-Control', 'no-store');
      return res.json({ ok: true, day: rec });
    } catch (err) {
      return sendApiError(res, err, 500, 'LIMAN_ARCHIVE_READ_FAILED');
    }
  });

  api.put('/liman/archive/:dateKey/check', requireAmir, async (req, res) => {
    try {
      const key = dayKeyParam(req);
      if (!key) return res.status(400).json({ ok: false, error: 'Geçersiz gün.' });
      const body = req.body || {};
      const status = body.status === 'ok' ? 'ok' : (body.status === 'bad' ? 'bad' : '');
      if (!status) return res.status(400).json({ ok: false, error: 'Geçersiz sonuç.' });
      const summary = {};
      CHECK_SUMMARY_FIELDS.forEach((field) => {
        const n = Number(body.summary && body.summary[field]);
        summary[field] = Number.isFinite(n) && n >= 0 ? Math.round(n) : 0;
      });
      const check = {
        status,
        at: new Date().toISOString(),
        by: sanitizeString((req.user && req.user.username) || '', 40),
        netsisFile: sanitizeString(body.netsisFile || '', 180),
        summary,
      };
      const saved = await updateKvJson(ARCHIVE_PREFIX + key, (rec) => (rec ? Object.assign({}, rec, { check }) : undefined));
      if (!saved.value) return res.status(404).json({ ok: false, error: 'Bu gün arşivde yok.' });
      await writeArchiveIndex(saved.value);
      return res.json({ ok: true, check });
    } catch (err) {
      return sendApiError(res, err, 500, 'LIMAN_ARCHIVE_CHECK_FAILED');
    }
  });
}

module.exports = { registerLimanRoutes, STATE_KEY, departedDataFields };
