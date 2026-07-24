-- ============================================================================
-- 0054 — Active-table safety for the floor editor.
--
-- Moving a table's position, renaming it, or moving it between floors is always
-- safe (identity is the immutable cafe_tables.id — never the label). But
-- ARCHIVING/removing a table that currently has a live dining session would
-- orphan that session's running bill. Block it, with a clear message, and tell
-- the owner to finish or transfer the session first.
--
-- Replaces save_floor_layout (0053) — body identical except for the guard.
-- ============================================================================

create or replace function save_floor_layout(p_cafe_id uuid, p_areas jsonb, p_tables jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a jsonb; t jsonb; v_archiving boolean;
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
      v_archiving := coalesce((t->>'archived')::boolean, false);

      -- Refuse to archive a table that is mid-service.
      if v_archiving and exists (
        select 1 from table_sessions s
        where s.table_id = (t->>'id')::uuid
          and s.cafe_id = p_cafe_id
          and s.status in ('active', 'bill_requested')
      ) then
        raise exception 'Table % has an active session — finish or move it before removing it',
          coalesce(nullif(trim(t->>'label'), ''), 'this one');
      end if;

      update cafe_tables set
        label    = coalesce(nullif(trim(t->>'label'), ''), label),
        capacity = nullif(t->>'capacity', '')::int,
        shape    = coalesce(nullif(t->>'shape', ''), 'square'),
        area_id  = nullif(t->>'area_id', '')::uuid,
        pos_x    = nullif(t->>'pos_x', '')::numeric,
        pos_y    = nullif(t->>'pos_y', '')::numeric,
        archived = v_archiving
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
