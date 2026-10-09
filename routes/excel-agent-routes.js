'use strict';

const crypto = require('crypto');
const express = require('express');
const rateLimit = require('express-rate-limit');
const { rateLimitKey } = require('../lib/client-ip');
const { siteFromUsername } = require('../lib/kantar-nudge');
const {
  MAX_UPLOAD_BYTES,
  safeEqualText,
  sanitizeUploadName,
  readAgentScript,
} = require('../lib/excel-agent-store');
const { fileLabelOf, readSettledFileLabels } = require('../lib/liman-sheet');

const AGENT_PUBLIC_ORIGIN = 'https://genper.site';

/** Kantar başına anahtar. Env boşsa JWT_SECRET'ten türetilir; elle anahtar yazmadan ajan açılır. */
function agentKeysFromEnv(env) {
  const e = env || process.env;
  const secret = String(e.JWT_SECRET || '').trim();
  function keyFor(site, raw) {
    const value = String(raw || '').trim();
    if (value.length >= 16) return value;
    if (secret.length < 16) return value;
    return crypto.createHmac('sha256', secret).update('excel-agent-v1:' + site).digest('hex');
  }
  return {
    AVDAN: keyFor('AVDAN', e.EXCEL_AGENT_KEY_AVDAN),
    '1.OSB': keyFor('1.OSB', e.EXCEL_AGENT_KEY_1OSB),
  };
}

function agentPublicOrigin(req) {
  const raw = String((req && req.headers && (req.headers['x-forwarded-host'] || req.headers.host)) || '');
  const host = raw.split(',')[0].trim().replace(/:\d+$/, '').toLowerCase();
  if (!host || host === 'localhost' || host === '127.0.0.1') return AGENT_PUBLIC_ORIGIN;
  return 'https://' + host;
}

/** Kantar PC'de çift tıklanınca klasörü kurar, ayarı yazar, ajanı indirir ve başlatır. */
function buildAgentInstallerBat(site, key, origin) {
  const base = String(origin || AGENT_PUBLIC_ORIGIN).replace(/\/+$/, '');
  const anahtar = String(key || '').trim();
  const lines = [
    '@echo off',
    'chcp 65001 >nul',
    'set "DIR=%USERPROFILE%\\ExcelAjani"',
    'if not exist "%DIR%" mkdir "%DIR%"',
    'cd /d "%DIR%"',
    '> "%DIR%\\ayar.txt" (',
    '  echo SUNUCU=' + base,
    '  echo ANAHTAR=' + anahtar,
    '  echo KLASOR=',
    ')',
    'powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$ProgressPreference=\'SilentlyContinue\'; Invoke-WebRequest -Uri \'' + base + '/api/excel-agent/script\' -Headers @{ \'x-excel-agent-key\'=\'' + anahtar + '\' } -OutFile \'%DIR%\\ajan.ps1\'"',
    'if errorlevel 1 (',
    '  echo.',
    '  echo Ajan indirilemedi. Internet ve site adresini kontrol edin.',
    '  pause',
    '  exit /b 1',
    ')',
    'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%DIR%\\ajan.ps1" -Kur',
    'if errorlevel 1 (',
    '  echo Baslatilamadi. %DIR%\\ajan.log dosyasina bakin.',
    '  pause',
    '  exit /b 1',
    ')',
    'echo.',
    'echo Excel Ajani kuruldu. Excel kaydedilince siteye gider.',
    'echo Klasor: %DIR%',
    'echo Durdurmak icin bu klasordeki ajan.ps1 -Durdur',
    'timeout /t 8 >nul',
    'exit /b 0',
    '',
  ];
  return lines.join('\r\n');
}

/**
 * Kantar PC'lerindeki Excel Ajanı uçları. Oturum (JWT) yerine kantar anahtarıyla
 * (EXCEL_AGENT_KEY_AVDAN / EXCEL_AGENT_KEY_1OSB) korunur;
 * bu yüzden `api.use(auth.verifyToken)` satırından ÖNCE kaydedilmelidir.
 */
function registerExcelAgentRoutes(api, ctx) {
  const { excelAgentStore, broadcastEvent, sendApiError, q } = ctx;
  const getKeys = typeof ctx.getAgentKeys === 'function' ? ctx.getAgentKeys : () => agentKeysFromEnv();
  const scriptPath = ctx.agentScriptPath;

  const agentLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 120,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => rateLimitKey(req),
  });

  function requireAgentKey(req, res, next) {
    const keys = getKeys() || {};
    const sites = Object.keys(keys).filter((site) => String(keys[site] || '').length >= 16);
    if (!sites.length) {
      return res.status(503).json({
        ok: false,
        error: { code: 'EXCEL_AGENT_DISABLED', message: 'Excel Ajanı kapalı. Sunucuda JWT_SECRET veya EXCEL_AGENT_KEY tanımlı değil.' },
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

  api.get('/excel-agent/ping', guard, async (req, res) => {
    const script = readAgentScript(scriptPath);
    const dropFiles = await readSettledFileLabels(q);
    res.setHeader('Cache-Control', 'no-store');
    res.json({ ok: true, version: script ? script.version : '', serverTime: Date.now(), dropFiles });
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
        const dropFiles = await readSettledFileLabels(q);
        const label = fileLabelOf(fileName).toLowerCase();
        if (label && dropFiles.some((name) => String(name).toLowerCase() === label)) {
          return res.json({ ok: true, dropped: true, dropFiles });
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

  const { requireValidSession } = ctx;
  if (typeof requireValidSession === 'function') {
    api.get('/excel-agent/kurulum', requireValidSession, (req, res) => {
      const site = siteFromUsername(req.user && req.user.username);
      const keys = getKeys() || {};
      const key = site ? String(keys[site] || '') : '';
      if (!site || key.length < 16) {
        return res.status(403).json({
          ok: false,
          error: { code: 'EXCEL_AGENT_NOT_KANTAR', message: 'Excel Ajanı yalnız AVDAN ve 1.OSB hesabından kurulur.' },
        });
      }
      const origin = agentPublicOrigin(req);
      const bat = buildAgentInstallerBat(site, key, origin);
      const filename = 'Excel-Ajani-' + site.replace(/[^A-Za-z0-9]/g, '') + '.bat';
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Disposition', 'attachment; filename="' + filename + '"');
      return res.status(200).send(bat);
    });
  }
}

module.exports = {
  registerExcelAgentRoutes,
  agentKeysFromEnv,
  agentPublicOrigin,
  buildAgentInstallerBat,
  AGENT_PUBLIC_ORIGIN,
};
