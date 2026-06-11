'use strict';

function registerPlakaStatsRoutes(api, ctx) {
  const { q, pool, auth, parsePagination, sendApiError, requireValidSession, requireAdmin, sanitizeString, validatePlateFormat, broadcastEvent, broadcastReportUpdate, withTransaction, computeVehicleSortTs, normPlateForLookup, VEH_PLATE_NORM_SQL_CEK, PLATE_NORM_SQL, PLATE_NORM_SQL_PH, plateNormSql } = ctx;
// â€”â€”â€” Plaka istatistikleri (yazdÄ±rma = geliÅŸ) â€”â€”â€”
api.get("/plaka-stats", async (req, res) => {
  try {
    const tab = String(req.query.tab || 'top').toLowerCase();
    const days = Math.min(Math.max(Number(req.query.days) || 60, 7), 365);
    const search = sanitizeString(req.query.search || '', 50).trim();
    const { limit, offset } = parsePagination(req, { defaultLimit: 100, maxLimit: 500 });
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    const searchNorm = normPlateForLookup(search);

    const registeredSet = new Set();
    try {
      const vr = await q(`SELECT cekiciplaka FROM vehicles WHERE cekiciplaka IS NOT NULL AND cekiciplaka <> ''`);
      (vr.rows || []).forEach((row) => {
        const n = normPlateForLookup(row.cekiciplaka);
        if (n) registeredSet.add(n);
      });
    } catch (e) { /* ignore */ }

    let rows = [];

    if (tab === 'top' || tab === 'once') {
      const having = tab === 'once' ? ' HAVING COUNT(*) = 1' : '';
      let sql = `
        SELECT plaka,
               COUNT(*)::int AS print_count,
               MAX(tarih)::bigint AS last_print_ts,
               MIN(tarih)::bigint AS first_print_ts
        FROM print_history
        WHERE plaka IS NOT NULL AND plaka <> ''
      `;
      const params = [];
      if (searchNorm) {
        params.push(`%${searchNorm}%`);
        sql += ` AND ${PLATE_NORM_SQL} LIKE $${params.length}`;
      }
      sql += ` GROUP BY plaka${having} ORDER BY print_count DESC, last_print_ts DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
      params.push(limit, offset);
      const r = await q(sql, params);
      rows = (r.rows || []).map((row) => ({
        plaka: row.plaka,
        printCount: row.print_count,
        lastPrintTs: row.last_print_ts,
        firstPrintTs: row.first_print_ts,
        kayitli: registeredSet.has(normPlateForLookup(row.plaka))
      }));
    } else if (tab === 'never') {
      let sql = `
        SELECT v.cekiciplaka AS plaka, v.sort_ts AS kayit_ts
        FROM vehicles v
        WHERE v.cekiciplaka IS NOT NULL AND v.cekiciplaka <> ''
        AND NOT EXISTS (
          SELECT 1 FROM print_history ph
          WHERE ${PLATE_NORM_SQL_PH} = ${VEH_PLATE_NORM_SQL_CEK}
        )
      `;
      const params = [];
      if (searchNorm) {
        params.push(`%${searchNorm}%`);
        sql += ` AND ${VEH_PLATE_NORM_SQL_CEK} LIKE $${params.length}`;
      }
      sql += ` ORDER BY v.sort_ts DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
      params.push(limit, offset);
      const r = await q(sql, params);
      rows = (r.rows || []).map((row) => ({
        plaka: row.plaka,
        printCount: 0,
        lastPrintTs: null,
        firstPrintTs: null,
        kayitTs: row.kayit_ts,
        kayitli: true
      }));
    } else if (tab === 'idle') {
      const sql = `
        WITH ph_agg AS (
          SELECT plaka,
                 COUNT(*)::int AS print_count,
                 MAX(tarih)::bigint AS last_print_ts
          FROM print_history
          WHERE plaka IS NOT NULL AND plaka <> ''
          GROUP BY plaka
        ),
        idle_printed AS (
          SELECT plaka, print_count, last_print_ts, 'printed_idle'::text AS idle_kind
          FROM ph_agg
          WHERE last_print_ts < $1
        ),
        idle_never AS (
          SELECT v.cekiciplaka AS plaka, 0 AS print_count, NULL::bigint AS last_print_ts, 'never_printed'::text AS idle_kind
          FROM vehicles v
          WHERE v.cekiciplaka IS NOT NULL AND v.cekiciplaka <> ''
          AND v.sort_ts < $1
          AND NOT EXISTS (
            SELECT 1 FROM print_history ph
            WHERE ${PLATE_NORM_SQL_PH} = ${VEH_PLATE_NORM_SQL_CEK}
          )
        )
        SELECT * FROM idle_printed
        UNION ALL
        SELECT * FROM idle_never
        ORDER BY last_print_ts ASC NULLS FIRST, plaka ASC
        LIMIT $2 OFFSET $3
      `;
      const r = await q(sql, [cutoff, limit, offset]);
      rows = (r.rows || [])
        .filter((row) => !searchNorm || normPlateForLookup(row.plaka).includes(searchNorm))
        .map((row) => ({
          plaka: row.plaka,
          printCount: row.print_count,
          lastPrintTs: row.last_print_ts,
          idleKind: row.idle_kind,
          kayitli: registeredSet.has(normPlateForLookup(row.plaka))
        }));
    } else {
      return res.status(400).json({ error: 'Invalid tab', allowed: ['top', 'once', 'never', 'idle'] });
    }

    res.json({ tab, days, items: rows, limit, offset });
  } catch (err) {
    console.error('GET /plaka-stats error', err);
    sendApiError(res, err, 500, 'PLAKA_STATS_FAILED');
  }
});

// Plaka Ã— firma Ã— malzeme (Excel / takip formundan basÄ±lan Ã¼rÃ¼nler)
api.get("/plaka-product-stats", async (req, res) => {
  try {
    const search = sanitizeString(req.query.search || '', 80).trim();
    const { limit, offset } = parsePagination(req, { defaultLimit: 100, maxLimit: 500 });
    const searchNorm = normPlateForLookup(search);
    const searchUpper = search.toUpperCase();

    let sql = `
      SELECT plaka,
             firma,
             malzeme,
             COUNT(*)::int AS print_count,
             MAX(tarih)::bigint AS last_print_ts
      FROM print_history
      WHERE plaka IS NOT NULL AND plaka <> ''
        AND (COALESCE(firma, '') <> '' OR COALESCE(malzeme, '') <> '')
    `;
    const params = [];
    if (search) {
      params.push(`%${searchNorm}%`, `%${searchUpper}%`, `%${searchUpper}%`);
      const i = params.length;
      sql += ` AND (
        ${PLATE_NORM_SQL} LIKE $${i - 2}
        OR UPPER(COALESCE(firma, '')) LIKE $${i - 1}
        OR UPPER(COALESCE(malzeme, '')) LIKE $${i}
      )`;
    }
    sql += ` GROUP BY plaka, firma, malzeme
      ORDER BY print_count DESC, last_print_ts DESC, plaka ASC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const r = await q(sql, params);
    res.json({
      items: (r.rows || []).map((row) => ({
        plaka: row.plaka,
        firma: row.firma || '',
        malzeme: row.malzeme || '',
        printCount: row.print_count,
        lastPrintTs: row.last_print_ts,
      })),
      limit,
      offset,
    });
  } catch (err) {
    console.error('GET /plaka-product-stats error', err);
    sendApiError(res, err, 500, 'PLAKA_PRODUCT_STATS_FAILED');
  }
});

api.get("/plaka-stats/summary", async (req, res) => {
  try {
    const days = Math.min(Math.max(Number(req.query.days) || 60, 7), 365);
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    const [topR, onceR, neverR, idleR, totalPrintsR, productPairsR, editLogR] = await Promise.all([
      q(`SELECT COUNT(*)::int AS c FROM (SELECT plaka FROM print_history WHERE plaka <> '' GROUP BY plaka) t`),
      q(`SELECT COUNT(*)::int AS c FROM (SELECT plaka FROM print_history WHERE plaka <> '' GROUP BY plaka HAVING COUNT(*) = 1) t`),
      q(`
        SELECT COUNT(*)::int AS c FROM vehicles v
        WHERE v.cekiciplaka IS NOT NULL AND v.cekiciplaka <> ''
        AND NOT EXISTS (
          SELECT 1 FROM print_history ph
          WHERE ${PLATE_NORM_SQL_PH} = ${VEH_PLATE_NORM_SQL_CEK}
        )
      `),
      q(`
        SELECT COUNT(*)::int AS c FROM (
          SELECT plaka FROM print_history WHERE plaka <> '' GROUP BY plaka HAVING MAX(tarih) < $1
          UNION
          SELECT v.cekiciplaka FROM vehicles v
          WHERE v.cekiciplaka <> '' AND v.sort_ts < $1
          AND NOT EXISTS (
            SELECT 1 FROM print_history ph
            WHERE ${PLATE_NORM_SQL_PH} = ${VEH_PLATE_NORM_SQL_CEK}
          )
        ) u
      `, [cutoff]),
      q(`SELECT COUNT(*)::int AS c FROM print_history`),
      q(`SELECT COUNT(*)::int AS c FROM (
        SELECT plaka, firma, malzeme FROM print_history
        WHERE plaka <> '' AND (COALESCE(firma,'') <> '' OR COALESCE(malzeme,'') <> '')
        GROUP BY plaka, firma, malzeme
      ) t`),
      q(`SELECT COUNT(*)::int AS c FROM vehicle_edit_log WHERE edit_ts >= $1`, [cutoff]),
    ]);
    res.json({
      days,
      uniquePlates: topR.rows[0]?.c || 0,
      onceCount: onceR.rows[0]?.c || 0,
      neverPrintedRegistered: neverR.rows[0]?.c || 0,
      idleCount: idleR.rows[0]?.c || 0,
      totalPrints: totalPrintsR.rows[0]?.c || 0,
      productPairCount: productPairsR.rows[0]?.c || 0,
      editLogCount: editLogR.rows[0]?.c || 0,
    });
  } catch (err) {
    console.error('GET /plaka-stats/summary error', err);
    sendApiError(res, err, 500, 'PLAKA_STATS_SUMMARY_FAILED');
  }
});

// ÅofÃ¶r kartÄ± dÃ¼zenleme geÃ§miÅŸi (ayarlar â†’ Plaka istatistikleri â†’ Bilgi)
api.get('/vehicle-edit-log', async (req, res) => {
  try {
    const search = sanitizeString(req.query.search || '', 80).trim();
    const plakaFilter = sanitizeString(req.query.plaka || '', 50).trim();
    const { limit, offset } = parsePagination(req, { defaultLimit: 20, maxLimit: 500 });
    const searchNorm = normPlateForLookup(search);
    const plakaNorm = normPlateForLookup(plakaFilter);

    let sql = `SELECT id, vehicle_id, plaka, summary, changes, user_id, edit_ts FROM vehicle_edit_log WHERE 1=1`;
    const params = [];

    if (plakaNorm) {
      params.push(plakaNorm);
      sql += ` AND ${plateNormSql('plaka')} = $${params.length}`;
    } else if (search) {
      params.push(`%${searchNorm}%`, `%${search.toUpperCase()}%`);
      sql += ` AND (${plateNormSql('plaka')} LIKE $${params.length - 1} OR UPPER(COALESCE(summary, '')) LIKE $${params.length})`;
    }

    sql += ` ORDER BY edit_ts DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const r = await q(sql, params);
    res.json({
      items: (r.rows || []).map((row) => {
        let changes = [];
        try { changes = JSON.parse(row.changes || '[]'); } catch (e) { changes = []; }
        return {
          id: row.id,
          vehicleId: row.vehicle_id,
          plaka: row.plaka,
          summary: row.summary || '',
          changes,
          userId: row.user_id || '',
          editTs: row.edit_ts,
        };
      }),
      limit,
      offset,
    });
  } catch (err) {
    console.error('GET /vehicle-edit-log error', err);
    sendApiError(res, err, 500, 'VEHICLE_EDIT_LOG_FAILED');
  }
});
}

module.exports = { registerPlakaStatsRoutes };
