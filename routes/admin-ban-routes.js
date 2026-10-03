'use strict';

function registerAdminBanRoutes(api, ctx) {
  const {
    requireAmir,
    listBannedIpsPayload,
    unbanIp,
    banIp,
    normalizeClientIp,
    isIpBanned,
    ipRequestCount,
  } = ctx;

  api.get('/admin/banned-ips', requireAmir, async (req, res) => {
    try {
      const payload = listBannedIpsPayload();
      res.json({ ok: true, ...payload });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  api.post('/admin/unban-ip', requireAmir, async (req, res) => {
    try {
      const ip = String(req.body.ip || '').trim();
      if (!ip) return res.status(400).json({ ok: false, error: 'IP gerekli' });
      const removed = unbanIp(ip);
      res.json({
        ok: true,
        removed,
        message: removed ? `IP ${ip} engeli kaldırıldı` : 'Bu IP listede yoktu',
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  api.post('/admin/ban-ip', requireAmir, async (req, res) => {
    try {
      const ip = String(req.body.ip || '').trim();
      const reason = String(req.body.reason || 'Manuel engel (yönetici)');
      if (!ip) return res.status(400).json({ ok: false, error: 'IP gerekli' });
      banIp(ip, reason);
      res.json({ ok: true, message: `IP ${normalizeClientIp(ip)} engellendi` });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  api.get('/admin/ip-status/:ip', requireAmir, async (req, res) => {
    try {
      const ip = String(req.params.ip || '').trim();
      const ipData = ipRequestCount.get(ip);
      const banned = isIpBanned(ip);
      res.json({
        ok: true,
        ip,
        banned,
        requests: ipData ? ipData.count : 0,
        failedLogins: ipData ? ipData.failedLogins : 0,
        resetTime: ipData ? new Date(ipData.resetTime).toISOString() : null,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
}

module.exports = { registerAdminBanRoutes };
