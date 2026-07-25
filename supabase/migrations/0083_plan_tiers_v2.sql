-- ============================================================================
-- 0083 — Real 3-tier pricing (Starter/Growth/Scale) the owner is actually
-- selling at ₹10,000 / ₹18,000 / ₹25,000 per year, 50% off on renewal.
--
-- Three things this fixes:
--
-- 1. Display names only — "pro" and "business" keys are untouched (nothing
--    in app code hardcodes these strings, confirmed by grep; they're pure
--    data per 0019's own comment), just renamed to what's actually sold.
--    "trial" stays internal — it's the pre-paid onboarding state, not one of
--    the 3 plans on the pricing page.
--
-- 2. price_yearly / renewal_price_yearly are NEW, reference-only columns for
--    the platform-admin UI. They are NOT wired into platform_billing_state /
--    the Razorpay Subscription flow (0074) — that still bills price_monthly
--    on a monthly cycle via razorpay_plan_id. Actually re-pointing live
--    checkout at annual billing + a 50%-renewal discount needs new Razorpay
--    Plan objects and renewal-cycle logic; that is separate, unbuilt work,
--    called out on purpose rather than silently left half-done.
--
-- 3. Feature differentiation — "pro" and "business" had byte-identical
--    features since 0019 (only price differed). Now: Growth adds the
--    revenue-growth tools (online payments, coupons, loyalty, sms bills,
--    feedback, expenses) over Starter; Scale adds the ops/analytics layer
--    (inventory + recipes + purchases, advanced reports) over Growth.
--    sms_bills was true for every paid tier including starter since 0019 —
--    that was never actually enforced anywhere until this migration adds
--    the gate (see app/api/sms/retry/route.ts), so tightening it to Growth+
--    now is a real behavior change, not just paperwork.
-- ============================================================================

update platform_plans set name = 'Growth' where key = 'pro';
update platform_plans set name = 'Scale' where key = 'business';

alter table platform_plans add column if not exists price_yearly integer;
alter table platform_plans add column if not exists renewal_price_yearly integer;

update platform_plans set price_yearly = 10000, renewal_price_yearly = 5000  where key = 'starter';
update platform_plans set price_yearly = 18000, renewal_price_yearly = 9000  where key = 'pro';
update platform_plans set price_yearly = 25000, renewal_price_yearly = 12500 where key = 'business';

-- New real feature keys (online_payments, feedback, expenses), each now
-- actually checked by app code — see app/api/payments/razorpay/connect,
-- app/dashboard/feedback/page.tsx, app/dashboard/expenses/page.tsx.
update platform_plans set features = features || '{"online_payments": false, "feedback": false, "expenses": false, "sms_bills": false}'::jsonb where key = 'trial';
update platform_plans set features = features || '{"online_payments": false, "feedback": false, "expenses": false, "sms_bills": false}'::jsonb where key = 'starter';
update platform_plans set features = features || '{"online_payments": true,  "feedback": true,  "expenses": true,  "sms_bills": true,
                                                     "inventory": false, "advanced_reports": false}'::jsonb where key = 'pro';
update platform_plans set features = features || '{"online_payments": true,  "feedback": true,  "expenses": true,  "sms_bills": true,
                                                     "inventory": true,  "advanced_reports": true}'::jsonb  where key = 'business';
