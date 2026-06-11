'use strict';

const crypto = require('crypto');

const SSE_PING_INTERVAL_MS = 25000;
const sseClients = new Set();

function attachSseClient(req, res, initialPayload) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Cache-Control',
  });

  if (typeof res.flushHeaders === 'function') {
    try { res.flushHeaders(); } catch (e) { /* ignore */ }
  }

  sseClients.add(res);
  res.write(`data: ${JSON.stringify(initialPayload)}\n\n`);

  const pingInterval = setInterval(() => {
    try {
      res.write(': ping\n\n');
    } catch (e) {
      clearInterval(pingInterval);
      sseClients.delete(res);
    }
  }, SSE_PING_INTERVAL_MS);

  req.on('close', () => {
    clearInterval(pingInterval);
    sseClients.delete(res);
  });
}

function broadcastEvent(type, data, source = null) {
  const message = `data: ${JSON.stringify({
    type,
    data,
    timestamp: Date.now(),
    source,
  })}\n\n`;

  sseClients.forEach((client) => {
    try {
      client.write(message);
    } catch (error) {
      sseClients.delete(client);
    }
  });
}

function broadcastReportUpdate(data) {
  broadcastEvent(data.type, data.data || data, 'legacy_reports');
}

function registerSseRoutes(app) {
  app.get('/api/events-stream', (req, res) => {
    attachSseClient(req, res, {
      type: 'connected',
      clientId: crypto.randomUUID(),
      timestamp: Date.now(),
    });
  });

  app.get('/api/reports-stream', (req, res) => {
    attachSseClient(req, res, { type: 'connected', timestamp: Date.now() });
  });

  app.get('/api/heartbeat', (req, res) => {
    res.status(200).json({
      status: 'ok',
      timestamp: Date.now(),
      clients: sseClients.size,
    });
  });
}

module.exports = {
  sseClients,
  attachSseClient,
  broadcastEvent,
  broadcastReportUpdate,
  registerSseRoutes,
};
