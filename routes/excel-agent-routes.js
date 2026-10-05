'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const {
  MAX_UPLOAD_BYTES,
  safeEqualText,
  sanitizeUploadName,
  readAgentScript,
} = require('../lib/excel-agent-store');

/** Kantar başına anahtar: hangi kantarın Excel'i olduğu anahtardan anlaşılır. */
function agentKeysFromEnv(env) {
  const e = env || process.env;
  return {
    AVDAN: String(e.EXCEL_AGENT_KEY_AVDAN || '').trim(),
    '1.OSB': String(e.EXCEL_AGENT_KEY_1OSB || '').trim(),
  };
}

/**
 * Kantar PC'lerindeki Excel Ajanı uçları. Oturum (JWT) yerine kantar anahtarıyla
 * (EXCEL_AGENT_KEY_AVDAN / EXCEL_AGENT_KEY_1OSB) korunur;
 * bu yüzden `api.use(auth.verifyToken)` satırından ÖNCE kaydedilmelidir.
 */
function registerExcelAgentRoutes(api, ctx) {
  const { excelAgentStore, broadcastEvent, sendApiError } = ctx;
  const getKeys = typeof ctx.getAgentKeys === 'function' ? ctx.getAgentKeys : () => agentKeysFromEnv();
  const scriptPath = ctx.agentScriptPath;

  const agentLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 120,
    standardHeaders: true,
    legacyHeaders: false,
  });

  function requireAgentKey(req, res, next) {
    const keys = getKeys() || {};
    const sites = Object.keys(keys).filter((site) => String(keys[site] || '').length >= 16);
    if (!sites.length) {
      return res.status(503).json({
        ok: false,
        error: { code: 'EXCEL_AGENT_DISABLED', message: 'Sunucuda EXCEL_AGENT_KEY_AVDAN / EXCEL_AGENT_KEY_1OSB tanımlı değil.' },
      });
    }
    const given = String(req.headers['x-excel-agent-key'] || '').trim();
    const site = sites.find((s) => safeEqualText(given, keys[s]));
    if (!site) {
      return res.status(401).json({
        ok: false,
        error: { code: 'EXCEL_AGENT_BAD_KEY', message: 'Ajan anahtarı hatalı.' },
      });
    }
    req.agentSite = site;
    return next();
  }

  const guard = [agentLimiter, requireAgentKey];

  api.get('/excel-agent/ping', guard, (req, res) => {
    const script = readAgentScript(scriptPath);
    res.setHeader('Cache-Control', 'no-store');
    res.json({ ok: true, version: script ? script.version : '', serverTime: Date.now() });
  });

  api.get('/excel-agent/version', guard, (req, res) => {
    const script = readAgentScript(scriptPath);
    res.setHeader('Cache-Control', 'no-store');
    res.json({ ok: true, version: script ? script.version : '' });
  });

  api.get('/excel-agent/script', guard, (req, res) => {
    const script = readAgentScript(scriptPath);
    if (!script) return res.status(404).json({ ok: false, error: { code: 'EXCEL_AGENT_SCRIPT_MISSING' } });
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('X-Excel-Agent-Version', script.version);
    return res.status(200).send(script.buf);
  });

  api.put(
    '/excel-agent/upload',
    guard,
    express.raw({ type: () => true, limit: MAX_UPLOAD_BYTES }),
    async (req, res) => {
      try {
        const fileName = sanitizeUploadName(req.query.name);
        if (!fileName) {
          return res.status(400).json({
            ok: false,
            error: { code: 'EXCEL_AGENT_BAD_NAME', message: 'Geçersiz Excel dosya adı.' },
          });
        }
        const saved = await excelAgentStore.saveUpload({
          fileName,
          buf: req.body,
          mtime: req.query.mtime,
          machine: req.query.machine,
          site: req.agentSite,
        });
        if (!saved.unchanged && typeof broadcastEvent === 'function') {
          broadcastEvent('ihracat_excel_uploaded', {
            site: saved.site,
            fileName: saved.fileName,
            mtime: saved.mtime,
            machine: String(req.query.machine || '').slice(0, 120),
          }, 'excel_agent');
        }
        return res.json({ ok: true, ...saved });
      } catch (err) {
        return sendApiError(res, err, 500, 'EXCEL_AGENT_UPLOAD_FAILED');
      }
    }
  );
}

module.exports = { registerExcelAgentRoutes, agentKeysFromEnv };
