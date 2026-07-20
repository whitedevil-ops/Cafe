-- CLEAN RESET — wipes the public schema and restores Supabase's default grants.
-- Run this ONLY when there is no real data yet (dev/test). It deletes all app
-- tables and rows. auth.users lives in the `auth` schema and is NOT affected, so
-- your login still works. After this, run schema.sql then platform-admin.sql.

drop schema if exists public cascade;
create schema public;

grant usage on schema public to postgres, anon, authenticated, service_role;
grant all on schema public to postgres, service_role;

alter default privileges in schema public grant all on tables    to postgres, anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to postgres, anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to postgres, anon, authenticated, service_role;
