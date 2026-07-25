-- ============================================================================
-- 0066 — Notification Centre: role-scoped, four new event types.
--
-- BEFORE: "member all" on notifications meant every role saw every event —
-- kitchen staff got billing pings, accountants got "customer called waiter".
-- Only 3 event types existed at all (new_order, bill_requested, call_waiter).
--
-- AFTER: visibility is routed by TYPE through one deterministic function
-- (notification_target_roles) — same "explainable rule, not a fake AI"
-- standard already used for v_customer_stats' segment logic. Four new event
-- types close real gaps:
--   low_stock      — an inventory_items trigger, fires only on the CROSSING
--                     from >= min_stock to < min_stock (not every movement
--                     while already low, which would spam).
--   payment_failed — Razorpay's payment.failed webhook event was previously
--                     silently ignored entirely (webhook route only handled
--                     payment.captured) — staff had zero visibility that a
--                     customer's online payment attempt failed.
--   refund         — refund_order already existed; it just never told anyone.
--   late_ticket    — no scheduled-job infrastructure exists in this project
--                     (same reason loyalty point expiry wasn't built), so
--                     this is a client-triggered RPC the kitchen board's
--                     existing poll loop calls periodically, idempotent per
--                     order via the new notifications.order_id column.
-- ============================================================================

alter table notifications add column if not exists order_id uuid references orders(id) on delete set null;

-- ── The one place that decides who sees what ────────────────────────────────
create or replace function notification_target_roles(p_type text)
returns member_role[] language sql immutable as $$
  select case p_type
    when 'new_order'      then array['owner','manager','cashier','kitchen','waiter']::member_role[]
    when 'bill_requested'  then array['owner','manager','cashier','waiter']::member_role[]
    when 'call_waiter'     then array['owner','manager','waiter']::member_role[]
    when 'low_stock'       then array['owner','manager']::member_role[]
    when 'payment_failed'  then array['owner','manager','cashier']::member_role[]
    when 'refund'          then array['owner','manager','accountant']::member_role[]
    when 'late_ticket'     then array['owner','manager','kitchen']::member_role[]
    -- An unrecognised type defaults to admin-only, never silently to
    -- everyone — the safe failure direction for a routing rule.
    else array['owner','manager']::member_role[]
  end;
$$;

drop policy if exists "member all" on notifications;

create policy "role scoped read" on notifications for select using (
  exists (
    select 1 from cafe_members cm
    where cm.cafe_id = notifications.cafe_id and cm.user_id = auth.uid()
      and cm.role = any(notification_target_roles(notifications.type))
  )
);

-- Marking read is the one legitimate direct client write on this table
-- (NotificationBell does it today) — scoped by the same predicate so a role
-- can't touch a notification it was never allowed to see.
create policy "role scoped mark read" on notifications for update using (
  exists (
    select 1 from cafe_members cm
    where cm.cafe_id = notifications.cafe_id and cm.user_id = auth.uid()
      and cm.role = any(notification_target_roles(notifications.type))
  )
) with check (
  exists (
    select 1 from cafe_members cm
    where cm.cafe_id = notifications.cafe_id and cm.user_id = auth.uid()
      and cm.role = any(notification_target_roles(notifications.type))
  )
);

revoke insert, delete on notifications from authenticated, anon;

-- ── low_stock: fires once per crossing, not once per movement ──────────────
create or replace function notify_low_stock() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.current_stock < new.min_stock
     and (tg_op = 'INSERT' or old.current_stock >= old.min_stock) then
    insert into notifications (cafe_id, type, message)
    values (new.cafe_id, 'low_stock',
            new.name || ' is low — ' || new.current_stock || ' ' || new.unit || ' left (min ' || new.min_stock || ')');
  end if;
  return new;
end $$;

drop trigger if exists trg_notify_low_stock on inventory_items;
create trigger trg_notify_low_stock
  after insert or update on inventory_items
  for each row execute function notify_low_stock();

-- ── late_ticket: client-triggered (no scheduled-job infra in this project),
-- idempotent per order via notifications.order_id. Same 8-minute threshold
-- the kitchen board already highlights visually (kitchen-client.tsx). ──────
create or replace function flag_late_tickets(p_cafe_id uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare v_count integer;
begin
  if not is_cafe_member(p_cafe_id) then raise exception 'not authorized'; end if;

  insert into notifications (cafe_id, type, message, table_id, session_id, order_id)
  select o.cafe_id, 'late_ticket',
         'Order #' || o.short_code || ' has been waiting ' ||
           (extract(epoch from (now() - o.created_at))::int / 60) || ' min',
         o.table_id, o.session_id, o.id
  from orders o
  where o.cafe_id = p_cafe_id
    and o.status in ('placed', 'preparing')
    and o.created_at < now() - interval '8 minutes'
    and not exists (select 1 from notifications n where n.type = 'late_ticket' and n.order_id = o.id);

  get diagnostics v_count = row_count;
  return v_count;
end $$;

revoke execute on function flag_late_tickets(uuid) from public, anon;
grant execute on function flag_late_tickets(uuid) to authenticated;

-- ── refund: refund_order already existed (0028) — it just never told
-- anyone. Identical signature, pure addition to the body. ──────────────────
create or replace function refund_order(
  p_order_id uuid,
  p_reason   text,
  p_method   text default null,
  p_amount   integer default null,
  p_items    jsonb default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_order        record;
  v_role         member_role;
  v_limit        integer;
  v_already      integer;
  v_remaining    integer;
  v_amount       integer := 0;
  v_kind         text;
  v_method       payment_method;
  v_refund_id    uuid;
  v_item         jsonb;
  v_oi           record;
  v_qty          integer;
  v_prior_qty    integer;
  v_line_value   integer;
  v_share        integer;
  v_priced       jsonb := '[]'::jsonb;
begin
  select o.id, o.cafe_id, o.total, o.subtotal, o.payment_status, o.payment_method, o.short_code, o.table_id, o.session_id
    into v_order
    from orders o where o.id = p_order_id;
  if v_order.id is null then raise exception 'order not found'; end if;

  select role into v_role from cafe_members
   where cafe_id = v_order.cafe_id and user_id = auth.uid() and status = 'active';
  if v_role is null then raise exception 'not authorized for this café'; end if;
  if v_role not in ('owner', 'manager', 'cashier') then
    raise exception 'your role cannot issue refunds';
  end if;

  if p_reason is null or trim(p_reason) = '' then
    raise exception 'a refund reason is required';
  end if;

  if v_order.payment_status <> 'paid' then
    raise exception 'this order is not marked paid — there is nothing to refund';
  end if;

  v_already := order_refunded_total(p_order_id);
  v_remaining := v_order.total - v_already;
  if v_remaining <= 0 then raise exception 'this order has already been fully refunded'; end if;

  v_method := coalesce(nullif(p_method, '')::payment_method, v_order.payment_method, 'cash');

  if p_items is not null and jsonb_array_length(p_items) > 0 then
    v_kind := 'item';

    for v_item in select * from jsonb_array_elements(p_items) loop
      select oi.id, oi.price, oi.qty, oi.name into v_oi
        from order_items oi
       where oi.id = (v_item->>'order_item_id')::uuid and oi.order_id = p_order_id;
      if v_oi.id is null then raise exception 'item does not belong to this order'; end if;

      v_qty := greatest(1, coalesce((v_item->>'qty')::int, 1));

      select coalesce(sum(ri.qty), 0) into v_prior_qty
        from refund_items ri
        join refunds r on r.id = ri.refund_id
       where ri.order_item_id = v_oi.id and r.status = 'completed';
      if v_prior_qty + v_qty > v_oi.qty then
        raise exception 'cannot refund % × % — only % of that line remain unrefunded',
          v_qty, v_oi.name, v_oi.qty - v_prior_qty;
      end if;

      v_line_value := v_oi.price * v_qty;
      v_share := case when v_order.subtotal > 0
                      then round(v_order.total::numeric * v_line_value / v_order.subtotal)::integer
                      else v_line_value end;

      v_priced := v_priced || jsonb_build_object(
        'order_item_id', v_oi.id, 'qty', v_qty, 'amount', v_share);
      v_amount := v_amount + v_share;
    end loop;

    v_amount := least(v_amount, v_remaining);
    if v_amount <= 0 then raise exception 'refund amount resolved to zero'; end if;

  else
    v_amount := coalesce(p_amount, v_remaining);
    if v_amount <= 0 then raise exception 'refund amount must be greater than zero'; end if;
    if v_amount > v_remaining then
      raise exception 'cannot refund ₹% — only ₹% of this order remains unrefunded', v_amount, v_remaining;
    end if;
    v_kind := case when v_amount = v_order.total and v_already = 0 then 'full' else 'partial' end;
  end if;

  select refund_approval_limit into v_limit from cafes where id = v_order.cafe_id;
  if v_role = 'cashier' and v_amount > coalesce(v_limit, 500) then
    raise exception 'refunds above ₹% need a manager or owner', coalesce(v_limit, 500);
  end if;

  insert into refunds (cafe_id, order_id, amount, method, kind, reason, refunded_by, approved_by)
  values (v_order.cafe_id, p_order_id, v_amount, v_method, v_kind, trim(p_reason), auth.uid(),
          case when v_role in ('owner','manager') then auth.uid() end)
  returning id into v_refund_id;

  if v_kind = 'item' then
    insert into refund_items (refund_id, order_item_id, qty, amount)
    select v_refund_id, (x->>'order_item_id')::uuid, (x->>'qty')::int, (x->>'amount')::int
      from jsonb_array_elements(v_priced) x;
  end if;

  if v_already + v_amount >= v_order.total then
    update orders set payment_status = 'refunded' where id = p_order_id;
  end if;

  insert into audit_logs (cafe_id, actor_id, action, entity, entity_id, meta)
  values (v_order.cafe_id, auth.uid(), 'order.refunded', 'orders', p_order_id,
          jsonb_build_object(
            'refund_id', v_refund_id, 'amount', v_amount, 'kind', v_kind,
            'method', v_method, 'reason', trim(p_reason), 'role', v_role,
            'order_total', v_order.total, 'previously_refunded', v_already));

  insert into notifications (cafe_id, type, message, table_id, session_id, order_id)
  values (v_order.cafe_id, 'refund',
          '₹' || v_amount || ' refunded on order #' || v_order.short_code || ' — ' || trim(p_reason),
          v_order.table_id, v_order.session_id, p_order_id);

  return jsonb_build_object(
    'refund_id', v_refund_id, 'amount', v_amount, 'kind', v_kind,
    'remaining', v_order.total - (v_already + v_amount));
end $$;

revoke execute on function refund_order(uuid, text, text, integer, jsonb) from public, anon;
grant execute on function refund_order(uuid, text, text, integer, jsonb) to authenticated;

-- ── payment_failed: the check constraint never had a 'failed' state ────────
alter table payment_attempts drop constraint if exists payment_attempts_status_chk;
alter table payment_attempts add constraint payment_attempts_status_chk
  check (status in ('initiated', 'claimed', 'confirmed', 'cancelled', 'failed'));
