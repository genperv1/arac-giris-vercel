'use strict';

function registerPiyasaRoutes(api, ctx) {
  const { q, pool, auth, parsePagination, sendApiError, requireValidSession, requireAdmin, sanitizeString, validatePlateFormat, broadcastEvent, broadcastReportUpdate, withTransaction, computeVehicleSortTs, piyasaServer, verifySettingsPassword } = ctx;
// Piyasa state
api.get("/piyasa", async (req, res) => {
  try {
    const r = await q("SELECT value FROM kv_store WHERE key = $1", ["piyasa_state_v1"]);
    if (!r.rows[0]) return res.json({});
    try { return res.json(JSON.parse(r.rows[0].value)); } catch { return res.json({}); }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

api.post("/piyasa", auth.verifyToken, async (req, res) => {
  try {
    // âœ… SECURITY: Sanitize piyasa data
    let sanitized = req.body || {};
    if (sanitized.plate) sanitized.plate = sanitizeString(sanitized.plate, 50);
    if (sanitized.firma) sanitized.firma = sanitizeString(sanitized.firma, 100);
    if (sanitized.malzeme) sanitized.malzeme = sanitizeString(sanitized.malzeme, 100);
    if (!sanitized.updatedAt) sanitized.updatedAt = Date.now();

    const raw = JSON.stringify(sanitized);
    await q(
      `
      INSERT INTO kv_store(key, value)
      VALUES($1,$2)
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
      `,
      ["piyasa_state_v1", raw]
    );
    broadcastEvent('piyasa_updated', {
      updatedAt: sanitized.updatedAt,
      orderCount: Array.isArray(sanitized.orders) ? sanitized.orders.length : 0,
    });
    res.json({ ok: true, updatedAt: sanitized.updatedAt });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

api.get('/piyasa/durum-status', auth.verifyToken, async (req, res) => {
  try {
    const meta = await piyasaServer.readPiyasaDurumMeta();
    const countStartMs = piyasaServer.getPiyasaDurumFreezeUntilMs();
    res.json({
      frozen: piyasaServer.isPiyasaDurumFrozen(),
      freezeUntil: countStartMs,
      durumCountStartMs: countStartMs,
      resetEpoch: meta.resetEpoch || 0,
      message: piyasaServer.piyasaDurumFreezeMessage(),
    });
  } catch (err) {
    sendApiError(res, err, 500, 'PIYASA_DURUM_STATUS_FAILED');
  }
});

api.post('/piyasa/reset-durum', auth.verifyToken, async (req, res) => {
  try {
    if (!verifySettingsPassword(req.body?.password || req.body?.settingsPassword)) {
      return res.status(403).json({ ok: false, error: 'Parola gerekli' });
    }
    const result = await piyasaServer.resetPiyasaDurumDisplayOnly();
    res.json({ ok: true, ...result, frozen: piyasaServer.isPiyasaDurumFrozen(), message: piyasaServer.piyasaDurumFreezeMessage() });
  } catch (err) {
    sendApiError(res, err, 500, 'PIYASA_DURUM_RESET_FAILED');
  }
});
api.get('/piyasa/customers', async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'private, max-age=120');
    const r = await q('SELECT value FROM kv_store WHERE key = $1', [piyasaServer.PIYASA_CUSTOMERS_KV]);
    if (!r.rows[0]) return res.json({ version: 1, customers: [], updatedAt: 0 });
    try { return res.json(JSON.parse(r.rows[0].value)); } catch { return res.json({ version: 1, customers: [], updatedAt: 0 }); }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

api.post('/piyasa/customers', auth.verifyToken, async (req, res) => {
  try {
    const normalized = piyasaServer.normalizePiyasaCustomersPayload(req.body || {});
    if (!normalized) return res.status(400).json({ ok: false, error: 'GeÃ§ersiz mÃ¼ÅŸteri listesi' });
    const raw = JSON.stringify(normalized);
    await q(
      `INSERT INTO kv_store(key, value) VALUES($1,$2)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [piyasaServer.PIYASA_CUSTOMERS_KV, raw]
    );
    res.json({ ok: true, count: normalized.customers.length, updatedAt: normalized.updatedAt });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
}

module.exports = { registerPiyasaRoutes };
