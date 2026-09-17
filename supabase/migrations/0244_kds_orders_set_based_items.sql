-- ============================================================================
-- 0244 — Vercel Active CPU audit (2026-09): public_kds_orders (0178, entitlement
-- gate added by 0237) built each order's `items` array with a CORRELATED
-- subquery — `(select ... from order_items oi where oi.order_id = o.id)`
-- inside the jsonb_build_object for every row of the outer orders scan. That
-- re-executes the subplan once per open order rather than once total, and
-- this RPC is the single highest-frequency Vercel serverless endpoint in the
-- app: /kds/[slug] polls it every 2 seconds from an unattended kitchen
-- tablet, often for a full 10+ hour shift.
--
-- Rewritten set-based: a CTE narrows to this café's open orders first (using
-- the existing orders_cafe_status_created_idx from 0200), then a single
-- GROUP BY over order_items — scoped to just those orders via a join, not
-- the whole table — builds every order's item list in one pass (using the
-- existing order_items_order_id_idx, also from 0200), and the final select
-- is a plain left join. Same two indexes this RPC already relied on; no
-- schema change, no new index.
--
-- Every field, value, filter, and ordering below is byte-for-byte identical
-- to 0237's definition — confirmed by running both versions against live
-- café data (Brewora, FEAR & FEAST) before and after and diffing the JSON.
-- This migration touches ONLY the internal query shape of public_kds_orders;
-- public_kds_advance_order and every other function are untouched.
-- ============================================================================

create or replace function public_kds_orders(p_slug text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_cafe_id uuid;
  v_result jsonb;
begin
  select id into v_cafe_id from cafes where slug = p_slug;
  if v_cafe_id is null then return '[]'::jsonb; end if;
  if not cafe_feature_for_guest(v_cafe_id, 'kds') then return '[]'::jsonb; end if;

  with open_orders as (
    select o.id, o.short_code, o.created_at, o.payment_status, o.table_id
    from orders o
    where o.cafe_id = v_cafe_id
      and o.status in ('placed', 'accepted', 'preparing', 'ready')
  ),
  items_by_order as (
    select oi.order_id,
           jsonb_agg(jsonb_build_object('id', oi.id, 'qty', oi.qty, 'name', oi.name) order by oi.id) as items
    from order_items oi
    join open_orders oo on oo.id = oi.order_id
    group by oi.order_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'order_id', oo.id,
    'short_code', oo.short_code,
    'created_at', oo.created_at,
    'table_label', coalesce(t.label, '—'),
    'paid', oo.payment_status = 'paid',
    'items', coalesce(ib.items, '[]'::jsonb)
  ) order by oo.created_at asc), '[]'::jsonb)
  into v_result
  from open_orders oo
  left join cafe_tables t on t.id = oo.table_id
  left join items_by_order ib on ib.order_id = oo.id;

  return v_result;
end $$;

-- Grants are unchanged from 0178/0237 (anon only) — restated defensively
-- since create or replace does not reliably preserve grants across Postgres
-- versions and this repo's own migrations restate them for exactly that
-- reason elsewhere.
revoke all on function public_kds_orders(text) from public, authenticated;
grant execute on function public_kds_orders(text) to anon;

-- ── self-check ───────────────────────────────────────────────────────────
do $$
declare v_src text;
begin
  if (select count(*) from pg_proc where proname = 'public_kds_orders') <> 1 then
    raise exception 'public_kds_orders: expected exactly one overload';
  end if;

  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'public_kds_orders';

  -- The entitlement gate 0237 added must survive this rewrite.
  if v_src !~ 'cafe_feature_for_guest\(v_cafe_id, ''kds''\)' then
    raise exception 'public_kds_orders is missing the kds entitlement check';
  end if;

  -- The whole point of this migration: no more per-row correlated subquery
  -- keyed off the outer order id (the 0178/0237 pattern was a bare
  -- "where oi.order_id = o.id" with no join/group in sight). A join-based
  -- rewrite is expected to mention order_items alongside "group by" instead.
  if v_src ~ 'where oi\.order_id = o\.id' then
    raise exception 'public_kds_orders still has the old per-row correlated subquery';
  end if;
  if v_src !~ 'group by oi\.order_id' then
    raise exception 'public_kds_orders is missing the expected set-based items aggregation';
  end if;

  -- Same safe, non-mutating probes 0178 itself used: an unknown slug must
  -- still return an empty list rather than erroring.
  if public_kds_orders('this-slug-does-not-exist-audit-probe') <> '[]'::jsonb then
    raise exception 'public_kds_orders did not return [] for an unknown slug';
  end if;
end $$;
