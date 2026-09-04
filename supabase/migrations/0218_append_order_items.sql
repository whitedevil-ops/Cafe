-- ============================================================================
-- 0218 — Staff can add items to an already-placed order instead of always
-- starting a new bill.
--
-- Reported live: a table with 2 rounds shows as "2 active orders · bill ₹348"
-- — two fully separate orders (own bill number, own payment buttons, own
-- "Start preparing"), because the existing "Add items" button on Live Tables
-- (components/waiter/quick-add-sheet.tsx → floor-client.tsx:submitQuickAdd)
-- calls staff_place_order, which — like every caller — can only ever INSERT
-- a brand new order. There has never been a way to grow an existing one.
--
-- WHY THIS IS SAFE TO ADD, AND WHY IT STOPS WHERE IT STOPS
--
-- order_items has zero client write grants for any role (0050:55-59,
-- `revoke insert, update, delete on order_items from authenticated, anon`) —
-- so this can only ever be a new SECURITY DEFINER function; there was no
-- surface to extend via RLS/grants.
--
-- The append logic below is a DELIBERATE, PARTIAL duplication of
-- staff_place_order's item-resolution loop (0154:414-481 — offer pricing,
-- variant lookup, addon lookup), copied rather than extracted into a shared
-- helper. That is a considered choice, not an oversight: this session had
-- three separate live incidents today from EDITING an already-live, heavily
-- used function (the place_order signature-overload miss, the 0211 table-
-- delete regression, the 0215 self-check bug). staff_place_order is the
-- single most-called function in the whole schema — every order, every
-- café, right now. A new, independent function can be wrong without taking
-- that down with it. If the two ever need to be reconciled into one shared
-- core, that is a separate, lower-stakes refactor for a quieter day.
--
-- Two things are DELIBERATELY excluded from the duplicated logic, and both
-- are enforced by the eligibility guard below rather than half-supported:
--
--   REWARDS. Loyalty-reward redemption (0154:456-471,488-501) touches
--   loyalty_transactions with its own balance check and its own advisory
--   lock. Folding it into an append path doubles the surface for the exact
--   class of bug this migration exists to avoid. Not supported — staff use
--   a new order for a reward item, as today.
--
--   ANY DISCOUNT ALREADY ON THE BILL. Two real, unmitigated gaps in the
--   existing discount machinery make it unsafe to let append re-run or layer
--   onto them:
--     - resolve_coupon_discount / coupon_redemptions (0143:67-162) has NO
--       idempotency guard and NO unique constraint on order_id — calling it
--       again on an order that already redeemed a coupon inserts a SECOND
--       redemption row and silently double-counts the discount.
--     - orders.discount (0154:565-576) is a single folded rupee integer with
--       no stored record of what TYPE it was (percent vs flat) — there is no
--       way to correctly re-derive "10% of the new, bigger subtotal" from
--       what's left in the row after the fact.
--   Rather than half-solve either, appending is refused outright once the
--   order carries ANY discount, coupon, or spin prize. Staff fall back to
--   today's path (a second order) for that case — always available, never
--   removed.
--
--   GST INVOICE INTEGRITY. assign_gst_invoice_number (0037:222-246) fires
--   the instant payment_status transitions to 'paid', and nothing anywhere
--   in the schema stops the order from being mutated after that number is
--   issued — a real, previously unmitigated compliance gap. This migration
--   closes it for the append path specifically: refused once
--   gst_invoice_number is not null. (Kept as an explicit check alongside the
--   payment_status one below, even though for a GST-registered café the two
--   coincide exactly — belt and braces on the one check that is actually a
--   legal-compliance question, not just a UX one.)
--
-- CONCURRENCY: locked with the SAME advisory-lock key record_payment already
-- uses (0180: hashtext('order-payment:' || p_order_id::text)) — not a new
-- lock namespace. This makes "staff records payment" and "staff appends
-- items" on the same order mutually exclusive at the database level for
-- free, with no new coordination code, because they now contend on the same
-- lock record_payment was already taking.
--
-- WHAT NEEDED NO NEW CODE AT ALL, because it already existed and had never
-- been reachable:
--   - trg_snapshot_order_item_tax (0037, before insert on order_items) and
--     trg_deduct_stock_for_order_item (0036, after insert) are ordinary
--     table-level triggers — they fire for ANY insert into order_items,
--     this one included. Tax/HSN stamping and inventory deduction on
--     appended lines both just work.
--   - trg_orders_enqueue_kot (0027:237-242, after update on orders when
--     total changes) already exists and, via enqueue_kot_jobs' own
--     first-ticket check, already branches to build_kot_update_payload
--     (0151/0152) — a DIFF against that order's print_jobs history, emitting
--     only added/removed lines — instead of a second full ticket. 0151's own
--     header says this diff logic has been "unreachable through any real
--     staff action" since the day it shipped, because nothing could edit an
--     order's items. This migration is what finally reaches it. Calling
--     apply_order_taxes (which this function does, to recompute the total)
--     is the only trigger this needs — no new KOT plumbing at all.
--   - order_outstanding / record_payment / recompute_order_payment_status /
--     close_session all read orders.total LIVE on every call — none of them
--     assume a fixed total, so a bill that grows mid-service is already
--     handled correctly by every downstream consumer.
--
-- WHAT THIS DOES NOT BUILD (deliberately deferred, not silently dropped):
--   - No visual "these items are new" marker on the KDS/kitchen board — the
--     physical/digital KOT UPDATE ticket already tells kitchen what changed;
--     the on-screen card just shows the refreshed full list, same as today.
--   - No order-level "append log" UI beyond the audit_logs row this writes
--     (mirrors the existing order.created / order.discount_applied
--     convention) and the new order_item_appends table below, which exists
--     for idempotency and doubles as a queryable history if that UI is ever
--     built.
-- ============================================================================

