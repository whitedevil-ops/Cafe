-- ============================================================================
-- 0134 — Operator café sessions: let a platform admin open a café's own
--        dashboard, time-boxed and audited.
--
-- THE PROBLEM
-- /ops can read a café's billing shape (op_get_cafe_detail, op_cafe_health)
-- but nothing about how the café actually trades — no orders, no sales, no
-- menu, no stock. When an owner says "today's total looks wrong", the operator
-- has no way to look. All 27 existing op_* RPCs are platform administration.
--
-- WHY THIS IS ONE FUNCTION AND NOT A SECOND DASHBOARD
-- Every dashboard screen resolves its café through getCurrentCafe(), and every
-- row it then reads is gated by exactly one predicate: is_cafe_member(cafe_id).
-- The report screens don't even go through RLS — sales_report, gst_invoice_report
-- and friends are SECURITY DEFINER and re-check is_cafe_member() themselves. So
-- adding operator SELECT policies to the tenant tables would light up the
-- table-driven screens and leave every report dark. Widening is_cafe_member()
-- itself is the only change that makes all of them work at once, and it means
-- no second copy of the dashboard to keep in sync.
--
-- ⚠ THIS GRANTS WRITE ACCESS, NOT JUST READ
-- is_cafe_member() appears in both `using` and `with check` on the tenant
-- policies (0001:104), so an operator holding a session can change the café's
-- data, not merely look at it. That is a deliberate, documented trade rather
-- than an oversight:
--
--   * A read-only variant is not a smaller change, it is a much larger one:
--     every SECURITY DEFINER report and mutation RPC guards on
--     is_cafe_member(), so read-only would mean a second predicate plus an
--     edit to every one of those guards — far more surface to get wrong.
--   * It is not an escalation. An operator with cafes.suspend can already
--     suspend a café, and op_delete_cafe deletes one outright. Someone who can
--     delete the café is not meaningfully restrained by being unable to edit
--     its menu.
--
-- What actually contains the risk is that the access is narrow, expiring,
-- announced and recorded:
--   * gated behind its own permission (cafes.impersonate), default-off for
--     every role except super_admin;
--   * one café at a time, and starting a session ends any previous one;
--   * expires on its own — 60 minutes by default, 8 hours hard maximum;
--   * requires a typed reason, written to platform_audit_logs on both start
--     and end, so every session has a why attached;
--   * the dashboard renders a permanent banner naming the café and the
--     countdown, so an operator can never forget whose data they are looking at.
-- ============================================================================

-- ── the session record ──────────────────────────────────────────────────────
create table if not exists cafe_impersonations (
  id            uuid primary key default gen_random_uuid(),
  admin_id      uuid not null references platform_admins(id) on delete cascade,
  -- Denormalised from platform_admins so the hot predicate below is a single
  -- index probe on this table rather than a join back on every RLS check.
  admin_user_id uuid not null,
  cafe_id       uuid not null references cafes(id) on delete cascade,
  reason        text not null,
  started_at    timestamptz not null default now(),
  expires_at    timestamptz not null,
  ended_at      timestamptz,
  check (expires_at > started_at)
);

-- The predicate runs on effectively every row read of an impersonated session,
-- so it gets its own partial index over exactly the open sessions.
create index if not exists cafe_impersonations_open_idx
  on cafe_impersonations (admin_user_id, expires_at)
  where ended_at is null;
create index if not exists cafe_impersonations_cafe_idx on cafe_impersonations (cafe_id, started_at desc);

alter table cafe_impersonations enable row level security;
-- No policy grants anything: every read and write goes through the SECURITY
-- DEFINER functions below. A policy here that called is_cafe_member() would
-- recurse infinitely, since is_cafe_member() is about to read this table.
revoke all on cafe_impersonations from anon, authenticated;

-- ── the predicate ───────────────────────────────────────────────────────────
-- SECURITY DEFINER so it can read cafe_impersonations despite the blanket
-- revoke above, and so RLS on that table is never consulted (see the recursion
-- note). Kept as small as possible: it is called once per policy evaluation.
create or replace function active_impersonated_cafe()
returns uuid language sql stable security definer set search_path = public as $$
  select cafe_id from cafe_impersonations
  where admin_user_id = auth.uid() and ended_at is null and expires_at > now()
  order by started_at desc
  limit 1;
$$;
revoke execute on function active_impersonated_cafe() from public, anon;
grant execute on function active_impersonated_cafe() to authenticated;

