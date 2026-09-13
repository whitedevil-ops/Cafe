-- ============================================================================
-- 0243 — HIGH: expand_combo_line silently completes a sale for a combo whose
-- components have all been deleted. Found by a final production-readiness
-- pass, confirmed by two independent adversarial re-checks.
--
-- combo_slots.menu_item_id/category_id are both `on delete cascade` from
-- menu_items/menu_categories (0123), and the menu editor's item/category
-- delete has no awareness of combos referencing them (fixed separately —
-- see the new confirm-dialog warning in app/dashboard/menu/menu-manager.tsx).
-- If every slot of a combo is eventually removed this way, the combo row
-- itself is untouched (still `active = true`) and stays purchasable in the
-- QR menu, POS, and combo-picker UIs, whose own "is this combo complete"
-- checks are vacuously true when there are zero choice slots. A guest can
-- tap "Add to cart · ₹199" for that combo; expand_combo_line's `for v_slot
-- in select * from combo_slots where combo_id = p_combo_id` loop then runs
-- zero times, v_parts stays 0, and it returns discount 0 having inserted no
-- order_items at all — the order completes successfully with that combo
-- contributing nothing to the bill or the kitchen ticket, while the guest
-- believed they ordered and paid for something real.
--
-- This is the one sub-case of the "combo references a deleted item"
-- family that's cleanly and safely detectable at the database level (a
-- combo with a nonzero price but zero remaining slots is unambiguously
-- broken, unlike a PARTIALLY emptied combo, which has no reliable way to
-- know how many slots it was "supposed" to have once a row is gone —
-- that half is mitigated by the new UI warning at deletion time instead).
-- Refusing the sale outright here is the hard backstop for the worst
-- outcome; it does not change behavior for any combo that still has at
-- least one slot.
-- ============================================================================

create or replace function expand_combo_line(
  p_order_id   uuid,
  p_cafe_id    uuid,
  p_combo_id   uuid,
  p_selections jsonb,
  p_qty        integer
) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_combo        combos%rowtype;
  v_slot         record;
  v_pick         record;
  v_group        uuid := gen_random_uuid();
  v_parts        integer := 0;
  v_qty          integer := greatest(1, coalesce(p_qty, 1));
  v_sel_count    integer;
  v_slot_count   integer;
  v_item_id      uuid;
  v_name         text;
  v_price        integer;
  v_unit         integer;
  v_mods         jsonb;
  v_vname        text;
  v_vdelta       integer;
  v_has_variants boolean;
  v_line_qty     integer;
begin
  select * into v_combo from combos where id = p_combo_id and cafe_id = p_cafe_id;
  if v_combo.id is null then raise exception 'combo not found'; end if;
  if not v_combo.active then raise exception 'combo "%" is no longer available', v_combo.name; end if;

  select count(*) into v_slot_count from combo_slots where combo_id = p_combo_id;
  if v_slot_count = 0 then
    raise exception 'combo "%" has no items configured — contact the café', v_combo.name;
  end if;

  for v_slot in select * from combo_slots where combo_id = p_combo_id order by sort, id loop
    if v_slot.kind = 'fixed' then
      select mi.id, mi.name, mi.price into v_item_id, v_name, v_price
        from menu_items mi
       where mi.id = v_slot.menu_item_id and mi.cafe_id = p_cafe_id
         and mi.available = true and mi.archived = false;
      if v_item_id is null then
        raise exception '% is not available right now', v_slot.label;
      end if;

      v_unit := v_price;
      v_mods := '[]'::jsonb;
      if v_slot.variant_id is not null then
        select name, price_delta into v_vname, v_vdelta
          from menu_item_variants where id = v_slot.variant_id and menu_item_id = v_item_id;
        if v_vname is null then raise exception 'invalid size on "%"', v_slot.label; end if;
        v_unit := v_unit + v_vdelta;
        v_mods := v_mods || jsonb_build_object('name', v_vname, 'price', v_vdelta);
        v_name := v_name || ' (' || v_vname || ')';
      end if;

      v_line_qty := v_slot.qty * v_qty;
      insert into order_items (order_id, menu_item_id, name, price, qty, modifiers, variant_id, combo_id, combo_group)
      values (p_order_id, v_item_id, v_name, v_unit, v_line_qty, v_mods, v_slot.variant_id, p_combo_id, v_group);
      v_parts := v_parts + v_unit * v_line_qty;

    else
      select count(*) into v_sel_count
        from jsonb_array_elements(coalesce(p_selections, '[]'::jsonb)) s
       where nullif(s->>'slot_id', '')::uuid = v_slot.id;
      if v_sel_count <> v_slot.qty then
        raise exception 'pick % option(s) for "%"', v_slot.qty, v_slot.label;
      end if;

      -- Identical picks within one slot collapse into a single line, so
      -- "any four mojito" all-the-same reads as "4 × Mint Mojito" on the
      -- kitchen ticket rather than four separate one-off rows.
      for v_pick in
        select nullif(s->>'item_id', '')::uuid    as item_id,
               nullif(s->>'variant_id', '')::uuid as variant_id,
               count(*)::int                      as picks
          from jsonb_array_elements(coalesce(p_selections, '[]'::jsonb)) s
         where nullif(s->>'slot_id', '')::uuid = v_slot.id
         group by 1, 2
      loop
        select mi.id, mi.name, mi.price into v_item_id, v_name, v_price
          from menu_items mi
         where mi.id = v_pick.item_id and mi.cafe_id = p_cafe_id
           and mi.category_id = v_slot.category_id
           and mi.available = true and mi.archived = false;
        if v_item_id is null then
          raise exception 'that choice is not available for "%"', v_slot.label;
        end if;

        v_unit := v_price;
        v_mods := '[]'::jsonb;

        v_has_variants := exists (select 1 from menu_item_variants where menu_item_id = v_item_id);
        if v_has_variants and v_pick.variant_id is null then
          raise exception 'choose a size for %', v_name;
        end if;
        if v_pick.variant_id is not null then
          select name, price_delta into v_vname, v_vdelta
            from menu_item_variants where id = v_pick.variant_id and menu_item_id = v_item_id;
          if v_vname is null then raise exception 'invalid size for %', v_name; end if;
          v_unit := v_unit + v_vdelta;
          v_mods := v_mods || jsonb_build_object('name', v_vname, 'price', v_vdelta);
          v_name := v_name || ' (' || v_vname || ')';
        end if;

        v_line_qty := v_pick.picks * v_qty;
        insert into order_items (order_id, menu_item_id, name, price, qty, modifiers, variant_id, combo_id, combo_group)
        values (p_order_id, v_item_id, v_name, v_unit, v_line_qty, v_mods, v_pick.variant_id, p_combo_id, v_group);
        v_parts := v_parts + v_unit * v_line_qty;
      end loop;
    end if;
  end loop;

  -- A combo priced ABOVE its parts never produces a negative discount.
  return greatest(0, v_parts - v_combo.price * v_qty);
end $$;

revoke execute on function expand_combo_line(uuid, uuid, uuid, jsonb, integer) from public, anon, authenticated;

-- ── self-check ───────────────────────────────────────────────────────────
do $$
declare v_src text;
begin
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'expand_combo_line';
  if v_src !~ 'has no items configured' then
    raise exception 'expand_combo_line was not patched with the empty-combo guard';
  end if;
  if (select count(*) from pg_proc where proname = 'expand_combo_line') <> 1 then
    raise exception 'expand_combo_line: expected exactly one overload';
  end if;
end $$;
