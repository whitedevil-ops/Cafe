-- ============================================================================
-- 0122 — Let an owner/manager delete a reward outright, not just deactivate.
--
-- order_items.reward_id already references rewards(id) on delete set null
-- (0120), so a hard delete here is safe: a historical order that redeemed
-- this reward keeps its own name/price snapshot on the order_items row
-- (unchanged), it just loses the back-reference to which reward produced
-- it — the same tradeoff already accepted for menu_items being deletable.
-- loyalty_transactions has no foreign key to rewards at all (its "reason"
-- is a plain text snapshot, e.g. "Redeemed: Free Coffee"), so nothing there
-- is affected either.
-- ============================================================================

create or replace function delete_reward(p_reward_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_cafe_id uuid;
  v_role    member_role;
begin
  select cafe_id into v_cafe_id from rewards where id = p_reward_id;
  if v_cafe_id is null then raise exception 'reward not found'; end if;

  select role into v_role from cafe_members where cafe_id = v_cafe_id and user_id = auth.uid();
  if v_role is null then raise exception 'not authorized for this café'; end if;
  if v_role not in ('owner', 'manager') then
    raise exception 'only an owner or manager can delete rewards';
  end if;

  delete from rewards where id = p_reward_id;
end $$;

revoke execute on function delete_reward(uuid) from public, anon;
grant execute on function delete_reward(uuid) to authenticated;
