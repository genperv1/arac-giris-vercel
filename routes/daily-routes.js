'use strict';

const { compactPlate } = require('../lib/plate-format');

function registerDailyRoutes(api, ctx) {
  const { q, pool, auth, parsePagination, sendApiError, requireValidSession, sanitizeString, validatePlateFormat, broadcastEvent, broadcastReportUpdate, withTransaction, computeVehicleSortTs } = ctx;
// Daily rows
api.get("/daily_rows", async (req, res) => {
  try {
    const { limit, offset } = parsePagination(req, { defaultLimit: 5000, maxLimit: 20000 });
    const r = await q("SELECT data FROM daily_rows ORDER BY created_at DESC LIMIT $1 OFFSET $2", [limit, offset]);
    res.json((r.rows || []).map((x) => {
      try {
        return JSON.parse(x.data);
      } catch {
        return x.data;
      }
    }));
  } catch (err) {
    sendApiError(res, err, 500, 'DAILY_ROWS_LIST_FAILED');
  }
});

api.post("/daily_rows", requireValidSession, async (req, res) => {
  try {
    const row = req.body || {};
    const id = String(row.id || (Date.now().toString() + Math.random().toString(16).slice(2)));
    const created = Number(row.created_at || Date.now());
    
    // ✅ SECURITY: Validate and sanitize plaka
    const plakaRaw = sanitizeString(row.plaka || "", 50);
    if (plakaRaw && !validatePlateFormat(plakaRaw)) {
      console.warn('Rejected plaka in daily_rows:', plakaRaw, 'Original:', row.plaka);
      return res.status(400).json({ error: 'Invalid plaka format', received: plakaRaw });
    }

    // Sanitize all text fields in daily rows
    const plaka = compactPlate(plakaRaw);
    const sanitized = {
      ...row,
      plaka,
      malzeme: sanitizeString(row.malzeme || "", 100),
      sevkYeri: sanitizeString(row.sevkYeri || "", 200),
      ambalaj: sanitizeString(row.ambalaj || "", 100),
      yuklemeNotu: sanitizeString(row.yuklemeNotu || "", 500),
      firma: sanitizeString(row.firma || "", 100),
      id
    };

    const raw = JSON.stringify(sanitized);
    // Enforce 3000-character limit on the serialized `data` field for daily_rows
    if (typeof raw === 'string' && raw.length > 3000) {
      return res.status(400).json({ error: 'data field exceeds 3000 characters' });
    }

    await q(
      `
      INSERT INTO daily_rows(id, plaka, data, created_at)
      VALUES($1,$2,$3,$4)
      ON CONFLICT (id) DO UPDATE SET
        plaka = EXCLUDED.plaka,
        data = EXCLUDED.data,
        created_at = EXCLUDED.created_at
      `,
      [id, plaka, raw, created]
    );

    // Broadcast real-time update to all connected clients
    broadcastEvent('daily_row_created', { row: sanitized, id });

    res.json({ ok: true, id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Tüm günlük Excel satırlarını sil (İHRACAT Excel Sil)
api.delete("/daily_rows", requireValidSession, async (req, res) => {
  try {
    await q("DELETE FROM daily_rows");
    broadcastEvent('daily_rows_cleared', {});
    res.json({ ok: true });
  } catch (err) {
    sendApiError(res, err, 500, 'DAILY_ROWS_CLEAR_FAILED');
  }
});

api.delete("/daily_rows/:id", auth.verifyToken, async (req, res) => {
  try {
    const id = req.params.id;
    await q("DELETE FROM daily_rows WHERE id = $1", [id]);
    
    // Broadcast real-time update to all connected clients
    broadcastEvent('daily_row_deleted', { id });
    
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
}

module.exports = { registerDailyRoutes };
