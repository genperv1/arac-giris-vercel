/**
 * Apply Supabase Security Advisor fixes (RLS + revoke public API grants).
 * Usage: node scripts/apply-supabase-security.js
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is missing in .env');
  }

  const sqlPath = path.join(__dirname, 'supabase-security-fix.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await pool.query(sql);
    console.log('Supabase security fixes applied successfully.');
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Failed to apply security fixes:', err.message || err);
  process.exit(1);
});
