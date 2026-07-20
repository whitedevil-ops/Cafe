-- ============================================================================
-- 0001 — Consolidated baseline. IDEMPOTENT and NON-DESTRUCTIVE.
-- Safe to run repeatedly on the partially-applied production DB. It does NOT
-- drop tables or delete data — it only (re)creates functions, triggers, and RLS
-- policies to converge the database to the correct, consistent state.
--
-- Fixes found in the Phase-0 audit:
--   * menu_item_variants / menu_item_addons had no member-write policy (menu
--     manager could not create them).
--   * menu/table policies lived in a do-block that may have failed in a partial
--     run, leaving menu_categories/menu_items without policies.
--   * handle_new_user trigger / cafes registration policies missing on some DBs.
-- ============================================================================

-- ── Authorization helpers ───────────────────────────────────────────────────
create or replace function is_cafe_member(target uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from cafe_members
    where cafe_id = target and user_id = auth.uid() and status = 'active');
$$;

create or replace function has_cafe_role(target uuid, roles member_role[])
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from cafe_members
    where cafe_id = target and user_id = auth.uid()
      and status = 'active' and role = any(roles));
$$;

-- ── Profile auto-creation on signup ─────────────────────────────────────────
create or replace function handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, email, phone)
  values (new.id, new.raw_user_meta_data->>'full_name', new.email, new.raw_user_meta_data->>'phone')
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users for each row execute function handle_new_user();

-- Backfill any existing users missing a profile (FK target for cafes.owner_id).
insert into profiles (id, full_name, email, phone)
select u.id, u.raw_user_meta_data->>'full_name', u.email, u.raw_user_meta_data->>'phone'
from auth.users u left join profiles p on p.id = u.id
where p.id is null
on conflict (id) do nothing;

-- ── Ensure RLS is on everywhere it must be ──────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array[
    'profiles','cafes','cafe_members','menu_categories','menu_items',
    'menu_item_variants','menu_item_addons','cafe_tables','customers','orders',
    'order_items','payments','cafe_settings'
  ] loop
    execute format('alter table %I enable row level security;', t);
  end loop;
end $$;

-- ── profiles ────────────────────────────────────────────────────────────────
drop policy if exists "self read"   on profiles;
drop policy if exists "self write"  on profiles;
drop policy if exists "self insert" on profiles;
create policy "self read"   on profiles for select using (id = auth.uid());
create policy "self write"  on profiles for update using (id = auth.uid());
create policy "self insert" on profiles for insert with check (id = auth.uid());

-- ── cafes ───────────────────────────────────────────────────────────────────
drop policy if exists "member read"  on cafes;
drop policy if exists "owner read"   on cafes;
drop policy if exists "public brand" on cafes;
drop policy if exists "create own"   on cafes;
drop policy if exists "owner update" on cafes;
create policy "member read"  on cafes for select using (is_cafe_member(id));
create policy "owner read"   on cafes for select to authenticated using (owner_id = auth.uid());
create policy "public brand" on cafes for select to anon using (true);
create policy "create own"   on cafes for insert to authenticated with check (owner_id = auth.uid());
create policy "owner update" on cafes for update using (has_cafe_role(id, array['owner','manager']::member_role[]));

-- ── cafe_members ────────────────────────────────────────────────────────────
drop policy if exists "member read"     on cafe_members;
drop policy if exists "bootstrap owner" on cafe_members;
drop policy if exists "owner manage i"  on cafe_members;
drop policy if exists "owner manage u"  on cafe_members;
drop policy if exists "owner manage d"  on cafe_members;
create policy "member read"     on cafe_members for select using (is_cafe_member(cafe_id));
create policy "bootstrap owner" on cafe_members for insert to authenticated
  with check (user_id = auth.uid()
    and exists (select 1 from cafes c where c.id = cafe_id and c.owner_id = auth.uid()));
create policy "owner manage i" on cafe_members for insert with check (has_cafe_role(cafe_id, array['owner','manager']::member_role[]));
create policy "owner manage u" on cafe_members for update using (has_cafe_role(cafe_id, array['owner','manager']::member_role[]));
create policy "owner manage d" on cafe_members for delete using (has_cafe_role(cafe_id, array['owner']::member_role[]));

-- ── menu_categories / menu_items / cafe_tables (direct cafe_id) ─────────────
do $$
declare t text;
begin
  foreach t in array array['menu_categories','menu_items','cafe_tables'] loop
    execute format('drop policy if exists "member all" on %I;', t);
    execute format('drop policy if exists "public read" on %I;', t);
    execute format('create policy "member all" on %I for all using (is_cafe_member(cafe_id)) with check (is_cafe_member(cafe_id));', t);
    execute format('create policy "public read" on %I for select using (true);', t);
  end loop;
end $$;

-- ── menu_item_variants / menu_item_addons (cafe via parent item) — THE FIX ──
drop policy if exists "member all" on menu_item_variants;
drop policy if exists "public read" on menu_item_variants;
create policy "member all" on menu_item_variants for all
  using (exists (select 1 from menu_items mi where mi.id = menu_item_id and is_cafe_member(mi.cafe_id)))
  with check (exists (select 1 from menu_items mi where mi.id = menu_item_id and is_cafe_member(mi.cafe_id)));
create policy "public read" on menu_item_variants for select using (true);

drop policy if exists "member all" on menu_item_addons;
drop policy if exists "public read" on menu_item_addons;
create policy "member all" on menu_item_addons for all
  using (exists (select 1 from menu_items mi where mi.id = menu_item_id and is_cafe_member(mi.cafe_id)))
  with check (exists (select 1 from menu_items mi where mi.id = menu_item_id and is_cafe_member(mi.cafe_id)));
create policy "public read" on menu_item_addons for select using (true);

-- ── orders / order_items ────────────────────────────────────────────────────
drop policy if exists "member all" on orders;
create policy "member all" on orders for all using (is_cafe_member(cafe_id)) with check (is_cafe_member(cafe_id));

drop policy if exists "member all" on order_items;
create policy "member all" on order_items for all
  using (exists (select 1 from orders o where o.id = order_id and is_cafe_member(o.cafe_id)))
  with check (exists (select 1 from orders o where o.id = order_id and is_cafe_member(o.cafe_id)));

-- ── customers / payments / cafe_settings ────────────────────────────────────
drop policy if exists "member all" on customers;
create policy "member all" on customers for all using (is_cafe_member(cafe_id)) with check (is_cafe_member(cafe_id));

drop policy if exists "member all" on payments;
create policy "member all" on payments for all using (is_cafe_member(cafe_id)) with check (is_cafe_member(cafe_id));

drop policy if exists "member all" on cafe_settings;
create policy "member all" on cafe_settings for all using (is_cafe_member(cafe_id)) with check (is_cafe_member(cafe_id));
