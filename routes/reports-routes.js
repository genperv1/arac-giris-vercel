'use strict';

function registerReportsRoutes(api, ctx) {
  const { q, pool, auth, parsePagination, sendApiError, requireValidSession, requireAdmin, sanitizeString, validatePlateFormat, broadcastEvent, broadcastReportUpdate, withTransaction, computeVehicleSortTs, formatReportInstant, istanbulMinutesFromTs } = ctx;
// Reports
api.get("/reports", async (req, res) => {
  try {
    const { limit, offset } = parsePagination(req, { defaultLimit: 5000, maxLimit: 20000 });
    const r = await q("SELECT id, plaka, firma, malzeme, tonaj, basim_yeri, sevkiyat_id, sofor, sevk_yeri, yukleme_turu, tarih FROM print_history ORDER BY tarih DESC LIMIT $1 OFFSET $2", [limit, offset]);
    
    const parsed = (r.rows || []).map((row) => {
      try {
        const raw = row.tarih;
        let ms = Date.now();
        if (raw !== null && raw !== undefined && raw !== '') {
          const n = Number(raw);
          if (Number.isFinite(n)) ms = n;
          else {
            const parsedMs = Date.parse(String(raw));
            if (!isNaN(parsedMs)) ms = parsedMs;
          }
        }
        const { tarih: tarihStr, saat: saatStr } = formatReportInstant(ms);

        const d = {
          plaka: row.plaka,
          firma: row.firma,
          malzeme: row.malzeme,
          tonaj: row.tonaj,
          basimYeri: row.basim_yeri,
          sevkiyat_id: row.sevkiyat_id,
          sofor: row.sofor || '',
          sevkYeri: row.sevk_yeri || '',
          yuklemeTuru: row.yukleme_turu || '',
          ambalajBilgisi: row.yukleme_turu || '',
          tarih: tarihStr,
          saat: saatStr
        };

        return {
          id: row.id,
          type: 'PRINT',
          data: d,
          ts: ms,
          tarih: tarihStr,
          saat: saatStr,
          kantar: d && d.kantar ? d.kantar : '',
          malzeme: d && d.malzeme ? d.malzeme : '',
          sevkYeri: d && d.sevkYeri ? d.sevkYeri : '',
          firma: (d && (d.firma || d.firmaKodu || d.firmaSelect)) ? (d.firma || d.firmaKodu || d.firmaSelect) : ''
        };
      } catch {
        return { id: row.id, type: row.type, data: row.data, ts: row.ts, saat: '', kantar: '', malzeme: '', sevkYeri: '' };
      }
    });
    res.json(parsed);
  } catch (err) {
    sendApiError(res, err, 500, 'REPORTS_LIST_FAILED');
  }
});

// Reports grouped by date (convenience endpoint)
api.get('/reportsgroupbydate', async (req, res) => {
  try {
    // Use data.tarih if present, otherwise derive from ts (stored as milliseconds)
    const r = await q(`
      SELECT
        COALESCE(NULLIF(data::json->>'tarih',''), to_char(to_timestamp(ts/1000), 'DD.MM.YYYY')) AS tarih,
        COUNT(*)::int AS count,
        MAX(ts) AS last_ts
      FROM report
      GROUP BY tarih
      ORDER BY MAX(ts) DESC
    `);

    const rows = (r.rows || []).map(row => ({ tarih: row.tarih || '', count: Number(row.count || 0) }));
    res.json(rows);
  } catch (err) {
    console.error('GET /reportsgroupbydate error', err && err.message);
    res.status(500).json({ error: err.message });
  }
});

// Reports for a specific date
api.get('/reportbydate', async (req, res) => {
  try {
    const date = String(req.query.date || '').trim();
    if (!date) return res.status(400).json({ error: 'date query parameter required (format DD.MM.YYYY)' });

    const r = await q(`
      SELECT id, type, data, ts
      FROM report
      WHERE (data::json->>'tarih') = $1
         OR to_char(to_timestamp(ts/1000), 'DD.MM.YYYY') = $1
      ORDER BY ts DESC
    `, [date]);

    const rows = (r.rows || []).map(row => {
      try {
        return { id: row.id, type: row.type, data: JSON.parse(row.data || '{}'), ts: row.ts };
      } catch (e) {
        return { id: row.id, type: row.type, data: row.data, ts: row.ts };
      }
    });

    res.json(rows);
  } catch (err) {
    console.error('GET /reportbydate error', err && err.message);
    res.status(500).json({ error: err.message });
  }
});

// Statistics: counts of day/night shift PRINT events for today
api.get('/stats/daily-shifts', async (req, res) => {
  try {
    // compute start/end of current day in server local timezone
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0).getTime();
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate()+1, 0, 0, 0, 0).getTime();
    // Count PRINT events (do not dedupe by plate) so stats match event counts
    const r = await q('SELECT id, type, data, ts FROM report WHERE ts >= $1 AND ts < $2 AND type = $3', [start, end, 'PRINT']);
    const rows = r.rows || [];

    function timeStrToMinutes(s){
      try{
        if (!s) return null;
        const m = String(s||'').trim().match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
        if (!m) return null;
        const hh = parseInt(m[1],10);
        const mm = parseInt(m[2],10);
        return hh*60 + mm;
      }catch(e){return null;}
    }
    let dayCount = 0;
    let nightCount = 0;

    for (const row of rows) {
      try {
        let d = {};
        try { d = JSON.parse(row.data || '{}'); } catch(e) { d = {}; }
        
        // Ã–nce direkt vardiya alanÄ±nÄ± kontrol et
        if (d && d.vardiya) {
          const vardiyaStr = String(d.vardiya).toLowerCase().trim();
          if (vardiyaStr === 'gÃ¼ndÃ¼z' || vardiyaStr === 'gunduz' || vardiyaStr === 'day') {
            dayCount++;
            continue;
          } else if (vardiyaStr === 'gece' || vardiyaStr === 'night') {
            nightCount++;
            continue;
          }
        }
        
        // Vardiya alanÄ± yoksa saat bilgisinden hesapla
        let mins = null;
        if (d && (d.saat || d.time)) {
          mins = timeStrToMinutes(d.saat || d.time);
        }
        if (mins === null && row.ts) {
          mins = istanbulMinutesFromTs(row.ts);
        }

        // shift rules: night: 00:00-08:00 (mins 0-480), day: 08:00-18:00 (mins 480-1080)
        if (mins !== null) {
          if (mins >= 0 && mins < 8*60) {
            nightCount++;
          } else if (mins >= 8*60 && mins < 18*60) {
            dayCount++;
          }
        }
      } catch (e) {}
    }

    res.json({ ok: true, date: new Date(start).toISOString().slice(0,10), day: dayCount, night: nightCount, total: dayCount + nightCount });
  } catch (err) {
    console.error('GET /stats/daily-shifts error', err && err.message);
    res.status(500).json({ error: err.message });
  }
});

