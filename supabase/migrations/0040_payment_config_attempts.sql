-- ============================================================================
-- 0040 — Payment configuration + the UPI payment-attempt lifecycle.
--
-- Audited first (do not duplicate): `payments` already exists (immutable
-- money records, insert-audited by trg_payments_audit from 0016), the
-- payment_method enum already includes 'upi', payment_status already has
-- unpaid/partial/paid/refunded (though nothing set 'partial' before this),
-- and cafes.upi_id/upi_name already exist. This migration ADDS structured
-- config and an attempt lifecycle around that — it does not replace anything.
--
-- CORE SAFETY PRINCIPLE (spec §9/§16): opening a UPI app is not payment.
-- A `payment_attempt` is a customer INTENT. Real money is only ever a row in
-- `payments`, written by a staff member confirming receipt (0041). No code
-- path turns an attempt into a payment automatically.
-- ============================================================================

-- ── Café payment configuration ─────────────────────────────────────────────
alter table cafes add column if not exists upi_enabled     boolean not null default false;
alter table cafes add column if not exists payment_qr_url  text;
-- How QR customers may pay: pay later at the counter, prepay online, or both.
alter table cafes add column if not exists qr_payment_mode text not null default 'pay_later';
do $$ begin
  alter table cafes add constraint cafes_qr_payment_mode_chk
    check (qr_payment_mode in ('pay_later', 'prepaid', 'both'));
exception when duplicate_object then null; end $$;

-- A café that already entered a UPI ID clearly wants UPI on — turn it on so
-- existing config surfaces, rather than silently hiding it behind a new flag.
update cafes set upi_enabled = true
 where upi_enabled = false and upi_id is not null and trim(upi_id) <> '';

-- ── Extra columns on the immutable payment record ──────────────────────────
-- These annotate WHO confirmed a payment and by what route, keeping "manual"
-- and (future) "gateway" payments distinguishable per spec §11. The row stays
-- write-once — we only ever INSERT payments, never UPDATE them.
alter table payments add column if not exists reference    text;   -- UTR / txn id (never treated as proof)
alter table payments add column if not exists confirmed_by uuid references profiles(id) on delete set null;
alter table payments add column if not exists source       text not null default 'manual'; -- manual | upi_manual | gateway
alter table payments add column if not exists attempt_id   uuid;

-- ── The attempt lifecycle ──────────────────────────────────────────────────
create table if not exists payment_attempts (
  id           uuid primary key default gen_random_uuid(),
  cafe_id      uuid not null references cafes(id) on delete cascade,
  order_id     uuid references orders(id) on delete cascade,
  session_id   uuid references table_sessions(id) on delete cascade,
  amount       integer not null check (amount > 0),  -- SERVER-computed at creation, never client-supplied
  method       payment_method not null default 'upi',
  status       text not null default 'initiated',    -- initiated | claimed | confirmed | cancelled
  reference    text,                                 -- customer-entered UTR — untrusted, informational only
  created_at   timestamptz not null default now(),
  claimed_at   timestamptz,
  confirmed_at timestamptz,
  confirmed_by uuid references profiles(id) on delete set null,
  payment_id   uuid references payments(id) on delete set null,
  constraint payment_attempts_status_chk check (status in ('initiated','claimed','confirmed','cancelled'))
);
create index if not exists payment_attempts_cafe_idx on payment_attempts (cafe_id, created_at desc);
create index if not exists payment_attempts_order_idx on payment_attempts (order_id);
create index if not exists payment_attempts_pending_idx on payment_attempts (cafe_id) where status = 'claimed';

alter table payments add constraint payments_attempt_fk
  foreign key (attempt_id) references payment_attempts(id) on delete set null;

alter table payment_attempts enable row level security;
-- Members may READ attempts for their café (to see pending "customer says
-- they paid" claims). No insert/update/delete policy at all: every write is
-- through a SECURITY DEFINER function (0041), so an attempt can never be
-- forged into a confirmed state by a direct table write.
drop policy if exists "member read" on payment_attempts;
create policy "member read" on payment_attempts for select using (is_cafe_member(cafe_id));

-- ── Realtime so a confirmed payment flips the table green everywhere ────────
do $$
begin
  if not exists (select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'payments') then
    alter publication supabase_realtime add table payments;
  end if;
  if not exists (select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'payment_attempts') then
    alter publication supabase_realtime add table payment_attempts;
  end if;
end $$;
