-- ============================================================================
-- Full-audit finding: outstanding_summary (the source of the café owner's
-- home dashboard "Collected" figure) sums ALL payments rows in the date
-- range with no `order_id is not null` guard. list_bills' own "paid" figure
-- is safe from this — it's a per-order correlated subquery keyed on
-- `pay.order_id = o.id`, so an order_id-less row can never match any real
-- order — but outstanding_summary's v_collected is a plain, uncorrelated
-- sum across the whole payments table for the café/range.
--
-- Live-found: 7 real payments rows in the production database with
-- order_id = null (an abandoned split-bill attempt, all labeled "Equal
-- split N/7", totaling ₹1,056) — the same order was then paid normally a
-- few seconds later via one properly order_id-linked payment. outstanding_
-- summary for that day reported "Collected" ₹1,056 higher than what was
-- actually linked to real orders. Could not reproduce fresh orphan rows via
-- the current live record_session_payment RPC (every split-payment call
-- correctly produced an order_id-linked row), so this looks like a one-off
-- historical incident rather than an actively reproducible bug in current
-- code — but the aggregate itself has no defense if one is ever created
-- again by any future code path.
-- ============================================================================

create or replace function outstanding_summary(p_cafe_id uuid, p_from timestamptz, p_to timestamptz)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_collected integer;
  v_refunded  integer;
  v_out       integer;
  v_orders    integer;
  v_tables    integer;
  v_dine      integer;
  v_take      integer;
begin
  if not is_cafe_member(p_cafe_id) then raise exception 'not authorized'; end if;

  select coalesce(sum(amount), 0) into v_collected
    from payments
   where cafe_id = p_cafe_id and order_id is not null
     and created_at >= p_from and created_at < p_to;

  select coalesce(sum(amount), 0) into v_refunded
    from refunds where cafe_id = p_cafe_id and status = 'completed'
      and created_at >= p_from and created_at < p_to;

  with unpaid as (
    select o.id, o.type, o.table_id,
           greatest(0, o.total - coalesce((select sum(amount) from payments p where p.order_id = o.id), 0)) as due
      from orders o
     where o.cafe_id = p_cafe_id and o.status <> 'cancelled'
       and o.created_at >= p_from and o.created_at < p_to
  )
  select coalesce(sum(due), 0),
         count(*) filter (where due > 0),
         count(distinct table_id) filter (where due > 0 and table_id is not null),
         coalesce(sum(due) filter (where type = 'dine_in'), 0),
         coalesce(sum(due) filter (where type = 'takeaway'), 0)
    into v_out, v_orders, v_tables, v_dine, v_take from unpaid;

  return jsonb_build_object(
    'collected', v_collected, 'refunded', v_refunded,
    'outstanding', v_out, 'unpaid_orders', v_orders, 'unpaid_tables', v_tables,
    'unpaid_dine_in', v_dine, 'unpaid_takeaway', v_take);
end $$;

revoke execute on function outstanding_summary(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function outstanding_summary(uuid, timestamptz, timestamptz) to authenticated;

-- ── self-check ───────────────────────────────────────────────────────────
do $$
begin
  if (select count(*) from pg_proc where proname = 'outstanding_summary') <> 1 then
    raise exception 'outstanding_summary: expected exactly one overload';
  end if;
end $$;
