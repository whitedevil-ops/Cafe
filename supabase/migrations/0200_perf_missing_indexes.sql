-- ============================================================================
-- 0200 — Two heavily-queried columns have no supporting index:
-- order_items.order_id, and orders(cafe_id, status, created_at).
--
-- order_items.order_id backs the per-order item lookup done on every order
-- placement (reading back what was just inserted) and every KDS/receipt
-- render that joins order_items to its parent order. orders(cafe_id, status,
-- created_at) backs the KDS poll (active orders for a cafe, newest first —
-- every few seconds, per cafe, all day) and every report/history query that
-- filters a cafe's orders by status and orders them by created_at. Neither
-- had a composite index sized for that exact access pattern (schema.sql has
-- separate single/two-column indexes on orders, and an auto-named index on
-- order_items(order_id) that may or may not still be present depending on
-- how each environment was provisioned) — hence `if not exists` on both
-- statements below, so this is a safe no-op wherever the coverage already
-- exists and a real fix wherever it doesn't.
--
-- CONCURRENTLY: both tables take live inserts continuously (every order,
-- every KDS update) in production, so these are built CONCURRENTLY —
-- Postgres builds the index without holding the lock that would otherwise
-- block concurrent inserts/updates on the table for the duration of the
-- build.
--
-- RUNNER NOTE — do not paste this whole file into the SQL Editor and run it
-- as one block like every other migration in this repo (see DEPLOY.md §3).
-- CREATE INDEX CONCURRENTLY cannot run inside a transaction block, and a
-- multi-statement paste is executed by Postgres as one implicit transaction
-- block, so it will fail with "CREATE INDEX CONCURRENTLY cannot run inside a
-- transaction block" if run that way. No prior migration in this repo uses
-- CONCURRENTLY, so there is no existing file-naming/runner-flag convention
-- to defer to here — instead, run the two CREATE INDEX statements below one
-- at a time, each as its own separate SQL Editor submission.
-- ============================================================================

create index concurrently if not exists order_items_order_id_idx on order_items (order_id);

create index concurrently if not exists orders_cafe_status_created_idx on orders (cafe_id, status, created_at desc);
