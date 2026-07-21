'use strict';

const {
  loadOzmalEntries,
  saveOzmalEntries,
  buildDriverLoginAccounts,
  normalizeEntries,
  addOzmalPlateDriver,
  formatPlateDisplay,
  regenerateDriverPassword,
  normDriverName,
} = require('../lib/ozmal-store');

/**
 * @param {import('express').Router} api
 * @param {object} ctx
 */
function registerOzmalRoutes(api, ctx) {
  const { q, sendApiError, requireSettingsAccess } = ctx;

  api.get('/ozmal-entries', async (req, res) => {
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
      const result = await regenerateDriverPassword(q, plaka, driver);
      if (!result) {
        return res.status(404).json({ ok: false, error: 'Şoför bulunamadı' });
      }
      return res.json({ ok: true, passwordPlain: result.passwordPlain });
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
};
