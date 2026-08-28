-- ============================================================================
-- Full-audit finding, high: "Add Inventory Item" has been completely broken
-- for every café, on every plan, since migration 0050. That migration
-- correctly revoked direct insert/update/delete on inventory_items (moving
-- writes to audited RPCs, matching the same treatment given to payments/
-- expenses/inventory_transactions/loyalty_accounts/loyalty_transactions in
-- the same pass) -- but no replacement RPC for CREATING a new item was ever
-- written. record_inventory_movement and create_purchase_order (0166) only
-- UPDATE current_stock on an EXISTING row. inventory-client.tsx's "Add item"
-- button still does a raw `.insert()`, which has returned a raw Postgres
-- 42501 permission-denied error on every attempt since 0050 landed.
--
-- Live-verified: signed in as the real owner of both available test cafés,
-- the exact insert inventory-client.tsx performs fails identically on both
-- (trial and starter plans). Currently zero live-customer impact only
-- because no café in the production database is on the 'business' plan that
-- gates the whole inventory feature -- but the feature has been 100% broken
-- at its very first step the entire time, not merely incomplete.
--
-- Fixed with a new RPC, gated by role (owner/manager, matching create_supplier's
-- exact pattern) AND cafe_has_feature('inventory') -- unlike create_supplier/
-- receive_purchase_order_items/cancel_purchase_order/set_supplier_active,
-- which the same audit found are ALSO missing the entitlement check (a
-- separate, still-open medium-severity finding, not fixed here to keep this
-- change scoped to the one completely-broken action).
-- ============================================================================

create or replace function create_inventory_item(
  p_cafe_id  uuid,
  p_name     text,
  p_unit     text default 'unit',
  p_sku      text default null,
  p_min_stock numeric default 0,
  p_cost     integer default null,
  p_supplier text default null
) returns inventory_items
language plpgsql security definer set search_path = public as $$
declare
  v_role member_role;
  v_row  inventory_items%rowtype;
begin
  select role into v_role from cafe_members where cafe_id = p_cafe_id and user_id = auth.uid();
  if v_role is null then raise exception 'not authorized for this café'; end if;
  if v_role not in ('owner', 'manager') then raise exception 'only an owner or manager can add inventory items'; end if;
  if not cafe_has_feature(p_cafe_id, 'inventory') then
    raise exception 'inventory is not available on this café''s plan';
  end if;
  if p_name is null or trim(p_name) = '' then raise exception 'item name is required'; end if;
  if p_min_stock < 0 then raise exception 'minimum stock cannot be negative'; end if;
  if p_cost is not null and p_cost < 0 then raise exception 'cost cannot be negative'; end if;

  insert into inventory_items (cafe_id, name, sku, unit, min_stock, cost, supplier)
  values (
    p_cafe_id, trim(p_name), nullif(trim(coalesce(p_sku, '')), ''),
    coalesce(nullif(trim(p_unit), ''), 'unit'), p_min_stock, p_cost, nullif(trim(coalesce(p_supplier, '')), '')
  )
  returning * into v_row;

  return v_row;
end $$;

revoke execute on function create_inventory_item(uuid, text, text, text, numeric, integer, text) from public, anon;
grant execute on function create_inventory_item(uuid, text, text, text, numeric, integer, text) to authenticated;

-- ── self-check ───────────────────────────────────────────────────────────
do $$
begin
  if (select count(*) from pg_proc where proname = 'create_inventory_item') <> 1 then
    raise exception 'create_inventory_item: expected exactly one overload';
  end if;
end $$;
