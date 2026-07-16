'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_SITES = {
  AVDAN: [],
  '1.OSB': [],
};

/**
 * @param {string} ip
 * @param {string} pattern — tam IP veya önek (ör. 192.168.1.)
 */
function ipMatchesPattern(ip, pattern) {
  const norm = String(ip || '').trim().toLowerCase();
  const pat = String(pattern || '').trim().toLowerCase();
  if (!norm || !pat) return false;
  if (norm === pat) return true;
  if (pat.endsWith('.')) return norm.startsWith(pat);
  if (pat.includes('/')) {
    const [base, bits] = pat.split('/');
    const maskBits = parseInt(bits, 10);
    if (!base || !Number.isFinite(maskBits) || maskBits < 0 || maskBits > 32) return false;
    const ipParts = norm.split('.').map((x) => parseInt(x, 10));
    const baseParts = base.split('.').map((x) => parseInt(x, 10));
    if (ipParts.length !== 4 || baseParts.length !== 4) return false;
    if (ipParts.some((n) => !Number.isFinite(n)) || baseParts.some((n) => !Number.isFinite(n))) return false;
    const ipNum = ((ipParts[0] << 24) | (ipParts[1] << 16) | (ipParts[2] << 8) | ipParts[3]) >>> 0;
    const baseNum = ((baseParts[0] << 24) | (baseParts[1] << 16) | (baseParts[2] << 8) | baseParts[3]) >>> 0;
    const mask = maskBits === 0 ? 0 : (0xffffffff << (32 - maskBits)) >>> 0;
    return (ipNum & mask) === (baseNum & mask);
  }
  return false;
}

function normalizeSitesConfig(raw) {
  const sites = { ...DEFAULT_SITES };
  const editorIps = [];
  let editorOnUnknown = true;

  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    if (raw.sites && typeof raw.sites === 'object') {
      Object.entries(raw.sites).forEach(([label, ips]) => {
        const key = String(label || '').trim();
        if (!key) return;
        sites[key] = Array.isArray(ips) ? ips.map((x) => String(x || '').trim()).filter(Boolean) : [];
      });
    }
    if (Array.isArray(raw.editorIps)) {
      raw.editorIps.forEach((x) => {
        const v = String(x || '').trim();
        if (v) editorIps.push(v);
      });
    }
    if (typeof raw.editorOnUnknown === 'boolean') editorOnUnknown = raw.editorOnUnknown;
  }

  return { sites, editorIps, editorOnUnknown };
}

function createClientSiteResolver(configPath, normalizeClientIp, isLoopbackIp) {
  let config = normalizeSitesConfig(null);

  function loadConfig() {
    try {
      if (!fs.existsSync(configPath)) {
        config = normalizeSitesConfig(null);
        return;
      }
      const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      config = normalizeSitesConfig(raw);
    } catch (e) {
      console.warn('client_sites.json okunamadı:', e.message);
      config = normalizeSitesConfig(null);
    }
  }

  function watchConfig() {
    try {
      let lastSnap = '';
      fs.watch(configPath, { persistent: false }, () => {
        setTimeout(() => {
          try {
            if (!fs.existsSync(configPath)) return;
            const snap = fs.readFileSync(configPath, 'utf8');
            if (snap !== lastSnap) {
              lastSnap = snap;
              loadConfig();
              console.log('client_sites.json diskten yeniden yüklendi');
            }
          } catch (e) { /* ignore */ }
        }, 120);
      });
    } catch (e) { /* ignore */ }
  }

  loadConfig();
  if (fs.existsSync(configPath)) watchConfig();

  function resolveClientSite(ip, role) {
    const clientIp = normalizeClientIp(ip);
    if (isLoopbackIp(clientIp)) {
      return { clientIp, clientSite: 'EDITOR' };
    }

    for (const entry of config.editorIps) {
      if (ipMatchesPattern(clientIp, entry)) {
        return { clientIp, clientSite: 'EDITOR' };
      }
    }

    for (const [siteLabel, patterns] of Object.entries(config.sites)) {
      for (const pattern of patterns) {
        if (ipMatchesPattern(clientIp, pattern)) {
          return { clientIp, clientSite: siteLabel };
        }
      }
    }

    if (config.editorOnUnknown || String(role || '').toLowerCase() === 'admin') {
      return { clientIp, clientSite: 'EDITOR' };
    }

    return { clientIp, clientSite: clientIp };
  }

  function getClientSitesConfig() {
    return {
      sites: { ...config.sites },
      editorIps: [...config.editorIps],
      editorOnUnknown: config.editorOnUnknown,
    };
  }

  return { resolveClientSite, loadConfig, getClientSitesConfig };
}

module.exports = {
  createClientSiteResolver,
  ipMatchesPattern,
  normalizeSitesConfig,
};
