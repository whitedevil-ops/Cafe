-- ============================================================================
-- Phase 2 — surface cafes.billing_status in op_get_cafe_detail.
--
-- billing_status (0074) is populated by the real Razorpay webhook and has
-- been shown on the café's own dashboard since 0074/0090
-- (app/dashboard/billing/billing-client.tsx) but op_get_cafe_detail's
-- `account` object never selected it, so /ops/cafes/[id] has had no way to
-- show it. Surfacing an already-populated column, not new backend
-- capability. Body otherwise identical to its 0079 definition.
-- ============================================================================

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
        'billing_status', billing_status
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

revoke execute on function op_get_cafe_detail(uuid) from public, anon;
grant execute on function op_get_cafe_detail(uuid) to authenticated;

-- ── self-check ───────────────────────────────────────────────────────────
do $$
declare v_result jsonb; v_cafe_id uuid;
begin
  select id into v_cafe_id from cafes limit 1;
  if v_cafe_id is null then return; end if;
  begin
    select op_get_cafe_detail(v_cafe_id) into v_result;
  exception
    when insufficient_privilege then return;
    when others then
      if sqlerrm like '%not authorized%' then return; end if;
      raise;
  end;
  if not (v_result -> 'account' ? 'billing_status') then
    raise exception 'op_get_cafe_detail account object is missing billing_status';
  end if;
end $$;
