-- ============================================================================
-- 0151 — Change-KOT versioning: an order edited after its first KOT already
-- printed gets a small "KOT UPDATE" delta ticket instead of either a silent
-- no-op (today's behaviour) or a confusing full duplicate reprint.
--
-- CURRENT BEHAVIOUR, VERIFIED: enqueue_kot_jobs' idempotency check is
-- `if exists (select 1 from print_jobs where order_id = new.id and kind =
-- 'kot')`, keyed on order_id alone. So a SECOND total-changing UPDATE to the
-- same order (e.g. an item added after the KOT already queued) enqueues
-- NOTHING — the addition is silently unticketed at the print layer (it's
-- still on the digital KDS, which reads order_items directly and is
-- unaffected by any of this).
--
-- HONEST CAVEAT, kept here rather than only in chat history: as of this
-- migration, no RPC in this codebase can edit an existing order's items —
-- place_order and staff_place_order only ever INSERT a new order. So the
-- trigger fires exactly once per order today, and this migration's diff
-- logic is currently unreachable through any real staff action. It is built
-- correctly and additively so that whenever an "edit an existing order"
-- feature exists (elsewhere, out of this migration's scope), change-KOTs
-- work automatically with zero further changes here — but until then it can
-- only be exercised synthetically (a hand-crafted second `update orders set
-- total = ...`), not through the live app. This migration does NOT add an
-- order-edit path itself — doing so would be new POS functionality, outside
-- what was asked.
-- ============================================================================

alter table cafes add column if not exists kot_print_on_update boolean not null default true;
comment on column cafes.kot_print_on_update is
  'When an order is edited after its first KOT already printed, queue a small KOT UPDATE delta ticket. Does not affect the first (new-order) KOT, which always prints.';

-- ── Delta payload builder ───────────────────────────────────────────────────
-- Mirrors build_kot_payload's station-filter/join logic exactly, but instead
-- of returning every current item, diffs the CURRENT item set against the
-- most recent ticket already sent to this printer for this order (kot or a
-- prior kot_update — print_jobs.payload IS the history, no new orders-side
-- column needed) and returns only the delta. Same no-price/no-tax invariant
-- as build_kot_payload: qty/name/modifiers/note only.
create or replace function build_kot_update_payload(p_order_id uuid, p_printer_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_order      record;
  v_printer    record;
  v_curr_items jsonb;
  v_prev_items jsonb;
  v_added      jsonb;
  v_removed    jsonb;
begin
  select o.id, o.short_code, o.source, o.notes, o.created_at, o.cafe_id, o.type,
         t.label as table_label, c.timezone
    into v_order
    from orders o
    join cafes c on c.id = o.cafe_id
    left join cafe_tables t on t.id = o.table_id
   where o.id = p_order_id;
  if v_order.id is null then return null; end if;

  select * into v_printer from kot_printers where id = p_printer_id;
  if v_printer.id is null then return null; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'qty', oi.qty,
           'name', oi.name,
           'modifiers', coalesce((select jsonb_agg(m->>'name') from jsonb_array_elements(oi.modifiers) m), '[]'::jsonb),
           'note', oi.instructions
         )), '[]'::jsonb)
    into v_curr_items
    from order_items oi
    left join menu_items mi on mi.id = oi.menu_item_id
    left join menu_categories mc on mc.id = mi.category_id
   where oi.order_id = p_order_id
     and (v_printer.station_id is null or mc.station_id = v_printer.station_id);

  -- Reconstruct what the kitchen currently believes is on the ticket by
  -- FOLDING every prior job for this (order, printer), not just reading the
  -- latest one: a 'kot' contributes its full item list as the starting
  -- baseline, and each later 'kot_update' contributes a signed delta
  -- (+added, -removed). Summing all of these per (name, modifiers, note) is
  -- equivalent to folding them in chronological order, since every update's
  -- added/removed already IS the net delta needed to reach that update's
  -- state from the one before it. Reading only the single latest row here
  -- would be wrong from a second edit onward: a 'kot_update' payload has no
  -- 'items' key at all (it has added/removed), so the baseline would
  -- silently reset to empty and every still-present item would wrongly
  -- reappear as "added" on the next edit.
  select coalesce(jsonb_agg(jsonb_build_object('name', name, 'modifiers', modifiers, 'note', note, 'qty', qty)), '[]'::jsonb)
    into v_prev_items
    from (
      select name, modifiers, note, sum(qty) as qty
        from (
          select (e->>'name') as name, coalesce(e->'modifiers', '[]'::jsonb) as modifiers,
                 (e->>'note') as note, (e->>'qty')::int as qty
            from print_jobs pj, jsonb_array_elements(pj.payload -> 'items') e
           where pj.order_id = p_order_id and pj.printer_id = p_printer_id and pj.kind = 'kot'
          union all
          select (e->>'name'), coalesce(e->'modifiers', '[]'::jsonb), (e->>'note'), (e->>'qty')::int
            from print_jobs pj, jsonb_array_elements(pj.payload -> 'added') e
           where pj.order_id = p_order_id and pj.printer_id = p_printer_id and pj.kind = 'kot_update'
          union all
          select (e->>'name'), coalesce(e->'modifiers', '[]'::jsonb), (e->>'note'), -(e->>'qty')::int
            from print_jobs pj, jsonb_array_elements(pj.payload -> 'removed') e
           where pj.order_id = p_order_id and pj.printer_id = p_printer_id and pj.kind = 'kot_update'
        ) contributions
       group by name, modifiers, note
      having sum(qty) <> 0
    ) folded;

  -- Group both sides by (name, modifiers, note) and diff the quantities. A
  -- positive delta is newly added; negative is removed. Unchanged lines
  -- (delta = 0) produce nothing — a ticket with no real change never queues.
  with cur as (
    select (e->>'name') as name, coalesce(e->'modifiers', '[]'::jsonb) as modifiers,
           (e->>'note') as note, sum((e->>'qty')::int) as qty
      from jsonb_array_elements(v_curr_items) e
     group by 1, 2, 3
  ),
  prev as (
    select (e->>'name') as name, coalesce(e->'modifiers', '[]'::jsonb) as modifiers,
           (e->>'note') as note, sum((e->>'qty')::int) as qty
      from jsonb_array_elements(v_prev_items) e
     group by 1, 2, 3
  ),
  diff as (
    select coalesce(cur.name, prev.name) as name,
           coalesce(cur.modifiers, prev.modifiers) as modifiers,
           coalesce(cur.note, prev.note) as note,
           coalesce(cur.qty, 0) - coalesce(prev.qty, 0) as delta
      from cur
      full outer join prev
        on cur.name is not distinct from prev.name
       and cur.modifiers is not distinct from prev.modifiers
       and cur.note is not distinct from prev.note
  )
  select
    coalesce(jsonb_agg(jsonb_build_object('qty', delta, 'name', name, 'modifiers', modifiers, 'note', note)
                        order by name) filter (where delta > 0), '[]'::jsonb),
    coalesce(jsonb_agg(jsonb_build_object('qty', -delta, 'name', name, 'modifiers', modifiers, 'note', note)
                        order by name) filter (where delta < 0), '[]'::jsonb)
    into v_added, v_removed
    from diff;

  -- Nothing actually changed for this station (e.g. total moved because of a
  -- discount, not an item) — no update ticket, not a blank one.
  if jsonb_array_length(v_added) = 0 and jsonb_array_length(v_removed) = 0 then
    return null;
  end if;

  return jsonb_build_object(
    'kot_number', v_order.short_code,
    'order_id', v_order.id,
    'table_label', v_order.table_label,
    'order_type', v_order.type,
    'source', v_order.source,
    'placed_at', now(),
    'timezone', coalesce(v_order.timezone, 'Asia/Kolkata'),
    'station', (select name from kitchen_stations where id = v_printer.station_id),
    'paper_width', v_printer.paper_width,
    'copies', v_printer.copies,
    'added', v_added,
    'removed', v_removed,
    'order_note', nullif(trim(coalesce(v_order.notes, '')), '')
  );
end $$;

-- Internal-only, same lockdown posture as build_kot_payload after 0141: only
-- reachable from other SECURITY DEFINER functions (enqueue_kot_jobs below),
-- never granted to a client role directly.
revoke execute on function build_kot_update_payload(uuid, uuid) from public, anon, authenticated;

-- ── Rework the trigger adapter to use it ────────────────────────────────────
-- Same trigger (trg_orders_enqueue_kot, unchanged, still fires on any
-- total-changing UPDATE) — only the function body changes. First KOT for an
-- order behaves exactly as before (kind='kot', full ticket). A later
-- total-change, when a 'kot' job already exists, now enqueues a small
-- kind='kot_update' delta instead of silently doing nothing — gated by the
-- café's kot_print_on_update switch so "print on edit" can be turned off
-- independently of "print on new order" (which always stays on).
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
    -- Same as 0027: printing must never fail an order.
    null;
  end;
  return new;
end $$;
