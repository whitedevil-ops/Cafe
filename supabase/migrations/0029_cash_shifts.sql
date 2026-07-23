-- ============================================================================
-- 0029 — Shift + cash register.
--
-- Answers the question an owner asks every single night: "how much cash should
-- be in the drawer, and is it there?"
--
--   Opening float
-- + cash sales          (payments, method = cash, during the shift)
-- - cash refunds        (refunds,  method = cash, during the shift)
-- + cash added
-- - cash removed / petty
-- ---------------------------------
-- = expected            vs counted  ->  short / excess
--
-- WHY A TIME WINDOW RATHER THAN shift_id ON payments/refunds: stamping a shift
-- onto every payment would mean touching every path that records money — the
-- floor view, the kitchen screen, split-bill, and both order-creation
-- functions. That is a lot of financial surface to disturb for a reporting
-- convenience. Instead a café may have only ONE open shift at a time (enforced
-- by a partial unique index), which makes "during the shift" unambiguous
-- without modifying a single existing write path.
--
-- Immutability follows the refunds pattern from 0028: SELECT-only policies, no
-- INSERT/UPDATE/DELETE policy anywhere, so rows can only be created or closed
-- through the SECURITY DEFINER functions below and can never be edited after
-- the fact.
-- ============================================================================

create table if not exists cash_shifts (
  id            uuid primary key default gen_random_uuid(),
  cafe_id       uuid not null references cafes(id) on delete cascade,
  status        text not null default 'open',
  opening_cash  integer not null default 0 check (opening_cash >= 0),
  opened_by     uuid references profiles(id) on delete set null,
  opened_at     timestamptz not null default now(),
  -- Populated only at close; a snapshot, so later data cannot rewrite history.
  expected_cash integer,
  counted_cash  integer,
  difference    integer,          -- counted - expected; negative = short
  notes         text,
  closed_by     uuid references profiles(id) on delete set null,
  closed_at     timestamptz
);

do $$ begin
  alter table cash_shifts add constraint cash_shifts_status_chk check (status in ('open', 'closed'));
exception when duplicate_object then null; end $$;

-- The constraint that makes the time-window approach sound.
create unique index if not exists cash_shifts_one_open_per_cafe
  on cash_shifts (cafe_id) where status = 'open';
create index if not exists cash_shifts_cafe_idx on cash_shifts (cafe_id, opened_at desc);

