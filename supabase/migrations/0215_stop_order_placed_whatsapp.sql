-- ============================================================================
-- 0215 — Stop sending the "order placed" WhatsApp message. Keep the "bill"
-- message exactly as it is, firing once, when payment is actually recorded.
--
-- WHY: the "order placed" message bakes the total into fixed template text at
-- the moment the order is CREATED (lib/whatsapp.ts, sendWhatsAppOrderPlaced —
-- `Rs${total}` is a literal template parameter, not a live-rendered link).
-- If a café ever adds items to an already-placed order — a real feature under
-- discussion, not built yet — that message goes stale the instant a second
-- item lands on the same bill, with no trigger anywhere to correct or resend
-- it (checked: enqueue_bill_whatsapp only fires on payment_status changing to
-- 'paid', enqueue_order_placed_whatsapp only fires once on insert — nothing
-- fires on order_items or orders.total changing). The "bill" message has no
-- such problem: it is sent from /api/whatsapp/auto-send, which does a live
-- SELECT total FROM orders right before sending, so whatever the order grew
-- to by the time it is actually paid is exactly what goes out. Sending only
-- that one message removes the staleness question entirely, and — since each
-- send is a separate Meta Cloud API business-initiated template message per
-- lib/whatsapp.ts's own header comment — halves the template-message cost
-- per order at the same time.
--
-- WHAT THIS DOES: drops the trigger that enqueues an 'order_placed' row into
-- whatsapp_logs at order creation. The trigger, not the sender — the
-- alternative (leaving the enqueue running and just never calling
-- sendWhatsAppOrderPlaced) would pile up 'pending' whatsapp_logs rows for a
-- send that will never happen, which is exactly the kind of silent
-- accumulating mess this schema's own migrations have been written all
-- along to avoid.
--
-- WHAT THIS DELIBERATELY LEAVES ALONE:
--   - enqueue_bill_whatsapp and its two triggers (on 'completed' status and
--     on payment_status='paid') — unchanged. The bill message still fires
--     exactly as it does today.
--   - The enqueue_order_placed_whatsapp() FUNCTION itself — left in place,
--     just detached. Re-enabling later (if the café ever wants the early
--     ping back, e.g. once "add to current bill" ships and this stops being
--     a staleness risk) is then a one-line CREATE TRIGGER, not a rewrite.
--   - /api/whatsapp/auto-send — still the single endpoint both the QR flow
--     and POS fire-and-forget right after placing/paying an order. It
--     already just "sends whatever's pending for this order"; with nothing
--     ever enqueuing an 'order_placed' row, it naturally has nothing of that
--     type to send, with no code branch needing to change.
--   - The WHATSAPP_ORDER_TEMPLATE_NAME env var and the Meta-side template
--     itself — the operator's own call, made outside this migration.
-- ============================================================================

drop trigger if exists on_order_placed_whatsapp on orders;

-- ── self-check ─────────────────────────────────────────────────────────────
do $$
begin
  if exists (select 1 from pg_trigger where tgname = 'on_order_placed_whatsapp') then
    raise exception 'on_order_placed_whatsapp trigger is still attached — the order-placed message would still send';
  end if;

  -- The function staying in place is deliberate, not an oversight — assert
  -- it is still there so a future migration can re-attach it with one line
  -- rather than needing to rewrite the whole thing from a doc comment.
  if (select count(*) from pg_proc where proname = 'enqueue_order_placed_whatsapp') <> 1 then
    raise exception 'enqueue_order_placed_whatsapp function was removed — it was only meant to be detached';
  end if;

  -- The bill message's two triggers must be completely untouched by this.
  if not exists (select 1 from pg_trigger where tgname = 'on_order_completed_whatsapp') then
    raise exception 'on_order_completed_whatsapp (bill trigger) is missing — this migration must not have touched it';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'on_order_paid_whatsapp') then
    raise exception 'on_order_paid_whatsapp (bill trigger) is missing — this migration must not have touched it';
  end if;
end $$;
