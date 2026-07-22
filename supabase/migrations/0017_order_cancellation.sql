-- ============================================================================
-- 0017 — Order cancellation with a required reason: the one real gap in
-- Financial Control that was blocking staff from fixing a mistake at all.
-- One RPC used from both the Kitchen board and the Live Tables drawer (same
-- action, two surfaces — not two implementations). The audit trigger for
-- this was already added in 0016 and stayed dormant until now; this
-- migration is what activates it.
--
-- Rules, enforced server-side (not just hidden in the client):
--   * Already completed/cancelled orders can't be re-cancelled.
--   * Paid orders can't be cancelled here — refunds are a separate,
--     not-yet-built feature, and silently cancelling a paid order would
--     leave a payments row with no corresponding live order, a real
--     financial-reporting inconsistency. Staff are told to reverse the
--     payment with a manager instead of the mutation silently happening.
--   * Once the kitchen has started (preparing/ready/served), cancelling
--     needs a manager or owner — a placed-but-not-started order can be
--     cancelled by anyone on staff, since it's very likely just a mistake.
--   * A reason is mandatory — this is what makes the audit trail useful.
-- ============================================================================

alter table orders add column if not exists cancel_reason text;

create or replace function cancel_order(p_order_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_cafe_id       uuid;
  v_status        order_status;
  v_payment_status payment_status;
  v_role          member_role;
begin
  select cafe_id, status, payment_status into v_cafe_id, v_status, v_payment_status
    from orders where id = p_order_id;
  if v_cafe_id is null then raise exception 'order not found'; end if;

  select role into v_role from cafe_members where cafe_id = v_cafe_id and user_id = auth.uid();
  if v_role is null then raise exception 'not authorized for this café'; end if;

  if v_status in ('completed', 'cancelled') then
    raise exception 'this order is already % and cannot be cancelled', v_status;
  end if;

  if v_payment_status in ('paid', 'partial') then
    raise exception 'this order has payment recorded against it — cancelling it needs a refund (not available yet); reverse the payment with a manager first';
  end if;

  if v_status in ('preparing', 'ready', 'served') and v_role not in ('owner', 'manager') then
    raise exception 'the kitchen has already started this order — a manager or owner needs to cancel it';
  end if;

  if p_reason is null or trim(p_reason) = '' then
    raise exception 'a cancellation reason is required';
  end if;

  update orders set status = 'cancelled', cancel_reason = trim(p_reason) where id = p_order_id;
end $$;

revoke execute on function cancel_order(uuid, text) from public, anon;
grant execute on function cancel_order(uuid, text) to authenticated;

-- ── Extend the 0016 audit trigger to carry the reason now that one exists ──
create or replace function audit_order_cancelled() returns trigger
language plpgsql as $$
begin
  if new.status = 'cancelled' and old.status is distinct from 'cancelled' then
    insert into audit_logs (cafe_id, actor_id, action, entity, entity_id, meta)
    values (new.cafe_id, auth.uid(), 'order.cancelled', 'orders', new.id,
            jsonb_build_object('short_code', new.short_code, 'total', new.total, 'reason', new.cancel_reason));
  end if;
  return new;
end $$;
