-- 0008 — Restore UPI columns the multi-tenant rewrite dropped from cafes.
-- The QR menu page selects upi_id/upi_name (payments deep-link) and Settings
-- writes them; without the columns the café lookup errors and every customer
-- QR page 404s. Idempotent and non-destructive.

alter table cafes add column if not exists upi_id text;
alter table cafes add column if not exists upi_name text;
