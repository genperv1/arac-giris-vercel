'use strict';

const {
  getPrintLayoutRecord,
  setPrintLayout,
  clearPrintLayout,
} = require('../lib/print-layout-store');

/** Yazdırma penceresi auth gönderemez — GET auth öncesinde kayıtlı. */
function registerPrintLayoutReadRoute(api, ctx) {
  const { q, sendApiError } = ctx;

  api.get('/print-layout', async (req, res) => {
    try {
      const layout = await getPrintLayoutRecord(q);
      if (!layout) {
        return res.json({ ok: true, exists: false, layout: null, updatedAt: 0 });
      }
      return res.json({
        ok: true,
        exists: true,
        layout,
        updatedAt: Number(layout.updatedAt) || 0,
      });
    } catch (err) {
      console.error('GET /print-layout error', err);
      return sendApiError(res, err, 500, 'PRINT_LAYOUT_READ_FAILED');
    }
  });
}

function registerPrintLayoutSettingsRoutes(api, ctx) {
  const { q, sendApiError, requireSettingsAccess, broadcastEvent } = ctx;

  api.post('/settings/print-layout', requireSettingsAccess, async (req, res) => {
    try {
      const body = req.body || {};
      if (body.reset === true) {
        await clearPrintLayout(q);
        if (typeof broadcastEvent === 'function') {
          broadcastEvent('print_layout_updated', { reset: true, updatedAt: Date.now() });
        }
        return res.json({ ok: true, reset: true, updatedAt: Date.now() });
      }

      const layout = await setPrintLayout(q, body.layout || body);
      if (typeof broadcastEvent === 'function') {
        broadcastEvent('print_layout_updated', { updatedAt: layout.updatedAt });
      }
      return res.json({ ok: true, layout, updatedAt: layout.updatedAt });
    } catch (err) {
      if (err.status === 400) {
        return res.status(400).json({ ok: false, error: err.message || 'Geçersiz düzen' });
      }
      console.error('POST /settings/print-layout error', err);
      return sendApiError(res, err, 500, 'PRINT_LAYOUT_SAVE_FAILED');
    }
  });
}

module.exports = {
  registerPrintLayoutReadRoute,
  registerPrintLayoutSettingsRoutes,
};
