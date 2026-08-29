-- ============================================================================
-- 0190 — Ops café-detail redesign: a real Users & Staff tab needs the
-- operator console to actually be able to LIST and manage a café's staff.
-- Neither existed before this migration:
--
-- op_list_users (0170) is platform-WIDE (search across every user on the
-- platform) — it has no p_cafe_id filter, so it cannot answer "who works at
-- this one café". There was no other function that could.
--
-- Staff role/status changes have NEVER gone through an RPC at all — they're
-- plain RLS-gated table writes (`cafe_members` policies "owner manage u"/"d",
-- 0001) that only work for that café's OWN owner/manager, via their own
-- auth.uid(). A platform admin isn't a member of the café they're managing,
-- so has_cafe_role() correctly refuses them — there was no admin-side path
-- at all, not a gap in an existing one.
--
-- Scope of this migration: read (op_list_cafe_staff) and the single most
-- operationally important write (op_set_staff_status — disable/reactivate,
-- mirroring op_set_cafe_status's own audited pattern exactly). Adding
-- staff, changing a role, and removing a staff member from the admin side
-- are deliberately NOT built here — each interacts with the seat-limit cap,
-- the invite flow, or role-escalation safety in ways that deserve their own
-- design pass, not a rushed addition alongside a page redesign. The ops
-- console's Users & Staff tab reflects this honestly (view + reset password
-- + suspend/reactivate only) rather than showing controls that don't work.
-- ============================================================================

