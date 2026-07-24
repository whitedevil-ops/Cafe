-- ============================================================================
-- 0045 — Configurable counter payment methods + a Razorpay online-payment
-- abstraction. Replaces the previous manual "customer taps I-have-paid" UPI
-- flow (0040/0041) with an honest model:
--   • Pay at counter is always supported; staff record the money.
--   • Online payment is OPTIONAL and only ever "PAID" after server-side
--     provider verification — never a customer button click.
--
-- The manual-UPI columns/functions from 0040/0041 (upi_enabled,
-- qr_payment_mode, qr_start_upi_payment, qr_claim_payment) are left in place
-- but are no longer used by the app. They are NOT dropped here — that is a
-- separate, reversible cleanup — but nothing calls them anymore.
--
-- NO Razorpay SECRETS are stored in the database. Only the café's public
-- Linked Account id and a connection STATUS live here; the platform key/
-- secret and webhook secret live only in server environment variables.
-- ============================================================================

-- ── Which methods a café accepts at the counter ────────────────────────────
alter table cafes add column if not exists accept_cash        boolean not null default true;
alter table cafes add column if not exists accept_upi_counter boolean not null default true;
alter table cafes add column if not exists accept_card_counter boolean not null default true;
alter table cafes add column if not exists accept_pay_counter  boolean not null default true;

-- ── Online payments (Razorpay) ─────────────────────────────────────────────
alter table cafes add column if not exists online_payments_enabled boolean not null default false;
alter table cafes add column if not exists razorpay_status text not null default 'not_connected';
alter table cafes add column if not exists razorpay_account_id text;   -- Linked Account id (acc_...) — public, not a secret
do $$ begin
  alter table cafes add constraint cafes_razorpay_status_chk
    check (razorpay_status in ('not_connected','pending','connected','disabled'));
exception when duplicate_object then null; end $$;

-- ── Per-payment provider + verification fields ─────────────────────────────
-- Counter payments (cash/upi/card) are captured the moment staff record them,
-- so status defaults to 'captured'. Online payments move pending -> captured
-- only on verified provider confirmation.
alter table payments add column if not exists status            text not null default 'captured';
alter table payments add column if not exists provider          text;   -- 'razorpay' for online; null for counter
alter table payments add column if not exists provider_order_id text;
alter table payments add column if not exists provider_payment_id text;
alter table payments add column if not exists verified_at       timestamptz;
do $$ begin
  alter table payments add constraint payments_status_chk
    check (status in ('pending','authorized','captured','failed','cancelled','refunded'));
exception when duplicate_object then null; end $$;

-- Idempotency: a provider payment id can be recorded at most once, so a
-- duplicate webhook can never create a second payment row.
create unique index if not exists payments_provider_payment_uq
  on payments (provider, provider_payment_id)
  where provider_payment_id is not null;

-- Attempts gain the provider order id so a webhook can map back to the order.
alter table payment_attempts add column if not exists provider          text;
alter table payment_attempts add column if not exists provider_order_id text;
create index if not exists payment_attempts_provider_order_idx
  on payment_attempts (provider_order_id) where provider_order_id is not null;
