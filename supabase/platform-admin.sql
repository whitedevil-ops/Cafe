-- ============================================================================
-- Platform Super Admin — Level 1 administration (separate from café admin).
-- Run this in the SQL Editor AFTER schema.sql.
--
-- Security model (spec §1, §24): platform-admin status lives in its OWN table,
-- never in profiles or café roles. It cannot be granted through registration,
-- the API, or frontend manipulation — only by inserting a row here via the SQL
-- editor / service role. RLS + a SECURITY DEFINER check enforce it server-side.
-- ============================================================================

create table if not exists platform_admins (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null unique references auth.users(id) on delete cascade,
  role          text not null default 'super_admin',   -- future: support_admin, finance_admin
  status        text not null default 'active',        -- active | suspended
  created_at    timestamptz not null default now(),
  last_login_at timestamptz
);

-- The single source of truth for "is the caller a platform admin?".
-- SECURITY DEFINER so it reads platform_admins regardless of the caller's RLS.
create or replace function is_platform_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from platform_admins
    where user_id = auth.uid() and status = 'active'
  );
$$;

alter table platform_admins enable row level security;
-- Only admins can read the roster. No INSERT/UPDATE/DELETE policy exists, so the
-- table is unwritable through the anon/authenticated API — membership is granted
-- ONLY via the SQL editor or service role. This is the anti-self-promotion guard.
create policy "admin read" on platform_admins for select using (is_platform_admin());

-- Cross-tenant read for the Super Admin panel. These are ADDITIVE (OR) to the
-- existing member policies — café owners are completely unaffected, and a café
-- owner still cannot see another café's rows.
create policy "platform admin read" on cafes        for select using (is_platform_admin());
create policy "platform admin read" on profiles     for select using (is_platform_admin());
create policy "platform admin read" on cafe_members for select using (is_platform_admin());

-- Platform-level audit log (append-oriented; no update/delete policy).
create table if not exists platform_audit_logs (
  id            uuid primary key default gen_random_uuid(),
  actor_id      uuid references auth.users(id) on delete set null,
  action        text not null,                 -- 'cafe.verified', 'cafe.suspended', ...
  target_type   text,
  target_id     uuid,
  previous_value jsonb,
  new_value     jsonb,
  created_at    timestamptz not null default now()
);
alter table platform_audit_logs enable row level security;
create policy "admin read" on platform_audit_logs for select using (is_platform_admin());

-- ── Bootstrap the FIRST super admin (you) ───────────────────────────────────
-- After you have signed up on the site, run this once with your own email:
--
--   insert into platform_admins (user_id, role)
--   select id, 'super_admin' from auth.users
--   where email = 'YOUR-EMAIL-HERE'
--   on conflict (user_id) do nothing;
--
-- There is deliberately no UI or API path to create the first admin — that is
-- the point. Only someone with direct database access can bootstrap it.
