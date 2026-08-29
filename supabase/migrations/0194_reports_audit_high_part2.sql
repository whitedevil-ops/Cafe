-- ============================================================================
-- 0194 — Reports-module audit, HIGH-severity fixes, part 2 of 2.
--
-- 1. profitability_report's summary silently treated every uncosted item
--    (oi.cost_snapshot is null) as if it cost ₹0 — its full sale value
--    still flowed into `contribution`/`margin_pct` as 100%-margin profit.
--    Live-confirmed material on ~40% of the real pilot café's order
--    history. `cost`/`contribution`/`margin_pct` now computed ONLY from
--    items that actually have a cost recorded; `net_sales` stays the true
--    total across all items (that figure was correct); a new
--    `uncosted_sales` tells the frontend how much revenue was excluded so
--    it can say so rather than silently overstating margin.
--
-- 2. refund_order's GST credit note tax split used ONE blended, order-level
--    ratio (v_order.tax / v_order.total) even for an ITEM-level refund,
--    where the specific refunded lines — and their own tax_amount/
--    taxable_value — are already known. Live-quantified overstatement:
--    +₹59 (+131%) on a two-tax-rate fixture. Now uses the exact per-line
--    share for an item-level refund; the order-level ratio remains the only
--    option for a non-itemized full/partial cash-value refund, where which
--    specific lines were "refunded" is inherently unknown.
--
-- 3. recommendation_report's added_sales multiplied each 'add' event by the
--    item's CURRENT price via a join, not the price at the time the event
--    happened — live-reproduced: a price change after the fact silently
--    rewrote a past period's figure. recommendation_events now snapshots
--    the price at log time; historical rows logged before this column
--    existed fall back to the current price (the only information that
--    ever existed for them).
--
-- 4. recommendation_report's top_pairings read the precomputed, unwindowed
--    order_pair_stats cache (a lifetime total as of the last manual
--    refresh) regardless of the requested p_from/p_to — live-confirmed a
--    deliberately empty date window still returned non-empty pairing data.
--    Now computed live for the requested range, same join shape
--    refresh_order_pairings itself uses.
-- ============================================================================

create or replace function profitability_report(
  p_cafe_id uuid,
  p_from    timestamptz,
  p_to      timestamptz,
  p_type    text default 'all'
) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_result jsonb;
begin
  if not has_cafe_role(p_cafe_id, array['owner','manager']::member_role[]) then
    raise exception 'only an owner or manager can view profitability';
  end if;
  if not cafe_has_feature(p_cafe_id, 'advanced_reports') then
    raise exception 'advanced reports are not available on this café''s plan';
  end if;

  with lines as (
    select
      oi.menu_item_id, oi.name, oi.qty,
      coalesce((
        select sum(ri.qty) from refund_items ri
        join refunds r on r.id = ri.refund_id
        where ri.order_item_id = oi.id and r.status = 'completed'
      ), 0) as refunded_qty,
      coalesce(oi.taxable_value, oi.price * oi.qty) as line_taxable,
      coalesce(oi.cost_snapshot, 0) as unit_cost,
      (oi.cost_snapshot is not null) as costed
    from order_items oi
    join orders o on o.id = oi.order_id
    where o.cafe_id = p_cafe_id
      and o.created_at >= p_from and o.created_at < p_to
      and o.status <> 'cancelled'
      and (p_type = 'all' or o.type::text = p_type)
  ),
  net as (
    select menu_item_id, name, (qty - refunded_qty) as net_qty,
      case when qty > 0 then round(line_taxable * (qty - refunded_qty)::numeric / qty) else 0 end as net_sales,
      unit_cost * (qty - refunded_qty) as cost, costed
    from lines
    where (qty - refunded_qty) > 0
  ),
  agg as (
    select menu_item_id, coalesce(name, '(removed item)') as name,
      sum(net_qty)::integer as qty, sum(net_sales)::integer as sales,
      sum(cost)::integer as cost, bool_and(costed) as has_cost
    from net
    group by menu_item_id, coalesce(name, '(removed item)')
  )
  select jsonb_build_object(
    'summary', jsonb_build_object(
      'net_sales',      coalesce((select sum(sales) from agg), 0),
      'cost',           coalesce((select sum(cost) from agg where has_cost), 0),
      'contribution',   coalesce((select sum(sales - cost) from agg where has_cost), 0),
      'margin_pct',     case when coalesce((select sum(sales) from agg where has_cost), 0) > 0
                            then round((select sum(sales - cost) from agg where has_cost) * 100.0 / (select sum(sales) from agg where has_cost), 1)
                            else 0 end,
      'uncosted_sales', coalesce((select sum(sales) from agg where not has_cost), 0)
    ),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'menu_item_id', menu_item_id, 'name', name, 'qty', qty, 'sales', sales, 'cost', cost,
        'contribution', sales - cost,
        'margin_pct', case when sales > 0 then round((sales - cost) * 100.0 / sales, 1) else 0 end,
        'has_cost', has_cost
      ) order by (sales - cost) desc)
      from agg), '[]'::jsonb)
  ) into v_result;

  return v_result;
