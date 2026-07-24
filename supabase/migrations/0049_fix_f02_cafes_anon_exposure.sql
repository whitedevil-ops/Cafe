-- ============================================================================
-- 0049 — F-02: stop leaking the whole cafes row to anonymous visitors.
--
-- BEFORE: `create policy "public brand" on cafes for select to anon using (true)`
-- gave anon row access, and because RLS is ROW-level (not column-level) the
-- default table grant let anyone read EVERY column of EVERY café:
-- owner_id, email, phone, gstin, razorpay_account_id, subscription_ends_at…
-- i.e. the entire customer list + business PII of the platform, unauthenticated.
--
-- FIX: keep the row policy (the public QR menu genuinely needs to read a café),
-- but restrict WHICH COLUMNS the anon role may select, using column-level
-- GRANTs — the only mechanism Postgres offers for column scoping.
--
-- The granted set is exactly what the anonymous surface actually reads:
--   app/t/[token]/page.tsx  -> name, logo_url, upsell_threshold,
--                              accept_pay_counter, online_payments_enabled,
--                              razorpay_status  (+ id for the .eq('id',…) filter)
--   lib/db.ts listOpenOrders -> id, slug   (legacy KDS café lookup)
-- Nothing else. razorpay_key_id is deliberately NOT granted: it is a public
-- key by design but the anon surface has no use for it.
--
-- NOT affected: `authenticated` keeps full column access through the existing
-- "member read"/"owner read" policies, and every SECURITY DEFINER function
-- (place_order, get_receipt, …) runs as the definer, so GST invoices and
-- receipts still render every field they need.
-- ============================================================================

-- Column privileges only bite once the blanket table privilege is gone.
revoke select on cafes from anon;

grant select (
  id,
  slug,
  name,
  logo_url,
  upsell_threshold,
  accept_pay_counter,
  online_payments_enabled,
  razorpay_status
) on cafes to anon;

-- NOTE: supabase/00-reset.sql contains
--   `alter default privileges in schema public grant all on tables to anon`
-- which would re-grant full column access to any table created afterwards.
-- That default applies to NEW tables only, so `cafes` stays restricted — but
-- if 00-reset.sql is ever re-run against a live project, re-apply this file.
