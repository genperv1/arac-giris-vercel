-- Supabase Security Advisor fixes for backend-only access (Express + DATABASE_URL).
-- Blocks anon/authenticated PostgREST access; Node server (postgres role) is unaffected.

-- 1) users_safe view: run as caller, not view owner
ALTER VIEW public.users_safe SET (security_invoker = true);

-- 2) Enable RLS + revoke API grants on every public table (covers new tables like driver_trips)
DO $$
DECLARE
  t text;
BEGIN
  FOR t IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon, authenticated', t);
  END LOOP;
END $$;

-- 3) Remove overly permissive policies (USING true / WITH CHECK true)
DROP POLICY IF EXISTS "Authenticated full access" ON public.daily_rows;
DROP POLICY IF EXISTS "Authenticated full access" ON public.events;
DROP POLICY IF EXISTS "Authenticated full access" ON public.kv_store;
DROP POLICY IF EXISTS "Authenticated full access" ON public.problems;
DROP POLICY IF EXISTS "Authenticated full access" ON public.report;
DROP POLICY IF EXISTS "Authenticated full access" ON public.vehicles;
DROP POLICY IF EXISTS "Block client select" ON public.users;

REVOKE ALL ON public.users_safe FROM anon, authenticated;

-- 4) Stop future CREATE TABLE from granting public API access
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
