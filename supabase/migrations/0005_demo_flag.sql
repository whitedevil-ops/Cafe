-- 0005 — Demo-café identifier. One column, non-destructive, idempotent.
-- Demo isolation itself comes from tenancy (every row hangs off the demo cafe_id
-- and cascades on delete); this flag just lets the UI and reset script identify it.

alter table cafes add column if not exists is_demo boolean not null default false;
