'use strict';

const { validatePlateFormat } = require('../lib/plate-format');
const { sanitizeString } = require('../lib/sanitize');

/**
 * @param {import('express').Router} api
 * @param {object} ctx
 */
function registerProblemRoutes(api, ctx) {
  const { q, parsePagination, sendApiError, requireValidSession, requireAdmin } = ctx;

  api.get('/problems', async (req, res) => {
    try {
      const { limit, offset } = parsePagination(req, { defaultLimit: 5000, maxLimit: 20000 });
      const plateQuery = req.query.plate || '';
      if (plateQuery) {
        const plate = String(plateQuery || '');
        const r = await q('SELECT id, data FROM problems WHERE plate = $1 ORDER BY ts DESC LIMIT $2 OFFSET $3', [plate, limit, offset]);
        const parsed = (r.rows || []).map((row) => {
          try { return Object.assign({ id: row.id }, JSON.parse(row.data)); }
          catch { return { id: row.id, raw: row.data }; }
        });
        return res.json(parsed);
      }

      const r = await q('SELECT id, data, plate FROM problems ORDER BY ts DESC LIMIT $1 OFFSET $2', [limit, offset]);
      const parsed = (r.rows || []).map((row) => {
        try { return Object.assign({ id: row.id, plate: row.plate }, JSON.parse(row.data)); }
        catch { return { id: row.id, plate: row.plate, raw: row.data }; }
      });
      res.json(parsed);
    } catch (err) {
      console.error('GET /problems SQL error', err);
      sendApiError(res, err, 500, 'PROBLEMS_LIST_FAILED');
    }
  });

  api.get('/problems/:id', async (req, res) => {
    try {
      const id = req.params.id;
      const r = await q('SELECT data FROM problems WHERE id = $1', [id]);
      if (!r.rows[0]) return res.status(404).json({ error: 'Not found' });
      try { return res.json(JSON.parse(r.rows[0].data)); } catch { return res.json({ raw: r.rows[0].data }); }
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  api.post('/problems', requireValidSession, async (req, res) => {
    try {
      const body = req.body || {};
      const id = String(body.id || (Date.now().toString() + Math.random().toString(16).slice(2)));
      const plate = sanitizeString(body.plate || '', 50);
      if (plate && !validatePlateFormat(plate)) {
        return res.status(400).json({ error: 'Invalid plate format', received: plate });
      }

      let data = body.data !== undefined ? body.data : body;
      if (typeof data === 'string') data = sanitizeString(data, 500);
      const raw = (typeof data === 'string') ? data : JSON.stringify(data);
      if (typeof raw === 'string' && raw.length > 500) {
        return res.status(400).json({ error: 'data field exceeds 500 characters' });
      }
      const ts = Number(body.ts || Date.now());

      await q(
        `INSERT INTO problems(id, plate, data, ts) VALUES($1,$2,$3,$4)
         ON CONFLICT (id) DO UPDATE SET plate = EXCLUDED.plate, data = EXCLUDED.data, ts = EXCLUDED.ts`,
        [id, plate, raw, ts]
      );
      res.json({ ok: true, id });
    } catch (err) {
      console.error('POST /problems SQL error', err);
      res.status(500).json({ error: err.message });
    }
  });

  api.put('/problems/:id', requireValidSession, async (req, res) => {
    try {
      const id = req.params.id;
      const body = req.body || {};
      const plate = String(body.plate || '');
      const data = body.data !== undefined ? body.data : body;
      const raw = (typeof data === 'string') ? data : JSON.stringify(data);
      if (typeof raw === 'string' && raw.length > 500) {
        return res.status(400).json({ error: 'data field exceeds 500 characters' });
      }
      const ts = Number(body.ts || Date.now());

      await q(
        `INSERT INTO problems(id, plate, data, ts) VALUES($1,$2,$3,$4)
         ON CONFLICT (id) DO UPDATE SET plate = EXCLUDED.plate, data = EXCLUDED.data, ts = EXCLUDED.ts`,
        [id, plate, raw, ts]
      );
      res.json({ ok: true, id });
    } catch (err) {
      console.error('PUT /problems/:id SQL error', err);
      res.status(500).json({ error: err.message });
    }
  });

  api.delete('/problems/:id', requireValidSession, async (req, res) => {
    try {
      const id = req.params.id;
      await q('DELETE FROM problems WHERE id = $1', [id]);
      res.json({ ok: true });
    } catch (err) {
      console.error('DELETE /problems/:id SQL error', err);
      res.status(500).json({ error: err.message });
    }
  });

  api.delete('/problems/plate/:plate', requireValidSession, async (req, res) => {
    try {
      const plate = String(req.params.plate || '');
      await q('DELETE FROM problems WHERE plate = $1', [plate]);
      res.json({ ok: true });
    } catch (err) {
      console.error('DELETE /problems/plate/:plate SQL error', err);
      res.status(500).json({ error: err.message });
    }
  });

  api.delete('/problems', requireAdmin, async (req, res) => {
    try {
      await q('DELETE FROM problems');
      res.json({ ok: true });
    } catch (err) {
      console.error('DELETE /problems SQL error', err);
      res.status(500).json({ error: err.message });
    }
  });
}

module.exports = { registerProblemRoutes };
