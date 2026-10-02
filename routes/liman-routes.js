'use strict';

const { SITES, normalizeSite, slimRow, emptyState, irsaliyeKey } = require('../lib/liman-merge');
const { daysFromSheetState, siteHasBlocks, sanitizeBlocks } = require('../lib/liman-sheet');

const STATE_KEY = 'liman_state_v1';
const MAX_ROWS = 2000;
const MAX_PENDING = 4;

function registerLimanRoutes(api, ctx) {
  const {
    q, sendApiError, requireValidSession, requireAmir, sanitizeString,
    getClientIp, normalizeClientIp, resolveClientSite,
  } = ctx;

  function emptyIps() {
    const out = {};
    SITES.forEach((site) => { out[site] = []; });
    return out;
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
    const base = Object.assign(emptyState(), { ips: emptyIps(), pending: [] });
    if (!raw) return base;
    try {
      const parsed = JSON.parse(raw);
      SITES.forEach((site) => {
        if (parsed.sites && parsed.sites[site]) base.sites[site] = parsed.sites[site];
        if (parsed.ips && Array.isArray(parsed.ips[site])) base.ips[site] = parsed.ips[site].slice(0, 10);
      });
      if (parsed.notes && typeof parsed.notes === 'object') base.notes = parsed.notes;
      if (Array.isArray(parsed.pending)) base.pending = parsed.pending.slice(0, MAX_PENDING);
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

  function requestIp(req) {
    const raw = typeof getClientIp === 'function' ? getClientIp(req) : (req.ip || '');
    return typeof normalizeClientIp === 'function' ? normalizeClientIp(raw) : String(raw || '');
  }

  /** client_sites.json veya amirin onayladığı IP listesi; ikisinde de yoksa ''. */
  function siteForIp(state, ip) {
    if (!ip || ip === 'unknown') return '';
    if (typeof resolveClientSite === 'function') {
      const fromConfig = normalizeSite(resolveClientSite(ip).clientSite);
      if (fromConfig) return fromConfig;
    }
    for (let i = 0; i < SITES.length; i++) {
      if ((state.ips[SITES[i]] || []).indexOf(ip) >= 0) return SITES[i];
    }
    return '';
  }

  function snapshotRowCount(snap) {
    if (!snap) return 0;
    if (siteHasBlocks(snap)) {
      return snap.blocks.reduce((sum, block) => sum + ((block.rows && block.rows.length) || 0), 0);
    }
    return Array.isArray(snap.rows) ? snap.rows.length : 0;
  }

  function viewDays(state) {
    return daysFromSheetState(state);
  }

  function publicSites(state) {
    const out = {};
    SITES.forEach((site) => {
      const snap = state.sites[site];
      out[site] = snap ? {
        fileName: snap.fileName || '',
        updatedAt: snap.updatedAt || '',
        user: snap.user || '',
        rowCount: snapshotRowCount(snap),
      } : null;
    });
    return out;
  }

  function adminView(state) {
    return {
      ips: state.ips,
      pending: state.pending.map((p) => ({
        ip: p.ip,
        guess: p.guess || '',
        fileName: p.fileName || '',
        at: p.at || '',
        rowCount: snapshotRowCount(p.snapshot),
      })),
    };
  }

  function viewFor(req, state) {
    const canEdit = isAmirUser(req);
    const out = { ok: true, version, canEdit, sites: publicSites(state), days: viewDays(state) };
    if (canEdit) out.admin = adminView(state);
    return out;
  }

  api.get('/liman', requireValidSession, async (req, res) => {
    try {
      const state = await readState();
      return res.json(viewFor(req, state));
    } catch (err) {
      return sendApiError(res, err, 500, 'LIMAN_READ_FAILED');
    }
  });

  api.get('/liman/version', requireValidSession, async (req, res) => {
    try {
      await loadRaw();
      res.setHeader('Cache-Control', 'no-store');
      return res.json({ v: version });
    } catch (err) {
      return sendApiError(res, err, 500, 'LIMAN_VERSION_FAILED');
    }
  });

  api.put('/liman/snapshot', requireValidSession, async (req, res) => {
    try {
      const body = req.body || {};
      if (isAmirUser(req)) {
        return res.json({ ok: true, skipped: true });
      }
      const fileName = sanitizeString(body.fileName || '', 180);
      const guess = normalizeSite(body.site);
      const incoming = Array.isArray(body.rows) ? body.rows.slice(0, MAX_ROWS) : [];
      const blocks = sanitizeBlocks(body.blocks);
      const ip = requestIp(req);
      const state = await readState();
      const site = siteForIp(state, ip);
      const rowSite = site || guess || 'AVDAN';
      const rows = incoming.map((row) => slimRow(row, rowSite, fileName)).filter((row) => {
        return row.irsaliyeNo || row.plaka || row.headerText;
      });
      const snapshot = {
        fileName,
        updatedAt: new Date().toISOString(),
        user: sanitizeString((req.user && req.user.username) || '', 40),
        ip,
        rows: blocks.length ? [] : rows,
        blocks,
      };
      if (!site) {
        state.pending = [{ ip, guess, fileName, at: snapshot.updatedAt, snapshot }]
          .concat(state.pending.filter((p) => p.ip !== ip))
          .slice(0, MAX_PENDING);
        await writeState(state);
        return res.json({ ok: true, pending: true, ip });
      }
      const prev = state.sites[site];
      const sameContent = prev && prev.fileName === snapshot.fileName
        && JSON.stringify(prev.blocks || []) === JSON.stringify(snapshot.blocks)
        && JSON.stringify(prev.rows || []) === JSON.stringify(snapshot.rows);
      if (sameContent) return res.json({ ok: true, site, ip, unchanged: true });
      state.sites[site] = snapshot;
      await writeState(state);
      return res.json({ ok: true, site, ip });
    } catch (err) {
      return sendApiError(res, err, 500, 'LIMAN_SNAPSHOT_FAILED');
    }
  });

  api.post('/liman/ip/approve', requireAmir, async (req, res) => {
    try {
      const body = req.body || {};
      const ip = sanitizeString(body.ip || '', 64);
      const site = normalizeSite(body.site);
      if (!ip || !site) return res.status(400).json({ ok: false, error: 'IP ve kantar gerekli.' });
      const state = await readState();
      SITES.forEach((s) => { state.ips[s] = (state.ips[s] || []).filter((x) => x !== ip); });
      state.ips[site].push(ip);
      const pend = state.pending.find((p) => p.ip === ip);
      if (pend && pend.snapshot) state.sites[site] = pend.snapshot;
      state.pending = state.pending.filter((p) => p.ip !== ip);
      await writeState(state);
      return res.json(viewFor(req, state));
    } catch (err) {
      return sendApiError(res, err, 500, 'LIMAN_IP_APPROVE_FAILED');
    }
  });

  api.post('/liman/ip/remove', requireAmir, async (req, res) => {
    try {
      const ip = sanitizeString((req.body && req.body.ip) || '', 64);
      if (!ip) return res.status(400).json({ ok: false, error: 'IP gerekli.' });
      const state = await readState();
      SITES.forEach((s) => { state.ips[s] = (state.ips[s] || []).filter((x) => x !== ip); });
      state.pending = state.pending.filter((p) => p.ip !== ip);
      await writeState(state);
      return res.json(viewFor(req, state));
    } catch (err) {
      return sendApiError(res, err, 500, 'LIMAN_IP_REMOVE_FAILED');
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
      return res.json({ ok: true, days: viewDays(state) });
    } catch (err) {
      return sendApiError(res, err, 500, 'LIMAN_NOTE_FAILED');
    }
  });
}

module.exports = { registerLimanRoutes, STATE_KEY };
