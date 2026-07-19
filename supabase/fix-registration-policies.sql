-- Repair: café-registration RLS policies. Safe to run repeatedly.
-- Fixes both:
--   * "new row violates row-level security policy for cafes" (missing INSERT policy)
--   * café created but onboarding still errors on cafes (missing owner SELECT policy
--     for the insert().select() read-back, before membership exists)

drop policy if exists "create own" on cafes;
create policy "create own" on cafes
  for insert to authenticated
  with check (owner_id = auth.uid());

drop policy if exists "owner read" on cafes;
create policy "owner read" on cafes
  for select to authenticated
  using (owner_id = auth.uid());

drop policy if exists "bootstrap owner" on cafe_members;
create policy "bootstrap owner" on cafe_members
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (select 1 from cafes c where c.id = cafe_id and c.owner_id = auth.uid())
  );

-- Diagnostic — run this and read the output. You should see BOTH a "create own"
-- (cmd=INSERT) and an "owner read" (cmd=SELECT) row scoped to {authenticated}.
select policyname, cmd, roles::text from pg_policies where tablename = 'cafes' order by cmd;
