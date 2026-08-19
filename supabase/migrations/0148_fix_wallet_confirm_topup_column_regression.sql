-- ============================================================================
-- 0148 — URGENT: wallet_confirm_topup's final UPDATE writes to
--        payment_attempts.provider_payment_id, a column that has NEVER
--        existed on that table. This is a PRE-EXISTING bug, not something
--        introduced by this session's migrations -- it has been present,
--        unchanged, since the function was first created in migration 0091
--        (line 189), carried forward untouched through 0093 and this
--        session's own 0139 rewrite (which only reordered the status check
--        around the advisory lock; it never touched this final UPDATE).
--
-- FOUND BY A LIVE AUDIT WORKFLOW after 0137-0147 were applied, independently
-- re-verified twice from primary sources (this migration's own author read
-- the actual DDL a third time before writing this fix). payment_attempts'
-- real, current column list, built from its full migration history:
--   0040 create table: id, cafe_id, order_id, session_id, amount, method,
--        status, reference, created_at, claimed_at, confirmed_at,
--        confirmed_by, payment_id (a uuid FK to payments.id -- NOT a text
--        provider-payment-id field)
--   0045 add column:   provider, provider_order_id
--   0091 add column:   purpose, customer_id, wallet_tier_id
-- No "rename column" statement exists anywhere in the repo (grepped). There
-- is, and has only ever been, no provider_payment_id column on this table.
-- The real provider_payment_id lives on wallet_transactions (0091's own
-- create table, line 72) and on payments (0045) -- both correct, both
-- already populated correctly elsewhere in this same function and in the
-- webhook route. This UPDATE's third assignment was always wrong.
--
-- IMPACT: unlike the analogous route.ts bug (see below), this one is NOT a
-- silent no-op. It runs inside a SECURITY DEFINER plpgsql function with no
-- exception handler around it, so the undefined-column error aborts the
-- function's entire transaction -- including the wallet_transactions credit
-- insert that had just succeeded a few lines earlier. Net effect: every
-- Razorpay-triggered wallet top-up confirmation has been failing outright,
-- every single time, since 0091 first shipped -- long before this session.
-- The webhook route treats any RPC error as delivery failure and returns
-- HTTP 500, so Razorpay would retry indefinitely against a top-up that can
-- never succeed. If any café's customer has ever attempted an online wallet
-- top-up, it silently never credited them.
--
-- A SEPARATE, RELATED FINDING -- NOT FIXED HERE, FLAGGED TO THE USER INSTEAD:
-- app/api/payments/razorpay/webhook/[token]/route.ts:147 has the exact same
-- mistake (`.update({ ..., provider_payment_id: p.id })` against
-- payment_attempts, for the ordinary non-wallet order-payment path). That
-- one IS a silent no-op today -- its result is never checked, and the order
-- is correctly marked paid via the `payments` table insert a few lines above
-- regardless of whether this update succeeds -- so it does not block
-- Razorpay payments from working. It is left untouched here because it lives
-- inside the Razorpay webhook route file itself, which this whole security
-- pass has deliberately never modified, per this task's standing instruction
-- not to touch Razorpay code. Reported to the user directly instead of
-- silently fixed.
--
-- THE FIX: drop the erroneous provider_payment_id assignment from
-- wallet_confirm_topup's final UPDATE. Every other line is identical to
-- 0139's current body -- the advisory-lock race fix from that migration is
-- fully preserved, untouched.
-- ============================================================================

create or replace function wallet_confirm_topup(p_attempt_id uuid, p_provider_payment_id text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_attempt payment_attempts%rowtype;
  v_status  text;
  v_tier    wallet_topup_tiers%rowtype;
begin
  select * into v_attempt from payment_attempts where id = p_attempt_id and purpose = 'wallet_topup';
  if v_attempt.id is null then raise exception 'top-up attempt not found'; end if;

  perform pg_advisory_xact_lock(hashtext('wallet:' || v_attempt.cafe_id::text || ':' || v_attempt.customer_id::text));

  select status into v_status from payment_attempts where id = p_attempt_id;
  if v_status = 'confirmed' then return; end if;

  select * into v_tier from wallet_topup_tiers where id = v_attempt.wallet_tier_id;
  if v_tier.id is null then raise exception 'top-up tier no longer exists'; end if;

  begin
    insert into wallet_transactions (cafe_id, customer_id, kind, amount, topup_tier_id, provider_payment_id, source, paid_amount, reason)
    values (v_attempt.cafe_id, v_attempt.customer_id, 'topup', v_tier.credit_amount, v_tier.id, p_provider_payment_id,
            'online', v_tier.pay_amount,
            'Top-up: paid ₹' || v_tier.pay_amount || ', credited ₹' || v_tier.credit_amount);
  exception when unique_violation then
    return;
  end;

  update payment_attempts
     set status = 'confirmed', confirmed_at = now()
   where id = p_attempt_id;
end $$;
-- Grants unchanged (0119: service_role only).

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'payment_attempts' and column_name = 'provider_payment_id'
  ) then
    raise exception 'payment_attempts.provider_payment_id unexpectedly exists -- re-check whether the column reference this migration removed was actually valid after all';
  end if;
end $$;
