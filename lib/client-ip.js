'use strict';

const net = require('net');

/**
 * Cloudflare yayımlanmış kenar ağları.
 * Yalnızca Railway'in gördüğü adres bu aralıktaysa CF-Connecting-IP kabul edilir.
 * Liste: https://www.cloudflare.com/ips-v4 ve ips-v6
 */
const CLOUDFLARE_IPV4 = [
  '173.245.48.0/20',
  '103.21.244.0/22',
  '103.22.200.0/22',
  '103.31.4.0/22',
  '141.101.64.0/18',
  '108.162.192.0/18',
  '190.93.240.0/20',
  '188.114.96.0/20',
  '197.234.240.0/22',
  '198.41.128.0/17',
  '162.158.0.0/15',
  '104.16.0.0/13',
  '104.24.0.0/14',
  '172.64.0.0/13',
  '131.0.72.0/22',
];

const CLOUDFLARE_IPV6 = [
  '2400:cb00::/32',
  '2606:4700::/32',
  '2803:f800::/32',
  '2405:b500::/32',
  '2405:8100::/32',
  '2a06:98c0::/29',
  '2c0f:f248::/32',
];

function normalizeClientIp(ip) {
  const s = String(ip || '').trim();
  if (!s) return '';
  if (s === '::1' || s === '::ffff:127.0.0.1') return '127.0.0.1';
  if (s.toLowerCase().startsWith('::ffff:')) return s.slice(7);
  return s;
}

function ipv4ToInt(ip) {
  const parts = String(ip || '').split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (let i = 0; i < 4; i += 1) {
    if (!/^\d{1,3}$/.test(parts[i])) return null;
    const octet = Number(parts[i]);
    if (octet > 255) return null;
    n = (n * 256) + octet;
  }
  return n >>> 0;
}

function ipv4InCidr(ip, cidr) {
  const [base, bitsRaw] = String(cidr).split('/');
  const bits = Number(bitsRaw);
  const ipInt = ipv4ToInt(ip);
  const baseInt = ipv4ToInt(base);
  if (ipInt == null || baseInt == null || !Number.isInteger(bits) || bits < 0 || bits > 32) return false;
  if (bits === 0) return true;
  const mask = bits === 32 ? 0xffffffff : ((0xffffffff << (32 - bits)) >>> 0);
  return (ipInt & mask) === (baseInt & mask);
}

function ipv6ToBigInt(ip) {
  const raw = String(ip || '').toLowerCase();
  if (!raw || raw.includes('.')) return null;
  const halves = raw.split('::');
  if (halves.length > 2) return null;
  const parseSide = (side) => (side ? side.split(':').filter(Boolean) : []);
  const left = parseSide(halves[0]);
  const right = halves.length === 2 ? parseSide(halves[1]) : [];
  if (halves.length === 1 && left.length !== 8) return null;
  const missing = 8 - left.length - right.length;
  if (missing < 0) return null;
  const groups = halves.length === 1 ? left : left.concat(Array(missing).fill('0'), right);
  if (groups.length !== 8) return null;
  let n = 0n;
  for (let i = 0; i < groups.length; i += 1) {
    if (!/^[0-9a-f]{1,4}$/.test(groups[i])) return null;
    n = (n << 16n) + BigInt(parseInt(groups[i], 16));
  }
  return n;
}

function ipv6InCidr(ip, cidr) {
  const [base, bitsRaw] = String(cidr).split('/');
  const bits = Number(bitsRaw);
  const ipN = ipv6ToBigInt(ip);
  const baseN = ipv6ToBigInt(base);
  if (ipN == null || baseN == null || !Number.isInteger(bits) || bits < 0 || bits > 128) return false;
  const shift = BigInt(128 - bits);
  return (ipN >> shift) === (baseN >> shift);
}

function isCloudflareIp(ip) {
  const n = normalizeClientIp(ip);
  if (net.isIP(n) === 4) return CLOUDFLARE_IPV4.some((cidr) => ipv4InCidr(n, cidr));
  if (net.isIP(n) === 6) return CLOUDFLARE_IPV6.some((cidr) => ipv6InCidr(n, cidr));
  return false;
}

function singleHeaderIp(value) {
  const raw = Array.isArray(value) ? value[0] : value;
  const text = String(raw || '').trim();
  if (!text || text.includes(',')) return '';
  const n = normalizeClientIp(text);
  return net.isIP(n) ? n : '';
}

/**
 * Railway tek geri vekil. Boolean true kullanılmaz; herkesin başlığına güvenilmez.
 * TRUST_PROXY_HOPS=1 (varsayılan) veya 2. true/false ve bozuk değer 1'e döner.
 */
function trustProxyHops(envValue) {
  const raw = envValue === undefined ? process.env.TRUST_PROXY_HOPS : envValue;
  if (raw == null || String(raw).trim() === '') return 1;
  const text = String(raw).trim().toLowerCase();
  if (text === 'true' || text === 'false') return 1;
  const n = Number(text);
  if (!Number.isInteger(n) || n < 1 || n > 2) return 1;
  return n;
}

function applyTrustProxy(app, envValue) {
  const hops = trustProxyHops(envValue);
  app.set('trust proxy', hops);
  if (app.get('trust proxy') === true) {
    app.set('trust proxy', 1);
  }
  return app.get('trust proxy');
}

/**
 * req.ip, trust proxy hop sayısından sonra Railway'in gördüğü adrestir.
 * CF-Connecting-IP yalnız bu adres Cloudflare kenarıysa kullanılır.
 * X-Forwarded-For soldan okunmaz.
 */
function resolveClientIp(req) {
  const headers = (req && req.headers) || {};
  const expressIp = normalizeClientIp(req && req.ip);
  const socketIp = normalizeClientIp(
    (req && req.socket && req.socket.remoteAddress)
    || (req && req.connection && req.connection.remoteAddress)
  );
  const peer = net.isIP(expressIp) ? expressIp : (net.isIP(socketIp) ? socketIp : '');
  if (peer && isCloudflareIp(peer)) {
    const cf = singleHeaderIp(headers['cf-connecting-ip']);
    if (cf) return cf;
  }
  if (peer) return peer;
  return 'unknown';
}

function rateLimitKey(req) {
  return resolveClientIp(req);
}

module.exports = {
  CLOUDFLARE_IPV4,
  normalizeClientIp,
  isCloudflareIp,
  trustProxyHops,
  applyTrustProxy,
  resolveClientIp,
  rateLimitKey,
};
