-- ============================================================================
-- 0035 — Inventory: a trusted write path for stock movements, on top of
-- tables that already exist (inventory_items, inventory_transactions,
-- schema.sql — confirmed live via anon-key probe before writing this, after
-- Phase 6's schema.sql-mismatch lesson). No new tables here.
--
-- THE GAP THIS CLOSES: inventory_items.current_stock is a stored column,
-- separate from the inventory_transactions ledger — and the table's
-- existing RLS ("member all", is_cafe_member) lets any authenticated member
-- UPDATE any column directly, including current_stock, with no ledger entry
-- at all. That's the exact anti-pattern this project's own schema.sql
-- header explicitly warns against for loyalty points: "balance is DERIVED
-- from an append-only ledger, never hand-edited." Inventory had the same
-- exposure, just never actually used by any app code until this phase.
-- Closed two ways: a function that updates both atomically, and a
-- column-level privilege revoke so a direct client UPDATE of current_stock
-- is rejected by Postgres itself, not just discouraged by convention.
-- ============================================================================

-- Table-level UPDATE (granted to authenticated by Supabase's project
-- defaults, not by an explicit grant in schema.sql) still allows updating
-- name/sku/unit/min_stock/cost/supplier directly — those are static
-- item info, not a derived running total, so direct edits are fine and
-- already covered by the existing RLS policy. Only current_stock is
-- pulled out of that.
revoke update (current_stock) on inventory_items from authenticated;

create or replace function record_inventory_movement(
  p_cafe_id uuid,
  p_item_id uuid,
  p_delta   numeric,
  p_reason  text
) returns numeric
language plpgsql security definer set search_path = public as $$
declare
  v_new_stock numeric;
begin
  if not is_cafe_member(p_cafe_id) then
    raise exception 'not authorized';
  end if;
  if p_delta = 0 then
    raise exception 'delta must be non-zero';
  end if;
  if p_reason is null or trim(p_reason) = '' then
    raise exception 'a reason is required for every stock movement';
  end if;

  -- Row-locked so two concurrent movements on the same item (a delivery
  -- logged at the same moment wastage is recorded) serialize correctly
  -- instead of one silently overwriting the other's stock update.
  update inventory_items
    set current_stock = current_stock + p_delta
    where id = p_item_id and cafe_id = p_cafe_id
    returning current_stock into v_new_stock;

  if v_new_stock is null then
    raise exception 'inventory item not found for this café';
  end if;

  insert into inventory_transactions (cafe_id, item_id, delta, reason)
  values (p_cafe_id, p_item_id, p_delta, p_reason);

  return v_new_stock;
end $$;

revoke execute on function record_inventory_movement(uuid, uuid, numeric, text) from public, anon;
grant execute on function record_inventory_movement(uuid, uuid, numeric, text) to authenticated;

-- ── low_stock_items: current_stock < min_stock, the one question Phase 10
-- will need answered — trivial once this exists, so building it here means
-- Phase 10 is very likely UI-only, no new schema. security definer with the
-- same authorization check as every other cross-row aggregation function.
create or replace function low_stock_items(p_cafe_id uuid)
returns table(id uuid, name text, unit text, current_stock numeric, min_stock numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_cafe_member(p_cafe_id) then
    raise exception 'not authorized';
  end if;
  return query
    select i.id, i.name, i.unit, i.current_stock, i.min_stock
    from inventory_items i
    where i.cafe_id = p_cafe_id and i.current_stock < i.min_stock
    order by (i.min_stock - i.current_stock) desc;
end $$;

revoke execute on function low_stock_items(uuid) from public, anon;
grant execute on function low_stock_items(uuid) to authenticated;
