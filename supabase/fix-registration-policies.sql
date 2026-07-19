-- Repair: café-registration RLS policies.
-- Run if "Create café" fails with: new row violates row-level security policy for "cafes".
-- Safe to run repeatedly. This is already part of schema.sql; this file just re-applies
-- the two policies in case a partial schema run left them out.

drop policy if exists "create own" on cafes;
create policy "create own" on cafes
  for insert to authenticated
  with check (owner_id = auth.uid());

drop policy if exists "bootstrap owner" on cafe_members;
create policy "bootstrap owner" on cafe_members
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (select 1 from cafes c where c.id = cafe_id and c.owner_id = auth.uid())
  );

-- Verify (should list "create own" with cmd = INSERT, roles = {authenticated}):
--   select policyname, cmd, roles::text from pg_policies where tablename = 'cafes';
