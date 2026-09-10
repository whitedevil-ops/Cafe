-- ============================================================================
-- 0236 — Batch 4 (SQL half) of the ungated-features entitlement project:
-- KOT printing and manual reprint.
--
-- enqueue_kot_jobs() (latest body: 0151_kot_update_versioning.sql) fires
-- AFTER UPDATE on orders whenever the total (re)computes — for BOTH the
-- anonymous QR-ordering path (place_order) and the staff POS path
-- (staff_place_order). There is no session on the former, so this uses
-- cafe_feature_for_guest(), never cafe_has_feature()/hasFeature(). Using the
-- member-only function here would not merely fail open on an error, it
-- would fail PERMANENTLY CLOSED for every café's QR orders the instant this
-- shipped — the exact bug class 0092/0112/0178/0235 already hit.
--
-- AND'd with the existing kot_printing_enabled column read, not replacing
-- it — 'kot_printing' was seeded true on every plan by 0233, so
-- <column> AND <key> is identical to <column> alone for every café until an
-- Ops admin deliberately overrides one off.
--
-- reprint_kot() (only ever defined in 0027_kot_printing.sql) is a plain
-- authenticated RPC — has_cafe_role() already requires auth.uid(), so there
-- is no anonymous path here. Safe to gate with cafe_has_feature().
-- ============================================================================

create or replace function enqueue_kot_jobs() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_enabled          boolean;
  v_print_on_update  boolean;
  v_first_kot        boolean;
  v_printer          record;
  v_payload          jsonb;
begin
  begin
    select kot_printing_enabled, kot_print_on_update into v_enabled, v_print_on_update
      from cafes where id = new.cafe_id;
    if not coalesce(v_enabled, false) then return new; end if;
    if not cafe_feature_for_guest(new.cafe_id, 'kot_printing') then return new; end if;

    v_first_kot := not exists (select 1 from print_jobs where order_id = new.id and kind = 'kot');
    if not v_first_kot and not coalesce(v_print_on_update, true) then return new; end if;

    for v_printer in
      select * from kot_printers
       where cafe_id = new.cafe_id and enabled = true and auto_print = true
    loop
      if v_first_kot then
        v_payload := build_kot_payload(new.id, v_printer.id);
        if v_payload is not null then
          insert into print_jobs (cafe_id, order_id, printer_id, station_id, kind, payload)
          values (new.cafe_id, new.id, v_printer.id, v_printer.station_id, 'kot', v_payload);
        end if;
      else
        v_payload := build_kot_update_payload(new.id, v_printer.id);
        if v_payload is not null then
          insert into print_jobs (cafe_id, order_id, printer_id, station_id, kind, payload)
          values (new.cafe_id, new.id, v_printer.id, v_printer.station_id, 'kot_update', v_payload);
        end if;
      end if;
    end loop;
  exception when others then
    -- Same as 0027/0151: printing must never fail an order.
    null;
  end;
  return new;
end $$;

create or replace function reprint_kot(p_order_id uuid, p_printer_id uuid default null)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_cafe_id uuid;
  v_printer record;
  v_payload jsonb;
  v_count   integer := 0;
begin
  select cafe_id into v_cafe_id from orders where id = p_order_id;
  if v_cafe_id is null then raise exception 'order not found'; end if;

  if not has_cafe_role(v_cafe_id, array['owner','manager','cashier','kitchen']::member_role[]) then
    raise exception 'you do not have permission to reprint';
  end if;
  if not cafe_has_feature(v_cafe_id, 'kot_reprint') then
    raise exception 'KOT reprint is turned off for this café';
  end if;

  for v_printer in
    select * from kot_printers
     where cafe_id = v_cafe_id and enabled = true
       and (p_printer_id is null or id = p_printer_id)
  loop
    v_payload := build_kot_payload(p_order_id, v_printer.id);
    if v_payload is not null then
      insert into print_jobs (cafe_id, order_id, printer_id, station_id, kind, payload, requested_by)
      values (v_cafe_id, p_order_id, v_printer.id, v_printer.station_id, 'reprint', v_payload, auth.uid());
      v_count := v_count + 1;
    end if;
  end loop;

  insert into audit_logs (cafe_id, actor_id, action, entity, entity_id, meta)
  values (v_cafe_id, auth.uid(), 'kot.reprinted', 'orders', p_order_id,
          jsonb_build_object('jobs', v_count, 'printer_id', p_printer_id));

  return v_count;
end $$;

-- ── self-check ───────────────────────────────────────────────────────────
do $$
declare v_src text;
begin
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'enqueue_kot_jobs';
  if v_src is null then raise exception 'enqueue_kot_jobs does not exist'; end if;
  if v_src !~ 'cafe_feature_for_guest\(new.cafe_id, ''kot_printing''\)' then
    raise exception 'enqueue_kot_jobs is missing the kot_printing entitlement check';
  end if;
  if v_src ~ 'cafe_has_feature\(new.cafe_id' then
    raise exception 'enqueue_kot_jobs must not use cafe_has_feature (member-only) — it runs on anonymous QR orders too';
  end if;

  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'reprint_kot';
  if v_src is null then raise exception 'reprint_kot does not exist'; end if;
  if v_src !~ 'cafe_has_feature\(v_cafe_id, ''kot_reprint''\)' then
    raise exception 'reprint_kot is missing the kot_reprint entitlement check';
  end if;
end $$;
