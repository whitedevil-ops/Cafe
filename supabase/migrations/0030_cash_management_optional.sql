-- ============================================================================
-- 0030 — Make cash/shift management OPTIONAL per café.
--
-- The feature from 0029 is kept intact. A café that runs mostly on card/UPI,
-- or a small owner-operated counter, should not be forced through an
-- open-float / close-drawer ritual to take an order. A café that handles real
-- cash volume needs exactly that ritual.
--
-- Default is ON for cafés that already have shift history (they are using it)
-- and OFF for everyone else, so no existing workflow breaks and no new café
-- inherits a ceremony it never asked for.
--
-- NOTHING is dropped. Turning this off hides the workflow; it never deletes a
-- reconciliation record, because a closed shift is a financial document.
-- ============================================================================

alter table cafes add column if not exists cash_management_enabled boolean not null default false;

-- Any café that has already opened a shift is evidently using the feature.
update cafes c
   set cash_management_enabled = true
 where exists (select 1 from cash_shifts s where s.cafe_id = c.id);

-- Guard the write paths too, so disabling the setting is not merely cosmetic:
-- a stale browser tab or a direct RPC call cannot open a shift for a café that
-- has the feature switched off.
create or replace function open_shift(p_cafe_id uuid, p_opening_cash integer default 0)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not has_cafe_role(p_cafe_id, array['owner','manager','cashier']::member_role[]) then
    raise exception 'your role cannot open a shift';
  end if;

  if not coalesce((select cash_management_enabled from cafes where id = p_cafe_id), false) then
    raise exception 'cash management is turned off for this café';
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

-- close_shift and record_cash_movement are deliberately NOT gated on the
-- setting. If cash management is switched off while a shift is still open,
-- staff must still be able to reconcile and close it — trapping an open shift
-- would strand real money in an un-closable state.
