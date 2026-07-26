-- ============================================================================
-- 0096 — Configurable per-role screen access.
--
-- Until now, every dashboard nav item was gated only on plan entitlement
-- (featureKey), never on the staff member's own role — any logged-in staff,
-- including a waiter or kitchen account, could reach Settings, Billing,
-- Reports, anything the café's plan unlocked. This adds a second,
-- independent gate: which SCREENS a role may see, owner/manager-editable
-- per café (not hardcoded), defaulting to sensible role-shaped access.
--
-- Design mirrors platform_admins' own permission model (0079): a role has
-- sane defaults (default_role_screens), and a café may override individual
-- screens for a role (cafe_role_screens) — override beats default, same
-- precedence shape used for plan feature overrides.
--
-- Scope: this gates NAVIGATION/SCREEN VISIBILITY, a workflow/UX boundary —
-- it does not replace the deeper has_cafe_role(...) checks already inside
-- individual sensitive RPCs (staff creation, billing, settings writes),
-- which remain the real authorization backstop regardless of what this
-- layer shows or hides.
-- ============================================================================

create table if not exists cafe_role_screens (
  id         uuid primary key default gen_random_uuid(),
  cafe_id    uuid not null references cafes(id) on delete cascade,
  role       member_role not null,
  screen_key text not null,
  enabled    boolean not null default true,
  created_at timestamptz not null default now(),
  unique (cafe_id, role, screen_key)
);
create index if not exists cafe_role_screens_cafe_idx on cafe_role_screens (cafe_id, role);

alter table cafe_role_screens enable row level security;
drop policy if exists "member read" on cafe_role_screens;
create policy "member read" on cafe_role_screens for select using (is_cafe_member(cafe_id));
-- No insert/update/delete policy — writes only via set_role_screen below.

-- ── Built-in defaults per role, before any café-specific override ─────────
create or replace function default_role_screens(p_role member_role)
returns text[] language sql immutable as $$
  select case p_role
    when 'owner'      then array['dashboard','pos','tables','bills','shift','kitchen','menu','customers','feedback','inventory','purchases','recipes','coupons','loyalty','wallet','reports','expenses','profile','qr_codes','billing','settings']
    when 'manager'    then array['dashboard','pos','tables','bills','shift','kitchen','menu','customers','feedback','inventory','purchases','recipes','coupons','loyalty','wallet','reports','expenses','profile','qr_codes','settings']
    when 'cashier'    then array['dashboard','pos','tables','bills','shift','kitchen']
    when 'waiter'     then array['pos','tables','kitchen']
    when 'kitchen'    then array['kitchen']
    when 'accountant' then array['dashboard','bills','reports','expenses','billing']
    else array[]::text[]
  end
$$;

-- Every screen key the nav can gate on — kept here once so the owner's
-- checklist UI and the overview RPC below can't silently drift apart.
create or replace function all_screen_keys()
returns text[] language sql immutable as $$
  select array['dashboard','pos','tables','bills','shift','kitchen','menu','customers','feedback',
               'inventory','purchases','recipes','coupons','loyalty','wallet','reports','expenses',
               'profile','qr_codes','billing','settings']
$$;

-- ── What screens the CALLING user may see at this café right now ──────────
create or replace function my_screen_access(p_cafe_id uuid)
returns text[] language plpgsql stable security definer set search_path = public as $$
declare
  v_role   member_role;
  v_result text[];
  v_ov     record;
begin
  select role into v_role from cafe_members where cafe_id = p_cafe_id and user_id = auth.uid() and status = 'active';
  if v_role is null then return array[]::text[]; end if;
  if v_role = 'owner' then return default_role_screens('owner'); end if; -- always full, never overridable

  v_result := default_role_screens(v_role);
  for v_ov in select screen_key, enabled from cafe_role_screens where cafe_id = p_cafe_id and role = v_role loop
    if v_ov.enabled then
      if not (v_ov.screen_key = any(v_result)) then v_result := array_append(v_result, v_ov.screen_key); end if;
    else
      v_result := array_remove(v_result, v_ov.screen_key);
    end if;
  end loop;
  return v_result;
end $$;
revoke execute on function my_screen_access(uuid) from public, anon;
grant execute on function my_screen_access(uuid) to authenticated;

-- ── Owner/manager view: every non-owner role x every screen, resolved ──────
create or replace function role_screen_overview(p_cafe_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_roles  member_role[] := array['manager','cashier','kitchen','waiter','accountant']::member_role[];
  v_out    jsonb := '{}'::jsonb;
  v_role   member_role;
  v_screen text;
  v_row    jsonb;
  v_enabled boolean;
begin
  if not has_cafe_role(p_cafe_id, array['owner','manager']::member_role[]) then
    raise exception 'not authorized';
  end if;

  foreach v_role in array v_roles loop
    v_row := '{}'::jsonb;
    foreach v_screen in array all_screen_keys() loop
      select enabled into v_enabled from cafe_role_screens
        where cafe_id = p_cafe_id and role = v_role and screen_key = v_screen;
      if v_enabled is null then v_enabled := v_screen = any(default_role_screens(v_role)); end if;
      v_row := v_row || jsonb_build_object(v_screen, v_enabled);
    end loop;
    v_out := v_out || jsonb_build_object(v_role::text, v_row);
  end loop;

  return v_out;
end $$;
revoke execute on function role_screen_overview(uuid) from public, anon;
grant execute on function role_screen_overview(uuid) to authenticated;

-- ── Owner/manager edit: flip one screen for one role ───────────────────────
create or replace function set_role_screen(p_cafe_id uuid, p_role text, p_screen_key text, p_enabled boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not has_cafe_role(p_cafe_id, array['owner','manager']::member_role[]) then
    raise exception 'only an owner or manager can change role access';
  end if;
  if p_role = 'owner' then raise exception 'the owner role always has full access'; end if;
  if not (p_screen_key = any(all_screen_keys())) then raise exception 'unknown screen'; end if;

  insert into cafe_role_screens (cafe_id, role, screen_key, enabled)
  values (p_cafe_id, p_role::member_role, p_screen_key, p_enabled)
  on conflict (cafe_id, role, screen_key) do update set enabled = p_enabled;
end $$;
revoke execute on function set_role_screen(uuid, text, text, boolean) from public, anon;
grant execute on function set_role_screen(uuid, text, text, boolean) to authenticated;
