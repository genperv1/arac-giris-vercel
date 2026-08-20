'use strict';

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { extractAuthTokenFromRequest } = require('./auth-session');

const DRIVER_PANEL_OFFICE_PASSWORD = String(process.env.DRIVER_PANEL_OFFICE_PASSWORD || '543723');
const DEFAULT_DRIVER_PASSWORD = String(process.env.DEFAULT_DRIVER_PASSWORD || '189274');
const DRIVER_SESSION_HOURS = 12;

/** Yeni şoförler ve varsayılan sıfırlama — sabit; ofis panelinden değiştirilebilir */
function generateDriverPassword() {
  return DEFAULT_DRIVER_PASSWORD;
}

/** Ofis panelinde ↻ ile tek şoför şifresi yenileme */
function generateRandomDriverPassword() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

async function hashDriverPassword(plain) {
  return bcrypt.hash(String(plain || ''), 10);
}

async function verifyDriverPassword(plain, hash) {
  if (!plain || !hash) return false;
  try {
    return await bcrypt.compare(String(plain), String(hash));
  } catch (e) {
    return false;
  }
}

function signDriverToken(jwtSecret, payload) {
  return jwt.sign(payload, jwtSecret, { expiresIn: `${DRIVER_SESSION_HOURS}h` });
}

function verifyDriverToken(jwtSecret, token) {
  return jwt.verify(token, jwtSecret);
}

function createDriverAuthMiddleware(jwtSecret) {
  function extractDriverToken(req) {
    const qToken = String(req.query?.access_token || req.query?.token || '').trim();
    if (qToken) return qToken;
    return extractAuthTokenFromRequest(req, 'driver_panel_token');
  }

  function requireDriverPanelAccess(req, res, next) {
    const token = extractDriverToken(req);
    if (!token) {
      return res.status(401).json({ ok: false, error: 'Oturum gerekli', code: 'DRIVER_SESSION_MISSING' });
    }
    try {
      const decoded = verifyDriverToken(jwtSecret, token);
      if (!decoded || (decoded.role !== 'driver' && decoded.role !== 'office')) {
        return res.status(401).json({ ok: false, error: 'Geçersiz oturum', code: 'DRIVER_SESSION_INVALID' });
      }
      req.driverPanel = decoded;
      return next();
    } catch (e) {
      return res.status(401).json({ ok: false, error: 'Oturum süresi doldu', code: 'DRIVER_SESSION_EXPIRED' });
    }
  }

  function requireOfficePanelAccess(req, res, next) {
    requireDriverPanelAccess(req, res, () => {
      if (!req.driverPanel || req.driverPanel.role !== 'office') {
        return res.status(403).json({ ok: false, error: 'Ofis panel yetkisi gerekli' });
      }
      return next();
    });
  }

  return { requireDriverPanelAccess, requireOfficePanelAccess };
}

function verifyOfficePanelPassword(password) {
  return String(password || '') === DRIVER_PANEL_OFFICE_PASSWORD;
}

module.exports = {
  DRIVER_PANEL_OFFICE_PASSWORD,
  DEFAULT_DRIVER_PASSWORD,
  DRIVER_SESSION_HOURS,
  generateDriverPassword,
  generateRandomDriverPassword,
  hashDriverPassword,
  verifyDriverPassword,
  signDriverToken,
  verifyDriverToken,
  createDriverAuthMiddleware,
  verifyOfficePanelPassword,
};
