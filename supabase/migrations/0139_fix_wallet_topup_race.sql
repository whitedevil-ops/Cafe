-- ============================================================================
-- 0139 — CRITICAL: wallet_confirm_topup checked "already confirmed?" BEFORE
--        acquiring its advisory lock, not after, so two overlapping calls for
--        the SAME payment_attempts row could both pass the guard and both
--        credit the wallet — a double-credit race.
--
-- CONFIRMED BY A 12-AGENT AUDIT WITH INDEPENDENT ADVERSARIAL RE-VERIFICATION.
--
-- wallet_confirm_topup (0093:33-59) is now correctly locked to service_role
-- only (0119 already fixed the grant — this migration touches none of that),
-- so this is not an externally-reachable authorization hole. It IS a real
-- concurrency bug: it is invoked from the Razorpay webhook route
-- (app/api/payments/razorpay/webhook/[token]/route.ts:120-124) using the
-- service-role admin client, and Razorpay is explicitly documented to
-- redeliver the same webhook event on timeout/non-2xx/network retry — a
-- second delivery for the same payment is an expected, routine occurrence,
-- not a hypothetical.
--
-- THE RACE
-- The old body did, in order:
--   1. select * into v_attempt from payment_attempts where id = p_attempt_id;
--   2. if v_attempt.status = 'confirmed' then return; end if;      -- ← check
--   3. perform pg_advisory_xact_lock(...);                          -- ← lock
--   4. insert into wallet_transactions (...) ...;
--   5. update payment_attempts set status = 'confirmed' ...;
-- Under READ COMMITTED (Postgres's default, and this function sets none of
-- its own), step 1 in call B can read status = 'initiated'/'claimed' while
-- call A is still mid-transaction — A hasn't committed step 5 yet. B then
-- passes the step-2 guard, same as A did, and both proceed to step 3. The
-- advisory lock DOES serialize step 3 onward — but by the time B acquires it
-- (after A commits and releases it), B is still working off the STALE
-- `v_attempt.status` it captured in step 1, before the lock, and never
-- re-checks it. B inserts a SECOND wallet_transactions credit for the same
-- payment. This is not a theoretical window: it is a routine webhook-retry
-- shape landing squarely in it.
--
-- THE FIX — two independent layers, per the standing rule that a lock
-- reordering alone is "trust the logic"; a hard constraint is "prove it":
--
--  1. LOGIC: re-read `status` from a fresh SELECT taken AFTER the advisory
--     lock is acquired, and check THAT value, not the pre-lock snapshot.
--     READ COMMITTED gives every statement in the transaction its own
--     snapshot, so once B actually holds the lock (meaning A has committed
--     and released it), B's post-lock SELECT is guaranteed to observe A's
--     committed 'confirmed' status and return early — the exact guarantee
--     the original code assumed it had but didn't, because it evaluated the
--     guard before the point of serialization instead of after it.
--
--  2. CONSTRAINT: a partial unique index on wallet_transactions so that even
--     a future refactor that reintroduces this class of bug (or a lock-key
--     hash collision, however unlikely) cannot silently double-insert — the
--     database itself rejects the second row. This mirrors the existing
--     `payments_provider_payment_uq` pattern (0045:50-52) exactly, applied to
--     the equivalent column on this table. Postgres raises `unique_violation`
--     on the second insert; the function catches specifically that and
--     returns (a no-op), rather than letting a raw error bubble up — the
--     webhook route treats any RPC error as delivery failure and returns
--     HTTP 500 (route.ts:124), which would make Razorpay retry indefinitely
--     against a payment that has, in fact, already been credited correctly.
--     A caught, silent no-op on unique_violation is the correct terminal
--     state, identical in effect to the ordinary "already confirmed" return.
--
-- wallet_cash_topup (0093:62-121) was audited in the same pass and does NOT
-- have this bug: it has no pre-lock status check to race — it acquires its
-- advisory lock (line 90) before doing anything status-dependent, and each
-- cash top-up is a fresh staff-initiated action with no retry-redelivery
-- semantics behind it. No change needed there.
--
-- Razorpay itself — its webhook route, signature verification, retry
-- behaviour, credentials, checkout flow — is completely untouched. This
-- migration only redefines a SQL function body and adds one DB constraint.
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

  -- Re-read status AFTER the lock, not before. If a concurrent call for this
  -- exact attempt already committed while this call was blocked waiting for
  -- the lock, this SELECT now sees its committed 'confirmed' status and
  -- returns here — closing the window where both calls could observe
  -- 'pending' and both proceed to credit.
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
    -- The wallet_transactions_topup_payment_uq backstop caught a duplicate
    -- that the lock/status check above should already have prevented. The
    -- payment was already credited by whichever call won the race; this
    -- call is a no-op, not a failure, so the webhook must not see an error.
    return;
  end;

  update payment_attempts
     set status = 'confirmed', confirmed_at = now(), provider_payment_id = p_provider_payment_id
   where id = p_attempt_id;
end $$;

-- Grants are already correct (0119: service_role only) — untouched here.

-- ── Hard backstop: the same provider_payment_id can never be credited to
-- the wallet twice, no matter what path produced a second insert attempt.
create unique index if not exists wallet_transactions_topup_payment_uq
  on wallet_transactions (provider_payment_id)
  where kind = 'topup' and provider_payment_id is not null;

do $$
begin
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public' and tablename = 'wallet_transactions'
      and indexname = 'wallet_transactions_topup_payment_uq'
  ) then
    raise exception 'wallet_transactions_topup_payment_uq backstop index was not created';
  end if;
end $$;
