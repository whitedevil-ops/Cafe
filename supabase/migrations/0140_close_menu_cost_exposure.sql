-- ============================================================================
-- 0140 — CRITICAL: menu_items.cost/cost_source and menu_item_variants.cost_delta
--        (a café's internal food-cost data) were readable by anon — anyone,
--        no login required — via a direct PostgREST call. menu_item_variants
--        and menu_item_addons also had a second, worse bug: a stale RLS
--        policy that gave every OTHER café's staff account read access too,
--        not just the public. menu_item_effective_cost() could be called
--        directly by any authenticated user against any café's item.
--
-- CONFIRMED BY A 12-AGENT AUDIT WITH INDEPENDENT ADVERSARIAL RE-VERIFICATION.
--
-- BUG 1 — menu_items.cost / menu_items.cost_source (added 0052)
-- menu_items carries `create policy "public read" on menu_items for select
-- to anon using (true)` (schema.sql:460) — correctly scoped to anon only,
-- and deliberately wide (a café's public menu genuinely is public). What was
-- never scoped is the COLUMN grant: supabase/00-reset.sql runs `alter
-- default privileges in schema public grant all on tables to anon,
-- authenticated`, which auto-grants every column of every table — including
-- ones added years later — to anon. 0052 added `cost`/`cost_source` without
-- ever revoking them from that blanket grant. Net effect: any anonymous
-- caller could run
--   GET /rest/v1/menu_items?select=id,name,cost,cost_source
-- against ANY café's menu and read owner-entered manual food costs directly.
-- This is the exact same trap this repo already hit for cafes (0049),
-- cafe_tables.token (0132→0133), and cafe_settings/customers (0071/0172-3):
-- "a column-level REVOKE cannot subtract from a blanket table-level GRANT" —
-- the fix has to drop the table grant first, then grant back only the
-- columns the public surface actually needs.
--
-- BUG 2 — menu_item_variants.cost_delta (added 0106), worse in kind
-- 0001 created BOTH `"member all"` (is_cafe_member) and a second, separate
-- `"public read" on menu_item_variants for select using (true)` policy —
-- note: no `to anon` clause, so it applies to EVERY role, authenticated
-- included. 0075 (menu RBAC) replaced "member all" with a properly-scoped
-- "member read" + owner-only write policies, but never touched or dropped
-- the older "public read" — so it has stayed live, unconditionally granting
-- every role SELECT on every row of every café's variants, this whole time.
-- Because Postgres RLS lets a row through if ANY applicable policy passes,
-- that leftover policy makes 0075's own "member read" scoping moot: a
-- signed-in staff account at Café A could read Café B's variant cost_delta
-- (or any café's, at all), same for a totally anonymous caller. Same root
-- cause and same fix shape as 0133's cafe_tables fix: scope the stale policy
-- to `anon` only (0075's own "member read" already correctly serves
-- authenticated members), then, for anon, drop the blanket column grant and
-- grant back only the columns the public QR menu actually reads (confirmed
-- against lib/menu-cache.ts:71, which selects only id/menu_item_id/name/
-- price_delta — never cost_delta).
--
-- menu_item_addons carries the identical leftover-policy bug (0001, never
-- dropped by 0075) but no cost column was ever added to it — so its fix here
-- is the row-policy role-scoping only, no column grant change needed.
--
-- BUG 3 — menu_item_effective_cost(p_menu_item_id, p_variant_id)
-- SECURITY DEFINER, `grant execute ... to authenticated` (0106:72), with NO
-- authorization check in its body at all — any signed-in user could call it
-- directly with any menu_item_id from any café and read that café's computed
-- effective cost (manual OR recipe-derived). Unlike apply_order_taxes /
-- resolve_coupon_discount, this one has exactly one genuine external caller —
-- app/dashboard/menu/menu-manager.tsx:417, the owner/manager cost-preview
-- while editing an item — so the apply_order_taxes-style "revoke entirely"
-- fix does not apply here; there IS a real authenticated caller.
--
-- Split into two functions, mirroring the internal-helper/checked-wrapper
-- shape this codebase already uses (expand_combo_line internal vs.
-- validate_coupon/create_coupon checked, apply_order_taxes internal vs. the
-- order engines that call it): menu_item_effective_cost_internal holds the
-- unchanged computation and is never directly callable by anyone;
-- menu_item_effective_cost becomes a thin wrapper that resolves the item's
-- own café and requires is_cafe_member before delegating to it. The
-- snapshot_order_item_tax trigger — which needs to compute cost during an
-- anonymous customer's QR order, where there is no membership to check —
-- is repointed at the internal function directly, so it is unaffected by
-- the new check. This is deliberately NOT "if auth.uid() is not null then
-- check" bolted onto the one function — that shape was explicitly rejected
-- elsewhere in this pass as an insufficient, easy-to-misread guard.
-- ============================================================================

-- ── BUG 1: menu_items — anon keeps every public menu column, loses cost ────
revoke select on menu_items from anon;

grant select (
  id, cafe_id, category_id, name, description, price, tax_percent, image_url,
  available, is_veg, is_vegan, is_bestseller, is_spicy, prep_minutes, sort,
  is_upsell, upsell_pitch, archived, created_at, hsn_sac
) on menu_items to anon;

-- ── BUG 2a: menu_item_variants — kill the stale cross-role policy, scope
--     the public-read policy to anon, strip cost_delta from anon's columns ──
drop policy if exists "public read" on menu_item_variants;
create policy "public read" on menu_item_variants for select to anon using (true);

-- Normalise: RLS ("member read", 0075) is what scopes rows for authenticated
-- now that the stale blanket policy is gone; keep the table-level grant so
-- `select('*')` in menu-manager.tsx keeps returning every column it may read.
grant select on menu_item_variants to authenticated;

revoke select on menu_item_variants from anon;
grant select (id, menu_item_id, name, price_delta, sort) on menu_item_variants to anon;

-- ── BUG 2b: menu_item_addons — same leftover policy, no cost column to
--     strip; role-scoping alone closes the cross-tenant read. ─────────────
drop policy if exists "public read" on menu_item_addons;
create policy "public read" on menu_item_addons for select to anon using (true);
grant select on menu_item_addons to authenticated;

-- ── BUG 3: menu_item_effective_cost — internal-only computation, plus a
--     membership-checked public wrapper with the same name/signature. ──────
create or replace function menu_item_effective_cost_internal(p_menu_item_id uuid, p_variant_id uuid default null)
returns integer language plpgsql stable security definer set search_path = public as $$
declare
  v_src    text;
  v_manual integer;
  v_recipe numeric;
  v_base   integer;
  v_delta  integer := 0;
begin
  select cost_source, cost into v_src, v_manual from menu_items where id = p_menu_item_id;
  if not found then return 0; end if;

  if v_src = 'recipe' then
    select coalesce(round(sum(ri.qty * coalesce(inv.cost, 0))), 0) into v_recipe
      from recipe_items ri
      join inventory_items inv on inv.id = ri.inventory_item_id
     where ri.menu_item_id = p_menu_item_id;
    v_base := coalesce(v_recipe, 0)::integer;
  else
    v_base := coalesce(v_manual, 0);
  end if;

  if p_variant_id is not null then
    select cost_delta into v_delta from menu_item_variants
     where id = p_variant_id and menu_item_id = p_menu_item_id;
    v_delta := coalesce(v_delta, 0);
  end if;

  return greatest(0, v_base + v_delta);
end $$;
revoke execute on function menu_item_effective_cost_internal(uuid, uuid) from public, anon, authenticated;

create or replace function menu_item_effective_cost(p_menu_item_id uuid, p_variant_id uuid default null)
returns integer language plpgsql stable security definer set search_path = public as $$
declare v_cafe_id uuid;
begin
  select cafe_id into v_cafe_id from menu_items where id = p_menu_item_id;
  if v_cafe_id is null then raise exception 'item not found'; end if;
  if not is_cafe_member(v_cafe_id) then raise exception 'not authorized for this café'; end if;

  return menu_item_effective_cost_internal(p_menu_item_id, p_variant_id);
end $$;
revoke execute on function menu_item_effective_cost(uuid, uuid) from public, anon;
grant execute on function menu_item_effective_cost(uuid, uuid) to authenticated;

-- Repoint the snapshot trigger at the internal function — an anonymous QR
-- order has no café membership to check, and never should have needed one:
-- place_order already authorized the request via the table token before
-- this trigger ever fires.
create or replace function snapshot_order_item_tax() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_cafe_id uuid;
begin
  select o.cafe_id into v_cafe_id from orders o where o.id = new.order_id;
  if v_cafe_id is null then return new; end if;

  if new.tax_percent is null then
    select coalesce(mi.tax_percent, c.tax_percent) into new.tax_percent
      from cafes c left join menu_items mi on mi.id = new.menu_item_id
     where c.id = v_cafe_id;
  end if;

  if new.hsn_sac is null then
    select coalesce(mi.hsn_sac, c.gst_sac_code) into new.hsn_sac
      from cafes c left join menu_items mi on mi.id = new.menu_item_id
     where c.id = v_cafe_id;
  end if;

  if new.cost_snapshot is null and new.menu_item_id is not null then
    new.cost_snapshot := menu_item_effective_cost_internal(new.menu_item_id, new.variant_id);
  end if;

  return new;
end $$;
-- Trigger definition unchanged (0037); the replaced function body is picked up.

-- ── Prove every grant/revoke actually landed ────────────────────────────────
do $$
begin
  if has_column_privilege('anon', 'menu_items', 'cost', 'select') then
    raise exception 'anon can still select menu_items.cost — lockdown failed';
  end if;
  if has_column_privilege('anon', 'menu_items', 'cost_source', 'select') then
    raise exception 'anon can still select menu_items.cost_source — lockdown failed';
  end if;
  if has_column_privilege('anon', 'menu_item_variants', 'cost_delta', 'select') then
    raise exception 'anon can still select menu_item_variants.cost_delta — lockdown failed';
  end if;
  if has_function_privilege('authenticated', 'menu_item_effective_cost_internal(uuid, uuid)', 'execute') then
    raise exception 'menu_item_effective_cost_internal is still directly callable by authenticated — lockdown failed';
  end if;
  if has_function_privilege('anon', 'menu_item_effective_cost_internal(uuid, uuid)', 'execute') then
    raise exception 'menu_item_effective_cost_internal is still directly callable by anon — lockdown failed';
  end if;
end $$;
