'use strict';

const {
  loadOzmalEntries,
  saveOzmalEntries,
  buildDriverLoginAccounts,
  normalizeEntries,
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
