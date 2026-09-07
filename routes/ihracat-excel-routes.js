'use strict';

const {
  FILE_NOT_FOUND_MSG,
  publicSourceView,
  getStoredSource,
  setStoredSource,
  clearStoredSource,
  mergeSource,
  readExcelFromStoredPath,
} = require('../lib/ihracat-excel-source');

function registerIhracatExcelRoutes(api, ctx) {
  const { q, sendApiError, requireValidSession } = ctx;

  api.get('/ihracat-excel/source', requireValidSession, async (req, res) => {
    try {
      const source = await getStoredSource(q);
      return res.json(publicSourceView(source));
    } catch (err) {
      return sendApiError(res, err, 500, 'IHRACAT_EXCEL_SOURCE_READ_FAILED');
    }
  });

  api.put('/ihracat-excel/source', requireValidSession, async (req, res) => {
    try {
      const source = await setStoredSource(q, req.body || {});
      return res.json(publicSourceView(source));
    } catch (err) {
      return sendApiError(res, err, 500, 'IHRACAT_EXCEL_SOURCE_SAVE_FAILED');
    }
  });

  api.delete('/ihracat-excel/source', requireValidSession, async (req, res) => {
    try {
      const source = await clearStoredSource(q);
      return res.json(publicSourceView(source));
    } catch (err) {
      return sendApiError(res, err, 500, 'IHRACAT_EXCEL_SOURCE_CLEAR_FAILED');
    }
  });

  api.post('/ihracat-excel/reread', requireValidSession, async (req, res) => {
    try {
      const stored = await getStoredSource(q);
      const source = mergeSource(stored, req.body || {});
      if (!source.fileName && !source.filePath) {
        return res.status(400).json({
          ok: false,
          error: {
            code: 'EXCEL_NOT_SELECTED',
            message: 'Önce İhracat Excel dosyasını seçmelisiniz.',
          },
        });
      }
      const read = await readExcelFromStoredPath(source);
      try {
        await setStoredSource(q, {
          fileName: read.fileName,
          filePath: read.filePath,
          lastUpdatedAt: read.mtime ? new Date(read.mtime).toISOString() : new Date().toISOString(),
        });
      } catch (_) {}
      const lastUpdated = read.mtime ? new Date(read.mtime).toISOString() : new Date().toISOString();
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader(
        'Content-Disposition',
        'attachment; filename="' + encodeURIComponent(read.fileName || 'ihracat.xlsx') + '"'
      );
      res.setHeader('X-Ihracat-Excel-File-Name', encodeURIComponent(read.fileName || 'ihracat.xlsx'));
      res.setHeader('X-Ihracat-Excel-Last-Updated', lastUpdated);
      return res.status(200).send(read.buf);
    } catch (err) {
      if (err && err.code === 'EXCEL_FILE_NOT_FOUND') {
        return res.status(404).json({
          ok: false,
          error: {
            code: 'EXCEL_FILE_NOT_FOUND',
            message: FILE_NOT_FOUND_MSG,
          },
        });
      }
      return sendApiError(res, err, 500, 'IHRACAT_EXCEL_REREAD_FAILED');
    }
  });
}

module.exports = { registerIhracatExcelRoutes };
