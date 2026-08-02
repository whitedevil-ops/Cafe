-- ============================================================================
-- 0119 — Fix wallet_confirm_topup: revoke authenticated, grant service_role
--
-- 0091/0093 granted this function to `authenticated` with a comment claiming
-- it was "webhook only — service_role", but never actually revoked
-- `authenticated`. The function only checks that the payment_attempts row
-- exists and isn't already confirmed — it never checks auth.uid() or any
-- ownership relation to the transaction. Any signed-in user could call it
-- directly against PostgREST with a real p_attempt_id (obtainable via the
-- legitimate wallet_start_topup flow) and credit their own wallet for free,
-- entirely bypassing the Razorpay webhook and its signature verification.
--
-- The only real caller is app/api/payments/razorpay/webhook/[token]/route.ts,
-- which already uses the service-role admin client (admin.rpc(...)) — this
-- just makes the grant match the actual caller, the same pattern already
-- used for every other service-role-only function in this codebase
-- (customer_issue_otp 0024, bridge_claim_jobs/bridge_report_job 0027,
-- issue_signup_otp/verify_signup_otp 0113).
-- ============================================================================

revoke execute on function wallet_confirm_topup(uuid, text) from authenticated;
grant execute on function wallet_confirm_topup(uuid, text) to service_role;
