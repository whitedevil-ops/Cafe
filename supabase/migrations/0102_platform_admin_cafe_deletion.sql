-- ============================================================================
-- 0102 — Permanent café deletion for platform admins.
--
-- Explicit, deliberate choice by the founder after being shown the safer
-- alternative (the existing Archive status, which deactivates a café but
-- keeps every record for legal/GST retention): this is real, irreversible
-- deletion — the café row and everything cascading from it (orders,
-- payments, GST invoices, customers, wallet balances, staff memberships)
-- is gone, with no recovery path.
--
-- Restricted to a NEW permission (cafes.delete), true only for super_admin
-- by default — cafes.edit/suspend (which every operations_admin already
-- has) is nowhere near this action's blast radius.
--
-- Confirmation is enforced SERVER-SIDE: the caller must pass the café's
-- exact current name, not just click a dialog — a client-only "type to
-- confirm" is theatre if the server doesn't also check it.
--
-- cafe_deletions is a durable record of every deletion, kept in a table
-- that does NOT foreign-key to cafes(id) — audit_logs does (on delete
-- cascade), so any audit_logs row about this deletion would be destroyed
-- in the same transaction as the café itself, making it useless as a
-- record of "this café existed and was deleted by X on Y." This table is
-- the one place that survives.
-- ============================================================================

create table if not exists cafe_deletions (
  id          uuid primary key default gen_random_uuid(),
  cafe_id     uuid not null, -- deliberately not a FK — must outlive the deleted row
  cafe_name   text not null,
  owner_email text,
  plan        text,
  deleted_by  uuid references profiles(id) on delete set null,
  deleted_at  timestamptz not null default now(),
  snapshot    jsonb not null default '{}'
);
create index if not exists cafe_deletions_deleted_at_idx on cafe_deletions (deleted_at desc);

alter table cafe_deletions enable row level security;
-- No policies at all — readable only through list_cafe_deletions() below,
-- same "immutable, function-gated" posture as refunds/cash_shifts.

create or replace function role_default_permissions(p_role text)
returns jsonb language sql immutable as $$
  select case p_role
    when 'super_admin' then jsonb_build_object(
      'cafes.view', true, 'cafes.verify', true, 'cafes.edit', true, 'cafes.suspend', true, 'cafes.delete', true,
      'users.view', true, 'health.view', true,
      'plans.view', true, 'plans.change', true, 'subscriptions.view', true, 'subscriptions.manage', true,
      'audit.view', true,
      'admins.view', true, 'admins.create', true, 'admins.edit', true, 'admins.disable', true
    )
    when 'operations_admin' then jsonb_build_object(
      'cafes.view', true, 'cafes.verify', true, 'cafes.edit', true, 'cafes.suspend', false, 'cafes.delete', false,
      'users.view', true, 'health.view', true,
      'plans.view', false, 'plans.change', false, 'subscriptions.view', false, 'subscriptions.manage', false,
      'audit.view', false,
      'admins.view', false, 'admins.create', false, 'admins.edit', false, 'admins.disable', false
    )
    when 'support_admin' then jsonb_build_object(
      'cafes.view', true, 'cafes.verify', false, 'cafes.edit', false, 'cafes.suspend', false, 'cafes.delete', false,
      'users.view', true, 'health.view', true,
      'plans.view', false, 'plans.change', false, 'subscriptions.view', false, 'subscriptions.manage', false,
      'audit.view', false,
      'admins.view', false, 'admins.create', false, 'admins.edit', false, 'admins.disable', false
    )
    when 'billing_admin' then jsonb_build_object(
      'cafes.view', true, 'cafes.verify', false, 'cafes.edit', false, 'cafes.suspend', false, 'cafes.delete', false,
      'users.view', false, 'health.view', false,
      'plans.view', true, 'plans.change', true, 'subscriptions.view', true, 'subscriptions.manage', true,
      'audit.view', false,
      'admins.view', false, 'admins.create', false, 'admins.edit', false, 'admins.disable', false
    )
    when 'read_only' then jsonb_build_object(
      'cafes.view', true, 'cafes.verify', false, 'cafes.edit', false, 'cafes.suspend', false, 'cafes.delete', false,
      'users.view', true, 'health.view', true,
      'plans.view', true, 'plans.change', false, 'subscriptions.view', true, 'subscriptions.manage', false,
      'audit.view', false,
      'admins.view', false, 'admins.create', false, 'admins.edit', false, 'admins.disable', false
    )
    else '{}'::jsonb
  end;
$$;

create or replace function op_delete_cafe(p_cafe_id uuid, p_confirm_name text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_cafe     record;
  v_snapshot jsonb;
begin
  if not has_platform_permission('cafes.delete') then raise exception 'not authorized'; end if;

  select c.id, c.name, c.plan, p.email as owner_email
    into v_cafe
    from cafes c left join profiles p on p.id = c.owner_id
   where c.id = p_cafe_id;
  if v_cafe.id is null then raise exception 'café not found'; end if;

  if p_confirm_name is null or trim(p_confirm_name) <> v_cafe.name then
    raise exception 'the name you typed doesn''t match this café''s name exactly';
  end if;

  select jsonb_build_object(
    'staff_count', (select count(*) from cafe_members where cafe_id = p_cafe_id),
    'menu_items_count', (select count(*) from menu_items where cafe_id = p_cafe_id),
    'orders_count', (select count(*) from orders where cafe_id = p_cafe_id),
    'customers_count', (select count(*) from customers where cafe_id = p_cafe_id)
  ) into v_snapshot;

  insert into cafe_deletions (cafe_id, cafe_name, owner_email, plan, deleted_by, snapshot)
  values (v_cafe.id, v_cafe.name, v_cafe.owner_email, v_cafe.plan, auth.uid(), v_snapshot);

  delete from cafes where id = p_cafe_id;
end $$;

revoke execute on function op_delete_cafe(uuid, text) from public, anon;
grant execute on function op_delete_cafe(uuid, text) to authenticated;

create or replace function list_cafe_deletions(p_limit integer default 50)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not has_platform_permission('audit.view') then raise exception 'not authorized'; end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', d.id, 'cafe_name', d.cafe_name, 'owner_email', d.owner_email, 'plan', d.plan,
      'deleted_by_name', p.full_name, 'deleted_at', d.deleted_at, 'snapshot', d.snapshot
    ) order by d.deleted_at desc)
    from (select * from cafe_deletions order by deleted_at desc limit greatest(1, least(coalesce(p_limit, 50), 200))) d
    left join profiles p on p.id = d.deleted_by
  ), '[]'::jsonb);
end $$;

revoke execute on function list_cafe_deletions(integer) from public, anon;
grant execute on function list_cafe_deletions(integer) to authenticated;
