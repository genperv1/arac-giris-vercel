'use strict';

const {
  loadOzmalEntries,
  saveOzmalEntries,
  buildDriverLoginAccounts,
  normalizeEntries,
  addOzmalPlateDriver,
  formatPlateDisplay,
  normDriverName,
} = require('../lib/ozmal-store');
const { isAmirIdentity } = require('../lib/amir-user');

function canReadOzmalEntries(user) {
  const role = String((user && user.role) || '').trim().toLowerCase();
  return role === 'admin' || role === 'amir' || isAmirIdentity(user);
}

/**
 * Oturum yoksa 401, oturum var ama ofis yetkisi yoksa 403.
 * @param {object} ctx
 */
function requireOzmalEntriesRead(ctx) {
  return function ozmalEntriesRead(req, res, next) {
    const requireValidSession = ctx && ctx.requireValidSession;
    if (typeof requireValidSession !== 'function') {
      return res.status(401).json({
        ok: false,
        error: 'Oturum gerekli',
        code: 'SESSION_MISSING',
      });
    }
    return requireValidSession(req, res, () => {
      if (canReadOzmalEntries(req.user)) return next();
      return res.status(403).json({
        ok: false,
        error: 'Özmal listesini görme yetkisi yok',
        code: 'OZMAL_FORBIDDEN',
      });
    });
  };
}

/**
 * @param {import('express').Router} api
 * @param {object} ctx
 */
function registerOzmalRoutes(api, ctx) {
  const { q, sendApiError, requireSettingsAccess } = ctx;

  api.get('/ozmal-entries', requireOzmalEntriesRead(ctx), async (req, res) => {
    try {
      const entries = await loadOzmalEntries(q);
      return res.json({ entries });
    } catch (err) {
      return sendApiError(res, err, 500, 'OZMAL_ENTRIES_READ_FAILED');
    }
  });

  api.post('/settings/ozmal-entries', requireSettingsAccess, async (req, res) => {
    try {
      const raw = Array.isArray(req.body?.entries) ? req.body.entries : [];
      const entries = await saveOzmalEntries(q, raw);
      return res.json({ ok: true, entries });
    } catch (err) {
      return sendApiError(res, err, 500, 'OZMAL_ENTRIES_SAVE_FAILED');
    }
  });

  api.post('/settings/ozmal-add', requireSettingsAccess, async (req, res) => {
    try {
      const plaka = formatPlateDisplay(req.body?.plaka || '');
      const driver = String(req.body?.driver || '').trim();
      if (!plaka) {
        return res.status(400).json({ ok: false, error: 'Plaka gerekli' });
      }
      const result = await addOzmalPlateDriver(q, plaka, driver);
      if (!result.ok) {
        return res.status(400).json(result);
      }
      return res.json(result);
    } catch (err) {
      return sendApiError(res, err, 500, 'OZMAL_ADD_FAILED');
    }
  });

  api.get('/settings/ozmal-entries-full', requireSettingsAccess, async (req, res) => {
    try {
      const entries = await loadOzmalEntries(q, { withPasswords: true });
      return res.json({ entries });
    } catch (err) {
      return sendApiError(res, err, 500, 'OZMAL_ENTRIES_FULL_READ_FAILED');
    }
  });

  api.post('/settings/ozmal-regenerate-password', requireSettingsAccess, async (req, res) => {
    try {
      const plaka = formatPlateDisplay(req.body?.plaka || '');
      const driver = normDriverName(req.body?.driver || '');
      if (!plaka || !driver) {
        return res.status(400).json({ ok: false, error: 'Plaka ve şoför gerekli' });
      }
      return res.status(410).json({ ok: false, error: 'Şoför girişi kapatıldı. Şifre üretilmez.' });
    } catch (err) {
      return sendApiError(res, err, 500, 'OZMAL_PASSWORD_REGEN_FAILED');
    }
  });
}

/**
 * @param {import('express').Router} api
 * @param {object} ctx
 */
function registerDriverAuthRoutes(api, ctx) {
  const { q, sendApiError } = ctx;

  api.get('/driver-login/accounts', async (req, res) => {
    try {
      const entries = await loadOzmalEntries(q);
      const accounts = buildDriverLoginAccounts(entries);
      return res.json({ accounts });
    } catch (err) {
      return sendApiError(res, err, 500, 'DRIVER_LOGIN_ACCOUNTS_FAILED');
    }
  });

  api.post('/driver-login/accounts', async (req, res) => {
    try {
      const entries = await loadOzmalEntries(q);
      const accounts = buildDriverLoginAccounts(entries);
      return res.json({ accounts });
    } catch (err) {
      return sendApiError(res, err, 500, 'DRIVER_LOGIN_ACCOUNTS_FAILED');
    }
  });
}

module.exports = {
  registerOzmalRoutes,
  registerDriverAuthRoutes,
  normalizeEntries,
  canReadOzmalEntries,
  requireOzmalEntriesRead,
};
