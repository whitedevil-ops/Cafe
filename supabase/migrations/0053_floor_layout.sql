-- ============================================================================
-- 0053 — Visual floor & table layout (#1).
--
-- Adds named areas/floors and a RESPONSIVE table position map. Positions are
-- stored NORMALISED (0..1 of the canvas) so the same layout renders correctly
-- at any screen size — never pixel coordinates tied to one resolution.
--
-- RBAC: editing the layout is owner/manager only, enforced by the
-- save_floor_layout RPC (has_cafe_role) — not just the UI. Operational table
-- writes (status changes, the existing manage screen) are unchanged; only the
-- layout-editing path is privileged.
-- ============================================================================

create table if not exists floor_areas (
  id         uuid primary key default gen_random_uuid(),
  cafe_id    uuid not null references cafes(id) on delete cascade,
  name       text not null,
  sort       integer not null default 0,
  archived   boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists floor_areas_cafe_idx on floor_areas (cafe_id);

alter table floor_areas enable row level security;
drop policy if exists "member read" on floor_areas;
create policy "member read" on floor_areas for select using (is_cafe_member(cafe_id));
-- Writes only through the owner/manager RPC below (two layers, like 0050).
revoke insert, update, delete on floor_areas from anon, authenticated;

-- Layout columns on cafe_tables (kept nullable so existing tables are valid).
alter table cafe_tables add column if not exists area_id  uuid references floor_areas(id) on delete set null;
alter table cafe_tables add column if not exists pos_x    numeric(6,4);   -- 0..1
alter table cafe_tables add column if not exists pos_y    numeric(6,4);   -- 0..1
alter table cafe_tables add column if not exists shape    text not null default 'square'
  check (shape in ('square', 'rectangle', 'round'));
alter table cafe_tables add column if not exists archived boolean not null default false;

-- ── The one atomic, owner/manager-gated "Save & Lock Layout" write ─────────
-- p_areas:  [{id?, name, sort, archived}]
-- p_tables: [{id?, label, capacity, shape, area_id, pos_x, pos_y, archived}]
-- New rows (no id) are inserted; existing rows are updated by id, scoped to the
-- café so another café's row can never be touched.
create or replace function save_floor_layout(p_cafe_id uuid, p_areas jsonb, p_tables jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a jsonb; t jsonb;
begin
  if not has_cafe_role(p_cafe_id, array['owner','manager']::member_role[]) then
    raise exception 'only an owner or manager can edit the floor layout';
  end if;

  for a in select * from jsonb_array_elements(coalesce(p_areas, '[]'::jsonb)) loop
    if nullif(a->>'id', '') is not null then
      update floor_areas set
        name     = coalesce(nullif(trim(a->>'name'), ''), name),
        sort     = coalesce((a->>'sort')::int, sort),
        archived = coalesce((a->>'archived')::boolean, false)
      where id = (a->>'id')::uuid and cafe_id = p_cafe_id;
    else
      insert into floor_areas (cafe_id, name, sort, archived)
      values (p_cafe_id, coalesce(nullif(trim(a->>'name'), ''), 'Area'),
              coalesce((a->>'sort')::int, 0), coalesce((a->>'archived')::boolean, false));
    end if;
  end loop;

  for t in select * from jsonb_array_elements(coalesce(p_tables, '[]'::jsonb)) loop
    if nullif(t->>'id', '') is not null then
      update cafe_tables set
        label    = coalesce(nullif(trim(t->>'label'), ''), label),
        capacity = nullif(t->>'capacity', '')::int,
        shape    = coalesce(nullif(t->>'shape', ''), 'square'),
        area_id  = nullif(t->>'area_id', '')::uuid,
        pos_x    = nullif(t->>'pos_x', '')::numeric,
        pos_y    = nullif(t->>'pos_y', '')::numeric,
        archived = coalesce((t->>'archived')::boolean, false)
      where id = (t->>'id')::uuid and cafe_id = p_cafe_id;
    else
      insert into cafe_tables (cafe_id, label, capacity, shape, area_id, pos_x, pos_y, token, status)
      values (p_cafe_id, coalesce(nullif(trim(t->>'label'), ''), 'T'),
              nullif(t->>'capacity', '')::int, coalesce(nullif(t->>'shape', ''), 'square'),
              nullif(t->>'area_id', '')::uuid, nullif(t->>'pos_x', '')::numeric, nullif(t->>'pos_y', '')::numeric,
              encode(gen_random_bytes(9), 'hex'), 'available');
    end if;
  end loop;

  insert into audit_logs (cafe_id, actor_id, action, entity, entity_id, meta)
  values (p_cafe_id, auth.uid(), 'floor.layout_saved', 'cafe_tables', null,
          jsonb_build_object('areas', jsonb_array_length(coalesce(p_areas, '[]'::jsonb)),
                             'tables', jsonb_array_length(coalesce(p_tables, '[]'::jsonb))));

  return jsonb_build_object('ok', true);
end $$;
revoke execute on function save_floor_layout(uuid, jsonb, jsonb) from public, anon;
grant execute on function save_floor_layout(uuid, jsonb, jsonb) to authenticated;
