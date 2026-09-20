-- ============================================================================
-- 0245 — Vercel Active CPU audit (2026-09), dashboard home screen (/dashboard).
--
-- Two separate fixes, both scoped to the SERVER-SIDE load only
-- (app/dashboard/page.tsx's loadCommandCenterData, a Next.js Server
-- Component — a real Vercel function invocation). dashboard-client.tsx's own
-- 30s poll of the same shapes runs through utils/supabase/client (the
-- browser/anon client) straight to Supabase's PostgREST endpoint — it never
-- touches a Vercel function, so it's unaffected by and out of scope for this
-- migration; it keeps working exactly as before, unchanged.
--
-- FIX 1 — outstanding_summary's `unpaid` CTE built each order's amount-due
-- with a correlated subquery — `(select sum(amount) from payments p where
-- p.order_id = o.id)` — re-executed once per order row in the date range,
-- same inefficiency class as public_kds_orders (0244). Rewritten set-based:
-- filter orders to the café/range/non-cancelled set once, then a single
-- GROUP BY over payments — scoped to just those orders via a join, not the
-- whole payments table — builds every order's paid-so-far total in one pass.
-- Every field, filter and the exact "no order_id/cafe_id/date filter on the
-- payments join" semantic (an order can be marked paid by a payment made
-- after p_to; the original had no such guard either, so this rewrite adds
-- none) is preserved byte-for-byte versus 0186's definition.
--
-- FIX 2 — loadCommandCenterData separately fetched ALL of today's orders
-- (total, status) and ALL of today's payments (method, amount) as raw rows
-- with no .limit(), then summed/grouped them in JavaScript on the server —
-- for a busy café that's hundreds-to-thousands of rows pulled over the wire
-- into the serverless function on every single /dashboard visit (this page
-- is `dynamic = 'force-dynamic'`), just to compute a handful of numbers.
-- New dashboard_today_totals() RPC does the same SUM/COUNT/GROUP BY in
-- Postgres and returns one small jsonb object instead. Semantics preserved
-- exactly: orders filtered by cafe_id + created_at >= p_from + status <>
-- 'cancelled' (matching the `.neq('status','cancelled')` client filter);
-- payments filtered by cafe_id + created_at >= p_from ONLY — deliberately no
-- order_id-not-null guard, since the original JS-side query had none either
-- (unlike outstanding_summary's v_collected, which does exclude orphan
-- payments — that is a real, pre-existing difference between these two
-- money figures on the same dashboard, not something this migration
-- introduces or should "fix" by changing what's displayed).
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

  with in_range_orders as (
    select o.id, o.type, o.table_id, o.total
      from orders o
     where o.cafe_id = p_cafe_id and o.status <> 'cancelled'
       and o.created_at >= p_from and o.created_at < p_to
  ),
  paid_by_order as (
    select p.order_id, sum(p.amount) as paid
      from payments p
      join in_range_orders ro on ro.id = p.order_id
     group by p.order_id
  ),
  unpaid as (
    select ro.id, ro.type, ro.table_id,
           greatest(0, ro.total - coalesce(pbo.paid, 0)) as due
      from in_range_orders ro
      left join paid_by_order pbo on pbo.order_id = ro.id
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

-- New: replaces loadCommandCenterData's two unbounded row fetches (today's
-- orders, today's payments) with one small aggregate. Same authorization
-- shape as outstanding_summary (member-only, SECURITY DEFINER, revoked from
-- anon) since it reads the same café-scoped financial rows.
create or replace function dashboard_today_totals(p_cafe_id uuid, p_from timestamptz, p_to timestamptz)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_revenue      integer;
  v_order_count  integer;
  v_collections  jsonb;
begin
  if not is_cafe_member(p_cafe_id) then raise exception 'not authorized'; end if;

  select coalesce(sum(total), 0), count(*)
    into v_revenue, v_order_count
    from orders
   where cafe_id = p_cafe_id and created_at >= p_from and created_at < p_to
     and status <> 'cancelled';

  select coalesce(jsonb_object_agg(method, amt), '{}'::jsonb)
    into v_collections
    from (
      select method, sum(amount) as amt
        from payments
       where cafe_id = p_cafe_id and created_at >= p_from and created_at < p_to
       group by method
    ) grouped;

  return jsonb_build_object(
    'revenue', v_revenue,
    'order_count', v_order_count,
    'collections_by_method', v_collections
  );
end $$;

revoke all on function dashboard_today_totals(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function dashboard_today_totals(uuid, timestamptz, timestamptz) to authenticated;

-- ── self-check ───────────────────────────────────────────────────────────
do $$
declare v_src text;
begin
  if (select count(*) from pg_proc where proname = 'outstanding_summary') <> 1 then
    raise exception 'outstanding_summary: expected exactly one overload';
  end if;
  if (select count(*) from pg_proc where proname = 'dashboard_today_totals') <> 1 then
    raise exception 'dashboard_today_totals: expected exactly one overload';
  end if;

  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'outstanding_summary';
  if v_src ~ 'where p\.order_id = o\.id' then
    raise exception 'outstanding_summary still has the old per-row correlated subquery';
  end if;
  if v_src !~ 'group by p\.order_id' then
    raise exception 'outstanding_summary is missing the expected set-based paid-by-order aggregation';
  end if;
  if v_src !~ 'is_cafe_member\(p_cafe_id\)' then
    raise exception 'outstanding_summary lost its tenant-membership authorization check';
  end if;

  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'dashboard_today_totals';
  if v_src !~ 'is_cafe_member\(p_cafe_id\)' then
    raise exception 'dashboard_today_totals is missing the tenant-membership authorization check';
  end if;

  -- Same safe, non-mutating shape of probe used by 0186/0244: a café id that
  -- cannot possibly be a real member's café must be rejected, not silently
  -- return data for it.
  begin
    perform outstanding_summary('00000000-0000-0000-0000-000000000000'::uuid, now(), now());
    raise exception 'outstanding_summary should have rejected an unauthorized cafe_id';
  exception when others then
    if sqlerrm not like '%not authorized%' then raise; end if;
  end;
  begin
    perform dashboard_today_totals('00000000-0000-0000-0000-000000000000'::uuid, now(), now());
    raise exception 'dashboard_today_totals should have rejected an unauthorized cafe_id';
  exception when others then
    if sqlerrm not like '%not authorized%' then raise; end if;
  end;
end $$;
