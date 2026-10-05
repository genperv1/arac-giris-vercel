'use strict';

/**
 * Excel Ajanı: kantar PC'lerine kurulan arka plan programı Excel kaydedildikçe
 * dosyayı buraya yükler. Site (tarayıcı) dosyayı yerel diskte bulamazsa buradaki
 * son kopyayı okur; böylece tarayıcı dosya izni düşse de liste güncel kalır.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const MAX_UPLOAD_BYTES = 40 * 1024 * 1024;
const AGENT_SITES = ['AVDAN', '1.OSB'];
const EXCEL_EXT_RE = /\.(xlsx|xls|xlsm|xlsb)$/i;
const AGENT_SCRIPT_PATH = path.join(__dirname, '..', 'excel-ajan', 'ajan.ps1');

function sanitizeUploadName(raw) {
  const base = path.basename(String(raw || '').replace(/\\/g, '/').trim());
  if (!base || base.length > 260 || base.includes('\0')) return '';
  if (base.startsWith('~$') || base.startsWith('.')) return '';
  if (!EXCEL_EXT_RE.test(base)) return '';
  return base;
}

function sha256Hex(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function safeEqualText(a, b) {
  const ha = crypto.createHash('sha256').update(String(a || '')).digest();
  const hb = crypto.createHash('sha256').update(String(b || '')).digest();
  return crypto.timingSafeEqual(ha, hb) && String(a || '').length > 0;
}

/** Her kantarın Excel'i ayrı saklanır: iki kantarda da "03.10.2026.xlsx" olabilir. */
function uploadKey(site, name) {
  const s = String(site || '').trim().toUpperCase();
  if (AGENT_SITES.indexOf(s) < 0) return '';
  return s.toLowerCase() + '|' + String(name || '').toLowerCase();
}

function siteOfKey(key) {
  const i = String(key || '').indexOf('|');
  return i > 0 ? key.slice(0, i).toUpperCase() : '';
}

function createExcelAgentStore(q) {
  let tableReady = null;

  function ensureTable() {
    if (!tableReady) {
      tableReady = q(`
        CREATE TABLE IF NOT EXISTS excel_agent_files(
          name_key TEXT PRIMARY KEY,
          file_name TEXT NOT NULL,
          data BYTEA NOT NULL,
          size BIGINT NOT NULL,
          sha256 TEXT NOT NULL,
          mtime BIGINT NOT NULL,
          uploaded_at BIGINT NOT NULL,
          machine TEXT
        );
      `).catch((err) => {
        tableReady = null;
        throw err;
      });
    }
    return tableReady;
  }

  async function saveUpload({ fileName, buf, mtime, machine, site }) {
    const name = sanitizeUploadName(fileName);
    if (!name) {
      const err = new Error('Geçersiz Excel dosya adı');
      err.status = 400;
      err.code = 'EXCEL_AGENT_BAD_NAME';
      throw err;
    }
    const key = uploadKey(site, name);
    if (!key) {
      const err = new Error('Kantar anlaşılamadı');
      err.status = 400;
      err.code = 'EXCEL_AGENT_BAD_SITE';
      throw err;
    }
    if (!Buffer.isBuffer(buf) || !buf.length || buf.length > MAX_UPLOAD_BYTES) {
      const err = new Error('Excel dosyası boş veya çok büyük');
      err.status = 400;
      err.code = 'EXCEL_AGENT_BAD_SIZE';
      throw err;
    }
    await ensureTable();
    const hash = sha256Hex(buf);
    const now = Date.now();
    const mt = Number.isFinite(Number(mtime)) && Number(mtime) > 0 ? Math.floor(Number(mtime)) : now;
    const prev = await q('SELECT sha256 FROM excel_agent_files WHERE name_key = $1', [key]);
    const unchanged = !!(prev.rows[0] && prev.rows[0].sha256 === hash);
    if (unchanged) {
      await q(
        'UPDATE excel_agent_files SET uploaded_at = $2, machine = $3 WHERE name_key = $1',
        [key, now, String(machine || '').slice(0, 120)]
      );
    } else {
      await q(
        `INSERT INTO excel_agent_files(name_key, file_name, data, size, sha256, mtime, uploaded_at, machine)
         VALUES($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (name_key) DO UPDATE SET
           file_name = EXCLUDED.file_name,
           data = EXCLUDED.data,
           size = EXCLUDED.size,
           sha256 = EXCLUDED.sha256,
           mtime = EXCLUDED.mtime,
           uploaded_at = EXCLUDED.uploaded_at,
           machine = EXCLUDED.machine`,
        [key, name, buf, buf.length, hash, mt, now, String(machine || '').slice(0, 120)]
      );
    }
    return { fileName: name, site: siteOfKey(key), size: buf.length, sha256: hash, mtime: mt, uploadedAt: now, unchanged };
  }

  async function getUpload(fileName, site) {
    const name = sanitizeUploadName(fileName);
    const key = name ? uploadKey(site, name) : '';
    if (!key) return null;
    await ensureTable();
    const r = await q(
      'SELECT file_name, data, size, mtime, uploaded_at, machine FROM excel_agent_files WHERE name_key = $1',
      [key]
    );
    const row = r.rows[0];
    if (!row) return null;
    return {
      buf: Buffer.isBuffer(row.data) ? row.data : Buffer.from(row.data || ''),
      fileName: row.file_name,
      mtime: new Date(Number(row.mtime)),
      uploadedAt: Number(row.uploaded_at),
      machine: row.machine || '',
    };
  }

  async function listUploads(limit) {
    await ensureTable();
    const n = Math.max(1, Math.min(200, Number(limit) || 50));
    const r = await q(
      `SELECT name_key, file_name, size, mtime, uploaded_at, machine
       FROM excel_agent_files ORDER BY uploaded_at DESC LIMIT $1`,
      [n]
    );
    return r.rows.map((row) => ({
      site: siteOfKey(row.name_key),
      fileName: row.file_name,
      size: Number(row.size),
      mtime: Number(row.mtime),
      uploadedAt: Number(row.uploaded_at),
      machine: row.machine || '',
    }));
  }

  async function pruneOlderThan(days) {
    await ensureTable();
    const cutoff = Date.now() - Math.max(1, Number(days) || 14) * 24 * 60 * 60 * 1000;
    const r = await q('DELETE FROM excel_agent_files WHERE uploaded_at < $1', [cutoff]);
    return r.rowCount || 0;
  }

  return { ensureTable, saveUpload, getUpload, listUploads, pruneOlderThan };
}

function readAgentScript(scriptPath) {
  try {
    const buf = fs.readFileSync(scriptPath || AGENT_SCRIPT_PATH);
    return { buf, version: sha256Hex(buf).slice(0, 16) };
  } catch (_) {
    return null;
  }
}

module.exports = {
  MAX_UPLOAD_BYTES,
  AGENT_SITES,
  uploadKey,
  AGENT_SCRIPT_PATH,
  sanitizeUploadName,
  safeEqualText,
  createExcelAgentStore,
  readAgentScript,
};
