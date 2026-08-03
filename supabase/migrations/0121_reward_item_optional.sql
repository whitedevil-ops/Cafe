-- ============================================================================
-- 0121 — Make the reward → menu item link optional, not required.
--
-- 0120 required every reward to name a specific menu item so redemption
-- could add a real free line to the cart/bill/kitchen. In practice this
-- forced every existing café to immediately "recreate" every reward they'd
-- already set up, and blocks a genuinely valid use case: a points-based
-- reward that isn't tied to one specific orderable item (staff hand it over
-- themselves, same as the original system).
--
-- Dual behavior going forward:
--   - Reward HAS a menu_item_id → redeeming it in POS adds a real ₹0 line to
--     the cart (0120's fix) — shows on the bill, goes to the kitchen.
--   - Reward has NO menu_item_id → redeeming it calls the original
--     standalone redeem_reward RPC (unchanged since 0064) — deducts points
--     immediately and shows a toast, exactly like before 0120. Nothing is
--     added to any order; staff hand over whatever it is themselves.
--
-- create_reward's parameter TYPE signature is unchanged from 0120
-- (uuid, text, integer, uuid, uuid) — only p_menu_item_id's default value
-- changes (required → optional), which is the same overload, not a new one,
-- so no DROP is needed here (unlike 0120, which did grow the type list).
-- ============================================================================

create or replace function create_reward(
  p_cafe_id      uuid,
  p_name         text,
  p_points_cost  integer,
  p_menu_item_id uuid default null,
  p_variant_id   uuid default null
) returns rewards
language plpgsql security definer set search_path = public as $$
declare
  v_role         member_role;
  v_row          rewards%rowtype;
  v_has_variants boolean;
begin
  select role into v_role from cafe_members where cafe_id = p_cafe_id and user_id = auth.uid();
  if v_role is null then raise exception 'not authorized for this café'; end if;
  if v_role not in ('owner', 'manager') then
    raise exception 'only an owner or manager can create rewards';
  end if;

  if p_name is null or trim(p_name) = '' then raise exception 'enter a reward name'; end if;
  if p_points_cost is null or p_points_cost <= 0 then raise exception 'points cost must be greater than 0'; end if;

  if p_menu_item_id is not null then
    if not exists (select 1 from menu_items where id = p_menu_item_id and cafe_id = p_cafe_id and archived = false) then
      raise exception 'menu item not found';
    end if;

    v_has_variants := exists (select 1 from menu_item_variants where menu_item_id = p_menu_item_id);
    if v_has_variants and p_variant_id is null then
      raise exception 'this item has sizes — pick one for the reward';
    end if;
    if p_variant_id is not null and not exists (
      select 1 from menu_item_variants where id = p_variant_id and menu_item_id = p_menu_item_id
    ) then
      raise exception 'invalid variant for this item';
    end if;
  elsif p_variant_id is not null then
    raise exception 'a variant needs an item to belong to';
  end if;

  insert into rewards (cafe_id, name, points_cost, menu_item_id, variant_id)
  values (p_cafe_id, trim(p_name), p_points_cost, p_menu_item_id, p_variant_id)
  returning * into v_row;

  return v_row;
end $$;

revoke execute on function create_reward(uuid, text, integer, uuid, uuid) from public, anon;
grant execute on function create_reward(uuid, text, integer, uuid, uuid) to authenticated;