end $$;

create or replace function refund_order(
  p_order_id uuid,
  p_reason   text,
  p_method   text default null,
  p_amount   integer default null,
  p_items    jsonb default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_order            record;
  v_role             member_role;
  v_limit            integer;
  v_already          integer;
  v_remaining        integer;
  v_amount           integer := 0;
  v_kind             text;
  v_method           payment_method;
  v_actual           text;
  v_refund_id        uuid;
  v_item             jsonb;
  v_oi               record;
  v_qty              integer;
  v_prior_qty        integer;
  v_line_value       integer;
  v_share            integer;
  v_priced           jsonb := '[]'::jsonb;
  v_cn_number        text;
  v_cn_issued_at     timestamptz;
  v_cn_taxable       integer;
  v_cn_tax           integer;
  v_item_cn_tax      integer := 0;
  v_item_cn_taxable  integer := 0;
  v_tz               text;
  v_fy               text;
  v_seq              integer;
begin
  select o.id, o.cafe_id, o.customer_id, o.total, o.subtotal, o.payment_status, o.payment_method, o.short_code,
         o.gst_invoice_number, o.tax
    into v_order
    from orders o where o.id = p_order_id;
  if v_order.id is null then raise exception 'order not found'; end if;

  select role into v_role from cafe_members
   where cafe_id = v_order.cafe_id and user_id = auth.uid() and status = 'active';
  if v_role is null then raise exception 'not authorized for this café'; end if;
  if v_role not in ('owner', 'manager', 'cashier') then
    raise exception 'your role cannot issue refunds';
  end if;

  if p_reason is null or trim(p_reason) = '' then
    raise exception 'a refund reason is required';
  end if;

  if v_order.payment_status <> 'paid' then
    raise exception 'this order is not marked paid — there is nothing to refund';
  end if;

  v_already := order_refunded_total(p_order_id);
  v_remaining := v_order.total - v_already;
  if v_remaining <= 0 then raise exception 'this order has already been fully refunded'; end if;

  select case count(distinct method) when 1 then min(method::text) else null end into v_actual
    from payments where order_id = p_order_id;
  v_method := coalesce(nullif(p_method, '')::payment_method, nullif(v_actual, '')::payment_method, v_order.payment_method, 'cash');

  -- ── Item-level ───────────────────────────────────────────────────────────
  if p_items is not null and jsonb_array_length(p_items) > 0 then
    v_kind := 'item';

    for v_item in select * from jsonb_array_elements(p_items) loop
      select oi.id, oi.price, oi.qty, oi.name, oi.tax_amount, oi.taxable_value into v_oi
        from order_items oi
       where oi.id = (v_item->>'order_item_id')::uuid and oi.order_id = p_order_id;
      if v_oi.id is null then raise exception 'item does not belong to this order'; end if;

      v_qty := greatest(1, coalesce((v_item->>'qty')::int, 1));

      select coalesce(sum(ri.qty), 0) into v_prior_qty
        from refund_items ri
        join refunds r on r.id = ri.refund_id
       where ri.order_item_id = v_oi.id and r.status = 'completed';
      if v_prior_qty + v_qty > v_oi.qty then
        raise exception 'cannot refund % × % — only % of that line remain unrefunded',
          v_qty, v_oi.name, v_oi.qty - v_prior_qty;
      end if;

      v_line_value := v_oi.price * v_qty;
      v_share := case when v_order.subtotal > 0
                      then round(v_order.total::numeric * v_line_value / v_order.subtotal)::integer
                      else v_line_value end;

      v_priced := v_priced || jsonb_build_object(
        'order_item_id', v_oi.id, 'qty', v_qty, 'amount', v_share);
      v_amount := v_amount + v_share;

      -- Exact tax/taxable-value share of THIS refunded line, proportional to
      -- the units actually being refunded — correct even on a multi-GST-rate
      -- order, unlike a single order-level blended ratio.
      if v_oi.qty > 0 then
        v_item_cn_tax     := v_item_cn_tax
          + round(coalesce(v_oi.tax_amount, 0)::numeric * v_qty / v_oi.qty);
        v_item_cn_taxable := v_item_cn_taxable
          + round(coalesce(v_oi.taxable_value, v_oi.price * v_oi.qty)::numeric * v_qty / v_oi.qty);
      end if;
    end loop;

    v_amount := least(v_amount, v_remaining);
    if v_amount <= 0 then raise exception 'refund amount resolved to zero'; end if;

  -- ── Full / partial cash-value ────────────────────────────────────────────
  else
    v_amount := coalesce(p_amount, v_remaining);
    if v_amount <= 0 then raise exception 'refund amount must be greater than zero'; end if;
    if v_amount > v_remaining then
      raise exception 'cannot refund ₹% — only ₹% of this order remains unrefunded', v_amount, v_remaining;
    end if;
    v_kind := case when v_amount = v_order.total and v_already = 0 then 'full' else 'partial' end;
  end if;

  select refund_approval_limit into v_limit from cafes where id = v_order.cafe_id;
  if v_role = 'cashier' and v_amount > coalesce(v_limit, 500) then
    raise exception 'refunds above ₹% need a manager or owner', coalesce(v_limit, 500);
  end if;

  if v_method = 'wallet' then
    if v_order.customer_id is null then
      raise exception 'this order has no linked customer — cannot refund to a wallet';
    end if;
    if not cafe_has_feature(v_order.cafe_id, 'wallet') then
      raise exception 'the wallet feature is not enabled for this café';
    end if;
  end if;

  -- ── GST credit note (0145, exact per-line split added 0194) ─────────────
  if v_order.gst_invoice_number is not null then
    select timezone into v_tz from cafes where id = v_order.cafe_id;
    v_fy  := gst_financial_year(now(), coalesce(v_tz, 'Asia/Kolkata'));
    v_seq := claim_credit_note_number(v_order.cafe_id, v_fy);
    v_cn_number    := 'CN/' || v_fy || '/' || lpad(v_seq::text, 5, '0');
    v_cn_issued_at := now();
    if v_kind = 'item' then
      v_cn_tax     := v_item_cn_tax;
      v_cn_taxable := v_item_cn_taxable;
    else
      -- Non-itemized refund — which specific lines were "refunded" is
      -- unknown, so the order's own blended tax ratio is the best available.
      v_cn_tax     := case when v_order.total > 0
                           then round(v_order.tax::numeric * v_amount / v_order.total)::integer
                           else 0 end;
      v_cn_taxable := v_amount - v_cn_tax;
    end if;
  end if;

  insert into refunds (cafe_id, order_id, amount, method, kind, reason, refunded_by, approved_by,
                        credit_note_number, credit_note_issued_at, credit_note_taxable_value, credit_note_tax_amount)
  values (v_order.cafe_id, p_order_id, v_amount, v_method, v_kind, trim(p_reason), auth.uid(),
          case when v_role in ('owner','manager') then auth.uid() end,
          v_cn_number, v_cn_issued_at, v_cn_taxable, v_cn_tax)
  returning id into v_refund_id;

  if v_kind = 'item' then
    insert into refund_items (refund_id, order_item_id, qty, amount)
    select v_refund_id, (x->>'order_item_id')::uuid, (x->>'qty')::int, (x->>'amount')::int
      from jsonb_array_elements(v_priced) x;
  end if;

  if v_method = 'wallet' then
    perform pg_advisory_xact_lock(hashtext('wallet:' || v_order.cafe_id::text || ':' || v_order.customer_id::text));
    insert into wallet_transactions (cafe_id, customer_id, kind, amount, order_id, reason, created_by)
    values (v_order.cafe_id, v_order.customer_id, 'refund', v_amount, p_order_id,
            'Refund for order #' || v_order.short_code, auth.uid());
  end if;

  if v_already + v_amount >= v_order.total then
    update orders set payment_status = 'refunded' where id = p_order_id;
  end if;

  insert into audit_logs (cafe_id, actor_id, action, entity, entity_id, meta)
  values (v_order.cafe_id, auth.uid(), 'order.refunded', 'orders', p_order_id,
          jsonb_build_object(
            'refund_id', v_refund_id, 'amount', v_amount, 'kind', v_kind,
            'method', v_method, 'reason', trim(p_reason), 'role', v_role,
            'order_total', v_order.total, 'previously_refunded', v_already,
            'credit_note_number', v_cn_number));

  return jsonb_build_object(
    'refund_id', v_refund_id, 'amount', v_amount, 'kind', v_kind,
    'method', v_method, 'remaining', v_order.total - (v_already + v_amount),
    'credit_note_number', v_cn_number);
end $$;

-- ── Recommendations: price-snapshot + live date-filtered pairings ──────────
alter table recommendation_events add column if not exists price_snapshot integer;

create or replace function log_recommendation_event(p_cafe_id uuid, p_suggested_item_id uuid, p_kind text, p_source text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_price integer;
begin
  if p_kind not in ('impression', 'add') then return; end if;
  select price into v_price from menu_items where id = p_suggested_item_id and cafe_id = p_cafe_id;
  if v_price is null then return; end if;
  insert into recommendation_events (cafe_id, suggested_item_id, kind, source, price_snapshot)
  values (p_cafe_id, p_suggested_item_id, p_kind, nullif(trim(coalesce(p_source, '')), ''), v_price);
end $$;

create or replace function recommendation_report(p_cafe_id uuid, p_from timestamptz, p_to timestamptz)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_result jsonb;
begin
  if not has_cafe_role(p_cafe_id, array['owner','manager']::member_role[]) then
    raise exception 'not authorized';
  end if;
  if not cafe_has_feature(p_cafe_id, 'advanced_reports') then
    raise exception 'advanced reports are not available on this café''s plan';
  end if;

  select jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(row_to_json(x) order by x.added desc)
      from (
        select mi.name,
               count(*) filter (where e.kind = 'impression') as shown,
               count(*) filter (where e.kind = 'add') as added,
               case when count(*) filter (where e.kind = 'impression') > 0
                    then round(count(*) filter (where e.kind = 'add') * 100.0 / count(*) filter (where e.kind = 'impression'), 1)
                    else 0 end as conversion,
               -- Price AT THE TIME each 'add' happened — price_snapshot is
               -- only null for events logged before this column existed,
               -- where the current price is the only figure ever recorded.
               coalesce(sum(e.price_snapshot) filter (where e.kind = 'add'), 0)
                 + coalesce(count(*) filter (where e.kind = 'add' and e.price_snapshot is null), 0) * mi.price as added_sales
          from recommendation_events e
          join menu_items mi on mi.id = e.suggested_item_id
         where e.cafe_id = p_cafe_id and e.created_at >= p_from and e.created_at < p_to
         group by mi.id, mi.name, mi.price
      ) x), '[]'::jsonb),
    'top_pairings', coalesce((
      -- Computed live for THIS date range — order_pair_stats is a lifetime
      -- cache refreshed only on demand and has no per-event timestamp, so it
      -- cannot answer a date-scoped question. Same join/threshold shape
      -- refresh_order_pairings itself uses, scoped to p_from/p_to.
      select jsonb_agg(jsonb_build_object('a', a.name, 'b', b.name, 'times', s.times) order by s.times desc)
      from (
        select item_id, paired_item_id, times
        from (
          select a.menu_item_id as item_id, b.menu_item_id as paired_item_id, count(*)::int as times
            from order_items a
            join order_items b on a.order_id = b.order_id and a.menu_item_id <> b.menu_item_id
            join orders o on o.id = a.order_id
           where o.cafe_id = p_cafe_id and o.status <> 'cancelled'
             and o.created_at >= p_from and o.created_at < p_to
             and a.menu_item_id is not null and b.menu_item_id is not null
           group by a.menu_item_id, b.menu_item_id
          having count(*) >= 2
        ) raw
        where raw.item_id < raw.paired_item_id
        order by raw.times desc limit 8
      ) s join menu_items a on a.id = s.item_id join menu_items b on b.id = s.paired_item_id), '[]'::jsonb)
  ) into v_result;

  return v_result;
end $$;

-- ── self-check ───────────────────────────────────────────────────────────
do $$
begin
  if (select count(*) from pg_proc where proname = 'profitability_report') <> 1 then
    raise exception 'profitability_report: expected exactly one overload';
  end if;
  if (select count(*) from pg_proc where proname = 'refund_order') <> 1 then
    raise exception 'refund_order: expected exactly one overload';
  end if;
  if (select count(*) from pg_proc where proname = 'log_recommendation_event') <> 1 then
    raise exception 'log_recommendation_event: expected exactly one overload';
  end if;
  if (select count(*) from pg_proc where proname = 'recommendation_report') <> 1 then
    raise exception 'recommendation_report: expected exactly one overload';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_name = 'recommendation_events' and column_name = 'price_snapshot'
  ) then
    raise exception 'recommendation_events.price_snapshot missing';
  end if;
end $$;
