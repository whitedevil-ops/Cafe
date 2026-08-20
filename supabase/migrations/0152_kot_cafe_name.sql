-- ============================================================================
-- 0152 — KOT tickets show the café's own name, not KhaoPiyo's platform brand.
--
-- Neither build_kot_payload nor build_kot_update_payload ever selected
-- cafes.name at all — the ticket renderers (lib/kot-print.ts, escpos.rs) had
-- no café name to print, so they hardcoded "KhaoPiyo" in the footer instead.
-- Re-bodies three functions, all with unchanged signatures (no arity change):
-- build_kot_payload(uuid, uuid), build_kot_update_payload(uuid, uuid),
-- test_print(uuid).
-- ============================================================================

create or replace function build_kot_payload(p_order_id uuid, p_printer_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_order    record;
  v_printer  record;
  v_items    jsonb;
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
         ) order by oi.id), '[]'::jsonb)
    into v_items
    from order_items oi
    left join menu_items mi on mi.id = oi.menu_item_id
    left join menu_categories mc on mc.id = mi.category_id
   where oi.order_id = p_order_id
     and (v_printer.station_id is null or mc.station_id = v_printer.station_id);

  if jsonb_array_length(v_items) = 0 then return null; end if;

  return jsonb_build_object(
    'kot_number', v_order.short_code,
    'order_id', v_order.id,
    'cafe_name', v_order.cafe_name,
    'table_label', v_order.table_label,
    'order_type', v_order.type,
    'source', v_order.source,
    'placed_at', v_order.created_at,
    'timezone', coalesce(v_order.timezone, 'Asia/Kolkata'),
    'station', (select name from kitchen_stations where id = v_printer.station_id),
    'paper_width', v_printer.paper_width,
    'copies', v_printer.copies,
    'items', v_items,
    'order_note', nullif(trim(coalesce(v_order.notes, '')), '')
  );
end $$;

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

create or replace function test_print(p_printer_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_printer record; v_job uuid; v_cafe_name text;
begin
  select * into v_printer from kot_printers where id = p_printer_id;
  if v_printer.id is null then raise exception 'printer not found'; end if;
  if not is_cafe_member(v_printer.cafe_id) then raise exception 'not authorized'; end if;

  select name into v_cafe_name from cafes where id = v_printer.cafe_id;

  insert into print_jobs (cafe_id, printer_id, station_id, kind, payload, requested_by)
  values (v_printer.cafe_id, v_printer.id, v_printer.station_id, 'test',
          jsonb_build_object(
            'kot_number', 'TEST',
            'cafe_name', v_cafe_name,
            'placed_at', now(),
            'timezone', (select coalesce(timezone,'Asia/Kolkata') from cafes where id = v_printer.cafe_id),
            'paper_width', v_printer.paper_width,
            'copies', 1,
            'station', (select name from kitchen_stations where id = v_printer.station_id),
            'items', jsonb_build_array(jsonb_build_object(
              'qty', 1, 'name', 'Test print — KhaoPiyo', 'modifiers', '[]'::jsonb, 'note', null)),
            'order_note', 'If you can read this, the printer is configured correctly.'
          ), auth.uid())
  returning id into v_job;
  return v_job;
end $$;
