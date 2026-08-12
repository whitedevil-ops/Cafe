-- 0128 — Platform user detail for the operator console.
--
-- Goal: an operator opens a user and sees who they are, which cafés they
-- belong to, when they last signed in, when they were last active, what
-- device they were on, and what they have actually rung up.
--
-- Most of that already exists and was simply never surfaced:
--   last signed in  -> auth.users.last_sign_in_at (populated for everyone
--                      already, so this works retroactively)
--   orders          -> orders.staff_id
--   cafés + role    -> cafe_members
--
-- Only "last active" and "last device" are genuinely new, because nothing
-- recorded them. They start empty and fill in as people use the app; the UI
-- says so rather than inventing a value.
--
-- Deliberately NOT storing IP addresses. The ask was "last device", and a raw
-- IP log is a new category of personal data with its own retention and
-- disclosure obligations under the DPDP Act. The user agent answers the
-- question without opening that.

-- ── Activity columns ────────────────────────────────────────────────────────

alter table profiles add column if not exists last_seen_at  timestamptz;
alter table profiles add column if not exists last_device   text;

comment on column profiles.last_seen_at is
  'Last authenticated app request, throttled to one write per 5 minutes.';
comment on column profiles.last_device is
  'Human-readable device label derived from the user agent app-side (e.g. "Windows · Chrome"). Never the raw UA string.';

-- ── touch_user_activity ─────────────────────────────────────────────────────
-- Called by the app on authenticated page loads. Self-service only: it writes
-- to auth.uid()'s own row and takes no user id, so it cannot be used to forge
-- another account's activity.
--
-- Throttled in the WHERE clause rather than the caller, so a burst of parallel
-- requests (which every dashboard page load produces) results in one write.

create or replace function touch_user_activity(p_device text default null)
returns void
language sql volatile security definer set search_path = public as $$
  update profiles
     set last_seen_at = now(),
         -- Keep the previous label when the caller could not derive one, so a
         -- single odd request doesn't erase a known device.
         last_device  = coalesce(nullif(trim(p_device), ''), last_device)
   where id = auth.uid()
     and (last_seen_at is null or last_seen_at < now() - interval '5 minutes');
$$;

revoke all on function touch_user_activity(text) from public;
grant execute on function touch_user_activity(text) to authenticated;

-- ── op_list_users ───────────────────────────────────────────────────────────
-- Replaces the console's direct `select from profiles`, which could only show
-- name/email/phone/joined. Everything an operator triages on — last seen, last
-- sign-in, which cafés, how many orders — needs joins the client cannot do
-- under RLS.

create or replace function op_list_users(
  p_search text default null,
  p_limit  integer default 200
)
returns table (
  id             uuid,
  full_name      text,
  email          text,
  phone          text,
  created_at     timestamptz,
  last_sign_in_at timestamptz,
  last_seen_at   timestamptz,
  last_device    text,
  cafe_count     bigint,
  cafe_names     text,
  orders_count   bigint
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not has_platform_permission('users.view') then raise exception 'not authorized'; end if;

  return query
  select
    p.id,
    p.full_name,
    coalesce(p.email, u.email::text) as email,
    p.phone,
    p.created_at,
    u.last_sign_in_at,
    p.last_seen_at,
    p.last_device,
    coalesce(m.cafe_count, 0)   as cafe_count,
    m.cafe_names,
    coalesce(o.orders_count, 0) as orders_count
  from profiles p
  left join auth.users u on u.id = p.id
  left join lateral (
    select count(*) as cafe_count,
           string_agg(c.name, ', ' order by c.name) as cafe_names
      from cafe_members cm
      join cafes c on c.id = cm.cafe_id
     where cm.user_id = p.id
  ) m on true
  left join lateral (
    select count(*) as orders_count from orders ord where ord.staff_id = p.id
  ) o on true
  where p_search is null
     or p.full_name ilike '%' || p_search || '%'
     or coalesce(p.email, u.email::text) ilike '%' || p_search || '%'
     or p.phone ilike '%' || p_search || '%'
     or p.id::text = p_search
  order by coalesce(p.last_seen_at, u.last_sign_in_at, p.created_at) desc
  limit greatest(1, least(coalesce(p_limit, 200), 500));
end;
$$;

revoke all on function op_list_users(text, integer) from public;
grant execute on function op_list_users(text, integer) to authenticated;

-- ── op_user_detail ──────────────────────────────────────────────────────────
-- One round trip for the whole detail page. jsonb rather than a wide row
-- because the shape is nested (cafés, recent orders) and the client renders it
-- as sections, not a table.

create or replace function op_user_detail(p_user_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_result jsonb;
begin
  if not has_platform_permission('users.view') then raise exception 'not authorized'; end if;

  select jsonb_build_object(
    'profile', jsonb_build_object(
      'id',         p.id,
      'full_name',  p.full_name,
      'email',      coalesce(p.email, u.email::text),
      'phone',      p.phone,
      'created_at', p.created_at
    ),
    'auth', jsonb_build_object(
      -- Retroactive: Supabase has been recording these since the account was
      -- made, so this is populated even for users who predate migration 0128.
      'last_sign_in_at',    u.last_sign_in_at,
      'email_confirmed_at', u.email_confirmed_at,
      'account_created_at', u.created_at,
      'provider',           u.raw_app_meta_data ->> 'provider'
    ),
    'activity', jsonb_build_object(
      -- Null until the user loads a page after 0128 shipped. The console
      -- distinguishes "never recorded" from "long ago" rather than showing a
      -- misleading dash.
      'last_seen_at', p.last_seen_at,
      'last_device',  p.last_device
    ),
    'cafes', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id',        c.id,
               'name',      c.name,
               'city',      c.city,
               'role',      cm.role,
               'status',    cm.status,
               'plan',      c.plan,
               'joined_at', cm.created_at
             ) order by cm.created_at)
        from cafe_members cm
        join cafes c on c.id = cm.cafe_id
       where cm.user_id = p.id
    ), '[]'::jsonb),
    'orders', (
      select jsonb_build_object(
               'count',    count(*),
               -- Integer rupees, house convention.
               'revenue',  coalesce(sum(ord.total) filter (where ord.status <> 'cancelled'), 0),
               'first_at', min(ord.created_at),
               'last_at',  max(ord.created_at)
             )
        from orders ord where ord.staff_id = p.id
    ),
    'recent_orders', coalesce((
      select jsonb_agg(r) from (
        select ord.id,
               ord.short_code,
               ord.total,
               ord.status::text,
               ord.created_at,
               c2.name as cafe_name
          from orders ord
          join cafes c2 on c2.id = ord.cafe_id
         where ord.staff_id = p.id
         order by ord.created_at desc
         limit 20
      ) r
    ), '[]'::jsonb)
  )
  into v_result
  from profiles p
  left join auth.users u on u.id = p.id
  where p.id = p_user_id;

  return v_result;  -- null when no such user; the page renders notFound()
end;
$$;

revoke all on function op_user_detail(uuid) from public;
grant execute on function op_user_detail(uuid) to authenticated;

-- Sorting the console list by recency needs this once there are real users.
create index if not exists profiles_last_seen_at_idx on profiles (last_seen_at desc nulls last);
