-- ============================================================================
-- Full-audit finding, low: create_reservation correctly checks
-- cafe_has_feature(p_cafe_id, 'reservations'), but list_reservations and
-- set_reservation_status do not — the same "UI hides the button but the RPC
-- still works" bypass class closed elsewhere for wallet (migration 0182).
-- Real-world impact was small precisely because creation is gated (nothing
-- to leak on a café never entitled) — the residual exposure is a café that
-- had reservations under a higher plan and later downgraded: it would keep
-- full read plus status-management (seat/cancel/no-show) access to those
-- existing reservations with no server-side check, only a hidden nav
-- link/page redirect.
-- ============================================================================

create or replace function set_reservation_status(p_reservation_id uuid, p_status text, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_cafe_id uuid; v_notes text;
begin
  select cafe_id, notes into v_cafe_id, v_notes from reservations where id = p_reservation_id;
  if v_cafe_id is null then raise exception 'reservation not found'; end if;
  if not has_cafe_role(v_cafe_id, array['owner','manager','cashier','waiter']::member_role[]) then
    raise exception 'your role cannot update reservations';
  end if;
  if not cafe_has_feature(v_cafe_id, 'reservations') then
    raise exception 'reservations are not available on this plan';
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

create or replace function list_reservations(p_cafe_id uuid, p_from timestamptz, p_to timestamptz)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not is_cafe_member(p_cafe_id) then raise exception 'not authorized'; end if;
  if not cafe_has_feature(p_cafe_id, 'reservations') then
    raise exception 'reservations are not available on this plan';
  end if;

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

-- ── self-check ───────────────────────────────────────────────────────────
do $$
begin
  if (select count(*) from pg_proc where proname = 'set_reservation_status') <> 1 then
    raise exception 'set_reservation_status: expected exactly one overload';
  end if;
  if (select count(*) from pg_proc where proname = 'list_reservations') <> 1 then
    raise exception 'list_reservations: expected exactly one overload';
  end if;
end $$;
