'use strict';

const {
  getPrintFormBgBuffer,
  getPrintFormBgRecord,
  setPrintFormBg,
  isAcceptablePrintFormBg,
  localFileMeta,
} = require('../lib/print-form-bg-store');

function registerPrintFormBgImageRoute(api, ctx) {
  const { q, sendApiError } = ctx;

  api.get('/print-form-bg/meta', async (req, res) => {
    try {
      const local = localFileMeta();
      const record = local || await getPrintFormBgRecord(q);
      if (!record) return res.json({ ok: true, exists: false, acceptable: false, needsUpload: true });
      const acceptable = isAcceptablePrintFormBg(record) || !!local;
      res.setHeader('Cache-Control', 'public, max-age=300');
      res.json({
        ok: true,
        exists: true,
        acceptable,
        needsUpload: !acceptable,
        updatedAt: Number(record.updatedAt) || 0,
        source: record.source || '',
      });
    } catch (err) {
      console.error('GET /print-form-bg/meta error', err);
      sendApiError(res, err, 500, 'PRINT_FORM_BG_META_FAILED');
    }
  });

  api.get('/print-form-bg', async (req, res) => {
    try {
      const image = await getPrintFormBgBuffer(q);
      if (!image) return res.status(404).json({ error: 'print form background not found' });
      const etag = `W/"pbg-${image.buffer.length}-${image.contentType}"`;
      if (req.headers['if-none-match'] === etag) return res.status(304).end();
      res.setHeader('Content-Type', image.contentType);
      res.setHeader('ETag', etag);
      res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
      return res.send(image.buffer);
    } catch (err) {
      console.error('GET /print-form-bg error', err);
      sendApiError(res, err, 500, 'PRINT_FORM_BG_GET_FAILED');
    }
  });
}

function registerPrintFormBgRoutes(api, ctx) {
  const { q, sendApiError, requireValidSession } = ctx;

  api.post('/print-form-bg', requireValidSession, async (req, res) => {
    try {
      const body = req.body || {};
      const imageData = String(body.imageData || body.image_data || body.image || '').trim();
      if (!imageData) return res.status(400).json({ error: 'image required' });
      if (imageData.length > 6_800_000) return res.status(400).json({ error: 'image too large' });
      const payload = await setPrintFormBg(q, imageData, {
        source: body.source || 'upload',
      });
      res.json({ ok: true, updatedAt: payload.updatedAt, source: payload.source });
    } catch (err) {
      if (err.status === 400) return res.status(400).json({ error: err.message || 'invalid image' });
      console.error('POST /print-form-bg error', err);
      sendApiError(res, err, 500, 'PRINT_FORM_BG_SAVE_FAILED');
    }
  });
}

module.exports = { registerPrintFormBgImageRoute, registerPrintFormBgRoutes };
