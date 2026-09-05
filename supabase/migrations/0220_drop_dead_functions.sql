-- ============================================================================
-- 0220 — Drop 9 SQL functions confirmed to have zero callers.
--
-- Found during a full dead-code audit: each of these has zero `.rpc()` call
-- sites anywhere in app/components/lib, zero internal SQL-to-SQL callers, and
-- no trigger wiring it to a table event. Verified individually below.
--
-- create_staff_invite(uuid, text, member_role) — superseded by the direct
--   staff-account creation flow (0085_direct_staff_accounts.sql); production
--   has 0 rows in cafe_invites. Confirmed dead in 0197's own comment.
--
-- customer_verify_otp(text, text, text, text) — the customer OTP login path
--   was reverted the same day it shipped (0089_revert_login_to_no_otp.sql),
--   back to customer_start_session with no OTP step. Never re-enabled.
--
-- is_valid_gstin(text) — a GSTIN-format helper with no caller anywhere;
--   GSTIN validation happens client-side instead.
--
-- qr_start_upi_payment(uuid), qr_claim_payment(uuid, text),
--   pending_payment_claims(uuid) — the manual-UPI flow from 0040/0041,
--   explicitly superseded by Razorpay in 0045 ("nothing calls them anymore" —
--   0045's own words). pending_payment_claims is the staff-facing companion
--   to qr_claim_payment; since nothing can ever create a 'claimed' row for it
--   to read anymore, it's dead alongside its producer.
--
-- wallet_balance_for_customer(uuid, uuid), wallet_pay_for_order(uuid, text,
--   uuid) — superseded by customer_wallet_state/wallet_overview and
--   wallet_pay_order (differently named, differently signed, both live and
--   .rpc()-called) from the same 0091 wallet feature.
--
-- close_abandoned_table_sessions(int) — written by 0202, run ONCE inline to
--   clear a backlog, granted to service_role only (nothing in the app could
--   have called it via the client). 0208 replaced it with a completely
--   separate per-café function, close_abandoned_sessions_for_cafe, which
--   stays — it's live and .rpc()-called from floor-client.tsx. This original
--   one was never called again after its one-time backfill.
--
-- Deliberately NOT touched here (found in the same audit, left alone):
--   - enqueue_order_placed_whatsapp() — 0215 explicitly keeps this in place
--     for future reactivation ("a one-line CREATE TRIGGER, not a rewrite").
--   - The 'referral' feature's backend (customer_referral_state,
--     list_referrals, award_referral_reward_on_payment, customer_referrals
--     table) — fully wired but with zero frontend surface left anywhere.
--     This is a real feature-removal decision (same shape as feedback/0219),
--     not a mechanical dead-function drop, and needs its own deliberate
--     migration once decided.
-- ============================================================================

drop function if exists create_staff_invite(uuid, text, member_role);
drop function if exists customer_verify_otp(text, text, text, text);
drop function if exists is_valid_gstin(text);
drop function if exists qr_start_upi_payment(uuid);
drop function if exists qr_claim_payment(uuid, text);
drop function if exists pending_payment_claims(uuid);
drop function if exists wallet_balance_for_customer(uuid, uuid);
drop function if exists wallet_pay_for_order(uuid, text, uuid);
drop function if exists close_abandoned_table_sessions(int);

-- ── self-check ─────────────────────────────────────────────────────────────
do $$
begin
  if exists (
    select 1 from pg_proc
    where proname in (
      'create_staff_invite', 'customer_verify_otp', 'is_valid_gstin',
      'qr_start_upi_payment', 'qr_claim_payment', 'pending_payment_claims',
      'wallet_balance_for_customer', 'wallet_pay_for_order',
      'close_abandoned_table_sessions'
    )
  ) then
    raise exception 'one or more dead functions were not dropped';
  end if;

  -- Guard against having accidentally dropped the still-live, differently-
  -- named/signed functions from the same features.
  if not exists (select 1 from pg_proc where proname = 'close_abandoned_sessions_for_cafe') then
    raise exception 'close_abandoned_sessions_for_cafe was removed by mistake — it is still live';
  end if;
  if not exists (select 1 from pg_proc where proname = 'wallet_pay_order') then
    raise exception 'wallet_pay_order was removed by mistake — it is still live';
  end if;
  if not exists (select 1 from pg_proc where proname = 'customer_wallet_state') then
    raise exception 'customer_wallet_state was removed by mistake — it is still live';
  end if;
  if not exists (select 1 from pg_proc where proname = 'customer_start_session') then
    raise exception 'customer_start_session was removed by mistake — it is still live';
  end if;
end $$;