-- ── widen the two membership predicates ─────────────────────────────────────
-- Bodies otherwise identical to 0019; the only addition is the final `or`.
-- Note this deliberately does NOT require cafes.status = 'active' on the
-- impersonation branch: a suspended café is precisely when support needs to
-- look, and the dashboard layout still renders its own suspended-state screen.
--
-- ⚠ THE coalesce() IS LATER-EDITOR-PROOFING, NOT DECORATION. Writing the
-- obvious `or target = active_impersonated_cafe()` is a silent authorization
-- bypass. With no session that comparison is NULL, not false, so the whole
-- expression becomes `false OR NULL` = NULL. RLS treats NULL as "no row" and
-- looks correct — but 61 SECURITY DEFINER RPCs guard themselves with
--     if not is_cafe_member(...) then raise exception 'not authorized';
-- and `not NULL` is NULL, so `IF NULL THEN` does not fire. Every one of those
-- guards would stop rejecting non-members while every RLS policy kept working,
-- which is the worst shape a security bug can have: invisible to the tests
-- most likely to be written for it. coalesce() forces a real boolean.
create or replace function is_cafe_member(target uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from cafe_members cm
    join cafes c on c.id = cm.cafe_id
    where cm.cafe_id = target and cm.user_id = auth.uid() and cm.status = 'active'
      and c.status = 'active'
  ) or coalesce(target = active_impersonated_cafe(), false);
$$;

create or replace function is_cafe_member_any_status(target uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from cafe_members
    where cafe_id = target and user_id = auth.uid() and status = 'active'
  ) or coalesce(target = active_impersonated_cafe(), false);
$$;

-- Self-check for exactly the trap described above. Cheap, runs once at apply
-- time, and fails the migration loudly rather than letting a NULL-returning
-- predicate reach production looking healthy. In the SQL editor auth.uid() is
-- null, so both branches are false and the answer must be a hard false — never
-- null. If this ever raises, the `or` lost its coalesce().
do $$
begin
  if (select is_cafe_member(gen_random_uuid())) is distinct from false then
    raise exception 'is_cafe_member() must return false, not null, for a non-member — the coalesce() guard is missing';
  end if;
  if (select is_cafe_member_any_status(gen_random_uuid())) is distinct from false then
    raise exception 'is_cafe_member_any_status() must return false, not null, for a non-member';
  end if;
end $$;

-- ── register the permission ─────────────────────────────────────────────────
-- has_platform_permission() coalesces a missing key to false, so listing it
-- for the non-super roles is not strictly required — it is spelled out anyway
-- because every other key in this function is, and a reader comparing roles
-- should see the answer rather than infer it from an absence.
create or replace function role_default_permissions(p_role text)
returns jsonb language sql immutable as $$
  select case p_role
    when 'super_admin' then jsonb_build_object(
      'cafes.view', true, 'cafes.verify', true, 'cafes.edit', true, 'cafes.suspend', true,
      'cafes.impersonate', true,
      'users.view', true, 'health.view', true,
      'plans.view', true, 'plans.change', true, 'subscriptions.view', true, 'subscriptions.manage', true,
      'audit.view', true,
      'admins.view', true, 'admins.create', true, 'admins.edit', true, 'admins.disable', true
    )
    when 'operations_admin' then jsonb_build_object(
      'cafes.view', true, 'cafes.verify', true, 'cafes.edit', true, 'cafes.suspend', false,
      'cafes.impersonate', false,
      'users.view', true, 'health.view', true,
      'plans.view', false, 'plans.change', false, 'subscriptions.view', false, 'subscriptions.manage', false,
      'audit.view', false,
      'admins.view', false, 'admins.create', false, 'admins.edit', false, 'admins.disable', false
    )
    when 'support_admin' then jsonb_build_object(
      'cafes.view', true, 'cafes.verify', false, 'cafes.edit', false, 'cafes.suspend', false,
      'cafes.impersonate', false,
      'users.view', true, 'health.view', true,
      'plans.view', false, 'plans.change', false, 'subscriptions.view', false, 'subscriptions.manage', false,
      'audit.view', false,
      'admins.view', false, 'admins.create', false, 'admins.edit', false, 'admins.disable', false
    )
    when 'billing_admin' then jsonb_build_object(
      'cafes.view', true, 'cafes.verify', false, 'cafes.edit', false, 'cafes.suspend', false,
      'cafes.impersonate', false,
      'users.view', false, 'health.view', false,
      'plans.view', true, 'plans.change', true, 'subscriptions.view', true, 'subscriptions.manage', true,
      'audit.view', false,
      'admins.view', false, 'admins.create', false, 'admins.edit', false, 'admins.disable', false
    )
    when 'read_only' then jsonb_build_object(
      'cafes.view', true, 'cafes.verify', false, 'cafes.edit', false, 'cafes.suspend', false,
      'cafes.impersonate', false,
      'users.view', true, 'health.view', true,
      'plans.view', true, 'plans.change', false, 'subscriptions.view', true, 'subscriptions.manage', false,
      'audit.view', false,
      'admins.view', false, 'admins.create', false, 'admins.edit', false, 'admins.disable', false
    )
    else '{}'::jsonb
  end;
$$;

