-- ============================================================================
-- WhatsApp bill-receipt sending — a second delivery channel alongside SMS,
-- built on the exact same architecture as sms_logs/enqueue_bill_sms (0010):
--   * whatsapp_logs: delivery tracking. Full phone numbers are NOT stored
--     here (only a masked tail) — the sender reads orders.phone server-side
--     at send time, same discipline as sms_logs.
--   * enqueue_bill_whatsapp trigger: on completion, queue a WhatsApp row.
--     WhatsApp never blocks order completion; failures are recorded,
--     retryable by staff. Fires on the same event as enqueue_bill_sms, as an
--     independent row, so SMS and WhatsApp each succeed/fail/retry on their
--     own — a café can have both, either, or neither configured.
--   * whatsapp_bills: a plan feature, same shape as sms_bills (0083) — off
--     by default on every tier, an operator opts a café in from /ops
--     (app/ops/cafes/[id]/cafe-detail-client.tsx) the same way. Per-café
--     overrides below enable it immediately for the two cafés this is being
--     built/tested against, regardless of their plan tier.
-- See lib/whatsapp.ts for the sender (mirrors lib/sms.ts).
-- ============================================================================

create table if not exists whatsapp_logs (
  id           uuid primary key default gen_random_uuid(),
  cafe_id      uuid not null references cafes(id) on delete cascade,
  order_id     uuid not null references orders(id) on delete cascade,
  customer_id  uuid references customers(id) on delete set null,
  phone_masked text,
  type         text not null default 'bill',
  status       text not null default 'pending',   -- pending | sent | delivered | failed | skipped
  error        text,
  created_at   timestamptz not null default now(),
  sent_at      timestamptz,
  failed_at    timestamptz
);
create index if not exists whatsapp_logs_cafe_idx on whatsapp_logs (cafe_id, created_at desc);
create index if not exists whatsapp_logs_order_idx on whatsapp_logs (order_id);

alter table whatsapp_logs enable row level security;
drop policy if exists "member all" on whatsapp_logs;
create policy "member all" on whatsapp_logs for all
  using (is_cafe_member(cafe_id)) with check (is_cafe_member(cafe_id));

create or replace function enqueue_bill_whatsapp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'completed' and old.status is distinct from 'completed' and new.phone is not null then
    insert into whatsapp_logs (cafe_id, order_id, customer_id, phone_masked, type, status)
    values (new.cafe_id, new.id, new.customer_id, '******' || right(new.phone, 4), 'bill', 'pending');
  end if;
  return new;
end $$;

drop trigger if exists on_order_completed_whatsapp on orders;
create trigger on_order_completed_whatsapp
  after update of status on orders for each row execute function enqueue_bill_whatsapp();

-- ── plan gate: off by default everywhere, same as sms_bills started ────────
update platform_plans set features = features || '{"whatsapp_bills": false}'::jsonb;

-- ── per-café overrides: Brewora Café (live pilot) + "test" — both used to
--    build and verify this feature — get it regardless of plan tier ────────
insert into cafe_feature_overrides (cafe_id, feature_key, enabled) values
  ('c0ffee00-0000-4000-a000-000000000001', 'whatsapp_bills', true),
  ('6a0b44a1-8a32-4c30-bf78-c2c2b8d695b2', 'whatsapp_bills', true)
on conflict (cafe_id, feature_key) do update set enabled = excluded.enabled;

-- ── self-check ───────────────────────────────────────────────────────────
do $$
begin
  if (select count(*) from pg_proc where proname = 'enqueue_bill_whatsapp') <> 1 then
    raise exception 'enqueue_bill_whatsapp: expected exactly one overload';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'on_order_completed_whatsapp') then
    raise exception 'on_order_completed_whatsapp trigger missing';
  end if;
  if exists (select 1 from platform_plans where not (features ? 'whatsapp_bills')) then
    raise exception 'whatsapp_bills key missing from some plan';
  end if;
end $$;