create or replace function op_list_cafe_staff(p_cafe_id uuid)
returns table (
  user_id         uuid,
  full_name       text,
  email           text,
  phone           text,
  role            member_role,
  status          text,
  joined_at       timestamptz,
  last_sign_in_at timestamptz,
  last_seen_at    timestamptz,
  last_device     text
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not has_platform_permission('cafes.view') then raise exception 'not authorized'; end if;

  return query
  select
    m.user_id, p.full_name, coalesce(p.email, u.email::text) as email, p.phone,
    m.role, m.status, m.created_at as joined_at,
    u.last_sign_in_at, p.last_seen_at, p.last_device
  from cafe_members m
  join profiles p on p.id = m.user_id
  left join auth.users u on u.id = m.user_id
  where m.cafe_id = p_cafe_id
  order by (m.role = 'owner') desc, m.created_at;
end $$;

revoke execute on function op_list_cafe_staff(uuid) from public, anon;
grant execute on function op_list_cafe_staff(uuid) to authenticated;

-- Disable/reactivate only — 'suspended' is cafe_members' own real status
-- value (schema comment: "active | invited | suspended"), there is no
-- separate 'disabled' state to invent. Gated on cafes.edit, the same bar
-- already used for the feature-override toggles on this same page — both
-- are "reversible changes to how this café's account is configured", not
-- the higher bar op_set_cafe_status/op_delete_cafe use for the café's own
-- existence. A café can't be left ownerless: refuses suspending the last
-- active owner rather than allowing an operator to accidentally orphan it.
create or replace function op_set_staff_status(p_cafe_id uuid, p_user_id uuid, p_status text, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_before        text;
  v_role          member_role;
  v_active_owners integer;
begin
  if not has_platform_permission('cafes.edit') then raise exception 'not authorized'; end if;
  if p_status not in ('active', 'suspended') then raise exception 'invalid status'; end if;

  select role, status into v_role, v_before from cafe_members where cafe_id = p_cafe_id and user_id = p_user_id;
  if v_role is null then raise exception 'this person is not a member of this café'; end if;

  if p_status = 'suspended' and v_role = 'owner' then
    select count(*) into v_active_owners from cafe_members
     where cafe_id = p_cafe_id and role = 'owner' and status = 'active';
    if v_active_owners <= 1 then
      raise exception 'cannot suspend the only active owner of this café';
    end if;
  end if;

  update cafe_members set status = p_status where cafe_id = p_cafe_id and user_id = p_user_id;

  insert into platform_audit_logs (actor_id, action, target_type, target_id, previous_value, new_value)
  values (auth.uid(), 'cafe.staff_status_changed', 'cafe', p_cafe_id,
          jsonb_build_object('user_id', p_user_id, 'status', v_before),
          jsonb_build_object('user_id', p_user_id, 'status', p_status, 'reason', p_reason));
end $$;

revoke execute on function op_set_staff_status(uuid, uuid, text, text) from public, anon;
grant execute on function op_set_staff_status(uuid, uuid, text, text) to authenticated;

-- ── op_get_cafe_detail: same signature, adds razorpay_subscription_id to
-- the account object -- a real, already-stored signal (does this café even
-- have a subscription object on file) for the redesigned Payments tab,
-- instead of inventing a fake "Razorpay: Connected" status with no backing
-- data. Pure re-body, unchanged signature.
create or replace function op_get_cafe_detail(p_cafe_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_result jsonb;
  v_plan_key text;
  v_plan_features jsonb;
begin
  if not has_platform_permission('cafes.view') then raise exception 'not authorized'; end if;

  select plan into v_plan_key from cafes where id = p_cafe_id;
  if v_plan_key is null then raise exception 'cafe not found'; end if;
  select features into v_plan_features from platform_plans where key = v_plan_key;

  select jsonb_build_object(
    'business', (
      select jsonb_build_object(
        'id', c.id, 'name', c.name, 'logo_url', c.logo_url, 'owner_name', p.full_name,
        'owner_email', p.email, 'owner_phone', p.phone, 'phone', c.phone, 'address', c.address,
        'city', c.city, 'state', c.state, 'pincode', c.pincode, 'gstin', c.gstin, 'created_at', c.created_at
      )
      from cafes c left join profiles p on p.id = c.owner_id where c.id = p_cafe_id
    ),
    'account', (
      select jsonb_build_object(
        'status', status, 'status_reason', status_reason, 'status_changed_at', status_changed_at,
        'verified', verified, 'verified_at', verified_at, 'plan', plan,
        'trial_ends_at', trial_ends_at, 'subscription_ends_at', subscription_ends_at,
        'billing_status', billing_status, 'razorpay_subscription_id', razorpay_subscription_id
      )
      from cafes where id = p_cafe_id
    ),
    'usage', jsonb_build_object(
      'staff_count', (select count(*) from cafe_members where cafe_id = p_cafe_id and status = 'active'),
      'menu_items_count', (select count(*) from menu_items where cafe_id = p_cafe_id),
      'tables_count', (select count(*) from cafe_tables where cafe_id = p_cafe_id),
      'customers_count', (select count(*) from customers where cafe_id = p_cafe_id),
      'orders_count', (select count(*) from orders where cafe_id = p_cafe_id and status <> 'cancelled'),
      'last_order_at', (select max(created_at) from orders where cafe_id = p_cafe_id and status <> 'cancelled')
    ),
    'onboarding', ( select to_jsonb(o) from v_cafe_onboarding o where cafe_id = p_cafe_id ),
    'features', jsonb_build_object(
      'plan_defaults', coalesce(v_plan_features, '{}'::jsonb),
      'overrides', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'feature_key', feature_key, 'enabled', enabled, 'set_at', set_at
        ) order by feature_key), '[]'::jsonb)
        from cafe_feature_overrides where cafe_id = p_cafe_id
      )
    ),
    'notes', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', n.id, 'note', n.note, 'created_by_name', p.full_name, 'created_at', n.created_at
      ) order by n.created_at desc), '[]'::jsonb)
      from operator_notes n left join profiles p on p.id = n.created_by where n.cafe_id = p_cafe_id
    ),
    'recent_audit', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'action', a.action, 'previous_value', a.previous_value, 'new_value', a.new_value,
        'created_at', a.created_at, 'actor_name', p.full_name
      ) order by a.created_at desc), '[]'::jsonb)
      from (select * from platform_audit_logs where target_type = 'cafe' and target_id = p_cafe_id order by created_at desc limit 20) a
      left join profiles p on p.id = a.actor_id
    )
  ) into v_result;

  return v_result;
end $$;
-- Grants unchanged (authenticated only).

-- ── self-check ───────────────────────────────────────────────────────────
do $$
begin
  if (select count(*) from pg_proc where proname = 'op_list_cafe_staff') <> 1 then
    raise exception 'op_list_cafe_staff: expected exactly one overload';
  end if;
  if (select count(*) from pg_proc where proname = 'op_set_staff_status') <> 1 then
    raise exception 'op_set_staff_status: expected exactly one overload';
  end if;
  if (select count(*) from pg_proc where proname = 'op_get_cafe_detail') <> 1 then
    raise exception 'op_get_cafe_detail: expected exactly one overload';
  end if;
end $$;
