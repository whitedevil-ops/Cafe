-- ============================================================================
-- 0007 — Staff invites: per-café logins for cashiers/kitchen/waiters.
-- Flow: owner/manager adds an email + role in Settings → invite row. When a
-- user with that email signs up (or logs in with no café), claim_my_invites()
-- converts their invites into real cafe_members rows with the assigned role.
-- No passwords are ever handled by the café — staff set their own via signup.
-- Idempotent and non-destructive.
-- ============================================================================

create table if not exists cafe_invites (
  id         uuid primary key default gen_random_uuid(),
  cafe_id    uuid not null references cafes(id) on delete cascade,
  email      text not null,
  role       member_role not null default 'waiter',
  created_at timestamptz not null default now(),
  unique (cafe_id, email)
);

alter table cafe_invites enable row level security;

drop policy if exists "member read"  on cafe_invites;
drop policy if exists "admin insert" on cafe_invites;
drop policy if exists "admin delete" on cafe_invites;
create policy "member read" on cafe_invites for select
  using (is_cafe_member(cafe_id));
create policy "admin insert" on cafe_invites for insert
  with check (has_cafe_role(cafe_id, array['owner','manager']::member_role[]));
create policy "admin delete" on cafe_invites for delete
  using (has_cafe_role(cafe_id, array['owner','manager']::member_role[]));

-- Claims every invite matching the caller's verified email. SECURITY DEFINER so
-- it can write cafe_members without the caller having prior membership; scoped
-- hard to auth.uid()'s own email, so it can never join anyone else.
create or replace function claim_my_invites()
returns integer language plpgsql security definer set search_path = public as $$
declare v_count integer := 0;
begin
  if auth.uid() is null then return 0; end if;

  with mine as (
    select ci.id, ci.cafe_id, ci.role
    from cafe_invites ci
    join auth.users u on u.id = auth.uid()
    where lower(ci.email) = lower(u.email)
  ), joined as (
    insert into cafe_members (cafe_id, user_id, role, status)
    select cafe_id, auth.uid(), role, 'active' from mine
    on conflict (cafe_id, user_id) do nothing
    returning cafe_id
  )
  delete from cafe_invites where id in (select id from mine);

  get diagnostics v_count = row_count;
  return v_count;
end $$;

grant execute on function claim_my_invites() to authenticated;
