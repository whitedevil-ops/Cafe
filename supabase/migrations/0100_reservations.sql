-- ============================================================================
-- 0100 — Table reservations. Gives the 'reservations' plan flag (existed
-- since the pricing tiers were defined, with no feature behind it) an
-- actual feature: a staff-logged booking book, not customer self-service
-- online booking — that would need a real availability engine against the
-- floor plan, a much bigger project than "let staff log who's coming in."
--
-- A reservation optionally links to a table (cafe_tables), but never
-- reserves it in any enforced sense — Live Tables' own session/status model
-- is untouched. This is a diary staff can act on (seat the party at the
-- table they picked when the moment comes), not a second booking authority
-- fighting the first.
-- ============================================================================

create table if not exists reservations (
  id             uuid primary key default gen_random_uuid(),
  cafe_id        uuid not null references cafes(id) on delete cascade,
  customer_name  text not null,
  customer_phone text,
  party_size     integer not null check (party_size > 0),
  reserved_for   timestamptz not null,
  table_id       uuid references cafe_tables(id) on delete set null,
  notes          text,
  status         text not null default 'upcoming',
  created_by     uuid references profiles(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists reservations_cafe_idx on reservations (cafe_id, reserved_for);

do $$ begin
  alter table reservations add constraint reservations_status_chk
    check (status in ('upcoming', 'seated', 'completed', 'cancelled', 'no_show'));
exception when duplicate_object then null; end $$;

alter table reservations enable row level security;
drop policy if exists "member read" on reservations;
create policy "member read" on reservations for select using (is_cafe_member(cafe_id));
-- No insert/update/delete policy — writes only through the RPCs below, same
-- immutable-except-through-a-function pattern used for refunds/cash_shifts.

create or replace function create_reservation(
  p_cafe_id       uuid,
  p_customer_name text,
  p_customer_phone text,
  p_party_size    integer,
  p_reserved_for  timestamptz,
  p_table_id      uuid default null,
  p_notes         text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not has_cafe_role(p_cafe_id, array['owner','manager','cashier','waiter']::member_role[]) then
    raise exception 'your role cannot take reservations';
  end if;
  if not cafe_has_feature(p_cafe_id, 'reservations') then
    raise exception 'reservations are not available on this plan';
  end if;
  if nullif(trim(coalesce(p_customer_name, '')), '') is null then
    raise exception 'a customer name is required';
  end if;
  if coalesce(p_party_size, 0) <= 0 then raise exception 'party size must be greater than zero'; end if;
  if p_reserved_for is null then raise exception 'a reservation time is required'; end if;
  if p_table_id is not null and not exists (select 1 from cafe_tables where id = p_table_id and cafe_id = p_cafe_id) then
    raise exception 'table does not belong to this café';
  end if;

  insert into reservations (cafe_id, customer_name, customer_phone, party_size, reserved_for, table_id, notes, created_by)
  values (p_cafe_id, trim(p_customer_name), nullif(regexp_replace(coalesce(p_customer_phone, ''), '\D', '', 'g'), ''),
          p_party_size, p_reserved_for, p_table_id, nullif(trim(coalesce(p_notes, '')), ''), auth.uid())
  returning id into v_id;

  return v_id;
end $$;
revoke execute on function create_reservation(uuid, text, text, integer, timestamptz, uuid, text) from public, anon;
grant execute on function create_reservation(uuid, text, text, integer, timestamptz, uuid, text) to authenticated;

-- p_reason is only meaningful for cancelled/no_show, appended to notes so the
-- reason isn't lost without adding another mutable column to audit later.
create or replace function set_reservation_status(p_reservation_id uuid, p_status text, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_cafe_id uuid; v_notes text;
begin
  select cafe_id, notes into v_cafe_id, v_notes from reservations where id = p_reservation_id;
  if v_cafe_id is null then raise exception 'reservation not found'; end if;
  if not has_cafe_role(v_cafe_id, array['owner','manager','cashier','waiter']::member_role[]) then
    raise exception 'your role cannot update reservations';
  end if;
  if p_status not in ('upcoming', 'seated', 'completed', 'cancelled', 'no_show') then
    raise exception 'invalid status';
  end if;

  update reservations
     set status = p_status,
         notes = case when p_reason is not null and trim(p_reason) <> ''
                       then trim(coalesce(v_notes, '') || case when v_notes is not null and v_notes <> '' then E'\n' else '' end
                                 || initcap(p_status) || ': ' || trim(p_reason))
                       else v_notes end,
         updated_at = now()
   where id = p_reservation_id;
end $$;
revoke execute on function set_reservation_status(uuid, text, text) from public, anon;
grant execute on function set_reservation_status(uuid, text, text) to authenticated;

-- p_from/p_to bound reserved_for — the dashboard defaults to "today onward"
-- but can page back through history via a wider range.
create or replace function list_reservations(p_cafe_id uuid, p_from timestamptz, p_to timestamptz)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not is_cafe_member(p_cafe_id) then raise exception 'not authorized'; end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', r.id, 'customer_name', r.customer_name, 'customer_phone', r.customer_phone,
      'party_size', r.party_size, 'reserved_for', r.reserved_for, 'table_id', r.table_id,
      'table_label', t.label, 'notes', r.notes, 'status', r.status, 'created_at', r.created_at
    ) order by r.reserved_for asc)
    from reservations r
    left join cafe_tables t on t.id = r.table_id
    where r.cafe_id = p_cafe_id and r.reserved_for >= p_from and r.reserved_for < p_to
  ), '[]'::jsonb);
end $$;
revoke execute on function list_reservations(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function list_reservations(uuid, timestamptz, timestamptz) to authenticated;

-- ── Reservations joins the role-screen-access system (0096) ────────────────
create or replace function all_screen_keys()
returns text[] language sql immutable as $$
  select array['dashboard','pos','tables','bills','shift','kitchen','menu','customers','feedback',
               'inventory','purchases','recipes','coupons','loyalty','wallet','reservations','reports',
               'expenses','profile','qr_codes','billing','settings']
$$;

create or replace function default_role_screens(p_role member_role)
returns text[] language sql immutable as $$
  select case p_role
    when 'owner'      then array['dashboard','pos','tables','bills','shift','kitchen','menu','customers','feedback','inventory','purchases','recipes','coupons','loyalty','wallet','reservations','reports','expenses','profile','qr_codes','billing','settings']
    when 'manager'    then array['dashboard','pos','tables','bills','shift','kitchen','menu','customers','feedback','inventory','purchases','recipes','coupons','loyalty','wallet','reservations','reports','expenses','profile','qr_codes','settings']
    when 'cashier'    then array['dashboard','pos','tables','bills','shift','kitchen','reservations']
    when 'waiter'     then array['pos','tables','kitchen','reservations']
    when 'kitchen'    then array['kitchen']
    when 'accountant' then array['dashboard','bills','reports','expenses','billing']
    else array[]::text[]
  end
$$;
