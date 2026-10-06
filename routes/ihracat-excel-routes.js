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
const { fileLabelOf, readSettledFileLabels } = require('../lib/liman-sheet');

/** Oturumdaki kantar (AVDAN / 1.OSB); amir ve diğerleri için ''. */
function kantarSiteOf(req) {
  const name = String((req && req.user && req.user.username) || '').trim().toUpperCase();
  return name === 'AVDAN' || name === '1.OSB' ? name : '';
}

/** Güncelle seçilen Excel dosyasını okur. Ajanın yüklediği kopya karışmasın diye kullanılmaz. */
async function readNewestExcel(source) {
  return readExcelFromStoredPath(source);
}

function registerIhracatExcelRoutes(api, ctx) {
  const { q, sendApiError, requireValidSession, excelAgentStore } = ctx;

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

  api.get('/ihracat-excel/agent-files', requireValidSession, async (req, res) => {
    try {
      const site = kantarSiteOf(req);
      const all = excelAgentStore ? await excelAgentStore.listUploads(50) : [];
      const files = site ? all.filter((f) => f.site === site) : all;
      res.setHeader('Cache-Control', 'no-store');
      return res.json({ ok: true, files });
    } catch (err) {
      return sendApiError(res, err, 500, 'IHRACAT_EXCEL_AGENT_LIST_FAILED');
    }
  });

  api.post('/ihracat-excel/reread', requireValidSession, async (req, res) => {
    try {
      const stored = await getStoredSource(q);
      const source = mergeSource(stored, req.body || {});
      const site = kantarSiteOf(req);
      const wanted = fileLabelOf((req.body && req.body.fileName) || source.fileName).toLowerCase();
      if (site && wanted) {
        const dropFiles = await readSettledFileLabels(q);
        if (dropFiles.some((name) => String(name).toLowerCase() === wanted)) {
          return res.status(410).json({
            ok: false,
            dropped: true,
            error: { code: 'EXCEL_SETTLED', message: 'Bu sevkiyat tamamlandı. Liste limanda duruyor.' },
          });
        }
      }
      if (!source.fileName && !source.filePath) {
        return res.status(400).json({
          ok: false,
          error: {
            code: 'EXCEL_NOT_SELECTED',
            message: 'Önce İhracat Excel dosyasını seçmelisiniz.',
          },
        });
      }
      const read = await readNewestExcel(source);
      try {
        const patch = {
          fileName: read.fileName,
          lastUpdatedAt: read.mtime ? new Date(read.mtime).toISOString() : new Date().toISOString(),
        };
        if (read.filePath) patch.filePath = read.filePath;
        await setStoredSource(q, patch);
      } catch (_) {}
      const lastUpdated = read.mtime ? new Date(read.mtime).toISOString() : new Date().toISOString();
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader(
        'Content-Disposition',
        'attachment; filename="' + encodeURIComponent(read.fileName || 'ihracat.xlsx') + '"'
      );
      res.setHeader('X-Ihracat-Excel-File-Name', encodeURIComponent(read.fileName || 'ihracat.xlsx'));
      res.setHeader('X-Ihracat-Excel-Last-Updated', lastUpdated);
      res.setHeader('X-Ihracat-Excel-Origin', read.filePath ? 'disk' : 'agent');
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

module.exports = { registerIhracatExcelRoutes, readNewestExcel, kantarSiteOf };
