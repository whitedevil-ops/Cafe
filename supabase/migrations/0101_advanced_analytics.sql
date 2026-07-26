-- ============================================================================
-- 0101 — Advanced analytics. Gives the 'advanced_analytics' plan flag
-- (existed since pricing tiers were defined, no feature behind it) an
-- actual feature — distinct from the existing Reports pages (Sales, Items,
-- Payments, GST, Adjustments, Operations, Profitability), which are all
-- period-total/tabular. This is trend-and-pattern analysis instead:
--   * daily revenue trend, for a real trend chart instead of one period total
--   * a day-of-week × hour-of-day heatmap, for staffing/prep-timing decisions
--   * repeat-customer rate for the period
--   * a naive next-7-day forecast (trailing 7-day daily average × 7) —
--     explicitly labelled as that, not dressed up as a real ML prediction
-- ============================================================================

create or replace function advanced_analytics_report(p_cafe_id uuid, p_from timestamptz, p_to timestamptz)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_result jsonb;
  v_tz     text;
begin
  if not is_cafe_member(p_cafe_id) then raise exception 'not authorized'; end if;
  if p_to <= p_from then raise exception 'invalid range'; end if;

  select coalesce(timezone, 'Asia/Kolkata') into v_tz from cafes where id = p_cafe_id;

  with orders_in_range as (
    select o.* from orders o
    where o.cafe_id = p_cafe_id and o.status <> 'cancelled'
      and o.created_at >= p_from and o.created_at < p_to
  ),
  daily as (
    select (created_at at time zone v_tz)::date as d, sum(total) as revenue, count(*) as orders
    from orders_in_range group by 1
  ),
  daily_json as (
    select coalesce(jsonb_agg(jsonb_build_object('date', d, 'revenue', revenue, 'orders', orders) order by d), '[]'::jsonb) as arr
    from daily
  ),
  hourly as (
    select extract(dow from created_at at time zone v_tz)::int as dow,
           extract(hour from created_at at time zone v_tz)::int as hr,
           sum(total) as revenue, count(*) as orders
    from orders_in_range group by 1, 2
  ),
  hourly_json as (
    select coalesce(jsonb_agg(jsonb_build_object('dow', dow, 'hour', hr, 'revenue', revenue, 'orders', orders)), '[]'::jsonb) as arr
    from hourly
  ),
  customer_orders as (
    select customer_id, count(*) as cnt from orders_in_range where customer_id is not null group by 1
  ),
  repeat_stats as (
    select count(*) filter (where cnt = 1) as new_customers, count(*) filter (where cnt > 1) as returning_customers
    from customer_orders
  ),
  recent_avg as (
    select coalesce(avg(revenue), 0) as avg_daily from daily where d >= (p_to::date - 7)
  )
  select jsonb_build_object(
    'daily_revenue', (select arr from daily_json),
    'hourly_heatmap', (select arr from hourly_json),
    'repeat', jsonb_build_object(
      'new_customers', coalesce((select new_customers from repeat_stats), 0),
      'returning_customers', coalesce((select returning_customers from repeat_stats), 0),
      'repeat_rate_pct', case when coalesce((select new_customers + returning_customers from repeat_stats), 0) > 0
        then round(100.0 * (select returning_customers from repeat_stats) / (select new_customers + returning_customers from repeat_stats), 1)
        else 0 end
    ),
    'forecast_next_7d', round((select avg_daily from recent_avg) * 7)
  ) into v_result;

  return v_result;
end $$;

revoke execute on function advanced_analytics_report(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function advanced_analytics_report(uuid, timestamptz, timestamptz) to authenticated;

-- ── Analytics joins the role-screen-access system (0096/0100) ─────────────
create or replace function all_screen_keys()
returns text[] language sql immutable as $$
  select array['dashboard','pos','tables','bills','shift','kitchen','menu','customers','feedback',
               'inventory','purchases','recipes','coupons','loyalty','wallet','reservations','reports',
               'analytics','expenses','profile','qr_codes','billing','settings']
$$;

create or replace function default_role_screens(p_role member_role)
returns text[] language sql immutable as $$
  select case p_role
    when 'owner'      then array['dashboard','pos','tables','bills','shift','kitchen','menu','customers','feedback','inventory','purchases','recipes','coupons','loyalty','wallet','reservations','reports','analytics','expenses','profile','qr_codes','billing','settings']
    when 'manager'    then array['dashboard','pos','tables','bills','shift','kitchen','menu','customers','feedback','inventory','purchases','recipes','coupons','loyalty','wallet','reservations','reports','analytics','expenses','profile','qr_codes','settings']
    when 'cashier'    then array['dashboard','pos','tables','bills','shift','kitchen','reservations']
    when 'waiter'     then array['pos','tables','kitchen','reservations']
    when 'kitchen'    then array['kitchen']
    when 'accountant' then array['dashboard','bills','reports','analytics','expenses','billing']
    else array[]::text[]
  end
$$;
