// user.js
// Basit JWT tabanlı kullanıcı doğrulama yardımcıları.
// Kullanım: const auth = require('./user')(q, { jwtSecret: process.env.JWT_SECRET });
// - `q` : server.js içindeki query helper fonksiyonu (ör. async function q(text, params))
// Sağlanan fonksiyon `users` tablosunu hazırlar ve üç yardımcı sunar:
// - registerUser(username, password, extra) -> { ok, id }
// - authenticateUser(username, password) -> { ok, token, user }
// - verifyToken middleware (Express)

const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

module.exports = function createAuth(q, opts) {
  if (!q || typeof q !== 'function') throw new Error('q (query function) is required');
  const jwtSecret = (opts && opts.jwtSecret) || process.env.JWT_SECRET;
  if (!jwtSecret) throw new Error('JWT secret is required (opts.jwtSecret or process.env.JWT_SECRET)');
  const tokenExpiresIn = (opts && opts.expiresIn) || '2h';

  async function ensureUsersTable() {
    await q(`
      CREATE TABLE IF NOT EXISTS users(
        id TEXT PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT,
        meta JSONB,
        created_at BIGINT
      );
    `);
  }

  // Register a new user (returns { ok: true, id } or throws)
  async function registerUser(username, password, extra) {
    if (!username || !password) throw new Error('username and password required');
    await ensureUsersTable();
    const id = String(Date.now()) + Math.random().toString(16).slice(2);
    const hash = await bcrypt.hash(password, 10);
    const meta = extra && typeof extra === 'object' ? extra : {};
    const created = Date.now();

    await q(
      `INSERT INTO users(id, username, password_hash, role, meta, created_at)
       VALUES($1,$2,$3,$4,$5,$6)
       ON CONFLICT (username) DO NOTHING`,
      [id, username, hash, meta.role || null, JSON.stringify(meta), created]
    );

    return { ok: true, id };
  }

  // Authenticate and return JWT token
  async function authenticateUser(username, password) {
    console.log('🔐 Authentication attempt for username:', username);
    if (!username || !password) return { ok: false, error: 'username and password required' };
    await ensureUsersTable();
    const r = await q('SELECT id, username, password_hash, role, meta FROM users WHERE username = $1', [username]);
    console.log('🔍 User query result rows:', r.rows?.length || 0);
    const row = (r.rows && r.rows[0]) ? r.rows[0] : null;
    if (!row) {
      console.log('❌ User not found in database');
      return { ok: false, error: 'invalid credentials' };
    }
    console.log('✅ User found, comparing password...');
    const match = await bcrypt.compare(password, row.password_hash);
    if (!match) {
      console.log('❌ Password mismatch');
      return { ok: false, error: 'invalid credentials' };
    }
    console.log('✅ Authentication successful');

    const payload = { id: row.id, username: row.username, role: row.role || null };
    const token = jwt.sign(payload, jwtSecret, { expiresIn: tokenExpiresIn });
    return { ok: true, token, user: payload };
  }

  function extractTokenFromRequest(req) {
    const auth = req.headers && (req.headers.authorization || req.headers.Authorization);
    if (auth && typeof auth === 'string') {
      const parts = auth.split(' ');
      if (parts.length === 2 && parts[0].toLowerCase() === 'bearer') {
        return parts[1];
      }
    }
    if (req.headers && req.headers.cookie && typeof req.headers.cookie === 'string') {
      const cookies = req.headers.cookie.split(';').map((s) => s.trim());
      for (const c of cookies) {
        const idx = c.indexOf('=');
        if (idx <= 0) continue;
        const k = c.slice(0, idx).trim();
        const v = c.slice(idx + 1).trim();
        if (k === 'auth_token' || k === 'token') {
          return decodeURIComponent(v);
        }
      }
    }
    return null;
  }

  /** Strict JWT middleware — missing/invalid token → 401 */
  function verifyToken(req, res, next) {
    try {
      const token = extractTokenFromRequest(req);
      if (!token) {
        return res.status(401).json({
          error: 'missing authorization',
          code: 'AUTH_MISSING',
        });
      }
      const decoded = jwt.verify(token, jwtSecret);
      req.user = decoded;
      return next();
    } catch (e) {
      return res.status(401).json({
        error: 'invalid token',
        code: 'AUTH_INVALID',
      });
    }
  }

  return {
    registerUser,
    authenticateUser,
    verifyToken,
    ensureUsersTable
  };
};
