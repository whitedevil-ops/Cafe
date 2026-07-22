-- ============================================================================
-- 0022 — Fix "column reference is ambiguous" runtime errors in compute_bill()
-- and op_cafe_health(), both introduced by me in 0016/0020.
--
-- THE TRAP: `returns table (... service_charge integer ...)` silently declares
-- a plpgsql variable named `service_charge` for the whole function body. An
-- unqualified `select ... service_charge ... from cafes` then can't tell the
-- variable from cafes.service_charge and throws at RUNTIME — not at CREATE
-- time, which is why `create or replace function` succeeded, check-schema.sql
-- reported present = true, and the failure only surfaced when someone actually
-- placed an order.
--
-- IMPACT: compute_bill() is called by BOTH place_order (QR) and
-- staff_place_order (POS), so every order placed since 0016 was applied has
-- been failing. op_cafe_health() has the same defect on `cafe_id`/`status`,
-- breaking the operator Health page.
--
-- THE FIX: qualify every column reference with its table alias. Qualified
-- names are never ambiguous, so the OUT-parameter name can no longer shadow a
-- real column.
-- ============================================================================

create or replace function compute_bill(p_cafe_id uuid, p_subtotal integer, p_discount integer default 0)
returns table(discounted_subtotal integer, tax integer, service_charge integer, total integer)
language plpgsql stable as $$
declare
  v_tax_pct numeric;
  v_svc_pct numeric;
  v_disc    integer;
  v_base    integer;
  v_tax     integer;
  v_svc     integer;
begin
  -- `c.` prefix is load-bearing: bare `service_charge` collides with this
  -- function's own OUT parameter of the same name.
  select c.tax_percent, c.service_charge into v_tax_pct, v_svc_pct
    from cafes c where c.id = p_cafe_id;

  v_disc := least(greatest(coalesce(p_discount, 0), 0), p_subtotal);
  v_base := p_subtotal - v_disc;
  v_tax  := round(v_base * coalesce(v_tax_pct, 0) / 100.0);
  v_svc  := round(v_base * coalesce(v_svc_pct, 0) / 100.0);
  return query select v_base, v_tax, v_svc, v_base + v_tax + v_svc;
end $$;

revoke execute on function compute_bill(uuid, integer, integer) from public, anon;
grant execute on function compute_bill(uuid, integer, integer) to authenticated;

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
  -- Aliases inside these subqueries matter for the same reason: bare
  -- `cafe_id` / `status` would collide with this function's OUT parameters.
  left join (
    select o2.cafe_id, max(o2.created_at) as last_order
    from orders o2 where o2.status <> 'cancelled' group by o2.cafe_id
  ) lo on lo.cafe_id = c.id
  left join (
    select s.cafe_id, count(*) as failed_count
    from sms_logs s where s.status = 'failed' group by s.cafe_id
  ) sms on sms.cafe_id = c.id
  where c.status <> 'archived'
  order by c.name;
end $$;

revoke execute on function op_cafe_health() from public, anon;
grant execute on function op_cafe_health() to authenticated;
