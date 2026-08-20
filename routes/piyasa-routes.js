'use strict';

function registerPiyasaRoutes(api, ctx) {
  const { q, pool, auth, parsePagination, sendApiError, requireValidSession, requireAdmin, sanitizeString, validatePlateFormat, broadcastEvent, broadcastReportUpdate, withTransaction, computeVehicleSortTs, piyasaServer, verifySettingsPassword, formatReportInstant } = ctx;
  const {
    isYdFirma,
    istanbulDayStartMs,
    istanbulDayEndMs,
    normalizeCikanlarInsert,
    resolveHafta,
    haftaLabel,
  } = require('../lib/piyasa-cikanlar');
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
    res.setHeader('Cache-Control', 'no-store');
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
    if (!normalized) return res.status(400).json({ ok: false, error: 'Geçersiz müşteri listesi' });
    const raw = JSON.stringify(normalized);
    await q(
      `INSERT INTO kv_store(key, value) VALUES($1,$2)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [piyasaServer.PIYASA_CUSTOMERS_KV, raw]
    );
    broadcastEvent('piyasa_customers_updated', {
      updatedAt: normalized.updatedAt,
      count: normalized.customers.length,
      source: normalized.source,
    });
    res.json({ ok: true, count: normalized.customers.length, updatedAt: normalized.updatedAt, source: normalized.source });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

api.delete('/piyasa/customers', auth.verifyToken, async (req, res) => {
  try {
    const normalized = piyasaServer.normalizePiyasaCustomersPayload({
      customers: [],
      source: 'cleared',
      allowEmpty: true,
    });
    const raw = JSON.stringify(normalized);
    await q(
      `INSERT INTO kv_store(key, value) VALUES($1,$2)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [piyasaServer.PIYASA_CUSTOMERS_KV, raw]
    );
    broadcastEvent('piyasa_customers_updated', {
      updatedAt: normalized.updatedAt,
      count: 0,
      source: 'cleared',
    });
    res.json({ ok: true, count: 0, updatedAt: normalized.updatedAt });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

api.get('/piyasa/cikanlar', async (req, res) => {
  try {
    try {
      await q(`
        INSERT INTO piyasa_cikanlar (
          id, print_history_id, tarih, plaka, dorse_plaka, sofor, firma, firma_adi, sip_no,
          malzeme, yukleme_turu, sehir, sevk_yeri, miktar, tonaj, basim_yeri,
          order_key, hafta, sheet, sevkiyat_tipi, vehicle_id
        )
        SELECT
          'ph_' || ph.id,
          ph.id,
          ph.tarih,
          COALESCE(ph.plaka, ''),
          COALESCE(ph.dorse_plaka, ''),
          COALESCE(ph.sofor, ''),
          COALESCE(ph.firma, ''),
          COALESCE(s.snap->>'firmaAdi', ''),
          COALESCE(s.snap->>'sipNo', ''),
          COALESCE(ph.malzeme, ''),
          COALESCE(ph.yukleme_turu, ''),
          COALESCE(s.snap->>'sehir', ''),
          COALESCE(ph.sevk_yeri, ''),
          '',
          COALESCE(ph.tonaj, ''),
          COALESCE(ph.basim_yeri, ''),
          CASE WHEN ph.sevkiyat_id LIKE 'piyasa:%' THEN substr(ph.sevkiyat_id, 8) ELSE '' END,
          '',
          '',
          '',
          COALESCE(ph.vehicle_id, '')
        FROM print_history ph
        CROSS JOIN LATERAL (
          SELECT CASE
            WHEN ph.snapshot IS NULL OR btrim(ph.snapshot) = '' OR left(btrim(ph.snapshot), 1) <> '{'
              THEN '{}'::jsonb
            ELSE ph.snapshot::jsonb
          END AS snap
        ) s
        WHERE COALESCE(ph.sevkiyat_id, '') NOT LIKE 'ihracat:%'
          AND COALESCE(ph.firma, '') !~* 'YD[0-9]{1,4}'
          AND ph.tarih >= (EXTRACT(EPOCH FROM NOW()) * 1000 - 45::float * 24 * 60 * 60 * 1000)
          AND NOT EXISTS (
            SELECT 1 FROM piyasa_cikanlar c WHERE c.print_history_id = ph.id
          )
        ON CONFLICT (id) DO NOTHING
      `);
    } catch (bfErr) {
      console.warn('piyasa_cikanlar backfill skipped:', bfErr.message || bfErr);
    }
    const { limit, offset } = parsePagination(req, { defaultLimit: 500, maxLimit: 5000 });
    const firma = sanitizeString(req.query.firma || '', 100).trim();
    const plaka = sanitizeString(req.query.plaka || '', 50).trim();
    const fromMs = istanbulDayStartMs(req.query.from);
    const toEnd = istanbulDayEndMs(req.query.to) || istanbulDayEndMs(req.query.from);
    const params = [];
    const where = [];
    if (fromMs != null) {
      params.push(fromMs);
      where.push(`tarih >= $${params.length}`);
    }
    if (toEnd != null) {
      params.push(toEnd);
      where.push(`tarih < $${params.length}`);
    }
    if (firma) {
      params.push(firma.toUpperCase());
      where.push(`UPPER(TRIM(SPLIT_PART(firma, '/', 1))) = $${params.length}`);
    }
    if (plaka) {
      params.push('%' + plaka.toUpperCase() + '%');
      where.push(`UPPER(plaka) LIKE $${params.length}`);
    }
    const whereSql = where.length ? (' WHERE ' + where.join(' AND ')) : '';
    const countR = await q(`SELECT COUNT(*)::int AS c FROM piyasa_cikanlar${whereSql}`, params);
    params.push(limit);
    params.push(offset);
    const r = await q(
      `SELECT id, print_history_id, tarih, plaka, dorse_plaka, sofor, firma, firma_adi, sip_no,
              malzeme, yukleme_turu, sehir, sevk_yeri, miktar, tonaj, basim_yeri,
              order_key, hafta, sheet, sevkiyat_tipi, vehicle_id
       FROM piyasa_cikanlar${whereSql}
       ORDER BY tarih DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    const fmt = typeof formatReportInstant === 'function'
      ? formatReportInstant
      : (ms) => {
        const d = new Date(Number(ms));
        return { tarih: d.toLocaleDateString('tr-TR'), saat: d.toLocaleTimeString('tr-TR') };
      };
    const rows = (r.rows || []).map((row) => {
      const inst = fmt(row.tarih);
      const week = resolveHafta(row.hafta, row.tarih);
      return Object.assign({}, row, {
        tarihLabel: inst.tarih || '',
        saatLabel: inst.saat || '',
        hafta: week != null ? String(week) : (row.hafta || ''),
        haftaLabel: haftaLabel(week),
      });
    });
    res.json({ ok: true, total: Number(countR.rows[0]?.c || 0), rows });
  } catch (err) {
    sendApiError(res, err, 500, 'PIYASA_CIKANLAR_LIST_FAILED');
  }
});

api.post('/piyasa/cikanlar', auth.verifyToken, async (req, res) => {
  try {
    const normalized = normalizeCikanlarInsert(req.body || {}, sanitizeString);
    if (normalized.error === 'YD_NOT_ALLOWED') {
      return res.status(400).json({ ok: false, error: normalized.error, message: normalized.message });
    }
    if (normalized.error) {
      return res.status(400).json({ ok: false, error: normalized.error, message: normalized.message });
    }
    if (isYdFirma(normalized.firma)) {
      return res.status(400).json({ ok: false, error: 'YD_NOT_ALLOWED' });
    }
    await q(
      `INSERT INTO piyasa_cikanlar(
         id, print_history_id, tarih, plaka, dorse_plaka, sofor, firma, firma_adi, sip_no,
         malzeme, yukleme_turu, sehir, sevk_yeri, miktar, tonaj, basim_yeri,
         order_key, hafta, sheet, sevkiyat_tipi, vehicle_id
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21
       )
       ON CONFLICT (id) DO UPDATE SET
         print_history_id = COALESCE(EXCLUDED.print_history_id, piyasa_cikanlar.print_history_id),
         plaka = EXCLUDED.plaka,
         firma = EXCLUDED.firma,
         firma_adi = EXCLUDED.firma_adi,
         sip_no = EXCLUDED.sip_no,
         malzeme = EXCLUDED.malzeme,
         tarih = EXCLUDED.tarih`,
      [
        normalized.id,
        normalized.print_history_id,
        normalized.tarih,
        normalized.plaka,
        normalized.dorse_plaka,
        normalized.sofor,
        normalized.firma,
        normalized.firma_adi,
        normalized.sip_no,
        normalized.malzeme,
        normalized.yukleme_turu,
        normalized.sehir,
        normalized.sevk_yeri,
        normalized.miktar,
        normalized.tonaj,
        normalized.basim_yeri,
        normalized.order_key,
        normalized.hafta,
        normalized.sheet,
        normalized.sevkiyat_tipi,
        normalized.vehicle_id,
      ]
    );
    broadcastEvent('piyasa_cikanlar_updated', {
      id: normalized.id,
      firma: normalized.firma,
      plaka: normalized.plaka,
      tarih: normalized.tarih,
    });
    res.json({ ok: true, id: normalized.id });
  } catch (err) {
    sendApiError(res, err, 500, 'PIYASA_CIKANLAR_INSERT_FAILED');
  }
});
}

module.exports = { registerPiyasaRoutes };