-- ── idempotency + audit trail for append calls ──────────────────────────────
-- staff_place_order's own retry-safety relies on orders.client_request_id
-- being unique — that column belongs to the order's CREATION, not reusable
-- here. A second table, same shape of guarantee: a partial unique index on
-- client_request_id makes a retried append return the SAME result instead of
-- inserting the same items twice.
create table if not exists order_item_appends (
  id                 uuid primary key default gen_random_uuid(),
  order_id           uuid not null references orders(id) on delete cascade,
  cafe_id            uuid not null references cafes(id) on delete cascade,
  staff_id           uuid references profiles(id) on delete set null,
  client_request_id  uuid,
  item_ids           uuid[] not null,
  subtotal_added     integer not null,
  created_at         timestamptz not null default now()
);
create unique index if not exists order_item_appends_client_request_id_key
  on order_item_appends (client_request_id) where client_request_id is not null;
create index if not exists order_item_appends_order_idx on order_item_appends (order_id, created_at);

alter table order_item_appends enable row level security;
drop policy if exists "member read" on order_item_appends;
create policy "member read" on order_item_appends for select
  using (is_cafe_member(cafe_id));
revoke insert, update, delete on order_item_appends from authenticated, anon;

create or replace function append_order_items(
  p_order_id           uuid,
  p_items              jsonb,
  p_client_request_id  uuid default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_order         orders%rowtype;
  v_role          member_role;
  v_weekday       smallint;
  v_item          jsonb;
  v_qty           integer;
  v_id            uuid;
  v_name          text;
  v_price         integer;
  v_offer_price   integer;
  v_offer_days    integer[];
  v_unit          integer;
  v_mods          jsonb;
  v_note          text;
  v_has_variants  boolean;
  v_variant_id    uuid;
  v_vname         text;
  v_vdelta        integer;
  v_addon         text;
  v_aname         text;
  v_aprice        integer;
  v_combo_id      uuid;
  v_combo_savings integer := 0;
  v_new_item_id   uuid;
  v_new_item_ids  uuid[] := '{}';
  v_subtotal      integer;
  v_discount      integer;
  v_tax           integer;
  v_svc           integer;
  v_total         integer;
  v_subtotal_before integer;
  v_existing      record;
begin
  -- Idempotent retry: same client_request_id as an already-completed append
  -- returns that result instead of re-inserting.
  if p_client_request_id is not null then
    select oia.order_id, oia.item_ids into v_existing
      from order_item_appends oia where oia.client_request_id = p_client_request_id;
    if found then
      return (select jsonb_build_object(
        'order_id', o.id, 'subtotal', o.subtotal, 'discount', o.discount,
        'tax', o.tax, 'service_charge', o.service_charge, 'total', o.total,
        'added_item_ids', to_jsonb(v_existing.item_ids)
      ) from orders o where o.id = v_existing.order_id);
    end if;
  end if;

  -- Lock this exact order against a concurrent append or payment — same
  -- advisory-lock key record_payment already uses (0180), so the two are
  -- mutually exclusive without any new coordination.
  perform pg_advisory_xact_lock(hashtext('order-payment:' || p_order_id::text));

  select * into v_order from orders where id = p_order_id;
  if v_order.id is null then raise exception 'order not found'; end if;

  select role into v_role from cafe_members where cafe_id = v_order.cafe_id and user_id = auth.uid();
  if v_role is null then raise exception 'not authorized for this café'; end if;

  if v_order.status = 'cancelled' then
    raise exception 'this order was cancelled — place a new order instead';
  end if;
  if v_order.payment_status in ('paid', 'refunded') then
    raise exception 'this bill has already been settled — place a new order for anything further';
  end if;
  if v_order.gst_invoice_number is not null then
    raise exception 'a tax invoice has already been issued for this bill — place a new order for anything further';
  end if;
  if v_order.discount > 0 then
    raise exception 'this bill already has a discount, coupon or spin prize applied — place a new order for anything further';
  end if;
  if exists (select 1 from coupon_redemptions where order_id = p_order_id) then
    raise exception 'this bill already has a coupon applied — place a new order for anything further';
  end if;
  if exists (select 1 from spin_results where redeemed_order_id = p_order_id) then
    raise exception 'this bill already has a spin prize applied — place a new order for anything further';
  end if;

  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'no items to add';
  end if;

  select coalesce(sum(price * qty), 0) into v_subtotal_before
    from order_items where order_id = p_order_id;

  v_weekday := cafe_current_weekday(v_order.cafe_id);

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := greatest(1, coalesce((v_item->>'qty')::int, 1));

    v_combo_id := nullif(v_item->>'combo_id', '')::uuid;
    if v_combo_id is not null then
      -- Self-contained pricing (bundle price vs. sum of parts) — not the
      -- "discount already on this bill" the eligibility guard above cares
      -- about, which is opt-in staff/coupon/spin reductions to the whole
      -- order. Its savings are folded into this call's own apply_order_taxes
      -- discount argument below, exactly as staff_place_order does at
      -- creation time (0154:576).
      v_combo_savings := v_combo_savings + expand_combo_line(
        p_order_id, v_order.cafe_id, v_combo_id, coalesce(v_item->'selections', '[]'::jsonb), v_qty);
      continue;
    end if;

    select id, name, price, offer_price, offer_days
      into v_id, v_name, v_price, v_offer_price, v_offer_days
      from menu_items
      where id = (v_item->>'item_id')::uuid
        and cafe_id = v_order.cafe_id and available = true and archived = false;
    if v_id is null then raise exception 'item not available'; end if;

    v_unit := case
      when v_offer_price is not null and v_offer_days is not null and v_weekday = any(v_offer_days)
        then v_offer_price
      else v_price
    end;
    v_mods := '[]'::jsonb;

    v_has_variants := exists (select 1 from menu_item_variants where menu_item_id = v_id);
    v_variant_id := nullif(v_item->>'variant_id', '')::uuid;
    if v_has_variants and v_variant_id is null then
      raise exception 'variant required for %', v_name;
    end if;
    if v_variant_id is not null then
      select name, price_delta into v_vname, v_vdelta
        from menu_item_variants where id = v_variant_id and menu_item_id = v_id;
      if v_vname is null then raise exception 'invalid variant'; end if;
      v_unit := v_unit + v_vdelta;
      v_mods := v_mods || jsonb_build_object('name', v_vname, 'price', v_vdelta);
      v_name := v_name || ' (' || v_vname || ')';
    end if;

    if v_item ? 'addon_ids' then
      for v_addon in select jsonb_array_elements_text(v_item->'addon_ids') loop
        select name, price into v_aname, v_aprice
          from menu_item_addons where id = v_addon::uuid and menu_item_id = v_id;
        if v_aname is null then raise exception 'invalid add-on'; end if;
        v_unit := v_unit + v_aprice;
        v_mods := v_mods || jsonb_build_object('name', v_aname, 'price', v_aprice);
      end loop;
    end if;

    v_note := nullif(trim(coalesce(v_item->>'note', '')), '');

    insert into order_items (order_id, menu_item_id, name, price, qty, modifiers, instructions, variant_id)
      values (p_order_id, v_id, v_name, v_unit, v_qty, v_mods, v_note, v_variant_id)
      returning id into v_new_item_id;
    v_new_item_ids := v_new_item_ids || v_new_item_id;
  end loop;

  if array_length(v_new_item_ids, 1) is null then
    raise exception 'no items to add';
  end if;

  -- Full recompute across ALL of this order's items (original + appended) —
  -- apply_order_taxes has no "first time only" assumption (0123:452-461
  -- reads the live order_items set every call). v_combo_savings is this
  -- call's own combos only; the eligibility guard already guaranteed the
  -- order started at orders.discount = 0, so there is nothing prior to fold
  -- in or double-count.
  select t.subtotal, t.discount, t.tax, t.service_charge, t.total
    into v_subtotal, v_discount, v_tax, v_svc, v_total
    from apply_order_taxes(p_order_id, v_combo_savings) t;

  -- payment_status is recomputed here for the ordinary case (order was
  -- unpaid/partial and stays so) — record_payment/recompute_order_payment_status
  -- already read orders.total live, so this is a no-op unless a PARTIAL
  -- payment already existed, in which case it correctly stays 'partial'
  -- against the new, larger total.
  perform recompute_order_payment_status(p_order_id);

  insert into order_item_appends (order_id, cafe_id, staff_id, client_request_id, item_ids, subtotal_added)
  values (p_order_id, v_order.cafe_id, auth.uid(), p_client_request_id, v_new_item_ids, v_subtotal - v_subtotal_before);

  insert into audit_logs (cafe_id, actor_id, action, entity, entity_id, meta)
  values (v_order.cafe_id, auth.uid(), 'order.items_appended', 'orders', p_order_id,
          jsonb_build_object('item_count', array_length(v_new_item_ids, 1),
                              'subtotal_added', v_subtotal - v_subtotal_before, 'new_total', v_total));

  insert into notifications (cafe_id, type, message, table_id, session_id)
  select v_order.cafe_id, 'new_order',
         case when t.label is not null then 'Table ' || t.label || ' — ' || array_length(v_new_item_ids, 1) || ' item(s) added to order #' || v_order.short_code
              else array_length(v_new_item_ids, 1) || ' item(s) added to order #' || v_order.short_code end,
         v_order.table_id, v_order.session_id
  from (select 1) x
  left join cafe_tables t on t.id = v_order.table_id;

  return jsonb_build_object(
    'order_id', p_order_id, 'subtotal', v_subtotal, 'discount', v_discount,
    'tax', v_tax, 'service_charge', v_svc, 'total', v_total,
    'added_item_ids', to_jsonb(v_new_item_ids)
  );
exception
  when unique_violation then
    if p_client_request_id is not null then
      select order_id, item_ids into v_existing
        from order_item_appends where client_request_id = p_client_request_id;
      if found then
        return (select jsonb_build_object(
          'order_id', o.id, 'subtotal', o.subtotal, 'discount', o.discount,
          'tax', o.tax, 'service_charge', o.service_charge, 'total', o.total,
          'added_item_ids', to_jsonb(v_existing.item_ids)
        ) from orders o where o.id = v_existing.order_id);
      end if;
    end if;
    raise;
end $$;

revoke execute on function append_order_items(uuid, jsonb, uuid) from public, anon;
grant execute on function append_order_items(uuid, jsonb, uuid) to authenticated;

-- ── a guest-safe "can this order still be appended to" check, for the UI ───
-- Mirrors the guard block above exactly (same five conditions) so Live
-- Tables can show/hide "Add to this bill" without guessing — and so the
-- eligibility RULE lives in exactly one place structurally similar to it,
-- reducing the chance the UI's idea of "eligible" ever drifts from the
-- function's own enforcement.
create or replace function order_appendable(p_order_id uuid)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare v_cafe_id uuid;
begin
  select cafe_id into v_cafe_id from orders where id = p_order_id;
  if v_cafe_id is null then return false; end if;
  -- Same authorization gate every other SECURITY DEFINER reader in this
  -- schema uses (e.g. bill_detail, 0216) — without it, any authenticated
  -- staff account at ANY café could probe another café's order state.
  if not is_cafe_member(v_cafe_id) then raise exception 'not authorized'; end if;

  return (
    select
      o.status <> 'cancelled'
      and o.payment_status not in ('paid', 'refunded')
      and o.gst_invoice_number is null
      and o.discount = 0
      and not exists (select 1 from coupon_redemptions where order_id = o.id)
      and not exists (select 1 from spin_results where redeemed_order_id = o.id)
    from orders o where o.id = p_order_id
  );
end $$;

revoke execute on function order_appendable(uuid) from public, anon;
grant execute on function order_appendable(uuid) to authenticated;

-- ── self-check ─────────────────────────────────────────────────────────────
do $$
begin
  if (select count(*) from pg_proc where proname = 'append_order_items') <> 1 then
    raise exception 'append_order_items: expected exactly one overload';
  end if;
  if (select count(*) from pg_proc where proname = 'order_appendable') <> 1 then
    raise exception 'order_appendable: expected exactly one overload';
  end if;
  if not exists (select 1 from information_schema.tables where table_name = 'order_item_appends') then
    raise exception 'order_item_appends table was not created';
  end if;
  if not exists (
    select 1 from pg_indexes where tablename = 'order_item_appends' and indexname = 'order_item_appends_client_request_id_key'
  ) then
    raise exception 'order_item_appends is missing its idempotency index';
  end if;

  -- The delete guard (0211/0212) must remain exactly DELETE-scoped — this
  -- migration's whole safety case depends on it never having grown an
  -- UPDATE/INSERT trigger that would block apply_order_taxes' own writes.
  if (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid
       where c.relname in ('orders', 'order_items', 'payments')
         and t.tgname like 'trg_refuse_delete_%' and not t.tgisinternal) <> 3 then
    raise exception 'the financial delete guard (0211/0212) is not in the expected state';
  end if;

  if not has_function_privilege('authenticated', 'append_order_items(uuid, jsonb, uuid)', 'execute') then
    raise exception 'authenticated cannot execute append_order_items';
  end if;
end $$;
