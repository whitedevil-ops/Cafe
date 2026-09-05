-- ============================================================================
-- 0221 — Fix build_kot_update_payload: FULL JOIN on jsonb with IS NOT
-- DISTINCT FROM throws, so no "add items to bill" ever produced a KOT.
--
-- REPRODUCED LIVE: calling build_kot_update_payload directly on a real order
-- returned:
--   ERROR: 0A000: FULL JOIN is only supported with merge-joinable or
--   hash-joinable join conditions
-- pointing at the `cur full outer join prev on cur.name is not distinct
-- from prev.name and cur.modifiers is not distinct from prev.modifiers and
-- cur.note is not distinct from prev.note` clause added in 0151. Postgres
-- does not support IS NOT DISTINCT FROM as a FULL JOIN condition on jsonb
-- (modifiers) — it isn't hash- or merge-joinable for that operator/type
-- combination.
--
-- Consequence: this function has thrown on every call since 0151 shipped.
-- It was never caught because trg_orders_enqueue_kot's enqueue_kot_jobs()
-- wraps its whole body in `exception when others then null` (printing must
-- never fail an order) — and per 0151's own header, this code path was
-- "unreachable through any real staff action" until append_order_items
-- (0218) gave staff a way to edit an order after its first KOT. The very
-- first real use of this diff logic hit the bug immediately: items append
-- to the bill fine (that's a separate function), but zero KOT UPDATE
-- tickets have ever actually been queued, for any café.
--
-- FIX: replace the cur/prev FULL JOIN with the same signed-UNION-ALL +
-- GROUP BY + SUM pattern this function already uses two paragraphs earlier
-- to fold prior kot/kot_update jobs into v_prev_items — mathematically
-- identical to `coalesce(cur.qty,0) - coalesce(prev.qty,0)`, but with no
-- JOIN at all, so the jsonb/IS NOT DISTINCT FROM restriction never applies.
-- Everything else in the function (item snapshot, station filter, payload
-- shape) is untouched — copied verbatim from 0152.
-- ============================================================================

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
         t.label as table_label, c.timezone, c.name as cafe_name
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

  -- Unchanged from 0152: fold every prior job for this (order, printer) into
  -- what the kitchen currently believes is on the ticket.
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

  -- FIXED: same "signed rows in, group by, sum" idiom as above instead of a
  -- FULL JOIN — current items contribute +qty, previous items contribute
  -- -qty, and summing per (name, modifiers, note) gives exactly
  -- coalesce(cur.qty,0) - coalesce(prev.qty,0) without ever joining on jsonb.
  with combined as (
    select (e->>'name') as name, coalesce(e->'modifiers', '[]'::jsonb) as modifiers,
           (e->>'note') as note, sum((e->>'qty')::int) as qty
      from jsonb_array_elements(v_curr_items) e
     group by 1, 2, 3
    union all
    select (e->>'name') as name, coalesce(e->'modifiers', '[]'::jsonb) as modifiers,
           (e->>'note') as note, -sum((e->>'qty')::int) as qty
      from jsonb_array_elements(v_prev_items) e
     group by 1, 2, 3
  ),
  diff as (
    select name, modifiers, note, sum(qty) as delta
      from combined
     group by name, modifiers, note
  )
  select
    coalesce(jsonb_agg(jsonb_build_object('qty', delta, 'name', name, 'modifiers', modifiers, 'note', note)
                        order by name) filter (where delta > 0), '[]'::jsonb),
    coalesce(jsonb_agg(jsonb_build_object('qty', -delta, 'name', name, 'modifiers', modifiers, 'note', note)
                        order by name) filter (where delta < 0), '[]'::jsonb)
    into v_added, v_removed
    from diff
   where delta <> 0;

  if jsonb_array_length(v_added) = 0 and jsonb_array_length(v_removed) = 0 then
    return null;
  end if;

  return jsonb_build_object(
    'kot_number', v_order.short_code,
    'order_id', v_order.id,
    'cafe_name', v_order.cafe_name,
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

revoke execute on function build_kot_update_payload(uuid, uuid) from public, anon, authenticated;

-- ── self-check: prove the algorithm itself is correct, without touching
-- real orders/printers (the function reads those by id, so it can't be unit
-- tested with synthetic arrays directly — this replicates its diff logic
-- inline against known inputs instead). ─────────────────────────────────────
do $$
declare
  v_curr jsonb := '[{"qty":1,"name":"Burger","modifiers":[],"note":null},
                     {"qty":1,"name":"Coke","modifiers":[],"note":null},
                     {"qty":1,"name":"Fries","modifiers":[],"note":null}]'::jsonb;
  v_prev jsonb := '[{"qty":1,"name":"Burger","modifiers":[],"note":null},
                     {"qty":1,"name":"Coke","modifiers":[],"note":null}]'::jsonb;
  v_added   jsonb;
  v_removed jsonb;
begin
  with combined as (
    select (e->>'name') as name, coalesce(e->'modifiers', '[]'::jsonb) as modifiers,
           (e->>'note') as note, sum((e->>'qty')::int) as qty
      from jsonb_array_elements(v_curr) e group by 1, 2, 3
    union all
    select (e->>'name') as name, coalesce(e->'modifiers', '[]'::jsonb) as modifiers,
           (e->>'note') as note, -sum((e->>'qty')::int) as qty
      from jsonb_array_elements(v_prev) e group by 1, 2, 3
  ),
  diff as (
    select name, modifiers, note, sum(qty) as delta from combined group by name, modifiers, note
  )
  select
    coalesce(jsonb_agg(jsonb_build_object('qty', delta, 'name', name)) filter (where delta > 0), '[]'::jsonb),
    coalesce(jsonb_agg(jsonb_build_object('qty', -delta, 'name', name)) filter (where delta < 0), '[]'::jsonb)
    into v_added, v_removed
    from diff where delta <> 0;

  if jsonb_array_length(v_added) <> 1 or (v_added->0->>'name') <> 'Fries' then
    raise exception 'self-check failed: expected exactly Fries as added, got %', v_added;
  end if;
  if jsonb_array_length(v_removed) <> 0 then
    raise exception 'self-check failed: expected nothing removed, got %', v_removed;
  end if;
end $$;
