'use strict';

const path = require('path');
const { execFile } = require('child_process');
const isg = require('../public/modules/isg-form');

const ISG_DOCX = path.join(__dirname, '..', 'public', 'assets', 'isg-t004.docx');

function printIsgDocx() {
  return new Promise((resolve, reject) => {
    if (process.platform !== 'win32') {
      const err = new Error('unavailable');
      err.code = 'UNAVAILABLE';
      reject(err);
      return;
    }
    const filePath = ISG_DOCX.replace(/'/g, "''");
    const command = [
      "$ErrorActionPreference = 'Stop'",
      `$path = '${filePath}'`,
      'if (-not (Test-Path -LiteralPath $path)) { throw "missing" }',
      '$word = New-Object -ComObject Word.Application',
      '$word.Visible = $false',
      '$word.DisplayAlerts = 0',
      'try {',
      '  $doc = $word.Documents.Open($path, $false, $true)',
      '  $null = $doc.PrintOut()',
      '  Start-Sleep -Seconds 2',
      '  $doc.Close($false)',
      '} finally {',
      '  $word.Quit()',
      '}'
    ].join('\n');
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { timeout: 45000 }, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

function mapIsgRow(row) {
  if (!row) return null;
  const hasData = row.has_data === true || !!(row.file_data && String(row.file_data).length > 20);
  const fileUrl = isg.safeHttpUrl(row.file_url || '');
  return {
    id: row.id,
    plateKey: row.plate_key || '',
    driverKey: row.driver_key || '',
    nameKey: row.name_key || '',
    vehicleId: row.vehicle_id || '',
    plateText: row.plate_text || '',
    driverName: row.driver_name || '',
    signed: row.signed === true || row.signed === 't' || row.signed === 1 || row.signed === '1',
    signedAt: row.signed_at != null ? Number(row.signed_at) : null,
    docNo: row.doc_no || '',
    formCode: row.form_code || isg.FORM_CODE,
    recordedBy: row.recorded_by || '',
    controlled: row.controlled === true || row.controlled === 't' || row.controlled === 1 || row.controlled === '1',
    controlledAt: row.controlled_at != null ? Number(row.controlled_at) : null,
    controlledBy: row.controlled_by || '',
    fileName: row.file_name || '',
    fileUrl,
    hasFile: hasData || !!fileUrl,
    updatedAt: row.updated_at != null ? Number(row.updated_at) : null
  };
}

async function findExisting(q, payload) {
  if (payload.driverKey || payload.nameKey) {
    const r = await q(
      `SELECT id, file_name, file_url, file_data, signed_at, recorded_by, doc_no,
              controlled, controlled_at, controlled_by
       FROM isg_forms
       WHERE ($1 <> '' AND (driver_key = $1 OR name_key = $1))
          OR ($2 <> '' AND (driver_key = $2 OR name_key = $2))
       ORDER BY signed DESC, updated_at DESC NULLS LAST
       LIMIT 1`,
      [payload.driverKey || '', payload.nameKey || '']
    );
    return r.rows[0] || null;
  }
  if (payload.plateKey) {
    const r = await q(
      `SELECT id, file_name, file_url, file_data, signed_at, recorded_by, doc_no,
              controlled, controlled_at, controlled_by
       FROM isg_forms
       WHERE plate_key = $1 AND coalesce(driver_key, '') = '' AND coalesce(name_key, '') = ''
       ORDER BY signed DESC, updated_at DESC NULLS LAST
       LIMIT 1`,
      [payload.plateKey]
    );
    return r.rows[0] || null;
  }
  return null;
}

function registerIsgRoutes(api, ctx) {
  const { q, requireValidSession, sendApiError, sanitizeString, broadcastEvent } = ctx;

  api.get('/isg', requireValidSession, async (req, res) => {
    try {
      const r = await q(
        `SELECT id, plate_key, driver_key, name_key, vehicle_id, plate_text, driver_name,
                signed, signed_at, doc_no, form_code, recorded_by,
                controlled, controlled_at, controlled_by, file_name, file_url,
                CASE WHEN file_data IS NOT NULL AND length(file_data) > 20 THEN TRUE ELSE FALSE END AS has_data,
                updated_at
         FROM isg_forms
         ORDER BY updated_at DESC NULLS LAST
         LIMIT 5000`
      );
      const records = (r.rows || []).map((row) => mapIsgRow(row));
      res.setHeader('Cache-Control', 'private, no-store');
      res.json({ records });
    } catch (err) {
      sendApiError(res, err, 500, 'ISG_LIST_FAILED');
    }
  });

  api.get('/isg/:id/file', requireValidSession, async (req, res) => {
    try {
      const id = sanitizeString(req.params.id, 80);
      const r = await q(
        `SELECT file_name, file_url, file_data FROM isg_forms WHERE id = $1`,
        [id]
      );
      const row = r.rows[0];
      if (!row) return res.status(404).json({ error: 'not found' });
      const fileUrl = isg.safeHttpUrl(row.file_url || '');
      const data = String(row.file_data || '');
      if (!data && fileUrl) return res.redirect(fileUrl);
      const m = data.match(/^data:([^;]+);base64,(.+)$/);
      if (!m) return res.status(404).json({ error: 'file missing' });
      const buf = Buffer.from(m[2], 'base64');
      res.setHeader('Content-Type', m[1]);
      res.setHeader('Content-Length', String(buf.length));
      res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('Content-Disposition', 'inline; filename="' + String(row.file_name || 'isg-form').replace(/"/g, '') + '"');
      return res.send(buf);
    } catch (err) {
      sendApiError(res, err, 500, 'ISG_FILE_FAILED');
    }
  });

  api.post('/isg', requireValidSession, async (req, res) => {
    try {
      const body = req.body || {};
      const userName = sanitizeString((req.user && req.user.username) || '', 80);
      const payload = isg.buildSavePayload(body, userName);
      if (!payload.plateKey && !payload.driverKey) {
        return res.status(400).json({ error: 'Plaka veya şoför gerekli' });
      }
      let fileData;
      if (Object.prototype.hasOwnProperty.call(body, 'fileData') && body.fileData) {
        fileData = isg.safeFileData(body.fileData);
        if (fileData == null) return res.status(400).json({ error: 'Geçersiz veya çok büyük dosya' });
      }
      let fileUrl;
      if (Object.prototype.hasOwnProperty.call(body, 'fileUrl')) {
        const rawUrl = String(body.fileUrl || '').trim();
        if (rawUrl && !isg.safeHttpUrl(rawUrl)) {
          return res.status(400).json({ error: 'Dosya bağlantısı http veya https olmalı' });
        }
        fileUrl = isg.safeHttpUrl(rawUrl);
      }
      const fileName = sanitizeString(body.fileName || body.file_name || '', 180);
      const existing = await findExisting(q, payload);
      const now = Date.now();
      const signedAt = payload.signed ? payload.signedAt : (existing && existing.signed_at ? Number(existing.signed_at) : null);
      const nextFileName = fileName || (existing && existing.file_name) || '';
      const nextFileUrl = fileUrl !== undefined ? fileUrl : ((existing && existing.file_url) || '');
      const nextFileData = fileData !== undefined ? fileData : ((existing && existing.file_data) || '');
      const kept = isg.preserveControl(existing, payload.signed);
      const id = existing ? existing.id : ('isg_' + now + '_' + Math.random().toString(16).slice(2, 10));
      if (existing) {
        await q(
          `UPDATE isg_forms SET
             plate_key=$2, driver_key=$3, name_key=$4, vehicle_id=$5, plate_text=$6, driver_name=$7,
             signed=$8, signed_at=$9, doc_no=$10, form_code=$11, recorded_by=$12,
             file_name=$13, file_url=$14, file_data=$15, updated_at=$16,
             controlled=$17, controlled_at=$18, controlled_by=$19
           WHERE id=$1`,
          [
            id, payload.plateKey, payload.driverKey, payload.nameKey || '', payload.vehicleId, payload.plateText, payload.driverName,
            payload.signed, signedAt, payload.docNo, payload.formCode, payload.recordedBy,
            nextFileName, nextFileUrl, nextFileData, now,
            kept.controlled, kept.controlledAt, kept.controlledBy
          ]
        );
      } else {
        await q(
          `INSERT INTO isg_forms(
             id, plate_key, driver_key, name_key, vehicle_id, plate_text, driver_name,
             signed, signed_at, doc_no, form_code, recorded_by, file_name, file_url, file_data, updated_at,
             controlled, controlled_at, controlled_by
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
          [
            id, payload.plateKey, payload.driverKey, payload.nameKey || '', payload.vehicleId, payload.plateText, payload.driverName,
            payload.signed, signedAt, payload.docNo, payload.formCode, payload.recordedBy,
            nextFileName, nextFileUrl, nextFileData, now,
            false, null, ''
          ]
        );
      }
      const saved = mapIsgRow({
        id,
        plate_key: payload.plateKey,
        driver_key: payload.driverKey,
        name_key: payload.nameKey || '',
        vehicle_id: payload.vehicleId,
        plate_text: payload.plateText,
        driver_name: payload.driverName,
        signed: payload.signed,
        signed_at: signedAt,
        doc_no: payload.docNo,
        form_code: payload.formCode,
        recorded_by: payload.recordedBy,
        controlled: existing ? kept.controlled : false,
        controlled_at: existing ? kept.controlledAt : null,
        controlled_by: existing ? kept.controlledBy : '',
        file_name: nextFileName,
        file_url: nextFileUrl,
        file_data: nextFileData,
        updated_at: now
      });
      try {
        broadcastEvent('isg_updated', { id, signed: payload.signed, plateKey: payload.plateKey, driverKey: payload.driverKey });
      } catch (e) { /* ignore */ }
      res.json({ ok: true, record: saved });
    } catch (err) {
      sendApiError(res, err, 500, 'ISG_SAVE_FAILED');
    }
  });

  api.post('/isg/:id/control', requireValidSession, async (req, res) => {
    try {
      if (!isg.canControlIsg(req.user)) {
        return res.status(403).json({ error: 'Bu işlemi yalnızca Selahattin Toker yapabilir' });
      }
      const id = sanitizeString(req.params.id, 80);
      if (!id) return res.status(400).json({ error: 'Kayıt bulunamadı' });
      const r = await q(
        `SELECT id, plate_key, driver_key, name_key, vehicle_id, plate_text, driver_name,
                signed, signed_at, doc_no, form_code, recorded_by,
                controlled, controlled_at, controlled_by, file_name, file_url, file_data, updated_at
         FROM isg_forms WHERE id = $1`,
        [id]
      );
      const row = r.rows[0];
      if (!row) return res.status(404).json({ error: 'Kayıt bulunamadı' });
      const signed = row.signed === true || row.signed === 't' || row.signed === 1 || row.signed === '1';
      if (!signed) return res.status(400).json({ error: 'İmzasız form kontrol edilemez' });
      const already = row.controlled === true || row.controlled === 't' || row.controlled === 1 || row.controlled === '1';
      const now = Date.now();
      const by = sanitizeString((req.user && req.user.username) || 'xxr', 80);
      if (!already) {
        await q(
          `UPDATE isg_forms SET controlled = TRUE, controlled_at = $2, controlled_by = $3, updated_at = $2 WHERE id = $1`,
          [id, now, by]
        );
        row.controlled = true;
        row.controlled_at = now;
        row.controlled_by = by;
        row.updated_at = now;
      }
      const saved = mapIsgRow(row);
      try {
        broadcastEvent('isg_updated', { id, signed: true, controlled: true, plateKey: row.plate_key, driverKey: row.driver_key });
      } catch (e) { /* ignore */ }
      res.json({ ok: true, record: saved });
    } catch (err) {
      sendApiError(res, err, 500, 'ISG_CONTROL_FAILED');
    }
  });

  api.post('/isg/print-doc', requireValidSession, async (req, res) => {
    try {
      await printIsgDocx();
      res.json({ ok: true });
    } catch (err) {
      if (err && (err.code === 'UNAVAILABLE' || /missing/i.test(String(err.message || '')))) {
        return res.status(501).json({ error: 'Belge bu bilgisayardan yazıcıya gönderilemedi' });
      }
      console.error('POST /isg/print-doc', err);
      sendApiError(res, err, 500, 'ISG_PRINT_FAILED');
    }
  });
}

module.exports = { registerIsgRoutes, mapIsgRow };
