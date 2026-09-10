-- ============================================================================
-- 0238 — Fix: Settings → Staff list shows blank name/email for every
-- co-worker except the viewer themselves.
--
-- Root cause: app/dashboard/settings/page.tsx lists staff via
--   cafe_members.select('user_id, role, status, profiles(full_name, email)')
-- run as the logged-in owner/manager's own client. profiles' only SELECT
-- policy is "self read" (id = auth.uid()), from 0001. Postgres RLS applies
-- to embedded-resource joins exactly like a direct query, so profiles comes
-- back null for every row except the caller's own — the "—" name and blank
-- email seen for every staff member other than the person viewing the page.
-- The profile rows themselves are fine (handle_new_user creates one per
-- signup); this was purely a read-visibility gap, not missing data.
--
-- Fix: a narrow, security-definer RPC — same shape as is_cafe_member/
-- has_cafe_role (0001) and op_list_cafe_staff (0190, the platform-ops
-- equivalent of this) — rather than widening profiles' own RLS policy,
-- which would expose every member's name/email to any query anywhere in
-- the app that joins profiles, not just this one screen.
-- ============================================================================

create or replace function list_cafe_staff_profiles(p_cafe_id uuid)
returns table (
  user_id   uuid,
  role      member_role,
  status    text,
  full_name text,
  email     text
)
language sql stable security definer set search_path = public as $$
  select m.user_id, m.role, m.status, p.full_name, p.email
  from cafe_members m
  join profiles p on p.id = m.user_id
  where m.cafe_id = p_cafe_id
    and is_cafe_member(p_cafe_id)
  order by (m.role = 'owner') desc, m.created_at;
$$;

revoke execute on function list_cafe_staff_profiles(uuid) from public, anon;
grant execute on function list_cafe_staff_profiles(uuid) to authenticated;

-- ── self-check ───────────────────────────────────────────────────────────
do $$
begin
  if (select count(*) from pg_proc where proname = 'list_cafe_staff_profiles') <> 1 then
    raise exception 'list_cafe_staff_profiles: expected exactly one overload';
  end if;
end $$;
