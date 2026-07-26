-- ============================================================================
-- 0099 — Wallet top-ups surfaced in a dedicated report, not just the Wallet
-- page + shift reconciliation.
--
-- Deliberately NOT added to `collected`/`by_method` above: a top-up is a
-- customer prepaying for a FUTURE order, not revenue for THIS period —
-- revenue is already recognized once, correctly, when the balance is later
-- spent (that spend already lands in `by_method` as method='wallet' via
-- wallet_charge_order/0091). Adding top-ups there too would double-count.
-- So this is its own summary block: money customers put INTO their wallets
-- in range, split online vs cash, separate from order revenue.
-- ============================================================================

create or replace function payments_outstanding_report(
  p_cafe_id uuid, p_from timestamptz, p_to timestamptz
) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_result jsonb;
begin
  if not is_cafe_member(p_cafe_id) then raise exception 'not authorized'; end if;
  if p_to <= p_from then raise exception 'invalid range'; end if;

  with collected as (
    select coalesce(sum(amount), 0) as amt, count(*) as cnt
    from payments where cafe_id = p_cafe_id and created_at >= p_from and created_at < p_to
  ),
  by_method_json as (
    select coalesce(jsonb_agg(jsonb_build_object('method', method, 'amount', amt, 'transactions', cnt) order by amt desc), '[]'::jsonb) as arr
    from (
      select method::text as method, sum(amount) as amt, count(*) as cnt
      from payments where cafe_id = p_cafe_id and created_at >= p_from and created_at < p_to
      group by 1
    ) x
  ),
  -- Outstanding is a cash-basis, current-state question (same definition as
  -- business_overview_report's outstanding_now) — orders PLACED in range that
  -- still carry a balance as of right now, aged from their placement time.
  outstanding_orders as (
    select o.id, o.short_code, o.type, o.total, o.created_at,
           coalesce((select sum(amount) from payments p where p.order_id = o.id), 0) as paid
    from orders o
    where o.cafe_id = p_cafe_id and o.status <> 'cancelled'
      and o.created_at >= p_from and o.created_at < p_to
      and o.total > coalesce((select sum(amount) from payments p where p.order_id = o.id), 0)
  ),
  aging_json as (
    select coalesce(jsonb_agg(jsonb_build_object('bucket', bucket, 'amount', amt, 'orders', cnt) order by ord), '[]'::jsonb) as arr
    from (
      select
        case
          when now() - created_at < interval '1 day' then '0–1 day'
          when now() - created_at < interval '3 days' then '1–3 days'
          when now() - created_at < interval '7 days' then '3–7 days'
          else '7+ days'
        end as bucket,
        case
          when now() - created_at < interval '1 day' then 0
          when now() - created_at < interval '3 days' then 1
          when now() - created_at < interval '7 days' then 2
          else 3
        end as ord,
        sum(total - paid) as amt, count(*) as cnt
      from outstanding_orders
      group by 1, 2
    ) x
  ),
  bills_json as (
    select coalesce(jsonb_agg(x order by (x->>'created_at')::timestamptz asc), '[]'::jsonb) as arr
    from (
      select jsonb_build_object(
        'order_id', id, 'short_code', short_code, 'type', type::text,
        'total', total, 'paid', paid, 'due', total - paid, 'created_at', created_at
      ) as x
      from outstanding_orders
      order by created_at asc
      limit 100
    ) y
  ),
  wallet_topups as (
    select
      coalesce(sum(paid_amount) filter (where source = 'cash'), 0) as cash_amt,
      coalesce(sum(paid_amount) filter (where source = 'online'), 0) as online_amt,
      count(*) filter (where source = 'cash') as cash_cnt,
      count(*) filter (where source = 'online') as online_cnt
    from wallet_transactions
    where cafe_id = p_cafe_id and kind = 'topup'
      and created_at >= p_from and created_at < p_to
  )
  select jsonb_build_object(
    'summary', jsonb_build_object(
      'collected', (select amt from collected),
      'collected_transactions', (select cnt from collected),
      'outstanding_amount', (select coalesce(sum(total - paid), 0) from outstanding_orders),
      'outstanding_orders', (select count(*) from outstanding_orders)
    ),
    'by_method', (select arr from by_method_json),
    'aging', (select arr from aging_json),
    'outstanding_bills', (select arr from bills_json),
    'wallet_topups', (select jsonb_build_object(
      'cash', cash_amt, 'online', online_amt, 'total', cash_amt + online_amt,
      'cash_transactions', cash_cnt, 'online_transactions', online_cnt, 'transactions', cash_cnt + online_cnt
    ) from wallet_topups)
  ) into v_result;

  return v_result;
end $$;

revoke execute on function payments_outstanding_report(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function payments_outstanding_report(uuid, timestamptz, timestamptz) to authenticated;
