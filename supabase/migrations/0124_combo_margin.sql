-- ============================================================================
-- 0124 — Owner-recorded margin on a combo, and a simpler create_combo shape.
--
-- An owner pricing a bundle thinks "I make ₹120 on this", not "it costs me
-- ₹259". Same reasoning the menu import already follows, where a Profit
-- column is accepted as an alternative to Cost Price (menu-import.ts) — this
-- brings combos in line.
--
-- Deliberately owner-entered rather than derived. A combo's real cost can't
-- be computed for a choice slot ("Any Pizza" costs whatever the guest picks),
-- so a derived figure would be wrong or blank exactly where it matters. This
-- is the owner's own planning number: never shown to a customer (neither the
-- QR menu cache nor the POS fetch selects it), just carried into the combos
-- export and available for reporting.
--
-- create_combo/update_combo grow a parameter, so both get an explicit DROP
-- first — adding a param changes the type list, which creates a SECOND
-- overload rather than replacing the function, and PostgREST then can't
-- choose between them. This project has hit that trap before (0043, 0097,
-- noted again in 0106/0120).
-- ============================================================================

alter table combos add column if not exists margin integer check (margin >= 0);

drop function if exists create_combo(uuid, text, integer, jsonb, text);

create or replace function create_combo(
  p_cafe_id     uuid,
  p_name        text,
  p_price       integer,
  p_slots       jsonb,
  p_description text default null,
  p_margin      integer default null
) returns combos
language plpgsql security definer set search_path = public as $$
declare
  v_role member_role;
  v_row  combos%rowtype;
begin
  select role into v_role from cafe_members where cafe_id = p_cafe_id and user_id = auth.uid();
  if v_role is null then raise exception 'not authorized for this café'; end if;
  if v_role not in ('owner', 'manager') then
    raise exception 'only an owner or manager can create combos';
  end if;

  if p_name is null or trim(p_name) = '' then raise exception 'enter a combo name'; end if;
  if p_price is null or p_price < 0 then raise exception 'enter a valid combo price'; end if;
  if p_margin is not null and p_margin > p_price then
    raise exception 'margin cannot be more than the combo price';
  end if;

  insert into combos (cafe_id, name, description, price, margin, sort)
  values (p_cafe_id, trim(p_name), nullif(trim(coalesce(p_description, '')), ''), p_price, p_margin,
          coalesce((select max(sort) + 1 from combos where cafe_id = p_cafe_id), 0))
  returning * into v_row;

  perform sync_combo_slots(v_row.id, p_cafe_id, p_slots);
  return v_row;
end $$;

revoke execute on function create_combo(uuid, text, integer, jsonb, text, integer) from public, anon;
grant execute on function create_combo(uuid, text, integer, jsonb, text, integer) to authenticated;

drop function if exists update_combo(uuid, text, integer, jsonb, text);

create or replace function update_combo(
  p_combo_id    uuid,
  p_name        text,
  p_price       integer,
  p_slots       jsonb,
  p_description text default null,
  p_margin      integer default null
) returns combos
language plpgsql security definer set search_path = public as $$
declare
  v_cafe_id uuid;
  v_role    member_role;
  v_row     combos%rowtype;
begin
  select cafe_id into v_cafe_id from combos where id = p_combo_id;
  if v_cafe_id is null then raise exception 'combo not found'; end if;

  select role into v_role from cafe_members where cafe_id = v_cafe_id and user_id = auth.uid();
  if v_role is null then raise exception 'not authorized for this café'; end if;
  if v_role not in ('owner', 'manager') then
    raise exception 'only an owner or manager can edit combos';
  end if;

  if p_name is null or trim(p_name) = '' then raise exception 'enter a combo name'; end if;
  if p_price is null or p_price < 0 then raise exception 'enter a valid combo price'; end if;
  if p_margin is not null and p_margin > p_price then
    raise exception 'margin cannot be more than the combo price';
  end if;

  update combos
     set name = trim(p_name),
         description = nullif(trim(coalesce(p_description, '')), ''),
         price = p_price,
         margin = p_margin
   where id = p_combo_id
  returning * into v_row;

  perform sync_combo_slots(p_combo_id, v_cafe_id, p_slots);
  return v_row;
end $$;

revoke execute on function update_combo(uuid, text, integer, jsonb, text, integer) from public, anon;
grant execute on function update_combo(uuid, text, integer, jsonb, text, integer) to authenticated;
