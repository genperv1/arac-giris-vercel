require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

(async () => {
  const tables = await pool.query(`
    SELECT c.relname AS table_name, c.relrowsecurity AS rls_enabled, c.relforcerowsecurity AS rls_forced
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
    ORDER BY c.relname
  `);
  console.log('=== TABLES RLS ===');
  tables.rows.forEach((r) => console.log(r.table_name, 'rls=' + r.rls_enabled, 'forced=' + r.rls_forced));

  const policies = await pool.query(`
    SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
    FROM pg_policies WHERE schemaname = 'public' ORDER BY tablename, policyname
  `);
  console.log('\n=== POLICIES ===');
  policies.rows.forEach((p) => console.log(JSON.stringify(p)));

  const views = await pool.query(`
    SELECT c.relname, pg_get_viewdef(c.oid, true) as def
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'v' AND c.relname = 'users_safe'
  `);
  console.log('\n=== users_safe VIEW ===');
  console.log(views.rows[0]?.def || 'not found');

  const viewModes = await pool.query(`
    SELECT c.relname,
      CASE
        WHEN 'security_invoker=on' = ANY(c.reloptions) OR 'security_invoker=true' = ANY(c.reloptions) THEN 'invoker'
        WHEN 'security_invoker=off' = ANY(c.reloptions) THEN 'definer'
        ELSE 'definer(default)'
      END AS mode
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'v'
  `);
  console.log('\n=== VIEW MODES ===');
  viewModes.rows.forEach((r) => console.log(r.relname, r.mode));

  const grants = await pool.query(`
    SELECT grantee, table_name, privilege_type
    FROM information_schema.role_table_grants
    WHERE table_schema = 'public'
      AND grantee IN ('anon', 'authenticated', 'public')
    ORDER BY table_name, grantee, privilege_type
  `);
  console.log('\n=== GRANTS (anon/authenticated/public) ===');
  grants.rows.forEach((r) => console.log(r.table_name, r.grantee, r.privilege_type));

  await pool.end();
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