// Ä°Ã§erideki araÃ§ sayÄ±sÄ±: report tablosunda data.cikisYapildi = true olan kayÄ±tlarÄ±n sayÄ±sÄ±nÄ± dÃ¶ndÃ¼rÃ¼r
api.get('/icerideki-count', async (req, res) => {
  try {
    const r = await q("SELECT COUNT(*)::int AS cnt FROM report WHERE (data::json->>'cikisYapildi') = 'false'");
    const count = (r.rows && r.rows[0]) ? Number(r.rows[0].cnt || 0) : 0;
    res.json({ ok: true, count });
  } catch (err) {
    console.error('GET /icerideki-count error', err && err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Ä°Ã§erideki araÃ§larÄ±n plakalarÄ±nÄ± dÃ¶ndÃ¼rÃ¼r (data.cikisYapildi = true olan kayÄ±tlar)
api.get('/icerideki-plates', async (req, res) => {
  try {
    const r = await q("SELECT id, type, data, ts FROM report WHERE (data::json->>'cikisYapildi') = 'false' ORDER BY ts DESC");
    const parsed = (r.rows || []).map(row => {
      try {
        return { id: row.id, type: row.type, data: JSON.parse(row.data || '{}'), ts: row.ts };
      } catch (e) {
        return { id: row.id, type: row.type, data: row.data, ts: row.ts };
      }
    });

    res.json({ ok: true, reports: parsed });
  } catch (err) {
    console.error('GET /icerideki-plates error', err && err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Set cikisYapildi flag for a specific report id
api.post('/reports/:id/set-cikis', async (req, res) => {
  try {
    const id = String(req.params.id || '');
    if (!id) return res.status(400).json({ ok: false, error: 'id required' });

    const val = (req.body && typeof req.body.cikisYapildi !== 'undefined') ? !!req.body.cikisYapildi : true;

    // load existing report
    const r = await q('SELECT data, ts FROM report WHERE id = $1', [id]);
    if (!r.rows[0]) return res.status(404).json({ ok: false, error: 'not found' });

    let obj = {};
    try { obj = JSON.parse(r.rows[0].data || '{}'); } catch (e) { obj = { raw: r.rows[0].data }; }
    obj.cikisYapildi = !!val;

    // determine timestamp to use for the update
    const ts = Number(req.body.ts || Date.now());

    // when marking as exited, record the exit timestamp in the JSON payload
    if (obj.cikisYapildi) {
      // Accept client-provided cikisTarihi (ms or parsable string) or use the computed ts.
      const provided = (req.body && typeof req.body.cikisTarihi !== 'undefined') ? req.body.cikisTarihi : undefined;
      let dateObj = null;
      if (typeof provided !== 'undefined' && provided !== null && String(provided).trim() !== '') {
        const asNum = Number(provided);
        if (!Number.isNaN(asNum)) dateObj = new Date(asNum);
        else {
          const parsed = Date.parse(String(provided));
          if (!Number.isNaN(parsed)) dateObj = new Date(parsed);
        }
      }
      if (!dateObj) dateObj = new Date(ts);
      // store a human-readable date-time string (Turkish locale)
      try { obj.cikisTarihi = dateObj.toLocaleString('tr-TR'); } catch (e) { obj.cikisTarihi = dateObj.toISOString(); }
    } else {
      // if exit is being unset, remove any previous cikisTarihi to keep data consistent
      try { if (obj.cikisTarihi !== undefined) delete obj.cikisTarihi; } catch (e) {}
    }

      const raw = JSON.stringify(obj);
      // Enforce 250-character limit on the serialized `data` field
      if (typeof raw === 'string' && raw.length > 500) {
        return res.status(400).json({ ok: false, error: 'data field exceeds 300 characters' });
      }

    await q('UPDATE report SET data = $1, ts = $2 WHERE id = $3', [raw, ts, id]);

    res.json({ ok: true, id });
  } catch (err) {
    console.error('POST /reports/:id/set-cikis error', err && err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

api.post("/reports", requireValidSession, async (req, res) => {
  try {
    const body = req.body || {};
    const id = String(body.id || (Date.now().toString() + Math.random().toString(16).slice(2)));
    // âœ… SECURITY: Sanitize type field
    const type = sanitizeString(body.type || "", 50);
    let data = body.data !== undefined ? body.data : body;

    // normalize payload to an object and ensure `cikisYapildi` exists (default false)
    let dataObj = {};
    try {
      if (typeof data === 'string') {
        try { dataObj = JSON.parse(data); } catch (e) { dataObj = { value: sanitizeString(data, 200) }; }
      } else if (data && typeof data === 'object') {
        dataObj = Object.assign({}, data);
      } else {
        dataObj = { value: sanitizeString(String(data || ''), 200) };
      }
    } catch (e) {
      dataObj = { value: sanitizeString(String(data || ''), 200) };
    }
    if (typeof dataObj.cikisYapildi === 'undefined') dataObj.cikisYapildi = false;
    
    // Sanitize string fields in dataObj
    if (dataObj.plaka) dataObj.plaka = sanitizeString(dataObj.plaka, 50);
    if (dataObj.firma) dataObj.firma = sanitizeString(dataObj.firma, 150);
    if (dataObj.malzeme) dataObj.malzeme = sanitizeString(dataObj.malzeme, 100);
    if (dataObj.sofor) dataObj.sofor = sanitizeString(dataObj.sofor, 200);
    
    // safe stringify: try JSON.stringify, fallback to string conversion
    let raw = '';
    try {
      raw = JSON.stringify(dataObj);
    } catch (e) {
      console.error('Report serialization failed, incoming body:', body);
      try { raw = JSON.stringify({ _note: 'serialization_failed', value: sanitizeString(String(dataObj), 200) }); } catch (e2) { raw = sanitizeString(String(dataObj || ''), 200); }
    }
    // Enforce 500-character limit on the serialized `data` field
    if (typeof raw === 'string' && raw.length > 500) {
      return res.status(400).json({ error: 'data field exceeds 500 characters' });
    }
    const ts = Number(body.ts || Date.now());

    await q(
      `
      INSERT INTO report(id, type, data, ts)
      VALUES($1,$2,$3,$4)
      ON CONFLICT (id) DO UPDATE SET
        type = EXCLUDED.type,
        data = EXCLUDED.data,
        ts = EXCLUDED.ts
      `,
      [id, type, raw, ts]
    );

    res.json({ ok: true, id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

api.delete("/reports", requireValidSession, async (req, res) => {
  try {
    await q("DELETE FROM report");
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// Migration: remove legacy lastPrintedAt from vehicles and reports, replace with date-only "tarih"
api.post('/migrate/remove-lastPrintedAt', requireAdmin, async (req, res) => {
  try {
    const result = await withTransaction(async (client) => {
      let vUpdated = 0;
      let rUpdated = 0;
      let failed = 0;

      const vr = await client.query('SELECT id, data FROM vehicles');
      for (const row of (vr.rows || [])) {
        try {
          const obj = JSON.parse(row.data || '{}');
          if (obj && obj.lastPrintedAt !== undefined && obj.lastPrintedAt !== null) {
            try { obj.tarih = new Date(Number(obj.lastPrintedAt)).toLocaleDateString('tr-TR'); } catch(e) { obj.tarih = ''; }
            try { delete obj.lastPrintedAt; } catch(e) {}
            const raw = JSON.stringify(obj);
            await client.query('UPDATE vehicles SET data = $1, sort_ts = $2 WHERE id = $3', [raw, computeVehicleSortTs(obj), row.id]);
            vUpdated++;
          }
        } catch(e){ failed++; }
      }

      const rr = await client.query('SELECT id, data FROM report');
      for (const row of (rr.rows || [])) {
        try {
          const d = JSON.parse(row.data || '{}');
          if (d && d.lastPrintedAt !== undefined && d.lastPrintedAt !== null) {
            try { d.tarih = new Date(Number(d.lastPrintedAt)).toLocaleDateString('tr-TR'); } catch(e) { d.tarih = ''; }
            try { delete d.lastPrintedAt; } catch(e) {}
            const raw = JSON.stringify(d);
            await client.query('UPDATE report SET data = $1 WHERE id = $2', [raw, row.id]);
            rUpdated++;
          }
        } catch(e){ failed++; }
      }
      return { vUpdated, rUpdated, failed };
    }, 'migrate-remove-lastPrintedAt');
    res.json({ ok: true, vehiclesUpdated: result.vUpdated, reportsUpdated: result.rUpdated, failed: result.failed });
  } catch (err) {
    sendApiError(res, err, 500, 'MIGRATION_FAILED');
  }
});


api.get("/reports/count", async (req, res) => {
  try {
    const basimYeriRaw = String(req.query.basimYeri || "").trim();
    const basimYeri = basimYeriRaw ? basimYeriRaw.toUpperCase() : "";
    let query = "SELECT COUNT(*) AS kayit_sayisi FROM print_history";
    const params = [];

    if (basimYeri) {
      query += " WHERE basim_yeri = $1";
      params.push(basimYeri);
    }

    const r = await q(query + ";", params);
    if (!r.rows[0]) return res.status(404).json({ error: "Not found" });
    return res.json({ count: Number(r.rows[0].kayit_sayisi || 0) });
  } catch (err) {
    sendApiError(res, err, 500, 'REPORT_COUNT_FAILED');
  }
});
}

module.exports = { registerReportsRoutes };
