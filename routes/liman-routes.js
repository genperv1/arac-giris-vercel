'use strict';

const jwt = require('jsonwebtoken');
const { SITES, normalizeSite, slimRow, emptyState, irsaliyeKey } = require('../lib/liman-merge');
const { daysFromSheetState, siteHasBlocks, sanitizeBlocks } = require('../lib/liman-sheet');
const { extractAuthTokenFromRequest } = require('../lib/auth-session');
const { printHistoryListColumns, printHistoryKantarSelect, mapPrintHistoryRowToReport } = require('../lib/print-history-report-map');

// Liman görevlisi / gözetmen oturum açmadan bakar: okuma uçları herkese açık,
// çıkış akışı en fazla bu kadar geriye gider.
const DEPARTED_MAX_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const DEPARTED_MAX_ROWS = 3000;

const STATE_KEY = 'liman_state_v1';
const MAX_ROWS = 2000;
// Amirin kapattığı günler bu kadar süre sonra kendiliğinden listeden düşer (kv_store şişmesin).
const CLOSED_DAY_TTL_MS = 45 * 24 * 60 * 60 * 1000;
const DAY_KEY_RE = /^(\d{4}-\d{2}-\d{2}|tarihsiz)$/;
const DEFAULT_SITE_IPS = {
  AVDAN: ['95.3.27.82'],
  '1.OSB': ['195.175.103.150'],
};

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
 * publicApp: opsiyonel; verilirse GET uçları buraya oturumsuz bağlanır
 * (ana express app, '/api' router'ından önce) — liman görevlisi giriş yapmadan bakar.
 */
function registerLimanRoutes(api, ctx, publicApp) {
  const { q, sendApiError, requireValidSession, requireAmir, sanitizeString, getClientIp, normalizeClientIp, formatReportInstant } = ctx;
  const siteIps = loadSiteIps();
  const jwtSecret = ctx.JWT_SECRET || ctx.jwtSecret || process.env.JWT_SECRET || '';

  /** Oturum varsa req.user'ı doldurur; yoksa anonim devam eder (hata vermez). */
  function attachOptionalUser(req, _res, next) {
    if (!req.user && jwtSecret) {
      try {
        const token = extractAuthTokenFromRequest(req, ctx.AUTH_COOKIE_NAME || 'auth_token');
        if (token) req.user = jwt.verify(token, jwtSecret);
      } catch (_) { /* anonim */ }
    }
    next();
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

  // Tek Railway örneği: durum bellekte tutulur, DB yalnız açılışta okunur ve yazmada güncellenir.
  let cachedRaw = null;
  let version = '';

  async function loadRaw() {
    if (cachedRaw !== null) return cachedRaw;
    const r = await q('SELECT value FROM kv_store WHERE key = $1', [STATE_KEY]);
    cachedRaw = (r.rows[0] && r.rows[0].value) || '';
    version = String(Date.now());
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

  async function writeState(state) {
    const raw = JSON.stringify(state);
    if (raw === cachedRaw) return;
    await q(
      `INSERT INTO kv_store(key, value) VALUES($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [STATE_KEY, raw]
    );
    cachedRaw = raw;
    version = String(Date.now());
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
      out[key] = { at: entry.at || '', by: String(entry.by || '').slice(0, 40) };
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
    return daysFromSheetState(state)
      .filter((day) => closed[day.dateKey])
      .map((day) => ({
        dateKey: day.dateKey,
        label: day.label,
        rowCount: day.blocks.reduce((sum, block) => sum + ((block.rows && block.rows.length) || 0), 0),
        at: closed[day.dateKey].at || '',
        by: closed[day.dateKey].by || '',
      }));
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

  function publicSites(state) {
    const out = {};
    SITES.forEach((site) => {
      const snap = state.sites[site];
      out[site] = snap ? {
        fileName: snap.fileName || '',
        updatedAt: snap.updatedAt || '',
        receivedAt: snap.receivedAt || snap.updatedAt || '',
        user: snap.user || '',
        rowCount: snapshotRowCount(snap),
      } : null;
    });
    return out;
  }

  function viewFor(req, state) {
    const amir = isAmirUser(req);
    return {
      ok: true,
      version,
      canEdit: amir,
      sites: publicSites(state),
      days: openDays(state),
      // Kapatılan günler: amir yeniden açabilsin, liman görevlisi "sevkiyat bitti" diye anlasın
      closedDays: closedDayList(state),
    };
  }

  function dayKeyParam(req) {
    const key = String((req.params && req.params.dateKey) || '').trim();
    return DAY_KEY_RE.test(key) ? key : '';
  }

  // --- Okuma uçları (oturumsuz) ---
  const reader = publicApp || api;
  const readPrefix = publicApp ? '/api' : '';

  reader.get(readPrefix + '/liman', attachOptionalUser, async (req, res) => {
    try {
      res.setHeader('Cache-Control', 'no-store');
      return res.json(viewFor(req, await readState()));
    } catch (err) {
      return sendApiError(res, err, 500, 'LIMAN_READ_FAILED');
    }
  });

  reader.get(readPrefix + '/liman/version', async (req, res) => {
    try {
      await loadRaw();
      res.setHeader('Cache-Control', 'no-store');
      return res.json({ v: version });
    } catch (err) {
      return sendApiError(res, err, 500, 'LIMAN_VERSION_FAILED');
    }
  });

  /**
   * Sarılmış (çıkış yapmış) işareti için kantar baskılarının küçültülmüş akışı.
   * /api/reports oturum ister; burada yalnız plaka eşlemesi ve şoför/telefon için gereken alanlar döner.
   */
  reader.get(readPrefix + '/liman/departed', async (req, res) => {
    try {
      const now = Date.now();
      let since = Number(req.query && req.query.since);
      if (!Number.isFinite(since) || since <= 0 || now - since > DEPARTED_MAX_WINDOW_MS) since = now - 3 * 24 * 60 * 60 * 1000;
      const r = await q(
        'SELECT ' + printHistoryListColumns(true) + ', ' + printHistoryKantarSelect() +
        ' FROM print_history WHERE tarih >= $1 ORDER BY tarih DESC LIMIT $2',
        [since, DEPARTED_MAX_ROWS]
      );
      const out = [];
      (r.rows || []).forEach((row) => {
        try {
          const m = mapPrintHistoryRowToReport(row, { slim: true });
          const d = m.data || {};
          const inst = typeof formatReportInstant === 'function' ? formatReportInstant(m.ts) : { tarih: '', saat: '' };
          out.push({
            type: 'PRINT',
            ts: m.ts,
            tarih: inst.tarih,
            saat: inst.saat,
            plaka: d.plaka || '',
            firma: m.firma || '',
            data: {
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
              basimYeri: d.basimYeri || '',
              sofor: d.sofor || '',
              iletisim: d.iletisim || '',
              tarih: inst.tarih,
              saat: inst.saat,
            },
          });
        } catch (_) { /* bozuk satır atlanır */ }
      });
      res.setHeader('Cache-Control', 'no-store');
      return res.json(out);
    } catch (err) {
      return sendApiError(res, err, 500, 'LIMAN_DEPARTED_FAILED');
    }
  });

  api.put('/liman/snapshot', requireValidSession, async (req, res) => {
    try {
      const body = req.body || {};
      if (isAmirUser(req)) {
        return res.json({ ok: true, skipped: true });
      }
      const fileName = sanitizeString(body.fileName || '', 180);
      const incoming = Array.isArray(body.rows) ? body.rows.slice(0, MAX_ROWS) : [];
      const blocks = sanitizeBlocks(body.blocks);
      const site = normalizeSite(req.user && req.user.username)
        || ipSite(requestIp(req))
        || siteFromPayload(body.site, blocks, incoming);
      if (!site) {
        return res.status(400).json({ ok: false, error: 'Kantar (AVDAN / 1.OSB) anlaşılamadı. Basım yerini seçin.' });
      }
      const rows = incoming.map((row) => slimRow(row, site, fileName)).filter((row) => {
        return row.irsaliyeNo || row.plaka || row.headerText;
      });
      const state = await readState();
      const prev = state.sites[site];
      const snapshot = {
        fileName,
        updatedAt: new Date().toISOString(),
        user: sanitizeString((req.user && req.user.username) || '', 40),
        rows: blocks.length ? [] : rows,
        blocks,
      };
      const sameContent = prev && prev.fileName === snapshot.fileName
        && JSON.stringify(prev.blocks || []) === JSON.stringify(snapshot.blocks)
        && JSON.stringify(prev.rows || []) === JSON.stringify(snapshot.rows);
      if (sameContent) {
        // İçerik aynı: updatedAt korunur ama "kantar gönderdi" bilgisi (receivedAt) kaydedilir;
        // amir "liste eski mi, kantar mı göndermedi?" sorusunu buradan ayırt eder.
        state.sites[site] = Object.assign({}, prev, { receivedAt: snapshot.updatedAt });
        await writeState(state);
        return res.json({ ok: true, site, unchanged: true });
      }
      snapshot.receivedAt = snapshot.updatedAt;
      state.sites[site] = snapshot;
      await writeState(state);
      return res.json({ ok: true, site });
    } catch (err) {
      return sendApiError(res, err, 500, 'LIMAN_SNAPSHOT_FAILED');
    }
  });

  api.delete('/liman/snapshot/:site', requireAmir, async (req, res) => {
    try {
      const site = normalizeSite(req.params.site);
      if (!site) return res.status(400).json({ ok: false, error: 'Geçersiz yükleme yeri.' });
      const state = await readState();
      state.sites[site] = null;
      await writeState(state);
      return res.json(viewFor(req, state));
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
      const state = await readState();
      if (!state.notes || typeof state.notes !== 'object') state.notes = {};
      if (note) state.notes[key] = note;
      else delete state.notes[key];
      await writeState(state);
      return res.json({ ok: true, days: openDays(state) });
    } catch (err) {
      return sendApiError(res, err, 500, 'LIMAN_NOTE_FAILED');
    }
  });

  // Amir: sevkiyat bitince günün listesini kapatır. Liman tarafında o gün görünmez;
  // sonraki günün listesi yüklüyse o kalır, yoksa liste boş olur. Kantar aynı dosyayı
  // yeniden gönderse de gün kapalı kalır (tarih dosya adından geldiği için).
  api.put('/liman/day/:dateKey/close', requireAmir, async (req, res) => {
    try {
      const key = dayKeyParam(req);
      if (!key) return res.status(400).json({ ok: false, error: 'Geçersiz gün.' });
      const state = await readState();
      if (!daysFromSheetState(state).some((day) => day.dateKey === key)) {
        return res.status(404).json({ ok: false, error: 'Bu güne ait liste yok.' });
      }
      state.closedDays = Object.assign({}, closedDays(state), {
        [key]: { at: new Date().toISOString(), by: sanitizeString((req.user && req.user.username) || '', 40) },
      });
      await writeState(state);
      return res.json(viewFor(req, state));
    } catch (err) {
      return sendApiError(res, err, 500, 'LIMAN_DAY_CLOSE_FAILED');
    }
  });

  api.delete('/liman/day/:dateKey/close', requireAmir, async (req, res) => {
    try {
      const key = dayKeyParam(req);
      if (!key) return res.status(400).json({ ok: false, error: 'Geçersiz gün.' });
      const state = await readState();
      const next = Object.assign({}, closedDays(state));
      delete next[key];
      state.closedDays = next;
      await writeState(state);
      return res.json(viewFor(req, state));
    } catch (err) {
      return sendApiError(res, err, 500, 'LIMAN_DAY_REOPEN_FAILED');
    }
  });
}

module.exports = { registerLimanRoutes, STATE_KEY };
