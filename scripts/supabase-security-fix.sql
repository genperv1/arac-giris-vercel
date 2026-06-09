-- Supabase Security Advisor fixes for backend-only access (Express + DATABASE_URL).
-- Blocks anon/authenticated PostgREST access; Node server (postgres role) is unaffected.

-- 1) users_safe view: run as caller, not view owner
ALTER VIEW public.users_safe SET (security_invoker = true);

-- 2) Enable RLS on tables that were missing it
ALTER TABLE public.operation_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.print_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.signatures ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicle_edit_log ENABLE ROW LEVEL SECURITY;

-- 3) Remove overly permissive policies (USING true / WITH CHECK true)
DROP POLICY IF EXISTS "Authenticated full access" ON public.daily_rows;
DROP POLICY IF EXISTS "Authenticated full access" ON public.events;
DROP POLICY IF EXISTS "Authenticated full access" ON public.kv_store;
DROP POLICY IF EXISTS "Authenticated full access" ON public.problems;
DROP POLICY IF EXISTS "Authenticated full access" ON public.report;
DROP POLICY IF EXISTS "Authenticated full access" ON public.vehicles;
DROP POLICY IF EXISTS "Block client select" ON public.users;

-- 4) Revoke PostgREST role access to application tables
REVOKE ALL ON TABLE public.daily_rows FROM anon, authenticated;
REVOKE ALL ON TABLE public.events FROM anon, authenticated;
REVOKE ALL ON TABLE public.kv_store FROM anon, authenticated;
REVOKE ALL ON TABLE public.problems FROM anon, authenticated;
REVOKE ALL ON TABLE public.report FROM anon, authenticated;
REVOKE ALL ON TABLE public.vehicles FROM anon, authenticated;
REVOKE ALL ON TABLE public.operation_notes FROM anon, authenticated;
REVOKE ALL ON TABLE public.print_history FROM anon, authenticated;
REVOKE ALL ON TABLE public.signatures FROM anon, authenticated;
REVOKE ALL ON TABLE public.vehicle_edit_log FROM anon, authenticated;
REVOKE ALL ON TABLE public.users FROM anon, authenticated;
REVOKE ALL ON public.users_safe FROM anon, authenticated;
