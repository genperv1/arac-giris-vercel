'use strict';

function registerBackupRoutes(api, ctx) {
  const { q, requireAmir, PRINT_FORM_BG_KEY } = ctx;

  api.get('/export/db', requireAmir, async (req, res) => {
    try {
      const [vehicles, daily_rows, problems, kv_store, report, events] = await Promise.all([
        q('SELECT * FROM vehicles'),
        q('SELECT * FROM daily_rows'),
        q('SELECT * FROM problems'),
        q(
          'SELECT key, CASE WHEN key = $1 THEN \'{}\'::text ELSE value END AS value FROM kv_store',
          [PRINT_FORM_BG_KEY]
        ),
        q('SELECT * FROM report'),
        q('SELECT * FROM events'),
      ]);

      const backup = {
        ts: Date.now(),
        vehicles: vehicles.rows,
        daily_rows: daily_rows.rows,
        problems: problems.rows,
        kv_store: kv_store.rows,
        report: report.rows,
        events: events.rows,
      };

      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="arac_giris_backup.json"');
      res.send(JSON.stringify(backup));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
}

module.exports = { registerBackupRoutes };
