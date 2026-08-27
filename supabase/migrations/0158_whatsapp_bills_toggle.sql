-- ============================================================================
-- WhatsApp bill sending: enable on the mid/high plans (Growth, Scale) by
-- default — same tiers sms_bills already got in 0083 — and give the café
-- owner their own on/off switch in Settings, same pattern as
-- cafes.kot_printing_enabled (0027).
--
-- The owner toggle gates the ENQUEUE triggers directly (0156/0157), not just
-- the send routes: when off, no whatsapp_logs row is created at all, so
-- there's nothing sitting pending and nothing for staff to see half-wired.
-- The plan entitlement (cafe_has_feature) stays checked separately, in
-- app/api/whatsapp/retry and app/api/whatsapp/auto-send, same as before —
-- this migration only adds the second, owner-controlled gate on top of it.
-- ============================================================================

alter table cafes add column if not exists whatsapp_bills_enabled boolean not null default true;

update platform_plans set features = features || '{"whatsapp_bills": true}'::jsonb where key in ('pro', 'business');

create or replace function enqueue_order_placed_whatsapp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.phone is not null and (select whatsapp_bills_enabled from cafes where id = new.cafe_id) then
    insert into whatsapp_logs (cafe_id, order_id, customer_id, phone_masked, type, status)
    values (new.cafe_id, new.id, new.customer_id, '******' || right(new.phone, 4), 'order_placed', 'pending');
  end if;
  return new;
end $$;

create or replace function enqueue_bill_whatsapp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.payment_status = 'paid'::payment_status and old.payment_status is distinct from 'paid'::payment_status
     and new.phone is not null and (select whatsapp_bills_enabled from cafes where id = new.cafe_id) then
    insert into whatsapp_logs (cafe_id, order_id, customer_id, phone_masked, type, status)
    values (new.cafe_id, new.id, new.customer_id, '******' || right(new.phone, 4), 'bill', 'pending');
  end if;
  return new;
end $$;

-- ── self-check ───────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from information_schema.columns where table_name = 'cafes' and column_name = 'whatsapp_bills_enabled') then
    raise exception 'cafes.whatsapp_bills_enabled column missing';
  end if;
  if exists (select 1 from platform_plans where key in ('pro','business') and not (features->>'whatsapp_bills')::boolean) then
    raise exception 'whatsapp_bills should be true on pro/business plans';
  end if;
  if exists (select 1 from platform_plans where key in ('trial','starter') and (features->>'whatsapp_bills')::boolean) then
    raise exception 'whatsapp_bills should stay false on trial/starter plans';
  end if;
end $$;
