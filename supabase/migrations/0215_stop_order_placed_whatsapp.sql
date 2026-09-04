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
-- CORRECTION (this file failed and rolled back on its first real run —
-- fixed in place rather than superseded, since nothing had actually applied
-- yet; see the self-check below for exactly what was wrong): the original
-- version of this migration asserted that trigger on_order_completed_whatsapp
-- must still exist. That assertion was wrong. 0156 created it (fired on
-- orders.status changing); 0157 — the very next migration — deliberately
-- DROPPED it and replaced it with on_order_paid_whatsapp (fired on
-- payment_status changing instead), because "status='completed'" is the
-- wrong signal for "send the bill" — an order can be completed by the
-- kitchen without being paid yet. That consolidation has been the live,
-- correct state ever since 0157. This file read 0156 without checking
-- whether a later migration superseded it, and demanded a trigger that was
-- SUPPOSED to be gone — so the whole script rolled back and the
-- "order placed" message kept sending. Confirmed live: whatsapp_logs had
-- order_placed rows 'sent' minutes after this migration had supposedly run.
--
-- WHAT THIS DELIBERATELY LEAVES ALONE:
--   - enqueue_bill_whatsapp and its one live trigger, on_order_paid_whatsapp
--     (payment_status='paid', since 0157) — unchanged. The bill message
--     still fires exactly as it does today. on_order_completed_whatsapp is
--     NOT expected to exist — 0157 removed it on purpose, and it must stay
--     gone; that is exactly the assertion this correction fixes.
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

  -- The ONE correct bill trigger, live since 0157, must be completely
  -- untouched by this.
  if not exists (select 1 from pg_trigger where tgname = 'on_order_paid_whatsapp') then
    raise exception 'on_order_paid_whatsapp (the one bill trigger, since 0157) is missing — this migration must not have touched it';
  end if;
  -- And it must NOT be back — 0157 removed it deliberately; its reappearance
  -- would mean the bill message fires twice on an order whose status and
  -- payment_status both change in the same UPDATE.
  if exists (select 1 from pg_trigger where tgname = 'on_order_completed_whatsapp') then
    raise exception 'on_order_completed_whatsapp exists — 0157 deliberately removed this trigger and it should not be back';
  end if;
end $$;
