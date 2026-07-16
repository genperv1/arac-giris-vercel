'use strict';

const path = require('path');
const {
  loadRoutePoints,
  saveRoutePoints,
  listTrips,
  getTripById,
  createTrip,
  updateTrip,
  getKmMismatchWarning,
} = require('../lib/driver-trip-store');
const {
  findDriverAccount,
  loadOzmalEntries,
  saveOzmalEntries,
  regenerateDriverPassword,
  verifyDriverPassword,
  formatPlateDisplay,
  normDriverName,
} = require('../lib/ozmal-store');
const {
  signDriverToken,
  verifyOfficePanelPassword,
  createDriverAuthMiddleware,
} = require('../lib/driver-auth');

/**
 * @param {import('express').Router} api
 * @param {object} ctx
 */
function registerDriverTripRoutes(api, ctx) {
  const { q, sendApiError, requireSettingsAccess, JWT_SECRET } = ctx;
  const { requireDriverPanelAccess, requireOfficePanelAccess } = createDriverAuthMiddleware(JWT_SECRET);

  api.post('/driver-login', async (req, res) => {
    try {
      const plaka = formatPlateDisplay(req.body?.plaka || '');
      const driver = normDriverName(req.body?.driver || '');
      const password = String(req.body?.password || '');

      if (!plaka || !driver || !password) {
        return res.status(400).json({ ok: false, error: 'Plaka, şoför ve şifre gerekli' });
      }

      const account = await findDriverAccount(q, plaka, driver);
      if (!account) {
        return res.status(401).json({ ok: false, error: 'Geçersiz plaka veya şoför' });
      }

      const ok = await verifyDriverPassword(password, account.passwordHash);
      if (!ok) {
        return res.status(401).json({ ok: false, error: 'Şifre hatalı' });
      }

      const token = signDriverToken(JWT_SECRET, {
        role: 'driver',
        plaka: account.plaka,
        driver: account.driver,
      });

      return res.json({
        ok: true,
        token,
        plaka: account.plaka,
        driver: account.driver,
      });
    } catch (err) {
      return sendApiError(res, err, 500, 'DRIVER_LOGIN_FAILED');
    }
  });

  api.post('/driver-panel/office-login', async (req, res) => {
    try {
      const password = String(req.body?.password || '');
      if (!verifyOfficePanelPassword(password)) {
        return res.status(401).json({ ok: false, error: 'Panel parolası hatalı' });
      }
      const token = signDriverToken(JWT_SECRET, { role: 'office' });
      return res.json({ ok: true, token, role: 'office' });
    } catch (err) {
      return sendApiError(res, err, 500, 'DRIVER_OFFICE_LOGIN_FAILED');
    }
  });

  api.get('/driver-route-points', async (req, res) => {
    try {
      const points = await loadRoutePoints(q);
      return res.json({ points });
    } catch (err) {
      return sendApiError(res, err, 500, 'ROUTE_POINTS_READ_FAILED');
    }
  });

  api.post('/settings/driver-route-points', requireSettingsAccess, async (req, res) => {
    try {
      const points = await saveRoutePoints(q, req.body?.points);
      return res.json({ ok: true, points });
    } catch (err) {
      return sendApiError(res, err, 500, 'ROUTE_POINTS_SAVE_FAILED');
    }
  });

  api.post('/settings/driver-route-points', requireSettingsAccess, async (req, res) => {
    try {
      const points = await saveRoutePoints(q, req.body?.points);
      return res.json({ ok: true, points });
    } catch (err) {
      return sendApiError(res, err, 500, 'ROUTE_POINTS_SAVE_FAILED');
    }
  });

  api.get('/driver-panel/ozmal-entries', requireOfficePanelAccess, async (req, res) => {
    try {
      const entries = await loadOzmalEntries(q, { withPasswords: true });
      return res.json({ entries });
    } catch (err) {
      return sendApiError(res, err, 500, 'DRIVER_PANEL_OZMAL_READ_FAILED');
    }
  });

  api.post('/driver-panel/ozmal-entries', requireOfficePanelAccess, async (req, res) => {
    try {
      const raw = Array.isArray(req.body?.entries) ? req.body.entries : [];
      const entries = await saveOzmalEntries(q, raw);
      return res.json({ ok: true, entries });
    } catch (err) {
      return sendApiError(res, err, 500, 'DRIVER_PANEL_OZMAL_SAVE_FAILED');
    }
  });

  api.post('/driver-panel/ozmal-regenerate-password', requireOfficePanelAccess, async (req, res) => {
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
      return sendApiError(res, err, 500, 'DRIVER_PANEL_PASSWORD_REGEN_FAILED');
    }
  });

  api.post('/driver-panel/route-points', requireOfficePanelAccess, async (req, res) => {
    try {
      const points = await saveRoutePoints(q, req.body?.points);
      return res.json({ ok: true, points });
    } catch (err) {
      return sendApiError(res, err, 500, 'DRIVER_PANEL_ROUTE_POINTS_SAVE_FAILED');
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

  api.get('/driver-trips/photo/:tripId/:file', requireDriverPanelAccess, (req, res) => {
    try {
      const tripId = String(req.params.tripId || '').replace(/[^a-zA-Z0-9\-]/g, '');
      const file = String(req.params.file || '').replace(/[^a-zA-Z0-9\._\-]/g, '');
      if (!tripId || !file) return res.status(400).json({ error: 'invalid path' });
      const full = path.join(__dirname, '..', 'uploads', 'driver-trips', tripId, file);
      return res.sendFile(full, (err) => {
        if (err) return res.status(404).json({ error: 'not found' });
      });
    } catch (err) {
      return sendApiError(res, err, 500, 'DRIVER_PHOTO_FAILED');
    }
  });

  api.get('/driver-trips', requireDriverPanelAccess, async (req, res) => {
    try {
      const session = req.driverPanel || {};
      const filterPlaka = session.role === 'driver' ? session.plaka : (req.query.plaka || null);
      if (session.role === 'driver' && req.query.plaka && req.query.plaka !== session.plaka) {
        return res.status(403).json({ ok: false, error: 'Bu plakaya erişim yok' });
      }
      const trips = await listTrips(q, { plaka: filterPlaka || null });
      const warnings = session.role === 'office'
        ? getKmMismatchWarning(trips)
        : getKmMismatchWarning(trips.filter((t) => t.plaka === session.plaka));
      return res.json({ trips, warnings });
    } catch (err) {
      return sendApiError(res, err, 500, 'DRIVER_TRIPS_READ_FAILED');
    }
  });

  api.get('/driver-trips/:id', requireDriverPanelAccess, async (req, res) => {
    try {
      const trip = await getTripById(q, req.params.id);
      if (!trip) return res.status(404).json({ ok: false, error: 'Kayıt bulunamadı' });
      const session = req.driverPanel || {};
      if (session.role === 'driver' && trip.plaka !== session.plaka) {
        return res.status(403).json({ ok: false, error: 'Bu kayda erişim yok' });
      }
      return res.json({ trip });
    } catch (err) {
      return sendApiError(res, err, 500, 'DRIVER_TRIP_READ_FAILED');
    }
  });

  api.post('/driver-trips', requireDriverPanelAccess, async (req, res) => {
    try {
      const session = req.driverPanel || {};
      const body = req.body || {};
      const plaka = session.role === 'driver'
        ? session.plaka
        : formatPlateDisplay(body.plaka || '');
      const driverName = session.role === 'driver'
        ? session.driver
        : normDriverName(body.driverName || body.driver || '');

      if (!plaka || !driverName) {
        return res.status(400).json({ ok: false, error: 'Plaka ve şoför gerekli' });
      }

      const photos = {
        photoGidisIrsaliye: body.photoGidisIrsaliye,
        photoGidisKantar: body.photoGidisKantar,
        photoDonusIrsaliye: body.photoDonusIrsaliye,
        photoDonusKantar: body.photoDonusKantar,
      };

      const trip = await createTrip(q, { plaka, driverName, body, photos });
      return res.json({ ok: true, trip });
    } catch (err) {
      const status = err.status || 500;
      return res.status(status).json({ ok: false, error: err.message || 'Kayıt oluşturulamadı' });
    }
  });

  api.put('/driver-trips/:id', requireDriverPanelAccess, async (req, res) => {
    try {
      const session = req.driverPanel || {};
      const body = req.body || {};
      const photos = {
        photoGidisIrsaliye: body.photoGidisIrsaliye,
        photoGidisKantar: body.photoGidisKantar,
        photoDonusIrsaliye: body.photoDonusIrsaliye,
        photoDonusKantar: body.photoDonusKantar,
      };
      const plakaFilter = session.role === 'driver' ? session.plaka : null;
      const trip = await updateTrip(q, req.params.id, { body, photos, plakaFilter });
      return res.json({ ok: true, trip });
    } catch (err) {
      const status = err.status || 500;
      return res.status(status).json({ ok: false, error: err.message || 'Kayıt güncellenemedi' });
    }
  });
}

module.exports = { registerDriverTripRoutes };
