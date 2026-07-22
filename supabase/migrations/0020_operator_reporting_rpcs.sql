-- ============================================================================
-- 0020 — Read-side RPCs for the operator panel UI: dashboard metrics, café
-- directory (with search/filter done server-side), café detail, and café
-- health. All SECURITY DEFINER + is_platform_admin()-gated, all returning
-- ONLY aggregates/café-level fields — never raw customer rows — per the
-- explicit "do not expose unnecessary customer-sensitive data" instruction.
-- This is why these are RPCs and not a broad "platform admin read" policy
-- added to `orders`/`customers`: a table-level RLS policy is all-or-nothing
-- per row, so it would hand the operator raw customer PII (phone, name) the
-- moment they ran their own query — a function that returns counts can't.
-- ============================================================================

create or replace function op_platform_overview()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_month_start timestamptz := date_trunc('month', now());
  v_today_start timestamptz := date_trunc('day', now());
  v_result jsonb;
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;

  select jsonb_build_object(
    'total_cafes', (select count(*) from cafes),
    'active_cafes', (select count(*) from cafes where status = 'active'),
    'verified_cafes', (select count(*) from cafes where verified),
    'unverified_cafes', (select count(*) from cafes where not verified),
    'trial_cafes', (select count(*) from cafes where plan = 'trial'),
    'suspended_cafes', (select count(*) from cafes where status = 'suspended'),
    'disabled_cafes', (select count(*) from cafes where status = 'disabled'),
    'archived_cafes', (select count(*) from cafes where status = 'archived'),
    'total_orders', (select count(*) from orders where status <> 'cancelled'),
    'total_customers', (select count(*) from customers),
    'new_cafes_this_month', (select count(*) from cafes where created_at >= v_month_start),
    'active_cafes_today', (select count(distinct cafe_id) from orders where created_at >= v_today_start and status <> 'cancelled'),
    'expiring_7', (select count(*) from cafes where subscription_ends_at between now() and now() + interval '7 days'),
    'expiring_15', (select count(*) from cafes where subscription_ends_at between now() and now() + interval '15 days'),
    'expiring_30', (select count(*) from cafes where subscription_ends_at between now() and now() + interval '30 days'),
    'plan_breakdown', (
      select coalesce(jsonb_agg(jsonb_build_object('plan', plan, 'count', cnt) order by cnt desc), '[]'::jsonb)
      from (select plan, count(*) cnt from cafes group by plan) x
    ),
    'recent_registrations', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', id, 'name', name, 'city', city, 'plan', plan, 'created_at', created_at
      ) order by created_at desc), '[]'::jsonb)
      from (select id, name, city, plan, created_at from cafes order by created_at desc limit 10) x
    ),
    'recent_activity', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'action', action, 'target_type', target_type, 'created_at', created_at
      ) order by created_at desc), '[]'::jsonb)
      from (select action, target_type, created_at from platform_audit_logs order by created_at desc limit 10) x
    )
  ) into v_result;

  return v_result;
end $$;

revoke execute on function op_platform_overview() from public, anon;
grant execute on function op_platform_overview() to authenticated;

-- ── Café directory: search + filters done in SQL, one round trip ──────────
create or replace function op_list_cafes(
  p_search  text default null,
  p_status  text default null,
  p_verified boolean default null,
  p_plan    text default null,
  p_from    timestamptz default null,
  p_to      timestamptz default null
) returns table (
  cafe_id uuid, name text, city text, phone text, plan text, verified boolean,
  status text, created_at timestamptz, owner_name text, owner_email text, owner_phone text,
  staff_count bigint, orders_count bigint, last_order_at timestamptz,
  menu_items_count bigint, tables_count bigint, customers_count bigint
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;

  return query
  select
    c.id, c.name, c.city, c.phone, c.plan, c.verified, c.status, c.created_at,
    p.full_name, p.email, p.phone,
    (select count(*) from cafe_members cm where cm.cafe_id = c.id and cm.status = 'active'),
    (select count(*) from orders o where o.cafe_id = c.id and o.status <> 'cancelled'),
    (select max(o.created_at) from orders o where o.cafe_id = c.id and o.status <> 'cancelled'),
    (select count(*) from menu_items mi where mi.cafe_id = c.id),
    (select count(*) from cafe_tables ct where ct.cafe_id = c.id),
    (select count(*) from customers cu where cu.cafe_id = c.id)
  from cafes c
  left join profiles p on p.id = c.owner_id
  where (p_status is null or c.status = p_status)
    and (p_verified is null or c.verified = p_verified)
    and (p_plan is null or c.plan = p_plan)
    and (p_from is null or c.created_at >= p_from)
    and (p_to is null or c.created_at <= p_to)
    and (
      p_search is null or p_search = '' or
      c.name ilike '%' || p_search || '%' or
      c.id::text = p_search or
      c.phone ilike '%' || p_search || '%' or
      p.full_name ilike '%' || p_search || '%' or
      p.email ilike '%' || p_search || '%'
    )
  order by c.created_at desc;
end $$;

revoke execute on function op_list_cafes(text, text, boolean, text, timestamptz, timestamptz) from public, anon;
grant execute on function op_list_cafes(text, text, boolean, text, timestamptz, timestamptz) to authenticated;

-- ── Café detail: everything the operator detail page needs, one call ──────
create or replace function op_get_cafe_detail(p_cafe_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_result jsonb;
  v_plan_key text;
  v_plan_features jsonb;
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;

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
        'trial_ends_at', trial_ends_at, 'subscription_ends_at', subscription_ends_at
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
    'onboarding', (
      select to_jsonb(o) from v_cafe_onboarding o where cafe_id = p_cafe_id
    ),
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

-- ── Café health: proactive signals, not raw customer data ──────────────────
create or replace function op_cafe_health()
returns table (
  cafe_id uuid, name text, status text,
  days_since_last_order integer, onboarding_percent integer,
  failed_sms_count bigint, days_until_expiry integer
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;

  return query
  select
    c.id, c.name, c.status,
    (extract(day from now() - lo.last_order))::int as days_since_last_order,
    round((
      (o.account_created::int + o.profile_completed::int + o.menu_added::int + o.tables_created::int +
       o.qr_generated::int + o.staff_added::int + o.first_order_placed::int) * 100.0 / 7
    ))::int as onboarding_percent,
    coalesce(sms.failed_count, 0) as failed_sms_count,
    case when c.subscription_ends_at is null then null
         else (extract(day from c.subscription_ends_at - now()))::int end as days_until_expiry
  from cafes c
  left join v_cafe_onboarding o on o.cafe_id = c.id
  left join (select cafe_id, max(created_at) last_order from orders where status <> 'cancelled' group by cafe_id) lo on lo.cafe_id = c.id
  left join (select cafe_id, count(*) failed_count from sms_logs where status = 'failed' group by cafe_id) sms on sms.cafe_id = c.id
  where c.status <> 'archived'
  order by c.name;
end $$;

revoke execute on function op_cafe_health() from public, anon;
grant execute on function op_cafe_health() to authenticated;
