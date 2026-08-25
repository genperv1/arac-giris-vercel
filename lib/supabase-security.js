'use strict';

const POLICY_DROP_TARGETS = [
  { table: 'daily_rows', policy: 'Authenticated full access' },
  { table: 'events', policy: 'Authenticated full access' },
  { table: 'kv_store', policy: 'Authenticated full access' },
  { table: 'problems', policy: 'Authenticated full access' },
  { table: 'report', policy: 'Authenticated full access' },
  { table: 'vehicles', policy: 'Authenticated full access' },
  { table: 'users', policy: 'Block client select' },
];

function quoteIdent(name) {
  return '"' + String(name).replace(/"/g, '""') + '"';
}

/**
 * Blocks anon/authenticated PostgREST access; Express (postgres role) is unaffected.
 * Enables RLS on every public table so new tables cannot stay exposed.
 * @param {{ query: (text: string, params?: unknown[]) => Promise<unknown> }} poolLike
 */
async function applySupabaseSecurity(poolLike) {
  const query = poolLike.query.bind(poolLike);

  try {
    await query(`ALTER VIEW public.users_safe SET (security_invoker = true);`);
  } catch (e) {
    console.warn('users_safe security_invoker skipped:', e.message || e);
  }

  const tablesRes = await query(`
    SELECT c.relname AS table_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
    ORDER BY c.relname
  `);

  for (const row of tablesRes.rows) {
    const table = row.table_name;
    try {
      await query(`ALTER TABLE public.${quoteIdent(table)} ENABLE ROW LEVEL SECURITY;`);
    } catch (e) {
      console.warn('RLS enable skipped for', table, e.message || e);
    }
  }

  for (const { table, policy } of POLICY_DROP_TARGETS) {
    try {
      await query(`DROP POLICY IF EXISTS "${policy}" ON public.${quoteIdent(table)};`);
    } catch (e) {
      console.warn('DROP POLICY skipped for', table, e.message || e);
    }
  }

  for (const row of tablesRes.rows) {
    const table = row.table_name;
    try {
      await query(`REVOKE ALL ON TABLE public.${quoteIdent(table)} FROM anon, authenticated;`);
    } catch (e) {
      console.warn('REVOKE skipped for', table, e.message || e);
    }
  }

  try {
    await query(`REVOKE ALL ON public.users_safe FROM anon, authenticated;`);
  } catch (e) {
    console.warn('REVOKE users_safe skipped:', e.message || e);
  }

  try {
    await query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;`);
  } catch (e) {
    console.warn('ALTER DEFAULT PRIVILEGES skipped:', e.message || e);
  }
}

module.exports = { applySupabaseSecurity };
