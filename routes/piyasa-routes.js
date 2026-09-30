'use strict';

const CIKANLAR_BACKFILL_MS = Number(process.env.PIYASA_CIKANLAR_BACKFILL_MS || 300000);
let lastCikanlarBackfillAt = 0;

function registerPiyasaRoutes(api, ctx) {
  const { q, pool, auth, parsePagination, sendApiError, requireValidSession, requireAdmin, requireAmir, sanitizeString, validatePlateFormat, broadcastEvent, broadcastReportUpdate, withTransaction, computeVehicleSortTs, piyasaServer, verifySettingsPassword, formatReportInstant } = ctx;
  const { isAmirIdentity } = require('../lib/amir-user');
  const { isPiyasaCatalogWrite } = require('../lib/piyasa-write-guard');
  const {
    publicSourceView,
    getStoredSource,
    setStoredSource,
    clearStoredSource,
    mergeSource,
    readExcelFromStoredPath,
  } = require('../lib/ihracat-excel-source');
  const PIYASA_EXCEL_SOURCE_KV = 'piyasa_excel_source_v1';
  const { sanitizeExpectedItems, stampExpectedPrint, applyPrintHistoryToExpected } = require('../public/modules/piyasa-expected');
  const { plateNormSql } = require('../lib/plate-norm-sql');
  const { compactPlate } = require('../lib/plate-format');
  const PIYASA_EXPECTED_KV = 'piyasa_expected_v1';
  const {
    isYdFirma,
    displayFirmaKod,
    firmaMatchesQuery,
    istanbulDayStartMs,
    istanbulDayEndMs,
    normalizeCikanlarInsert,
    resolveHafta,
    haftaLabel,
    isoWeekInfoFromMs,
    groupCikanlarByHafta,
    displaySehir,
    foldTrIl,
    CIKANLAR_LINKED_REPORT_SQL,
    BLANK_CIKANLAR_PREDICATE,
    deleteOrphanCikanlar,
    deleteBlankCikanlar,
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

    if (!isAmirIdentity(req.user)) {
      const prevR = await q("SELECT value FROM kv_store WHERE key = $1", ["piyasa_state_v1"]);
      let prev = {};
      if (prevR.rows[0]) {
        try { prev = JSON.parse(prevR.rows[0].value); } catch { prev = {}; }
      }
      if (isPiyasaCatalogWrite(prev, sanitized)) {
        return res.status(403).json({
          ok: false,
          error: 'Piyasa Excel yükleme ve silme yalnızca amir kullanıcısına açıktır',
          code: 'AMIR_REQUIRED',
        });
      }
    }

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

api.put('/piyasa-excel/source', requireAmir, async (req, res) => {
  try {
    const source = await setStoredSource(q, req.body || {}, PIYASA_EXCEL_SOURCE_KV);
    return res.json(publicSourceView(source));
  } catch (err) {
    return sendApiError(res, err, 500, 'PIYASA_EXCEL_SOURCE_SAVE_FAILED');
  }
});

api.delete('/piyasa-excel/source', requireAmir, async (req, res) => {
  try {
    const source = await clearStoredSource(q, PIYASA_EXCEL_SOURCE_KV);
    return res.json(publicSourceView(source));
  } catch (err) {
    return sendApiError(res, err, 500, 'PIYASA_EXCEL_SOURCE_CLEAR_FAILED');
  }
});

async function withExpectedPrints(items) {
  const clean = sanitizeExpectedItems(items);
  const plates = [];
  clean.forEach((item) => {
    if (item.cekici) plates.push(compactPlate(item.cekici).toLowerCase());
    if (item.dorse) plates.push(compactPlate(item.dorse).toLowerCase());
  });
  const unique = [...new Set(plates.filter(Boolean))];
  if (!unique.length) return clean;
  const r = await q(
    `SELECT plaka, dorse_plaka, basim_yeri, tarih
     FROM print_history
     WHERE ${plateNormSql('plaka')} = ANY($1::text[])
        OR ${plateNormSql('dorse_plaka')} = ANY($1::text[])
     ORDER BY tarih DESC
     LIMIT 300`,
    [unique]
  );
  return applyPrintHistoryToExpected(clean, r.rows);
}

api.get('/piyasa/expected', requireValidSession, async (req, res) => {
  try {
    const r = await q('SELECT value FROM kv_store WHERE key = $1', [PIYASA_EXPECTED_KV]);
    let items = [];
    if (r.rows[0]) {
      try {
        const parsed = JSON.parse(r.rows[0].value);
        items = parsed && parsed.items;
      } catch (e) { items = []; }
    }
    items = await withExpectedPrints(items);
    return res.json({ ok: true, items });
  } catch (err) {
    return sendApiError(res, err, 500, 'PIYASA_EXPECTED_READ_FAILED');
  }
});

api.post('/piyasa/expected/printed', requireValidSession, async (req, res) => {
  try {
    const body = req.body || {};
    const r = await q('SELECT value FROM kv_store WHERE key = $1', [PIYASA_EXPECTED_KV]);
    let stored = [];
    if (r.rows[0]) {
      try {
        const parsed = JSON.parse(r.rows[0].value);
        stored = parsed && parsed.items;
      } catch (e) { stored = []; }
    }
    const stamped = stampExpectedPrint(stored, {
      plate: body.plate,
      dorse: body.dorse,
      basimYeri: body.basimYeri,
      ts: body.ts,
      weekKey: body.weekKey,
    });
    if (stamped.changed) {
      const payload = JSON.stringify({
        items: stamped.items,
        updatedAt: Date.now(),
        updatedBy: String((req.user && req.user.username) || ''),
      });
      await q(
        `INSERT INTO kv_store(key, value)
         VALUES($1,$2)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        [PIYASA_EXPECTED_KV, payload]
      );
    }
    return res.json({ ok: true, changed: stamped.changed, items: stamped.items });
  } catch (err) {
    return sendApiError(res, err, 500, 'PIYASA_EXPECTED_PRINT_FAILED');
  }
});

api.put('/piyasa/expected', requireAmir, async (req, res) => {
  try {
    const items = sanitizeExpectedItems(req.body && req.body.items);
    const payload = JSON.stringify({
      items,
      updatedAt: Date.now(),
      updatedBy: String((req.user && req.user.username) || ''),
    });
    await q(
      `INSERT INTO kv_store(key, value)
       VALUES($1,$2)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [PIYASA_EXPECTED_KV, payload]
    );
    return res.json({ ok: true, items });
  } catch (err) {
    return sendApiError(res, err, 500, 'PIYASA_EXPECTED_SAVE_FAILED');
  }
});

api.post('/piyasa-excel/reread', requireAmir, async (req, res) => {
  try {
    const stored = await getStoredSource(q, PIYASA_EXCEL_SOURCE_KV);
    const source = mergeSource(stored, req.body || {});
    if (!source.fileName && !source.filePath) {
      return res.status(400).json({
        ok: false,
        error: { code: 'EXCEL_NOT_SELECTED', message: 'Önce Piyasa Excel dosyasını seçmelisiniz.' },
      });
    }
    const read = await readExcelFromStoredPath(source);
    try {
      await setStoredSource(q, {
        fileName: read.fileName,
        filePath: read.filePath,
        sheetName: source.sheetName || '',
        lastUpdatedAt: read.mtime ? new Date(read.mtime).toISOString() : new Date().toISOString(),
      }, PIYASA_EXCEL_SOURCE_KV);
    } catch (_) {}
    const lastUpdated = read.mtime ? new Date(read.mtime).toISOString() : new Date().toISOString();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="' + encodeURIComponent(read.fileName || 'piyasa.xlsx') + '"');
    res.setHeader('X-Piyasa-Excel-File-Name', encodeURIComponent(read.fileName || 'piyasa.xlsx'));
    res.setHeader('X-Piyasa-Excel-Last-Updated', lastUpdated);
    return res.status(200).send(read.buf);
  } catch (err) {
    if (err && err.code === 'EXCEL_FILE_NOT_FOUND') {
      return res.status(404).json({
        ok: false,
        error: { code: 'EXCEL_FILE_NOT_FOUND', message: 'Piyasa Excel dosyası bulunamadı.' },
      });
    }
    return sendApiError(res, err, 500, 'PIYASA_EXCEL_REREAD_FAILED');
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

api.get('/piyasa/cikanlar', requireAmir, async (req, res) => {
  try {
    try {
      const now = Date.now();
      if (now - lastCikanlarBackfillAt >= CIKANLAR_BACKFILL_MS) {
      lastCikanlarBackfillAt = now;
      await q(`
        INSERT INTO piyasa_cikanlar (
          id, print_history_id, tarih, plaka, dorse_plaka, sofor, firma, firma_adi, sip_no,
          malzeme, yukleme_turu, sehir, sevk_yeri, miktar, tonaj, basim_yeri, kantarci,
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
          COALESCE(NULLIF(s.snap->>'malzeme', ''), ph.malzeme, ''),
          COALESCE(ph.yukleme_turu, ''),
          COALESCE(NULLIF(s.snap->>'sehir', ''), NULLIF(s.snap->>'il', ''), ''),
          COALESCE(ph.sevk_yeri, ''),
          '',
          COALESCE(ph.tonaj, ''),
          COALESCE(ph.basim_yeri, ''),
          COALESCE(NULLIF(s.snap->>'kantar', ''), NULLIF(s.snap->>'imzaKantarAd', ''), ''),
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
          AND NOT (
            COALESCE(btrim(ph.firma), '') = ''
            AND COALESCE(btrim(ph.malzeme), '') = ''
            AND COALESCE(btrim(s.snap->>'malzeme'), '') = ''
            AND COALESCE(btrim(ph.tonaj), '') = ''
          )
        ON CONFLICT (id) DO NOTHING
      `);
      await q(`
        UPDATE piyasa_cikanlar c
        SET kantarci = COALESCE(NULLIF(s.snap->>'kantar', ''), NULLIF(s.snap->>'imzaKantarAd', ''), '')
        FROM print_history ph
        CROSS JOIN LATERAL (
          SELECT CASE
            WHEN ph.snapshot IS NULL OR btrim(ph.snapshot) = '' OR left(btrim(ph.snapshot), 1) <> '{'
              THEN '{}'::jsonb
            ELSE ph.snapshot::jsonb
          END AS snap
        ) s
        WHERE c.print_history_id = ph.id
          AND (c.kantarci IS NULL OR btrim(c.kantarci) = '')
          AND COALESCE(NULLIF(s.snap->>'kantar', ''), NULLIF(s.snap->>'imzaKantarAd', ''), '') <> ''
      `);
      await q(`
        UPDATE piyasa_cikanlar c
        SET sehir = COALESCE(NULLIF(s.snap->>'sehir', ''), NULLIF(s.snap->>'il', ''), c.sehir)
        FROM print_history ph
        CROSS JOIN LATERAL (
          SELECT CASE
            WHEN ph.snapshot IS NULL OR btrim(ph.snapshot) = '' OR left(btrim(ph.snapshot), 1) <> '{'
              THEN '{}'::jsonb
            ELSE ph.snapshot::jsonb
          END AS snap
        ) s
        WHERE c.print_history_id = ph.id
          AND (c.sehir IS NULL OR btrim(c.sehir) = '')
          AND COALESCE(NULLIF(s.snap->>'sehir', ''), NULLIF(s.snap->>'il', '')) <> ''
      `);
      }
      await deleteOrphanCikanlar(q);
      await deleteBlankCikanlar(q);
    } catch (bfErr) {
      console.warn('piyasa_cikanlar backfill skipped:', bfErr.message || bfErr);
    }
    const { limit, offset } = parsePagination(req, { defaultLimit: 500, maxLimit: 5000 });
    const firma = sanitizeString(req.query.firma || '', 100).trim();
    const plaka = sanitizeString(req.query.plaka || '', 50).trim();
    const il = sanitizeString(req.query.il || req.query.sehir || '', 80).trim();
    const fromMs = istanbulDayStartMs(req.query.from);
    const toEnd = istanbulDayEndMs(req.query.to) || istanbulDayEndMs(req.query.from);
    const params = [];
    const where = [
      CIKANLAR_LINKED_REPORT_SQL,
      'NOT ' + BLANK_CIKANLAR_PREDICATE,
      `COALESCE(firma, '') !~* '(^|[^A-Za-z0-9])G?YD[0-9]{1,4}'`,
    ];
    if (fromMs != null) {
      params.push(fromMs);
      where.push(`tarih >= $${params.length}`);
    }
    if (toEnd != null) {
      params.push(toEnd);
      where.push(`tarih < $${params.length}`);
    }
    if (firma) {
      params.push('%' + foldTrIl(firma).replace(/\s+/g, '') + '%');
      where.push(`replace(replace(replace(upper(SPLIT_PART(firma, '/', 1)), 'İ', 'I'), 'ı', 'I'), ' ', '') LIKE $${params.length}`);
    }
    if (plaka) {
      params.push('%' + plaka.toUpperCase().replace(/\s+/g, '') + '%');
      where.push(`replace(UPPER(plaka), ' ', '') LIKE $${params.length}`);
    }
    if (il) {
      params.push('%' + foldTrIl(il) + '%');
      where.push(
        `(replace(replace(upper(COALESCE(sehir, '')), 'İ', 'I'), 'ı', 'I') LIKE $${params.length}`
        + ` OR replace(replace(upper(COALESCE(sevk_yeri, '')), 'İ', 'I'), 'ı', 'I') LIKE $${params.length})`
      );
    }
    const whereSql = where.length ? (' WHERE ' + where.join(' AND ')) : '';
    const countR = await q(`SELECT COUNT(*)::int AS c FROM piyasa_cikanlar${whereSql}`, params);
    params.push(limit);
    params.push(offset);
    const r = await q(
      `SELECT id, print_history_id, tarih, plaka, dorse_plaka, sofor, firma, firma_adi, sip_no,
              malzeme, yukleme_turu, sehir, sevk_yeri, miktar, tonaj, basim_yeri, kantarci,
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
    let rows = (r.rows || []).map((row) => {
      const inst = fmt(row.tarih);
      const week = resolveHafta(row.hafta, row.tarih);
      const info = isoWeekInfoFromMs(row.tarih);
      return Object.assign({}, row, {
        tarihLabel: inst.tarih || '',
        saatLabel: inst.saat || '',
        sehirLabel: displaySehir(row),
        firmaLabel: displayFirmaKod(row.firma),
        hafta: week != null ? String(week) : (row.hafta || ''),
        haftaLabel: haftaLabel(week),
        haftaYear: info ? info.year : null,
      });
    }).filter((row) => !isYdFirma(row.firma));
    if (firma) rows = rows.filter((row) => firmaMatchesQuery(row.firma, firma));
    const weeks = groupCikanlarByHafta(rows, Date.now());
    const total = firma ? rows.length : Number(countR.rows[0]?.c || 0);
    res.json({ ok: true, total, rows, weeks });
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
    if (normalized.print_history_id) {
      const existing = await q(
        `SELECT id FROM piyasa_cikanlar
         WHERE print_history_id = $1 OR id = $2
         ORDER BY tarih DESC
         LIMIT 1`,
        [normalized.print_history_id, 'ph_' + normalized.print_history_id]
      );
      if (existing.rows[0] && existing.rows[0].id) normalized.id = existing.rows[0].id;
    }
    await q(
      `INSERT INTO piyasa_cikanlar(
         id, print_history_id, tarih, plaka, dorse_plaka, sofor, firma, firma_adi, sip_no,
         malzeme, yukleme_turu, sehir, sevk_yeri, miktar, tonaj, basim_yeri, kantarci,
         order_key, hafta, sheet, sevkiyat_tipi, vehicle_id
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22
       )
       ON CONFLICT (id) DO UPDATE SET
         print_history_id = COALESCE(EXCLUDED.print_history_id, piyasa_cikanlar.print_history_id),
         plaka = EXCLUDED.plaka,
         firma = EXCLUDED.firma,
         firma_adi = EXCLUDED.firma_adi,
         sip_no = EXCLUDED.sip_no,
         malzeme = EXCLUDED.malzeme,
         yukleme_turu = COALESCE(NULLIF(EXCLUDED.yukleme_turu, ''), piyasa_cikanlar.yukleme_turu),
         sehir = COALESCE(NULLIF(EXCLUDED.sehir, ''), piyasa_cikanlar.sehir),
         sevk_yeri = COALESCE(NULLIF(EXCLUDED.sevk_yeri, ''), piyasa_cikanlar.sevk_yeri),
         tarih = EXCLUDED.tarih,
         kantarci = COALESCE(NULLIF(EXCLUDED.kantarci, ''), piyasa_cikanlar.kantarci),
         basim_yeri = COALESCE(NULLIF(EXCLUDED.basim_yeri, ''), piyasa_cikanlar.basim_yeri)`,
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
        normalized.kantarci,
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
