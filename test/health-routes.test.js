'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { registerHealthRoutes } = require('../routes/health-routes');

test('health hem /health hem /api/health üzerine bağlanır', async () => {
  const appRoutes = [];
  const apiRoutes = [];
  const app = { get: (p, h) => appRoutes.push({ p, h }) };
  const api = { get: (p, h) => apiRoutes.push({ p, h }) };
  registerHealthRoutes(app, api, {
    pool: { totalCount: 1, idleCount: 1, waitingCount: 0 },
    checkPoolHealth: async () => true,
  });
  assert.equal(appRoutes[0].p, '/health');
  assert.equal(apiRoutes[0].p, '/health');
  let body;
  await appRoutes[0].h({}, {
    json: (d) => { body = d; },
    status() { return this; },
  });
  assert.equal(body.status, 'healthy');
  assert.equal(body.ok, true);
});
