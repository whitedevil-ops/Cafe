-- ============================================================================
-- 0075 — Menu RBAC: the same class of gap as customers/cafe_settings (0071),
-- never closed for menu_categories/menu_items/menu_item_variants/menu_item_addons.
-- Any staff role — kitchen, waiter, cashier — could change any price or
-- delete any item directly via REST; the "owner/manager only" cost field in
-- menu-manager.tsx was a UI convention only, never enforced server-side.
--
-- Marking an item sold-out is a real, frequent, low-risk action any staff
-- member legitimately needs mid-shift — unlike price changes, it isn't worth
-- routing through owner/manager. Postgres GRANTs aren't role-conditional
-- within a single Postgres role (authenticated), so a column-scoped grant
-- can't distinguish "cashier may flip `available`" from "cashier may not
-- touch `price`". Solved the same way 0050 solved it for orders.status: a
-- narrow SECURITY DEFINER RPC is the only fine-grained, role-AND-column-aware
-- gate Postgres actually offers — set_menu_item_availability() is that gate.
-- ============================================================================

-- ── menu_categories / menu_items: writes require owner/manager ─────────────
do $$
declare t text;
begin
  foreach t in array array['menu_categories', 'menu_items']
  loop
    execute format('drop policy if exists "member all" on %I;', t);
    execute format('create policy "member read" on %I for select using (is_cafe_member(cafe_id));', t);
    execute format(
      'create policy "owner manage" on %I for insert with check (has_cafe_role(cafe_id, array[''owner'',''manager'']::member_role[]));', t);
    execute format(
      'create policy "owner manage u" on %I for update using (has_cafe_role(cafe_id, array[''owner'',''manager'']::member_role[]));', t);
    execute format(
      'create policy "owner manage d" on %I for delete using (has_cafe_role(cafe_id, array[''owner'',''manager'']::member_role[]));', t);
    -- "public read" (anon) policy from schema.sql is untouched — the QR menu
    -- keeps working exactly as before.
  end loop;
end $$;

-- ── menu_item_variants / menu_item_addons: same treatment ──────────────────
-- These key off the parent item's cafe via join, not a direct cafe_id column.
drop policy if exists "member all" on menu_item_variants;
create policy "member read" on menu_item_variants for select using (
  exists (select 1 from menu_items mi where mi.id = menu_item_id and is_cafe_member(mi.cafe_id)));
create policy "owner manage" on menu_item_variants for insert with check (
  exists (select 1 from menu_items mi where mi.id = menu_item_id and has_cafe_role(mi.cafe_id, array['owner','manager']::member_role[])));
create policy "owner manage u" on menu_item_variants for update using (
  exists (select 1 from menu_items mi where mi.id = menu_item_id and has_cafe_role(mi.cafe_id, array['owner','manager']::member_role[])));
create policy "owner manage d" on menu_item_variants for delete using (
  exists (select 1 from menu_items mi where mi.id = menu_item_id and has_cafe_role(mi.cafe_id, array['owner','manager']::member_role[])));

drop policy if exists "member all" on menu_item_addons;
create policy "member read" on menu_item_addons for select using (
  exists (select 1 from menu_items mi where mi.id = menu_item_id and is_cafe_member(mi.cafe_id)));
create policy "owner manage" on menu_item_addons for insert with check (
  exists (select 1 from menu_items mi where mi.id = menu_item_id and has_cafe_role(mi.cafe_id, array['owner','manager']::member_role[])));
create policy "owner manage u" on menu_item_addons for update using (
  exists (select 1 from menu_items mi where mi.id = menu_item_id and has_cafe_role(mi.cafe_id, array['owner','manager']::member_role[])));
create policy "owner manage d" on menu_item_addons for delete using (
  exists (select 1 from menu_items mi where mi.id = menu_item_id and has_cafe_role(mi.cafe_id, array['owner','manager']::member_role[])));

-- ── The one carve-out: any staff can mark an item sold-out / back in stock ──
create or replace function set_menu_item_availability(p_item_id uuid, p_available boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_cafe_id uuid;
begin
  select cafe_id into v_cafe_id from menu_items where id = p_item_id;
  if v_cafe_id is null then raise exception 'item not found'; end if;
  if not is_cafe_member(v_cafe_id) then raise exception 'not authorized for this café'; end if;

  update menu_items set available = p_available where id = p_item_id;
end $$;

revoke execute on function set_menu_item_availability(uuid, boolean) from public, anon;
grant execute on function set_menu_item_availability(uuid, boolean) to authenticated;
