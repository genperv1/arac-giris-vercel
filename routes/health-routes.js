'use strict';

function createHealthHandler(pool, checkPoolHealth) {
  return async function healthHandler(req, res) {
    try {
      const poolInfo = {
        totalCount: pool.totalCount,
        idleCount: pool.idleCount,
        waitingCount: pool.waitingCount,
      };
      const healthy = await checkPoolHealth();
      if (healthy) {
        return res.json({
          ok: true,
          status: 'healthy',
          pool: poolInfo,
          timestamp: new Date().toISOString(),
        });
      }
      return res.status(503).json({
        ok: false,
        status: 'unhealthy',
        pool: poolInfo,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      return res.status(503).json({
        ok: false,
        status: 'error',
        error: err.message,
        timestamp: new Date().toISOString(),
      });
    }
  };
}

/** Railway /health ve istemci /api/health aynı cevabı görsün. */
function registerHealthRoutes(app, api, ctx) {
  const handler = createHealthHandler(ctx.pool, ctx.checkPoolHealth);
  app.get('/health', handler);
  api.get('/health', handler);
}

module.exports = { registerHealthRoutes, createHealthHandler };
