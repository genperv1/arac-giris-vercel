'use strict';

const { validatePlateFormat } = require('../lib/plate-format');
const {
  VEH_PLATE_NORM_SQL_CEK,
  VEH_PLATE_NORM_SQL_DORSE,
  normPlateForLookup,
  maybeLogVehicleEdit,
  upsertVehicleRecord,
  mapVehicleRowToApiVehicle,
  fetchVehiclesRowsKeyset,
} = require('../lib/vehicle-helpers');
const { sanitizeString, validateTCNumber, validatePhoneNumber } = require('../lib/sanitize');

/**
 * @param {import('express').Router} api
 * @param {object} ctx
 */
function registerVehicleRoutes(api, ctx) {
  const {
    q,
    pool,
    parsePagination,
    sendApiError,
    requireValidSession,
    VEH_LIST_KEYSET_BATCH,
    PG_STATEMENT_TIMEOUT,
    broadcastEvent,
  } = ctx;

  api.get('/vehicles', async (req, res) => {
    try {
      const { limit, offset } = parsePagination(req, { defaultLimit: 5000, maxLimit: 20000 });
      let rows;
      if (offset === 0) {
        rows = await fetchVehiclesRowsKeyset(pool, limit, VEH_LIST_KEYSET_BATCH, PG_STATEMENT_TIMEOUT);
      } else {
        const r = await q(`
          SELECT id, cekiciPlaka, dorsePlaka, data, rejection_status, rejection_duration, rejection_start_ts, rejection_end_ts
          FROM vehicles
          ORDER BY sort_ts DESC, id DESC
          LIMIT $1 OFFSET $2
        `, [limit, offset]);
        rows = r.rows || [];
      }
      const parsed = rows.map((row) => mapVehicleRowToApiVehicle(row));
      res.json(parsed);
    } catch (err) {
      sendApiError(res, err, 500, 'VEHICLES_LIST_FAILED');
    }
  });

  api.get('/vehicles/lookup', async (req, res) => {
    try {
      const plate = String(req.query.plate || '').trim();
      if (!plate) {
        return res.status(400).json({ error: 'plate query parameter required' });
      }
      const norm = normPlateForLookup(plate);
      if (!norm) return res.json(null);
      const r = await q(
        `SELECT id, cekiciPlaka, dorsePlaka, data, rejection_status, rejection_duration, rejection_start_ts, rejection_end_ts
         FROM vehicles
         WHERE ${VEH_PLATE_NORM_SQL_CEK} = $1 OR ${VEH_PLATE_NORM_SQL_DORSE} = $1
         ORDER BY sort_ts DESC, id DESC
         LIMIT 3`,
        [norm]
      );
      const rows = r.rows || [];
      const parsed = rows.map((row) => mapVehicleRowToApiVehicle(row));
      return res.json(parsed[0] || null);
    } catch (err) {
      sendApiError(res, err, 500, 'VEHICLES_LOOKUP_FAILED');
    }
  });

  api.post('/vehicles/lookup-batch', async (req, res) => {
    try {
      const raw = Array.isArray(req.body?.plates) ? req.body.plates : [];
      const norms = [...new Set(raw.map((p) => normPlateForLookup(p)).filter(Boolean))].slice(0, 80);
      if (!norms.length) return res.json({});

      const r = await q(
        `WITH wanted AS (SELECT unnest($1::text[]) AS pnorm)
         SELECT DISTINCT ON (w.pnorm)
           w.pnorm,
           v.id, v.cekiciPlaka, v.dorseplaka, v.data,
           v.rejection_status, v.rejection_duration, v.rejection_start_ts, v.rejection_end_ts, v.sort_ts
         FROM wanted w
         JOIN vehicles v ON (${VEH_PLATE_NORM_SQL_CEK} = w.pnorm OR ${VEH_PLATE_NORM_SQL_DORSE} = w.pnorm)
         ORDER BY w.pnorm, v.sort_ts DESC, v.id DESC`,
        [norms]
      );

      const out = {};
      for (const row of r.rows || []) {
        out[row.pnorm] = mapVehicleRowToApiVehicle(row);
      }
      return res.json(out);
    } catch (err) {
      sendApiError(res, err, 500, 'VEHICLES_LOOKUP_BATCH_FAILED');
    }
  });

  api.get('/vehicles/:id', async (req, res) => {
    try {
      const id = req.params.id;
      const r = await q('SELECT id, cekiciPlaka, dorsePlaka, data, rejection_status, rejection_duration, rejection_start_ts, rejection_end_ts FROM vehicles WHERE id = $1', [id]);
      if (!r.rows[0]) return res.status(404).json({ error: 'not found' });
      return res.json(mapVehicleRowToApiVehicle(r.rows[0]));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  api.post('/vehicles', requireValidSession, async (req, res) => {
    try {
      const v = req.body || {};
      const id = String(v.id || (Date.now().toString() + Math.random().toString(16).slice(2)));
      const cekiciPlaka = sanitizeString(v.cekiciPlaka || '', 50);
      const dorsePlaka = sanitizeString(v.dorsePlaka || '', 50);

      if (cekiciPlaka && !validatePlateFormat(cekiciPlaka)) {
        return res.status(400).json({ error: 'Invalid çekici plaka format', received: cekiciPlaka });
      }
      if (dorsePlaka && !validatePlateFormat(dorsePlaka)) {
        return res.status(400).json({ error: 'Invalid dorse plaka format', received: dorsePlaka });
      }
      if (v.tcKimlik && !validateTCNumber(v.tcKimlik)) {
        return res.status(400).json({ error: 'Invalid TC number format' });
      }
      if (v.iletisim && !validatePhoneNumber(v.iletisim)) {
        return res.status(400).json({ error: 'Invalid phone number format' });
      }

      const sanitized = {
        ...v,
        cekiciPlaka,
        dorsePlaka,
        soforAdi: sanitizeString(v.soforAdi || '', 100),
        soforSoyadi: sanitizeString(v.soforSoyadi || '', 100),
        sofor2Adi: sanitizeString(v.sofor2Adi || '', 100),
        sofor2Soyadi: sanitizeString(v.sofor2Soyadi || '', 100),
        tcKimlik: sanitizeString(v.tcKimlik || '', 11),
        iletisim: sanitizeString(v.iletisim || '', 20),
        defaultFirma: sanitizeString(v.defaultFirma || '', 100),
        defaultMalzeme: sanitizeString(v.defaultMalzeme || '', 100),
        defaultSevkYeri: sanitizeString(v.defaultSevkYeri || '', 200),
        defaultYuklemeNotu: sanitizeString(v.defaultYuklemeNotu || '', 500),
        id,
      };

      const raw = JSON.stringify(sanitized);
      if (typeof raw === 'string' && raw.length > 2000) {
        return res.status(400).json({ error: 'data field exceeds 2000 characters' });
      }

      const userId = sanitizeString((req.user && req.user.username) || v.editedBy || v.userId || '', 80);
      await maybeLogVehicleEdit(q, id, sanitized, userId);
      await upsertVehicleRecord({ query: (text, params) => q(text, params, { retry: true }) }, sanitized);
      broadcastEvent('vehicle_created', { vehicle: sanitized, id });
      res.json({ ok: true, id });
    } catch (err) {
      sendApiError(res, err, 500, 'VEHICLE_SAVE_FAILED');
    }
  });

  api.put('/vehicles/:id', requireValidSession, async (req, res) => {
    try {
      const id = sanitizeString(req.params.id, 100);
      const v = req.body || {};
      const cekiciPlaka = sanitizeString(v.cekiciPlaka || '', 50);
      const dorsePlaka = sanitizeString(v.dorsePlaka || '', 50);

      if (cekiciPlaka && !validatePlateFormat(cekiciPlaka)) {
        return res.status(400).json({ error: 'Invalid çekici plaka format', received: cekiciPlaka });
      }
      if (dorsePlaka && !validatePlateFormat(dorsePlaka)) {
        return res.status(400).json({ error: 'Invalid dorse plaka format', received: dorsePlaka });
      }
      if (v.tcKimlik && !validateTCNumber(v.tcKimlik)) {
        return res.status(400).json({ error: 'Invalid TC number format' });
      }
      if (v.iletisim && !validatePhoneNumber(v.iletisim)) {
        return res.status(400).json({ error: 'Invalid phone number format' });
      }

      const sanitized = {
        ...v,
        id,
        cekiciPlaka,
        dorsePlaka,
        soforAdi: sanitizeString(v.soforAdi || '', 100),
        soforSoyadi: sanitizeString(v.soforSoyadi || '', 100),
        sofor2Adi: sanitizeString(v.sofor2Adi || '', 100),
        sofor2Soyadi: sanitizeString(v.sofor2Soyadi || '', 100),
        tcKimlik: sanitizeString(v.tcKimlik || '', 11),
        iletisim: sanitizeString(v.iletisim || '', 20),
        defaultFirma: sanitizeString(v.defaultFirma || '', 100),
        defaultMalzeme: sanitizeString(v.defaultMalzeme || '', 100),
        defaultSevkYeri: sanitizeString(v.defaultSevkYeri || '', 200),
        defaultYuklemeNotu: sanitizeString(v.defaultYuklemeNotu || '', 500),
      };

      const userId = sanitizeString((req.user && req.user.username) || v.editedBy || '', 80);
      await maybeLogVehicleEdit(q, id, sanitized, userId);
      await upsertVehicleRecord({ query: (text, params) => q(text, params, { retry: true }) }, sanitized);
      broadcastEvent('vehicle_updated', { vehicle: sanitized, id });
      res.json({ ok: true, id });
    } catch (err) {
      sendApiError(res, err, 500, 'VEHICLE_UPDATE_FAILED');
    }
  });

  api.delete('/vehicles/:id', requireValidSession, async (req, res) => {
    try {
      const id = req.params.id;
      await q('DELETE FROM vehicles WHERE id = $1', [id]);
      broadcastEvent('vehicle_deleted', { id });
      res.json({ ok: true, id });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  api.post('/vehicles/reject-simple', requireValidSession, async (req, res) => {
    try {
      const { id, duration, customDays } = req.body || {};
      if (!id) return res.status(400).json({ error: 'Vehicle ID required' });

      const validDurations = ['1_month', '3_months', '6_months', '1_year', 'unlimited', 'custom'];
      if (!validDurations.includes(duration)) {
        return res.status(400).json({ error: 'Invalid rejection duration' });
      }

      let endTimestamp = null;
      let durationText = '';

      if (duration === 'unlimited') {
        durationText = 'Süresiz red';
      } else if (duration === 'custom') {
        const days = customDays || 30;
        if (days < 1 || days > 365) {
          return res.status(400).json({ error: 'Custom days must be between 1 and 365' });
        }
        durationText = `${days} gün süreli red`;
        endTimestamp = Date.now() + (days * 24 * 60 * 60 * 1000);
      } else {
        const months = { '1_month': 1, '3_months': 3, '6_months': 6, '1_year': 12 }[duration];
        durationText = {
          '1_month': '1 ay süreli red',
          '3_months': '3 ay süreli red',
          '6_months': '6 ay süreli red',
          '1_year': '1 yıl süreli red',
        }[duration];
        endTimestamp = Date.now() + (months * 30 * 24 * 60 * 60 * 1000);
      }

      await q(
        `UPDATE vehicles SET rejection_status = $1, rejection_duration = $2, rejection_start_ts = $3, rejection_end_ts = $4 WHERE id = $5`,
        ['rejected', durationText, Date.now(), endTimestamp, id]
      );
      broadcastEvent('vehicle_rejected', { id, duration: durationText, endTs: endTimestamp });
      res.json({ ok: true, id, duration: durationText, endTs: endTimestamp });
    } catch (err) {
      console.error('Rejection error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  api.post('/vehicles/:id/reject', requireValidSession, async (req, res) => {
    try {
      const id = sanitizeString(req.params.id, 100);
      const { duration, customDays } = req.body || {};
      const validDurations = ['1_month', '3_months', '6_months', '1_year', 'unlimited', 'custom'];
      if (!validDurations.includes(duration)) {
        return res.status(400).json({ error: 'Invalid rejection duration' });
      }

      let endTimestamp = null;
      let durationText = '';

      if (duration === 'unlimited') {
        durationText = 'Süresiz red';
      } else if (duration === 'custom') {
        const days = Number(customDays);
        if (!Number.isInteger(days) || days < 1 || days > 365) {
          return res.status(400).json({ error: 'Custom days must be between 1 and 365' });
        }
        durationText = `${days} gün süreli red`;
        endTimestamp = Date.now() + (days * 24 * 60 * 60 * 1000);
      } else {
        const durationMap = {
          '1_month': { days: 30, text: '1 ay süreli red' },
          '3_months': { days: 90, text: '3 ay süreli red' },
          '6_months': { days: 180, text: '6 ay süreli red' },
          '1_year': { days: 365, text: '1 yıl süreli red' },
        };
        const config = durationMap[duration];
        durationText = config.text;
        endTimestamp = Date.now() + (config.days * 24 * 60 * 60 * 1000);
      }

      const now = Date.now();
      await q(
        `UPDATE vehicles SET rejection_status = 'rejected', rejection_duration = $1, rejection_start_ts = $2, rejection_end_ts = $3 WHERE id = $4`,
        [durationText, now, endTimestamp, id]
      );

      const vehicleResult = await q('SELECT data FROM vehicles WHERE id = $1', [id]);
      let vehicleData = {};
      if (vehicleResult.rows[0]) {
        try { vehicleData = JSON.parse(vehicleResult.rows[0].data); } catch (e) { vehicleData = { raw: vehicleResult.rows[0].data }; }
      }

      broadcastEvent('vehicle_rejected', {
        vehicle: vehicleData,
        id,
        rejection: { status: 'rejected', duration: durationText, startTs: now, endTs: endTimestamp },
      });

      res.json({
        ok: true,
        id,
        rejection: { status: 'rejected', duration: durationText, startTs: now, endTs: endTimestamp },
      });
    } catch (err) {
      sendApiError(res, err, 500, 'VEHICLE_REJECTION_FAILED');
    }
  });

  api.post('/vehicles/:id/remove-rejection', requireValidSession, async (req, res) => {
    try {
      const id = sanitizeString(req.params.id, 100);
      await q(
        `UPDATE vehicles SET rejection_status = NULL, rejection_duration = NULL, rejection_start_ts = NULL, rejection_end_ts = NULL WHERE id = $1`,
        [id]
      );

      const vehicleResult = await q('SELECT data FROM vehicles WHERE id = $1', [id]);
      let vehicleData = {};
      if (vehicleResult.rows[0]) {
        try { vehicleData = JSON.parse(vehicleResult.rows[0].data); } catch (e) { vehicleData = { raw: vehicleResult.rows[0].data }; }
      }

      broadcastEvent('vehicle_rejection_removed', { vehicle: vehicleData, id });
      res.json({ ok: true, id });
    } catch (err) {
      sendApiError(res, err, 500, 'VEHICLE_REJECTION_REMOVAL_FAILED');
    }
  });
}

module.exports = { registerVehicleRoutes };
