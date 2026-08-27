-- ============================================================================
-- WhatsApp: a second message at order placement, alongside the existing paid
-- receipt (0156). Two independent whatsapp_logs rows per order now:
--   * type = 'order_placed' — fires once, right when the order is created
--     (phone present). New trigger, AFTER INSERT.
--   * type = 'bill'         — previously fired on status -> 'completed'
--     (kitchen/fulfillment done), which is the wrong signal for "the bill is
--     ready" — a customer can be marked payment-due long after food is
--     served, or pay instantly online before the kitchen even starts. Re-wired
--     to fire on payment_status -> 'paid' instead, which is what "send the
--     bill" actually means. Re-bodies enqueue_bill_whatsapp and re-points its
--     trigger at payment_status; the function/table/RLS from 0156 are
--     otherwise untouched.
-- ============================================================================

create or replace function enqueue_order_placed_whatsapp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.phone is not null then
    insert into whatsapp_logs (cafe_id, order_id, customer_id, phone_masked, type, status)
    values (new.cafe_id, new.id, new.customer_id, '******' || right(new.phone, 4), 'order_placed', 'pending');
  end if;
  return new;
end $$;

drop trigger if exists on_order_placed_whatsapp on orders;
create trigger on_order_placed_whatsapp
  after insert on orders for each row execute function enqueue_order_placed_whatsapp();

create or replace function enqueue_bill_whatsapp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.payment_status = 'paid'::payment_status and old.payment_status is distinct from 'paid'::payment_status and new.phone is not null then
    insert into whatsapp_logs (cafe_id, order_id, customer_id, phone_masked, type, status)
    values (new.cafe_id, new.id, new.customer_id, '******' || right(new.phone, 4), 'bill', 'pending');
  end if;
  return new;
end $$;

drop trigger if exists on_order_completed_whatsapp on orders;
create trigger on_order_paid_whatsapp
  after update of payment_status on orders for each row execute function enqueue_bill_whatsapp();

-- ── self-check ───────────────────────────────────────────────────────────
do $$
begin
  if (select count(*) from pg_proc where proname = 'enqueue_order_placed_whatsapp') <> 1 then
    raise exception 'enqueue_order_placed_whatsapp: expected exactly one overload';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'on_order_placed_whatsapp') then
    raise exception 'on_order_placed_whatsapp trigger missing';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'on_order_paid_whatsapp') then
    raise exception 'on_order_paid_whatsapp trigger missing';
  end if;
  if exists (select 1 from pg_trigger where tgname = 'on_order_completed_whatsapp') then
    raise exception 'on_order_completed_whatsapp: old trigger should have been dropped';
  end if;
end $$;
