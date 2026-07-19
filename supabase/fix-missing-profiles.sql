-- Repair: backfill missing profiles + ensure the signup trigger exists.
-- Run if café creation fails with:
--   insert or update on "cafes" violates foreign key constraint "cafes_owner_id_fkey"
-- Cause: user signed up before the handle_new_user trigger was applied, so no
-- profiles row exists for them, and cafes.owner_id -> profiles(id) has nothing to point at.

-- 1. Backfill profiles for existing auth users that are missing one.
insert into profiles (id, full_name, email, phone)
select u.id,
       u.raw_user_meta_data->>'full_name',
       u.email,
       u.raw_user_meta_data->>'phone'
from auth.users u
left join profiles p on p.id = u.id
where p.id is null
on conflict (id) do nothing;

-- 2. (Re)create the trigger so future signups auto-create a profile.
create or replace function handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, email, phone)
  values (new.id, new.raw_user_meta_data->>'full_name', new.email, new.raw_user_meta_data->>'phone')
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users for each row execute function handle_new_user();
