-- ============================================================================
-- 0033 — Turn on Supabase Realtime (Postgres Changes) for the tables the
-- kitchen, live floor view, and notification bell need to react to
-- instantly instead of waiting for their next poll.
--
-- FREE: Realtime/Postgres Changes is part of the Supabase Spark (free)
-- plan, not a paid add-on. No new external dependency, no cost.
--
-- WHY POLLING ISN'T REMOVED: this only adds a `supabase_realtime`
-- publication membership — it does not touch RLS, and it does not delete
-- any of the existing setInterval polling in the client components. A
-- dropped websocket reconnects silently; a kitchen screen that silently
-- stops updating does not. Realtime is a supplement for instant reaction,
-- polling stays as the backstop that guarantees eventual correctness even
-- if a realtime event is ever missed.
--
-- SCOPE: only the tables actually wired up in this phase (orders,
-- order_items, notifications, table_sessions) are added here — not every
-- table in the schema. Adding a table to this publication has a small,
-- real replication cost; only add what's actually subscribed to.
-- ============================================================================

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'orders'
  ) then
    alter publication supabase_realtime add table orders;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'order_items'
  ) then
    alter publication supabase_realtime add table order_items;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table notifications;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'table_sessions'
  ) then
    alter publication supabase_realtime add table table_sessions;
  end if;
end $$;
