-- ============================================================================
-- Full-audit finding: the public, unattended kitchen display (/kds/[slug]) has
-- shown ZERO orders in production. orders' only SELECT policy ("member read")
-- is `using (is_cafe_member(cafe_id))`, which needs auth.uid() -- but this
-- screen is DELIBERATELY unauthenticated ("station display, not staff login",
-- per REAL_CAFE_PILOT_CHECKLIST.md's own device table), so auth.uid() is
-- always null here and the policy always evaluates false. Confirmed live:
-- GET /api/orders?slug=brewora returned {"orders":[]} while the real pilot
-- café had 27 genuine open orders sitting in 'placed' status, some over 4
-- hours old.
--
-- The "Done" button was separately broken, for two stacked reasons: (1)
-- kds-client.tsx sent {status:'done'}, a stale value from lib/types.ts's
-- legacy OrderStatus enum that predates the current order_status enum
-- (placed/accepted/preparing/ready/served/completed/cancelled) -- rejected
-- with 400 regardless of anything else; (2) even a valid status would have
-- hit 401, since PATCH /api/orders/[id] correctly requires a signed-in
-- session -- a deliberate, earlier F-01 security fix -- which this
-- no-login screen was never meant to carry.
--
-- Fix: two narrowly-scoped SECURITY DEFINER RPCs, granted to anon, returning
-- only what a kitchen board needs -- no totals, no customer PII, no payment
-- detail beyond a plain paid/unpaid flag, no ability to touch anything but
-- status/done_at on an order already confirmed to belong to the café resolved
-- from the slug. This is not a return to F-01's broad-anon-select design.
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

  select coalesce(jsonb_agg(jsonb_build_object(
    'order_id', o.id,
    'short_code', o.short_code,
    'created_at', o.created_at,
    'table_label', coalesce(t.label, '—'),
    'paid', o.payment_status = 'paid',
    'items', (
      select coalesce(jsonb_agg(jsonb_build_object('id', oi.id, 'qty', oi.qty, 'name', oi.name) order by oi.id), '[]'::jsonb)
      from order_items oi where oi.order_id = o.id
    )
  ) order by o.created_at asc), '[]'::jsonb)
  into v_result
  from orders o
  left join cafe_tables t on t.id = o.table_id
  where o.cafe_id = v_cafe_id
    and o.status in ('placed', 'accepted', 'preparing', 'ready');

  return v_result;
end $$;

revoke all on function public_kds_orders(text) from public, authenticated;
grant execute on function public_kds_orders(text) to anon;

create or replace function public_kds_advance_order(p_slug text, p_order_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_cafe_id uuid;
begin
  select id into v_cafe_id from cafes where slug = p_slug;
  if v_cafe_id is null then raise exception 'café not found'; end if;

  update orders
  set status = 'completed', done_at = now()
  where id = p_order_id
    and cafe_id = v_cafe_id
    and status in ('placed', 'accepted', 'preparing', 'ready', 'served');

  if not found then
    raise exception 'order not found, or not open, for this café';
  end if;
end $$;

revoke all on function public_kds_advance_order(text, uuid) from public, authenticated;
grant execute on function public_kds_advance_order(text, uuid) to anon;

-- ── self-check ───────────────────────────────────────────────────────────
do $$
begin
  if (select count(*) from pg_proc where proname = 'public_kds_orders') <> 1 then
    raise exception 'public_kds_orders: expected exactly one overload';
  end if;
  if (select count(*) from pg_proc where proname = 'public_kds_advance_order') <> 1 then
    raise exception 'public_kds_advance_order: expected exactly one overload';
  end if;
  -- A nonexistent slug must return an empty list, not an error, and a
  -- nonexistent order must raise -- proving both functions actually run.
  if public_kds_orders('this-slug-does-not-exist-audit-probe') <> '[]'::jsonb then
    raise exception 'public_kds_orders did not return [] for an unknown slug';
  end if;
  begin
    perform public_kds_advance_order('this-slug-does-not-exist-audit-probe', gen_random_uuid());
    raise exception 'public_kds_advance_order should have raised for an unknown café';
  exception when others then
    if sqlerrm not like '%café not found%' then raise; end if;
  end;
end $$;
