-- 0006 — Restore columns the multi-tenant rewrite dropped from orders.
-- place_order() (0002/0003) inserts phone + payment_method, and the kitchen
-- screen reads payment_method — without these, ANY QR order fails at the RPC.
-- Idempotent and non-destructive.

alter table orders add column if not exists phone text;
alter table orders add column if not exists payment_method payment_method;