create table if not exists cash_movements (
  id         uuid primary key default gen_random_uuid(),
  cafe_id    uuid not null references cafes(id) on delete cascade,
  shift_id   uuid not null references cash_shifts(id) on delete cascade,
  kind       text not null,                -- add | remove | petty
  amount     integer not null check (amount > 0),
  reason     text not null,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists cash_movements_shift_idx on cash_movements (shift_id, created_at);

do $$ begin
  alter table cash_movements add constraint cash_movements_kind_chk check (kind in ('add', 'remove', 'petty'));
exception when duplicate_object then null; end $$;

alter table cash_shifts enable row level security;
alter table cash_movements enable row level security;

drop policy if exists "member read" on cash_shifts;
create policy "member read" on cash_shifts for select using (is_cafe_member(cafe_id));

drop policy if exists "member read" on cash_movements;
create policy "member read" on cash_movements for select using (is_cafe_member(cafe_id));

-- ── Live summary ───────────────────────────────────────────────────────────
-- Recomputed from source rows every time rather than kept as a running total,
-- so a late-arriving payment or refund can never leave the drawer figure stale.
create or replace function shift_summary(p_shift_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_shift    record;
  v_until    timestamptz;
  v_sales    integer;
  v_refunds  integer;
  v_added    integer;
  v_removed  integer;
  v_expected integer;
begin
  select * into v_shift from cash_shifts where id = p_shift_id;
  if v_shift.id is null then raise exception 'shift not found'; end if;
  if not is_cafe_member(v_shift.cafe_id) then raise exception 'not authorized'; end if;

  -- A closed shift is frozen at its closing instant; an open one runs to now.
  v_until := coalesce(v_shift.closed_at, now());

  select coalesce(sum(amount), 0)::integer into v_sales
    from payments
   where cafe_id = v_shift.cafe_id and method = 'cash'
     and created_at >= v_shift.opened_at and created_at <= v_until;

  select coalesce(sum(amount), 0)::integer into v_refunds
    from refunds
   where cafe_id = v_shift.cafe_id and method = 'cash' and status = 'completed'
     and created_at >= v_shift.opened_at and created_at <= v_until;

  select coalesce(sum(amount) filter (where kind = 'add'), 0)::integer,
         coalesce(sum(amount) filter (where kind in ('remove', 'petty')), 0)::integer
    into v_added, v_removed
    from cash_movements where shift_id = p_shift_id;

  v_expected := v_shift.opening_cash + v_sales - v_refunds + v_added - v_removed;

  return jsonb_build_object(
    'shift_id', v_shift.id,
    'status', v_shift.status,
    'opened_at', v_shift.opened_at,
    'closed_at', v_shift.closed_at,
    'opening_cash', v_shift.opening_cash,
    'cash_sales', v_sales,
    'cash_refunds', v_refunds,
    'cash_added', v_added,
    'cash_removed', v_removed,
    -- For a closed shift report the SNAPSHOT taken at closing time, not a
    -- freshly recomputed figure, so history stays exactly as it was signed off.
    'expected_cash', coalesce(v_shift.expected_cash, v_expected),
    'counted_cash', v_shift.counted_cash,
    'difference', v_shift.difference,
    'notes', v_shift.notes
  );
end $$;

revoke execute on function shift_summary(uuid) from public, anon;
grant execute on function shift_summary(uuid) to authenticated;

-- ── Current open shift for a café (null when none) ─────────────────────────
create or replace function current_shift(p_cafe_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_id uuid;
begin
  if not is_cafe_member(p_cafe_id) then raise exception 'not authorized'; end if;
  select id into v_id from cash_shifts where cafe_id = p_cafe_id and status = 'open';
  if v_id is null then return null; end if;
  return shift_summary(v_id);
end $$;

revoke execute on function current_shift(uuid) from public, anon;
grant execute on function current_shift(uuid) to authenticated;

-- ── Open ───────────────────────────────────────────────────────────────────
create or replace function open_shift(p_cafe_id uuid, p_opening_cash integer default 0)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not has_cafe_role(p_cafe_id, array['owner','manager','cashier']::member_role[]) then
    raise exception 'your role cannot open a shift';
  end if;
  if coalesce(p_opening_cash, 0) < 0 then raise exception 'opening cash cannot be negative'; end if;

  if exists (select 1 from cash_shifts where cafe_id = p_cafe_id and status = 'open') then
    raise exception 'a shift is already open — close it before opening another';
  end if;

  insert into cash_shifts (cafe_id, opening_cash, opened_by)
  values (p_cafe_id, coalesce(p_opening_cash, 0), auth.uid())
  returning id into v_id;

  insert into audit_logs (cafe_id, actor_id, action, entity, entity_id, meta)
  values (p_cafe_id, auth.uid(), 'shift.opened', 'cash_shifts', v_id,
          jsonb_build_object('opening_cash', coalesce(p_opening_cash, 0)));

  return v_id;
end $$;

revoke execute on function open_shift(uuid, integer) from public, anon;
grant execute on function open_shift(uuid, integer) to authenticated;

-- ── Cash in / out during the shift ─────────────────────────────────────────
create or replace function record_cash_movement(
  p_shift_id uuid, p_kind text, p_amount integer, p_reason text
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_shift record; v_id uuid;
begin
  select * into v_shift from cash_shifts where id = p_shift_id;
  if v_shift.id is null then raise exception 'shift not found'; end if;
  if v_shift.status <> 'open' then raise exception 'this shift is already closed'; end if;

  if not has_cafe_role(v_shift.cafe_id, array['owner','manager','cashier']::member_role[]) then
    raise exception 'your role cannot move cash';
  end if;
  if p_kind not in ('add', 'remove', 'petty') then raise exception 'invalid movement type'; end if;
  if coalesce(p_amount, 0) <= 0 then raise exception 'amount must be greater than zero'; end if;
  -- A reason is mandatory: an unexplained drawer movement is indistinguishable
  -- from theft after the fact, which is the whole point of recording it.
  if p_reason is null or trim(p_reason) = '' then raise exception 'a reason is required'; end if;

  insert into cash_movements (cafe_id, shift_id, kind, amount, reason, created_by)
  values (v_shift.cafe_id, p_shift_id, p_kind, p_amount, trim(p_reason), auth.uid())
  returning id into v_id;

  insert into audit_logs (cafe_id, actor_id, action, entity, entity_id, meta)
  values (v_shift.cafe_id, auth.uid(), 'shift.cash_' || p_kind, 'cash_movements', v_id,
          jsonb_build_object('amount', p_amount, 'reason', trim(p_reason), 'shift_id', p_shift_id));

  return v_id;
end $$;

revoke execute on function record_cash_movement(uuid, text, integer, text) from public, anon;
grant execute on function record_cash_movement(uuid, text, integer, text) to authenticated;

-- ── Close ──────────────────────────────────────────────────────────────────
-- Freezes expected_cash as a snapshot. Later payments or refunds cannot
-- retroactively change what a shift was signed off against.
create or replace function close_shift(
  p_shift_id uuid, p_counted_cash integer, p_notes text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_shift    record;
  v_summary  jsonb;
  v_expected integer;
  v_diff     integer;
begin
  select * into v_shift from cash_shifts where id = p_shift_id;
  if v_shift.id is null then raise exception 'shift not found'; end if;
  if v_shift.status <> 'open' then raise exception 'this shift is already closed'; end if;

  if not has_cafe_role(v_shift.cafe_id, array['owner','manager','cashier']::member_role[]) then
    raise exception 'your role cannot close a shift';
  end if;
  if p_counted_cash is null or p_counted_cash < 0 then
    raise exception 'enter the cash actually counted in the drawer';
  end if;

  v_summary := shift_summary(p_shift_id);
  v_expected := (v_summary->>'expected_cash')::integer;
  v_diff := p_counted_cash - v_expected;

  update cash_shifts
     set status = 'closed',
         expected_cash = v_expected,
         counted_cash = p_counted_cash,
         difference = v_diff,
         notes = nullif(trim(coalesce(p_notes, '')), ''),
         closed_by = auth.uid(),
         closed_at = now()
   where id = p_shift_id;

  insert into audit_logs (cafe_id, actor_id, action, entity, entity_id, meta)
  values (v_shift.cafe_id, auth.uid(), 'shift.closed', 'cash_shifts', p_shift_id,
          jsonb_build_object(
            'expected', v_expected, 'counted', p_counted_cash, 'difference', v_diff,
            'opening_cash', v_shift.opening_cash,
            'cash_sales', (v_summary->>'cash_sales')::integer,
            'cash_refunds', (v_summary->>'cash_refunds')::integer,
            'notes', nullif(trim(coalesce(p_notes, '')), '')));

  return shift_summary(p_shift_id);
end $$;

revoke execute on function close_shift(uuid, integer, text) from public, anon;
grant execute on function close_shift(uuid, integer, text) to authenticated;

-- ── Recent shifts, for the history list and the owner alert ────────────────
create or replace function recent_shifts(p_cafe_id uuid, p_limit integer default 15)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not is_cafe_member(p_cafe_id) then raise exception 'not authorized'; end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', s.id, 'status', s.status, 'opened_at', s.opened_at, 'closed_at', s.closed_at,
      'opening_cash', s.opening_cash, 'expected_cash', s.expected_cash,
      'counted_cash', s.counted_cash, 'difference', s.difference, 'notes', s.notes,
      'opened_by_name', po.full_name, 'closed_by_name', pc.full_name
    ) order by s.opened_at desc)
    from (
      select * from cash_shifts where cafe_id = p_cafe_id
      order by opened_at desc limit greatest(coalesce(p_limit, 15), 1)
    ) s
    left join profiles po on po.id = s.opened_by
    left join profiles pc on pc.id = s.closed_by
  ), '[]'::jsonb);
end $$;

revoke execute on function recent_shifts(uuid, integer) from public, anon;
grant execute on function recent_shifts(uuid, integer) to authenticated;
