'use strict';

const TABLES_WITH_RLS = [
  'operation_notes',
  'print_history',
  'signatures',
  'vehicle_edit_log',
  'events',
];

const TABLES_REVOKE_ACCESS = [
  'daily_rows',
  'events',
  'kv_store',
  'problems',
  'report',
  'vehicles',
  'operation_notes',
  'print_history',
  'signatures',
  'vehicle_edit_log',
  'users',
];

const POLICY_DROP_TARGETS = [
  { table: 'daily_rows', policy: 'Authenticated full access' },
  { table: 'events', policy: 'Authenticated full access' },
  { table: 'kv_store', policy: 'Authenticated full access' },
  { table: 'problems', policy: 'Authenticated full access' },
  { table: 'report', policy: 'Authenticated full access' },
  { table: 'vehicles', policy: 'Authenticated full access' },
  { table: 'users', policy: 'Block client select' },
];

/**
 * Blocks anon/authenticated PostgREST access; Express (postgres role) is unaffected.
 * @param {{ query: (text: string, params?: unknown[]) => Promise<unknown> }} poolLike
 */
async function applySupabaseSecurity(poolLike) {
  const query = poolLike.query.bind(poolLike);

  await query(`ALTER VIEW public.users_safe SET (security_invoker = true);`);

  for (const table of TABLES_WITH_RLS) {
    await query(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY;`);
  }

  for (const { table, policy } of POLICY_DROP_TARGETS) {
    await query(`DROP POLICY IF EXISTS "${policy}" ON public.${table};`);
  }

  for (const table of TABLES_REVOKE_ACCESS) {
    await query(`REVOKE ALL ON TABLE public.${table} FROM anon, authenticated;`);
  }
  await query(`REVOKE ALL ON public.users_safe FROM anon, authenticated;`);
}

module.exports = { applySupabaseSecurity };
