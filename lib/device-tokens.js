'use strict';

/**
 * Hatırlanan cihaz anahtarları (kantar PC'leri için "refresh token").
 *
 * Kantar hesabı şifreyle bir kez girer; sunucu 30 günlük cihaz anahtarı verir (httpOnly çerez).
 * Oturum çerezi (6 saat) düşünce istemci şifre sormadan /api/session/renew ile yeniler.
 * Anahtar DB'de yalnız hash olarak durur; amir Ayarlar'dan iptal edebilir.
 *
 * Ham anahtar biçimi: "<id>.<secret>" — id DB satırını bulur, secret hash ile karşılaştırılır.
 */

const crypto = require('crypto');

const DEFAULT_DAYS = 30;
const MAX_PER_USER = 1;

function sha256(text) {
  return crypto.createHash('sha256').update(String(text)).digest('hex');
}

function safeEqualHex(a, b) {
  const ba = Buffer.from(String(a || ''), 'hex');
  const bb = Buffer.from(String(b || ''), 'hex');
  if (!ba.length || ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function parseRaw(raw) {
  const s = String(raw || '').trim();
  const dot = s.indexOf('.');
  if (dot <= 0) return null;
  const id = s.slice(0, dot);
  const secret = s.slice(dot + 1);
  if (!/^[a-f0-9]{16,40}$/i.test(id) || secret.length < 32) return null;
  return { id, secret };
}

/**
 * @param {(sql: string, params?: any[]) => Promise<{rows: any[], rowCount?: number}>} q
 * @param {{ days?: number, maxPerUser?: number, now?: () => number }} [opts]
 */
function createDeviceTokenStore(q, opts) {
  const days = Number(opts && opts.days) > 0 ? Number(opts.days) : DEFAULT_DAYS;
  const maxPerUser = Number(opts && opts.maxPerUser) > 0 ? Number(opts.maxPerUser) : MAX_PER_USER;
  const now = (opts && typeof opts.now === 'function') ? opts.now : () => Date.now();
  const ttlMs = days * 24 * 60 * 60 * 1000;

  async function ensureTable() {
    await q(`
      CREATE TABLE IF NOT EXISTS device_tokens(
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        token_hash TEXT NOT NULL,
        label TEXT,
        created_at BIGINT NOT NULL,
        expires_at BIGINT NOT NULL,
        last_used_at BIGINT,
        last_ip TEXT,
        user_agent TEXT,
        revoked_at BIGINT
      );
    `);
    await q('CREATE INDEX IF NOT EXISTS device_tokens_user_idx ON device_tokens(username)');
  }

  /** Yeni cihaz anahtarı üretir; kullanıcı başına eski fazlalıkları iptal eder. */
  async function issue(username, meta) {
    const user = String(username || '').trim();
    if (!user) throw new Error('username required');
    const id = crypto.randomBytes(12).toString('hex');
    const secret = crypto.randomBytes(32).toString('base64url');
    const t = now();
    await q(
      `INSERT INTO device_tokens(id, username, token_hash, label, created_at, expires_at, last_used_at, last_ip, user_agent)
       VALUES($1, $2, $3, $4, $5, $6, $5, $7, $8)`,
      [id, user, sha256(secret), String((meta && meta.label) || '').slice(0, 80), t, t + ttlMs,
        String((meta && meta.ip) || '').slice(0, 64), String((meta && meta.userAgent) || '').slice(0, 200)]
    );
    // Kullanıcı başına sınır: en eski aktifleri iptal et
    const active = await q(
      `SELECT id FROM device_tokens WHERE username = $1 AND revoked_at IS NULL AND expires_at > $2 ORDER BY created_at DESC`,
      [user, t]
    );
    const extra = (active.rows || []).slice(maxPerUser).map((r) => r.id);
    if (extra.length) {
      await q('UPDATE device_tokens SET revoked_at = $1 WHERE id = ANY($2::text[])', [t, extra]);
    }
    return { id, raw: id + '.' + secret, expiresAt: t + ttlMs };
  }

  /** Ham anahtarı doğrular; geçerliyse satırı döner, değilse null. */
  async function verify(raw) {
    const parsed = parseRaw(raw);
    if (!parsed) return null;
    const r = await q('SELECT * FROM device_tokens WHERE id = $1', [parsed.id]);
    const row = r.rows && r.rows[0];
    if (!row) return null;
    if (row.revoked_at) return null;
    if (Number(row.expires_at) <= now()) return null;
    if (!safeEqualHex(row.token_hash, sha256(parsed.secret))) return null;
    return {
      id: row.id,
      username: row.username,
      label: row.label || '',
      expiresAt: Number(row.expires_at),
      lastIp: row.last_ip || '',
      userAgent: row.user_agent || '',
    };
  }

  async function touch(id, meta) {
    await q(
      'UPDATE device_tokens SET last_used_at = $2, last_ip = COALESCE(NULLIF($3, \'\'), last_ip), user_agent = COALESCE(NULLIF($4, \'\'), user_agent) WHERE id = $1',
      [id, now(), String((meta && meta.ip) || '').slice(0, 64), String((meta && meta.userAgent) || '').slice(0, 200)]
    );
  }

  async function revoke(id) {
    const r = await q('UPDATE device_tokens SET revoked_at = $2 WHERE id = $1 AND revoked_at IS NULL', [String(id || ''), now()]);
    return (r.rowCount || 0) > 0;
  }

  async function revokeAllForUser(username) {
    const r = await q('UPDATE device_tokens SET revoked_at = $2 WHERE username = $1 AND revoked_at IS NULL', [String(username || ''), now()]);
    return r.rowCount || 0;
  }

  /** Amir listesi: yalnız açık oturum. Hesap başına fazlalık düşürülür, düşenler listede durmaz. */
  async function list() {
    const t = now();
    const r = await q(
      `SELECT id, username, label, created_at, expires_at, last_used_at, last_ip, user_agent, revoked_at
       FROM device_tokens
       WHERE revoked_at IS NULL AND expires_at > $1
       ORDER BY username, last_used_at DESC, created_at DESC`,
      [t]
    );
    const rows = (r.rows || []).slice().sort((a, b) => {
      const ua = String(a.username || '');
      const ub = String(b.username || '');
      if (ua !== ub) return ua < ub ? -1 : 1;
      const ta = Number(a.last_used_at) || Number(a.created_at) || 0;
      const tb = Number(b.last_used_at) || Number(b.created_at) || 0;
      return tb - ta;
    });
    const keep = [];
    const dropIds = [];
    const seen = new Map();
    rows.forEach((row) => {
      const n = seen.get(row.username) || 0;
      if (n < maxPerUser) {
        seen.set(row.username, n + 1);
        keep.push(row);
      } else if (row.id) {
        dropIds.push(row.id);
      }
    });
    if (dropIds.length) {
      await q('UPDATE device_tokens SET revoked_at = $1 WHERE id = ANY($2::text[])', [t, dropIds]);
    }
    return keep.map((row) => ({
      id: row.id,
      username: row.username,
      label: row.label || '',
      createdAt: Number(row.created_at) || 0,
      expiresAt: Number(row.expires_at) || 0,
      lastUsedAt: Number(row.last_used_at) || 0,
      lastIp: row.last_ip || '',
      userAgent: row.user_agent || '',
      revokedAt: 0,
      active: true,
    }));
  }

  return { ensureTable, issue, verify, touch, revoke, revokeAllForUser, list, ttlMs, days };
}

module.exports = { createDeviceTokenStore, parseRaw, sha256 };