-- ── start / end / describe ──────────────────────────────────────────────────
create or replace function op_begin_cafe_session(
  p_cafe_id uuid,
  p_reason  text,
  p_minutes integer default 60
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_admin platform_admins%rowtype;
  v_cafe  cafes%rowtype;
  v_mins  integer;
  v_id    uuid;
  v_exp   timestamptz;
begin
  if not has_platform_permission('cafes.impersonate') then raise exception 'not authorized'; end if;
  if p_reason is null or trim(p_reason) = '' then raise exception 'a reason is required'; end if;

  -- 8h ceiling: long enough for a working session, short enough that a
  -- forgotten tab cannot hold open access indefinitely.
  v_mins := least(greatest(coalesce(p_minutes, 60), 5), 480);

  select * into v_admin from platform_admins where user_id = auth.uid() and status = 'active';
  if v_admin.id is null then raise exception 'not authorized'; end if;

  select * into v_cafe from cafes where id = p_cafe_id;
  if v_cafe.id is null then raise exception 'cafe not found'; end if;

  -- One café at a time. Without this, active_impersonated_cafe() would have to
  -- guess between two open sessions and the dashboard would silently show
  -- whichever sorted first.
  update cafe_impersonations set ended_at = now()
  where admin_user_id = auth.uid() and ended_at is null;

  v_exp := now() + make_interval(mins => v_mins);
  insert into cafe_impersonations (admin_id, admin_user_id, cafe_id, reason, expires_at)
  values (v_admin.id, auth.uid(), p_cafe_id, trim(p_reason), v_exp)
  returning id into v_id;

  insert into platform_audit_logs (actor_id, action, target_type, target_id, new_value)
  values (auth.uid(), 'cafe.session_started', 'cafe', p_cafe_id,
          jsonb_build_object('reason', trim(p_reason), 'minutes', v_mins, 'expires_at', v_exp));

  return jsonb_build_object('session_id', v_id, 'cafe_id', p_cafe_id,
                            'cafe_name', v_cafe.name, 'expires_at', v_exp);
end $$;
revoke execute on function op_begin_cafe_session(uuid, text, integer) from public, anon;
grant execute on function op_begin_cafe_session(uuid, text, integer) to authenticated;

-- No permission check: ending your own session is always allowed, and must
-- stay allowed even if the permission is revoked mid-session — otherwise a
-- just-demoted admin would be stuck inside a café they can no longer leave.
create or replace function op_end_cafe_session()
returns void language plpgsql security definer set search_path = public as $$
declare v_cafe_id uuid;
begin
  select cafe_id into v_cafe_id from cafe_impersonations
  where admin_user_id = auth.uid() and ended_at is null
  order by started_at desc limit 1;
  if v_cafe_id is null then return; end if;

  update cafe_impersonations set ended_at = now()
  where admin_user_id = auth.uid() and ended_at is null;

  insert into platform_audit_logs (actor_id, action, target_type, target_id)
  values (auth.uid(), 'cafe.session_ended', 'cafe', v_cafe_id);
end $$;
revoke execute on function op_end_cafe_session() from public, anon;
grant execute on function op_end_cafe_session() to authenticated;

-- Everything getCurrentCafe() needs in one round trip, so the dashboard layout
-- doesn't pay a second query on every render just to draw the banner.
create or replace function impersonation_context()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'session_id', i.id,
    'cafe_id',    c.id,
    'name',       c.name,
    'slug',       c.slug,
    'status',     c.status,
    'status_reason', c.status_reason,
    'timezone',   coalesce(c.timezone, 'Asia/Kolkata'),
    'reason',     i.reason,
    'expires_at', i.expires_at,
    'admin_name', p.full_name
  )
  from cafe_impersonations i
  join cafes c on c.id = i.cafe_id
  left join profiles p on p.id = i.admin_user_id
  where i.admin_user_id = auth.uid() and i.ended_at is null and i.expires_at > now()
  order by i.started_at desc
  limit 1;
$$;
revoke execute on function impersonation_context() from public, anon;
grant execute on function impersonation_context() to authenticated;

-- Session history for the café detail page — who looked, when, and why.
create or replace function op_list_cafe_sessions(p_cafe_id uuid, p_limit integer default 20)
returns table (
  id uuid, admin_name text, admin_email text, reason text,
  started_at timestamptz, expires_at timestamptz, ended_at timestamptz
) language plpgsql stable security definer set search_path = public as $$
begin
  if not has_platform_permission('cafes.view') then raise exception 'not authorized'; end if;
  return query
    select i.id, a.full_name, a.email, i.reason, i.started_at, i.expires_at, i.ended_at
    from cafe_impersonations i
    join platform_admins a on a.id = i.admin_id
    where i.cafe_id = p_cafe_id
    order by i.started_at desc
    limit least(greatest(coalesce(p_limit, 20), 1), 100);
end $$;
revoke execute on function op_list_cafe_sessions(uuid, integer) from public, anon;
grant execute on function op_list_cafe_sessions(uuid, integer) to authenticated;
