'use strict';

function registerSignaturesRoutes(api, ctx) {
  const { q, pool, auth, parsePagination, sendApiError, requireValidSession, requireAdmin, sanitizeString, validatePlateFormat, broadcastEvent, broadcastReportUpdate, withTransaction, computeVehicleSortTs, signatureRowToSrc } = ctx;
// â€”â€”â€” Ä°mza yÃ¶netimi (Kantar + Sevkiyat saha) â€”â€”â€”
api.get("/signatures", async (req, res) => {
  try {
    const role = sanitizeString(req.query.role || '', 20).toLowerCase();
    let sql = `SELECT id, display_name, role, image_kind, active, created_at FROM signatures WHERE active = TRUE`;
    const params = [];
    if (role === 'kantar' || role === 'saha') {
      params.push(role);
      sql += ` AND role = $${params.length}`;
    }
    sql += ` ORDER BY display_name ASC`;
    const r = await q(sql, params);
    res.json((r.rows || []).map((row) => ({
      id: row.id,
      displayName: row.display_name,
      role: row.role,
      imageKind: row.image_kind,
      active: row.active,
      createdAt: row.created_at
    })));
  } catch (err) {
    console.error('GET /signatures error', err);
    sendApiError(res, err, 500, 'SIGNATURES_LIST_FAILED');
  }
});

api.get("/signatures/map", async (req, res) => {
  try {
    const r = await q(`SELECT id, display_name, role, image_kind, image_data FROM signatures WHERE active = TRUE`);
    const map = { kantar: {}, saha: {} };
    (r.rows || []).forEach((row) => {
      const role = String(row.role || '').toLowerCase();
      if (role !== 'kantar' && role !== 'saha') return;
      const key = String(row.display_name || '').trim().toUpperCase();
      if (!key) return;
      map[role][key] = signatureRowToSrc(row);
    });
    res.json(map);
  } catch (err) {
    console.error('GET /signatures/map error', err);
    sendApiError(res, err, 500, 'SIGNATURES_MAP_FAILED');
  }
});

api.get("/signatures/:id/image", async (req, res) => {
  try {
    const id = sanitizeString(req.params.id, 80);
    const r = await q(`SELECT image_kind, image_data FROM signatures WHERE id = $1 AND active = TRUE`, [id]);
    const row = r.rows[0];
    if (!row) return res.status(404).json({ error: 'not found' });
    const src = signatureRowToSrc(row);
    if (src.startsWith('data:')) {
      const m = src.match(/^data:([^;]+);base64,(.+)$/);
      if (!m) return res.status(400).json({ error: 'invalid image' });
      const buf = Buffer.from(m[2], 'base64');
      res.setHeader('Content-Type', m[1]);
      res.setHeader('Cache-Control', 'private, max-age=3600');
      return res.send(buf);
    }
    return res.redirect(src);
  } catch (err) {
    console.error('GET /signatures/:id/image error', err);
    sendApiError(res, err, 500, 'SIGNATURE_IMAGE_FAILED');
  }
});

api.post("/signatures", requireValidSession, async (req, res) => {
  try {
    const body = req.body || {};
    const displayName = sanitizeString(body.displayName || body.display_name || '', 120).trim();
    const role = sanitizeString(body.role || 'kantar', 20).toLowerCase();
    let imageData = String(body.imageData || body.image_data || body.image || '').trim();
    if (!displayName) return res.status(400).json({ error: 'displayName required' });
    if (role !== 'kantar' && role !== 'saha') return res.status(400).json({ error: 'role must be kantar or saha' });
    if (!imageData) return res.status(400).json({ error: 'image required' });
    if (imageData.length > 2_500_000) return res.status(400).json({ error: 'image too large' });
    let imageKind = 'base64';
    if (imageData.startsWith('data:')) {
      /* keep */
    } else if (/^signatures\//i.test(imageData) || imageData.startsWith('/signatures/')) {
      imageKind = 'path';
      imageData = imageData.replace(/^\//, '');
    } else {
      imageData = `data:image/png;base64,${imageData}`;
    }
    const dup = await q(
      `SELECT id FROM signatures WHERE active = TRUE AND role = $1 AND upper(display_name) = upper($2) LIMIT 1`,
      [role, displayName]
    );
    if (dup.rows[0]) {
      return res.status(409).json({ error: 'Bu isim bu rol iÃ§in zaten kayÄ±tlÄ±', id: dup.rows[0].id });
    }
    const id = String(body.id || `sig_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`);
    const created = Date.now();
    await q(
      `INSERT INTO signatures(id, display_name, role, image_kind, image_data, active, created_at)
       VALUES($1,$2,$3,$4,$5,TRUE,$6)`,
      [id, displayName, role, imageKind, imageData, created]
    );
    res.json({ ok: true, id, displayName, role });
  } catch (err) {
    console.error('POST /signatures error', err);
    sendApiError(res, err, 500, 'SIGNATURE_CREATE_FAILED');
  }
});

api.delete("/signatures/:id", requireValidSession, async (req, res) => {
  try {
    const id = sanitizeString(req.params.id, 80);
    await q(`UPDATE signatures SET active = FALSE WHERE id = $1`, [id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /signatures/:id error', err);
    sendApiError(res, err, 500, 'SIGNATURE_DELETE_FAILED');
  }
});
}

module.exports = { registerSignaturesRoutes };
